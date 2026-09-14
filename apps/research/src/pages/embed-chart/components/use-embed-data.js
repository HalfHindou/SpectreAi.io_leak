/**
 * useEmbedData
 * Line: CoinGecko market_chart (prices) - fast path, 1D shown instantly while
 *   90D hourly warms in parallel for 7D/1M/3M slicing.
 * Candles: Codex getBars FIRST via /api/bars, CoinGecko /ohlc fallback.
 *   Codex has denser, higher-fidelity OHLCV and volume; CG only returns 4/12/24h buckets.
 *
 * Returns:
 *   { lineSeries, candleSeries, loading, error, refetch }
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getSpectreTokenChart } from '@/services/spectreMarketApi'

const CG = '/api/coingecko'
const COINGECKO_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COINGECKO_ID).map(([symbol, id]) => [id, symbol])
)

// Day window per timeframe
export const TIMEFRAMES = {
  '1D': { days: 1,   ohlcDays: 1,   codexRes: '15'  }, // 15m
  '7D': { days: 7,   ohlcDays: 7,   codexRes: '60'  }, // 1h
  '1M': { days: 30,  ohlcDays: 30,  codexRes: '240' }, // 4h
  '3M': { days: 90,  ohlcDays: 90,  codexRes: '720' }, // 12h
  '1Y': { days: 365, ohlcDays: 365, codexRes: '1D'  }, // 1d
}

async function fetchJSON(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function symbolForCgId(cgId) {
  const key = String(cgId || '').toLowerCase()
  return COINGECKO_ID_TO_SYMBOL[key] || null
}

// Codex returns t in seconds. Normalize to ms so both sources share the same
// downstream shape and axis math.
function normalizeCodexBars(bars) {
  if (!Array.isArray(bars)) return []
  return bars
    .filter(b => b && Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .map(b => ({
      t: b.t < 1e11 ? b.t * 1000 : b.t,
      o: b.o, h: b.h, l: b.l, c: b.c,
      v: Number.isFinite(b.v) ? b.v : 0,
    }))
    .sort((a, b) => a.t - b.t)
}

function normalizeSpectreRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      const ts = row.time || row.date || row.timestamp || row.t
      const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
      const c = Number(row.close ?? row.price ?? row.c ?? row.value)
      return {
        t: t < 1e11 ? t * 1000 : t,
        o: Number(row.open ?? row.o ?? c),
        h: Number(row.high ?? row.h ?? c),
        l: Number(row.low ?? row.l ?? c),
        c,
        v: Number(row.volume ?? row.v ?? 0),
      }
    })
    .filter((bar) => Number.isFinite(bar.t) && Number.isFinite(bar.c))
}

export function useEmbedData(cgId, timeframe, chartType, codex = {}) {
  const { address: codexAddress, networkId: codexNetwork } = codex
  const [lineSeries, setLineSeries] = useState([])
  const [candleSeries, setCandleSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // In-memory caches keyed by days (line) or `${tf}:${source}` (candle)
  const lineCache = useRef(new Map())
  const candleCache = useRef(new Map())

  const abortRef = useRef(null)

  const loadLine = useCallback(async (days, signal) => {
    if (lineCache.current.has(days)) return lineCache.current.get(days)

    try {
      const url = `${CG}/coins/${cgId}/market_chart?vs_currency=usd&days=${days}`
      const data = await fetchJSON(url, signal)
      const series = (data?.prices || [])
        .map(([t, v]) => ({ t, v }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
      if (series.length) {
        lineCache.current.set(days, series)
        return series
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }

    const asset = symbolForCgId(cgId)
    if (asset) {
      const interval = days > 90 ? '1d' : days > 30 ? '4h' : days > 7 ? '1h' : '15m'
      const rows = await getSpectreTokenChart(asset, { interval, limit: Math.min(1000, Math.max(96, days * 24)) }).catch(() => [])
      const series = normalizeSpectreRows(rows).map((bar) => ({ t: bar.t, v: bar.c }))
      if (series.length) {
        lineCache.current.set(days, series)
        return series
      }
    }

    return []
  }, [cgId])

  const loadCandlesCodex = useCallback(async (tf, signal) => {
    const key = `${tf}:codex`
    if (candleCache.current.has(key)) return candleCache.current.get(key)
    if (!codexAddress || !codexNetwork) return null
    const { days, codexRes } = TIMEFRAMES[tf] || TIMEFRAMES['1D']
    const to = Math.floor(Date.now() / 1000)
    const from = to - days * 24 * 60 * 60
    const symbol = `${codexAddress}:${codexNetwork}`
    const url = `/api/bars?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&resolution=${codexRes}&networkId=${codexNetwork}`
    const data = await fetchJSON(url, signal).catch(() => null)
    if (!data) return null
    const raw = Array.isArray(data) ? data : (data.bars || [])
    const bars = normalizeCodexBars(raw)
    if (bars.length < 3) return null
    candleCache.current.set(key, bars)
    return bars
  }, [codexAddress, codexNetwork])

  const loadCandlesCG = useCallback(async (tf, signal) => {
    const key = `${tf}:cg`
    if (candleCache.current.has(key)) return candleCache.current.get(key)

    try {
      const { ohlcDays } = TIMEFRAMES[tf] || TIMEFRAMES['1D']
      const url = `${CG}/coins/${cgId}/ohlc?vs_currency=usd&days=${ohlcDays}`
      const data = await fetchJSON(url, signal)
      const series = Array.isArray(data)
        ? data.map(([t, o, h, l, c]) => ({ t, o, h, l, c, v: 0 }))
        : []
      if (series.length) {
        candleCache.current.set(key, series)
        return series
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }

    const asset = symbolForCgId(cgId)
    if (asset) {
      const { codexRes } = TIMEFRAMES[tf] || TIMEFRAMES['1D']
      const intervalMap = { '15': '15m', '60': '1h', '240': '4h', '720': '12h', '1D': '1d' }
      const rows = await getSpectreTokenChart(asset, { interval: intervalMap[codexRes] || '1h', limit: 1000 }).catch(() => [])
      const series = normalizeSpectreRows(rows)
      if (series.length) {
        candleCache.current.set(`${tf}:spectre`, series)
        return series
      }
    }

    return []
  }, [cgId])

  const loadCandles = useCallback(async (tf, signal) => {
    // Codex first; CoinGecko fallback on empty/failure.
    try {
      const codexBars = await loadCandlesCodex(tf, signal)
      if (codexBars && codexBars.length >= 3) return codexBars
    } catch (err) {
      if (err.name === 'AbortError') throw err
    }
    return loadCandlesCG(tf, signal)
  }, [loadCandlesCodex, loadCandlesCG])

  // On cgId/codex change, reset caches and warm line pipeline
  useEffect(() => {
    if (!cgId) return
    lineCache.current.clear()
    candleCache.current.clear()
    setLoading(true)
    setError(null)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    const p1 = loadLine(1, signal)
    const p90 = loadLine(90, signal)

    p1.then(series => {
      if (signal.aborted) return
      setLineSeries(prev => (timeframe === '1D' ? series : prev))
      setLoading(false)
    }).catch(err => {
      if (err.name === 'AbortError') return
      setError(err.message || 'Failed to load')
      setLoading(false)
    })

    p90.catch(() => { /* warm only */ })

    return () => { abortRef.current?.abort() }
  }, [cgId, codexAddress, codexNetwork, loadLine])

  // Paint series for active timeframe + chartType
  useEffect(() => {
    if (!cgId) return
    const { days } = TIMEFRAMES[timeframe] || TIMEFRAMES['1D']
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    let cancelled = false

    async function paint() {
      try {
        if (chartType === 'candle') {
          const cached = candleCache.current.get(`${timeframe}:codex`) || candleCache.current.get(`${timeframe}:cg`) || candleCache.current.get(`${timeframe}:spectre`)
          setLoading(!cached)
          if (cached) setCandleSeries(cached)
          const series = await loadCandles(timeframe, signal)
          if (cancelled) return
          setCandleSeries(series || [])
        } else {
          if ((days === 7 || days === 30 || days === 90) && lineCache.current.has(90)) {
            const full = lineCache.current.get(90)
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
            setLineSeries(full.filter(p => p.t >= cutoff))
          } else {
            setLoading(!lineCache.current.has(days))
            const series = await loadLine(days, signal)
            if (cancelled) return
            setLineSeries(series)
          }
        }
        setLoading(false)
        setError(null)
      } catch (err) {
        if (err.name === 'AbortError') return
        if (!cancelled) {
          setError(err.message || 'Failed to load')
          setLoading(false)
        }
      }
    }
    paint()

    return () => { cancelled = true }
  }, [cgId, timeframe, chartType, loadLine, loadCandles])

  const refetch = useCallback(() => {
    lineCache.current.clear()
    candleCache.current.clear()
    setLoading(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current
    const days = TIMEFRAMES[timeframe]?.days ?? 1
    if (chartType === 'candle') {
      loadCandles(timeframe, signal).then(s => setCandleSeries(s || [])).catch(e => setError(e.message))
    } else {
      loadLine(days, signal).then(setLineSeries).catch(e => setError(e.message))
    }
  }, [timeframe, chartType, loadLine, loadCandles])

  return { lineSeries, candleSeries, loading, error, refetch }
}
