/**
 * useKlineIndicators — honest technical indicators computed from OHLCV bars.
 *
 * Replaces the synthetic generators in rz-constants.js for the RZ Pro Technicals tab.
 * Fetches ~300 bars via Codex getBars (Binance-proxied for majors, DEX otherwise)
 * and computes EMA200, RSI(14), StochRSI(14,3,3), ATR(14), MACD(12,26,9), BB(20,2),
 * 1h volume, and supply/demand zones from pivot points.
 *
 * Returns: { indicators, supplyDemand, loading, error, bars, resolution }
 *
 * Usage:
 *   const { indicators, supplyDemand, loading } = useKlineIndicators({
 *     symbol: 'BTC', address, networkId, cgId, binancePair, resolution: '60',
 *   })
 */
import { useState, useEffect, useMemo } from 'react'
import { getBars } from '@/services/codexApi'
import { getTokenChart as spectreGetTokenChart } from '@/services/spectreDataApi'
import { getStockSeriesBars } from '@/services/stockApi'
import { computeSRLevels } from '@/lib/sr-levels'
import { detectRegime, computeVolumeRegime } from '@/lib/ta-regime'
import { isAppActive } from '@/lib/idleManager'

// Number of bars to fetch — EMA200 needs 200, we over-fetch for stability
const DEFAULT_BAR_COUNT = 320
// EMA200 needs 200 bars + warmup; below this a source is "short" and we try
// the next source in the chain before settling for it.
const MIN_BARS_FOR_TREND = 210

// ── Bars cache + inflight dedup (module/session lifetime) ────────────────────
// Every timeframe switch (1H -> 4H) used to refetch ~300 bars live. A short-TTL
// cache + inflight map (mirrors the _deduped pattern in use-research-zone-data.js)
// makes flipping back to a recently-viewed timeframe instant and collapses any
// concurrent requests for the same series into one. Key mirrors the ACTUAL fetch
// inputs below — sym/resolution/networkId/cgId/binancePair (address is NOT a fetch
// input here, see deps note on the effect).
const BARS_TTL = 90_000  // 90s — bars are near-static between switches (live price
                         // comes from the SSE/poll hero, not these bars). Was 20s,
                         // which forced a full refetch on almost every tab flip and
                         // made the Technicals tab feel slow.
const _barsCache = {}     // { [key]: { data, ts } }
const _barsInflight = {}  // { [key]: Promise }

function _dedupedBars(key, fetchFn, force = false) {
  const entry = _barsCache[key]
  // `force` (live-panel interval refresh) busts the TTL cache so the refetch
  // actually hits the network instead of being swallowed by the 90s BARS_TTL.
  // An in-flight request is still shared — no duplicate concurrent fetches.
  if (entry && !force && Date.now() - entry.ts <= BARS_TTL) return Promise.resolve(entry.data)
  if (entry) delete _barsCache[key]
  if (_barsInflight[key]) return _barsInflight[key]

  const promise = fetchFn()
    .then((data) => {
      _barsCache[key] = { data, ts: Date.now() }
      delete _barsInflight[key]
      return data
    })
    .catch((err) => {
      delete _barsInflight[key]
      throw err
    })

  _barsInflight[key] = promise
  return promise
}

// ── Cross-session instant-paint seed (localStorage) ──────────────────────────
// The memory `_barsCache` above is wiped on every page reload, so a cold load of
// the Technicals chart shimmers while ~320 bars refetch. v2: a small LRU MAP of
// recent series (was a single entry), so the default TF, the higher-TF majors,
// the weekly outlook series and recent timeframe flips ALL paint instantly on
// reload, then revalidate in the background. This is the main "load speed" fix.
const BARS_SEED_KEY = 'spectre-rz-bars-v2'
const BARS_SEED_TTL = 10 * 60 * 1000  // 10min — stale candles are fine for paint
const BARS_SEED_MAX = 360             // cap stored bars per entry
const BARS_SEED_ENTRIES = 8           // LRU cap — ~8 series ≈ well under 1MB

function _readSeedMap() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(BARS_SEED_KEY)
    const obj = raw ? JSON.parse(raw) : null
    return obj && typeof obj === 'object' && obj.entries ? obj : { entries: {} }
  } catch { return { entries: {} } }
}

