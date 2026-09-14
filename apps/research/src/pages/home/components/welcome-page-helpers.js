/**
 * Pure helper/formatting functions for WelcomePage - extracted for maintainability.
 */

export const formatWatchlistChange = (change) => {
  const c = typeof change === 'number' ? change : parseFloat(change)
  if (isNaN(c) || !isFinite(c)) return '+0.00%'
  return `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`
}

/**
 * Format a percent-change value compactly so extreme pump/dump tokens
 * (e.g. +2,483,557%) don't blow out the column width and overlap
 * neighboring cells. Threshold ladder:
 *   |v| <  1000  → 2 decimals      e.g.  -97.15  → "-97.15"
 *   |v| < 10000  → integer + K     e.g.   2484   → "2.5K"
 *   |v| < 1e6    → integer + K     e.g.  150000  → "150K"
 *   |v| < 1e9    → integer + M     e.g.  2483557 → "2.48M"
 *   |v| >= 1e9   → integer + B
 * Caller still appends the "%" sign and bull/bear color.
 */
export const formatChange = (change) => {
  const value = typeof change === 'number' ? change : parseFloat(change) || 0
  const abs = Math.abs(value)
  if (!isFinite(value)) return '0.00'
  if (abs < 1000) return value.toFixed(2)
  const sign = value < 0 ? '-' : ''
  if (abs < 1e4)  return `${sign}${(abs / 1e3).toFixed(2)}K`
  if (abs < 1e6)  return `${sign}${(abs / 1e3).toFixed(0)}K`
  if (abs < 1e9)  return `${sign}${(abs / 1e6).toFixed(2)}M`
  if (abs < 1e12) return `${sign}${(abs / 1e9).toFixed(2)}B`
  return `${sign}${(abs / 1e12).toFixed(2)}T`
}

/**
 * Generate a realistic 7-day sparkline from multi-timeframe token data.
 * Each token gets a unique, deterministic curve.
 *
 * @param {number} change24h  — overall 24h change %
 * @param {object} [opts]     — extra per-token data for uniqueness
 * @param {number} opts.seed  — unique id (e.g. row.id)
 * @param {number} opts.change5m
 * @param {number} opts.change1h
 * @param {number} opts.change4h
 */
export const generateSparkline = (change24h, opts = {}) => {
  const POINTS = 24
  const seed = (opts.seed || 0) + 1
  const toFrac = (c) => {
    const n = parseFloat(c)
    if (!isFinite(n) || n === 0) return 0
    return Math.abs(n) > 1 ? n / 100 : n
  }
  const c24 = toFrac(change24h)
  const c12 = toFrac(opts.change12h ?? opts.change12)
  const c4  = toFrac(opts.change4h ?? opts.change6h ?? opts.change4)
  const c1  = toFrac(opts.change1h ?? opts.change1)
  const c5m = toFrac(opts.change5m)

  // Past relative price = current / (1 + change). Current = 1.0.
  const safe = (t, change) => ({ t, v: change ? 1 / (1 + change) : 1 })
  const anchors = [
    safe(0,    c24),
    safe(0.5,  c12 || c24 * 0.5),
    safe(0.83, c4  || c24 * 0.16),
    safe(0.96, c1  || c24 * 0.04),
    safe(0.997, c5m || c1 * 0.08 || 0),
    { t: 1, v: 1 },
  ].filter(a => isFinite(a.v) && a.v > 0)

  // Deterministic pseudo-random per token
  let s = (seed * 9301 + 49297) % 233280
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  const vol = Math.min(Math.abs(c24) * 0.12 + 0.002, 0.012)

  const values = []
  for (let i = 0; i < POINTS; i++) {
    const t = i / (POINTS - 1)
    let a = anchors[0]
    let b = anchors[anchors.length - 1]
    for (let j = 0; j < anchors.length - 1; j++) {
      if (t >= anchors[j].t && t <= anchors[j + 1].t) {
        a = anchors[j]; b = anchors[j + 1]
        break
      }
    }
    const tt = (t - a.t) / Math.max(b.t - a.t, 0.0001)
    const eased = tt * tt * (3 - 2 * tt)
    const interp = a.v + (b.v - a.v) * eased
    const noise = (rand() - 0.5) * 2 * vol
    values.push(interp + noise)
  }
  values[values.length - 1] = 1

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1e-6
  return values.map(v => 10 + ((v - min) / range) * 80)
}

export const getTokenInitials = (symbol) => symbol?.slice(0, 2).toUpperCase() || '??'

export const getHistorySparkline = (price, change, realSparkline = null) => {
  if (realSparkline && Array.isArray(realSparkline) && realSparkline.length > 0) {
    return realSparkline.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
  }
  if (price == null || !Number(price)) return []
  const p = Number(price)
  const ch = change != null ? Number(change) / 100 : 0
  // Generate 72 points (3-hour intervals over 7 days) with realistic noise
  const n = 72
  const startPrice = p / (1 + ch) // estimated price 7 days ago
  const pts = [startPrice]
  // Seeded random from symbol price for consistency
  let seed = Math.abs(Math.round(p * 1000)) % 9999 + 1
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const drift = (p - startPrice) / n
  const volatility = Math.abs(p - startPrice) * 0.08 || p * 0.005
  for (let i = 1; i < n; i++) {
    const noise = (rand() - 0.5) * 2 * volatility
    const prev = pts[i - 1]
    pts.push(Math.max(prev * 0.9, prev + drift + noise))
  }
  // Ensure last point lands at current price
  pts[n - 1] = p
  return pts
}
