// Stub WordPress origin for the routing harness: echoes what it receives so
// the tests can prove method, query, body, and headers survive the Worker's
// proxy. Logs nothing.
import http from 'node:http';

const PORT = Number(process.env.STUB_PORT || 8787);
const ADDR = process.env.STUB_ADDR || '127.0.0.2';

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Redirect fixture: a WordPress-style redirect built from the origin host,
    // which the Worker must rewrite back to the public hostname.
    if (url.pathname === '/redirect-me') {
      res.writeHead(302, { Location: `http://${req.headers.host}/wp-login.php?redirect_to=%2Fwp-admin%2F` });
      return res.end();
    }
    const echo = {
      method: req.method,
      path: url.pathname,
      search: url.search,
      body,
      headers: {
        'content-type': req.headers['content-type'] || null,
        cookie: req.headers['cookie'] || null,
        'x-requested-with': req.headers['x-requested-with'] || null,
        'x-wc-webhook-signature': req.headers['x-wc-webhook-signature'] || null,
        host: req.headers['host'] || null,
        hasProxyToken: typeof req.headers['x-bv-proxy'] === 'string' && req.headers['x-bv-proxy'].length > 0,
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Stub': 'shop' });
    res.end(JSON.stringify(echo));
  });
}).listen(PORT, ADDR);
