/**
 * Spectre AI Trading Platform
 * Figma Reference: Frame 2085654846
 * Professional institutional investor platform
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, createContext, useContext, Suspense } from 'react'
import lazy from './lib/lazy-with-retry'
import { track, Events, setPageArea } from './services/analytics'
import AuthGate from './components/AuthGate'
import OnboardingPopup from './components/OnboardingPopup'
import Header from './components/Header'
import DiscoverPage from './components/DiscoverPage'
import Icon from './components/Icon'
import LazyErrorBoundary from './components/LazyErrorBoundary'
import RailGutter from './components/RailGutter'
import { getTokenColor, generateTokenBackgroundColors, fetchTokenColorFromServer, extractColorFromImage, getCachedColor, hasKnownColor } from './utils/tokenColors'
import { inferNetworkId } from './services/codexApi'
import { MAJOR_TOKEN_ADDR } from './lib/majorTokens'
import { prewarmTokenDetailsCache, prefetchTokenDetails, prefetchChartBars, prefetchLatestTrades, seedCachesFromSnapshot } from './hooks/useCodexData'
import { setDemoToken, installDemoFetchHeader, expectDemoToken } from './services/demoSession'
import useAlerts from './hooks/useAlerts'
import useAlertsSeen from './hooks/useAlertsSeen'
import AlertNotification from './components/AlertNotification'
import './components/AlertNotification.css'
import NotificationDrawer from './components/Notifications/NotificationDrawer'
import { searchTokens, getDetailedTokenInfo, getHardcodedLogo, formatLargeNumber, formatPrice, fetchTokenSnapshot, hasSnapshotPending, recordTokenView } from './services/codexApi'
import { readHotPayload, writeHotPayload, writeHotSnapshot, readPersistedHot } from './lib/tokenHotCache'
import { seedColorCache } from './utils/tokenColors'
import { mark, markAndMeasure } from './lib/perfMarks'
import { DEFAULT_TOKEN_LAYOUT, compileTokenLayout } from './lib/tokenLayout'
import { fetchWatchlist, pushWatchlist, setAuthToken } from './services/profileSync'
import { useProfileSync } from './hooks/useProfileSync'
import { usePrivySafe as usePrivy } from './lib/use-privy-safe'
import { TokenDetailsProvider } from './contexts/TokenDetailsContext'
import LiveTabTitle from './components/LiveTabTitle'
import './App.css'

// Dev-only: lazy-load agentation toolbar (dynamic import avoids prod bundle).
// Swallow import failures (a stale Vite dep hash on a fresh dev-server start can
// reject this dynamic import) so the dev-only toolbar can never white-screen the
// whole app - it just renders nothing.
const DevAgentation = import.meta.env.DEV
  ? lazy(() => import('agentation')
      .then(m => ({ default: m.Agentation }))
      .catch(() => ({ default: () => null })))
  : null

// Token-page components - LAZY (off the boot `main` chunk). The default view is
// `#discover`/welcome, which needs none of these; eager-importing them dragged
// LeftPanel/DataTabs/TokenBanner + RightPanel's wallet stack (ethers via
// walletService) into `main`. They are prefetched on idle right after first
// paint (see the prefetch effect below) so the chunks are already in cache by
// the time the user opens a token - token-switch stays instant, boot gets
// lighter.
const TokenTicker = lazy(() => import('./components/TokenTicker'))
const LeftPanel = lazy(() => import('./components/LeftPanel'))
const TokenBanner = lazy(() => import('./components/TokenBanner'))
// Phase G: TradingChart lazy-loads the heavy lightweight-charts library
// (~180KB gzipped). While the bundle downloads, the placeholder
// renders a real-data sparkline of the prefetched 1H bars so the
// user sees the price curve within ~16ms instead of an empty
// container. The .token-chart-fade cross-fade swaps to the full
// chart when the bundle resolves.
const TradingChart = lazy(() => import('./components/TradingChart'))
const DataTabs = lazy(() => import('./components/DataTabs'))
const RightPanel = lazy(() => import('./components/RightPanel'))
const MobileTokenPage = lazy(() => import('./components/mobile/MobileTokenPage'))
const MobileHomeShell = lazy(() => import('./components/mobile/home/MobileHomeShell'))
const SpectreAgentLauncher = lazy(() => import('./components/agent/SpectreAgentLauncher'))
const LayoutEditor = lazy(() => import('./components/LayoutEditor'))
import useIsMobile, { MOBILE_MEDIA_QUERY } from './hooks/useIsMobile'

// Prefetch the token-page chunks once the browser is idle after first paint, so
// the first token click resolves them instantly instead of waiting on the lazy
// fetch. Module-level + idempotent so it runs at most once per session.
let _tokenPanelsPrefetched = false
function prefetchTokenPanels() {
  if (_tokenPanelsPrefetched) return
  _tokenPanelsPrefetched = true
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1))
  // VIEWPORT-GATED (2026-08-04). The two trees are mutually exclusive - App
  // early-returns to MobileTokenPage under MOBILE_MEDIA_QUERY and renders the
  // three desktop panels otherwise - so prefetching both meant every desktop
  // session downloaded the mobile token page (and, through it, the mobile home
  // shell + its five screens + CSS) for markup it can never render, and every
  // phone downloaded the desktop panels. Match the prefetch to the tree that
  // will actually mount; a viewport that later crosses the breakpoint still
  // gets its chunks through the normal React.lazy path.
  const mobile = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
    : false
  idle(() => {
    import('./components/TradingChart')
    if (mobile) {
      import('./components/mobile/MobileTokenPage')
      return
    }
    import('./components/TokenTicker')
    import('./components/LeftPanel')
    import('./components/TokenBanner')
    import('./components/DataTabs')
    import('./components/RightPanel')
  })
}

// Obsidian & Lime redesign primitives
import AuroraField from './components/ui/AuroraField'
import CommandPalette from './components/ui/CommandPalette'
import useSettingsStore from './store/useSettingsStore'
import { applyBgTone } from './lib/bgTone'
import { applyAccent } from './lib/accent'
import { applyDecorSkin } from './lib/decorSkins'
import SkinLayer from './components/SkinLayer'
// Iteration 3 — adaptive token theming
import useAccentTheme from './hooks/useAccentTheme'

const UserDashboard = lazy(() => import('./components/UserDashboard'))
const TrendingHub = lazy(() => import('./components/TrendingHub'))

// Create context for copy toast (default no-op prevents crash if provider is missing during HMR)
export const CopyToastContext = createContext({ triggerCopyToast: () => {} })

export const useCopyToast = () => useContext(CopyToastContext)

// Self-contained copy toast - owns its own state so it never re-renders App
function CopyToastWidget({ triggerRef }) {
  const [show, setShow] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [message, setMessage] = useState('')
  const [variant, setVariant] = useState('default') // 'default' | 'destructive'
  const timers = useRef({ exit: null, hide: null })

  useEffect(() => {
    // Trigger now accepts an optional `options` arg: { variant: 'destructive' }
    triggerRef.current = (msg, options) => {
      if (timers.current.exit) clearTimeout(timers.current.exit)
      if (timers.current.hide) clearTimeout(timers.current.hide)
      setMessage(msg)
      setVariant(options?.variant === 'destructive' ? 'destructive' : 'default')
      setShow(true)
      setExiting(false)
      timers.current.exit = setTimeout(() => setExiting(true), 1800)
      timers.current.hide = setTimeout(() => { setShow(false); setExiting(false) }, 2050)
    }
    return () => { triggerRef.current = null }
  }, [triggerRef])

  if (!show) return null
  const isDestructive = variant === 'destructive'
  return (
    <div className={`copy-toast ${exiting ? 'is-exiting' : ''} ${message === 'Coming Soon' ? 'coming-soon' : ''} ${isDestructive ? 'copy-toast--destructive' : ''}`}>
      {message === 'Coming Soon' ? (
        <Icon name="info" size={20} className="toast-icon" />
      ) : isDestructive ? (
        <Icon name="trash" size={20} className="toast-icon" />
      ) : (
        <Icon name="check" size={20} className="toast-icon" />
      )}
      {message}
    </div>
  )
}


function App() {
  // GP8: remove the pre-JS boot skeleton (index.html #boot-skeleton) on the
  // FIRST React commit. useLayoutEffect runs after the DOM is in place but
  // before the browser paints, so the skeleton -> real-chrome swap is a
  // single atomic frame (no overlap, no flash). The skeleton's geometry is
  // a frozen copy of --header-height/--ticker-height - if those change,
  // update index.html's #boot-skeleton bands too.
  useLayoutEffect(() => {
    document.getElementById('boot-skeleton')?.remove()
  }, [])

  // Embedded mode: when loaded inside research app iframe (?embedded=true)
  const [isEmbedded] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('embedded') === 'true'
  })

  // Obsidian & Lime — surface the in-app reduced-motion preference to all
  // CSS via [data-reduced-motion] on the .app root. The token file uses
  // this attribute to collapse --dur-* values to 1ms.
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)

  // Appearance — repaint the obsidian ladder (tone + depth) and the user
  // accent channel to the persisted values before first paint, and re-apply
  // whenever the theme class flips (day mode clears the overrides, returning
  // to dark restores them). Owned here rather than in the header control so
  // it works on every view.
  const bgTone = useSettingsStore((s) => s.bgTone)
  const bgDepth = useSettingsStore((s) => s.bgDepth)
  const accentColor = useSettingsStore((s) => s.accentColor)
  const decorSkin = useSettingsStore((s) => s.decorSkin)
  // Drives the .token-coloring class (the per-token glow / wash / accent on the
  // banner). Until now that class was applied ONLY by the research iframe's
  // spectre:set-theme message, so on the standalone terminal it was never set
  // and the whole token-tint system was dead despite defaulting to true.
  const tokenColoring = useSettingsStore((s) => s.tokenColoring)
  useLayoutEffect(() => {
    applyBgTone(bgTone, bgDepth)
    applyAccent(accentColor)
    applyDecorSkin(decorSkin)
    const observer = new MutationObserver(() => {
      const s = useSettingsStore.getState()
      applyBgTone(s.bgTone, s.bgDepth)
      applyAccent(s.accentColor)
      applyDecorSkin(s.decorSkin)
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [bgTone, bgDepth, accentColor, decorSkin])

  // Iteration 3 — adaptive accent. Reads the active token, runs it
  // through the existing colour-extraction pipeline + neon-normalise,
  // and writes --accent* custom properties on .app.token-page so the
  // page re-themes per token (SPX yellow, ETH purple-blue, SPECTRE
  // bright-silver, etc.). Cross-fade is automatic via @property +
  // transition in design-tokens.css.
  // Note: token reference is read below from state — the hook is
  // re-invoked when currentView/token changes via React identity.
  // (The hook itself dedupes by address so re-renders are cheap.)
  //
  // The actual call is placed AFTER the `token` state is declared
  // further down — see the second `useAccentTheme(...)` block.

  // Obsidian & Lime — global ⌘K / Ctrl+K command palette.
  // Owned at App level so it works from any view and so Header's legacy
  // search modal can't double-bind the hotkey.
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Notification drawer — see the openNotifications callback (near the
  // useAlertsSeen mount below) for why the seen-watermark is frozen at open
  // time instead of read live.
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifSeenAtOpen, setNotifSeenAtOpen] = useState(0)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Pause all CSS animations when tab is hidden to save GPU
  useEffect(() => {
    const onVis = () => {
      document.documentElement.classList.toggle('tab-hidden', document.hidden)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Prefetch the (now lazy) token-page chunks on idle after first paint, so the
  // first token click is instant despite the components no longer being in `main`.
  useEffect(() => { prefetchTokenPanels() }, [])

  const { authenticated, getAccessToken } = usePrivy()
  const getAccessTokenRef = useRef(getAccessToken)
  getAccessTokenRef.current = getAccessToken

  // Wire profile sync to Privy auth - sets auth token on login, fetches server
  // profile, enables auto-push of local changes (name/imageUrl/settings) to KV.
  // Matches research's <ProfileSyncInit /> in apps/research/src/App.jsx so both
  // apps read/write the same user:{did}:profile key in shared Upstash KV. Without
  // this mount, trading never enables sync -> name/imageUrl set on trading never
  // pushed to KV -> research never sees them, and vice versa appears stale.
  useProfileSync()

  // Copy toast state moved to CopyToastWidget below - no longer causes App re-renders
  const copyToastTriggerRef = useRef(null)
  const [isDataTabsExpanded, setIsDataTabsExpanded] = useState(false)
  // Mobile detection - drives the early-return to MobileTokenPage on the
  // token view at <=768px (per mobile-crypto-ux rules: render a different
  // component tree on phones, not a CSS-hidden duplicate).
  const isMobile = useIsMobile()
  // I2: the notification drawer only mounts (and only ever calls
  // setNotifOpen(false)) when !isMobile. Crossing the breakpoint while it's
  // open - rotating a device, resizing, devtools device mode, or the
  // (max-height:540px) and (pointer:coarse) clause in useIsMobile flipping -
  // unmounts the drawer with notifOpen still true and no close path left,
  // wedging the alert-toast gate below shut for the rest of the session.
  useEffect(() => {
    if (isMobile) setNotifOpen(false)
  }, [isMobile])
  // Panel collapse survives reloads — traders who prefer the wide-chart
  // layout shouldn't have to re-collapse on every visit.
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(() => {
    try { return localStorage.getItem('spectre-panel-left-collapsed') === '1' } catch (e) { return false }
  })
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(() => {
    try { return localStorage.getItem('spectre-panel-right-collapsed') === '1' } catch (e) { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('spectre-panel-left-collapsed', isLeftPanelCollapsed ? '1' : '0') } catch (e) { /* noop */ }
  }, [isLeftPanelCollapsed])
  useEffect(() => {
    try { localStorage.setItem('spectre-panel-right-collapsed', isRightPanelCollapsed ? '1' : '0') } catch (e) { /* noop */ }
  }, [isRightPanelCollapsed])
  // Token-page layout engine (Zone Stacks). The 5 sections are FIXED-order DOM
  // children of .main-layout; the compiler expresses the arrangement purely as
  // grid placement styles, so rearranging never re-parents the TradingView
  // iframe (re-parenting reloads the whole widget - see tokenLayout.js header).
  // Below 1200px the compiler falls back to the default arrangement (custom
  // layouts stay persisted and return on wide viewports).
  const readLayoutViewport = () => {
    try {
      const w = window.innerWidth
      return {
        tier: w <= 900 ? 'single' : w <= 1200 ? 'narrow' : 'wide',
        railCap: w <= 1024 ? 280 : w <= 1400 ? 300 : w <= 1600 ? 340 : 560,
      }
    } catch (e) { return { tier: 'wide', railCap: 560 } }
  }
  const [layoutViewport, setLayoutViewport] = useState(readLayoutViewport)
  useEffect(() => {
    // One listener set for all layout breakpoints (900/1024/1200/1400/1600).
    const queries = [900, 1024, 1200, 1400, 1600].map((w) => window.matchMedia(`(max-width: ${w}px)`))
    const update = () => setLayoutViewport((prev) => {
      const next = readLayoutViewport()
      return prev.tier === next.tier && prev.railCap === next.railCap ? prev : next
    })
    queries.forEach((q) => q.addEventListener('change', update))
    return () => queries.forEach((q) => q.removeEventListener('change', update))
  }, [])
  const tokenLayout = useSettingsStore((s) => s.tokenLayout)
  const compiledLayout = useMemo(
    () => compileTokenLayout(
      // Embedded surfaces (research /token iframe) are curated - always the
      // default arrangement; custom layouts apply on the standalone app only.
      isEmbedded ? DEFAULT_TOKEN_LAYOUT : (tokenLayout || DEFAULT_TOKEN_LAYOUT),
      {
        leftCollapsed: isLeftPanelCollapsed,
        rightCollapsed: isRightPanelCollapsed,
        tier: layoutViewport.tier,
        railCap: layoutViewport.railCap,
      }
    ),
    [tokenLayout, isLeftPanelCollapsed, isRightPanelCollapsed, layoutViewport, isEmbedded]
  )
  // A section is rail-collapsed when it occupies a collapsed rail - the
  // collapse toggles act on RAILS, and the fade rides whichever section
  // (watch or trade) currently lives there.
  const railCollapsed = (id) =>
    (isLeftPanelCollapsed && compiledLayout.meta.leftSections.includes(id)) ||
    (isRightPanelCollapsed && compiledLayout.meta.rightSections.includes(id))
  const setTokenLayoutStore = useSettingsStore((s) => s.setTokenLayout)
  const commitRailWidth = useCallback((side, px) => {
    setTokenLayoutStore((l) => {
      const base = l || DEFAULT_TOKEN_LAYOUT
      return { ...base, sizes: { ...base.sizes, [side === 'left' ? 'leftW' : 'rightW']: px } }
    })
  }, [setTokenLayoutStore])
  // "Customize layout" edit mode (drag sections between zones).
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false)
  const openLayoutEditor = useCallback(() => setLayoutEditorOpen(true), [])
  // View state: 'welcome' (discovery page) or 'token' (token detail page)
  // When embedded, always force token view
  // Deep-link: #token/0x... or #token/<solana-addr> auto-loads the token
  // Save the address synchronously before any effects can wipe the hash
  const deepLinkAddressRef = useRef(null)
  const deepLinkResolvedRef = useRef(false)
  // A bare `#token/0x…` deep-link carries NO chain. EVM addresses are identical
  // across chains, so we can't know Ethereum vs BSC vs Base until an async
  // lookup resolves it. This ref marks the "chain unknown" state so the token
  // view holds its loading skeleton instead of speculatively painting the
  // WRONG chain (Ethereum by default) — which for a BSC/L2 token shows empty
  // candles + "Series unavailable" for 1-2s until it self-corrects. Only ever
  // set for a fresh bare-EVM deep-link with no cached chain.
  const deepLinkChainUnknownRef = useRef(false)
  const chainGateTimerRef = useRef(null)
  const [currentView, setCurrentView] = useState(() => {
    const hash = window.location.hash
    // Embedded mode: honor explicit hashes (token, dashboard, trending, discover); otherwise land on Discover.
    if (isEmbedded) {
      if (hash === '#token') return 'token'
      if (hash.startsWith('#token/')) return 'token'
      if (hash === '#dashboard') return 'user-dashboard'
      if (hash === '#trending') return 'trending'
      // Default for Trading Lite is Discover (welcome) so users land on the discovery surface
      return 'welcome'
    }
    if (hash === '#token') return 'token'
    // Deep-link: #token/<address> — only accept real contract addresses (0x... or Solana base58)
    const dlMatch = hash.match(/^#token\/(.+)$/)
    if (dlMatch) {
      const addr = dlMatch[1]
      const isRealAddress = addr.startsWith('0x') && addr.length === 42 || (addr.length >= 32 && addr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr))
      if (isRealAddress) {
        deepLinkAddressRef.current = addr
        return 'token'
      }
      // Non-address slug (e.g. CoinGecko ID) - ignore, go to token view without deep-link
      return 'token'
    }
    if (hash === '#dashboard') return 'user-dashboard'
    if (hash === '#trending') return 'trending'
    return 'welcome'
  })
  
  // Handle browser back/forward navigation
  useEffect(() => {
    // Disable browser's automatic scroll restoration - we handle it manually
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const handlePopState = (event) => {
      const hash = window.location.hash
      let view = event.state?.view
      if (!view) {
        // Raw hash navigation (address-bar paste/edit of a #token/... URL,
        // or back/forward onto such an entry) carries NO history state -
        // derive the view from the hash instead of defaulting to 'welcome'
        // with a token hash still showing in the URL.
        if (hash === '#token' || hash.startsWith('#token/')) view = 'token'
        else if (hash === '#dashboard') view = 'user-dashboard'
        else if (hash === '#trending') view = 'trending'
        else view = 'welcome'
      }
      // Hash points at a DIFFERENT token than the one loaded (user pasted
      // another token's URL while the app was open): resolve + select it,
      // mirroring the mount deep-link path. Refs avoid stale closures - this
      // listener is registered once.
      const dl = hash.match(/^#token\/(.+)$/)
      if (dl) {
        const addr = dl[1]
        const isRealAddress = (addr.startsWith('0x') && addr.length === 42) ||
          (addr.length >= 32 && addr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr))
        if (isRealAddress && addr.toLowerCase() !== (currentTokenAddrRef.current || '').toLowerCase()) {
          try { resolveDeepLinkRef.current?.(addr) } catch { /* resolver logs its own failures */ }
        }
      }
      setCurrentView(view)
      window.scrollTo(0, 0)
      if (view === 'token') {
        document.body.classList.add('token-page')
      } else {
        document.body.classList.remove('token-page')
      }
    }
    
    window.addEventListener('popstate', handlePopState)
    
    // Set initial history state
    if (!window.history.state?.view) {
      const hashMap = { token: '#token' }
      window.history.replaceState({ view: currentView }, '', hashMap[currentView] || '#')
    }
    
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Handle deep-link taps that only change the hash while this window is
  // already focused - e.g. a push-notification tap resolves to
  // ServiceWorkerClients.navigate('/#token/<addr>') on an existing window
  // (sw.js `notificationclick`). A hash-only navigation fires `hashchange`,
  // NOT `popstate`, so the listener above never sees it and the tap does
  // nothing. Mirrors that listener's deep-link resolution only - refs avoid
  // stale closures (registered once), and it no-ops when the hash isn't a
  // `#token/...` hash or already points at the loaded token (also guards
  // against the app's own hash writes re-triggering resolution, though
  // navigateTo currently uses pushState/replaceState, which don't fire
  // hashchange).
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash
      const dl = hash.match(/^#token\/(.+)$/)
      if (!dl) return
      const addr = dl[1]
      const isRealAddress = (addr.startsWith('0x') && addr.length === 42) ||
        (addr.length >= 32 && addr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr))
      if (!isRealAddress) return
      if (addr.toLowerCase() === (currentTokenAddrRef.current || '').toLowerCase()) return
      try { resolveDeepLinkRef.current?.(addr) } catch { /* resolver logs its own failures */ }
      setCurrentView('token')
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Navigate with history support
  // tokenAddress param overrides stale `token` state (used by selectToken which sets token async)
  // Deferred 'spectre-selected-token' write - flushed on pagehide so an
  // instant tab close after a token switch still persists the selection.
  const _pendingTokenWriteRef = useRef(null)
  useEffect(() => {
    const flush = () => _pendingTokenWriteRef.current?.()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])
  const navigateTo = useCallback((view, tokenAddress) => {
    if (view !== currentView) {
      // Include token address in URL hash for shareability (only real contract addresses)
      const addr = tokenAddress || currentTokenAddrRef.current
      const isRealAddress = addr && (addr.startsWith('0x') || (addr.length >= 32 && addr.length <= 44))
      let hash = '#'
      if (view === 'token' && isRealAddress) {
        hash = `#token/${addr}`
      } else if (view === 'token') {
        hash = '#token'
      } else if (view === 'user-dashboard') {
        hash = '#dashboard'
      } else if (view === 'trending') {
        hash = '#trending'
      }
      window.history.pushState({ view }, '', hash)
      setCurrentView(view)
      window.scrollTo(0, 0)
      if (view === 'token') {
        document.body.classList.add('token-page')
        // Entering the token view WITHOUT a token click (Launch Terminal CTA,
        // header nav, back-nav): the chart mounts for the CURRENT token, but
        // nothing started its bars - selectToken's click-time prefetch only
        // covers row clicks. Measured on prod 2026-08-04 (Launch Terminal):
        // first bars request at 706ms, exactly when TV asked - the whole
        // widget-construction window went unused. Fire it here instead.
        // Gated on !tokenAddress: when selectToken passes the address it has
        // already prefetched with the token's own networkId - re-firing here
        // with the ref's (possibly stale, pre-setToken) networkId would key a
        // second, wrong cache entry and a second Codex call.
        if (!tokenAddress && isRealAddress) {
          try { prefetchChartBars(addr, currentTokenNetRef.current || 1) } catch { /* warm is best-effort */ }
        }
      } else {
        document.body.classList.remove('token-page')
      }
    } else if (view === 'token') {
      // Same view, but token address changed - update URL hash
      const addr = tokenAddress || currentTokenAddrRef.current
      const isRealAddress = addr && (addr.startsWith('0x') || (addr.length >= 32 && addr.length <= 44))
      if (isRealAddress) {
        window.history.replaceState({ view }, '', `#token/${addr}`)
      }
    }
  }, [currentView])
  
  // Set initial body class
  useEffect(() => {
    if (currentView === 'token') {
      document.body.classList.add('token-page')
    } else {
      document.body.classList.remove('token-page')
    }
  }, [currentView])

  // PostHog page_area super-property — human-readable label for the
  // current view so reports show `trading_terminal` / `trading_discover`
  // / `trading_dashboard` instead of the raw hash. `surface: 'trading-app'`
  // is already set at init time in services/analytics.js.
  useEffect(() => {
    const area = currentView === 'token' ? 'trading_terminal'
      : currentView === 'user-dashboard' ? 'trading_dashboard'
      : 'trading_discover'
    setPageArea(area)
  }, [currentView])

  // Tracks whether last watchlist change came from parent ('remote') or local (null)
  const watchlistSyncSourceRef = useRef(null)
  // Same anti-echo for the token: a parent-driven spectre:select-token must not
  // bounce back as spectre:token-changed. Local switches (watchlist cards,
  // search) DO post, so the embedding /trade page can mirror the URL.
  const tokenSyncSourceRef = useRef(null)
  // Don't send watchlist updates to parent until we've received the first sync
  const hasReceivedParentSyncRef = useRef(false)
  // Captured from the first allowed message so we know exactly which origin to
  // reply to. Avoids hardcoding parent URLs that drift (vercel preview deploys,
  // dev worktree ports, custom domains).
  const parentOriginRef = useRef(null)

  // Embedded mode: add body class + listen for postMessage from parent (research app)
  useEffect(() => {
    if (!isEmbedded) return
    document.body.classList.add('embedded')

    // Demo-session header transport (SEC-20260521-DEMOTOKEN-R2): install the
    // fetch wrapper that attaches x-demo-token to same-origin read-only /api
    // GETs, and mark that a token is expected so the wrapper waits/retries a
    // boot-time 401 instead of leaving "No data". Inert + no-op for standalone
    // trading (no token ever arrives).
    installDemoFetchHeader()
    expectDemoToken()

    // Handshake: tell the parent (research) we're ready, so it (re)sends the
    // demo token even if its onLoad post raced our listener setup. Ready ping
    // carries no secret; the token only flows back with a pinned targetOrigin
    // and is accepted only from an allow-listed origin (verified below).
    try {
      // Use '*' for this public ping (no secret payload). document.referrer
      // is unreliable here: SPA navigations inside the iframe overwrite it
      // with the iframe's own previous URL, which then no longer matches the
      // parent window's origin → DOMWindow postMessage rejection. The parent
      // verifies event.origin against its allowlist before reacting, so '*'
      // is safe for an empty handshake ping.
      window.parent?.postMessage({ type: 'spectre:embed-ready' }, '*')
    } catch (_) { /* noop */ }

    // Apply initial theme from URL param
    const params = new URLSearchParams(window.location.search)
    if (params.get('theme') === 'light') {
      document.body.classList.add('theme-light')
    }

    // Only accept postMessage from the research app origin or the trading app's
    // own origin (self-embedding during dev). Without this check any site that
    // iframes the trading app could fire messages to mutate state.
    // Patterns instead of a fixed Set so vercel preview deploys + dev worktree
    // ports + future custom domains all work without code edits.
    const isAllowedParentOrigin = (origin) => {
      if (!origin) return false
      if (origin === window.location.origin) return true
      // Localhost on any port (dev research at 5180, worktrees at 5182/5184/5186/5188)
      if (/^http:\/\/localhost:\d+$/.test(origin)) return true
      // Spectre prod domains (app.spectreai.io is the live research origin that
      // embeds this iframe; research.spectreai.io kept for back-compat)
      if (origin === 'https://app.spectreai.io' || origin === 'https://research.spectreai.io' || origin === 'https://trade.spectreai.io') return true
      // Vercel deploys: spectre-app-research.vercel.app, spectre-trading.vercel.app,
      // and any spectre-* preview deployment.
      if (/^https:\/\/spectre-[a-z0-9-]+\.vercel\.app$/.test(origin)) return true
      return false
    }

    const handleMessage = (event) => {
      if (!isAllowedParentOrigin(event.origin)) return
      // Lock in the parent origin on first valid CROSS-ORIGIN message so replies
      // go back to exactly the origin that's listening. Must NOT capture our own
      // origin: when embedded, the parent is always the research app (a different
      // origin). A same-origin message (e.g. a vendor SDK like Privy) arriving
      // first would otherwise set parentOriginRef to our own origin, and replies
      // would post to spectre-trading.vercel.app while the recipient window is
      // spectre-app-research.vercel.app → "target origin does not match" + the
      // message is dropped (token/theme/watchlist sync silently breaks).
      if (!parentOriginRef.current && event.origin !== window.location.origin) {
        parentOriginRef.current = event.origin
      }

      const { type, payload } = event.data || {}

      // Cross-site demo token (SEC-20260521-DEMOTOKEN). event.origin is already
      // verified against the research allowlist by isAllowedParentOrigin above.
      // Handled first so the token is set before any select-token data fetch.
      if (type === 'spectre:demo-token' && payload?.token) {
        setDemoToken(payload.token)
        return
      }

      if (type === 'spectre:select-token' && payload) {
        // Parent-driven - flag it so the token-changed effect below doesn't
        // echo this right back to the parent.
        tokenSyncSourceRef.current = 'remote'
        setToken(payload)
        localStorage.setItem('spectre-selected-token', JSON.stringify(payload))
        prewarmTokenDetailsCache(payload)
        prefetchChartBars(payload.address, payload.networkId)
        prefetchLatestTrades(payload.address, payload.networkId)
      }

      if (type === 'spectre:set-theme') {
        const isLight = payload?.dayMode
        document.body.classList.toggle('theme-light', isLight)
        localStorage.setItem('spectre-color-mode', isLight ? 'light' : 'dark')
        // Token coloring setting from the research app. Writes the STORE, not
        // the DOM: React owns that class now (see the className above), so an
        // imperative classList.toggle would be wiped by the next render.
        if ('tokenColoring' in (payload || {})) {
          useSettingsStore.getState().setTokenColoring(payload.tokenColoring)
        }
      }

      if (type === 'spectre:watchlist-sync' && Array.isArray(payload?.tokens)) {
        // The trading terminal is crypto/DEX-only — it has no data for stocks.
        // Drop any stock entries the research watchlist sends so Trading Lite
        // never shows AAPL/MSFT/etc. (and they're stripped from localStorage too).
        const isStockTok = (t) => !!(t && (t.isStock || t.assetClass === 'stock' || t.type === 'stock'))
        const normalized = payload.tokens
          .filter((t) => !isStockTok(t))
          .map((t) => ({
            symbol: t.symbol,
            name: t.name,
            address: t.address,
            networkId: t.networkId,
            pinned: t.pinned || false,
            logo: t.logo,
            isStock: false,
            price: t.price || 0,
            change: t.change || 0,
            verified: t.verified ?? false,
          }))
        // Merge instead of overwrite so trading-only adds aren't clobbered
        // by stale parent state. Parent's tokens come first (preserve order),
        // then any local-only tokens append in their existing order.
        let mergedHadLocalOnly = false
        setWatchlistState((prev) => {
          const parentIds = new Set(normalized.map((t) => (t.address || t.symbol)))
          // Exclude stocks from local-only too, so any previously-persisted
          // stock entries get cleared on the next sync instead of lingering.
          const localOnly = (prev || []).filter((t) => !parentIds.has(t.address || t.symbol) && !isStockTok(t))
          mergedHadLocalOnly = localOnly.length > 0
          const merged = [...normalized, ...localOnly]
          localStorage.setItem('spectre-watchlist', JSON.stringify(merged))
          return merged
        })
        hasReceivedParentSyncRef.current = true
        // Only suppress the upstream echo when the merge is identical to what
        // parent sent. If we kept local-only tokens, parent doesn't know about
        // them yet - let the effect push the merged result back so research's
        // active watchlist gets reconciled with trading's local additions.
        if (!mergedHadLocalOnly) {
          watchlistSyncSourceRef.current = 'remote'
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [isEmbedded])

  // Stable callback that delegates to the toast widget's internal trigger.
  // Accepts an optional second arg { variant: 'destructive' } for red unlink /
  // delete toasts (2026-05-23); default green check for success.
  const triggerCopyToast = useCallback((message = 'CA copied to clipboard', options) => {
    copyToastTriggerRef.current?.(message, options)
  }, [])
  // Default SPECTRE token - can be changed when user searches
  const defaultToken = {
    symbol: 'SPECTRE',
    name: 'Spectre AI',
    address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6',
    networkId: 1,
    description: '',
    price: 0,
    change: 0,
    verified: true,
    socials: { twitter: 'https://x.com/Spectre__AI' }
  }
  
  // Price alerts via Codex webhooks
  const { alerts, rules, triggered, triggeredAlerts, createAlert, updateAlert, deleteAlert, deleteTriggered, dismissTriggered } = useAlerts()
  const { unseenCount: unseenAlerts, markSeen: markAlertsSeen, seenTs: alertsSeenTs } = useAlertsSeen(triggered)

  // Opening the drawer calls markAlertsSeen(), which moves alertsSeenTs to
  // now — that would clear the unseen highlight on the very rows the user
  // opened the drawer to read. Freeze the watermark at open time instead;
  // the badge still clears immediately, the rows stay highlighted until the
  // drawer is closed and reopened.
  const openNotifications = useCallback(() => {
    setNotifSeenAtOpen(alertsSeenTs)
    setNotifOpen(true)
    markAlertsSeen()
  }, [alertsSeenTs, markAlertsSeen])

  // When spreading defaultToken into a placeholder for a DIFFERENT
  // address, strip the socials block — otherwise SPECTRE's twitter handle
  // bleeds into unrelated tokens and downstream consumers (LeftPanel's
  // tweet fetch in particular) have to ignore token.socials entirely
  // until tokenDetails resolves. With socials stripped, the tweet fetch
  // can speculatively start the moment the user clicks a token whose
  // socials are known from the search/watchlist payload.
  const spreadDefault = (overrides) => {
    const base = { ...defaultToken, ...overrides }
    const sameAddress = overrides.address && overrides.address.toLowerCase() === defaultToken.address.toLowerCase()
    if (!sameAddress) base.socials = undefined
    return base
  }

  const [token, setToken] = useState(() => {
    // When embedded, try to parse initial token from URL params
    if (isEmbedded) {
      const params = new URLSearchParams(window.location.search)
      const address = params.get('token')
      const networkId = parseInt(params.get('networkId') || '1', 10)
      if (address && address.toLowerCase() !== defaultToken.address.toLowerCase()) {
        return spreadDefault({ address, networkId })
      }
      return defaultToken
    }
    // If deep-link address exists, use it as placeholder UNLESS the
    // localStorage cache happens to be for the SAME address — in that
    // case load it instead, so a hard-refresh of a previously-visited
    // token boots with the correct symbol/name/logo immediately.
    //
    // Previously this branch always seeded the placeholder `symbol: '...'`
    // and waited for the async deep-link resolver to call selectToken.
    // If the resolver silently failed (search returned nothing, network
    // hiccup, etc.) `token.symbol` stayed at `'...'` forever, and every
    // hook reading `token.symbol` (useAccentTheme, etc.) was stuck on
    // the placeholder. Only the visible UI looked right because
    // `liveTokenData.symbol` (fetched separately by RightPanel)
    // populated the banner text.
    if (deepLinkAddressRef.current) {
      const deepLinkAddr = deepLinkAddressRef.current.toLowerCase()
      // Phase C: hot-cache check FIRST. If the user just navigated
      // away and came back (hash navigation), the in-memory LRU has
      // the full payload with no localStorage round-trip needed.
      // Survives unmount; dies on hard refresh.
      const hot = readHotPayload(deepLinkAddr)
      if (hot && (hot.address || '').toLowerCase() === deepLinkAddr) {
        mark('hot-cache-hit')
        return hot
      }
      try {
        const saved = localStorage.getItem('spectre-selected-token')
        if (saved) {
          const t = JSON.parse(saved)
          if (t?.address && t.address.toLowerCase() === deepLinkAddr) {
            // Same token the user visited recently — use the cached data
            // (already has symbol, name, logo, etc). The deep-link
            // resolver still runs and will refresh values if a newer
            // selectToken call arrives, but in the meantime every
            // consumer reads valid data.
            return t
          }
        }
      } catch {/* corrupt localStorage — fall through to placeholder */}
      // GP7: persisted hot-cache slice (last 4 tokens, 24h gate). Lets a
      // hard refresh / next-session visit of any RECENT token (not just
      // the single spectre-selected-token) paint real symbol/price/logo +
      // the correct accent on frame 1 while the resolver live-refreshes.
      const persisted = readPersistedHot(deepLinkAddr)
      if (persisted?.payload && (persisted.payload.address || '').toLowerCase() === deepLinkAddr) {
        mark('persisted-hot-hit')
        if (persisted.color && persisted.payload.logo) seedColorCache(persisted.payload.logo, persisted.color)
        return persisted.payload
      }
      // No cached payload for this address → we don't know its chain yet.
      // inferNetworkId returns a real chain for Solana (base58) but defaults
      // EVM (0x) to Ethereum (1) — that "1" is a GUESS, not knowledge. Flag it
      // so the token view waits for the resolver to confirm the real chain
      // before painting (see the chainReady gate below).
      const guessedNetworkId = inferNetworkId(deepLinkAddressRef.current, 1)
      if (guessedNetworkId === 1) deepLinkChainUnknownRef.current = true
      return spreadDefault({ address: deepLinkAddressRef.current, networkId: guessedNetworkId, symbol: '...', name: '' })
    }
    // Check if there's a saved selected token
    const saved = localStorage.getItem('spectre-selected-token')
    if (saved) {
      try {
        const t = JSON.parse(saved)
        // Fix networkId for Solana addresses stored with wrong chain
        if (t.address) {
          const corrected = inferNetworkId(t.address, t.networkId)
          if (corrected !== t.networkId) {
            t.networkId = corrected
            localStorage.setItem('spectre-selected-token', JSON.stringify(t))
          }
        }
        return t
      } catch {
        return defaultToken
      }
    }
    return defaultToken
  })

  // Gate the token view until the deep-link chain is confirmed. Starts false
  // ONLY for a fresh bare-EVM deep-link with an unknown chain; every other path
  // (in-app nav, embedded, Solana, cached/returning token) starts ready and is
  // unaffected. The resolver flips it true on settle, and a hard timeout flips
  // it true no matter what — so this can never wedge worse than before.
  const [chainReady, setChainReady] = useState(() => !deepLinkChainUnknownRef.current)

  // Persistent-token-view warm flag - consumed by mountTokenView (see the
  // block above appContent). Latches true on the first token-view visit
  // (leaving then PARKS the view instead of unmounting it), or after a short
  // welcome/trending idle so even the first entry lands on a live TV widget.
  const [tokenViewWarm, setTokenViewWarm] = useState(false)
  useEffect(() => {
    if (tokenViewWarm || isMobile || isEmbedded) return undefined
    const onTokenView = currentView !== 'user-dashboard' && currentView !== 'trending' && currentView !== 'welcome'
    if (onTokenView) { setTokenViewWarm(true); return undefined }
    // 4s + idle keeps the welcome surface's own first paint and data burst
    // ahead of the hidden token view's fan-out.
    const hold = setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => setTokenViewWarm(true), { timeout: 3000 })
      else setTimeout(() => setTokenViewWarm(true), 800)
    }, 4000)
    return () => clearTimeout(hold)
  }, [tokenViewWarm, currentView, isMobile, isEmbedded])

  // Alert target lines for the chart: active price-type rules on the
  // CURRENT token only. pct rules have no fixed price level so they never
  // draw. Address compare is lowercase-both-sides (rule storage and token
  // state don't consistently agree on case); networkId must also match so
  // a same-address-different-chain collision never draws the wrong line.
  const alertLines = useMemo(() => {
    if (!rules?.length || !token?.address) return []
    const addr = token.address.toLowerCase()
    const netId = token.networkId || 1
    return rules
      .filter(r => r.type === 'price'
        && r.status === 'active'
        && (r.token?.address || '').toLowerCase() === addr
        && (r.token?.networkId || 1) === netId)
      .map(r => ({ id: r.id, price: r.condition?.targetPrice, direction: r.condition?.direction }))
      .filter(l => l.price > 0)
  }, [rules, token?.address, token?.networkId])

  // Prefetch token data immediately on mount (before lazy components load).
  // GP5 single-data-path: on a cold deep-link mount (the resolver effect
  // below will run right after) or when a snapshot is already in flight
  // (boot script / prior selectToken), ride the ONE aggregate snapshot -
  // details + bars + trades + color cross the wire once instead of as 3-4
  // individual requests that the snapshot then re-transfers. The individual
  // prefetches remain as the null-fallback (snapshot disabled / 404 / miss),
  // which is byte-for-byte today's behavior.
  useEffect(() => {
    if (currentView !== 'token' || !token?.address) return
    // Chain-unknown deep-link: DON'T speculatively fetch on the guessed chain
    // (Ethereum). The resolver below confirms the real chain and its
    // selectToken() drives the correct-chain fetch — this skip removes the
    // wrong-chain snapshot that used to seed the chart with empty candles.
    if (deepLinkChainUnknownRef.current) return
    const addr = token.address
    const nid = token.networkId || 1
    // Chart bars prefetch fires UNCONDITIONALLY (TTL-aware + deduped): the
    // snapshot's compact bar slice is THIN now that history flows raw
    // (no forward-fill), so the chart's own wide fetch is always needed -
    // starting it here (~300ms) overlaps widget init (~600ms) instead of
    // running serially after it (measured: first candles 1.9s -> ~1.2s).
    prefetchChartBars(addr, nid)
    const fallbackPrefetch = () => {
      prefetchTokenDetails(addr, nid)
      prefetchLatestTrades(addr, nid)
    }
    const deepLinkPending = !!deepLinkAddressRef.current && !deepLinkResolvedRef.current
    if (deepLinkPending || hasSnapshotPending(addr, nid)) {
      fetchTokenSnapshot(addr, nid)
        .then((snap) => {
          if (snap) {
            seedCachesFromSnapshot(snap)
            mark('snapshot-fast-applied')
            // phase=fast backfill: trades lost its 900ms server race - pull
            // them in the background (joins the server-side inflight, so
            // this is usually a cheap cache hit by the time it lands).
            if (Array.isArray(snap.pending) && snap.pending.includes('trades')) {
              Promise.resolve(prefetchLatestTrades(addr, nid))
                .then(() => mark('snapshot-trades-applied'))
                .catch(() => { /* trades hook backfills on mount anyway */ })
            }
          } else {
            fallbackPrefetch()
          }
        })
        .catch(() => fallbackPrefetch())
      return
    }
    fallbackPrefetch()
  }, []) // eslint-disable-line -- intentionally run once on mount only

  // Apply page background colors derived from the token brand.
  // 1. Sync paint with hash/dictionary color so unknown tokens never flash gray.
  // 2. Race server + canvas logo-color extractors; the first non-default wins
  //    and re-applies the color tree, so every token's page-level orbs end up
  //    matching its actual logo dominant hue.
  useEffect(() => {
    if (currentView !== 'token' || !token) return
    let cancelled = false
    const root = document.documentElement
    const apply = (color) => {
      if (cancelled || !color) return
      const bg = generateTokenBackgroundColors(color)
      root.style.setProperty('--token-bg-primary', bg.primary)
      root.style.setProperty('--token-bg-secondary', bg.secondary)
      root.style.setProperty('--token-bg-tertiary', bg.tertiary)
      root.style.setProperty('--token-bg-accent-1', bg.accent1)
      root.style.setProperty('--token-bg-accent-2', bg.accent2)
      root.style.setProperty('--token-grid-color', bg.grid)
      root.style.setProperty('--token-diagonal-1', bg.diagonal1)
      root.style.setProperty('--token-diagonal-2', bg.diagonal2)
      root.style.setProperty('--token-orb-1', bg.orb1)
      root.style.setProperty('--token-orb-2', bg.orb2)
      root.style.setProperty('--token-orb-3', bg.orb3)
      root.dataset.tokenColorReady = 'true'
    }
    const logoUrl = token.logo || token.image || null
    const cached = getCachedColor(logoUrl)
    // Compute target color once. Only apply when we have a REAL brand color —
    // never paint the page orbs with NEUTRAL/hash. Page-level CSS hides orbs
    // when --token-color-ready is missing, so banner waits silently for canvas.
    let realColor = null
    // Curated dictionary beats ALL extracted sources for known tokens
    // (server-attached dominantColor is from canvas write-throughs that pick
    // up incidental hues, not the brand color).
    if (hasKnownColor(token.symbol)) realColor = getTokenColor(token.symbol, token.address)
    else if (token.dominantColor && token.dominantColor !== '#D4D4D8') realColor = token.dominantColor
    else if (cached) realColor = cached
    if (realColor) {
      apply(realColor)
    } else {
      root.dataset.tokenColorReady = 'false'
    }
    const needsExtraction = !realColor

    if (logoUrl && needsExtraction) {
      // Server cache first (fast), canvas as fallback (slow but accurate).
      fetchTokenColorFromServer(logoUrl).then(async (serverColor) => {
        if (cancelled) return
        // serverColor is `null` on failure now (was `#D4D4D8` pre-fix).
        if (serverColor) { apply(serverColor); return }
        const canvasColor = await extractColorFromImage(logoUrl).catch(() => null)
        if (cancelled) return
        if (canvasColor) { apply(canvasColor); return }
        // Both extractors failed - fall back to deterministic hash-derived hue
        // so orbs aren't stranded on NEUTRAL forever.
        const fallback = getTokenColor(token.symbol, token.address)
        if (fallback && fallback !== '#D4D4D8') apply(fallback)
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [currentView, token])

  // Iteration 3 — adaptive accent. Resolves the active token's brand
  // colour (curated → cached canvas → server) and writes --accent*
  // custom properties on `.app.token-page`. The colour cross-fades
  // smoothly because design-tokens.css registers --accent* via
  // @property + declares a transition on the same root element.
  // A user-chosen accent (skin / accent picker) OUTRANKS per-token
  // theming: when accentColor is set the hook disables, clears its token
  // ramp and hands the channel back to the user's accent — otherwise a
  // skin would look dead exactly where traders live, the token page.
  useAccentTheme(token, { enabled: currentView === 'token' && !!token && !accentColor })

  // Function to select a new token from search results
  const selectToken = useCallback((tokenData, source = 'unknown') => {
    mark('select-token')
    const logo = tokenData.logo || tokenData.token?.info?.imageThumbUrl
    // The CoinGecko-backed "Top Coins" feed hands majors NO on-chain address
    // (dev: null; prod: a CoinGecko slug like "bitcoin"), so the Codex
    // detail/bars/holders pipeline can't resolve them and the token page loads
    // empty (chart hangs, mcap/liquidity/holders read 0). Map such majors to
    // their tradeable on-chain proxy (BTC->WBTC, ETH->WETH, SOL, BNB, ...) via
    // the shared MAJOR_TOKEN_ADDR registry - the same contract the header
    // search + command palette already inject, so every entry point resolves
    // consistently. Keyed off the SYMBOL so it works in dev and prod alike
    // regardless of the null-vs-slug address divergence.
    const rawAddr = tokenData.address || tokenData.token?.address || null
    const isContractAddr = !!rawAddr && (
      (rawAddr.startsWith('0x') && rawAddr.length === 42) ||
      (rawAddr.length >= 32 && rawAddr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(rawAddr))
    )
    const majorProxy = !isContractAddr
      ? MAJOR_TOKEN_ADDR[String(tokenData.symbol || tokenData.token?.symbol || '').replace(/^\$/, '').toUpperCase()]
      : null
    // CoinGecko-only majors (XRP/ADA/TON/...) have NO on-chain proxy contract but
    // DO carry a CoinGecko id - dev gives `cgId`, prod jams the slug into address.
    // Use that slug AS the address so (a) it's non-null in dev too (so the token
    // page re-fetches on switch instead of seeing an unchanged null address) and
    // (b) the CoinGecko detail + bars paths key off it. Contract/wrapped tokens
    // skip this (a real contract or a MAJOR_TOKEN_ADDR proxy wins).
    const cgSlug = tokenData.cgId || (!isContractAddr && rawAddr ? rawAddr : null)
    const resolvedAddress = majorProxy?.address || (isContractAddr ? rawAddr : (cgSlug || rawAddr))
    const resolvedNetworkId = majorProxy
      ? majorProxy.networkId
      : inferNetworkId(resolvedAddress, tokenData.networkId || tokenData.token?.networkId)
    const newToken = {
      symbol: tokenData.symbol || tokenData.token?.symbol,
      name: tokenData.name || tokenData.token?.name,
      address: resolvedAddress,
      cgId: cgSlug || tokenData.cgId || null,
      networkId: resolvedNetworkId,
      description: tokenData.description || '',
      price: tokenData.price || 0,
      change: tokenData.change || tokenData.change24h || 0,
      change1h: tokenData.change1h || 0,
      change4h: tokenData.change4h || 0,
      change12h: tokenData.change12h || 0,
      change24h: tokenData.change24h || tokenData.change || 0,
      verified: tokenData.verified || false,
      socials: tokenData.socials || {},
      logo,
      // Carry through server-attached or already-cached dominant color so the
      // banner paints the right hue on first frame instead of flashing NEUTRAL.
      dominantColor: tokenData.dominantColor || tokenData.token?.dominantColor || getCachedColor(logo) || null,
      marketCap: tokenData.marketCap || 0,
      volume24: tokenData.volume24 || tokenData.volume24h || 0,
      circulatingSupply: tokenData.circulatingSupply || 0,
      totalSupply: tokenData.totalSupply || 0,
      liquidity: tokenData.liquidity || 0
    }
    setToken(newToken)
    // Analytics + the JSON.stringify localStorage write run AFTER the click
    // frame (idle, ~500ms ceiling + pagehide flush below). Safe to defer: the
    // only same-session reader of 'spectre-selected-token' is a fallback
    // behind the module cache that prewarmTokenDetailsCache seeds
    // synchronously; the write only matters for hard-refresh restore.
    const deferredCreatedAt = tokenData.createdAt || tokenData.token?.createdAt || null
    const deferredSource = source
    _pendingTokenWriteRef.current = () => {
      try { localStorage.setItem('spectre-selected-token', JSON.stringify(newToken)) } catch (e) { /* quota */ }
      _pendingTokenWriteRef.current = null
    }
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 120))
    idle(() => {
      _pendingTokenWriteRef.current?.()
      track(Events.TOKEN_VIEWED, {
        symbol: newToken.symbol,
        token_name: newToken.name || null,
        token_address: newToken.address || null,
        network_id: newToken.networkId || null,
        source: deferredSource,
      })
      // Count this token-page view toward the "Most Visited" tab.
      recordTokenView({ ...newToken, createdAt: deferredCreatedAt })
    }, { timeout: 500 })
    // Phase C: write to hot cache so a re-mount within 5min paints from
    // memory (zero network roundtrip). Survives unmount across hash
    // navigation; dies on hard refresh. The clicked ROW's sparkline closes
    // ride along (hot-payload ONLY - newToken stays clean for the
    // 'spectre-selected-token' localStorage write above) so the chart
    // placeholder paints a real curve instantly on never-seen tokens.
    const rowSpark = Array.isArray(tokenData.sparkline) && tokenData.sparkline.length >= 2
      ? tokenData.sparkline.slice(-60)
      : undefined
    writeHotPayload(newToken.address, rowSpark ? { ...newToken, sparkline: rowSpark } : newToken)
    // Pre-warm caches so hooks return data instantly when chunks mount.
    // Row data covers the first paint; the ONE aggregate snapshot carries
    // details + bars + trades + color across the wire. The individual
    // prefetches run ONLY as the null/error fallback (snapshot disabled /
    // 404 / miss) - firing them unconditionally alongside the snapshot
    // double-transferred every byte on every token click (measured:
    // details x2 + redundant bars + trades per click). Mirrors the mount
    // effect's proven snapshot-first pattern above.
    prewarmTokenDetailsCache(newToken)
    // BARS ON THE CLICK, not when the chart gets around to asking. The chart's
    // own fetch starts only once TV has mounted and called getBars - measured
    // on prod 2026-08-04, welcome -> token: click at 0, getBars at 474ms, bars
    // back at 1259ms. Those 474ms are pure widget construction, and the request
    // sat behind them for no reason.
    //
    // This is not an extra call. prefetchChartBars uses the SAME wide shape at
    // the SAME saved resolution and stores its in-flight promise under the key
    // getCachedBars reads first, so the datafeed awaits this request instead of
    // making its own. The snapshot cannot cover it either: measured head-to-head
    // on 7 tokens it needs 1352-2348ms, so it has never once answered before TV
    // asks - the second fetch happens today regardless, just later.
    //
    // TTL-deduped, so the fallback below re-calling it is a free no-op.
    prefetchChartBars(newToken.address, newToken.networkId)
    const fallbackPrefetch = () => {
      prefetchTokenDetails(newToken.address, newToken.networkId || 1)
      prefetchChartBars(newToken.address, newToken.networkId)
      prefetchLatestTrades(newToken.address, newToken.networkId)
    }
    fetchTokenSnapshot(newToken.address, newToken.networkId).then((snap) => {
      if (snap) {
        writeHotSnapshot(newToken.address, snap)
        // Fan the snapshot into the hooks' module caches (details / bars /
        // trades / color) so they consume the bytes already on the wire
        // instead of re-fetching.
        seedCachesFromSnapshot(snap)
        markAndMeasure('cold-snapshot-applied', 'select-token')
        mark('snapshot-fast-applied')
        // phase=fast backfill: trades lost its 900ms server race - pull them
        // in the background (joins the server-side inflight).
        if (Array.isArray(snap.pending) && snap.pending.includes('trades')) {
          Promise.resolve(prefetchLatestTrades(newToken.address, newToken.networkId))
            .then(() => mark('snapshot-trades-applied'))
            .catch(() => { /* trades hook backfills on mount anyway */ })
        }
      } else {
        fallbackPrefetch()
      }
    }).catch(() => fallbackPrefetch())
    navigateTo('token', newToken.address)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateTo])

  // Deep-link resolver: resolve a token by address and select it. Used by
  // (a) the mount effect below (address saved during useState init) and
  // (b) handlePopState for raw hash navigation to a different token
  // (address-bar paste/edit fires popstate with NO history state, so the
  // mount initialiser never re-runs). Kept on a ref so the popstate
  // listener (registered once) always calls the current-render closure.
  //
  // Phase B fast path: getDetailedTokenInfo first (exact-by-address,
  // ~200-400ms cold), searchTokens only as last-resort fallback.
  // Pre-Phase-B this loop called searchTokens first — a fuzzy ~800-1200ms
  // round-trip we don't need when we already have the exact address. The
  // 1s/2s/3s exponential backoff on error is replaced by a single 200ms
  // retry (was burning up to 6s on transient Vite-proxy-boot errors
  // before bailing). Net: deep-link cold load drops from ~1.5-2s to
  // ~250-450ms on the happy path, and worst-case error from 6s to ~250ms.
  const resolveDeepLink = async (address) => {
    {
      // Normalise the address for case-insensitive comparison. EVM addresses
      // arrive in mixed case (checksummed) from URLs, but Codex returns them
      // lowercase. Compare lowercased on both sides.
      const wantedAddr = address.toLowerCase()
      const networkId = inferNetworkId(address, 1)

      // Deep-link fast start (2026-08-05): bars are keyed by address:networkId
      // only, and a base58 address IS Solana - the networkId is certain before
      // any resolution. Start the chart's wide prefetch NOW so it overlaps the
      // identity resolution (measured ~1-2.3s on prod) instead of starting
      // after selectToken; the dedup in prefetchChartBars makes selectToken's
      // own later prefetch a free cache join. EVM 0x addresses deliberately
      // stay untouched: the chain (1/56/8453/...) is unknowable from the hash,
      // and a guessed networkId keys a wrong cache entry plus a billed empty
      // Codex call (the exact trap navigateTo's prefetch comment warns about).
      if (networkId === 1399811149) {
        try { prefetchChartBars(address, networkId) } catch { /* best-effort */ }
      }

      // GP5: race the aggregate snapshot AGAINST the details fast path -
      // CONCURRENTLY, first valid-and-matching result wins. The snapshot
      // carries details+bars+trades+color in one response (and the mount
      // prefetch above already joins this same in-flight promise), but it
      // must never make resolution SLOWER than the lone details call when
      // the snapshot endpoint is missing/cold - hence a race, not a chain.
      // selectToken's own fetchTokenSnapshot call then hits the 30s client
      // cache, so the snapshot is fetched exactly once.
      let settled = false
      // Open the chain gate: the real chain is now known (or we're giving up),
      // so the token view can paint. Clears the failsafe timer.
      const openChainGate = () => {
        if (chainGateTimerRef.current) { clearTimeout(chainGateTimerRef.current); chainGateTimerRef.current = null }
        setChainReady(true)
      }
      // Failsafe: never strand the token view on the skeleton (unindexed token /
      // network hiccup). After 3s open the gate anyway and fall back to the
      // pre-fix behavior (render on the placeholder, self-correct on any later
      // selectToken). Only armed for the chain-unknown case.
      if (deepLinkChainUnknownRef.current && !chainGateTimerRef.current) {
        chainGateTimerRef.current = setTimeout(() => { chainGateTimerRef.current = null; setChainReady(true) }, 3000)
      }
      const settle = (payload, snap = null) => {
        if (settled || !payload) return false
        settled = true
        if (snap) {
          writeHotSnapshot(address, snap)
          seedCachesFromSnapshot(snap)
        }
        selectToken(payload, 'deeplink')
        openChainGate()
        return true
      }

      const snapshotArm = (async () => {
        try {
          const snap = await fetchTokenSnapshot(address, networkId)
          const d = snap?.details
          if (!d || !d.name) return false
          const snapAddr = String(d.address || snap.address || address).toLowerCase()
          if (snapAddr !== wantedAddr) return false
          return settle({
            symbol: d.symbol,
            name: d.name,
            address: d.address || address,
            networkId: inferNetworkId(d.address || address, d.networkId || snap.networkId),
            price: d.price || 0,
            logo: d.logo || '',
          }, snap)
        } catch { return false }
      })()

      const tryDetails = async () => {
        const details = await getDetailedTokenInfo(address, networkId)
        if (!details || !details.name) return false
        const detailsAddr = (details.address || address).toLowerCase()
        if (detailsAddr !== wantedAddr) {
          // Defense in depth: Codex sometimes returns a related token for
          // a missing address — reject the mismatch and fall through to
          // the fuzzy search fallback.
          console.warn('[deep-link] details mismatch — wanted', wantedAddr, 'got', detailsAddr)
          return false
        }
        return settle({
          symbol: details.symbol,
          name: details.name,
          address: details.address || address,
          networkId: inferNetworkId(details.address || address, details.networkId),
          price: details.price || 0,
          logo: details.logo || '',
        })
      }

      const trySearch = async () => {
        // Last-resort fuzzy search for tokens not yet indexed by Codex's
        // token() query (extremely rare — newly launched, low-liquidity).
        // The chain hint lets the server try ONE network before fanning out.
        const searchResult = await searchTokens(address, undefined, { networkId })
        const results = searchResult?.filterTokens?.results
        const exact = (results || []).find(r => {
          const a = (r.token?.address || r.address || '').toLowerCase()
          return a === wantedAddr
        })
        if (!exact) return false
        const r = exact
        return settle({
          symbol: r.token?.symbol || r.symbol,
          name: r.token?.name || r.name,
          address: r.token?.address || r.address || address,
          networkId: inferNetworkId(r.token?.address || r.address || address, r.token?.networkId || r.networkId),
          price: parseFloat(r.priceUSD) || 0,
          change: parseFloat(r.change24) || 0,
          volume24: parseFloat(r.volume) || 0,
          liquidity: parseFloat(r.liquidity) || 0,
          marketCap: parseFloat(r.marketCap) || 0,
          logo: getHardcodedLogo(r.token?.address || address) || r.token?.info?.imageThumbUrl || '',
        })
      }

      const detailsArm = (async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          if (settled) return true
          // details and search run in PARALLEL (2026-08-05): both settle only
          // on an exact address match, so whichever answers first wins safely.
          // Measured on prod fresh degens: search ~1.0s vs details ~1.6-2.3s -
          // the old sequential details-then-search chain was the deep-link
          // "2.3s before anything happens" delay. Errors are captured per-arm
          // so the proxy-not-ready retry below still fires only when BOTH
          // arms broke (vs one arm merely finding nothing).
          const run = async (fn) => {
            try { return { ok: await fn() } } catch (err) { return { err } }
          }
          const [d, s] = await Promise.all([run(tryDetails), run(trySearch)])
          if (d.ok || s.ok) return true
          if (d.err && s.err) {
            // Vite proxy may not be ready on initial page load — single
            // short retry, then bail (was 1s/2s/3s = 6s worst case).
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 200))
            } else {
              console.error('[deep-link] Failed to resolve token:', d.err)
            }
          } else {
            return false
          }
        }
        return false
      })()

      const [snapOk, detailsOk] = await Promise.all([snapshotArm, detailsArm])
      if (!snapOk && !detailsOk) {
        console.warn('[deep-link] Token not found:', address)
        openChainGate() // don't hold the skeleton — fall back to placeholder render
      }
    }
  }
  const resolveDeepLinkRef = useRef(null)
  resolveDeepLinkRef.current = resolveDeepLink
  // Current token address on a ref so the once-registered popstate listener
  // can compare without a stale closure.
  const currentTokenAddrRef = useRef(null)
  currentTokenAddrRef.current = token?.address || null
  // Paired networkId for navigateTo's no-click prefetch: only ever read
  // together with currentTokenAddrRef, so the pair is always consistent.
  const currentTokenNetRef = useRef(1)
  currentTokenNetRef.current = token?.networkId || 1

  // Deep-link: resolve token by address saved during useState init
  // Uses ref (not hash) because the history-init effect wipes the hash before this runs
  useEffect(() => {
    if (!deepLinkResolvedRef.current) {
      const address = deepLinkAddressRef.current
      if (address) {
        deepLinkResolvedRef.current = true
        resolveDeepLinkRef.current(address)
      }
    }
    return () => { if (chainGateTimerRef.current) { clearTimeout(chainGateTimerRef.current); chainGateTimerRef.current = null } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [stats] = useState({
    mcap: '12.76M',
    fdv: '14.87M',
    liquidity: '237.16K',
    circSupply: '9.99M',
    volume24h: '27.84K',
    holders: '8925'
  })

  // Chart view mode: 'trading' (normal) or 'xChart' (social overlay) or 'xBubbles'
  // Persist in localStorage
  const [chartViewMode, setChartViewModeState] = useState(() => {
    const saved = localStorage.getItem('spectre-chartViewMode')
    return saved || 'trading'
  })
  
  // useCallback so TradingChart's React.memo can actually hold - a fresh
  // function identity here would defeat it on every App render, which is the
  // whole point of memoizing a 5,285-line component.
  const setChartViewMode = useCallback((mode) => {
    setChartViewModeState(mode)
    localStorage.setItem('spectre-chartViewMode', mode)
  }, [])

  // Watchlist state with localStorage persistence - starts empty, user adds tokens.
  // Crypto/DEX terminal: strip any stock entries (no data for them here) so they
  // don't flash before the first parent sync clears them.
  const [watchlist, setWatchlistState] = useState(() => {
    const saved = localStorage.getItem('spectre-watchlist')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        return Array.isArray(parsed)
          ? parsed.filter((t) => !(t && (t.isStock || t.assetClass === 'stock' || t.type === 'stock')))
          : []
      } catch {
        return []
      }
    }
    return []
  })

  const addToWatchlist = useCallback((tokenData) => {
    track(Events.WATCHLIST_ACTION, { action: 'add', symbol: tokenData.symbol, token_address: tokenData.address || null })
    setWatchlistState(prev => {
      // Use address as unique identifier (falls back to symbol for legacy)
      const tokenId = tokenData.address || tokenData.symbol
      if (prev.some(t => (t.address || t.symbol) === tokenId)) {
        return prev
      }
      const updated = [...prev, tokenData]
      localStorage.setItem('spectre-watchlist', JSON.stringify(updated))
      return updated
    })
  }, [])

  const removeFromWatchlist = useCallback((identifier) => {
    track(Events.WATCHLIST_ACTION, { action: 'remove', symbol: identifier })
    setWatchlistState(prev => {
      // identifier can be address or symbol
      const updated = prev.filter(t => (t.address || t.symbol) !== identifier && t.symbol !== identifier)
      localStorage.setItem('spectre-watchlist', JSON.stringify(updated))
      return updated
    })
  }, [])

  const isInWatchlist = (identifier) => {
    // identifier can be address or symbol
    return watchlist.some(t => (t.address || t.symbol) === identifier || t.symbol === identifier)
  }

  const togglePinWatchlist = useCallback((identifier) => {
    const item = watchlist.find(t => (t.address || t.symbol) === identifier || t.symbol === identifier)
    const pinned = item ? !item.pinned : true
    track(Events.WATCHLIST_ACTION, { action: pinned ? 'pin' : 'unpin', symbol: identifier })
    setWatchlistState(prev => {
      const updated = prev.map(t =>
        (t.address || t.symbol) === identifier || t.symbol === identifier ? { ...t, pinned: !t.pinned } : t
      )
      localStorage.setItem('spectre-watchlist', JSON.stringify(updated))
      return updated
    })
  }, [watchlist]) // eslint-disable-line react-hooks/exhaustive-deps

  const reorderWatchlist = useCallback((newOrder) => {
    setWatchlistState(newOrder)
    localStorage.setItem('spectre-watchlist', JSON.stringify(newOrder))
  }, [])

  // On Privy login, pull server-side watchlist and MERGE with local — server
  // tokens come first (preserve their order), local-only adds append. Avoids
  // both losing local-only tokens AND missing server tokens added on another
  // device. The subsequent debounced push syncs the merged list back.
  const watchlistPulledRef = useRef(false)
  // Set while the NEXT `watchlist` change comes from the server pull below, so
  // the debounced push doesn't immediately PUT the list straight back to the
  // server it was just read from (measured: a PUT /api/user/watchlist on every
  // boot). A real user add/remove still pushes.
  const watchlistFromServerRef = useRef(false)
  useEffect(() => {
    if (!authenticated || watchlistPulledRef.current) return
    let cancelled = false
    watchlistPulledRef.current = true
    ;(async () => {
      try {
        // Ensure auth token is set before calling fetchWatchlist - useProfileSync
        // sets it too but may race with this effect on first login.
        const token = await getAccessTokenRef.current?.()
        if (cancelled) return
        if (token) setAuthToken(token)
        const result = await fetchWatchlist()
        if (cancelled || !result) return
        const serverTokens = Array.isArray(result) ? result : (result.watchlist || [])
        if (!Array.isArray(serverTokens) || serverTokens.length === 0) return
        watchlistFromServerRef.current = true
        setWatchlistState((prev) => {
          const serverIds = new Set(serverTokens.map((t) => (t.address || t.symbol)))
          const localOnly = (prev || []).filter((t) => !serverIds.has(t.address || t.symbol))
          const merged = [...serverTokens, ...localOnly]
          localStorage.setItem('spectre-watchlist', JSON.stringify(merged))
          return merged
        })
      } catch (err) {
        console.warn('[watchlist] server pull failed:', err?.message || err)
        watchlistPulledRef.current = false  // allow retry next mount
      }
    })()
    return () => { cancelled = true }
  }, [authenticated])

  // Debounced watchlist push to server. Short debounce + flush-on-unload so
  // adds aren't lost when the user closes the tab right after starring a token.
  const watchlistPushTimer = useRef(null)
  const watchlistRef = useRef(watchlist)
  watchlistRef.current = watchlist
  useEffect(() => {
    // This change is the server's own data landing - don't echo it back.
    if (watchlistFromServerRef.current) {
      watchlistFromServerRef.current = false
      return
    }
    clearTimeout(watchlistPushTimer.current)
    watchlistPushTimer.current = setTimeout(() => {
      pushWatchlist(watchlist).catch(() => {})
    }, 500)
  }, [watchlist])
  useEffect(() => {
    const flush = () => {
      if (watchlistPushTimer.current) {
        clearTimeout(watchlistPushTimer.current)
        watchlistPushTimer.current = null
        pushWatchlist(watchlistRef.current).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  // Send watchlist updates to parent when embedded (skip when change came from parent)
  useEffect(() => {
    if (!isEmbedded) return
    // Don't echo stale localStorage before receiving parent's authoritative sync
    if (!hasReceivedParentSyncRef.current) return
    if (watchlistSyncSourceRef.current === 'remote') {
      watchlistSyncSourceRef.current = null
      return
    }
    // Reply to the exact origin the parent's sync came from (captured on
    // first incoming message). If that didn't happen yet, bail - we'll send
    // on the next watchlist change once parent has talked to us.
    const targetOrigin = parentOriginRef.current
    if (!targetOrigin) return
    try {
      window.parent.postMessage(
        { type: 'spectre:watchlist-updated', payload: { tokens: watchlist } },
        targetOrigin
      )
    } catch { /* parent gone, ignore */ }
  }, [watchlist, isEmbedded])

  // Report LOCAL token switches (watchlist cards, search, ticker) to the
  // embedding /trade page so it can mirror the token into its URL. Parent-
  // driven selections are flagged 'remote' by the spectre:select-token handler
  // and skipped - no ping-pong. Until the parent has talked to us
  // (parentOriginRef null, e.g. the boot-time persisted token), nothing is
  // sent, so a stale localStorage token can never overwrite the parent's URL.
  useEffect(() => {
    if (!isEmbedded || !token) return
    if (tokenSyncSourceRef.current === 'remote') {
      tokenSyncSourceRef.current = null
      return
    }
    const targetOrigin = parentOriginRef.current
    if (!targetOrigin) return
    try {
      window.parent.postMessage(
        {
          type: 'spectre:token-changed',
          payload: {
            address: token.address || null,
            networkId: token.networkId || null,
            symbol: token.symbol || null,
            name: token.name || null,
            logo: token.logo || null,
            cgId: token.cgId || null,
          },
        },
        targetOrigin
      )
    } catch { /* parent gone, ignore */ }
  }, [token, isEmbedded])

  // ------------------------------------------------------------------
  // PERSISTENT TOKEN VIEW (2026-08-04). The token view used to be a branch
  // of the render ternary, so leaving it DESTROYED the TradingView widget
  // and every entry re-paid ~600-700ms of iframe + library construction
  // before the chart could even ask for bars (measured on prod: click ->
  // tv-resolve-enter at 476-806ms). Now the view mounts once and PARKS via
  // CSS (visibility, never display:none on the iframe's ancestors, and
  // NEVER a re-parent - moving the iframe in the DOM reloads it, the
  // wrong-chart bug class of 2026-07-09). Re-entry is a class flip on an
  // already-live widget; a welcome-idle premount makes even the FIRST
  // entry warm. Desktop only - mobile has its own shell and keeps the
  // mount-on-entry behavior. Cost while parked: the view's own polls keep
  // running for one token (that is what keeps the reveal current).
  const isTokenView = currentView !== 'user-dashboard' && currentView !== 'trending' && currentView !== 'welcome'
  const isTokenViewLive = isTokenView && chainReady
  const mountTokenView = isTokenViewLive || (tokenViewWarm && !isMobile && chainReady)

  const appContent = (
    <div
      className={`app ${currentView === 'token' ? 'token-page' : ''} ${isEmbedded ? 'app-embedded' : ''} ${decorSkin ? `skin-${decorSkin}` : ''} ${tokenColoring ? 'token-coloring' : ''}`}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
          {/* Obsidian & Lime: ambient aurora layer behind all content. Single
              mount, fixed-position, pointer-events:none, GPU-cheap. */}
          {!isEmbedded && <AuroraField />}
          {/* Decorative skin silhouettes (page-level half; the on-panel half
              is styles/skins.css). Mount-gated like AuroraField. */}
          {!isEmbedded && decorSkin && <SkinLayer />}
          {/* I2: suppression must also require !isMobile - the drawer that
              owns the only setNotifOpen(false) is unmounted on mobile, so
              gating on notifOpen alone can wedge shut if the breakpoint
              crosses while it's open (belt-and-suspenders alongside the
              close-on-breakpoint-cross effect above). */}
          {(!notifOpen || isMobile) && (
            <AlertNotification
              triggeredAlerts={triggeredAlerts}
              onDismiss={dismissTriggered}
              onNavigate={(address, networkId, symbol, logo) => {
                if (address) {
                  selectToken({ address, networkId: networkId || 1, symbol: symbol || '', logo: logo || '' }, 'alert')
                }
              }}
            />
          )}
          {!isEmbedded && !isMobile && (
            <NotificationDrawer
              open={notifOpen}
              onClose={() => setNotifOpen(false)}
              rules={rules}
              alerts={alerts}
              triggered={triggered}
              seenTs={notifSeenAtOpen}
              updateAlert={updateAlert}
              deleteAlert={deleteAlert}
              deleteTriggered={deleteTriggered}
              onSelectToken={(t) => {
                if (!t.tokenAddress) return
                selectToken({
                  address: t.tokenAddress,
                  networkId: t.networkId || 1,
                  symbol: t.symbol || (t.name || '').split(' ')[0] || '',
                  logo: t.logo || '',
                }, 'notification-drawer')
                setNotifOpen(false)
              }}
              onGoScreener={() => { setNotifOpen(false); navigateTo('welcome') }}
            />
          )}
          {!isEmbedded && (
            <Header
              addToWatchlist={addToWatchlist}
              removeFromWatchlist={removeFromWatchlist}
              isInWatchlist={isInWatchlist}
              selectToken={selectToken}
              onLogoClick={() => navigateTo('welcome')}
              navigateTo={navigateTo}
              onOpenCommandPalette={() => setPaletteOpen(true)}
              showLayoutControl={currentView === 'token' && !isMobile}
              onCustomizeLayout={openLayoutEditor}
              unseenAlerts={unseenAlerts}
              onOpenNotifications={openNotifications}
            />
          )}
          {/* Lazy-mount: CommandPalette only exists in the tree while open,
              so its useTokenSearch hook is dormant otherwise. */}
          {!isEmbedded && paletteOpen && (
            <CommandPalette
              isOpen={paletteOpen}
              onClose={() => setPaletteOpen(false)}
              onSelectToken={selectToken}
              onNavigate={navigateTo}
            />
          )}
          {!isEmbedded && <OnboardingPopup />}
          {/* Main Content - Welcome, User Dashboard, or Token Page */}
          {currentView === 'user-dashboard' ? (
            <LazyErrorBoundary>
              <Suspense fallback={<div className="token-page-loading" />}>
                <UserDashboard navigateTo={navigateTo} />
              </Suspense>
            </LazyErrorBoundary>
          ) : currentView === 'trending' ? (
            <LazyErrorBoundary>
              <Suspense fallback={<div className="token-page-loading" />}>
                <TrendingHub navigateTo={navigateTo} selectToken={selectToken} />
              </Suspense>
            </LazyErrorBoundary>
          ) : currentView === 'welcome' ? (
            isMobile ? (
              /* Mobile-native home: DexScreener-style screener shell with a
                 persistent bottom nav (Screener/Search/Watchlist/Alerts/Menu).
                 Desktop keeps the full Deal Room DiscoverPage. */
              <LazyErrorBoundary>
                <Suspense fallback={<div className="token-page-loading" />}>
                  <MobileHomeShell
                    selectToken={selectToken}
                    navigateTo={navigateTo}
                    watchlist={watchlist}
                    addToWatchlist={addToWatchlist}
                    removeFromWatchlist={removeFromWatchlist}
                    isInWatchlist={isInWatchlist}
                    alerts={alerts}
                    rules={rules}
                    updateAlert={updateAlert}
                    deleteAlert={deleteAlert}
                    triggered={triggered}
                    deleteTriggered={deleteTriggered}
                    unseenAlerts={unseenAlerts}
                    markAlertsSeen={markAlertsSeen}
                  />
                </Suspense>
              </LazyErrorBoundary>
            ) : (
              <DiscoverPage
                selectToken={selectToken}
                navigateTo={navigateTo}
              />
            )
          ) : !chainReady ? (
            /* Bare deep-link with an unresolved chain — hold the existing
               loading skeleton until the resolver confirms the real chain, so
               the token page never paints the wrong-chain (Ethereum-default)
               empty state (missing candles + "Series unavailable"). */
            <div className="token-page-loading" />
          ) : null}
          {/* Persistent token view: mounted while live OR parked (see the
              mountTokenView block above). The host div is display:contents
              when live - layout-identical to the old direct render - and a
              visibility-hidden fixed box when parked, so hiding never moves
              the TradingView iframe in the DOM (a re-parent reloads it). */}
          {mountTokenView && (
          <div className={isTokenViewLive ? 'token-view-host' : 'token-view-host token-view-host--parked'}>
            <TokenDetailsProvider address={token?.address} networkId={token?.networkId || 1}>
            {/* "CATE ↑ $58.74K | Spectre AI" in the browser tab, ticking even
                while the user is on another tab (GMGN parity). Sits inside
                the provider so it reads the same live price as the banner;
                inert while the token view is parked. */}
            <LiveTabTitle token={token} active={isTokenViewLive} />
            <LazyErrorBoundary>
              <Suspense fallback={<div className="token-page-loading" />}>
              {isMobile ? (
                /* Mobile-native single-column token page. */
                <MobileTokenPage
                  token={token}
                  selectToken={selectToken}
                  watchlist={watchlist}
                  addToWatchlist={addToWatchlist}
                  removeFromWatchlist={removeFromWatchlist}
                  togglePinWatchlist={togglePinWatchlist}
                  reorderWatchlist={reorderWatchlist}
                  chartViewMode={chartViewMode}
                  setChartViewMode={setChartViewMode}
                  alerts={alerts}
                  rules={rules}
                  alertLines={alertLines}
                  createAlert={createAlert}
                  updateAlert={updateAlert}
                  deleteAlert={deleteAlert}
                  onBack={() => navigateTo('welcome')}
                />
              ) : (
                <>
              {/* TokenTicker only on token page */}
              <TokenTicker selectToken={selectToken} selectedToken={token} />

              {/* Zone-Stacks layout: the 5 sections are DIRECT grid children in
                  FIXED DOM order (watch, banner, chart, txns, trade). Their
                  visual arrangement comes ONLY from the compiled inline grid
                  placement - React never reorders or re-parents them, so the
                  TradingView iframe survives every layout change and every
                  section keeps its state. Do NOT make section order
                  conditional; do NOT put transform/filter on wrappers. */}
              <main className="main-layout layout-managed" style={compiledLayout.containerStyle}>
                {/* Rail collapse handles live on zero-width rail-owned hosts
                    (not inside the sections) so they collapse whatever section
                    currently occupies the rail. Always rendered - a stable
                    sibling list keeps React from ever recreating the section
                    elements below. */}
                <div className="rail-toggle-host rail-toggle-host--left" style={compiledLayout.meta.leftEmpty ? { display: 'none' } : undefined}>
                  <button
                    className="panel-toggle panel-toggle-left"
                    onClick={() => setIsLeftPanelCollapsed(!isLeftPanelCollapsed)}
                    title={isLeftPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
                  >
                    <Icon name={isLeftPanelCollapsed ? 'chevron-right' : 'chevron-left'} size={20} />
                  </button>
                </div>
                <div className="rail-toggle-host rail-toggle-host--right" style={compiledLayout.meta.rightEmpty ? { display: 'none' } : undefined}>
                  <button
                    className="panel-toggle panel-toggle-right"
                    onClick={() => setIsRightPanelCollapsed(!isRightPanelCollapsed)}
                    title={isRightPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
                  >
                    <Icon name={isRightPanelCollapsed ? 'chevron-left' : 'chevron-right'} size={20} />
                  </button>
                </div>

                {/* GMGN-style rail width drag handles (wide viewports only) */}
                <RailGutter
                  side="left"
                  leftW={compiledLayout.meta.leftW}
                  rightW={compiledLayout.meta.rightW}
                  railCap={layoutViewport.railCap}
                  onCommit={commitRailWidth}
                  hidden={layoutViewport.tier !== 'wide' || isEmbedded || compiledLayout.meta.leftEmpty || isLeftPanelCollapsed}
                />
                <RailGutter
                  side="right"
                  leftW={compiledLayout.meta.leftW}
                  rightW={compiledLayout.meta.rightW}
                  railCap={layoutViewport.railCap}
                  onCommit={commitRailWidth}
                  hidden={layoutViewport.tier !== 'wide' || isEmbedded || compiledLayout.meta.rightEmpty || isRightPanelCollapsed}
                />

                {/* X/Watchlist + Trending/AI Logs */}
                <aside data-section="watch" className={`layout-section panel-left ${railCollapsed('watch') ? 'collapsed rail-collapsed' : ''}`} style={compiledLayout.sectionStyles.watch}>
                  <div className="panel-content">
                    <LeftPanel
                      chartViewMode={chartViewMode}
                      setChartViewMode={setChartViewMode}
                      watchlist={watchlist}
                      addToWatchlist={addToWatchlist}
                      removeFromWatchlist={removeFromWatchlist}
                      togglePinWatchlist={togglePinWatchlist}
                      reorderWatchlist={reorderWatchlist}
                      selectToken={selectToken}
                      token={token}
                      layoutParts={compiledLayout.meta.parts?.watch}
                    />
                  </div>
                </aside>

                <div data-section="banner" className="layout-section layout-section--banner" style={compiledLayout.sectionStyles.banner}>
                  {/* No `key` on purpose. A token-identity key here forced a
                      full unmount+remount of the banner (and RightPanel below)
                      on every token click - the app's highest-frequency
                      interaction - which is exactly what the layout note above
                      says must not happen. Both components now reset their own
                      token-scoped state in an explicit effect instead. */}
                  <TokenBanner
                    token={token}
                    isInWatchlist={isInWatchlist(token.address || token.symbol)}
                    addToWatchlist={addToWatchlist}
                    removeFromWatchlist={removeFromWatchlist}
                    alerts={alerts}
                    onCreateAlert={createAlert}
                    onDeleteAlert={deleteAlert}
                  />
                </div>

                <div data-section="chart" className="layout-section layout-section--chart" style={compiledLayout.sectionStyles.chart}>
                  {/* Neutral shimmer while the chunk loads (idle-prefetched, so
                      this window is ~0 in practice) - candles pop in directly,
                      no intermediate line-chart effect (Gleb 2026-07-09). */}
                  <Suspense fallback={<div className="chart-chunk-shimmer animate-shimmer" />}>
                    <TradingChart chartViewMode={chartViewMode} setChartViewMode={setChartViewMode} token={token} stats={stats} isCollapsed={isDataTabsExpanded} alertLines={alertLines} />
                  </Suspense>
                </div>

                <div data-section="txns" className={`layout-section layout-section--txns ${isDataTabsExpanded ? 'data-expanded' : ''}`} style={compiledLayout.sectionStyles.txns}>
                  <DataTabs token={token} isExpanded={isDataTabsExpanded} setIsExpanded={setIsDataTabsExpanded} />
                </div>

                {/* Research Zone + Stats + Trading */}
                <aside data-section="trade" className={`layout-section panel-right ${railCollapsed('trade') ? 'collapsed rail-collapsed' : ''}`} style={compiledLayout.sectionStyles.trade}>
                  <div className="panel-content">
                    <Suspense fallback={null}>
                      {/* No `key` - see the note on TokenBanner above. The swap
                          state that the key used to clear implicitly (amount,
                          quote, side, verdict) is reset explicitly inside
                          RightPanel and useSwapExecution. */}
                      <RightPanel token={token} layoutParts={compiledLayout.meta.parts?.trade} />
                    </Suspense>
                  </div>
                </aside>
              </main>
                </>
              )}
              </Suspense>
              {/* Spectre Agent - draggable copilot FAB + chat panel. Inside
                  TokenDetailsProvider (context assembler needs shared token
                  details). Desktop + embed; mobile mounts via MobileTokenPage
                  in Phase 5. */}
              {!isMobile && (
                <Suspense fallback={null}>
                  <SpectreAgentLauncher token={token} surface={isEmbedded ? 'embed' : 'desktop'} onSelectToken={selectToken} />
                </Suspense>
              )}
              {/* Customize-layout edit mode (portal to body; scrim owns all
                  pointer events so the TV iframe never sees the drags). */}
              {!isMobile && !isEmbedded && layoutEditorOpen && (
                <Suspense fallback={null}>
                  <LayoutEditor onClose={() => setLayoutEditorOpen(false)} />
                </Suspense>
              )}
            </LazyErrorBoundary>
            </TokenDetailsProvider>
          </div>
          )}

          {/* AI Assistant - disabled for now */}

          {/* Global Copy Toast - self-contained, no App re-renders */}
          <CopyToastWidget triggerRef={copyToastTriggerRef} />
    </div>
  )

  // Memoized so the provider value keeps ONE identity for the life of the app.
  // An inline `{{ triggerCopyToast }}` was a fresh object every App render, and
  // a context change BYPASSES React.memo - so every App render (watchlist edit,
  // 30s alerts refresh, resize, panel collapse, view switch) re-rendered all
  // five heavy consumers in full: DataTabs, LeftPanel, RightPanel, TokenBanner,
  // TradingChart. The memo on those four was inert on this path.
  // `triggerCopyToast` is useCallback([]) and dispatches through a ref, so the
  // freshest handler is always reached - nothing is captured stale here.
  // (Same fix research shipped in contexts/CopyToastContext.jsx.)
  const copyToastValue = useMemo(() => ({ triggerCopyToast }), [triggerCopyToast])

  return (
    <CopyToastContext.Provider value={copyToastValue}>
      {isEmbedded ? appContent : <AuthGate>{appContent}</AuthGate>}
      {DevAgentation && <Suspense fallback={null}><DevAgentation /></Suspense>}
    </CopyToastContext.Provider>
  )
}

export default App
