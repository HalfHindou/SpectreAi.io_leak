/**
 * ArnSpark — 120×32 of a book's equity, and nothing else.
 *
 * HONESTY RULE, read before "improving" it: this draws the snapshots the engine
 * published and no others. It does not resample, smooth, or bridge a gap. When
 * the series is too short to be a line (under three snapshots) it falls back to
 * the only two points that are always true — the starting balance and the
 * current balance — and SAYS SO on the face of the shape. That is why every
 * spark carries its own point count: two sparks of the same width can be a
 * sixty-snapshot curve and a straight line between two facts, and the reader is
 * entitled to know which one they are looking at.
 *
 * SVG, not canvas, deliberately: a canvas stroke hardcodes its colour and goes
 * invisible in day mode. This path carries NO stroke attribute at all — it
 * inherits currentColor from --st-ink, so the theme and the row state drive it.
 */
import { useMemo } from 'react'

const W = 120
const H = 32
const PAD = 3

export default function ArnSpark({ points, starting, current, state = 'live', label }) {
  const geom = useMemo(() => {
    let pts = Array.isArray(points) ? points.filter(Number.isFinite) : []
    let measured = pts.length
    let fallback = false

    if (measured < 3) {
      // Not a series. The two balances are facts, not a curve — the label below
      // is what stops the shape being read as one.
      const a = Number.isFinite(starting) ? starting : null
      const b = Number.isFinite(current) ? current : null
      if (a == null || b == null) return null
      pts = [a, b]
      measured = 2
      fallback = true
    }

    let lo = Math.min(...pts)
    let hi = Math.max(...pts)
    if (hi === lo) { hi = lo + Math.abs(lo || 1) * 0.01; lo -= Math.abs(lo || 1) * 0.01 }

    const x = (i) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
    const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2)

    // The starting line is drawn only when it actually falls inside the window
    // on screen. Stretching the axis to reach it would flatten the curve into a
    // horizontal smear and tell the reader less, not more.
    const baseY = Number.isFinite(starting) && starting >= lo && starting <= hi ? y(starting) : null

    return {
      d: pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
      last: { x: x(pts.length - 1), y: y(pts[pts.length - 1]) },
      baseY,
      measured,
      fallback,
    }
  }, [points, starting, current])

  if (!geom) {
    return (
      <div className="arn-spark-wrap arn-spark--none" role="img" aria-label="No equity snapshots published">
        <span>no snapshots</span>
      </div>
    )
  }

  const note = label || (geom.fallback ? '2 measured' : `${geom.measured} pts`)

  return (
    <div className="arn-spark-wrap">
      <svg
        className="arn-spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Equity, ${geom.measured} measured ${geom.measured === 1 ? 'point' : 'points'}`}
      >
        {geom.baseY != null && (
          <line className="arn-spark__base" x1="0" x2={W} y1={geom.baseY.toFixed(1)} y2={geom.baseY.toFixed(1)} />
        )}
        <path
          className="arn-spark__path"
          d={geom.d}
          style={state === 'retired' ? { strokeDasharray: '3 3' } : undefined}
        />
        <circle className="arn-spark__pt" cx={geom.last.x.toFixed(1)} cy={geom.last.y.toFixed(1)} r="1.8" />
      </svg>
      {/* In HTML, not inside the svg: this viewBox is scaled with
          preserveAspectRatio="none", which stretches glyphs horizontally. */}
      <span className="arn-spark__n">{note}</span>
    </div>
  )
}
