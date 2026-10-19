/**
 * Gate manifest — all tunable gate behavior, stored in KV under key "manifest".
 * Editing the manifest (persona, rubric, passphrase, thresholds) requires no
 * deploy. manifest.example.json is the full shape and the defaults: a field
 * missing from KV falls back to it, so the gate keeps working on a partial
 * manifest.
 */
import EXAMPLE from '../../manifest.example.json' with { type: 'json' };

const DEFAULTS = { ...EXAMPLE, passphrase: 'BENEVIXIT' };

/**
 * The stored text as a manifest, or null. Whole-line // comments are allowed
 * (and dropped): people annotate the value in the dashboard, and strict JSON
 * would otherwise throw the whole manifest away for a note.
 */
export function parseManifest(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const json = text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  try {
    const m = JSON.parse(json);
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
  } catch (e) {
    console.error('manifest in KV is not valid JSON; using defaults:', e.message);
    return null;
  }
}

export async function loadManifest(env) {
  // A broken hand edit must degrade to defaults, not take the gate down.
  let stored = null;
  try {
    stored = parseManifest(await env.GATE_KV.get('manifest', 'text'));
  } catch (e) {
    console.error('manifest could not be read from KV; using defaults', e);
  }
  return { ...DEFAULTS, ...(stored || {}) };
}

/**
 * The line under the door's letterhead: "shopOpen": true or false in the
 * manifest picks openNotice or closedNotice. Flip it in KV to announce an
 * opening or a closing; no deploy. An empty notice shows nothing.
 */
export function shopNotice(manifest) {
  const text = manifest.shopOpen === false ? manifest.closedNotice : manifest.openNotice;
  return typeof text === 'string' ? text.trim() : '';
}
