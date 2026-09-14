/**
 * IntelSidebar — Sticky 320px sidebar on desktop.
 * Sections: Next Critical, Bookmarked Events, Quick Timeline, Notification Status.
 */

import React, { useMemo, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import ImpactBadge from './ImpactBadge'
import CountdownTimer from './CountdownTimer'
import EventSentimentGauge from './EventSentimentGauge'
import CurrencyCorrelationMatrix from './CurrencyCorrelationMatrix'
import { formatEventTime, getCountryFlag, formatValueWithUnit } from '../utils/formatters'

// An all-day event (a symposium, a multi-day congress) has no clock: TV
// stamps it 00:00 UTC, which formats as a precise release time that doesn't
// exist. Same treatment as the day and week views.
const eventTime = (e, t) => (e?.allDay ? t('economicCalendar.allDay', 'All day') : formatEventTime(e?.dateTime))
import './IntelSidebar.css'

const StarIcon = ({ filled }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)

const DragHandle = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.3">
    <circle cx="3" cy="2" r="1" /><circle cx="7" cy="2" r="1" />
    <circle cx="3" cy="5" r="1" /><circle cx="7" cy="5" r="1" />
    <circle cx="3" cy="8" r="1" /><circle cx="7" cy="8" r="1" />
  </svg>
)

const BellSmall = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

