/**
 * Traders Corner — Derivatives data service
 * Primary: Spectre Derivatives Aggregator v2 (6 exchanges, free)
 * Fallback: Direct exchange API calls via server proxy
 */
import {
  getSpectreFuturesBasis,
  getSpectreFundingRates,
  getSpectreTakerPressure,
  getSpectreOpenInterest,
  getSpectreLongShortRatio,
  getSpectreLiquidationWindows,
  getSpectreCmeCot,
  getSpectreLiquidationEvents,
  lastSpectreOkAt,
} from '@/services/spectreMarketApi'
import { isDev } from '@/utils/env'

// Aggregator (standalone service on port 3847, proxied via Vite)

// Direct exchange proxies (through Express server, for fallback + history endpoints)
const BINANCE_FUTURES = '/api/derivatives/binance'
const BINANCE_SPOT = '/api/derivatives/binance-spot'
const BINANCE_FUTURES_DIRECT = 'https://fapi.binance.com'
const BINANCE_SPOT_DIRECT = 'https://api.binance.com'
const BYBIT = '/api/derivatives/bybit'
const OKX = '/api/derivatives/okx'
const DERIBIT = '/api/derivatives/deribit/api/v2/public'

const TOP_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT', 'SUIUSDT', '1000PEPEUSDT']

// ── Cache layer ──
// In-flight dedup matters here: the page mounts ~10 fetchers in parallel and
// some of them (getSpectreOpenInterest in particular) get called from multiple
// public functions. Without dedup the first 500ms after mount would fire the
// same upstream query twice.
const cache = new Map()
const inflight = new Map()

function cached(key, ttl, fetcher) {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.ts < ttl) return Promise.resolve(entry.data)
  if (inflight.has(key)) return inflight.get(key)
  const promise = fetcher().then(data => {
    cache.set(key, { data, ts: Date.now() })
    inflight.delete(key)
    return data
  }).catch(err => {
    inflight.delete(key)
    // Return stale cache on error
    if (entry) return entry.data
    throw err
  })
  inflight.set(key, promise)
  return promise
}

/**
 * The live tier's cache keys, and the honest answer to "how old is what I am
 * looking at".
 *
 * Two things conspire to make this harder than reading a timestamp:
 *
 *   1. `cached()` answers a FAILED fetch with the last good payload, so the
 *      call site cannot tell a healthy poll from a dead one.
 *   2. Worse, these fetchers never even reach that path. Each one catches its
 *      own errors and rebuilds a full payload out of INNER cached lanes — so
 *      with the network aborted outright, `funding-rates` still resolves with
 *      100 symbols and gets stamped fresh. Measured 2026-08-24: the header
 *      re-stamped itself "1s ago" every 30s with the wire unplugged.
 *
 * Payload shape therefore proves nothing, and neither does a resolved promise.
 * The only fact that does is a real HTTP response, which both transports now
 * record. So freshness is the OLDER of:
 *
 *   - the oldest live-lane cache write (a lane can lag even on a good network)
 *   - the last successful network response (nothing can be fresher than this)
 *
 * Taker volume is excluded from the lane set on purpose: its TTL is 60s against
 * a 15s poll, so including it would report the board a minute old in perfect
 * health. These four all sit at 10-15s, the cadence the header describes.
 */
export const LIVE_TIER_KEYS = ['funding-rates', 'open-interest', 'ls-ratios', 'liquidations']

export function dataFreshAt(keys = LIVE_TIER_KEYS) {
  let oldest = null
  for (const key of keys) {
    const entry = cache.get(key)
    if (!entry) continue
    if (oldest === null || entry.ts < oldest) oldest = entry.ts
  }
  const netOk = Math.max(_lastFetchOkAt ?? 0, lastSpectreOkAt() ?? 0) || null
  if (oldest === null && netOk === null) return null
  if (oldest === null) return new Date(netOk)
  if (netOk === null) return new Date(oldest)
  return new Date(Math.min(oldest, netOk))
}

// 8s was too long: Spectre v1 normally answers in <600ms. When it stalls we
// want to fail over to the aggregator / direct exchanges fast, not block the
// whole page for the full TCP timeout.
// The moment a real response last landed on this module's own transport. See
// dataFreshAt for why a resolved promise is not evidence of that.
let _lastFetchOkAt = null

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(3500) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  _lastFetchOkAt = Date.now()
  return res.json()
}

// Market-wide OI / 24h-liquidation totals.
// 🪤 These endpoints are NAMED /api/coinglass/* but there is no
// COINGLASS_API_KEY configured in any environment, so `fetchCoinglass()`
// always throws and both fall back to OUR OWN Spectre aggregate. Do not
// claim parity with coinglass.com off the back of them — our exchange
// coverage is narrower (OKX + Bybit on the liquidation tape vs CoinGlass's
// ~12 venues), so the totals are legitimately smaller. They are internally
// consistent, which is what matters; they are not a CoinGlass mirror.
// 30s cache is enforced server-side; we also cache the parsed totals here.
async function getCoinglassTotalOI() {
  return cached('cg-total-oi', 30_000, async () => {
    const d = await fetchJSON('/api/coinglass/total-oi')
    const rows = Array.isArray(d?.data) ? d.data : []
    return rows.reduce((s, r) => s + (Number(r?.open_interest_usd) || 0), 0)
  }).catch(() => 0)
}
async function getCoinglassTotalLiq24h() {
  return cached('cg-total-liq-24h', 30_000, async () => {
    const d = await fetchJSON('/api/coinglass/total-liquidations?range=24h')
    const rows = Array.isArray(d?.data) ? d.data : []
    let long = 0, short = 0
    for (const r of rows) {
      long  += Number(r?.long_liquidation_usd  ?? r?.long_liquidation_usd_24h  ?? 0) || 0
      short += Number(r?.short_liquidation_usd ?? r?.short_liquidation_usd_24h ?? 0) || 0
    }
    return { long, short, total: long + short }
  }).catch(() => ({ long: 0, short: 0, total: 0 }))
}

