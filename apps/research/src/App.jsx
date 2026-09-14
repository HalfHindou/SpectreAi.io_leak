/**
 * Spectre AI Trading Platform
 * Providers + React Router routes only.
 */
import { Suspense, useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom'
// `lazyRoute`, not the default export: ONLY a route may hand off the boot
// skeleton. The shell chrome uses the same file's default export and must not,
// or its tiny chunks win the race and the skeleton lifts on a page that is
// still just icons — see the trap note in lib/lazy-with-retry.js.
import { lazyRoute as lazy } from '@/lib/lazy-with-retry'
import AuthGate from '@/components/auth-gate'
import DemoMode, { isDemoModeActive } from '@/demo/DemoMode'
import DemoLockGate from '@/components/demo-lock-gate'
import ShowcaseLockToast from '@/components/showcase-lock-toast'
import ComingSoonPlaceholder from '@/components/coming-soon-placeholder'
import { isComingSoonPath, getComingSoonIdForPath } from '@/constants/comingSoonPages'

/**
 * Paths the app is allowed to render when embedded inside the /website2
 * showcase iframe (?embed=showcase or any cross-frame embed).
 *
 * Marketing surface — everything else shows a Coming Soon toast and
 * redirects to /.
 */
const SHOWCASE_ALLOWED_PATHS = [
  /^\/$/,
  /^\/categories$/,
  /^\/categories\/[^/]+$/,
  /^\/bubbles$/,
  /^\/heatmaps$/,
  /^\/search-engine$/,
  /^\/economic-calendar$/,
  /^\/fear-greed$/,
  // Marketing pages themselves are allowed.
  /^\/website2(\/.*)?$/,
  /^\/lp$/,
]

export function detectShowcaseEmbed() {
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

export function isShowcasePathAllowed(pathname) {
  return SHOWCASE_ALLOWED_PATHS.some((re) => re.test(pathname))
}

export function fireShowcaseLockToast(detail = {}) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('spectre:showcase-lock', { detail }))
  } catch { /* noop */ }
}

/**
 * Global history.pushState / replaceState patch. Runs exactly once on
 * module load. When the app is embedded in the showcase iframe and
 * *anything* — React Router, an imperative navigate(), a direct
 * history API call, whatever — tries to push a locked path onto the
 * browser history, we swallow the push and fire the toast instead.
 * This kills the "awkward skip" because the URL never changes to the
 * locked path in the first place, so no locked page ever tries to
 * mount.
 */
let historyPatched = false
function patchHistoryForShowcase() {
  if (historyPatched || typeof window === 'undefined') return
  if (!detectShowcaseEmbed()) return
  historyPatched = true
  const origPush = window.history.pushState.bind(window.history)
  const origReplace = window.history.replaceState.bind(window.history)

  function extractPath(urlArg) {
    if (!urlArg) return null
    try {
      if (typeof urlArg === 'string') {
        if (urlArg.startsWith('/')) return urlArg.split('?')[0].split('#')[0]
        const u = new URL(urlArg, window.location.href)
        return u.pathname
      }
      if (urlArg.pathname) return urlArg.pathname
    } catch { /* noop */ }
    return null
  }

  window.history.pushState = function patchedPush(state, title, url) {
    const path = extractPath(url)
    if (path && !isShowcasePathAllowed(path)) {
      fireShowcaseLockToast({ source: 'history.pushState', path })
      return
    }
    return origPush(state, title, url)
  }
  window.history.replaceState = function patchedReplace(state, title, url) {
    const path = extractPath(url)
    if (path && !isShowcasePathAllowed(path)) {
      fireShowcaseLockToast({ source: 'history.replaceState', path })
      return origReplace(state, title, '/')
    }
    return origReplace(state, title, url)
  }
}
// Run at module load so the patch is active before any component mounts.
if (typeof window !== 'undefined') patchHistoryForShowcase()

/**
 * Route-level guard. Runs synchronously during render so locked routes
 * never mount — prevents the flash/skip/white-screen that used to happen
 * when the locked page's lazy chunk started to resolve. On a locked
 * navigation we fire a window event that ShowcaseLockToast listens for,
 * then replace the URL back to /.
 */
