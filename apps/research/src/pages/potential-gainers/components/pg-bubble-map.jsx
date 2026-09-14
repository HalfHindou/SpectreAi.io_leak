/*
 * PGBubbleMap - Return Bubble Map (hand-rolled SVG scatter chart)
 *
 * X-axis: age_since_signal_hours (0 → max).
 * Y-axis: return_since_signal_pct (bipolar - zero line, positive above, negative below).
 * Bubble radius: proportional to setup_score (clamped 0-100).
 * Bubble fill: lifecycle phase tone (warm-white opacity ramp, fresh brightest).
 * Outer ring halo: marks peak_return_since_signal_pct.
 * Hover tooltip: symbol, age, return, peak, phase.
 *
 * No chart library. Plain SVG. All layout math is pure JS.
 * Design rule: bull/bear allowed on Y-axis (it IS return data).
 * Never neon, never rainbow, tasteful phase-tone scale only.
 */

import { useRef, useState, useMemo } from 'react'
import { toNumber, lifecycleMeta, formatSignedPct, returnTone } from './pg-utils'

/* Phase fill opacities — warm-white ramp. More opaque = more actionable. */
const PHASE_FILL = {
  fresh: 'rgba(245,245,247,0.80)',
  developing: 'rgba(245,245,247,0.60)',
  runner: 'rgba(245,245,247,0.45)',
  already_ran: 'rgba(245,245,247,0.28)',
  matured_positive: 'rgba(245,245,247,0.22)',
  stalled: 'rgba(245,245,247,0.14)',
  drawdown: 'rgba(245,245,247,0.10)',
}
const PHASE_STROKE = {
  fresh: 'rgba(245,245,247,0.55)',
  developing: 'rgba(245,245,247,0.38)',
  runner: 'rgba(245,245,247,0.28)',
  already_ran: 'rgba(245,245,247,0.18)',
  matured_positive: 'rgba(245,245,247,0.14)',
  stalled: 'rgba(245,245,247,0.10)',
  drawdown: 'rgba(245,245,247,0.07)',
}

/* Chart geometry */
const MARGIN = { top: 18, right: 28, bottom: 36, left: 52 }
const MIN_R = 5
const MAX_R = 18

function lerp(a, b, t) { return a + (b - a) * t }

/* Map a data value to a pixel position within [minPx, maxPx]. */
function scaleLinear(val, dataMin, dataMax, minPx, maxPx) {
  if (dataMax === dataMin) return (minPx + maxPx) / 2
  return lerp(minPx, maxPx, (val - dataMin) / (dataMax - dataMin))
}

