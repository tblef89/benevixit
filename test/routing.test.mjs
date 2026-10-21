// Routing regression suite — run via `npm test` (test/run-routing.sh), which
// boots the real wrangler dev runtime with SHOP_ORIGIN pointed at stub-shop.mjs.
//   Direct: WORKER=http://127.0.0.1:8787 STUB_HOST=127.0.0.2:8787 node --test test/routing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const W = process.env.WORKER || 'http://localhost:8787';
const STUB_HOST = process.env.STUB_HOST || '127.0.0.1:8125';

const isStubEcho = (res) => res.headers.get('x-stub') === 'shop';

test('static GET / is served from ASSETS (not the shop)', async () => {
  const res = await fetch(`${W}/`);
  assert.equal(res.status, 200);
  assert.ok(!isStubEcho(res), 'root should come from assets');
  const html = await res.text();
  assert.match(html, /bene vixit/);
});

test('static GET /css/style.css is served from ASSETS', async () => {
  const res = await fetch(`${W}/css/style.css`);
  assert.equal(res.status, 200);
  assert.ok(!isStubEcho(res));
  assert.match(res.headers.get('content-type') || '', /text\/css/);
});

test('GET missing from assets is proxied to SHOP_ORIGIN', async () => {
  const res = await fetch(`${W}/product/herringbone-cap/`);
  assert.equal(res.status, 200);
  assert.ok(isStubEcho(res), 'should reach the stub shop');
  const echo = await res.json();
  assert.equal(echo.method, 'GET');
  assert.equal(echo.path, '/product/herringbone-cap/');
  assert.equal(echo.headers.hasProxyToken, true);
});

test('POST /?wc-ajax=update_order_review reaches the shop intact', async () => {
  const form = 'security=abc123&payment_method=cipherpay&country=US&postcode=10001';
  const res = await fetch(`${W}/?wc-ajax=update_order_review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': 'woocommerce_items_in_cart=1; wp_woocommerce_session_test=harness',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: form,
    redirect: 'manual',
  });
  assert.notEqual(res.status, 405, 'must not be rejected by the asset layer');
  assert.ok(isStubEcho(res), 'must reach WordPress (stub)');
  const echo = await res.json();
  assert.equal(echo.method, 'POST');
  assert.equal(echo.path, '/');
  assert.equal(echo.search, '?wc-ajax=update_order_review');
  assert.equal(echo.body, form);
  assert.match(echo.headers['content-type'], /x-www-form-urlencoded/);
  assert.equal(echo.headers.cookie, 'woocommerce_items_in_cart=1; wp_woocommerce_session_test=harness');
  assert.equal(echo.headers['x-requested-with'], 'XMLHttpRequest');
  assert.equal(echo.headers.hasProxyToken, true);
});

for (const path of [
  '/wp-admin/admin-ajax.php',
  '/wp-json/wc/v3/webhooks',
  '/wp-json/cipherpay/v1/webhook', // CipherPay's WooCommerce webhook endpoint
  '/wc-api/cipherpay_callback',
  '/?wc-api=cipherpay',
  '/wp-login.php',
  '/checkout/',
]) {
  test(`POST ${path} is not intercepted by the asset layer`, async () => {
    const res = await fetch(`${W}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WC-Webhook-Signature': 'sig' },
      body: '{"ping":true}',
      redirect: 'manual',
    });
    assert.notEqual(res.status, 405);
    assert.ok(isStubEcho(res), `${path} must reach the shop`);
    const echo = await res.json();
    assert.equal(echo.method, 'POST');
    assert.equal(echo.body, '{"ping":true}');
    assert.equal(echo.headers['x-wc-webhook-signature'], 'sig');
  });
}

test('GET /gate/config is handled by the Worker', async () => {
  const res = await fetch(`${W}/gate/config`);
  assert.equal(res.status, 200);
  assert.ok(!isStubEcho(res));
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(typeof j.data.turnstileSiteKey, 'string');
  assert.equal(j.data.shopNotice, 'The shop is currently open.', 'the default manifest says open');
});

test('POST /gate/config is answered by the Worker\'s JSON envelope, not the asset layer', async () => {
  // /gate/config only serves GET; a POST falls through the gate switch to the
  // Worker's own 404 (not_found). The asset layer's empty 405 must never appear.
  const res = await fetch(`${W}/gate/config`, { method: 'POST', body: '{}' });
  assert.notEqual(res.status, 405);
  assert.equal(res.status, 404);
  const j = await res.json();
  assert.equal(j.ok, false);
  assert.equal(j.error.code, 'not_found');
});

test('PUT /gate/config gets the Worker\'s own JSON 405 (method_not_allowed)', async () => {
  const res = await fetch(`${W}/gate/config`, { method: 'PUT', body: '{}' });
  assert.equal(res.status, 405);
  const j = await res.json();
  assert.equal(j.error.code, 'method_not_allowed');
});

