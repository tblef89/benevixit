/**
 * Bene Vixit — Gate Worker
 *
 * Routes:
 *   GET  /gate/config      — public config for the frontend (Turnstile site key)
 *   POST /gate/session     — start a gate conversation (Turnstile-verified)
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
import { loadManifest } from './lib/manifest.js';
import { tryPassphrase } from './gate/passphrase.js';

export { GateSession };

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
  const url = new URL(request.url);
  url.hostname = new URL(env.SHOP_ORIGIN).hostname;
  return fetch(new Request(url, request), { redirect: 'manual' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
        return ok({
          turnstileSiteKey: env.TURNSTILE_SITE_KEY,
          debugScores: manifest.debugScores === true,
          minTurnsBeforeJudge: manifest.minTurnsBeforeJudge,
        });
      }
      if (request.method !== 'POST') {
        return err('method_not_allowed', 'POST only.', 405);
      }

      const body = await request.json().catch(() => null);
      if (!body) return err('bad_json', 'Body must be JSON.');

      switch (url.pathname) {
        case '/gate/session':
          return createSession(body, request, env);
        case '/gate/message':
          return relayToSession(body, request, env, '/message');
        case '/gate/passphrase':
          return passphrase(body, request, env);
        default:
          return err('not_found', 'No such gate.', 404);
      }
    } catch (e) {
      console.error('gate error', e);
      return err('internal', 'The gate is jammed. Try again shortly.', 500);
    }
  },
};

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
  if (manifest.cooldownSeconds > 0) {
    const locked = await env.GATE_KV.get(await ipLockKey(ip, env));
    if (locked) return err('cooldown', manifest.cooldownMessage, 429);
  }

  const human = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, ip);
  if (!human) return err('turnstile_failed', 'Could not verify you are a person.', 403);

  const sessionId = crypto.randomUUID();
  // The DO is created lazily on first message; the opening line is static config.
  return ok({ sessionId, opening: manifest.opening, maxTurns: manifest.maxTurns });
}

async function relayToSession(body, request, env, path) {
  const ip = clientIp(request);
  const { success } = await env.MESSAGE_RL.limit({ key: ip });
  if (!success) return err('rate_limited', 'Slow down.', 429);

  const { sessionId, message } = body;
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId)) {
    return err('bad_session', 'Invalid session.');
  }
  if (typeof message !== 'string' || !message.trim()) {
    return err('empty_message', 'Say something.');
  }

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
    if (manifest.cooldownSeconds > 0) {
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

  const result = await tryPassphrase(env, body.phrase);
  if (!result) return err('wrong_word', 'That is not the word.', 403);
  return ok(result);
}