function fmtAge(hours) {
  if (hours == null) return '—'
  const h = Math.round(hours)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function Tooltip({ x, y, point, svgWidth, svgHeight }) {
  if (!point) return null
  const lc = lifecycleMeta(point.phase)
  const tone = returnTone(point.ret)
  const peakTone = returnTone(point.peak)

  /* Nudge tooltip so it stays inside the SVG bounding box */
  const TW = 190
  const TH = 116
  const pad = 12
  let tx = x + 14
  let ty = y - TH / 2
  if (tx + TW > svgWidth - pad) tx = x - TW - 14
  if (ty < pad) ty = pad
  if (ty + TH > svgHeight - pad) ty = svgHeight - TH - pad

  return (
    <g transform={`translate(${tx},${ty})`} className="pg-bmap__tip">
      <rect
        x={0} y={0} width={TW} height={TH}
        rx={7} ry={7}
        className="pg-bmap__tip-bg"
      />
      <text x={12} y={20} className="pg-bmap__tip-sym">{point.symbol}</text>
      <text x={12} y={36} className="pg-bmap__tip-meta">{lc.label}</text>
      <text x={12} y={54} className="pg-bmap__tip-label">Age</text>
      <text x={TW - 12} y={54} className="pg-bmap__tip-val" textAnchor="end">
        {fmtAge(point.age)}
      </text>
      <text x={12} y={70} className="pg-bmap__tip-label">Return</text>
      <text
        x={TW - 12} y={70}
        className={`pg-bmap__tip-val pg-bmap__tip-val--${tone}`}
        textAnchor="end"
      >
        {point.ret != null ? formatSignedPct(point.ret) : '—'}
      </text>
      <text x={12} y={86} className="pg-bmap__tip-label">Peak</text>
      <text
        x={TW - 12} y={86}
        className={`pg-bmap__tip-val pg-bmap__tip-val--${peakTone}`}
        textAnchor="end"
      >
        {point.peak != null ? formatSignedPct(point.peak) : '—'}
      </text>
      <text x={12} y={106} className="pg-bmap__tip-label">Score</text>
      <text x={TW - 12} y={106} className="pg-bmap__tip-val" textAnchor="end">
        {point.score != null ? Math.round(point.score) : '—'}
      </text>
    </g>
  )
}

function BubbleMapShimmer() {
  return (
    <div className="pg-bmap pg-bmap--shimmer">
      <div className="pg-bmap__header">
        <span className="pg-shimmer-bar animate-shimmer" style={{ width: 120, height: 14 }} />
        <span className="pg-shimmer-bar animate-shimmer" style={{ width: 80, height: 11 }} />
      </div>
      <div className="pg-bmap__canvas-wrap">
        <div className="pg-bmap__shimmer-canvas animate-shimmer" />
      </div>
    </div>
  )
}

export default function PGBubbleMap({ signals, loading }) {
  const svgRef = useRef(null)
  const [hovered, setHovered] = useState(null)

  /* Build data points from signals array */
  const points = useMemo(() => {
    const list = Array.isArray(signals) ? signals : []
    return list
      .map((row) => {
        const pg = row?.potential_gainer || {}
        const token = row?.token || {}
        const age = toNumber(pg.age_since_signal_hours)
        const ret = toNumber(pg.return_since_signal_pct)
        const peak = toNumber(pg.peak_return_since_signal_pct)
        const score = toNumber(pg.setup_score)
        const phase = pg.lifecycle?.phase || 'developing'
        if (age == null) return null
        return {
          symbol: token.symbol ? String(token.symbol).replace(/^\$/, '') : '?',
          age,
          ret: ret ?? 0,
          peak: peak ?? ret ?? 0,
          score: score ?? 50,
          phase,
          id: token.cg_id || token.symbol,
        }
      })
      .filter(Boolean)
  }, [signals])

  /* Chart dimensions - responsive via percentage of container. We use a fixed
     viewBox so the SVG scales itself; no ResizeObserver needed. */
  const VIEW_W = 640
  const VIEW_H = 320

  const plotW = VIEW_W - MARGIN.left - MARGIN.right
  const plotH = VIEW_H - MARGIN.top - MARGIN.bottom

  const xMin = 0
  const xMax = Math.max(24, ...points.map((p) => p.age))
  const retValues = points.map((p) => p.ret)
  const rawRetMin = Math.min(0, ...retValues)
  const rawRetMax = Math.max(0, ...retValues)
  /* Add 10% padding on y-axis */
  const yPad = Math.max(10, (rawRetMax - rawRetMin) * 0.12)
  const yMin = rawRetMin - yPad
  const yMax = rawRetMax + yPad

  const scoreValues = points.map((p) => p.score)
  const scoreMin = Math.min(...scoreValues)
  const scoreMax = Math.max(...scoreValues)

  function px(age) {
    return scaleLinear(age, xMin, xMax, 0, plotW)
  }
  function py(ret) {
    return scaleLinear(ret, yMin, yMax, plotH, 0) // inverted Y
  }
  function pr(score) {
    if (scoreMax === scoreMin) return (MIN_R + MAX_R) / 2
    return lerp(MIN_R, MAX_R, (score - scoreMin) / (scoreMax - scoreMin))
  }

  /* Zero line Y in plot space */
  const zeroY = py(0)

  /* X-axis ticks: 0, 24h, 48h, 72h, ... up to xMax */
  const xTicks = useMemo(() => {
    const step = xMax <= 72 ? 24 : xMax <= 168 ? 48 : 72
    const ticks = []
    for (let v = 0; v <= xMax; v += step) ticks.push(v)
    return ticks
  }, [xMax])

  /* Y-axis ticks: multiples of 50 between yMin and yMax */
  const yTicks = useMemo(() => {
    const magnitude = Math.max(50, Math.ceil((yMax - yMin) / 5 / 50) * 50)
    const step = magnitude <= 100 ? 25 : 50
    const ticks = []
    const start = Math.ceil(yMin / step) * step
    for (let v = start; v <= yMax; v += step) ticks.push(v)
    return ticks
  }, [yMin, yMax])

  function handleMouseMove(e) {
    const svg = svgRef.current
    if (!svg || points.length === 0) return
    const rect = svg.getBoundingClientRect()
    const scaleX = VIEW_W / rect.width
    const scaleY = VIEW_H / rect.height
    const mx = (e.clientX - rect.left) * scaleX - MARGIN.left
    const my = (e.clientY - rect.top) * scaleY - MARGIN.top

    /* Find nearest point within a generous 32px radius */
    let nearest = null
    let nearestDist = Infinity
    points.forEach((p) => {
      const bx = px(p.age)
      const by = py(p.ret)
      const r = pr(p.score)
      const dist = Math.hypot(mx - bx, my - by)
      if (dist < r + 16 && dist < nearestDist) {
        nearestDist = dist
        nearest = { ...p, svgX: bx + MARGIN.left, svgY: by + MARGIN.top }
      }
    })
    setHovered(nearest)
  }

  function handleMouseLeave() { setHovered(null) }

  if (loading) return <BubbleMapShimmer />

  if (points.length === 0) {
    return (
      <div className="pg-bmap">
        <div className="pg-bmap__header">
          <span className="pg-bmap__title">Return Map</span>
        </div>
        <div className="pg-empty pg-empty--compact">
          <div className="pg-empty__detail">No signal data to map yet</div>
        </div>
      </div>
    )
  }

  return (
    <div className="pg-bmap">
      <div className="pg-bmap__header">
        <div>
          <span className="pg-bmap__title">Return Map</span>
          <span className="pg-bmap__sub">Age vs return since PG signal. Bubble size = setup score. Outer ring = peak.</span>
        </div>
        <div className="pg-bmap__legend" aria-hidden="true">
          <span className="pg-bmap__legend-item">
            <span className="pg-bmap__legend-dot pg-bmap__legend-dot--fresh" />
            Fresh
          </span>
          <span className="pg-bmap__legend-item">
            <span className="pg-bmap__legend-dot pg-bmap__legend-dot--developing" />
            Developing
          </span>
          <span className="pg-bmap__legend-item">
            <span className="pg-bmap__legend-dot pg-bmap__legend-dot--runner" />
            Runner+
          </span>
        </div>
      </div>

      <div className="pg-bmap__canvas-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="pg-bmap__svg"
          role="img"
          aria-label="Return bubble map showing age vs return for each signal"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <clipPath id="pg-bmap-clip">
              <rect x={0} y={0} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Y-axis grid lines + labels */}
            {yTicks.map((v) => {
              const y = py(v)
              if (y < -2 || y > plotH + 2) return null
              const isZero = v === 0
              return (
                <g key={v}>
                  <line
                    x1={0} y1={y} x2={plotW} y2={y}
                    className={isZero ? 'pg-bmap__grid-zero' : 'pg-bmap__grid-line'}
                  />
                  <text x={-8} y={y + 4} className="pg-bmap__axis-label" textAnchor="end">
                    {v > 0 ? `+${v}%` : `${v}%`}
                  </text>
                </g>
              )
            })}

            {/* X-axis ticks + labels */}
            {xTicks.map((v) => {
              const x = px(v)
              return (
                <g key={v}>
                  <line
                    x1={x} y1={0} x2={x} y2={plotH}
                    className="pg-bmap__grid-line pg-bmap__grid-line--v"
                  />
                  <text x={x} y={plotH + 16} className="pg-bmap__axis-label" textAnchor="middle">
                    {v < 24 ? `${v}h` : `${Math.round(v / 24)}d`}
                  </text>
                </g>
              )
            })}

            {/* Positive/negative zone tint */}
            {yMax > 0 && (
              <rect
                x={0} y={0} width={plotW} height={Math.max(0, Math.min(zeroY, plotH))}
                className="pg-bmap__zone-positive"
                clipPath="url(#pg-bmap-clip)"
              />
            )}
            {yMin < 0 && (
              <rect
                x={0} y={Math.max(0, zeroY)} width={plotW}
                height={Math.max(0, plotH - zeroY)}
                className="pg-bmap__zone-negative"
                clipPath="url(#pg-bmap-clip)"
              />
            )}

            {/* Bubbles */}
            <g clipPath="url(#pg-bmap-clip)">
              {points.map((p) => {
                const bx = px(p.age)
                const by = py(p.ret)
                const r = pr(p.score)
                /* Peak ring radius: scaled by peak vs current ret difference.
                   The halo sits just outside the fill bubble. */
                const peakRingR = p.peak > p.ret
                  ? r + Math.min(6, (p.peak - p.ret) / 30 * 6 + 2)
                  : r + 1.5
                const fill = PHASE_FILL[p.phase] || PHASE_FILL.developing
                const stroke = PHASE_STROKE[p.phase] || PHASE_STROKE.developing
                const isHov = hovered?.id === p.id

                return (
                  <g key={p.id}>
                    {/* Peak halo ring */}
                    {p.peak != null && p.peak > 0 && (
                      <circle
                        cx={bx} cy={by} r={peakRingR}
                        className="pg-bmap__bubble-halo"
                        style={{ stroke }}
                      />
                    )}
                    {/* Main bubble */}
                    <circle
                      cx={bx} cy={by} r={r}
                      className={`pg-bmap__bubble${isHov ? ' pg-bmap__bubble--hov' : ''}`}
                      style={{ fill, stroke }}
                    />
                    {/* Symbol label (only for fresh/developing or hovered) */}
                    {(p.phase === 'fresh' || p.phase === 'developing' || isHov) && (
                      <text
                        x={bx} y={by - r - 4}
                        className="pg-bmap__bubble-label"
                        textAnchor="middle"
                      >
                        {p.symbol}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>

            {/* Zero baseline label */}
            <text x={-8} y={zeroY + 4} className="pg-bmap__zero-label" textAnchor="end">
              0%
            </text>

            {/* Axis labels */}
            <text
              x={plotW / 2} y={plotH + 32}
              className="pg-bmap__axis-title"
              textAnchor="middle"
            >
              Age since signal
            </text>
          </g>

          {/* Tooltip rendered outside the clip so it floats freely */}
          <Tooltip
            x={hovered?.svgX}
            y={hovered?.svgY}
            point={hovered}
            svgWidth={VIEW_W}
            svgHeight={VIEW_H}
          />
        </svg>
      </div>
    </div>
  )
}
