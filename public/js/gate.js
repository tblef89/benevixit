/**
 * gate.js — wires the terminal to the Gate Worker.
 * Flow: Turnstile (or, where it fails, a proof-of-work puzzle) →
 * /gate/session → conversation loop with the Keeper.
 * Typing "/word <phrase>" tries the passphrase instead.
 */
(async function () {
  const T = Terminal;

  async function api(path, body) {
    // Never throw: an error mid-conversation must not kill the chat loop.
    try {
      const res = await fetch(`/gate/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: { code: 'network', message: 'The line went quiet. Say that again.' } };
    }
  }

  // Turnstile's token, or null if it errors, cannot load (blocked, or a
  // browser it will not serve) or has not passed within waitMs. Null is not
  // the end: the caller falls back to proof of work.
  function getTurnstileToken(siteKey, waitMs) {
    return new Promise((resolve) => {
      const slot = document.getElementById('turnstile-slot');
      let widgetId = null;
      let done = false;
      let wait = null;
      let giveUp = null;
      // The token is single-use; once we have it the widget has no further
      // purpose. Let its success state show for a beat, then remove it.
      const finish = (token) => {
        if (done) return;
        done = true;
        clearInterval(wait);
        clearTimeout(giveUp);
        setTimeout(() => {
          try { if (widgetId !== null) turnstile.remove(widgetId); } catch (e) {}
          if (slot) slot.style.display = 'none';
        }, token ? 800 : 0);
        resolve(token || null);
      };
      const render = () => {
        if (widgetId !== null || done) return;
        try {
          widgetId = turnstile.render('#turnstile-slot', {
            sitekey: siteKey,
            callback: finish,
            'error-callback': () => finish(null),
            'unsupported-callback': () => finish(null),
          });
        } catch (e) {
          finish(null);
        }
      };
      wait = setInterval(() => {
        if (window.bvTurnstileFailed) finish(null);
        else if (window.turnstile) { clearInterval(wait); render(); }
      }, 100);
      giveUp = setTimeout(() => finish(null), waitMs);
    });
  }

  // Proof of work: find a nonce whose SHA-256 over `${challenge}:${nonce}`
  // starts with `bits` zero bits. Hashed in batches so the browser's crypto
  // does the work, not the promise plumbing. A few seconds, on any machine.
  async function solvePow(challenge, bits) {
    const enc = new TextEncoder();
    const zeroBits = (d) => {
      let n = 0;
      for (const b of d) {
        if (b === 0) { n += 8; continue; }
        return n + Math.clz32(b) - 24;
      }
      return n;
    };
    const BATCH = 64;
    for (let n = 0; ; n += BATCH) {
      const batch = [];
      for (let i = 0; i < BATCH; i++) {
        batch.push(crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${n + i}`)));
      }
      const digests = await Promise.all(batch);
      for (let i = 0; i < BATCH; i++) {
        if (zeroBits(new Uint8Array(digests[i])) >= bits) return String(n + i);
      }
    }
  }

  // The human check: Turnstile first; for browsers it turns away, a puzzle.
  async function proveHuman(siteKey) {
    const token = await getTurnstileToken(siteKey, 20000);
    if (token) return { turnstileToken: token };
    const pow = await api('pow');
    if (!pow.ok) return null;
    await T.print('Another way, then: a small puzzle for your machine. A few seconds.', 15, 'status');
    const nonce = await solvePow(pow.data.challenge, pow.data.bits);
    return { pow: { challenge: pow.data.challenge, nonce } };
  }

  async function grantReceived(data) {
    T.addLine('');
    await T.print(data.doorLine || 'The door opens.', 40);
    T.addLine('');
    if (data.passphrase) {
      await T.print('Remember the word — it changes, but for now it is yours:', 20);
      T.addCopyable(data.passphrase, 'Click to copy the word');
      T.addLine('');
    }
    await T.print('Your pass (valid one day):', 20);
    T.addCopyable(data.grant, 'Click to copy your pass');
    T.addLine('');
    const url = `${data.checkoutUrl}?bv_grant=${encodeURIComponent(data.grant)}`;
    const div = document.createElement('div');
    div.className = 'line';
    const a = document.createElement('a');
    a.href = url;
    a.className = 'enter';
    a.textContent = 'Enter the shop';
    div.appendChild(a);
    document.getElementById('output').appendChild(div);
    T.scrollBottom();
  }

  // ── Opening: the motto under the crest, as a letterhead ──
  const quote = document.createElement('blockquote');
  quote.className = 'quote';
  const qline = document.createElement('em');
  qline.textContent = '“Bene vixit, bene qui latuit.”';
  const attrib = document.createElement('div');
  attrib.className = 'attrib';
  attrib.textContent = '— Ovid, Tristia, 10 AD';
  quote.appendChild(qline);
  quote.appendChild(attrib);
  document.getElementById('output').appendChild(quote);
  T.scrollBottom();
  await T.pause(500);
  await T.print('He lives well who conceals himself well.', 25, 'translation');

  // The config carries the shop's state (open or closed, set in the KV
  // manifest), shown under the letterhead before anything else happens.
  const cfg = await api('config');
  if (cfg.ok && cfg.data?.shopNotice) await T.print(cfg.data.shopNotice, 15, 'status notice');
  // Closed (switched off or sold out): a greeting, and no conversation.
  if (cfg.ok && cfg.data?.shopOpen === false) {
    T.addLine('');
    await T.print(cfg.data.away || 'The shopkeeper is away.', 35);
    return;
  }
  await T.print('Verifying personhood.', 15, 'status');
  if (!cfg.ok || !cfg.data?.turnstileSiteKey) {
    await T.print('The gate is jammed. Try again shortly.', 30);
    return;
  }
  const human = await proveHuman(cfg.data.turnstileSiteKey);
  if (!human) {
    await T.print('Verification failed. Reload and try again.', 30);
    return;
  }

  const session = await api('session', human);
  if (!session.ok) {
    await T.print(session.error.message, 30);
    return;
  }
  const { sessionId, sessionToken, opening } = session.data;

  T.addLine('');
  await T.print(opening, 35);
  T.addLine('');
  T.printInstant('Know the word? Write /word, then the word.', 'hint');
  T.addLine('');

  // Silence looks like death in a terminal, but dots look like a machine.
  // While the models run, the keeper's mark breathes slowly at the margin —
  // someone considering, not something loading.
  function thinking() {
    const div = document.createElement('div');
    div.className = 'line thinking';
    const mark = document.createElement('span');
    mark.className = 'bv-considering';
    mark.setAttribute('aria-hidden', 'true');
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = 'The keeper considers.';
    div.appendChild(mark);
    div.appendChild(sr);
    document.getElementById('output').appendChild(div);
    T.scrollBottom();
    return () => { div.remove(); };
  }

  async function apiWithPulse(path, body) {
    const done = thinking();
    try {
      return await api(path, body);
    } finally {
      done();
    }
  }

  // ── Conversation loop ──
  while (true) {
    const input = await T.prompt('');
    if (!input) continue;

    let result;
    if (input.startsWith('/word ')) {
      result = await apiWithPulse('passphrase', { sessionId, sessionToken, phrase: input.slice(6) });
      if (!result.ok) {
        await T.print(result.error.message, 35);
        if (result.error.code === 'shop_closed') return;
        continue;
      }
      return grantReceived(result.data);
    }

    result = await apiWithPulse('message', { sessionId, sessionToken, message: input });
    if (!result.ok) {
      await T.print(result.error.message, 35);
      if (result.error.code === 'shop_closed') return;
      if (result.error.code === 'rate_limited') await T.pause(2000);
      continue;
    }

    // The hand's pauses lengthen a reply; a slightly quicker base keeps the
    // whole under the visitor's patience while the rhythm does the talking.
    await T.print(result.data.reply, 12);
    if (result.data.debug) {
      const d = result.data.debug;
      const t = d.thresholds;
      if (!d.judged) {
        T.printInstant('[judge] not judging yet (before minTurnsBeforeJudge)');
      } else if (d.scores) {
        T.printInstant(`[judge] sincerity ${d.scores.sincerity} · knowledge ${d.scores.knowledge} · values ${d.scores.values} (need ${t.sincerity}/${t.knowledge}/${t.values}) — ${d.scores.notes}`);
      } else {
        T.printInstant('[judge] NO VERDICT — judge call failed or output unparseable. check Workers Logs.');
      }
    }
    T.addLine('');

    if (result.data.passed) return grantReceived(result.data);
    if (result.data.exhausted) return;
  }
})();
