/**
 * useChartData - Master chart data hook
 *
 * Routes to the correct data source:
 *   - Major tokens with Binance pairs -> Binance klines (clean, fast)
 *   - Other tokens -> /api/bars cascade (Binance -> Hetzner candle store ->
 *     GeckoTerminal -> Codex last-resort, with outlier filtering)
 *
 * Returns normalized OHLCV bars ready for Lightweight Charts.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchBinanceBars, fetchBinanceLatestBar } from '../adapters/binanceAdapter'
import { fetchSpectreBars } from '../adapters/codexAdapter'
import { logError } from '@/lib/logger'

// Binance symbol map for major tokens
// Server-side token-registry.js is the source of truth; this is the client mirror
const BINANCE_PAIRS = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT',
  XRP: 'XRPUSDT', ADA: 'ADAUSDT', DOGE: 'DOGEUSDT', AVAX: 'AVAXUSDT',
  DOT: 'DOTUSDT', LINK: 'LINKUSDT', MATIC: 'MATICUSDT', UNI: 'UNIUSDT',
  ATOM: 'ATOMUSDT', LTC: 'LTCUSDT', ETC: 'ETCUSDT', FIL: 'FILUSDT',
  ARB: 'ARBUSDT', OP: 'OPUSDT', NEAR: 'NEARUSDT', APT: 'APTUSDT',
  SUI: 'SUIUSDT', INJ: 'INJUSDT', TIA: 'TIAUSDT', SEI: 'SEIUSDT',
  AAVE: 'AAVEUSDT', MKR: 'MKRUSDT', CRV: 'CRVUSDT', LDO: 'LDOUSDT',
  GRT: 'GRTUSDT', RENDER: 'RENDERUSDT', RNDR: 'RENDERUSDT',
  FET: 'FETUSDT', TAO: 'TAOUSDT', ONDO: 'ONDOUSDT', JUP: 'JUPUSDT',
  PYTH: 'PYTHUSDT', PEPE: '1000PEPEUSDT', SHIB: 'SHIBUSDT',
  WIF: 'WIFUSDT', BONK: '1000BONKUSDT',
  HYPE: 'HYPEUSDT', WLD: 'WLDUSDT', JTO: 'JTOUSDT', STRK: 'STRKUSDT',
  ENA: 'ENAUSDT', PENDLE: 'PENDLEUSDT', ALGO: 'ALGOUSDT', XLM: 'XLMUSDT',
  XMR: 'XMRUSDT', HBAR: 'HBARUSDT', QNT: 'QNTUSDT', ICP: 'ICPUSDT',
  BGB: 'BGBUSDT', OKB: 'OKBUSDT', KAS: 'KASUSDT', SKY: 'SKYUSDT',
  POL: 'POLUSDT', BCH: 'BCHUSDT', TRX: 'TRXUSDT', USDC: 'USDCUSDT',
}

// Timeframe -> seconds per bar
const TF_SECONDS = {
  '1M': 60, '5M': 300, '15M': 900, '30M': 1800,
  '1H': 3600, '4H': 14400, '12H': 43200, '1D': 86400, '1W': 604800,
}

// Initial bar count - kept under 1000 so Binance returns in a single round-trip
// (no pagination = first paint in <500ms instead of waiting on 4 sequential pages).
// Deeper history streams in via TF_BAR_COUNT_FULL after the first render.
const TF_BAR_COUNT = {
  '1M': 800,    // ~13h
  '5M': 800,    // ~2.7 days
  '15M': 800,   // ~8 days
  '30M': 800,   // ~16 days
  '1H': 800,    // ~1 month
  '4H': 800,    // ~4.5 months
  '12H': 800,   // ~13 months
  '1D': 500,    // ~1.4 years
  '1W': 500,    // ~9.6 years
}

// Background extension bar count - full deep history loaded after first paint
const TF_BAR_COUNT_FULL = {
  '1M': 2000,
  '5M': 2000,
  '15M': 2000,
  '30M': 2000,
  '1H': 4000,
  '4H': 3000,
  '12H': 1500,
  '1D': 2000,
  '1W': 500,
}

function getBinanceSymbol(tokenSymbol) {
  if (!tokenSymbol) return null
  return BINANCE_PAIRS[tokenSymbol.toUpperCase()] || null
}

/**
 * @param {object} options
 * @param {object} options.token - { symbol, address?, networkId? }
 * @param {string} options.timeframe - '1M', '5M', '15M', '30M', '1H', '4H', '1D', '1W'
 * @param {boolean} options.enabled - set false to pause fetching
 * @returns {{ bars, loading, error, source, refetch }}
 */
