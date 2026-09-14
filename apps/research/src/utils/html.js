/**
 * HTML entity decoding shared across news/intelligence article rendering.
 * Uses the textarea trick when DOM is available; falls back to a regex
 * map for SSR / non-browser contexts.
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return str
  const textarea = typeof document !== 'undefined' && document.createElement('textarea')
  if (textarea) { textarea.innerHTML = str; return textarea.value }
  return str
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
    .replace(/&#038;/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
    .replace(/&#\d+;/g, m => String.fromCharCode(parseInt(m.slice(2, -1))))
}