function _peekBarsSeedEntry(key) {
  const map = _readSeedMap()
  const entry = map?.entries?.[key]
  if (!entry) return null
  if (Date.now() - entry.ts > BARS_SEED_TTL) return null
  if (!(Array.isArray(entry.bars) && entry.bars.length >= 30)) return null
  return entry
}

function _peekBarsSeed(key) {
  return _peekBarsSeedEntry(key)?.bars ?? null
}

function _writeBarsSeed(key, bars, volUnit = null) {
  if (typeof localStorage === 'undefined') return
  if (!Array.isArray(bars) || bars.length < 30) return
  try {
    const map = _readSeedMap() || { entries: {} }
    map.entries[key] = {
      ts: Date.now(),
      vu: volUnit || undefined,
      bars: bars.slice(-BARS_SEED_MAX).map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
    }
    // LRU evict: keep the newest N entries
    const keys = Object.keys(map.entries)
    if (keys.length > BARS_SEED_ENTRIES) {
      keys.sort((a, b) => (map.entries[a].ts || 0) - (map.entries[b].ts || 0))
      for (const k of keys.slice(0, keys.length - BARS_SEED_ENTRIES)) delete map.entries[k]
    }
    localStorage.setItem(BARS_SEED_KEY, JSON.stringify(map))
  } catch { /* quota / serialize failure — instant-paint is best-effort */ }
}

// Seconds per resolution code (Codex/TV UDF convention)
const RESOLUTION_SECONDS = {
  '1':   60,
  '5':   5 * 60,
  '15':  15 * 60,
  '30':  30 * 60,
  '60':  60 * 60,
  '240': 4 * 60 * 60,
  '720': 12 * 60 * 60,
  '1D':  24 * 60 * 60,
  '1W':  7 * 24 * 60 * 60,
}

// ── Math primitives ─────────────────────────────────────────────────────────

function sma(values, period) {
  if (!values || values.length < period) return null
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

export function emaSeries(values, period) {
  if (!values || values.length < period) return null
  const k = 2 / (period + 1)
  // Seed with SMA of first `period` values
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const out = new Array(period - 1).fill(null)
  out.push(ema)
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
    out.push(ema)
  }
  return out
}

export function rsiSeries(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null
  const gains = []
  const losses = []
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(Math.max(0, diff))
    losses.push(Math.max(0, -diff))
  }
  // Wilder's smoothing: initial average = SMA, then recursive
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period
  const out = new Array(period).fill(null)
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs))
  }
  return out
}

export function stochRsi(rsi, rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3) {
  if (!rsi || rsi.length < rsiPeriod + stochPeriod) return null
  // %K raw: (RSI - min(RSI,stochPeriod)) / (max(RSI,stochPeriod) - min(RSI,stochPeriod)) * 100
  const kRaw = rsi.map((v, i) => {
    if (v == null || i < rsiPeriod + stochPeriod - 1) return null
    const window = rsi.slice(i - stochPeriod + 1, i + 1).filter(x => x != null)
    if (!window.length) return null
    const min = Math.min(...window)
    const max = Math.max(...window)
    if (max === min) return 50
    return ((v - min) / (max - min)) * 100
  })
  // Smooth %K
  const kSmooth = kRaw.map((_, i) => {
    const win = kRaw.slice(Math.max(0, i - smoothK + 1), i + 1).filter(x => x != null)
    return win.length === smoothK ? win.reduce((a, b) => a + b, 0) / smoothK : null
  })
  // %D = SMA of %K
  const dLine = kSmooth.map((_, i) => {
    const win = kSmooth.slice(Math.max(0, i - smoothD + 1), i + 1).filter(x => x != null)
    return win.length === smoothD ? win.reduce((a, b) => a + b, 0) / smoothD : null
  })
  const lastK = [...kSmooth].reverse().find(x => x != null)
  const lastD = [...dLine].reverse().find(x => x != null)
  return { k: lastK ?? null, d: lastD ?? null }
}