function EmbedGuard() {
  const location = useLocation()
  if (!detectShowcaseEmbed()) return <Outlet />
  const allowed = SHOWCASE_ALLOWED_PATHS.some((re) => re.test(location.pathname))
  if (allowed) return <Outlet />
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
        detail: { path: location.pathname },
      }))
    } catch { /* noop */ }
  }
  return <Navigate to="/" replace />
}

/**
 * ComingSoonGuard — blocks rendering of any route flagged as "Coming
 * Soon" in `constants/comingSoonPages.js`. In-app navigation (navigate,
 * <Link>, history.pushState) is already swallowed at the history layer
 * by `patchHistoryForComingSoon()` so the URL never changes. This guard
 * exists for the rare case where the user lands on a Coming Soon URL
 * directly (typed address, refresh, external deep-link): it fires the
 * "Coming Soon" toast and renders nothing — the AppShell chrome stays
 * visible around it, so the user sees an empty content area instead of
 * the locked page mounting. No redirect.
 */
function ComingSoonGuard() {
  const location = useLocation()
  if (!isComingSoonPath(location.pathname)) return <Outlet />
  const pageId = getComingSoonIdForPath(location.pathname)
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
        detail: {
          reason: 'coming-soon',
          source: 'route-guard',
          path: location.pathname,
          itemId: pageId,
        },
      }))
    } catch { /* noop */ }
  }
  return <ComingSoonPlaceholder pageId={pageId} pathname={location.pathname} />
}

/**
 * Belt-and-suspenders sentinel. Runs OUTSIDE the route tree so it fires
 * on EVERY pathname change — even programmatic history.pushState from
 * code that bypasses React Router. If we land on a locked path while
 * embedded, imperatively replace the URL to / and fire the toast event.
 */
function ShowcaseLockSentinel() {
  const location = useLocation()
  useEffect(() => {
    if (!detectShowcaseEmbed()) return
    const allowed = SHOWCASE_ALLOWED_PATHS.some((re) => re.test(location.pathname))
    if (allowed) return
    try {
      window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
        detail: { path: location.pathname },
      }))
    } catch { /* noop */ }
    try {
      window.history.replaceState(null, '', '/')
    } catch { /* noop */ }
  }, [location.pathname])
  return null
}
import AppShell from '@/components/layouts/app-shell'
import PageShell from '@/components/layouts/page-shell'
import PageErrorBoundary from '@/components/page-error-boundary'
import RouteFallback from '@/components/route-fallback'
import RouteMeta from '@/components/route-meta'
import { I18nCurrencyProvider } from '@/contexts/I18nCurrencyContext.jsx'
import { CopyToastProvider } from '@/contexts/CopyToastContext'
import { AppStateProvider } from '@/contexts/AppStateContext'
import { MonarchProvider } from '@/contexts/MonarchContext'
import { WatchlistsProvider } from '@/contexts/WatchlistsContext'
import { SocialDossierProvider } from '@/components/social-dossiers/use-social-dossier'
import '@/components/social-dossiers/social-dossier-shared.day-mode.css'
import useSettingsStore from '@/store/useSettingsStore'
import { DEFAULT_SCROLL_TINT } from '@/constants/scrollTints'
import { registerSuperProps, setSurface, setPageArea, setUserProps, track, Events } from '@/services/analytics'
import { setAuthToken, setAuthTokenProvider, fetchProfile } from '@/services/profileSync'
// Deferred-safe Privy access. ProfileSyncInit reads the stub (authenticated:
// false, getAccessToken: async()=>null) until the lazy PrivyProvider mounts,
// then the real result — its effect is gated on `authenticated`, so it simply
// no-ops until Privy hydrates. No eager wallet-stack import on the boot path.
import { usePrivySafe } from '@/lib/use-privy-safe'
import { shouldPrefetch } from '@/lib/should-prefetch'

/**
 * Initializes profile sync as soon as Privy auth is available.
 * Sets auth token and enables Zustand store sync so profile changes
 * push to the server regardless of which page the user is on.
 * Only rendered when PRIVY_APP_ID is set (inside PrivyProvider).
 */
