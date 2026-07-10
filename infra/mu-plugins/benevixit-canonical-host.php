<?php
/**
 * Plugin Name: Bene Vixit Canonical Host
 * Description: Direct browser visits to the origin hostname (shop.benevixit.com)
 * are 301'd to the canonical benevixit.com, where all assets are same-origin.
 * A page viewed on the raw origin loads its stylesheet from benevixit.com,
 * making fonts and mask images cross-origin — browsers block those without
 * CORS, which erases the watermark and breaks typography.
 *
 * Worker proxy traffic is stamped with X-BV-Proxy and exempted; so are
 * non-GET requests and machine endpoints (CipherPay webhooks, cron, REST).
 */

defined('ABSPATH') || exit;

/**
 * The Worker stamps proxied requests with a secret handshake token derived
 * from the shared grant secret. Compute the same token; only a request
 * bearing it is treated as genuine Worker proxy traffic.
 */
function bv_expected_proxy_token() {
    if (!defined('BV_GRANT_SECRET')) {
        return null;
    }
    $raw = hash_hmac('sha256', 'bv-proxy-v1', BV_GRANT_SECRET, true);
    $b64 = rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    return substr($b64, 0, 32);
}

add_action('init', function () {
    $expected = bv_expected_proxy_token();
    $presented = $_SERVER['HTTP_X_BV_PROXY'] ?? '';
    if ($expected !== null && $presented !== '' && hash_equals($expected, $presented)) {
        return; // genuine Worker proxy traffic — never redirect
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        return; // webhooks and form posts must land where they were aimed
    }
    $host = strtolower($_SERVER['HTTP_HOST'] ?? '');
    $canonical_host = parse_url(home_url(), PHP_URL_HOST);
    if ($host === '' || $host === $canonical_host) {
        return;
    }
    $path = $_SERVER['REQUEST_URI'] ?? '/';
    if (strpos($path, '/wc-api/') === 0 || strpos($path, '/wp-cron.php') === 0 || strpos($path, '/wp-json/') === 0) {
        return; // machine endpoints stay put
    }
    wp_redirect(home_url($path), 301);
    exit;
});
