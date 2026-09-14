import { useEffect, useState, useRef, useCallback } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import { dossier } from '@/services/dossierApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import ChartWatermark from '@/components/chart-watermark'
import './dossier-candles.css'

const RANGE_OPTIONS = [
  { label: '1m', hours: 1, resolution: '1' },
  { label: '5m', hours: 4, resolution: '5' },
  { label: '15m', hours: 12, resolution: '15' },
  { label: '1h', hours: 24, resolution: '60' },
  { label: '4h', hours: 168, resolution: '240' },
  { label: '1d', hours: 720, resolution: '1D' },
]

const fmtUsd = (n) => {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1) return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  if (Math.abs(n) >= 0.01) return '$' + n.toFixed(4)
  return '$' + n.toPrecision(4)
}

const CHART_OPTIONS = {
  layout: {
    background: { color: 'transparent' },
    textColor: 'rgba(245,245,247,0.55)',
    fontFamily: '"JetBrains Mono", SF Mono, monospace',
    fontSize: 10,
  },
  grid: {
    vertLines: { color: 'rgba(255,255,255,0.03)' },
    horzLines: { color: 'rgba(255,255,255,0.03)' },
  },
  crosshair: {
    mode: 1,
    vertLine: { color: 'rgba(245,245,247,0.25)', width: 1, style: 3, labelBackgroundColor: '#18181b' },
    horzLine: { color: 'rgba(245,245,247,0.25)', width: 1, style: 3, labelBackgroundColor: '#18181b' },
  },
  rightPriceScale: {
    borderColor: 'rgba(255,255,255,0.06)',
    scaleMargins: { top: 0.06, bottom: 0.24 },
  },
  timeScale: {
    borderColor: 'rgba(255,255,255,0.06)',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 4,
    barSpacing: 8,
  },
  handleScroll: { vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
  handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
}

export default function DossierCandles({ chain, ca, height = 340 }) {
  const [rangeIdx, setRangeIdx] = useState(3) // default 1h (24h window)
  const [bars, setBars] = useState([])
  const [hover, setHover] = useState(null)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candlesRef = useRef(null)
  const volumeRef = useRef(null)
  // 2026-06-16 B1: only fitContent() on first load + range/symbol change, never on
  // a routine same-range poll (it was stomping the user's pan/zoom every 60s).
  const didFitRef = useRef(false)
  const loadReqRef = useRef(0) // supersede stale range fetches (out-of-order resolves)

  const { hours, resolution } = RANGE_OPTIONS[rangeIdx]

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      width: containerRef.current.clientWidth,
      height,
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981', downColor: '#EF4444',
      borderUpColor: '#10B981', borderDownColor: '#EF4444',
      wickUpColor: '#10B981', wickDownColor: '#EF4444',
      priceFormat: {
        type: 'custom',
        formatter: (p) => {
          if (p >= 1) return '$' + p.toFixed(4)
          if (p >= 0.01) return '$' + p.toFixed(5)
          return '$' + p.toPrecision(4)
        },
        minMove: 0.0000001,
      },
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      color: 'rgba(245,245,247,0.3)',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      borderVisible: false,
    })
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !param.seriesData) { setHover(null); return }
      const c = param.seriesData.get(candleSeries)
      const v = param.seriesData.get(volumeSeries)
      if (c) setHover({ t: param.time, o: c.open, h: c.high, l: c.low, c: c.close, v: v?.value })
    })
    chartRef.current = chart
    candlesRef.current = candleSeries
    volumeRef.current = volumeSeries
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return
      chart.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [height])

  // Fetch bars when range/token changes
  const load = useCallback(async () => {
    if (!chain || !ca) return
    const myReq = ++loadReqRef.current
    try {
      setLoading(true)
      const d = await dossier.marketCandles(chain, ca, { hours, resolution })
      if (myReq !== loadReqRef.current) return // a newer range/token load superseded this one
      const next = d.bars || []
      // Bail on an unchanged poll result: same length AND identical last-bar OHLCV.
      // Avoids the setState that re-runs the chart effect (and redraws) for nothing.
      setBars((prev) => {
        if (prev.length === next.length && prev.length > 0) {
          const a = prev[prev.length - 1], b = next[next.length - 1]
          if (a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v) {
            return prev
          }
        }
        return next
      })
    } catch (_) { if (myReq === loadReqRef.current) setBars([]) } finally { if (myReq === loadReqRef.current) setLoading(false) }
  }, [chain, ca, hours, resolution])

  // Reset the fit guard when the range or token changes so the next draw re-fits.
  useEffect(() => { didFitRef.current = false }, [chain, ca, hours, resolution])

  useEffect(() => { load() }, [load])
  // Adaptive poll: slows when hidden, stops once the tab is idle past timeout
  // (replaces the raw setInterval that only guarded document.hidden).
  useAdaptivePolling(load, { interval: 60000 })

  // Apply bars to the chart
  useEffect(() => {
    if (!candlesRef.current || !volumeRef.current) return
    if (!bars.length) {
      candlesRef.current.setData([])
      volumeRef.current.setData([])
      return
    }
    const candleData = bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }))
    const volData = bars.map((b) => ({
      time: b.t,
      value: b.v || 0,
      color: b.c >= b.o ? 'rgba(16,185,129,0.32)' : 'rgba(239,68,68,0.32)',
    }))
    candlesRef.current.setData(candleData)
    volumeRef.current.setData(volData)
    // Only fit on first load / explicit range or symbol change - a routine poll
    // refresh must NOT fight the user's pan/zoom.
    if (!didFitRef.current) {
      chartRef.current.timeScale().fitContent()
      didFitRef.current = true
    }
  }, [bars])

  const first = bars[0]
  const last = bars[bars.length - 1]
  const totalChangePct = first && last ? ((last.c - first.o) / first.o) * 100 : null
  const up = (totalChangePct ?? 0) >= 0

  return (
    <div className="dossier-candles">
      <div className="candles-header">
        <div className="candles-price">
          <span className={`price mono ${up ? 'bull' : 'bear'}`}>{last ? fmtUsd(last.c) : '—'}</span>
          {totalChangePct != null && (
            <span className={`change mono ${up ? 'bull' : 'bear'}`}>
              {totalChangePct >= 0 ? '+' : ''}{totalChangePct.toFixed(2)}% {RANGE_OPTIONS[rangeIdx].label}
            </span>
          )}
          {loading && <span className="candles-loading mono">loading…</span>}
        </div>
        <div className="candles-ranges">
          {RANGE_OPTIONS.map((r, i) => (
            <button key={r.label} className={`range ${i === rangeIdx ? 'active' : ''}`} onClick={() => setRangeIdx(i)}>{r.label}</button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="candles-canvas spectre-wm-host" style={{ height }}>
        <ChartWatermark />
      </div>

      {!loading && !bars.length && <div className="candles-empty-overlay">No candles for this token on {RANGE_OPTIONS[rangeIdx].label}.</div>}

      {hover && (
        <div className="candles-tooltip">
          <span className="mono">{new Date(Number(hover.t) * 1000).toLocaleString()}</span>
          <span><span className="muted">O</span> <span className="mono">{fmtUsd(hover.o)}</span></span>
          <span><span className="muted">H</span> <span className="mono">{fmtUsd(hover.h)}</span></span>
          <span><span className="muted">L</span> <span className="mono">{fmtUsd(hover.l)}</span></span>
          <span><span className="muted">C</span> <span className={`mono ${hover.c >= hover.o ? 'bull' : 'bear'}`}>{fmtUsd(hover.c)}</span></span>
          <span><span className="muted">V</span> <span className="mono">{(hover.v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
        </div>
      )}
    </div>
  )
}
