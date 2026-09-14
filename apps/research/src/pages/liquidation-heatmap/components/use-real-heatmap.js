import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getExternalLiqHeatmap,
  getExternalExchangeList,
  getLiqPrints,
} from '@/pages/traders-corner/tradersCornerApi'

// 🪤 `klineLimit` MUST equal `hours / klineInterval` — the candles and the heat
// are two independent fetches drawn into the same pane, and the heat model only
// ever covers `hours`. Every row used to request a flat 500 bars, so on 3D the
// overlay carried 500 x 30m = 250 HOURS of candles against 72 hours of heat (a
// 3.5x mismatch) and the two could not line up at any zoom: the heat ran out
// partway across while candles continued to the right edge. The comment here
// already stated the intent ("144 visible on 12H, 288 on 1D") — only the value
// was wrong. 5m overlay candles on the short TFs match CoinGlass density (15m
// gave a sparse 48/96).
const ALL_TIMEFRAMES = [
  { key: '12h', label: '12H', api: '12h', klineInterval: '5m',  klineLimit: 144, hours: 12 },
  { key: '1d',  label: '1D',  api: '1d',  klineInterval: '5m',  klineLimit: 288, hours: 24 },
  { key: '3d',  label: '3D',  api: '3d',  klineInterval: '30m', klineLimit: 144, hours: 72 },
  { key: '1w',  label: '1W',  api: '1w',  klineInterval: '1h',  klineLimit: 168, hours: 168 },
  { key: '2w',  label: '2W',  api: '2w',  klineInterval: '2h',  klineLimit: 168, hours: 336 },
  { key: '1M',  label: '1M',  api: '1M',  klineInterval: '4h',  klineLimit: 180, hours: 720 },
  { key: '3M',  label: '3M',  api: '3M',  klineInterval: '12h', klineLimit: 180, hours: 2160 },
  { key: '6M',  label: '6M',  api: '6M',  klineInterval: '1d',  klineLimit: 180, hours: 4320 },
  { key: '1y',  label: '1Y',  api: '1y',  klineInterval: '1d',  klineLimit: 365, hours: 8760 },
]

const SHORT_KEYS = new Set(['12h', '1d', '3d', '1w', '2w', '1M'])
const MAJOR_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT'])

/**
 * Hook for fetching real liquidation heatmap data.
 * Reuses tradersCornerApi functions (cached + deduped).
 * Only fetches when `enabled` is true (heatmap tab active).
 */
export default function useRealHeatmap(symbol, defaultExchange = 'All', enabled = true) {
  const [heatmapData, setHeatmapData] = useState(null)
  const [klineData, setKlineData] = useState(null)
  const [printsData, setPrintsData] = useState(null)
  const [exchange, setExchange] = useState(defaultExchange)
  // Initialize `loading: true` when enabled. Otherwise the first render after
  // mount returns `loading=false, heatmapData=null`, which HeatmapView treats
  // as "neither loading nor data" → blank empty box for one tick before the
  // fetch effect flips the flag and the shimmer appears. Starting truthy keeps
  // the shimmer up from the very first render.
  const [loading, setLoading] = useState(!!enabled)
  const [error, setError] = useState(null)
  const [timeframe, setTimeframe] = useState('3d')
  // Single-tier view of the leverage ladder (10/25/50/100); null = full model.
  const [leverage, setLeverage] = useState(null)

  const isMajor = MAJOR_SYMBOLS.has(symbol)
  const TIMEFRAMES = useMemo(() =>
    isMajor ? ALL_TIMEFRAMES : ALL_TIMEFRAMES.filter(t => SHORT_KEYS.has(t.key)),
    [isMajor]
  )

  // Clamp timeframe when switching to a non-major token
  useEffect(() => {
    if (!isMajor && !SHORT_KEYS.has(timeframe)) {
      setTimeframe('1M')
    }
  }, [isMajor, timeframe])

  const fetchData = useCallback(async (isCancelled = () => false) => {
    if (!symbol || !enabled) return
    // Skip fetch if timeframe is being clamped
    if (!isMajor && !SHORT_KEYS.has(timeframe)) return
    setLoading(true)
    setError(null)

    try {
      const tf = TIMEFRAMES.find(t => t.key === timeframe)
      if (!tf) { setLoading(false); return }
      const apiTf = tf.api
      const modelExchange = exchange === 'OKX' ? 'All' : exchange

      const hm = await getExternalLiqHeatmap(modelExchange, symbol, apiTf, leverage)

      if (!isCancelled()) {
        setHeatmapData(hm)
        setLoading(false)
      }
    } catch (err) {
      console.error('[useRealHeatmap] fetch error:', err.message)
      if (!isCancelled()) {
        setError(err.message)
        setLoading(false)
      }
    }
  }, [symbol, exchange, timeframe, leverage, enabled, isMajor, TIMEFRAMES])

  // Candles + the liquidation tape are OVERLAYS, and neither one depends on the
  // exchange selector: the klines are hardcoded to Binance and the tape is
  // per-asset (the exchange filter is applied client-side, in the draw). They
  // used to ride the same Promise.all as the model, so flipping All/Binance/
  // Bybit re-pulled up to 365 candles plus the tape for nothing. Split out, they
  // only refetch when the symbol or timeframe actually changes.
  //
  // They also stay fail-soft: a cold kline/prints fetch blowing its timeout must
  // not discard a good heatmap response (that left the OLD timeframe's chart on
  // screen under the NEW timeframe's label), which is why `loading` tracks the
  // model alone.
  const fetchOverlays = useCallback(async (isCancelled = () => false) => {
    if (!symbol || !enabled) return
    if (!isMajor && !SHORT_KEYS.has(timeframe)) return
    const tf = TIMEFRAMES.find(t => t.key === timeframe)
    if (!tf) return
    const printsHours = Math.min(tf.hours || 72, 168)
    const [kl, pr] = await Promise.all([
      getExternalExchangeList('Binance', symbol, tf.klineInterval || '30m', tf.klineLimit || 500).catch(() => null),
      getLiqPrints(symbol, printsHours).catch(() => null),
    ])
    if (isCancelled()) return
    if (kl) setKlineData(kl)
    setPrintsData(pr)
  }, [symbol, timeframe, enabled, isMajor, TIMEFRAMES])

  useEffect(() => {
    // Cancel flag lives in the effect body (not returned from the async fn) so a
    // rapid symbol/timeframe switch cancels the in-flight fetch synchronously -
    // the old code assigned cleanup only AFTER the await, so it was undefined
    // when React re-ran the effect and never cancelled the stale response.
    let cancelled = false
    fetchData(() => cancelled)
    return () => { cancelled = true }
  }, [fetchData])

  useEffect(() => {
    let cancelled = false
    fetchOverlays(() => cancelled)
    return () => { cancelled = true }
  }, [fetchOverlays])

  const retry = useCallback(() => {
    fetchData()
    fetchOverlays()
  }, [fetchData, fetchOverlays])

  return {
    heatmapData,
    klineData,
    printsData,
    exchange,
    setExchange,
    loading,
    error,
    timeframe,
    setTimeframe,
    leverage,
    setLeverage,
    retry,
    TIMEFRAMES,
  }
}

export { ALL_TIMEFRAMES as TIMEFRAMES }
