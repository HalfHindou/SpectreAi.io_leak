/**
 * Header — Spectre Trading platform top bar (H4 P2 rebuild).
 *
 * Floating glass command bar inset from the viewport edges. Five
 * clusters separated by hairline dividers:
 *
 *   [Brand] | [Environment capsule] | [Command bar] | (Spotify P3) | [Actions]
 *
 * Every functional handler is preserved verbatim from the previous
 * Header — only markup + CSS changed. The legacy search-modal
 * fallback is removed (CommandPalette is always mounted in App.jsx).
 *
 * Behaviour kept:
 *   - onLogoClick → discover/welcome view
 *   - onOpenCommandPalette → opens the global CommandPalette (Mod+K)
 *   - colorMode toggle → body.theme-light + localStorage + analytics
 *   - infoMode toggle → body.info-mode + localStorage + analytics
 *   - Privy login / logout flows
 *   - Referral apply (URL param) + own-code fetch + copy
 *   - Wallet balance display next to profile name
 *   - Scroll elevation: header gains stronger shadow past 8px
 *
 * Behaviour deferred:
 *   - Spotify widget slot (P3+P4 inserts it between the command
 *     bar and the actions cluster)
 *   - Settings gear handler (placeholder)
 *
 * Behaviour live:
 *   - Notification bell shows the real unseen-alert count (via
 *     unseenAlerts) and opens the notifications drawer.
 */

import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import {
  Search, Bell, Settings, Info, Telescope, Wallet, Sun, Moon,
  LogOut, LayoutDashboard, Copy, ChevronDown, Lock, MoreHorizontal,
} from 'lucide-react'
import { useCopyToast } from '../App'
import { PRIVY_APP_ID } from '../lib/privy-app-id'
import { getPrivyDisplayInfo } from '../lib/privy-user'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { useWalletBalance, formatBalance } from '../hooks/useWalletBalance'
import useSettingsStore from '../store/useSettingsStore'
import { track, Events, updateThemeSuperProp, registerSuperProps } from '../services/analytics'
import GlowButton from './ui/GlowButton'
import KeycapChip from './ui/KeycapChip'
import EnvironmentCapsule from './EnvironmentCapsule'
import ToneControl from './ToneControl'
import LayoutControl from './LayoutControl'
import './Header.css'

// Hash-based research URL: dev points at the local research server,
// prod at the production app.spectreai.io. __RESEARCH_PORT__ is a Vite
// define injected by the dev server.
function getResearchUrl() {
  if (import.meta.env.DEV) {
    const port = typeof __RESEARCH_PORT__ !== 'undefined' ? __RESEARCH_PORT__ : 5180
    return `http://localhost:${port}`
  }
  return 'https://app.spectreai.io'
}

// ----- Info popover (lives in a portal, anchored to the info button) -----

function InfoButton({ infoMode, toggleInfoMode }) {
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const hideTimer = useRef(null)

  const show = () => { clearTimeout(hideTimer.current); setHovered(true) }
  const hide = () => { hideTimer.current = setTimeout(() => setHovered(false), 120) }

  useLayoutEffect(() => {
    if (!hovered || !btnRef.current) { setPos(null); return }
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 10, left: rect.left + rect.width / 2 })
  }, [hovered])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`header-icon-btn header-icon-btn--info${infoMode ? ' is-on' : ''}`}
        onClick={toggleInfoMode}
        onMouseEnter={show}
        onMouseLeave={hide}
        aria-pressed={infoMode}
        aria-label={infoMode ? 'Turn off info tooltips' : 'Turn on info tooltips'}
        title="Educational tooltips"
      >
        <Info size={14} strokeWidth={2} />
      </button>
      {hovered && pos && ReactDOM.createPortal(
        <span
          className="header-info-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {infoMode
            ? 'Educational mode is active. Hover the amber dots next to any term for a plain-English explanation.'
            : 'Education & Onboarding — turn on to reveal helpful explanations for every metric, term, and concept on the platform.'}
        </span>,
        document.body
      )}
    </>
  )
}

// ----- Theme toggle — sliding pill -----
// Day mode is locked for the beta; the toggle still renders the dual-glyph
// pill but tags itself .is-locked and the parent wires onToggle to a Coming
// Soon toast. Tiny Lock glyph sits on the inactive (sun) side so the gated
// state reads at a glance.

