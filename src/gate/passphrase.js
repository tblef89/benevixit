/**
 * Rotating passphrase — the word-of-mouth re-entry path.
 * Stored in the KV manifest; rotation is a config edit, not a deploy.
 * A correct phrase mints the same grant format as passing the interview,
 * so WordPress only ever validates one token type.
 */
import { loadManifest } from '../lib/manifest.js';
import { mintGrant } from './grant.js';

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function timingSafeMatch(a, b) {
  // Hash both sides so lengths are equal, then constant-time compare.
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

export async function tryPassphrase(env, phrase) {
  const manifest = await loadManifest(env);
  if (!manifest.passphrase) return null;
  const match = await timingSafeMatch(normalize(phrase), normalize(manifest.passphrase));
  if (!match) return null;

  const grant = await mintGrant(env.GRANT_SECRET, {
    edition: manifest.edition,
    ttlSeconds: manifest.grantTtlSeconds,
  });
  return { passed: true, grant, checkoutUrl: manifest.checkoutUrl };
}
