// Prints a TCP port that is free on 127.0.0.1 AND on the given second
// loopback address (default 127.0.0.2). The routing harness runs the Worker
// on the first and the stub origin on the second, on the same port, because
// proxyToShop() swaps only the hostname.
import net from 'node:net';

const second = process.argv[2] || '127.0.0.2';

function tryBind(addr, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(null));
    s.listen(port, addr, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

for (let i = 0; i < 25; i++) {
  const p = await tryBind('127.0.0.1', 0);
  if (p && (await tryBind(second, p)) === p) {
    process.stdout.write(String(p) + '\n');
    process.exit(0);
  }
}
process.stderr.write(`free-port: no port free on both 127.0.0.1 and ${second}\n`);
process.exit(1);
