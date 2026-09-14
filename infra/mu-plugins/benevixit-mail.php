<?php
/**
 * Plugin Name: Bene Vixit Mail
 * Description: WordPress mail over authenticated SMTP. The container has no
 * mail transport of its own, so without this every order email is dropped
 * on the floor without a word. Credentials come from the environment
 * (infra/.env → compose → container), never from the database, and the
 * plugin stays out of the way entirely until BV_SMTP_HOST is set.
 *
 * Any provider that speaks SMTP with a username and password works:
 * a mailbox host's SMTP (Fastmail, Migadu…) or a transactional service
 * (Postmark, SES, Resend…). The sending domain still needs SPF/DKIM/DMARC
 * records for the provider — see infra/README.md, "Mail".
 *
 * Test: as an administrator, visit /wp-admin/?bv_mail_test=1 — sends one
 * message to the site's admin email and reports what happened.
 */

defined('ABSPATH') || exit;

function bv_mail_env($key, $default = '') {
    $value = getenv($key);
    return ($value === false || $value === '') ? $default : $value;
}

function bv_mail_configured() {
    return bv_mail_env('BV_SMTP_HOST') !== '';
}

// Route wp_mail() through SMTP.
add_action('phpmailer_init', function ($phpmailer) {
    if (!bv_mail_configured()) {
        return;
    }
    $port = (int) bv_mail_env('BV_SMTP_PORT', '587');
    $phpmailer->isSMTP();
    $phpmailer->Host       = bv_mail_env('BV_SMTP_HOST');
    $phpmailer->Port       = $port;
    $phpmailer->SMTPAuth   = true;
    $phpmailer->Username   = bv_mail_env('BV_SMTP_USER');
    $phpmailer->Password   = bv_mail_env('BV_SMTP_PASS');
    $phpmailer->SMTPSecure = $port === 465 ? 'ssl' : 'tls'; // implicit TLS on 465, STARTTLS otherwise
    $phpmailer->SMTPAutoTLS = true;
    $phpmailer->Timeout    = 15;
});

// The envelope: who mail is from, for everything WordPress sends that does
// not set its own (WooCommerce's order emails take theirs from
// WooCommerce → Settings → Emails).
add_filter('wp_mail_from', function ($from) {
    return bv_mail_env('BV_MAIL_FROM', $from);
});
add_filter('wp_mail_from_name', function ($name) {
    return bv_mail_env('BV_MAIL_FROM_NAME', $name);
});

// A failed send is otherwise invisible; put it in the container log
// (`docker compose logs wordpress`).
add_action('wp_mail_failed', function ($error) {
    $data = $error->get_error_data();
    $to = is_array($data) && isset($data['to']) ? implode(',', (array) $data['to']) : '?';
    error_log('bv-mail: send failed to ' . $to . ': ' . $error->get_error_message());
});

// One-shot test for an administrator: /wp-admin/?bv_mail_test=1
add_action('admin_init', function () {
    if (!isset($_GET['bv_mail_test']) || !current_user_can('manage_options')) {
        return;
    }
    $to = get_option('admin_email');
    $failure = null;
    $capture = function ($error) use (&$failure) {
        $failure = $error->get_error_message();
    };
    add_action('wp_mail_failed', $capture);
    $sent = wp_mail(
        $to,
        'bene vixit: mail test',
        "This is a test from the shop at " . home_url() . ".\nIf you are reading it, order emails will reach customers too.\n" . gmdate('c')
    );
    remove_action('wp_mail_failed', $capture);

    $lines = [
        'Transport: ' . (bv_mail_configured() ? 'SMTP via ' . esc_html(bv_mail_env('BV_SMTP_HOST')) . ':' . esc_html(bv_mail_env('BV_SMTP_PORT', '587')) : 'PHP mail() — BV_SMTP_HOST is not set, so nothing will be delivered'),
        'To: ' . esc_html($to),
        'From: ' . esc_html(bv_mail_env('BV_MAIL_FROM', 'WordPress default')),
        'Result: ' . ($sent ? 'accepted by the server — now check the inbox (and spam)' : 'FAILED — ' . esc_html((string) $failure)),
    ];
    wp_die('<h1>Mail test</h1><p>' . implode('</p><p>', $lines) . '</p>', 'Mail test', ['response' => 200]);
});
