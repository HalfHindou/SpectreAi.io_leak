import React from 'react'
import './HeroSplit.css'

/**
 * HeroSplit — 50/50 two-up layout used by every tokenized-assets tab hero.
 *
 * - Desktop (>= 900px): chart on the left (50%), creative module on the right (50%).
 * - Mobile (< 900px): single column, chart on top, creative below.
 *
 * Both sides receive the glass-surface treatment consistent with the existing
 * .ta-hero container, but the chart pane keeps the existing controls + chart
 * composition while the creative pane is a self-contained module.
 */
export default function HeroSplit({ chart, creative, className = '' }) {
  return (
    <div className={`ta-hero-split${className ? ' ' + className : ''}`}>
      <div className="ta-hero-split__chart">{chart}</div>
      <div className="ta-hero-split__creative">{creative}</div>
    </div>
  )
}