function baseAsset(symbol = 'BTCUSDT') {
  return String(symbol || '').replace(/USDT$/i, '').toUpperCase()
}

/**
 * Fan a single CURRENT reading across N hourly timestamps.
 *
 * This is a placeholder for a chart that needs points, not history — every
 * point carries the same value, so any change-over-time computed from it is
 * exactly 0 and any sparkline drawn from it is a flat line. That was reaching
 * users as "Open Interest +0.00%" over a shapeless spark (reported 2026-08-24).
 *
 * Every point is stamped `synthetic: true` so a consumer can tell the
 * difference. Callers that render a trend or a delta MUST check it — see
 * isSyntheticSeries.
 */
function syntheticSeries(length, mapper) {
  const count = Math.max(1, Number(length) || 1)
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    ...mapper(now - (count - 1 - i) * 3600_000, i),
    synthetic: true,
  }))
}

/** True when a series is the flat placeholder above rather than real history. */
export function isSyntheticSeries(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows[0]?.synthetic === true
}

async function getBinanceFuturesKlines(symbol, interval, limit) {
  const path = `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const spotPath = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  if (isDev) {
    return fetchJSON(`${BINANCE_SPOT_DIRECT}${spotPath}`)
  }
  try {
    return await fetchJSON(`${BINANCE_FUTURES}${path}`)
  } catch (proxyError) {
    return fetchJSON(`${BINANCE_FUTURES_DIRECT}${path}`)
      .catch(() => fetchJSON(`${BINANCE_SPOT_DIRECT}${spotPath}`))
  }
}

// ── Funding Rates (Aggregator primary - Binance+Bybit+OKX) ──
export async function getFundingRates() {
  return cached('funding-rates', 15_000, async () => {
    try {
      const spectre = await getSpectreFundingRates()
      const rates = {}
      for (const row of spectre.rows || []) {
        const sym = String(row.asset || row.symbol || '').replace(/USDT$/, '').toUpperCase()
        const rate = Number(row.rate ?? row.weighted_funding_rate)
        if (!sym || !Number.isFinite(rate)) continue
        rates[sym] = {
          Spectre: rate * 100,
          _avg: rate * 100,
          _annualized: rate * 100 * 3 * 365,
          _signal: rate > 0.0005 ? 'longs_pay' : rate < -0.0005 ? 'shorts_pay' : 'balanced',
        }
      }
      if (Object.keys(rates).length > 0) return rates
    } catch (_) { console.error(_) }

    // NOTE: the `/api/deriv-agg/*` tier that used to sit here is GONE. It 404s
    // at every layer — no Express route, the single `/api/deriv-agg` Vercel
    // rewrite never matched the sub-paths, and the box itself has no
    // `/api/deriv-agg` (the real lane is `/v1/derivatives/*`, used above).
    // Keeping it only cost a guaranteed-failing request + a console warning on
    // every page load before the working fallback ran.

    // Fallback: direct exchange calls
    const [binance, bybit] = await Promise.allSettled([
      fetchJSON(`${BINANCE_FUTURES}/fapi/v1/premiumIndex`),
      fetchJSON(`${BYBIT}/v5/market/tickers?category=linear`),
    ])

    const rates = {}
    if (binance.status === 'fulfilled') {
      for (const item of binance.value) {
        const sym = item.symbol.replace('USDT', '')
        if (!rates[sym]) rates[sym] = {}
        rates[sym].Binance = parseFloat(item.lastFundingRate) * 100
      }
    }
    if (bybit.status === 'fulfilled') {
      for (const item of (bybit.value.result?.list || [])) {
        const sym = item.symbol.replace('USDT', '')
        if (!rates[sym]) rates[sym] = {}
        if (item.fundingRate) rates[sym].Bybit = parseFloat(item.fundingRate) * 100
      }
    }
    for (const sym of Object.keys(rates)) {
      const vals = Object.values(rates[sym]).filter(v => !isNaN(v))
      rates[sym]._avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    }
    return rates
  })
}

// ── Open Interest (Aggregator primary - Binance+Bybit+OKX) ──
export async function getOpenInterest() {
  return cached('open-interest', 15_000, async () => {
    // The market-wide OI headline comes from the aggregate endpoint (see the
    // note on getCoinglassTotalOI — it is our own number, not CoinGlass's).
    // Per-asset breakdown still comes from Spectre below so the asset table
    // stays populated.
    // Run the CG total and the Spectre per-asset query in parallel -
    // they're independent so sequential awaits were ~400-600ms of pure dead time.
    const [cgTotalOI, spectreResult] = await Promise.all([
      getCoinglassTotalOI(),
      getSpectreOpenInterest().catch((err) => { console.error(err); return null }),
    ])
    try {
      const spectre = spectreResult
      if (!spectre) throw new Error('spectre-oi-unavailable')
      const coins = (spectre.rows || [])
        .map((row) => ({
          symbol: String(row.asset || row.symbol || '').replace(/USDT$/, '').toUpperCase(),
          oiUsd: Number(row.oi_usd || 0),
          price: Number(row.price || 0),
          binance: 0,
          bybit: 0,
          okx: 0,
          bitget: 0,
          gateio: 0,
          htx: 0,
          deribit: 0,
          mexc: 0,
          coinex: 0,
          phemex: 0,
          bingx: 0,
          kraken: 0,
        }))
        .filter((row) => row.symbol && row.oiUsd > 0)
        .sort((a, b) => b.oiUsd - a.oiUsd)
      if (coins.length > 0) {
        // Prefer the server-aggregated total (all 680+ assets, 16 exchanges).
        // Falling back to summing `coins` would undercount because the API
        // returns a 100-row page slice.
        const pageSum = coins.reduce((sum, row) => sum + row.oiUsd, 0)
        const spectreTotal = Number(spectre.totalUsd) > pageSum ? Number(spectre.totalUsd) : pageSum
        return {
          coins,
          // aggregate total wins over the paged sum when it's available
          total: cgTotalOI > 0 ? cgTotalOI : spectreTotal,
          exchangeTotals: {},
          assetCount: Number(spectre.totalAssets) || coins.length,
          source: cgTotalOI > 0 ? 'coinglass+spectre' : 'spectre-market',
        }
      }
    } catch (_) { console.error(_) }

    // NOTE: the `/api/deriv-agg/*` tier that used to sit here is GONE. It 404s
    // at every layer — no Express route, the single `/api/deriv-agg` Vercel
    // rewrite never matched the sub-paths, and the box itself has no
    // `/api/deriv-agg` (the real lane is `/v1/derivatives/*`, used above).
    // Keeping it only cost a guaranteed-failing request + a console warning on
    // every page load before the working fallback ran.

    // Fallback: direct Binance + Bybit
    const [binancePremium, bybitTickers] = await Promise.allSettled([
      fetchJSON(`${BINANCE_FUTURES}/fapi/v1/premiumIndex`),
      fetchJSON(`${BYBIT}/v5/market/tickers?category=linear`),
    ])

    const priceMap = {}
    if (binancePremium.status === 'fulfilled') {
      for (const p of binancePremium.value) priceMap[p.symbol] = parseFloat(p.markPrice)
    }

    const binanceOI = await Promise.allSettled(
      TOP_SYMBOLS.map(sym =>
        fetchJSON(`${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=${sym}`)
          .then(r => ({ symbol: sym, oi: parseFloat(r.openInterest) }))
      )
    ).catch(() => [])

    const coinMap = {}
    let binanceTotal = 0
    for (const r of (binanceOI || [])) {
      if (r.status !== 'fulfilled') continue
      const { symbol, oi } = r.value
      const sym = symbol.replace('USDT', '')
      const price = priceMap[symbol] || 0
      const oiUsd = oi * price
      coinMap[sym] = { symbol: sym, oiUsd, price }
      binanceTotal += oiUsd
    }

    let bybitTotal = 0
    if (bybitTickers.status === 'fulfilled') {
      for (const item of (bybitTickers.value.result?.list || [])) {
        const oiVal = parseFloat(item.openInterestValue || 0)
        if (oiVal > 0 && item.symbol?.endsWith('USDT')) {
          bybitTotal += oiVal
          const sym = item.symbol.replace('USDT', '')
          if (coinMap[sym]) coinMap[sym].oiUsd += oiVal
          else coinMap[sym] = { symbol: sym, oiUsd: oiVal, price: 0 }
        }
      }
    }

    const coins = Object.values(coinMap)
    coins.sort((a, b) => b.oiUsd - a.oiUsd)
    return { coins: coins.slice(0, 30), total: binanceTotal + bybitTotal, source: 'exchanges' }
  })
}

// ── Long/Short Ratios (Spectre v1 derivatives primary) ──
export async function getLongShortRatios() {
  return cached('ls-ratios', 15_000, async () => {
    // 🪤 getSpectreLongShortRatio() RESOLVES with a fabricated
    // { ratio: 1, longs: 50, shorts: 50 } when the upstream is degraded — it
    // never throws. Reading `.ratio` off it painted a single fake
    // "BTC · 1.00 · 50% long" row across the whole panel AND, because it
    // resolved, stopped every fallback below from ever running. Read the raw
    // ROWS instead (the endpoint carries ~100 assets) and require a real
    // ratio per row, so a degraded upstream falls through honestly.
    try {
      const spectre = await getSpectreLongShortRatio()
      const rows = Array.isArray(spectre?.rows) ? spectre.rows : []
      const global = []
      for (const r of rows) {
        const symbol = String(r.asset || r.symbol || '').replace(/USDT$/i, '').toUpperCase()
        const ratio = Number(r.long_short_ratio ?? r.ratio ?? r.longShortRatio)
        if (!symbol || !Number.isFinite(ratio) || ratio <= 0) continue
        const longPct = ratio / (1 + ratio)
        global.push({
          symbol,
          longShortRatio: String(ratio),
          longAccount: String(longPct),
          shortAccount: String(1 - longPct),
        })
      }
      // This feed is account-level global positioning only — it carries no
      // top-trader split, so leave those empty rather than passing the same
      // numbers off as a second, independent cohort.
      if (global.length) return { global, topTrader: [], topPosition: [] }
    } catch (_) { console.error(_) }

    // Fallback: direct Binance
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
    const [g, tt, tp] = await Promise.allSettled([
      Promise.all(symbols.map(s =>
        fetchJSON(`${BINANCE_FUTURES}/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1h&limit=1`)
          .then(r => ({ symbol: s.replace('USDT', ''), ...r[0] })).catch(() => null)
      )),
      Promise.all(symbols.map(s =>
        fetchJSON(`${BINANCE_FUTURES}/futures/data/topLongShortAccountRatio?symbol=${s}&period=1h&limit=1`)
          .then(r => ({ symbol: s.replace('USDT', ''), ...r[0] })).catch(() => null)
      )),
      Promise.all(symbols.map(s =>
        fetchJSON(`${BINANCE_FUTURES}/futures/data/topLongShortPositionRatio?symbol=${s}&period=1h&limit=1`)
          .then(r => ({ symbol: s.replace('USDT', ''), ...r[0] })).catch(() => null)
      )),
    ])

    return {
      global: (g.value || []).filter(Boolean),
      topTrader: (tt.value || []).filter(Boolean),
      topPosition: (tp.value || []).filter(Boolean),
    }
  })
}

// ── L/S Ratio History (24h for chart) ──
export async function getLSRatioHistory(symbol = 'BTCUSDT') {
  return cached(`ls-history-${symbol}`, 60_000, async () => {
    try {
      const spectre = await getSpectreLongShortRatio()
      const ratio = Number(spectre.ratio || 1)
      const longs = Number(spectre.longs || 50)
      const shorts = Number(spectre.shorts || 50)
      return syntheticSeries(24, (time) => ({ time, ratio, longs, shorts }))
    } catch (_) {
      if (isDev) return syntheticSeries(24, (time) => ({ time, ratio: 1, longs: 50, shorts: 50 }))
    }
    const data = await fetchJSON(
      `${BINANCE_FUTURES}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=24`
    )
    return data.map(d => ({
      time: d.timestamp,
      ratio: parseFloat(d.longShortRatio),
      longs: parseFloat(d.longAccount) * 100,
      shorts: parseFloat(d.shortAccount) * 100,
    }))
  })
}

// ── Funding Rate History ──
export async function getFundingHistory(symbol = 'BTCUSDT', limit = 168) {
  return cached(`funding-history-${symbol}`, 120_000, async () => {
    // Same reasoning as getOIHistory: the Spectre lane is the CURRENT rate, and
    // repeating it `limit` times drew 56 identical funding bars — a wall, not a
    // history. Binance publishes the real 8-hourly series, so ask it first.
    try {
      const data = await fetchJSON(
        `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`
      )
      const rows = (Array.isArray(data) ? data : [])
        .map(d => ({ time: d.fundingTime, rate: parseFloat(d.fundingRate) * 100 }))
        .filter(r => Number.isFinite(r.rate))
      if (rows.length > 1) return rows
    } catch (_) { /* fall through to the placeholder */ }

    try {
      const spectre = await getSpectreFundingRates()
      const asset = baseAsset(symbol)
      const row = (spectre.rows || []).find((item) => baseAsset(item.asset || item.symbol) === asset)
      const rate = Number(row?.rate ?? row?.weighted_funding_rate ?? 0) * 100
      return syntheticSeries(limit, (time) => ({ time, rate }))
    } catch (_) {
      if (isDev) return syntheticSeries(limit, (time) => ({ time, rate: 0 }))
    }
    const data = await fetchJSON(
      `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`
    )
    return data.map(d => ({
      time: d.fundingTime,
      rate: parseFloat(d.fundingRate) * 100,
    }))
  })
}

