<?php
/**
 * Where the parcel goes: one block, never two.
 *
 * Overrides WooCommerce's templates/emails/email-addresses.php. The billing
 * address is a hidden mirror of the shipping address (see the checkout
 * mu-plugin), so printing both would print the same place twice. A
 * Hold-at-Location order shows the counter and the name FedEx will check;
 * a delivery shows the address.
 *
 * Mail sent to us (the new-order notice) carries no address, name, email or
 * phone at all: the order in wp-admin has them until the purge takes them,
 * and a mailbox would keep them for good.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 9.8.0
 */

defined('ABSPATH') || exit;

if ($sent_to_admin || !$order->needs_shipping_address() || !$order->has_shipping_address()) {
    return;
}

$hal  = $order->get_meta('_bv_delivery') === 'hal';
$name = trim($order->get_shipping_first_name() . ' ' . $order->get_shipping_last_name());

if ($hal) {
    $place = WC()->countries->get_formatted_address([
        'company'   => $order->get_shipping_company(),
        'address_1' => $order->get_shipping_address_1(),
        'address_2' => $order->get_shipping_address_2(),
        'city'      => $order->get_shipping_city(),
        'state'     => $order->get_shipping_state(),
        'postcode'  => $order->get_shipping_postcode(),
        'country'   => $order->get_shipping_country(),
    ]);
} else {
    $place = $order->get_formatted_shipping_address();
}
?>
<div class="bv-address">
	<p class="bv-label"><?php echo $hal ? 'Where to collect it' : 'Where it’s going'; ?></p>
	<p class="bv-address-lines"><?php echo wp_kses_post($place); ?></p>
	<?php if ($hal && $name) : ?>
		<p>Held for <?php echo esc_html($name); ?>. Bring an ID that matches.</p>
	<?php endif; ?>
</div>
