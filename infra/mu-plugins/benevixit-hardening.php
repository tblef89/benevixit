<?php
/**
 * Plugin Name: Bene Vixit Hardening
 * Description: Closes the doors WordPress leaves open by default that this
 * shop never uses. Each one either names an account to guess a password for,
 * or lets a password be guessed in bulk.
 *
 * - XML-RPC off. Nothing here uses it (no Jetpack, no mobile app), and one
 *   request to it can carry hundreds of login attempts (system.multicall).
 *   Caddy also answers /xmlrpc.php with a 404 before it reaches WordPress.
 * - The REST API's user routes (/wp/v2/users…) answer only an administrator.
 *   By default they list every user with a published post, login slug
 *   included, to anyone.
 * - No user sitemap, and no author name in oEmbed responses: both name the
 *   account that owns the products.
 *
 * Verified by infra/audit.sh (PUB-1, PUB-2, PUB-3).
 */

defined('ABSPATH') || exit;

add_filter('xmlrpc_enabled', '__return_false');
add_filter('xmlrpc_methods', '__return_empty_array');
add_filter('wp_headers', function ($headers) {
    unset($headers['X-Pingback']);
    return $headers;
});
add_filter('pings_open', '__return_false');

// Checked at dispatch, when authentication is settled: a cookie without a
// valid REST nonce has been reduced to "logged out" by then.
add_filter('rest_pre_dispatch', function ($result, $server, $request) {
    $route = $request->get_route();
    if (preg_match('#^/wp/v2/users(/|$)#', $route) && !current_user_can('list_users')) {
        return new WP_Error('rest_no_route', 'No route was found matching the URL and request method.', ['status' => 404]);
    }
    return $result;
}, 10, 3);

add_filter('wp_sitemaps_add_provider', function ($provider, $name) {
    return $name === 'users' ? false : $provider;
}, 10, 2);

add_filter('oembed_response_data', function ($data) {
    unset($data['author_name'], $data['author_url']);
    return $data;
});
