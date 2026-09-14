/**
 * Binance Adapter
 * Fetches klines from Binance API for major tokens.
 * Returns normalized OHLCV bars.
 */

// Timeframe -> Binance interval mapping
const INTERVAL_MAP = {
  '1M': '1m', '5M': '5m', '15M': '15m', '30M': '30m',
  '1H': '1h', '4H': '4h', '12H': '12h', '1D': '1d', '1W': '1w',
  // Aliases
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '12h': '12h', '1d': '1d', '1w': '1w',
}

// Interval -> duration in ms (for bar count estimation)
const INTERVAL_MS = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '4h': 14_400_000, '12h': 43_200_000,
  '1d': 86_400_000, '1w': 604_800_000,
}

/**
 * Fetches Binance klines for a symbol with automatic pagination.
 * Binance caps at 1000 bars per request, so for large date ranges
 * we make multiple sequential requests and concat results.
 *
 * @param {string} binanceSymbol - e.g. 'BTCUSDT'
 * @param {string} timeframe - e.g. '1H', '4H', '1D'
 * @param {number} from - Unix timestamp in seconds
 * @param {number} to - Unix timestamp in seconds
 * @returns {Promise<Array<{time, open, high, low, close, volume}>>}
 */
export async function fetchBinanceBars(binanceSymbol, timeframe, from, to) {
  const interval = INTERVAL_MAP[timeframe] || '1h'
  const fromMs = from * 1000
  const toMs = to * 1000
  const barMs = INTERVAL_MS[interval] || 3_600_000
  const estimatedBars = Math.ceil((toMs - fromMs) / barMs)

  // Single request if under 1000 bars
  // /api/binance-klines is a same-origin proxy that normally answers in
  // <300ms - 8s was so loose that a stalled Binance edge left the chart on
  // shimmer for nearly a full UX eternity before falling over to Codex/UDF.
  if (estimatedBars <= 1000) {
    const url = `/api/binance-klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${fromMs}&endTime=${toMs}&limit=1000`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) throw new Error(`Binance ${resp.status}`)
    return normalizeBinanceKlines(await resp.json())
  }

  // Paginated fetch for large ranges (all-time history)
  const allKlines = []
  let cursor = fromMs
  const MAX_PAGES = 20 // safety cap: 20 * 1000 = 20,000 bars max

  for (let page = 0; page < MAX_PAGES; page++) {
    if (cursor >= toMs) break

    const url = `/api/binance-klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${cursor}&endTime=${toMs}&limit=1000`
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!resp.ok) throw new Error(`Binance ${resp.status}`)

    const klines = await resp.json()
    if (!klines || klines.length === 0) break

    allKlines.push(...klines)

    // Move cursor past the last bar's close time
    const lastCloseTime = klines[klines.length - 1][6] // closeTime in ms
    cursor = lastCloseTime + 1

    // If we got fewer than 1000, we've reached the end
    if (klines.length < 1000) break
  }

  return normalizeBinanceKlines(allKlines)
}

/**
 * Transforms Binance kline array format to OHLCV objects.
 * Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
 *
 * @param {Array} klines - Raw Binance klines
 * @returns {Array<{time, open, high, low, close, volume}>}
 */
export function normalizeBinanceKlines(klines) {
  if (!klines || !Array.isArray(klines)) return []

  return klines
    .map(k => ({
      time: Math.floor(k[0] / 1000), // openTime ms -> seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }))
    .filter(b => b.open > 0 && b.close > 0 && !isNaN(b.time))
    .sort((a, b) => a.time - b.time)
}

/**
 * Gets the latest bar for a Binance symbol (real-time update).
 *
 * @param {string} binanceSymbol
 * @param {string} timeframe
 * @returns {Promise<{time, open, high, low, close, volume}|null>}
 */
export async function fetchBinanceLatestBar(binanceSymbol, timeframe) {
  const interval = INTERVAL_MAP[timeframe] || '1h'
  // 2026-05-28 hide-apis: routed through /api/binance-klines (same-origin)
  const url = `/api/binance-klines?symbol=${binanceSymbol}&interval=${interval}&limit=1`

  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!resp.ok) return null

  const klines = await resp.json()
  const bars = normalizeBinanceKlines(klines)
  return bars.length > 0 ? bars[0] : null
}
