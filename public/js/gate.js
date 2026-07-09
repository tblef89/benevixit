/**
 * gate.js — wires the terminal to the Gate Worker.
 * Flow: Turnstile → /gate/session → conversation loop with the Keeper.
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
      return { ok: false, error: { code: 'network', message: 'the line went quiet. say that again.' } };
    }
  }

  function getTurnstileToken(siteKey) {
    return new Promise((resolve) => {
      const render = () =>
        turnstile.render('#turnstile-slot', {
          sitekey: siteKey,
          callback: resolve,
          'error-callback': () => resolve(null),
        });
      if (window.turnstile) render();
      else window.onloadTurnstileCallback = render;
      // Fallback if the script tag loaded before we set the callback:
      const wait = setInterval(() => {
        if (window.turnstile) { clearInterval(wait); render(); }
      }, 100);
      setTimeout(() => clearInterval(wait), 15000);
    });
  }

  async function grantReceived(data) {
    T.addLine('');
    await T.print('the door opens.', 40);
    T.addLine('');
    if (data.passphrase) {
      await T.print('remember the word — it changes, but for now it is yours:', 20);
      T.addCopyable(data.passphrase, 'click to copy the word');
      T.addLine('');
    }
    await T.print('your pass (valid one day):', 20);
    T.addCopyable(data.grant, 'click to copy your pass');
    T.addLine('');
    const url = `${data.checkoutUrl}?bv_grant=${encodeURIComponent(data.grant)}`;
    const div = document.createElement('div');
    div.className = 'line';
    const a = document.createElement('a');
    a.href = url;
    a.textContent = '[ enter the shop ]';
    div.appendChild(a);
    document.getElementById('output').appendChild(div);
    T.scrollBottom();
  }

  // ── Opening ──
  await T.print('bene vixit, bene qui latuit.', 35);
  await T.print('he lives well who conceals himself well.', 25);
  T.addLine('');
  await T.print('verifying you are a person...', 15);

  const cfg = await api('config');
  const token = await getTurnstileToken(cfg.data.turnstileSiteKey);
  if (!token) {
    await T.print('verification failed. reload and try again.', 30);
    return;
  }

  const session = await api('session', { turnstileToken: token });
  if (!session.ok) {
    await T.print(session.error.message, 30);
    return;
  }
  const { sessionId, opening } = session.data;

  T.addLine('');
  await T.print(opening, 35);
  T.addLine('');
  T.printInstant("(if you already know the word: /word <phrase>)");
  T.addLine('');

  // Silence looks like death in a terminal — show a pulse while models run.
  function thinking() {
    const div = document.createElement('div');
    div.className = 'line system';
    document.getElementById('output').appendChild(div);
    let n = 0;
    const iv = setInterval(() => {
      n = (n % 3) + 1;
      div.textContent = 'the keeper considers' + '.'.repeat(n);
      T.scrollBottom();
    }, 350);
    return () => { clearInterval(iv); div.remove(); };
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
    const input = await T.prompt('> ');
    if (!input) continue;

    let result;
    if (input.startsWith('/word ')) {
      result = await apiWithPulse('passphrase', { phrase: input.slice(6) });
      if (!result.ok) {
        await T.print(result.error.message, 35);
        continue;
      }
      return grantReceived(result.data);
    }

    result = await apiWithPulse('message', { sessionId, message: input });
    if (!result.ok) {
      await T.print(result.error.message, 35);
      if (result.error.code === 'rate_limited') await T.pause(2000);
      continue;
    }

    await T.print(result.data.reply, 15);
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
