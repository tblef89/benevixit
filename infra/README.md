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
4. The origin answers only the Worker: see "Hardening" below for the
   token that makes that so.

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

Two halves, two vendors: the shop **sends** through Cloudflare Email
Service over SMTP, and **shopkeeper@benevixit.com** is a real mailbox at
Proton Mail, where customer replies and the New order notices land.

1. Sending: in `.env`, `BV_SMTP_HOST=smtp.mx.cloudflare.net`,
   `BV_SMTP_PORT=465`, `BV_SMTP_USER=api_token` (literally),
   `BV_SMTP_PASS` (a Cloudflare API token with Email Sending: Edit),
   `BV_MAIL_FROM=shopkeeper@benevixit.com`, `BV_MAIL_FROM_NAME`. Then
   `docker compose up -d`: env is fixed when the container is created,
   so a `.env` edit alone changes nothing. Any other SMTP provider works
   the same way.
2. Receiving: benevixit.com is a custom domain in Proton (Settings →
   Domain names), with the shopkeeper@ address. Customers reply to the
   From address, so it must be a mailbox someone reads.
3. DNS at Cloudflare. The **MX** records and the one **SPF** record
   (`v=spf1 include:_spf.protonmail.ch ~all`) are Proton's, and so are
   the three `protonmail*._domainkey` **DKIM** CNAMEs, which must be
   **DNS only** (grey cloud). Cloudflare's sending doesn't rely on that
   SPF record: it signs with its own DKIM key and bounces to its own
   address. **DMARC** is a `_dmarc` TXT; start at `v=DMARC1; p=none;`
   and move to `p=quarantine` once an order email shows DMARC PASS
   (Gmail: Show original). A domain has one SPF record and one set of
   MX records, so a new mail vendor means editing these, never adding
   a second.
4. Test: signed in as an administrator, open
   `https://benevixit.com/wp-admin/?bv_mail_test=1`. It sends one message
   to the site's admin email and prints the transport, the from address,
   and the server's answer. A failure also lands in
   `docker compose logs wordpress` as `bv-mail:`.
5. WooCommerce → Settings → Emails: **New order**, **Cancelled order**
   and **Failed order** with recipient `shopkeeper@benevixit.com` (and
   Settings → General → Administration email address the same), and **Order
   on-hold**, **Processing order** and **Completed order** (to the customer)
   enabled. Re-send on an existing order with Order actions → "Send order
   details to customer" to test without placing another.

The letters themselves are the theme's (`theme/woocommerce/emails/`, with
subjects and headings in `theme/emails.php`): the site's paper and ink,
the house name for a letterhead, one address block, and nothing fetched
from our server when they're opened (no logo, no web font). The colour,
footer, subject, heading and "additional content" settings on that
screen are not used. The sender comes from `BV_MAIL_FROM`, whatever the
screen says. The New order email to you carries what was bought and how
it ships, but no name, address, email or phone: those stay in the order,
where the purge can reach them.

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

**Labels** are printed on a Rollo (USB, direct thermal) onto generic 4×6
direct-thermal labels. FedEx plugin → Label settings: image type **PDF**,
stock **`STOCK_4X6`** (the Rollo has no ZPL). Print at **actual size /
100%**, never "fit to page", or the barcodes scale; if a label comes out
offset or shrunk, set the paper size to 4×6 in the Rollo driver's printing
preferences. Use the Rollo over USB with its driver alone; the Rollo Ship
app and account are not needed. (Before the Rollo: PNG on `PAPER_4X6`.)

A label shows a buyer's name and address: shred misprints rather than
binning them, and delete downloaded label files once printed (they would
outlive the purge).

## 6b. When the shopkeeper is away

**WooCommerce → Shopkeeper** (`mu-plugins/benevixit-shopkeeper.php`) has
two switches, each with its own words:

- **Away notice.** A card over the shop, cart and checkout pages that every
  visitor clicks through once per visit. The first line of the message is
  its heading; each further line is a paragraph. Changing the message shows
  it again to people who had already read the old one.
- **Collection in person.** A third choice at checkout beside the two FedEx
  ones. It asks for an email address and nothing else. There is no name,
  address or phone, and no shipping charge; anything a browser autofilled is
  dropped before the order is saved. The pickup note shows on that choice
  and in the buyer's emails; the buyer gives the order number at the table.
  Mark the order **Completed** when it is handed over (the buyer gets a
  "Collected" email, and the purge takes it from there).

Turn both off when you are back.

## 7. The purge (shipping information deleted after a week)

`infra/mu-plugins/benevixit-purge.php` deletes everything that identifies
the customer or where the parcel went, seven days after the order is done
with. Accounting keeps the order; it does not keep the person.

