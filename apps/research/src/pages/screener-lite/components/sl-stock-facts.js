// Pure stock-only helpers for the LITE token panel. Kept free of React and
// network so the perf math / label mapping can be unit-tested in isolation.

// Yahoo hands back its own venue codes ("NYQ", "NMS") - readers know the
// exchange by its brand name.
const YAHOO_EXCHANGE = {
  NYQ: 'NYSE', NYS: 'NYSE', NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NAS: 'NASDAQ',
  PCX: 'NYSE Arca', ASE: 'NYSE American', BTS: 'Cboe BZX', CXI: 'Cboe', NYM: 'NYMEX', CMX: 'COMEX',
}
export function exchangeLabel(code) {
  const c = String(code || '').trim()
  if (!c) return ''
  return YAHOO_EXCHANGE[c.toUpperCase()] || c
}

// Session chip from getMarketStatus() - short label + tone class.
export function sessionChip(status) {
  const s = status?.status
  if (s === 'REGULAR') return { label: 'Market open', tone: 'open', detail: status.closesAt ? `Closes ${status.closesAt}` : '' }
  if (s === 'PRE') return { label: 'Pre-market', tone: 'ext', detail: status.nextOpen || '' }
  if (s === 'POST') return { label: 'After-hours', tone: 'ext', detail: status.nextOpen || '' }
  return { label: 'Market closed', tone: 'closed', detail: status?.nextOpen || '' }
}

// Percent change from the close `n` sessions back to the latest close.
// bars: ascending daily [{ t (sec), o, h, l, c }]. Returns null when the tape
// is too short for the window rather than pretending with a nearer bar.
function pctFrom(bars, idx) {
  if (idx < 0 || idx >= bars.length - 1) return null
  const base = Number(bars[idx]?.c) || 0
  const last = Number(bars[bars.length - 1]?.c) || 0
  if (!(base > 0) || !(last > 0)) return null
  return ((last - base) / base) * 100
}

// Performance strip windows for a stock, from ~1Y of daily bars.
// 1W = 5 sessions, 1M = 21, 3M = 63, YTD = last close of the previous calendar
// year, 1Y = first bar when the tape spans at least ~11 months of sessions.
export function computeStockPerf(bars, now = Date.now()) {
  const arr = Array.isArray(bars) ? bars.filter((b) => Number(b?.c) > 0) : []
  const n = arr.length
  const out = { w1: null, m1: null, m3: null, ytd: null, y1: null }
  if (n < 2) return out
  out.w1 = pctFrom(arr, n - 1 - 5)
  out.m1 = pctFrom(arr, n - 1 - 21)
  out.m3 = pctFrom(arr, n - 1 - 63)
  const year = new Date(now).getUTCFullYear()
  let ytdIdx = -1
  for (let i = n - 1; i >= 0; i--) {
    const t = Number(arr[i].t) || 0
    if (new Date(t * 1000).getUTCFullYear() < year) { ytdIdx = i; break }
  }
  out.ytd = pctFrom(arr, ytdIdx)
  out.y1 = n >= 230 ? pctFrom(arr, 0) : null
  return out
}

// Today's session bar (last daily bar) - fills Open / High / Low when the
// quote payload leaves them at 0/null (Yahoo does for some tickers).
export function todayBar(bars) {
  const arr = Array.isArray(bars) ? bars : []
  const b = arr[arr.length - 1]
  if (!b) return null
  return { open: Number(b.o) || 0, high: Number(b.h) || 0, low: Number(b.l) || 0, close: Number(b.c) || 0, volume: Number(b.v) || 0 }
}

// 0..100 position of `price` inside [lo, hi]; null when the range is degenerate.
export function rangePos(price, lo, hi) {
  const p = Number(price), l = Number(lo), h = Number(hi)
  if (!(p > 0) || !(l > 0) || !(h > l)) return null
  return Math.max(0, Math.min(100, ((p - l) / (h - l)) * 100))
}

// Days until an ISO date (calendar days, floor); null when unparseable.
export function daysUntil(iso, now = Date.now()) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return null
  return Math.floor((t - now) / 86400000)
}

// "buy" / "strong_buy" / "hold" → reader label.
export function recommendationLabel(key) {
  const k = String(key || '').toLowerCase()
  if (!k) return ''
  return { strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell', strong_sell: 'Strong sell' }[k]
    || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

// Plain count with K/M/B/T (shares, employees) - fmtInt stops at M and prints
// "14594.2M" for Apple's float.
export function fmtCount(v) {
  const n = Number(v) || 0
  const a = Math.abs(n)
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}
