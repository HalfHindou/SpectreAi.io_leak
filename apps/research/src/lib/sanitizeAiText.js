/**
 * AI text sanitizer - normalizes punctuation that LLMs love but Spectre's
 * editorial style rejects.
 *
 * - em-dash (—, U+2014) → regular dash ( - )
 * - en-dash (–, U+2013) → regular dash ( - )
 * - horizontal bar (―, U+2015) → regular dash ( - )
 *
 * Pad with spaces when the replacement lands between word characters so
 * "word—word" becomes "word - word", not "word-word".
 */
export function sanitizeAiText(text) {
  if (text == null) return text
  if (typeof text !== 'string') return text
  return text
    .replace(/\s*[\u2014\u2013\u2015]\s*/g, ' - ')
    .replace(/ {2,}/g, ' ')
}

/** Deep clone that sanitizes every string field encountered. */
export function sanitizeAiObject(value) {
  if (value == null) return value
  if (typeof value === 'string') return sanitizeAiText(value)
  if (Array.isArray(value)) return value.map(sanitizeAiObject)
  if (typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) out[k] = sanitizeAiObject(value[k])
    return out
  }
  return value
}

export default sanitizeAiText
