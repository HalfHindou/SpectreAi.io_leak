import { useEffect, useMemo, useRef, useState } from 'react'
import { binancePricesStore } from '@/services/prices/sharedBinancePrices'

/**
 * Real-time top coin prices from Binance.
 *
 * Backed by the shared Binance polling store, so every component subscribing
 * with overlapping symbol sets reuses one timer + one HTTP request per tick.
 * Public shape `{ prices, loading, error, refresh }` is unchanged from the
 * pre-store implementation; existing call sites work without edits.
 */
export function useBinanceTopCoinPrices(symbols, refreshInterval = 10000) {
  const symbolsKey = useMemo(() => {
    if (!symbols || symbols.length === 0) return ''
    return [...symbols].sort().join(',')
  }, [symbols])

  const [prices, setPrices] = useState(() => {
    if (!symbols || symbols.length === 0) return {}
    return pickKeys(binancePricesStore.getCached(), symbols)
  })
  const [loading, setLoading] = useState(true)
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
      if (Object.keys(next).length > 0) setLoading(false)
    }

    return binancePricesStore.subscribe(ourSymbols, refreshInterval, handler)
  }, [symbolsKey, refreshInterval])

  // The store ticks on its own cadence; expose a noop-safe refresh for API parity.
  const refresh = () => {}
  return { prices, loading, error: null, refresh }
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
    if (!a || a.price !== b.price || a.change !== b.change) return false
  }
  return true
}
