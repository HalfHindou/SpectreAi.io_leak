/**
 * ValuationHistoryChart — native SVG line chart for private-market valuation history.
 *
 * Why native SVG instead of a charting library:
 *   - Funding rounds are 3-8 data points per company — charting libraries
 *     are over-engineered for this. Native SVG + one interpolation function
 *     gives a cleaner result with zero deps.
 *   - Matches the cinematic glass aesthetic from design-system.md; purpose-built
 *     library themes fight the design tokens.
 *   - Per page-patterns.md: page-specific components live in the page folder,
 *     so this is scoped to /private-markets and doesn't pollute src/components.
 *
 * Data contract (same shape the /api/private/valuation-history/:company endpoint
 * returns):
 *   {
 *     company: string,
 *     rounds: Array<{ date, roundType, amountUsd, valuationUsd, leadInvestor }>,
 *     totalRaised: number,
 *     latestValuation: number,
 *   }
 *
 * Visual design:
 *   - Log-scale Y axis by default (valuations span 100x-1000x ranges)
 *   - Area fill under the curve with a warm-white gradient
 *   - Dot markers on each round with color coded by stage
 *   - Hover state: highlight dot, show round label + amount + valuation
 *   - Empty state: ghost placeholder with "No valuation history yet"
 *   - Single-round state: renders one dot + round label (no line drawn)
 */
import { useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { formatAmount } from './private-markets-constants'

// The chart MEASURES its card instead of scaling a fixed viewBox to fit it.
// A 560-wide viewBox under `width:100%` on a ~1750px page rendered the whole
// drawing at 3.1x - a 687px-tall chart with 34px axis type, which is what "the
// chart is huge and cuts" was. Rendering at real pixels keeps every label at the
// size it was designed at, whatever the card is doing.
const MIN_WIDTH = 320
const FALLBACK_WIDTH = 720
const HEIGHT = 240
const PADDING = { top: 24, right: 24, bottom: 40, left: 56 }

export default function ValuationHistoryChart({ history, loading }) {
  const { t, i18n } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)
  const [hoveredIdx, setHoveredIdx] = useState(null)
  // A CALLBACK ref, not useRef+[] — this component early-returns a skeleton that
  // carries no ref, so a one-shot effect ran while the node did not exist yet and
  // never re-ran once it did. The chart then sized itself from the fallback for
  // the rest of its life. Same trap as charts-system.md I2.
  const [wrapEl, setWrapEl] = useState(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)

  useLayoutEffect(() => {
    const el = wrapEl
    if (!el) return undefined
    const read = () => {
      const box = el.clientWidth - 24 // the card's own horizontal padding
      if (box > 0) setWidth(Math.max(MIN_WIDTH, Math.round(box)))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [wrapEl])

  // Pre-compute layout so hover doesn't re-trigger expensive work
  const layout = useMemo(() => {
    if (!history?.rounds?.length) return null
    const rounds = [...history.rounds]
      .map((r) => ({
        ...r,
        ts: r.date ? Date.parse(r.date) : null,
        val: Number.isFinite(r.valuationUsd) ? r.valuationUsd : null,
      }))
      .filter((r) => r.ts)
      .sort((a, b) => a.ts - b.ts)

    if (rounds.length === 0) return null

    // Pad domain by 5% on both ends
    const tsMin = rounds[0].ts
    const tsMax = rounds[rounds.length - 1].ts
    const tsRange = Math.max(tsMax - tsMin, 1)
    const tsPad = tsRange * 0.05

    // Log-scale Y: rounds without valuation fall back to 1.5x the amount raised
    // (rough proxy for post-money; still positioned reasonably on the axis)
    const series = rounds.map((r) => ({
      ...r,
      yVal: r.val || (r.amountUsd ? r.amountUsd * 1.5 : null),
    }))
    const valsForAxis = series.map((r) => r.yVal).filter((v) => v != null)
    if (valsForAxis.length === 0) return null

    const yMin = Math.max(1e6, Math.min(...valsForAxis))
    const yMax = Math.max(...valsForAxis)
    // Use log scale — valuations commonly jump 10x-100x across rounds
    const logMin = Math.log10(yMin)
    const logMax = Math.log10(yMax * 1.15) // headroom
    const logRange = Math.max(logMax - logMin, 0.2)

    const innerW = width - PADDING.left - PADDING.right
    const innerH = HEIGHT - PADDING.top - PADDING.bottom

    const scaleX = (ts) => {
      const frac = (ts - (tsMin - tsPad)) / (tsRange + tsPad * 2 || 1)
      return PADDING.left + frac * innerW
    }
    const scaleY = (v) => {
      if (v == null) return PADDING.top + innerH // anchor at bottom when unknown
      const frac = (Math.log10(Math.max(v, 1)) - logMin) / logRange
      return PADDING.top + (1 - frac) * innerH
    }

    // Build the path from known-valuation points
    const points = series
      .filter((r) => r.yVal != null)
      .map((r) => ({ ...r, x: scaleX(r.ts), y: scaleY(r.yVal) }))

    // Smooth Catmull-Rom → SVG cubic bezier for a cinematic curve
    const path = pointsToSmoothPath(points)
    // Area fill — same path, closed to bottom
    const area =
      points.length > 1
        ? `${path} L ${points[points.length - 1].x} ${HEIGHT - PADDING.bottom} L ${points[0].x} ${HEIGHT - PADDING.bottom} Z`
        : null

    // Axis ticks — 4 log-spaced Y ticks
    const yTicks = buildLogTicks(logMin, logMax, 4).map((v) => ({
      v,
      y: scaleY(v),
      label: fmtMoney(v),
    }))
    // X ticks — first, middle, last round years
    const xTicks = (() => {
      if (points.length === 0) return []
      const first = points[0]
      const last = points[points.length - 1]
      const mid = points[Math.floor(points.length / 2)]
      const ticks = [first]
      if (mid !== first && mid !== last) ticks.push(mid)
      if (last !== first) ticks.push(last)
      return ticks.map((p) => ({
        x: p.x,
        label: new Date(p.ts).getFullYear(),
      }))
    })()

    // All markers (including valuation-less rounds, for annotation dots)
    const markers = series.map((r) => ({
      ...r,
      x: scaleX(r.ts),
      y: scaleY(r.yVal),
      // Monochrome warm-white markers — chart chrome carries no hue (design-system.md).
      color: 'rgba(245, 245, 247, 0.9)',
    }))

    return { rounds: series, points, path, area, yTicks, xTicks, markers }
  }, [history, fmtLargeShort, width])  // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="pm-chart pm-chart-loading">
        <div className="pm-chart-skel animate-shimmer" />
      </div>
    )
  }

  if (!layout) {
    return (
      <div className="pm-chart pm-chart-empty">
        <div className="caption pm-chart-empty-hint">
          {t('privateMarkets.profile.chart.empty')}
        </div>
      </div>
    )
  }

  const hovered = hoveredIdx != null ? layout.markers[hoveredIdx] : null

  return (
    <div className="pm-chart" ref={setWrapEl}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="pm-chart-svg"
        role="img"
        aria-label={t('privateMarkets.profile.chart.ariaLabel', { company: history.company })}
      >
        <defs>
          <linearGradient id="pmChartArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(245, 245, 247, 0.22)" />
            <stop offset="60%" stopColor="rgba(245, 245, 247, 0.04)" />
            <stop offset="100%" stopColor="rgba(245, 245, 247, 0)" />
          </linearGradient>
          <linearGradient id="pmChartStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(245, 245, 247, 0.55)" />
            <stop offset="100%" stopColor="rgba(245, 245, 247, 0.95)" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines + labels */}
        {layout.yTicks.map((t, i) => (
          <g key={`ytick-${i}`}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={t.y}
              y2={t.y}
              stroke="rgba(255, 255, 255, 0.04)"
              strokeDasharray="2 4"
            />
            <text
              x={PADDING.left - 8}
              y={t.y + 3}
              textAnchor="end"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fill="rgba(245, 245, 247, 0.35)"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {layout.xTicks.map((t, i) => (
          <text
            key={`xtick-${i}`}
            x={t.x}
            y={HEIGHT - PADDING.bottom + 18}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="rgba(245, 245, 247, 0.35)"
          >
            {t.label}
          </text>
        ))}

        {/* Area fill */}
        {layout.area && <path d={layout.area} fill="url(#pmChartArea)" />}

        {/* Line */}
        {layout.path && (
          <path
            d={layout.path}
            fill="none"
            stroke="url(#pmChartStroke)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Round markers */}
        {layout.markers.map((m, i) => {
          const active = hoveredIdx === i
          return (
            <g
              key={`marker-${i}`}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Invisible hover target */}
              <circle cx={m.x} cy={m.y} r="14" fill="transparent" />
              {/* Glow ring when active */}
              {active && (
                <circle
                  cx={m.x}
                  cy={m.y}
                  r="8"
                  fill="none"
                  stroke={m.color}
                  strokeWidth="1"
                  opacity="0.35"
                />
              )}
              {/* Core dot */}
              <circle
                cx={m.x}
                cy={m.y}
                r={active ? 4 : 3}
                fill="var(--bg-void)"
                stroke={m.color}
                strokeWidth="1.6"
              />
            </g>
          )
        })}

        {/* Round labels above dots — truncate if many rounds */}
        {layout.markers.length <= 6 &&
          layout.markers.map((m, i) => (
            <text
              key={`label-${i}`}
              x={m.x}
              y={m.y - 10}
              textAnchor="middle"
              fontSize="9"
              fontFamily="var(--font-mono)"
              fill="rgba(245, 245, 247, 0.55)"
              fontWeight="600"
            >
              {m.roundType || ''}
            </text>
          ))}
      </svg>

      {/* Hover tooltip */}
      {hovered && (
        <div
          className="pm-chart-tooltip"
          style={{
            left: `${(hovered.x / width) * 100}%`,
            transform: `translate(-50%, -100%) translateY(-10px)`,
          }}
        >
          <div className="pm-chart-tooltip-date caption">
            {new Date(hovered.ts).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' })}
          </div>
          <div className="pm-chart-tooltip-round">{hovered.roundType || t('privateMarkets.profile.chart.roundLabel')}</div>
          <div className="pm-chart-tooltip-amount mono">
            {fmtMoney(hovered.amountUsd)}
            {hovered.valuationUsd && (
              <span className="pm-chart-tooltip-val"> @ {fmtMoney(hovered.valuationUsd)}</span>
            )}
          </div>
          {hovered.leadInvestor && (
            <div className="pm-chart-tooltip-lead caption">{t('privateMarkets.profile.chart.ledBy')} {hovered.leadInvestor}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Catmull-Rom → Cubic Bezier. Produces a smooth, apple-style curve through all
// points without overshoot.
function pointsToSmoothPath(pts) {
  if (!pts || pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`

  const parts = [`M ${pts[0].x} ${pts[0].y}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    // Catmull-Rom to Bezier conversion (tension = 0.5)
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    parts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`)
  }
  return parts.join(' ')
}

// Generate N log-spaced tick values between two log10 bounds.
function buildLogTicks(logMin, logMax, count) {
  const out = []
  const step = (logMax - logMin) / (count - 1)
  for (let i = 0; i < count; i++) {
    out.push(Math.pow(10, logMin + step * i))
  }
  return out
}
