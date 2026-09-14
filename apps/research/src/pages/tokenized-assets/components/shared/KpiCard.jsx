import React, { memo, useEffect, useRef } from 'react'
import { useCurrency } from '@/hooks/useCurrency'
import './ta-kpi.css'

function fmtCount(v) {
  if (v == null || Number.isNaN(v)) return '--'
  return v.toLocaleString()
}

function fmtPct(v) {
  if (v == null) return null
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

/* ── Tiny sparkline (24px tall, right-aligned) ── */
function Sparkline({ data, color = 'currentColor', width = 80, height = 24 }) {
  const ref = useRef(null)
  useEffect(() => {
    const cvs = ref.current
    if (!cvs || !data?.length) return
    const dpr = window.devicePixelRatio || 1
    cvs.width = width * dpr
    cvs.height = height * dpr
    cvs.style.width = `${width}px`
    cvs.style.height = `${height}px`
    const ctx = cvs.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)
    const vals = data
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const range = max - min || 1
    const pad = 2
    ctx.beginPath()
    vals.forEach((v, i) => {
      const x = (i / (vals.length - 1)) * (width - pad * 2) + pad
      const y = height - pad - ((v - min) / range) * (height - pad * 2)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()
  }, [data, color, width, height])
  return <canvas ref={ref} className="ta-kpi-spark-canvas" />
}

/* ── KpiCard ── */
const KpiCard = memo(function KpiCard({
  label,
  value,
  format = 'currency', // 'currency' | 'count' | 'raw'
  delta,
  deltaLabel = '30D',
  spark,
  accent,
  hero = false,
  loading = false,
}) {
  const { fmtLargeShort } = useCurrency()
  const pct = fmtPct(delta)
  const bull = delta != null && delta >= 0
  const bear = delta != null && delta < 0
  const sparkColor = bull ? 'var(--bull)' : bear ? 'var(--bear)' : 'var(--text-muted)'

  if (loading) {
    return (
      <div className="ta-kpi ta-kpi--loading">
        <div className="ta-kpi-label-skel animate-shimmer" />
        <div className="ta-kpi-value-skel animate-shimmer stagger-2" />
      </div>
    )
  }

  let display = value
  if (format === 'currency') display = value == null || Number.isNaN(value) ? '--' : fmtLargeShort(value)
  else if (format === 'count') display = fmtCount(value)
  else if (format === 'raw') display = value

  return (
    <div className={`ta-kpi${hero ? ' ta-kpi--hero' : ''}`} style={accent ? { '--ta-kpi-accent': accent } : undefined}>
      <div className="ta-kpi-row">
        <span className="ta-kpi-label">{label}</span>
        {pct && (
          <span className={`ta-kpi-delta ${bull ? 'bull' : bear ? 'bear' : ''}`}>
            <span className="ta-kpi-delta-arrow">{bull ? '\u2191' : bear ? '\u2193' : ''}</span>
            <span className="ta-kpi-delta-val">{pct}</span>
            <span className="ta-kpi-delta-tf">{deltaLabel}</span>
          </span>
        )}
      </div>
      <div className="ta-kpi-value">{display}</div>
      {spark?.length > 0 && (
        <div className="ta-kpi-spark">
          <Sparkline data={spark} color={sparkColor} />
        </div>
      )}
    </div>
  )
})

export default KpiCard
