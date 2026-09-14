/**
 * World State — formatters.
 *
 * Every number on this page passes through here so the formatting table in the
 * build packet has exactly one implementation. Copied-in rather than
 * cross-imported from another page folder (page folders do not import each
 * other).
 *
 * Two conventions worth knowing before you edit:
 *
 * 1. NEGATIVES USE U+2212 MINUS (−), not the hyphen-minus. The page prints
 *    money and positioning that is frequently negative; the true minus is the
 *    same width as a plus in Inter's tabular figures, so a signed column does
 *    not shift when the sign flips. Right-aligned columns are unaffected
 *    either way, but the tide and COT figures sit mid-sentence.
 *
 * 2. NO CURRENCY CONVERSION. See the note at the top of world-state-page.jsx —
 *    these are USD-denominated policy quantities, and useCurrency() would turn
 *    a Fed balance-sheet figure into a number that exists nowhere.
 */

export const MINUS = '−'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Coerce to a finite number, or null.
 *
 * The explicit null/''/boolean rejection is load-bearing, not defensive noise:
 * `Number(null)`, `Number('')`, `Number([])` and `Number(false)` are all 0, so
 * the obvious one-liner turns every ABSENT field into a confident zero. On a
 * page whose whole argument is that it reports honestly, "no volume recorded"
 * rendering as "$0M" is the exact failure this page exists to avoid.
 */
const num = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Group digits, and render a negative with a true minus. */
function grouped(v, dp = 0) {
  const n = num(v)
  if (n == null) return null
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  return (n < 0 ? MINUS : '') + abs
}

/** `3.63%` — unsigned, 2dp by default. */
export function fmtPct(v, dp = 2) {
  const n = num(v)
  return n == null ? null : `${grouped(n, dp)}%`
}

/**
 * `+2.14%` — signed, 2dp by default.
 * A value that rounds to a flat zero but is not zero steps up one decimal
 * rather than printing `+0.0%`, which would read as "no change" when the
 * source says otherwise (stablecoins ships +0.03% today).
 */
export function fmtSignedPct(v, dp = 2) {
  const n = num(v)
  if (n == null) return null
  let d = dp
  if (n !== 0 && Math.abs(n) < 0.5 / 10 ** dp) d = dp + 1
  const sign = n > 0 ? '+' : n < 0 ? MINUS : ''
  return `${sign}${Math.abs(n).toFixed(d)}%`
}

/** `$5,841B` — 0dp, unsigned. */
export function fmtUsdB(v) {
  const n = num(v)
  return n == null ? null : `$${Math.abs(Math.round(n)).toLocaleString('en-US')}B`
}

/** `−$119B` — the sign leads the currency mark, as a ledger prints it. */
export function fmtSignedUsdB(v) {
  const n = num(v)
  if (n == null) return null
  const sign = n > 0 ? '+' : n < 0 ? MINUS : ''
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}B`
}

/** 0.48 (percent) → `+48bp`. Curve spreads arrive as percent, are read as bp. */
export function fmtBp(v) {
  const n = num(v)
  if (n == null) return null
  const bp = Math.round(n * 100)
  const sign = bp > 0 ? '+' : bp < 0 ? MINUS : ''
  return `${sign}${Math.abs(bp).toLocaleString('en-US')}bp`
}

/** `20,143` */
export function fmtInt(v) {
  return grouped(v, 0)
}

/** `+2,542` / `−7,240` */
export function fmtSignedInt(v) {
  const n = num(v)
  if (n == null) return null
  const sign = n > 0 ? '+' : n < 0 ? MINUS : ''
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('en-US')}`
}

/** `$63,136` — spot price, 0dp above 100, 2dp below. */
export function fmtPx(v) {
  const n = num(v)
  if (n == null) return null
  const dp = Math.abs(n) >= 100 ? 0 : 2
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
}

/** `104.32` — index level, 2dp, unsigned. */
export function fmtLevel(v) {
  const n = num(v)
  return n == null ? null : Math.abs(n).toFixed(2)
}

/**
 * `$24M` / `$0.4M` — prediction-market volume.
 * Sub-$1M keeps a decimal because that digit is the whole point: it is the n
 * behind the probability.
 */
export function fmtVol(m) {
  const n = num(m)
  if (n == null) return null
  // Zero prints as an em dash: the NO VOL chip already states it, and "$0M"
  // reads as a formatted quantity rather than an absence.
  if (n === 0) return '—'
  if (n > 0 && n < 1) return `$${n.toFixed(1)}M`
  return `$${Math.round(n).toLocaleString('en-US')}M`
}

/**
 * yes_pct — 0dp, and 1dp only when there is enough money behind the market to
 * justify the extra digit (packet: precision scales with sample).
 */
export function fmtYes(pct, volM) {
  const n = num(pct)
  if (n == null) return null
  const v = num(volM)
  const dp = v != null && v >= 50 ? 1 : 0
  return `${n.toFixed(dp)}%`
}

/** `6 Aug` */
export function fmtDay(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`
}

/** `7 August` — the long form used in source lines and footnotes. */
export function fmtLongDay(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** `14:22 UTC` */
export function fmtUtc(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

/** `4h ago` — coarse by design; the exact stamp is printed beside it. */
export function fmtAgo(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** `7 hours` / `3 days` — a duration, for prose that already supplies the verb. */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'}`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} ${h === 1 ? 'hour' : 'hours'}`
  const d = Math.floor(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'}`
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve']

/** Small counts spelled out — the balance footnote is prose, not a readout. */
export function numWord(n) {
  const v = num(n)
  if (v == null || v < 0) return null
  return v <= 12 ? WORDS[Math.round(v)] : String(Math.round(v))
}

/**
 * Trailing-punctuation trim for headline text that arrives clipped from the
 * source (`… (Filer) — Filed:`). Punctuation only — never words, so nothing
 * the source said is lost.
 */
export function trimDangling(s) {
  let out = String(s || '').trim()
  /* A trailing colon means the source clipped mid-label ("… (Filer) — Filed:").
     The dash-clause that colon introduced is incomplete, so it goes with it —
     but only in that case, and only when the fragment is short enough to be a
     label rather than a sentence. */
  if (out.endsWith(':')) out = out.replace(/\s*[—–-]\s*[^—–]{0,20}:$/u, '')
  return out.replace(/[\s—–:;,-]+$/u, '').trim()
}

export const isNum = (v) => num(v) != null
export const toNum = num
