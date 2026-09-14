/**
 * Brain — The Board.
 *
 * Two views:
 *   Intel  — the desk's lens-agent narratives (Onchain / Institutional /
 *            Leverage / Degen / Macro). Every row is an interpreted read, not a
 *            raw event. Source: useBrainDesk (LLM desk, /api/brain-desk).
 *   Social — the attention leaderboard, tiered, with the diffusion column.
 * A synthesized regime + brief sits on top.
 */
import React, { useMemo, useState } from 'react'
import useBrainBoard from './use-brain-board'
import useBrainDesk from './use-brain-desk'
import BrainSectionHead from './brain-section-head'
import './brain-board.css'

const VIEWS = [
  { key: 'intel', label: 'Intel' },
  { key: 'social', label: 'Social' },
]
const LENS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'onchain', label: 'Onchain' },
  { key: 'leverage', label: 'Leverage' },
  { key: 'institutional', label: 'Institutional' },
  { key: 'degen', label: 'Degen' },
  { key: 'macro', label: 'Macro' },
]
const TIER_ORDER = { top_tier: 0, solid_setup: 1, uphill_climb: 2, avoid: 3 }

function human(v) {
  if (v == null) return null
  const x = Number(v)
  if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(1)}B`
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(1)}M`
  if (Math.abs(x) >= 1e3) return `$${(x / 1e3).toFixed(0)}K`
  return `$${x.toFixed(0)}`
}
function ageLabel(m) {
  if (m == null) return '—'
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h`
  return `${Math.floor(m / 1440)}d`
}

function Diffusion({ d }) {
  if (!d) return <span className="bb-diff bb-diff--none">—</span>
  const cls = d.state === 'broadening' ? 'bb-diff--up' : d.state === 'single' ? 'bb-diff--flat' : 'bb-diff--steady'
  return (
    <span className={`bb-diff ${cls}`} title={`${d.clusters ?? '?'} communities${d.fresh ? `, ${d.fresh} new` : ''} · ${d.state}`}>
      <span className="bb-diff-arrow">{d.arrow}</span>
      <span className="bb-diff-n">{d.clusters ?? '?'}</span>
      {d.fresh > 0 && <span className="bb-diff-new">+{d.fresh}</span>}
    </span>
  )
}
function Logo({ image, symbol }) {
  const [bad, setBad] = useState(false)
  if (image && !bad) return <img className="bb-logo" src={image} alt="" loading="lazy" onError={() => setBad(true)} />
  return <span className="bb-logo bb-logo--fallback">{(symbol || '?').slice(0, 1)}</span>
}

/* Desk intel row — the interpreted read through a lens. */
function DeskRow({ r }) {
  return (
    <div className="bb-row bb-row--desk" role="row">
      <span className="bb-c bb-proj" role="cell">
        <span className={`bb-dot bb-${r.bias}`} />
        <span className="bb-proj-name">{r.project}</span>
      </span>
      <span className="bb-c bb-intel" role="cell">{r.read}</span>
      <span className="bb-c bb-lens" role="cell"><span className={`bb-lens-chip bb-lens--${String(r.lens).toLowerCase()}`}>{r.lens}</span></span>
      <span className="bb-c bb-cat" role="cell">{r.category ? <span className="bb-cat-chip">{r.category}</span> : null}</span>
    </div>
  )
}
function SocialRow({ r }) {
  return (
    <div className="bb-row bb-row--social" role="row">
      <span className="bb-c bb-age" role="cell">{ageLabel(r.ageMins)}</span>
      <span className="bb-c bb-project" role="cell">
        <Logo image={r.image} symbol={r.symbol} />
        <span className="bb-project-txt">
          <span className="bb-name">{r.name}</span>
          <span className="bb-sym">{r.symbol}{r.mcap != null && <span className="bb-mcap"> · {human(r.mcap)}</span>}</span>
        </span>
      </span>
      <span className="bb-c bb-read" role="cell">
        <span className="bb-read-txt">{r.read || '—'}</span>
        {r.derived && <span className="bb-read-derived" title="derived from the social spine until the takes worker ships">~</span>}
      </span>
      <span className="bb-c bb-diffusion" role="cell"><Diffusion d={r.diffusion} /></span>
      <span className="bb-c bb-tier" role="cell"><span className={`bb-tier-chip bb-tier--${r.tierClass}`} title={r.tierTitle || undefined}>{r.tierLabel}</span></span>
    </div>
  )
}

function Brief({ regime, brief, news }) {
  const bullets = brief?.length ? brief.map((t) => ({ title: t })) : (news || []).map((n) => ({ title: n.title, assets: n.assets }))
  if (!regime && !bullets.length) return null
  return (
    <div className="bb-brief">
      <div className="bb-brief-l">
        <span className="bb-brief-tag">Desk</span>
        {regime && <span className="bb-brief-regime">{regime}</span>}
      </div>
      <div className="bb-brief-items">
        {bullets.slice(0, 4).map((n, i) => (
          <div key={i} className="bb-brief-item">
            <span className="bb-brief-dot" />
            <span className="bb-brief-txt">{n.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function BrainBoard() {
  const [view, setView] = useState('intel')
  const [lens, setLens] = useState('all')
  const desk = useBrainDesk()
  const board = useBrainBoard()

  const intelDisplay = useMemo(
    () => (lens === 'all' ? desk.intel : desk.intel.filter((r) => String(r.lens).toLowerCase() === lens)),
    [desk.intel, lens]
  )
  const socialDisplay = useMemo(
    () => [...board.socialRows].sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || (b.signal ?? 0) - (a.signal ?? 0)),
    [board.socialRows]
  )

  return (
    <section className="bb">
      <BrainSectionHead
        eyebrow="The Board"
        title="Signals & Social"
        sub="lens-read intel + the tiered attention leaderboard"
      />
      <Brief regime={desk.regime} brief={desk.brief} news={board.news} />

      <div className="bb-head">
        <div className="bb-views" role="tablist" aria-label="board view">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={view === v.key ? 'is-on' : ''} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
        {view === 'intel' ? (
          <div className="bb-filters">
            {LENS_FILTERS.map((g) => (
              <button key={g.key} type="button" className={lens === g.key ? 'is-on' : ''} onClick={() => setLens(g.key)}>{g.label}</button>
            ))}
          </div>
        ) : (
          <span className="bb-sub">tiered · derived reads until the takes worker ships</span>
        )}
      </div>

      <div className="bb-table" role="table">
        {view === 'intel' ? (
          <>
            <div className="bb-row bb-row--desk bb-row--head" role="row">
              <span className="bb-c bb-proj">Project</span>
              <span className="bb-c bb-intel">Intel</span>
              <span className="bb-c bb-lens">Lens</span>
              <span className="bb-c bb-cat">Category</span>
            </div>
            {desk.loading && !intelDisplay.length && Array.from({ length: 8 }).map((_, i) => (
              <div className="bb-row bb-row--desk bb-row--sk" key={i}>
                <span className="sk bb-sk" /><span className="sk bb-sk" /><span className="sk bb-sk" /><span className="sk bb-sk" />
              </div>
            ))}
            {!desk.loading && desk.error && !intelDisplay.length && <div className="bb-empty">The desk is warming up — first read takes a moment.</div>}
            {intelDisplay.map((r, i) => <DeskRow key={`${r.project}-${i}`} r={r} />)}
          </>
        ) : (
          <>
            <div className="bb-row bb-row--social bb-row--head" role="row">
              <span className="bb-c bb-age">Age</span>
              <span className="bb-c bb-project">Project</span>
              <span className="bb-c bb-read">The Read</span>
              <span className="bb-c bb-diffusion">Diffusion</span>
              <span className="bb-c bb-tier">Tier</span>
            </div>
            {board.loading && !socialDisplay.length && Array.from({ length: 8 }).map((_, i) => (
              <div className="bb-row bb-row--social bb-row--sk" key={i}>
                <span className="sk bb-sk" /><span className="sk bb-sk" /><span className="sk bb-sk" /><span className="sk bb-sk" /><span className="sk bb-sk" />
              </div>
            ))}
            {socialDisplay.map((r) => <SocialRow key={`${r.symbol}-${r.rank}`} r={r} />)}
          </>
        )}
      </div>
    </section>
  )
}
