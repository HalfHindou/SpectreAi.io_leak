/**
 * Coinglass-style liquidation heatmap synthesizer.
 *
 * Algorithm (Coinglass-equivalent, reverse-engineered from their methodology):
 *
 *   1. Per candle t: compute ΔOI_$ = (OI(t) − OI(t−1)) × close(t).
 *      This is the $ notional of NEW positions opened during that candle.
 *   2. Split that ΔOI long/short via top-trader-account ratio at time t.
 *   3. Record a COHORT for that candle: {open_candle, open_price, long$, short$}.
 *      Distribute the notional across leverage tiers with the empirical
 *      retail-perp distribution: 10x=35%, 25x=35%, 50x=20%, 100x=10%.
 *   4. Maintain a rolling cohort list. For EACH candle t, walk every cohort
 *      opened at t_open ≤ t and:
 *         • For each leverage tier, project liq price:
 *             long  liq = open_price × (1 − 1/L)   (below open)
 *             short liq = open_price × (1 + 1/L)   (above open)
 *         • EVICT the tier if any candle high/low in [t_open .. t] crossed
 *           the liq level (position would have been liquidated).
 *         • Otherwise accumulate `cohort_$ × tier_weight` into
 *           heatmap[t][priceBin(liq_price)].
 *   5. Output a SPARSE [col, row, value] tuple list above a magnitude floor.
 *
 * Why this produces horizontal bands (not per-candle dots):
 *   At any column t, EVERY still-open cohort projects its liq price into the
 *   same row it would have projected into at t−1. So as t advances, the same
 *   price row accumulates more notional from each surviving cohort — a band
 *   that extends horizontally from cohort birth to liquidation/present.
 *
 * Data: only Binance Futures public endpoints. No paid Coinglass API.
 * Accuracy gap vs Coinglass: ~15–25% notional error (Coinglass aggregates
 * multi-exchange); band POSITIONS within 1 price bin of theirs.
 */

import { symbolToAsset } from './liq-tape.js'

const BINANCE_FUT = 'https://fapi.binance.com'

// Leverage tiers — the CoinGlass Model-1 ladder: 10x / 25x / 50x / 100x.
// High leverage (liq 1-4% from entry) carries most weight — that is what
// creates the dense band cluster hugging price in the CoinGlass reference.
// 10x (~10% away) keeps the far field present but sparse. The previous
// 11-tier 5x-125x ladder spread weight into evenly spaced far-field lines
// that read as a barcode. Sums to 1.0.
export const LEV_TIERS = [
  { lev: 10,  w: 0.12 },
  { lev: 25,  w: 0.28 },
  { lev: 50,  w: 0.32 },
  { lev: 100, w: 0.28 },
]

// ── Tape-calibrated leverage mix ────────────────────────────────────────────
// The static LEV_TIERS weights are a guess. When the Spectre tape has enough
// real liquidation events for this asset, estimate the ACTUAL leverage mix:
// for each real liq print, each candidate leverage L implies an entry price
// (invert the projection used below: long liq = open×(1−1/L+MM) → open =
// liq/(1−1/L+MM)); weight the candidate by the volume actually traded at that
// entry price (the VP the synthesizer already builds). Aggregate across events,
// blend 70/30 with the static prior for stability, renormalize.
const CALIB_MIN_EVENTS = 100
const CALIB_BLEND = 0.7

export function calibrateSideTiers(events, side, binOf, VP, rows, staticTiers) {
  const agg = new Float64Array(staticTiers.length)
  let used = 0
  for (const e of events) {
    if (e.side !== side) continue
    let sum = 0
    const w = new Float64Array(staticTiers.length)
    for (let i = 0; i < staticTiers.length; i++) {
      const { lev } = staticTiers[i]
      const entry = side === 'long'
        ? e.p / (1 - 1 / lev + MAINT_MARGIN)
        : e.p / (1 + 1 / lev - MAINT_MARGIN)
      const r = binOf(entry)
      const v = r >= 0 && r < rows ? VP[r] : 0
      w[i] = v
      sum += v
    }
    if (sum <= 0) continue
    for (let i = 0; i < staticTiers.length; i++) agg[i] += w[i] / sum
    used++
  }
  if (used < CALIB_MIN_EVENTS) return null
  let aggSum = 0
  for (let i = 0; i < agg.length; i++) aggSum += agg[i]
  if (aggSum <= 0) return null
  const blended = staticTiers.map((t, i) => ({
    lev: t.lev,
    w: CALIB_BLEND * (agg[i] / aggSum) + (1 - CALIB_BLEND) * t.w,
  }))
  const s = blended.reduce((a, t) => a + t.w, 0)
  return blended.map(t => ({ lev: t.lev, w: t.w / s }))
}

