import { useEffect, useMemo, useRef, useState } from 'react'
import { coinGeckoPricesStore } from '@/services/prices/sharedCoinGeckoPrices'

/**
 * Hook for fetching CoinGecko prices for a curated symbol list.
 *
 * Backed by the shared CoinGecko polling store: subscribers with overlapping
 * symbols (welcome page TOP_COINS, the token ticker, AI market analysis page)
 * share one fetch per tick. LocalStorage-seeded instant paint is preserved
 * inside the store itself.
 */
export function useCuratedTokenPrices(symbols, refreshInterval = 60_000) {
  const symbolsKey = useMemo(() => {
    if (!symbols || symbols.length === 0) return ''
    return [...symbols].sort().join(',')
  }, [symbols])

  const [prices, setPrices] = useState(() => {
    if (!symbols || symbols.length === 0) return {}
    return pickKeys(coinGeckoPricesStore.getCached(), symbols)
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const wantedRef = useRef(new Set())

  useEffect(() => {
    if (!symbolsKey) {
      setPrices({})
      setLoading(false)
      return undefined
    }
    const ourSymbols = symbolsKey.split(',')
    wantedRef.current = new Set(ourSymbols)

    const handler = (allPrices) => {
      const next = pickKeys(allPrices, wantedRef.current)
      setPrices((prev) => (samePrices(prev, next) ? prev : next))
      if (Object.keys(next).length > 0) {
        setLoading(false)
        setError(null)
      }
    }

    return coinGeckoPricesStore.subscribe(ourSymbols, refreshInterval, handler)
  }, [symbolsKey, refreshInterval])

  const refresh = () => {}
  return { prices, loading, error, refresh }
}

function pickKeys(map, keys) {
  if (!map) return {}
  const out = {}
  for (const k of keys) {
    if (map[k] !== undefined) out[k] = map[k]
  }
  return out
}

function samePrices(prev, next) {
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return false
  for (const k of nextKeys) {
    const a = prev[k]
    const b = next[k]
    if (!a || a.price !== b.price || a.change !== b.change || (a.marketCap ?? 0) !== (b.marketCap ?? 0)) return false
  }
  return true
}
