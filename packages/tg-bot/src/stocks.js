// Stocks: name→symbol resolution, Yahoo OHLC charts (via the app's serverless
// lane), per-stock cards with TF switcher + one-tap alerts.
const { InlineKeyboard } = require('grammy')
const api = require('./spectre-api')
const { renderChart } = require('./chart')
const { APP_URL } = require('./config')
const { esc, price, usd, move, pct } = require('./format')

const STOCK_TFS = {
  '1d': { interval: '15m', range: '1d', label: '1D', intraday: true },
  '5d': { interval: '30m', range: '5d', label: '5D', intraday: true },
  '1mo': { interval: '1d', range: '1mo', label: '1M', intraday: false },
  '6mo': { interval: '1d', range: '6mo', label: '6M', intraday: false },
  '1y': { interval: '1wk', range: '1y', label: '1Y', intraday: false },
}
const STOCK_TF_ORDER = ['1d', '5d', '1mo', '6mo', '1y']
const DEFAULT_STOCK_TF = '6mo'

// resolve "nvidia" / "s&p" / "NVDA" → quote
const INDEX_NAMES = { 'sp500': 'SPX', 's&p': 'SPX', 'sandp': 'SPX', 'nasdaq': 'NDX', 'dollar': 'DXY', 'vix': 'VIX' }
async function resolveStock(query) {
  const q = String(query || '').trim().toLowerCase().replace(/[^a-z0-9&]/g, '')
  if (!q) return null
  for (const [name, sym] of Object.entries(INDEX_NAMES)) {
    if (q.includes(name)) return api.stockQuote(sym)
  }
  const direct = await api.stockQuote(q.toUpperCase()).catch(() => null)
  if (direct) return direct
  // name substring over the whole universe
  const rows = (await api.get('/v1/macro/equity-quotes', { ttlMs: 2 * 60e3 }).catch(() => null)) || []
  const hit = rows.find((r) => (r.name || '').toLowerCase().replace(/[^a-z0-9&]/g, '').includes(q))
  return hit ? api.stockQuote(hit.symbol) : null
}

async function stockBars(symbol, tfKey) {
  const cfg = STOCK_TFS[tfKey] || STOCK_TFS[DEFAULT_STOCK_TF]
  const res = await fetch(
    `${APP_URL}/api/stocks/candles?symbol=${encodeURIComponent(symbol)}&interval=${cfg.interval}&range=${cfg.range}`,
    { signal: AbortSignal.timeout(15e3) },
  ).catch(() => null)
  if (!res?.ok) return null
  const json = await res.json().catch(() => null)
  const bars = (json?.bars || []).filter((b) => b.o > 0 && b.c > 0)
  if (bars.length < 5) return null
  return bars.map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v || 0 }))
}

const pngCache = new Map()
async function stockChartPng({ symbol, tfKey, themeName, change24h }) {
  const cfg = STOCK_TFS[tfKey] || STOCK_TFS[DEFAULT_STOCK_TF]
  const candles = await stockBars(symbol, tfKey)
  if (!candles) return null
  const key = `${symbol}|${tfKey}|${candles[candles.length - 1].time}|${themeName}`
  let png = pngCache.get(key)
  if (!png) {
    png = renderChart({ symbol, tfLabel: cfg.label, candles, themeName, change24h, intraday: cfg.intraday, pairLabel: symbol.toUpperCase() })
    pngCache.set(key, png)
    if (pngCache.size > 40) pngCache.delete(pngCache.keys().next().value)
  }
  return png
}

function stockKeyboard(symbol, activeTf) {
  const kb = new InlineKeyboard()
  for (const tf of STOCK_TF_ORDER) {
    const label = STOCK_TFS[tf].label
    kb.text(tf === activeTf ? `· ${label} ·` : label, `sc|${symbol}|${tf}`)
  }
  kb.row()
    .text('🔔 alert +5%', `sa|${symbol}|u`)
    .text('🔔 alert −5%', `sa|${symbol}|d`)
    .url('Spectre ↗', `${APP_URL}/research-zone/${symbol.toLowerCase()}`)
  return kb
}

function stockCaption(q, tfKey) {
  const cfg = STOCK_TFS[tfKey] || STOCK_TFS[DEFAULT_STOCK_TF]
  const lines = [
    `<b>${esc(q.name)}</b> · ${esc(q.symbol)} — <b>${price(q.price)}</b> ${move(q.change24)} 24h`,
    `7d ${pct(q.change7d)}${q.mcap ? ` · MCap ${usd(q.mcap)}` : ''} · <i>${esc(cfg.label)} · ${q.kind === 'index' ? 'index' : 'US stock'}</i>`,
  ]
  return lines.join('\n')
}

module.exports = { resolveStock, stockChartPng, stockKeyboard, stockCaption, STOCK_TFS, STOCK_TF_ORDER, DEFAULT_STOCK_TF }
