/**
 * Brain — CORTEX view (founder mockups 2026-08-25: "Market Cortex" /
 * "Cognitive Orbit"): the same live graph the Mind sky renders, laid out as a
 * structured instrument instead of a starfield. Domain hubs with live counts,
 * labeled spokes for what each hub is reading right now, and a click-to-deep-
 * dive panel. DOM + SVG (no canvas) — crisp at any DPR, real hover states.
 *
 * Data contract: identical to the Mind view (useBrainGraph). Every number on
 * this screen is the engine's own — nothing decorative.
 */
import React, { useMemo, useState } from 'react'
import useBrainGraph, { useBrainActivity, streamLine } from './use-brain-graph'
import './brain-cortex.css'

/* segment pills (founder mockup): one touch narrows the instrument to a slice
   of the mind — same dim language as the Mind tab's legend */
const HUB_SEG = {
  'organ:xdash': 'social', 'organ:peer': 'social',
  'organ:derivs': 'derivatives',
  'organ:whales': 'onchain',
  'organ:news': 'macro', 'organ:predictions': 'macro',
  'organ:prices': 'markets', 'organ:charts': 'markets',
  'hub:narratives': 'narratives', 'hub:projects': 'projects',
}
const SEGS = [
  ['all', 'All'], ['markets', 'Markets'], ['social', 'Social'],
  ['derivatives', 'Derivatives'], ['onchain', 'On-chain'], ['macro', 'Macro'],
  ['narratives', 'Narratives'], ['projects', 'Projects'],
]
const tsHHMM = (ts) => { try { return new Date(ts).toTimeString().slice(0, 5) } catch { return '' } }

const VBW = 1000, VBH = 640
const CX = VBW / 2, CY = VBH / 2

const ORGAN_SUB = {
  'organ:news': 'headlines · wires',
  'organ:xdash': 'X · mindshare',
  'organ:whales': 'large transfers',
  'organ:derivs': 'funding · OI · liqs',
  'organ:predictions': 'event odds',
  'organ:prices': 'the tape',
  'organ:charts': 'structure · levels',
  'organ:peer': 'peer agents',
}

function hubStat(n) {
  const v = Number(n?.meta?.vol_24h)
  if (Number.isFinite(v) && v > 0) return `${v >= 1000 ? `${(v / 1000).toFixed(1)}K` : Math.round(v)} reads/24h`
  return null
}

const fmtFresh = (h) => {
  if (h == null || !Number.isFinite(Number(h))) return null
  const n = Number(h)
  if (n < 1) return 'minutes ago'
  if (n < 48) return `${Math.round(n)}h ago`
  return `${Math.round(n / 24)}d ago`
}

/* deterministic layout — TWO labeled shells around the reasoning core (the
   Cognitive Orbit structure): SENSORY FEEDS on the outer ring, SYNTHESIS
   (lenses, narratives, projects) on the inner. */
