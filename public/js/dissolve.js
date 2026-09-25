/**
 * dissolve.js — the art travels: the old page's watermark dissolves into
 * ink particles that reform as the new page's watermark.
 *
 * Departure records which art it leaves behind and fades only the content.
 * The arriving page hides its own watermark from first paint (bv-transit),
 * instantly redraws the PREVIOUS art from the session point-cache, scatters
 * it, and forms the new art — whose sampling starts in parallel with the
 * scatter. Same-art routes (the crest, gate to shop and between shop
 * pages) glide instead: the mark moves from its old place to its new one.
 * Content fades in while the art is still forming; the rebuild may outlast
 * the page load, deliberately.
 *
 * Sampled outlines are cached in sessionStorage, so dense traced SVGs pay
 * their geometry cost once per session, not per navigation. Scenes are
 * content: SVGs in /art/, routes in /art/scenes.json. Any failure degrades
 * to a plain content fade. Reduced motion and no-JS get plain navigation.
 */
(function () {
  'use strict';

  var KEY = 'bv-dissolving';
  var FADE_MS = 260;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function ink() { return cssVar('--ink', '#2c2822'); }

  // ── Watermark geometry: measure what is actually rendered ──
  // Pages size the mask differently (the gate's key by height, the product
  // arch by width and shifted up, the wall by width). The particle copy must
  // land exactly on the real element, so we resolve the computed mask-size /
  // mask-position against the element box instead of assuming any one model.
  function evalCssLength(expr, ref) {
    var s = expr
      .replace(/calc\(/g, '(')
      .replace(/min\(/g, 'Math.min(')
      .replace(/max\(/g, 'Math.max(')
      .replace(/([\d.]+)px/g, '$1')
      .replace(/([\d.]+)%/g, '($1*' + ref + '/100)');
    if (!/^[\d\s.,+\-*/()]*$/.test(s.replace(/Math\.(min|max)/g, ''))) return null;
    try {
      var v = Function('return (' + s + ')')();
      return isFinite(v) ? v : null;
    } catch (e) { return null; }
  }
  function splitTopLevel(s) {
    var parts = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ' ' && depth === 0) {
        if (cur) parts.push(cur);
        cur = '';
      } else cur += c;
    }
    if (cur) parts.push(cur);
    return parts;
  }
  var POS_KEYWORDS = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
  // Returns the rendered art box as viewport fractions plus the resting
  // opacity — everything the particles need to impersonate the element.
  function measureWatermark(aspect) {
    // A page may rest its art in an element of its own rather than the
    // full-viewport watermark (the gate's crest): measure that box directly.
    var art = document.querySelector('[data-bv-art]');
    if (art) {
      try {
        var ar = art.getBoundingClientRect();
        if (ar.width && ar.height) {
          var ink = parseFloat(cssVar('--wm-ink', '0.035'));
          return {
            hFrac: ar.height / innerHeight,
            cxFrac: (ar.left + ar.width / 2) / innerWidth,
            cyFrac: (ar.top + ar.height / 2) / innerHeight,
            opacity: isFinite(ink) && ink > 0 ? ink : 0.035,
          };
        }
      } catch (e) {}
    }
    var el = document.querySelector('.bv-watermark');
    if (!el || !aspect) return null;
    try {
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var W = r.width, H = r.height;
      if (!W || !H) return null;
      var size = splitTopLevel(cs.maskSize || cs.webkitMaskSize || '');
      var w = null, h = null;
      var sx = size[0] || 'auto', sy = size[1] || 'auto';
      if (sx !== 'auto') w = evalCssLength(sx, W);
      if (sy !== 'auto') h = evalCssLength(sy, H);
      if (w === null && h === null) h = H * ((parseFloat(cssVar('--wm-height', '72')) || 72) / 100);
      if (w === null) w = h * aspect;
      if (h === null) h = w / aspect;
      if (!w || !h) return null;
      var pos = splitTopLevel(cs.maskPosition || cs.webkitMaskPosition || '');
      var pxs = POS_KEYWORDS[pos[0]] || pos[0] || '50%';
      var pys = POS_KEYWORDS[pos[1]] || pos[1] || '50%';
      // background-position semantics: % places within the leftover space.
      var px = pxs.indexOf('%') !== -1
        ? (W - w) * ((evalCssLength(pxs, 100) || 0) / 100)
        : (evalCssLength(pxs, W - w) || 0);
      var py = pys.indexOf('%') !== -1
        ? (H - h) * ((evalCssLength(pys, 100) || 0) / 100)
        : (evalCssLength(pys, H - h) || 0);
      // The ink whisper lives in --wm-ink (the element itself is opaque so
      // its emboss pseudo-elements aren't dimmed with it).
      var inkVar = parseFloat(cs.getPropertyValue('--wm-ink'));
      var o = isFinite(inkVar) ? inkVar : parseFloat(cs.opacity);
      return {
        hFrac: h / H,
        cxFrac: (px + w / 2) / W,
        cyFrac: (py + h / 2) / H,
        opacity: isFinite(o) && o > 0 ? o : (parseFloat(cssVar('--wm-opacity', '0.07')) || 0.07),
      };
    } catch (e) { return null; }
  }
  function defaultGeom() {
    return {
      hFrac: (parseFloat(cssVar('--wm-height', '72')) || 72) / 100,
      cxFrac: 0.5,
      cyFrac: 0.5,
      opacity: parseFloat(cssVar('--wm-opacity', '0.07')) || 0.07,
    };
  }

  function applyScene(scene) {
    var el = document.querySelector('.bv-watermark');
    if (!el || !scene) return;
    // The element's mask and its emboss pseudo-elements all read --wm-art.
    if (scene.art) el.style.setProperty('--wm-art', 'url(' + scene.art + ')');
    if (scene.wmInk) el.style.setProperty('--wm-ink', String(scene.wmInk));
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
      // Fading in returns each element to its own opacity (the ghost footer
      // rests at a quarter), not to a flat 1 it would then snap back from.
      el.style.opacity = to === 1 ? '' : String(to);
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
  // v2: entries carry the art's aspect ratio alongside the points.
  function cacheKeyFor(url, count) { return 'bv-pts2:' + url + ':' + count; }

  function sampleArt(url, count) {
    var ck = cacheKeyFor(url, count);
    if (artCache[ck]) return Promise.resolve(artCache[ck]);
    try {
      var stored = sessionStorage.getItem(ck);
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed && parsed.pts && parsed.pts.length && parsed.aspect) {
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
          var result = { pts: pts, aspect: w / h };
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

  function buildParticles(art, canvas, geom) {
    var size = canvas.height * geom.hFrac;
    var cx = canvas.width * geom.cxFrac, cy = canvas.height * geom.cyFrac;
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

  // The art rests as itself and travels as particles: a tinted raster of the
  // SVG carries the full visual mass at either end of the journey, because
  // sparse 2px dots can never match the solid strokes of the real mask —
  // that gap is what previously forced the particles to "ignite" brighter
  // than the watermark they impersonate.
  function loadArtImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }
  function artBox(canvas, geom, aspect) {
    var h = canvas.height * geom.hFrac;
    var w = h * aspect;
    return {
      w: w,
      h: h,
      x: canvas.width * geom.cxFrac - w / 2,
      y: canvas.height * geom.cyFrac - h / 2,
    };
  }
  // The relief the page is currently lit with: the sun's offset and the
  // highlight/shadow colours resolved from the emboss pseudo-elements, so
  // the canvas copy is pressed exactly like the real one.
  function reliefParams() {
    var rootCs = getComputedStyle(document.documentElement);
    var dx = parseFloat(rootCs.getPropertyValue('--sun-dx'));
    var dy = parseFloat(rootCs.getPropertyValue('--sun-dy'));
    var hi = 'rgba(255, 253, 248, 0.5)', lo = 'rgba(70, 50, 28, 0.16)';
    try {
      var el = document.querySelector('.bv-watermark');
      if (el) {
        var b = getComputedStyle(el, '::before').backgroundColor;
        var a = getComputedStyle(el, '::after').backgroundColor;
        if (b && b !== 'rgba(0, 0, 0, 0)') hi = b;
        if (a && a !== 'rgba(0, 0, 0, 0)') lo = a;
      }
    } catch (e) {}
    return { dx: isFinite(dx) ? dx : 1, dy: isFinite(dy) ? dy : 1, hi: hi, lo: lo };
  }

  // A blind emboss of the art: a whisper of ink, a highlight sliver on the
  // edge facing the light, a shadow sliver on the far edge — each sliver cut
  // by subtracting the shape from itself shifted by the sun's offset, the
  // same construction the CSS uses.
  function reliefImage(img, box, inkAlpha, relief) {
    var w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h));
    function shape() {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c;
    }
    function sliver(dx, dy, color) {
      var c = shape();
      var x = c.getContext('2d');
      x.globalCompositeOperation = 'destination-out';
      x.drawImage(img, dx, dy, w, h);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = color;
      x.fillRect(0, 0, w, h);
      return c;
    }
    var tint = shape();
    var t = tint.getContext('2d');
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = ink();
    t.fillRect(0, 0, w, h);

    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var o = out.getContext('2d');
    o.globalAlpha = inkAlpha;
    o.drawImage(tint, 0, 0);
    o.globalAlpha = 1;
    o.drawImage(sliver(relief.dx, relief.dy, relief.hi), 0, 0);
    o.drawImage(sliver(-relief.dx, -relief.dy, relief.lo), 0, 0);
    return { cnv: out, x: box.x, y: box.y, w: box.w, h: box.h };
  }

  // Each particle is a pressed grain of paper: a lit fleck with its shadow.
  function drawGrains(ctx, particles, direction, t, relief) {
    var n = particles.length, i, p, e, x, y;
    var xs = new Float32Array(n), ys = new Float32Array(n);
    for (i = 0; i < n; i++) {
      p = particles[i];
      if (t === null) { xs[i] = p.hx; ys[i] = p.hy; continue; }
      e = easeInOutCubic(Math.min(1, Math.max(0, (t - p.delay) / (1 - p.delay))));
      if (direction === 'form') {
        xs[i] = p.fx + (p.hx - p.fx) * e;
        ys[i] = p.fy + (p.hy - p.fy) * e;
      } else {
        xs[i] = p.hx + (p.fx - p.hx) * e;
        ys[i] = p.hy + (p.fy - p.hy) * e;
      }
    }
    ctx.fillStyle = relief.lo;
    for (i = 0; i < n; i++) ctx.fillRect(xs[i] + relief.dx, ys[i] + relief.dy, 2, 2);
    ctx.fillStyle = relief.hi;
    for (i = 0; i < n; i++) ctx.fillRect(xs[i], ys[i], 2, 2);
  }

  function drawAtRest(canvas, image, particles, relief) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    if (image) ctx.drawImage(image.cnv, image.x, image.y, image.w, image.h);
    else drawGrains(ctx, particles, 'form', null, relief);
  }

  // 'scatter': home → far. 'form': far → home. 'glide': the same mark
  // moving from where the last page pressed it to where this one does (fx/fy
  // hold the old home), handing off from the old image to the new. The
  // pressed art hands its mass to the grains as they depart and receives it
  // back as they land; nothing ever brightens beyond the relief the page
  // itself wears.
  function animateParticles(canvas, particles, direction, scene, relief, image, done, fromImage) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var ms = direction === 'scatter' ? (scene.scatterMs || 900) : (scene.formMs || 1400);
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / ms);
      ctx.clearRect(0, 0, W, H);
      var imgAlpha = direction === 'scatter'
        ? Math.max(0, 1 - t / 0.35)
        : Math.max(0, (t - 0.65) / 0.35);
      var fromAlpha = direction === 'glide' && fromImage ? Math.max(0, 1 - t / 0.35) : 0;
      if (fromAlpha > 0) {
        ctx.globalAlpha = easeInOutCubic(fromAlpha);
        ctx.drawImage(fromImage.cnv, fromImage.x, fromImage.y, fromImage.w, fromImage.h);
      }
      if (image && imgAlpha > 0) {
        ctx.globalAlpha = easeInOutCubic(imgAlpha);
        ctx.drawImage(image.cnv, image.x, image.y, image.w, image.h);
      }
      ctx.globalAlpha = image ? easeInOutCubic(1 - Math.max(imgAlpha, fromAlpha)) : 1;
      drawGrains(ctx, particles, direction === 'glide' ? 'form' : direction, t, relief);
      ctx.globalAlpha = 1;
      if (t < 1) requestAnimationFrame(frame);
      else done();
    }
    requestAnimationFrame(frame);
  }

  // ── Departure: content fades; record which art we leave behind, and
  // exactly how this page rendered it — box and opacity — so the arriving
  // page can redraw it in place instead of guessing. ──
  function maskedNavigate(go) {
    if (reduced) return go();
    var fromArt = null, fromGeom = null, fromCount = 1400;
    var scenesReady = loadScenes().then(function (cfg) {
      var scene = sceneFor(location.pathname, cfg);
      if (!scene || !scene.art) return;
      fromArt = scene.art;
      fromCount = scene.particles || 1400;
      // Measure the real element NOW, on the page the art actually rests
      // on — the arriving page styles its watermark differently.
      return sampleArt(scene.art, fromCount).then(function (art) {
        fromGeom = measureWatermark(art.aspect);
      }).catch(function () {});
    }).catch(function () {});
    fadeContent(0, FADE_MS, function () {
      scenesReady.then(function () {
        try {
          sessionStorage.setItem(KEY, JSON.stringify({
            t: Date.now(), from: fromArt, geom: fromGeom, count: fromCount,
          }));
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

    // The previous art goes back up immediately — before scenes.json even
    // returns — in the exact box and opacity the origin page rendered it,
    // so the art never blinks out across the navigation.
    var canvas = makeCanvas();
    var fromGeom = flag.geom || null;
    var fromReady = flag.from
      ? sampleArt(flag.from, flag.count || 1400).catch(function () { return null; })
      : Promise.resolve(null);
    var fromImgReady = flag.from
      ? loadArtImage(flag.from).catch(function () { return null; })
      : Promise.resolve(null);
    var fromDrawn = fromReady.then(function (art) {
      if (!art) return null;
      var geom = fromGeom || defaultGeom();
      var particles = buildParticles(art, canvas, geom);
      var box = artBox(canvas, geom, art.aspect);
      var relief = reliefParams();
      return fromImgReady.then(function (img) {
        var image = img ? reliefImage(img, box, geom.opacity, relief) : null;
        drawAtRest(canvas, image, particles, relief);
        return { particles: particles, image: image, relief: relief };
      });
    });

    var bail = function () {
      endTransit();
      // Fade the cover out rather than snapping it off — from-art may be up.
      canvas.style.transition = 'opacity 200ms linear';
      canvas.style.opacity = '0';
      setTimeout(function () { canvas.remove(); }, 220);
      fadeContent(1, FADE_MS + 100, null);
    };

    loadScenes()
      .then(function (cfg) {
        var scene = sceneFor(location.pathname, cfg);
        if (!scene || !scene.art) return bail();
        applyScene(scene);
        var count = scene.particles || 1400;
        // Start measuring the destination art immediately — it runs while
        // the previous art scatters.
        var targetReady = sampleArt(scene.art, count);

        var finish = function (art, from) {
          // Measure how THIS page renders its watermark; the forming art
          // must land exactly on the element that takes over afterwards.
          var destGeom = measureWatermark(art.aspect) || defaultGeom();
          var targetParticles = buildParticles(art, canvas, destGeom);
          // The same mark on both pages (the letterhead's crest): each grain
          // travels from its place in the old mark to its place in the new
          // one. Sampling is deterministic, so grain i is the same point of
          // the outline at both ends.
          var glide = !!(from && from.particles.length === targetParticles.length);
          if (glide) {
            targetParticles.forEach(function (p, i) {
              p.fx = from.particles[i].hx;
              p.fy = from.particles[i].hy;
              p.delay = Math.random() * 0.15;
            });
          }
          var box = artBox(canvas, destGeom, art.aspect);
          var relief = reliefParams();
          loadArtImage(scene.art).catch(function () { return null; }).then(function (img) {
            var image = img ? reliefImage(img, box, destGeom.opacity, relief) : null;
          fadeContent(1, scene.formMs || 1400, null);
          animateParticles(canvas, targetParticles, glide ? 'glide' : 'form', scene, relief, image, function () {
            setTimeout(function () {
              endTransit();
              // The real watermark (already showing this scene's art) takes
              // over; crossfade the particle copy away.
              canvas.style.transition = 'opacity 400ms linear';
              canvas.style.opacity = '0';
              setTimeout(function () { canvas.remove(); }, 420);
            }, scene.holdMs || 100);
          }, glide ? from.image : null);
          });
        };

        fromDrawn.then(function (state) {
          if (state && flag.from === scene.art && (flag.count || 1400) === count) {
            targetReady.then(function (art) { finish(art, state); }).catch(bail);
          } else if (state) {
            animateParticles(canvas, state.particles, 'scatter', scene, state.relief, state.image, function () {
              targetReady.then(finish).catch(bail);
            });
          } else {
            // Nothing to dissolve (first hop or unknown origin): just form.
            targetReady.then(finish).catch(bail);
          }
        });
      })
      .catch(bail);
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
