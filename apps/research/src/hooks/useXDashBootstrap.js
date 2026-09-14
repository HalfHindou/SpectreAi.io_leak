import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'
import { readXDashHealth } from '@/lib/xdash-health'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 60000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 25000
// Auto-recover from a transient auth-gate 401 on boot: the gate token can be
// briefly unavailable while it (re)establishes, and the main board has NO poll
// of its own, so a 401 would otherwise leave it blank until the user interacts.
// Retry on a short cadence until the gate is back, then stop (the reconnect
// banner stays as the manual fallback). ~8 × 2.5s ≈ covers a 20s establish window.
const MAX_AUTH_RETRIES = 8
const AUTH_RETRY_DELAY = 2500

function getCacheKey(params) {
  return `bootstrap:${JSON.stringify(params)}`
}

// ── localStorage instant-paint seed (Wave-1 C1 pattern, opt-in) ────────────
// The board was the last hot list surface without a cross-session seed: every
// cold reload of /x-dash and the home mindshare section shimmered while the
// slow-moving bootstrap payload refetched. Opt-in via hookOptions.persist so
// only the first-paint surfaces pay localStorage quota. The seed is SLIMMED -
// the heavy per-row envelopes (quality bars, carrier avatars, momentum entry,
// tweet samples) are dropped, so names/logos/numbers paint instantly and the
// rich bits fill when the network revalidate lands moments later.
const SEED_PREFIX = 'spectre-xdash-boot-v1:'
const SEED_TTL_MS = 10 * 60 * 1000
const SEED_MAX_BYTES = 400_000
// The seed stores the RAW (pre-normalize) response minus the heavy per-item
// envelopes: normalizeResponse duplicates token+metrics fields onto the row
// (458KB flattened vs ~170KB slim raw), so persisting raw and re-normalizing
// on hydrate roughly halves the quota cost. Quota is scarce: the app's seed
// family already sits near the 5MB localStorage ceiling on a warm profile.
const SEED_HEAVY_FIELDS = ['quality', 'top_authors', 'top_mentions', 'momentum_entry']
function slimForSeed(data) {
  if (!data) return data
  const strip = (row) => {
    const out = { ...row }
    for (const k of SEED_HEAVY_FIELDS) delete out[k]
    return out
  }
  return {
    ...data,
    tokens: (data.tokens || []).map(strip),
    featured_majors: (data.featured_majors || []).map(strip),
  }
}
function seedGet(key) {
  try {
    const raw = localStorage.getItem(SEED_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.ts || Date.now() - parsed.ts > SEED_TTL_MS) return null
    if (!parsed.data) return null
    return normalizeResponse(parsed.data)
  } catch { return null }
}
function purgeOwnStaleSeeds() {
  try {
    const now = Date.now()
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(SEED_PREFIX)) continue
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || 'null')
        if (!parsed?.ts || now - parsed.ts > SEED_TTL_MS) localStorage.removeItem(k)
      } catch { localStorage.removeItem(k) }
    }
  } catch { /* private mode */ }
}
function seedPut(key, rawData) {
  try {
    const raw = JSON.stringify({ ts: Date.now(), data: slimForSeed(rawData) })
    if (raw.length > SEED_MAX_BYTES) return
    try {
      localStorage.setItem(SEED_PREFIX + key, raw)
    } catch {
      // Quota: free only OUR stale keys and retry once. If the profile is
      // genuinely full (the app-wide seed family can saturate the 5MB
      // ceiling), give up silently - the seed is best-effort by contract.
      purgeOwnStaleSeeds()
      localStorage.setItem(SEED_PREFIX + key, raw)
    }
  } catch { /* quota / private mode - seed is best-effort */ }
}

// Flatten nested API structure: { token: {...}, metrics: {...} } -> flat object
export function normalizeItem(item) {
  if (!item || !item.token || typeof item.token !== 'object') return item
  const t = item.token
  const m = item.metrics || {}
  return {
    ...item,
    ...t,
    ...m,
    // Logo source resolution chain - upstreams emit different field names
    // depending on which provider produced the row (X Dash native vs the
    // Spectre API fallback in social-proxy.js, which sets logo_url). Keep
    // ALL aliases on the flattened object so downstream consumers (e.g. the
    // mindshare treemap) don't have to know which upstream produced this row.
    image: t.image_small || t.image_url || t.logo_url || t.logo || t.image_thumb,
    image_small: t.image_small || t.logo_url,
    image_url: t.image_url || t.logo_url,
    logo_url: t.logo_url || t.image_small || t.image_url,
    token_id: t.token_id || t.cg_id,
    unique_authors_24h: m.unique_external_authors_24h,
    author_count: m.unique_external_authors_24h,
    mentions: m.external_mentions,
    latest_mention_at: item.latest_mention_at,
    top_authors: item.top_authors,
    quality: item.quality,
    state: item.state,
  }
}

