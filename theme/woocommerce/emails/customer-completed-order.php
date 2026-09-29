<?php
/**
 * On its way: the order is marked Completed once the parcel is with FedEx.
 *
 * Overrides WooCommerce's templates/emails/customer-completed-order.php. The copy is ours and
 * lives here, not in WooCommerce → Settings → Emails: the heading and
 * subject come from theme/emails.php, and the "additional content" setting
 * is not printed. No salutation: the letter is about the order, and the
 * name on it is sometimes a legal name given only for the FedEx counter.
 * Every hook the core template fires is fired here too.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 9.9.0
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);
?>
<?php if ($order->get_meta('_bv_delivery') === 'pickup') : ?>
	<p>Your order has been collected. Thank you.</p>
<?php elseif ($order->get_meta('_bv_delivery') === 'hal') : ?>
	<p>Your order is with FedEx, on its way to the counter below. They will hold it for you.</p>
<?php else : ?>
	<p>Your order is with FedEx, on its way to you.</p>
<?php endif; ?>
<?php
do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_customer_details', $order, $sent_to_admin, $plain_text, $email);

$promise = $order->get_meta('_bv_delivery') === 'pickup' ? '' : bv_email_retention_promise();
if ($promise) {
    echo '<p class="bv-promise">' . esc_html($promise) . '</p>';
}

do_action('woocommerce_email_footer', $email);
