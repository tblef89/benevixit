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
 *
 * A Hold-at-Location order ends up with the FedEx location as its shipping
 * address (see woocommerce_checkout_order_processed below): the shipping
 * plugin ships to whatever the order's shipping address says, and FedEx
 * requires a street, a city and a phone on every hold shipment.
 *
 * Two WooCommerce behaviours shape how this is written:
 *  - address-i18n.js re-applies the *locale* label, placeholder and required
 *    state to address_1/address_2/city/state/postcode/country/phone every
 *    time a country is set (including on load), and un-hides them with an
 *    inline style. So those labels are set through the locale
 *    (woocommerce_default_address_fields), not woocommerce_checkout_fields,
 *    and the theme hides fields with !important.
 *  - WooCommerce registers its scripts on wp_enqueue_scripts at priority 10;
 *    an mu-plugin's callback at the same priority runs first, and an inline
 *    script attached to a not-yet-registered handle is silently dropped.
 *    Ours attaches at priority 20.
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

// Address fields whose labels WooCommerce's locale script owns.
const BV_LOCALE_KEYS = ['address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'];

// The retention promise shown under the choice. A promise on the page must
// be kept by machinery, not memory: it appears only while the purge job
// (benevixit-purge.php, issue #45) has run in the last two hours without a
// failure, and disappears by itself if that stops being true.
const BV_RETENTION_PROMISE = 'We delete all shipping information from our records within one week of delivery.';

function bv_is_checkout() {
    return function_exists('is_checkout') && is_checkout();
}

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
    $mode = (string) ($posted['bv_delivery'] ?? 'hal');
    if ($mode === 'address') {
        return 'address';
    }
    // Collection in person exists only while the shopkeeper offers it
    // (WooCommerce → Shopkeeper); a stale form asking for it gets HAL.
    if ($mode === 'pickup' && function_exists('bv_pickup_enabled') && bv_pickup_enabled()) {
        return 'pickup';
    }
    return 'hal';
}

function bv_mode_class($mode) {
    return ['hal' => 'hal', 'address' => 'addr', 'pickup' => 'pickup'][$mode] ?? 'hal';
}

// Which posted key carries the chosen Hold-at-Location, if any. PluginHive's
// field key is matched loosely so a rename upstream does not break us.
function bv_is_hal_key($key) {
    return is_string($key) && preg_match('/hold[_-]?at[_-]?location/i', $key);
}

function bv_posted_hal_choice(array $data) {
    foreach ($data as $key => $value) {
        if (bv_is_hal_key($key) && is_scalar($value) && trim((string) $value) !== '') {
            return (string) $value;
        }
    }
    return '';
}

// A label that reads for whichever choice is made; the theme shows the span
// for the current mode. bv_plain_label() picks the right one for messages.
function bv_mode_label($hal, $addr) {
    return '<span class="bv-lbl-hal">' . $hal . '</span><span class="bv-lbl-addr">' . $addr . '</span>';
}

function bv_plain_label($label, $mode = null) {
    $mode = $mode ?: bv_delivery_mode();
    if (preg_match('/<span class="bv-lbl-' . ($mode === 'hal' ? 'hal' : 'addr') . '">(.*?)<\/span>/', $label, $m)) {
        $label = $m[1];
    }
    return trim(wp_strip_all_tags($label));
}

// Address labels, through the locale so the browser-side locale script
// (which rewrites them on load and on every country change) agrees with the
// server-rendered form.
add_filter('woocommerce_default_address_fields', function ($fields) {
    if (!bv_is_checkout()) {
        return $fields;
    }
    $labels = [
        'address_1' => 'Street address',
        'address_2' => 'Apartment, suite, unit (optional)',
        'city'      => 'Town / city',
        'state'     => 'State',
        'postcode'  => 'ZIP code',
        'country'   => 'Country',
        'phone'     => bv_mode_label('Phone <small>— FedEx texts you when it is ready to collect</small>', 'Phone (optional)'),
    ];
    foreach ($labels as $key => $label) {
        if (!isset($fields[$key])) {
            continue;
        }
        $fields[$key]['label'] = $label;
        // A visible label, not a placeholder standing in for one.
        $fields[$key]['label_class'] = [];
        $fields[$key]['placeholder'] = $key === 'address_1' ? 'House number and street name' : '';
    }
    if (isset($fields['phone'])) {
        $fields['phone']['required'] = false;
    }
    if (isset($fields['postcode'])) {
        $fields['postcode']['required'] = true;
        $fields['postcode']['description'] = 'For nearby FedEx locations and rates';
    }
    return $fields;
});

