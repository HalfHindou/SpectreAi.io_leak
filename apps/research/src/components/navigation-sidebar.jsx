/**
 * NavigationSidebar Component
 * Left sidebar navigation - always visible with two modes:
 * 1. Collapsed: icons only (56px)
 * 2. Expanded: icons + full labels (240px)
 *
 * Features:
 * - Categorized navigation groups
 * - Mission Control overlay (app launcher grid)
 */
import React, { useState, useRef, useCallback, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { getNavIcon } from '@/components/nav-icons'
import useSettingsStore from '@/store/useSettingsStore'
import { prefetchRoute } from '@/lib/route-prefetch'
import { COMING_SOON_PAGE_IDS } from '@/constants/comingSoonPages'
import { NAV_SECTIONS } from '@/constants/navTree'
import { openThemeStudio, ThemeStudioIcon } from '@/lib/theme-studio'
import './navigation-sidebar.css'

/**
 * Showcase-embed mode.
 * When the app is loaded inside the /website2 iframe via ?embed=showcase
 * (or inside any iframe), most sections are locked down so visitors can
 * only browse the marketing-safe subset of the product. The nav entries
 * stay visible but are visually dimmed and their clicks are blocked.
 */
const SHOWCASE_ALLOWED_IDS = new Set([
  'research-platform',    // Landing / home
  'categories',
  'bubbles',
  'heatmaps',
  'economic-calendar',
  'fear-greed',
])

function detectShowcaseEmbed() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    // Also treat any cross-frame embed as showcase mode so the app is safe
    // to iframe anywhere without exposing locked surfaces.
    if (window.self !== window.top) return true
  } catch {
    // Cross-origin iframe check threw — that itself means embedded.
    return true
  }
  return false
}

