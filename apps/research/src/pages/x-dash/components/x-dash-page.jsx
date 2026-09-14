/**
 * X DASH - terminal-grade social intelligence dashboard.
 *
 * Shell: command bar + view tabs + view router + drawer host.
 * - Command bar timeframe/ranking/segment/mcap feed Leaderboard + New.
 * - Views are lazy-mounted so each view's hook only fetches when active.
 * - Token + author drawers are URL-driven, lazy-loaded, fetch only when open.
 *
 * URL contract (routes registered in App.jsx):
 *   /x-dash                  -> Leaderboard / Narratives / Categories (tab state)
 *   /x-dash/creators         -> Creators
 *   /x-dash/rotations        -> Rotations
 *   /x-dash/creator-edits    -> Edits
 *   /x-dash/token/:cgId      -> active view + token drawer
 *   /x-dash/author/:authorId -> active view + author drawer
 * Narratives + Categories are tab-only state (they share the /x-dash path).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* The window the board lands on. Kept as a constant so the auto-switch to a
   live window below can tell "still on the landing window" from "the reader
   chose this". */
const TIMEFRAME_DEFAULT = '24h'
import lazyWithRetry from '@/lib/lazy-with-retry'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { track, Events } from '@/services/analytics'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import { timeframeLabel, xdashUpdatingCopy } from '@/lib/xdash-health'
import { useXDashSearch } from '@/hooks/useXDashSearch'
import { usePrivySafe } from '@/lib/use-privy-safe'
import { isAppActive } from '@/lib/idleManager'
import { chainLabel } from '@/lib/chain-normalize'
import { Avatar, RefreshIcon, XDDropdown, XDashFeedHealthContext } from './xd-bits'
import { relativeTime, formatNum, openTradingTerminal, parseMcapInput, formatMcapShort, MCAP_PRESET_MAX } from './x-dash-utils'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import GuidedTour, { TourLaunchButton } from '@/components/guided-tour'
import SocialDisclaimer from '@/components/social-disclaimer'
import useSettingsStore from '@/store/useSettingsStore'
import { XD_TOUR_STEPS } from './xd-tour-steps'
// Default view (leaderboard) + the always-on Thesis strip stay eager so the
// front page paints without a chunk round-trip. Every OTHER view is lazy: it's
// only mounted when its tab is active (rendered inside the page's <Suspense>),
// so its code + chart imports (narratives/categories/rotations pull recharts+d3)
// never touch the X Dash first-paint critical path. Fulfils the "views are
// lazy-mounted" contract noted at the top of this file.
import XDLeaderboard from './views/xd-leaderboard'
import XDThesis from './views/xd-thesis'
const XDNewTokens = lazyWithRetry(() => import('./views/xd-new-tokens'))
const XDFreshTokens = lazyWithRetry(() => import('./views/xd-fresh-tokens'))
const XDDegen = lazyWithRetry(() => import('./views/xd-degen'))
const XDNarratives = lazyWithRetry(() => import('./views/xd-narratives'))
const XDCategories = lazyWithRetry(() => import('./views/xd-categories'))
const XDCreators = lazyWithRetry(() => import('./views/xd-creators'))
const XDRotations = lazyWithRetry(() => import('./views/xd-rotations'))
const XDEdits = lazyWithRetry(() => import('./views/xd-edits'))
const XDTrackRecord = lazyWithRetry(() => import('./views/xd-track-record'))
const XDResearch = lazyWithRetry(() => import('./views/xd-research'))
const XDInstitutions = lazyWithRetry(() => import('./views/xd-institutions'))
const XDKolRadar = lazyWithRetry(() => import('./views/xd-kol-radar'))
const KolProfilePage = lazyWithRetry(() => import('./views/kol-radar/kol-profile-page'))
import './x-dash-page.css'
import './x-dash-page.day-mode.css'
import './x-dash-page.mobile.css'
import './x-dash-refined.css'
import './x-dash-interactions.css'

// lazyWithRetry (not plain lazy): a stale-deploy chunk miss auto-recovers via
// the shared chunk-recovery reload instead of surfacing a "Something went
// wrong" card when a user on an old tab opens a token/author drawer post-deploy.
const XDTokenDrawer = lazyWithRetry(() => import('./xd-token-drawer'))
const XDAuthorDrawer = lazyWithRetry(() => import('./xd-author-drawer'))

// The Map view drags in three.js / R3F (the GPU ConstellationEngine). Lazy-load
// it so three never touches the boot path — it loads only when the Map tab opens,
// rendered inside the page's <Suspense>. (Guarded by check-critical-path.mjs.)
const XDConstellation = lazyWithRetry(() => import('./views/xd-constellation'))
// the KOL ↔ project cosmos (three.js) — lazy keeps three off the boot path
const XDUniverse = lazyWithRetry(() => import('./views/xd-universe'))

/* Quick-fill tiers for the custom band - saves typing the common ranges and
   makes the cap tiers discoverable. Values are input strings so they round-trip
   through the same parser the user's typing goes through.

   Calibrated to CRYPTO, not TradFi: on this board a $500K token really is micro
   and $100M+ is already large, so the tiers sit a decade below equity
   convention. Contiguous by design - no gaps, no overlaps. */
const MCAP_TIERS = [
  { key: 'micro', label: 'Micro', min: '', max: '1m' },
  { key: 'small', label: 'Small', min: '1m', max: '10m' },
  { key: 'mid', label: 'Mid', min: '10m', max: '100m' },
  { key: 'large', label: 'Large', min: '100m', max: '' },
]

/* view <-> url path mapping. leaderboard/narratives/categories all live
   on /x-dash and are distinguished by local tab state. Labels resolved via
   t() at render time — see useViewsFilters() below. */
/* Which command-bar controls each view actually CONSUMES (verified against
   each view's controls.* reads). Groups a view ignores render dimmed +
   disabled instead of silently dead; views absent from this map consume
   nothing and the whole filter row hides (the treatment Proof always had). */
const VIEW_CAPS = {
  leaderboard: { timeframe: true, sort: true, segment: true, market: true, chain: true },
  majors: { timeframe: true, sort: true, segment: false, market: true, chain: true },
  /* market: false on 'new' + 'narratives' - the market-cap options are CEILINGS
     now, which the upstream can't express, so they only work where a view filters
     per-token mcap client-side. xd-fresh-tokens never reads market_cap and
     narratives are token CLUSTERS, not tokens, so the control would silently
     no-op there. Dimmed ("Not used by this view") beats lying. */
  new: { timeframe: true, sort: true, segment: true, market: false, chain: false },
  signals: { timeframe: true, sort: false, segment: true, market: true, chain: false },
  narratives: { timeframe: true, sort: true, segment: true, market: false, chain: false },
  categories: { timeframe: true, sort: false, segment: false, market: false, chain: false },
  creators: { timeframe: true, sort: false, segment: false, market: false, chain: false },
  degen: { timeframe: false, sort: false, segment: false, market: false, chain: true },
}