// Countries may override those labels ("ZIP Code", "State" for the US, and
// so on); on the checkout ours stand for every country.
add_filter('woocommerce_get_country_locale', function ($locale) {
    if (!bv_is_checkout()) {
        return $locale;
    }
    foreach ($locale as $country => $fields) {
        if (!is_array($fields)) {
            continue;
        }
        foreach (BV_LOCALE_KEYS as $key) {
            unset($locale[$country][$key]['label'], $locale[$country][$key]['placeholder']);
        }
    }
    return $locale;
});

add_filter('woocommerce_checkout_fields', function ($fields) {
    // Billing: the email (visible) plus the address fields (hidden, optional,
    // filled by the mirror).
    $email = $fields['billing']['billing_email'];
    $email['label'] = 'Email for order updates';
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
            $billing[$name] = $field;
        }
    }
    $fields['billing'] = $billing;

    // Shipping: names that speak for whichever choice is made. (The address
    // labels come through the locale, above.)
    $s = &$fields['shipping'];
    if (isset($s['shipping_first_name'])) {
        $s['shipping_first_name']['label'] = bv_mode_label('Legal first name, as on your ID', 'A first name for the parcel');
    }
    if (isset($s['shipping_last_name'])) {
        $s['shipping_last_name']['label'] = bv_mode_label('Legal last name', 'A last name');
    }
    if (isset($s['shipping_postcode'])) {
        $s['shipping_postcode']['required'] = true;
    }
    if (isset($s['shipping_phone'])) {
        $s['shipping_phone']['required'] = false;
    }
    unset($s);

    unset($fields['order']['order_comments']);
    return $fields;
});

// The Hold-at-Location field, in our voice — whenever and however the
// shipping plugin adds it.
add_filter('woocommerce_checkout_fields', function ($fields) {
    foreach (['billing', 'shipping'] as $group) {
        foreach ($fields[$group] ?? [] as $name => $field) {
            if (bv_is_hal_key($name)) {
                $fields[$group][$name]['label'] = 'Nearby FedEx locations';
            }
        }
    }
    return $fields;
}, PHP_INT_MAX);

// The shipping form is always the address form — no "different address?"
// toggle (the checkbox itself is hidden by the theme).
add_filter('woocommerce_ship_to_different_address_checked', '__return_true');

// No coupons: nothing to "click here to enter" on the cart or the checkout.
add_filter('woocommerce_coupons_enabled', '__return_false');

// The mode class on <body>, set server-side (HAL by default) so the layout
// is right before — or without — any script; the checkout script toggles it.
add_filter('body_class', function ($classes) {
    if (bv_is_checkout()) {
        $classes[] = 'bv-mode-' . bv_mode_class(bv_delivery_mode());
    }
    return $classes;
});

// The choice: two cards after the billing fields, inside the same grid.
add_action('woocommerce_after_checkout_billing_form', function () {
    $mode = bv_delivery_mode();
    ?>
    <div class="bv-mode">
      <h3 class="bv-h" id="bv-h-mode">How should it reach you <small><?php echo function_exists('bv_pickup_enabled') && bv_pickup_enabled() ? 'Choose one.' : 'One of these, never both.'; ?></small></h3>
      <label class="bv-card<?php echo $mode === 'hal' ? ' is-chosen' : ''; ?>" id="bv-card-hal">
        <input type="radio" name="bv_delivery" value="hal" <?php checked($mode, 'hal'); ?>>
        <span class="bv-card-title">Hold at a FedEx location</span>
        <span class="bv-card-text">Use your legal name, which FedEx will verify with your ID at pickup. No need to share your address.</span>
      </label>
      <label class="bv-card<?php echo $mode === 'address' ? ' is-chosen' : ''; ?>" id="bv-card-addr">
        <input type="radio" name="bv_delivery" value="address" <?php checked($mode, 'address'); ?>>
        <span class="bv-card-title">Deliver to an address</span>
        <span class="bv-card-text">Tell us the address you'd like it delivered. Exact legal name not required.</span>
      </label>
      <?php if (function_exists('bv_pickup_enabled') && bv_pickup_enabled()) : ?>
      <label class="bv-card<?php echo $mode === 'pickup' ? ' is-chosen' : ''; ?>" id="bv-card-pick">
        <input type="radio" name="bv_delivery" value="pickup" <?php checked($mode, 'pickup'); ?>>
        <span class="bv-card-title">Collect in person</span>
        <span class="bv-card-text"><?php echo esc_html(bv_pickup_note()); ?> Only your email is needed.</span>
      </label>
      <?php endif; ?>
    </div>
    <?php
});