// ── Liquidation data (Aggregator primary - real-time WS from 3 exchanges) ──
export async function getLiquidationData() {
  return cached('liquidations', 10_000, async () => {
    // The aggregate endpoint owns the 24h headline; per-symbol data and the
    // non-24h windows come from Spectre below.
    // All three upstream calls are independent - run them together. The
    // getSpectreOpenInterest() result is also memoized inside spectreMarketApi
    // so getOpenInterest() above shares the same in-flight request.
    const [cgLiq24h, spectre, liquidationWindows] = await Promise.all([
      getCoinglassTotalLiq24h(),
      getSpectreOpenInterest().catch(() => null),
      getSpectreLiquidationWindows().catch(() => null),
    ])
    try {
      // 🪤 This used to `throw` the moment the Spectre per-symbol call failed,
      // which THREW AWAY the CoinGlass 24h total fetched right above it — the
      // hero then fell through to a 404 route and finally to the WebSocket
      // aggregator, printing $0.00 while CoinGlass was holding billions.
      // The per-symbol breakdown is an ENRICHMENT: proceed on any real source.
      const bySymbol = {}
      let totalLong = 0
      let totalShort = 0
      for (const row of spectre?.rows || []) {
        const symbol = String(row.asset || row.symbol || '').replace(/USDT$/, '').toUpperCase()
        if (!symbol) continue
        const long = Number(row.long_liq_24h || 0)
        const short = Number(row.short_liq_24h || 0)
        bySymbol[symbol] = { long, short, total: long + short }
        totalLong += long
        totalShort += short
      }
      const haveAnything = Object.keys(bySymbol).length > 0
        || cgLiq24h.total > 0
        || Number(liquidationWindows?.windows?.['24h']?.total) > 0
      if (haveAnything) {
        const windows = liquidationWindows?.windows || {
          '24h': { total: totalLong + totalShort, long: totalLong, short: totalShort },
        }
        // Overlay CoinGlass totals onto the 24h window so the hero displays
        // the CG number while the other windows keep their Spectre origin.
        if (cgLiq24h.total > 0) {
          windows['24h'] = {
            ...windows['24h'],
            long: cgLiq24h.long,
            short: cgLiq24h.short,
            total: cgLiq24h.total,
          }
        }
        const w24 = windows['24h'] || {}
        return {
          totalLong: Number(w24.long ?? totalLong),
          totalShort: Number(w24.short ?? totalShort),
          total: Number(w24.total ?? (totalLong + totalShort)),
          windows,
          bySymbol,
          recent: [],
          connected: true,
          source: cgLiq24h.total > 0 ? 'coinglass+spectre' : (liquidationWindows?.windows ? 'spectre-v1-derivatives-liquidation-windows' : 'spectre-market'),
          regime: null,
          state: null,
          fundingAvg: null,
          whaleFlow: null,
        }
      }
    } catch (_) { console.error(_) }

    // Fallback: Spectre Derivatives Aggregator
    try {
      const [windowsRes, aiRes] = await Promise.allSettled([
        fetchJSON('/api/derivatives/liquidation-windows'),
        fetchJSON('/api/market/ai-analyse'),
      ])

      if (windowsRes.status === 'fulfilled' && windowsRes.value?.data?.windows) {
        const w = windowsRes.value.data.windows
        const ai = aiRes.status === 'fulfilled' ? aiRes.value : null

        return {
          totalLong: w['24h']?.long || 0,
          totalShort: w['24h']?.short || 0,
          total: w['24h']?.total || 0,
          windows: {
            '1h': { total: w['1h']?.total || 0, long: w['1h']?.long || 0, short: w['1h']?.short || 0 },
            '4h': { total: w['4h']?.total || 0, long: w['4h']?.long || 0, short: w['4h']?.short || 0 },
            '12h': { total: w['12h']?.total || 0, long: w['12h']?.long || 0, short: w['12h']?.short || 0 },
            '24h': { total: w['24h']?.total || 0, long: w['24h']?.long || 0, short: w['24h']?.short || 0 },
          },
          bySymbol: {},
          recent: [],
          connected: true,
          source: 'brain-api',
          regime: ai?.regime,
          state: ai?.state,
          fundingAvg: ai?.fundingAvgPct,
          whaleFlow: ai?.whaleFlowUsd,
          totalMarketOI: ai?.openInterest || null,
          events_24h: windowsRes.value.data.events_24h || 0,
        }
      }
      throw new Error('Brain API liquidation-windows unavailable')
    } catch (err) {
      console.warn('[TC] Brain liquidation-windows unavailable, falling back:', err.message)
    }

    // Fallback: Express server WebSocket aggregator
    const [liqRes, aiRes] = await Promise.allSettled([
      fetchJSON('/api/market/liquidations'),
      fetchJSON('/api/market/ai-analyse'),
    ])

    const liq = liqRes.status === 'fulfilled' ? liqRes.value : null
    const ai = aiRes.status === 'fulfilled' ? aiRes.value : null
    const w24 = liq?.windows?.['24h'] || {}

    return {
      totalLong: w24.long || 0,
      totalShort: w24.short || 0,
      total: w24.total || 0,
      windows: liq?.windows || null,
      bySymbol: w24.bySymbol || {},
      recent: liq?.recent || [],
      connected: liq?.connected || false,
      source: 'websocket',
      regime: ai?.regime,
      state: ai?.state,
      fundingAvg: ai?.fundingAvgPct,
      whaleFlow: ai?.whaleFlowUsd,
      totalMarketOI: ai?.openInterest || null,
    }
  })
}

