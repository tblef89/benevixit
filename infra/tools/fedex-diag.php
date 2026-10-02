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
 */
$_SERVER['HTTP_HOST'] = 'benevixit.com';
require '/var/www/html/wp-load.php';

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
