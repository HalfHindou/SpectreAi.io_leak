/**
 * Brain — Self-knowledge (pattern strip).
 *
 * A compact strip directly under the proof strip: up to 4 mined conditional-hit
 * patterns (medium/high confidence first, then highest n) — the human-readable
 * description with a right-aligned mono n + hit%. Subordinate (tiny eyebrow, no
 * title). A low-confidence-only day shows max 2 + a muted "compounds" note.
 * Renders nothing when there are no patterns.
 */
import React from 'react'
import useBrainPatterns from './use-brain-patterns'
import './brain-patterns.css'

const CONF_RANK = { high: 2, medium: 1, low: 0 }

function fmtHit(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n % 1 === 0 ? `${n}%` : `${n.toFixed(1)}%`
}

function PatternCard({ p }) {
  const desc = p?.description && String(p.description).trim()
  if (!desc) return null
  const n = Number(p?.n)
  const hit = fmtHit(p?.hit_rate_pct)
  return (
    <div className="bpt-card">
      <p className="bpt-desc">{desc}</p>
      <div className="bpt-meta">
        {Number.isFinite(n) && <span className="bpt-n">n={n}</span>}
        {hit && <span className="bpt-hit">{hit}</span>}
      </div>
    </div>
  )
}

export default function BrainPatterns() {
  const { patterns } = useBrainPatterns()

  const list = Array.isArray(patterns) ? patterns.filter((p) => p && p.description) : []
  if (!list.length) return null // no patterns → strip hides

  const sorted = [...list].sort((a, b) =>
    (CONF_RANK[b?.confidence] || 0) - (CONF_RANK[a?.confidence] || 0) ||
    (Number(b?.n) || 0) - (Number(a?.n) || 0)
  )
  const hasMedHigh = sorted.some((p) => (CONF_RANK[p?.confidence] || 0) >= 1)
  const cards = hasMedHigh ? sorted.slice(0, 4) : sorted.slice(0, 2)
  if (!cards.length) return null

  return (
    <section className="bpt" aria-label="what the brain knows about itself">
      <span className="bpt-eyebrow">What it knows about itself</span>
      <div className="bpt-strip">
        {cards.map((p, i) => <PatternCard key={p?.pattern_id || i} p={p} />)}
      </div>
      {!hasMedHigh && <span className="bpt-note">early — n compounds daily</span>}
    </section>
  )
}
