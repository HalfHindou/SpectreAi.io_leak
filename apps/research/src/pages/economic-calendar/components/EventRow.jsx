/**
 * EventRow Component — Card-based event display
 *
 * Two layouts based on event importance:
 *   Critical/High → Full glass card with header, name, values row
 *   Medium/Low    → Compact inline card
 *
 * States: upcoming (countdown), live (pulsing red), released (beat/miss), passed (dimmed).
 * Category accents via left border color.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import ShareXModal from '@/components/share-x-modal'
import ImpactBadge from './ImpactBadge'
import CountdownTimer from './CountdownTimer'
import EventDetail from './EventDetail'
import ActualReveal from './ActualReveal'
import VolatilityBadge from './VolatilityBadge'
import { formatEventTime, getCountryFlag, formatValueWithUnit } from '../utils/formatters'
import { isReleased as hasPrinted } from '../utils/eventResult'
import { getEventStatus } from '../hooks/useEventStatus'
import { renderEventShareCard } from '../utils/shareEventCard'
import './calendar-temporal.css'
import './EventRow.css'

const ShareIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
)

const DeviationBadge = ({ actual, forecast, t }) => {
  if (actual == null || forecast == null) return null
  const diff = actual - forecast
  const pct = forecast !== 0 ? ((diff / Math.abs(forecast)) * 100).toFixed(1) : 0

  let label, className
  if (Math.abs(pct) < 2) {
    label = t('economicCalendar.inLineUpper', 'IN LINE')
    className = 'event-card__dev event-card__dev--inline'
  } else if (diff > 0) {
    label = t('economicCalendar.beatUpper', 'BEAT')
    className = 'event-card__dev event-card__dev--beat'
  } else {
    label = t('economicCalendar.missUpper', 'MISS')
    className = 'event-card__dev event-card__dev--miss'
  }

  return <span className={className}>{label}</span>
}


const EventRow = ({ event, expanded = false, focused = false, onToggle }) => {
  const { t } = useTranslation()
  const status = getEventStatus(event)
  const isCritical = event.impact === 'critical'
  const isHigh = event.impact === 'high'
  const isLive = status === 'live'
  const isReleased = status === 'released'
  const isPassed = status === 'passed'
  // One definition of "printed", shared with the status + result colouring: a
  // placeholder zero with nothing to compare it to is an empty field, not a
  // print (a future symposium was rendering "ACT 0" under a RELEASED chip).
  const hasActual = hasPrinted(event)
  // A scheduled event (symposium, speech, meeting accounts) carries no
  // previous / consensus / actual at all — the values row is suppressed for it.
  const hasAnyValue = hasActual || event.previous != null || event.forecast != null
  const isProminent = isCritical || isHigh

  // Track actual value transitions for reveal animation
  const prevActualRef = useRef(event.actual)
  const [revealTriggered, setRevealTriggered] = useState(false)
  const [flashClass, setFlashClass] = useState('')

  // Share modal
  const [shareOpen, setShareOpen] = useState(false)
  const [shareImageUrl, setShareImageUrl] = useState(null)
  const [shareDescription, setShareDescription] = useState('')

  const handleShare = useCallback(async (e) => {
    e.stopPropagation()
    if (shareOpen) return
    setShareOpen(true)
    setShareImageUrl(null)
    const parts = [event.name]
    if (hasPrinted(event)) parts.push(`Actual ${formatValueWithUnit(event.actual, event.unit)}`)
    if (event.forecast != null) parts.push(`Fcst ${formatValueWithUnit(event.forecast, event.unit)}`)
    if (event.previous != null) parts.push(`Prev ${formatValueWithUnit(event.previous, event.unit)}`)
    setShareDescription(`${parts.join(' · ')}\n\n\nvia @Spectre__Ai\nhttps://spectreai.io`)
    try {
      const url = await renderEventShareCard(event)
      if (url) setShareImageUrl(url)
    } catch {
      // silently handled — modal stays open with placeholder
    }
  }, [event, shareOpen])

  const shareBtn = (
    <button
      type="button"
      className="event-card__share-btn"
      onClick={handleShare}
      aria-label={t('economicCalendar.shareEvent', 'Share event')}
      title={t('economicCalendar.shareEvent', 'Share event')}
    >
      <ShareIcon />
    </button>
  )

  useEffect(() => {
    if (prevActualRef.current == null && event.actual != null) {
      setRevealTriggered(true)
      const isBeat = event.forecast != null && event.actual > event.forecast
      setFlashClass(isBeat ? 'event-card--flash-beat' : 'event-card--flash-miss')
      const timer = setTimeout(() => setFlashClass(''), 800)
      return () => clearTimeout(timer)
    }
    prevActualRef.current = event.actual
  }, [event.actual, event.forecast])

  const isBeatResult = hasActual && event.forecast != null && event.actual > event.forecast

  // Result tint for released events
  let resultClass = ''
  if (isReleased && hasActual && event.forecast != null) {
    const diff = event.actual - event.forecast
    if (Math.abs(((diff / Math.abs(event.forecast)) * 100)) >= 2) {
      resultClass = diff > 0 ? 'event-card--beat' : 'event-card--miss'
    }
  }

  const classNames = [
    'event-card',
    `event-card--${event.impact}`,
    isProminent ? 'event-card--prominent' : '',
    isCritical ? 'event-card--critical' : '',
    isLive ? 'event-card--live' : '',
    isPassed ? 'event-card--passed' : '',
    resultClass,
    flashClass,
    expanded ? 'event-card--expanded' : '',
    focused ? 'event-card--focused' : '',
  ].filter(Boolean).join(' ')

  const chevron = (
    <div className={`event-card__chevron${expanded ? ' event-card__chevron--open' : ''}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )

  const statusEl = (
    <div className="event-card__status">
      {isLive && (
        <div className="event-card__live-badge">
          <span className="event-card__live-dot" />
          <span className="event-card__live-text">{t('economicCalendar.liveUpper', 'LIVE')}</span>
        </div>
      )}
      {isReleased && (
        <span className="event-card__released">{t('economicCalendar.releasedUpper', 'RELEASED')}</span>
      )}
      {status === 'upcoming' && (
        <CountdownTimer targetTime={event.dateTime} size="compact" showLabel={false} />
      )}
    </div>
  )

  // ─── Prominent layout (Critical / High) ───
  if (isProminent) {
    return (
      <div className={classNames} id={`event-${event.id}`}>
        <div className="event-card__main" onClick={() => onToggle?.(event.id)}>
          {/* Header: impact + flag + source + time */}
          <div className="event-card__header">
            <div className="event-card__header-left">
              <ImpactBadge impact={event.impact} />
              {event.country && (
                <span className="event-card__flag">{getCountryFlag(event.country)}</span>
              )}
              {event.isCrypto && (
                <span className="event-card__crypto-icon">{event.symbol === 'ETH' ? '\u039E' : '\u20BF'}</span>
              )}
              {event.source && <span className="event-card__source">{event.source}</span>}
            </div>
            <div className="event-card__header-right">
              <span className="event-card__time">
                {event.allDay ? t('economicCalendar.allDay', 'All day') : formatEventTime(event.dateTime)}
              </span>
              {shareBtn}
              {chevron}
            </div>
          </div>

          {/* Event name */}
          <h3 className="event-card__name">{event.name}</h3>

          {/* Values + countdown. An event with no previous, no consensus and no
              actual is a scheduled EVENT, not a data release — a symposium, a
              speech, a set of meeting accounts. Printing "PREV — · FCST — ·
              ACT ——" under it invents a data shape it never had. */}
          <div className="event-card__footer">
            {hasAnyValue && <div className="event-card__values">
              <span className="event-card__val">
                <span className="event-card__val-label">{t('economicCalendar.prev', 'Prev')} <InfoTip text={t('economicCalendar.prevTooltip', 'Previous: The last officially reported value. Compare against forecast to gauge market expectations.')} position="top" /></span>
                <span className="event-card__val-num">{formatValueWithUnit(event.previous, event.unit) ?? '\u2014'}</span>
              </span>
              <span className="event-card__val-sep">&middot;</span>
              <span className="event-card__val">
                <span className="event-card__val-label">{t('economicCalendar.fcst', 'Fcst')} <InfoTip text={t('economicCalendar.fcstTooltip', 'Forecast: The consensus estimate from economists. Markets price this in before release -- surprises cause volatility.')} position="top" /></span>
                <span className="event-card__val-num">{formatValueWithUnit(event.forecast, event.unit) ?? '\u2014'}</span>
              </span>
              <span className="event-card__val-sep">&middot;</span>
              <span className="event-card__val event-card__val--actual">
                <span className="event-card__val-label">{t('economicCalendar.act', 'Act')} <InfoTip text={t('economicCalendar.actTooltip', 'Actual: The real number when released. The gap between Actual and Forecast (deviation) drives immediate price action.')} position="top" /></span>
                {hasActual ? (
                  <>
                    <ActualReveal
                      value={event.actual}
                      unit={event.unit || ''}
                      isBeat={isBeatResult}
                      triggered={revealTriggered}
                    />
                    <DeviationBadge actual={event.actual} forecast={event.forecast} t={t} />
                  </>
                ) : (
                  <span className="event-card__val-num event-card__val-num--pending">&mdash;&mdash;</span>
                )}
              </span>
            </div>}
            <div className="event-card__footer-right">
              <VolatilityBadge event={event} />
              {statusEl}
            </div>
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && <EventDetail event={event} />}

        <ShareXModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          imageUrl={shareImageUrl}
          defaultDescription={shareDescription}
          filename={`spectre-event-${event.id || 'card'}.png`}
          contentType="economic_event"
        />
      </div>
    )
  }

  // ─── Compact layout (Medium / Low) ───
  return (
    <div className={classNames} id={`event-${event.id}`}>
      <div className="event-card__main" onClick={() => onToggle?.(event.id)}>
        <div className="event-card__compact-top">
          <ImpactBadge impact={event.impact} />
          {event.country && (
            <span className="event-card__flag">{getCountryFlag(event.country)}</span>
          )}
          {event.isCrypto && (
            <span className="event-card__crypto-icon">{event.symbol === 'ETH' ? '\u039E' : '\u20BF'}</span>
          )}
          <span className="event-card__name-inline">{event.name}</span>
          <span className="event-card__time-inline">
            {event.allDay ? t('economicCalendar.allDay', 'All day') : formatEventTime(event.dateTime)}
          </span>
          {statusEl}
          {shareBtn}
          {chevron}
        </div>

        {(event.previous != null || event.forecast != null) && (
          <div className="event-card__compact-values">
            {event.previous != null && <span>{t('economicCalendar.prev', 'Prev')}: {formatValueWithUnit(event.previous, event.unit)}</span>}
            {event.previous != null && event.forecast != null && <span className="event-card__val-sep">&middot;</span>}
            {event.forecast != null && <span>{t('economicCalendar.fcst', 'Fcst')}: {formatValueWithUnit(event.forecast, event.unit)}</span>}
            {hasActual && (
              <>
                <span className="event-card__val-sep">&middot;</span>
                <span>{t('economicCalendar.act', 'Act')}: <ActualReveal value={event.actual} unit={event.unit || ''} isBeat={isBeatResult} triggered={revealTriggered} /></span>
                <DeviationBadge actual={event.actual} forecast={event.forecast} t={t} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && <EventDetail event={event} />}

      <ShareXModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        imageUrl={shareImageUrl}
        defaultDescription={shareDescription}
        filename={`spectre-event-${event.id || 'card'}.png`}
        contentType="economic_event"
      />
    </div>
  )
}

// Memoized: a day view renders many EventRows; without this, any parent re-render
// (live status ticks, focus changes) re-renders every row. Props are stable per
// row — event by id, expanded/focused booleans, useCallback'd handlers — so only
// the rows that actually changed re-render.
export default React.memo(EventRow)
