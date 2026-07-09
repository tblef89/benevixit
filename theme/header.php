<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>.bv-covered body{visibility:hidden}</style>
<script>try{if(sessionStorage.getItem('bv-dissolving'))document.documentElement.classList.add('bv-covered')}catch(e){}</script>
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<header class="bv-header">
  <a class="bv-brand" href="<?php echo esc_url(home_url('/')); ?>"><?php bloginfo('name'); ?></a>
  <p class="bv-motto"><?php bloginfo('description'); ?></p>
</header>
<main class="bv-main">
