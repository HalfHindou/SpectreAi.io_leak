/**
 * YouTradingViewMini — Lightweight TradingView mini chart widget for the
 * selected token. Uses the public mini-symbol-overview embed so we get a
 * clean candle/area chart without standing up our own chart pipeline.
 * Driven by AppStateContext's selected token like other "selected token"
 * widgets (YouTokenDossier, YouTokenSearch).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/contexts/AppStateContext'
import './YouTradingViewMini.css'

const RANGES = ['1D', '1M', '3M', '12M', '60M']
const FALLBACK_SYMBOL = 'BINANCE:BTCUSDT'

function resolveTvSymbol(selectedToken) {
  const sym = (selectedToken?.symbol || '').toString().toUpperCase()
  if (!sym) return FALLBACK_SYMBOL
  // Most majors have a Binance USDT pair, which TradingView handles cleanly.
  return `BINANCE:${sym}USDT`
}

export default function YouTradingViewMini() {
  const appState = useAppState?.() || {}
  const selected = appState.token || appState.selectedToken || null
  const [range, setRange] = useState('1M')
  const containerRef = useRef(null)
  const [errored, setErrored] = useState(false)

  const tvSymbol = useMemo(() => resolveTvSymbol(selected), [selected])
  const widgetKey = `${tvSymbol}::${range}`

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.innerHTML = ''
    setErrored(false)

    const wrap = document.createElement('div')
    wrap.className = 'tradingview-widget-container'
    wrap.style.height = '100%'
    wrap.style.width = '100%'

    const inner = document.createElement('div')
    inner.className = 'tradingview-widget-container__widget'
    inner.style.height = '100%'
    inner.style.width = '100%'
    wrap.appendChild(inner)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      symbol: tvSymbol,
      width: '100%',
      height: '100%',
      locale: 'en',
      dateRange: range,
      colorTheme: 'dark',
      isTransparent: true,
      autosize: true,
      largeChartUrl: '',
      chartOnly: false,
      noTimeScale: false,
      trendLineColor: 'rgba(167, 139, 250, 1)',
      underLineColor: 'rgba(167, 139, 250, 0.20)',
      underLineBottomColor: 'rgba(167, 139, 250, 0.00)',
    })
    script.onerror = () => setErrored(true)
    wrap.appendChild(script)
    el.appendChild(wrap)

    return () => { el.innerHTML = '' }
  }, [tvSymbol, range, widgetKey])

  return (
    <div className="you-tvm">
      <div className="you-tvm-head">
        <span className="you-tvm-symbol mono">{tvSymbol.replace('BINANCE:', '')}</span>
        <div className="you-tvm-ranges">
          {RANGES.map(r => (
            <button key={r} type="button" className={`you-tvm-range${r === range ? ' you-tvm-range--on' : ''}`} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="you-tvm-frame">
        {errored && <div className="you-tvm-empty">Chart unavailable.</div>}
      </div>
    </div>
  )
}
