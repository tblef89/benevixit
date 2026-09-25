<?php
/**
 * Order details: the order, set with air.
 *
 * Overrides WooCommerce's templates/emails/email-order-details.php: no box,
 * hairlines between lines, amounts ranged right, as on the checkout page.
 * Every hook the core template fires is fired here too, so plugins that
 * add to the order table (the shipping plugin's tracking, for one) still
 * appear.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 10.1.0
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_before_order_table', $order, $sent_to_admin, $plain_text, $email);

$number = esc_html($order->get_order_number());
if ($sent_to_admin) {
    $number = '<a href="' . esc_url($order->get_edit_order_url()) . '">' . $number . '</a>';
}
$created = $order->get_date_created();
?>
<p class="bv-label">
	Order <?php echo $number; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
	<?php if ($created) : ?>
		&middot; <time datetime="<?php echo esc_attr($created->format('c')); ?>"><?php echo esc_html(wc_format_datetime($created)); ?></time>
	<?php endif; ?>
</p>
<table class="bv-order" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
	<tbody>
		<?php
		echo wc_get_email_order_items( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			$order,
			[
				'show_sku'      => $sent_to_admin,
				'show_image'    => false,
				'image_size'    => [32, 32],
				'plain_text'    => $plain_text,
				'sent_to_admin' => $sent_to_admin,
			]
		);
		?>
	</tbody>
	<tfoot>
		<?php foreach ($order->get_order_item_totals() as $key => $total) : ?>
			<tr class="bv-total bv-total-<?php echo esc_attr($key); ?>">
				<th scope="row"><?php echo wp_kses_post(rtrim(trim($total['label']), ':')); ?></th>
				<td class="bv-amount"><?php echo wp_kses_post($total['value']); ?></td>
			</tr>
		<?php endforeach; ?>
		<?php if ($order->get_customer_note()) : ?>
			<tr class="bv-note">
				<td colspan="2"><?php echo wp_kses(nl2br(wc_wptexturize_order_note($order->get_customer_note())), ['br' => []]); ?></td>
			</tr>
		<?php endif; ?>
	</tfoot>
</table>
<?php
do_action('woocommerce_email_after_order_table', $order, $sent_to_admin, $plain_text, $email);