const BookmarksList = ({ items, onEventClick, onReorder }) => {
  const { t } = useTranslation()
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const listRef = useRef(null)

  const handleDragStart = useCallback((e, idx) => {
    e.stopPropagation()
    setDragIdx(idx)
  }, [])

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault()
    setOverIdx(idx)
  }, [])

  const handleDrop = useCallback((e, idx) => {
    e.preventDefault()
    if (dragIdx != null && dragIdx !== idx) {
      onReorder?.(dragIdx, idx)
    }
    setDragIdx(null)
    setOverIdx(null)
  }, [dragIdx, onReorder])

  const handleDragEnd = useCallback(() => {
    setDragIdx(null)
    setOverIdx(null)
  }, [])

  return (
    <div className="intel-sidebar__section">
      <h3 className="intel-sidebar__heading">
        <StarIcon filled /> {t('economicCalendar.intelSidebar.bookmarked', 'Bookmarked')}
        <InfoTip text={t('economicCalendar.intelSidebar.bookmarkedTip', 'Your saved events. Drag to reorder by priority. Bookmarked events get highlighted in the calendar views.')} position="left" />
      </h3>
      <div className="intel-sidebar__list" ref={listRef}>
        {items.map((e, i) => (
          <div
            key={e.id}
            className={`intel-sidebar__list-item${dragIdx === i ? ' intel-sidebar__list-item--dragging' : ''}${overIdx === i && dragIdx !== i ? ' intel-sidebar__list-item--drop-target' : ''}`}
            draggable
            onDragStart={(ev) => handleDragStart(ev, i)}
            onDragOver={(ev) => handleDragOver(ev, i)}
            onDrop={(ev) => handleDrop(ev, i)}
            onDragEnd={handleDragEnd}
            onClick={() => onEventClick?.(e.id)}
          >
            <div className="intel-sidebar__list-left">
              <span className="intel-sidebar__drag-handle"><DragHandle /></span>
              <ImpactBadge impact={e.impact} />
              <span className="intel-sidebar__list-name">{e.nameShort || e.name}</span>
            </div>
            <span className="intel-sidebar__list-time">
              {eventTime(e, t)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const IntelSidebar = ({
  nextCritical,
  bookmarks,
  events = [],
  upcomingEvents = [],
  notificationsEnabled,
  scheduledCount = 0,
  onEventClick,
  selectedEvent,
}) => {
  const { t } = useTranslation()
  // Bookmarked events
  const bookmarkedEvents = useMemo(() => {
    if (!bookmarks?.bookmarkedIds?.length) return []
    const idSet = new Set(bookmarks.bookmarkedIds)
    return events.filter(e => idSet.has(e.id)).slice(0, 6)
  }, [bookmarks?.bookmarkedIds, events])

  // Quick timeline — next 8 events
  const timeline = useMemo(() => {
    const now = Date.now()
    return events
      .filter(e => new Date(e.dateTime).getTime() > now && e.actual == null)
      .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
      .slice(0, 8)
  }, [events])

  return (
    <aside className="intel-sidebar">
      {/* Next Critical Event */}
      {nextCritical && (
        <div className="intel-sidebar__section">
          <h3 className="intel-sidebar__heading">
            {t('economicCalendar.intelSidebar.nextCritical', 'Next Critical')}
            <InfoTip text={t('economicCalendar.intelSidebar.nextCriticalTip', 'The single most important upcoming event. Critical events move everything -- plan your trades around this.')} position="left" />
          </h3>
          <div
            className="intel-sidebar__critical-card"
            onClick={() => onEventClick?.(nextCritical.id)}
          >
            <div className="intel-sidebar__critical-top">
              <ImpactBadge impact="critical" />
              {nextCritical.country && (
                <span className="intel-sidebar__flag">{getCountryFlag(nextCritical.country)}</span>
              )}
            </div>
            <h4 className="intel-sidebar__critical-name">{nextCritical.name}</h4>
            <div className="intel-sidebar__critical-time">
              <span>{eventTime(nextCritical, t)}</span>
            </div>
            <div className="intel-sidebar__critical-countdown">
              <CountdownTimer targetTime={nextCritical.dateTime} size="compact" showLabel={false} />
            </div>
            <div className="intel-sidebar__critical-values">
              {nextCritical.previous != null && (
                <span className="intel-sidebar__val">
                  <span className="intel-sidebar__val-label">{t('economicCalendar.prev', 'Prev')}</span>
                  <span className="intel-sidebar__val-num">{formatValueWithUnit(nextCritical.previous, nextCritical.unit)}</span>
                </span>
              )}
              {nextCritical.forecast != null && (
                <span className="intel-sidebar__val">
                  <span className="intel-sidebar__val-label">{t('economicCalendar.fcst', 'Fcst')}</span>
                  <span className="intel-sidebar__val-num">{formatValueWithUnit(nextCritical.forecast, nextCritical.unit)}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bookmarked Events — with drag-to-reorder */}
      {bookmarkedEvents.length > 0 && (
        <BookmarksList
          items={bookmarkedEvents}
          onEventClick={onEventClick}
          onReorder={bookmarks?.reorderBookmarks}
        />
      )}

      {/* Quick Timeline */}
      {timeline.length > 0 && (
        <div className="intel-sidebar__section">
          <h3 className="intel-sidebar__heading">{t('economicCalendar.intelSidebar.upcoming', 'Upcoming')}</h3>
          <div className="intel-sidebar__timeline">
            {timeline.map((e, i) => {
              const d = new Date(e.dateTime)
              const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              const timeLabel = eventTime(e, t)
              // Show day separator
              const prevDay = i > 0 ? new Date(timeline[i - 1].dateTime).toDateString() : null
              const showDay = d.toDateString() !== prevDay

              return (
                <React.Fragment key={e.id}>
                  {showDay && (
                    <div className="intel-sidebar__timeline-day">{dayLabel}</div>
                  )}
                  <div
                    className="intel-sidebar__timeline-item"
                    onClick={() => onEventClick?.(e.id)}
                  >
                    <span className="intel-sidebar__timeline-time">{timeLabel}</span>
                    <span className={`intel-sidebar__timeline-dot intel-sidebar__timeline-dot--${e.impact}`} />
                    <span className="intel-sidebar__timeline-name">{e.nameShort || e.name}</span>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      {/* Sentiment Gauge — shows when event is selected */}
      {selectedEvent && (
        <div className="intel-sidebar__section">
          <EventSentimentGauge event={selectedEvent} />
        </div>
      )}

      {/* Currency Correlation Matrix — shows when event has a category */}
      {selectedEvent?.category && (
        <div className="intel-sidebar__section">
          <CurrencyCorrelationMatrix
            category={selectedEvent.category}
            activeCurrency={selectedEvent.currency}
          />
        </div>
      )}

      {/* Notification Status */}
      <div className="intel-sidebar__section intel-sidebar__section--notif">
        <div className="intel-sidebar__notif-row">
          <BellSmall />
          <span className="intel-sidebar__notif-text">
            {notificationsEnabled
              ? t('economicCalendar.intelSidebar.alertsScheduled', '{{count}} alerts scheduled', { count: scheduledCount })
              : t('economicCalendar.intelSidebar.notificationsOff', 'Notifications off')}
          </span>
        </div>
      </div>
    </aside>
  )
}

export default IntelSidebar
