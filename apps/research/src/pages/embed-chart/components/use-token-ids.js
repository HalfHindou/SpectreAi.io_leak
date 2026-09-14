/**
 * useTokenIds
 * Resolves a CoinGecko slug into the shape the TradingView Advanced datafeed
 * needs: trading symbol + Codex (address, networkId). Hits two lightweight
 * endpoints in parallel, caches per session, and reports an `advAvailable`
 * flag so the caller can gracefully disable Advanced mode when the token
 * isn't indexed upstream.
 *
 * Returns:
 *   {
 *     symbol:        e.g. 'BTC' | 'PAAL' | null
 *     address:       Codex pair/token address | null
 *     networkId:     integer network id | null
 *     advAvailable:  true only when we have BOTH symbol and address
 *     loading:       boolean
 *   }
 */
import { useEffect, useRef, useState } from 'react'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getSpectreTokenProfile } from '@/services/spectreMarketApi'

const COINGECKO_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COINGECKO_ID).map(([symbol, id]) => [id, symbol])
)

const idsCache = new Map() // cgId → { symbol, address, networkId }

async function fetchJSON(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function useTokenIds(cgId) {
  const [state, setState] = useState(() => {
    const cached = cgId ? idsCache.get(cgId.toLowerCase()) : null
    return cached
      ? { ...cached, loading: false, advAvailable: !!(cached.symbol && cached.address) }
      : { symbol: null, address: null, networkId: null, advAvailable: false, loading: !!cgId }
  })
  const abortRef = useRef(null)

  useEffect(() => {
    if (!cgId) return
    const key = cgId.toLowerCase()
    const cached = idsCache.get(key)
    if (cached) {
      setState({ ...cached, loading: false, advAvailable: !!(cached.symbol && cached.address) })
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current
    let cancelled = false

    setState(prev => ({ ...prev, loading: true }))

    // Fire both in parallel. We need convert-ids for codex address and coingecko
    // for the trading symbol. Either can fail independently — we still surface
    // whatever we got so Line/Candle modes keep working.
    const asset = COINGECKO_ID_TO_SYMBOL[key] || null
    const pProfile = asset ? getSpectreTokenProfile(asset).catch(() => null) : Promise.resolve(null)
    const pConvert = fetchJSON(`/api/convert-ids?cgid=${encodeURIComponent(key)}`, signal)
      .catch(() => null)
    const pCoin = import.meta.env.DEV
      ? Promise.resolve(null)
      : fetchJSON(`/api/coingecko/coins/${encodeURIComponent(key)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, signal)
        .catch(() => null)

    Promise.all([pConvert, pCoin, pProfile]).then(([convert, coin, profile]) => {
      if (cancelled) return
      const address = convert?.address || null
      const networkId = convert?.networkId ?? null
      const symbol = (profile?.symbol || coin?.symbol || asset || '').toString().toUpperCase() || null
      const result = { symbol, address, networkId }
      idsCache.set(key, result)
      setState({
        ...result,
        loading: false,
        advAvailable: !!(symbol && address),
      })
    })

    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [cgId])

  return state
}
