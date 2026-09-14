/**
 * Vercel Serverless - Charts Proxy
 * Liquidation heatmap + per-exchange list.
 *
 * Source hierarchy (2026-05-13):
 *   1. Spectre Data API `/v1/derivatives/heatmap/` — authoritative when DB is up
 *   2. Spectre `/v1/derivatives/composite/liquidations/{asset}` — events fallback
 *   3. Binance Futures direct synthesizer — works without Hetzner Postgres,
 *      computes a Coinglass-style cluster grid from public OI + klines.
 *      See ./liq-heatmap-binance.js for the math.
 *
 * Frontend (tradersCornerApi.js → use-real-heatmap.js → real-heatmap-chart.js)
 * expects this exact legacy envelope:
 *   { success: true, code: "1", data: { liqHeatMap: { chartInterval, end,
 *     chartTimeArray, priceArray, data: [[col,row,value], ...] } } }
 */

import { buildBinanceLiqHeatmap, buildBinanceLiqMap, buildBinanceCandles } from './liq-heatmap-binance.js'

const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || ''

function symbolToAsset(symbol) {
  // Strip USDT/USD/USDC suffixes — Spectre uses bare ticker (BTC, ETH, ...).
  return String(symbol || 'BTCUSDT').replace(/USDT$|USDC$|USD$/i, '').toUpperCase() || 'BTC'
}

function spectreHeaders() {
  const headers = { accept: 'application/json' }
  if (SPECTRE_API_KEY) headers['X-API-Key'] = SPECTRE_API_KEY
  return headers
}

const _cache = {}
const LIQ_TTL = 120_000   // 2min
const EXL_TTL = 60_000    // 1min

