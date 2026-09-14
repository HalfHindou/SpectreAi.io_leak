/**
 * DayView Component
 * Card-based event list with clean time grouping.
 * Events displayed as glass cards sorted by time.
 * No spreadsheet-style timeline — just cards in a natural list.
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import EventRow from './EventRow'
import EarningsRow from './EarningsRow'
import ImpactBadge from './ImpactBadge'
import { isToday } from '../utils/timezone'
import { EARNINGS_EVENTS } from '../data/earningsEvents'
import './calendar-temporal.css'
import './DayView.css'

const formatBlockTime = (dateTime) => {
  const d = new Date(dateTime)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
}

const getEventHour = (dateTime) => new Date(dateTime).getHours()

/**
 * Group events by hour for readable time blocks.
 * Returns: { hour, label, events }[]
 */
const groupByTimeBlock = (events, allDayLabel = 'All day') => {
  if (events.length === 0) return []

  // All-day events (Jackson Hole, an NPC session) have no clock time — TV
  // stamps them 00:00 UTC, which the hour grouping rendered as a "2:00 AM"
  // gutter for a European reader. They get their own leading block instead.
  const allDay = events.filter((e) => e.allDay)
  const timed = events.filter((e) => !e.allDay)
  const sorted = [...timed].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
  const blocks = allDay.length > 0
    ? [{ hour: -1, label: allDayLabel, allDay: true, events: allDay }]
    : []
  let currentBlock = null

  for (const event of sorted) {
    const hour = getEventHour(event.dateTime)

    if (currentBlock && currentBlock.hour === hour) {
      currentBlock.events.push(event)
    } else {
      if (currentBlock) blocks.push(currentBlock)
      currentBlock = {
        hour,
        label: formatBlockTime(event.dateTime),
        events: [event],
      }
    }
  }
  if (currentBlock) blocks.push(currentBlock)

  return blocks
}

