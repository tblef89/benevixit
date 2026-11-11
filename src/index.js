/**
 * Bene Vixit — Gate Worker
 *
 * Routes:
 *   GET  /gate/config      — public config for the frontend (Turnstile site key)
 *   GET  /gate/pow         — a proof-of-work challenge, the fallback human check
 *   POST /gate/session     — start a gate conversation (Turnstile or proof of work)
 *   POST /gate/message     — send a message to the Keeper
 *   POST /gate/passphrase  — try the current passphrase for direct entry
 *
 * Everything else falls through to static assets (./public).
 *
 * Security model: the LLM never decides access and never holds secrets.
 * The judge call returns scores; this Worker applies the threshold in code
 * and mints the HMAC-signed grant. See src/gate/grant.js.
 */
import { GateSession } from './gate/session.js';
import { verifyTurnstile } from './lib/turnstile.js';
import { loadManifest, shopNotice, shopIsOpen } from './lib/manifest.js';
import { shopInStock } from './lib/stock.js';
import { tryPassphrase } from './gate/passphrase.js';
import { mintSessionToken, verifySessionToken, proxyToken, mintPowChallenge, verifyPow } from './lib/sign.js';
import { GateBudget, budgetResting, redeemPow } from './gate/budget.js';

// Hard ceiling on any incoming message, independent of the KV manifest —
// rejects abusive payloads at the edge before they reach a Durable Object.
const MAX_MESSAGE_BYTES = 4000;

export { GateSession, GateBudget };

const ok = (data, status = 200) =>
  Response.json({ ok: true, data }, { status });
const err = (code, message, status = 400) =>
  Response.json({ ok: false, error: { code, message } }, { status });

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

// Same-origin shop: any path that isn't the gate or a static asset is
// proxied to the WordPress origin, so the visitor never leaves benevixit.com.
// WordPress is configured (WP_HOME/WP_SITEURL) to believe it IS benevixit.com.
async function proxyToShop(request, env) {
  const publicUrl = new URL(request.url);
  const originHost = new URL(env.SHOP_ORIGIN).hostname;
  const url = new URL(request.url);
  url.hostname = originHost;
  const proxied = new Request(url, request);
  // Stamp proxy traffic with a secret handshake token (derived from
  // GRANT_SECRET, which the mu-plugin already shares) so the origin's
  // canonical-host redirect leaves Worker requests alone and a bot hitting
  // shop.benevixit.com directly cannot forge the exemption.
  proxied.headers.set('X-BV-Proxy', await proxyToken(env.GRANT_SECRET));
  const res = await fetch(proxied, { redirect: 'manual' });
  // WordPress builds redirects (e.g. its canonical trailing-slash 301)
  // from the host it received — the origin's. Rewrite Location headers
  // back to the public hostname so the browser never leaves it.
  const loc = res.headers.get('Location');
  if (loc) {
    const l = new URL(loc, url);
    if (l.hostname === originHost) {
      l.hostname = publicUrl.hostname;
      const out = new Response(res.body, res);
      out.headers.set('Location', l.toString());
      return out;
    }
  }
  return res;
}

// The real site, as opposed to local dev on loopback.
const isLive = (url) => /(^|\.)benevixit\.com$/.test(url.hostname);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const res = await handle(request, env, url);
    if (url.protocol !== 'https:' || !isLive(url) || res.status === 101) return res;
    // HSTS: once a browser has been here over https it never asks in the
    // clear again, so there is no unencrypted first hop to warn about.
    const out = new Response(res.body, res);
    out.headers.set('Strict-Transport-Security', 'max-age=15552000');
    return out;
  },
};

