/**
 * useMindshareData — Fetches narrative lifecycle mindshare data from Command Center API.
 *
 * Endpoint: /api/market/mindshare (proxied via Express)
 * Returns: cycle, highlights, curve, matrix, sectors with lifecycle stages + top movers.
 */
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getSpectreMindshare } from '@/services/spectreMarketApi'

const MINDSHARE_API = '/api/market/mindshare'
// Refresh every 60s — narrative lifecycle is derived from 24h windows so the
// underlying signal does not whip around, but traders expect the panel to feel
// alive. 60s matches the /data-api cache window and keeps the server happy.
const REFRESH_INTERVAL = 60 * 1000

export default function useMindshareData({ enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchMindshare = useCallback(async () => {
    if (!enabled) return
    try {
      const spectre = await getSpectreMindshare({ limit: 40 }).catch(() => null)
      if (spectre) {
        setData({
          ...spectre,
          sectors: Array.isArray(spectre.data) ? spectre.data : [],
          source: 'spectre-market',
        })
        setError(null)
        return
      }

      const isLocalDev = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
      if (isLocalDev) throw new Error('local legacy mindshare disabled')

      // Timeout: a hung request here left loading=true forever (permanent shimmer,
      // prod-only - this leg is skipped on localhost so dev never showed it)
      const res = await fetch(MINDSHARE_API, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`Mindshare API ${res.status}`)
      const json = await res.json()
      setData(json)
      setLastUpdated(Date.now())
      setError(null)
    } catch (err) {
      setError(err.message)
      // Keep stale data on error
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (enabled) fetchMindshare()
  }, [fetchMindshare, enabled])

  // Poll for mindshare data with adaptive intervals (pauses on tab hidden).
  // `enabled` lets callers gate the whole hook behind a tab so it doesn't poll
  // market-wide narrative data while its panel is off-screen.
  useAdaptivePolling(fetchMindshare, { interval: REFRESH_INTERVAL, enabled })

  return { data, loading, error, lastUpdated }
}
