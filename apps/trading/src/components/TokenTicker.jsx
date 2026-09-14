/**
 * TokenTicker Component
 * Dynamic scrolling bar of top trending tokens
 * Powered by KD's Spectre onchain API + Codex fallback
 *
 * FEATURES:
 * - Mini sparkline charts for each token
 * - Glowing pulse effect for top gainers
 * - Sentiment-based background gradient
 * - Clickable tokens to navigate to detail view
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTrendingTokens, prefetchChartBars, prefetchTokenDetails, prewarmChartBarsList } from '../hooks/useCodexData'
import useAdaptivePolling from '../hooks/useAdaptivePolling'
import { tokenPlaceholder } from '../utils/tokenPlaceholder'
import { getHardcodedLogo, inferNetworkId } from '../services/codexApi'
import { TRENDING_TICKER_CHAIN_IDS, publishTickerTokens } from '../utils/trendingFilter'
import { ChainIcon } from '../utils/chainIcons'
import { Layers } from 'lucide-react'
import './TokenTicker.css'

// Default chains if no token is selected. Re-exported from
// utils/trendingFilter so the CommandPalette can match without
// importing from the component layer.
const DEFAULT_TICKER_CHAIN_IDS = TRENDING_TICKER_CHAIN_IDS

// Chain picker options for the bar's dropdown (replaces the old "LIVE" label).
// 'auto' follows the CURRENT token's chain (the default); explicit picks
// override it. Only chains that actually return Codex trending data are listed
// (Optimism omitted - it returns 0). Solana sits right after Ethereum.
const TICKER_CHAIN_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'all', label: 'All chains', networkIds: [1, 1399811149, 56, 8453, 42161, 137, 43114, 4663] },
  { value: '1', label: 'Ethereum', networkIds: [1] },
  { value: '1399811149', label: 'Solana', networkIds: [1399811149] },
  { value: '56', label: 'BSC', networkIds: [56] },
  { value: '8453', label: 'Base', networkIds: [8453] },
  { value: '42161', label: 'Arbitrum', networkIds: [42161] },
  { value: '137', label: 'Polygon', networkIds: [137] },
  { value: '43114', label: 'Avalanche', networkIds: [43114] },
  { value: '4663', label: 'Robinhood', networkIds: [4663] },
]
// networkId -> short label, for the trigger when 'auto' resolves to any chain.
const CHAIN_LABELS = {
  1: 'Ethereum', 56: 'BSC', 1399811149: 'Solana', 8453: 'Base', 4663: 'Robinhood',
  42161: 'Arbitrum', 137: 'Polygon', 10: 'Optimism', 43114: 'Avalanche', 81457: 'Blast',
}

// Max tokens to display in the ticker
const MAX_TICKER_TOKENS = 20

// Get or create animation start time (persists across remounts)
const getAnimationStartTime = () => {
  const stored = sessionStorage.getItem('ticker-start-time')
  if (stored) return parseInt(stored, 10)
  const now = Date.now()
  sessionStorage.setItem('ticker-start-time', now.toString())
  return now
}

// Stable seeded random for sparkline generation (prevents re-randomize on every render)
const seededRandom = (seed) => {
  let x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

const TokenTicker = ({ selectToken, selectedToken }) => {
  const [isPaused, setIsPaused] = useState(false)
  const trackRef = useRef(null)
  const contentRef = useRef(null)
  const animationStartTime = useRef(getAnimationStartTime())
  const isPausedRef = useRef(isPaused)
  // The marquee's Web-Animations handle + whether the bar is on screen.
  const animRef = useRef(null)
  const onScreenRef = useRef(true)

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  // Chain picker (the bar's dropdown that replaces the old LIVE label). 'auto'
  // follows the CURRENT token's chain (the default); explicit picks override.
  const [tickerChain, setTickerChain] = useState('auto')
  const [chainOpen, setChainOpen] = useState(false)
  const chainTriggerRef = useRef(null)
  const [chainMenuPos, setChainMenuPos] = useState(null)

  // Resolve the selection to the chain IDs the trending hook polls.
  const tickerChainIds = useMemo(() => {
    if (tickerChain === 'auto') {
      return selectedToken?.networkId ? [selectedToken.networkId] : DEFAULT_TICKER_CHAIN_IDS
    }
    return TICKER_CHAIN_OPTIONS.find(o => o.value === tickerChain)?.networkIds || DEFAULT_TICKER_CHAIN_IDS
  }, [tickerChain, selectedToken?.networkId])

  const resolvedChainLabel = tickerChainIds.length > 1
    ? 'All chains'
    : (CHAIN_LABELS[tickerChainIds[0]] || 'Chain')

  const toggleChainMenu = useCallback(() => {
    const r = chainTriggerRef.current?.getBoundingClientRect()
    if (r) setChainMenuPos({ top: r.bottom + 6, left: r.left })
    setChainOpen(o => !o)
  }, [])
  useEffect(() => {
    if (!chainOpen) return
    const onDoc = (e) => {
      if (chainTriggerRef.current && !chainTriggerRef.current.contains(e.target) &&
          !e.target.closest?.('.ticker-chain-menu')) setChainOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setChainOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [chainOpen])

  // Fetch per-chain trending tokens. deferInitial: the ticker is decorative
  // chrome that seeds from the warm module cache / curated fallback, so its
  // mount fetch yields the first-second network pipe to the token page's
  // snapshot + bars critical path (and bounce sessions fire zero trending calls).
  // 120s poll matches the server-side 2min trending cache TTL (same Phase F
  // rationale as LeftPanel) - at 60s half the polls returned the same stale
  // cached payload, wasting a request every other tick.
  // '24h' (not 'volume') so this shares the EXACT module cache key the Discover
  // table uses - `trending:${networkIds}:${timeframe}` in useTrendingTokens.
  // Both values already resolved to a 24h ranking server-side ('volume' is not a
  // key in WINDOW_FIELD, so scoreTraction fell through to 24h), but they hashed
  // to two different cache entries and therefore two independent fetches that
  // could drift apart between polls. One key = navigating Discover -> a token
  // page reuses the warm entry and the two lists cannot disagree.
  const { tokens: trendingTokens, loading } = useTrendingTokens(120000, tickerChainIds, '24h', { deferInitial: true })

  // Generate sparkline from price change data (seeded for stability)
  const generateSparklineFromChange = (change, seed) => {
    const points = []
    let current = 50

    for (let i = 0; i < 12; i++) {
      const progress = i / 11
      const targetDelta = (change / 100) * 50 * progress
      const noise = (seededRandom(seed + i * 7.3) - 0.5) * 10
      current = 50 + targetDelta + noise
      points.push(Math.max(10, Math.min(90, current)))
    }

    points[11] = change >= 0 ? Math.max(points[10], 60 + change) : Math.min(points[10], 40 + change)
    return points
  }

  // Helper to build logo URL from address + networkId
  const getTokenLogo = (token) => {
    const hardcoded = getHardcodedLogo(token.address)
    if (hardcoded) return hardcoded
    if (token.logo && !token.logo.includes('placeholder')) return token.logo
    if (token.address && token.networkId) {
      return `https://token-media.defined.fi/${token.networkId}_${token.address.toLowerCase()}_large.png`
    }
    return tokenPlaceholder(token.symbol)
  }

  // Crossfade: when token list changes, fade out -> swap -> fade in
  const [displayTokens, setDisplayTokens] = useState([])
  const [trackOpacity, setTrackOpacity] = useState(1)
  const pendingTokensRef = useRef(null)
  const fadeTimerRef = useRef(null)

  // Map trending tokens to ticker format, preserving the server's order.
  //
  // TRUST THE SERVER - identical stance to the Discover table (see baseTokens
  // in TokenDiscoveryTable). /api/tokens/trending already excludes stablecoins /
  // wrapped / LSTs / base coins / majors, quality-gates on liquidity + recent
  // activity + movement, screens rugs and identity squats, collapses copycats by
  // narrative, and orders by trendScore.
  //
  // The old `filterTrendingTokens` pass here is what made this bar disagree with
  // Discover for the SAME chain: it dropped every sub-$100k-mcap token (exactly
  // the fresh launches this bar exists to surface), deduped by symbol alone
  // (collapsing genuinely distinct same-ticker projects), and re-sorted by raw
  // 24h volume - throwing away the trending rank the engine just computed.
  // Discover removed that filter for those reasons; the bar keeps it only for
  // the sanity checks the server cannot make (a usable symbol + a real price).
  const tokens = useMemo(() => {
    const list = (Array.isArray(trendingTokens) ? trendingTokens : [])
      .filter((t) => t && t.symbol && (parseFloat(t.price) || 0) > 0)
      .slice(0, MAX_TICKER_TOKENS)
    if (list.length === 0) return []

    return list.map((t, idx) => {
      const change = parseFloat(t.change) || 0
      return {
        symbol: t.symbol,
        name: t.name,
        address: t.address,
        networkId: t.networkId,
        price: parseFloat(t.price) || 0,
        marketCap: parseFloat(t.marketCap) || 0,
        change,
        // Carry the 1h + 24h windows (same fraction scale as `change`) so
        // downstream surfaces that mirror this set - the screener's 1h/24h
        // toggle + its breadth/sort - can switch windows. Dropping them here
        // made the toggle a no-op (only `change` survived). change24h === the
        // 24h `change`; change1h is the real 1h move (0 when genuinely flat).
        change1h: parseFloat(t.change1h) || 0,
        change24h: parseFloat(t.change24h ?? t.change) || 0,
        volume24h: t.volume24h || 0,
        logo: getTokenLogo(t),
        sparkline: generateSparklineFromChange(change, idx * 13.7 + (t.address ? t.address.charCodeAt(2) : 0)),
        featured: t.symbol === 'SPECTRE',
        hasLiveData: true,
      }
    })
  }, [trendingTokens])

  // Crossfade when token list changes chains
  useEffect(() => {
    if (tokens.length === 0) return

    // First load - no fade, just show
    if (displayTokens.length === 0) {
      setDisplayTokens(tokens)
      return
    }

    // Same tokens (refresh with updated prices) - swap silently
    const oldKey = displayTokens.map(t => t.symbol).join(',')
    const newKey = tokens.map(t => t.symbol).join(',')
    if (oldKey === newKey) {
      setDisplayTokens(tokens)
      return
    }

    // Different chain - crossfade
    clearTimeout(fadeTimerRef.current)
    pendingTokensRef.current = tokens
    setTrackOpacity(0)
    fadeTimerRef.current = setTimeout(() => {
      setDisplayTokens(pendingTokensRef.current)
      pendingTokensRef.current = null
      setTrackOpacity(1)
    }, 300)

    return () => clearTimeout(fadeTimerRef.current)
  }, [tokens])

  // Publish the exact token set the bar is showing so the command-palette
  // TRENDING section can mirror it verbatim (same tokens, order, chain
  // scope). Without this the palette fetched all-chains while the bar
  // scopes to the active token's chain — the two never matched.
  useEffect(() => {
    publishTickerTokens(tokens)
  }, [tokens])

  // Calculate overall market sentiment
  const marketSentiment = useMemo(() => {
    if (displayTokens.length === 0) return 'neutral'
    const avgChange = displayTokens.reduce((sum, t) => sum + (t.change || 0), 0) / displayTokens.length
    return avgChange > 2 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral'
  }, [displayTokens])

  // Pad each marquee set so ONE copy is wider than the viewport. When a chain
  // (e.g. Ethereum-only) returns few trending tokens, a single set is narrower
  // than the bar, so the seamless-loop math leaves a dark gap that sweeps in
  // from the right edge toward the centre. Repeating the list until a set spans
  // the widest plausible viewport keeps the strip continuously filled.
  const setTokens = useMemo(() => {
    if (displayTokens.length === 0) return []
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
    const target = Math.max(16, Math.ceil(vw / 140) + 2)
    if (displayTokens.length >= target) return displayTokens
    const reps = Math.ceil(target / displayTokens.length)
    return Array.from({ length: reps }, () => displayTokens).flat()
  }, [displayTokens])

  // Marquee - constant velocity scroll, seamless because the track carries a
  // duplicated content set (translate by exactly one set's width and loop).
  useEffect(() => {
    const PIXELS_PER_SECOND = 50
    let lastContentWidth = 0

    // Content width is measured OUTSIDE any per-frame path. Reading layout
    // geometry right after a style write forces a synchronous layout recalc
    // (~448ms of forced reflow in the old trace). It only changes when tokens
    // (re)load or the viewport resizes, so a ResizeObserver handles it.
    const measuredWidth = contentRef.current ? contentRef.current.offsetWidth : 0
    let ro = null

    // The scroll itself runs on the COMPOSITOR via the Web Animations API
    // instead of writing `style.transform` from a rAF loop. The old loop wrote
    // an inline transform every frame, and each write dirties the ~800-node
    // track subtree for style recalc: measured 1800 attribute mutations in 15s
    // (=120/sec) on the mobile token page, which is main-thread work the phone
    // pays for continuously. element.animate() hands the transform to the
    // compositor - the position lives in `currentTime`, so there are ZERO DOM
    // mutations while it runs. (Same fix the research app shipped for its own
    // ticker on 2026-07-08: 756 -> 197 ms/s main thread, -74%.)
    const build = (width) => {
      if (!trackRef.current || !width || width <= 0) return
      // Preserve visual progress across rebuilds (new tokens / resize) so the
      // marquee never jumps - this is what the old position-ratio math did.
      let ratio = 0
      const prev = animRef.current
      if (prev) {
        const prevDur = Number(prev.effect?.getTiming?.().duration) || 0
        if (prevDur > 0) ratio = ((Number(prev.currentTime) || 0) % prevDur) / prevDur
        prev.cancel()
      }
      const duration = (width / PIXELS_PER_SECOND) * 1000
      const anim = trackRef.current.animate(
        [{ transform: 'translateX(0px)' }, { transform: `translateX(-${width}px)` }],
        { duration, iterations: Infinity, easing: 'linear' },
      )
      try { anim.currentTime = ratio * duration } catch { /* pre-spec browsers */ }
      animRef.current = anim
      lastContentWidth = width
      // The pause effect owns play/pause; start paused if we already should be.
      if (isPausedRef.current || document.hidden || !onScreenRef.current) anim.pause()
    }

    build(measuredWidth)
    if (contentRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const w = contentRef.current ? contentRef.current.offsetWidth : 0
        // Rebuild only on a REAL width change - a no-op rebuild would restart
        // the animation object every time the observer fires.
        if (w > 0 && Math.abs(w - lastContentWidth) > 1) build(w)
      })
      ro.observe(contentRef.current)
    }

    return () => {
      if (ro) ro.disconnect()
      if (animRef.current) { animRef.current.cancel(); animRef.current = null }
    }
  }, [])

  /* Play/pause the marquee. Runs while the user can actually see it: not on
     hover (the existing read-a-row pause), not on a hidden tab, and not while
     scrolled off screen - a phone should not composite a marquee it isn't
     showing. */
  useEffect(() => {
    const apply = () => {
      const anim = animRef.current
      if (!anim) return
      const shouldPause = isPausedRef.current || document.hidden || !onScreenRef.current
      if (shouldPause) { if (anim.playState === 'running') anim.pause() }
      else if (anim.playState !== 'running') anim.play()
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    let io = null
    const host = trackRef.current?.parentElement
    if (host && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        onScreenRef.current = entries.some((e) => e.isIntersecting)
        apply()
      }, { threshold: 0 })
      io.observe(host)
    }
    return () => {
      document.removeEventListener('visibilitychange', apply)
      if (io) io.disconnect()
    }
  }, [isPaused])

  const formatPrice = (price) => {
    const numPrice = typeof price === 'number' ? price : parseFloat(price)
    if (!numPrice || isNaN(numPrice) || !isFinite(numPrice)) return '---'
    if (numPrice >= 1000) return `$${numPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (numPrice >= 1) return `$${numPrice.toFixed(2)}`
    if (numPrice >= 0.01) return `$${numPrice.toFixed(4)}`
    if (numPrice >= 0.0001) return `$${numPrice.toFixed(6)}`
    return `$${numPrice.toFixed(8)}`
  }

  const formatMcap = (mcap) => {
    const n = typeof mcap === 'number' ? mcap : parseFloat(mcap)
    if (!n || isNaN(n) || !isFinite(n)) return '---'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
    return `$${n.toFixed(0)}`
  }

  const generateSparklinePath = (data, width = 48, height = 20) => {
    if (!data || data.length === 0) return 'M0,10 L48,10'
    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min || 1
    const step = width / (data.length - 1)
    const points = data.map((val, i) => {
      const x = i * step
      const y = height - ((val - min) / range) * height
      return `${x},${y}`
    })
    return `M${points.join(' L')}`
  }

  const lastClickRef = useRef({ symbol: null, time: 0 })

  // Intent-gated hover prefetch (parity with LeftPanel's trending rows):
  // 200ms dwell on a ticker item warms that token's chart bars (saved TF) +
  // details, so the click paints instantly. No session Set - the bars cache
  // is TTL-aware, so repeat hovers on a fresh entry are a free no-op while
  // hovers on an EXPIRED entry re-warm it (the Set used to block that).
  const hoverPrefetchTimerRef = useRef(null)
  const handleItemHover = useCallback((token) => {
    if (!token?.address) return
    clearTimeout(hoverPrefetchTimerRef.current)
    hoverPrefetchTimerRef.current = setTimeout(() => {
      const nid = inferNetworkId(token.address, token.networkId)
      prefetchChartBars(token.address, nid)
      prefetchTokenDetails(token.address, nid)
    }, 200)
  }, [])
  const handleItemHoverEnd = useCallback(() => {
    clearTimeout(hoverPrefetchTimerRef.current)
  }, [])

  // Background KEEP-warm: the ticker is a primary token-switch surface (and
  // it auto-scrolls, so hover-intent rarely fires). Warm EVERY display
  // token's chart bars on idle, then re-warm on a cadence just under the
  // 5-min bars-cache TTL - so a click paints candles from client cache in
  // ms no matter WHEN it happens (the old top-8/once-per-session pass
  // decayed after 5 minutes and late clicks went back to a cold Codex
  // fetch). prewarmChartBarsList is TTL-aware: fresh entries cost nothing,
  // hidden/idle tabs skip, 350ms stagger bounds the burst.
  //
  // CHURN GUARD: the effect keys on the joined ADDRESS SET, never on
  // displayTokens' identity - the ticker re-renders on every live price
  // tick with a fresh array, and an identity-keyed effect cancels the
  // staggered pass before it fetches anything (verified live: zero warms
  // ever fired). The latest list is read through a ref at run time.
  const displayTokensRef = useRef(displayTokens)
  displayTokensRef.current = displayTokens
  const tickerAddressesKey = (displayTokens || []).map(t => t?.address || '').join(',')
  const prewarmCancelRef = useRef(null)
  const runTickerPrewarm = useCallback(() => {
    prewarmCancelRef.current?.()
    prewarmCancelRef.current = prewarmChartBarsList(displayTokensRef.current || [], { visibleOnly: true })
  }, [])
  useEffect(() => {
    if (!tickerAddressesKey) return undefined
    let cancelled = false
    let idleId = null
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 800))
    // COLD-BOOT HOLD-OFF (2026-07-23, measured): on a cold page load this
    // first pass used to start within ~1-4s (idle timeout) and, together with
    // LeftPanel's twin pass, put ~40 cold wide /api/bars (1-4.4s each) on the
    // wire during the exact window the ACTIVE token's chart is fetching its
    // own bars - the first-launch "chart is slow" contention. Hold the FIRST
    // pass until the page is ~15s old; later passes (trending-set changes,
    // the 240s repoll) fire immediately as before. A ticker click inside the
    // hold-off pays the same cold fetch it always did - minus the storm.
    // The 3.5s floor covers the LATE-mount entry: the ticker mounts when the
    // user enters the token view, and past 15s of page age the hold was zero,
    // so the warm kicked right into the active token's own bars window
    // (measured on prod 2026-08-04 - see LeftPanel's twin comment).
    const holdOff = Math.max(15_000 - performance.now(), 3500)
    const holdTimer = setTimeout(() => {
      if (cancelled) return
      idleId = idle(() => { if (!cancelled) runTickerPrewarm() }, { timeout: 4000 })
    }, holdOff)
    return () => {
      cancelled = true
      clearTimeout(holdTimer)
      if (typeof window.cancelIdleCallback === 'function' && typeof idleId === 'number') {
        try { window.cancelIdleCallback(idleId) } catch { /* noop */ }
      }
    }
  }, [tickerAddressesKey, runTickerPrewarm])
  // Cancel any running stagger only on UNMOUNT (a key change mid-pass just
  // lets the old pass finish - it warms tokens that are still cached-cold).
  useEffect(() => () => { prewarmCancelRef.current?.() }, [])
  useAdaptivePolling(runTickerPrewarm, { interval: 240000, enabled: tickerAddressesKey.length > 0 })

  const handleTokenClick = (e, token) => {
    e.stopPropagation()
    e.preventDefault()
    const now = Date.now()
    if (lastClickRef.current.symbol === token.symbol &&
        now - lastClickRef.current.time < 500) return

    lastClickRef.current = { symbol: token.symbol, time: now }

    if (selectToken) {
      selectToken({
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        networkId: token.networkId,
        logo: token.logo,
        price: token.price,
        change: token.change,
        // Row sparkline closes ride to the hot-cache payload so the chart
        // placeholder paints a REAL curve instantly on never-seen tokens.
        sparkline: token.sparkline,
      }, 'trending')
    }
  }

  const renderToken = (token, index, isFirstSet) => {
    const isTopGainer = (token.change || 0) > 5
    const isLoser = (token.change || 0) < 0
    const rank = (index % tokens.length) + 1

    const isSelected = selectedToken && (
      (token.address && selectedToken.address &&
       token.address.toLowerCase() === selectedToken.address.toLowerCase()) ||
      (!token.address && token.symbol === selectedToken.symbol)
    )

    return (
      <div
        key={`${token.symbol}-${index}-${isFirstSet ? 'a' : 'b'}`}
        className={`ticker-item ${isTopGainer ? 'top-gainer' : ''} ${token.featured ? 'featured' : ''} ${isSelected ? 'selected' : ''}`}
        // Chart-warm target: the marquee renders every token but only a
        // handful are on screen at a time, and those are the clickable ones.
        data-warm-addr={token.address}
        onClick={(e) => handleTokenClick(e, token)}
        onMouseEnter={() => handleItemHover(token)}
        onMouseLeave={handleItemHoverEnd}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTokenClick(e, token) }}
        style={{ cursor: 'pointer' }}
        role="button"
        aria-label={`Select ${token.symbol}`}
        tabIndex={0}
      >
        <div className="ticker-item-inner" style={{ pointerEvents: 'none' }}>
          <div className={`ticker-rank ${rank <= 3 ? 'top-three' : ''}`}>
            #{rank}
          </div>
          <div className="ticker-logo">
            {/* Lazy: the track lays ~40 items out horizontally (two duplicated
                sets for the seamless loop) but only ~6 are on screen, and each
                logo is a 600-900ms TTFB round-trip to raw S3 - firing all of
                them in the first frame is a large slice of the token page's
                boot request storm. Chrome's lazy threshold still preloads the
                items within ~1250px of the viewport edge, which at the marquee's
                50px/s is ~25s of runway, so nothing pops in visibly.
                width/height are the CSS box (28px) so the row never reflows. */}
            <img
              src={token.logo}
              alt={token.symbol}
              width={28}
              height={28}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.target.src = tokenPlaceholder(token.symbol)
              }}
            />
          </div>
          <div className="ticker-info">
            <span className="ticker-symbol">{token.symbol}</span>
            <span className="ticker-name">{token.name}</span>
          </div>
          <div className="ticker-sparkline">
            <svg viewBox="0 0 48 20" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`spark-grad-${token.symbol}-${index}-${isFirstSet ? 'a' : 'b'}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={isLoser ? '#ef4444' : '#10b981'} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={isLoser ? '#ef4444' : '#10b981'} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={`${generateSparklinePath(token.sparkline)} L48,20 L0,20 Z`}
                fill={`url(#spark-grad-${token.symbol}-${index}-${isFirstSet ? 'a' : 'b'})`}
              />
              <path
                d={generateSparklinePath(token.sparkline)}
                fill="none"
                stroke={isLoser ? '#ef4444' : '#10b981'}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="sparkline-path"
              />
              <circle
                cx="48"
                cy={token.sparkline ? 20 - ((token.sparkline[token.sparkline.length - 1] - Math.min(...token.sparkline)) / (Math.max(...token.sparkline) - Math.min(...token.sparkline) || 1)) * 20 : 10}
                r="2"
                fill={isLoser ? '#ef4444' : '#10b981'}
                className="sparkline-dot"
              />
            </svg>
          </div>
          <div className="ticker-price-section">
            <span className="ticker-price">
              {token.marketCap > 0 ? formatMcap(token.marketCap) : formatPrice(token.price)}
            </span>
            <span className={`ticker-change ${(parseFloat(token.change) || 0) >= 0 ? 'positive' : 'negative'}`}>
              <span className="change-arrow">{(parseFloat(token.change) || 0) >= 0 ? '\u25B2' : '\u25BC'}</span>
              {Math.abs(parseFloat(token.change) || 0).toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="ticker-divider" />
      </div>
    )
  }

  return (
    <div
      className={`token-ticker sentiment-${marketSentiment}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="ticker-sentiment-bg" />

      {/* Left: chain picker (replaces the old LIVE label) */}
      <div className="ticker-label-left">
        <button
          type="button"
          ref={chainTriggerRef}
          className="ticker-chain-trigger"
          onClick={toggleChainMenu}
          aria-haspopup="listbox"
          aria-expanded={chainOpen}
          title="Choose chain"
        >
          <span className="ticker-chain-icon">
            {tickerChainIds.length > 1
              ? <Layers size={13} strokeWidth={2} />
              : <ChainIcon networkId={tickerChainIds[0]} size={14} />}
          </span>
          <span className="ticker-chain-text">{resolvedChainLabel}</span>
          <svg className={`ticker-chain-chevron${chainOpen ? ' open' : ''}`} width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden="true">
            <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {chainOpen && chainMenuPos && createPortal(
        <div
          className="ticker-chain-menu"
          role="listbox"
          style={{ position: 'fixed', top: chainMenuPos.top, left: chainMenuPos.left }}
        >
          <div className="ticker-chain-eyebrow">Trending chain</div>
          {TICKER_CHAIN_OPTIONS.map((o) => {
            const optIcon = o.value === 'all'
              ? <Layers size={14} strokeWidth={2} />
              : o.value === 'auto'
                ? (selectedToken?.networkId
                    ? <ChainIcon networkId={selectedToken.networkId} size={15} />
                    : <Layers size={14} strokeWidth={2} />)
                : <ChainIcon networkId={Number(o.value)} size={15} />
            return (
              <React.Fragment key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={tickerChain === o.value}
                  className={`ticker-chain-option${tickerChain === o.value ? ' selected' : ''}`}
                  onClick={() => { setTickerChain(o.value); setChainOpen(false) }}
                >
                  <span className="opt-icon">{optIcon}</span>
                  <span className="opt-label">{o.label}{o.value === 'auto' ? <span className="opt-hint">follows token</span> : null}</span>
                  {tickerChain === o.value && (
                    <svg className="opt-check" width="11" height="8" viewBox="0 0 12 9" fill="none" aria-hidden="true">
                      <path d="M1 4l3.5 3.5L11 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                {o.value === 'all' && <div className="ticker-chain-divider" role="separator" aria-hidden="true" />}
              </React.Fragment>
            )
          })}
        </div>,
        document.body
      )}

      {/* Right: trending count label */}
      <div className="ticker-label-right">
        <span className="ticker-top">
          <span className="ticker-top-label">TOP</span>
          <span className="ticker-top-count">{displayTokens.length || 20}</span>
        </span>
      </div>

      <div className="ticker-glow-left" />
      <div className="ticker-glow-right" />

      <div
        ref={trackRef}
        className={`ticker-track ${isPaused ? 'paused' : ''}`}
        style={{ opacity: trackOpacity, transition: 'opacity 0.3s ease' }}
      >
        {/* First set of tokens - with ref for measurement (padded to fill) */}
        <div ref={contentRef} className="ticker-content-set">
          {setTokens.map((token, index) => renderToken(token, index, true))}
        </div>
        {/* Duplicate set for seamless loop */}
        <div className="ticker-content-set">
          {setTokens.map((token, index) => renderToken(token, index, false))}
        </div>
      </div>
    </div>
  )
}

export default TokenTicker
