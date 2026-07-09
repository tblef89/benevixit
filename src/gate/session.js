/**
 * GateSession — one Durable Object per gate conversation.
 *
 * Holds the transcript, turn count, and teaching state. Serializing all
 * mutations through the DO means turn caps can't be raced, and counters
 * never touch KV. An alarm purges the session after its TTL — no
 * transcript outlives the conversation by more than an hour. Privacy = light.
 */
import { loadManifest } from '../lib/manifest.js';
import { judgeTranscript, decideVerdict } from './judge.js';
import { mintGrant } from './grant.js';

export class GateSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/message' && request.method === 'POST') {
      const { message } = await request.json();
      return this.handleMessage(message);
    }
    return Response.json({ ok: false, error: { code: 'not_found' } }, { status: 404 });
  }

  async handleMessage(message) {
    const manifest = await loadManifest(this.env);

    if (message.length > manifest.maxMessageChars) {
      return this.reply({ reply: 'fewer words. try again.', passed: false });
    }

    const transcript = (await this.ctx.storage.get('transcript')) || [];
    const turns = transcript.filter((m) => m.role === 'user').length;
    if (turns >= manifest.maxTurns) {
      return this.reply({
        reply: 'we have spoken enough for one visit. come back when something has changed.',
        passed: false,
        exhausted: true,
      });
    }

    // First activity: arm the purge alarm.
    if (transcript.length === 0) {
      await this.ctx.storage.setAlarm(Date.now() + manifest.sessionTtlSeconds * 1000);
    }

    transcript.push({ role: 'user', content: message });

    const teaching = (await this.ctx.storage.get('teaching')) || false;
    const system = teaching
      ? `${manifest.persona}\n\n${manifest.teachAddendum}`
      : manifest.persona;

    // Chat and judge run in parallel: the judge scores the VISITOR's words,
    // so it doesn't need the Keeper's new reply. Halves judged-turn latency.
    const chatPromise = this.env.AI.run(
      manifest.chatModel,
      {
        messages: [{ role: 'system', content: system }, ...transcript],
        max_tokens: manifest.maxReplyTokens,
      },
      { gateway: { id: this.env.GATEWAY_ID } },
    );
    // Judge from minTurnsBeforeJudge onward. The verdict is decided in code;
    // nothing the chat model says can grant access. Judge trouble must not
    // eat the Keeper's reply: fail closed to no-pass.
    const judged = turns + 1 >= manifest.minTurnsBeforeJudge;
    const judgePromise = judged
      ? judgeTranscript(this.env, manifest, transcript).catch((e) => {
          console.error('judge failed', e);
          return null;
        })
      : Promise.resolve(null);
    const [res, scores] = await Promise.all([chatPromise, judgePromise]);

    const reply = (res.response ?? '...').trim();
    transcript.push({ role: 'assistant', content: reply });
    await this.ctx.storage.put('transcript', transcript);

    let passed = false;
    if (scores) {
      const verdict = decideVerdict(scores, manifest);
      passed = verdict.pass;
      if (verdict.teach && !teaching) await this.ctx.storage.put('teaching', true);
    }

    // Tuning aid, off by default: set "debugScores": true in the KV manifest
    // to surface the judge's behavior to the terminal. Always reports something
    // on judged turns — scores, or an explicit failure — plus the thresholds in
    // force, so a stale/broken manifest edit is visible too. Turn OFF before
    // launch: visible scores teach visitors how to game the gate.
    const debug = manifest.debugScores
      ? { debug: { judged, scores, thresholds: manifest.passThreshold } }
      : {};

    if (!passed) {
      return this.reply({ reply, passed: false, turnsLeft: manifest.maxTurns - turns - 1, ...debug });
    }

    const grant = await mintGrant(this.env.GRANT_SECRET, {
      edition: manifest.edition,
      ttlSeconds: manifest.grantTtlSeconds,
    });
    await this.ctx.storage.deleteAll(); // conversation served its purpose; purge it
    return this.reply({
      reply,
      passed: true,
      grant,
      checkoutUrl: manifest.checkoutUrl,
      passphrase: manifest.passphrase, // the Keeper may share the word with those who pass
    });
  }

  reply(data) {
    return Response.json({ ok: true, data });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
