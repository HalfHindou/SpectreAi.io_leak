import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { NODES } from './data/mock-nodes'
import { EDGES } from './data/mock-edges'
import { SECTORS } from './data/sectors'

/**
 * ConnectionProtocol - Bubblemaps V2 premium neon visualization.
 * Deep black canvas (#04040B) with vibrant neon-bordered bubbles,
 * glow effects, physics-driven floating, left filter sidebar,
 * right detail panel, and glass overlay UI.
 */

const TIER_COLORS = { S: '#EF4444', A: '#F59E0B', B: '#3B82F6', C: '#6B7280' }
const TIER_LABELS = { S: 'Legendary', A: 'Elite', B: 'Notable', C: 'Emerging' }
const BG = '#04040B'

// Precompute adjacency map for fast neighbor lookups
const ADJ = (() => {
  const m = new Map()
  EDGES.forEach(([a, b]) => {
    if (!m.has(a)) m.set(a, new Set())
    if (!m.has(b)) m.set(b, new Set())
    m.get(a).add(b)
    m.get(b).add(a)
  })
  return m
})()

function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

function formatFollowers(f) {
  if (!f || f === '--') return '--'
  const s = String(f).replace(/,/g, '')
  const n = parseFloat(s)
  if (isNaN(n)) return f
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K'
  return String(n)
}

// Inline SVG icons for the filter sidebar - avoids spectreIcons import
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
)

const NodeIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
)

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export default function ConnectionProtocol({ activeSector, onSectorChange }) {
  const canvasRef = useRef(null)
  const nodesRef = useRef([])
  const hovRef = useRef(null)
  const dragRef = useRef(null)
  const dragStartRef = useRef(null)
  const mouseRef = useRef({ x: 0, y: 0 })
  const frameRef = useRef(null)
  const timeRef = useRef(0)

  const [tooltip, setTooltip] = useState(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('all')
  const [selectedNode, setSelectedNode] = useState(null)

  // Filtered node set
  const filtered = useMemo(() => {
    return NODES.filter((n) => {
      if (search) {
        const q = search.toLowerCase()
        const matchLabel = n.label.toLowerCase().includes(q)
        const matchSub = (n.sub || '').toLowerCase().includes(q)
        const matchHandle = (n.handle || '').toLowerCase().includes(q)
        if (!matchLabel && !matchSub && !matchHandle) return false
      }
      if (activeSector && n.sector !== activeSector) return false
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      if (tierFilter !== 'all' && n.tier !== tierFilter) return false
      return true
    })
  }, [search, activeSector, typeFilter, tierFilter])

  const filteredIds = useMemo(() => new Set(filtered.map(n => n.id)), [filtered])

  // Sorted nodes for the sidebar list
  const sortedNodes = useMemo(() => {
    const tierOrder = { S: 0, A: 1, B: 2, C: 3 }
    return [...filtered].sort((a, b) => (tierOrder[a.tier] || 3) - (tierOrder[b.tier] || 3))
  }, [filtered])

  // Stats
  const totalNodes = NODES.length
  const totalEdges = EDGES.length
  const visibleNodes = filtered.length

  // Selected node data
  const selectedData = selectedNode ? NODES.find(n => n.id === selectedNode) : null
  const selectedConnections = selectedNode ? (ADJ.get(selectedNode)?.size || 0) : 0
  const selectedMentions = useMemo(() => {
    if (!selectedNode) return []
    const neighbors = ADJ.get(selectedNode)
    if (!neighbors) return []
    return NODES.filter(n => neighbors.has(n.id))
  }, [selectedNode])

  // Initialize physics positions
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const W = c.clientWidth
    const H = c.clientHeight
    nodesRef.current = NODES.map(n => ({
      ...n,
      px: n.x * W,
      py: n.y * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      phase: Math.random() * Math.PI * 2,
    }))
  }, [])

  // Canvas render loop
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    const isMobileView = typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(max-width: 768px)').matches
    const FRAME_MS = isMobileView ? 1000 / 30 : 0
    let lastFrame = 0

    function resize() {
      const W = c.clientWidth
      const H = c.clientHeight
      c.width = W * dpr
      c.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const W = () => c.clientWidth
    const H = () => c.clientHeight

    // Initialize if needed
    if (!nodesRef.current.length) {
      nodesRef.current = NODES.map(n => ({
        ...n,
        px: n.x * W(),
        py: n.y * H(),
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    function draw(now) {
      if (document.hidden) {
        frameRef.current = requestAnimationFrame(draw)
        return
      }
      if (FRAME_MS && now && now - lastFrame < FRAME_MS) {
        frameRef.current = requestAnimationFrame(draw)
        return
      }
      lastFrame = now || 0
      timeRef.current += 0.004
      const t = timeRef.current
      const w = W()
      const h = H()
      ctx.clearRect(0, 0, w, h)

      // Background - deep black with subtle blue radial glow
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)

      const bgGlow = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.55)
      bgGlow.addColorStop(0, 'rgba(10, 15, 30, 0.4)')
      bgGlow.addColorStop(0.5, 'rgba(6, 8, 20, 0.2)')
      bgGlow.addColorStop(1, 'rgba(4, 4, 11, 0)')
      ctx.fillStyle = bgGlow
      ctx.fillRect(0, 0, w, h)

      // Subtle grid dots
      ctx.fillStyle = 'rgba(255, 255, 255, 0.012)'
      for (let gx = 20; gx < w; gx += 50) {
        for (let gy = 20; gy < h; gy += 50) {
          ctx.fillRect(gx, gy, 1, 1)
        }
      }

      const nodes = nodesRef.current
      const hovered = hovRef.current
      const selected = selectedNode
      const dragging = dragRef.current

      // Physics update
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        if (dragging === n.id) continue
        if (hovered === n.id) {
          // Freeze hovered node
          n.vx *= 0.9
          n.vy *= 0.9
          n.px += n.vx
          n.py += n.vy
          continue
        }

        // Gentle sinusoidal drift
        n.vx += Math.sin(t * 1.8 + n.phase) * 0.006
        n.vy += Math.cos(t * 1.4 + n.phase * 1.3) * 0.005

        // Light repulsion from other nodes
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue
          const dx = n.px - nodes[j].px
          const dy = n.py - nodes[j].py
          const dist = Math.sqrt(dx * dx + dy * dy)
          const minDist = (n.r + nodes[j].r) * 1.5
          if (dist < minDist && dist > 0) {
            const force = (minDist - dist) / minDist * 0.08
            n.vx += (dx / dist) * force
            n.vy += (dy / dist) * force
          }
        }

        // Damping
        n.vx *= 0.97
        n.vy *= 0.97

        // Clamp velocity
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (speed > 1.2) {
          n.vx = (n.vx / speed) * 1.2
          n.vy = (n.vy / speed) * 1.2
        }

        // Boundary bounce with padding
        const pad = n.r + 8
        if (n.px < pad) { n.vx += 0.3; n.px = pad }
        if (n.px > w - pad) { n.vx -= 0.3; n.px = w - pad }
        if (n.py < pad) { n.vy += 0.3; n.py = pad }
        if (n.py > h - pad) { n.vy -= 0.3; n.py = h - pad }

        n.px += n.vx
        n.py += n.vy
      }

      // Determine highlight state
      const hoveredNeighbors = hovered ? ADJ.get(hovered) : null
      const selectedNeighbors = selected ? ADJ.get(selected) : null

      // Draw edges
      for (let i = 0; i < EDGES.length; i++) {
        const [aId, bId] = EDGES[i]
        const na = nodes.find(n => n.id === aId)
        const nb = nodes.find(n => n.id === bId)
        if (!na || !nb) continue

        const aVisible = filteredIds.has(aId)
        const bVisible = filteredIds.has(bId)
        if (!aVisible && !bVisible) continue

        // Determine edge highlight
        let alpha = 0.08
        let color = '0, 255, 170'
        const isHovEdge = hovered && (aId === hovered || bId === hovered)
        const isSelEdge = selected && (aId === selected || bId === selected)

        if (hovered) {
          alpha = isHovEdge ? 0.25 : 0.02
          if (isHovEdge) color = '0, 255, 170'
        } else if (selected) {
          alpha = isSelEdge ? 0.18 : 0.03
          if (isSelEdge) color = '0, 255, 170'
        }

        if (!aVisible || !bVisible) alpha *= 0.15

        // Shorten by radii
        const dx = nb.px - na.px
        const dy = nb.py - na.py
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len < 1) continue
        const nx = dx / len
        const ny = dy / len
        const sx = na.px + nx * (na.r + 3)
        const sy = na.py + ny * (na.r + 3)
        const ex = nb.px - nx * (nb.r + 3)
        const ey = nb.py - ny * (nb.r + 3)

        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(ex, ey)
        ctx.strokeStyle = `rgba(${color}, ${alpha})`
        ctx.lineWidth = isHovEdge || isSelEdge ? 1 : 0.5
        ctx.stroke()
      }

      // Draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const x = node.px
        const y = node.py
        const isVisible = filteredIds.has(node.id)
        const isHov = hovered === node.id
        const isSel = selected === node.id
        const isNeighbor = (hoveredNeighbors && hoveredNeighbors.has(node.id)) ||
                           (selectedNeighbors && selectedNeighbors.has(node.id))

        // Calculate alpha - dim non-matching, highlight neighbors
        let nodeAlpha = 1
        if (!isVisible) {
          nodeAlpha = 0.04
        } else if (hovered && !isHov && !isNeighbor) {
          nodeAlpha = 0.12
        } else if (selected && !isSel && !isNeighbor && !hovered) {
          nodeAlpha = 0.15
        }

        const r = isHov ? node.r * 1.3 : isSel ? node.r * 1.15 : node.r
        const [cr, cg, cb] = hex2rgb(node.color)

        // Outer glow - neon effect
        if ((isHov || isSel || isNeighbor) && isVisible) {
          ctx.save()
          ctx.shadowColor = node.color
          ctx.shadowBlur = isHov ? 24 : isSel ? 18 : 12
          ctx.beginPath()
          ctx.arc(x, y, r + 2, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.01)`
          ctx.fill()
          ctx.restore()

          // Radial glow halo
          const glowR = r * (isHov ? 3 : 2.2)
          const glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, glowR)
          glow.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${isHov ? 0.12 : 0.07})`)
          glow.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, ${isHov ? 0.04 : 0.02})`)
          glow.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`)
          ctx.beginPath()
          ctx.arc(x, y, glowR, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()
        }

        // Node fill - dark translucent with color tint
        const fillGrad = ctx.createRadialGradient(
          x - r * 0.25, y - r * 0.25, 0,
          x, y, r
        )
        fillGrad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${0.18 * nodeAlpha})`)
        fillGrad.addColorStop(0.7, `rgba(${cr}, ${cg}, ${cb}, ${0.08 * nodeAlpha})`)
        fillGrad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, ${0.03 * nodeAlpha})`)
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = fillGrad
        ctx.fill()

        // Border - neon glow effect
        const borderAlpha = (isHov || isSel) ? 0.95 : isNeighbor ? 0.7 : 0.45
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        if (node.type === 'kol') {
          ctx.setLineDash([5, 5])
        } else {
          ctx.setLineDash([])
        }

        // Apply glow to border via shadow
        if (isVisible && (isHov || isSel)) {
          ctx.save()
          ctx.shadowColor = node.color
          ctx.shadowBlur = isHov ? 16 : 10
          ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${borderAlpha * nodeAlpha})`
          ctx.lineWidth = isHov ? 2.5 : 2
          ctx.stroke()
          ctx.restore()
        } else {
          ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${borderAlpha * nodeAlpha})`
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
        ctx.setLineDash([])

        // Inner highlight arc (specular)
        if (isVisible && r > 10) {
          ctx.beginPath()
          ctx.arc(x, y - 1, r - 2, -Math.PI * 0.75, -Math.PI * 0.25)
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 * nodeAlpha})`
          ctx.lineWidth = 0.5
          ctx.stroke()
        }

        // Tier badge - small colored circle at top-right
        if (isVisible && r > 12) {
          const tc = TIER_COLORS[node.tier] || '#6B7280'
          const [tr, tg, tb] = hex2rgb(tc)
          const bx = x + r * 0.7
          const by = y - r * 0.7
          const bSize = 7

          // Badge glow
          ctx.save()
          ctx.shadowColor = tc
          ctx.shadowBlur = 4

          ctx.beginPath()
          ctx.arc(bx, by, bSize, 0, Math.PI * 2)
          ctx.fillStyle = tc
          ctx.fill()

          ctx.restore()

          // Badge outline
          ctx.beginPath()
          ctx.arc(bx, by, bSize, 0, Math.PI * 2)
          ctx.strokeStyle = BG
          ctx.lineWidth = 1.5
          ctx.stroke()

          // Badge letter
          ctx.fillStyle = '#fff'
          ctx.font = "bold 7px var(--font-mono)"
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(node.tier, bx, by + 0.5)
        }

        // Label inside node
        if (isVisible && nodeAlpha > 0.1) {
          const fontSize = r > 30 ? 12 : r > 22 ? 10 : r > 16 ? 8 : 7
          ctx.fillStyle = `rgba(255, 255, 255, ${(isHov || isSel ? 1 : 0.9) * nodeAlpha})`
          ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          if (node.sub && r > 20) {
            ctx.fillText(node.label, x, y - 4)
            ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * nodeAlpha})`
            ctx.font = `400 ${Math.max(fontSize - 3, 6)}px -apple-system, BlinkMacSystemFont, sans-serif`
            ctx.fillText(node.sub.length > 12 ? node.sub.slice(0, 11) + '..' : node.sub, x, y + 7)
          } else {
            ctx.fillText(node.label, x, y)
          }
        }
      }

      frameRef.current = requestAnimationFrame(draw)
    }

    draw()

    // Resize handler
    const onResize = () => {
      resize()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(c)

    // Mouse handlers
    const handleMouseMove = (e) => {
      const rect = c.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      mouseRef.current = { x: mx, y: my }

      if (dragRef.current) {
        const node = nodesRef.current.find(n => n.id === dragRef.current)
        if (node) {
          node.px = mx
          node.py = my
          node.vx = 0
          node.vy = 0
        }
        return
      }

      let found = null
      for (let i = nodesRef.current.length - 1; i >= 0; i--) {
        const n = nodesRef.current[i]
        const dist = Math.sqrt((mx - n.px) ** 2 + (my - n.py) ** 2)
        if (dist < n.r + 6) {
          found = n
          break
        }
      }
      hovRef.current = found?.id || null
      c.style.cursor = found ? 'grab' : 'default'
      setTooltip(found ? { ...found, mx, my } : null)
    }

    const handleMouseDown = (e) => {
      const rect = c.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      for (let i = nodesRef.current.length - 1; i >= 0; i--) {
        const n = nodesRef.current[i]
        if (Math.sqrt((mx - n.px) ** 2 + (my - n.py) ** 2) < n.r + 6) {
          dragRef.current = n.id
          dragStartRef.current = { x: mx, y: my }
          c.style.cursor = 'grabbing'
          break
        }
      }
    }

    const handleMouseUp = () => {
      if (dragRef.current) {
        const start = dragStartRef.current
        const end = mouseRef.current
        const dragDist = start ? Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2) : 0

        // Treat short drags as clicks
        if (dragDist < 5) {
          setSelectedNode(prev => prev === dragRef.current ? null : dragRef.current)
        }
        dragRef.current = null
        dragStartRef.current = null
        const c2 = canvasRef.current
        if (c2) c2.style.cursor = hovRef.current ? 'grab' : 'default'
      }
    }

    const handleMouseLeave = () => {
      hovRef.current = null
      setTooltip(null)
    }

    c.addEventListener('mousemove', handleMouseMove)
    c.addEventListener('mousedown', handleMouseDown)
    c.addEventListener('mouseup', handleMouseUp)
    c.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      cancelAnimationFrame(frameRef.current)
      ro.disconnect()
      c.removeEventListener('mousemove', handleMouseMove)
      c.removeEventListener('mousedown', handleMouseDown)
      c.removeEventListener('mouseup', handleMouseUp)
      c.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [filteredIds, selectedNode])

  const handleSectorClick = useCallback(
    (id) => { onSectorChange?.(activeSector === id ? null : id) },
    [activeSector, onSectorChange]
  )

  const handleNodeClick = useCallback((id) => {
    setSelectedNode(prev => prev === id ? null : id)
    // Pan canvas to node
    const node = nodesRef.current.find(n => n.id === id)
    if (node) {
      hovRef.current = id
    }
  }, [])

  return (
    <div className="cp-root">
      {/* LEFT SIDEBAR - filters and stats */}
      <div className="cp-sidebar-left">
        {/* Stats header */}
        <div className="cp-stats-header">
          <div className="cp-stat-row">
            <NodeIcon />
            <span className="cp-stat-value">{totalNodes}</span>
            <span className="cp-stat-label">NODES</span>
          </div>
          <div className="cp-stat-row">
            <LinkIcon />
            <span className="cp-stat-value">{totalEdges}</span>
            <span className="cp-stat-label">CONNECTIONS</span>
          </div>
          {visibleNodes < totalNodes && (
            <div className="cp-stat-filtered">
              Showing {visibleNodes} of {totalNodes}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="cp-search-wrap">
          <span className="cp-search-icon"><SearchIcon /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes..."
            className="cp-search"
          />
        </div>

        {/* Type filter */}
        <div className="cp-filter-section">
          <div className="cp-filter-label">TYPE</div>
          <div className="cp-filter-pills">
            {[
              { id: 'all', label: 'All' },
              { id: 'project', label: 'Projects' },
              { id: 'kol', label: 'KOLs' },
            ].map(f => (
              <button
                key={f.id}
                className={`cp-pill ${typeFilter === f.id ? 'cp-pill--active' : ''}`}
                onClick={() => setTypeFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tier filter */}
        <div className="cp-filter-section">
          <div className="cp-filter-label">TIER</div>
          <div className="cp-filter-pills">
            {[
              { id: 'all', label: 'All', color: null },
              { id: 'S', label: 'S', color: TIER_COLORS.S },
              { id: 'A', label: 'A', color: TIER_COLORS.A },
              { id: 'B', label: 'B', color: TIER_COLORS.B },
              { id: 'C', label: 'C', color: TIER_COLORS.C },
            ].map(f => (
              <button
                key={f.id}
                className={`cp-pill cp-pill-tier ${tierFilter === f.id ? 'cp-pill--active' : ''}`}
                onClick={() => setTierFilter(f.id)}
                style={tierFilter === f.id && f.color ? {
                  color: f.color,
                  borderColor: `${f.color}50`,
                  background: `${f.color}14`,
                } : undefined}
              >
                {f.color && <span className="cp-pill-dot" style={{ background: f.color }} />}
                {f.id === 'all' ? 'All' : `${f.id}-Tier`}
              </button>
            ))}
          </div>
        </div>

        {/* Sector filter */}
        <div className="cp-filter-section">
          <div className="cp-filter-label">SECTOR</div>
          <div className="cp-filter-pills cp-filter-pills--wrap">
            {Object.entries(SECTORS).map(([id, s]) => (
              <button
                key={id}
                className={`cp-pill cp-pill-sector ${activeSector === id ? 'cp-pill--active' : ''}`}
                onClick={() => handleSectorClick(id)}
                style={activeSector === id ? {
                  color: s.color,
                  borderColor: `${s.color}50`,
                  background: `${s.color}14`,
                } : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="cp-legend">
          <div className="cp-legend-row">
            <span className="cp-legend-circ cp-legend-circ--solid" />
            <span>Project</span>
          </div>
          <div className="cp-legend-row">
            <span className="cp-legend-circ cp-legend-circ--dashed" />
            <span>KOL</span>
          </div>
          <div className="cp-legend-sep" />
          {Object.entries(TIER_COLORS).map(([tier, color]) => (
            <div key={tier} className="cp-legend-row">
              <span className="cp-legend-badge" style={{ background: color }}>{tier}</span>
              <span>{TIER_LABELS[tier]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CENTER - canvas */}
      <div className="cp-canvas-area">
        <canvas ref={canvasRef} className="cp-canvas" />

        {/* Tooltip */}
        {tooltip && (
          <div
            className="cp-tooltip"
            style={{
              left: Math.min(tooltip.mx + 18, (canvasRef.current?.clientWidth || 400) - 220),
              top: Math.max(tooltip.my - 90, 10),
            }}
          >
            <div className="cp-tooltip-header">
              <span className="cp-tooltip-dot" style={{ background: tooltip.color, boxShadow: `0 0 8px ${tooltip.color}60` }} />
              <span className="cp-tooltip-name">{tooltip.label}</span>
              <span className="cp-tooltip-tier" style={{ background: TIER_COLORS[tooltip.tier] }}>{tooltip.tier}</span>
              <span className="cp-tooltip-type">{tooltip.type === 'kol' ? 'KOL' : 'PROJECT'}</span>
            </div>
            {tooltip.sub && <div className="cp-tooltip-sub">{tooltip.sub}</div>}
            <div className="cp-tooltip-stats">
              {/* 2026-05-26 beta-quality fix: connection-protocol uses static editorial
                  seed data (mock-nodes.js). The project TVL strings are stale (BTC "$1.2T",
                  ETH "$68B" — and BTC has no TVL anyway, that's market cap). KOL followers
                  are real-ish but stale. Show ONLY KOL followers when present, never the
                  fabricated project TVL. Project tooltip still shows tier/sector/connections. */}
              {tooltip.type === 'kol' && tooltip.followers && tooltip.followers !== '--' && (
                <div className="cp-tooltip-stat">
                  <span className="cp-tooltip-stat-label">Followers</span>
                  <span className="cp-tooltip-stat-value">{formatFollowers(tooltip.followers)}</span>
                </div>
              )}
              <div className="cp-tooltip-stat">
                <span className="cp-tooltip-stat-label">Sector</span>
                <span className="cp-tooltip-stat-value">{SECTORS[tooltip.sector]?.label || tooltip.sector}</span>
              </div>
              <div className="cp-tooltip-stat">
                <span className="cp-tooltip-stat-label">Connections</span>
                <span className="cp-tooltip-stat-value">{ADJ.get(tooltip.id)?.size || 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Live badge */}
        <div className="cp-live-badge">
          <span className="cp-live-dot" />
          LIVE
        </div>
      </div>

      {/* RIGHT SIDEBAR - detail panel */}
      <div className={`cp-sidebar-right ${selectedData ? 'cp-sidebar-right--open' : ''}`}>
        {selectedData ? (
          <>
            <div className="cp-detail-top">
              <div className="cp-detail-close" onClick={() => setSelectedNode(null)}>
                <CloseIcon />
              </div>
            </div>

            {/* Avatar */}
            <div className="cp-detail-avatar" style={{ borderColor: selectedData.color, boxShadow: `0 0 20px ${selectedData.color}30` }}>
              <span className="cp-detail-avatar-letter" style={{ color: selectedData.color }}>{selectedData.label.charAt(0)}</span>
            </div>

            <div className="cp-detail-name">{selectedData.label}</div>
            {selectedData.sub && <div className="cp-detail-sub">{selectedData.sub}</div>}

            <div className="cp-detail-badges">
              <span className="cp-detail-tier-badge" style={{ background: TIER_COLORS[selectedData.tier] }}>
                {selectedData.tier}-TIER
              </span>
              <span className="cp-detail-type-badge">
                {selectedData.type === 'kol' ? 'KOL' : 'PROJECT'}
              </span>
            </div>

            {/* Stats grid */}
            <div className="cp-detail-grid">
              {/* 2026-05-26 beta-quality fix: same reasoning as tooltip — never render
                  the fabricated project TVL strings from mock-nodes.js. KOL followers
                  only, when present. */}
              {selectedData.type === 'kol' && selectedData.followers && selectedData.followers !== '--' && (
                <div className="cp-detail-cell">
                  <span className="cp-detail-cell-value">
                    {formatFollowers(selectedData.followers)}
                  </span>
                  <span className="cp-detail-cell-label">
                    Followers
                  </span>
                </div>
              )}
              <div className="cp-detail-cell">
                <span className="cp-detail-cell-value">{selectedConnections}</span>
                <span className="cp-detail-cell-label">Connections</span>
              </div>
              <div className="cp-detail-cell">
                <span className="cp-detail-cell-value">{SECTORS[selectedData.sector]?.label || '--'}</span>
                <span className="cp-detail-cell-label">Sector</span>
              </div>
              <div className="cp-detail-cell">
                <span className="cp-detail-cell-value">{selectedData.type === 'kol' ? 'High' : '--'}</span>
                <span className="cp-detail-cell-label">Activity</span>
              </div>
            </div>

            {/* Influence tier */}
            <div className="cp-detail-section">
              <div className="cp-detail-section-title">INFLUENCE TIER</div>
              <div className="cp-detail-section-text">
                {TIER_LABELS[selectedData.tier]} - {selectedData.tier === 'S' ? 'Top 1% of network influence. Market-moving entity with massive reach and deep connections.' : selectedData.tier === 'A' ? 'Top 5% influence. Strong network presence with significant cross-sector connections.' : selectedData.tier === 'B' ? 'Growing influence. Established presence in their primary sector.' : 'Emerging player. Building connections and growing influence.'}
              </div>
            </div>

            {/* Mentions / Connections */}
            {selectedMentions.length > 0 && (
              <div className="cp-detail-section">
                <div className="cp-detail-section-title">
                  {selectedData.type === 'kol' ? 'MENTIONS' : 'CONNECTED TO'}
                </div>
                <div className="cp-detail-mentions">
                  {selectedMentions.map(m => (
                    <div
                      key={m.id}
                      className="cp-detail-mention"
                      onClick={() => handleNodeClick(m.id)}
                    >
                      <span className="cp-detail-mention-dot" style={{ background: m.color }} />
                      <span className="cp-detail-mention-name">{m.label}</span>
                      {m.sub && <span className="cp-detail-mention-sub">{m.sub}</span>}
                      <span className="cp-detail-mention-tier" style={{ color: TIER_COLORS[m.tier] }}>{m.tier}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="cp-detail-empty">
            <NodeIcon />
            <span>Select a node to view details</span>
          </div>
        )}
      </div>
    </div>
  )
}
