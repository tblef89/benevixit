<?php
/**
 * Plugin Name: Bene Vixit Purge
 * Description: Shipping information is deleted seven days after an order is
 * done with — by machinery, not memory (issue #45).
 *
 * What goes: every name, address, phone and email on the order (billing and
 * shipping, including the hidden billing mirror), the customer's IP address
 * and browser, the chosen FedEx Hold-at-Location, FedEx label and shipment
 * data that carries the recipient, order-attribution data, every order note,
 * and the customer's row in WooCommerce's analytics lookup table.
 *
 * What stays: items, totals, taxes, payment status and the ZEC transaction
 * id, the delivery choice (hold or address), the FedEx tracking number, and
 * the dates. Accounting needs the order; it does not need the person.
 *
 * When: within seven days of Completed; of the last change for Cancelled,
 * Failed and Refunded; of creation for an order that was never paid
 * (Pending). The job runs hourly and takes each order a couple of hours
 * before its seven days are up, so a late or missed run still lands inside
 * the week. Processing and On hold orders are never touched. WooCommerce
 * logs are kept seven days too.
 *
 * How: an hourly Action Scheduler job (visible under WooCommerce → Status →
 * Scheduled actions, group "bene-vixit"). Each order goes through
 * WooCommerce's own privacy eraser — the same code as Tools → Erase
 * personal data, which also lets other plugins erase their share — with
 * three additions: FedEx/HAL meta by key and by content, the shipping
 * line's item meta, and any leftover copies in the other order-storage
 * tables, so the database holds no second copy whichever storage is
 * authoritative. Orders are marked `_bv_purged`; re-running is harmless.
 * Nothing but order ids and counts is ever logged.
 *
 * Audit: /wp-admin/?bv_purge=preview (administrators) lists what the next
 * run will purge — order ids and meta key names, never values — and what
 * comes due after. `wp bv purge [--dry-run]` does the same where WP-CLI is
 * available. A single order can be purged early from its Order actions.
 */

defined('ABSPATH') || exit;

use Automattic\WooCommerce\Utilities\OrderUtil;

const BV_PURGE_DAYS = 7;
const BV_PURGE_INTERVAL = HOUR_IN_SECONDS;
const BV_PURGE_HOOK = 'bv_purge_run';
const BV_PURGE_ONE_HOOK = 'bv_purge_order_now';
const BV_PURGE_GROUP = 'bene-vixit';
const BV_PURGE_DONE_KEY = '_bv_purged';
const BV_PURGE_TRACKING_KEY = '_bv_fedex_tracking';
const BV_PURGE_LAST_RUN = 'bv_purge_last_run';

// Which statuses are purged, and which date starts their clock.
function bv_purge_rules() {
    return [
        'completed'      => 'date_completed',
        'cancelled'      => 'date_modified',
        'failed'         => 'date_modified',
        'refunded'       => 'date_modified',
        'pending'        => 'date_created',
        'checkout-draft' => 'date_created',
    ];
}

// How long after its clock starts an order is purged: two runs short of
// seven days, so even with one run late or missed, every order is gone
// before its week is out.
function bv_purge_window() {
    return BV_PURGE_DAYS * DAY_IN_SECONDS - 2 * BV_PURGE_INTERVAL;
}

// ── Scheduling ──────────────────────────────────────────────────────────

// Checked on admin and scheduler requests only; the storefront never pays for it.
add_action('init', function () {
    if (!(is_admin() || wp_doing_cron() || (defined('WP_CLI') && WP_CLI))) {
        return;
    }
    if (!function_exists('as_has_scheduled_action') || get_transient('bv_purge_scheduled')) {
        return;
    }
    if (!as_has_scheduled_action(BV_PURGE_HOOK, [], BV_PURGE_GROUP)) {
        as_schedule_recurring_action(time() + 10 * MINUTE_IN_SECONDS, BV_PURGE_INTERVAL, BV_PURGE_HOOK, [], BV_PURGE_GROUP);
    }
    set_transient('bv_purge_scheduled', 1, 12 * HOUR_IN_SECONDS);
}, 20);

add_action(BV_PURGE_HOOK, function () {
    bv_purge_run(false);
});

