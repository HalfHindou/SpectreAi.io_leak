/**
 * Outcome naming + leader selection shared by the grid card, the hero and the
 * detail page. Polymarket multi-outcome events come in two shapes:
 *
 *   candidates  "Will JD Vance win the 2028 election?"      -> "JD Vance"
 *   ladders     "Will Russia capture Lyman by September 30?" -> "September 30"
 *               "Will Russia capture Lyman by December 31?"  -> "December 31"
 *
 * The ladder case is the one that used to leak the whole question into the
 * verdict chip ("Lean Will Russia capture Lyman by September 30, 2026"). Every
 * sibling shares a long prefix, so the differentiating tail is the name.
 */

const WIN_RX = /^will\s+(.+?)\s+win\b/i
const PLACEHOLDER_RX = /^(person|candidate|team)\s+[a-z0-9]{1,3}\b|^(another|any other|some other|the field|someone else|other)\b/i

function clean(s) {
  return String(s || '').replace(/\?+$/, '').trim()
}

// Longest common word-prefix across a set of labels ('' when < 2 words).
function commonWordPrefix(labels) {
  const lists = labels.map((l) => clean(l).split(/\s+/))
  if (lists.length < 2 || lists.some((w) => w.length < 2)) return ''
  const first = lists[0]
  let n = 0
  while (n < first.length && lists.every((w) => w[n] && w[n].toLowerCase() === first[n].toLowerCase())) n++
  // Never swallow a whole label - keep at least one word of every sibling.
  if (lists.some((w) => w.length <= n)) n = Math.min(n, Math.min(...lists.map((w) => w.length)) - 1)
  return n >= 2 ? first.slice(0, n).join(' ') : ''
}

/**
 * Short display name for one outcome.
 * @param {string} raw       outcome label / question
 * @param {object} [opts]
 * @param {string[]} [opts.siblings]  every outcome label of the same event
 * @param {string} [opts.title]       event title (stripped as a fallback)
 */
export function outcomeName(raw, { siblings = [], title = '' } = {}) {
  const label = clean(raw)
  if (!label) return ''
  const win = label.match(WIN_RX)
  if (win) return win[1].trim()
  if (siblings.length > 1) {
    const prefix = commonWordPrefix(siblings)
    if (prefix && label.toLowerCase().startsWith(prefix.toLowerCase())) {
      const tail = label.slice(prefix.length).trim().replace(/^[,:;-]\s*/, '')
      if (tail) return tail
    }
  }
  const noTitle = title ? label.replace(clean(title), '').trim() : label
  return (noTitle || label).replace(/^will\s+/i, '').trim() || label
}

export function isPlaceholderName(name) {
  return PLACEHOLDER_RX.test(name || '')
}

function rawLabel(o) {
  return o?.label || o?.question || ''
}

/** Display name for an outcome object inside its event. */
export function outcomeLabel(o, ev) {
  return outcomeName(rawLabel(o), {
    siblings: (ev?.outcomes || []).map(rawLabel),
    title: ev?.title || '',
  })
}

/**
 * The outcome the verdict should lean on: highest Yes among real (non
 * placeholder) outcomes. Binary events return their only outcome.
 */
export function leadOutcome(ev) {
  const outcomes = ev?.outcomes || []
  if (outcomes.length <= 1) return outcomes[0] || null
  const real = outcomes.filter((o) => !isPlaceholderName(outcomeLabel(o, ev)))
  const pool = real.length ? real : outcomes
  return pool.reduce((best, o) => ((o.yesPct || 0) > (best.yesPct || 0) ? o : best), pool[0])
}
