// Why Mode (/why) — the data brain.
// Answers the anxious trader's ONE question: is this move my coin's problem,
// everyone's problem, or nobody-knows? Two feeds, both deterministic and
// already gated server-side (see the box market-event-recorder: liquidation
// unit artifacts quarantined, self-describing headlines and rhetoric
// rejected) — this hook renders, it never re-filters.
//
//   getSpectreMarketState     — the market half of the consciousness fuse:
//                               divergence verdict, session, tape vs previous
//                               session close, pinned positioning, the read
//   getSpectreMarketTimeline  — market_events: the day's sequencing. `at` is
//                               when the MARKET did it; `backfilled` rows are
//                               history, never breaking.
import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import {
  getSpectreMarketState, getSpectreMarketTimeline, getSpectreOhlcv,
  getSpectreMarketDays, getSpectreDailyCloses,
} from '@/services/spectreMarketApi'

// `rows` = how many events to ask the box for. The recorder writes ~170/day
// across the four lanes, so each window asks for roughly 2x its own expected
// volume — enough headroom that a busy session still arrives whole.
// 🪤 This is not cosmetic. The box caps the response, and until 2026-08-03 that
// cap kept the OLDEST rows: 7D asked for a week, got the first 500 events of
// it, and rendered a timeline whose newest entry was three days old on a
// perfectly healthy pipeline. The box now keeps the NEWEST N — so the failure
// mode is bounded (you lose old history, never the present) — but a window that
// under-asks still silently shortens itself. Size these to the window.
export const WINDOWS = [
  { key: '6', hours: 6, label: '6H', rows: 300 },
  { key: '24', hours: 24, label: '24H', rows: 500 },
  { key: '48', hours: 48, label: '2D', rows: 800 },
  { key: '168', hours: 168, label: '7D', rows: 2000 },
  // DAYS (2026-08-05) is a different SHAPE, not a longer window. The lanes
  // above answer "what happened since this morning" as an event stream, which
  // is the right form at 03:00 with a position on. It cannot answer "walk me
  // through this week": ~130 events/day means 30 days is ~3,900 rows, and no
  // amount of scrolling makes that a story. So this window renders day CARDS —
  // each one a close, a move, and the handful of things that defined it.
  // Additive on purpose: every existing window keeps its exact behaviour.
  { key: 'days', days: 30, label: '30D', mode: 'days' },
]

export const DAYS_WINDOW = WINDOWS.find((w) => w.mode === 'days')

// No new gated event for this long and the page stops calling itself LIVE. It
// does NOT claim the feed broke — a genuinely dead tape looks identical from
// here — it just refuses to present hours-old events as the current moment.
export const STALE_AFTER_MS = 90 * 60_000

export const LANES = [
  { key: 'all', label: 'Everything' },
  { key: 'price', label: 'Price' },
  { key: 'macro', label: 'US Tape' },
  { key: 'flow', label: 'Forced Flow' },
  { key: 'news', label: 'Headlines' },
]

// 🪤 90s, not 60s. The state + ohlcv service calls are cached for 60s, so a
// 60s poll landed exactly on the TTL edge and missed the cache every single
// time — the "interval == TTL defeats dedup" pattern the api-optimization plan
// already documents on three other surfaces. 90s clears it.
const REFRESH_MS = 90_000
// The session map is 15m BTC candles. Re-pulling those on the fast tick was
// pure waste, AND that one endpoint is the uncached 17-18s /ohlcv route, so it
// gets its own slow poll instead of riding the timeline's.
const BARS_REFRESH_MS = 5 * 60_000