const NavigationSidebar = ({ currentPage, onPageChange }) => {
  const { t } = useTranslation()
  const isShowcaseEmbed = detectShowcaseEmbed()
  const isCollapsed = useSettingsStore((s) => s.navSidebarCollapsed)
  const toggleCollapsedStore = useSettingsStore((s) => s.toggleNavSidebarCollapsed)
  const dayMode = useSettingsStore((s) => s.dayMode)
  const [tooltip, setTooltip] = useState({ text: '', top: 0, left: 0, visible: false })
  const tooltipTimerRef = useRef(null)
  const [missionControlOpen, setMissionControlOpen] = useState(false)

  const showTooltip = useCallback((e, label) => {
    if (!isCollapsed) return
    clearTimeout(tooltipTimerRef.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({
      text: label,
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
      visible: true,
    })
  }, [isCollapsed])

  const hideTooltip = useCallback(() => {
    tooltipTimerRef.current = setTimeout(() => {
      setTooltip(prev => ({ ...prev, visible: false }))
    }, 50)
  }, [])

  // Escape key closes Mission Control
  useEffect(() => {
    if (!missionControlOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') setMissionControlOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [missionControlOpen])

  const getIcon = getNavIcon

  /* ── Categorized navigation (sourced from the registry) ── */
  const isDesktopApp = typeof window !== 'undefined' && window.spectre?.isDesktop
  const navigationCategories = NAV_SECTIONS
    .map((section) => ({
      id: section.id,
      label: t(section.labelKey),
      items: section.items
        .filter((item) => !item.requiresDesktop || isDesktopApp)
        .map((item) => ({
          id: item.id,
          label: t(item.labelKey),
          badge: item.badgeKey ? t(item.badgeKey) : undefined,
          // Stable flag for "coming soon" treatment — do not rely on the
          // translated string because it varies by locale.
          isComingSoon: item.badgeKey === 'nav.badge.comingSoon',
        })),
    }))
    .filter((section) => section.items.length > 0)

  const comingSoonIds = COMING_SOON_PAGE_IDS

  const isItemLocked = (itemId) =>
    comingSoonIds.has(itemId) || (isShowcaseEmbed && !SHOWCASE_ALLOWED_IDS.has(itemId))

  const fireShowcaseLockEvent = (itemId, source, reason) => {
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
        detail: { source, itemId, reason },
      }))
    } catch { /* noop */ }
  }

  const handleItemClick = (itemId) => {
    if (isItemLocked(itemId)) {
      const reason = comingSoonIds.has(itemId) ? 'coming-soon' : 'showcase'
      fireShowcaseLockEvent(itemId, 'nav-sidebar', reason)
      return
    }
    if (onPageChange) {
      onPageChange(itemId)
    }
  }

  const handleMissionCardClick = (itemId) => {
    if (isItemLocked(itemId)) {
      const reason = comingSoonIds.has(itemId) ? 'coming-soon' : 'showcase'
      fireShowcaseLockEvent(itemId, 'mission-control', reason)
      return
    }
    if (onPageChange) {
      onPageChange(itemId)
    }
    setMissionControlOpen(false)
  }

  const toggleCollapsed = () => {
    toggleCollapsedStore()
  }

  return (
    <>
      <aside className={`navigation-sidebar ${isCollapsed ? 'collapsed' : ''}`} data-tour="app-nav">
        <div className="navigation-sidebar-content">
          {/* Toggle button - above the navigation list */}
          <div className="navigation-sidebar-toggle-wrapper">
            <button
              className="navigation-sidebar-toggle"
              onClick={toggleCollapsed}
              title={isCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
              aria-label={isCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isCollapsed ? (
                  <path d="M9 18l6-6-6-6" />
                ) : (
                  <path d="M15 18l-6-6 6-6" />
                )}
              </svg>
              {!isCollapsed && <span className="navigation-sidebar-toggle-label">{t('nav.collapse')}</span>}
            </button>
          </div>

          <nav className="navigation-sidebar-nav" aria-label={t('nav.mainNavigationAria', 'Main navigation')}>
            <ul className="navigation-sidebar-list">
              {navigationCategories.map((cat, catIdx) => (
                <React.Fragment key={cat.id}>
                  {/* Category separator */}
                  {catIdx > 0 && isCollapsed && <li className="nav-category-divider" />}
                  {catIdx > 0 && !isCollapsed && (
                    <li className="nav-category-header">{cat.label}</li>
                  )}
                  {cat.items.map((item) => {
                    const isActive = currentPage === item.id || (item.id === 'research-platform' && !currentPage)
                    const locked = isItemLocked(item.id)
                    const isComingSoon = item.isComingSoon
                    return (
                      <li key={item.id} className="navigation-sidebar-item">
                        <button
                          type="button"
                          className={`navigation-sidebar-link ${isActive ? 'active' : ''} ${locked ? 'nav-locked' : ''}`}
                          onClick={() => handleItemClick(item.id)}
                          onMouseEnter={(e) => { showTooltip(e, locked ? `${item.label} — ${isComingSoon ? 'coming soon' : 'locked in preview'}` : item.label); if (!locked) prefetchRoute(item.id) }}
                          onPointerDown={() => { if (!locked) prefetchRoute(item.id) }}
                          onMouseLeave={hideTooltip}
                          aria-disabled={locked || undefined}
                          tabIndex={locked ? -1 : undefined}
                          title={locked ? (isComingSoon ? t('nav.badge.comingSoon', 'Coming Soon') : t('header.betaUnavailable', 'Available in Beta')) : undefined}
                          data-nav-id={item.id}
                          data-nav-label={item.label}
                        >
                          <span className="navigation-sidebar-icon" aria-hidden="true">
                            {getIcon(item.id)}
                          </span>
                          <span className="navigation-sidebar-label">{item.label}</span>
                          {item.badge && (
                            <span className={`navigation-sidebar-badge ${isComingSoon ? 'nav-badge-coming-soon' : ''}`}>
                              {item.badge}
                            </span>
                          )}
                          {locked && !isComingSoon && (
                            <span className="nav-lock-icon" aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5" y="11" width="14" height="9" rx="2" />
                                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                              </svg>
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </React.Fragment>
              ))}
            </ul>
          </nav>

          {/* Website link - hidden in showcase embed */}
          {!isShowcaseEmbed && (
            <div className="nav-website-link-wrap">
              <a
                href="/website2"
                className="navigation-sidebar-link nav-website-link"
                onMouseEnter={(e) => showTooltip(e, t('nav.website', 'Website'))}
                onMouseLeave={hideTooltip}
              >
                <span className="navigation-sidebar-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </span>
                <span className="navigation-sidebar-label">{t('nav.website', 'Website')}</span>
              </a>
            </div>
          )}

          {/* Themes + Mission Control - pinned to bottom */}
          <div className="nav-mission-control-trigger">
            <button
              type="button"
              className="navigation-sidebar-link nav-themes-btn"
              onClick={openThemeStudio}
              onMouseEnter={(e) => showTooltip(e, t('nav.themes', 'Themes'))}
              onMouseLeave={hideTooltip}
            >
              <span className="navigation-sidebar-icon" aria-hidden="true">
                <ThemeStudioIcon size={20} strokeWidth={1.75} />
              </span>
              <span className="navigation-sidebar-label">{t('nav.themes', 'Themes')}</span>
            </button>
            <button
              type="button"
              className="navigation-sidebar-link nav-mission-btn"
              onClick={() => setMissionControlOpen(true)}
              onMouseEnter={(e) => showTooltip(e, t('nav.missionControl', 'Mission Control'))}
              onMouseLeave={hideTooltip}
            >
              <span className="navigation-sidebar-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="8" height="8" rx="2" />
                  <rect x="13" y="3" width="8" height="8" rx="2" />
                  <rect x="3" y="13" width="8" height="8" rx="2" />
                  <rect x="13" y="13" width="8" height="8" rx="2" />
                </svg>
              </span>
              <span className="navigation-sidebar-label">{t('nav.missionControl', 'Mission Control')}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Fixed-position tooltip via portal - escapes all overflow clipping */}
      {isCollapsed && tooltip.text && createPortal(
        <div
          className={`navigation-sidebar-tooltip ${tooltip.visible ? 'visible' : ''}`}
          style={{
            top: tooltip.top,
            left: tooltip.left,
            transform: `translateY(-50%) ${tooltip.visible ? 'translateX(0)' : 'translateX(-4px)'}`,
          }}
        >
          {tooltip.text}
        </div>,
        document.body
      )}

      {/* Mission Control overlay — macOS Launchpad style */}
      {missionControlOpen && createPortal(
        <div className={`mission-control-overlay ${dayMode ? 'mc-day' : ''}`} onClick={() => setMissionControlOpen(false)}>
          <div className="mission-control-container" onClick={(e) => e.stopPropagation()}>
            {/* Glass gleam highlight */}
            <div className="mc-gleam" />
            <div className="mission-control-header">
              <h2>{t('nav.missionControl', 'Mission Control')}</h2>
              {/* Themes is an ACTION, not a page — it belongs in the header
                  beside Close, never as a launchpad tile that would promise a
                  route it doesn't have. Closes the overlay first, or the studio
                  opens behind it. */}
              <button
                type="button"
                className="mission-control-themes"
                onClick={() => { setMissionControlOpen(false); openThemeStudio() }}
              >
                <ThemeStudioIcon size={15} strokeWidth={1.8} />
                {t('nav.themes', 'Themes')}
              </button>
              <button
                type="button"
                className="mission-control-close"
                onClick={() => setMissionControlOpen(false)}
                aria-label={t('nav.closeMissionControl', 'Close Mission Control')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="mc-launchpad">
              {navigationCategories.flatMap((cat) => cat.items).map((item) => {
                const isActive = currentPage === item.id || (item.id === 'research-platform' && !currentPage)
                const locked = isItemLocked(item.id)
                const isComingSoon = item.isComingSoon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mc-app ${isActive ? 'active' : ''} ${locked ? 'mc-app-locked' : ''}`}
                    onClick={() => handleMissionCardClick(item.id)}
                    aria-disabled={locked || undefined}
                    title={locked ? (isComingSoon ? t('nav.badge.comingSoon', 'Coming Soon') : t('header.betaUnavailable', 'Available in Beta')) : undefined}
                    data-nav-id={item.id}
                    data-nav-label={item.label}
                  >
                    <div className="mc-app-icon">
                      {getIcon(item.id)}
                    </div>
                    {item.badge && (isComingSoon || !locked) && (
                      <span className={`mc-app-badge ${isComingSoon ? 'mc-app-badge-coming-soon' : ''}`}>
                        {isComingSoon ? t('nav.badge.soon', 'Soon') : item.badge}
                      </span>
                    )}
                    <span className="mc-app-label">{item.label}</span>
                    {locked && !isComingSoon && (
                      <span className="mc-app-lock" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                        </svg>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// perf: memo so unrelated AppShell re-renders (toast, notification poll, 60s
// market tick) don't re-render the whole sidebar. Props are now all stable -
// currentPage changes only on real navigation, onPageChange is a useCallback.
export default memo(NavigationSidebar)
