// Unit tests for the gate's pure helpers: `node --test test/unit.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../src/lib/manifest.js';
import { aiText } from '../src/lib/ai-text.js';

test('a manifest with whole-line // comments still parses', () => {
  const m = parseManifest('{\n  "opening": "Welcome.",\n  // a note for whoever edits this\n  "maxTurns": 15\n}');
  assert.deepEqual(m, { opening: 'Welcome.', maxTurns: 15 });
});

test('// inside a string value is kept', () => {
  assert.equal(parseManifest('{"checkoutUrl": "https://benevixit.com/x"}').checkoutUrl, 'https://benevixit.com/x');
});

test('a broken manifest is null, so the defaults apply', () => {
  assert.equal(parseManifest('{"opening": "Welcome.",}'), null);
  assert.equal(parseManifest(''), null);
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest('[1, 2]'), null);
});

test('the last of a duplicated key wins, as in plain JSON', () => {
  assert.equal(parseManifest('{"doorLine": "a", "doorLine": "b"}').doorLine, 'b');
});

test('aiText reads every reply shape and never returns reasoning', () => {
  assert.equal(aiText({ response: 'llama' }), 'llama');
  assert.equal(aiText({ choices: [{ message: { content: 'chat', reasoning_content: 'hmm' } }] }), 'chat');
  assert.equal(aiText({
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'thinking aloud' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'responses' }] },
    ],
  }), 'responses');
  assert.equal(aiText({ output_text: 'flat' }), 'flat');
  assert.equal(aiText(null), '');
  assert.equal(aiText({}), '');
});

test('the example manifest is the full shape the gate expects', async () => {
  const { default: m } = await import('../manifest.example.json', { with: { type: 'json' } });
  for (const key of ['chatModel', 'judgeModel', 'opening', 'persona', 'teachAddendum', 'rubric', 'zcashFacts',
    'passThreshold', 'teachThreshold', 'passLine', 'doorLine', 'exhaustedLine', 'brevityLine', 'cooldownMessage']) {
    assert.ok(m[key], `manifest.example.json is missing ${key}`);
  }
});

