/**
 * GraphCanvas — Canvas 2D renderer for the X Intelligence social graph.
 *
 * Draws nodes (KOLs, exchanges, projects) as avatar circles with tier-colored
 * rings, connected by mention/symbol-ref links. Supports pan/zoom via transform,
 * hover dimming, selection highlighting, and high-DPI rendering.
 *
 * The entire graph is drawn each frame via requestAnimationFrame.
 */
import { useRef, useEffect, useCallback } from 'react'
import { getNodeRadius, nodeColor, isPromoterNode } from '../data/zigchainGraph'

// ── Module-level image cache (persists across re-renders) ────────────────────
const imageCache = new Map()

// Sentinel for images that failed to load
const FAILED = Symbol('FAILED')

/**
 * Load an image into the cache. Returns the cached HTMLImageElement if ready,
 * null if still loading, or FAILED if the src errored.
 */
function getCachedImage(src, onReady) {
  if (!src) return null
  const cached = imageCache.get(src)
  if (cached === FAILED) return null
  if (cached) return cached

  const img = new Image()
  // No crossOrigin - CoinGecko/Twitter CDNs reject CORS anonymous requests.
  // Canvas becomes tainted but we never call getImageData/toDataURL so it's fine.
  imageCache.set(src, null) // mark as loading
  img.onload = () => {
    imageCache.set(src, img)
    onReady?.()
  }
  img.onerror = () => {
    imageCache.set(src, FAILED)
  }
  img.src = src
  return null
}

// Parse `#RRGGBB` → "r, g, b" string we can plug into rgba(...).
function hexToRgb(hex) {
  if (!hex) return '148, 163, 184'
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return '148, 163, 184'
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`
}

// ── Shape helpers (entity shapes: hexagon for projects, rounded square for exchanges) ──

function drawShape(ctx, type, x, y, radius) {
  ctx.beginPath()
  if (type === 'project') {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const px = x + radius * Math.cos(angle)
      const py = y + radius * Math.sin(angle)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (type === 'exchange') {
    const size = radius * 1.7
    const half = size / 2
    ctx.roundRect(x - half, y - half, size, size, radius * 0.3)
  } else {
    ctx.arc(x, y, radius, 0, Math.PI * 2)
  }
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

function drawGrid(ctx, w, h, transform, dayMode) {
  const spacing = 60
  const color = dayMode
    ? 'rgba(0,0,0,0.02)'
    : 'rgba(255,255,255,0.015)'

  ctx.strokeStyle = color
  ctx.lineWidth = 0.5

  // Offset grid lines by current pan so they scroll with the graph
  const ox = transform.x % (spacing * transform.k)
  const oy = transform.y % (spacing * transform.k)
  const step = spacing * transform.k

  ctx.beginPath()
  for (let x = ox; x < w; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let y = oy; y < h; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()

  // Day mode: subtle warm center gradient
  if (dayMode) {
    const cx = w / 2 + transform.x * 0.3
    const cy = h / 2 + transform.y * 0.3
    const maxR = Math.max(w, h) * 0.5
    const warmGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
    warmGrad.addColorStop(0, 'rgba(245,180,50,0.025)')
    warmGrad.addColorStop(0.5, 'rgba(245,180,50,0.008)')
    warmGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = warmGrad
    ctx.fillRect(0, 0, w, h)
  }
}

/**
 * Inter-project bridge arcs (crawl mode only) — curved bezier lines between
 * project hubs that share KOLs. The wider the shared-mention overlap, the
 * brighter and thicker the arc. This is the "you can see WHERE the
 * connections are" visual the crawl feature is built around.
 */
function drawBridgeArcs(ctx, arcs, positions, transform, hoveredId, selectedId, adjacency, dayMode) {
  if (!arcs || !arcs.length) return
  const activeId = hoveredId || selectedId
  const maxWeight = arcs[0]?.weight || 1   // arcs sorted desc, first is heaviest

  // One pass at low alpha behind everything for ambience.
  ctx.save()
  for (let i = 0; i < arcs.length; i++) {
    const arc = arcs[i]
    const sp = positions[arc.sourceId]
    const tp = positions[arc.targetId]
    if (!sp || !tp) continue

    const sx = sp.x * transform.k + transform.x
    const sy = sp.y * transform.k + transform.y
    const tx = tp.x * transform.k + transform.x
    const ty = tp.y * transform.k + transform.y

    // Quadratic bezier control point pushed perpendicular to the chord —
    // this is what makes the line *curve*. Sign alternates by index so
    // arcs don't all bow the same way.
    const mx = (sx + tx) / 2
    const my = (sy + ty) / 2
    const dx = tx - sx
    const dy = ty - sy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) continue
    // Push the control point ~20% of chord length perpendicular to the chord.
    const perpX = -dy / dist
    const perpY = dx / dist
    const sag = dist * 0.18 * (i % 2 === 0 ? 1 : -1)
    const cpx = mx + perpX * sag
    const cpy = my + perpY * sag

    // Weight → alpha + width. Heavier overlap = brighter/thicker arc.
    const w = Math.min(1, arc.weight / Math.max(1, maxWeight))
    const connected = activeId
      ? (arc.sourceId === activeId || arc.targetId === activeId
         || adjacency?.get(activeId)?.has(arc.sourceId)
         || adjacency?.get(activeId)?.has(arc.targetId))
      : false
    // Non-connected arcs hold their idle alpha (no fading).
    const idleAlpha = 0.22 + 0.28 * w
    const baseAlpha = connected ? 0.75 + 0.20 * w : idleAlpha
    const lineW = (connected ? 1.6 : 0.9) + w * 1.4

    // Gradient stroke: faint amber → midpoint accent → faint amber. White
    // midpoint vanishes on a white canvas — swap to slate for day mode.
    const midRgb = dayMode ? '15, 23, 42' : '255, 255, 255'
    const midAlpha = dayMode ? Math.min(0.55, baseAlpha) : baseAlpha
    const grad = ctx.createLinearGradient(sx, sy, tx, ty)
    grad.addColorStop(0,   `rgba(251, 191, 36, ${baseAlpha * 0.6})`)
    grad.addColorStop(0.5, `rgba(${midRgb}, ${midAlpha})`)
    grad.addColorStop(1,   `rgba(251, 191, 36, ${baseAlpha * 0.6})`)

    ctx.strokeStyle = grad
    ctx.lineWidth = lineW
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cpx, cpy, tx, ty)
    ctx.stroke()
  }
  ctx.restore()
}

// Curved gradient links with engagement-weighted thickness.
// Source-tier-color → warm white midpoint → target-tier-color gradient stroke.
// High-engagement edges get an animated "flow particle" traveling source→target.
function drawLinks(ctx, links, positions, transform, filteredSet, hoveredId, selectedId, adjacency, dayMode, nodeMap, focusModeActive) {
  const activeId = hoveredId || selectedId
  const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001
  // Precompute flow-particle progress (0→1 looping every 2.5s).
  const flowT = (tNow * 0.4) % 1

  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    if (!filteredSet.has(link.source) || !filteredSet.has(link.target)) continue

    const sp = positions[link.source]
    const tp = positions[link.target]
    if (!sp || !tp) continue

    const sx = sp.x * transform.k + transform.x
    const sy = sp.y * transform.k + transform.y
    const tx = tp.x * transform.k + transform.x
    const ty = tp.y * transform.k + transform.y

    const connected = activeId
      ? (link.source === activeId || link.target === activeId)
      : false

    const mentionWeight = Math.min(1, Math.sqrt(link.tweetCount || 1) / 6)
    // Idle alpha scaled by mention volume. Active-connected links brighten,
    // but non-connected links DO NOT dim — they hold their idle alpha so
    // the rest of the graph stays alive.
    let alpha = 0.32 + 0.36 * mentionWeight
    if (connected) alpha = 0.92

    // Color pick: source/target authenticity-class colors from nodeMap (so the
    // edge inherits the new authenticity coloring), midpoint warm white.
    const sNode = nodeMap?.get(link.source)
    const tNode = nodeMap?.get(link.target)
    const sColor = sNode ? hexToRgb(nodeColor(sNode)) : '148, 163, 184'
    const tColor = tNode ? hexToRgb(nodeColor(tNode)) : '148, 163, 184'

    // Subtle perpendicular curve. Sign alternates so adjacent links don't
    // all bow the same way. Curve magnitude scales with chord length.
    const mx = (sx + tx) / 2
    const my = (sy + ty) / 2
    const dx = tx - sx
    const dy = ty - sy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) continue
    const perpX = -dy / dist
    const perpY = dx / dist
    const sag = dist * 0.08 * (i % 2 === 0 ? 1 : -1)
    const cpx = mx + perpX * sag
    const cpy = my + perpY * sag

    // Stroke color. Hovered/selected links keep the full 3-stop gradient
    // (few of them, and the highlight earns it). IDLE links — hundreds at
    // 30fps — used to allocate a createLinearGradient EACH, per frame; at
    // ~1px width and idle alpha a solid tier-blend stroke is visually
    // indistinguishable, so it's computed once and cached on the link.
    const midRgb = dayMode ? '15, 23, 42' : '255, 255, 255'
    if (connected) {
      const midAlpha = dayMode ? Math.min(0.55, alpha) : alpha
      const grad = ctx.createLinearGradient(sx, sy, tx, ty)
      grad.addColorStop(0,   `rgba(${sColor}, ${(alpha * 0.85).toFixed(3)})`)
      grad.addColorStop(0.5, `rgba(${midRgb}, ${midAlpha.toFixed(3)})`)
      grad.addColorStop(1,   `rgba(${tColor}, ${(alpha * 0.85).toFixed(3)})`)
      ctx.strokeStyle = grad
    } else {
      const strokeKey = dayMode ? '_idleStrokeDay' : '_idleStrokeNight'
      let stroke = link[strokeKey]
      if (!stroke) {
        // endpoint-tier blend nudged toward the mid accent
        const ends = blendRgbStrings(sColor, tColor)
        const mixed = blendRgbStrings(ends, midRgb)
        stroke = `rgba(${mixed}, ${(alpha * 0.9).toFixed(3)})`
        link[strokeKey] = stroke
      }
      ctx.strokeStyle = stroke
    }
    ctx.lineWidth = (connected ? 2.4 : 1.1) + mentionWeight * 1.3
    ctx.lineCap = 'round'

    if (link.type === 'symbol_ref') ctx.setLineDash([3, 3])

    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cpx, cpy, tx, ty)
    ctx.stroke()

    if (link.type === 'symbol_ref') ctx.setLineDash([])

    // Flow particles on the brightest 20% of links (or any link connected
    // to the active node). A dot travels from source → target on a 2.5s
    // loop, sampled at the current `flowT` position along the bezier.
    const showFlow = mentionWeight > 0.55 || connected
    if (showFlow) {
      // Quadratic bezier sampling: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
      const ft = connected ? flowT : (flowT + i * 0.07) % 1
      const omt = 1 - ft
      const fx = omt * omt * sx + 2 * omt * ft * cpx + ft * ft * tx
      const fy = omt * omt * sy + 2 * omt * ft * cpy + ft * ft * ty
      const dotR = (connected ? 2.6 : 2.0) * Math.max(0.6, transform.k)
      // Tiny halo behind the dot — a pre-rendered sprite blit (see
      // flowHaloSprite) instead of a per-particle radial gradient.
      const dotRgb = dayMode ? '15, 23, 42' : '255, 255, 255'
      const haloR = dotR * 3
      const prevA = ctx.globalAlpha
      ctx.globalAlpha = prevA * 0.5 * (connected ? 1 : mentionWeight)
      ctx.drawImage(flowHaloSprite(dayMode), fx - haloR, fy - haloR, haloR * 2, haloR * 2)
      ctx.globalAlpha = prevA
      ctx.beginPath()
      ctx.arc(fx, fy, dotR, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${dotRgb}, ${connected ? 0.95 : 0.75})`
      ctx.fill()
    }
  }
}

