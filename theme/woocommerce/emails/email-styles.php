<?php
/**
 * Email styles: the site's paper and ink, for mail.
 *
 * Overrides WooCommerce's templates/emails/email-styles.php. WooCommerce
 * inlines these rules into every element before sending (Emogrifier); the
 * two media queries stay in a <style> block for the clients that honour
 * them. The colour settings in WooCommerce → Settings → Emails are not used.
 *
 * Type is a system serif stack: a web font would be a request to our server
 * on every open (see email-header.php).
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 9.9.0
 */

defined('ABSPATH') || exit;

$serif = "'Cormorant Garamond', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
?>
body {
	margin: 0;
	padding: 0;
	background-color: #f3ede2;
	-webkit-text-size-adjust: none;
}
#bv-sheet {
	background-color: #f3ede2;
	width: 100%;
}
#bv-column {
	width: 100%;
	max-width: 560px;
}
#bv-letterhead {
	padding: 48px 24px 0;
	font-family: <?php echo $serif; // phpcs:ignore ?>;
	font-size: 11px;
	line-height: 1;
	letter-spacing: 0.32em;
	text-transform: uppercase;
	color: #6b6459;
}
#bv-rule-cell {
	padding: 18px 0 0;
}
#bv-rule {
	height: 1px;
	line-height: 1px;
	font-size: 1px;
	background-color: #e2d8c5;
}
#bv-body {
	padding: 40px 24px 8px;
	font-family: <?php echo $serif; // phpcs:ignore ?>;
	font-size: 17px;
	line-height: 1.6;
	color: #4a4438;
	text-align: left;
}
h1 {
	font-family: <?php echo $serif; // phpcs:ignore ?>;
	font-size: 30px;
	font-weight: 400;
	line-height: 1.25;
	color: #2c2822;
	margin: 0 0 24px;
}
p {
	margin: 0 0 16px;
}
a {
	color: #9a7f52;
}
.bv-label {
	font-size: 11px;
	line-height: 1.4;
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: #6b6459;
	margin: 36px 0 4px;
}
.bv-label a {
	color: #6b6459;
}
.bv-order {
	width: 100%;
	border-collapse: collapse;
	margin: 0 0 8px;
}
.bv-order th,
.bv-order td {
	font-family: <?php echo $serif; // phpcs:ignore ?>;
	font-size: 16px;
	font-weight: 400;
	line-height: 1.5;
	color: #4a4438;
	text-align: left;
	vertical-align: top;
	padding: 12px 0;
	border-bottom: 1px solid #e2d8c5;
}
.bv-order .bv-amount {
	text-align: right;
	white-space: nowrap;
	padding-left: 16px;
}
/* The shipping line carries the method's name too; let it wrap rather
   than widen the amount column for every line on a phone. */
.bv-order .bv-total-shipping .bv-amount {
	white-space: normal;
}
.bv-order .bv-item td {
	color: #2c2822;
	font-size: 17px;
}
.bv-qty {
	color: #6b6459;
	font-size: 15px;
}
.bv-item-meta {
	color: #6b6459;
	font-size: 14px;
}
.bv-order .bv-total th {
	color: #6b6459;
}
.bv-order .bv-total small,
.bv-order .bv-total .shipped_via {
	color: #6b6459;
	font-size: 14px;
}
.bv-order .bv-total-order_total th,
.bv-order .bv-total-order_total td {
	color: #2c2822;
	font-size: 18px;
	padding-top: 16px;
	border-bottom: 0;
}
.bv-order .bv-note td {
	font-style: italic;
	border-bottom: 0;
}
.bv-address {
	margin: 32px 0 0;
}
.bv-address p {
	margin: 0 0 8px;
}
.bv-address .bv-address-lines {
	color: #2c2822;
}
.bv-quote {
	border-left: 1px solid #9a7f52;
	padding: 2px 0 2px 16px;
	margin: 0 0 24px;
	font-style: italic;
	color: #2c2822;
}
.bv-promise {
	margin: 32px 0 0;
	padding-top: 16px;
	border-top: 1px solid #e2d8c5;
	font-size: 15px;
	font-style: italic;
	color: #6b6459;
}
#bv-footer {
	padding: 40px 24px 56px;
	font-family: <?php echo $serif; // phpcs:ignore ?>;
	font-size: 13px;
	line-height: 1.5;
	color: #6b6459;
	text-align: center;
}
.bv-motto {
	font-size: 16px;
	font-style: italic;
	margin: 0 0 6px;
}
.bv-contact {
	margin: 0;
	letter-spacing: 0.04em;
}
.bv-contact a {
	color: #6b6459;
}

@media (max-width: 600px) {
	#bv-letterhead { padding-top: 36px !important; }
	#bv-body { padding: 32px 20px 8px !important; }
	h1 { font-size: 26px !important; }
	#bv-footer { padding: 32px 20px 44px !important; }
}

/* Mail read after dark: the lamplit sheet from the site. Apple Mail and
   others honour this; clients that don't keep the day paper. */
@media (prefers-color-scheme: dark) {
	/* Order matters: the ink rules come after the soft ones they refine. */
	body,
	#bv-sheet { background-color: #2b251d !important; }
	#bv-body,
	.bv-order th,
	.bv-order td { color: #cfc7b8 !important; }
	#bv-letterhead,
	#bv-footer,
	.bv-label,
	.bv-label a,
	.bv-qty,
	.bv-item-meta,
	.bv-order .bv-total th,
	.bv-order .bv-total small,
	.bv-promise,
	.bv-contact a { color: #a89f8f !important; }
	h1,
	.bv-order .bv-item td,
	.bv-order .bv-total-order_total th,
	.bv-order .bv-total-order_total td,
	.bv-address .bv-address-lines,
	.bv-quote { color: #ece6da !important; }
	a { color: #b9a26e !important; }
	#bv-rule { background-color: #51483a !important; }
	.bv-order th,
	.bv-order td,
	.bv-promise { border-color: #51483a !important; }
	.bv-quote { border-color: #b9a26e !important; }
}
