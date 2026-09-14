/**
 * EventDetail Component
 * Expanded detail panel below EventRow when clicked.
 * Renders history, analysis, Fed-specific panels, crypto impact,
 * market reaction, and livestream in a 2-column layout.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useEventDetail from '../hooks/useEventDetail'
import { isReleased as hasPrinted } from '../utils/eventResult'
import HistoryTable from './HistoryTable'
import HistoryChart from './HistoryChart'
import SpectreAnalysis from './SpectreAnalysis'
import CryptoImpact from './CryptoImpact'
import FedSentimentMeter from './FedSentimentMeter'
import FedDecisionBreakdown from './FedDecisionBreakdown'
import MarketReaction from './MarketReaction'
import LivestreamEmbed from './LivestreamEmbed'
import ImpactReactionChart from './ImpactReactionChart'
import EventComparison from './EventComparison'
import PortfolioImpactSimulator from './PortfolioImpactSimulator'
import EventSnapshot from './EventSnapshot'
import './EventDetail.css'

const EventDetail = ({ event: rawEvent, onClose }) => {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const [isVisible, setIsVisible] = useState(false)
  const [showComparison, setShowComparison] = useState(false)

  // Lazy-fetch rich detail (actual/forecast/whyMatters/category) from ext-api
  const isExtEvent = typeof rawEvent?.id === 'string' && rawEvent.id.startsWith('ext-')
  const { detail } = useEventDetail(isExtEvent ? rawEvent.id : null)

  // Merge upstream detail over the event prop. Detail wins for actual/forecast/previous
  // only when upstream supplies a non-null value, so we never blow away mock-enriched data.
  const event = useMemo(() => {
    if (!rawEvent) return null
    if (!detail) return rawEvent
    const pick = (a, b) => (a != null ? a : b)
    return {
      ...rawEvent,
      actual: pick(detail.actual, rawEvent.actual),
      forecast: pick(detail.forecast, rawEvent.forecast),
      previous: pick(detail.previous, rawEvent.previous),
      revised: pick(detail.revised, rawEvent.revised),
      isBetterThanExpected: pick(detail.isBetterThanExpected, rawEvent.isBetterThanExpected),
      deviation: pick(detail.deviation, rawEvent.deviation),
      category: detail.category || rawEvent.category,
      description: rawEvent.description || detail.description,
      headline: detail.headline || rawEvent.headline,
      whyMatters: detail.whyMatters || rawEvent.whyMatters,
      hasHistorical: detail.hasHistorical ?? rawEvent.hasHistorical,
      isAllDay: detail.isAllDay ?? rawEvent.isAllDay,
      isPreliminary: detail.isPreliminary ?? rawEvent.isPreliminary,
      isReport: detail.isReport ?? rawEvent.isReport,
      isSpeech: detail.isSpeech ?? rawEvent.isSpeech,
      isTentative: detail.isTentative ?? rawEvent.isTentative,
      nextReleaseDate: detail.nextReleaseDate || rawEvent.nextReleaseDate,
      sourceUrl: detail.sourceUrl || rawEvent.sourceUrl || rawEvent.url,
      tags: detail.tags?.length ? detail.tags : (rawEvent.tags || []),
    }
  }, [rawEvent, detail])

  // Trigger enter animation after mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsVisible(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!event) return null

  const isReleased = event.status === 'released' || hasPrinted(event)
  const isFedEvent = !!event.isFedEvent
  const hasLivestream = !!event.livestreamUrl
  const history = event.history || []
  const forecast = event.forecast
  const hasHistory = history.length > 0
  const hasChartableHistory = history.length >= 2
  const canCompare = history.length >= 2
  const descriptionText = event.whyMatters || event.description || ''
  const headlineText = event.headline && event.headline !== event.name ? event.headline : ''
  const hasAbout = !!(headlineText || descriptionText)

  return (
    <div
      ref={containerRef}
      className={`event-detail ${isVisible ? 'event-detail--visible' : ''}`}
    >
      <div className="event-detail__inner">
        {/* Always present - see EventSnapshot. The source link lives in the
            About block when there is one, otherwise the snapshot carries it. */}
        <EventSnapshot event={event} showSource={!hasAbout} />

        {hasAbout && (
          <div className="event-detail__about">
            <span className="event-detail__about-label">{t('economicCalendar.about', 'About')}</span>
            {headlineText && (
              <p className="event-detail__about-headline">{headlineText}</p>
            )}
            {descriptionText && (
              <p className="event-detail__about-text">{descriptionText}</p>
            )}
            {event.sourceUrl && (
              <a
                className="event-detail__about-source"
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('economicCalendar.officialSource', 'Official source')}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 17 17 7" /><path d="M7 7h10v10" />
                </svg>
              </a>
            )}
          </div>
        )}

        {/* Two-column grid (collapses to single column when no history) */}
        <div className={`event-detail__grid${hasHistory ? '' : ' event-detail__grid--single'}`}>
          {hasHistory && (
            <div className="event-detail__left">
              <HistoryTable history={history} />
              {hasChartableHistory && <HistoryChart history={history} forecast={forecast} />}
            </div>
          )}

          {/* Right column: Analysis + Fed panels */}
          <div className="event-detail__right">
            <SpectreAnalysis
              analysis={event.spectreAnalysis || event.analysis}
              eventName={event.name}
            />

            {isFedEvent && (
              <>
                <FedSentimentMeter
                  sentiment={event.sentiment}
                  lastDecision={event.lastDecision}
                  marketExpecting={event.marketExpecting}
                />
                <FedDecisionBreakdown event={event} />
              </>
            )}
          </div>
        </div>

        {/* Full-width sections below grid */}
        <ImpactReactionChart eventName={event.name} />

        {/* Compare Releases + Portfolio Simulator */}
        {canCompare && !showComparison && (
          <button
            className="event-detail__btn event-detail__btn--ghost"
            onClick={() => setShowComparison(true)}
            style={{ marginTop: 'var(--sp-2)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            {t('economicCalendar.compareReleases', 'Compare Releases')}
          </button>
        )}
        {showComparison && (
          <EventComparison history={history} onClose={() => setShowComparison(false)} />
        )}

        <PortfolioImpactSimulator eventName={event.name} />

        <CryptoImpact cryptoImpact={event.cryptoImpact} />

        {isReleased && (
          <MarketReaction event={event} />
        )}

        {hasLivestream && (
          <LivestreamEmbed
            url={event.livestreamUrl}
            eventName={event.name}
            isLive={event.status === 'live'}
          />
        )}

      </div>
    </div>
  )
}

export default EventDetail
