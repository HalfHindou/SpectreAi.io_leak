/**
 * vt-spark.jsx — the inline trend on a leaderboard row.
 *
 * The first version rendered a 76-unit viewBox with preserveAspectRatio="none"
 * into a ~700px slot, so every stroke was smeared ~9x sideways: a 1.6px line
 * became a soft wedge, the gradient became a wash, and the row read as a blurry
 * wobble. Three things fix that:
 *
 *   1. It draws at its MEASURED width — the viewBox matches the box 1:1, so a
 *      1.25px stroke is 1.25px on screen.
 *   2. 90 daily readings instead of 30, so a wide box carries real texture
 *      rather than a handful of fat wobbles.
 *   3. Scaled to the series' own range, which is the sparkline convention: this
 *      column answers "which way is it going". Magnitude is the number sitting
 *      next to it, and a zero-based row turns every steady earner into an
 *      identical flat wall.
 */

import { useEffect, useRef, useState } from 'react'

export default function VtSpark({ points, tone = 'up', height = 30 }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // Measured synchronously first: a ResizeObserver's first delivery is tied to
    // the rendering steps, so in a hidden or automated tab it may never arrive
    // and the chart would sit at width 0 forever.
    const read = () => setW(Math.round(el.getBoundingClientRect().width))
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const vals = Array.isArray(points)
    ? points.map((p) => (Array.isArray(p) ? p[1] : p)).filter((v) => Number.isFinite(v))
    : []

  // A board row whose platform has no shadow fee history (a Hyperliquid-native
  // app with no public fee adapter) used to render an empty cell, which reads as
  // a sparkline that failed to draw rather than one that does not exist.
  if (vals.length < 3 || !w) {
    return (
      <span className="vt-row__spark" ref={ref}>
        {w ? <span className="vt-row__spark-none" aria-hidden="true" title="No daily history for this platform" /> : null}
      </span>
    )
  }

  const stroke = tone === 'down' ? 'var(--vt-bear)' : 'var(--vt-bull)'
  const h = height
  const pad = 3
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const x = (i) => (i * w) / (vals.length - 1)
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2)

  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  const gid = `vtsp-${tone}`

  return (
    <span className="vt-row__spark" ref={ref}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="vt-spark__svg">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.20" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
        {/* The live edge — without it the eye has no anchor for "where it ends". */}
        <circle cx={w - 1} cy={y(vals[vals.length - 1])} r="1.8" fill={stroke} />
      </svg>
    </span>
  )
}