add_action(BV_PURGE_ONE_HOOK, function ($order_id) {
    $report = bv_purge_order((int) $order_id, false);
    error_log('bv-purge: order ' . (int) $order_id . ($report ? ' purged on request' : ' not found'));
});

// WooCommerce logs (which, with a shipping plugin's debug mode on, hold
// whole FedEx requests) are kept no longer than orders are.
add_filter('woocommerce_logger_days_to_retain_logs', function () {
    return BV_PURGE_DAYS;
});

// ── Which orders ────────────────────────────────────────────────────────

function bv_purge_hpos() {
    return class_exists(OrderUtil::class) && OrderUtil::custom_orders_table_usage_is_enabled();
}

// Ids of orders already purged, in one query on whichever meta table the
// orders live in (WooCommerce's classic store ignores meta filters in order
// queries, so exclusion is done here).
function bv_purge_done_ids() {
    global $wpdb;
    if (bv_purge_hpos()) {
        $sql = "SELECT DISTINCT order_id FROM {$wpdb->prefix}wc_orders_meta WHERE meta_key = %s";
    } else {
        $sql = "SELECT DISTINCT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s";
    }
    return array_map('intval', $wpdb->get_col($wpdb->prepare($sql, BV_PURGE_DONE_KEY)));
}

// Order ids matching a query, a page at a time.
function bv_purge_order_ids(array $query) {
    $ids = [];
    for ($page = 1; ; $page++) {
        $batch = wc_get_orders($query + ['type' => 'shop_order', 'limit' => 200, 'paged' => $page, 'return' => 'ids', 'orderby' => 'ID', 'order' => 'ASC']);
        foreach ($batch as $id) {
            $ids[] = (int) $id;
        }
        if (count($batch) < 200) {
            return $ids;
        }
    }
}

// Orders whose clock has run out and that are not yet purged, oldest first.
function bv_purge_due_ids($now = null) {
    $cutoff = ($now ?: time()) - bv_purge_window();
    $ids = [];
    foreach (bv_purge_rules() as $status => $date_key) {
        $ids = array_merge($ids, bv_purge_order_ids(['status' => [$status], $date_key => '<' . $cutoff]));
    }
    $ids = array_diff(array_unique($ids), bv_purge_done_ids());
    sort($ids);
    return array_values($ids);
}

// Orders that will come due, with the date each will be purged.
function bv_purge_upcoming($now = null) {
    $now = $now ?: time();
    $cutoff = $now - bv_purge_window();
    $done = bv_purge_done_ids();
    $out = [];
    foreach (bv_purge_rules() as $status => $date_key) {
        foreach (bv_purge_order_ids(['status' => [$status], $date_key => '>=' . $cutoff]) as $id) {
            $order = in_array($id, $done, true) ? null : wc_get_order($id);
            if (!$order) {
                continue;
            }
            $getter = 'get_' . $date_key;
            $start = $order->{$getter}();
            if ($start) {
                $out[$order->get_id()] = [$status, $start->getTimestamp() + bv_purge_window()];
            }
        }
    }
    ksort($out);
    return $out;
}

// ── What, on one order ──────────────────────────────────────────────────

function bv_purge_is_hal_key($key) {
    return is_string($key) && preg_match('/hold[_-]?at[_-]?location/i', $key);
}

