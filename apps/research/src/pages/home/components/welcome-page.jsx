/**
 * WelcomePage Component - Token Discovery Hub
 * Professional Silicon Valley / Apple-inspired design
 * Powered by Codex API
 */
import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import { track, Events, setUserProps } from '@/services/analytics'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'

import { useNavigate } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import usePullToRefresh from '@/hooks/usePullToRefresh'
import { useTokenSearch } from '@/hooks/useCodexData'
import { IS_SHOWCASE_EMBED } from '@/lib/embed-mode'
import { MAJOR_SYMBOLS, MAJOR_TOKEN_INFO, SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getCgSearchHits, fetchCgMarketsByIds } from '@/services/cgSearchService'
import { buildMajorMatches, mergeTokenSearchResults } from '@/lib/search-merge'
import useWatchlistPrices from '@/hooks/useWatchlistPrices'
// Stock market hooks and data
import { useStockSearch } from '@/hooks/useStockData'
import { STOCK_SECTORS, getStockLogo } from '@/constants/stockData'
// Tab panels are lazy-loaded — each is hundreds-to-thousands of lines and
// only one is mounted at a time, so eagerly importing all of them blew up
// the landing-page chunk and slowed TTI.
const NewsTabPanel = lazy(() => import('./news-tab-panel'))
import TokenTicker from '@/components/token-ticker'
import ProductTour from './product-tour'
import spectreIcons from '@/icons/spectreIcons'
import { CinemaWelcomeWrapper } from '@/components/cinema'
// TokenStorybook is 1195 LOC and only renders inside the Brief tab story modal.
// Lazy so the desktop landing page bundle drops ~30KB pre-gzip.
const TokenStorybook = lazy(() => import('@/components/token-storybook'))
const ShareXModal = lazy(() => import('@/components/share-x-modal'))
import { TOP_COINS, TOKEN_LOGOS, AI_MODEL_ELO_TRENDS, MAX_PLAUSIBLE_CHANGE_PCT } from './welcome-page-constants'
const AiMarketPanel = lazy(() => import('./ai-market-panel'))
import useNewsData from './use-news-data'
import useXPostsData from './use-x-posts-data'
import useLiquidationHeatmap from './use-liquidation-heatmap'
import useHeatmapData from './use-heatmap-data'
import { icons, marketAiTabIcons, categoryIcons } from './welcome-page-icons'
import ChartPanel from './chart-panel'
import TokenCardPopup from './token-card-popup'
import { CompareBar, CompareModal } from './compare-bar-modal'
// DiscoverySection is 2284 LOC of off-viewport desktop sidebar content.
// Lazy so the cold landing bundle drops ~60KB pre-gzip + ~150ms parse.
const DiscoverySection = lazy(() => import('./discovery-section'))
import BriefTabContent from './brief-tab-content'
import EtfFlowsView from '@/components/etf/etf-flows-view'
const HeatmapTabPanel = lazy(() => import('./heatmap-tab-panel'))
const SectorsTabPanel = lazy(() => import('./sectors-tab-panel'))
const WalletsTabPanel = lazy(() => import('./wallets-tab-panel'))
const OthersTabPanel = lazy(() => import('./others-tab-panel'))
const PodcastsTabPanel = lazy(() => import('./podcasts-tab-panel'))
// Real liquidation heatmap — same component as /liquidation-heatmap and the
// Traders Corner Liq Map. Replaces the Coming Soon placeholder on this tab.
const LiqHeatmapPanel = lazy(() => import('@/components/liq-heatmap-panel'))
const EarningsTabPanel = lazy(() => import('./cc-earnings-panel'))
const MindshareTabPanel = lazy(() => import('./mindshare-tab-panel'))
const CalendarMiniPanel = lazy(() => import('./calendar-mini-panel'))
// HeatmapCommandPanel only renders when marketAiTab === 'heatmaps' (a tab
// user must explicitly click). Lazy so the cold landing bundle doesn't
// drag in its canvas/treemap code. Parent <Suspense> at L1294 / L1749
// covers it; no extra boundary needed.
const HeatmapCommandPanel = lazy(() => import('./heatmap-command-panel'))
import InlineHorizontalBar from './inline-horizontal-bar'
// DominanceChart is a click-to-open modal (showDominanceChart state). Lazy
// so its chart code isn't parsed on first paint. Wrapped in Suspense at
// the render site (modal sits outside the page-level Suspense boundary).
const DominanceChart = lazy(() => import('./DominanceChart'))
import InlineWatchlistPanel from './inline-watchlist-panel'
import NewsDetailPanel from './news-detail-panel'
// Heavy modal/overlay surfaces — lazy + gated so they don't pull
// their transitive deps into the landing-page bundle.
const CCFullViewOverlay = lazy(() => import('./cc-fullview-overlay'))
import './welcome-page.css'
import './welcome-page-responsive.css'
import './horizontal-bar.css'
import './brief-tab.css'
import './legacy-ai-market.css'
import './tab-panels.css'
import './welcome-page.perf.css'
import '@/styles/home-polish.css'

// Mode-specific CSS is dynamically imported — gated on user state so the
// common dark-mode + desktop path doesn't parse ~400KB of unused styles.
// Once a chunk loads, the browser caches it; toggling the mode off later
// is harmless (rules just don't match without the active class).
const loadDayModeCss = () => import('./welcome-page.day-mode.css')
const loadCinemaModeCss = () => import('./welcome-page.cinema-mode.css')
const loadMobileCss = () => import('./welcome-page.mobile.css')

// Module-init: read persisted settings synchronously so the right CSS lands
// in the first paint, not after a FOUC on next tick. Zustand store key is
// 'spectre-settings'. Defaults (dark, terminal display, desktop) load nothing
// extra. Errors (private mode, localStorage disabled) silently fall through.
;(() => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('spectre-settings') : null
    const state = raw ? (JSON.parse(raw)?.state || {}) : {}
    if (state.dayMode) loadDayModeCss()
    if (state.appDisplayMode === 'cinema') loadCinemaModeCss()
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)').matches) {
      loadMobileCss()
    }
    // Pre-warm the day-mode chunk on idle even when booting dark: the toggle
    // flips the .day-mode class immediately, and if the lazy CSS is still in
    // flight the tree paints day-classed with dark styles — the black/gray
    // switch glitch. Idle load keeps boot lean but makes the toggle atomic
    // (import() dedupes, so this is a no-op when day mode already loaded it).
    if (!state.dayMode && typeof window !== 'undefined') {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500))
      idle(() => { loadDayModeCss() })
    }
  } catch (_) { /* defaults are dark + desktop; nothing to do */ }
})()

// ── Mobile components ──
import MobileMarketPulse from './mobile-market-pulse'
import MobileQuickStats from './mobile-quick-stats'
import MobileWatchlistStrip from './mobile-watchlist-strip'
import MobileContentTabs from './mobile-content-tabs'
import PullRefreshMark from '@/components/pull-refresh-mark'
import MobileDiscoverySection from './mobile-discovery-section'

import MobileWeatherClock from './mobile-weather-clock'
import MobileGreeting from './mobile-greeting'
import ProfileEditModal from '@/components/profile-edit-modal'
import { useCopyToast } from '@/contexts/CopyToastContext'
import useSettingsStore from '@/store/useSettingsStore'

// ── Extracted custom hooks ──
import useMarketPrices from './use-market-prices'
import useTopSectionData from './use-top-section-data'
import useWelcomeInteractions from './use-welcome-interactions'
import useMarketIntelligence from './use-market-intelligence'

const SHOWCASE_ALLOWED_CC_TABS = new Set(['brief', 'analysis', 'news', 'posts', 'heatmaps'])
// Command Center tabs that are crypto-only (derivatives / on-chain / crypto-
// social) and have no stock equivalent — hidden in Stocks mode.
const STOCKS_HIDDEN_CC_TABS_SET = new Set(['posts', 'liquidation', 'mindshare', 'flows', 'wallets'])

// Defense-in-depth: filter out synthetic/dust tokens that occasionally leak from
// the trending screener. Strips address-suffixed dust like `IONX_0X5F70`,
// numeric-suffix dust, and obviously nonsensical rows. NOTE: we intentionally
// do NOT cap pct_change here — DEX pumpers with +500%/+1000% are the entire
// point of on-chain trending and were previously being filtered out, leaving
// just 1-2 stragglers in the ticker.
function isDustToken(t) {
  if (!t) return true
  const sym = String(t.symbol || t.asset || '').toUpperCase()
  if (!sym) return true
  if (/^[A-Z0-9]+_0[Xx][A-F0-9]+$/.test(sym)) return true   // IONX_0X5F70 pattern
  if (/^[A-Z0-9]+_[0-9]{4,}$/.test(sym)) return true        // numeric suffix dust
  const price = Number(t.price ?? t.priceUSD ?? 0)
  if (!Number.isFinite(price) || price <= 0) return true     // no price = unrenderable
  // Wash / synthetic volume (same rules as the On-Chain table's
  // isDustOnchainRow): bots cycling a thin pool produce volume that dwarfs
  // liquidity, or a large "mcap" fabricated on dust liquidity. Only fires when
  // liquidity is known.
  const mcap = Number(t.mcap ?? t.market_cap ?? 0)
  if (Number.isFinite(mcap) && mcap > 1e14) return true      // INT64-overflow sentinel
  // Same class as the sentinel above, on the other axis: a 24h change past
  // MAX_PLAUSIBLE_CHANGE_PCT means the provider divided by a ~0 price from 24h
  // ago. An absent change is NOT dust - only an implausible one is.
  const chg = Number(t.change ?? t.change24 ?? t.change24h ?? t.priceChange24 ?? NaN)
  if (Number.isFinite(chg) && Math.abs(chg) > MAX_PLAUSIBLE_CHANGE_PCT) return true
  const vol = Number(t.volume ?? t.volume24h ?? t.volume24 ?? 0)
  const liq = Number(t.liquidity ?? 0)
  if (Number.isFinite(liq) && liq > 0) {
    if (Number.isFinite(vol) && vol > 0 && vol / liq > 300) return true
    if (Number.isFinite(mcap) && mcap > 20_000_000 && mcap / liq > 6000) return true
  }
  return false
}