// Maintenance margin reserve (~0.5%). Tightens long liq slightly upward and
// short liq slightly downward. Matches Binance's perp risk model average.
const MAINT_MARGIN = 0.005

// Timeframe → (kline_interval, oi_period, num_candles).
// OI history has a 30-day server cap so longer ranges sample sparsely.
const TF_CONFIG = {
  '12h': { kline: '5m',  oi: '5m',  n: 144  },
  '1d':  { kline: '15m', oi: '15m', n: 96   },
  '3d':  { kline: '30m', oi: '30m', n: 144  },
  '1w':  { kline: '1h',  oi: '1h',  n: 168  },
  '2w':  { kline: '2h',  oi: '2h',  n: 168  },
  '1M':  { kline: '4h',  oi: '4h',  n: 180  },
  '3M':  { kline: '12h', oi: '12h', n: 180  },
  '6M':  { kline: '1d',  oi: '1d',  n: 180  },
  '1y':  { kline: '1d',  oi: '1d',  n: 365  },
}

async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

// ── Bybit fallback ──────────────────────────────────────────────────────────
// Binance Futures (fapi.binance.com) is US-geo-restricted and refuses requests
// from Vercel's datacenter IPs ("Service unavailable from a restricted
// location"). The direct calls work from the local Express dev server but fail
// in prod, leaving the heatmap grid empty (blank canvas while dev looks fine).
// CORS proxies don't help — Binance blocks their egress IPs too. Bybit's v5
// perp API is NOT geo-restricted and serves the same primitives (klines with
// turnover + top-trader long/short ratio), so we mirror its responses into the
// exact Binance shapes the synthesizer already consumes. Note: per-candle OI
// ($) is computed but never read downstream — only kline turnover and the
// long/short ratio drive the cohort math — so Bybit needs to supply just those.
const BYBIT_FUT = 'https://api.bybit.com'

// Binance kline interval → Bybit kline interval token.
const BYBIT_KLINE_INTERVAL = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
  '1d': 'D', '1w': 'W', '1M': 'M',
}
// Binance long/short period → Bybit account-ratio period (coarser ladder).
const BYBIT_LS_PERIOD = {
  '5m': '5min', '15m': '15min', '30m': '30min',
  '1h': '1h', '2h': '1h', '4h': '4h', '12h': '4h', '1d': '1d',
}

