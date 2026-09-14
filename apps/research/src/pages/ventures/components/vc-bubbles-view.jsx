/**
 * VCBubblesView — the smart-money universe rendered as an X-Bubbles-style
 * constellation graph: a central glowing HUB with its network fanned out around
 * it on glowing curved threads, every node an avatar in a performance-tinted
 * ring, over a starfield. Same visual language as the X Bubbles project graph,
 * applied to VC funds / their portfolios.
 *
 *   field — a "Smart Money" hub with all funds orbiting it; ring = 24h
 *           portfolio move, size = AUM. Click a fund to open its ecosystem.
 *   vc    — a fund hub with its ENTIRE portfolio around it: tradeable tokens
 *           (live 24h tint) + private portfolio companies. No cap — every
 *           tracked project is a node. Click a token to see who backs it.
 *   token — the inverse: a token hub ringed by every fund that backs it.
 *
 * Perf: one <canvas>, d3-force collide layout that settles then idles, logos
 * cached + clipped, rAF bails on `document.hidden` AND when scrolled off-screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { forceSimulation, forceManyBody, forceCollide, forceX, forceY, forceLink } from 'd3-force'
import {
  effectiveAumUsd, parseUsdAum, fmtUsdCompact, fmtPct, classOfPct,
  isTradeableSymbol, buildConsensus, logoFromDomain,
} from './smu-shared'
import './vc-bubbles-view.css'

const BTC_REF = 64000 // fixed BTC ref so AUM sizing stays stable across 30s ticks
const TWO_PI = Math.PI * 2
const FIELD_H = 620

// Direct logo loader with a fallback ladder. We only DRAW the image (never read
// it back), so no crossOrigin is needed and a tainted canvas is fine — and the
// dev /api/img-proxy returns 403, which is exactly why the proxied path drew
// nothing. icon.horse / favicon services load fine loaded directly; on error we
// walk to the next candidate, finally falling back to drawn initials.
const _logoCache = new Map() // id -> { img }
function loadLogo(id, candidates) {
  if (!candidates || !candidates.length) return null
  let st = _logoCache.get(id)
  if (!st) {
    st = { img: new Image(), idx: 0 }
    _logoCache.set(id, st)
    const img = st.img
    img.referrerPolicy = 'no-referrer'
    img.onload = () => { img._ok = true }
    img.onerror = () => {
      st.idx += 1
      if (st.idx < candidates.length) img.src = candidates[st.idx]
    }
    img.src = candidates[0]
  }
  return st.img && st.img._ok ? st.img : null
}

// fund logo fallback ladder (icon.horse → google favicon → duckduckgo)
function fundLogos(domain) {
  if (!domain) return []
  return [0, 1, 2].map((i) => logoFromDomain(domain, i)).filter(Boolean)
}

// performance-tinted ring colour (the universal crypto-bubble language)
function ringColor(change, hub) {
  if (hub) return [120, 205, 255]            // teal-white hub
  if (!Number.isFinite(change)) return [150, 158, 176] // neutral (private cos)
  if (change >= 3) return [74, 240, 140]
  if (change >= 0.5) return [104, 226, 158]
  if (change > -0.5) return [176, 176, 190]
  if (change > -3) return [255, 138, 150]
  return [255, 92, 110]
}

// Live portfolio momentum of a fund = avg 24h move of its tradeable holdings.
function fundMomentum(entity, priceMap) {
  const moves = []
  for (const t of entity.known_portfolio_tokens || []) {
    const p = priceMap?.[String(t).toUpperCase()]
    if (p && Number.isFinite(p.change24h)) moves.push(p.change24h)
  }
  return moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null
}

function shortLabel(name) {
  const first = String(name || '').split(/\s+/)[0]
  return first.length > 14 ? `${first.slice(0, 13)}…` : first
}
function initials(name) {
  const w = String(name || '').replace(/[^\w\s]/g, '').trim().split(/\s+/)
  if (!w[0]) return '·'
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase()
}

// sqrt-normalize a list of values to mass[0..1]; unpriced → small fixed mass.
function massScale(values) {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0)
  const lo = nums.length ? Math.sqrt(Math.min(...nums)) : 0
  const hi = nums.length ? Math.sqrt(Math.max(...nums)) : 1
  return (v) => {
    if (!Number.isFinite(v) || v <= 0) return 0.2
    const t = hi > lo ? (Math.sqrt(v) - lo) / (hi - lo) : 0.5
    return Math.max(0.08, Math.min(1, t))
  }
}

function drawHex(ctx, x, y, r) {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const px = x + r * Math.cos(a), py = y + r * Math.sin(a)
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

// d3 force that clamps nodes inside the canvas rect so charge repulsion spreads
// them to FILL the window instead of relaxing into a centred disc.
function boundsForce(W, H, pad) {
  let ns = []
  const f = () => {
    for (const n of ns) {
      n.x = Math.max(pad + n.r, Math.min(W - pad - n.r, n.x))
      n.y = Math.max(pad + n.r, Math.min(H - pad - n.r, n.y))
    }
  }
  f.initialize = (arr) => { ns = arr }
  return f
}

/* ── the constellation-graph canvas engine ────────────────────────────────── */
function BubbleCanvas({ nodes, edges, height, onSelect }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const starsRef = useRef(null)
  const simNodesRef = useRef([])
  const simRef = useRef(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0, settled: false })
  const hoverRef = useRef(null)
  const dragRef = useRef(null)
  const nodeDragRef = useRef(null)
  const rafRef = useRef(0)
  const visibleRef = useRef(true)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)

  nodesRef.current = nodes
  edgesRef.current = edges

  const layoutKey = useMemo(
    () => nodes.map((n) => `${n.id}:${n.mass.toFixed(2)}:${n.hub ? 1 : 0}`).join('|'),
    [nodes],
  )

  // measure container width
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // pause rAF when scrolled out of view
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting }, { rootMargin: '140px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // warm the logo cache for the whole node set
  useEffect(() => { for (const n of nodes) loadLogo(n.id, n.logos) }, [nodes])

  // starfield (subtle, pre-rendered offscreen)
  useEffect(() => {
    if (width <= 0 || height <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const off = document.createElement('canvas')
    off.width = width * dpr; off.height = height * dpr
    const g = off.getContext('2d'); g.scale(dpr, dpr)
    const N = Math.round((width * height) / 8200)
    for (let i = 0; i < N; i++) {
      const x = Math.random() * width, y = Math.random() * height
      const s = Math.random() < 0.92 ? Math.random() * 0.8 + 0.2 : Math.random() * 1.5 + 0.8
      g.beginPath(); g.arc(x, y, s, 0, TWO_PI)
      g.fillStyle = `rgba(${190 + Math.random() * 55},${205 + Math.random() * 45},255,${Math.random() * 0.3 + 0.06})`
      g.fill()
    }
    starsRef.current = off
  }, [width, height])

  // build / rebuild the layout when the node SET / sizes change (not on ticks)
  useEffect(() => {
    if (!nodes.length || width <= 0 || height <= 0) return
    const cx = width / 2, cy = height / 2
    const hasHub = nodes.some((n) => n.hub)
    const spokes = nodes.filter((n) => !n.hub).length || 1
    // FIELD (no hub): bubbles fill the whole window. DRILL (hub): tighter spokes.
    const SPOKE_MIN = hasHub ? (spokes > 46 ? 13 : spokes > 26 ? 16 : 19) : (spokes > 60 ? 17 : spokes > 30 ? 21 : 26)
    const SPOKE_MAX = hasHub ? (spokes > 46 ? 27 : spokes > 26 ? 33 : 40) : (spokes > 60 ? 40 : spokes > 30 ? 48 : 58)
    const HUB_R = Math.min(58, 40 + spokes * 0.25)
    const ringR = Math.min(width, height) * (spokes > 46 ? 0.42 : spokes > 18 ? 0.38 : 0.32)
    const pad = 14

    const prev = new Map(simNodesRef.current.map((n) => [n.id, n]))
    const GA = Math.PI * (3 - Math.sqrt(5))
    const simNodes = nodes.map((n, i) => {
      const r = n.hub ? HUB_R : SPOKE_MIN + Math.pow(n.mass, 1.3) * (SPOKE_MAX - SPOKE_MIN)
      const p = prev.get(n.id)
      const a = i * GA
      let sx, sy
      if (p) { sx = p.x; sy = p.y }
      else if (n.hub) { sx = cx; sy = cy }
      else if (hasHub) { sx = cx + ringR * Math.cos(a); sy = cy + ringR * Math.sin(a) }
      else {
        // field: phyllotaxis seed scaled to FILL the rectangle (not a disc)
        const t = Math.sqrt((i + 0.5) / spokes)
        sx = pad + r + (width - 2 * (pad + r)) * (Math.cos(a) * t + 1) / 2
        sy = pad + r + (height - 2 * (pad + r)) * (Math.sin(a) * t + 1) / 2
      }
      const node = { ...n, r, x: sx, y: sy }
      if (n.hub) { node.fx = cx; node.fy = cy }
      return node
    })
    simNodesRef.current = simNodes
    const byId = new Map(simNodes.map((n) => [n.id, n]))
    const links = (edges || []).filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ ...e }))

    simRef.current?.stop()
    const sim = forceSimulation(simNodes)
      .force('charge', forceManyBody().strength((d) => (d.hub ? -60 : hasHub ? -38 : -30)).distanceMax(hasHub ? 280 : 240))
      .force('collide', forceCollide().radius((d) => d.r + 7).strength(0.95).iterations(2))
    if (hasHub) {
      sim.force('x', forceX(cx).strength(0.012))
        .force('y', forceY(cy).strength(0.012))
        // links hold the spokes on a ring at `ringR` from the hub
        .force('link', forceLink(links).id((d) => d.id).distance(ringR).strength(0.16))
    } else {
      // spread across the window: very gentle centering + hard bounds so charge
      // repulsion pushes the funds out to fill the full rectangle (wider than
      // tall → weaker x pull so they reach the left/right edges).
      sim.force('x', forceX(cx).strength(0.004))
        .force('y', forceY(cy).strength(0.011))
        .force('bounds', boundsForce(width, height, pad))
    }
    sim.alpha(0.95).alphaDecay(0.02).stop()
    simRef.current = sim
    viewRef.current.settled = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, width, height])

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = width * dpr; canvas.height = height * dpr
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      if (document.hidden || !visibleRef.current) return
      const tNow = performance.now() * 0.001
      const view = viewRef.current
      const sim = simRef.current
      const simNodes = simNodesRef.current
      const meta = new Map(nodesRef.current.map((n) => [n.id, n]))

      if (sim && !view.settled) {
        for (let i = 0; i < 2; i++) sim.tick()
        if (sim.alpha() < 0.012) view.settled = true
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // deep space
      const bg = ctx.createRadialGradient(width / 2, height * 0.42, 0, width / 2, height * 0.45, Math.max(width, height) * 0.8)
      bg.addColorStop(0, '#0b0c16'); bg.addColorStop(0.55, '#070710'); bg.addColorStop(1, '#040406')
      ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height)
      if (starsRef.current) {
        ctx.globalAlpha = 0.6
        ctx.drawImage(starsRef.current, view.panX * 0.1, view.panY * 0.1, width, height)
        ctx.globalAlpha = 1
      }

      const byId = new Map(simNodes.map((n) => [n.id, n]))
      const hov = hoverRef.current

      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)

      // ── glowing threads (hub → node) ──
      const edges = edgesRef.current || []
      const flowT = (tNow * 0.4) % 1
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]
        const s = byId.get(e.source), d = byId.get(e.target)
        if (!s || !d) continue
        const lit = hov && (e.source === hov || e.target === hov)
        const mx = (s.x + d.x) / 2, my = (s.y + d.y) / 2
        const dx = d.x - s.x, dy = d.y - s.y
        const dist = Math.hypot(dx, dy) || 1
        const sag = dist * 0.08 * (i % 2 === 0 ? 1 : -1)
        const cpx = mx + (-dy / dist) * sag, cpy = my + (dx / dist) * sag
        const [r, g, b] = ringColor(meta.get(d.id)?.change, false)
        const alpha = lit ? 0.85 : 0.16
        const grad = ctx.createLinearGradient(s.x, s.y, d.x, d.y)
        grad.addColorStop(0, `rgba(150,185,255,${alpha})`)
        grad.addColorStop(1, `rgba(${r},${g},${b},${lit ? 0.7 : 0.14})`)
        ctx.strokeStyle = grad
        ctx.lineWidth = (lit ? 1.8 : 0.8) / view.zoom
        ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(cpx, cpy, d.x, d.y); ctx.stroke()
        if (lit) {
          const ft = (flowT + i * 0.05) % 1
          const omt = 1 - ft
          const fx = omt * omt * s.x + 2 * omt * ft * cpx + ft * ft * d.x
          const fy = omt * omt * s.y + 2 * omt * ft * cpy + ft * ft * d.y
          ctx.fillStyle = 'rgba(255,255,255,0.92)'
          ctx.beginPath(); ctx.arc(fx, fy, 2.2 / view.zoom, 0, TWO_PI); ctx.fill()
        }
      }

      // ── nodes (draw spokes first, hub last so it sits on top) ──
      const ordered = [...simNodes].sort((a, b) => (a.hub ? 1 : 0) - (b.hub ? 1 : 0))
      for (const n of ordered) {
        const m = meta.get(n.id) || n
        const rr = n.r
        const isHover = hov === n.id
        const [r, g, b] = ringColor(m.change, n.hub)
        const breathe = (n.hub || isHover) ? 0.5 + 0.5 * Math.sin(tNow * 2) : 1
        const bob = view.settled && !n.fx ? Math.sin(tNow * 0.8 + n.x * 0.03) * 0.8 : 0
        const ny = n.y + bob

        // soft aura
        const auraR = rr * (n.hub ? 2.2 : isHover ? 1.9 : 1.55)
        const aura = ctx.createRadialGradient(n.x, ny, rr * 0.7, n.x, ny, auraR)
        const aA = (n.hub ? 0.4 : isHover ? 0.42 : 0.2) * (n.hub || isHover ? (0.7 + 0.3 * breathe) : 1)
        aura.addColorStop(0, `rgba(${r},${g},${b},${aA})`)
        aura.addColorStop(1, `rgba(${r},${g},${b},0)`)
        ctx.fillStyle = aura
        ctx.beginPath(); ctx.arc(n.x, ny, auraR, 0, TWO_PI); ctx.fill()

        // dark plate
        const plate = ctx.createRadialGradient(n.x - rr * 0.3, ny - rr * 0.34, rr * 0.1, n.x, ny, rr)
        plate.addColorStop(0, 'rgba(28,30,44,0.96)')
        plate.addColorStop(1, 'rgba(10,11,20,0.98)')
        ctx.fillStyle = plate
        if (n.hub) { drawHex(ctx, n.x, ny, rr); ctx.fill() }
        else { ctx.beginPath(); ctx.arc(n.x, ny, rr, 0, TWO_PI); ctx.fill() }

        // avatar (clipped) or initials
        const img = loadLogo(n.id, m.logos)
        const ar = rr - 3
        if (img && img._ok && ar > 5) {
          ctx.save()
          if (n.hub) drawHex(ctx, n.x, ny, ar); else { ctx.beginPath(); ctx.arc(n.x, ny, ar, 0, TWO_PI) }
          ctx.clip()
          ctx.drawImage(img, n.x - ar, ny - ar, ar * 2, ar * 2)
          ctx.restore()
        } else if (ar > 6) {
          ctx.fillStyle = `rgba(${r},${g},${b},0.92)`
          ctx.font = `700 ${Math.round(rr * 0.72)}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(initials(m.name || m.symbol), n.x, ny)
          ctx.textBaseline = 'alphabetic'
        }

        // ring
        const ringW = n.hub ? 3 : isHover ? 2.6 : 1.9
        ctx.strokeStyle = `rgba(${r},${g},${b},${n.hub || isHover ? 0.95 : 0.78})`
        ctx.lineWidth = ringW
        if (n.hub) drawHex(ctx, n.x, ny, rr); else { ctx.beginPath(); ctx.arc(n.x, ny, rr, 0, TWO_PI) }
        ctx.stroke()

        // label
        if (n.hub || rr >= 15 || isHover) {
          ctx.font = `${n.hub ? 700 : 600} ${Math.max(10, Math.min(15, rr * 0.42))}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillStyle = `rgba(255,255,255,${n.hub || isHover ? 0.98 : 0.8})`
          ctx.fillText(m.short || m.symbol || '', n.x, ny + rr + 14 / view.zoom)
        }
      }
      ctx.restore()
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [width, height])

  /* ── interaction ──────────────────────────────────────────────────────── */
  const toWorld = useCallback((cx, cy) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (cx - rect.left - v.panX) / v.zoom, y: (cy - rect.top - v.panY) / v.zoom }
  }, [])
  const pickNode = useCallback((wx, wy) => {
    let best = null, bestD = Infinity
    for (const n of simNodesRef.current) {
      const dx = n.x - wx, dy = n.y - wy, d = dx * dx + dy * dy
      const rr = (n.r + 4) * (n.r + 4)
      if (d < rr && d < bestD) { bestD = d; best = n }
    }
    return best
  }, [])
  const onMove = useCallback((e) => {
    const nd = nodeDragRef.current
    if (nd) {
      const w = toWorld(e.clientX, e.clientY)
      nd.node.fx = w.x; nd.node.fy = w.y
      if (Math.abs(e.clientX - nd.sx) + Math.abs(e.clientY - nd.sy) > 4) nd.moved = true
      simRef.current?.alphaTarget(0.2).restart(); viewRef.current.settled = false
      return
    }
    const drag = dragRef.current
    if (drag) {
      const v = viewRef.current
      v.panX = drag.panX + (e.clientX - drag.x); v.panY = drag.panY + (e.clientY - drag.y)
      if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3) drag.moved = true
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    const hit = pickNode(w.x, w.y)
    const id = hit?.id || null
    if (id !== hoverRef.current) {
      hoverRef.current = id
      const mm = id ? nodesRef.current.find((n) => n.id === id) : null
      setHover(mm ? { x: e.clientX, y: e.clientY, node: mm } : null)
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : 'grab'
    } else if (id) setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
  }, [toWorld, pickNode])
  const onDown = useCallback((e) => {
    if (e.button !== 0) return
    const w = toWorld(e.clientX, e.clientY)
    const hit = pickNode(w.x, w.y)
    if (hit && !hit.hub) nodeDragRef.current = { node: hit, sx: e.clientX, sy: e.clientY, moved: false }
    else { const v = viewRef.current; dragRef.current = { x: e.clientX, y: e.clientY, panX: v.panX, panY: v.panY, moved: false } }
  }, [toWorld, pickNode])
  const onUp = useCallback((e) => {
    const nd = nodeDragRef.current
    if (nd) {
      nodeDragRef.current = null
      simRef.current?.alphaTarget(0)
      nd.node.fx = null; nd.node.fy = null
      if (!nd.moved) { const m = nodesRef.current.find((n) => n.id === nd.node.id); onSelect?.(m || nd.node) }
      return
    }
    const drag = dragRef.current; dragRef.current = null
    if (drag && !drag.moved) {
      const w = toWorld(e.clientX, e.clientY)
      const hit = pickNode(w.x, w.y)
      if (hit) { const m = nodesRef.current.find((n) => n.id === hit.id); onSelect?.(m || hit) }
    }
  }, [toWorld, pickNode, onSelect])
  const onWheel = useCallback((e) => {
    e.preventDefault()
    const v = viewRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const nz = Math.max(0.45, Math.min(5, v.zoom * (e.deltaY < 0 ? 1.12 : 0.89)))
    v.panX = mx - (mx - v.panX) * (nz / v.zoom)
    v.panY = my - (my - v.panY) * (nz / v.zoom)
    v.zoom = nz
  }, [])
  const [, force] = useState(0)
  const zoomBy = (f) => { const v = viewRef.current; v.zoom = Math.max(0.45, Math.min(5, v.zoom * f)); force((n) => n + 1) }
  const resetView = () => { const v = viewRef.current; v.zoom = 1; v.panX = 0; v.panY = 0; force((n) => n + 1) }

  return (
    <div className="vcb-canvas-wrap" ref={wrapRef} style={{ height }}>
      <canvas
        ref={canvasRef}
        className="vcb-canvas"
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={() => { dragRef.current = null; nodeDragRef.current = null; hoverRef.current = null; setHover(null) }}
        onWheel={onWheel}
      />
      <div className="vcb-controls">
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(0.83)} aria-label="Zoom out">−</button>
        <button type="button" onClick={resetView} aria-label="Reset view">⟲</button>
      </div>
      {hover?.node && (
        <div className="vcb-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="vcb-tip-head">
            <span className="vcb-tip-name">{hover.node.name || hover.node.symbol}</span>
            {Number.isFinite(hover.node.change) && (
              <span className={`vcb-tip-chg mono ${classOfPct(hover.node.change)}`}>{fmtPct(hover.node.change)}</span>
            )}
          </div>
          <div className="vcb-tip-sub mono">{hover.node.sub || ''}</div>
        </div>
      )}
    </div>
  )
}

