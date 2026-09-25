<?php
/**
 * New order, to us: what was bought and how it ships, and nothing about who.
 *
 * Overrides WooCommerce's templates/emails/admin-new-order.php. The name,
 * address, email and phone stay in the order in wp-admin, where the purge
 * deletes them a week after the order is done with; a copy in the keeper's
 * mailbox would outlive that promise. email-addresses.php prints nothing
 * for mail sent to us, and no customer-details block is printed here.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 10.0.0
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);

$hal = $order->get_meta('_bv_delivery') === 'hal';
?>
<p><?php echo $hal ? 'To be held at a FedEx location.' : 'To be delivered to an address.'; ?> The customer’s details are in <a href="<?php echo esc_url($order->get_edit_order_url()); ?>">the order</a>, not in this email.</p>
<?php
do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_footer', $email);
