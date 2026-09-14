import { useCallback, useEffect, useRef, useState } from 'react'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'

/**
 * Staying Power durability map for the X Dash leaderboard.
 *
 * Calls GET /api/xdash/leaderboard?window=<w>&fields=staying — the compact
 * "staying map" mode (NOT full rows). Returns a lookup keyed by the X Dash
 * cg_id/asset (lowercased) with a symbol fallback, so the leaderboard view
 * can merge `staying_power` + `trend` onto its existing rows.
 *
 * Defensive on purpose: these /api/xdash/* routes proxy through a serverless
 * fn that can return a non-JSON gateway page when slow/killed, so we read
 * res.text() then try/parse rather than res.json(). Keeps the last good map
 * across window changes, skips while the tab is hidden / user idle, bounded
 * by AbortSignal.timeout.
 */
const FETCH_TIMEOUT = 20000
const CLIENT_CACHE = new Map() /* window -> { map, ts } */
const INFLIGHT = new Map() /* window -> Promise<map> - dedup concurrent fetches */
const CACHE_TTL = 120000

function emptyMap() {
  return { byAsset: new Map(), bySymbol: new Map() }
}

function buildMap(rows) {
  const byAsset = new Map()
  const bySymbol = new Map()
  for (const row of rows || []) {
    if (!row) continue
    const entry = {
      staying_power: Number(row.staying_power),
      trend: row.trend || 'flat',
      trend_delta: Number(row.trend_delta || 0),
      presence_pct: Number(row.presence_pct || 0),
      days_present: Number(row.days_present || 0),
      window_len: Number(row.window_len || 0),
    }
    if (row.asset) byAsset.set(String(row.asset).toLowerCase(), entry)
    if (row.symbol) bySymbol.set(String(row.symbol).toLowerCase(), entry)
  }
  return { byAsset, bySymbol }
}

export function useXDashStaying(window, hookOptions = {}) {
  const enabled = hookOptions.enabled !== false && Boolean(window)
  const [stayingMap, setStayingMap] = useState(() => {
    const cached = CLIENT_CACHE.get(window)
    return cached && Date.now() - cached.ts < CACHE_TTL ? cached.map : emptyMap()
  })
  const [loading, setLoading] = useState(enabled)
  const mapRef = useRef(stayingMap)

  const fetchStaying = useCallback(async (win) => {
    if (!win) return
    const cached = CLIENT_CACHE.get(win)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      mapRef.current = cached.map
      setStayingMap(cached.map)
      setLoading(false)
      return
    }
    setLoading(true)

    // Dedup concurrent fetches for the same window (e.g. the leaderboard
    // re-mounting or multiple consumers requesting the same staying map).
    // Mirror the INFLIGHT-map pattern used by the sibling xdash hooks.
    let promise = INFLIGHT.get(win)
    if (!promise) {
      promise = (async () => {
        const res = await fetch(
          `/api/xdash/leaderboard?window=${encodeURIComponent(win)}&fields=staying`,
          { credentials: 'include', signal: AbortSignal.timeout(FETCH_TIMEOUT) },
        )
        const text = await res.text()
        let json = null
        try { json = JSON.parse(text) } catch { json = null }
        const rows = json && json.data && Array.isArray(json.data.rows) ? json.data.rows : []
        const map = buildMap(rows)
        CLIENT_CACHE.set(win, { map, ts: Date.now() })
        return map
      })().finally(() => { INFLIGHT.delete(win) })
      INFLIGHT.set(win, promise)
    }

    try {
      const map = await promise
      mapRef.current = map
      setStayingMap(map)
    } catch {
      // keep last good map on failure (degraded endpoint or timeout)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    // This is a ONE-SHOT fetch (5-min CLIENT_CACHE, no polling), so it must
    // NOT be gated on document.hidden / isAppActive the way a poll would be:
    // if the board mounted in a backgrounded tab or after 5min idle, the
    // guarded fetch never fired AND never retried -> Staying Power column
    // stayed blank forever (the reported bug). Fire on mount; if the tab is
    // hidden/idle right now, retry the moment it becomes visible + active.
    if (typeof document === 'undefined' || (!document.hidden && isAppActive())) {
      fetchStaying(window)
      return undefined
    }
    const retry = () => {
      if (!document.hidden && isAppActive()) fetchStaying(window)
    }
    document.addEventListener('visibilitychange', retry)
    const unsub = subscribeActivity(retry)
    return () => {
      document.removeEventListener('visibilitychange', retry)
      unsub?.()
    }
  }, [enabled, window, fetchStaying])

  return { stayingMap, loading }
}
