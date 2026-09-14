/**
 * SideDrawer - Mobile navigation drawer (left side).
 * Uses inline SVGs matching the desktop navigation-sidebar icons.
 * Exact desktop sidebar CSS values: 280px, link padding 9px 12px, radius 10px, 13px/450.
 *
 * Showcase embed parity (2026-05-13):
 *   When the app is iframed from spectreai.io (?embed=showcase OR any
 *   cross-frame embed), most pages are locked down. Desktop sidebar
 *   already mirrors this via .nav-locked + a lock icon + "Available
 *   in Beta" tooltip. The mobile drawer was missing this signal
 *   entirely, so iframe visitors tapped "Research Zone" etc and were
 *   silently navigated nowhere. This version reuses the same
 *   SHOWCASE_ALLOWED_IDS set and renders a "Beta" pill + the same
 *   lock SVG next to locked items.
 */
import { memo, useEffect, useCallback, useMemo } from 'react'
import { openThemeStudio, ThemeStudioIcon } from '@/lib/theme-studio'
import { useTranslation } from 'react-i18next'
import { NAV_SECTIONS } from '@/constants/navTree'
import { NAV_ICONS } from '@/components/nav-icons'
import './side-drawer.css'
import useBackDismiss from '@/hooks/use-back-dismiss'

// Pages reachable in showcase embed mode. Mirror of the
// SHOWCASE_ALLOWED_IDS set in navigation-sidebar.jsx - keep in sync.
const SHOWCASE_ALLOWED_IDS = new Set([
  'research-platform',
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
    if (window.self !== window.top) return true
  } catch {
    return true
  }
  return false
}

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

/* ═══════════════════════════════════════════════════════════════
   Icon mapping - the SHARED canonical map (nav-icons.jsx). This file
   used to carry a hand-copied set that drifted: pages added later
   (alt-rotation, etf-flows, lens, why) rendered a blank icon slot.
   ═══════════════════════════════════════════════════════════════ */
const ICON_MAP = NAV_ICONS

/* Navigation groups now sourced from @/constants/navTree. Section labels are
   rendered uppercase via CSS (.side-drawer-group-label). */

