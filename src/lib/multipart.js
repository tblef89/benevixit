/**
 * php2shell stopgap (CVE-2026-109618 / CVE-2026-109619, October 2026).
 *
 * The exploit rides PHP's multipart/form-data handling. No public page of
 * the shop needs to upload a file, but WooCommerce's add-to-cart form is
 * marked multipart all the same. So a multipart request outside /wp-admin/
 * (behind Cloudflare Access) is re-encoded here as an ordinary urlencoded
 * form: PHP sees the same fields in $_POST, and its multipart parser never
 * runs. Anything that actually carries a file, or does not parse, is
 * refused. Keep this after PHP is patched: the public shop never needs it.
 */
export async function neutraliseMultipart(request, url) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('multipart/form-data') || url.pathname.startsWith('/wp-admin/')) {
    return request;
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad request.', { status: 400 });
  }
  const body = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') {
      return new Response('Uploads are not accepted here.', { status: 415 });
    }
    body.append(key, value);
  }
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/x-www-form-urlencoded');
  headers.delete('content-length');
  return new Request(request.url, { method: request.method, headers, body: body.toString(), redirect: 'manual' });
}
