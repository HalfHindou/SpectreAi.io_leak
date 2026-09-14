/**
 * RwaComposabilityWeb — the live composability map of tokenized RWAs as a real
 * force-directed network: issuers, stablecoins, DeFi protocols, chains and CEXs
 * wired by how they actually compose (backed_by, collateral_for, lent_on,
 * paired_with, …). Surfaces the systemic plumbing nobody else draws.
 *
 * Deterministic synchronous force sim (runs once per size) + a single rAF that
 * streams capital-flow particles along the edges (count/speed ∝ TVL-at-hop,
 * colored by the source kind). Hover lights a node's links; click a node to
 * pin a focus trace + readout. rAF is visibility- and reduced-motion-guarded.
 */
import React, { useMemo, useRef, useState, useEffect } from 'react'
import './rwa-composability-web.css'

// The bundled /api/rwa/bundle-risk currently ships an EMPTY composability graph
// (0 nodes); the direct endpoint is fully populated. Self-fetch so the web works
// regardless — and use the passed graph only if it already has nodes.
let _graphCache = null
function useComposabilityGraph(passed) {
  const [g, setG] = useState(() => (passed?.nodes?.length ? passed : _graphCache))
  useEffect(() => {
    if (passed?.nodes?.length) { setG(passed); return undefined }
    if (_graphCache?.nodes?.length) { setG(_graphCache); return undefined }
    let cancelled = false
    fetch('/data-api/v1/rwa/composability/graph')
      .then((r) => r.json())
      .then((j) => {
        const data = j?.data || j
        if (data?.nodes?.length) { _graphCache = data; if (!cancelled) setG(data) }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [passed])
  return g
}

// Entity-kind colours from the canonical TA_CATEGORICAL family (no purple —
// EUPHORIA-reserved). Each kind gets a distinct, on-brand hue.
const KIND = {
  rwa_issuer: { label: 'Issuer', color: '#06B6D4', glow: 'rgba(6,182,212,0.45)' },
  stablecoin: { label: 'Stablecoin', color: '#34D399', glow: 'rgba(52,211,153,0.45)' },
  defi_protocol: { label: 'DeFi', color: '#3B82F6', glow: 'rgba(59,130,246,0.45)' },
  chain: { label: 'Chain', color: '#F59E0B', glow: 'rgba(245,158,11,0.42)' },
  cex: { label: 'CEX', color: '#94A3B8', glow: 'rgba(148,163,184,0.4)' },
}
const REL_LABEL = {
  backed_by: 'backed by', collateral_for: 'collateral for', redeemable_for: 'redeemable for',
  chain_native: 'native to', wrapped_in: 'wrapped in', paired_with: 'paired with', lent_on: 'lent on',
}

function pretty(id) {
  return String(id || '').split('-').map((w) => w.length <= 4 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(' ')
}

function fmtUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}

// Callback ref so width is measured whenever the stage mounts — the component
// returns null until the graph self-fetches, so a mount-time effect would miss it.
function useWidth() {
  const [w, setW] = useState(0)
  const roRef = useRef(null)
  const ref = React.useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (node) {
      const u = () => setW(node.clientWidth)
      u()
      roRef.current = new ResizeObserver(u)
      roRef.current.observe(node)
    }
  }, [])
  return [ref, w]
}

const H = 500

function layout(graph, W) {
  const rawNodes = graph?.nodes || []
  const rawEdges = (graph?.edges || []).filter((e) => e.source && e.target)
  if (!rawNodes.length || !W) return { nodes: [], edges: [] }

  const idx = new Map(rawNodes.map((n, i) => [n.id, i]))
  const deg = new Array(rawNodes.length).fill(0)
  const edges = []
  for (const e of rawEdges) {
    const s = idx.get(e.source); const t = idx.get(e.target)
    if (s == null || t == null) continue
    deg[s]++; deg[t]++
    edges.push({
      s, t, rel: e.relationship, notes: e.notes,
      yield: Number.isFinite(e.yield_apy_pct) ? e.yield_apy_pct : null,
      tvl: Number.isFinite(e.tvl_at_hop_usd) ? e.tvl_at_hop_usd : null,
      srcKind: e.source_kind || rawNodes[s]?.kind,
    })
  }
  const cx = W / 2; const cy = H / 2
  const nodes = rawNodes.map((n, i) => ({
    ...n,
    r: 13 + Math.min(4, deg[i]) * 4,
    x: cx + Math.cos((i / rawNodes.length) * Math.PI * 2) * W * 0.32,
    y: cy + Math.sin((i / rawNodes.length) * Math.PI * 2) * H * 0.34,
    vx: 0, vy: 0, deg: deg[i],
  }))

  const REP = 5200; const SPRING = 0.02; const IDEAL = Math.min(150, W / 7)
  for (let k = 0; k < 420; k++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j]
        let dx = a.x - b.x; let dy = a.y - b.y
        let d2 = dx * dx + dy * dy || 0.01
        const f = REP / d2
        const d = Math.sqrt(d2)
        const ux = dx / d; const uy = dy / d
        a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f
      }
    }
    for (const e of edges) {
      const a = nodes[e.s]; const b = nodes[e.t]
      const dx = b.x - a.x; const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      const f = (d - IDEAL) * SPRING
      const ux = dx / d; const uy = dy / d
      a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f
    }
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.004; n.vy += (cy - n.y) * 0.006
      n.x += n.vx * 0.5; n.y += n.vy * 0.5
      n.vx *= 0.82; n.vy *= 0.82
      n.x = Math.max(n.r + 70, Math.min(W - n.r - 12, n.x))
      n.y = Math.max(n.r + 10, Math.min(H - n.r - 10, n.y))
    }
  }
  return { nodes, edges }
}

