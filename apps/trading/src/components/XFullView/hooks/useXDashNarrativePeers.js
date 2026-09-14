import { useEffect, useState, useRef, useCallback } from 'react'
import useAdaptivePolling from '../../../hooks/useAdaptivePolling'
import { getNarrativeTokens } from '../../../services/xDashApi'

/**
 * Fetches peer tokens from the same X Dash narrative as the current token.
 *
 * Takes a narrative slug (extracted upstream from useXDashTokenIntel data)
 * and a self-cgId so we can filter the current token out of its own peer list.
 *
 * Returns:
 *   peers       - array of peer tokens (current token excluded), or null while loading
 *   narrative   - the narrative we queried (echoed for display)
 *   loading     - true on first load
 *   error       - last error message string or null
 *
 * @param {string|null} narrative
 * @param {string|null} selfCgId
 * @param {object} opts - { pollIntervalMs = 300_000, perPage = 8 }
 */
export default function useXDashNarrativePeers(narrative, selfCgId, opts = {}) {
  const { pollIntervalMs = 300_000, perPage = 8 } = opts

  const [peers, setPeers] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const lastNarrativeRef = useRef(null)
  const inflightKeyRef = useRef(null)

  const fetchOnce = useCallback(async () => {
    if (!narrative) return

    const myKey = `${narrative}|${selfCgId || ''}`
    inflightKeyRef.current = myKey

    try {
      const data = await getNarrativeTokens(narrative, {
        ranking: 'momentum',
        perPage: perPage + 1, // fetch one extra so removing self still leaves enough
      })

      if (inflightKeyRef.current !== myKey) return

      if (!data) {
        setError('Peer data offline')
        setPeers((prev) => prev || [])
        return
      }

      const list = Array.isArray(data?.tokens) ? data.tokens : []
      const filtered = list
        .filter((t) => {
          const cg = (t?.cg_id || t?.cgId || t?.token?.cg_id || '').toLowerCase()
          return cg && cg !== (selfCgId || '').toLowerCase()
        })
        .slice(0, perPage)
      setPeers(filtered)
      setError(null)
    } catch (err) {
      if (inflightKeyRef.current !== myKey) return
      console.warn('[useXDashNarrativePeers] error:', err.message)
      setError(err.message || 'Unknown error')
    } finally {
      if (inflightKeyRef.current === myKey) {
        setLoading(false)
      }
    }
  }, [narrative, selfCgId, perPage])

  // Reset on narrative change
  useEffect(() => {
    if (!narrative) {
      lastNarrativeRef.current = null
      setPeers(null)
      setError(null)
      setLoading(false)
      return
    }
    if (lastNarrativeRef.current !== narrative) {
      lastNarrativeRef.current = narrative
      setPeers(null)
      setLoading(true)
      setError(null)
      fetchOnce()
    }
  }, [narrative, fetchOnce])

  useAdaptivePolling(fetchOnce, {
    interval: pollIntervalMs,
    enabled: !!narrative,
  })

  return { peers, narrative, loading, error, refresh: fetchOnce }
}