const DayView = ({
  events = [],
  allEvents = [],
  date,
  expandedEventId,
  focusedEventId,
  onEventToggle,
  showLowImpact = false,
  bookmarks,
}) => {
  const { t } = useTranslation()
  // Filter low events unless showLowImpact
  const filteredEvents = useMemo(() => {
    if (showLowImpact) return events
    return events.filter((e) => e.impact !== 'low')
  }, [events, showLowImpact])

  const timeBlocks = useMemo(
    () => groupByTimeBlock(filteredEvents, t('economicCalendar.allDay', 'All day')),
    [filteredEvents, t]
  )

  // Where "now" falls in today's agenda. Everything above the line has printed,
  // everything below is still coming — the single most useful thing a day view
  // can tell you, and it had no way of saying it.
  const viewingToday = date ? isToday(date) : false
  const nowIndex = useMemo(() => {
    if (!viewingToday) return -1
    const nowHour = new Date().getHours()
    const idx = timeBlocks.findIndex((b) => !b.allDay && b.hour > nowHour)
    return idx === -1 ? timeBlocks.length : idx
  }, [viewingToday, timeBlocks])

  // Earnings for this day
  const dayEarnings = useMemo(() => {
    if (!date) return []
    return EARNINGS_EVENTS.filter(e => {
      const ed = new Date(e.dateTime)
      return ed.getFullYear() === date.getFullYear() &&
             ed.getMonth() === date.getMonth() &&
             ed.getDate() === date.getDate()
    })
  }, [date])

  // Find next event for empty state
  const nextEvent = useMemo(() => {
    const now = Date.now()
    const all = allEvents.length > 0 ? allEvents : events
    return all
      .filter((e) => new Date(e.dateTime).getTime() > now)
      .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))[0] || null
  }, [allEvents, events])

  // Week stats for empty state
  const weekStats = useMemo(() => {
    const all = allEvents.length > 0 ? allEvents : events
    const d = date || new Date()
    const day = d.getDay()
    const mondayOff = day === 0 ? -6 : 1 - day
    const mon = new Date(d)
    mon.setDate(d.getDate() + mondayOff)
    mon.setHours(0, 0, 0, 0)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    sun.setHours(23, 59, 59, 999)

    const weekEvts = all.filter((e) => {
      const t = new Date(e.dateTime).getTime()
      return t >= mon.getTime() && t <= sun.getTime()
    })
    return {
      total: weekEvts.length,
      critical: weekEvts.filter((e) => e.impact === 'critical').length,
      high: weekEvts.filter((e) => e.impact === 'high').length,
    }
  }, [allEvents, events, date])

  // Empty state — glass card with calendar illustration
  if (filteredEvents.length === 0) {
    const isWeekend = date && (date.getDay() === 0 || date.getDay() === 6)
    return (
      <div className="day-view day-view--empty">
        <div className="day-view__empty-card">
          <svg className="day-view__empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="10" width="36" height="32" rx="4" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
            <line x1="6" y1="20" x2="42" y2="20" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.15" />
            <line x1="14" y1="6" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.3" />
            <line x1="34" y1="6" x2="34" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.3" />
            {isWeekend ? (
              <>
                <circle cx="24" cy="31" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
                <line x1="24" y1="28" x2="24" y2="31" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.2" />
                <line x1="24" y1="31" x2="26.5" y2="33" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.2" />
              </>
            ) : (
              <>
                <rect x="14" y="24" width="6" height="4" rx="1" fill="currentColor" fillOpacity="0.08" />
                <rect x="14" y="32" width="6" height="4" rx="1" fill="currentColor" fillOpacity="0.06" />
                <rect x="24" y="24" width="6" height="4" rx="1" fill="currentColor" fillOpacity="0.06" />
              </>
            )}
          </svg>
          <p className="day-view__empty-title">
            {isWeekend ? t('economicCalendar.marketsClosed', 'Markets closed today.') : t('economicCalendar.noEventsScheduled', 'No events scheduled.')}
          </p>
          <p className="day-view__empty-subtitle">
            {isWeekend ? t('economicCalendar.enjoyWeekend', 'Enjoy the weekend.') : t('economicCalendar.checkBackLater', 'Check back later or browse a different date.')}
          </p>
          {nextEvent && (
            <div className="day-view__empty-next">
              <span className="day-view__empty-next-label">{t('economicCalendar.nextEvent', 'Next event:')}</span>
              <span className="day-view__empty-next-date">
                {new Date(nextEvent.dateTime).toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                })}
                {', '}
                {new Date(nextEvent.dateTime).toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit', hour12: false,
                })}
                {' EST'}
              </span>
            </div>
          )}
          {nextEvent && (
            <div className="day-view__empty-event-row">
              <span className="day-view__empty-event-name">{nextEvent.name}</span>
              <ImpactBadge impact={nextEvent.impact} />
            </div>
          )}
          {weekStats.total > 0 && (
            <p className="day-view__empty-stats">
              {t('economicCalendar.thisWeek', 'This week:')} {weekStats.total} {t('economicCalendar.events', 'events')}
              {weekStats.critical > 0 && <span> &middot; {weekStats.critical} {t('economicCalendar.critical', 'critical')}</span>}
              {weekStats.high > 0 && <span> &middot; {weekStats.high} {t('economicCalendar.high', 'high')}</span>}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="day-view">
      <div className="day-view__list">
        {timeBlocks.map((block, i) => {
          // Show gap divider if 2+ hours between blocks
          const prevBlock = i > 0 ? timeBlocks[i - 1] : null
          // The all-day block sits at hour -1 and is not on the clock, so the
          // hour arithmetic below is meaningless across it.
          const hasGap = prevBlock && !prevBlock.allDay && (block.hour - prevBlock.hour) > 2

          return (
            <React.Fragment key={block.hour}>
              {i === nowIndex && (
                <div className="day-view__now" role="separator">
                  <span className="day-view__now-dot" />
                  <span className="day-view__now-text">{t('economicCalendar.now', 'Now')}</span>
                  <span className="day-view__now-line" />
                </div>
              )}
              {hasGap && (
                <div className="day-view__gap">
                  <span className="day-view__gap-line" />
                  <span className="day-view__gap-text">
                    {block.hour - prevBlock.hour - 1}{t('economicCalendar.hourGap', 'h gap')}
                  </span>
                  <span className="day-view__gap-line" />
                </div>
              )}

              <div className="day-view__time-block">
                <div className="day-view__time-label">
                  {block.label}
                </div>
                <div className="day-view__events">
                  {block.events.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      expanded={expandedEventId === event.id}
                      focused={focusedEventId === event.id}
                      onToggle={onEventToggle}
                    />
                  ))}
                </div>
              </div>
            </React.Fragment>
          )
        })}
        {/* Every event today has already printed — the line still belongs at
            the end, so the agenda reads as finished rather than unstarted. */}
        {nowIndex === timeBlocks.length && timeBlocks.length > 0 && (
          <div className="day-view__now" role="separator">
            <span className="day-view__now-dot" />
            <span className="day-view__now-text">{t('economicCalendar.now', 'Now')}</span>
            <span className="day-view__now-line" />
          </div>
        )}
      </div>

      {/* Earnings Section */}
      {dayEarnings.length > 0 && (
        <div className="day-view__earnings">
          <div className="day-view__earnings-header">
            <span className="day-view__earnings-title">{t('economicCalendar.earnings', 'Earnings')}</span>
            <span className="day-view__earnings-count">{dayEarnings.length}</span>
          </div>
          <div className="day-view__earnings-list">
            {dayEarnings.map(e => (
              <EarningsRow key={e.id} earning={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default DayView
