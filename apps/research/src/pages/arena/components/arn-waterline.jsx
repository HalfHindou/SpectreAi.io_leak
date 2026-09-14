/**
 * ArnWaterline — the page's one image.
 *
 * A single hairline is the starting balance. Every book gets one tick, drawn
 * from that line to its return since it started. Above the line is profit;
 * below it is not. No axis, no legend, no gridlines — the rule IS the axis, and
 * anything else here would be decoration on top of twelve facts.
 *
 * The scale is LINEAR on the largest absolute return in the roster, so the
 * deepest book sets the depth of the image and everything else is drawn in
 * true proportion to it. A compressed or log scale would make a −81% book look
 * survivable, which is exactly the flattery this page exists to refuse.
 */
import { useMemo } from 'react'

const W = 1000
const HALF = 44          // drawing space above and below the rule
const PAD_Y = 6
const MIN_TICK = 2       // a rendering floor so a ~0% book is still a mark

export default function ArnWaterline({ rows }) {
  const geom = useMemo(() => {
    const live = (rows || []).filter((r) => Number.isFinite(r.returnPct))
    if (!live.length) return null
    const ordered = [...live].sort((a, b) => b.returnPct - a.returnPct)
    const max = Math.max(...ordered.map((r) => Math.abs(r.returnPct)), 1)
    const step = W / (ordered.length + 1)
    return {
      max,
      ticks: ordered.map((r, i) => {
        const raw = (r.returnPct / max) * HALF
        const len = Math.sign(raw || 1) * Math.max(Math.abs(raw), MIN_TICK)
        return {
          key: r.name,
          x: step * (i + 1),
          y2: PAD_Y + HALF - len,
          up: r.returnPct > 0,
          retired: !r.active,
          label: `${r.name} ${r.returnPct > 0 ? '+' : r.returnPct < 0 ? '−' : ''}${Math.abs(r.returnPct).toFixed(1)}%`,
        }
      }),
      worst: ordered[ordered.length - 1],
      ruleY: PAD_Y + HALF,
      height: PAD_Y * 2 + HALF * 2,
    }
  }, [rows])

  if (!geom) return null

  return (
    <div className="arn-water">
      <svg
        className="arn-water__svg"
        viewBox={`0 0 ${W} ${geom.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Return since start for ${geom.ticks.length} books, plotted against their starting balance`}
      >
        <line className="arn-water__rule" x1="0" x2={W} y1={geom.ruleY} y2={geom.ruleY} />
        {geom.ticks.map((t) => (
          <g key={t.key}>
            <line
              className={`arn-water__tick${t.up ? ' is-up' : ' is-down'}${t.retired ? ' is-retired' : ''}`}
              x1={t.x.toFixed(1)}
              x2={t.x.toFixed(1)}
              y1={geom.ruleY}
              y2={t.y2.toFixed(1)}
            >
              <title>{t.label}</title>
            </line>
          </g>
        ))}
      </svg>
      <p className="arn-water__cap arn-meta">
        Each tick is one book&apos;s return since it started, ordered best to worst.
        {geom.worst && Number.isFinite(geom.worst.returnPct) ? (
          <> Deepest <span className="arn-num">−{Math.abs(geom.worst.returnPct).toFixed(1)}%</span>, {geom.worst.name}.</>
        ) : null}
      </p>
    </div>
  )
}
