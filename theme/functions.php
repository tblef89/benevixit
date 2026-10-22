<?php
/**
 * Bene Vixit — paper terminal storefront.
 * The visitor only ever sees product, cart, checkout, and order confirmation;
 * everything else about WordPress is stripped or hidden.
 */

require_once __DIR__ . '/emails.php';

add_action('after_setup_theme', function () {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('woocommerce');
});

add_action('wp_enqueue_scripts', function () {
    // Version assets by file mtime: every `git pull` on the box busts every
    // cache (browser and Cloudflare edge) automatically. A static theme
    // version left day-old stylesheets pinned at ?ver=1.0.
    $dir = get_stylesheet_directory();
    $css_ver = @filemtime($dir . '/style.css') ?: wp_get_theme()->get('Version');
    wp_enqueue_style('benevixit', get_stylesheet_uri(), [], $css_ver);
    // The hour's light, set before first paint (tiny, synchronous, in head).
    wp_enqueue_script('bv-light', '/js/light.js', [], null, ['in_footer' => false]);
    // Masked-navigation dissolve, served same-origin by the Worker.
    wp_enqueue_script('bv-dissolve', '/js/dissolve.js', [], null, ['strategy' => 'defer', 'in_footer' => false]);
    if (is_product()) {
        $js_ver = @filemtime($dir . '/shop.js') ?: wp_get_theme()->get('Version');
        wp_enqueue_script('bv-shop', get_template_directory_uri() . '/shop.js', [], $js_ver, true);
    }
});

// The hat itself, engraved: the one printed object on the sheet, under the
// letterhead's blind crest. Rendered as an ink-masked raster (see .bv-hat).
add_action('woocommerce_single_product_summary', function () {
    echo '<div class="bv-hat" role="img" aria-label="The hat, engraved"></div>';
}, 22);

// The photographs live behind a quiet link instead of dominating the page —
// the hat engraving carries the visual load. data-no-dissolve keeps the
// navigation interceptor's hands off it.
add_action('woocommerce_single_product_summary', function () {
    echo '<p class="bv-view-images-wrap"><a href="#" class="bv-view-images" data-no-dissolve>View the photographs</a></p>';
}, 25);

// Strip the product page to essentials: no tabs, no related/upsells, no
// breadcrumbs, no category meta.
add_action('init', function () {
    remove_action('woocommerce_after_single_product_summary', 'woocommerce_output_product_data_tabs', 10);
    remove_action('woocommerce_after_single_product_summary', 'woocommerce_upsell_display', 15);
    remove_action('woocommerce_after_single_product_summary', 'woocommerce_output_related_products', 20);
    remove_action('woocommerce_before_main_content', 'woocommerce_breadcrumb', 20);
    remove_action('woocommerce_single_product_summary', 'woocommerce_template_single_meta', 40);
});

// The long description, plainly, where the tabs used to be, a hairline
// between it and the summary.
add_action('woocommerce_after_single_product_summary', function () {
    $content = get_post_field('post_content', get_the_ID());
    if ($content) {
        echo '<div class="bv-rule" aria-hidden="true"></div>';
        echo '<div class="bv-description">' . apply_filters('the_content', $content) . '</div>';
    }
}, 10);

// Never say how many are left. "Out of stock" still shows; "28 in stock"
// and "Only 2 left" do not.
add_filter('woocommerce_get_availability_text', function ($text, $product) {
    return $product->is_in_stock() ? '' : $text;
}, 10, 2);

// Nor in the quantity box's max= (product page and cart). The cart still
// refuses more than there is; it just doesn't say the number up front.
add_filter('woocommerce_quantity_input_args', function ($args, $product) {
    if ($product instanceof WC_Product && $product->managing_stock() && !$product->is_sold_individually()) {
        $args['max_value'] = -1;
    }
    return $args;
}, 10, 2);

// Nor when someone asks for more than there is.
add_filter('woocommerce_cart_product_not_enough_stock_message', function ($message, $product) {
    return sprintf('There are not enough of &quot;%s&quot; left for that quantity.', $product->get_name());
}, 10, 2);
add_filter('woocommerce_cart_product_not_enough_stock_already_in_cart_message', function ($message, $product) {
    return sprintf('There are not enough of &quot;%s&quot; left to add more to your cart.', $product->get_name());
}, 10, 2);

// Nor in the public Store API (/wp-json/wc/store/...), which otherwise
// reports the stock as the add-to-cart maximum and as low_stock_remaining.
// Report what an untracked product would: 9999 and null.
add_filter('rest_post_dispatch', function ($response, $server, $request) {
    if (!$response instanceof WP_REST_Response || strpos($request->get_route(), '/wc/store/') !== 0) {
        return $response;
    }
    // The Store API mixes arrays and stdClass (add_to_cart, quantity_limits).
    $scrub = function ($node) use (&$scrub) {
        if ($node instanceof stdClass) {
            return (object) $scrub((array) $node);
        }
        if (!is_array($node)) {
            return $node;
        }
        if (array_key_exists('low_stock_remaining', $node)) {
            $node['low_stock_remaining'] = null;
        }
        if (array_key_exists('sold_individually', $node) && !$node['sold_individually']) {
            foreach (['add_to_cart', 'quantity_limits'] as $k) {
                if (is_array($node[$k] ?? null) && isset($node[$k]['maximum'])) {
                    $node[$k]['maximum'] = 9999;
                } elseif (is_object($node[$k] ?? null) && isset($node[$k]->maximum)) {
                    $node[$k]->maximum = 9999;
                }
            }
        }
        foreach ($node as $k => $v) {
            $node[$k] = $scrub($v);
        }
        return $node;
    };
    $response->set_data($scrub($response->get_data()));
    return $response;
}, 10, 3);

// Browser chrome tinted to match the paper in both schemes (matches the gate).
add_action('wp_head', function () {
    echo '<meta name="theme-color" content="#f3ede2" media="(prefers-color-scheme: light)">' . "\n";
    echo '<meta name="theme-color" content="#201d17" media="(prefers-color-scheme: dark)">' . "\n";
}, 1);

// Quiet HTML: no emoji scripts, no generator tag.
remove_action('wp_head', 'print_emoji_detection_script', 7);
remove_action('wp_print_styles', 'print_emoji_styles');
remove_action('wp_head', 'wp_generator');

// The order-received page: the letters are on their way, and where to look
// if one goes astray. Mail from a new sender sometimes lands in spam.
add_filter('woocommerce_thankyou_order_received_text', function ($text, $order) {
    if (!$order instanceof WC_Order) {
        return $text;
    }
    return 'Thank you. Your order is received. A letter is on its way to '
        . esc_html($order->get_billing_email())
        . '; if it has not arrived in a few minutes, look in your spam folder.';
}, 10, 2);
