/**
 * Brain — Proof Strip.
 *
 * The credibility band under the hero: the differentiator a pure social terminal
 * (aixbt) has no answer to — the Brain's PROVEN accuracy. Left: the mature
 * grades-v2 hit-rate (big mono) + n calls. Right: the desk's OWN young scorecard
 * — per-horizon hit rates once it has graded calls, or an honest "self-grading
 * warming up — N ledgered" state before then. This is the future P&L slot.
 */
import React from 'react'
import useBrainDesk from './use-brain-desk'
import './brain-proof-strip.css'

const HORIZONS = ['4h', '24h', '7d']

export default function BrainProofStrip({ hitRate }) {
  const { scorecard } = useBrainDesk()

  const provenPct = hitRate?.pct
  const nGraded = Number(scorecard?.n_graded) || 0
  const nCalls = Number(scorecard?.n_calls) || 0
  // Scoreboard honesty (2026-07-13): prefer the OWN-HORIZON record — each
  // call judged in the window it claimed (a 4h scalp is never judged at 7d).
  // Falls back through the older shapes for stale payloads.
  const horizons = scorecard?.own_horizon?.by_horizon || scorecard?.by_horizon || scorecard?.horizons || {}
  const pub24 = scorecard?.published_tier?.by_horizon?.['24h'] || null

  // Nothing to say yet — hide entirely (hero + board still stand).
  if (provenPct == null && !nCalls && !nGraded) return null

  return (
    <section className="pf" aria-label="brain track record">
      <div className="pf-hero">
        <span className="pf-mark">Proven accuracy</span>
        {provenPct != null ? (
          <>
            <span className="pf-pct">{provenPct}<i>%</i></span>
            <span className="pf-meta">
              {hitRate.n != null && <b>{hitRate.n}</b>} {hitRate.source || 'calls'} · {hitRate.days || 30}d
            </span>
          </>
        ) : (
          <span className="pf-meta pf-meta--warm">track record maturing</span>
        )}
      </div>

      <div className="pf-desk">
        <span className="pf-desk-tag">Desk self-grading · each call judged at its own horizon</span>
        {nGraded > 0 ? (
          <div className="pf-horizons">
            {HORIZONS.map((h) => {
              const row = horizons[h] || {}
              const n = Number(row.n) || 0
              const rawRate = row.hit_rate_pct ?? row.hit_rate
              const rate = rawRate == null ? null : Math.round(Number(rawRate))
              return (
                <div key={h} className="pf-hz">
                  <span className="pf-hz-h">{h}</span>
                  <span className="pf-hz-rate">{rate == null || !n ? '—' : `${rate}%`}</span>
                  <span className="pf-hz-n">{n ? `${n} graded` : 'pending'}</span>
                </div>
              )
            })}
            {pub24 && Number(pub24.n) > 0 && (
              <div className="pf-hz pf-hz--pub">
                <span className="pf-hz-h">published</span>
                <span className="pf-hz-rate">{pub24.hit_rate_pct == null ? '—' : `${Math.round(Number(pub24.hit_rate_pct))}%`}</span>
                <span className="pf-hz-n">{pub24.n} graded · 24h</span>
              </div>
            )}
          </div>
        ) : (
          <p className="pf-warming">
            Self-grading warming up — <b>{nCalls}</b> {nCalls === 1 ? 'call' : 'calls'} ledgered.
            First reads mature at the 4h checkpoint.
          </p>
        )}
      </div>
    </section>
  )
}
