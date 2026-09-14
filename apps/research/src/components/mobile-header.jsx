/**
 * MobileHeader - 2026 Mobile Edition
 * Replaces the desktop header on mobile with:
 * - Left: Hamburger menu -> navigation dropdown
 * - Center: Spectre AI logo
 * - Right: Voice search + Tools dropdown (crypto/stocks, day/night, language)
 *
 * Text search lives in the MobileBottomNav (elevated center button) - the header
 * deliberately does not duplicate it.
 *
 * Showcase embed parity (2026-05-13):
 *   Voice search routes the user into a search/voice surface that
 *   is locked in the iframe demo. Mute the icon + stamp a corner lock
 *   in showcase mode, same pattern as the bottom-nav center search.
 *
 * Clean, Apple-level design with glass morphism dropdowns
 * NO emoticons - SVG icons only
 */
import React, { useState, useEffect, useRef, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { getNavIcon } from '@/components/nav-icons'
import { useCurrency } from '@/hooks/useCurrency'
import { LANGUAGE_LIST } from '@/lib/currencyConfig'
import { useWalletBalance, formatBalance } from '@/hooks/useWalletBalance'
import { usePrivySafe } from '@/lib/use-privy-safe'
import { getPrivyDisplayInfo } from '@/lib/privy-user'
import useSettingsStore from '@/store/useSettingsStore'
import { track, Events } from '@/services/analytics'
import { NAV_SECTIONS } from '@/constants/navTree'
import { TRADING_TERMINAL_HOME, isStandalonePwa } from '@/lib/trading-terminal'
import { openThemeStudio, ThemeStudioIcon } from '@/lib/theme-studio'
import './mobile-header.css'

function detectShowcaseEmbed() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
}