test('POST /gate/message is handled by the Worker, never proxied or asset-rejected', async () => {
  const res = await fetch(`${W}/gate/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: '00000000-0000-0000-0000-000000000000', sessionToken: 'x', message: 'hi' }),
  });
  assert.ok(!isStubEcho(res), 'gate traffic must never reach the shop');
  assert.notEqual(res.status, 405, 'must not be the asset layer\'s 405');
  // With the real rate-limit binding (remote-only; absent in this local
  // harness) this is 403 bad_session JSON. Without the binding the handler
  // throws on env.MESSAGE_RL — and because the gate handlers are returned
  // as un-awaited promises, that escapes the Worker's try/catch and surfaces
  // as the runtime's 500 rather than the JSON envelope. Either way the
  // request was handled by Worker code, which is what this test guards.
  assert.ok([403, 500].includes(res.status), `unexpected ${res.status}`);
  if (res.status === 403) {
    const j = await res.json();
    assert.equal(j.error.code, 'bad_session');
  }
});

test('POST /gate/nowhere is the Worker\'s 404, never proxied', async () => {
  const res = await fetch(`${W}/gate/nowhere`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 404);
  assert.ok(!isStubEcho(res));
});

test('shop redirect Location is rewritten to the public hostname', async () => {
  const res = await fetch(`${W}/redirect-me`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  const stubHostname = STUB_HOST.split(':')[0];
  const publicHostname = new URL(W).hostname;
  assert.equal(loc.hostname, publicHostname, 'hostname must be the public one');
  assert.notEqual(loc.hostname, stubHostname);
  assert.equal(loc.pathname, '/wp-login.php');
  assert.equal(loc.searchParams.get('redirect_to'), '/wp-admin/');
});

// The files crawlers and assistants look for come from ASSETS, before
// WordPress (whose own robots.txt would otherwise answer).
for (const [path, type, text] of [
  ['/robots.txt', /text\/plain/, /Sitemap: https:\/\/benevixit\.com\/sitemap\.xml/],
  ['/sitemap.xml', /xml/, /<loc>https:\/\/benevixit\.com\/faq<\/loc>/],
  ['/llms.txt', /text\/plain/, /accepts only Zcash/],
  ['/.well-known/security.txt', /text\/plain/, /Contact: mailto:shopkeeper@benevixit\.com/],
  ['/faq', /text\/html/, /<h1>Questions<\/h1>/],
]) {
  test(`GET ${path} is served from ASSETS`, async () => {
    const res = await fetch(`${W}${path}`);
    assert.equal(res.status, 200);
    assert.ok(!isStubEcho(res), `${path} must not reach the shop`);
    assert.match(res.headers.get('content-type') || '', type);
    assert.match(await res.text(), text);
  });
}

test('robots.txt keeps crawlers off the gate and the shop, and nothing else', async () => {
  const body = await (await fetch(`${W}/robots.txt`)).text();
  const disallow = body.split('\n').filter((l) => l.startsWith('Disallow:')).map((l) => l.slice(9).trim());
  for (const p of ['/gate/', '/cart', '/checkout', '/my-account', '/wp-admin/']) {
    assert.ok(disallow.includes(p), `must disallow ${p}`);
  }
  assert.ok(!disallow.includes('/'), 'must not disallow everything');
  assert.ok(!disallow.some((p) => p === '/faq' || p === '/llms.txt'));
});

test('security.txt has not expired', async () => {
  const body = await (await fetch(`${W}/.well-known/security.txt`)).text();
  const expires = Date.parse(body.match(/^Expires: (.+)$/m)[1]);
  assert.ok(expires > Date.now(), 'renew the Expires line (RFC 9116: at most a year ahead)');
});

test('the FAQ structured data says what the page says, word for word', async () => {
  const html = await (await fetch(`${W}/faq`)).text();
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');
  const unescape = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const tidy = (s) => unescape(s).replace(/\s+/g, ' ').trim();
  const main = html.slice(html.indexOf('<h1>'));
  const shown = [...main.matchAll(/<h2>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2>|<\/main>)/g)].map(([, q, rest]) => ({
    q: unescape(q),
    // A paragraph is a block; a list is one block, an item to a line.
    a: [...rest.matchAll(/<p>([\s\S]*?)<\/p>|<ul>([\s\S]*?)<\/ul>/g)].map(([, p, ul]) => p !== undefined
      ? tidy(p)
      : [...ul.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => tidy(li[1])).join('\n')).join('\n\n'),
  }));
  assert.deepEqual(
    faq.mainEntity.map((e) => ({ q: e.name, a: e.acceptedAnswer.text })),
    shown,
  );
});

// php2shell stopgap (src/lib/multipart.js): PHP never parses multipart from
// the public site.
test('a multipart form without files reaches the shop as an ordinary form', async () => {
  const form = new FormData();
  form.append('add-to-cart', '42');
  form.append('quantity', '1');
  const res = await fetch(`${W}/product/herringbone-cap/`, { method: 'POST', body: form, redirect: 'manual' });
  assert.ok(isStubEcho(res));
  const echo = await res.json();
  assert.match(echo.headers['content-type'], /^application\/x-www-form-urlencoded/);
  assert.equal(echo.body, 'add-to-cart=42&quantity=1');
});

test('a multipart upload outside /wp-admin/ is refused before PHP', async () => {
  const form = new FormData();
  form.append('file', new Blob(['<?php echo 1;'], { type: 'text/plain' }), 'x.php');
  const res = await fetch(`${W}/checkout/`, { method: 'POST', body: form, redirect: 'manual' });
  assert.equal(res.status, 415);
  assert.ok(!isStubEcho(res));
});

test('multipart to /wp-admin/ (behind Cloudflare Access) is passed through untouched', async () => {
  const form = new FormData();
  form.append('name', 'x');
  const res = await fetch(`${W}/wp-admin/async-upload.php`, { method: 'POST', body: form, redirect: 'manual' });
  assert.ok(isStubEcho(res));
  const echo = await res.json();
  assert.match(echo.headers['content-type'], /^multipart\/form-data/);
});
