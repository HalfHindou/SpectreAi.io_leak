/**
 * BandsView — "which side gets hit", over time.
 *
 * Third read on the same `useRealHeatmap` model the Heatmap view uses, so it
 * costs no extra request: the Heatmap ramps ONE colour by magnitude, this one
 * ramps TWO by side (below spot = longs liquidate, above = shorts), with the
 * price path over the top. Reading them together is the point — a magnet is
 * only interesting once you know which way it pulls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { drawBandsChart, fmtBandsUsd } from './bands-view-chart'
import useTouchScrub from '@/components/use-touch-scrub'
// 🪤 Not optional. Without it `.lbv-plot` has no height, so the renderer sizes
// the canvas from a container whose height is set BY the canvas — the
// ResizeObserver then feeds that back and the pane grows without bound (3,700px
// on first try). The renderer clamps as a backstop; this is the actual fix.
import './bands-view.css'

const SIDES = [
  { key: 'both', label: 'Both' },
  { key: 'long', label: 'Long' },
  { key: 'short', label: 'Short' },
]

export default function BandsView({
  heatmapData, klineData, loading, error, dayMode, fmtPrice, action = null, height = 440,
}) {
  const [side, setSide] = useState('both')
  const [hit, setHit] = useState(null)
  const [totals, setTotals] = useState(null)
  const canvasRef = useRef(null)
  const boxRef = useRef(null)
  // Cursor lives in a ref and repaints are rAF-coalesced — the pattern
  // heatmap-view and liq-map-chart both settled on, after a version that kept
  // the cursor in state repainted the whole canvas per pointer sample.
  const mouseRef = useRef(null)
  const rafRef = useRef(0)
  const tipRef = useRef(null)

  const placeTip = useCallback(() => {
    const tip = tipRef.current
    if (!tip) return
    const m = mouseRef.current
    if (!m) return
    tip.style.left = `min(calc(100% - 168px), ${m.x + 14}px)`
    tip.style.top = `${Math.max(8, m.y - 46)}px`
  }, [])

  const paint = useCallback(() => {
    const canvas = canvasRef.current, box = boxRef.current
    if (!canvas || !box) return
    const res = drawBandsChart(canvas, box, heatmapData, klineData, {
      dayMode, side, fmtPrice, mouse: mouseRef.current,
    })
    setHit(res?.hit || null)
    setTotals(res?.totals || null)
    placeTip()
  }, [heatmapData, klineData, dayMode, side, fmtPrice, placeTip])

  const schedule = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; paint() })
  }, [paint])

  useEffect(() => {
    paint()
    const box = boxRef.current
    let ro
    if (box && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(schedule); ro.observe(box) }
    return () => {
      if (ro) ro.disconnect()
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    }
  }, [paint, schedule])

  const counts = useMemo(() => {
    if (!totals) return null
    const sum = totals.long + totals.short
    if (!sum) return null
    return { longPct: Math.round((totals.long / sum) * 100), shortPct: Math.round((totals.short / sum) * 100) }
  }, [totals])

  const onMove = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect()
    mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    schedule()
  }, [schedule])
  const onLeave = useCallback(() => { mouseRef.current = null; schedule() }, [schedule])
  // Touch has no hover: drag the finger and the crosshair follows.
  const onScrub = useCallback((x, y) => { mouseRef.current = { x, y }; schedule() }, [schedule])
  const touch = useTouchScrub(onScrub, onLeave)

  return (
    <div className={`lbv${dayMode ? ' lbv--day' : ''}`} style={{ '--lbv-h': `${height}px` }}>
      <div className="lbv-bar">
        <div className="lbv-sides">
          {SIDES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`lbv-side${side === s.key ? ' active' : ''}`}
              onClick={() => setSide(s.key)}
            >{s.label}</button>
          ))}
        </div>
        <div className="lbv-legend">
          <span className="lbv-lg lbv-lg--long"><i />Longs liquidate{counts ? ` · ${counts.longPct}%` : ''}</span>
          <span className="lbv-lg lbv-lg--short"><i />Shorts liquidate{counts ? ` · ${counts.shortPct}%` : ''}</span>
        </div>
        {action ? <span className="lbv-actions">{action}</span> : null}
      </div>

      <div className="lbv-plot" ref={boxRef} onMouseMove={onMove} onMouseLeave={onLeave} {...touch}>
        <canvas ref={canvasRef} />
        {loading && !heatmapData ? <div className="lbv-state">Building the liquidation bands…</div> : null}
        {error && !heatmapData ? <div className="lbv-state">Liquidation bands unavailable right now.</div> : null}
        {!loading && !error && heatmapData && !totals ? (
          <div className="lbv-state">No standing liquidation clusters in this window.</div>
        ) : null}
        {hit ? (
          <div className="lbv-tip" ref={(el) => { tipRef.current = el; if (el) placeTip() }}>
            <b>{fmtPrice ? fmtPrice(hit.price) : `$${hit.price}`}</b>
            <span className={hit.side === 'long' ? 'dn' : 'up'}>
              {hit.side === 'long' ? 'Long' : 'Short'} {fmtBandsUsd(hit.value)}
            </span>
          </div>
        ) : null}
      </div>

      <p className="lbv-note">
        Bands below spot are where leveraged longs get liquidated on a flush; above spot is where shorts
        get squeezed. Modelled from open interest + price action, not measured fills.
      </p>
    </div>
  )
}
