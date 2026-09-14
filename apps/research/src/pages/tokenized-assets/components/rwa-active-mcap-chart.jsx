/**
 * RwaActiveMcapChart — Spectre marquee chart for tokenized RWA mcap.
 *
 * Three distinctive *visual* types:
 *   1. Lines    — solid lane-color strokes per category, end-cap dot + halo
 *   2. Stacked  — flatter stacked area (less wave, more histogram-of-time)
 *   3. Bars     — stacked vertical bars, downsampled, rounded top, hover dim
 *
 * Layout: chart on the left, breakdown rail on the right.
 *   • Brush/range selector below the chart (rwa.xyz-style mini timeline,
 *     two draggable handles, syncs with the timeframe pills).
 *   • Right-rail cards drill into top protocols within a class.
 *
 * Axis typography: Y is mono (per design rule), X is sans (dates).
 * Tick dedupe is by min-pixel-distance, not exact x equality.
 */
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { DISPLAY_LABEL, buildLanes } from './shared/rwa-lanes'


/* ── Visual types (labels resolved at render via t()) ── */
const TYPES = [
  { id: 'lines',   labelKey: 'lines',   labelFallback: 'Lines' },
  { id: 'stacked', labelKey: 'stacked', labelFallback: 'Stacked' },
  { id: 'bars',    labelKey: 'bars',    labelFallback: 'Bars' },
]

/* ── Timeframes ── */
const TIMEFRAMES = [
  { id: '1M', days: 30 },
  { id: '3M', days: 90 },
  { id: '6M', days: 180 },
  { id: '1Y', days: 365 },
  { id: '2Y', days: 730 },
  { id: 'All', days: Infinity },
]

/* ── SVG geometry ── */
const W = 1000
const H = 260
const PAD = { t: 14, r: 18, b: 28, l: 60 }

/* Brush mini-timeline */
const BRUSH_W = 1000
const BRUSH_H = 56

/* ── Formatters ──
   `fmtUsdRaw` is the USD-only fallback used by axis labels rendered into the
   downsampled SVG. UI surfaces should prefer the bound `fmtUsd` defined inside
   the component (sourced from `useCurrency()`).
*/
function fmtUsdRaw(v) {
  if (v == null || !isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`
  if (abs >= 1e3)  return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}
function fmtPct(v, signed = true) {
  if (v == null || !isFinite(v)) return '—'
  if (Math.abs(v) > 999) return v >= 0 ? '>+999%' : '<-999%'
  const sign = signed && v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}
function fmtDate(ts, opts = { month: 'short', year: '2-digit' }) {
  try {
    return new Intl.DateTimeFormat(i18n.language || 'en-US', opts).format(new Date(ts * 1000))
  } catch {
    return new Date(ts * 1000).toLocaleDateString('en-US', opts)
  }
}

/* Smooth bezier path */
function smoothPath(pts, t = 0.18) {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

/* Downsample to ~targetN evenly-spaced points */
function downsample(series, targetN) {
  if (series.length <= targetN) return series
  const step = (series.length - 1) / (targetN - 1)
  const out = []
  for (let i = 0; i < targetN; i++) {
    const idx = Math.round(i * step)
    out.push(series[Math.min(idx, series.length - 1)])
  }
  return out
}

/* Sparkline path generator for tiny rail charts */
function sparkPath(values, w, h, pad = 1.5) {
  if (!values?.length) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const N = values.length
  let d = ''
  values.forEach((v, i) => {
    const x = pad + (i / Math.max(1, N - 1)) * (w - pad * 2)
    const y = pad + ((max - v) / range) * (h - pad * 2)
    d += (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`)
  })
  return d
}

