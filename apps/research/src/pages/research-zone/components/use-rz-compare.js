import { useCallback, useEffect, useState } from 'react'
import { getCompareToken, setCompareToken } from '@/services/rzLocalStorage'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'

const PERIOD_DAYS = [7, 30, 90]
const FETCH_DAYS = 90
const SERIES_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Module-level caches: avoid refetching base when only compare changes
// (and vice-versa). CoinGecko rate-queues requests serially on the server,
// so duplicate refetches under rapid token swaps cause 429s / timeouts.
const _seriesCache = new Map() // cgId -> { ts, prices }
const _seriesInflight = new Map() // cgId -> Promise<prices>

function pickPriceAt(prices, targetTs) {
  if (!Array.isArray(prices) || prices.length === 0) return null
  let best = prices[0]
  let bestDiff = Math.abs(prices[0][0] - targetTs)
  for (let i = 1; i < prices.length; i++) {
    const d = Math.abs(prices[i][0] - targetTs)
    if (d < bestDiff) { best = prices[i]; bestDiff = d }
  }
  return best?.[1] ?? null
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return r.json()
      lastErr = new Error(`status ${r.status}`)
      // 429 (rate limit) and 5xx are transient — back off and retry
      if ((r.status === 429 || r.status >= 500) && i < attempts - 1) {
        const delay = 800 * Math.pow(2, i) + Math.random() * 300
        await new Promise(res => setTimeout(res, delay))
        continue
      }
      throw lastErr
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        const delay = 800 * Math.pow(2, i) + Math.random() * 300
        await new Promise(res => setTimeout(res, delay))
        continue
      }
    }
  }
  throw lastErr || new Error('fetch failed')
}

// Use the cg-proxy rewrite — it exists in both dev (Express) and prod
// (vercel.json `/api/coingecko/:cgpath(.*)`). The previous attempt at
// `/api/rz/compare-chart` exists only in Express, so in prod every call
// burned ~5.5s on three exponential retries before falling back to this URL.
async function loadMarketChart(cgId) {
  return await fetchWithRetry(`/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${FETCH_DAYS}`)
}

function fetchMarketChart(cgId) {
  if (!cgId) return Promise.reject(new Error('missing cgId'))
  const cached = _seriesCache.get(cgId)
  if (cached && Date.now() - cached.ts < SERIES_TTL_MS) {
    return Promise.resolve(cached.prices)
  }
  if (_seriesInflight.has(cgId)) return _seriesInflight.get(cgId)
  const promise = loadMarketChart(cgId)
    .then(json => {
      const prices = Array.isArray(json?.prices) ? json.prices : []
      _seriesCache.set(cgId, { ts: Date.now(), prices })
      _seriesInflight.delete(cgId)
      return prices
    })
    .catch(err => {
      _seriesInflight.delete(cgId)
      // Fall back to stale cache if we have it — better than showing the error
      const stale = _seriesCache.get(cgId)
      if (stale) return stale.prices
      throw err
    })
  _seriesInflight.set(cgId, promise)
  return promise
}

function normalizeSeries(prices) {
  if (!Array.isArray(prices) || prices.length === 0) return []
  const first = prices[0][1]
  if (!Number.isFinite(first) || first <= 0) return []
  return prices.map(([t, p]) => [t, ((p - first) / first) * 100])
}

function computeReturns(prices) {
  if (!Array.isArray(prices) || prices.length === 0) return {}
  const last = prices[prices.length - 1][1]
  if (!Number.isFinite(last)) return {}
  const now = prices[prices.length - 1][0]
  const out = {}
  for (const days of PERIOD_DAYS) {
    const ts = now - days * 24 * 60 * 60 * 1000
    const p = pickPriceAt(prices, ts)
    if (Number.isFinite(p) && p > 0) {
      out[days] = ((last - p) / p) * 100
    }
  }
  return out
}

