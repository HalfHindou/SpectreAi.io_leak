/**
 * NextUpHero — Dual-mode event banner.
 *
 * COUNTDOWN mode: Shows next critical event with countdown timer, prev/forecast values.
 * RESULTS mode:   Shows released event results with actual vs forecast, beat/miss badge,
 *                 AI-generated brief, and history navigation arrows.
 *
 * Switches to results mode when critical/high events release today.
 * Resets back to countdown at 5 AM next morning.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import ImpactBadge from './ImpactBadge'
import CountdownTimer from './CountdownTimer'
import { useCountdown } from '../hooks/useCountdown'
import { getCountryFlag, formatValueWithUnit } from '../utils/formatters'
import { getEventStatus } from '../hooks/useEventStatus'
import './NextUpHero.css'

/* ── Helpers ── */

function getDayTag(dateTime, t) {
  const eventDate = new Date(dateTime)
  const now = new Date()
  const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((eventDay - today) / 86400000)
  if (diffDays === 0) return t ? t('economicCalendar.todayUpper', 'TODAY') : 'TODAY'
  if (diffDays === 1) return t ? t('economicCalendar.tomorrowUpper', 'TOMORROW') : 'TOMORROW'
  return eventDate.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
}

/** Determine if actual result beat or missed forecast */
function getBeatMiss(event) {
  if (event.actual == null || event.forecast == null) return null
  const actual = parseFloat(event.actual)
  const forecast = parseFloat(event.forecast)
  if (isNaN(actual) || isNaN(forecast)) return null

  // For unemployment/jobless claims, lower is better
  const lowerIsBetter = /unemploy|jobless|claims/i.test(event.name)
  const diff = actual - forecast

  if (Math.abs(diff) < 0.001) return 'inline'
  if (lowerIsBetter) return diff < 0 ? 'beat' : 'miss'
  return diff > 0 ? 'beat' : 'miss'
}

/* ── Arrow Icons ── */
const ArrowLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

/* ── Countdown Mode (original behavior) ── */
const CountdownMode = ({ event }) => {
  const { t } = useTranslation()
  const status = getEventStatus(event)
  const { isUrgent, minutes } = useCountdown(event.dateTime)
  const isLive = status === 'live'
  const isReleased = status === 'released'
  const dayTag = getDayTag(event.dateTime, t)
  const isImminent = dayTag === t('economicCalendar.todayUpper', 'TODAY') || dayTag === t('economicCalendar.tomorrowUpper', 'TOMORROW')

  return (
    <div className={`ec-next ec-next--countdown${isLive ? ' ec-next--live' : ''}${isUrgent && minutes < 5 ? ' ec-next--urgent' : ''}`}>
      <span className="ec-next__label">{t('economicCalendar.nextUpper', 'NEXT')}</span>
      <ImpactBadge impact={event.impact} />
      <span className={`ec-next__day-tag${isImminent ? ' ec-next__day-tag--imminent' : ''}`}>
        {dayTag}
      </span>
      {event.country && (
        <span className="ec-next__flag">{getCountryFlag(event.country)}</span>
      )}
      <span className="ec-next__name">{event.name}</span>

      {(event.previous != null || event.forecast != null) && (
        <>
          <span className="ec-next__sep">&middot;</span>
          <span className="ec-next__vals">
            {event.previous != null && (
              <span className="ec-next__val-box">
                <span className="ec-next__val-label">{t('economicCalendar.prev', 'Prev')}</span>
                <span className="ec-next__val-num">{formatValueWithUnit(event.previous, event.unit)}</span>
              </span>
            )}
            {event.forecast != null && (
              <span className="ec-next__val-box ec-next__val-box--fcst">
                <span className="ec-next__val-label">{t('economicCalendar.fcst', 'Fcst')}</span>
                <span className="ec-next__val-num">{formatValueWithUnit(event.forecast, event.unit)}</span>
              </span>
            )}
          </span>
        </>
      )}

      <div className="ec-next__status">
        {isLive ? (
          <span className="ec-next__live">
            <span className="ec-next__live-dot" />
            {t('economicCalendar.liveUpper', 'LIVE')}
          </span>
        ) : isReleased ? (
          <span className="ec-next__released">{t('economicCalendar.releasedUpper', 'RELEASED')}</span>
        ) : (
          <CountdownTimer targetTime={event.dateTime} size="compact" showLabel={false} />
        )}
      </div>
    </div>
  )
}