const VIEW_DEFS = [
  { key: 'leaderboard', path: '/x-dash', routed: false, i18nKey: 'xDash.views.leaderboard', fallback: 'Leaderboard' },
  // the KOL ↔ project universe — flagship placement right next to the board
  { key: 'universe', path: '/x-dash', routed: false, i18nKey: 'xDash.views.universe', fallback: 'Cosmos' },
  { key: 'new', path: '/x-dash', routed: false, i18nKey: 'xDash.views.new', fallback: 'New' },
  { key: 'signals', path: '/x-dash', routed: false, i18nKey: 'xDash.views.signals', fallback: 'Signals' },
  // pre-CoinGecko tokens (on-chain buzz) the CG-keyed board can't show - social-gated
  { key: 'degen', path: '/x-dash', routed: false, i18nKey: 'xDash.views.degen', fallback: 'Degen' },
  { key: 'majors', path: '/x-dash', routed: false, i18nKey: 'xDash.views.majors', fallback: 'Majors' },
  { key: 'track-record', path: '/x-dash', routed: false, i18nKey: 'xDash.views.proof', fallback: 'Proof' },
  { key: 'research', path: '/x-dash', routed: false, i18nKey: 'xDash.views.research', fallback: 'Research' },
  { key: 'institutions', path: '/x-dash', routed: false, i18nKey: 'xDash.views.institutions', fallback: 'Institutions', preview: true },
  // 2026-07-16: the full-screen bubbles Map LOCKED (Sunny) — parked for now;
  // the Cosmos ('universe') tab stays. Re-enable by restoring this entry —
  // the render case + lazy import are still wired, nothing else reaches it.
  // { key: 'constellation', path: '/x-dash', routed: false, i18nKey: 'xDash.views.constellation', fallback: 'Map', preview: true },
  { key: 'narratives', path: '/x-dash', routed: false, i18nKey: 'xDash.views.narratives', fallback: 'Narratives' },
  { key: 'categories', path: '/x-dash', routed: false, i18nKey: 'xDash.views.categories', fallback: 'Categories' },
  { key: 'kol-radar', path: '/x-dash/kol-radar', routed: true, i18nKey: 'xDash.views.kolRadar', fallback: 'KOL Radar' },
  { key: 'creators', path: '/x-dash/creators', routed: true, i18nKey: 'xDash.views.creators', fallback: 'Creators' },
  { key: 'rotations', path: '/x-dash/rotations', routed: true, i18nKey: 'xDash.views.rotations', fallback: 'Rotations', preview: true },
  { key: 'edits', path: '/x-dash/creator-edits', routed: true, i18nKey: 'xDash.views.edits', fallback: 'Edits', preview: true },
]

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

/* derive a routed view key from the current pathname, if any */
function routedViewFromPath(pathname) {
  // /x-dash/kol/:handle is the full-screen KOL profile. Checked before
  // kol-radar so the prefix is unambiguous ('/x-dash/kol/' never matches
  // '/x-dash/kol-radar' — the char after 'kol' is '-' there, '/' here).
  if (pathname.startsWith('/x-dash/kol/')) return 'kol-profile'
  if (pathname.startsWith('/x-dash/kol-radar')) return 'kol-radar'
  if (pathname.startsWith('/x-dash/creators')) return 'creators'
  if (pathname.startsWith('/x-dash/rotations')) return 'rotations'
  if (pathname.startsWith('/x-dash/creator-edits')) return 'edits'
  return null
}

