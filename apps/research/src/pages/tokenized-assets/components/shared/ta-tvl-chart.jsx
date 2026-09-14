/**
 * TaTvlChart — compact TVL history hero for the asset drawer.
 * Single-series area chart (the page's RwaInteractiveChart is a heavy stacked
 * multi-series chart and overkill here). Big current TVL + trend delta +
 * timeframe pills + hover readout. Data: tvlHistory [{ date(ms), tvl }].
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { formatValue, hexToRgba, CANVAS_FONT_NUM, CANVAS_FONT_LABEL } from '../rwa-shared'
import useSettingsStore from '@/store/useSettingsStore'
import './ta-tvl-chart.css'

const TFS = [
  { id: '7D', days: 7 },
  { id: '30D', days: 30 },
  { id: '90D', days: 90 },
  { id: '1Y', days: 365 },
  { id: 'All', days: Infinity },
]

const fmtDate = (ms) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/* Catmull-Rom -> bezier smooth line through pts. */
function smoothPath(ctx, pts, t = 0.22) {
  if (pts.length < 2) return
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i], p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) * t, p1.y + (p2.y - p0.y) * t,
      p2.x - (p3.x - p1.x) * t, p2.y - (p3.y - p1.y) * t,
      p2.x, p2.y
    )
  }
}

