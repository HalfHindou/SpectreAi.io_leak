import { Suspense, useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import RouteFallback from '@/components/route-fallback'
import ParticleBackground from '@/components/particle-background'
import SideDrawer from '@/components/side-drawer'
import MobilePreviewFrame from '@/components/mobile-preview-frame'
import MonarchFAB from '@/components/monarch/monarch-fab'
// PR-2 (perf): MiniChat renders only after the FAB click, but its static
// import chained monarch-dashboard -> recharts (118KB gz) into the entry
// chunk. Lazy keeps recharts off the boot critical path entirely.
import lazyWithRetry from '@/lib/lazy-with-retry'
const MonarchMiniChat = lazyWithRetry(() => import('@/components/monarch/monarch-mini-chat'))
// PR (perf, 2026-06-11): the mobile chrome (header, bottom nav, search overlay,
// mission control, settings panel — ~62KB) was statically imported on EVERY
// device, including desktop where it never renders. Lazy-load it; the
// `{isMobile && ...}` branches below gate the mount, so desktop never fetches
// these chunks, and a desktop->narrow resize mounts them on demand (useIsMobile
// flips via matchMedia). Suspense fallback is null — mobile first paint isn't
// degraded since these load in parallel with the route chunk.
const NavigationSidebar = lazyWithRetry(() => import('@/components/navigation-sidebar'))
const Header = lazyWithRetry(() => import('@/components/header'))
const MobileHeader = lazyWithRetry(() => import('@/components/mobile-header'))
const MobileBottomNav = lazyWithRetry(() => import('@/components/mobile-bottom-nav'))
// Tiny and only ever rendered after a deploy swap, but it must not sit on the
// boot path — it is chrome for an event that has not happened yet.
const AppUpdateBar = lazyWithRetry(() => import('@/components/app-update-bar'))
const MissionControlSheet = lazyWithRetry(() => import('@/components/mission-control-sheet'))
const MobileSettingsPanel = lazyWithRetry(() => import('@/components/mobile-settings-panel'))
const MobileSearchOverlay = lazyWithRetry(() => import('@/components/mobile-search-overlay'))
// Global welcome tour - lazy so GuidedTour + its CSS stay off the boot chunk.
const AppTour = lazyWithRetry(() => import('@/components/onboarding/app-tour'))
// App-wide podcast playback. Lazy + mount-gated on an episode existing, so the
// player and its CSS cost nothing until someone actually presses play.
const PodcastPlayer = lazyWithRetry(() => import('@/components/podcast/podcast-player'))
// Video mini player + Spotify dock. Same reason they are here and not in the
// media-center route: a page-local mount dies on navigation.
const MediaMiniPlayer = lazyWithRetry(() => import('@/pages/media-center/components/mini-player'))
const SpotifyDock = lazyWithRetry(() => import('@/pages/media-center/components/spotify-modal'))

// 🪤 The comment above claims the mobile chrome "loads in parallel with the
// route chunk". It does not: `React.lazy` starts a fetch when the component
// first RENDERS, and main.jsx prefetches the ROUTE at entry-eval — so the route
// gets a head start and the chrome queues behind it. Measured on the prod
// build at 390px, warm SW, slow-3G: `.mobile-bottom-nav` did not exist until
// 6411ms, i.e. 3.7s after the boot skeleton had already gone — the bottom bar
// popped in under a page the user was reading.
//
// The two bars ALWAYS render on their breakpoint and are 3.6KB gz each, so the
// only reason they were late is WHEN the request starts. This module is part of
// the entry chunk, so kicking the import here starts it at entry-eval, next to
// the route prefetch, instead of one React commit later. Viewport-matched so
// neither breakpoint downloads the other's chrome (the whole point of the PR
// above); the `lazyWithRetry` components then resolve against a warm module
// cache. Errors are swallowed — this is a warm-up, and the real mount below
// still owns retry + stale-deploy recovery.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    if (window.matchMedia('(max-width: 768px)').matches) {
      import('@/components/mobile-header')
      import('@/components/mobile-bottom-nav')
    } else {
      import('@/components/navigation-sidebar')
      import('@/components/header')
    }
  } catch { /* warm-up only, never break boot */ }
}
// The three mobile overlays mount on FIRST OPEN (the *EverOpened refs below) so
// their chunks + service trees stay off the boot path — but that turned the
// first tap on the launcher/search/settings into a dead beat: chunk fetch +
// compile with nothing on screen (fallback is null). Warm them at idle after
// load, staggered, so the module cache is hot by the time a human reaches for
// them while boot itself stays exactly as lean as the mount-gating made it.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px)').matches) {
  const warmOverlays = () => {
    // Mobile-only warmers, so the slow-connection case is the common one here.
    if (!shouldPrefetch()) return
    ;[
      () => import('@/components/mission-control-sheet'),
      () => import('@/components/mobile-search-overlay'),
      () => import('@/components/mobile-settings-panel'),
    ].forEach((imp, i) => {
      setTimeout(() => { imp().catch(() => {}) }, i * 400)
    })
  }
  const scheduleOverlayWarm = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warmOverlays, { timeout: 6000 })
    else setTimeout(warmOverlays, 3000)
  }
  if (document.readyState === 'complete') setTimeout(scheduleOverlayWarm, 2000)
  else window.addEventListener('load', () => setTimeout(scheduleOverlayWarm, 2000), { once: true })
}
import { useAppState } from '@/contexts/AppStateContext'
import useSettingsStore from '@/store/useSettingsStore'
import useMediaStore from '@/store/useMediaStore'
// PRO Theme Studio is OPT-IN, so it must not sit on the boot path. Statically
// imported it cost +25KB raw JS and dragged 30KB of skin CSS into the
// RENDER-BLOCKING boot stylesheet (+43KB raw / +11KB gzip total) - paid by
// every user on every cold load, including everyone who never opens Themes.
// Both lazies resolve to the SAME module, so Vite emits one chunk and the
// browser makes one request.
const ProThemeStudio = lazyWithRetry(() => import('@/components/pro-theme/pro-theme-studio'))
const ProThemeBackdrop = lazyWithRetry(() =>
  import('@/components/pro-theme/pro-theme-studio').then((m) => ({ default: m.ProThemeBackdrop }))
)
// Boot-safe: the hook itself is tiny and imports the catalog only on demand.
import useProThemeSkin from '@/components/pro-theme/use-pro-theme-skin'
import { useMonarchShell } from '@/contexts/MonarchContext'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import { useCopyToast } from '@/contexts/CopyToastContext'
import { useCurrency } from '@/hooks/useCurrency'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { MobilePreviewContext } from '@/contexts/MobilePreviewContext'
import { getPageIdFromPath, getPathForPageId, isTokenPath } from '@/constants/pageRoutes'
import { getAppTourStepIds } from '@/components/onboarding/app-tour-steps'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { lookupCgByContract } from '@/lib/cg-contract-lookup'
import { openTradingTerminal } from '@/lib/trading-terminal'
import useNotificationPoller from '@/hooks/useNotificationPoller'
import { useNotificationToasts, ToastStack } from '@/components/notification-toast'
import { SocialDossierSlideIn } from '@/components/social-dossiers/use-social-dossier'
import useUsMarketStatus from '@/pages/home/components/use-us-market-status'
import { detectShowcaseEmbed, isShowcasePathAllowed, fireShowcaseLockToast } from '@/App'
import { shouldPrefetch } from '@/lib/should-prefetch'

