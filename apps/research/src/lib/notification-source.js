/**
 * Strip the syndication source out of a breaking-news headline.
 *
 * Breaking news is aggregated from fast third-party sources. The data-api can
 * bake the origin into the headline as `Display Name (@handle): "tweet text"`.
 * We surface breaking news as Spectre's own feed, so this pulls the clean
 * event text back out (dropping the "Name (@handle):" prefix) — the source
 * name is never shown to the user. The parsed handle/url are still returned
 * for internal use (dedup / confidence), but the UI only reads `cleanTitle`.
 *
 * Returns null when there's no source prefix to strip (already-clean headlines,
 * or any non-breaking category), so callers render the title unchanged.
 */

// `Display Name (@handle): rest…` — handle is 1-15 X-legal chars.
const VIP_TITLE_RE = /^(.+?)\s*\(@([A-Za-z0-9_]{1,15})\):\s*(.*)$/s
// Surrounding straight/curly quotes to strip off the tweet text.
const WRAP_QUOTES_RE = /^["“”‘’']+|["“”‘’']+$/g
// `RT @handle:` retweet marker — the syndicated origin, same class of noise
// as the `Name (@handle):` prefix and equally not part of the event text.
const RT_PREFIX_RE = /^RT\s+@[A-Za-z0-9_]{1,15}:\s*/i
// Trailing shortener / bare URL, plus the dangling "Watch more: 🔗" tail that
// the upstream link-stripper leaves behind when it removes the t.co href.
const TRAILING_LINK_RE = /(?:\s*(?:https?:\/\/\S+|🔗))+\s*$/gu
// A call-to-action left pointing at a link we just removed. The trailing
// colon is REQUIRED — without it this would eat legitimate sentence enders
// ("analysts see more", "here's the full story").
const DANGLING_CTA_RE = /\s*(?:watch|read|see|learn)?\s*(?:more|here|full story|details|thread)\s*:\s*$/i

/**
 * Headline cleaner for any syndicated item (breaking news, X VIP wire).
 *
 * The data-api bakes the origin into the headline as
 * `Display Name (@handle): "tweet text"` and leaves retweet markers + the
 * husk of a stripped t.co link in place. Every surface that prints a headline
 * (bell panel, Intelligence masthead, hero, timeline, article page) wants the
 * EVENT, not the syndication envelope — so this is the one place that peels it.
 *
 * Pure string in / string out, safe on already-clean headlines.
 */
export function cleanSyndicatedText(text) {
  if (!text || typeof text !== 'string') return text
  let out = text.trim()

  const m = out.match(VIP_TITLE_RE)
  if (m) {
    const inner = m[3].trim().replace(WRAP_QUOTES_RE, '').trim()
    if (inner) out = inner
  }

  out = out.replace(RT_PREFIX_RE, '').trim()
  out = out.replace(WRAP_QUOTES_RE, '').trim()
  out = out.replace(TRAILING_LINK_RE, '').trim()
  out = out.replace(DANGLING_CTA_RE, '').trim()
  // An ellipsis left mid-air by an upstream truncation reads as a broken
  // string; a single character is cheaper than re-fetching the full text.
  out = out.replace(/[\s,;:]+$/g, '').trim()

  return out || text.trim()
}

export function parseNotificationSource(notification) {
  if (!notification || notification.category !== 'breaking') return null
  const meta = notification.meta || {}

  let handle = meta.handle || null
  let url = meta.sourceUrl || null
  let displayName = meta.displayName || null
  let cleanTitle = notification.title

  const m = typeof notification.title === 'string' ? notification.title.match(VIP_TITLE_RE) : null
  if (m) {
    displayName = displayName || m[1].trim()
    handle = handle || m[2]
  }
  // Runs whether or not the `Name (@handle):` envelope matched — an RT marker
  // or a dangling link husk can arrive on an otherwise clean headline.
  cleanTitle = cleanSyndicatedText(notification.title)

  if (!handle) return null
  if (!url) url = `https://x.com/${handle}`
  return { handle, displayName, cleanTitle, url }
}
