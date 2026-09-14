/**
 * X Dash chart atoms - terminal-grade Recharts surfaces + one custom-SVG sankey.
 * Every chart is SIGNAL not decoration: flat fills, thin strokes, mono numbers,
 * --bull/--bear/amber semantics. Each wraps shimmer + empty states and uses
 * <ResponsiveContainer> for resize. Day mode + mobile handled in x-dash-page CSS.
 *
 * Consumers: views/xd-leaderboard (scatter), views/xd-categories (bar),
 * views/xd-rotations (sankey), views/xd-narratives (share bars),
 * xd-token-drawer (area + radar + stacked bar), xd-author-drawer (area).
 */
import { memo, useMemo, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer, XAxis, YAxis,
  CartesianGrid, Tooltip, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar,
} from 'recharts'
import { hierarchy, treemap as d3treemap, treemapSquarify } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import { formatNum, formatPercent } from './x-dash-utils'
import { computeSignalScore, SIGNAL_TIER_LABEL } from './xd-signal'
import { Avatar, RankMove } from './xd-bits'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import useSettingsStore from '@/store/useSettingsStore'
import ChartWatermark from '@/components/chart-watermark'

/* ---------- shared palette ---------- Recharts needs literal color values
   (no CSS vars), so the palette ships in two flavors and a hook picks the
   right one based on the user's dayMode setting. Each chart calls
   `useChartPalette()` to grab a `C` object with the same keys regardless
   of mode — internal references stay identical. */
const C_DARK = {
  bull: '#10B981',
  bear: '#EF4444',
  amber: '#F59E0B',
  cyan: '#06B6D4',
  grid: 'rgba(255,255,255,0.05)',
  axis: 'rgba(245,245,247,0.35)',
  neutral: 'rgba(245,245,247,0.45)',
  series1: 'rgba(245,245,247,0.85)',
  series2: '#06B6D4',
  /* leaderboard-map field styling */
  dot: 'rgba(255,255,255,0.07)',
  plotBorder: 'rgba(255,255,255,0.05)',
  labelInk: 'rgba(245,245,247,0.78)',
  labelHalo: 'rgba(9,9,11,0.9)',
  heatA: 'rgba(16,185,129,0.11)',
  heatB: 'rgba(16,185,129,0)',
}
const C_LIGHT = {
  bull: '#047857',
  bear: '#b91c1c',
  amber: '#b45309',
  cyan: '#0891b2',
  grid: 'rgba(15,23,42,0.10)',
  axis: 'rgba(15,23,42,0.55)',
  /* Score-ranking + bar fills need real ink on white — `neutral` was the
     biggest offender, rendering bars as ghost shapes. Going dark slate
     makes the bars actually scannable. */
  neutral: 'rgba(15,23,42,0.62)',
  series1: 'rgba(15,23,42,0.78)',
  series2: '#0891b2',
  /* leaderboard-map field styling */
  dot: 'rgba(15,23,42,0.12)',
  plotBorder: 'rgba(15,23,42,0.08)',
  labelInk: 'rgba(15,23,42,0.82)',
  labelHalo: 'rgba(255,255,255,0.92)',
  heatA: 'rgba(5,150,105,0.08)',
  heatB: 'rgba(5,150,105,0)',
}
function useChartPalette() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  return dayMode ? C_LIGHT : C_DARK
}
/* Module-level default — kept so module-level helpers (signalColor, etc.)
   that fire outside React render still resolve to a usable palette.
   Renders inside chart components shadow this with the live palette. */
const C = C_DARK
const TICK = { fontSize: 10, fill: C.axis, fontFamily: 'var(--font-body)' }

/* clean-signal -> fill color (mirrors xd-bits cleanSignalTone) */
function signalColor(score) {
  const s = Number(score || 0)
  if (s >= 0.70) return C.bull
  if (s >= 0.55) return C.amber
  return C.bear
}

/* ---------- generic chart frame: handles loading / empty ----------
   On the active state the wrapper uses min-height (not fixed height) so
   charts that render a legend below the SVG can grow. The Recharts
   ResponsiveContainer inside each chart carries its own explicit numeric
   height, so the SVG itself never depends on this wrapper's height.

   The chart children mount only AFTER the wrapper has a measured width.
   Views lazy-mount and drawers slide in - if ResponsiveContainer renders
   while its parent still measures 0, Recharts logs a width(-1) warning.
   Gating on a measured width keeps the console clean without losing
   ResponsiveContainer's resize behaviour. */
export function XDChartFrame({ loading, empty, emptyLabel, height = 200, children }) {
  /* default emptyLabel resolved here so callers without `t` get a
     localized fallback string. */
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { t: tFn } = useTranslation()
  const resolvedEmpty = emptyLabel || tFn('xDash.charts.noData', 'No data for this window')
  const wrapRef = useRef(null)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    if (loading || empty) return undefined
    const el = wrapRef.current
    if (!el) return undefined
    if (el.offsetWidth > 0) {
      setReady(true)
      return undefined
    }
    // parent not measured yet (sliding drawer / lazy view) - watch for size
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setReady(true)
          ro.disconnect()
          break
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading, empty])

  if (loading) {
    return (
      <div className="xd-chart-shimmer animate-shimmer" style={{ height }} aria-hidden="true" />
    )
  }
  if (empty) {
    return (
      <div className="xd-chart-empty" style={{ height }}>
        <span className="xd-chart-empty__label">{resolvedEmpty}</span>
      </div>
    )
  }
  return (
    <div ref={wrapRef} className="xd-chart spectre-wm-host" style={{ minHeight: height }}>
      {ready ? children : null}
      {ready ? <ChartWatermark /> : null}
    </div>
  )
}