| Order status | Purged within 7 days of |
| --- | --- |
| Completed | being marked Completed |
| Cancelled, Failed, Refunded | its last change |
| Pending (never paid) | being placed |
| Processing, On hold | never — still being fulfilled |

The job runs hourly and takes each order two hours before its seven days
are up, so even a late or missed run still lands inside the week.

**Goes:** every name, address, phone and email (shipping and the hidden
billing mirror), IP address and browser, the chosen FedEx Hold-at-Location,
FedEx label and shipment data that carries the recipient, order-attribution
data, all order notes, and the customer's analytics row. Copies in the
order-storage tables WooCommerce isn't using (left by a switch between
storage modes, or kept by compatibility sync) are cleaned too, so a direct
database query finds nothing either way.
**Stays:** items, totals, the ZEC transaction id, payment status, the
delivery choice (hold or address), the FedEx tracking number, the dates.

It is an Action Scheduler job (WooCommerce → Status → Scheduled actions,
group `bene-vixit`). Each order goes through WooCommerce's own privacy
eraser plus our additions, is marked `_bv_purged`, and gets one note. Only
order ids reach the log, and only when a run purged or failed something
(`docker compose logs wordpress | grep bv-purge`). WooCommerce logs are kept 7 days. Keep the FedEx plugin's
**debug mode off** in production: it prints full requests on screen and
into logs.