// ── Deribit Options Data ──
export async function getOptionsData() {
  return cached('options-data', 300_000, async () => {
    if (isDev) {
      return {
        putCallRatio: null,
        putCallOIRatio: null,
        totalPutOI: 0,
        totalCallOI: 0,
        ivHistory: [],
        currentIV: null,
        source: 'deribit-proxy-unavailable-local',
      }
    }
    const [summary, vol] = await Promise.allSettled([
      fetchJSON(`${DERIBIT}/get_book_summary_by_currency?currency=BTC&kind=option`),
      fetchJSON(`${DERIBIT}/get_volatility_index_data?currency=BTC&resolution=3600&start_timestamp=${Date.now() - 7 * 86400000}&end_timestamp=${Date.now()}`),
    ])

    let putOI = 0, callOI = 0, putVol = 0, callVol = 0
    if (summary.status === 'fulfilled') {
      for (const item of (summary.value.result || [])) {
        if (item.instrument_name.includes('-P')) {
          putOI += item.open_interest || 0
          putVol += item.volume || 0
        } else if (item.instrument_name.includes('-C')) {
          callOI += item.open_interest || 0
          callVol += item.volume || 0
        }
      }
    }

    const volHistory = vol.status === 'fulfilled' ? (vol.value.result?.data || []).map(d => ({
      time: d[0],
      open: d[1],
      high: d[2],
      low: d[3],
      close: d[4],
    })) : []

    return {
      putCallRatio: callVol > 0 ? (putVol / callVol).toFixed(2) : null,
      putCallOIRatio: callOI > 0 ? (putOI / callOI).toFixed(2) : null,
      totalPutOI: putOI,
      totalCallOI: callOI,
      ivHistory: volHistory,
      currentIV: volHistory.length ? volHistory[volHistory.length - 1].close : null,
    }
  })
}

