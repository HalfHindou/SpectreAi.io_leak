/**
 * ArnCurve — one book's equity over the window the engine kept.
 *
 * The viewBox is measured in real pixels (ResizeObserver, seeded from a live
 * getBoundingClientRect so a hidden tab still gets a size) rather than a fixed
 * 1000-unit space stretched to fit. That keeps one user unit equal to one CSS
 * pixel, which means the stroke is not distorted, the dash animation is
 * predictable, and a pointer maps to a snapshot with no correction factor.
 *
 * Every label lives in HTML on top of the plot, not in SVG <text>. The axis
 * states the WINDOW — this endpoint keeps a rolling five hundred snapshots, so
 * a curve is a recent window and not a lifetime, and the caption says which.
 *
 * The path draws once, via stroke-dashoffset. One animating path per viewport,
 * exactly as the motion grammar allows.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmtMoney, fmtStamp } from './arn-format'

const H = 340
const M = { top: 22, right: 92, bottom: 26, left: 16 }

export default function ArnCurve({ series, starting, label }) {
  const wrapRef = useRef(null)
  const pathRef = useRef(null)
  const [w, setW] = useState(0)
  const [cursor, setCursor] = useState(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    // Seed from the live rect: an RO's first delivery is tied to the rendering
    // steps and never arrives in a background tab.
    setW(Math.round(el.getBoundingClientRect().width))
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect?.width || 0)
      if (next > 0) setW(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geom = useMemo(() => {
    const pts = series?.points || []
    if (!w || pts.length < 2) return null
    const plotW = Math.max(40, w - M.left - M.right)
    const plotH = H - M.top - M.bottom
    let lo = Math.min(...pts)
    let hi = Math.max(...pts)
    if (Number.isFinite(starting) && starting >= lo * 0.9 && starting <= hi * 1.1) {
      lo = Math.min(lo, starting)
      hi = Math.max(hi, starting)
    }
    if (hi === lo) { hi = lo + Math.abs(lo || 1) * 0.01; lo -= Math.abs(lo || 1) * 0.01 }
    const pad = (hi - lo) * 0.08
    lo -= pad; hi += pad

    const x = (i) => M.left + (i / (pts.length - 1)) * plotW
    const y = (v) => M.top + (1 - (v - lo) / (hi - lo)) * plotH

    const peak = Math.max(...pts)
    const trough = Math.min(...pts)
    return {
      pts, lo, hi, plotW, plotH, x, y,
      d: pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
      area: `${pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} L${x(pts.length - 1).toFixed(1)},${H - M.bottom} L${x(0).toFixed(1)},${H - M.bottom} Z`,
      baseY: Number.isFinite(starting) && starting >= lo && starting <= hi ? y(starting) : null,
      peak, trough,
      peakY: y(peak),
      troughY: y(trough),
      lastY: y(pts[pts.length - 1]),
      lastX: x(pts.length - 1),
    }
  }, [series, starting, w])

  useEffect(() => {
    const p = pathRef.current
    if (!p || !geom) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      p.style.strokeDasharray = 'none'
      return
    }
    const len = p.getTotalLength?.() || 0
    if (!len) return
    p.style.transition = 'none'
    p.style.strokeDasharray = `${len}`
    p.style.strokeDashoffset = `${len}`
    // Force a frame so the transition has a start value to run from.
    // eslint-disable-next-line no-unused-expressions
    p.getBoundingClientRect()
    p.style.transition = 'stroke-dashoffset 600ms var(--ease-out)'
    p.style.strokeDashoffset = '0'
  }, [geom])

  const onMove = (e) => {
    if (!geom) return
    const rect = wrapRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.max(0, Math.min(geom.pts.length - 1,
      Math.round(((px - M.left) / geom.plotW) * (geom.pts.length - 1))))
    setCursor(i)
  }

  if (!series || (series.points?.length || 0) < 2) return null

  return (
    <div className="arn-curve">
      <div
        className="arn-curve__plot"
        ref={wrapRef}
        onMouseMove={onMove}
        onMouseLeave={() => setCursor(null)}
      >
        {geom ? (
          <svg className="arn-curve__svg" viewBox={`0 0 ${w} ${H}`} role="img" aria-label={label}>
            {geom.baseY != null && (
              <line className="arn-curve__base" x1={M.left} x2={w - M.right} y1={geom.baseY} y2={geom.baseY} />
            )}
            <path className="arn-curve__area" d={geom.area} />
            <path className="arn-curve__path" d={geom.d} ref={pathRef} />
            {cursor != null && (
              <>
                <line
                  className="arn-curve__cursor"
                  x1={geom.x(cursor)} x2={geom.x(cursor)}
                  y1={M.top} y2={H - M.bottom}
                />
                <circle className="arn-curve__dot" cx={geom.x(cursor)} cy={geom.y(geom.pts[cursor])} r="3.5" />
              </>
            )}
            <circle className="arn-curve__last" cx={geom.lastX} cy={geom.lastY} r="3" />
          </svg>
        ) : null}

        {geom ? (
          <>
            <span className="arn-curve__tag arn-num" style={{ top: `${geom.peakY}px` }}>
              {fmtMoney(geom.peak)} <em>peak in window</em>
            </span>
            <span className="arn-curve__tag arn-num" style={{ top: `${geom.troughY}px` }}>
              {fmtMoney(geom.trough)} <em>low in window</em>
            </span>
            {geom.baseY != null ? (
              <span className="arn-curve__tag arn-curve__tag--base arn-num" style={{ top: `${geom.baseY}px` }}>
                {fmtMoney(starting)} <em>start</em>
              </span>
            ) : null}
            {cursor != null ? (
              <span
                className="arn-curve__hover arn-num"
                style={{ left: `${Math.min(Math.max(geom.x(cursor) - 60, 0), Math.max(0, w - M.right - 120))}px` }}
              >
                {fmtMoney(geom.pts[cursor])}
                <em>{fmtStamp(series.stamps?.[cursor])}</em>
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <p className="arn-curve__axis arn-meta">{label}</p>
    </div>
  )
}
