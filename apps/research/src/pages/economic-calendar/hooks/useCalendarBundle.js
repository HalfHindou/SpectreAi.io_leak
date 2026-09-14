/**
 * useCalendarBundle Hook
 *
 * Fires one request to `/api/calendar/bundle` on mount and returns
 * events + analysis + themes + verdict + history. The dedicated hooks
 * (useCalendarData, useThemes, useMarketRegime) handle polling for fresh
 * data — this hook only powers the first paint so cold load pays a single
 * network round-trip instead of five.
 *
 * If the bundle fails or returns nothing, callers should fall back to the
 * individual endpoints. We never block the polling hooks on this.
 *
 * COLD-RACE FIX: the dedicated hooks mount on the SAME tick as this one and,
 * with no seed yet, used to immediately fire their own /economic, /analysis
 * and /verdict requests — so a cold load cost ~3 requests instead of the
 * intended 1. To let them defer, we publish the in-flight bundle promise at
 * module scope via `getPendingBundle()`. Because all four hooks are called by
 * the same parent, this hook's mount effect runs FIRST (call order), so the
 * downstream hooks can read the pending promise in their own mount effects and
 * wait for the bundle before deciding whether a standalone fetch is needed.
 * Only the COLD mount path consults it; polls never do.
 */
import { useEffect, useState, useRef } from 'react'

// Module-level handle to the current in-flight bundle fetch. Set synchronously
// when the mount effect runs. We keep the promise around AFTER it resolves too
// (within a short TTL) so below-fold-gated consumers (useMarketRegime, useThemes
// — which only mount when their section nears the viewport, well after the
// bundle has resolved) can still seed from it instead of re-fetching.
let _pendingBundle = null
let _bundleTs = 0
const _BUNDLE_REUSE_TTL = 10 * 60 * 1000 // 10 min — matches the bundle CDN TTL

// Returns the bundle promise (resolving to the json or null) when one is
// in-flight or recently resolved, else null. Consumers treat null as "no bundle
// to wait for — fetch normally".
export function getPendingBundle() {
  if (!_pendingBundle) return null
  if (Date.now() - _bundleTs > _BUNDLE_REUSE_TTL) {
    _pendingBundle = null
    return null
  }
  return _pendingBundle
}

export default function useCalendarBundle({ from, to } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    const url = `/api/calendar/bundle${qs ? `?${qs}` : ''}`

    const promise = fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (mountedRef.current) setData(json || null)
        return json || null
      })
      .catch(() => {
        if (mountedRef.current) setData(null)
        return null
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
        // Keep the resolved promise reusable (TTL-bounded in getPendingBundle)
        // so late, viewport-gated consumers can still seed from it.
      })

    // Publish synchronously so the downstream hooks (whose mount effects run
    // after this one, same parent) can defer their cold fetch to it.
    _pendingBundle = promise
    _bundleTs = Date.now()

    return () => { mountedRef.current = false }
  }, [from, to])

  return { data, loading }
}
