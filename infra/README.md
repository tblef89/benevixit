# Phase 2 — Shop bring-up on the downsized VPS

Prereqs: Phase 1 runbook complete (`docs/mothball-runbook.md`), CipherPay
merchant credentials in your password manager, `GRANT_SECRET` value at hand.

**Same-origin architecture:** visitors never see `shop.benevixit.com`. The
benevixit.com Worker serves the terminal and gate itself and proxies every
other path (product, cart, checkout, wp-admin) to this WordPress origin.
`WP_HOME`/`WP_SITEURL` are pinned to `https://benevixit.com` in the compose
file, so all WordPress-generated URLs stay on the main domain. The `shop`
DNS record is internal plumbing — the address the Worker fetches from.

## 1. Stack up

```bash
# On the VPS
git clone https://github.com/tblef89/benevixit /opt/benevixit
cd /opt/benevixit/infra
cp .env.example .env && nano .env    # real passwords + BV_GRANT_SECRET
docker compose up -d
docker compose ps                    # all three healthy
```

The mu-plugin is mounted read-only from `infra/mu-plugins/` — grant
verification is live as soon as WordPress boots, and updates ship via
`git pull` instead of wp-admin.

## 2. DNS + TLS

1. Cloudflare DNS: `A` record `shop` → VPS IP, **grey cloud** (proxy off) for now.
2. Wait for `https://shop.benevixit.com` to answer with a Caddy-issued cert.
3. Leave the record **grey cloud** — the Worker fetches this hostname
   directly as its origin; Caddy's Let's Encrypt cert secures the hop.
4. Optional hardening: firewall the VPS so ports 80/443 only accept
   [Cloudflare IP ranges](https://www.cloudflare.com/ips/), plus your SSH.
   (Worker `fetch()` egress comes from Cloudflare IPs, so this still works.)

## 3. WordPress + WooCommerce

1. Visit the WordPress install wizard. Site title "bene vixit", strong admin
   password, discourage search engines: **on**. Once `WP_HOME` is active,
   wp-admin lives at `https://benevixit.com/wp-admin`.
2. Install WooCommerce; run its setup (store address, currency — see pricing
   note below, no marketing extras).
3. Install the **CipherPay plugin**; enter the API key and webhook secret from
   the merchant dashboard. If CipherPay's dashboard asks for the webhook URL,
   use whatever the plugin's settings screen displays.
4. Settings worth setting: Permalinks → "Post name"; disable comments;
   Woo → Settings → Accounts: allow guest checkout, do NOT force accounts.

## 3b. Mail

The WordPress container has no mail transport: `wp_mail()` hands the
message to PHP's `mail()`, which has nowhere to send it, and every order
email is dropped silently. `infra/mu-plugins/benevixit-mail.php` routes
`wp_mail()` over authenticated SMTP instead, configured from `.env`.

1. Pick a sender. Anything with SMTP + username/password works: the host
   of the `keeper@benevixit.com` mailbox (Fastmail, Migadu…) is the
   simplest — one vendor, replies land in the same box; a transactional
   service (Postmark, SES, Resend) if volume or deliverability ever matters.
2. In `.env`: `BV_SMTP_HOST`, `BV_SMTP_PORT` (587 STARTTLS / 465 TLS),
   `BV_SMTP_USER`, `BV_SMTP_PASS` (an app password, not the mailbox
   password), `BV_MAIL_FROM`, `BV_MAIL_FROM_NAME`. Then
   `docker compose up -d` — env is fixed when the container is created,
   so a `.env` edit alone changes nothing.
3. DNS at Cloudflare, per the provider's instructions: **SPF** (a TXT on
   `benevixit.com` naming the provider), **DKIM** (the provider's CNAME or
   TXT records), and **DMARC** (`_dmarc` TXT, `v=DMARC1; p=quarantine;`
   is a sane start). Without these the mail sends but lands in spam.
4. Test: signed in as an administrator, open
   `https://benevixit.com/wp-admin/?bv_mail_test=1`. It sends one message
   to the site's admin email and prints the transport, the from address,
   and the server's answer. A failure also lands in
   `docker compose logs wordpress` as `bv-mail:`.
5. WooCommerce → Settings → Emails: sender name/address to match
   `BV_MAIL_FROM`; **New order** (to you) and **Processing order** (to the
   customer) enabled. Re-send on an existing order with Order actions →
   "Send order details to customer" to test without placing another.