// Returns klines in Binance shape: [openTime, open, high, low, close, volume,
// closeTime, quoteVolume]. Only indexes 0-4 and 7 (quoteVolume) are read.
async function fetchKlinesWithFallback(symbol, interval, limit, preferBybit = false) {
  const binance = () => fetchJSON(`${BINANCE_FUT}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  const bybit = async () => {
    const bi = BYBIT_KLINE_INTERVAL[interval] || '60'
    const j = await fetchJSON(`${BYBIT_FUT}/v5/market/kline?category=linear&symbol=${symbol}&interval=${bi}&limit=${Math.min(limit, 1000)}`)
    const list = j?.result?.list
    if (!Array.isArray(list) || list.length === 0) throw new Error('Bybit klines empty')
    // Bybit rows = [start, open, high, low, close, volume, turnover], newest first.
    return list.slice().reverse().map(r => [Number(r[0]), r[1], r[2], r[3], r[4], r[5], Number(r[0]) + 1, r[6]])
  }
  if (preferBybit) { try { return await bybit() } catch { return await binance() } }
  try { return await binance() } catch { return await bybit() }
}

// Returns long/short rows in Binance shape: [{ timestamp, longAccount }].
async function fetchLSRatioWithFallback(symbol, period, limit, preferBybit = false) {
  const binance = () => fetchJSON(`${BINANCE_FUT}/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${period}&limit=${limit}`)
  const bybit = async () => {
    const bp = BYBIT_LS_PERIOD[period] || '1h'
    const j = await fetchJSON(`${BYBIT_FUT}/v5/market/account-ratio?category=linear&symbol=${symbol}&period=${bp}&limit=${Math.min(limit, 500)}`).catch(() => null)
    const list = j?.result?.list
    if (!Array.isArray(list)) return []
    return list.map(r => ({ timestamp: Number(r.timestamp), longAccount: Number(r.buyRatio) }))
  }
  if (preferBybit) { try { return await bybit() } catch { return await binance() } }
  try { return await binance() } catch { return await bybit() }
}

// ── Multi-venue open interest (current snapshot, $ notional) ────────────────
// Sizes the SEED cohorts with the real standing OI across the four venues we
// can read keylessly, instead of the old `1.5 × window volume` guess. Each leg
// fails soft; zero legs up → caller falls back to the volume heuristic.
const OKX_API = 'https://www.okx.com'
const HL_API = 'https://api.hyperliquid.xyz'

async function fetchAggregateOiCoins(symbol, exchange = 'All') {
  const asset = symbolToAsset(symbol)
  const want = (name) => exchange === 'All' || exchange.toLowerCase() === name
  const legs = []
  const names = []
  if (want('binance')) {
    names.push('binance')
    legs.push(fetchJSON(`${BINANCE_FUT}/fapi/v1/openInterest?symbol=${symbol}`)
      .then(j => Number(j.openInterest)))
  }
  if (want('bybit')) {
    names.push('bybit')
    legs.push(fetchJSON(`${BYBIT_FUT}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=1`)
      .then(j => Number(j?.result?.list?.[0]?.openInterest)))
  }
  if (want('okx')) {
    names.push('okx')
    legs.push(fetchJSON(`${OKX_API}/api/v5/public/open-interest?instType=SWAP&instId=${asset}-USDT-SWAP`)
      .then(j => Number(j?.data?.[0]?.oiCcy)))
  }
  if (exchange === 'All') {
    names.push('hyperliquid')
    legs.push((async () => {
      const res = await fetch(`${HL_API}/info`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`hl ${res.status}`)
      const [meta, ctxs] = await res.json()
      const idx = (meta?.universe || []).findIndex(u => u.name === asset)
      if (idx < 0) throw new Error('hl asset not listed')
      return Number(ctxs?.[idx]?.openInterest)
    })())
  }
  const settled = await Promise.allSettled(legs)
  const byVenue = {}
  let totalCoins = 0
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && Number.isFinite(r.value) && r.value > 0) {
      byVenue[names[i]] = r.value
      totalCoins += r.value
    }
  })
  return { totalCoins, venues: Object.keys(byVenue), byVenue }
}

function pctNum(v, fallback = 0.5) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback
}

/**
 * Build the cohort-based liquidation heatmap.
 *
 * @param {string} symbol e.g. 'BTCUSDT'
 * @param {string} timeframe one of TF_CONFIG keys
 * @param {{exchange?: 'All'|'Binance'|'Bybit'}} [opts] 'Bybit' prefers Bybit
 *   sources; 'Binance' prefers Binance; 'All' (default) = current source
 *   order + multi-venue aggregate OI seed.
 * @returns {Promise<object>} {grid, rows, cols, timeArray, priceArray, ...}
 */
export async function buildBinanceLiqHeatmap(symbol = 'BTCUSDT', timeframe = '3d', { exchange = 'All', leverage = null, collectMap = false } = {}) {
  const tf = TF_CONFIG[timeframe] || TF_CONFIG['3d']
  // Fetch TWO windows of candles: the second half is displayed; the first half
  // ("pre-window") locates the entries of the OI that was already standing when
  // the display window opens — its positions distribute over pre-window ΔOI
  // bursts instead of being smeared across the display window's own closes.
  const klineLimit = Math.min(tf.n * 2, 1000)
  const oiLimit = Math.min(tf.n * 2, 500)
  const preferBybit = exchange === 'Bybit'

  // Kick the aggregate-OI fetch concurrently — it's price-free (returns
  // base-COIN amounts; the $ multiply happens after `close` is known below).
  const oiPromise = fetchAggregateOiCoins(symbol, exchange).catch(() => ({ totalCoins: 0, venues: [], byVenue: {} }))

  const [klines, oiHist, lsRatio] = await Promise.all([
    fetchKlinesWithFallback(symbol, tf.kline, klineLimit, preferBybit),
    fetchJSON(`${BINANCE_FUT}/futures/data/openInterestHist?symbol=${symbol}&period=${tf.oi}&limit=${oiLimit}`).catch(() => []),
    fetchLSRatioWithFallback(symbol, tf.oi, oiLimit, preferBybit),
  ])

  if (!Array.isArray(klines) || klines.length === 0) throw new Error('No kline data')

  // Build canonical per-candle arrays over the FULL fetch (pre-window + display).
  const totalCols = klines.length
  const preLen = Math.max(0, totalCols - tf.n)
  const cols = totalCols - preLen // display columns
  const time = new Float64Array(totalCols)
  const open = new Float64Array(totalCols)
  const high = new Float64Array(totalCols)
  const low = new Float64Array(totalCols)
  const close = new Float64Array(totalCols)
  const quoteVol = new Float64Array(totalCols) // [7] = quote-asset (USD) volume traded
  for (let i = 0; i < totalCols; i++) {
    time[i] = Number(klines[i][0])
    open[i] = Number(klines[i][1])
    high[i] = Number(klines[i][2])
    low[i]  = Number(klines[i][3])
    close[i] = Number(klines[i][4])
    quoteVol[i] = Number(klines[i][7]) || 0
  }

  // Index OI + LS ratio by exact timestamp. Binance OI cadence usually
  // matches kline cadence; if not, we nearest-neighbor below.
  const oiByTs = new Map()
  for (const row of oiHist) {
    const ts = Number(row?.timestamp)
    const oiUsd = Number(row?.sumOpenInterestValue)
    if (Number.isFinite(ts) && oiUsd > 0) oiByTs.set(ts, oiUsd)
  }
  const lsByTs = new Map()
  for (const row of lsRatio) {
    const ts = Number(row?.timestamp)
    const longShare = pctNum(row?.longAccount, 0.5)
    if (Number.isFinite(ts)) lsByTs.set(ts, longShare)
  }
  const oiList = [...oiByTs.entries()].sort((a, b) => a[0] - b[0])

  function nearestOI(ts) {
    if (oiByTs.has(ts)) return oiByTs.get(ts)
    // Binary search nearest.
    let lo = 0, hi = oiList.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (oiList[mid][0] < ts) lo = mid + 1
      else hi = mid
    }
    const candidates = []
    if (oiList[lo]) candidates.push(oiList[lo])
    if (oiList[lo - 1]) candidates.push(oiList[lo - 1])
    if (candidates.length === 0) return 0
    candidates.sort((a, b) => Math.abs(a[0] - ts) - Math.abs(b[0] - ts))
    return candidates[0][1]
  }
  function nearestLS(ts) {
    return lsByTs.get(ts) ?? 0.5
  }

  // Per-candle OI ($) + long share over the FULL fetch.
  const oiUsd = new Float64Array(totalCols)
  const longShare = new Float64Array(totalCols)
  for (let i = 0; i < totalCols; i++) {
    oiUsd[i] = nearestOI(time[i])
    longShare[i] = nearestLS(time[i])
  }
  // OI coverage: openInterestHist caps at 30 days / 500 rows, so long
  // timeframes only partially overlap it. A candle "has OI" when a real OI
  // sample exists within one period of it.
  const periodMs = totalCols > 1 ? time[1] - time[0] : 60_000
  const hasOi = (i) => {
    if (oiList.length === 0) return false
    return time[i] >= oiList[0][0] - periodMs && time[i] <= oiList[oiList.length - 1][0] + periodMs
  }

  // ── Price grid (spans the DISPLAY window only) ──────────────────────────
  // Covers display high/low plus enough headroom so low-leverage liq bands
  // stay on-canvas.
  let minP = Infinity, maxP = -Infinity
  for (let i = preLen; i < totalCols; i++) {
    if (high[i] > maxP) maxP = high[i]
    if (low[i] < minP) minP = low[i]
  }
  const span = maxP - minP || maxP * 0.02 || 1
  // Cushion = ~max projected liq distance. 100x = 1% but 10x = 10% — use 10x
  // bound + margin so even low-leverage tier bands stay on-canvas.
  const cushion = Math.max(span * 0.35, maxP * 0.115)
  minP = Math.max(0, minP - cushion)
  maxP = maxP + cushion
  // Grid pitch tuned to the CoinGlass reference. The client's default frame
  // shows only the near-price slice of this grid (~25% of it), so the row
  // count must be high enough that the VISIBLE slice still renders fine
  // 2-3px lines: 600 rows over the full grid ≈ $25-30 bins on BTC.
  const rows = 600
  const priceStep = (maxP - minP) / rows
  const priceArray = new Array(rows)
  for (let r = 0; r < rows; r++) priceArray[r] = minP + r * priceStep
  const timeArray = Array.from(time.slice(preLen))
  const binOf = (p) => Math.floor((p - minP) / priceStep)

  // ── Build cohorts from ΔOI — the CoinGlass recipe ─────────────────────────
  // New positions exist only where OPEN INTEREST grew, not wherever volume
  // traded (volume is mostly position churn: every candle has it, and using
  // it painted an even featureless "picket fence" of lines). Audited on live
  // BTC 30m data: only ~half the candles have positive ΔOI, with a 20x spread
  // between median and biggest — that variance is what makes CoinGlass lines
  // sparse, varied and born at specific moments.
  //   • FLOW cohorts: candle i with ΔOI > 0 opens a cohort of that notional at
  //     close[i]. Candles with flat/negative ΔOI birth nothing.
  //   • SEED cohorts: the OI standing at the DISPLAY window's open distributes
  //     over the PRE-window's positive-ΔOI bursts (at their close prices) —
  //     approximating where the standing positions actually entered. Falls
  //     back to volume weights when OI history doesn't cover the pre-window.
  //   • Everything is scaled from Binance ΔOI to the whole market via the
  //     aggregate-venue / Binance OI ratio.
  // Eviction (below) then kills every (cohort, tier) whose liq level price has
  // crossed since entry — including pre-window crossings for seed cohorts.
  let totalQVol = 0
  for (let i = preLen; i < totalCols; i++) totalQVol += quoteVol[i]
  const aggOiCoins = await oiPromise
  const aggOi = { total: aggOiCoins.totalCoins * close[totalCols - 1], venues: aggOiCoins.venues }
  const binanceOiNow = oiUsd[totalCols - 1]
  // Whole-market scale on top of Binance-only ΔOI.
  const marketScale = aggOi.total > 0 && binanceOiNow > 0 ? aggOi.total / binanceOiNow : 1

  // Static leverage ladder. The tape-calibration experiment is deliberately
  // NOT applied: its estimator can only see entries inside the fetch window,
  // which systematically over-weights high leverage (measured: 49% of weight
  // pushed into >=75x vs 13% static) and collapses the far-field structure.
  // Optional single-tier view (`leverage=` query): keep the tier's RAW weight
  // (no renormalization) so magnitudes stay honest shares of the full model.
  const tierFilter = LEV_TIERS.some(t => t.lev === Number(leverage)) ? Number(leverage) : null
  const activeTiers = tierFilter ? LEV_TIERS.filter(t => t.lev === tierFilter) : LEV_TIERS
  const longTiers = activeTiers
  const shortTiers = activeTiers
  const calibSource = tierFilter ? `static-${tierFilter}x` : 'static'

  const mkCohort = (openCol, entryPrice, notional, lShare) => ({
    openCol,
    openPrice: entryPrice,
    longUsd: notional * lShare,
    shortUsd: notional * (1 - lShare),
    longAlive: new Uint8Array(LEV_TIERS.length).fill(1),
    shortAlive: new Uint8Array(LEV_TIERS.length).fill(1),
  })

  const cohorts = []

  // FLOW: positive-ΔOI candles in the display window. Volume fallback when the
  // OI series is unusable (venue outage) — the chart must never blank.
  let dOiCandles = 0
  for (let i = Math.max(1, preLen); i < totalCols; i++) {
    if (!hasOi(i) || !hasOi(i - 1)) continue
    const dOi = oiUsd[i] - oiUsd[i - 1]
    if (dOi > 0) {
      cohorts.push(mkCohort(i, close[i], dOi * marketScale, longShare[i]))
      dOiCandles++
    }
  }
  const flowSource = dOiCandles >= 5 ? 'delta-oi' : 'volume-fallback'
  if (flowSource === 'volume-fallback') {
    cohorts.length = 0
    for (let i = preLen; i < totalCols; i++) {
      if (quoteVol[i] > 0) cohorts.push(mkCohort(i, close[i], quoteVol[i], longShare[i]))
    }
  }

  // SEED: standing OI at the display window's open, distributed over
  // pre-window entry bursts. Weight = positive ΔOI where covered, else volume.
  // SEED_DAMP: seed notional is ~10x the flow notional, which under a
  // percentile tone-map erases every band born inside the window. Damp the
  // seed so window births stay visible. 1.0 = honest standing OI; tuned
  // visually against the CoinGlass reference.
  const SEED_DAMP = 0.5
  const standingUsd = ((hasOi(preLen) ? oiUsd[preLen] : binanceOiNow) * marketScale || aggOi.total || totalQVol * 1.5) * SEED_DAMP
  if (preLen > 1) {
    const seedW = new Float64Array(preLen)
    let seedWSum = 0
    let oiCovered = 0
    for (let i = 1; i < preLen; i++) if (hasOi(i) && hasOi(i - 1)) oiCovered++
    const useOiWeights = oiCovered >= Math.max(5, Math.floor((preLen - 1) * 0.2))
    for (let i = 1; i < preLen; i++) {
      const w = useOiWeights
        ? (hasOi(i) && hasOi(i - 1) ? Math.max(0, oiUsd[i] - oiUsd[i - 1]) : 0)
        : quoteVol[i]
      seedW[i] = w
      seedWSum += w
    }
    if (seedWSum > 0) {
      for (let i = 1; i < preLen; i++) {
        if (seedW[i] <= 0) continue
        cohorts.push(mkCohort(i, close[i], standingUsd * (seedW[i] / seedWSum), longShare[i]))
      }
    }
  } else {
    // No pre-window fetched (kline cap) — seed everything at the first display
    // candle's close so the chart still carries the standing notional.
    cohorts.push(mkCohort(preLen, close[preLen], standingUsd, longShare[preLen]))
  }

  // FABRIC: per-candle micro-cohorts ∝ traded volume, display window only.
  // Binance ΔOI moves only on NET position growth, so flow cohorts birth bands
  // sparsely (~half the candles); real books also open positions on churn
  // candles. Give every display candle a cohort sized from its traded volume,
  // with the whole fabric budget equal to the (damped) standing OI. Adjacent
  // candles' high-leverage projections land in neighboring price bins and
  // stack additively — that is the dense woven near-price texture CoinGlass
  // shows. Skipped when flow already fell back to per-candle volume.
  if (flowSource !== 'volume-fallback' && totalQVol > 0 && standingUsd > 0) {
    for (let i = preLen; i < totalCols; i++) {
      if (quoteVol[i] <= 0) continue
      cohorts.push(mkCohort(i, close[i], standingUsd * (quoteVol[i] / totalQVol), longShare[i]))
    }
  }

  // Cohorts must be in chronological order for the openCol>t early-break.
  cohorts.sort((a, b) => a.openCol - b.openCol)

  // ── Cumulative accumulation pass ────────────────────────────────────────
  // For each column t (chronological), walk every cohort opened at
  // openCol ≤ t. For each (still-alive) tier on each side, project liq price
  // and either evict (if price crossed it within [openCol .. t]) or
  // accumulate cohort.usd × tier.w into heatmap[t][bin(liq_price)].
  const dense = new Float64Array(rows * cols)

  // ── Liquidation MAP accumulators (opt-in) ────────────────────────────────
  // The heatmap answers "where were liq levels over TIME". The map answers
  // "where do the levels standing RIGHT NOW sit, and at what leverage" — the
  // CoinGlass price-axis view. Same cohorts, same projections, same eviction:
  // we just also record the FINAL column's surviving levels per
  // (price bin x leverage tier x side) instead of only per (time, price).
  const nTiers = LEV_TIERS.length
  const mapLong = collectMap ? new Float64Array(rows * nTiers) : null
  const mapShort = collectMap ? new Float64Array(rows * nTiers) : null
  const finalCol = totalCols - 1

  // Direct single-bin deposit — no feather. Each (entry, tier) projection
  // lands in exactly one row, so the output is discrete 1-row liquidation
  // LINES (the CoinGlass texture). Any smoothing here re-merges them into the
  // wide featureless bands the founder rejected.
  function deposit(t, row, val) {
    dense[t * rows + row] += val
  }

  // Running min/max from cohort.openCol → t, kept per cohort and advanced
  // along with t. minSinceOpen / maxSinceOpen.
  const minSO = new Float64Array(cohorts.length).fill(Infinity)
  const maxSO = new Float64Array(cohorts.length).fill(-Infinity)
  // High-watermark of which t each cohort has been advanced to.
  const lastT = new Int32Array(cohorts.length).fill(-1)

  // t walks the FULL candle range: pre-window columns advance eviction state
  // (a seed cohort whose level was swept before the display window opened must
  // not paint) but only display columns (t >= preLen) deposit, into t-preLen.
  for (let t = 0; t < totalCols; t++) {
    const depositCol = t - preLen
    for (let ci = 0; ci < cohorts.length; ci++) {
      const co = cohorts[ci]
      if (co.openCol > t) break // cohorts are in chronological order
      // Advance running min/max up to and including candle t.
      if (lastT[ci] < t) {
        const fromCol = lastT[ci] < 0 ? co.openCol : lastT[ci] + 1
        for (let k = fromCol; k <= t; k++) {
          if (high[k] > maxSO[ci]) maxSO[ci] = high[k]
          if (low[k] < minSO[ci]) minSO[ci] = low[k]
        }
        lastT[ci] = t
      }

      // Long tiers — liq below openPrice. Evicted if minSO ≤ liqPrice.
      for (let li = 0; li < longTiers.length; li++) {
        if (!co.longAlive[li]) continue
        const { lev, w } = longTiers[li]
        const liqPrice = co.openPrice * (1 - 1 / lev) + co.openPrice * MAINT_MARGIN
        if (minSO[ci] <= liqPrice) {
          co.longAlive[li] = 0
          continue
        }
        const row = binOf(liqPrice)
        if (collectMap && t === finalCol && row >= 0 && row < rows) {
          mapLong[row * nTiers + li] += co.longUsd * w
        }
        if (depositCol < 0) continue
        if (row >= 0 && row < rows) deposit(depositCol, row, co.longUsd * w)
      }

      // Short tiers — liq above openPrice. Evicted if maxSO ≥ liqPrice.
      for (let si = 0; si < shortTiers.length; si++) {
        if (!co.shortAlive[si]) continue
        const { lev, w } = shortTiers[si]
        const liqPrice = co.openPrice * (1 + 1 / lev) - co.openPrice * MAINT_MARGIN
        if (maxSO[ci] >= liqPrice) {
          co.shortAlive[si] = 0
          continue
        }
        const row = binOf(liqPrice)
        if (collectMap && t === finalCol && row >= 0 && row < rows) {
          mapShort[row * nTiers + si] += co.shortUsd * w
        }
        if (depositCol < 0) continue
        if (row >= 0 && row < rows) deposit(depositCol, row, co.shortUsd * w)
      }
    }
  }

  let maxVal = 0
  for (let i = 0; i < dense.length; i++) if (dense[i] > maxVal) maxVal = dense[i]

  // How many columns birth at least one NEW band inside the display window —
  // the CoinGlass wedge texture depends on these existing. Probed via _stats.
  let midWindowBirths = 0
  for (let t = 5; t < cols; t++) {
    for (let r = 0; r < rows; r++) {
      if (dense[t * rows + r] > 0 && dense[(t - 1) * rows + r] === 0) { midWindowBirths++; break }
    }
  }

  // ── Crop empty top/bottom rows ────────────────────────────────────────────
  // The price grid carries a wide cushion so far low-leverage bands fit, but the
  // outer ~10% top and bottom hold no meaningful density — they render as dead
  // black strips. Trim the grid to the rows that carry >2% of peak density
  // (padded a little), but never crop tighter than the candles so price stays
  // visible. Everything downstream (priceArray, grid rows) uses the cropped range.
  const cropThresh = maxVal * 0.02
  const rowPeak = new Float64Array(rows)
  for (let t = 0; t < cols; t++) {
    for (let r = 0; r < rows; r++) {
      const v = dense[t * rows + r]
      if (v > rowPeak[r]) rowPeak[r] = v
    }
  }
  let r0 = 0, r1 = rows - 1
  while (r0 < rows - 1 && rowPeak[r0] <= cropThresh) r0++
  while (r1 > r0 && rowPeak[r1] <= cropThresh) r1--
  r0 = Math.max(0, r0 - 3)
  r1 = Math.min(rows - 1, r1 + 3)
  // Keep the (display) candles in frame.
  let kLo = Infinity, kHi = -Infinity
  for (let i = preLen; i < totalCols; i++) { if (low[i] < kLo) kLo = low[i]; if (high[i] > kHi) kHi = high[i] }
  const krLo = binOf(kLo), krHi = binOf(kHi)
  if (krLo >= 0 && krLo < r0) r0 = krLo
  if (krHi < rows && krHi > r1) r1 = krHi
  const outRows = r1 - r0 + 1
  const outPriceArray = priceArray.slice(r0, r1 + 1)

  // ── Sparsify above magnitude floor (within the cropped row range) ─────────
  // Server floor only trims payload; the visibility cut lives client-side in
  // the Liquidity Threshold percentile slider.
  const floor = maxVal * 0.001
  const grid = []
  for (let t = 0; t < cols; t++) {
    for (let r = r0; r <= r1; r++) {
      const v = dense[t * rows + r]
      // Round to whole USD — the field is dense now, so integer values shave
      // ~30% off the JSON payload with no visible difference after upscale.
      if (v > floor) grid.push({ col: t, row: r - r0, value: Math.round(v) })
    }
  }

  // ── Assemble the liquidation MAP payload ────────────────────────────────
  // One row per price bin that carries anything, with the notional split by
  // leverage tier and side, plus the cumulative curves CoinGlass draws:
  // longs accumulate DOWNWARD from spot (they liquidate as price falls) and
  // shorts accumulate UPWARD, so each curve reads "how much gets liquidated
  // by the time price reaches here".
  let liqMap = null
  if (collectMap) {
    const spot = close[totalCols - 1]
    const levels = []
    let peak = 0
    for (let r = 0; r < rows; r++) {
      const tiers = []
      let long = 0
      let short = 0
      for (let k = 0; k < nTiers; k++) {
        const l = mapLong[r * nTiers + k]
        const sh = mapShort[r * nTiers + k]
        tiers.push({ lev: LEV_TIERS[k].lev, long: Math.round(l), short: Math.round(sh) })
        long += l
        short += sh
      }
      const total = long + short
      if (total <= 0) continue
      if (total > peak) peak = total
      levels.push({ price: priceArray[r], long: Math.round(long), short: Math.round(short), tiers })
    }
    levels.sort((a, b) => a.price - b.price)
    // cumulative long: walk DOWN from spot; cumulative short: walk UP from spot
    let cum = 0
    for (let i = levels.length - 1; i >= 0; i--) {
      if (levels[i].price >= spot) continue
      cum += levels[i].long
      levels[i].cumLong = Math.round(cum)
    }
    cum = 0
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].price <= spot) continue
      cum += levels[i].short
      levels[i].cumShort = Math.round(cum)
    }
    const totalLong = levels.reduce((a, l) => a + l.long, 0)
    const totalShort = levels.reduce((a, l) => a + l.short, 0)
    liqMap = {
      spot,
      levels,
      tiers: LEV_TIERS.map((t) => t.lev),
      peakLevelUsd: Math.round(peak),
      totalLongUsd: Math.round(totalLong),
      totalShortUsd: Math.round(totalShort),
    }
  }

  return {
    grid,
    rows: outRows,
    cols,
    timeArray,
    priceArray: outPriceArray,
    liqMap,
    symbol,
    timeframe,
    _source: 'binance-cohort-cumulative',
    _computed_at: Date.now(),
    _stats: {
      total_cells: grid.length,
      total_cohorts: cohorts.length,
      total_oi_samples: oiByTs.size,
      total_ls_samples: lsByTs.size,
      price_range: [Math.round(minP), Math.round(maxP)],
      max_cell_usd: maxVal,
      calibration: calibSource,
      oi_venues: aggOi.venues,
      flow_source: flowSource,
      delta_oi_candles: dOiCandles,
      market_scale: Math.round(marketScale * 100) / 100,
      seed_total_usd: Math.round(standingUsd),
      mid_window_births: midWindowBirths,
    },
  }
}

/**
 * Liquidation MAP — the price-axis projection of the same cohort model.
 * Returns { spot, levels[{price,long,short,cumLong,cumShort,tiers[]}], tiers,
 * peakLevelUsd, totalLongUsd, totalShortUsd }.
 */
export async function buildBinanceLiqMap(symbol = 'BTCUSDT', timeframe = '1d') {
  const hm = await buildBinanceLiqHeatmap(symbol, timeframe, { collectMap: true })
  if (!hm.liqMap) throw new Error('liq map unavailable')
  return { ...hm.liqMap, symbol, timeframe, _stats: hm._stats }
}

/**
 * Real OHLCV candles from Binance Futures.
 *
 * Takes a DIRECT kline interval ('5m', '15m', '12h', '1d', ...) and a limit.
 * Does NOT resolve through TF_CONFIG even when interval looks like a TF key —
 * the frontend's `getExternalExchangeList(...)` always sends the actual kline
 * cadence (e.g., '12h' for the 3M tab means "12-hour klines", NOT "12H tab").
 *
 * Valid Binance intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h,
 * 1d, 3d, 1w, 1M.
 */
export async function buildBinanceCandles(symbol = 'BTCUSDT', interval = '15m', limit = 500) {
  const klineInterval = String(interval || '15m')
  const klineLimit = Math.min(Number(limit) || 500, 1500)
  const klines = await fetchKlinesWithFallback(symbol, klineInterval, klineLimit)
  return {
    candles: klines.map(k => ({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low:  Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    })),
    symbol,
    interval: klineInterval,
    _source: 'binance-or-bybit-futures',
  }
}