export default function useWhy() {
  const [state, setState] = useState(null)
  const [events, setEvents] = useState([])
  const [bars, setBars] = useState([])
  const [hours, setHours] = useState(24)
  const [lane, setLane] = useState('all')
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [truncated, setTruncated] = useState(false)
  // `hours === null` selects the day-cards window. Kept out of `hours` rather
  // than overloaded onto it so no existing consumer can read a sentinel number
  // as a real lookback.
  const [dayCards, setDayCards] = useState(null)
  const [daysLoading, setDaysLoading] = useState(false)
  const hoursRef = useRef(hours)
  useEffect(() => { hoursRef.current = hours }, [hours])
  const daysMode = hours === null

  const load = useCallback(async (h) => {
    const rows = (WINDOWS.find((w) => w.hours === h) || {}).rows || 500
    const [s, ev] = await Promise.all([
      getSpectreMarketState().catch(() => null),
      getSpectreMarketTimeline({ hours: h, limit: rows }).catch(() => []),
    ])
    if (s) setState(s)
    setEvents(ev)
    // We asked for `rows` and got `rows` back => the window holds more than we
    // carried, and what the box dropped is the OLD end. Say so rather than let
    // a clipped window read as a complete one.
    setTruncated(ev.length >= rows)
    setUpdatedAt(Date.now())
    setLoading(false)
  }, [])

  // The day digest + the daily closes it joins against. Fired in PARALLEL: the
  // events are the card and the price is a column on it, so serialising them
  // would make the whole view wait on the slower of two independent reads.
  //
  // A missing close does NOT withhold the card — the events are the story and
  // the price is context. It renders without the move rather than not at all.
  const loadDays = useCallback(async () => {
    setDaysLoading(true)
    const [digest, closes] = await Promise.all([
      getSpectreMarketDays({ days: DAYS_WINDOW.days, perDay: 8 }).catch(() => null),
      getSpectreDailyCloses('BTC', '30d').catch(() => new Map()),
    ])
    if (digest) {
      setDayCards({
        oldest: digest.oldest,
        days: digest.days.map((d) => ({ ...d, price: closes.get(d.date) || null })),
      })
      setUpdatedAt(Date.now())
    }
    setDaysLoading(false)
  }, [])

  const loadBars = useCallback(async () => {
    // 15m bars cover ~50h, enough for every window up to 2D; longer windows
    // just show the tail.
    const b = await getSpectreOhlcv('BTC', '15m', '24h').catch(() => [])
    if (b.length) setBars(b)
    return b.length
  }, [])

  // 🪤 /v1/prices/BTC/ohlcv is uncached on the box: ~16s cold, 0.1s warm. One
  // slow spell past the 30s ceiling trips the service-layer failure cooldown,
  // and with nothing stale to serve on a cold session `bars` stays empty — the
  // session map, reversal watch and chapters strip all vanish and the next
  // attempt is a FULL 5 MINUTES away (BARS_REFRESH_MS). That is why the panels
  // "disappeared" rather than flickered. One bounded retry, spaced past the
  // 15s base cooldown, turns a transient miss into a ~20s delay instead.
  const retryBars = useCallback(async () => {
    if (await loadBars()) return
    setTimeout(() => { loadBars() }, 20_000)
  }, [loadBars])

  useEffect(() => {
    // The day view is its own fetch — do NOT drag a 30-day event stream over
    // the wire to render cards the box already aggregated.
    if (daysMode) { loadDays(); return }
    setLoading(true)
    load(hours)
  }, [hours, daysMode, load, loadDays])

  useEffect(() => { retryBars() }, [retryBars])

  // Both polls are visibility- and idle-guarded: this page used to run a bare
  // setInterval that fired three requests a minute forever on a hidden tab.
  // 🪤 The live poll must not fire in day mode — `hoursRef` still holds the
  // last real window, so an unguarded tick would quietly refetch a 7D event
  // stream nothing is rendering, every 90 seconds, for as long as the day view
  // is open.
  useAdaptivePolling(
    useCallback(() => { if (hoursRef.current != null) load(hoursRef.current) }, [load]),
    { interval: REFRESH_MS },
  )
  useAdaptivePolling(loadBars, { interval: BARS_REFRESH_MS })

  const filtered = lane === 'all' ? events : events.filter((e) => e.lane === lane)

  // The freshness of the FEED, not of the request. `updatedAt` only says we
  // polled; it stays green while the tape underneath it goes hours old, which
  // is exactly how a stale timeline passed for a live one. Read the newest
  // event instead — unfiltered, so picking a quiet lane can't fake staleness.
  const newestAt = events.length ? events[events.length - 1].at : null
  const staleBy = newestAt ? Date.now() - newestAt : null
  const stale = staleBy != null && staleBy > STALE_AFTER_MS

  return {
    state, events: filtered, allEvents: events, allCount: events.length,
    bars, retryBars, hours, setHours, lane, setLane, loading, updatedAt,
    newestAt, staleBy, stale, truncated,
    daysMode, dayCards, daysLoading,
  }
}
