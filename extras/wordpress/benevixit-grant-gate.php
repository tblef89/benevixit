<?php
/**
 * Plugin Name: Bene Vixit Grant Gate
 * Description: mu-plugin — verifies the HMAC access grant minted by the Gate Worker
 * before allowing the gated product to be viewed or purchased. Install by copying
 * into wp-content/mu-plugins/ and defining BV_GRANT_SECRET in wp-config.php
 * (same value as the Worker's GRANT_SECRET).
 *
 * Token format (must match src/gate/grant.js):
 *   base64url(JSON payload) . base64url(HMAC-SHA256(payloadB64, secret))
 *   payload: { v: 1, e: edition, iat, exp }
 */

defined('ABSPATH') || exit;

const BV_COOKIE = 'bv_grant';
const BV_GATED_PRODUCT_SLUGS = ['herringbone-cap']; // keep in sync with the shop

function bv_b64url_decode(string $s): string|false {
    return base64_decode(strtr($s, '-_', '+/'));
}

function bv_verify_grant(?string $token): bool {
    if (!$token || !defined('BV_GRANT_SECRET')) {
        return false;
    }
    $parts = explode('.', $token);
    if (count($parts) !== 2) {
        return false;
    }
    [$body, $sig] = $parts;
    $expected = hash_hmac('sha256', $body, BV_GRANT_SECRET, true);
    $given = bv_b64url_decode($sig);
    if ($given === false || !hash_equals($expected, $given)) {
        return false;
    }
    $payload = json_decode(bv_b64url_decode($body), true);
    return is_array($payload) && ($payload['exp'] ?? 0) >= time();
}

// Accept ?bv_grant=... once, then persist as a session cookie for checkout.
add_action('init', function () {
    if (isset($_GET[BV_COOKIE]) && bv_verify_grant(wp_unslash($_GET[BV_COOKIE]))) {
        setcookie(BV_COOKIE, wp_unslash($_GET[BV_COOKIE]), [
            'expires' => 0, // session cookie; the token carries its own expiry
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $_COOKIE[BV_COOKIE] = wp_unslash($_GET[BV_COOKIE]);
    }
});

function bv_has_access(): bool {
    return bv_verify_grant($_COOKIE[BV_COOKIE] ?? null);
}

// Gate the product page itself.
add_action('template_redirect', function () {
    if (is_singular('product') && in_array(get_post_field('post_name'), BV_GATED_PRODUCT_SLUGS, true) && !bv_has_access()) {
        wp_redirect(home_url('/?door=shut'));
        exit;
    }
});

// Belt and braces: gate add-to-cart too, in case of direct cart URLs.
add_filter('woocommerce_add_to_cart_validation', function ($passed, $product_id) {
    $slug = get_post_field('post_name', $product_id);
    if (in_array($slug, BV_GATED_PRODUCT_SLUGS, true) && !bv_has_access()) {
        wc_add_notice('the door is shut.', 'error');
        return false;
    }
    return $passed;
}, 10, 2);
