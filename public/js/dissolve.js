/**
 * dissolve.js — the watermark travels between pages.
 *
 * Every page carries its scene's SVG as a fixed background watermark
 * (.bv-watermark). On departure, that watermark ignites into ink particles
 * and scatters while the page dissolves to paper (ordered Bayer dither).
 * On arrival, particles fly back in, redraw the next scene's watermark in
 * exactly the position and size the real element occupies, settle to its
 * resting opacity, and crossfade into it as the page dithers in. The art
 * never disappears; it travels.
 *
 * Scenes are content: SVGs in /art/, routes in /art/scenes.json. Any failure
 * (missing art, bad regex, malformed SVG) falls back to the plain dither —
 * broken art can never break navigation. Reduced motion and no-JS get plain
 * navigation.
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
  // Geometry the particles must land on — kept in CSS custom properties so
  // the watermark rule and this script can never disagree.
  function watermarkGeom() {
    return {
      heightFrac: (parseFloat(cssVar('--wm-height', '72')) || 72) / 100,
      restOpacity: parseFloat(cssVar('--wm-opacity', '0.07')) || 0.07,
    };
  }

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

  function makeCanvas(z) {
    var c = document.createElement('canvas');
    c.width = innerWidth;
    c.height = innerHeight;
    c.setAttribute('data-bv-cover', '');
    c.style.cssText =
      'position:fixed;inset:0;z-index:' + z + ';pointer-events:none;width:100vw;height:100vh;';
    document.documentElement.appendChild(c);
    return c;
  }
  var Z_COVER = 2147483000;
  var Z_ART = 2147483001;

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

  // Sample outline points; returns { pts (centered, normalized by height),
  // aspect } so the drawn art can be sized to the watermark's height rule.
  var artCache = {};
  function sampleArt(url, count) {
    var cacheKey = url + '|' + count;
    if (artCache[cacheKey]) return Promise.resolve(artCache[cacheKey]);
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
          var pts = [];
          geos.forEach(function (g, i) {
            if (!lens[i]) return;
            var n = Math.max(2, Math.round(count * (lens[i] / total)));
            for (var k = 0; k < n; k++) {
              var p = g.getPointAtLength((lens[i] * k) / n);
              // Normalize by HEIGHT: y spans [-0.5, 0.5], x keeps aspect.
              pts.push({ x: (p.x - minX - w / 2) / h, y: (p.y - minY - h / 2) / h });
            }
          });
          if (!pts.length) throw new Error('no points');
          var result = { pts: pts, aspect: w / h };
          artCache[cacheKey] = result;
          return result;
        } finally {
          host.remove();
        }
      });
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function buildParticles(art, canvas) {
    var geom = watermarkGeom();
    var size = canvas.height * geom.heightFrac; // art height in px (mask: auto <height>)
    var cx = canvas.width / 2, cy = canvas.height / 2;
    return art.pts.map(function (p) {
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.max(canvas.width, canvas.height) * (0.5 + Math.random() * 0.4);
      return {
        hx: cx + p.x * size, // home: exactly where the watermark renders
        hy: cy + p.y * size,
        fx: cx + Math.cos(angle) * dist, // far: scattered off-screen
        fy: cy + Math.sin(angle) * dist,
        delay: Math.random() * 0.25,
      };
    });
  }

  // direction 'form': far → home, then settle from travelOpacity to rest.
  // direction 'scatter': home → far, igniting from rest to travelOpacity.
  function animateParticles(canvas, particles, direction, scene, done) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var inkColor = ink();
    var rest = watermarkGeom().restOpacity;
    var travel = 0.85;
    var ms = direction === 'form' ? (scene.formMs || 750) : (scene.scatterMs || 450);
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / ms);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = inkColor;
      ctx.globalAlpha = direction === 'form'
        ? travel
        : rest + (travel - rest) * Math.min(1, t * 3); // ignite quickly
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var e = easeInOutCubic(Math.min(1, Math.max(0, (t - p.delay) / (1 - p.delay))));
        var x, y;
        if (direction === 'form') {
          x = p.fx + (p.hx - p.fx) * e;
          y = p.fy + (p.hy - p.fy) * e;
        } else {
          x = p.hx + (p.fx - p.hx) * e;
          y = p.hy + (p.fy - p.hy) * e;
        }
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
      if (t < 1) requestAnimationFrame(frame);
      else if (direction === 'form') settle();
      else done();
    }
    // After forming at travel opacity, ease down to the watermark's resting
    // opacity so the crossfade to the real element is invisible.
    function settle() {
      var s = performance.now();
      var settleMs = 250;
      function sframe(now) {
        var t = Math.min(1, (now - s) / settleMs);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = inkColor;
        ctx.globalAlpha = travel + (rest - travel) * t;
        for (var i = 0; i < particles.length; i++) {
          ctx.fillRect(particles[i].hx, particles[i].hy, 2, 2);
        }
        ctx.globalAlpha = 1;
        if (t < 1) requestAnimationFrame(sframe);
        else done();
      }
      requestAnimationFrame(sframe);
    }
    requestAnimationFrame(frame);
  }

  // ── Departure: watermark scatters while the page dithers to paper ──
  function maskedNavigate(go) {
    if (reduced) return go();
    var pending = 1;
    var finish = function () {
      if (--pending === 0) {
        try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
        go();
      }
    };
    var cover = makeCanvas(Z_COVER);
    // Scatter the current page's watermark, if it has one.
    loadScenes().then(function (cfg) {
      var scene = sceneFor(location.pathname, cfg);
      if (!scene || !scene.art) return;
      pending++;
      sampleArt(scene.art, scene.particles || 1400)
        .then(function (art) {
          var artCanvas = makeCanvas(Z_ART);
          animateParticles(artCanvas, buildParticles(art, artCanvas), 'scatter', scene, finish);
        })
        .catch(finish);
    });
    dither(cover, 'out', finish);
  }

  // ── Arrival: particles rebuild the watermark, page dithers in beneath ──
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

    var cover = makeCanvas(Z_COVER);
    var ctx = cover.getContext('2d');
    ctx.fillStyle = paper();
    ctx.fillRect(0, 0, cover.width, cover.height);
    document.documentElement.classList.remove('bv-covered');

    var cleanup = function (artCanvas) {
      // Page (with its real watermark) dithers in; the particle copy fades
      // out in step, crossfading into the genuine element.
      if (artCanvas) {
        artCanvas.style.transition = 'opacity ' + DITHER_MS + 'ms linear';
        artCanvas.style.opacity = '0';
      }
      dither(cover, 'in', function () {
        cover.remove();
        if (artCanvas) artCanvas.remove();
      });
    };

    loadScenes()
      .then(function (cfg) {
        var scene = sceneFor(location.pathname, cfg);
        if (!scene || !scene.art) return cleanup(null);
        return sampleArt(scene.art, scene.particles || 1400)
          .then(function (art) {
            var artCanvas = makeCanvas(Z_ART);
            animateParticles(artCanvas, buildParticles(art, artCanvas), 'form', scene, function () {
              setTimeout(function () { cleanup(artCanvas); }, scene.holdMs || 150);
            });
          })
          .catch(function () { cleanup(null); });
      })
      .catch(function () { cleanup(null); });
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

  // Keep the persistent watermark in sync with scenes.json, so per-page art
  // changes are registry edits — the CSS default (key.svg) is just a fallback.
  function syncWatermark() {
    loadScenes().then(function (cfg) {
      var scene = sceneFor(location.pathname, cfg);
      var el = document.querySelector('.bv-watermark');
      if (el && scene && scene.art) {
        el.style.webkitMaskImage = 'url(' + scene.art + ')';
        el.style.maskImage = 'url(' + scene.art + ')';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      syncWatermark();
      arriving();
    });
  } else {
    syncWatermark();
    arriving();
  }
})();