// Particle definitions: per-edge flow weighted by TVL-at-hop (log-scaled).
// Heavier plumbing carries more, faster particles. Position is computed live in
// the rAF from current node coords — these only carry the edge + phase + speed.
function buildFlows(edges) {
  const tvls = edges.map((e) => e.tvl || 0).filter((v) => v > 0)
  const maxLog = tvls.length ? Math.max(...tvls.map((v) => Math.log10(1 + v))) : 1
  const out = []
  edges.forEach((e, ei) => {
    const w = e.tvl ? Math.log10(1 + e.tvl) / (maxLog || 1) : 0.35
    const count = Math.max(1, Math.min(3, 1 + Math.round(w * 2)))
    const speed = 0.05 + w * 0.13
    const color = (KIND[e.srcKind] || KIND.cex).color
    for (let p = 0; p < count; p++) {
      out.push({ ei, s: e.s, t: e.t, phase: p / count, speed, color, r: 1.6 + w * 1.6 })
    }
  })
  return out
}

export default function RwaComposabilityWeb({ graph: passedGraph }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const [focus, setFocus] = useState(null)
  const graph = useComposabilityGraph(passedGraph)
  const { nodes, edges } = useMemo(() => layout(graph, w), [graph, w])
  const flows = useMemo(() => buildFlows(edges), [edges])
  const dotRefs = useRef([])

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
    []
  )

  // Capital-flow animation. Single rAF, refs only (no React churn), paused when
  // the tab is hidden, off entirely under prefers-reduced-motion.
  useEffect(() => {
    if (reduceMotion || !w || !nodes.length || !flows.length) return undefined
    let raf = 0
    let start = 0
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      if (!start) start = now
      const elapsed = (now - start) / 1000
      for (let i = 0; i < flows.length; i++) {
        const el = dotRefs.current[i]
        if (!el) continue
        const f = flows[i]
        const a = nodes[f.s]; const b = nodes[f.t]
        if (!a || !b) { el.style.opacity = '0'; continue }
        const tt = (f.phase + elapsed * f.speed) % 1
        const u = 1 - tt
        const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2 - 14
        const x = u * u * a.x + 2 * u * tt * mx + tt * tt * b.x
        const y = u * u * a.y + 2 * u * tt * my + tt * tt * b.y
        el.setAttribute('cx', x.toFixed(1))
        el.setAttribute('cy', y.toFixed(1))
        el.style.opacity = (Math.sin(Math.PI * tt) * 0.85).toFixed(2)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [nodes, flows, w, reduceMotion])

  if (!graph?.nodes?.length) return null
  const kindsPresent = [...new Set(nodes.map((n) => n.kind))].filter((k) => KIND[k])

  // The "active" node drives highlight/dim: hover wins, else the pinned focus.
  const activeIdx = hover != null ? hover : focus
  const neighbors = (idx) => new Set(
    edges.flatMap((e) => (e.s === idx ? [e.t] : e.t === idx ? [e.s] : []))
  )
  const activeNeighbors = activeIdx != null ? neighbors(activeIdx) : null

  const focusNode = focus != null ? nodes[focus] : null
  const focusLinks = focus != null
    ? edges
        .filter((e) => e.s === focus || e.t === focus)
        .map((e) => {
          const otherIdx = e.s === focus ? e.t : e.s
          return { other: nodes[otherIdx], rel: e.rel, yield: e.yield, tvl: e.tvl, outgoing: e.s === focus }
        })
        .sort((a, b) => (b.yield || -1) - (a.yield || -1))
    : []

  return (
    <div className="rcw">
      <div className="rcw-head">
        <div className="rcw-headline">
          <span className="rcw-title">Composability Web</span>
          <span className="rcw-sub">
            {nodes.length} entities · {edges.length} links · live capital flow ·{' '}
            <span className="rcw-hint">click a node to trace it</span>
          </span>
        </div>
        <div className="rcw-legend">
          {kindsPresent.map((k) => (
            <span key={k} className="rcw-leg"><span className="rcw-leg-dot" style={{ background: KIND[k].color }} />{KIND[k].label}</span>
          ))}
        </div>
      </div>

      <div
        className={`rcw-stage${focus != null ? ' rcw-stage--focused' : ''}`}
        ref={ref}
        style={{ height: H }}
        onClick={() => setFocus(null)}
      >
        {w > 0 && (
          <svg className="rcw-edges" width={w} height={H} aria-hidden>
            {edges.map((e, i) => {
              const a = nodes[e.s]; const b = nodes[e.t]
              if (!a || !b) return null
              const active = activeIdx != null && (e.s === activeIdx || e.t === activeIdx)
              const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2
              const label = active ? (REL_LABEL[e.rel] || e.rel) : null
              const yld = active && Number.isFinite(e.yield) ? ` · ${e.yield.toFixed(1)}%` : ''
              return (
                <g key={i} className={`rcw-edge${active ? ' rcw-edge--active' : ''}${activeIdx != null && !active ? ' rcw-edge--dim' : ''}`}>
                  <path d={`M ${a.x} ${a.y} Q ${mx} ${my - 14} ${b.x} ${b.y}`} className="rcw-line" />
                  {label && <text x={mx} y={my - 16} className="rcw-rel">{label}{yld}</text>}
                </g>
              )
            })}
          </svg>
        )}

        {/* Capital-flow particle layer */}
        {w > 0 && !reduceMotion && (
          <svg className="rcw-flow" width={w} height={H} aria-hidden>
            {flows.map((f, i) => (
              <circle
                key={i}
                ref={(el) => { dotRefs.current[i] = el }}
                r={f.r}
                fill={f.color}
                opacity="0"
                className="rcw-dot"
                style={{ color: f.color }}
              />
            ))}
          </svg>
        )}

        {w > 0 && nodes.map((n, i) => {
          const k = KIND[n.kind] || KIND.cex
          const isActive = activeIdx === i
          const isFocus = focus === i
          const dim = activeIdx != null && activeIdx !== i && !(activeNeighbors && activeNeighbors.has(i))
          return (
            <div
              key={n.id}
              className={`rcw-node${isActive ? ' rcw-node--active' : ''}${isFocus ? ' rcw-node--focus' : ''}${dim ? ' rcw-node--dim' : ''}`}
              style={{ left: n.x, top: n.y, width: n.r * 2, height: n.r * 2 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(ev) => { ev.stopPropagation(); setFocus((cur) => (cur === i ? null : i)) }}
              title={`${pretty(n.id)} · ${k.label}${n.deg ? ` · ${n.deg} links` : ''}`}
            >
              <span className="rcw-orb" style={{ background: `radial-gradient(circle at 35% 30%, ${k.color}, ${k.color}cc 55%, ${k.color}66)`, boxShadow: `0 0 0 1.5px ${k.color}aa, 0 0 ${isActive ? 22 : 12}px ${k.glow}` }} />
              <span className="rcw-node-label">{pretty(n.id)}</span>
            </div>
          )
        })}

        {/* Focus readout */}
        {focusNode && (
          <div className="rcw-readout" onClick={(e) => e.stopPropagation()}>
            <div className="rcw-readout-head">
              <span className="rcw-readout-dot" style={{ background: (KIND[focusNode.kind] || KIND.cex).color }} />
              <span className="rcw-readout-name">{pretty(focusNode.id)}</span>
              <button type="button" className="rcw-readout-close" onClick={() => setFocus(null)} aria-label="Clear focus">×</button>
            </div>
            <div className="rcw-readout-meta">{(KIND[focusNode.kind] || KIND.cex).label} · {focusLinks.length} connection{focusLinks.length === 1 ? '' : 's'}</div>
            <ul className="rcw-readout-links">
              {focusLinks.slice(0, 7).map((l, i) => (
                <li key={i} className="rcw-readout-link">
                  <span className="rcw-readout-rel">{l.outgoing ? '→' : '←'} {REL_LABEL[l.rel] || l.rel}</span>
                  <span className="rcw-readout-other">{pretty(l.other?.id)}</span>
                  {(Number.isFinite(l.yield) || l.tvl) && (
                    <span className="rcw-readout-stat mono">
                      {Number.isFinite(l.yield) ? `${l.yield.toFixed(1)}%` : ''}
                      {l.tvl ? `${Number.isFinite(l.yield) ? ' · ' : ''}${fmtUsd(l.tvl)}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
