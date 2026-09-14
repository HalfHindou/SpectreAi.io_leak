/**
 * MarketOutlook — Market analysis glass card.
 * Fetched from /api/calendar/analysis.
 * Shows: next key event, expectations, fed context, bull/bear cases,
 * week ahead summary, and risk level bar.
 *
 * States: loading (skeleton shimmer), empty (subtle message), error (hidden).
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import { formatTimeAgo } from '../utils/relativeTime'
import './MarketOutlook.css'

/* ── Skeleton Shimmer ── */
const SkeletonLine = ({ width = '100%', height = 12, style }) => (
  <div
    className="mo-skeleton"
    style={{ width, height, borderRadius: 6, ...style }}
  />
)

const SkeletonBlock = () => (
  <div className="mo-skeleton-block">
    <div className="mo-skeleton-header">
      <SkeletonLine width={120} height={8} />
      <SkeletonLine width={80} height={8} />
    </div>
    <SkeletonLine width="90%" height={12} style={{ marginTop: 16 }} />
    <SkeletonLine width="70%" height={12} style={{ marginTop: 8 }} />
    <SkeletonLine width="80%" height={12} style={{ marginTop: 8 }} />
    <div className="mo-skeleton-cards">
      <SkeletonLine width="48%" height={80} style={{ borderRadius: 12 }} />
      <SkeletonLine width="48%" height={80} style={{ borderRadius: 12 }} />
    </div>
    <SkeletonLine width="100%" height={60} style={{ marginTop: 16, borderRadius: 12 }} />
    <div className="mo-skeleton-cards" style={{ marginTop: 16 }}>
      <SkeletonLine width="48%" height={72} style={{ borderRadius: 12 }} />
      <SkeletonLine width="48%" height={72} style={{ borderRadius: 12 }} />
    </div>
    <SkeletonLine width="100%" height={40} style={{ marginTop: 16, borderRadius: 12 }} />
  </div>
)

/* ── Risk Level Bar ── */
const RISK_LEVELS = {
  low: { segments: 2, color: 'var(--bull)', labelKey: 'marketOutlook.riskLow', fallback: 'LOW' },
  moderate: { segments: 3, color: '#F59E0B', labelKey: 'marketOutlook.riskModerate', fallback: 'MODERATE' },
  elevated: { segments: 4, color: '#F97316', labelKey: 'marketOutlook.riskElevated', fallback: 'ELEVATED' },
  high: { segments: 5, color: 'var(--bear)', labelKey: 'marketOutlook.riskHigh', fallback: 'HIGH' },
  extreme: { segments: 6, color: '#DC2626', labelKey: 'marketOutlook.riskExtreme', fallback: 'EXTREME' },
}

const RiskBar = ({ level = 'moderate' }) => {
  const { t } = useTranslation()
  const config = RISK_LEVELS[level?.toLowerCase()] || RISK_LEVELS.moderate
  const totalSegments = 6

  return (
    <div className="mo-risk">
      <span className="mo-risk__label">{t('economicCalendar.marketOutlook.risk', 'Risk')}</span>
      <div className="mo-risk__bar">
        {Array.from({ length: totalSegments }, (_, i) => (
          <span
            key={i}
            className={`mo-risk__segment${i < config.segments ? ' mo-risk__segment--filled' : ''}`}
            style={i < config.segments ? { backgroundColor: config.color } : undefined}
          />
        ))}
      </div>
      <span className="mo-risk__level" style={{ color: config.color }}>
        {t(`economicCalendar.${config.labelKey}`, config.fallback)}
      </span>
    </div>
  )
}

/* ── Formatting helpers ── */
function formatEventDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatEventTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  }) + ' ET'
}

/* ── Normalize bullCase / bearCase to an array of scenarios.
   Older analysis payloads return a single string; the F&G thesis card
   established the multi-scenario array convention. Either shape renders
   as a clean playbook list with numbered circles. */
