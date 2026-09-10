<?php
/**
 * Plugin Name: Bene Vixit Checkout Slimming
 * Description: ZEC-only checkout. Billing addresses exist for card networks —
 * we have none. Collect a shipping address (it's a physical object) and an
 * email for order updates. Nothing else is shown.
 *
 * The billing ADDRESS fields still exist, hidden and mirrored from the
 * shipping fields as the visitor types: WooCommerce and shipping plugins
 * (PluginHive FedEx's Hold-at-Location lookup lives in the billing group and
 * keys off the billing country/postcode) read the billing address, and an
 * absent field reads as an empty one. The visitor sees only email + shipping.
 */

defined('ABSPATH') || exit;

// shipping_* → billing_* pairs that are kept (hidden) and mirrored.
const BV_MIRRORED_ADDRESS_KEYS = [
    'first_name',
    'last_name',
    'country',
    'address_1',
    'address_2',
    'city',
    'state',
    'postcode',
];

// Billing fieldset: the email (visible) plus the address fields (hidden,
// optional — they are filled by the mirror, never by the visitor). Order
// notes go too.
add_filter('woocommerce_checkout_fields', function ($fields) {
    $email = $fields['billing']['billing_email'];
    $email['label'] = 'email for order updates';
    $email['priority'] = 10;

    $billing = ['billing_email' => $email];
    foreach (BV_MIRRORED_ADDRESS_KEYS as $key) {
        $name = 'billing_' . $key;
        if (!isset($fields['billing'][$name])) {
            continue;
        }
        $field = $fields['billing'][$name];
        $field['required'] = false;
        $field['class'] = array_merge((array) ($field['class'] ?? []), ['bv-mirror']);
        $billing[$name] = $field;
    }
    $fields['billing'] = $billing;

    unset($fields['order']['order_comments']);
    return $fields;
});

// The shipping form is always the address form — no "different address?"
// toggle (the checkbox itself is hidden by the theme).
add_filter('woocommerce_ship_to_different_address_checked', '__return_true');

// Server side: at order placement, billing takes the shipping address
// wherever billing is empty, so orders carry a complete, consistent address
// even if the browser-side mirror never ran.
add_filter('woocommerce_checkout_posted_data', function ($data) {
    foreach (BV_MIRRORED_ADDRESS_KEYS as $key) {
        if (empty($data['billing_' . $key]) && !empty($data['shipping_' . $key])) {
            $data['billing_' . $key] = $data['shipping_' . $key];
        }
    }
    return $data;
});

// Browser side: hide the mirrored billing fields and keep them equal to the
// shipping fields. Country is copied first (WooCommerce rebuilds the state
// list on that change), then the rest; each copy fires `change` so listeners
// on the billing fields — WooCommerce's order-review refresh, the FedEx
// Hold-at-Location lookup — see the update.
add_action('wp_enqueue_scripts', function () {
    if (!function_exists('is_checkout') || !is_checkout()) {
        return;
    }
    $keys = wp_json_encode(BV_MIRRORED_ADDRESS_KEYS);
    $js = <<<JS
(function ($) {
  if (!$) return;
  var KEYS = {$keys};
  var syncing = false;
  function copy(key) {
    var from = $('#shipping_' + key), to = $('#billing_' + key);
    if (!from.length || !to.length) return;
    var v = from.val();
    if (to.val() === v) return;
    to.val(v).trigger('change');
  }
  function syncAll() {
    if (syncing) return;
    syncing = true;
    try {
      copy('country');
      KEYS.forEach(function (k) { if (k !== 'country') copy(k); });
    } finally {
      syncing = false;
    }
  }
  $(function () {
    var form = $('form.checkout');
    if (!form.length) return;
    KEYS.forEach(function (k) {
      form.on('change input', '#shipping_' + k, syncAll);
    });
    // After WooCommerce redraws the order review, make sure nothing drifted.
    $(document.body).on('updated_checkout', syncAll);
    syncAll();
  });
})(window.jQuery);
JS;
    wp_add_inline_script('wc-checkout', $js);
});

add_action('wp_head', function () {
    if (!function_exists('is_checkout') || !is_checkout()) {
        return;
    }
    echo '<style>.woocommerce-checkout .form-row.bv-mirror{display:none !important}</style>' . "\n";
});

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
