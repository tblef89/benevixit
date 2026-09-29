<?php
/**
 * Plugin Name: Bene Vixit Shopkeeper
 * Description: Two switches for when the shopkeeper is away (WooCommerce →
 * Shopkeeper): a notice every visitor clicks through once, and collection in
 * person as a third way to receive an order (a conference, say).
 *
 * The away notice is a card over the shop, product, cart and checkout
 * pages, in the letterhead's paper and ink. It shows once per browser tab
 * session: sessionStorage remembers that this message was read, so a new
 * message shows again. Nothing is sent anywhere. Its first line is the
 * heading; each further line is a paragraph.
 *
 * Collection in person (see benevixit-checkout.php, mode "pickup") asks for
 * an email address and nothing else. The order number is what the buyer
 * gives at the table. The pickup note is shown on that choice at checkout
 * and in the order emails.
 */

defined('ABSPATH') || exit;

const BV_AWAY_DEFAULT = "The Shopkeeper is away.\nShipping will resume November 11th. Pickup is available for Zcon attendees.";
const BV_PICKUP_DEFAULT = 'At Zcon: find the shopkeeper and give your order number.';

function bv_away_on() {
    return get_option('bv_away_on') === 'yes';
}

// The message as lines: [heading, paragraph, …], empty lines dropped.
function bv_away_lines() {
    $text = (string) get_option('bv_away_message', BV_AWAY_DEFAULT);
    $lines = array_values(array_filter(array_map('trim', preg_split('/\R/', $text)), 'strlen'));
    return $lines ?: array_values(array_filter(array_map('trim', preg_split('/\R/', BV_AWAY_DEFAULT)), 'strlen'));
}

function bv_pickup_enabled() {
    return get_option('bv_pickup_on') === 'yes';
}

function bv_pickup_note() {
    $note = trim((string) get_option('bv_pickup_note', BV_PICKUP_DEFAULT));
    return $note !== '' ? $note : BV_PICKUP_DEFAULT;
}

// ── Settings: WooCommerce → Shopkeeper ──

add_action('admin_init', function () {
    $yes_no = function ($v) {
        return $v === 'yes' ? 'yes' : 'no';
    };
    $text = function ($v) {
        return sanitize_textarea_field((string) $v);
    };
    register_setting('bv_shopkeeper', 'bv_away_on', ['type' => 'string', 'sanitize_callback' => $yes_no, 'default' => 'no']);
    register_setting('bv_shopkeeper', 'bv_away_message', ['type' => 'string', 'sanitize_callback' => $text, 'default' => BV_AWAY_DEFAULT]);
    register_setting('bv_shopkeeper', 'bv_pickup_on', ['type' => 'string', 'sanitize_callback' => $yes_no, 'default' => 'no']);
    register_setting('bv_shopkeeper', 'bv_pickup_note', ['type' => 'string', 'sanitize_callback' => $text, 'default' => BV_PICKUP_DEFAULT]);
});

// register_setting() files the page under manage_options; the page itself
// asks for manage_woocommerce, so the save must too.
add_filter('option_page_capability_bv_shopkeeper', function () {
    return 'manage_woocommerce';
});

add_action('admin_menu', function () {
    add_submenu_page('woocommerce', 'Shopkeeper', 'Shopkeeper', 'manage_woocommerce', 'bv-shopkeeper', 'bv_shopkeeper_page');
}, 60);

function bv_shopkeeper_page() {
    if (!current_user_can('manage_woocommerce')) {
        return;
    }
    ?>
    <div class="wrap">
      <h1>Shopkeeper</h1>
      <form method="post" action="options.php">
        <?php settings_fields('bv_shopkeeper'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row">Away notice</th>
            <td>
              <label><input type="checkbox" name="bv_away_on" value="yes" <?php checked(bv_away_on()); ?>> Show the notice on the shop</label>
              <p class="description">Every visitor clicks through it once, on the first shop page they open.</p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="bv_away_message">Message</label></th>
            <td>
              <textarea id="bv_away_message" name="bv_away_message" rows="4" class="large-text"><?php echo esc_textarea((string) get_option('bv_away_message', BV_AWAY_DEFAULT)); ?></textarea>
              <p class="description">The first line is the heading. Each further line is its own paragraph.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">Collection in person</th>
            <td>
              <label><input type="checkbox" name="bv_pickup_on" value="yes" <?php checked(bv_pickup_enabled()); ?>> Offer it at checkout</label>
              <p class="description">A third choice beside FedEx: the buyer gives an email address and nothing else.</p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="bv_pickup_note">Pickup note</label></th>
            <td>
              <textarea id="bv_pickup_note" name="bv_pickup_note" rows="2" class="large-text"><?php echo esc_textarea(bv_pickup_note()); ?></textarea>
              <p class="description">Shown on that choice at checkout (followed by "Only your email is needed.") and in the buyer's order emails.</p>
            </td>
          </tr>
        </table>
        <?php submit_button(); ?>
      </form>
    </div>
    <?php
}

// ── The away card ──

function bv_away_applies() {
    if (!bv_away_on() || is_admin()) {
        return false;
    }
    return (function_exists('is_woocommerce') && is_woocommerce())
        || (function_exists('is_cart') && is_cart())
        || (function_exists('is_checkout') && is_checkout());
}

add_action('wp_footer', function () {
    if (!bv_away_applies()) {
        return;
    }
    $lines = bv_away_lines();
    $heading = array_shift($lines);
    // Seen-marker per message: a new message is shown again.
    $key = 'bv-away:' . substr(md5(implode("\n", bv_away_lines())), 0, 12);
    ?>
    <div class="bv-away" id="bv-away" role="dialog" aria-modal="true" aria-labelledby="bv-away-h" hidden>
      <div class="bv-away-sheet">
        <span class="crest bv-away-crest" aria-hidden="true">
          <svg viewBox="0 0 439.45 825.07" focusable="false"><image href="/art/key.svg" width="439.45" height="825.07" filter="url(#bv-emboss-day)"/></svg>
        </span>
        <h2 class="bv-away-h" id="bv-away-h"><?php echo esc_html($heading); ?></h2>
        <?php foreach ($lines as $line) : ?>
          <p class="bv-away-p"><?php echo esc_html($line); ?></p>
        <?php endforeach; ?>
        <button type="button" class="bv-away-go">Continue</button>
      </div>
    </div>
    <script>
    (function () {
      var el = document.getElementById('bv-away');
      if (!el) return;
      var KEY = <?php echo wp_json_encode($key); ?>;
      try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}
      var btn = el.querySelector('.bv-away-go');
      var before = document.activeElement;
      function close() {
        try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
        el.hidden = true;
        document.documentElement.classList.remove('bv-away-open');
        document.removeEventListener('keydown', key, true);
        if (before && before.focus) before.focus();
      }
      function key(e) {
        if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') { e.preventDefault(); btn.focus(); }
      }
      btn.addEventListener('click', close);
      document.addEventListener('keydown', key, true);
      el.hidden = false;
      document.documentElement.classList.add('bv-away-open');
      btn.focus();
    })();
    </script>
    <?php
}, 5);
