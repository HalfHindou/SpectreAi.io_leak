/**
 * LiqMapChart — the price-axis liquidation map (CoinGlass "Liquidation Map").
 *
 * Reads the same cohort model as the heatmap, projected onto price instead of
 * time (see api/_lib/handlers/liq-heatmap-binance.js → buildBinanceLiqMap):
 *
 *   • bars    — standing liquidation notional at each price bin, stacked and
 *               coloured by leverage tier (10x / 25x / 50x / 100x)
 *   • curves  — cumulative long leverage accumulating DOWN from spot (longs
 *               liquidate as price falls) and cumulative short accumulating UP
 *   • marker  — current price, the pivot the two sides mirror around
 *
 * Canvas, because a 300-bin stacked chart with two overlays is a lot of nodes
 * for SVG and this sits inside three different hosts.
 *
 * Honest framing: the field is MODELLED from open interest + price action, not
 * a book of real stop levels — no venue publishes those. Same provenance as the
 * heatmap; the footer says so.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import useTouchScrub from './use-touch-scrub'
import './liq-map-chart.css'

// Tier colours follow the CoinGlass ladder so the two read the same way.
const TIER_COLORS = { 10: '#7fc4ff', 25: '#4472e8', 50: '#f0c33c', 100: '#e8833a' }
const LONG_RGB = '239,83,80'
const SHORT_RGB = '38,166,154'

function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}
const fmtPx = (n) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(n >= 1 ? 2 : 5))

function draw(canvas, wrap, map, hoverX, dark) {
  if (!canvas || !wrap || !map?.levels?.length) return null
  const W = wrap.clientWidth, H = wrap.clientHeight
  if (W < 60 || H < 60) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  // Writing canvas.width always resets the backing store, so only touch it on a
  // real size change — this runs once per hover frame.
  const backW = Math.round(W * dpr), backH = Math.round(H * dpr)
  if (canvas.width !== backW || canvas.height !== backH) {
    canvas.width = backW; canvas.height = backH
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
  }
  const ctx = canvas.getContext('2d'); if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)

  const ink = dark ? '245,245,247' : '15,23,42'
  // Phones: the fixed 62/66 margins ate 41% of a 334px card and six price
  // ticks collided into one unreadable string. Narrow plots get tighter
  // margins + shorter axis figures + as many ticks as actually fit.
  const compact = W < 520
  const mL = compact ? 46 : 62, mR = compact ? 48 : 66, mT = 14, mB = 30
  const pw = W - mL - mR, ph = H - mT - mB
  if (pw < 40 || ph < 40) return null
  const fmtAxis = (n) => {
    if (!compact) return fmtUsd(n)
    if (!Number.isFinite(n)) return '—'
    const a = Math.abs(n)
    if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (a >= 1e6) return `$${Math.round(n / 1e6)}M`
    if (a >= 1e3) return `$${Math.round(n / 1e3)}K`
    return `$${Math.round(n)}`
  }

  const levels = map.levels
  const pMin = levels[0].price, pMax = levels[levels.length - 1].price
  const X = (p) => mL + ((p - pMin) / (pMax - pMin || 1)) * pw
  const barMax = map.peakLevelUsd || 1
  const Y = (v) => mT + ph - (v / barMax) * ph * 0.92
  const cumMax = Math.max(map.totalLongUsd || 0, map.totalShortUsd || 0, 1)
  const Yc = (v) => mT + ph - (v / cumMax) * ph * 0.92

  const spotX = X(map.spot)

  // 🪤 This used to paint each HALF of the plot as a full-height rectangle
  // (`fillRect(mL, mT, spotX - mL, ph)`), which is why the chart read as two
  // blocks butting up against the spot line rather than as two areas: the wash
  // sat above the cumulative curve as well as under it, at almost the same
  // alpha as the curve's own fill, so the curve's shape was invisible and the
  // whole thing cut off square at the top edge. The area under each curve IS
  // the shape — nothing else gets a fill.

  // gridlines + left axis (bar notional)
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
  ctx.textBaseline = 'middle'; ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const v = (barMax / 4) * i, y = Math.round(Y(v)) + 0.5
    // The zero line is the plot's baseline — without a visible one the bars
    // and area fills stop at an invisible edge and the chart reads as cut
    // off at the bottom (founder report, 2026-08-27).
    ctx.strokeStyle = i === 0 ? `rgba(${ink},0.18)` : `rgba(${ink},0.05)`
    ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pw, y); ctx.stroke()
    ctx.fillStyle = `rgba(${ink},0.4)`; ctx.textAlign = 'right'
    ctx.fillText(fmtAxis(v), mL - 7, y)
  }
  // right axis (cumulative)
  ctx.textAlign = 'left'
  for (let i = 0; i <= 4; i++) {
    const v = (cumMax / 4) * i
    ctx.fillStyle = `rgba(${ink},0.34)`
    ctx.fillText(fmtAxis(v), mL + pw + 8, Math.round(Yc(v)) + 0.5)
  }

  // ── Cumulative curves, in two passes ──
  // Areas go UNDER the tier bars and the strokes go OVER them. Drawn in one
  // pass (the old order) the 0.12 wash sat on top of every bar and muted the
  // thing the chart is actually measuring.
  const tracePath = (pts) => {
    ctx.beginPath()
    pts.forEach((p, i) => { const x = X(p.price), y = Yc(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
  }
  const areaFor = (pts, rgb) => {
    if (pts.length < 2) return
    tracePath(pts)
    // Close down to the ZERO line of the cumulative axis (Yc(0) === mT + ph),
    // so the fill is bounded by the curve and the baseline — never the frame.
    ctx.lineTo(X(pts[pts.length - 1].price), mT + ph)
    ctx.lineTo(X(pts[0].price), mT + ph)
    ctx.closePath()
    // Denser at the curve, fading into the baseline, so a tall plateau still
    // reads as a filled body without turning into a flat slab.
    const g = ctx.createLinearGradient(0, mT, 0, mT + ph)
    g.addColorStop(0, `rgba(${rgb},${dark ? 0.34 : 0.26})`)
    g.addColorStop(1, `rgba(${rgb},${dark ? 0.05 : 0.04})`)
    ctx.fillStyle = g
    ctx.fill()
  }
  const strokeFor = (pts, rgb) => {
    if (pts.length < 2) return
    tracePath(pts)
    ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke()
  }
  const longPts = levels.filter((l) => l.cumLong != null).map((l) => ({ price: l.price, v: l.cumLong }))
  const shortPts = levels.filter((l) => l.cumShort != null).map((l) => ({ price: l.price, v: l.cumShort }))

  areaFor(longPts, LONG_RGB)
  areaFor(shortPts, SHORT_RGB)

  // stacked tier bars — on top of the areas, so they stay saturated
  const binW = Math.max(1, pw / levels.length)
  const bw = Math.max(1, binW * 0.82)
  for (const l of levels) {
    const total = l.long + l.short
    if (total <= 0) continue
    const x = X(l.price) - bw / 2
    let acc = 0
    for (const t of l.tiers) {
      const v = t.long + t.short
      if (v <= 0) continue
      const y0 = Y(acc), y1 = Y(acc + v)
      ctx.fillStyle = TIER_COLORS[t.lev] || '#888'
      ctx.fillRect(x, y1, bw, Math.max(0.6, y0 - y1))
      acc += v
    }
  }

  strokeFor(longPts, LONG_RGB)
  strokeFor(shortPts, SHORT_RGB)

  // spot marker
  ctx.save()
  ctx.setLineDash([4, 4]); ctx.strokeStyle = `rgba(${ink},0.55)`; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(spotX, mT); ctx.lineTo(spotX, mT + ph); ctx.stroke()
  ctx.restore()
  const lbl = fmtPx(map.spot)
  ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
  const lw = ctx.measureText(lbl).width + 12
  ctx.fillStyle = dark ? 'rgba(20,20,24,0.92)' : 'rgba(255,255,255,0.94)'
  ctx.strokeStyle = `rgba(${ink},0.22)`
  ctx.beginPath(); ctx.roundRect(spotX - lw / 2, mT + 1, lw, 16, 4); ctx.fill(); ctx.stroke()
  ctx.fillStyle = `rgba(${ink},0.92)`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(lbl, spotX, mT + 9)

  // price axis — tick count follows the plot width so labels never collide
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
  ctx.fillStyle = `rgba(${ink},0.4)`; ctx.textBaseline = 'alphabetic'
  const nTicks = Math.max(2, Math.min(5, Math.floor(pw / 84)))
  for (let i = 0; i <= nTicks; i++) {
    const p = pMin + ((pMax - pMin) * i) / nTicks, x = X(p)
    ctx.textAlign = i === 0 ? 'left' : i === nTicks ? 'right' : 'center'
    ctx.fillText(fmtPx(p), x, H - 9)
  }

  drawSpectreWatermark(ctx, { w: W, h: H, dark, corner: 'tl', plot: { x: mL, y: mT, w: pw, h: ph } })

  // hover readout
  let hit = null
  if (hoverX != null && hoverX >= mL && hoverX <= mL + pw) {
    const price = pMin + ((hoverX - mL) / pw) * (pMax - pMin)
    let best = null, bd = Infinity
    for (const l of levels) { const d = Math.abs(l.price - price); if (d < bd) { bd = d; best = l } }
    if (best) {
      const hx = X(best.price)
      ctx.strokeStyle = `rgba(${ink},0.3)`; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(hx, mT); ctx.lineTo(hx, mT + ph); ctx.stroke()
      hit = best
    }
  }
  return hit
}

export default function LiqMapChart({ map, loading, error, dark = true, height = 380, action = null }) {
  const wrapRef = useRef(null), canvasRef = useRef(null)
  const [hit, setHit] = useState(null)
  // 🪤 The cursor used to be state AND an effect dep, so every pointer sample
  // repainted the whole canvas and disconnected/reconnected the ResizeObserver.
  // Now it is a ref and repaints are rAF-coalesced to one per frame — the same
  // pattern heatmap-view uses.
  const hoverRef = useRef(null)
  const rafRef = useRef(0)
  const tipRef = useRef(null)

  const placeTip = useCallback(() => {
    const tip = tipRef.current
    if (!tip) return
    const x = hoverRef.current
    tip.style.left = x == null ? '12px' : `min(calc(100% - 150px), ${x + 12}px)`
  }, [])

  const paint = useCallback(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (!wrap || !canvas) return
    // `hit` is a level object owned by `map`, so re-setting the same hovered
    // level is a no-op re-render in React — only a real change costs anything.
    setHit(draw(canvas, wrap, map, hoverRef.current, dark))
    placeTip()
  }, [map, dark, placeTip])

  const schedule = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; paint() })
  }, [paint])

  // Finger drag moves the crosshair the same way the mouse does. `.lmc-plot`
  // carries `touch-action: pan-y`, so a vertical swipe still scrolls the page.
  const moveHover = useCallback((x) => { hoverRef.current = x; schedule() }, [schedule])
  const clearHover = useCallback(() => { hoverRef.current = null; schedule() }, [schedule])
  const touch = useTouchScrub(moveHover, clearHover)

  useEffect(() => {
    paint()
    const wrap = wrapRef.current
    let ro
    if (wrap && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(schedule); ro.observe(wrap) }
    return () => {
      if (ro) ro.disconnect()
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    }
  }, [paint, schedule])

  const totals = useMemo(() => {
    if (!map) return null
    return { long: map.totalLongUsd, short: map.totalShortUsd, peak: map.peakLevelUsd }
  }, [map])

  return (
    <div className={`lmc${dark ? '' : ' lmc--day'}`} style={{ '--lmc-h': `${height}px` }}>
      <div className="lmc-legend">
        <span className="lmc-lg lmc-lg--long"><i />Cumulative long liq leverage</span>
        <span className="lmc-lg lmc-lg--short"><i />Cumulative short liq leverage</span>
        {[10, 25, 50, 100].map((t) => (
          <span className="lmc-lg" key={t}><i style={{ background: TIER_COLORS[t] }} />{t}x</span>
        ))}
        {/* Optional host-supplied control (the page's fullscreen toggle). */}
        {action ? <span className="lmc-actions">{action}</span> : null}
      </div>
      <div
        className="lmc-plot"
        ref={wrapRef}
        onMouseMove={(e) => { hoverRef.current = e.clientX - e.currentTarget.getBoundingClientRect().left; schedule() }}
        onMouseLeave={clearHover}
        {...touch}
      >
        <canvas ref={canvasRef} />
        {loading && !map ? <div className="lmc-state">Building the liquidation map…</div> : null}
        {error && !map ? <div className="lmc-state">Liquidation map unavailable right now.</div> : null}
        {hit ? (
          <div
            className="lmc-tip"
            // Positioned by placeTip() on the paint frame — the cursor lives in
            // a ref now, so it must not be read during render.
            ref={(el) => { tipRef.current = el; if (el) placeTip() }}
          >
            <b>${fmtPx(hit.price)}</b>
            <span className={hit.long >= hit.short ? 'dn' : 'up'}>
              {hit.long >= hit.short ? 'Long' : 'Short'} {fmtUsd(hit.long + hit.short)}
            </span>
            {hit.tiers.filter((t) => t.long + t.short > 0).map((t) => (
              <em key={t.lev}><i style={{ background: TIER_COLORS[t.lev] }} />{t.lev}x {fmtUsd(t.long + t.short)}</em>
            ))}
          </div>
        ) : null}
      </div>
      {totals ? (
        <div className="lmc-foot">
          <span>Below spot <b className="dn">{fmtUsd(totals.long)}</b></span>
          <span>Above spot <b className="up">{fmtUsd(totals.short)}</b></span>
          <span className="lmc-note">Leverage clusters modelled from open interest + price action</span>
        </div>
      ) : null}
    </div>
  )
}