export default function TaTvlChart({ history = [], currentTvl, loading = false, height = 132 }) {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [tf, setTf] = useState('30D')
  const [cw, setCw] = useState(0)
  const [hover, setHover] = useState(null)
  const [prog, setProg] = useState(0)
  const animRef = useRef(null)

  const series = useMemo(
    () => (history || []).filter((p) => p && p.date != null && p.tvl != null),
    [history]
  )

  const filtered = useMemo(() => {
    if (!series.length || tf === 'All') return series
    const days = TFS.find((t) => t.id === tf)?.days ?? Infinity
    const cutoff = Date.now() - days * 86400000
    const out = series.filter((p) => p.date >= cutoff)
    return out.length >= 2 ? out : series.slice(-2)
  }, [series, tf])

  const first = filtered[0]?.tvl
  const lastPt = filtered[filtered.length - 1]
  const last = currentTvl != null ? currentTvl : lastPt?.tvl
  const changePct =
    first != null && first > 0 && last != null ? ((last - first) / first) * 100 : null
  const up = changePct == null || changePct >= 0
  const lineColor = changePct == null ? '#94A3B8' : up ? '#10B981' : '#EF4444'

  const disp = hover ? hover.tvl : last
  const dispDate = hover ? fmtDate(hover.date) : null

  // Width measurement (wrapper has no negative margins).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => { const w = el.clientWidth; if (w > 0) setCw(w) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Draw-in fade.
  useEffect(() => {
    if (!filtered.length) return
    setProg(0)
    const s = performance.now()
    const go = (t) => {
      const p = Math.min((t - s) / 480, 1)
      setProg(1 - Math.pow(1 - p, 3))
      if (p < 1) animRef.current = requestAnimationFrame(go)
    }
    animRef.current = requestAnimationFrame(go)
    return () => cancelAnimationFrame(animRef.current)
  }, [filtered, tf])

  // Draw.
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs || !cw || filtered.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const w = cw, h = height
    cvs.width = w * dpr; cvs.height = h * dpr
    cvs.style.width = `${w}px`; cvs.style.height = `${h}px`
    const ctx = cvs.getContext('2d')
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h)

    const P = { t: 12, r: 6, b: 12, l: 6 }
    const pw = w - P.l - P.r, ph = h - P.t - P.b
    if (pw <= 0 || ph <= 0) return

    let min = Infinity, max = -Infinity
    for (const p of filtered) { if (p.tvl < min) min = p.tvl; if (p.tvl > max) max = p.tvl }
    if (!isFinite(min) || !isFinite(max)) return
    if (min === max) { min -= 1; max += 1 }
    const span = max - min, padY = span * 0.14
    min -= padY; max += padY

    const xS = (i) => P.l + (i / (filtered.length - 1)) * pw
    const yS = (v) => P.t + ph - ((v - min) / (max - min)) * ph
    const pts = filtered.map((p, i) => ({ x: xS(i), y: yS(p.tvl) }))

    const ink = dayMode ? '15, 23, 42' : '245, 245, 247'
    ctx.globalAlpha = prog

    // Baseline grid (3 faint lines).
    for (let i = 0; i <= 2; i++) {
      const y = Math.round(P.t + (ph / 2) * i) + 0.5
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y)
      ctx.strokeStyle = `rgba(${ink},${dayMode ? 0.06 : 0.03})`; ctx.lineWidth = 1; ctx.stroke()
    }

    // Area fill.
    ctx.beginPath()
    smoothPath(ctx, pts)
    ctx.lineTo(pts[pts.length - 1].x, P.t + ph)
    ctx.lineTo(pts[0].x, P.t + ph)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, P.t, 0, P.t + ph)
    g.addColorStop(0, hexToRgba(lineColor, dayMode ? 0.26 : 0.30))
    g.addColorStop(1, hexToRgba(lineColor, 0.02))
    ctx.fillStyle = g; ctx.fill()

    // Line.
    ctx.beginPath(); smoothPath(ctx, pts)
    ctx.strokeStyle = hexToRgba(lineColor, 0.95); ctx.lineWidth = 2
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()

    // Hover crosshair + dot, else glow dot at last point.
    if (hover?.idx != null && hover.idx >= 0 && hover.idx < pts.length) {
      const { x, y } = pts[hover.idx]
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.t + ph)
      ctx.strokeStyle = `rgba(${ink},${dayMode ? 0.28 : 0.14})`; ctx.lineWidth = 1
      ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([])
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = lineColor; ctx.fill()
      ctx.strokeStyle = dayMode ? '#fff' : 'rgba(9,9,11,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
    } else {
      const lp = pts[pts.length - 1]
      const rg = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, 11)
      rg.addColorStop(0, hexToRgba(lineColor, 0.5)); rg.addColorStop(1, hexToRgba(lineColor, 0))
      ctx.fillStyle = rg
      ctx.beginPath(); ctx.arc(lp.x, lp.y, 11, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(lp.x, lp.y, 3, 0, Math.PI * 2)
      ctx.fillStyle = lineColor; ctx.fill()
      ctx.strokeStyle = dayMode ? '#fff' : 'rgba(9,9,11,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
    }
    ctx.globalAlpha = 1
  }, [filtered, cw, height, prog, hover, dayMode, lineColor])

  const onMove = useCallback((e) => {
    const cvs = canvasRef.current
    if (!cvs || filtered.length < 2) return
    const rect = cvs.getBoundingClientRect()
    const P = { l: 6, r: 6 }
    const pw = rect.width - P.l - P.r
    const rel = e.clientX - rect.left - P.l
    if (rel < 0 || rel > pw) { setHover(null); return }
    const idx = Math.max(0, Math.min(filtered.length - 1, Math.round((rel / pw) * (filtered.length - 1))))
    const pt = filtered[idx]
    const tx = P.l + (idx / (filtered.length - 1)) * pw
    setHover({ idx, date: pt.date, tvl: pt.tvl, tx, side: tx > rect.width * 0.6 ? 'l' : 'r' })
  }, [filtered])

  const onLeave = useCallback(() => setHover(null), [])

  if (loading) {
    return (
      <div className="ta-tvlc" ref={wrapRef}>
        <div className="ta-tvlc-skel animate-shimmer" style={{ height: height + 56 }} />
      </div>
    )
  }
  if (series.length < 2) return null

  return (
    <div className="ta-tvlc" ref={wrapRef}>
      <div className="ta-tvlc-head">
        <div className="ta-tvlc-left">
          <span className="ta-tvlc-label">{dispDate || 'Total Value Locked'}</span>
          <div className="ta-tvlc-val-row">
            <span className="ta-tvlc-val mono">{formatValue(disp)}</span>
            {!hover && changePct != null && (
              <span className={`ta-tvlc-delta ${up ? 'up' : 'down'} mono`}>
                {up ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <div className="ta-tvlc-tfs">
          {TFS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ta-tvlc-tf ${tf === t.id ? 'on' : ''}`}
              onClick={() => setTf(t.id)}
            >
              {t.id}
            </button>
          ))}
        </div>
      </div>
      <div className="ta-tvlc-canvas">
        <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={onLeave} style={{ display: 'block' }} />
      </div>
    </div>
  )
}
