/**
 * Sparkline utilities — visual momentum indicators for table rows.
 *
 * NOT a price-history claim. These are stylized direction-of-travel curves used
 * in tiny inline cells (on-chain trending rows, Top Coins fallback) where real
 * 7-day OHLC sparklines aren't available from the data source. The curve shape
 * is deterministic per-token (seeded by symbol/address) so the same row always
 * draws the same wiggle — no flicker on poll updates.
 *
 * Mirror of `apps/trading/src/utils/sparkline.js` so both apps render the same
 * visual language for token rows.
 */

/**
 * Simple deterministic hash → integer (djb2)
 */
function hashCode(str) {
  let hash = 5381
  for (let i = 0; i < (str || '').length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * Seeded PRNG (mulberry32) — same seed always produces the same sequence.
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
 * Stable per-token momentum sparkline. Direction comes from `change`,
 * shape variance from a hash of `seed` (e.g. token address or symbol).
 *
 * @param {number} change - 24h change %
 * @param {string} seed   - stable identifier for deterministic curve
 * @param {number} points - data point count (default 14)
 * @returns {number[]} y-values normalized to 8..92
 */
export function generateSeededSparkline(change, seed, points = 14) {
  const rng = seededRng(hashCode(seed || 'default'))
  const trend = (Number(change) || 0) >= 0 ? 1 : -1
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
