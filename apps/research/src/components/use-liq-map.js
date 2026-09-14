/**
 * useLiqMap — fetches the price-axis liquidation map.
 * Visibility-gated per api-patterns.md §L: no fetch while the host tab is closed.
 */
import { useState, useEffect } from 'react'
import { getLiqMap } from '@/pages/traders-corner/tradersCornerApi'

export default function useLiqMap(symbol = 'BTCUSDT', interval = '1d', enabled = true) {
  const [map, setMap] = useState(null)
  const [loading, setLoading] = useState(!!enabled)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setLoading(true); setError(null)
    getLiqMap(symbol, interval)
      .then((d) => { if (!cancelled) { setMap(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [symbol, interval, enabled])

  return { map, loading, error }
}
