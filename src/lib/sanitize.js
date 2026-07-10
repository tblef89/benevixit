/**
 * Visitor-message sanitizer.
 *
 * The judge sees the transcript rendered as "VISITOR: ...\nKEEPER: ...". A
 * visitor could embed newlines + a forged "KEEPER:" / "SYSTEM:" line to fake
 * an approving turn, or inject a raw JSON verdict, hoping to inflate their
 * score. This neutralises role-label lines and control characters at intake,
 * so the transcript the judge reads can only contain genuine turns. Combined
 * with the code-side score clamp and threshold, the judge cannot be steered
 * into a pass.
 */
const ROLE_LABEL = /\b(keeper|visitor|system|assistant|user|human|ai)[ \t]*:/gi;

export function sanitizeMessage(input) {
  let s = String(input == null ? '' : input);
  // Strip control chars except normal whitespace.
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse any run of newlines to a single space — forged multi-line
  // structure can't survive, and the judge reads one visitor turn as one line.
  s = s.replace(/[\r\n]+/g, ' ');
  // Defuse role labels anywhere (e.g. "KEEPER:") so forged turns can't be
  // injected into the transcript the judge reads.
  s = s.replace(ROLE_LABEL, '$1 ');
  return s.trim();
}
