/**
 * WeekView Component
 * 7-column week layout (Mon-Sun). Each day column shows that day's events
 * ranked by impact, capped at MAX_VISIBLE_EVENTS with a "+N more" tail.
 *
 * 2026-08-24: this used to render ONLY critical+high events, so a Monday
 * holding six medium releases printed "No events for this period" while the
 * panel header counted 47 events for the week and the UPCOMING rail above it
 * was live-counting down to two of the events the grid claimed didn't exist.
 * The cap is a display cap now, never a filter: what a column can't fit it
 * counts.
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ImpactBadge from './ImpactBadge'
import { isReleased, resultClass } from '../utils/eventResult'
import { formatValueWithUnit } from '../utils/formatters'
import './calendar-temporal.css'
import './WeekView.css'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Get the week dates (Mon-Sun) for a given date.
 */
function getWeekDatesForDate(date) {
  const d = new Date(date)
  const day = d.getDay()
  // Adjust to Monday (day=0 is Sunday in JS)
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)

  const dates = []
  for (let i = 0; i < 7; i++) {
    const wd = new Date(monday)
    wd.setDate(monday.getDate() + i)
    dates.push(wd)
  }
  return dates
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isToday(date) {
  return isSameDay(date, new Date())
}

function formatDayHeader(date, t) {
  const labels = [
    t ? t('economicCalendar.dayMon', 'Mon') : 'Mon',
    t ? t('economicCalendar.dayTue', 'Tue') : 'Tue',
    t ? t('economicCalendar.dayWed', 'Wed') : 'Wed',
    t ? t('economicCalendar.dayThu', 'Thu') : 'Thu',
    t ? t('economicCalendar.dayFri', 'Fri') : 'Fri',
    t ? t('economicCalendar.daySat', 'Sat') : 'Sat',
    t ? t('economicCalendar.daySun', 'Sun') : 'Sun',
  ]
  return `${labels[date.getDay() === 0 ? 6 : date.getDay() - 1]} ${date.getDate()}`
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
}

const MAX_VISIBLE_EVENTS = 4

// Which events win the limited slots in a column: the most consequential
// first, ties broken by time of day. The slice is then re-sorted back into
// chronological order for display so a column still reads top-to-bottom as
// the day runs.
const IMPACT_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
function byImpactThenTime(a, b) {
  const ra = IMPACT_RANK[a.impact] ?? 3
  const rb = IMPACT_RANK[b.impact] ?? 3
  if (ra !== rb) return ra - rb
  return new Date(a.dateTime || a.date || 0) - new Date(b.dateTime || b.date || 0)
}
function byTime(a, b) {
  return new Date(a.dateTime || a.date || 0) - new Date(b.dateTime || b.date || 0)
}


function isPastDay(date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d < today
}

const WeekView = ({ events = [], currentDate = new Date(), onDayClick, onEventClick, compact = false }) => {
  const { t } = useTranslation()
  const weekDates = useMemo(() => getWeekDatesForDate(currentDate), [currentDate])

  // The next critical print still ahead — the single card on the board that
  // breathes. Same rule as the month grid: one living element, and it's the
  // one worth walking across the room for.
  const nextBigId = useMemo(() => {
    const now = Date.now()
    let best = null
    for (const e of events) {
      if (e.impact !== 'critical') continue
      const t = new Date(e.dateTime || e.date || e.datetime).getTime()
      if (!Number.isFinite(t) || t < now) continue
      if (!best || t < best.t) best = { t, id: e.id }
    }
    return best?.id ?? null
  }, [events])

  // Group events by day. Every event the page's filters let through belongs to
  // a column — impact decides ORDER, never membership.
  const eventsByDay = useMemo(() => {
    const grouped = weekDates.map(() => [])
    const index = new Map()
    weekDates.forEach((wd, i) => {
      index.set(`${wd.getFullYear()}-${wd.getMonth()}-${wd.getDate()}`, i)
    })

    events.forEach((event) => {
      const d = new Date(event.dateTime || event.date || event.datetime)
      if (isNaN(d.getTime())) return
      const i = index.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
      if (i !== undefined) grouped[i].push(event)
    })

    return grouped.map((list) => list.sort(byImpactThenTime))
  }, [events, weekDates])

  return (
    <div className={`week-view${compact ? ' week-view--compact' : ''}`}>
      <div className="week-view__grid">
        {weekDates.map((date, dayIndex) => {
          const dayEvents = eventsByDay[dayIndex]
          const isWeekend = dayIndex >= 5
          const isTodayCol = isToday(date)
          const isPast = isPastDay(date) && !isTodayCol
          const cap = compact ? 3 : MAX_VISIBLE_EVENTS
          const visibleEvents = dayEvents.slice(0, cap).sort(byTime)
          const overflowCount = dayEvents.length - cap

          return (
            <div
              key={dayIndex}
              className={[
                'week-view__column',
                isTodayCol ? 'week-view__column--today' : '',
                isWeekend ? 'week-view__column--weekend' : '',
                isPast ? 'week-view__column--past' : '',
              ].filter(Boolean).join(' ')}
            >
              {/* Day header */}
              <button
                className={`week-view__day-header ${isTodayCol ? 'week-view__day-header--today' : ''}`}
                onClick={() => onDayClick && onDayClick(date)}
              >
                <span className="week-view__day-label">{formatDayHeader(date, t)}</span>
                {isTodayCol && (
                  <span className="cal-today-chip">{t('economicCalendar.todayShort', 'Today')}</span>
                )}
                {dayEvents.length > 0 && (
                  <span className="week-view__day-count">{dayEvents.length}</span>
                )}
                {isTodayCol && <span className="week-view__today-indicator" />}
              </button>

              {/* Event stack */}
              <div className="week-view__events">
                {visibleEvents.length === 0 && (
                  <div className="week-view__empty">
                    <span className="week-view__empty-text">{t('economicCalendar.noEvents', 'No events')}</span>
                  </div>
                )}

                {visibleEvents.map((event) => {
                  const released = isReleased(event)
                  return (
                    <button
                      key={event.id}
                      className={[
                        'week-view__event-card',
                        `week-view__event-card--${event.impact}`,
                        event.id === nextBigId ? 'week-view__event-card--next' : '',
                        released ? 'week-view__event-card--released' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => onEventClick && onEventClick(event.id)}
                    >
                      <div className="week-view__event-top">
                        <ImpactBadge impact={event.impact} />
                        <span className="week-view__event-time">
                          {event.allDay
                            ? t('economicCalendar.allDay', 'All day')
                            : formatTime(event.dateTime || event.date || event.datetime)}
                        </span>
                      </div>
                      <span className="week-view__event-name">
                        {event.nameShort || event.name}
                      </span>
                      {/* A past day exists to show what PRINTED. Without this the
                          week grid rendered a landed CPI identically to one that
                          hadn't happened yet. */}
                      {released && (
                        <span className="week-view__event-result">
                          <span className={`cal-result${resultClass(event)}`}>
                            {formatValueWithUnit(event.actual, event.unit)}
                          </span>
                          {event.forecast != null && (
                            <span className="week-view__event-vs">
                              {t('economicCalendar.vsShort', 'vs')} {formatValueWithUnit(event.forecast, event.unit)}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  )
                })}

                {overflowCount > 0 && (
                  <button
                    className="week-view__overflow"
                    onClick={() => onDayClick && onDayClick(date)}
                  >
                    +{overflowCount} {t('economicCalendar.more', 'more')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default React.memo(WeekView)
