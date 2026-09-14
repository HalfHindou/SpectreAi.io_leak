/**
 * Spectre Bars Adapter (formerly Codex Adapter)
 * Fetches OHLCV bars from GET /api/bars - the tiered cascade endpoint
 * (Binance -> Hetzner candle store -> GeckoTerminal -> Codex last-resort).
 *
 * 2026-06-09 (Candle Store Phase 4): previously this POSTed
 * /api/codex { action: 'getBars' }, burning paid Codex quota on EVERY
 * non-Binance chart load and bypassing the free tiers entirely. getBars
 * was the #1 Codex cost line (46% of the bill). /api/bars serves the
 * same bars from free sources first, and unknown addresses auto-register
 * in the candle store for permanent backfill.
 *
 * Includes outlier filtering for DEX data anomalies.
 */

// Timeframe -> TradingView-style resolution used by /api/bars
const RESOLUTION_MAP = {
  '1M': '1', '5M': '5', '15M': '15', '30M': '30',
  '1H': '60', '4H': '240', '12H': '720', '1D': '1D', '1W': '1W',
  // Aliases
  '1m': '1', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '4h': '240', '12h': '720', '1d': '1D', '1w': '1W',
}

/**
 * Fetches OHLCV bars from the /api/bars cascade.
 *
 * @param {string} address - Token contract address
 * @param {number} networkId - Chain network ID (e.g. 1 for ETH, 1399811149 for Solana)
 * @param {string} timeframe - e.g. '1H', '4H'
 * @param {number} from - Unix timestamp in seconds
 * @param {number} to - Unix timestamp in seconds
 * @returns {Promise<{ bars: Array<{time, open, high, low, close, volume}>, source: string|null }>}
 */
export async function fetchSpectreBars(address, networkId, timeframe, from, to) {
  const resolution = RESOLUTION_MAP[timeframe] || '60'

  const params = new URLSearchParams({
    symbol: `${address}:${networkId}`,
    resolution,
    from: String(from),
    to: String(to),
  })
  const resp = await fetch(`/api/bars?${params}`, {
    signal: AbortSignal.timeout(12000),
  })

  if (!resp.ok) throw new Error(`Bars ${resp.status}`)
  const data = await resp.json()

  const bars = normalizeCodexBars(data?.bars || [])
  return { bars: filterOutliers(bars), source: data?.source || null }
}

/**
 * Transforms Codex bar format to universal OHLCV.
 * Codex returns: { t, o, h, l, c, v } (timestamps in seconds)
 *
 * @param {Array} rawBars
 * @returns {Array<{time, open, high, low, close, volume}>}
 */
export function normalizeCodexBars(rawBars) {
  if (!rawBars || !Array.isArray(rawBars)) return []

  return rawBars
    .map(b => ({
      time: b.t || b.time,
      open: parseFloat(b.o || b.open || 0),
      high: parseFloat(b.h || b.high || 0),
      low: parseFloat(b.l || b.low || 0),
      close: parseFloat(b.c || b.close || 0),
      volume: parseFloat(b.v || b.volume || 0),
    }))
    .filter(b => b.close > 0 && !isNaN(b.time))
    .sort((a, b) => a.time - b.time)
}

/**
 * Outlier filter for DEX data.
 * Codex returns on-chain DEX trades which can have anomalous spikes
 * from low-liquidity trades. This clamps bars where price deviates
 * more than 3x from the median of surrounding bars.
 *
 * Same algorithm as server-side filterOutlierBars() in packages/server/index.js.
 *
 * @param {Array} bars - Normalized OHLCV bars
 * @returns {Array} - Cleaned bars
 */
export function filterOutliers(bars) {
  if (!bars || bars.length < 5) return bars

  const WINDOW = 5
  const HIGH_MULT = 3
  const LOW_MULT = 0.2

  return bars.map((bar, i) => {
    const start = Math.max(0, i - WINDOW)
    const end = Math.min(bars.length, i + WINDOW + 1)
    const neighbors = []

    for (let j = start; j < end; j++) {
      if (j !== i && bars[j].close > 0) neighbors.push(bars[j].close)
    }

    if (neighbors.length < 2) return bar

    neighbors.sort((a, b) => a - b)
    const median = neighbors[Math.floor(neighbors.length / 2)]
    if (median <= 0) return bar

    let { time, open, high, low, close, volume } = bar

    const isSpike = high > median * HIGH_MULT || close > median * HIGH_MULT || open > median * HIGH_MULT
    const isDip = low > 0 && low < median * LOW_MULT

    if (isSpike) {
      const clamp = median * 2
      high = Math.min(high, clamp)
      open = Math.min(open, clamp)
      close = Math.min(close, clamp)
      low = Math.min(low, clamp)
    }

    if (isDip) {
      const clamp = median * 0.5
      low = Math.max(low, clamp)
      open = Math.max(open, clamp)
      close = Math.max(close, clamp)
      high = Math.max(high, clamp)
    }

    return { time, open, high, low, close, volume }
  })
}
