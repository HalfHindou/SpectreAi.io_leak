const api = require('./spectre-api')
const { renderChart } = require('./chart')
const { TIMEFRAMES, TF_FALLBACK } = require('./config')
const guard = require('./guard')

// Rendered-PNG memory cache: hot symbols are duplicate requests.
const pngCache = new Map()

// The 1h/4h candle lanes on the box can be cold (empty or 30s+). Try the
// requested TF, then fall back so the user always gets a chart.
async function getCandles(symbol, tfKey) {
  const tried = []
  const order = [tfKey, ...TF_FALLBACK.filter((t) => t !== tfKey)]
  for (const tf of order) {
    const cfg = TIMEFRAMES[tf]
    if (!cfg) continue
    tried.push(tf)
    try {
      const data = await api.ohlcv(symbol, cfg.interval, cfg.ttlMs)
      if (Array.isArray(data) && data.length >= 10) {
        return { candles: data.slice(-cfg.maxBars), usedTf: tf, fellBack: tf !== tfKey }
      }
    } catch {
      /* try next lane */
    }
  }
  return { candles: null, usedTf: null, fellBack: false, tried }
}

async function chartPng({ symbol, tfKey, themeName, change24h }) {
  // global concurrency cap — protects the box's candle lane from pile-ons
  if (!guard.acquireRender()) return { png: null, busy: true }
  try {
    const { candles, usedTf, fellBack } = await getCandles(symbol, tfKey)
    if (!candles) return { png: null }
    const lastTs = candles[candles.length - 1].time
    const key = `${symbol}|${usedTf}|${lastTs}|${themeName}`
    let png = pngCache.get(key)
    if (!png) {
      png = renderChart({ symbol, tfLabel: TIMEFRAMES[usedTf].label, candles, themeName, change24h })
      pngCache.set(key, png)
      if (pngCache.size > 60) pngCache.delete(pngCache.keys().next().value)
    }
    return { png, usedTf, fellBack, candles }
  } finally {
    guard.releaseRender()
  }
}

module.exports = { chartPng, getCandles }
