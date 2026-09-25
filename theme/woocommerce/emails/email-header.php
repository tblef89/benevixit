<?php
/**
 * Email header: the letterhead.
 *
 * Overrides WooCommerce's templates/emails/email-header.php. Every order
 * email opens on the house name set small, a hairline, and the heading, on
 * the same paper as the site. Nothing is fetched from anywhere: no logo, no
 * web font, no image. An email that loads a file from our server tells us
 * it was opened, and we don't want to know.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 10.0.0
 */

defined('ABSPATH') || exit;

$store_name = $store_name ?? get_bloginfo('name', 'display');
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=<?php bloginfo('charset'); ?>" />
		<meta content="width=device-width, initial-scale=1.0" name="viewport">
		<meta name="color-scheme" content="light dark">
		<meta name="supported-color-schemes" content="light dark">
		<title><?php echo esc_html($store_name); ?></title>
	</head>
	<body leftmargin="0" marginwidth="0" topmargin="0" marginheight="0" offset="0">
		<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" id="bv-sheet">
			<tr>
				<td align="center" valign="top">
					<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="560" id="bv-column">
						<tr>
							<td align="center" id="bv-letterhead"><?php echo esc_html($store_name); ?></td>
						</tr>
						<tr>
							<td align="center" id="bv-rule-cell">
								<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="40"><tr><td id="bv-rule">&nbsp;</td></tr></table>
							</td>
						</tr>
						<tr>
							<td valign="top" id="bv-body">
								<h1><?php echo esc_html($email_heading); ?></h1>
