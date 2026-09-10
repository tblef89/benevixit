/**
 * terminal.js — Core terminal engine
 * Character-by-character typing, input handling, progress bars.
 */

const Terminal = (() => {
  const output = document.getElementById('output');
  const inputLine = document.getElementById('input-line');
  const inputText = document.getElementById('input-text');
  const inputPrefix = document.getElementById('input-prefix');
  const hiddenInput = document.getElementById('hidden-input');
  const terminal = document.getElementById('terminal');

  const DEFAULT_SPEED = 30;
  const FAST_SPEED = 10;
  // Haste is the enemy of quality: every typing speed is stretched by this
  // factor, so the whole gate slows in step without retuning each call site.
  const PACE = 1.2;

  // Auto-scroll to bottom
  function scrollBottom() {
    terminal.scrollTop = terminal.scrollHeight;
  }

  // Add a completed line to output
  function addLine(text) {
    const div = document.createElement('div');
    div.className = 'line';
    div.textContent = text;
    output.appendChild(div);
    scrollBottom();
  }

  // ── The Keeper's hand ──
  // Not a teletype: a pen. Letters arrive with a hand's unevenness, the
  // pen lifts between words, breathes at a comma, rests at a full stop, and
  // slows into the final sentence the way a letter is finished rather than
  // ended. `base` is the nominal per-character interval.
  const reducedMotion = (() => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  })();

  function lastSentenceStart(text) {
    // Index where the final sentence begins (after the last terminator that
    // isn't itself at the very end).
    const trimmed = text.replace(/[\s.!?…”"')\]]+$/, '');
    const m = trimmed.match(/[.!?…](?=[\s”"')\]]*\s)[^.!?…]*$/);
    if (!m) return 0;
    return trimmed.length - m[0].length + 1;
  }

  function delayAfter(text, i, base, finalStart) {
    const ch = text[i];
    const next = text[i + 1];
    let d = base * (0.78 + Math.random() * 0.44);
    if (ch === ' ') d += base * 0.7;
    if (ch === ',') d += 190;
    else if (ch === ';' || ch === ':' || ch === '—' || ch === '–') d += 280;
    else if (/[.!?…]/.test(ch) && (next === undefined || /[\s”"')\]]/.test(next))) d += 460;
    // The final sentence slows, gently, all the way to the last letter.
    if (finalStart > 0 && i >= finalStart && text.length > finalStart) {
      d *= 1 + 0.4 * ((i - finalStart) / (text.length - finalStart));
    }
    return d;
  }

  // Print text with the hand's rhythm; a nib follows the writing.
  function print(text, speed) {
    const base = (speed || DEFAULT_SPEED) * PACE;
    return new Promise(resolve => {
      const div = document.createElement('div');
      div.className = 'line';
      const body = document.createElement('span');
      const nib = document.createElement('span');
      nib.className = 'cursor writing';
      nib.setAttribute('aria-hidden', 'true');
      div.appendChild(body);
      div.appendChild(nib);
      output.appendChild(div);
      const finalStart = lastSentenceStart(text);
      let i = 0;
      function tick() {
        if (i < text.length) {
          body.textContent += text[i];
          scrollBottom();
          const d = delayAfter(text, i, base, finalStart);
          i++;
          setTimeout(tick, d);
        } else {
          nib.remove();
          div.textContent = body.textContent;
          resolve();
        }
      }
      tick();
    });
  }

  // Print multiple lines with pauses between
  async function printLines(lines, speed, pauseMs) {
    speed = speed || DEFAULT_SPEED;
    pauseMs = pauseMs || 300;
    for (const line of lines) {
      if (line === '') {
        addLine('');
      } else {
        await print(line, speed);
      }
      await pause(pauseMs);
    }
  }

  // Print instantly (no animation)
  function printInstant(text) {
    addLine(text);
  }

  // Pause
  function pause(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Clear terminal
  function clear() {
    output.innerHTML = '';
  }

  // Show prompt and wait for user input
  let tapHintShown = false;
  function prompt(prefix) {
    prefix = prefix || '> ';
    return new Promise(resolve => {
      inputPrefix.textContent = prefix;
      inputText.textContent = '';
      inputLine.style.display = 'block';
      hiddenInput.value = '';
      hiddenInput.focus();
      scrollBottom();

      // Mobile browsers (iOS especially) refuse programmatic keyboards
      // outside a user gesture. If our focus attempt was blocked, say so —
      // once — and the existing tap-anywhere handler does the rest.
      setTimeout(() => {
        if (!tapHintShown && document.activeElement !== hiddenInput) {
          tapHintShown = true;
          const hint = document.createElement('div');
          hint.className = 'line system';
          hint.textContent = '(Tap anywhere to speak)';
          output.appendChild(hint);
          scrollBottom();
        }
      }, 300);

      function onKey(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = hiddenInput.value;
          hiddenInput.removeEventListener('keydown', onKey);
          hiddenInput.removeEventListener('input', onInput);
          inputLine.style.display = 'none';
          // Echo the input
          addLine(prefix + val);
          resolve(val.trim());
        }
      }

      let lastLen = 0;
      function onInput() {
        const val = hiddenInput.value;
        inputText.textContent = val;
        // Where the pen lifts — after a word, at a stop — it leaves a blot of
        // ink that settles into the paper. One per word, never a smear.
        const last = val[val.length - 1];
        if (!reducedMotion && val.length > lastLen && /[\s.,;:!?—–]/.test(last)) {
          const blot = document.createElement('span');
          blot.className = 'blot';
          blot.setAttribute('aria-hidden', 'true');
          inputText.parentNode.insertBefore(blot, inputText.nextSibling);
          setTimeout(() => blot.remove(), 700);
        }
        lastLen = val.length;
        scrollBottom();
      }

      hiddenInput.addEventListener('keydown', onKey);
      hiddenInput.addEventListener('input', onInput);
    });
  }

  // Animated progress bar
  function progressBar(durationMs) {
    durationMs = durationMs || 2000;
    return new Promise(resolve => {
      const div = document.createElement('div');
      div.className = 'line progress-bar';
      output.appendChild(div);
      const total = 24;
      let filled = 0;
      const interval = durationMs / total;

      function tick() {
        filled++;
        const pct = Math.round((filled / total) * 100);
        const bar = '█'.repeat(filled) + '░'.repeat(total - filled);
        div.textContent = bar + ' ' + (pct >= 100 ? 'Done.' : pct + '%');
        scrollBottom();
        if (filled < total) {
          setTimeout(tick, interval);
        } else {
          resolve();
        }
      }
      tick();
    });
  }

  // Add a clickable line (click-to-copy)
  function addCopyable(text, label) {
    const div = document.createElement('div');
    div.className = 'line copyable';
    div.textContent = text;
    div.title = label || 'Click to copy';
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        const orig = div.textContent;
        div.textContent = '[ Copied to clipboard ✓ ]';
        div.classList.add('copied');
        setTimeout(() => {
          div.textContent = orig;
          div.classList.remove('copied');
        }, 1500);
      });
    });
    output.appendChild(div);
    scrollBottom();
  }

  // Focus hidden input on any click
  document.addEventListener('click', () => {
    if (inputLine.style.display !== 'none') {
      hiddenInput.focus();
    }
  });

  // Mobile keyboard fix: aggressively scroll input into view
  function scrollInputVisible() {
    // Multiple attempts to fight browser's default scroll behavior
    const attempts = [50, 150, 300, 500];
    attempts.forEach(delay => {
      setTimeout(() => {
        if (inputLine.style.display !== 'none') {
          inputLine.scrollIntoView({ block: 'center', behavior: 'instant' });
          terminal.scrollTop = terminal.scrollHeight;
        }
      }, delay);
    });
  }

  hiddenInput.addEventListener('focus', scrollInputVisible);

  if (window.visualViewport) {
    let prevHeight = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const newHeight = window.visualViewport.height;
      // Keyboard opened (viewport got smaller)
      if (newHeight < prevHeight && inputLine.style.display !== 'none') {
        scrollInputVisible();
      }
      prevHeight = newHeight;
    });
  }

  return { print, printLines, printInstant, prompt, pause, clear, progressBar, scrollBottom, addLine, addCopyable, FAST_SPEED, DEFAULT_SPEED };
})();
