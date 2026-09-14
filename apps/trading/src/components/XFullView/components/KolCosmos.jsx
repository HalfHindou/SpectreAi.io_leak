import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { isAppActive } from '../../../lib/idleManager'

/**
 * KolCosmos — Canvas2D previewer of the Spectre Cosmos for one token's KOL
 * universe. Mirrors the research-app cosmos language (project = sun at the
 * core, voices orbiting on inclined elliptical rings, starfield depth) at
 * previewer cost: NO three.js (trading deliberately ships without it).
 *
 * GPU budget:
 *   - starfield + orbit rings + sun glow pre-rendered to an offscreen canvas
 *     (rebuilt only on resize) — per frame it's one drawImage + sprites
 *   - each avatar pre-rendered once into a circular sprite (no per-frame clip)
 *   - ~30fps cap, loop fully stopped when tab hidden / scrolled away / idle
 *
 * Semantics (same story as the cosmos explainer):
 *   orbit  — stronger metric pulls the voice closer to the core
 *   size   — metric magnitude (sqrt-scaled)
 *   depth  — bodies dim + shrink slightly behind the sun (fake incline)
 *
 * Props:
 *   authors   X Dash top_authors entries
 *   metric    'followers' | 'engagement' | 'mentions'
 *   sunImage  project avatar/logo URL (falls back to a glyph disc)
 *   sunLabel  cashtag or symbol under the sun
 */
function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function fmtCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function seeded(i) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function metricValue(a, metric) {
  if (metric === 'engagement') return num(a.total_weighted_engagement)
  if (metric === 'mentions') return num(a.mention_count ?? a.mentions)
  return num(a.followers_count ?? a.followers)
}

const MAX_BODIES = 20
const FRAME_MS = 33 // ~30fps
const SQUASH = 0.42 // ellipse incline
const SPRITE = 96 // sprite buffer px