// The retention promise, while the purge job is keeping it.
add_action('woocommerce_after_checkout_shipping_form', function () {
    if (BV_RETENTION_PROMISE !== '' && function_exists('bv_purge_is_live') && bv_purge_is_live()) {
        // The theme hides it while "Collect in person" is chosen: there is
        // no shipping information to delete.
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
        $errors->add('bv_hal_required', 'Choose a FedEx location to hold it — enter your ZIP code and pick one from the list.');
    }
    // FedEx will not create a Hold-at-Location shipment without a recipient
    // phone number: it is how they say the parcel is ready.
    if (trim((string) ($data['shipping_phone'] ?? '')) === '') {
        $errors->add('bv_hal_phone_required', 'A phone number is needed for a FedEx pickup — FedEx texts you when it is ready to collect.');
    }
}, 10, 2);

// The chosen location, as the shipping plugin posts and saves it:
// "Name, Street[, Street 2], City, ST, ZIP, CC" — or the same without the
// name, as its order screen shows it. Returns null unless it parses cleanly.
function bv_parse_hal_location($value) {
    $parts = array_map('trim', explode(',', (string) $value));
    if (count($parts) < 5) {
        return null;
    }
    $country  = strtoupper(array_pop($parts));
    $postcode = array_pop($parts);
    $state    = strtoupper(array_pop($parts));
    $city     = array_pop($parts);
    // What is left is the street, preceded by the location's name unless
    // the first part already starts with a house number.
    $name = '';
    if (count($parts) > 1 && !preg_match('/^\d/', $parts[0])) {
        $name = array_shift($parts);
    }
    $street = implode(', ', $parts);
    if ($street === '' || $city === '' || !preg_match('/^[A-Z]{2}$/', $country) || !preg_match('/^[A-Z0-9 -]{3,10}$/', $postcode)) {
        return null;
    }
    return [
        'company'   => sanitize_text_field($name),
        'address_1' => sanitize_text_field($street),
        'city'      => sanitize_text_field($city),
        'state'     => sanitize_text_field($state),
        'postcode'  => sanitize_text_field($postcode),
        'country'   => sanitize_text_field($country),
    ];
}

// A Hold-at-Location order ships TO the FedEx location: the shipping plugin
// sends the order's shipping address as the recipient (with the hold as a
// special service on top), and FedEx rejects an empty street, city or
// phone. So once the order exists, the location's address becomes the
// order's shipping (and hidden billing) address, with the location's name
// as the company line — which is what a hold label reads anyway. The
// visitor's own address was never asked for.
//
// This runs at the very end of checkout processing, on a copy of the order
// read back from the database, so that whatever the shipping plugin saved
// — through its own order object, or as post meta — is visible. Every
// candidate value (saved meta first, then the posted field) is tried until
// one parses as an address.
add_action('woocommerce_checkout_order_processed', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order || $order->get_meta('_bv_delivery') !== 'hal') {
        return;
    }
    $candidates = [];
    foreach ($order->get_meta_data() as $meta) {
        if (bv_is_hal_key($meta->key) && is_scalar($meta->value) && trim((string) $meta->value) !== '') {
            $candidates['meta ' . $meta->key] = (string) $meta->value;
        }
    }
    foreach ($_POST as $key => $value) {
        if (bv_is_hal_key($key) && is_scalar($value) && trim((string) $value) !== '') {
            $candidates['posted ' . $key] = wp_unslash((string) $value);
        }
    }
    $loc = null;
    $source = '';
    foreach ($candidates as $source => $raw) {
        $loc = bv_parse_hal_location($raw);
        if ($loc !== null) {
            break;
        }
    }
    if ($loc === null) {
        $seen = [];
        foreach ($candidates as $source => $raw) {
            $seen[] = $source . ' = "' . sanitize_text_field($raw) . '"';
        }
        $order->add_order_note('bene vixit: could not read the FedEx location into the shipping address — fill it in by hand before creating the shipment. ' . ($seen ? 'Seen: ' . implode('; ', $seen) : 'No location value was found on the order or in the posted checkout.'));
        $order->save();
        return;
    }
    foreach (['shipping', 'billing'] as $type) {
        foreach ($loc as $key => $value) {
            $setter = "set_{$type}_{$key}";
            if (method_exists($order, $setter)) {
                $order->{$setter}($value);
            }
        }
    }
    $order->set_shipping_address_2('');
    $order->set_billing_address_2('');
    $order->add_order_note('bene vixit: Hold at Location — shipping address set to ' . $loc['company'] . ', ' . $loc['address_1'] . ', ' . $loc['city'] . ' ' . $loc['state'] . ' ' . $loc['postcode'] . ' (from ' . $source . ').');
    $order->save();
}, 100);

