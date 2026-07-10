/**
 * shop.js — the single product page's image viewer.
 * The gallery is hidden from the flow (the hat SVG carries the page);
 * "View images" opens the photographs in a lightbox instead.
 */
(function () {
  'use strict';
  var link = document.querySelector('.bv-view-images');
  if (!link) return;
  var gallery = document.querySelectorAll('.woocommerce-product-gallery img');
  if (!gallery.length) {
    link.parentElement.style.display = 'none';
    return;
  }
  var srcs = Array.prototype.map.call(gallery, function (img) {
    return img.getAttribute('data-large_image') || img.currentSrc || img.src;
  }).filter(function (s, i, arr) { return s && arr.indexOf(s) === i; });

  var idx = 0;
  var overlay = null;

  function show(i) {
    idx = (i + srcs.length) % srcs.length;
    overlay.querySelector('img').src = srcs[idx];
    overlay.querySelector('.bv-count').textContent =
      srcs.length > 1 ? (idx + 1) + ' / ' + srcs.length : '';
  }
  function close() {
    if (overlay) overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'ArrowLeft') show(idx - 1);
  }

  link.addEventListener('click', function (e) {
    e.preventDefault();
    overlay = document.createElement('div');
    overlay.className = 'bv-lightbox';
    overlay.innerHTML =
      '<figure><img alt="Product photograph"><figcaption class="bv-count"></figcaption></figure>' +
      '<button class="bv-close" aria-label="Close">×</button>';
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay || ev.target.classList.contains('bv-close')) close();
      else if (srcs.length > 1) show(idx + 1);
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    show(0);
  });
})();
