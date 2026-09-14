/**
 * Research Zone LITE - CMC-style token page (plan: docs/RESEARCH_ZONE_LITE_PLAN.md)
 * Landing-page style icons and UI (aligned with WelcomePage).
 */
import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useResearchZoneNavigation } from '../hooks/use-research-zone-navigation'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { trackUi } from '@/services/analytics'
import { isAppActive } from '@/lib/idleManager'
import { warmTradingViewLibrary } from '@/lib/tv-warm'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { getCryptoNews, getRssMarketNews } from '@/services/cryptoNewsApi'
import { extractCatalysts, deriveSignals } from './rz-catalysts'
import { getTokenMarkets } from '@/services/coinGeckoApi'
import {
  getSentimentScore, getFearGreed, getTokenSocial, getSentimentPlotData,
  getTokenTweets, getInfluencerTweets, getSocialFeedTweets,
  getTokenMarketDetails, getOfficialTweets, normalizeOfficialTweet,
  normalizeTweet, normalizeSentimentScore, normalizePlotData, normalizeMarketDetails,
} from '@/services/spectreApi'
import { FALLBACK_STOCK_DATA } from '@/services/stockApi'
import { hasBinancePair } from '@/services/binanceCatalog'
// TradingView resolution is handled inside TradingChart component directly
import { useNavigate, useLocation } from 'react-router-dom'
import { getTokenSlug, resolveSlugToSymbol } from '@/lib/tokenSlugs'
import { getStockNews } from '@/services/stockNewsApi'
import { getReportedEarnings } from '@/services/stockApi'
import { getSpectreNews } from '@/services/spectreMarketApi'
import { getAgentSignals } from '@/services/spectreDataApi'
import useResearchZoneData, { seedTokenCache } from '../hooks/use-research-zone-data'
import { DEFAULT_SYMBOL, MARKET_FILTERS, formatChange, formatNewsTime } from '../data/rz-constants'
import { useIsMobile } from '@/hooks/useMediaQuery'
// Mobile bundle is 76 KB and only used when isMobile — lazy so desktop
// doesn't parse it.
const ResearchZoneMobile = lazy(() => import('./research-zone-mobile'))
import { TOKEN_ROW_COLORS, getTokenDisplayColors, getColorBrightness } from '@/constants/tokenColors'
import useTokenBrandColor from '@/hooks/useTokenBrandColor'
// RzProCenter owns the entire tab content area + its 216 KB research-zone-pro.css
// (cinematic glass tokens scoped to .rz-pro-center). Lazy so the lite shell
// (hero + chart + sidebars) renders immediately while the heavy center loads
// in parallel with the page's own data fetches. This was first shipped in
// PR #751, reverted at some point, and re-applied here. The Suspense
// fallback uses the same `.rz-pro-section` min-height (720px desktop,
// 600px mobile, see research-zone-pro.css) so CLS during chunk load is zero.
const RzProCenter = lazy(() => import('./research-zone-pro'))
import RzAgentChat from './rz-agent-chat'
import { RzInfoIcon } from './rz-pro-shared'

const SECTION_TIPS = {
  project: 'Project background — team, links, tokenomics, and on-chain identity.',
  markets: 'Where this token trades — pairs, volumes, and ranked exchanges.',
  sentiment: 'How traders and social channels are reacting right now.',
  technicals: 'Indicator readings, signals, and chart-based analysis.',
}
import { useWatchlists } from '@/contexts/WatchlistsContext'
import useSettingsStore from '@/store/useSettingsStore'
const CinemaResearchZone = lazy(() => import('@/components/cinema/cinema-research-zone'))
import './research-zone-lite.css'
import '@/styles/research-refresh.css'
import spectreIcons from '@/icons/spectreIcons'
import './research-zone-mobile.css'
import '@/pages/home/components/welcome-page.css'
import { liteIcons as icons } from '../data/rz-icons.jsx'
import RzChartSection from './rz-chart-section'
const ShareXModal = lazy(() => import('@/components/share-x-modal'))
// Dossier rail tab (2026-06-10): the revived Spectre-API dossier as a sidebar
// tab - chart stays visible, no page takeover. Mounted only while the tab is
// active so its internal polls obey the visibility-gating rule.
const DossierPanel = lazy(() => import('@/components/dossier-panel'))
import { generateRzTokenShareCard } from './rz-share-card'
import RzTokenPanel from './rz-token-panel'
import RzMarketsSection from './rz-markets-section'
import RzFeedPanel from './rz-feed-panel'
import RzTokenPopup from './rz-token-popup'
import RzHeroBanner from './rz-hero-banner'
import RzQuickSwitcher from './rz-quick-switcher'
import useRzHistory from './use-rz-history'
import useRzCompare from './use-rz-compare'
import RzComparePicker from './rz-compare-picker'
import useRzAnnotations from './use-rz-annotations'
import useRzChartTa from './use-rz-chart-ta'
import { RzTaToolMenu, RzTaStrip } from './rz-chart-ta'
import RzNotePopover from './rz-note-popover'
import useTokenProfile from '@/hooks/useTokenProfile'
import useMarketScenario from '@/hooks/useMarketScenario'
import useTokenFundamentals from '@/hooks/useTokenFundamentals'
import useSectorData from '@/hooks/useSectorData'
import useMindshareData from '@/hooks/useMindshareData'
import { prefetchChartBars } from '@/hooks/codex/useChartData'
import ChartSkeleton from '@/components/chart-skeleton'

// Timeframe -> (resolution, periodHours) for the early head-bars prefetch.
// MUST mirror trading-chart.jsx's timeframeToResolution/timeframeToPeriod:
// the prefetch is keyed on symbol|resolution|periodHours and is silently
// ignored (never wrong) when the values drift, so a mismatch only costs the
// speedup, not correctness.
const PREFETCH_TF_RESOLUTION = {
  '1S': '1S', '1M': '1', '5M': '5', '15M': '15', '30M': '30', '1H': '60',
  '4H': '240', '12H': '720', '1D': '5', '1W': '60', '1MO': '240',
  '24H': '5', '7D': '60', '30D': '60', '90D': '240', '1Y': '1D',
  'YTD': '1D', 'ALL': '1W',
}
const PREFETCH_TF_PERIOD = {
  '1S': 0.5, '1M': 24, '5M': 115, '15M': 350, '30M': 700, '1H': 1400,
  '4H': 5600, '12H': 16800, '1D': 96, '1W': 720, '1MO': 2880,
  '24H': 24, '7D': 168, '30D': 720, '90D': 2160, '1Y': 26280, 'ALL': 235200,
}

// Error boundary for chart section - prevents chart crashes from taking down
// the page. The old fallback was an ETERNAL shimmer with no retry and no
// message - render errors (like the a899b79b persisted-timeframe
// ReferenceError) looked like infinite loading on every token. Now: visible
// "Chart failed" + Retry that force-remounts the subtree via key bump.
class ChartErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, retryCount: 0 } }
  // A class cannot call useTranslation, so the page hands `t` down. The default
  // keeps the fallback renderable if a caller forgets to pass one.
  tr = (key, fallback) => (this.props.t ? this.props.t(key, fallback) : fallback)
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err, info) { console.error('[ChartErrorBoundary]', err, info?.componentStack) }
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey) this.setState({ hasError: false })
  }
  render() {
    if (this.state.hasError) {
      // position:relative is LOAD-BEARING (2026-06-11 audit): without it the
      // absolute overlay's inset:0 resolves against the whole RZ layout and
      // click-blocks the page, not just the chart slot.
      return (
        <div className="rz-chart-fallback" role="status" aria-label={this.tr('researchZone.ariaChartFailed', 'Chart failed to load')} style={{ position: 'relative' }}>
          <div className="rz-chart-fallback-shimmer animate-shimmer" />
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 1,
          }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>{this.tr('researchZone.chartFailedToRender', 'Chart failed to render')}</span>
            <button
              type="button"
              onClick={() => this.setState((s) => ({ hasError: false, retryCount: s.retryCount + 1 }))}
              style={{
                padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 8, color: 'rgba(255,255,255,0.85)',
              }}
            >
              {this.tr('researchZone.retry', 'Retry')}
            </button>
          </div>
        </div>
      )
    }
    // retryCount as key forces a clean remount after Retry - stale internal
    // chart state from the crashed render can't leak into the new attempt.
    return <React.Fragment key={this.state.retryCount}>{this.props.children}</React.Fragment>
  }
}

// Exchange tier sets for the markets-table safety-net sort. Module-scope so
// they're built once at load, not rebuilt inside the sortedMarketsData useMemo
// on every marketsData change.
const MARKET_TIER1 = new Set([
  'Binance', 'Coinbase Exchange', 'Coinbase', 'Kraken', 'OKX', 'Bybit',
  'KuCoin', 'Bitfinex', 'Bitstamp', 'Crypto.com Exchange', 'Crypto.com',
  'HTX', 'Gate', 'Gate.io', 'Upbit', 'MEXC', 'Bitget', 'BingX',
  'Bithumb', 'Gemini',
  'Uniswap V2 (Ethereum)', 'Uniswap V3 (Ethereum)', 'Uniswap V3 (Arbitrum One)',
  'Jupiter', 'Raydium', 'PancakeSwap V2 (BSC)', 'PancakeSwap V3 (BSC)',
  'Trader Joe', 'Curve (Ethereum)', 'SushiSwap',
])
const MARKET_TIER2 = new Set([
  'BitMart', 'WhiteBIT', 'Bitvavo', 'LBank', 'XT.com', 'Phemex', 'Bitrue',
  'CoinEx', 'Poloniex', 'Bittrex', 'AscendEX', 'BTSE', 'OrangeX',
  'Coinone', 'Korbit', 'Indodax', 'OKCoin', 'Probit Global',
])
const MARKET_WASH = new Set([
  'BTCC', 'Azbit', 'Pionex', 'CoinUp.io', 'KCEX', 'GroveX', 'CoinW', 'BVOX',
  'Biconomy.com', 'P2B', 'CITEX', 'Hotbit', 'BiONE', 'Toobit',
  'BHEX', 'Hibt', 'BitForex', 'Coinsbit', 'P2PB2B',
])

