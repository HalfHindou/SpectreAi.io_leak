/**
 * PreIpoChart — live TradingView advanced-chart embed for the featured listing.
 *
 * NASDAQ:SPCX (Space Exploration Technologies Corp) is a real TradingView
 * symbol, so this renders an actual live candle chart on IPO day. Lightweight
 * iframe embed (no script injection) with app-styled timeframe pills + a
 * shimmer placeholder until the frame's load event. Mirrors the traders-corner
 * TradingViewChart widget, restyled for the pre-IPO hero.
 */
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'

const TIMEFRAMES = [
  { label: '15m', interval: '15' },
  { label: '1H', interval: '60' },
  { label: '4H', interval: '240' },
  { label: '1D', interval: 'D' },
  { label: '1W', interval: 'W' },
]

function buildEmbedUrl(symbol, interval, dayMode) {
  const params = new URLSearchParams({
    frameElementId: 'pi_tv_chart',
    symbol,
    interval,
    theme: dayMode ? 'light' : 'dark',
    style: '1',
    hide_top_toolbar: '1',
    hide_side_toolbar: '1',
    hide_legend: '0',
    allow_symbol_change: '0',
    save_image: '0',
    withdateranges: '0',
    backgroundColor: dayMode ? 'rgba(255,255,255,1)' : 'rgba(9,9,11,1)',
    gridColor: dayMode ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)',
    locale: 'en',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}

export default function PreIpoChart({ symbol, label }) {
  const { t } = useTranslation()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const [interval, setIntervalVal] = useState('60')
  const [loaded, setLoaded] = useState(false)
  const iframeRef = useRef(null)

  useEffect(() => { setLoaded(false) }, [interval, dayMode])

  if (!symbol) return null

  return (
    <div className="pi-chart">
      <div className="pi-chart-head">
        <span className="pi-chart-title">
          <span className="pi-status-dot" aria-hidden="true" />
          <span className="pi-chart-sym mono">{label || symbol}</span>
          <span className="pi-chart-src">{t('privateMarkets.preIpo.chart.live')} · TradingView</span>
        </span>
        <div className="pi-chart-tfs" role="group" aria-label={t('privateMarkets.preIpo.chart.timeframe')}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.interval}
              type="button"
              className={`pi-chart-tf${interval === tf.interval ? ' pi-chart-tf-active' : ''}`}
              onClick={() => setIntervalVal(tf.interval)}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pi-chart-frame">
        {!loaded && (
          <div className="pi-chart-loading" aria-hidden="true">
            <div className="pi-skel animate-shimmer" style={{ width: '70%', height: 10 }} />
            <div className="pi-skel animate-shimmer" style={{ width: '55%', height: 10 }} />
            <div className="pi-skel animate-shimmer" style={{ width: '62%', height: 10 }} />
          </div>
        )}
        <iframe
          ref={iframeRef}
          title={`${label || symbol} live chart`}
          src={buildEmbedUrl(symbol, interval, dayMode)}
          onLoad={() => setLoaded(true)}
          frameBorder="0"
          allowtransparency="true"
          scrolling="no"
          loading="lazy"
        />
      </div>
    </div>
  )
}