function ProfileSyncInit() {
  const { authenticated, getAccessToken, user } = usePrivySafe()
  const getTokenRef = useRef(getAccessToken)
  getTokenRef.current = getAccessToken
  const didInit = useRef(false)

  const enableSync = useSettingsStore((s) => s.enableSync)
  const syncProfileToUser = useSettingsStore((s) => s.syncProfileToUser)
  const mergeServerSettings = useSettingsStore((s) => s.mergeServerSettings)

  useEffect(() => {
    if (!authenticated || didInit.current) return
    didInit.current = true

    // Fire Sign In once per session the moment Privy auth lands. Mirrors the
    // trading app (login_method: 'privy_beta', success: true) so the
    // research activation funnel and cross-app sign-in comparisons line up
    // in PostHog. Guarded by didInit so it never double-fires.
    try { track(Events.SIGN_IN, { success: true, login_method: 'privy_beta' }) } catch { /* analytics must never break auth */ }

    // Sync local profile to this Privy user (resets if different user)
    if (user?.id) syncProfileToUser(user.id)

    async function initSync() {
      try {
        const token = await getTokenRef.current()
        if (!token) return
        setAuthToken(token)
        // Hand profileSync the GETTER, not just this snapshot — Privy tokens
        // expire ~hourly and getAccessToken refreshes internally, so pushes
        // keep working in a session that outlives the first token (the iOS
        // PWA stays resumed for days).
        setAuthTokenProvider(() => getTokenRef.current())
        enableSync()

        // Fetch server profile and merge into local state
        const serverData = await fetchProfile()
        if (serverData?.updatedAt) {
          mergeServerSettings(serverData)
        }

        // Media library + Research Zone personal data ride their own KV
        // fields - loaded lazily so anonymous boots never pay for it.
        import('@/services/userDataSync')
          .then((m) => m.initExtraUserSync())
          .catch(() => {})
      } catch {
        // Non-critical - sync will retry on dashboard visit
      }
    }
    initSync()
  }, [authenticated, user?.id, enableSync, syncProfileToUser, mergeServerSettings])

  return null
}

