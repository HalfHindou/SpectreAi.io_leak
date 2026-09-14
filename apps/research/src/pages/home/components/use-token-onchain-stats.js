import { useState, useEffect } from 'react'
import { getTokenDetails } from '@/services/onchainApi'

/**
 * Fetch REAL on-chain health stats for a token (liquidity, holders, FDV) via a
 * single cached getTokenDetails call. Returns { loading, stats } where stats is
 * null when the token isn't on-chain or the upstream has no data — the popup
 * hides the Key Stats section in that case rather than showing zeros.
 *
 * `enabled` gates the fetch so it only fires when the section will actually show
 * (on-chain token with no Polymarket predictions).
 */
export function useTokenOnchainStats(address, networkId, enabled = true) {
  const [state, setState] = useState({ loading: false, stats: null })

  useEffect(() => {
    if (!enabled || !address || !networkId) {
      setState({ loading: false, stats: null })
      return
    }
    let cancelled = false
    setState({ loading: true, stats: null })
    getTokenDetails(address, networkId)
      .then(res => {
        if (cancelled) return
        const d = res?.data
        // Require at least one meaningful field, else treat as no-data (hide).
        if (!d || (!(d.liquidity > 0) && !(d.holders > 0) && !(d.fdv > 0))) {
          setState({ loading: false, stats: null })
          return
        }
        setState({ loading: false, stats: d })
      })
      .catch(() => { if (!cancelled) setState({ loading: false, stats: null }) })
    return () => { cancelled = true }
  }, [address, networkId, enabled])

  return state
}
