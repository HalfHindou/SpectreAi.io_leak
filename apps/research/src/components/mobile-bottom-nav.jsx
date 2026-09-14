/**
 * MobileBottomNav – Robinhood-style 4+1 layout
 * 5-tab bottom navigation: Welcome, Markets(dropdown), Search(center), Social(dropdown), Profile(dropdown)
 * Apple-level glass morphism, haptic-feel press states, elevated center search button
 *
 * Showcase embed parity (2026-05-13):
 *   When iframed from spectreai.io, only the showcase-allowed pages are
 *   reachable. The center Search button (search-engine route) becomes
 *   locked, and locked dropdown items render with a "Beta" pill matching
 *   the desktop nav-locked styling.
 */
import React, { useState, useEffect, useRef, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import { prefetchRoute } from '@/lib/route-prefetch'
import {
  findNavItem,
  MOBILE_BOTTOM_NAV_MARKETS_IDS,
  MOBILE_BOTTOM_NAV_SOCIAL_IDS,
  MOBILE_BOTTOM_NAV_PROFILE_IDS,
} from '@/constants/navTree'
import { useTabLight, TabLight } from './mobile-bottom-nav-light'
import './mobile-bottom-nav.css'

// Mirror of SHOWCASE_ALLOWED_IDS in navigation-sidebar.jsx + side-drawer.jsx.
const SHOWCASE_ALLOWED_IDS = new Set([
  'research-platform',
  'categories',
  'bubbles',
  'heatmaps',
  'economic-calendar',
  'fear-greed',
])
/* ── the travelling light ──────────────────────────────────────────────
   One accent per slot so a move reads as going somewhere specific rather than
   as a generic highlight sliding. Deliberately no violet — the design system
   reserves it for the EUPHORIA market state.

   Module scope, not a render-local literal: useTabLight keeps this array in the
   dep arrays of its re-target and ResizeObserver effects, so a fresh identity
   each render re-measures all five slots and rebuilds the observer per frame -
   and worse, re-runs the re-target effect mid-flight, which resets tripRef to
   the REMAINING distance and corrupts the tail spring's own launch reference. */
const SLOT_ACCENTS = ['#6ee7ff', '#4ade80', '#f5f5f7', '#fbbf24', '#38bdf8']

function detectShowcaseEmbed() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
}
function fireShowcaseLockEvent(itemId, source, reason) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
      detail: { source, itemId, reason },
    }))
  } catch { /* noop */ }
}
const LockMiniIcon = (
  <svg className="mobile-bottom-nav-lock-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

/* ─── SVG Icon library (24x24 viewBox, stroke-based) ─── */

const icons = {
  /* ── The five tab glyphs ──────────────────────────────────────────────
     One weight, one geometry, no filled twin. The travelling light is the
     active indicator now, so a second heavier glyph on the selected tab was
     just a second highlight competing with the ring. Drawn on a 24 grid at
     stroke 1.7 so they read at 22px without the strokes closing up. */
  home: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.6 10.4 12 3.8l8.4 6.6" />
      <path d="M5.6 9.2V19a1.2 1.2 0 0 0 1.2 1.2h10.4A1.2 1.2 0 0 0 18.4 19V9.2" />
      <path d="M9.6 20.2v-5.6h4.8v5.6" />
    </svg>
  ),
  homeFilled: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.6 10.4 12 3.8l8.4 6.6" />
      <path d="M5.6 9.2V19a1.2 1.2 0 0 0 1.2 1.2h10.4A1.2 1.2 0 0 0 18.4 19V9.2" />
      <path d="M9.6 20.2v-5.6h4.8v5.6" />
    </svg>
  ),
  /* Research Zone: candles.
     The first draft was a chart read through a LENS, which put a second
     magnifier two slots from the centre Search button — same shape, same
     meaning at a glance (founder: "research zone ... is confusing with
     search"). Candles are the one silhouette on this bar built from vertical
     strokes, so it cannot be mistaken for the house, the lens, the star or the
     grid, and it says "price analysis" without a word. */
  researchZoneTab: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.4 3.6v3.1M8.4 15.4v3.1" />
      <rect x="5.9" y="6.7" width="5" height="8.7" rx="1.4" />
      <path d="M16 5.9v3.6M16 18v2.5" />
      <rect x="13.5" y="9.5" width="5" height="8.5" rx="1.4" />
    </svg>
  ),
  watchlistTab: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.1l2.42 4.9 5.41.79-3.92 3.81.93 5.39L12 16.45l-4.84 2.54.93-5.39L4.17 9.79l5.41-.79z" />
    </svg>
  ),
  search: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="M15.6 15.6 20.4 20.4" />
    </svg>
  ),
  mission: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.6" y="3.6" width="7" height="7" rx="2.1" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="2.1" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="2.1" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="2.1" />
    </svg>
  ),
  missionFilled: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.6" y="3.6" width="7" height="7" rx="2.1" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="2.1" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="2.1" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="2.1" />
    </svg>
  ),
  social: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  socialFilled: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  profile: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  profileFilled: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),

  /* ─── Dropdown item icons ─── */
  discover: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  ),
  researchZone: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  ),
  aiScreener: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  heatmaps: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="9" height="11" rx="1" />
      <rect x="13" y="2" width="9" height="6" rx="1" />
      <rect x="13" y="10" width="9" height="12" rx="1" />
      <rect x="2" y="15" width="9" height="7" rx="1" />
    </svg>
  ),
  bubbles: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <circle cx="18" cy="8" r="4" />
      <circle cx="16" cy="18" r="3.5" />
    </svg>
  ),
  fearGreed: (
    // Full-circle gauge: needle from center, anchor at viewBox center
    // so it aligns vertically with neighbouring icons in dropdown rows.
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12l5-5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  calendar: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  tradersCorner: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-8 4 4 4-6" />
    </svg>
  ),
  liquidation: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 17l4-8 4 4 5-9" />
      <circle cx="7" cy="17" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="11" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  socialZone: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  xDash: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  xBubbles: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <circle cx="9" cy="10" r="1" />
      <circle cx="15" cy="10" r="1" />
    </svg>
  ),
  xIntelligence: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v3" />
      <path d="M21 16v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3" />
      <path d="M12 2v20" />
      <path d="M8 6l4-3 4 3" />
      <circle cx="7" cy="12" r="1.5" />
      <circle cx="17" cy="12" r="1.5" />
      <path d="M8.5 12h7" />
    </svg>
  ),
  mediaCenter: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  gmDashboard: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  ),
  watchlists: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  categories: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  aiCharts: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  userDashboard: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  roiCalculator: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <rect x="8" y="10" width="3" height="3" rx="0.5" />
      <rect x="13" y="10" width="3" height="3" rx="0.5" />
      <rect x="8" y="15" width="3" height="3" rx="0.5" />
      <rect x="13" y="15" width="3" height="3" rx="0.5" />
    </svg>
  ),
}

