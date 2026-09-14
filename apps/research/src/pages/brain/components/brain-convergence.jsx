/**
 * Brain — Convergence.
 *
 * The understanding, made visible. Two parts:
 *   State of Mind — the Brain's current read of WHY the market is where it is,
 *     plus what's confirming / shifting / fading vs its prior read (memory).
 *   Convergence — Idea-Book-shaped cards where multiple INDEPENDENT signals
 *     stack on one asset, each carrying a trade read: direction, conviction,
 *     entry, invalidation, key level, horizon, and a safety tag when unverified.
 */
import React from 'react'
import useBrainDesk from './use-brain-desk'
import BrainSectionHead from './brain-section-head'
import './brain-convergence.css'

/* Only prefix $ when the asset reads like a ticker; narrative names render bare. */
function assetLabel(asset) {
  const raw = String(asset || '').trim().replace(/^\$/, '')
  if (!raw) return ''
  const isTicker = raw.length <= 6 && raw === raw.toUpperCase() && /^[A-Z0-9]+$/.test(raw)
  return isTicker ? `$${raw}` : raw
}

function fmtLevel(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
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
  return typeof v === 'number' ? fmtLevel(v) : String(v).trim() || null
}

/* Market-altitude chip — the context that stops a $2M attention token reading
   like a peer of ETH. Majors need no size tag; everything else states it. */
function fmtCap(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${Math.round(n / 1e3)}K`
}
function altitudeChip(c) {
  if (!c || c.altitude === 'major') return null
  const cap = fmtCap(c.market_cap)
  if (c.altitude === 'micro' || c.altitude === 'small') {
    return { text: cap ? `${cap} attention play` : 'attention-lane token', tone: 'micro' }
  }
  if (cap) return { text: `${cap} cap`, tone: 'sized' }
  return { text: 'size unverified', tone: 'unknown' }
}

/* plain-English tooltips for the trade-level cells (non-quant readers). */
const LEVEL_TIP = {
  Entry: 'price to enter the trade',
  Invalidation: 'the level that proves this wrong — where the desk exits',
  'Key level': 'the price the desk is watching for confirmation',
}

function Delta({ label, items, tone }) {
  if (!items?.length) return null
  return (
    <div className={`cv-delta cv-delta--${tone}`}>
      <span className="cv-delta-label">{label}</span>
      <ul className="cv-delta-list">{items.slice(0, 3).map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  )
}

function StateOfMind({ context, regime }) {
  if (!context?.read && !regime) return null
  return (
    <div className="cv-mind">
      <div className="cv-mind-head">
        <span className="cv-mind-tag">State of Mind</span>
        {regime && <span className="cv-regime">{regime}</span>}
      </div>
      {context?.read && <p className="cv-mind-read">{context.read}</p>}
      {(context?.changed?.length || context?.confirmed?.length || context?.fading?.length) ? (
        <div className="cv-deltas">
          <Delta label="Confirming" items={context.confirmed} tone="bull" />
          <Delta label="Shifting" items={context.changed} tone="new" />
          <Delta label="Fading" items={context.fading} tone="bear" />
        </div>
      ) : null}
    </div>
  )
}

function ConvergenceCard({ c }) {
  const dir = c.direction === 'bear' ? 'bear' : 'bull'
  const safety = c.safety && c.safety !== 'ok' ? c.safety : null
  const conv = Number.isFinite(Number(c.conviction)) ? Math.round(Number(c.conviction)) : null
  const levels = [
    { k: 'Entry', v: levelValue(c.entry_price) },
    { k: 'Invalidation', v: levelValue(c.invalidation) },
    { k: 'Key level', v: levelValue(c.key_level) },
  ].filter((l) => l.v != null)
  const signals = Array.isArray(c.signals) ? c.signals.slice(0, 3) : []

  const alt = altitudeChip(c)

  return (
    <div className={`cv-card cv-card--${dir}`}>
      <div className="cv-card-head">
        <span className="cv-asset">{assetLabel(c.asset)}</span>
        <span className={`cv-dir cv-${dir}`}>{dir === 'bull' ? '▲ Bullish' : '▼ Bearish'}</span>
        {alt && <span className={`cv-cap cv-cap--${alt.tone}`} title="market size — what altitude this call lives at">{alt.text}</span>}
        {c.horizon && <span className="cv-horizon">{c.horizon}</span>}
        {safety && <span className={`cv-safety cv-safety--${safety}`}>{safety}</span>}
        <span className="cv-conv-anchor">{conv == null ? '—' : conv}</span>
      </div>

      {c.lenses?.length ? (
        <div className="cv-lenses">
          {c.lenses.map((l, i) => (
            <span className="cv-lens" key={i}><i className="cv-lens-dot" />{l}</span>
          ))}
        </div>
      ) : null}

      {levels.length ? (
        <div className="cv-levels">
          {levels.map((lv) => (
            <div className="cv-level" key={lv.k} title={LEVEL_TIP[lv.k] || undefined}>
              <span className="cv-level-k">{lv.k}</span>
              <span className="cv-level-v">{lv.v}</span>
            </div>
          ))}
        </div>
      ) : null}

      {signals.length ? (
        <ul className="cv-signals">
          {signals.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      ) : null}

      {c.why && <p className="cv-why">{c.why}</p>}
    </div>
  )
}

export default function BrainConvergence() {
  const { convergence, context, regime, loading } = useBrainDesk()
  if (loading && !convergence.length && !context) {
    return <section className="cv"><div className="cv-mind cv-mind--sk"><span className="sk cv-sk" style={{ width: '32%', height: 12 }} /><span className="sk cv-sk" style={{ width: '86%' }} /></div></section>
  }
  if (!convergence.length && !context) return null
  return (
    <section className="cv">
      <StateOfMind context={context} regime={regime} />
      <BrainSectionHead
        eyebrow="Where lenses stack"
        title="Convergence"
        sub="where independent signals stack — the setups a single feed can't see"
      />
      {convergence.length > 0 ? (
        <div className="cv-grid">
          {convergence.map((c, i) => <ConvergenceCard key={`${c.asset}-${i}`} c={c} />)}
        </div>
      ) : (
        <p className="cv-empty">
          No published setups this cycle. The desk only publishes calls whose tape pattern has
          historically paid — everything else stays in shadow, where it still gets graded.
          An empty book here is discipline, not silence.
        </p>
      )}
    </section>
  )
}
