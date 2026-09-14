/**
 * useCalendarData Hook
 * Fetches economic calendar events from real API with mock data fallback.
 * Polls every 60s normally, every 15s during critical event windows.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getPendingBundle } from './useCalendarBundle'
import { MOCK_EVENTS } from '../data/mockEvents'

const POLL_NORMAL_MS = 60000               // 60 seconds
const POLL_CRITICAL_MS = 15000             // 15 seconds
const CRITICAL_WINDOW_MS = 30 * 60 * 1000  // ±30 minutes

// Module-level in-flight + short-cache dedup keyed by exact URL. The calendar
// page mounts useCalendarData and fires fetchEvents()/fetchAnalysis() on mount;
// StrictMode double-mounts, fast remounts, and concurrent identical requests
// would otherwise each hit the network for the SAME /api/calendar/* URL
// (economic ~120KB, analysis). This collapses identical concurrent/just-fetched
// reads onto one response. Different windows (small vs widened) keep distinct
// URLs and are NOT deduped against each other — that two-phase prefetch is
// intentional.
const _calInflight = new Map()   // url -> Promise<json>
const _calCache = new Map()      // url -> { json, ts }
const _CAL_DEDUP_TTL = 5000      // 5s: long enough to catch mount-time dupes

export async function fetchCalendarJson(url, { ttl = _CAL_DEDUP_TTL } = {}) {
  const cached = _calCache.get(url)
  if (cached && Date.now() - cached.ts < ttl) return cached.json
  if (_calInflight.has(url)) return _calInflight.get(url)
  const promise = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`API ${res.status}`)
      const json = await res.json()
      _calCache.set(url, { json, ts: Date.now() })
      return json
    })
    .finally(() => { _calInflight.delete(url) })
  _calInflight.set(url, promise)
  return promise
}

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Check if any critical event is within ±30 minutes of now
 */
function isInCriticalWindow(events) {
  const now = Date.now()
  return events.some((e) => {
    if (e.impact !== 'critical') return false
    const eventTime = new Date(e.dateTime).getTime()
    return Math.abs(eventTime - now) <= CRITICAL_WINDOW_MS
  })
}

// Module-scope mock enrichment lookup — built once, not on every fetch.
// Previously: O(N*M) toLowerCase().includes() search ran on each poll.
const MOCK_BY_SHORT_NAME = (() => {
  const map = new Map()
  for (const m of MOCK_EVENTS) {
    const key = (m.nameShort || m.name || '').toLowerCase().trim()
    if (key && !map.has(key)) map.set(key, m)
  }
  return map
})()

function findMockMatch(apiEvent) {
  const shortKey = (apiEvent.nameShort || '').toLowerCase().trim()
  if (shortKey && MOCK_BY_SHORT_NAME.has(shortKey)) return MOCK_BY_SHORT_NAME.get(shortKey)
  // Try both `name` and `title` — the Spectre /v1/calendar payload uses
  // `title`, while older mock/faireconomy events use `name`. Without `title`
  // every API event would have nameKey='' and the loop below would match the
  // FIRST mock entry via `mockKey.includes('')` being always true in JS —
  // hence the 2026-05-26 bug where every day's cell rendered as "CPI 2.4%".
  const nameKey = (apiEvent.name || apiEvent.title || '').toLowerCase().trim()
  if (!nameKey) return null
  for (const [mockKey, mock] of MOCK_BY_SHORT_NAME) {
    if (!mockKey) continue
    if (nameKey.includes(mockKey) || mockKey.includes(nameKey)) return mock
  }
  return null
}