// All pages lazy-loaded for code splitting
const HomePage = lazy(() => import('@/pages/home'))
const TokenPage = lazy(() => import('@/pages/token'))
const SearchEnginePageV1 = lazy(() => import('@/pages/search-engine'))
const SearchEnginePageV2 = lazy(() => import('@/pages/search-engine-v2'))
// v1 is the default — its landing page (good-morning hero + trending cards
// + recent searches) is the production look. v2 is opt-in at ?v=2 while we
// decide whether to keep it for the results-only view.
function SearchEnginePage() {
  const v = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('v') : null
  return v === '2' ? <SearchEnginePageV2 /> : <SearchEnginePageV1 />
}
const DiscoverPage = lazy(() => import('@/pages/discover'))
const ResearchZonePage = lazy(() => import('@/pages/research-zone'))
const WatchlistsPage = lazy(() => import('@/pages/watchlists'))
const FearGreedPage = lazy(() => import('@/pages/fear-greed'))
const CategoriesPage = lazy(() => import('@/pages/categories'))
const HeatmapsPage = lazy(() => import('@/pages/heatmaps'))
const BubblesPage = lazy(() => import('@/pages/bubbles'))
const AIChartsPage = lazy(() => import('@/pages/ai-charts'))
const SocialZonePage = lazy(() => import('@/pages/social-zone'))
const MediaCenterPage = lazy(() => import('@/pages/media-center'))
const XDashPage = lazy(() => import('@/pages/x-dash'))
const PotentialGainersPage = lazy(() => import('@/pages/potential-gainers'))
const XBubblesPage = lazy(() => import('@/pages/x-bubbles'))
const ROICalculatorPage = lazy(() => import('@/pages/roi-calculator'))
const EconomicCalendarPage = lazy(() => import('@/pages/economic-calendar'))
const AIMarketAnalysisPage = lazy(() => import('@/pages/ai-market-analysis'))
const StructureGuidePage = lazy(() => import('@/pages/structure-guide'))
const GMDashboardPage = lazy(() => import('@/pages/gm-dashboard'))
const LiteModePage = lazy(() => import('@/pages/lite'))
const VenturesPage = lazy(() => import('@/pages/ventures'))
const PrivateMarketsPage = lazy(() => import('@/pages/private-markets'))
const PrivateMarketsCompanyPage = lazy(() => import('@/pages/private-markets/company'))
const IntelligencePage = lazy(() => import('@/pages/intelligence'))
const ArticlePage = lazy(() => import('@/pages/intelligence/components/ArticlePage'))
const NewsroomPage = lazy(() => import('@/pages/newsroom'))
const EmbedChartPage = lazy(() => import('@/pages/embed-chart'))
const LensPage = lazy(() => import('@/pages/lens'))
const TradersCornerPage = lazy(() => import('@/pages/traders-corner'))
const SpectreYouPage = lazy(() => import('@/pages/you'))
const WebsitePage = lazy(() => import('@/pages/website'))
const Website2Page = lazy(() => import('@/pages/website2'))
const LPPage = lazy(() => import('@/pages/lp'))
const ApiPage = lazy(() => import('@/pages/website2/components/api-page'))
const ApiSignupPage = lazy(() => import('@/pages/website2/api/signup'))
const ApiLoginPage = lazy(() => import('@/pages/website2/api/login'))
const ApiDashboardPage = lazy(() => import('@/pages/website2/api/dashboard'))
const NewsPage = lazy(() => import('@/pages/news'))
const LiquidationHeatmapPage = lazy(() => import('@/pages/liquidation-heatmap'))
const MonarchChatPage = lazy(() => import('@/pages/monarch-chat'))
const WorldPage = lazy(() => import('@/pages/world'))
const TokenizedAssetsPage = lazy(() => import('@/pages/tokenized-assets'))
const AltRotationPage = lazy(() => import('@/pages/alt-rotation'))
const WhyPage = lazy(() => import('@/pages/why'))
const UserDashboardPage = lazy(() => import('@/pages/user-dashboard'))
const XIntelPage = lazy(() => import('@/pages/x-intel'))
const WalletsPage = lazy(() => import('@/pages/wallets'))
const EtfFlowsPage = lazy(() => import('@/pages/etf-flows'))
const ZIGChainPage = lazy(() => import('@/pages/zigchain'))
const XIntelligencePage = lazy(() => import('@/pages/x-intelligence'))
const PredictionsPage = lazy(() => import('@/pages/predictions'))
const PulsePage = lazy(() => import('@/pages/pulse'))
const IntelligenceFeedPage = lazy(() => import('@/pages/intelligence-feed'))
const AlertsPage = lazy(() => import('@/pages/alerts'))
const BrainPage = lazy(() => import('@/pages/brain'))
const TgOnboardPage = lazy(() => import('@/pages/admin-tg-onboard'))
const FactsPage = lazy(() => import('@/pages/facts'))
const VsPage = lazy(() => import('@/pages/vs'))
const HowToPage = lazy(() => import('@/pages/how-to'))
const DossierPage = lazy(() => import('@/pages/dossier'))
const DevSpectreAuditPage = lazy(() => import('@/pages/dev-spectre-audit'))
const DevFreshnessPage = lazy(() => import('@/pages/dev-freshness'))
const ArenaPage = lazy(() => import('@/pages/arena'))
const MarketCinemaPage = lazy(() => import('@/pages/market-cinema'))
const WorldStatePage = lazy(() => import('@/pages/world-state'))
const VitalsPage = lazy(() => import('@/pages/vitals'))

import './App.css'

/* ── Idle route-warmer ─────────────────────────────────────────────────────
   The first tap into a page on a cold session pays its chunk download +
   compile — measured 0.9-2.4s at 4x CPU throttle (news 2.4s, categories 1.1s,
   research-zone 0.9s), which is exactly the "switching between subpages lags"
   report. Warm the pages a user actually taps next, staggered so they never
   compete with the visible page's data requests. Failures are ignored — the
   route's own lazy() retries on demand. */
