import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { consumeEarlyFetch } from '@/lib/early-fetch'

// Treat `{ error }` payloads (a partial-failure marker from the bundle) and
// non-objects as "no data" so a failed slice renders empty instead of crashing.
const clean = (v) => (v && typeof v === 'object' && !v.error ? v : null)

/* ── localStorage instant-paint seed ──────────────────────────────────────
   One key holds the last good bundle (core + history fields merged). 30-min
   TTL because RWA series are daily — painting a few-minutes-stale snapshot
   while the fresh bundle loads is invisible to the user and removes the
   cold-load shimmer entirely. Size-guarded + fully try/catch'd so a quota
   error, disabled storage, or SSR never breaks the hook. */
const RWA_SEED_KEY = 'spectre-rwa-bundle-v1'
const RWA_SEED_TTL = 30 * 60 * 1000

function readRwaSeed() {
  try {
    const raw = localStorage.getItem(RWA_SEED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > RWA_SEED_TTL) return null
    return parsed
  } catch {
    return null
  }
}

function writeRwaSeed(patch) {
  try {
    let prev = null
    try {
      const raw = localStorage.getItem(RWA_SEED_KEY)
      prev = raw ? JSON.parse(raw) : null
    } catch {
      prev = null
    }
    const merged = { ...(prev && typeof prev.data === 'object' ? prev.data : {}), ...patch }
    const json = JSON.stringify({ ts: Date.now(), data: merged })
    if (json.length > 2_000_000) return // ~2MB guard, well under the ~5MB quota
    localStorage.setItem(RWA_SEED_KEY, json)
  } catch {
    /* quota exceeded / storage disabled / SSR — non-fatal */
  }
}

/* ═══════════════════════════════════════════════
   Existing hook — unchanged shape so other tabs
   continue to function during the migration.

   Options:
     riskAlphaActive — true when the user is on the
     Risk & Alpha tab. Phase 7 (4 endpoints) and
     Phase 8 (2 endpoints) are only consumed there,
     so we don't burn 6 cold serverless calls + a
     90-second polling timer on the default Overview
     landing. State persists across tab switches so
     re-opening the tab feels instant.

     networksActive — true when the user is on the
     Networks tab. /api/rwa/chains is the only fetch
     consumed exclusively by RwaNetworksTab; Overview
     builds its chain donut from protocols[].chains
     directly. State persists.
   ═══════════════════════════════════════════════ */