/* ── SVG icon helper ── */
const Icon = ({ d, size = 20, stroke = 'currentColor', fill = 'none', strokeWidth = 2, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {d && <path d={d} />}
    {children}
  </svg>
)


const MobileHeader = ({
  marketMode,
  onMarketModeChange,
  dayMode,
  onDayModeChange,
  onVoiceSearch,
  onLogoClick,
  onOpenDrawer,
  onOpenSettings,
  onPageChange,
  currentPage,
  profile,
}) => {
  const { t } = useTranslation()
  const { language, setLanguage } = useCurrency()
  const walletBalance = useWalletBalance()
  const totalUsd = walletBalance.totalUsd

  // Privy auth state — mirrors desktop header (deferred-safe wrapper: stub
  // until the lazy PrivyProvider mounts; login() pulls it in on demand).
  const privy = usePrivySafe()
  const isAuthenticated = privy?.authenticated
  const privyUser = privy?.user
  const privyLogin = privy?.login
  const privyLogout = privy?.logout
  const privyInfo = getPrivyDisplayInfo(privyUser)
  const storeProfile = useSettingsStore((s) => s.profile)
  const syncProfileToUser = useSettingsStore((s) => s.syncProfileToUser)
  useEffect(() => {
    if (privyUser?.id) syncProfileToUser(privyUser.id)
  }, [privyUser?.id, syncProfileToUser])
  const resolvedProfile = (() => {
    if (profile?.name) return profile
    const storeName = storeProfile?.name
    const storeImg = storeProfile?.imageUrl
    if (storeName) return { name: storeName, imageUrl: storeImg || privyInfo.avatar || '' }
    if (isAuthenticated && privyInfo.name) return { name: privyInfo.name, imageUrl: privyInfo.avatar || '' }
    return null
  })()
  const [leftMenuOpen, setLeftMenuOpen] = useState(false)
  const [rightMenuOpen, setRightMenuOpen] = useState(false)
  const [langPickerOpen, setLangPickerOpen] = useState(false)
  const headerRef = useRef(null)
  const isShowcaseEmbed = detectShowcaseEmbed()

  // Close menus on page change
  useEffect(() => {
    setLeftMenuOpen(false)
    setRightMenuOpen(false)
  }, [currentPage])

  // Reset lang picker when settings dropdown closes
  useEffect(() => {
    if (!rightMenuOpen) setLangPickerOpen(false)
  }, [rightMenuOpen])

  /* ── Navigation categories — sourced from the shared registry ── */
  // isDesktopApp is read from a global at module-eval-time semantics; it never
  // changes within a session, so it's a stable input to the memo below.
  const isDesktopApp = typeof window !== 'undefined' && window.spectre?.isDesktop
  // Memoized: NAV_SECTIONS is static and only `t` (language) + isDesktopApp gate
  // the output. Without this the full nav tree was rebuilt on every render.
  const navigationCategories = useMemo(() => NAV_SECTIONS
    .map((section) => ({
      id: section.id,
      label: t(section.labelKey),
      items: section.items
        .filter((item) => !item.requiresDesktop || isDesktopApp)
        .map((item) => ({
          id: item.id,
          label: t(item.labelKey),
          badge: item.badgeKey ? t(item.badgeKey) : undefined,
          isComingSoon: item.badgeKey === 'nav.badge.comingSoon',
        })),
    }))
    .filter((section) => section.items.length > 0),
  [t, isDesktopApp])

  /* ── Dropdown render functions (portaled to body to escape header stacking context) ── */
  const renderLeftDropdown = () => (
    <div className="mobile-header-dropdown mobile-header-dropdown-left">
      <div className="mobile-header-dropdown-inner">
        <div className="mobile-header-nav-list">
          {navigationCategories.map((cat, catIdx) => (
            <React.Fragment key={cat.id}>
              {catIdx > 0 && (
                <div className="mobile-header-nav-section">{cat.label}</div>
              )}
              {cat.items.map((item) => {
                const isActive = currentPage === item.id || (item.id === 'research-platform' && !currentPage)
                const isComingSoon = item.isComingSoon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mobile-header-nav-item ${isActive ? 'active' : ''}${isComingSoon ? ' is-locked' : ''}`}
                    onClick={() => {
                      if (isComingSoon) return
                      onPageChange?.(item.id)
                      setLeftMenuOpen(false)
                    }}
                    aria-disabled={isComingSoon || undefined}
                    title={isComingSoon ? t('nav.badge.comingSoon', 'Coming Soon') : undefined}
                  >
                    <span className="mobile-header-nav-icon">{getNavIcon(item.id)}</span>
                    <span className="mobile-header-nav-label">{item.label}</span>
                    {item.badge && (
                      <span className={`mobile-header-nav-badge ${isComingSoon ? 'mobile-header-nav-badge-coming-soon' : ''}`}>
                        {isComingSoon ? t('nav.badge.soon', 'Soon') : item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )

  const renderRightDropdown = () => (
    <div className="mobile-header-dropdown mobile-header-dropdown-right">
      <div className="mobile-header-dropdown-inner">
        <div className="mobile-header-dropdown-title">Settings</div>

        {/* Crypto / Stocks Toggle */}
        {onMarketModeChange && (
          <div className="mobile-header-toggle-row">
            <div className="mobile-header-toggle-info">
              <span className="mobile-header-toggle-icon">
                {marketMode === 'crypto' ? (
                  <Icon size={18} d="M12 2a10 10 0 100 20 10 10 0 000-20zM9.5 8h2a2.5 2.5 0 010 5h-2m0-5v8m0-3h3a2.5 2.5 0 010 5H9.5" />
                ) : (
                  <Icon size={18}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></Icon>
                )}
              </span>
              <span className="mobile-header-toggle-label">
                {marketMode === 'crypto' ? 'Crypto' : 'Stocks'}
              </span>
            </div>
            <button
              type="button"
              className={`mobile-header-pill-toggle ${marketMode === 'stocks' ? 'active' : ''}`}
              onClick={() => onMarketModeChange(marketMode === 'crypto' ? 'stocks' : 'crypto')}
              role="switch"
              aria-checked={marketMode === 'stocks'}
              aria-label="Toggle market mode"
            >
              <span className="mobile-header-pill-thumb" />
              <span className="mobile-header-pill-label-left">B</span>
              <span className="mobile-header-pill-label-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                </svg>
              </span>
            </button>
          </div>
        )}

        {/* Day / Night Toggle */}
        {onDayModeChange && (
          <div className="mobile-header-toggle-row">
            <div className="mobile-header-toggle-info">
              <span className="mobile-header-toggle-icon">
                {dayMode ? (
                  <Icon size={18}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></Icon>
                ) : (
                  <Icon size={18} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                )}
              </span>
              <span className="mobile-header-toggle-label">
                {dayMode ? 'Day Mode' : 'Night Mode'}
              </span>
            </div>
            <button
              type="button"
              className={`mobile-header-pill-toggle ${dayMode ? 'active' : ''}`}
              onClick={() => onDayModeChange(!dayMode)}
              role="switch"
              aria-checked={dayMode}
              aria-label="Toggle day mode"
            >
              <span className="mobile-header-pill-thumb" />
              <span className="mobile-header-pill-label-left">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              </span>
              <span className="mobile-header-pill-label-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                </svg>
              </span>
            </button>
          </div>
        )}

        {/* Language Selector */}
        <div className="mobile-header-toggle-row mobile-header-lang-row">
          <button
            type="button"
            className="mobile-header-lang-trigger"
            onClick={() => setLangPickerOpen(!langPickerOpen)}
            aria-expanded={langPickerOpen}
          >
            <span className="mobile-header-toggle-icon">
              <Icon size={18}>
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </Icon>
            </span>
            <span className="mobile-header-toggle-label">
              {LANGUAGE_LIST.find(l => l.code === language)?.nativeName || 'English'}
            </span>
            <span className={`mobile-header-lang-chevron ${langPickerOpen ? 'open' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
          {langPickerOpen && (
            <div className="mobile-header-lang-grid">
              {LANGUAGE_LIST.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={`mobile-header-lang-btn ${language === l.code ? 'active' : ''}`}
                  onClick={() => {
                    setLanguage(l.code)
                    setLangPickerOpen(false)
                  }}
                >
                  <span className="mobile-header-lang-flag">{l.flag}</span>
                  <span className="mobile-header-lang-name">{l.nativeName}</span>
                  {language === l.code && (
                    <span className="mobile-header-lang-check">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Profile / Sign In section - signed-in profile is tap-to-/user-dashboard */}
        {!isAuthenticated ? (
          <button
            type="button"
            className="mobile-header-signin-row"
            onClick={() => {
              setRightMenuOpen(false)
              privyLogin?.()
            }}
          >
            <span className="mobile-header-toggle-icon">
              <Icon size={18}>
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </Icon>
            </span>
            <span className="mobile-header-signin-label">{t('header.signIn', 'Sign In')}</span>
          </button>
        ) : (
          <div className="mobile-header-profile-row">
            <button
              type="button"
              className="mobile-header-profile-main"
              onClick={() => {
                setRightMenuOpen(false)
                onPageChange?.('user-dashboard')
              }}
              aria-label="Open user dashboard"
            >
              <div className="mobile-header-profile-avatar">
                {resolvedProfile?.imageUrl ? (
                  <img src={resolvedProfile.imageUrl} alt="" width="32" height="32" decoding="async" />
                ) : resolvedProfile?.avatar ? (
                  <img src={resolvedProfile.avatar} alt="" width="32" height="32" decoding="async" />
                ) : (
                  <span>{(resolvedProfile?.name || 'T')[0]?.toUpperCase()}</span>
                )}
              </div>
              <div className="mobile-header-profile-info">
                <span className="mobile-header-profile-name">{resolvedProfile?.name || 'Trader'}</span>
                <span className="mobile-header-profile-balance">{formatBalance(totalUsd)}</span>
              </div>
            </button>
            <button
              type="button"
              className="mobile-header-signout-btn"
              onClick={(e) => {
                e.stopPropagation()
                track(Events.SIGN_OUT || 'sign_out')
                privyLogout?.()
                setRightMenuOpen(false)
              }}
              aria-label={t('header.signOut', 'Sign Out')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )

  const dropdownPortal = (leftMenuOpen || rightMenuOpen) ? createPortal(
    <div className={`mobile-header-portal${dayMode ? ' app-day-mode' : ''}`} ref={headerRef}>
      <div
        className="mobile-header-backdrop"
        onClick={() => { setLeftMenuOpen(false); setRightMenuOpen(false) }}
      />
      {leftMenuOpen && renderLeftDropdown()}
      {rightMenuOpen && renderRightDropdown()}
    </div>,
    document.body
  ) : null

  return (
    <>
    <header className="mobile-header">
      <div className="mobile-header-inner">
        {/* Left: Hamburger + LITE (grouped so the logo stays centered) */}
        <div className="mobile-header-left">
        <button
          type="button"
          className="mobile-header-btn mobile-header-hamburger"
          onClick={() => { setRightMenuOpen(false); onOpenDrawer?.() }}
          aria-label="Navigation menu"
        >
          <div className="mobile-header-hamburger-lines">
            <span />
            <span />
            <span />
          </div>
        </button>
        {/* Spectre LITE - simple mode (RAW beta), clearly labeled */}
        {!isShowcaseEmbed && (
          <button
            type="button"
            className="mobile-header-btn mobile-header-lite"
            onClick={() => { setLeftMenuOpen(false); setRightMenuOpen(false); onPageChange?.('lite') }}
            aria-label={t('header.openLite', 'Switch to Spectre LITE')}
          >
            {t('header.lite', 'LITE')}
          </button>
        )}
        </div>

        {/* Center: Logo */}
        <button
          className="mobile-header-logo"
          onClick={() => { onLogoClick?.(); setLeftMenuOpen(false); setRightMenuOpen(false) }}
          aria-label="Spectre AI Home"
        >
          <img
            src={dayMode ? '/logo-day-mode.png' : '/spectre-logo-header.png'}
            alt=""
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
          <span className="mobile-header-logo-text" style={{ display: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
            Spectre AI
          </span>
        </button>

        {/* Right: Trading terminal + Voice + Tools */}
        <div className="mobile-header-right">
          {/* Cross-nav to the full standalone trading terminal
              (trade.spectreai.io). Desktop header has this; mobile did not.
              Same-tab plain anchor (matches desktop). Hidden in the showcase
              iframe, which locks external navigation. */}
          {!isShowcaseEmbed && (
            <a
              href={TRADING_TERMINAL_HOME}
              className="mobile-header-btn mobile-header-trade"
              aria-label={t('header.openTrading', 'Open Trading Platform')}
              title={t('header.openTrading', 'Open Trading Platform')}
              onClick={(e) => {
                // Installed PWA: leaving the origin pops iOS's in-app browser
                // sheet. Route through the shared page funnel to the in-app
                // /token embed instead.
                if (isStandalonePwa()) {
                  e.preventDefault()
                  onPageChange?.('ai-screener')
                }
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </a>
          )}
          {/* Voice Search - locked in showcase iframe (search surfaces
              aren't in the demo allow-list). Same lock pattern as the
              bottom-nav center search: muted icon + corner padlock. */}
          <button
            type="button"
            className={`mobile-header-btn mobile-header-voice${isShowcaseEmbed ? ' is-locked' : ''}`}
            onClick={() => {
              if (isShowcaseEmbed) {
                try {
                  window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
                    detail: { source: 'mobile-header-voice', itemId: 'voice-search' },
                  }))
                } catch { /* noop */ }
                return
              }
              onVoiceSearch?.(); setLeftMenuOpen(false); setRightMenuOpen(false)
            }}
            aria-label={isShowcaseEmbed ? 'Voice Search (available in Beta)' : 'Voice Search'}
            aria-disabled={isShowcaseEmbed || undefined}
            title={isShowcaseEmbed ? 'Available in Beta' : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            {isShowcaseEmbed && (
              <span className="mobile-header-voice-lock" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              </span>
            )}
          </button>

          {/* Themes — parity with the desktop header. The Theme Studio used to
              be reachable only from a floating fab that sat over the content
              (a Top Coins row, the watchlist Add tile) on every page. */}
          <button
            type="button"
            className="mobile-header-btn mobile-header-themes"
            onClick={() => { setRightMenuOpen(false); setLeftMenuOpen(false); openThemeStudio() }}
            aria-label="Themes"
          >
            <ThemeStudioIcon size={20} strokeWidth={2} />
          </button>

          <button
            type="button"
            className="mobile-header-btn mobile-header-tools"
            onClick={() => { setRightMenuOpen(false); setLeftMenuOpen(false); onOpenSettings?.() }}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

    </header>
    {dropdownPortal}
    </>
  )
}

// React.memo: shell chrome that re-renders on every AppShell render (toast /
// notification poll / 60s market tick) unless memoized. Holds now that AppShell
// passes stable (useCallback) handlers for every function prop.
export default memo(MobileHeader)
