<?php
/**
 * Refunded, in full or in part.
 *
 * Overrides WooCommerce's templates/emails/customer-refunded-order.php. The copy is ours and
 * lives here, not in WooCommerce → Settings → Emails: the heading and
 * subject come from theme/emails.php, and the "additional content" setting
 * is not printed. No salutation: the letter is about the order, and the
 * name on it is sometimes a legal name given only for the FedEx counter.
 * Every hook the core template fires is fired here too.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 9.8.0
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);
?>
<?php if ($partial_refund) : ?>
	<p>We have refunded part of your order, in ZEC. The amounts are below.</p>
<?php else : ?>
	<p>We have refunded your order in full, in ZEC.</p>
<?php endif; ?>
<?php
do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_customer_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_footer', $email);
