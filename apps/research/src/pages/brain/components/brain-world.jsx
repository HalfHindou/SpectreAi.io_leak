/**
 * Brain — World-state strip.
 *
 * One slim macro-politics strip between the Bottom Line and the proof strip:
 * 3-5 compact facts — Fed funds + next FOMC, a top policy/politics odds, the
 * freshest political-stance quote (truncated), and the latest diff as
 * "changed: …" (muted). Single row, wraps on mobile. Renders nothing when the
 * doc is absent/empty.
 */
import React from 'react'
import useBrainWorld from './use-brain-world'
import './brain-world.css'

function truncate(s, n) {
  const str = String(s || '').trim()
  return str.length > n ? `${str.slice(0, n - 1).trimEnd()}…` : str
}

function fmtDate(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* Highest-signal odds across policy / fed-chair / election pools (crypto first). */
function pickTopOdds(doc) {
  const pol = doc?.politics || {}
  const rates = doc?.rates || {}
  const pools = [pol.crypto_policy_odds, rates.fed_chair, pol.election_policy_odds]
  for (const arr of pools) {
    if (Array.isArray(arr) && arr.length) {
      const top = [...arr]
        .filter((o) => o?.q && o?.yes_pct != null)
        .sort((a, b) => (Number(b?.vol_usd_m) || 0) - (Number(a?.vol_usd_m) || 0))[0]
      if (top) return top
    }
  }
  return null
}

function freshestStance(doc) {
  const fs = doc?.politics?.figure_stances
  if (!Array.isArray(fs) || !fs.length) return null
  return [...fs]
    .filter((x) => x?.quote)
    .sort((a, b) => (Date.parse(b?.ts) || 0) - (Date.parse(a?.ts) || 0))[0] || null
}

export default function BrainWorld() {
  const { doc, diff } = useBrainWorld()
  if (!doc) return null

  const facts = []

  const rates = doc.rates || {}
  const fedFunds = Number(rates.fed_funds_pct)
  const fomc = fmtDate(rates.next_fomc)
  if (Number.isFinite(fedFunds) || fomc) {
    facts.push(
      <div className="bwd-fact" key="rates">
        <span className="bwd-key">Fed funds</span>
        <span className="bwd-val">
          {Number.isFinite(fedFunds) && <span className="bwd-num">{fedFunds.toFixed(2)}%</span>}
          {Number.isFinite(fedFunds) && fomc && <span className="bwd-sep">·</span>}
          {fomc && <>FOMC <span className="bwd-num">{fomc}</span></>}
        </span>
      </div>
    )
  }

  const odds = pickTopOdds(doc)
  if (odds) {
    facts.push(
      <div className="bwd-fact" key="odds">
        <span className="bwd-key">Odds</span>
        <span className="bwd-val" title={odds.q}>
          {truncate(odds.q, 42)} <span className="bwd-num">{Math.round(Number(odds.yes_pct))}%</span>
        </span>
      </div>
    )
  }

  const stance = freshestStance(doc)
  if (stance) {
    facts.push(
      <div className="bwd-fact" key="stance">
        <span className="bwd-key">Politics</span>
        <span className="bwd-val" title={stance.quote}>
          <span className="bwd-who">{stance.who}</span> &ldquo;{truncate(stance.quote, 46)}&rdquo;
        </span>
      </div>
    )
  }

  if (diff && String(diff).trim()) {
    facts.push(
      <div className="bwd-fact bwd-fact--diff" key="diff">
        <span className="bwd-key">Changed</span>
        <span className="bwd-val" title={String(diff)}>{truncate(diff, 54)}</span>
      </div>
    )
  }

  if (!facts.length) return null

  return (
    <section className="bwd" aria-label="world state">
      <div className="bwd-strip">{facts}</div>
    </section>
  )
}
