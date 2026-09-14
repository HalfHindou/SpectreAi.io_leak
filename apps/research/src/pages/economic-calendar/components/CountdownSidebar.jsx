/**
 * CountdownSidebar Component
 * Horizontal scrolling row of upcoming event pills.
 * Each pill shows flag + name + countdown timer.
 * Always visible on all views for continuity.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import CountdownTimer from './CountdownTimer'
import { getCountryFlag } from '../utils/formatters'
import './CountdownSidebar.css'

const EventPill = ({ event, onClick }) => (
  <button
    className={`cs-pill${event.impact ? ` cs-pill--${event.impact}` : ''}`}
    onClick={() => onClick?.(event.id)}
  >
    <div className="cs-pill__left">
      {event.country && (
        <span className="cs-pill__flag">{getCountryFlag(event.country)}</span>
      )}
      <span className="cs-pill__name">{event.nameShort || event.name}</span>
    </div>
    <div className="cs-pill__right">
      <CountdownTimer targetTime={event.dateTime} size="compact" showLabel={false} />
    </div>
  </button>
)

const CountdownSidebar = ({ events = [], onEventClick }) => {
  const { t } = useTranslation()
  if (events.length === 0) return null

  return (
    <div className="countdown-strip">
      <span className="countdown-strip__label">{t('economicCalendar.upcoming', 'UPCOMING')}</span>
      <div className="countdown-strip__pills">
        {events.slice(0, 5).map((event) => (
          <EventPill
            key={event.id}
            event={event}
            onClick={onEventClick}
          />
        ))}
      </div>
    </div>
  )
}

export default React.memo(CountdownSidebar)
