/**
 * useWalletsCommand — one aggregated fetch for the Command Center Wallets view.
 *
 * Data: /data-api/v1/wallets/command (Spectre Data API) — smart-money token
 * netflows (server-side Nansen cache, zero live Nansen calls), whale tape,
 * CEX flows, ETF flows, stablecoin issuer activity and entity rollups.
 *
 * The panel is lazy-mounted behind the Wallets tab, so this hook only runs
 * while the tab is open (visibility-gated fetching, api-patterns.md §L).
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const REFRESH_MS = 90_000
const CACHE_TTL = 60_000

let _cache = null // { data, ts }
let _inflight = null

async function fetchCommand() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.data
  if (_inflight) return _inflight
  _inflight = fetch('/data-api/v1/wallets/command', { signal: AbortSignal.timeout(25000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const data = j?.data || (j?.summary ? j : null)
      if (data) _cache = { data, ts: Date.now() }
      _inflight = null
      return data
    })
    .catch(() => {
      _inflight = null
      return _cache?.data || null
    })
  return _inflight
}

export default function useWalletsCommand({ enabled = true } = {}) {
  const [data, setData] = useState(_cache?.data || null)
  const [loading, setLoading] = useState(!_cache)

  const run = useCallback(async () => {
    if (!enabled) return
    if (typeof document !== 'undefined' && document.hidden) return
    const d = await fetchCommand()
    setData((prev) => d || prev)
    setLoading(false)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    fetchCommand().then((d) => {
      if (cancelled) return
      setData((prev) => d || prev)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [enabled])

  useAdaptivePolling(run, { interval: REFRESH_MS, enabled })

  return { data, loading }
}