export function atrSeries(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period + 1) return null
  const trs = []
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i]
    const hc = Math.abs(highs[i] - closes[i - 1])
    const lc = Math.abs(lows[i] - closes[i - 1])
    trs.push(Math.max(hl, hc, lc))
  }
  // Wilder's smoothing
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  const out = new Array(period).fill(null)
  out.push(atr)
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
    out.push(atr)
  }
  return out
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = emaSeries(closes, fast)
  const emaSlow = emaSeries(closes, slow)
  if (!emaFast || !emaSlow) return null
  const macdLine = emaFast.map((v, i) =>
    (v != null && emaSlow[i] != null) ? v - emaSlow[i] : null
  )
  const valid = macdLine.filter(x => x != null)
  if (valid.length < signal) return null
  // Signal = EMA of macdLine (skip leading nulls)
  const firstIdx = macdLine.findIndex(x => x != null)
  const trimmed = macdLine.slice(firstIdx)
  const signalSeries = emaSeries(trimmed, signal)
  if (!signalSeries) return null
  const lastMacd = macdLine[macdLine.length - 1]
  const lastSignal = signalSeries[signalSeries.length - 1]
  const lastHist = (lastMacd != null && lastSignal != null) ? lastMacd - lastSignal : null
  return { line: lastMacd ?? null, signal: lastSignal ?? null, histogram: lastHist }
}

export function bollingerBands(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) return null
  const slice = closes.slice(-period)
  const middle = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period
  const sd = Math.sqrt(variance)
  return {
    upper: middle + mult * sd,
    middle,
    lower: middle - mult * sd,
  }
}

// Per-series volume UNIT, learned from whichever bars source won the fetch.
//   'base'  — volume is in base-asset units (Binance klines, Yahoo shares)
//             → multiply by close for $ volume.
//   'quote' — volume is already USD/quote (Codex getTokenBars, GeckoTerminal,
//             CG OHLC) → summing it is the $ volume; multiplying by close
//             again squared the price (the old unconditional `vol * close`).
//   'unknown' — source didn't say (Spectre chart leg, seed without vu) → keep
//             the legacy vol*close but flag the display as an estimate (~est).
const _volUnitByKey = {}

const CODEX_SOURCE_UNIT = {
  binance: 'base',
  codex: 'quote',
  geckoterminal: 'quote',
  'cg-ohlc': 'quote',
  hetzner: 'unknown',
}

/** Last-known volume unit for a series ('base' | 'quote' | 'unknown'). */
export function seriesVolumeUnit(params) {
  const key = seriesKey(params)
  return _volUnitByKey[key] || _peekBarsSeedEntry(key)?.vu || 'unknown'
}

function volume1h(bars, resolutionSec, unit = 'unknown') {
  if (!bars?.length || !resolutionSec) return { usd: null, estimated: false }
  const barsPerHour = Math.max(1, Math.round(3600 / resolutionSec))
  const recent = bars.slice(-barsPerHour)
  const totalUsd = recent.reduce((acc, b) => {
    const vol = Number(b.v) || 0
    const close = Number(b.c) || 0
    if (unit === 'quote') return acc + vol           // already $ volume
    return acc + vol * close                          // base units (or unknown → legacy)
  }, 0)
  return { usd: totalUsd > 0 ? totalUsd : null, estimated: unit === 'unknown' }
}

// ── Shared bars fetcher ─────────────────────────────────────────────────────
// Spectre OHLC first (free, CG-aggregated); falls back to server /api/bars
// (Codex+Binance+CG chained). A source that returns FEWER than
// MIN_BARS_FOR_TREND bars no longer wins outright — we try the next source
// and keep whichever series is longer. This is the EMA200 fix: the Spectre
// path often returns ~100-180 bars on 4H, which used to short-circuit the
// chain and leave EMA200 (needs 200) permanently null.
const SPECTRE_INTERVAL = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '240': '4h', '720': '12h', '1D': '1d', '1W': '1w' }

function _cleanBars(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(b => ({
      t: Number(b.t ?? b.time) || 0,
      o: Number(b.o ?? b.open) || 0,
      h: Number(b.h ?? b.high) || 0,
      l: Number(b.l ?? b.low) || 0,
      c: Number(b.c ?? b.close) || 0,
      v: Number(b.v ?? b.volume ?? 0),
    }))
    .filter(b => Number.isFinite(b.c) && b.c > 0)
    .sort((a, b) => a.t - b.t)
}

