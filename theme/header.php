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
<div class="bv-watermark" aria-hidden="true"></div>
<header class="bv-header">
  <a class="bv-brand" href="<?php echo esc_url(home_url('/')); ?>"><?php bloginfo('name'); ?></a>
  <p class="bv-motto"><?php bloginfo('description'); ?></p>
</header>
<main class="bv-main">
