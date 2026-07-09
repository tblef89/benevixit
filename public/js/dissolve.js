/**
 * dissolve.js — masked navigation with dither dissolves and particle scenes.
 *
 * Departure: the page dissolves to paper (ordered Bayer dither) and the real
 * navigation happens underneath. Arrival: if scenes.json maps this path to an
 * SVG, ink particles fly in and draw its outlines over the paper while the
 * page loads behind the cover; the formed art then breaks apart cell by cell
 * as the dither clears to reveal the page. No scene (or any failure at all)
 * falls back to the plain dither. One room, redressing itself.
 *
 * Art is content: drop SVGs in /art/ and map them in /art/scenes.json.
 * Progressive enhancement only — no JS, old browsers, or reduced motion get
 * plain navigation.
 */
(function () {
  'use strict';

  var KEY = 'bv-dissolving';
  var DITHER_MS = 420;
  var CELL = 8;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function paper() { return cssVar('--paper', '#faf7f0'); }
  function ink() { return cssVar('--ink', '#23201a'); }

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
    c.setAttribute('data-bv-cover', '');
    c.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;pointer-events:none;width:100vw;height:100vh;';
    document.documentElement.appendChild(c);
    return c;
  }

  // Incremental dither on an existing canvas: paints (out) or clears (in)
  // only the cells whose Bayer threshold enters this frame's window.
  function dither(canvas, direction, done) {
    var ctx = canvas.getContext('2d');
    var cols = Math.ceil(canvas.width / CELL);
    var rows = Math.ceil(canvas.height / CELL);
    ctx.fillStyle = paper();
    var start = performance.now();
    var prev = 0;
    function frame(now) {
      var p = Math.min(1, (now - start) / DITHER_MS);
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var t = BAYER[y % 8][x % 8] / 64;
          if (t >= prev && t < p) {
            if (direction === 'out') ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
            else ctx.clearRect(x * CELL, y * CELL, CELL, CELL);
          }
        }
      }
      prev = p;
      if (p < 1) requestAnimationFrame(frame);
      else if (done) done();
    }
    requestAnimationFrame(frame);
  }

  // ── Scenes ──
  var scenesPromise = null;
  function loadScenes() {
    if (!scenesPromise) {
      scenesPromise = fetch('/art/scenes.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return scenesPromise;
  }

  function sceneFor(pathname, cfg) {
    if (!cfg || !Array.isArray(cfg.scenes)) return null;
    for (var i = 0; i < cfg.scenes.length; i++) {
      var s = cfg.scenes[i];
      try {
        if (new RegExp(s.match).test(pathname)) {
          return Object.assign({}, cfg.defaults || {}, s);
        }
      } catch (e) { /* bad regex: skip */ }
    }
    return null;
  }

  // Sample points along an SVG's outlines, normalized to centered unit space.
  function sampleArt(url, count) {
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('art ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;';
        host.innerHTML = text;
        var svg = host.querySelector('svg');
        if (!svg) throw new Error('no svg');
        document.body.appendChild(host);
        try {
          var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
          var minX, minY, w, h;
          if (vb.length === 4 && vb.every(isFinite)) {
            minX = vb[0]; minY = vb[1]; w = vb[2]; h = vb[3];
          } else {
            var bb = svg.getBBox();
            minX = bb.x; minY = bb.y; w = bb.width; h = bb.height;
          }
          if (!w || !h) throw new Error('degenerate viewBox');
          var geos = Array.prototype.slice.call(
            svg.querySelectorAll('path,circle,rect,ellipse,line,polyline,polygon'),
          );
          var lens = geos.map(function (g) {
            try { return g.getTotalLength(); } catch (e) { return 0; }
          });
          var total = lens.reduce(function (a, b) { return a + b; }, 0);
          if (!total) throw new Error('no geometry');
          var scale = 1 / Math.max(w, h);
          var pts = [];
          geos.forEach(function (g, i) {
            if (!lens[i]) return;
            var n = Math.max(2, Math.round(count * (lens[i] / total)));
            for (var k = 0; k < n; k++) {
              var p = g.getPointAtLength((lens[i] * k) / n);
              pts.push({
                x: (p.x - minX - w / 2) * scale,
                y: (p.y - minY - h / 2) * scale,
              });
            }
          });
          if (!pts.length) throw new Error('no points');
          return pts;
        } finally {
          host.remove();
        }
      });
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Particles converge from scattered positions to the art's outline points
  // on a paper-filled canvas, hold, then hand back for the dither reveal.
  function formArt(canvas, pts, scene, done) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var size = Math.min(W, H) * (scene.scale || 0.5);
    var cx = W / 2, cy = H / 2;
    var inkColor = ink();
    var particles = pts.map(function (p) {
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.max(W, H) * (0.5 + Math.random() * 0.4);
      return {
        tx: cx + p.x * size,
        ty: cy + p.y * size,
        sx: cx + Math.cos(angle) * dist,
        sy: cy + Math.sin(angle) * dist,
        delay: Math.random() * 0.25,
      };
    });
    var formMs = scene.formMs || 750;
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / formMs);
      ctx.fillStyle = paper();
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = inkColor;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var e = easeInOutCubic(Math.min(1, Math.max(0, (t - p.delay) / (1 - p.delay))));
        var x = p.sx + (p.tx - p.sx) * e;
        var y = p.sy + (p.ty - p.sy) * e;
        ctx.fillRect(x, y, 2, 2);
      }
      if (t < 1) requestAnimationFrame(frame);
      else setTimeout(done, scene.holdMs || 300);
    }
    requestAnimationFrame(frame);
  }

  function maskedNavigate(go) {
    if (reduced) return go();
    var canvas = makeCanvas();
    dither(canvas, 'out', function () {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      go();
    });
  }

  // ── Arrival ──
  function arriving() {
    var stamp = null;
    try {
      stamp = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch (e) {}
    var fresh = stamp && Date.now() - Number(stamp) < 4000;
    if (!fresh || reduced) {
      document.documentElement.classList.remove('bv-covered');
      return;
    }

    var canvas = makeCanvas();
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = paper();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    document.documentElement.classList.remove('bv-covered');

    var reveal = function () { dither(canvas, 'in', function () { canvas.remove(); }); };

    loadScenes()
      .then(function (cfg) {
        var scene = sceneFor(location.pathname, cfg);
        if (!scene || !scene.art) return reveal();
        return sampleArt(scene.art, scene.particles || 1400)
          .then(function (pts) { formArt(canvas, pts, scene, reveal); })
          .catch(reveal);
      })
      .catch(reveal);
  }

  // ── Interception ──
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-dissolve')) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    if (url.pathname === location.pathname && url.hash) return;
    if (url.pathname.indexOf('/wp-admin') === 0 || url.pathname.indexOf('/wp-login') === 0) return;
    e.preventDefault();
    maskedNavigate(function () { location.href = url.href; });
  });

  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var f = e.target;
    if (!f || f.hasAttribute('data-no-dissolve')) return;
    var action;
    try { action = new URL(f.getAttribute('action') || location.href, location.href); } catch (err) { return; }
    if (action.origin !== location.origin) return;
    var btn = e.submitter;
    if (btn && btn.name) {
      var hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = btn.name;
      hidden.value = btn.value || '';
      f.appendChild(hidden);
    }
    e.preventDefault();
    maskedNavigate(function () { f.submit(); });
  });

  addEventListener('pageshow', function (e) {
    if (e.persisted) {
      document.documentElement.classList.remove('bv-covered');
      document.querySelectorAll('canvas[data-bv-cover]').forEach(function (c) { c.remove(); });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arriving);
  } else {
    arriving();
  }
})();
