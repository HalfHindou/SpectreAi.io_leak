/**
 * Research Zone - Constants & utility functions
 */

export const DEFAULT_SYMBOL = 'BTC'

export const MARKET_FILTERS = [
  { id: 'all', label: 'ALL' },
  { id: 'cex', label: 'CEX' },
  { id: 'dex', label: 'DEX' },
  { id: 'spot', label: 'Spot' },
  { id: 'perpetual', label: 'Perpetual' },
  { id: 'futures', label: 'Futures' },
]

export function formatChange (n) {
  if (n == null || Number.isNaN(n)) return '0.00'
  const x = Number(n)
  return x.toFixed(2)
}

export function formatNewsTime (publishedOn) {
  if (!publishedOn) return ''
  const sec = Math.floor(Date.now() / 1000) - Number(publishedOn)
  if (sec < 60) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`
  return `${Math.floor(sec / 604800)}w`
}

// Grade color mapping for GradeArc and DimensionBar components
export const GRADE_COLORS = {
  'A+': '#10B981', 'A': '#10B981', 'A-': '#34D399',
  'B+': '#FBBF24', 'B': '#F59E0B', 'B-': '#F97316',
  'C+': '#F97316', 'C': '#EF4444', 'C-': '#EF4444',
  'D': '#DC2626', 'F': '#991B1B',
}

// Grade to percentage for arc fill (0-100)
export const GRADE_PCT = {
  'A+': 97, 'A': 90, 'A-': 85,
  'B+': 78, 'B': 70, 'B-': 63,
  'C+': 55, 'C': 48, 'C-': 40,
  'D': 30, 'F': 15,
}

/**
 * Classic pivot point calculation (Technical Chart zone helper).
 * Returns { pivot, s1, s2, s3, r1, r2, r3 } or null when input is invalid.
 */
export function calculatePivotPoints(high, low, close) {
  if (!high || !low || !close) return null
  const h = Number(high)
  const l = Number(low)
  const c = Number(close)
  if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null
  const pivot = (h + l + c) / 3
  return {
    pivot,
    r1: 2 * pivot - l,
    r2: pivot + (h - l),
    r3: h + 2 * (pivot - l),
    s1: 2 * pivot - h,
    s2: pivot - (h - l),
    s3: l - 2 * (h - pivot),
  }
}
