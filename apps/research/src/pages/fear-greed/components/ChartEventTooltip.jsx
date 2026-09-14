/**
 * HTML tooltip for chart event markers — positioned absolute in .fg-chart-wrap
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

function formatDate(ts, lang) {
  return new Date(ts * 1000).toLocaleDateString(lang || undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fgLabelKey(v) {
  if (v <= 25) return 'fearGreed.extremeFear'
  if (v <= 45) return 'fearGreed.fear'
  if (v <= 55) return 'fearGreed.neutral'
  if (v <= 75) return 'fearGreed.greed'
  return 'fearGreed.extremeGreed'
}

function fgColor(v) {
  if (v <= 25) return '#ef4444'
  if (v <= 45) return '#ea580c'
  if (v <= 55) return '#eab308'
  if (v <= 75) return '#84cc16'
  return '#22c55e'
}

function EventItem({ event, single, t, lang }) {
  const typeLabel = event.type === 'milestone'
    ? t('fearGreedPage.eventTypeMilestone')
    : t('fearGreedPage.eventTypeNews')
  return (
    <div className={single ? undefined : 'fg-event-tooltip-item'}>
      <div className="fg-event-tooltip-meta">
        <div className={`fg-event-tooltip-type fg-event-tooltip-type--${event.type}`}>
          {event.type === 'milestone' ? (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          ) : (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          )}
          {typeLabel}
        </div>
        {event.source && (
          <span className="fg-event-tooltip-source">{event.source}</span>
        )}
      </div>
      {!single && <div className="fg-event-tooltip-date">{formatDate(event.ts, lang)}</div>}
      <div className="fg-event-tooltip-title">{event.title}</div>
      {single && event.summary && <div className="fg-event-tooltip-summary">{event.summary}</div>}
      {!single && event.summary && (
        <div className="fg-event-tooltip-summary fg-event-tooltip-summary--truncated">{event.summary}</div>
      )}
      {event.url && single && (
        <a href={event.url} target="_blank" rel="noopener noreferrer" className="fg-event-tooltip-link">
          {t('fearGreedPage.readMore')} &rarr;
        </a>
      )}
    </div>
  )
}

function ChartEventTooltip({ cluster, W, chartWidth, onClose }) {
  const { t, i18n } = useTranslation()
  const lang = i18n?.language
  if (!cluster) return null

  const { events, x, count, fgValue } = cluster
  const isSingle = count === 1

  // Position: left or right of marker
  const pxRatio = chartWidth > 0 ? chartWidth / W : 1
  const left = x * pxRatio
  const flipLeft = left > chartWidth * 0.6

  const typeColor = events[0].type === 'milestone' ? '#3b82f6' : '#22c55e'

  return (
    <div
      className="fg-event-tooltip"
      style={{
        left: flipLeft ? left - 268 : left + 14,
        top: 8,
        '--tooltip-accent': typeColor,
      }}
    >
      {/* Accent top line */}
      <div className="fg-event-tooltip-accent" />

      <div className="fg-event-tooltip-header">
        <div className="fg-event-tooltip-header-left">
          {isSingle ? (
            <span className="fg-event-tooltip-date">{formatDate(events[0].ts, lang)}</span>
          ) : (
            <span className="fg-event-tooltip-date">{t('fearGreedPage.eventsCount', { count })}</span>
          )}
          {/* F&G value at event date */}
          {fgValue != null && (
            <div className="fg-event-tooltip-fg">
              <span className="fg-event-tooltip-fg-dot" style={{ background: fgColor(fgValue) }} />
              <span className="fg-event-tooltip-fg-val">F&G: {fgValue}</span>
              <span className="fg-event-tooltip-fg-label">{t(fgLabelKey(fgValue))}</span>
            </div>
          )}
        </div>
        <button type="button" className="fg-event-tooltip-close" onClick={onClose} aria-label={t('fearGreedPage.close')}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {isSingle ? (
        <EventItem event={events[0]} single t={t} lang={lang} />
      ) : (
        <div className="fg-event-tooltip-list">
          {events.map(ev => (
            <EventItem key={ev.id} event={ev} single={false} t={t} lang={lang} />
          ))}
        </div>
      )}
    </div>
  )
}

export default React.memo(ChartEventTooltip)
