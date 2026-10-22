/**
 * Is the product in stock? Asked of WooCommerce's public Store API through
 * the same locked origin path the shop uses, and cached at the edge for a
 * minute so the door does not reach WordPress on every visit.
 *
 * Returns true, false, or null when it cannot tell (no slug configured,
 * WordPress down, an unexpected answer). null changes nothing: an outage
 * never closes the shop.
 */
import { proxyToken } from './sign.js';

const TTL_SECONDS = 60;
const FETCH_TIMEOUT_MS = 2000;

export function parseInStock(body) {
  const product = Array.isArray(body) ? body[0] : null;
  return typeof product?.is_in_stock === 'boolean' ? product.is_in_stock : null;
}

export async function shopInStock(env, manifest) {
  const slug = typeof manifest.stockSlug === 'string' ? manifest.stockSlug.trim() : '';
  if (!slug || !env.SHOP_ORIGIN) return null;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://bv-stock.internal/${encodeURIComponent(slug)}`);
  try {
    const hit = cache && (await cache.match(key));
    if (hit) return parseInStock(await hit.json());

    const url = new URL('/wp-json/wc/store/v1/products', env.SHOP_ORIGIN);
    url.searchParams.set('slug', slug);
    // The cap is catalog-hidden; the Store API leaves hidden products out
    // unless asked for every visibility.
    url.searchParams.set('catalog_visibility', 'any');
    const res = await fetch(url, {
      headers: { 'X-BV-Proxy': await proxyToken(env.GRANT_SECRET), Accept: 'application/json' },
      redirect: 'manual',
      // A slow shop must not hold up the door: give up and change nothing.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const answer = parseInStock(body);
    if (cache && answer !== null) {
      await cache.put(key, new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${TTL_SECONDS}` },
      }));
    }
    return answer;
  } catch (e) {
    console.error('stock check failed', e?.message || e);
    return null;
  }
}
