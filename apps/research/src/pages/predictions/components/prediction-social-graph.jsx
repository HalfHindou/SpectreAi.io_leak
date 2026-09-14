/**
 * PredictionSocialGraph — "Constellation".
 *
 * A three-layer force graph linking THIS prediction -> related tokens -> the
 * KOLs carrying the conversation. The evolution of the bubble map: instead of
 * floating peers, it draws the social/asset web AROUND the current market.
 *
 *   center  ● the current prediction (largest, pinned near center)
 *   token   ◦ crypto tokens the market references (logo nodes)
 *   kol     ◦ the top carriers from the X-Dash social layer (avatars)
 *   rel     ◦ related markets (category-hued), the legacy bubble-map peers
 *
 * Built on the SAME two-effect structure as prediction-bubble-map.jsx (the
 * recent fix): effect 1 computes geometry + flips `ready` so .pd-gal-node DOM
 * is painted; effect 2 (keyed on `ready`) starts the d3 sim AFTER the nodes
 * exist — never starts the sim inside a rAF that queries the DOM. An SVG layer
 * BEHIND the DOM nodes draws edges, redrawn on each tick. KOL edges drift
 * (dashed-offset) as the one permitted ambient loop — guarded on
 * document.hidden, disabled under prefers-reduced-motion.
 *
 * Degrades gracefully: no social -> falls back to related markets only (the
 * bubble-map behavior). No token match -> skip the token layer. On mobile the
 * token layer is dropped to keep node count low.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { forceSimulation, forceCollide, forceX, forceY, forceLink, forceManyBody } from 'd3-force'
import { getPredictionMarkets } from '@/services/polymarketApi'
import { getPathForPageId } from '@/constants/pageRoutes'
import { getTokenAvatarRingStyle } from '@/constants/tokenColors'
import { CATEGORY_COLORS } from './predictions-constants'
import './prediction-social-graph.css'

const REL_COUNT = 9
const KOL_COUNT_DESKTOP = 6
const KOL_COUNT_MOBILE = 5
const TOKEN_COUNT = 4

function extractSlug(url) {
  return (url || '').split('/event/')[1] || ''
}
function truncate(text, n) {
  if (!text) return ''
  return text.length > n ? text.slice(0, n) + '…' : text
}
function carrierHandle(c) {
  return String(c.screen_name || c.handle || c.username || '').replace(/^@/, '')
}
function carrierName(c) {
  return c.name || c.display_name || carrierHandle(c) || ''
}
function carrierAvatar(c) {
  return c.profile_image_url || c.avatar || c.image || c.profile_image || ''
}
function carrierFollowers(c) {
  return Number(c.followers_count || c.followers || 0)
}

export default function PredictionSocialGraph({
  currentSlug,
  currentTitle,
  currentYesPct = 50,
  category,
  tokens = [], // [{ symbol, cgId, image }]
  carriers = [], // X-Dash signal carriers (top, proof-weighted)
  isMobile = false,
  dayMode,
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const svgRef = useRef(null)
  const simRef = useRef(null)
  const nodesRef = useRef([])
  const linksRef = useRef([])
  const domNodesRef = useRef(null)
  const dimsRef = useRef({ w: 0, h: 0 })
  const driftRef = useRef(null)
  const dashOffsetRef = useRef(0)

  const [related, setRelated] = useState([])
  const [ready, setReady] = useState(false)

  // ── Fetch related markets (the bubble-map peer set) ──────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getPredictionMarkets('all', 18)
        if (cancelled || !data?.length) return
        const peers = data
          .filter((m) => extractSlug(m.url) && extractSlug(m.url) !== currentSlug)
          .slice(0, REL_COUNT)
        setRelated(peers)
      } catch { /* silent — graph still renders center + tokens + KOLs */ }
    }
    load()
    return () => { cancelled = true }
  }, [currentSlug])

  // ── Step 1: build nodes + links, then flip `ready` ───────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) { setReady(false); return }
    const rect = el.getBoundingClientRect()
    const w = rect.width || el.offsetWidth
    const h = rect.height || el.offsetHeight
    if (!w || !h) return
    dimsRef.current = { w, h }

    const cx = w / 2
    const cy = h / 2

    const nodes = []
    const links = []

    // center
    nodes.push({
      id: 'center',
      type: 'center',
      label: truncate(currentTitle, 26),
      yesPct: currentYesPct,
      radius: isMobile ? 42 : 52,
      x: cx,
      y: cy,
      fx: cx,
      fy: cy,
    })

    // tokens (skip layer on mobile to keep node count down)
    if (!isMobile) {
      tokens.slice(0, TOKEN_COUNT).forEach((tk, i) => {
        const id = `tok-${tk.symbol || i}`
        const ang = (i / Math.max(1, tokens.length)) * Math.PI * 2
        nodes.push({
          id,
          type: 'token',
          symbol: tk.symbol,
          cgId: tk.cgId,
          image: tk.image,
          radius: 22,
          x: cx + Math.cos(ang) * (w * 0.16),
          y: cy + Math.sin(ang) * (h * 0.16),
        })
        links.push({ source: 'center', target: id, kind: 'token' })
      })
    }

    // KOLs
    const kolN = isMobile ? KOL_COUNT_MOBILE : KOL_COUNT_DESKTOP
    carriers
      .filter((c) => carrierHandle(c))
      .slice(0, kolN)
      .forEach((c, i) => {
        const id = `kol-${carrierHandle(c) || i}`
        const ang = (i / kolN) * Math.PI * 2 + 0.6
        nodes.push({
          id,
          type: 'kol',
          handle: carrierHandle(c),
          name: carrierName(c),
          avatar: carrierAvatar(c),
          followers: carrierFollowers(c),
          radius: 17,
          x: cx + Math.cos(ang) * (w * 0.3),
          y: cy + Math.sin(ang) * (h * 0.3),
        })
        links.push({ source: 'center', target: id, kind: 'kol' })
      })

    // related markets (outer ring)
    related.forEach((m, i) => {
      const id = `rel-${m.id || i}`
      const ang = (i / Math.max(1, related.length)) * Math.PI * 2 + 1.4
      const catColor = CATEGORY_COLORS[m.category] || CATEGORY_COLORS.other
      nodes.push({
        id,
        type: 'rel',
        slug: extractSlug(m.url),
        label: truncate(m.question || m.title, isMobile ? 8 : 12),
        yesPct: m.yesPct,
        color: catColor,
        image: m.image || m.icon,
        radius: isMobile ? 20 : 26,
        x: cx + Math.cos(ang) * (w * 0.4),
        y: cy + Math.sin(ang) * (h * 0.4),
      })
      links.push({ source: 'center', target: id, kind: 'rel' })
    })

    nodesRef.current = nodes
    linksRef.current = links
    setReady(nodes.length > 1)
  }, [related, tokens, carriers, currentTitle, currentYesPct, isMobile])

  // ── Step 2: start the sim AFTER .pd-gal-node nodes are painted ───
  useEffect(() => {
    if (!ready) return
    const el = containerRef.current
    const nodes = nodesRef.current
    const links = linksRef.current
    if (!el || nodes.length < 2) return

    const dn = el.querySelectorAll('.pd-gal-node')
    if (!dn.length) return
    domNodesRef.current = dn

    const { w, h } = dimsRef.current
    const cx = w / 2
    const cy = h / 2
    const svg = svgRef.current

    // link distance scaled by node type — tokens close, KOLs mid, rel far
    const linkDist = (l) => (l.kind === 'token' ? w * 0.16 : l.kind === 'kol' ? w * 0.26 : w * 0.4)

    const sim = forceSimulation(nodes)
      .force('link', forceLink(links).id((d) => d.id).distance(linkDist).strength(0.35))
      .force('charge', forceManyBody().strength(-60))
      .force('x', forceX(cx).strength(0.04))
      .force('y', forceY(cy).strength(0.04))
      .force('collide', forceCollide((d) => d.radius + 6).strength(0.9).iterations(3))
      .alpha(0.95)
      .alphaDecay(0.022)
      .alphaMin(0.001)
      .velocityDecay(0.42)
      .on('tick', () => {
        const pad = 2
        for (const n of nodes) {
          n.x = Math.max(n.radius + pad, Math.min(w - n.radius - pad, n.x))
          n.y = Math.max(n.radius + pad, Math.min(h - n.radius - pad, n.y))
        }
        const domN = domNodesRef.current
        if (domN) {
          for (let i = 0; i < nodes.length && i < domN.length; i++) {
            domN[i].style.transform = `translate3d(${nodes[i].x - nodes[i].radius}px, ${nodes[i].y - nodes[i].radius}px, 0)`
          }
        }
        drawEdges(svg, nodes, links, dashOffsetRef.current, dayMode)
      })

    simRef.current = sim

    // staggered fade-in
    for (let i = 0; i < dn.length; i++) {
      dn[i].style.opacity = '0'
      const idx = i
      setTimeout(() => { if (dn[idx]) dn[idx].style.opacity = '1' }, 50 + i * 35)
    }
    sim.on('end', () => {
      for (let i = 0; i < dn.length; i++) dn[i].classList.add('pd-gal-node--settled')
    })

    // ── Ambient KOL-edge drift — the ONE permitted loop ───────────
    const reduce = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduce) {
      const drift = () => {
        if (document.hidden) {
          // pause: re-arm on visibility
          driftRef.current = null
          return
        }
        dashOffsetRef.current = (dashOffsetRef.current - 0.4) % 1000
        drawEdges(svgRef.current, nodesRef.current, linksRef.current, dashOffsetRef.current, dayMode)
        driftRef.current = requestAnimationFrame(drift)
      }
      const onVis = () => {
        if (!document.hidden && driftRef.current == null) {
          driftRef.current = requestAnimationFrame(drift)
        }
      }
      document.addEventListener('visibilitychange', onVis)
      driftRef.current = requestAnimationFrame(drift)
      sim.__onVis = onVis
    }

    return () => {
      sim.stop()
      if (driftRef.current) cancelAnimationFrame(driftRef.current)
      driftRef.current = null
      if (sim.__onVis) document.removeEventListener('visibilitychange', sim.__onVis)
      simRef.current = null
    }
  }, [ready, dayMode])

  const handleNodeClick = useCallback((node) => {
    if (!node) return
    if (node.type === 'rel' && node.slug && node.slug !== currentSlug) {
      navigate(`/predictions/${node.slug}`)
    } else if (node.type === 'token' && node.cgId) {
      navigate(`${getPathForPageId('research-zone')}/${node.cgId}`)
    } else if (node.type === 'kol' && node.handle) {
      navigate(`/x-intelligence?author=${encodeURIComponent(node.handle)}`)
    }
  }, [navigate, currentSlug])

  // Nothing to orbit -> render nothing (caller keeps the bubble map).
  if (ready && nodesRef.current.length < 2) return null

  return (
    <div className={`pd-gal${isMobile ? ' pd-gal--mobile' : ''}`}>
      <div className="pd-gal__header">
        <h2 className="pd-section-title" style={{ margin: 0 }}>
          {t('predictionsPage.galaxy.title', { defaultValue: 'Constellation' })}
        </h2>
        <div className="pd-gal__legend">
          <span className="pd-gal__leg">
            <span className="pd-gal__leg-dot pd-gal__leg-dot--market" />
            {t('predictionsPage.galaxy.legendMarket', { defaultValue: 'Markets' })}
          </span>
          {!isMobile && (
            <span className="pd-gal__leg">
              <span className="pd-gal__leg-dot pd-gal__leg-dot--token" />
              {t('predictionsPage.galaxy.legendToken', { defaultValue: 'Tokens' })}
            </span>
          )}
          <span className="pd-gal__leg">
            <span className="pd-gal__leg-dash" />
            {t('predictionsPage.galaxy.legendKol', { defaultValue: 'Voices' })}
          </span>
        </div>
      </div>

      <div ref={containerRef} className="pd-gal__canvas">
        <svg ref={svgRef} className="pd-gal__edges" aria-hidden="true" />
        {ready && nodesRef.current.map((node) => {
          const r = node.radius
          if (node.type === 'center') {
            return (
              <div
                key={node.id}
                className="pd-gal-node pd-gal-node--center"
                style={{ width: r * 2, height: r * 2, transform: `translate3d(${node.x - r}px, ${node.y - r}px, 0)` }}
              >
                <span className="pd-gal-center__label">{node.label}</span>
                <span className="pd-gal-center__pct mono">{node.yesPct}%</span>
              </div>
            )
          }
          if (node.type === 'token') {
            const ring = getTokenAvatarRingStyle(node.symbol) || {}
            return (
              <button
                key={node.id}
                type="button"
                className="pd-gal-node pd-gal-node--token"
                style={{ width: r * 2, height: r * 2, transform: `translate3d(${node.x - r}px, ${node.y - r}px, 0)`, ...ring }}
                onClick={() => handleNodeClick(node)}
                title={node.symbol}
              >
                {node.image
                  ? <img className="pd-gal-token__img" src={node.image} alt="" draggable={false} onError={(e) => { e.target.style.display = 'none' }} />
                  : <span className="pd-gal-token__sym mono">{(node.symbol || '?').slice(0, 4)}</span>}
              </button>
            )
          }
          if (node.type === 'kol') {
            return (
              <button
                key={node.id}
                type="button"
                className="pd-gal-node pd-gal-node--kol"
                style={{ width: r * 2, height: r * 2, transform: `translate3d(${node.x - r}px, ${node.y - r}px, 0)` }}
                onClick={() => handleNodeClick(node)}
                title={`@${node.handle}`}
              >
                {node.avatar
                  ? <img className="pd-gal-kol__img" src={node.avatar} alt="" draggable={false} onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(node.handle)}` }} />
                  : <span className="pd-gal-kol__sym">{(node.name || node.handle || '?').slice(0, 1).toUpperCase()}</span>}
              </button>
            )
          }
          // rel
          return (
            <button
              key={node.id}
              type="button"
              className="pd-gal-node pd-gal-node--rel"
              style={{ '--rel-color': node.color, width: r * 2, height: r * 2, transform: `translate3d(${node.x - r}px, ${node.y - r}px, 0)` }}
              onClick={() => handleNodeClick(node)}
              title={node.label}
            >
              <span className="pd-gal-rel__pct mono" style={{ color: node.color }}>{node.yesPct}%</span>
              <span className="pd-gal-rel__label">{node.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* Draw edges into the SVG layer behind the DOM nodes. KOL edges are dashed
   with a live offset (the ambient drift); token + rel edges are solid. */
function drawEdges(svg, nodes, links, dashOffset, dayMode) {
  if (!svg) return
  const byId = {}
  for (const n of nodes) byId[n.id] = n
  const baseStroke = dayMode ? 'rgba(15,23,42,' : 'rgba(255,255,255,'
  let markup = ''
  for (const l of links) {
    const s = byId[typeof l.source === 'object' ? l.source.id : l.source]
    const tg = byId[typeof l.target === 'object' ? l.target.id : l.target]
    if (!s || !tg) continue
    if (l.kind === 'kol') {
      markup += `<line x1="${s.x}" y1="${s.y}" x2="${tg.x}" y2="${tg.y}" stroke="${baseStroke}0.08)" stroke-width="1" stroke-dasharray="3 5" stroke-dashoffset="${dashOffset}" />`
    } else {
      const a = l.kind === 'token' ? '0.10' : '0.06'
      markup += `<line x1="${s.x}" y1="${s.y}" x2="${tg.x}" y2="${tg.y}" stroke="${baseStroke}${a})" stroke-width="1" />`
    }
  }
  svg.innerHTML = markup
}