// Collection in person: the cart ships nothing, so WooCommerce asks for no
// shipping address or method and adds no shipping line (the order-review
// refresh posts the choice too, so the totals follow it). Whatever a browser
// autofilled into the hidden fields is dropped before the order is written:
// the order keeps the email address and nothing else about the buyer.
add_filter('woocommerce_cart_needs_shipping', function ($needs) {
    return (bv_is_checkout() || wp_doing_ajax()) && bv_delivery_mode() === 'pickup' ? false : $needs;
});

add_filter('woocommerce_checkout_posted_data', function ($data) {
    if (bv_delivery_mode($data) !== 'pickup') {
        return $data;
    }
    foreach ($data as $key => $value) {
        if ((strpos($key, 'shipping_') === 0 || strpos($key, 'billing_') === 0 || bv_is_hal_key($key)) && $key !== 'billing_email') {
            $data[$key] = '';
        }
    }
    $data['ship_to_different_address'] = false;
    return $data;
}, 20);

add_action('woocommerce_checkout_order_processed', function ($order_id) {
    $order = wc_get_order($order_id);
    if ($order && $order->get_meta('_bv_delivery') === 'pickup') {
        $order->add_order_note('bene vixit: collect in person. The buyer gives order number ' . $order->get_order_number() . '.');
    }
}, 100);

// "… is a required field" with the label as the visitor read it, not the
// markup behind it.
add_filter('woocommerce_checkout_required_field_notice', function ($notice, $label) {
    return sprintf('%s is a required field.', '<strong>' . esc_html(bv_plain_label((string) $label)) . '</strong>');
}, 10, 2);

// The delivery choice is our own radio, not a WooCommerce checkout field,
// so WooCommerce leaves it out of the posted data it hands to validation
// and order creation. Without this, every order was taken for a FedEx hold:
// "Deliver to an address" failed validation (asked for a FedEx location)
// and the order recorded the wrong choice. Priority 1: before anything
// else reads the data.
add_filter('woocommerce_checkout_posted_data', function ($data) {
    if (isset($_POST['bv_delivery']) && is_string($_POST['bv_delivery'])) {
        $data['bv_delivery'] = sanitize_key(wp_unslash($_POST['bv_delivery']));
    }
    return $data;
}, 1);

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

// Browser side: toggle the mode class on the body, place the shipping
// plugin's location field in the grid, and keep the hidden billing fields
// equal to the shipping fields. Country is copied first (WooCommerce
// rebuilds the state list on that change), then the rest; each copy fires
// `change` so listeners on the billing fields — WooCommerce's order-review
// refresh, the FedEx Hold-at-Location lookup — see the update.
function bv_checkout_script() {
    $keys = wp_json_encode(BV_MIRRORED_ADDRESS_KEYS);
    return <<<JS
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
  // The grid item that carries `el`: the first ancestor under the grid that
  // is not a display:contents wrapper.
  function gridItem(el, root) {
    var chain = [], e;
    for (e = el; e && e !== root; e = e.parentElement) chain.push(e);
    if (e !== root) return null;
    for (var i = chain.length - 1; i >= 0; i--) {
      if (getComputedStyle(chain[i]).display !== 'contents') return chain[i];
    }
    return el;
  }
  // The shipping plugin's Hold-at-Location field, wherever it put it.
  function markLocation() {
    var root = document.getElementById('customer_details');
    if (!root) return;
    var el = root.querySelector('[name*="hold_at_location"], [id*="hold_at_location"], [name*="hold-at-location"], [id*="hold-at-location"]');
    if (!el) {
      $(root).find('label').each(function () {
        if (!el && /hold[_ -]?at[_ -]?location/i.test($(this).text())) el = this;
      });
    }
    if (!el) return;
    var item = gridItem(el, root);
    if (!item || item === root) return;
    $(root).find('.bv-loc').not(item).removeClass('bv-loc');
    $(item).addClass('bv-loc');
  }
  function applyMode() {
    var mode = $('form.checkout input[name="bv_delivery"]:checked').val() || 'hal';
    var hal = mode === 'hal', addr = mode === 'address', pick = mode === 'pickup';
    $(document.body).toggleClass('bv-mode-hal', hal).toggleClass('bv-mode-addr', addr).toggleClass('bv-mode-pickup', pick);
    $('#bv-card-hal').toggleClass('is-chosen', hal);
    $('#bv-card-addr').toggleClass('is-chosen', addr);
    $('#bv-card-pick').toggleClass('is-chosen', pick);
    // Street/town/state are only demanded of a delivery; the phone only of
    // a FedEx hold (FedEx needs it to say the parcel is ready); the ZIP of
    // anything FedEx carries. A collection in person asks for none of it.
    ['#shipping_address_1_field', '#shipping_city_field', '#shipping_state_field'].forEach(function (sel) {
      $(sel).toggleClass('validate-required', addr);
    });
    $('#shipping_phone_field').toggleClass('validate-required', hal);
    $('#shipping_postcode_field').toggleClass('validate-required', !pick);
    markLocation();
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
    $(document.body)
      .on('updated_checkout', function () { syncAll(); applyMode(); })
      .on('country_to_state_changed', applyMode);
    syncAll();
    applyMode();
  });
})(window.jQuery);
JS;
}

