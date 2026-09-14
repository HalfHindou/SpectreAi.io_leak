/**
 * Brain — Idea Book.
 *
 * Phase 4 surface: the desk DEBATED these. Each idea is a trade_idea object —
 * $ASSET, direction (long/short), entry / invalidation / horizon, conviction —
 * plus the differentiator: the lens DEBATE strip (six specialist agents voted)
 * and the critic's verdict on record. Renders only when the engine has shipped
 * ideas; absent → the section vanishes with no placeholder, no gap.
 *
 * Design discipline (founder rejected AI-slop): no colored left bars, no glyphs,
 * no decorative gradients. Warm-white on glass, near-invisible borders, mono
 * numerals. Color appears ONLY as market semantics — the direction word, the
 * lens dots, the verdict / status / live-P&L chips.
 */
import React from 'react'
import useBrainDesk from './use-brain-desk'
import BrainSectionHead from './brain-section-head'
import './brain-idea-book.css'

/* The six specialist lenses, in debate order → dot-row initials C S O L M D. */
const LENSES = [
  { key: 'chartist', initial: 'C' },
  { key: 'sentiment', initial: 'S' },
  { key: 'onchain', initial: 'O' },
  { key: 'leverage', initial: 'L' },
  { key: 'macro', initial: 'M' },
  { key: 'degen', initial: 'D' },
]

const DIRECTION = {
  long: { word: 'LONG', tone: 'bull' },
  short: { word: 'SHORT', tone: 'bear' },
}
const VENUE = { spot: 'spot', hyperliquid: 'hyperliquid', onchain: 'on-chain' }

/* plain-English tooltips for the trade-level cells (non-quant readers). */
const CELL_TIP = {
  Entry: 'price to enter the trade',
  Invalidation: 'the level that proves this wrong — where the desk exits',
  Horizon: 'how long the idea needs to play out',
}

/* $ only when the asset reads like a ticker; narrative names render bare. */
function assetLabel(asset) {
  const raw = String(asset || '').trim().replace(/^\$/, '')
  if (!raw) return ''
  const isTicker = raw.length <= 6 && raw === raw.toUpperCase() && /^[A-Z0-9]+$/.test(raw)
  return isTicker ? `$${raw}` : raw
}

