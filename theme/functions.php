<?php
/**
 * Bene Vixit — paper terminal storefront.
 * The visitor only ever sees product, cart, checkout, and order confirmation;
 * everything else about WordPress is stripped or hidden.
 */

add_action('after_setup_theme', function () {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('woocommerce');
});

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('benevixit', get_stylesheet_uri(), [], wp_get_theme()->get('Version'));
});

// Strip the product page to essentials: no tabs, no related/upsells, no
// breadcrumbs, no category meta.
add_action('init', function () {
    remove_action('woocommerce_after_single_product_summary', 'woocommerce_output_product_data_tabs', 10);
    remove_action('woocommerce_after_single_product_summary', 'woocommerce_upsell_display', 15);
    remove_action('woocommerce_after_single_product_summary', 'woocommerce_output_related_products', 20);
    remove_action('woocommerce_before_main_content', 'woocommerce_breadcrumb', 20);
    remove_action('woocommerce_single_product_summary', 'woocommerce_template_single_meta', 40);
});

// The long description, plainly, where the tabs used to be.
add_action('woocommerce_after_single_product_summary', function () {
    $content = get_post_field('post_content', get_the_ID());
    if ($content) {
        echo '<div class="bv-description">' . apply_filters('the_content', $content) . '</div>';
    }
}, 10);

// Quiet HTML: no emoji scripts, no generator tag.
remove_action('wp_head', 'print_emoji_detection_script', 7);
remove_action('wp_print_styles', 'print_emoji_styles');
remove_action('wp_head', 'wp_generator');