/* Pre-rendered flow-particle halo (radial white/slate falloff). Allocating a
   createRadialGradient PER PARTICLE PER FRAME was a top canvas cost on dense
   graphs — one 64px sprite per palette, tinted via globalAlpha, is pixel-
   identical at particle scale. */
const _flowHaloSprites = {}
function flowHaloSprite(dayMode) {
  const key = dayMode ? 'day' : 'night'
  let s = _flowHaloSprites[key]
  if (!s) {
    s = document.createElement('canvas')
    s.width = 64
    s.height = 64
    const c = s.getContext('2d')
    const rgb = dayMode ? '15, 23, 42' : '255, 255, 255'
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, `rgba(${rgb}, 1)`)
    g.addColorStop(1, `rgba(${rgb}, 0)`)
    c.fillStyle = g
    c.fillRect(0, 0, 64, 64)
    _flowHaloSprites[key] = s
  }
  return s
}

/* Average two "r, g, b" strings — the cached solid stroke for idle links. */
function blendRgbStrings(a, b) {
  const pa = a.split(',').map(Number)
  const pb = b.split(',').map(Number)
  return `${Math.round((pa[0] + pb[0]) / 2)}, ${Math.round((pa[1] + pb[1]) / 2)}, ${Math.round((pa[2] + pb[2]) / 2)}`
}

/**
 * Compartment boundaries + group labels for the static Hierarchy/Grid layouts.
 * Drawn BENEATH the nodes/links: a near-invisible rounded-rect boundary per
 * group + an uppercase letterspaced header. Apple-subtle — a faint boundary,
 * not a dashboard box. Respects the current pan/zoom transform.
 */
