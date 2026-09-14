/**
 * Traders Corner — shared formatters and utilities.
 * Extracted from index.jsx for maintainability.
 */

export const fmt = (v, d = 2) => { const n = typeof v === 'string' ? parseFloat(v) : v; return n == null || isNaN(n) ? '—' : n.toFixed(d) }

export const fmtK = v => {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'
  return '$' + v.toFixed(2)
}

export const fmtPrice = v => {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (v >= 1) return '$' + v.toFixed(2)
  return '$' + v.toFixed(4)
}

export const cx = (...a) => a.filter(Boolean).join(' ')

export const formatNewsTime = ts => {
  if (!ts) return ''
  const d = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : new Date(ts).getTime()
  const mins = Math.floor((Date.now() - d) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}
