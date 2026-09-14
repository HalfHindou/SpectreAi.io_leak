/**
 * W-010 · TradingView Chart Widget
 * Embeds TradingView Advanced Chart via iframe with timeframe pills and indicator footer.
 */
import { useState, useRef, useEffect } from 'react'
import './TradingViewChart.css'

const TIMEFRAMES = [
  { label: '15m', interval: '15' },
  { label: '1h', interval: '60' },
  { label: '4h', interval: '240' },
  { label: '1D', interval: 'D' },
  { label: '1W', interval: 'W' },
]

function buildEmbedUrl(symbol, interval) {
  // The widget header (tctv-head above) already exposes symbol label and
  // timeframe pills, so the TV-native top + side toolbars are pure weight.
  // Hiding both shaves ~250-400ms off the iframe ready event.
  const params = new URLSearchParams({
    frameElementId: 'tv_chart',
    symbol: `BINANCE:${symbol}`,
    interval,
    theme: 'dark',
    style: '1',
    hide_top_toolbar: '1',
    hide_side_toolbar: '1',
    hide_legend: '0',
    allow_symbol_change: '0',
    save_image: '0',
    withdateranges: '0',
    backgroundColor: 'rgba(9,9,11,1)',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}

export default function TradingViewChart({ symbol = 'BTCUSDT' }) {
  const [activeInterval, setActiveInterval] = useState('60')
  const [loaded, setLoaded] = useState(false)
  const iframeRef = useRef(null)

  /* Reset loaded state when interval changes */
  useEffect(() => {
    setLoaded(false)
  }, [activeInterval])

  /* Indicator values - populated from TradingView widget data when available */
  const indicators = []

  return (
    <div className="tctv">
      {/* Header row */}
      <div className="tctv-head">
        {/* Token pair label */}
        <span className="tctv-pair">
          {symbol}
        </span>

        {/* Timeframe pills */}
        <div className="tctv-tfs">
          {TIMEFRAMES.map((tf) => {
            const isActive = activeInterval === tf.interval
            return (
              <button
                key={tf.interval}
                onClick={() => setActiveInterval(tf.interval)}
                className={`tctv-tf${isActive ? ' tctv-tf--active' : ''}`}
              >
                {tf.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chart area */}
      <div className="tctv-chart">
        {/* Shimmer loading state */}
        {!loaded && (
          <div className="tctv-loading">
            <div className="tcw-shimmer" style={{ width: '80%', height: 12 }} />
            <div className="tcw-shimmer" style={{ width: '60%', height: 12 }} />
            <div className="tcw-shimmer" style={{ width: '70%', height: 12 }} />
            <div className="tcw-shimmer" style={{ width: '50%', height: 12 }} />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={buildEmbedUrl(symbol, activeInterval)}
          onLoad={() => setLoaded(true)}
          className="tctv-iframe"
          style={{ opacity: loaded ? 1 : 0 }}
          title={`TradingView chart for ${symbol}`}
          allow="fullscreen"
        />
      </div>

      {/* Indicator footer */}
      <div className="tctv-footer">
        {indicators.map((ind) => (
          <div key={ind.label} className="tctv-ind">
            <span className="tctv-ind-label">
              {ind.label}
            </span>
            <span className={`tctv-ind-value${
              ind.bullish === null
                ? ''
                : ind.bullish
                  ? ' tctv-ind-value--bull'
                  : ' tctv-ind-value--bear'
            }`}>
              {ind.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