const OUTER = { rx: 388, ry: 246 }
const INNER = { rx: 196, ry: 122 }
function buildCortex(data) {
  if (!data) return null
  const nodes = data.nodes || []
  const links = data.links || []
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const organs = nodes.filter((n) => n.type === 'organ')
  const lenses = nodes.filter((n) => n.type === 'lens').sort((a, b) => b.w - a.w)
  const narratives = nodes.filter((n) => n.type === 'narrative').sort((a, b) => b.w - a.w)
  const projects = nodes.filter((n) => n.type === 'project').sort((a, b) => b.w - a.w)

  // what each organ is perceiving right now
  const percepts = new Map() // organId -> [node]
  for (const l of links) {
    if (l.k !== 'perceived') continue
    const target = byId.get(l.t)
    if (!target) continue
    if (!percepts.has(l.s)) percepts.set(l.s, [])
    percepts.get(l.s).push(target)
  }
  for (const list of percepts.values()) list.sort((a, b) => (b.w || 0) - (a.w || 0))

  const outer = organs.map((n) => ({
    id: n.id, kind: 'organ', shell: 'outer', label: n.label, sub: ORGAN_SUB[n.id] || 'sensory feed',
    stat: hubStat(n), tone: n.tone, node: n,
    leaves: (percepts.get(n.id) || []).slice(0, 3),
    items: (percepts.get(n.id) || []).slice(0, 10),
  }))
  const inner = [
    {
      id: 'hub:lenses', kind: 'lens', shell: 'inner', label: 'Lenses', sub: 'how it thinks',
      stat: `${lenses.length} thinking`, leaves: [], items: lenses.slice(0, 10),
    },
    {
      id: 'hub:narratives', kind: 'narrative', shell: 'inner', label: 'Narratives', sub: 'what the street believes',
      stat: `${narratives.length} active`, leaves: [], items: narratives.slice(0, 10),
    },
    {
      id: 'hub:projects', kind: 'project', shell: 'inner', label: 'Projects', sub: 'entities under watch',
      stat: `${projects.length} tracked`, leaves: [], items: projects.slice(0, 10),
    },
  ]

  // top insights: the freshest, most-reinforced intel on the board
  const insights = nodes
    .filter((nd) => nd.type === 'intel')
    .sort((a, b) => ((a.fresh_h ?? 999) - (b.fresh_h ?? 999)) || ((b.w || 0) - (a.w || 0)))
    .slice(0, 4)

  outer.forEach((h, i) => {
    const a = (i / outer.length) * Math.PI * 2 - Math.PI / 2
    h.x = CX + Math.cos(a) * OUTER.rx
    h.y = CY + Math.sin(a) * OUTER.ry
    h.a = a
    h.leafPos = h.leaves.map((_, li) => {
      const la = a + (li - (h.leaves.length - 1) / 2) * 0.30
      return { x: h.x + Math.cos(la) * 112, y: h.y + Math.sin(la) * 76 }
    })
  })
  // inner shell offset so nothing stacks under the outer top hub
  inner.forEach((h, i) => {
    const a = (i / inner.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / 3
    h.x = CX + Math.cos(a) * INNER.rx
    h.y = CY + Math.sin(a) * INNER.ry
    h.a = a
    h.leafPos = []
  })

  const hubs = [...outer, ...inner]
  return { hubs, byId, core: data.core || null, insights, counts: data.counts || {} }
}

const leafLabel = (nd) => {
  const raw = nd.type === 'project' ? `$${nd.label}` : nd.label
  return raw.length > 22 ? `${raw.slice(0, 21)}…` : raw
}

/* hand-drawn 24px stroke icons — one per hub, no icon-library soup */
const IC = {
  'organ:news': <><path d="M4 6h16" /><path d="M4 11h16" /><path d="M4 16h10" /></>,
  'organ:xdash': <><circle cx="12" cy="12" r="3.6" /><path d="M15.6 12v1.6a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.4 6.9" /></>,
  'organ:whales': <><path d="M2.5 13.5c2.4-3.2 4.9-3.2 7.3 0s4.9 3.2 7.3 0 3.4-2.4 4.4-1.6" /><path d="M4 18c2-2.2 4-2.2 6 0s4 2.2 6 0" /></>,
  'organ:derivs': <><path d="M7.5 3.5v3M7.5 16.5v3M16.5 6.5v3M16.5 18.5v2" /><rect x="5.5" y="6.5" width="4" height="10" rx="1" /><rect x="14.5" y="9.5" width="4" height="9" rx="1" /></>,
  'organ:predictions': <><path d="M4.5 16.5a7.5 7.5 0 1 1 15 0" /><path d="M12 16.5l3.6-4.4" /><circle cx="12" cy="16.5" r="1.2" /></>,
  'organ:prices': <path d="M2.5 12.5h4L9 6l4.5 12 2.5-5.5h5.5" />,
  'organ:charts': <><path d="M6 20v-8" /><path d="M12 20V5" /><path d="M18 20v-11" /></>,
  'organ:peer': <><circle cx="7" cy="8.5" r="2.6" /><circle cx="17" cy="15.5" r="2.6" /><path d="M9.2 9.9l5.6 3.7" /></>,
  'hub:lenses': <><path d="M2.5 12s3.5-6.2 9.5-6.2S21.5 12 21.5 12s-3.5 6.2-9.5 6.2S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.7" /></>,
  'hub:narratives': <><path d="M12 3.5 3.5 8.2l8.5 4.7 8.5-4.7L12 3.5Z" /><path d="M3.5 13.2l8.5 4.7 8.5-4.7" /></>,
  'hub:projects': <><path d="M12 3 4.5 7.3v8.6L12 20.2l7.5-4.3V7.3L12 3Z" /><path d="M4.5 7.3 12 11.6l7.5-4.3" /><path d="M12 11.6v8.6" /></>,
}
const HubIcon = ({ id }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {IC[id] || <circle cx="12" cy="12" r="6" />}
  </svg>
)

export default function BrainCortex({ onDive }) {
  const { loading, error, data, refetch } = useBrainGraph()
  const { feed } = useBrainActivity()
  const [sel, setSel] = useState(null)
  const [seg, setSeg] = useState('all')

  const cortex = useMemo(() => buildCortex(data), [data])
  const segDim = (id) => seg !== 'all' && HUB_SEG[id] !== seg

  if (loading && !data) return <div className="bc bc--loading"><div className="sk bc-sk" /></div>
  if (error && !data) {
    return <div className="bc bc--error">The cortex could not load. <button type="button" onClick={refetch}>Retry</button></div>
  }
  if (!cortex) return null

  const selected = sel ? cortex.hubs.find((h) => h.id === sel) : null

  return (
    <div className="bc">
      <div className="bc-stage">
        {/* segment pills — narrow the instrument to one slice of the mind */}
        <div className="bc-pills" role="group" aria-label="focus a segment">
          {SEGS.map(([id, label]) => (
            <button
              key={id} type="button"
              className={`bc-pill${seg === id ? ' bc-pill--on' : ''}`}
              onClick={() => setSeg(id)}
            >{label}</button>
          ))}
        </div>
        {/* connective tissue + flowing data motes — stretches with the stage */}
        <svg className="bc-web" viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="none" aria-hidden>
          <ellipse cx={CX} cy={CY} rx={OUTER.rx} ry={OUTER.ry} className="bc-orbit" />
          <ellipse cx={CX} cy={CY} rx={INNER.rx} ry={INNER.ry} className="bc-orbit bc-orbit--inner" />
          {cortex.hubs.map((h, hi) => {
            const dim = (sel && sel !== h.id) || segDim(h.id)
            return (
              <g key={h.id}>
                <line x1={CX} y1={CY} x2={h.x} y2={h.y} className={`bc-spine${dim ? ' bc-spine--dim' : ''}`} />
                {h.leafPos.map((lp, i) => (
                  <line key={i} x1={h.x} y1={h.y} x2={lp.x} y2={lp.y} className={`bc-vein${segDim(h.id) ? ' bc-spine--dim' : ''}`} />
                ))}
                {/* a perception in flight: hub → core, forever */}
                {!dim && (
                  <circle r={h.shell === 'outer' ? 1.9 : 1.5} className={`bc-mote${h.shell === 'inner' ? ' bc-mote--warm' : ''}`}>
                    <animateMotion
                      dur={`${(h.shell === 'outer' ? 5.5 : 7.5) + (hi % 4) * 1.3}s`}
                      begin={`${hi * 0.9}s`}
                      repeatCount="indefinite"
                      path={`M ${h.x} ${h.y} L ${CX} ${CY}`}
                    />
                  </circle>
                )}
              </g>
            )
          })}
        </svg>

        {/* shell band labels — the architecture reads itself; offset off-axis
            so they never sit under the top hubs */}
        <span className="bc-shell-label" style={{ left: '31%', top: `${((CY - OUTER.ry + 4) / VBH) * 100}%` }}>Sensory feeds</span>
        <span className="bc-shell-label bc-shell-label--warm" style={{ left: '41.5%', top: `${((CY - INNER.ry - 4) / VBH) * 100}%` }}>Synthesis</span>
        <span className="bc-shell-label bc-shell-label--core" style={{ left: '50%', top: `${((CY + 70) / VBH) * 100}%` }}>Reasoning core</span>

        {/* the reasoning core — a live instrument, not a label */}
        <button
          type="button"
          className={`bc-core${sel === 'core' ? ' bc-core--on' : ''}`}
          style={{ left: `${(CX / VBW) * 100}%`, top: `${(CY / VBH) * 100}%` }}
          onClick={() => setSel(sel === 'core' ? null : 'core')}
        >
          <span className="bc-core-ring" aria-hidden />
          <span className="bc-core-orb" aria-hidden />
          <span className="bc-core-k">The Read</span>
          {cortex.core?.regime && <span className="bc-core-sub">{String(cortex.core.regime).split('–')[0].trim()}</span>}
          {cortex.counts?.nodes && <span className="bc-core-n">{cortex.counts.nodes} nodes synthesized</span>}
        </button>

        {/* domain hubs — glass medallions */}
        {cortex.hubs.map((h) => (
          <React.Fragment key={h.id}>
            <button
              type="button"
              className={`bc-hub bc-hub--${h.shell}${sel === h.id ? ' bc-hub--on' : ''}${(sel && sel !== h.id && sel !== 'core') || segDim(h.id) ? ' bc-hub--dim' : ''}`}
              style={{ left: `${(h.x / VBW) * 100}%`, top: `${(h.y / VBH) * 100}%` }}
              onClick={() => setSel(sel === h.id ? null : h.id)}
            >
              <span className="bc-medal"><HubIcon id={h.id} /></span>
              <span className="bc-hub-name">{h.label}</span>
              {h.stat && <span className="bc-hub-stat">{h.stat}</span>}
            </button>
            {h.leaves.map((nd, i) => (
              <button
                key={nd.id}
                type="button"
                className="bc-leaf"
                style={{ left: `${(h.leafPos[i].x / VBW) * 100}%`, top: `${(h.leafPos[i].y / VBH) * 100}%` }}
                onClick={() => onDive?.(nd.id)}
                title="open in the sky"
              >
                {leafLabel(nd)}
              </button>
            ))}
          </React.Fragment>
        ))}
        {/* top insights — the freshest reinforced intel (hidden while diving) */}
        {!selected && sel !== 'core' && cortex.insights.length > 0 && (
          <aside className="bc-insights" aria-label="top insights">
            <span className="bc-panel-tag">Top insights</span>
            {cortex.insights.map((nd) => (
              <button key={nd.id} type="button" className="bc-insight" onClick={() => onDive?.(nd.id)}>
                <span className="bc-insight-text">{nd.label}</span>
                <span className="bc-insight-meta">
                  {Number(nd.w) > 1 ? `×${Math.round(nd.w)} observed` : 'observed'}
                  {fmtFresh(nd.fresh_h) ? ` · ${fmtFresh(nd.fresh_h)}` : ''}
                </span>
              </button>
            ))}
          </aside>
        )}

        {/* activity feed — the same inner voice as the sky */}
        {feed.length > 0 && (
          <div className="bc-feed" aria-label="activity feed">
            <span className="bc-panel-tag">Activity</span>
            {feed.slice(0, 5).map((e) => {
              const ln = streamLine(e)
              return (
                <div key={e.id} className="bc-feed-row">
                  <span className="bc-feed-ts">{tsHHMM(e.ts)}</span>
                  <span className={`bc-feed-chip${ln.tone ? ` bc-feed-chip--${ln.tone}` : ''}`}>{ln.chip}</span>
                  <span className="bc-feed-text">{ln.text}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* deep dive */}
      {(selected || sel === 'core') && (
        <aside className="bc-dive">
          <div className="bc-dive-head">
            <div>
              <span className="bc-dive-eyebrow">{sel === 'core' ? 'Reasoning core' : selected.kind === 'organ' ? 'Sensory feed' : 'Synthesis'}</span>
              <h3 className="bc-dive-title">{sel === 'core' ? 'The Read' : selected.label}</h3>
              <p className="bc-dive-sub">{sel === 'core' ? 'what every feed resolves into' : selected.sub}</p>
            </div>
            <button type="button" className="bc-dive-close" onClick={() => setSel(null)} aria-label="close">✕</button>
          </div>

          {sel === 'core' ? (
            <>
              {cortex.core?.regime && <p className="bc-dive-read">{cortex.core.regime}</p>}
              <button type="button" className="bc-dive-cta" onClick={() => onDive?.('core')}>Open in the sky →</button>
            </>
          ) : (
            <>
              {selected.stat && <p className="bc-dive-stat">{selected.stat}</p>}
              <div className="bc-dive-list">
                {selected.items.length === 0 && <p className="bc-dive-empty">Nothing perceived in this window.</p>}
                {selected.items.map((nd) => (
                  <button key={nd.id} type="button" className="bc-row" onClick={() => onDive?.(nd.id)}>
                    <span className={`bc-row-tone${nd.tone > 0.2 ? ' bc-row-tone--up' : nd.tone < -0.2 ? ' bc-row-tone--down' : ''}`} aria-hidden />
                    <span className="bc-row-label">{nd.type === 'project' ? `$${nd.label}` : nd.label}</span>
                    <span className="bc-row-meta">{fmtFresh(nd.fresh_h) || nd.type}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="bc-dive-cta" onClick={() => onDive?.(selected.node?.id || selected.items[0]?.id)}>Open in the sky →</button>
            </>
          )}
        </aside>
      )}
    </div>
  )
}
