/**
 * Arena formatters. Precision scales with the sample — never the other way.
 *
 * Copied (not cross-imported) from the Board's bd-call-card formatters per the
 * build packet: page folders do not reach into each other for presentation.
 *
 * ⚠️ Every number rendered through these lands in a `.arn-num` cell, which is
 * var(--font-mono) + tabular-nums. In the RESEARCH app that token resolves to
 * the system sans stack (design-system.md §B) — which is what we want. Do NOT
 * port this page to the trading app, where it resolves to Geist Mono and its
 * slashed zeros.
 */

/** The sample floor. Below this a book has a record, not a rate. */
export const SAMPLE_FLOOR = 15

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
]

/** Words, not digits, inside a sentence. Falls back to digits past twenty. */
export const words = (n) => (Number.isInteger(n) && n >= 0 && n <= 20 ? WORDS[n] : String(n))
export const Words = (n) => {
  const w = words(n)
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** Equity: 2dp under $1k so a dead book still reads as money ($18.71). */
export function fmtMoney(v) {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const body = abs < 1000 ? `$${abs.toFixed(2)}` : `$${Math.round(abs).toLocaleString('en-US')}`
  // Sign leads the unit ("−$12,986") — "$-12,986" mixes a hyphen into a page
  // that renders true minus signs everywhere else.
  return v < 0 ? `−${body}` : body
}

/** Position size on the tape: $32 / $1.2K / $18M. */
export function fmtSize(v) {
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${Math.round(v)}`
}

/** Returns and realised pnl: 1dp, always signed. */
export function fmtPct(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`
}

/** Drawdowns are a depth, so they always print negative. */
export function fmtDd(v) {
  if (!Number.isFinite(v)) return '—'
  return `−${Math.abs(v).toFixed(1)}%`
}

/** Return per unit of drawdown. 2dp below ten, 1dp above — the ratio stops
 *  deserving two decimals once it is that big. */
export function fmtRdd(v) {
  if (!Number.isFinite(v)) return '—'
  const s = Math.abs(v) >= 10 ? Math.abs(v).toFixed(1) : Math.abs(v).toFixed(2)
  // A value that ROUNDS to zero carries no sign — "+0.00" claims a direction
  // the displayed precision cannot support.
  if (Number.parseFloat(s) === 0) return s
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}`
}

/** A rate never renders at more precision than its sample supports. */
export function fmtRate(pct, n) {
  if (!Number.isFinite(pct)) return '—'
  return `${pct.toFixed(n >= 200 ? 1 : 0)}%`
}

/** 41s / 12m / 4h / 61d — the age vocabulary shared with the module ticker. */
export function fmtAgo(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = ms / 1000
  if (s < 60) return `${Math.max(1, Math.round(s))}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export const agoOf = (iso, now = Date.now()) => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) ? fmtAgo(now - t) : '—'
}

/** "4 August" — the date form used in prose, never in a numeric cell. */
export function fmtDay(iso) {
  const t = iso ? new Date(iso) : null
  if (!t || Number.isNaN(t.getTime())) return null
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** "12 Aug 01:38" — for measured-window captions. */
export function fmtStamp(iso) {
  const t = iso ? new Date(iso) : null
  if (!t || Number.isNaN(t.getTime())) return '—'
  return `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${t
    .toISOString()
    .slice(11, 16)}`
}

/** Duration of a measured window, in the same vocabulary as an age. */
export function fmtSpan(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const h = ms / 3.6e6
  if (h < 48) return `${Math.round(h)} hours`
  return `${Math.round(h / 24)} days`
}

/** close_reason is an additive-only contract enum. An unknown value renders
 *  verbatim rather than being bucketed into something it is not. */
export const CLOSE_REASONS = ['hard_stop', 'trailing_stop', 'doa_stop', 'horizon_end']
export const REASON_LABEL = {
  hard_stop: 'HARD STOP',
  trailing_stop: 'TRAILING',
  doa_stop: 'DOA STOP',
  horizon_end: 'HORIZON',
}
export const reasonLabel = (r) => REASON_LABEL[r] || String(r || '—').toUpperCase().replace(/_/g, ' ')

/** Two-letter book initials for the tape's identity column. */
export function initialsOf(name) {
  const parts = String(name || '').split(/[_\s-]+/).filter(Boolean)
  if (!parts.length) return '··'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Asset labels arrive as either a ticker (ETH) or a slug (the-white-wolf).
 *  Tickers are shown as they are; slugs keep their words. Nothing is invented. */
export function assetLabel(a) {
  const s = String(a || '').trim()
  if (!s) return '—'
  if (/^[A-Z0-9._]{2,10}$/.test(s)) return s
  return s.replace(/[-_]+/g, ' ')
}
