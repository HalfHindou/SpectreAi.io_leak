/**
 * useSpectreLiveChart — bars + live last-bar tick.
 *
 * Combines:
 *   useSpectreChartData     (historical OHLCV via /v1/candles)
 *   useSpectrePriceStream   (live SSE ticks via /v1/stream/prices/sse)
 *
 * On every SSE tick, mutates the running last bar (or appends a fresh bar
 * if the tick crossed into a new resolution bucket). Same logic the
 * TradingView Codex stream uses, but driven by Spectre SSE instead.
 *
 * Replaces (for audit) the 15s `getBars` polling loop in TradingViewAdvanced.
 * One SSE connection per symbol-set fans out to every chart on the page.
 *
 * Audit-mode: parallel hook, not wired into any chart. Used by the audit
 * page's mini-chart to prove live ticks match Codex/Binance.
 */
import { useMemo, useState, useEffect } from 'react'
import { useSpectreChartData } from './useSpectreChartData'
import { useSpectrePriceStream } from './useSpectrePriceStream'

const RESOLUTION_TO_SECONDS = {
  '1': 60,
  '5': 300,
  '15': 900,
  '30': 1800,
  '60': 3600,
  '240': 14400,
  '1D': 86400,
  'D': 86400,
  '1W': 604800,
  'W': 604800,
}

export function useSpectreLiveChart(symbol, resolution = '60', periodHours = 168) {
  const { bars: initialBars, loading, error, meta } = useSpectreChartData(symbol, resolution, periodHours)
  const symKey = symbol ? [symbol.toUpperCase()] : []
  const { prices, connected } = useSpectrePriceStream(symKey)

  const [liveBars, setLiveBars] = useState([])
  const [tickCount, setTickCount] = useState(0)
  const [lastTickAt, setLastTickAt] = useState(null)

  // Seed liveBars from the initial historical fetch.
  useEffect(() => {
    if (initialBars && initialBars.length > 0) {
      setLiveBars(initialBars)
    }
  }, [initialBars])

  // Apply SSE ticks to the running last bar.
  useEffect(() => {
    const tick = prices[symbol?.toUpperCase()]
    if (!tick || !Number.isFinite(tick.price) || tick.price <= 0) return
    const resSec = RESOLUTION_TO_SECONDS[resolution] || 3600
    const bucketMs = Math.floor(Date.now() / 1000 / resSec) * resSec * 1000

    setLiveBars(prev => {
      if (!prev || prev.length === 0) return prev
      const last = prev[prev.length - 1]
      if (!last) return prev

      // Outlier guard — reject ticks more than 10x off the last close.
      const lastClose = last.close > 0 ? last.close : null
      if (lastClose) {
        const ratio = tick.price > lastClose ? tick.price / lastClose : lastClose / tick.price
        if (ratio > 10) return prev
      }

      if (bucketMs === last.time) {
        // Same bucket — mutate high/low/close
        const updated = {
          ...last,
          high: Math.max(last.high, tick.price),
          low: Math.min(last.low, tick.price),
          close: tick.price,
        }
        return [...prev.slice(0, -1), updated]
      }
      if (bucketMs > last.time) {
        // New bucket — append a seeded bar
        const fresh = { time: bucketMs, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: 0 }
        return [...prev, fresh]
      }
      return prev // stale tick
    })
    setTickCount(c => c + 1)
    setLastTickAt(Date.now())
  }, [prices, symbol, resolution])

  const last = useMemo(() => liveBars[liveBars.length - 1] || null, [liveBars])

  return {
    bars: liveBars,
    last,
    loading,
    error,
    meta: { ...meta, sseConnected: connected, tickCount, lastTickAt },
  }
}
