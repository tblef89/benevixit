<?php
/**
 * Order items: one line each, the quantity beside the name, the amount on
 * the right.
 *
 * Overrides WooCommerce's templates/emails/email-order-items.php. The item
 * hooks (name, meta start/end, quantity, visibility) all still fire.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 9.9.0
 */

defined('ABSPATH') || exit;

foreach ($items as $item_id => $item) :
    if (!apply_filters('woocommerce_order_item_visible', true, $item)) {
        continue;
    }
    $product       = $item->get_product();
    $sku           = is_object($product) ? $product->get_sku() : '';
    $purchase_note = is_object($product) ? $product->get_purchase_note() : '';

    $qty          = $item->get_quantity();
    $refunded_qty = $order->get_qty_refunded_for_item($item_id);
    $qty_display  = $refunded_qty
        ? '<del>' . esc_html($qty) . '</del> <ins>' . esc_html($qty - ($refunded_qty * -1)) . '</ins>'
        : esc_html($qty);
    ?>
	<tr class="bv-item <?php echo esc_attr(apply_filters('woocommerce_order_item_class', 'order_item', $item, $order)); ?>">
		<td>
			<?php
			echo wp_kses_post(apply_filters('woocommerce_order_item_name', $item->get_name(), $item, false));
			if ($show_sku && $sku) {
				echo wp_kses_post(' (#' . $sku . ')');
			}
			?>
			<span class="bv-qty">&nbsp;&times;&nbsp;<?php echo wp_kses_post(apply_filters('woocommerce_email_order_item_quantity', $qty_display, $item)); ?></span>
			<?php
			do_action('woocommerce_order_item_meta_start', $item_id, $item, $order, $plain_text);
			$meta = wc_display_item_meta($item, [
				'before'       => '',
				'after'        => '',
				'separator'    => '<br>',
				'echo'         => false,
				'label_before' => '<span>',
				'label_after'  => ':</span> ',
			]);
			if ($meta) {
				echo '<div class="bv-item-meta">' . wp_kses($meta, ['br' => [], 'span' => [], 'a' => ['href' => true, 'target' => true, 'rel' => true, 'title' => true]]) . '</div>';
			}
			do_action('woocommerce_order_item_meta_end', $item_id, $item, $order, $plain_text);
			?>
		</td>
		<td class="bv-amount"><?php echo wp_kses_post($order->get_formatted_line_subtotal($item)); ?></td>
	</tr>
	<?php if ($show_purchase_note && $purchase_note) : ?>
		<tr>
			<td colspan="2"><?php echo wp_kses_post(wpautop(do_shortcode($purchase_note))); ?></td>
		</tr>
	<?php endif; ?>
<?php endforeach; ?>
