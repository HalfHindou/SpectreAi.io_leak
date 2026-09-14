/**
 * TokenTicker Component
 * Dynamic scrolling bar of top trading tokens
 * Apple-style premium design with unique wow effects
 *
 * NOW WITH REAL-TIME DATA FROM CODEX API
 * SUPPORTS BOTH CRYPTO AND STOCK MODES
 *
 * UNIQUE FEATURES:
 * - Mini sparkline charts for each token
 * - Glowing pulse effect for top gainers
 * - Holographic shimmer on hover
 * - Live market pulse indicator
 * - Sentiment-based background gradient
 * - Floating animation for gainers
 */
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCuratedTokenPrices, useBinanceTopCoinPrices } from '@/hooks/useCodexData'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'
import { useStockPrices } from '@/hooks/useStockData'
import { TOP_STOCKS, getStockLogo } from '@/constants/stockData'
import { useCurrency } from '@/hooks/useCurrency'
import './token-ticker.css'

// Showcase-embed lock - gates the scrolling token ticker clicks so the
// iframe preview can't navigate users to the token screener.
const isShowcaseEmbed = (() => {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (params.get('demo') === 'true') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
})()

// Stock symbols for ticker display - use top 15 from centralized data
const TICKER_STOCKS = TOP_STOCKS.slice(0, 15).map(s => s.symbol)

// Build stock info from centralized data
const STOCK_INFO = TOP_STOCKS.reduce((acc, stock) => {
  acc[stock.symbol] = { name: stock.name, sector: stock.sector }
  return acc
}, {})

// News source → domain for favicon lookup
const NEWS_SOURCE_DOMAINS = {
  coindesk: 'coindesk.com',
  'the block': 'theblock.co',
  theblock: 'theblock.co',
  bloomberg: 'bloomberg.com',
  reuters: 'reuters.com',
  decrypt: 'decrypt.co',
  cointelegraph: 'cointelegraph.com',
  cointelgraph: 'cointelegraph.com',
  'crypto briefing': 'cryptobriefing.com',
  'bitcoin magazine': 'bitcoinmagazine.com',
  blockworks: 'blockworks.co',
  defiant: 'thedefiant.io',
  'the defiant': 'thedefiant.io',
  dlnews: 'dlnews.com',
  unchained: 'unchainedcrypto.com',
  benzinga: 'benzinga.com',
  cnbc: 'cnbc.com',
  'wall street journal': 'wsj.com',
  wsj: 'wsj.com',
  'financial times': 'ft.com',
  ft: 'ft.com',
  'yahoo finance': 'finance.yahoo.com',
  yahoo: 'finance.yahoo.com',
  'market watch': 'marketwatch.com',
  marketwatch: 'marketwatch.com',
  'seeking alpha': 'seekingalpha.com',
  barrons: 'barrons.com',
  "barron's": 'barrons.com',
  investopedia: 'investopedia.com',
  fortune: 'fortune.com',
  Forbes: 'forbes.com',
  forbes: 'forbes.com',
}

const getNewsSourceIcon = (source) => {
  if (!source) return null
  const key = source.toLowerCase().trim()
  const domain = NEWS_SOURCE_DOMAINS[key]
  if (domain) return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  // Fallback: try the source name as a domain
  const guessed = key.replace(/\s+/g, '') + '.com'
  return `https://www.google.com/s2/favicons?domain=${guessed}&sz=32`
}

