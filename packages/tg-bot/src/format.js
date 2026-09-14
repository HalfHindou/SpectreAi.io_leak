// HTML + number formatting helpers for Telegram messages (parse_mode: HTML)

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Price formatting: sensible significant digits across 12 orders of magnitude
function price(n) {
  if (n == null || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (abs === 0) return '$0'
  // sub-$1: keep 4 significant digits (handles $0.004213 and $0.00000814)
  const digits = Math.max(2, 3 - Math.floor(Math.log10(abs)))
  return '$' + n.toFixed(Math.min(digits, 12))
}

// Compact USD for mcap/volume: $1.29T, $28.1B, $170.2M, $95K
function usd(n) {
  if (n == null || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K'
  return price(n)
}

function compact(n) {
  if (n == null || !isFinite(n)) return '—'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}

function pct(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return sign + n.toFixed(digits) + '%'
}

function arrow(n) {
  if (n == null || !isFinite(n) || n === 0) return ''
  return n > 0 ? '▲' : '▼'
}

// ▲ +2.44% styled as one unit
function move(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—'
  return `${arrow(n)} ${pct(n, digits)}`
}

function ago(ts) {
  const ms = Date.now() - new Date(ts).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

module.exports = { esc, price, usd, compact, pct, arrow, move, ago }
