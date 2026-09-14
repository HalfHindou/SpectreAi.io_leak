/**
 * ChartToolbar - Combined timeframe + type + extras toolbar
 *
 * Standalone toolbar for pages that need it separate from SpectreChart.
 * Uses the same CSS classes as SpectreChart's built-in toolbar.
 *
 * Usage:
 *   <ChartToolbar
 *     timeframe="1H"
 *     chartType="candle"
 *     onTimeframeChange={setTf}
 *     onChartTypeChange={setType}
 *   />
 */
import { memo } from 'react'
import TimeframeBar from './TimeframeBar'
import ChartTypeToggle from './ChartTypeToggle'

function ChartToolbar({
  timeframe = '1H',
  chartType = 'candle',
  onTimeframeChange,
  onChartTypeChange,
  timeframes,
  source,
  children,
  className = '',
}) {
  return (
    <div className={`sc-toolbar${className ? ` ${className}` : ''}`}>
      <TimeframeBar active={timeframe} onChange={onTimeframeChange} timeframes={timeframes} />
      {children}
      <ChartTypeToggle active={chartType} onChange={onChartTypeChange} />
      {source && <span className="sc-source">{source}</span>}
    </div>
  )
}

export default memo(ChartToolbar)
