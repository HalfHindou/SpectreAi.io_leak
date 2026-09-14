/**
 * TimeframeBar - Standalone timeframe selector
 *
 * Use outside SpectreChart when you need a separate timeframe bar
 * (e.g. Traders Corner has its own toolbar above the chart).
 *
 * Usage:
 *   <TimeframeBar active="1H" onChange={setTimeframe} />
 *   <TimeframeBar active="4H" onChange={setTimeframe} timeframes={['1H', '4H', '1D']} />
 */
import { memo } from 'react'

const DEFAULT_TIMEFRAMES = ['1M', '5M', '15M', '30M', '1H', '4H', '12H', '1D', '1W']

function TimeframeBar({
  active = '1H',
  onChange,
  timeframes = DEFAULT_TIMEFRAMES,
  className = '',
}) {
  return (
    <div className={`sc-timeframes${className ? ` ${className}` : ''}`}>
      {timeframes.map(tf => (
        <button
          key={tf}
          className={`sc-tf-btn${active === tf ? ' sc-tf-btn--active' : ''}`}
          onClick={() => onChange?.(tf)}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}

export default memo(TimeframeBar)
