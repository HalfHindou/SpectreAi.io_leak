/**
 * LeftPanel Component
 * Figma Reference: Left sidebar with X/Watchlist tabs
 * Features: Tweets feed, Watchlist, AI Logs, Trending
 */
import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react'
import lazy from '../lib/lazy-with-retry'
import { isAppActive } from '../lib/idleManager'
import { createPortal } from 'react-dom'
import { useCopyToast } from '../App'

// Code-split: only loaded when the user actually opens Full View
const XFullView = lazy(() => import('./XFullView'))
const XDashColumn = lazy(() => import('./XFullView/XDashColumn'))
const WatchlistFullView = lazy(() => import('./WatchlistFullView'))
const SpectreSocial = lazy(() => import('./SpectreSocial'))
import { useTrendingTokens, prefetchChartBars, prefetchLatestTrades, prewarmChartBarsList } from '../hooks/useCodexData'
import { useTokenDetailsStatic } from '../contexts/TokenDetailsContext'
import { formatPrice, formatLargeNumber, getHardcodedLogo, getDetailedTokenInfo, getTokenPricesBatch, getBars, inferNetworkId, fetchTokenDetailsBatch } from '../services/codexApi'
import { getTokenIntel } from '../services/xDashApi'
import { fetchOfficialFeed, fetchAuthorProfile } from '../hooks/useXProfile'
import { withXDashCgId } from './XFullView/xdash-overrides'
import { whenIdle } from '../utils/whenIdle'
import useAdaptivePolling from '../hooks/useAdaptivePolling'
import { subsample } from '../utils/sparkline'
import { Sparkline, DeltaChip } from './ui/viz'
import { fetchSparklineBars } from '../lib/sparklineFetch'
import { Lock, Radar } from 'lucide-react'
import Icon from './Icon'
import TokenScreener from './TokenScreener'
import './TokenScreener.css'

