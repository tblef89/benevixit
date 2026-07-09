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
5. Fulfil, then purge the order's address (Phase 2.5: automate purge à la
   shisaku's purge-addresses).

When step 4 holds end-to-end, the store is launchable.

## Pricing note

WooCommerce prices in fiat (e.g. USD) and CipherPay converts to ZEC at
payment time, or you price in ZEC directly if the plugin supports it — check
the plugin's settings and pick deliberately; volatile ZEC/USD makes this a
real decision.
