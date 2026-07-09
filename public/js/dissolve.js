/**
 * dissolve.js — the key travels; the text just gets out of the way.
 *
 * Every page carries its scene's SVG as a fixed background watermark
 * (.bv-watermark). On departure, the page content fades out plainly while
 * the watermark ignites into ink particles and scatters. The navigation
 * happens against bare paper (the html background never changes). On
 * arrival, particles fly back in, redraw the next scene's watermark exactly
 * where the real element sits, settle to its resting opacity — and only
 * then does the new page's content fade in around it. The art performs;
 * the content is furniture.
 *
 * Scenes are content: SVGs in /art/, routes in /art/scenes.json. Missing or
 * malformed art degrades to a plain content fade — it can never break
 * navigation. Reduced motion and no-JS get plain navigation.
 */
(function () {
  'use strict';

  var KEY = 'bv-dissolving';
  var FADE_MS = 200; // content fade, both directions
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function ink() { return cssVar('--ink', '#23201a'); }
  // Geometry the particles must land on — kept in CSS custom properties so
  // the watermark rule and this script can never disagree.
  function watermarkGeom() {
    return {
      heightFrac: (parseFloat(cssVar('--wm-height', '72')) || 72) / 100,
      restOpacity: parseFloat(cssVar('--wm-opacity', '0.07')) || 0.07,
    };
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

  function fadeContent(to, ms, done) {
    var b = document.body;
    b.style.transition = 'opacity ' + ms + 'ms ease';
    // Force a style flush so the transition always fires.
    void b.offsetWidth; // eslint-disable-line no-unused-expressions
    b.style.opacity = String(to);
    setTimeout(done, ms + 30);
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
            var n = Math.max(2, Math.round(count * (lens[i] / total)));
            for (var k = 0; k < n; k++) {
              var p = g.getPointAtLength((lens[i] * k) / n);
              // Normalize by HEIGHT (mask-size is auto <height>).
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
        delay: Math.random() * 0.25,
      };
    });
  }

  // 'form': far → home, then settle from travel opacity down to rest.
  // 'scatter': home → far, igniting quickly from rest to travel opacity.
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
        : rest + (travel - rest) * Math.min(1, t * 3);
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

  // ── Departure: content fades plainly; only the key performs ──
  function maskedNavigate(go) {
    if (reduced) return go();
    var pending = 1;
    var finish = function () {
      if (--pending === 0) {
        try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
        go();
      }
    };
    loadScenes().then(function (cfg) {
      var scene = sceneFor(location.pathname, cfg);
      if (!scene || !scene.art) return;
      pending++;
      sampleArt(scene.art, scene.particles || 1400)
        .then(function (art) {
          var canvas = makeCanvas();
          animateParticles(canvas, buildParticles(art, canvas), 'scatter', scene, finish);
        })
        .catch(finish);
    });
    // The content (watermark included — the canvas copy takes over) fades out
    // fast and without ceremony.
    fadeContent(0, FADE_MS, finish);
  }

  // ── Arrival: the key lands first, then the content fades in around it ──
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

    // Content stays invisible (bv-covered) while the key travels in.
    document.body.style.opacity = '0';
    document.documentElement.classList.remove('bv-covered');

    var reveal = function (canvas) {
      fadeContent(1, FADE_MS + 100, function () {
        document.body.style.transition = '';
        if (canvas) canvas.remove();
      });
      // The particle copy crossfades out as the real watermark fades in
      // with the rest of the content.
      if (canvas) {
        canvas.style.transition = 'opacity ' + (FADE_MS + 100) + 'ms linear';
        canvas.style.opacity = '0';
      }
    };

    loadScenes()
      .then(function (cfg) {
        var scene = sceneFor(location.pathname, cfg);
        if (!scene || !scene.art) return reveal(null);
        return sampleArt(scene.art, scene.particles || 1400)
          .then(function (art) {
            var canvas = makeCanvas();
            animateParticles(canvas, buildParticles(art, canvas), 'form', scene, function () {
              setTimeout(function () { reveal(canvas); }, scene.holdMs || 100);
            });
          })
          .catch(function () { reveal(null); });
      })
      .catch(function () { reveal(null); });
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
      document.body.style.opacity = '';
      document.body.style.transition = '';
      document.querySelectorAll('canvas[data-bv-cover]').forEach(function (c) { c.remove(); });
    }
  });

  // Keep the persistent watermark in sync with scenes.json.
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