/**
 * Compare hook: keeps compare symbol in localStorage, fetches normalized
 * % return series for both base and compare tokens.
 */
export default function useRzCompare({ baseSymbol, baseCgId }) {
  const [compareToken, setCompareTokenState] = useState(() => getCompareToken())
  const [baseData, setBaseData] = useState(null)
  const [compareData, setCompareData] = useState(null)
  // Track loading/error per side. Sharing a single `loading` flag between
  // both effects let whichever finished last clobber the other's state
  // (spinner disappearing while compare was still loading, etc.).
  const [baseLoading, setBaseLoading] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const [baseError, setBaseError] = useState(null)
  const [compareError, setCompareError] = useState(null)
  const loading = baseLoading || compareLoading
  const error = baseError || compareError

  const compareSym = compareToken?.symbol || null
  const compareCgId = compareToken?.cgId
    || (compareSym ? (SYMBOL_TO_COINGECKO_ID[compareSym] || null) : null)

  // Reset when comparing self
  useEffect(() => {
    if (compareSym && baseSymbol && compareSym.toUpperCase() === baseSymbol.toUpperCase()) {
      setCompareTokenState(null)
      setCompareToken(null)
    }
  }, [compareSym, baseSymbol])

  // Fetch base series when baseCgId changes (independent of compare)
  useEffect(() => {
    if (!compareSym || !baseCgId) {
      setBaseData(null)
      setBaseLoading(false)
      setBaseError(null)
      return
    }
    let cancelled = false
    setBaseLoading(true)
    setBaseError(null)
    fetchMarketChart(baseCgId)
      .then(prices => {
        if (cancelled) return
        setBaseData({
          normalized: normalizeSeries(prices),
          returns: computeReturns(prices),
        })
      })
      .catch(err => {
        if (cancelled) return
        setBaseError(err.message || 'Failed to load compare data')
        setBaseData(null)
      })
      .finally(() => { if (!cancelled) setBaseLoading(false) })
    return () => { cancelled = true }
  }, [compareSym, baseCgId])

  // Fetch compare series when compareCgId changes (independent of base)
  useEffect(() => {
    if (!compareSym || !compareCgId) {
      setCompareData(null)
      setCompareLoading(false)
      setCompareError(null)
      return
    }
    let cancelled = false
    setCompareLoading(true)
    setCompareError(null)
    fetchMarketChart(compareCgId)
      .then(prices => {
        if (cancelled) return
        setCompareData({
          normalized: normalizeSeries(prices),
          returns: computeReturns(prices),
        })
      })
      .catch(err => {
        if (cancelled) return
        setCompareError(err.message || 'Failed to load compare data')
        setCompareData(null)
      })
      .finally(() => { if (!cancelled) setCompareLoading(false) })
    return () => { cancelled = true }
  }, [compareSym, compareCgId])

  const setCompare = useCallback((token) => {
    if (!token) {
      setCompareTokenState(null)
      setCompareToken(null)
      return
    }
    // Accept either a string (back-compat) or a full token object
    const next = typeof token === 'string'
      ? { symbol: token.toUpperCase(), cgId: SYMBOL_TO_COINGECKO_ID[token.toUpperCase()] || null, name: null, logo: null }
      : {
          symbol: String(token.symbol || '').toUpperCase(),
          cgId: token.cgId || token.id || SYMBOL_TO_COINGECKO_ID[String(token.symbol || '').toUpperCase()] || null,
          name: token.name || null,
          logo: token.logo || null,
        }
    if (!next.symbol) return
    setCompareTokenState(next)
    setCompareToken(next)
  }, [])

  const clearCompare = useCallback(() => {
    setCompareTokenState(null)
    setCompareToken(null)
    setBaseData(null)
    setCompareData(null)
  }, [])

  return {
    compareSym,
    compareToken,
    setCompare,
    clearCompare,
    baseData,
    compareData,
    loading,
    error,
    periods: PERIOD_DAYS,
  }
}
