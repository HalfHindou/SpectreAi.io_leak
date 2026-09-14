/**
 * MobileMenuScreen — the Menu tab (prefix mmn-).
 *
 * App-level destinations + appearance. Theme toggle mirrors the Header's
 * contract exactly: body.theme-light class + 'spectre-color-mode' in
 * localStorage, so the two controls stay in sync.
 */
import React, { useState, useCallback } from 'react'
import {
  Terminal, LayoutDashboard, Flame, Sun, Moon, ExternalLink, ChevronRight, Bell,
} from 'lucide-react'
import './MobileMenuScreen.css'

// Same default target the desktop Discover footer uses.
const SPECTRE_TOKEN = {
  symbol: 'SPECTRE',
  name: 'Spectre AI',
  address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6',
  networkId: 1,
  verified: true,
  socials: { twitter: 'https://x.com/Spectre__AI' },
}

export default function MobileMenuScreen({ navigateTo, selectToken, onOpenAlerts, alertsCount = 0 }) {
  const [colorMode, setColorMode] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('spectre-color-mode') === 'light' ? 'light' : 'dark'
  )

  const toggleTheme = useCallback(() => {
    setColorMode(prev => {
      const next = prev === 'light' ? 'dark' : 'light'
      document.body.classList.toggle('theme-light', next === 'light')
      try { localStorage.setItem('spectre-color-mode', next) } catch { /* noop */ }
      return next
    })
  }, [])

  return (
    <div className="mmn">
      <div className="mmn-brand">
        <img src="/round-logo.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <div className="mmn-brand-text">
          <span className="mmn-brand-name">Spectre AI</span>
          <span className="mmn-brand-sub">Trading terminal</span>
        </div>
      </div>

      <div className="mmn-group">
        <span className="mmn-group-label">Navigate</span>
        <button type="button" className="mmn-item" onClick={() => selectToken?.(SPECTRE_TOKEN, 'mobile-menu')}>
          <Terminal size={18} strokeWidth={1.8} />
          <span>Terminal<em>Open the SPECTRE token page</em></span>
          <ChevronRight size={16} strokeWidth={2} className="mmn-chev" />
        </button>
        <button type="button" className="mmn-item" onClick={() => navigateTo?.('trending')}>
          <Flame size={18} strokeWidth={1.8} />
          <span>Trending Hub<em>Narratives and hot boards</em></span>
          <ChevronRight size={16} strokeWidth={2} className="mmn-chev" />
        </button>
        <button type="button" className="mmn-item" onClick={() => navigateTo?.('user-dashboard')}>
          <LayoutDashboard size={18} strokeWidth={1.8} />
          <span>Dashboard<em>Profile, wallet and settings</em></span>
          <ChevronRight size={16} strokeWidth={2} className="mmn-chev" />
        </button>
        {/* The bottom nav gives slot 4 to the last-token shortcut once the
            user has opened a token, so Alerts always has a home here. */}
        {onOpenAlerts && (
          <button type="button" className="mmn-item" onClick={onOpenAlerts}>
            <Bell size={18} strokeWidth={1.8} />
            <span>Alerts<em>Price rules and what has triggered</em></span>
            {alertsCount > 0 && <span className="mmn-state">{alertsCount > 99 ? '99+' : alertsCount}</span>}
            <ChevronRight size={16} strokeWidth={2} className="mmn-chev" />
          </button>
        )}
      </div>

      <div className="mmn-group">
        <span className="mmn-group-label">Appearance</span>
        <button type="button" className="mmn-item" onClick={toggleTheme} aria-pressed={colorMode === 'light'}>
          {colorMode === 'light' ? <Moon size={18} strokeWidth={1.8} /> : <Sun size={18} strokeWidth={1.8} />}
          <span>{colorMode === 'light' ? 'Dark mode' : 'Light mode'}<em>Switch the interface theme</em></span>
          <span className="mmn-state">{colorMode === 'light' ? 'Light' : 'Dark'}</span>
        </button>
      </div>

      <div className="mmn-group">
        <span className="mmn-group-label">Platform</span>
        <a className="mmn-item" href="https://app.spectreai.io" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={18} strokeWidth={1.8} />
          <span>Research Platform<em>app.spectreai.io</em></span>
        </a>
        <a className="mmn-item" href="https://spectreai.io" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={18} strokeWidth={1.8} />
          <span>Website<em>spectreai.io</em></span>
        </a>
      </div>

      <div className="mmn-socials">
        <a href="https://x.com/Spectre__AI" target="_blank" rel="noopener noreferrer" aria-label="X">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a href="https://telegram.me/AI_SPECTRE" target="_blank" rel="noopener noreferrer" aria-label="Telegram">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
        </a>
        <a href="https://www.youtube.com/@ai-spectre" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
        </a>
      </div>

      <p className="mmn-copy">&copy; {new Date().getFullYear()} Spectre AI</p>
    </div>
  )
}
