/**
 * YouFearGreedHistory — 30/60/90 day Fear & Greed history line chart.
 * Pulls /api/fear-greed/historical?limit=N — renders as canvas sparkline
 * with current value pinned at the right edge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouFearGreedHistory.css'

const RANGES = [
  { label: '30D', limit: 30 },
  { label: '90D', limit: 90 },
  { label: '1Y', limit: 365 },
]

function classifyTone(v) {
  if (v >= 75) return 'extreme-greed'
  if (v >= 55) return 'greed'
  if (v >= 45) return 'neutral'
  if (v >= 25) return 'fear'
  return 'extreme-fear'
}

function classifyLabel(v) {
  if (v >= 75) return 'Extreme Greed'
  if (v >= 55) return 'Greed'
  if (v >= 45) return 'Neutral'
  if (v >= 25) return 'Fear'
  return 'Extreme Fear'
}

export default function YouFearGreedHistory() {
  const [range, setRange] = useState(RANGES[0])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const canvasRef = useRef(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/fear-greed/historical?limit=${range.limit}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      const points = arr.map(d => Number(d.value)).filter(v => !isNaN(v))
      setData(points)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [range.limit])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 5 * 60_000 })

  const summary = useMemo(() => {
    if (!data || data.length === 0) return null
    const current = data[data.length - 1]
    const prior = data[Math.max(0, data.length - 8)]
    const min = Math.min(...data)
    const max = Math.max(...data)
    return { current, prior, delta: current - prior, min, max }
  }, [data])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data || data.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.floor(rect.width * dpr)
    canvas.height = Math.floor(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const pad = { top: 6, right: 6, bottom: 6, left: 6 }
    const w = rect.width - pad.left - pad.right
    const h = rect.height - pad.top - pad.bottom

    // y axis: 0..100
    const yFor = v => pad.top + (1 - v / 100) * h
    const xFor = i => pad.left + (i / (data.length - 1)) * w

    // shaded zones
    const zones = [
      { from: 0, to: 25, color: 'rgba(239,68,68,0.07)' },   // extreme fear
      { from: 25, to: 45, color: 'rgba(245,158,11,0.05)' }, // fear
      { from: 45, to: 55, color: 'rgba(148,163,184,0.04)' },// neutral
      { from: 55, to: 75, color: 'rgba(34,197,94,0.05)' },  // greed
      { from: 75, to: 100, color: 'rgba(34,197,94,0.08)' }, // extreme greed
    ]
    for (const z of zones) {
      ctx.fillStyle = z.color
      ctx.fillRect(pad.left, yFor(z.to), w, yFor(z.from) - yFor(z.to))
    }

    // 50 baseline
    ctx.strokeStyle = 'rgba(148,163,184,0.18)'
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pad.left, yFor(50))
    ctx.lineTo(pad.left + w, yFor(50))
    ctx.stroke()
    ctx.setLineDash([])

    // gradient fill under line
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h)
    grad.addColorStop(0, 'rgba(124, 58, 237, 0.32)')
    grad.addColorStop(1, 'rgba(124, 58, 237, 0)')
    ctx.beginPath()
    ctx.moveTo(xFor(0), yFor(data[0]))
    for (let i = 1; i < data.length; i += 1) ctx.lineTo(xFor(i), yFor(data[i]))
    ctx.lineTo(xFor(data.length - 1), pad.top + h)
    ctx.lineTo(xFor(0), pad.top + h)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // line
    ctx.beginPath()
    ctx.moveTo(xFor(0), yFor(data[0]))
    for (let i = 1; i < data.length; i += 1) ctx.lineTo(xFor(i), yFor(data[i]))
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.95)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // last point dot
    const last = data.length - 1
    ctx.beginPath()
    ctx.arc(xFor(last), yFor(data[last]), 3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(167, 139, 250, 1)'
    ctx.fill()
  }, [data])

  if (loading && !data) return <div className="you-fgh">{[0,1,2].map(i => <div key={i} className="you-shimmer" style={{ height: 18, marginBottom: 6, borderRadius: 4 }} />)}<div className="you-shimmer" style={{ flex: 1, borderRadius: 4 }} /></div>
  if (error || !data || data.length < 2) return <div className="you-fgh-empty">F&amp;G history unavailable.</div>

  const tone = summary ? classifyTone(summary.current) : 'neutral'
  const deltaTone = summary?.delta > 0 ? 'bull' : summary?.delta < 0 ? 'bear' : 'flat'

  return (
    <div className="you-fgh">
      <div className="you-fgh-head">
        <div className="you-fgh-headline">
          <span className={`you-fgh-pill you-fgh-pill--${tone}`}>{summary ? classifyLabel(summary.current) : ''}</span>
          <span className="you-fgh-value mono">{summary?.current ?? '—'}</span>
          {summary && (
            <span className={`you-fgh-delta you-fgh-delta--${deltaTone} mono`}>
              {summary.delta > 0 ? '+' : ''}{summary.delta.toFixed(0)} 7d
            </span>
          )}
        </div>
        <div className="you-fgh-ranges">
          {RANGES.map(r => (
            <button
              key={r.label}
              type="button"
              className={`you-fgh-range${range.label === r.label ? ' you-fgh-range--on' : ''}`}
              onClick={() => setRange(r)}
            >{r.label}</button>
          ))}
        </div>
      </div>
      <div className="you-fgh-canvas-wrap">
        <canvas ref={canvasRef} className="you-fgh-canvas" />
      </div>
      {summary && (
        <div className="you-fgh-foot">
          <span className="you-fgh-stat"><span className="you-fgh-stat-l">Low</span><span className="mono">{summary.min}</span></span>
          <span className="you-fgh-stat"><span className="you-fgh-stat-l">High</span><span className="mono">{summary.max}</span></span>
          <span className="you-fgh-stat"><span className="you-fgh-stat-l">Range</span><span className="mono">{range.label}</span></span>
        </div>
      )}
    </div>
  )
}