// Priority 20: after WooCommerce has registered wc-checkout (priority 10).
add_action('wp_enqueue_scripts', function () {
    if (!bv_is_checkout()) {
        return;
    }
    if (wp_script_is('wc-checkout', 'registered')) {
        wp_add_inline_script('wc-checkout', bv_checkout_script());
        return;
    }
    // Belt and braces: print it ourselves if the handle is not there.
    add_action('wp_print_footer_scripts', function () {
        echo '<script>' . bv_checkout_script() . '</script>' . "\n";
    }, 20);
}, 20);

add_action('wp_head', function () {
    if (!bv_is_checkout()) {
        return;
    }
    echo '<style>.woocommerce-checkout .form-row.bv-mirror{display:none !important}</style>' . "\n";
});

// Nothing about the buyer goes to CipherPay. Its WooCommerce plugin (v1.0.2,
// class-wc-gateway-cipherpay.php) sends the billing name and the full
// shipping address with every invoice, as shipping_alias, shipping_address
// and shipping_region. Its server has no such fields and discards them
// (cipherpay-api, CreateInvoiceRequest), but they would still cross the wire
// and sit in any log or proxy along the way. This removes them from the
// request body before WordPress sends it; the invoice needs only the amount,
// the currency and the product name.
const BV_CIPHERPAY_STRIP = ['shipping_alias', 'shipping_address', 'shipping_region'];

add_filter('http_request_args', function ($args, $url) {
    if (strtoupper($args['method'] ?? '') !== 'POST') {
        return $args;
    }
    $path = (string) parse_url((string) $url, PHP_URL_PATH);
    if (!preg_match('#/api/invoices/?$#', $path) || !is_string($args['body'] ?? null)) {
        return $args;
    }
    $body = json_decode($args['body'], true);
    if (!is_array($body)) {
        return $args;
    }
    $kept = array_diff_key($body, array_flip(BV_CIPHERPAY_STRIP));
    if ($kept !== $body) {
        $args['body'] = wp_json_encode($kept);
    }
    return $args;
}, 10, 2);

// Copy in voice.
add_filter('gettext', function ($translated, $text, $domain) {
    if ($domain === 'woocommerce') {
        $replacements = [
            'Ship to a different address?' => 'Where should we send it',
            'Billing details' => 'Your details',
            'Place order' => 'Send ZEC',
            'Proceed to Checkout' => 'Proceed to checkout',
        ];
        return $replacements[$text] ?? $translated;
    }
    // The shipping plugin's strings, whatever text domain they use.
    if ($text === 'FedEx Hold at Location') {
        return 'Nearby FedEx locations';
    }
    if ($text === 'Select FedEx Hold at Location') {
        return 'Choose a location';
    }
    return $translated;
}, 10, 3);

// The cart block draws its button in the browser, from WooCommerce's
// JavaScript strings, which the gettext filter above never sees. Its label
// is translated when the script loads, so the override is set on wp-i18n,
// which every block script loads first.
add_action('wp_enqueue_scripts', function () {
    $strings = [
        'Proceed to Checkout' => ['Proceed to checkout'],
    ];
    wp_add_inline_script(
        'wp-i18n',
        'wp.i18n.setLocaleData(' . wp_json_encode($strings) . ', "woocommerce");',
        'after'
    );
});
