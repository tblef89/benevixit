<?php
/**
 * A note from us, added to the order in wp-admin as a note to the customer.
 *
 * Overrides WooCommerce's templates/emails/customer-note.php. The copy is ours and
 * lives here, not in WooCommerce → Settings → Emails: the heading and
 * subject come from theme/emails.php, and the "additional content" setting
 * is not printed. No salutation: the letter is about the order, and the
 * name on it is sometimes a legal name given only for the FedEx counter.
 * Every hook the core template fires is fired here too.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 10.1.0
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);
?>
<div class="bv-quote"><?php echo wp_kses_post(wpautop(wptexturize(make_clickable($customer_note)))); ?></div>
<?php
do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_customer_details', $order, $sent_to_admin, $plain_text, $email);
do_action('woocommerce_email_footer', $email);
