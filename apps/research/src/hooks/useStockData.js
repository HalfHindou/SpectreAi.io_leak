/**
 * Stock Data Hooks
 * React hooks for fetching and managing stock market data
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import {
  getStockQuotes,
  getStockQuote,
  searchStocks,
  getStockCandles,
  getMarketMovers,
  getMarketStatus,
  getMarketIndices,
} from '@/services/stockApi'

/**
 * Hook for fetching real-time stock prices
 * @param {string[]} symbols - Array of stock symbols
 * @param {number} refreshInterval - Refresh interval in ms (default 10s)
 */
export function useStockPrices(symbols, refreshInterval = 10000) {
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Stable key for dependency tracking
  const symbolsKey = Array.isArray(symbols) && symbols.length > 0 ? symbols.join(',') : ''

  const fetchPrices = useCallback(async () => {
    if (!symbolsKey) {
      setLoading(false)
      return
    }

    try {
      const syms = symbolsKey.split(',')
      const data = await getStockQuotes(syms)
      if (data && Object.keys(data).length > 0) {
        setPrices(prev => ({ ...prev, ...data }))
        setError(null)
      }
    } catch (err) {
      // silently handled
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [symbolsKey])

  useEffect(() => {
    fetchPrices()
  }, [fetchPrices])

  // Poll for price updates with adaptive intervals
  useAdaptivePolling(fetchPrices, { interval: refreshInterval, enabled: !!symbolsKey })

  return { prices, loading, error, refresh: fetchPrices }
}

/**
 * Hook for searching stocks
 * @param {string} query - Search query
 * @param {number} debounceMs - Debounce delay in ms
 */
export function useStockSearch(query, debounceMs = 300) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (!query || query.length < 1) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    // Debounce
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Stale-response guard: a slow searchStocks for a PREVIOUS query can
    // resolve after the current one and overwrite fresh results (last-write-
    // wins race). The cleanup flips `cancelled` on every query change so only
    // the latest request may commit state.
    let cancelled = false
    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchStocks(query)
        if (cancelled) return
        setResults(data)
        setError(null)
      } catch (err) {
        if (cancelled) return
        // silently handled
        setError(err.message)
        setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, debounceMs)

    return () => {
      cancelled = true
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [query, debounceMs])

  return { results, loading, error }
}

/**
 * Hook for stock chart data (OHLC)
 * @param {string} symbol - Stock symbol
 * @param {string} resolution - Timeframe
 * @param {number} periodHours - How many hours of data to fetch
 */
export function useStockChartData(symbol, resolution = '1h', periodHours = 168) {
  const [bars, setBars] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchBars = useCallback(async () => {
    if (!symbol) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const to = Math.floor(Date.now() / 1000)
      const from = to - (periodHours * 60 * 60)

      const data = await getStockCandles(symbol, resolution, from, to)

      if (data?.getBars && data.getBars.length > 0) {
        const formattedBars = data.getBars.map(bar => ({
          time: bar.t * 1000,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        }))
        setBars(formattedBars)
        setError(null)
      } else {
        setBars([])
      }
    } catch (err) {
      // silently handled
      setError(err.message)
      setBars([])
    } finally {
      setLoading(false)
    }
  }, [symbol, resolution, periodHours])

  useEffect(() => {
    fetchBars()
  }, [fetchBars])

  return { bars, loading, error, refresh: fetchBars }
}

/**
 * Hook for market movers (top gainers/losers)
 * @param {number} refreshInterval - Refresh interval in ms
 */
export function useStockTrending(refreshInterval = 60000) {
  const [gainers, setGainers] = useState([])
  const [losers, setLosers] = useState([])
  const [mostActive, setMostActive] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchMovers = useCallback(async () => {
    try {
      const data = await getMarketMovers()
      setGainers(data.gainers || [])
      setLosers(data.losers || [])
      setMostActive(data.mostActive || [])
      setError(null)
    } catch (err) {
      // silently handled
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!refreshInterval) {
      setLoading(false)
      return
    }
    fetchMovers()
  }, [fetchMovers, refreshInterval])

  // Poll for market movers with adaptive intervals
  useAdaptivePolling(fetchMovers, { interval: refreshInterval, enabled: !!refreshInterval })

  return { gainers, losers, mostActive, loading, error, refresh: fetchMovers }
}

/**
 * Hook for market status (open/closed)
 * Updates every minute
 */
export function useMarketStatus(refreshInterval = 60000) {
  const [status, setStatus] = useState(() => getMarketStatus())

  const updateStatus = useCallback(() => setStatus(getMarketStatus()), [])

  useEffect(() => {
    updateStatus()
  }, [updateStatus])

  // Poll market status with adaptive intervals
  useAdaptivePolling(updateStatus, { interval: refreshInterval })

  return status
}

/**
 * Hook for market indices (S&P 500, Dow, Nasdaq, etc.)
 */
export function useMarketIndices(refreshInterval = 30000) {
  const [indices, setIndices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchIndices = useCallback(async () => {
    try {
      const data = await getMarketIndices()
      setIndices(data)
      setError(null)
    } catch (err) {
      // silently handled
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!refreshInterval) {
      setLoading(false)
      return
    }
    fetchIndices()
  }, [fetchIndices, refreshInterval])

  // Poll for market indices with adaptive intervals
  useAdaptivePolling(fetchIndices, { interval: refreshInterval, enabled: !!refreshInterval })

  return { indices, loading, error, refresh: fetchIndices }
}

/**
 * Hook for single stock details
 */
export function useStockDetails(symbol, refreshInterval = 30000) {
  const [stock, setStock] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchDetails = useCallback(async () => {
    if (!symbol) {
      setLoading(false)
      return
    }

    try {
      const data = await getStockQuote(symbol)
      setStock(data)
      setError(null)
    } catch (err) {
      // silently handled
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    fetchDetails()
  }, [fetchDetails])

  // Poll for stock details with adaptive intervals
  useAdaptivePolling(fetchDetails, { interval: refreshInterval })

  return { stock, loading, error, refresh: fetchDetails }
}

export default {
  useStockPrices,
  useStockSearch,
  useStockChartData,
  useStockTrending,
  useMarketStatus,
  useMarketIndices,
  useStockDetails,
}
