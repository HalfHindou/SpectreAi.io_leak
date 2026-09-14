/**
 * W-031 · Ghost Mode Widget
 * Counter-argument panel that argues the opposing view to current positioning.
 * Purple ambient glass card. Shows idle state initially with ghost icon.
 */
import { useState } from 'react'
import './GhostMode.css'

/* ---------- data ---------- */

const COUNTER_ARGUMENTS = [
  {
    position: 'BTC LONG bias',
    counterThesis: 'Exchange reserve drawdowns are often front-run by market makers. The current outflow pattern resembles March 2024 -- two weeks before a 15% correction. Short-term holder cost basis at $94K suggests a leveraged flush is overdue before any sustainable breakout.',
    risks: [
      'CME gap at $89,200 remains unfilled',
      'Miner selling pressure increasing as hash rate hits ATH',
      'Options max pain at $91K for Friday expiry',
    ],
  },
  {
    position: 'ETH relative strength thesis',
    counterThesis: 'The ETH/BTC recovery narrative has failed three times this cycle. Institutional flow data shows capital rotating into SOL and L2 tokens, not ETH. The Pectra upgrade is priced in, and execution risk on the blob market expansion remains underappreciated.',
    risks: [
      'L2 revenue cannibalization reducing ETH fee burn',
      'Restaking leverage creates hidden systemic risk',
      'ETF outflows 3 of last 5 trading days',
    ],
  },
  {
    position: 'Risk-on macro allocation',
    counterThesis: 'Yield curve steepening historically precedes equity corrections by 4-8 weeks. The current crypto-equity correlation at 0.82 means any S&P drawdown will be amplified in digital assets. The VIX term structure is in backwardation -- a warning signal being ignored.',
    risks: [
      'Japan yield curve control adjustment risk',
      'US Treasury refunding announcement next week',
      'DXY strengthening against EUR puts pressure on risk assets',
    ],
  },
]

/* ---------- component ---------- */

export default function GhostMode() {
  const [active, setActive] = useState(false)
  const [data, setData] = useState(null)

  const activate = () => {
    const pick = COUNTER_ARGUMENTS[Math.floor(Math.random() * COUNTER_ARGUMENTS.length)]
    setData(pick)
    setActive(true)
  }

  const dismiss = () => {
    setActive(false)
    setData(null)
  }

  // Idle state
  if (!active) {
    return (
      <div className="tcgm-idle">
        {/* Ghost icon */}
        <div className="tcgm-idle-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(196,181,253,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C7.58 2 4 5.58 4 10v10l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V10c0-4.42-3.58-8-8-8z" />
            <circle cx="9" cy="10" r="1.5" fill="rgba(196,181,253,0.5)" stroke="none" />
            <circle cx="15" cy="10" r="1.5" fill="rgba(196,181,253,0.5)" stroke="none" />
          </svg>
        </div>

        <div className="tcgm-idle-text">
          Ghost Mode argues the opposing view to stress-test your conviction.
        </div>

        <button className="tcgm-activate" onClick={activate}>
          Activate Ghost Mode
        </button>
      </div>
    )
  }

  // Active state
  return (
    <div className="tcgm">
      {/* Top-edge accent glow */}
      <div className="tcgm-glow" />

      {/* Header */}
      <div className="tcgm-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(196,181,253,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C7.58 2 4 5.58 4 10v10l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V10c0-4.42-3.58-8-8-8z" />
        </svg>
        <span className="tcgm-title">GHOST MODE</span>
      </div>

      {/* Position being argued against */}
      <div className="tcgm-against">
        <span className="tcgm-against-label">Arguing against: </span>
        <span className="tcgm-against-position">{data.position}</span>
      </div>

      {/* Counter-thesis */}
      <div className="tcgm-thesis-wrap">
        <p className="tcgm-thesis">{data.counterThesis}</p>
      </div>

      {/* Risk factors */}
      <div className="tcgm-risks">
        {data.risks.map((risk, i) => (
          <div key={i} className="tcgm-risk">
            <div className="tcgm-risk-dot" />
            <span className="tcgm-risk-text">{risk}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="tcgm-actions">
        <button className="tcgm-btn tcgm-btn--accept" onClick={dismiss}>
          I understand the risk
        </button>
        <button className="tcgm-btn tcgm-btn--close" onClick={dismiss}>
          Close position
        </button>
      </div>
    </div>
  )
}