// Every value on the order that identifies the person or where the parcel
// went. Anything else on the order that contains one of these is theirs.
function bv_purge_needles(WC_Order $order) {
    $values = [
        $order->get_billing_email('edit'),
        $order->get_customer_ip_address('edit'),
        trim($order->get_shipping_first_name('edit') . ' ' . $order->get_shipping_last_name('edit')),
        trim($order->get_billing_first_name('edit') . ' ' . $order->get_billing_last_name('edit')),
    ];
    foreach (['billing', 'shipping'] as $type) {
        foreach (['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'postcode', 'phone'] as $field) {
            $getter = "get_{$type}_{$field}";
            if (method_exists($order, $getter)) {
                $values[] = $order->{$getter}('edit');
            }
        }
    }
    foreach ($order->get_meta_data() as $meta) {
        if (bv_purge_is_hal_key($meta->key) && is_scalar($meta->value)) {
            $values[] = $meta->value;
            foreach (explode(',', (string) $meta->value) as $part) {
                $values[] = $part;
            }
        }
    }
    $placeholders = ['[deleted]', 'deleted@site.invalid', '0.0.0.0', '::'];
    $needles = [];
    foreach ($values as $value) {
        $value = trim((string) $value);
        if (mb_strlen($value) < 3 || in_array(strtolower($value), $placeholders, true) || preg_match('/^0+$/', $value)) {
            continue;
        }
        $needles[strtolower($value)] = $value;
    }
    return array_values($needles);
}

function bv_purge_haystack($value) {
    if (is_scalar($value)) {
        return (string) $value;
    }
    $json = wp_json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return $json !== false ? $json : maybe_serialize($value);
}

// Whole-word, case-insensitive: "Tom" is found in "Tom Lefevre", not in "Custom".
function bv_purge_mentions($haystack, array $needles) {
    if ($haystack === '') {
        return false;
    }
    foreach ($needles as $needle) {
        if (preg_match('/(?<![\p{L}\p{N}])' . preg_quote($needle, '/') . '(?![\p{L}\p{N}])/iu', $haystack)) {
            return true;
        }
    }
    return false;
}

// Should this order meta go? Our own bookkeeping stays; the HAL choice,
// labels and order attribution always go; anything else goes if it
// mentions the person or the address.
function bv_purge_meta_goes($key, $value, array $needles) {
    if (in_array($key, ['_bv_delivery', BV_PURGE_DONE_KEY, BV_PURGE_TRACKING_KEY], true)) {
        return false;
    }
    if (bv_purge_is_hal_key($key) || preg_match('/label/i', $key) || strpos($key, '_wc_order_attribution_') === 0) {
        return true;
    }
    return bv_purge_mentions(bv_purge_haystack($value), $needles);
}

// FedEx tracking numbers inside data about to be deleted, so the number
// itself survives the purge.
function bv_purge_tracking_numbers($value) {
    $found = [];
    if (is_scalar($value) && preg_match('/^\d{12,22}$/', trim((string) $value))) {
        $found[] = trim((string) $value);
    }
    if (preg_match_all('/"tracking(?:Number|_number)"\s*:\s*"(\d{12,22})"/i', bv_purge_haystack($value), $m)) {
        $found = array_merge($found, $m[1]);
    }
    return $found;
}

/**
 * Purge one order. With $dry_run, report what would go and change nothing.
 * Returns a report of counts and key names — never values — or null if the
 * order does not exist.
 */
function bv_purge_order($order, $dry_run = false) {
    $order = $order instanceof WC_Order ? $order : wc_get_order($order);
    if (!$order || $order->get_type() !== 'shop_order') {
        return null;
    }
    $needles = bv_purge_needles($order);
    $report = [
        'id'        => $order->get_id(),
        'status'    => $order->get_status(),
        'meta'      => [],
        'item_meta' => [],
        'notes'     => count(wc_get_order_notes(['order_id' => $order->get_id()])),
        'tracking'  => [],
    ];

    foreach ($order->get_meta_data() as $meta) {
        if (bv_purge_meta_goes($meta->key, $meta->value, $needles)) {
            $report['meta'][] = $meta->key;
            $report['tracking'] = array_merge($report['tracking'], bv_purge_tracking_numbers($meta->value));
        }
    }
    $items = [];
    foreach ($order->get_items('shipping') as $item) {
        foreach ($item->get_meta_data() as $meta) {
            if (bv_purge_mentions(bv_purge_haystack($meta->value), $needles) || bv_purge_is_hal_key($meta->key)) {
                $report['item_meta'][] = $meta->key;
                $items[$item->get_id()][] = $meta->key;
            }
        }
    }
    $report['meta'] = array_values(array_unique($report['meta']));
    $report['tracking'] = array_values(array_unique($report['tracking']));
    if ($dry_run) {
        return $report;
    }

    // 1. What WooCommerce's eraser does not know about.
    foreach ($report['meta'] as $key) {
        $order->delete_meta_data($key);
    }
    foreach ($items as $item_id => $keys) {
        $item = $order->get_item($item_id);
        if ($item) {
            foreach ($keys as $key) {
                $item->delete_meta_data($key);
            }
            $item->save();
        }
    }
    if ($report['tracking']) {
        $kept = array_filter(array_map('trim', explode(',', (string) $order->get_meta(BV_PURGE_TRACKING_KEY))));
        $order->update_meta_data(BV_PURGE_TRACKING_KEY, implode(', ', array_unique(array_merge($kept, $report['tracking']))));
    }
    $order->save();

    // 2. WooCommerce's own eraser: every name, address, phone and email on
    //    the order, the IP address and browser, every order note, the
    //    analytics customer row, and whatever other plugins hook in. The
    //    ZEC transaction id is kept for the books.
    if (!class_exists('WC_Privacy_Erasers') && defined('WC_ABSPATH')) {
        include_once WC_ABSPATH . 'includes/class-wc-privacy-erasers.php';
    }
    $keep_transaction = function ($props) {
        unset($props['transaction_id']);
        return $props;
    };
    add_filter('woocommerce_privacy_remove_order_personal_data_props', $keep_transaction);
    try {
        WC_Privacy_Erasers::remove_order_personal_data($order);
    } finally {
        remove_filter('woocommerce_privacy_remove_order_personal_data_props', $keep_transaction);
    }
    $lookup = 'Automattic\\WooCommerce\\Admin\\API\\Reports\\Customers\\DataStore';
    if (class_exists($lookup) && !has_action('woocommerce_privacy_remove_order_personal_data', [$lookup, 'anonymize_customer'])) {
        $lookup::anonymize_customer($order);
    }

    // 3. Copies in the storage WooCommerce is not currently using.
    bv_purge_other_storage($order, $needles, $report['meta']);

    $order->update_meta_data(BV_PURGE_DONE_KEY, gmdate('c'));
    $order->add_order_note(
        'bene vixit: shipping information purged under the ' . BV_PURGE_DAYS . '-day retention rule.'
        . ($report['tracking'] ? ' FedEx tracking kept: ' . implode(', ', $report['tracking']) . '.' : '')
    );
    $order->save();
    return $report;
}

// WooCommerce keeps orders either in posts/postmeta or in its own order
// tables, and may hold a second copy in the other (compatibility sync, or
// data left from before a switch). Overwrite that copy's core fields with
// what the eraser left on the order, then delete from its meta anything
// the purge removed from the order itself, or that still mentions the
// person — so no second copy survives, whichever store is authoritative.
function bv_purge_other_storage(WC_Order $order, array $needles, array $gone_keys) {
    global $wpdb;
    $id = $order->get_id();
    $fields = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'];

    $postmeta = [
        '_customer_ip_address' => (string) $order->get_customer_ip_address('edit'),
        '_customer_user_agent' => (string) $order->get_customer_user_agent('edit'),
        '_billing_email'       => (string) $order->get_billing_email('edit'),
    ];
    foreach (['billing', 'shipping'] as $type) {
        foreach ($fields as $field) {
            $getter = "get_{$type}_{$field}";
            $postmeta["_{$type}_{$field}"] = (string) $order->{$getter}('edit');
        }
    }
    $postmeta['_billing_address_index'] = '';
    $postmeta['_shipping_address_index'] = '';
    foreach ($postmeta as $key => $value) {
        $wpdb->query($wpdb->prepare(
            "UPDATE {$wpdb->postmeta} SET meta_value = %s WHERE post_id = %d AND meta_key = %s",
            $value, $id, $key
        ));
    }

    $orders_table = $wpdb->prefix . 'wc_orders';
    $address_table = $wpdb->prefix . 'wc_order_addresses';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $address_table)) === $address_table) {
        foreach (['billing', 'shipping'] as $type) {
            $values = [];
            foreach ($fields as $field) {
                $getter = "get_{$type}_{$field}";
                $values[] = (string) $order->{$getter}('edit');
            }
            $values[] = $type === 'billing' ? (string) $order->get_billing_email('edit') : '';
            $values[] = $id;
            $values[] = $type;
            $wpdb->query($wpdb->prepare(
                "UPDATE {$address_table} SET first_name = %s, last_name = %s, company = %s, address_1 = %s, address_2 = %s,
                 city = %s, state = %s, postcode = %s, country = %s, phone = %s, email = %s
                 WHERE order_id = %d AND address_type = %s",
                $values
            ));
        }
    }
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $orders_table)) === $orders_table) {
        $wpdb->query($wpdb->prepare(
            "UPDATE {$orders_table} SET billing_email = %s, ip_address = %s, user_agent = %s WHERE id = %d",
            (string) $order->get_billing_email('edit'),
            (string) $order->get_customer_ip_address('edit'),
            (string) $order->get_customer_user_agent('edit'),
            $id
        ));
    }

    // The inactive store's meta: plugin data (the HAL choice, labels, FedEx
    // responses) that WooCommerce's CRUD never touches there.
    if (bv_purge_hpos()) {
        $meta_table = $wpdb->postmeta;
        $id_col = 'meta_id';
        $order_col = 'post_id';
    } else {
        $meta_table = $wpdb->prefix . 'wc_orders_meta';
        $id_col = 'id';
        $order_col = 'order_id';
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $meta_table)) !== $meta_table) {
            return;
        }
    }
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT {$id_col} AS row_id, meta_key, meta_value FROM {$meta_table} WHERE {$order_col} = %d",
        $id
    ));
    foreach ($rows as $row) {
        if (in_array($row->meta_key, $gone_keys, true) || bv_purge_meta_goes($row->meta_key, maybe_unserialize($row->meta_value), $needles)) {
            $wpdb->query($wpdb->prepare("DELETE FROM {$meta_table} WHERE {$id_col} = %d", $row->row_id));
        }
    }
}

