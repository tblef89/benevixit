/**
 * dissolve.js — the key persists; the text just gets out of the way.
 *
 * Every page carries its scene's SVG as a fixed background watermark
 * (.bv-watermark). On departure only the content fades — the key stays put
 * through the navigation (the arriving page paints it immediately; the
 * covered state hides everything EXCEPT the watermark). Once the new page
 * is there, the key performs: it ignites and scatters into ink particles,
 * then reforms and settles back into place while the content fades in
 * around it. Cinematic by intent — the rebuild is allowed to continue after
 * the page is already readable.
 *
 * Scenes are content: SVGs in /art/, routes in /art/scenes.json. Missing or
 * malformed art degrades to a plain content fade — it can never break
 * navigation. Reduced motion and no-JS get plain navigation.
 */
(function () {
  'use strict';

  var KEY = 'bv-dissolving';
  var FADE_MS = 200;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function ink() { return cssVar('--ink', '#23201a'); }
  function watermarkGeom() {
    var rest = null;
    var el = document.querySelector('.bv-watermark');
    if (el) {
      var o = parseFloat(getComputedStyle(el).opacity);
      if (isFinite(o) && o > 0) rest = o;
    }
    return {
      heightFrac: (parseFloat(cssVar('--wm-height', '72')) || 72) / 100,
      restOpacity: rest || parseFloat(cssVar('--wm-opacity', '0.07')) || 0.07,
    };
  }

  function applyScene(scene) {
    var el = document.querySelector('.bv-watermark');
    if (!el || !scene) return;
    if (scene.art) {
      el.style.webkitMaskImage = 'url(' + scene.art + ')';
      el.style.maskImage = 'url(' + scene.art + ')';
    }
    if (scene.wmOpacity) el.style.opacity = String(scene.wmOpacity);
  }

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

  function contentChildren() {
    return Array.prototype.filter.call(document.body.children, function (el) {
      return !el.classList.contains('bv-watermark') && !el.hasAttribute('data-bv-cover');
    });
  }

  function fadeContent(to, ms, done) {
    var els = contentChildren();
    els.forEach(function (el) {
      el.style.transition = 'opacity ' + ms + 'ms ease';
      void el.offsetWidth; // eslint-disable-line no-unused-expressions
      el.style.opacity = String(to);
    });
    setTimeout(function () {
      if (to === 1) {
        els.forEach(function (el) {
          el.style.transition = '';
          el.style.opacity = '';
        });
      }
      if (done) done();
    }, ms + 30);
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
            var n = Math.round(count * (lens[i] / total));
            if (n < 1) return;
            for (var k = 0; k < n; k++) {
              var p = g.getPointAtLength((lens[i] * k) / n);
              pts.push({ x: (p.x - minX - w / 2) / h, y: (p.y - minY - h / 2) / h });
            }
          });
          if (!pts.length) throw new Error('no points');
          var result = { pts: pts };
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
    var size = canvas.height * geom.heightFrac;
    var cx = canvas.width / 2, cy = canvas.height / 2;
    return art.pts.map(function (p) {
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.max(canvas.width, canvas.height) * (0.5 + Math.random() * 0.4);
      return {
        hx: cx + p.x * size,
        hy: cy + p.y * size,
        fx: cx + Math.cos(angle) * dist,
        fy: cy + Math.sin(angle) * dist,
        delay: Math.random() * 0.3,
      };
    });
  }

  // 'scatter': home → far, igniting from rest opacity. 'form': far → home,
  // then settle back down to the watermark's resting opacity.
  function animateParticles(canvas, particles, direction, scene, done) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var inkColor = ink();
    var rest = watermarkGeom().restOpacity;
    var travel = 0.85;
    var ms = direction === 'form' ? (scene.formMs || 1400) : (scene.scatterMs || 900);
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / ms);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = inkColor;
      ctx.globalAlpha = direction === 'form'
        ? travel
        : rest + (travel - rest) * Math.min(1, t * 2.5);
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
    function settle() {
      var s = performance.now();
      var settleMs = 350;
      function sframe(now) {
        var t = Math.min(1, (now - s) / settleMs);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = inkColor;
        ctx.globalAlpha = travel + (rest - travel) * easeInOutCubic(t);
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

  // ── Departure: content fades; the key does not move ──
  function maskedNavigate(go) {
    if (reduced) return go();
    fadeContent(0, FADE_MS, function () {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      go();
    });
  }

  // ── Arrival: key already painted; it performs, content joins ──
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

    // The covered state already hides everything except the watermark.
    // Pin content at opacity 0, then lift the class — key stays visible.
    contentChildren().forEach(function (el) { el.style.opacity = '0'; });
    document.documentElement.classList.remove('bv-covered');

    var wm = document.querySelector('.bv-watermark');
    var finish = function (canvas) {
      if (wm) wm.style.visibility = '';
      if (canvas) canvas.remove();
    };

    loadScenes()
      .then(function (cfg) {
        var scene = sceneFor(location.pathname, cfg);
        if (!scene || !scene.art || !wm) {
          return fadeContent(1, FADE_MS + 100, null);
        }
        applyScene(scene);
        return sampleArt(scene.art, scene.particles || 1400)
          .then(function (art) {
            var canvas = makeCanvas();
            var particles = buildParticles(art, canvas);
            // Take over from the real watermark seamlessly: draw the copy at
            // rest in place, hide the original, then perform.
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = ink();
            ctx.globalAlpha = watermarkGeom().restOpacity;
            particles.forEach(function (p) { ctx.fillRect(p.hx, p.hy, 2, 2); });
            ctx.globalAlpha = 1;
            wm.style.visibility = 'hidden';
            animateParticles(canvas, particles, 'scatter', scene, function () {
              // Content fades in while the key is still reforming — the
              // rebuild may outlast the page load, deliberately.
              fadeContent(1, scene.formMs || 1400, null);
              animateParticles(canvas, particles, 'form', scene, function () {
                setTimeout(function () { finish(canvas); }, scene.holdMs || 100);
              });
            });
          })
          .catch(function () {
            finish(null);
            fadeContent(1, FADE_MS + 100, null);
          });
      })
      .catch(function () {
        finish(null);
        fadeContent(1, FADE_MS + 100, null);
      });
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
      var wm = document.querySelector('.bv-watermark');
      if (wm) wm.style.visibility = '';
      contentChildren().forEach(function (el) {
        el.style.opacity = '';
        el.style.transition = '';
      });
      document.querySelectorAll('canvas[data-bv-cover]').forEach(function (c) { c.remove(); });
    }
  });

  // Keep the persistent watermark in sync with scenes.json.
  function syncWatermark() {
    loadScenes().then(function (cfg) {
      var scene = sceneFor(location.pathname, cfg);
      applyScene(scene);
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
