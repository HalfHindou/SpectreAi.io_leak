/**
 * FearGreedGauge — Cinematic gauge with segmented arc, animated needle,
 * tick marks, sentiment glow, and period comparisons.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import IButton from '@/components/intelligence/IButton'

const CLASS_MAP = {
  'Extreme Greed': 'fearGreed.extremeGreed',
  'Greed': 'fearGreed.greed',
  'Neutral': 'fearGreed.neutral',
  'Fear': 'fearGreed.fear',
  'Extreme Fear': 'fearGreed.extremeFear',
}

/* 5 sentiment zones with their color stops */
const ZONES = [
  { min: 0, max: 25, color: '#ef4444', label: 'Extreme Fear' },
  { min: 25, max: 45, color: '#f97316', label: 'Fear' },
  { min: 45, max: 55, color: '#eab308', label: 'Neutral' },
  { min: 55, max: 75, color: '#84cc16', label: 'Greed' },
  { min: 75, max: 100, color: '#10b981', label: 'Extreme Greed' },
]

function sentimentColor(v) {
  if (v <= 25) return { r: 239, g: 68, b: 68, hex: '#ef4444' }
  if (v <= 45) return { r: 249, g: 115, b: 22, hex: '#f97316' }
  if (v <= 55) return { r: 234, g: 179, b: 8, hex: '#eab308' }
  if (v <= 75) return { r: 132, g: 204, b: 22, hex: '#84cc16' }
  return { r: 16, g: 185, b: 129, hex: '#10b981' }
}

function sentimentKey(v) {
  if (v >= 56) return 'greed'
  if (v <= 45) return 'fear'
  return 'neutral'
}

/**
 * Convert gauge value (0–100) to SVG point on the top semicircle.
 * 0 = left end, 100 = right end.
 */
function valToXY(cx, cy, r, v) {
  const angle = Math.PI - (v / 100) * Math.PI // 180° at 0, 0° at 100
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) }
}