// Demo mode - allowed routes when loaded via website2 iframe (?demo=true)
// Gray list (not here): GM dashboard, Pulse, Trading — those surfaces are
// explicitly withheld from the public demo and should not appear in the app
// nav when demo mode is active.
const DEMO_ALLOWED_PAGES = new Set([
  'research-platform', // home/landing
  'research-zone',
  'heatmaps',
  'bubbles',
  'search-engine',
  'monarch-ai-chat',
  'monarch-chat',
  'fear-greed',
  'economic-calendar',
  'categories',
  'news',
])

function isDemoModeActive() {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('demo') === 'true'
  } catch { return false }
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [demoMode] = useState(isDemoModeActive)
  const [comingSoonToast, setComingSoonToast] = useState(null)

  // Live notification poller — fetches from data API, triggers toast popups
  // that pop on any page, so it stays at AppShell scope. Desktop-only: the bell
  // is hidden on mobile, so the poll + toasts are gated off there too (mobile
  // web AND iOS-homescreen PWA — both are isMobile).
  const { toasts, addToast, removeToast } = useNotificationToasts()
  useNotificationPoller(addToast, { enabled: !isMobile })

  const {
    token, selectToken, defaultToken,
    setResearchZoneToken,
  } = useAppState()

  // Settings from Zustand
  // Gate for the app-wide podcast player: true from the moment an episode is
  // loaded until it is stopped, across every route.
  const podcastActive = useMediaStore((s) => !!s.podcastEpisode)
  const miniPlayerOpen = useMediaStore((s) => s.miniPlayerOpen)
  const theaterOpen = useMediaStore((s) => s.theaterOpen)
  const spotifyShow = useMediaStore((s) => s.spotifyShow)

  // Theater is a full-screen video overlay and stays owned by the media route.
  // Navigating away collapses it to the (now global) mini player, so leaving
  // the page hands playback off instead of dropping it on the floor.
  const pathname = location.pathname
  useEffect(() => {
    const media = useMediaStore.getState()
    if (media.theaterOpen) media.closeTheater()
  }, [pathname])
  const dayMode = useSettingsStore((s) => s.dayMode)
  const setDayMode = useSettingsStore((s) => s.setDayMode)
  // The switch's action, not the raw setter: under a PRO theme it moves the
  // LOOK so the sync effect below can't immediately undo the user. The sync
  // itself must keep using the raw `setDayMode` or the two would loop.
  const requestDayMode = useSettingsStore((s) => s.requestDayMode)
  const appDisplayMode = useSettingsStore((s) => s.appDisplayMode)
  const setAppDisplayMode = useSettingsStore((s) => s.setAppDisplayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const setMarketMode = useSettingsStore((s) => s.setMarketMode)
  const tokenColoring = useSettingsStore((s) => s.tokenColoring)
  const setTokenColoring = useSettingsStore((s) => s.setTokenColoring)
  const showMoodWall = useSettingsStore((s) => s.showMoodWall)
  const setShowMoodWall = useSettingsStore((s) => s.setShowMoodWall)
  const profile = useSettingsStore((s) => s.profile)
  const setProfile = useSettingsStore((s) => s.setProfile)
  const navSidebarCollapsed = useSettingsStore((s) => s.navSidebarCollapsed)
  const setNavSidebarCollapsed = useSettingsStore((s) => s.setNavSidebarCollapsed)

  const { currency, setCurrency, language, setLanguage } = useCurrency()
  const usMarketStatus = useUsMarketStatus()
  // Shell-only Monarch subscription: chatOpen + toggleChat. Reading from
  // useMonarchShell() (not useMonarch()) means AppShell no longer subscribes to
  // `messages`, so streamed tokens stop re-rendering the entire shell.
  const { chatOpen, toggleChat } = useMonarchShell()
  const {
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    watchlist,
  } = useWatchlists()
  const { showCopyToast, copyToastMessage, copyToastVariant } = useCopyToast()

  // Derive currentPage from URL
  const currentPage = useMemo(() => {
    const hash = (location.hash || '').replace(/^#+/, '')
    if (hash === 'token') return 'ai-screener'
    return getPageIdFromPath(location.pathname) || 'research-platform'
  }, [location.hash, location.pathname])

  const currentView = currentPage === 'ai-screener' ? 'token' : 'welcome'

  // Spectre LITE is a fixed full-screen overlay with its OWN look system
  // (liteLook / liteBg). Anything the PRO shell floats above the page lands on
  // top of it — see the ProThemeStudio note below.
  const isLiteRoute = useMemo(
    () => /^\/lite(\/|$)/.test(location.pathname || ''),
    [location.pathname]
  )

  const selectTokenWithTracking = useCallback((tokenData) => {
    selectToken(tokenData)
  }, [selectToken])

  const openResearchZone = useCallback((tokenData) => {
    if (!tokenData) return
    setResearchZoneToken(tokenData)
    const nextLocation = buildResearchZoneLocation(
      tokenData,
      !!tokenData.isStock || marketMode === 'stocks'
    )
    navigate(nextLocation)
  }, [marketMode, navigate, setResearchZoneToken])

  const handleOpenGM = useCallback(() => navigate('/gm-dashboard'), [navigate])
  const handleOpenROI = useCallback(() => navigate('/roi-calculator'), [navigate])

  const handleSelectTokenAndOpen = useCallback(async (tokenData) => {
    selectTokenWithTracking(tokenData)
    if (isTokenPath(location.pathname)) return
    // Degen routing (2026-06-11): a crypto token with an on-chain address but
    // NO CoinGecko listing (no cgId) has nothing for Research Zone - no CG
    // fundamentals, profile or chart fallbacks. Send it to Trading Lite
    // (/token, the DEX-native view) instead. CG-listed tokens, majors and
    // stocks keep going to Research Zone. cgId is the listing signal: the
    // search pipeline enriches every CG-listed result with it (CG prepends,
    // Spectre rows, majors map).
    let tok = tokenData
    let isDegen = !tok?.isStock && !tok?.cgId && !!(tok?.address || tok?.ca)
    // Address-resolved rows come from Codex, which doesn't know CG ids - a
    // CG-LISTED token found by pasting its contract (PAAL repro, Gleb
    // 2026-06-12) carried no cgId and got misrouted to Trading Lite. Confirm
    // against CG's contract index before classifying: hit -> enrich + RZ,
    // miss -> true degen. The search UIs prewarm this lookup when address
    // results render, so the await is usually instant (cached); the cap means
    // a cold/failed lookup degrades to the old routing instead of stalling.
    if (isDegen) {
      const hit = await lookupCgByContract(tok.address || tok.ca, tok.networkId ?? 1, 900)
      if (hit?.cgId) {
        tok = { ...tok, cgId: hit.cgId, name: tok.name || hit.name, logo: tok.logo || hit.image }
        selectTokenWithTracking(tok)
        isDegen = false
      }
    }
    if (isDegen) {
      // On-chain, unlisted token: open the standalone trading terminal (better
      // charts, Gleb's build) by contract in a new tab, NOT the /token "Trading
      // Lite" iframe. Falls through to Trading Lite only if the contract can't
      // be deep-linked (guards against a bad/empty address → welcome-view bounce).
      if (openTradingTerminal(tok.address || tok.ca)) return
      navigate(getPathForPageId('ai-screener'))
      return
    }
    openResearchZone(tok)
  }, [selectTokenWithTracking, location.pathname, openResearchZone, navigate])

  const handleLogoClick = useCallback(() => {
    if (currentPage === 'monarch-ai-chat') return
    navigate('/')
  }, [currentPage, navigate])

  const handleTradingModeClick = useCallback(() => {
    // Bare open - no token forced. The /trade page boots the embed into its
    // Discover view (Gleb 2026-07-18); forcing defaultToken here would flip it
    // straight to a token page.
    navigate(getPathForPageId('ai-screener'))
  }, [navigate])

  // Legacy hash redirect
  useEffect(() => {
    const hash = (location.hash || '').replace(/^#+/, '')
    if (hash === 'token') {
      navigate(getPathForPageId('ai-screener'), { replace: true })
      return
    }
    if (!getPageIdFromPath(location.pathname)) {
      navigate('/', { replace: true })
    }
  }, [location.hash, location.pathname, navigate])

  // Global scroll-to-top on every route change. Targets known scroll
  // containers. We WRITE scrollTop = 0 unconditionally (never read it first):
  // reading scrollTop forces a synchronous layout flush, and the previous
  // version did that per-element AND ran the whole pass 3x (sync + rAF +
  // 180ms timeout), which made every navigation visibly thrash on data-dense
  // pages. One rAF (fires before the next paint) is enough.
  const prevPathRef = useRef(location.pathname)
  useEffect(() => {
    const prevPath = prevPathRef.current
    prevPathRef.current = location.pathname
    // Drawer navigation INSIDE X Dash (row click -> /x-dash/token/:id, close ->
    // /x-dash) is an overlay, not a page change - resetting scroll made the
    // board jump to top before the panel opened. Keep the user's position.
    if (getPageIdFromPath(prevPath) === 'x-dash' && getPageIdFromPath(location.pathname) === 'x-dash') {
      return undefined
    }
    const SCROLL_SELECTORS = '.app-main-content, .page-layout, .page-layout__content, .mobile-preview-screen, .welcome-page, [data-mobile-scroll-root]'
    const raf = requestAnimationFrame(() => {
      try { window.scrollTo(0, 0) } catch {}
      try {
        document.querySelectorAll(SCROLL_SELECTORS).forEach((el) => { if (el) el.scrollTop = 0 })
      } catch {}
      const se = document.scrollingElement
      if (se) se.scrollTop = 0
    })
    return () => cancelAnimationFrame(raf)
  }, [location.pathname])

  // Mobile overlay states
  const [missionControlOpen, setMissionControlOpen] = useState(false)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // 🪤🪤 "AT IMMEDIATE LOAD ALL ICONS SHOW THEN LANDING PAGE" (founder, 08-06).
  //
  // The three mobile overlays below were gated on `isMobile` alone and passed
  // `isOpen={false}` — so they MOUNTED on every phone boot, and each one is
  // hidden by CSS ONLY: `.mc-sheet` renders its entire app-icon grid and relies
  // on `transform: translateY(100%); visibility: hidden` from its own separate
  // stylesheet chunk. Commit the component before that chunk is applied — the
  // documented late-CSS window on a cold PWA start — and Mission Control paints
  // IN FLOW, full screen, as a grid of every app icon, then snaps away when the
  // CSS lands and the real page appears behind it. That is the reported glitch,
  // and it is a RACE, hence "sometimes".
  //
  // The cost was the second half of the same mistake: a `lazy()` component that
  // is MOUNTED is not lazy — React.lazy fetches on first RENDER, not first open.
  // Measured on the prod build (warm SW, slow-3G, 390px) all three chunks landed
  // in one wave at ~4.46s and dragged the entire search + prices service tree
  // onto the boot path with them — coinGeckoApi, cgSearchService,
  // spectreMarketApi, spectreDataApi, binanceApi, stockApi, codexStreamApi,
  // useTokenSearch, usePageSearch, search-merge, sharedBinancePrices,
  // useWatchlistPrices — all competing with the route chunk the user is actually
  // waiting for. Verified after: none of the three is requested at boot.
  //
  // Refs, not state: when the open flag flips the component re-renders anyway,
  // so latching during that same render mounts the overlay in the SAME pass —
  // an effect would cost a commit and delay the open by a frame. Once latched
  // it stays mounted so close animations and internal state survive.
  const mcEverOpened = useRef(false)
  const settingsEverOpened = useRef(false)
  const searchEverOpened = useRef(false)
  if (missionControlOpen) mcEverOpened.current = true
  if (settingsPanelOpen) settingsEverOpened.current = true
  if (searchOpen) searchEverOpened.current = true

  // Listen for 'open-search' event from bottom nav
  useEffect(() => {
    if (!isMobile) return
    const handler = () => setSearchOpen(true)
    window.addEventListener('open-search', handler)
    return () => window.removeEventListener('open-search', handler)
  }, [isMobile])

  const [showMobilePreview, setShowMobilePreview] = useState(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.get('mobile') === '1' || params.get('mobile') === 'true'
  })

  useEffect(() => {
    document.body.classList.toggle('mobile-preview-active', showMobilePreview)
    return () => document.body.classList.remove('mobile-preview-active')
  }, [showMobilePreview])

  // Demo mode security - disable right-click, text selection, devtools shortcuts
  useEffect(() => {
    if (!demoMode) return

    // Disable right-click
    const blockContext = (e) => { e.preventDefault(); return false }
    document.addEventListener('contextmenu', blockContext)

    // Disable text selection
    document.body.style.userSelect = 'none'
    document.body.style.webkitUserSelect = 'none'

    // Block devtools shortcuts (Ctrl+Shift+I, Ctrl+U, F12)
    const blockKeys = (e) => {
      if (e.key === 'F12') { e.preventDefault(); return false }
      if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) { e.preventDefault(); return false }
      if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return false }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); return false }
    }
    document.addEventListener('keydown', blockKeys)

    // Block drag
    const blockDrag = (e) => e.preventDefault()
    document.addEventListener('dragstart', blockDrag)

    return () => {
      document.removeEventListener('contextmenu', blockContext)
      document.removeEventListener('keydown', blockKeys)
      document.removeEventListener('dragstart', blockDrag)
      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''
    }
  }, [demoMode])

  // Info mode (educational tooltips): toggle body class so CSS-driven InfoTip dots appear
  const infoMode = useSettingsStore((s) => s.infoMode)
  const setInfoMode = useSettingsStore((s) => s.setInfoMode)
  useEffect(() => {
    document.body.classList.toggle('info-mode', infoMode)
    return () => document.body.classList.remove('info-mode')
  }, [infoMode])

  // Global welcome tour --------------------------------------------------------
  // Transient state lives here (per the state rules); only the "seen" flag is
  // persisted. Auto-launches ONCE for a first-time desktop visitor on the home
  // surface; relaunchable any time from the header "?" button. Always opens on a
  // length-picker card (mode null) → 'short' | 'full'.
  const appTourSeen = useSettingsStore((s) => s.appTourSeen)
  const setAppTourSeen = useSettingsStore((s) => s.setAppTourSeen)
  const [appTourActive, setAppTourActive] = useState(false)
  const [appTourStep, setAppTourStep] = useState(0)
  const [appTourMode, setAppTourMode] = useState(null)
  const appTourStepIds = useMemo(() => getAppTourStepIds(appTourMode), [appTourMode])
  const appTourAutoRef = useRef(false)

  const startAppTour = useCallback(() => {
    setAppTourMode(null)
    setAppTourStep(0)
    // The tour frames home-surface anchors (market bar, Command Center, Top
    // Coins). If launched from another page (e.g. Research Zone), go home first
    // so every step has a target, then open once it has mounted.
    if (location.pathname !== '/') {
      navigate('/')
      setTimeout(() => setAppTourActive(true), 550)
    } else {
      setAppTourActive(true)
    }
  }, [location.pathname, navigate])
  const appTourChoose = useCallback((choice) => {
    setAppTourMode(choice?.mode === 'short' ? 'short' : 'full')
    setAppTourStep(1) // skip the chooser card into the first real step
  }, [])
  const endAppTour = useCallback(() => {
    setAppTourActive(false)
    setAppTourSeen(true)
  }, [setAppTourSeen])
  const appTourNext = useCallback(() => {
    setAppTourStep((s) => {
      if (s >= appTourStepIds.length - 1) { endAppTour(); return s }
      return s + 1
    })
  }, [endAppTour, appTourStepIds.length])
  const appTourBack = useCallback(() => setAppTourStep((s) => Math.max(0, s - 1)), [])

  // First-run auto-launch (desktop, home, not demo) - fires once, after a beat
  // so the shell + anchors have mounted. Arm the guard only when the timer
  // actually fires, else a dep settling within the delay clears it forever.
  useEffect(() => {
    if (appTourAutoRef.current) return
    if (appTourSeen || isMobile || demoMode) return
    if (location.pathname !== '/') return
    const timer = setTimeout(() => {
      appTourAutoRef.current = true
      setAppTourActive(true)
    }, 1300)
    return () => clearTimeout(timer)
  }, [appTourSeen, isMobile, demoMode, location.pathname])

  // When the tour reaches the Education-mode step, switch info mode on so the
  // "i" dots light up while it's being explained (live demo, not a promise).
  useEffect(() => {
    if (appTourActive && appTourStepIds[appTourStep] === 'app-info-toggle') {
      setInfoMode(true)
    }
  }, [appTourActive, appTourStep, appTourStepIds, setInfoMode])

  // PWA standalone detection
  const [isPWAStandalone] = useState(() => {
    return window.navigator.standalone === true ||
           window.matchMedia('(display-mode: standalone)').matches
  })

  // Telegram Mini App: hide chrome, call ready/expand
  const [isTelegramMiniApp] = useState(() => {
    return !!(window.Telegram?.WebApp?.initData)
  })
  useEffect(() => {
    if (!isTelegramMiniApp) return
    document.body.classList.add('telegram-mini-app')
    const tg = window.Telegram.WebApp
    tg.ready()
    tg.expand()
    // Match Telegram's header color to Spectre dark bg
    if (tg.setHeaderColor) tg.setHeaderColor('#09090b')
    if (tg.setBackgroundColor) tg.setBackgroundColor('#09090b')
    return () => document.body.classList.remove('telegram-mini-app')
  }, [isTelegramMiniApp])

  // Electron desktop: mark body so CSS can apply drag regions
  useEffect(() => {
    if (window.spectre?.isDesktop) {
      document.body.classList.add('spectre-desktop')
    }
    return () => document.body.classList.remove('spectre-desktop')
  }, [])

  // Electron desktop IPC listeners
  useEffect(() => {
    if (!window.spectre?.isDesktop) return

    const handleFocusSearch = () => {
      navigate('/search-engine')
      setTimeout(() => {
        const input = document.querySelector('.se-search-input')
        if (input) input.focus()
      }, 200)
    }

    const handleOpenSettings = () => {
      window.dispatchEvent(new CustomEvent('spectre-open-settings'))
    }

    const handleOpenNotifications = () => {
      window.dispatchEvent(new CustomEvent('spectre-open-notifications'))
    }

    window.spectre.on('spectre:focus-search', handleFocusSearch)
    window.spectre.on('spectre:open-settings', handleOpenSettings)
    window.spectre.on('spectre:open-notifications', handleOpenNotifications)

    return () => {
      window.spectre.off('spectre:focus-search', handleFocusSearch)
      window.spectre.off('spectre:open-settings', handleOpenSettings)
      window.spectre.off('spectre:open-notifications', handleOpenNotifications)
    }
  }, [navigate])

  const handlePageChange = useCallback((pageId) => {
    // "Trading Lite" = the in-app /token embed, ALWAYS (Gleb 2026-07-17).
    // The 52f0b46f same-tab redirect to the standalone terminal is reverted:
    // it lost the research shell/context, and from the installed PWA any
    // cross-origin navigation pops iOS's in-app browser sheet (URL bar +
    // Safari toolbar). The full terminal stays reachable via the explicit
    // header "Trading" cross-nav (external in browser, in-app in PWA).
    // No special-case needed - 'ai-screener' falls through to
    // navigate(getPathForPageId(...)) = /token like any other page.
    // Demo mode - block non-allowed pages with "Coming Soon" toast
    if (demoMode && !DEMO_ALLOWED_PAGES.has(pageId)) {
      setComingSoonToast(pageId)
      setTimeout(() => setComingSoonToast(null), 2000)
      return
    }
    const nextPath = getPathForPageId(pageId)
    // Showcase iframe lockdown — block locked pages with toast, no navigation.
    if (detectShowcaseEmbed() && !isShowcasePathAllowed(nextPath)) {
      fireShowcaseLockToast({ source: 'app-shell:handlePageChange', pageId, path: nextPath })
      return
    }
    navigate(nextPath)
    // Scroll to top on page change (mobile pages may start midway otherwise)
    window.scrollTo(0, 0)
    // Also scroll the main content area
    setTimeout(() => {
      const main = document.querySelector('.app-main-content') || document.querySelector('.page-layout__content')
      if (main) main.scrollTop = 0
    }, 50)
  }, [navigate, demoMode])

  // perf: stable handler for the desktop sidebar so React.memo(NavigationSidebar)
  // actually holds. Previously an inline arrow here gave the sidebar a new
  // onPageChange identity on every AppShell render, so the sidebar re-rendered
  // on unrelated shell churn (toast, notification poll, 60s market tick).
  const handleSidebarNav = useCallback((pageId) => {
    if (pageId === 'ai-screener') {
      selectToken(defaultToken)
    }
    handlePageChange(pageId)
  }, [selectToken, defaultToken, handlePageChange])

  // perf: stable handlers for the mobile shell chrome so React.memo(MobileHeader)
  // and React.memo(MobileBottomNav) actually hold. Without these, AppShell handed
  // each component a fresh inline arrow on every render (toast / notification poll
  // / 60s market tick), defeating the memo. State setters (setSearchOpen etc.) and
  // navigate are stable identities, so these callbacks have empty/minimal deps.
  const handleMobileVoiceSearch = useCallback(() => {
    // Preserve user gesture chain — open overlay then dispatch synchronously so
    // MobileSearchOverlay starts SpeechRecognition in the same tick (required by
    // iOS/Android Web Speech API).
    setSearchOpen(true)
    window.dispatchEvent(new CustomEvent('open-voice-search'))
  }, [])

  const handleMobileLogoClick = useCallback(() => {
    if (currentPage === 'monarch-ai-chat') return
    navigate('/')
  }, [currentPage, navigate])

  const handleMobileOpenDrawer = useCallback(() => setDrawerOpen(true), [])
  const handleMobileOpenMissionControl = useCallback(() => setMissionControlOpen(true), [])
  const handleMobileOpenSettings = useCallback(() => setSettingsPanelOpen(true), [])

  const handleMobileHome = useCallback(() => {
    navigate('/')
    setTimeout(() => {
      const welcomePage = document.querySelector('.welcome-page')
      if (welcomePage) welcomePage.scrollTo({ top: 0, behavior: 'smooth' })
    }, 100)
  }, [navigate])

  const handleMobileSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-search'))
  }, [])
  // Bottom-nav page change reuses handleSidebarNav (identical routing: research-zone
  // and ai-screener token seeding, then handlePageChange).

  // PRO theme studio (test). Resolved by a shared hook so that anything which
  // PORTALS out of `.app` (the X-Dash drawers) can mirror the exact same skin
  // classes instead of re-deriving them — see use-pro-theme-skin.js.
  const {
    look: proThemeLook,
    bg: proThemeBg,
    paper: proThemePaper,
    ready: proThemeReady,
    className: proThemeClass,
    forcesDay: proForcesDay,
    forcesDark: proForcesDark,
  } = useProThemeSkin()

  // Pages read s.dayMode straight from the store (research-zone/index.jsx:17,
  // home/index.jsx:40, ...), so while a PRO theme is active we sync the store
  // value itself - it's the only way the look reaches every surface.
  useEffect(() => {
    if (proThemeLook === 'off') return
    if (dayMode !== proForcesDay) setDayMode(proForcesDay)
  }, [proThemeLook, proForcesDay, dayMode, setDayMode])

  // Day mode logic
  const researchZoneDayMode = proForcesDay ? true : proForcesDark ? false : dayMode
  const welcomeDayMode = proForcesDay ? true : proForcesDark ? false : dayMode

  const baseDayMode = currentPage === 'research-zone'
    ? researchZoneDayMode
    // Trading Lite (/token) is DARK-ONLY. The embedded trading terminal has no
    // light-theme parity, so forcing the wrapper to day mode produced a
    // half-white shell around a dark iframe. The user's global dayMode
    // preference is preserved in the store — it just doesn't apply here, and
    // the header switch is locked (see Header tradingModeActive branch).
    : currentView === 'token'
      ? false
      : (currentPage === 'watchlists' || currentPage === 'roi-calculator' || currentView === 'welcome' ? welcomeDayMode : false)

  const effectiveDayMode = proForcesDay ? true : proForcesDark ? false : baseDayMode

  const showWelcomeDayMode = currentPage === 'research-platform' && currentView === 'welcome' && welcomeDayMode

  const appClassName = `app nav-sidebar-open ${navSidebarCollapsed ? 'nav-sidebar-collapsed' : ''} ${showWelcomeDayMode ? 'welcome-day-mode' : ''} ${effectiveDayMode ? 'app-day-mode' : ''} ${tokenColoring ? 'token-coloring' : ''} ${appDisplayMode === 'cinema' ? 'cinema-mode' : 'terminal-mode'} ${isMobile ? 'mobile-bottom-nav-visible' : ''} ${isPWAStandalone ? 'pwa-standalone' : ''} ${isTelegramMiniApp ? 'telegram-mini-app' : ''}${proThemeClass}`

  const appContent = (
    <div className={appClassName}>
      {proThemeLook !== 'off' && proThemeReady && (
        <Suspense fallback={null}>
          <ProThemeBackdrop look={proThemeLook} bg={proThemeBg} paper={proThemePaper} />
        </Suspense>
      )}
      {!isMobile && <ParticleBackground />}
      {!isMobile && (
        <Suspense fallback={null}>
          <NavigationSidebar
            currentPage={currentPage}
            demoMode={demoMode}
            demoAllowedPages={DEMO_ALLOWED_PAGES}
            onPageChange={handleSidebarNav}
          />
        </Suspense>
      )}
      {!isMobile && (
        <Suspense fallback={null}>
        <Header
          profile={profile}
          marketMode={marketMode}
          onMarketModeChange={setMarketMode}
          onOpenGM={demoMode ? undefined : handleOpenGM}
          onOpenROI={demoMode ? undefined : handleOpenROI}
          demoMode={demoMode}
          addToWatchlist={addToWatchlist}
          removeFromWatchlist={removeFromWatchlist}
          isInWatchlist={isInWatchlist}
          selectToken={selectTokenWithTracking}
          onSelectTokenAndOpen={handleSelectTokenAndOpen}
          onLogoClick={handleLogoClick}
          tradingModeActive={demoMode ? false : currentView === 'token'}
          onTradingModeClick={demoMode ? undefined : handleTradingModeClick}
          researchZoneActive={currentPage === 'research-zone'}
          researchZoneDayMode={researchZoneDayMode}
          onResearchZoneDayModeChange={requestDayMode}
          welcomeActive={currentView === 'welcome' || currentPage === 'watchlists'}
          welcomeDayMode={welcomeDayMode}
          onWelcomeDayModeChange={requestDayMode}
          appDisplayMode={appDisplayMode}
          onAppDisplayModeChange={setAppDisplayMode}
          onStartTour={demoMode ? undefined : startAppTour}
        />
        </Suspense>
      )}
      {isMobile && (
        <Suspense fallback={null}>
          <MobileHeader
            profile={profile}
            marketMode={marketMode}
            onMarketModeChange={setMarketMode}
            dayMode={currentPage === 'research-zone' ? researchZoneDayMode : welcomeDayMode}
            onDayModeChange={requestDayMode}
            onVoiceSearch={handleMobileVoiceSearch}
            onLogoClick={handleMobileLogoClick}
            onOpenDrawer={handleMobileOpenDrawer}
            onOpenMissionControl={handleMobileOpenMissionControl}
            onOpenSettings={handleMobileOpenSettings}
            onPageChange={handlePageChange}
            currentPage={currentPage}
          />
        </Suspense>
      )}

      {/* Side Drawer — mobile navigation */}
      {isMobile && (
        <SideDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          currentPage={currentPage}
          onOpenMissionControl={() => setMissionControlOpen(true)}
          onNavigate={(pageId) => {
            handlePageChange(pageId)
          }}
        />
      )}

      {/* Mission Control — mobile app launcher */}
      {isMobile && mcEverOpened.current && (
        <Suspense fallback={null}>
          <MissionControlSheet
            isOpen={missionControlOpen}
            onClose={() => setMissionControlOpen(false)}
            usMarketStatus={usMarketStatus}
            onPageChange={(pageId) => {
              if (pageId === 'ai-screener') {
                selectToken(defaultToken)
              }
              handlePageChange(pageId)
            }}
          />
        </Suspense>
      )}

      {/* Search Overlay — fullscreen mobile search */}
      {isMobile && searchEverOpened.current && (
        <Suspense fallback={null}>
          <MobileSearchOverlay
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
            onSelectTokenAndOpen={handleSelectTokenAndOpen}
          />
        </Suspense>
      )}

      {/* Settings Panel — right-side mobile panel */}
      {isMobile && settingsEverOpened.current && (
        <Suspense fallback={null}>
          <MobileSettingsPanel
            open={settingsPanelOpen}
            onClose={() => setSettingsPanelOpen(false)}
            profile={profile}
            dayMode={effectiveDayMode}
            onDayModeChange={requestDayMode}
            marketMode={marketMode}
            onMarketModeChange={setMarketMode}
            appDisplayMode={appDisplayMode}
            onAppDisplayModeChange={setAppDisplayMode}
            showMoodWall={showMoodWall}
            onMoodWallChange={setShowMoodWall}
            tokenColoring={tokenColoring}
            onTokenColoringChange={setTokenColoring}
            currency={currency}
            onCurrencyChange={setCurrency}
            language={language}
            onLanguageChange={setLanguage}
            onProfileChange={setProfile}
            onNavigate={handlePageChange}
          />
        </Suspense>
      )}

      {/* Outlet renders child routes: TokenPage, GMDashboardPage, or PageShell > pages.
          Wrapped in a Suspense so AppShell-only routes (token / gm-dashboard /
          monarch-chat / world / x-intelligence / x-bubbles) keep the chrome
          painted while their lazy chunk loads, instead of unmounting back to
          black. PageShell has its own inner Suspense for the page list.
          Keyed by PAGE, not pathname: /x-dash sub-routes (token/author drawers,
          kol profile) are overlays over one mounted board, and a per-pathname
          key here remounted the whole page on every drawer open. */}
      <Suspense
        key={getPageIdFromPath(location.pathname) === 'x-dash' ? 'x-dash' : location.pathname}
        fallback={<RouteFallback shell />}
      >
        <Outlet context={{ selectTokenWithTracking }} />
      </Suspense>

      {/* Hidden on the mobile token page: the embedded trading app brings its
          own bottom nav there and the iframe takes the full height - two
          stacked navs was dead chrome (Evgeniy 2026-07-17). */}
      {/* The update offer. Its own boundary so a failed chunk fetch here can
          never take the app down — the silent background reload still works. */}
      <Suspense fallback={null}>
        <AppUpdateBar />
      </Suspense>

      {isMobile && currentPage !== 'ai-screener' && (
        <Suspense fallback={null}>
          <MobileBottomNav
            onOpenMissionControl={handleMobileOpenMissionControl}
            missionControlOpen={missionControlOpen}
            activeId={currentPage === 'research-platform' ? 'home' : currentPage}
            onHome={handleMobileHome}
            onSearch={handleMobileSearch}
            onPageChange={handleSidebarNav}
          />
        </Suspense>
      )}

      {/* Monarch AI — FAB + mini chat, hidden on full chat page and on the
          mobile token page (it would float over the trading app's nav) */}
      {currentPage !== 'monarch-ai-chat' && !(isMobile && currentPage === 'ai-screener') && (
        <>
          {/* Monarch is not live yet — lock the FAB everywhere with a Coming
              Soon tooltip (was previously locked only inside the showcase embed). */}
          {!chatOpen && <MonarchFAB onClick={toggleChat} locked />}
          {chatOpen && !demoMode && (
            <Suspense fallback={null}>
              <MonarchMiniChat />
            </Suspense>
          )}
        </>
      )}

      {showCopyToast && (
        <div className={`copy-toast${copyToastVariant === 'destructive' ? ' copy-toast--destructive' : ''}`}>
          {copyToastVariant === 'destructive' ? (
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
          {copyToastMessage}
        </div>
      )}

      {/* Demo mode "Coming Soon" toast */}
      {comingSoonToast && (
        <div className="demo-coming-soon-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          Coming Soon
        </div>
      )}

      {/* Demo mode security - disable right-click, selection, devtools */}
      {demoMode && (
        <div className="demo-mode-shield" />
      )}

      {/* Global welcome tour (desktop) - mounted only while running so the
          GuidedTour chunk loads on demand. */}
      {!isMobile && appTourActive && (
        <Suspense fallback={null}>
          <AppTour
            isActive={appTourActive}
            currentStep={appTourStep}
            mode={appTourMode}
            onNext={appTourNext}
            onBack={appTourBack}
            onSkip={endAppTour}
            onChoose={appTourChoose}
            dayMode={effectiveDayMode}
          />
        </Suspense>
      )}
    </div>
  )

  return (
    <MobilePreviewContext.Provider value={showMobilePreview}>
      {!isMobile && <ToastStack toasts={toasts} onDismiss={removeToast} dayMode={effectiveDayMode} />}
      {/* 🪤🪤 NOT over Spectre LITE. The globe floats above every page, and LITE
          is a fixed full-screen overlay — so on /lite it landed on top of LITE
          offering "Glass / Paper" and a colour catalogue, which is word-for-word
          what LITE's own look control offers. It drives proThemeLook/proThemeBg
          and LITE reads liteLook/liteBg, so picking a look there changes
          NOTHING on screen. That is the whole of the founder's 08-07 "themes
          don't work when I change colors, glass or to paper" — two rounds of
          hunting theme LEAKS found real bugs but never this, because the
          control being used was never wired to the surface it sat on.
          LITE owns its theming: the Glass/Paper pill in its rail and its Themes
          tab. One theme system per surface. */}
      {proThemeReady && !isLiteRoute && (
        <Suspense fallback={null}>
          <ProThemeStudio />
        </Suspense>
      )}
      {showMobilePreview ? (
        <MobilePreviewFrame onClose={() => setShowMobilePreview(false)}>
          {appContent}
        </MobilePreviewFrame>
      ) : (
        appContent
      )}
      <SocialDossierSlideIn />
      {/* Video + Spotify playback is app-wide for the same reason as podcasts
          below: these used to mount inside the AI Media Center route, so
          navigating anywhere silently killed whatever was playing. */}
      {miniPlayerOpen && !theaterOpen && (
        <Suspense fallback={null}><MediaMiniPlayer dayMode={effectiveDayMode} /></Suspense>
      )}
      {spotifyShow && (
        <Suspense fallback={null}><SpotifyDock dayMode={effectiveDayMode} /></Suspense>
      )}
      {/* Podcast audio is app-wide by design: mounted OUTSIDE the router Outlet
          so navigating away from the AI Media Center collapses the immersive
          view to the docked bar instead of unmounting the <audio> element and
          killing playback. Lazy — the chunk only loads once something plays. */}
      {podcastActive && (
        <Suspense fallback={null}>
          <PodcastPlayer dayMode={effectiveDayMode} />
        </Suspense>
      )}
    </MobilePreviewContext.Provider>
  )
}
