/**
 * usePrivateMarkets — data hook for the Private Markets page
 *
 * Returns { deals, loading, error, refresh } per .claude/rules/coding-standards.md H
 * (hooks return plain objects, never arrays).
 *
 * Visibility-aware: skips fetches while tab is hidden.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { getPrivateDeals, getPrivateStats } from './private-markets-api'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const REFRESH_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes — Spectre fundraising is realtime

export default function usePrivateMarkets() {
  const [deals, setDeals] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Tracks the last successful deals fetch for the FreshnessTag.
  const [lastUpdated, setLastUpdated] = useState(null)
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return

    // Deals and stats are fired in parallel but settled independently. The
    // deal-feed UI only depends on `deals`; loading + FreshnessTag also key
    // off deals so a slow /stats response (180-300 ms) never blocks the
    // freshness pill from showing "live just now". Both API calls return
    // null/[] on failure (see private-markets-api.js) so we don't try/catch.
    const dealsPromise = getPrivateDeals().then((dealsData) => {
      if (cancelledRef.current) return
      setDeals(dealsData)
      setError(null)
      setLastUpdated(Date.now())
    })

    const statsPromise = getPrivateStats().then((statsData) => {
      if (cancelledRef.current) return
      setStats(statsData)
    })

    // Spin the loading flag down as soon as deals lands. Stats trickles in
    // on its own — the header just swaps the count when it arrives.
    dealsPromise.finally(() => {
      if (!cancelledRef.current) setLoading(false)
    })

    // Tie the callable promise to both so the manual refresh button awaits
    // everything before re-enabling.
    await Promise.allSettled([dealsPromise, statsPromise])
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    load()
    return () => { cancelledRef.current = true }
  }, [load])

  useAdaptivePolling(load, { interval: REFRESH_INTERVAL_MS })

  return { deals, stats, loading, error, refresh: load, lastUpdated }
}
