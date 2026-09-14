/**
 * LiqMagnetField — the liquidation book as orbiting masses.
 *
 * The panel this replaced (the "Leverage Terrain") drew four overlapping
 * ridgelines in a sheared pseudo-3D with the axis labels floating in dead
 * space. Nobody could read a price off it, which is the only thing the surface
 * is for.
 *
 * The metaphor here is the one the page's own analysis text already uses:
 * "price tends to gravitate toward stacked liquidity". So each liquidation
 * cluster is a MASS, and the read is physical — a big orb sitting close to the
 * core is the level price is most likely to get pulled into.
 *
 *   vertical spine = price          (so above spot is ALWAYS visually above)
 *   orb height     = cluster price
 *   orb size       = notional at that cluster
 *   orb colour     = side — longs liquidate below spot, shorts above
 *   orbit radius   = leverage tier; 100x hugs the spine because it blows first
 *   rotation       = camera azimuth only
 *
 * Price is the VERTICAL axis rather than an orbital angle on purpose: rotating
 * the arrangement itself would swing longs above shorts every half-turn and
 * destroy the one reading that has to survive the animation. Only the camera
 * moves; the semantics are pinned.
 *
 * Canvas 2D with painter's-algorithm depth sorting (the spine is drawn between
 * the far and near halves, so orbs genuinely pass behind and in front of it) —
 * same approach as the other charts on this page, no new dependency, nothing
 * added to the boot path.
 *
 * Honest framing, unchanged from the heatmap: the field is MODELLED from open
 * interest + price action. No venue publishes real stop levels. Footer says so.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import { isAppActive } from '@/lib/idleManager'
import './liq-magnet-field.css'

const LONG_RGB = '239,83,80'
const SHORT_RGB = '38,166,154'
const TIER_COLORS = { 10: '#7fc4ff', 25: '#4472e8', 50: '#f0c33c', 100: '#e8833a' }
const TIERS = [10, 25, 50, 100]
// 100x rides closest to the spine — those positions liquidate first, so they
// sit nearest the price core. 10x rides wide.
const TIER_ORBIT = { 100: 0.36, 50: 0.58, 25: 0.80, 10: 1 }
const GOLDEN_ANGLE = 2.399963229728653
const TILT = 0.3

function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}
const fmtPx = (n) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(n >= 1 ? 2 : 5))

/**
 * Collapse ~300 price levels into a handful of magnets. Greedy peak-picking
 * with a minimum price gap (the same shape as `computeKeyLevels`), then each
 * peak absorbs its neighbourhood so an orb represents a CLUSTER rather than a
 * single bin.
 */
export function buildMagnets(map, maxOrbs = 15) {
  const spot = Number(map?.spot)
  const levels = Array.isArray(map?.levels) ? map.levels : []
  if (!levels.length || !(spot > 0)) return []

  const rows = levels
    .map((l) => {
      const long = Number(l.long) || 0
      const short = Number(l.short) || 0
      return { price: Number(l.price), long, short, total: long + short, tiers: Array.isArray(l.tiers) ? l.tiers : [] }
    })
    .filter((r) => r.total > 0 && r.price > 0)
  if (!rows.length) return []

  const prices = rows.map((r) => r.price)
  const span = Math.max(...prices) - Math.min(...prices)
  const minGap = Math.max(span / 55, spot * 0.0015)

  const peaks = []
  for (const r of [...rows].sort((a, b) => b.total - a.total)) {
    if (peaks.length >= maxOrbs) break
    if (peaks.every((p) => Math.abs(p.price - r.price) >= minGap)) peaks.push(r)
  }

  return peaks
    .map((peak) => {
      let long = 0
      let short = 0
      const tierSum = { 10: 0, 25: 0, 50: 0, 100: 0 }
      for (const r of rows) {
        if (Math.abs(r.price - peak.price) > minGap / 2) continue
        long += r.long
        short += r.short
        for (const t of r.tiers) {
          if (tierSum[t.lev] != null) tierSum[t.lev] += (Number(t.long) || 0) + (Number(t.short) || 0)
        }
      }
      const total = long + short
      const tier = TIERS.reduce((best, t) => (tierSum[t] > tierSum[best] ? t : best), 10)
      return {
        price: peak.price,
        long,
        short,
        total,
        tier,
        side: peak.price < spot ? 'long' : 'short',
        distPct: ((peak.price - spot) / spot) * 100,
      }
    })
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
}