/** Draw an arc segment along the top semicircle from fromVal to toVal (0–100) */
function describeArc(cx, cy, r, fromVal, toVal) {
  const p1 = valToXY(cx, cy, r, fromVal)
  const p2 = valToXY(cx, cy, r, toVal)
  const sweep = (toVal - fromVal) / 100 * 180
  const large = sweep > 180 ? 1 : 0
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`
}

function FearGreedGauge({ value, classification, history, loading, dayMode }) {
  const { t } = useTranslation()

  const numValue = value ?? 0
  const sentiment = sentimentKey(numValue)
  const sc = sentimentColor(numValue)

  /* SVG layout — 180° arc from left to right */
  const cx = 120, cy = 108, radius = 88, sw = 14
  const viewW = 240, viewH = 130

  /* Day-mode aware SVG colors. The inline `stroke`/`fill` attributes win
     over any CSS rule, so day-mode must be switched here rather than in
     the stylesheet. Light-mode values mirror the dark warm-white at the
     same alpha so the gauge keeps the same visual weight on both surfaces. */
  const arcTrackColor = dayMode ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.035)'
  const skeletonTrackColor = dayMode ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.04)'
  const skeletonWaveColor = dayMode ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.06)'
  const tickStrokeColor = dayMode ? 'rgba(15,23,42,0.22)' : 'rgba(255,255,255,0.18)'
  const needleStrokeColor = dayMode ? '#0f172a' : '#f5f5f7'
  const pivotOuterFill = dayMode ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.05)'
  const pivotInnerFill = dayMode ? '#0f172a' : '#f5f5f7'
  const skeletonPivotFill = dayMode ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.06)'

  /* Convert 0-100 value to angle: 180° (left) → 0° (right) */
  const valueAngle = 180 - (numValue / 100) * 180
  const needleLen = radius - 22
  const needleRad = (valueAngle * Math.PI) / 180
  const nx = cx + needleLen * Math.cos(needleRad)
  const ny = cy - needleLen * Math.sin(needleRad)

  /* Zone arcs — each zone maps to a segment of the 180° arc */
  const zoneArcs = useMemo(() => {
    return ZONES.map(z => ({
      ...z,
      d: describeArc(cx, cy, radius, z.min, z.max),
    }))
  }, [])

  /* Filled arc from 0 up to current value */
  const filledArc = useMemo(() => {
    if (numValue <= 0) return ''
    return describeArc(cx, cy, radius, 0, Math.min(100, numValue))
  }, [numValue])

  /* Tick marks at 0, 25, 50, 75, 100 */
  const ticks = useMemo(() => {
    const outerR = radius + sw / 2 + 2
    const innerR = radius + sw / 2 + 8
    const labelR = innerR + 10
    return [0, 25, 50, 75, 100].map(v => {
      const p1 = valToXY(cx, cy, outerR, v)
      const p2 = valToXY(cx, cy, innerR, v)
      const pl = valToXY(cx, cy, labelR, v)
      return { v, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, lx: pl.x, ly: pl.y }
    })
  }, [])

  const comparisons = useMemo(() => {
    if (!history?.length || value == null) return { day: null, week: null, month: null }
    const len = history.length
    const get = (off) => { const i = len - off; return i >= 0 && history[i]?.value != null ? value - history[i].value : null }
    return { day: len >= 2 ? get(2) : null, week: len >= 8 ? get(8) : null, month: len >= 31 ? get(31) : null }
  }, [history, value])

  // Normalize CMC classification (e.g. "Extreme fear") to title case for CLASS_MAP lookup
  const normalizedClass = classification ? classification.replace(/\b\w/g, c => c.toUpperCase()) : ''
  const classLabel = CLASS_MAP[normalizedClass] ? t(CLASS_MAP[normalizedClass]) : normalizedClass || '—'

  if (loading) {
    return (
      <div className="fg-gauge-card fg-card" data-sentiment="neutral">
        <div className="fg-gauge-head">
          <span className="fg-section-label">{t('fearGreed.title')}</span>
          <div className="fg-skeleton-text" style={{ width: 56, height: 22, borderRadius: 20 }} />
        </div>
        <div className="fg-gauge-visual">
          <svg className="fg-gauge-svg" viewBox={`0 0 ${viewW} ${viewH}`} preserveAspectRatio="xMidYMax meet">
            {/* Skeleton arc track */}
            <path
              d={describeArc(cx, cy, radius, 0, 100)}
              fill="none"
              stroke={skeletonTrackColor}
              strokeWidth={sw}
              strokeLinecap="round"
            />
            {/* Animated shimmer arc */}
            <path
              d={describeArc(cx, cy, radius, 0, 60)}
              fill="none"
              stroke={skeletonWaveColor}
              strokeWidth={sw}
              strokeLinecap="round"
              className="fg-skeleton-wave"
            />
            {/* Tick marks */}
            {[0, 25, 50, 75, 100].map(v => {
              const outerR = radius + sw / 2 + 2
              const innerR = radius + sw / 2 + 8
              const p1 = valToXY(cx, cy, outerR, v)
              const p2 = valToXY(cx, cy, innerR, v)
              return <line key={v} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={skeletonWaveColor} strokeWidth="1" strokeLinecap="round" />
            })}
            {/* Center pivot */}
            <circle cx={cx} cy={cy} r="3" fill={skeletonPivotFill} />
          </svg>
        </div>
        <div className="fg-gauge-value-display">
          <div className="fg-skeleton-text fg-skeleton-gauge-number" />
          <div className="fg-skeleton-text fg-skeleton-gauge-label" />
        </div>
        <div className="fg-gauge-comparisons">
          <div className="fg-skeleton-text" style={{ width: 48, height: 20, borderRadius: 4 }} />
          <div className="fg-skeleton-text" style={{ width: 48, height: 20, borderRadius: 4 }} />
          <div className="fg-skeleton-text" style={{ width: 48, height: 20, borderRadius: 4 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="fg-gauge-card fg-card" data-sentiment={sentiment} role="region" aria-label={`Fear and Greed Index: ${numValue} - ${classLabel}`}>
      {/* Ambient sentiment glow */}
      <div
        className="fg-gauge-glow"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 55%, rgba(${sc.r},${sc.g},${sc.b},0.08) 0%, rgba(${sc.r},${sc.g},${sc.b},0.02) 50%, transparent 80%)`,
        }}
      />

      <div className="fg-gauge-head">
        <span className="fg-section-label">{t('fearGreed.title')}<InfoTip text={t('fearGreedPage.indexTip')} position="right" /></span>
        {value != null && (
          <span className="fg-gauge-pill" style={{ borderColor: `rgba(${sc.r},${sc.g},${sc.b},0.2)` }}>
            <span className="fg-gauge-pill-val" style={{ color: sc.hex }}>{numValue}</span>
            <span className="fg-gauge-pill-max">/100</span>
          </span>
        )}
      </div>

      <div className="fg-gauge-visual">
        <svg className="fg-gauge-svg" viewBox={`0 0 ${viewW} ${viewH}`} preserveAspectRatio="xMidYMax meet">
          <defs>
            {/* Soft glow for filled arc */}
            <filter id="fg-arc-glow-v2" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Subtle needle glow */}
            <filter id="fg-needle-glow-v2">
              <feGaussianBlur stdDeviation="1" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Background track */}
          <path
            d={describeArc(cx, cy, radius, 0, 100)}
            fill="none"
            stroke={arcTrackColor}
            strokeWidth={sw}
            strokeLinecap="round"
          />

          {/* Zone segment arcs — colored bands */}
          {zoneArcs.map((z, i) => (
            <path
              key={i}
              d={z.d}
              fill="none"
              stroke={z.color}
              strokeWidth={sw}
              strokeLinecap="butt"
              opacity="0.18"
            />
          ))}

          {/* Filled arc glow — soft bloom */}
          {filledArc && (
            <path
              d={filledArc}
              fill="none"
              stroke={sc.hex}
              strokeWidth={sw + 4}
              strokeLinecap="round"
              opacity="0.10"
              filter="url(#fg-arc-glow-v2)"
            />
          )}

          {/* Filled arc — solid sentiment color */}
          {filledArc && (
            <path
              d={filledArc}
              fill="none"
              stroke={sc.hex}
              strokeWidth={sw}
              strokeLinecap="round"
              opacity="0.85"
              className="fg-gauge-arc-fill"
            />
          )}

          {/* Tick marks */}
          {ticks.map((tk, i) => (
            <g key={i}>
              <line
                x1={tk.x1} y1={tk.y1}
                x2={tk.x2} y2={tk.y2}
                stroke={tickStrokeColor}
                strokeWidth="1"
                strokeLinecap="round"
              />
              <text
                x={tk.lx}
                y={tk.ly}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fg-gauge-tick"
              >
                {tk.v}
              </text>
            </g>
          ))}

          {/* Needle */}
          <g className="fg-gauge-needle-group">
            {/* Needle line — thin and elegant */}
            <line
              x1={cx}
              y1={cy}
              x2={nx}
              y2={ny}
              stroke={needleStrokeColor}
              strokeWidth="1.8"
              strokeLinecap="round"
              filter="url(#fg-needle-glow-v2)"
              opacity="0.85"
            />
            {/* Needle tip — small accent dot */}
            <circle cx={nx} cy={ny} r="2.5" fill={sc.hex} />
            {/* Center pivot */}
            <circle cx={cx} cy={cy} r="5" fill={pivotOuterFill} />
            <circle cx={cx} cy={cy} r="3" fill={pivotInnerFill} opacity="0.9" />
          </g>
        </svg>
      </div>

      {/* Value display */}
      <div className="fg-gauge-value-display">
        <span className="fg-gauge-number" style={{ color: sc.hex }}>{numValue}</span>
        <IButton size="sm" metricType="fear-greed" metricValue={`${numValue}/100 — ${classLabel}`} metricLabel="Fear & Greed Index" />
        <span className="fg-gauge-classification" data-sentiment={sentiment}>{classLabel}</span>
      </div>

      {/* Period comparisons */}
      <div className="fg-gauge-comparisons">
        <InfoTip text={t('fearGreedPage.comparisonsTip')} position="bottom" />
        {comparisons.day != null && (
          <span className="fg-comparison" data-direction={comparisons.day >= 0 ? 'up' : 'down'}>
            <span className="fg-comparison-label">1d</span>
            <span className="fg-comparison-arrow">{comparisons.day >= 0 ? '↑' : '↓'}</span>
            <span className="fg-comparison-value">{comparisons.day >= 0 ? '+' : ''}{comparisons.day}</span>
          </span>
        )}
        {comparisons.week != null && (
          <span className="fg-comparison" data-direction={comparisons.week >= 0 ? 'up' : 'down'}>
            <span className="fg-comparison-label">7d</span>
            <span className="fg-comparison-arrow">{comparisons.week >= 0 ? '↑' : '↓'}</span>
            <span className="fg-comparison-value">{comparisons.week >= 0 ? '+' : ''}{comparisons.week}</span>
          </span>
        )}
        {comparisons.month != null && (
          <span className="fg-comparison" data-direction={comparisons.month >= 0 ? 'up' : 'down'}>
            <span className="fg-comparison-label">30d</span>
            <span className="fg-comparison-arrow">{comparisons.month >= 0 ? '↑' : '↓'}</span>
            <span className="fg-comparison-value">{comparisons.month >= 0 ? '+' : ''}{comparisons.month}</span>
          </span>
        )}
      </div>
    </div>
  )
}

export default React.memo(FearGreedGauge)
