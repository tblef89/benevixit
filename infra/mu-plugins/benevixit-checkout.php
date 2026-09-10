<?php
/**
 * Plugin Name: Bene Vixit Checkout Slimming
 * Description: ZEC-only checkout. Billing addresses exist for card networks —
 * we have none. The visitor gives us an email, a ZIP, and then ONE of two
 * things, never both: a legal name (held at a FedEx location, ID checked at
 * the counter) or an address (delivered; any name on the parcel).
 *
 * The billing ADDRESS fields still exist, hidden and mirrored from the
 * shipping fields as the visitor types: WooCommerce and shipping plugins
 * (PluginHive FedEx's Hold-at-Location lookup lives in the billing group and
 * keys off the billing postcode) read the billing address, and an absent
 * field reads as an empty one.
 *
 * Layout is the theme's job (theme/style.css, "Checkout: one thing, never
 * both"): the DOM WooCommerce renders is left intact; this file only adds
 * the choice cards, per-mode labels, and the validation that goes with them.
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

// Shipping fields a Hold-at-Location order does not need.
const BV_ADDRESS_ONLY_KEYS = ['shipping_address_1', 'shipping_city', 'shipping_state'];

// The retention promise shown under the choice. Empty until the automated
// purge (issue #45) is live — a promise on the page must be kept by
// machinery, not memory.
const BV_RETENTION_PROMISE = '';

// The visitor's choice, from the posted checkout data (also present in the
// order-review refresh, where WooCommerce posts the serialized form).
function bv_delivery_mode(array $posted = null) {
    if ($posted === null) {
        if (isset($_POST['bv_delivery'])) {
            $posted = ['bv_delivery' => wp_unslash($_POST['bv_delivery'])];
        } elseif (isset($_POST['post_data'])) {
            parse_str(wp_unslash($_POST['post_data']), $posted);
        } else {
            $posted = [];
        }
    }
    return ($posted['bv_delivery'] ?? 'hal') === 'address' ? 'address' : 'hal';
}

// Which posted key carries the chosen Hold-at-Location, if any. PluginHive's
// field key is matched by suffix so a rename upstream does not break us.
function bv_posted_hal_choice(array $data) {
    foreach ($data as $key => $value) {
        if (is_string($key) && preg_match('/hold_at_location$/i', $key) && is_scalar($value) && trim((string) $value) !== '') {
            return (string) $value;
        }
    }
    return '';
}

add_filter('woocommerce_checkout_fields', function ($fields) {
    // Billing: the email (visible) plus the address fields (hidden, optional,
    // filled by the mirror).
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
    // PluginHive's Hold-at-Location field is injected into the billing group;
    // keep anything we did not author.
    foreach ($fields['billing'] as $name => $field) {
        if (!isset($billing[$name]) && strpos($name, 'billing_') !== 0) {
            $field['label'] = 'nearby FedEx locations';
            $billing[$name] = $field;
        }
    }
    $fields['billing'] = $billing;

    // Shipping: labels that speak for whichever choice is made. The two
    // spans are shown/hidden by the theme with the mode class.
    $s = &$fields['shipping'];
    if (isset($s['shipping_first_name'])) {
        $s['shipping_first_name']['label'] = '<span class="bv-lbl-hal">legal first name, as on your ID</span><span class="bv-lbl-addr">a first name for the parcel</span>';
    }
    if (isset($s['shipping_last_name'])) {
        $s['shipping_last_name']['label'] = '<span class="bv-lbl-hal">legal last name</span><span class="bv-lbl-addr">a last name</span>';
    }
    if (isset($s['shipping_postcode'])) {
        $s['shipping_postcode']['label'] = 'zip code <small>— for nearby locations and rates</small>';
        $s['shipping_postcode']['required'] = true;
    }
    if (isset($s['shipping_phone'])) {
        $s['shipping_phone']['label'] = '<span class="bv-lbl-hal">phone (optional) <small>— FedEx texts you when it is ready</small></span><span class="bv-lbl-addr">phone (optional)</span>';
        $s['shipping_phone']['required'] = false;
    }
    if (isset($s['shipping_address_1'])) {
        $s['shipping_address_1']['label'] = 'street address';
        $s['shipping_address_1']['placeholder'] = 'house number and street name';
    }
    if (isset($s['shipping_address_2'])) {
        $s['shipping_address_2']['label'] = 'apartment, suite, unit (optional)';
        $s['shipping_address_2']['placeholder'] = '';
    }
    if (isset($s['shipping_country'])) {
        $s['shipping_country']['label'] = 'country';
    }
    if (isset($s['shipping_city'])) {
        $s['shipping_city']['label'] = 'town / city';
    }
    if (isset($s['shipping_state'])) {
        $s['shipping_state']['label'] = 'state';
    }
    unset($s);

    unset($fields['order']['order_comments']);
    return $fields;
});

// The shipping form is always the address form — no "different address?"
// toggle (the checkbox itself is hidden by the theme).
add_filter('woocommerce_ship_to_different_address_checked', '__return_true');

// The mode class on <body>, set server-side (HAL by default) so the layout
// is right before — or without — any script; the checkout script toggles it.
add_filter('body_class', function ($classes) {
    if (function_exists('is_checkout') && is_checkout()) {
        $classes[] = 'bv-mode-' . (bv_delivery_mode() === 'address' ? 'addr' : 'hal');
    }
    return $classes;
});

// The choice: two cards after the billing fields, inside the same grid.
add_action('woocommerce_after_checkout_billing_form', function () {
    $mode = bv_delivery_mode();
    ?>
    <div class="bv-mode">
      <h3 class="bv-h" id="bv-h-mode">how should it reach you <small>one of these, never both.</small></h3>
      <label class="bv-card<?php echo $mode === 'hal' ? ' is-chosen' : ''; ?>" id="bv-card-hal">
        <input type="radio" name="bv_delivery" value="hal" <?php checked($mode, 'hal'); ?>>
        <span class="bv-card-title">hold at a FedEx location</span>
        <p>Use your legal name, which FedEx will verify with your ID at pickup. No need to share your address.</p>
      </label>
      <label class="bv-card<?php echo $mode === 'address' ? ' is-chosen' : ''; ?>" id="bv-card-addr">
        <input type="radio" name="bv_delivery" value="address" <?php checked($mode, 'address'); ?>>
        <span class="bv-card-title">deliver to an address</span>
        <p>Tell us the address you'd like it delivered. Exact legal name not required.</p>
      </label>
    </div>
    <?php
});

// The retention promise, once it is kept by the purge job (issue #45).
add_action('woocommerce_after_checkout_shipping_form', function () {
    if (BV_RETENTION_PROMISE !== '') {
        echo '<p id="bv-promise">' . esc_html(BV_RETENTION_PROMISE) . '</p>';
    }
});

// Validation: under Hold-at-Location the street/town/state are not needed
// (FedEx delivers to the location) but a location must be chosen; under
// delivery WooCommerce's own address requirements stand.
add_action('woocommerce_after_checkout_validation', function ($data, $errors) {
    if (bv_delivery_mode($data) !== 'hal') {
        return;
    }
    foreach (BV_ADDRESS_ONLY_KEYS as $key) {
        $errors->remove($key . '_required');
        $errors->remove($key . '_validation');
    }
    if (bv_posted_hal_choice($data) === '' && bv_posted_hal_choice($_POST) === '') {
        $errors->add('bv_hal_required', 'choose a FedEx location to hold it — enter your zip code and pick one from the list.');
    }
}, 10, 2);

// Server side: at order placement, billing takes the shipping address
// wherever billing is empty, so orders carry a consistent address even if
// the browser-side mirror never ran.
add_filter('woocommerce_checkout_posted_data', function ($data) {
    foreach (BV_MIRRORED_ADDRESS_KEYS as $key) {
        if (empty($data['billing_' . $key]) && !empty($data['shipping_' . $key])) {
            $data['billing_' . $key] = $data['shipping_' . $key];
        }
    }
    return $data;
});

// Remember the choice on the order, for fulfilment.
add_action('woocommerce_checkout_create_order', function ($order, $data) {
    $order->update_meta_data('_bv_delivery', bv_delivery_mode($data));
}, 10, 2);

// Browser side: toggle the mode class on the form, and keep the hidden
// billing fields equal to the shipping fields. Country is copied first
// (WooCommerce rebuilds the state list on that change), then the rest; each
// copy fires `change` so listeners on the billing fields — WooCommerce's
// order-review refresh, the FedEx Hold-at-Location lookup — see the update.
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
  function applyMode() {
    var form = $('form.checkout');
    var mode = form.find('input[name="bv_delivery"]:checked').val() || 'hal';
    $(document.body).toggleClass('bv-mode-hal', mode === 'hal').toggleClass('bv-mode-addr', mode === 'address');
    $('#bv-card-hal').toggleClass('is-chosen', mode === 'hal');
    $('#bv-card-addr').toggleClass('is-chosen', mode === 'address');
    // Street/town/state are only demanded of a delivery.
    ['#shipping_address_1_field', '#shipping_city_field', '#shipping_state_field'].forEach(function (sel) {
      $(sel).toggleClass('validate-required', mode === 'address');
    });
  }
  $(function () {
    var form = $('form.checkout');
    if (!form.length) return;
    KEYS.forEach(function (k) {
      form.on('change input', '#shipping_' + k, syncAll);
    });
    form.on('change', 'input[name="bv_delivery"]', function () {
      applyMode();
      $(document.body).trigger('update_checkout');
    });
    $(document.body).on('updated_checkout', function () { syncAll(); applyMode(); });
    syncAll();
    applyMode();
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