function orbFill(ctx, x, y, r, rgb, depth) {
  // Light from upper-left so the disc reads as a sphere rather than a dot.
  const g = ctx.createRadialGradient(x - r * 0.34, y - r * 0.38, r * 0.06, x, y, r)
  const lift = 0.55 + depth * 0.2
  g.addColorStop(0, `rgba(255,255,255,${0.5 * lift})`)
  g.addColorStop(0.28, `rgba(${rgb},${0.95 * lift})`)
  g.addColorStop(1, `rgba(${rgb},${0.28 * lift})`)
  return g
}

function draw(canvas, wrap, magnets, map, azimuth, hoverPos, dark, stats) {
  if (!canvas || !wrap || !magnets.length || !(map?.spot > 0)) return null
  const W = wrap.clientWidth
  const H = wrap.clientHeight
  if (W < 80 || H < 80) return null

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  // 🪤 Assigning canvas.width/height ALWAYS resets the backing store and clears
  // the context, even when the value is unchanged — so writing it every frame
  // was a full reallocation at 60fps. Only touch it on a real size change.
  const bw = Math.round(W * dpr)
  const bh = Math.round(H * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const ink = dark ? '245,245,247' : '15,23,42'
  const mL = 66
  const mR = 74
  const mT = 26
  const mB = 32
  const plotH = H - mT - mB
  const cx = mL + (W - mL - mR) / 2
  if (plotH < 60) return null

  // Price bounds + peak notional depend only on the magnet set, so they are
  // memoized by the component instead of being re-derived (with two spread
  // calls and a throwaway array) on every animation frame.
  const spot = map.spot
  const { pMin, pMax, maxTotal } = stats

  const baseR = Math.min((W - mL - mR) * 0.33, 200)

  // An orb's screen Y is its price PLUS the orbital bob (depth x R x TILT) and
  // it still has to fit its own radius. Inset the price scale by that
  // worst-case excursion, otherwise the biggest orbs on the outer rings hang
  // off the top and bottom edges and read as a rendering bug.
  const maxRad = (6 + 24) * 1.16
  const vInset = baseR * TILT + maxRad
  const innerH = plotH - vInset * 2
  const useInset = innerH > 90
  const yTop = useInset ? mT + vInset : mT
  const ySpan = useInset ? innerH : plotH
  const Y = (p) => yTop + ySpan - ((p - pMin) / (pMax - pMin || 1)) * ySpan

  const items = magnets.map((m, i) => {
    const R = baseR * (TIER_ORBIT[m.tier] ?? 0.8)
    const theta = i * GOLDEN_ANGLE + azimuth
    const depth = Math.sin(theta) // +1 nearest the viewer, -1 furthest
    const baseRad = 6 + 24 * Math.sqrt(m.total / maxTotal)
    return {
      ...m,
      R,
      theta,
      depth,
      x: cx + Math.cos(theta) * R,
      y: Y(m.price) + depth * R * TILT,
      rad: baseRad * (1 + depth * 0.16),
    }
  })

  // ── price axis ──
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const p = pMax - ((pMax - pMin) / 4) * i
    const y = Math.round(Y(p)) + 0.5
    ctx.strokeStyle = `rgba(${ink},0.035)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(mL - 10, y)
    ctx.lineTo(W - mR + 10, y)
    ctx.stroke()
    ctx.fillStyle = `rgba(${ink},0.4)`
    ctx.fillText(fmtPx(p), mL - 16, y)
  }

  // ── orbit rings, drawn back-to-front with the orbs ──
  const sorted = [...items].sort((a, b) => a.depth - b.depth)
  const spotY = Y(spot)

  const drawRing = (it) => {
    const ry = Y(it.price)
    ctx.strokeStyle = `rgba(${it.side === 'long' ? LONG_RGB : SHORT_RGB},0.1)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(cx, ry, it.R, it.R * TILT, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  const drawOrb = (it, isHot) => {
    const rgb = it.side === 'long' ? LONG_RGB : SHORT_RGB
    // glow
    const gl = ctx.createRadialGradient(it.x, it.y, it.rad * 0.5, it.x, it.y, it.rad * 2.6)
    gl.addColorStop(0, `rgba(${rgb},${isHot ? 0.3 : 0.17})`)
    gl.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = gl
    ctx.beginPath()
    ctx.arc(it.x, it.y, it.rad * 2.6, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = orbFill(ctx, it.x, it.y, it.rad, rgb, it.depth)
    ctx.beginPath()
    ctx.arc(it.x, it.y, it.rad, 0, Math.PI * 2)
    ctx.fill()

    // leverage-tier core
    ctx.fillStyle = TIER_COLORS[it.tier] || '#888'
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(it.x - it.rad * 0.28, it.y - it.rad * 0.3, Math.max(1.3, it.rad * 0.2), 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    if (isHot) {
      ctx.strokeStyle = `rgba(255,255,255,0.75)`
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(it.x, it.y, it.rad + 3, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  const hot = hoverPos ? nearest(items, hoverPos) : null
  const back = sorted.filter((it) => it.depth <= 0)
  const front = sorted.filter((it) => it.depth > 0)

  back.forEach(drawRing)
  back.forEach((it) => drawOrb(it, hot === it))

  // ── the spine + spot disc, between the halves so orbs occlude correctly ──
  const spineGrad = ctx.createLinearGradient(0, mT, 0, mT + plotH)
  spineGrad.addColorStop(0, `rgba(${ink},0.05)`)
  spineGrad.addColorStop(Math.max(0, Math.min(1, (spotY - mT) / plotH)), `rgba(${ink},0.4)`)
  spineGrad.addColorStop(1, `rgba(${ink},0.05)`)
  ctx.strokeStyle = spineGrad
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx, mT)
  ctx.lineTo(cx, mT + plotH)
  ctx.stroke()

  ctx.strokeStyle = `rgba(${ink},0.5)`
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.ellipse(cx, spotY, baseR * 1.06, baseR * 1.06 * TILT, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = `rgba(${ink},0.05)`
  ctx.fill()

  front.forEach(drawRing)
  front.forEach((it) => drawOrb(it, hot === it))

  // spot label rides above everything
  const spotLbl = `SPOT ${fmtPx(spot)}`
  ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
  const sw = ctx.measureText(spotLbl).width + 14
  ctx.fillStyle = dark ? 'rgba(16,16,20,0.9)' : 'rgba(255,255,255,0.94)'
  ctx.strokeStyle = `rgba(${ink},0.24)`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(cx - sw / 2, spotY - 9, sw, 18, 5)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = `rgba(${ink},0.92)`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(spotLbl, cx, spotY)

  // ── label the three heaviest magnets so the chart reads without hovering ──
  const top = [...items].sort((a, b) => b.total - a.total).slice(0, 3)
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
  ctx.textBaseline = 'middle'
  for (const it of top) {
    if (hot === it) continue
    const toRight = it.x >= cx
    const lx = it.x + (toRight ? it.rad + 8 : -(it.rad + 8))
    const a = fmtUsd(it.total)
    const b = fmtPx(it.price)
    // Backing pill — these labels routinely land over a neighbouring orb, and
    // coloured text on a coloured sphere is unreadable without it.
    const bw = Math.max(ctx.measureText(a).width, ctx.measureText(b).width) + 12
    const bx = toRight ? lx - 6 : lx - bw + 6
    ctx.fillStyle = dark ? 'rgba(12,12,15,0.62)' : 'rgba(255,255,255,0.72)'
    ctx.beginPath()
    ctx.roundRect(bx, it.y - 15, bw, 30, 6)
    ctx.fill()

    ctx.textAlign = toRight ? 'left' : 'right'
    ctx.fillStyle = `rgba(${it.side === 'long' ? LONG_RGB : SHORT_RGB},0.98)`
    ctx.fillText(a, lx, it.y - 6)
    ctx.fillStyle = `rgba(${ink},0.5)`
    ctx.fillText(b, lx, it.y + 6)
  }

  drawSpectreWatermark(ctx, { w: W, h: H, dark, corner: 'tl', plot: { x: mL, y: mT, w: W - mL - mR, h: plotH } })

  return hot
}

function nearest(items, pos) {
  let best = null
  let bd = Infinity
  for (const it of items) {
    const d = Math.hypot(it.x - pos.x, it.y - pos.y)
    if (d < Math.max(it.rad + 6, 14) && d < bd) {
      bd = d
      best = it
    }
  }
  return best
}

export default function LiqMagnetField({ map, loading, error, dark = true, height = 470, action = null }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const azimuthRef = useRef(0)
  const rafRef = useRef(0)
  const visibleRef = useRef(true)
  const orbitingRef = useRef(true)
  const [orbiting, setOrbiting] = useState(true)
  const [hit, setHit] = useState(null)
  // 🪤 Hover lives in a REF, not state. It used to be state that fed `render`,
  // which was a dep of the animation effect below — so every single pointer
  // sample tore the loop down and rebuilt it: cancelAnimationFrame, then a NEW
  // IntersectionObserver + ResizeObserver + rAF. The loop already runs every
  // frame, so it just reads the latest cursor from the ref.
  const hoverRef = useRef(null)
  const tipRef = useRef(null)
  const hotRef = useRef(null)
  const hitKeyRef = useRef(null)

  const magnets = useMemo(() => buildMagnets(map), [map])

  // Per-frame constants hoisted out of draw(): price bounds + peak notional.
  const stats = useMemo(() => {
    const spot = map?.spot || 0
    let pMin = Infinity, pMax = -Infinity, maxTotal = 0
    for (const m of magnets) {
      if (m.price < pMin) pMin = m.price
      if (m.price > pMax) pMax = m.price
      if (m.total > maxTotal) maxTotal = m.total
    }
    if (spot > 0) { if (spot < pMin) pMin = spot; if (spot > pMax) pMax = spot }
    if (!Number.isFinite(pMin)) { pMin = 0; pMax = 1 }
    const padP = (pMax - pMin) * 0.06 || spot * 0.01
    return { pMin: pMin - padP, pMax: pMax + padP, maxTotal: maxTotal || 1 }
  }, [magnets, map])

  // The hovered orb keeps orbiting, so its tooltip has to track it. Writing
  // that through React state would re-render the whole panel every frame, so
  // the POSITION is applied straight to the node and only the CONTENT (which
  // changes when you move to a different orb) goes through state.
  const placeTip = useCallback((hot) => {
    const tip = tipRef.current
    const wrap = wrapRef.current
    if (!tip || !hot || !wrap) return
    const w = wrap.clientWidth
    const top = `${Math.max(8, hot.y - 54)}px`
    if (hot.x > w / 2) {
      tip.style.left = 'auto'
      tip.style.right = `${Math.max(8, w - hot.x + hot.rad + 12)}px`
    } else {
      tip.style.right = 'auto'
      tip.style.left = `${hot.x + hot.rad + 12}px`
    }
    tip.style.top = top
  }, [])

  const render = useCallback(() => {
    const hot = draw(canvasRef.current, wrapRef.current, magnets, map, azimuthRef.current, hoverRef.current, dark, stats)
    hotRef.current = hot
    const key = hot ? `${hot.side}:${hot.tier}:${hot.price}` : null
    if (key !== hitKeyRef.current) {
      hitKeyRef.current = key
      setHit(hot)
    }
    placeTip(hot)
  }, [magnets, map, dark, stats, placeTip])

  useEffect(() => { orbitingRef.current = orbiting }, [orbiting])

  // Animation loop. Guarded on tab visibility, on-screen presence AND the 5-min
  // idle timer — this panel sits inside a tab set, so it must not burn frames
  // while another view is showing or the user has walked away (the pattern the
  // repo's other canvas surfaces already use).
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return undefined

    let io
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((e) => { visibleRef.current = e[0]?.isIntersecting ?? true }, { threshold: 0.05 })
      io.observe(wrap)
    }

    const tick = () => {
      if (!document.hidden && visibleRef.current && isAppActive()) {
        if (orbitingRef.current) azimuthRef.current += 0.0022
        render()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(render)
      ro.observe(wrap)
    }
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (io) io.disconnect()
      if (ro) ro.disconnect()
    }
  }, [render])

  const totals = useMemo(() => {
    if (!magnets.length) return null
    const long = magnets.filter((m) => m.side === 'long').reduce((s, m) => s + m.total, 0)
    const short = magnets.filter((m) => m.side === 'short').reduce((s, m) => s + m.total, 0)
    const nearestMagnet = [...magnets].sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct))[0]
    return { long, short, nearestMagnet }
  }, [magnets])

  return (
    <div className="lmf" style={{ '--lmf-h': `${height}px` }}>
      <div className="lmf-bar">
        <div className="lmf-legend">
          <span className="lmf-lg lmf-lg--long"><i />Long cluster</span>
          <span className="lmf-lg lmf-lg--short"><i />Short cluster</span>
          <span className="lmf-sep" />
          {TIERS.map((t) => (
            <span className="lmf-lg" key={t}><i style={{ background: TIER_COLORS[t] }} />{t}x</span>
          ))}
        </div>
        <div className="lmf-actions">
          <button type="button" className={`lmf-btn${orbiting ? ' is-on' : ''}`} onClick={() => setOrbiting((v) => !v)}>
            {orbiting ? 'Orbiting' : 'Paused'}
          </button>
          {/* Optional host-supplied control (the page's fullscreen toggle). */}
          {action}
        </div>
      </div>

      <div
        className="lmf-plot"
        ref={wrapRef}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
        }}
        onMouseLeave={() => { hoverRef.current = null }}
      >
        <canvas ref={canvasRef} />
        {loading && !magnets.length ? <div className="lmf-state">Mapping the liquidation field…</div> : null}
        {error && !magnets.length ? <div className="lmf-state">Liquidation field unavailable right now.</div> : null}
        {!loading && !error && !magnets.length ? <div className="lmf-state">No liquidation clusters in range.</div> : null}
        {hit ? (
          <div
            className="lmf-tip"
            // Positioned imperatively by placeTip() on the animation frame —
            // see the note on `hoverRef`. The ref callback places it once on
            // mount so it never paints for a frame at the wrong coordinates.
            ref={(el) => { tipRef.current = el; if (el) placeTip(hotRef.current) }}
          >
            <b>${fmtPx(hit.price)}</b>
            <span className={hit.side === 'long' ? 'dn' : 'up'}>
              {hit.side === 'long' ? 'Long' : 'Short'} · {fmtUsd(hit.total)}
            </span>
            <em>
              <i style={{ background: TIER_COLORS[hit.tier] }} />
              {hit.tier}x dominant · {hit.distPct >= 0 ? '+' : ''}{hit.distPct.toFixed(2)}% from spot
            </em>
          </div>
        ) : null}
      </div>

      {totals ? (
        <div className="lmf-foot">
          <span>Below spot <b className="dn">{fmtUsd(totals.long)}</b></span>
          <span>Above spot <b className="up">{fmtUsd(totals.short)}</b></span>
          {totals.nearestMagnet ? (
            <span>
              Nearest magnet <b>${fmtPx(totals.nearestMagnet.price)}</b>
              {' '}({totals.nearestMagnet.distPct >= 0 ? '+' : ''}{totals.nearestMagnet.distPct.toFixed(2)}%)
            </span>
          ) : null}
          <span className="lmf-note">Size = notional · orbit = leverage tier · modelled from open interest + price action</span>
        </div>
      ) : null}
    </div>
  )
}
