/**
 * TokenBanner Component
 * Figma Reference: Token info section above chart
 * Layout: Left (logo+name+CA) | Middle (socials+description) | Right (price+actions)
 * Enhanced with: Live metrics, AI sentiment, smart badges, multi-timeframe
 * NOW WITH REAL-TIME DATA FROM CODEX API
 */
import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { Lock } from 'lucide-react'
import { useCopyToast } from '../App'
import { useSharedTokenDetails } from '../contexts/TokenDetailsContext'
import { formatLargeNumber, getHardcodedLogo, inferNetworkId, getNetworkName } from '../services/codexApi'
import { readCodexChangePct } from '../lib/marketFormat'
import { useBarChangeWindows } from '../hooks/useBarChangeWindows'
import { getTokenColor, hasKnownColor, fetchTokenColorFromServer, generateTokenBackgroundColors, extractColorFromImage, getCachedColor } from '../utils/tokenColors'
import Icon from './Icon'
import AlertButton from './AlertButton'
import HeaderDossier from './HeaderDossier'
import './TokenBanner.css'

// Default SPECTRE token address on Ethereum
const DEFAULT_TOKEN_ADDRESS = '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6';
const DEFAULT_NETWORK_ID = 1;

// Format price with appropriate decimal places
const formatTokenPrice = (price) => {
  const numPrice = parseFloat(price);
  if (isNaN(numPrice) || !isFinite(numPrice)) return '0.00';
  if (numPrice >= 1000) return numPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (numPrice >= 1) return numPrice.toFixed(2);
  if (numPrice >= 0.01) return numPrice.toFixed(4);
  if (numPrice >= 0.0001) return numPrice.toFixed(6);
  return numPrice.toFixed(8);
};

// Truncate address for display (0x1234...5678)
const truncateAddress = (address) => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// Compact USD for the MCap big-number mode ($3.88M).
const formatCompactUsd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

// Network explorer configurations
const NETWORK_EXPLORERS = {
  1: { name: 'Etherscan', url: 'https://etherscan.io', logo: 'https://etherscan.io/images/brandassets/etherscan-logo-circle.svg' },
  56: { name: 'BscScan', url: 'https://bscscan.com', logo: 'https://bscscan.com/images/brandassets/bscscan-logo-circle.png' },
  137: { name: 'PolygonScan', url: 'https://polygonscan.com', logo: 'https://polygonscan.com/images/brandassets/polygonscan-logo.svg' },
  42161: { name: 'Arbiscan', url: 'https://arbiscan.io', logo: 'https://arbiscan.io/images/brandassets/arbiscan-logo.svg' },
  8453: { name: 'BaseScan', url: 'https://basescan.org', logo: 'https://basescan.org/images/brandassets/basescan-logo.svg' },
  43114: { name: 'SnowTrace', url: 'https://snowtrace.io', logo: 'https://snowtrace.io/images/brandassets/snowtrace-logo.svg' },
  10: { name: 'Optimistic', url: 'https://optimistic.etherscan.io', logo: 'https://optimistic.etherscan.io/images/brandassets/etherscan-logo-circle.svg' },
  250: { name: 'FTMScan', url: 'https://ftmscan.com', logo: 'https://ftmscan.com/images/brandassets/ftmscan-logo.svg' },
  1399811149: { name: 'Solscan', url: 'https://solscan.io', logo: 'https://solscan.io/favicon.ico' },
  4663: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com', logo: 'https://robinhoodchain.blockscout.com/assets/favicon/favicon-32x32.png' },
};

