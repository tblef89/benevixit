<?php
/**
 * Paid in full: the payment has confirmed (CipherPay marks the order Processing).
 *
 * Overrides WooCommerce's templates/emails/customer-processing-order.php. The copy is ours and
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
	<p>Your payment has confirmed. Your order is set aside for you: collect it in person and give your order number, <?php echo esc_html($order->get_order_number()); ?>.</p>
<?php else : ?>
	<p>Your payment has confirmed. We will pack your order and write again when it is with FedEx.</p>
<?php endif; ?>
<?php
do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_customer_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_footer', $email);
