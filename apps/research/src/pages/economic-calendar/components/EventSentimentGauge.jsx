/**
 * EventSentimentGauge — SVG semicircle gauge showing event sentiment.
 * Adapted from FearGreedGauge arc math (no cross-app import).
 * Two needles: pre-release (lighter) + post-release (full).
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import './EventSentimentGauge.css'

const CX = 100
const CY = 95
const R = 72
const NEEDLE_R = 62

function valToXY(cx, cy, r, v) {
  const angle = Math.PI - (v / 100) * Math.PI
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) }
}

function describeArc(cx, cy, r, fromVal, toVal) {
  const p1 = valToXY(cx, cy, r, fromVal)
  const p2 = valToXY(cx, cy, r, toVal)
  const sweep = ((toVal - fromVal) / 100) * 180
  const large = sweep > 180 ? 1 : 0
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`
}

// Zones: Bearish → Neutral → Bullish
const ZONES = [
  { from: 0, to: 25, color: '#ef4444' },
  { from: 25, to: 45, color: '#f59e0b' },
  { from: 45, to: 55, color: '#94a3b8' },
  { from: 55, to: 75, color: '#22c55e' },
  { from: 75, to: 100, color: '#10b981' },
]

const ZONE_LABELS = ['Bearish', 'Cautious', 'Neutral', 'Bullish', 'Strong Bull']

function getSentimentValue(event) {
  if (!event) return { pre: 50, post: null, label: 'Neutral' }

  // Pre-release: based on impact level
  const impactMap = { critical: 65, high: 58, medium: 50, low: 45 }
  let pre = impactMap[event.impact] || 50

  // Post-release: based on actual vs forecast
  let post = null
  if (event.actual != null && event.forecast != null) {
    const diff = event.actual - event.forecast
    const pct = event.forecast !== 0 ? (diff / Math.abs(event.forecast)) * 100 : 0
    // Map deviation to 0-100 gauge value
    post = Math.max(0, Math.min(100, 50 + pct * 8))
  }

  // Determine label
  const val = post ?? pre
  let label
  if (val < 25) label = ZONE_LABELS[0]
  else if (val < 45) label = ZONE_LABELS[1]
  else if (val < 55) label = ZONE_LABELS[2]
  else if (val < 75) label = ZONE_LABELS[3]
  else label = ZONE_LABELS[4]

  return { pre, post, label }
}

const EventSentimentGauge = ({ event }) => {
  const { t } = useTranslation()
  const { pre, post, label } = useMemo(() => getSentimentValue(event), [event])

  const preNeedle = valToXY(CX, CY, NEEDLE_R, pre)
  const postNeedle = post != null ? valToXY(CX, CY, NEEDLE_R, post) : null

  return (
    <div className="sentiment-gauge">
      <h4 className="sentiment-gauge__title">Event Sentiment <InfoTip text="Pre-release needle (lighter) shows expected sentiment based on impact level. Post-release needle (bright) shows actual market reaction." position="right" /></h4>
      <svg className="sentiment-gauge__svg" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid meet">
        {/* Background track */}
        <path d={describeArc(CX, CY, R, 0, 100)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" strokeLinecap="round" />

        {/* Zone segments */}
        {ZONES.map((z, i) => (
          <path key={i} d={describeArc(CX, CY, R, z.from, z.to)} fill="none" stroke={z.color} strokeWidth="8" strokeLinecap="round" strokeOpacity="0.35" />
        ))}

        {/* Pre-release needle (lighter) */}
        <line x1={CX} y1={CY} x2={preNeedle.x} y2={preNeedle.y}
          stroke="rgba(245,245,247,0.25)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={preNeedle.x} cy={preNeedle.y} r="3" fill="rgba(245,245,247,0.3)" />

        {/* Post-release needle (full) */}
        {postNeedle && (
          <>
            <line x1={CX} y1={CY} x2={postNeedle.x} y2={postNeedle.y}
              stroke="#f5f5f7" strokeWidth="2" strokeLinecap="round" className="sentiment-gauge__needle" />
            <circle cx={postNeedle.x} cy={postNeedle.y} r="4" fill="#f5f5f7" className="sentiment-gauge__needle" />
          </>
        )}

        {/* Center dot */}
        <circle cx={CX} cy={CY} r="3" fill="rgba(245,245,247,0.4)" />

        {/* Labels */}
        <text x="18" y={CY + 14} className="sentiment-gauge__zone-label" textAnchor="start">{t('economicCalendar.bear', 'Bear')}</text>
        <text x="182" y={CY + 14} className="sentiment-gauge__zone-label" textAnchor="end">{t('economicCalendar.bull', 'Bull')}</text>
      </svg>
      <div className="sentiment-gauge__label">{label}</div>
      {post != null && (
        <div className="sentiment-gauge__sub">
          Pre: {Math.round(pre)} → Post: {Math.round(post)}
        </div>
      )}
    </div>
  )
}

export default EventSentimentGauge
