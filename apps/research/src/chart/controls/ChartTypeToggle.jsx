/**
 * ChartTypeToggle - Standalone chart type selector
 *
 * Candle | Line | Area icons.
 * Use outside SpectreChart when you need a separate type toggle.
 *
 * Usage:
 *   <ChartTypeToggle active="candle" onChange={setChartType} />
 */
import { memo } from 'react'

const ICONS = {
  candle: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="2" x2="4" y2="14" />
      <rect x="2" y="5" width="4" height="5" rx="0.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="3" x2="12" y2="13" />
      <rect x="10" y="6" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,12 5,7 9,9 15,3" />
    </svg>
  ),
  area: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1,12 L5,7 L9,9 L15,3 L15,14 L1,14 Z" fill="currentColor" opacity="0.2" />
      <polyline points="1,12 5,7 9,9 15,3" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  ),
}

const TYPES = ['candle', 'line', 'area']

function ChartTypeToggle({ active = 'candle', onChange, className = '' }) {
  return (
    <div className={`sc-types${className ? ` ${className}` : ''}`}>
      {TYPES.map(type => (
        <button
          key={type}
          className={`sc-type-btn${active === type ? ' sc-type-btn--active' : ''}`}
          onClick={() => onChange?.(type)}
          aria-label={type}
        >
          {ICONS[type]}
        </button>
      ))}
    </div>
  )
}

export default memo(ChartTypeToggle)