/* ─── Per-id icon map (visual lives here; IDs + labels come from navTree) ─── */
const ICON_BY_ID = {
  'discover': icons.discover,
  'research-zone': icons.researchZone,
  'ai-screener': icons.aiScreener,
  'heatmaps': icons.heatmaps,
  'bubbles': icons.bubbles,
  'fear-greed': icons.fearGreed,
  'economic-calendar': icons.calendar,
  'traders-corner': icons.tradersCorner,
  'liquidation-heatmap': icons.liquidation,
  'social-zone': icons.socialZone,
  'x-dash': icons.xDash,
  'x-bubbles': icons.xBubbles,
  'x-intelligence': icons.xIntelligence,
  'ai-media-center': icons.mediaCenter,
  'gm-dashboard': icons.gmDashboard,
  'watchlists': icons.watchlists,
  'categories': icons.categories,
  'ai-charts': icons.aiCharts,
  'user-dashboard': icons.userDashboard,
  'roi-calculator': icons.roiCalculator,
}

/* Build a dropdown items list by picking IDs out of the canonical navTree. */
function buildDropdownItems(ids, t) {
  return ids
    .map((id) => {
      const entry = findNavItem(id)
      if (!entry) return null
      return {
        id,
        label: t(entry.labelKey),
        icon: ICON_BY_ID[id] || null,
        badge: entry.badgeKey ? t(entry.badgeKey) : undefined,
        isComingSoon: entry.badgeKey === 'nav.badge.comingSoon',
      }
    })
    .filter(Boolean)
}

