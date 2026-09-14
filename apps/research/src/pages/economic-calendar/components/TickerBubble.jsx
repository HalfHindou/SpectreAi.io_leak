/**
 * TickerBubble Component
 * Small ticker reference pill colored by asset class.
 * Used to tag events with affected tickers (BTC, SPY, EUR/USD, etc.).
 */

import React from 'react'
import './TickerBubble.css'

const ASSET_CLASS_CONFIG = {
  equity: {
    bg: 'rgba(59, 130, 246, 0.15)',
    color: '#3B82F6',
    border: 'rgba(59, 130, 246, 0.25)',
  },
  crypto: {
    bg: 'rgba(168, 85, 247, 0.15)',
    color: '#A855F7',
    border: 'rgba(168, 85, 247, 0.25)',
  },
  forex: {
    bg: 'rgba(148, 163, 184, 0.15)',
    color: '#94A3B8',
    border: 'rgba(148, 163, 184, 0.25)',
  },
  commodity: {
    bg: 'rgba(245, 158, 11, 0.15)',
    color: 'var(--amber)',
    border: 'rgba(245, 158, 11, 0.25)',
  },
  bond: {
    bg: 'rgba(20, 184, 166, 0.15)',
    color: '#14B8A6',
    border: 'rgba(20, 184, 166, 0.25)',
  },
}

const TickerBubble = ({ symbol, assetClass = 'crypto', filled = true }) => {
  const config = ASSET_CLASS_CONFIG[assetClass] || ASSET_CLASS_CONFIG.crypto

  return (
    <span
      className={`ticker-bubble ${filled ? 'ticker-bubble--filled' : 'ticker-bubble--outline'}`}
      style={
        filled
          ? { backgroundColor: config.bg, color: config.color }
          : { borderColor: config.border, color: 'var(--text-muted)' }
      }
    >
      {symbol}
    </span>
  )
}

export default TickerBubble