test('keeper and judge calls ask the AI Gateway not to log or cache them', async () => {
  const { gatewayOptions } = await import('../src/lib/gateway.js');
  assert.deepEqual(gatewayOptions({ GATEWAY_ID: 'gw' }), { gateway: { id: 'gw', collectLog: false, skipCache: true } });
  const { readFileSync } = await import('node:fs');
  for (const f of ['src/gate/session.js', 'src/gate/judge.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/gateway:\s*\{/.test(src), `${f} must use gatewayOptions(), not its own gateway options`);
    assert.ok(src.includes('gatewayOptions('), `${f} must pass gatewayOptions()`);
  }
});

test('the library is consulted with the last visitor turns, and never caches or rewrites them', async () => {
  const { consultLibrary } = await import('../src/gate/library.js');
  let seen;
  const env = { KEEPER_LIBRARY: { search: async (req) => { seen = req; return { chunks: [{ text: ' Viewing keys are read-only. ' }, { text: 'Sapling came in 2018.' }] }; } } };
  const transcript = [
    { role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' }, { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'what is a viewing key?' },
  ];
  const out = await consultLibrary(env, { library: { maxResults: 2 } }, transcript);
  assert.equal(seen.query, 'second\nwhat is a viewing key?');
  assert.equal(seen.ai_search_options.retrieval.max_num_results, 2);
  assert.equal(seen.ai_search_options.cache.enabled, false);
  assert.equal(seen.ai_search_options.query_rewrite.enabled, false);
  assert.match(out, /^From the house library/);
  assert.match(out, /Viewing keys are read-only\.\n---\nSapling came in 2018\./);
});

test('the library fails open: no binding, switched off, an error, a timeout or no match', async () => {
  const { consultLibrary } = await import('../src/gate/library.js');
  const t = [{ role: 'user', content: 'hello' }];
  assert.equal(await consultLibrary({}, {}, t), '');
  let called = false;
  const spy = { KEEPER_LIBRARY: { search: async () => { called = true; return { chunks: [{ text: 'x' }] }; } } };
  assert.equal(await consultLibrary(spy, { library: { enabled: false } }, t), '');
  assert.equal(called, false);
  assert.equal(await consultLibrary({ KEEPER_LIBRARY: { search: async () => { throw new Error('down'); } } }, {}, t), '');
  assert.equal(await consultLibrary({ KEEPER_LIBRARY: { search: () => new Promise(() => {}) } }, { library: { timeoutMs: 20 } }, t), '');
  assert.equal(await consultLibrary({ KEEPER_LIBRARY: { search: async () => ({ chunks: [] }) } }, {}, t), '');
});

test('every library lookup logs its outcome and scores, never the query or the passages', async () => {
  const { consultLibrary } = await import('../src/gate/library.js');
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(s);
  try {
    const t = [{ role: 'user', content: 'my secret question about viewing keys' }];
    await consultLibrary({ KEEPER_LIBRARY: { search: async () => ({ chunks: [{ text: 'passage text', score: 0.612 }] }) } }, {}, t);
    await consultLibrary({ KEEPER_LIBRARY: { search: async () => ({ chunks: [] }) } }, {}, t);
    await consultLibrary({ KEEPER_LIBRARY: { search: () => new Promise(() => {}) } }, { library: { timeoutMs: 20 } }, t);
    await consultLibrary({ KEEPER_LIBRARY: { search: async () => { throw new Error('x'); } } }, {}, t);
  } finally {
    console.log = orig;
  }
  const logged = lines.map((l) => JSON.parse(l));
  assert.deepEqual(logged.map((l) => l.library), ['found', 'no-match', 'timeout', 'error']);
  assert.deepEqual(logged[0].scores, [0.61]);
  assert.ok(!lines.join('').includes('secret') && !lines.join('').includes('passage text'));
});

test('the door notice follows shopOpen, and an empty one shows nothing', async () => {
  const { shopNotice } = await import('../src/lib/manifest.js');
  const m = { openNotice: 'The shop is currently open.', closedNotice: 'The shop is currently closed.' };
  assert.equal(shopNotice({ ...m, shopOpen: true }), 'The shop is currently open.');
  assert.equal(shopNotice({ ...m, shopOpen: false }), 'The shop is currently closed.');
  assert.equal(shopNotice(m), 'The shop is currently open.', 'missing shopOpen means open');
  assert.equal(shopNotice({ ...m, shopOpen: false, closedNotice: '' }), '');
});

test('out of stock reads as closed; an unknown stock changes nothing; the switch wins', async () => {
  const { shopNotice } = await import('../src/lib/manifest.js');
  const m = { openNotice: 'Open.', closedNotice: 'Closed.' };
  assert.equal(shopNotice(m, true), 'Open.');
  assert.equal(shopNotice(m, null), 'Open.');
  assert.equal(shopNotice(m, false), 'Closed.');
  assert.equal(shopNotice({ ...m, soldOutNotice: 'Sold out.' }, false), 'Sold out.');
  assert.equal(shopNotice({ ...m, shopOpen: false }, true), 'Closed.');
});

test('the keeper converses only while the shop is open', async () => {
  const { shopIsOpen } = await import('../src/lib/manifest.js');
  assert.equal(shopIsOpen({}, true), true);
  assert.equal(shopIsOpen({}, null), true, 'unknown stock never shuts the door');
  assert.equal(shopIsOpen({}, false), false);
  assert.equal(shopIsOpen({ shopOpen: false }, true), false);
  assert.equal(shopIsOpen({ shopOpen: true }, false), false, 'sold out closes even when switched open');
});

test('stock is read only from a clean Store API answer', async () => {
  const { parseInStock } = await import('../src/lib/stock.js');
  assert.equal(parseInStock([{ is_in_stock: true }]), true);
  assert.equal(parseInStock([{ is_in_stock: false }]), false);
  assert.equal(parseInStock([]), null);
  assert.equal(parseInStock({ is_in_stock: false }), null);
  assert.equal(parseInStock(null), null);
});

test('no passphrase without KV: the public code holds no fallback word', async () => {
  const { loadManifest } = await import('../src/lib/manifest.js');
  const missing = await loadManifest({ GATE_KV: { get: async () => null } });
  assert.equal(missing.passphrase, '');
  const broken = await loadManifest({ GATE_KV: { get: async () => '{ not json' } });
  assert.equal(broken.passphrase, '');
});

test('proof of work: a solved challenge verifies once-signed, and only when solved', async () => {
  const { mintPowChallenge, verifyPow, leadingZeroBits } = await import('../src/lib/sign.js');
  assert.equal(leadingZeroBits(new Uint8Array([0, 0x0f, 0xff])), 12);
  assert.equal(leadingZeroBits(new Uint8Array([0x80])), 0);
  assert.equal(leadingZeroBits(new Uint8Array([0, 0])), 16);

  const bits = 8;
  const challenge = await mintPowChallenge('s3cret', bits);
  const enc = new TextEncoder();
  let nonce = 0;
  for (;; nonce++) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${nonce}`)));
    if (leadingZeroBits(d) >= bits) break;
  }
  const ok = await verifyPow('s3cret', challenge, String(nonce), bits);
  assert.ok(ok && typeof ok.id === 'string' && ok.exp > Date.now() / 1000);

  assert.equal(await verifyPow('other', challenge, String(nonce), bits), null, 'wrong key');
  assert.equal(await verifyPow('s3cret', challenge, String(nonce), bits + 1), null, 'easier than required');
  assert.equal(await verifyPow('s3cret', challenge, 'abc', bits), null, 'nonce must be digits');
  let wrong = nonce + 1;
  for (;; wrong++) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${wrong}`)));
    if (leadingZeroBits(d) < bits) break;
  }
  assert.equal(await verifyPow('s3cret', challenge, String(wrong), bits), null, 'unsolved');
});

