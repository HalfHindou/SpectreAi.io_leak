/**
 * Sparkline generation utilities
 * Extracted from WelcomePage for reuse across Discover components
 */

/**
 * Generate sparkline data from a price change direction
 * @param {number} change - Price change percentage (positive or negative)
 * @param {number} points - Number of data points (default 12)
 * @returns {number[]} Array of y-values between 10-90
 */
export function generateSparkline(change, points = 12) {
  const trend = change >= 0 ? 1 : -1
  const data = []
  let value = 50
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    const trendInfluence = trend * progress * 20
    const noise = (Math.random() - 0.5) * 15
    value = Math.max(10, Math.min(90, 50 + trendInfluence + noise))
    data.push(value)
  }
  return data
}

/**
 * Generate sparkline from actual price history
 * @param {number[]} prices - Array of historical prices
 * @returns {number[]} Normalized values between 10-90
 */
export function generateSparklineFromPriceHistory(prices) {
  if (!prices || prices.length < 2) return [50, 50]
  const max = Math.max(...prices)
  const min = Math.min(...prices)
  const range = max - min || 1
  return prices.map(p => 10 + ((p - min) / range) * 80)
}

/**
 * Simple hash function for deterministic seeding
 * @param {string} str - Input string (e.g. token address)
 * @returns {number} Hash value
 */
function hashCode(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * Seeded pseudo-random number generator (mulberry32)
 * @param {number} seed
 * @returns {function} Returns 0-1 float each call
 */
function seededRng(seed) {
  let t = seed + 0x6D2B79F5
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Generate a deterministic sparkline from change direction + seed string
 * Same seed always produces the same curve shape
 * @param {number} change - Price change percentage
 * @param {string} seed - Stable string (e.g. token address)
 * @param {number} points - Number of data points (default 14)
 * @returns {number[]} Array of y-values between 10-90
 */
export function generateSeededSparkline(change, seed, points = 14) {
  const rng = seededRng(hashCode(seed || 'default'))
  const trend = change >= 0 ? 1 : -1
  const data = []
  let value = 45 + rng() * 10
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    const trendInfluence = trend * progress * 22
    const noise = (rng() - 0.5) * 14
    value = Math.max(8, Math.min(92, 50 + trendInfluence + noise))
    data.push(value)
  }
  return data
}

/**
 * Subsample an array to ~targetPoints using even spacing
 * @param {number[]} data - Input array
 * @param {number} targetPoints - Desired output length (default 20)
 * @returns {number[]} Subsampled array
 */
export function subsample(data, targetPoints = 20) {
  if (!data || data.length <= targetPoints) return data || []
  const step = (data.length - 1) / (targetPoints - 1)
  const result = []
  for (let i = 0; i < targetPoints; i++) {
    result.push(data[Math.round(i * step)])
  }
  return result
}

/**
 * Convert sparkline data to SVG polyline points string
 * @param {number[]} data - Sparkline data array
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {number} padding - Padding inside SVG
 * @returns {string} Points string for SVG polyline
 */
export function sparklineToPoints(data, width = 60, height = 24, padding = 2) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  return data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')
}