function getCached(key, ttl) {
  const e = _cache[key]
  if (!e || Date.now() - e.ts > ttl) return null
  return e.data
}
function setCache(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181',
  'https://spectre.bot', 'https://trade.spectre.bot',
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const route = req.query.route || ''

  // ── Liquidation MAP ───────────────────────────────────────────────────────
  // The price-axis companion to the heatmap: where the CURRENTLY-standing liq
  // levels sit, split by leverage tier (10/25/50/100x) and side, plus the
  // cumulative long/short curves. Same cohort model as the heatmap — see
  // liq-heatmap-binance.js — projected onto price instead of time.
  if (route === 'liq-map') {
    const symbol = req.query.symbol || 'BTCUSDT'
    const interval = req.query.interval || '1d'
    const cacheKey = `liqmap-${symbol}-${interval}`
    const cached = getCached(cacheKey, LIQ_TTL)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }
    try {
      const hm = await buildBinanceLiqMap(symbol, interval)
      const payload = { success: true, data: hm, _source: 'binance-cohort-map', _computed_at: Date.now() }
      setCache(cacheKey, payload)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(payload)
    } catch (err) {
      console.error('[charts-proxy] liq-map error:', err.message)
      const stale = _cache[cacheKey]
      if (stale) return res.status(200).json(stale.data)
      return res.status(200).json({ success: false, data: null, _error: err.message })
    }
  }

  if (route === 'liq-heatmap') {
    const exchange = req.query.exchange || 'All'
    const symbol = req.query.symbol || 'BTCUSDT'
    const interval = req.query.interval || '1w'
    const leverage = [10, 25, 50, 100].includes(Number(req.query.leverage)) ? Number(req.query.leverage) : null
    const cacheKey = `liq-${exchange}-${symbol}-${interval}-${leverage || 'all'}`
    const cached = getCached(cacheKey, LIQ_TTL)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }

    // Adapter: convert {grid, rows, cols, priceArray, timeArray} -> legacy envelope.
    const toLegacyEnvelope = (hm) => ({
      success: true,
      code: '1',
      data: {
        liqHeatMap: {
          chartInterval: hm.timeframe || interval,
          end: hm.timeArray && hm.timeArray.length ? hm.timeArray[hm.timeArray.length - 1] : Date.now(),
          chartTimeArray: hm.timeArray,
          priceArray: hm.priceArray,
          data: hm.grid.map(g => [g.col, g.row, g.value]),
        },
      },
      _source: hm._source,
      _stats: hm._stats,
    })

    try {
      // 1. The cohort synthesizer is the PRIMARY source (2026-07-28): it is
      // the model the CoinGlass-parity renderer was tuned against, and it is
      // what dev serves — keeping it first keeps prod visually identical to
      // dev. The Spectre heatmap endpoint (different grid model, DB-dependent,
      // wedged since 2026-05-13) is demoted to a fallback below so a revived
      // DB cannot silently swap prod onto an unvetted texture.
      const hm = await buildBinanceLiqHeatmap(symbol, interval, { exchange, leverage })
      const envelope = toLegacyEnvelope(hm)
      setCache(cacheKey, envelope)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(envelope)
    } catch (err) {
      // 2. Synthesizer failed (all venues unreachable) — try Spectre's
      // dedicated heatmap endpoint before degrading.
      try {
        const spResp = await fetch(`${SPECTRE_API_BASE}/v1/derivatives/heatmap/?symbol=${encodeURIComponent(symbol)}`, {
          headers: spectreHeaders(), signal: AbortSignal.timeout(4000),
        }).catch(() => null)
        const spPayload = spResp && spResp.ok ? await spResp.json().catch(() => null) : null
        if (spPayload?.data?.grid && Array.isArray(spPayload.data.grid) && spPayload.data.grid.length > 0) {
          const envelope = toLegacyEnvelope({
            grid: spPayload.data.grid,
            rows: spPayload.data.rows,
            cols: spPayload.data.cols,
            priceArray: spPayload.data.priceArray,
            timeArray: spPayload.data.timeArray,
            timeframe: interval,
            _source: 'spectre-heatmap',
          })
          setCache(cacheKey, envelope)
          res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
          return res.status(200).json(envelope)
        }
      } catch { /* fall through to the degradation path */ }

      console.error('[charts-proxy] liq-heatmap error:', err.message)
      const stale = _cache[cacheKey]
      if (stale) return res.status(200).json(stale.data)
      // Final degradation: empty envelope (frontend renders empty state).
      return res.status(200).json({
        success: true,
        code: '1',
        data: { liqHeatMap: { chartInterval: interval, end: Date.now(), chartTimeArray: [], priceArray: [], data: [] } },
        _source: 'empty',
        _error: err.message,
      })
    }
  }

  if (route === 'exchange-list') {
    const exchange = req.query.exchange || 'Binance'
    const symbol = req.query.symbol || 'BTCUSDT'
    const interval = req.query.interval || '30m'
    const size = req.query.size || '337'
    const cacheKey = `exl-${exchange}-${symbol}-${interval}-${size}`
    const cached = getCached(cacheKey, EXL_TTL)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json(cached)
    }

    try {
      // Real OHLCV candles from Binance Futures — same source as the heatmap
      // so the overlay candles line up with the cluster grid timewise.
      // The frontend `getExternalExchangeList` adapter expects:
      //   data.data = [[openTime, closeTime, open, close, high, low, volume, quoteVolume, trades, takerBuyVolume], ...]
      const { candles } = await buildBinanceCandles(symbol, interval, size)
      const legacyRows = candles.slice(0, parseInt(size, 10) || 337).map((c) => [
        c.time,                                     // openTime
        c.time + 60_000,                            // closeTime (approx; client uses openTime mainly)
        c.open, c.close, c.high, c.low,             // OHLC (note: O,C,H,L order per legacy frontend mapper)
        c.volume,                                   // volume
        c.volume * c.close,                         // quoteVolume (approx)
        0,                                          // trades (unavailable from klines, harmless)
        c.volume / 2,                               // takerBuyVolume (approx; not used by current renderer)
      ])

      const payload = {
        success: true,
        code: '1',
        data: legacyRows,
        exchange,
        symbol,
        interval,
        _source: 'binance-futures-direct',
      }
      setCache(cacheKey, payload)
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
      return res.status(200).json(payload)
    } catch (err) {
      console.error('[charts-proxy] exchange-list error:', err.message)
      const stale = _cache[cacheKey]
      if (stale) return res.status(200).json(stale.data)
      return res.status(200).json({ success: true, code: '1', data: [], exchange, symbol, interval, _source: 'empty', _error: err.message })
    }
  }

  if (route === 'liq-prints') {
    const symbol = req.query.symbol || 'BTCUSDT'
    const hours = Math.max(1, Math.min(168, parseInt(req.query.hours, 10) || 72))
    const cacheKey = `prints-${symbol}-${hours}`
    const cached = getCached(cacheKey, 60_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }
    try {
      const { symbolToAsset, fetchTapeEvents, shapePrintsPayload } = await import('./liq-tape.js')
      const events = await fetchTapeEvents(symbolToAsset(symbol), hours)
      const payload = { success: true, symbol, ...shapePrintsPayload(events, hours) }
      setCache(cacheKey, payload)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(payload)
    } catch (err) {
      console.error('[charts-proxy] liq-prints error:', err.message)
      const stale = _cache[cacheKey]
      if (stale) return res.status(200).json(stale.data)
      return res.status(200).json({ success: true, symbol, events: [], count: 0, truncated: false, window_covered_hours: 0, requested_hours: hours, _error: err.message })
    }
  }

  return res.status(400).json({ error: `Unknown charts-proxy route: ${route}` })
}