function ThemeToggle({ colorMode, onToggle, locked = false }) {
  const labelLocked = 'Day Mode (Coming Soon)'
  return (
    <button
      type="button"
      className={`header-theme-toggle${colorMode === 'light' ? ' is-day' : ' is-night'}${locked ? ' is-locked' : ''}`}
      onClick={onToggle}
      aria-pressed={colorMode === 'light'}
      aria-disabled={locked || undefined}
      aria-label={locked ? labelLocked : (colorMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode')}
      title={locked ? labelLocked : (colorMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode')}
    >
      <span className="header-theme-glyph header-theme-glyph--moon" aria-hidden="true">
        <Moon size={11} strokeWidth={2.2} />
      </span>
      <span className="header-theme-glyph header-theme-glyph--sun" aria-hidden="true">
        {locked
          ? <Lock size={9} strokeWidth={2.4} />
          : <Sun size={11} strokeWidth={2.2} />}
      </span>
      <span className="header-theme-knob" aria-hidden="true" />
    </button>
  )
}

// ----- The Header -----

const Header = ({
  onLogoClick,
  navigateTo,
  onOpenCommandPalette,
  unseenAlerts = 0,
  onOpenNotifications,
  // Token-page layout controls (Zone Stacks) - pill shown on the token view
  // only; onCustomizeLayout opens the drag editor.
  showLayoutControl = false,
  onCustomizeLayout,
  // Legacy props kept for API compatibility (callers still pass them)
  /* eslint-disable no-unused-vars */
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
  selectToken,
  /* eslint-enable no-unused-vars */
}) => {
  const isMac = typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')

  // ----- Theme + info mode -----
  const [colorMode, setColorMode] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('spectre-color-mode') === 'light'
      ? 'light' : 'dark'
  )
  const [infoMode, setInfoMode] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('spectre-info-mode') === 'on'
  )

  useEffect(() => {
    document.body.classList.toggle('theme-light', colorMode === 'light')
    localStorage.setItem('spectre-color-mode', colorMode)
    return () => document.body.classList.remove('theme-light')
  }, [colorMode])

  useEffect(() => {
    registerSuperProps({ theme: colorMode === 'light' ? 'day' : 'dark' })
  }, [colorMode])

  useEffect(() => {
    document.body.classList.toggle('info-mode', infoMode)
    localStorage.setItem('spectre-info-mode', infoMode ? 'on' : 'off')
    return () => document.body.classList.remove('info-mode')
  }, [infoMode])

  const toggleColorMode = () => {
    const newMode = colorMode === 'light' ? 'dark' : 'light'
    track(Events.SETTINGS_CHANGED, { setting: 'theme', value: newMode === 'light' ? 'day' : 'night' })
    updateThemeSuperProp(newMode === 'light' ? 'day' : 'dark')
    setColorMode(newMode)
  }

  const toggleInfoMode = () => {
    const newValue = !infoMode
    track(Events.SETTINGS_CHANGED, { setting: 'info_mode', value: newValue })
    setInfoMode(newValue)
  }

  // ----- Privy auth -----
  const privy = PRIVY_APP_ID ? usePrivy() : {}
  const isAuthenticated = privy?.authenticated
  const privyReady = PRIVY_APP_ID ? privy?.ready : true
  const privyUser = privy?.user
  const privyLogin = privy?.login
  const privyLogout = privy?.logout
  const privyInfo = getPrivyDisplayInfo(privyUser)

  // Profile priority: Zustand (synced) → Privy raw → fallback
  const storedProfile = useSettingsStore((s) => s.profile)
  const profile = (() => {
    if (storedProfile?.name) {
      return { name: storedProfile.name, imageUrl: storedProfile.imageUrl || privyInfo.avatar || '' }
    }
    if (isAuthenticated && privyInfo.name) {
      return { name: privyInfo.name, imageUrl: privyInfo.avatar || '' }
    }
    return { name: 'User', imageUrl: '' }
  })()

  // Wallet balance for header display
  const walletBal = PRIVY_APP_ID ? useWalletBalance() : { totalUsd: null }
  const totalUsd = walletBal.totalUsd

  // ----- Referral apply + fetch (preserved from legacy header) -----
  const { triggerCopyToast } = useCopyToast()
  const [referralApplied, setReferralApplied] = useState(
    () => localStorage.getItem('spectre-referral-applied') === 'true'
  )
  const [referralCode, setReferralCode] = useState('')

  useEffect(() => {
    if (!isAuthenticated) return
    if (localStorage.getItem('spectre-onboarding-done') !== 'true') return
    const code = localStorage.getItem('spectre-referral-code')
    if (!code) return
    ;(async () => {
      try {
        const token = await privy?.getAccessToken?.()
        if (!token) return
        const res = await fetch('/api/referral/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code: String(code).trim().toUpperCase() }),
        })
        const data = await res.json()
        if (data?.success) {
          setReferralApplied(true)
          localStorage.setItem('spectre-referral-applied', 'true')
        }
      } catch {/* retry on next sign-in */}
      finally { localStorage.removeItem('spectre-referral-code') }
    })()
  }, [isAuthenticated])  // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Profile dropdown -----
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef(null)

  /* Referral code - fetched when the profile menu is FIRST opened, not on boot.
     The code renders in exactly one place: the row inside this dropdown (see
     `header-profile-menu-referral-code` below). It used to be fetched on every
     page load - measured 500ms on prod, inside the busiest part of the boot -
     for a string nobody can see until they open the menu. Fetched once per
     session; the UI hides the row while the code is empty. */
  const referralFetchedRef = useRef(false)
  useEffect(() => {
    if (!isAuthenticated || !privy?.user?.id) return
    if (!profileOpen || referralFetchedRef.current) return
    referralFetchedRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const token = await privy?.getAccessToken?.()
        if (!token) { referralFetchedRef.current = false; return }
        const res = await fetch('/api/referral/code', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!cancelled && data?.code) setReferralCode(data.code)
      } catch {
        referralFetchedRef.current = false // let the next open retry
      }
    })()
    return () => { cancelled = true }
  }, [isAuthenticated, privy?.user?.id, profileOpen])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!profileOpen) return
    const onDown = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [profileOpen])

  // ----- More popover (overflow menu for narrow viewports) -----
  // Holds Research / Deposit / Info / Notifications when those items
  // are hidden inline at <=1280px. Search stays in the bar at all widths.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)

  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false)
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  // ----- Settings popover (mirrors UD Settings appearance toggles) -----
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef(null)
  const showMoodWall = useSettingsStore((s) => s.showMoodWall)
  const toggleShowMoodWall = useSettingsStore((s) => s.toggleShowMoodWall)
  const tokenColoring = useSettingsStore((s) => s.tokenColoring)
  const toggleTokenColoring = useSettingsStore((s) => s.toggleTokenColoring)
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const toggleReducedMotion = useSettingsStore((s) => s.toggleReducedMotion)

  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false)
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen])

  /* Deposit — UNLOCKED (2026-07-30) and pointed at RECEIVE.
     Card/fiat funding is still not live (the wallet's own Deposit action stays
     locked, and Privy's card on-ramp needs a dashboard provider we haven't
     confirmed), but crypto-transfer funding works today. So the pill now does
     the useful thing instead of toasting "coming soon": deep-link into the
     wallet's Receive panel — address + QR — via the same one-shot sessionStorage
     handshake the "Fund the wallet to trade" CTA uses (RightPanel). */
  const openDepositReceive = useCallback(() => {
    try {
      sessionStorage.setItem('ud-open-section', 'wallet')
      sessionStorage.setItem('ud-open-panel', 'receive')
    } catch { /* private mode - dashboard still opens on its default panel */ }
    window.history.pushState({ view: 'user-dashboard' }, '', '#dashboard')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'user-dashboard' } }))
  }, [])

  // ----- Scroll elevation -----
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled((window.scrollY || 0) > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ----- Render -----
  return (
    <header
      className={[
        'header',
        scrolled && 'header--scrolled',
        profileOpen && 'header--profile-open',
      ].filter(Boolean).join(' ')}
    >
      <div className="header-bar" role="navigation" aria-label="Platform">
        {/* LEFT cluster — Brand + Weather (grid column 1) */}
        <div className="header-left">
          <button
            type="button"
            className="header-brand"
            onClick={onLogoClick}
            title="Discover Tokens"
            aria-label="Spectre AI — go to discover"
          >
            {/* Pre-rendered at the exact device sizes (26px x 1/2/3/4 dpr) so the
                browser never downsamples the 512px master itself - that is what
                turned the phoenix to mush at 24px. */}
            <img
              src="/brand/spectre-mark-52.png"
              srcSet="/brand/spectre-mark-26.png 26w, /brand/spectre-mark-52.png 52w, /brand/spectre-mark-78.png 78w, /brand/spectre-mark-104.png 104w"
              sizes="26px"
              width={26}
              height={26}
              alt=""
              className="header-mark"
              aria-hidden="true"
              decoding="async"
            />
            <span className="header-wordmark">Spectre AI</span>
          </button>
          <span className="header-divider" aria-hidden="true" />
          <EnvironmentCapsule />
          {/* Token view: ONE Customize hub (layout + background/appearance).
              Other views keep the standalone tone pill. */}
          {showLayoutControl
            ? <LayoutControl onCustomize={onCustomizeLayout} />
            : <ToneControl />}
          {/* Day/light mode lives with the other appearance controls, next to
              Customize - it is a look setting, not an account action. */}
          <ThemeToggle
            colorMode={colorMode}
            onToggle={toggleColorMode}
          />
        </div>

        {/* CENTRE — Command bar (grid column 2, geometrically centred) */}
        <button
          type="button"
          className="header-search"
          onClick={() => onOpenCommandPalette?.()}
          aria-label="Open command palette"
        >
          <Search size={14} strokeWidth={2} className="header-search-icon" aria-hidden="true" />
          <span className="header-search-placeholder">Search tokens, traders, anything…</span>
          <span className="header-kbd" aria-hidden="true">
            <KeycapChip size="sm">{isMac ? '⌘' : 'Ctrl'}</KeycapChip>
            <KeycapChip size="sm">K</KeycapChip>
          </span>
        </button>

        {/* RIGHT cluster — Actions only (grid column 3) */}
        <div className="header-right">
          <div className="header-actions">
          {/* Research opens in its own tab - the trading session stays put. */}
          <a
            href={getResearchUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="header-pill header-pill--ghost"
            title="Open Research Platform in a new tab"
          >
            <Telescope size={14} strokeWidth={2} aria-hidden="true" />
            <span className="header-pill-label">Research</span>
          </a>

          {/* Deposit is a signed-in action — signed out, the Sign In button
              sitting two slots away is the same first step. Opens the wallet's
              Receive panel (see openDepositReceive); card funding is separate
              and still locked inside the wallet section. */}
          {isAuthenticated && (
            <button
              type="button"
              className="header-pill header-pill--deposit"
              title="Deposit - fund your wallet by transfer"
              onClick={openDepositReceive}
            >
              <Wallet size={13} strokeWidth={2} aria-hidden="true" />
              <span className="header-pill-label">Deposit</span>
            </button>
          )}

          <span className="header-divider" aria-hidden="true" />

          {/* More menu — overflow drawer that mirrors the Settings popover.
              Holds Research / Deposit / Info / Notifications at narrow
              viewports so the search bar stays in the toolbar at every
              breakpoint. Hidden inline above 1280px (CSS). */}
          <div className="header-more-wrap" ref={moreRef}>
            <button
              type="button"
              className={`header-icon-btn header-icon-btn--more${moreOpen ? ' is-on' : ''}`}
              title="More"
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <MoreHorizontal size={16} strokeWidth={2} />
            </button>
            {moreOpen && (
              <div className="header-settings-menu header-more-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <div className="header-settings-menu-head">
                  <span className="header-settings-menu-title">Quick Actions</span>
                </div>

                <div className="header-settings-menu-group">
                  <a
                    href={getResearchUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    className="header-settings-row"
                    onClick={() => setMoreOpen(false)}
                  >
                    <span className="header-settings-row-info">
                      <span className="header-settings-row-glyph" aria-hidden="true">
                        <Telescope size={14} strokeWidth={1.7} />
                      </span>
                      <span className="header-settings-row-label">Research Platform</span>
                    </span>
                  </a>

                  <button
                    type="button"
                    role="menuitem"
                    className="header-settings-row"
                    onClick={() => { openDepositReceive(); setMoreOpen(false) }}
                  >
                    <span className="header-settings-row-info">
                      <span className="header-settings-row-glyph" aria-hidden="true">
                        <Wallet size={14} strokeWidth={1.7} />
                      </span>
                      <span className="header-settings-row-label">Deposit</span>
                    </span>
                    <span className="header-settings-row-trailing" />
                  </button>
                </div>

                <div className="header-settings-menu-group">
                  <span className="header-settings-menu-group-label">Workspace</span>

                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={infoMode ? 'true' : 'false'}
                    className="header-settings-row"
                    onClick={() => { toggleInfoMode(); setMoreOpen(false) }}
                  >
                    <span className="header-settings-row-info">
                      <span className="header-settings-row-glyph" aria-hidden="true">
                        <Info size={14} strokeWidth={1.7} />
                      </span>
                      <span className="header-settings-row-label">Info Tooltips</span>
                    </span>
                    <span className={`header-settings-toggle${infoMode ? ' is-on' : ''}`}>
                      <span className="header-settings-toggle-thumb" />
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <InfoButton infoMode={infoMode} toggleInfoMode={toggleInfoMode} />
          <button
            type="button"
            className="header-icon-btn header-icon-btn--notifications"
            title="Notifications"
            aria-label={unseenAlerts > 0 ? `Notifications, ${unseenAlerts} unread` : 'Notifications'}
            aria-haspopup="dialog"
            onClick={() => onOpenNotifications?.()}
          >
            <Bell size={14} strokeWidth={2} />
            {unseenAlerts > 0 && (
              <span className="header-icon-btn__badge">{unseenAlerts > 9 ? '9+' : unseenAlerts}</span>
            )}
          </button>
          {/* Settings: quick-toggle popover mirroring the UD Settings card.
              Dark Mode delegates to the header's own colorMode controller so
              the popover and the inline ThemeToggle stay in lockstep. Mood
              Walls / Token Coloring / Reduced Motion are owned by the
              Zustand settings store (synced cross-app via the same partialize
              keys that power UD Settings). */}
          <div className="header-settings-wrap" ref={settingsRef}>
            <button
              type="button"
              className={`header-icon-btn${settingsOpen ? ' is-on' : ''}`}
              title="Settings"
              aria-label="Settings"
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings size={14} strokeWidth={2} />
            </button>
            {settingsOpen && (
              <div className="header-settings-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <div className="header-settings-menu-head">
                  <span className="header-settings-menu-title">Settings</span>
                  <button
                    type="button"
                    className="header-settings-menu-link"
                    onClick={() => { navigateTo?.('user-dashboard'); setSettingsOpen(false) }}
                  >
                    Open dashboard
                  </button>
                </div>

                <div className="header-settings-menu-group">
                  <span className="header-settings-menu-group-label">Appearance</span>

                  {/* Dark mode toggle — mirrors the inline header pill (was
                      beta-locked). Checked = dark; off = light/white mode. */}
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={colorMode === 'dark' ? 'true' : 'false'}
                    title="Dark Mode"
                    className="header-settings-row"
                    onClick={toggleColorMode}
                  >
                    <span className="header-settings-row-info">
                      <span className="header-settings-row-glyph" aria-hidden="true">
                        <Moon size={14} strokeWidth={1.7} />
                      </span>
                      <span className="header-settings-row-label">Dark Mode</span>
                    </span>
                    <span className={`header-settings-toggle${colorMode === 'dark' ? ' is-on' : ''}`}>
                      <span className="header-settings-toggle-thumb" />
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={showMoodWall ? 'true' : 'false'}
                    className="header-settings-row"
                    onClick={toggleShowMoodWall}
                  >
                    <span className="header-settings-row-info">
                      <span className="header-settings-row-glyph" aria-hidden="true">
                        <LayoutDashboard size={14} strokeWidth={1.7} />
                      </span>
                      <span className="header-settings-row-label">Mood Walls</span>
                    </span>
                    <span className={`header-settings-toggle${showMoodWall ? ' is-on' : ''}`}>
                      <span className="header-settings-toggle-thumb" />
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={tokenColoring ? 'true' : 'false'}
                    className="header-settings-row"
                    onClick={toggleTokenColoring}
                  >
                    <span className="header-settings-row-info">
                      <span className="header-settings-row-glyph" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.7 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.37-.63-.37-1.02 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.17-4.49-8.94-10-8.94z" />
                          <circle cx="7.5" cy="11.5" r="1.5" />
                          <circle cx="12" cy="7.5" r="1.5" />
                          <circle cx="16.5" cy="11.5" r="1.5" />
                        </svg>
                      </span>
                      <span className="header-settings-row-label">Token Coloring</span>
                    </span>
                    <span className={`header-settings-toggle${tokenColoring ? ' is-on' : ''}`}>
                      <span className="header-settings-toggle-thumb" />
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={reducedMotion ? 'true' : 'false'}
                    className="header-settings-row"
                    onClick={toggleReducedMotion}
                  >
                    <span className="header-settings-row-info">
                      <span className="header-settings-row-glyph" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <line x1="4" y1="12" x2="20" y2="12" />
                          <line x1="12" y1="4" x2="12" y2="20" />
                        </svg>
                      </span>
                      <span className="header-settings-row-label">Reduced Motion</span>
                    </span>
                    <span className={`header-settings-toggle${reducedMotion ? ' is-on' : ''}`}>
                      <span className="header-settings-toggle-thumb" />
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className="header-divider" aria-hidden="true" />

          {/* Sign In or Profile */}
          {privyReady && !isAuthenticated && (
            <GlowButton
              variant="primary"
              size="sm"
              onClick={() => privyLogin?.()}
            >
              Sign In
            </GlowButton>
          )}

          {privyReady && isAuthenticated && (
            <div className="header-profile" ref={profileRef}>
              <button
                type="button"
                className={`header-profile-trigger${profileOpen ? ' is-open' : ''}`}
                onClick={() => setProfileOpen((v) => !v)}
                aria-expanded={profileOpen}
                aria-haspopup="menu"
              >
                <span className="header-profile-avatar">
                  {profile.imageUrl ? (
                    <img src={profile.imageUrl} alt="" />
                  ) : (
                    <span className="header-profile-initial">
                      {(profile.name || 'U').charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="header-profile-meta">
                  <span className="header-profile-name">{profile.name}</span>
                  <span className="header-profile-balance">
                    {totalUsd !== null ? formatBalance(totalUsd) : '$0.00'}
                  </span>
                </span>
                <ChevronDown
                  size={13}
                  strokeWidth={2}
                  className={`header-profile-chevron${profileOpen ? ' is-open' : ''}`}
                />
              </button>

              {profileOpen && (
                <div
                  className="header-profile-menu"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="header-profile-menu-head">
                    <span className="header-profile-menu-avatar">
                      {profile.imageUrl ? (
                        <img src={profile.imageUrl} alt="" />
                      ) : (
                        <span className="header-profile-initial">
                          {(profile.name || 'U').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="header-profile-menu-id">
                      <span className="header-profile-menu-name">{profile.name}</span>
                      {isAuthenticated && privyInfo.email && (
                        <span className="header-profile-menu-email">{privyInfo.email}</span>
                      )}
                    </span>
                  </div>

                  <div className="header-profile-menu-divider" />

                  <button
                    type="button"
                    className="header-profile-menu-item"
                    onClick={() => {
                      if (navigateTo) navigateTo('user-dashboard')
                      setProfileOpen(false)
                    }}
                    role="menuitem"
                  >
                    <LayoutDashboard size={14} strokeWidth={1.8} />
                    <span>User Dashboard</span>
                  </button>

                  {isAuthenticated && referralCode && (
                    <div className="header-profile-menu-item header-profile-menu-item--referral">
                      <span className="header-profile-menu-referral-label">Referral</span>
                      <code className="header-profile-menu-referral-code">{referralCode}</code>
                      <button
                        type="button"
                        className="header-profile-menu-copy"
                        onClick={() => {
                          navigator.clipboard.writeText(referralCode)
                          triggerCopyToast?.('Referral code copied!')
                        }}
                        aria-label="Copy referral code"
                      >
                        <Copy size={12} strokeWidth={1.8} />
                      </button>
                    </div>
                  )}

                  <div className="header-profile-menu-divider" />

                  {isAuthenticated && (
                    <button
                      type="button"
                      className="header-profile-menu-item header-profile-menu-item--signout"
                      onClick={() => {
                        track(Events.SIGN_OUT || 'sign_out')
                        privyLogout?.()
                        setProfileOpen(false)
                      }}
                      role="menuitem"
                    >
                      <LogOut size={14} strokeWidth={1.8} />
                      <span>Sign Out</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
