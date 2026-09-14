/**
 * CalendarMiniPanel — Command Center "Calendar" tab.
 *
 * The compact landing-page version of the Economic Calendar. Four views via a
 * top toggle (Next is the default):
 *   - Next:  the next market-moving event + live countdown, a short agenda,
 *            and THE THESIS (the brain's geopolitics/macro read).
 *   - Day / Week / Month: the real calendar views (reused from the economic-
 *            calendar page) with compact date navigation.
 * Lazy-mounted, so the data hook only runs when this tab is open
 * (visibility-gated per api-patterns.md L). Full calendar lives at
 * /economic-calendar.
 */
import { useMemo, useState, useCallback, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import lazy from '@/lib/lazy-with-retry'
import { useNavigate } from 'react-router-dom'
import useCalendarData from '@/pages/economic-calendar/hooks/useCalendarData'
import useCountdown from '@/pages/economic-calendar/hooks/useCountdown'
import useFilters from '@/pages/economic-calendar/hooks/useFilters'
import { getCountryFlag, formatValueWithUnit } from '@/pages/economic-calendar/utils/formatters'
import { isReleased, resultClass } from '@/pages/economic-calendar/utils/eventResult'
import { formatTimeAgo } from '@/pages/economic-calendar/utils/relativeTime'
import '@/pages/economic-calendar/components/calendar-temporal.css'
import './calendar-mini-panel.css'

// Day/Week/Month trees are heavy; only pulled when the user switches off Next.
const DayView = lazy(() => import('@/pages/economic-calendar/components/DayView'))
const WeekView = lazy(() => import('@/pages/economic-calendar/components/WeekView'))
const MonthView = lazy(() => import('@/pages/economic-calendar/components/MonthView'))

const IMPACT_LABEL = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }
const VIEW_OPTIONS = [
  { id: 'next', label: 'Next' },
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

function Countdown({ dateTime }) {
  const { t } = useTranslation()
  const tl = useCountdown(dateTime)
  if (!dateTime || tl.isExpired) return <span className="ccal-next__when ccal-next__when--live">{t('homePage.calendarMiniPanel.countdown.releasingNow', "Releasing now")}</span>
  const parts = []
  if (tl.days > 0) parts.push(`${tl.days}d`)
  parts.push(`${tl.hours}h`)
  parts.push(`${tl.minutes}m`)
  if (tl.days === 0) parts.push(`${tl.seconds}s`)
  return (
    <span className={`ccal-next__when${tl.isUrgent ? ' ccal-next__when--urgent' : ''}`}>
      in {parts.join(' ')}
    </span>
  )
}

// This panel is deliberately untranslated (like every other string in it), so
// formatTimeAgo gets a shim that just fills the fallback's {{count}}.
const agoT = (key, fallback, opts) => String(fallback).replace('{{count}}', opts?.count ?? '')

function agendaTime(dt) {
  const d = new Date(dt)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

const ChevL = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
const ChevR = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>

export default function CalendarMiniPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState('month')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [expandedEventId, setExpandedEventId] = useState(null)
  const {
    events, loading, analysis,
    getNextCriticalEvent, getUpcomingEvents,
    getEventsForDate, getEventsForWeek, getEventsForMonth,
  } = useCalendarData(currentDate)
  // Same filter set as /economic-calendar. Without it this panel fed the SAME
  // Day/Week/Month components an unfiltered list, so the Command Center's month
  // grid counted bill auctions and DAO votes and disagreed with the page it
  // links to.
  const filters = useFilters()

  // ── Next view derivations ──
  const nextEvent = useMemo(() => {
    const crit = getNextCriticalEvent?.()
    if (crit) return crit
    const up = getUpcomingEvents?.(1) || []
    return up[0] || null
  }, [getNextCriticalEvent, getUpcomingEvents])

  const agenda = useMemo(() => {
    const up = getUpcomingEvents?.(6) || []
    return up.filter((e) => e.id !== nextEvent?.id).slice(0, 4)
  }, [getUpcomingEvents, nextEvent])

  // What just PRINTED. The panel only ever looked forward, so on the morning of
  // a CPI you could stare at it and never learn the number that had just landed.
  const justReleased = useMemo(() => {
    const now = Date.now()
    // Four days back, so a Monday morning still shows Friday's payrolls rather
    // than pretending nothing has printed.
    const since = now - 96 * 3600e3
    const RANK = { critical: 0, high: 1, medium: 2, low: 3 }
    // Same filter set as the grid, and medium-or-better only: without the tier
    // floor the row proudly reported a 91-day T-bill auction as the headline
    // print of the day.
    return filters.applyFilters(events || [])
      .filter((e) => {
        if (!isReleased(e)) return false
        if (e.event_type && e.event_type !== 'macro') return false
        if (!(e.impact === 'critical' || e.impact === 'high' || e.impact === 'medium')) return false
        const ts = new Date(e.dateTime).getTime()
        return Number.isFinite(ts) && ts <= now && ts >= since
      })
      .sort((a, b) => (RANK[a.impact] ?? 3) - (RANK[b.impact] ?? 3)
        || new Date(b.dateTime) - new Date(a.dateTime))[0] || null
  }, [events, filters])

  const thesis = analysis?.marketThesis || analysis?.weekAhead || null

  // ── Day/Week/Month derivations ──
  const viewEvents = useMemo(() => {
    let evts = []
    if (view === 'day') evts = getEventsForDate?.(currentDate) || []
    else if (view === 'week') evts = getEventsForWeek?.(currentDate) || []
    else if (view === 'month') evts = getEventsForMonth?.(currentDate) || []
    return filters.applyFilters(evts)
  }, [view, currentDate, events, filters, getEventsForDate, getEventsForWeek, getEventsForMonth])

  const dateLabel = useMemo(() => {
    const d = new Date(currentDate)
    if (isNaN(d.getTime())) return ''
    if (view === 'day') return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    if (view === 'week') {
      const start = new Date(d)
      const dow = start.getDay()
      start.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
      const end = new Date(start); end.setDate(start.getDate() + 6)
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    }
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [currentDate, view])

  const handleDateChange = useCallback((dir) => {
    setCurrentDate((prev) => {
      const d = new Date(prev)
      if (view === 'day') d.setDate(d.getDate() + dir)
      else if (view === 'week') d.setDate(d.getDate() + dir * 7)
      else d.setMonth(d.getMonth() + dir)
      return d
    })
  }, [view])

  const handleToday = useCallback(() => setCurrentDate(new Date()), [])
  const handleEventToggle = useCallback((id) => setExpandedEventId((p) => (p === id ? null : id)), [])
  const handleDayClick = useCallback((date) => { setCurrentDate(date); setView('day') }, [])
  const handleEventClick = useCallback((id) => setExpandedEventId(id), [])

  const showLoadingShell = loading && view === 'next' && !nextEvent && !thesis

  return (
    <div className="ccal">
      {/* View toggle */}
      <div className="ccal-toolbar">
        <div className="ccal-views" role="tablist" aria-label={t('homePage.calendarMiniPanel.calendarminipanel.ariaCalendarView', "Calendar view")}>
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={view === opt.id}
              className={`ccal-view-btn${view === opt.id ? ' is-active' : ''}`}
              onClick={() => setView(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {view !== 'next' && (
          <div className="ccal-datenav">
            <button type="button" className="ccal-nav-arrow" onClick={() => handleDateChange(-1)} aria-label={t('homePage.calendarMiniPanel.calendarminipanel.ariaPrevious', "Previous")}><ChevL /></button>
            <span className="ccal-date-label">{dateLabel}</span>
            <button type="button" className="ccal-nav-arrow" onClick={() => handleDateChange(1)} aria-label={t('homePage.calendarMiniPanel.calendarminipanel.ariaNext', "Next")}><ChevR /></button>
            <button type="button" className="ccal-today-btn" onClick={handleToday}>{t('homePage.calendarMiniPanel.calendarminipanel.today', "Today")}</button>
          </div>
        )}
      </div>

      {showLoadingShell && (
        <>
          <div className="ccal-skeleton ccal-skeleton--hero" />
          <div className="ccal-skeleton" />
          <div className="ccal-skeleton" style={{ width: '80%' }} />
        </>
      )}

      {/* ── NEXT view ── */}
      {view === 'next' && !showLoadingShell && (
        <>
          {justReleased && (
            <button
              type="button"
              className="ccal-landed"
              onClick={() => navigate('/economic-calendar')}
              title={t('homePage.calendarMiniPanel.calendarminipanel.title', "Open economic calendar")}
            >
              <span className="ccal-landed__label">
                {Date.now() - new Date(justReleased.dateTime).getTime() < 6 * 3600e3
                  ? 'JUST RELEASED'
                  : 'LAST RELEASE'}
              </span>
              <span className="ccal-landed__name">
                <span aria-hidden>{getCountryFlag(justReleased.country)}</span>
                {justReleased.nameShort || justReleased.name}
              </span>
              <span className={`ccal-landed__actual cal-result${resultClass(justReleased)}`}>
                {formatValueWithUnit(justReleased.actual, justReleased.unit)}
              </span>
              {justReleased.forecast != null && (
                <span className="ccal-landed__vs">
                  vs {formatValueWithUnit(justReleased.forecast, justReleased.unit)} est
                </span>
              )}
              <span className="ccal-landed__ago">{formatTimeAgo(justReleased.dateTime, agoT)}</span>
            </button>
          )}

          {nextEvent && (
            <button
              type="button"
              className="ccal-next"
              onClick={() => navigate('/economic-calendar')}
              title={t('homePage.calendarMiniPanel.calendarminipanel.title', "Open economic calendar")}
            >
              <div className="ccal-next__head">
                <span className="ccal-next__label">{t('homePage.calendarMiniPanel.calendarminipanel.nextEvent', "NEXT EVENT")}</span>
                {nextEvent.impact && (
                  <span className={`ccal-next__impact ccal-next__impact--${nextEvent.impact}`}>
                    {IMPACT_LABEL[nextEvent.impact] || nextEvent.impact}
                  </span>
                )}
              </div>
              <div className="ccal-next__name">
                <span className="ccal-next__flag" aria-hidden>{getCountryFlag(nextEvent.country)}</span>
                {nextEvent.name || nextEvent.nameShort}
              </div>
              <div className="ccal-next__meta">
                <Countdown dateTime={nextEvent.dateTime} />
                {(nextEvent.forecast != null || nextEvent.previous != null) && (
                  <span className="ccal-next__vals">
                    {nextEvent.forecast != null && (
                      <span className="ccal-next__val"><em>{t('homePage.calendarMiniPanel.calendarminipanel.fcst', "fcst")}</em> {formatValueWithUnit(nextEvent.forecast, nextEvent.unit)}</span>
                    )}
                    {nextEvent.previous != null && (
                      <span className="ccal-next__val"><em>{t('homePage.calendarMiniPanel.calendarminipanel.prev', "prev")}</em> {formatValueWithUnit(nextEvent.previous, nextEvent.unit)}</span>
                    )}
                  </span>
                )}
              </div>
            </button>
          )}

          {agenda.length > 0 && (
            <div className="ccal-agenda">
              <span className="ccal-agenda__label">{t('homePage.calendarMiniPanel.calendarminipanel.upNext', "UP NEXT")}</span>
              <ul className="ccal-agenda__list">
                {agenda.map((e) => (
                  <li key={e.id} className="ccal-agenda__row" onClick={() => navigate('/economic-calendar')}>
                    <span className="ccal-agenda__time">{agendaTime(e.dateTime)}</span>
                    <span className={`ccal-agenda__dot ccal-agenda__dot--${e.impact}`} aria-hidden />
                    <span className="ccal-agenda__name">{e.name || e.nameShort}</span>
                    <span className="ccal-agenda__flag" aria-hidden>{getCountryFlag(e.country)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {thesis && (
            <div className="ccal-thesis">
              <div className="ccal-thesis__head">
                <span className="ccal-thesis__label">{t('homePage.calendarMiniPanel.calendarminipanel.theThesis', "THE THESIS")}</span>
                <span className="ccal-thesis__live"><span className="ccal-thesis__dot" />{t('homePage.calendarMiniPanel.calendarminipanel.live', "Live")}</span>
              </div>
              <p className="ccal-thesis__body">{thesis}</p>
              <button type="button" className="ccal-thesis__cta" onClick={() => navigate('/economic-calendar')}>
                {t('homePage.calendarMiniPanel.calendarminipanel.openFullCalendar', "Open full calendar")}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          )}

          {!nextEvent && !thesis && !loading && (
            <div className="ccal-empty">{t('homePage.calendarMiniPanel.calendarminipanel.noUpcomingEvents', "No upcoming events.")}</div>
          )}
        </>
      )}

      {/* ── DAY / WEEK / MONTH views ── */}
      {view !== 'next' && (
        <div className="ccal-calview">
          <Suspense fallback={<div className="ccal-skeleton ccal-skeleton--hero" />}>
            {view === 'day' && (
              <DayView
                events={viewEvents}
                allEvents={events}
                date={currentDate}
                expandedEventId={expandedEventId}
                onEventToggle={handleEventToggle}
              />
            )}
            {view === 'week' && (
              <WeekView
                events={viewEvents}
                currentDate={currentDate}
                onDayClick={handleDayClick}
                onEventClick={handleEventClick}
                compact
              />
            )}
            {view === 'month' && (
              <MonthView
                events={viewEvents}
                currentDate={currentDate}
                onDayClick={handleDayClick}
                compact
              />
            )}
          </Suspense>
        </div>
      )}
    </div>
  )
}