/**
 * Fetch cleaned, ascending OHLCV bars for a symbol/resolution.
 * Deduped + TTL-cached (module lifetime). Used by the indicators hook AND by
 * the Technicals chart for higher-timeframe S/R levels.
 */
export function seriesKey({ symbol, resolution = '60', networkId = 1, cgId = null, binancePair = null, assetClass = null }) {
  const sym = (symbol || '').toUpperCase().split(':')[0]
  // Stocks are namespaced apart from crypto: a stock ticker must never read a
  // crypto token's cached bars (the AAPL-clone collision class) and vice versa.
  if (assetClass === 'stock') return `bars:stock:${sym}:${resolution}`
  return `bars:${sym}:${resolution}:${networkId || 1}:${cgId || ''}:${binancePair || ''}`
}

/** Synchronous last-known bars for a series (localStorage seed) — instant paint. */
export function peekSeriesBars(params) {
  return _peekBarsSeed(seriesKey(params))
}

export function fetchSeriesBars({ symbol, resolution = '60', networkId = 1, cgId = null, binancePair = null, barCount = DEFAULT_BAR_COUNT, assetClass = null, force = false }) {
  const sym = (symbol || '').toUpperCase().split(':')[0]
  if (!sym) return Promise.resolve([])
  const key = seriesKey({ symbol: sym, resolution, networkId, cgId, binancePair, assetClass })

  // Stocks: dedicated Yahoo leg (/api/stocks/candles via getStockSeriesBars).
  // A stock NEVER enters the crypto chain below — the Spectre store and
  // /api/bars resolve bare tickers against crypto registries, so a stock
  // symbol either returned no_data or, worse, a same-ticker crypto token's
  // bars. Ranges are sized by getStockSeriesBars for the EMA200 warm-up
  // where Yahoo's interval caps allow; when they don't, fewer bars come
  // back and the engine's existing "needs N bars" honesty renders nulls.
  if (assetClass === 'stock') {
    return _dedupedBars(key, async () => {
      let bars = []
      try {
        const res = await getStockSeriesBars(sym, String(resolution))
        bars = _cleanBars(res?.bars)
      } catch (_) { /* empty result below */ }
      if (bars.length) {
        // Yahoo volume is SHARES (base units) — vol*close is the correct $ read.
        _volUnitByKey[key] = 'base'
        _writeBarsSeed(key, bars, 'base')
      }
      return bars
    }, force)
  }

  return _dedupedBars(key, async () => {
    const resSec = RESOLUTION_SECONDS[String(resolution)] || 3600
    const to = Math.floor(Date.now() / 1000)
    const from = to - resSec * barCount
    const sInterval = SPECTRE_INTERVAL[String(resolution)] || '1h'

    // Hard per-source deadlines. A slow (cold serverless / rate-limited)
    // upstream used to stall the whole Technicals tab for 20s+ — now a slow
    // Spectre leg yields to the Codex chain after 8s, and the chain itself
    // is capped at 12s. Worst-case total ~20s becomes the rare double-slow
    // path; the common case is bounded by whichever source answers first.
    const withDeadline = (p, ms) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('bars-deadline')), ms)),
    ])

    let spectreBars = []
    try {
      const sp = await withDeadline(spectreGetTokenChart(sym, sInterval), 8000)
      spectreBars = _cleanBars(sp?.bars)
    } catch (_) { /* fall through */ }
    // A long-enough Spectre series wins without a second request.
    if (spectreBars.length >= MIN_BARS_FOR_TREND) {
      // Spectre chart bars don't declare their volume unit — keep the legacy
      // vol*close read but let the display label it as an estimate.
      _volUnitByKey[key] = 'unknown'
      _writeBarsSeed(key, spectreBars)
      return spectreBars
    }

    let codexBars = []
    let codexUnit = null
    try {
      const res = await withDeadline(getBars(sym, String(resolution), from, to, networkId || 1, cgId, binancePair), 12000)
      codexBars = _cleanBars(res?.getBars)
      // The /api/bars payload names its winning tier: Binance klines report
      // BASE-asset volume (multiply by close); Codex/GeckoTerminal/CG report
      // USD/quote volume (sum as-is). Unknown tiers stay 'unknown' (~est).
      codexUnit = CODEX_SOURCE_UNIT[res?.source] || 'unknown'
    } catch (_) { /* fall through */ }

    // Keep whichever series actually has depth; require the minimum viable 30.
    const best = codexBars.length > spectreBars.length ? codexBars : spectreBars
    const result = best.length > 30 ? best : (spectreBars.length ? spectreBars : codexBars)
    const unit = (result === codexBars && codexUnit) ? codexUnit : 'unknown'
    if (result.length) {
      _volUnitByKey[key] = unit
      // Persist for cross-session instant paint (primary, major AND weekly
      // series all seed — the v2 map holds several entries).
      _writeBarsSeed(key, result, unit)
    }
    return result
  }, force)
}