// Apply mock enrichment to raw API events. Extracted so both the polling
// fetch path and the bundle seed path produce the same normalized shape.
//
// CRITICAL: actual/previous/forecast come from the API ONLY. The previous
// `apiEvent.actual || mockMatch.actual` pattern leaked the mock's stale
// historical values into every matched API event — e.g. May 19 Canadian
// "Core CPI m/m" (actual=null, release pending) inherited the January US
// CPI mock's actual="2.4", rendering "CPI 2.4%" on the cell as if Canadian
// CPI had been released. The mock provides analysis/history/category
// context only — never live values. Same for name/nameShort: prefer the
// API's (mockMatch may be a different-month version of the same release).
function normalizeApiEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return []
  const out = rawEvents.map((apiEvent) => {
    const mockMatch = findMockMatch(apiEvent)
    if (mockMatch) {
      // API wins on EVERYTHING it provides — identity, schedule, live values,
      // impact, country, event_type. The previous `...mockMatch` base leaked
      // the mock's `impact: 'critical'` and `country: 'US'` into every
      // matched event: EU "CPI Flash" name-matched the US CPI mock and
      // rendered as the NEXT CRITICAL card with a US flag (2026-06-11).
      // The mock contributes analysis/history/cryptoImpact context only.
      return {
        ...mockMatch,
        ...apiEvent,
        actual: apiEvent.actual ?? null,
        previous: apiEvent.previous ?? null,
        forecast: apiEvent.forecast ?? null,
        unit: apiEvent.unit ?? mockMatch.unit ?? null,
        description: apiEvent.description || mockMatch.description || '',
        analysis: mockMatch.analysis ?? null,
        cryptoImpact: mockMatch.cryptoImpact ?? null,
        history: mockMatch.history ?? [],
        fedDecision: mockMatch.fedDecision ?? null,
        source: 'api',
      }
    }
    return {
      ...apiEvent,
      analysis: null,
      cryptoImpact: null,
      history: [],
      fedDecision: null,
    }
  })
  out.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
  return out
}

// Count macro-layer rows in a RAW api payload (before mock enrichment, which
// drops event_type/source). Used by the degradation guard below: when the
// upstream's TradingView fetch partially fails, the response still has crypto
// events (length > 0) but the macro backbone is gone — replacing state with
// it blanks the month grid that was already rendered.
function countMacroEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return 0
  let n = 0
  for (const e of rawEvents) {
    if (e && (e.event_type === 'macro' || e.source === 'tradingview' || e.source === 'faireconomy')) n++
  }
  return n
}

// Fingerprint an events array so we can skip setEvents when nothing changed.
// Polls every 60s return fresh object refs even when the data is identical,
// which otherwise re-renders the whole month grid for no reason.
function fingerprintEvents(events) {
  if (!Array.isArray(events)) return ''
  const parts = new Array(events.length)
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    parts[i] = `${e.id}|${e.actual ?? ''}|${e.forecast ?? ''}|${e.previous ?? ''}`
  }
  return parts.join(',')
}

// Months of buffer to fetch around the currently-viewed date.
// Window covers [viewMonth - BACK, viewMonth + FORWARD].
// Refetch when the viewed month moves outside the inner zone.
//
// First paint uses the SMALL window (±1 month) so cold load is fast.
// After the chart is on screen we kick off a background fetch for the
// LARGE window so navigation forward/back stays instant.
const SMALL_WINDOW_BACK = 1
const SMALL_WINDOW_FORWARD = 1
const FULL_WINDOW_BACK = 3
const FULL_WINDOW_FORWARD = 9
const REFETCH_TRIGGER_BACK = 1
const REFETCH_TRIGGER_FORWARD = 6

function monthDiff(a, b) {
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth())
}

