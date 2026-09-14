/**
 * wakeMatch - the "Hey Spectre" phrase matcher (pure, node-testable).
 * Real users don't speak regexes: they say it together ("hey spectre"),
 * with a pause ("hey ... spectre" - which Chrome splits across TWO
 * recognition instances), with a filler ("hey um spectre"), run together
 * ("heyspectre"), or just the name alone after silence ("Spectre?").
 * ASR also respells the name (specter/spector/spectra/sceptre).
 *
 * Model: normalize to words, look at the last 8 across the carry (the
 * previous recognition instance's tail) + the current instance. Wake when:
 *   1. a name word has a greeting within the TWO words before it
 *      (filler-tolerant, pause/restart-boundary tolerant), or
 *   2. a run-together greeting+name single token appears, or
 *   3. the name is essentially ALL the user said since the recognizer
 *      (re)started (<=2 current words) - a deliberate call, not a mention
 *      inside a sentence ("the spectre chart pumped" never wakes).
 */

const GREETINGS = new Set(['hey', 'hi', 'high', 'ok', 'okay', 'yo', 'hello'])
const NAME_RE = /^(spectre|specter|spector|spectra|spektre|spektor|sceptre|scepter)$/
const COMBINED_RE = /^(hey|hi|ok|okay|yo|hello)(spectre|specter|spector|spectra|sceptre|scepter)$/

/** Transcript chunk -> normalized word list (lowercase, alnum only). */
export function wakeWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
}

/**
 * @param {string} currentText - the CURRENT recognition instance's transcript
 * @param {string} carryText - tail carried from the PREVIOUS instance
 *   (a pause recycles Chrome's recognizer mid-phrase), '' when stale
 */
export function matchesWake(currentText, carryText = '') {
  const cur = wakeWords(currentText)
  if (!cur.length) return false
  const words = [...wakeWords(carryText), ...cur].slice(-8)
  const curStart = words.length - Math.min(cur.length, words.length)
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]
    if (COMBINED_RE.test(w)) return true
    if (!NAME_RE.test(w)) continue
    for (let j = Math.max(0, i - 2); j < i; j++) {
      if (GREETINGS.has(words[j])) return true
    }
    if (cur.length <= 2 && i >= curStart) return true
  }
  return false
}
