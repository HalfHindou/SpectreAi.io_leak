/**
 * ChartToolbar — top bar: segmented type control (left) + timeframe pills (right).
 * Props:
 *   chartType, onChartType   ('line' | 'candle' | 'tv')
 *   timeframe, onTimeframe   current active timeframe value
 *   timeframes               array of timeframe labels to render
 *   tvAvailable              boolean — disables TV button when false
 */
import { useTranslation } from 'react-i18next'

const DEFAULT_TIMEFRAMES = ['1D', '7D', '1M', '3M', '1Y']

function LineIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 11.5 L4.5 7.5 L7 10 L10.5 4.5 L14.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CandleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <line x1="4.5" y1="1.5" x2="4.5" y2="14.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <rect x="3" y="4" width="3" height="7" rx="0.5" fill="currentColor" />
      <line x1="11.5" y1="2.5" x2="11.5" y2="13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <rect x="10" y="6.5" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

function TVIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 14 L10.5 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4 8.5 L6.5 6 L8.5 8 L12 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ChartToolbar({
  chartType, onChartType,
  timeframe, onTimeframe,
  timeframes = DEFAULT_TIMEFRAMES,
  tvAvailable,
}) {
  const { t } = useTranslation()
  return (
    <div className="embed-toolbar">
      <div className="embed-toolbar-types" role="tablist" aria-label={t('embedChart.toolbar.chartTypeAria', 'Chart type')}>
        <button
          type="button"
          role="tab"
          className={`embed-type-btn${chartType === 'line' ? ' embed-type-btn--active' : ''}`}
          onClick={() => onChartType('line')}
          aria-selected={chartType === 'line'}
        >
          <span className="embed-type-btn-icon"><LineIcon /></span>
          <span>{t('embedChart.toolbar.line', 'Line')}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`embed-type-btn${chartType === 'candle' ? ' embed-type-btn--active' : ''}`}
          onClick={() => onChartType('candle')}
          aria-selected={chartType === 'candle'}
        >
          <span className="embed-type-btn-icon"><CandleIcon /></span>
          <span>{t('embedChart.toolbar.candle', 'Candle')}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`embed-type-btn${chartType === 'tv' ? ' embed-type-btn--active' : ''}`}
          onClick={() => tvAvailable && onChartType('tv')}
          aria-selected={chartType === 'tv'}
          disabled={!tvAvailable}
          title={tvAvailable
            ? t('embedChart.toolbar.tvTitleAvailable', 'TradingView')
            : t('embedChart.toolbar.tvTitleUnavailable', 'Not available for this token')}
        >
          <span className="embed-type-btn-icon"><TVIcon /></span>
          <span>{t('embedChart.toolbar.tv', 'TV')}</span>
        </button>
      </div>
      <div className="embed-toolbar-timeframes" role="tablist" aria-label={t('embedChart.toolbar.timeframeAria', 'Timeframe')}>
        {timeframes.map(tf => (
          <button
            key={tf}
            type="button"
            role="tab"
            className={`embed-tf-btn${timeframe === tf ? ' embed-tf-btn--active' : ''}`}
            onClick={() => onTimeframe(tf)}
            aria-selected={timeframe === tf}
          >{tf}</button>
        ))}
      </div>
    </div>
  )
}