// ── OI History (for OI vs Price chart) ──
export async function getOIHistory(symbol = 'BTCUSDT') {
  return cached(`oi-history-${symbol}`, 120_000, async () => {
    // Real history first. The Spectre lane below is a SNAPSHOT — preferring it
    // here bought nothing and cost everything, because fanning one reading
    // across 48 hourly points is what made the hero card read "+0.00%" with a
    // flat spark. (The snapshot lane, getOpenInterest, still prefers Spectre.)
    try {
      const data = await fetchJSON(
        `${BINANCE_FUTURES}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=48`
      )
      const rows = (Array.isArray(data) ? data : [])
        .map(d => ({
          time: d.timestamp,
          oi: parseFloat(d.sumOpenInterest),
          oiValue: parseFloat(d.sumOpenInterestValue),
        }))
        .filter(r => Number.isFinite(r.oiValue) && r.oiValue > 0)
      if (rows.length > 1) return rows
    } catch (_) { /* fall through to the placeholder */ }

    try {
      const spectre = await getSpectreOpenInterest()
      const asset = baseAsset(symbol)
      const row = (spectre.rows || []).find((item) => baseAsset(item.asset || item.symbol) === asset)
      const oiValue = Number(row?.oi_usd || 0)
      const oi = Number(row?.price || 0) > 0 ? oiValue / Number(row.price) : oiValue
      if (oiValue > 0) return syntheticSeries(48, (time) => ({ time, oi, oiValue }))
    } catch (_) { /* no history and no snapshot */ }
    return []
  })
}

