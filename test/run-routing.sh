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
# Job control: each background job gets its own process group, so cleanup
# can address exactly the processes this script started (npx → wrangler →
# workerd, and the stub) and nothing else running on the machine.
set -m
cd "$(dirname "$0")/.."

STUB_ADDR="${STUB_ADDR:-127.0.0.2}"   # same port, second loopback address (see harness-config.mjs)
export CI=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG="${WRANGLER_LOG:-warn}"

# A port free on both loopback addresses (Worker on 127.0.0.1, stub on the
# second address), chosen at random so a stray listener is never mistaken for
# the harness.
PORT="${PORT:-$(node test/free-port.mjs "$STUB_ADDR")}"
LOG="$(mktemp -t bv-routing-dev.XXXXXX)"
DEV_PID=""
STUB_PID=""

cleanup() {
  # Negative PIDs address the process groups created under `set -m`.
  for pid in "${DEV_PID:-}" "${STUB_PID:-}"; do
    if [ -n "$pid" ]; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
  done
  rm -f wrangler.harness.json "$LOG"
}
trap cleanup EXIT

PORT="$PORT" STUB_ADDR="$STUB_ADDR" node test/harness-config.mjs > wrangler.harness.json

STUB_ADDR="$STUB_ADDR" STUB_PORT="$PORT" node test/stub-shop.mjs &
STUB_PID=$!

# Proxy variables are unset for the dev process only: wrangler routes the
# Worker's outbound fetch through any configured proxy, which cannot reach a
# loopback origin. Nothing here needs the network. --no-install: never fetch
# a different wrangler than the one pinned in devDependencies.
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy \
  npx --no-install wrangler dev --config wrangler.harness.json --port "$PORT" --ip 127.0.0.1 > "$LOG" 2>&1 &
DEV_PID=$!

# Fail closed: the dev process must be alive AND answering on the chosen port.
READY=0
for _ in $(seq 1 60); do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then break; fi
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/gate/config"; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != 1 ]; then
  echo "routing harness: wrangler dev did not become ready on 127.0.0.1:$PORT" >&2
  echo "--- dev log tail (harness-only values; no production secrets are configured here) ---" >&2
  sed -e 's/\x1b\[[0-9;]*m//g' "$LOG" | tail -n 30 >&2
  exit 1
fi

WORKER="http://127.0.0.1:$PORT" STUB_HOST="$STUB_ADDR:$PORT" node --test test/routing.test.mjs