export default function XDashPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // Refined is the normal page. Keep the original comparison local to development.
  const [designPreview] = useState(() => import.meta.env.DEV && ['refined', 'original'].includes(new URLSearchParams(window.location.search).get('design')))
  const [refinedDesign, setRefinedDesign] = useState(() => !(import.meta.env.DEV && new URLSearchParams(window.location.search).get('design') === 'original'))
  const previewDayMode = useSettingsStore((s) => s.dayMode)
  const togglePreviewDayMode = useSettingsStore((s) => s.toggleDayMode)

  /* The page mounts once under /x-dash/* (single wildcard route), so drawer
     params come from the pathname, not useParams. */
  const { cgId, authorId, kolHandle } = useMemo(() => {
    const seg = location.pathname.split('/').filter(Boolean) // ['x-dash', kind, value]
    const value = seg[2] ? decodeURIComponent(seg[2]) : undefined
    return {
      cgId: seg[1] === 'token' ? value : undefined,
      authorId: seg[1] === 'author' ? value : undefined,
      kolHandle: seg[1] === 'kol' ? value : undefined,
    }
  }, [location.pathname])
  const { t, i18n } = useTranslation()
  // Same login entry point the header's "Sign In" uses — calling it mounts the
  // Privy provider on demand. Used by the auth-gate banner so the fix for an
  // expired session is to SIGN IN, not a reload (a reload can't re-auth you).
  const privyLogin = usePrivySafe()?.login

  /* Translated chrome arrays — rebuild on language change. */
  const VIEWS = useMemo(() => VIEW_DEFS.map((v) => ({
    ...v,
    label: t(v.i18nKey, v.fallback),
  })), [t, i18n.language])

  const TIMEFRAMES = useMemo(() => [
    { key: '24h', label: t('xDash.timeframes.24h', '24H') },
    { key: '7d', label: t('xDash.timeframes.7d', '7D') },
    { key: '30d', label: t('xDash.timeframes.30d', '30D') },
    { key: 'all', label: t('xDash.timeframes.all', 'ALL') },
  ], [t, i18n.language])

  const RANKINGS = useMemo(() => [
    { key: 'mentions', label: t('xDash.rankings.mentions', 'Mentions') },
    { key: 'momentum', label: t('xDash.rankings.momentum', 'Momentum') },
    { key: 'conviction', label: t('xDash.rankings.conviction', 'Conviction') },
  ], [t, i18n.language])

  const SEGMENTS = useMemo(() => [
    { key: 'all', label: t('xDash.segments.all', 'All segments') },
    { key: 'major', label: t('xDash.segments.major', 'Majors') },
    { key: 'context', label: t('xDash.segments.context', 'Context') },
    { key: 'opportunity', label: t('xDash.segments.opportunity', 'Opportunity') },
  ], [t, i18n.language])

  const MARKETS = useMemo(() => [
    { key: 'all', label: t('xDash.markets.all', 'Any market cap') },
    { key: 'lt1m', label: t('xDash.markets.lt1m', '< $1M') },
    { key: 'lt10m', label: t('xDash.markets.lt10m', '< $10M') },
    { key: 'lt100m', label: t('xDash.markets.lt100m', '< $100M') },
    { key: 'lt1b', label: t('xDash.markets.lt1b', '< $1B') },
    /* Custom band - the presets are all open-ended floors, so there was no way
       to ask "what's hot between $10M and $50M". Picking this reveals two
       min/max inputs (values in $M) and the board filters to that band. */
    { key: 'custom', label: t('xDash.markets.custom', 'Custom range') },
  ], [t, i18n.language])

  /* the active view is local state; it is kept in sync with routed paths
     so a routed view survives a drawer opening on top of it. */
  const [activeView, setActiveView] = useState(() => routedViewFromPath(location.pathname) || 'leaderboard')

  useEffect(() => {
    const routed = routedViewFromPath(location.pathname)
    if (routed && routed !== activeView) {
      setActiveView(routed)
    }
    // base /x-dash (no drawer): if current view is a routed one, fall back to leaderboard
    if (location.pathname === '/x-dash' && VIEW_DEFS.find((v) => v.key === activeView)?.routed) {
      setActiveView('leaderboard')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  /* drawer fullscreen toggle. Lives on the page so closing the drawer
     (route change away from /token/:id or /author/:id) auto-resets the
     mode; opening a fresh drawer starts in side-panel mode by default.
     `?view=full` in the URL forces the drawer to open in fullscreen — used
     by the search dropdown so picking a result lands directly on the brief
     instead of the side preview. */
  const [drawerFullscreen, setDrawerFullscreen] = useState(false)
  useEffect(() => {
    if (!cgId && !authorId) { setDrawerFullscreen(false); return }
    const params = new URLSearchParams(location.search)
    if (params.get('view') === 'full') setDrawerFullscreen(true)
  }, [cgId, authorId, location.search])
  const toggleDrawerFullscreen = useCallback(() => {
    setDrawerFullscreen((v) => {
      const next = !v
      try { track(Events.XDASH_DRAWER_FULLSCREEN, { state: next ? 'fullscreen' : 'side' }) } catch { /* noop */ }
      return next
    })
  }, [])

  /* command-bar controls */
  const [timeframe, setTimeframe] = useState(TIMEFRAME_DEFAULT)
  const [ranking, setRanking] = useState('momentum')
  const [segment, setSegment] = useState('all')
  const [market, setMarket] = useState('all')
  /* Custom mcap band (market === 'custom'). Held as raw input strings so the
     fields stay editable mid-type; parsed to USD only when handed downstream.
     Accepts k/m/b suffixes; a bare number means millions. */
  const [mcapMin, setMcapMin] = useState('')
  const [mcapMax, setMcapMax] = useState('')

  /* The active market-cap constraint as USD bounds. Derived here (right next to
     its state, ahead of the search hook that consumes apiMarket) so nothing
     reads it before initialisation. */
  const mcapBand = useMemo(() => {
    /* Ceiling presets ("< $10M") are bands too - the upstream only understands
       open-ended FLOORS, so every non-'all' option now filters client-side. */
    if (market !== 'custom') {
      const max = MCAP_PRESET_MAX[market]
      return max ? { min: null, max } : null
    }
    const lo = parseMcapInput(mcapMin)
    const hi = parseMcapInput(mcapMax)
    if (lo == null && hi == null) return null
    /* Tolerate inverted entry (min 50 / max 10) instead of showing 0 results. */
    if (lo != null && hi != null && lo > hi) return { min: hi, max: lo }
    return { min: lo, max: hi }
  }, [market, mcapMin, mcapMax])

  /* What actually goes to the API. The upstream rejects 'custom' and every 'lt*'
     key (verified: an unknown market returns an EMPTY board), and four other
     surfaces - fresh-tokens, narratives, new-tokens and the search hook - pass
     controls.market straight through. So the raw selection never leaves the
     command bar: whenever a band is active the API sees 'all' and the band does
     the narrowing client-side. */
  const apiMarket = mcapBand ? 'all' : market

  /* Reads the band back to the user - drives the collapsed dropdown label for a
     custom range and the leaderboard's empty state, so an active filter is never
     invisible. */
  const mcapBandLabel = useMemo(() => {
    if (!mcapBand) return null
    const { min, max } = mcapBand
    if (min != null && max != null) return `${formatMcapShort(min)} - ${formatMcapShort(max)}`
    if (min != null) return `${formatMcapShort(min)}+`
    return `< ${formatMcapShort(max)}`
  }, [mcapBand])

  const [chain, setChain] = useState('all')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  /* Measure the sticky command bar so the leaderboard table can pin its header
     right below it (see .xd-table-scroll in x-dash-page.css). --xd-cmd-h is the
     bar height (the region's sticky offset within the page scroller); --xd-cmd-top
     is the bar's bottom in the viewport (app chrome + bar height) so the region's
     max-height fills exactly to the viewport bottom. ResizeObserver keeps both
     live as the ribbon loads or the bar wraps on narrower widths. */
  const pageRef = useRef(null)
  const cmdbarRef = useRef(null)
  useEffect(() => {
    const bar = cmdbarRef.current
    const root = pageRef.current
    if (!bar || !root) return undefined
    const apply = () => {
      const h = bar.offsetHeight
      const pl = document.querySelector('.page-layout')
      const chrome = pl ? Math.max(0, Math.round(pl.getBoundingClientRect().top)) : 74
      root.style.setProperty('--xd-cmd-h', `${h}px`)
      root.style.setProperty('--xd-cmd-top', `${chrome + h}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(bar)
    window.addEventListener('resize', apply)
    return () => { ro.disconnect(); window.removeEventListener('resize', apply) }
  }, [])

  /* The chain dropdown is DATA-DRIVEN: the Leaderboard reports (via
     onChainsAvailable) the chains actually present in the current board with
     counts, canonicalized through @/lib/chain-normalize. So the user only sees
     chains that HAVE tokens this window — and Robinhood / XRP show up whenever
     the runner algo (CG + X Dash + DexScreener + Codex) surfaces them — instead
     of a static list where BSC/Arbitrum silently never matched and half the
     rows (Optimism/Polygon/Tron/Sui/Aptos) were always empty. A curated
     fallback (with Robinhood) paints before the first board lands; the active
     selection is always kept in the list so its label never goes blank. */
  const [availableChains, setAvailableChains] = useState([])
  const CHAINS = useMemo(() => {
    const options = availableChains.length
      ? availableChains.map((c) => ({
          key: c.key,
          label: c.count ? `${c.label} · ${c.count}` : c.label,
        }))
      : ['ethereum', 'solana', 'base', 'bsc', 'arbitrum', 'robinhood', 'xrp']
          .map((k) => ({ key: k, label: chainLabel(k) }))
    // Keep the current selection visible even if it dropped out of the board.
    if (chain && chain !== 'all' && !options.some((o) => o.key === chain)) {
      options.push({ key: chain, label: chainLabel(chain) })
    }
    return [{ key: 'all', label: t('xDash.chains.all', 'All chains') }, ...options]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableChains, chain, t, i18n.language])

  /* search */
  const [searchInput, setSearchInput] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const { data: searchData, loading: searchLoading, search, clear } = useXDashSearch({ timeframe, segment, market: apiMarket })

  /* bootstrap also feeds the command-bar stat ribbon (cheap, cached) */
  const ribbonParams = useMemo(() => ({
    page: 1, perPage: 1, timeframe, ranking: 'mentions', segment: 'all', market: 'all', minKols: 1,
  }), [timeframe])
  const { data: ribbonData, error: ribbonError, authError, refetch: refetchRibbon, health: ribbonHealth } = useXDashBootstrap(ribbonParams)

  /* The page canary. It used to be `ribbonError && !ribbonData` alone, which
     only catches a DEAD upstream — and the failure we actually ship into is the
     quiet one: the API answers 200, the ribbon counts populate, and every board
     under it is empty because the window asked for was never built upstream.
     That state used to reach the user as "No tokens match these filters", i.e.
     blaming their filters for our gap. `health` catches it. */
  const feedUpdating = !authError && ((Boolean(ribbonError) && !ribbonData) || ribbonHealth?.state === 'updating')
  const liveTimeframe = ribbonHealth?.liveTimeframe || null

  /* reset pagination when filters or the active view change */
  useEffect(() => { setPage(1) }, [timeframe, ranking, segment, market, chain, mcapMin, mcapMax, activeView])

  const controls = useMemo(() => ({
    /* market is the API-SAFE value; mcapBand carries the real constraint. */
    timeframe, ranking, segment, market: apiMarket, chain, page, setPage, mcapBand,
  }), [timeframe, ranking, segment, apiMarket, chain, page, mcapBand])

  /* Command-bar filter changes route through one tracked handler so every
     timeframe / sort / segment / mcap / chain tweak shows up in PostHog
     with a consistent { filter, value } shape. */
  const changeFilter = useCallback((filter, value, setter) => {
    setter(value)
    try { track(Events.XDASH_FILTER_CHANGED, { filter, value, view: activeView }) } catch { /* analytics never breaks UI */ }
  }, [activeView])

  /* The board lands on 24h, and when upstream has not built that window it
     paints empty under a banner the reader has to notice and act on - the
     window that IS current is one tap away, but only if you spot the button.
     /x-bubbles already resolves this by re-asking for the live window instead
     of rendering a dead one's emptiness as a result (x-bubbles-page.jsx:721);
     do the same here.

     ONCE, and only from the landing window: if the reader has already moved
     the timeframe themselves - including deliberately back to a dead one -
     that is their call, and the banner stays to explain what they are seeing. */
  const autoLiveTfRef = useRef(false)
  useEffect(() => {
    if (autoLiveTfRef.current) return
    if (timeframe !== TIMEFRAME_DEFAULT) { autoLiveTfRef.current = true; return }
    if (!liveTimeframe || liveTimeframe === timeframe) return
    autoLiveTfRef.current = true
    changeFilter('timeframe', liveTimeframe, setTimeframe)
  }, [liveTimeframe, timeframe, changeFilter])

  /* Fire X-Dash Viewed once on mount with the entry context. $pageview
     already records the visit; this adds which view + timeframe the tester
     landed on so the dashboard can split engagement by view. */
  const viewedFiredRef = useRef(false)
  useEffect(() => {
    if (viewedFiredRef.current) return
    viewedFiredRef.current = true
    try { track(Events.XDASH_VIEWED, { view: activeView, timeframe }) } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* One X-Dash Searched event per completed search (results arriving), not
     per keystroke. query_len only — never the raw query text. */
  useEffect(() => {
    if (searchInput.trim().length < 2 || !searchData) return
    try {
      track(Events.XDASH_SEARCHED, {
        query_len: searchInput.trim().length,
        token_results: (searchData.tokens || []).length,
        creator_results: (searchData.creators || []).length,
      })
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchData])

  const goView = useCallback((key) => {
    const view = VIEWS.find((v) => v.key === key)
    if (!view) return
    if (key !== activeView) {
      try { track(Events.XDASH_VIEW_CHANGED, { view: key, from_view: activeView, timeframe }) } catch { /* analytics never breaks UI */ }
    }
    setActiveView(key)
    if (view.path !== location.pathname) {
      navigate(view.path)
    }
  }, [navigate, location.pathname, VIEWS, activeView, timeframe])

  /* ── Guided tour (button-launched) ──────────────────────────────
     No auto-popup: the "?" pill pulses until first opened, then the
     persisted flag stops the nudge. Starting the tour drops to the
     Leaderboard view so the movers/attention/table zones exist to frame. */
  const dayMode = useSettingsStore((s) => s.dayMode)
  const xdTourSeen = useSettingsStore((s) => s.xdTourSeen)
  const setXdTourSeen = useSettingsStore((s) => s.setXdTourSeen)
  const [tourActive, setTourActive] = useState(false)
  const [tourStep, setTourStep] = useState(0)
  const startTour = useCallback(() => {
    goView('leaderboard')
    setTourStep(0)
    setTourActive(true)
    setXdTourSeen(true)
    try { track(Events.XDASH_VIEW_CHANGED, { view: 'tour', from_view: activeView, timeframe }) } catch { /* analytics never breaks UI */ }
  }, [goView, setXdTourSeen, activeView, timeframe])
  const endTour = useCallback(() => setTourActive(false), [])
  const handleTourNext = useCallback(() => {
    if (tourStep >= XD_TOUR_STEPS.length - 1) setTourActive(false)
    else setTourStep(tourStep + 1)
  }, [tourStep])
  const handleTourBack = useCallback(() => setTourStep((s) => Math.max(0, s - 1)), [])

  /* openToken accepts an optional { focus } hint. When the carrier cluster
     is the click target we pass focus:'carriers' so the drawer lands on /
     scrolls to the Carriers board instead of the top of the drawer. */
  const openToken = useCallback((id, opts) => {
    if (!id) return
    const focus = opts && opts.focus
    try { track(Events.XDASH_TOKEN_OPENED, { cg_id: id, focus: focus || null, source: (opts && opts.source) || 'list', view: activeView, timeframe }) } catch { /* analytics never breaks UI */ }
    const suffix = focus ? `?focus=${encodeURIComponent(focus)}` : ''
    navigate(`/x-dash/token/${encodeURIComponent(id)}${suffix}`)
  }, [navigate, activeView, timeframe])

  const openAuthor = useCallback((id, opts) => {
    if (!id) return
    try { track(Events.XDASH_AUTHOR_OPENED, { author_id: id, source: (opts && opts.source) || 'list', view: activeView, timeframe }) } catch { /* analytics never breaks UI */ }
    navigate(`/x-dash/author/${encodeURIComponent(id)}`)
  }, [navigate, activeView, timeframe])

  const closeDrawer = useCallback(() => {
    const view = VIEWS.find((v) => v.key === activeView)
    navigate(view?.path || '/x-dash')
  }, [navigate, activeView, VIEWS])

  const onSearchChange = useCallback((e) => {
    const value = e.target.value
    setSearchInput(value)
    setSearchOpen(true)
    if (value.trim().length >= 2) {
      search(value, { timeframe, segment, market: apiMarket })
    } else {
      clear()
    }
  }, [search, clear, timeframe, segment, apiMarket])

  const onSelectSearchToken = useCallback((tk) => {
    // Accept either a raw cg_id (legacy callers) or the full token row.
    const token = typeof tk === 'string' ? { cg_id: tk } : (tk || {})
    const cgId = token.cg_id || token.token_id
    setSearchInput('')
    setSearchOpen(false)
    clear()
    if (cgId) {
      try { track(Events.XDASH_TOKEN_OPENED, { cg_id: cgId, source: 'search', view: activeView, timeframe }) } catch { /* noop */ }
      // Search picks land in fullscreen directly — the side drawer is for
      // peeking from within a list; a directory lookup is intentional, so
      // the user wants the whole brief without a second click.
      navigate(`/x-dash/token/${encodeURIComponent(cgId)}?view=full`)
      return
    }
    // On-chain token resolved by contract address (Codex / pasted address) with
    // no CoinGecko id — open the standalone trading terminal (better charts,
    // Gleb's build) by contract, in a new tab, NOT the /token "Trading Lite"
    // iframe. It loads the EXACT token by address (a pasted Base $DOT can NEVER
    // become Polkadot) and infers the chain from the address format. Research
    // Zone is wrong here — it canonicalises the slug back to the major.
    const address = token.contract_address || token.address
    if (address) {
      try { track(Events.XDASH_TOKEN_OPENED, { cg_id: null, symbol: token.symbol || null, source: 'search-address', view: activeView, timeframe }) } catch { /* noop */ }
      if (openTradingTerminal(address)) return
    }
    // On-chain token with no CoinGecko id — X Dash has no social page for it, so
    // route to Research Zone (general token research) by symbol slug instead of
    // dead-ending. resolveSlugToSymbol passes an unknown symbol through, so RZ
    // loads the actual token rather than a default.
    const sym = token.symbol
    if (!sym) return
    try { track(Events.XDASH_TOKEN_OPENED, { cg_id: null, symbol: sym, source: 'search-onchain', view: activeView, timeframe }) } catch { /* noop */ }
    navigate(`/research-zone/${encodeURIComponent(String(sym).toLowerCase())}`)
  }, [clear, navigate, activeView, timeframe])

  const handleRefresh = useCallback(() => {
    try { track(Events.XDASH_REFRESHED, { view: activeView, timeframe }) } catch { /* noop */ }
    setRefreshing(true)
    refetchRibbon({ background: true })
    setRefreshKey((k) => k + 1)
    window.setTimeout(() => setRefreshing(false), 600)
  }, [refetchRibbon, activeView, timeframe])

  /* The ribbon bootstrap only refetches on filter changes, so after an outage
     the updating banner would never clear on its own - poll it on the same
     20s cadence as the view-level ErrorState while the banner is up. */
  useEffect(() => {
    if (!feedUpdating) return undefined
    const id = window.setInterval(() => {
      if (document.hidden || !isAppActive()) return
      refetchRibbon({ background: true })
    }, 20000)
    return () => window.clearInterval(id)
  }, [feedUpdating, refetchRibbon])

  /* stat ribbon numbers */
  // Published to every view's EmptyState (see XDashFeedHealthContext): while the
  // feed rebuilds, a tab must describe the outage, not claim the market is quiet.
  const feedHealth = useMemo(
    () => ({ updating: feedUpdating, detail: feedUpdating ? xdashUpdatingCopy(ribbonHealth, t) : null }),
    [feedUpdating, ribbonHealth, t],
  )

  const tokenCount = ribbonData?.token_count
  // While the feed is rebuilding, its per-token counters come back as a flat 0
  // (mention_count 0, tokens_with_mentions 0) even though totals.kept_hits shows
  // the crawler is still collecting. Printing "0 MENTIONS" next to a banner that
  // says the board is rebuilding states an outage as a measurement - fall back
  // to the '-' the ribbon already renders for an unknown value. tokenCount is
  // the universe size, not a window measurement, so it stays.
  const mentionCount = feedUpdating ? null : ribbonData?.mention_count
  const tokensWithSignal = feedUpdating ? null : ribbonData?.totals?.tokens_with_mentions
  const generatedAt = ribbonData?.generated_at_utc

  /* render the active view; each is mounted only when active so its hook
     fetches lazily. refreshKey forces a clean refetch on manual refresh. */
  const viewCaps = VIEW_CAPS[activeView] || null

  const viewBody = useMemo(() => {
    const shared = { controls, perPage, onPerPage: setPerPage, refinedDesign }
    switch (activeView) {
      case 'universe':
        // The KOL ↔ project cosmos (X Bubbles engine) — projects as planets,
        // the voices behind them as moons, Proof receipts + breakout chips.
        // Own crawl fetch + HUD; onOpenToken only.
        return <XDUniverse key={`un-${refreshKey}`} onOpenToken={openToken} refinedDesign={refinedDesign} />
      case 'constellation':
        // The Narrative Constellation — a force-directed attention map.
        // Ignores the command-bar controls (reads its own data); onOpenToken only.
        return <XDConstellation key={`cn-${refreshKey}`} onOpenToken={openToken} />
      case 'track-record':
        // The Provenance Tape — a finished derived ledger. Ignores the
        // command-bar controls (it has its own sort/status); reads onOpenToken.
        return <XDTrackRecord key={`tr-${refreshKey}`} onOpenToken={openToken} />
      case 'research':
        // Hype Forensics — organic vs engineered attention. Self-contained
        // (own search + LLM teardown); ignores the command-bar controls.
        return <XDResearch key={`res-${refreshKey}`} />
      case 'institutions':
        // Crypto GTM proposal engine for brands — self-contained (own brand/goal
        // input + LLM proposal); ignores the command-bar controls.
        return <XDInstitutions key={`inst-${refreshKey}`} />
      case 'kol-radar':
        // KOL Radar — Giga KOL DB + follow-graph convergence signals. Fully
        // self-contained (own scope toggle + filters + dossier drawer); ignores
        // the command-bar controls. Project chips/targets open the token drawer
        // via openToken (passed as onOpenProject).
        return <XDKolRadar key={`kol-${refreshKey}`} onOpenProject={openToken} />
      case 'kol-profile':
        // Full-screen KOL profile (/x-dash/kol/:handle). Self-contained: reads
        // its own dossier via useKolDossier(handle); project chips/targets open
        // the token drawer via openToken (onOpenProject), same as the grid.
        return <KolProfilePage key={`kolp-${kolHandle || ''}-${refreshKey}`} handle={kolHandle} onOpenProject={openToken} />

      case 'new':
        // New = genuinely FRESH tokens (first detected <48h, newest first) -
        // new launches just picking up social. NOT the scored runner board.
        return <XDFreshTokens key={`fresh-${refreshKey}`} {...shared} onOpenToken={openToken} />
      case 'signals':
        // Signals = the Runner Score board (small-cap accelerating clean
        // momentum). These are setups/runners, not "new" - own tab.
        return <XDNewTokens key={`sig-${refreshKey}`} {...shared} onOpenToken={openToken} />
      case 'degen':
        // Degen = PRE-CoinGecko tokens (on-chain volume + X buzz) the CG-keyed
        // leaderboard can't index yet. Social-gated (never a silent launch),
        // chain-aware. Self-contained early-runners feed.
        return <XDDegen key={`degen-${refreshKey}`} controls={controls} onChainsAvailable={setAvailableChains} />
      case 'majors':
        // Top-100-coin mindshare board — the dev-requested "majors working".
        // Reuses the full leaderboard surface but force-pins segment='major',
        // which routes its data to /api/xdash/majors (board:"major"). Independent
        // of the command-bar segment dropdown (that drives the Leaderboard view).
        return (
          <XDLeaderboard
            key={`maj-${refreshKey}`}
            {...shared}
            controls={{ ...controls, segment: 'major' }}
            onOpenToken={openToken}
            onOpenAuthor={openAuthor}
            onChainsAvailable={setAvailableChains}
            onGoView={goView}
          />
        )
      case 'narratives':
        return <XDNarratives key={`narr-${refreshKey}`} {...shared} onOpenToken={openToken} />
      case 'categories':
        return <XDCategories key={`cat-${refreshKey}`} {...shared} onOpenToken={openToken} />
      case 'creators':
        return <XDCreators key={`cre-${refreshKey}`} onOpenAuthor={openAuthor} controls={controls} />
      case 'rotations':
        return <XDRotations key={`rot-${refreshKey}`} onOpenAuthor={openAuthor} />
      case 'edits':
        return <XDEdits key={`edt-${refreshKey}`} onOpenAuthor={openAuthor} />
      case 'leaderboard':
      default:
        return (
          <XDLeaderboard
            key={`ldr-${refreshKey}`}
            {...shared}
            onOpenToken={openToken}
            onOpenAuthor={openAuthor}
            onChainsAvailable={setAvailableChains}
            onGoView={goView}
          />
        )
    }
  }, [activeView, controls, perPage, refreshKey, openToken, openAuthor, kolHandle, goView, refinedDesign])

  const searchTokens = searchData?.tokens || []
  const searchCreators = searchData?.creators || []

  const onSelectSearchCreator = useCallback((restId) => {
    if (!restId) return
    setSearchInput('')
    setSearchOpen(false)
    clear()
    try { track(Events.XDASH_AUTHOR_OPENED, { author_id: restId, source: 'search', view: activeView, timeframe }) } catch { /* noop */ }
    navigate(`/x-dash/author/${encodeURIComponent(restId)}?view=full`)
  }, [clear, navigate, activeView, timeframe])

  return (
    <div className={`xd-page${refinedDesign ? ' xd-refined' : ''}`} ref={pageRef}>
      {designPreview && <div className="xd-design-preview" role="region" aria-label="X Dash design comparison">
        <span className="xd-design-preview__label">Design test</span>
        <div className="xd-design-preview__choices" role="group" aria-label="Design version">
          <button type="button" aria-pressed={!refinedDesign} onClick={() => setRefinedDesign(false)}>Original</button>
          <button type="button" aria-pressed={refinedDesign} onClick={() => setRefinedDesign(true)}>Refined</button>
        </div>
        <button type="button" className="xd-design-preview__mode" onClick={togglePreviewDayMode} aria-label={previewDayMode ? 'Switch to night mode' : 'Switch to day mode'}>{previewDayMode ? 'Night mode' : 'Day mode'}</button>
      </div>}
      {/* Auth-gate banner: a 401 means the server session/cookie expired while
          the client still looked logged in (sessionStorage hint stale) - so the
          app shell renders but gated features silently fail, which confused
          users. Make that state explicit and offer the REAL fix (sign in), not a
          reload (a reload can't re-auth an expired session). The board also
          auto-retries (useXDashBootstrap) so a transient gate blip self-heals. */}
      {authError && (
        <div className="xd-reconnect" role="alert">
          <span className="xd-reconnect__dot" aria-hidden="true" />
          <span className="xd-reconnect__msg">
            {t('xDash.reconnect.msg', "Your session expired — you're signed out, so live X Dash data can't load. Sign in to reconnect.")}
          </span>
          <button
            type="button"
            className="xd-reconnect__btn"
            onClick={() => { if (privyLogin) privyLogin(); else window.location.reload() }}
          >
            {t('xDash.reconnect.cta', 'Sign in')}
          </button>
        </div>
      )}
      {/* Outage banner: the ribbon bootstrap is the page canary - when it
          errors with NOTHING loaded, the X Dash API is down or reindexing.
          Views holding cached/fallback data keep showing it (stale beats
          blank), so this strip is the page-wide signal that live data is
          paused and reconnects on its own. Auth failures use the amber
          banner above instead. */}
      {feedUpdating && (
        <div className="xd-updating xd-updating--banner" role="status" aria-live="polite">
          <span className="xd-updating__dot" aria-hidden="true" />
          <span className="xd-updating--banner__msg">
            <b>{t('xDash.bits.updating.title', 'X Dash is updating')}</b>
            <span>{xdashUpdatingCopy(ribbonHealth, t)}</span>
          </span>
          {/* When another window IS current, the useful thing is one tap to it
              — not an apology the reader can do nothing with. */}
          {liveTimeframe && (
            <button
              type="button"
              className="xd-btn xd-btn--ghost xd-btn--sm xd-updating--banner__cta"
              onClick={() => changeFilter('timeframe', liveTimeframe, setTimeframe)}
            >
              {t('xDash.updating.openLive', { defaultValue: 'Open {{tf}}', tf: timeframeLabel(liveTimeframe) })}
            </button>
          )}
        </div>
      )}
      {/* COMMAND BAR — two rows: identity / filters */}
      <div className="xd-cmdbar" ref={cmdbarRef}>
        {/* ROW 1 — brand + KPI ribbon + search + meta */}
        <div className="xd-cmdbar__row xd-cmdbar__row--identity">
          <div className="xd-cmdbar__brand">
            <span className="xd-cmdbar__title">{t('xDash.brand', 'X Dash')}</span>
            <span className="xd-cmdbar__ribbon" data-tour="xd-kpis">
              <span className="xd-cmdbar__stat">
                <b className="xd-num">{tokenCount != null ? formatNum(tokenCount, { locale: i18n.language }) : '-'}</b>
                <span className="xd-cmdbar__stat-label">{t('xDash.ribbon.tokens', 'tokens')}<InfoTip text={getMetricInfo('tokensTracked')} position="bottom" /></span>
              </span>
              <span className="xd-cmdbar__ribbon-sep" aria-hidden="true" />
              <span className="xd-cmdbar__stat">
                <b className="xd-num">{mentionCount != null ? formatNum(mentionCount, { locale: i18n.language }) : '-'}</b>
                <span className="xd-cmdbar__stat-label">{t('xDash.ribbon.mentions', 'mentions')}<InfoTip text={getMetricInfo('totalMentionsKpi')} position="bottom" /></span>
              </span>
              <span className="xd-cmdbar__ribbon-sep" aria-hidden="true" />
              <span className="xd-cmdbar__stat">
                <b className="xd-num">{tokensWithSignal != null ? formatNum(tokensWithSignal, { locale: i18n.language }) : '-'}</b>
                <span className="xd-cmdbar__stat-label">{t('xDash.ribbon.withSignal', 'w/ signal')}<InfoTip text={getMetricInfo('withSignal')} position="bottom" /></span>
              </span>
            </span>
          </div>

          <div className="xd-cmdbar__search">
            <span className="xd-cmdbar__search-icon"><SearchIcon /></span>
            <input
              className="xd-cmdbar__search-input"
              aria-label={t('xDash.search.placeholder', 'Search tokens & creators')}
              onKeyDown={(e) => { if (refinedDesign && e.key === 'Escape') { setSearchInput(''); setSearchOpen(false); clear() } }}
              placeholder={t('xDash.search.placeholder', 'Search tokens & creators')}
              value={searchInput}
              onChange={onSearchChange}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 180)}
            />
          {searchOpen && searchInput.trim().length >= 2 && (
            <div className="xd-cmdbar__search-results">
              {searchLoading && <div className="xd-search-result__empty">{t('xDash.search.searching', 'Searching tokens & creators...')}</div>}
              {!searchLoading && searchTokens.length === 0 && searchCreators.length === 0 && (
                <div className="xd-search-result__empty">{t('xDash.search.noMatch', 'Nothing matches "{{query}}"', { query: searchInput.trim() })}</div>
              )}
              {!searchLoading && searchTokens.length > 0 && (
                <>
                  <div className="xd-search-result__group">
                    {t('xDash.search.group.tokens', 'Tokens')}
                    <span className="xd-search-result__group-count">{searchTokens.length}</span>
                  </div>
                  {searchTokens.slice(0, 10).map((tk) => (
                    <button
                      key={tk.cg_id || tk.token_id || tk.symbol}
                      type="button"
                      className="xd-search-result"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelectSearchToken(tk)}
                    >
                      <span className="xd-tokencell">
                        <Avatar src={tk.image_small || tk.image} alt={tk.symbol} size={24} />
                        <span className="xd-tokencell__text">
                          <span className="xd-tokencell__cashtag xd-num">
                            {tk.cashtag || `$${tk.symbol || ''}`}
                          </span>
                          <span className="xd-tokencell__sub">{tk.name}</span>
                        </span>
                      </span>
                      <span className="xd-search-result__meta">
                        {tk._source === 'onchain'
                          ? t('xDash.search.source.onChain', 'On-chain')
                          : tk._fallback
                            ? t('xDash.search.source.coinGecko', 'CoinGecko')
                            : t('xDash.search.meta.mentions', '{{count}} mentions', { count: formatNum(tk.external_mentions_24h, { locale: i18n.language }) })}
                      </span>
                    </button>
                  ))}
                </>
              )}
              {!searchLoading && searchCreators.length > 0 && (
                <>
                  <div className="xd-search-result__group">
                    {t('xDash.search.group.creators', 'Creators')}
                    <span className="xd-search-result__group-count">{searchCreators.length}</span>
                  </div>
                  {searchCreators.slice(0, 8).map((c) => (
                    <button
                      key={c.rest_id || c.screen_name}
                      type="button"
                      className="xd-search-result"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelectSearchCreator(c.rest_id || c.screen_name)}
                    >
                      <span className="xd-tokencell">
                        <Avatar src={c.avatar_image_url} alt={c.screen_name} size={24} />
                        <span className="xd-tokencell__text">
                          <span className="xd-tokencell__cashtag xd-num">
                            @{c.screen_name}
                          </span>
                          <span className="xd-tokencell__sub">{c.name}</span>
                        </span>
                      </span>
                      <span className="xd-search-result__meta">
                        {c.followers_count ? t('xDash.search.meta.followers', '{{count}} followers', { count: formatNum(c.followers_count, { locale: i18n.language }) }) : ''}
                        {c.tokens_mentioned_count ? ` · ${t('xDash.search.meta.tokens', '{{count}} tokens', { count: formatNum(c.tokens_mentioned_count, { locale: i18n.language }) })}` : ''}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

          <div className="xd-cmdbar__meta">
            <TourLaunchButton
              onClick={startTour}
              pulse={!xdTourSeen}
              label={t('xDash.tour.launch', 'Tour')}
              title={t('xDash.tour.launchTitle', 'Take a quick tour of X Dash')}
            />
            <span className="xd-cmdbar__updated">
              {generatedAt
                ? t('xDash.updated', 'updated {{when}}', { when: relativeTime(generatedAt, t) })
                : t('xDash.updatingLabel', 'updating...')}
            </span>
            <button
              type="button"
              className={`xd-btn xd-btn--icon${refreshing ? ' xd-btn--spinning' : ''}`}
              onClick={handleRefresh}
              aria-label={t('xDash.refresh', 'Refresh')}
              disabled={refreshing}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        {/* ROW 2 — filters. Views that consume NOTHING (Proof, Cosmos, Map,
            KOL Radar, Research, Institutions, Rotations, Edits) hide the row
            entirely; views that consume a SUBSET render the ignored groups
            dimmed + disabled so a control never reads as silently dead
            (Signals pins its own ranking, Creators/Categories only follow
            the timeframe, Degen only the chain, …). */}
        {viewCaps && (
        <div className="xd-cmdbar__row xd-cmdbar__row--filters">
          <div
            className={`xd-cmdbar__group${viewCaps.timeframe ? '' : ' xd-cmdbar__group--inert'}`}
            title={viewCaps.timeframe ? undefined : t('xDash.filters.inert', 'Not used by this view')}
          >
            <span className="xd-cmdbar__group-label">{t('xDash.filters.timeframe', 'Timeframe')}<InfoTip text={getMetricInfo('timeframeFilter')} position="bottom" /></span>
            <div className="xd-toggle">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.key}
                  type="button"
                  disabled={!viewCaps.timeframe}
                  className={`xd-toggle__btn${timeframe === tf.key ? ' xd-toggle__btn--active' : ''}`}
                  onClick={() => changeFilter('timeframe', tf.key, setTimeframe)}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          <span className="xd-cmdbar__group-divider" aria-hidden="true" />

          <div
            className={`xd-cmdbar__group${viewCaps.sort ? '' : ' xd-cmdbar__group--inert'}`}
            data-tour="xd-sort"
            title={viewCaps.sort ? undefined : t('xDash.filters.inertSort', 'This view ranks itself — Sort by is not used here')}
          >
            <span className="xd-cmdbar__group-label">{t('xDash.filters.sortBy', 'Sort by')}<InfoTip text={getMetricInfo('sortModes')} position="bottom" /></span>
            <div className="xd-toggle">
              {RANKINGS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  disabled={!viewCaps.sort}
                  className={`xd-toggle__btn${ranking === r.key ? ' xd-toggle__btn--active' : ''}`}
                  onClick={() => changeFilter('sort', r.key, setRanking)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <span className="xd-cmdbar__group-divider" aria-hidden="true" />

          <div className="xd-cmdbar__group">
            <span className="xd-cmdbar__group-label">{t('xDash.filters.filter', 'Filter')}<InfoTip text={getMetricInfo('segmentFilter')} position="bottom" /></span>
            <span
              className={viewCaps.segment ? undefined : 'xd-cmdbar__inert'}
              title={viewCaps.segment ? undefined : t('xDash.filters.inert', 'Not used by this view')}
              aria-disabled={!viewCaps.segment || undefined}
            >
              <XDDropdown
                options={SEGMENTS}
                value={segment}
                onChange={(v) => changeFilter('segment', v, setSegment)}
                ariaLabel={t('xDash.filters.aria.segment', 'Segment filter')}
                minWidth={180}
              />
            </span>
            <span
              className={viewCaps.market ? undefined : 'xd-cmdbar__inert'}
              title={viewCaps.market ? undefined : t('xDash.filters.inert', 'Not used by this view')}
              aria-disabled={!viewCaps.market || undefined}
            >
              <XDDropdown
                options={MARKETS}
                value={market}
                onChange={(v) => changeFilter('mcap', v, setMarket)}
                ariaLabel={t('xDash.filters.aria.market', 'Market cap filter')}
                minWidth={160}
                /* an active band reads back in the collapsed trigger */
                triggerLabel={market === 'custom' && mcapBandLabel ? mcapBandLabel : undefined}
              />
              {market === 'custom' && (
                <span className="xd-mcap-band">
                  {/* Placeholders are EXAMPLES, not labels ("500k", not "Min") -
                      they're the only affordance telling the user that k/m/b
                      suffixes parse. With "Min"/"Max" everyone assumed the field
                      was millions-only and never tried $500K. */}
                  <input
                    type="text"
                    className="xd-mcap-band__input xd-num"
                    value={mcapMin}
                    onChange={(e) => setMcapMin(e.target.value)}
                    placeholder={t('xDash.markets.minEg', '500k')}
                    title={t('xDash.markets.unitHint', 'Accepts k, m or b - e.g. 500k, 25m, 1.5b. A plain number means millions.')}
                    aria-label={t('xDash.filters.aria.mcapMin', 'Minimum market cap - accepts 500k, 25m, 1.5b')}
                  />
                  <span className="xd-mcap-band__dash" aria-hidden="true">-</span>
                  <input
                    type="text"
                    className="xd-mcap-band__input xd-num"
                    value={mcapMax}
                    onChange={(e) => setMcapMax(e.target.value)}
                    placeholder={t('xDash.markets.maxEg', '25m')}
                    title={t('xDash.markets.unitHint', 'Accepts k, m or b - e.g. 500k, 25m, 1.5b. A plain number means millions.')}
                    aria-label={t('xDash.filters.aria.mcapMax', 'Maximum market cap - accepts 500k, 25m, 1.5b')}
                  />
                  {/* Explicit unit affordance - removes any doubt that K and B
                      are on the table, not just M. */}
                  <span
                    className="xd-mcap-band__units"
                    title={t('xDash.markets.unitHint', 'Accepts k, m or b - e.g. 500k, 25m, 1.5b. A plain number means millions.')}
                  >
                    {t('xDash.markets.units', 'k / m / b')}
                  </span>
                  <span className="xd-mcap-band__tiers">
                    {MCAP_TIERS.map((tier) => {
                      const on = mcapMin === tier.min && mcapMax === tier.max
                      return (
                        <button
                          key={tier.key}
                          type="button"
                          className={`xd-mcap-band__tier${on ? ' is-on' : ''}`}
                          onClick={() => { setMcapMin(tier.min); setMcapMax(tier.max) }}
                          title={`${tier.label} caps`}
                        >
                          {tier.label}
                        </button>
                      )
                    })}
                  </span>
                  {(mcapMin || mcapMax) && (
                    <button
                      type="button"
                      className="xd-mcap-band__clear"
                      onClick={() => { setMcapMin(''); setMcapMax('') }}
                      aria-label={t('xDash.markets.clearBand', 'Clear market cap range')}
                    >
                      &#215;
                    </button>
                  )}
                </span>
              )}
            </span>
            <span
              className={viewCaps.chain ? undefined : 'xd-cmdbar__inert'}
              title={viewCaps.chain ? undefined : t('xDash.filters.inert', 'Not used by this view')}
              aria-disabled={!viewCaps.chain || undefined}
            >
              <XDDropdown
                options={CHAINS}
                value={chain}
                onChange={(v) => changeFilter('chain', v, setChain)}
                ariaLabel={t('xDash.filters.aria.chain', 'Chain filter')}
                minWidth={160}
              />
            </span>
          </div>
        </div>
        )}
      </div>

      {/* VIEW TABS. Some views are experimental "Preview" surfaces (real data,
          still being built) - flagged so users know before they dive in. */}
      <div className="xd-viewtabs" data-tour="xd-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`xd-viewtab${activeView === v.key ? ' xd-viewtab--active' : ''}${v.preview ? ' xd-viewtab--preview' : ''}`}
            aria-pressed={activeView === v.key}
            onClick={() => goView(v.key)}
          >
            {v.label}
            {v.preview && (
              <span
                className="xd-viewtab__preview"
                title={t('xDash.views.previewHint', 'Experimental preview - real data, still being built')}
              >
                {t('xDash.views.previewBadge', 'Preview')}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SOCIAL MARKET READ — full-width thesis panel, follows the page
          timeframe by default (7D -> general_7d, 24H -> timeframed_24h).
          Hidden on the Proof view so two editorial heroes don't stack. */}
      {activeView !== 'track-record' && activeView !== 'constellation' && activeView !== 'kol-profile' && <XDThesis timeframe={timeframe} onOpenToken={openToken} refinedDesign={refinedDesign} />}

      {/* VIEW BODY — Suspense covers the lazy Map view (three.js / R3F engine).
          fallback={null} keeps the page chrome; the view renders its own
          shimmer once mounted. */}
      <div className="xd-body">
        <XDashFeedHealthContext.Provider value={feedHealth}>
          <Suspense fallback={null}>
            {viewBody}
          </Suspense>
        </XDashFeedHealthContext.Provider>
      </div>

      {/* DRAWERS */}
      <Suspense fallback={null}>
        {cgId && (
          <XDTokenDrawer
            cgId={cgId}
            focus={new URLSearchParams(location.search).get('focus')}
            onClose={closeDrawer}
            onOpenAuthor={openAuthor}
            fullscreen={drawerFullscreen}
            onToggleFullscreen={toggleDrawerFullscreen}
            timeframe={timeframe}
          />
        )}
        {authorId && (
          <XDAuthorDrawer
            authorId={authorId}
            onClose={closeDrawer}
            onOpenToken={openToken}
            onOpenAuthor={openAuthor}
            fullscreen={drawerFullscreen}
            onToggleFullscreen={toggleDrawerFullscreen}
          />
        )}
      </Suspense>

      {/* NFA / risk footer - slim, expandable */}
      <SocialDisclaimer className="xd-page__disclaimer" />

      {/* Button-launched guided tour */}
      <GuidedTour
        steps={XD_TOUR_STEPS}
        isActive={tourActive}
        currentStep={tourStep}
        onNext={handleTourNext}
        onBack={handleTourBack}
        onSkip={endTour}
        dayMode={dayMode}
        ariaLabel={t('xDash.tour.aria', 'X Dash tour')}
      />
    </div>
  )
}