function drawCompartments(ctx, groups, transform, dayMode) {
  if (!groups || !groups.length) return
  ctx.save()
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const x = g.x * transform.k + transform.x
    const y = g.y * transform.k + transform.y
    const w = g.w * transform.k
    const h = g.h * transform.k
    const r = 16 * transform.k

    // Boundary — 1px near-invisible rounded rect (a touch stronger + dark ink
    // in day mode so it reads on the light canvas).
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fillStyle = dayMode ? 'rgba(15, 23, 42, 0.015)' : 'rgba(255, 255, 255, 0.012)'
    ctx.fill()
    ctx.strokeStyle = dayMode ? 'rgba(15, 23, 42, 0.10)' : 'rgba(255, 255, 255, 0.05)'
    ctx.lineWidth = 1
    ctx.stroke()

    // A whisper of the group's accent along the top edge of the header.
    const accentRgb = hexToRgb(g.color)
    ctx.beginPath()
    ctx.moveTo(x + 12 * transform.k, y + 22 * transform.k)
    ctx.lineTo(x + 20 * transform.k, y + 22 * transform.k)
    ctx.strokeStyle = `rgba(${accentRgb}, 0.85)`
    ctx.lineWidth = 2 * transform.k
    ctx.lineCap = 'round'
    ctx.stroke()

    // Header label — uppercase, letterspaced, warm-white low alpha.
    const fontPx = Math.max(9, Math.min(13, 11 * transform.k))
    ctx.font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = dayMode ? 'rgba(15, 23, 42, 0.6)' : 'rgba(245, 245, 247, 0.45)'
    const label = (g.label || '').toUpperCase()
    // Manual letterspacing (ctx.letterSpacing isn't universal).
    let lx = x + 26 * transform.k
    for (const ch of label) {
      ctx.fillText(ch, lx, y + 22 * transform.k)
      lx += ctx.measureText(ch).width + 1.2 * transform.k
    }
    // Count chip — mono, muted, right-aligned in the header.
    if (g.count != null) {
      ctx.font = `500 ${fontPx}px ui-monospace, 'SF Mono', Menlo, monospace`
      ctx.textAlign = 'right'
      ctx.fillStyle = dayMode ? 'rgba(15, 23, 42, 0.4)' : 'rgba(245, 245, 247, 0.32)'
      ctx.fillText(String(g.count), x + w - 14 * transform.k, y + 22 * transform.k)
    }
  }
  ctx.restore()
}

/**
 * Hub→voice connectors for the static layouts. Gentle quadratic curves whose
 * control point is pulled toward the hub's x (so lines fan out from the hub
 * like a family tree). Idle = very low alpha; the active node's line brightens.
 */
function drawStaticLinks(ctx, links, positions, transform, filteredSet, hoveredId, selectedId, hubIds, dayMode, nodeMap) {
  const activeId = hoveredId || selectedId
  // Hub screen x — the control-point anchor. Use the first hub.
  let hubX = null
  const firstHubId = hubIds.values().next().value
  for (const hid of hubIds) {
    const hp = positions[hid]
    if (hp) { hubX = hp.x * transform.k + transform.x; break }
  }

  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    if (!filteredSet.has(link.source) || !filteredSet.has(link.target)) continue
    const sp = positions[link.source]
    const tp = positions[link.target]
    if (!sp || !tp) continue

    const sx = sp.x * transform.k + transform.x
    const sy = sp.y * transform.k + transform.y
    const tx = tp.x * transform.k + transform.x
    const ty = tp.y * transform.k + transform.y

    const connected = activeId
      ? (link.source === activeId || link.target === activeId)
      : false

    // Curve control point: midpoint pulled horizontally toward the hub's x and
    // up toward the higher (hub) endpoint, giving a soft branching arc.
    const my = (sy + ty) / 2
    const cpx = hubX != null ? (hubX * 0.6 + (sx + tx) / 2 * 0.4) : (sx + tx) / 2
    const cpy = Math.min(sy, ty) + (my - Math.min(sy, ty)) * 0.4

    const mentionWeight = Math.min(1, Math.sqrt(link.tweetCount || 1) / 6)
    let alpha = connected ? 0.85 : (0.10 + 0.10 * mentionWeight)

    const nNode = nodeMap?.get(link.source === firstHubId ? link.target : link.source)
    const endColor = nNode ? hexToRgb(nodeColor(nNode)) : '148, 163, 184'
    const midRgb = dayMode ? '15, 23, 42' : '255, 255, 255'
    if (connected) {
      const grad = ctx.createLinearGradient(sx, sy, tx, ty)
      grad.addColorStop(0, `rgba(${midRgb}, ${(alpha * 0.9).toFixed(3)})`)
      grad.addColorStop(1, `rgba(${endColor}, ${(alpha * 0.85).toFixed(3)})`)
      ctx.strokeStyle = grad
    } else {
      ctx.strokeStyle = dayMode
        ? `rgba(15, 23, 42, ${alpha.toFixed(3)})`
        : `rgba(255, 255, 255, ${alpha.toFixed(3)})`
    }
    ctx.lineWidth = (connected ? 1.8 : 0.8) + mentionWeight * 0.9
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cpx, cpy, tx, ty)
    ctx.stroke()
  }
}

