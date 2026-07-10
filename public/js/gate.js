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
      return { ok: false, error: { code: 'network', message: 'The line went quiet. Say that again.' } };
    }
  }

  function getTurnstileToken(siteKey) {
    return new Promise((resolve) => {
      let widgetId = null;
      // The token is single-use; once we have it the widget has no further
      // purpose. Let its success state show for a beat, then remove it.
      const dismiss = () => {
        setTimeout(() => {
          try { if (widgetId !== null) turnstile.remove(widgetId); } catch (e) {}
          const slot = document.getElementById('turnstile-slot');
          if (slot) slot.style.display = 'none';
        }, 800);
      };
      const render = () => {
        widgetId = turnstile.render('#turnstile-slot', {
          sitekey: siteKey,
          callback: (token) => { resolve(token); dismiss(); },
          'error-callback': () => resolve(null),
        });
      };
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
    a.textContent = '[ Enter the shop ]';
    div.appendChild(a);
    document.getElementById('output').appendChild(div);
    T.scrollBottom();
  }

  // ── Opening: the printer's mark at the chapter head, then the motto ──
  // The ornament sits above the epigraph, in the clear band above the
  // watermark — lower placements collide with the background key's bow.
  const fleuron = document.createElement('div');
  fleuron.className = 'bv-fleuron';
  fleuron.setAttribute('aria-hidden', 'true');
  fleuron.appendChild(document.createElement('span'));
  document.getElementById('output').appendChild(fleuron);

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
  await T.print('He lives well who conceals himself well.', 25);
  T.addLine('');
  await T.print('Verifying personhood.', 15);

  const cfg = await api('config');
  if (!cfg.ok || !cfg.data?.turnstileSiteKey) {
    await T.print('The gate is jammed. Try again shortly.', 30);
    return;
  }
  const token = await getTurnstileToken(cfg.data.turnstileSiteKey);
  if (!token) {
    await T.print('Verification failed. Reload and try again.', 30);
    return;
  }

  const session = await api('session', { turnstileToken: token });
  if (!session.ok) {
    await T.print(session.error.message, 30);
    return;
  }
  const { sessionId, sessionToken, opening } = session.data;

  T.addLine('');
  await T.print(opening, 35);
  T.addLine('');
  T.printInstant("(If you already know the word: /word <phrase>)");
  T.addLine('');

  // Silence looks like death in a terminal — show a pulse while models run.
  function thinking() {
    const div = document.createElement('div');
    div.className = 'line system';
    document.getElementById('output').appendChild(div);
    let n = 0;
    const iv = setInterval(() => {
      n = (n % 3) + 1;
      div.textContent = 'The keeper considers' + '.'.repeat(n);
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
      result = await apiWithPulse('passphrase', { sessionId, sessionToken, phrase: input.slice(6) });
      if (!result.ok) {
        await T.print(result.error.message, 35);
        continue;
      }
      return grantReceived(result.data);
    }

    result = await apiWithPulse('message', { sessionId, sessionToken, message: input });
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