// Custom glassmorphic dropdown for the ticker's tier selector. Replaces the
// native <select> (which renders an unstyled OS popup at top-left of viewport).
// When the parent tab is "topcoins" (default), Sub 500M / Sub 50M are hidden —
// those tiers only make sense within the on-chain context.
const TickerTierDropdown = ({ value, onChange, parentTab }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  // Tiers are client-side slices of the single honest Codex on-chain feed
  // (#1148 killed the per-tier CG feeds - they faked liquidity + windows).
  // 'social' had no client-side equivalent on that feed, so it's gone.
  const ALL_TIERS = [
    { id: 'majors', label: 'Top' },
    { id: 'sub500m', label: 'Sub 500M' },
    { id: 'sub50m', label: 'Sub 50M' },
    { id: 'onchain', label: 'On-chain' },
  ]
  // On the Top Coins tab, hide Sub 500M / Sub 50M — those are on-chain sub-tiers.
  const tiers = parentTab === 'topcoins'
    ? ALL_TIERS.filter(t => t.id !== 'sub500m' && t.id !== 'sub50m')
    : ALL_TIERS
  const current = tiers.find(t => t.id === value) || ALL_TIERS.find(t => t.id === value) || tiers[0]

  // Recompute menu position whenever it opens or the viewport changes. The menu
  // is rendered in a portal so the .token-ticker {overflow:hidden} marquee
  // container can't clip it — that was the original bug where the dropdown
  // appeared to do nothing because the menu was rendered offscreen-clipped.
  useEffect(() => {
    if (!open) return undefined
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      setMenuPos({ top: r.bottom + 8, left: r.left + r.width / 2 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      const inTrigger = wrapRef.current && wrapRef.current.contains(e.target)
      const inMenu = menuRef.current && menuRef.current.contains(e.target)
      if (!inTrigger && !inMenu) setOpen(false)
    }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="ticker-tier-dropdown" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className={`ticker-tier-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
      >
        <span>{current?.label || 'Top'}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 200ms cubic-bezier(0.16,1,0.3,1)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="ticker-tier-menu ticker-tier-menu--portal"
          role="listbox"
          aria-label={t('homePage.welcomePage.tickertierdropdown.ariaTrendingTier', "Trending tier")}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, transform: 'translateX(-50%)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {tiers.map(tier => (
            <button
              key={tier.id}
              type="button"
              role="option"
              aria-selected={value === tier.id}
              className={`ticker-tier-menu-item${value === tier.id ? ' is-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onChange(tier.id); setOpen(false) }}
            >
              <span>{tier.label}</span>
              {value === tier.id && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Landing-page section chrome (desktop) ───────────────────────────────────
// Every major desktop section carries a quiet chevron in its header area; when
// a section is closed a slim glass bar takes its place. Collapsed state lives in
// the settings store (`welcomeSectionsCollapsed`), so it persists per user and
// rides the account sync. Section ids are stable strings — renaming one resets
// that section for everyone, so don't.
const WELCOME_SECTIONS = {
  marketBar: 'marketBar',
  commandCenter: 'commandCenter',
  trending: 'trending',
  topCoins: 'topCoins',
  // Mobile ids are deliberately SEPARATE from the desktop ones (same store map,
  // additive keys, no migration): the phone and the desktop are different
  // layouts, and a user who strips their phone down to Watchlist-only must not
  // find their desktop stripped down too.
  // NOTE: `mHighlights` (the Trending/Gainers/Losers carousel) was retired from
  // the mobile landing page on 2026-08-01 — the same rows are one tap away in
  // Discover, and a second carousel above Market Stats read as filler. The id is
  // gone on purpose: a stale `mHighlights: true` left in a user's persisted
  // `welcomeSectionsCollapsed` map is inert (the map is only ever READ by id).
  // Its component file is gone too: nothing on desktop imported it either, so
  // the note that it "stays" was already untrue when it was written.
  mQuickStats: 'mQuickStats',
  mWatchlist: 'mWatchlist',
  mCommandCenter: 'mCommandCenter',
  // RETIRED 2026-08-04: `mCommandCenterPanel` was a SECOND collapse nested
  // inside mCommandCenter, folding the tab panel body while the tab row stayed
  // visible. Two disclosure controls on one section is one too many — see the
  // note at the MobileContentTabs mount. Like `mHighlights` above, a stale
  // `mCommandCenterPanel: true` left in a user's persisted map is inert: the
  // map is only ever READ by id and nothing asks for this one any more.
  mDiscovery: 'mDiscovery',
}

const WsecChevron = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

const WelcomeSectionToggle = ({ open, label, onToggle, className = '' }) => (
  <button
    type="button"
    className={`wsec-toggle${open ? ' wsec-toggle--open' : ''}${className ? ` ${className}` : ''}`}
    onClick={onToggle}
    aria-expanded={open}
    aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
    data-tooltip={open ? `Collapse ${label}` : `Expand ${label}`}
  >
    <WsecChevron />
  </button>
)

// Chevron LEADS on the reopen bar (disclosure-row language, and the trailing
// edge is where the fixed watchlist FAB lives — a right-aligned chevron there
// disappears under it).
const WelcomeSectionBar = ({ label, hint, onOpen }) => (
  <button type="button" className="wsec-bar" onClick={onOpen} aria-label={`Expand ${label}`}>
    <span className="wsec-bar-chevron" aria-hidden="true"><WsecChevron /></span>
    <span className="wsec-bar-label">{label}</span>
    {hint ? <span className="wsec-bar-hint">{hint}</span> : null}
  </button>
)

const WsecPinIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 17l-6.5 4 2-7.5L2 9h7z" />
  </svg>
)

const WsecChevronRight = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
)

// ── Mobile section chrome ──────────────────────────────────────────────────
// Mobile keeps ONE persistent glass rail per section instead of the desktop
// swap (inline chevron while open -> reopen bar while closed). Two reasons:
// on touch the control must not move out from under the finger when you
// collapse, and these mobile children are bare component drops with no shared
// header — the rail IS the section header, so the label lives in exactly one
// place. The children that ship their own title (mht/mws/mct) have it
// suppressed under `.wsecm` so nothing is said twice.
//
// The rail is the HEADER of one continuous glass card: `.wsecm` carries the
// material, the rail row sits on top of it and the collapsing content sits
// under the same border, so an open section reads as one compartment instead
// of a bar floating above loose content. `actions` re-homes the suppressed
// child's header button (Watchlist "See All", Command Center pin) into the
// rail's right side — hiding the child header without adopting its action was
// what left an orphaned button over a dead gap.
const MobileWelcomeSection = ({ open, label, hint, onToggle, actions = null, className = '', children }) => (
  <div className={`wsec wsecm${open ? ' wsecm--open' : ' wsec--closed'}${className ? ` ${className}` : ''}`}>
    <div className="wsecm-rail">
      <button
        type="button"
        className={`wsec-bar wsecm-bar${open ? ' wsecm-bar--open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
      >
        <span className="wsec-bar-chevron wsecm-bar-chevron" aria-hidden="true"><WsecChevron /></span>
        <span className="wsec-bar-label">{label}</span>
        {!open && hint ? <span className="wsec-bar-hint">{hint}</span> : null}
      </button>
      {open && actions ? <div className="wsecm-actions">{actions}</div> : null}
    </div>
    <div className="wsec-collapse">
      <div className="wsec-collapse-inner">{children}</div>
    </div>
  </div>
)

const WelcomePage = ({ cinemaMode = false, profile: profileProp, onProfileChange, dayMode = false, marketMode = 'crypto', selectToken, onOpenResearchZone, onOpenAIScreener, discoverOnly = false, watchlist = [], watchlists = [], activeWatchlistId, onSwitchWatchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, togglePinWatchlist, reorderWatchlist, onPageChange, setAssistantActions, setAssistantContext, pendingChartToken, setPendingChartToken, pendingCommandCenterTab, setPendingCommandCenterTab }) => {
  const { t: tr } = useTranslation()

  const isStocks = marketMode === 'stocks'
  const navigate = useNavigate()
  const showMoodWall = useSettingsStore((s) => s.showMoodWall)
  const moodWallBrightness = useSettingsStore((s) => s.moodWallBrightness)
  const toggleDayMode = useSettingsStore((s) => s.toggleDayMode)
  const pinnedCCTab = useSettingsStore((s) => s.pinnedCCTab)
  const setPinnedCCTab = useSettingsStore((s) => s.setPinnedCCTab)
  const { t, i18n } = useTranslation()
  const { fmtPrice, fmtLarge, currencySymbol } = useCurrency()
  const isMobile = useIsMobile()

  // Support both shared profile (from App) and local fallback so name/logo always editable
  const [localProfile, setLocalProfile] = useState({ name: '', imageUrl: '' })
  const profile = profileProp && typeof profileProp === 'object' ? profileProp : localProfile
  // Always update parent when provided so header (top right) stays in sync with widget changes
  const updateProfile = (next) => {
    if (typeof onProfileChange === 'function') {
      onProfileChange({ name: next.name ?? '', imageUrl: next.imageUrl ?? '' })
    } else {
      setLocalProfile(prev => ({ ...prev, ...next }))
    }
  }

  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const { triggerCopyToast } = useCopyToast() || {}
  const [topCoinInfoOpen, setTopCoinInfoOpen] = useState(null)
  const topCoinInfoAnchorRef = useRef({ top: 0, left: 0 })
  const [tokens, setTokens] = useState([])
  // Watchlist (screener right sidebar): unified realtime prices
  const { watchlistWithLiveData } = useWatchlistPrices(watchlist)
  const [watchlistSort, setWatchlistSort] = useState('default')
  const [watchlistSortDropdown, setWatchlistSortDropdown] = useState(false)
  const [watchlistSearchQuery, setWatchlistSearchQuery] = useState('')
  // Landing-page section collapse. One persisted map in the settings store
  // replaces the raw-localStorage flags this page used to keep (see the v3
  // migration in useSettingsStore). Setters keep the useState signature so the
  // existing InlineHorizontalBar / InlineWatchlistPanel call sites are unchanged.
  const welcomeSectionsCollapsed = useSettingsStore((s) => s.welcomeSectionsCollapsed)
  const setWelcomeSectionCollapsed = useSettingsStore((s) => s.setWelcomeSectionCollapsed)
  const toggleWelcomeSection = useSettingsStore((s) => s.toggleWelcomeSection)
  const isSectionOpen = (id) => !welcomeSectionsCollapsed?.[id]
  const sectionSetter = (id, open) => (next) => {
    setWelcomeSectionCollapsed(id, !(typeof next === 'function' ? next(open) : next))
  }
  const welcomeOpen = isSectionOpen(WELCOME_SECTIONS.marketBar)
  const setWelcomeOpen = sectionSetter(WELCOME_SECTIONS.marketBar, welcomeOpen)
  const trendingOpen = isSectionOpen(WELCOME_SECTIONS.trending)
  const topCoinsOpen = isSectionOpen(WELCOME_SECTIONS.topCoins)
  // Scroll to top on mount - .app is the scroll container on mobile
  useEffect(() => {
    const scrollEl = document.querySelector('.app') || window
    if (scrollEl.scrollTo) scrollEl.scrollTo(0, 0)
    else scrollEl.scrollTop = 0
  }, [])

  // Showcase embed: tell the parent (the spectreai.io landing page) that the
  // demo actually booted and rendered. The website's iframe watchdog waits
  // for this ping; if it never arrives - e.g. a stale-chunk deploy mismatch
  // crashes the inner app into a blank box - the parent reloads the iframe to
  // pull the current build. Reaching this mount means the (lazy) home chunk
  // loaded without crashing, which is exactly the signal we want. Fire once
  // now and once shortly after, in case the parent listener attaches late.
  useEffect(() => {
    if (!IS_SHOWCASE_EMBED || typeof window === 'undefined') return
    const ping = () => { try { window.parent?.postMessage({ type: 'spectre-showcase-ready' }, '*') } catch (_) { /* cross-origin */ } }
    ping()
    const t = setTimeout(ping, 800)
    return () => clearTimeout(t)
  }, [])

  // Runtime CSS loaders: the module-init block above handles the FIRST paint
  // by reading persisted settings, but the user can toggle dayMode / cinema
  // mode after mount or resize from desktop -> mobile. Re-run the loaders so
  // the right stylesheet is in the page before the class flips.
  useEffect(() => { if (dayMode) loadDayModeCss() }, [dayMode])
  useEffect(() => { if (cinemaMode) loadCinemaModeCss() }, [cinemaMode])
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 768px)')
    const ensure = () => { if (mq.matches) loadMobileCss() }
    ensure()
    mq.addEventListener?.('change', ensure)
    return () => mq.removeEventListener?.('change', ensure)
  }, [])
  // Command Center + Watchlist collapse together as a single bottom-row unit
  // (the collapsed CC preview strip absorbs the watchlist tiles and the grid
  // drops from 3fr/1fr to a single full-width strip).
  const bottomRowOpen = isSectionOpen(WELCOME_SECTIONS.commandCenter)
  const setBottomRowOpen = sectionSetter(WELCOME_SECTIONS.commandCenter, bottomRowOpen)
  // Aliases — the two panels share state so toggling either toggles both.
  const watchlistOpen = bottomRowOpen
  const setWatchlistOpen = setBottomRowOpen
  const commandCenterOpen = bottomRowOpen
  const setCommandCenterOpen = setBottomRowOpen
  const watchlistSearchContainerRef = useRef(null)
  const watchlistSearchContainerRef2 = useRef(null)
  const { results: cryptoSearchResults, loading: cryptoSearchLoading } = useTokenSearch(!isStocks ? watchlistSearchQuery.trim() : '', 300)
  const { results: stockSearchResults, loading: stockSearchLoading } = useStockSearch(isStocks ? watchlistSearchQuery.trim() : '', 300)
  // Debounced query for the CG search/markets chain below. useTokenSearch /
  // useStockSearch already debounce internally (300ms), so we only need to
  // tame the two CG-only effects that previously fired 2 network requests
  // per keystroke (search -> markets). 300ms matches the other surfaces.
  const [debouncedWatchlistQuery, setDebouncedWatchlistQuery] = useState(watchlistSearchQuery)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedWatchlistQuery(watchlistSearchQuery), 300)
    return () => clearTimeout(id)
  }, [watchlistSearchQuery])
  // CG-first search: priority pipeline is CG /search + /coins/markets. Any
  // token CG knows (canonical PaLM AI, real NEURAL on ETH, etc.) lands above
  // Codex pool clones. Codex stays as the fallback.
  const [cgSearchHits, setCgSearchHits] = useState([])
  useEffect(() => {
    if (isStocks) { setCgSearchHits([]); return }
    const q = debouncedWatchlistQuery.trim()
    if (!q || q.length < 1) { setCgSearchHits([]); return }
    let cancelled = false
    // Shared cached service — dedupes with the header + watchlists surfaces.
    getCgSearchHits(q).then(hits => { if (!cancelled) setCgSearchHits(hits) })
    return () => { cancelled = true }
  }, [debouncedWatchlistQuery, isStocks])

  // Watchlist-search live prices for major matches.
  const [watchlistMajorMarket, setWatchlistMajorMarket] = useState({})
  useEffect(() => {
    if (isStocks) return
    const q = debouncedWatchlistQuery.trim().toLowerCase()
    if (!q || q.length < 1) return
    const matched = []
    const cgIds = []
    for (const sym of MAJOR_SYMBOLS) {
      const upper = sym.toUpperCase()
      const info = MAJOR_TOKEN_INFO[upper] || { symbol: upper, name: upper }
      if (upper.toLowerCase().includes(q) || (info.name || '').toLowerCase().includes(q)) {
        const cgId = SYMBOL_TO_COINGECKO_ID[upper]
        if (cgId) {
          matched.push(upper)
          cgIds.push(cgId)
        }
      }
    }
    if (cgIds.length === 0) return
    if (matched.every(s => watchlistMajorMarket[s])) return
    let cancelled = false
    // Shared cached markets fetcher (cg-proxy on Vercel with CG_API_KEY —
    // Hetzner /v1/prices was silently failing on this surface). Dedupes
    // with the header + watchlists surfaces.
    fetchCgMarketsByIds(cgIds)
      .then(byId => {
        if (cancelled || byId.size === 0) return
        const next = { ...watchlistMajorMarket }
        for (const row of byId.values()) {
          const sym = String(row?.symbol || '').toUpperCase()
          if (!sym) continue
          next[sym] = {
            price: Number(row.current_price) || 0,
            change: Number(row.price_change_percentage_24h) || 0,
            marketCap: Number(row.market_cap) || 0,
            volume: Number(row.total_volume) || 0,
            image: row.image || null,
          }
        }
        setWatchlistMajorMarket(next)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedWatchlistQuery, isStocks])

  const watchlistSearchResults = useMemo(() => {
    if (isStocks) {
      return stockSearchResults.map(r => ({
        symbol: r.symbol,
        name: r.name,
        logo: getStockLogo(r.symbol, r.sector),
        price: 0,
        change: 0,
        sector: r.sector,
        exchange: r.exchange,
        isStock: true,
      }))
    }

    const q = watchlistSearchQuery.trim().toLowerCase()
    if (!q) return []

    // Shared merge pipeline (lib/search-merge.js): dust filter, majors
    // first, CG-canonical prepends, trust-ranked live rows, same-asset
    // folding and the stale-CG demotion. Same ranking as the header modal.
    return mergeTokenSearchResults({
      query: watchlistSearchQuery.trim(),
      majorRows: buildMajorMatches(q, watchlistMajorMarket),
      cgHits: cgSearchHits,
      liveRows: cryptoSearchResults || [],
    })
  }, [isStocks, stockSearchResults, cryptoSearchResults, watchlistSearchQuery, watchlistMajorMarket, cgSearchHits])
  const watchlistSearchLoading = isStocks ? stockSearchLoading : cryptoSearchLoading
  const [loading, setLoading] = useState(true)

  // Dominance chart overlay
  const [showDominanceChart, setShowDominanceChart] = useState(false)

  const handleOpenProfileModal = useCallback(() => {
    setProfileModalOpen(true)
  }, [])

  const handleCloseProfileModal = useCallback(() => {
    setProfileModalOpen(false)
  }, [])

  const handleSaveProfile = useCallback(({ name: nextName, imageUrl: nextImage }) => {
    track(Events.PROFILE_UPDATED, { field: 'modal' })
    setUserProps({ '$name': nextName })
    updateProfile({ name: nextName, imageUrl: nextImage })
  }, [updateProfile])

  // Timeframes - Price change periods
  const timeframes = [
    { id: 'all', label: t('topSection.allTime') },
    { id: '1h', label: '1h' },
    { id: '24h', label: '24h' },
    { id: '1w', label: '1w' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
  ]

  // Tabs ON/OFF module (row above Discovery: On/Off toggle + Discover + token tabs)
  const [tabsOn, setTabsOn] = useState(() => {
    try { return JSON.parse(localStorage.getItem('spectre_tabs_on')) === true } catch { return false }
  })
  // Persist tabs state to localStorage
  useEffect(() => { try { localStorage.setItem('spectre_tabs_on', JSON.stringify(tabsOn)) } catch {} }, [tabsOn])

  // Category filter tabs (Top Coins: DeFi, AI, Meme, RWA, Gaming, Privacy, etc.)
  const CATEGORY_TABS = [
    { id: 'all', label: t('categoryFilters.all'), cgId: null, icon: categoryIcons.all },
    { id: 'defi', label: t('categoryFilters.defi'), cgId: 'decentralized-finance-defi', icon: categoryIcons.defi },
    { id: 'ai', label: t('categoryFilters.ai'), cgId: 'artificial-intelligence', icon: categoryIcons.ai },
    { id: 'meme', label: t('categoryFilters.meme'), cgId: 'meme-token', icon: categoryIcons.meme },
    { id: 'rwa', label: t('categoryFilters.rwa'), cgId: 'real-world-assets-rwa', icon: categoryIcons.rwa },
    { id: 'robinhood', label: t('categoryFilters.robinhood'), cgId: 'robinhood-ecosystem', icon: categoryIcons.robinhood },
    { id: 'gamefi', label: t('categoryFilters.gamefi'), cgId: 'gaming', icon: categoryIcons.gamefi },
    { id: 'infra', label: t('categoryFilters.infra'), cgId: 'infrastructure', icon: categoryIcons.infra },
    { id: 'solanaMeme', label: t('categoryFilters.solanaMeme'), cgId: 'solana-meme-coins', icon: categoryIcons.solanaMeme },
    { id: 'privacy', label: t('categoryFilters.privacy'), cgId: 'privacy-coins', icon: categoryIcons.privacy },
    { id: 'nft', label: t('categoryFilters.nft'), cgId: 'non-fungible-tokens-nft', icon: categoryIcons.nft },
    { id: 'lending', label: t('categoryFilters.lending'), cgId: 'lending-borrowing', icon: categoryIcons.lending },
  ]
  // Extended category set behind the "More" dropdown at the end of the rail.
  // Every cgId is a verified CoinGecko category slug; ids must also exist in
  // CATEGORY_CG_MAP (use-top-section-data.js) or the fetch falls back to 'all'.
  const MORE_CATEGORY_TABS = [
    { id: 'layer1', label: t('categoryFilters.layer1', 'Layer 1'), cgId: 'layer-1' },
    { id: 'layer2', label: t('categoryFilters.layer2', 'Layer 2'), cgId: 'layer-2' },
    { id: 'aiAgents', label: t('categoryFilters.aiAgents', 'AI Agents'), cgId: 'ai-agents' },
    { id: 'aiMeme', label: t('categoryFilters.aiMeme', 'AI Meme'), cgId: 'ai-meme-coins' },
    { id: 'depin', label: t('categoryFilters.depin', 'DePIN'), cgId: 'depin' },
    { id: 'dex', label: t('categoryFilters.dex', 'DEX'), cgId: 'decentralized-exchange' },
    { id: 'exchange', label: t('categoryFilters.exchange', 'Exchange Tokens'), cgId: 'exchange-based-tokens' },
    { id: 'stablecoins', label: t('categoryFilters.stablecoins', 'Stablecoins'), cgId: 'stablecoins' },
    { id: 'liquidStaking', label: t('categoryFilters.liquidStaking', 'Liquid Staking'), cgId: 'liquid-staking-tokens' },
    { id: 'restaking', label: t('categoryFilters.restaking', 'Restaking'), cgId: 'restaking' },
    { id: 'oracles', label: t('categoryFilters.oracles', 'Oracles'), cgId: 'oracle' },
    { id: 'zk', label: t('categoryFilters.zk', 'Zero Knowledge'), cgId: 'zero-knowledge-zk' },
    { id: 'storage', label: t('categoryFilters.storage', 'Storage'), cgId: 'storage' },
    { id: 'payments', label: t('categoryFilters.payments', 'Payments'), cgId: 'payment-solutions' },
    { id: 'socialfi', label: t('categoryFilters.socialfi', 'SocialFi'), cgId: 'socialfi' },
    { id: 'metaverse', label: t('categoryFilters.metaverse', 'Metaverse'), cgId: 'metaverse' },
    { id: 'bitcoinEco', label: t('categoryFilters.bitcoinEco', 'Bitcoin Ecosystem'), cgId: 'bitcoin-ecosystem' },
    { id: 'dogMeme', label: t('categoryFilters.dogMeme', 'Dog Meme'), cgId: 'dog-themed-coins' },
    { id: 'catMeme', label: t('categoryFilters.catMeme', 'Cat Meme'), cgId: 'cat-themed-coins' },
    { id: 'baseMeme', label: t('categoryFilters.baseMeme', 'Base Meme'), cgId: 'base-meme-coins' },
    { id: 'politifi', label: t('categoryFilters.politifi', 'PolitiFi'), cgId: 'politifi' },
    { id: 'predictionMarkets', label: t('categoryFilters.predictionMarkets', 'Prediction Markets'), cgId: 'prediction-markets' },
    { id: 'fanTokens', label: t('categoryFilters.fanTokens', 'Fan Tokens'), cgId: 'fan-token' },
    { id: 'gold', label: t('categoryFilters.gold', 'Tokenized Gold'), cgId: 'tokenized-gold' },
    { id: 'madeInUsa', label: t('categoryFilters.madeInUsa', 'Made in USA'), cgId: 'made-in-usa' },
    { id: 'gamblefi', label: t('categoryFilters.gamblefi', 'GambleFi'), cgId: 'gambling' },
  ]
  // Translated stock sectors (overrides imported STOCK_SECTORS labels)
  const TRANSLATED_STOCK_SECTORS = STOCK_SECTORS.map(s => ({
    ...s,
    label: t(`sectorFilters.${s.id === 'all' ? 'allSectors' : s.id === 'index' ? 'indexEtf' : s.id === 'realestate' ? 'realEstate' : s.id}`)
  }))
  const [categoryFilter, setCategoryFilter] = useState('all')
  // Top Coins chain filter (CG ecosystem categories) + range filters
  // ({ mcapMin/Max, fdvMin/Max, priceMin/Max, chgMin/Max, volMin/Max } or null)
  const [topCoinsChain, setTopCoinsChain] = useState('all')
  const [topCoinsRanges, setTopCoinsRanges] = useState(null)

  const [viewMode, setViewMode] = useState('list')
  const [timeframeFilter, setTimeframeFilter] = useState('all')
  const [tourActive, setTourActive] = useState(false)
  const [tourStep, setTourStep] = useState(0)

  // Top section tabs: Top Coins (table) | On-Chain | Prediction Markets
  const [topSectionTab, setTopSectionTab] = useState('topcoins') // 'topcoins' | 'onchain' | 'predictions' | 'social' | 'aiagents' | 'aimodels' | 'warroom'
  // When switching to stocks mode, ensure we're not on 'onchain' tab (stocks don't have on-chain data)
  useEffect(() => {
    if (isStocks && (topSectionTab === 'onchain' || topSectionTab === 'social' || topSectionTab === 'aiagents' || topSectionTab === 'aimodels' || topSectionTab === 'warroom')) setTopSectionTab('topcoins')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStocks]) // Only run when isStocks changes, not when topSectionTab changes

  const [cinemaStorybookToken, setCinemaStorybookToken] = useState(null)
  const [cinemaStorybookOpen, setCinemaStorybookOpen] = useState(false)
  const [discoveryShowWatchlist, setDiscoveryShowWatchlist] = useState(false)

  // Close watchlist search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      const inRef1 = watchlistSearchContainerRef.current && watchlistSearchContainerRef.current.contains(e.target)
      const inRef2 = watchlistSearchContainerRef2.current && watchlistSearchContainerRef2.current.contains(e.target)
      if (!inRef1 && !inRef2) {
        setWatchlistSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Market AI Analysis – UI state (pinned tab overrides default 'brief')
  const [marketAiTab, setMarketAiTab] = useState(pinnedCCTab || 'brief')
  // Liquidation tab's heatmap symbol — Binance pair form (BTCUSDT), separate
  // from the Command Center's CoinGecko-style ids.
  const [liqSymbol, setLiqSymbol] = useState('BTCUSDT')
  const [briefFullViewOpen, setBriefFullViewOpen] = useState(false)
  const [fullViewTab, setFullViewTab] = useState('brief')
  const [discoveryFullViewOpen, setDiscoveryFullViewOpen] = useState(false)
  const [newsXToggle, setNewsXToggle] = useState(false)
  const [newsDetail, setNewsDetail] = useState(null) // { type: 'news'|'tweet', data }
  // Clear news detail when leaving news tab
  const prevMarketAiTab = useRef(marketAiTab)
  useEffect(() => {
    if ((prevMarketAiTab.current === 'news' || prevMarketAiTab.current === 'posts') && marketAiTab !== 'news' && marketAiTab !== 'posts') setNewsDetail(null)
    prevMarketAiTab.current = marketAiTab
  }, [marketAiTab])
  const [tickerMode, setTickerMode] = useState('trending')
  const { newsItems, newsLoading } = useNewsData(marketAiTab, isStocks, tickerMode)
  const { xPosts, xPostsLoading, xPostsError, refetchXPosts } = useXPostsData(marketAiTab === 'posts' || (newsXToggle && tickerMode === 'news'))

  // Heatmap data (extracted hook)
  const { heatmapTokens, heatmapsBubblesToggle, setHeatmapsBubblesToggle } = useHeatmapData(marketAiTab === 'heatmaps')

  // Liquidation Heatmap (extracted hook)
  const {
    liqHeatmapData, liqTimeframe, setLiqTimeframe,
    liqFullscreen, setLiqFullscreen,
    liqTooltip, liqLoading, liqError: liqFetchError,
    liqCanvasRef, liqCanvasFullRef,
    liqContainerRef, liqContainerFullRef,
    handleLiqMouseMove, handleLiqMouseLeave,
    viewport: liqViewport, isPanning: liqIsPanning, dragMode: liqDragMode,
    panOffset: liqPanOffset, timeZoom: liqTimeZoom, priceZoom: liqPriceZoom,
    sensitivity: liqSensitivity, setSensitivity: setLiqSensitivity,
    handleChartPanStart: liqHandleChartPanStart,
    handleWheel: liqHandleWheel,
    handleDoubleClick: liqHandleDoubleClick,
    handleZoomIn: liqHandleZoomIn,
    handleZoomOut: liqHandleZoomOut,
    handleTouchStart: liqHandleTouchStart,
    handleTouchMove: liqHandleTouchMove,
    handleTouchEnd: liqHandleTouchEnd,
    handleMinimapMouseDown: liqHandleMinimapMouseDown,
    chartMode: liqChartMode, setChartMode: setLiqChartMode,
    candleBars: liqCandleBars,
  } = useLiquidationHeatmap(marketAiTab, fmtPrice)

  // Escape key to close Command Center full view
  useEffect(() => {
    if (!briefFullViewOpen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setBriefFullViewOpen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [briefFullViewOpen])

  // Escape key to close Discovery full view
  useEffect(() => {
    if (!discoveryFullViewOpen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setDiscoveryFullViewOpen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [discoveryFullViewOpen])

  const isShowcaseEmbed = useMemo(() => {
    if (typeof window === 'undefined') return false
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('embed') === 'showcase') return true
      if (window.self !== window.top) return true
    } catch {
      return true
    }
    return false
  }, [])

  // Tabs with no stock equivalent (crypto derivatives / on-chain / crypto-social)
  // are hidden in Stocks mode so every visible Command Center tab is relevant.
  const STOCKS_HIDDEN_CC_TABS = STOCKS_HIDDEN_CC_TABS_SET

  const marketAiTabs = useMemo(() => ([
    { id: 'brief', label: t('commandCenter.aiBrief') },
    { id: 'analysis', label: t('commandCenter.aiMarket') },
    // Stocks-only: upcoming earnings for the index-moving mega-caps.
    { id: 'earnings', label: t('commandCenter.earnings', 'Earnings'), stocksOnly: true },
    { id: 'news', label: t('commandCenter.news') },
    { id: 'posts', label: t('commandCenter.posts', 'Posts') },
    { id: 'heatmaps', label: t('commandCenter.heatmaps') },
    { id: 'liquidation', label: t('commandCenter.liquidation') },
    { id: 'sector', label: t('commandCenter.sectors') },
    { id: 'mindshare', label: t('commandCenter.mindshare') },
    { id: 'calendar', label: t('commandCenter.calendar') },
    { id: 'flows', label: t('commandCenter.flows') },
    { id: 'wallets', label: t('commandCenter.wallets') },
    { id: 'others', label: t('commandCenter.others', 'Others') },
    { id: 'podcasts', label: t('commandCenter.podcasts', 'Podcasts') },
  ]
    .filter((tab) => !(isStocks && STOCKS_HIDDEN_CC_TABS.has(tab.id)))
    .filter((tab) => !(tab.stocksOnly && !isStocks))
    .map((tab) => ({
      ...tab,
      locked: isShowcaseEmbed && !SHOWCASE_ALLOWED_CC_TABS.has(tab.id),
    }))), [t, isShowcaseEmbed, isStocks, STOCKS_HIDDEN_CC_TABS])

  // If the active tab gets hidden by the Stocks switch, fall back to AI Brief.
  // Covers both directions: crypto-hidden tabs when switching to stocks, and the
  // stocks-only Earnings tab when switching back to crypto.
  useEffect(() => {
    if (isStocks && STOCKS_HIDDEN_CC_TABS.has(marketAiTab)) {
      setMarketAiTab('brief')
    } else if (!isStocks && marketAiTab === 'earnings') {
      setMarketAiTab('brief')
    }
  }, [isStocks, marketAiTab, STOCKS_HIDDEN_CC_TABS])

  const marketAiTimeframes = [
    { id: '1h', label: '1H' },
    { id: '24h', label: '24H' },
    { id: '7d', label: '7D' },
  ]

  // ═══════════════════════════════════════════════════════════════════════════════
  // HOOK 1: Market Prices (no dependencies on other hooks)
  // ═══════════════════════════════════════════════════════════════════════════════
  const prices = useMarketPrices({ isStocks, watchlist })
  const {
    topCoinPrices, binancePrices,
    stockPrices,
    marketIndices,
    welcomeAssets,
    WELCOME_COINS,
  } = prices

  // ═══════════════════════════════════════════════════════════════════════════════
  // HOOK 2: Market Intelligence (depends on prices)
  // ═══════════════════════════════════════════════════════════════════════════════
  const briefTabActive = marketAiTab === 'brief' || marketAiTab === 'analysis'
  const intelligence = useMarketIntelligence({
    topCoinPrices,
    stockPrices,
    marketIndices,
    isStocks,
    fmtPrice,
    t,
    i18n,
    profile,
    currencySymbol,
    briefTabActive,
    isMobile,
    marketAiTab,
  })

  // Stocks mode: realtime market headlines (Google News, English) for the AI
  // Market "Context" rail — leads with the day's big events (e.g. the SpaceX
  // IPO) so the analysis reads against real catalysts, not boilerplate.
  const [stockContextNews, setStockContextNews] = useState([])
  useEffect(() => {
    if (!isStocks || !briefTabActive) return undefined
    let cancelled = false
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      fetch('/api/company-news?q=stock%20market')
        .then((r) => (r.ok ? r.json() : []))
        .then((arr) => {
          if (cancelled || !Array.isArray(arr)) return
          setStockContextNews(
            arr.filter((n) => n.headline && !/symbol__|Stock Quote Price/i.test(n.headline)).slice(0, 6)
          )
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [isStocks, briefTabActive])

  const {
    intel,
    breakingArticle, breakingHeadlines, alphaFeed, liveActivity,
    fearGreed, liveVix, altSeason, marketDominance,
    stocksRiskOnOff, indexAllocation,
    usMarketStatus, eventState,
    marketStructureTrio, marketFlowSummary,
    marketAiTimeframe, setMarketAiTimeframe,
    macroAnalysisData,
    sentimentRgb, biasRgb,
    // Brief
    theBriefStatement, allBriefStatements, briefLabels, outlookIndex, briefIndex, briefFading,
    briefDisplay, terminalIsFullBrief, goToBrief,
    handleBriefTouchStart, handleBriefTouchEnd, briefPausedRef,
    getTerminalBriefInterval,
    // Share
    isBriefShareExporting,
    briefShareModalOpen, setBriefShareModalOpen,
    briefShareImageUrl, setBriefShareImageUrl,
    briefShareDescription,
    isWelcomeShareExporting,
    welcomeShareModalOpen, setWelcomeShareModalOpen,
    welcomeShareImageUrl, setWelcomeShareImageUrl,
    welcomeShareDescription,
    handleShareBrief, handleShareWelcome,
    // Mood wall
    sentimentScore,
    moodWallSentimentClass, moodWallPrimaryRgb, moodWallSecondaryRgb,
  } = intelligence

  // ═══════════════════════════════════════════════════════════════════════════════
  // HOOK 3: Top Section Data (depends on prices)
  // ═══════════════════════════════════════════════════════════════════════════════
  const topSection = useTopSectionData({
    topSectionTab,
    isStocks,
    categoryFilter,
    topCoinsChain,
    topCoinsRanges,
    stockPrices,
    topCoinPrices,
  })
  const {
    topCoinsPage, setTopCoinsPage,
    topCoinsTokens, topCoinsLoading,
    hasMorePages, totalCategoryPages,
    filteredTopCoins, buildTokensFromPrices,
    loadNextTopCoinsPage,
    jumpToTopCoinsPage,
    TOP_COINS_PAGE_SIZE,
    TOP_COINS_PAGE_SIZE_OPTIONS,
    TOTAL_TOP_COINS_PAGES,
    topCoinsPageSize,
    setTopCoinsPageSize,
    trendingTokens, onChainLoading,
    onChainChainFilter, setOnChainChainFilter,
    onChainRankBy, setOnChainRankBy,
    onChainViewMode, setOnChainViewMode,
    filteredOnChain,
    trendingTier, setTrendingTier,
    predictionsCategoryFilter, setPredictionsCategoryFilter,
    filteredPredictions, predictionsLoading,
    aiAgentCategoryFilter, setAiAgentCategoryFilter,
    aiAgentSortBy, setAiAgentSortBy,
    aiAgentSortDir, setAiAgentSortDir,
    filteredAiAgents,
    aiModelCategoryFilter, setAiModelCategoryFilter,
    aiModelProviderFilter, setAiModelProviderFilter,
    aiModelViewMode, setAiModelViewMode,
    aiModelSortBy, setAiModelSortBy,
    aiModelSortDir, setAiModelSortDir,
    aiModelQualityFilter, setAiModelQualityFilter,
    filteredAiModels,
  } = topSection

  // useHeatmapData fetches CoinGecko top 40 - crypto only. In stocks mode, fall
  // back to the stock list (filteredTopCoins is hydrated from TOP_STOCKS +
  // stockPrices). Without this swap, toggling Crypto -> Stocks leaves the
  // command-center heatmap showing the previously-loaded crypto tokens.
  const effectiveHeatmapTokens = isStocks ? filteredTopCoins : heatmapTokens

  // The dust gate the ticker applies below, hoisted so every consumer of the
  // trending feed shares it. The mobile Highlights strip was reading the RAW
  // feed, which is how a broken +4.64e+24% row reached the screen while the
  // ticker beside it was already filtering that class out.
  const cleanTrendingTokens = useMemo(
    () => (trendingTokens || []).filter((t) => !isDustToken(t)),
    [trendingTokens]
  )

  // Ticker tier (Top / Sub 500M / Sub 50M / On-chain) filters the single
  // honest Codex trending feed client-side - same pattern as the On-Chain
  // table's rank/cap-band pills (#1148). The old per-tier CG feeds are gone.
  const tickerTokens = useMemo(() => {
    if (isStocks) return null
    // Every feed here carries PERCENT-form change values - mark them so
    // TokenTicker doesn't guess the unit (its |change|>1 heuristic misread
    // sub-1% moves as fractions and displayed them x100).
    const mark = (rows) => rows.map((t) => ({ ...t, changeUnit: 'percent' }))
    const base = cleanTrendingTokens
    const mcapOf = (t) => Number(t.mcap ?? t.market_cap ?? 0)
    if (trendingTier === 'sub500m') return mark(base.filter(t => mcapOf(t) > 0 && mcapOf(t) < 500e6).slice(0, 20))
    if (trendingTier === 'sub50m') return mark(base.filter(t => mcapOf(t) > 0 && mcapOf(t) < 50e6).slice(0, 20))
    if (trendingTier === 'majors') {
      // 'Top' = the REAL market-cap leaderboard (same rows as the Top Coins
      // table, live-price-overlaid, snapshot-hydrated). This tier previously
      // mcap-sorted the DEX-trending feed - which BLACKLISTS BTC/ETH/BNB/
      // stables and only carries DEX-trending names, so "Top" showed random
      // small caps (UB/VELVET) instead of majors. Only trust the table rows
      // when they are the unfiltered global list (globalRank 1 = BTC on top);
      // category/chain-filtered or page-jumped lists fall back to the old
      // trending-derived slice.
      const isGlobalTop = (filteredTopCoins || [])[0]?.globalRank === 1
        && (!categoryFilter || categoryFilter === 'all')
      if (isGlobalTop) {
        // isTopCoin routes the ticker click to Research Zone (majors surface);
        // on-chain trending rows keep going to the trading screener.
        return mark(filteredTopCoins.filter((t) => Number(t.price) > 0 && t.logo).slice(0, 20))
          .map((t) => ({ ...t, isTopCoin: true }))
      }
      return mark([...base].sort((a, b) => mcapOf(b) - mcapOf(a)).slice(0, 20))
    }
    return mark(base.slice(0, 20))
  }, [isStocks, cleanTrendingTokens, trendingTier, filteredTopCoins, categoryFilter])

  // ═══════════════════════════════════════════════════════════════════════════════
  // HOOK 4: Welcome Interactions (depends on prices + topSection + heatmap)
  // ═══════════════════════════════════════════════════════════════════════════════
  const interactions = useWelcomeInteractions({
    topCoinPrices,
    stockPrices,
    heatmapTokens: effectiveHeatmapTokens,
    topCoinsTokens,
    isStocks,
    selectToken,
    onOpenResearchZone,
    onOpenAIScreener,
    addToWatchlist,
    isInWatchlist,
    watchlist: watchlistWithLiveData,
    tabsOn,
    setTabsOn,
    binancePrices,
    t,
  })
  const {
    compareMode, setCompareMode,
    compareTokens, showCompareModal,
    toggleCompareToken, isTokenSelected,
    openCompareModal, closeCompareModal, exitCompareMode,
    activeDiscoverTab, setActiveDiscoverTab,
    openTokenTabs, removeTokenTab, clearAllTabs,
    chartPanelToken, setChartPanelToken,
    chartOverlayTimeframe, setChartOverlayTimeframe,
    chartOverlaySubTab, setChartOverlaySubTab,
    chartOverlayYAxis, setChartOverlayYAxis,
    chartFullscreen, setChartFullscreen,
    OVERLAY_TIMEFRAMES,
    tokenCardPopup, tokenCardExpandedCard, setTokenCardExpandedCard,
    openTokenCardPopup, closeTokenCardPopup,
    openChartOnly,
    handleOnChainCoinClick, handleTopCoinClick, handleStockClick,
    handleSelectToken,
    getTradingViewSymbol,
    checkIsInWatchlist, EMPTY_STYLE,
  } = interactions

  // ═══════════════════════════════════════════════════════════════════════════════
  // Pull-to-Refresh (mobile only)
  // ═══════════════════════════════════════════════════════════════════════════════
  const handlePullRefresh = useCallback(async () => {
    // Data is already live-updating via polling hooks (5s Binance, 30s CoinGecko).
    // PTR provides visual feedback that the page is responsive. A brief delay
    // lets the polling cycle complete so the user sees updated values.
    await new Promise((r) => setTimeout(r, 800))
  }, [])

  const { pullState, pullDistance, containerProps: pullContainerProps } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    enabled: isMobile,
  })

  // ═══════════════════════════════════════════════════════════════════════════════
  // Remaining local state & logic (not moved to hooks)
  // ═══════════════════════════════════════════════════════════════════════════════

  // Update Discover list when prices arrive (Codex API) – used for welcome widget / fallback
  // Only update if prices actually changed to prevent re-render / spinning every 5s
  const prevTokenPricesRef = useRef('')
  useEffect(() => {
    const newTokens = buildTokensFromPrices(topCoinPrices || {});
    // Create a lightweight fingerprint of current prices to compare
    const fingerprint = newTokens.map(t => `${t.symbol}:${t.price}:${t.change}`).join('|')
    if (fingerprint !== prevTokenPricesRef.current) {
      prevTokenPricesRef.current = fingerprint
      setTokens(newTokens);
    }
    setLoading(false);
  }, [topCoinPrices, buildTokensFromPrices])

  // Register page actions and context for the AI assistant (when on landing)
  useEffect(() => {
    if (typeof setAssistantActions !== 'function') return
    setAssistantActions({
      openCommandCenterTab: (tabId) => setMarketAiTab(tabId),
      highlightSection: (selector) => {
        const el = typeof selector === 'string' ? document.querySelector(selector) : null
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('ai-highlight')
          window.setTimeout(() => el.classList.remove('ai-highlight'), 3000)
        }
      },
      openWatchlist: () => setWatchlistOpen(true),
      openWelcomeWidget: () => setWelcomeOpen(true),
      openTokenChart: (symbolOrToken) => {
        if (symbolOrToken && typeof symbolOrToken === 'object' && symbolOrToken.symbol) {
          setTopSectionTab('topcoins')
          setTabsOn(true)
          openChartOnly(symbolOrToken)
          setTimeout(() => {
            const chartPanel = document.querySelector('.discovery-chart-side, .welcome-chart-overlay-panel-right')
            chartPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 100)
          return
        }
        const sym = (symbolOrToken || '').toString().toUpperCase()
        const coin = TOP_COINS.find((c) => c.symbol === sym)
        if (!coin) return
        const data = topCoinPrices?.[sym] ?? topCoinPrices?.[coin.symbol]
        const token = {
          ...coin,
          price: data?.price != null ? Number(data.price) : coin.price,
          change: data?.change != null ? Number(data.change) : (data?.change24 != null ? Number(data.change24) : coin.change),
          logo: coin.logo || TOKEN_LOGOS[coin.symbol],
          sparkline_7d: data?.sparkline_7d ?? coin.sparkline_7d,
        }
        setTopSectionTab('topcoins')
        setTabsOn(true)
        openChartOnly(token)
        setTimeout(() => {
          const chartPanel = document.querySelector('.discovery-chart-side, .welcome-chart-overlay-panel-right')
          chartPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
      },
    })
    return () => setAssistantActions(null)
  }, [setAssistantActions, onPageChange, topCoinPrices])

  useEffect(() => {
    if (typeof setAssistantContext !== 'function') return
    setAssistantContext({
      fearGreed: { value: fearGreed.value, classification: fearGreed.classification },
      marketAiTab,
      marketMode,
      welcomeOpen,
      watchlistOpen,
    })
    return () => setAssistantContext(null)
  }, [setAssistantContext, fearGreed.value, fearGreed.classification, marketAiTab, marketMode, welcomeOpen, watchlistOpen])

  // When Monarch Chat requested chart or News tab, open them on mount
  useEffect(() => {
    if (pendingCommandCenterTab && typeof setPendingCommandCenterTab === 'function') {
      setMarketAiTab(pendingCommandCenterTab)
      setPendingCommandCenterTab(null)
    }
  }, [pendingCommandCenterTab, setPendingCommandCenterTab])

  // Restore Command Center tab when returning from Research Zone
  useEffect(() => {
    const returnTab = sessionStorage.getItem('spectre-cc-return-tab')
    if (returnTab) {
      sessionStorage.removeItem('spectre-cc-return-tab')
      setMarketAiTab(returnTab)
    }
  }, [])

  // When Monarch Chat requested a chart, open it once WelcomePage is ready
  useEffect(() => {
    if (!pendingChartToken || typeof setPendingChartToken !== 'function') return
    setTopSectionTab('topcoins')
    setTabsOn(true)
    if (pendingChartToken && typeof pendingChartToken === 'object' && pendingChartToken.symbol) {
      openChartOnly(pendingChartToken)
    } else {
      const sym = (pendingChartToken || '').toString().toUpperCase()
      const coin = TOP_COINS.find((c) => c.symbol === sym)
      if (coin) {
        const data = topCoinPrices?.[sym] ?? topCoinPrices?.[coin.symbol]
        openChartOnly({
          ...coin,
          price: data?.price != null ? Number(data.price) : coin.price,
          change: data?.change != null ? Number(data.change) : (data?.change24 != null ? Number(data.change24) : coin.change),
          logo: coin.logo || TOKEN_LOGOS[coin.symbol],
          sparkline_7d: data?.sparkline_7d ?? coin.sparkline_7d,
        })
      }
    }
    setPendingChartToken(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when pendingChartToken is set
  }, [pendingChartToken, setPendingChartToken])

  const openTopCoinInfo = (symbol, e) => {
    e.stopPropagation()
    e.preventDefault()
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    topCoinInfoAnchorRef.current = { top: rect.bottom + 4, left: rect.left }
    setTopCoinInfoOpen(symbol)
  }
  const closeTopCoinInfo = () => setTopCoinInfoOpen(null)
  const topCoinInfoPopoverRef = useRef(null)
  useEffect(() => {
    if (!topCoinInfoOpen) return
    const onMouseDown = (e) => {
      const pop = topCoinInfoPopoverRef.current
      if (pop && !pop.contains(e.target) && !e.target.closest('.welcome-topcoin-info-btn')) closeTopCoinInfo()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [topCoinInfoOpen])

  const getSortedWatchlist = useCallback(() => {
    // For stocks mode, filter and enhance watchlist with stock prices
    let list = []
    if (isStocks) {
      const stockItems = watchlist.filter(t => t.isStock)
      list = stockItems.map(t => {
        const liveData = stockPrices?.[t.symbol]
        return {
          ...t,
          price: liveData?.price ?? t.price ?? 0,
          change: liveData?.change ?? t.change ?? 0,
          marketCap: liveData?.marketCap ?? t.marketCap ?? 0,
          volume: liveData?.volume ?? t.volume ?? 0,
          name: liveData?.name || t.name || t.symbol,
          logo: getStockLogo(t.symbol, t.sector),
        }
      })
    } else {
      list = watchlistWithLiveData
    }
    if (!list.length) return []
    const pinned = list.filter((t) => t.pinned)
    let unpinned = list.filter((t) => !t.pinned)
    switch (watchlistSort) {
      case 'priceChangeDesc':
        unpinned = [...unpinned].sort((a, b) => {
          const ac = Math.abs(a.change || 0) < 1 ? (a.change || 0) * 100 : (a.change || 0)
          const bc = Math.abs(b.change || 0) < 1 ? (b.change || 0) * 100 : (b.change || 0)
          return bc - ac
        })
        break
      case 'priceChangeAsc':
        unpinned = [...unpinned].sort((a, b) => {
          const ac = Math.abs(a.change || 0) < 1 ? (a.change || 0) * 100 : (a.change || 0)
          const bc = Math.abs(b.change || 0) < 1 ? (b.change || 0) * 100 : (b.change || 0)
          return ac - bc
        })
        break
      case 'marketCapDesc':
        unpinned = [...unpinned].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
        break
      case 'marketCapAsc':
        unpinned = [...unpinned].sort((a, b) => (a.marketCap || 0) - (b.marketCap || 0))
        break
      default:
        break
    }
    return [...pinned, ...unpinned]
  }, [isStocks, watchlist, watchlistWithLiveData, stockPrices, watchlistSort])


  // getSortedWatchlist is useCallback-stable (deps capture the real inputs:
  // watchlistWithLiveData, watchlistSort, etc). Memoize the CALL so the
  // filter/map/sort only re-runs when those inputs change, not on every
  // price tick / brief auto-rotation render.
  const sortedWatchlist = useMemo(() => getSortedWatchlist(), [getSortedWatchlist])

  const renderChartPanel = (inline = false) => (
    <ChartPanel
      inline={inline}
      token={chartPanelToken}
      onClose={() => setChartPanelToken(null)}
      timeframe={chartOverlayTimeframe}
      setTimeframe={setChartOverlayTimeframe}
      subTab={chartOverlaySubTab}
      setSubTab={setChartOverlaySubTab}
      yAxis={chartOverlayYAxis}
      setYAxis={setChartOverlayYAxis}
      fullscreen={chartFullscreen}
      setFullscreen={setChartFullscreen}
      overlayTimeframes={OVERLAY_TIMEFRAMES}
      getTradingViewSymbol={getTradingViewSymbol}
      binancePrices={binancePrices}
      selectToken={selectToken}
      onPageChange={onPageChange}
      onOpenResearchZone={onOpenResearchZone}
      dayMode={dayMode}
      t={t}
    />
  )

  const terminalMoodWallStyle = showMoodWall
    ? { '--sentiment-primary': moodWallPrimaryRgb, '--sentiment-secondary': moodWallSecondaryRgb, '--mood-brightness': moodWallBrightness }
    : {}

  const terminalMoodWallClass = showMoodWall ? moodWallSentimentClass : ''

  // Mobile Command Center tabs. Built once per [t, isShowcaseEmbed] change so the
  // fresh-array identity doesn't defeat MobileContentTabs' memo on every render
  // (price tick / brief auto-rotation). SHOWCASE_ALLOWED_CC_TABS is module-level.
  const mobileCCTabs = useMemo(() => [
    { id: 'brief', label: t('commandCenter.aiBrief') },
    { id: 'analysis', label: t('commandCenter.aiMarket'), pageId: 'ai-market-analysis' },
    // Stocks-only, mirrors the desktop tab list. No pageId: there is no
    // full-page earnings view, so the "View full page" CTA stays hidden.
    { id: 'earnings', label: t('commandCenter.earnings', 'Earnings'), stocksOnly: true },
    { id: 'news', label: t('commandCenter.news'), pageId: 'news' },
    // Posts has no dedicated full-page view - /social-zone is the
    // wrong target (it's Social Chats). Leave pageId off so the
    // "View full page" CTA stays hidden on this tab.
    { id: 'posts', label: t('commandCenter.posts', 'Posts') },
    { id: 'heatmaps', label: t('commandCenter.heatmaps'), pageId: 'heatmaps' },
    { id: 'liquidation', label: t('commandCenter.liquidation'), pageId: 'liquidation-heatmap' },
    { id: 'sector', label: t('commandCenter.sectors'), pageId: 'categories' },
    { id: 'mindshare', label: t('commandCenter.mindshare') },
    { id: 'calendar', label: t('commandCenter.calendar'), pageId: 'economic-calendar' },
    { id: 'flows', label: t('commandCenter.flows') },
    { id: 'wallets', label: t('commandCenter.wallets') },
    { id: 'others', label: t('commandCenter.others', 'Others') },
  ].filter((tab) => !(tab.stocksOnly && !isStocks))
    .map((tab) => ({
      ...tab,
      locked: isShowcaseEmbed && !SHOWCASE_ALLOWED_CC_TABS.has(tab.id),
    })), [t, isShowcaseEmbed, isStocks])

  // AI Market has an existing full-view panel; its standalone route is not live.
  const handleMobileCCPageChange = useCallback((pageId) => {
    if (pageId === 'ai-market-analysis') {
      setFullViewTab('analysis')
      setBriefFullViewOpen(true)
      return
    }
    onPageChange?.(pageId)
  }, [onPageChange])

  // Stable props for the memo'd mobile children (MobileQuickStats / MobileWatchlistStrip)
  // so a price tick / brief rotation doesn't hand them fresh inline identities each render.
  const handleDominanceClick = useCallback(() => setShowDominanceChart(true), [])
  const activeWatchlistName = useMemo(
    () => watchlists?.find(w => w.id === activeWatchlistId)?.name,
    [watchlists, activeWatchlistId]
  )

  // ═══════════════════════════════════════════════════════════════════════════════
  // CINEMA MODE - Render cinematic experience instead of terminal mode
  // ═══════════════════════════════════════════════════════════════════════════════
  if (cinemaMode) {
    return (
      <div className={`welcome-page cinema-mode${dayMode ? ' day-mode' : ''}${moodWallSentimentClass}`}>
        <CinemaWelcomeWrapper
          profile={profile}
          dayMode={dayMode}
          marketMode={marketMode}
          selectToken={selectToken}
          onOpenResearchZone={onOpenResearchZone}
          onOpenStorybook={(token) => {
            const full = topCoinsTokens.find(t => (t.symbol || '').toUpperCase() === (token.symbol || '').toUpperCase())
            setCinemaStorybookToken(full || token)
            setCinemaStorybookOpen(true)
          }}
          addToWatchlist={addToWatchlist}
          removeFromWatchlist={removeFromWatchlist}
          isInWatchlist={isInWatchlist}
          togglePinWatchlist={togglePinWatchlist}
          reorderWatchlist={reorderWatchlist}
          watchlist={watchlistWithLiveData}
          watchlists={watchlists}
          activeWatchlistId={activeWatchlistId}
          onSwitchWatchlist={onSwitchWatchlist}
          topCoinPrices={topCoinPrices}
          trendingTokens={trendingTokens}
          fearGreed={fearGreed}
          altSeason={altSeason}
          marketDominance={marketDominance}
          stockPrices={stockPrices}
          liveVix={liveVix}
          stocksRiskOnOff={stocksRiskOnOff}
          indexAllocation={indexAllocation}
          topCoinsTokens={topCoinsTokens}
          onChainTokens={null}
          marketAiTab={marketAiTab}
          setMarketAiTab={setMarketAiTab}
          newsItems={newsItems}
          heatmapTokens={effectiveHeatmapTokens}
          calendarEvents={null}
          liveActivity={liveActivity}
          alphaFeed={alphaFeed}
          intel={intel}
          onPageChange={onPageChange}
          theBriefStatement={theBriefStatement}
          theBriefStatements={allBriefStatements}
          briefLabels={briefLabels}
          outlookIndex={outlookIndex}
          macroAnalysisData={macroAnalysisData}
          sentimentScore={sentimentScore}
        />
        <Suspense fallback={null}>
          <TokenStorybook
            token={cinemaStorybookToken}
            isOpen={cinemaStorybookOpen}
            onClose={() => setCinemaStorybookOpen(false)}
            onAddToWatchlist={(t) => addToWatchlist?.({
              symbol: (t.symbol || '').toUpperCase(),
              name: t.name,
              logo: t.image,
              price: t.current_price || t.price,
              change: t.price_change_percentage_24h || t.change,
              marketCap: t.market_cap || t.marketCap,
              pinned: false,
            })}
            isInWatchlist={(t) => isInWatchlist?.({ symbol: (t?.symbol || '').toUpperCase() })}
            dayMode={dayMode}
          />
        </Suspense>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TERMINAL MODE - Original data-heavy dashboard
  // ═══════════════════════════════════════════════════════════════════════════════

  return (
    <div className={`welcome-page${dayMode ? ' day-mode' : ''} horizontal-layout${terminalMoodWallClass}`} style={terminalMoodWallStyle}>

      <ProfileEditModal
        open={profileModalOpen}
        onClose={handleCloseProfileModal}
        name={profile?.name || ''}
        imageUrl={profile?.imageUrl || ''}
        onSave={handleSaveProfile}
        onToast={triggerCopyToast}
        dayMode={dayMode}
      />

      {/* ===== MOBILE WELCOME CONTENT ===== */}
      {isMobile && (
        <div className="welcome-mobile-content" {...pullContainerProps}>
          {/* Pull-to-refresh indicator */}
          {pullState !== 'idle' && (
            <div
              className={`mobile-pull-indicator mobile-pull-indicator--${pullState}`}
              style={{ height: pullDistance }}
              aria-live="polite"
              aria-label={pullState === 'refreshing' ? 'Refreshing' : pullState === 'threshold' ? 'Release to refresh' : 'Pull to refresh'}
            >
              <PullRefreshMark state={pullState} distance={pullDistance} dayMode={dayMode} />
            </div>
          )}
          {/* Spacer to clear the fixed 52px header + safe area */}
          <div className="welcome-mobile-header-spacer" aria-hidden="true" />
          {/* Greeting + editable name + avatar (no sign-in required) */}
          <MobileGreeting dayMode={dayMode} onEdit={handleOpenProfileModal} />
          {/* Weather + Date/Time strip */}
          <MobileWeatherClock dayMode={dayMode} />
          {/* Market Pulse — live prices + F&G at a glance */}
          <MobileMarketPulse
            topCoinPrices={topCoinPrices}
            fearGreed={fearGreed}
            marketDominance={marketDominance}
            isStocks={isStocks}
            onOpenResearchZone={onOpenResearchZone}
            dayMode={dayMode}
            t={t}
          />

          {/* Quick Stats — market context at a glance */}
          <MobileWelcomeSection
            className="welcome-mobile-section mobile-stagger-2"
            open={isSectionOpen(WELCOME_SECTIONS.mQuickStats)}
            label={t('welcome.mSectionQuickStats', 'Market Stats')}
            hint={t('welcome.mSectionQuickStatsHint', 'Fear & Greed · Dominance')}
            onToggle={() => toggleWelcomeSection(WELCOME_SECTIONS.mQuickStats)}
          >
            <MobileQuickStats
              topCoinPrices={topCoinPrices}
              fearGreed={fearGreed}
              marketDominance={marketDominance}
              altSeason={altSeason}
              dayMode={dayMode}
              t={t}
              onDominanceClick={handleDominanceClick}
            />
          </MobileWelcomeSection>

          {/* Watchlist Strip — horizontal scroll of tracked tokens */}
          <MobileWelcomeSection
            className="welcome-mobile-section-flush mobile-stagger-3"
            open={isSectionOpen(WELCOME_SECTIONS.mWatchlist)}
            label={activeWatchlistName || t('ui.myWatchlist', 'My Watchlist')}
            hint={t('welcome.mSectionWatchlistHint', 'Tracked tokens')}
            onToggle={() => toggleWelcomeSection(WELCOME_SECTIONS.mWatchlist)}
            actions={watchlistWithLiveData?.length > 0 && onPageChange ? (
              <button type="button" className="wsecm-action" onClick={() => onPageChange('watchlists')}>
                {t('ui.seeAll', 'See All')}
                <WsecChevronRight />
              </button>
            ) : null}
          >
            <MobileWatchlistStrip
              watchlistWithLiveData={watchlistWithLiveData}
              selectToken={selectToken}
              onOpenResearchZone={onOpenResearchZone}
              onOpenAIScreener={onOpenAIScreener}
              onPageChange={onPageChange}
              activeWatchlistName={activeWatchlistName}
              dayMode={dayMode}
              t={t}
            />
          </MobileWelcomeSection>

          {/* Command Center Tabs — swipeable intelligence panels
               AI Brief is the default tab, so no separate MobileBriefCard needed */}
          <MobileWelcomeSection
            className="welcome-mobile-section-flush mobile-stagger-4"
            open={isSectionOpen(WELCOME_SECTIONS.mCommandCenter)}
            label={t('commandCenter.title', 'Command Center')}
            hint={t('welcome.mSectionCommandCenterHint', 'AI brief · Intel')}
            onToggle={() => toggleWelcomeSection(WELCOME_SECTIONS.mCommandCenter)}
            actions={isShowcaseEmbed ? null : (
              <button
                type="button"
                className={`wsecm-action wsecm-action--icon${pinnedCCTab === marketAiTab ? ' wsecm-action--on' : ''}`}
                onClick={() => setPinnedCCTab(pinnedCCTab === marketAiTab ? null : marketAiTab)}
                aria-label={pinnedCCTab === marketAiTab
                  ? t('mobileContent.unpinTab', 'Unpin tab')
                  : t('mobileContent.pinAsDefault', 'Pin as default tab')}
              >
                <WsecPinIcon filled={pinnedCCTab === marketAiTab} />
              </button>
            )}
          >
            <MobileContentTabs
              activeTab={marketAiTab}
              onTabChange={setMarketAiTab}
              tabs={mobileCCTabs}
              onPageChange={isShowcaseEmbed ? undefined : handleMobileCCPageChange}
              dayMode={dayMode}
              t={t}
              pinnedTab={pinnedCCTab}
              // NO second collapse. The Command Center used to carry two
              // disclosure controls: the section rail's chevron (folds the whole
              // section) and a tiny one at the end of the tab row (folds only
              // the panel body). Founder, 08-04: "in command center there are
              // two drop down… there is an extra arrow that no one notices."
              // It was also the control behind the 08-03 "the tabs don't work"
              // report — a 22px persisted target sitting right after the last
              // tab, closed by accident and then invisible. Omitting
              // `onTogglePanel` keeps it out of the DOM and leaves the panel
              // permanently open, so picking a tab shows that tab. Folding the
              // Command Center away is the rail's job, and only the rail's.
              // The pin control lives in the section rail (see `actions`
              // above), not in the child's own header — under `.wsecm` that
              // header is suppressed, which is what left the star stranded
              // over empty space. Passing no `onPinTab` keeps it out of the
              // DOM entirely instead of hiding a duplicate button.
            >
              <Suspense fallback={null}>
              {marketAiTab === 'brief' && (
                <BriefTabContent
                  briefPausedRef={briefPausedRef}
                  handleBriefTouchStart={handleBriefTouchStart}
                  handleBriefTouchEnd={handleBriefTouchEnd}
                  briefDisplay={briefDisplay}
                  briefFading={briefFading}
                  terminalIsFullBrief={terminalIsFullBrief}
                  allBriefStatements={allBriefStatements}
                  briefLabels={briefLabels}
                  outlookIndex={outlookIndex}
                  briefIndex={briefIndex}
                  goToBrief={goToBrief}
                  getTerminalBriefInterval={getTerminalBriefInterval}
                  topCoinPrices={topCoinPrices}
                  stockPrices={stockPrices}
                  macroAnalysisData={macroAnalysisData}
                  fearGreed={fearGreed}
                  liveVix={liveVix}
                  marketStructureTrio={marketStructureTrio}
                  sentimentRgb={sentimentRgb}
                  biasRgb={biasRgb}
                  isStocks={isStocks}
                  t={t}
                  onShare={handleShareBrief}
                  isSharing={isBriefShareExporting}
                />
              )}
              {marketAiTab === 'analysis' && (
                macroAnalysisData
                  ? <Suspense fallback={<div className="welcome-market-ai-analysis-full"><div className="ai-mkt-loading"><div className="ai-mkt-loading-pulse" /><span>{t('ui.analyzingMarketData')}</span></div></div>}><AiMarketPanel macroAnalysisData={macroAnalysisData} marketStructureTrio={marketStructureTrio} marketAiTimeframe={marketAiTimeframe} setMarketAiTimeframe={setMarketAiTimeframe} breakingHeadlines={isStocks ? stockContextNews : breakingHeadlines} isStocks={isStocks} /></Suspense>
                  : <div className="welcome-market-ai-analysis-full"><div className="ai-mkt-loading"><div className="ai-mkt-loading-pulse" /><span>{t('ui.analyzingMarketData')}</span></div></div>
              )}
              {marketAiTab === 'earnings' && <EarningsTabPanel t={t} />}
              {marketAiTab === 'news' && (
                <NewsTabPanel newsXToggle={false} setNewsXToggle={setNewsXToggle} newsItems={newsItems} newsLoading={newsLoading} isStocks={isStocks} t={t} xPosts={xPosts} xPostsLoading={xPostsLoading} xPostsError={xPostsError} onRetryXPosts={refetchXPosts} hideToggle />
              )}
              {marketAiTab === 'posts' && (
                <NewsTabPanel newsXToggle={true} setNewsXToggle={setNewsXToggle} newsItems={newsItems} newsLoading={newsLoading} isStocks={isStocks} t={t} xPosts={xPosts} xPostsLoading={xPostsLoading} xPostsError={xPostsError} onRetryXPosts={refetchXPosts} hideToggle />
              )}
              {marketAiTab === 'heatmaps' && (
                <HeatmapCommandPanel
                  heatmapsBubblesToggle={heatmapsBubblesToggle}
                  setHeatmapsBubblesToggle={setHeatmapsBubblesToggle}
                  heatmapTokens={effectiveHeatmapTokens}
                  topCoinsTokens={topCoinsTokens}
                  fmtPrice={fmtPrice}
                  openTokenCardPopup={openTokenCardPopup}
                  isStocks={isStocks}
                  dayMode={dayMode}
                />
              )}
              {marketAiTab === 'sector' && (
                <SectorsTabPanel
                  intelLastUpdated={intel.lastUpdated}
                  selectToken={selectToken}
                  onOpenResearchZone={onOpenResearchZone}
                  onOpenAIScreener={onOpenAIScreener}
                  topCoinPrices={topCoinPrices}
                  onPageChange={onPageChange}
                />
              )}
              {marketAiTab === 'mindshare' && <MindshareTabPanel topCoinPrices={topCoinPrices} onOpenResearchZone={onOpenResearchZone} onOpenAIScreener={onOpenAIScreener} onPageChange={onPageChange} />}
              {marketAiTab === 'liquidation' && (
                <Suspense fallback={null}>
                  <LiqHeatmapPanel symbol={liqSymbol} setSymbol={setLiqSymbol} enabled dayMode={dayMode} fmtPrice={fmtPrice} height={440} />
                </Suspense>
              )}
              {marketAiTab === 'calendar' && <CalendarMiniPanel />}
              {marketAiTab === 'flows' && <EtfFlowsView compact />}
              {marketAiTab === 'wallets' && <WalletsTabPanel />}
              {marketAiTab === 'others' && <OthersTabPanel fmtLarge={fmtLarge} />}
              {marketAiTab === 'podcasts' && <PodcastsTabPanel />}
              </Suspense>
            </MobileContentTabs>
          </MobileWelcomeSection>

          {/* Discovery — token browsing with mobile tab bar */}
          <MobileWelcomeSection
            className="welcome-mobile-section"
            open={isSectionOpen(WELCOME_SECTIONS.mDiscovery)}
            label={t('welcome.mSectionDiscover', 'Discover')}
            hint={t('welcome.mSectionDiscoverHint', 'Markets · On-chain')}
            onToggle={() => toggleWelcomeSection(WELCOME_SECTIONS.mDiscovery)}
          >
            <MobileDiscoverySection
              isShowcaseEmbed={isShowcaseEmbed}
              topSectionTab={topSectionTab}
              setTopSectionTab={setTopSectionTab}
              setChartPanelToken={setChartPanelToken}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              CATEGORY_TABS={CATEGORY_TABS}
              predictionsCategoryFilter={predictionsCategoryFilter}
              setPredictionsCategoryFilter={setPredictionsCategoryFilter}
              aiAgentCategoryFilter={aiAgentCategoryFilter}
              setAiAgentCategoryFilter={setAiAgentCategoryFilter}
              aiModelCategoryFilter={aiModelCategoryFilter}
              setAiModelCategoryFilter={setAiModelCategoryFilter}
              isStocks={isStocks}
              dayMode={dayMode}
              onOpenFullView={() => setDiscoveryFullViewOpen(true)}
              showWatchlist={discoveryShowWatchlist}
              setShowWatchlist={setDiscoveryShowWatchlist}
              watchlistTokens={watchlistWithLiveData}
              onAddToWatchlist={addToWatchlist}
              onRemoveFromWatchlist={removeFromWatchlist}
              checkIsInWatchlist={checkIsInWatchlist}
              onSelectToken={handleSelectToken}
              t={t}
            >
              <Suspense fallback={<div className="welcome-discovery-loading" aria-hidden="true" />}>
              <DiscoverySection
                {...{
                  tabsOn, setTabsOn,
                  activeDiscoverTab, setActiveDiscoverTab,
                  chartPanelToken, setChartPanelToken,
                  topSectionTab, setTopSectionTab,
                  categoryFilter, setCategoryFilter,
                  topCoinsChain, setTopCoinsChain,
                  topCoinsRanges, setTopCoinsRanges,
                  timeframeFilter, setTimeframeFilter,
                  predictionsCategoryFilter, setPredictionsCategoryFilter,
                  onChainChainFilter, setOnChainChainFilter,
                  onChainRankBy, setOnChainRankBy,
                  onChainViewMode, setOnChainViewMode,
                  viewMode, setViewMode,
                  topCoinsLoading,
                  onChainLoading,
                  loading,
                  compareMode, setCompareMode,
                  topCoinsPage, setTopCoinsPage,
                  chartOverlayTimeframe, setChartOverlayTimeframe,
                  chartOverlaySubTab, setChartOverlaySubTab,
                  chartOverlayYAxis, setChartOverlayYAxis,
                  chartFullscreen, setChartFullscreen,
                  openTokenTabs,
                  filteredOnChain,
                  filteredPredictions, predictionsLoading,
                  filteredAiAgents,
                  filteredAiModels,
                  aiAgentCategoryFilter, setAiAgentCategoryFilter,
                  aiAgentSortBy, setAiAgentSortBy,
                  aiAgentSortDir, setAiAgentSortDir,
                  aiModelCategoryFilter, setAiModelCategoryFilter,
                  aiModelProviderFilter, setAiModelProviderFilter,
                  aiModelViewMode, setAiModelViewMode,
                  aiModelSortBy, setAiModelSortBy,
                  aiModelSortDir, setAiModelSortDir,
                  aiModelQualityFilter, setAiModelQualityFilter,
                  aiModelEloTrends: AI_MODEL_ELO_TRENDS,
                  tokens,
                  filteredTopCoins,
                  topCoinPrices,
                  compareTokens,
                  binancePrices,
                  openTokenCardPopup,
                  openChartOnly,
                  removeTokenTab,
                  clearAllTabs,
                  handleOnChainCoinClick,
                  handleTopCoinClick,
                  handleStockClick,
                  toggleCompareToken,
                  isTokenSelected,
                  openTopCoinInfo,
                  checkIsInWatchlist,
                  addToWatchlist,
                  removeFromWatchlist,
                  renderChartPanel,
                  exitCompareMode,
                  selectToken,
                  onPageChange,
                  getTradingViewSymbol,
                  OVERLAY_TIMEFRAMES,
                  fmtPrice, fmtLarge,
                  icons,
                  TRANSLATED_STOCK_SECTORS,
                  CATEGORY_TABS,
                  MORE_CATEGORY_TABS,
                  timeframes,
                  TOTAL_TOP_COINS_PAGES,
                  TOP_COINS_PAGE_SIZE,
                  TOP_COINS_PAGE_SIZE_OPTIONS,
                  topCoinsPageSize,
                  setTopCoinsPageSize,
                  hasMorePages,
                  totalCategoryPages,
                  loadNextTopCoinsPage,
                  jumpToTopCoinsPage,
                  EMPTY_STYLE,
                  isMobile, isStocks, discoverOnly,
                  t,
                  fearGreed,
                  watchlist,
                  // Feeds the mobile Top Coins "Favorites" pill. Without it the
                  // pill could only filter the loaded top-coins page, so a
                  // starred coin further down the market never appeared there.
                  watchlistWithLiveData,
                }}
              />
              </Suspense>
            </MobileDiscoverySection>
          </MobileWelcomeSection>
        </div>
      )}

      {!isMobile && (
        <section className={`welcome-section-trending wsec${trendingOpen ? '' : ' wsec--closed'}`}>
          {/* Ticker clicks route by token kind (the chart overlay was removed
              2026-07-08): Top-tier majors open Research Zone (cgId payload,
              same shape as handleTopCoinClick, beats same-ticker collisions);
              on-chain trending rows open the trading screener by contract;
              stocks keep routing to Research Zone via handleStockClick. */}
          <div className="wsec-collapse">
          <div className="wsec-collapse-inner">
          <div className="wsec-row">
          <WelcomeSectionToggle
            open={trendingOpen}
            label={t('welcome.sectionTrending', 'Trending')}
            onToggle={() => toggleWelcomeSection(WELCOME_SECTIONS.trending)}
          />
          <div className="welcome-ticker-wrap">
            <TokenTicker
              tokens={tickerTokens}
              marketMode={marketMode}
              selectToken={selectToken}
              onTokenClickOpenOverlay={isStocks ? handleStockClick : (token) => {
                if (token?.isTopCoin && onOpenResearchZone) {
                  onOpenResearchZone({
                    symbol: token.symbol,
                    name: token.name || token.symbol,
                    address: token.address,
                    networkId: token.networkId,
                    cgId: token.cgId || SYMBOL_TO_COINGECKO_ID[token.symbol?.toUpperCase?.()] || null,
                    price: token.price,
                    change: token.change,
                    logo: token.logo,
                  })
                  return
                }
                selectToken?.({
                  symbol: token.symbol,
                  name: token.name,
                  address: token.address,
                  networkId: token.networkId,
                  logo: token.logo,
                  price: token.price,
                  change: token.change,
                })
              }}
              embedded
              tickerMode={tickerMode}
              onToggleMode={() => setTickerMode(m => m === 'trending' ? 'news' : 'trending')}
              newsItems={newsItems}
              leftSlot={!isStocks ? (
                <TickerTierDropdown
                  value={trendingTier}
                  onChange={setTrendingTier}
                  parentTab={topSectionTab}
                />
              ) : null}
            />
          </div>
          </div>
          </div>
          </div>
          {!trendingOpen && (
            <WelcomeSectionBar
              label={t('welcome.sectionTrending', 'Trending')}
              hint={t('welcome.sectionTrendingHint', 'Live ticker')}
              onOpen={() => toggleWelcomeSection(WELCOME_SECTIONS.trending)}
            />
          )}
        </section>
      )}

      {/* ── Breaking News Banner (desktop only — mobile has its own news in ContentTabs) ── */}
      {!isMobile && breakingArticle && (() => {
        const ts = breakingArticle.publishedAt ? new Date(breakingArticle.publishedAt).getTime() : NaN
        // Client-side staleness guard. An article older than 24h is not
        // breaking — render nothing rather than parading a month-old headline.
        if (!Number.isFinite(ts) || Date.now() - ts > 24 * 60 * 60 * 1000) return null
        const diff = Date.now() - ts
        const mins = Math.floor(diff / 60000)
        const ago = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`
        return (
          <div
            className="welcome-breaking-banner"
            onClick={() => onPageChange && onPageChange('intelligence')}
            role="alert"
          >
            <div className="welcome-breaking-banner__inner">
              <div className="welcome-breaking-banner__label">
                <span className="welcome-breaking-banner__dot" />
                <span>{t('welcome.breakingBadge', 'BREAKING')}</span>
              </div>
              <span className="welcome-breaking-banner__headline">
                {(breakingArticle.headline || breakingArticle.title || '').replace(/\*\*/g, '')}
              </span>
              <span className="welcome-breaking-banner__time">{ago}</span>
            </div>
          </div>
        )
      })()}

      {/* ===== HORIZONTAL LAYOUT (desktop) ===== */}
      {!isMobile && (
        <div className="welcome-horizontal-layout">
          {/* Horizontal Welcome Bar */}
          <InlineHorizontalBar
              welcomeOpen={welcomeOpen} setWelcomeOpen={setWelcomeOpen}
              profile={profile}
              onEditProfile={handleOpenProfileModal}
              topCoinPrices={topCoinPrices} stockPrices={stockPrices} marketIndices={marketIndices}
              fearGreed={fearGreed} liveVix={liveVix} altSeason={altSeason}
              marketDominance={marketDominance} stocksRiskOnOff={stocksRiskOnOff}
              indexAllocation={indexAllocation} usMarketStatus={usMarketStatus} eventState={eventState}
              openTokenCardPopup={openTokenCardPopup} handleStockClick={handleStockClick}
              onDominanceClick={handleDominanceClick}
              fmtPrice={fmtPrice} fmtLarge={fmtLarge} isStocks={isStocks} t={t}
            />

          {/* Bottom Row: Command Center (75%) + Watchlist (25%) */}
          <div className={`welcome-experimental-bottom${!commandCenterOpen ? ' welcome-experimental-bottom--cc-collapsed' : ''}`}>
            {/* Command Center - reuse the existing component */}
            <div className={`welcome-market-ai-widget${!commandCenterOpen ? ' welcome-market-ai-widget--collapsed' : ''}`} data-tour="command-center">
              <div className="welcome-market-ai-header-row">
                <div className="welcome-market-ai-section-title">
                  <span className="welcome-market-ai-icon">{spectreIcons.sparkles}</span>
                  <span>{t('commandCenter.title')}</span>
                  <button
                    type="button"
                    className={`cc-pin-btn${pinnedCCTab === marketAiTab ? ' cc-pin-btn--active' : ''}`}
                    onClick={() => setPinnedCCTab(pinnedCCTab === marketAiTab ? null : marketAiTab)}
                    data-tooltip={pinnedCCTab === marketAiTab ? t('commandCenter.unpinTab', 'Unpin tab') : t('commandCenter.pinAsDefault', 'Pin as default tab')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill={pinnedCCTab === marketAiTab ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 17l-6.5 4 2-7.5L2 9h7z" />
                    </svg>
                  </button>
                </div>
                <div className="welcome-market-ai-tabs">
                  {marketAiTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`welcome-market-ai-tab ${marketAiTab === tab.id ? 'active' : ''}${tab.locked ? ' cc-tab-locked' : ''}`}
                      onClick={() => {
                        if (tab.locked) {
                          if (typeof window !== 'undefined') {
                            try {
                              window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
                                detail: { source: 'command-center', tab: tab.id },
                              }))
                            } catch { /* noop */ }
                          }
                          return
                        }
                        setMarketAiTab(tab.id)
                      }}
                      aria-disabled={tab.locked || undefined}
                      title={tab.locked ? 'Available in Beta' : undefined}
                    >
                      <span className="welcome-market-ai-tab-icon" aria-hidden>{marketAiTabIcons[tab.id]}</span>
                      <span>{tab.label}</span>
                      {tab.locked && (
                        <span className="cc-tab-lock-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="5" y="11" width="14" height="9" rx="2" />
                            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                          </svg>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="cc-header-actions">
                  <button
                    type="button"
                    className="cc-tab-action-btn"
                    onClick={handleShareBrief}
                    disabled={isBriefShareExporting}
                    data-tooltip={t('commandCenter.shareToX', 'Share to X')}
                  >
                    {isBriefShareExporting ? (
                      <span className="cc-tab-action-loading" />
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                        <span>{t('common.share', 'Share')}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="cc-fullview-btn"
                    onClick={() => { setFullViewTab(marketAiTab); setBriefFullViewOpen(true) }}
                    data-tooltip={t('commandCenter.fullView', 'Full View')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="cc-collapse-btn"
                    onClick={() => setCommandCenterOpen(!commandCenterOpen)}
                    data-tooltip={commandCenterOpen ? t('commandCenter.collapse', 'Collapse') : t('commandCenter.expand', 'Expand')}
                    aria-expanded={commandCenterOpen}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: commandCenterOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>
              {/* Preview strip — shown only when collapsed. Shows the active tab's headline + live data. */}
              {!commandCenterOpen && (() => {
                const btc = topCoinPrices?.BTC || {}
                const eth = topCoinPrices?.ETH || {}
                const sol = topCoinPrices?.SOL || {}
                const priceFmt = (v) => {
                  const n = Number(v)
                  if (!Number.isFinite(n)) return '—'
                  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`
                  if (n >= 1) return `$${n.toFixed(2)}`
                  return `$${n.toFixed(4)}`
                }
                const pctFmt = (v) => {
                  const n = Number(v)
                  if (!Number.isFinite(n)) return ''
                  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
                }
                const fg = fearGreed?.value != null ? `F&G ${fearGreed.value}` : ''
                const dom = marketDominance?.btc != null ? `${marketDominance.btc.toFixed(1)}%` : ''
                const altPct = altSeason?.value != null ? `${Math.round(altSeason.value)}` : ''
                const nextEvent = Array.isArray(eventState?.upcoming) && eventState.upcoming[0]?.title
                  ? eventState.upcoming[0].title
                  : null
                const usMkt = usMarketStatus?.status || usMarketStatus?.label || ''
                const tabSummary = (() => {
                  switch (marketAiTab) {
                    case 'brief':
                      return briefDisplay || `BTC ${priceFmt(btc.price)} ${pctFmt(btc.change)} · ${fg}`
                    case 'market':
                      return `BTC ${priceFmt(btc.price)} ${pctFmt(btc.change)} · ETH ${priceFmt(eth.price)} ${pctFmt(eth.change)}`
                    case 'news':
                      return briefDisplay
                        ? briefDisplay
                        : `Live headlines · BTC ${pctFmt(btc.change)} · ETH ${pctFmt(eth.change)}`
                    case 'posts':
                      return `KOL posts · BTC ${pctFmt(btc.change)} · ETH ${pctFmt(eth.change)} · SOL ${pctFmt(sol.change)}`
                    case 'heatmap':
                      return `BTC dom ${dom} · ETH dom ${marketDominance?.eth?.toFixed(1) || '—'}% · alts ${marketDominance?.alts?.toFixed(1) || '—'}%`
                    case 'liquidation':
                      return `BTC ${priceFmt(btc.price)} ${pctFmt(btc.change)} · ${fg} · liq snapshot`
                    case 'sectors':
                      return `Sector flows · BTC dom ${dom} · alt-season ${altPct || '—'}`
                    case 'mindshare':
                      return `Trending narratives · BTC ${pctFmt(btc.change)} · SOL ${pctFmt(sol.change)}`
                    case 'calendar':
                      return nextEvent
                        ? `Next: ${nextEvent}${usMkt ? ` · US mkt ${usMkt}` : ''}`
                        : `Macro calendar${usMkt ? ` · US mkt ${usMkt}` : ''}`
                    case 'flows':
                      return `On-chain flows · BTC ${pctFmt(btc.change)} · vol live`
                    case 'wallets':
                      return `Smart-money · BTC ${priceFmt(btc.price)} · ${fg}`
                    default:
                      return briefDisplay || `BTC ${priceFmt(btc.price)} ${pctFmt(btc.change)} · ${fg}`
                  }
                })()
                return (
                <button
                  type="button"
                  className="cc-collapsed-preview"
                  onClick={() => setCommandCenterOpen(true)}
                  aria-label={t('welcome.expandCommandCenter', 'Expand command center')}
                >
                  <span className="cc-collapsed-preview-icon" aria-hidden>{marketAiTabIcons[marketAiTab]}</span>
                  <span className="cc-collapsed-preview-label">{(marketAiTabs.find(tt => tt.id === marketAiTab) || {}).label || 'Brief'}</span>
                  <span className="cc-collapsed-preview-divider" aria-hidden>·</span>
                  <span className="cc-collapsed-preview-summary">{tabSummary}</span>
                  {/* Watchlist preview tiles — render here when the unit is collapsed so the
                      bottom row stays a single seamless strip instead of two stacked widgets. */}
                  {(() => {
                    const wlTiles = (watchlist || []).slice(0, 8)
                    if (!wlTiles.length) return null
                    return (
                      <span
                        className="cc-collapsed-preview-watchlist"
                        onClick={(e) => { e.stopPropagation() /* let the parent expand */ }}
                        aria-hidden
                      >
                        {wlTiles.map((token) => {
                          const live = topCoinPrices?.[token.symbol]
                          const change = Number(live?.change ?? token.change) || 0
                          return (
                            <span
                              key={token.address || token.symbol}
                              className={`cc-collapsed-preview-tile ${change >= 0 ? 'positive' : 'negative'}`}
                              data-tooltip={`${token.symbol} ${change >= 0 ? '+' : ''}${(Number(token.change ?? change) || 0).toFixed(2)}%`}
                            >
                              {(token.logo || TOKEN_LOGOS[token.symbol]) ? (
                                <img src={token.logo || TOKEN_LOGOS[token.symbol]} alt={token.symbol} loading="lazy" decoding="async" width="32" height="32" />
                              ) : (
                                <span className="cc-collapsed-preview-tile-fallback">{token.symbol?.[0] || '?'}</span>
                              )}
                            </span>
                          )
                        })}
                      </span>
                    )
                  })()}
                  <span className="cc-collapsed-preview-cta">{t('welcome.expand', 'Expand')}</span>
                </button>
                )
              })()}
              <div className="welcome-market-ai-content">
                <Suspense fallback={null}>
                {/* ── AI Brief tab ── */}
                {marketAiTab === 'brief' && (
                  <BriefTabContent
                    briefPausedRef={briefPausedRef}
                    handleBriefTouchStart={handleBriefTouchStart}
                    handleBriefTouchEnd={handleBriefTouchEnd}
                    briefDisplay={briefDisplay}
                    briefFading={briefFading}
                    terminalIsFullBrief={terminalIsFullBrief}
                    allBriefStatements={allBriefStatements}
                    briefLabels={briefLabels}
                    outlookIndex={outlookIndex}
                    briefIndex={briefIndex}
                    goToBrief={goToBrief}
                    getTerminalBriefInterval={getTerminalBriefInterval}
                    topCoinPrices={topCoinPrices}
                    stockPrices={stockPrices}
                    macroAnalysisData={macroAnalysisData}
                    fearGreed={fearGreed}
                    liveVix={liveVix}
                    marketStructureTrio={marketStructureTrio}
                    sentimentRgb={sentimentRgb}
                    biasRgb={biasRgb}
                    isStocks={isStocks}
                    t={t}
                  />
                )}

                {marketAiTab === 'analysis' && (
                  macroAnalysisData
                    ? <AiMarketPanel macroAnalysisData={macroAnalysisData} marketStructureTrio={marketStructureTrio} marketAiTimeframe={marketAiTimeframe} setMarketAiTimeframe={setMarketAiTimeframe} breakingHeadlines={isStocks ? stockContextNews : breakingHeadlines} isStocks={isStocks} />
                    : <div className="welcome-market-ai-analysis-full"><div className="ai-mkt-loading"><div className="ai-mkt-loading-pulse" /><span>{t('ui.analyzingMarketData')}</span></div></div>
                )}
                {marketAiTab === 'earnings' && <EarningsTabPanel t={t} />}
                {marketAiTab === 'news' && (
                  <NewsTabPanel newsXToggle={false} setNewsXToggle={setNewsXToggle} newsItems={newsItems} newsLoading={newsLoading} isStocks={isStocks} t={t} xPosts={xPosts} xPostsLoading={xPostsLoading} xPostsError={xPostsError} onRetryXPosts={refetchXPosts} onSelectNewsDetail={setNewsDetail} hideToggle />
                )}
                {marketAiTab === 'posts' && (
                  <NewsTabPanel newsXToggle={true} setNewsXToggle={setNewsXToggle} newsItems={newsItems} newsLoading={newsLoading} isStocks={isStocks} t={t} xPosts={xPosts} xPostsLoading={xPostsLoading} xPostsError={xPostsError} onRetryXPosts={refetchXPosts} onSelectNewsDetail={setNewsDetail} hideToggle />
                )}
                {marketAiTab === 'heatmaps' && (
                  <HeatmapCommandPanel
                    heatmapTokens={effectiveHeatmapTokens}
                    topCoinsTokens={topCoinsTokens}
                    topCoinPrices={topCoinPrices}
                    fmtPrice={fmtPrice}
                    openTokenCardPopup={openTokenCardPopup}
                    isStocks={isStocks}
                    dayMode={dayMode}
                    showBubbles={heatmapsBubblesToggle}
                    onToggleBubbles={setHeatmapsBubblesToggle}
                    onOpenFull={() => navigate(heatmapsBubblesToggle ? '/bubbles' : '/heatmaps')}
                  />
                )}
                {marketAiTab === 'liquidation' && (
                <Suspense fallback={null}>
                  {/* dayMode drives BOTH the CSS chrome (.lhp--day) and the canvas
                      renderer (dark={!dayMode}) — omitting it left the console
                      dark-on-dark under a light plate. */}
                  <LiqHeatmapPanel symbol={liqSymbol} setSymbol={setLiqSymbol} enabled dayMode={dayMode} fmtPrice={fmtPrice} height={440} />
                </Suspense>
              )}
                {marketAiTab === 'sector' && (
                  <SectorsTabPanel onOpenResearchZone={(tokenData) => { sessionStorage.setItem('spectre-cc-return-tab', 'sector'); if (onOpenResearchZone) onOpenResearchZone(tokenData); }} onOpenAIScreener={(tokenData) => { sessionStorage.setItem('spectre-cc-return-tab', 'sector'); if (onOpenAIScreener) onOpenAIScreener(tokenData); }} topCoinPrices={topCoinPrices} />
                )}
                {marketAiTab === 'mindshare' && (
                  <MindshareTabPanel topCoinPrices={topCoinPrices} onOpenResearchZone={onOpenResearchZone} onOpenAIScreener={onOpenAIScreener} onPageChange={onPageChange} />
                )}
                {marketAiTab === 'calendar' && <CalendarMiniPanel />}
                {marketAiTab === 'flows' && <EtfFlowsView compact />}
                {marketAiTab === 'wallets' && <WalletsTabPanel />}
                {marketAiTab === 'others' && <OthersTabPanel fmtLarge={fmtLarge} />}
                {marketAiTab === 'podcasts' && <PodcastsTabPanel />}
                </Suspense>
              </div>
            </div>

            {/* Watchlist Panel */}
            <InlineWatchlistPanel
                watchlistOpen={watchlistOpen} setWatchlistOpen={setWatchlistOpen}
                watchlistSearchQuery={watchlistSearchQuery} setWatchlistSearchQuery={setWatchlistSearchQuery}
                watchlistSearchLoading={watchlistSearchLoading} watchlistSearchResults={watchlistSearchResults}
                watchlistSearchContainerRef2={watchlistSearchContainerRef2}
                watchlist={watchlist} watchlistWithLiveData={watchlistWithLiveData} sortedWatchlist={sortedWatchlist}
                addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist} togglePinWatchlist={togglePinWatchlist}
                openTokenCardPopup={openTokenCardPopup} handleStockClick={handleStockClick} onPageChange={onPageChange}
                fmtPrice={fmtPrice} fmtLarge={fmtLarge} EMPTY_STYLE={EMPTY_STYLE} isStocks={isStocks} t={t}
                reorderWatchlist={reorderWatchlist} getSortedWatchlist={getSortedWatchlist}
                topCoinPrices={topCoinPrices} topCoins={TOP_COINS}
                stockList={isStocks ? filteredTopCoins : null}
              />
          </div>
        </div>
      )}

      {/* Top Coins | On-Chain (crypto only) | Prediction Markets – congruent line above table */}
      {!isMobile && (
      <div className={`wsec wsec--topcoins${topCoinsOpen ? '' : ' wsec--closed'}`}>
      <div className="wsec-collapse">
      <div className="wsec-collapse-inner">
      <div id="top-coins" className="welcome-topcoins-header-row" data-tour="discovery">
        <nav className="welcome-topcoins-tabs" aria-label={t('welcome.marketSectionsAria', 'Market sections')}>
          <button
            type="button"
            className={`welcome-topcoins-watchlist-star${discoveryShowWatchlist ? ' active' : ''}`}
            onClick={() => setDiscoveryShowWatchlist((prev) => !prev)}
            aria-label={discoveryShowWatchlist ? 'Show all tokens' : 'Show watchlist'}
            aria-pressed={discoveryShowWatchlist}
            data-tooltip={discoveryShowWatchlist ? 'Show all tokens' : 'Show watchlist'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill={discoveryShowWatchlist ? '#F59E0B' : 'none'} stroke={discoveryShowWatchlist ? '#F59E0B' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button
            type="button"
            className={`welcome-topcoins-header-tab ${topSectionTab === 'topcoins' ? 'active' : ''}`}
            onClick={() => {
              setChartPanelToken(null)
              setTopSectionTab('topcoins')
            }}
          >
            {isStocks ? t('topSection.stocksCommodities') : t('topSection.topCoins')}
          </button>
          {!isStocks && (
            <button
              type="button"
              className={`welcome-topcoins-header-tab ${topSectionTab === 'onchain' ? 'active' : ''}`}
              onClick={() => {
                setChartPanelToken(null)
                setTopSectionTab('onchain')
              }}
            >
              {t('topSection.onChain')}
            </button>
          )}
          <button
            type="button"
            className={`welcome-topcoins-header-tab ${topSectionTab === 'predictions' ? 'active' : ''}`}
            onClick={() => {
              setChartPanelToken(null)
              setTopSectionTab('predictions')
            }}
          >
            {t('topSection.predictionMarkets')}
          </button>
          {!isStocks && (
            <button
              type="button"
              className={`welcome-topcoins-header-tab ${topSectionTab === 'social' ? 'active' : ''} ${isShowcaseEmbed ? 'tab-locked' : ''}`}
              aria-disabled={isShowcaseEmbed || undefined}
              title={isShowcaseEmbed ? 'Available in Beta - not in preview' : undefined}
              onClick={() => {
                if (isShowcaseEmbed) return
                setChartPanelToken(null)
                setTopSectionTab('social')
              }}
              data-tooltip={isShowcaseEmbed ? undefined : 'Real-time X mentions across crypto'}
            >
              {t('topSection.social', 'Social')}
              {isShowcaseEmbed && (
                <svg className="tab-lock-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              )}
            </button>
          )}
          {!isStocks && (
            <button
              type="button"
              className={`welcome-topcoins-header-tab ${topSectionTab === 'aiagents' ? 'active' : ''} ${isShowcaseEmbed ? 'tab-locked' : ''}`}
              aria-disabled={isShowcaseEmbed || undefined}
              title={isShowcaseEmbed ? 'Available in Beta' : undefined}
              onClick={() => {
                if (isShowcaseEmbed) return
                setChartPanelToken(null)
                setTopSectionTab('aiagents')
              }}
            >
              AI Agents
              {isShowcaseEmbed && (
                <svg className="tab-lock-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              )}
            </button>
          )}
          {!isStocks && (
            <button
              type="button"
              className={`welcome-topcoins-header-tab ${topSectionTab === 'aimodels' ? 'active' : ''} ${isShowcaseEmbed ? 'tab-locked' : ''}`}
              aria-disabled={isShowcaseEmbed || undefined}
              title={isShowcaseEmbed ? 'Available in Beta' : undefined}
              onClick={() => {
                if (isShowcaseEmbed) return
                setChartPanelToken(null)
                setTopSectionTab('aimodels')
              }}
            >
              AI Models
              {isShowcaseEmbed && (
                <svg className="tab-lock-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              )}
            </button>
          )}
          {!isStocks && (
            <button
              type="button"
              className={`welcome-topcoins-header-tab warroom-tab-btn ${topSectionTab === 'warroom' ? 'active' : ''} ${isShowcaseEmbed ? 'tab-locked' : ''}`}
              aria-disabled={isShowcaseEmbed || undefined}
              title={isShowcaseEmbed ? 'Available in Beta' : undefined}
              onClick={() => {
                if (isShowcaseEmbed) return
                setChartPanelToken(null)
                setTopSectionTab('warroom')
              }}
            >
              Market Summary
              {isShowcaseEmbed && (
                <svg className="tab-lock-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              )}
            </button>
          )}
        </nav>
        <button
          type="button"
          className="discovery-fullview-btn"
          onClick={() => setDiscoveryFullViewOpen(true)}
          data-tooltip="Full View"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
        <WelcomeSectionToggle
          open={topCoinsOpen}
          label={t('welcome.sectionTopCoins', 'markets')}
          onToggle={() => toggleWelcomeSection(WELCOME_SECTIONS.topCoins)}
        />
      </div>

      {/* Discovery block (extracted component) — lazy because 2284 LOC, off-viewport on cold mount */}
      <Suspense fallback={<div className="welcome-discovery-loading" aria-hidden="true" />}>
      <DiscoverySection
        {...{
          tabsOn, setTabsOn,
          activeDiscoverTab, setActiveDiscoverTab,
          chartPanelToken, setChartPanelToken,
          topSectionTab, setTopSectionTab,
          categoryFilter, setCategoryFilter,
          topCoinsChain, setTopCoinsChain,
          topCoinsRanges, setTopCoinsRanges,
          timeframeFilter, setTimeframeFilter,
          predictionsCategoryFilter, setPredictionsCategoryFilter,
          onChainChainFilter, setOnChainChainFilter,
          onChainRankBy, setOnChainRankBy,
          onChainViewMode, setOnChainViewMode,
          viewMode, setViewMode,
          topCoinsLoading,
          onChainLoading,
          loading,
          compareMode, setCompareMode,
          topCoinsPage, setTopCoinsPage,
          chartOverlayTimeframe, setChartOverlayTimeframe,
          chartOverlaySubTab, setChartOverlaySubTab,
          chartOverlayYAxis, setChartOverlayYAxis,
          chartFullscreen, setChartFullscreen,
          openTokenTabs,
          filteredOnChain,
          filteredPredictions, predictionsLoading,
          filteredAiAgents,
          filteredAiModels,
          aiAgentCategoryFilter, setAiAgentCategoryFilter,
          aiAgentSortBy, setAiAgentSortBy,
          aiAgentSortDir, setAiAgentSortDir,
          aiModelCategoryFilter, setAiModelCategoryFilter,
          aiModelProviderFilter, setAiModelProviderFilter,
          aiModelViewMode, setAiModelViewMode,
          aiModelSortBy, setAiModelSortBy,
          aiModelSortDir, setAiModelSortDir,
          aiModelQualityFilter, setAiModelQualityFilter,
          aiModelEloTrends: AI_MODEL_ELO_TRENDS,
          tokens,
          filteredTopCoins,
          topCoinPrices,
          compareTokens,
          binancePrices,
          openTokenCardPopup,
          openChartOnly,
          removeTokenTab,
          clearAllTabs,
          handleOnChainCoinClick,
          handleTopCoinClick,
          handleStockClick,
          toggleCompareToken,
          isTokenSelected,
          openTopCoinInfo,
          checkIsInWatchlist,
          addToWatchlist,
          removeFromWatchlist,
          renderChartPanel,
          exitCompareMode,
          selectToken,
          onPageChange,
          getTradingViewSymbol,
          OVERLAY_TIMEFRAMES,
          fmtPrice, fmtLarge,
          icons,
          TRANSLATED_STOCK_SECTORS,
          CATEGORY_TABS,
          MORE_CATEGORY_TABS,
          timeframes,
          TOTAL_TOP_COINS_PAGES,
          TOP_COINS_PAGE_SIZE,
          TOP_COINS_PAGE_SIZE_OPTIONS,
          topCoinsPageSize,
          setTopCoinsPageSize,
          hasMorePages,
          totalCategoryPages,
          loadNextTopCoinsPage,
          jumpToTopCoinsPage,
          EMPTY_STYLE,
          isMobile, isStocks, discoverOnly,
          t,
          fearGreed,
          watchlist,
          showWatchlist: discoveryShowWatchlist,
          watchlistWithLiveData,
        }}
      />
      </Suspense>
      </div>
      </div>
      {!topCoinsOpen && (
        <WelcomeSectionBar
          label={isStocks ? t('topSection.stocksCommodities') : t('topSection.topCoins')}
          hint={t('welcome.sectionTopCoinsHint', 'Markets table')}
          onOpen={() => toggleWelcomeSection(WELCOME_SECTIONS.topCoins)}
        />
      )}
      </div>
      )}

      {/* Compare Floating Bar (extracted) */}
      {compareMode && (
        <CompareBar
          compareTokens={compareTokens}
          toggleCompareToken={toggleCompareToken}
          exitCompareMode={exitCompareMode}
          openCompareModal={openCompareModal}
          icons={icons}
        />
      )}

      {/* Compare Modal (extracted) */}
      {showCompareModal && (
        <CompareModal
          compareTokens={compareTokens}
          closeCompareModal={closeCompareModal}
          exitCompareMode={exitCompareMode}
          handleSelectToken={handleSelectToken}
          fmtLarge={fmtLarge}
          icons={icons}
        />
      )}

      {/* 3-card token popup (extracted component) */}
      <TokenCardPopup
        popup={tokenCardPopup}
        topCoinPrices={topCoinPrices}
        dayMode={dayMode}
        fmtPrice={fmtPrice}
        fmtLarge={fmtLarge}
        expandedCard={tokenCardExpandedCard}
        setExpandedCard={setTokenCardExpandedCard}
        onClose={closeTokenCardPopup}
        onViewDetails={(popup) => { closeTokenCardPopup(); if (onOpenResearchZone) onOpenResearchZone(popup); else handleSelectToken(popup); }}
      />
      <ProductTour
        isActive={tourActive}
        currentStep={tourStep}
        onNext={() => {
          setTourStep((s) => {
            if (s < 6) return s + 1
            setTourActive(false)
            return 0
          })
        }}
        onBack={() => setTourStep((s) => (s > 0 ? s - 1 : 0))}
        onSkip={() => setTourActive(false)}
        dayMode={dayMode}
      />
      {/* ── Command Center Full View (portaled like Bubbles) ── */}
      {briefFullViewOpen && (
      <Suspense fallback={null}>
      <CCFullViewOverlay
        briefFullViewOpen={briefFullViewOpen} setBriefFullViewOpen={setBriefFullViewOpen}
        fullViewTab={fullViewTab} setFullViewTab={setFullViewTab} setMarketAiTab={setMarketAiTab}
        handleShareBrief={handleShareBrief} isBriefShareExporting={isBriefShareExporting}
        briefPausedRef={briefPausedRef} handleBriefTouchStart={handleBriefTouchStart}
        handleBriefTouchEnd={handleBriefTouchEnd} briefDisplay={briefDisplay}
        briefFading={briefFading} terminalIsFullBrief={terminalIsFullBrief}
        allBriefStatements={allBriefStatements} briefLabels={briefLabels} outlookIndex={outlookIndex} briefIndex={briefIndex}
        goToBrief={goToBrief} getTerminalBriefInterval={getTerminalBriefInterval}
        topCoinPrices={topCoinPrices} stockPrices={stockPrices}
        macroAnalysisData={macroAnalysisData} fearGreed={fearGreed}
        liveVix={liveVix} marketStructureTrio={marketStructureTrio}
        marketFlowSummary={marketFlowSummary}
        sentimentRgb={sentimentRgb} biasRgb={biasRgb}
        isStocks={isStocks} dayMode={dayMode} t={t}
        // Analysis tab
        marketAiTimeframe={marketAiTimeframe} setMarketAiTimeframe={setMarketAiTimeframe}
        // News tab
        newsXToggle={newsXToggle} setNewsXToggle={setNewsXToggle}
        newsItems={newsItems} newsLoading={newsLoading}
        xPosts={xPosts} xPostsLoading={xPostsLoading} xPostsError={xPostsError} onRetryXPosts={refetchXPosts}
        // Heatmaps tab
        heatmapTokens={effectiveHeatmapTokens} topCoinsTokens={topCoinsTokens}
        fmtPrice={fmtPrice} openTokenCardPopup={openTokenCardPopup}
        heatmapsBubblesToggle={heatmapsBubblesToggle} setHeatmapsBubblesToggle={setHeatmapsBubblesToggle}
        // Liquidation tab - same symbol state as the inline LiqHeatmapPanel
        liqProps={{ symbol: liqSymbol, setSymbol: setLiqSymbol }}
        // Mindshare tab needs intel timestamps; Sectors panel fetches its own data
        intelLastUpdated={intel.lastUpdated}
      />
      </Suspense>
      )}
      {/* ── Discovery Full View (portaled to body like CC) — desktop only ── */}
      {discoveryFullViewOpen && !isMobile && createPortal(
        <div className={`discovery-fullview-overlay${dayMode ? ' day-mode' : ''}`} onClick={() => setDiscoveryFullViewOpen(false)}>
          <div className="discovery-fullview-widget" onClick={e => e.stopPropagation()}>
            <div className="discovery-fullview-header">
              <div className="discovery-fullview-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                {tr('homePage.welcomePage.welcomepage.discover', "Discover")}
              </div>
              <nav className="discovery-fullview-tabs">
                {[
                  { id: 'topcoins', label: isStocks ? t('topSection.stocksCommodities') : t('topSection.topCoins') },
                  ...(!isStocks ? [{ id: 'onchain', label: t('topSection.onChain') }] : []),
                  { id: 'predictions', label: t('topSection.predictionMarkets') },
                  ...(!isStocks ? [
                    { id: 'social', label: t('topSection.social', 'Social') },
                    { id: 'aiagents', label: t('topSection.aiAgents', 'AI Agents') },
                    { id: 'aimodels', label: t('topSection.aiModels', 'AI Models') },
                    { id: 'warroom', label: t('topSection.marketSummary', 'Market Summary') },
                  ] : []),
                ].map(tab => {
                  const tabLocked = isShowcaseEmbed && (tab.id === 'aiagents' || tab.id === 'aimodels' || tab.id === 'social' || tab.id === 'warroom')
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`welcome-topcoins-header-tab ${topSectionTab === tab.id ? 'active' : ''} ${tabLocked ? 'tab-locked' : ''}`}
                      aria-disabled={tabLocked || undefined}
                      title={tabLocked ? 'Available in Beta' : undefined}
                      onClick={() => { if (tabLocked) return; setChartPanelToken(null); setTopSectionTab(tab.id) }}
                    >
                      {tab.label}
                      {tabLocked && (
                        <svg className="tab-lock-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </nav>
              <button
                type="button"
                className={`discovery-fullview-theme-toggle${dayMode ? ' is-day' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleDayMode() }}
                data-tooltip={dayMode ? 'Switch to Dark' : 'Switch to Light'}
              >
                {dayMode
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                }
              </button>
              <button
                type="button"
                className="discovery-fullview-close"
                onClick={() => setDiscoveryFullViewOpen(false)}
                data-tooltip="Close (Esc)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="discovery-fullview-body">
              <DiscoverySection
                {...{
                  tabsOn, setTabsOn,
                  activeDiscoverTab, setActiveDiscoverTab,
                  chartPanelToken, setChartPanelToken,
                  topSectionTab, setTopSectionTab,
                  categoryFilter, setCategoryFilter,
                  topCoinsChain, setTopCoinsChain,
                  topCoinsRanges, setTopCoinsRanges,
                  timeframeFilter, setTimeframeFilter,
                  predictionsCategoryFilter, setPredictionsCategoryFilter,
                  onChainChainFilter, setOnChainChainFilter,
                  onChainRankBy, setOnChainRankBy,
                  onChainViewMode, setOnChainViewMode,
                  viewMode, setViewMode,
                  topCoinsLoading,
                  onChainLoading,
                  loading,
                  compareMode, setCompareMode,
                  topCoinsPage, setTopCoinsPage,
                  chartOverlayTimeframe, setChartOverlayTimeframe,
                  chartOverlaySubTab, setChartOverlaySubTab,
                  chartOverlayYAxis, setChartOverlayYAxis,
                  chartFullscreen, setChartFullscreen,
                  openTokenTabs,
                  filteredOnChain,
                  filteredPredictions, predictionsLoading,
                  filteredAiAgents,
                  filteredAiModels,
                  aiAgentCategoryFilter, setAiAgentCategoryFilter,
                  aiAgentSortBy, setAiAgentSortBy,
                  aiAgentSortDir, setAiAgentSortDir,
                  aiModelCategoryFilter, setAiModelCategoryFilter,
                  aiModelProviderFilter, setAiModelProviderFilter,
                  aiModelViewMode, setAiModelViewMode,
                  aiModelSortBy, setAiModelSortBy,
                  aiModelSortDir, setAiModelSortDir,
                  aiModelQualityFilter, setAiModelQualityFilter,
                  aiModelEloTrends: AI_MODEL_ELO_TRENDS,
                  tokens,
                  filteredTopCoins,
                  topCoinPrices,
                  compareTokens,
                  binancePrices,
                  openTokenCardPopup,
                  openChartOnly,
                  removeTokenTab,
                  clearAllTabs,
                  handleOnChainCoinClick,
                  handleTopCoinClick,
                  handleStockClick,
                  toggleCompareToken,
                  isTokenSelected,
                  openTopCoinInfo,
                  checkIsInWatchlist,
                  addToWatchlist,
                  removeFromWatchlist,
                  renderChartPanel,
                  exitCompareMode,
                  selectToken,
                  onPageChange,
                  getTradingViewSymbol,
                  OVERLAY_TIMEFRAMES,
                  fmtPrice, fmtLarge,
                  icons,
                  TRANSLATED_STOCK_SECTORS,
                  CATEGORY_TABS,
                  MORE_CATEGORY_TABS,
                  timeframes,
                  TOTAL_TOP_COINS_PAGES,
                  TOP_COINS_PAGE_SIZE,
                  TOP_COINS_PAGE_SIZE_OPTIONS,
                  topCoinsPageSize,
                  setTopCoinsPageSize,
                  hasMorePages,
                  totalCategoryPages,
                  loadNextTopCoinsPage,
                  jumpToTopCoinsPage,
                  EMPTY_STYLE,
                  isMobile, isStocks, discoverOnly,
                  t,
                  showWatchlist: discoveryShowWatchlist,
                  watchlistWithLiveData,
                }}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
      {(briefShareModalOpen || welcomeShareModalOpen) && (
      <Suspense fallback={null}>
      {briefShareModalOpen && (
        <ShareXModal
          open={briefShareModalOpen}
          onClose={() => { setBriefShareModalOpen(false); setBriefShareImageUrl(null) }}
          imageUrl={briefShareImageUrl}
          defaultDescription={briefShareDescription}
          filename={`spectre_ai_brief_${(['sentiment','session','narrative','psychology','macro','outlook'][briefIndex] || 'brief')}.png`}
        />
      )}
      {welcomeShareModalOpen && (
        <ShareXModal
          open={welcomeShareModalOpen}
          onClose={() => { setWelcomeShareModalOpen(false); setWelcomeShareImageUrl(null) }}
          imageUrl={welcomeShareImageUrl}
          defaultDescription={welcomeShareDescription}
          filename="spectre_market_overview.png"
        />
      )}
      </Suspense>
      )}

      {/* Bitcoin Dominance Chart — opens when clicking dominance bar */}
      {showDominanceChart && (
        <Suspense fallback={null}>
          <DominanceChart
            onClose={() => setShowDominanceChart(false)}
            dayMode={dayMode}
            currentDominance={marketDominance}
          />
        </Suspense>
      )}

      {/* News / Tweet detail — fixed right drawer overlay */}
      {newsDetail && (
        <NewsDetailPanel detail={newsDetail} onClose={() => setNewsDetail(null)} allNews={newsItems} allTweets={xPosts} onSelect={setNewsDetail} />
      )}
    </div>
  )
}

export default WelcomePage