export function useRwaData({ riskAlphaActive = false, networksActive = false } = {}) {
  // localStorage instant-paint seed. The bundle is the only thing blocking
  // first paint, and on a cold load it waits on the slowest remote call, so
  // a returning user used to stare at a full-page shimmer every time. We
  // seed state synchronously from the last good bundle (30-min TTL — RWA
  // series are daily, safe to show stale for a beat) so hero + tables + the
  // 2-year charts paint instantly, then both tiers revalidate in the
  // background. Read once per mount via a ref so re-renders don't re-parse.
  const seedRef = useRef(undefined)
  if (seedRef.current === undefined) seedRef.current = readRwaSeed()
  const seed = seedRef.current?.data || null
  const seedTs = seedRef.current?.ts || null

  const [overview, setOverview] = useState(() => clean(seed?.overview))
  const [protocols, setProtocols] = useState(() => (Array.isArray(seed?.protocols) ? seed.protocols : []))
  const [stablecoins, setStablecoins] = useState(() => (Array.isArray(seed?.stablecoins) ? seed.stablecoins : []))
  const [tvlHistory, setTvlHistory] = useState(() => clean(seed?.tvlHistory))
  const [stablecoinHistory, setStablecoinHistory] = useState(() => clean(seed?.stablecoinHistory))
  const [chains, setChains] = useState(null)
  const [movers, setMovers] = useState(() => clean(seed?.movers))
  // Phase 2: issuer-direct breakdown + 12-category history. Additive - existing
  // tvlHistory / overview consumers continue to work when these are null.
  const [breakdown, setBreakdown] = useState(() => clean(seed?.breakdown))
  const [breakdownHistory, setBreakdownHistory] = useState(() => clean(seed?.breakdownHistory))
  // Phase 6: Spectre RWA Index (SRWAI). Additive - null means hero stat
  // falls back to gracefully showing nothing. srwaIndexHistory was
  // previously fetched alongside but no tab consumed it — destructured
  // in the page wrapper, never passed down. Removed both the state and
  // its /api/rwa/index/history?range=2y call. If the chart ever returns,
  // re-add with the tab-gated pattern used by Phase 7/8.
  const [srwaIndex, setSrwaIndex] = useState(() => clean(seed?.index))
  // Phase 7: NAV deviation, whale concentration, velocity, live events.
  // Each null until first fetch resolves; consumers MUST handle null.
  const [navWatch, setNavWatch] = useState(null)
  const [concentrationLeaderboard, setConcentrationLeaderboard] = useState(null)
  const [velocity, setVelocity] = useState(null)
  const [events, setEvents] = useState(null)
  // Phase 8 — composability graph + yield curve (additive).
  const [composabilityGraph, setComposabilityGraph] = useState(null)
  const [yieldCurve, setYieldCurve] = useState(null)
  // Seed present → skip the full-page shimmer; revalidate quietly behind it.
  const [loading, setLoading] = useState(!seed)
  const [error, setError] = useState(null)
  const hasFetchedOnce = useRef(Boolean(seed))
  // The history tier loads separately from core (instant-paint), so core flips
  // `loading` off while tvlHistory/breakdownHistory are still null. Track the
  // history tier's first completion so history-only cards (charts, net-flows)
  // keep a skeleton during that window instead of flashing their empty/error
  // state for ~10s. Seeded true when the cached seed already carries history.
  const [historyLoaded, setHistoryLoaded] = useState(Boolean(seed?.tvlHistory || seed?.breakdownHistory))
  // Bounded backoff for the core bundle so a transient 429 (anon rate-limit on a
  // cold CDN right after a deploy) auto-recovers within the rate window instead
  // of leaving a dead "Failed to load RWA data" banner until the 3-min poll.
  const coreRetryRef = useRef(0)
  const coreRetryTimer = useRef(null)
  // Freshness stamps - so any consumer can show "Updated X ago". Tracked
  // per fetch group because they're on different cadences (main = 3 min,
  // history = 30 min, phase7 = 90 s, phase8 = 60 min).
  const [mainUpdatedAt, setMainUpdatedAt] = useState(seed ? seedTs : null)
  const [historyUpdatedAt, setHistoryUpdatedAt] = useState(seed ? seedTs : null)
  const [phase7UpdatedAt, setPhase7UpdatedAt] = useState(null)
  const [phase8UpdatedAt, setPhase8UpdatedAt] = useState(null)

  // Two-tier bundle. The original single /api/rwa/bundle was atomic, so the
  // hero stats + tables waited on the slowest of 9 upstream calls — and the
  // 3 slowest are the 2-year history aggregations (tvl-history forward-fill,
  // stablecoin-history, the remote breakdown/history). We split them off:
  //   tier=core    → overview/protocols/stablecoins/movers/breakdown/index
  //   tier=history → tvlHistory/stablecoinHistory/breakdownHistory
  // fetchData (core, 3-min poll) paints the page; fetchHistory (history,
  // 30-min poll) fills the charts when its heavy aggregation lands. Both
  // fire in parallel on mount, so numbers never wait on charts. Still 2
  // calls/load — well under the 30/min anon gate that forced the original
  // fan-in. Partial upstream failures land as `null` so sections still render.
  const applyCore = useCallback((b) => {
    const next = {
      overview: clean(b.overview),
      protocols: Array.isArray(b.protocols) ? b.protocols : [],
      stablecoins: Array.isArray(b.stablecoins) ? b.stablecoins : [],
      movers: clean(b.movers),
      breakdown: clean(b.breakdown),
      index: clean(b.index),
    }
    setOverview(next.overview)
    setProtocols(next.protocols)
    setStablecoins(next.stablecoins)
    setMovers(next.movers)
    setBreakdown(next.breakdown)
    setSrwaIndex(next.index)
    setMainUpdatedAt(Date.now())
    writeRwaSeed(next)
  }, [])

  const applyHistory = useCallback((b) => {
    const next = {
      tvlHistory: clean(b.tvlHistory),
      stablecoinHistory: clean(b.stablecoinHistory),
      breakdownHistory: clean(b.breakdownHistory),
    }
    setTvlHistory(next.tvlHistory)
    setStablecoinHistory(next.stablecoinHistory)
    setBreakdownHistory(next.breakdownHistory)
    setHistoryUpdatedAt(Date.now())
    writeRwaSeed(next)
  }, [])

  const fetchData = useCallback(async () => {
    const MAX_CORE_RETRIES = 4
    const CORE_RETRY_MS = 6000
    try {
      // Head start: an inline script in index.html fires this exact request at
      // HTML-parse time on a direct /tokenized-assets load, so the bundle is
      // already in flight (often resolved, ~50ms via KV) before React mounts.
      // consumeEarlyFetch returns the in-flight promise once; null on a
      // client-side nav or a missed/failed prefetch → normal fetch below.
      let json = null
      const early = consumeEarlyFetch('/api/rwa/bundle?tier=core')
      if (early) {
        // Race against a ceiling so a hung prefetch (the inline fetch has no
        // AbortSignal) can never block paint longer than the normal fetch would
        // — on timeout we abandon it and fall through to the bounded fetch.
        const r = await Promise.race([early, new Promise((res) => setTimeout(() => res(null), 15000))])
        if (r && r.ok && r.json) json = r.json
      }
      if (!json) {
        const res = await fetch('/api/rwa/bundle?tier=core', { signal: AbortSignal.timeout(15000) })
        if (!res.ok) throw new Error(`bundle/core HTTP ${res.status}`)
        json = await res.json()
      }
      applyCore(json)
      hasFetchedOnce.current = true
      coreRetryRef.current = 0
      setError(null)            // clear any prior error once data lands (banner was sticky)
      setLoading(false)
    } catch (err) {
      console.error('[useRwaData] core bundle failed:', err)
      // Transient failure (esp. 429 rate-limit on a cold CDN): back off and retry
      // within the rate window. Keep loading=true so the page holds skeletons, not
      // a dead banner. Only surface the error if every retry is exhausted on first
      // load — and never on a background poll (we already have data showing).
      if (coreRetryRef.current < MAX_CORE_RETRIES) {
        coreRetryRef.current += 1
        clearTimeout(coreRetryTimer.current)
        coreRetryTimer.current = setTimeout(() => { fetchData() }, CORE_RETRY_MS * coreRetryRef.current)
        return // leave loading as-is (skeletons on first load); the retry resolves it
      }
      coreRetryRef.current = 0
      if (!hasFetchedOnce.current) setError(err.message)
      setLoading(false)
    }
  }, [applyCore])

  // Clear any pending core-bundle backoff retry on unmount.
  useEffect(() => () => clearTimeout(coreRetryTimer.current), [])

  // History tier — fills the 2-year charts. Polled on its own 30-min cadence
  // (server caches it ~30 min upstream) and fired in parallel with the core
  // tier on mount, so a slow aggregation never holds back the hero/tables.
  const fetchHistory = useCallback(async () => {
    try {
      // Same head-start path as core (see fetchData) for the history tier.
      let json = null
      const early = consumeEarlyFetch('/api/rwa/bundle?tier=history&range=2y')
      if (early) {
        const r = await Promise.race([early, new Promise((res) => setTimeout(() => res(null), 20000))])
        if (r && r.ok && r.json) json = r.json
      }
      if (!json) {
        const res = await fetch('/api/rwa/bundle?tier=history&range=2y', { signal: AbortSignal.timeout(20000) })
        if (!res.ok) return
        json = await res.json()
      }
      applyHistory(json)
    } catch (err) {
      console.error('[useRwaData] history bundle failed:', err)
    } finally {
      // First attempt done (success OR failure) — history cards can now decide
      // skeleton-vs-data-vs-empty. Genuine outages fall through to empty here;
      // the in-flight window above keeps them in skeleton.
      setHistoryLoaded(true)
    }
  }, [applyHistory])

  // Chains list is only consumed by RwaNetworksTab. Overview's chain
  // donut is computed locally from protocols[].chains.
  const fetchChains = useCallback(async () => {
    try {
      const res = await fetch('/api/rwa/chains').then(r => r.ok ? r.json() : null)
      if (res && typeof res === 'object' && !res.error) setChains(res)
    } catch (err) {
      console.error('[useRwaData] chains fetch failed:', err)
    }
  }, [])

  /* ───────────────────────────────────────────────
     Phase 7+8 — Risk & Alpha tab (single bundle)
     6 upstream calls (nav-watch, concentration,
     velocity, events, composability/graph,
     yield-curve) collapsed into one /api/rwa/bundle-risk
     fetch. Matches the page-load /bundle pattern —
     kills the 30/min anon rate-limit pressure when
     polling alongside fetchData every 90 s.
     ─────────────────────────────────────────────── */
  const fetchRisk = useCallback(async () => {
    try {
      const res = await fetch('/api/rwa/bundle-risk?velocity_range=30d&events_limit=20')
      if (!res.ok) return
      const b = await res.json()
      setNavWatch(clean(b.navWatch))
      setConcentrationLeaderboard(clean(b.concentrationLeaderboard))
      setVelocity(clean(b.velocity))
      setEvents(clean(b.events))
      setComposabilityGraph(clean(b.composabilityGraph))
      setYieldCurve(clean(b.yieldCurve))
      const now = Date.now()
      setPhase7UpdatedAt(now)
      setPhase8UpdatedAt(now)
    } catch (err) {
      console.error('[useRwaData] bundle-risk failed:', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Back-compat aliases — keep the polling/refetch wiring readable.
  const fetchPhase7 = fetchRisk
  const fetchPhase8 = fetchRisk

  useEffect(() => {
    fetchData()
    fetchHistory()
    // Phase 7 + 8 only fire when the Risk & Alpha tab is active. State
    // persists across tab switches; flipping the flag back to true after
    // the user navigates away just resumes polling without losing data.
    if (riskAlphaActive) {
      fetchPhase7()
      fetchPhase8()
    }
    // Chains list only when Networks is active.
    if (networksActive) {
      fetchChains()
    }
  }, [fetchData, fetchHistory, fetchPhase7, fetchPhase8, fetchChains, riskAlphaActive, networksActive])

  // Auto-refetch on tab return. The most common path to "stale audit
  // surprise" is a user opening the tab, walking away, coming back hours
  // later, and seeing chart data from the morning. Polling helps but
  // there's still a worst-case interval gap. visibilitychange + focus
  // fire the second the user sees the screen, so they never view stale
  // data without us first re-fetching. Guarded so we only re-fetch if
  // the data we already have is older than the cheapest poll cadence
  // (no point burning calls on a 2-second tab flip).
  useEffect(() => {
    const STALE_AFTER_MS = 60 * 1000 // 1 min - tighter than every poll cadence
    const isStale = (ts) => !ts || (Date.now() - ts) > STALE_AFTER_MS
    const refreshIfStale = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (isStale(mainUpdatedAt)) fetchData()
      if (isStale(historyUpdatedAt)) fetchHistory()
      // Only refresh Phase 7 if the user is actually looking at Risk &
      // Alpha. Otherwise the tab-return handler would silently burn 4
      // serverless calls every time the user comes back to a tab they
      // never opened.
      if (riskAlphaActive && isStale(phase7UpdatedAt)) fetchPhase7()
      // Phase 8 is hourly upstream; never burn a call on tab return
    }
    document.addEventListener('visibilitychange', refreshIfStale)
    window.addEventListener('focus', refreshIfStale)
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale)
      window.removeEventListener('focus', refreshIfStale)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainUpdatedAt, historyUpdatedAt, phase7UpdatedAt, fetchData, fetchHistory, fetchPhase7, riskAlphaActive])

  useAdaptivePolling(fetchData, { interval: 3 * 60 * 1000 })
  // History endpoints (tvl-history, breakdown/history, srwaIndex/history)
  // used to be a one-shot fetch on mount, which left the 2-year chart
  // frozen for the entire session. Server caches them at 30 min upstream,
  // so a 30 min client poll matches the source of truth without wasting
  // calls.
  useAdaptivePolling(fetchHistory, { interval: 30 * 60 * 1000 })
  // Phase 7: events update fastest (live mint/burn feed). NAV deviation +
  // velocity change slowly, so a single 90s tick is fine for all four.
  // Gated on riskAlphaActive — no point polling 4 endpoints every 90 s
  // when the user is on Overview / Stablecoins / etc and never sees them.
  useAdaptivePolling(fetchPhase7, { interval: 90 * 1000, enabled: riskAlphaActive })
  // Phase 8: composability is editorial; yield curve refreshes hourly on
  // the server. Client poll matched to the cron so users never see
  // anything older than ~60 min on a yield curve. Drop from the prior
  // 10-min cadence eliminates 5 unnecessary calls/hour per visit. Also
  // gated on Risk & Alpha tab visibility for the same reason as Phase 7.
  useAdaptivePolling(fetchPhase8, { interval: 60 * 60 * 1000, enabled: riskAlphaActive })

  return {
    overview,
    protocols,
    stablecoins,
    tvlHistory,
    stablecoinHistory,
    chains,
    movers,
    breakdown,
    breakdownHistory,
    // Phase 6: Spectre RWA Index (SRWAI) — additive
    srwaIndex,
    // Phase 7: flagship signals (Risk & Alpha tab)
    navWatch,
    concentrationLeaderboard,
    velocity,
    events,
    // Phase 8: composability graph + yield curve (Risk & Alpha tab cards)
    composabilityGraph,
    yieldCurve,
    // Freshness stamps - consumers can render "Updated X ago" off these.
    // mainUpdatedAt covers overview/protocols/stablecoins/breakdown/srwaIndex,
    // historyUpdatedAt covers tvl/breakdown/srwaIndex history series,
    // phase7UpdatedAt covers nav-watch/concentration/velocity/events,
    // phase8UpdatedAt covers composability + yield curve.
    mainUpdatedAt,
    historyUpdatedAt,
    phase7UpdatedAt,
    phase8UpdatedAt,
    loading,
    historyLoaded,
    error,
    refetch: fetchData,
    refetchHistory: fetchHistory,
    // Refresh every data group at once. Wired into the freshness pill's
    // click handler so the user always has a manual escape hatch when
    // they don't trust the auto-poll.
    refetchAll: () => {
      fetchData()
      fetchHistory()
      if (networksActive) fetchChains()
      if (riskAlphaActive) {
        fetchPhase7()
        fetchPhase8()
      }
    },
  }
}

/* ═══════════════════════════════════════════════
   Spectre Brain analysis hook.
   Endpoint: /api/rwa/analysis/:topic
   Backend may respond 200 (ready) or 202 (generating).
   On 202 we retry once after 10s; after that we poll every 4h.
   Returns: { article, lastUpdated, stale, loading, error, refetch }
   ═══════════════════════════════════════════════ */
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
const RETRY_ON_202_MS = 9 * 1000             // 9s between "generating" retries
const MAX_202_RETRIES = 8                    // ~72s of fast retries before the long poll

/* ── Cross-instance dedup for the analysis endpoints ──────────────────────
   The Overview tab mounts FOUR independent consumers of useRwaAnalysis
   ('overview'): rwa-thesis, rwa-brain-sidebar, DailyEdition, AIAnalysisCard.
   Each used to fire its own /api/rwa/analysis/overview on mount → 4 identical
   requests (+ 4x the 404 when the topic isn't published). An inflight map
   collapses concurrent callers onto ONE request; a 30s result cache keeps a
   second mount in the same tab from re-hitting. 202 ("generating") is never
   cached so the per-instance fast-retry keeps polling the live endpoint. */
const _analysisInflight = new Map() // url -> Promise<{status, data, ok}>
const _analysisCache = new Map()    // url -> { ts, payload }
const ANALYSIS_DEDUP_TTL = 30 * 1000

async function fetchAnalysisDeduped(url) {
  const hit = _analysisCache.get(url)
  if (hit && Date.now() - hit.ts < ANALYSIS_DEDUP_TTL) return hit.payload
  if (_analysisInflight.has(url)) return _analysisInflight.get(url)
  const p = (async () => {
    const res = await fetch(url)
    const status = res.status
    let data = null
    if (res.ok && status !== 202) data = await res.json()
    const payload = { status, data, ok: res.ok }
    // Cache terminal outcomes (success or "no article" 404/410); never cache
    // 202 (still generating) or transient 5xx so those keep retrying live.
    if (res.ok || status === 404 || status === 410) {
      _analysisCache.set(url, { ts: Date.now(), payload })
    }
    return payload
  })()
  _analysisInflight.set(url, p)
  try { return await p } finally { _analysisInflight.delete(url) }
}

function useAnalysisFetcher(url, enabled) {
  const [article, setArticle] = useState(null)
  const [headline, setHeadline] = useState(null)
  const [summary, setSummary] = useState(null)
  const [ogImage, setOgImage] = useState(null)
  const [publishedAt, setPublishedAt] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const retryTimer = useRef(null)
  const pollTimer = useRef(null)
  const cancelledRef = useRef(false)
  // Counts consecutive 202 ("generating") responses so we fast-retry a bounded
  // number of times instead of giving up after one and waiting 4h.
  const retry202Ref = useRef(0)

  const doFetch = useCallback(async () => {
    if (!enabled || !url) return
    setLoading(true)
    setError(null)
    try {
      const { status, data, ok } = await fetchAnalysisDeduped(url)
      if (status === 202) {
        setStale(true)
        // Fast-retry several times while the server generates. The old code
        // retried once then fell back to the 4h poll, so the card stuck on
        // "generating" forever even after the backend finished.
        clearTimeout(retryTimer.current)
        if (retry202Ref.current < MAX_202_RETRIES) {
          retry202Ref.current += 1
          retryTimer.current = setTimeout(() => {
            if (!cancelledRef.current) doFetch()
          }, RETRY_ON_202_MS)
        }
        return
      }
      // 404/410 = topic not published yet on upstream. Treat as "no article"
      // — leave article null, don't surface as error (UI shows skeleton/empty).
      if (status === 404 || status === 410) {
        if (!cancelledRef.current) { setArticle(null); setStale(false); retry202Ref.current = 0 }
        return
      }
      if (!ok) throw new Error(`HTTP ${status}`)
      if (cancelledRef.current) return
      retry202Ref.current = 0
      setArticle(data.article || data.body || data.text || null)
      setHeadline(data.headline || null)
      setSummary(data.summary || null)
      setOgImage(data.ogImage || null)
      setPublishedAt(data.publishedAt || data.lastUpdated || data.updatedAt || null)
      setLastUpdated(data.lastUpdated || data.updatedAt || data.generatedAt || Date.now())
      setStale(Boolean(data.stale))
    } catch (err) {
      if (cancelledRef.current) return
      console.error('[useAnalysisFetcher] failed:', err)
      setError(err.message)
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [url, enabled])

  useEffect(() => {
    cancelledRef.current = false
    if (!enabled || !url) return
    doFetch()
    pollTimer.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      doFetch()
    }, POLL_INTERVAL_MS)
    return () => {
      cancelledRef.current = true
      clearTimeout(retryTimer.current)
      clearInterval(pollTimer.current)
    }
  }, [url, enabled, doFetch])

  return { article, headline, summary, ogImage, publishedAt, lastUpdated, stale, loading, error, refetch: doFetch }
}

export function useRwaAnalysis(topic) {
  const enabled = Boolean(topic)
  const url = enabled ? `/api/rwa/analysis/${encodeURIComponent(topic)}` : null
  return useAnalysisFetcher(url, enabled)
}

export function useProtocolAnalysis(slug) {
  const enabled = Boolean(slug)
  const url = enabled ? `/api/rwa/analysis/protocol/${encodeURIComponent(slug)}` : null
  return useAnalysisFetcher(url, enabled)
}
