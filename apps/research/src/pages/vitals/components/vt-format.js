/**
 * vt-format.js — number and label formatting for VITALS.
 *
 * Kept in one place because the whole page is numbers, and a leaderboard where
 * one column rounds differently from the next reads as broken data.
 */

/** Compact USD: $1.2B / $482m / $58.2k / $940. Null-safe, never prints "NaN". */
export function usd(v, { decimals = null } = {}) {
  if (v == null || !Number.isFinite(v)) return '—'
  const neg = v < 0
  const n = Math.abs(v)
  let out
  if (n >= 1e12) out = `${(n / 1e12).toFixed(decimals ?? 2)}T`
  else if (n >= 1e9) out = `${(n / 1e9).toFixed(decimals ?? 2)}B`
  else if (n >= 1e6) out = `${(n / 1e6).toFixed(decimals ?? (n >= 1e8 ? 0 : 1))}m`
  else if (n >= 1e3) out = `${(n / 1e3).toFixed(decimals ?? (n >= 1e5 ? 0 : 1))}k`
  else out = n.toFixed(decimals ?? (n >= 10 ? 0 : 2))
  return `${neg ? '-' : ''}$${out}`
}

/** Plain compact count: 10,475 → 10.5k. */
export function count(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  // Drop a trailing ".0" so a round power of ten on an axis reads "100k", not "100.0k".
  const trim = (s) => s.replace(/\.0$/, '')
  if (v >= 1e6) return `${trim((v / 1e6).toFixed(1))}m`
  if (v >= 10_000) return `${trim((v / 1e3).toFixed(1))}k`
  return Math.round(v).toLocaleString('en-US')
}

/**
 * Percent change. Above +999% we print "+999%+" rather than a five-digit
 * number — past that point the magnitude stops carrying information and only
 * costs column width.
 */
export function pct(v, { sign = true, decimals = 1 } = {}) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v > 999) return '+999%+'
  if (v < -99.9) return '-100%'
  const s = sign && v > 0 ? '+' : ''
  return `${s}${v.toFixed(Math.abs(v) >= 100 ? 0 : decimals)}%`
}

export function ratio(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1000) return `${Math.round(v)}x`
  return `${v.toFixed(1)}x`
}

/** Format a board value by the board's declared kind. */
export function byKind(v, kind) {
  if (kind === 'pct') return pct(v, { sign: false })
  // A change is signed; a rate is not. Without this case a "+54.4%" fee-growth
  // cell fell through to the dollar formatter and rendered as "$54".
  if (kind === 'chg') return pct(v, { sign: true })
  if (kind === 'count') return count(v)
  if (kind === 'ratio' || kind === 'mult') return ratio(v)
  return usd(v)
}

