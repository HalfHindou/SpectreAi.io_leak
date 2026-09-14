import { useRef, useEffect, useState } from 'react'
import { createChart, CandlestickSeries } from 'lightweight-charts'
import ChartWatermark from '@/components/chart-watermark'

/**
 * Inline candlestick chart for the search engine knowledge panel.
 * Uses TradingView Lightweight Charts (NOT the full TradingViewAdvanced).
 *
 * Props:
 *   bars    — array of { time, open, high, low, close, volume }
 *   symbol  — ticker symbol for the header
 *   height  — chart height in px (default 280)
 */
export default function ChartInline({ bars, symbol, height = 280 }) {
  const containerRef = useRef()
  const chartRef = useRef()
  const [resolution, setResolution] = useState('1H')

  useEffect(() => {
    if (!containerRef.current || !bars || bars.length === 0) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: 'rgba(245, 245, 247, 0.5)',
        fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.02)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.04)',
        scaleMargins: { top: 0.1, bottom: 0.08 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.04)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: 'rgba(16, 185, 129, 0.9)',
      downColor: 'rgba(239, 68, 68, 0.9)',
      borderUpColor: 'rgba(16, 185, 129, 1)',
      borderDownColor: 'rgba(239, 68, 68, 1)',
      wickUpColor: 'rgba(16, 185, 129, 0.7)',
      wickDownColor: 'rgba(239, 68, 68, 0.7)',
    })

    // Normalize bar timestamps to Unix seconds. Handles:
    //   number (ms)   → / 1000
    //   number (sec)  → passthrough
    //   ISO string    → Date.parse / 1000
    //   yyyy-mm-dd    → Date.parse / 1000  (lightweight-charts would accept it, but we coerce for consistency)
    const toSec = (t) => {
      if (typeof t === 'number') return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)
      if (typeof t === 'string') {
        const ms = Date.parse(t)
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
      }
      return null
    }
    const normalized = bars
      .map((b) => ({ time: toSec(b.time), open: b.open, high: b.high, low: b.low, close: b.close }))
      .filter((b) => b.time != null && Number.isFinite(b.open))
      .sort((a, b) => a.time - b.time)

    if (normalized.length === 0) {
      chart.remove()
      return
    }

    series.setData(normalized)
    chart.timeScale().fitContent()
    chartRef.current = { chart, series }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height)
    })
    ro.observe(containerRef.current)

    return () => { ro.disconnect(); chart.remove() }
  }, [bars, height])

  if (!bars || bars.length === 0) return null

  return (
    <div className="se-chart-inline glass-card">
      <div className="se-chart-inline-header">
        <span className="se-chart-inline-title">{symbol}</span>
        <div className="se-chart-inline-tfs">
          {['1H', '4H', '1D', '1W'].map((tf) => (
            <button
              key={tf}
              className={`se-tf-btn${resolution === tf ? ' se-tf-btn--active' : ''}`}
              onClick={() => setResolution(tf)}
            >{tf}</button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="se-chart-inline-canvas spectre-wm-host">
        <ChartWatermark />
      </div>
    </div>
  )
}
