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
