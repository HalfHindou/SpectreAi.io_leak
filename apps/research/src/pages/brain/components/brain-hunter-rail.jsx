/**
 * Brain — The Hunter rail.
 *
 * A time-ordered feed of edges the hunter worker surfaced on its own: anomalies,
 * new listings, narrative onsets, prediction swings, cross-asset divergences.
 * Sits beside the Board (320px right rail ≥1200px) or as a horizontal scroll strip
 * between Convergence and Board below that (placement owned by brain-eagle.css).
 *
 * Design: warm-white opacity ramp, near-invisible borders, mono numerals. Color is
 * market semantics ONLY — direction tones the magnitude value, red flags unsafe
 * candidates. No accent bars, no glyphs, no tone-coded labels. The newest arrival
 * pulses once; the list never re-animates. If the feed is empty (endpoint 404 until
 * the worker ships) the rail renders nothing.
 */
import React, { useEffect, useRef, useState } from 'react'
import useBrainHunter from './use-brain-hunter'
import './brain-hunter-rail.css'

const MAX_ROWS = 12

const DETECTOR_LABELS = {
  anomaly: 'ANOMALY',
  listing: 'NEW LISTING',
  narrative_onset: 'NARRATIVE',
  prediction_swing: 'PREDICTION',
  divergence: 'DIVERGENCE',
}

function detectorLabel(d) {
  return DETECTOR_LABELS[d] || String(d || '').replace(/_/g, ' ').toUpperCase() || 'SIGNAL'
}

function rel(ts) {
  if (!ts) return null
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function fmtMag(m) {
  if (m == null) return null
  const x = Number(m)
  if (!Number.isFinite(x)) return null
  const abs = Math.abs(x)
  if (abs >= 100) return String(Math.round(x))
  if (abs >= 10) return x.toFixed(1)
  return x.toFixed(2)
}

function HunterEntry({ e, pulse }) {
  const ts = rel(e.ts)
  const mag = fmtMag(e.magnitude)
  const dir = e.direction === 'bull' ? 'bull' : e.direction === 'bear' ? 'bear' : null
  const safety = e.safety === 'flagged' ? 'flagged' : e.safety === 'unverified' ? 'unverified' : null
  return (
    <article className={`bhr-entry${pulse ? ' bhr-entry--pulse' : ''}`} title={e.detail || undefined}>
      <div className="bhr-meta">
        <span className="bhr-detector">{detectorLabel(e.detector)}</span>
        {ts && <span className="bhr-ts">{ts}</span>}
      </div>
      <p className="bhr-headline">{e.headline}</p>
      {(mag != null || safety) && (
        <div className="bhr-foot">
          {mag != null
            ? <span className={`bhr-mag${dir ? ` bhr-mag--${dir}` : ''}`}>{mag}</span>
            : <span aria-hidden />}
          {safety && <span className={`bhr-safety bhr-safety--${safety}`}>{safety}</span>}
        </div>
      )}
    </article>
  )
}

function RailHead() {
  return (
    <div className="bhr-head">
      <span className="bhr-eyebrow">The Hunter</span>
      <span className="bhr-title">Live edge scan</span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="bhr-list" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="bhr-entry bhr-entry--sk" key={i}>
          <div className="bhr-meta">
            <span className="bhr-sk bhr-sk--tag" />
            <span className="bhr-sk bhr-sk--ts" />
          </div>
          <span className="bhr-sk bhr-sk--line" />
          <span className="bhr-sk bhr-sk--line bhr-sk--line2" />
        </div>
      ))}
    </div>
  )
}

export default function BrainHunterRail() {
  const { loading, edges, stats } = useBrainHunter()
  const rows = edges.slice(0, MAX_ROWS)
  const topId = rows[0]?.id ?? null

  // Pulse only the newest arrival, once. Never re-animate the list (and never on
  // the first paint — prevTop starts null so the initial set is silent).
  const prevTop = useRef(null)
  const [pulseId, setPulseId] = useState(null)
  useEffect(() => {
    if (topId && prevTop.current != null && topId !== prevTop.current) {
      setPulseId(topId)
      const t = setTimeout(() => setPulseId(null), 1000)
      prevTop.current = topId
      return () => clearTimeout(t)
    }
    prevTop.current = topId
  }, [topId])

  // Honest hit-rate footer — only when the hunter has graded calls. n_graded-weighted.
  const graded = stats.filter((s) => Number(s?.n_graded) > 0)
  const totalGraded = graded.reduce((a, s) => a + Number(s.n_graded), 0)
  const hitRate = totalGraded > 0
    ? Math.round(graded.reduce((a, s) => a + Number(s.hit_rate_pct || 0) * Number(s.n_graded), 0) / totalGraded)
    : null

  if (loading && !rows.length) {
    return (
      <aside className="bhr" aria-label="The Hunter">
        <RailHead />
        <Skeleton />
      </aside>
    )
  }

  // Graceful absence — the rail simply doesn't exist yet.
  if (!rows.length) return null

  return (
    <aside className="bhr" aria-label="The Hunter">
      <RailHead />
      <div className="bhr-list">
        {rows.map((e) => (
          <HunterEntry key={e.id} e={e} pulse={pulseId === e.id} />
        ))}
      </div>
      {hitRate != null && (
        <div className="bhr-footer">hunter hit-rate: <b>{hitRate}%</b> ({totalGraded})</div>
      )}
    </aside>
  )
}
