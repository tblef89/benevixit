<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>.bv-covered body>:not(.bv-watermark){visibility:hidden}</style>
<script>try{var f=JSON.parse(sessionStorage.getItem('bv-dissolving')||'null');if(f&&f.t&&Date.now()-f.t<4000)document.documentElement.classList.add('bv-covered','bv-transit')}catch(e){}</script>
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<header class="bv-header">
  <a class="bv-letterhead" href="<?php echo esc_url(home_url('/')); ?>">
    <span class="crest" aria-hidden="true">
      <svg data-bv-art viewBox="0 0 439.45 825.07" focusable="false">
        <defs>
          <!-- The gate's die-stamp, the same on every sheet (see
               public/index.html): the mark softened into a height map, lit
               from one direction, kept only where it differs from the flat
               sheet. light.js turns the light with the hour. -->
          <filter id="bv-emboss-day" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="h"/>
            <feDiffuseLighting in="h" surfaceScale="2.4" diffuseConstant="1" lighting-color="#fff" result="lit">
              <feDistantLight data-bv-sun azimuth="225" elevation="40"/>
            </feDiffuseLighting>
            <feColorMatrix in="lit" result="hi" values="0 0 0 0 1  0 0 0 0 0.995  0 0 0 0 0.975  2.2 0 0 0 -1.4141"/>
            <feColorMatrix in="lit" result="sh" values="0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.25  -0.55 0 0 0 0.3535"/>
            <feMerge><feMergeNode in="sh"/><feMergeNode in="hi"/></feMerge>
          </filter>
          <filter id="bv-emboss-night" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="h"/>
            <feDiffuseLighting in="h" surfaceScale="2.4" diffuseConstant="1" lighting-color="#fff" result="lit">
              <feDistantLight data-bv-sun azimuth="58" elevation="32"/>
            </feDiffuseLighting>
            <feColorMatrix in="lit" result="hi" values="0 0 0 0 1  0 0 0 0 0.86  0 0 0 0 0.62  0.9 0 0 0 -0.4769"/>
            <feColorMatrix in="lit" result="sh" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.85 0 0 0 0.4505"/>
            <feMerge><feMergeNode in="sh"/><feMergeNode in="hi"/></feMerge>
          </filter>
        </defs>
        <image href="/art/key.svg" width="439.45" height="825.07" filter="url(#bv-emboss-day)"/>
      </svg>
    </span>
    <span class="bv-brand"><?php bloginfo('name'); ?></span>
  </a>
</header>
<main class="bv-main">
