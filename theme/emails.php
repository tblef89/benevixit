<?php
/**
 * Order emails: subjects and headings, in the house voice.
 *
 * The letters themselves are theme/woocommerce/emails/*. The subject and
 * heading settings in WooCommerce → Settings → Emails are overridden here,
 * so the words ship with the code like everything else.
 */

defined('ABSPATH') || exit;

/**
 * [subject, heading] per email id. %s is the order number.
 */
function bv_email_words($id, $email) {
    $words = [
        'customer_on_hold_order'    => ['Payment seen: order %s', 'We see your payment'],
        'customer_processing_order' => ['Paid in full: order %s', 'Paid in full'],
        'customer_completed_order'  => ['On its way: order %s', 'On its way'],
        'customer_refunded_order'   => !empty($email->partial_refund)
            ? ['Partly refunded: order %s', 'Partly refunded']
            : ['Refunded: order %s', 'Refunded'],
        'customer_note'             => ['A note about order %s', 'A note about your order'],
        'customer_invoice'          => ['Your order %s', 'Your order'],
        'customer_invoice_paid'     => ['Your order %s', 'Your order'],
        'new_order'                 => ['New order %s', 'New order'],
        'cancelled_order'           => ['Cancelled: order %s', 'Cancelled'],
        'failed_order'              => ['Payment failed: order %s', 'Payment failed'],
    ];
    return $words[$id] ?? null;
}

// The invoice email files a paid order under customer_invoice_paid.
foreach (['customer_on_hold_order', 'customer_processing_order', 'customer_completed_order',
          'customer_refunded_order', 'customer_note', 'customer_invoice', 'customer_invoice_paid',
          'new_order', 'cancelled_order', 'failed_order'] as $bv_email_id) {
    add_filter("woocommerce_email_subject_{$bv_email_id}", function ($subject, $order, $email) use ($bv_email_id) {
        $w = bv_email_words($bv_email_id, $email);
        return ($w && $order instanceof WC_Order) ? sprintf($w[0], $order->get_order_number()) : $subject;
    }, 10, 3);
    add_filter("woocommerce_email_heading_{$bv_email_id}", function ($heading, $order, $email) use ($bv_email_id) {
        $w = bv_email_words($bv_email_id, $email);
        return $w ? $w[1] : $heading;
    }, 10, 3);
}

/**
 * The checkout's retention promise, for the shipping email — shown on the
 * same terms as at checkout: only while the purge is demonstrably running.
 */
function bv_email_retention_promise() {
    if (!defined('BV_RETENTION_PROMISE') || !function_exists('bv_purge_is_live') || !bv_purge_is_live()) {
        return '';
    }
    return BV_RETENTION_PROMISE;
}
