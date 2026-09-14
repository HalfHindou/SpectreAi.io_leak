/**
 * MobileViewNav — bottom view-switcher for the mobile token page.
 *
 * Sits at the very bottom of the screen; the Buy/Sell bar (MobileBottomNav)
 * docks just above it. Tapping a tab switches the token page's main content
 * area between five focused views:
 *
 *   Info · Chart · Chart+Txns · Social · Trade
 *
 * "Trade" is an action tab — it opens the swap sheet rather than swapping the
 * inline view (the persistent Buy/Sell bar above shares the same target), so
 * it takes `onTrade` instead of participating in `active`.
 */
import React from 'react'
import { Info, CandlestickChart, Rows3, AtSign, ArrowRightLeft, Star } from 'lucide-react'
import './MobileViewNav.css'

const VIEWS = [
  { id: 'info', label: 'Info', Icon: Info },
  { id: 'chart', label: 'Chart', Icon: CandlestickChart },
  { id: 'chart-txns', label: 'Chart+Txns', Icon: Rows3 },
  { id: 'social', label: 'Social', Icon: AtSign },
]

export default function MobileViewNav({ active, onChange, onTrade, onWatchlist }) {
  return (
    <nav className="mvn" role="tablist" aria-label="Token views">
      {/* Exit shortcut back to the home shell's Watchlist tab (Sunny's ask:
          quick return from a token opened off the watchlist). Action tab
          like Trade - never part of `active`. */}
      {onWatchlist && (
        <button
          type="button"
          className="mvn-tab mvn-tab--watchlist"
          onClick={onWatchlist}
          aria-label="Back to watchlist"
        >
          <Star size={18} strokeWidth={2} aria-hidden="true" />
          <span className="mvn-label">Watchlist</span>
        </button>
      )}
      {VIEWS.map(({ id, label, Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`mvn-tab${isActive ? ' mvn-tab--active' : ''}`}
            onClick={() => onChange?.(id)}
          >
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
            <span className="mvn-label">{label}</span>
          </button>
        )
      })}
      <button
        type="button"
        className="mvn-tab mvn-tab--trade"
        onClick={onTrade}
        aria-label="Trade"
      >
        <ArrowRightLeft size={18} strokeWidth={2} aria-hidden="true" />
        <span className="mvn-label">Trade</span>
      </button>
    </nav>
  )
}