// OI-chart tab series — raw 96-point openInterestHist for the chart view.
// Separate from getOIHistory (which is a spectre-backed 48pt synthetic series).
// Cached 60s so re-entering the OI Chart tab is free.
export async function getOIChartHistory(symbol = 'BTCUSDT') {
  return cached(`oi-chart-${symbol}`, 60_000, async () => {
    const data = await fetchJSON(
      `${BINANCE_FUTURES}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=96`
    )
    // Price rides along for free: the same row carries OI in coin AND in USD,
    // so `value / coin` is the mark price on exactly the OI timestamps. That
    // avoids a second fetch and, more importantly, avoids having to align two
    // independently-sampled series — OI is only readable AGAINST price
    // (OI up + price down = new shorts; OI down + price down = longs flushed).
    return data.map(d => {
      const coin = parseFloat(d.sumOpenInterest)
      const value = parseFloat(d.sumOpenInterestValue)
      return { time: d.timestamp, value, coin, price: coin > 0 ? value / coin : null }
    })
  })
}

// ── Taker Buy/Sell Volume (Aggregator primary) ──
export async function getTakerVolume() {
  return cached('taker-volume', 60_000, async () => {
    try {
      const spectre = await getSpectreTakerPressure()
      if (Array.isArray(spectre) && spectre.length > 0) return spectre
    } catch (_) { console.error(_) }

    if (isDev) return []
    // NOTE: the `/api/deriv-agg/*` tier that used to sit here is GONE. It 404s
    // at every layer — no Express route, the single `/api/deriv-agg` Vercel
    // rewrite never matched the sub-paths, and the box itself has no
    // `/api/deriv-agg` (the real lane is `/v1/derivatives/*`, used above).
    // Keeping it only cost a guaranteed-failing request + a console warning on
    // every page load before the working fallback ran.

    // Fallback: direct Binance
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
    const results = await Promise.allSettled(
      symbols.map(sym =>
        fetchJSON(`${BINANCE_FUTURES}/futures/data/takerlongshortRatio?symbol=${sym}&period=1h&limit=12`)
          .then(data => ({ symbol: sym.replace('USDT', ''), data }))
      )
    )
    const coins = []
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      const { symbol, data } = r.value
      const latest = data[0]
      if (!latest) continue
      const buyRatio = parseFloat(latest.buyVol) / (parseFloat(latest.buyVol) + parseFloat(latest.sellVol))
      coins.push({
        symbol,
        buyRatio,
        sellRatio: 1 - buyRatio,
        buySellRatio: parseFloat(latest.buySellRatio),
        history: data.map(d => parseFloat(d.buySellRatio)).reverse(),
      })
    }
    return coins
  })
}

