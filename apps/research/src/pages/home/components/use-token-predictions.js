import { useState, useEffect } from 'react'
import { getPredictionMarketsForToken } from '@/services/polymarketApi'

/**
 * Fetch REAL prediction markets for a token (Polymarket, via cached events blob).
 * Returns { loading, markets } where markets is [] when the token has no live
 * markets — the popup hides the Predictions section in that case rather than
 * showing fabricated rows.
 */
export function useTokenPredictions(symbol, name, limit = 3) {
  const [state, setState] = useState({ loading: !!symbol, markets: [] })

  useEffect(() => {
    if (!symbol) { setState({ loading: false, markets: [] }); return }
    let cancelled = false
    setState({ loading: true, markets: [] })
    getPredictionMarketsForToken(symbol, name, limit)
      .then(markets => { if (!cancelled) setState({ loading: false, markets: markets || [] }) })
      .catch(() => { if (!cancelled) setState({ loading: false, markets: [] }) })
    return () => { cancelled = true }
  }, [symbol, name, limit])

  return state
}