// ── The run ─────────────────────────────────────────────────────────────

function bv_purge_run($dry_run = false) {
    $ids = bv_purge_due_ids();
    $reports = [];
    $failed = [];
    foreach ($ids as $id) {
        try {
            $report = bv_purge_order($id, $dry_run);
            if ($report) {
                $reports[] = $report;
            }
        } catch (Throwable $e) {
            // The class only: an exception message could quote the data.
            $failed[] = $id;
            error_log('bv-purge: order ' . $id . ' failed (' . get_class($e) . ')');
        }
    }
    if (!$dry_run) {
        update_option(BV_PURGE_LAST_RUN, ['at' => time(), 'purged' => count($reports), 'failed' => count($failed)], false);
        if ($reports || $failed) { // hourly: quiet unless something happened
            error_log('bv-purge: run complete — ' . count($reports) . ' purged'
                . ($reports ? ' (' . implode(', ', array_column($reports, 'id')) . ')' : '')
                . ($failed ? ', ' . count($failed) . ' failed (' . implode(', ', $failed) . ')' : ''));
        }
    }
    return ['reports' => $reports, 'failed' => $failed];
}

// The retention promise may be shown only while this machinery is keeping
// it: the last run finished within the margin bv_purge_window() leaves
// (two runs' worth), and it failed nothing.
function bv_purge_is_live() {
    $last = get_option(BV_PURGE_LAST_RUN);
    return is_array($last)
        && isset($last['at'], $last['failed'])
        && (time() - (int) $last['at']) < 2 * BV_PURGE_INTERVAL
        && (int) $last['failed'] === 0;
}

