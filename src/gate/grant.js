/**
 * Access grants — HMAC-SHA256 signed, expiring bearer tokens.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadB64))
 * Payload: { v: 1, e: <edition>, iat, exp }
 *
 * The signing secret (GRANT_SECRET) is shared with the WordPress mu-plugin,
 * which verifies the same format before exposing the product. The LLM never
 * sees this secret and cannot produce a valid token.
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

async function key(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

export async function mintGrant(secret, { edition, ttlSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, e: edition, iat: now, exp: now + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function verifyGrant(secret, token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let valid;
  try {
    valid = await crypto.subtle.verify(
      'HMAC', await key(secret), b64urlDecode(sig), enc.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