const ResearchZoneLite = ({ initialSymbol, initialToken, onTokenSelect, dayMode: dayModeProp, onDayModeChange, cinemaMode, marketMode = 'crypto' }) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge, fmtPriceShort, currencySymbol } = useCurrency()
  const isStock = marketMode === 'stocks'
  const isMobile = useIsMobile()
  const centerRef = useRef(null)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // Track layout width to decide when to fold right panel into left sidebar tabs.
  // Threshold matches the @container (max-width: 1080px) breakpoint in CSS.
  //
  // 🪤 This was a useRef + useEffect([]) pair, and on a PHONE that made the
  // narrow layout unreachable: the page boots in PORTRAIT, which early-returns
  // the mobile tree above, so this layout node does not exist yet — the effect
  // ran once against a null ref and, with empty deps, never ran again. Rotating
  // to landscape mounted the desktop layout with `isNarrowLayout` still false,
  // so none of the narrow rules applied and the token panel rendered FULL WIDTH
  // above the hero + chart ("lots of text then chart", founder 08-17). A
  // callback ref re-binds every time the node mounts, and measures
  // synchronously so the first paint after a rotation is already correct.
  const [isNarrowLayout, setIsNarrowLayout] = useState(false)
  const layoutRoRef = useRef(null)
  const layoutRef = useCallback((node) => {
    if (layoutRoRef.current) {
      layoutRoRef.current.disconnect()
      layoutRoRef.current = null
    }
    if (!node) return
    const measure = (w) => setIsNarrowLayout(w > 0 && w <= 1080)
    measure(node.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      measure(entries[0]?.contentRect?.width || 0)
    })
    ro.observe(node)
    layoutRoRef.current = ro
  }, [])
  const [dayModeLocal, setDayModeLocal] = useState(false)
  const dayMode = dayModeProp !== undefined ? dayModeProp : dayModeLocal
  const setDayMode = (value) => {
    if (onDayModeChange) onDayModeChange(value)
    else setDayModeLocal(value)
  }

  // Sync body class for CSS theme selectors
  useEffect(() => {
    document.body.classList.toggle('theme-light', dayMode)
    return () => document.body.classList.remove('theme-light')
  }, [dayMode])

  const rzNavigate = useNavigate()
  const rzLocation = useLocation()
  const [symbol, setSymbol] = useState(() => {
    const fromProp = (initialSymbol || '').toString().trim().toUpperCase()
    if (fromProp) return fromProp
    return DEFAULT_SYMBOL
  })

  // Seed token cache from search context so the hook doesn't need to re-resolve
  if (initialToken) seedTokenCache(initialToken)

  // Unified data hook - replaces ~400 lines of data fetching.
  // Memoize the options object: an inline literal would change identity on
  // every render and (if the hook ever lists `options` in deps) trigger a
  // refetch cascade.
  const rzDataOptions = useMemo(
    () => ({ isStock, marketMode, fetchTrending: cinemaMode }),
    [isStock, marketMode, cinemaMode],
  )
  const data = useResearchZoneData(symbol, rzDataOptions)

  // ── PR-6 (perf): critical-data-first scheduling ───────────────────────────
  // Secondary surfaces (news, exchange markets table, sentiment/tweets) used
  // to fetch on mount, competing with the hero price + chart candles for
  // bandwidth and server fan-out during the first seconds. Defer them until
  // the hero has painted (price loading settled), then release at idle. The
  // 2s idle timeout guarantees they ALWAYS run - a stalled price fetch can
  // never starve the rest of the page. Rendered output is unchanged; the
  // secondary panels just stop racing the critical path.
  const heroPainted = !data.loading.price || !data.loading.token
  const [deferReady, setDeferReady] = useState(false)
  useEffect(() => {
    if (deferReady) return
    if (!heroPainted) return
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200))
    const cancel = window.cancelIdleCallback || clearTimeout
    const id = idle(() => setDeferReady(true), { timeout: 2000 })
    return () => { try { cancel(id) } catch { /* ignore */ } }
  }, [heroPainted, deferReady])
  // Belt-and-suspenders: never hold secondary data hostage longer than 3s
  // even if the price fetch hangs entirely.
  useEffect(() => {
    if (deferReady) return
    const t = setTimeout(() => setDeferReady(true), 3000)
    return () => clearTimeout(t)
  }, [deferReady])

  // Cold-load: warm the self-hosted TradingView library on an idle tick so its
  // 28KB loader is downloaded + parsed before the (lazy) chart mounts, instead
  // of the script fetch sitting on the chart's first-paint critical path. Runs
  // once on RZ mount; harmless + cached if the token ends up on the iframe path.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200))
    const cancel = window.cancelIdleCallback || clearTimeout
    const id = idle(() => warmTradingViewLibrary())
    return () => { try { cancel(id) } catch { /* ignore */ } }
  }, [])

  // Perf mark: hero price painted (consumed by the verification harness;
  // zero UI footprint).
  const pricePaintMarkedRef = React.useRef(false)
  useEffect(() => {
    if (pricePaintMarkedRef.current) return
    if (data.price?.current > 0) {
      pricePaintMarkedRef.current = true
      try { performance.mark('rz:price-painted') } catch { /* ignore */ }
    }
  }, [data.price?.current])

  // When navigating from Top Coins (tabs off), show the token that was clicked.
  useEffect(() => {
    const s = (initialSymbol || '').toString().trim().toUpperCase()
    if (s) setSymbol(prev => prev === s ? prev : s)
  }, [initialSymbol])

  // Track previous marketMode so we can reset symbol on toggle
  const prevMarketModeRef = React.useRef(marketMode)
  useEffect(() => {
    if (prevMarketModeRef.current === marketMode) return
    prevMarketModeRef.current = marketMode
    // Reset to sensible default when switching between crypto <-> stocks
    if (marketMode === 'stocks') {
      setSymbol('AAPL')
    } else {
      setSymbol('BTC')
    }
    // Clear stale data so new symbol fetches fresh
    setNewsItems([])
    setNewsLoading(true)
    setLastNewsUpdate(null)
    setNewsSource(null)
  }, [marketMode])

  const [marketFilter, setMarketFilter] = useState('all')
  const [newsItems, setNewsItems] = useState([])
  // The printed figures, from whichever source has them first. Polled while the
  // print is fresh because the wire fills in over minutes, not hours.
  const [reportedEarnings, setReportedEarnings] = useState(null)
  const [newsLoading, setNewsLoading] = useState(true)
  const [lastNewsUpdate, setLastNewsUpdate] = useState(null)
  const [marketsSectionTab, setMarketsSectionTab] = useState('markets')
  const [tokenCardPopup, setTokenCardPopup] = useState(null)
  const [tokenCardExpandedCard, setTokenCardExpandedCard] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightFeedTab, setRightFeedTab] = useState('tweets') // 'tweets' | 'news' | 'agent-rss' | 'agent'
  // Mount-once tracking: don't render heavy aside children until the user has
  // opened the aside at least once. After first open, they stay mounted (CSS
  // handles visibility via .research-zone-lite-*-collapsed) so scroll/state
  // survives close+reopen.
  //
  // 2026-06-04: reverted the requestIdleCallback defer from PR #772. The
  // defer originally targeted Lighthouse NO_LCP by holding news thumbnails
  // back so they couldn't churn the LCP candidate. It worked for the
  // metric — LCP went from NO_LCP -> 4.2s, score 39 -> 46 — but the
  // companion CSS reservation (#774, 2000 px sidebar min-height) turned
  // into long-scroll whitespace, which is the more important UX
  // regression. Going back to immediate mount, accepting the CLS cost.
  const [leftAsideMounted, setLeftAsideMounted] = useState(leftSidebarOpen)
  const [rightAsideMounted, setRightAsideMounted] = useState(sidebarOpen)
  useEffect(() => { if (leftSidebarOpen) setLeftAsideMounted(true) }, [leftSidebarOpen])
  useEffect(() => { if (sidebarOpen) setRightAsideMounted(true) }, [sidebarOpen])
  // Track which feed tabs have been viewed - viewed tabs stay mounted with
  // display: none to preserve scroll position and avoid re-running effects.
  const [viewedFeedTabs, setViewedFeedTabs] = useState(() => new Set([rightFeedTab]))
  useEffect(() => {
    setViewedFeedTabs((prev) => {
      if (prev.has(rightFeedTab)) return prev
      const next = new Set(prev)
      next.add(rightFeedTab)
      return next
    })
  }, [rightFeedTab])
  // Reset Stats tab back to Tweets if user widens window past the narrow threshold.
  useEffect(() => {
    if (!isNarrowLayout && rightFeedTab === 'stats') setRightFeedTab('tweets')
  }, [isNarrowLayout, rightFeedTab])
  // Default to Markets tab — light, fast (exchange table + price), and the
  // first tab in the nav. Project is the heaviest (2k+ lines, dossier-driven,
  // fundraising, holders, audits, lunarcrush, etc.) and was the bottleneck on
  // first paint, especially in day mode where CSS overrides add an extra
  // style pass. Stocks only have Markets.
  const { desktopSection: activeSection, mobileTab, selectDesktop: setActiveSection, selectMobile } = useResearchZoneNavigation(isStock)

  // Latest-value refs so long-lived polling effects can read the current active
  // center tab / right-feed tab WITHOUT re-subscribing (tearing down + re-firing)
  // every time the user switches a tab. Used to gate background polls.
  const rightFeedTabRef = useRef(rightFeedTab)
  rightFeedTabRef.current = rightFeedTab
  const activeSectionRef = useRef(activeSection)
  activeSectionRef.current = activeSection

  // Desktop gates sentiment-block data (score/social/90d-plot/market-details +
  // mindshare) behind the Sentiment tab. Mobile and Cinema render that data
  // eagerly with no equivalent tab gate, so they must always fetch it — else
  // their sentiment panels would sit empty. `cinemaMode`/`isMobile` are defined
  // above; this recomputes each render which is fine (cheap boolean).
  const wantSentimentData = !isStock && (activeSection === 'sentiment' || isMobile || cinemaMode)

  // Watchlist context for unified sidebar
  const { watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist } = useWatchlists()
  const marketModeFromStore = useSettingsStore((s) => s.marketMode)

  // Voice control state - driven by TradingChart's onVoiceStateChange callback
  // Store toggleVoice in a ref to avoid re-render loops (it's a new fn ref each render)
  const [voiceState, setVoiceState] = useState({ isListening: false, isSupported: false, lastCommand: null })
  const voiceToggleRef = useRef(null)
  const handleVoiceStateChange = useCallback((state) => {
    voiceToggleRef.current = state.toggleVoice
    setVoiceState({ isListening: state.isListening, isSupported: state.isSupported, lastCommand: state.lastCommand })
  }, [])

  // Chart drag-to-resize
  const [chartHeight, setChartHeight] = useState(480)
  const chartHeightRef = useRef(480)

  const dragCleanupRef = useRef(null)

  const onChartDragStart = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragCleanupRef.current) dragCleanupRef.current()
    const startY = e.clientY
    const startH = chartHeightRef.current
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:row-resize;'
    document.body.appendChild(overlay)
    let pendingH = null
    let rafId = null
    const flush = () => {
      rafId = null
      if (pendingH != null) {
        chartHeightRef.current = pendingH
        setChartHeight(pendingH)
        pendingH = null
      }
    }
    const onMove = (ev) => {
      pendingH = Math.max(250, Math.min(900, startH + (ev.clientY - startY)))
      if (rafId == null) rafId = requestAnimationFrame(flush)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      window.removeEventListener('blur', cleanup)
      window.removeEventListener('keydown', onKey)
      if (rafId != null) cancelAnimationFrame(rafId)
      if (pendingH != null) {
        chartHeightRef.current = pendingH
        setChartHeight(pendingH)
        pendingH = null
      }
      if (overlay.parentNode) overlay.remove()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }
    const onKey = (ev) => { if (ev.key === 'Escape') cleanup() }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    window.addEventListener('blur', cleanup)
    window.addEventListener('keydown', onKey)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    dragCleanupRef.current = cleanup
  }, [])

  useEffect(() => () => { if (dragCleanupRef.current) dragCleanupRef.current() }, [])

  // Scroll spy removed - tabs now switch content directly, no scroll-to-section

  useEffect(() => {
    if (!symbol) return
    const currentSlug = window.location.pathname.split('/research-zone/')[1]
    // Don't overwrite if the current slug already resolves to this symbol
    // (e.g. /research-zone/palm-ai should stay, not rewrite to /research-zone/palm)
    if (currentSlug) {
      const resolvedFromCurrent = resolveSlugToSymbol(currentSlug)
      if (resolvedFromCurrent?.toUpperCase() === symbol.toUpperCase()) return
      // Preserve CoinGecko ID slug (e.g. /research-zone/whitebit for WBT)
      if (data.token?.cgId && currentSlug === data.token.cgId) return
    }
    const slug = getTokenSlug(symbol, marketMode === 'stocks', data.token?.cgId)
    const expectedPath = `/research-zone/${slug}`
    if (window.location.pathname !== expectedPath) {
      rzNavigate(
        {
          pathname: expectedPath,
          search: window.location.search,
        },
        { replace: true }
      )
    }
  }, [symbol, marketMode, rzNavigate, rzLocation.state, data.token?.cgId])

  // Token-branded ambient background glow - with brightness-safe variants.
  // Falls back from curated TOKEN_ROW_COLORS → server KV → canvas extraction → hash.
  const displayColors = useMemo(() => getTokenDisplayColors(symbol), [symbol])
  const brand = useTokenBrandColor(symbol, data.token?.logo, data.token?.address)
  const tokenAmbientStyle = useMemo(() => {
    // For curated tokens, use the existing brightness-aware accents from the
    // static map. For everything else, derive accents from the resolved brand
    // RGB so unknown tokens get a real glow instead of the purple fallback.
    if (brand.source === 'curated') {
      return {
        '--rz-token-rgb': brand.rgb,
        '--rz-token-rgb-accent': displayColors.accent,
        '--rz-token-rgb-accent-day': displayColors.accentDay,
        '--rz-token-gradient': brand.gradient,
        '--rz-glow-opacity': displayColors.glowOpacity,
      }
    }
    const brightness = getColorBrightness(brand.rgb)
    const isDark = brightness < 60
    return {
      '--rz-token-rgb': brand.rgb,
      '--rz-token-rgb-accent': brand.rgb,
      '--rz-token-rgb-accent-day': brand.rgb,
      '--rz-token-gradient': brand.gradient,
      '--rz-glow-opacity': isDark ? 0.45 : 0.20,
    }
  }, [brand, displayColors])


  const [newsSource, setNewsSource] = useState(null) // 'CryptoPanic' | 'CryptoCompare' | 'RSS'

  // Track latest token name via ref so the news filter can match by full
  // name without forcing a refetch on identity enrichment.
  const tokenNameRef = useRef(data.token?.name || null)
  tokenNameRef.current = data.token?.name || null

  // News fetching - parallel with priority fallback
  const fetchNews = useCallback(() => {
    setNewsSource(null)
    setNewsLoading(true)
    if (isStock) {
      const companyName = FALLBACK_STOCK_DATA[symbol]?.name || data.stockData?.name || ''
      getReportedEarnings(symbol, companyName).then((r) => {
        if (r && (r.status === 'reported' || r.status === 'pending')) setReportedEarnings(r)
      }).catch(() => {})
      getStockNews(symbol, companyName).then((items) => {
        // getStockNews already returns the canonical right-rail shape
        // ({ id, title, url, summary, source, imageUrl, publishedOn }) sourced
        // from Google News (real catalysts), so use it verbatim — the old
        // re-map dropped summaries + timestamps and stayed "Loading…" on empty.
        const list = Array.isArray(items) ? items : []
        if (list.length > 0) {
          setNewsItems(list)
          setLastNewsUpdate(Date.now())
          setNewsSource('News')
        } else {
          setNewsItems([])
        }
      }).catch(() => { setNewsItems([]) }).finally(() => setNewsLoading(false))
      return
    }

    // Relevance filter: CryptoPanic/CryptoCompare loosely classify news by
    // ticker and the BTC bucket pulls in WETH/BNB/Verus/SpaceX stories that
    // just happen to share the crypto feed. Verify each item actually
    // mentions THIS token in title or summary before showing it.
    const upperSym = String(symbol || '').replace(/^\$/, '').toUpperCase()
    const tokenName = tokenNameRef.current || ''
    const cashtagRe = upperSym
      ? new RegExp(`(?:^|[^A-Za-z0-9_])\\$${upperSym}(?![A-Za-z0-9_])`, 'i')
      : null
    const symbolWordRe = upperSym
      ? new RegExp(`(?:^|[^A-Za-z0-9_])${upperSym}(?![A-Za-z0-9_])`, 'i')
      : null
    const nameRe = tokenName && tokenName.length >= 3
      ? new RegExp(`\\b${tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      : null
    const isRelevantNews = (item) => {
      if (!upperSym) return true
      const haystack = `${item?.title || ''} ${item?.summary || item?.description || ''}`
      if (!haystack.trim()) return false
      if (cashtagRe && cashtagRe.test(haystack)) return true
      if (nameRe && nameRe.test(haystack)) return true
      if (symbolWordRe && symbolWordRe.test(haystack)) return true
      return false
    }

    // MERGE all sources instead of first-non-empty (2026-07-02): the old
    // source-priority chain let a stale CryptoPanic bucket win over fresher
    // items, so the rail showed days-old stories. Spectre's own data-api news
    // aggregation (/v1/news?symbol=) carries today's CoinDesk/Block/
    // Cointelegraph items and goes in the blend; everything is deduped by
    // title and sorted by publish time so the newest story is always on top.
    Promise.allSettled([
      // `name` drives the search lane - 'Ethereum' pulls far more than 'ETH'.
      getSpectreNews({ symbol, name: tokenNameRef.current || '', limit: 15 }),
      getCryptoNews(symbol, 10),
      getRssMarketNews(symbol, 10),
    ]).then(([spectreRes, newsRes, rssRes]) => {
      const spectreList = (spectreRes.status === 'fulfilled' && Array.isArray(spectreRes.value) ? spectreRes.value : []).filter(isRelevantNews)
      const newsList = (newsRes.status === 'fulfilled' ? newsRes.value : []).filter(isRelevantNews)
      const rssList = (rssRes.status === 'fulfilled' ? rssRes.value : []).filter(isRelevantNews)

      const seen = new Set()
      const merged = []
      for (const item of [...spectreList, ...newsList, ...rssList]) {
        const key = String(item?.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (!key || seen.has(key)) continue
        seen.add(key)
        merged.push(item)
      }
      merged.sort((a, b) => (b.publishedOn || 0) - (a.publishedOn || 0))

      if (merged.length > 0) {
        setNewsItems(merged.slice(0, 12))
        setLastNewsUpdate(Date.now())
        setNewsSource(spectreList.length > 0 ? 'News' : newsList.length > 0 ? 'CryptoPanic' : 'RSS')
      } else {
        setNewsItems([])
      }
    }).finally(() => setNewsLoading(false))
  }, [symbol, isStock, data.stockData?.name])

  // Fetch news on symbol change (deferred until the hero has painted - PR-6)
  useEffect(() => {
    setNewsItems([])
    setLastNewsUpdate(null)
    setNewsSource(null)
    if (!deferReady) return
    fetchNews()
  }, [fetchNews, deferReady])

  // Auto-refresh news
  useAdaptivePolling(fetchNews, { interval: 2.5 * 60 * 1000, enabled: deferReady })

  // Agent RSS signals — composer route returns brain + derived signals for any
  // CG-listed token. Visibility-gated: only fetches when the user has actually
  // opened the agent-rss tab at least once (per api-patterns.md section L).
  // Stocks have no signal coverage so we skip.
  const agentSignalsAsset = data.token?.cgId || (symbol ? String(symbol).toLowerCase() : null)
  const agentSignalsEnabled = !isStock && !!agentSignalsAsset && viewedFeedTabs.has('agent-rss')
  const fetchAgentSignals = useCallback(() => {
    if (!agentSignalsEnabled) return
    getAgentSignals(agentSignalsAsset).then((sigs) => {
      setAgentSignals(Array.isArray(sigs) ? sigs : [])
    })
  }, [agentSignalsEnabled, agentSignalsAsset])
  useEffect(() => { fetchAgentSignals() }, [fetchAgentSignals])
  useAdaptivePolling(fetchAgentSignals, { interval: 60 * 1000, enabled: agentSignalsEnabled })

  // Markets data (exchange tickers) from CoinGecko - single consolidated effect
  const [marketsData, setMarketsData] = useState([])
  const [marketsLoading, setMarketsLoading] = useState(false)

  // Client-side tier sort as a safety net. Prod hits Hetzner's
  // /api/token-markets via Vercel proxy, which may not apply the same
  // tier-1 + wash-trade penalty as our local Express. Re-sort here so the
  // UI shows Binance/Coinbase/Bybit/Kraken at the top regardless of
  // backend variant. Wash-trade venues (BTCC, Azbit, Pionex, KCEX,
  // CoinUp.io, etc.) sink to the bottom.
  const sortedMarketsData = useMemo(() => {
    const rank = (m) => {
      const n = m?.exchange || ''
      if (MARKET_TIER1.has(n)) return 0
      if (m?.trustScore === 'green') return 1
      if (MARKET_TIER2.has(n)) return 2
      if (MARKET_WASH.has(n)) return 5
      if (m?.trustScore === 'yellow') return 3
      if (m?.trustScore === 'red') return 5
      return 4
    }
    if (!Array.isArray(marketsData) || !marketsData.length) return marketsData
    return [...marketsData].sort((a, b) => {
      const ra = rank(a), rb = rank(b)
      if (ra !== rb) return ra - rb
      return (b?.volume24h || 0) - (a?.volume24h || 0)
    })
  }, [marketsData])

  const tokenCgId = data.token?.cgId || null
  const tokenAddress = data.token?.address || null
  const marketsSymbolRef = useRef(null)
  useEffect(() => {
    if (isStock) { setMarketsData([]); setMarketsLoading(false); return }
    let cancelled = false
    // Blank the table only when the SYMBOL changed. This effect also re-runs
    // when tokenCgId/tokenAddress resolve a beat after mount — wiping the
    // already-painted rows there threw away the first fetch and restarted the
    // skeleton mid-view. Same-symbol re-runs keep rows and swap in the richer
    // result when it lands.
    if (marketsSymbolRef.current !== symbol) {
      marketsSymbolRef.current = symbol
      setMarketsData([])
      setMarketsLoading(true)
    }
    // No deferReady gate here anymore: Markets is now the DEFAULT tab, so this
    // IS the primary content — holding it behind the hero-paint idle window
    // added up to 3s to the first thing the user is looking at.
    // Pass `address` so getTokenMarkets can fall back to DexScreener for
    // DEX-only microcaps when CG/Spectre return nothing (Uniswap, Raydium,
    // Cetus, etc.). Free upstream — no quota concern.
    // onPartial paints (a) the localStorage seed instantly on revisits and
    // (b) spot rows as soon as they land, without waiting for the slower
    // derivatives call — the final .then() replaces with the full merge.
    getTokenMarkets(symbol, tokenCgId, {
      address: tokenAddress,
      onPartial: (partial) => {
        if (cancelled) return
        const markets = partial?.markets || []
        if (markets.length > 0) {
          setMarketsData(markets)
          setMarketsLoading(false)
        }
      },
    }).then((result) => {
      if (!cancelled) {
        const markets = result?.markets || (Array.isArray(result) ? result : [])
        setMarketsData(markets)
        setMarketsLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setMarketsLoading(false)
    })
    return () => { cancelled = true }
  }, [symbol, isStock, tokenCgId, tokenAddress])

  const refreshMarkets = useCallback(() => {
    if (isStock) return
    getTokenMarkets(symbol, tokenCgId, { address: tokenAddress }).then((result) => {
      const markets = result?.markets || (Array.isArray(result) ? result : [])
      setMarketsData(markets)
    }).catch(() => {})
  }, [symbol, isStock, tokenCgId, tokenAddress])

  // Only poll the exchange table while the Markets tab is actually open. The
  // initial fetch (above) still runs on mount since Markets is the default tab;
  // this just stops the 10-min background refresh once the user moves to
  // Project/Sentiment/Technicals.
  useAdaptivePolling(refreshMarkets, { interval: 10 * 60 * 1000, enabled: !isStock && activeSection === 'markets' })

  // ── Spectre Backend API data (for Pro mode tabs) ─────────────────────────
  const [spectreSentScore, setSpectreSentScore] = useState(null)
  const [spectreFearGreed, setSpectreFearGreed] = useState(null)
  const [spectreSocial, setSpectreSocial] = useState(null)
  const [spectrePlotData, setSpectrePlotData] = useState(undefined)
  const [spectreTweets, setSpectreTweets] = useState(null)
  const [spectreTweetsLoading, setSpectreTweetsLoading] = useState(false)
  // Split feeds: Influencer Tweets (xdash, KOL-only) vs Social (live feed,
  // chronological). Both live alongside the legacy spectreTweets so any
  // surface still consuming the combined array (KOL bubbles, mobile, feed
  // panel) keeps working unchanged.
  const [influencerTweets, setInfluencerTweets] = useState(null)
  const [socialFeedTweets, setSocialFeedTweets] = useState(null)
  const [officialTweets, setOfficialTweets] = useState(null)
  const [officialTweetsLoading, setOfficialTweetsLoading] = useState(true)
  const [spectreMarketDetails, setSpectreMarketDetails] = useState(null)
  const [tradeMarkers, setTradeMarkers] = useState(null)
  const [agentSignals, setAgentSignals] = useState([])

  // Wipe the previous token's data the instant `symbol` changes so the user
  // never sees BTC's mcap/news/sentiment bleeding through while AERO loads.
  // Set-during-render pattern: React aborts the current render and re-renders
  // with the cleared state — no flash before useEffect cleanups fire.
  const [prevSymbol, setPrevSymbol] = useState(symbol)
  if (symbol !== prevSymbol) {
    setPrevSymbol(symbol)
    setNewsItems([])
    setNewsLoading(true)
    setLastNewsUpdate(null)
    setNewsSource(null)
    setAgentSignals([])
    setMarketsData([])
    setMarketsLoading(true)
    setSpectreSentScore(null)
    setSpectreSocial(null)
    setSpectrePlotData(undefined)
    setSpectreTweets(null)
    setSpectreTweetsLoading(true)
    setInfluencerTweets(null)
    setSocialFeedTweets(null)
    setOfficialTweets(null)
    setOfficialTweetsLoading(true)
    setSpectreMarketDetails(null)
    setTradeMarkers(null)
    setAgentSignals([])
  }

  // ── Haitam Backend enrichment (token profile, AI scenario, fundamentals) ──
  // Gate cgId on the resolved token actually being the symbol on screen. On a
  // switch to a non-major, data.token (and its cgId) lags the synchronous hero
  // reset by the resolve window, so without this guard the Project/Sentiment
  // tabs show the PREVIOUS token's scenario/fundamentals/profile while the hero
  // already shows the new one. Null cgId on a clear symbol mismatch -> the
  // enrichment hooks return null (clean) until the new cgId resolves.
  const tokenIdentityStale = data.token?.symbol && symbol
    && String(data.token.symbol).toUpperCase() !== String(symbol).toUpperCase()
  const cgId = (isStock || tokenIdentityStale) ? null : (data.token?.cgId || null)
  // PR-6 (perf): hold these two enrichment hooks (4 Spectre calls — token
  // profile + technicals + market scenario) off the critical path until the
  // hero has painted. They feed the Project/Sentiment/Technicals tab bodies,
  // not the hero, so racing the first-second price+chart paint just slowed it.
  // deferReady flips on the idle tick after hero paint (3s belt-and-suspenders),
  // and both hooks bail on a null cgId, so this cleanly defers the fetch.
  const deferredCgId = deferReady ? cgId : null
  const { profile: tokenProfile } = useTokenProfile(deferredCgId)
  const { scenario: apiScenario } = useMarketScenario(deferredCgId)
  const { grades: fundamentalsGrades } = useTokenFundamentals(tokenProfile)

  // ── Real sector data + mindshare from Command Center API ──────────────────
  // sectorData/sectorAiAnalysis render only inside the Sentiment/Intelligence
  // tabs (same panels as mindshare) — gate on wantSentimentData so the two
  // market-wide Spectre calls (categories + intelligence signals) don't fire on
  // every cold load while the default Project tab is showing.
  const { sectors: sectorData, aiAnalysis: sectorAiAnalysis } = useSectorData({ sectorLimit: 20, enabled: wantSentimentData })
  // Mindshare renders only inside the Sentiment tab (desktop) — gate the hook so
  // it stops polling market-wide narrative data (was 60s) while Sentiment is
  // closed. Mobile/cinema render it eagerly, so wantSentimentData covers those.
  const { data: mindshareData } = useMindshareData({ enabled: wantSentimentData })

  // Fear & Greed - global metric, fetch once (no symbol dependency).
  // PR-6 (perf): deferred to after hero paint - it feeds a below-fold sentiment
  // widget, so it has no business competing on the critical path.
  useEffect(() => {
    if (!deferReady) return
    let cancelled = false
    getFearGreed().then((data) => {
      if (!cancelled) setSpectreFearGreed(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [deferReady])

  // Symbol-specific tweet feeds (X-Dash). The right-rail Tweets panel is the
  // default view, so these fetch on every token. The 60s poll is gated on the
  // Tweets rail (or Sentiment tab) actually being on screen — if the user is
  // reading News/Agent/Project/Dossier we skip the refresh and save the X-Dash
  // quota. Visibility-gated (skips when the tab is hidden) per
  // .claude/rules/api-patterns.md section L.
  useEffect(() => {
    if (isStock) return
    if (!deferReady) return // PR-6: wait for hero paint before the X-Dash fan-out
    let cancelled = false
    const initial = !spectreTweets
    if (initial) {
      setSpectreTweets(null)
      setInfluencerTweets(null)
      setSocialFeedTweets(null)
      setSpectreTweetsLoading(true)
    }

    const fetchTweets = () => Promise.allSettled([
      // Pass cgId + name so X-Dash filtering can reject lookalike tokens
      // (e.g. @WrappedBTC / $WBTC posts for BTC).
      getTokenTweets(symbol, { cgId: data.token?.cgId, name: data.token?.name }),
      getInfluencerTweets(symbol, { cgId: data.token?.cgId, name: data.token?.name, limit: 20 }),
      // Deeper community pull — this is the only stream with sub-50k voices,
      // so it single-handedly feeds the Community tab.
      getSocialFeedTweets(symbol, { name: data.token?.name, limit: 40 }),
    ]).then(([tweets, influencer, socialFeed]) => {
      if (cancelled) return
      setSpectreTweets(
        tweets.status === 'fulfilled' && Array.isArray(tweets.value)
          ? tweets.value.slice(0, 40).map(normalizeTweet)
          : []
      )
      setInfluencerTweets(
        influencer.status === 'fulfilled' && Array.isArray(influencer.value)
          ? influencer.value.map(normalizeTweet)
          : []
      )
      setSocialFeedTweets(
        socialFeed.status === 'fulfilled' && Array.isArray(socialFeed.value)
          ? socialFeed.value.map(normalizeTweet)
          : []
      )
      setSpectreTweetsLoading(false)
    }).catch(() => {
      if (!cancelled) setSpectreTweetsLoading(false)
    })

    // Skip the initial fan-out if the tab is hidden on mount — a backgrounded
    // tab firing social calls (+ stuck loading shimmer) wastes the quota.
    // A visibilitychange handler runs it once when the tab is foregrounded.
    let firedInitial = false
    let removeVisible = null
    if (document.hidden) {
      const onVisible = () => {
        if (document.hidden || cancelled || firedInitial) return
        firedInitial = true
        fetchTweets()
      }
      document.addEventListener('visibilitychange', onVisible)
      removeVisible = () => document.removeEventListener('visibilitychange', onVisible)
    } else {
      firedInitial = true
      fetchTweets()
    }
    const interval = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      // Only refresh while the tweets are actually on screen (default rail or
      // Sentiment tab). Read via ref so switching tabs doesn't re-fire the effect.
      if (rightFeedTabRef.current !== 'tweets' && activeSectionRef.current !== 'sentiment') return
      firedInitial = true
      fetchTweets()
    }, 60_000)
    return () => { cancelled = true; clearInterval(interval); removeVisible?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, isStock, data.token?.cgId, data.token?.name, deferReady])

  // Sentiment-block data (score, social stats, 90-day plot, market details)
  // feeds ONLY the Sentiment center tab. Gated behind the active tab so a token
  // nav that never opens Sentiment skips 4 calls (including a 90-day price
  // history pull). Fetches on tab-open / symbol-change-while-active, then polls
  // 60s while it stays open. Visibility-gated.
  useEffect(() => {
    if (!deferReady) return
    if (!wantSentimentData) return
    let cancelled = false

    // Desktop SentimentTab consumes ONLY spectreSocial (the social-links row) —
    // score/90d-plot/market-details fed components that no longer render there.
    // Mobile + Cinema still render all four, so they keep the full pull.
    const wantFullBlock = isMobile || cinemaMode
    const fetchSentiment = () => Promise.allSettled([
      getTokenSocial(symbol),
      wantFullBlock ? getSentimentScore(symbol) : Promise.resolve(null),
      wantFullBlock ? getSentimentPlotData(symbol) : Promise.resolve(null),
      wantFullBlock ? getTokenMarketDetails(symbol) : Promise.resolve(null),
    ]).then(([social, sent, plot, markets]) => {
      if (cancelled) return
      setSpectreSocial(social.status === 'fulfilled' ? social.value : null)
      if (!wantFullBlock) return
      setSpectreSentScore(sent.status === 'fulfilled' && sent.value ? normalizeSentimentScore(sent.value) : null)
      setSpectrePlotData(plot.status === 'fulfilled' && plot.value ? normalizePlotData(plot.value) : null)
      setSpectreMarketDetails(
        markets.status === 'fulfilled' && markets.value ? normalizeMarketDetails(markets.value) : null
      )
    }).catch(() => {})

    if (!document.hidden) fetchSentiment()
    const interval = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      fetchSentiment()
    }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, deferReady, wantSentimentData, isMobile, cinemaMode])

  // ── Stock tweets — the crypto effect above bails on `isStock`, which left
  // the panel stuck on "Loading tweets…" forever (loading flag never cleared).
  // Stocks have no cgId/contract, but the tweet fetchers cashtag on the symbol
  // ($NFLX), so this dedicated effect pulls real ticker tweets and ALWAYS
  // resolves the loading state to an array (empty -> "No tweets" empty state).
  useEffect(() => {
    if (!isStock) return
    if (!deferReady) return // PR-6: wait for hero paint
    let cancelled = false
    setSpectreTweetsLoading(true)

    const fetchStockTweets = () => Promise.allSettled([
      getTokenTweets(symbol, { name: data.token?.name }),
      getInfluencerTweets(symbol, { name: data.token?.name, limit: 20 }),
      getSocialFeedTweets(symbol, { name: data.token?.name, limit: 40 }),
    ]).then(([tweets, influencer, socialFeed]) => {
      if (cancelled) return
      setSpectreTweets(
        tweets.status === 'fulfilled' && Array.isArray(tweets.value)
          ? tweets.value.slice(0, 40).map(normalizeTweet)
          : []
      )
      setInfluencerTweets(
        influencer.status === 'fulfilled' && Array.isArray(influencer.value)
          ? influencer.value.map(normalizeTweet)
          : []
      )
      setSocialFeedTweets(
        socialFeed.status === 'fulfilled' && Array.isArray(socialFeed.value)
          ? socialFeed.value.map(normalizeTweet)
          : []
      )
      setSpectreTweetsLoading(false)
    }).catch(() => {
      if (!cancelled) setSpectreTweetsLoading(false)
    })

    fetchStockTweets()
    const interval = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      fetchStockTweets()
    }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, isStock, data.token?.name, deferReady])

  // ── Official tweets from the token's Twitter account — polled 60s ─────────
  // PR-6 (perf): gated on deferReady so this right-rail feed (often off-screen
  // behind the default tab) doesn't fire on the critical path during hero paint.
  useEffect(() => {
    if (!deferReady) return // wait for hero paint before the X-Dash fetch
    const twitterUrl = data.about?.links?.twitter || ''
    const twitterUsername = twitterUrl.replace(/^https?:\/\/(twitter\.com|x\.com)\//, '').replace(/\/.*$/, '').trim()
    if (!twitterUsername) {
      setOfficialTweets(null)
      setOfficialTweetsLoading(false)
      return
    }
    let cancelled = false
    setOfficialTweetsLoading(true)
    setOfficialTweets(null)

    const fetchOfficial = () => getOfficialTweets(twitterUsername)
      .then((resp) => {
        if (cancelled) return
        if (resp?.tweets?.length) {
          const tweets = resp.tweets.map((t, i) => normalizeOfficialTweet(t, `${t.username || twitterUsername}-${i}`))
          setOfficialTweets(tweets)
        }
        setOfficialTweetsLoading(false)
      })
      .catch(() => { if (!cancelled) setOfficialTweetsLoading(false) })

    fetchOfficial()
    const interval = setInterval(() => {
      if (document.hidden || !isAppActive()) return // idle guard: skip on abandoned-but-visible tab
      // Only refresh while the feed rail is actually on screen (default tweets
      // rail or Sentiment tab) — mirrors the search-tweets poll above. Initial
      // fetch already ran on mount, so hidden-rail consumers still have data.
      if (rightFeedTabRef.current !== 'tweets' && activeSectionRef.current !== 'sentiment') return
      fetchOfficial()
    }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [data.about?.links?.twitter, deferReady])

  // Blend all three X Dash streams into a single deduped feed for the
  // RzFeedPanel. Previously only `spectreTweets` (from getTokenTweets) was
  // wired in, leaving the dedicated KOL (`influencerTweets`) and live social
  // (`socialFeedTweets`) feeds unused. Blending gives the KOLs sub-tab real
  // breadth: @Bitcoin (8.6M followers), @cryptocom (3M), @michael_saylor,
  // @VitalikButerin, etc. show up when they tweet.
  const blendedSearchTweets = useMemo(() => {
    const a = Array.isArray(spectreTweets) ? spectreTweets : []
    const b = Array.isArray(influencerTweets) ? influencerTweets : []
    const c = Array.isArray(socialFeedTweets) ? socialFeedTweets : []
    if (!a.length && !b.length && !c.length) return spectreTweets
    const seen = new Set()
    const out = []
    for (const list of [a, b, c]) {
      for (const t of list) {
        const key = t?.id || t?.tweet_id || `${t?.handle || t?.username || ''}:${(t?.content || t?.tweet_text || t?.text || '').slice(0, 80)}`
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(t)
      }
    }
    return out
  }, [spectreTweets, influencerTweets, socialFeedTweets])

  // Thin adapter: build tokenData from hook's structured return values
  const tokenData = useMemo(() => {
    if (isStock && data.stockData) {
      const sd = data.stockData
      return {
        assetClass: 'stock',
        earningsDate: sd.earningsDate || null,
        earningsAvg: sd.earningsAvg ?? null,
        revenueAvg: sd.revenueAvg ?? null,
        earningsHistory: Array.isArray(sd.earningsHistory) ? sd.earningsHistory : [],
        targetMeanPrice: sd.targetMeanPrice ?? null,
        targetHighPrice: sd.targetHighPrice ?? null,
        targetLowPrice: sd.targetLowPrice ?? null,
        recommendationKey: sd.recommendationKey || null,
        analystCount: sd.analystCount ?? null,
        recTrend: sd.recTrend || null,
        price: data.price.current,
        change24h: data.price.change24h,
        rank: null,
        mcap: data.market.mcap,
        marketCap: data.market.mcap,
        volume24h: data.market.volume24h ?? data.price.volume24h,
        volume: data.market.volume24h ?? data.price.volume24h,
        fdv: null,
        volMcapPct: data.market.volMcapPct || '-',
        circulatingSupply: null,
        circulating: null,
        maxSupply: null,
        pe: sd.pe, forwardPe: sd.forwardPe || null, eps: sd.eps,
        // Live feed leaves sector blank for newer/special tickers (e.g. SPCX) —
        // fall back to our static map, then the (more descriptive) industry, so
        // the SECTOR card/pill/profile are never an empty "-" / "N/A".
        sector: sd.sector || FALLBACK_STOCK_DATA[symbol]?.sector || sd.industry || '',
        industry: sd.industry || sd.sector || FALLBACK_STOCK_DATA[symbol]?.sector || '',
        exchange: sd.exchange, week52High: sd.week52High, week52Low: sd.week52Low,
        avgVolume: sd.avgVolume, country: sd.country || 'US',
        description: sd.description || '', ipo: sd.ipo || null,
        employees: sd.employees || null, ceo: sd.ceo || null,
        website: sd.website || '', dividendYield: sd.dividendYield || null,
        beta: sd.beta || null, sharesOutstanding: sd.sharesOutstanding || null,
        previousClose: sd.previousClose || null, open: sd.open || null,
        dayHigh: sd.high || null, dayLow: sd.low || null,
        ath: data.market.ath, athDate: null, athChangePct: data.market.athChangePct,
        atl: data.market.atl, atlDate: null, atlChangePct: data.market.atlChangePct,
        score: null, low24h: data.price.low24h, high24h: data.price.high24h,
      }
    }
    // Reconcile mcap / circulating / price into a single consistent triple.
    // Sources disagree (AppResearch overlay returns mcap=$3.26M @ $0.32669 while Codex
    // DEX reports circulating=9.99M @ $0.3719 ≈ $3.71M). Use the SAME price priority
    // as the chart/header (Binance majors > Codex DEX > CG > generic) so the displayed
    // price card and the mcap stat agree.
    const ap = data.allPrices || {}
    const hasBinance = hasBinancePair(symbol)
    let price = (hasBinance && ap.binance?.current) ? ap.binance.current
      : (!hasBinance && ap.codex?.current) ? ap.codex.current
      : (ap.coingecko?.current) ? ap.coingecko.current
      : data.price.current
    // Price-source sanity guard. fdv / totalSupply is an independent read of the
    // token's unit price — it's what the chart, Markets tab and FDV all resolved
    // from (the contract-anchored source). When the picked hero price disagrees
    // with it by >100x the picker latched onto a wrong pool / wrong-decimals feed:
    // e.g. CASHCAT showed a $16K market cap (hero price $0.0000163) next to a $97M
    // FDV (price $0.098) on equal circ/total supply — a ~6000x gap. Adopt the
    // market-consistent price so the hero price + market cap line up with the
    // chart instead of contradicting it. The 100x floor leaves normal volatility
    // (even a fresh 10-50x runner) untouched — only gross feed errors trip it.
    const _totalSupply = Number(data.market.totalSupply) || 0
    const _fdvUnitPrice = (Number(data.market.fdv) > 0 && _totalSupply > 0)
      ? Number(data.market.fdv) / _totalSupply
      : 0
    if (price > 0 && _fdvUnitPrice > 0) {
      const _r = price / _fdvUnitPrice
      if (_r > 100 || _r < 0.01) price = _fdvUnitPrice
    }
    let circ = data.market.circulatingSupply
    let mcap = data.market.mcap
    if (circ && price) {
      mcap = circ * price
    } else if (mcap && price) {
      circ = mcap / price
    }
    const vol24h = data.market.volume24h ?? data.price.volume24h
    const volMcapPct = (vol24h && mcap) ? ((vol24h / mcap) * 100).toFixed(1) : (data.market.volMcapPct || '-')

    return {
      price,
      change24h: data.price.change24h,
      change1h: data.performance.change1h,
      change7d: data.performance.change7d,
      change30d: data.performance.change30d,
      rank: data.token?.rank,
      address: data.token?.address || null,
      // Staleness-guarded CG id (nulled while a new symbol's resolve is in
      // flight). Was never threaded into tokenData, so every td.cgId consumer
      // downstream (Sentiment tab engine, KOL bubbles xdash enrichment,
      // AI sentiment read) silently ran in symbol-only fallback mode.
      cgId,
      mcap, marketCap: mcap,
      volume24h: vol24h,
      volume: vol24h,
      fdv: data.market.fdv, volMcapPct,
      circulatingSupply: circ, circulating: circ,
      maxSupply: data.market.totalSupply,
      ath: data.market.ath, athDate: data.market.athDate, athChangePct: data.market.athChangePct,
      atl: data.market.atl, atlDate: data.market.atlDate, atlChangePct: data.market.atlChangePct,
      score: null, low24h: data.price.low24h, high24h: data.price.high24h,
    }
  }, [data.price, data.market, data.performance, data.token?.rank, data.token?.address, cgId, data.allPrices, symbol, isStock, data.stockData])

  // Sentiment-aware ambient mood wall - cinema-grade red/green wash
  const sentimentStyle = useMemo(() => {
    const change = tokenData?.change24h ?? 0
    const absChange = Math.abs(change)
    // Intensity scales with magnitude (capped at 4% for faster ramp)
    const intensity = Math.min(absChange / 4, 1)

    let sentimentRgb, sentimentMood, sentimentRgbAlt
    if (change >= 0.05) {
      sentimentRgb = '16, 185, 129'      // emerald green (matches landing page)
      sentimentRgbAlt = '20, 160, 100'   // darker green for depth
      sentimentMood = 'bull'
    } else if (change <= -0.05) {
      sentimentRgb = '185, 28, 28'       // crimson red (matches landing page)
      sentimentRgbAlt = '153, 27, 27'    // darker red for depth
      sentimentMood = 'bear'
    } else {
      sentimentRgb = '139, 92, 246'      // purple (neutral)
      sentimentRgbAlt = '100, 60, 200'
      sentimentMood = 'neutral'
    }

    // Opacity: 0 at neutral, ramps 0.22 -> 0.48 at +/-4% change (cinematic level)
    const sentimentOpacity = sentimentMood === 'neutral'
      ? 0
      : 0.22 + (intensity * 0.26)

    // Edge glow intensity for side pulse strips
    const edgeOpacity = sentimentMood === 'neutral'
      ? 0
      : 0.18 + (intensity * 0.22)

    return {
      vars: {
        '--rz-sentiment-rgb': sentimentRgb,
        '--rz-sentiment-rgb-alt': sentimentRgbAlt,
        '--rz-sentiment-opacity': sentimentOpacity.toFixed(3),
        '--rz-sentiment-edge': edgeOpacity.toFixed(3),
      },
      mood: sentimentMood,
    }
  }, [tokenData?.change24h])

  // Derive display variables from hook data
  const tokenName = isStock
    ? (data.stockData?.name || FALLBACK_STOCK_DATA[symbol]?.name || data.token?.name || symbol)
    : (data.token?.name || symbol)

  // Token logo from unified hook
  const tokenLogo = data.token?.logo || null

  // ── Catalyst layer ───────────────────────────────────────────────────────
  // The freshest real headlines on the page feed two surfaces:
  //   1. the AI agent's "why is $X moving?" context (named drivers, not fluff)
  //   2. derived Agent-RSS signal cards for assets the backend can't cover
  //      (every stock + longtail crypto), so the tab is never a dead end.
  // One source, computed once.
  const catalystNews = useMemo(
    () => extractCatalysts(newsItems, { limit: 6, change24h: tokenData?.change24h }),
    [newsItems, tokenData?.change24h]
  )
  const derivedAgentSignals = useMemo(
    () => deriveSignals({ symbol: String(symbol).toUpperCase(), tokenName, metrics: tokenData, newsItems }),
    [symbol, tokenName, tokenData, newsItems]
  )
  // Backend feed wins when it has coverage; otherwise show the derived story so
  // Agent-RSS is never a dead "No agent signals available".
  const displayAgentSignals = useMemo(
    () => (agentSignals && agentSignals.length ? agentSignals : derivedAgentSignals),
    [agentSignals, derivedAgentSignals]
  )

  // Crowd layer for the brain — sentiment tilt + the loudest real voices already
  // on the page (search + official tweets), so the agent reads the room (what X
  // is saying) and fuses it with the news, not just the headlines.
  const brainSocial = useMemo(() => {
    const pool = [...(blendedSearchTweets || []), ...(officialTweets || [])]
    const voices = pool
      .map((tw) => ({
        name: tw.name,
        handle: String(tw.handle || '').replace(/^@/, ''),
        followers: tw.followers || 0,
        verified: tw.is_verified === true || tw.has_dossier === true,
        text: String(tw.content || tw.text || tw.tweet_text || '').trim(),
      }))
      .filter((v) => v.text)
      .sort((a, b) => (b.followers || 0) - (a.followers || 0))
      .slice(0, 5)
    if (!voices.length && !spectreSentScore) return null
    return { sentScore: spectreSentScore, voices }
  }, [blendedSearchTweets, officialTweets, spectreSentScore])

  // Memoized so a new object identity isn't handed to the (memo'd) chart on
  // every parent render — a fresh chartToken would force the 5k-line
  // TradingChart to reconcile on unrelated state changes (feed polls, tab
  // switches). Live price flows separately via the `livePrice` prop.
  const chartToken = useMemo(() => ({
    ...(data.chartToken || { symbol, networkId: 1, address: null }),
    cgId: data.token?.cgId || null,
    name: tokenName,
    logo: tokenLogo,
    // Stocks: the REAL exchange (Yahoo code, e.g. NYQ) so TV symbol builders
    // resolve NYSE:JPM instead of guessing NASDAQ:JPM ("symbol doesn't exist")
    exchange: isStock ? (tokenData?.exchange || data.stockData?.exchange || undefined) : undefined,
    isStock,
  }), [data.chartToken, data.token?.cgId, tokenName, tokenLogo, isStock, symbol, tokenData?.exchange, data.stockData?.exchange])

  // Early head-bars prefetch (2026-07-10, cold-load chart speedup): on a cold
  // load the lazy TradingChart chunk + mount chain delays the chart's first
  // /api/bars by seconds, while the token's address is already known HERE -
  // and for GT-served on-chain tokens that request alone costs 4-8s upstream.
  // Fire the exact head window the canvas chart will ask for; useChartData's
  // fetchBars consumes the in-flight promise (ONE request total, no caching).
  // Canvas modes only: the TradingView widget runs its own datafeed with an
  // unpredictable window, so a prefetch there would double the upstream call.
  useEffect(() => {
    const addr = data.chartToken?.address
    if (!addr || isStock) return
    const { chartType, chartTimeframe } = useSettingsStore.getState()
    if (chartType === 'tradingview') return
    const tf = chartTimeframe || '1H'
    const resolution = PREFETCH_TF_RESOLUTION[tf]
    const periodHours = tf === 'YTD'
      ? Math.max(24, Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 3600000))
      : PREFETCH_TF_PERIOD[tf]
    if (!resolution || !periodHours) return
    const networkId = data.chartToken?.networkId || 1
    prefetchChartBars(`${addr}:${networkId}`, {
      resolution,
      periodHours,
      networkId,
      cgId: data.token?.cgId || null,
      binancePair: data.chartToken?.binancePair || null,
      tickerSymbol: symbol,
    })
    // Deliberately keyed on identity only - cgId arriving later must not
    // re-fire a second head request for the same token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.chartToken?.address, data.chartToken?.networkId, isStock])

  // Show skeletons until token identity AND its price+market metrics have
  // arrived. Without `market` here, the right-panel renders mcap=$0 and
  // circ-supply="-" while market data is still in flight (partial-load flash).
  const tokenLoading = data.loading.token || data.loading.price || data.loading.market

  // Memoized props bag for the markets section. Previously an inline object
  // literal in the RzProCenter JSX — a new reference every render guaranteed the
  // memo'd RzMarketsSection always re-rendered (e.g. on every feed-poll or
  // tab-switch). Now it only changes when its inputs actually change.
  const marketsProps = useMemo(() => ({
    isStock,
    symbol,
    tokenName,
    tokenData,
    marketsSectionTab,
    setMarketsSectionTab,
    marketFilter,
    setMarketFilter,
    icons,
    fmtPrice,
    fmtLarge,
    markets: sortedMarketsData,
    // Gate on identity only, NOT the hero's price/market lanes (tokenLoading).
    // The table's own fetch is bounded (~6-12s legs); riding tokenLoading made
    // it hostage to the slowest of SIX sources — a stalled bootstrap or a hung
    // market-profile hop held the shimmer for 20-30s+ with rows already in hand
    // (founder 08-07, SPECTRE during the box's cold-cache window).
    marketsLoading: marketsLoading || data.loading.token,
    newsItems,
    activeTokenInfo: data.chartToken,
    onMakerFilter: setTradeMarkers,
    reportedEarnings,
  }), [
    isStock, symbol, tokenName, tokenData, marketsSectionTab, marketFilter,
    fmtPrice, fmtLarge, sortedMarketsData, marketsLoading, data.loading.token,
    newsItems, data.chartToken, reportedEarnings,
  ])

  // RZ history + quick switcher (Alt+H or hero button)
  const rzHistory = useRzHistory({ symbol, name: tokenName, logo: tokenLogo, isStock })
  const handleQuickSwitchSelect = (item) => {
    if (!item?.symbol) return
    // Seed identity (address / cgId / logo) before navigating so a token picked
    // from live search resolves to its exact contract instead of a lossy
    // symbol-only lookup. No-ops safely for recents (symbol-only, no address).
    seedTokenCache(item)
    setSymbol(item.symbol.toUpperCase())
  }

  // RZ compare overlay
  const rzCompare = useRzCompare({ baseSymbol: symbol, baseCgId: data.token?.cgId || null })

  // Chart-matched live price: pick price from the same source the chart likely uses.
  // Chart priority: Binance klines (for majors) > on-chain/Codex (DEX tokens) > CG fallback.
  // This prevents the chart live line from disagreeing with its candle data.
  const chartLivePrice = useMemo(() => {
    if (isStock) return data.price.current
    const ap = data.allPrices || {}
    const hasBinance = hasBinancePair(symbol)
    if (hasBinance && ap.binance?.current) return ap.binance.current
    if (!hasBinance && chartToken?.address && ap.codex?.current) return ap.codex.current
    if (ap.coingecko?.current) return ap.coingecko.current
    return data.price.current
  }, [isStock, symbol, data.allPrices, data.price.current, chartToken?.address])

  // RZ annotations (per-token notes pinned at clicked candle)
  const rzAnnotations = useRzAnnotations({ symbol, currentPrice: chartLivePrice })
  const [noteMode, setNoteMode] = useState(false)
  const [notePopover, setNotePopover] = useState(null) // { mode, anchor, draftTs, draftPrice, note }
  const [comparePickerAnchor, setComparePickerAnchor] = useState(null)
  const [compareModeActive, setCompareModeActive] = useState(false)
  const compareBtnRef = useRef(null)
  const noteBtnRef = useRef(null)

  // ── Chart TA layer: highlight-to-analyse + drawing tools + AI lines ───────
  const chartRef = useRef(null)
  const drawBtnRef = useRef(null)
  const [drawMenuAnchor, setDrawMenuAnchor] = useState(null)
  // The seeded agent request. `id` changes per analysis so the chat fires it
  // exactly once, even across sidebar-tab remounts.
  const [taRequest, setTaRequest] = useState(null)
  // The chart's fullscreen layer covers the sidebar, so a read taken there had
  // nowhere to land. In fullscreen the agent moves INTO the layer as a side
  // panel; the request is routed to exactly one of the two so a read is never
  // billed twice.
  const [chartFullscreen, setChartFullscreen] = useState(false)

  const [fsAgentOpen, setFsAgentOpen] = useState(true)
  const handleAskAgent = useCallback((prompt, brief) => {
    setFsAgentOpen(true)
    setTaRequest({
      id: `${Date.now().toString(36)}`,
      prompt,
      display: `Read the highlighted window — ${brief.stats.tfLabel}, ${brief.stats.bars} bars, ${brief.stats.durationLabel}`,
    })
    // Auto-open the Agent tab so the answer lands where the user is looking.
    setRightFeedTab('agent')
  }, [])

  const chartTa = useRzChartTa({
    symbol,
    chartRef,
    price: chartLivePrice,
    onAskAgent: handleAskAgent,
  })

  // When compare token cleared from elsewhere, exit compare mode
  useEffect(() => {
    if (!rzCompare.compareSym && compareModeActive) setCompareModeActive(false)
  }, [rzCompare.compareSym, compareModeActive])

  // useCallback so TradingChart doesn't re-evaluate on every parent render.
  const handleCanvasAnnotateClick = useCallback(({ ts, price, screenX, screenY }) => {
    setNotePopover({
      mode: 'create',
      anchor: { x: screenX, y: screenY },
      draftTs: ts,
      draftPrice: price,
    })
    setNoteMode(false)
  }, [])

  // rzAnnotations.annotations is read via ref to keep handler identity stable
  // across annotation-list mutations.
  const annotationsRef = useRef(rzAnnotations.annotations)
  annotationsRef.current = rzAnnotations.annotations
  const handleAnnotationPinClick = useCallback(({ id, screenX, screenY }) => {
    const note = annotationsRef.current.find(a => a.id === id)
    if (!note) return
    setNotePopover({ mode: 'view', anchor: { x: screenX, y: screenY }, note })
  }, [])

  const handleToggleCompare = (event) => {
    // No compare token yet → open picker
    if (!rzCompare.compareSym) {
      if (comparePickerAnchor) {
        setComparePickerAnchor(null)
      } else {
        // Compact toolbars open this from the Tools menu; anchor to the
        // visible clicked button before that menu closes.
        const trigger = event?.currentTarget || compareBtnRef.current
        if (trigger) setComparePickerAnchor(trigger.getBoundingClientRect())
      }
      return
    }
    // Already comparing → toggle the full compare chart mode
    setCompareModeActive(v => !v)
  }

  const handleOpenComparePicker = (event) => {
    const trigger = event?.currentTarget || compareBtnRef.current
    if (trigger) setComparePickerAnchor(trigger.getBoundingClientRect())
  }

  const handleClearCompareMode = () => {
    setCompareModeActive(false)
    rzCompare.clearCompare()
  }

  const handleToggleNoteMode = () => {
    setNoteMode(prev => !prev)
    setNotePopover(null)
  }

  // Share-to-X for chart
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareImageUrl, setShareImageUrl] = useState(null)
  const [shareDescription, setShareDescription] = useState('')
  const [isShareExporting, setIsShareExporting] = useState(false)
  const chartTimeframePref = useSettingsStore((s) => s.chartTimeframe)
  const chartTypePref = useSettingsStore((s) => s.chartType)

  const handleShareChart = useCallback(async () => {
    if (isShareExporting) return
    setIsShareExporting(true)
    setShareImageUrl(null)
    setShareModalOpen(true)
    try {
      const { imageUrl, description } = await generateRzTokenShareCard({
        symbol,
        tokenName,
        tokenLogo,
        price: chartLivePrice ?? tokenData.price,
        tokenData,
        isStock,
        timeframe: chartTimeframePref || '1H',
        chartType: chartTypePref || 'candles',
        chartToken,
      })
      if (!mountedRef.current) return
      setShareDescription(description)
      if (!mountedRef.current) return
      setShareImageUrl(imageUrl)
    } catch (err) {
      console.error('RZ share failed:', err)
      if (!mountedRef.current) return
      setShareModalOpen(false)
    }
    if (!mountedRef.current) return
    setIsShareExporting(false)
  }, [isShareExporting, symbol, tokenName, tokenLogo, chartLivePrice, tokenData, isStock, chartToken, chartTimeframePref, chartTypePref])

  const chartExtraToolButtons = useMemo(() => {
    const shareBtn = {
      key: 'share',
      label: t('researchZone.share', 'Share'),
      title: isShareExporting ? t('researchZone.generatingShare', 'Generating share card…') : t('researchZone.shareToX', 'Share to X'),
      active: shareModalOpen,
      disabled: isShareExporting,
      onClick: handleShareChart,
      icon: (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 7V4l5 5-5 5v-3c-4 0-7 1.5-8 6 0-5 3-9 8-9z" />
        </svg>
      ),
    }
    // TA tools ship on every asset class — the geometry is asset-agnostic.
    const taBtns = [
      {
        key: 'ta-analyze',
        label: t('researchZone.aiTa', 'AI TA'),
        title: t('researchZone.aiTaTitle', 'Read the whole visible chart and open the agent'),
        active: false,
        onClick: chartTa.analyzeVisible,
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 2.5l1.6 3.6 3.9.4-2.9 2.6.8 3.8L10 11l-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z" />
            <path d="M4 16h12" opacity="0.4" />
          </svg>
        ),
      },
      {
        key: 'ta-highlight',
        label: t('researchZone.highlight', 'Highlight'),
        title: chartTa.taMode === 'select'
          ? t('researchZone.highlightPrompt', 'Drag a box over the chart to analyse that window')
          : t('researchZone.highlightTitle', 'Highlight a window and ask the agent'),
        active: chartTa.taMode === 'select',
        onClick: () => chartTa.setTool('select'),
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6.5V4h2.5M14.5 4H17v2.5M17 13.5V16h-2.5M5.5 16H3v-2.5" />
            <path d="M6.5 12l2.5-3 2 2 2.5-4" opacity="0.55" />
          </svg>
        ),
      },
      // Only rendered when there is something to clear — a permanently dead
      // button is worse than none, and it keeps the toolbar honest about state.
      ...(chartTa.hasDrawings || chartTa.analysis ? [{
        key: 'ta-clear',
        label: t('researchZone.clearTa', 'Clear'),
        title: t('researchZone.clearTaTitle', 'Clear the TA lines and the read'),
        active: false,
        onClick: () => chartTa.clearDrawings('all'),
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 6.5h13" />
            <path d="M8 6.5V4h4v2.5" />
            <path d="M5.5 6.5l.9 9.5h7.2l.9-9.5" />
          </svg>
        ),
      }] : []),
      {
        key: 'ta-draw',
        label: t('researchZone.draw', 'Draw'),
        title: t('researchZone.drawTitle', 'Draw trend lines and levels'),
        active: chartTa.taMode.startsWith('draw:') || !!drawMenuAnchor,
        btnRef: drawBtnRef,
        onClick: () => {
          setDrawMenuAnchor(a => (a ? null : (drawBtnRef.current?.getBoundingClientRect() ?? null)))
        },
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 3.5l3 3L7 16l-4 1 1-4z" />
            <path d="M11.5 5.5l3 3" />
          </svg>
        ),
      },
    ]
    if (isStock) return [...taBtns, shareBtn]
    const compareBtnActive = compareModeActive || !!comparePickerAnchor
    const compareTitle = rzCompare.compareSym
      ? (compareModeActive
          ? t('researchZone.comparingActive', 'Showing {{a}} vs {{b}} (click to exit)', { a: symbol, b: rzCompare.compareSym })
          : t('researchZone.compareWith', 'Compare with {{sym}}', { sym: rzCompare.compareSym }))
      : t('researchZone.compareWithOther', 'Compare with another token')
    return [
      ...taBtns,
      {
        key: 'compare',
        label: t('researchZone.compare', 'Compare'),
        title: compareTitle,
        active: compareBtnActive,
        btnRef: compareBtnRef,
        onClick: handleToggleCompare,
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 14l4-4 3 3 6-7" />
            <path d="M14 6h3v3" />
            <path d="M3 17h14" opacity="0.35" />
          </svg>
        ),
      },
      {
        key: 'note',
        label: t('researchZone.note', 'Note'),
        title: noteMode ? t('researchZone.notePinPrompt', 'Click on the chart to pin a note') : t('researchZone.notePin', 'Pin a note on the chart'),
        active: noteMode,
        btnRef: noteBtnRef,
        onClick: handleToggleNoteMode,
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2.5l3 3L7 16l-4 1 1-4z" />
            <path d="M12 5l3 3" />
          </svg>
        ),
      },
      shareBtn,
    ]
  }, [isStock, rzCompare.compareSym, comparePickerAnchor, noteMode, compareModeActive, symbol, isShareExporting, shareModalOpen, handleShareChart, chartTa.taMode, chartTa.setTool, chartTa.analyzeVisible, chartTa.clearDrawings, chartTa.hasDrawings, chartTa.analysis, drawMenuAnchor, t])

  // Build compare view props for the canvas overlay
  const compareViewProps = useMemo(() => {
    if (!compareModeActive || !rzCompare.compareSym) return null
    const baseTc = TOKEN_ROW_COLORS[symbol]
    const cmpTc = TOKEN_ROW_COLORS[rzCompare.compareSym]
    return {
      baseSymbol: symbol,
      compareSym: rzCompare.compareSym,
      baseSeries: rzCompare.baseData?.normalized || [],
      compareSeries: rzCompare.compareData?.normalized || [],
      baseColor: baseTc ? `rgb(${baseTc.bg})` : '#f5f5f7',
      compareColor: cmpTc ? `rgb(${cmpTc.bg})` : '#06B6D4',
      baseReturns: rzCompare.baseData?.returns || {},
      compareReturns: rzCompare.compareData?.returns || {},
      periods: rzCompare.periods,
      loading: rzCompare.loading,
      error: rzCompare.error,
      onClear: handleClearCompareMode,
      onChangeCompare: handleOpenComparePicker,
    }
  }, [compareModeActive, rzCompare.compareSym, rzCompare.baseData, rzCompare.compareData, rzCompare.periods, rzCompare.loading, rzCompare.error, symbol])

  const openTokenCardPopup = () => {
    setTokenCardPopup({
      symbol,
      name: tokenName,
      price: tokenData.price,
      change: tokenData.change24h,
      logo: tokenLogo,
      sparkline_7d: null,
    })
    setTokenCardExpandedCard(null)
  }

  const closeTokenCardPopup = () => {
    setTokenCardExpandedCard(null)
    setTokenCardPopup(null)
  }

  // Performance chips - real CoinGecko change percentages
  const performanceData = useMemo(() => [
    { label: '1H', value: tokenData.change1h || 0 },
    { label: '24H', value: tokenData.change24h || 0 },
    { label: '7D', value: tokenData.change7d || 0 },
    { label: '30D', value: tokenData.change30d || 0 },
  ], [tokenData.change1h, tokenData.change24h, tokenData.change7d, tokenData.change30d])

  const aiAnalysis = useMemo(() => {
    const details = tokenProfile?.token_details
    const support = details?.key_levels?.support ?? data.market?.support ?? data.market?.keyLevels?.support
    const resistance = details?.key_levels?.resistance ?? data.market?.resistance ?? data.market?.keyLevels?.resistance
    const trend = details?.ai_insight
    if (!support && !resistance && !trend) return null
    return {
      trend: trend || null,
      support: support != null ? fmtPrice(support) : null,
      resistance: resistance != null ? fmtPrice(resistance) : null,
    }
  }, [tokenProfile, data.market, fmtPrice])

  // === Mobile Mode (early return) ===
  if (isMobile) {
    return (
      <Suspense fallback={
        <div className="rz-mobile-skeleton" aria-busy="true" aria-label={t('researchZone.ariaLoadingRz', 'Loading research zone')}>
          <div className="rz-mobile-skeleton-hero animate-shimmer" />
          <ChartSkeleton height={320} label="Loading chart" />
          <div className="rz-mobile-skeleton-tabs">
            <div className="rz-mobile-skeleton-tab animate-shimmer" />
            <div className="rz-mobile-skeleton-tab animate-shimmer" />
            <div className="rz-mobile-skeleton-tab animate-shimmer" />
            <div className="rz-mobile-skeleton-tab animate-shimmer" />
          </div>
        </div>
      }>
      <ResearchZoneMobile
        activeTab={mobileTab}
        setActiveTab={selectMobile}
        symbol={symbol}
        setSymbol={setSymbol}
        tokenName={tokenName}
        tokenLogo={tokenLogo}
        tokenData={tokenData}
        isStock={isStock}
        data={data}
        chartToken={chartToken}
        chartHeight={chartHeight}
        dayMode={dayMode}
        chartLivePrice={chartLivePrice}
        onChartDragStart={onChartDragStart}
        spectreSentScore={spectreSentScore}
        spectreFearGreed={spectreFearGreed}
        spectreSocial={spectreSocial}
        officialTweets={officialTweets}
        officialTweetsLoading={officialTweetsLoading || spectreTweetsLoading || spectreTweets == null}
        marketsData={sortedMarketsData}
        marketsLoading={marketsLoading}
        newsItems={newsItems}
        newsSource={newsSource}
        fmtPrice={fmtPrice}
        fmtLarge={fmtLarge}
        performanceData={performanceData}
        isInWatchlist={isInWatchlist}
        addToWatchlist={addToWatchlist}
        removeFromWatchlist={removeFromWatchlist}
        marketMode={marketMode}
        onVoiceStateChange={handleVoiceStateChange}
        tradeMarkers={tradeMarkers}
        fetchNews={fetchNews}
        fundamentalsGrades={fundamentalsGrades}
        apiScenario={apiScenario}
        spectrePlotData={spectrePlotData}
        tokenProfile={tokenProfile}
        spectreTweets={spectreTweets}
        spectreMarketDetails={spectreMarketDetails}
        mindshareData={mindshareData}
        sectorData={sectorData}
        coinDetails={data.about}
        onChainData={data.onchain}
        activeTokenInfo={data.chartToken}
      />
      </Suspense>
    )
  }

  // === Cinema Mode ===
  if (cinemaMode) {
    const symbolOptions = isStock
      ? (['AAPL', 'MSFT', 'NVDA'].includes(symbol)
        ? ['AAPL', 'MSFT', 'NVDA']
        : [symbol, 'AAPL', 'MSFT', 'NVDA'])
      : (['BTC', 'ETH', 'SOL'].includes(symbol)
        ? ['BTC', 'ETH', 'SOL']
        : [symbol, 'BTC', 'ETH', 'SOL'])

    return (
      <Suspense fallback={null}>
      <CinemaResearchZone
        symbol={symbol}
        tokenName={tokenName}
        tokenData={tokenData}
        tokenLogos={{ [symbol]: tokenLogo }}
        chartToken={chartToken}
        liveTickerPrice={data.price.current}
        dayMode={dayMode}
        newsItems={newsItems}
        agentSignals={displayAgentSignals}
        tweets={blendedSearchTweets}
        rightFeedTab={rightFeedTab}
        setRightFeedTab={setRightFeedTab}
        fetchNews={fetchNews}
        newsSource={newsSource}
        lastNewsUpdate={lastNewsUpdate}
        formatNewsTime={formatNewsTime}
        markets={sortedMarketsData}
        marketFilter={marketFilter}
        setMarketFilter={setMarketFilter}
        marketFilters={MARKET_FILTERS}
        marketsSectionTab={marketsSectionTab}
        setMarketsSectionTab={setMarketsSectionTab}
        aboutDetails={data.about}
        categories={data.about?.categories || []}
        symbolOptions={symbolOptions}
        onSymbolChange={setSymbol}
        trendingTokens={data.trending}
      />
      </Suspense>
    )
  }

  // Audit 2026-07-04: previously a full-page SpectreLoader ("LOADING <SYM>
  // DOSSIER") blocked the ENTIRE page while resolveToken walked its 3-hop
  // fallback (Spectre resolve -> /api/token/resolve -> Codex, 200-900ms) — it
  // read as a slow, ugly gate and mislabelled identity-resolution as "dossier".
  // We now render the real 3-column shell immediately and let identity/data
  // fill in the background: the hero, token panel and chart all carry their own
  // `loading` skeletons (tokenName falls back to `symbol`, tokenData is never
  // null), so cold-mount behaves exactly like a token *switch* — which already
  // keeps the page mounted and resolves in place. Every hook/effect above runs
  // regardless of this branch, so dropping the gate changes only what paints,
  // not what fetches. No token identity yet == skeletons in the real layout.

  return (
    <div className={`research-zone-lite ${dayMode ? 'day-mode' : ''}`} style={{ ...tokenAmbientStyle, ...sentimentStyle.vars }} data-sentiment={sentimentStyle.mood}>
      {/* 3-column CMC-style layout: left info | center chart+tabs | right feeds */}
      <div
        ref={layoutRef}
        className={`research-zone-lite-layout ${!sidebarOpen ? 'research-zone-lite-sidebar-collapsed' : ''} ${!leftSidebarOpen ? 'research-zone-lite-left-collapsed' : ''} ${isNarrowLayout ? 'research-zone-lite-narrow' : ''}`}
      >
        {/* Left sidebar - token identity, mcap, exchange metrics */}
        <aside className="research-zone-lite-left">
          {leftAsideMounted && (
          <RzTokenPanel
            symbol={symbol}
            onSymbolChange={setSymbol}
            isStock={isStock}
            tokenData={tokenData}
            livePrice={chartLivePrice}
            stockData={data.stockData}
            icons={icons}
            fmtPrice={fmtPrice}
            fmtLarge={fmtLarge}
            formatChange={formatChange}
            currencySymbol={currencySymbol}
            displayColors={displayColors}
            onOpenPopup={openTokenCardPopup}
            performanceData={performanceData}
            aiAnalysis={aiAnalysis}
            tokenLogo={tokenLogo}
            categories={data.about?.categories}
            coinMarketData={data.market}
            onChainData={data.onchain}
            loading={tokenLoading}
            tokenName={tokenName}
            aboutDetails={data.about}
            isInWatchlist={isInWatchlist}
            addToWatchlist={addToWatchlist}
            removeFromWatchlist={removeFromWatchlist}
          />
          )}
        </aside>

        {/* Left sidebar toggle */}
        <button
          type="button"
          className="research-zone-lite-panel-toggle research-zone-lite-panel-toggle-left"
          onClick={() => setLeftSidebarOpen((o) => !o)}
          title={leftSidebarOpen ? 'Close token panel' : 'Open token panel'}
          aria-label={leftSidebarOpen ? 'Close token panel' : 'Open token panel'}
        >
          {leftSidebarOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
        </button>

        {/* Center content - chart + all sections (scroll-to-section anchors) */}
        <main className="research-zone-lite-center" ref={centerRef}>
          <RzHeroBanner
            reportedEarnings={reportedEarnings}
            symbol={symbol}
            tokenName={tokenName}
            tokenData={tokenData}
            isStock={isStock}
            aboutDetails={data.about}
            icons={icons}
            fmtPrice={fmtPrice}
            formatChange={formatChange}
            displayColors={displayColors}
            tokenLogo={tokenLogo}
            loading={tokenLoading}
            isInWatchlist={isInWatchlist}
            addToWatchlist={addToWatchlist}
            removeFromWatchlist={removeFromWatchlist}
            onOpenHistory={rzHistory.openSwitcher}
            cgId={data.token?.cgId || null}
            livePrice={chartLivePrice}
          />
          <RzQuickSwitcher
            open={rzHistory.switcherOpen}
            onClose={rzHistory.closeSwitcher}
            history={rzHistory.history}
            currentSymbol={symbol}
            onSelect={handleQuickSwitchSelect}
            onClear={rzHistory.clear}
          />
          {/* Next Earnings lives INSIDE the hero now (RzHeroEarnings, rendered in
              the hero's middle slot) — a stock hero had an empty middle and the
              band cost a whole row above the chart for four numbers. The band
              component is still the mobile face (research-zone-mobile.jsx). */}
          <div id="rz-section-chart">
          <ChartErrorBoundary resetKey={symbol} t={t}>
            <RzChartSection
              ref={chartRef}
              onSymbolChange={setSymbol}
              chartToken={chartToken}
              // While the resolve chain is still finding this token's address,
              // the chart holds its shimmer instead of charting a bare ticker
              // and painting a false "Chart unavailable" (USYC, 2026-08-26).
              // Reads the real in-flight flag, NOT `loading.token` — the
              // latter is already false whenever any cached identity exists,
              // chartless ones included, which is exactly this case.
              identityPending={!!data.identityResolving}
              chartHeight={chartHeight}
              dayMode={dayMode}
              livePrice={chartLivePrice}
              tokenData={tokenData}
              onChartDragStart={onChartDragStart}
              tradeMarkers={tradeMarkers}
              onVoiceStateChange={handleVoiceStateChange}
              extraToolButtons={chartExtraToolButtons}
              annotations={rzAnnotations.annotations}
              noteModeActive={noteMode}
              onCanvasAnnotateClick={handleCanvasAnnotateClick}
              onAnnotationClick={handleAnnotationPinClick}
              compareViewActive={compareModeActive && !!rzCompare.compareSym}
              compareViewProps={compareViewProps}
              taMode={chartTa.taMode}
              taSelection={chartTa.selection}
              onTaSelectionChange={chartTa.onTaSelectionChange}
              taDrawings={chartTa.drawings}
              onTaDrawingAdd={chartTa.onTaDrawingAdd}
              taRevealKey={chartTa.revealKey}
              onFullscreenChange={setChartFullscreen}
            />
          </ChartErrorBoundary>

          {/* The chart goes position:fixed z-index 2000 in fullscreen and fills
              the viewport, so this strip's in-flow slot is painted BEHIND it —
              the read was invisible in fullscreen for the whole life of the
              layer. Portalled out when fullscreen, same trick the agent panel
              below already uses. */}
          {(() => {
            const strip = (
              <RzTaStrip
                analysis={chartTa.analysis}
                error={chartTa.analysisError}
                hasDrawings={chartTa.hasDrawings}
                onClearLines={() => chartTa.clearDrawings('all')}
                onDismiss={() => chartTa.clearDrawings('all')}
                play={chartTa.play}
                onPlay={chartTa.canPlay ? chartTa.startPlay : null}
                onStopPlay={chartTa.stopPlay}
                onNextBeat={chartTa.nextBeat}
                onPrevBeat={chartTa.prevBeat}
              />
            )
            if (!chartFullscreen) return strip
            return createPortal(
              <div className={`rzfs-ta-strip${dayMode ? ' is-day' : ''}`}>{strip}</div>,
              document.body,
            )
          })()}

          {chartFullscreen && createPortal(
            <div className={`rzfs-agent${fsAgentOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="rzfs-agent-tab"
                onClick={() => setFsAgentOpen(v => !v)}
                title={fsAgentOpen ? 'Hide the agent' : 'Show the agent'}
              >
                <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 2.5l1.6 3.6 3.9.4-2.9 2.6.8 3.8L10 11l-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z" />
                </svg>
              </button>
              <div className="rzfs-agent-body">
                <RzAgentChat
                  sym={symbol.toUpperCase()}
                  tokenName={tokenName}
                  tokenLogo={tokenLogo}
                  tokenData={tokenData}
                  catalysts={catalystNews}
                  social={brainSocial}
                  dayMode={dayMode}
                  taRequest={chartFullscreen ? taRequest : null}
                  onAgentDrawings={chartTa.setAgentDrawings}
                />
              </div>
            </div>,
            document.body,
          )}

          <RzTaToolMenu
            open={!!drawMenuAnchor}
            anchorRect={drawMenuAnchor}
            taMode={chartTa.taMode}
            canUndo={chartTa.userDrawings.length > 0}
            hasDrawings={chartTa.hasDrawings}
            onPick={(mode) => { chartTa.setTool(mode); setDrawMenuAnchor(null) }}
            onUndo={() => chartTa.undoDrawing()}
            onClear={() => { chartTa.clearDrawings('all'); setDrawMenuAnchor(null) }}
            onClose={() => setDrawMenuAnchor(null)}
          />
          </div>

          <RzComparePicker
            open={!!comparePickerAnchor}
            anchorRect={comparePickerAnchor}
            baseSymbol={symbol}
            onPick={(sym) => { rzCompare.setCompare(sym); setComparePickerAnchor(null); setCompareModeActive(true) }}
            onClose={() => setComparePickerAnchor(null)}
          />

          <RzNotePopover
            open={!!notePopover}
            mode={notePopover?.mode || 'create'}
            anchor={notePopover?.anchor}
            symbol={symbol}
            draftPrice={notePopover?.draftPrice}
            draftTs={notePopover?.draftTs}
            note={notePopover?.note}
            fmtPrice={fmtPrice}
            onSubmit={(payload) => { rzAnnotations.add(payload.text, { ts: payload.ts, price: payload.price, color: payload.color, icon: payload.icon }) }}
            onUpdate={rzAnnotations.update}
            onDelete={(id) => { rzAnnotations.remove(id); setNotePopover(null) }}
            onStartEdit={(n) => setNotePopover(p => p ? { ...p, mode: 'edit' } : null)}
            onClose={() => setNotePopover(null)}
          />

          {/* Section tabs below chart */}
          <nav className="rz-anchor-nav" aria-label={t('researchZone.ariaPageSections', 'Page sections')}>
            {[
              { id: 'markets', label: t('researchZone.tabMarkets', 'Markets'), icon: spectreIcons.grid },
              ...(!isStock ? [
                { id: 'project', label: t('researchZone.tabProject', 'Project'), icon: spectreIcons.portfolio },

              ] : []),
              // Sentiment is live for BOTH classes — stocks get the equity desk read
              { id: 'sentiment', label: t('researchZone.tabSentiment', 'Sentiment'), icon: spectreIcons.sentiment },
              // Technicals is live for BOTH asset classes — stocks run the same
              // indicator engine on Yahoo bars (assetClass='stock').
              { id: 'technicals', label: t('researchZone.tabTechnicals', 'Technicals'), icon: spectreIcons.technical },
            ].map(s => (
              <button
                key={s.id}
                type="button"
                aria-pressed={activeSection === s.id}
                className={`rz-anchor-nav-item${activeSection === s.id ? ' rz-anchor-nav-item--active' : ''}`}
                onClick={() => { trackUi('rz_tab', s.id); setActiveSection(s.id) }}
              >
                <span className="rz-anchor-nav-icon" aria-hidden="true">{s.icon}</span>
                {s.label}
                <RzInfoIcon tip={SECTION_TIPS[s.id]} pos="bottom" />
              </button>
            ))}
          </nav>

          <Suspense fallback={<div className="rz-pro-center" aria-busy="true" aria-label={t('researchZone.ariaLoadingRzTabs', 'Loading research zone tabs')}><div className="rz-pro-section" /></div>}>
          <RzProCenter
            activeTab={activeSection}
            symbol={symbol}
            tokenData={tokenData}
            tokenLogo={tokenLogo}
            tokenAddress={data.token?.address}
            dayMode={dayMode}
            activeTokenInfo={data.chartToken}
            coinDetails={data.about}
            isStock={isStock}
            spectreSentScore={spectreSentScore}
            spectreFearGreed={spectreFearGreed}
            spectreSocial={spectreSocial}
            spectrePlotData={spectrePlotData}
            spectreTweets={spectreTweets}
            influencerTweets={influencerTweets}
            socialFeedTweets={socialFeedTweets}
            spectreMarketDetails={spectreMarketDetails}
            onChainData={data.onchain}
            tokenProfile={tokenProfile}
            apiScenario={apiScenario}
            fundamentalsGrades={fundamentalsGrades}
            sectorData={sectorData}
            sectorAiAnalysis={sectorAiAnalysis}
            mindshareData={mindshareData}
            marketsProps={marketsProps}
          />
          </Suspense>
        </main>

        {/* Sidebar toggle */}
        <button
          type="button"
          className="research-zone-lite-panel-toggle research-zone-lite-panel-toggle-right"
          onClick={() => setSidebarOpen((o) => !o)}
          title={sidebarOpen ? 'Close feeds panel' : 'Open feeds panel'}
          aria-label={sidebarOpen ? 'Close feeds panel' : 'Open feeds panel'}
        >
          {sidebarOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
        </button>

        {/* Right sidebar - feeds: tweets, news, agent RSS, agent. At narrow
            widths it wraps to a full-width row below the chart (CSS) instead of
            disappearing - the old "fold into a Stats tab" path was half-removed
            and left the whole feed column unreachable between ~769-1080px. */}
        <aside className="research-zone-lite-right">
          <div className="research-zone-lite-feed-header">
            <div className="research-zone-lite-feed-toggle" role="tablist" aria-label={t('researchZone.ariaSidebarTabs', 'Sidebar tabs')}>
              <button type="button" role="tab" aria-selected={rightFeedTab === 'tweets'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'tweets' ? 'active' : ''}`} onClick={() => setRightFeedTab('tweets')}>
                <span className="research-zone-lite-feed-tab-icon" aria-hidden>{icons.twitter}</span>
                {t('researchLite.posts', 'Posts')}
              </button>
              <button type="button" role="tab" aria-selected={rightFeedTab === 'news'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'news' ? 'active' : ''}`} onClick={() => setRightFeedTab('news')}>
                <span className="research-zone-lite-feed-tab-icon" aria-hidden>{icons.news}</span>
                {t('researchLite.news')}
              </button>
              <button type="button" role="tab" aria-selected={rightFeedTab === 'agent-rss'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'agent-rss' ? 'active' : ''}`} onClick={() => setRightFeedTab('agent-rss')}>
                <span className="research-zone-lite-feed-tab-icon" aria-hidden>{icons.rss}</span>
                {t('researchLite.signals', 'Signals')}
              </button>
              <button type="button" role="tab" aria-selected={rightFeedTab === 'agent'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'agent' ? 'active' : ''}`} onClick={() => setRightFeedTab('agent')}>
                <span className="research-zone-lite-feed-tab-icon" aria-hidden>{icons.agent}</span>
                {t('researchLite.agent', 'Agent')}
              </button>
              {!isStock && (
                <button type="button" role="tab" aria-selected={rightFeedTab === 'dossier'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'dossier' ? 'active' : ''}`} onClick={() => setRightFeedTab('dossier')}>
                  <span className="research-zone-lite-feed-tab-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2v6h6M16 13H8M16 17H8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                  {t('researchLite.dossier', 'Dossier')}
                </button>
              )}
            </div>
          </div>
          {rightAsideMounted && (
          <div className="rz-lite-sidebar-content">
            {/* Agent tab - keep mounted via display to preserve chat state */}
            <div className="rz-lite-agent-wrap" style={{ display: rightFeedTab === 'agent' ? 'flex' : 'none' }}>
              <RzAgentChat
                sym={symbol.toUpperCase()}
                tokenName={tokenName}
                tokenLogo={tokenLogo}
                tokenData={tokenData}
                catalysts={catalystNews}
                social={brainSocial}
                dayMode={dayMode}
                taRequest={chartFullscreen ? null : taRequest}
                onAgentDrawings={chartTa.setAgentDrawings}
              />
            </div>
            {rightFeedTab === 'dossier' && !isStock && (
              <div className="rz-lite-dossier-wrap">
                <Suspense fallback={null}>
                  <DossierPanel chain="asset" ca={symbol.toUpperCase()} pollMs={0} />
                </Suspense>
              </div>
            )}
            {viewedFeedTabs.has('agent-rss') && (
              <div style={{ display: rightFeedTab === 'agent-rss' ? 'block' : 'none' }}>
                <RzFeedPanel
                  rightFeedTab="agent"
                  setRightFeedTab={setRightFeedTab}
                  symbol={symbol}
                  tokenName={tokenName}
                  isStock={isStock}
                  newsItems={newsItems}
                  newsSource={newsSource}
                  lastNewsUpdate={lastNewsUpdate}
                  fetchNews={fetchNews}
                  aboutDetails={data.about}
                  stockData={data.stockData}
                  icons={icons}
                  fmtLarge={fmtLarge}
                  hideHeader
                  agentSignals={displayAgentSignals}
                />
              </div>
            )}
            {viewedFeedTabs.has('news') && (
              <div style={{ display: rightFeedTab === 'news' ? 'block' : 'none' }}>
                <RzFeedPanel
                  rightFeedTab="news"
                  setRightFeedTab={setRightFeedTab}
                  symbol={symbol}
                  tokenName={tokenName}
                  isStock={isStock}
                  newsItems={newsItems}
                  newsLoading={newsLoading}
                  newsSource={newsSource}
                  lastNewsUpdate={lastNewsUpdate}
                  fetchNews={fetchNews}
                  aboutDetails={data.about}
                  stockData={data.stockData}
                  icons={icons}
                  fmtLarge={fmtLarge}
                  hideHeader
                />
              </div>
            )}
            {viewedFeedTabs.has('tweets') && (
              <div style={{ display: rightFeedTab === 'tweets' ? 'block' : 'none' }}>
                <RzFeedPanel
                  rightFeedTab="tweets"
                  setRightFeedTab={setRightFeedTab}
                  symbol={symbol}
                  tokenName={tokenName}
                  isStock={isStock}
                  newsItems={newsItems}
                  newsSource={newsSource}
                  lastNewsUpdate={lastNewsUpdate}
                  fetchNews={fetchNews}
                  aboutDetails={data.about}
                  stockData={data.stockData}
                  icons={icons}
                  fmtLarge={fmtLarge}
                  hideHeader
                  spectreTweets={officialTweets}
                  searchTweets={blendedSearchTweets}
                  tweetsLoading={
                    // officialTweetsLoading deliberately NOT in the gate: the
                    // official-posts leg chains behind the CG-details lane and
                    // flips back to loading when about-data arrives late — it
                    // was re-blanking an already-painted rail. Official posts
                    // merge in when they land.
                    spectreTweetsLoading || spectreTweets == null
                  }
                />
              </div>
            )}
          </div>
          )}
        </aside>
      </div>

      {/* 3-card token popup: Past, Present, Future */}
      <RzTokenPopup
        tokenCardPopup={tokenCardPopup}
        expandedCard={tokenCardExpandedCard}
        setExpandedCard={setTokenCardExpandedCard}
        onClose={closeTokenCardPopup}
        onTokenSelect={onTokenSelect}
        dayMode={dayMode}
        fmtPrice={fmtPrice}
        formatChange={formatChange}
      />

      {/* Share-to-X modal for the token chart */}
      {shareModalOpen && (
        <Suspense fallback={null}>
          <ShareXModal
            open={shareModalOpen}
            onClose={() => { setShareModalOpen(false); setShareImageUrl(null) }}
            imageUrl={shareImageUrl}
            defaultDescription={shareDescription}
            filename={`spectre_${(symbol || 'token').toLowerCase()}_snapshot.png`}
            contentType="research_zone_token"
          />
        </Suspense>
      )}

      {/* Voice control FAB + toast - portaled to document.body to escape
           .page-layout transform: translateZ(0) which breaks position: fixed */}
      {createPortal(
        <>
          {voiceState.isSupported && !isMobile && (
            <button
              className={`rz-voice-fab ${voiceState.isListening ? 'listening' : ''}`}
              onClick={() => voiceToggleRef.current?.()}
              aria-label={voiceState.isListening ? 'Stop voice control' : 'Voice control'}
              data-tooltip={voiceState.isListening ? 'Listening for commands...' : 'Chart voice control'}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                <path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H7a1 1 0 100 2h6a1 1 0 100-2h-2v-2.07z" />
              </svg>
              {voiceState.isListening && <span className="rz-voice-fab-ring" />}
              {voiceState.isListening && <span className="rz-voice-fab-dot" />}
            </button>
          )}
          {voiceState.lastCommand && (
            <div className="rz-voice-cmd-toast" key={voiceState.lastCommand.timestamp}>
              <svg className="rz-voice-cmd-toast-icon" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="rz-voice-cmd-toast-action">{voiceState.lastCommand.action}</span>
              <span className="rz-voice-cmd-toast-raw">&ldquo;{voiceState.lastCommand.text}&rdquo;</span>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  )
}

export default ResearchZoneLite