**The checkout promise** ("We delete all shipping information from our
records within one week of delivery.") shows only while the job is
demonstrably working: the last run finished under two hours ago with no
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

**Outside the database, not covered by the purge:** the customer's own
copies of their order emails (theirs to keep), and FedEx's own records.
The New order emails in the shopkeeper@ mailbox carry no customer details
(see Mail above); order emails sent before that change do, and are a
mailbox habit to clear. **CipherPay gets nothing about the buyer:** its
plugin sends the name and shipping address with each invoice, and
`benevixit-checkout.php` strips them from the request before it leaves
(the invoice carries only amount, currency and product name). Status
updates are matched by invoice id alone, so nothing depends on them.

## 8. Hardening

`infra/audit.sh` checks the box and prints one line per finding, each with
an id. It is read-only and never prints a secret, so its output is safe to
share:

```bash
cd /opt/benevixit && git pull origin main && sudo bash infra/audit.sh
```

Fixes, by id. Keep a second SSH session open while changing anything under
SSH, and know where your provider's web console is: a mistake there locks
you out, and the console is the way back in.

**The origin lock (FIL-2, ORG-1).** The Worker stamps every request it
proxies with a token derived from `BV_GRANT_SECRET`; Caddy drops anything
without it. Write the token into `.env` (this prints nothing, and fills
in the existing `BV_PROXY_TOKEN=` line if there is one), then recreate
the stack:

```bash
cd /opt/benevixit/infra
T=$(docker compose exec -T wordpress php -r 'echo substr(rtrim(strtr(base64_encode(hash_hmac("sha256","bv-proxy-v1",getenv("BV_GRANT_SECRET"),true)),"+/","-_"),"="),0,32);')
if [ ${#T} -eq 32 ]; then
  if grep -q '^BV_PROXY_TOKEN=' .env; then sed -i "s|^BV_PROXY_TOKEN=.*|BV_PROXY_TOKEN=$T|" .env
  else printf '\nBV_PROXY_TOKEN=%s\n' "$T" >> .env; fi
  echo "token written"
else
  echo "no token: is the stack up, and is BV_GRANT_SECRET set?"
fi
unset T
grep -c '^BV_PROXY_TOKEN=.\{32\}$' .env      # 1
docker compose up -d
```

Anything that calls the origin must go through benevixit.com. The
CipherPay webhook URL must be `https://benevixit.com/wp-json/cipherpay/v1/webhook`,
never `shop.benevixit.com`. If the token is missing or wrong, the whole
shop answers nothing (fails closed); run the block above again.
Changing `GRANT_SECRET` in the Worker means regenerating this too.

**System (SYS-2, SYS-3).** `apt update && apt upgrade`, then turn on
automatic security updates: `apt install unattended-upgrades` and
`dpkg-reconfigure -plow unattended-upgrades`. Reboot when SYS-1 asks.

**SSH (SSH-1 to SSH-5).** Log in as your own user with sudo, not root.
Then create `/etc/ssh/sshd_config.d/10-bv.conf`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no
AllowUsers YOUR_USER
```

`sshd -t && systemctl reload ssh`, then open a **new** session to prove it
works before closing the old one. `apt install fail2ban` (SSH-6) quiets
the rest.

**Firewall (NET-2).** `ufw default deny incoming`, `ufw allow OpenSSH`,
`ufw allow 80,443/tcp`, `ufw enable`. Docker's published ports bypass
ufw; that's fine here, because 80/443 must stay open for certificate
renewal and the origin lock guards them. Nothing else should be listening
(NET-1).

**Leftovers (DOC-1, DOC-2, FIL-5).** Containers, volumes and dumps from
the box's previous life (the shisaku mothball) hold someone's old data.
Once the offsite copy from `docs/mothball-runbook.md` is confirmed good,
remove them: `docker rm`, `docker volume rm`, `rm` the archives.

**Files (FIL-1).** `chmod 600 infra/.env && chown root: infra/.env`.

**The git remote (FIL-4).** A token in the remote URL sits in plain text
in `.git/config`. The repo is private, so pull with a read-only deploy
key instead, then revoke the token on GitHub:

```bash
sudo ssh-keygen -t ed25519 -N '' -C benevixit-vps-deploy -f /root/.ssh/benevixit_deploy
sudo cat /root/.ssh/benevixit_deploy.pub   # the public half: safe to copy
```

GitHub → the repo → Settings → Deploy keys → Add deploy key: paste it,
leave **Allow write access** off. Then:

```bash
printf 'Host github.com\n  IdentityFile /root/.ssh/benevixit_deploy\n  IdentitiesOnly yes\n' | sudo tee -a /root/.ssh/config
sudo git -C /opt/benevixit remote set-url origin git@github.com:tblef89/benevixit.git
sudo git -C /opt/benevixit fetch origin main
```

The first fetch asks to trust github.com. Its ED25519 fingerprint is
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`; answer yes only if
it matches. Then delete the old token under GitHub → Settings → Developer
settings → Personal access tokens.

**Name resolution (NET-1, port 5355).** systemd-resolved answers LLMNR
on every interface. The firewall already blocks it; turn it off anyway:

```bash
sudo mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nLLMNR=no\n' | sudo tee /etc/systemd/resolved.conf.d/no-llmnr.conf
sudo systemctl restart systemd-resolved
```

**WordPress's open doors (PUB-1, PUB-2, PUB-3).**
`mu-plugins/benevixit-hardening.php` switches off XML-RPC, answers the
REST user routes only for an administrator, and drops the user sitemap
and oEmbed author names. Caddy also answers `/xmlrpc.php` with a 404.
It also turns off the plugin and theme code editors and application
passwords, and shuts WooCommerce's own login, registration and
password-reset forms (the shop has no customer accounts, so they could
only ever log in the administrator). `wp-login.php` is the one way in.
The plugin is live on `git pull`. Caddy reads its file only at start, so
its part also needs `docker compose restart caddy` (a `git pull` replaces
the file, and a running container keeps the old one).

**Logs (DOC-5).** `docker compose up -d` applies the size caps in
`docker-compose.yml`.

**The admin login behind Cloudflare Access (PUB-7, PUB-8).** Nobody sees
`wp-login.php` or `/wp-admin` without first entering a one-time code sent
to an address you choose; WordPress's own password and two-factor come
after that. Cloudflare → Zero Trust (free plan) → Access → Applications:

1. **Add an application → Self-hosted**, name "wp admin". Public
   hostnames: `benevixit.com` with path `wp-admin`, and `benevixit.com`
   with path `wp-login.php`. Policy: **Allow**, include **Emails** →
   `shopkeeper@benevixit.com`. Login method: one-time PIN.
2. **Add another → Self-hosted**, name "wp ajax (open)": `benevixit.com`
   with path `wp-admin/admin-ajax.php`. Policy: **Bypass**, include
   **Everyone**. The shop's scripts and WordPress's background jobs call
   it; the more specific path wins over the first application.

`infra/audit.sh` checks both (PUB-7: the login redirects to
`cloudflareaccess.com`; PUB-8: admin-ajax.php still answers).

**Beyond the box.** Most breaches start at an account, not a server:
- Turn on two-factor authentication for the VPS provider, Cloudflare,
  GitHub, Proton, CipherPay and FedEx.
- Scope Cloudflare API tokens to the one permission each needs.
- **Check the provider's automatic backups and snapshots.** They keep
  everything the purge deletes, for as long as they're retained. Either
  turn them off or keep their retention at a week or less.

## Pricing note

WooCommerce prices in fiat (e.g. USD) and CipherPay converts to ZEC at
payment time, or you price in ZEC directly if the plugin supports it — check
the plugin's settings and pick deliberately; volatile ZEC/USD makes this a
real decision.
