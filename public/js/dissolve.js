/**
 * dissolve.js — masked navigation with a Bayer-dither dissolve.
 *
 * Every same-origin navigation is intercepted: the page dissolves to paper
 * (ordered dither, very much of the aesthetic), the real navigation happens
 * underneath, and the next page — which also carries this script — arrives
 * covered and dithers back in. No white flash, no hard cuts: one room,
 * redressing itself.
 *
 * Progressive enhancement only: no JS, old browsers, or reduced-motion
 * preference → plain navigation. Phase 2 replaces the dither with the
 * key-logo particle morph; the interception layer stays the same.
 */
(function () {
  'use strict';

  var KEY = 'bv-dissolving';
  var DURATION = 420; // ms, each direction
  var CELL = 8; // px, dither cell size
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function paperColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--paper');
    return (v && v.trim()) || '#faf7f0';
  }

  // 8x8 Bayer matrix, values 0..63
  var BAYER = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];

  function makeCanvas() {
    var c = document.createElement('canvas');
    c.width = innerWidth;
    c.height = innerHeight;
    c.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;pointer-events:none;width:100vw;height:100vh;';
    document.documentElement.appendChild(c);
    return c;
  }

  // Incremental dither: each frame only paints (or clears) the cells whose
  // threshold falls inside this frame's progress window — cheap at any size.
  function dither(direction, done) {
    var canvas = makeCanvas();
    var ctx = canvas.getContext('2d');
    var cols = Math.ceil(canvas.width / CELL);
    var rows = Math.ceil(canvas.height / CELL);

    if (direction === 'in') {
      // Arriving: start fully covered.
      ctx.fillStyle = paperColor();
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = paperColor();
    }

    var start = performance.now();
    var prev = 0;

    function frame(now) {
      var p = Math.min(1, (now - start) / DURATION);
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var t = BAYER[y % 8][x % 8] / 64;
          if (t >= prev && t < p) {
            if (direction === 'out') {
              ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
            } else {
              ctx.clearRect(x * CELL, y * CELL, CELL, CELL);
            }
          }
        }
      }
      prev = p;
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        if (direction === 'in') canvas.remove();
        if (done) done(canvas);
      }
    }
    requestAnimationFrame(frame);
  }

  function maskedNavigate(go) {
    if (reduced) return go();
    dither('out', function () {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch (e) {}
      go();
    });
  }

  // ── Arrival: if the previous page dissolved out, dither this one in ──
  function arriving() {
    var stamp = null;
    try {
      stamp = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch (e) {}
    // Honor the flag only if fresh — a stale flag (interrupted navigation,
    // page without this script in between) must not hide a page forever.
    var fresh = stamp && Date.now() - Number(stamp) < 4000;
    document.documentElement.classList.remove('bv-covered');
    if (fresh && !reduced) dither('in');
  }

  // ── Interception ──
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-dissolve')) return;
    var url;
    try {
      url = new URL(a.href, location.href);
    } catch (err) {
      return;
    }
    if (url.origin !== location.origin) return;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    if (url.pathname === location.pathname && url.hash) return; // in-page anchor
    if (url.pathname.indexOf('/wp-admin') === 0 || url.pathname.indexOf('/wp-login') === 0) return;
    e.preventDefault();
    maskedNavigate(function () {
      location.href = url.href;
    });
  });

  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var f = e.target;
    if (!f || f.hasAttribute('data-no-dissolve')) return;
    var action;
    try {
      action = new URL(f.getAttribute('action') || location.href, location.href);
    } catch (err) {
      return;
    }
    if (action.origin !== location.origin) return;
    // form.submit() ignores the submit button's name/value, which WooCommerce
    // needs (add-to-cart=ID) — carry it as a hidden field.
    var btn = e.submitter;
    if (btn && btn.name) {
      var hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = btn.name;
      hidden.value = btn.value || '';
      f.appendChild(hidden);
    }
    e.preventDefault();
    maskedNavigate(function () {
      f.submit();
    });
  });

  // bfcache restore must never leave a cover stuck on screen.
  addEventListener('pageshow', function (e) {
    if (e.persisted) {
      document.documentElement.classList.remove('bv-covered');
      document.querySelectorAll('canvas[style*="2147483000"]').forEach(function (c) {
        c.remove();
      });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arriving);
  } else {
    arriving();
  }
})();
