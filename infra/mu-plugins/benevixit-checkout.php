<?php
/**
 * Plugin Name: Bene Vixit Checkout Slimming
 * Description: ZEC-only checkout. Billing addresses exist for card networks —
 * we have none. Collect a shipping address (it's a physical object) and an
 * email for order updates. Nothing else.
 */

defined('ABSPATH') || exit;

// Strip the billing fieldset down to the email; the shipping fieldset is the
// only address we collect. Order notes go too.
add_filter('woocommerce_checkout_fields', function ($fields) {
    $email = $fields['billing']['billing_email'];
    $email['label'] = 'email for order updates';
    $email['priority'] = 10;
    $fields['billing'] = ['billing_email' => $email];
    unset($fields['order']['order_comments']);
    return $fields;
});

// The shipping form is always the address form — no "different address?"
// toggle (the checkbox itself is hidden by the theme).
add_filter('woocommerce_ship_to_different_address_checked', '__return_true');

// Copy in voice.
add_filter('gettext', function ($translated, $text, $domain) {
    if ($domain !== 'woocommerce') {
        return $translated;
    }
    $replacements = [
        'Ship to a different address?' => 'where should we send it',
        'Billing details' => 'your details',
        'Place order' => 'send zec',
    ];
    return $replacements[$text] ?? $translated;
}, 10, 3);

// A quiet promise, kept by the purge policy.
add_action('woocommerce_before_checkout_shipping_form', function () {
    echo '<p class="bv-ship-note">addresses are forgotten once they have served their purpose.</p>';
});
