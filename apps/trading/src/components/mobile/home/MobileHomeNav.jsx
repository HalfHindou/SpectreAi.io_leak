/**
 * MobileHomeNav — the persistent bottom tab bar of the mobile home shell
 * (prefix mhn-). Five tabs: Screener · Search · Watchlist · Token/Alerts ·
 * Menu. Active tab is warm white (never a hue); Watchlist/Alerts carry count
 * badges. Sits above the device safe-area.
 *
 * Slot 4 is contextual: once the user has opened a token it becomes a
 * one-tap route back to that token (logo + symbol), which is the trip people
 * make constantly - board -> token -> board -> same token. Until then it is
 * the Alerts tab, so a first-time user loses nothing. Alerts stays reachable
 * from Menu either way, and its unseen badge moves onto Menu while the slot
 * is showing a token.
 */
import React from 'react'
import { Compass, Search, Star, Bell, Menu, CandlestickChart } from 'lucide-react'
import './MobileHomeNav.css'

const BASE_TABS = [
  { id: 'screener', label: 'Discover', Icon: Compass },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'watchlist', label: 'Watchlist', Icon: Star },
]
const ALERTS_TAB = { id: 'alerts', label: 'Alerts', Icon: Bell }
const MENU_TAB = { id: 'menu', label: 'Menu', Icon: Menu }

// Long symbols would push the 5-up grid out of shape.
const shortSymbol = (s) => {
  const t = String(s || '').replace(/^\$/, '')
  return t.length > 7 ? `${t.slice(0, 6)}…` : t || 'Token'
}

export default function MobileHomeNav({ active, onChange, watchlistCount = 0, alertsCount = 0, lastToken = null }) {
  const tokenTab = lastToken
    ? { id: 'token', label: shortSymbol(lastToken.symbol), Icon: CandlestickChart, logo: lastToken.logo }
    : null
  const tabs = [...BASE_TABS, tokenTab || ALERTS_TAB, MENU_TAB]

  const badgeFor = (id) => {
    const n = id === 'watchlist' ? watchlistCount
      // With the token shortcut in the slot, the unseen-alerts signal would
      // vanish - park it on Menu, which is where Alerts now lives.
      : (id === 'alerts' || (id === 'menu' && tokenTab)) ? alertsCount
      : 0
    return n > 0 ? (n > 99 ? '99+' : String(n)) : null
  }

  return (
    <nav className="mhn" role="tablist" aria-label="Home sections">
      {tabs.map(({ id, label, Icon, logo }) => {
        const isActive = active === id
        const badge = badgeFor(id)
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={id === 'token' ? `Open ${label}` : label}
            className={`mhn-tab${isActive ? ' is-active' : ''}`}
            onClick={() => onChange?.(id)}
          >
            <span className="mhn-iconwrap">
              {id === 'token' && logo ? (
                <img
                  className="mhn-tokenlogo"
                  src={logo}
                  alt=""
                  width={20}
                  height={20}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
              )}
              {badge && <span className="mhn-badge">{badge}</span>}
            </span>
            <span className="mhn-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
