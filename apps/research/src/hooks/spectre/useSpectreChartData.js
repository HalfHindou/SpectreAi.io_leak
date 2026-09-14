/**
 * useSpectreChartData — PARALLEL to `useChartData` (Codex), built for audit.
 *
 * Goal: prove parity (or document deltas) before any swap. This hook fetches
 * OHLCV bars from Spectre `/v1/candles/{asset}` and normalizes to the same
 * `{ time, open, high, low, close, volume }` shape `useChartData` returns.
 *
 * Probe results 2026-05-15:
 *   - Majors (BTC, ETH, SOL, ...) → `source: candles_1m`. Binance-quality OHLCV.
 *   - DEX/long-tail (SPECTRE, PEPE, ...) → `source: price_history_daily`.
 *     Daily granularity even when 1h is requested. All bars are flat
 *     (o=h=l=c). NOT a Codex replacement for DEX tokens.
 *
 * Returns the same surface as useChartData so the audit page can drop both
 * into a side-by-side comparator. Does NOT replace useChartData anywhere.
 */
import { useState, useEffect, useCallback, useRef } from 'react'

const DATA_API = '/data-api'

const RESOLUTION_TO_INTERVAL = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '240': '4h',
  '1D': '1d',
  'D': '1d',
  '1W': '1w',
  'W': '1w',
}

const INTERVAL_TO_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
}

function normalizeBar(raw, intervalSec) {
  if (!raw || typeof raw !== 'object') return null
  const ts = raw.time || raw.t || raw.timestamp
  const timeMs = typeof ts === 'string' ? Date.parse(ts) : Number(ts)
  if (!Number.isFinite(timeMs) || timeMs <= 0) return null

  const open = parseFloat(raw.open ?? raw.o)
  const high = parseFloat(raw.high ?? raw.h)
  const low = parseFloat(raw.low ?? raw.l)
  const close = parseFloat(raw.close ?? raw.c)
  const volume = parseFloat(raw.volume ?? raw.v ?? 0)
  if (![open, high, low, close].every(Number.isFinite)) return null

  return { time: timeMs, open, high, low, close, volume }
}

function computeFlatRatio(bars) {
  if (!bars || bars.length === 0) return 0
  let flat = 0
  for (const b of bars) {
    if (b.high === b.low && b.open === b.close && b.close > 0) flat++
  }
  return flat / bars.length
}

export function useSpectreChartData(symbol, resolution = '60', periodHours = 168) {
  const [bars, setBars] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [meta, setMeta] = useState(null) // { source, queryTimeMs, count, from, to }
  const activeSymbolRef = useRef(symbol)
  activeSymbolRef.current = symbol

  const fetchBars = useCallback(async () => {
    if (!symbol) { setLoading(false); return }
    const interval = RESOLUTION_TO_INTERVAL[resolution] || '1h'
    const intervalSec = INTERVAL_TO_SECONDS[interval] || 3600
    const limit = Math.min(1000, Math.max(50, Math.ceil((periodHours * 3600) / intervalSec)))

    setLoading(true)
    const t0 = performance.now()
    try {
      const url = `${DATA_API}/v1/candles/${encodeURIComponent(symbol.toUpperCase())}?interval=${interval}&limit=${limit}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`Spectre candles HTTP ${res.status}`)
      const payload = await res.json()
      if (activeSymbolRef.current !== symbol) return
      const raw = Array.isArray(payload?.data) ? payload.data : []
      const normalized = raw.map(b => normalizeBar(b, intervalSec)).filter(Boolean)
      setBars(normalized)
      setMeta({
        ...(payload?.meta || {}),
        clientLatencyMs: Math.round(performance.now() - t0),
        flatRatio: computeFlatRatio(normalized),
      })
      setError(null)
    } catch (err) {
      if (activeSymbolRef.current !== symbol) return
      setError(err?.message || 'fetch failed')
      setBars([])
      setMeta({ clientLatencyMs: Math.round(performance.now() - t0), error: err?.message })
    } finally {
      if (activeSymbolRef.current === symbol) setLoading(false)
    }
  }, [symbol, resolution, periodHours])

  useEffect(() => { fetchBars() }, [fetchBars])

  return { bars, loading, error, meta, refresh: fetchBars }
}
