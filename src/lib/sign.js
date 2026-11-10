/**
 * HMAC helpers for short-lived session tokens.
 *
 * A session token proves the holder passed Turnstile in createSession, so
 * /gate/message and /gate/passphrase can require it — without it, anyone
 * could skip Turnstile by POSTing a self-invented session id straight to
 * the conversation (and burn Workers AI budget / brute-force the passphrase).
 *
 * Session tokens are signed with a subkey DERIVED from GRANT_SECRET, never
 * the raw secret. This guarantees a session token can never validate as an
 * access grant on the WordPress side (different signing key entirely), even
 * though both originate from the same root secret. No new env var needed.
 */
const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = str.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function hmacKey(rawBytes) {
  return crypto.subtle.importKey(
    'raw', rawBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

// Session-signing subkey = HMAC(GRANT_SECRET, "bv-session-v1"). Cryptographically
// independent from the grant secret used for access tokens.
let sessionKeyPromise = null;
function sessionKey(grantSecret) {
  if (!sessionKeyPromise) {
    sessionKeyPromise = (async () => {
      const root = await hmacKey(enc.encode(grantSecret));
      const sub = await crypto.subtle.sign('HMAC', root, enc.encode('bv-session-v1'));
      return hmacKey(new Uint8Array(sub));
    })();
  }
  return sessionKeyPromise;
}

export async function mintSessionToken(grantSecret, sessionId, ttlSeconds) {
  const payload = { sid: sessionId, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await sessionKey(grantSecret), enc.encode(body)));
  return `${body}.${sig}`;
}

// Returns the session id if the token is valid, signed, unexpired, and bound
// to the claimed session id; null otherwise.
export async function verifySessionToken(grantSecret, token, expectedSid) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let valid;
  try {
    valid = await crypto.subtle.verify(
      'HMAC', await sessionKey(grantSecret), b64urlDecode(sig), enc.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (payload.sid !== expectedSid) return null;
  return payload.sid;
}

// ── Proof of work: the human check for browsers Turnstile turns away ──
//
// The Worker hands out a signed challenge; the browser finds a nonce whose
// SHA-256 over `${challenge}:${nonce}` starts with `bits` zero bits (about
// 2^bits tries, a few seconds), and /gate/session checks it. No third party,
// no fingerprinting: it costs compute, not identity. Signed with its own
// subkey, so a challenge is never a session token or a grant.
const powKeys = new Map();
function powKey(grantSecret) {
  if (!powKeys.has(grantSecret)) {
    powKeys.set(grantSecret, (async () => {
      const root = await hmacKey(enc.encode(grantSecret));
      const sub = await crypto.subtle.sign('HMAC', root, enc.encode('bv-pow-v1'));
      return hmacKey(new Uint8Array(sub));
    })());
  }
  return powKeys.get(grantSecret);
}

export function leadingZeroBits(bytes) {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) { n += 8; continue; }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

export async function mintPowChallenge(grantSecret, bits, ttlSeconds = 300) {
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = { id, bits, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await powKey(grantSecret), enc.encode(body)));
  return `${body}.${sig}`;
}

// The challenge's { id, exp } if it is ours, unexpired, at least minBits
// hard, and solved by nonce; null otherwise. Single use is the caller's job.
export async function verifyPow(grantSecret, challenge, nonce, minBits) {
  if (typeof challenge !== 'string' || typeof nonce !== 'string') return null;
  if (!/^\d{1,20}$/.test(nonce) || challenge.length > 512) return null;
  const dot = challenge.indexOf('.');
  if (dot < 1) return null;
  const body = challenge.slice(0, dot);
  let valid;
  try {
    valid = await crypto.subtle.verify(
      'HMAC', await powKey(grantSecret), b64urlDecode(challenge.slice(dot + 1)), enc.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!(payload.bits >= minBits)) return null;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${nonce}`));
  if (leadingZeroBits(new Uint8Array(digest)) < payload.bits) return null;
  return { id: payload.id, exp: payload.exp };
}

// Deterministic proxy handshake token: proves an origin request came from the
// Worker, not a bot hitting shop.benevixit.com directly. Derived from
// GRANT_SECRET, which the WordPress mu-plugin already shares — no new secret.
let proxyTokenPromise = null;
export function proxyToken(grantSecret) {
  if (!proxyTokenPromise) {
    proxyTokenPromise = (async () => {
      const k = await hmacKey(enc.encode(grantSecret));
      const sig = await crypto.subtle.sign('HMAC', k, enc.encode('bv-proxy-v1'));
      return b64url(sig).slice(0, 32);
    })();
  }
  return proxyTokenPromise;
}