// ── Doing it early, by hand ─────────────────────────────────────────────

// Order actions → "Purge shipping information now", for anything that is
// not still being fulfilled. Queued, not inline: the order edit screen
// saves the form's address fields after the action runs.
add_filter('woocommerce_order_actions', function ($actions, $order = null) {
    if ($order instanceof WC_Order && in_array($order->get_status(), ['processing', 'on-hold'], true)) {
        return $actions;
    }
    $actions['bv_purge_now'] = 'Purge shipping information now';
    return $actions;
}, 10, 2);

add_action('woocommerce_order_action_bv_purge_now', function ($order) {
    if (function_exists('as_enqueue_async_action')) {
        as_enqueue_async_action(BV_PURGE_ONE_HOOK, [$order->get_id()], BV_PURGE_GROUP);
    } else {
        wp_schedule_single_event(time(), BV_PURGE_ONE_HOOK, [$order->get_id()]);
    }
    $order->add_order_note('bene vixit: shipping information purge queued by hand; it runs within a minute.');
});

// ── Audit ───────────────────────────────────────────────────────────────

function bv_purge_describe(array $report) {
    return '#' . $report['id'] . ' (' . $report['status'] . '): '
        . count($report['meta']) . ' order meta' . ($report['meta'] ? ' [' . implode(', ', $report['meta']) . ']' : '')
        . ', ' . count($report['item_meta']) . ' shipping-line meta' . ($report['item_meta'] ? ' [' . implode(', ', $report['item_meta']) . ']' : '')
        . ', ' . $report['notes'] . ' notes'
        . ($report['tracking'] ? ', tracking kept: ' . implode(', ', $report['tracking']) : '');
}