export const toneOf = (v) => (v == null || !Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down')

/** "2026-08-12" → "Aug 12". */
export function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function daysAgo(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`).getTime()
  if (Number.isNaN(d)) return null
  return Math.round((Date.now() - d) / 86_400_000)
}

/**
 * The lead series colour — the NEUTRAL ink, for chrome and for a chart that is
 * deliberately monochrome (the compare overlay's own column). Warm white on a
 * white plot is invisible, so it flips with the theme.
 *
 * It is NOT the default for a data series any more. Every single-series chart
 * on this page used to fall through to it, which is how a platform page ended
 * up as four white bar charts on black: the page had a palette and spent none
 * of it.
 */
export const leadTone = (dayMode) => (dayMode ? '#0f172a' : '#f5f5f7')

/**
 * THE VITALS SERIES PALETTE — eight hues, ONE fixed order, both themes.
 *
 * Colour on this page does exactly one job per chart: identity (which platform,
 * which chain) or magnitude (how big). Identity takes these eight in order and
 * never cycles — a ninth series folds into the floor rather than borrowing a
 * hue that already belongs to someone.
 *
 * The ORDER is the accessibility mechanism, not decoration. Only neighbouring
 * bands in a stack ever touch, so the set was searched over all 5,040 orderings
 * that keep cyan in front and this one maximises the worst ADJACENT pair under
 * simulated protanopia/deuteranopia. Validated with the data-viz validator
 * against both surfaces:
 *
 *   dark  (#0d0d10) — lightness band PASS, chroma PASS, CVD ΔE 11.3 (≥8),
 *                     normal-vision ΔE 20.3 (≥15), contrast ≥3:1 PASS
 *   light (#ffffff) — every check PASS
 *
 * One set serves both themes: these steps sit inside the dark band (OKLCH L
 * 0.48–0.67) AND the light band, which is why the page no longer needs a second
 * palette that could drift out of step with the first.
 *
 * Reserved and NOT in here: --vt-bull / --vt-bear / --vt-gold. Those mean
 * up, down and caveat everywhere on the page, so a series wearing one would be
 * making a claim about direction it has no business making.
 */
export const SERIES = [
  '#0891B2', // cyan
  '#65A30D', // lime
  '#DB2777', // magenta
  '#D97706', // amber
  '#8B5CF6', // violet
  '#059669', // emerald
  '#3B82F6', // blue
  '#F43F5E', // rose
]

/** How many named series a chart may carry before the tail folds into "the rest". */
export const SERIES_MAX = SERIES.length

/**
 * The remainder — "Everyone else", "Other (12)". A neutral on purpose: it is not
 * an identity, it is what is left, and giving it a hue would put a ninth colour
 * on screen that means "no colour".
 *
 * Neutral is not the same as invisible. In the tide the remainder is the LARGEST
 * band on the chart, and the old warm #2b2a28 sat at 1.5:1 against the card — the
 * biggest single object on the page read as a hole punched in it. Both steps here
 * clear 3:1 on their own surface (3.15:1 dark, 3.00:1 light), which is the mark
 * floor, while staying colourless enough to stay out of the palette's way.
 */
export const restTone = (dayMode) => (dayMode ? '#8f95a3' : '#606070')

/**
 * A single-series chart's ink. Magnitude, not identity — so it takes slot one
 * and every such chart on the page is the same colour, which is what makes two
 * cards side by side comparable at a glance.
 */
export const SERIES_LEAD = SERIES[0]

/**
 * THE OVERLAY SET — up to four platforms drawn on ONE plot.
 *
 * A stack only ever puts NEIGHBOURS side by side; an overlay can put any two
 * lines against each other, so this subset is held to the harder all-pairs test
 * rather than the adjacent one. These four are the best-scoring four-slot subset
 * of SERIES under it: worst pair CVD ΔE 10.3, normal-vision ΔE 21.1, identical
 * in both themes.
 *
 * It also fixes the compare board leading with the theme's ink: a one-platform
 * compare drew a white line, and adding a second repainted nothing but still
 * left the answer to "which line is mine" in a colour that means "chrome".
 */
export const SERIES_OVERLAY = [SERIES[0], SERIES[1], SERIES[2], SERIES[4]]

/**
 * METRIC identity, fixed for the whole page. Fees are cyan on the overview, on
 * the charts tab and in the compare column — one colour per QUANTITY, never per
 * card position, so a reader who has learned "cyan is what users paid" keeps
 * that everywhere and two cards side by side are legible as two things.
 *
 * Every value is a slot from SERIES above, so the metric map inherits the
 * validated palette instead of introducing a ninth hue behind its back.
 */
export const METRIC_TONE = {
  fees: SERIES[0],        // cyan
  revenue: SERIES[4],     // violet
  dexVolume: SERIES[6],   // blue
  perpVolume: SERIES[3],  // amber
  traders: SERIES[2],     // magenta
  userPnl: SERIES[5],     // emerald — and losses still print in --vt-bear
}

/** Deterministic accent per platform so a row keeps its colour across renders. */
export function hueFor(key) {
  let h = 0
  const s = String(key || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return SERIES[h % SERIES.length]
}

export function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
  if (!m) return `rgba(245,245,247,${alpha})`
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`
}