/* ── Results Mode ── */
const ResultsMode = ({
  event,
  brief,
  briefLoading,
  hasBack,
  hasForward,
  onBack,
  onForward,
  currentIndex,
  totalResults,
}) => {
  const { t } = useTranslation()
  const beatMiss = getBeatMiss(event)

  return (
    <div className="ec-next ec-next--results">
      {/* Left: label + event info */}
      <div className="ec-next__results-left">
        <span className="ec-next__results-label">
          <span className="ec-next__results-dot" />
          {t('economicCalendar.eventResults', 'EVENT RESULTS')}
        </span>
        <ImpactBadge impact={event.impact} />
        {event.country && (
          <span className="ec-next__flag">{getCountryFlag(event.country)}</span>
        )}
        <span className="ec-next__name">{event.name}</span>
      </div>

      {/* Center: actual value + comparison + beat/miss */}
      <div className="ec-next__results-center">
        <span className="ec-next__actual-box">
          <span className="ec-next__actual-label">{t('economicCalendar.actual', 'Actual')}</span>
          <span className={`ec-next__actual-num${beatMiss === 'beat' ? ' ec-next__actual-num--beat' : beatMiss === 'miss' ? ' ec-next__actual-num--miss' : ''}`}>
            {formatValueWithUnit(event.actual, event.unit)}
          </span>
        </span>

        {(event.forecast != null || event.previous != null) && (
          <span className="ec-next__results-compare">
            {event.forecast != null && (
              <span className="ec-next__val-box">
                <span className="ec-next__val-label">{t('economicCalendar.fcst', 'Fcst')}</span>
                <span className="ec-next__val-num">{formatValueWithUnit(event.forecast, event.unit)}</span>
              </span>
            )}
            {event.previous != null && (
              <span className="ec-next__val-box">
                <span className="ec-next__val-label">{t('economicCalendar.prev', 'Prev')}</span>
                <span className="ec-next__val-num">{formatValueWithUnit(event.previous, event.unit)}</span>
              </span>
            )}
          </span>
        )}

        {beatMiss && beatMiss !== 'inline' && (
          <span className={`ec-next__beat-badge ec-next__beat-badge--${beatMiss}`}>
            {beatMiss === 'beat' ? t('economicCalendar.beatUpper', 'BEAT') : t('economicCalendar.missUpper', 'MISS')}
          </span>
        )}
        {beatMiss === 'inline' && (
          <span className="ec-next__beat-badge ec-next__beat-badge--inline">{t('economicCalendar.inLineUpper', 'IN LINE')}</span>
        )}
      </div>

      {/* Right: brief + history nav */}
      <div className="ec-next__results-right">
        {briefLoading && (
          <span className="ec-next__brief-shimmer" />
        )}
        {!briefLoading && brief?.brief && (
          <span className="ec-next__brief">{brief.brief}</span>
        )}

        {totalResults > 1 && (
          <div className="ec-next__history-nav">
            {/* Left arrow = go to lower index (1→…). Disabled at index 0. */}
            <button
              className="ec-next__history-btn"
              onClick={onForward}
              disabled={!hasForward}
              title={t('economicCalendar.previousPage', 'Previous page')}
            >
              <ArrowLeft />
            </button>
            <span className="ec-next__history-count">
              {currentIndex + 1}/{totalResults}
            </span>
            {/* Right arrow = advance pagination (1→2→3→4). Disabled at end. */}
            <button
              className="ec-next__history-btn"
              onClick={onBack}
              disabled={!hasBack}
              title={t('economicCalendar.nextPage', 'Next page')}
            >
              <ArrowRight />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Main Component ── */
const NextUpHero = ({
  // Existing prop (backward compat)
  event,
  // New props from useEventResultsMode
  mode,
  resultEvent,
  brief,
  briefLoading,
  hasBack,
  hasForward,
  onBack,
  onForward,
  currentIndex,
  totalResults,
  countdownEvent,
}) => {
  // If mode is explicitly set, use dual-mode behavior
  if (mode === 'results' && resultEvent) {
    return (
      <ResultsMode
        event={resultEvent}
        brief={brief}
        briefLoading={briefLoading}
        hasBack={hasBack}
        hasForward={hasForward}
        onBack={onBack}
        onForward={onForward}
        currentIndex={currentIndex}
        totalResults={totalResults}
      />
    )
  }

  // Countdown mode: use countdownEvent or fallback to event prop
  const displayEvent = countdownEvent || event
  if (!displayEvent) return null

  return <CountdownMode event={displayEvent} />
}

export default NextUpHero