if (typeof window !== 'undefined') {
  const warmRoutes = () => {
    // ~2.2MB of speculative route chunks. Worth it on a normal connection,
    // never worth it on 2g/3g or with Save-Data on. See lib/should-prefetch.js.
    if (!shouldPrefetch()) return
    ;[
      () => import('@/pages/research-zone'),
      () => import('@/pages/categories'),
      () => import('@/pages/news'),
      () => import('@/pages/heatmaps'),
      () => import('@/pages/watchlists'),
      () => import('@/pages/fear-greed'),
      () => import('@/pages/economic-calendar'),
      () => import('@/pages/alt-rotation'),
      () => import('@/pages/home'),
    ].forEach((imp, i) => {
      setTimeout(() => { imp().catch(() => {}) }, i * 400)
    })
  }
  const schedule = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warmRoutes, { timeout: 4000 })
    else setTimeout(warmRoutes, 2500)
  }
  if (document.readyState === 'complete') setTimeout(schedule, 3500)
  else window.addEventListener('load', () => setTimeout(schedule, 3500), { once: true })
}

/**
 * Map a pathname to a human-readable `page_area` label for PostHog.
 * Website-prefixed labels cover the legacy /website2 + /lp routes that
 * still exist in this app (real spectreai.io traffic lives in the
 * separate spectre-website repo). App-prefixed labels cover the real
 * research product — derived from the first path segment so new routes
 * get a sensible default without touching this map.
 */
function mapPathToPageArea(pathname) {
  const p = pathname || '/'
  if (p === '/') return 'app_home'
  if (p === '/website2' || p.startsWith('/website2/')) {
    if (p.startsWith('/website2/api')) {
      const sub = p.replace('/website2/api', '')
      if (sub === '' || sub === '/') return 'website_api'
      if (sub.startsWith('/signup')) return 'website_api_signup'
      if (sub.startsWith('/login')) return 'website_api_login'
      if (sub.startsWith('/dashboard')) return 'website_api_dashboard'
      return 'website_api_other'
    }
    return 'website_home_legacy'
  }
  if (p === '/website') return 'website_legacy'
  if (p === '/lp' || p.startsWith('/lp/')) return 'website_landing_page'
  // Auto-generate app_<segment> from the first path segment so new routes
  // don't need to be added here. e.g. /research-zone/bitcoin → app_research_zone
  const first = p.split('/')[1] || 'unknown'
  return 'app_' + first.replace(/-/g, '_')
}

/**
 * Tags every PostHog event with the current surface + page_area. The
 * legacy marketing routes in this app (/website2, /lp, /website) get
 * `surface: 'website'`; everything else gets `surface: 'research-app'`.
 * page_area is a more granular human-readable label (see mapPathToPageArea).
 */
function SurfaceTracker() {
  const location = useLocation()
  useEffect(() => {
    const p = location.pathname
    const isWebsite = p === '/website2' || p.startsWith('/website2/') || p === '/website' || p === '/lp' || p.startsWith('/lp/')
    setSurface(isWebsite ? 'website' : 'research-app')
    setPageArea(mapPathToPageArea(p))
  }, [location.pathname])
  return null
}

// Read the app id straight from the env (NOT via privy-config) so this module
// doesn't drag the lazy wallet-stack config back onto the entry path.
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || ''

