/**
 * RegimeBadge Component
 * Small colored pill showing market regime sentiment.
 * Used in Market Context panels to indicate bullish/bearish/cautious/neutral regime.
 */

import React from 'react'
import './RegimeBadge.css'

const SENTIMENT_CONFIG = {
  bullish: {
    bg: 'rgba(16, 185, 129, 0.15)',
    color: 'var(--bull)',
  },
  bearish: {
    bg: 'rgba(239, 68, 68, 0.15)',
    color: 'var(--bear)',
  },
  cautious: {
    bg: 'rgba(245, 158, 11, 0.15)',
    color: 'var(--amber)',
  },
  neutral: {
    bg: 'rgba(255, 255, 255, 0.06)',
    color: 'var(--text-muted)',
  },
}

const RegimeBadge = ({ label, sentiment = 'neutral' }) => {
  const config = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.neutral

  return (
    <span
      className={`regime-badge regime-badge--${sentiment}`}
      style={{
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      {label}
    </span>
  )
}

export default RegimeBadge