function bv_purge_status_lines() {
    $next = function_exists('as_next_scheduled_action') ? as_next_scheduled_action(BV_PURGE_HOOK, [], BV_PURGE_GROUP) : false;
    $last = get_option(BV_PURGE_LAST_RUN);
    return [
        'Order storage: ' . (bv_purge_hpos() ? 'WooCommerce order tables' : 'posts and postmeta')
            . (get_option('woocommerce_custom_orders_table_data_sync_enabled') === 'yes' ? ', compatibility sync on' : ''),
        'Next run: ' . (is_int($next) ? gmdate('Y-m-d H:i', $next) . ' UTC' : ($next === true ? 'running now' : 'not scheduled')),
        'Last run: ' . (is_array($last) ? gmdate('Y-m-d H:i', (int) $last['at']) . ' UTC, ' . (int) $last['purged'] . ' purged, ' . (int) $last['failed'] . ' failed' : 'never'),
        'Checkout promise: ' . (bv_purge_is_live() ? 'shown' : 'hidden until a run completes without failures'),
        'WooCommerce logs kept: ' . BV_PURGE_DAYS . ' days',
    ];
}

add_action('admin_init', function () {
    if (!isset($_GET['bv_purge']) || !current_user_can('manage_woocommerce')) {
        return;
    }
    $mode = sanitize_key(wp_unslash($_GET['bv_purge']));
    if ($mode === 'run') {
        check_admin_referer('bv_purge_run');
        $result = bv_purge_run(false);
        $lines = bv_purge_status_lines(); // after the run, so "Last run" is this one
        $lines[] = '<strong>Ran now:</strong> ' . count($result['reports']) . ' purged, ' . count($result['failed']) . ' failed.';
        foreach ($result['reports'] as $report) {
            $lines[] = esc_html(bv_purge_describe($report));
        }
    } else {
        $lines = bv_purge_status_lines();
        $due = bv_purge_run(true);
        $lines[] = '<strong>Due now (' . count($due['reports']) . '):</strong>';
        foreach ($due['reports'] as $report) {
            $lines[] = esc_html(bv_purge_describe($report));
        }
        $upcoming = bv_purge_upcoming();
        $lines[] = '<strong>Coming due (' . count($upcoming) . '):</strong>';
        foreach ($upcoming as $id => [$status, $at]) {
            $lines[] = esc_html('#' . $id . ' (' . $status . '): ' . gmdate('Y-m-d', $at));
        }
        $lines[] = '<a href="' . esc_url(wp_nonce_url(admin_url('?bv_purge=run'), 'bv_purge_run')) . '">Run the purge now</a>';
    }
    wp_die('<h1>Shipping information purge</h1><p>' . implode('</p><p>', $lines) . '</p>', 'Purge', ['response' => 200]);
});

if (defined('WP_CLI') && WP_CLI) {
    /**
     * Purge shipping information from orders past the retention window.
     *
     * [--dry-run]
     * : List what would be purged (order ids and meta key names) and change nothing.
     */
    WP_CLI::add_command('bv purge', function ($args, $assoc) {
        $dry = !empty($assoc['dry-run']);
        foreach (bv_purge_status_lines() as $line) {
            WP_CLI::log($line);
        }
        $result = bv_purge_run($dry);
        foreach ($result['reports'] as $report) {
            WP_CLI::log(($dry ? 'would purge ' : 'purged ') . bv_purge_describe($report));
        }
        foreach ($result['failed'] as $id) {
            WP_CLI::warning('order ' . $id . ' failed');
        }
        WP_CLI::success(count($result['reports']) . ($dry ? ' due' : ' purged'));
    });
}