export default function useCalendarData(viewDate, opts = {}) {
  // Optional bundle seed — when the page kicks off the bundle endpoint, it
  // can pass the pre-fetched events + analysis here so the hook skips its
  // own first round-trip. Polling continues as normal.
  const { initialEvents, initialAnalysis } = opts
  const hasSeededEvents = Array.isArray(initialEvents) && initialEvents.length > 0
  const hasSeededAnalysis = Boolean(initialAnalysis)
  // Bundle opt-in: only the economic-calendar page wires this hook to the
  // bundle (it always passes the `initialEvents` key, even as undefined on the
  // first render). The home calendar panels pass no opts — they must keep their
  // original immediate cold fetch and never defer to a stale module-level
  // bundle promise from a previous page visit. Captured once.
  const usesBundleRef = useRef('initialEvents' in opts)
  // Run mock enrichment on the seed once at construction so the rest of the
  // hook treats seed and polled data identically.
  const seedNormalized = useMemo(
    () => hasSeededEvents ? normalizeApiEvents(initialEvents) : [],
    [hasSeededEvents, initialEvents]
  )
  // Start empty — was seeding with MOCK_EVENTS which would render fabricated
  // "actual" values for past events if the live fetch failed. MOCK_EVENTS is
  // still imported for enrichment lookups (findMockMatch) but no longer
  // shipped to the UI as initial state.
  const [events, setEvents] = useState(seedNormalized)
  const [loading, setLoading] = useState(!hasSeededEvents)
  const [source, setSource] = useState(hasSeededEvents ? 'api' : 'loading')
  const [analysis, setAnalysis] = useState(hasSeededAnalysis ? initialAnalysis : null)
  const [analysisLoading, setAnalysisLoading] = useState(!hasSeededAnalysis)
  const pollRef = useRef(null)
  const mountedRef = useRef(true)
  const fingerprintRef = useRef(seedNormalized.length > 0 ? fingerprintEvents(seedNormalized) : '')
  const fetchCenterRef = useRef(null)
  // Last accepted healthy payload: { windowKey, total, macroCount }. windowKey
  // is null for the bundle seed (its from/to differs from the poll window).
  // The degradation guard compares fresh polls against this instead of
  // blindly trusting any non-empty response.
  const lastGoodRef = useRef(
    hasSeededEvents
      ? { windowKey: null, total: initialEvents.length, macroCount: countMacroEvents(initialEvents) }
      : null
  )
  // Treat the seed as the first fetch — skips the wider initial fetch path.
  const hasFetchedRef = useRef(hasSeededEvents)
  const viewDateRef = useRef(viewDate)
  viewDateRef.current = viewDate

  const fetchEvents = useCallback(async (opts = {}) => {
    const isFirstFetch = !hasFetchedRef.current
    const { background = false } = opts
    try {
      // Always try API first - mock data is fallback only
      // Only show loading on the initial fetch. Background polls must not
      // toggle loading or the views unmount/remount on every tick.
      if (isFirstFetch && !background) setLoading(true)
      // Bounded window centered on the currently-viewed month. The upstream
      // returns 10K+ events / ~11 MB if unfiltered, which freezes parsing and
      // every downstream computation on the welcome page calendar tab.
      //
      // First paint uses a tight ±1-month window so cold load is fast.
      // Once data is on screen we trigger a background fetch with the wider
      // window so paging months stays instant.
      const center = viewDateRef.current instanceof Date ? viewDateRef.current : new Date()
      fetchCenterRef.current = new Date(center.getFullYear(), center.getMonth(), 1)
      const back = (isFirstFetch && !background) ? SMALL_WINDOW_BACK : FULL_WINDOW_BACK
      const forward = (isFirstFetch && !background) ? SMALL_WINDOW_FORWARD : FULL_WINDOW_FORWARD
      const from = new Date(center.getFullYear(), center.getMonth() - back, 1)
      const to = new Date(center.getFullYear(), center.getMonth() + forward + 1, 0)
      const params = new URLSearchParams({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      })
      const data = await fetchCalendarJson(`/api/calendar/economic?${params}`)

      if (data.events && data.events.length > 0 && mountedRef.current) {
        // Degradation guard: never replace a healthy event set with a
        // collapsed one for the same window. When the upstream's TV fetch
        // partially fails, the response keeps crypto events (so length > 0)
        // but loses the macro backbone — accepting it blanks the rendered
        // grid until the next healthy poll. Same-window comparison only:
        // navigating months legitimately changes the event population.
        const windowKey = `${params.get('from')}|${params.get('to')}`
        const macroCount = countMacroEvents(data.events)
        const prev = lastGoodRef.current
        const sameWindow = prev && (prev.windowKey === windowKey || prev.windowKey === null)
        const macroCollapsed = sameWindow && macroCount === 0 && prev.macroCount >= 25
        const totalCollapsed = prev && prev.windowKey === windowKey &&
          prev.total >= 100 && data.events.length < prev.total * 0.3
        if (macroCollapsed || totalCollapsed) {
          console.warn(
            `[useCalendarData] rejected degraded poll (macro ${macroCount} vs ${prev.macroCount}, ` +
            `total ${data.events.length} vs ${prev.total}) — keeping last good set`
          )
        } else {
          lastGoodRef.current = { windowKey, total: data.events.length, macroCount }
          // Merge API events with mock data enrichment (analysis, history,
          // crypto impact). API events have real-time actual values; mock
          // data provides the rich detail. Shared with the bundle seed path.
          const apiEvents = normalizeApiEvents(data.events)

          // Only trigger a re-render when the payload actually changed.
          const nextFingerprint = fingerprintEvents(apiEvents)
          if (nextFingerprint !== fingerprintRef.current) {
            fingerprintRef.current = nextFingerprint
            setEvents(apiEvents)
          }
          setSource('api')
        }
      }
      hasFetchedRef.current = true
    } catch (err) {
      // API fetch failed. Don't silently swap to mock data — render the
      // page empty so the user sees no events instead of fabricated ones.
      if (mountedRef.current && source !== 'api') {
        setSource('error')
      }
    } finally {
      if (mountedRef.current && isFirstFetch && !background) setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch market analysis from /api/calendar/analysis
  const fetchAnalysis = useCallback(async () => {
    const isFirstAnalysis = analysisLoading
    try {
      // Always try API first
      // Only show loading shimmer on first fetch — polls must not flicker.
      if (isFirstAnalysis) setAnalysisLoading(true)
      const data = await fetchCalendarJson('/api/calendar/analysis')
      if (mountedRef.current && data?.analysis) {
        setAnalysis(data.analysis)
      } else {
        throw new Error('No analysis data')
      }
    } catch (err) {
      // silently handled
      // No hardcoded fallback: analysis stays null, UI shows shimmer then empty state
    } finally {
      if (mountedRef.current && isFirstAnalysis) setAnalysisLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch on mount. Skip the initial events fetch when the bundle already
  // seeded data — polling still runs via useAdaptivePolling below.
  //
  // COLD-RACE FIX: when this hook mounts with no seed yet (bundle still
  // in-flight on the same tick), we used to fire /economic + /analysis
  // immediately — so a cold load cost ~3 requests instead of 1. Instead, if a
  // bundle fetch is pending (`getPendingBundle()`), wait for it: when it
  // resolves with that slice, the adopt effects below seed from the props and
  // we never hit the individual endpoint. Only fire the standalone fetch for a
  // slice the bundle did NOT supply, or when no bundle is pending at all (the
  // hook used outside the calendar page). The poll path is untouched.
  useEffect(() => {
    mountedRef.current = true
    if (hasSeededEvents) {
      // Mirror the post-fetch ref so the navigate-out-of-window guard works.
      const center = viewDateRef.current instanceof Date ? viewDateRef.current : new Date()
      fetchCenterRef.current = new Date(center.getFullYear(), center.getMonth(), 1)
    }

    const pending = usesBundleRef.current ? getPendingBundle() : null
    if (pending && (!hasSeededEvents || !hasSeededAnalysis)) {
      // Defer the cold fetch to the bundle. Only fetch the slices the bundle
      // turns out NOT to provide. `hasFetchedRef`/`analysisLoading` are read at
      // resolve time so a fast bundle that arrives via props first wins.
      pending.then((bundleJson) => {
        if (!mountedRef.current) return
        const bundleHasEvents = Array.isArray(bundleJson?.events) && bundleJson.events.length > 0
        const bundleHasAnalysis = Boolean(bundleJson?.analysis?.analysis)
        // Events: if the bundle had none AND nothing seeded us in the meantime,
        // do the standalone first fetch.
        if (!bundleHasEvents && !hasFetchedRef.current) fetchEvents()
        // Analysis: same — only if the bundle didn't carry it and we're still
        // on the first-load shimmer.
        if (!bundleHasAnalysis && analysisLoading) fetchAnalysis()
      })
    } else {
      // No bundle pending (standalone use) — original cold-load behavior.
      if (!hasSeededEvents) fetchEvents()
      if (!hasSeededAnalysis) fetchAnalysis()
    }

    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEvents, fetchAnalysis])

  // Adopt bundle data when it arrives after mount (bundle resolves async).
  useEffect(() => {
    if (!hasSeededEvents) return
    if (!loading && events.length > 0) return
    const normalized = normalizeApiEvents(initialEvents)
    if (normalized.length === 0) return
    const fp = fingerprintEvents(normalized)
    if (fp === fingerprintRef.current) return
    fingerprintRef.current = fp
    lastGoodRef.current = { windowKey: null, total: initialEvents.length, macroCount: countMacroEvents(initialEvents) }
    setEvents(normalized)
    setSource('api')
    setLoading(false)
    hasFetchedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEvents])

  useEffect(() => {
    if (!hasSeededAnalysis) return
    setAnalysis(initialAnalysis)
    setAnalysisLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnalysis])

  // After first paint, widen the cached window in the background so paging
  // months stays instant. Runs once, on idle, after initial events arrive.
  const widenedRef = useRef(false)
  useEffect(() => {
    if (widenedRef.current) return
    if (loading) return
    if (events.length === 0 && source !== 'api') return
    widenedRef.current = true
    const schedule = typeof window !== 'undefined' && window.requestIdleCallback
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => setTimeout(cb, 800)
    const id = schedule(() => {
      if (!mountedRef.current) return
      fetchEvents({ background: true })
    })
    return () => {
      if (typeof window !== 'undefined' && window.cancelIdleCallback && typeof id === 'number') {
        window.cancelIdleCallback(id)
      } else {
        clearTimeout(id)
      }
    }
  }, [loading, events.length, source, fetchEvents])

  // Refetch when user navigates outside the prefetched window.
  useEffect(() => {
    if (!(viewDate instanceof Date) || !fetchCenterRef.current) return
    const diff = monthDiff(viewDate, fetchCenterRef.current)
    if (diff < -REFETCH_TRIGGER_BACK || diff > REFETCH_TRIGGER_FORWARD) {
      fetchEvents()
    }
  }, [viewDate, fetchEvents])

  // Poll analysis every 60 seconds
  useAdaptivePolling(fetchAnalysis, { interval: POLL_NORMAL_MS })

  // Adaptive polling for events — faster during critical windows
  const eventsInterval = useMemo(
    () => isInCriticalWindow(events) ? POLL_CRITICAL_MS : POLL_NORMAL_MS,
    [events]
  )

  useAdaptivePolling(fetchEvents, { interval: eventsInterval })

  // Query methods
  const getEventsForDate = useCallback(
    (date) => {
      const target = date instanceof Date ? date : new Date(date)
      return events.filter((e) => isSameDay(new Date(e.dateTime), target))
    },
    [events]
  )

  const getEventsForWeek = useCallback(
    (date) => {
      const monday = getMonday(date instanceof Date ? date : new Date(date))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      sunday.setHours(23, 59, 59, 999)

      return events.filter((e) => {
        const t = new Date(e.dateTime).getTime()
        return t >= monday.getTime() && t <= sunday.getTime()
      })
    },
    [events]
  )

  const getEventsForMonth = useCallback(
    (date) => {
      const d = date instanceof Date ? date : new Date(date)
      const year = d.getFullYear()
      const month = d.getMonth()

      return events.filter((e) => {
        const eDate = new Date(e.dateTime)
        return eDate.getFullYear() === year && eDate.getMonth() === month
      })
    },
    [events]
  )

  const getNextCriticalEvent = useCallback(() => {
    const now = Date.now()
    return (
      events.find(
        (e) =>
          e.impact === 'critical' &&
          new Date(e.dateTime).getTime() > now &&
          (e.actual === null || e.actual === undefined)
      ) || null
    )
  }, [events])

  // Upcoming surfaces (ticker pills + UPCOMING rail) are macro-movers only.
  // Letting every medium-tier governance proposal through buried the real
  // releases under DAO vote spam ("おはよう: test" as a countdown pill,
  // 2026-06-11). Crypto-native events stay in the grid/day views, where
  // filters control them.
  const getUpcomingEvents = useCallback(
    (count = 5) => {
      const now = Date.now()
      return events
        .filter(
          (e) =>
            (e.impact === 'critical' || e.impact === 'high') &&
            (e.event_type ? e.event_type === 'macro' : !e.isCrypto) &&
            new Date(e.dateTime).getTime() > now &&
            (e.actual === null || e.actual === undefined)
        )
        .slice(0, count)
    },
    [events]
  )


  return {
    events,
    loading,
    source,
    analysis,
    analysisLoading,
    getEventsForDate,
    getEventsForWeek,
    getEventsForMonth,
    getNextCriticalEvent,
    getUpcomingEvents,
    refetch: fetchEvents,
    refetchAnalysis: fetchAnalysis,
  }
}
