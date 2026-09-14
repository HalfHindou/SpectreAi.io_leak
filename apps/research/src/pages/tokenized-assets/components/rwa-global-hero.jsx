import React, { useMemo, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import TimeframePills from './shared/TimeframePills'
import { buildLanes } from './shared/rwa-lanes'

/**
 * RwaGlobalHero
 * Gradient area chart with a "Total Value | Net Flows | By Class" toggle
 * plus timeframe pills (1M/3M/6M/1Y/All). Shows the global tokenized asset
 * market total over time, plus 5 mini stat cells along the bottom.
 *
 * Net Flows mode = daily delta of the daily total. Computed client-side
 * from the same tvlHistory series.
 * By Class mode = stacked area by category, lanes shared with the Active
 * Mcap chart via rwa-lanes.js (breakdownHistory when rich, else tvlHistory).
 *
 * Axis labels render as HTML overlays — never inside an SVG that uses
 * preserveAspectRatio="none" — to keep them crisp.
 *
 * Props:
 *   tvlHistory: { categories, series }
 *   breakdownHistory: Phase 2 issuer-direct 12-category history
 *   overview: { totalProtocols, totalChains, ... }
 *   breakdown: Phase 3 issuer-direct breakdown (total_holders,
 *              represented_value_usd, total_aum_usd, categories[])
 *   dayMode, loading
 */

const W = 1000
const H = 220
const PAD = { t: 18, r: 14, b: 22, l: 50 }
const GRAD_ID = 'rgh-grad'

const TIMEFRAMES = [
  { id: '1M', days: 30 },
  { id: '3M', days: 90 },
  { id: '6M', days: 180 },
  { id: '1Y', days: 365 },
  { id: 'All', days: Infinity },
]
const TF_OPTIONS = TIMEFRAMES.map(x => ({ id: x.id, label: x.id }))

/* First index inside the timeframe window (keeps ≥2 points) */
function windowStart(rows, tf) {
  const def = TIMEFRAMES.find(x => x.id === tf)
  const N = rows.length
  if (!def || def.days === Infinity || N < 3) return 0
  const cutoff = Date.now() / 1000 - def.days * 86400
  let i = rows.findIndex(p => p.date >= cutoff)
  if (i < 0) i = 0
  return Math.min(i, N - 2)
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '--'
  const s = v >= 0 ? '+' : ''
  return `${s}${v.toFixed(2)}%`
}
function fmtMonth(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short' })
}
function fmtDayMonth(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmtFullDate(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtMonthYear(ts) {
  const d = new Date(ts * 1000)
  return `${d.toLocaleDateString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`
}

/* "Nice" axis steps (1 / 2 / 2.5 / 5 × 10^n) inside [min, max] — round tick
   values ($5B, $10B…) instead of range-derived fractions ($6.93B). */
function niceTicks(min, max, target = 4) {
  const span = max - min
  if (!(span > 0) || !isFinite(span)) return []
  const raw = span / Math.max(1, target)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const eps = step * 1e-6
  const out = []
  for (let v = Math.ceil((min - eps) / step) * step; v <= max + eps; v += step) {
    out.push(Math.abs(v) < eps ? 0 : v)
  }
  return out
}

/* Calendar-anchored x ticks: Mondays on short windows, month starts otherwise
   (stepped 1/2/3/6/12 months so ≤ ~7 labels fit). Index-stepped ticks land on
   arbitrary dates and read unevenly. */
function calendarAnchors(fromTs, toTs) {
  const spanDays = (toTs - fromTs) / 86400
  if (spanDays <= 45) {
    const d = new Date(fromTs * 1000)
    d.setUTCHours(0, 0, 0, 0)
    const dow = d.getUTCDay()
    d.setUTCDate(d.getUTCDate() + ((8 - (dow === 0 ? 7 : dow)) % 7))
    const out = []
    while (d.getTime() / 1000 <= toTs) {
      out.push(d.getTime() / 1000)
      d.setUTCDate(d.getUTCDate() + 7)
    }
    return { anchors: out, labelMode: 'day' }
  }
  const months = spanDays / 30.44
  const step = months <= 7 ? 1 : months <= 14 ? 2 : months <= 21 ? 3 : months <= 42 ? 6 : 12
  const d = new Date(fromTs * 1000)
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  if (d.getTime() / 1000 < fromTs) d.setUTCMonth(d.getUTCMonth() + 1)
  if (step > 1) d.setUTCMonth(Math.ceil(d.getUTCMonth() / step) * step)
  const out = []
  while (d.getTime() / 1000 <= toTs) {
    out.push(d.getTime() / 1000)
    d.setUTCMonth(d.getUTCMonth() + step)
  }
  return { anchors: out, labelMode: spanDays > 400 ? 'monthYear' : 'month' }
}

/* Net-flow bar colours (polarity — the one place bull/bear belongs).
   Bright pair on black, one notch darker on white. */
const FLOW_UP = '#34D399'
const FLOW_DN = '#F87171'
const FLOW_UP_DAY = '#059669'
const FLOW_DN_DAY = '#DC2626'

/* Smooth bezier */
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

function fmtCount(v) {
  if (v == null || !isFinite(v)) return '--'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toLocaleString('en-US')
}

export default function RwaGlobalHero({ tvlHistory, breakdownHistory, overview, breakdown, srwaIndex, dayMode = false, loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtUsd = (v) => (v == null || !isFinite(v) ? '--' : fmtLargeShort(v))
  const fmtSignedUsd = (v) => {
    if (v == null || !isFinite(v)) return '--'
    return `${v >= 0 ? '+' : ''}${fmtLargeShort(v)}`
  }
  const MODES = [
    { id: 'value', label: t('tokenizedAssets.globalHero.totalValue', 'Total Value') },
    { id: 'flows', label: t('tokenizedAssets.globalHero.netFlows', 'Net Flows') },
    { id: 'class', label: t('tokenizedAssets.globalHero.byClass', 'By Class') },
  ]
  const [mode, setMode] = useState('value')
  const [tf, setTf] = useState('1Y')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [hoverLane, setHoverLane] = useState(null)
  const stageRef = useRef(null)

  /* Day-mode-aware SVG chrome (inline strokes can't come from CSS vars here) */
  const gridStroke = dayMode ? 'rgba(15,23,42,0.07)' : 'rgba(245,245,247,0.045)'
  const crosshairStroke = dayMode ? 'rgba(15,23,42,0.20)' : 'rgba(245,245,247,0.22)'
  const zeroStroke = dayMode ? 'rgba(15,23,42,0.18)' : 'rgba(245,245,247,0.18)'
  const dotStroke = dayMode ? '#ffffff' : '#09090b'

  const { totals, series, dailyDelta } = useMemo(() => {
    const s = tvlHistory?.series || []
    const cats = tvlHistory?.categories || []
    if (!s.length || !cats.length) return { totals: [], series: [], dailyDelta: [] }
    const tot = s.map(pt => cats.reduce((acc, c) => acc + (pt[c] || 0), 0))
    const delta = tot.map((v, i) => i === 0 ? 0 : v - tot[i - 1])
    return { totals: tot, series: s, dailyDelta: delta }
  }, [tvlHistory])

  /* Lanes for By Class — same builder as the Active Mcap chart */
  const { lanes, baseSeries } = useMemo(
    () => buildLanes({ tvlHistory, breakdownHistory, dayMode }),
    [tvlHistory, breakdownHistory, dayMode]
  )

  /* Timeframe window. By Class slices its own series (breakdownHistory can
     have a different length/date range than tvlHistory). */
  const win = useMemo(() => {
    if (mode === 'class') {
      const start = windowStart(baseSeries, tf)
      return { rows: baseSeries.slice(start) }
    }
    const start = windowStart(series, tf)
    return {
      rows: series.slice(start),
      totals: totals.slice(start),
      delta: dailyDelta.slice(start),
    }
  }, [mode, tf, series, totals, dailyDelta, baseSeries])

  const points = useMemo(() => {
    const N = win.rows?.length || 0
    if (N < 2) return null
    const xAt = (i) => PAD.l + (i / Math.max(1, N - 1)) * (W - PAD.l - PAD.r)

    if (mode === 'class') {
      // Stacked area by category — linear axis anchored at zero.
      const stacks = win.rows.map((pt, i) => {
        let cum = 0
        const stack = []
        for (const l of lanes) {
          const v = pt[l.key] || 0
          stack.push({ key: l.key, color: l.color, val: v, base: cum, cum: cum + v })
          cum += v
        }
        return { date: pt.date, x: xAt(i), stack, total: cum }
      })
      let mx = 0
      for (const p of stacks) mx = Math.max(mx, p.total)
      const yMin = 0
      const yMax = Math.max(mx * 1.08, 1)
      const yAt = (v) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b)
      const stackedPaths = lanes.map((l, li) => {
        const upper = stacks.map(p => ({ x: p.x, y: yAt(p.stack[li].cum) }))
        const lower = stacks.map(p => ({ x: p.x, y: yAt(p.stack[li].base) })).reverse()
        let d = `M${upper[0].x.toFixed(1)},${upper[0].y.toFixed(1)}`
        let edge = d
        for (let i = 1; i < upper.length; i++) {
          const seg = ` L${upper[i].x.toFixed(1)},${upper[i].y.toFixed(1)}`
          d += seg
          edge += seg
        }
        for (let i = 0; i < lower.length; i++) d += ` L${lower[i].x.toFixed(1)},${lower[i].y.toFixed(1)}`
        d += ' Z'
        return { key: l.key, color: l.color, d, edge }
      })
      const pts = stacks.map(p => ({ x: p.x, y: yAt(p.total), v: p.total, date: p.date }))
      return { pts, stacks, stackedPaths, yAt, xAt, N, isLog: false, yMin, yMax }
    }

    const isFlows = mode === 'flows'
    const data = isFlows ? win.delta : win.totals

    if (isFlows) {
      // Daily deltas swing +/- -> symmetric linear axis anchored at zero,
      // rendered as polarity bars (green up / red down), not a line.
      const mn = Math.min(...data)
      const mx = Math.max(...data)
      const m = Math.max(Math.abs(mn), Math.abs(mx)) * 1.1 || 1
      const yMin = -m, yMax = m
      const yAt = (v) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b)
      const pts = data.map((v, i) => ({ x: xAt(i), y: yAt(v), v, date: win.rows[i].date }))
      const step = (W - PAD.l - PAD.r) / Math.max(1, N - 1)
      const barW = Math.max(1.2, Math.min(step * 0.55, 40))
      return { pts, yAt, xAt, N, isLog: false, yMin, yMax, barW }
    }

    if (tf === 'All') {
      // Full history spans ~3 orders of magnitude. A linear axis from zero
      // pins the early history flat on the floor and wastes most of the
      // frame (the "broken spike" look). A log10 axis turns the growth into
      // a readable rising curve that fills the whole chart.
      const positive = data.filter(v => v > 0)
      const dMin = positive.length ? Math.min(...positive) : 1
      const dMax = Math.max(...data, dMin * 10)
      const lMin = Math.log10(dMin) - 0.05
      const lMax = Math.log10(dMax) + 0.05
      const floor = Math.pow(10, lMin)
      const yAt = (v) => {
        const lv = Math.log10(Math.max(v, floor))
        return PAD.t + ((lMax - lv) / (lMax - lMin)) * (H - PAD.t - PAD.b)
      }
      const pts = data.map((v, i) => ({ x: xAt(i), y: yAt(v), v, date: win.rows[i].date }))
      return { pts, yAt, xAt, N, isLog: true, lMin, lMax, dMin, dMax }
    }

    // Windowed Total Value — the range is narrow, so a range-fit linear
    // axis reads far better than log here.
    const mn = Math.min(...data)
    const mx = Math.max(...data)
    const span = (mx - mn) || Math.abs(mx) * 0.05 || 1
    const yMin = mn - span * 0.10
    const yMax = mx + span * 0.10
    const yAt = (v) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b)
    const pts = data.map((v, i) => ({ x: xAt(i), y: yAt(v), v, date: win.rows[i].date }))
    return { pts, yAt, xAt, N, isLog: false, yMin, yMax }
  }, [mode, tf, win, lanes])

  /* Header total + 30D delta — prefer overview.totalTvl (full protocol set, ~166)
     over the truncated series sum (~25 protocols), so it matches the Brain article. */
  const headTotal = overview?.totalTvl != null
    ? overview.totalTvl
    : (totals.length ? totals[totals.length - 1] : null)

  /* Count-up the headline figure once on first load (cinematic entry). After
     the first run it tracks the live value directly; honours reduced-motion. */
  const [countTotal, setCountTotal] = useState(null)
  const countedRef = useRef(false)
  useEffect(() => {
    if (headTotal == null || !isFinite(headTotal)) return
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (countedRef.current || reduce) { countedRef.current = true; setCountTotal(headTotal); return }
    countedRef.current = true
    const to = headTotal, dur = 950, t0 = performance.now()
    let raf
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setCountTotal(to * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else setCountTotal(to)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [headTotal])

  const change30d = useMemo(() => {
    if (totals.length < 2) return null
    const last = totals[totals.length - 1]
    const idx = Math.max(0, totals.length - 31)
    const prev = totals[idx]
    if (!prev) return null
    return ((last - prev) / prev) * 100
  }, [totals])
  const change7d = useMemo(() => {
    if (totals.length < 2) return null
    const last = totals[totals.length - 1]
    const idx = Math.max(0, totals.length - 8)
    const prev = totals[idx]
    if (!prev) return null
    return ((last - prev) / prev) * 100
  }, [totals])
  const netFlow7d = useMemo(() => {
    if (dailyDelta.length < 8) return null
    return dailyDelta.slice(-7).reduce((s, v) => s + v, 0)
  }, [dailyDelta])

  /* Y-axis ticks */
  const yTicks = useMemo(() => {
    if (!points) return []
    if (points.isLog) {
      // One tick per power of ten in range (e.g. $100M / $1B / $10B).
      const out = []
      const start = Math.ceil(points.lMin)
      const end = Math.floor(points.lMax)
      for (let p = start; p <= end; p++) {
        const v = Math.pow(10, p)
        out.push({ v, y: points.yAt(v) })
      }
      return out
    }
    // Round-number steps ($5B / $10B / $15B), not range fractions ($6.93B).
    // Zero-anchored modes (class/flows) span a wide range — denser target
    // keeps them from collapsing to 3 sparse ticks.
    const target = mode === 'value' ? 4 : 6
    return niceTicks(points.yMin, points.yMax, target).map(v => ({ v, y: points.yAt(v) }))
  }, [points, mode])

  /* X-axis ticks anchored to calendar boundaries (Mondays / month starts) so
     labels land evenly instead of on arbitrary index-stepped dates. */
  const xTicks = useMemo(() => {
    if (!points) return []
    const pts = points.pts
    const N = points.N
    const { anchors, labelMode } = calendarAnchors(pts[0].date, pts[N - 1].date)
    const fmt = labelMode === 'day' ? fmtDayMonth : labelMode === 'monthYear' ? fmtMonthYear : fmtMonth
    const out = []
    let j = 0
    for (const ts of anchors) {
      while (j < N - 1 && pts[j].date < ts) j++
      const x = pts[j].x
      if (out.length && x - out[out.length - 1].x < 60) continue
      if (x > W - PAD.r - 34) continue
      out.push({ x, label: fmt(ts) })
    }
    return out
  }, [points])

  /* Path (Total Value only — flows renders bars, By Class its stacked paths) */
  const linePath = useMemo(() => (points && mode === 'value') ? smoothPath(points.pts) : '', [points, mode])
  const areaPath = useMemo(() => {
    if (!points || mode !== 'value') return ''
    const baseY = H - PAD.b
    return `${linePath} L${points.pts[points.pts.length - 1].x.toFixed(1)},${baseY.toFixed(1)} L${points.pts[0].x.toFixed(1)},${baseY.toFixed(1)} Z`
  }, [points, linePath, mode])

  const hovered = hoverIdx != null && points?.pts[hoverIdx]

  function onMove(e) {
    if (!stageRef.current || !points) return
    const r = stageRef.current.getBoundingClientRect()
    const relX = ((e.clientX - r.left) / r.width) * W
    if (relX < PAD.l || relX > W - PAD.r) { setHoverIdx(null); setHoverLane(null); return }
    const N = points.N
    const idx = Math.max(0, Math.min(N - 1, Math.round(((relX - PAD.l) / (W - PAD.l - PAD.r)) * (N - 1))))
    setHoverIdx(idx)
    if (mode === 'class' && points.stacks) {
      // Which lane band is under the cursor (y between its base and top)
      const relY = ((e.clientY - r.top) / r.height) * H
      const st = points.stacks[idx]
      let li = null
      for (let k = 0; k < st.stack.length; k++) {
        if (relY >= points.yAt(st.stack[k].cum) && relY <= points.yAt(st.stack[k].base)) { li = k; break }
      }
      setHoverLane(li)
    }
  }
  function onLeave() { setHoverIdx(null); setHoverLane(null) }

  /* ── Loading skeleton ── */
  if (loading && !totals.length) {
    return (
      <section className="rgh">
        <header className="rgh__head">
          <span className="rgh__eyebrow">{t('tokenizedAssets.globalHero.eyebrow', 'Global Tokenized Asset Market')}</span>
          <div className="rgh__total-row">
            <div className="rgh__total-skel animate-shimmer" />
            <div className="rgh__delta-skel animate-shimmer stagger-2" />
          </div>
          <div className="rgh__toggle-skel animate-shimmer stagger-3" />
        </header>
        <div className="rgh__chart-skel animate-shimmer" />
        <div className="rgh__stats">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`rgh__stat-skel animate-shimmer stagger-${(i % 5) + 1}`} />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="rgh" aria-label={t('tokenizedAssets.globalHero.eyebrow', 'Global Tokenized Asset Market')}>
      <header className="rgh__head">
        <span className="rgh__eyebrow">
          <span className="rgh__live" aria-hidden />
          {t('tokenizedAssets.globalHero.eyebrow', 'Global Tokenized Asset Market')}
        </span>
        <span className="rgh__total mono">
          {hovered && mode === 'value' ? fmtUsd(hovered.v) : fmtUsd(countTotal ?? headTotal)}
        </span>
        <div className="rgh__lede-row">
          <span className="rgh__lede">{t('tokenizedAssets.globalHero.lede', 'of real-world value, now tokenized on-chain')}</span>
          {change30d != null && (
            <span className={`rgh__delta ${change30d >= 0 ? 'up' : 'dn'}`}>
              <span className="rgh__delta-arrow" aria-hidden>{change30d >= 0 ? '↑' : '↓'}</span>
              <span className="rgh__delta-val mono">{fmtPct(change30d)}</span>
              <span className="rgh__delta-tf">30D</span>
            </span>
          )}
        </div>
      </header>

      <div className="rgh__chart">
        <div className="rgh__controls">
          <div className="rgh__toggle" role="tablist">
            {MODES.map(m => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`rgh__toggle-btn${mode === m.id ? ' on' : ''}`}
                onClick={() => { setMode(m.id); setHoverIdx(null); setHoverLane(null) }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <TimeframePills value={tf} onChange={setTf} options={TF_OPTIONS} size="sm" />
        </div>

      <div
        className="rgh__stage"
        ref={stageRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {points && (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="rgh__svg">
            <defs>
              <linearGradient id={GRAD_ID} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#5EEAD4" stopOpacity="0.42" />
                <stop offset="55%" stopColor="#5EEAD4" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#5EEAD4" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Y gridlines */}
            {yTicks.map((g, i) => (
              <line
                key={`yg-${i}`}
                x1={PAD.l} x2={W - PAD.r}
                y1={g.y} y2={g.y}
                stroke={gridStroke}
                strokeDasharray="1.5 4"
                strokeWidth="1"
              />
            ))}
            {/* Zero line for flows mode */}
            {mode === 'flows' && (
              <line
                x1={PAD.l} x2={W - PAD.r}
                y1={points.yAt(0)} y2={points.yAt(0)}
                stroke={zeroStroke}
                strokeWidth="1"
              />
            )}

            {mode === 'class' ? (
              /* Stacked category lanes (painted bottom-up, so reverse for
                 z-order), then per-lane top edges: a 2px background gap under
                 a crisp 1.2px colour line separates adjacent fills. Hovering
                 a lane (chart or legend) lifts it and quiets the rest. */
              <>
                {[...points.stackedPaths].reverse().map((p, ri) => {
                  const li = points.stackedPaths.length - 1 - ri
                  return (
                    <path
                      key={p.key}
                      d={p.d}
                      fill={p.color}
                      style={{
                        fillOpacity: hoverLane == null ? 0.72 : (li === hoverLane ? 0.92 : 0.28),
                        transition: 'fill-opacity 140ms ease',
                      }}
                    />
                  )
                })}
                {points.stackedPaths.map(p => (
                  <path key={`gap-${p.key}`} d={p.edge} fill="none" stroke={dotStroke} strokeWidth="2" strokeLinejoin="round" />
                ))}
                {points.stackedPaths.map((p, li) => (
                  <path
                    key={`edge-${p.key}`}
                    d={p.edge}
                    fill="none"
                    stroke={p.color}
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                    style={{
                      strokeOpacity: hoverLane == null || li === hoverLane ? 1 : 0.35,
                      transition: 'stroke-opacity 140ms ease',
                    }}
                  />
                ))}
              </>
            ) : mode === 'flows' ? (
              /* Polarity bars — inflow up in green, outflow down in red */
              <g shapeRendering="crispEdges">
                {points.pts.map((p, i) => {
                  const y0 = points.yAt(0)
                  const up = p.v >= 0
                  const h = Math.max(1, Math.abs(y0 - p.y))
                  return (
                    <rect
                      key={i}
                      x={p.x - points.barW / 2}
                      y={up ? p.y : y0}
                      width={points.barW}
                      height={h}
                      fill={up ? (dayMode ? FLOW_UP_DAY : FLOW_UP) : (dayMode ? FLOW_DN_DAY : FLOW_DN)}
                      fillOpacity={hoverIdx === i ? 1 : 0.82}
                    />
                  )
                })}
              </g>
            ) : (
              <>
                <path d={areaPath} fill={`url(#${GRAD_ID})`} className="rgh__area" />
                {/* Soft-glow underlay (wide, low-opacity) then the crisp line on top —
                    a stretch-safe glow that an feGaussianBlur can't give in a
                    preserveAspectRatio="none" viewBox. */}
                <path d={linePath} fill="none" stroke="#5EEAD4" strokeWidth="4" opacity="0.18" strokeLinecap="round" strokeLinejoin="round" />
                <path d={linePath} className="rgh__line" pathLength="1" fill="none" stroke="#5EEAD4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}

            {hovered && (
              <g>
                <line
                  x1={hovered.x} x2={hovered.x}
                  y1={PAD.t} y2={H - PAD.b}
                  stroke={crosshairStroke}
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {mode !== 'flows' && (
                  <circle cx={hovered.x} cy={hovered.y} r="3.6" fill="#5EEAD4" stroke={dotStroke} strokeWidth="1.4" />
                )}
              </g>
            )}
            {/* End-cap dot (always visible — gives the live total a visual anchor).
                Flows mode skips it: the last bar is its own anchor. */}
            {!hovered && mode !== 'flows' && points.pts.length > 0 && (() => {
              const last = points.pts[points.pts.length - 1]
              return (
                <g>
                  <circle className="rgh__enddot-halo" cx={last.x} cy={last.y} r="7" fill="#5EEAD4" opacity="0.18" style={{ transformOrigin: `${last.x}px ${last.y}px` }} />
                  <circle cx={last.x} cy={last.y} r="3.4" fill="#5EEAD4" stroke={dotStroke} strokeWidth="1.2" />
                </g>
              )
            })()}
          </svg>
        )}

        {/* Tweet-ready value annotations. Total Value: start + ATH + current.
            Net Flows: peak inflow above + peak outflow below (a first-day
            "start" flow is meaningless there). */}
        {points && !hovered && mode === 'flows' && (() => {
          const pts = points.pts
          let maxPt = pts[0], minPt = pts[0]
          for (const p of pts) {
            if (p.v > maxPt.v) maxPt = p
            if (p.v < minPt.v) minPt = p
          }
          return (
            <>
              {maxPt.v > 0 && (
                <span
                  className="rgh__annot rgh__annot--peak mono"
                  style={{ left: `${(maxPt.x / W) * 100}%`, top: `${(maxPt.y / H) * 100}%` }}
                >
                  Peak {fmtSignedUsd(maxPt.v)}
                </span>
              )}
              {minPt.v < 0 && Math.abs(minPt.x - maxPt.x) > 60 && (
                <span
                  className="rgh__annot rgh__annot--trough mono"
                  style={{ left: `${(minPt.x / W) * 100}%`, top: `${(minPt.y / H) * 100}%` }}
                >
                  {fmtSignedUsd(minPt.v)}
                </span>
              )}
            </>
          )
        })()}
        {points && !hovered && mode === 'value' && (() => {
          const N = points.pts.length
          // Use the displayed/scaled total for the "current" badge so it matches
          // the headline ($27.35B), not the truncated series end ($23.92B).
          const startPt = points.pts[0]
          let peakPt = points.pts[0]
          for (const p of points.pts) if (p.v > peakPt.v) peakPt = p
          const endPt = points.pts[N - 1]
          return (
            <>
              <span
                className="rgh__annot rgh__annot--start mono"
                style={{ left: `${(startPt.x / W) * 100}%`, top: `${(startPt.y / H) * 100}%` }}
              >
                {fmtUsd(startPt.v)}
              </span>
              {peakPt !== startPt && peakPt !== endPt && peakPt.v > endPt.v &&
                (endPt.x - peakPt.x) > 120 && (peakPt.x - startPt.x) > 120 && (
                <span
                  className="rgh__annot rgh__annot--peak mono"
                  style={{ left: `${(peakPt.x / W) * 100}%`, top: `${(peakPt.y / H) * 100}%` }}
                >
                  ATH {fmtUsd(peakPt.v)}
                </span>
              )}
              <span
                className="rgh__annot rgh__annot--end mono"
                style={{ left: `${(endPt.x / W) * 100}%`, top: `${(endPt.y / H) * 100}%` }}
              >
                {fmtUsd(headTotal)}
              </span>
            </>
          )
        })()}

        {/* HTML axis overlays — crisp text outside the stretched SVG */}
        <div className="rgh__axis-overlay">
          {yTicks.map((g, i) => (
            <span
              key={`yh-${i}`}
              className="rgh__axis-y mono"
              style={{
                top: `${(g.y / H) * 100}%`,
                left: `${(PAD.l / W) * 100}%`,
              }}
            >
              {mode === 'flows' ? (g.v === 0 ? fmtUsd(0) : fmtSignedUsd(g.v)) : fmtUsd(g.v)}
            </span>
          ))}
          {xTicks.map((t, i) => (
            <span
              key={`xh-${i}`}
              className="rgh__axis-x"
              style={{ left: `${(t.x / W) * 100}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>

        {/* Tooltip — anchored to hover x via CSS percentage */}
        {hovered && (
          <div
            className="rgh__tip"
            style={{
              left: `${(hovered.x / W) * 100}%`,
              transform: hovered.x > W * 0.62 ? 'translate(-100%, 0)' : 'translate(0, 0)',
            }}
          >
            <div className="rgh__tip-date">{fmtFullDate(hovered.date)}</div>
            <div className="rgh__tip-val mono">
              {mode === 'flows' ? fmtSignedUsd(hovered.v) : fmtUsd(hovered.v)}
            </div>
            {mode === 'class' && points?.stacks?.[hoverIdx] && (() => {
              const st = points.stacks[hoverIdx]
              const hotKey = hoverLane != null ? lanes[hoverLane]?.key : null
              return (
                <div className="rgh__tip-lanes">
                  {[...st.stack]
                    .filter(s => s.val > 0)
                    .sort((a, b) => b.val - a.val)
                    .map(s => (
                      <div key={s.key} className={`rgh__tip-lane${s.key === hotKey ? ' hot' : ''}`}>
                        <span className="rgh__tip-dot" style={{ background: s.color }} />
                        <span className="rgh__tip-name">{s.key}</span>
                        <span className="rgh__tip-num mono">{fmtUsd(s.val)}</span>
                        <span className="rgh__tip-pct mono">{st.total > 0 ? `${((s.val / st.total) * 100).toFixed(1)}%` : '--'}</span>
                      </div>
                    ))}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Lane legend — By Class only (colors match the Class Allocation donut) */}
      {mode === 'class' && lanes.length > 0 && (
        <div className="rgh__legend">
          {lanes.map((l, i) => (
            <span
              key={l.key}
              className={`rgh__legend-item${hoverLane != null && hoverLane !== i ? ' dim' : ''}`}
              onMouseEnter={() => setHoverLane(i)}
              onMouseLeave={() => setHoverLane(null)}
            >
              <span className="rgh__legend-dot" style={{ background: l.color }} />
              {l.key}
            </span>
          ))}
        </div>
      )}
      </div>

      <div className="rgh__stats">
        <div className="rgh__stat">
          <span className="rgh__stat-label">{t('tokenizedAssets.kpi.change30d', '30D Change')}</span>
          <span className={`rgh__stat-val mono ${change30d != null && change30d >= 0 ? 'rgh__stat-val--up' : change30d != null ? 'rgh__stat-val--dn' : ''}`}>
            {change30d == null ? '--' : fmtPct(change30d)}
          </span>
        </div>
        <div className="rgh__stat">
          <span className="rgh__stat-label">{t('tokenizedAssets.globalHero.change7d', '7D Change')}</span>
          <span className={`rgh__stat-val mono ${change7d != null && change7d >= 0 ? 'rgh__stat-val--up' : change7d != null ? 'rgh__stat-val--dn' : ''}`}>
            {change7d == null ? '--' : fmtPct(change7d)}
          </span>
        </div>
        <div className="rgh__stat">
          <span className="rgh__stat-label">{t('tokenizedAssets.globalHero.netFlows7d', '7D Net Flows')}</span>
          <span className={`rgh__stat-val mono ${netFlow7d != null && netFlow7d >= 0 ? 'rgh__stat-val--up' : netFlow7d != null ? 'rgh__stat-val--dn' : ''}`}>
            {netFlow7d == null ? '--' : fmtSignedUsd(netFlow7d)}
          </span>
        </div>
        <div className="rgh__stat">
          <span className="rgh__stat-label">{t('tokenizedAssets.kpi.activeNetworks', 'Active Networks')}</span>
          <span className="rgh__stat-val mono">{overview?.totalChains ?? '--'}</span>
        </div>
        <div className="rgh__stat">
          <span className="rgh__stat-label">{t('tokenizedAssets.globalHero.totalIssuers', 'Total Issuers')}</span>
          <span className="rgh__stat-val mono">{overview?.totalProtocols ?? '--'}</span>
        </div>
        {/* Phase 3: holders + represented value, surfaced ONLY when the
            issuer-direct breakdown is available. Rendering empty "--" cells
            when it's null read as unfinished, so we skip them entirely. */}
        {breakdown?.total_holders != null && (
          <div className="rgh__stat">
            <span className="rgh__stat-label">{t('tokenizedAssets.globalHero.assetHolders', 'Asset Holders')}</span>
            <span className="rgh__stat-val mono">{fmtCount(breakdown.total_holders)}</span>
          </div>
        )}
        {breakdown?.represented_value_usd != null && (
          <div className="rgh__stat">
            <span className="rgh__stat-label">{t('tokenizedAssets.globalHero.representedValue', 'Represented Value')}</span>
            <span className="rgh__stat-val mono">{fmtUsd(breakdown.represented_value_usd)}</span>
          </div>
        )}
        {/* Phase 6 (2026-05-09): Spectre RWA Index (SRWAI) flagship benchmark.
            Renders only when /api/rwa/index has data; absent on first deploy. */}
        {srwaIndex && Number.isFinite(srwaIndex.index_value) && (
          <div className="rgh__stat" title="Spectre RWA Index — top 50 issuers, capped 15% per name, weekly rebalance">
            <span className="rgh__stat-label">{t('tokenizedAssets.globalHero.srwai', 'Spectre RWA Index')}</span>
            <span className={`rgh__stat-val mono ${srwaIndex.change_30d_pct != null && srwaIndex.change_30d_pct >= 0 ? 'rgh__stat-val--up' : srwaIndex.change_30d_pct != null ? 'rgh__stat-val--dn' : ''}`}>
              {Number(srwaIndex.index_value).toFixed(2)}
              {srwaIndex.change_30d_pct != null && (
                <span className="rgh__stat-sub">
                  {' '}({srwaIndex.change_30d_pct >= 0 ? '+' : ''}{srwaIndex.change_30d_pct.toFixed(2)}% 30D)
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
