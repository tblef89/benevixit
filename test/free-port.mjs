// Prints a TCP port that is free on 127.0.0.1 AND on the given second
// loopback address (default 127.0.0.2). The routing harness runs the Worker
// on the first and the stub origin on the second, on the same port, because
// proxyToShop() swaps only the hostname.
//
// The port comes from BELOW the kernel's ephemeral range. A port the kernel
// handed out for a port-0 bind is released before `wrangler dev --port`
// binds it, and in that gap wrangler/workerd's own port-0 listeners
// (inspector, internal sockets) draw from the same range and can take it:
// "Address already in use", before a single test has run. Nothing is ever
// assigned automatically below the range, so only an explicit listener can
// hold a port there, and the check below skips any that does.
import net from 'node:net';
import { readFileSync } from 'node:fs';

const second = process.argv[2] || '127.0.0.2';

// Linux publishes the range; 32768 is its default start (and macOS's is
// higher), so it is the fallback wherever the file is absent.
function ephemeralStart() {
  try {
    const lo = Number(readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/)[0]);
    if (Number.isInteger(lo) && lo > 0) return lo;
  } catch {}
  return 32768;
}
const LOW = 20000;
const HIGH = Math.min(ephemeralStart(), 30000); // exclusive

function tryBind(addr, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, addr, () => s.close(() => resolve(true)));
  });
}

if (HIGH - LOW < 100) {
  process.stderr.write(`free-port: the ephemeral range starts at ${HIGH}, leaving no room below it\n`);
  process.exit(1);
}
for (let i = 0; i < 50; i++) {
  const p = LOW + Math.floor(Math.random() * (HIGH - LOW));
  if ((await tryBind('127.0.0.1', p)) && (await tryBind(second, p))) {
    process.stdout.write(String(p) + '\n');
    process.exit(0);
  }
}
process.stderr.write(`free-port: no port in ${LOW}-${HIGH - 1} free on both 127.0.0.1 and ${second}\n`);
process.exit(1);