function asScenarioList(v) {
  if (Array.isArray(v)) return v.map(s => String(s || '').trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) {
    // Split paragraph-style strings on sentence boundaries so the user gets
    // multiple visual rows instead of one wall of text. Cap at 4 to stay tidy.
    // A '.' followed by a digit is a DECIMAL, not a boundary — the naive split
    // rendered "VIX, currently at 16." / "5, as market participants…" as two
    // numbered scenarios (founder screenshot, 08-05).
    const parts = v.match(/(?:[^.!?]|\.(?=\d))+[.!?]+/g)
    if (parts && parts.length >= 2) return parts.slice(0, 4).map(s => s.trim())
    return [v.trim()]
  }
  return []
}

/* Format a single upcoming-event row — DOW + MMM DD + HH:MM ET + name.
   NOTE the date is rendered in the READER's zone and the clock in ET, so an
   all-day event stamped 00:00 UTC printed as "Thu, Aug 27 · 8:00 PM ET" — two
   different days in one line. All-day events carry no clock at all, so they
   say so. */
function formatEventDateTime(dateStr, allDay = false) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (allDay) return `${date} · all day`
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
  return `${date} · ${time} ET`
}


/* ── Main Component ── */
const MarketOutlook = ({ analysis, loading, upcomingEvents = [] }) => {
  const { t } = useTranslation()

  // Destructure safely — must run BEFORE any hooks that read from analysis
  // and BEFORE the no-data early return below. Moving this early return
  // above the useMemo calls caused React #300 (rendered fewer hooks than
  // expected) once analysis flipped from a value to null between renders.
  const {
    nextKeyEvent,
    expectations,
    fedContext,
    bullCase,
    bearCase,
    weekAhead,
    marketThesis,
    nextEventThesis,
    riskLevel,
    updatedAt,
  } = analysis || {}

  // Split-thesis payloads (writer v3, 2026-06-11): marketThesis is the
  // general read (regime, politics/geopolitics, gold/oil/dollar, AI trade),
  // nextEventThesis covers the next headline macro event. Older payloads
  // only have weekAhead — it stays the fallback lead.
  const leadThesis = marketThesis || weekAhead

  const bullList = asScenarioList(bullCase)
  const bearList = asScenarioList(bearCase)

  // Pull the top 4 future events with at least medium impact. The hook hands
  // us `upcomingEvents` already filtered + sorted. Fall back to nextKeyEvent
  // wrapped as a single item if the live feed didn't populate.
  const keyEvents = useMemo(() => {
    const list = Array.isArray(upcomingEvents) ? upcomingEvents.slice(0, 4) : []
    if (list.length > 0) return list
    if (nextKeyEvent) {
      return [{
        id: 'next-key',
        name: nextKeyEvent.name,
        dateTime: nextKeyEvent.date || nextKeyEvent.dateTime,
        impact: nextKeyEvent.impact || 'high',
        category: nextKeyEvent.category,
      }]
    }
    return []
  }, [upcomingEvents, nextKeyEvent])

  // Compute how long ago the data was updated + whether it's "Live" vs stale.
  // Anything >24h is no longer "Live" — calling a 4-day-old cached analysis
  // "Live" while it quotes outdated F&G / VIX / rate-hike numbers is the
  // exact CPI-bug-class problem we're chasing.
  const { agoLabel, freshness } = useMemo(() => {
    if (!updatedAt) return { agoLabel: '—', freshness: 'unknown' }
    const secsAgo = Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000)
    const label = formatTimeAgo(updatedAt, t)
    // <1h = live, <24h = recent, >24h = stale, >72h = very stale
    let fresh
    if (secsAgo < 3600) fresh = 'live'
    else if (secsAgo < 86400) fresh = 'recent'
    else if (secsAgo < 86400 * 3) fresh = 'stale'
    else fresh = 'very-stale'
    return { agoLabel: label, freshness: fresh }
  }, [updatedAt, t])

  const freshnessText = {
    live: t('economicCalendar.marketOutlook.freshness.live', 'Live'),
    recent: t('economicCalendar.marketOutlook.freshness.recent', 'Recent'),
    stale: t('economicCalendar.marketOutlook.freshness.cached', 'Cached'),
    'very-stale': t('economicCalendar.marketOutlook.freshness.outdated', 'Outdated'),
    unknown: t('economicCalendar.marketOutlook.freshness.cached', 'Cached'),
  }[freshness]

  // Don't render at all if failed to load (no data + not loading).
  // Must come AFTER every hook above so the hook count stays stable across
  // renders — React #300 fires the moment this early return runs after a
  // render that called the useMemo hooks.
  if (!loading && !analysis) return null

  return (
    <div className="mo-card">
      {/* ── Header ── */}
      <div className="mo-card__header">
        <div className="mo-card__header-left">
          <span className="mo-card__dot" />
          <span className="mo-card__label">{t('economicCalendar.marketOutlook.title', 'MARKET OUTLOOK')}</span>
          <InfoTip text={t('economicCalendar.marketOutlook.tooltip', 'AI-generated weekly market outlook. Analyzes upcoming events, Fed positioning, and macro trends to assess risk for crypto.')} position="right" />
        </div>
        <div className="mo-card__header-right" data-freshness={freshness}>
          <span className="mo-card__live-dot" />
          <span className="mo-card__live-text">{freshnessText}</span>
          <span className="mo-card__live-sep">&middot;</span>
          <span className="mo-card__live-text">{agoLabel}</span>
        </div>
      </div>

      {/* 2026-05-26 beta-quality fix: surface stale analyses (this is a
          cached LLM article; without this banner users were reading 4-day-old
          snapshot values labeled "Live"). */}
      {(freshness === 'stale' || freshness === 'very-stale') && (
        <div className="mo-stale-banner" style={{
          padding: '8px 12px',
          margin: '0 12px 8px',
          borderRadius: 8,
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.18)',
          color: 'rgba(245, 158, 11, 0.95)',
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          lineHeight: 1.4,
        }}>
          {t('economicCalendar.marketOutlook.staleBanner', 'Snapshot values in this outlook are from {{when}} — F&G, VIX and rate-decision context may be outdated. Refresh expected on next analysis cycle.', { when: agoLabel })}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && <SkeletonBlock />}

      {/* ── Content ── */}
      {!loading && analysis && (
        <div className="mo-card__content">
          {/* THESIS — the general market read (regime, politics, gold/oil/
              dollar, AI trade). Lead it with an editorial pull quote (first
              sentence in larger weight), same as the Fear & Greed thesis card. */}
          {leadThesis && (() => {
            const trimmed = leadThesis.trim()
            // decimal-safe: "." before a digit is not a sentence end
            const match = trimmed.match(/^((?:[^.!?]|\.(?=\d))+[.!?])\s+(.*)$/s)
            const lead = match ? match[1].trim() : trimmed
            const rest = match ? match[2].trim() : ''
            return (
              <div className="mo-section mo-section--thesis">
                <span className="mo-section__heading">{t('economicCalendar.marketOutlook.thesis', 'THE THESIS')}</span>
                {lead && <p className="mo-section__body mo-editorial">{lead}</p>}
                {rest && <p className="mo-section__body">{rest}</p>}
              </div>
            )
          })()}

          {/* NEXT BIG EVENT — the headline macro event (FOMC/CPI/PCE/NFP/GDP
              tier) with its own thesis: what's priced, where the asymmetry is.
              Survey prelims and secondary central banks never headline here. */}
          {nextEventThesis && (
            <div className="mo-section mo-section--next-event">
              <span className="mo-section__heading">{t('economicCalendar.marketOutlook.nextBigEvent', 'NEXT BIG EVENT')}</span>
              {nextKeyEvent?.name && (
                <p className="mo-section__body mo-editorial">
                  {nextKeyEvent.name}
                  {(nextKeyEvent.dateTime || nextKeyEvent.date) ? ` · ${formatEventDateTime(nextKeyEvent.dateTime || nextKeyEvent.date, nextKeyEvent.allDay)}` : ''}
                </p>
              )}
              <p className="mo-section__body">{nextEventThesis}</p>
            </div>
          )}

          {/* NEXT KEY EVENTS — top 4 upcoming events, plural and prominent.
              This is what the user wanted up top: a scannable agenda for the
              week ahead, not just a single "next event" headline. */}
          {keyEvents.length > 0 && (
            <div className="mo-section mo-section--events">
              <span className="mo-section__heading">{t('economicCalendar.marketOutlook.nextKeyEvents', 'NEXT KEY EVENTS')}</span>
              <ul className="mo-event-list">
                {keyEvents.map((e, i) => {
                  return (
                    <li key={e.id || i} className="mo-event-row">
                      <div className="mo-event-row__body">
                        <span className="mo-event-row__name">{e.name || e.nameShort}</span>
                        <span className="mo-event-row__meta">{formatEventDateTime(e.dateTime || e.date, e.allDay)}</span>
                      </div>
                      {e.category && (
                        <span className="mo-event-row__tag">{e.category}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {/* whyItMatters folds into the NEXT BIG EVENT block when the
                  split-thesis payload provides one — don't say it twice. */}
              {!nextEventThesis && nextKeyEvent?.whyItMatters && (
                <p className="mo-section__body mo-event-row__why">{nextKeyEvent.whyItMatters}</p>
              )}
            </div>
          )}

          {/* Expectations + Fed Context grid */}
          {(expectations || fedContext) && (
            <div className="mo-grid mo-grid--2col">
              {expectations && (
                <div className="mo-inner-card">
                  <span className="mo-section__heading">{t('economicCalendar.marketOutlook.expectations', 'EXPECTATIONS')}</span>
                  <p className="mo-section__body">{expectations}</p>
                </div>
              )}
              {fedContext && (
                <div className="mo-inner-card">
                  <span className="mo-section__heading">{t('economicCalendar.marketOutlook.fedContext', 'FED CONTEXT')}</span>
                  <p className="mo-section__body">{fedContext}</p>
                </div>
              )}
            </div>
          )}

          {/* Crypto Impact — Bull / Bear as multi-scenario playbook lists.
              Each scenario gets a numbered circle in the side's tint, same
              pattern as the F&G thesis card. */}
          {(bullList.length > 0 || bearList.length > 0) && (
            <div className="mo-section">
              <span className="mo-section__heading">{t('economicCalendar.marketOutlook.cryptoImpact', 'CRYPTO IMPACT')}</span>
              <div className="mo-grid mo-grid--2col">
                {bullList.length > 0 && (
                  <div className="mo-inner-card mo-inner-card--bull">
                    <div className="mo-case__header">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M5 1L9 7H1L5 1Z" fill="var(--bull)" />
                      </svg>
                      <span className="mo-case__label mo-case__label--bull">{t('economicCalendar.marketOutlook.bullCase', 'BULL CASE')}</span>
                    </div>
                    <ul className="mo-case-list mo-case-list--bull">
                      {bullList.map((s, i) => <li key={`b-${i}`}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {bearList.length > 0 && (
                  <div className="mo-inner-card mo-inner-card--bear">
                    <div className="mo-case__header">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M5 9L1 3H9L5 9Z" fill="var(--bear)" />
                      </svg>
                      <span className="mo-case__label mo-case__label--bear">{t('economicCalendar.marketOutlook.bearCase', 'BEAR CASE')}</span>
                    </div>
                    <ul className="mo-case-list mo-case-list--bear">
                      {bearList.map((s, i) => <li key={`r-${i}`}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk Level */}
          {riskLevel && <RiskBar level={riskLevel} />}
        </div>
      )}
    </div>
  )
}

export default MarketOutlook
