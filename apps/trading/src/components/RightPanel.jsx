/**
 * RightPanel Component
 * Figma Reference: Right sidebar
 * Research Zone banner + Market Stats + Trading Panel
 * 
 * NOW WITH REAL-TIME DATA FROM CODEX API
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { isAppActive } from '../lib/idleManager'
import { whenIdle } from '../utils/whenIdle'
import { Lock, AlertTriangle, AlertOctagon, CheckCircle2, ArrowRight, SlidersHorizontal, Wallet } from 'lucide-react'
import useSettingsStore from '../store/useSettingsStore'
import { track, Events } from '../services/analytics'
import { useCopyToast } from '../App'
import { useSharedTokenDetails } from '../contexts/TokenDetailsContext'
import { formatLargeNumber, formatPrice, getHardcodedLogo, inferNetworkId } from '../services/codexApi'
import { readCodexChangePct } from '../lib/marketFormat'
import { chainForNetworkId, CHAIN_LABELS } from '../lib/swapParams'
import { useBarChangeWindows } from '../hooks/useBarChangeWindows'
// OL Iteration 3 — the AI narrative card moved from the right rail
// into the centre TokenBanner header (HeaderDossier). DossierStory and
// AIIntelligenceCard files remain on disk as dead code; no consumer
// imports them anymore.
import DexStatsBoard from './DexStatsBoard'
import LazyErrorBoundary from './LazyErrorBoundary'
import VitalsBento from './VitalsBento'
import TokenIdentityCard from './TokenIdentityCard'
import { fromSmallestUnit, simulateSwap } from '../services/swapService'
import { subscribeNativePrices } from '../services/nativePricesStore'
import { COMMON_TOKENS } from '../services/walletService'
import { useSwapExecution } from '../hooks/useSwapExecution'
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
import { fetchTokenTaxCached } from '../lib/tokenTax'
import Icon from './Icon'
import { tokenPlaceholder } from '../utils/tokenPlaceholder'
import { ChainIcon, getChainAccent } from '../utils/chainIcons'
import { fetchTokenColorFromServer, extractColorFromImage, getCachedColor, hasKnownColor } from '../utils/tokenColors'
import './RightPanel.css'

// Compact display for the swap-strip amounts: 2dp for values >= 1, 6dp below.
const fmtSwapAmt = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''))
  if (!Number.isFinite(n)) return String(v ?? '')
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1 ? 2 : 6 })
}

// QuickIntel token-tax cache - extracted to lib/tokenTax.js (2026-07-11)
// so the Spectre Agent shares the honeypot/tax guard. Behavior unchanged.

// Map a raw swap error string to alert presentation. Balance / quote issues
// are user-fixable "action needed" (amber); real failures stay coral. The
// severity drives the .swap-error-alert variant class in RightPanel.css.
const classifySwapError = (message, context = 'swap') => {
  const m = String(message || '')
  if (/not enough (sol|eth)|insufficient|headroom|add (sol|eth)|gas fee/i.test(m)) {
    return { kind: 'warn', title: 'Insufficient balance' }
  }
  if (/quote (expired|unavailable)|enter your amount/i.test(m)) {
    return { kind: 'warn', title: 'Quote expired' }
  }
  if (/cancelled|canceled|user rejected/i.test(m)) {
    return { kind: 'warn', title: 'Cancelled' }
  }
  if (/price moved|slippage/i.test(m)) {
    return { kind: 'warn', title: 'Price moved' }
  }
  if (/price impact too high|would revert/i.test(m)) {
    return { kind: 'warn', title: 'Trade blocked' }
  }
  if (/still pending|previous transaction/i.test(m)) {
    return { kind: 'warn', title: 'Pending' }
  }
  // `context` keeps the fallback title truthful: nothing was signed when a
  // QUOTE fails, so calling it "Swap failed" would misreport what happened.
  // A quote failure is also usually transient (rate limit, timeout, thin
  // route), hence warn rather than error.
  if (context === 'quote') return { kind: 'warn', title: 'Quote unavailable' }
  return { kind: 'error', title: 'Swap failed' }
}

// Generate a consistent color from any string (token symbol/address)
const generateColorFromString = (str) => {
  if (!str) return '#8B5CF6'
  
  // Simple hash function
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  
  // Generate HSL color with good saturation and lightness for visibility
  const hue = Math.abs(hash % 360)
  const saturation = 65 + (Math.abs(hash >> 8) % 20) // 65-85%
  const lightness = 50 + (Math.abs(hash >> 16) % 15) // 50-65%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

// Known token colors (for popular tokens)
const KNOWN_TOKEN_COLORS = {
  'SPECTRE': '#D4D4D8', 'ETH': '#627EEA', 'WETH': '#627EEA', 'BTC': '#F7931A',
  'WBTC': '#F7931A', 'SOL': '#9945FF', 'USDT': '#26A17B', 'USDC': '#2775CA', 
  'PEPE': '#3D9E41', 'DOGE': '#C3A634', 'SHIB': '#F7931A', 'UNI': '#FF007A', 
  'LINK': '#2A5ADA', 'AAVE': '#B6509E', 'ARB': '#28A0F0', 'OP': '#FF0420', 
  'MATIC': '#8247E5', 'AVAX': '#E84142', 
  // Solana tokens
  'WIF': '#9945FF', '$WIF': '#9945FF', 'DOGWIFHAT': '#9945FF',
  'JUP': '#00D395', 'JUPITER': '#00D395',
  'BONK': '#FF9500', 
  'MOODENG': '#D4A5C9', 'MOO DENG': '#D4A5C9', // Soft dusty pink - matches baby hippo aesthetic
  'PYTH': '#6B4EE6',
  'JTO': '#14F195', 'JITO': '#14F195',
  'RENDER': '#00D395', 'RNDR': '#00D395',
  'POPCAT': '#FFD93D',
  'WEN': '#9945FF',
  'BOME': '#FF6B35',
  'RAY': '#4FC3F7', 'RAYDIUM': '#4FC3F7',
}

// Get token color - uses known colors or generates from symbol/address
const getTokenColor = (symbol, address) => {
  // Check known colors first (handle various formats)
  if (symbol) {
    const upperSymbol = symbol.toUpperCase()
    if (KNOWN_TOKEN_COLORS[upperSymbol]) {
      return KNOWN_TOKEN_COLORS[upperSymbol]
    }
    // Also check without $ prefix for tokens like $WIF
    const cleanSymbol = upperSymbol.replace(/^\$/, '')
    if (KNOWN_TOKEN_COLORS[cleanSymbol]) {
      return KNOWN_TOKEN_COLORS[cleanSymbol]
    }
  }
  // Generate consistent color from symbol or address
  return generateColorFromString(symbol || address || 'default')
}

// Network name mapping
const getNetworkName = (networkId) => {
  const networks = {
    1: 'Ethereum',
    56: 'BNB Chain',
    137: 'Polygon',
    42161: 'Arbitrum',
    8453: 'Base',
    43114: 'Avalanche',
    10: 'Optimism',
    250: 'Fantom',
    1399811149: 'Solana',
    4663: 'Robinhood',
  }
  return networks[networkId] || 'Unknown'
}

// Codex networkId -> the wallet-section chain tab id (Your Wallet in the
// dashboard). Used by the "Fund the wallet to trade" CTA so we deep-link to the
// exact chain the current token lives on. Chains the wallet has no tab for fall
// back to ethereum.
const NETWORK_TO_WALLET_CHAIN = {
  1: 'ethereum',
  8453: 'base',
  137: 'polygon',
  42161: 'arbitrum',
  56: 'bsc',
  4663: 'robinhood',
  1399811149: 'solana',
}

// Helper to sanitize token names - remove replacement chars and non-printable chars
const sanitizeName = (name) => {
  if (!name) return '';
  return name
    .replace(/[\uFFFD\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Default pay-token KEY (swapTokens map key, not display symbol) per viewed
// token network. Every supported chain has a native entry so the pay side
// always matches the target token's chain - the aggregators are single-chain
// and a mismatched pair could quote a DIFFERENT token that happens to live at
// the same address on the pay chain.
const DEFAULT_PAY_KEY_BY_NETWORK = {
  1399811149: 'SOL',
  56: 'BNB',
  8453: 'ETH-BASE',
  137: 'POL',
  42161: 'ETH-ARB',
  4663: 'ETH-HOOD',
}
const defaultPayKeyForNetwork = (nid) => DEFAULT_PAY_KEY_BY_NETWORK[nid] || 'ETH'

// initialMode: optional 'buy' | 'sell' seed for the trade toggle — used by
// MobileSwapSheet so tapping Sell on the mobile trade bar opens in sell mode.
const RightPanel = ({ token, initialMode, layoutParts }) => {
  const { triggerCopyToast } = useCopyToast()
  const { login, authenticated, user } = usePrivy()


  // When the token's network changes, update the default pay token to match
  useEffect(() => {
    setSelectedPayToken(defaultPayKeyForNetwork(token?.networkId))
  }, [token?.networkId])

  // Fetch real-time token data from Codex API
  const { tokenData: liveTokenData, loading: tokenLoading } = useSharedTokenDetails()
  
  // Debug: log when liveTokenData changes
  useEffect(() => {
  }, [liveTokenData, token?.symbol]);
  const [mode, setMode] = useState(initialMode === 'sell' ? 'sell' : 'buy')
  const [payAmount, setPayAmount] = useState('')
  const payInputRef = useRef(null)
  // Pre-trade safety simulation (button next to Details). { ok, reason, ... }.
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult] = useState(null)
  const [receiveAmount, setReceiveAmount] = useState('')
  // Rate / Price / Price impact rows - hidden by default, toggled via the
  // info button in the Buy/Sell bar. Persisted preference (settings store).
  const showSwapDetails = useSettingsStore((s) => s.showSwapDetails)
  const toggleSwapDetails = useSettingsStore((s) => s.toggleSwapDetails)
  // Trading prefs: max slippage + quick-buy amount chips. Persisted.
  const swapPrefs = useSettingsStore((s) => s.swapPrefs)
  const setSwapPrefs = useSettingsStore((s) => s.setSwapPrefs)
  const [showSwapSettings, setShowSwapSettings] = useState(false)
  const swapSettingsRef = React.useRef(null)

  // Close the settings popover on outside click / Escape
  useEffect(() => {
    if (!showSwapSettings) return undefined
    const onDown = (e) => {
      if (swapSettingsRef.current && !swapSettingsRef.current.contains(e.target)) {
        setShowSwapSettings(false)
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') setShowSwapSettings(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showSwapSettings])
  const [activeInput, setActiveInput] = useState('pay')
  const [showVolumeDropdown, setShowVolumeDropdown] = useState(false)
  const [volumePeriod, setVolumePeriod] = useState('24H')
  const [showLiquidityDropdown, setShowLiquidityDropdown] = useState(false)
  const [swapRotation, setSwapRotation] = useState(0)
  // Default pay token matches the viewed token's network
  const [selectedPayToken, setSelectedPayToken] = useState(() => defaultPayKeyForNetwork(token?.networkId))
  const [showWalletAddr, setShowWalletAddr] = useState(false)
  const [showLogoFullView, setShowLogoFullView] = useState(false)

  // Banner accent — only ever set to a real (server-cached, session-cached,
  // server-attached, or extracted) brand color. Until extraction yields a real
  // color, banner sits on a neutral white tint so we never flash a wrong hash
  // hue. Dictionary tokens (BTC/ETH/etc.) still hit instantly via hasKnownColor.
  const NEUTRAL = '#ffffff'
  const [bannerColor, setBannerColor] = useState(() => {
    const url = token?.logo
    // Curated dictionary (e.g. PIPPIN -> #7DD3FC) MUST beat ALL extracted
    // colors, including server-attached ones. Server `dominantColor` is
    // populated by canvas write-throughs that pick up incidental hues (the
    // pink flower on PIPPIN's mostly-white logo). Dictionary entries are
    // hand-curated brand colors and should always win for known tokens.
    if (hasKnownColor(token?.symbol)) return getTokenColor(token?.symbol, token?.address)
    if (token?.dominantColor) return token.dominantColor
    const cached = getCachedColor(url)
    if (cached) return cached
    return NEUTRAL
  })

  useEffect(() => {
    let cancelled = false
    const t0 = performance.now()
    const log = (label, color) => {
      // eslint-disable-next-line no-console
    }
    const url = liveTokenData?.logo || token?.logo
    const serverColor = liveTokenData?.dominantColor || token?.dominantColor
    const cached = getCachedColor(url)
    let target = NEUTRAL
    let needsExtraction = false
    let source = 'neutral'
    // Curated dictionary beats ALL extracted sources for known tokens.
    if (hasKnownColor(token?.symbol)) { target = getTokenColor(token?.symbol, token?.address); source = 'dictionary' }
    // serverColor is `null` on failure (post Layer-1 contract change).
    else if (serverColor) { target = serverColor; source = 'server-attached' }
    else if (cached) { target = cached; source = 'session-cache' }
    else needsExtraction = true
    log(source, target)
    setBannerColor(target)
    if (!needsExtraction || !url) return
    // Server cache hit (~50ms) wins over canvas (~2s). Canvas runs only when
    // the server hasn't been seeded yet for this logo URL.
    fetchTokenColorFromServer(url).then(async (serverColor) => {
      if (cancelled) return
      if (serverColor) {
        log('server', serverColor)
        setBannerColor(serverColor)
        return
      }
      const canvasColor = await extractColorFromImage(url).catch(() => null)
      if (cancelled) return
      if (canvasColor) {
        log('canvas', canvasColor)
        setBannerColor(canvasColor)
        return
      }
      // Both extractors failed (CORS / SVG / network). Don't strand the banner
      // on NEUTRAL forever — fall back to the hash-derived hue from symbol/address.
      const fallback = getTokenColor(token?.symbol, token?.address)
      if (fallback && fallback !== '#D4D4D8') {
        log('hash-fallback', fallback)
        setBannerColor(fallback)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [token?.address, token?.symbol, token?.dominantColor, liveTokenData?.logo, liveTokenData?.dominantColor])

  // Esc closes the logo lightbox
  useEffect(() => {
    if (!showLogoFullView) return
    const onKey = (e) => { if (e.key === 'Escape') setShowLogoFullView(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showLogoFullView])

  // Upscale logo URLs to their largest variant for the lightbox.
  // CoinGecko: /thumb/ or /small/ → /large/. Defined.fi: drop _thumb / _small.
  const upscaleLogoUrl = (url) => {
    if (!url || typeof url !== 'string') return url
    return url
      .replace(/\/(thumb|small)\//, '/large/')
      .replace(/_thumb_/, '_large_')
      .replace(/_small_/, '_large_')
  }
  const [showPayTokens, setShowPayTokens] = useState(false)

  // ── Token-change reset ─────────────────────────────────────────────────────
  // App.jsx used to pass `key={token.address || token.symbol}` to this panel,
  // so a token click threw the whole subtree away and every useState above went
  // back to its initializer. That remount re-reconciled ~2.4k lines on the app's
  // most frequent interaction, so the key is gone - which means the reset must
  // be explicit, or token A's trade state (amount, receive, side, verdict)
  // renders under token B.
  //
  // `address || symbol` mirrors the identity the old key used so address-less
  // majors still separate; networkId is included because one address can exist
  // on two chains, and that is a different asset.
  const tokenIdentity = `${token?.networkId ?? ''}:${token?.address || token?.symbol || ''}`
  // Bumped on every reset so async work started for the PREVIOUS token can tell
  // it lost the race instead of setting state on the new one.
  const tokenEpochRef = useRef(0)
  useEffect(() => {
    tokenEpochRef.current += 1
    // Every value below is exactly the useState initializer above it.
    setMode(initialMode === 'sell' ? 'sell' : 'buy')
    setPayAmount('')
    setReceiveAmount('')
    setActiveInput('pay')
    setSimulating(false)
    setSimResult(null)
    setVolumePeriod('24H')
    setShowVolumeDropdown(false)
    setShowLiquidityDropdown(false)
    setShowPayTokens(false)
    setShowSwapSettings(false)
    setShowWalletAddr(false)
    setShowLogoFullView(false)
    // Handled by their OWN token-keyed effects, so not repeated here:
    //   selectedPayToken (the networkId effect at the top of this component),
    //   bannerColor (the accent effect below), tokenTax, and the sell-side
    //   balances + all quote/swap state inside useSwapExecution.
    // Deliberately NOT reset:
    //   swapRotation - a cosmetic accumulated angle; zeroing it spins the
    //     direction button backwards, an artifact the remount never produced.
    //   basePrices - the shared native-price subscription, not token-scoped;
    //     clearing it would blank the USD estimates until the next 30s tick.
    //   Zustand-backed preferences (slippage, quick chips, Details toggle) -
    //     those are user settings and survive by design.
  }, [tokenIdentity, initialMode])

  // Ensure the right-panel collapse toggle stays beneath dropdowns
  useEffect(() => {
    const open = showVolumeDropdown || showLiquidityDropdown
    document.body.classList.toggle('right-panel-dropdown-open', open)
    return () => {
      document.body.classList.remove('right-panel-dropdown-open')
    }
  }, [showVolumeDropdown, showLiquidityDropdown])

  // Resolve key token properties early - needed by both swap panel and stats sections
  const isCoinGeckoToken = !token?.address || ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC'].includes((token?.symbol || '').toUpperCase())
  const tokenSymbol = isCoinGeckoToken
    ? (token?.symbol || 'TOKEN')
    : (liveTokenData?.symbol || token?.symbol || 'TOKEN')
  const tokenPrice = isCoinGeckoToken
    ? (token?.price || 0)
    : (liveTokenData?.price || 0)
  const networkId = inferNetworkId(
    token?.address,
    isCoinGeckoToken ? token?.networkId : (liveTokenData?.networkId || token?.networkId)
  )
  const isSolana = networkId === 1399811149

  // Available tokens for swapping (real addresses, 0 balances until wallet connected)
  // Memoized to prevent new object reference every render (would cause infinite loop in useSwapExecution)
  const swapTokens = useMemo(() => ({
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      icon: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      color: '#627eea',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 18,
      address: 'native',
      chainId: 'ethereum'
    },
    USDT: {
      symbol: 'USDT',
      name: 'Tether',
      icon: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
      color: '#26A17B',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 6,
      address: COMMON_TOKENS.ethereum?.USDT?.address || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      chainId: 'ethereum'
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
      color: '#2775CA',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 6,
      address: COMMON_TOKENS.ethereum?.USDC?.address || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 'ethereum'
    },
    SOL: {
      symbol: 'SOL',
      name: 'Solana',
      icon: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
      color: '#9945FF',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 9,
      address: 'native',
      chainId: 'solana'
    },
    'USDC-SOL': {
      symbol: 'USDC',
      name: 'USD Coin (Solana)',
      icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
      color: '#2775CA',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 6,
      address: COMMON_TOKENS.solana?.USDC?.address || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      chainId: 'solana'
    },
    'USDT-SOL': {
      symbol: 'USDT',
      name: 'Tether (Solana)',
      icon: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
      color: '#26A17B',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 6,
      address: COMMON_TOKENS.solana?.USDT?.address || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      chainId: 'solana'
    },
    BNB: {
      symbol: 'BNB',
      name: 'BNB',
      icon: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
      color: '#F3BA2F',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 18,
      address: 'native',
      chainId: 'bsc'
    },
    'USDC-BSC': {
      symbol: 'USDC',
      name: 'USD Coin (BNB Chain)',
      icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
      color: '#2775CA',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: COMMON_TOKENS.bsc?.USDC?.decimals ?? 18,
      address: COMMON_TOKENS.bsc?.USDC?.address || '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      chainId: 'bsc'
    },
    'ETH-BASE': {
      symbol: 'ETH',
      name: 'Ethereum (Base)',
      icon: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      color: '#0052FF',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 18,
      address: 'native',
      chainId: 'base'
    },
    'USDC-BASE': {
      symbol: 'USDC',
      name: 'USD Coin (Base)',
      icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
      color: '#2775CA',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: COMMON_TOKENS.base?.USDC?.decimals ?? 6,
      address: COMMON_TOKENS.base?.USDC?.address || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      chainId: 'base'
    },
    POL: {
      symbol: 'POL',
      name: 'Polygon',
      icon: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
      color: '#8247E5',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 18,
      address: 'native',
      chainId: 'polygon'
    },
    'USDC-POLY': {
      symbol: 'USDC',
      name: 'USD Coin (Polygon)',
      icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
      color: '#2775CA',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: COMMON_TOKENS.polygon?.USDC?.decimals ?? 6,
      address: COMMON_TOKENS.polygon?.USDC?.address || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      chainId: 'polygon'
    },
    'ETH-ARB': {
      symbol: 'ETH',
      name: 'Ethereum (Arbitrum)',
      icon: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      color: '#28A0F0',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 18,
      address: 'native',
      chainId: 'arbitrum'
    },
    'USDC-ARB': {
      symbol: 'USDC',
      name: 'USD Coin (Arbitrum)',
      icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
      color: '#2775CA',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: COMMON_TOKENS.arbitrum?.USDC?.decimals ?? 6,
      address: COMMON_TOKENS.arbitrum?.USDC?.address || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      chainId: 'arbitrum'
    },
    // Robinhood Chain (Arbitrum Orbit L2) - ETH is the gas + native pay token.
    // 0x routes token buys/sells against ETH here (Uniswap-on-RH liquidity).
    'ETH-HOOD': {
      symbol: 'ETH',
      name: 'Ethereum (Robinhood Chain)',
      icon: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      color: '#00C805',
      balance: 0,
      balanceUsd: 0,
      price: 0,
      decimals: 18,
      address: 'native',
      chainId: 'robinhood'
    },
  }), []) // Static structure - prices updated below

  // Live prices for base swap tokens via the SHARED native-prices store
  // (one 30s poller for the whole token page - DataTabs + UserDashboard
  // consume the same poll instead of running their own).
  const [basePrices, setBasePrices] = useState({})
  useEffect(() => {
    return subscribeNativePrices((raw) => {
      const prices = {}
      for (const [sym, v] of Object.entries(raw)) prices[sym] = v
      // Same asset priced across its L2 entries (map keys, not symbols)
      prices['ETH-BASE'] = prices.ETH || 0
      prices['ETH-ARB'] = prices.ETH || 0
      // Stables are always $1 (every chain's entry key)
      prices.USDT = 1; prices['USDT-SOL'] = 1
      prices.USDC = 1; prices['USDC-SOL'] = 1
      prices['USDC-BSC'] = 1; prices['USDC-BASE'] = 1
      prices['USDC-POLY'] = 1; prices['USDC-ARB'] = 1
      setBasePrices(prices)
    })
  }, [])

  // Fetch token tax from QuickIntel
  const [tokenTax, setTokenTax] = useState(null)
  const tokenAddress = token?.address
  useEffect(() => {
    // Clear BEFORE the guard: the early return below fires when the new token
    // has no address, which would otherwise leave the previous token's tax /
    // honeypot verdict in state. That verdict gates the BUY button, so a stale
    // `isHoneypot` from token A would block a legitimate buy on token B.
    setTokenTax(null)
    if (!tokenAddress || tokenAddress === 'native') return
    let cancelled = false
    // Idle-defer: tax badges render below the fold; keep the first-second
    // connection pool for the snapshot/bars critical path. Cached 24h
    // (module + localStorage) - tax config is immutable-ish per contract.
    const cancelIdle = whenIdle(() => {
      if (cancelled) return
      fetchTokenTaxCached(tokenAddress, networkId)
        .then(data => {
          if (!cancelled && data) setTokenTax(data)
        })
        .catch(err => console.warn('[tokenTax] fetch failed:', err))
    }, { timeout: 2500 })
    return () => { cancelled = true; cancelIdle() }
  }, [tokenAddress, networkId])

  // The "target token" for the swap panel - the token being viewed on this page.
  // Resolves address, decimals, and chain from real token data (Codex or CoinGecko).
  // NULL when the token's chain has no swap route (Avalanche, Optimism,
  // Fantom, Cronos, PulseChain, Blast - all reachable from discovery). This
  // used to end `: 'ethereum'`, which quoted those tokens' addresses against
  // MAINNET and slipped past the cross-chain guard in lib/swapParams.js.
  // A missing networkId still means "major / CoinGecko token" -> ethereum,
  // which is how BTC/ETH-class assets have always resolved here.
  const targetChainId = isSolana ? 'solana'
    : (networkId == null ? 'ethereum' : chainForNetworkId(networkId))
  const chainUnsupported = !targetChainId
  // Name the chain in the block message. networkId is all we have once
  // chainForNetworkId has refused it, so fall back through the token's own
  // label before showing the raw id.
  const chainLabel = CHAIN_LABELS[targetChainId]
    || token?.chainName || token?.network
    || (networkId != null ? `network ${networkId}` : 'this network')
  const spectreToken = {
    symbol: tokenSymbol,
    name: isCoinGeckoToken ? (token?.name || '') : (liveTokenData?.name || token?.name || ''),
    icon: isCoinGeckoToken ? (token?.logo || '') : (liveTokenData?.logo || token?.logo || getHardcodedLogo(token?.address) || ''),
    color: getTokenColor(token?.symbol, token?.address),
    balance: 0,
    balanceUsd: 0,
    price: tokenPrice,
    decimals: isCoinGeckoToken ? 18 : (liveTokenData?.decimals || token?.decimals || 18),
    address: token?.address || 'native',
    chainId: targetChainId,
    networkId,
  }
  
  // Decimal validation helper
  const validateDecimalInput = (value, maxDecimals) => {
    // Allow empty string
    if (value === '') return ''
    
    // Only allow numbers and one decimal point
    const regex = new RegExp(`^\\d*\\.?\\d{0,${maxDecimals}}$`)
    
    // Remove any non-numeric characters except decimal
    let cleaned = value.replace(/[^0-9.]/g, '')
    
    // Ensure only one decimal point
    const parts = cleaned.split('.')
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('')
    }
    
    // Limit decimal places
    if (parts.length === 2 && parts[1].length > maxDecimals) {
      cleaned = parts[0] + '.' + parts[1].slice(0, maxDecimals)
    }
    
    // Prevent leading zeros (except for decimals like 0.xx)
    if (cleaned.length > 1 && cleaned[0] === '0' && cleaned[1] !== '.') {
      cleaned = cleaned.slice(1)
    }
    
    return cleaned
  }
  
  // Format output with appropriate decimals
  const formatOutput = (value, decimals) => {
    if (!value || isNaN(value)) return ''
    const num = parseFloat(value)
    if (num === 0) return '0'
    
    // For very small numbers, show more decimals
    if (num < 0.0001) return num.toFixed(Math.min(decimals, 8))
    if (num < 1) return num.toFixed(Math.min(decimals, 6))
    if (num < 100) return num.toFixed(Math.min(decimals, 4))
    return num.toFixed(2)
  }

  const currentPayToken = useMemo(() => {
    const base = swapTokens[selectedPayToken]
    if (!base) return swapTokens.ETH
    return { ...base, price: basePrices[selectedPayToken] || base.price }
  }, [swapTokens, selectedPayToken, basePrices])

  // Wire up swap execution (quotes, wallet, trade)
  const {
    walletConnected, walletReady, walletAddress, payTokenBalance,
    quote, quoteLoading, quoteError, outputAmount: quoteOutputAmount, fetchQuote, getSwapParams,
    isSwapping, swapSuccess, swapSummary, swapError, txHash, doSwap,
    platformFee, priceImpact, routePlan,
  } = useSwapExecution({ token: spectreToken, mode, payToken: currentPayToken, slippageBps: swapPrefs.slippageBps })

  // Pre-trade safety simulation: dry-run the CURRENT quote (no signature, no
  // gas) and surface whether it would execute or revert - catches honeypots,
  // sell taxes, transfer restrictions and stale/thin-liquidity routes before the
  // user signs a doomed, gas-burning tx.
  const runSimulation = useCallback(async () => {
    if (!walletAddress || simulating) return
    // Build the sim params from the CURRENT token/mode/amount directly - NOT from
    // the display quote. The quote is null on thin / slow-to-quote tokens (the
    // Receive amount is then just a price estimate), which is exactly where you
    // want to simulate. The simulate endpoint re-quotes server-side anyway.
    const amt = String(payAmount || '').replace(/,/g, '')
    const built = getSwapParams(amt, { withTaker: true })
    if (!built?.params) {
      setSimResult({ ok: null, inconclusive: true, reason: built?.error || 'Enter an amount to simulate.' })
      return
    }
    // Stamp the run. The panel no longer unmounts on a token switch, so a
    // verdict for token A would otherwise land as a "safe" badge on token B.
    const epoch = tokenEpochRef.current
    setSimulating(true)
    setSimResult(null)
    try {
      const r = await simulateSwap({ ...built.params, userAddress: walletAddress })
      if (tokenEpochRef.current !== epoch) return
      setSimResult(r)
    } finally {
      // Only release the busy flag if this run is still the current one -
      // otherwise it would clobber a simulation already started for the new token.
      if (tokenEpochRef.current === epoch) setSimulating(false)
    }
  }, [getSwapParams, payAmount, walletAddress, simulating])

  // Invalidate a prior verdict whenever the trade being described changes, so a
  // stale "safe" never lingers over a different amount/token/side.
  useEffect(() => { setSimResult(null) }, [quote?.inputAmount, quote?.inputToken, quote?.outputToken, mode])

  // Get real volume and change data from API
  const realVolume24 = liveTokenData?.volume24 || 0
  // Real per-window change from Codex hourly bars - the reliable on-chain source
  // for every window (see useBarChangeWindows).
  const barWindows = useBarChangeWindows(tokenAddress, networkId)
  // Every window prefers the bars. The detail endpoint is MIXED-UNIT/unreliable
  // (change24 arrives percent OR ratio; 4h/12h empty for thin tokens) so it's
  // only a fallback, normalized through readCodexChangePct's heuristic.
  // Downstream expects numbers so an unavailable window coerces to 0.
  const realChange1h = (barWindows?.change1h ?? readCodexChangePct(liveTokenData?.change1h)) ?? 0
  const realChange4h = (barWindows?.change4h ?? readCodexChangePct(liveTokenData?.change4h)) ?? 0
  const realChange12h = (barWindows?.change12h ?? readCodexChangePct(liveTokenData?.change12h)) ?? 0
  const rawChange24 = liveTokenData?.change24 ?? token?.change24h ?? token?.change ?? 0
  const realChange24 = (barWindows?.change24h ?? readCodexChangePct(rawChange24)) ?? 0
  
  // Helper to format volume
  const formatVolume = (vol) => {
    if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B'
    if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M'
    if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K'
    return vol.toFixed(0)
  }

  // Helper to format change percentage (API returns values already as percentages)
  const formatChangePercent = (change) => {
    const pct = change.toFixed(2)
    return change >= 0 ? `+${pct}%` : `${pct}%`
  }

  // Estimate volume for different timeframes based on 24h volume
  // These are approximations - in production would come from API.
  // useMemo: (a) stable identity so the memoized DexStatsBoard doesn't
  // re-render on every swap keystroke/quote tick, (b) freezes the random
  // buys/sells estimates per data update instead of reshuffling them on
  // every render (they used to visibly jitter while typing).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const volumeTimeframes = useMemo(() => [
    { 
      period: '5M', 
      volume: formatVolume(realVolume24 * 0.004), // ~0.4% of 24h
      volumeRaw: realVolume24 * 0.004,
      change: formatChangePercent(realChange1h * 0.1), 
      positive: realChange1h >= 0, 
      buys: Math.floor(Math.random() * 10) + 5, 
      sells: Math.floor(Math.random() * 8) + 3, 
      buyVol: realChange1h >= 0 ? 55 + Math.floor(Math.random() * 15) : 35 + Math.floor(Math.random() * 15) 
    },
    { 
      period: '1H', 
      volume: formatVolume(realVolume24 * 0.042), // ~4.2% of 24h
      volumeRaw: realVolume24 * 0.042,
      change: formatChangePercent(realChange1h), 
      positive: realChange1h >= 0, 
      buys: Math.floor(Math.random() * 20) + 15, 
      sells: Math.floor(Math.random() * 18) + 12, 
      buyVol: realChange1h >= 0 ? 52 + Math.floor(Math.random() * 12) : 38 + Math.floor(Math.random() * 12) 
    },
    { 
      period: '4H', 
      volume: formatVolume(realVolume24 * 0.167), // ~16.7% of 24h
      volumeRaw: realVolume24 * 0.167,
      change: formatChangePercent(realChange4h), 
      positive: realChange4h >= 0, 
      buys: Math.floor(Math.random() * 60) + 50, 
      sells: Math.floor(Math.random() * 55) + 45, 
      buyVol: realChange4h >= 0 ? 50 + Math.floor(Math.random() * 10) : 40 + Math.floor(Math.random() * 10) 
    },
    { 
      period: '12H', 
      volume: formatVolume(realVolume24 * 0.5), // ~50% of 24h
      volumeRaw: realVolume24 * 0.5,
      change: formatChangePercent(realChange12h), 
      positive: realChange12h >= 0, 
      buys: Math.floor(Math.random() * 120) + 100, 
      sells: Math.floor(Math.random() * 110) + 90, 
      buyVol: realChange12h >= 0 ? 48 + Math.floor(Math.random() * 8) : 42 + Math.floor(Math.random() * 8) 
    },
    { 
      period: '24H', 
      volume: formatVolume(realVolume24), // Full 24h volume
      volumeRaw: realVolume24,
      change: formatChangePercent(realChange24), 
      positive: realChange24 >= 0, 
      buys: Math.floor(Math.random() * 250) + 200, 
      sells: Math.floor(Math.random() * 240) + 190, 
      buyVol: realChange24 >= 0 ? 46 + Math.floor(Math.random() * 8) : 44 + Math.floor(Math.random() * 8) 
    },
  ], [realVolume24, realChange1h, realChange4h, realChange12h, realChange24])

  const selectedTimeframe = volumeTimeframes.find(t => t.period === volumePeriod) || volumeTimeframes[4]

  // Get real liquidity from API
  const realLiquidity = liveTokenData?.liquidity || 0
  
  // Determine base token and DEX based on network
  const isEthereum = networkId === 1
  const baseToken = isSolana ? 'SOL' : 'ETH'
  const baseDex = isSolana ? 'Raydium' : 'Uniswap V3'
  
  // Calculate pooled amounts (estimates based on liquidity / 2 for each side)
  const halfLiquidity = realLiquidity / 2
  const basePrice = isSolana ? 100 : 3200 // Approx SOL/ETH prices
  const pooledBaseAmount = halfLiquidity / basePrice
  const pooledTokenAmount = tokenPrice > 0 ? halfLiquidity / tokenPrice : 0

  // Liquidity data from API (memoized - stable prop for DexStatsBoard,
  // random depth estimate frozen per data update)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liquidityData = useMemo(() => {
    const d = {
    // `formatLargeNumber` already includes the "$" prefix
    total: formatLargeNumber(realLiquidity),
    totalRaw: realLiquidity,
    pooledToken: `${formatLargeNumber(pooledTokenAmount)} ${tokenSymbol}`,
    pooledBase: `${pooledBaseAmount.toFixed(2)} ${baseToken}`,
    dex: baseDex,
    dexLogo: isSolana 
      ? 'https://raydium.io/logo/logo.svg'
      : 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg',
    pair: `${tokenSymbol}/${baseToken}`,
    pairAddress: (liveTokenData?.address?.slice(0, 10) + '...' + liveTokenData?.address?.slice(-4) || 'N/A'),
    lpHolders: Math.floor(liveTokenData?.holders * 0.02) || 50, // Estimate ~2% of holders are LPs
    // Lock information (this would ideally come from a liquidity lock API like Unicrypt/Team.Finance)
    isLocked: realLiquidity > 100000, // Assume locked if liquidity > 100k
    lockPercentage: realLiquidity > 1000000 ? 85 : realLiquidity > 100000 ? 60 : 0,
    locks: realLiquidity > 100000 ? [
      { 
        platform: isSolana ? 'Streamflow' : 'Unicrypt', 
        amount: formatLargeNumber(realLiquidity * 0.6), 
        percentage: 60, 
        unlockDate: '2027-01-15',
        daysLeft: 362,
        logo: '🔐'
      },
    ] : [],
    unlockedAmount: formatLargeNumber(realLiquidity * (realLiquidity > 100000 ? 0.4 : 1)),
    unlockedPercentage: realLiquidity > 100000 ? 40 : 100,
    // Pool depth - estimate based on price change direction
    depthBuy: realChange24 >= 0 ? 55 + Math.floor(Math.random() * 10) : 45 + Math.floor(Math.random() * 10),
    depthSell: 0, // Will be calculated
    // 24h changes
    change24h: formatChangePercent(realChange24 * 0.5), // Liquidity change ~half of price change
    changePositive: realChange24 >= 0,
    added24h: formatLargeNumber(realLiquidity * 0.02),
    removed24h: formatLargeNumber(realLiquidity * 0.015),
    }
    d.depthSell = 100 - d.depthBuy
    return d
  }, [realLiquidity, tokenSymbol, baseToken, baseDex, isSolana, tokenPrice,
      pooledTokenAmount, pooledBaseAmount, realChange24,
      liveTokenData?.address, liveTokenData?.holders])

  // Update receive amount from real quote, or fallback to price estimate.
  // While the REAL quote is in flight, paint a spot-price estimate instantly
  // (same math as the error fallback) so typing feels millisecond-fast even
  // when the aggregator takes a second - the true quote overwrites on arrival.
  useEffect(() => {
    if (activeInput !== 'pay') return
    if (quoteOutputAmount) {
      // Limit to 3 decimal places for clean display
      const num = parseFloat(quoteOutputAmount)
      setReceiveAmount(!isNaN(num) ? num.toLocaleString(undefined, { maximumFractionDigits: 3 }) : quoteOutputAmount)
    } else if (quoteError) {
      // A FAILED quote must not leave a number in the Receive box. This used
      // to fall through to the spot estimate below, so an unsupported chain, a
      // 422 price-impact refusal, a 429 or an 8s timeout all painted a
      // confident-looking amount the user could not actually get - and the
      // failure only surfaced on click. Blank it and let the error render.
      setReceiveAmount('')
    } else if (quoteLoading && payAmount && tokenPrice > 0) {
      const payVal = parseFloat(payAmount)
      if (payVal > 0) {
        if (mode === 'buy') {
          // buy: token out ~= (paidNative x nativePrice) / tokenPrice
          const payUsd = payVal * (currentPayToken.price || 0)
          if (payUsd > 0) setReceiveAmount((payUsd / tokenPrice).toLocaleString(undefined, { maximumFractionDigits: 3 }))
        } else {
          // sell: native out ~= (tokenAmount x tokenPrice) / nativePrice. The old code
          // showed `payVal * tokenPrice` (the USD value) AS the ETH amount - wrong.
          const nativePrice = currentPayToken.price || 0
          if (nativePrice > 0) setReceiveAmount(((payVal * tokenPrice) / nativePrice).toLocaleString(undefined, { maximumFractionDigits: 6 }))
        }
      }
    }
  }, [quoteOutputAmount, quoteError, quoteLoading, activeInput, payAmount, tokenPrice, mode, currentPayToken.price])

  const handlePayChange = (e) => {
    const payTokenObj = mode === 'buy' ? currentPayToken : spectreToken

    // Validate and clean input
    const validated = validateDecimalInput(e.target.value, payTokenObj.decimals)
    setActiveInput('pay')
    setPayAmount(validated)

    // Fetch real quote from Jupiter/0x (debounced inside hook)
    fetchQuote(validated)

    // Clear receive while quote loads
    if (!validated || parseFloat(validated) <= 0) {
      setReceiveAmount('')
    }
  }

  // Re-quote (or clear) whenever the trade direction flips. The previous
  // mode's quote prices the OPPOSITE pair - left alone it renders absurd
  // receive values (the 347k-Kimchiloq buy output re-read as 347.855 SOL)
  // and would only be caught at execution by the staleness guard. Runs
  // after render so fetchQuote closes over the NEW mode's params.
  useEffect(() => {
    const amt = String(payAmount || '').replace(/,/g, '')
    if (amt && parseFloat(amt) > 0) {
      fetchQuote(amt, { immediate: true })
    } else {
      fetchQuote('')
    }
    // Deliberately mode-only: amount edits already quote via handlePayChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Quote keep-alive. The quote carries the Jupiter-built transaction whose
  // blockhash expires in ~60-90s - and with preflight skipped for speed, a
  // stale tx would be dropped SILENTLY (no early error, just a confirmation
  // timeout). Refreshing the sitting quote every 25s keeps the blockhash
  // live and the displayed price honest. Hidden/idle tabs skip.
  useEffect(() => {
    const amt = String(payAmount || '').replace(/,/g, '')
    if (!quote || !amt || parseFloat(amt) <= 0 || isSwapping) return undefined
    const id = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      fetchQuote(amt, { immediate: true, background: true })
    }, 25000)
    return () => clearInterval(id)
    // quote identity changes on every refresh, re-arming the interval - so
    // the next refresh is always 25s after the LAST quote, typed or timed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, payAmount, isSwapping])

  // Re-quote silently when the user changes their slippage setting - the
  // quote (and its built tx) embeds the tolerance.
  useEffect(() => {
    const amt = String(payAmount || '').replace(/,/g, '')
    if (amt && parseFloat(amt) > 0) {
      fetchQuote(amt, { immediate: true, background: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapPrefs.slippageBps])

  const handleReceiveChange = (e) => {
    const receiveTokenObj = mode === 'buy' ? spectreToken : currentPayToken

    // Validate and clean input
    const validated = validateDecimalInput(e.target.value, receiveTokenObj.decimals)
    setActiveInput('receive')
    setReceiveAmount(validated)

    // For receive-side input, we don't fetch quote (would need reverse quote).
    // Clear pay amount - user should use pay-side input for real quotes.
    if (!validated || parseFloat(validated) <= 0) {
      setPayAmount('')
    }
  }

  // Format large numbers for display
  const formatStatValue = (value) => {
    if (!value || isNaN(value)) return '-'
    const num = parseFloat(value)
    const abs = Math.abs(num)
    if (abs >= 1e12) return (num / 1e12).toFixed(2) + 'T'
    if (abs >= 1e9) return (num / 1e9).toFixed(2) + 'B'
    if (abs >= 1e6) return (num / 1e6).toFixed(2) + 'M'
    if (abs >= 1e3) return (num / 1e3).toFixed(2) + 'K'
    if (abs >= 1) return num.toFixed(2)
    return num.toPrecision(4)
  }
  
  // Format supply numbers
  const formatSupply = (value) => {
    if (!value || isNaN(value)) return '-'
    const num = parseFloat(value)
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T'
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B'
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M'
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K'
    return num.toFixed(0)
  }

  // Calculate FDV (Fully Diluted Valuation) = price * total supply
  const calculateFDV = () => {
    const totalSupply = liveTokenData?.totalSupply || 0
    const price = liveTokenData?.price || 0
    const circSupply = liveTokenData?.circulatingSupply ? parseFloat(liveTokenData.circulatingSupply) : 0
    
    if (totalSupply && price) {
      const totalSupplyNum = parseFloat(totalSupply)
      
      // Validate that totalSupply is a reasonable number (not raw blockchain value with 18 decimals)
      // If totalSupply is much larger than circulatingSupply (like 1e18 times larger), it's likely raw
      if (circSupply > 0 && totalSupplyNum > circSupply * 1000) {
        // totalSupply looks like raw blockchain value (not divided by decimals) — skip
        return null
      }
      
      // If totalSupply is smaller than circulatingSupply, something is wrong - skip it
      if (circSupply > 0 && totalSupplyNum < circSupply * 0.99) {
        // totalSupply less than circulatingSupply — data inconsistency, skip
        return null
      }
      
      return price * totalSupplyNum
    }
    return null
  }
  
  // Get market cap, supply, and other stats from API
  // Recalculate mcap from live price when stream is active (polled mcap lags behind)
  const marketCap = (() => {
    const polledMcap = liveTokenData?.marketCap || 0
    const circSupply = parseFloat(liveTokenData?.circulatingSupply) || 0
    const livePrice = liveTokenData?.price || 0
    if (liveTokenData?._priceSource === 'stream' && circSupply > 0 && livePrice > 0) {
      return circSupply * livePrice
    }
    return polledMcap
  })()
  const circulatingSupply = liveTokenData?.circulatingSupply || 0
  const totalSupply = liveTokenData?.totalSupply || 0
  const volume24 = liveTokenData?.volume24 || 0
  const holders = liveTokenData?.holders || 0
  
  // Build stats data from real-time token data
  const isCoinGeckoSource = liveTokenData?._source === 'coingecko'

  // Real % changes from Codex:
  //   - MCap & FDV: derive from price change (mcap = price * supply, FDV =
  //     price * totalSupply — both move 1:1 with price for fixed-supply
  //     tokens, which is virtually all of them in scope here).
  //   - Liquidity / 24h Volume / Holders / Circ. Supply: Codex's filterTokens
  //     query currently exposes only the *current* values (no
  //     liquidityChange24 / volumeChange24 / holdersChange24 fields). Until a
  //     historical-bars derivation lands (Phase 2), we hide those change
  //     badges instead of fabricating them.
  const fdvValue = useMemo(calculateFDV, [liveTokenData?.totalSupply, liveTokenData?.price, liveTokenData?.circulatingSupply]) // eslint-disable-line react-hooks/exhaustive-deps
  // Hide FDV when it's effectively identical to MCap (fully-circulating supply).
  const showFdv = fdvValue && marketCap && Math.abs(fdvValue - marketCap) / marketCap > 0.01
  const statsData = [
    {
      label: 'MCap',
      value: marketCap ? formatStatValue(marketCap) : '-',
      change: realChange24,
      loading: tokenLoading
    },
    ...(showFdv ? [{
      label: 'FDV',
      value: formatStatValue(fdvValue),
      change: realChange24,
      loading: tokenLoading
    }] : []),
    {
      label: isCoinGeckoSource ? 'Volume' : 'Liquidity',
      value: realLiquidity ? formatStatValue(realLiquidity) : '-',
      change: null, // TODO: derive from historical liquidity bars
      loading: tokenLoading
    },
    {
      label: 'Circ. Supply',
      value: circulatingSupply ? formatSupply(circulatingSupply) : '-',
      change: null,
      loading: tokenLoading
    },
    {
      label: '24h Volume',
      value: volume24 ? formatStatValue(volume24) : '-',
      change: null, // TODO: derive from prior-24h volume comparison
      loading: tokenLoading
    },
    {
      label: 'Holders',
      value: holders ? formatSupply(holders) : 'N/A',
      change: null,
      loading: tokenLoading
    },
  ]

  const isAnyStatsDropdownOpen = showVolumeDropdown || showLiquidityDropdown

  // Panel sub-parts (Zone Stacks granularity): overview / swap / volume /
  // security reorder via flex `order` and hide via display:none - nothing
  // re-parents, all state (and the swap flow) survives any arrangement.
  const tradeParts = layoutParts || { order: ['overview', 'swap', 'volume', 'security'], hidden: [] }
  const partStyle = (id) => ({
    order: Math.max(0, tradeParts.order.indexOf(id)),
    display: tradeParts.hidden.includes(id) ? 'none' : undefined,
  })

  // GMGN-feel: the Buy/Sell flip activates on mouse POINTERDOWN (the ~60-100ms
  // press-to-release gap is pure perceived lag on a reversible toggle).
  // Touch/keyboard keep the click path; the ref swallows the paired click so
  // the mode never double-toggles. Never applied to money actions.
  const modeDownRef = useRef(null)
  const activateMode = (next) => {
    if (mode === next) return
    setMode(next)
    setPayAmount('')
    setReceiveAmount('')
  }
  const modePointerDown = (next) => (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    modeDownRef.current = next
    activateMode(next)
  }
  const modeClick = (next) => () => {
    if (modeDownRef.current === next) { modeDownRef.current = null; return }
    activateMode(next)
  }

  // Stable handlers so the memoized TokenIdentityCard actually bails out on
  // swap keystrokes/quote ticks (inline arrows re-created per render were
  // defeating its React.memo).
  const handleLogoClick = useCallback(() => setShowLogoFullView(true), [])
  const handleCustomizeClick = useCallback(() => triggerCopyToast('Coming Soon'), [triggerCopyToast])

  return (
    <div className={`right-panel ${isAnyStatsDropdownOpen ? 'dropdown-open' : ''}`}>
      {/* OL Iteration 3 — TokenIdentityCard. Lifts the identity layout
          out of inline JSX so it can grow X-banner image + duotone tint +
          parallax. The procedural gradient fallback is preserved inside
          the component for tokens without a dossier-supplied banner URL. */}
      <div className="rp-part" data-part="overview" style={partStyle('overview')}>
      <TokenIdentityCard
        token={token}
        liveTokenData={liveTokenData}
        bannerColor={bannerColor}
        isReady={bannerColor !== NEUTRAL}
        onLogoClick={handleLogoClick}
        onCustomizeClick={handleCustomizeClick}
      />

      {/* OL Iteration 2 — Vitals Bento replaces the flat 6-stat panel.
          Each tile pairs a mono value with a visual that ENCODES it. */}
      <VitalsBento
        token={token}
        marketCap={marketCap}
        realChange24={realChange24}
        realLiquidity={realLiquidity}
        circulatingSupply={circulatingSupply}
        totalSupply={totalSupply}
        volume24={volume24}
        holders={holders}
        tokenLoading={tokenLoading}
        isCoinGeckoSource={isCoinGeckoSource}
        currentPrice={liveTokenData?.price || token?.price || 0}
        low24={liveTokenData?.low24}
        high24={liveTokenData?.high24}
        ath={liveTokenData?.ath}
        athChangePct={liveTokenData?.athChangePct}
        athDate={liveTokenData?.athDate}
      />
      </div>
      {/* OL Iteration 3 — the dead .market-stats fallback block
          (legacy v1 dropdown JSX) has been removed; VitalsBento is the
          sole stat surface now. */}

      {/* Stat Dropdowns - rendered outside the grid so they don't cover trigger buttons */}
      {showVolumeDropdown && (
        <div className="volume-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="vol-header">
            <div className="vol-main">
              <span className="vol-amount">${selectedTimeframe.volume}</span>
              <span className={`vol-change ${selectedTimeframe.positive ? 'up' : 'down'}`}>
                {selectedTimeframe.change}
              </span>
            </div>
            <span className="vol-period-label">{volumePeriod} Volume</span>
          </div>
          <div className="vol-timeframes">
            {volumeTimeframes.map((tf) => (
              <button
                key={tf.period}
                className={`tf-pill ${volumePeriod === tf.period ? 'active' : ''}`}
                onClick={() => setVolumePeriod(tf.period)}
              >
                {tf.period}
              </button>
            ))}
          </div>
          <div className="vol-pressure">
            <div className="pressure-header">
              <span className="pressure-title">Buy/Sell Pressure</span>
              <span className="pressure-ratio">{selectedTimeframe.buyVol}% / {100 - selectedTimeframe.buyVol}%</span>
            </div>
            <div className="pressure-bar">
              <div className="pressure-fill buy" style={{ width: `${selectedTimeframe.buyVol}%` }}>
                <span className="pressure-label">BUY</span>
              </div>
              <div className="pressure-fill sell" style={{ width: `${100 - selectedTimeframe.buyVol}%` }}>
                <span className="pressure-label">SELL</span>
              </div>
            </div>
          </div>
          <div className="vol-txns">
            <div className="txn-box buy">
              <span className="txn-count">{selectedTimeframe.buys}</span>
              <span className="txn-label">Buys</span>
            </div>
            <div className="txn-box sell">
              <span className="txn-count">{selectedTimeframe.sells}</span>
              <span className="txn-label">Sells</span>
            </div>
            <div className="txn-box total">
              <span className="txn-count">{selectedTimeframe.buys + selectedTimeframe.sells}</span>
              <span className="txn-label">Total Txns</span>
            </div>
          </div>
          <div className="vol-comparison">
            <span className="comparison-title">Volume by Timeframe</span>
            <div className="comparison-bars">
              {volumeTimeframes.map((tf) => (
                <div
                  key={tf.period}
                  className={`comp-bar ${volumePeriod === tf.period ? 'active' : ''}`}
                  onClick={() => setVolumePeriod(tf.period)}
                >
                  <div
                    className="comp-fill"
                    style={{
                      height: `${(parseFloat(tf.volume) / 30) * 100}%`,
                      background: tf.positive
                        ? 'linear-gradient(180deg, #6EE7B7, #047857)'
                        : 'linear-gradient(180deg, #FCA5A5, #B91C1C)'
                    }}
                  ></div>
                  <span className="comp-label">{tf.period}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showLiquidityDropdown && (
        <div className="liquidity-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="liq-head">
            <div className="liq-head-top">
              <div className="liq-title">
                <span className="liq-title-icon" aria-hidden="true">
                  <Icon name="wallet" size={14} />
                </span>
                <span>Total Liquidity</span>
              </div>
              <div className="liq-metric">
                <span className="liq-amount">{liquidityData.total}</span>
                <span className={`liq-delta ${liquidityData.changePositive ? 'up' : 'down'}`}>
                  <Icon name={liquidityData.changePositive ? 'trending-up' : 'trending-down'} size={14} />
                  {liquidityData.change24h}
                </span>
              </div>
            </div>
            <div className="liq-meta" aria-label="Liquidity metadata">
              <span className="liq-meta-item">
                <Icon name="trade" size={14} />
                {liquidityData.dex}
              </span>
              <span className="liq-meta-dot" aria-hidden="true">•</span>
              <span className="liq-meta-item">
                <Icon name="swap" size={14} />
                {liquidityData.pair}
              </span>
              <span className="liq-meta-dot" aria-hidden="true">•</span>
              <span className="liq-meta-item">
                <Icon name="profile" size={14} />
                {liquidityData.lpHolders} LPs
              </span>
            </div>
          </div>
          <div className="liq-grid">
            <section className="liq-card liq-card--pool" aria-label="Pool">
              <div className="liq-card-hd">
                <div className="liq-card-title">
                  <Icon name="defi" size={14} />
                  Pool
                </div>
              </div>
              <div className="liq-kv">
                <div className="liq-kv-row">
                  <span className="liq-k">Pooled {tokenSymbol}</span>
                  <span className="liq-v">{liquidityData.pooledToken}</span>
                </div>
                <div className="liq-kv-row">
                  <span className="liq-k">Pooled {baseToken}</span>
                  <span className="liq-v">{liquidityData.pooledBase}</span>
                </div>
              </div>
            </section>
            <section className="liq-card liq-card--lock" aria-label="Liquidity lock">
              <div className="liq-card-hd">
                <div className="liq-card-title">
                  <Icon name="shield" size={14} />
                  Lock
                </div>
                <span className={`liq-pill ${liquidityData.isLocked ? 'pos' : ''}`}>{liquidityData.lockPercentage}%</span>
              </div>
              <div className="lock-progress" aria-label="Lock percentage">
                <div className="lock-fill locked" style={{ width: `${liquidityData.lockPercentage}%` }}></div>
                <div className="lock-fill unlocked" style={{ width: `${liquidityData.unlockedPercentage}%` }}></div>
              </div>
              <div className="liq-kv">
                {liquidityData.locks.map((lock, idx) => (
                  <div key={idx} className="liq-kv-row">
                    <span className="liq-k">
                      {lock.platform}
                      <span className="liq-k-sub">{lock.daysLeft}d</span>
                    </span>
                    <span className="liq-v">{lock.amount}</span>
                  </div>
                ))}
                <div className="liq-kv-row">
                  <span className="liq-k">
                    Unlocked
                    <span className="liq-k-sub">{liquidityData.unlockedPercentage}%</span>
                  </span>
                  <span className="liq-v">{liquidityData.unlockedAmount}</span>
                </div>
              </div>
            </section>
            <section className="liq-card liq-card--depth" aria-label="Depth">
              <div className="liq-card-hd">
                <div className="liq-card-title">
                  <Icon name="analytics" size={14} />
                  Depth
                </div>
                <span className="liq-pill">{liquidityData.depthBuy}% / {liquidityData.depthSell}%</span>
              </div>
              <div className="depth-bar-main" aria-hidden="true">
                <div className="depth-fill buy" style={{ width: `${liquidityData.depthBuy}%` }}></div>
                <div className="depth-fill sell" style={{ width: `${liquidityData.depthSell}%` }}></div>
              </div>
              <div className="liq-legend">
                <div className="liq-legend-item buy">
                  <span className="liq-swatch" aria-hidden="true" />
                  <span className="liq-legend-label">Buy</span>
                  <span className="liq-legend-val">{liquidityData.depthBuy}%</span>
                </div>
                <div className="liq-legend-item sell">
                  <span className="liq-swatch" aria-hidden="true" />
                  <span className="liq-legend-label">Sell</span>
                  <span className="liq-legend-val">{liquidityData.depthSell}%</span>
                </div>
              </div>
            </section>
            <section className="liq-card liq-card--flow" aria-label="24h flow">
              <div className="liq-card-hd">
                <div className="liq-card-title">
                  <Icon name="calendar" size={14} />
                  24h Flow
                </div>
              </div>
              <div className="liq-kv">
                <div className="liq-kv-row">
                  <span className="liq-k">Added</span>
                  <span className="liq-v pos">{liquidityData.added24h}</span>
                </div>
                <div className="liq-kv-row">
                  <span className="liq-k">Removed</span>
                  <span className="liq-v neg">{liquidityData.removed24h}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* OL Iteration 3 §6 — right-rail order: identity → vitals →
          Buy/Sell → flow cluster → liquidity pool → deployer security.
          The Intelligence Card that previously sat here has moved to
          the centre TokenBanner header (HeaderDossier). */}

      {/* Trading Panel */}
      <div className={`trading-compact rp-part ${isSwapping ? 'swapping' : ''} ${swapSuccess ? 'success' : ''}`} data-part="swap" style={partStyle('swap')}>
        {/* Mode Toggle + Wallet inline (sits directly above the swap inputs) */}
        <div className="trade-toggle">
          {/* Amounts clear on switch - the sell-side quote prices the
              opposite pair and must never survive (the mode effect below
              resets the hook's quote state). */}
          <button
            className={`toggle-btn ${mode === 'buy' ? 'active buy' : ''}`}
            onPointerDown={modePointerDown('buy')}
            onClick={modeClick('buy')}
          >
            Buy
          </button>
          <button
            className={`toggle-btn ${mode === 'sell' ? 'active sell' : ''}`}
            onPointerDown={modePointerDown('sell')}
            onClick={modeClick('sell')}
          >
            Sell
          </button>

          {/* Trade-details switch - right side, next to the wallet chip.
              Only rendered once an amount is entered: with no amount there
              is no quote and nothing for the details rows to describe. */}
          {payAmount && parseFloat(payAmount) > 0 && (
            <>
              <button
                type="button"
                className={`sim-btn${simResult ? ` sim-btn--${simResult.ok === true ? 'ok' : simResult.ok === false ? 'fail' : 'warn'}` : ''}`}
                onClick={runSimulation}
                disabled={!walletAddress || simulating}
                title="Dry-run this trade on-chain (no signature, no gas) to check it will actually execute - catches honeypots, taxes and dead routes"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                <span>{simulating ? 'Testing…' : 'Simulate'}</span>
              </button>
              <button
                className={`details-toggle${showSwapDetails ? ' on' : ''}`}
                onClick={toggleSwapDetails}
                role="switch"
                aria-checked={showSwapDetails}
                title="Rate, price and price impact for the current quote"
              >
                <span className="dt-label">Details</span>
                <span className="dt-track" aria-hidden="true">
                  <span className="dt-knob" />
                </span>
              </button>
            </>
          )}

          {/* Wallet inline - right side */}
          {(() => {
            if (!authenticated) return null
            const linkedWallets = user?.linkedAccounts?.filter(a => a.type === 'wallet' && a.walletClientType === 'privy') || []
            const chainType = isSolana ? 'solana' : 'ethereum'
            const chainWallet = linkedWallets.find(w => (w.chainType || 'ethereum') === chainType) || linkedWallets[0]
            const displayAddr = chainWallet?.address || walletAddress
            if (!displayAddr) return null
            return (
              <>
                <div className="swap-wallet-inline">
                  <div className="swap-wallet-indicator" />
                  <span className="swap-wallet-chain">My Wallet</span>
                  <button
                    className="swap-wallet-eye"
                    onClick={() => setShowWalletAddr(prev => !prev)}
                    title={showWalletAddr ? 'Hide address' : 'Show address'}
                  >
                    {showWalletAddr ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
                {showWalletAddr && (
                  <span
                    className="swap-wallet-addr-inline"
                    onClick={() => { navigator.clipboard.writeText(displayAddr); triggerCopyToast('Address copied') }}
                    title="Click to copy"
                  >
                    {displayAddr}
                  </span>
                )}
              </>
            )
          })()}
        </div>

        {/* Pre-trade simulation verdict - shows the result of the Simulate button */}
        {(simulating || simResult) && (
          <div
            className={`sim-result${simResult ? ` sim-result--${simResult.ok === true ? 'ok' : simResult.ok === false ? 'fail' : 'warn'}` : ''}`}
            role="status"
          >
            <span className="sim-result-dot" aria-hidden="true" />
            <span className="sim-result-text">
              {simulating
                ? 'Simulating trade on-chain…'
                : simResult.ok === true
                  ? 'Simulation passed - this trade should execute.'
                  : simResult.ok === false
                    ? (simResult.reason || 'This trade would revert on-chain - nothing would be traded.')
                    : (simResult.reason || 'Could not simulate this trade right now.')}
            </span>
          </div>
        )}

        {/* Swap Container */}
        <div className="swap-container">
          {/* First Card - Changes based on mode */}
          <div className={`trade-card pay ${activeInput === 'pay' ? 'active' : ''}`}>
            <div className="card-header">
              <span className="card-label">{mode === 'buy' ? 'Pay' : 'Sell'}</span>
              <span className="balance-amount">
                {walletConnected
                  ? `${payTokenBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${mode === 'buy' ? currentPayToken.symbol : spectreToken.symbol}`
                  : `0 ${mode === 'buy' ? currentPayToken.symbol : spectreToken.symbol}`
                }
              </span>
            </div>
            <div className="card-content">
              <div className="input-wrapper">
            <input
              ref={payInputRef}
              type="text"
              placeholder="0.00"
              value={payAmount}
              onChange={handlePayChange}
                  onFocus={() => { setActiveInput('pay'); setShowPayTokens(false); }}
                  className="amount-input"
                />
                {payAmount && (
                  <span className="input-usd">
                    ~${(parseFloat(payAmount || 0) * (mode === 'buy' ? currentPayToken.price : tokenPrice)).toLocaleString(undefined, {maximumFractionDigits: 2})}
                  </span>
                )}
              </div>
              
              {mode === 'buy' ? (
                <div className="token-selector-wrapper">
                  <button 
                    className="token-selector"
                    onClick={() => setShowPayTokens(!showPayTokens)}
                    style={{ '--token-color': currentPayToken.color }}
                  >
                    <div className="token-icon">
                      <img src={currentPayToken.icon} alt={currentPayToken.symbol} />
                    </div>
                    <span className="token-name">{currentPayToken.symbol}</span>
                    <svg className={`selector-arrow ${showPayTokens ? 'open' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

                  {/* Pay Token Dropdown - filtered to target token's network.
                      Selection stores the MAP KEY, not the display symbol:
                      several entries share a symbol across chains (USDC on
                      ethereum/solana/base/...), and keying by symbol resolved
                      them all to the Ethereum entry. */}
                  {showPayTokens && (
                    <div className="token-dropdown">
                      {Object.entries(swapTokens).filter(([, t]) => t.chainId === spectreToken.chainId).map(([key, t]) => (
                        <button
                          key={key}
                          className={`token-option ${selectedPayToken === key ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedPayToken(key);
                            setShowPayTokens(false);
                          }}
                        >
                          <div className="token-option-icon">
                            <img src={t.icon} alt={t.symbol} />
                          </div>
                          <div className="token-option-info">
                            <span className="token-option-symbol">{t.symbol}</span>
                            <span className="token-option-name">{t.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button className="token-selector spectre-token" style={{ '--token-color': spectreToken.color }}>
                  <div className="token-icon" style={{ background: spectreToken.icon ? 'none' : spectreToken.color }}>
                    {spectreToken.icon ? (
                      <img src={spectreToken.icon} alt={spectreToken.symbol} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.textContent = spectreToken.symbol?.charAt(0) || '?'; e.target.parentElement.style.background = spectreToken.color; }} />
                    ) : (
                      <span>{spectreToken.symbol?.charAt(0) || '?'}</span>
                    )}
                  </div>
                  <span className="token-name">{spectreToken.symbol}</span>
                </button>
              )}
          </div>
          <div className="quick-amounts" ref={swapSettingsRef}>
              {/* Buy chips render per user preference: % of balance (default)
                  or the fixed preset amounts from the settings popover.
                  Sell always uses % of holdings. */}
              {mode === 'buy' && swapPrefs.quickMode === 'amounts' && (swapPrefs.quickBuySol || []).slice(0, 4).map((amt) => (
                <button
                  key={`qb-${amt}`}
                  className="quick-btn"
                  onClick={() => {
                    const v = String(amt)
                    setPayAmount(v)
                    setActiveInput('pay')
                    fetchQuote(v, { immediate: true })
                  }}
                >
                  {amt}
                </button>
              ))}
              {(mode === 'buy' && swapPrefs.quickMode === 'amounts'
                ? ['MAX']
                : mode === 'buy'
                  ? (swapPrefs.quickBuyPct || [25, 50, 75, 100]).slice(0, 4).map((p) => (p >= 100 ? 'MAX' : `${p}%`))
                  : ['25%', '50%', '75%', 'MAX']
              ).map(amt => (
                <button
                  key={amt}
                  className="quick-btn"
                  onClick={() => {
                    const percent = amt === 'MAX' ? 100 : parseFloat(amt);
                    const payToken = mode === 'buy' ? currentPayToken : spectreToken;
                    // Balance comes from the hook (mode-aware: buy = pay
                    // currency, sell = the page token's own on-chain balance).
                    // The token OBJECTS carry no .balance field - reading it
                    // filled the input with NaN -> '' in sell mode.
                    const balance = payTokenBalance;
                    // Gas reserve: native token transfers must leave dust behind
                    // to cover network fees, otherwise the tx fails. Solana
                    // needs 0.01 (rent + fee), EVM natives need 0.001 (gas).
                    // ERC-20/SPL = 0 because gas is paid in the chain's native.
                    const isNativePay = !payToken.address || payToken.address === 'native' || payToken.isNative
                    let reserve = 0
                    if (isNativePay && percent === 100) {
                      reserve = payToken.chainId === 'solana' ? 0.01 : 0.001
                    }
                    const usable = Math.max(0, balance - reserve)
                    const payDecimals = Number.isFinite(payToken.decimals) ? payToken.decimals : 6
                    // FLOOR to token decimals - toFixed-style formatting ROUNDS,
                    // and rounding .09665 up to .10 exceeds the real balance and
                    // trips the insufficient guard on MAX sells. Never fill more
                    // than the wallet actually holds.
                    const factor = Math.pow(10, Math.min(payDecimals, 9))
                    const floored = Math.floor((usable * percent / 100) * factor) / factor
                    const newPayAmount = floored > 0 ? String(floored) : '';
                    // Nothing to fill = your pay balance is at/under the gas reserve
                    // (e.g. dust ETH that can't even cover a mainnet swap's gas). Give
                    // a clear reason instead of a silent no-op - but never navigate
                    // away; MAX must not hijack the page.
                    if (!newPayAmount && mode === 'buy' && walletConnected) {
                      triggerCopyToast?.(`Not enough ${payToken?.symbol || 'funds'} to cover gas - add funds to trade`);
                      return;
                    }
                    setPayAmount(newPayAmount);
                    setActiveInput('pay');
                    // A chip click is one deliberate event - skip the
                    // keystroke debounce and quote instantly.
                    fetchQuote(newPayAmount, { immediate: true });
                  }}
                >
                  {amt}
                </button>
            ))}
              <button
                className={`quick-btn quick-gear${showSwapSettings ? ' active' : ''}`}
                onClick={() => setShowSwapSettings(v => !v)}
                title="Slippage and quick-buy amounts"
                aria-expanded={showSwapSettings}
              >
                <SlidersHorizontal size={12} strokeWidth={2.2} aria-hidden="true" />
              </button>

              {showSwapSettings && (
                <div className="swap-settings-pop">
                  <div className="ssp-section">
                    <div className="ssp-head">
                      <span className="ssp-label">Max slippage</span>
                      <span className="ssp-hint">fills tighter when possible</span>
                    </div>
                    <div className="ssp-chips">
                      {[50, 100, 300, 500].map((bps) => (
                        <button
                          key={bps}
                          className={`ssp-chip${swapPrefs.slippageBps === bps ? ' active' : ''}`}
                          onClick={() => setSwapPrefs({ slippageBps: bps })}
                        >
                          {bps / 100}%
                        </button>
                      ))}
                      <label className="ssp-custom">
                        <input
                          key={`slip-${swapPrefs.slippageBps}`}
                          type="text"
                          inputMode="decimal"
                          defaultValue={[50, 100, 300, 500].includes(swapPrefs.slippageBps) ? '' : String(swapPrefs.slippageBps / 100)}
                          placeholder="1.5"
                          onBlur={(e) => {
                            const pct = parseFloat(e.target.value)
                            if (Number.isFinite(pct) && pct > 0) setSwapPrefs({ slippageBps: Math.round(pct * 100) })
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                        />
                        <span>%</span>
                      </label>
                    </div>
                  </div>
                  <div className="ssp-section">
                    <div className="ssp-head">
                      <span className="ssp-label">Buy chips</span>
                      <span className="ssp-hint">{swapPrefs.quickMode === 'amounts' ? currentPayToken.symbol : '% of balance'}</span>
                    </div>
                    <div className="ssp-seg" role="radiogroup" aria-label="Buy chips display">
                      <button
                        className={swapPrefs.quickMode !== 'amounts' ? 'active' : ''}
                        onClick={() => setSwapPrefs({ quickMode: 'percent' })}
                      >
                        % of balance
                      </button>
                      <button
                        className={swapPrefs.quickMode === 'amounts' ? 'active' : ''}
                        onClick={() => setSwapPrefs({ quickMode: 'amounts' })}
                      >
                        Fixed amounts
                      </button>
                    </div>
                    <div className="ssp-amounts">
                      {[0, 1, 2, 3].map((i) => (
                        swapPrefs.quickMode === 'amounts' ? (
                          <input
                            key={`qba-${i}-${swapPrefs.quickBuySol[i] ?? ''}`}
                            type="text"
                            inputMode="decimal"
                            defaultValue={swapPrefs.quickBuySol[i] ?? ''}
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value)
                              const next = [...swapPrefs.quickBuySol]
                              if (Number.isFinite(v) && v > 0) next[i] = v
                              setSwapPrefs({ quickBuySol: next })
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                          />
                        ) : (
                          <input
                            key={`qbp-${i}-${(swapPrefs.quickBuyPct || [])[i] ?? ''}`}
                            type="text"
                            inputMode="decimal"
                            defaultValue={(swapPrefs.quickBuyPct || [25, 50, 75, 100])[i] ?? ''}
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value)
                              const next = [...(swapPrefs.quickBuyPct || [25, 50, 75, 100])]
                              if (Number.isFinite(v) && v > 0 && v <= 100) next[i] = v
                              setSwapPrefs({ quickBuyPct: next })
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                          />
                        )
                      ))}
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>

          {/* Swap Direction Button */}
          <div className="swap-direction">
            <button 
              className={`direction-btn ${isSwapping ? 'spinning' : ''}`}
              onClick={() => {
                setSwapRotation(prev => prev + 180);
                // Carry the receive amount over as the new pay amount -
                // stripped of display commas so parseFloat/quoting work.
                // The receive side clears and refills from the fresh quote
                // fired by the mode effect (calling fetchQuote here would
                // debounce with the OLD mode's params - stale closure).
                const carried = String(receiveAmount || '').replace(/,/g, '');
                setPayAmount(carried);
                setReceiveAmount('');
                setActiveInput('pay');
                // Toggle mode
                setMode(prev => prev === 'buy' ? 'sell' : 'buy');
              }}
              style={{ transform: `rotate(${swapRotation}deg)` }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16V4M7 4L3 8M7 4l4 4" />
                <path d="M17 8v12M17 20l4-4M17 20l-4-4" />
            </svg>
          </button>
        </div>

          {/* Second Card - Changes based on mode */}
          <div className={`trade-card receive ${activeInput === 'receive' ? 'active' : ''}`}>
            <div className="card-header">
              <span className="card-label">Receive</span>
            </div>
            <div className="card-content">
              <div className="input-wrapper">
            <input
              type="text"
              placeholder="0.00"
              value={receiveAmount}
              onChange={handleReceiveChange}
                  onFocus={() => { setActiveInput('receive'); setShowPayTokens(false); }}
                  className="amount-input"
                />
                {receiveAmount && (
                  <span className="input-usd">
                    ~${(() => {
                      // Prefer receive amount × receive-token price (true value after fees/impact).
                      const recVal = parseFloat(String(receiveAmount).replace(/,/g, '')) || 0
                      const recPrice = mode === 'buy' ? tokenPrice : currentPayToken.price
                      if (recVal > 0 && recPrice > 0) return (recVal * recPrice).toLocaleString(undefined, {maximumFractionDigits: 2})
                      // Fallback: the receive-token price hasn't loaded (native-price race
                      // that showed "~$0" on sells). Approximate from the INPUT USD, which
                      // is reliably known - it's exactly what the pay side displays.
                      const inVal = parseFloat(String(payAmount || '').replace(/,/g, '')) || 0
                      const inPrice = mode === 'buy' ? currentPayToken.price : tokenPrice
                      const inUsd = inVal * (inPrice || 0)
                      if (inUsd > 0) return inUsd.toLocaleString(undefined, {maximumFractionDigits: 2})
                      return '0'
                    })()}
                  </span>
                )}
              </div>
              
              {mode === 'buy' ? (
                <button className="token-selector spectre-token" style={{ '--token-color': spectreToken.color }}>
                  <div className="token-icon" style={{ background: spectreToken.icon ? 'none' : spectreToken.color }}>
                    {spectreToken.icon ? (
                      <img src={spectreToken.icon} alt={spectreToken.symbol} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.textContent = spectreToken.symbol?.charAt(0) || '?'; e.target.parentElement.style.background = spectreToken.color; }} />
                    ) : (
                      <span>{spectreToken.symbol?.charAt(0) || '?'}</span>
                    )}
                  </div>
                  <span className="token-name">{spectreToken.symbol}</span>
                </button>
              ) : (
                <div className="token-selector-wrapper">
                  <button 
                    className="token-selector"
                    onClick={() => setShowPayTokens(!showPayTokens)}
                    style={{ '--token-color': currentPayToken.color }}
                  >
                    <div className="token-icon">
                      <img src={currentPayToken.icon} alt={currentPayToken.symbol} />
                    </div>
                    <span className="token-name">{currentPayToken.symbol}</span>
                    <svg className={`selector-arrow ${showPayTokens ? 'open' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
                  
                  {/* Receive Token Dropdown - filtered to target token's network */}
                  {showPayTokens && (
                    <div className="token-dropdown">
                      {Object.values(swapTokens).filter(t => t.chainId === spectreToken.chainId).map((t) => (
                        <button
                          key={t.symbol}
                          className={`token-option ${selectedPayToken === t.symbol ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedPayToken(t.symbol);
                            setShowPayTokens(false);
                          }}
                        >
                          <div className="token-option-icon">
                            <img src={t.icon} alt={t.symbol} />
                          </div>
                          <div className="token-option-info">
                            <span className="token-option-symbol">{t.symbol}</span>
                            <span className="token-option-name">{t.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Swap Details - hidden unless toggled on via the info button.
            EXCEPTION: a honeypot flag always renders (fund-loss warning
            never hides behind a preference). */}
        {(showSwapDetails || tokenTax?.isHoneypot) && (
        <div className="swap-details">
          {/* Cost breakdown - shown once an amount is entered. Rows are
              informational (rate/price/impact/slippage/tax) and self-gate on
              showSwapDetails; they must NOT depend on a positive USD "cost"
              (a sub-cent token's rounded receive-USD can exceed pay-USD,
              which used to blank the whole block for some sell sizes). */}
          {payAmount && receiveAmount && (() => {
            const impactPct = priceImpact ? parseFloat(priceImpact) : 0
            // Use real tax from QuickIntel API
            const buyTax = tokenTax?.buyTax ?? null
            const sellTax = tokenTax?.sellTax ?? null
            const activeTax = mode === 'buy' ? buyTax : sellTax

            // Rate from the live quote ("1 SOL = 34.49M Kimchiloq") - rendered
            // as the first breakdown row, not a standalone line. Suppressed
            // naturally when no quote exists (over-balance, quote error).
            // Platform fee deliberately NOT rendered - it is applied inside
            // the quote's output, and a fee row reads as a scare-surcharge.
            let rateLine = null
            if (quote && quote.inputAmount && quote.outputAmount) {
              const inputDec = mode === 'buy' ? (currentPayToken.decimals || 18) : (spectreToken.decimals || 18)
              const outputDec = mode === 'buy' ? (spectreToken.decimals || 18) : (currentPayToken.decimals || 18)
              const inAmt = parseFloat(fromSmallestUnit(quote.inputAmount, inputDec))
              const outAmt = parseFloat(fromSmallestUnit(quote.outputAmount, outputDec))
              if (inAmt && outAmt) {
                const perBase = mode === 'buy' ? (outAmt / inAmt) : (inAmt / outAmt)
                rateLine = `1 ${currentPayToken.symbol} = ${perBase.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${tokenSymbol}`
              }
            }

            return (
              <div className="swap-cost-breakdown">
                {showSwapDetails && rateLine && (
                  <div className="cost-row">
                    <span className="cost-label">Rate</span>
                    <span className="cost-value">{rateLine}</span>
                  </div>
                )}
                {showSwapDetails && tokenPrice > 0 && (
                  <div className="cost-row">
                    <span className="cost-label">Price</span>
                    {/* formatPrice keeps significant digits for sub-cent tokens
                        ($0.00000006) - a fixed 6-decimal format rounded MARV
                        and every micro-cap to "$0". */}
                    <span className="cost-value">~{formatPrice(tokenPrice)} per {tokenSymbol}</span>
                  </div>
                )}
                {showSwapDetails && (
                  <div className="cost-row">
                    <span className="cost-label">Price impact</span>
                    <span className="cost-value">{impactPct > 0.01 ? `${impactPct.toFixed(2)}%` : '<0.01%'}</span>
                  </div>
                )}
                {showSwapDetails && (
                  <div className="cost-row">
                    <span className="cost-label">Max slippage</span>
                    <span className="cost-value">{(swapPrefs.slippageBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% dynamic</span>
                  </div>
                )}
                {/* EVM-only rows. Solana has no token-tax concept and its
                    network fee is always negligible (~0.000005 SOL) - both
                    rows are noise there. EVM keeps them: buy/sell taxes are
                    real fund-loss vectors and gas is worth dollars. */}
                {showSwapDetails && !isSolana && (
                  <div className="cost-row">
                    <span className="cost-label">Token tax ({mode === 'buy' ? 'buy' : 'sell'})</span>
                    <span className={`cost-value${activeTax > 0 ? ' cost-warning' : ''}`}>
                      {tokenTax === null ? '...' : `${activeTax > 0 ? activeTax : 0}%`}
                    </span>
                  </div>
                )}
                {showSwapDetails && !isSolana && (() => {
                  // Real estimated gas from the 0x quote (totalNetworkFee, in
                  // native wei) - not a hardcoded range. Shown in native units
                  // (always exact) plus USD when the native price is known.
                  const feeWei = quote?.totalNetworkFee
                  if (!feeWei) return null
                  const nativeSym = { ethereum: 'ETH', base: 'ETH', arbitrum: 'ETH', bsc: 'BNB', polygon: 'POL' }[currentPayToken.chainId] || 'ETH'
                  const feeNative = Number(feeWei) / 1e18
                  if (!Number.isFinite(feeNative) || feeNative <= 0) return null
                  const nativeUsd = (currentPayToken.isNative || currentPayToken.address === 'native')
                    ? currentPayToken.price
                    : (basePrices?.[nativeSym] || 0)
                  const usd = nativeUsd > 0 ? ` (~$${(feeNative * nativeUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })})` : ''
                  return (
                    <div className="cost-row">
                      <span className="cost-label">Network fee</span>
                      <span className="cost-value">~{feeNative.toLocaleString(undefined, { maximumFractionDigits: 6 })} {nativeSym}{usd}</span>
                    </div>
                  )
                })()}
                {tokenTax?.isHoneypot && (
                  <div className="cost-row cost-danger">
                    <span className="cost-label">Honeypot detected</span>
                    <span className="cost-value">Cannot sell</span>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
        )}

        {/* In-flight strip - compact; the CTA button carries the busy state */}
        {isSwapping && (
          <div className="swap-overlay" role="status">
            <span className="swap-live-dot" aria-hidden="true" />
            <div className="swap-flow-body">
              <span className="swap-flow-title">{txHash ? 'Confirming on-chain' : 'Executing swap'}</span>
              {swapSummary && (
                <span className="swap-flow-pair">
                  <span>{fmtSwapAmt(swapSummary.fromValue)} {swapSummary.fromSymbol}</span>
                  <ArrowRight className="sfp-arrow" size={11} strokeWidth={2.2} aria-hidden="true" />
                  <span>{fmtSwapAmt(swapSummary.toValue)} {swapSummary.toSymbol}</span>
                </span>
              )}
            </div>
            <span className="swap-flow-track" aria-hidden="true" />
          </div>
        )}

        {/* Success card - real traded pair from the execution snapshot.
            Token-page language: warm white + accent, structured legs, no
            generic success-green. */}
        {swapSuccess && (
          <div className="swap-success-card" role="status">
            <div className="ssc-head">
              <CheckCircle2 className="ssc-check" size={14} strokeWidth={2.4} aria-hidden="true" />
              <span className="ssc-title">Swap successful</span>
            </div>
            <div className="ssc-flow">
              <div className="ssc-leg">
                <span className="ssc-amt">{fmtSwapAmt(swapSummary?.fromValue)} {swapSummary?.fromSymbol}</span>
                <span className="ssc-usd">~${(swapSummary?.fromUsd || 0).toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
              </div>
              <ArrowRight className="ssc-arrow" size={13} strokeWidth={2.2} aria-hidden="true" />
              <div className="ssc-leg ssc-leg--out">
                <span className="ssc-amt">{fmtSwapAmt(swapSummary?.toValue)} {swapSummary?.toSymbol}</span>
                <span className="ssc-usd">~${(swapSummary?.toUsd || 0).toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
              </div>
            </div>
          </div>
        )}

        {/* Quote failure. Previously quoteError had NO render site anywhere in
            this panel, and the Receive box was filled with a spot-price
            estimate instead - so a failed quote looked like a working one and
            the user only found out on click. Reuses the same severity-aware
            alert as swapError; swapError wins when both are set (it is the
            later, more specific failure). */}
        {!swapError && quoteError && (() => {
          const alert = classifySwapError(quoteError, 'quote')
          const AlertIcon = alert.kind === 'warn' ? AlertTriangle : AlertOctagon
          return (
            <div className={`swap-error-alert ${alert.kind}`} role="alert">
              <AlertIcon className="sea-icon" size={15} strokeWidth={2.2} aria-hidden="true" />
              <div className="sea-body">
                <span className="sea-title">{alert.title}</span>
                <span className="sea-text">{String(quoteError)}</span>
              </div>
            </div>
          )
        })()}

        {/* Error Alert - severity-aware (amber = user-fixable, coral = failure) */}
        {swapError && (() => {
          const alert = classifySwapError(swapError)
          const AlertIcon = alert.kind === 'warn' ? AlertTriangle : AlertOctagon
          return (
            <div className={`swap-error-alert ${alert.kind}`} role="alert">
              <AlertIcon className="sea-icon" size={15} strokeWidth={2.2} aria-hidden="true" />
              <div className="sea-body">
                <span className="sea-title">{alert.title}</span>
                <span className="sea-text">{swapError}</span>
              </div>
            </div>
          )
        })()}

        {/* Action Button — unlocked for swap testing (Gleb, 2026-07-06).
            Signed-out state opens the Privy login modal; connected wallets
            route through the real doSwap signing path. */}
        <button
          className={`swap-action-btn ${walletConnected ? mode : 'signin'} ${isSwapping ? 'loading' : ''} ${swapSuccess ? 'success' : ''} ${walletConnected && payAmount && parseFloat(payAmount) > payTokenBalance ? (mode === 'buy' ? 'deposit' : 'insufficient') : ''} ${walletConnected && !payAmount && !isSwapping && !swapSuccess ? 'idle-cta' : ''}`}
          onClick={async () => {
            setShowPayTokens(false)

            if (!walletConnected) {
              try { login() } catch { /* modal already open / privy not ready */ }
              return
            }

            // No amount yet: the button is an enabled idle CTA (with the border
            // beam) inviting a trade - so route the click into the amount input
            // rather than dead-ending on a no-op.
            if (!payAmount) {
              try { payInputRef.current?.focus() } catch { /* input unmounted */ }
              return
            }

            // Insufficient balance is not a dead-end. On a BUY, route the user to
            // the wallet (Deposit) so they can fund up and come back to trade; the
            // one-shot flag tells the dashboard to open on the Wallet section. On a
            // SELL it just means "reduce the amount", so keep blocking silently.
            if (parseFloat(payAmount) > payTokenBalance) {
              if (mode === 'buy') {
                const walletChain = NETWORK_TO_WALLET_CHAIN[networkId] || 'ethereum'
                try {
                  sessionStorage.setItem('ud-open-section', 'wallet')
                  sessionStorage.setItem('ud-open-chain', walletChain)
                } catch { /* private mode */ }
                window.history.pushState({ view: 'user-dashboard' }, '', '#dashboard')
                window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'user-dashboard' } }))
              }
              return
            }

            // Honeypot hard block on BUY. The badge already renders in the
            // details row, but a badge is not a gate - QuickIntel-flagged
            // honeypots cannot be sold, so letting the buy through loses the
            // full amount. Sells stay allowed (exit path for holders).
            if (mode === 'buy' && tokenTax?.isHoneypot) {
              triggerCopyToast?.('Blocked: this token is flagged as a honeypot')
              return
            }

            // The swap summary (in-flight + success strips) is built inside
            // the hook from the EXECUTED quote's real amounts - see doSwap.
            const hash = await doSwap(payAmount)
            if (hash) {
              setPayAmount('')
              setReceiveAmount('')
            }
          }}
          disabled={chainUnsupported || (walletConnected && isSwapping)}
        >
          <span className="btn-content">
            {chainUnsupported ? (
              <span>Trading not supported on {chainLabel} yet</span>
            ) : isSwapping ? (
              <>
                <div className="btn-spinner">
                  <div className="spinner-ring"></div>
                  <div className="spinner-ring"></div>
                  <div className="spinner-ring"></div>
                </div>
                <span>Swapping...</span>
              </>
            ) : swapSuccess ? (
              <>
                <svg className="btn-success-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M5 13l4 4L19 7" />
                </svg>
                <span>Completed!</span>
              </>
            ) : (quoteLoading && !receiveAmount) ? (
              // Only show the loading label on the FIRST quote (nothing to act on
              // yet). Once an estimate/prior amount is displayed, keep the button
              // actionable - it re-quotes at click time - so a background refresh
              // never strands the user on "Getting quote..." while a price sits
              // right there. The server quote is ~0.4s; this kills the perceived lag.
              <span>Getting quote...</span>
            ) : !walletConnected ? (
              <span>Sign In to Trade</span>
            ) : walletConnected && payAmount && parseFloat(payAmount) > payTokenBalance ? (
              mode === 'buy' ? (
                <>
                  <Wallet size={16} strokeWidth={2.2} aria-hidden="true" />
                  <span>Fund the wallet to trade</span>
                  <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
                </>
              ) : (
                <span>Insufficient {spectreToken.symbol} balance</span>
              )
            ) : (
              <span>{mode === 'buy' ? 'Buy' : 'Sell'} {token.symbol}</span>
            )}
          </span>
        </button>
      </div>

      {/* Volume / activity — its own movable part (was nested in the swap
          card; the panel's uniform 8px card rhythm replaces the inner margin). */}
      <div className="rp-part" data-part="volume" style={partStyle('volume')}>
        <DexStatsBoard
          section="activity"
          liveTokenData={liveTokenData}
          token={token}
          tokenSymbol={tokenSymbol}
          baseToken={baseToken}
          tokenPrice={tokenPrice}
          basePrice={basePrice}
          marketCap={marketCap}
          fdv={fdvValue}
          realLiquidity={realLiquidity}
          pooledTokenAmount={pooledTokenAmount}
          pooledBaseAmount={pooledBaseAmount}
          realChange1h={realChange1h}
          realChange4h={realChange4h}
          realChange12h={realChange12h}
          realChange24={realChange24}
          volumeTimeframes={volumeTimeframes}
          liquidityData={liquidityData}
          networkId={networkId}
          isSolana={isSolana}
          triggerCopyToast={triggerCopyToast}
        />
      </div>

      {/* Pool + contracts + deployer security — one movable "security" part */}
      <div className="rp-part" data-part="security" style={partStyle('security')}>
        <DexStatsBoard
          section="pool"
          liveTokenData={liveTokenData}
          token={token}
          tokenSymbol={tokenSymbol}
          baseToken={baseToken}
          tokenPrice={tokenPrice}
          basePrice={basePrice}
          marketCap={marketCap}
          fdv={fdvValue}
          realLiquidity={realLiquidity}
          pooledTokenAmount={pooledTokenAmount}
          pooledBaseAmount={pooledBaseAmount}
          realChange1h={realChange1h}
          realChange4h={realChange4h}
          realChange12h={realChange12h}
          realChange24={realChange24}
          volumeTimeframes={volumeTimeframes}
          liquidityData={liquidityData}
          networkId={networkId}
          isSolana={isSolana}
          triggerCopyToast={triggerCopyToast}
        />

        {/* Deployer / Contract Security — sits below pool/contracts */}
        {token && tokenAddress && tokenAddress !== 'native' && (
          <div className="deployer-security">
            <div className="dsec-header">
              <div className="dsec-title-block">
                <svg className="dsec-shield" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span className="dsec-title">Deployer Security</span>
              </div>
              {(() => {
                const t = tokenTax
                const issues = []
                if (t?.isHoneypot || t?.cannotSellAll) issues.push('honeypot')
                if (t?.buyTax != null && t.buyTax > 10) issues.push('high-buy-tax')
                if (t?.sellTax != null && t.sellTax > 10) issues.push('high-sell-tax')
                if (t?.taxModifiable) issues.push('tax-modifiable')
                if (t?.mintable) issues.push('mintable')
                if (t?.canFreeze) issues.push('freeze')
                if (t?.hiddenOwner) issues.push('hidden-owner')
                if (t?.openSource === false) issues.push('unverified')
                if (t?.hasCooldown) issues.push('cooldown')
                if (t?.balanceMutable) issues.push('balance-mutable')
                if (t?.closable) issues.push('closable')
                if (t?.transferHook) issues.push('transfer-hook')
                if (issues.length > 0) {
                  return <span className="dsec-issues bad">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</span>
                }
                if (t?.isHoneypot != null) return <span className="dsec-issues good">All checks passed</span>
                if (t) return <span className="dsec-issues neutral">No data</span>
                return <span className="dsec-issues neutral">Loading…</span>
              })()}
            </div>

            <div className="dsec-grid">
              {(() => {
                const t = tokenTax
                const honeypot = t == null ? null : !!(t.isHoneypot || t.cannotSellAll)
                const lpBurned = t?.lpBurnedPercent
                const lpLocked = t?.lpLockedPercent
                const lpSecured = lpBurned == null && lpLocked == null ? null : (lpBurned || 0) + (lpLocked || 0)
                const lpLabel = lpSecured == null ? '—'
                  : lpSecured < 0.5 ? '0%'
                  : (lpBurned || 0) >= (lpLocked || 0)
                    ? `${lpBurned.toFixed(1)}% burned`
                    : `${lpLocked.toFixed(1)}% locked`
                const top10 = t?.top10Percent
                // val true = risk present (bad), false = clean (good), null = unknown
                const flagRow = (label, val, { yes = 'Yes', no = 'No' } = {}) => (
                  <div className="dsec-cell" key={label}>
                    <span className="dsec-label">{label}</span>
                    <span className={`ds-value ${val === true ? 'bad' : val === false ? 'good' : ''}`}>
                      {val == null ? '—' : val ? yes : no}
                    </span>
                  </div>
                )
                // Token-2022 extension risks - only meaningful on Solana, and only
                // scary when present. Collapsed into one row instead of 4.
                const t22Risks = t == null ? null : [
                  t.taxModifiable && 'fee modifiable',
                  t.balanceMutable && 'balance mutable',
                  t.closable && 'closable',
                  t.transferHook && 'transfer hook',
                ].filter(Boolean)
                const lpRow = (
                  <div className="dsec-cell" key="lp">
                    <span className="dsec-label">LP burned / locked</span>
                    <span className={`ds-value mono ${lpSecured != null && lpSecured >= 80 ? 'good' : ''}`}>
                      {lpLabel}
                    </span>
                  </div>
                )
                const top10Row = (
                  <div className="dsec-cell" key="top10">
                    <span className="dsec-label">Top 10 holders</span>
                    <span className={`ds-value mono ${top10 != null && top10 > 50 ? 'bad' : top10 != null && top10 <= 30 ? 'good' : ''}`}>
                      {top10 != null ? `${top10.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                )
                const lockersRow = Array.isArray(t?.lpLockers) && t.lpLockers.length > 0 && (
                      <div className="dsec-lockers">
                        {t.lpLockers.map((l, i) => {
                          const tag = String(l.tag || '')
                          const name = /team\s*finance/i.test(tag) ? 'Team Finance'
                            : /unicrypt|uncx/i.test(tag) ? 'UNCX'
                            : /pink/i.test(tag) ? 'PinkLock'
                            : tag || (l.address ? `${l.address.slice(0, 6)}…${l.address.slice(-4)}` : 'Locker')
                          const explorers = {
                            1: 'https://etherscan.io/address/', 56: 'https://bscscan.com/address/',
                            137: 'https://polygonscan.com/address/', 8453: 'https://basescan.org/address/',
                            42161: 'https://arbiscan.io/address/', 10: 'https://optimistic.etherscan.io/address/',
                            43114: 'https://snowtrace.io/address/', 250: 'https://ftmscan.com/address/',
                          }
                          // Link to the on-chain proof: the LP token's explorer page
                          // filtered to the locker address (locker platforms' own deep
                          // links are unreliable - team.finance doesn't index every lock)
                          const explorerBase = (explorers[networkId] || explorers[1]).replace('/address/', '')
                          const href = isSolana
                            ? `https://solscan.io/account/${l.address}`
                            : t.lpPair
                              ? `${explorerBase}/token/${t.lpPair}?a=${l.address}`
                              : `${explorerBase}/address/${l.address}`
                          return (
                            <a key={i} className="dsec-locker-chip" href={href} target="_blank" rel="noopener noreferrer" title={l.address || ''}>
                              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                              <span>{name}</span>
                              <span className="dsec-locker-pct mono">{l.percent >= 99.95 ? '100' : l.percent.toFixed(1)}%</span>
                              <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          )
                        })}
                      </div>
                )
                // Solana: SPL tokens have no buy/sell tax, no contract owner, no
                // blacklist - what matters is authorities, token-2022 extensions,
                // LP burn and concentration.
                if (isSolana) {
                  return (
                    <>
                      {flagRow('Honeypot', honeypot)}
                      <div className="dsec-cell">
                        <span className="dsec-label">Transfer fee</span>
                        <span className={`ds-value mono ${t?.buyTax != null && t.buyTax > 10 ? 'bad' : t?.buyTax != null ? 'good' : ''}`}>
                          {t?.buyTax != null ? `${t.buyTax.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      {flagRow('Mint authority', t?.mintable, { yes: 'Active', no: 'Revoked' })}
                      {flagRow('Freeze authority', t?.canFreeze, { yes: 'Active', no: 'Revoked' })}
                      <div className="dsec-cell">
                        <span className="dsec-label">Token-2022 risks</span>
                        <span
                          className={`ds-value ${t22Risks && t22Risks.length > 0 ? 'bad' : t22Risks ? 'good' : ''}`}
                          title={t22Risks && t22Risks.length ? t22Risks.join(', ') : ''}
                        >
                          {t22Risks == null ? '—' : t22Risks.length === 0 ? 'None' : t22Risks.length === 1 ? t22Risks[0] : `${t22Risks.length} flags`}
                        </span>
                      </div>
                      {lpRow}
                      {lockersRow}
                      {top10Row}
                    </>
                  )
                }
                return (
                  <>
                    {flagRow('Honeypot', honeypot)}
                    <div className="dsec-cell">
                      <span className="dsec-label">Buy tax</span>
                      <span className={`ds-value mono ${t?.buyTax != null && t.buyTax > 10 ? 'bad' : t?.buyTax != null ? 'good' : ''}`}>
                        {t?.buyTax != null ? `${t.buyTax.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    <div className="dsec-cell">
                      <span className="dsec-label">Sell tax</span>
                      <span className={`ds-value mono ${t?.sellTax != null && t.sellTax > 10 ? 'bad' : t?.sellTax != null ? 'good' : ''}`}>
                        {t?.sellTax != null ? `${t.sellTax.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    {flagRow('Tax modifiable', t?.taxModifiable)}
                    {flagRow('Mintable', t?.mintable)}
                    {flagRow('Freeze / blacklist', t?.canFreeze)}
                    <div className="dsec-cell">
                      <span className="dsec-label">Ownership</span>
                      <span className={`ds-value ${t?.hiddenOwner ? 'bad' : t?.renounced ? 'good' : ''}`}>
                        {t?.renounced == null ? '—' : t.hiddenOwner ? 'Hidden owner' : t.renounced ? 'Renounced' : 'Active owner'}
                      </span>
                    </div>
                    {lpRow}
                    {lockersRow}
                    {top10Row}
                  </>
                )
              })()}
            </div>

          </div>
        )}
      </div>

      {/* Token logo lightbox — opens on logo click, click anywhere or Esc to close */}
      {showLogoFullView && createPortal(
        <div
          className="logo-lightbox"
          role="dialog"
          aria-label={`${token?.symbol || 'Token'} logo`}
          onClick={() => setShowLogoFullView(false)}
        >
          <div className="logo-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <img
              src={upscaleLogoUrl(getHardcodedLogo(token?.address) || liveTokenData?.logo || token?.logo) || tokenPlaceholder(token?.symbol, 400)}
              alt={token?.symbol}
              className="logo-lightbox-img"
              onError={(e) => { e.target.src = tokenPlaceholder(token?.symbol, 400) }}
            />
            <button
              type="button"
              className="logo-lightbox-close"
              aria-label="Close"
              onClick={() => setShowLogoFullView(false)}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const QUICKINTEL_CHAIN_FOR_LINK = {
  1: 'eth', 56: 'bsc', 137: 'poly', 42161: 'arbi', 8453: 'base',
  1399811149: 'solana', 43114: 'avax', 10: 'opti', 250: 'ftm',
}

export default React.memo(RightPanel)