async function handle(request, env, url) {
  // Never serve the shop in the clear. A browser that asks over plain
  // http (a typed address, an old link) is sent to https, and told to
  // stay there (HSTS above). Only for the real hostnames: local dev is http.
  if (url.protocol === 'http:' && isLive(url)) {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  if (!url.pathname.startsWith('/gate/')) {
    // Terminal frontend first; anything it doesn't have is the shop.
    // Assets only answer GET/HEAD — POSTs (login, cart, webhooks) go
    // straight to WordPress.
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return proxyToShop(request, env);
  }

  try {
    if (url.pathname === '/gate/config' && request.method === 'GET') {
      // debugScores/minTurnsBeforeJudge are echoed so a stale or broken KV
      // manifest edit is diagnosable from a browser. Neither is sensitive.
      const manifest = await loadManifest(env);
      const inStock = await shopInStock(env, manifest);
      const open = shopIsOpen(manifest, inStock);
      return ok({
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
        debugScores: manifest.debugScores === true,
        shopNotice: shopNotice(manifest, inStock),
        shopOpen: open,
        ...(open ? {} : { away: manifest.awayOpening }),
      });
    }
    if (url.pathname === '/gate/pow' && request.method === 'GET') {
      const manifest = await loadManifest(env);
      const bits = powBits(manifest);
      if (!bits) return err('pow_off', 'Only the usual check is open today.', 404);
      return ok({ challenge: await mintPowChallenge(env.GRANT_SECRET, bits), bits });
    }
    if (request.method !== 'POST') {
      return err('method_not_allowed', 'POST only.', 405);
    }

    const body = await request.json().catch(() => null);
    if (!body) return err('bad_json', 'Body must be JSON.');

    switch (url.pathname) {
      case '/gate/session':
        return await createSession(body, request, env);
      case '/gate/message':
        return await relayToSession(body, request, env, '/message');
      case '/gate/passphrase':
        return await passphrase(body, request, env);
      default:
        return err('not_found', 'No such gate.', 404);
    }
  } catch (e) {
    console.error('gate error', e);
    return err('internal', 'The gate is jammed. Try again shortly.', 500);
  }
}

// Rejection cooldown: a hashed-IP marker in KV with a TTL. Deliberately
// light — a determined visitor can rotate IPs, and that's fine; the point
// is that rejection carries a little weight. One write per rejection and
// self-expiring, so KV's write limits and privacy posture both hold (we
// store a salted hash, never the address).
async function ipLockKey(ip, env) {
  const data = new TextEncoder().encode(`${env.GRANT_SECRET}|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `lockout:${hex}`;
}

async function createSession(body, request, env) {
  const ip = clientIp(request);
  const { success } = await env.SESSION_RL.limit({ key: ip });
  if (!success) return err('rate_limited', 'Too many sessions. Breathe.', 429);

  const manifest = await loadManifest(env);
  if (manifest.cooldownSeconds > 0 && !isTor(request)) {
    const locked = await env.GATE_KV.get(await ipLockKey(ip, env));
    if (locked) return err('cooldown', manifest.cooldownMessage, 429);
  }

  const closed = await closedRefusal(env, manifest);
  if (closed) return closed;

  // The human check: Turnstile, or for browsers Turnstile turns away
  // (Tor, Mullvad, resisted fingerprints), a solved proof-of-work puzzle,
  // good for one session. Either way the day's turn budget bounds the bill.
  let human = false;
  if (body.turnstileToken) {
    human = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, ip);
  } else if (body.pow && powBits(manifest) > 0) {
    const solved = await verifyPow(env.GRANT_SECRET, body.pow.challenge, body.pow.nonce, powBits(manifest));
    human = !!solved && (await redeemPow(env, solved.id, solved.exp));
  }
  if (!human) return err('turnstile_failed', 'Could not verify you are a person.', 403);

  // Bind conversation access to having passed the human check: mint a signed,
  // short-lived session token. /gate/message and /gate/passphrase require it,
  // so no one can skip the human check by inventing a session id.
  const sessionId = crypto.randomUUID();
  const sessionToken = await mintSessionToken(env.GRANT_SECRET, sessionId, manifest.sessionTtlSeconds);
  // The DO is created lazily on first message. When today's budget is spent
  // the keeper rests: the greeting says so, and /word still works.
  const opening = (await budgetResting(env, manifest)) ? manifest.restingLine : manifest.opening;
  return ok({ sessionId, sessionToken, opening, maxTurns: manifest.maxTurns });
}

// Proof-of-work difficulty from the manifest; 0 (or unset) turns the
// fallback off and leaves Turnstile as the only way in.
function powBits(manifest) {
  const b = Number(manifest.powBits);
  return Number.isInteger(b) && b > 0 && b <= 32 ? b : 0;
}

// Tor exits are shared by many people and change with every circuit, so a
// per-address cooldown there punishes strangers and stops no one.
const isTor = (request) => request.cf?.country === 'T1';

// A closed shop starts and continues no conversation, whatever the page does:
// checked at session start and again on every message and passphrase, so a
// session begun before the close cannot carry on to a grant.
async function closedRefusal(env, manifest) {
  manifest = manifest || (await loadManifest(env));
  if (shopIsOpen(manifest, await shopInStock(env, manifest))) return null;
  return err('shop_closed', manifest.awayOpening, 403);
}

// Verify the caller holds a valid session token bound to the claimed id.
async function requireSession(body, env) {
  const { sessionId, sessionToken } = body;
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId)) return null;
  if (!(await verifySessionToken(env.GRANT_SECRET, sessionToken, sessionId))) return null;
  return sessionId;
}

async function relayToSession(body, request, env, path) {
  const ip = clientIp(request);
  const { success } = await env.MESSAGE_RL.limit({ key: ip });
  if (!success) return err('rate_limited', 'Slow down.', 429);

  const sessionId = await requireSession(body, env);
  if (!sessionId) return err('bad_session', 'Verify yourself at the door first.', 403);

  const { message } = body;
  if (typeof message !== 'string' || !message.trim()) {
    return err('empty_message', 'Say something.');
  }
  if (message.length > MAX_MESSAGE_BYTES) {
    return err('too_long', 'Fewer words.', 413);
  }

  const closed = await closedRefusal(env);
  if (closed) return closed;

  const stub = env.GATE_SESSION.get(env.GATE_SESSION.idFromName(sessionId));
  const res = await stub.fetch(new Request(`https://gate-session${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message.trim() }),
  }));

  // A conversation that ends in rejection starts the cooldown clock.
  const payload = await res.json().catch(() => null);
  if (payload?.data?.exhausted) {
    const manifest = await loadManifest(env);
    if (manifest.cooldownSeconds > 0 && !isTor(request)) {
      await env.GATE_KV.put(await ipLockKey(ip, env), '1', {
        expirationTtl: Math.max(60, manifest.cooldownSeconds),
      });
    }
  }
  return payload
    ? Response.json(payload, { status: res.status })
    : err('internal', 'The gate is jammed. Try again shortly.', 500);
}

async function passphrase(body, request, env) {
  const ip = clientIp(request);
  const { success } = await env.MESSAGE_RL.limit({ key: ip });
  if (!success) return err('rate_limited', 'Slow down.', 429);

  // Passphrase attempts require a valid session token too, so the endpoint
  // sits behind Turnstile + per-IP limits — no unauthenticated brute force.
  const sessionId = await requireSession(body, env);
  if (!sessionId) return err('bad_session', 'Verify yourself at the door first.', 403);

  const closed = await closedRefusal(env);
  if (closed) return closed;

  const result = await tryPassphrase(env, body.phrase);
  if (!result) return err('wrong_word', 'That is not the word.', 403);
  return ok(result);
}