// Major tokens: symbol -> Codex address/networkId for batch price lookup
const MAJOR_TOKEN_ADDR = {
  'BTC': { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1 },
  'WBTC': { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1 },
  'ETH': { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 },
  'WETH': { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 },
  'SOL': { address: 'So11111111111111111111111111111111111111112', networkId: 1399811149 },
  'USDT': { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', networkId: 1 },
  'USDC': { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', networkId: 1 },
  'BNB': { address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', networkId: 1 },
  'LINK': { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1 },
  'UNI': { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1 },
  'AAVE': { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1 },
  'ARB': { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161 },
  'DOGE': { address: '0x4206931337dc273a630d328dA6441786BfaD668f', networkId: 1 },
  'AVAX': { address: '0x85f138bfEE4ef8e540890CFb48F620571d67Eda3', networkId: 1 },
}
import './LeftPanel.css'

// fetchSparklineBars + its module-level cache moved to lib/sparklineFetch.js
// so both Watchlist and the TokenScreener row-cards share one cache. The
// previous inline copy here lived through OL P1; Iteration 2 (D4) unified.

/* Watchlist sparkline — delegates to the OL Iteration 2 <Sparkline>
 * primitive. We honor the "never fake the line" rule from the brief:
 * when no real prices have arrived, render nothing (transparent SVG)
 * rather than synthesizing a seeded fake line. */
const WatchlistSparkline = React.memo(function WatchlistSparkline({ prices, change }) {
  const data = prices && prices.length >= 2 ? subsample(prices, 24) : null
  if (!data) {
    return <span className="watchlist-sparkline watchlist-sparkline--empty" aria-hidden="true" />
  }
  const stroke = change >= 0 ? 'var(--up)' : 'var(--down)'
  return (
    <Sparkline
      className="watchlist-sparkline"
      data={data}
      width={60}
      height={24}
      stroke={stroke}
      strokeWidth={1.4}
      fill="gradient"
    />
  )
}, (prev, next) => prev.prices === next.prices && (prev.change >= 0) === (next.change >= 0))

const TRENDING_TIMEFRAMES = [
  { value: 'volume', label: 'Volume' },
  { value: '24h', label: '24h' },
  { value: '12h', label: '12h' },
  { value: '4h', label: '4h' },
  { value: '1h', label: '1h' },
]
const TRENDING_CHAINS = [
  { value: 'all', label: 'All chains', networkIds: [1, 56, 1399811149] },
  { value: '1', label: 'Ethereum', networkIds: [1] },
  { value: '56', label: 'BSC', networkIds: [56] },
  { value: '1399811149', label: 'Solana', networkIds: [1399811149] },
  { value: '4663', label: 'Robinhood', networkIds: [4663] },
]

// DexScreener chainId -> Codex networkId mapping
const DEXSCREENER_CHAIN_MAP = {
  ethereum: 1, bsc: 56, solana: 1399811149, arbitrum: 42161,
  polygon: 137, base: 8453, avalanche: 43114, optimism: 10,
  fantom: 250, cronos: 25, pulsechain: 369, blast: 81457,
  robinhood: 4663,
}

// The upstream tweet APIs ship HTML-escaped text (&amp; &#x27; etc.) - decode
// so cards read like X renders them.
function decodeHtmlEntities(s) {
  if (!s || s.indexOf('&') === -1) return s
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

// X appends the attached media's t.co permalink to the end of the tweet text.
// When we render the media itself, that trailing link is noise - X hides it too.
function stripTrailingMediaLink(s) {
  return String(s || '').replace(/(?:\s*https?:\/\/t\.co\/\w+)+\s*$/i, '').trim()
}

// Per-token feed seed - revisiting a token paints its last fetched feed
// instantly from sessionStorage while the network revalidates in the
// background. Kills the multi-second blank panel on token switches.
const FEED_SEED_PREFIX = 'spectre-x-feed-v1:'
const FEED_SEED_TTL_MS = 30 * 60 * 1000

function readFeedSeed(tokenKey) {
  if (!tokenKey) return null
  try {
    const raw = sessionStorage.getItem(FEED_SEED_PREFIX + tokenKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - (parsed.ts || 0) > FEED_SEED_TTL_MS) return null
    if (!Array.isArray(parsed.tweets) || parsed.tweets.length === 0) return null
    return parsed
  } catch { return null }
}

function writeFeedSeed(tokenKey, tweets, author) {
  if (!tokenKey || !tweets.length) return
  try {
    // The merge pass wires tweets into a cycle (parent._projectReplies <->
    // reply._parentTweet), which JSON.stringify rejects. Snapshot with
    // replies flattened one level and parents dropped - the revalidation
    // fetch rebuilds both.
    const slim = tweets.slice(0, 40).map(({ _parentTweet, _projectReplies, ...rest }) => (
      Array.isArray(_projectReplies) && _projectReplies.length
        ? { ...rest, _projectReplies: _projectReplies.map(({ _parentTweet: _p, _projectReplies: _r, ...reply }) => reply) }
        : rest
    ))
    const payload = JSON.stringify({ ts: Date.now(), tweets: slim, author: author || null })
    try {
      sessionStorage.setItem(FEED_SEED_PREFIX + tokenKey, payload)
    } catch {
      // quota - evict all feed seeds and retry once
      Object.keys(sessionStorage)
        .filter(k => k.startsWith(FEED_SEED_PREFIX))
        .forEach(k => sessionStorage.removeItem(k))
      sessionStorage.setItem(FEED_SEED_PREFIX + tokenKey, payload)
    }
  } catch { /* storage unavailable or unserializable - seed is best-effort */ }
}

// First render commit after feed data lands mounts only this many cards;
// the rest reveal on idle ticks (see the revealCount effect).
const TWEETS_INITIAL_REVEAL = 4

// 1234 -> 1.2K, 3400000 -> 3.4M - X-style compact counts for card metrics
function fmtCount(n) {
  if (!Number.isFinite(n)) return null
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

// Resolved profiles for RT'd authors the feed doesn't carry (the upstream RT
// record only ships the reposting account's data). Module Map + localStorage
// (24h TTL) so each handle costs at most one /tweets/official call per day.
const RT_AUTHOR_CACHE = new Map()
const RT_AUTHOR_LS_PREFIX = 'spectre-x-author-v1:'
const RT_AUTHOR_TTL_MS = 24 * 60 * 60 * 1000
// Page age (ms) before the profile fan-out is allowed to start on a cold boot.
// These are decorative avatars/badges; they must never share the first-paint
// connection budget with the chart, details and trades. See the drain below.
const RT_AUTHOR_BOOT_HOLDOFF_MS = 3500

function getCachedRtAuthor(handle) {
  const key = handle.toLowerCase()
  if (RT_AUTHOR_CACHE.has(key)) return RT_AUTHOR_CACHE.get(key)
  try {
    const raw = localStorage.getItem(RT_AUTHOR_LS_PREFIX + key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Date.now() - (parsed.ts || 0) < RT_AUTHOR_TTL_MS) {
        RT_AUTHOR_CACHE.set(key, parsed.profile)
        return parsed.profile
      }
    }
  } catch { /* parse/quota - treat as miss */ }
  return undefined
}

function putCachedRtAuthor(handle, profile) {
  const key = handle.toLowerCase()
  RT_AUTHOR_CACHE.set(key, profile)
  try {
    localStorage.setItem(RT_AUTHOR_LS_PREFIX + key, JSON.stringify({ ts: Date.now(), profile }))
  } catch { /* quota - memory cache still holds it */ }
}

// Map an X Dash `top_mentions[]` entry into the LeftPanel tweet-card shape.
// X Dash is the fallback tweet source for tokens the tweets-search API does
// not cover (e.g. fresh pump.fun launches like $ANSEM / the-black-bull, whose
// only X coverage is community mentions tracked by X Dash).
function xdashMentionToTweet(m, index, projectUsername) {
  const tw = (m && m.tweet) || {}
  const au = (m && m.author) || {}
  const text = decodeHtmlEntities((tw.full_text || '').trim())
  const isRetweet = /^rt @/i.test(text)
  const isReply = !isRetweet && text.startsWith('@')
  // X Dash mentions include the project's own posts - classify them so the
  // card gets the gold org badge (X Dash authors don't carry verified_type,
  // but a token's official account is an org account).
  const isFromProject = !!projectUsername
    && (au.screen_name || '').toLowerCase() === projectUsername.toLowerCase()
  const avatar =
    (au.avatar_image_url || '').replace(/_normal\.(jpg|png|jpeg|webp|gif)/i, '_400x400.$1') ||
    '/round-logo.png'
  return {
    id: tw.tweet_id || `xd-${index}`,
    user: au.name || au.screen_name || 'Unknown',
    handle: `@${au.screen_name || ''}`,
    avatar: avatar || '/round-logo.png',
    verified: !!au.is_blue_verified || !!au.legacy_verified || isFromProject,
    verifiedType: isFromProject ? 'business' : (au.is_blue_verified ? 'blue' : null),
    content: text,
    time: tw.created_at_utc || 'now',
    likes: tw.favorite_count || 0,
    retweets: tw.retweet_count || 0,
    replies: tw.reply_count || 0,
    views: Number.isFinite(tw.views_count) ? tw.views_count : undefined,
    replyingTo: undefined,
    replyingToAll: undefined,
    _isFromProject: isFromProject,
    _isRetweet: isRetweet,
    _isReply: isReply,
    _followers: au.followers_count || 0,
    _xUrl: tw.x_url || null,
    _fromXDash: true,
  }
}

const LeftPanel = ({ chartViewMode, setChartViewMode, watchlist, addToWatchlist, removeFromWatchlist, togglePinWatchlist, reorderWatchlist, selectToken, token, mobileSection, layoutParts }) => {
  // Zone Stacks sub-parts: 'feed' = X/Watchlist tabs card, 'screener' =
  // Trending/Top Coins explorer. Reorder via flex `order`, hide via
  // display:none - nothing re-parents.
  const _lp = layoutParts || { order: ['feed', 'screener'], hidden: [] }
  const lpPartStyle = (id) => ({
    order: Math.max(0, _lp.order.indexOf(id)),
    display: _lp.hidden.includes(id) ? 'none' : undefined,
  })
  const { triggerCopyToast } = useCopyToast()
  const [mainTab, setMainTabState] = useState(() => {
    const saved = localStorage.getItem('spectre-left-panel-tab')
    // The mobile Social view has no watchlist - the phone shell owns that as
    // its own bottom-nav screen - so a persisted 'watchlist' would open this
    // view on a tab whose button isn't even rendered here.
    if (mobileSection === 'social' && saved === 'watchlist') return 'x'
    // A persisted Watchlist tab with an EMPTY watchlist renders a dead black
    // panel (fresh visitors / signed-out sessions). Fall back to the X feed,
    // which always has content for the selected token.
    if (saved === 'watchlist') {
      try {
        const wl = JSON.parse(localStorage.getItem('spectre-watchlist') || '[]')
        if (!Array.isArray(wl) || wl.length === 0) return 'x'
      } catch { return 'x' }
    }
    return saved || 'x'
  })
  const setMainTab = (tab) => {
    setMainTabState(tab)
    localStorage.setItem('spectre-left-panel-tab', tab)
  }
  const [filter, setFilter] = useState('Project Posts')
  const [aiLogFilter, setAiLogFilter] = useState('all')
  const [aiFilterTooltip, setAiFilterTooltip] = useState({ visible: false, text: '', x: 0, y: 0 })
  const [brainLogs, setBrainLogs] = useState([])
  const [fullViewMode, setFullViewMode] = useState(false)
  const [selectedTweetId, setSelectedTweetId] = useState(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [showScrollToTweet, setShowScrollToTweet] = useState(false)
  const [tweetInteractions, setTweetInteractions] = useState({}) // Track liked, retweeted, replied
  const [replyModal, setReplyModal] = useState({ open: false, tweet: null })
  const [replyText, setReplyText] = useState('')
  const [comingSoonTooltip, setComingSoonTooltip] = useState({ visible: false, text: '', x: 0, y: 0, position: 'left' })
  const [trendingTimeframe, setTrendingTimeframe] = useState('volume')
  const [trendingChain, setTrendingChain] = useState('all')
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)
  const chainDropdownRef = useRef(null)
  const tweetFailCountRef = useRef(0)
  const lastTokenKeyRef = useRef(null)

  // Close chain dropdown on click outside
  useEffect(() => {
    if (!chainDropdownOpen) return
    const close = (e) => { if (chainDropdownRef.current && !chainDropdownRef.current.contains(e.target)) setChainDropdownOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [chainDropdownOpen])

  // AI Logs: pull Brain signals + annotations for the active token from the Dossier API.
  // Server may be offline — failures are swallowed and the empty state renders.
  useEffect(() => {
    const nid = Number(token?.networkId)
    const ca = (token?.address || '').toLowerCase()
    const chain = nid === 1 ? 'eth' : nid === 8453 ? 'base' : nid === 42161 ? 'arb' : nid === 137 ? 'poly' : nid === 56 ? 'bsc' : nid === 1399811149 ? 'sol' : null
    if (!chain || !ca) { setBrainLogs([]); return }
    let cancelled = false
    const rel = (ts) => {
      if (!ts) return ''
      const sec = Math.round((Date.now() - ts) / 1000)
      if (sec < 60) return `${sec}s ago`
      if (sec < 3600) return `${Math.round(sec / 60)}m ago`
      if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
      return `${Math.round(sec / 86400)}d ago`
    }
    const sigCat = (k) => (k === 'trending_gainer' ? 'x' : 'onchain')
    const titleize = (k) => String(k || 'signal').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    // 2026-06-03 COST WAR HARD-DISABLE: every trading-app mount (including
    // the /token iframe) was hitting srv.spectreai.io for dossier data.
    // OVH server was firing filterTokens with heavy field selection on
    // each call -> Codex lockstep -> ~580K ops/day on the new key.
    // Set kill switch to true to stop the bleed at the source. Re-enable
    // ONLY after OVH's packages/server/index.js filterTokens queries are
    // shrunk to match PR #735 pattern (drop volume24/liquidity/marketCap
    // /holders/change* from the selection, rank server-side instead).
    const KILL_OVH_DOSSIER = true
    const dossierApiBase = KILL_OVH_DOSSIER ? '' : import.meta.env.VITE_DOSSIER_API
    if (!dossierApiBase) { setBrainLogs([]); return }
    const dossierBase = dossierApiBase + '/api/dossier'
    const load = async () => {
      try {
        const [sRes, aRes] = await Promise.allSettled([
          fetch(`${dossierBase}/signals?chain=${chain}&limit=50`).then((r) => (r.ok ? r.json() : { signals: [] })),
          fetch(`${dossierBase}/_brain/annotations?chain=${chain}&limit=15`).then((r) => (r.ok ? r.json() : { annotations: [] })),
        ])
        if (cancelled) return
        const sigs = sRes.status === 'fulfilled' ? (sRes.value.signals || []).filter((x) => (x.ca || '').toLowerCase() === ca) : []
        const anns = aRes.status === 'fulfilled' ? (aRes.value.annotations || []).filter((x) => (x.ca || '').toLowerCase() === ca) : []
        const merged = [
          ...sigs.map((s) => ({
            category: sigCat(s.kind),
            level: 'signal',
            title: titleize(s.kind),
            message: s.narrative || '',
            time: rel(s.detectedAt),
            confidence: s.score != null ? `${Math.round(Number(s.score))}%` : null,
            ts: s.detectedAt || 0,
          })),
          ...anns.map((a) => ({
            category: a.kind === 'warning' ? 'onchain' : 'ta',
            level: a.kind === 'warning' ? 'alert' : 'info',
            title: a.kind === 'warning' ? 'Brain Warning' : a.kind === 'thesis' ? 'Brain Thesis' : 'Brain Take',
            message: a.body || '',
            time: rel(a.createdAt),
            confidence: a.confidence != null ? `${Math.round(Number(a.confidence) * 100)}%` : null,
            ts: a.createdAt || 0,
          })),
        ].sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, 20)
        setBrainLogs(merged)
      } catch (_) { /* dossier API offline — leave logs empty */ }
    }
    load()
    const iv = setInterval(() => { if (document.hidden || !isAppActive()) return; load() }, 30000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [token?.address, token?.networkId])

  const trendingChainIds = TRENDING_CHAINS.find(c => c.value === trendingChain)?.networkIds ?? TRENDING_CHAINS[0].networkIds
  // Phase F: 120s poll matches the server-side 2min trending cache TTL.
  // Pre-Phase-F polled at 60s — half the polls returned the same stale
  // cached payload, wasting a Codex roundtrip every other tick.
  const { tokens: trendingTokens, loading: trendingLoading, error: trendingError, refresh: refreshTrending } = useTrendingTokens(120000, trendingChainIds, trendingTimeframe)

  // Live watchlist data state
  const [liveWatchlistData, setLiveWatchlistData] = useState({})
  const [watchlistLoading, setWatchlistLoading] = useState(false)
  // Sparkline 24h price data per token { [address]: number[] }
  const [sparklinePrices, setSparklinePrices] = useState({})
  // Full-screen watchlist overlay
  const [watchlistFullScreen, setWatchlistFullScreen] = useState(false)

  // X/Twitter tweets state
  const [apiTweets, setApiTweets] = useState([])
  const [twitterAuthor, setTwitterAuthor] = useState(null)
  const [tweetsLoading, setTweetsLoading] = useState(false)
  const [tweetsError, setTweetsError] = useState(null)
  
  // Fetch live data for watchlist tokens - Codex API only (single source of truth)
  const fetchWatchlistData = useCallback(async () => {
    if (!watchlist || watchlist.length === 0) {
      setLiveWatchlistData({})
      return
    }

    setWatchlistLoading(true)

    try {
      const dataMap = {}

      // Split: Codex batch prices for major tokens, Codex details for the rest
      const majors = watchlist.filter(t => MAJOR_TOKEN_ADDR[(t.symbol || '').toUpperCase()])
      const others = watchlist.filter(t => !MAJOR_TOKEN_ADDR[(t.symbol || '').toUpperCase()])

      // Codex batch prices for majors (single request via getTokenPrices)
      const majorsTask = (async () => {
        if (majors.length === 0) return
        try {
          const inputs = [...new Map(majors.map(t => {
            const m = MAJOR_TOKEN_ADDR[t.symbol.toUpperCase()]
            return [m.address.toLowerCase(), { address: m.address, networkId: m.networkId }]
          })).values()]
          const prices = await getTokenPricesBatch(inputs)
          const priceMap = {}
          for (const p of prices) { if (p?.address) priceMap[p.address.toLowerCase()] = p }
          for (const t of majors) {
            const m = MAJOR_TOKEN_ADDR[t.symbol.toUpperCase()]
            const p = priceMap[m.address.toLowerCase()]
            if (p) {
              dataMap[(t.address || '').toLowerCase()] = {
                address: (t.address || '').toLowerCase(),
                price: parseFloat(p.priceUsd) || 0,
                change: 0,
                marketCap: 0,
                liquidity: 0,
                volume24: 0,
                logo: '',
              }
            }
          }
        } catch (_) { /* Codex batch failed - majors fall through to the details batch below */ }
      })()

      // Phase F: batch the N non-major details into ONE Codex
      // filterTokens query per chain via /api/token/details-batch.
      // Pre-Phase-F this fired N parallel getDetailedTokenInfo calls
      // every 90s = N upstream Codex round-trips per cycle.
      const runDetailsBatch = async (list) => {
        if (!list.length) return
        try {
          const batchResult = await fetchTokenDetailsBatch(
            list.map(t => ({ address: t.address, networkId: t.networkId || 1 }))
          )
          for (const t of list) {
            const addr = (t.address || '').toLowerCase()
            const res = batchResult?.[addr]
            if (res) {
              dataMap[addr] = {
                address: addr,
                price: parseFloat(res.priceUSD || res.price) || 0,
                change: parseFloat(res.change24) || 0,
                marketCap: parseFloat(res.marketCap) || 0,
                liquidity: parseFloat(res.liquidity) || 0,
                volume24: parseFloat(res.volume24 || res.volume24h) || 0,
                logo: res.logo || res.imageUrl || '',
              }
            }
          }
        } catch (_) {
          // Batch failed; fall back to per-token calls so the watchlist
          // still hydrates instead of going completely blank.
          await Promise.allSettled(
            list.map(async (t) => {
              try {
                const res = await getDetailedTokenInfo(t.address, t.networkId || 1)
                if (res) {
                  const addr = (t.address || '').toLowerCase()
                  dataMap[addr] = {
                    address: addr,
                    price: parseFloat(res.priceUSD || res.price) || 0,
                    change: parseFloat(res.change24) || 0,
                    marketCap: parseFloat(res.marketCap) || 0,
                    liquidity: parseFloat(res.liquidity) || 0,
                    volume24: parseFloat(res.volume24 || res.volume24h) || 0,
                    logo: res.logo || res.imageUrl || '',
                  }
                }
              } catch (_) { /* skip this token */ }
            })
          )
        }
      }

      // The non-major details batch doesn't depend on the majors price batch -
      // run both CONCURRENTLY (they were sequential awaits, so any watchlist
      // containing one major serialized two upstream round-trips). Majors the
      // price batch missed get a small follow-up details batch (rare path).
      await Promise.all([majorsTask, runDetailsBatch(others)])
      const missedMajors = majors.filter(t => !dataMap[(t.address || '').toLowerCase()])
      if (missedMajors.length > 0) await runDetailsBatch(missedMajors)

      setLiveWatchlistData(dataMap)
    } catch (err) {
      console.error('Failed to fetch watchlist data:', err)
    } finally {
      setWatchlistLoading(false)
    }
  }, [watchlist])
  
  // Fetch watchlist data on mount and when watchlist changes
  useEffect(() => {
    fetchWatchlistData()
  }, [fetchWatchlistData])

  // 90s polling: SSE price stream covers real-time prices for watchlist tokens
  // already, so this poll only refreshes slower-moving fields (volume, mcap,
  // change). Was 30s, which combined with N non-major tokens calling
  // getDetailedTokenInfo per cycle drove ~2N details/min. See PostHog audit
  // 2026-05-18: 5-7 watchlist tokens x 2/min = 10-14 details calls/min,
  // accounting for the majority of steady-state Codex traffic on token pages.
  useAdaptivePolling(fetchWatchlistData, { interval: 90000, enabled: watchlist?.length > 0 })

  // Fetch 24h sparkline bars for watchlist tokens (non-blocking, parallel)
  const fetchSparklines = useCallback(async () => {
    if (!watchlist || watchlist.length === 0) return
    const results = {}
    await Promise.allSettled(
      watchlist.map(async (t) => {
        const prices = await fetchSparklineBars(t.address, t.networkId || 1)
        if (prices) results[(t.address || '').toLowerCase()] = prices
      })
    )
    if (Object.keys(results).length > 0) {
      setSparklinePrices(prev => ({ ...prev, ...results }))
    }
  }, [watchlist])

  // Sparklines are decorative list chrome — defer the initial fetch until
  // the main thread is idle so the dozen+ sparkline /api/bars calls don't
  // queue ahead of the token page's critical chart-bars request on the
  // HTTP/1.1 6-connection pool. Polling (120s) stays as-is — it only runs
  // long after first paint.
  useEffect(() => {
    const cancel = whenIdle(() => fetchSparklines())
    return cancel
  }, [fetchSparklines])
  // 5 min: matches the client sparkline TTL (15m bars - see sparklineFetch.js).
  useAdaptivePolling(fetchSparklines, { interval: 300000, enabled: watchlist?.length > 0 })

  // Hover-prefetch chart bars AND trades: 200ms dwell on a row warms that token.
  // No session Set - both prefetchers are TTL-aware, so repeat hovers on a
  // fresh entry are a free no-op while hovers on an EXPIRED entry re-warm.
  //
  // Trades were added here 2026-08-04. prefetchLatestTrades already existed but
  // every call site was in App.jsx, i.e. at SELECT time - so the ~430ms trades
  // request only started once the user had already clicked, and Transactions
  // was visibly the last panel to fill. The chart had this head start and the
  // tape did not. Warming both on the same dwell means the request is usually
  // done before the click lands.
  const hoverPrefetchTimerRef = useRef(null)
  const handleRowHover = useCallback((t) => {
    if (!t?.address) return
    clearTimeout(hoverPrefetchTimerRef.current)
    hoverPrefetchTimerRef.current = setTimeout(() => {
      const nid = inferNetworkId(t.address, t.networkId)
      prefetchChartBars(t.address, nid)
      prefetchLatestTrades(t.address, nid)
    }, 200)
  }, [])
  const handleRowHoverEnd = useCallback(() => {
    clearTimeout(hoverPrefetchTimerRef.current)
  }, [])

  // Background KEEP-warm: trending rows + the open watchlist are the page's
  // main token-switch surfaces. Warm their chart bars (saved TF) on idle,
  // then re-warm on a cadence just under the 5-min bars-cache TTL, so a
  // click paints candles from client cache in ms no matter when it happens
  // (the old top-8/once-per-session pass decayed after 5 minutes and late
  // clicks fell back to the 1.5-4s cold Codex fetch - the "chart takes
  // 3-4s" report). prewarmChartBarsList is TTL-aware (fresh entries free),
  // hidden/idle-gated, 350ms-staggered, capped at 20 per surface. Watchlist
  // warms only while its tab is open (that's the click-intent signal).
  // CHURN GUARD (same as TokenTicker): effects key on the joined ADDRESS
  // SET, not list identity - polls re-set state with fresh arrays even when
  // the content didn't change, and an identity-keyed effect cancels the
  // staggered warm pass before it completes. Latest lists read via refs.
  const trendingTokensRef = useRef(trendingTokens)
  trendingTokensRef.current = trendingTokens
  const trendingAddressesKey = (trendingTokens || []).map(t => t?.address || '').join(',')
  const trendingPrewarmCancelRef = useRef(null)
  const runTrendingPrewarm = useCallback(() => {
    trendingPrewarmCancelRef.current?.()
    trendingPrewarmCancelRef.current = prewarmChartBarsList(trendingTokensRef.current || [], { visibleOnly: true })
  }, [])
  useEffect(() => {
    if (!trendingAddressesKey) return undefined
    let cancelled = false
    let cancelIdle = null
    // COLD-BOOT HOLD-OFF: mirror TokenTicker's guard - the first pass waits
    // until the page is ~15s old so this warm (plus the ticker's twin) never
    // storms /api/bars while the active token's chart is doing its own cold
    // load (measured ~40 cold wide fetches in the first 9s pre-guard).
    // The 3.5s floor guards the OTHER entry: LeftPanel mounts when the user
    // ENTERS the token view, and on a page already past 15s the page-age hold
    // is zero - measured on prod 2026-08-04, welcome -> token on a 65s-old
    // page kicked 6 warm bars fetches right into the active token's critical
    // window (its own bars took 1213ms vs ~700 solo). 3.5s clears that window;
    // the warm's value is for the NEXT click, so starting late costs nothing.
    const holdOff = Math.max(15_000 - performance.now(), 3500)
    const holdTimer = setTimeout(() => {
      if (cancelled) return
      cancelIdle = whenIdle(() => { if (!cancelled) runTrendingPrewarm() }, { timeout: 4000 })
    }, holdOff)
    return () => { cancelled = true; clearTimeout(holdTimer); cancelIdle?.() }
  }, [trendingAddressesKey, runTrendingPrewarm])
  useEffect(() => () => { trendingPrewarmCancelRef.current?.() }, [])
  useAdaptivePolling(runTrendingPrewarm, { interval: 240000, enabled: trendingAddressesKey.length > 0 })

  const watchlistRef = useRef(watchlist)
  watchlistRef.current = watchlist
  const watchlistAddressesKey = (watchlist || []).map(t => t?.address || '').join(',')
  const watchlistPrewarmCancelRef = useRef(null)
  const runWatchlistPrewarm = useCallback(() => {
    watchlistPrewarmCancelRef.current?.()
    watchlistPrewarmCancelRef.current = prewarmChartBarsList(watchlistRef.current || [], { visibleOnly: true })
  }, [])
  const watchlistPrewarmActive = mainTab === 'watchlist' && watchlistAddressesKey.length > 0
  useEffect(() => {
    if (!watchlistPrewarmActive) return undefined
    let cancelled = false
    let cancelIdle = null
    // Same cold-boot hold-off as the trending pass (watchlist tab can be the
    // boot default for returning users), same 3.5s mount floor (see above).
    const holdOff = Math.max(15_000 - performance.now(), 3500)
    const holdTimer = setTimeout(() => {
      if (cancelled) return
      cancelIdle = whenIdle(() => { if (!cancelled) runWatchlistPrewarm() }, { timeout: 3000 })
    }, holdOff)
    return () => { cancelled = true; clearTimeout(holdTimer); cancelIdle?.() }
  }, [watchlistPrewarmActive, watchlistAddressesKey, runWatchlistPrewarm])
  useEffect(() => () => { watchlistPrewarmCancelRef.current?.() }, [])
  useAdaptivePolling(runWatchlistPrewarm, { interval: 240000, enabled: watchlistPrewarmActive })

  // Fetch token details to get socials (uses shared cache — usually instant)
  // STATIC lane on purpose: this panel reads only tokenDetails.address and
  // .socials.twitter (see the socials resolver just below) - never the live
  // price. On the shared hook it re-rendered all 2,662 lines up to 3x/second
  // for a value that changes once a minute.
  const { tokenData: tokenDetails } = useTokenDetailsStatic()

  // Extract Twitter/X username from token socials.
  //
  // Priority chain:
  //   1. tokenDetails.socials.twitter (Codex authoritative source) when
  //      its address matches the current token.
  //   2. token.socials.twitter — the token payload provided at click
  //      time by the search/watchlist/palette. This is the SPEEDUP
  //      path: without it, the tweet fetch would idle until Codex
  //      getDetailedTokenInfo returns (1-2s typical) before issuing
  //      its first request. With it, the fetch fires immediately on
  //      token switch.
  //
  // The previous version deliberately ignored token.socials.twitter to
  // dodge the App-level defaultToken spread bleeding SPECTRE's twitter
  // into unrelated tokens. That bleed is now stripped in App.jsx's
  // spreadDefault helper, so token.socials.twitter is safe to trust.
  const twitterUsername = useMemo(() => {
    const detailsAddr = tokenDetails?.address?.toLowerCase?.() || null
    const tokenAddr = token?.address?.toLowerCase?.() || null
    const sameToken = detailsAddr && tokenAddr && detailsAddr === tokenAddr
    const twitter = (sameToken && tokenDetails?.socials?.twitter) || token?.socials?.twitter || null
    if (!twitter) return null
    // Handle full URLs: https://twitter.com/username or https://x.com/username
    const urlMatch = twitter.match(/(?:twitter\.com|x\.com)\/(@?)([\w]+)/i)
    if (urlMatch) return urlMatch[2]
    // Handle bare @handle or handle
    const bare = twitter.replace(/^@/, '').trim()
    return bare || null
  }, [tokenDetails?.address, tokenDetails?.socials?.twitter, token?.address, token?.socials?.twitter])

  // KNOWN GAP: We cannot detect self-replies (where the project replies to its
  // own tweet without an @handle prefix). The upstream API doesn't forward
  // `in_reply_to_tweet_id` / `conversation_id`, so tweets like
  // https://x.com/Spectre__AI/status/2042210023409881464 render as Project
  // Posts instead of Replies. Blocked on Alaa's X API adding the field.
  //
  // Transform a raw tweet from the API into our internal format
  const tokenLogoRef = useRef(token?.logo)
  tokenLogoRef.current = token?.logo
  const transformTweet = useCallback((tweet, index, projectUsername, author) => {
    const tweetUser = (tweet.username || tweet.user || '').trim()
    const tweetText = decodeHtmlEntities((tweet.tweet_text || tweet.content || tweet.text || '').trim())

    const isRetweet = tweetText.startsWith('RT @') || tweetText.startsWith('rt @')
    const isReply = !isRetweet && tweetText.startsWith('@')
    const isFromProject = projectUsername && tweetUser.toLowerCase() === projectUsername.toLowerCase()

    let replyingTo = undefined
    let replyingToAll = undefined
    if (isReply) {
      // Extract the full leading mention chain — a reply in a multi-user
      // thread starts with "@user1 @user2 @user3 message..." and we need all
      // of them to properly link thread-context parent tweets.
      const chainMatch = tweetText.match(/^((?:@\w+\s+)+)/)
      if (chainMatch) {
        const handles = chainMatch[1].trim().split(/\s+/).filter(h => h.startsWith('@'))
        if (handles.length > 0) {
          replyingTo = handles[0]
          replyingToAll = handles
        }
      }
    }

    // Handle media - collect every attached photo (X posts carry up to 4),
    // not just the first one
    let media = null
    if (Array.isArray(tweet.media) && tweet.media.length > 0) {
      const withUrl = tweet.media.filter(m => m && (m.media_url_https || m.media_url))
      if (withUrl.length > 0) {
        media = {
          type: (withUrl[0].type === 'video' || tweet.media_type === 'video') ? 'video' : 'image',
          url: withUrl[0].media_url_https || withUrl[0].media_url,
          urls: withUrl.slice(0, 4).map(m => m.media_url_https || m.media_url)
        }
      }
    }
    if (!media && tweet.media_url_https) {
      media = {
        type: tweet.media_type === 'video' ? 'video' : 'image',
        url: tweet.media_url_https,
        urls: [tweet.media_url_https]
      }
    }

    // Author verification - X marks organizations (gold badge) with
    // verified_type 'Business', but the upstream scraper often leaves that
    // null. Orgs are the only accounts with SQUARE avatars on X, so
    // profile_image_shape === 'Square' recovers the gold badge reliably.
    const authorVerifiedType = (
      author?.verified_type
      || author?.account_state?.verified_type
      || (author?.account_state?.profile_image_shape === 'Square' ? 'business' : null)
      || (author?.account_state?.is_blue_verified ? 'blue' : null)
      || null
    )?.toString().toLowerCase() || null

    const transformed = {
      id: tweet.tweet_id || tweet.id || `api-${index}`,
      user: (author?.name && isFromProject) ? author.name : tweetUser,
      handle: `@${tweetUser}`,
      avatar: tweet.ProfilePic || tweet.profile_image || (isFromProject ? (author?.avatar_image_url || tokenLogoRef.current) : null) || '/round-logo.png',
      verified: !!(tweet.is_blue_verified || tweet.verified_type || (isFromProject && authorVerifiedType) || tweet.followers > 100000),
      verifiedType: (tweet.verified_type || '').toLowerCase() || (tweet.is_blue_verified ? 'blue' : null) || (isFromProject ? authorVerifiedType : null),
      // The media permalink X appends to the text is redundant once the
      // media itself renders below - X hides it on x.com too
      content: media ? stripTrailingMediaLink(tweetText) : tweetText,
      time: tweet.date || tweet.created_at || 'now',
      likes: tweet.likes || tweet.like_count || 0,
      retweets: tweet.retweets || tweet.retweet_count || 0,
      replies: tweet.comments || tweet.reply_count || 0,
      replyingTo,
      replyingToAll,
      views: tweet.views ? parseInt(tweet.views, 10) || undefined : undefined,
      _isFromProject: isFromProject,
      _isRetweet: isRetweet,
      _isReply: isReply,
      _followers: tweet.followers || author?.counts?.followers_count || 0
    }
    if (media) transformed.media = media

    // Retweets: render like X does - "<account> reposted" line on top, the
    // ORIGINAL author's identity on the card, and the RT prefix stripped from
    // the text. The original's pfp/name are upgraded later when the source
    // post is found in the result set; until then the handle carries the card.
    if (isRetweet) {
      const rtMatch = tweetText.match(/^RT @(\w+):\s*([\s\S]*)$/i)
      if (rtMatch) {
        transformed._repostedBy = transformed.user
        transformed.user = rtMatch[1]
        transformed.handle = `@${rtMatch[1]}`
        transformed.avatar = null
        transformed.verified = false
        transformed.verifiedType = null
        // Self-repost: the source author IS the project account - keep its
        // identity + gold badge instead of waiting on the profile resolver.
        if (projectUsername && rtMatch[1].toLowerCase() === projectUsername.toLowerCase()) {
          transformed.user = (author?.name) || transformed.user
          transformed.avatar = author?.avatar_image_url || tokenLogoRef.current || null
          transformed.verified = !!authorVerifiedType
          transformed.verifiedType = authorVerifiedType
        }
        transformed.content = media ? stripTrailingMediaLink(rtMatch[2]) : rtMatch[2]
      }
    }

    return transformed
  }, [])

  // Fetch official tweets + community/influencer search tweets
  const fetchOfficialTweets = useCallback(async () => {
    // Detect token switch — clear stale data from previous token immediately
    const tokenKey = token?.address || twitterUsername || null
    const isTokenSwitch = lastTokenKeyRef.current !== tokenKey
    let seeded = false
    if (isTokenSwitch) {
      // Instant paint: reuse this token's last fetched feed (30-min session
      // seed) instead of blanking the panel for the multi-second refetch.
      // The network revalidation below replaces it when fresh data lands.
      const seed = readFeedSeed(tokenKey)
      if (seed) {
        setApiTweets(seed.tweets)
        setTwitterAuthor(seed.author || null)
        seeded = true
      } else {
        setApiTweets([])
        setTwitterAuthor(null)
      }
      setTweetsError(null)
      tweetFailCountRef.current = 0
      lastTokenKeyRef.current = tokenKey
    }

    // Handle-less tokens (e.g. pump.fun launches with no official X account)
    // still surface community tweets via the cashtag search below — only bail
    // when we have neither an official handle NOR a symbol to search on.
    const searchQuery = token?.symbol ? `$${token.symbol}` : null
    if (!twitterUsername && !searchQuery) {
      setTweetsLoading(false)
      return
    }

    // Backoff: skip polls after consecutive failures (only when NOT a token switch)
    if (!isTokenSwitch && tweetFailCountRef.current >= 2) {
      tweetFailCountRef.current--
      return
    }

    if (!seeded) setTweetsLoading(true)
    setTweetsError(null)

    try {
      // Fetch official tweets (only when we have a handle) + the cashtag
      // search in parallel. Indices are tracked so a missing official fetch
      // doesn't shift the search result. The official leg goes through the
      // shared lowercased-key cache (fetchOfficialFeed) so this feed,
      // useXProfile (identity-card banner) and the RT-author resolver
      // collapse to ONE request per handle - `Spectre__AI` vs `spectre__ai`
      // used to fire the endpoint twice on every token-page mount.
      const searchUrl = searchQuery
        ? `/api/tweets/search?query=${encodeURIComponent(searchQuery)}`
        : null

      const fetches = []
      const officialIdx = twitterUsername ? fetches.push(fetchOfficialFeed(twitterUsername)) - 1 : -1
      const searchIdx = searchUrl ? fetches.push(fetch(searchUrl)) - 1 : -1

      // Progressive first paint - each upstream can take seconds cold, and
      // awaiting both means the panel waits for the SLOWER one. Whichever
      // source resolves first paints immediately; the fully merged +
      // enriched set below replaces it. Skipped when a seed already painted
      // (a partial would downgrade a full cached feed). Responses are
      // clone()d so the main flow can still consume the original bodies.
      let painted = false
      const paintPartial = (tweets) => {
        if (painted || seeded || tweets.length === 0 || lastTokenKeyRef.current !== tokenKey) return
        painted = true
        setApiTweets(tweets)
        setTweetsLoading(false)
      }
      if (officialIdx >= 0) {
        fetches[officialIdx].then((d) => {
          if (!d) return
          const au = d?.author || null
          const arr = Array.isArray(d) ? d : d?.tweets || d?.data || []
          paintPartial(arr.map((t, i) => transformTweet(t, i, twitterUsername, au)))
        }).catch(() => { /* partial paint is best-effort */ })
      }
      if (searchIdx >= 0) {
        fetches[searchIdx].then(async (r) => {
          if (!r.ok) return
          const d = await r.clone().json()
          const arr = Array.isArray(d) ? d : d?.tweets || d?.data || []
          paintPartial(arr.map((t, i) => transformTweet(t, `search-${i}`, twitterUsername, null)))
        }).catch(() => { /* partial paint is best-effort */ })
      }

      const results = await Promise.allSettled(fetches)

      // Process official tweets (skipped entirely when there's no handle).
      // fetchOfficialFeed resolves parsed JSON or null (its own try/catch),
      // so fulfilled-with-null is the failure branch here.
      let officialTweets = []
      let author = null
      const officialRes = officialIdx >= 0 ? results[officialIdx] : null
      if (officialRes && officialRes.status === 'fulfilled' && officialRes.value) {
        const data = officialRes.value
        author = data.author || null
        const tweetsArray = Array.isArray(data) ? data : data?.tweets || data?.data || []
        officialTweets = tweetsArray.map((t, i) => transformTweet(t, i, twitterUsername, author))
        setTwitterAuthor(author)
      } else if (officialRes) {
        // Official-tweets upstream (get_official_tweets Cloud Run) failed or the
        // request rejected (a known-flaky backend - 502/404). It's non-critical,
        // so DON'T throw: throwing here also dropped the community/cashtag search
        // tweets below and logged a console error on top of the browser's own
        // failed-request line. Leave officialTweets empty and carry on.
      }

      // Process search/community tweets
      let searchTweets = []
      if (searchIdx >= 0) {
        const searchRes = results[searchIdx]
        if (searchRes.status === 'fulfilled' && searchRes.value.ok) {
          const data = await searchRes.value.json()
          const tweetsArray = Array.isArray(data) ? data : data?.tweets || data?.data || []
          // Deduplicate: skip tweets already in official list
          const officialIds = new Set(officialTweets.map(t => t.id))
          // Pass the official author through - project posts surfaced by the
          // cashtag search then carry the org identity (name, avatar, gold
          // badge) instead of the bare search-record username.
          searchTweets = tweetsArray
            .map((t, i) => transformTweet(t, `search-${i}`, twitterUsername, author))
            .filter(t => !officialIds.has(t.id))
        }
      }

      // Fallback: tokens the tweets-search API doesn't cover (handle-less
      // pump.fun launches like $ANSEM) return zero tweets above, yet X Dash
      // tracks their mentions. Pull those as community tweets — but only when
      // we can resolve a cg_id WITHOUT an ambiguous symbol search (an explicit
      // override or a known token.cgId), so we never attribute the wrong
      // project's chatter to this token.
      if (officialTweets.length === 0 && searchTweets.length === 0 && token?.symbol) {
        try {
          const xdToken = withXDashCgId(token)
          const directCgId = xdToken?.cgId ? String(xdToken.cgId).toLowerCase() : null
          if (directCgId) {
            const intel = await getTokenIntel(directCgId)
            const mentions = intel?.top_mentions || intel?.mentions || []
            if (Array.isArray(mentions) && mentions.length > 0) {
              searchTweets = mentions
                .map((m, i) => xdashMentionToTweet(m, i, twitterUsername))
                .filter((t) => t && t.id && t.content)
            }
          }
        } catch (xdErr) {
          console.warn('[LeftPanel] X Dash mention fallback failed:', xdErr.message)
        }
      }

      const allTweets = [...officialTweets, ...searchTweets]

      // Enrich retweets with source-post engagement metrics.
      // The upstream API returns the RT wrapper record with likes/comments = 0
      // (because those belong to the source post, not the retweet action).
      // When the source post is also in our result set, copy its metrics over
      // so users see real engagement instead of 0 0 0.
      // t.co links stripped before keying - the RT wrapper keeps the media
      // permalink in its text while the source post has it stripped (media
      // rendered), and the two must still match.
      const textKey = (s) => (s || '').trim().replace(/https?:\/\/t\.co\/\w+/gi, '').replace(/\s+/g, ' ').slice(0, 100).toLowerCase()
      const originalsByText = new Map()
      for (const t of allTweets) {
        if (!t._isRetweet && t.content) {
          originalsByText.set(textKey(t.content), t)
        }
      }
      for (const t of allTweets) {
        if (!t._isRetweet) continue
        // transformTweet already strips the "RT @x:" prefix for parsed RTs
        // (_repostedBy set); older/unparsed shapes still carry it inline.
        const m = t._repostedBy ? [null, t.content] : t.content.match(/^RT @\w+:\s*([\s\S]*)$/i)
        if (!m) continue
        const orig = originalsByText.get(textKey(m[1]))
        if (!orig) continue
        t.likes = orig.likes
        t.retweets = orig.retweets
        t.replies = orig.replies
        if (orig.views !== undefined) t.views = orig.views
        t._sourceTweetId = orig.id
        t._sourceHandle = orig.handle
        // Upgrade the card to the original author's full identity - but only
        // when the matched source is really the account named in the RT
        // prefix (text-only matches can cross accounts on copy-pasta).
        if (t._repostedBy && orig.handle && orig.handle.toLowerCase() === t.handle.toLowerCase()) {
          t.user = orig.user
          t.avatar = orig.avatar
          t.verified = orig.verified
          t.verifiedType = orig.verifiedType
          t.time = orig.time
          if (orig.media && !t.media) t.media = orig.media
          t.content = orig.content
        }
      }

      // Attach project replies to the tweets they reply to, so users can see
      // why a third-party post is in the feed (e.g. Spectre replied to it).
      // The upstream API doesn't expose in_reply_to_tweet_id, so we match on
      // handle only — may cross-thread occasionally but is the best we can do.
      const projectRepliesByHandle = new Map()
      const nonProjectByHandle = new Map()
      for (const t of allTweets) {
        if (t._isFromProject && t._isReply) {
          // Index by EVERY handle in the leading mention chain so thread
          // replies with multiple @tagged users match all their parents.
          const chain = t.replyingToAll || (t.replyingTo ? [t.replyingTo] : [])
          for (const h of chain) {
            const key = h.toLowerCase()
            if (!projectRepliesByHandle.has(key)) projectRepliesByHandle.set(key, [])
            projectRepliesByHandle.get(key).push(t)
          }
        }
        if (!t._isFromProject && t.handle) {
          const key = t.handle.toLowerCase()
          if (!nonProjectByHandle.has(key)) nonProjectByHandle.set(key, [])
          nonProjectByHandle.get(key).push(t)
        }
      }
      // Non-project tweets get "project replied to this" context.
      // Also flag whether the tweet organically mentions the project — used
      // below to filter out posts that are only in the feed because the
      // project replied to them (thread context, not genuine mention).
      // Build a mention-detection regex for the project handle + token symbol.
      // Escape regex metacharacters AND reject placeholder values like '...'
      // (deep-link token state uses that until real data loads — otherwise
      // '.' in the regex acts as a wildcard and matches random price strings
      // like "$11.36" in unrelated tweets).
      const escapeRe = (s) => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const projHandle = (twitterUsername || '').toLowerCase()
      const rawSym = (token?.symbol || '').toUpperCase()
      const symUpper = /^[A-Z0-9]{2,15}$/.test(rawSym) ? rawSym : ''
      const mentionRegex = projHandle
        ? new RegExp(
            `@${escapeRe(projHandle)}\\b${symUpper ? `|\\$${escapeRe(symUpper)}\\b` : ''}`,
            'i'
          )
        : null
      for (const t of allTweets) {
        if (t._isFromProject) continue
        const matched = projectRepliesByHandle.get(t.handle.toLowerCase())
        if (matched && matched.length > 0) {
          t._projectReplies = matched
        }
        t._mentionsProject = mentionRegex ? mentionRegex.test(t.content || '') : false
      }
      // Project replies get the parent tweet as context (best-effort match)
      for (const t of allTweets) {
        if (!(t._isFromProject && t._isReply && t.replyingTo)) continue
        const candidates = nonProjectByHandle.get(t.replyingTo.toLowerCase())
        if (candidates && candidates.length > 0) {
          // Pick the first candidate — API has no reliable way to match
          // the exact parent tweet when multiple exist from the same handle.
          t._parentTweet = candidates[0]
        }
      }

      setApiTweets(allTweets)
      tweetFailCountRef.current = 0 // Reset backoff on success
      writeFeedSeed(tokenKey, allTweets, author) // instant paint on revisit

      // Verified-badge enrichment - the tweets-search API ships NO
      // verification fields, but X Dash tracks is_blue_verified per author
      // for the token's top mentions. Patch badges in place after first
      // paint (getTokenIntel is 5-min cached, so this is usually instant).
      // Fire-and-forget: never delays the feed render.
      const badgeCandidates = allTweets.some(t => !t.verified && !t._isFromProject && !t._fromXDash)
      if (badgeCandidates && token?.symbol) {
        ;(async () => {
          try {
            const xdToken = withXDashCgId(token)
            const directCgId = xdToken?.cgId ? String(xdToken.cgId).toLowerCase() : null
            if (!directCgId) return
            const intel = await getTokenIntel(directCgId)
            if (lastTokenKeyRef.current !== tokenKey) return // token switched mid-flight
            const mentions = intel?.top_mentions || intel?.mentions || []
            const verifiedByHandle = new Map()
            for (const m of mentions) {
              const au = m?.author
              if (au?.screen_name && (au.is_blue_verified || au.legacy_verified)) {
                verifiedByHandle.set(au.screen_name.toLowerCase(), au.is_blue_verified ? 'blue' : 'legacy')
              }
            }
            if (verifiedByHandle.size === 0) return
            setApiTweets(prev => prev.map(t => {
              if (t.verified || t._isFromProject) return t
              const vt = verifiedByHandle.get((t.handle || '').replace('@', '').toLowerCase())
              return vt ? { ...t, verified: true, verifiedType: vt === 'blue' ? 'blue' : null } : t
            }))
          } catch { /* badge enrichment is best-effort */ }
        })()
      }
    } catch (err) {
      console.error('Failed to fetch tweets:', err)
      tweetFailCountRef.current = Math.min(tweetFailCountRef.current + 3, 6) // Skip next 3 polls
      setTweetsError(err.message)
      // On token switch (or initial load), clear to [] so we never render
      // previous token's tweets. On polling failures for the same token, retain.
      // A seeded feed is THIS token's data - keep it on a transient failure.
      if (isTokenSwitch && !seeded) {
        setApiTweets([])
      } else {
        setApiTweets(prev => prev.length > 0 ? prev : [])
      }
    } finally {
      setTweetsLoading(false)
    }
  }, [twitterUsername, token?.symbol, token?.address])
  
  // Phase E: defer tweet fetch to the moment the user activates the X
  // (social) tab. Pre-Phase E the tweets fetch fired on every token
  // mount regardless of which tab was visible — burning a 500-2000ms
  // upstream call (X Dash API + Codex socials resolution) that the
  // user usually couldn't see. Now the fetch fires only when mainTab
  // === 'x', and the 5min cache makes re-opens instant.
  useEffect(() => {
    if (mainTab !== 'x' && mainTab !== 'xdash') return
    fetchOfficialTweets()
  }, [fetchOfficialTweets, mainTab])

  useAdaptivePolling(fetchOfficialTweets, { interval: 300000, enabled: mainTab === 'x' || mainTab === 'xdash' })

  // Author-profile resolver. Two card defects share one cause - the upstream
  // feeds don't carry author profiles:
  //   1. RT'd authors land with a letter avatar (the RT record only ships the
  //      reposting account).
  //   2. Search-sourced tweets carry ZERO verification fields (confirmed
  //      against /api/tweets/search - no is_blue_verified/verified_type on
  //      any row), so verified authors under 100k followers show no badge.
  // One /api/tweets/official lookup per unique handle (24h localStorage
  // cache) patches both in place. X Dash mentions are excluded - they carry
  // is_blue_verified truth already, so "unverified" there is genuine.
  const rtAuthorAttemptedRef = useRef(new Set())
  useEffect(() => {
    const needing = [...new Set(
      apiTweets
        .filter(t => t.handle && (
          (t._repostedBy && !t.avatar)
          || (!t.verified && !t._isFromProject && !t._fromXDash)
        ))
        .map(t => t.handle.replace('@', ''))
    )].filter(Boolean)
    if (needing.length === 0) return

    // No cancelled flag here on purpose: the effect re-runs on every
    // apiTweets change (badge enrichment, polls), and a cleanup-cancelled
    // apply left cards permanently unpatched - the profile landed in cache
    // but attemptedRef blocked every later application. Patching by handle
    // is idempotent, so applying late is always safe.
    const applyProfile = (handle, profile) => {
      if (!profile) return
      const key = `@${handle.toLowerCase()}`
      setApiTweets(prev => {
        let changed = false
        const next = prev.map(t => {
          if ((t.handle || '').toLowerCase() !== key) return t
          let nt = t
          if (t._repostedBy && !t.avatar && profile.avatar) {
            nt = { ...nt, avatar: profile.avatar, user: profile.name || nt.user, verified: !!profile.verified, verifiedType: profile.verifiedType || null }
          } else if (!t.verified && profile.verified) {
            nt = { ...nt, verified: true, verifiedType: profile.verifiedType || null }
          }
          if (nt !== t) changed = true
          return nt
        })
        // Unchanged pass returns the SAME array - a fresh reference here
        // would re-trigger this effect forever (genuinely unverified authors
        // stay in `needing` by design).
        return changed ? next : prev
      })
    }

    // Cached profiles re-apply on every pass - a poll/enrichment setApiTweets
    // replaces the array with unpatched cards, so this is what heals them.
    // attemptedRef gates only the network fetch below.
    const unresolved = []
    for (const handle of needing) {
      const cached = getCachedRtAuthor(handle)
      if (cached !== undefined) applyProfile(handle, cached)
      else if (!rtAuthorAttemptedRef.current.has(handle.toLowerCase())) unresolved.push(handle)
    }

    const resolveOne = async (handle) => {
      rtAuthorAttemptedRef.current.add(handle.toLowerCase())
      try {
        // Author-only: this resolver reads four fields off `author` and
        // discards the ~40KB timeline the full body ships with. Shared
        // lowercased-key cache - if the main feed (or useXProfile) already
        // pulled this handle, this resolves without a request at all.
        const au = await fetchAuthorProfile(handle)
        if (!au) throw new Error('profile fetch failed')
        const auType = (
          au?.verified_type
          || au?.account_state?.verified_type
          || (au?.account_state?.profile_image_shape === 'Square' ? 'business' : null)
          || (au?.account_state?.is_blue_verified ? 'blue' : null)
          || null
        )?.toString().toLowerCase() || null
        const profile = au ? {
          avatar: (au.avatar_image_url || '').replace(/_normal\.(jpg|png|jpeg|webp|gif)/i, '_400x400.$1') || null,
          name: au.name || null,
          verified: !!auType,
          verifiedType: auType
        } : null
        if (profile && profile.avatar) putCachedRtAuthor(handle, profile)
        else RT_AUTHOR_CACHE.set(handle.toLowerCase(), null)
        applyProfile(handle, profile)
      } catch {
        // session-only negative cache - retries next session, never this one
        RT_AUTHOR_CACHE.set(handle.toLowerCase(), null)
      }
    }

    // Drain the whole queue 4 at a time. Chained (not fire-and-forget per
    // pass) because a batch of genuinely-unverified authors changes no state,
    // so the effect would not re-run to pick up the rest until the next poll.
    //
    // COLD-BOOT HOLD-OFF (2026-08-04): the X tab is the panel's DEFAULT, so on
    // every token open this drained ~17 /api/tweets/official calls (5.9s
    // cumulative, measured on prod) starting the moment the feed landed - all
    // of them purely decorative (an RT avatar, a verified badge), all of them
    // competing for the 6-connection budget with the chart, details and trades
    // the page actually paints from. Wait until the page is past first paint,
    // then drain on idle. Nothing is dropped: the profiles still land, ~3s
    // later, and applyProfile patches the cards in place. Later passes (polls,
    // tab re-opens) see performance.now() past the mark and run immediately.
    const drain = async () => {
      for (let i = 0; i < unresolved.length; i += 4) {
        await Promise.all(unresolved.slice(i, i + 4).map(resolveOne))
      }
    }
    // Only the NOT-YET-STARTED drain is cancellable - once running it must
    // finish. resolveOne -> applyProfile -> setApiTweets re-runs this effect
    // mid-drain, and the re-run finds an EMPTY queue (attemptedRef already
    // holds those handles), so aborting the original loop would strand the
    // rest of it forever. Same reasoning as the applyProfile note above.
    let startCancelled = false
    let cancelIdle = null
    const holdOff = Math.max(0, RT_AUTHOR_BOOT_HOLDOFF_MS - performance.now())
    const holdTimer = setTimeout(() => {
      if (startCancelled) return
      cancelIdle = whenIdle(() => { if (!startCancelled) drain() }, { timeout: 2000 })
    }, holdOff)
    return () => { startCancelled = true; clearTimeout(holdTimer); cancelIdle?.() }
  }, [apiTweets])

  // Get watchlist token with live data merged
  const getWatchlistWithLiveData = useCallback(() => {
    if (!watchlist) return []
    
    return watchlist.map(token => {
      const liveData = token.address ? liveWatchlistData[token.address.toLowerCase()] : null
      
      if (liveData) {
        return {
          ...token,
          price: liveData.price,
          change: liveData.change,
          marketCap: liveData.marketCap,
          liquidity: liveData.liquidity,
          volume24: liveData.volume24,
          logo: liveData.logo || token.logo,
          hasLiveData: true,
        }
      }
      
      return { ...token, hasLiveData: false }
    })
  }, [watchlist, liveWatchlistData])
  const fullViewContentRef = React.useRef(null)
  
  // Toggle tweet interaction (like, retweet, reply)
  const toggleInteraction = (tweetId, type, e) => {
    e.stopPropagation()
    setTweetInteractions(prev => ({
      ...prev,
      [tweetId]: {
        ...prev[tweetId],
        [type]: !prev[tweetId]?.[type]
      }
    }))
  }
  
  // Open reply modal
  const openReplyModal = (tweet, e) => {
    e.stopPropagation()
    setReplyModal({ open: true, tweet })
    setReplyText('')
  }
  
  // Close reply modal
  const closeReplyModal = () => {
    setReplyModal({ open: false, tweet: null })
    setReplyText('')
  }
  
  // Submit reply
  const submitReply = () => {
    if (replyText.trim() && replyModal.tweet) {
      setTweetInteractions(prev => ({
        ...prev,
        [replyModal.tweet.id]: {
          ...prev[replyModal.tweet.id],
          replied: true
        }
      }))
      closeReplyModal()
    }
  }
  
  // ESC key to close full view
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && fullViewMode) {
        setFullViewMode(false)
        setSelectedTweetId(null)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [fullViewMode])

  // Lock body scroll when full view is open
  useEffect(() => {
    if (fullViewMode) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [fullViewMode])

  // Scroll to top when full view opens (to show profile card first)
  useEffect(() => {
    if (fullViewMode) {
      // Always start at top to show profile card
      setTimeout(() => {
        if (fullViewContentRef.current) {
          fullViewContentRef.current.scrollTop = 0
        }
      }, 150)
    }
  }, [fullViewMode])

  // Handle tweet click to open in full view
  const handleTweetClick = (tweetId) => {
    setSelectedTweetId(tweetId)
    setFullViewMode(true)
  }

  // Handle scroll in full view
  const handleFullViewScroll = (e) => {
    const scrollTop = e.target.scrollTop
    setShowScrollTop(scrollTop > 300)
    
    // Show scroll to tweet button only when at the top
    setShowScrollToTweet(scrollTop < 150 && selectedTweetId)
  }

  // Scroll to top
  const scrollToTop = () => {
    fullViewContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Scroll to selected tweet
  const scrollToSelectedTweet = () => {
    const tweetElement = document.getElementById(`tweet-${selectedTweetId}`)
    if (tweetElement) {
      tweetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
  
  // Watchlist filter and sort state
  const [watchlistSort, setWatchlistSort] = useState('default') // 'default', 'priceChangeAsc', 'priceChangeDesc', 'marketCapAsc', 'marketCapDesc'
  const [watchlistSortDropdown, setWatchlistSortDropdown] = useState(false)

  // DexScreener import state
  const [dexImportOpen, setDexImportOpen] = useState(false)
  const [dexImportInput, setDexImportInput] = useState('')
  const [dexImportResults, setDexImportResults] = useState(null) // null = not searched, [] = no results
  const [dexImportLoading, setDexImportLoading] = useState(false)
  const [dexImportSelected, setDexImportSelected] = useState(new Set())

  const parseDexInput = (raw) => {
    // Extract contract addresses from pasted text - handles comma, newline, space separated
    const cleaned = raw.replace(/[,\n\r\t]+/g, ' ').trim()
    if (!cleaned) return []
    return cleaned.split(/\s+/).filter(s => {
      // EVM addresses (0x...) or Solana addresses (base58, 32-50 chars)
      return /^0x[a-fA-F0-9]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(s)
    })
  }

  const lookupDexScreener = async () => {
    const addresses = parseDexInput(dexImportInput)
    if (addresses.length === 0) {
      triggerCopyToast('No valid addresses found')
      return
    }
    setDexImportLoading(true)
    setDexImportResults(null)
    try {
      // DexScreener search API - one call per address, limit to 30
      const batch = addresses.slice(0, 30)
      const results = await Promise.all(
        batch.map(async (addr) => {
          try {
            const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(addr)}`)
            if (!res.ok) return null
            const data = await res.json()
            if (!data.pairs || data.pairs.length === 0) return null
            // Pick the highest-liquidity pair for this token
            const sorted = data.pairs
              .filter(p => p.baseToken.address.toLowerCase() === addr.toLowerCase())
              .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
            const best = sorted[0] || data.pairs[0]
            return {
              address: best.baseToken.address,
              symbol: best.baseToken.symbol,
              name: best.baseToken.name,
              price: parseFloat(best.priceUsd) || 0,
              change: best.priceChange?.h24 || 0,
              marketCap: best.marketCap || best.fdv || 0,
              logo: best.info?.imageUrl || null,
              networkId: DEXSCREENER_CHAIN_MAP[best.chainId] || 1,
              chain: best.chainId,
              liquidity: best.liquidity?.usd || 0,
            }
          } catch { return null }
        })
      )
      const found = results.filter(Boolean)
      // De-duplicate by address
      const seen = new Set()
      const unique = found.filter(t => {
        const key = t.address.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      setDexImportResults(unique)
      // Pre-select all that aren't already in watchlist
      const newSelected = new Set()
      unique.forEach((t, i) => {
        const alreadyIn = watchlist?.some(w =>
          (w.address || '').toLowerCase() === t.address.toLowerCase()
        )
        if (!alreadyIn) newSelected.add(i)
      })
      setDexImportSelected(newSelected)
    } catch (err) {
      console.error('DexScreener lookup failed:', err)
      setDexImportResults([])
    }
    setDexImportLoading(false)
  }

  const importSelectedTokens = () => {
    if (!dexImportResults || !addToWatchlist) return
    let count = 0
    dexImportResults.forEach((token, i) => {
      if (dexImportSelected.has(i)) {
        addToWatchlist({
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          price: token.price,
          change: token.change,
          marketCap: token.marketCap,
          logo: token.logo,
          networkId: token.networkId,
        })
        count++
      }
    })
    triggerCopyToast(`Imported ${count} token${count !== 1 ? 's' : ''}`)
    setDexImportOpen(false)
    setDexImportInput('')
    setDexImportResults(null)
    setDexImportSelected(new Set())
  }
  
  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState(null)
  const [dragOverItem, setDragOverItem] = useState(null)
  const dragNodeRef = useRef(null)

  const filters = ['Project Posts', 'Replies', 'Community', 'KOLs', 'All']

  // Categorize API tweets once (memoised via apiTweets reference)
  const categorized = useMemo(() => {
    if (apiTweets.length === 0) return null

    // A non-project tweet is "organic" if it actually mentions the project
    // (either @handle or $symbol). If it only appears in the feed because the
    // project replied to it, it's thread context — keep it out of the
    // Influencers / Community lists so users don't see unrelated posts.
    const isOrganic = (t) => t._mentionsProject || !t._projectReplies

    // Project Posts: original tweets + retweets from the project account
    const posts = apiTweets.filter(t => t._isFromProject && !t._isReply)
    // Project Replies: replies from the project account
    const replies = apiTweets.filter(t => t._isFromProject && t._isReply)
    // Influencers: not from project, high followers, organic mention
    const influencers = apiTweets.filter(t => !t._isFromProject && (t._followers || 0) >= 10000 && isOrganic(t))
    // Community: not from project, lower followers, organic mention
    const community = apiTweets.filter(t => !t._isFromProject && (t._followers || 0) < 10000 && isOrganic(t))

    return { posts, replies, influencers, community }
  }, [apiTweets])

  // Don't strand the user on an empty "Project Posts" tab: tokens with no
  // official account (handle-less pump.fun launches whose only coverage is
  // community mentions) have zero project posts, so switch to "All" once per
  // token when posts are empty but other buckets carry tweets.
  const autoFilterTokenRef = useRef(null)
  useEffect(() => {
    const key = token?.address || token?.symbol || null
    if (!categorized || !key || apiTweets.length === 0) return
    if (autoFilterTokenRef.current === key) return
    autoFilterTokenRef.current = key
    if (categorized.posts.length === 0 && filter === 'Project Posts') {
      setFilter('All')
    }
  }, [categorized, apiTweets.length, token?.address, token?.symbol, filter])

  // Compute engagement stats from real tweet data
  const profileStats = useMemo(() => {
    if (!twitterAuthor) return null
    const counts = twitterAuthor.counts || {}
    const allProjectTweets = apiTweets.filter(t => t._isFromProject)
    const totalLikes = allProjectTweets.reduce((s, t) => s + (t.likes || 0), 0)
    const totalRTs = allProjectTweets.reduce((s, t) => s + (t.retweets || 0), 0)
    const totalReplies = allProjectTweets.reduce((s, t) => s + (t.replies || 0), 0)
    const totalViews = allProjectTweets.reduce((s, t) => s + (t.views || 0), 0)
    const n = allProjectTweets.length || 1
    const avgLikes = Math.round(totalLikes / n)
    const avgRTs = Math.round(totalRTs / n)
    const avgReplies = Math.round(totalReplies / n)
    const avgViews = Math.round(totalViews / n)
    // Engagement rate: total interactions / (total views or followers * posts)
    const totalInteractions = totalLikes + totalRTs + totalReplies
    const followers = counts.followers_count || 1
    const engagementRate = Math.min(99, Math.round((totalInteractions / (followers * n)) * 10000) / 100)

    // Parse joined date
    const createdAt = twitterAuthor.created_at
    let joinedStr = ''
    if (createdAt) {
      try {
        const d = new Date(createdAt)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        joinedStr = `Joined ${months[d.getMonth()]} ${d.getFullYear()}`
      } catch { joinedStr = '' }
    }

    // Website URL
    const websiteUrl = twitterAuthor.entities?.url?.urls?.[0]?.expanded_url || ''
    const websiteDisplay = twitterAuthor.entities?.url?.urls?.[0]?.display_url || ''

    // Bio with URL mapping for clickable links
    const bioRaw = twitterAuthor.description || ''
    const descUrls = twitterAuthor.entities?.description?.urls || []
    // Build a map: t.co URL → { display, expanded }
    const bioUrlMap = descUrls.map(u => ({
      tco: u.url,
      display: u.display_url || u.expanded_url,
      expanded: u.expanded_url || u.url,
    }))

    return {
      name: twitterAuthor.name || twitterUsername,
      handle: `@${twitterAuthor.screen_name || twitterUsername}`,
      avatar: twitterAuthor.avatar_image_url?.replace('_normal', '_400x400') || token?.logo || '/round-logo.png',
      banner: twitterAuthor.profile_banner_url || '',
      bioRaw,
      bioUrlMap,
      isVerified: twitterAuthor.account_state?.is_blue_verified || false,
      verifiedType: twitterAuthor.verified_type || (twitterAuthor.account_state?.is_blue_verified ? 'blue' : null),
      joinedStr,
      websiteUrl,
      websiteDisplay,
      followers: counts.followers_count || 0,
      following: counts.friends_count || 0,
      posts: counts.statuses_count || 0,
      avgLikes, avgRTs, avgReplies, avgViews,
      engagementRate,
      profileUrl: `https://x.com/${twitterAuthor.screen_name || twitterUsername}`,
    }
  }, [twitterAuthor, apiTweets, twitterUsername, token?.logo])

  // Get tweets based on current filter (real API data only)
  const getTweets = () => {
    if (!categorized) return []
    switch (filter) {
      case 'Project Posts': return categorized.posts
      case 'Replies': return categorized.replies
      case 'KOLs': return categorized.influencers
      case 'Community': return categorized.community
      case 'All': return apiTweets
      default: return categorized.posts
    }
  }

  const tweets = getTweets()

  // Staged reveal - mount only the first few cards on the paint that data
  // lands in, then grow to the full list on idle ticks. Committing ~40
  // media-heavy cards at once is the main perceived lag after data arrives,
  // and the viewport only fits 3-4 anyway. Resets on token/tab switch.
  const [revealCount, setRevealCount] = useState(TWEETS_INITIAL_REVEAL)
  useEffect(() => {
    setRevealCount(TWEETS_INITIAL_REVEAL)
  }, [token?.address, filter, mainTab])
  useEffect(() => {
    if (revealCount >= tweets.length) return
    const grow = () => setRevealCount(c => Math.min(tweets.length, c + 12))
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(grow, { timeout: 200 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(grow, 80)
    return () => clearTimeout(id)
  }, [revealCount, tweets.length])

  // Format price for display
  const formatPrice = (price) => {
    const numPrice = typeof price === 'number' ? price : parseFloat(price)
    if (isNaN(numPrice) || !isFinite(numPrice)) return '$0.00'
    if (numPrice >= 1000) return `$${numPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (numPrice >= 1) return `$${numPrice.toFixed(2)}`
    if (numPrice >= 0.01) return `$${numPrice.toFixed(4)}`
    if (numPrice >= 0.0001) return `$${numPrice.toFixed(6)}`
    return `$${numPrice.toFixed(8)}`
  }

  // Format change for display (API returns values already as percentages, e.g. -2.03 = -2.03%)
  const formatChange = (change) => {
    const numChange = typeof change === 'number' ? change : parseFloat(change)
    if (isNaN(numChange) || !isFinite(numChange)) return '+0.00%'
    return `${numChange >= 0 ? '+' : ''}${numChange.toFixed(2)}%`
  }

  // Format market cap for display
  const formatMarketCap = (marketCap) => {
    if (!marketCap) return '-'
    if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(2)}T`
    if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(2)}B`
    if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(2)}M`
    if (marketCap >= 1e3) return `$${(marketCap / 1e3).toFixed(2)}K`
    return `$${marketCap}`
  }

  // Get sorted watchlist - pinned items always first, with live data
  const getSortedWatchlist = () => {
    const watchlistWithLive = getWatchlistWithLiveData()
    if (!watchlistWithLive || watchlistWithLive.length === 0) return []
    
    // Separate pinned and unpinned
    const pinned = watchlistWithLive.filter(t => t.pinned)
    const unpinned = watchlistWithLive.filter(t => !t.pinned)
    
    // Sort unpinned based on selected sort (using live data)
    let sortedUnpinned = [...unpinned]
    switch (watchlistSort) {
      case 'priceChangeDesc':
        sortedUnpinned.sort((a, b) => (b.change || 0) - (a.change || 0))
        break
      case 'priceChangeAsc':
        sortedUnpinned.sort((a, b) => (a.change || 0) - (b.change || 0))
        break
      case 'marketCapDesc':
        sortedUnpinned.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
        break
      case 'marketCapAsc':
        sortedUnpinned.sort((a, b) => (a.marketCap || 0) - (b.marketCap || 0))
        break
      default:
        break
    }
    
    return [...pinned, ...sortedUnpinned]
  }

  // Drag handlers
  const handleDragStart = (e, index, item) => {
    setDraggedItem({ index, item })
    dragNodeRef.current = e.target
    e.target.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnter = (e, index) => {
    if (draggedItem === null) return
    if (index !== draggedItem.index) {
      setDragOverItem(index)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging')
    
    if (draggedItem !== null && dragOverItem !== null && draggedItem.index !== dragOverItem) {
      const sortedList = getSortedWatchlist()
      const newList = [...sortedList]
      const [removed] = newList.splice(draggedItem.index, 1)
      newList.splice(dragOverItem, 0, removed)
      reorderWatchlist(newList)
    }
    
    setDraggedItem(null)
    setDragOverItem(null)
  }

  const sortedWatchlist = getSortedWatchlist()

  const sortOptions = [
    { value: 'default', label: 'Main Order', iconName: 'menu' },
    { value: 'priceChangeDesc', label: 'Price Change ↓', iconName: 'trending-down' },
    { value: 'priceChangeAsc', label: 'Price Change ↑', iconName: 'trending-up' },
    { value: 'marketCapDesc', label: 'Market Cap ↓', iconName: 'growth' },
    { value: 'marketCapAsc', label: 'Market Cap ↑', iconName: 'analytics' },
  ]

  // Real Brain data when a token is selected; static placeholders only as fallback for the empty state.
  const aiLogs = token?.address && brainLogs.length > 0 ? brainLogs : (token?.address ? [] : [
    { category: 'ta', level: 'signal', title: 'Bullish Pattern Detected', message: 'SPECTRE/ETH forming an ascending triangle', time: '2m ago', confidence: '87%' },
    { category: 'onchain', level: 'alert', title: 'Whale Accumulation', message: 'Large wallet accumulated 500K tokens', time: '15m ago', confidence: null },
    { category: 'x', level: 'info', title: 'X Activity Spike', message: 'Mentions +120% in the last 30 minutes', time: '32m ago', confidence: null },
    { category: 'ta', level: 'signal', title: 'Support Level', message: 'Strong support identified at $1.24', time: '1h ago', confidence: '92%' },
  ])

  const filteredAiLogs = aiLogFilter === 'all'
    ? aiLogs
    : aiLogs.filter((l) => l.category === aiLogFilter)

  const showAiFilterTooltip = (e, text) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setAiFilterTooltip({
      visible: true,
      text,
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    })
  }

  const hideAiFilterTooltip = () => setAiFilterTooltip({ visible: false, text: '', x: 0, y: 0 })

  return (
    <div className="left-panel">
      {/* Main Tabs - X/Watchlist.
          mobileSection (mobile Explore drawer only): 'markets' hides this
          Social card, 'social' shows it. Undefined on desktop -> always shown. */}
      {mobileSection !== 'markets' && (
      <div className="panel-card main-feed lp-part" data-part="feed" style={lpPartStyle('feed')}>
        {/* Icon-only rail - labels live in tooltips; lock badges mark
            Coming-Soon tabs. Keeps all 5 tabs comfortable at 380px. */}
        <div className="panel-tabs panel-tabs--icons">
          <button
            className={`tab ${mainTab === 'x' ? 'active' : ''}`}
            onClick={() => setMainTab('x')}
            title="X Posts"
            aria-label="X Posts"
          >
            <span className="tab-icon">𝕏</span>
          </button>
          {/* Mobile Social view: no watchlist here - the phone shell has its
              own Watchlist screen in the bottom nav, and this panel's desktop
              watchlist rendered majors with no price. */}
          {mobileSection !== 'social' && (
          <button
            className={`tab tab-watchlist ${mainTab === 'watchlist' ? 'active' : ''}`}
            onClick={() => setMainTab('watchlist')}
            title="Watchlist"
            aria-label="Watchlist"
          >
            <span className="tab-icon">
              <Icon name={mainTab === 'watchlist' ? 'heart-filled' : 'heart'} size={20} />
            </span>
          </button>
          )}
          <button
            className="tab tab-ai is-locked"
            aria-disabled="true"
            title="AI Logs (Coming Soon)"
            aria-label="AI Logs (Coming Soon)"
            onClick={() => triggerCopyToast('Coming Soon')}
          >
            <span className="tab-icon">
              <Icon name="ai-agents" size={20} />
            </span>
            <Lock className="tab-lock" size={10} aria-hidden="true" />
          </button>
          {/* X Dash - unlocked everywhere (Sunny, 2026-07-02). Was dev-only
              behind an isDev guard while awaiting review. */}
          <button
            className={`tab tab-xdash ${mainTab === 'xdash' ? 'active' : ''}`}
            onClick={() => setMainTab('xdash')}
            title="X Dash"
            aria-label="X Dash"
          >
            <span className="tab-icon">
              <Radar size={18} aria-hidden="true" />
            </span>
          </button>
          <button
            className="tab tab-social is-locked"
            aria-disabled="true"
            title="Social (Coming Soon)"
            aria-label="Social (Coming Soon)"
            onClick={() => triggerCopyToast('Coming Soon')}
          >
            <span className="tab-icon">
              <Icon name="profile" size={20} />
            </span>
            <Lock className="tab-lock" size={10} aria-hidden="true" />
          </button>
        </div>

        {mainTab === 'x' && (
          <>
            <div className="filter-section">
              <div className="filter-row">
                {filters.map(f => (
                    <button
                      key={f}
                      className={`filter-chip ${filter === f ? 'active' : ''}`}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                <div className="view-mode-buttons">
                  <button
                    className={`view-mode-btn ${fullViewMode ? 'active' : ''}`}
                    onClick={() => {
                      // Desktop-only — the X Intelligence dashboard isn't laid
                      // out for narrow viewports yet. Show a toast instead.
                      if (!fullViewMode && typeof window !== 'undefined' && window.matchMedia) {
                        const isDesktop = window.matchMedia('(min-width: 1200px)').matches
                        if (!isDesktop) {
                          triggerCopyToast('X Intelligence is desktop-only')
                          return
                        }
                      }
                      setFullViewMode(!fullViewMode)
                    }}
                    title={fullViewMode ? "Exit Full View" : "Full View - X Intelligence"}
                  >
                    {fullViewMode ? (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="tweets-feed">
              {tweetsLoading && tweets.length === 0 && (
                <div className="tweets-empty-state">
                  <div className="empty-text">Loading tweets...</div>
                </div>
              )}
              {!tweetsLoading && tweets.length === 0 && tweetsError && (
                <div className="tweets-empty-state">
                  <Icon name="x-twitter" size={24} className="empty-icon" />
                  <div className="empty-text">{tweetsError}</div>
                </div>
              )}
              {tweets.slice(0, revealCount).map((tweet, index) => (
                <div
                  key={tweet.id}
                  className="tweet clickable"
                  /* `.tweet` starts at opacity 0 and fades in on `slideIn`, so
                     this delay is how long a card stays INVISIBLE. At 100ms
                     per index card 20 arrived 2s after mount and card 30 at
                     3s - switching Project Posts/Replies/KOLs re-mounts the
                     whole list (new tweet ids => new keys), so the feed read
                     as "loading" for seconds even though the data was already
                     in memory (the tabs are a pure client-side filter, zero
                     network). Keep the cascade, cap it at ~200ms. */
                  style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}
                  onClick={(e) => {
                    // Don't trigger if user is selecting text
                    const selection = window.getSelection().toString();
                    if (selection && selection.trim().length > 0) {
                      return;
                    }
                    handleTweetClick(tweet.id);
                  }}
                >
                  {/* Repost attribution - who put this on the wire */}
                  {tweet._repostedBy && (
                    <div className="tweet-repost-line">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M4.75 3.79l4.603 4.3-1.706 1.82L6 8.38v7.37c0 .97.784 1.75 1.75 1.75h4.5v2.5h-4.5c-2.347 0-4.25-1.9-4.25-4.25V8.38L1.853 9.91.147 8.09l4.603-4.3zm11.5 2.71h-4.5V4h4.5c2.347 0 4.25 1.9 4.25 4.25v7.37l1.647-1.53 1.706 1.82-4.603 4.3-4.603-4.3 1.706-1.82L18 15.62V8.25c0-.97-.784-1.75-1.75-1.75z"/></svg>
                      <span>{tweet._repostedBy} reposted</span>
                    </div>
                  )}

                  {/* Header: author identity */}
                  <div className="tweet-header">
                    <div className="tweet-identity">
                      {tweet.avatar ? (
                        <img
                          className="tweet-avatar"
                          src={tweet.avatar}
                          alt=""
                          loading="lazy"
                          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/round-logo.png' }}
                        />
                      ) : (
                        <div className="tweet-avatar tweet-avatar-fallback">{(tweet.user || '?').charAt(0).toUpperCase()}</div>
                      )}
                      <div className="tweet-name-wrap">
                        <span className="tweet-user">{tweet.user}</span>
                        {tweet.verified && (
                          <svg className="verified-icon" viewBox="0 0 24 24" fill={tweet.verifiedType === 'business' ? '#FFD700' : '#1D9BF0'} width="12" height="12">
                            <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
                          </svg>
                        )}
                        <span className="tweet-handle">{tweet.handle}</span>
                      </div>
                    </div>
                    <span className="tweet-time">{tweet.time}</span>
                    <a href={`https://x.com/${(tweet._sourceHandle || tweet.handle).replace('@', '')}/status/${tweet._sourceTweetId || tweet.id}`} target="_blank" rel="noopener noreferrer" className="tweet-x-link" onClick={(e) => e.stopPropagation()}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    </a>
                  </div>

                  {/* Replying to */}
                  {tweet.replyingTo && !tweet._parentTweet && (
                    <div className="replying-to">
                      Replying to <span className="reply-handle">{tweet.replyingTo}</span>
                    </div>
                  )}

                  {/* Parent tweet preview — the post this reply is responding to */}
                  {tweet._parentTweet && (
                    <div className="parent-tweet-preview">
                      <div className="parent-tweet-header">
                        {tweet._parentTweet.avatar && (
                          <img className="parent-tweet-avatar" src={tweet._parentTweet.avatar} alt="" />
                        )}
                        <span className="parent-tweet-user">{tweet._parentTweet.user}</span>
                        <span className="parent-tweet-handle">{tweet._parentTweet.handle}</span>
                        <span className="parent-tweet-time">{tweet._parentTweet.time}</span>
                      </div>
                      <p className="parent-tweet-text">{tweet._parentTweet.content}</p>
                    </div>
                  )}

                  {/* Text - the hero */}
                  <p className="tweet-text">{tweet.content}</p>

                  {/* Media below text, 3:2 */}
                  {tweet.media && (
                    <div className={`tweet-media-wrap ${tweet.media.type}`}>
                      <img src={tweet.media.url} alt="" loading="lazy" />
                      {tweet.media.type === 'video' && (
                        <div className="tweet-video-badge">
                          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z" /></svg>
                          {tweet.media.duration && <span>{tweet.media.duration}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action row - always visible */}
                  <div className="tweet-actions">
                    <button className={`action-btn reply ${tweetInteractions[tweet.id]?.replied ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); openReplyModal(tweet, e); }}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z" /></svg>
                      <span>{tweet.replies + (tweetInteractions[tweet.id]?.replied ? 1 : 0)}</span>
                    </button>
                    <button className={`action-btn retweet ${tweetInteractions[tweet.id]?.retweeted ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleInteraction(tweet.id, 'retweeted', e); }}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" /></svg>
                      <span>{tweet.retweets + (tweetInteractions[tweet.id]?.retweeted ? 1 : 0)}</span>
                    </button>
                    <button className={`action-btn like ${tweetInteractions[tweet.id]?.liked ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleInteraction(tweet.id, 'liked', e); }}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z" /></svg>
                      <span>{tweet.likes + (tweetInteractions[tweet.id]?.liked ? 1 : 0)}</span>
                    </button>
                    {Number.isFinite(tweet.views) && (
                      <span className="action-btn views" title="Views">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" /></svg>
                        <span>{fmtCount(tweet.views)}</span>
                      </span>
                    )}
                    <button className={`action-btn share ${tweetInteractions[tweet.id]?.shared ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleInteraction(tweet.id, 'shared', e); }}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" /></svg>
                    </button>
                  </div>

                  {tweet._projectReplies && tweet._projectReplies.length > 0 && (
                    <div className="project-reply-context">
                      <div className="project-reply-label">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" width="11" height="11"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>
                        <img
                          className="project-reply-avatar"
                          src={profileStats?.avatar || tokenLogoRef.current || '/round-logo.png'}
                          alt=""
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none' }}
                        />
                        <span>{profileStats?.name || twitterUsername} replied</span>
                      </div>
                      {tweet._projectReplies.map((reply) => (
                        <div key={reply.id} className="project-reply-item">
                          <p className="project-reply-text">{reply.content}</p>
                          <span className="project-reply-time">{reply.time}</span>
                          <div className="tweet-actions project-reply-actions">
                            <button className={`action-btn reply ${tweetInteractions[reply.id]?.replied ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); openReplyModal(reply, e); }}>
                              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z" /></svg>
                              <span>{(reply.replies || 0) + (tweetInteractions[reply.id]?.replied ? 1 : 0)}</span>
                            </button>
                            <button className={`action-btn retweet ${tweetInteractions[reply.id]?.retweeted ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleInteraction(reply.id, 'retweeted', e); }}>
                              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" /></svg>
                              <span>{(reply.retweets || 0) + (tweetInteractions[reply.id]?.retweeted ? 1 : 0)}</span>
                            </button>
                            <button className={`action-btn like ${tweetInteractions[reply.id]?.liked ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleInteraction(reply.id, 'liked', e); }}>
                              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z" /></svg>
                              <span>{(reply.likes || 0) + (tweetInteractions[reply.id]?.liked ? 1 : 0)}</span>
                            </button>
                            {Number.isFinite(reply.views) && (
                              <span className="action-btn views" title="Views">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" /></svg>
                                <span>{fmtCount(reply.views)}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {mainTab === 'watchlist' && mobileSection !== 'social' && (
          <div className="watchlist">
            {/* Watchlist Filter/Sort Controls */}
            <div className="watchlist-controls">
              <div className="watchlist-sort-dropdown">
                <button 
                  className={`sort-btn ${watchlistSortDropdown ? 'active' : ''}`}
                  onClick={() => setWatchlistSortDropdown(!watchlistSortDropdown)}
                >
                  <Icon name="sort" size={18} />
                  {sortOptions.find(o => o.value === watchlistSort)?.label || 'Sort'}
                  <Icon name={watchlistSortDropdown ? 'chevron-up' : 'chevron-down'} size={18} className={`chevron ${watchlistSortDropdown ? 'up' : ''}`} />
                </button>
                {watchlistSortDropdown && (
                  <div className="sort-dropdown-menu">
                    {sortOptions.map(option => (
                      <button
                        key={option.value}
                        className={`sort-option ${watchlistSort === option.value ? 'active' : ''}`}
                        onClick={() => {
                          setWatchlistSort(option.value)
                          setWatchlistSortDropdown(false)
                        }}
                      >
                        <span className="sort-icon"><Icon name={option.iconName} size={16} /></span>
                        {option.label}
                        {watchlistSort === option.value && <Icon name="check" size={16} className="check" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="watchlist-controls-right">
                {/* Expand + Import are locked for the beta — both surface a
                    Coming Soon toast instead of opening the full-screen
                    watchlist / Dexscreener import sheets. */}
                <button
                  className="dex-import-btn is-locked"
                  onClick={() => triggerCopyToast('Coming Soon')}
                  title="Expand (Coming Soon)"
                  aria-label="Expand (Coming Soon)"
                  aria-disabled="true"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8V5a2 2 0 0 1 2-2h3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
                  </svg>
                  <span>Expand</span>
                  <Lock size={10} strokeWidth={2.4} className="dex-import-btn__lock" aria-hidden="true" />
                </button>
                <button
                  className="dex-import-btn is-locked"
                  onClick={() => triggerCopyToast('Coming Soon')}
                  title="Import (Coming Soon)"
                  aria-disabled="true"
                >
                  <Icon name="external-link" size={14} />
                  <span>Import</span>
                  <Lock size={10} strokeWidth={2.4} className="dex-import-btn__lock" aria-hidden="true" />
                </button>
                <span className="watchlist-count">{watchlist?.length || 0} tokens</span>
              </div>
            </div>

            {sortedWatchlist && sortedWatchlist.length > 0 ? (
              <div className="watchlist-items">
                {sortedWatchlist.map((token, index) => (
                <div 
                  key={token.address || token.symbol} 
                    className={`watchlist-item ${token.pinned ? 'pinned' : ''} ${dragOverItem === index ? 'drag-over' : ''}`}
                    style={{ animationDelay: `${index * 50}ms`, cursor: 'pointer' }}
                    data-warm-addr={token.address}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index, token)}
                    onDragEnter={(e) => handleDragEnter(e, index)}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onMouseEnter={() => handleRowHover(token)}
                    onMouseLeave={handleRowHoverEnd}
                    onClick={() => {
                      if (selectToken) {
                        selectToken({
                          symbol: token.symbol,
                          name: token.name,
                          address: token.address,
                          networkId: token.networkId || 1,
                          price: token.price,
                          change: token.change,
                          logo: token.logo
                        }, 'watchlist')
                      }
                    }}
                  >
                    <div className="drag-handle">
                      <Icon name="grip-dots" size={18} />
                    </div>
                  <div className="token-info">
                    <div className={`token-avatar ${(getHardcodedLogo(token.address) || token.logo) ? 'has-logo' : ''}`}>
                      {(getHardcodedLogo(token.address) || token.logo) ? (
                        // Lazy: a long watchlist scrolls, and each avatar is a
                        // 600-900ms TTFB hit to raw S3. CSS owns the box
                        // (.token-avatar img is 100%/100%), so no size attrs.
                        <img src={getHardcodedLogo(token.address) || token.logo} alt={token.symbol} loading="lazy" decoding="async" />
                      ) : (
                        <span>{token.symbol[0]}</span>
                      )}
                    </div>
                    <div>
                      <span className="token-symbol">{token.symbol}</span>
                      <span className="token-name">{token.name}</span>
                    </div>
                  </div>
                    <WatchlistSparkline
                      prices={sparklinePrices[(token.address || '').toLowerCase()] || null}
                      change={token.change || 0}
                      seed={token.address || token.symbol}
                    />
                    <div className="token-stats">
                    <span className="price">{formatPrice(token.price)}</span>
                    {/* OL Iteration 2: DeltaChip carries the change pill with a
                        directional glow + mint/coral; replaces the flat span. */}
                    {token.change != null && (
                      <DeltaChip value={Number(token.change)} size="sm" showGlyph={false} />
                    )}
                      <span className="mcap-value">{formatMarketCap(token.marketCap)}</span>
                  </div>
                    <div className="watchlist-actions">
                  <button
                    className={`pin-watchlist-btn ${token.pinned ? 'pinned' : ''}`}
                    onClick={(e) => { e.stopPropagation(); togglePinWatchlist(token.address || token.symbol); }}
                    title={token.pinned ? 'Unpin' : 'Pin to top'}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 17v5" />
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                    </svg>
                  </button>
                  <button
                    className="remove-watchlist-btn"
                    onClick={(e) => { e.stopPropagation(); removeFromWatchlist(token.address || token.symbol); }}
                    title="Remove from Watchlist"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-watchlist">
                <Icon name="heart" size={48} />
                <p>Your watchlist is empty</p>
                <span>Click the heart icon on any token to add it</span>
              </div>
            )}

            {/* Full-Screen Watchlist View */}
            {watchlistFullScreen && createPortal(
              <Suspense fallback={null}>
                <WatchlistFullView
                  watchlist={sortedWatchlist}
                  sparklinePrices={sparklinePrices}
                  onClose={() => setWatchlistFullScreen(false)}
                  selectToken={(t, src) => {
                    setWatchlistFullScreen(false)
                    selectToken?.(t, src)
                  }}
                  togglePinWatchlist={togglePinWatchlist}
                  removeFromWatchlist={removeFromWatchlist}
                  refresh={fetchWatchlistData}
                  onImport={() => setDexImportOpen(true)}
                />
              </Suspense>,
              document.body
            )}

            {/* DexScreener Import Modal */}
            {dexImportOpen && createPortal(
              <div className="dex-import-overlay" onClick={() => setDexImportOpen(false)}>
                <div className="dex-import-modal" onClick={e => e.stopPropagation()}>
                  <div className="dex-import-header">
                    <span className="dex-import-title">Import from DexScreener</span>
                    <button className="dex-import-close" onClick={() => setDexImportOpen(false)}>
                      <Icon name="close" size={18} />
                    </button>
                  </div>

                  <div className="dex-import-body">
                    <label className="dex-import-label">
                      Paste contract addresses
                      <span className="dex-import-hint">One per line, comma or space separated</span>
                    </label>
                    <textarea
                      className="dex-import-textarea"
                      value={dexImportInput}
                      onChange={e => setDexImportInput(e.target.value)}
                      placeholder={"0x6982508145454Ce325dDbE47a25d4ec3d2311933\nEKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzL...\n..."}
                      rows={5}
                      autoFocus
                    />
                    <button
                      className="dex-import-lookup-btn"
                      onClick={lookupDexScreener}
                      disabled={dexImportLoading || !dexImportInput.trim()}
                    >
                      {dexImportLoading ? 'Looking up...' : `Look up tokens (${parseDexInput(dexImportInput).length})`}
                    </button>

                    {dexImportResults !== null && (
                      <div className="dex-import-results">
                        {dexImportResults.length === 0 ? (
                          <div className="dex-import-empty">No tokens found for those addresses</div>
                        ) : (
                          <>
                            <div className="dex-import-results-header">
                              <span>{dexImportResults.length} found</span>
                              <button
                                className="dex-import-select-all"
                                onClick={() => {
                                  if (dexImportSelected.size === dexImportResults.length) {
                                    setDexImportSelected(new Set())
                                  } else {
                                    setDexImportSelected(new Set(dexImportResults.map((_, i) => i)))
                                  }
                                }}
                              >
                                {dexImportSelected.size === dexImportResults.length ? 'Deselect all' : 'Select all'}
                              </button>
                            </div>
                            <div className="dex-import-list">
                              {dexImportResults.map((t, i) => {
                                const alreadyIn = watchlist?.some(w =>
                                  (w.address || '').toLowerCase() === t.address.toLowerCase()
                                )
                                return (
                                  <div
                                    key={t.address}
                                    className={`dex-import-item ${dexImportSelected.has(i) ? 'selected' : ''} ${alreadyIn ? 'already-in' : ''}`}
                                    onClick={() => {
                                      if (alreadyIn) return
                                      setDexImportSelected(prev => {
                                        const next = new Set(prev)
                                        if (next.has(i)) next.delete(i)
                                        else next.add(i)
                                        return next
                                      })
                                    }}
                                  >
                                    <div className="dex-import-check">
                                      {alreadyIn ? (
                                        <Icon name="check" size={14} />
                                      ) : (
                                        <div className={`dex-import-checkbox ${dexImportSelected.has(i) ? 'checked' : ''}`} />
                                      )}
                                    </div>
                                    <div className={`token-avatar ${t.logo ? 'has-logo' : ''}`}>
                                      {t.logo ? <img src={t.logo} alt={t.symbol} /> : <span>{(t.symbol || '?')[0]}</span>}
                                    </div>
                                    <div className="dex-import-token-info">
                                      <span className="token-symbol">{t.symbol}</span>
                                      <span className="token-name">{t.name}</span>
                                    </div>
                                    <div className="dex-import-token-meta">
                                      <span className="dex-import-chain">{t.chain}</span>
                                      {alreadyIn && <span className="dex-import-exists">Already added</span>}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {dexImportResults && dexImportResults.length > 0 && (
                    <div className="dex-import-footer">
                      <button
                        className="dex-import-confirm-btn"
                        onClick={importSelectedTokens}
                        disabled={dexImportSelected.size === 0}
                      >
                        Import {dexImportSelected.size} token{dexImportSelected.size !== 1 ? 's' : ''}
                      </button>
                    </div>
                  )}
                </div>
              </div>,
              document.body
            )}
          </div>
        )}

        {mainTab === 'ai' && (
          <div className="ai-logs-panel">
            <div className="ai-logs-header">
              <div className="ai-logs-title-wrap">
                <span className="ai-logs-title">AI Logs</span>
                <span className="ai-logs-subtitle">On-chain, social, and TA insights</span>
              </div>

              <div className="ai-logs-segmented" role="tablist" aria-label="AI logs filter">
                <button
                  className={`ai-logs-seg-btn ${aiLogFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setAiLogFilter('all')}
                  type="button"
                  role="tab"
                  aria-selected={aiLogFilter === 'all'}
                  onMouseEnter={(e) => showAiFilterTooltip(e, 'All')}
                  onMouseLeave={hideAiFilterTooltip}
                  onFocus={(e) => showAiFilterTooltip(e, 'All')}
                  onBlur={hideAiFilterTooltip}
                  aria-label="All"
                >
                  <Icon name="all-assets" size={14} />
                  <span>All</span>
                </button>
                <button
                  className={`ai-logs-seg-btn ${aiLogFilter === 'onchain' ? 'active' : ''}`}
                  onClick={() => setAiLogFilter('onchain')}
                  type="button"
                  role="tab"
                  aria-selected={aiLogFilter === 'onchain'}
                  onMouseEnter={(e) => showAiFilterTooltip(e, 'On-Chain')}
                  onMouseLeave={hideAiFilterTooltip}
                  onFocus={(e) => showAiFilterTooltip(e, 'On-Chain')}
                  onBlur={hideAiFilterTooltip}
                  aria-label="On-Chain"
                >
                  <Icon name="whale" size={14} />
                  <span>On-Chain</span>
                </button>
                <button
                  className={`ai-logs-seg-btn ${aiLogFilter === 'x' ? 'active' : ''}`}
                  onClick={() => setAiLogFilter('x')}
                  type="button"
                  role="tab"
                  aria-selected={aiLogFilter === 'x'}
                  onMouseEnter={(e) => showAiFilterTooltip(e, 'X Activity')}
                  onMouseLeave={hideAiFilterTooltip}
                  onFocus={(e) => showAiFilterTooltip(e, 'X Activity')}
                  onBlur={hideAiFilterTooltip}
                  aria-label="X Activity"
                >
                  <Icon name="news" size={14} />
                  <span>X Activity</span>
                </button>
                <button
                  className={`ai-logs-seg-btn ${aiLogFilter === 'ta' ? 'active' : ''}`}
                  onClick={() => setAiLogFilter('ta')}
                  type="button"
                  role="tab"
                  aria-selected={aiLogFilter === 'ta'}
                  onMouseEnter={(e) => showAiFilterTooltip(e, 'TA')}
                  onMouseLeave={hideAiFilterTooltip}
                  onFocus={(e) => showAiFilterTooltip(e, 'TA')}
                  onBlur={hideAiFilterTooltip}
                  aria-label="TA"
                >
                  <Icon name="analytics" size={14} />
                  <span>TA</span>
                </button>
              </div>
            </div>

            <div className="ai-logs-list">
              {filteredAiLogs.length > 0 ? (
                filteredAiLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`log-item cat-${log.category}`}
                    style={{ animationDelay: `${index * 35}ms` }}
                  >
                    <div className="log-header">
                      <span className={`log-badge cat-${log.category}`}>
                        <Icon
                          name={log.category === 'onchain' ? 'whale' : log.category === 'x' ? 'news' : 'analytics'}
                          size={12}
                        />
                        {log.category === 'onchain' ? 'ON-CHAIN' : log.category === 'x' ? 'X ACTIVITY' : 'TA'}
                      </span>
                      <span className="log-time">{log.time}</span>
                    </div>
                    <div className="log-body">
                      <span className="log-title">{log.title}</span>
                      <span className="log-msg">{log.message}</span>
                    </div>
                    {log.confidence && (
                      <div className="log-confidence">
                        <span>Confidence</span>
                        <span className="confidence-value">{log.confidence}</span>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="ai-logs-empty">
                  <span className="ai-logs-empty-title">No logs</span>
                  <span className="ai-logs-empty-subtitle">Try a different filter.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {mainTab === 'xdash' && (
          <Suspense fallback={<div className="social-loading">Loading…</div>}>
            <XDashColumn
              token={token}
              tweetsData={{ categorized, allTweets: apiTweets, loading: tweetsLoading, error: tweetsError, twitterUsername, author: twitterAuthor }}
              onExpand={() => {
                if (typeof window !== 'undefined' && window.matchMedia) {
                  const isDesktop = window.matchMedia('(min-width: 1200px)').matches
                  if (!isDesktop) {
                    triggerCopyToast('Full X Intelligence is desktop-only')
                    return
                  }
                }
                setFullViewMode(true)
              }}
            />
          </Suspense>
        )}

        {mainTab === 'social' && (
          <Suspense fallback={<div className="social-loading">Loading…</div>}>
            <SpectreSocial token={token} />
          </Suspense>
        )}
      </div>
      )}

      {/* Full View - X Intelligence Dashboard (lazy, portal). Hoisted to the
          panel level so it opens from either the X tab or the X Dash tab. */}
      {fullViewMode && (
        <Suspense fallback={null}>
          <XFullView
            token={token}
            onClose={() => { setFullViewMode(false); setSelectedTweetId(null); }}
            tweetsData={{ categorized, allTweets: apiTweets, loading: tweetsLoading, error: tweetsError, twitterUsername, author: twitterAuthor }}
          />
        </Suspense>
      )}

      {aiFilterTooltip.visible && (
        <div
          className="apple-tooltip"
          style={{
            left: aiFilterTooltip.x,
            top: aiFilterTooltip.y,
          }}
          role="tooltip"
        >
          {aiFilterTooltip.text}
        </div>
      )}

      {/* Bottom Section: Token Screener.
          mobileSection 'social' hides Markets; undefined/'markets' shows it. */}
      {mobileSection !== 'social' && (
      <div className="panel-card bottom-section lp-part" data-part="screener" style={lpPartStyle('screener')}>
        <div className="bottom-content">
          <TokenScreener selectToken={selectToken} />
        </div>
      </div>
      )}

      {/* REMOVED: Old trending section replaced by screener above */}
      {false && <div className="panel-card bottom-section-old">
        <div className="bottom-content">
          <div className="bottom-header">
            <div className="bottom-title">
              <Icon name="trending-up" size={16} />
              <span>Trending</span>
            </div>
            <span className="bottom-subtitle">Real-time · Top movers</span>
          </div>

          <div className="trending-filters">
            {/* Segmented timeframe pills */}
            <div className="tf-segmented" role="radiogroup" aria-label="Trending timeframe">
              {TRENDING_TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  type="button"
                  role="radio"
                  aria-checked={trendingTimeframe === tf.value}
                  className={`tf-pill${trendingTimeframe === tf.value ? ' active' : ''}`}
                  onClick={() => setTrendingTimeframe(tf.value)}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {/* Custom chain dropdown */}
            <div className="chain-dropdown" ref={chainDropdownRef}>
              <button
                type="button"
                className={`chain-trigger${chainDropdownOpen ? ' open' : ''}`}
                onClick={() => setChainDropdownOpen(v => !v)}
                aria-haspopup="listbox"
                aria-expanded={chainDropdownOpen}
              >
                <span>{TRENDING_CHAINS.find(c => c.value === trendingChain)?.label || 'All chains'}</span>
                <svg className="chain-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {chainDropdownOpen && (
                <div className="chain-menu" role="listbox" aria-label="Chain filter">
                  {TRENDING_CHAINS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="option"
                      aria-selected={trendingChain === c.value}
                      className={`chain-option${trendingChain === c.value ? ' selected' : ''}`}
                      onClick={() => { setTrendingChain(c.value); setChainDropdownOpen(false) }}
                    >
                      {c.label}
                      {trendingChain === c.value && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4l3.5 3.5L11 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="trending-refresh-btn"
              onClick={refreshTrending}
              disabled={trendingLoading}
              aria-label="Refresh trending"
              title="Refresh"
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>

          <div className="trending-list">
            {trendingLoading && trendingTokens.length === 0 ? (
              <div className="trending-loading">Loading…</div>
            ) : trendingError && trendingTokens.length === 0 ? (
              <div className="trending-error">Unable to load trending</div>
            ) : (
              trendingTokens.slice(0, 7).map((t, index) => {
                const isVolumeTab = trendingTimeframe === 'volume'
                const changeNum = typeof t.change === 'number' ? t.change : parseFloat(t.change) || 0
                const isDown = !isVolumeTab && changeNum < 0
                const rightLabel = isVolumeTab
                  ? formatLargeNumber(t.volume24h || 0)
                  : (changeNum === 0 ? '0%' : (changeNum > 0 ? '+' : '') + changeNum.toFixed(2) + '%')
                return (
                  <div
                    key={`${t.address}-${t.networkId}-${t.rank}`}
                    className={`trending-item ${isDown ? 'down' : 'up'}`}
                    style={{ animationDelay: `${index * 50}ms` }}
                    // Marks this row as a chart-warm target - prewarmChartBarsList
                    // only warms rows that are actually on screen.
                    data-warm-addr={t.address}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectToken && selectToken({ address: t.address, networkId: t.networkId, symbol: t.symbol, name: t.name, logo: t.logo, price: t.price, change: t.change, volume24: t.volume, liquidity: t.liquidity, marketCap: t.marketCap }, 'trending')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectToken?.({ address: t.address, networkId: t.networkId, symbol: t.symbol, name: t.name, logo: t.logo, price: t.price, change: t.change, volume24: t.volume, liquidity: t.liquidity, marketCap: t.marketCap }, 'trending') } }}
                  >
                    <span className="rank">#{t.rank}</span>
                    <img
                      className="trending-logo"
                      src={t.logo || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="14" fill="#18181b"/><text x="14" y="18" text-anchor="middle" fill="#f5f5f7" font-family="system-ui" font-size="12" font-weight="600">${(t.symbol || '?').charAt(0)}</text></svg>`)}`}
                      alt=""
                      width={28}
                      height={28}
                      loading="lazy"
                      onError={(e) => { e.target.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="14" fill="#18181b"/><text x="14" y="18" text-anchor="middle" fill="#f5f5f7" font-family="system-ui" font-size="12" font-weight="600">${(t.symbol || '?').charAt(0)}</text></svg>`)}` }}
                    />
                    <div className="trending-info">
                      <span className="symbol">{t.symbol}</span>
                      <span className="name">{t.name}</span>
                    </div>
                    <div className="trending-price">
                      <span className="price">{formatPrice(t.price)}</span>
                      <span className={`change ${isDown ? 'negative' : 'positive'}`}>{rightLabel}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>}

      {/* Reply Modal */}
      {replyModal.open && createPortal(
        <div className="reply-modal-overlay" onClick={closeReplyModal}>
          <div className="reply-modal" onClick={(e) => e.stopPropagation()}>
            <div className="reply-modal-header">
              <span className="reply-modal-title">Reply to {replyModal.tweet?.handle}</span>
              <button className="reply-modal-close" onClick={closeReplyModal}>
                <Icon name="close" size={20} />
              </button>
            </div>
            
            <div className="reply-modal-original">
              <img src={replyModal.tweet?.avatar} alt="" className="reply-tweet-avatar" />
              <div className="reply-tweet-content">
                <div className="reply-tweet-header">
                  <span className="reply-tweet-user">{replyModal.tweet?.user}</span>
                  <span className="reply-tweet-handle">{replyModal.tweet?.handle}</span>
                </div>
                <p className="reply-tweet-text">{replyModal.tweet?.content}</p>
              </div>
            </div>
            
            <div className="reply-input-area">
              <img src="/round-logo.png" alt="" className="reply-user-avatar" />
              <textarea
                className="reply-textarea"
                placeholder="Post your reply"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                maxLength={280}
                autoFocus
              />
            </div>
            
            <div className="reply-modal-footer">
              <span className="reply-char-count">{replyText.length}/280</span>
              <button 
                className="reply-submit-btn"
                onClick={submitReply}
                disabled={!replyText.trim()}
              >
                Reply
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Coming Soon Tooltip - Fixed Position (Left variant) */}
      {comingSoonTooltip.visible && (
        <div 
          className="coming-soon-tooltip-fixed coming-soon-tooltip-fixed-left"
          style={{
            position: 'fixed',
            left: `${comingSoonTooltip.x}px`,
            top: `${comingSoonTooltip.y}px`,
            transform: 'translate(calc(-100% - 12px), -50%)',
            pointerEvents: 'none',
            zIndex: 99999
          }}
        >
          {comingSoonTooltip.text}
        </div>
      )}

    </div>
  )
}

export default React.memo(LeftPanel)
