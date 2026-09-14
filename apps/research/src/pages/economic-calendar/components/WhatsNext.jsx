/**
 * WhatsNext Component
 * Bottom reference strip showing the next critical/high events and weekly stats.
 * Compact horizontal layout with glass background.
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './WhatsNext.css'

/**
 * Format a date to compact "Mon DD, HH:MM" form.
 */
function formatCompactDateTime(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    const month = d.toLocaleDateString('en-US', { month: 'short' })
    const day = d.getDate()
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    return `${month} ${day}, ${time}`
  } catch {
    return ''
  }
}

/**
 * Check if a date falls within the current week (Mon-Sun).
 */
function isThisWeek(dateStr) {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false

  const now = new Date()
  const dayOfWeek = now.getDay()
  // Adjust so Monday = 0
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() + mondayOffset)
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  return d >= weekStart && d < weekEnd
}

const WhatsNext = ({ events = [] }) => {
  const { t } = useTranslation()
  const data = useMemo(() => {
    const now = new Date()

    // Filter to upcoming events only
    const upcoming = events
      .filter((e) => {
        const d = new Date(e.dateTime || e.date || e.datetime)
        return !isNaN(d.getTime()) && d > now
      })
      .sort((a, b) => new Date(a.dateTime || a.date) - new Date(b.dateTime || b.date))

    // Next critical event
    const nextCritical = upcoming.find((e) => e.impact === 'critical') || null
    // Next high event
    const nextHigh = upcoming.find((e) => e.impact === 'high') || null

    // This week stats
    const thisWeekEvents = events.filter((e) => isThisWeek(e.dateTime || e.date || e.datetime))
    const weekTotal = thisWeekEvents.length
    const weekCritical = thisWeekEvents.filter((e) => e.impact === 'critical').length
    const weekHigh = thisWeekEvents.filter((e) => e.impact === 'high').length

    return { nextCritical, nextHigh, weekTotal, weekCritical, weekHigh }
  }, [events])

  const { nextCritical, nextHigh, weekTotal, weekCritical, weekHigh } = data

  return (
    <div className="whats-next">
      <span className="whats-next__label">{t('economicCalendar.whatsNext.title', "WHAT'S NEXT")}</span>

      <div className="whats-next__items">
        {nextCritical && (
          <span className="whats-next__item">
            <span className="whats-next__item-badge whats-next__item-badge--critical">{t('economicCalendar.impactCriticalUpper', 'CRITICAL')}</span>
            <span className="whats-next__item-name">{nextCritical.name}</span>
            <span className="whats-next__item-time">
              {formatCompactDateTime(nextCritical.dateTime || nextCritical.date)}
            </span>
          </span>
        )}

        {nextCritical && nextHigh && (
          <span className="whats-next__sep">&middot;</span>
        )}

        {nextHigh && nextHigh !== nextCritical && (
          <span className="whats-next__item">
            <span className="whats-next__item-badge whats-next__item-badge--high">{t('economicCalendar.impactHighUpper', 'HIGH')}</span>
            <span className="whats-next__item-name">{nextHigh.name}</span>
            <span className="whats-next__item-time">
              {formatCompactDateTime(nextHigh.dateTime || nextHigh.date)}
            </span>
          </span>
        )}

        <span className="whats-next__sep">&middot;</span>

        <span className="whats-next__item whats-next__item--stats">
          <span className="whats-next__stat-label">{t('economicCalendar.whatsNext.thisWeek', 'This week:')}</span>
          <span className="whats-next__stat-value">{t('economicCalendar.whatsNext.weekEventsCount', '{{count}} events', { count: weekTotal })}</span>
          {weekCritical > 0 && (
            <span className="whats-next__stat-critical">{t('economicCalendar.whatsNext.criticalCount', '{{count}} critical', { count: weekCritical })}</span>
          )}
          {weekHigh > 0 && (
            <span className="whats-next__stat-high">{t('economicCalendar.whatsNext.highCount', '{{count}} high', { count: weekHigh })}</span>
          )}
        </span>
      </div>
    </div>
  )
}

export default WhatsNext
