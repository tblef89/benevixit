/**
 * The judge — a separate model call that scores the transcript.
 *
 * The judge's output is advisory: the deterministic threshold check in
 * decideVerdict() is what actually gates access. Parse failures fail closed.
 */
export async function judgeTranscript(env, manifest, transcript) {
  const conversation = transcript
    .map((m) => `${m.role === 'user' ? 'VISITOR' : 'KEEPER'}: ${m.content}`)
    .join('\n');

  const res = await env.AI.run(
    manifest.judgeModel,
    {
      messages: [
        { role: 'system', content: manifest.rubric },
        { role: 'user', content: `Transcript:\n${conversation}\n\nJSON verdict:` },
      ],
      max_tokens: 150,
      temperature: 0.1,
    },
    { gateway: { id: env.GATEWAY_ID } },
  );

  // Output shape varies by model: `response` may be a string, or an
  // already-parsed object when the model emits pure JSON (llama-3.3 does
  // this), or OpenAI-style choices. Handle all three.
  const out = res?.response ?? res?.choices?.[0]?.message?.content ?? '';
  if (out !== null && typeof out === 'object') return clampScores(out);
  return parseScores(String(out));
}

function clampScores(raw) {
  const clamp = (n) => (Number.isFinite(+n) ? Math.max(0, Math.min(10, +n)) : 0);
  return {
    sincerity: clamp(raw.sincerity),
    knowledge: clamp(raw.knowledge),
    values: clamp(raw.values),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 300) : '',
  };
}

function parseScores(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('judge output had no JSON:', text.slice(0, 300));
    return null; // fail closed
  }
  try {
    return clampScores(JSON.parse(match[0]));
  } catch {
    console.error('judge JSON did not parse:', match[0].slice(0, 300));
    return null; // fail closed
  }
}

export function decideVerdict(scores, manifest) {
  if (!scores) return { pass: false, teach: false };
  const t = manifest.passThreshold;
  const pass =
    scores.sincerity >= t.sincerity &&
    scores.knowledge >= t.knowledge &&
    scores.values >= t.values;
  // Adaptive gate: sincere but not yet knowledgeable → Keeper shifts to teaching.
  const teach = !pass && scores.sincerity >= manifest.teachThreshold.sincerity;
  return { pass, teach };
}
