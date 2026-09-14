/**
 * BrainSectionHead — one section-header used across Convergence / Board / Intel.
 * Eyebrow (tracked tertiary) + title (display 1.75rem/600) + optional sub + right slot.
 */
import React from 'react'
import './brain-section-head.css'

export default function BrainSectionHead({ eyebrow, title, sub, right }) {
  return (
    <header className="bsh">
      <div className="bsh-titles">
        {eyebrow && <span className="bsh-eyebrow">{eyebrow}</span>}
        <div className="bsh-line">
          <h2 className="bsh-title">{title}</h2>
          {sub && <span className="bsh-sub">{sub}</span>}
        </div>
      </div>
      {right != null && <div className="bsh-right">{right}</div>}
    </header>
  )
}