// ── Perpetual Basis / Premium (Aggregator primary) ──
export async function getBasisData() {
  return cached('basis-data', 60_000, async () => {
    try {
      const spectre = await getSpectreFuturesBasis()
      if (Array.isArray(spectre) && spectre.length > 0) return spectre
    } catch (_) { console.error(_) }

    if (isDev) return []
    // NOTE: the `/api/deriv-agg/*` tier that used to sit here is GONE. It 404s
    // at every layer — no Express route, the single `/api/deriv-agg` Vercel
    // rewrite never matched the sub-paths, and the box itself has no
    // `/api/deriv-agg` (the real lane is `/v1/derivatives/*`, used above).
    // Keeping it only cost a guaranteed-failing request + a console warning on
    // every page load before the working fallback ran.

    // Fallback: direct Binance spot + futures
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    const [spotRes, futuresRes] = await Promise.allSettled([
      Promise.all(symbols.map(sym =>
        fetchJSON(`${BINANCE_SPOT}/api/v3/ticker/price?symbol=${sym}`)
          .then(r => ({ symbol: sym.replace('USDT', ''), price: parseFloat(r.price) }))
      )),
      fetchJSON(`${BINANCE_FUTURES}/fapi/v1/premiumIndex`),
    ])
    const spotPrices = {}
    if (spotRes.status === 'fulfilled') {
      for (const s of spotRes.value) spotPrices[s.symbol] = s.price
    }
    const coins = []
    if (futuresRes.status === 'fulfilled') {
      for (const item of futuresRes.value) {
        const sym = item.symbol.replace('USDT', '')
        if (!spotPrices[sym]) continue
        const markPrice = parseFloat(item.markPrice)
        const spotPrice = spotPrices[sym]
        const basis = ((markPrice - spotPrice) / spotPrice) * 100
        const annualized = basis * 365 * 3
        coins.push({ symbol: sym, spotPrice, markPrice, basis, annualized, nextFunding: item.nextFundingTime })
      }
    }
    return coins.filter(c => ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'].includes(c.symbol))
  })
}

// ── Kline data for price overlay ──
export async function getKlines(symbol = 'BTCUSDT', interval = '1h', limit = 48) {
  return cached(`klines-${symbol}-${interval}`, 60_000, async () => {
    const data = await getBinanceFuturesKlines(symbol, interval, limit)
    return data.map(d => ({
      time: d[0],
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }))
  })
}

// ── External Liquidation Charts API (proxied via our server to avoid CORS) ──
export async function getExternalExchangeList(exchange = 'Binance', symbol = 'BTCUSDT', interval = '30m', size = 337) {
  return cached(`ext-exchange-${exchange}-${symbol}-${interval}`, 60_000, async () => {
    // 2026-05-13: dev and prod both go through the proxy. Express has a parity
    // route at /api/charts/exchange-list (packages/server/index.js) that
    // serves the same Binance-derived candles as the Vercel handler.
    const data = await fetchJSON(
      `/api/charts/exchange-list?exchange=${exchange}&symbol=${symbol}&interval=${interval}&size=${size}`
    )
    if (!data.success || data.code !== '1') throw new Error('External exchange list failed')
    return data.data.map(d => ({
      time: d[0],
      closeTime: d[1],
      open: parseFloat(d[2]),
      close: parseFloat(d[3]),
      high: parseFloat(d[4]),
      low: parseFloat(d[5]),
      volume: parseFloat(d[6]),
      quoteVolume: parseFloat(d[7]),
      trades: parseInt(d[8]),
      takerBuyVolume: parseFloat(d[9]),
    }))
  })
}

export async function getExternalLiqHeatmap(exchange = 'Binance', symbol = 'BTCUSDT', interval = '1w', leverage = null) {
  return cached(`ext-liq-heatmap-${exchange}-${symbol}-${interval}-${leverage || 'all'}`, 120_000, async () => {
    // 2026-05-13: dev and prod both go through the proxy. Express has a parity
    // route at /api/charts/liq-heatmap (packages/server/index.js) that uses
    // the same Binance synthesizer as the Vercel handler.
    // Own fetch, not fetchJSON: a cold heatmap build takes ~8s server-side
    // (multi-venue OI + tape-calibration walk) — far past fetchJSON's global
    // 3.5s abort. Warm builds are cached (2min server, 2min client) and fast.
    // `leverage` (10/25/50/100) shows a single tier of the ladder; null = all.
    const res = await fetch(
      `/api/charts/liq-heatmap?exchange=${exchange}&symbol=${symbol}&interval=${interval}${leverage ? `&leverage=${leverage}` : ''}`,
      { signal: AbortSignal.timeout(20_000) }
    )
    if (!res.ok) throw new Error(`Liq heatmap HTTP ${res.status}`)
    const data = await res.json()
    if (!data.success || data.code !== '1') throw new Error('External liq heatmap failed')
    const hm = data.data.liqHeatMap
    return {
      chartInterval: hm.chartInterval,
      end: hm.end,
      timeArray: hm.chartTimeArray,
      priceArray: hm.priceArray,
      grid: hm.data.map(d => ({
        col: parseInt(d[0]),
        row: parseInt(d[1]),
        value: parseFloat(d[2]),
      })),
      rows: hm.priceArray.length,
      cols: hm.chartTimeArray.length,
    }
  })
}

export async function getLiqPrints(symbol = 'BTCUSDT', hours = 72) {
  return cached(`liq-prints-${symbol}-${hours}`, 60_000, async () => {
    // Own fetch, not fetchJSON: the tape walk behind this endpoint takes
    // 4-6s cold (up to 6 sequential upstream pages), past fetchJSON's
    // global 3.5s abort. The endpoint itself is fail-soft (always 200).
    const res = await fetch(`/api/charts/liq-prints?symbol=${symbol}&hours=${hours}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Liq prints HTTP ${res.status}`)
    const data = await res.json()
    if (!data.success) throw new Error('Liq prints failed')
    return data
  })
}

// ── Klines for liquidation heatmap (more candles) ──
export async function getHeatmapKlines(symbol = 'BTCUSDT', timeframe = '1H') {
  const tfMap = {
    '1M': { interval: '1m', limit: 500 },
    '5M': { interval: '5m', limit: 500 },
    '15M': { interval: '15m', limit: 500 },
    '1H': { interval: '1h', limit: 500 },
    '4H': { interval: '4h', limit: 200 },
    '1D': { interval: '1d', limit: 200 },
  }
  const { interval, limit } = tfMap[timeframe] || tfMap['1H']
  return cached(`heatmap-klines-${symbol}-${interval}`, 60_000, async () => {
    const data = await getBinanceFuturesKlines(symbol, interval, limit)
    return data.map(d => ({
      time: d[0],
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }))
  })
}

// ── CME institutional positioning (CFTC Commitment of Traders) ──────────────
// Weekly CFTC data for the CME BTC / ETH futures contracts, live on the box at
// /v1/derivatives/cme/cot and — until now — surfaced nowhere in the app. This
// is the one feed here that shows what REGULATED institutions are positioned
// as, rather than what the offshore perp crowd is doing.
//
// Non-commercial = speculators (hedge funds, CTAs) — the directional money.
// Commercial     = hedgers (miners, desks) — structurally the other side.
// `net_noncomm`  = noncomm_long − noncomm_short, in contracts.
export async function getCmeCot() {
  return cached('cme-cot', 10 * 60_000, async () => {
    const rows = await getSpectreCmeCot()
    // 🪤 The feed carries FIVE different BTC contracts (BITCOIN, MICRO
    // BITCOIN, NANO BITCOIN PERP STYLE, Nano Bitcoin, BITCOIN CASH PERP
    // STYLE) and four ETH ones, all under the same `asset`, with DIFFERENT
    // contract sizes and often OPPOSITE net positions on the same report
    // date (2026-07-21: BITCOIN +3,054 vs NANO BITCOIN PERP −5,980). Summing
    // them is meaningless and picking the newest row at random is worse.
    // Group by (asset, contract_market) and report the FLAGSHIP contract —
    // the one the market means by "CME BTC futures" — naming it on screen.
    const byContract = new Map()
    for (const r of rows) {
      const asset = String(r.asset || '').toUpperCase()
      const market = String(r.contract_market || '').trim()
      const ts = Number(r.report_date_unix) * 1000 || Date.parse(r.report_date)
      const net = Number(r.net_noncomm)
      if (!asset || !market || !Number.isFinite(ts) || !Number.isFinite(net)) continue
      const key = `${asset}|${market}`
      if (!byContract.has(key)) byContract.set(key, { asset, market, points: [] })
      byContract.get(key).points.push({
        ts,
        net,
        netComm: Number(r.net_comm),
        longs: Number(r.noncomm_long) || 0,
        shorts: Number(r.noncomm_short) || 0,
        oi: Number(r.open_interest_all) || 0,
        traders: Number(r.traders_total) || 0,
      })
    }

    // flagship = the full-size contract, never a micro/nano derivative of it
    const FLAGSHIP = { BTC: 'BITCOIN', ETH: 'ETHER CASH SETTLED' }
    const isMini = (m) => /micro|nano|mini/i.test(m)
    const best = new Map()
    for (const entry of byContract.values()) {
      const exact = FLAGSHIP[entry.asset] && entry.market.toUpperCase() === FLAGSHIP[entry.asset]
      const cur = best.get(entry.asset)
      const oi = Math.max(...entry.points.map((p) => p.oi), 0)
      const score = exact ? 1e12 : isMini(entry.market) ? 0 : oi
      if (!cur || score > cur.score) best.set(entry.asset, { ...entry, score, oi })
    }

    const out = []
    for (const entry of best.values()) {
      const list = entry.points.sort((a, b) => a.ts - b.ts)   // oldest → newest
      const cur = list[list.length - 1]
      const prev = list[list.length - 2] || null
      if (!cur) continue
      const span = Math.max(...list.map((p) => Math.abs(p.net)), 1)
      let biggest = 0
      for (let i = 1; i < list.length; i++) biggest = Math.max(biggest, Math.abs(list[i].net - list[i - 1].net))
      out.push({
        asset: entry.asset,
        market: entry.market,
        ...cur,
        delta: prev ? cur.net - prev.net : null,
        flipped: !!prev && Math.sign(cur.net) !== Math.sign(prev.net) && cur.net !== 0,
        biggestSwing: biggest,
        weeks: list.length,
        series: list,
        span,
        netShareOfOi: cur.oi > 0 ? (cur.net / cur.oi) * 100 : null,
      })
    }
    const rank = { BTC: 0, ETH: 1 }
    out.sort((a, b) => (rank[a.asset] ?? 9) - (rank[b.asset] ?? 9) || b.oi - a.oi)
    return out
  })
}

// ── Live liquidation tape (multi-exchange event stream) ────────────────────
// The box publishes individual liquidation EVENTS at /v1/derivatives/liquidations
// across okx/binance/bybit, seconds old. The page previously only knew about the
// Express Binance-only WebSocket aggregator, which has no serverless mirror (404
// in prod) and was reporting `connected: true` with zero captured events in dev.
export async function getLiquidationFeed(limit = 25) {
  return cached(`liq-feed-${limit}`, 30_000, async () => {
    const rows = await getSpectreLiquidationEvents(limit)
    return rows
      .map((r) => {
        const usdValue = Number(r.usd_value ?? r.usdValue)
        const symbol = String(r.asset || r.symbol || '').replace(/USDT$/i, '').toUpperCase()
        if (!symbol || !Number.isFinite(usdValue) || usdValue <= 0) return null
        const rawSide = String(r.side || '').toLowerCase()
        return {
          // the tape states the LIQUIDATED SIDE outright — pass it through in
          // that vocabulary rather than re-encoding it as a Binance order side
          time: Number(r.time_unix) * 1000 || Date.parse(r.time) || Date.now(),
          symbol,
          side: rawSide === 'short' ? 'SHORT' : 'LONG',
          qty: Number(r.quantity) || 0,
          price: Number(r.price) || 0,
          usdValue,
          exchange: r.exchange || null,
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.time - a.time)
  })
}

// ── Liquidation MAP (price-axis, per-leverage-tier) ────────────────────────
// Companion to getExternalLiqHeatmap: same cohort model, projected onto price
// instead of time. Returns { spot, levels[], tiers, peakLevelUsd,
// totalLongUsd, totalShortUsd } — see api/_lib/handlers/liq-heatmap-binance.js.
export async function getLiqMap(symbol = 'BTCUSDT', interval = '1d') {
  return cached(`liq-map-${symbol}-${interval}`, 120_000, async () => {
    const d = await fetchJSON(`/api/charts/liq-map?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`)
    if (!d?.success || !d?.data?.levels?.length) throw new Error('liq map unavailable')
    return d.data
  })
}