const TokenTicker = ({ selectToken, selectedToken, onTokenClickOpenOverlay, embedded = false, tokens: tokensProp, marketMode = 'crypto', tickerMode = 'trending', onToggleMode, newsItems, leftSlot = null }) => {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  const [isPaused, setIsPaused] = useState(false)
  // Removed pulseIntensity state - now handled by CSS
  const trackRef = useRef(null)
  const contentRef = useRef(null) // Ref to measure single set of tokens

  const isStocks = marketMode === 'stocks'

  // List of symbols to fetch prices for (including SPECTRE)
  const symbolsToFetch = useMemo(() => ['SPECTRE', 'DOGE', 'SHIB', 'PEPE', 'FLOKI', 'UNI', 'AAVE', 'LINK', 'GRT', 'MKR', 'CRV', 'SUSHI'], [])

  // Fetch crypto prices from CoinGecko (full data, 60s refresh) - skip when using external tokens or in stock mode
  const { prices: coinGeckoPrices, loading, error } = useCuratedTokenPrices((tokensProp || isStocks) ? [] : symbolsToFetch, 60 * 1000)
  // Fetch real-time crypto prices from Binance (price + change only, 5s refresh) - skip when using external tokens or in stock mode
  const { prices: binancePrices } = useBinanceTopCoinPrices((tokensProp || isStocks) ? [] : symbolsToFetch, 5000)

  // Fetch stock prices when in stock mode
  const { prices: stockPrices, loading: stockLoading } = useStockPrices(isStocks && !tokensProp ? TICKER_STOCKS : [], 10000)

  // Merge: Binance real-time prices take priority, CoinGecko provides additional data
  const livePrices = useMemo(() => {
    const merged = { ...coinGeckoPrices }
    Object.keys(binancePrices || {}).forEach(symbol => {
      const binanceData = binancePrices[symbol]
      if (binanceData?.price > 0) {
        merged[symbol] = {
          ...merged[symbol],
          price: binanceData.price,
          change: binanceData.change ?? merged[symbol]?.change,
        }
      }
    })
    return merged
  }, [coinGeckoPrices, binancePrices])

  // Helper to generate Codex/Defined.fi logo URL
  const getCodexLogo = (address, networkId = 1) => 
    `https://token-media.defined.fi/${networkId}_${address.toLowerCase()}_large.png`

  // Curated tokens list - using Codex for most, cryptologos.cc for tokens where Codex has bad/missing logos
  const curatedTokens = [
    // SPECTRE - our own logo
    { symbol: 'SPECTRE', name: 'Spectre AI', price: 0, change: 0, logo: '/round-logo.png', sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], featured: true, address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', networkId: 1 },
    // cryptologos.cc - Codex has bad/missing logos for these
    { symbol: 'DOGE', name: 'Dogecoin', price: 0, change: 0, logo: 'https://cryptologos.cc/logos/dogecoin-doge-logo.png', sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x4206931337dc273a630d328dA6441786BfaD668f', networkId: 1 },
    { symbol: 'SHIB', name: 'Shiba Inu', price: 0, change: 0, logo: 'https://cryptologos.cc/logos/shiba-inu-shib-logo.png', sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1 },
    { symbol: 'AAVE', name: 'Aave', price: 0, change: 0, logo: 'https://cryptologos.cc/logos/aave-aave-logo.png', sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1 },
    { symbol: 'CRV', name: 'Curve', price: 0, change: 0, logo: 'https://cryptologos.cc/logos/curve-dao-token-crv-logo.png', sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0xD533a949740bb3306d119CC777fa900bA034cd52', networkId: 1 },
    { symbol: 'SUSHI', name: 'SushiSwap', price: 0, change: 0, logo: 'https://cryptologos.cc/logos/sushiswap-sushi-logo.png', sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', networkId: 1 },
    // Codex logos - these have good quality logos on Codex
    { symbol: 'PEPE', name: 'Pepe', price: 0, change: 0, logo: getCodexLogo('0x6982508145454Ce325dDbE47a25d4ec3d2311933', 1), sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1 },
    { symbol: 'FLOKI', name: 'Floki', price: 0, change: 0, logo: getCodexLogo('0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E', 1), sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E', networkId: 1 },
    { symbol: 'UNI', name: 'Uniswap', price: 0, change: 0, logo: getCodexLogo('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 1), sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1 },
    { symbol: 'LINK', name: 'Chainlink', price: 0, change: 0, logo: getCodexLogo('0x514910771AF9Ca656af840dff83E8264EcF986CA', 1), sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1 },
    { symbol: 'GRT', name: 'The Graph', price: 0, change: 0, logo: getCodexLogo('0xc944E90C64B2c07662A292be6244BDf05Cda44a7', 1), sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', networkId: 1 },
    { symbol: 'MKR', name: 'Maker', price: 0, change: 0, logo: getCodexLogo('0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', 1), sparkline: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', networkId: 1 },
  ]

  // Deterministic seeded noise so the sparkline doesn't reshuffle every render
  const hashString = (str) => {
    let h = 0
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i)
      h |= 0
    }
    return Math.abs(h) || 1
  }
  const seededRand = (seed) => {
    let s = seed
    return () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
  }

  // Build a 60-point sparkline. When multi-timeframe change data is available
  // (5m, 1h, 4h, 12h, 24h) use those as anchors interpolated with deterministic
  // noise. Otherwise fall back to a single-anchor curve from the 24h change.
  const generateSparklineFromToken = (token) => {
    const POINTS = 24
    const toFrac = (c) => {
      const n = parseFloat(c)
      if (!isFinite(n) || n === 0) return 0
      // Explicit unit wins (welcome feeds mark percent-form values); the
      // magnitude heuristic stays for legacy callers (curated/binance path).
      if (token.changeUnit === 'percent') return n / 100
      return Math.abs(n) > 1 ? n / 100 : n
    }
    const c24 = toFrac(token.change ?? token.change24h ?? token.change24)
    const c12 = toFrac(token.change12h ?? token.change12)
    const c4  = toFrac(token.change4h ?? token.change4)
    const c1  = toFrac(token.change1h ?? token.change1)
    const c5m = toFrac(token.change5m)

    // Past relative price = 1 / (1 + change). Current = 1.0.
    const safeAnchor = (t, change) => ({ t, v: change ? 1 / (1 + change) : 1 })
    const anchors = [
      safeAnchor(0,    c24),
      safeAnchor(0.5,  c12 || c24 * 0.5),
      safeAnchor(0.83, c4  || c24 * 0.16),
      safeAnchor(0.96, c1  || c24 * 0.04),
      safeAnchor(0.997, c5m || c1 * 0.08 || 0),
      { t: 1, v: 1 },
    ].filter(a => isFinite(a.v) && a.v > 0)

    const seed = hashString((token.symbol || '') + (token.address || ''))
    const rand = seededRand(seed)
    const vol = Math.min(Math.abs(c24) * 0.12 + 0.002, 0.012)

    const values = []
    for (let i = 0; i < POINTS; i++) {
      const t = i / (POINTS - 1)
      let a = anchors[0]
      let b = anchors[anchors.length - 1]
      for (let j = 0; j < anchors.length - 1; j++) {
        if (t >= anchors[j].t && t <= anchors[j + 1].t) {
          a = anchors[j]; b = anchors[j + 1]
          break
        }
      }
      const tt = (t - a.t) / Math.max(b.t - a.t, 0.0001)
      // Smoothstep between anchors so transitions don't kink
      const eased = tt * tt * (3 - 2 * tt)
      const interp = a.v + (b.v - a.v) * eased
      const noise = (rand() - 0.5) * 2 * vol
      values.push(interp + noise)
    }
    values[values.length - 1] = 1

    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1e-6
    return values.map(v => 10 + ((v - min) / range) * 80)
  }

  // Backwards-compat shim used by the curated-mock fallback path below
  const generateSparklineFromChange = (change) =>
    generateSparklineFromToken({ symbol: 'CURATED', change })

  // When external tokens prop is provided (e.g. from WelcomePage), normalize and use those.
  // Do NOT drop logo-less rows: the prod bridge relay ships rows without logo
  // (2026-07-08 this blanked the whole On-chain ticker to "Top 0"). Derive the
  // Codex CDN logo from the contract when possible; renderToken + img onError
  // already fall back to an initial avatar.
  const tokensFromProp = useMemo(() => {
    if (!tokensProp || !Array.isArray(tokensProp) || tokensProp.length === 0) return null
    return tokensProp.map((t, i) => {
      const change = typeof t.change === 'number' ? t.change : parseFloat(t.change) || 0
      const enriched = {
        symbol: t.symbol,
        name: t.name || t.symbol,
        address: t.address,
        networkId: t.networkId ?? 1,
        logo: t.logo || (t.address ? getCodexLogo(t.address, t.networkId ?? 1) : null),
        price: typeof t.price === 'number' ? t.price : parseFloat(t.price) || 0,
        change,
        change5m: t.change5m,
        change1h: t.change1h ?? t.change1,
        change4h: t.change4h ?? t.change4,
        change12h: t.change12h ?? t.change12,
        change24h: t.change24h ?? change,
        changeUnit: t.changeUnit,
        // Routing metadata for the click handler: top-coin rows open Research
        // Zone (cgId beats same-ticker collisions), on-chain rows the screener.
        cgId: t.cgId ?? null,
        isTopCoin: !!t.isTopCoin,
        hasLiveData: true,
        featured: (t.symbol || '').toUpperCase() === 'SPECTRE',
        // `rank` is the row's SLOT in this strip, which drives the top-three
        // gainer glow. It is NOT where the token ranks: the strip is a 20-row
        // slice of whichever tier is selected, so on Sub-500M / Sub-50M /
        // trending a slot of 4 could be the 1,842nd coin by market cap.
        // `marketRank` is the real thing, carried through so the label can
        // show it. Only the explicit market-cap fields are trusted — a bare
        // `rank` on a trending row is a trending position, not a cap rank.
        marketRank: Number(t.globalRank ?? t.market_cap_rank ?? t.marketCapRank) || null,
        rank: i + 1,
      }
      enriched.sparkline = generateSparklineFromToken(enriched)
      return enriched
    })
  }, [tokensProp])

  // Merge curated tokens with live market data (when not using external tokens)
  const tokensCurated = useMemo(() => {
    // Map curated tokens with live price data when available
    const result = curatedTokens.map(token => {
      const liveData = livePrices[token.symbol.toUpperCase()]

      if (liveData) {
        const price = parseFloat(liveData.price) || 0
        const change = parseFloat(liveData.change) || 0

        if (price > 0) {
          return {
            ...token,
            price: price,
            change: change,
            sparkline: generateSparklineFromChange(change),
            hasLiveData: true
          }
        }
      }

      // No live data found - use curated/fallback data
      return {
        ...token,
        hasLiveData: false
      }
    })

    return result
  }, [livePrices])

  // Stock tokens with live price data
  const tokensStock = useMemo(() => {
    if (!isStocks) return []

    return TICKER_STOCKS.map((symbol, index) => {
      const priceData = stockPrices?.[symbol]
      const info = STOCK_INFO[symbol] || { name: symbol, sector: 'Unknown' }
      const price = priceData?.price || 0
      const change = priceData?.change || 0

      return {
        symbol,
        name: info.name,
        logo: getStockLogo(symbol, info.sector),
        price,
        change,
        sparkline: generateSparklineFromChange(change),
        hasLiveData: price > 0,
        featured: symbol === 'SPY', // Feature the S&P 500 ETF
        rank: index + 1,
        isStock: true,
        sector: info.sector,
      }
    })
  }, [isStocks, stockPrices])

  // Final tokens: external prop > stock mode > crypto mode
  // When tokensProp is provided (even if empty/loading), never fall back to curated mocks
  const tokens = tokensProp ? (tokensFromProp || []) : (isStocks ? tokensStock : tokensCurated)

  // Calculate overall market sentiment
  const marketSentiment = useMemo(() => {
    if (!tokens || tokens.length === 0) return 'neutral'
    const avgChange = tokens.reduce((sum, t) => sum + (t.change || 0), 0) / tokens.length
    return avgChange > 2 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral'
  }, [tokens])

  // Pulse intensity now handled by CSS animation - no JS interval needed

  // ── Compositor-driven marquee (Web Animations API) ──────────────────────
  // The previous rAF loop wrote style.transform on the track every frame -
  // each inline-style write forced a ~2ms style recalc over the ~800-node
  // track subtree (~230ms/s of main thread + ~117 style mutations/sec,
  // measured via CDP 2026-07-08). element.animate() runs the transform on
  // the compositor thread: zero main-thread work per frame. Position lives
  // in the animation's currentTime; width changes rebuild it preserving the
  // loop progress. Pauses on hover, offscreen, hidden tab and 5-min idle.
  const marqueeAnimRef = useRef(null)
  const marqueeStateRef = useRef({ hover: false, inView: true, active: isAppActive() })

  const syncMarqueePlayState = () => {
    const anim = marqueeAnimRef.current
    if (!anim) return
    const s = marqueeStateRef.current
    const shouldRun = !s.hover && s.inView && s.active && !document.hidden
    if (shouldRun && anim.playState === 'paused') anim.play()
    else if (!shouldRun && anim.playState === 'running') anim.pause()
  }

  useEffect(() => {
    marqueeStateRef.current.hover = isPaused
    syncMarqueePlayState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused])

  useEffect(() => {
    const PIXELS_PER_SECOND = 50 // Speed: 50 pixels per second
    const track = trackRef.current
    if (!track || typeof track.animate !== 'function') return undefined

    let width = 0
    const rebuild = () => {
      const nextWidth = contentRef.current?.scrollWidth || contentRef.current?.offsetWidth || 0
      if (nextWidth <= 0 || nextWidth === width) return
      const prev = marqueeAnimRef.current
      const prevDuration = width > 0 ? (width / PIXELS_PER_SECOND) * 1000 : 0
      const progress = prev && prevDuration > 0
        ? ((Number(prev.currentTime) || 0) % prevDuration) / prevDuration
        : 0
      if (prev) prev.cancel()
      width = nextWidth
      const duration = (width / PIXELS_PER_SECOND) * 1000
      const anim = track.animate(
        [{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(-${width}px, 0, 0)` }],
        { duration, iterations: Infinity },
      )
      anim.currentTime = progress * duration
      marqueeAnimRef.current = anim
      syncMarqueePlayState()
    }

    rebuild()
    const resizeObserver = typeof ResizeObserver !== 'undefined' && contentRef.current
      ? new ResizeObserver(rebuild)
      : null
    if (resizeObserver && contentRef.current) resizeObserver.observe(contentRef.current)
    window.addEventListener('resize', rebuild)

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          marqueeStateRef.current.inView = entries[0]?.isIntersecting !== false
          syncMarqueePlayState()
        })
      : null
    if (io) io.observe(track)

    const onVisibility = () => syncMarqueePlayState()
    document.addEventListener('visibilitychange', onVisibility)
    const unsubIdle = subscribeActivity((active) => {
      marqueeStateRef.current.active = active
      syncMarqueePlayState()
    })

    return () => {
      marqueeAnimRef.current?.cancel()
      marqueeAnimRef.current = null
      window.removeEventListener('resize', rebuild)
      document.removeEventListener('visibilitychange', onVisibility)
      if (resizeObserver) resizeObserver.disconnect()
      if (io) io.disconnect()
      unsubIdle()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Runs once — position persists in the animation's currentTime

  // Generate sparkline SVG path with monotone cubic bezier smoothing for a
  // sharp, continuous curve (no kinks between data points).
  const generateSparklinePath = (data, width = 96, height = 28) => {
    if (!data || data.length === 0) return `M0,${height / 2} L${width},${height / 2}`
    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min || 1
    const padY = 2
    const usableH = height - padY * 2
    const stepX = width / (data.length - 1)

    const pts = data.map((val, i) => [
      i * stepX,
      height - padY - ((val - min) / range) * usableH,
    ])

    let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2] || p2
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6
      d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`
    }
    return d
  }

  // Track last click to prevent rapid re-clicks
  const lastClickRef = useRef({ symbol: null, time: 0 })
  
  // Handle token click - open overlay when onTokenClickOpenOverlay provided, else select token (navigate to screener)
  const handleTokenClick = (e, token) => {
    e.stopPropagation()
    e.preventDefault()

    // Showcase-embed lock - clicks are silent no-ops inside the marketing iframe.
    if (isShowcaseEmbed) return

    // Debounce: prevent clicking same token within 500ms
    const now = Date.now()
    if (lastClickRef.current.symbol === token.symbol &&
        now - lastClickRef.current.time < 500) {
      return
    }

    lastClickRef.current = { symbol: token.symbol, time: now }

    if (onTokenClickOpenOverlay) {
      onTokenClickOpenOverlay(token)
      return
    }
    if (selectToken) {
      selectToken({
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        networkId: token.networkId,
        logo: token.logo,
        price: token.price,
        change: token.change,
      })
    }
  }

  // Token item renderer
  const renderToken = (token, index, isFirstSet) => {
    const rank = (index % tokens.length) + 1
    // What the label shows: the token's real market-cap rank when the feed
    // knows it, else its slot in the strip (curated + stock tiers, which have
    // no cap rank and where the slot IS the standing).
    const displayRank = token.marketRank || rank
    const changeNum = parseFloat(token.change) || 0
    const isTopGainer = rank <= 3 && changeNum > 0
    const isLoser = changeNum < 0
    
    // Check if this token is currently selected (compare by address or symbol)
    const isSelected = selectedToken && (
      (token.address && selectedToken.address && 
       token.address.toLowerCase() === selectedToken.address.toLowerCase()) ||
      (!token.address && token.symbol === selectedToken.symbol)
    )
    
    return (
      <div
        key={`${token.symbol}-${index}-${isFirstSet ? 'a' : 'b'}`}
        className={`ticker-item ${isTopGainer ? 'top-gainer' : ''} ${isLoser ? 'loser' : ''} ${token.featured ? 'featured' : ''} ${isSelected ? 'selected' : ''}${isShowcaseEmbed ? ' is-locked' : ''}`}
        onClick={(e) => handleTokenClick(e, token)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTokenClick(e, token) }}
        style={{ cursor: isShowcaseEmbed ? 'not-allowed' : 'pointer' }}
        role="button"
        aria-label={isShowcaseEmbed ? `${token.symbol} - available in Beta, not in preview` : `Select ${token.symbol}`}
        aria-disabled={isShowcaseEmbed || undefined}
        title={isShowcaseEmbed ? 'Available in Beta' : undefined}
        tabIndex={isShowcaseEmbed ? -1 : 0}
      >
        <div className="ticker-item-inner" style={{ pointerEvents: 'none' }}>
          <div className="holographic-shimmer" />
          {isTopGainer && <div className="gainer-glow" />}
          <div className={`ticker-rank ${displayRank <= 3 ? 'top-three' : ''}`}>
            #{displayRank}
          </div>
          <div className="ticker-logo">
            {token.logo ? (
              <img
                src={token.logo}
                alt={token.symbol}
                width="40"
                height="40"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const c = (token.symbol?.charAt(0) || '?').toUpperCase()
                  e.target.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="20" fill="%238B5CF6"/><text x="20" y="26" text-anchor="middle" fill="white" font-size="18" font-family="system-ui">${c}</text></svg>`)}`
                }}
              />
            ) : (
              <svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
                <rect width="40" height="40" rx="20" fill="#8B5CF6" />
                <text x="20" y="26" textAnchor="middle" fill="white" fontSize="18" fontFamily="system-ui">
                  {(token.symbol?.charAt(0) || '?').toUpperCase()}
                </text>
              </svg>
            )}
            {token.featured && <div className="featured-ring" />}
          </div>
          <div className="ticker-info">
            <span className="ticker-symbol">{token.symbol}</span>
            <span className="ticker-name">{token.name}</span>
          </div>
          <div className="ticker-sparkline">
            {(() => {
              const SPARK_W = 96
              const SPARK_H = 28
              const PAD_Y = 2
              const sparkPath = generateSparklinePath(token.sparkline, SPARK_W, SPARK_H)
              const lastVal = token.sparkline?.[token.sparkline.length - 1]
              const minV = token.sparkline ? Math.min(...token.sparkline) : 0
              const maxV = token.sparkline ? Math.max(...token.sparkline) : 1
              const dotY = token.sparkline
                ? SPARK_H - PAD_Y - ((lastVal - minV) / (maxV - minV || 1)) * (SPARK_H - PAD_Y * 2)
                : SPARK_H / 2
              const stroke = isLoser ? '#FB6C6C' : '#22D3A0'
              const gradId = `spark-grad-${token.symbol}-${index}-${isFirstSet ? 'a' : 'b'}`
              return (
                <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor={stroke} stopOpacity="0.42" />
                      <stop offset="60%" stopColor={stroke} stopOpacity="0.12" />
                      <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`${sparkPath} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`}
                    fill={`url(#${gradId})`}
                  />
                  <path
                    d={sparkPath}
                    fill="none"
                    stroke={stroke}
                    strokeWidth="1.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className="sparkline-path"
                  />
                  <circle
                    cx={SPARK_W - 1.2}
                    cy={dotY}
                    r="1.8"
                    fill={stroke}
                    className="sparkline-dot"
                  />
                </svg>
              )
            })()}
          </div>
          <div className="ticker-price-section">
            <span className="ticker-price">
              {fmtPrice(token.price)}
              {token.hasLiveData && <span className={`live-indicator${isLoser ? ' live-indicator-bear' : ''}`} title={t('ticker.realTimeData')}>●</span>}
            </span>
            <span className={`ticker-change ${(parseFloat(token.change) || 0) >= 0 ? 'positive' : 'negative'}`}>
              <span className="change-arrow">{(parseFloat(token.change) || 0) >= 0 ? '▲' : '▼'}</span>
              {(() => {
                const change = parseFloat(token.change) || 0;
                // Explicit unit wins (welcome feeds mark percent-form values);
                // otherwise fall back to the magnitude heuristic (legacy
                // curated/binance callers pass decimals like -0.0557 = -5.57%).
                const pct = token.changeUnit === 'percent'
                  ? Math.abs(change)
                  : (Math.abs(change) > 1 ? Math.abs(change) : Math.abs(change * 100));
                return pct.toFixed(2);
              })()}%
            </span>
          </div>
        </div>
        <div className="ticker-divider" />
      </div>
    )
  }

  // News headline renderer
  const renderNewsItem = (item, index, isFirstSet) => (
    <div
      key={`news-${index}-${isFirstSet ? 'a' : 'b'}`}
      className="ticker-news-item"
      onClick={() => item.url && window.open(item.url, '_blank', 'noopener')}
      role="button"
      tabIndex={0}
    >
      <span className="ticker-news-source">
        <img
          className="ticker-news-source-icon"
          src={getNewsSourceIcon(item.source)}
          alt=""
          width="14"
          height="14"
          loading="lazy"
          onError={(e) => { e.target.style.display = 'none' }}
        />
        {item.source || 'News'}
      </span>
      <span className="ticker-news-dot">·</span>
      <span className="ticker-news-title">{item.title}</span>
      <div className="ticker-divider" />
    </div>
  )

  const isNewsMode = tickerMode === 'news' && newsItems?.length > 0

  const tickerContent = (
    <div
      className={`token-ticker sentiment-${marketSentiment}${isNewsMode ? ' news-mode' : ''}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Animated gradient background based on sentiment */}
      <div className="ticker-sentiment-bg" />
      
      {/* Left cluster: optional leftSlot (e.g. trending tier dropdown) + Mode toggle pill */}
      {(leftSlot || onToggleMode) ? (
        <div className="ticker-left-cluster" onClick={(e) => e.stopPropagation()}>
          {leftSlot}
          {onToggleMode ? (
            <div className="ticker-mode-toggle" onClick={(e) => { e.stopPropagation(); onToggleMode() }}>
              <div className={`ticker-mode-pill${tickerMode === 'trending' ? ' active' : ''}`}>Trending</div>
              <div className={`ticker-mode-pill${tickerMode === 'news' ? ' active' : ''}`}>News</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="market-pulse left">
          <div className="pulse-ring" />
          <div className="pulse-dot" />
          <span className="pulse-label">{tokensFromProp ? t('ticker.live') : ((loading || stockLoading) ? t('common.loading').toUpperCase() : t('ticker.live'))}</span>
        </div>
      )}

      {/* Info pill - RIGHT */}
      <div className="ticker-right-pill">
        {isNewsMode
          ? `${newsItems.length} Headlines`
          : `Top ${tokens.length}`
        }
      </div>
      
      <div className="ticker-glow-left" />
      <div className="ticker-glow-right" />
      
      <div
        ref={trackRef}
        className={`ticker-track ${isPaused ? 'paused' : ''}`}
      >
        {/* First set - with ref for measurement */}
        <div ref={contentRef} className="ticker-content-set">
          {isNewsMode
            ? newsItems.map((item, i) => renderNewsItem(item, i, true))
            : (tokens || []).map((token, index) => renderToken(token, index, true))
          }
        </div>
        {/* Duplicate set for seamless loop */}
        <div className="ticker-content-set">
          {isNewsMode
            ? newsItems.map((item, i) => renderNewsItem(item, i, false))
            : (tokens || []).map((token, index) => renderToken(token, index, false))
          }
        </div>
      </div>
    </div>
  )

  if (embedded) {
    return <div className="token-ticker-embedded">{tickerContent}</div>
  }
  return tickerContent
}

export default TokenTicker
