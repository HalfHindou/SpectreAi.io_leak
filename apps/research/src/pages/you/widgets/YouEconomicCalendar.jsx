/**
 * YouEconomicCalendar — Upcoming macro events with impact filters.
 * Shows country flag, event title, date/time, and impact severity pill.
 * Fetches from /api/calendar/economic with auto-refresh every 5 minutes.
 * Supports remix modes: timeline (default), compact, agenda.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const CALENDAR_API_URL = '/api/calendar/economic'
const REMIX_KEY = 'spectre:you-remix-calendar'
const REMIX_MODES = ['timeline', 'compact', 'agenda']

function isLocalViteDev() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

const COUNTRY_FLAGS = {
  US: '\u{1F1FA}\u{1F1F8}', USA: '\u{1F1FA}\u{1F1F8}',
  EU: '\u{1F1EA}\u{1F1FA}', EMU: '\u{1F1EA}\u{1F1FA}',
  JP: '\u{1F1EF}\u{1F1F5}', JPN: '\u{1F1EF}\u{1F1F5}',
  GB: '\u{1F1EC}\u{1F1E7}', GBR: '\u{1F1EC}\u{1F1E7}', UK: '\u{1F1EC}\u{1F1E7}',
  CN: '\u{1F1E8}\u{1F1F3}', CHN: '\u{1F1E8}\u{1F1F3}',
  AU: '\u{1F1E6}\u{1F1FA}', AUS: '\u{1F1E6}\u{1F1FA}',
  CA: '\u{1F1E8}\u{1F1E6}', CAN: '\u{1F1E8}\u{1F1E6}',
  DE: '\u{1F1E9}\u{1F1EA}', DEU: '\u{1F1E9}\u{1F1EA}',
  CH: '\u{1F1E8}\u{1F1ED}', CHE: '\u{1F1E8}\u{1F1ED}',
  NZ: '\u{1F1F3}\u{1F1FF}', NZL: '\u{1F1F3}\u{1F1FF}',
}

function getFlag(country) {
  if (!country) return '\u{1F30D}'
  return COUNTRY_FLAGS[country.toUpperCase()] || COUNTRY_FLAGS[country] || '\u{1F30D}'
}

function mapImpact(impact) {
  if (!impact) return 'low'
  const val = typeof impact === 'number' ? impact : (typeof impact === 'string' ? impact.toLowerCase() : 0)
  if (val === 3 || val === 'critical' || val === 'high') return (val === 3 || val === 'critical') ? 'critical' : 'high'
  if (val === 2 || val === 'medium') return 'medium'
  if (val === 1 || val === 'low') return 'low'
  // Numeric thresholds from API
  if (typeof val === 'number') {
    if (val >= 3) return 'critical'
    if (val >= 2) return 'high'
    if (val >= 1) return 'medium'
  }
  return 'low'
}

// 2026-05-26 beta-quality fix: removed 10 fake economic events that rendered
// with date = today+N — looked real (correct future dates) but invented. The
// real /api/calendar endpoint must be used; empty array on failure.
const FALLBACK_EVENTS = []

export default function YouEconomicCalendar() {
  const [filter, setFilter] = useState('all')
  const [events, setEvents] = useState(FALLBACK_EVENTS)
  const [loading, setLoading] = useState(true)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(REMIX_KEY) || 'timeline' } catch { return 'timeline' }
  })
  const abortRef = useRef(null)
  const intervalRef = useRef(null)
  const mountedRef = useRef(true)

  const cycleRemix = useCallback(() => {
    setRemix(prev => {
      const next = REMIX_MODES[(REMIX_MODES.indexOf(prev) + 1) % REMIX_MODES.length]
      try { localStorage.setItem(REMIX_KEY, next) } catch {}
      return next
    })
  }, [])

  const fetchEvents = useCallback(async (signal, showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      if (isLocalViteDev()) {
        if (!signal?.aborted && mountedRef.current) {
          setEvents(prev => prev.length > 0 ? prev : FALLBACK_EVENTS)
          setLoading(false)
        }
        return
      }
      const from = new Date().toISOString().split('T')[0]
      const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const res = await fetch(`${CALENDAR_API_URL}?from=${from}&to=${to}`, { signal })
      if (!res.ok) throw new Error(`Calendar API error: ${res.status}`)
      const data = await res.json()
      const apiEvents = data?.events || []
      if (apiEvents.length > 0 && !signal?.aborted && mountedRef.current) {
        const mapped = apiEvents.map((e, i) => {
          const dt = new Date(e.dateTime || e.date)
          const impact = mapImpact(e.impact)
          return {
            id: e.id || String(i),
            title: e.name || e.title || e.nameShort || 'Unknown Event',
            date: dt,
            time: e.time || dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            impact: impact === 'high' && (e.name || '').toLowerCase().includes('fomc') ? 'critical' : impact,
            country: getFlag(e.country || e.countryCode),
          }
        }).sort((a, b) => a.date - b.date)
        setEvents(mapped)
      }
      if (!signal?.aborted && mountedRef.current) setLoading(false)
    } catch (e) {
      if (e.name === 'AbortError') return
      if (!signal?.aborted && mountedRef.current) {
        setEvents(prev => prev.length > 0 ? prev : FALLBACK_EVENTS)
        setLoading(false)
      }
    }
  }, [])

  const pollEvents = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    fetchEvents(ctrl.signal, false)
  }, [fetchEvents])

  useEffect(() => {
    mountedRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetchEvents(controller.signal, true)

    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchEvents])

  useAdaptivePolling(pollEvents, { interval: 5 * 60_000 })

  const impactColors = {
    critical: '#EF4444',
    high: '#FB923C',
    medium: '#FACC15',
    low: 'rgba(255,255,255,0.25)',
  }

  const impactLabels = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  }

  const formatDate = (d) => {
    if (!d || isNaN(d.getTime())) return ''
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
  }

  const formatDayHeader = (d) => {
    if (!d || isNaN(d.getTime())) return ''
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
  }

  const sorted = useMemo(() => [...events].sort((a, b) => a.date - b.date), [events])
  const filtered = useMemo(() => (
    filter === 'high'
      ? sorted.filter(e => e.impact === 'critical' || e.impact === 'high')
      : sorted
  ), [sorted, filter])

  const groupedByDay = useMemo(() => {
    const groups = {}
    filtered.forEach(event => {
      if (!event.date || isNaN(event.date.getTime())) return
      const key = event.date.toISOString().split('T')[0]
      if (!groups[key]) groups[key] = { date: event.date, events: [] }
      groups[key].events.push(event)
    })
    return Object.values(groups).sort((a, b) => a.date - b.date)
  }, [filtered])

  const pillBase = {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    padding: '4px 12px',
    borderRadius: 20,
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.15s ease',
  }

  // Shimmer loading
  if (loading && events === FALLBACK_EVENTS) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0' }}>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <div style={{ height: 26, width: 40, borderRadius: 20, background: 'rgba(255,255,255,0.04)' }} />
          <div style={{ height: 26, width: 100, borderRadius: 20, background: 'rgba(255,255,255,0.04)' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < 5 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: 'rgba(255,255,255,0.04)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', animationDelay: `${i * 50}ms`, marginBottom: 4 }} />
                <div style={{ height: 10, width: '40%', borderRadius: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', animationDelay: `${i * 80}ms` }} />
              </div>
              <div style={{ height: 16, width: 50, borderRadius: 20, background: 'rgba(255,255,255,0.04)' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // --- REMIX: compact ---
  if (remix === 'compact') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0', position: 'relative' }}>
        <button onClick={cycleRemix} className="you-remix-btn">compact</button>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setFilter('all')} style={{ ...pillBase, background: filter === 'all' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)', color: filter === 'all' ? 'var(--text-primary)' : 'var(--text-muted)' }}>All</button>
          <button onClick={() => setFilter('high')} style={{ ...pillBase, background: filter === 'high' ? 'rgba(251,146,60,0.15)' : 'rgba(255,255,255,0.03)', color: filter === 'high' ? '#FB923C' : 'var(--text-muted)' }}>High+</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '4px 0', fontWeight: 500 }}>Date</th>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Event</th>
                <th style={{ padding: '4px 0', fontWeight: 500, textAlign: 'right' }}>Impact</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '5px 0', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 9 }}>
                    {event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td style={{ padding: '5px 6px', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>
                    {event.country} {event.title}
                  </td>
                  <td style={{ padding: '5px 0', textAlign: 'right' }}>
                    <span style={{
                      fontSize: 8, padding: '2px 6px', borderRadius: 20,
                      background: impactColors[event.impact] + '18', color: impactColors[event.impact],
                      textTransform: 'uppercase', letterSpacing: '0.03em',
                    }}>{impactLabels[event.impact]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // --- REMIX: agenda ---
  if (remix === 'agenda') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0', position: 'relative' }}>
        <button onClick={cycleRemix} className="you-remix-btn">agenda</button>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setFilter('all')} style={{ ...pillBase, background: filter === 'all' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)', color: filter === 'all' ? 'var(--text-primary)' : 'var(--text-muted)' }}>All</button>
          <button onClick={() => setFilter('high')} style={{ ...pillBase, background: filter === 'high' ? 'rgba(251,146,60,0.15)' : 'rgba(255,255,255,0.03)', color: filter === 'high' ? '#FB923C' : 'var(--text-muted)' }}>High+</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupedByDay.map((group) => (
            <div key={group.date.toISOString()}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
                padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                {formatDayHeader(group.date)}
              </div>
              {group.events.map((event) => (
                <div key={event.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{event.country}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {event.title}
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {event.time}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 8px', borderRadius: 20,
                    background: impactColors[event.impact] + '18', color: impactColors[event.impact],
                    letterSpacing: '0.03em', textTransform: 'uppercase', flexShrink: 0,
                  }}>{impactLabels[event.impact]}</span>
                </div>
              ))}
            </div>
          ))}
          {groupedByDay.length === 0 && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
              No events matching this filter.
            </div>
          )}
        </div>
      </div>
    )
  }

  // --- REMIX: timeline (default) ---
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      height: '100%',
      padding: '2px 0',
      position: 'relative',
    }}>
      <button onClick={cycleRemix} className="you-remix-btn">timeline</button>
      {/* Filter row */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            ...pillBase,
            background: filter === 'all' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
            color: filter === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
        >
          All
        </button>
        <button
          onClick={() => setFilter('high')}
          style={{
            ...pillBase,
            background: filter === 'high' ? 'rgba(251,146,60,0.15)' : 'rgba(255,255,255,0.03)',
            color: filter === 'high' ? '#FB923C' : 'var(--text-muted)',
          }}
        >
          High + Critical
        </button>
      </div>

      {/* Scrollable event list */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {filtered.map((event, i) => (
          <div
            key={event.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 0',
              borderBottom: i < filtered.length - 1
                ? '1px solid rgba(255,255,255,0.04)'
                : 'none',
            }}
          >
            {/* Country flag */}
            <span style={{ fontSize: 16, flexShrink: 0 }}>
              {event.country}
            </span>

            {/* Event details */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {event.title}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                marginTop: 2,
              }}>
                {formatDate(event.date)} &middot; {event.time} UTC
              </div>
            </div>

            {/* Impact pill */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              padding: '2px 8px',
              borderRadius: 20,
              background: impactColors[event.impact] + '18',
              color: impactColors[event.impact],
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}>
              {impactLabels[event.impact]}
            </span>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '20px 0',
          }}>
            No events matching this filter.
          </div>
        )}
      </div>
    </div>
  )
}