// Visibility-gated live-refresh cadence per resolution — mirrors the chart's
// pollIntervalForResolution (TradingViewAdvanced), so the indicator panel and
// the chart tick on the same clock. Exported so the tab can honestly badge
// "live" only when the last resolve is within 2× this cadence.
const REFRESH_CADENCE_MS = {
  '1':   30_000,
  '5':   60_000,
  '15':  90_000,
  '30':  120_000,
  '60':  120_000,
  '240': 240_000,
  '720': 600_000,
  '1D':  600_000,
  '1W':  1_200_000,
}
export function refreshCadenceMs(resolution) {
  return REFRESH_CADENCE_MS[String(resolution)] || 120_000
}

// Higher timeframe used for "major" S/R levels per trading resolution.
// Intraday charts anchor majors on the daily; daily anchors on the weekly;
// weekly derives majors from its own series (null = same-series stricter scan).
export function majorResolutionFor(resolution) {
  const r = String(resolution)
  if (r === '1W') return null
  if (r === '1D') return '1W'
  return '1D'
}

// ── Hook ────────────────────────────────────────────────────────────────────

export default function useKlineIndicators({
  symbol,
  address = null,
  networkId = 1,
  cgId = null,
  binancePair = null,
  resolution = '60',
  barCount = DEFAULT_BAR_COUNT,
  keyLevels = null,   // optional override from tokenProfile.key_levels
  assetClass = null,  // 'stock' routes bars through Yahoo, never the crypto chain
} = {}) {
  const [bars, setBars] = useState(null)
  const [majorBars, setMajorBars] = useState(null)
  const [weeklyBars, setWeeklyBars] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Honest freshness for the panel: `asOf` = timestamp of the data currently
  // painted (seed write time while seeded, network resolve time after);
  // `isSeed` = true while the panel is painting from the localStorage seed
  // before the network has confirmed it. The tab uses these to show a green
  // live dot only when the read is genuinely fresh.
  const [asOf, setAsOf] = useState(null)
  const [isSeed, setIsSeed] = useState(false)
  const [volUnit, setVolUnit] = useState('unknown')

  useEffect(() => {
    if (!symbol) { setBars(null); setMajorBars(null); setWeeklyBars(null); setAsOf(null); setIsSeed(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    const sym = (symbol || '').toUpperCase().split(':')[0]
    const idParams = { symbol: sym, networkId, cgId, binancePair, assetClass }
    const primaryParams = { ...idParams, resolution }

    // Cold-reload instant paint: hydrate ALL series from the cross-session
    // seed map so the panel computes immediately; fetches below revalidate.
    const seededEntry = _peekBarsSeedEntry(seriesKey(primaryParams))
    const seeded = seededEntry?.bars ?? null
    if (seeded) {
      setBars(seeded)
      setAsOf(seededEntry.ts || null)
      setIsSeed(true)
      setVolUnit(seededEntry.vu || 'unknown')
      setLoading(false)
    } else {
      setAsOf(null)
      setIsSeed(false)
    }
    const majorRes = majorResolutionFor(resolution)
    const seededMajor = majorRes ? peekSeriesBars({ ...idParams, resolution: majorRes }) : null
    if (seededMajor) setMajorBars(seededMajor)
    const seededWeekly = resolution !== '1W' ? peekSeriesBars({ ...idParams, resolution: '1W' }) : null
    if (seededWeekly) setWeeklyBars(seededWeekly)

    // Persisted across this effect's poll ticks (same closure). Skip setBars when
    // the refetch returned byte-identical candles (no new/updated bar) — otherwise
    // a new array identity forced a full indicator recompute (EMA200×2, stochRSI,
    // ATR, MACD, BB, S/R, regime over ~320 bars) every cadence for nothing.
    let lastPrimarySig = ''
    const applyPrimary = (cleaned) => {
      if (cleaned.length) {
        const last = cleaned[cleaned.length - 1]
        const sig = `${cleaned.length}|${last?.t}|${last?.c}|${last?.h}|${last?.l}`
        if (sig !== lastPrimarySig) {
          lastPrimarySig = sig
          setBars(cleaned)
        }
        setAsOf(Date.now())
        setIsSeed(false)
        setVolUnit(seriesVolumeUnit(primaryParams))
      }
      return cleaned.length > 0
    }

    fetchSeriesBars({ ...primaryParams, barCount })
      .then(cleaned => {
        if (cancelled) return
        if (!applyPrimary(cleaned) && !seeded) {
          // Empty result with no seed to fall back on — clear. If we DID seed,
          // keep the stale candles painted rather than blanking the chart.
          setBars(null)
        }
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        console.error('[useKlineIndicators] getBars failed:', err?.message || err)
        setError(err?.message || 'fetch failed')
        // Stale-while-revalidate: keep seeded candles on a transient failure.
        if (!seeded) setBars(null)
        setLoading(false)
      })

    // Live panel: visibility-gated auto-refetch of the PRIMARY series on the
    // chart's own cadence (30s on 1m … 20min on 1W). `force: true` busts the
    // 90s BARS_TTL memory cache so the interval genuinely revalidates instead
    // of replaying the cached array. Hidden tabs skip the tick entirely.
    // Crypto only — the Yahoo stock leg is unauthenticated and 429-fragile,
    // and stocks never had a background poll; that path stays fetch-once.
    const tid = assetClass === 'stock' ? null : setInterval(() => {
      // Idle guard: also skip on a visible-but-abandoned tab (>5min no input),
      // else a tab parked on Technicals refetches ~320 bars every cadence forever.
      if ((typeof document !== 'undefined' && document.hidden) || !isAppActive()) return
      fetchSeriesBars({ ...primaryParams, barCount, force: true })
        .then(cleaned => { if (!cancelled) applyPrimary(cleaned) })
        .catch(() => { /* keep last good bars; freshness dot will age out */ })
    }, refreshCadenceMs(resolution))

    // Higher-timeframe series for MAJOR support/resistance levels. Best-effort:
    // zones degrade to same-series majors when this fails. Deduped/cached like
    // the main series, so flipping timeframes reuses one daily fetch.
    if (majorRes) {
      fetchSeriesBars({ ...idParams, resolution: majorRes, barCount })
        .then(cleaned => { if (!cancelled) setMajorBars(cleaned.length >= 30 ? cleaned : null) })
        .catch(() => { if (!cancelled) setMajorBars(null) })
    } else {
      setMajorBars(null)
    }

    // Weekly series for the LONG-TERM OUTLOOK (cycle context: dips + fear
    // readings live inside multi-month structure — Sunny 2026-07-02 "we need
    // more outlook"). Skipped when the selected TF is already weekly.
    if (resolution !== '1W') {
      fetchSeriesBars({ ...idParams, resolution: '1W', barCount })
        .then(cleaned => { if (!cancelled) setWeeklyBars(cleaned.length >= 20 ? cleaned : null) })
        .catch(() => { if (!cancelled) setWeeklyBars(null) })
    } else {
      setWeeklyBars(null)
    }

    return () => { cancelled = true; clearInterval(tid) }
    // `address` intentionally NOT in deps — neither the Spectre path nor
    // the Codex /api/bars fallback consumes it. Including it forced a 320-bar
    // refetch every time the identity hook backfilled the address field.
  }, [symbol, networkId, cgId, binancePair, resolution, barCount, assetClass]) // eslint-disable-line react-hooks/exhaustive-deps

  const computed = useMemo(() => {
    if (!bars || bars.length < 30) return null
    const closes = bars.map(b => b.c)
    const highs = bars.map(b => b.h)
    const lows = bars.map(b => b.l)
    const lastPrice = closes[closes.length - 1]

    const ema200Arr = emaSeries(closes, 200)
    const ema200 = ema200Arr ? ema200Arr[ema200Arr.length - 1] : null

    // 50 EMA + recent slope feed the regime read (below). ema200 is null on
    // young / on-chain series with < 200 bars, so the 50 EMA is the trend spine
    // for exactly the runners where "is this an uptrend?" matters most.
    const ema50Arr = emaSeries(closes, 50)
    const ema50 = ema50Arr ? ema50Arr[ema50Arr.length - 1] : null
    const slopeBack = closes[Math.max(0, closes.length - 11)]
    const slopePct = slopeBack ? ((lastPrice - slopeBack) / slopeBack) * 100 : null

    const rsiArr = rsiSeries(closes, 14)
    const rsi14 = rsiArr ? rsiArr[rsiArr.length - 1] : null

    const stoch = stochRsi(rsiArr, 14, 14, 3, 3)

    const atrArr = atrSeries(highs, lows, closes, 14)
    const atr14 = atrArr ? atrArr[atrArr.length - 1] : null

    const macdVals = macd(closes, 12, 26, 9)

    const bb = bollingerBands(closes, 20, 2)

    const resSec = RESOLUTION_SECONDS[String(resolution)] || 3600
    const vol1h = volume1h(bars, resSec, volUnit)

    // Support/resistance: real swing-cluster zones (local from this series,
    // major from the higher-timeframe series). Replaces the old classical-pivot
    // fallback that projected R1-R2/S1-S2 off a whole 50-bar range and routinely
    // landed 20-30% away from price. keyLevels from the API, when present, are
    // kept as ADDITIONAL candidates rather than an override — a stale API level
    // should never hide what the chart actually shows.
    const sr = computeSRLevels(bars, majorBars, lastPrice)

    // Supply = nearest resistance zone, Demand = nearest support zone.
    // Same { low, high } shape as before (mobile + desktop both read it),
    // now with touches/kind attached for richer copy.
    const zonePick = (z) => z
      ? { low: z.low, high: z.high, touches: z.touches, kind: z.kind, untested: z.untested === true, flipped: z.flipped === true, proximityPct: z.proximityPct ?? null }
      : null
    let supply = zonePick(sr.nearest.resistance)
    let demand = zonePick(sr.nearest.support)
    // API key levels as fallback only when detection found nothing on a side.
    if (!supply && keyLevels?.resistance != null && Number(keyLevels.resistance) > lastPrice) {
      supply = { low: Number(keyLevels.resistance) * 0.995, high: Number(keyLevels.resistance) * 1.005, kind: 'api' }
    }
    if (!demand && keyLevels?.support != null && Number(keyLevels.support) < lastPrice) {
      demand = { low: Number(keyLevels.support) * 0.995, high: Number(keyLevels.support) * 1.005, kind: 'api' }
    }

    // Nearest MAJOR levels (higher-timeframe) for the panel + chart labels.
    const majorResistance = sr.major.filter(z => z.side === 'resistance').sort((a, b) => a.mid - b.mid)[0] || null
    const majorSupport = sr.major.filter(z => z.side === 'support').sort((a, b) => b.mid - a.mid)[0] || null

    // Long-term digest from the higher-timeframe series (1D for intraday
    // charts, 1W for the daily chart). Feeds the Trade Thesis panel's
    // "investor" lens — trend, momentum and structure on the slow clock.
    let longTerm = null
    const ltBars = (majorBars && majorBars.length >= 30) ? majorBars : null
    if (ltBars) {
      const ltCloses = ltBars.map(b => b.c)
      const ltLast = ltCloses[ltCloses.length - 1]
      const ltEma200Arr = emaSeries(ltCloses, 200)
      const ltEma200 = ltEma200Arr ? ltEma200Arr[ltEma200Arr.length - 1] : null
      const ltEma50Arr = emaSeries(ltCloses, 50)
      const ltEma50 = ltEma50Arr ? ltEma50Arr[ltEma50Arr.length - 1] : null
      const ltRsiArr = rsiSeries(ltCloses, 14)
      const ltRsi = ltRsiArr ? ltRsiArr[ltRsiArr.length - 1] : null
      const ltMacd = macd(ltCloses, 12, 26, 9)
      const back30 = ltCloses[Math.max(0, ltCloses.length - 31)]
      longTerm = {
        resolution: majorBars === ltBars ? 'higher-tf' : null,
        price: ltLast,
        ema200: ltEma200,
        aboveEma200: ltEma200 != null ? ltLast >= ltEma200 : null,
        ema50: ltEma50,
        aboveEma50: ltEma50 != null ? ltLast >= ltEma50 : null,
        rsi: ltRsi,
        macdCross: (ltMacd?.line != null && ltMacd?.signal != null) ? (ltMacd.line > ltMacd.signal ? 'bullish' : 'bearish') : null,
        change30: (back30 && ltLast) ? ((ltLast - back30) / back30) * 100 : null,
      }
    }

    // LONG-TERM OUTLOOK from weekly bars — the "zoom out" read. Dips + fear
    // prints live inside multi-month structure; this digest says whether the
    // cycle structure is intact regardless of what the 4H is doing.
    let outlook = null
    const wBars = resolution === '1W' ? bars : weeklyBars
    if (wBars && wBars.length >= 20) {
      const wCloses = wBars.map(b => b.c)
      const wLast = wCloses[wCloses.length - 1]
      const wEma50Arr = emaSeries(wCloses, 50)
      const wEma50 = wEma50Arr ? wEma50Arr[wEma50Arr.length - 1] : null
      const wEma200Arr = emaSeries(wCloses, 200)
      const wEma200 = wEma200Arr ? wEma200Arr[wEma200Arr.length - 1] : null
      const back13 = wCloses[Math.max(0, wCloses.length - 14)]  // ~90 days
      const cycleHigh = Math.max(...wBars.map(b => b.h))
      const wMacd = macd(wCloses, 12, 26, 9)
      outlook = {
        weeks: wCloses.length,
        price: wLast,
        ema50w: wEma50,
        aboveEma50w: wEma50 != null ? wLast >= wEma50 : null,
        ema200w: wEma200,
        aboveEma200w: wEma200 != null ? wLast >= wEma200 : null,
        change90d: (back13 && wLast) ? ((wLast - back13) / back13) * 100 : null,
        cycleHigh,
        fromCycleHighPct: cycleHigh > 0 ? ((wLast - cycleHigh) / cycleHigh) * 100 : null,
        macdCrossW: (wMacd?.line != null && wMacd?.signal != null) ? (wMacd.line > wMacd.signal ? 'bullish' : 'bearish') : null,
      }
    }

    // Trend/price regime + volume regime — shared by the gauge (computeSignals),
    // the Bull/Bear cases (buildCases) and the AI copy, all of which read this
    // same `indicators` object, so "overbought" is scored identically everywhere
    // and reframes to trend-strength in an uptrend / price discovery instead of
    // a naked sell. CRYPTO ONLY for now: the stocks path keeps the pre-regime
    // scorer semantics bit-identical (regime rollout for equities is a later,
    // session-aware pass — see stocks-ta-sentiment-plan Phase 4).
    const regime = assetClass === 'stock' ? null : detectRegime({
      price: lastPrice,
      ema50,
      ema200,
      slopePct,
      macdLine: macdVals?.line,
      higherTfUp: longTerm?.aboveEma200 ?? null,
      fromAthPct: outlook?.fromCycleHighPct ?? null,
    })

    // Volume regime — is this a high-participation runner or a low-volume drift?
    const volumeRegime = assetClass === 'stock' ? null : computeVolumeRegime(bars)

    return {
      price: lastPrice,
      ema200,
      ema50,
      slopePct,
      regime,
      volumeRegime,
      barCount: closes.length,
      rsi: rsi14,
      stochRsi: stoch,
      atr: atr14,
      atrPct: (atr14 && lastPrice) ? (atr14 / lastPrice) * 100 : null,
      macd: macdVals,
      bb,
      volume1hUsd: vol1h.usd,
      volume1hEstimated: vol1h.estimated,
      supply,
      demand,
      sr,
      majorResistance,
      majorSupport,
      longTerm,
      outlook,
    }
  }, [bars, majorBars, weeklyBars, resolution, keyLevels?.resistance, keyLevels?.support, assetClass, volUnit])

  return {
    indicators: computed,
    bars,
    majorBars,
    resolution,
    loading,
    error,
    asOf,
    isSeed,
  }
}
