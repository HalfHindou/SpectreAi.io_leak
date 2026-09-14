import { memo } from 'react'

/**
 * SVG arc gauge — circular progress meter for momentum/conviction/sentiment.
 * Receives normalized 0-100 value (sentiment is mapped from -1..+1 -> 0..100
 * by the caller). Color tier is derived from value if not specified.
 *
 * Props:
 *   value      number 0-100 (or null for "no data")
 *   max        number, default 100
 *   tier       'hot' | 'warm' | 'cool' | 'neutral' (auto if omitted)
 *   size       px, default 64
 *   strokeWidth px, default 5
 */
function MetricGauge({ value, max = 100, tier, size = 64, strokeWidth = 5 }) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : null
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const fillRatio = safeValue == null ? 0 : safeValue / max
  // Arc spans 270deg (3/4 of circle) starting at -135deg, leaving a gap at the bottom
  const arcSpan = circumference * 0.75
  const dashOffset = arcSpan * (1 - fillRatio)
  const remaining = circumference - arcSpan

  const autoTier =
    tier ||
    (safeValue == null
      ? 'neutral'
      : safeValue >= 70
      ? 'hot'
      : safeValue >= 40
      ? 'warm'
      : 'cool')

  return (
    <div className="xfv-gauge">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ transform: 'rotate(135deg)' }}
        aria-hidden="true"
      >
        <circle
          className="xfv-gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcSpan} ${remaining}`}
        />
        <circle
          className={`xfv-gauge-fill xfv-gauge-fill--${autoTier}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcSpan} ${remaining}`}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </div>
  )
}

export default memo(MetricGauge)
