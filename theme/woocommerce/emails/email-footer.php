<?php
/**
 * Email footer: the motto and the way to write back.
 *
 * Overrides WooCommerce's templates/emails/email-footer.php. The footer text
 * setting in WooCommerce → Settings → Emails is not used; the sign-off is
 * the same on every letter.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package BeneVixit
 * @version 10.0.0
 */

defined('ABSPATH') || exit;

$email = $email ?? null;
$from  = $email instanceof WC_Email ? $email->get_from_address() : get_option('woocommerce_email_from_address');
?>
							</td>
						</tr>
						<tr>
							<td align="center" id="bv-footer">
								<p class="bv-motto">Bene vixit, bene qui latuit.</p>
								<?php if ($from) : ?>
									<p class="bv-contact"><a href="mailto:<?php echo esc_attr($from); ?>"><?php echo esc_html($from); ?></a></p>
								<?php endif; ?>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>
