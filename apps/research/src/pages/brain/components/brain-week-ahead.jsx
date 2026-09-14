/**
 * BrainWeekAhead — the forward calendar the consciousness was blind to.
 *
 * The 2026-08-24 audit's top finding: the desk describes the last 24h of tape
 * while its own tables hold the week's catalysts (Jackson Hole, Nvidia, PCE).
 * This strip reads the crypto-tiered calendar (/api/calendar/economic — the
 * same re-tiering the econ board ships) and puts the next 7 days of
 * critical/high events beside the read, so the page always answers "what is
 * coming" next to "what is happening".
 *
 * Honesty rules: critical/high only, allDay events never wear a fake 00:00
 * clock, a failed fetch hides the section rather than rendering stale rows,
 * and an empty week says so in words.
 */
import React, { useEffect, useRef, useState } from 'react'
import BrainSectionHead from './brain-section-head'
import './brain-week-ahead.css'

const POLL_MS = 15 * 60_000
const DAYS = 7

function isoDay(d) {
  return d.toISOString().slice(0, 10)
}

// Marquee events the market plans its week around even when the feed tiers
// them medium (Jackson Hole ships as three medium all-day rows).
const MARQUEE_RE = /jackson hole|fomc|symposium|rate decision/i

async function fetchWeek() {
  const from = new Date()
  const to = new Date(Date.now() + DAYS * 86_400_000)
  const qs = new URLSearchParams({ from: isoDay(from), to: isoDay(to) })
  const r = await fetch(`/api/calendar/economic?${qs}`, { signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  const events = Array.isArray(j?.events) ? j.events : []
  return events
    .filter((e) => e?.dateTime && e?.name)
    .filter((e) => e.impact === 'critical' || e.impact === 'high' || MARQUEE_RE.test(e.name))
    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
}

function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  const tomorrow = new Date(today.getTime() + 86_400_000)
  if (sameDay(d, tomorrow)) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function timeLabel(e) {
  // an exact-midnight UTC stamp is a date wearing a clock — never print it as
  // a release time (the tvIsAllDay lesson)
  if (e.allDay || /T00:00:00(\.000)?Z$/.test(String(e.dateTime))) return 'All day'
  const d = new Date(e.dateTime)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function BrainWeekAhead() {
  const [events, setEvents] = useState(null) // null = loading, [] = loaded empty
  const [failed, setFailed] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    const load = async () => {
      try {
        const evs = await fetchWeek()
        if (!cancelled.current) { setEvents(evs); setFailed(false) }
      } catch {
        // Keep whatever we already showed; only hide when we never loaded.
        if (!cancelled.current) setFailed(true)
      }
    }
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    return () => { cancelled.current = true; clearInterval(timer) }
  }, [])

  if (events == null) return failed ? null : <div className="bwa bwa--loading" aria-hidden><div className="sk" /><div className="sk" /></div>

  const days = []
  for (const e of events) {
    const k = dayKey(e.dateTime)
    const last = days[days.length - 1]
    if (last && last.key === k) last.events.push(e)
    else days.push({ key: k, label: dayLabel(e.dateTime), today: dayLabel(e.dateTime) === 'Today', events: [e] })
  }

  return (
    <section className="bwa" aria-label="the week ahead">
      <BrainSectionHead
        eyebrow="Catalysts"
        title="The week ahead"
        sub="high-impact events, tiered by crypto relevance"
      />
      {days.length === 0 ? (
        <p className="bwa-empty">No high-impact events on the calendar for the next 7 days.</p>
      ) : (
        <div className="bwa-days">
          {days.map((d) => (
            <div key={d.key} className={`bwa-day${d.today ? ' bwa-day--today' : ''}`}>
              <span className="bwa-day-label">{d.label}</span>
              <ul className="bwa-list">
                {d.events.map((e) => (
                  <li key={e.id || `${e.name}-${e.dateTime}`} className={`bwa-ev bwa-ev--${e.impact}`}>
                    <span className="bwa-ev-time">{timeLabel(e)}</span>
                    <span className="bwa-ev-dot" aria-hidden />
                    <span className="bwa-ev-name">
                      {e.nameShort || e.name}
                      {e.isFedEvent && <span className="bwa-ev-tag">Fed</span>}
                    </span>
                    {e.currency && e.currency !== 'USD' && <span className="bwa-ev-ccy">{e.currency}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
