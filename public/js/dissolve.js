/**
 * dissolve.js — the art travels: the old page's watermark dissolves into
 * ink particles that reform as the new page's watermark.
 *
 * Departure records which art it leaves behind and fades only the content.
 * The arriving page hides its own watermark from first paint (bv-transit),
 * instantly redraws the PREVIOUS art from the session point-cache, scatters
 * it, and forms the new art — whose sampling starts in parallel with the
 * scatter. Same-art routes simply scatter and reform. Content fades in while
 * the art is still forming; the rebuild may outlast the page load,
 * deliberately.
 *
 * Sampled outlines are cached in sessionStorage, so dense traced SVGs pay
 * their geometry cost once per session, not per navigation. Scenes are
 * content: SVGs in /art/, routes in /art/scenes.json. Any failure degrades
 * to a plain content fade. Reduced motion and no-JS get plain navigation.
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

  // ── Art sampling, cached per session ──
  // Dense traced SVGs (thousands of paths) take seconds to measure; the
  // resulting points are tiny. Pay the geometry cost once per session.
  var artCache = {};
  function cacheKeyFor(url, count) { return 'bv-pts:' + url + ':' + count; }

  function sampleArt(url, count) {
    var ck = cacheKeyFor(url, count);
    if (artCache[ck]) return Promise.resolve(artCache[ck]);
    try {
      var stored = sessionStorage.getItem(ck);
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed && parsed.pts && parsed.pts.length) {
          artCache[ck] = parsed;
          return Promise.resolve(parsed);
        }
      }
    } catch (e) {}
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
              // Round to 4 decimals: enough precision, smaller cache entries.
              pts.push({
                x: Math.round(((p.x - minX - w / 2) / h) * 1e4) / 1e4,
                y: Math.round(((p.y - minY - h / 2) / h) * 1e4) / 1e4,
              });
            }
          });
          if (!pts.length) throw new Error('no points');
          var result = { pts: pts };
          artCache[ck] = result;
          try { sessionStorage.setItem(ck, JSON.stringify(result)); } catch (e) {}
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

  function drawAtRest(canvas, particles) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = ink();
    ctx.globalAlpha = watermarkGeom().restOpacity;
    for (var i = 0; i < particles.length; i++) {
      ctx.fillRect(particles[i].hx, particles[i].hy, 2, 2);
    }
    ctx.globalAlpha = 1;
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

  // ── Departure: content fades; record which art we leave behind ──
  function maskedNavigate(go) {
    if (reduced) return go();
    var fromArt = null;
    var scenesReady = loadScenes().then(function (cfg) {
      var scene = sceneFor(location.pathname, cfg);
      if (scene && scene.art) fromArt = scene.art;
    }).catch(function () {});
    fadeContent(0, FADE_MS, function () {
      scenesReady.then(function () {
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), from: fromArt }));
        } catch (e) {}
        go();
      });
    });
  }

  // ── Arrival: previous art dissolves, this page's art forms ──
  function endTransit() {
    document.documentElement.classList.remove('bv-covered', 'bv-transit');
  }

  function arriving() {
    var flag = null;
    try {
      flag = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      sessionStorage.removeItem(KEY);
    } catch (e) {}
    var fresh = flag && flag.t && Date.now() - Number(flag.t) < 4000;
    if (!fresh || reduced) {
      endTransit();
      return;
    }

    // Content pinned invisible; watermark stays hidden (bv-transit) until
    // the particle performance hands back to the real element.
    contentChildren().forEach(function (el) { el.style.opacity = '0'; });
    document.documentElement.classList.remove('bv-covered');

    var bail = function (canvas) {
      endTransit();
      if (canvas) canvas.remove();
      fadeContent(1, FADE_MS + 100, null);
    };

    loadScenes()
      .then(function (cfg) {
        var scene = sceneFor(location.pathname, cfg);
        if (!scene || !scene.art) return bail(null);
        applyScene(scene);

        var canvas = makeCanvas();
        var count = scene.particles || 1400;
        // Start measuring the destination art immediately — it runs while
        // the previous art scatters.
        var targetReady = sampleArt(scene.art, count);

        var finish = function (formScene, targetParticles) {
          fadeContent(1, formScene.formMs || 1400, null);
          animateParticles(canvas, targetParticles, 'form', formScene, function () {
            setTimeout(function () {
              endTransit();
              // The real watermark (already showing this scene's art) takes
              // over; crossfade the particle copy away.
              canvas.style.transition = 'opacity 300ms linear';
              canvas.style.opacity = '0';
              setTimeout(function () { canvas.remove(); }, 320);
            }, scene.holdMs || 100);
          });
        };

        var fromArt = flag.from || null;
        var fromReady = fromArt
          ? sampleArt(fromArt, count).catch(function () { return null; })
          : Promise.resolve(null);

        fromReady.then(function (fromArtPts) {
          if (fromArtPts) {
            var fromParticles = buildParticles(fromArtPts, canvas);
            drawAtRest(canvas, fromParticles);
            animateParticles(canvas, fromParticles, 'scatter', scene, function () {
              targetReady
                .then(function (art) { finish(scene, buildParticles(art, canvas)); })
                .catch(function () { bail(canvas); });
            });
          } else {
            // Nothing to dissolve (first hop or unknown origin): just form.
            targetReady
              .then(function (art) { finish(scene, buildParticles(art, canvas)); })
              .catch(function () { bail(canvas); });
          }
        });
      })
      .catch(function () { bail(null); });
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
      endTransit();
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
      applyScene(sceneFor(location.pathname, cfg));
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
