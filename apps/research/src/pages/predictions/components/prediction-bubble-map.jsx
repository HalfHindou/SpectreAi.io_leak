/**
 * PredictionBubbleMap - d3-force packed-circle visualization of prediction markets.
 * Bubble size = volume, color = category, current market highlighted.
 * DOM-rendered with d3-force, event icons, drag support, ambient breathing.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { forceSimulation, forceCollide, forceX, forceY } from 'd3-force'
import { useCurrency } from '@/hooks/useCurrency'
import { getPredictionMarkets } from '@/services/polymarketApi'
import { CATEGORY_COLORS, formatVolume } from './predictions-constants'

const BUBBLE_COUNT = 20

function extractSlug(url) {
  return (url || '').split('/event/')[1] || ''
}

function truncate(text, maxLen) {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function PredictionBubbleMap({ currentSlug, dayMode }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const containerRef = useRef(null)
  const simRef = useRef(null)
  const nodesRef = useRef([])
  const domNodesRef = useRef(null)
  const dimsRef = useRef({ w: 0, h: 0 })
  const dragRef = useRef({ active: false })
  const [markets, setMarkets] = useState([])
  const [ready, setReady] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState(-1)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Fetch prediction markets
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getPredictionMarkets('all', BUBBLE_COUNT)
        if (!cancelled && data?.length) setMarkets(data)
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Step 1: compute node geometry from markets, then flip `ready` so the
  // bubbles paint. We seed positions on a spread ring (not all at the center)
  // so the collide force relaxes into a clean layout instead of exploding out
  // of a single stacked point.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !markets.length) { setReady(false); return }

    const rect = el.getBoundingClientRect()
    const w = rect.width || el.offsetWidth
    const h = rect.height || el.offsetHeight
    if (!w || !h) return
    dimsRef.current = { w, h }

    const maxVol = Math.max(...markets.map(m => m.volume || 1))
    const minR = 24
    const maxR = Math.min(w / 5, h / 3, 62)
    const cx = w / 2
    const cy = h / 2
    const ringR = Math.min(w, h) * 0.32

    nodesRef.current = markets.map((m, i) => {
      const angle = (i / markets.length) * Math.PI * 2
      return {
        index: i,
        radius: minR + Math.sqrt((m.volume || 1) / maxVol) * (maxR - minR),
        x: cx + Math.cos(angle) * ringR + (Math.random() - 0.5) * 24,
        y: cy + Math.sin(angle) * ringR + (Math.random() - 0.5) * 24,
      }
    })
    setReady(true)
  }, [markets])

  // Step 2: start the d3 simulation. Keying this effect on `ready` GUARANTEES
  // the .pd-bub nodes are committed + painted before we query them (a passive
  // effect runs after the commit that set ready=true), which eliminates the
  // requestAnimationFrame race that previously left bubbles unsized + stacked
  // in the top-left corner when querySelectorAll ran too early.
  useEffect(() => {
    if (!ready) return
    const el = containerRef.current
    const nodes = nodesRef.current
    if (!el || !nodes.length) return

    const dn = el.querySelectorAll('.pd-bub')
    if (!dn.length) return
    domNodesRef.current = dn

    const { w, h } = dimsRef.current
    const cx = w / 2
    const cy = h / 2

    const sim = forceSimulation(nodes)
      .force('x', forceX(cx).strength(0.028))
      .force('y', forceY(cy).strength(0.028))
      .force('collide', forceCollide(d => d.radius + 3).strength(1).iterations(4))
      .alpha(0.9)
      .alphaDecay(0.02)
      .alphaMin(0.001)
      .velocityDecay(0.45)
      .on('tick', () => {
        // Hard clamp to bounds (no escaping)
        const pad = 2
        for (const n of nodes) {
          n.x = Math.max(n.radius + pad, Math.min(w - n.radius - pad, n.x))
          n.y = Math.max(n.radius + pad, Math.min(h - n.radius - pad, n.y))
        }
        const domN = domNodesRef.current
        if (!domN) return
        for (let i = 0; i < nodes.length && i < domN.length; i++) {
          domN[i].style.transform = `translate3d(${nodes[i].x - nodes[i].radius}px, ${nodes[i].y - nodes[i].radius}px, 0)`
        }
      })

    simRef.current = sim

    // Staggered fade-in (sizes/initial transform are already set inline in JSX)
    for (let i = 0; i < dn.length; i++) {
      dn[i].style.opacity = '0'
      const idx = i
      setTimeout(() => { if (dn[idx]) dn[idx].style.opacity = '1' }, 60 + i * 40)
    }

    // Add ambient breathing after the simulation settles
    sim.on('end', () => {
      for (let i = 0; i < dn.length; i++) dn[i].classList.add('pd-bub--settled')
    })

    return () => { sim.stop(); simRef.current = null }
  }, [ready, markets])

  // ── Drag handlers ─────────────────────────────────────────────

  const handleGrab = useCallback((e, idx) => {
    e.preventDefault()
    e.stopPropagation()

    const sim = simRef.current
    const node = nodesRef.current[idx]
    const el = containerRef.current
    if (!sim || !node || !el) return

    const rect = el.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY

    node.fx = node.x
    node.fy = node.y
    sim.alphaTarget(0.05).restart()

    dragRef.current = {
      active: true, idx, rect,
      grabX: clientX - rect.left - node.x,
      grabY: clientY - rect.top - node.y,
      startX: clientX, startY: clientY,
    }

    const dn = domNodesRef.current
    if (dn?.[idx]) {
      dn[idx].classList.add('pd-bub--dragging')
      dn[idx].classList.remove('pd-bub--settled')
    }

    setHoveredIdx(-1)
  }, [])

  useEffect(() => {
    const onMove = (e) => {
      const ds = dragRef.current
      if (!ds.active) return
      e.preventDefault()

      const node = nodesRef.current[ds.idx]
      if (!node) return

      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY
      const { w, h } = dimsRef.current

      const newX = clientX - ds.rect.left - ds.grabX
      const newY = clientY - ds.rect.top - ds.grabY

      // Clamp and pin
      node.fx = Math.max(node.radius + 2, Math.min(w - node.radius - 2, newX))
      node.fy = Math.max(node.radius + 2, Math.min(h - node.radius - 2, newY))

      // Directly position the dragged node for instant feedback
      const dn = domNodesRef.current
      if (dn?.[ds.idx]) {
        dn[ds.idx].style.transform = `translate3d(${node.fx - node.radius}px, ${node.fy - node.radius}px, 0)`
      }
    }

    const onUp = (e) => {
      const ds = dragRef.current
      if (!ds.active) return

      const idx = ds.idx
      ds.active = false

      const sim = simRef.current
      const node = nodesRef.current[idx]
      if (!sim || !node) return

      node.fx = null
      node.fy = null
      sim.alphaTarget(0).alpha(0.12).restart()

      const dn = domNodesRef.current
      if (dn?.[idx]) {
        dn[idx].classList.remove('pd-bub--dragging')
        setTimeout(() => { if (dn[idx]) dn[idx].classList.add('pd-bub--settled') }, 600)
      }

      // Click vs drag detection
      const endX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX
      const endY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY
      if (Math.hypot(endX - ds.startX, endY - ds.startY) < 5) {
        const slug = extractSlug(markets[idx]?.url)
        if (slug && slug !== currentSlug) {
          navigate(`/predictions/${slug}`)
        }
      }
    }

    window.addEventListener('mousemove', onMove, { passive: false })
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [markets, currentSlug, navigate])

  if (!markets.length) return null

  return (
    <div className="pd-bubble-card">
      <div className="pd-bubble-header">
        <h2 className="pd-section-title" style={{ margin: 0 }}>{t('predictionsPage.bubble.landscape')}</h2>
        <div className="pd-bubble-legend">
          {Object.entries(CATEGORY_COLORS).filter(([k]) => k !== 'other').map(([cat, color]) => (
            <span key={cat} className="pd-bubble-legend-item">
              <span className="pd-bubble-legend-dot" style={{ background: color }} />
              <span className="pd-bubble-legend-label">{t(`predictionsPage.categories.${cat}`, { defaultValue: cat })}</span>
            </span>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="pd-bubble-container">
        {ready && markets.map((m, i) => {
          const slug = extractSlug(m.url)
          const isCurrent = slug === currentSlug
          const isHovered = i === hoveredIdx
          const catColor = CATEGORY_COLORS[m.category] || CATEGORY_COLORS.other
          const node = nodesRef.current[i]
          const r = node?.radius || 40
          const iconCls = r >= 48 ? ' pd-bub-icon--lg' : r <= 30 ? ' pd-bub-icon--sm' : ''
          const labelLen = r >= 48 ? 16 : r >= 36 ? 12 : 8

          return (
            <div
              key={m.id}
              className={`pd-bub${isCurrent ? ' pd-bub--current' : ''}${isHovered ? ' pd-bub--hover' : ''}`}
              style={{
                '--bub-color': catColor,
                width: r * 2 + 'px',
                height: r * 2 + 'px',
                transform: node ? `translate3d(${node.x - r}px, ${node.y - r}px, 0)` : undefined,
              }}
              onMouseDown={(e) => handleGrab(e, i)}
              onTouchStart={(e) => handleGrab(e, i)}
              onMouseEnter={(e) => {
                if (!dragRef.current.active) {
                  setHoveredIdx(i)
                  setTooltipPos({ x: e.clientX, y: e.clientY })
                }
              }}
              onMouseMove={(e) => {
                if (!dragRef.current.active) setTooltipPos({ x: e.clientX, y: e.clientY })
              }}
              onMouseLeave={() => {
                if (!dragRef.current.active) setHoveredIdx(-1)
              }}
            >
              <span className="pd-bub-ring" />

              {(m.image || m.icon) && (
                <img
                  className={`pd-bub-icon${iconCls}`}
                  src={m.image || m.icon}
                  alt=""
                  draggable={false}
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}

              <span className="pd-bub-pct mono" style={{ color: catColor }}>
                {m.yesPct}%
              </span>

              <span className="pd-bub-label">
                {truncate(m.question || m.title, labelLen)}
              </span>
            </div>
          )
        })}

        {hoveredIdx >= 0 && markets[hoveredIdx] && (() => {
          const m = markets[hoveredIdx]
          const cRect = containerRef.current?.getBoundingClientRect()
          const tx = tooltipPos.x - (cRect?.left || 0) + 14
          const ty = tooltipPos.y - (cRect?.top || 0) - 10
          // Flip left if near right edge
          const flipX = cRect && (tooltipPos.x - cRect.left + 280 > cRect.width)
          return (
            <div
              className="pd-bubble-tip mono"
              style={{
                left: flipX ? tx - 300 : tx,
                top: Math.max(4, ty),
              }}
            >
              <div className="pd-bubble-tip-title">{m.question || m.title}</div>
              <div className="pd-bubble-tip-row">
                <span style={{ color: CATEGORY_COLORS[m.category] || '#6B7280', fontWeight: 600 }}>
                  {t('predictionsPage.bubble.yesSuffix', { pct: m.yesPct })}
                </span>
                <span className="pd-bubble-tip-vol">{formatVolume(m.volume, fmtLargeShort)}</span>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

export default PredictionBubbleMap