test('daily budget: counts turns, stops at the limit, resets with the day; puzzles redeem once', async () => {
  const { GateBudget, budgetExhausted } = await import('../src/gate/budget.js');
  const store = new Map();
  let alarm = null;
  const ctx = { storage: {
    get: async (k) => store.get(k),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => store.delete(k),
    list: async ({ prefix }) => new Map([...store].filter(([k]) => k.startsWith(prefix))),
    getAlarm: async () => alarm,
    setAlarm: async (t) => { alarm = t; },
  } };
  const b = new GateBudget(ctx, {});

  assert.deepEqual(await b.spend(2), { ok: true, count: 1 });
  assert.deepEqual(await b.spend(2), { ok: true, count: 2 });
  assert.deepEqual(await b.spend(2), { ok: false, count: 2 });
  assert.equal((await b.peek(2)).exhausted, true);
  assert.equal((await b.peek(0)).exhausted, false, '0 means no cap');

  store.set('turns', { day: '2000-01-01', count: 999 });
  assert.deepEqual(await b.spend(2), { ok: true, count: 1 }, 'a new day starts at zero');

  assert.equal(budgetExhausted(5, undefined), false);
  assert.equal(budgetExhausted(5, 5), true);

  const exp = Math.floor(Date.now() / 1000) + 300;
  assert.deepEqual(await b.redeem('abc', exp), { ok: true });
  assert.deepEqual(await b.redeem('abc', exp), { ok: false }, 'single use');
  assert.ok(alarm, 'cleanup alarm armed');
  store.set('pow:old', 1);
  await b.alarm();
  assert.equal(store.has('pow:old'), false, 'expired entries swept');
  assert.equal(store.has('pow:abc'), true, 'live entries kept');
});

test('plain http is sent to https on the real hostnames only; https answers carry HSTS', async () => {
  const worker = (await import('../src/index.js')).default;
  const env = { ASSETS: { fetch: async () => new Response('page') } };

  const plain = await worker.fetch(new Request('http://benevixit.com/faq?x=1'), env);
  assert.equal(plain.status, 301);
  assert.equal(plain.headers.get('Location'), 'https://benevixit.com/faq?x=1');
  const www = await worker.fetch(new Request('http://www.benevixit.com/'), env);
  assert.equal(www.headers.get('Location'), 'https://www.benevixit.com/');

  const secure = await worker.fetch(new Request('https://benevixit.com/faq'), env);
  assert.equal(secure.status, 200);
  assert.match(secure.headers.get('Strict-Transport-Security'), /^max-age=\d+$/);

  const local = await worker.fetch(new Request('http://127.0.0.1:8787/faq'), env);
  assert.equal(local.status, 200, 'local dev stays on http');
  assert.equal(local.headers.get('Strict-Transport-Security'), null);
});