function App() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const scrollTint = useSettingsStore((s) => s.scrollTint)
  const profile = useSettingsStore((s) => s.profile)
  const profileName = profile?.name

  useEffect(() => {
    registerSuperProps({ theme: dayMode ? 'day' : 'dark' })
  }, [dayMode])

  // Scrollbar tint (LITE + PRO share it). Stamped on <html> because the ROOT
  // scrollbar lives outside .app / .lite-root, so vars set lower down would
  // never reach it. One attribute write per change; all painting is CSS
  // (index.css `html[data-sb-tint=…]`) so there is zero per-scroll cost.
  useEffect(() => {
    const el = document.documentElement
    if (!scrollTint || scrollTint === DEFAULT_SCROLL_TINT) el.removeAttribute('data-sb-tint')
    else el.setAttribute('data-sb-tint', scrollTint)
  }, [scrollTint])

  useEffect(() => {
    if (profileName) setUserProps({ '$name': profileName })
  }, [profileName])

  // Demo-mode overlay is ONLY active when the app is loaded via `?demo=true`
  // (i.e. embedded inside the spectreai.io marketing iframe). See `src/demo/`.
  const demoActive = isDemoModeActive()

  return (
    <>
    {PRIVY_APP_ID && <ProfileSyncInit />}
    {demoActive && <DemoMode />}
    <I18nCurrencyProvider>
      <CopyToastProvider>
        <AppStateProvider>
          <MonarchProvider>
            <WatchlistsProvider>
              <SocialDossierProvider>
              <AuthGate>
                <DemoLockGate>
                {/*
                  Top-level Suspense. The fallback was `null` — on a first
                  visit (cold module cache) the AppShell chunk hadn't
                  downloaded yet and Suspense rendered NOTHING, producing
                  the "black screen until refresh" symptom. The brand
                  pulse loader holds the viewport until the shell chunk
                  is ready, then the inner Suspense (inside AppShell /
                  PageShell) takes over for per-route chunk loads.
                */}
                <Suspense fallback={<RouteFallback />}>
                  <ShowcaseLockSentinel />
                  <SurfaceTracker />
                  <RouteMeta />
                  <Routes>
                    <Route element={<EmbedGuard />}>
                    {/* Newsroom — standalone, outside AppShell entirely */}
                    <Route path="/newsroom" element={<PageErrorBoundary><NewsroomPage /></PageErrorBoundary>} />
                    <Route path="/embed/chart/:cgId" element={<PageErrorBoundary><EmbedChartPage /></PageErrorBoundary>} />
                    {/* Marketing website — standalone, no AppShell */}
                    <Route path="/website" element={<PageErrorBoundary><WebsitePage /></PageErrorBoundary>} />
                    <Route path="/website2" element={<PageErrorBoundary><Website2Page /></PageErrorBoundary>} />
                    <Route path="/lp" element={<PageErrorBoundary><LPPage /></PageErrorBoundary>} />
                    <Route path="/website2/api" element={<PageErrorBoundary><ApiPage /></PageErrorBoundary>} />
                    <Route path="/website2/api/signup" element={<PageErrorBoundary><ApiSignupPage /></PageErrorBoundary>} />
                    <Route path="/website2/api/login" element={<PageErrorBoundary><ApiLoginPage /></PageErrorBoundary>} />
                    <Route path="/website2/api/dashboard" element={<PageErrorBoundary><ApiDashboardPage /></PageErrorBoundary>} />
                    {/* SEO / GEO marketing surfaces — standalone, no AppShell */}
                    <Route path="/facts" element={<PageErrorBoundary><FactsPage /></PageErrorBoundary>} />
                    <Route path="/admin/tg-onboard" element={<PageErrorBoundary><TgOnboardPage /></PageErrorBoundary>} />
                    <Route path="/dev/spectre-audit" element={<PageErrorBoundary><DevSpectreAuditPage /></PageErrorBoundary>} />
                    <Route path="/dev/freshness" element={<PageErrorBoundary><DevFreshnessPage /></PageErrorBoundary>} />
                    <Route path="/vs/:competitor" element={<PageErrorBoundary><VsPage /></PageErrorBoundary>} />
                    <Route path="/how-to/:guide" element={<PageErrorBoundary><HowToPage /></PageErrorBoundary>} />
                    <Route element={<AppShell />}>
                    <Route element={<ComingSoonGuard />}>
                      {/* Trading Lite (token view) — own 3-panel layout.
                          Canonical: /trade + /trade/<address>. Legacy /token
                          forms keep resolving; the page normalizes the URL. */}
                      <Route path="/trade" element={<PageErrorBoundary><TokenPage /></PageErrorBoundary>} />
                      <Route path="/trade/:tokenId" element={<PageErrorBoundary><TokenPage /></PageErrorBoundary>} />
                      <Route path="/token" element={<PageErrorBoundary><TokenPage /></PageErrorBoundary>} />
                      <Route path="/token/:tokenId" element={<PageErrorBoundary><TokenPage /></PageErrorBoundary>} />
                      {/* GM Dashboard — full-screen overlay */}
                      <Route path="/gm-dashboard" element={<PageErrorBoundary><GMDashboardPage /></PageErrorBoundary>} />
                      {/* Spectre LITE - full-screen simple mode (Glass / Paper looks) */}
                      <Route path="/lite" element={<PageErrorBoundary><LiteModePage /></PageErrorBoundary>} />
                      {/* Monarch Chat — own 3-column layout, needs full viewport height */}
                      <Route path="/monarch-chat" element={<PageErrorBoundary><MonarchChatPage /></PageErrorBoundary>} />
                      {/* World War Room — full-screen 3D globe */}
                      <Route path="/world" element={<PageErrorBoundary><WorldPage /></PageErrorBoundary>} />
                      {/* Market Cinema — full-viewport ambient market stage */}
                      <Route path="/cinema" element={<PageErrorBoundary><MarketCinemaPage /></PageErrorBoundary>} />
                      {/* 2026-06-14 name swap: /x-intelligence is the PUBLIC Social-
                          Intelligence dashboard (component lives in pages/x-bubbles); the
                          legacy graph (pages/x-intelligence) is gated at /x-bubbles. URL,
                          nav label and gate all read "X Intelligence" for the public page. */}
                      <Route path="/x-intelligence" element={<PageErrorBoundary><XBubblesPage /></PageErrorBoundary>} />
                      <Route path="/x-bubbles" element={<PageErrorBoundary><XIntelligencePage /></PageErrorBoundary>} />
                      {/* All other pages in PageShell */}
                      <Route element={<PageShell />}>
                        <Route path="/" element={<PageErrorBoundary><HomePage /></PageErrorBoundary>} />
                        <Route path="/you" element={<PageErrorBoundary><SpectreYouPage /></PageErrorBoundary>} />
                        <Route path="/discover" element={<PageErrorBoundary><DiscoverPage /></PageErrorBoundary>} />
                        <Route path="/research-zone/:coinSlug?" element={<PageErrorBoundary><ResearchZonePage /></PageErrorBoundary>} />
                        <Route path="/dossier" element={<PageErrorBoundary><DossierPage /></PageErrorBoundary>} />
                        <Route path="/dossier/:chain/:ca" element={<PageErrorBoundary><DossierPage /></PageErrorBoundary>} />
                        <Route path="/search-engine" element={<PageErrorBoundary><SearchEnginePage /></PageErrorBoundary>} />
                        <Route path="/search" element={<PageErrorBoundary><SearchEnginePage /></PageErrorBoundary>} />
                        <Route path="/watchlists" element={<PageErrorBoundary><WatchlistsPage /></PageErrorBoundary>} />
                        <Route path="/fear-greed" element={<PageErrorBoundary><FearGreedPage /></PageErrorBoundary>} />
                        <Route path="/categories" element={<PageErrorBoundary><CategoriesPage /></PageErrorBoundary>} />
                        <Route path="/categories/:categoryId" element={<PageErrorBoundary><CategoriesPage /></PageErrorBoundary>} />
                        <Route path="/heatmaps" element={<PageErrorBoundary><HeatmapsPage /></PageErrorBoundary>} />
                        <Route path="/alt-rotation" element={<PageErrorBoundary><AltRotationPage /></PageErrorBoundary>} />
                        <Route path="/why" element={<PageErrorBoundary><WhyPage /></PageErrorBoundary>} />
                        <Route path="/bubbles" element={<PageErrorBoundary><BubblesPage /></PageErrorBoundary>} />
                        <Route path="/ai-charts" element={<PageErrorBoundary><AIChartsPage /></PageErrorBoundary>} />
                        <Route path="/social-zone" element={<PageErrorBoundary><SocialZonePage /></PageErrorBoundary>} />
                        <Route path="/ai-media-center" element={<PageErrorBoundary><MediaCenterPage /></PageErrorBoundary>} />
                        {/* ONE wildcard route, not siblings per subpath: sibling
                            <Route>s REMOUNT the whole page when the match changes,
                            so every drawer open (row click -> /x-dash/token/:id)
                            tore the board down - scroll jumped to top, everything
                            repainted, THEN the panel opened. The page parses its
                            own sub-route (routedViewFromPath + drawer params). */}
                        <Route path="/x-dash/*" element={<PageErrorBoundary><XDashPage /></PageErrorBoundary>} />
                        <Route path="/potential-gainers" element={<PageErrorBoundary><PotentialGainersPage /></PageErrorBoundary>} />
                        <Route path="/roi-calculator" element={<PageErrorBoundary><ROICalculatorPage /></PageErrorBoundary>} />
                        <Route path="/economic-calendar" element={<PageErrorBoundary><EconomicCalendarPage /></PageErrorBoundary>} />
                        <Route path="/ai-market-analysis" element={<PageErrorBoundary><AIMarketAnalysisPage /></PageErrorBoundary>} />
                        <Route path="/structure-guide" element={<PageErrorBoundary><StructureGuidePage /></PageErrorBoundary>} />
                        <Route path="/ventures" element={<PageErrorBoundary><VenturesPage /></PageErrorBoundary>} />
                        <Route path="/private-markets" element={<PageErrorBoundary><PrivateMarketsPage /></PageErrorBoundary>} />
                        <Route path="/private-markets/:companySlug" element={<PageErrorBoundary><PrivateMarketsCompanyPage /></PageErrorBoundary>} />
                        <Route path="/intelligence" element={<PageErrorBoundary><IntelligencePage /></PageErrorBoundary>} />
                        <Route path="/intelligence/:type/:slug" element={<PageErrorBoundary><ArticlePage /></PageErrorBoundary>} />
                        <Route path="/lens" element={<PageErrorBoundary><LensPage /></PageErrorBoundary>} />
                        <Route path="/traders-corner" element={<PageErrorBoundary><TradersCornerPage /></PageErrorBoundary>} />
                        <Route path="/news" element={<PageErrorBoundary><NewsPage /></PageErrorBoundary>} />
                        <Route path="/news/:articleId" element={<PageErrorBoundary><NewsPage /></PageErrorBoundary>} />
                        <Route path="/liquidation-heatmap" element={<PageErrorBoundary><LiquidationHeatmapPage /></PageErrorBoundary>} />
                        <Route path="/tokenized-assets" element={<PageErrorBoundary><TokenizedAssetsPage /></PageErrorBoundary>} />
                        <Route path="/user-dashboard" element={<PageErrorBoundary><UserDashboardPage /></PageErrorBoundary>} />
                        <Route path="/x-intel" element={<PageErrorBoundary><XIntelPage /></PageErrorBoundary>} />
                        <Route path="/wallets" element={<PageErrorBoundary><WalletsPage /></PageErrorBoundary>} />
                        <Route path="/etfs" element={<PageErrorBoundary><EtfFlowsPage /></PageErrorBoundary>} />
                        <Route path="/zigchain" element={<PageErrorBoundary><ZIGChainPage /></PageErrorBoundary>} />
                        <Route path="/predictions" element={<PageErrorBoundary><PredictionsPage /></PageErrorBoundary>} />
                        <Route path="/predictions/:eventSlug" element={<PageErrorBoundary><PredictionsPage /></PageErrorBoundary>} />
                        <Route path="/pulse" element={<PageErrorBoundary><PulsePage /></PageErrorBoundary>} />
                        <Route path="/insights" element={<PageErrorBoundary><IntelligenceFeedPage /></PageErrorBoundary>} />
                        <Route path="/intelligence-feed" element={<PageErrorBoundary><IntelligenceFeedPage /></PageErrorBoundary>} />
                        <Route path="/alerts" element={<PageErrorBoundary><AlertsPage /></PageErrorBoundary>} />
                        <Route path="/brain" element={<PageErrorBoundary><BrainPage /></PageErrorBoundary>} />
                        <Route path="/arena" element={<PageErrorBoundary><ArenaPage /></PageErrorBoundary>} />
                        <Route path="/world-state" element={<PageErrorBoundary><WorldStatePage /></PageErrorBoundary>} />
                        <Route path="/vitals" element={<PageErrorBoundary><VitalsPage /></PageErrorBoundary>} />
                        <Route path="/vitals/:slug" element={<PageErrorBoundary><VitalsPage /></PageErrorBoundary>} />
                      </Route>
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                    </Route>
                    </Route>
                  </Routes>
                  <ShowcaseLockToast />
                </Suspense>
                </DemoLockGate>
              </AuthGate>
              </SocialDossierProvider>
            </WatchlistsProvider>
          </MonarchProvider>
        </AppStateProvider>
      </CopyToastProvider>
    </I18nCurrencyProvider>
    </>
  )
}

export default App
