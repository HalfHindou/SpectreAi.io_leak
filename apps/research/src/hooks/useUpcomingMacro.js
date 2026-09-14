// Upcoming top-tier macro events for the Why surfaces — the "Fed decision in
// 1h" awareness layer.
//
// Source is the app's own economic calendar (/api/calendar/economic, the
// TradingView backbone) because its rows carry a REAL release clock. The box
// /v1/macro/calendar serves midnight day-markers — the exact row class that
// published the FOMC decision 18h early on 2026-07-29. Never build a countdown
// on a row whose time is 00:00.
//
// A scheduled event is announced, never resolved: this hook carries WHEN, and
// deliberately nothing about outcomes.
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const TTL = 10 * 60_000
// after the scheduled minute the event stays as "landing now" for a short
// grace, then yields. 25 min, not 45: the Fed presser starts 30 min after the
// decision, and the decision must hand over before it.
const GRACE = 25 * 60_000

let _cache = { rows: null, ts: 0 }
let _inflight = null

const dstr = (d) => d.toISOString().slice(0, 10)

const CB = { US: 'Fed', GB: 'BoE', EU: 'ECB', JP: 'BoJ', CN: 'PBoC', CH: 'SNB', CA: 'BoC', AU: 'RBA' }

// headline-length names — these end up inside a sentence ("waiting on the …")
function shortName(ev) {
  const n = ev.name
  if (ev.isFed && /press conference/i.test(n)) return 'Fed press conference'
  if (ev.isFed && /interest rate|rate decision/i.test(n)) return 'Fed rate decision'
  if (/interest rate decision|rate decision/i.test(n)) return `${CB[ev.country] || ev.country} rate decision`
  if (/\bcpi\b|consumer price/i.test(n)) return `${ev.country} CPI print`
  if (/non.?farm|payrolls/i.test(n)) return 'US jobs report'
  if (/unemployment rate/i.test(n)) return 'US unemployment print'
  if (/\bgdp\b/i.test(n)) return `${ev.country} GDP print`
  if (/\bpce\b/i.test(n)) return 'US PCE print'
  return n.length > 34 ? `${n.slice(0, 32)}…` : n
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60e3)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

async function fetchRows() {
  if (_cache.rows && Date.now() - _cache.ts < TTL) return _cache.rows
  if (_inflight) return _inflight
  const from = new Date(Date.now() - 6 * 3600e3)
  const to = new Date(Date.now() + 48 * 3600e3)
  _inflight = fetch(`/api/calendar/economic?from=${dstr(from)}&to=${dstr(to)}`, { signal: AbortSignal.timeout(12_000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const rows = (Array.isArray(j?.events) ? j.events : [])
        .map((e) => ({
          at: Date.parse(e.dateTime),
          name: String(e.name || ''),
          impact: String(e.impact || ''),
          country: String(e.country || ''),
          isFed: !!e.isFedEvent,
          type: String(e.event_type || 'macro'),
        }))
        .filter((e) => Number.isFinite(e.at) && e.name)
        // 🪤 midnight rows are day-markers with no release clock — the class
        // that fired FOMC 18h early. They never earn a countdown.
        .filter((e) => e.at % 86400e3 !== 0)
        // top-tier scheduled macro only: critical anywhere, anything Fed, or a
        // high-impact US print / any central-bank rate decision. DAO votes and
        // token unlocks ride the same feed — they never earn the chip.
        .filter((e) => e.type === 'macro' || e.isFed)
        .filter((e) => e.impact === 'critical' || e.isFed
          || (e.impact === 'high' && (e.country === 'US' || /\brate decision\b/i.test(e.name))))
        .sort((a, b) => a.at - b.at)
      _cache = { rows, ts: Date.now() }
      return rows
    })
    .catch(() => _cache.rows || [])
    .finally(() => { _inflight = null })
  return _inflight
}

export default function useUpcomingMacro() {
  const [rows, setRows] = useState(_cache.rows || [])
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => { setRows(await fetchRows()) }, [])
  useEffect(() => { load() }, [load])
  useAdaptivePolling(load, { interval: TTL })

  // countdown tick — re-render only, no network
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 30_000)
    return () => clearInterval(t)
  }, [])

  const upcoming = rows.filter((e) => e.at > now - GRACE)
  const raw = upcoming[0] || null
  let next = null
  if (raw) {
    const msTo = raw.at - now
    // a Fed / critical event owns the whole day's tape; an ordinary high print
    // only earns attention inside a short runway
    const horizon = raw.impact === 'critical' || raw.isFed ? 24 * 3600e3 : 8 * 3600e3
    if (msTo <= horizon) {
      next = { ...raw, msTo, phase: msTo > 0 ? 'soon' : 'now', short: shortName(raw), countdown: fmtCountdown(msTo) }
    }
  }
  return { next }
}
