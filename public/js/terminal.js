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

  // Print text character by character
  function print(text, speed) {
    speed = speed || DEFAULT_SPEED;
    return new Promise(resolve => {
      const div = document.createElement('div');
      div.className = 'line';
      output.appendChild(div);
      let i = 0;
      function tick() {
        if (i < text.length) {
          div.textContent += text[i++];
          scrollBottom();
          setTimeout(tick, speed);
        } else {
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
  function prompt(prefix) {
    prefix = prefix || '> ';
    return new Promise(resolve => {
      inputPrefix.textContent = prefix;
      inputText.textContent = '';
      inputLine.style.display = 'block';
      hiddenInput.value = '';
      hiddenInput.focus();
      scrollBottom();

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

      function onInput() {
        inputText.textContent = hiddenInput.value;
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
        div.textContent = bar + ' ' + (pct >= 100 ? 'done.' : pct + '%');
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
    div.title = label || 'click to copy';
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        const orig = div.textContent;
        div.textContent = '[ copied to clipboard ✓ ]';
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
