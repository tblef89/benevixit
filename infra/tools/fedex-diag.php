<?php
/**
 * FedEx fulfilment diagnostic. Read-only.
 *
 * Compares the newest Hold-at-Location order with the newest address order,
 * and prints the FedEx plugin's code around its "Manual Service Selection"
 * box. Prints field and key names, method names and yes/no flags; never a
 * name, address, phone number or email.
 *
 *   cd /opt/benevixit/infra && docker compose exec -T wordpress php < tools/fedex-diag.php
 *
 * One order in detail (FedEx's error text, how its suggested address
 * differs; personal values redacted):
 *   docker compose exec -T -e BV_ORDER=36 wordpress php < tools/fedex-diag.php
 */
$_SERVER['HTTP_HOST'] = 'benevixit.com';
require '/var/www/html/wp-load.php';

if (!getenv('BV_ORDER')) {
    $latest = [];
    foreach (wc_get_orders(['limit' => 40, 'orderby' => 'date', 'order' => 'DESC', 'type' => 'shop_order']) as $o) {
        $mode = $o->get_meta('_bv_delivery') ?: 'unknown';
        if (!isset($latest[$mode])) $latest[$mode] = $o;
    }
    foreach (['hal', 'address'] as $mode) {
        echo "\n=== newest {$mode} order ===\n";
        $o = $latest[$mode] ?? null;
        if (!$o) { echo "none found\n"; continue; }
        echo "id #{$o->get_id()}  status {$o->get_status()}  purged " . ($o->get_meta('_bv_purged') ? 'YES' : 'no') . "\n";
        $filled = [];
        foreach (['first_name','last_name','company','address_1','address_2','city','state','postcode','country','phone'] as $f) {
            $g = "get_shipping_{$f}";
            $filled[] = $f . '=' . (method_exists($o, $g) && trim((string) $o->$g('edit')) !== '' ? 'yes' : '-');
        }
        echo "shipping fields filled: " . implode(' ', $filled) . "\n";
        echo "shipping country: " . $o->get_shipping_country('edit') . "\n";
        foreach ($o->get_shipping_methods() as $item) {
            echo "shipping line: method_id=" . $item->get_method_id() . " instance=" . $item->get_instance_id() . " title=\"" . $item->get_method_title() . "\"\n";
            $keys = array_map(fn ($m) => $m->key, $item->get_meta_data());
            echo "  line meta keys: " . ($keys ? implode(', ', $keys) : '(none)') . "\n";
        }
        $keys = array_unique(array_map(fn ($m) => $m->key, $o->get_meta_data()));
        sort($keys);
        echo "order meta keys: " . implode(', ', $keys) . "\n";
    }

    echo "\n=== FedEx plugin: where Manual Service Selection is built ===\n";
    $dir = WP_PLUGIN_DIR;
    $hits = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->getExtension() !== 'php' || stripos($f->getPathname(), 'fedex') === false) continue;
        $src = file_get_contents($f->getPathname());
        if (stripos($src, 'Manual Service') !== false) $hits[] = $f->getPathname();
    }
    foreach ($hits as $path) {
        echo "\n--- " . substr($path, strlen($dir) + 1) . "\n";
        $lines = file($path);
        foreach ($lines as $n => $line) {
            if (stripos($line, 'Manual Service') === false) continue;
            $from = max(0, $n - 30); $to = min(count($lines) - 1, $n + 30);
            for ($i = $from; $i <= $to; $i++) printf("%5d  %s", $i + 1, $lines[$i]);
            echo "  ...\n";
        }
    }
    if (!$hits) echo "no file mentions 'Manual Service'\n";
}

// ── One order in detail: BV_ORDER=<id> ──────────────────────────────────
// FedEx's error text and how its suggested address differs from the
// order's, with every value the order holds about the person redacted.
$id = (int) getenv('BV_ORDER');
if ($id && ($o = wc_get_order($id))) {
    echo "\n=== order #{$id} in detail ===\n";
    $mine = [];
    foreach (['billing', 'shipping'] as $type) {
        foreach (['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'postcode', 'phone', 'email'] as $f) {
            $g = "get_{$type}_{$f}";
            if (method_exists($o, $g) && strlen(trim((string) $o->$g('edit'))) >= 3) $mine[] = trim((string) $o->$g('edit'));
        }
    }
    usort($mine, fn ($a, $b) => strlen($b) - strlen($a));
    $redact = function ($s) use ($mine) {
        $s = (string) $s;
        foreach ($mine as $v) $s = str_ireplace($v, '[redacted]', $s);
        return preg_replace('/\d{3,}/', '[n]', $s);
    };
    $err = $o->get_meta('wf_woo_fedex_shipmentErrorMessage');
    echo "FedEx error message: " . ($err === '' || $err === null ? '(empty)' : $redact(is_scalar($err) ? $err : wp_json_encode($err))) . "\n";

    $sugg = $o->get_meta('ph_fedex_suggested_address');
    if (is_string($sugg) && ($d = json_decode($sugg, true)) !== null) $sugg = $d;
    if (is_object($sugg)) $sugg = json_decode(wp_json_encode($sugg), true);
    echo "suggested address: " . (empty($sugg) ? '(empty)' : '') . "\n";
    if (is_array($sugg)) {
        $ship = [
            'address_1' => $o->get_shipping_address_1('edit'), 'address_2' => $o->get_shipping_address_2('edit'),
            'city' => $o->get_shipping_city('edit'), 'state' => $o->get_shipping_state('edit'),
            'postcode' => $o->get_shipping_postcode('edit'), 'country' => $o->get_shipping_country('edit'),
        ];
        $walk = function ($a, $path) use (&$walk, $ship) {
            foreach ($a as $k => $v) {
                $p = $path === '' ? (string) $k : "{$path}.{$k}";
                if (is_array($v)) { $walk($v, $p); continue; }
                $v = (string) $v;
                if (preg_match('/resident|classif|type|status|state|country|match|score|valid/i', $k) && strlen($v) <= 20 && !preg_match('/\d{3,}/', $v)) {
                    echo "  {$p} = {$v}\n";
                    continue;
                }
                $same = [];
                foreach ($ship as $f => $mv) {
                    if ($mv !== '' && strcasecmp(trim($mv), trim($v)) === 0) $same[] = $f;
                }
                echo "  {$p} = " . ($same ? 'same as order ' . implode('/', $same) : '[differs or extra, ' . strlen($v) . ' chars]') . "\n";
            }
        };
        $walk($sugg, '');
    }
    echo "rates response saved: " . ($o->get_meta('ph_fedex_rates_response') ? 'yes' : 'no') . "\n";
}
