/**
 * Screener LITE — shared constants + tiny pure formatters. No React here.
 * Codex Solana networkId is 1399811149 (not a real chain id — Codex's own id).
 */

// Chain filter pills → Codex/Spectre networkIds fed to useTrendingTokens.
export const CHAINS = [
  { id: 'all', label: 'All', nets: [1, 56, 137, 42161, 8453, 10, 1399811149], badge: '' },
  { id: 'eth', label: 'Ethereum', nets: [1], badge: 'ETH' },
  { id: 'base', label: 'Base', nets: [8453], badge: 'BASE' },
  { id: 'sol', label: 'Solana', nets: [1399811149], badge: 'SOL' },
  { id: 'bsc', label: 'BSC', nets: [56], badge: 'BSC' },
  { id: 'arb', label: 'Arbitrum', nets: [42161], badge: 'ARB' },
]

export const NET_BADGE = {
  1: 'ETH', 56: 'BSC', 137: 'POL', 42161: 'ARB', 8453: 'BASE', 10: 'OP', 1399811149: 'SOL',
}

// Market lane: DGEN on-chain vs CEX majors (both via useTrendingTokens tiers).
export const LANES = [
  { id: 'onchain', label: 'On-Chain' },
  { id: 'majors', label: 'Majors' },
]

// Timeframe → which normalized change field to read/sort by (DexScreener set).
export const TFS = [
  { id: '5m', label: '5M', field: 'change5m' },
  { id: '1h', label: '1H', field: 'change1h' },
  { id: '6h', label: '6H', field: 'change6h' },
  { id: '24h', label: '24H', field: 'change24h' },
]

export const CATEGORIES = [
  { id: 'trending', label: 'Trending' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'volume', label: 'Volume' },
]

export const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Compact USD: $1.2M / $945K / $0.00042
export function fmtCompact(v) {
  const n = num(v)
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  if (abs >= 1) return `$${n.toFixed(2)}`
  if (abs >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toPrecision(2)}`
}

// Price with sub-cent precision (leading-zero microcaps).
export function fmtPriceSmart(v) {
  const n = num(v)
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (abs >= 1) return `$${n.toFixed(2)}`
  if (abs >= 0.01) return `$${n.toFixed(4)}`
  if (abs >= 0.0001) return `$${n.toFixed(6)}`
  return `$${n.toExponential(2)}`
}

export function fmtChange(pct) {
  const n = num(pct)
  const s = n >= 0 ? '+' : ''
  return `${s}${n.toFixed(2)}%`
}

// Compact integer: 42,162 → 42.2K
export function fmtInt(v) {
  const n = num(v)
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

// Age from a unix-seconds createdAt → "3d" / "5h" / "12m".
export function fmtAge(createdAt) {
  const t = num(createdAt)
  if (!t) return '—'
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t))
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 2592000) return `${Math.floor(s / 86400)}d`
  return `${Math.floor(s / 2592000)}mo`
}

export function changeCls(pct) {
  const n = num(pct)
  if (n > 0.01) return 'up'
  if (n < -0.01) return 'down'
  return 'flat'
}

// SVG polyline points for a sparkline over [0,w]×[0,h] (h grows downward).
export function sparkPoints(arr, w = 96, h = 28, pad = 2) {
  if (!Array.isArray(arr) || arr.length < 2) return ''
  const vals = arr.map(num)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const step = (w - pad * 2) / (vals.length - 1)
  return vals
    .map((v, i) => {
      const x = pad + i * step
      const y = pad + (h - pad * 2) * (1 - (v - min) / span)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// Deterministic fallback wave when a token has no sparkline (seeded by change).
export function synthSpark(change, n = 24) {
  const dir = num(change) >= 0 ? 1 : -1
  const out = []
  let seed = Math.abs(num(change)) * 7 + 3
  for (let i = 0; i < n; i++) {
    seed = (seed * 9301 + 49297) % 233280
    const noise = (seed / 233280 - 0.5) * 0.4
    out.push(50 + dir * (i / n) * 20 + noise * 20)
  }
  return out
}
