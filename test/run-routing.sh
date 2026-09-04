#!/usr/bin/env bash
# Routing regression harness — `npm test`.
#
# Boots the real wrangler dev runtime (workerd + static assets layer) from a
# loopback derivation of wrangler.jsonc, with SHOP_ORIGIN pointed at a stub
# origin, then runs test/routing.test.mjs against it. Proves that the asset
# layer never answers for dynamic traffic (the empty-405 defect), that GET
# assets still come from ASSETS, that proxied requests reach the shop intact,
# that /gate/* stays in the Worker, and that redirect Locations are rewritten.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
STUB_ADDR="${STUB_ADDR:-127.0.0.2}"   # same port, second loopback address (see harness-config.mjs)
export CI=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG="${WRANGLER_LOG:-warn}"

PORT="$PORT" STUB_ADDR="$STUB_ADDR" node test/harness-config.mjs > wrangler.harness.json

cleanup() {
  kill "${DEV_PID:-}" "${STUB_PID:-}" 2>/dev/null || true
  sleep 1
  pkill -f "[w]orkerd" 2>/dev/null || true
  rm -f wrangler.harness.json
}
trap cleanup EXIT

STUB_ADDR="$STUB_ADDR" STUB_PORT="$PORT" node test/stub-shop.mjs &
STUB_PID=$!

# Proxy variables are unset for the dev process only: wrangler routes the
# Worker's outbound fetch through any configured proxy, which cannot reach a
# loopback origin. Nothing here needs the network.
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy \
  npx wrangler dev --config wrangler.harness.json --port "$PORT" --ip 127.0.0.1 > /dev/null 2>&1 &
DEV_PID=$!

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/gate/config" && break
  sleep 1
done

WORKER="http://127.0.0.1:$PORT" STUB_HOST="$STUB_ADDR:$PORT" node --test test/routing.test.mjs
