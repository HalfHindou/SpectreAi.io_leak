/**
 * useNextEconomicEvent - Countdown to next critical economic event
 * Computes state from a hardcoded calendar, refreshes every 60s.
 * Returns { event, nextEvent, state, countdown, label, descLine, thenStr } | null
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

export default function useNextEconomicEvent() {
  const CRITICAL_EVENTS = useMemo(() => [
    { name: 'Retail Sales', date: '2026-02-18', time: '8:30', impact: 'high' },
    { name: 'FOMC Minutes', date: '2026-02-18', time: '14:00', impact: 'critical' },
    { name: 'Jobless Claims', date: '2026-02-19', time: '8:30', impact: 'high' },
    { name: 'PMI Flash', date: '2026-02-20', time: '9:45', impact: 'high' },
    { name: 'Existing Home Sales', date: '2026-02-20', time: '10:00', impact: 'high' },
    { name: 'GDP (Q4 2nd)', date: '2026-02-26', time: '8:30', impact: 'critical' },
    { name: 'PCE Inflation', date: '2026-02-27', time: '8:30', impact: 'critical' },
    { name: 'ISM Manufacturing', date: '2026-03-02', time: '10:00', impact: 'high' },
    { name: 'NFP Jobs', date: '2026-03-06', time: '8:30', impact: 'critical' },
    { name: 'CPI Report', date: '2026-03-11', time: '8:30', impact: 'critical' },
    { name: 'PPI Report', date: '2026-03-12', time: '8:30', impact: 'high' },
    { name: 'FOMC Decision', date: '2026-03-18', time: '14:00', impact: 'critical' },
  ], [])

  const [eventState, setEventState] = useState(null)

  const computeEventState = useCallback(() => {
    const now = new Date()
    let next = null, next2 = null
    for (let i = 0; i < CRITICAL_EVENTS.length; i++) {
      const ev = CRITICAL_EVENTS[i]
      const [hh, mm] = ev.time.split(':').map(Number)
      const evDate = new Date(`${ev.date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-05:00`)
      const diffMs = evDate - now
      if (diffMs < -2 * 3600000) continue
      if (!next) { next = { ...ev, _date: evDate, _diffMs: diffMs }; continue }
      if (!next2) { next2 = { ...ev, _date: evDate, _diffMs: diffMs }; break }
    }
    if (!next) { setEventState(null); return }
    const diffMs = next._diffMs
    const diffSec = Math.max(0, Math.floor(diffMs / 1000))
    let state = 'upcoming', label = 'NEXT CATALYST'
    if (diffMs <= 0 && diffMs > -2 * 3600000) { state = 'imminent'; label = 'IN PROGRESS' }
    else if (diffSec <= 3600) { state = 'imminent'; label = 'LIVE' }
    let countdown = ''
    if (diffMs > 0) {
      if (diffSec >= 86400) { countdown = `${Math.floor(diffSec / 86400)}d ${Math.floor((diffSec % 86400) / 3600)}h` }
      else if (diffSec >= 3600) { countdown = `${Math.floor(diffSec / 3600)}h ${Math.floor((diffSec % 3600) / 60)}m` }
      else { const m = Math.floor(diffSec / 60); countdown = m > 0 ? `${m}m` : '<1m' }
    }
    const evDateObj = new Date(next.date + 'T12:00:00')
    const dayName = evDateObj.toLocaleDateString('en-US', { weekday: 'short' })
    const monthDay = evDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const [th, tm] = next.time.split(':').map(Number)
    const ampm = th >= 12 ? 'PM' : 'AM'
    const h12 = th > 12 ? th - 12 : th === 0 ? 12 : th
    const timeStr = `${h12}:${String(tm).padStart(2, '0')} ${ampm} ET`
    const impactStr = next.impact === 'critical' ? 'Critical' : 'High Impact'
    const descLine = `${dayName}, ${monthDay} · ${timeStr} · ${impactStr}`
    let thenStr = null
    if (next2) {
      const n2d = new Date(next2.date + 'T12:00:00')
      thenStr = `Then: ${next2.name} · ${n2d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    }
    setEventState({ event: next, nextEvent: next2, state, countdown, label, descLine, thenStr })
  }, [CRITICAL_EVENTS])

  // Initial computation on mount
  useEffect(() => { computeEventState() }, [computeEventState])

  useAdaptivePolling(computeEventState, { interval: 60000 })

  return eventState
}
