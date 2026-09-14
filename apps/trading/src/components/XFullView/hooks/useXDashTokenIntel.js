import { useEffect, useRef, useState, useCallback } from 'react'
import useAdaptivePolling from '../../../hooks/useAdaptivePolling'
import { getTokenIntel, resolveCgId } from '../../../services/xDashApi'

/**
 * Fetches X Dash intelligence for a specific token.
 *
 * Resolves cgId via token.cgId or fallback symbol search, then polls
 * /api/x-dash/token/:cgId. Pauses when tab is hidden via useAdaptivePolling.
 *
 * Returns:
 *   data       - X Dash token detail payload (token, metrics, mentions, top_authors, narrative...)
 *   loading    - true on first load only (not on polls)
 *   error      - last error message string or null
 *   resolvedCgId - the cgId we ended up using (for downstream hooks)
 *   refresh    - manual refetch function
 *
 * @param {object} token - the current token { cgId, symbol, address }
 * @param {object} opts  - { pollIntervalMs = 90_000, enabled = true }
 */
export default function useXDashTokenIntel(token, opts = {}) {
  const { pollIntervalMs = 90_000, enabled = true } = opts

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [resolvedCgId, setResolvedCgId] = useState(null)

  // Track the token identity that this hook instance was created for, so we
  // can detect a token switch and clear stale data immediately. Same pattern
  // as the Spectre/SEI fix in LeftPanel.jsx earlier.
  const tokenKeyRef = useRef(null)
  const inflightTokenKeyRef = useRef(null)

  // A token fresh from the hash route can carry a placeholder symbol ('...')
  // until Codex details land. Resolving with it fires a junk search and
  // latches "Not tracked" until the next 90s poll — so treat it as absent.
  const realSymbol =
    token?.symbol && token.symbol !== '...' && token.symbol !== '…' ? token.symbol : null

  // Include the symbol in the identity key so its arrival (placeholder → real)
  // re-triggers resolution instead of waiting out the poll interval.
  const tokenKey = token
    ? `${token.address || token.cgId || ''}:${token.cgId || ''}:${(realSymbol || '').toLowerCase()}`
    : null

  const fetchOnce = useCallback(async () => {
    if (!enabled || !token) return

    const myKey = tokenKey
    inflightTokenKeyRef.current = myKey

    // Identity not usable yet (no cgId, placeholder symbol) — stay in the
    // loading state; the symbol's arrival changes tokenKey and refetches.
    if (!token.cgId && !realSymbol) return

    try {
      // Resolve cgId — uses sessionStorage cache for repeat lookups
      const cgId = await resolveCgId({ ...token, symbol: realSymbol || token.symbol })

      // Token may have switched while resolving — bail out
      if (inflightTokenKeyRef.current !== myKey) return

      if (!cgId) {
        setResolvedCgId(null)
        setData(null)
        setError('Not indexed by X Dash yet')
        setLoading(false)
        return
      }

      setResolvedCgId(cgId)

      const intel = await getTokenIntel(cgId)

      // Token may have switched while fetching
      if (inflightTokenKeyRef.current !== myKey) return

      if (intel) {
        setData(intel)
        setError(null)
      } else {
        // Service returned null = transient failure or unconfigured key.
        // Don't clear existing data on poll failures (stale-while-error).
        setData((prev) => prev || null)
        setError('Intelligence offline')
      }
    } catch (err) {
      if (inflightTokenKeyRef.current !== myKey) return
      console.warn('[useXDashTokenIntel] error:', err.message)
      setError(err.message || 'Unknown error')
    } finally {
      if (inflightTokenKeyRef.current === myKey) {
        setLoading(false)
      }
    }
  }, [token, tokenKey, realSymbol, enabled])

  // Token-switch effect: clear stale state immediately when token identity
  // changes, then trigger a fresh fetch. Mirrors the LeftPanel pattern.
  useEffect(() => {
    if (!tokenKey) {
      tokenKeyRef.current = null
      setData(null)
      setResolvedCgId(null)
      setError(null)
      setLoading(false)
      return
    }

    if (tokenKeyRef.current !== tokenKey) {
      tokenKeyRef.current = tokenKey
      setData(null)
      setResolvedCgId(null)
      setError(null)
      setLoading(true)
      fetchOnce()
    }
  }, [tokenKey, fetchOnce])

  // Polling
  useAdaptivePolling(fetchOnce, {
    interval: pollIntervalMs,
    enabled: enabled && !!tokenKey,
  })

  return { data, loading, error, resolvedCgId, refresh: fetchOnce }
}
