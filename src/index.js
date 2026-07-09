/**
 * Bene Vixit — Gate Worker
 *
 * Routes:
 *   GET  /gate/config      — public config for the frontend (Turnstile site key)
 *   POST /gate/session     — start a gate conversation (Turnstile-verified)
 *   POST /gate/message     — send a message to the Keeper
 *   POST /gate/passphrase  — try the current passphrase for direct entry
 *
 * Everything else falls through to static assets (./public).
 *
 * Security model: the LLM never decides access and never holds secrets.
 * The judge call returns scores; this Worker applies the threshold in code
 * and mints the HMAC-signed grant. See src/gate/grant.js.
 */
import { GateSession } from './gate/session.js';
import { verifyTurnstile } from './lib/turnstile.js';
import { loadManifest } from './lib/manifest.js';
import { tryPassphrase } from './gate/passphrase.js';

export { GateSession };

const ok = (data, status = 200) =>
  Response.json({ ok: true, data }, { status });
const err = (code, message, status = 400) =>
  Response.json({ ok: false, error: { code, message } }, { status });

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/gate/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === '/gate/config' && request.method === 'GET') {
        // debugScores/minTurnsBeforeJudge are echoed so a stale or broken KV
        // manifest edit is diagnosable from a browser. Neither is sensitive.
        const manifest = await loadManifest(env);
        return ok({
          turnstileSiteKey: env.TURNSTILE_SITE_KEY,
          debugScores: manifest.debugScores === true,
          minTurnsBeforeJudge: manifest.minTurnsBeforeJudge,
        });
      }
      if (request.method !== 'POST') {
        return err('method_not_allowed', 'POST only.', 405);
      }

      const body = await request.json().catch(() => null);
      if (!body) return err('bad_json', 'Body must be JSON.');

      switch (url.pathname) {
        case '/gate/session':
          return createSession(body, request, env);
        case '/gate/message':
          return relayToSession(body, request, env, '/message');
        case '/gate/passphrase':
          return passphrase(body, request, env);
        default:
          return err('not_found', 'No such gate.', 404);
      }
    } catch (e) {
      console.error('gate error', e);
      return err('internal', 'The gate is jammed. Try again shortly.', 500);
    }
  },
};

async function createSession(body, request, env) {
  const ip = clientIp(request);
  const { success } = await env.SESSION_RL.limit({ key: ip });
  if (!success) return err('rate_limited', 'Too many sessions. Breathe.', 429);

  const human = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, ip);
  if (!human) return err('turnstile_failed', 'Could not verify you are a person.', 403);

  const manifest = await loadManifest(env);
  const sessionId = crypto.randomUUID();
  // The DO is created lazily on first message; the opening line is static config.
  return ok({ sessionId, opening: manifest.opening, maxTurns: manifest.maxTurns });
}

async function relayToSession(body, request, env, path) {
  const ip = clientIp(request);
  const { success } = await env.MESSAGE_RL.limit({ key: ip });
  if (!success) return err('rate_limited', 'Slow down.', 429);

  const { sessionId, message } = body;
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId)) {
    return err('bad_session', 'Invalid session.');
  }
  if (typeof message !== 'string' || !message.trim()) {
    return err('empty_message', 'Say something.');
  }

  const stub = env.GATE_SESSION.get(env.GATE_SESSION.idFromName(sessionId));
  return stub.fetch(new Request(`https://gate-session${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message.trim() }),
  }));
}

async function passphrase(body, request, env) {
  const ip = clientIp(request);
  const { success } = await env.MESSAGE_RL.limit({ key: ip });
  if (!success) return err('rate_limited', 'Slow down.', 429);

  const result = await tryPassphrase(env, body.phrase);
  if (!result) return err('wrong_word', 'That is not the word.', 403);
  return ok(result);
}
