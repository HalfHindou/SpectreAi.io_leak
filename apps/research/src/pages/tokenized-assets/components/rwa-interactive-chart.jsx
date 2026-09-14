import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { formatValue, hexToRgba, CANVAS_FONT_NUM, CANVAS_FONT_LABEL } from './rwa-shared'
import RwaEmptyState from './shared/RwaEmptyState'
import useSettingsStore from '@/store/useSettingsStore'

/* ── Font ── */
const FONT_NUM = CANVAS_FONT_NUM
const FONT_LABEL = CANVAS_FONT_LABEL

/* ── Formatters ── */
const fmtVal = formatValue

const fmtDateAxis = (ts) => {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

const fmtDateFull = (ts) => {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/* ── Timeframes ── */
const TIMEFRAMES = [
  { id: '1M', days: 30 },
  { id: '3M', days: 90 },
  { id: '6M', days: 180 },
  { id: '1Y', days: 365 },
  { id: '2Y', days: 730 },
  { id: 'All', days: Infinity },
]

function filterByTimeframe(series, tfId) {
  if (!series?.length || tfId === 'All') return series
  const tf = TIMEFRAMES.find(t => t.id === tfId)
  if (!tf) return series
  const cutoff = (Date.now() / 1000) - (tf.days * 86400)
  return series.filter(p => p.date >= cutoff)
}

/* ── Smooth bezier path ──
 *
 * `continuation=true` skips the initial moveTo and appends bezier segments
 * to the current subpath (used when filling a closed polygon made of two
 * smooth edges — otherwise the second moveTo starts a new subpath and the
 * implicit fill-close draws a visible diagonal across the plot).
 */
function smoothPath(ctx, pts, t = 0.25, continuation = false) {
  if (pts.length < 2) return
  if (continuation) {
    ctx.lineTo(pts[0].x, pts[0].y)
  } else {
    ctx.moveTo(pts[0].x, pts[0].y)
  }
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

/* ── Modes ── */
const MODES = [
  { id: 'stacked', label: 'Stacked' },
  { id: 'lines', label: 'Lines' },
  { id: 'pct', label: '% Share' },
]

/* ══════════════════════════════════════════
   RwaInteractiveChart
   ══════════════════════════════════════════ */

export default function RwaInteractiveChart({
  title = 'Total RWA Value',
  subtitle,
  series = [],
  categories = [],
  colors = {},
  loading = false,
  height = 260,
  defaultTimeframe = '1Y',
  currentTotal,
  showModeToggle = true,
  showTimeframes = true,
  valueFormat = 'currency',
}) {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [tf, setTf] = useState(defaultTimeframe)
  // Sync internal tf when the parent changes the prop (e.g. TimeframePills click).
  // Without this the chart's internal state stays pinned to the initial-mount value
  // and the parent pills appear dead after the first render.
  useEffect(() => { setTf(defaultTimeframe) }, [defaultTimeframe])
  const [hidden, setHidden] = useState(new Set())
  const [hover, setHover] = useState(null)
  const [cw, setCw] = useState(0)
  const [mode, setMode] = useState('stacked')
  const animRef = useRef(null)
  const [prog, setProg] = useState(0)

  const isStacked = mode === 'stacked'
  const isPct = mode === 'pct'

  const filtered = useMemo(() => filterByTimeframe(series, tf), [series, tf])
  const visCats = useMemo(() => categories.filter(c => !hidden.has(c)), [categories, hidden])

  const total = useMemo(() => {
    if (currentTotal != null) return currentTotal
    if (!filtered?.length || !visCats.length) return 0
    const last = filtered[filtered.length - 1]
    return visCats.reduce((s, c) => s + (last[c] || 0), 0)
  }, [filtered, visCats, currentTotal])

  const changePct = useMemo(() => {
    if (!filtered?.length || filtered.length < 2) return null
    const f = filtered[0], l = filtered[filtered.length - 1]
    const fT = visCats.reduce((s, c) => s + (f[c] || 0), 0)
    const lT = visCats.reduce((s, c) => s + (l[c] || 0), 0)
    if (fT <= 0) return null
    return ((lT - fT) / fT) * 100
  }, [filtered, visCats])

  const toggleCat = useCallback((c) => {
    setHidden(p => {
      const n = new Set(p)
      if (n.has(c)) n.delete(c)
      else if (categories.length - n.size > 1) n.add(c)
      return n
    })
  }, [categories])

  // Animation
  useEffect(() => {
    if (!filtered?.length) return
    setProg(0)
    const s = performance.now()
    const go = (t) => {
      const p = Math.min((t - s) / 500, 1)
      setProg(1 - Math.pow(1 - p, 3))
      if (p < 1) animRef.current = requestAnimationFrame(go)
    }
    animRef.current = requestAnimationFrame(go)
    return () => cancelAnimationFrame(animRef.current)
  }, [filtered, visCats, mode])

  // Width measurement — measure the WRAPPER (which doesn't have negative margins)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) setCw(w)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Re-measure when data arrives
  useEffect(() => {
    if (!series?.length || !wrapRef.current) return
    requestAnimationFrame(() => {
      const w = wrapRef.current?.clientWidth
      if (w > 0) setCw(w)
    })
  }, [series])

  // ── Draw ──
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs || !cw || !filtered?.length || !visCats.length) return

    const dpr = window.devicePixelRatio || 1
    const w = cw, h = height
    cvs.width = w * dpr
    cvs.height = h * dpr
    cvs.style.width = `${w}px`
    cvs.style.height = `${h}px`
    const ctx = cvs.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const P = { t: 16, r: 16, b: 32, l: 56 }
    const pw = w - P.l - P.r, ph = h - P.t - P.b
    if (pw <= 0 || ph <= 0) return

    // Build data
    const data = filtered.map(pt => {
      const v = {}, r = {}
      let cum = 0
      for (const c of visCats) {
        const val = (pt[c] || 0) * prog
        r[c] = val; cum += val; v[c] = { val, top: cum }
      }
      const tot = cum
      if (isPct && tot > 0) {
        let cp = 0
        for (const c of visCats) { const p = (r[c] / tot) * 100; cp += p; v[c] = { val: p, top: cp } }
      }
      return { date: pt.date, v, tot }
    })

    let maxY
    if (isPct) {
      maxY = 100
    } else if (isStacked) {
      let m = 1
      for (const d of data) { if (d.tot > m) m = d.tot }
      maxY = m * 1.06
    } else {
      let m = 1
      for (const d of data) {
        for (const c of visCats) {
          const val = d.v[c]?.val || 0
          if (val > m) m = val
        }
      }
      maxY = m * 1.06
    }

    const yS = v => P.t + ph - (v / maxY) * ph
    const xS = i => P.l + (i / Math.max(data.length - 1, 1)) * pw

    // Day-mode-aware ink (chart chrome only — data colours stay as-is).
    const ink = dayMode ? '15, 23, 42' : '245, 245, 247'

    // Grid
    const GL = 5
    for (let i = 0; i <= GL; i++) {
      const y = Math.round(P.t + (ph / GL) * i) + 0.5
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y)
      ctx.strokeStyle = `rgba(${ink},${dayMode ? 0.07 : 0.025})`; ctx.lineWidth = 1; ctx.stroke()
    }

    // Y labels
    ctx.font = `500 10px ${FONT_NUM}`; ctx.fillStyle = `rgba(${ink},${dayMode ? 0.55 : 0.25})`
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    for (let i = 0; i <= GL; i++) {
      const y = P.t + (ph / GL) * i, val = maxY - (maxY / GL) * i
      ctx.fillText(isPct ? `${val.toFixed(0)}%` : fmtVal(val), P.l - 8, y)
    }

    // X labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.font = `450 9px ${FONT_LABEL}`; ctx.fillStyle = `rgba(${ink},${dayMode ? 0.5 : 0.2})`
    const xN = Math.min(7, data.length), xStep = Math.max(Math.floor((data.length - 1) / xN), 1)
    for (let i = 0; i < data.length; i += xStep) {
      ctx.fillText(fmtDateAxis(data[i].date), xS(i), h - P.b + 8)
    }
    if (data.length > 1) ctx.fillText(fmtDateAxis(data[data.length - 1].date), xS(data.length - 1), h - P.b + 8)

    // ── Areas / Lines ──
    if (isStacked || isPct) {
      const rev = [...visCats].reverse()
      for (const cat of rev) {
        const col = colors[cat] || '#94A3B8'
        const ci = visCats.indexOf(cat)
        const upper = data.map((d, i) => ({ x: xS(i), y: yS(d.v[cat].top) }))
        const lower = data.map((d, i) => {
          const prev = ci > 0 ? d.v[visCats[ci - 1]].top : 0
          return { x: xS(i), y: yS(prev) }
        }).reverse()

        ctx.beginPath()
        smoothPath(ctx, upper, 0.2)
        smoothPath(ctx, lower, 0.2, true)
        ctx.closePath()

        const g = ctx.createLinearGradient(0, P.t, 0, h - P.b)
        g.addColorStop(0, hexToRgba(col, 0.55))
        g.addColorStop(0.5, hexToRgba(col, 0.2))
        g.addColorStop(1, hexToRgba(col, 0.04))
        ctx.fillStyle = g; ctx.fill()

        ctx.beginPath(); smoothPath(ctx, upper, 0.2)
        ctx.strokeStyle = hexToRgba(col, 0.85); ctx.lineWidth = 1.5; ctx.stroke()
      }
    } else {
      for (const cat of visCats) {
        const col = colors[cat] || '#94A3B8'
        const pts = data.map((d, i) => ({ x: xS(i), y: yS(d.v[cat].val) }))

        ctx.beginPath(); smoothPath(ctx, pts, 0.2)
        ctx.lineTo(xS(data.length - 1), yS(0)); ctx.lineTo(xS(0), yS(0)); ctx.closePath()
        const g = ctx.createLinearGradient(0, P.t, 0, h - P.b)
        g.addColorStop(0, hexToRgba(col, 0.2)); g.addColorStop(1, hexToRgba(col, 0.01))
        ctx.fillStyle = g; ctx.fill()

        ctx.beginPath(); smoothPath(ctx, pts, 0.2)
        ctx.strokeStyle = hexToRgba(col, 0.9); ctx.lineWidth = 2; ctx.stroke()
      }
    }

    // Crosshair
    if (hover?.idx != null && hover.idx >= 0 && hover.idx < data.length) {
      const x = xS(hover.idx)
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, h - P.b)
      ctx.strokeStyle = `rgba(${ink},${dayMode ? 0.28 : 0.12})`; ctx.lineWidth = 1
      ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([])

      for (const cat of visCats) {
        const col = colors[cat] || '#94A3B8'
        const y = (isStacked || isPct) ? yS(data[hover.idx].v[cat].top) : yS(data[hover.idx].v[cat].val)
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = col; ctx.fill()
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke()
      }
    }

    // Current-value guide + glow dot at last bar (skip while hovering to avoid visual clutter)
    if (!hover && data.length > 1) {
      const lastIdx = data.length - 1
      const lastX = xS(lastIdx)
      const lastTop = (isStacked || isPct)
        ? yS(data[lastIdx].tot)
        : Math.min(...visCats.map(c => yS(data[lastIdx].v[c]?.val || 0)))

      // Horizontal dashed guide at current total level
      ctx.save()
      ctx.beginPath(); ctx.moveTo(P.l, lastTop); ctx.lineTo(lastX, lastTop)
      ctx.strokeStyle = `rgba(${ink},${dayMode ? 0.2 : 0.09})`; ctx.lineWidth = 1
      ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([])
      ctx.restore()

      // Pulsing glow dot at last point of top-most series
      const topCat = isStacked || isPct ? visCats[visCats.length - 1] : visCats[0]
      const topCol = colors[topCat] || '#f5f5f7'
      ctx.save()
      const g = ctx.createRadialGradient(lastX, lastTop, 0, lastX, lastTop, 12)
      g.addColorStop(0, hexToRgba(topCol, 0.5))
      g.addColorStop(1, hexToRgba(topCol, 0))
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(lastX, lastTop, 12, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(lastX, lastTop, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = topCol; ctx.fill()
      ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.restore()
    }

    // Watermark
    ctx.save()
    ctx.font = `600 10px ${FONT_LABEL}`; ctx.fillStyle = `rgba(${ink},${dayMode ? 0.06 : 0.045})`
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillText('SPECTRE', w - P.r - 2, h - P.b - 6)
    ctx.restore()
  }, [filtered, visCats, colors, prog, hover, cw, height, mode, isStacked, isPct, dayMode])

  // Mouse
  const onMove = useCallback((e) => {
    const cvs = canvasRef.current
    if (!cvs || !filtered?.length) return
    const rect = cvs.getBoundingClientRect()
    const x = e.clientX - rect.left
    const P = { l: 56, r: 16 }
    const pw = rect.width - P.l - P.r
    const rel = x - P.l
    if (rel < 0 || rel > pw) { setHover(null); return }
    const idx = Math.round((rel / pw) * (filtered.length - 1))
    const ci = Math.max(0, Math.min(filtered.length - 1, idx))
    const pt = filtered[ci]
    const bd = visCats.map(c => ({ cat: c, val: pt[c] || 0, col: colors[c] || '#94A3B8' }))
    const tot = bd.reduce((s, b) => s + b.val, 0)
    const tx = P.l + (ci / Math.max(filtered.length - 1, 1)) * pw
    setHover({ idx: ci, date: pt.date, bd, tot, tx, side: tx > rect.width * 0.6 ? 'l' : 'r' })
  }, [filtered, visCats, colors])

  const onLeave = useCallback(() => setHover(null), [])

  // Share
  const shareX = useCallback(() => {
    const t = fmtVal(total)
    const ch = changePct != null ? ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)` : ''
    const txt = `${title}: ${t}${ch}\n\nTracked on @SpectreApp\nspectre.app/tokenized-assets`
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(txt)}`, '_blank', 'noopener,noreferrer,width=550,height=420')
  }, [title, total, changePct])

  // Loading
  if (loading) {
    return (
      <div className="ric" ref={wrapRef}>
        <div className="ric-head"><span className="ric-title">{title}</span></div>
        <div className="ric-skel animate-shimmer" style={{ height }} />
      </div>
    )
  }

  if (!series?.length) {
    return (
      <div className="ric" ref={wrapRef}>
        <div className="ric-head"><span className="ric-title">{title}</span></div>
        <div className="ric-empty">
          <RwaEmptyState
            framed={false}
            title="No history yet"
            copy="This series has no data for the selected range."
          />
        </div>
      </div>
    )
  }

  const dispTotal = hover ? hover.tot : total
  const dispDate = hover ? fmtDateFull(hover.date) : null

  return (
    <div className="ric" ref={wrapRef}>
      {/* Header */}
      <div className="ric-head">
        <div className="ric-left">
          <div className="ric-title-row">
            <span className="ric-title">{title}</span>
            {subtitle && <span className="ric-sub">{subtitle}</span>}
          </div>
          <div className="ric-val-row">
            <span className="ric-total">{fmtVal(dispTotal)}</span>
            {!hover && changePct != null && (
              <span className={`ric-change ${changePct >= 0 ? 'up' : 'down'}`}>
                {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
              </span>
            )}
            {dispDate && <span className="ric-date">{dispDate}</span>}
          </div>
        </div>
        <div className="ric-ctrls">
          <button type="button" className="ric-share" onClick={shareX} title="Share on X">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </button>
          {showModeToggle && categories.length > 1 && (
            <div className="ric-modes">
              {MODES.map(m => (
                <button key={m.id} type="button" className={`ric-mode ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>{m.label}</button>
              ))}
            </div>
          )}
          {showTimeframes && (
            <div className="ric-tfs">
              {TIMEFRAMES.map(t => (
                <button key={t.id} type="button" className={`ric-tf ${tf === t.id ? 'on' : ''}`} onClick={() => setTf(t.id)}>{t.id}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="ric-canvas">
        <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={onLeave} style={{ display: 'block', cursor: hover ? 'crosshair' : 'default' }} />
        {hover && (
          <div className="ric-tip" style={{
            [hover.side === 'l' ? 'right' : 'left']: hover.side === 'l' ? `${cw - hover.tx + 12}px` : `${hover.tx + 12}px`,
            top: 12,
          }}>
            <div className="ric-tip-date">{fmtDateFull(hover.date)}</div>
            <div className="ric-tip-total">{fmtVal(hover.tot)}</div>
            <div className="ric-tip-list">
              {hover.bd.sort((a, b) => b.val - a.val).map(i => (
                <div key={i.cat} className="ric-tip-row">
                  <span className="ric-tip-dot" style={{ background: i.col }} />
                  <span className="ric-tip-cat">{i.cat}</span>
                  <span className="ric-tip-val">{fmtVal(i.val)}</span>
                  <span className="ric-tip-pct">{hover.tot > 0 ? ((i.val / hover.tot) * 100).toFixed(1) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="ric-legend">
        {categories.map(cat => {
          const off = hidden.has(cat)
          const col = colors[cat] || '#94A3B8'
          const last = filtered?.[filtered.length - 1]
          const cv = last ? last[cat] || 0 : 0
          return (
            <button key={cat} type="button" className={`ric-leg ${off ? 'off' : ''}`} onClick={() => toggleCat(cat)}>
              <span className="ric-leg-dot" style={{ background: off ? 'rgba(255,255,255,0.08)' : col }} />
              <span className="ric-leg-name">{cat}</span>
              <span className="ric-leg-val">{fmtVal(cv)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