function normalizeResponse(data) {
  if (!data) return data
  return {
    ...data,
    tokens: (data.tokens || []).map(normalizeItem),
    featured_majors: (data.featured_majors || []).map(normalizeItem),
  }
}

export function useXDashBootstrap(params = {}, hookOptions = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // Sticky until a fetch SUCCEEDS: clearing it at fetch start made every
  // retry - including the ErrorState panel's own foreground 20s poll - flip
  // the view error -> shimmer -> error (the mobile outage flicker). errorRef
  // mirrors it so fetchBootstrap can read the live value without a stale
  // closure.
  const [error, setError] = useState(null)
  const errorRef = useRef(null)
  const setErrorState = useCallback((message) => {
    errorRef.current = message
    setError(message)
  }, [])
  // Distinct from `error`: a 401 means the team auth-gate token is missing or
  // expired (server returns code GATE_REQUIRED), not that the data is down. The
  // page surfaces a "session expired - reconnect" banner instead of a silent
  // empty board (which reads as "disconnected"). Cleared on any successful load.
  const [authError, setAuthError] = useState(false)
  const paramsRef = useRef(params)
  const dataRef = useRef(null)
  // Static per mount site - captured once so fetchBootstrap deps stay stable.
  const persistRef = useRef(hookOptions.persist === true)
  // fetchRef lets the retry timer call the latest fetchBootstrap regardless of
  // definition order; authRetryRef bounds the auto-retry on a gate 401.
  const fetchRef = useRef(null)
  const authRetryRef = useRef({ count: 0, timer: null })
  const clearAuthRetry = useCallback(() => {
    if (authRetryRef.current.timer) {
      clearTimeout(authRetryRef.current.timer)
      authRetryRef.current.timer = null
    }
    authRetryRef.current.count = 0
  }, [])
  // Returns true while a retry is still pending/available, false once the
  // bounded budget is exhausted — the caller uses this to delay the scary
  // "session expired" banner until the gate is CONFIRMED gone (see below).
  const scheduleAuthRetry = useCallback(() => {
    const st = authRetryRef.current
    if (st.timer) return true
    if (st.count >= MAX_AUTH_RETRIES) return false
    st.count += 1
    st.timer = window.setTimeout(() => {
      st.timer = null
      fetchRef.current?.(paramsRef.current, { bypassCache: true, background: true })
    }, AUTH_RETRY_DELAY)
    return true
  }, [])
  const setDataState = useCallback((nextData) => {
    dataRef.current = nextData
    setData(nextData)
    setErrorState(null)
    setAuthError(false)
    clearAuthRetry()
  }, [clearAuthRetry, setErrorState])
  // A 401 means the team auth-gate token is briefly unavailable, NOT that the
  // user really signed out — it usually re-establishes on its own (flaky mobile
  // network / cold serverless / iOS-PWA storage blip). So DON'T flash the
  // "your session expired - sign in" banner on the first failure: retry
  // silently and only surface the banner once the bounded retry budget is
  // exhausted (gate genuinely gone). Prevents the false-logout flash for a
  // signed-in user during a transient blip. Non-auth errors never show it.
  const applyFetchError = useCallback((e) => {
    setErrorState(e.message)
    if (e.code === 'AUTH') {
      const stillRetrying = scheduleAuthRetry()
      setAuthError(!stillRetrying)
    } else {
      setAuthError(false)
    }
  }, [scheduleAuthRetry, setErrorState])

  const fetchBootstrap = useCallback(async (fetchParams, requestOptions = {}) => {
    const key = getCacheKey(fetchParams)
    const shouldBypassCache = requestOptions.bypassCache === true
    const isBackgroundRefresh = requestOptions.background === true

    if (shouldBypassCache) {
      CLIENT_CACHE.delete(key)
    }

    // Client cache check
    const cached = shouldBypassCache ? null : CLIENT_CACHE.get(key)
    if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
      setDataState(cached.data)
      setLoading(false)
      return
    }

    // Instant-paint: on a cold mount paint the persisted snapshot immediately,
    // then fall through to the network fetch below which revalidates it. The
    // seeded flag suppresses the loading flip so there is no shimmer flash.
    let seededNow = false
    if (persistRef.current && !shouldBypassCache && !dataRef.current) {
      const seed = seedGet(key)
      if (seed) {
        setDataState(seed)
        setLoading(false)
        seededNow = true
      }
    }

    // Deduplicate in-flight requests
    if (INFLIGHT.has(key)) {
      try {
        const result = await INFLIGHT.get(key)
        setDataState(result)
        setLoading(false)
      } catch (e) {
        applyFetchError(e)
        setLoading(false)
      }
      return
    }

    // While the error panel is up, retries - background OR the panel's own
    // foreground "Refresh now" / 20s poll - must not flip loading back on:
    // the panel IS the loading state during an outage, and the error stays
    // sticky until a fetch SUCCEEDS (setDataState clears it). Clearing either
    // one per retry tick unmounted the panel and flashed the Shimmer under
    // it - the outage flicker.
    if ((!isBackgroundRefresh || !dataRef.current) && !errorRef.current && !seededNow) {
      setLoading(true)
    }

    const query = new URLSearchParams({
      page: fetchParams.page || '1',
      per_page: fetchParams.perPage || '10',
      timeframe: fetchParams.timeframe || '24h',
      ranking: fetchParams.ranking || 'mentions',
      segment: fetchParams.segment || 'all',
      market: fetchParams.market || 'all',
      min_kols: fetchParams.minKols || '1',
    })

    // credentials:'include' - the iOS standalone PWA drops the HttpOnly gate
    // cookie on same-origin-default fetches, so signed-in users 401'd from the
    // home screen app (same bug as useInsight, PR #1064).
    const promise = fetch(`/api/xdash/bootstrap?${query}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then(res => {
        if (res.status === 401) {
          const e = new Error('AUTH_REQUIRED')
          e.code = 'AUTH'
          throw e
        }
        if (!res.ok) throw new Error('Social intelligence unavailable')
        return res.json()
      })
      .then(result => {
        const normalized = normalizeResponse(result)
        CLIENT_CACHE.set(key, { data: normalized, ts: Date.now() })
        // Persist the RAW response (slimmed) - seedGet re-normalizes on hydrate
        if (persistRef.current) seedPut(key, result)
        INFLIGHT.delete(key)
        return normalized
      })
      .catch(err => {
        INFLIGHT.delete(key)
        throw err
      })

    INFLIGHT.set(key, promise)

    try {
      const result = await promise
      setDataState(result)
    } catch (e) {
      applyFetchError(e)
    } finally {
      setLoading(false)
    }
  }, [setDataState, applyFetchError])
  fetchRef.current = fetchBootstrap

  useEffect(() => {
    paramsRef.current = params
    fetchBootstrap(params)
  }, [
    params.page, params.perPage, params.timeframe,
    params.ranking, params.segment, params.market,
    params.minKols, fetchBootstrap,
  ])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Cancel any pending auth-retry timer on unmount.
  useEffect(() => clearAuthRetry, [clearAuthRetry])

  const refetch = useCallback((requestOptions = {}) => {
    fetchBootstrap(paramsRef.current, {
      bypassCache: true,
      ...requestOptions,
    })
  }, [fetchBootstrap])

  useEffect(() => {
    const refreshIntervalMs = hookOptions.refreshIntervalMs || 0
    const refreshOnFocus = hookOptions.refreshOnFocus === true
    if (!refreshIntervalMs && !refreshOnFocus) return undefined

    const refresh = () => {
      // 2026-06-02 cost defense: also skip when the user is idle (>5min no
      // input). X Dash bootstrap is the leaderboard / mindshare data feed -
      // it's expensive on the X Dash backend (Hetzner box) which has its own
      // rate ceiling. Matches the watchlist + token-mentions pattern.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      refetch({ background: true })
    }

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        refetch({ background: true })
      }
    }

    const handleWindowFocus = () => {
      refetch({ background: true })
    }

    let intervalId
    if (refreshIntervalMs > 0) {
      intervalId = window.setInterval(refresh, refreshIntervalMs)
    }

    if (refreshOnFocus && typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('focus', handleWindowFocus)
    }

    return () => {
      if (intervalId) window.clearInterval(intervalId)
      if (refreshOnFocus && typeof window !== 'undefined' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('focus', handleWindowFocus)
      }
    }
  }, [hookOptions.refreshIntervalMs, hookOptions.refreshOnFocus, refetch])

  // One verdict every consumer can read instead of each re-deriving it.
  // `health.state === 'updating'` means the board on screen is NOT an answer to
  // the window that was asked for — the upstream materialises one document per
  // window and serves whatever it has when the requested one was never built
  // (measured 2026-08-28: every timeframe came back window_hours 168, and only
  // 7d carried rows). Without this the views fall through to "no tokens match
  // these filters", which blames the user's filters for an upstream gap.
  const health = useMemo(
    () => readXDashHealth(data, params?.timeframe || '24h', { errored: Boolean(error) }),
    [data, params?.timeframe, error],
  )

  return { data, loading, error, authError, refetch, health }
}