export function useChartData({ token, timeframe = '1H', enabled = true }) {
  const [bars, setBars] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const cancelledRef = useRef(false)
  // Monotonic request id. `cancelledRef` alone is not enough: a token or
  // timeframe switch sets it true in cleanup and the next effect immediately
  // resets it to false, so a still-in-flight request from the OLD timeframe
  // wakes up, sees "not cancelled", and merges its bars into the new
  // timeframe's array. The deferred history extension is the usual culprit -
  // 1200 1M bars landed in front of a 15M window and lightweight-charts
  // threw "data must be asc ordered by time". Every request captures its
  // own id and drops its result if a newer request has started since.
  const requestIdRef = useRef(0)
  const pollIntervalRef = useRef(null)

  const symbol = token?.symbol?.toUpperCase() || ''
  const address = token?.address || null
  const networkId = token?.networkId || null
  const isStock = token?.isStock || token?.assetClass === 'stock' || false

  const fetchBars = useCallback(async () => {
    if (!symbol || !enabled) return

    const requestId = ++requestIdRef.current
    const isStale = () => cancelledRef.current || requestId !== requestIdRef.current

    const barSeconds = TF_SECONDS[timeframe] || 3600
    const barCount = TF_BAR_COUNT[timeframe] || 2000
    const now = Math.floor(Date.now() / 1000)
    const from = now - barSeconds * barCount
    const to = now

    try {
      let result = []
      let dataSource = null

      // Route 0: Stocks always go through UDF (Yahoo Finance backend)
      if (isStock) {
        try {
          result = await fetchFromUDF(symbol, timeframe, from, to)
          dataSource = 'udf'
        } catch (e) {
          console.warn(`[SpectreChart] UDF failed for stock ${symbol}:`, e.message)
        }
        if (isStale()) return
        setBars(result)
        setSource(dataSource)
        setError(result.length === 0 ? 'No data available' : null)
        setLoading(false)
        return
      }

      const binanceSym = getBinanceSymbol(symbol)

      // Route 1: Binance for major tokens
      if (binanceSym) {
        try {
          result = await fetchBinanceBars(binanceSym, timeframe, from, to)
          dataSource = 'binance'
        } catch (e) {
          console.warn(`[SpectreChart] Binance failed for ${symbol}, falling back to Codex:`, e.message)
          // Fall through to Codex
        }
      }

      // Route 2: /api/bars cascade for non-major tokens or Binance fallback.
      // Server tries Binance -> Hetzner candle store -> GeckoTerminal before
      // ever touching paid Codex; `source` reflects the tier that answered.
      if (result.length === 0 && address && networkId) {
        const spectre = await fetchSpectreBars(address, networkId, timeframe, from, to)
        result = spectre.bars
        dataSource = spectre.source || 'spectre'
      }

      // Route 3: UDF fallback for symbol-only tokens
      if (result.length === 0 && !address) {
        try {
          const udfBars = await fetchFromUDF(symbol, timeframe, from, to)
          if (udfBars.length > 0) {
            result = udfBars
            dataSource = 'udf'
          }
        } catch (e) {
          console.warn(`[SpectreChart] UDF fallback failed for ${symbol}:`, e.message)
        }
      }

      if (isStale()) return

      // Deduplicate by timestamp (can happen with overlapping fetches)
      const seen = new Set()
      const deduped = result.filter(b => {
        if (seen.has(b.time)) return false
        seen.add(b.time)
        return true
      })

      setBars(deduped)
      setSource(dataSource)
      setError(deduped.length === 0 ? 'No data available' : null)

      // Background: extend history to TF_BAR_COUNT_FULL once the first paint
      // is on screen. Only for Binance pairs - Codex/UDF already return all
      // bars they have in one shot.
      const fullCount = TF_BAR_COUNT_FULL[timeframe] || barCount
      if (
        dataSource === 'binance' &&
        deduped.length > 0 &&
        fullCount > barCount &&
        !isStale()
      ) {
        const oldestTime = deduped[0].time
        const fullFrom = now - barSeconds * fullCount
        if (fullFrom < oldestTime) {
          const binanceSym = getBinanceSymbol(symbol)
          if (binanceSym) {
            // Defer to idle - first paint takes priority
            const runExtend = () => {
              if (isStale()) return
              fetchBinanceBars(binanceSym, timeframe, fullFrom, oldestTime - 1)
                .then(olderBars => {
                  if (isStale() || !olderBars?.length) return
                  setBars(prev => {
                    // Only prepend bars that are strictly older than what is
                    // on screen - the series must stay ascending no matter
                    // what the extension window returned.
                    const head = prev[0]?.time ?? Infinity
                    const older = olderBars.filter(b => b.time < head)
                    if (older.length === 0) return prev
                    return [...older, ...prev]
                  })
                })
                .catch(() => { /* extension failure is non-critical */ })
            }
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
              window.requestIdleCallback(runExtend, { timeout: 2000 })
            } else {
              setTimeout(runExtend, 200)
            }
          }
        }
      }
    } catch (e) {
      if (!isStale()) {
        setError(e.message)
        setBars([])
      }
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [symbol, address, networkId, timeframe, enabled, isStock])

  // Initial fetch + refetch on token/timeframe change
  useEffect(() => {
    cancelledRef.current = false
    setLoading(true)
    setError(null)
    fetchBars()

    return () => { cancelledRef.current = true }
  }, [fetchBars])

  // Polling for live updates (15s)
  useEffect(() => {
    if (!enabled || !symbol) return

    // The fetch effect above runs first on every change and bumps the id,
    // so this captures the id of the request whose bars are on screen.
    const pollRequestId = requestIdRef.current
    pollIntervalRef.current = setInterval(() => {
      if (document.hidden) return // Skip when tab is hidden

      const binanceSym = getBinanceSymbol(symbol)
      if (binanceSym) {
        fetchBinanceLatestBar(binanceSym, timeframe)
          .then(bar => {
            // Same stale trap as fetchBars: the interval is cleared on a
            // timeframe switch, but a poll already in flight still resolves.
            if (!bar || cancelledRef.current || pollRequestId !== requestIdRef.current) return
            setBars(prev => {
              if (prev.length === 0) return prev
              const last = prev[prev.length - 1]
              if (bar.time === last.time) {
                // Update existing bar
                return [...prev.slice(0, -1), bar]
              } else if (bar.time > last.time) {
                // New bar
                return [...prev, bar]
              }
              return prev
            })
          })
          .catch((err) => logError('useChartData:poll', err)) // Polling failure is non-critical, just logged in dev
      }
    }, 15_000)

    return () => clearInterval(pollIntervalRef.current)
  }, [symbol, timeframe, enabled])

  return { bars, loading, error, source, refetch: fetchBars }
}

/**
 * Fallback: fetch from the existing UDF history endpoint.
 * This handles symbol resolution for tokens without explicit address.
 */
async function fetchFromUDF(symbol, timeframe, from, to) {
  const resolutionMap = {
    '1M': '1', '5M': '5', '15M': '15', '30M': '30',
    '1H': '60', '4H': '240', '12H': '720', '1D': 'D', '1W': 'W',
  }
  const resolution = resolutionMap[timeframe] || '60'
  const url = `/api/tradingview/udf/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}`

  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!resp.ok) throw new Error(`UDF ${resp.status}`)

  const data = await resp.json()
  if (data.s !== 'ok' || !data.t || data.t.length === 0) return []

  return data.t.map((t, i) => ({
    time: t,
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v?.[i] || 0,
  })).filter(b => b.close > 0)
}

export { getBinanceSymbol, BINANCE_PAIRS }