export default function RwaActiveMcapChart({ tvlHistory, breakdownHistory, loading, protocols, onIssuerClick, dayMode = false }) {
  const { fmtLargeShort } = useCurrency()
  const fmtUsd = (v) => (v == null || !isFinite(v) ? '—' : fmtLargeShort(v))
  const { t } = useTranslation()
  /* Day-mode-aware chrome. The SVG gridlines/crosshair are inline strokes and
     the watermark is a fixed white wordmark — both were hardcoded for the dark
     theme, so on the white day-mode background the gridlines vanished and the
     watermark rendered as a ghost-grey box. Swap to dark-on-light equivalents. */
  const gridStroke = dayMode ? 'rgba(15,23,42,0.07)' : 'rgba(245,245,247,0.045)'
  const crosshairStroke = dayMode ? 'rgba(15,23,42,0.20)' : 'rgba(245,245,247,0.22)'
  const dotStroke = dayMode ? '#ffffff' : '#09090b'
  const watermarkSrc = dayMode ? '/logo-text-dark.png' : '/logo-text-white.png'
  const wrapRef = useRef(null)
  const brushRef = useRef(null)
  const [type, setType] = useState('stacked')
  const [tf, setTf] = useState('1Y')
  const [hidden, setHidden] = useState(new Set())
  const [hoverIdx, setHoverIdx] = useState(null)
  const [drillKey, setDrillKey] = useState(null)
  /* brush is in [0, 1] of the full series length */
  const [brush, setBrush] = useState({ start: 0, end: 1 })
  const [dragging, setDragging] = useState(null) // 'start' | 'end' | 'pan' | null
  const dragStartRef = useRef(null)

  /* ── Categories + remap — shared with the Overview hero (rwa-lanes.js) ── */
  const { lanes, baseSeries } = useMemo(
    () => buildLanes({ tvlHistory, breakdownHistory, dayMode }),
    [breakdownHistory, tvlHistory, dayMode]
  )

  /* Sync brush whenever timeframe pill is clicked */
  useEffect(() => {
    if (!baseSeries.length) return
    const tfDef = TIMEFRAMES.find(t => t.id === tf)
    if (!tfDef) return
    if (tfDef.days === Infinity) {
      setBrush({ start: 0, end: 1 })
      return
    }
    const cutoff = (Date.now() / 1000) - tfDef.days * 86400
    const N = baseSeries.length
    let startIdx = baseSeries.findIndex(p => p.date >= cutoff)
    if (startIdx < 0) startIdx = 0
    setBrush({ start: startIdx / Math.max(1, N - 1), end: 1 })
  }, [tf, baseSeries.length])

  /* Brush window in absolute indices */
  const viewWindow = useMemo(() => {
    const N = baseSeries.length
    if (!N) return { from: 0, to: 0 }
    const safeStart = Number.isFinite(brush.start) ? brush.start : 0
    const safeEnd = Number.isFinite(brush.end) ? brush.end : 1
    const from = Math.max(0, Math.min(N - 1, Math.round(safeStart * (N - 1))))
    const to = Math.max(from + 1, Math.min(N - 1, Math.round(safeEnd * (N - 1))))
    return { from, to }
  }, [brush, baseSeries.length])

  const series = useMemo(
    () => baseSeries.slice(viewWindow.from, viewWindow.to + 1),
    [baseSeries, viewWindow]
  )

  const visLanes = useMemo(() => lanes.filter(l => !hidden.has(l.key)), [lanes, hidden])

  /* ── Bar series (downsampled) ── */
  const barSeries = useMemo(() => {
    if (type !== 'bars') return null
    return downsample(series, Math.min(36, series.length))
  }, [series, type])

  /* ── Geometry per type ── */
  const geom = useMemo(() => {
    const data = type === 'bars' ? barSeries : series
    if (!data?.length || !visLanes.length) return null

    const N = data.length
    const xAt = (i) => PAD.l + (i / Math.max(1, N - 1)) * (W - PAD.l - PAD.r)
    const xs = data.map((_, i) => xAt(i))

    if (type === 'lines') {
      let yMax = 0
      for (const pt of data) for (const l of visLanes) yMax = Math.max(yMax, pt[l.key] || 0)
      yMax = Math.max(yMax * 1.10, 1)
      const yMin = 0
      const yAt = (v) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b)
      const points = data.map((pt, i) => ({ date: pt.date, x: xs[i] }))
      const linePaths = visLanes.map(l => {
        const pts = data.map((pt, i) => ({ x: xs[i], y: yAt(pt[l.key] || 0) }))
        return {
          key: l.key,
          color: l.color,
          d: smoothPath(pts),
          last: data[N - 1][l.key] || 0,
          lastY: yAt(data[N - 1][l.key] || 0),
        }
      })
      return { mode: 'lines', data, points, xs, yMin, yMax, yAt, linePaths }
    }

    if (type === 'bars') {
      const points = data.map((pt, i) => {
        let cum = 0
        const stack = []
        for (const l of visLanes) {
          const v = pt[l.key] || 0
          stack.push({ key: l.key, color: l.color, val: v, base: cum, cum: cum + v })
          cum += v
        }
        return { date: pt.date, x: xs[i], stack, total: cum }
      })
      let yMax = 0
      for (const p of points) yMax = Math.max(yMax, p.total)
      yMax = Math.max(yMax * 1.15, 1)
      const yMin = 0
      const yAt = (v) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b)
      const barW = Math.max(2, ((W - PAD.l - PAD.r) / N) * 0.66)
      return { mode: 'bars', data, points, xs, yMin, yMax, yAt, barW }
    }

    // Stacked
    const points = data.map((pt, i) => {
      let cum = 0
      const stack = []
      for (const l of visLanes) {
        const v = pt[l.key] || 0
        stack.push({ key: l.key, color: l.color, val: v, base: cum, cum: cum + v })
        cum += v
      }
      return { date: pt.date, x: xs[i], stack, total: cum }
    })
    let yMax = 0
    for (const p of points) yMax = Math.max(yMax, p.total)
    yMax = Math.max(yMax * 1.12, 1)
    const yMin = 0
    const yAt = (v) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b)
    /* Use straight (less wavy) line segments — flatter, more institutional */
    const stackedPaths = visLanes.map((l, li) => {
      const upper = points.map(p => ({ x: p.x, y: yAt(p.stack[li].cum) }))
      const lower = points.map(p => ({ x: p.x, y: yAt(p.stack[li].base) })).reverse()
      let d = `M${upper[0].x.toFixed(1)},${upper[0].y.toFixed(1)}`
      for (let i = 1; i < upper.length; i++) {
        d += ` L${upper[i].x.toFixed(1)},${upper[i].y.toFixed(1)}`
      }
      const upperD = d
      for (let i = 0; i < lower.length; i++) {
        d += ` L${lower[i].x.toFixed(1)},${lower[i].y.toFixed(1)}`
      }
      d += ' Z'
      return { key: l.key, color: l.color, fill: d, stroke: upperD }
    })
    return { mode: 'stacked', data, points, xs, yMin, yMax, yAt, stackedPaths }
  }, [series, barSeries, visLanes, type])

  /* ── Header total + delta over the visible window ── */
  const { headTotal, headDelta } = useMemo(() => {
    if (!series.length) return { headTotal: null, headDelta: null }
    const last = series[series.length - 1]
    const first = series[0]
    const total = lanes.reduce((s, l) => s + (last[l.key] || 0), 0)
    const startTotal = lanes.reduce((s, l) => s + (first[l.key] || 0), 0)
    const delta = startTotal > 0 ? ((total - startTotal) / startTotal) * 100 : null
    return { headTotal: total, headDelta: delta }
  }, [series, lanes])

  const asOf = useMemo(() => {
    const last = series[series.length - 1]
    return last ? fmtDate(last.date, { month: 'short', day: 'numeric', year: 'numeric' }) : null
  }, [series])

  /* ── Per-lane breakdown w/ sparkline ── */
  const breakdown = useMemo(() => {
    if (!series.length) return []
    const last = series[series.length - 1]
    const first = series[0]
    const tot = lanes.reduce((s, l) => s + (last[l.key] || 0), 0) || 1
    return lanes.map(l => {
      const cur = last[l.key] || 0
      const start = first[l.key] || 0
      let pct = null
      let pctOverflow = false
      if (start > 0) {
        pct = ((cur - start) / start) * 100
        if (Math.abs(pct) > 999) pctOverflow = true
      } else if (cur > 0) {
        pctOverflow = true
      }
      const samp = downsample(series, 28)
      const sparkValues = samp.map(p => p[l.key] || 0)
      return {
        key: l.key,
        color: l.color,
        value: cur,
        share: cur / tot,
        pct,
        pctOverflow,
        sparkValues,
      }
    }).sort((a, b) => b.value - a.value)
  }, [series, lanes])

  /* ── Top protocols within the drilled class ── */
  const drillProtocols = useMemo(() => {
    if (!drillKey || !tvlHistory?.protocolSeries) return null
    const srcCat = Object.entries(DISPLAY_LABEL).find(([, v]) => v === drillKey)?.[0]
    if (!srcCat) return null
    const list = Object.entries(tvlHistory.protocolSeries)
      .filter(([, p]) => p.category === srcCat)
      .map(([slug, p]) => {
        const pts = (p.data || []).map(d => d.tvl || 0)
        return {
          slug,
          name: p.name || slug,
          tvl: p.currentTvl || (pts.length ? pts[pts.length - 1] : 0),
          spark: pts.length > 1 ? downsample(p.data, 24).map(d => d.tvl || 0) : null,
        }
      })
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 5)
    return list
  }, [drillKey, tvlHistory])

  /* ── Hover ── */
  const onMove = (e) => {
    if (!wrapRef.current || !geom?.points?.length) return
    const r = wrapRef.current.getBoundingClientRect()
    const relX = ((e.clientX - r.left) / r.width) * W
    if (relX < PAD.l || relX > W - PAD.r) { setHoverIdx(null); return }
    const N = geom.points.length
    const idx = Math.round(((relX - PAD.l) / (W - PAD.l - PAD.r)) * (N - 1))
    setHoverIdx(Math.max(0, Math.min(N - 1, idx)))
  }
  const onLeave = () => setHoverIdx(null)

  const toggleLane = (key) => {
    setHidden(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else if (lanes.length - n.size > 1) n.add(key)
      return n
    })
  }

  /* ── Y ticks (5 lines, dotted) ── */
  const yTicks = useMemo(() => {
    if (!geom?.yAt) return []
    const steps = 5
    const out = []
    for (let i = 0; i <= steps; i++) {
      const v = geom.yMin + (geom.yMax - geom.yMin) * (i / steps)
      out.push({ v, y: geom.yAt(v) })
    }
    return out
  }, [geom])

  /* ── X ticks: dedupe by min-pixel-distance ── */
  const xTicks = useMemo(() => {
    if (!geom?.points?.length) return []
    const N = geom.points.length
    const target = 6
    const step = Math.max(1, Math.floor((N - 1) / target))
    const out = []
    for (let i = 0; i < N; i += step) {
      out.push({ x: geom.points[i].x, label: fmtDate(geom.points[i].date) })
    }
    /* Replace last picked tick with the actual right edge */
    const lastX = geom.points[N - 1].x
    const lastLabel = fmtDate(geom.points[N - 1].date)
    if (out.length && Math.abs(out[out.length - 1].x - lastX) < 60) {
      out[out.length - 1] = { x: lastX, label: lastLabel }
    } else {
      out.push({ x: lastX, label: lastLabel })
    }
    /* Also dedupe identical labels by min-pixel-distance */
    const minDist = 70
    const filtered = []
    for (const t of out) {
      if (!filtered.length || (t.x - filtered[filtered.length - 1].x) >= minDist) {
        filtered.push(t)
      }
    }
    return filtered
  }, [geom])

  /* ── Brush geometry ── */
  const brushGeom = useMemo(() => {
    const N = baseSeries.length
    if (!N) return null
    /* Total area sparkline of all lanes summed */
    const totals = baseSeries.map(p => lanes.reduce((s, l) => s + (p[l.key] || 0), 0))
    const min = 0
    const max = Math.max(...totals, 1)
    const xAt = (i) => (i / Math.max(1, N - 1)) * BRUSH_W
    const yAt = (v) => 4 + ((max - v) / (max - min)) * (BRUSH_H - 8)
    const upper = totals.map((v, i) => ({ x: xAt(i), y: yAt(v) }))
    let d = `M${upper[0].x.toFixed(1)},${upper[0].y.toFixed(1)}`
    for (let i = 1; i < upper.length; i++) d += ` L${upper[i].x.toFixed(1)},${upper[i].y.toFixed(1)}`
    const areaD = `${d} L${BRUSH_W.toFixed(1)},${BRUSH_H} L0,${BRUSH_H} Z`
    const startX = brush.start * BRUSH_W
    const endX = brush.end * BRUSH_W
    return { line: d, area: areaD, startX, endX, totals, xAt }
  }, [baseSeries, lanes, brush])

  /* Brush drag handlers — switch tf to Custom on user drag */
  const beginDrag = (which) => (e) => {
    if (e.cancelable) e.preventDefault()
    e.stopPropagation()
    if (!brushRef.current) return
    const clientX = e.touches?.[0]?.clientX ?? e.clientX
    if (!Number.isFinite(clientX)) return
    const rect = brushRef.current.getBoundingClientRect()
    dragStartRef.current = {
      rect,
      brushAt: { ...brush },
      pointerStart: clientX,
    }
    setDragging(which)
  }

  const handleBrushMove = useCallback((clientX) => {
    if (!dragging || !dragStartRef.current) return
    const { rect, brushAt, pointerStart } = dragStartRef.current
    const dx = (clientX - pointerStart) / rect.width
    if (dragging === 'start') {
      const next = Math.max(0, Math.min(brushAt.end - 0.02, brushAt.start + dx))
      setBrush({ start: next, end: brushAt.end })
    } else if (dragging === 'end') {
      const next = Math.max(brushAt.start + 0.02, Math.min(1, brushAt.end + dx))
      setBrush({ start: brushAt.start, end: next })
    } else if (dragging === 'pan') {
      const range = brushAt.end - brushAt.start
      let s = brushAt.start + dx
      let e = brushAt.end + dx
      if (s < 0) { s = 0; e = range }
      if (e > 1) { e = 1; s = 1 - range }
      setBrush({ start: s, end: e })
    }
  }, [dragging])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX
      handleBrushMove(cx)
    }
    const onUp = () => {
      setDragging(null)
      dragStartRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [dragging, handleBrushMove])

  /* If user drags brush, deselect timeframe pill (visual sync only) */
  const tfActive = useMemo(() => {
    if (!baseSeries.length) return tf
    const tfDef = TIMEFRAMES.find(t => t.id === tf)
    if (!tfDef) return null
    if (tfDef.days === Infinity) {
      return (brush.start === 0 && brush.end === 1) ? tf : null
    }
    const cutoff = (Date.now() / 1000) - tfDef.days * 86400
    const N = baseSeries.length
    let startIdx = baseSeries.findIndex(p => p.date >= cutoff)
    if (startIdx < 0) startIdx = 0
    const expectedStart = startIdx / Math.max(1, N - 1)
    return (Math.abs(brush.start - expectedStart) < 0.01 && brush.end > 0.99) ? tf : null
  }, [tf, brush, baseSeries])

  /* ── Loading skeleton ── */
  if (loading && !baseSeries.length) {
    return (
      <section className="ramc">
        <div className="ramc-rail">
          <span className="ramc-badge"><span className="ramc-badge-dot" /> {t('tokenizedAssets.marquee.spectreProprietary', 'Spectre Proprietary')}</span>
          <span className="ramc-rail-sub">{t('tokenizedAssets.marquee.subtitleShort', 'Active mcap of tokenized real-world assets')}</span>
        </div>
        <div className="ramc-head">
          <div className="ramc-head-left">
            <div className="ramc-skel-line ramc-skel-line--sm animate-shimmer" />
            <div className="ramc-skel-line ramc-skel-line--lg animate-shimmer" />
          </div>
          <div className="ramc-skel-controls animate-shimmer" />
        </div>
        <div className="ramc-body">
          <div>
            <div className="ramc-skel animate-shimmer" />
            <div className="ramc-skel-brush animate-shimmer" />
          </div>
          <aside className="ramc-aside">
            <div className="ramc-skel-card animate-shimmer" />
            <div className="ramc-skel-card animate-shimmer" />
            <div className="ramc-skel-card animate-shimmer" />
            <div className="ramc-skel-card animate-shimmer" />
          </aside>
        </div>
      </section>
    )
  }

  /* ── Empty ── */
  if (!baseSeries.length || !geom) {
    return (
      <section className="ramc ramc--empty">
        <div className="ramc-rail">
          <span className="ramc-badge"><span className="ramc-badge-dot" /> {t('tokenizedAssets.marquee.spectreProprietary', 'Spectre Proprietary')}</span>
          <span className="ramc-rail-sub">{t('tokenizedAssets.marquee.subtitleShort', 'Active mcap of tokenized real-world assets')}</span>
        </div>
        <div className="ramc-empty">
          <div className="ramc-empty-title">{t('tokenizedAssets.marquee.timeSeriesUnavailable', 'Time series unavailable')}</div>
          <div className="ramc-empty-sub">{t('tokenizedAssets.marquee.feedNotResponding', 'RWA history feed isn’t responding. Try again in a moment.')}</div>
        </div>
      </section>
    )
  }

  return (
    <section className="ramc" aria-label={t('tokenizedAssets.marquee.rwaActiveMcap', 'RWA Active Mcap')}>
      {/* Top rail */}
      <div className="ramc-rail">
        <span className="ramc-badge">
          <span className="ramc-badge-dot" />
          {t('tokenizedAssets.marquee.spectreProprietary', 'Spectre Proprietary')}
        </span>
        <span className="ramc-rail-sub">
          {t('tokenizedAssets.marquee.subtitle', 'Active mcap of tokenized real-world assets · merged on-chain & issuer feeds')}
        </span>
        {asOf && <span className="ramc-asof">{t('tokenizedAssets.marquee.asOf', 'As of {{date}}', { date: asOf })}</span>}
      </div>

      {/* Header */}
      <div className="ramc-head">
        <div className="ramc-head-left">
          <span className="ramc-eyebrow">{t('tokenizedAssets.marquee.rwaActiveMcap', 'RWA Active Mcap')}</span>
          <div className="ramc-total-row">
            <span className="ramc-total mono">
              {fmtUsd(hoverIdx != null && geom.points[hoverIdx]?.total != null
                ? geom.points[hoverIdx].total
                : headTotal)}
            </span>
            {headDelta != null && (
              <span className={`ramc-delta ${headDelta >= 0 ? 'up' : 'dn'}`}>
                {headDelta >= 0 ? '↑' : '↓'} {fmtPct(headDelta)} <span className="ramc-delta-tf">{tfActive || t('tokenizedAssets.marquee.custom', 'Custom')}</span>
              </span>
            )}
            {hoverIdx != null && geom.points[hoverIdx] && (
              <span className="ramc-sub">
                {fmtDate(geom.points[hoverIdx].date, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        <div className="ramc-head-right">
          <div className="ramc-views" role="tablist">
            {TYPES.map(v => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={type === v.id}
                className={`ramc-view${type === v.id ? ' on' : ''}`}
                onClick={() => setType(v.id)}
              >
                {t(`tokenizedAssets.marquee.chartTypes.${v.labelKey}`, v.labelFallback)}
              </button>
            ))}
          </div>
          <div className="ramc-tfs">
            {TIMEFRAMES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`ramc-tf${tfActive === t.id ? ' on' : ''}`}
                onClick={() => setTf(t.id)}
              >
                {t.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body — chart left, breakdown rail right */}
      <div className="ramc-body">
        <div className="ramc-chart">
          <div
            className="ramc-stage"
            ref={wrapRef}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          >
            {/* SPECTRE watermark — top-right, real wordmark, low presence */}
            <img
              className="ramc-watermark"
              src={watermarkSrc}
              alt=""
              aria-hidden
              draggable={false}
            />
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ramc-svg">
              <defs>
                {visLanes.map(l => {
                  const id = l.key.replace(/\s+/g, '-')
                  return (
                    <linearGradient key={l.key} id={`ramc-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%"   stopColor={l.color} stopOpacity="0.42" />
                      <stop offset="55%"  stopColor={l.color} stopOpacity="0.16" />
                      <stop offset="100%" stopColor={l.color} stopOpacity="0.04" />
                    </linearGradient>
                  )
                })}
              </defs>

              {/* Vertical dotted gridlines (rwa.xyz signature) */}
              {xTicks.map((t, i) => (
                <line
                  key={`vg-${i}`}
                  x1={t.x} x2={t.x}
                  y1={PAD.t} y2={H - PAD.b}
                  stroke={gridStroke}
                  strokeDasharray="1.5 4"
                  strokeWidth="1"
                />
              ))}

              {/* Horizontal dotted gridlines (axis labels rendered as HTML overlay below) */}
              {yTicks.map((g, i) => (
                <line
                  key={`y-${i}`}
                  x1={PAD.l} x2={W - PAD.r}
                  y1={g.y} y2={g.y}
                  stroke={gridStroke}
                  strokeDasharray="1.5 4"
                  strokeWidth="1"
                />
              ))}

              {/* Stacked */}
              {geom.mode === 'stacked' && geom.stackedPaths.map(p => {
                const id = p.key.replace(/\s+/g, '-')
                return (
                  <g key={p.key}>
                    <path d={p.fill} fill={`url(#ramc-fill-${id})`} stroke="none" />
                    <path d={p.stroke} fill="none" stroke={p.color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.92" />
                  </g>
                )
              })}

              {/* Lines — solid lane-color strokes only */}
              {geom.mode === 'lines' && geom.linePaths.map(p => {
                const lastX = geom.points[geom.points.length - 1].x
                return (
                  <g key={p.key}>
                    <path d={p.d} fill="none" stroke={p.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.96" />
                    <circle cx={lastX} cy={p.lastY} r="6" fill={p.color} opacity="0.18" />
                    <circle cx={lastX} cy={p.lastY} r="2.6" fill={p.color} stroke={dotStroke} strokeWidth="1" />
                  </g>
                )
              })}

              {/* Bars */}
              {geom.mode === 'bars' && geom.points.map((p, i) => (
                <g key={`bar-${i}`} transform={`translate(${p.x - geom.barW / 2}, 0)`}>
                  {p.stack.map((seg, si) => {
                    if (seg.val <= 0) return null
                    const yTop = geom.yAt(seg.cum)
                    const yBot = geom.yAt(seg.base)
                    const h = Math.max(0, yBot - yTop)
                    const id = seg.key.replace(/\s+/g, '-')
                    const isTop = si === p.stack.length - 1 ||
                      p.stack.slice(si + 1).every(s => s.val <= 0)
                    return (
                      <rect
                        key={seg.key}
                        x={0}
                        y={yTop}
                        width={geom.barW}
                        height={h}
                        fill={`url(#ramc-fill-${id})`}
                        stroke={seg.color}
                        strokeWidth="0.8"
                        strokeOpacity="0.7"
                        rx={isTop ? 2 : 0}
                        ry={isTop ? 2 : 0}
                        opacity={hoverIdx == null || hoverIdx === i ? 1 : 0.35}
                      />
                    )
                  })}
                </g>
              ))}

              {/* Hover crosshair */}
              {hoverIdx != null && geom.points[hoverIdx] && geom.mode !== 'bars' && (
                <g>
                  <line
                    x1={geom.points[hoverIdx].x} x2={geom.points[hoverIdx].x}
                    y1={PAD.t} y2={H - PAD.b}
                    stroke={crosshairStroke}
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {visLanes.map(l => {
                    const p = geom.points[hoverIdx]
                    let y
                    if (geom.mode === 'lines') {
                      y = geom.yAt(geom.data[hoverIdx][l.key] || 0)
                    } else {
                      const idx = visLanes.findIndex(x => x.key === l.key)
                      y = geom.yAt(p.stack[idx].cum)
                    }
                    return (
                      <circle key={l.key} cx={p.x} cy={y} r="3.4" fill={l.color} stroke={dotStroke} strokeWidth="1.2" />
                    )
                  })}
                </g>
              )}
            </svg>

            {/* HTML axis labels — not stretched by preserveAspectRatio="none" */}
            <div className="ramc-axis-overlay">
              {yTicks.map((g, i) => (
                <span
                  key={`yh-${i}`}
                  className="ramc-axis-y"
                  style={{
                    top: `${(g.y / H) * 100}%`,
                    left: `${(PAD.l / W) * 100}%`,
                  }}
                >
                  {fmtUsd(g.v)}
                </span>
              ))}
              {xTicks.map((t, i) => (
                <span
                  key={`xh-${i}`}
                  className="ramc-axis-x"
                  style={{ left: `${(t.x / W) * 100}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>

            {/* Tooltip */}
            {hoverIdx != null && geom.points[hoverIdx] && (
              <div
                className="ramc-tip"
                style={{
                  left: `${(geom.points[hoverIdx].x / W) * 100}%`,
                  transform: geom.points[hoverIdx].x > W * 0.62 ? 'translate(-100%, 0)' : 'translate(0, 0)',
                }}
              >
                <div className="ramc-tip-date">
                  {fmtDate(geom.points[hoverIdx].date, { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div className="ramc-tip-total mono">
                  {fmtUsd(geom.points[hoverIdx].total != null
                    ? geom.points[hoverIdx].total
                    : visLanes.reduce((s, l) => s + (geom.data[hoverIdx][l.key] || 0), 0))}
                </div>
                <div className="ramc-tip-rows">
                  {visLanes.map(l => {
                    const v = geom.data[hoverIdx][l.key] || 0
                    return (
                      <div key={l.key} className="ramc-tip-row">
                        <span className="ramc-tip-dot" style={{ background: l.color }} />
                        <span className="ramc-tip-name">{l.key}</span>
                        <span className="ramc-tip-val mono">{fmtUsd(v)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Brush / range selector ── */}
          {brushGeom && (
            <div className="ramc-brush" ref={brushRef}>
              <svg viewBox={`0 0 ${BRUSH_W} ${BRUSH_H}`} preserveAspectRatio="none" className="ramc-brush-svg">
                <defs>
                  <linearGradient id="ramc-brush-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.01" />
                  </linearGradient>
                </defs>
                <path d={brushGeom.area} fill="url(#ramc-brush-fill)" />
                <path d={brushGeom.line} fill="none" stroke="rgba(255, 255, 255, 0.4)" strokeWidth="1" />
                {/* Outside-window dim mask */}
                <rect className="ramc-brush-mask" x={0} y={0} width={brushGeom.startX} height={BRUSH_H} />
                <rect className="ramc-brush-mask" x={brushGeom.endX} y={0} width={BRUSH_W - brushGeom.endX} height={BRUSH_H} />
                {/* Window border */}
                <rect
                  className="ramc-brush-window"
                  x={brushGeom.startX}
                  y={0}
                  width={Math.max(0, brushGeom.endX - brushGeom.startX)}
                  height={BRUSH_H}
                  fill="transparent"
                  strokeWidth="1"
                  onMouseDown={beginDrag('pan')}
                  onTouchStart={beginDrag('pan')}
                  style={{ cursor: 'grab' }}
                />
              </svg>
              {/* Handles as DOM — left position offset by fraction of handle width so the
                  visual edge never escapes the brush bounds (left edge at 0%, right edge at 100%). */}
              {(() => {
                const HW = 12 // handle width in px
                const startPct = (brushGeom.startX / BRUSH_W) * 100
                const endPct = (brushGeom.endX / BRUSH_W) * 100
                return (
                  <>
                    <div
                      className="ramc-brush-handle ramc-brush-handle--start"
                      style={{ left: `calc(${startPct}% - ${(startPct / 100) * HW}px)` }}
                      onMouseDown={beginDrag('start')}
                      onTouchStart={beginDrag('start')}
                      role="slider"
                      aria-label={t('tokenizedAssets.marquee.rangeStart', 'Range start')}
                    >
                      <span className="ramc-brush-grip" />
                    </div>
                    <div
                      className="ramc-brush-handle ramc-brush-handle--end"
                      style={{ left: `calc(${endPct}% - ${(endPct / 100) * HW}px)` }}
                      onMouseDown={beginDrag('end')}
                      onTouchStart={beginDrag('end')}
                      role="slider"
                      aria-label={t('tokenizedAssets.marquee.rangeEnd', 'Range end')}
                    >
                      <span className="ramc-brush-grip" />
                    </div>
                  </>
                )
              })()}
              {/* Edge labels */}
              <div className="ramc-brush-labels">
                <span className="ramc-brush-label">
                  {baseSeries[viewWindow.from] ? fmtDate(baseSeries[viewWindow.from].date, { month: 'short', year: 'numeric' }) : ''}
                </span>
                <span className="ramc-brush-label ramc-brush-label--end">
                  {baseSeries[viewWindow.to] ? fmtDate(baseSeries[viewWindow.to].date, { month: 'short', year: 'numeric' }) : ''}
                </span>
              </div>
            </div>
          )}

          {/* Lane legend — colour key + click-to-toggle. Without it the 8
              stacked classes are unreadable (lane toggles were wired but had
              no visible control). */}
          {lanes.length > 1 && (
            <div className="ramc-legend" role="group" aria-label={t('tokenizedAssets.marquee.legendLabel', 'Asset classes')}>
              {lanes.map((l) => {
                const off = hidden.has(l.key)
                return (
                  <button
                    key={l.key}
                    type="button"
                    className={`ramc-legend-item${off ? ' ramc-legend-item--off' : ''}`}
                    onClick={() => toggleLane(l.key)}
                    aria-pressed={!off}
                  >
                    <span className="ramc-legend-dot" style={{ background: l.color }} />
                    <span className="ramc-legend-label">{l.key}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </section>
  )
}
