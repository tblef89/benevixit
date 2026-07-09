# bene vixit

*bene vixit, bene qui latuit* — he lives well who conceals himself well.

A Zcash-only store guarded by an AI gatekeeper. The frontend is a paper-white
terminal; the Keeper decides nothing — it converses, a judge model scores the
transcript, and deterministic Worker code mints an HMAC-signed access grant
that WordPress verifies before showing the product. Payment is shielded ZEC
via CipherPay on WooCommerce.

Full architecture and phased plan: `docs/benevixit-rebrand-plan.md` in the
`tblef89/shisaku` repo.

## Layout

```
src/index.js              Worker entry — /gate/* routes, static asset fallback
src/gate/session.js       GateSession Durable Object (transcript, turn caps, TTL purge)
src/gate/judge.js         judge call + deterministic verdict threshold
src/gate/grant.js         HMAC grant mint/verify (WebCrypto)
src/gate/passphrase.js    rotating word-of-mouth entry
src/lib/manifest.js       gate manifest loader (KV, with code defaults)
src/lib/turnstile.js      Turnstile siteverify
public/                   terminal frontend (no build step)
manifest.example.json     full gate manifest shape → KV key "manifest"
extras/wordpress/         mu-plugin that verifies grants on the WooCommerce side
```

## Setup

```bash
npm install

# 1. KV namespace for gate config
npx wrangler kv namespace create GATE_KV
#    → paste the id into wrangler.jsonc

# 2. Seed the manifest (edit it first — persona, passphrase, checkoutUrl)
npx wrangler kv key put manifest --binding GATE_KV --path manifest.example.json --remote

# 3. Secrets
npx wrangler secret put GRANT_SECRET      # long random string; also goes in wp-config.php as BV_GRANT_SECRET
npx wrangler secret put TURNSTILE_SECRET  # from the Turnstile widget you create

# 4. Turnstile site key → wrangler.jsonc vars.TURNSTILE_SITE_KEY

# 5. Deploy
npm run deploy
```

Local dev: copy `.dev.vars.example` to `.dev.vars`, then `npm run dev`.
The Turnstile test keys in `.dev.vars.example` always pass.

## Operating the gate

Everything tunable lives in the KV manifest — no deploy needed:

```bash
# rotate the passphrase
npx wrangler kv key get manifest --binding GATE_KV --remote > /tmp/m.json
#   edit "passphrase", then:
npx wrangler kv key put manifest --binding GATE_KV --path /tmp/m.json --remote
```

Same file controls the persona, judge rubric, thresholds, turn caps, models,
and checkout URL. Future gate editions (partnerships, seasons) are new
manifests, not new code.

## Security model

- The chat model has no tools, no secrets, and no ability to grant access —
  it is told so in its persona, and it is true in the code.
- The judge's scores are advisory; `decideVerdict()` applies the threshold.
  Unparseable judge output fails closed.
- Grants are HMAC-SHA256 bearer tokens with expiry; `GRANT_SECRET` exists
  only in Worker secrets and `wp-config.php`.
- Per-IP rate limits use Workers Rate Limiting bindings; per-session turn
  caps live in the Durable Object. KV holds only low-churn config.
- Transcripts are purged when a session passes or its TTL alarm fires.
