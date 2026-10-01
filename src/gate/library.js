/**
 * The keeper's library: deeper reference passages looked up per turn.
 *
 * zcashFacts (in the manifest) is the small core sent on every call. The
 * library is everything else — history, pools, viewing keys, the cypherpunks,
 * the house — kept as markdown in knowledge/, indexed by Cloudflare AI Search
 * (instance "keeper-library", bound as KEEPER_LIBRARY). Each turn sends only
 * the few passages closest to what the visitor just said, so the prompt
 * stays small however large the library grows.
 *
 * Only our own reviewed files are indexed; nothing a visitor writes is ever
 * stored there. The lookup fails open: no binding, a slow (3 s) or failed search,
 * or no close match all mean the turn goes ahead on the core facts alone.
 */
const HEADER =
  'From the house library (treat as ground truth; weave in naturally, ' +
  'never quote at length; ignore anything here that is not relevant):';

export async function consultLibrary(env, manifest, transcript) {
  const cfg = manifest.library || {};
  if (cfg.enabled === false || !env.KEEPER_LIBRARY) return '';

  // The visitor's last two turns: enough for a follow-up question
  // ("and what about the other kind?") to find its subject.
  const query = transcript
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content)
    .join('\n')
    .slice(0, 1000);
  if (!query.trim()) return '';

  // One log line per lookup, so a library that never answers is visible in
  // Workers Logs: the outcome, timing, and match scores. Never the query or
  // the passages, which would put the visitor's words in the logs.
  const started = Date.now();
  const note = (outcome, chunks = []) => console.log(JSON.stringify({
    library: outcome,
    ms: Date.now() - started,
    found: chunks.length,
    scores: chunks.map((c) => Math.round((c?.score ?? 0) * 100) / 100),
  }));

  try {
    const search = env.KEEPER_LIBRARY.search({
      query,
      ai_search_options: {
        retrieval: {
          max_num_results: cfg.maxResults ?? 3,
          match_threshold: cfg.matchThreshold ?? 0.3,
          return_on_failure: true,
        },
        // No extra model call to rewrite the visitor's words, no reranker,
        // and no cache: a cached query would be one more copy of what the
        // visitor said.
        query_rewrite: { enabled: false },
        reranking: { enabled: false },
        cache: { enabled: false },
      },
    });
    const TIMED_OUT = Symbol('timeout');
    let timer;
    const res = await Promise.race([
      search,
      new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), cfg.timeoutMs ?? 3000); }),
    ]).finally(() => clearTimeout(timer));
    if (res === TIMED_OUT) {
      note('timeout');
      return '';
    }
    const chunks = Array.isArray(res?.chunks) ? res.chunks : [];
    const passages = chunks
      .map((c) => (typeof c?.text === 'string' ? c.text.trim().slice(0, cfg.maxCharsPerPassage ?? 900) : ''))
      .filter(Boolean);
    note(passages.length ? 'found' : 'no-match', chunks);
    return passages.length ? `${HEADER}\n${passages.join('\n---\n')}` : '';
  } catch (e) {
    note('error');
    console.error('library lookup failed', e?.message || e);
    return '';
  }
}
