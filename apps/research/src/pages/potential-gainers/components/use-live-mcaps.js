/*
 * useLiveMarketCaps - live CoinGecko market caps for the signal board.
 *
 * The momentum signals endpoint refreshes ~every 2 minutes, so a token's
 * "since PG signal" return is only as fresh as the last board poll. This
 * hook fetches live market caps straight from CoinGecko for the board's
 * tokens (one batched request, ~60s poll, paused while the tab is hidden)
 * so the CURRENT return can be recomputed live.
 *
 * Purely additive: any failure returns the last-known map (or an empty one)
 * and `live: false`, so callers transparently fall back to backend values.
 * Only the current/since-signal return is recomputed from this - the
 * 24h/48h/72h/peak horizons stay backend fields.
 */
import { useEffect, useRef, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

const POLL_MS = 60000
const FETCH_TIMEOUT = 12000

export default function useLiveMarketCaps(cgIds) {
  const [state, setState] = useState({ mcaps: {}, ts: 0, live: false })

  /* Stable key: a request only re-fires when the actual token SET changes,
     not on every 2-minute signals refresh that hands back a new array. */
  const key = Array.isArray(cgIds)
    ? [...new Set(cgIds.filter(Boolean).map(String))].sort().join(',')
    : ''
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    if (!key) {
      setState({ mcaps: {}, ts: 0, live: false })
      return undefined
    }
    let cancelled = false

    /* `force` runs the fetch even when the tab is hidden - used only for the
       one initial load so the page never renders on stale backend values.
       The 60s poll stays visibility-gated so a backgrounded tab burns nothing. */
    const fetchMcaps = async (force) => {
      if (!force && typeof document !== 'undefined' && (document.hidden || !isAppActive())) return
      try {
        const url = `/api/coingecko/coins/markets?vs_currency=usd&ids=${encodeURIComponent(key)}&per_page=250&sparkline=false`
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
        if (!res.ok) throw new Error(`cg markets ${res.status}`)
        const arr = await res.json()
        if (cancelled || keyRef.current !== key) return
        const mcaps = {}
        if (Array.isArray(arr)) {
          for (const c of arr) {
            const mc = Number(c?.market_cap)
            if (c?.id && Number.isFinite(mc) && mc > 0) mcaps[c.id] = mc
          }
        }
        setState({ mcaps, ts: Date.now(), live: Object.keys(mcaps).length > 0 })
      } catch {
        /* additive-only: keep the last-known map, just drop the live flag */
        if (!cancelled) setState((prev) => ({ ...prev, live: false }))
      }
    }

    fetchMcaps(true)
    const interval = window.setInterval(() => fetchMcaps(false), POLL_MS)
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) fetchMcaps(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [key])

  return state
}