/* ---------- tooltip shells ---------- */
function TooltipShell({ title, rows }) {
  return (
    <div className="xd-charttip">
      {title && <div className="xd-charttip__title xd-num">{title}</div>}
      {rows.map((r) => (
        <div className="xd-charttip__row" key={r.label}>
          <span className="xd-charttip__label">{r.label}</span>
          <span className={`xd-charttip__value xd-num${r.tone ? ` xd-charttip__value--${r.tone}` : ''}`}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ============================================================
   1. LEADERBOARD MAP - velocity x novelty scatter
   ============================================================ */
const AXIS_CAP = 8 // ratios can be huge; clamp display domain

/* Custom-SVG leaderboard map: token-logo bubbles (clipped circle + brand
   ring), rich hover tooltip with logo + 4 metrics, staggered entrance
   animation, breathing pulse on the brightest signal. Replaces the
   Recharts scatter so we own every interaction. */
export function XDLeaderboardMap({ tokens = [], loading, onOpenToken }) {
  const { t } = useTranslation()
  const C = useChartPalette()
  const containerRef = useRef(null)
  const roRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 540 })
  const [hovered, setHovered] = useState(null) // { id, x, y }

  // Callback ref: the .xd-lmap node mounts only after XDChartFrame flips
  // ready=true, so a deps:[] effect would run while containerRef is still
  // null and never attach the observer (leaving w=0 -> viewBox 400 stretched
  // across the full width). Measuring on node-mount avoids that.
  const setContainer = useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    containerRef.current = node
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0) setSize({ w: rect.width, h: 540 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    roRef.current = ro
  }, [])

  const { points, cap, ticks } = useMemo(() => {
    const raw = (tokens || []).map((row) => {
      const t = row.token || row
      const m = row.metrics || row
      const q = row.quality || row
      const velocityRaw = Number(m.velocity_ratio || 0)
      const noveltyRaw = Number(m.novelty_ratio || 0)
      const signal = Number(q.clean_signal_score_24h ?? m.clean_signal_score_24h ?? 0)
      const mentions = Number(m.external_mentions_24h ?? m.mentions_24h ?? 0)
      const tone = signal >= 0.70 ? 'bull' : signal >= 0.55 ? 'amber' : 'bear'
      const symbol = (t.symbol || '').toUpperCase()
      return {
        cgId: t.cg_id || t.token_id || row.cg_id || row.token_id,
        cashtag: t.cashtag || (t.symbol ? `$${t.symbol}` : t.name || '-'),
        name: t.name || t.cg_id || '',
        image: t.image_small || t.image_url || row.image_small || row.image_url || row.image,
        velocityRaw,
        noveltyRaw,
        signal,
        signalTone: tone,
        mentions,
        fill: signalColor(signal),
        brandRgb: TOKEN_ROW_COLORS[symbol]?.bg || null,
      }
    }).filter((p) => p.cgId)

    const allVals = raw
      .flatMap((p) => [p.velocityRaw, p.noveltyRaw])
      .sort((a, b) => a - b)
    const pctl = allVals.length
      ? allVals[Math.min(allVals.length - 1, Math.floor(allVals.length * 0.75))]
      : 2
    const displayCap = Math.min(AXIS_CAP, Math.max(2, Math.ceil(pctl * 1.2)))
    const step = displayCap <= 2 ? 0.5 : displayCap <= 4 ? 1 : 2
    const axisTicks = []
    for (let v = 0; v <= displayCap + 1e-9; v += step) axisTicks.push(Number(v.toFixed(2)))

    // bubble radius from mentions: log-scale into [10, 26]
    const maxM = Math.max(1, ...raw.map((p) => p.mentions))
    const minM = Math.max(1, Math.min(...raw.map((p) => p.mentions)))
    const logRange = Math.log(maxM + 1) - Math.log(minM + 1) || 1
    const radius = (m) => {
      const t = (Math.log(Math.max(m, 1) + 1) - Math.log(minM + 1)) / logRange
      return 10 + t * 16
    }

    const pts = raw.map((p) => ({
      ...p,
      x: Math.min(p.noveltyRaw, displayCap),
      y: Math.min(p.velocityRaw, displayCap),
      r: radius(p.mentions),
      outlier: p.velocityRaw > displayCap || p.noveltyRaw > displayCap,
    }))

    return { points: pts, cap: displayCap, ticks: axisTicks }
  }, [tokens])

  const empty = !loading && points.length === 0

  // plot geometry
  const pad = { left: 40, right: 24, top: 28, bottom: 40 }
  const w = Math.max(size.w, 400)
  const h = size.h
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom
  const xPx = (v) => pad.left + (v / cap) * plotW
  const yPx = (v) => pad.top + plotH - (v / cap) * plotH

  /* Cashtag labels for the loudest bubbles — greedy collision filter in
     pixel space so labels never stack. Hero = the loudest strong-signal
     bubble; it gets the marching halo ring. */
  const { labelIds, heroId } = useMemo(() => {
    const sorted = [...points].sort((a, b) => b.mentions - a.mentions)
    const ids = new Set()
    const placed = []
    for (const p of sorted) {
      if (ids.size >= 10) break
      const cx = pad.left + (p.x / cap) * plotW
      const cy = pad.top + plotH - (p.y / cap) * plotH
      if (placed.some((q) => Math.abs(q.cx - cx) < 62 && Math.abs(q.cy - cy) < 30)) continue
      placed.push({ cx, cy })
      ids.add(p.cgId)
    }
    const hero = sorted.find((p) => p.signal >= 0.7) || sorted[0]
    return { labelIds: ids, heroId: hero?.cgId || null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, cap, plotW, plotH])

  const handleEnter = (e, p) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHovered({
      id: p.cgId,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      point: p,
    })
  }
  const handleLeave = () => setHovered(null)
  const handleMove = (e) => {
    if (!hovered) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHovered((prev) => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : prev)
  }

  return (
    <XDChartFrame loading={loading} empty={empty} emptyLabel={t('xDash.charts.empty.noTokens', 'No tokens to plot')} height={540}>
      <div className="xd-lmap" ref={setContainer} onMouseMove={handleMove}>
        <svg className="xd-lmap__svg" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            {points.map((p) => (
              <clipPath id={`xd-lmap-clip-${p.cgId}`} key={`clip-${p.cgId}`}>
                <circle cx={xPx(p.x)} cy={yPx(p.y)} r={p.r - 1.5} />
              </clipPath>
            ))}
            {/* dot-grid field — replaces bare gridlines, reads as a radar plate */}
            <pattern id="xd-lmap-dots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.2" fill={C.dot} />
            </pattern>
            {/* attention heat — rises toward the engagement+volume quadrant */}
            <radialGradient id="xd-lmap-heat" cx="88%" cy="8%" r="85%">
              <stop offset="0%" stopColor={C.heatA} />
              <stop offset="100%" stopColor={C.heatB} />
            </radialGradient>
          </defs>

          {/* plot field: dot grid + heat wash + hairline border */}
          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} rx="10" fill="url(#xd-lmap-dots)" />
          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} rx="10" fill="url(#xd-lmap-heat)" />
          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} rx="10" fill="none" stroke={C.plotBorder} strokeWidth="1" />

          {/* axis tick labels — the dot field carries alignment, no gridlines */}
          {ticks.map((tk) => (
            <text key={`xt-${tk}`} x={xPx(tk)} y={h - pad.bottom + 16} textAnchor="middle"
              fontSize="10" fill={C.axis} fontFamily="var(--font-body)">{tk}</text>
          ))}
          {ticks.map((tk) => (
            <text key={`yt-${tk}`} x={pad.left - 8} y={yPx(tk) + 3} textAnchor="end"
              fontSize="10" fill={C.axis} fontFamily="var(--font-body)">{tk}</text>
          ))}

          {/* 1x baseline crosshair — the organic / spike divide */}
          <line
            x1={xPx(1)} y1={pad.top}
            x2={xPx(1)} y2={h - pad.bottom}
            stroke={C.axis} strokeOpacity="0.5" strokeDasharray="3 4" strokeWidth="1"
          />
          <line
            x1={pad.left} y1={yPx(1)}
            x2={w - pad.right} y2={yPx(1)}
            stroke={C.axis} strokeOpacity="0.5" strokeDasharray="3 4" strokeWidth="1"
          />
          <text x={xPx(1) + 5} y={pad.top + plotH - 6} fontSize="9" fill={C.axis}
            fontFamily="var(--font-body)">1× baseline</text>

          {/* hover crosshair: bubble → both axes with live readouts */}
          {hovered?.point && (() => {
            const p = hovered.point
            const cx = xPx(p.x)
            const cy = yPx(p.y)
            const rgb = p.brandRgb || (p.signalTone === 'bull' ? '16,185,129' : p.signalTone === 'amber' ? '245,158,11' : '239,68,68')
            return (
              <g pointerEvents="none">
                <line x1={cx} y1={cy + p.r + 2} x2={cx} y2={h - pad.bottom} stroke={`rgba(${rgb},0.55)`} strokeDasharray="2 3" strokeWidth="1" />
                <line x1={pad.left} y1={cy} x2={cx - p.r - 2} y2={cy} stroke={`rgba(${rgb},0.55)`} strokeDasharray="2 3" strokeWidth="1" />
                <text x={cx} y={h - pad.bottom + 16} textAnchor="middle" fontSize="10" fontWeight="700"
                  fontFamily="var(--font-body)" fill={C.labelInk} stroke={C.labelHalo} strokeWidth="3" paintOrder="stroke">
                  {p.noveltyRaw.toFixed(2)}×
                </text>
                <text x={pad.left - 8} y={cy + 3} textAnchor="end" fontSize="10" fontWeight="700"
                  fontFamily="var(--font-body)" fill={C.labelInk} stroke={C.labelHalo} strokeWidth="3" paintOrder="stroke">
                  {p.velocityRaw.toFixed(2)}×
                </text>
              </g>
            )
          })()}

          {/* axis titles */}
          <text x={pad.left + plotW / 2} y={h - 6} textAnchor="middle"
            fontSize="10" fill={C.axis} fontFamily="var(--font-body)">novelty ratio</text>
          <text x={12} y={pad.top + plotH / 2} textAnchor="middle"
            fontSize="10" fill={C.axis} fontFamily="var(--font-body)"
            transform={`rotate(-90 12 ${pad.top + plotH / 2})`}>velocity ratio</text>

          {/* bubbles */}
          {points.map((p, i) => {
            const cx = xPx(p.x)
            const cy = yPx(p.y)
            const isHovered = hovered?.id === p.cgId
            const ringRgb = p.brandRgb || (p.signalTone === 'bull' ? '16,185,129' : p.signalTone === 'amber' ? '245,158,11' : '239,68,68')
            return (
              <g
                key={p.cgId}
                className={`xd-lmap__bubble${p.outlier ? ' xd-lmap__bubble--outlier' : ''}${p.signal >= 0.7 ? ' xd-lmap__bubble--strong' : ''}${isHovered ? ' is-hovered' : ''}`}
                style={{ animationDelay: `${Math.min(i * 24, 600)}ms`, '--xd-lmap-ring': ringRgb }}
                onMouseEnter={(e) => handleEnter(e, p)}
                onMouseLeave={handleLeave}
                onClick={() => onOpenToken && onOpenToken(p.cgId)}
              >
                {/* outer ring backdrop / glow */}
                <circle
                  cx={cx} cy={cy}
                  r={isHovered ? p.r + 6 : p.r + 2}
                  fill={`rgba(${ringRgb}, 0.18)`}
                  className="xd-lmap__bubble-glow"
                />
                {/* solid bg behind logo (so transparent PNGs read on dark bg) */}
                <circle
                  cx={cx} cy={cy}
                  r={p.r - 1}
                  fill="#0c0c10"
                />
                {/* logo image, clipped to inner circle */}
                {p.image ? (
                  <image
                    href={p.image}
                    x={cx - (p.r - 1.5)} y={cy - (p.r - 1.5)}
                    width={(p.r - 1.5) * 2} height={(p.r - 1.5) * 2}
                    clipPath={`url(#xd-lmap-clip-${p.cgId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ) : (
                  <circle cx={cx} cy={cy} r={p.r - 1.5} fill={p.fill} fillOpacity="0.65" />
                )}
                {/* brand-color outer ring */}
                <circle
                  cx={cx} cy={cy} r={p.r}
                  fill="none"
                  stroke={`rgba(${ringRgb}, ${isHovered ? 1 : 0.65})`}
                  strokeWidth={isHovered ? 2 : 1.5}
                  className="xd-lmap__bubble-ring"
                />
                {/* hero halo — marching dashed orbit on the loudest strong signal */}
                {p.cgId === heroId && (
                  <circle
                    cx={cx} cy={cy} r={p.r + 7}
                    fill="none"
                    stroke={`rgba(${ringRgb}, 0.5)`}
                    strokeWidth="1"
                    strokeDasharray="3 5"
                    className="xd-lmap__halo"
                  />
                )}
                {/* cashtag under the loudest bubbles — the map reads without hover */}
                {labelIds.has(p.cgId) && (
                  <text
                    x={cx} y={cy + p.r + 13} textAnchor="middle"
                    fontSize="10" fontWeight="600" fontFamily="var(--font-body)"
                    fill={C.labelInk} stroke={C.labelHalo} strokeWidth="3" paintOrder="stroke"
                    className="xd-lmap__blabel"
                  >
                    {p.cashtag}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* quadrant chips — read the field at a glance */}
        <span className="xd-lmap__zone" style={{ left: pad.left + 10, top: pad.top + 10 }}>
          <i className="xd-lmap__zonedot xd-lmap__zonedot--amber" aria-hidden="true" />
          {t('xDash.charts.zone.engagement', 'engagement spike')}
        </span>
        <span className="xd-lmap__zone xd-lmap__zone--hot" style={{ right: pad.right + 10, top: pad.top + 10 }}>
          <i className="xd-lmap__zonedot xd-lmap__zonedot--bull" aria-hidden="true" />
          {t('xDash.charts.zone.hot', 'engagement + volume spike')}
        </span>
        <span className="xd-lmap__zone" style={{ left: pad.left + 10, bottom: pad.bottom + 10 }}>
          <i className="xd-lmap__zonedot" aria-hidden="true" />
          {t('xDash.charts.zone.quiet', 'quiet')}
        </span>
        <span className="xd-lmap__zone" style={{ right: pad.right + 10, bottom: pad.bottom + 10 }}>
          <i className="xd-lmap__zonedot xd-lmap__zonedot--cyan" aria-hidden="true" />
          {t('xDash.charts.zone.freshVolume', 'fresh volume')}
        </span>

        {/* legend — how to read the map */}
        <span className="xd-lmap__legend">
          {t('xDash.charts.legend.map', 'size = mentions · ring = brand · color = clean signal')}
        </span>

        {/* hover tooltip — rich preview with logo + metrics */}
        {hovered && hovered.point && (
          <div
            className="xd-lmap__tip"
            style={{
              left: Math.min(hovered.x + 16, w - 240),
              top: Math.max(hovered.y - 8, 8),
            }}
          >
            <div className="xd-lmap__tip-head">
              {hovered.point.image && (
                <img src={hovered.point.image} alt="" className="xd-lmap__tip-logo" />
              )}
              <div className="xd-lmap__tip-id">
                <span className="xd-lmap__tip-cashtag xd-num">{hovered.point.cashtag}</span>
                {hovered.point.name && hovered.point.name !== hovered.point.cashtag && (
                  <span className="xd-lmap__tip-name">{hovered.point.name}</span>
                )}
              </div>
              <span className={`xd-lmap__tip-tone xd-lmap__tip-tone--${hovered.point.signalTone}`}>
                {formatPercent(hovered.point.signal)}
              </span>
            </div>
            <div className="xd-lmap__tip-rows">
              <div className="xd-lmap__tip-row">
                <span className="xd-lmap__tip-label">{t('xDash.charts.tip.mentions24h', 'Mentions 24h')}</span>
                <span className="xd-lmap__tip-value xd-num">{formatNum(hovered.point.mentions)}</span>
              </div>
              <div className="xd-lmap__tip-row">
                <span className="xd-lmap__tip-label">{t('xDash.charts.tip.velocity', 'Velocity')}</span>
                <span className="xd-lmap__tip-value xd-num">{hovered.point.velocityRaw.toFixed(2)}x</span>
              </div>
              <div className="xd-lmap__tip-row">
                <span className="xd-lmap__tip-label">{t('xDash.charts.tip.novelty', 'Novelty')}</span>
                <span className="xd-lmap__tip-value xd-num">{hovered.point.noveltyRaw.toFixed(2)}x</span>
              </div>
              <div className="xd-lmap__tip-row">
                <span className="xd-lmap__tip-label">{t('xDash.charts.tip.cleanSignal', 'Clean signal')}</span>
                <span className={`xd-lmap__tip-value xd-num xd-lmap__tip-value--${hovered.point.signalTone}`}>
                  {formatPercent(hovered.point.signal)}
                </span>
              </div>
            </div>
          </div>
        )}

        <span className="xd-lmap__count">
          <b className="xd-num">{points.length}</b> tokens
        </span>
      </div>
    </XDChartFrame>
  )
}

/* ============================================================
   2. MOMENTUM HISTORY - dual-series area (mentions + engagement)
   shared by token + author drawers. Values normalized 0-1 per series
   so two very different magnitudes stay readable on one axis.
   ============================================================ */
function shortTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // "May 14 21h" style - dense
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const hr = String(d.getHours()).padStart(2, '0')
  return `${day} ${hr}h`
}

/* history: array of snapshots oldest->newest. Each item must expose
   snapshot_at + mentions['24h'] + weighted_engagement['24h'].
   prices: optional 168-point hourly USD spark array from CoinGecko, last
   element = now. When passed, a third price line is overlaid on the
   chart at the same X-positions as the snapshot series — gives the
   viewer "what was the price when this attention spiked?" in one read. */
export function XDMomentumArea({ history = [], prices = null, loading, height = 160 }) {
  const { t } = useTranslation()
  const series = useMemo(() => {
    const rows = (Array.isArray(history) ? history : [])
      .map((h) => ({
        ts: h.snapshot_at,
        mentionsRaw: Number((h.mentions && h.mentions['24h']) ?? h.mentions ?? 0),
        engagementRaw: Number((h.weighted_engagement && h.weighted_engagement['24h']) ?? h.weighted_engagement ?? 0),
      }))
      .filter((r) => r.ts)
      .sort((a, b) => new Date(a.ts) - new Date(b.ts))
    if (!rows.length) return []

    /* Price alignment. CoinGecko spark_in_7d is exactly 168 hourly points
       ending at "now", so index N-1 = now, index N-2 = 1h ago, etc.
       For each snapshot timestamp we round to the nearest hour offset
       and pull the matching price (null if outside the 7d window). */
    const priceArr = Array.isArray(prices) ? prices.filter((p) => Number.isFinite(p)) : []
    const now = Date.now()
    const HOUR = 3_600_000
    const priceFor = (ts) => {
      if (!priceArr.length) return null
      const t = Date.parse(ts)
      if (!Number.isFinite(t)) return null
      const hoursAgo = Math.round((now - t) / HOUR)
      const idx = priceArr.length - 1 - hoursAgo
      if (idx < 0 || idx >= priceArr.length) return null
      return priceArr[idx]
    }
    const rowsWithPrice = rows.map((r) => ({ ...r, priceRaw: priceFor(r.ts) }))

    /* Range-based normalization. Each series maps to [0..1] using its
       OWN min/max with a ±15% padding from the range (not from the
       absolute value). This makes even tiny variations visually
       dramatic — a 1% price move OR a small mentions bump both fill
       most of the vertical band. The three series are independent so
       they can intersect when their trends diverge. */
    const ms = rowsWithPrice.map((r) => r.mentionsRaw)
    const es = rowsWithPrice.map((r) => r.engagementRaw)
    const ps = rowsWithPrice.map((r) => r.priceRaw).filter((v) => v != null && Number.isFinite(v))
    const makeNorm = (vals) => {
      if (!vals.length) return () => 0.5
      const max = Math.max(...vals)
      const min = Math.min(...vals)
      const range = max - min
      if (range <= 0) return () => 0.5
      const pad = range * 0.15
      const lo = min - pad
      const hi = max + pad
      const span = hi - lo || 1
      return (v) => Math.max(0, Math.min(1, (v - lo) / span))
    }
    const normM = makeNorm(ms)
    const normE = makeNorm(es)
    const normP = ps.length >= 2 ? makeNorm(ps) : null
    return rowsWithPrice.map((r) => ({
      ...r,
      label: shortTime(r.ts),
      mentions: normM(r.mentionsRaw),
      engagement: normE(r.engagementRaw),
      price: normP && r.priceRaw != null ? normP(r.priceRaw) : null,
    }))
  }, [history, prices])

  const empty = !loading && series.length === 0
  const hasPrice = series.some((r) => r.price != null)

  return (
    <XDChartFrame loading={loading} empty={empty} emptyLabel={t('xDash.charts.empty.noSnapshot', 'No snapshot history yet')} height={height}>
      <XDMomentumNative series={series} height={height} />
      <div className="xd-chart-legend">
        {hasPrice && (
          <span className="xd-chart-legend__item">
            <span className="xd-chart-legend__swatch" style={{ background: '#f5f5f7', boxShadow: '0 0 6px rgba(255,255,255,0.4)' }} /> {t('xDash.charts.legend.price', 'price')}
          </span>
        )}
        <span className="xd-chart-legend__item">
          <span className="xd-chart-legend__swatch" style={{ background: '#F59E0B', boxShadow: '0 0 6px rgba(245,158,11,0.5)' }} /> {t('xDash.charts.legend.mentions', 'mentions')}
        </span>
        <span className="xd-chart-legend__item">
          <span className="xd-chart-legend__swatch" style={{ background: '#06B6D4', boxShadow: '0 0 6px rgba(6,182,212,0.5)' }} /> {t('xDash.charts.legend.engagement', 'engagement')}
        </span>
      </div>
    </XDChartFrame>
  )
}

/* ============================================================
   Native momentum chart — pure SVG, no Recharts
   ============================================================
   Receives a pre-normalized series where each row carries:
     { ts, label, mentions [0..0.5], engagement [0..0.5], mentionsRaw, engagementRaw }
   Renders two stacked smooth-bezier areas (Catmull-Rom -> cubic),
   top-edge highlight, dashed "now" hairline, glowing end-cap dots,
   raw-value badges, x-axis time ticks, and a hover crosshair tooltip.
*/

/* Cardinal spline -> cubic Bezier path with adjustable tension. Lower
   tension produces softer, more dramatic curves. tension=0 is Catmull-
   Rom; we use 0.35 here for a noticeably more flowy, organic line. */
function smoothPath(points, tension = 0.35) {
  if (points.length < 2) return ''
  const n = points.length
  const k = (1 - tension) / 6
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const cp1x = p1[0] + (p2[0] - p0[0]) * k
    const cp1y = p1[1] + (p2[1] - p0[1]) * k
    const cp2x = p2[0] - (p3[0] - p1[0]) * k
    const cp2y = p2[1] - (p3[1] - p1[1]) * k
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

function XDMomentumNative({ series, height }) {
  const { t } = useTranslation()
  /* This chart is hand-drawn SVG, so it never went through `useChartPalette`
     like the Recharts ones did — every hairline, tick and price label was a
     literal white. On a light skin (day mode, and therefore every PAPER /
     bright PRO theme) the axis labels and the price line painted white on
     white: the momentum panel looked like it had lost its axis. The two
     SERIES colours (cyan / amber) read on both grounds and stay put; only
     the ink and the marker halo flip. */
  const dayMode = useSettingsStore((s) => s.dayMode)
  const ink = dayMode
    ? { grid: 'rgba(15,23,42,0.06)', base: 'rgba(15,23,42,0.14)', tick: 'rgba(15,23,42,0.55)',
        cross: 'rgba(15,23,42,0.3)', crossSoft: 'rgba(15,23,42,0.22)', price: '#0f172a', halo: '#ffffff' }
    : { grid: 'rgba(255,255,255,0.045)', base: 'rgba(255,255,255,0.08)', tick: 'rgba(255,255,255,0.4)',
        cross: 'rgba(255,255,255,0.22)', crossSoft: 'rgba(255,255,255,0.18)', price: '#f5f5f7', halo: '#0a0a0a' }
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null) // { idx, mouseX, mouseY } | null

  /* fit-to-container */
  useLayoutEffect(() => {
    const node = wrapRef.current
    if (!node) return undefined
    const apply = () => {
      const r = node.getBoundingClientRect()
      setWidth((prev) => (prev === Math.floor(r.width) ? prev : Math.floor(r.width)))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const PAD = { top: 14, right: 52, bottom: 22, left: 2 }
  const W = Math.max(0, width)
  const H = height
  const innerW = Math.max(1, W - PAD.left - PAD.right)
  const innerH = Math.max(1, H - PAD.top - PAD.bottom)

  /* Geometry — x evenly spaced by index. Each series is normalized
     independently and uses the full vertical band; both close to the
     same baseline so curves can intersect when their trends diverge. */
  const geom = useMemo(() => {
    if (!series.length || W === 0) return null
    const xAt = (i) => PAD.left + (series.length === 1 ? innerW / 2 : (innerW * i) / (series.length - 1))
    const baseY = PAD.top + innerH // bottom edge
    const yFromBase = (frac) => baseY - frac * innerH

    const engTop = series.map((s, i) => [xAt(i), yFromBase(s.engagement)])
    const mentTop = series.map((s, i) => [xAt(i), yFromBase(s.mentions)])

    const engPath = smoothPath(engTop, 0.35)
    const mentPath = smoothPath(mentTop, 0.35)

    // Both areas close independently to the baseline so each curve has
    // its own gradient sit and the two can cross.
    const engArea = `${engPath} L ${engTop[engTop.length - 1][0].toFixed(2)} ${baseY} L ${engTop[0][0].toFixed(2)} ${baseY} Z`
    const mentArea = `${mentPath} L ${mentTop[mentTop.length - 1][0].toFixed(2)} ${baseY} L ${mentTop[0][0].toFixed(2)} ${baseY} Z`

    /* Price overlay — only build geometry from the contiguous segment that
       has price data (CoinGecko 7d window may not cover older snapshots).
       Render as a clean white stroke without an area fill so it sits as an
       overlay on top of the two filled momentum bands. */
    const pricePts = series
      .map((s, i) => (s.price != null ? [xAt(i), yFromBase(s.price), i] : null))
      .filter(Boolean)
    const hasPrice = pricePts.length >= 2
    const pricePath = hasPrice ? smoothPath(pricePts.map(([x, y]) => [x, y]), 0.35) : ''
    const lastPriceEntry = hasPrice ? pricePts[pricePts.length - 1] : null

    const last = series[series.length - 1]
    const lastX = xAt(series.length - 1)
    const lastEngY = yFromBase(last.engagement)
    const lastMentY = yFromBase(last.mentions)

    return {
      engTop, mentTop, engPath, mentPath, engArea, mentArea,
      baseY, lastX, lastEngY, lastMentY, xAt,
      hasPrice, pricePath, lastPriceEntry,
    }
  }, [series, W, innerW, innerH])

  /* Tick labels (x axis) — pick ~5 evenly-spaced labels from the series */
  const ticks = useMemo(() => {
    if (!series.length) return []
    const n = series.length
    const count = Math.min(5, n)
    const step = (n - 1) / Math.max(1, count - 1)
    const out = []
    for (let i = 0; i < count; i += 1) {
      const idx = Math.round(i * step)
      out.push({ idx, label: series[idx].label })
    }
    return out
  }, [series])

  /* Horizontal grid lines — 3 dashed bands */
  const gridYs = useMemo(() => {
    if (W === 0) return []
    const baseY = PAD.top + innerH
    return [0.25, 0.5, 0.75, 1].map((f) => baseY - f * innerH)
  }, [W, innerH])

  const onMove = (e) => {
    if (!geom) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    if (mx < PAD.left || mx > W - PAD.right) { setHover(null); return }
    // nearest x by index
    const t = (mx - PAD.left) / Math.max(1, innerW)
    const idx = Math.max(0, Math.min(series.length - 1, Math.round(t * (series.length - 1))))
    setHover({ idx, mouseX: mx, mouseY: my })
  }
  const onLeave = () => setHover(null)

  if (!series.length || W === 0) {
    return <div ref={wrapRef} className="xd-mn" style={{ width: '100%', height: H }} />
  }
  const hoverPt = hover ? series[hover.idx] : null
  const hoverX = hover ? geom.xAt(hover.idx) : 0

  return (
    <div ref={wrapRef} className="xd-mn" style={{ position: 'relative', width: '100%', height: H }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ display: 'block', userSelect: 'none' }}
      >
        <defs>
          {/* Subtle independent area fills under each line — narrow band
              below the curve, fades fast so overlapping two areas stays
              clean rather than muddy. */}
          <linearGradient id="xdMnMentFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.28} />
            <stop offset="40%" stopColor="#F59E0B" stopOpacity={0.06} />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="xdMnEngFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.26} />
            <stop offset="40%" stopColor="#06B6D4" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
          </linearGradient>
          <filter id="xdMnGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* dashed grid */}
        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y}
            y2={y}
            stroke={ink.grid}
            strokeDasharray="2 6"
          />
        ))}

        {/* Engagement area + line (bottom layer) */}
        <path d={geom.engArea} fill="url(#xdMnEngFill)" />
        <path
          d={geom.engPath}
          fill="none"
          stroke="#06B6D4"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Mentions area + line (top layer) */}
        <path d={geom.mentArea} fill="url(#xdMnMentFill)" />
        <path
          d={geom.mentPath}
          fill="none"
          stroke="#F59E0B"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Price overlay — no fill, sits on top of the two momentum bands */}
        {geom.hasPrice && (
          <path
            d={geom.pricePath}
            fill="none"
            stroke={ink.price}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="0"
            opacity={0.9}
          />
        )}

        {/* Bottom axis baseline */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={geom.baseY}
          y2={geom.baseY}
          stroke={ink.base}
        />

        {/* X tick labels */}
        {ticks.map((t) => (
          <text
            key={t.idx}
            x={geom.xAt(t.idx)}
            y={H - 6}
            fill={ink.tick}
            fontSize={10}
            fontFamily="var(--font-body)"
            textAnchor={t.idx === 0 ? 'start' : t.idx === series.length - 1 ? 'end' : 'middle'}
          >
            {t.label}
          </text>
        ))}

        {/* Hover crosshair (dashed) */}
        {hoverPt && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={PAD.top}
            y2={geom.baseY}
            stroke={ink.cross}
            strokeDasharray="3 3"
          />
        )}

        {/* "Now" dashed vertical hairline at the rightmost point */}
        <line
          x1={geom.lastX}
          x2={geom.lastX}
          y1={PAD.top}
          y2={geom.baseY}
          stroke={ink.crossSoft}
          strokeDasharray="2 4"
        />

        {/* End-cap dots with halo */}
        <circle
          cx={geom.lastX}
          cy={geom.lastEngY}
          r={9}
          fill="#06B6D4"
          opacity={0.18}
          filter="url(#xdMnGlow)"
        />
        <circle
          cx={geom.lastX}
          cy={geom.lastEngY}
          r={4.5}
          fill="#06B6D4"
          stroke={ink.halo}
          strokeWidth={2}
        />
        <circle
          cx={geom.lastX}
          cy={geom.lastMentY}
          r={9}
          fill="#F59E0B"
          opacity={0.18}
          filter="url(#xdMnGlow)"
        />
        <circle
          cx={geom.lastX}
          cy={geom.lastMentY}
          r={4.5}
          fill="#F59E0B"
          stroke={ink.halo}
          strokeWidth={2}
        />
        {geom.hasPrice && (
          <>
            <circle
              cx={geom.lastPriceEntry[0]}
              cy={geom.lastPriceEntry[1]}
              r={9}
              fill={ink.price}
              opacity={0.16}
              filter="url(#xdMnGlow)"
            />
            <circle
              cx={geom.lastPriceEntry[0]}
              cy={geom.lastPriceEntry[1]}
              r={4}
              fill={ink.price}
              stroke={ink.halo}
              strokeWidth={2}
            />
          </>
        )}

        {/* Right-edge value badges */}
        <text
          x={geom.lastX + 10}
          y={geom.lastEngY + 4}
          fill="#06B6D4"
          fontSize={11}
          fontWeight={700}
          fontFamily="var(--font-body)"
        >
          {formatNum(series[series.length - 1].engagementRaw, { maxFraction: 0 })}
        </text>
        <text
          x={geom.lastX + 10}
          y={geom.lastMentY + 4}
          fill="#F59E0B"
          fontSize={11}
          fontWeight={700}
          fontFamily="var(--font-body)"
        >
          {formatNum(series[series.length - 1].mentionsRaw)}
        </text>
        {geom.hasPrice && (
          <text
            x={geom.lastPriceEntry[0] + 10}
            y={geom.lastPriceEntry[1] + 4}
            fill={ink.price}
            fontSize={11}
            fontWeight={700}
            fontFamily="var(--font-body)"
          >
            ${formatNum(series[geom.lastPriceEntry[2]].priceRaw)}
          </text>
        )}

        {/* Hover focus dots — each series at its own y position (no stack). */}
        {hoverPt && (
          <>
            <circle
              cx={hoverX}
              cy={PAD.top + innerH - hoverPt.engagement * innerH}
              r={3.5}
              fill="#06B6D4"
              stroke={ink.halo}
              strokeWidth={1.5}
            />
            <circle
              cx={hoverX}
              cy={PAD.top + innerH - hoverPt.mentions * innerH}
              r={3.5}
              fill="#F59E0B"
              stroke={ink.halo}
              strokeWidth={1.5}
            />
            {hoverPt.price != null && (
              <circle
                cx={hoverX}
                cy={PAD.top + innerH - hoverPt.price * innerH}
                r={3.5}
                fill={ink.price}
                stroke={ink.halo}
                strokeWidth={1.5}
              />
            )}
          </>
        )}
      </svg>

      {/* Floating tooltip card */}
      {hoverPt && (
        <div
          className="xd-mn__tip"
          style={{
            position: 'absolute',
            left: Math.min(W - 160, Math.max(8, hoverX + 12)),
            top: 8,
            pointerEvents: 'none',
          }}
        >
          <div className="xd-mn__tip-title">{hoverPt.label}</div>
          {hoverPt.priceRaw != null && (
            <div className="xd-mn__tip-row">
              <span className="xd-mn__tip-dot" style={{ background: '#f5f5f7' }} />
              <span className="xd-mn__tip-label">{t('xDash.charts.tip.price', 'Price')}</span>
              <span className="xd-mn__tip-value">${formatNum(hoverPt.priceRaw)}</span>
            </div>
          )}
          <div className="xd-mn__tip-row">
            <span className="xd-mn__tip-dot" style={{ background: '#F59E0B' }} />
            <span className="xd-mn__tip-label">{t('xDash.charts.tip.mentions', 'Mentions')}</span>
            <span className="xd-mn__tip-value">{formatNum(hoverPt.mentionsRaw)}</span>
          </div>
          <div className="xd-mn__tip-row">
            <span className="xd-mn__tip-dot" style={{ background: '#06B6D4' }} />
            <span className="xd-mn__tip-label">{t('xDash.charts.tip.engagement', 'Engagement')}</span>
            <span className="xd-mn__tip-value">{formatNum(hoverPt.engagementRaw, { maxFraction: 0 })}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   3. SOCIAL-HEALTH RADAR - 5 axes, 0-1
   ============================================================ */
function RadarTip({ active, payload }) {
  const { t } = useTranslation()
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell
      title={d.axis}
      rows={[{ label: t('xDash.charts.tip.score', 'Score'), value: formatPercent(d.value) }]}
    />
  )
}

/* latest: the intel.latest snapshot object */
export function XDHealthRadar({ latest, loading, height = 220 }) {
  const { t } = useTranslation()
  const C = useChartPalette()
  const data = useMemo(() => {
    if (!latest) return []
    const aq = latest.attention_quality || {}
    const breadth = latest.breadth || {}
    const durability = latest.durability || {}
    const momentum = latest.momentum || {}
    const crowding = latest.crowding || {}
    const clamp01 = (n) => Math.max(0, Math.min(1, Number(n || 0)))
    return [
      { axis: t('xDash.tokenDrawer.axis.cleanSignal', 'Clean Signal'), value: clamp01(aq.clean_signal_score_24h) },
      { axis: t('xDash.tokenDrawer.axis.breadth', 'Breadth'), value: clamp01(breadth.unique_author_share_24h) },
      { axis: t('xDash.tokenDrawer.axis.durability', 'Durability'), value: clamp01(durability.score_24h) },
      { axis: t('xDash.tokenDrawer.axis.momentum', 'Momentum'), value: clamp01(momentum.velocity_ratio) },
      { axis: t('xDash.tokenDrawer.axis.antiCrowding', 'Anti-Crowding'), value: clamp01(1 - Number(crowding.score_24h || 0)) },
    ]
  }, [latest, t])

  const empty = !loading && (data.length === 0 || data.every((d) => d.value === 0))

  return (
    <XDChartFrame loading={loading} empty={empty} emptyLabel={t('xDash.charts.empty.noIntel', 'No intelligence snapshot')} height={height}>
      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <RadarChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
          <PolarGrid stroke={C.grid} />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9, fill: C.axis }} />
          <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
          <Tooltip content={<RadarTip />} />
          <Radar
            dataKey="value"
            stroke={C.cyan}
            strokeWidth={1.5}
            fill={C.cyan}
            fillOpacity={0.14}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </XDChartFrame>
  )
}

/* ============================================================
   4. QUALITY SHARES - horizontal stacked bar (match structure)
   both_match / cashtag_only / handle_only, each a 0-1 share.
   Lightweight CSS stacked bar - no Recharts overhead for 3 segments.
   ============================================================ */
const QUALITY_SEGMENT_KEYS = [
  { key: 'both', i18nKey: 'xDash.charts.qualitySeg.both', fallback: 'Both match', color: C.bull },
  { key: 'cashtag', i18nKey: 'xDash.charts.qualitySeg.cashtag', fallback: 'Cashtag only', color: C.cyan },
  { key: 'handle', i18nKey: 'xDash.charts.qualitySeg.handle', fallback: 'Handle only', color: C.amber },
]

export function XDQualityShares({ quality, loading }) {
  const { t } = useTranslation()
  const C = useChartPalette()
  const QUALITY_SEGMENTS = useMemo(
    () => QUALITY_SEGMENT_KEYS.map((s) => ({ ...s, label: t(s.i18nKey, s.fallback) })),
    [t],
  )
  const segs = useMemo(() => {
    if (!quality) return null
    const both = Number(quality.both_match_share_24h || 0)
    const cashtag = Number(quality.cashtag_only_share_24h || 0)
    const handle = Number(quality.handle_only_share_24h || 0)
    const total = both + cashtag + handle
    if (total <= 0) return null
    return { both, cashtag, handle, total }
  }, [quality])

  if (loading) {
    return <div className="xd-chart-shimmer animate-shimmer" style={{ height: 56 }} aria-hidden="true" />
  }
  if (!segs) {
    return (
      <div className="xd-chart-empty" style={{ height: 56 }}>
        <span className="xd-chart-empty__label">{t('xDash.charts.empty.noMatchStructure', 'No match-structure data')}</span>
      </div>
    )
  }

  return (
    <div className="xd-qshares">
      <div className="xd-qshares__bar">
        {QUALITY_SEGMENTS.map((s) => {
          const pct = (segs[s.key] / segs.total) * 100
          if (pct <= 0) return null
          return (
            <span
              key={s.key}
              className="xd-qshares__seg"
              style={{ width: `${pct}%`, background: s.color }}
              title={`${s.label} ${pct.toFixed(0)}%`}
            />
          )
        })}
      </div>
      <div className="xd-qshares__legend">
        {QUALITY_SEGMENTS.map((s) => (
          <span className="xd-qshares__legend-item" key={s.key}>
            <span className="xd-qshares__swatch" style={{ background: s.color }} />
            <span className="xd-qshares__legend-label">{s.label}</span>
            <span className="xd-qshares__legend-value xd-num">
              {formatPercent(segs[s.key] / segs.total)}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   5. CATEGORY SCORE RANKING - horizontal bar
   ============================================================ */
function CategoryBarTip({ active, payload }) {
  const { t } = useTranslation()
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell
      title={d.label}
      rows={[
        { label: t('xDash.charts.tip.scoreSum', 'Score sum'), value: formatNum(d.score, { maxFraction: 0 }) },
        { label: t('xDash.charts.tip.tokens', 'Tokens'), value: formatNum(d.tokenCount) },
      ]}
    />
  )
}

/* items: category objects with label/score_sum/token_count/id. Renders top-N. */
export function XDCategoryRanking({ items = [], loading, topN = 20, onSelect }) {
  const { t } = useTranslation()
  const C = useChartPalette()
  const TICK = { fontSize: 10, fill: C.axis, fontFamily: 'var(--font-body)' }
  const data = useMemo(() => {
    return (Array.isArray(items) ? items : [])
      .map((it) => ({
        id: it.id || it.category,
        label: it.label || it.category || '-',
        score: Number(it.score_sum || 0),
        tokenCount: Number(it.token_count || 0),
        raw: it,
      }))
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
  }, [items, topN])

  const empty = !loading && data.length === 0
  // height scales with bar count so labels stay legible
  const height = Math.max(140, data.length * 22 + 24)

  return (
    <XDChartFrame loading={loading} empty={empty} emptyLabel={t('xDash.charts.empty.noCategories', 'No categories to rank')} height={empty || loading ? 160 : height}>
      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          barCategoryGap={4}
        >
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={TICK} tickLine={false} axisLine={{ stroke: C.grid }} tickFormatter={(v) => formatNum(v)} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 10, fill: C.axis }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            width={120}
          />
          <Tooltip content={<CategoryBarTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar
            dataKey="score"
            fill={C.neutral}
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
            onClick={(p) => p && p.raw && onSelect && onSelect(p.raw)}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          />
        </BarChart>
      </ResponsiveContainer>
    </XDChartFrame>
  )
}

/* ============================================================
   6. NARRATIVE SHARE COMPARISON - paired bars (mention vs token share)
   ============================================================ */
function NarrativeShareTip({ active, payload }) {
  const { t } = useTranslation()
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell
      title={d.label}
      rows={[
        { label: t('xDash.charts.tip.mentionShare', 'Mention share'), value: formatPercent(d.mentionShare) },
        { label: t('xDash.charts.tip.tokenShare', 'Token share'), value: formatPercent(d.tokenShare) },
        {
          label: t('xDash.charts.tip.punchRatio', 'Punch ratio'),
          value: d.tokenShare > 0 ? `${(d.mentionShare / d.tokenShare).toFixed(2)}x` : '-',
          tone: d.mentionShare > d.tokenShare ? 'bull' : undefined,
        },
      ]}
    />
  )
}

/* items: narrative objects with label/mention_share/token_share */
export function XDNarrativeShares({ items = [], loading }) {
  const { t } = useTranslation()
  const C = useChartPalette()
  const TICK = { fontSize: 10, fill: C.axis, fontFamily: 'var(--font-body)' }
  const data = useMemo(() => {
    // Keep the incoming items order so the chart rows line up 1:1 with the
    // narrative cards below (both follow the active SORT BY control). Do NOT
    // re-sort by mentionShare here or the bars and cards diverge.
    return (Array.isArray(items) ? items : [])
      .map((it) => ({
        label: it.label || '-',
        mentionShare: Number(it.mention_share || 0),
        tokenShare: Number(it.token_share || 0),
      }))
      .filter((d) => d.mentionShare > 0 || d.tokenShare > 0)
  }, [items])

  const empty = !loading && data.length === 0
  const height = Math.max(120, data.length * 34 + 28)

  return (
    <XDChartFrame loading={loading} empty={empty} emptyLabel={t('xDash.charts.empty.noNarrativeShare', 'No narrative share data')} height={empty || loading ? 140 : height}>
      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          barGap={2}
          barCategoryGap={10}
        >
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 10, fill: C.axis }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            width={110}
          />
          <Tooltip content={<NarrativeShareTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="mentionShare" fill={C.cyan} radius={[0, 2, 2, 0]} isAnimationActive={false} barSize={9} />
          <Bar dataKey="tokenShare" fill={C.neutral} radius={[0, 2, 2, 0]} isAnimationActive={false} barSize={9} />
        </BarChart>
      </ResponsiveContainer>
      <div className="xd-chart-legend">
        <span className="xd-chart-legend__item">
          <span className="xd-chart-legend__swatch" style={{ background: C.cyan }} /> {t('xDash.charts.legend.mentionShare', 'mention share')}
        </span>
        <span className="xd-chart-legend__item">
          <span className="xd-chart-legend__swatch" style={{ background: C.neutral }} /> {t('xDash.charts.legend.tokenShare', 'token share')}
        </span>
      </div>
    </XDChartFrame>
  )
}

/* ============================================================
   7. ROTATIONS FLOW - custom inline-SVG sankey-style diagram
   left col = distinct from_domain, right col = distinct to_domain,
   curved edges with stroke-width scaled by transition_count.
   ============================================================ */
const FLOW_W = 520
const FLOW_PAD_Y = 18
const FLOW_NODE_H = 26
const FLOW_NODE_GAP = 12

function buildFlowModel(rows) {
  const fromKeys = []
  const toKeys = []
  const fromMap = new Map()
  const toMap = new Map()

  for (const r of rows) {
    const fk = r.from_domain?.key || r.from_domain?.label || 'unknown-from'
    const tk = r.to_domain?.key || r.to_domain?.label || 'unknown-to'
    if (!fromMap.has(fk)) {
      fromMap.set(fk, { key: fk, label: r.from_domain?.label || r.from_domain?.key || '-' })
      fromKeys.push(fk)
    }
    if (!toMap.has(tk)) {
      toMap.set(tk, { key: tk, label: r.to_domain?.label || r.to_domain?.key || '-' })
      toKeys.push(tk)
    }
  }

  const colHeight = (n) => n * FLOW_NODE_H + (n - 1) * FLOW_NODE_GAP
  const leftH = colHeight(fromKeys.length)
  const rightH = colHeight(toKeys.length)
  const svgH = Math.max(leftH, rightH) + FLOW_PAD_Y * 2

  const placeCol = (keys, colH) => {
    const startY = FLOW_PAD_Y + (svgH - FLOW_PAD_Y * 2 - colH) / 2
    const map = new Map()
    keys.forEach((k, i) => {
      map.set(k, startY + i * (FLOW_NODE_H + FLOW_NODE_GAP))
    })
    return map
  }

  const leftY = placeCol(fromKeys, leftH)
  const rightY = placeCol(toKeys, rightH)

  const maxCount = Math.max(1, ...rows.map((r) => Number(r.transition_count || 0)))
  const edges = rows.map((r) => {
    const fk = r.from_domain?.key || r.from_domain?.label || 'unknown-from'
    const tk = r.to_domain?.key || r.to_domain?.label || 'unknown-to'
    const count = Number(r.transition_count || 0)
    return {
      fk, tk, count,
      y1: (leftY.get(fk) || 0) + FLOW_NODE_H / 2,
      y2: (rightY.get(tk) || 0) + FLOW_NODE_H / 2,
      width: 1.5 + (count / maxCount) * 6,
    }
  })

  return {
    svgH,
    fromNodes: fromKeys.map((k) => ({ ...fromMap.get(k), y: leftY.get(k) })),
    toNodes: toKeys.map((k) => ({ ...toMap.get(k), y: rightY.get(k) })),
    edges,
  }
}

export function XDRotationsFlow({ rows = [], loading }) {
  const { t } = useTranslation()
  const C = useChartPalette()
  const model = useMemo(() => {
    const list = Array.isArray(rows) ? rows.filter((r) => r && (r.from_domain || r.to_domain)) : []
    if (!list.length) return null
    return buildFlowModel(list)
  }, [rows])

  if (loading) {
    return <div className="xd-chart-shimmer animate-shimmer" style={{ height: 180 }} aria-hidden="true" />
  }
  if (!model) {
    return (
      <div className="xd-chart-empty" style={{ height: 120 }}>
        <span className="xd-chart-empty__label">{t('xDash.charts.empty.noRotations', 'No rotations to map')}</span>
      </div>
    )
  }

  const nodeX1 = 8
  const nodeW = 132
  const nodeX2 = FLOW_W - nodeW - 8
  const edgeStartX = nodeX1 + nodeW
  const edgeEndX = nodeX2

  return (
    <div className="xd-flowdiagram">
      <svg
        viewBox={`0 0 ${FLOW_W} ${model.svgH}`}
        width="100%"
        height={model.svgH}
        role="img"
        aria-label={t('xDash.charts.aria.rotationFlow', 'Domain rotation flow')}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* edges first so nodes sit on top */}
        {model.edges.map((e, i) => {
          const midX = (edgeStartX + edgeEndX) / 2
          const d = `M ${edgeStartX} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${edgeEndX} ${e.y2}`
          return (
            <path
              key={`${e.fk}-${e.tk}-${i}`}
              d={d}
              fill="none"
              stroke="var(--xd-flow-edge, rgba(6,182,212,0.45))"
              strokeWidth={e.width}
              strokeLinecap="round"
            />
          )
        })}
        {/* from nodes */}
        {model.fromNodes.map((n) => (
          <g key={`from-${n.key}`}>
            <rect
              x={nodeX1} y={n.y} width={nodeW} height={FLOW_NODE_H} rx={4}
              className="xd-flownode xd-flownode--from"
            />
            <text
              x={nodeX1 + nodeW / 2} y={n.y + FLOW_NODE_H / 2}
              className="xd-flownode__text" textAnchor="middle" dominantBaseline="central"
            >
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
            </text>
          </g>
        ))}
        {/* to nodes */}
        {model.toNodes.map((n) => (
          <g key={`to-${n.key}`}>
            <rect
              x={nodeX2} y={n.y} width={nodeW} height={FLOW_NODE_H} rx={4}
              className="xd-flownode xd-flownode--to"
            />
            <text
              x={nodeX2 + nodeW / 2} y={n.y + FLOW_NODE_H / 2}
              className="xd-flownode__text" textAnchor="middle" dominantBaseline="central"
            >
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="xd-flowdiagram__axis">
        <span>{t('xDash.charts.axis.fromDomain', 'From domain')}</span>
        <span>{t('xDash.charts.axis.toDomain', 'To domain')}</span>
      </div>
    </div>
  )
}

/* ============================================================
   8. ATTENTION MAP - squarified CSS treemap
   Each cell = a token. AREA = share of total board mentions.
   FILL = Signal Score tier color. ~30-40 cells, the rest folded
   into one "others" cell. Click -> token drawer.

   Why CSS not Recharts <Treemap>: we need exact control of the
   fill (tier color), the label (cashtag + share%), day-mode and
   crisp dark borders. Recharts' Treemap fights all three. The
   squarify algorithm below is the standard one - it keeps cells
   close to square so labels stay readable and nothing janks
   (pure layout math, no animation).
   ============================================================ */

/* squarified treemap layout via d3-hierarchy. Wraps the d3 API in the
   same shape the rest of XDAttentionTreemap expects: returns each input
   item augmented with { x, y, w, h } in pixels.

   Why ratio 1.4 (not the d3 default phi ~1.618): mirrors the home page
   MindshareAttentionTreemap so both surfaces produce visually identical
   cell aspect ratios. */
function squarify(values, rect) {
  if (!Array.isArray(values) || values.length === 0) return []
  const w = Math.max(1, rect.w)
  const h = Math.max(1, rect.h)
  const total = values.reduce((s, v) => s + (Number(v.value) || 0), 0)
  if (total <= 0) return []

  const root = hierarchy({ children: values })
    .sum((d) => (d.children ? 0 : Number(d.value) || 0))
    .sort((a, b) => (b.value || 0) - (a.value || 0))

  d3treemap()
    .size([w, h])
    .tile(treemapSquarify.ratio(1.4))
    .paddingInner(0)
    .round(true)(root)

  /* Each non-root leaf carries (x0,y0,x1,y1). Translate them back to the
     {x,y,w,h} shape used by the renderer below. We also re-attach the
     original input record so consumers can read cashtag/image/etc.
     d3 preserves input order on .leaves() when sort returns equal,
     but we already sorted by value so leaves come back in that order. */
  return root.leaves().map((leaf) => ({
    ...leaf.data,
    x: leaf.x0,
    y: leaf.y0,
    w: Math.max(0, leaf.x1 - leaf.x0),
    h: Math.max(0, leaf.y1 - leaf.y0),
  }))
}

/* ===== Memoized cell renderer =====================================
   Mirrors the heatmaps TreemapCell pattern: tier classes (XL/L/M/S/XS)
   instead of per-render inline font-size styles. Only geometry +
   semantic CSS variables are passed inline; CSS handles the sizing per
   tier. memo() short-circuits re-renders when geometry hasn't changed
   (e.g. hover on a sibling).
   =================================================================== */
const XDTreemapCell = memo(function XDTreemapCell(props) {
  const {
    cgId, cashtag, name, symbol, image,
    x, y, w, h, share, mentions,
    rankPosition, rankDirection, rankChange,
    topAuthors, isOthers,
    onOpenToken,
  } = props

  /* Skip cells too tiny to read or even register as a target. Cheaper
     to bail here than ship the DOM. */
  if (w < 12 || h < 10) return null

  /* Tier from cell visible size. Layout already runs at zoomed dims, so
     w/h ARE the on-screen size. Tier-driven CSS handles all font/logo
     sizing - no per-render inline style allocation. */
  const tier =
    w >= 160 && h >= 110 ? 'xl' :
    w >= 96  && h >= 66  ? 'lg' :
    w >= 50  && h >= 42  ? 'md' :
    w >= 28  && h >= 18  ? 'sm' : 'xs'

  const direction = rankDirection
  const absDelta = Math.abs(Number(rankChange || 0))
  const intensity = Math.min(1, absDelta / 20)
  const isPositive = direction === 'up'
  const isNegative = direction === 'down'
  const sharePct = (share || 0) * 100

  /* Direction-driven heat. Computed once per render of this cell. */
  const tileBg = isOthers
    ? 'rgba(255, 255, 255, 0.025)'
    : isPositive
      ? `rgba(16, 185, 129, ${(0.12 + intensity * 0.30).toFixed(3)})`
      : isNegative
        ? `rgba(239, 68, 68, ${(0.12 + intensity * 0.30).toFixed(3)})`
        : 'rgba(255, 255, 255, 0.045)'
  const tileBorder = isOthers
    ? 'rgba(255, 255, 255, 0.05)'
    : isPositive
      ? `rgba(16, 185, 129, ${(0.18 + intensity * 0.25).toFixed(3)})`
      : isNegative
        ? `rgba(239, 68, 68, ${(0.18 + intensity * 0.25).toFixed(3)})`
        : 'rgba(255, 255, 255, 0.08)'

  const brandKey = (symbol || '').toUpperCase()
  const brandRgb = TOKEN_ROW_COLORS[brandKey]?.bg || '245, 245, 247'
  const rankBadgeTone = isPositive ? 'positive' : isNegative ? 'negative' : 'flat'

  return (
    <button
      type="button"
      className={`xd-treemap__cell xd-treemap__cell--${tier}${isOthers ? ' xd-treemap__cell--others' : ''}${isPositive ? ' is-positive' : ''}${isNegative ? ' is-negative' : ''}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${Math.max(0, w - 2)}px`,
        height: `${Math.max(0, h - 2)}px`,
        ['--tile-bg']: tileBg,
        ['--tile-border']: tileBorder,
        ['--tile-brand-rgb']: brandRgb,
      }}
      onClick={() => !isOthers && cgId && onOpenToken && onOpenToken(cgId)}
      title={isOthers
        ? `${cashtag} tokens - ${sharePct.toFixed(1)}% of attention`
        : `${cashtag} - ${sharePct.toFixed(1)}% attention${direction && direction !== 'flat' ? ` - rank ${direction} ${absDelta}` : ''}`}
      aria-label={isOthers ? `${cashtag} more tokens` : `${cashtag}, open detail`}
    >
      {/* XS tier shows nothing - just the colored block. Cell still
          clickable + tooltip on hover. */}
      {tier !== 'xs' && (
        <>
          <div className="xd-treemap__cell-top">
            {(tier === 'xl' || tier === 'lg') && (
              <div className="xd-treemap__cell-logo">
                {image ? (
                  <img src={image} alt="" loading="lazy" />
                ) : (
                  <span>{(symbol || cashtag || '?').replace(/^\$/, '').slice(0, 1)}</span>
                )}
              </div>
            )}
            <span className="xd-treemap__cell-symbol">{cashtag}</span>
          </div>
          {tier === 'xl' && name && (
            <div className="xd-treemap__cell-name">{name}</div>
          )}
          {(tier === 'xl' || tier === 'lg' || tier === 'md') && (
            <div className="xd-treemap__cell-bottom">
              <span className="xd-treemap__cell-share xd-num">{formatNum(mentions)}</span>
              {rankPosition != null && (
                <span className={`xd-treemap__cell-rank xd-treemap__cell-rank--${rankBadgeTone} xd-num`}>
                  #{rankPosition}
                  {direction && direction !== 'flat' && absDelta > 0 && (
                    <span className="xd-treemap__cell-rank-delta">
                      {isPositive ? '▲' : isNegative ? '▼' : ''}{absDelta}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
          {tier === 'xl' && topAuthors && topAuthors.length > 0 && (
            <div className="xd-treemap__cell-carriers">
              {topAuthors.slice(0, 3).map((author, i) => (
                <Avatar
                  key={author.author_rest_id || author.screen_name || i}
                  src={author.avatar_image_url}
                  alt={author.screen_name || author.name}
                  size={18}
                />
              ))}
            </div>
          )}
        </>
      )}
    </button>
  )
})

/* tokens: bootstrap rows (nested OR flat). maxCells caps visible cells;
   the long tail collapses into one muted "others" cell.
   `ranking` ('mentions'|'momentum'|'conviction') drives BOTH the heat
   metric (cell brightness) and the legend text - so the treemap stays
   meaningful when the command bar toggles between modes. */
export function XDAttentionTreemap({ tokens = [], loading, onOpenToken, maxCells = 0, height = 320, ranking = 'mentions', sizeMode = 'rank' }) {
  const { t } = useTranslation()
  const C = useChartPalette()
  const [box, setBox] = useState({ w: 0, h: height })
  /* Transform state drives the squarify INPUT dimensions, not a CSS scale.
     d3 recomputes the layout at (box.w * k, box.h * k) so cells stay crisp
     at any zoom level (no blurry scaled text). The zoom layer translates
     only. Same pattern as the Heatmaps page TreemapView. */
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const roRef = useRef(null)
  const outerRef = useRef(null)
  const zoomBehaviorRef = useRef(null)
  const rafRef = useRef(null)
  const pendingTransformRef = useRef(null)

  /* callback ref - fires the instant the REAL container mounts (and again
     null on unmount). The loading branch renders a shimmer with no ref, so
     a plain useLayoutEffect would run once while ref is null and never
     re-attach. The callback ref attaches the ResizeObserver exactly when
     the measurable element appears, regardless of the loading transition. */
  const measureRef = useCallback((el) => {
    outerRef.current = el
    if (roRef.current) {
      roRef.current.disconnect()
      roRef.current = null
    }
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight || height
      if (w > 0) setBox({ w, h })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
  }, [height])

  /* d3-zoom: scroll wheel zooms 1x-8x, drag pans. We capture the {x,y,k}
     transform into state on every event; the squarify below uses
     (box.w * k, box.h * k) as its input rect, so cell geometry rebuilds
     natively at the zoomed size. The wrapper translates only. */
  useLayoutEffect(() => {
    const outer = outerRef.current
    if (!outer || box.w <= 0 || box.h <= 0) return undefined
    const sel = select(outer)
    const z = d3zoom()
      .scaleExtent([1, 8])
      .translateExtent([[0, 0], [box.w, box.h]])
      .extent([[0, 0], [box.w, box.h]])
      .filter((event) => {
        if (event.type === 'dblclick') return false
        if (event.type === 'contextmenu') return false
        if (event.type === 'mousedown' && event.button !== 0) return false
        return !event.ctrlKey && !event.button
      })
      .on('zoom', (event) => {
        /* Coalesce wheel-burst events to one React render per paint frame.
           d3 still fires its event freely; we just batch the state write. */
        pendingTransformRef.current = event.transform
        if (rafRef.current != null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          const t = pendingTransformRef.current
          if (t) setTransform({ x: t.x, y: t.y, k: t.k })
        })
      })
    zoomBehaviorRef.current = z
    sel.call(z)
    sel.on('dblclick.zoom', null)

    /* Prevent the page from scrolling while the user is zooming the
       treemap (wheel events would bubble up otherwise). Ctrl/Cmd-wheel
       passes through so browser zoom still works. */
    const preventScroll = (e) => {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
    }
    outer.addEventListener('wheel', preventScroll, { passive: false })

    return () => {
      sel.on('.zoom', null)
      outer.removeEventListener('wheel', preventScroll)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      pendingTransformRef.current = null
      zoomBehaviorRef.current = null
    }
  }, [box.w, box.h])

  /* Reset zoom whenever the source data or container dims change, so a
     new token list or window resize doesn't leave the user stranded on a
     stale viewport. */
  useLayoutEffect(() => {
    const outer = outerRef.current
    const z = zoomBehaviorRef.current
    if (!outer || !z) return
    select(outer).call(z.transform, zoomIdentity)
    setTransform({ x: 0, y: 0, k: 1 })
  }, [tokens, box.w, box.h])

  const zoomBy = useCallback((factor) => {
    const outer = outerRef.current
    const z = zoomBehaviorRef.current
    if (!outer || !z) return
    select(outer).transition().duration(220).call(z.scaleBy, factor)
  }, [])
  const resetZoom = useCallback(() => {
    const outer = outerRef.current
    const z = zoomBehaviorRef.current
    if (!outer || !z) return
    select(outer).transition().duration(260).call(z.transform, zoomIdentity)
  }, [])

  /* DATA prep — runs only when tokens / maxCells change, NOT on zoom.
     Normalizing, sorting, and the "others" tail collapse are the same
     across all zoom levels; running them on every zoom frame was wasted
     work. We also pre-attach a `share` so the layout memo doesn't have
     to clone again. */
  const dataPrep = useMemo(() => {
    const raw = (Array.isArray(tokens) ? tokens : []).map((row) => {
      const t = row.token || row
      const m = row.metrics || row
      const q = row.quality || row
      const state = row.state || {}
      const scheduler = state.scheduler || row.scheduler || {}
      const mentions = Number(m.external_mentions_24h ?? m.mentions_24h ?? 0)
      const authors = Number(m.unique_external_authors_24h ?? row.unique_external_authors_24h ?? 0)
      const weighted = Number(m.external_weighted_engagement_24h ?? row.external_weighted_engagement_24h ?? 0)
      const velocity = Number(m.velocity_ratio ?? row.velocity_ratio ?? 0)
      const signal = Number(q.clean_signal_score_24h ?? m.clean_signal_score_24h ?? row.clean_signal_score_24h ?? 0)
      const sig = computeSignalScore(row)
      return {
        cgId: t.cg_id || t.token_id || row.cg_id || row.token_id,
        cashtag: t.cashtag || (t.symbol ? `$${t.symbol}` : t.name || '-'),
        name: t.name || row.name || '',
        symbol: t.symbol || row.symbol || '',
        image: t.image_small || t.image_url || row.image_small || row.image_url || row.image,
        mentions,
        authors,
        weighted,
        velocity,
        cleanSignal: signal,
        topAuthors: Array.isArray(row.top_authors) ? row.top_authors.slice(0, 3) : [],
        rankPosition: row.rank_position,
        rankDirection: row.rank_direction,
        rankChange: row.rank_change_positions,
        tierLabel: scheduler.tier || state.tier,
        score: sig.score,
        tier: sig.tier,
      }
    }).filter((c) => c.cgId && c.mentions > 0)

    if (raw.length === 0) return { visible: [], grandTotal: 0 }

    /* Cell AREA follows the ACTIVE ranking so the #1-ranked token is always the
       biggest cell — the map reads as the leaderboard the user actually sorted.
       Mentions keeps its true attention magnitude (a dominant name genuinely
       swallows the map); momentum/conviction size by rank position so a
       high-attention but lower-ranked name (e.g. $ANSEM under Momentum) no longer
       dwarfs the real #1 (e.g. $ZIG). Falls back to mentions if rank is absent. */
    const sizeInput = (c) => {
      if (sizeMode !== 'attention' && ranking && ranking !== 'mentions') {
        const rp = Number(c.rankPosition)
        if (Number.isFinite(rp) && rp > 0) return 1000 / rp
      }
      return Number(c.mentions) || 0
    }

    raw.sort((a, b) => sizeInput(b) - sizeInput(a))
    const grandTotal = raw.reduce((s, c) => s + c.mentions, 0)

    let visible = raw
    if (maxCells > 0 && raw.length > maxCells) {
      visible = raw.slice(0, maxCells - 1)
      const tail = raw.slice(maxCells - 1)
      const tailMentions = tail.reduce((s, c) => s + c.mentions, 0)
      if (tailMentions > 0) {
        visible.push({
          cgId: null,
          cashtag: `+${tail.length}`,
          name: 'Long tail',
          symbol: '', image: null,
          mentions: tailMentions,
          authors: tail.reduce((s, c) => s + Number(c.authors || 0), 0),
          weighted: tail.reduce((s, c) => s + Number(c.weighted || 0), 0),
          velocity: 0, cleanSignal: 0,
          topAuthors: [], rankPosition: null, rankDirection: null,
          rankChange: null, tierLabel: null, score: 0, tier: 'others',
          isOthers: true,
        })
      }
    }

    /* Pre-attach share + the `value` key squarify needs so the layout
       memo runs strictly geometry.

       Cell AREA encodes attention, but raw mentions are heavily skewed -
       a single viral token can hold 50%+ of all mentions and swallow the
       whole map, leaving everything else as unreadable slivers. We dampen
       area with a power curve so the leader still clearly reads as biggest
       while the mid-pack and long tail stay legible. sqrt (0.5) over-
       flattened it - a 55%-share leader shrank to ~15% of the map, which
       no longer looked like the leader. Power 0.75 keeps a visible
       hierarchy without the swallow. The cell shows the raw mention COUNT
       (size-consistent), and `share` keeps the TRUE % for the tooltip. */
    const areaWeight = (m) => Math.pow(Math.max(0, Number(m) || 0), 0.75)
    const withMeta = visible.map((c) => ({
      ...c,
      value: areaWeight(sizeInput(c)),
      share: grandTotal > 0 ? c.mentions / grandTotal : 0,
    }))
    return { visible: withMeta, grandTotal }
  }, [tokens, maxCells, ranking, sizeMode])

  /* LAYOUT memo — runs on zoom (depends on transform.k). Cheap: just the
     squarify call on the pre-built array. d3-hierarchy for <100 nodes
     is sub-millisecond. ranking is in deps because future ranking modes
     may re-sort, but currently visual color is direction-driven so the
     same layout works regardless. */
  const cells = useMemo(() => {
    if (dataPrep.visible.length === 0) return { items: [], layoutW: 0, layoutH: 0 }
    const layoutW = Math.max(1, Math.round((box.w || 1) * transform.k))
    const layoutH = Math.max(1, Math.round((box.h || 1) * transform.k))
    const placed = squarify(dataPrep.visible, { x: 0, y: 0, w: layoutW, h: layoutH })
    return { items: placed, layoutW, layoutH }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataPrep, box.w, box.h, transform.k, ranking])

  /* count tokens with real attention BEFORE layout - so we can tell a
     genuine empty window apart from "container not measured yet" (box.w=0).
     Only the genuine-empty case shows the empty message. */
  const hasTokens = useMemo(
    () => (Array.isArray(tokens) ? tokens : []).some(
      (row) => Number((row.metrics || row).external_mentions_24h ?? (row.metrics || row).mentions_24h ?? 0) > 0,
    ),
    [tokens],
  )

  if (loading) {
    return <div className="xd-treemap-shimmer animate-shimmer" style={{ height }} aria-hidden="true" />
  }
  if (!loading && !hasTokens) {
    return (
      <div className="xd-chart-empty" style={{ height }}>
        <span className="xd-chart-empty__label">{t('xDash.charts.empty.noAttention', 'No attention to map for this window')}</span>
      </div>
    )
  }

  const isZoomed = transform.k > 1.001 || transform.x !== 0 || transform.y !== 0
  const zoomLevel = transform.k

  return (
    <div className="xd-treemap" ref={measureRef} style={{ height }}>
      {/* Scroll-to-zoom hint when at 1x. Fades away after user zooms. */}
      {box.w > 0 && !isZoomed && (
        <div className="xd-treemap__hint" aria-hidden="true">
          {t('xDash.creatorsHeatmap.scrollHint', 'Scroll to zoom · Drag to pan')}
        </div>
      )}
      {/* Zoom HUD: − / level% / + / reset */}
      {box.w > 0 && (
        <div className="xd-treemap__hud" aria-label={t('xDash.creatorsHeatmap.zoomControls', 'Zoom controls')}>
          <button
            type="button"
            className="xd-treemap__hud-btn"
            onClick={() => zoomBy(1 / 1.5)}
            aria-label={t('xDash.creatorsHeatmap.zoomOut', 'Zoom out')}
            disabled={zoomLevel <= 1.001}
          >−</button>
          <button
            type="button"
            className="xd-treemap__hud-level"
            onClick={resetZoom}
            aria-label={t('xDash.creatorsHeatmap.resetZoom', 'Reset zoom')}
            title={t('xDash.creatorsHeatmap.clickToReset', 'Click to reset')}
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <button
            type="button"
            className="xd-treemap__hud-btn"
            onClick={() => zoomBy(1.5)}
            aria-label={t('xDash.creatorsHeatmap.zoomIn', 'Zoom in')}
            disabled={zoomLevel >= 7.99}
          >+</button>
        </div>
      )}
      <div
        className="xd-treemap__zoom"
        style={{
          width: cells.layoutW || box.w,
          height: cells.layoutH || box.h,
          transform: `translate(${transform.x}px, ${transform.y}px)`,
        }}
      >
      {box.w > 0 && cells.items.map((c) => (
        <XDTreemapCell
          key={c.cgId || `others-${c.cashtag}`}
          cgId={c.cgId}
          cashtag={c.cashtag}
          name={c.name}
          symbol={c.symbol}
          image={c.image}
          x={c.x}
          y={c.y}
          w={c.w}
          h={c.h}
          share={c.share}
          mentions={c.mentions}
          rankPosition={c.rankPosition}
          rankDirection={c.rankDirection}
          rankChange={c.rankChange}
          topAuthors={c.topAuthors}
          isOthers={c.isOthers}
          onOpenToken={onOpenToken}
        />
      ))}
      </div>
    </div>
  )
}