/* ── view shell: builds the hub + spokes per mode, owns drill state ────────── */
export default function VCBubblesView({ entities, priceMap, onSelectEntity, onOpenProfile, focus, onFocusConsumed }) {
  const [mode, setMode] = useState({ type: 'field' })

  useEffect(() => {
    if (focus) { setMode(focus); onFocusConsumed?.() }
  }, [focus, onFocusConsumed])

  const consensus = useMemo(() => buildConsensus(entities, priceMap), [entities, priceMap])
  const consensusBySym = useMemo(() => {
    const m = new Map()
    for (const r of consensus) m.set(r.symbol, r)
    return m
  }, [consensus])

  // FIELD — every fund as its own bubble, spread to fill the whole window. No
  // central hub: the idea is to see ALL the VCs at once, then click one to open
  // its world (the hub-and-spoke drill view).
  const field = useMemo(() => {
    const arr = entities.map((e) => ({ e, aum: effectiveAumUsd(e, BTC_REF), change: fundMomentum(e, priceMap) }))
    const toMass = massScale(arr.map((x) => x.aum))
    const nodes = arr.map(({ e, aum, change }) => ({
      id: `fund:${e.id}`, kind: 'fund', refId: e.id, name: e.name, short: shortLabel(e.name), symbol: shortLabel(e.name),
      logos: fundLogos(e.logo_domain), mass: toMass(aum), change,
      sub: `${fmtUsdCompact(aum)} AUM${Number.isFinite(change) ? ` · ${fmtPct(change)} 24h` : ''}`,
    }))
    return { nodes, edges: [] }
  }, [entities, priceMap])

  // VC — a fund hub + its entire portfolio (tokens + private companies)
  const vcData = useMemo(() => {
    if (mode.type !== 'vc') return null
    const entity = entities.find((e) => e.id === mode.id)
    if (!entity) return null
    const seen = new Set(); const tokens = []
    for (const raw of entity.known_portfolio_tokens || []) {
      if (!isTradeableSymbol(raw)) continue
      const sym = String(raw).toUpperCase()
      if (seen.has(sym)) continue
      seen.add(sym)
      const p = priceMap?.[sym] || null
      tokens.push({ sym, name: p?.name || sym, image: p?.image || null, mcap: p?.marketCap ?? null, change: p?.change24h ?? null })
    }
    const companies = []; const cseen = new Set()
    for (const raw of entity.known_portfolio_companies || []) {
      const name = String(raw || '').trim()
      if (!name || cseen.has(name.toUpperCase())) continue
      cseen.add(name.toUpperCase()); companies.push(name)
    }
    return { entity, tokens, companies }
  }, [mode, entities, priceMap])

  const vcGraph = useMemo(() => {
    if (!vcData) return { nodes: [], edges: [] }
    const { entity, tokens, companies } = vcData
    const toMass = massScale(tokens.map((t) => t.mcap))
    const hubId = `hub:${entity.id}`
    const nodes = [{
      id: hubId, hub: true, kind: 'fund', refId: entity.id, name: entity.name, short: shortLabel(entity.name),
      logos: fundLogos(entity.logo_domain), mass: 1, change: fundMomentum(entity, priceMap),
      sub: `${entity.aum_estimate || ''} · ${tokens.length + companies.length} projects`,
    }]
    for (const t of tokens) {
      nodes.push({
        id: `tok:${t.sym}`, kind: 'token', symbol: `$${t.sym}`, short: `$${t.sym}`, name: t.name, logos: t.image ? [t.image] : [],
        mass: toMass(t.mcap), change: t.change,
        sub: t.mcap ? `${fmtUsdCompact(t.mcap)} mcap${Number.isFinite(t.change) ? ` · ${fmtPct(t.change)}` : ''}` : 'token',
      })
    }
    for (const c of companies) {
      nodes.push({ id: `co:${c}`, kind: 'company', symbol: c, short: shortLabel(c), name: c, logos: [], mass: 0.42, change: null, sub: 'private portfolio company' })
    }
    const edges = nodes.slice(1).map((n) => ({ source: hubId, target: n.id }))
    return { nodes, edges }
  }, [vcData, priceMap])

  // TOKEN — a token hub + its backer funds (inverse)
  const tokenData = useMemo(() => {
    if (mode.type !== 'token') return null
    const sym = String(mode.symbol || '').toUpperCase()
    return { sym, row: consensusBySym.get(sym) }
  }, [mode, consensusBySym])

  const tokenGraph = useMemo(() => {
    if (!tokenData) return { nodes: [], edges: [] }
    const { sym, row } = tokenData
    const backers = row?.backers || []
    const toMass = massScale(backers.map((e) => parseUsdAum(e.aum_estimate) || effectiveAumUsd(e, BTC_REF)))
    const hubId = `hubtok:${sym}`
    const nodes = [{
      id: hubId, hub: true, kind: 'token', symbol: `$${sym}`, short: `$${sym}`, name: row?.name || `$${sym}`,
      logos: row?.image ? [row.image] : [], mass: 1, change: row?.change24h ?? null,
      sub: row ? `${row.backerCount} funds · ${fmtUsdCompact(row.poolAum)} pool` : '',
    }]
    for (const e of backers) {
      const aum = parseUsdAum(e.aum_estimate) || effectiveAumUsd(e, BTC_REF)
      nodes.push({
        id: `fund:${e.id}`, kind: 'fund', refId: e.id, name: e.name, short: shortLabel(e.name), symbol: shortLabel(e.name),
        logos: fundLogos(e.logo_domain), mass: toMass(aum), change: fundMomentum(e, priceMap),
        sub: `${fmtUsdCompact(aum)} AUM`,
      })
    }
    const edges = nodes.slice(1).map((n) => ({ source: hubId, target: n.id }))
    return { nodes, edges }
  }, [tokenData, priceMap])

  const onSelect = useCallback((node) => {
    if (!node) return
    if (node.kind === 'fund' && node.refId) { setMode({ type: 'vc', id: node.refId }); onSelectEntity?.(node.refId) }
    else if (node.kind === 'token') {
      const sym = String(node.symbol || '').replace(/^\$/, '')
      if (sym) setMode({ type: 'token', symbol: sym })
    }
  }, [onSelectEntity])

  // ── FIELD ──
  if (mode.type === 'field') {
    return (
      <div className="smu-bub-wrap">
        <div className="smu-bub-head">
          <span className="smu-bub-title">VC Bubbles</span>
          <span className="smu-bub-desc">{entities.length} smart-money funds · ring = 24h move · size = AUM · click any fund to open its world</span>
        </div>
        <BubbleCanvas nodes={field.nodes} edges={field.edges} height={FIELD_H} onSelect={onSelect} />
      </div>
    )
  }

  // ── VC ECOSYSTEM ──
  if (mode.type === 'vc') {
    if (!vcData) { setMode({ type: 'field' }); return null }
    const { entity, tokens, companies } = vcData
    return (
      <div className="smu-bub-wrap">
        <div className="smu-bub-head">
          <button type="button" className="smu-graph-back" onClick={() => setMode({ type: 'field' })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            <span>All funds</span>
          </button>
          <span className="smu-graph-crumb">{entity.name}</span>
          <span className="smu-bub-desc">{tokens.length} tokens · {companies.length} private · click a token to see its backers</span>
          <button type="button" className="smu-bub-reset" onClick={() => onOpenProfile?.(entity.id)}>Open profile →</button>
        </div>
        <BubbleCanvas nodes={vcGraph.nodes} edges={vcGraph.edges} height={FIELD_H} onSelect={onSelect} />
      </div>
    )
  }

  // ── TOKEN ECOSYSTEM (inverse) ──
  const { sym, row } = tokenData || {}
  return (
    <div className="smu-bub-wrap">
      <div className="smu-bub-head">
        <button type="button" className="smu-graph-back" onClick={() => setMode({ type: 'field' })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          <span>All funds</span>
        </button>
        <span className="smu-graph-crumb">${sym}</span>
        <span className="smu-bub-desc">{row ? `${row.backerCount} funds back $${sym} · click a fund to explore it` : `No tracked funds hold $${sym}`}</span>
      </div>
      <BubbleCanvas nodes={tokenGraph.nodes} edges={tokenGraph.edges} height={FIELD_H} onSelect={onSelect} />
    </div>
  )
}