function fmtLevel(n) {
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  if (a >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (a >= 0.01) return `$${n.toFixed(4)}`
  if (a > 0) return `$${n.toPrecision(3)}`
  return `$${n}`
}

function levelValue(v) {
  if (v == null || v === '') return null
  return typeof v === 'number' && Number.isFinite(v) ? fmtLevel(v) : String(v).trim() || null
}

function entryValue(idea) {
  const p = levelValue(idea.entry_price)
  if (p != null) return p
  const z = idea.entry_zone
  if (z == null || z === '') return null
  if (Array.isArray(z)) {
    const parts = z.map((v) => levelValue(v)).filter(Boolean)
    return parts.length ? parts.join('–') : null
  }
  return String(z).trim() || null
}

function signedPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

/* long/bull → bull, short/bear → bear, else neutral (absent lens = neutral). */
function voteTone(direction) {
  const d = String(direction || '').toLowerCase()
  if (d === 'long' || d === 'bull') return 'bull'
  if (d === 'short' || d === 'bear') return 'bear'
  return 'neutral'
}

/* The debate: one 7px dot per lens, bull/bear/absent-toned, initial beneath. */
function DebateStrip({ votes }) {
  const v = votes && typeof votes === 'object' ? votes : {}
  return (
    <div className="bib-debate" aria-label="lens debate">
      {LENSES.map((lens) => {
        const vote = v[lens.key]
        const tone = voteTone(vote?.direction)
        const conv = Number.isFinite(Number(vote?.conviction)) ? Math.round(Number(vote.conviction)) : null
        const title = vote ? `${lens.key}: ${tone}${conv != null ? ` ${conv}` : ''}` : `${lens.key}: no vote`
        return (
          <span className="bib-lens" key={lens.key} title={title}>
            <i className={`bib-dot bib-dot--${tone}`} />
            <span className="bib-lens-i">{lens.initial}</span>
          </span>
        )
      })}
    </div>
  )
}

function fmtCap(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${Math.round(n / 1e3)}K`
}

function IdeaCard({ idea }) {
  const dirMeta = DIRECTION[String(idea.direction || '').toLowerCase()] || { word: String(idea.direction || '').toUpperCase() || '—', tone: 'neutral' }
  const asset = assetLabel(idea.asset)
  const venue = VENUE[idea.venue] || null
  const conv = Number.isFinite(Number(idea.conviction)) ? Math.round(Number(idea.conviction)) : null
  // altitude context — a micro/attention token states its size on the card
  const cap = idea.altitude && idea.altitude !== 'major' ? fmtCap(idea.market_cap) : null
  const micro = idea.altitude === 'micro' || idea.altitude === 'small'

  const cells = [
    { k: 'Entry', v: entryValue(idea) },
    { k: 'Invalidation', v: levelValue(idea.invalidation) },
    { k: 'Horizon', v: idea.horizon ? String(idea.horizon).trim() : null },
  ].filter((c) => c.v != null)

  const verdict = idea.critic_verdict === 'survives' || idea.critic_verdict === 'weakened' ? idea.critic_verdict : null
  const status = idea.status && idea.status !== 'active' ? idea.status : null
  const pnl = idea.pnl_pct == null ? null : signedPct(idea.pnl_pct)
  const pnlSign = pnl == null ? 'flat' : Number(idea.pnl_pct) > 0 ? 'up' : Number(idea.pnl_pct) < 0 ? 'down' : 'flat'

  return (
    <div className="bib-card">
      <div className="bib-head">
        <span className="bib-asset">{asset}</span>
        <span className={`bib-dir bib-dir--${dirMeta.tone}`}>{dirMeta.word}</span>
        {(cap || micro) && (
          <span className={`bib-cap${micro ? ' bib-cap--micro' : ''}`} title="market size — what altitude this idea lives at">
            {cap || 'attention lane'}{micro && cap ? ' play' : ''}
          </span>
        )}
        {venue && <span className="bib-venue">{venue}</span>}
        <span className="bib-conv">{conv == null ? '—' : conv}</span>
      </div>

      {cells.length > 0 && (
        <div className="bib-cells">
          {cells.map((c) => (
            <div className="bib-cell" key={c.k} title={CELL_TIP[c.k] || undefined}>
              <span className="bib-cell-k">{c.k}</span>
              <span className="bib-cell-v">{c.v}</span>
            </div>
          ))}
        </div>
      )}

      {idea.thesis && <p className="bib-thesis">{idea.thesis}</p>}

      <DebateStrip votes={idea.lens_votes} />

      {(verdict || idea.critic) && (
        <div className="bib-critic">
          {verdict && <span className={`bib-verdict bib-verdict--${verdict}`}>{verdict}</span>}
          {idea.critic && <span className="bib-critic-text">{idea.critic}</span>}
        </div>
      )}

      {(pnl != null || status) && (
        <div className="bib-foot">
          {pnl != null && (
            <span className={`bib-pnl bib-pnl--${pnlSign}`}><b>{pnl}</b><i>since entry</i></span>
          )}
          {status && <span className={`bib-status bib-status--${status}`}>{status}</span>}
        </div>
      )}
    </div>
  )
}

/* Lens hit-rate — honest: only lenses that have actually graded ideas appear. */
function LensScoreboard({ rows }) {
  const graded = (Array.isArray(rows) ? rows : []).filter((r) => Number(r?.n_graded) > 0)
  if (!graded.length) return null
  return (
    <div className="bib-scoreboard">
      <span className="bib-scoreboard-k">lens hit-rate</span>
      {graded.map((r) => {
        const hit = Number.isFinite(Number(r.hit_rate_pct)) ? Math.round(Number(r.hit_rate_pct)) : null
        return (
          <span className="bib-score" key={r.lens} title={`${r.lens}: ${r.n_graded} graded`}>
            <span className="bib-score-lens">{r.lens}</span>
            <b>{hit == null ? '—' : `${hit}%`}</b>
          </span>
        )
      })}
    </div>
  )
}

export default function BrainIdeaBook() {
  const { ideas, lensScoreboard } = useBrainDesk()
  // Absence path: no ideas → render nothing, no placeholder, no gap.
  if (!Array.isArray(ideas) || ideas.length === 0) return null

  return (
    <section className="bib">
      <BrainSectionHead
        eyebrow="The Desk Debated"
        title="Idea Book"
        sub="six lenses voted · the critic's verdict is on record"
      />
      <div className="bib-grid">
        {ideas.map((idea, i) => <IdeaCard key={idea.idea_id || `${idea.asset}-${i}`} idea={idea} />)}
      </div>
      <LensScoreboard rows={lensScoreboard} />
    </section>
  )
}
