/*
 * Potential Gainers - formatting + presentation helpers.
 *
 * Honest-wording rule: every label here frames performance as measured /
 * tracked, never predicted or guaranteed. "Since Signal", "tracked from",
 * "historical exit model" - never "we called", "guaranteed pump", "buy now".
 */

/* ---------- numbers ---------- */

export function formatCompact(value, digits = 1) {
  if (value == null || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(digits)}T`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function formatMarketCap(value) {
  if (value == null || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '-'
  return `$${formatCompact(n, n >= 1e9 ? 2 : 1)}`
}

/* Signed percent for return / WR deltas. `value` is a raw percent number
   (e.g. 34.2 means +34.2%), NOT a 0-1 fraction. */
export function formatSignedPct(value, digits = 1) {
  if (value == null || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}

export function formatPct(value, digits = 1) {
  if (value == null || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toFixed(digits)}%`
}

export function returnTone(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}

/* Coerce to a finite number, or null. Unlike Number(), null / '' / undefined
   stay null instead of silently collapsing to 0 - so a missing return renders
   as "—", never a fake "+0%". */
export function toNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/* ---------- time ---------- */

export function relativeTime(dateStr) {
  if (!dateStr) return '-'
  const stamp = new Date(dateStr).getTime()
  if (!Number.isFinite(stamp)) return '-'
  const diff = Date.now() - stamp
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function formatDayLabel(dateStr) {
  if (!dateStr) return '-'
  const stamp = new Date(dateStr)
  if (!Number.isFinite(stamp.getTime())) return String(dateStr)
  return stamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatHourLabel(dateStr) {
  if (!dateStr) return '-'
  const stamp = new Date(dateStr)
  if (!Number.isFinite(stamp.getTime())) return String(dateStr)
  return `${stamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${stamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
}

/* Absolute local timestamp - "May 14, 03:50 AM". A fixed point in the past,
   used as the timestamped-proof anchor on board cards + receipts. Never
   relative: the entire "we listed it before the move" claim depends on a
   concrete date being visible, not buried in tiny "x ago" text. */
export function formatStamp(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

/* Compact "M/D" axis tick for the win-rate charts. */
export function formatAxisDay(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`)
  if (!Number.isFinite(d.getTime())) return String(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/* Add `n` calendar days to a YYYY-MM-DD string -> YYYY-MM-DD. UTC-anchored so
   it never drifts a day across timezones. Used to synthesize the "pending
   maturation" days that sit after the last fully-aged performance row. */
export function addCalendarDays(ymd, n) {
  const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(d.getTime())) return ymd
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/* ---------- performance-row maturity ---------- */

/* Maturity of a daily /performance row. Prefers the explicit `maturity_status`
   field from the API; falls back to aged-vs-total signal counts when an older
   row predates that field. Drives the matured / partial / pending split on
   both the equity curve and the win-rate chart.
     matured - every signal has finished the 72h proof window
     partial - some signals aged, some still maturing
     pending - nothing aged yet, win rate is pure live mark-to-market */
export function maturityOf(row) {
  const s = row?.maturity_status
  if (s === 'matured' || s === 'partial' || s === 'pending') return s
  const aged = toNumber(row?.aged_signals)
  const sig = toNumber(row?.signals)
  if (aged == null || sig == null || sig <= 0) return 'pending'
  if (aged >= sig) return 'matured'
  if (aged > 0) return 'partial'
  return 'pending'
}

/* ---------- stage ---------- */

/* Stage descriptors. Tone stays neutral-glass per the design system - no
   rainbow colors, no neon. The accent is warm-white depth only. The four
   stages map to the spec: high_conviction / confirmed / early /
   reversal_candidate. */
const STAGE_META = {
  high_conviction: { label: 'High Conviction', cls: 'pg-stage--conviction', rank: 4 },
  confirmed: { label: 'Confirmed', cls: 'pg-stage--confirmed', rank: 3 },
  early: { label: 'Early', cls: 'pg-stage--early', rank: 2 },
  reversal_candidate: { label: 'Reversal Candidate', cls: 'pg-stage--reversal', rank: 1 },
}

export function stageMeta(stage) {
  const key = String(stage || '').toLowerCase()
  return STAGE_META[key] || { label: humanize(stage) || 'Setup', cls: 'pg-stage--early', rank: 0 }
}

export function isReversal(stage) {
  return String(stage || '').toLowerCase() === 'reversal_candidate'
}

/* ---------- lifecycle ---------- */

/* The PG signal lifecycle. `group` buckets each phase into one of the board
   sections (fresh / developing / runner / already_ran / accountability).
   Badge tones stay neutral-glass per the design system - the return numbers
   carry --bull/--bear, never the lifecycle badge itself. */
const LIFECYCLE_META = {
  fresh: { label: 'Fresh', cls: 'pg-life--fresh', group: 'fresh' },
  developing: { label: 'Developing', cls: 'pg-life--developing', group: 'developing' },
  runner: { label: 'Runner', cls: 'pg-life--runner', group: 'runner' },
  already_ran: { label: 'Already moved', cls: 'pg-life--ran', group: 'already_ran' },
  matured_positive: { label: 'Matured', cls: 'pg-life--matured', group: 'accountability' },
  stalled: { label: 'Stalled', cls: 'pg-life--stalled', group: 'accountability' },
  drawdown: { label: 'Drawdown', cls: 'pg-life--drawdown', group: 'accountability' },
}

export function lifecycleMeta(phase) {
  const key = String(phase || '').toLowerCase()
  return LIFECYCLE_META[key]
    || { label: humanize(phase) || 'Signal', cls: 'pg-life--developing', group: 'developing' }
}

/* ---------- risk flags ---------- */

/* Risk flags arrive as snake_case keys. Map the well-known ones to readable
   labels; humanize anything unknown so a new upstream flag never renders raw. */
const RISK_FLAG_LABELS = {
  low_liquidity: 'Low liquidity',
  thin_float: 'Thin float',
  high_volatility: 'High volatility',
  single_author: 'Single-author signal',
  promo_heavy: 'Promo-heavy chatter',
  high_promo_share: 'High promo share',
  short_history: 'Short signal history',
  microcap: 'Microcap',
  unverified_contract: 'Unverified contract',
  recent_listing: 'Recently listed',
  low_author_count: 'Few unique authors',
}

export function riskFlagLabel(flag) {
  if (!flag) return ''
  if (typeof flag === 'object') {
    return flag.label || RISK_FLAG_LABELS[flag.key] || humanize(flag.key) || 'Risk flag'
  }
  const key = String(flag).toLowerCase()
  return RISK_FLAG_LABELS[key] || humanize(flag)
}

/* ---------- reasons ---------- */

/* A reason can be a plain string or an object { label, detail }. Normalize
   to a consistent { text } shape for the reason-bullet renderer. */
export function normalizeReason(reason) {
  if (!reason) return null
  if (typeof reason === 'string') return { text: reason }
  if (typeof reason === 'object') {
    const text = reason.text || reason.label || reason.reason || reason.message || ''
    return text ? { text: String(text), detail: reason.detail || null } : null
  }
  return null
}

/* ---------- generic ---------- */

export function humanize(value) {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim()
  if (!text) return ''
  return text
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/* Score arrives 0-100 or 0-1 depending on field; setup_score is 0-100 per the
   spec. Clamp to a safe 0-100 integer for display + ring math. */
export function clampScore(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const scaled = n > 0 && n <= 1 ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

/* The required disclaimer, kept verbatim in one place so every surface that
   needs it uses the exact approved wording. */
export const MOMENTUM_DISCLAIMER =
  'Momentum signal, not financial advice. Performance uses historical 24h/48h/72h average exit model.'
