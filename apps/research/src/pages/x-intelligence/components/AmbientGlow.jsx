/**
 * AmbientGlow — Neural web background for X Intelligence.
 *
 * Generates a Voronoi-like neural network with glowing nodes connected by
 * luminous filaments. Subtle animation: nodes drift slowly, connections
 * pulse with varying brightness, cursor proximity brightens nearby nodes.
 */
import { useRef, useEffect } from 'react'

// ── Node generation ─────────────────────────────────────────────────────────

function createNodes(count, w, h) {
  const nodes = []
  for (let i = 0; i < count; i++) {
    nodes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      radius: 1.2 + Math.random() * 2,
      brightness: 0.4 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
    })
  }
  return nodes
}

// ── Connection builder (Delaunay-like nearest neighbors) ────────────────────

function buildConnections(nodes, maxDist) {
  const connections = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x
      const dy = nodes[i].y - nodes[j].y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < maxDist) {
        connections.push({ a: i, b: j, dist })
      }
    }
  }
  return connections
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function AmbientGlow({ dayMode }) {
  const canvasRef = useRef(null)
  const stateRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr

    const nodeCount = Math.round((w * h) / 8000) // density scales with viewport
    const maxConnectionDist = Math.min(w, h) * 0.18

    const nodes = createNodes(nodeCount, w, h)
    const pointer = { x: w / 2, y: h / 2, active: false }

    let connections = buildConnections(nodes, maxConnectionDist)
    let time = 0
    let running = true
    let rebuildTimer = 0
    let lastFrameTime = 0
    const FRAME_INTERVAL = 50 // ~20 FPS - ambient background doesn't need more

    const handleMouseMove = (e) => {
      const r = canvas.getBoundingClientRect()
      pointer.x = e.clientX - r.left
      pointer.y = e.clientY - r.top
      pointer.active = true
    }
    const handleMouseLeave = () => { pointer.active = false }

    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    function draw(timestamp) {
      if (!running) return

      // perf: skip all canvas work when the tab is hidden - this ambient loop
      // otherwise keeps clearing + redrawing the full canvas in background tabs.
      if (document.hidden) {
        requestAnimationFrame(draw)
        return
      }

      // Throttle frame rate
      if (timestamp - lastFrameTime < FRAME_INTERVAL) {
        requestAnimationFrame(draw)
        return
      }
      lastFrameTime = timestamp

      // Resize check
      const rect = canvas.getBoundingClientRect()
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr
        canvas.height = rect.height * dpr
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      time += 0.003

      const cw = rect.width
      const ch = rect.height

      // Clear
      ctx.clearRect(0, 0, cw, ch)

      if (dayMode) {
        drawDayMode(ctx, nodes, connections, cw, ch, time)
      } else {
        drawDarkMode(ctx, nodes, connections, cw, ch, time, pointer)
      }

      // Move nodes (slow drift)
      for (const node of nodes) {
        node.x += node.vx
        node.y += node.vy

        if (node.x < -20) node.vx = Math.abs(node.vx)
        if (node.x > cw + 20) node.vx = -Math.abs(node.vx)
        if (node.y < -20) node.vy = Math.abs(node.vy)
        if (node.y > ch + 20) node.vy = -Math.abs(node.vy)
      }

      // Rebuild connections less frequently (nodes drift slowly)
      rebuildTimer++
      if (rebuildTimer > 400) {
        connections = buildConnections(nodes, maxConnectionDist)
        rebuildTimer = 0
      }

      requestAnimationFrame(draw)
    }

    requestAnimationFrame(draw)

    return () => {
      running = false
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [dayMode])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    />
  )
}

// ── Dark mode renderer ──────────────────────────────────────────────────────

function drawDarkMode(ctx, nodes, connections, w, h, time, pointer) {
  // Background radial gradient - deep space
  const cx = w * 0.5
  const cy = h * 0.45
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7)
  bgGrad.addColorStop(0, 'rgba(15, 20, 30, 0.3)')
  bgGrad.addColorStop(0.5, 'rgba(8, 10, 18, 0.15)')
  bgGrad.addColorStop(1, 'transparent')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, w, h)

  // Draw connections (luminous filaments)
  for (const conn of connections) {
    const a = nodes[conn.a]
    const b = nodes[conn.b]
    const distRatio = 1 - conn.dist / (Math.min(w, h) * 0.18)

    // Pulsing brightness per connection
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.5 + conn.a * 0.3 + conn.b * 0.2)
    const baseAlpha = distRatio * 0.12 * pulse

    if (baseAlpha < 0.005) continue

    // Cursor proximity boost
    let cursorBoost = 0
    if (pointer.active) {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const cd = Math.sqrt((pointer.x - mx) ** 2 + (pointer.y - my) ** 2)
      cursorBoost = Math.max(0, 1 - cd / 250) * 0.15
    }

    const alpha = Math.min(0.35, baseAlpha + cursorBoost)

    // Main filament
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = `rgba(200, 215, 240, ${alpha})`
    ctx.lineWidth = 0.5 + distRatio * 0.8
    ctx.stroke()

    // Glow pass (wider, fainter)
    if (alpha > 0.06) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = `rgba(180, 200, 235, ${alpha * 0.3})`
      ctx.lineWidth = 2 + distRatio * 3
      ctx.stroke()
    }

    // Extra bloom on strong connections
    if (alpha > 0.12) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = `rgba(160, 190, 230, ${alpha * 0.12})`
      ctx.lineWidth = 6 + distRatio * 6
      ctx.stroke()
    }
  }

  // Draw nodes (glowing points)
  for (const node of nodes) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 2 + node.phase)
    const nodeBrightness = node.brightness * pulse

    // Cursor proximity
    let cursorBoost = 0
    if (pointer.active) {
      const cd = Math.sqrt((pointer.x - node.x) ** 2 + (pointer.y - node.y) ** 2)
      cursorBoost = Math.max(0, 1 - cd / 200) * 0.5
    }

    const totalBright = Math.min(1, nodeBrightness + cursorBoost)

    // Outer glow
    const glowR = node.radius * (4 + totalBright * 6)
    const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR)
    glow.addColorStop(0, `rgba(220, 230, 245, ${totalBright * 0.15})`)
    glow.addColorStop(0.3, `rgba(180, 200, 235, ${totalBright * 0.06})`)
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2)
    ctx.fill()

    // Core dot
    ctx.beginPath()
    ctx.arc(node.x, node.y, node.radius * (0.8 + totalBright * 0.4), 0, Math.PI * 2)
    ctx.fillStyle = `rgba(235, 240, 250, ${totalBright * 0.7})`
    ctx.fill()

    // Bright center
    ctx.beginPath()
    ctx.arc(node.x, node.y, node.radius * 0.4, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${totalBright * 0.9})`
    ctx.fill()
  }
}

// ── Day mode renderer ───────────────────────────────────────────────────────

function drawDayMode(ctx, nodes, connections, w, h, time) {
  for (const conn of connections) {
    const a = nodes[conn.a]
    const b = nodes[conn.b]
    const distRatio = 1 - conn.dist / (Math.min(w, h) * 0.18)
    const alpha = distRatio * 0.03

    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`
    ctx.lineWidth = 0.3 + distRatio * 0.3
    ctx.stroke()
  }

  for (const node of nodes) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, node.radius * 0.6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)'
    ctx.fill()
  }
}