## 4. The product

1. Add product: **the herringbone cap** — slug must be `herringbone-cap`
   (the mu-plugin gates by slug; see `BV_GATED_PRODUCT_SLUGS`).
2. Catalog visibility: **Hidden** (product page reachable by URL only).
3. Exclude the shop/product from sitemaps and search as offered by theme/SEO
   settings — the gate is the only intended front door.
4. Price, shipping zones/rates, stock quantity.

## 5. Wire the gate to it

Update the KV manifest (`GATE_KV` → `manifest`):

```json
"checkoutUrl": "https://benevixit.com/product/herringbone-cap"
```

## 6. The full rehearsal

1. Pass the gate at benevixit.com → click "enter the shop".
2. Product page loads (and 403s/redirects in a private window WITHOUT the
   grant — verify both!).
3. Add to cart → checkout → pay a real minimal ZEC amount via CipherPay.
4. Order appears in Woo admin; status updates when payment confirms
   (CipherPay webhook); confirmation email arrives.
5. Fulfil: create the FedEx shipment, drop the parcel off, mark the order
   **Completed** (the customer gets the tracking email). The purge below
   takes it from there.

When step 4 holds end-to-end, the store is launchable.

## 7. The purge (shipping information deleted after a week)

`infra/mu-plugins/benevixit-purge.php` deletes everything that identifies
the customer or where the parcel went, seven days after the order is done
with. Accounting keeps the order; it does not keep the person.

| Order status | Purged when |
| --- | --- |
| Completed | 7 days after it was marked Completed |
| Cancelled, Failed, Refunded | 7 days after the last change |
| Pending (never paid) | 7 days after it was placed |
| Processing, On hold | never — still being fulfilled |

**Goes:** every name, address, phone and email (shipping and the hidden
billing mirror), IP address and browser, the chosen FedEx Hold-at-Location,
FedEx label and shipment data that carries the recipient, order-attribution
data, all order notes, and the customer's analytics row. Copies in the
order-storage tables WooCommerce isn't using are overwritten too, so a
direct database query finds nothing either way.
**Stays:** items, totals, the ZEC transaction id, payment status, the
delivery choice (hold or address), the FedEx tracking number, the dates.

It runs daily as an Action Scheduler job (WooCommerce → Status → Scheduled
actions, group `bene-vixit`). Each order goes through WooCommerce's own
privacy eraser plus our additions, is marked `_bv_purged`, and gets one
note. Only order ids reach the log (`docker compose logs wordpress | grep
bv-purge`). WooCommerce logs are kept 7 days. Keep the FedEx plugin's
**debug mode off** in production: it prints full requests on screen and
into logs.

**The checkout promise** ("We delete all shipping information from our
records within one week of delivery.") shows only while the job is
demonstrably working: a run finished in the last two days with no
failures. If the job stops, the promise disappears by itself.

**Make sure it runs.** WordPress's scheduler only wakes on traffic. Add
one line to the VPS host's crontab (`crontab -e`) so it wakes every 15
minutes regardless:

```
*/15 * * * * docker compose -f /opt/benevixit/infra/docker-compose.yml exec -T wordpress php -r 'file_get_contents("http://localhost/wp-cron.php");' >/dev/null 2>&1
```

**Audit.** Signed in as an administrator:

- `https://benevixit.com/wp-admin/?bv_purge=preview` lists storage mode,
  next and last run, whether the promise is showing, what is due now
  (order ids and meta key names, never values) and what comes due when.
  A "Run the purge now" link at the bottom runs it immediately.
- On any order that isn't Processing or On hold, **Order actions →
  Purge shipping information now** purges it early (it runs within a
  minute). Useful for testing, or when someone asks.
- Where WP-CLI is available: `wp bv purge --dry-run`, then `wp bv purge`.

**Outside the database, not covered by the purge:** the New order
emails in the keeper@ mailbox, CipherPay's copy of the invoice (the plugin
sends the billing name and shipping address with each invoice), and
FedEx's own records. The first is a mailbox habit. The second has no
setting in their plugin, but it can be stripped from the request in our
own code if we decide to.

## Pricing note

WooCommerce prices in fiat (e.g. USD) and CipherPay converts to ZEC at
payment time, or you price in ZEC directly if the plugin supports it — check
the plugin's settings and pick deliberately; volatile ZEC/USD makes this a
real decision.