const TokenBanner = ({ token: propToken, isInWatchlist, addToWatchlist, removeFromWatchlist, alerts, onCreateAlert, onDeleteAlert }) => {
  // Determine the full token address
  // Handle truncated addresses and different chain formats
  const getFullAddress = () => {
    const addr = propToken?.address || '';
    
    // Check if it's a valid full EVM address (0x + 40 hex chars)
    if (addr.length === 42 && addr.startsWith('0x')) {
      return addr;
    }
    
    // Check if it's a valid Solana address (base58, typically 32-44 chars, no 0x prefix)
    // Solana addresses are alphanumeric without 0, O, I, l
    if (addr.length >= 32 && addr.length <= 44 && !addr.startsWith('0x') && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) {
      return addr;
    }
    
    // Truncated/missing address: return it as-is rather than substituting the
    // SPECTRE default. Showing SPECTRE's contract under a different selected
    // token is misleading (e.g. PALM rendered with SPECTRE's CA). With no valid
    // address the panel shows the symbol + empty data instead of wrong data.
    return addr || '';
  };
  
  const tokenAddress = getFullAddress();
  const networkId = inferNetworkId(tokenAddress, propToken?.networkId);
  
  // Fetch real-time token data from Codex API
  const { tokenData: liveData, loading, error } = useSharedTokenDetails()

  // Real per-window change from Codex hourly bars - fills 4h/12h, which the
  // detail endpoint doesn't serve for thin tokens (see useBarChangeWindows).
  const barWindows = useBarChangeWindows(tokenAddress, networkId)

  // Big-number mode: price (default) or mcap — GMGN-style, tap to switch.
  // Same mental model as the mobile hero; persisted across sessions.
  const [bigMode, setBigMode] = useState(() => {
    try { return localStorage.getItem('spectre-banner-big') === 'mcap' ? 'mcap' : 'price' } catch (e) { return 'price' }
  })
  const toggleBigMode = () => {
    setBigMode((m) => {
      const next = m === 'price' ? 'mcap' : 'price'
      try { localStorage.setItem('spectre-banner-big', next) } catch (e) { /* noop */ }
      return next
    })
  }
  
  // Log token changes for debugging
  React.useEffect(() => {
  }, [propToken?.symbol, tokenAddress, networkId]);
  
  // Get explorer URL based on network
  const getExplorerUrl = () => {
    const explorer = NETWORK_EXPLORERS[networkId] || NETWORK_EXPLORERS[1];
    return `${explorer.url}/token/${tokenAddress}`;
  };
  
  const getExplorerName = () => {
    return NETWORK_EXPLORERS[networkId]?.name || 'Etherscan';
  };
  
  const getExplorerLogo = () => {
    return NETWORK_EXPLORERS[networkId]?.logo || NETWORK_EXPLORERS[1].logo;
  };
  
  // Helper to sanitize token names - remove replacement chars and non-printable chars
  const sanitizeName = (name) => {
    if (!name) return '';
    // Remove replacement characters (�), zero-width chars, and other problematic unicode
    return name
      .replace(/[\uFFFD\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  
  // Merge live data with prop data (live data takes priority)
  const token = {
    ...propToken,
    ...(liveData || {}),
    symbol: sanitizeName(liveData?.symbol || propToken?.symbol) || 'SPECTRE',
    name: sanitizeName(liveData?.name || propToken?.name) || 'Spectre AI',
    address: liveData?.address || propToken?.address || '',
    price: liveData?.price || propToken?.price || 0,
    change: liveData?.change24 || propToken?.change || 0,
    description: liveData?.description || propToken?.description || '',
    socials: liveData?.socials || propToken?.socials || {},
    logo: liveData?.logo || liveData?.imageLargeUrl || liveData?.imageThumbUrl || propToken?.logo || '/logo.png',
    // Spectre-only enriched fields (available for ETH/BSC)
    holders: liveData?.holders || propToken?.holders || 0,
    launchSource: liveData?.launchSource || propToken?.launchSource || null,
    deployerAddress: liveData?.deployerAddress || propToken?.deployerAddress || null,
    fdv: liveData?.fdv || propToken?.fdv || 0,
    marketCap: liveData?.marketCap || propToken?.marketCap || 0,
    liquidity: liveData?.liquidity || propToken?.liquidity || 0,
    volume24h: liveData?.volume24h || propToken?.volume24h || liveData?.volume24 || 0,
    txnCount24h: liveData?.txnCount24h || propToken?.txnCount24h || 0,
    _source: liveData?._source || null,
  };
  const { triggerCopyToast } = useCopyToast()
  const [showSocialsMenu, setShowSocialsMenu] = useState(false)
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const socialsMenuRef = useRef(null)
  const moreButtonRef = useRef(null)
  const shareMenuRef = useRef(null)
  const shareButtonRef = useRef(null)
  const [shareMenuPosition, setShareMenuPosition] = useState({ top: 0, left: 0 })

  // Timeframe dropdown — used on narrow banner widths where four inline
  // pills (1H / 4H / 12H / 24H) would crowd the price+change cluster.
  // A container query (.token-banner ≤ 950px) swaps the inline pills
  // for a single trigger that opens this popover.
  const [showTfMenu, setShowTfMenu] = useState(false)
  const [tfMenuPosition, setTfMenuPosition] = useState({ top: 0, left: 0 })
  const tfButtonRef = useRef(null)
  
  // Update share menu position on scroll/resize
  useEffect(() => {
    const updatePosition = () => {
      if (shareButtonRef.current && showShareMenu) {
        const rect = shareButtonRef.current.getBoundingClientRect()
        setShareMenuPosition({
          top: rect.bottom + 8,
          left: rect.right - 280
        })
      }
    }
    
    if (showShareMenu) {
      updatePosition()
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
    }
    
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [showShareMenu])
  
  // Share menu options
  const shareOptions = [
    { id: 'chart', icon: '📊', label: 'Chart' },
    { id: 'chart-info', icon: '📈', label: 'Chart + Token Info' },
    { id: 'token-info', icon: '🪙', label: 'Token Information' },
    { id: 'transactions', icon: '📜', label: 'Transaction History', hasSubmenu: true },
    { id: 'holders', icon: '👥', label: 'Top Holders', hasSubmenu: true },
    { id: 'bubblemap', icon: '🫧', label: 'On-Chain Bubblemap' },
    { id: 'x-bubblemap', icon: '✖️', label: 'X Bubblemap' },
    { id: 'banner', icon: '🖼️', label: 'Project Banner' },
    { id: 'gif', icon: '🎬', label: 'Chart as GIF', hasSubmenu: true },
  ]
  
  const [isCapturing, setIsCapturing] = useState(false)
  const [comingSoonTooltip, setComingSoonTooltip] = useState({ visible: false, text: '', x: 0, y: 0, position: 'top' })
  
  const handleShareOption = async (optionId) => {
    if (optionId === 'x-bubblemap') {
      triggerCopyToast('Coming Soon')
      setShowShareMenu(false)
      return
    }
    if (optionId === 'chart') {
      await captureChart()
    }
    
    setShowShareMenu(false)
  }
  
  const captureChart = async () => {
    const chartElement = document.querySelector('.trading-chart')
    if (!chartElement) {
      console.error('Chart element not found')
      return
    }
    
    setIsCapturing(true)
    
    try {
      // Add a class to show we're capturing (for any UI adjustments)
      chartElement.classList.add('capturing')
      
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(chartElement, {
        backgroundColor: '#0a0a0c',
        scale: 2, // Higher quality
        logging: false,
        useCORS: true,
        allowTaint: true,
      })
      
      // Remove capturing class
      chartElement.classList.remove('capturing')
      
      // Convert to blob and download
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.download = `${token.symbol}-chart-${new Date().toISOString().slice(0,10)}.png`
        link.href = url
        link.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
      
    } catch (error) {
      console.error('Error capturing chart:', error)
      chartElement.classList.remove('capturing')
    } finally {
      setIsCapturing(false)
    }
  }
  
  // Check if description needs truncation - cut at sentence boundary
  const getFirstSentence = (text) => {
    if (!text) return ''
    const firstPeriod = text.indexOf('.')
    if (firstPeriod !== -1 && firstPeriod < text.length - 1) {
      return text.slice(0, firstPeriod + 1)
    }
    return text
  }
  
  const firstSentence = getFirstSentence(token.description)
  const isLongDescription = token.description && token.description.length > firstSentence.length
  
  // Multi-timeframe price data using real API data
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h')
  const currentPrice = token.price
  
  // Every window comes from Codex's own hourly bars (real on-chain change, same
  // source as the chart). The detail endpoint is MIXED-UNIT and unreliable -
  // change24 arrives as +3.57%-percent OR +0.031-ratio at different times, and
  // its 4h/12h are empty for thin tokens - so it's only a FALLBACK (normalized
  // through readCodexChangePct's heuristic) before bars land. null -> pill "-".
  const change1h = barWindows?.change1h ?? readCodexChangePct(liveData?.change1h) ?? null
  const change4h = barWindows?.change4h ?? null
  const change12h = barWindows?.change12h ?? null
  const change24h = barWindows?.change24h ?? readCodexChangePct(liveData?.change24) ?? null

  // Convert percentage change to historical price (null / 0 -> current price)
  const calcHistoricalPrice = (changePct) => {
    if (!currentPrice || !changePct) return currentPrice
    return currentPrice / (1 + changePct / 100)
  }

  const priceData = {
    '1h': { price: calcHistoricalPrice(change1h), change: change1h },
    '4h': { price: calcHistoricalPrice(change4h), change: change4h },
    '12h': { price: calcHistoricalPrice(change12h), change: change12h },
    '24h': { price: calcHistoricalPrice(change24h), change: change24h },
  }
  
  // Determine project type (utility or meme)
  const getProjectType = (tokenData) => {
    const symbol = (tokenData.symbol || '').toLowerCase();
    const name = (tokenData.name || '').toLowerCase();
    
    // Known utility tokens
    const utilityTokens = ['spectre', 'uni', 'aave', 'link', 'grt', 'mkr', 'crv', 'sushi', 'comp', 'snx'];
    if (utilityTokens.includes(symbol)) {
      return 'utility';
    }
    
    // Known meme tokens
    const memeTokens = ['doge', 'shib', 'pepe', 'floki', 'bonk', 'wojak', 'chad', 'moodeng'];
    if (memeTokens.includes(symbol)) {
      return 'meme';
    }
    
    // Check if category/type is explicitly set in token data
    if (tokenData.category) {
      const category = tokenData.category.toLowerCase();
      if (category.includes('utility') || category.includes('defi') || category.includes('infrastructure')) {
        return 'utility';
      }
      if (category.includes('meme')) {
        return 'meme';
      }
    }
    
    if (tokenData.projectType) {
      const type = tokenData.projectType.toLowerCase();
      if (type === 'utility') return 'utility';
      if (type === 'meme') return 'meme';
    }
    
    // Check description for meme keywords
    const description = (tokenData.description || '').toLowerCase();
    const memeKeywords = ['meme', 'doge', 'shiba', 'pepe', 'floki', 'bonk', 'wojak', 'chad', 'moodeng'];
    const hasMemeKeyword = memeKeywords.some(keyword => description.includes(keyword) || name.includes(keyword));
    
    if (hasMemeKeyword) {
      return 'meme';
    }
    
    // Check description for utility keywords
    const utilityKeywords = ['utility', 'defi', 'infrastructure', 'protocol', 'platform', 'ecosystem', 'governance', 'staking', 'yield', 'ai', 'trading', 'analytics'];
    const hasUtilityKeyword = utilityKeywords.some(keyword => description.includes(keyword) || name.includes(keyword));
    
    if (hasUtilityKeyword) {
      return 'utility';
    }
    
    return null;
  };
  
  // Smart badges - dynamically shown based on conditions
  const [badges, setBadges] = useState([])
  
  // Update badges when token data changes – professional icons from spectre-icons
  useEffect(() => {
    const projectType = getProjectType(token);
    setBadges([
      { id: 'verified', iconName: 'check', label: 'Verified', active: token.verified },
      { id: 'trending', iconName: 'trending-up', label: 'Trending', active: true },
      { id: 'whale', iconName: 'whale', label: 'Whale Activity', active: true },
      { id: 'momentum', iconName: 'rocket', label: 'Breakout', active: false },
      { id: 'audited', iconName: 'shield', label: 'Audited', active: true },
      { id: 'utility', iconName: 'settings', label: 'Utility', active: projectType === 'utility' },
      { id: 'meme', iconName: 'memes', label: 'Meme', active: projectType === 'meme' }
    ]);
  }, [token.category, token.projectType, token.description, token.verified, token.symbol, token.name])
  
  // Price flash animation (driven by Codex polling updates via TokenDetailsContext)
  const [priceFlash, setPriceFlash] = useState(null)
  const prevPriceRef = useRef(null)

  useEffect(() => {
    const currentPrice = parseFloat(liveData?.priceUSD || liveData?.price) || 0
    if (currentPrice <= 0) return
    const prev = prevPriceRef.current
    prevPriceRef.current = currentPrice
    if (prev && prev !== currentPrice) {
      setPriceFlash(currentPrice > prev ? 'up' : 'down')
      setTimeout(() => setPriceFlash(null), 500)
    }
  }, [liveData?.priceUSD, liveData?.price])

  // ── Token-change reset ─────────────────────────────────────────────────────
  // App.jsx used to pass `key={token.address || token.symbol}` here, so a token
  // click remounted this banner and every useState went back to its initializer.
  // The key is gone (the banner updates in place now), so the reset is explicit.
  // Keyed off the PROP, not the `token` merged with liveData below - the merged
  // object churns as Codex details arrive and would re-fire this mid-interaction.
  const bannerTokenKey = `${propToken?.networkId ?? ''}:${propToken?.address || propToken?.symbol || ''}`
  useEffect(() => {
    // prevPriceRef is the important one: it holds the LAST TOKEN'S price, so the
    // first tick under a new token would compare two unrelated assets and flash
    // a fake up/down arrow (e.g. $60k -> $0.001 reads as a crash).
    prevPriceRef.current = null
    setPriceFlash(null)
    setSelectedTimeframe('24h')
    setShowSocialsMenu(false)
    setShowShareMenu(false)
    setShowTfMenu(false)
    setIsCapturing(false)
    setComingSoonTooltip({ visible: false, text: '', x: 0, y: 0, position: 'top' })
    // Handled by their own token-keyed effects, so not repeated here: `badges`
    // and `bannerColor` (both recompute from the token below).
    // Deliberately NOT reset: `bigMode` (a localStorage-backed preference),
    // `isExpanded` (a collapse preference - it should follow the user across
    // tokens rather than springing back open on every click), and the menu
    // POSITIONS (recomputed from the trigger rect each time a menu opens).
  }, [bannerTokenKey])

  const handleWatchlistToggle = () => {
    if (isInWatchlist) {
      removeFromWatchlist(token.symbol)
    } else {
      addToWatchlist({
        symbol: token.symbol,
        name: token.name,
        price: token.price,
        change: token.change,
        logo: token.logo || liveData?.logo || '/logo.png',
        address: tokenAddress,
        marketCap: liveData?.marketCap || 0,
        volume: liveData?.volume24 || 0,
        liquidity: liveData?.liquidity || 0,
        networkId: networkId,
        pinned: false
      })
    }
  }

  const copyAddress = () => {
    navigator.clipboard.writeText(tokenAddress)
    triggerCopyToast()
  }

  // Close socials menu when clicking outside (share menu stays open until button click)
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Socials dropdown only
      const socialsDropdown = document.querySelector('.socials-dropdown')
      const isOutsideSocialsWrapper = socialsMenuRef.current && !socialsMenuRef.current.contains(e.target)
      const isOutsideSocialsDropdown = !socialsDropdown || !socialsDropdown.contains(e.target)
      if (isOutsideSocialsWrapper && isOutsideSocialsDropdown) {
        setShowSocialsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close the timeframe popover on outside click.
  useEffect(() => {
    if (!showTfMenu) return
    const handler = (e) => {
      const dropdown = document.querySelector('.banner-tf-dropdown')
      const outsideTrigger = tfButtonRef.current && !tfButtonRef.current.contains(e.target)
      const outsideDropdown = !dropdown || !dropdown.contains(e.target)
      if (outsideTrigger && outsideDropdown) setShowTfMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTfMenu])

  const toggleTfMenu = () => {
    if (tfButtonRef.current) {
      const rect = tfButtonRef.current.getBoundingClientRect()
      // Right-anchor the popover so it doesn't blow past the banner's
      // right edge on narrow widths.
      const POP_WIDTH = 110
      setTfMenuPosition({ top: rect.bottom + 6, left: rect.right - POP_WIDTH })
    }
    setShowTfMenu((v) => !v)
  }
  const pickTf = (tf) => {
    setSelectedTimeframe(tf)
    setShowTfMenu(false)
  }

  const handleMoreClick = () => {
    if (moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 8,
        left: rect.left
      })
    }
    setShowSocialsMenu(!showSocialsMenu)
  }

  const selectedData = priceData[selectedTimeframe]

  // Collapse/expand state
  const [isExpanded, setIsExpanded] = useState(true)

  // Get token brand color for dynamic banner glow
  // Start with sync known color, then upgrade via server extraction for unknowns
  const syncColor = getTokenColor(token.symbol, token.address)
  const [bannerColor, setBannerColor] = useState(syncColor)

  // Update sync color immediately when token changes
  useEffect(() => {
    const logoUrl = token.logo

    // Curated dictionary wins over session cache - canvas-extracted hues
    // from mostly-white logos (e.g. PIPPIN's pink flower) must not override
    // the hand-picked brand color.
    if (hasKnownColor(token.symbol)) {
      setBannerColor(getTokenColor(token.symbol, token.address))
      return
    }

    // For unknown tokens, session cache is the next-best signal.
    const cachedColor = logoUrl ? getCachedColor(logoUrl) : null
    if (cachedColor && cachedColor !== '#D4D4D8') {
      setBannerColor(cachedColor)
      return
    }

    const newSync = getTokenColor(token.symbol, token.address)
    setBannerColor(newSync)
    let cancelled = false

    if (logoUrl && logoUrl !== '/logo.png') {
      // Race server + canvas in parallel - first valid color wins
      let resolved = false
      const applyFirst = (color) => {
        // Both extractors return null on failure (post Layer-1 contract).
        // The `!color` short-circuit handles it; the previous explicit
        // `color === '#D4D4D8'` guard is now vestigial.
        if (cancelled || resolved || !color) return
        resolved = true
        setBannerColor(color)
      }
      fetchTokenColorFromServer(logoUrl).then(applyFirst)
      extractColorFromImage(logoUrl).then(applyFirst)
    }
    return () => { cancelled = true }
  }, [token.symbol, token.address, token.logo])

  // Sync page background colors with banner color - single source of truth
  // Always apply, even for default color - clears stale vars from previous token
  useEffect(() => {
    if (!bannerColor) return
    const bgColors = generateTokenBackgroundColors(bannerColor)
    const root = document.documentElement
    root.style.setProperty('--token-bg-primary', bgColors.primary)
    root.style.setProperty('--token-bg-secondary', bgColors.secondary)
    root.style.setProperty('--token-bg-tertiary', bgColors.tertiary)
    root.style.setProperty('--token-bg-accent-1', bgColors.accent1)
    root.style.setProperty('--token-bg-accent-2', bgColors.accent2)
    root.style.setProperty('--token-grid-color', bgColors.grid)
    root.style.setProperty('--token-diagonal-1', bgColors.diagonal1)
    root.style.setProperty('--token-diagonal-2', bgColors.diagonal2)
    root.style.setProperty('--token-orb-1', bgColors.orb1)
    root.style.setProperty('--token-orb-2', bgColors.orb2)
    root.style.setProperty('--token-orb-3', bgColors.orb3)
  }, [bannerColor])

  const brandRgb = (() => {
    if (!bannerColor) return '212, 212, 216'
    if (bannerColor.startsWith('#')) {
      const hex = bannerColor.slice(1)
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      if (luminance < 0.15) return '180, 180, 190'
      return `${r}, ${g}, ${b}`
    }
    return '212, 212, 216'
  })()

  const bannerStyle = {
    '--token-rgb': brandRgb,
  }

  return (
    <div
      className={`token-banner ${!isExpanded ? 'collapsed' : ''}`}
      style={bannerStyle}
    >
      {/* Ambient glow layers - colored by token brand */}
      <div className="token-banner-glow" />
      <div className="token-banner-glow-secondary" />

      {/* Toggle Button */}
      <button
        className="banner-toggle-btn"
        onClick={() => setIsExpanded(!isExpanded)}
        title={isExpanded ? "Collapse" : "Expand"}
        aria-label={isExpanded ? "Collapse banner" : "Expand banner"}
      >
        <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={14} />
      </button>

      {/* ROW 1: Logo + Symbol/Name + CA + Heart + Price + TF + Change */}
      <div className="banner-row-1">
        <div className="banner-identity">
          <div className="token-logo-wrap">
            {/* Inner clip — gets overflow:hidden so wide / oddly-padded
                logos (e.g. SPECTRE wave mark) stay inside the circular
                boundary. Orbit ring at .token-logo-wrap::after sits
                outside this clip so it keeps its inset:-6px halo. */}
            <div className="token-logo-clip">
              <img
                src={getHardcodedLogo(token.address) || liveData?.logo || token.logo || '/logo.png'}
                alt={token.symbol}
                className="token-logo"
                onError={(e) => { e.target.src = '/logo.png' }}
              />
            </div>
          </div>
          <span className="token-symbol">{token.symbol}</span>
          <span className="token-fullname">{token.name}</span>
        </div>

        {/* Chain tag removed 2026-07-03 per Gleb - the chain is already
            visible in the header capsule + explorer icon; the extra tag
            crowded row 1. */}

        {/* Inline contract address + explorer link, restored 2026-06-12 per
            Gleb (was briefly collapsed into a "..." popover by the mobile
            redesign - desktop wants the CA visible at a glance). */}
        <span className="banner-ca" onClick={copyAddress} title="Click to copy address" role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && copyAddress()}>
          {truncateAddress(tokenAddress)}
          <Icon name="copy" size={11} />
        </span>
        <a
          href={getExplorerUrl()}
          className="banner-explorer"
          title={`View on ${getExplorerName()}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={getExplorerLogo()} alt="Explorer" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        </a>

        <button
          className={`banner-watchlist-btn ${isInWatchlist ? 'active' : ''}`}
          onClick={handleWatchlistToggle}
          title={isInWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}
        >
          <Icon name={isInWatchlist ? 'heart-filled' : 'heart'} size={16} />
        </button>

        <div className="banner-price-group">
          {/* Tap the big number to flip Price <-> MCap (GMGN pattern, same
              as the mobile hero). Falls back to price when mcap unknown. */}
          <div
            className={`price-amount ${priceFlash ? `flash-${priceFlash}` : ''} ${loading ? 'loading' : ''} price-amount--toggle`}
            role="button"
            tabIndex={0}
            title={bigMode === 'mcap' ? 'Showing market cap — tap for price' : 'Showing price — tap for market cap'}
            onClick={toggleBigMode}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBigMode() } }}
          >
            {(() => {
              if (loading) return '---'
              const mcapText = bigMode === 'mcap' ? formatCompactUsd(token.marketCap) : null
              if (mcapText) {
                return (
                  <>
                    <span className="price-amount-tag" aria-hidden="true">MC</span>
                    {mcapText}
                  </>
                )
              }
              return `$${formatTokenPrice(token.price)}`
            })()}
            {priceFlash && <span className="price-update-indicator">{priceFlash === 'up' ? '↑' : '↓'}</span>}
          </div>
          <div className={`price-change ${selectedData.change == null ? 'neutral' : selectedData.change >= 0 ? 'positive' : 'negative'}`}>
            {selectedData.change == null
              ? '-'
              : `${selectedData.change >= 0 ? '+' : ''}${selectedData.change.toFixed(2)}%`}
          </div>
          {isExpanded && (
            <>
              {/* Inline pills — visible on wide banners. */}
              <div className="banner-tf">
                {Object.keys(priceData).map(tf => (
                  <button
                    key={tf}
                    className={`tf-btn ${selectedTimeframe === tf ? 'active' : ''}`}
                    onClick={() => setSelectedTimeframe(tf)}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Compact dropdown — shown on narrow banners (container
                  query in TokenBanner.css swaps visibility). Single
                  trigger that opens a portal popover with the four
                  timeframe options. */}
              <div className="banner-tf-compact">
                <button
                  ref={tfButtonRef}
                  type="button"
                  className={`banner-tf-trigger ${showTfMenu ? 'is-open' : ''}`}
                  aria-haspopup="listbox"
                  aria-expanded={showTfMenu}
                  aria-label="Select timeframe"
                  onClick={toggleTfMenu}
                >
                  <span className="banner-tf-trigger-value">{selectedTimeframe.toUpperCase()}</span>
                  <Icon name="chevron-down" size={12} />
                </button>
                {showTfMenu && ReactDOM.createPortal(
                  <div
                    className="banner-tf-dropdown"
                    role="listbox"
                    style={{ position: 'fixed', top: tfMenuPosition.top, left: tfMenuPosition.left }}
                  >
                    {Object.keys(priceData).map(tf => (
                      <button
                        key={tf}
                        type="button"
                        role="option"
                        aria-selected={selectedTimeframe === tf}
                        className={`banner-tf-dropdown-row ${selectedTimeframe === tf ? 'is-active' : ''}`}
                        onClick={() => pickTf(tf)}
                      >
                        {tf.toUpperCase()}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ROW 2: AI Dossier with the action rail as its toolbar (expanded only).
          The rail (socials | alerts, share, more) is one black key rail that
          sits on the dossier's label line - right-aligned under the timeframe
          rail above it - so the prose below can run the full panel width
          instead of wrapping beside a column of floating icons. The rail is
          built here (its menus, refs and portals belong to the banner) and
          handed to HeaderDossier as a slot. */}
      {isExpanded && (
        <div className="banner-row-2">
          <HeaderDossier token={token} actions={(
          <div className="banner-actions">
            <a href={token.socials?.twitter || '#'} target="_blank" rel="noopener noreferrer" className="action-pill" title="X (Twitter)">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            </a>
            <a href={token.socials?.website || '#'} target="_blank" rel="noopener noreferrer" className="action-pill" title="Website">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
            </a>
            <a href={token.socials?.telegram || '#'} target="_blank" rel="noopener noreferrer" className="action-pill" title="Telegram">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
            </a>
            <span className="action-divider" />
            <AlertButton
              token={token}
              alerts={alerts || []}
              onCreateAlert={onCreateAlert}
              onDeleteAlert={onDeleteAlert}
            />
            <div className="share-btn-wrapper" ref={shareMenuRef}>
              {/* Share + More Socials locked for the beta — both buttons
                  surface a Coming Soon toast instead of opening their
                  dropdowns. Visual: dim + Lock corner glyph. */}
              <button
                ref={shareButtonRef}
                className="action-pill is-locked"
                title="Share (Coming Soon)"
                aria-disabled="true"
                onClick={() => triggerCopyToast('Coming Soon')}
              >
                <Icon name="share" size={15} />
                <Lock size={7} strokeWidth={2} className="action-pill__lock" aria-hidden="true" />
              </button>
              {showShareMenu && ReactDOM.createPortal(
                <div
                  className="share-dropdown"
                  style={{
                    position: 'fixed',
                    top: shareMenuPosition.top,
                    left: shareMenuPosition.left,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="share-dropdown-header">
                    <span className="share-title">Share as Image</span>
                    <span className="share-subtitle">Select what to generate</span>
                  </div>
                  <div className="share-options">
                    {shareOptions.map((option) => (
                      <button
                        key={option.id}
                        className={`share-option ${option.id === 'x-bubblemap' ? 'coming-soon-tooltip' : ''} ${isCapturing && option.id === 'chart' ? 'capturing' : ''}`}
                        aria-label={option.id === 'x-bubblemap' ? 'Coming Soon' : undefined}
                        onClick={() => handleShareOption(option.id)}
                        disabled={isCapturing}
                        onMouseEnter={option.id === 'x-bubblemap' ? (e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          setComingSoonTooltip({
                            visible: true,
                            text: 'Coming Soon',
                            x: rect.left + rect.width / 2,
                            y: rect.top - 8,
                            position: 'top'
                          })
                        } : undefined}
                        onMouseLeave={option.id === 'x-bubblemap' ? () => setComingSoonTooltip({ visible: false, text: '', x: 0, y: 0, position: 'top' }) : undefined}
                      >
                        <span className="share-option-icon">
                          {isCapturing && option.id === 'chart' ? '...' : option.icon}
                        </span>
                        <span className="share-option-label">
                          {isCapturing && option.id === 'chart' ? 'Capturing...' : option.label}
                        </span>
                        {option.hasSubmenu && !isCapturing && (
                          <Icon name="chevron-right" size={16} className="share-option-arrow" />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="share-dropdown-footer">
                    <span>Images are auto-styled with Spectre branding</span>
                  </div>
                </div>,
                document.body
              )}
            </div>

            {/* More Socials Dropdown */}
            <div className="socials-dropdown-wrapper" ref={socialsMenuRef}>
              <button
                ref={moreButtonRef}
                className="action-pill more is-locked"
                title="More Socials (Coming Soon)"
                aria-disabled="true"
                onClick={() => triggerCopyToast('Coming Soon')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="6" cy="12" r="2" />
                  <circle cx="18" cy="12" r="2" />
                </svg>
                <Lock size={7} strokeWidth={2} className="action-pill__lock" aria-hidden="true" />
              </button>
              {showSocialsMenu && ReactDOM.createPortal(
                <div className="socials-dropdown" style={{ top: menuPosition.top, left: menuPosition.left }}>
                  <a href={token.socials?.linkedin || '#'} target="_blank" rel="noopener noreferrer" className="social-menu-item"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg><span>LinkedIn</span></a>
                  <a href={token.socials?.discord || '#'} target="_blank" rel="noopener noreferrer" className="social-menu-item"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg><span>Discord</span></a>
                  <a href={token.socials?.github || '#'} target="_blank" rel="noopener noreferrer" className="social-menu-item"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg><span>GitHub</span></a>
                  <div className="social-menu-divider" />
                  <a href={token.socials?.reddit || '#'} target="_blank" rel="noopener noreferrer" className="social-menu-item"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg><span>Reddit</span></a>
                  <a href={token.socials?.email || '#'} className="social-menu-item"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg><span>Email</span></a>
                </div>,
                document.body
              )}
            </div>
          </div>
          )} />
        </div>
      )}

      {/* Coming Soon Tooltip - Fixed Position */}
      {comingSoonTooltip.visible && (
        <div
          className="coming-soon-tooltip-fixed"
          style={{
            position: 'fixed',
            left: `${comingSoonTooltip.x}px`,
            top: `${comingSoonTooltip.y}px`,
            transform: 'translate(-50%, calc(-100% - 12px))',
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

export default React.memo(TokenBanner)
