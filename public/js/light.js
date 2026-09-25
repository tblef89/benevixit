/**
 * light.js — the paper is lit by the visitor's hour.
 *
 * Nothing is sent anywhere: the device clock alone decides where the light
 * falls. Low morning sun rakes in warm from the left; noon is flat and
 * bright; evening comes long and amber from the right; after nine the lamp
 * is lit and the page becomes dusk. Everything downstream — the paper wash,
 * the embossed art, the letterpress impression on the capitals — reads
 * these custom properties, so the whole page agrees about one light.
 *
 * The crest's die-stamp is lit by the same light (its feDistantLight azimuth).
 *
 * Loaded synchronously in <head> (it's tiny) so the first paint is already
 * lit correctly; re-evaluated each minute so a long visit sees the light
 * move. Preview any hour with <html data-bv-hour="7.5">.
 */
(function () {
  var root = document.documentElement;
  var DAWN = 6, DUSK = 21;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmt(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function compute() {
    var forced = parseFloat(root.getAttribute('data-bv-hour'));
    var now = new Date();
    var h = isFinite(forced) ? forced : now.getHours() + now.getMinutes() / 60;
    var prefersDark = false;
    try { prefersDark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    var night = prefersDark || h < DAWN || h >= DUSK;

    // Day arc 0..1 from dawn to dusk. Azimuth sweeps left → right; elevation
    // rises to 1 at the midpoint. Warmth lives at the ends of the day.
    var t = clamp((h - DAWN) / (DUSK - DAWN), 0, 1);
    var az = t * 2 - 1;
    var el = Math.sin(Math.PI * t);
    var warm = Math.pow(1 - el, 1.6);

    var s = root.style;
    var sdx, sdy;
    if (night) {
      // A lamp on the desk, low and to the right; long soft shadows.
      sdx = -1;
      sdy = -1.6;
      s.setProperty('--sun-dx', sdx + 'px');
      s.setProperty('--sun-dy', sdy + 'px');
      s.setProperty('--light-x', '72%');
      s.setProperty('--light-y', '88%');
      s.setProperty('--light-strength', '0.55');
      s.setProperty('--light-warm', '0.7');
      s.setProperty('--relief', '0.9');
    } else {
      // Shadows fall away from the sun and always downward; longer and
      // stronger when the sun is low.
      var len = 1 + (1 - el) * 1.1;
      sdx = -az * len;
      sdy = 0.45 + (1 - el) * 0.9;
      s.setProperty('--sun-dx', fmt(sdx) + 'px');
      s.setProperty('--sun-dy', fmt(sdy) + 'px');
      s.setProperty('--light-x', fmt(50 + az * 48) + '%');
      s.setProperty('--light-y', fmt(8 + (1 - el) * 34) + '%');
      s.setProperty('--light-strength', fmt(0.45 + el * 0.35));
      s.setProperty('--light-warm', fmt(warm));
      s.setProperty('--relief', fmt(0.55 + (1 - el) * 0.45));
    }
    root.classList.toggle('bv-night', night);

    // The crest's die-stamp is lit from where the light comes from: the
    // opposite of where the shadows fall. SVG azimuth is measured clockwise
    // from +x with y pointing down, like the page.
    var azDeg = Math.atan2(-sdy, -sdx) * 180 / Math.PI;
    if (azDeg < 0) azDeg += 360;
    var lights = document.querySelectorAll('feDistantLight[data-bv-sun]');
    for (var j = 0; j < lights.length; j++) lights[j].setAttribute('azimuth', fmt(azDeg));

    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', night ? '#201d17' : '#f3ede2');
    }
  }

  compute();
  // The crest is parsed after this script runs: light it once it exists.
  document.addEventListener('DOMContentLoaded', compute);
  setInterval(compute, 60000);
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', compute);
  } catch (e) {}
})();
