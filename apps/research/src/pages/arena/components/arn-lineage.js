/**
 * Lineage — parsed off the book's own name, never assumed.
 *
 * THE RULE THAT MATTERS: a book with no version token in its name has no
 * generation. It does not become "v1.0" because a sibling called itself v1.1.
 * Inferring a generation would put a claim on the page that the data never
 * made, and the whole page is an argument that we do not do that.
 *
 * A family is two or more books sharing a stem AND each carrying a parsed
 * version token. Families collapse to one row (the best-ranked member) with a
 * caret; the others render as indented sub-rows.
 *
 * Vocabulary: a generation REPLACED or SUCCEEDED its predecessor. It never
 * "beat" or "improved on" it — those are claims about skill, and five days of
 * overlap cannot support one.
 */

const VERSION_RE = /[_ ]v?(\d+\.\d+|\d+)$/i

/** → { stem, gen, genLabel } | null when the name carries no version token. */
export function parseGeneration(name) {
  const s = String(name || '')
  const m = s.match(VERSION_RE)
  if (!m) return null
  const stem = s.slice(0, m.index)
  if (!stem) return null
  return { stem, gen: parseFloat(m[1]), genLabel: `v${m[1]}` }
}

const DAY = 864e5

/** Days both books were running at the same time. An open book runs to now. */
export function overlapDays(a, b, now = Date.now()) {
  const aStart = new Date(a.startedAt || 0).getTime()
  const bStart = new Date(b.startedAt || 0).getTime()
  if (!Number.isFinite(aStart) || !Number.isFinite(bStart)) return 0
  const aEnd = a.active ? now : new Date(a.lastSeenAt || 0).getTime() || now
  const bEnd = b.active ? now : new Date(b.lastSeenAt || 0).getTime() || now
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / DAY
}

/**
 * Groups a roster into families. Books without a generation are returned as
 * solo entries — that is the common case and it is not a degraded one.
 *
 * → [{ key, head, members, generations }] where members is generation-descending
 *   for families and a single-element array for everything else.
 */
export function groupFamilies(rows) {
  const byStem = new Map()
  const solo = []

  for (const r of rows) {
    if (!r.generation) { solo.push(r); continue }
    const k = r.generation.stem.toLowerCase()
    if (!byStem.has(k)) byStem.set(k, [])
    byStem.get(k).push(r)
  }

  const out = []
  for (const r of solo) out.push({ key: r.name, head: r, members: [r], generations: 0 })

  for (const [, members] of byStem) {
    if (members.length < 2) {
      // A lone versioned book is not a family. It keeps its generation chip —
      // the token is in its own name — but there is nobody to compare it to.
      out.push({ key: members[0].name, head: members[0], generations: 0, members })
      continue
    }
    const sorted = [...members].sort((a, b) => b.generation.gen - a.generation.gen)
    // The row that represents the family is the best-ranked member, not the
    // newest one — the family's line on the board is its best current claim.
    const head = [...members].sort((a, b) => (b.rdd ?? -Infinity) - (a.rdd ?? -Infinity))[0]
    out.push({ key: `${head.generation.stem}::family`, head, members: sorted, generations: members.length })
  }

  return out
}

/**
 * The one-line delta a family head is allowed to state.
 * Under five days of shared trading there is no comparison to make, and we say
 * so rather than printing a number that means nothing.
 */
export function familyDelta(members, now = Date.now()) {
  if (!members || members.length < 2) return null
  const [newer, older] = [...members].sort((a, b) => b.generation.gen - a.generation.gen)
  const days = overlapDays(newer, older, now)
  const nLabel = newer.generation.genLabel
  const oLabel = older.generation.genLabel

  if (days < 5) {
    const ran = Math.max(0, (now - new Date(newer.startedAt || 0).getTime()) / DAY)
    const d = Math.floor(ran)
    const spoken = d === 0 ? 'less than a day' : d === 1 ? 'one day' : `${d} days`
    return `${nLabel} has traded ${spoken}. Too short to compare.`
  }

  if (!Number.isFinite(newer.returnPct) || !Number.isFinite(older.returnPct)) {
    return `${nLabel} replaced ${oLabel}. Neither has a published return yet.`
  }
  const pp = newer.returnPct - older.returnPct
  const sign = pp > 0 ? '+' : pp < 0 ? '−' : ''
  return `${nLabel} ${sign}${Math.abs(pp).toFixed(1)}pp vs ${oLabel}`
}

/**
 * Config diff between two generations, for the takeover's lineage block.
 * Reports only keys that BOTH configs carry and that actually differ —
 * a key present on one side is a shape change, not a parameter change.
 */
export function configDiff(newer, older) {
  if (!newer || !older) return []
  const out = []
  for (const k of Object.keys(newer)) {
    if (!(k in older)) continue
    const a = newer[k]
    const b = older[k]
    if (a && typeof a === 'object') continue
    if (a === b) continue
    out.push({ key: k, from: b, to: a })
  }
  return out
}