function drawFallbackLetter(ctx, x, y, radius, name, tierColor) {
  const letter = (name || '?')[0].toUpperCase()
  ctx.fillStyle = tierColor
  ctx.font = `600 ${Math.max(10, radius * 0.7)}px system-ui, -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, x, y)
}

// ── Cached node base-layers (shadow + aura + glass plate) ────────────────────
// These three radial gradients were re-allocated per node per frame — the
// dominant canvas GC/paint cost. They're identical for every idle dark-mode
// node of the same shape/kind/color/intensity, so we render them ONCE at a
// reference radius and scale-blit the sprite. Radial gradients + proportional
// offsets scale cleanly, so the sprite is visually identical to the live draw.
const SPRITE_REF_R = 40
const SPRITE_CACHE_MAX = 80
const nodeSpriteCache = new Map()

// The single source of truth for the dark base layers. Used both to build the
// sprite (at reference radius) and to draw active/dragging nodes live, so the
// cached and live paths can never visually diverge.
function paintDarkBase(ctx, cx, cy, r, type, isHub, isBridge, tierColor, mentionNorm) {
  // L1 — drop shadow.
  ctx.save()
  ctx.translate(0, r * 0.18)
  const shadow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.5)
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.42)')
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // L2 — outer chromatic aura.
  let auraInner, auraOuter, auraR
  if (isHub) {
    const intensity = 0.26 + mentionNorm * 0.18
    auraInner = `rgba(245, 245, 247, ${intensity.toFixed(3)})`
    auraOuter = `rgba(99, 102, 241, 0)`
    auraR = r * (2.6 + mentionNorm * 0.9)
  } else if (isBridge) {
    auraInner = `rgba(251, 191, 36, 0.55)`
    auraOuter = 'rgba(251, 191, 36, 0)'
    auraR = r * 2.4
  } else {
    const rgb = hexToRgb(tierColor)
    auraInner = `rgba(${rgb}, 0.22)`
    auraOuter = `rgba(${rgb}, 0)`
    auraR = r * 1.95
  }
  const aura = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, auraR)
  aura.addColorStop(0, auraInner)
  aura.addColorStop(1, auraOuter)
  ctx.fillStyle = aura
  ctx.beginPath()
  ctx.arc(cx, cy, auraR, 0, Math.PI * 2)
  ctx.fill()

  // L3 — solid backing + frosted glass plate.
  drawShape(ctx, type, cx, cy, r)
  ctx.fillStyle = 'rgba(20, 22, 32, 1)'
  ctx.fill()
  drawShape(ctx, type, cx, cy, r)
  const rgb = hexToRgb(tierColor)
  const plate = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.45, r * 0.05, cx, cy, r)
  plate.addColorStop(0, 'rgba(255, 255, 255, 0.32)')
  plate.addColorStop(0.35, 'rgba(255, 255, 255, 0.10)')
  plate.addColorStop(0.75, `rgba(${rgb}, 0.10)`)
  plate.addColorStop(1, `rgba(${rgb}, 0.18)`)
  ctx.fillStyle = plate
  ctx.fill()
}

// Get (or lazily build) the cached base-layer sprite for an idle dark node.
// Returns { canvas, pad, cssSize } — blit with drawImage scaled by radius/REF.
function getDarkNodeSprite(type, kind, colorKey, intB, dpr) {
  const key = `${type}|${kind}|${colorKey}|${intB}|${dpr}`
  const hit = nodeSpriteCache.get(key)
  if (hit) {
    // LRU touch: move to most-recently-used.
    nodeSpriteCache.delete(key)
    nodeSpriteCache.set(key, hit)
    return hit
  }
  if (typeof document === 'undefined') return null
  const isHub = kind === 'hub'
  const isBridge = kind === 'bridge'
  const mentionNorm = isHub ? intB / 2 : 0   // intB 0|1|2 → 0|0.5|1
  const r = SPRITE_REF_R
  // Aura is the largest extent (always >= the shadow's 1.68r), so it sets pad.
  const auraR = isHub ? r * (2.6 + mentionNorm * 0.9) : isBridge ? r * 2.4 : r * 1.95
  const pad = Math.ceil(auraR + 2)
  const cssSize = pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(cssSize * dpr)
  canvas.height = Math.ceil(cssSize * dpr)
  const sctx = canvas.getContext('2d')
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  paintDarkBase(sctx, pad, pad, r, type, isHub, isBridge, colorKey, mentionNorm)
  const entry = { canvas, pad, cssSize }
  nodeSpriteCache.set(key, entry)
  if (nodeSpriteCache.size > SPRITE_CACHE_MAX) {
    nodeSpriteCache.delete(nodeSpriteCache.keys().next().value)
  }
  return entry
}

function drawNode(ctx, node, pos, transform, hoveredId, selectedId, adjacency, needsRedraw, dayMode, focusModeActive, recentSet, viewMode, hubNodeIdsSet, draggingId, radiusScale = 1) {
  const x = pos.x * transform.k + transform.x
  const y = pos.y * transform.k + transform.y
  const baseRadius = getNodeRadius(node, radiusScale)
  let radius = baseRadius * transform.k
  const isHub = hubNodeIdsSet ? hubNodeIdsSet.has(node.id) : false
  const isBridge = (node.bridgeCount || 0) >= 2
  const isDragging = draggingId && node.id === draggingId

  // Cull off-screen nodes (account for the larger outer halo of hubs).
  const margin = radius + 60
  const dpr = window.devicePixelRatio || 1
  if (x < -margin || y < -margin || x > ctx.canvas.width / dpr + margin || y > ctx.canvas.height / dpr + margin) {
    return
  }

  const activeId = hoveredId || selectedId
  const isActive = node.id === activeId
  const isConnected = activeId ? adjacency.get(activeId)?.has(node.id) : false
  // No dimming. Hover/select brightens the active node and its edges; every
  // other bubble stays at full idle brightness. The user explicitly nuked
  // any visual "subtraction" on interaction.
  const prevAlpha = ctx.globalAlpha

  // Authenticity coloring: hubs by authenticity (organic→noisy), KOLs by
  // author class (official/commentator/promoter/media). Replaces the old
  // follower-tier colour. Size still comes from getNodeRadius (influence).
  const tierColor = nodeColor(node)
  const isPromoter = isPromoterNode(node)
  if (isActive) radius *= 1.12
  // Dragged bubble lifts off: bigger scale, drawn on its own pass so the
  // shadow + bright ring read above the field.
  if (isDragging) radius *= 1.2

  // Live time for breathing-glow animation.
  const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001

  // ═════════════════════════════════════════════════════════════════════
  //  Base layers — drop shadow + chromatic aura + frosted glass plate
  // ═════════════════════════════════════════════════════════════════════
  // Up to 3 createRadialGradient per node per frame was the dominant canvas
  // cost. Idle dark-mode nodes now blit a cached sprite (built once per
  // shape/kind/color/intensity via paintDarkBase, scaled to this radius).
  // Active/dragging draw live (radius is scaled); day mode draws live (one
  // cheap plate, no shadow/aura); tiny LOD KOL dots draw a flat disc.
  const mentionNorm = isHub ? Math.min(1, Math.sqrt(node.mentionCount || 0) / Math.sqrt(400)) : 0
  if (dayMode) {
    drawShape(ctx, node.type, x, y, radius)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    if (radius >= 8) {
      drawShape(ctx, node.type, x, y, radius)
      const plate = ctx.createRadialGradient(
        x - radius * 0.45, y - radius * 0.45, radius * 0.08, x, y, radius)
      plate.addColorStop(0, 'rgba(255, 255, 255, 1)')
      plate.addColorStop(1, 'rgba(240, 240, 245, 1)')
      ctx.fillStyle = plate
      ctx.fill()
    }
  } else if (radius < 8 && !isHub && !isBridge) {
    // LOD tiny KOL dot: flat backing only — fully covered by the tier disc
    // drawn for the avatar below, so shadow/aura/plate are imperceptible.
    drawShape(ctx, node.type, x, y, radius)
    ctx.fillStyle = 'rgba(20, 22, 32, 1)'
    ctx.fill()
  } else if (isActive || isDragging) {
    // Scaled radius — draw live so we don't pollute the cache with one-offs.
    paintDarkBase(ctx, x, y, radius, node.type, isHub, isBridge, tierColor, mentionNorm)
  } else {
    const kind = isHub ? 'hub' : (isBridge ? 'bridge' : 'kol')
    const intB = isHub ? Math.round(mentionNorm * 2) : 0
    const sprite = getDarkNodeSprite(node.type, kind, tierColor, intB, dpr)
    if (sprite) {
      const scale = radius / SPRITE_REF_R
      const dsize = sprite.cssSize * scale
      ctx.drawImage(sprite.canvas, x - sprite.pad * scale, y - sprite.pad * scale, dsize, dsize)
    } else {
      paintDarkBase(ctx, x, y, radius, node.type, isHub, isBridge, tierColor, mentionNorm)
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  L4 — RIM (authenticity-class outer border + 1px inner gloss line)
  //   Promoter: class-orange rim + a distinct dashed double ring (red flag)
  //   Bridge:   amber ring + brighter when active
  //   Hub:      crisp warm white
  //   KOL:      author-class color (official blue / commentator green / …)
  //   Promoter takes precedence over bridge — a paid amplifier is the signal
  //   we most want to surface even if it also bridges projects.
  // ═════════════════════════════════════════════════════════════════════
  const ringWidth = isHub ? 3 : (isPromoter ? 2.4 : (isBridge ? 2.4 : 1.8))
  let rimStroke
  if (isHub) {
    rimStroke = isActive
      ? (dayMode ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.98)')
      : (dayMode ? 'rgba(15, 23, 42, 0.5)' : 'rgba(255, 255, 255, 0.62)')
  } else if (isPromoter) {
    // Promoter rim uses the class-orange at full saturation so a paid-promoter
    // cluster reads hot. The dashed double ring below makes it unmistakable.
    const rgb = hexToRgb(tierColor)
    rimStroke = isActive ? `rgba(${rgb}, 1)` : `rgba(${rgb}, 0.92)`
  } else if (isBridge) {
    rimStroke = isActive ? 'rgba(251, 191, 36, 1)' : 'rgba(251, 191, 36, 0.88)'
  } else {
    const rgb = hexToRgb(tierColor)
    rimStroke = isActive
      ? (dayMode ? 'rgba(0,0,0,0.55)' : `rgba(${rgb}, 1)`)
      : (dayMode ? 'rgba(0,0,0,0.18)' : `rgba(${rgb}, 0.78)`)
  }
  drawShape(ctx, node.type, x, y, radius)
  ctx.strokeStyle = rimStroke
  ctx.lineWidth = ringWidth
  ctx.stroke()

  // Promoter red-flag treatment: a dashed ring sitting just OUTSIDE the solid
  // rim → a "double rim" that's instantly legible as a cluster of paid
  // amplifiers around a project, distinct from the bridge's solid amber ring.
  if (isPromoter) {
    const rgb = hexToRgb(tierColor)
    ctx.save()
    ctx.setLineDash([radius * 0.32, radius * 0.22])
    drawShape(ctx, node.type, x, y, radius + ringWidth * 1.6)
    ctx.strokeStyle = isActive ? `rgba(${rgb}, 0.95)` : `rgba(${rgb}, 0.7)`
    ctx.lineWidth = Math.max(1.2, ringWidth * 0.7)
    ctx.stroke()
    ctx.restore()
  }

  // Inner crisp gloss line — 1px white at 12%, sits just inside the rim
  // (dark mode only — a white hairline is invisible on the light canvas;
  // and on tiny LOD dots there's no room for it).
  if (!dayMode && radius >= 8) {
    drawShape(ctx, node.type, x, y, radius - ringWidth * 0.55)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // ═════════════════════════════════════════════════════════════════════
  //  L5 — HUB SATELLITE RING (orbital dots around project hubs)
  //   8 tiny dots rotating slowly around hub nodes — gives every project
  //   hub a distinct "centerpiece" treatment without crowding the canvas.
  // ═════════════════════════════════════════════════════════════════════
  if (isHub && !dayMode) {
    const satR = radius * 1.35
    const dotCount = 8
    const phase = tNow * 0.4
    for (let i = 0; i < dotCount; i++) {
      const ang = (Math.PI * 2 * i) / dotCount + phase
      const dx = x + Math.cos(ang) * satR
      const dy = y + Math.sin(ang) * satR
      // Alternate dot sizes for visual rhythm.
      const dotR = (i % 2 === 0 ? 1.6 : 0.9) * Math.max(0.5, transform.k)
      ctx.beginPath()
      ctx.arc(dx, dy, dotR, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${0.32 + 0.18 * Math.sin(phase * 2 + i)})`
      ctx.fill()
    }
  }

  // ── Avatar (clipped shape) ────────────────────────────────────────────
  const avatarRadius = radius - ringWidth - 1
  if (avatarRadius > 5) {
    const img = getCachedImage(node.avatar, needsRedraw)
    if (img) {
      ctx.save()
      drawShape(ctx, node.type, x, y, avatarRadius)
      ctx.clip()
      ctx.drawImage(img, x - avatarRadius, y - avatarRadius, avatarRadius * 2, avatarRadius * 2)
      ctx.restore()
    } else {
      // Tier-tinted disc + letter so loading bubbles aren't dark holes.
      drawShape(ctx, node.type, x, y, avatarRadius)
      ctx.fillStyle = tierColor + '22'
      ctx.fill()
      drawFallbackLetter(ctx, x, y, avatarRadius, node.name, tierColor)
    }
  } else {
    // Too small for avatar
    drawShape(ctx, node.type, x, y, radius - 1)
    ctx.fillStyle = tierColor + '40'
    ctx.fill()
  }

  // ── Recent activity indicator (small green dot, top-left) ──────────────
  if (recentSet && recentSet.has(node.id)) {
    const dotR = Math.max(2.5, radius * 0.1)
    const dotX = x - radius * 0.65
    const dotY = y - radius * 0.65
    ctx.beginPath()
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
    ctx.fillStyle = '#10B981'
    ctx.fill()
  }

  // ── Drag accent (held bubble) ────────────────────────────────────────
  // Two-stop treatment: a soft outer halo so the bubble visibly lifts off
  // the field, plus a crisp 2px ring on the edge so the cursor feels
  // "stuck" to it. Pulses subtly via tNow so a stationary held bubble
  // still reads as live.
  if (isDragging) {
    const pulse = 0.5 + 0.5 * Math.sin(tNow * 4)
    const haloR = radius * (1.45 + 0.05 * pulse)
    const halo = ctx.createRadialGradient(x, y, radius * 0.95, x, y, haloR)
    halo.addColorStop(0, `rgba(255, 255, 255, ${0.18 + 0.08 * pulse})`)
    halo.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(x, y, haloR, 0, Math.PI * 2)
    ctx.fill()

    drawShape(ctx, node.type, x, y, radius + 2)
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.65 + 0.15 * pulse})`
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // Restore alpha
  ctx.globalAlpha = prevAlpha
}

function drawLabels(ctx, nodes, positions, transform, filteredSet, dayMode, hoveredId, selectedId, adjacency, viewMode, radiusScale = 1) {
  const color = dayMode ? 'rgba(15,23,42,0.8)' : 'rgba(245,245,247,0.8)'
  const heroColor = dayMode ? 'rgba(15,23,42,0.95)' : 'rgba(245,245,247,0.95)'

  // Sort nodes by followers to determine top-15 heroes
  // Cache key: avoid re-sorting on every frame when node set hasn't changed
  const cacheKey = nodes.length + '-' + filteredSet.size
  if (!drawLabels._cache || drawLabels._cacheKey !== cacheKey) {
    drawLabels._cacheKey = cacheKey
    drawLabels._cache = [...nodes]
      .filter(n => filteredSet.has(n.id))
      .sort((a, b) => b.followers - a.followers)
    drawLabels._top15 = new Set(drawLabels._cache.slice(0, 15).map(n => n.id))
  }
  const sortedByInfluence = drawLabels._cache
  const top15 = drawLabels._top15

  // Collect label rects for collision avoidance
  const placed = []

  // Draw hero labels first (top 15), then others
  for (const node of sortedByInfluence) {
    if (!filteredSet.has(node.id)) continue
    const pos = positions[node.id]
    if (!pos) continue

    const radius = getNodeRadius(node, radiusScale) * transform.k
    const isHero = top15.has(node.id)
    const isHovered = node.id === hoveredId
    const isSelected = node.id === selectedId
    const activeId = hoveredId || selectedId
    const isConnected = activeId ? adjacency.get(activeId)?.has(node.id) : false

    // Visibility rules
    if (viewMode !== 'constellation') {
      if (!isHero && !isHovered && !isSelected && !isConnected && radius < 22) continue
    }

    const x = pos.x * transform.k + transform.x
    const y = pos.y * transform.k + transform.y

    const fontSize = isHero ? Math.max(11, Math.min(14, radius * 0.3)) : Math.max(9, Math.min(12, radius * 0.3))
    const fontWeight = isHero ? '600' : '500'

    // Label rect for collision check
    ctx.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, sans-serif`
    const textWidth = ctx.measureText(node.name).width
    const labelY = y + radius + 8
    const labelRect = { x: x - textWidth / 2 - 2, y: labelY - fontSize / 2, w: textWidth + 4, h: fontSize + 4 }

    // Collision check (skip if overlaps a higher-priority label)
    const overlaps = placed.some(p =>
      labelRect.x < p.x + p.w && labelRect.x + labelRect.w > p.x &&
      labelRect.y < p.y + p.h && labelRect.y + labelRect.h > p.y
    )
    if (overlaps && !isHero && !isHovered && !isSelected) continue

    placed.push(labelRect)

    // Draw text shadow for readability
    if (!dayMode) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillText(node.name, x + 0.5, labelY + 0.5)
    }

    ctx.fillStyle = isHero ? heroColor : color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(node.name, x, labelY)
  }
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function GraphCanvas({
  nodes,
  links,
  positions,
  livePositionsRef = null,
  radiusScale = 1,
  transformRef = null,
  hoveredNodeId,
  selectedNodeId,
  draggingNodeId = null,
  adjacency,
  dayMode,
  filteredNodeIds,
  canvasRef,
  nodeMap,
  focusMode,
  recentNodeIds,
  viewMode = 'default',
  showConnections,
  hubNodeIds,
  bridgeArcs = null,
  isCrawl = false,
  layoutGroups = null,
  staticLayout = false,
}) {
  // Two SEPARATE rAF handles so the continuous loop and any on-demand redraw
  // never null each other's ref (the old shared `rafRef` caused two draws to
  // interleave per frame → ~200 draws/sec at idle instead of the 30fps cap).
  const loopRafRef = useRef(null)   // owned by the continuous animation loop
  const redrawRafRef = useRef(null) // owned by the on-demand redraw (avatar load)
  const loopRunningRef = useRef(false)
  const starsRef = useRef(null)
  // Offscreen background layer — repainted only when size/day-mode/parallax
  // bucket changes, blitted per frame (see the background block in draw()).
  const bgCacheRef = useRef(null)
  // Cached canvas size (width/height only — draw() never reads left/top). A
  // ResizeObserver keeps it fresh so the draw loop doesn't force a layout
  // reflow via getBoundingClientRect() on every frame.
  const rectRef = useRef(null)

  // Build a Set from filteredNodeIds for O(1) lookups. Only rebuild when the
  // array identity actually changes — otherwise an unrelated re-render (e.g. a
  // hover tick) would re-allocate a Set over every node each render.
  const filteredSetRef = useRef(new Set())
  const filteredIdsRef = useRef(null)
  if (filteredIdsRef.current !== filteredNodeIds) {
    filteredIdsRef.current = filteredNodeIds
    filteredSetRef.current = new Set(filteredNodeIds)
  }

  // Store latest props in refs so the draw loop always reads fresh values
  // without needing to re-create the rAF callback
  const propsRef = useRef({})
  propsRef.current = {
    nodes,
    links,
    positions,
    livePositionsRef,
    radiusScale,
    hoveredNodeId,
    selectedNodeId,
    draggingNodeId,
    adjacency,
    dayMode,
    nodeMap,
    focusMode,
    recentNodeIds,
    viewMode,
    showConnections,
    bridgeArcs,
    isCrawl,
    hubNodeIds,
    layoutGroups,
    staticLayout,
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const rect = rectRef.current || canvas.getBoundingClientRect()
    // DPR cap: retina 2x on a full-viewport canvas = 4x the pixels for a
    // soft glow-field + thin lines that read identically at 1.5 (the same
    // cap the cosmos engine runs). Biggest single fill-cost win.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

    // Resize canvas for high-DPI
    const cw = rect.width
    const ch = rect.height

    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr
      canvas.height = ch * dpr
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const {
      nodes: n,
      links: l,
      positions: pState,
      livePositionsRef: pRef,
      radiusScale: rs,
      hoveredNodeId: hId,
      selectedNodeId: sId,
      draggingNodeId: dId,
      adjacency: adj,
      dayMode: dm,
      nodeMap: nm,
      focusMode: fm,
      recentNodeIds: rn,
      viewMode: vm,
      showConnections: sc,
      bridgeArcs: arcs,
      isCrawl: crawl,
      hubNodeIds: hubIds,
      layoutGroups: lgroups,
      staticLayout: staticL,
    } = propsRef.current
    // Read hub set from the ref each frame - the outer HUB_NODE_IDS was captured
    // by this stable (deps []) draw closure at mount when the set was still empty,
    // so hub styling (aura/rim/satellites) never fired once data loaded.
    const HUB_IDS = hubIds || new Set()
    // Live ref carries the latest tick from d3-force without going through
    // React state. Falls back to the React prop on the first frame before
    // the ref is populated.
    const p = (pRef && pRef.current) || pState

    // Pan/zoom comes straight from the interaction ref (no React state), so a
    // pan/zoom gesture never re-renders this component — the loop just reads
    // the latest transform each frame.
    const t = (transformRef && transformRef.current) || { x: 0, y: 0, k: 1 }

    const filteredSet = filteredSetRef.current

    // ── Premium layered background (CACHED offscreen) ──────────────────
    // 5 full-canvas gradient fills + ~175 star arcs were repainted every
    // frame at 30fps although nothing about them changes except canvas
    // size, day mode and the pan parallax. The layers render ONCE into an
    // offscreen canvas keyed by those inputs (parallax quantized to 24px
    // buckets — at the 0.2-0.25 factor that's imperceptible) and blit in a
    // single drawImage per frame.
    const qx = Math.round((t.x * 0.25) / 24) * 24
    const qy = Math.round((t.y * 0.25) / 24) * 24
    const bgKey = `${cw}x${ch}|${dm ? 'd' : 'n'}|${qx}|${qy}|${dpr}`
    let bg = bgCacheRef.current
    if (!bg || bg.key !== bgKey) {
      const layer = bg?.canvas || document.createElement('canvas')
      layer.width = Math.max(1, Math.round(cw * dpr))
      layer.height = Math.max(1, Math.round(ch * dpr))
      const bctx = layer.getContext('2d')
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (dm) {
        // Base matches the day shell (#f5f5f7) so the page never shows a
        // rectangular tint-cut at the glass panel edges (same seam class as
        // night mode's navy base).
        bctx.fillStyle = '#f5f5f7'
        bctx.fillRect(0, 0, cw, ch)
        const dgrad = bctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.55)
        dgrad.addColorStop(0, 'rgba(250, 240, 220, 0.50)')
        dgrad.addColorStop(0.6, 'rgba(245, 245, 247, 0)')
        bctx.fillStyle = dgrad
        bctx.fillRect(0, 0, cw, ch)
        // Edge fade back to the shell color (mirrors the night-mode L6 pass).
        const fadeD = Math.min(150, cw * 0.1, ch * 0.16)
        const edgesD = [
          bctx.createLinearGradient(0, 0, 0, fadeD),
          bctx.createLinearGradient(0, ch, 0, ch - fadeD),
          bctx.createLinearGradient(0, 0, fadeD, 0),
          bctx.createLinearGradient(cw, 0, cw - fadeD, 0),
        ]
        const rectsD = [
          [0, 0, cw, fadeD],
          [0, ch - fadeD, cw, fadeD],
          [0, 0, fadeD, ch],
          [cw - fadeD, 0, fadeD, ch],
        ]
        for (let i = 0; i < edgesD.length; i++) {
          edgesD[i].addColorStop(0, 'rgba(245, 245, 247, 1)')
          edgesD[i].addColorStop(1, 'rgba(245, 245, 247, 0)')
          bctx.fillStyle = edgesD[i]
          bctx.fillRect(...rectsD[i])
        }
      } else {
        // L0 — base matches the app void (--bg-void #09090b) EXACTLY. A navier
        // base read as a visible rectangular "cut" against the shell behind
        // the glass header/panels — the page background must be seamless.
        bctx.fillStyle = '#09090b'
        bctx.fillRect(0, 0, cw, ch)

        // L1 — diagonal depth tilt, but ZEROED at the actual corners/edges:
        // corner-anchored alpha (indigo 0.45 at 0%) was the other half of the
        // background cut — it got crushed under the glass panels into a hard
        // step at their edges. The tilt now breathes mid-canvas only.
        const tilt = bctx.createLinearGradient(0, 0, cw, ch)
        tilt.addColorStop(0, 'rgba(28, 24, 56, 0)')
        tilt.addColorStop(0.18, 'rgba(28, 24, 56, 0.28)')
        tilt.addColorStop(0.5, 'rgba(14, 14, 24, 0)')
        tilt.addColorStop(0.85, 'rgba(48, 28, 22, 0.13)')
        tilt.addColorStop(1, 'rgba(48, 28, 22, 0)')
        bctx.fillStyle = tilt
        bctx.fillRect(0, 0, cw, ch)

        // L2 — main chromatic glow centered on the graph.
        const gcx = cw / 2 + qx
        const gcy = ch / 2 + qy
        const glowR = Math.min(cw, ch) * 0.50
        const glow = bctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, glowR)
        glow.addColorStop(0,   'rgba(99, 102, 241, 0.20)')
        glow.addColorStop(0.35,'rgba(126, 87, 194, 0.08)')
        glow.addColorStop(1,   'rgba(10, 12, 20, 0)')
        bctx.fillStyle = glow
        bctx.fillRect(0, 0, cw, ch)

        // L3 — asymmetric amber glow top-right (~25% of viewport).
        const wcx = cw * 0.78 + qx * 0.8
        const wcy = ch * 0.28 + qy * 0.8
        const warmR = Math.min(cw, ch) * 0.32
        const warm = bctx.createRadialGradient(wcx, wcy, 0, wcx, wcy, warmR)
        warm.addColorStop(0,   'rgba(251, 191, 36, 0.07)')
        warm.addColorStop(0.5, 'rgba(167, 139, 250, 0.03)')
        warm.addColorStop(1,   'rgba(10, 12, 20, 0)')
        bctx.fillStyle = warm
        bctx.fillRect(0, 0, cw, ch)

        // L4 — second cool glow bottom-left for balance.
        const ccx = cw * 0.22 + qx * 0.8
        const ccy = ch * 0.78 + qy * 0.8
        const coolR = Math.min(cw, ch) * 0.30
        const cool = bctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, coolR)
        cool.addColorStop(0,   'rgba(76, 194, 228, 0.05)')   // cyan whisper
        cool.addColorStop(1,   'rgba(10, 12, 20, 0)')
        bctx.fillStyle = cool
        bctx.fillRect(0, 0, cw, ch)

        // L5 — STATIC pseudo-random starfield. Deterministic PRNG so it
        // doesn't twinkle (the user explicitly nuked anything that reads
        // as "space"). Just adds texture — no motion, no dim.
        if (!starsRef.current || starsRef.current.w !== cw || starsRef.current.h !== ch) {
          const seedStars = []
          // Deterministic LCG so the starfield is stable across redraws.
          let seed = 1234
          const rand = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
          }
          const count = Math.round((cw * ch) / 8200)
          for (let i = 0; i < count; i++) {
            seedStars.push({
              x: rand() * cw,
              y: rand() * ch,
              r: 0.5 + rand() * 0.9,
              a: 0.08 + rand() * 0.22,
            })
          }
          starsRef.current = { w: cw, h: ch, stars: seedStars }
        }
        const stars = starsRef.current.stars
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i]
          bctx.beginPath()
          bctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
          bctx.fillStyle = `rgba(245, 245, 247, ${s.a.toFixed(3)})`
          bctx.fill()
        }

        // L6 — edge fade to void. Whatever the layers above do mid-canvas,
        // the outer band returns to exactly #09090b so the glass header /
        // filter panel / sidebar never crush a tinted background into a
        // visible seam at their edges. Cached, zero per-frame cost.
        const fade = Math.min(150, cw * 0.1, ch * 0.16)
        const edges = [
          bctx.createLinearGradient(0, 0, 0, fade),          // top
          bctx.createLinearGradient(0, ch, 0, ch - fade),    // bottom
          bctx.createLinearGradient(0, 0, fade, 0),          // left
          bctx.createLinearGradient(cw, 0, cw - fade, 0),    // right
        ]
        const rects = [
          [0, 0, cw, fade],
          [0, ch - fade, cw, fade],
          [0, 0, fade, ch],
          [cw - fade, 0, fade, ch],
        ]
        for (let i = 0; i < edges.length; i++) {
          edges[i].addColorStop(0, 'rgba(9, 9, 11, 1)')
          edges[i].addColorStop(1, 'rgba(9, 9, 11, 0)')
          bctx.fillStyle = edges[i]
          bctx.fillRect(...rects[i])
        }
      }

      bg = { canvas: layer, key: bgKey }
      bgCacheRef.current = bg
    }
    ctx.drawImage(bg.canvas, 0, 0, cw, ch)

    if (!dm) {
      // L6 — concentric orbit guides. Three rings, very low alpha, dashed.
      const ocx = cw / 2 + t.x * 0.5
      const ocy = ch / 2 + t.y * 0.5
      const baseR = Math.min(cw, ch)
      const ringRadii = [0.18, 0.32, 0.46]
      ctx.save()
      ctx.setLineDash([2, 6])
      ctx.lineWidth = 1
      for (let i = 0; i < ringRadii.length; i++) {
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.06 + (2 - i) * 0.02})`
        ctx.beginPath()
        ctx.arc(ocx, ocy, baseR * ringRadii[i] * t.k, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    // (Grid removed — flat background only, less visual noise.)

    // (Orbital rings removed — background handled by AmbientGlow component)

    // ── Constellation stars (twinkling background) ───────────────────
    if (vm === 'constellation' && !dm) {
      const now = Date.now()
      for (let i = 0; i < 30; i++) {
        // Deterministic positions seeded by index
        const sx = ((i * 137.508) % cw)
        const sy = ((i * 97.31 + 50) % ch)
        const twinkle = 0.15 + Math.sin(now * 0.001 + i * 2.1) * 0.12
        ctx.beginPath()
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(245,245,247,${twinkle})`
        ctx.fill()
      }
    }

    // ── Heatmap blobs (thermal gradient per node by connection density)
    if (vm === 'heatmap' && !dm) {
      for (let i = 0; i < n.length; i++) {
        const node = n[i]
        if (!filteredSet.has(node.id)) continue
        const pos = p[node.id]
        if (!pos) continue

        const neighbors = adj.get(node.id)
        const connCount = neighbors ? neighbors.size : 0
        if (connCount < 5) continue

        const nx = pos.x * t.k + t.x
        const ny = pos.y * t.k + t.y

        let heatColor, heatRadius
        if (connCount >= 20) {
          heatColor = 'rgba(239,68,68,0.08)'
          heatRadius = 100 * t.k
        } else if (connCount >= 10) {
          heatColor = 'rgba(245,158,11,0.06)'
          heatRadius = 80 * t.k
        } else {
          heatColor = 'rgba(59,130,246,0.04)'
          heatRadius = 60 * t.k
        }

        const hGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, heatRadius)
        hGrad.addColorStop(0, heatColor)
        hGrad.addColorStop(1, 'transparent')
        ctx.fillStyle = hGrad
        ctx.beginPath()
        ctx.arc(nx, ny, heatRadius, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // ── Compartment boundaries + group labels (static layouts) ─────────
    // Drawn beneath links + nodes so the voices sit inside their groups.
    if (staticL && lgroups && lgroups.length) {
      drawCompartments(ctx, lgroups, t, dm)
    }

    // ── Links ──────────────────────────────────────────────────────────
    if (sc !== false && staticL) {
      // Static layout: gentle hub→voice curves, no flow particles / heatmap.
      drawStaticLinks(ctx, l, p, t, filteredSet, hId, sId, HUB_IDS, dm, nm)
    } else if (sc !== false) {
      if (vm === 'constellation') {
        // Constellation mode: thin bright white lines
        for (let i = 0; i < l.length; i++) {
          const link = l[i]
          if (!filteredSet.has(link.source) || !filteredSet.has(link.target)) continue
          const sp = p[link.source]
          const tp = p[link.target]
          if (!sp || !tp) continue
          const sx = sp.x * t.k + t.x
          const sy = sp.y * t.k + t.y
          const tx = tp.x * t.k + t.x
          const ty = tp.y * t.k + t.y

          const activeId = hId || sId
          let alpha = 0.15
          if (activeId) {
            const connected = link.source === activeId || link.target === activeId
            alpha = connected ? 0.5 : 0.04
          }

          // Constellation strokes default to warm-white; flip to slate in
          // day mode so the lines stay visible against the light backdrop.
          ctx.strokeStyle = dm ? `rgba(15,23,42,${alpha})` : `rgba(245,245,247,${alpha})`
          ctx.lineWidth = 0.5
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(tx, ty)
          ctx.stroke()
        }
      } else {
        drawLinks(ctx, l, p, t, filteredSet, hId, sId, adj, dm, nm, fm)
      }
    }

    // ── Inter-project bridge arcs (crawl mode galaxy of connections) ──
    if (crawl && arcs && arcs.length) {
      drawBridgeArcs(ctx, arcs, p, t, hId, sId, adj, dm)
    }

    // ── Nodes ──────────────────────────────────────────────────────────
    // The continuous `loop` (below) is the SINGLE source of draw() calls and
    // always animates (satellite rings / flow particles / drag pulse read
    // performance.now()), so an avatar that finishes loading will be painted
    // on the very next throttled frame — no extra draw needed. This callback
    // therefore only re-arms the loop in the rare case it was stopped (tab
    // hidden), preserving the 33ms throttle for ALL draws.
    const needsRedraw = () => {
      if (loopRunningRef.current && loopRafRef.current == null &&
          !(typeof document !== 'undefined' && document.hidden)) {
        loopRafRef.current = requestAnimationFrame(loopRef.current)
      }
    }

    for (let i = 0; i < n.length; i++) {
      const node = n[i]
      if (!filteredSet.has(node.id)) continue
      const pos = p[node.id]
      if (!pos) continue
      drawNode(ctx, node, pos, t, hId, sId, adj, needsRedraw, dm, fm, rn, vm, HUB_IDS, dId, rs)
    }

    // ── Labels ─────────────────────────────────────────────────────────
    drawLabels(ctx, n, p, t, filteredSet, dm, hId, sId, adj, vm, rs)
  }, [])

  // Keep the cached canvas rect fresh without forcing a per-frame reflow.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const update = () => { rectRef.current = canvas.getBoundingClientRect() }
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(canvas)
    window.addEventListener('resize', update)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [canvasRef])

  // Holds the latest `loop` function so the (empty-deps) `needsRedraw` closure
  // inside draw() can re-arm the loop without recreating the draw callback.
  const loopRef = useRef(null)

  // Continuous animation loop for hub node effects (pulsing ring, breathing glow)
  // Idle = ~30 FPS to save CPU. During an active drag we run at native rate
  // so the held bubble tracks the cursor 1:1. This is the SINGLE source of
  // draw() calls — the throttle applies to every frame.
  useEffect(() => {
    loopRunningRef.current = true
    let lastFrameTime = 0
    const IDLE_INTERVAL = 33  // ~30 FPS
    const DRAG_INTERVAL = 0   // uncapped (~60 FPS via rAF)
    function loop(timestamp) {
      if (!loopRunningRef.current) return
      // Visibility guard: pause rAF loop when tab is hidden
      if (typeof document !== 'undefined' && document.hidden) {
        loopRafRef.current = null
        return
      }
      const interval = propsRef.current.draggingNodeId ? DRAG_INTERVAL : IDLE_INTERVAL
      if (timestamp - lastFrameTime >= interval) {
        lastFrameTime = timestamp
        draw()
      }
      loopRafRef.current = requestAnimationFrame(loop)
    }
    loopRef.current = loop
    loopRafRef.current = requestAnimationFrame(loop)
    // Resume rAF loop when tab becomes visible again
    const onVis = () => {
      if (!document.hidden && loopRunningRef.current && loopRafRef.current == null) {
        loopRafRef.current = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      loopRunningRef.current = false
      document.removeEventListener('visibilitychange', onVis)
      if (loopRafRef.current) {
        cancelAnimationFrame(loopRafRef.current)
        loopRafRef.current = null
      }
      if (redrawRafRef.current) {
        cancelAnimationFrame(redrawRafRef.current)
        redrawRafRef.current = null
      }
    }
  }, [draw])

  // This component drives drawing onto the canvas provided via canvasRef.
  // It renders nothing to the DOM — the parent owns the <canvas> element.
  return null
}