const SideDrawer = ({ open, onClose, currentPage, onNavigate, onOpenMissionControl }) => {
  useBackDismiss(open, onClose)
  const { t } = useTranslation()
  const isShowcaseEmbed = detectShowcaseEmbed()
  const isDesktopApp = typeof window !== 'undefined' && window.spectre?.isDesktop

  // Build groups from the canonical registry, translating labels on the fly.
  const drawerGroups = useMemo(() => (
    NAV_SECTIONS
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
      .filter((section) => section.items.length > 0)
  ), [t, isDesktopApp])

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const comingSoonIds = useMemo(() => {
    const ids = new Set()
    NAV_SECTIONS.forEach((section) => section.items.forEach((item) => {
      if (item.badgeKey === 'nav.badge.comingSoon') ids.add(item.id)
    }))
    return ids
  }, [])

  const isItemLocked = useCallback((pageId) => (
    comingSoonIds.has(pageId) || (isShowcaseEmbed && !SHOWCASE_ALLOWED_IDS.has(pageId))
  ), [isShowcaseEmbed, comingSoonIds])

  const handleNavClick = useCallback((pageId) => {
    if (isItemLocked(pageId)) {
      const reason = comingSoonIds.has(pageId) ? 'coming-soon' : 'showcase'
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
            detail: { source: 'side-drawer', itemId: pageId, reason },
          }))
        } catch { /* noop */ }
      }
      return
    }
    onNavigate(pageId)
    onClose()
  }, [onNavigate, onClose, isItemLocked, comingSoonIds])

  const handleMissionControl = useCallback(() => {
    onClose()
    if (onOpenMissionControl) onOpenMissionControl()
  }, [onClose, onOpenMissionControl])

  return (
    <div className={`side-drawer-root${open ? ' is-open' : ''}`}>
      <div className="side-drawer-backdrop" onClick={onClose} />

      <aside className="side-drawer-panel" aria-label={t('sideDrawer.navigationDrawer', 'Navigation drawer')}>
        {/* Branding header */}
        <div className="side-drawer-header">
          <img src="/spectre-logo-header.png" alt="Spectre AI" className="side-drawer-logo side-drawer-logo--dark" />
          <img src="/logo-day-mode.png" alt="Spectre AI" className="side-drawer-logo side-drawer-logo--day" />
          <button className="side-drawer-close" onClick={onClose} aria-label={t('sideDrawer.closeNavigation', 'Close navigation')} type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Scrollable navigation (flex:1 — leaves room for pinned MC at bottom) */}
        <nav className="side-drawer-nav side-drawer-nav--with-footer">
          {drawerGroups.map((group, idx) => (
            <div key={group.id} className="side-drawer-group">
              {idx > 0 && <div className="side-drawer-divider" />}
              <div className="side-drawer-group-label">{group.label}</div>
              {group.items.map((item) => {
                const isActive = currentPage === item.id ||
                  (item.id === 'research-platform' && (!currentPage || currentPage === 'home'))
                const locked = isItemLocked(item.id)
                const isComingSoon = item.isComingSoon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`side-drawer-link${isActive ? ' active' : ''}${locked ? ' is-locked' : ''}`}
                    onClick={() => handleNavClick(item.id)}
                    aria-disabled={locked || undefined}
                    title={locked ? (isComingSoon ? t('nav.badge.comingSoon', 'Coming Soon') : t('header.betaUnavailable', 'Available in Beta')) : undefined}
                  >
                    <span className="side-drawer-link-icon">
                      {ICON_MAP[item.id]}
                    </span>
                    <span className="side-drawer-link-label">{item.label}</span>
                    {item.badge && (isComingSoon || !locked) && (
                      <span className={`side-drawer-link-badge ${isComingSoon ? 'side-drawer-badge-coming-soon' : ''}`}>
                        {isComingSoon ? t('nav.badge.soon', 'Soon') : item.badge}
                      </span>
                    )}
                    {locked && !isComingSoon && (
                      <span className="side-drawer-link-beta" aria-label={t('header.betaUnavailable', 'Available in Beta')}>
                        <LockIcon />
                        <span className="side-drawer-link-beta-text">{t('nav.badge.beta', 'Beta')}</span>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Themes — pinned with Mission Control, the drawer's other ACTION.
            Founder 08-04: "add on side additional so ppl can use it more in
            mobi and desktop"; desktop has it in the sidebar footer, this is the
            mobile side. 🪤 NOT the `renderLeftDropdown` in mobile-header.jsx —
            the hamburger calls `onOpenDrawer()` and opens THIS component, so
            that dropdown is dead markup and an entry added there never shows. */}
        <div className="side-drawer-mc">
          <button
            type="button"
            className="side-drawer-mc-btn"
            onClick={() => { onClose?.(); openThemeStudio() }}
          >
            <span className="side-drawer-mc-icon"><ThemeStudioIcon size={20} strokeWidth={1.75} /></span>
            <span className="side-drawer-mc-label">Themes</span>
          </button>
        </div>

        {/* Mission Control — pinned to bottom, opens iPhone-style app grid */}
        {onOpenMissionControl && (
          <div className="side-drawer-mc">
            <button
              type="button"
              className="side-drawer-mc-btn"
              onClick={handleMissionControl}
            >
              <span className="side-drawer-mc-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.75" />
                  <rect x="14" y="3" width="7" height="7" rx="1.75" />
                  <rect x="3" y="14" width="7" height="7" rx="1.75" />
                  <rect x="14" y="14" width="7" height="7" rx="1.75" />
                </svg>
              </span>
              <span className="side-drawer-mc-label">{t('nav.missionControl', 'Mission Control')}</span>
              <span className="side-drawer-mc-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}

SideDrawer.displayName = 'SideDrawer'
export default memo(SideDrawer)
