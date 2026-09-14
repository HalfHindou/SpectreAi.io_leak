/**
 * Brain — Situations (Street desk).
 *
 * The founder's aixbt-style street-desk feed: one row per live situation the
 * engine is watching. `$ASSET` + type tag + relative time on the left, a
 * sign-colored 24h move chip + stance word on the right, the terse lowercase
 * take as the body (rendered as-is — the lingo is intentional). Caps at 12
 * with a text "show more". Renders nothing when the feed is empty/404.
 */
import React, { useState } from 'react'
import useBrainSituations from './use-brain-situations'
import BrainSectionHead from './brain-section-head'
import './brain-situations.css'

const CAP = 12

function ago(ts) {
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return null
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function stanceClass(stance) {
  const s = String(stance || '').toLowerCase()
  if (s === 'avoid') return 'bsi-stance--avoid'
  if (s === 'constructive') return 'bsi-stance--constructive'
  return 'bsi-stance--muted' // cautious / watching / unknown
}

function MoveChip({ pct }) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return null
  const tone = n > 0 ? 'bsi-move--up' : n < 0 ? 'bsi-move--down' : 'bsi-move--flat'
  return <span className={`bsi-move ${tone}`}>{n > 0 ? '+' : ''}{n.toFixed(1)}%</span>
}

function SituationRow({ s }) {
  const asset = s?.asset ? `$${String(s.asset).replace(/^\$/, '')}` : null
  const type = s?.situation_type ? String(s.situation_type).replace(/_/g, ' ').trim().toUpperCase() : null
  const when = ago(s?.created_at || s?.ts)
  const take = s?.take && String(s.take).trim()
  const stance = s?.stance ? String(s.stance).toLowerCase() : null
  return (
    <article className="bsi-row">
      <div className="bsi-head">
        {asset && <span className="bsi-asset">{asset}</span>}
        {type && <span className="bsi-type">{type}</span>}
        {when && <span className="bsi-time">{when}</span>}
        <span className="bsi-head-right">
          <MoveChip pct={s?.move_24h_pct} />
          {stance && <span className={`bsi-stance ${stanceClass(stance)}`}>{stance}</span>}
        </span>
      </div>
      {take && <p className="bsi-take">{take}</p>}
    </article>
  )
}

export default function BrainSituations() {
  const { situations } = useBrainSituations()
  const [expanded, setExpanded] = useState(false)

  const list = Array.isArray(situations) ? situations.filter((s) => s && (s.take || s.asset)) : []
  if (!list.length) return null // feed empty/404 → section hides; board + intel still stand

  const rows = expanded ? list : list.slice(0, CAP)
  const rest = list.length - CAP

  return (
    <section className="bsi" aria-label="situations">
      <BrainSectionHead eyebrow="Street desk" title="Situations" />
      <div className="bsi-feed">
        {rows.map((s, i) => <SituationRow key={s?.situation_id || `${s?.asset || 'x'}-${i}`} s={s} />)}
      </div>
      {rest > 0 && (
        <button type="button" className="bsi-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'show less' : `show ${rest} more`}
        </button>
      )}
    </section>
  )
}