/* Collect all dropdown page IDs for active-state resolution */
const MARKETS_IDS = new Set(MOBILE_BOTTOM_NAV_MARKETS_IDS)
/* The Social TAB is gone (founder, 08-03) — its pages live in Mission Control
   now. The ID list stays imported because COMING_SOON_IDS below still needs it
   to resolve locked states for those pages wherever they are reached from. */
const PROFILE_IDS = new Set(MOBILE_BOTTOM_NAV_PROFILE_IDS)
const COMING_SOON_IDS = new Set(
  [...MOBILE_BOTTOM_NAV_MARKETS_IDS, ...MOBILE_BOTTOM_NAV_SOCIAL_IDS, ...MOBILE_BOTTOM_NAV_PROFILE_IDS]
    .filter((id) => {
      const entry = findNavItem(id)
      return entry && entry.badgeKey === 'nav.badge.comingSoon'
    })
)

const MobileBottomNav = ({
  activeId,
  onHome,
  onSearch,
  onPageChange,
  onOpenMissionControl,
  missionControlOpen,
  /* Legacy individual handlers (kept for backward compat, onPageChange preferred) */
  onDiscover,
  onFavorites,
  onMarkets,
  onResearchZone,
  onAIScreener,
  onGMDashboard,
  onROICalculator,
  onHeatmaps,
  onBubbles,
  onFearGreed,
}) => {
  const { t } = useTranslation()
  const [expandedMenu, setExpandedMenu] = useState(null)
  const navRef = useRef(null)
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isShowcaseEmbed = detectShowcaseEmbed()
  const isItemLocked = useCallback((pageId) => (
    COMING_SOON_IDS.has(pageId) || (isShowcaseEmbed && !SHOWCASE_ALLOWED_IDS.has(pageId))
  ), [isShowcaseEmbed])
  // The center magnifying-glass routes to /search-engine, which is
  // NOT in the showcase allow-list. Lock it in iframe mode for parity
  // with the desktop sidebar (where the search trigger is also dimmed).
  const searchLocked = isShowcaseEmbed

  // Close dropdown on escape key
  useEffect(() => {
    if (!expandedMenu) return
    const handleKey = (e) => {
      if (e.key === 'Escape') setExpandedMenu(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [expandedMenu])

  // Navigate to a page via onPageChange, with fallback to legacy handlers.
  // Locked items emit the same showcase-lock event the desktop sidebar
  // uses so any toast/paywall listener can react.
  const navigateToPage = useCallback((pageId) => {
    if (isItemLocked(pageId)) {
      const reason = COMING_SOON_IDS.has(pageId) ? 'coming-soon' : 'showcase'
      fireShowcaseLockEvent(pageId, 'bottom-nav-dropdown', reason)
      return
    }
    if (onPageChange) {
      onPageChange(pageId)
    }
    setExpandedMenu(null)
  }, [onPageChange, isItemLocked])

  // Center search button handler
  const handleSearch = useCallback(() => {
    if (searchLocked) {
      fireShowcaseLockEvent('search-engine', 'bottom-nav-center')
      return
    }
    if (onSearch) {
      onSearch()
    } else {
      // Fallback: simulate click on the header search input
      const searchInput = document.querySelector('.header-search-input, .whisper-search-input, [data-search-trigger]')
      if (searchInput) searchInput.click()
    }
    setExpandedMenu(null)
  }, [onSearch, searchLocked])

  const toggleDropdown = useCallback((menuId) => {
    setExpandedMenu(prev => prev === menuId ? null : menuId)
  }, [])

  // Resolve which tab group is active based on current activeId
  const innerRef = useRef(null)

  const isHomeActive = activeId === 'home' || activeId === 'research-platform'
  // Slots 2 and 4 were dropdown groups. Mission Control now lists every page in
  // the product, so a second, smaller launcher on the bar was duplicate chrome
  // that also cost two of the five best tap targets on the screen. They are
  // destinations now (founder: "the 2nd and 4th make no sense since we have
  // mission control ... research zone and watchlist perhaps").
  const isResearchActive = activeId === 'research-zone'
  const isWatchlistActive = activeId === 'watchlists'

  // The light never rests on nothing: when the route matches no slot it stays
  // where it last landed rather than snapping home behind the user's back.
  const lastSlotRef = useRef(0)
  // An OPEN dropdown owns the light even when the route has not changed — the
  // light marks what you are looking at, and a menu you just opened is that.
  const activeSlot = missionControlOpen ? 4
    : isWatchlistActive ? 3
      : isResearchActive ? 1
        : isHomeActive ? 0
          : lastSlotRef.current
  lastSlotRef.current = activeSlot

  const handleSlotPick = useCallback((i) => {
    if (i === 0) { onHome?.(); setExpandedMenu(null) }
    else if (i === 1) navigateToPage('research-zone')
    else if (i === 2) handleSearch()
    else if (i === 3) navigateToPage('watchlists')
    else if (i === 4) { setExpandedMenu(null); onOpenMissionControl?.() }
  }, [onHome, navigateToPage, handleSearch, onOpenMissionControl])

  const { light: tabLight, scrubHandlers } = useTabLight({
    hostRef: innerRef,
    active: activeSlot,
    accents: SLOT_ACCENTS,
    onPick: handleSlotPick,
  })

  // Determine which dropdown is expanded and build localized items on demand.
  const dropdownItems = expandedMenu === 'markets'
    ? buildDropdownItems(MOBILE_BOTTOM_NAV_MARKETS_IDS, t)
    : expandedMenu === 'profile'
    ? buildDropdownItems(MOBILE_BOTTOM_NAV_PROFILE_IDS, t)
    : null

  // Position index for dropdown (0-4, maps to tab position for alignment)
  const dropdownIndex = expandedMenu === 'markets' ? 1
    : expandedMenu === 'profile' ? 4
    : -1

  const dropdownPortal = dropdownItems ? createPortal(
    <div className={`mobile-bottom-nav-portal${dayMode ? ' app-day-mode' : ''}`}>
      <div
        className="mobile-bottom-nav-backdrop"
        onClick={() => setExpandedMenu(null)}
      />
      <div
        className={`mobile-bottom-nav-dropdown ${dropdownItems.length > 5 ? 'scrollable' : ''}`}
        style={{ '--dropdown-x': `${(dropdownIndex + 0.5) * 20}%` }}
      >
        <div className="mobile-bottom-nav-dropdown-inner">
          {dropdownItems.map((item) => {
            const locked = isItemLocked(item.id)
            const isComingSoon = item.isComingSoon
            return (
              <button
                key={item.id}
                type="button"
                className={`mobile-bottom-nav-dropdown-item ${activeId === item.id ? 'active' : ''}${locked ? ' is-locked' : ''}`}
                onClick={() => navigateToPage(item.id)}
                onPointerDown={() => { if (!locked) prefetchRoute(item.id) }}
                aria-disabled={locked || undefined}
                title={locked ? (isComingSoon ? t('nav.badge.comingSoon', 'Coming Soon') : t('header.betaUnavailable', 'Available in Beta')) : undefined}
                style={{ touchAction: 'manipulation' }}
              >
                <span className="mobile-bottom-nav-dropdown-icon">
                  {item.icon}
                </span>
                <span className="mobile-bottom-nav-dropdown-label">
                  {item.label}
                </span>
                {locked && !isComingSoon ? (
                  <span className="mobile-bottom-nav-dropdown-beta" aria-label={t('header.betaUnavailable', 'Available in Beta')}>
                    {LockMiniIcon}
                    <span>{t('nav.badge.beta', 'Beta')}</span>
                  </span>
                ) : item.badge ? (
                  <span className={`mobile-bottom-nav-dropdown-badge ${isComingSoon ? 'mbn-badge-coming-soon' : ''}`}>
                    {item.badge}
                  </span>
                ) : activeId === item.id ? (
                  <span className="mobile-bottom-nav-dropdown-check">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <nav
      className="mobile-bottom-nav"
      aria-label={t('nav.mainNavigationAria', 'Main navigation')}
      ref={navRef}
      data-embed={isShowcaseEmbed ? 'showcase' : undefined}
    >
      {dropdownPortal}

      <div className="mobile-bottom-nav-inner" ref={innerRef} {...scrubHandlers}>
        <TabLight light={tabLight} />

        {/* Tab 1: Welcome (direct nav) */}
        <button
          type="button"
          className={`mobile-bottom-nav-item ${isHomeActive ? 'active' : ''}`}
          data-mbn-slot="0"
          onClick={() => { onHome?.(); setExpandedMenu(null) }}
          aria-label={t('nav.researchPlatform', 'Welcome')}
          aria-current={isHomeActive ? 'page' : undefined}
          style={{ touchAction: 'manipulation' }}
        >
          <span className="mobile-bottom-nav-icon" aria-hidden="true">
            {isHomeActive ? icons.homeFilled : icons.home}
          </span>
          <span className="mobile-bottom-nav-label">{t('nav.researchPlatform', 'Welcome')}</span>
        </button>

        {/* Tab 2: Research Zone (direct nav) */}
        <button
          type="button"
          className={`mobile-bottom-nav-item ${isResearchActive ? 'active' : ''}`}
          data-mbn-slot="1"
          onClick={() => { setExpandedMenu(null); navigateToPage('research-zone') }}
          onPointerDown={() => prefetchRoute('research-zone')}
          aria-label={t('nav.researchZone', 'Research Zone')}
          aria-current={isResearchActive ? 'page' : undefined}
          style={{ touchAction: 'manipulation' }}
        >
          <span className="mobile-bottom-nav-icon" aria-hidden="true">
            {icons.researchZoneTab}
          </span>
          <span className="mobile-bottom-nav-label">{t('nav.researchZone', 'Research')}</span>
        </button>

        {/* Tab 3: Search (CENTRE). Founder, 08-03: "make it the middle one,
            mission control on right." */}
        <button
          type="button"
          className={`mobile-bottom-nav-center-btn${searchLocked ? ' is-locked' : ''}`}
          data-mbn-slot="2"
          onClick={handleSearch}
          aria-label={searchLocked ? t('common.searchInBeta', 'Search (available in Beta)') : t('common.search', 'Search')}
          aria-disabled={searchLocked || undefined}
          title={searchLocked ? 'Available in Beta' : undefined}
          style={{ touchAction: 'manipulation' }}
        >
          {icons.search}
          {searchLocked && (
            <span className="mobile-bottom-nav-center-lock" aria-hidden="true">
              {LockMiniIcon}
            </span>
          )}
        </button>

        {/* Tab 4: Watchlists (direct nav) */}
        <button
          type="button"
          className={`mobile-bottom-nav-item ${isWatchlistActive ? 'active' : ''}`}
          data-mbn-slot="3"
          onClick={() => { setExpandedMenu(null); navigateToPage('watchlists') }}
          onPointerDown={() => prefetchRoute('watchlists')}
          aria-label={t('nav.watchlists', 'Watchlists')}
          aria-current={isWatchlistActive ? 'page' : undefined}
          style={{ touchAction: 'manipulation' }}
        >
          <span className="mobile-bottom-nav-icon" aria-hidden="true">
            {icons.watchlistTab}
          </span>
          <span className="mobile-bottom-nav-label">{t('nav.watchlists', 'Watchlist')}</span>
        </button>

        {/* Tab 5: Mission Control — the full-app launcher, parked on the right
            edge where the thumb lands (founder: "mission control on right"). */}
        <button
          type="button"
          className={`mobile-bottom-nav-item ${missionControlOpen ? 'active expanded' : ''}`}
          data-mbn-slot="4"
          onClick={() => { setExpandedMenu(null); onOpenMissionControl?.() }}
          aria-label={t('mobileBottomNav.missionControl', 'Mission Control')}
          aria-expanded={!!missionControlOpen}
          aria-haspopup="dialog"
          style={{ touchAction: 'manipulation' }}
        >
          <span className="mobile-bottom-nav-icon" aria-hidden="true">
            {missionControlOpen ? icons.missionFilled : icons.mission}
          </span>
          <span className="mobile-bottom-nav-label">{t('mobileBottomNav.missionControl', 'Mission Control')}</span>
        </button>

      </div>
    </nav>
  )
}

// React.memo: shell chrome that re-renders on every AppShell render (toast /
// notification poll / 60s market tick) unless memoized. Holds now that AppShell
// passes stable (useCallback) handlers for onHome / onSearch / onPageChange and
// a primitive activeId.
export default memo(MobileBottomNav)
