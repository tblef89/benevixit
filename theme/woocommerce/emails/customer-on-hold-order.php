<?php
/**
 * Payment seen: the ZEC has reached the network, not yet confirmed (CipherPay marks the order On hold).
 *
 * Overrides WooCommerce's templates/emails/customer-on-hold-order.php. The copy is ours and
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
<p>Your payment has reached the network and is waiting for confirmation. When it confirms we will write again and begin on your order. There is nothing you need to do.</p>
<?php
do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_customer_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_footer', $email);