// Pre-render an avatar (or fallback glyph) into a ring-bordered circular sprite.
function buildSprite(img, name) {
  const c = document.createElement('canvas')
  c.width = SPRITE
  c.height = SPRITE
  const ctx = c.getContext('2d')
  const r = SPRITE / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(r, r, r - 2, 0, Math.PI * 2)
  ctx.clip()
  if (img) {
    ctx.drawImage(img, 0, 0, SPRITE, SPRITE)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, 0, SPRITE, SPRITE)
    ctx.fillStyle = 'rgba(245,245,247,0.85)'
    ctx.font = `700 ${SPRITE * 0.42}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((name || '?').slice(0, 1).toUpperCase(), r, r + 2)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(r, r, r - 2, 0, Math.PI * 2)
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(245,245,247,0.35)'
  ctx.stroke()
  return c
}

function KolCosmos({ authors, metric = 'followers', sunImage, sunLabel }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const bgRef = useRef(null) // offscreen: stars + rings + sun glow
  const nodesRef = useRef([])
  const spritesRef = useRef(new Map()) // handle -> sprite canvas
  const sunSpriteRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const rafRef = useRef(0)
  const lastTsRef = useRef(0)
  const visibleRef = useRef(true)
  const hoverIdxRef = useRef(-1)
  const [hover, setHover] = useState(null) // { x, y, a }

  const list = useMemo(() => {
    const arr = Array.isArray(authors) ? authors.filter(Boolean) : []
    return arr
      .map((a) => ({ a, v: metricValue(a, metric) }))
      .filter((x) => x.v > 0)
      .sort((b, c) => c.v - b.v)
      .slice(0, MAX_BODIES)
  }, [authors, metric])

  // Build/refresh the node set. Orbit phase is keyed to the author so a
  // metric switch re-ranks orbits without teleporting bodies.
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.key, n]))
    const n = list.length
    const vMax = list[0]?.v || 1
    nodesRef.current = list.map((x, i) => {
      const key = x.a.screen_name || x.a.name || String(i)
      const old = prev.get(key)
      // sqrt size scale, 12..26 body radius (canvas units pre-DPR)
      const size = 12 + 14 * Math.sqrt(x.v / vMax)
      // rank 0 = innermost orbit
      const orbitT = n > 1 ? i / (n - 1) : 0
      return {
        key,
        a: x.a,
        v: x.v,
        size,
        sizeCur: old?.sizeCur ?? size,
        orbitT,
        orbitCur: old?.orbitCur ?? orbitT,
        theta: old?.theta ?? seeded(i) * Math.PI * 2,
        speed: (0.00012 + 0.00028 * (1 - orbitT)) * (seeded(i + 7) > 0.5 ? 1 : -1),
      }
    })
    // load avatars into sprites once
    nodesRef.current.forEach((node) => {
      if (spritesRef.current.has(node.key)) return
      spritesRef.current.set(node.key, buildSprite(null, node.a.name || node.a.screen_name))
      const url = node.a.profile_image_url || node.a.avatar_image_url || node.a.avatar
      if (!url) return
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => spritesRef.current.set(node.key, buildSprite(img, node.a.name))
      img.src = url.replace(/_normal\.(jpg|png|jpeg|webp|gif)/i, '_200x200.$1')
    })
  }, [list])

  // Sun sprite
  useEffect(() => {
    sunSpriteRef.current = buildSprite(null, sunLabel || 'S')
    if (!sunImage) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { sunSpriteRef.current = buildSprite(img, sunLabel) }
    img.src = sunImage.split('?')[0]
  }, [sunImage, sunLabel])

  // Offscreen background: starfield + orbit rings + sun glow. Resize-only.
  function rebuildBg() {
    const { w, h, dpr } = sizeRef.current
    if (!w || !h) return
    const bg = document.createElement('canvas')
    bg.width = w * dpr
    bg.height = h * dpr
    const ctx = bg.getContext('2d')
    ctx.scale(dpr, dpr)
    // stars
    for (let i = 0; i < 130; i++) {
      const x = seeded(i * 3) * w
      const y = seeded(i * 3 + 1) * h
      const r = 0.4 + seeded(i * 3 + 2) * 1.1
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${0.05 + seeded(i * 5) * 0.16})`
      ctx.fill()
    }
    const cx = w / 2
    const cy = h / 2
    // sun glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.34)
    glow.addColorStop(0, 'rgba(245,245,247,0.14)')
    glow.addColorStop(0.35, 'rgba(245,245,247,0.05)')
    glow.addColorStop(1, 'rgba(245,245,247,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    // orbit rings (drawn at the ring radii the bodies actually use)
    const { rMin, rMax } = orbitBounds(w, h)
    const rings = 5
    for (let i = 0; i < rings; i++) {
      const rr = rMin + ((rMax - rMin) * i) / (rings - 1)
      ctx.beginPath()
      ctx.ellipse(cx, cy, rr, rr * SQUASH, 0, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    bgRef.current = bg
  }

  function orbitBounds(w, h) {
    const rMax = Math.min(w * 0.44, (h * 0.46) / SQUASH)
    return { rMin: Math.max(w < 520 ? 46 : 70, rMax * 0.28), rMax }
  }

  // Resize observer drives canvas + bg buffers.
  useEffect(() => {
    const el = wrapRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return undefined
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      const w = Math.max(280, Math.floor(rect.width))
      const h = Math.max(300, Math.floor(rect.height))
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      // Reassigning canvas.width WIPES the buffer — only do it on a real
      // change (>2px absorbs sub-pixel jitter). The canvas is absolutely
      // positioned (CSS) so it can never feed back into the wrap's layout —
      // a content-sized wrap once grew ~40px/s forever on mobile, wiping
      // every frame before it could be seen.
      const prev = sizeRef.current
      if (Math.abs(prev.w - w) <= 2 && Math.abs(prev.h - h) <= 2 && prev.dpr === dpr) return
      sizeRef.current = { w, h, dpr }
      canvas.width = w * dpr
      canvas.height = h * dpr
      rebuildBg()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Pause when scrolled out of view.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const io = new IntersectionObserver((entries) => {
      visibleRef.current = entries[0]?.isIntersecting !== false
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // The frame loop — advances orbits + draws. Skips all work when hidden,
  // off-screen, or the app has gone idle.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')

    function frame(ts) {
      rafRef.current = requestAnimationFrame(frame)
      if (document.hidden || !visibleRef.current || !isAppActive()) return
      if (ts - lastTsRef.current < FRAME_MS) return
      const dt = Math.min(ts - lastTsRef.current || FRAME_MS, 100)
      lastTsRef.current = ts

      const { w, h, dpr } = sizeRef.current
      if (!w || !h) return
      const cx = w / 2
      const cy = h / 2
      const { rMin, rMax } = orbitBounds(w, h)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0, w, h)

      // Narrow canvases (phones) get smaller bodies, fewer labels, smaller sun.
      const sizeScale = Math.max(0.72, Math.min(1, w / 860))
      const labelCount = w < 520 ? 4 : 6

      // advance + project
      const drawList = []
      const nodes = nodesRef.current
      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i]
        nd.theta += nd.speed * dt
        nd.orbitCur += (nd.orbitT - nd.orbitCur) * 0.06
        nd.sizeCur += (nd.size - nd.sizeCur) * 0.06
        const rr = rMin + (rMax - rMin) * nd.orbitCur
        const x = cx + Math.cos(nd.theta) * rr
        const y = cy + Math.sin(nd.theta) * rr * SQUASH
        const depth = Math.sin(nd.theta) // -1 back … +1 front
        const scale = 0.86 + 0.14 * ((depth + 1) / 2)
        drawList.push({ nd, x, y, depth, i, r: nd.sizeCur * scale * sizeScale })
      }
      drawList.sort((a, b) => a.depth - b.depth)

      // back bodies → sun → front bodies
      let sunDrawn = false
      const drawSun = () => {
        const sun = sunSpriteRef.current
        const sr = w < 520 ? 26 : 34
        if (sun) ctx.drawImage(sun, cx - sr, cy - sr, sr * 2, sr * 2)
        if (sunLabel) {
          ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillStyle = 'rgba(245,245,247,0.7)'
          ctx.fillText(sunLabel, cx, cy + sr + 14)
        }
        sunDrawn = true
      }
      for (const d of drawList) {
        if (!sunDrawn && d.depth >= 0) drawSun()
        const { r } = d
        const sprite = spritesRef.current.get(d.nd.key)
        ctx.globalAlpha = 0.72 + 0.28 * ((d.depth + 1) / 2)
        if (sprite) ctx.drawImage(sprite, d.x - r, d.y - r, r * 2, r * 2)
        if (hoverIdxRef.current === d.i) {
          ctx.beginPath()
          ctx.arc(d.x, d.y, r + 2, 0, Math.PI * 2)
          ctx.lineWidth = 1.5
          ctx.strokeStyle = 'rgba(245,245,247,0.75)'
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        // label the loudest voices (front side only, declutter)
        if (d.i < labelCount && d.depth > -0.2 && d.nd.a.screen_name) {
          ctx.font = '500 10px -apple-system, BlinkMacSystemFont, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillStyle = 'rgba(245,245,247,0.5)'
          ctx.fillText(`@${d.nd.a.screen_name}`, d.x, d.y + r + 12)
        }
      }
      if (!sunDrawn) drawSun()

      // stash projected positions for hit-testing
      nodesRef.current._proj = drawList
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [sunLabel])

  // Hover + click (mouse) and tap-to-select / tap-again-to-open (touch).
  const touchSelRef = useRef(-1)
  const lastPointerTypeRef = useRef('mouse')
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    // Clamp the tooltip inside the canvas so it never bleeds off a phone edge.
    function tipPos(d) {
      const { w, h } = sizeRef.current
      return {
        x: Math.max(6, Math.min(d.x, (w || 320) - 190)),
        y: Math.max(6, Math.min(d.y, (h || 320) - 96)),
        a: d.nd.a,
      }
    }
    function hit(e) {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const proj = nodesRef.current._proj || []
      // front-most first; touch gets a fatter hit slop
      const slop = e.pointerType && e.pointerType !== 'mouse' ? 10 : 3
      for (let i = proj.length - 1; i >= 0; i--) {
        const d = proj[i]
        const r = d.r + slop
        if ((x - d.x) ** 2 + (y - d.y) ** 2 <= r * r) return d
      }
      return null
    }
    function onMove(e) {
      const d = hit(e)
      hoverIdxRef.current = d ? d.i : -1
      canvas.style.cursor = d ? 'pointer' : 'default'
      setHover(d ? tipPos(d) : null)
    }
    function onLeave() {
      hoverIdxRef.current = -1
      setHover(null)
    }
    function onPointerDown(e) {
      lastPointerTypeRef.current = e.pointerType || 'mouse'
      if (lastPointerTypeRef.current === 'mouse') return
      const d = hit(e)
      if (!d) {
        touchSelRef.current = -1
        hoverIdxRef.current = -1
        setHover(null)
        return
      }
      if (touchSelRef.current === d.i) {
        // second tap on the selected voice opens it on X
        if (d.nd.a.screen_name) {
          window.open(`https://x.com/${d.nd.a.screen_name}`, '_blank', 'noopener')
        }
        return
      }
      touchSelRef.current = d.i
      hoverIdxRef.current = d.i
      setHover(tipPos(d))
    }
    function onClick(e) {
      // touch flow is handled in pointerdown; suppress the synthetic click
      if (lastPointerTypeRef.current !== 'mouse') return
      const d = hit(e)
      if (d?.nd.a.screen_name) {
        window.open(`https://x.com/${d.nd.a.screen_name}`, '_blank', 'noopener')
      }
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('click', onClick)
    return () => {
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('click', onClick)
    }
  }, [])

  const metricLabel = metric === 'engagement' ? 'engagement' : metric === 'mentions' ? 'mentions' : 'followers'

  if (!list.length) {
    return <div className="xct-bubbles-empty">No KOL activity to plot yet.</div>
  }

  return (
    <div className="xfv-cosmos" ref={wrapRef}>
      <canvas ref={canvasRef} className="xfv-cosmos-canvas" />
      <div className="xfv-cosmos-hint">
        Closer to the core = louder {metricLabel} · click a voice to open on X
      </div>
      {hover && (
        <div className="xct-bubble-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="xct-bubble-tip-name">
            {hover.a.name}
            {hover.a.is_blue_verified && <span className="xct-bubble-tip-vf">✓</span>}
          </div>
          <div className="xct-bubble-tip-handle">@{hover.a.screen_name}</div>
          <div className="xct-bubble-tip-row">
            <span>{fmtCompact(num(hover.a.followers_count ?? hover.a.followers))} followers</span>
            <span>{fmtCompact(num(hover.a.mention_count ?? hover.a.mentions))} mentions</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(KolCosmos)
