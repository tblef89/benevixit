// Derives a local harness config from wrangler.jsonc and prints it as JSON.
//
// The routing tests run the REAL wrangler dev runtime (workerd + the static
// assets layer) so that `assets.run_worker_first` is exercised exactly as
// in production. Three things are adjusted for loopback only:
//   - `ai`, `ai_search` and `unsafe` (rate-limit) bindings are remote-only in dev and
//     would demand an API token; they are not on the routing path.
//   - `routes` would make dev present request.url as https://benevixit.com,
//     which breaks a loopback origin; production has no such mismatch.
//   - SHOP_ORIGIN points at the stub origin (see stub-shop.mjs) on the SAME
//     port at a second loopback address, because proxyToShop() swaps only
//     the hostname — in production both sides are :443.
import { readFileSync } from 'node:fs';

function stripJsonc(text) {
  // Remove // and /* */ comments outside of strings.
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out;
}

const port = process.env.PORT || '8787';
const stubAddr = process.env.STUB_ADDR || '127.0.0.2';
const cfg = JSON.parse(stripJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
delete cfg.ai;
delete cfg.ai_search;
delete cfg.unsafe;
delete cfg.routes;
cfg.vars = {
  ...(cfg.vars || {}),
  SHOP_ORIGIN: `http://${stubAddr}:${port}`,
  GRANT_SECRET: 'harness-only',
  TURNSTILE_SECRET: 'harness-only',
};
process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
