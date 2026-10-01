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
