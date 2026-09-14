/**
 * DataTabs Component
 * Figma Reference: Tabs section below chart
 * Tabs: Transactions History, Holders, On-Chain Bubblemap, X Bubblemap
 * 
 * NOW WITH REAL-TIME TRADES FROM CODEX API
 */
import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, Suspense } from 'react'
import lazy from '../lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import { readSpectreSwapMarks, isSpectreSwap, readSpectreSwapRows } from '../lib/spectreSwapMarks'
import { trackUi } from '../services/analytics'
import { subscribeNativePrices } from '../services/nativePricesStore'
import { getWalletStats, getPairInfo } from '../services/codexApi'
import {
  ArrowLeftRight,
  Users,
  BarChart3,
  RefreshCw,
  Lock,
  SlidersHorizontal,
  Store,
  Gauge,
  TrendingUp,
  Activity,
  ChevronDown,
} from 'lucide-react'
import useIsMobile from '../hooks/useIsMobile'
import MobileFilterSheet from './mobile/MobileFilterSheet'
import MobileMakerSheet from './mobile/MobileMakerSheet'
import MobileTransactions from './mobile/MobileTransactions'
import TopTradersPanel from './mobile/TopTradersPanel'
import TradeSourceIcon from './TradeSourceIcon'
import WalletAvatar from './WalletAvatar'
import LiquidityPanel from './mobile/LiquidityPanel'
import { tierFromVolume } from './mobile/TraderTier'
import { useLatestTrades } from '../hooks/useCodexData'
import { useCodexTradesStream } from '../hooks/useCodexStream'
import { useSharedTokenDetails } from '../contexts/TokenDetailsContext'
import { formatLargeNumber, formatPrice } from '../services/codexApi'
import { useCopyToast } from '../App'
import useAgeLabel from '../hooks/useAgeLabel'
import useSettingsStore from '../store/useSettingsStore'
import useHoldersChart, { isHoldersChartSupported } from '../hooks/useHoldersChart'
import useTopHolders from '../hooks/useTopHolders'
import MajorCoinPanel from './MajorCoinPanel'
import { resolveMajorCgId } from '../lib/majorTokens'
import { DivergingBar, Odometer, Sparkline, MicroBars } from './ui/viz'
// Phase E: lazy-load below-fold heavyweight tabs. Both are currently
// locked (Coming Soon), but their components were bundled in the main
// chunk and would parse on every token page mount — ~30-80ms of
// blocking work before chart paint. Wrapping in React.lazy defers
// the load until the user clicks the tab, which currently can't happen
// while they're locked, so this is pure bundle-size + parse-time win.
const AnalyticsTab = lazy(() => import('./AnalyticsTab'))
const HoldersChart = lazy(() => import('./HoldersChart'))
// X Charts — unlocked everywhere (Sunny, 2026-07-02). Was dev-only while
// awaiting review.
const XChartsTab = lazy(() => import('./XFullView/XChartsTab'))
import Icon from './Icon'
import './DataTabs.css'

// Grouped type-filter values (DexScreener's "Buy / Sell" and "Add / Remove"
// menu entries) — each expands to the set of raw trade types it matches.
const TYPE_FILTER_GROUPS = {
  swap: ['buy', 'sell'],
  liquidity: ['add', 'remove'],
}

// Iteration 7 — lucide icon map for each tab. The tab strip below renders
// these as `<TabIcon />` so the tab bar reads as a real segmented control,
// not a row of text links.
const TAB_ICONS = {
  transactions: ArrowLeftRight,
  holders: Users,
  analytics: BarChart3,
  // Major-coin (CoinGecko) panel tabs
  markets: Store,
  keystats: Gauge,
  performance: TrendingUp,
}

// Iteration 7 — tabs whose real functionality isn't shipped yet.
// They render as locked pills (Lock glyph + dim) with a Coming Soon
// tooltip on hover + toast on click; remove an id when its content goes live.
// Holders UNLOCKED 2026-08-17 (Gleb): the tab has been fully wired for a while
// (useTopHolders + useHoldersChart, EVM-only with a clean "unavailable on this
// chain" state for Solana), and the crash that originally gated it was fixed
// when `hasOnchainHolders` stopped being an undefined reference.
const LOCKED_TABS = new Set(['analytics'])

// Format timestamp to relative time (age)
const formatAge = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date)) return '-'
  
  const now = new Date()
  const diffMs = Math.max(0, now - date)
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffSecs < 60) return `${diffSecs}s ago`
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  
  return `${Math.floor(diffDays / 30)}mo ago`
}

// Format timestamp to date string (4 Nov 19:12:28)
const formatDate = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date)) return '-'
  
  const day = date.getDate()
  const month = date.toLocaleString('en-US', { month: 'short' })
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  
  return `${day} ${month} ${hours}:${minutes}:${seconds}`
}

// Format token amount
const formatAmount = (amount) => {
  if (!amount || isNaN(amount)) return '-'
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`
  return amount.toFixed(2)
}

// Format USD amount - only prefix $ when there's a real value
const formatUsd = (amount) => {
  if (!amount || isNaN(amount)) return '-'
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`
  // Show full numbers for thousands (e.g. $1,170 not $1.17K)
  if (amount >= 1000) return `$${Math.round(amount).toLocaleString('en-US')}`
  return `$${amount.toFixed(2)}`
}

// Format percentage of supply traded (based on USD value / market cap)
const formatPercentage = (usdValue, marketCap) => {
  if (!usdValue || isNaN(usdValue) || !marketCap || marketCap <= 0) return '-'
  const pct = (usdValue / marketCap) * 100
  if (pct < 0.000001) return '<0.000001%'
  if (pct < 0.0001) return `${pct.toFixed(6)}%`
  if (pct < 0.01) return `${pct.toFixed(4)}%`
  if (pct < 1) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(1)}%`
}

// Format market cap (price × circulating supply)
const formatMcap = (mcap) => {
  if (!mcap || isNaN(mcap)) return '-'
  if (mcap >= 1e9) return `$${(mcap / 1e9).toFixed(2)}B`
  if (mcap >= 1e6) return `$${(mcap / 1e6).toFixed(2)}M`
  if (mcap >= 1e3) return `$${(mcap / 1e3).toFixed(2)}K`
  return `$${mcap.toFixed(2)}`
}

// Format native token value (ETH, SOL, BNB, etc.)
const formatNativeToken = (value, symbol = 'ETH') => {
  if (!value || isNaN(value)) return '-'
  let num
  if (value >= 1000) num = value.toFixed(1)
  else if (value >= 1) num = value.toFixed(3)
  else if (value >= 0.0001) num = value.toFixed(4)   // was 6 dp for <0.01 - too long
  // Below 0.0001 this used to return toExponential(1) - "5.7e-6 ETH" in the
  // trade tape, which reads as a rendering bug and clashes with the price
  // column beside it ("$0.00003368", plain decimal). Cheap-gas chains make
  // these amounts routine, not an edge case. Keep it plain: two significant
  // digits, decimals sized to the magnitude, trailing zeros trimmed below.
  else if (value >= 1e-9) num = value.toFixed(Math.min(12, Math.ceil(-Math.log10(value)) + 1))
  // True dust - a decimal here would be all zeros and still round to nothing.
  else return `<0.000000001 ${symbol}`
  // trim trailing zeros (and a dangling dot) so the column stays compact
  if (num.indexOf('.') !== -1) num = num.replace(/0+$/, '').replace(/\.$/, '')
  return `${num} ${symbol}`
}

// Round up to a clean step (150->200, 1234->1000, 4.2K->5K) for display thresholds.
const niceRound = (n) => {
  if (!n || n <= 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(n)))
  const r = n / mag
  const step = r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10
  return step * mag
}

// Compact USD for small labels ($200, $5K, $1.5M).
const fmtUsdShort = (n) => {
  if (!n || n <= 0) return '$0'
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${+(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}

// Get native token symbol for a network
const getNativeTokenSymbol = (networkId) => {
  const nativeTokens = {
    1: 'ETH',           // Ethereum
    56: 'BNB',          // BSC
    137: 'MATIC',       // Polygon
    42161: 'ETH',       // Arbitrum
    8453: 'ETH',        // Base
    1399811149: 'SOL',  // Solana
  }
  return nativeTokens[networkId] || 'ETH'
}

// Truncate address for display
const truncateAddress = (address) => {
  if (!address) return '-'
  if (address.length <= 13) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Maker type labels - color logic:
// Green family = healthy/smart buys | Cyan = strategic/calculated | Amber/Orange = caution/emotional
// Red family = loss/danger/exit | Pink = bundled/manufactured | Violet = contrarian plays
const BUY_TYPES = [
  { label: 'NEW', name: 'New Holder', color: '#34D399', desc: 'First buy of this token by this wallet.' },
  { label: 'DCA', name: 'Dollar-Cost Average', color: '#06B6D4', desc: 'Additional buy after initial purchase - averaging into position.' },
  { label: 'FOMO', name: 'Buy After Pump', color: '#FBBF24', desc: 'Buy after a significant price increase - chasing the pump.' },
  { label: 'BTD', name: 'Buy the Dip', color: '#A78BFA', desc: 'Buy after a significant price decrease - buying the dip.' },
  { label: 'BB', name: 'Bundle Buy', color: '#F472B6', desc: 'Rebuy after bundle sell - tokens were initially bundled, sold, then rebought.' },
  { label: 'B', name: 'Buyback', color: '#2DD4BF', desc: 'Tokens bought from deployer or tax wallet.' },
  { label: 'SB', name: 'Sniper Buy', color: '#FB7185', desc: 'Tokens bought in the first blocks of launch - likely a sniper bot.' },
  { label: 'EHB', name: 'Early Holder Buy', color: '#4ADE80', desc: 'Wallet that bought very early after token launch (time varies by token age).' },
]

// Dynamic top holder buy labels (T1B - T20B)
const getTopHolderBuyType = (rank) => ({
  label: `T${rank}B`,
  name: `Top ${rank} Holder Buy`,
  color: '#4ADE80',
  desc: `Top ${rank} holder (out of top 20) is buying more tokens.`
})

const SELL_TYPES = [
  { label: 'TP', name: 'Take Profit', color: '#34D399', desc: 'Wallet sold tokens at a profit.' },
  { label: 'SAL', name: 'Sell at Loss', color: '#F87171', desc: 'Wallet sold tokens at a loss.' },
  { label: 'PANIC', name: 'Panic Sell', color: '#EF4444', desc: 'Sell during or after a significant price increase - panic selling.' },
  { label: 'OUT', name: 'Full Exit', color: '#FB923C', desc: 'Wallet sold ALL tokens - complete exit from position.' },
  { label: 'PART', name: 'Partial Exit', color: '#C084FC', desc: 'Wallet sold some tokens but still holds a portion.' },
  { label: 'REKT', name: 'Exit at Heavy Loss', color: '#DC2626', desc: 'Wallet sold all tokens at 70%+ loss - got rekt.' },
  { label: 'DS', name: 'Deployer Sell', color: '#F43F5E', desc: 'Token sells directly from the deployer wallet - potential red flag.' },
  { label: 'DTS', name: 'Deployer Transfer & Sell', color: '#E11D48', desc: 'Tokens transferred from deployer to another wallet, then sold - obfuscated dev sell.' },
  { label: 'BS', name: 'Bundle Sell', color: '#F472B6', desc: 'Supply was initially bundled, then distributed and sold.' },
  { label: 'SS', name: 'Sniper Sell', color: '#FB7185', desc: 'Sniper bot selling tokens after early buy.' },
  { label: 'EHS', name: 'Early Holder Sell', color: '#FDBA74', desc: 'Early holder is selling their position.' },
]

// Dynamic top holder sell labels (T1S - T20S)
const getTopHolderSellType = (rank) => ({
  label: `T${rank}S`,
  name: `Top ${rank} Holder Sell`,
  color: '#FDBA74',
  desc: `Top ${rank} holder (out of top 20) is selling tokens.`
})

// Get maker type based on address hash and transaction type (mock)
const getMakerType = (address, txType) => {
  if (!address) return null
  // Use address hash to get consistent type for same maker
  const hash = address.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const types = txType === 'buy' ? BUY_TYPES : SELL_TYPES
  return types[hash % types.length]
}

// Plain-English DeFi explanations for the Flow Intelligence command-bar widgets.
const FLOW_TIPS = {
  pressure: 'Buy/sell pressure - the share of recent trades that are buys. Above 50% (green) means buyers outnumber sellers on the tape, demand-side pressure that often precedes upward moves. Below 50% (red) means sellers dominate.',
  netflow: 'Net flow - total buy volume minus total sell volume (in USD) over the selected window. Positive (green) = more money entering than leaving the token, i.e. net accumulation. Negative (red) = net money leaving, i.e. distribution.',
  whales: 'Whale prints - large trades relative to THIS token, not a fixed dollar amount. The threshold (shown under the count) scales with the token\'s typical trade size and 24h volume, so it stays meaningful on a micro-cap and a major alike. The bars show whale size over time, green when buy-led, red when sell-led.',
  accumulating: 'Accumulators - wallets that have bought more than once and are net buyers in this tape (holding, not flipping). A read on smart money quietly building positions. Shows the single biggest net buyer plus the total number of unique wallets trading.',
  velocity: 'Trade velocity - the number of trades in the selected window (per 5m / 1h / 24h), so it always reflects the timeframe you picked. The sparkline shows how that activity is spread across the window. Rising velocity signals heating attention.',
}



// ============================================================
// DEAD CODE - DO NOT WIRE UP. Liquidation Tab, Apple Cinematic Style.
//
// `LiquidationTab` has no mount site anywhere in the app (grep-verified
// 2026-07-23: the only hit is its own definition). It stays quarantined
// rather than deleted so the layout work is not lost - but it MUST NOT be
// rendered as-is, because every number below is FABRICATED: the liquidation
// clusters, leverage ratio, net flow and funding delta are all Math.random().
// Shipping that in a trading UI would be inventing financial data on screen.
// Wiring this tab means replacing the generators with a real feed first
// (the research app's /api/market/liquidations lane is the honest source).
// ============================================================

// Generate liquidation heatmap data based on current price
const generateLiquidationData = (currentPrice) => {
  if (!currentPrice || currentPrice <= 0) currentPrice = 1
  const levels = []
  // Generate price levels from -15% to +15% of current price (compact view)
  const steps = 8
  const range = 0.15
  for (let i = -steps; i <= steps; i++) {
    const priceMult = 1 + (i / steps) * range
    const price = currentPrice * priceMult
    // Liquidation volume follows a pattern - clusters near current price and at key levels
    const distFromCenter = Math.abs(i)
    const baseVol = Math.max(0, 100 - distFromCenter * 8)
    // Add random spikes at certain levels to simulate real liquidation clusters
    const spike = (i % 3 === 0 || i % 5 === 0) ? Math.random() * 80 + 40 : 0
    const longLiq = i < 0 ? baseVol + spike + Math.random() * 30 : Math.random() * 15
    const shortLiq = i > 0 ? baseVol + spike + Math.random() * 30 : Math.random() * 15
    levels.push({
      price,
      priceLabel: price < 0.01 ? price.toExponential(2) : price < 1 ? price.toFixed(4) : price < 100 ? price.toFixed(2) : formatLargeNumber(price).replace('$', ''),
      longLiq: Math.round(longLiq),
      shortLiq: Math.round(shortLiq),
      totalLiq: Math.round(longLiq + shortLiq),
      distPercent: ((priceMult - 1) * 100).toFixed(1),
      isNearCurrent: Math.abs(i) <= 1,
    })
  }
  return levels
}

// Liquidation summary stats
const generateLiqStats = (levels) => {
  const totalLongLiq = levels.reduce((s, l) => s + l.longLiq, 0)
  const totalShortLiq = levels.reduce((s, l) => s + l.shortLiq, 0)
  const maxLevel = levels.reduce((max, l) => l.totalLiq > max.totalLiq ? l : max, levels[0])
  const longCluster = levels.filter(l => l.longLiq > 60).length
  const shortCluster = levels.filter(l => l.shortLiq > 60).length
  return { totalLongLiq, totalShortLiq, maxLevel, longCluster, shortCluster }
}

const LiquidationTab = ({ token }) => {
  const [timeframe, setTimeframe] = useState('24h')
  const [hoveredLevel, setHoveredLevel] = useState(null)

  const currentPrice = token?.price || 1
  const levels = useMemo(() => generateLiquidationData(currentPrice), [currentPrice])
  const stats = useMemo(() => generateLiqStats(levels), [levels])
  const maxTotal = useMemo(() => Math.max(...levels.map(l => l.totalLiq)), [levels])

  // AI Analysis data
  const aiInsights = useMemo(() => {
    const longDominance = stats.totalLongLiq > stats.totalShortLiq
    const imbalance = Math.abs(stats.totalLongLiq - stats.totalShortLiq) / (stats.totalLongLiq + stats.totalShortLiq) * 100
    return {
      bias: longDominance ? 'Long-Heavy' : 'Short-Heavy',
      biasColor: longDominance ? '#EF4444' : '#10B981',
      imbalance: imbalance.toFixed(1),
      riskLevel: imbalance > 40 ? 'High' : imbalance > 20 ? 'Medium' : 'Low',
      riskColor: imbalance > 40 ? '#EF4444' : imbalance > 20 ? '#F59E0B' : '#10B981',
      cascadeRisk: stats.longCluster > 3 || stats.shortCluster > 3 ? 'Elevated' : 'Normal',
      cascadeColor: stats.longCluster > 3 || stats.shortCluster > 3 ? '#F59E0B' : '#10B981',
      magnetPrice: stats.maxLevel?.priceLabel || '—',
      summary: longDominance
        ? `Heavy long liquidation clusters detected below current price. A ${imbalance.toFixed(0)}% imbalance suggests vulnerability to downside cascades. Exercise caution with leveraged long positions.`
        : `Short liquidation concentration above current price indicates squeeze potential. ${imbalance.toFixed(0)}% imbalance favors upward pressure if key resistance levels break.`,
      signals: [
        {
          label: 'Leverage Ratio',
          value: (2.4 + Math.random() * 1.2).toFixed(1) + 'x',
          status: 'neutral',
        },
        {
          label: 'Open Interest Delta',
          value: (longDominance ? '+' : '-') + '$' + ((Math.random() * 50 + 10).toFixed(1)) + 'M',
          status: longDominance ? 'bearish' : 'bullish',
        },
        {
          label: 'Funding Rate',
          value: (longDominance ? '+' : '-') + (Math.random() * 0.05 + 0.01).toFixed(4) + '%',
          status: longDominance ? 'bearish' : 'bullish',
        },
        {
          label: 'Liquidation Velocity',
          value: (Math.random() * 8 + 2).toFixed(1) + '/hr',
          status: 'neutral',
        },
      ],
    }
  }, [stats])

  return (
    <div className="liquidation-tab">
      {/* Top: Header + Stats (pinned, never scrolls) */}
      <div className="liq-tab-header">
        <div className="liq-tab-title-row">
          <div className="liq-tab-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span>Liquidation Heatmap</span>
          </div>
          <div className="liq-timeframe-pills">
            {['1h', '4h', '24h', '7d'].map(tf => (
              <button
                key={tf}
                className={`liq-tf-pill ${timeframe === tf ? 'active' : ''}`}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Split layout: Heatmap left, AI Analysis right */}
      <div className="liq-split-layout">

        {/* LEFT: Scrollable heatmap */}
        <div className="liq-heatmap-panel">
          {/* Summary stats row */}
          <div className="liq-summary-stats">
            <div className="liq-stat-card">
              <span className="liq-stat-label">Long Liq</span>
              <span className="liq-stat-value bear">${formatLargeNumber(stats.totalLongLiq * 100000).replace('$', '')}</span>
            </div>
            <div className="liq-stat-card">
              <span className="liq-stat-label">Short Liq</span>
              <span className="liq-stat-value bull">${formatLargeNumber(stats.totalShortLiq * 100000).replace('$', '')}</span>
            </div>
            <div className="liq-stat-card">
              <span className="liq-stat-label">Cluster</span>
              <span className="liq-stat-value">{stats.maxLevel?.priceLabel}</span>
            </div>
            <div className="liq-stat-card">
              <span className="liq-stat-label">Imbalance</span>
              <span className="liq-stat-value" style={{ color: aiInsights.biasColor }}>{aiInsights.imbalance}%</span>
            </div>
          </div>

          {/* Heatmap rows (scrollable) */}
          <div className="liq-heatmap-scroll">
            <div className="liq-heatmap">
              {/* Current price marker */}
              <div className="liq-current-price-line" style={{ top: '50%' }}>
                <span className="liq-current-price-tag">Current</span>
              </div>

              {levels.map((level, i) => {
                const longWidth = maxTotal > 0 ? (level.longLiq / maxTotal) * 100 : 0
                const shortWidth = maxTotal > 0 ? (level.shortLiq / maxTotal) * 100 : 0
                const intensity = level.totalLiq / maxTotal
                const isHovered = hoveredLevel === i

                return (
                  <div
                    key={i}
                    className={`liq-heatmap-row ${level.isNearCurrent ? 'near-current' : ''} ${isHovered ? 'hovered' : ''}`}
                    onMouseEnter={() => setHoveredLevel(i)}
                    onMouseLeave={() => setHoveredLevel(null)}
                  >
                    <div className="liq-row-price">
                      <span className="liq-price-val">{level.priceLabel}</span>
                      <span className={`liq-price-dist ${parseFloat(level.distPercent) >= 0 ? 'up' : 'down'}`}>
                        {parseFloat(level.distPercent) >= 0 ? '+' : ''}{level.distPercent}%
                      </span>
                    </div>

                    <div className="liq-row-bars">
                      {/* Long liquidation bar (red - left side) */}
                      <div className="liq-bar-track long">
                        <div
                          className="liq-bar-fill long"
                          style={{
                            width: `${longWidth}%`,
                            opacity: 0.4 + intensity * 0.6,
                          }}
                        />
                        {longWidth > 15 && (
                          <span className="liq-bar-label">${formatLargeNumber(level.longLiq * 100000).replace('$', '')}</span>
                        )}
                      </div>

                      {/* Divider */}
                      <div className="liq-bar-divider" />

                      {/* Short liquidation bar (green - right side) */}
                      <div className="liq-bar-track short">
                        <div
                          className="liq-bar-fill short"
                          style={{
                            width: `${shortWidth}%`,
                            opacity: 0.4 + intensity * 0.6,
                          }}
                        />
                        {shortWidth > 15 && (
                          <span className="liq-bar-label">${formatLargeNumber(level.shortLiq * 100000).replace('$', '')}</span>
                        )}
                      </div>
                    </div>

                    {/* Hover tooltip */}
                    {isHovered && (
                      <div className="liq-row-tooltip">
                        <div className="liq-tooltip-price">{level.priceLabel}</div>
                        <div className="liq-tooltip-row">
                          <span className="liq-tooltip-dot long" />
                          <span>Longs: ${formatLargeNumber(level.longLiq * 100000).replace('$', '')}</span>
                        </div>
                        <div className="liq-tooltip-row">
                          <span className="liq-tooltip-dot short" />
                          <span>Shorts: ${formatLargeNumber(level.shortLiq * 100000).replace('$', '')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="liq-heatmap-legend">
              <div className="liq-legend-item">
                <span className="liq-legend-swatch long" />
                <span>Longs</span>
              </div>
              <div className="liq-legend-item">
                <span className="liq-legend-swatch short" />
                <span>Shorts</span>
              </div>
              <div className="liq-legend-item">
                <span className="liq-legend-swatch current" />
                <span>Current</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: AI Analysis (always visible, no scroll needed) */}
        <div className="liq-ai-section">
          <div className="liq-ai-header">
            <div className="liq-ai-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93L12 22"/>
                <path d="M12 2a4 4 0 0 0-4 4c0 1.95 1.4 3.58 3.25 3.93"/>
                <path d="M8.56 13.68C5.05 15.84 3 18.48 3 20a9 9 0 0 0 18 0c0-1.52-2.05-4.16-5.56-6.32"/>
              </svg>
              <span>AI Analysis</span>
              <span className="liq-ai-live-dot" />
            </div>
            <span className="liq-ai-model">Spectre Intelligence</span>
          </div>

          {/* AI Metrics Grid */}
          <div className="liq-ai-metrics">
            <div className="liq-ai-metric">
              <span className="liq-ai-metric-label">Market Bias</span>
              <span className="liq-ai-metric-value" style={{ color: aiInsights.biasColor }}>
                {aiInsights.bias}
              </span>
            </div>
            <div className="liq-ai-metric">
              <span className="liq-ai-metric-label">Risk Level</span>
              <span className="liq-ai-metric-value" style={{ color: aiInsights.riskColor }}>
                {aiInsights.riskLevel}
              </span>
            </div>
            <div className="liq-ai-metric">
              <span className="liq-ai-metric-label">Cascade Risk</span>
              <span className="liq-ai-metric-value" style={{ color: aiInsights.cascadeColor }}>
                {aiInsights.cascadeRisk}
              </span>
            </div>
            <div className="liq-ai-metric">
              <span className="liq-ai-metric-label">Price Magnet</span>
              <span className="liq-ai-metric-value">{aiInsights.magnetPrice}</span>
            </div>
          </div>

          {/* AI Signal Chips */}
          <div className="liq-ai-signals">
            {aiInsights.signals.map((signal, i) => (
              <div key={i} className={`liq-ai-signal ${signal.status}`}>
                <span className="liq-signal-label">{signal.label}</span>
                <span className="liq-signal-value">{signal.value}</span>
              </div>
            ))}
          </div>

          {/* AI Summary */}
          <div className="liq-ai-summary">
            <p>{aiInsights.summary}</p>
          </div>

          {/* Disclaimer */}
          <div className="liq-ai-disclaimer">
            AI-generated analysis. Not financial advice.
          </div>
        </div>
      </div>
    </div>
  )
}

// Get explorer URL for transaction or address
const getExplorerUrl = (hash, networkId, type = 'tx') => {
  const baseUrls = {
    1: 'https://etherscan.io',
    56: 'https://bscscan.com',
    137: 'https://polygonscan.com',
    42161: 'https://arbiscan.io',
    8453: 'https://basescan.org',
    1399811149: 'https://solscan.io',
    4663: 'https://robinhoodchain.blockscout.com',
  }
  const base = baseUrls[networkId] || baseUrls[1]
  const path = type === 'address' ? '/address/' : '/tx/'
  return `${base}${path}${hash}`
}

/**
 * HolderRow — one wallet in the Holders tab.
 *
 * Memoized on VALUES, not object identity: `holderRows` is rebuilt whenever the
 * live price ticks, so an identity comparison would re-render all 50 rows several
 * times a minute for numbers that mostly did not move.
 */
const HolderRow = React.memo(function HolderRow({
  h, maxPct, symbol, networkId, isFiltered, onFilterSwaps, onCopy,
}) {
  const sym = symbol || 'TOKEN'
  const pnlUp = (h.pnlUsd || 0) >= 0
  // Bars are relative to the LARGEST holding, not to 100% of supply - against
  // total supply every row on a well-distributed token is an invisible sliver.
  const barPct = Math.max(1.5, Math.min(100, ((h.percentage || 0) / maxPct) * 100))

  return (
    <tr className={isFiltered ? 'hld-row is-filtered' : 'hld-row'}>
      <td className="hld-rank">{h.rank}</td>

      <td className="hld-wallet">
        <span className="hld-wallet-inner">
          <WalletAvatar address={h.address} size={22} className="hld-avatar" />
          {/* `label` is whatever the upstream tagged (exchange / contract name).
              There is NO ENS or SNS resolver in this app, so an untagged wallet
              shows a truncated address rather than a name we cannot resolve. */}
          {h.label
            ? <span className="hld-name" title={h.address}>{h.label}</span>
            : <span className="hld-addr" title={h.address}>{truncateAddress(h.address)}</span>}
          {h.type && h.type !== 'Holder' && (
            <span className={`hld-tag hld-tag--${String(h.type).toLowerCase()}`}>{h.type}</span>
          )}
          {/* Apps the wallet trades through (Codex walletTradeSourceIds) -
              brand tiles, at most two; the cell is narrow. */}
          {h.sources && h.sources.slice(0, 2).map((id) => (
            <TradeSourceIcon key={id} source={{ id }} className="hld-src" size={16} />
          ))}
        </span>
      </td>

      <td className="hld-amount">
        <span className="hld-amount-val">{formatAmount(h.balance)}</span>
        <span className="hld-amount-sym">{sym}</span>
      </td>

      <td className="hld-share">
        <span className="hld-bar">
          <span className="hld-bar-fill" style={{ width: `${barPct}%` }} />
          <span className="hld-bar-text">{(h.percentage || 0).toFixed(2)}%</span>
        </span>
      </td>

      <td className="hld-value">{formatUsd(h.valueUsd)}</td>

      {/* PnL needs a cost basis, which only exists for wallets that actually
          BOUGHT the token. Three distinct states, never a fabricated zero:
          a real figure, "no buys" (confirmed transfer-acquired), or a dash
          (we have no record of this wallet trading at all). */}
      <td className="hld-pnl">
        {h.pnlUsd != null ? (
          <span className={pnlUp ? 'hld-pnl-up' : 'hld-pnl-down'}>
            <span className="hld-pnl-usd">{pnlUp ? '+' : '-'}{formatUsd(Math.abs(h.pnlUsd))}</span>
            {h.pnlPct != null && (
              <span className="hld-pnl-pct">{pnlUp ? '+' : ''}{h.pnlPct.toFixed(1)}%</span>
            )}
          </span>
        ) : h.noBuys ? (
          <span className="hld-nobuys" title="This wallet never bought the token on a DEX - the balance arrived by transfer, airdrop or a CEX withdrawal, so there is no cost basis to measure PnL against.">no buys</span>
        ) : (
          <span className="hld-unknown" title="No trading record found for this wallet on this token, so there is no cost basis to compute PnL from.">-</span>
        )}
      </td>

      <td className="hld-remain">
        {h.remainPct != null ? (
          <span className="hld-remain-inner">
            <span className="hld-remain-top">
              {h.remainPct.toFixed(0)}%
              <span className="hld-remain-usd">{formatUsd(h.remainUsd)}</span>
            </span>
            {/* the "out of what" */}
            <span className="hld-remain-of">of {formatUsd(h.boughtUsd)} bought</span>
          </span>
        ) : h.noBuys ? (
          <span className="hld-nobuys" title="Nothing bought, so there is nothing remaining to measure.">no buys</span>
        ) : (
          <span className="hld-unknown" title="No buy history found for this wallet.">-</span>
        )}
      </td>

      <td className="hld-act">
        <span className="hld-actions">
          <button
            type="button"
            className={`maker-action-btn filter-btn-icon ${isFiltered ? 'active' : ''}`}
            title={isFiltered ? 'Filtering the tape by this wallet' : 'Show this wallet’s swaps'}
            onClick={() => onFilterSwaps?.(h.address)}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z" />
            </svg>
          </button>
          <button
            type="button"
            className="maker-action-btn copy-btn"
            title="Copy address"
            onClick={() => { navigator.clipboard.writeText(h.address); onCopy?.() }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <a
            href={getExplorerUrl(h.address, networkId, 'address')}
            target="_blank"
            rel="noopener noreferrer"
            className="maker-action-btn chart-btn"
            title="View on explorer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="6" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </a>
        </span>
      </td>
    </tr>
  )
}, (p, n) => (
  p.maxPct === n.maxPct && p.symbol === n.symbol && p.networkId === n.networkId &&
  p.isFiltered === n.isFiltered && p.onFilterSwaps === n.onFilterSwaps && p.onCopy === n.onCopy &&
  p.h.address === n.h.address && p.h.rank === n.h.rank && p.h.balance === n.h.balance &&
  p.h.percentage === n.h.percentage && p.h.valueUsd === n.h.valueUsd &&
  p.h.pnlUsd === n.h.pnlUsd && p.h.remainPct === n.h.remainPct && p.h.label === n.h.label &&
  // noBuys flips only when the wallet-stats response lands, which is exactly
  // when the cell must repaint from "-" to "no buys". Omitting it here would
  // freeze every unresolved row on the dash it first rendered with.
  p.h.noBuys === n.h.noBuys &&
  // Same array reference until the next wallet-stats fetch, so this is cheap.
  p.h.sources === n.h.sources
))

// Memoized trade row - avoids re-rendering all rows when one trade updates
const TradeRow = React.memo(function TradeRow({
  tx, index, nativePrice, nativeTokenSymbol, showDateMode, showPriceMode,
  showAmountMode, circulatingSupply, marketCap, makerStats, makerFilter,
  clearMakerFilter, filterByMaker, triggerCopyToast, tokenNetworkId,
  tokenPrice, tokenSymbol, isMobile, onMakerTap, isSpectre,
}) {
  // Gates the two hover tooltips below - see the note on the <tr>.
  const [hovered, setHovered] = useState(false)
  // The row is memoised on the trade, so the age has to tick itself - a
  // parent re-render never reaches it (see useAgeLabel).
  const age = useAgeLabel(tx.timestamp, formatAge, !showDateMode)
  // Compute reliable USD from amount * price (server amountUSD has decimal bugs)
  const txUsd = (parseFloat(tx.amount) || 0) * (parseFloat(tx.price) || 0)
  const txNative = (txUsd > 0 && nativePrice > 0) ? txUsd / nativePrice : 0
  const isBuy = tx.type?.toLowerCase() === 'buy'
  // Determine trade size tier for the row left-spine
  const usdValue = txUsd || tx.value || 0
  let sizeTier = ''
  if (usdValue >= 50000) sizeTier = 'whale'
  else if (usdValue >= 10000) sizeTier = 'large'
  else if (usdValue >= 1000) sizeTier = 'medium'

  // Market-cap-relative significance -> USD value emphasis + per-row volume tint.
  // Hoisted out of the USD cell so it computes once per row and also feeds the
  // row's data-bar fill (the subtle mint/coral bar behind each row).
  const _mc = marketCap > 0 ? marketCap : 1_000_000
  const _brk = [
    [100_000, 5, 50, 500], [500_000, 10, 100, 1_000], [2_000_000, 25, 250, 2_500],
    [10_000_000, 50, 500, 5_000], [50_000_000, 100, 1_000, 10_000],
    [250_000_000, 250, 2_500, 25_000], [1_000_000_000, 500, 5_000, 50_000],
    [Infinity, 1_000, 10_000, 100_000],
  ].find(([ceil]) => _mc < ceil)
  const usdTier = txUsd >= _brk[3] ? 'whale' : txUsd >= _brk[2] ? 'big' : txUsd >= _brk[1] ? 'mid' : 'small'
  // Floor at 3% rather than 0. A sub-threshold print used to render an EMPTY
  // pill in the SIZE column, which reads as a broken cell rather than as "this
  // trade is noise"; 3% vs 80% still says the same thing, and every row now
  // carries a readable bar.
  const usdBarWidth = usdTier === 'small' ? 3
    : Math.min(100, Math.max(8, (Math.log10(txUsd / _brk[1]) + 0.3) * 33))

  // Use all-time tx count from our API if available, else count from pre-computed map
  const txCount = (tx.makerTotalBuys || 0) + (tx.makerTotalSells || 0) || (makerStats?.count || 0)
  // Maker identification label - our established system (NEW/DCA/FOMO/BTD/SB...
  // for buys, TP/SAL/PANIC/REKT/DS/SS... for sells). Prefer the real API label
  // when present (string -> resolve to the full type object), else the
  // deterministic type. The per-row position bar below carries the
  // accumulate-vs-dump read separately.
  let makerType = getMakerType(tx.maker, tx.type?.toLowerCase())
  if (tx.makerLabel) {
    if (typeof tx.makerLabel === 'object') {
      makerType = tx.makerLabel
    } else {
      const _pool = tx.type?.toLowerCase() === 'buy' ? BUY_TYPES : SELL_TYPES
      makerType = _pool.find(t => t.label === tx.makerLabel)
        || { label: tx.makerLabel, name: tx.makerLabel, color: isBuy ? '#34D399' : '#F87171', desc: '' }
    }
  }

  // Maker summary tooltip data from pre-computed stats
  const apiBuyCount = tx.makerTotalBuys || 0
  const apiSellCount = tx.makerTotalSells || 0
  const visibleBuyCount = makerStats?.buys || 0
  const visibleSellCount = makerStats?.sells || 0
  const buyCount = apiBuyCount || visibleBuyCount
  const sellCount = apiSellCount || visibleSellCount
  const totalBoughtUsd = makerStats?.buyUsd || 0
  const totalSoldUsd = makerStats?.sellUsd || 0
  const totalBoughtTokens = makerStats?.buyTokens || 0
  const totalSoldTokens = makerStats?.sellTokens || 0
  const hasHiddenBuys = apiBuyCount > visibleBuyCount
  const hasHiddenSells = apiSellCount > visibleSellCount
  const partial = hasHiddenBuys || hasHiddenSells
  const holdingTokens = partial ? null : Math.max(0, totalBoughtTokens - totalSoldTokens)
  const currentPrice = tokenPrice || tx.price || 0
  const holdingUsd = holdingTokens != null ? holdingTokens * currentPrice : null
  const realizedPnl = tx.makerPnlUsd || (partial ? null : (totalSoldUsd - (totalBoughtUsd * (totalSoldTokens / (totalBoughtTokens || 1)))))
  const sym = tokenSymbol || 'TOKEN'
  const makerTrades = makerStats?.trades || []
  const firstTx = makerTrades.length ? makerTrades[makerTrades.length - 1] : null
  const lastTx = makerTrades[0]

  return (
    <tr
      className={`${tx.type?.toLowerCase()} ${sizeTier}`}
      style={usdBarWidth ? { '--data-bar-fill': `${usdBarWidth}%` } : undefined}
      // Tooltips render ONLY while this row is hovered. They used to mount for
      // every row up front: measured on prod, 98 `.maker-tooltip` nodes for 49
      // rows, each carrying `backdrop-filter: blur(20px) saturate(1.4)` and a
      // full summary table, all sitting at `display:none`. That was ~1.3k dead
      // DOM nodes and 95% of the page's backdrop-filter count, re-rendered on
      // every trade tick for content nobody was looking at. Hover state is
      // local to the row, so only the hovered row re-renders.
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      {/* The wallet's pfp opens the row (GMGN style) - a deterministic sigil
          from the address, so a repeat trader is spotted down the column before
          the address on the far right is read. */}
      <td className="cell-pfp">
        {tx.maker && <WalletAvatar address={tx.maker} size={22} className="row-pfp" />}
      </td>
      <td className="cell-date">{showDateMode ? formatDate(tx.timestamp) : age}</td>
      <td className="cell-type">
        <span className={`type-badge ${tx.type?.toLowerCase() || 'swap'}`}>
          {tx.type || 'Swap'}
        </span>
      </td>
      <td className="cell-price">
        {showPriceMode
          ? (tx.formattedPrice || formatPrice(tx.price))
          : formatMcap(tx.price * circulatingSupply)
        }
      </td>
      <td className="cell-amount">{showAmountMode ? formatAmount(tx.amount) : formatPercentage((tx.amount && tx.price) ? tx.amount * tx.price : tx.value, marketCap)}</td>
      {/* SIZE - absorbs the old NATIVE column. The USD value (with the native
          amount as a muted sub) sits on the row ground and the size pill,
          scaled by usdBarWidth, runs to its RIGHT in the rest of the cell.
          Laying the value on the pill itself put a bright number on a coloured
          ground and cost readability for nothing; the text column is
          fixed-width so every row's bar starts on the same x and lengths stay
          comparable down the column. */}
      <td className="cell-size">
        <span className={`tx-size ${isBuy ? 'is-buy' : 'is-sell'}`}>
          <span className="tx-size-text">
            <span className={`usd-value ${isBuy ? 'usd-buy' : 'usd-sell'} usd-${usdTier}`}>{formatUsd(txUsd)}</span>
            {txNative > 0 && (
              <span className="tx-size-native">{formatNativeToken(txNative, nativeTokenSymbol)}</span>
            )}
          </span>
          <span className="tx-size-track" aria-hidden="true">
            {usdBarWidth > 0 && (
              <span className="tx-size-fill" style={{ width: `${usdBarWidth}%` }} />
            )}
          </span>
        </span>
      </td>
      <td
        className={`cell-maker${isMobile && tx.maker ? ' cell-maker--tappable' : ''}`}
        onClick={isMobile && tx.maker ? () => onMakerTap?.(tx.maker) : undefined}
      >
        <div className="cell-maker-inner">
          {/* Line 1 is IDENTITY (who traded), line 2 is BEHAVIOUR (position,
              count, PnL). Splitting them is what turns a seven-chip run-on row
              into something scannable; compact density folds both back onto a
              single line, so the dense tape is still one keystroke away. */}
          <span className="maker-line maker-line--id">
          {isSpectre && (
            <span className="spectre-trade-badge">
              <img src="/spectre-icon.png" alt="Spectre" />
              <span className="spectre-trade-tooltip">Traded via Spectre AI</span>
            </span>
          )}
          {/* The app the swap was placed through (Codex tradeSource: Phantom,
              Axiom, Fomo...) as a brand tile LEFT of the address. Absence means
              "no identifying signal", never "direct" - the slot stays empty
              so the address lands on the same x whether or not a row has one;
              the badge slot after the address is fixed-width for the same
              reason. */}
          <span className="maker-src-slot">
            {tx.source?.id && <TradeSourceIcon source={tx.source} />}
          </span>
          <span className="maker-address" title={tx.maker}>
            {tx.maker ? <>{tx.maker.slice(0, 4)}...<span className="maker-address-tail">{tx.maker.slice(-3)}</span></> : '-'}
          </span>
          <span className="maker-type-slot">
          {makerType && (
            <span
              className="maker-type-badge maker-rep"
              style={{ color: makerType.color }}
            >
              {makerType.label}
              {hovered && <span className="maker-tooltip">
                <span className="tooltip-title" style={{ color: makerType.color }}>{makerType.name}</span>
                <span className="tooltip-desc">{makerType.desc || ''}</span>
              </span>}
            </span>
          )}
          </span>
          </span>
          <span className="maker-line maker-line--stats">
          {tx.maker && (
            <span className="maker-position" title="Net position: buys vs sells">
              <DivergingBar
                left={makerStats?.buyTokens || (isBuy ? Math.max(1, tx.amount || 1) : 0)}
                right={makerStats?.sellTokens || (!isBuy ? Math.max(1, tx.amount || 1) : 0)}
                height={3}
              />
            </span>
          )}
          <span className={`maker-tx-count ${txCount > 10 ? 'high' : ''}`}>
            {txCount}
            {hovered && <span className="maker-tooltip tx-summary-tooltip">
              <span className="tooltip-title">
                {holdingTokens != null && holdingTokens > 0 ? (
                  <>{formatAmount(holdingTokens)} {sym}<span className="tx-title-usd">({formatUsd(holdingUsd)})</span></>
                ) : holdingTokens === 0 ? (
                  <>No {sym} held<span className="tx-title-usd">Fully exited</span></>
                ) : (
                  <>{txCount} {sym} trades<span className="tx-title-usd">Partial data</span></>
                )}
              </span>
              <span className="tx-summary-body">
                {/* Column headers */}
                <span className="tx-summary-header">
                  <span className="tx-col-label"></span>
                  <span className="tx-col-head">USD</span>
                  <span className="tx-col-head">{sym}</span>
                  <span className="tx-col-head">TXNS</span>
                </span>
                {/* Bought row */}
                <span className="tx-summary-grid-row">
                  <span className="tx-col-label">Bought</span>
                  <span className="tx-col-val">{hasHiddenBuys ? <span className="tx-partial-hint" title={`${apiBuyCount} total buys, only ${visibleBuyCount} loaded`}>~</span> : ''}{formatUsd(totalBoughtUsd)}</span>
                  <span className="tx-col-val">{hasHiddenBuys ? '~' : ''}{formatAmount(totalBoughtTokens)}</span>
                  <span className="tx-col-val">{buyCount}</span>
                </span>
                {/* Sold row */}
                <span className="tx-summary-grid-row">
                  <span className="tx-col-label">Sold</span>
                  <span className="tx-col-val">{hasHiddenSells ? '~' : ''}{formatUsd(totalSoldUsd)}</span>
                  <span className="tx-col-val">{hasHiddenSells ? '~' : ''}{formatAmount(totalSoldTokens)}</span>
                  <span className="tx-col-val">{sellCount}</span>
                </span>
                {/* PnL */}
                {realizedPnl != null && (
                  <span className="tx-summary-grid-row tx-summary-pnl">
                    <span className="tx-col-label">PnL</span>
                    <span className={`tx-col-val tx-col-span ${realizedPnl >= 0 ? 'bull' : 'bear'}`}>
                      {realizedPnl >= 0 ? '+' : ''}{formatUsd(Math.abs(realizedPnl))}
                    </span>
                  </span>
                )}
                {/* Holding / Unrealized */}
                {holdingTokens != null && holdingTokens > 0 && (
                  <span className="tx-summary-grid-row">
                    <span className="tx-col-label">Holding</span>
                    <span className="tx-col-val tx-col-span">
                      {formatAmount(holdingTokens)} {sym}<span className="tx-summary-sub"> ({formatUsd(holdingUsd)})</span>
                    </span>
                  </span>
                )}
                {/* Partial data notice */}
                {partial && (
                  <span className="tx-summary-grid-row tx-summary-time">
                    <span className="tx-col-val tx-col-span tx-partial-notice">
                      Only showing {visibleBuyCount + visibleSellCount} of {buyCount + sellCount} trades loaded
                    </span>
                  </span>
                )}
                {/* Timespan */}
                {firstTx?.timestamp && (
                  <span className="tx-summary-grid-row tx-summary-time">
                    <span className="tx-col-label">Active</span>
                    <span className="tx-col-val tx-col-span tx-summary-date">
                      {formatAge(firstTx.timestamp)}{lastTx && lastTx !== firstTx ? ` - ${formatAge(lastTx.timestamp)}` : ''}
                    </span>
                  </span>
                )}
              </span>
            </span>}
          </span>
          {tx.makerPnlUsd != null && tx.makerPnlUsd !== 0 && (
            <span
              className={`maker-pnl ${tx.makerPnlUsd > 0 ? 'profit' : 'loss'}`}
              title={`PnL: $${tx.makerPnlUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            >
              {tx.makerPnlUsd > 0 ? '+' : ''}{Math.abs(tx.makerPnlUsd) >= 1000 ? `$${(tx.makerPnlUsd / 1000).toFixed(1)}K` : `$${tx.makerPnlUsd.toFixed(0)}`}
            </span>
          )}
          </span>
          <span className="maker-actions">
            <button
              className="maker-action-btn copy-btn"
              title="Copy address"
              onClick={() => {
                navigator.clipboard.writeText(tx.maker)
                triggerCopyToast()
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <a
              href={getExplorerUrl(tx.maker, tokenNetworkId, 'address')}
              target="_blank"
              rel="noopener noreferrer"
              className="maker-action-btn chart-btn"
              title="View on explorer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="6"/>
                <path d="M21 21l-4.35-4.35"/>
              </svg>
            </a>
            <button
              className={`maker-action-btn filter-btn-icon ${makerFilter === tx.maker ? 'active' : ''}`}
              title={makerFilter === tx.maker ? "Clear filter" : "Filter by this maker"}
              onClick={() => makerFilter === tx.maker ? clearMakerFilter() : filterByMaker(tx.maker)}
            >
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
              </svg>
            </button>
          </span>
        </div>
      </td>
    </tr>
  )
}, (prev, next) => {
  return prev.tx === next.tx
    && prev.index === next.index
    && prev.showDateMode === next.showDateMode
    && prev.showPriceMode === next.showPriceMode
    && prev.showAmountMode === next.showAmountMode
    && prev.makerFilter === next.makerFilter
    && prev.makerStats === next.makerStats
    && prev.isMobile === next.isMobile
})

const DataTabs = ({ token, isExpanded = false, setIsExpanded, registerRefresh }) => {
  // View preferences persist across refresh (store-backed, 'spectre-settings').
  // Wrapper setters keep every existing call site + functional-updater form
  // working while the store stays the single source of truth.
  const dataTabsPrefs = useSettingsStore((s) => s.dataTabsPrefs)
  const setDataTabsPrefs = useSettingsStore((s) => s.setDataTabsPrefs)
  const activeTab = dataTabsPrefs.tab
  const showDateMode = dataTabsPrefs.dateMode       // false = Age (default), true = Date
  const showAmountMode = dataTabsPrefs.amountMode   // true = Amount, false = Percentage
  const showPriceMode = dataTabsPrefs.priceMode     // true = Price, false = MCap
  const _pref = (key, cur) => (v) => setDataTabsPrefs({ [key]: typeof v === 'function' ? v(cur) : v })
  const setActiveTabRaw = _pref('tab', activeTab)
  // Tab switches land in PostHog as UI Interaction so the analytics dashboard
  // can show which DataTabs sections (transactions/holders/...) users open.
  const setActiveTab = (v) => {
    try { trackUi('data_tab', typeof v === 'function' ? v(activeTab) : v) } catch { /* noop */ }
    setActiveTabRaw(v)
  }
  const setShowDateMode = _pref('dateMode', showDateMode)
  const setShowAmountMode = _pref('amountMode', showAmountMode)
  const setShowPriceMode = _pref('priceMode', showPriceMode)
  const [showUsdMode, setShowUsdMode] = useState(true) // true = USD, false = ETH

  // Scroll position is captured on tab change so it can be restored
  // if React's render shifts the page (legacy guard).
  const scrollPositionRef = useRef(0)
  const scrollProtectionRef = useRef({ active: false, rafId: null })


  const typeFilter = dataTabsPrefs.typeFilter // null = All, 'buy', 'sell', 'add', 'remove'
  const setTypeFilter = _pref('typeFilter', typeFilter)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const [comingSoonTooltip, setComingSoonTooltip] = useState({ visible: false, text: '', x: 0, y: 0, position: 'top' })
  // Flow-bar info "i" tooltip (fixed portal so the bar's overflow can't clip it).
  const [infoTip, setInfoTip] = useState({ visible: false, text: '', x: 0, y: 0 })
  // Accumulating-wallets list popover (each row filters the table by that maker).
  const [accumOpen, setAccumOpen] = useState(false)
  const [accumPos, setAccumPos] = useState({ x: 0, y: 0 })
  // Collapse/expand the Flow Intelligence strip (Pressure/Net Flow/Whales/
  // Accumulating/Velocity). Persisted so the choice sticks across reloads.
  const [flowOpen, setFlowOpen] = useState(() => {
    try { return localStorage.getItem('spectre-tx-flow-open') !== '0' } catch { return true }
  })
  const toggleFlow = useCallback(() => {
    setFlowOpen((o) => {
      const next = !o
      try { localStorage.setItem('spectre-tx-flow-open', next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }, [])
  const [showAmountMenu, setShowAmountMenu] = useState(false)
  const [amountFilter, setAmountFilter] = useState({ min: '', max: '' }) // Applied filter
  const [pendingAmountFilter, setPendingAmountFilter] = useState({ min: '', max: '' }) // Input values
  const [showPriceMenu, setShowPriceMenu] = useState(false)
  const [priceFilter, setPriceFilter] = useState({ min: '', max: '', minUnit: 1000000, maxUnit: 1000000 }) // Applied filter with units (default M)
  const [pendingPriceFilter, setPendingPriceFilter] = useState({ min: '', max: '', minUnit: 1000000, maxUnit: 1000000 }) // Input values
  const [showValueMenu, setShowValueMenu] = useState(false)
  const [valueFilter, setValueFilter] = useState({ min: '', max: '' }) // USD filter
  const [pendingValueFilter, setPendingValueFilter] = useState({ min: '', max: '' }) // USD input values
  const [ethFilter, setEthFilter] = useState({ min: '', max: '' }) // ETH filter
  const [pendingEthFilter, setPendingEthFilter] = useState({ min: '', max: '' }) // ETH input values
  const [showEthMenu, setShowEthMenu] = useState(false)
  const [showMakerMenu, setShowMakerMenu] = useState(false)
  const [makerFilter, setMakerFilter] = useState('') // Applied filter (maker address)
  const [pendingMakerFilter, setPendingMakerFilter] = useState('') // Input value
  // Mobile: the per-column header funnels are hidden; filtering moves into a
  // bottom sheet opened from the toolbar.
  const isMobile = useIsMobile()
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  // Which filter section the sheet should scroll to / highlight when opened
  // from a per-column header funnel (null = open at top).
  const [filterFocus, setFilterFocus] = useState(null)
  const openFilterSheet = useCallback((section = null) => {
    setFilterFocus(section)
    setShowFilterSheet(true)
  }, [])
  // Mobile: tapping a maker address opens a small action sheet (copy /
  // explorer / filter) since the desktop hover pill can't be used on touch.
  const [makerSheetAddr, setMakerSheetAddr] = useState(null)
  const handleMakerTap = useCallback((addr) => setMakerSheetAddr(addr || null), [])
  const typeMenuRef = useRef(null)
  const amountMenuRef = useRef(null)
  const priceMenuRef = useRef(null)
  const valueMenuRef = useRef(null)
  const ethMenuRef = useRef(null)
  const makerMenuRef = useRef(null)
  const { triggerCopyToast } = useCopyToast()

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (typeMenuRef.current && !typeMenuRef.current.contains(e.target)) {
        setShowTypeMenu(false)
      }
      if (amountMenuRef.current && !amountMenuRef.current.contains(e.target)) {
        setShowAmountMenu(false)
      }
      if (priceMenuRef.current && !priceMenuRef.current.contains(e.target)) {
        setShowPriceMenu(false)
      }
      if (valueMenuRef.current && !valueMenuRef.current.contains(e.target)) {
        setShowValueMenu(false)
      }
      if (ethMenuRef.current && !ethMenuRef.current.contains(e.target)) {
        setShowEthMenu(false)
      }
      if (makerMenuRef.current && !makerMenuRef.current.contains(e.target)) {
        setShowMakerMenu(false)
      }
    }
    if (showTypeMenu || showAmountMenu || showPriceMenu || showValueMenu || showEthMenu || showMakerMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTypeMenu, showAmountMenu, showPriceMenu, showValueMenu, showEthMenu, showMakerMenu])
  
  // Major-coin detection: a CoinGecko-sourced major (BTC/ETH/XRP/...) gets a
  // Markets/Key-Stats/Performance panel instead of the on-chain tabs. Resolved
  // from the token alone (its cgId / the wrapped-contract reverse map / an
  // off-chain slug), so it's known before liveTokenData loads - which lets us
  // skip the on-chain trades/holders fetches entirely for a major.
  const majorCgId = resolveMajorCgId(token || {})
  const isMajor = !!majorCgId

  // Fetch real trades for the current token.
  // Cost gate: only fetch/poll Codex trades when a tab that CONSUMES them is
  // active. That used to mean Transactions alone - "every consumer renders
  // inside the activeTab==='transactions' block" - but the rebuilt Holders tab
  // added a consumer: its PnL and Remaining columns are derived from
  // makerStatsMap, which is built from these trades. Leaving Holders out of the
  // gate did not save anything, it just made both columns permanently "-".
  // Analytics still needs no trades.
  const tradesAddr = (!isMajor && (activeTab === 'transactions' || activeTab === 'holders'))
    ? token?.address
    : null

  // Fetch detailed token data for circulatingSupply and marketCap
  const { tokenData: liveTokenData } = useSharedTokenDetails()
  const circulatingSupply = liveTokenData?.circulatingSupply ? parseFloat(liveTokenData.circulatingSupply) : 0

  const networkId = token?.networkId || 1

  // Polled trades from REST API have accurate amounts (amountToken * priceUSD)
  // Real-time trades via Codex onEventsCreated WebSocket (uses pair address)
  // The live WebSocket stays gated to Transactions ONLY - deliberately narrower
  // than the REST gate above. Holders needs a cost-basis SNAPSHOT, not a live
  // feed, so it pays for one trades fetch and no subscription.
  // (useCodexTradesStream skips on a null pair address.)
  //
  // Only the dev details route carries topPairAddress; the prod serverless
  // twin returns null from every tier (KV snapshot / Hetzner / the trimmed
  // Codex query select no pair), so on trade.spectreai.io this stream never
  // opened and the tape was the 30s poll behind a 30s edge cache - "stuck".
  // pair-info is the same module-cached call TokenDetailsContext already makes
  // to register the price feed, so resolving the pair from it costs nothing
  // and keeps the tape on the exact pair the price ticks come from.
  const [pairInfoAddress, setPairInfoAddress] = useState(null)
  useEffect(() => {
    setPairInfoAddress(null)
    if (isMajor || !token?.address || liveTokenData?.topPairAddress) return undefined
    let cancelled = false
    getPairInfo(token.address, token?.networkId || 1)
      .then((info) => { if (!cancelled && info?.pairAddress) setPairInfoAddress(info.pairAddress) })
      .catch(() => { /* no pair - the REST poll carries the tape */ })
    return () => { cancelled = true }
  }, [token?.address, token?.networkId, isMajor, liveTokenData?.topPairAddress])
  const topPairAddress = liveTokenData?.topPairAddress || pairInfoAddress || null
  const streamPairAddress = (!isMajor && activeTab === 'transactions') ? topPairAddress : null
  const { trades: streamTrades, isLive: streamLive } = useCodexTradesStream(streamPairAddress, token?.networkId || 1)

  // The REST poll is delivery only while the stream is down; live, it backs
  // off to reconciliation cadence (see TRADES_POLL_LIVE_MS).
  const { trades, loading, loadingMore, error, hasMore, refresh, loadMore } = useLatestTrades(
    tradesAddr,
    token?.networkId || 1,
    50, // Initial limit - GMGN loads ~47, loadMore() handles pagination
    { streamLive }
  )

  // Mobile pull-to-refresh hands the trades refetch up to the page shell.
  // No-op on desktop (prop undefined).
  useEffect(() => { registerRefresh?.(refresh) }, [registerRefresh, refresh])

  // YOUR own Spectre swaps for this token, re-read when a new one is recorded
  // (the swap hook fires `spectre-swap-recorded`). Injected below so a trade you
  // just made shows at the top of the table instantly - before Codex indexes it
  // and regardless of the aggregator's maker attribution.
  const [ownTick, setOwnTick] = useState(0)
  useEffect(() => {
    const bump = () => setOwnTick((t) => t + 1)
    window.addEventListener('spectre-swap-recorded', bump)
    return () => window.removeEventListener('spectre-swap-recorded', bump)
  }, [])
  const ownRows = useMemo(
    () => readSpectreSwapRows(token?.address, token?.networkId || 1),
    [token?.address, token?.networkId, ownTick],
  )

  // Merge: prepend WS trades (with priceUsdTotal for accurate amounts), dedup by txHash
  const mergedTrades = useMemo(() => {
    let base = trades

    if (streamTrades.length) {
      // Build set of known polled txHashes
      const polledKeys = new Set()
      for (const t of trades) {
        const key = t.txHash || t.transactionHash
        if (key) polledKeys.add(key)
      }

      // Only include stream trades that are NOT already in polled data (truly new)
      const livePrice = liveTokenData?.price || 0
      const newStreamTrades = []
      for (const t of streamTrades) {
        if (t.txHash && polledKeys.has(t.txHash)) continue // polled version has accurate amounts
        const usd = t.amountUSD || 0
        if (!(usd > 0.01)) continue // skip sub-cent WS legs (empty multi-hop / dust) - they render as "$0.00 - -" noise
        const tokenAmount = livePrice > 0 ? usd / livePrice : 0
        const ts = t.timestamp ? new Date(t.timestamp * 1000) : new Date()
        newStreamTrades.push({
          type: t.type,
          timestamp: ts,
          txHash: t.txHash,
          price: livePrice,
          amount: tokenAmount,
          value: usd,
          maker: t.maker,
          source: t.source || null,
          _source: 'stream',
        })
      }
      // Prepend new stream trades before polled trades (newest first)
      if (newStreamTrades.length) base = [...newStreamTrades, ...trades]
    }

    // Prepend YOUR own swaps not yet present in the live feed (dedup by hash - the
    // moment Codex/WS returns the same tx, the local copy drops and the indexed
    // row shows, still badged as yours via isSpectreSwap).
    if (ownRows.length) {
      const known = new Set()
      for (const t of base) {
        const k = t.txHash || t.transactionHash
        if (k) known.add(String(k).toLowerCase())
      }
      const freshOwn = ownRows.filter((r) => r.txHash && !known.has(r.txHash.toLowerCase()))
      if (freshOwn.length) base = [...freshOwn, ...base]
    }

    return base
  }, [trades, streamTrades, liveTokenData?.price, ownRows])

  // Holders - real data from the Spectre onchain API (EVM only). Solana and
  // unsupported chains return empty, so the list + count chart render a clean
  // "unavailable on this chain" state instead of fabricated rows. (Previously
  // these were hardcoded empty AND `hasOnchainHolders` below was an undefined
  // reference - the Holders tab threw on open = the "no holders info" report.)
  const [holderChartBucket, setHolderChartBucket] = useState('1h')
  // Defer the onchain fetches until the Holders tab is actually open - most
  // token views never open it, so gating keeps the token-page load lean and
  // avoids unnecessary onchain API calls (Phase 5 "defer below-fold"). Passing
  // a null address makes both hooks short-circuit to empty.
  const holdersAddr = (!isMajor && activeTab === 'holders') ? token?.address : null
  const { holders: realHolders, loading: holdersLoading } = useTopHolders(holdersAddr, token?.networkId, 50)
  const { data: holderChartData, loading: holderChartLoading } = useHoldersChart(
    holdersAddr, token?.networkId, { bucket: holderChartBucket, limit: 30 }
  )
  const hasOnchainHolders = isHoldersChartSupported(token?.networkId) &&
    (holderChartData.length > 0 || realHolders.length > 0)
  const marketCap = liveTokenData?.marketCap ? parseFloat(liveTokenData.marketCap) : 0
  // 24h volume drives the dynamic whale threshold (so it scales with token size).
  const volume24h = parseFloat(liveTokenData?.volume ?? liveTokenData?.volume24 ?? 0) || 0
  
  // Get native token symbol for current network
  const nativeTokenSymbol = getNativeTokenSymbol(token?.networkId || 1)
  const isSolana = (token?.networkId || 1) === 1399811149
  
  // Native token price for ETH column - from the SHARED native-prices store
  // (one 30s /api/tokens/prices poll for the whole token page). Replaces a
  // dedicated Codex getDetailedTokenInfo(WETH/WSOL) 60s poller that paid a
  // full details round-trip just to read one price.
  const [nativePrice, setNativePrice] = useState(isSolana ? 200 : 3500)

  useEffect(() => {
    return subscribeNativePrices((raw) => {
      const price = parseFloat(isSolana ? raw?.SOL : raw?.ETH) || 0
      // Same sanity floor as the old Codex path - never adopt a junk quote.
      if (price > (isSolana ? 1 : 100)) setNativePrice(price)
    })
  }, [isSolana])
  
  const tableWrapperRef = useRef(null)

  const dataTabsRef = useRef(null)
  const expandAccumulator = useRef(0)
  const collapseAccumulator = useRef(0)
  const lastScrollTime = useRef(0)

  // Iteration 7 — Zustand density binding. Reads the persisted preference;
  // CSS reacts via the `data-density` attribute on the section root.
  const transactionsDensity = useSettingsStore((s) => s.transactionsDensity)
  const setTransactionsDensity = useSettingsStore((s) => s.setTransactionsDensity)

  // Iteration 7 — sliding underglow indicator for the tab strip.
  // We mirror SegmentedControl's measuring pattern (refs per tab id +
  // ResizeObserver on the strip) but render a thin underglow bar instead
  // of a behind-pill fill, because the i7 brief calls for a punctured
  // hairline under the active tab — not a full segmented-pill control.
  const tabsStripRef = useRef(null)
  const tabButtonsRef = useRef({})
  const [tabIndicator, setTabIndicator] = useState({ x: 0, w: 0, ready: false })
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)

  // Density toggle now lives directly in the action cluster as a visible
  // segmented switch (Gleb wanted it surfaced, not buried in a popover),
  // so no popover state is needed anymore.

  // Measure the active tab and reposition the underglow indicator.
  useLayoutEffect(() => {
    const strip = tabsStripRef.current
    if (!strip) return
    const measure = () => {
      const btn = tabButtonsRef.current[activeTab]
      if (!btn) return
      const stripRect = strip.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      // X is relative to the strip's scroll container so the indicator
      // tracks the button even when the tab strip overflows.
      const x = (btnRect.left - stripRect.left) + strip.scrollLeft
      setTabIndicator({ x, w: btnRect.width, ready: true })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(strip)
    Object.values(tabButtonsRef.current).forEach((b) => b && ro.observe(b))
    // Re-measure on font load + window resize for safety.
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [activeTab])

  // (The aggregated `anyColumnFilterActive` flag was used by the now-
  // removed Filter cluster button + overflow popover. Per-column glyphs
  // already show their own active states, so the aggregate is dead.)
  
  // Scroll down → expand, Scroll up at top → collapse
  useEffect(() => {
    const wrapper = tableWrapperRef.current
    if (!wrapper || !setIsExpanded) return

    // Auto-expand/collapse removed - page scrolls naturally now (GMGN-style)
  }, [isExpanded, setIsExpanded])

  // Infinite scroll - load more when near bottom
  useEffect(() => {
    const wrapper = tableWrapperRef.current
    if (!wrapper) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = wrapper
      
      // Load more when 100px from bottom
      if (scrollHeight - scrollTop - clientHeight < 100 && hasMore && !loadingMore && !loading) {
        loadMore()
      }
    }

    wrapper.addEventListener('scroll', handleScroll)
    return () => wrapper.removeEventListener('scroll', handleScroll)
  }, [hasMore, loadingMore, loading, loadMore])

  // Filter trades by type, amount, and price/mcap
  const filteredTrades = useMemo(() => {
    let result = mergedTrades
    
    // Filter by type — 'swap' / 'liquidity' are grouped values (DexScreener's
    // "Buy / Sell" and "Add / Remove" menu entries).
    if (typeFilter) {
      const group = TYPE_FILTER_GROUPS[typeFilter]
      result = group
        ? result.filter(t => group.includes(t.type?.toLowerCase()))
        : result.filter(t => t.type?.toLowerCase() === typeFilter)
    }
    
    // Filter by amount - USD when Amount mode, % of market cap when Percentage mode
    const minAmountVal = parseFloat(amountFilter.min)
    const maxAmountVal = parseFloat(amountFilter.max)
    
    if (!isNaN(minAmountVal) && minAmountVal > 0) {
      if (showAmountMode) {
        // Amount mode - filter by USD value
        result = result.filter(t => t.value >= minAmountVal)
      } else {
        // Percentage mode - filter by % of market cap (USD value / marketCap)
        result = result.filter(t => {
          if (!marketCap || marketCap <= 0) return true
          const pct = (t.value / marketCap) * 100
          return pct >= minAmountVal
        })
      }
    }
    if (!isNaN(maxAmountVal) && maxAmountVal > 0) {
      if (showAmountMode) {
        // Amount mode - filter by USD value
        result = result.filter(t => t.value <= maxAmountVal)
      } else {
        // Percentage mode - filter by % of market cap
        result = result.filter(t => {
          if (!marketCap || marketCap <= 0) return false
          const pct = (t.value / marketCap) * 100
          return pct <= maxAmountVal
        })
      }
    }
    
    // Filter by price or mcap depending on mode. minUnit/maxUnit (default 1e6)
    // is the MCap unit selector ("5" × "M") — it must NOT apply in Price mode,
    // where the input is a raw USD price. Applying it there turned "min $0.30"
    // into "min $300,000" and emptied the tape (the filter looked broken).
    const priceMinMul = showPriceMode ? 1 : (priceFilter.minUnit || 1)
    const priceMaxMul = showPriceMode ? 1 : (priceFilter.maxUnit || 1)
    const minPriceVal = parseFloat(priceFilter.min) * priceMinMul
    const maxPriceVal = parseFloat(priceFilter.max) * priceMaxMul
    if (!isNaN(minPriceVal) && minPriceVal > 0) {
      if (showPriceMode) {
        // Filter by price
        result = result.filter(t => t.price >= minPriceVal)
      } else {
        // Filter by mcap (price * circulatingSupply)
        result = result.filter(t => (t.price * circulatingSupply) >= minPriceVal)
      }
    }
    if (!isNaN(maxPriceVal) && maxPriceVal > 0) {
      if (showPriceMode) {
        result = result.filter(t => t.price <= maxPriceVal)
      } else {
        result = result.filter(t => (t.price * circulatingSupply) <= maxPriceVal)
      }
    }
    
    // Filter by native token value (ETH, SOL, etc.)
    const minNativeVal = parseFloat(ethFilter.min)
    const maxNativeVal = parseFloat(ethFilter.max)
    if (!isNaN(minNativeVal) && minNativeVal > 0) {
      result = result.filter(t => {
        const usd = (t.amount && t.price) ? t.amount * t.price : t.value
        return (usd / nativePrice) >= minNativeVal
      })
    }
    if (!isNaN(maxNativeVal) && maxNativeVal > 0) {
      result = result.filter(t => {
        const usd = (t.amount && t.price) ? t.amount * t.price : t.value
        return (usd / nativePrice) <= maxNativeVal
      })
    }

    // Filter by USD value
    const minUsdVal = parseFloat(valueFilter.min)
    const maxUsdVal = parseFloat(valueFilter.max)
    if (!isNaN(minUsdVal) && minUsdVal > 0) {
      result = result.filter(t => {
        const usd = (t.amount && t.price) ? t.amount * t.price : t.value
        return usd >= minUsdVal
      })
    }
    if (!isNaN(maxUsdVal) && maxUsdVal > 0) {
      result = result.filter(t => {
        const usd = (t.amount && t.price) ? t.amount * t.price : t.value
        return usd <= maxUsdVal
      })
    }
    
    // Filter by maker address
    if (makerFilter) {
      result = result.filter(t => t.maker?.toLowerCase() === makerFilter.toLowerCase())
    }
    
    return result
  }, [mergedTrades, typeFilter, amountFilter, showAmountMode, priceFilter, showPriceMode, circulatingSupply, marketCap, ethFilter, valueFilter, nativePrice, makerFilter])

  /* Age labels tick INSIDE the rows (useAgeLabel): both the desktop TradeRow
     and the mobile one are memoised on the trade, so the component-level
     1s re-render that used to live here never reached them - the column only
     moved when a new trade or a price tick happened to rebuild the rows, and
     froze on a quiet tape. Nothing else in this render needs a clock. */

  // Local record of the user's Spectre-executed swaps (by tx hash) so rows in
  // this feed that WE traded via Spectre get a Spectre badge. Re-read when the
  // trades change (a just-executed swap appears in the feed).
  const spectreMarks = useMemo(() => readSpectreSwapMarks(), [filteredTrades])


  // Check if amount filter is active
  const isAmountFilterActive = amountFilter.min !== '' || amountFilter.max !== ''

  // Apply amount filter
  const applyAmountFilter = () => {
    setAmountFilter(pendingAmountFilter)
    setShowAmountMenu(false)
  }

  // Sync pending filter with applied filter when menu opens
  const openAmountMenu = () => {
    setPendingAmountFilter(amountFilter)
    setShowAmountMenu(true)
  }

  // Clear amount filter
  const clearAmountFilter = () => {
    setPendingAmountFilter({ min: '', max: '' })
    setAmountFilter({ min: '', max: '' })
  }

  // Check if price filter is active
  const isPriceFilterActive = priceFilter.min !== '' || priceFilter.max !== ''

  // Apply price filter
  const applyPriceFilter = () => {
    setPriceFilter(pendingPriceFilter)
    setShowPriceMenu(false)
  }

  // Sync pending filter with applied filter when menu opens
  const openPriceMenu = () => {
    setPendingPriceFilter(priceFilter)
    setShowPriceMenu(true)
  }

  // Clear price filter
  const clearPriceFilter = () => {
    setPendingPriceFilter({ min: '', max: '', minUnit: 1000000, maxUnit: 1000000 })
    setPriceFilter({ min: '', max: '', minUnit: 1000000, maxUnit: 1000000 })
  }

  // Check if value filter is active
  const isValueFilterActive = valueFilter.min !== '' || valueFilter.max !== ''

  // Apply value filter
  const applyValueFilter = () => {
    setValueFilter(pendingValueFilter)
    setShowValueMenu(false)
  }

  // Sync pending filter with applied filter when menu opens
  const openValueMenu = () => {
    setPendingValueFilter(valueFilter)
    setShowValueMenu(true)
  }

  // Clear value filter
  const clearValueFilter = () => {
    setPendingValueFilter({ min: '', max: '' })
    setValueFilter({ min: '', max: '' })
  }

  // Check if ETH filter is active
  const isEthFilterActive = ethFilter.min !== '' || ethFilter.max !== ''

  // Apply ETH filter
  const applyEthFilter = () => {
    setEthFilter(pendingEthFilter)
    setShowEthMenu(false)
  }

  // Sync pending ETH filter with applied filter when menu opens
  const openEthMenu = () => {
    setPendingEthFilter(ethFilter)
    setShowEthMenu(true)
  }

  // Clear ETH filter
  const clearEthFilter = () => {
    setPendingEthFilter({ min: '', max: '' })
    setEthFilter({ min: '', max: '' })
  }

  // Check if maker filter is active
  const isMakerFilterActive = makerFilter !== ''

  // Count of active filter dimensions — drives the mobile Filters button badge.
  const activeFiltersCount =
    (typeFilter ? 1 : 0) +
    (isPriceFilterActive ? 1 : 0) +
    (isAmountFilterActive ? 1 : 0) +
    (isEthFilterActive ? 1 : 0) +
    (isValueFilterActive ? 1 : 0) +
    (isMakerFilterActive ? 1 : 0)

  // Apply maker filter
  const applyMakerFilter = () => {
    setMakerFilter(pendingMakerFilter)
    setShowMakerMenu(false)
  }

  // Sync pending filter with applied filter when menu opens
  const openMakerMenu = () => {
    setPendingMakerFilter(makerFilter)
    setShowMakerMenu(true)
  }

  // Clear maker filter (useCallback for stable ref in TradeRow)
  const clearMakerFilter = useCallback(() => {
    setPendingMakerFilter('')
    setMakerFilter('')
  }, [])

  // Reset every filter dimension at once - the in-table empty state offers this
  // so a zero-result filter can always be undone from the table itself
  const clearAllFilters = () => {
    setTypeFilter(null)
    clearAmountFilter()
    clearPriceFilter()
    clearValueFilter()
    clearEthFilter()
    clearMakerFilter()
  }

  // Filter by specific maker (from row click) (useCallback for stable ref in TradeRow)
  const filterByMaker = useCallback((address) => {
    setMakerFilter(address)
    setPendingMakerFilter(address)
  }, [])

  // Toggle the maker filter from a mobile row funnel. MUST be a stable ref -
  // an inline arrow here busted MobileTransactions' row memo on every render,
  // which is what made the filter sheet feel slow to open and close.
  const toggleMakerFilter = useCallback((m) => {
    if (makerFilter === m) clearMakerFilter()
    else filterByMaker(m)
  }, [makerFilter, clearMakerFilter, filterByMaker])

  // Pre-compute maker stats map - O(n) instead of O(n^2) per-row filtering
  const makerStatsMap = useMemo(() => {
    const map = new Map()
    for (const t of mergedTrades) {
      if (!t.maker) continue
      let entry = map.get(t.maker)
      if (!entry) {
        entry = { count: 0, buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, buyTokens: 0, sellTokens: 0, trades: [] }
        map.set(t.maker, entry)
      }
      entry.count++
      entry.trades.push(t)
      const type = (t.type || '').toLowerCase()
      if (type === 'buy' || type.includes('buy')) {
        entry.buys++
        entry.buyUsd += (t.value || 0)
        entry.buyTokens += (t.amount || 0)
      } else {
        entry.sells++
        entry.sellUsd += (t.value || 0)
        entry.sellTokens += (t.amount || 0)
      }
    }
    return map
  }, [mergedTrades])

  // Top Traders tab — ranked traders derived from the same per-maker aggregation.
  // Ranks by traded volume (bought + sold USD) over the loaded tape window; net
  // = bought − sold. NOT all-time (the tape is the recent trades) — the panel
  // note says so. No new fetch; recomputes only when makerStatsMap changes.
  const topTraders = useMemo(() => {
    const arr = []
    for (const [maker, e] of makerStatsMap) {
      let last = 0
      for (const t of e.trades) {
        const ts = t.timestamp instanceof Date ? t.timestamp.getTime() : new Date(t.timestamp).getTime()
        if (ts > last) last = ts
      }
      arr.push({
        maker,
        txns: e.count,
        bought: e.buyUsd,
        sold: e.sellUsd,
        volume: e.buyUsd + e.sellUsd,
        net: e.buyUsd - e.sellUsd,
        last,
      })
    }
    arr.sort((a, b) => b.volume - a.volume)
    return arr.slice(0, 50)
  }, [makerStatsMap])

  // Per-maker classification for the tape's TRADER icon system: size tier (by
  // traded USD volume), net buy/sell lean, and volume share vs the busiest
  // maker in the loaded window (drives the little bar under the address).
  const makerProfiles = useMemo(() => {
    const m = new Map()
    const tsOf = (t) => (t.timestamp instanceof Date ? t.timestamp.getTime() : new Date(t.timestamp).getTime())
    let maxVol = 0
    let oldest = Infinity
    let newest = 0
    for (const [, e] of makerStatsMap) {
      const v = (e.buyUsd || 0) + (e.sellUsd || 0)
      if (v > maxVol) maxVol = v
      for (const t of e.trades) {
        const x = tsOf(t)
        if (x < oldest) oldest = x
        if (x > newest) newest = x
      }
    }
    const span = newest - oldest
    for (const [maker, e] of makerStatsMap) {
      const volume = (e.buyUsd || 0) + (e.sellUsd || 0)
      const net = (e.buyUsd || 0) - (e.sellUsd || 0)
      let firstTs = Infinity
      for (const t of e.trades) {
        const x = tsOf(t)
        if (x < firstTs) firstTs = x
      }
      m.set(maker, {
        tier: tierFromVolume(volume),
        lean: net > 0 ? 'buy' : net < 0 ? 'sell' : 'flat',
        share: maxVol > 0 ? volume / maxVol : 0,
        volume,
        buyUsd: e.buyUsd || 0,
        sellUsd: e.sellUsd || 0,
        buys: e.buys || 0,
        sells: e.sells || 0,
        buyTokens: e.buyTokens || 0,
        sellTokens: e.sellTokens || 0,
        firstTs: Number.isFinite(firstTs) ? firstTs : null,
        // Sample-based "newly active": first appears in the newer half of a
        // loaded tape spanning at least 2h (the tape is the recent window, so
        // this is honest-per-sample, not all-time history).
        newlyActive: span >= 2 * 3600_000 && Number.isFinite(firstTs) && firstTs - oldest >= span / 2,
      })
    }
    return m
  }, [makerStatsMap])

  // The trade tape is rendered UNCAPPED (every merged + "load more" row), so
  // rebuilding this array is the single most expensive thing in a DataTabs
  // render. Any unrelated state change here - opening/closing the maker sheet,
  // a filter menu, a tab - used to re-run the map and hand React N brand-new
  // elements to diff, which on a phone with a long tape read as a ~1s lag
  // before the sheet dismissed. Memoised, an unrelated render passes React the
  // SAME element references and it skips the whole <tbody> subtree outright.
  // Mobile renders <MobileTransactions>, not this table - building the desktop
  // row elements there was pure waste on every trades tick.
  const tradeRows = useMemo(() => (isMobile ? [] : filteredTrades.map((tx, i) => (
    <TradeRow
      key={`${tx.txHash}-${i}`}
      tx={tx}
      index={i}
      nativePrice={nativePrice}
      nativeTokenSymbol={nativeTokenSymbol}
      showDateMode={showDateMode}
      showPriceMode={showPriceMode}
      showAmountMode={showAmountMode}
      circulatingSupply={circulatingSupply}
      marketCap={marketCap}
      makerStats={makerStatsMap.get(tx.maker)}
      makerFilter={makerFilter}
      clearMakerFilter={clearMakerFilter}
      filterByMaker={filterByMaker}
      triggerCopyToast={triggerCopyToast}
      tokenNetworkId={token?.networkId || 1}
      tokenPrice={token?.price}
      tokenSymbol={token?.symbol}
      isMobile={isMobile}
      onMakerTap={handleMakerTap}
      isSpectre={isSpectreSwap(spectreMarks, tx.txHash)}
    />
  ))), [
    filteredTrades, nativePrice, nativeTokenSymbol, showDateMode, showPriceMode,
    showAmountMode, circulatingSupply, marketCap, makerStatsMap, makerFilter,
    clearMakerFilter, filterByMaker, triggerCopyToast, token?.networkId,
    token?.price, token?.symbol, isMobile, handleMakerTap, spectreMarks,
  ])

  // Top Makers window — scopes the quick-pick list (and its counts) to a
  // wall-clock window over the loaded trade tape: '1h' = last hour, '24h' = last
  // day. Same timestamp + buy/sell parsing as flowStats. NOTE: the tape is the
  // most-recent ~N polled trades + live SSE, so '24h' is bounded by how far back
  // the loaded tape actually reaches (a hot token may hold < 24h of trades; a
  // sparse one may have no trades in the last hour -> empty list, the address
  // input still works for a manual filter).
  const [makerWindow, setMakerWindow] = useState('24h') // '1h' | '24h'
  const uniqueMakers = useMemo(() => {
    const nowMs = Date.now()
    const cutoff = makerWindow === '1h' ? nowMs - 60 * 60_000 : nowMs - 24 * 60 * 60_000
    const counts = new Map() // maker -> { count, buys, sells }
    for (const t of mergedTrades) {
      if (!t.maker) continue
      const ts = t.timestamp instanceof Date ? t.timestamp.getTime() : new Date(t.timestamp).getTime()
      if (!(ts >= cutoff)) continue
      let e = counts.get(t.maker)
      if (!e) { e = { count: 0, buys: 0, sells: 0 }; counts.set(t.maker, e) }
      e.count++
      if ((t.type || '').toLowerCase().includes('buy')) e.buys++
      else e.sells++
    }
    return Array.from(counts.entries())
      .map(([maker, e]) => [maker, {
        count: e.count,
        lean: e.buys > e.sells ? 'buy' : e.sells > e.buys ? 'sell' : 'flat',
      }])
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10) // Top 10 makers
  }, [mergedTrades, makerWindow])

  // Flow Intelligence — live alpha aggregates for the command bar above the
  // table. ONE O(n) pass over the already-merged trades (+ the existing
  // makerStatsMap), scoped by the selected window. Keyed on data identity so it
  // recomputes only when trades/makers/window change — never per row, never on
  // the 1s age-tick. No backend, no new fetch.
  const [flowWindow, setFlowWindow] = useState('24h') // '5m' | '1h' | '24h'
  const flowStats = useMemo(() => {
    // Real wall-clock windows: "5m" = the last 5 minutes from NOW, etc. So a
    // token whose most recent trade was 14m ago correctly shows 0 in the 5m
    // window instead of resurfacing an old burst. (Recomputes each trade poll,
    // so the window slides as new data arrives.) 24h is the broadest/default.
    const nowMs = Date.now()
    const cutoff = flowWindow === '5m' ? nowMs - 5 * 60_000
      : flowWindow === '1h' ? nowMs - 60 * 60_000
      : nowMs - 24 * 60 * 60_000
    let buyCount = 0, sellCount = 0, buyUsd = 0, sellUsd = 0
    let minTs = Infinity, maxTs = -Infinity
    const events = [] // { ts, usd, isB } for the windowed trades
    const windowMakers = new Map() // per-maker stats WITHIN the window (re-scopes)
    for (const t of mergedTrades) {
      const ts = t.timestamp instanceof Date ? t.timestamp.getTime() : new Date(t.timestamp).getTime()
      if (!(ts >= cutoff)) continue
      const usd = (t.amount && t.price) ? t.amount * t.price : (t.value || 0)
      const isB = (t.type || '').toLowerCase().includes('buy')
      if (isB) { buyCount++; buyUsd += usd } else { sellCount++; sellUsd += usd }
      if (ts < minTs) minTs = ts
      if (ts > maxTs) maxTs = ts
      events.push({ ts, usd, isB })
      if (t.maker) {
        let m = windowMakers.get(t.maker)
        if (!m) { m = { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0 }; windowMakers.set(t.maker, m) }
        if (isB) { m.buys++; m.buyUsd += usd } else { m.sells++; m.sellUsd += usd }
      }
    }
    const total = buyCount + sellCount
    const span = maxTs > minTs ? maxTs - minTs : 1

    // DYNAMIC whale threshold - a trade that's large for THIS token, not a fixed
    // $50K. Scales off the token's typical trade size (window median) and its 24h
    // volume, so a $5K-volume micro-cap isn't asked for $50K prints, and a major
    // isn't flooded with "whales".
    // Token-level (stable across window switches): based on the FULL tape's
    // typical trade size + 24h volume, not the windowed subset - so a "whale"
    // means the same thing whether you're viewing LIVE, 5M or 1H; only the
    // count changes per window.
    const allUsd = mergedTrades
      .map((t) => (t.amount && t.price) ? t.amount * t.price : (t.value || 0))
      .sort((a, b) => a - b)
    const medianUsd = allUsd.length ? allUsd[Math.floor(allUsd.length / 2)] : 0
    const whaleThreshold = niceRound(Math.max(medianUsd * 4, volume24h * 0.005, 100))

    // Whale count + 14-bucket histogram across the window, colored by net side.
    const NB = 14
    const whaleBuckets = Array.from({ length: NB }, () => ({ buy: 0, sell: 0 }))
    let whaleCount = 0
    for (const e of events) {
      if (e.usd < whaleThreshold) continue
      whaleCount++
      let bi = Math.floor(((e.ts - minTs) / span) * NB)
      if (bi >= NB) bi = NB - 1
      if (bi < 0) bi = 0
      if (e.isB) whaleBuckets[bi].buy += e.usd; else whaleBuckets[bi].sell += e.usd
    }
    const whaleData = whaleBuckets.map((b) => ({
      value: b.buy + b.sell,
      color: b.buy >= b.sell ? 'var(--up, #34E89E)' : 'var(--down, #FF5169)',
    }))

    // Velocity = number of trades WITHIN the selected window, so it reads
    // "/5m", "/1h", "/24h" - matching the timeframe the user picked rather than
    // an abstract per-minute rate. Sparkline = trade counts over 20 equal
    // time-buckets across the window.
    const winLabel = flowWindow === '5m' ? '5m' : flowWindow === '1h' ? '1h' : '24h'
    const velValue = total
    const velUnit = `/${winLabel}`
    const velWord = winLabel
    const VB = 20
    const velocitySeries = new Array(VB).fill(0)
    for (const e of events) {
      let bi = Math.floor(((e.ts - minTs) / span) * VB)
      if (bi >= VB) bi = VB - 1
      if (bi < 0) bi = 0
      velocitySeries[bi]++
    }

    // Accumulators / smart money - net buyers WITHIN the window (re-scopes per
    // timeframe, unlike the full-tape maker map the rows use).
    const accumulators = []
    for (const [w, s] of windowMakers) {
      if (s.buys >= 2 && s.buyUsd > s.sellUsd) accumulators.push({ w, net: s.buyUsd - s.sellUsd })
    }
    accumulators.sort((a, b) => b.net - a.net)

    return {
      total, buyCount, sellCount,
      buyShare: total ? buyCount / total : 0,
      buyUsd, sellUsd, netFlow: buyUsd - sellUsd,
      whaleCount, whaleData, whaleThreshold,
      uniqueMakers: windowMakers.size,
      accumulatorCount: accumulators.length,
      topAccumulator: accumulators[0] || null,
      accumulators: accumulators.slice(0, 25),
      velocitySeries, velValue, velUnit, velWord,
    }
  }, [mergedTrades, flowWindow, volume24h])

  // Unit options for MCap filter
  const unitOptions = [
    { value: 1, label: '-' },
    { value: 1000, label: 'K' },
    { value: 1000000, label: 'M' },
    { value: 1000000000, label: 'B' },
  ]

  // Format filter value with unit for badge display
  const formatFilterValue = (value, unit) => {
    if (!value) return ''
    const unitLabel = unitOptions.find(u => u.value === unit)?.label || ''
    return unitLabel === '-' ? value : `${value}${unitLabel}`
  }

  // Type filter options — DexScreener ordering: singles plus the two grouped
  // values ('swap' = buy|sell, 'liquidity' = add|remove, see TYPE_FILTER_GROUPS).
  const typeFilterOptions = [
    { value: null, label: 'All', color: null },
    { value: 'swap', label: 'Buy / Sell', color: null },
    { value: 'buy', label: 'Buy', color: 'var(--bull)' },
    { value: 'sell', label: 'Sell', color: 'var(--bear)' },
    { value: 'liquidity', label: 'Add / Remove', color: null },
    { value: 'add', label: 'Add', color: '#3B82F6' },
    { value: 'remove', label: 'Remove', color: '#F97316' },
  ]

  const getActiveFilterLabel = () => {
    const active = typeFilterOptions.find(o => o.value === typeFilter)
    return active ? active.label : 'All'
  }

  const tabs = useMemo(() => (
    isMajor
      ? [
          { id: 'markets', label: 'Markets' },
          { id: 'keystats', label: 'Key Stats' },
          { id: 'performance', label: 'Performance' },
          { id: 'xcharts', label: 'X Charts' },
        ]
      : [
          { id: 'transactions', label: 'Transactions' },
          { id: 'toptraders', label: 'Top Traders' },
          { id: 'holders', label: 'Holders' },
          { id: 'liquidity', label: 'Liquidity' },
          { id: 'analytics', label: 'Analytics' },
          { id: 'xcharts', label: 'X Charts' },
        ]
  ), [isMajor])

  // When the tab SET changes (token switch between a contract token and a major,
  // or isMajor resolving), snap activeTab back into the current set so the strip
  // highlight + body never point at a tab id that no longer exists.
  useEffect(() => {
    if (!tabs.some(t => t.id === activeTab)) setActiveTab(tabs[0].id)
  }, [tabs, activeTab])

  // Holders data — real API data for supported chains, mock fallback for others
  const MOCK_HOLDERS = [
    { rank: 1, address: '0x28C6c06298d514Db089934071355E5743bf21d60', label: 'Binance 14', balance: 2500000, percentage: 25.0, type: 'CEX', change24h: 2.5, lastActive: '2h ago', txCount: 1247 },
    { rank: 2, address: '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', label: 'Binance 15', balance: 1800000, percentage: 18.0, type: 'CEX', change24h: -1.2, lastActive: '45m ago', txCount: 892 },
    { rank: 3, address: '0x5a52E96BAcdaBb82fd05763E25335261B270Efcb', label: null, balance: 890000, percentage: 8.9, type: 'Whale', change24h: 15.3, lastActive: '1h ago', txCount: 156 },
    { rank: 4, address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', label: 'Binance 8', balance: 650000, percentage: 6.5, type: 'CEX', change24h: 0, lastActive: '3h ago', txCount: 2341 },
    { rank: 5, address: '0x8103683202Aa8dA10536036EDef04CDd865a225E', label: null, balance: 456000, percentage: 4.56, type: 'Whale', change24h: -5.7, lastActive: '12h ago', txCount: 89 },
    { rank: 6, address: '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', label: 'Uniswap V3', balance: 380000, percentage: 3.8, type: 'DEX', change24h: 0.8, lastActive: '5m ago', txCount: 15672 },
    { rank: 7, address: '0x1111111254EEB25477B68fb85Ed929f73A960582', label: '1inch', balance: 290000, percentage: 2.9, type: 'DEX', change24h: -0.3, lastActive: '2m ago', txCount: 8934 },
    { rank: 8, address: '0x742d35Cc6634C0532925a3b844Bc9e7595f5bB30', label: null, balance: 234000, percentage: 2.34, type: 'Whale', change24h: 45.2, lastActive: '30m ago', txCount: 23 },
    { rank: 9, address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', label: 'Binance 7', balance: 189000, percentage: 1.89, type: 'CEX', change24h: 0, lastActive: '6h ago', txCount: 1567 },
    { rank: 10, address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', label: null, balance: 156000, percentage: 1.56, type: 'Holder', change24h: 0, lastActive: '2d ago', txCount: 12 },
  ]

  const holders = useMemo(() => {
    // Use real API data if available
    if (realHolders && realHolders.length > 0) {
      // Divide raw balance by 10^decimals (API returns raw values)
      const decimals = parseInt(liveTokenData?.decimals) || 18
      const divisor = Math.pow(10, decimals)
      return realHolders.map((h, i) => {
        // Codex rows carry shiftedBalance (already decimal-adjusted) and NO
        // percentage; the legacy bridge rows carry a raw balance AND a
        // percentage. Support both so the fallback path keeps working.
        const bal = h.shiftedBalance != null
          ? (parseFloat(h.shiftedBalance) || 0)
          : (parseFloat(h.balance) || 0) / divisor
        let pct = parseFloat(h.percentage ?? h.pct_supply)
        if (!Number.isFinite(pct) || pct <= 0) {
          // Derive share from supply. Falls back to value/mcap, which is the
          // same ratio, when supply has not landed yet.
          if (circulatingSupply > 0) pct = (bal / circulatingSupply) * 100
          else if (marketCap > 0 && h.balanceUsd > 0) pct = (parseFloat(h.balanceUsd) / marketCap) * 100
          else pct = 0
        }
        return {
        rank: h.rank || i + 1,
        address: h.holder_address || h.address || '',
        label: h.label || null,
        balance: bal,
        percentage: pct,
        type: h.type || (pct > 1 ? 'Whale' : 'Holder'),
        change24h: parseFloat(h.change_24h) || 0,
        lastActive: h.last_transfer_time ? formatAge(new Date(h.last_transfer_time)) : '-',
        txCount: parseInt(h.tx_count) || 0,
        _source: h.shiftedBalance != null ? 'codex' : 'spectre',
        }
      })
    }
    // 2026-05-26 beta-quality fix: drop MOCK_HOLDERS fallback (the editorial
    // table showed Binance 7, Vitalik etc. on every token without real data).
    // Empty state handles UX better than fabricated holders.
    return []
  }, [realHolders, liveTokenData?.decimals, circulatingSupply, marketCap])

  /**
   * Holders tab rows — the upstream holder list JOINED to per-maker trade
   * aggregates so each wallet can show PnL and how much of its position is
   * left.
   *
   * ⚠️ The join is the honest part. The holders endpoint carries NO cost
   * basis (only balance / % supply / last transfer), so PnL and "remaining"
   * can only come from `makerStatsMap`, which is derived from the LOADED trade
   * tape - a recent window, not all-time history. A wallet that accumulated
   * before that window simply is not in it. Those rows get `tracked: false`
   * and render an explicit "-", never a fabricated 0: this table already had
   * its MOCK_HOLDERS fallback deleted for exactly that reason (see above).
   *
   * PnL = realised + unrealised against the average cost basis observed in the
   * window: realised uses the proportion of tokens sold, unrealised marks the
   * still-held remainder to the live price. Same formula the tape's maker
   * summary tooltip already uses, so the two surfaces cannot disagree.
   */
  // Per-holder cost basis + realized PnL, from Codex's own per-token wallet
  // index. Fetched ONLY while the Holders tab is open - it is a metered Codex
  // query and Holders is not the default tab, so an idle token page costs zero.
  // One call covers all 50 rows; the server caches it for 2 minutes.
  const [walletStats, setWalletStats] = useState(() => new Map())
  const holderAddrKey = useMemo(
    () => holders.map((h) => h.address).filter(Boolean).slice(0, 50).join(','),
    [holders]
  )

  // Clear on every token switch. Without this, token A's PnL keeps painting
  // under token B's holders until B's request lands - the cross-token
  // contamination class that already bit five hooks in the Research Zone.
  useEffect(() => {
    setWalletStats(new Map())
  }, [token?.address])

  useEffect(() => {
    if (activeTab !== 'holders' || !token?.address || !holderAddrKey) return
    let cancelled = false
    ;(async () => {
      const map = await getWalletStats(
        token.address,
        token.networkId || 1,
        holderAddrKey.split(',')
      )
      if (!cancelled) setWalletStats(map)
    })()
    return () => { cancelled = true }
  }, [activeTab, token?.address, token?.networkId, holderAddrKey])

  const holderRows = useMemo(() => {
    const price = parseFloat(liveTokenData?.price || token?.price || 0) || 0
    // makerStatsMap is keyed by the raw `t.maker` string; holder addresses can
    // arrive in a different case, so index once lowercased rather than missing
    // every join on a checksum-vs-lowercase mismatch.
    const byLower = new Map()
    for (const [maker, e] of makerStatsMap) {
      if (maker) byLower.set(String(maker).toLowerCase(), e)
    }
    return holders.map((h) => {
      const addr = String(h.address || '')
      // Same join key the server builds: EVM folds case, Solana base58 does not.
      const wsKey = addr.startsWith('0x') ? addr.toLowerCase() : addr
      const ws = addr ? walletStats.get(wsKey) : null
      const stats = addr ? byLower.get(addr.toLowerCase()) : null
      const valueUsd = h.balance * price
      let pnlUsd = null
      let pnlPct = null
      let remainPct = null
      let remainUsd = null
      let boughtUsd = null
      let boughtTokens = null
      let source = null

      if (ws && (ws.costUsd > 0 || ws.bought1y > 0)) {
        // PREFERRED: Codex's own per-token wallet index - full trade history,
        // not the 50-row tape. Value comes from the HOLDERS balance (not
        // ws.balance) so PnL always reconciles with the Value column beside it;
        // the two sources snapshot at different times and disagree by design.
        const unrealised = valueUsd - ws.costUsd
        pnlUsd = unrealised + ws.realizedUsd1y
        boughtUsd = ws.costUsd
        pnlPct = ws.costUsd > 0 ? (pnlUsd / ws.costUsd) * 100 : null
        // "Remaining" = of what they bought, how much is still held.
        if (ws.bought1y > 0) {
          const held = Math.max(0, ws.bought1y - ws.sold1y)
          remainPct = Math.min(100, (held / ws.bought1y) * 100)
          remainUsd = held * price
          boughtTokens = ws.bought1y
          // Display denominator must match the window the % came from, or the
          // row reads "98% of $234,871" where the 98% is a 1y figure and the
          // dollar amount is all-time cost. Both true, together misleading.
          if (ws.boughtUsd1y > 0) boughtUsd = ws.boughtUsd1y
        } else if (ws.purchased > 0) {
          // Bought earlier than the 1y window - fall back to the all-time net
          // purchased balance as the denominator.
          remainPct = Math.min(100, (h.balance / ws.purchased) * 100)
          remainUsd = Math.min(h.balance, ws.purchased) * price
          boughtTokens = ws.purchased
        }
        source = 'codex'
      } else if (stats && stats.buyTokens > 0) {
        // FALLBACK: the visible tape. Only fires for a wallet Codex has not
        // indexed but that bought inside the loaded window.
        const costPerToken = stats.buyUsd / stats.buyTokens
        const soldTokens = Math.min(stats.sellTokens, stats.buyTokens)
        const realised = stats.sellUsd - costPerToken * soldTokens
        const heldFromWindow = Math.max(0, stats.buyTokens - stats.sellTokens)
        const unrealised = heldFromWindow * (price - costPerToken)
        pnlUsd = realised + unrealised
        boughtUsd = stats.buyUsd
        pnlPct = stats.buyUsd > 0 ? (pnlUsd / stats.buyUsd) * 100 : null
        remainPct = (heldFromWindow / stats.buyTokens) * 100
        remainUsd = heldFromWindow * price
        boughtTokens = stats.buyTokens
        source = 'tape'
      }

      // Codex HAS this wallet but it never bought the token - it was acquired
      // by transfer/airdrop/CEX. That is a real answer, not missing data, so
      // the cell says so instead of showing an unexplained dash.
      const noBuys = !!ws && !source

      return {
        ...h,
        valueUsd,
        pnlUsd,
        pnlPct,
        remainPct,
        remainUsd,
        boughtUsd,
        boughtTokens,
        pnlSource: source,
        noBuys,
        tracked: !!(ws || stats),
        // Apps this wallet has routed trades through (Codex walletTradeSourceIds).
        // "Trades through", never "is owned by" - one routed trade is enough.
        sources: ws?.sources?.length ? ws.sources : null,
      }
    })
  }, [holders, makerStatsMap, walletStats, liveTokenData?.price, token?.price])

  // Widest holding in the list — drives the inline share bar, so the bars are
  // relative to the top holder rather than to 100% of supply (which would make
  // every row a sliver on a well-distributed token).
  const holderMaxPct = useMemo(
    () => holderRows.reduce((m, h) => Math.max(m, h.percentage || 0), 0) || 1,
    [holderRows]
  )
  
  // Calculate holder analytics
  const holderAnalytics = useMemo(() => {
    const top10Total = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0)
    const top20Total = holders.reduce((sum, h) => sum + h.percentage, 0)
    const whales = holders.filter(h => h.type === 'Whale').length
    const cexHolding = holders.filter(h => h.type === 'CEX').reduce((sum, h) => sum + h.percentage, 0)
    const dexHolding = holders.filter(h => h.type === 'DEX').reduce((sum, h) => sum + h.percentage, 0)
    const accumulating = holders.filter(h => h.change24h > 5).length
    const distributing = holders.filter(h => h.change24h < -5).length
    
    // Risk score based on concentration (lower is better)
    const concentrationRisk = top10Total > 70 ? 'High' : top10Total > 50 ? 'Medium' : 'Low'
    
    // Calculate distribution by type for ALL holders
    const typeDistribution = {
      CEX: holders.filter(h => h.type === 'CEX').reduce((sum, h) => sum + h.percentage, 0),
      DEX: holders.filter(h => h.type === 'DEX').reduce((sum, h) => sum + h.percentage, 0),
      Whale: holders.filter(h => h.type === 'Whale').reduce((sum, h) => sum + h.percentage, 0),
      Holder: holders.filter(h => h.type === 'Holder').reduce((sum, h) => sum + h.percentage, 0),
      Team: holders.filter(h => h.type === 'Team').reduce((sum, h) => sum + h.percentage, 0),
      VC: holders.filter(h => h.type === 'VC').reduce((sum, h) => sum + h.percentage, 0),
    }
    // Remaining percentage (not in our list)
    const trackedTotal = Object.values(typeDistribution).reduce((a, b) => a + b, 0)
    typeDistribution.Other = Math.max(0, 100 - trackedTotal)
    
    return { top10Total, top20Total, whales, cexHolding, dexHolding, accumulating, distributing, concentrationRisk, typeDistribution }
  }, [holders])
  
  // Holder type configurations - clean professional style
  const holderTypeConfig = {
    CEX: { color: '#3b82f6', label: 'CEX' },
    DEX: { color: '#8b5cf6', label: 'DEX' },
    Whale: { color: '#f59e0b', label: 'Whale' },
    Holder: { color: '#64748b', label: 'Holder' },
    Team: { color: '#10b981', label: 'Team' },
    VC: { color: '#ec4899', label: 'VC' },
  }
  
  // Get tier class based on percentage (for subtle row highlighting)
  const getTierClass = (percentage) => {
    if (percentage >= 10) return 'tier-major'
    if (percentage >= 5) return 'tier-significant'
    return ''
  }
  
  // Format large numbers
  const formatHolderBalance = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toLocaleString()
  }
  
  // Copy address handler with toast notification
  const copyHolderAddress = (address) => {
    navigator.clipboard.writeText(address)
    triggerCopyToast('Address copied!')
  }
  
  // State for holder filtering
  const [holderTypeFilter, setHolderTypeFilter] = useState('all')
  const [holderSortBy, setHolderSortBy] = useState('rank')
  
  // Filtered and sorted holders
  const displayHolders = useMemo(() => {
    let filtered = holderTypeFilter === 'all' 
      ? holders 
      : holders.filter(h => h.type === holderTypeFilter)
    
    if (holderSortBy === 'change') {
      return [...filtered].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    }
    return filtered
  }, [holders, holderTypeFilter, holderSortBy])

  // getExplorerUrl moved to module scope for TradeRow access

  // Small info "i" affordance for a flow-bar widget, with a DeFi explanation.
  const renderInfo = (tip) => (
    <span
      className="tx-flow-info"
      tabIndex={0}
      aria-label={tip}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setInfoTip({ visible: true, text: tip, x: r.left + r.width / 2, y: r.bottom + 8 })
      }}
      onMouseLeave={() => setInfoTip((s) => ({ ...s, visible: false }))}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setInfoTip({ visible: true, text: tip, x: r.left + r.width / 2, y: r.bottom + 8 })
      }}
      onBlur={() => setInfoTip((s) => ({ ...s, visible: false }))}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="8" cy="8" r="6.3" />
        <path d="M8 7.2v3.5" strokeLinecap="round" />
        <circle cx="8" cy="4.8" r="0.65" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )

  return (
    <div
      className={`data-tabs data-tabs--i7 ${isExpanded ? 'expanded' : ''}`}
      data-density={transactionsDensity}
      ref={dataTabsRef}
    >
      {/* Tab navigation */}
      <div className="tabs-nav">
        <div className="tabs-scroll" ref={tabsStripRef}>
          {tabs.map(tab => {
            const TabIcon = TAB_ICONS[tab.id]
            const isActive = activeTab === tab.id
            const isLocked = LOCKED_TABS.has(tab.id)
            return (
              <button
                key={tab.id}
                ref={(el) => { tabButtonsRef.current[tab.id] = el }}
                className={`tab-item tab-item--i7 ${isLocked ? 'is-locked' : ''} ${isActive ? 'active' : ''}`}
                aria-label={isLocked ? `${tab.label} (Coming Soon)` : tab.label}
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={isLocked || undefined}
                onMouseEnter={isLocked ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setComingSoonTooltip({
                    visible: true,
                    text: 'Coming Soon',
                    x: rect.left + rect.width / 2,
                    y: rect.top - 8,
                    position: 'top'
                  })
                } : undefined}
                onMouseLeave={isLocked ? () => setComingSoonTooltip({ visible: false, text: '', x: 0, y: 0, position: 'top' }) : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (isLocked) {
                    triggerCopyToast('Coming Soon')
                    return
                  }
                  // Save scroll position BEFORE state change
                  scrollPositionRef.current = window.scrollY
                  setActiveTab(tab.id)
                }}
              >
                {TabIcon && <TabIcon className="tab-item__icon" size={14} aria-hidden="true" />}
                <span className="tab-item__label">{tab.label}</span>
                {isLocked && <Lock className="tab-item__lock" size={11} aria-hidden="true" />}
              </button>
            )
          })}
          {/* Sliding underglow indicator — single animating element under the active tab */}
          <span
            className={`tx-tab-underglow ${tabIndicator.ready ? 'is-ready' : ''}`}
            style={{
              transform: `translateX(${tabIndicator.x}px)`,
              width: `${tabIndicator.w}px`,
            }}
            aria-hidden="true"
          />
        </div>
        <div className="tabs-actions">
          {/* Hairline divider between the tabs and the icon cluster */}
          <span className="tx-actions-divider" aria-hidden="true" />
          {/* Mobile-only: open the filter bottom sheet (column funnels are
              hidden on mobile). Badge shows the active filter count. */}
          {isMobile && activeTab === 'transactions' && (
            <button
              className={`tx-icon-btn tx-filter-btn ${activeFiltersCount > 0 ? 'has-active' : ''}`}
              onClick={() => openFilterSheet(null)}
              title="Filters"
              aria-label="Filters"
              type="button"
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              {activeFiltersCount > 0 && (
                <span className="tx-filter-badge">{activeFiltersCount}</span>
              )}
            </button>
          )}
          {activeTab === 'transactions' && (
            <button
              className={`tx-icon-btn refresh-btn ${loading ? 'spinning' : ''}`}
              onClick={() => refresh()}
              title="Refresh trades"
              aria-label="Refresh trades"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          )}
          {/* Flow Intelligence open/close — collapses the Pressure/Net Flow/
              Whales/Accumulating/Velocity strip to reclaim vertical space. */}
          {!isMajor && activeTab === 'transactions' && !isMobile && (
            <button
              className={`tx-icon-btn tx-flow-toggle ${flowOpen ? 'is-open' : ''}`}
              onClick={toggleFlow}
              title={flowOpen ? 'Hide flow intelligence' : 'Show flow intelligence'}
              aria-label={flowOpen ? 'Hide flow intelligence' : 'Show flow intelligence'}
              aria-expanded={flowOpen}
              type="button"
            >
              <Activity size={14} aria-hidden="true" />
              <ChevronDown className="tx-flow-toggle__chev" size={11} aria-hidden="true" />
            </button>
          )}
          {/* Density toggle — visible inline switch (not buried in a
              popover). Two pills, active one carries the accent fill.
              Column-level filtering lives in the per-column glyphs; the
              expand/collapse chevron was removed in the previous commit
              because the upstream layout didn't actually grow the table
              when toggled. */}
          <div className="tx-density-toggle tx-density-toggle--inline" role="group" aria-label="Row density">
            <button
              className={`tx-density-option ${transactionsDensity === 'comfortable' ? 'active' : ''}`}
              onClick={() => setTransactionsDensity('comfortable')}
              title="Comfortable rows"
              aria-pressed={transactionsDensity === 'comfortable'}
              type="button"
            >
              Comfortable
            </button>
            <button
              className={`tx-density-option ${transactionsDensity === 'compact' ? 'active' : ''}`}
              onClick={() => setTransactionsDensity('compact')}
              title="Compact rows"
              aria-pressed={transactionsDensity === 'compact'}
              type="button"
            >
              Compact
            </button>
          </div>
        </div>
      </div>

      {/* Mobile filter bottom sheet — portal to body so a transformed/overflow
          ancestor can't clip the fixed sheet. */}
      {isMobile && createPortal(
        <MobileFilterSheet
          open={showFilterSheet}
          onClose={() => setShowFilterSheet(false)}
          focusSection={filterFocus}
          nativeTokenSymbol={nativeTokenSymbol}
          filters={{
            typeFilter, setTypeFilter, typeFilterOptions,
            priceFilter, setPriceFilter, showPriceMode, setShowPriceMode, unitOptions,
            amountFilter, setAmountFilter, showAmountMode, setShowAmountMode,
            ethFilter, setEthFilter,
            valueFilter, setValueFilter,
            makerFilter, setMakerFilter, uniqueMakers,
          }}
        />,
        document.body
      )}

      {/* Mobile maker action sheet — copy / explorer / filter for a tapped row */}
      {isMobile && createPortal(
        <MobileMakerSheet
          open={!!makerSheetAddr}
          maker={makerSheetAddr}
          profile={makerSheetAddr ? makerProfiles.get(makerSheetAddr) : null}
          networkId={token?.networkId || 1}
          isActiveFilter={makerFilter === makerSheetAddr}
          explorerUrl={makerSheetAddr ? getExplorerUrl(makerSheetAddr, token?.networkId || 1, 'address') : null}
          onClose={() => setMakerSheetAddr(null)}
          onCopy={() => { if (makerSheetAddr) { navigator.clipboard?.writeText(makerSheetAddr); triggerCopyToast?.() } }}
          onFilter={() => {
            if (makerFilter === makerSheetAddr) clearMakerFilter()
            else filterByMaker(makerSheetAddr)
            setMakerSheetAddr(null)
          }}
        />,
        document.body
      )}

      {/* Flow Intelligence — live alpha command bar (desktop transactions only).
          Reuses the right-panel instruments (DivergingBar / Odometer / Sparkline /
          MicroBars) so the section reads as one product. All five widgets derive
          from the single flowStats memo. */}
      {!isMajor && activeTab === 'transactions' && !isMobile && flowOpen && (
        <div className="tx-flow-bar" role="group" aria-label="Flow intelligence">
          {/* PRESSURE */}
          <div className="tx-flow-cell tx-flow-cell--pressure">
            <div className="tx-flow-cell__head">
              <span className="tx-flow-cell__label">Pressure{renderInfo(FLOW_TIPS.pressure)}</span>
              <span className={`tx-flow-cell__value ${flowStats.buyShare >= 0.5 ? 'is-up' : 'is-down'}`}>
                <Odometer value={Math.round(flowStats.buyShare * 100)} decimals={0} suffix="%" raw />
              </span>
            </div>
            <div className="tx-flow-split">
              <span className="tx-flow-split__buy">{flowStats.buyCount} buys</span>
              <span className="tx-flow-split__sell">{flowStats.sellCount} sells</span>
            </div>
            <DivergingBar left={flowStats.buyCount} right={flowStats.sellCount} height={6} />
          </div>

          {/* NET FLOW */}
          <div className="tx-flow-cell tx-flow-cell--netflow">
            <div className="tx-flow-cell__head">
              <span className="tx-flow-cell__label">Net Flow{renderInfo(FLOW_TIPS.netflow)}</span>
              <span className={`tx-flow-cell__value ${flowStats.netFlow >= 0 ? 'is-up' : 'is-down'}`}>
                <Odometer value={Math.abs(flowStats.netFlow)} decimals={1} prefix={flowStats.netFlow >= 0 ? '+$' : '-$'} />
              </span>
            </div>
            <span className="tx-flow-cell__sub">{flowStats.netFlow >= 0 ? 'Money flowing in' : 'Money flowing out'}</span>
            <DivergingBar left={flowStats.buyUsd} right={flowStats.sellUsd} height={6} />
          </div>

          {/* WHALES */}
          <div className="tx-flow-cell tx-flow-cell--whales">
            <div className="tx-flow-cell__head">
              <span className="tx-flow-cell__label">
                Whales{renderInfo(FLOW_TIPS.whales)}
              </span>
              <span className="tx-flow-cell__value">
                <Odometer value={flowStats.whaleCount} decimals={0} raw />
              </span>
            </div>
            <span className="tx-flow-cell__sub">&ge; {fmtUsdShort(flowStats.whaleThreshold)} prints</span>
            <div className="tx-flow-viz">
              {flowStats.whaleData.some(d => d.value > 0)
                ? <MicroBars data={flowStats.whaleData} width={150} height={22} gap={2} />
                : <span className="tx-flow-empty">No whale activity</span>}
            </div>
          </div>

          {/* ACCUM / SMART MONEY */}
          <div className="tx-flow-cell tx-flow-cell--accum">
            <div className="tx-flow-cell__head">
              <span className="tx-flow-cell__label">Accumulating{renderInfo(FLOW_TIPS.accumulating)}</span>
              <span className="tx-flow-cell__value is-up">
                <Odometer value={flowStats.accumulatorCount} decimals={0} raw />
              </span>
            </div>
            {flowStats.accumulatorCount > 0 ? (
              <button
                type="button"
                className={`tx-flow-accum-view${accumOpen ? ' is-open' : ''}`}
                title="See all accumulating wallets"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setAccumPos({ x: Math.min(r.left, window.innerWidth - 272), y: r.bottom + 6 })
                  setAccumOpen((o) => !o)
                }}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M2 4h12M2 8h12M2 12h8" strokeLinecap="round" />
                </svg>
                <span>View wallets</span>
                <svg className="tx-flow-accum-view__chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="tx-flow-cell__sub">No net buyers yet</span>
            )}
            <span className="tx-flow-cell__foot">{flowStats.uniqueMakers} unique makers</span>
          </div>

          {/* VELOCITY */}
          <div className="tx-flow-cell tx-flow-cell--velocity">
            <div className="tx-flow-cell__head">
              <span className="tx-flow-cell__label">Velocity{renderInfo(FLOW_TIPS.velocity)}</span>
              <span className="tx-flow-cell__value">
                <Odometer value={flowStats.velValue} decimals={0} suffix={flowStats.velUnit} raw />
              </span>
            </div>
            <span className="tx-flow-cell__sub">trades this window</span>
            <div className="tx-flow-viz">
              {flowStats.velocitySeries.length
                ? <Sparkline data={flowStats.velocitySeries} width={150} height={22} stroke="var(--accent, #C6FF3A)" fill="gradient" />
                : <span className="tx-flow-empty">-</span>}
            </div>
          </div>

          {/* WINDOW PILLS */}
          <div className="tx-flow-windows" role="group" aria-label="Flow window">
            {['5m', '1h', '24h'].map(w => (
              <button
                key={w}
                type="button"
                className={`tx-flow-window ${flowWindow === w ? 'active' : ''}`}
                onClick={() => setFlowWindow(w)}
                aria-pressed={flowWindow === w}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="tabs-content">
        {/* Major coins (BTC/ETH/XRP/...): CoinGecko Markets / Key Stats /
            Performance, replacing the wrapped contract's on-chain tabs. */}
        {isMajor && (
          <MajorCoinPanel
            token={token}
            cgId={majorCgId}
            activeTab={['markets', 'keystats', 'performance'].includes(activeTab) ? activeTab : 'markets'}
          />
        )}
        {!isMajor && activeTab === 'transactions' && isMobile && (
          <div className="table-wrapper table-wrapper--mobile" ref={tableWrapperRef}>
            <MobileTransactions
              trades={filteredTrades}
              loading={loading && trades.length === 0}
              error={error}
              empty={trades.length === 0}
              filteredEmpty={filteredTrades.length === 0}
              typeFilter={typeFilter}
              typeFilterOptions={typeFilterOptions}
              onTypeFilter={setTypeFilter}
              valueFilter={valueFilter}
              onValueFilter={setValueFilter}
              circulatingSupply={circulatingSupply}
              showDateMode={showDateMode}
              showPriceMode={showPriceMode}
              makerFilter={makerFilter}
              makerProfiles={makerProfiles}
              valueFilterActive={isValueFilterActive}
              priceFilterActive={isPriceFilterActive}
              onMakerTap={handleMakerTap}
              onMakerFilter={toggleMakerFilter}
              onOpenFilters={openFilterSheet}
              spectreMarks={spectreMarks}
              hasMore={hasMore}
              loadingMore={loadingMore}
              loadMore={loadMore}
              tradesCount={trades.length}
              onRetry={refresh}
            />
          </div>
        )}
        {/* --txns modifier: the sibling wrappers all carry one (--mobile,
            --toptraders, --liquidity, holders-table-wrapper) and this was the
            only bare one, so the recessed row field can be scoped to
            Transactions without a chain of :not()s. */}
        {!isMajor && activeTab === 'transactions' && !isMobile && (
          <div className="table-wrapper table-wrapper--txns" ref={tableWrapperRef}>
            {loading && trades.length === 0 ? (
              <table className="data-table">
                <colgroup>
                  <col className="col-pfp" />
                  <col className="col-age" />
                  <col className="col-type" />
                  <col className="col-price" />
                  <col className="col-amount" />
                  <col className="col-native" />
                  <col className="col-usd" />
                  <col className="col-maker" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="th-pfp" aria-label="Wallet" />
                    <th>Age</th>
                    <th>Type</th>
                    <th>Price</th>
                    <th>Amount</th>
                    <th>Token</th>
                    <th>USD</th>
                    <th>Maker</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 15 }, (_, i) => (
                    <tr key={i} className="skel-row">
                      <td className="cell-pfp"><div className={`animate-shimmer skel-cell skel-pfp stagger-${(i % 5) + 1}`} /></td>
                      <td><div className={`animate-shimmer skel-cell skel-age stagger-${(i % 5) + 1}`} /></td>
                      <td><div className={`animate-shimmer skel-cell skel-type stagger-${(i % 5) + 1}`} /></td>
                      <td><div className={`animate-shimmer skel-cell skel-price stagger-${(i % 5) + 1}`} /></td>
                      <td><div className={`animate-shimmer skel-cell skel-amount stagger-${(i % 5) + 1}`} /></td>
                      <td><div className={`animate-shimmer skel-cell skel-native stagger-${(i % 5) + 1}`} /></td>
                      <td><div className={`animate-shimmer skel-cell skel-usd stagger-${(i % 5) + 1}`} /></td>
                      <td><div className={`animate-shimmer skel-cell skel-maker stagger-${(i % 5) + 1}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : error ? (
              <div className="error-state">
                <p>Failed to load trades</p>
                <button onClick={refresh}>Retry</button>
              </div>
            ) : trades.length === 0 ? (
              <div className="empty-state">
                <p>No transactions found</p>
                <span>Trades will appear here when available</span>
              </div>
            ) : (
              <>
            <table className="data-table">
              <colgroup>
                {/* PFP is a fixed 34px gutter; the six data columns share the rest. */}
                <col className="col-pfp" />
                <col className="col-age" />
                <col className="col-type" />
                <col className="col-price" />
                <col className="col-amount" />
                {/* SIZE absorbed the old NATIVE column - 6 data cols, not 7. */}
                <col className="col-size" />
                <col className="col-maker" />
              </colgroup>
              <thead>
                <tr>
                    <th className="th-pfp" aria-label="Wallet" />
                    <th>
                      <span className="th-content date-age-toggle">
                        <span
                          className={`toggle-option ${!showDateMode ? 'active' : ''}`}
                          onClick={() => setShowDateMode(!showDateMode)}
                        >Age</span>
                        <span className="toggle-separator">/</span>
                        <span
                          className={`toggle-option ${showDateMode ? 'active' : ''}`}
                          onClick={() => setShowDateMode(!showDateMode)}
                        >Date</span>
                      </span>
                    </th>
                    <th>
                      <span className="th-content">
                        Type
                        <div className="filter-dropdown-wrapper" ref={typeMenuRef}>
                          <button 
                            className={`filter-btn ${typeFilter ? 'active' : ''}`} 
                            title="Filter by type"
                            onClick={() => setShowTypeMenu(!showTypeMenu)}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                            </svg>
                          </button>
                          {showTypeMenu && (
                            <div className="filter-dropdown-menu">
                              {typeFilterOptions.map(option => (
                                <button
                                  key={option.label}
                                  className={`filter-menu-item ${typeFilter === option.value ? 'active' : ''}`}
                                  onClick={() => {
                                    setTypeFilter(option.value)
                                    setShowTypeMenu(false)
                                  }}
                                  style={option.color ? { '--item-color': option.color } : {}}
                                >
                                  {option.color && (
                                    <span className="filter-menu-dot" style={{ backgroundColor: option.color }}></span>
                                  )}
                                  {option.label}
                                  {typeFilter === option.value && (
                                    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" className="check-icon">
                                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                                    </svg>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                          {typeFilter && (
                            <span className={`active-filter-badge ${typeFilter}`}>
                              {getActiveFilterLabel()}
                              <button className="filter-badge-close" onClick={(e) => { e.stopPropagation(); setTypeFilter(null); }}>×</button>
                            </span>
                          )}
                        </div>
                      </span>
                    </th>
                    <th>
                      <span className="th-content">
                        <span className="date-age-toggle" title={showPriceMode ? 'Switch to market cap' : 'Switch to price'}>
                          {/* MCap first - it is the default, same as the chart.
                              Any click FLIPS the mode: below a 1180px panel the
                              inactive option is hidden (DataTabs.css) so the
                              header reads as one label, and that label has to
                              be the switch. */}
                          <span
                            className={`toggle-option ${!showPriceMode ? 'active' : ''}`}
                            onClick={() => setShowPriceMode(!showPriceMode)}
                          >MCap</span>
                          <span className="toggle-separator">/</span>
                          <span
                            className={`toggle-option ${showPriceMode ? 'active' : ''}`}
                            onClick={() => setShowPriceMode(!showPriceMode)}
                          >Price</span>
                        </span>
                        <div className="filter-dropdown-wrapper" ref={priceMenuRef}>
                          <button 
                            className={`filter-btn ${isPriceFilterActive ? 'active' : ''}`} 
                            title={`Filter by ${showPriceMode ? 'price' : 'market cap'}`}
                            onClick={() => showPriceMenu ? setShowPriceMenu(false) : openPriceMenu()}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                            </svg>
                          </button>
                          {showPriceMenu && (
                            <div className="filter-dropdown-menu amount-filter-menu">
                              <div className="amount-filter-inputs">
                                <div className="amount-input-group">
                                  <label>Min {showPriceMode ? '$' : 'MCap'}</label>
                                  <div className="input-with-unit">
                                    <input
                                      type="number"
                                      placeholder="0"
                                      value={pendingPriceFilter.min}
                                      onChange={(e) => setPendingPriceFilter(prev => ({ ...prev, min: e.target.value }))}
                                    />
                                    {!showPriceMode && (
                                      <div className="unit-pills">
                                        {unitOptions.filter(u => u.label !== '-').map(opt => (
                                          <button
                                            key={opt.value}
                                            className={`unit-pill ${pendingPriceFilter.minUnit === opt.value ? 'active' : ''}`}
                                            onClick={() => setPendingPriceFilter(prev => ({ ...prev, minUnit: opt.value }))}
                                            type="button"
                                          >
                                            {opt.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="amount-input-group">
                                  <label>Max {showPriceMode ? '$' : 'MCap'}</label>
                                  <div className="input-with-unit">
                                    <input
                                      type="number"
                                      placeholder="∞"
                                      value={pendingPriceFilter.max}
                                      onChange={(e) => setPendingPriceFilter(prev => ({ ...prev, max: e.target.value }))}
                                    />
                                    {!showPriceMode && (
                                      <div className="unit-pills">
                                        {unitOptions.filter(u => u.label !== '-').map(opt => (
                                          <button
                                            key={opt.value}
                                            className={`unit-pill ${pendingPriceFilter.maxUnit === opt.value ? 'active' : ''}`}
                                            onClick={() => setPendingPriceFilter(prev => ({ ...prev, maxUnit: opt.value }))}
                                            type="button"
                                          >
                                            {opt.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="amount-filter-actions">
                                <button className="clear-filter-btn" onClick={clearPriceFilter}>
                                  Clear
                                </button>
                                <button className="apply-filter-btn" onClick={applyPriceFilter}>
                                  Apply
                                </button>
                              </div>
                            </div>
                          )}
                          {isPriceFilterActive && (
                            <span className="active-filter-badge price">
                              {showPriceMode
                                ? `$${priceFilter.min || '0'}-${priceFilter.max || '∞'}`
                                : `${formatFilterValue(priceFilter.min, priceFilter.minUnit) || '0'}-${formatFilterValue(priceFilter.max, priceFilter.maxUnit) || '∞'}`
                              }
                              <button className="filter-badge-close" onClick={(e) => { e.stopPropagation(); clearPriceFilter(); }}>×</button>
                            </span>
                          )}
                        </div>
                      </span>
                    </th>
                    <th>
                      <span className="th-content">
                        <span className="date-age-toggle">
                          <span
                            className={`toggle-option ${showAmountMode ? 'active' : ''}`}
                            onClick={() => setShowAmountMode(!showAmountMode)}
                          >Amount</span>
                          <span className="toggle-separator">/</span>
                          <span
                            className={`toggle-option ${!showAmountMode ? 'active' : ''}`}
                            onClick={() => setShowAmountMode(!showAmountMode)}
                          >%</span>
                        </span>
                        <div className="filter-dropdown-wrapper" ref={amountMenuRef}>
                          <button 
                            className={`filter-btn ${isAmountFilterActive ? 'active' : ''}`} 
                            title="Filter by amount"
                            onClick={() => showAmountMenu ? setShowAmountMenu(false) : openAmountMenu()}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                            </svg>
                          </button>
                          {showAmountMenu && (
                            <div className="filter-dropdown-menu amount-filter-menu">
                              <div className="amount-filter-inputs">
                                <div className="amount-input-group">
                                  <label>Min {showAmountMode ? '$' : '%'}</label>
                                  <input
                                    type="number"
                                    placeholder="0"
                                    value={pendingAmountFilter.min}
                                    onChange={(e) => setPendingAmountFilter(prev => ({ ...prev, min: e.target.value }))}
                                  />
                                </div>
                                <div className="amount-input-group">
                                  <label>Max {showAmountMode ? '$' : '%'}</label>
                                  <input
                                    type="number"
                                    placeholder="∞"
                                    value={pendingAmountFilter.max}
                                    onChange={(e) => setPendingAmountFilter(prev => ({ ...prev, max: e.target.value }))}
                                  />
                                </div>
                              </div>
                              <div className="amount-filter-actions">
                                <button className="clear-filter-btn" onClick={clearAmountFilter}>
                                  Clear
                                </button>
                                <button className="apply-filter-btn" onClick={applyAmountFilter}>
                                  Apply
                                </button>
                              </div>
                            </div>
                          )}
                          {isAmountFilterActive && (
                            <span className="active-filter-badge amount">
                              {showAmountMode ? '$' : ''}{amountFilter.min || '0'}-{amountFilter.max || '∞'}{!showAmountMode ? '%' : ''}
                              <button className="filter-badge-close" onClick={(e) => { e.stopPropagation(); clearAmountFilter(); }}>×</button>
                            </span>
                          )}
                        </div>
                      </span>
                    </th>
                    {/* SIZE - one header, both range filters. The old NATIVE
                        column merged in here, so its filter lives alongside the
                        USD one rather than being dropped; each keeps its own
                        title + active-filter badge to stay distinguishable. */}
                    <th>
                      <span className="th-content">
                        Size
                        {/* USD filter FIRST, then the native one: USD is the
                            primary reading of trade size and the column is
                            labelled for it. Swapped in the DOM rather than with
                            CSS `order` so tab/keyboard order matches what is
                            on screen. */}
                        <div className="filter-dropdown-wrapper" ref={valueMenuRef}>
                          <button 
                            className={`filter-btn ${isValueFilterActive ? 'active' : ''}`} 
                            title="Filter by USD"
                            onClick={() => showValueMenu ? setShowValueMenu(false) : openValueMenu()}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                            </svg>
                          </button>
                          {showValueMenu && (
                            <div className="filter-dropdown-menu amount-filter-menu">
                              <div className="amount-filter-inputs">
                                <div className="amount-input-group">
                                  <label>Min USD</label>
                                  <input
                                    type="number"
                                    placeholder="0"
                                    value={pendingValueFilter.min}
                                    onChange={(e) => setPendingValueFilter(prev => ({ ...prev, min: e.target.value }))}
                                  />
                                </div>
                                <div className="amount-input-group">
                                  <label>Max USD</label>
                                  <input
                                    type="number"
                                    placeholder="∞"
                                    value={pendingValueFilter.max}
                                    onChange={(e) => setPendingValueFilter(prev => ({ ...prev, max: e.target.value }))}
                                  />
                                </div>
                              </div>
                              <div className="amount-filter-actions">
                                <button className="clear-filter-btn" onClick={clearValueFilter}>Clear</button>
                                <button className="apply-filter-btn" onClick={applyValueFilter}>Apply</button>
                              </div>
                            </div>
                          )}
                          {isValueFilterActive && (
                            <span className="active-filter-badge usd">
                              ${valueFilter.min || '0'}-${valueFilter.max || '∞'}
                              <button className="filter-badge-close" onClick={(e) => { e.stopPropagation(); clearValueFilter(); }}>×</button>
                            </span>
                          )}
                        </div>
                        <div className="filter-dropdown-wrapper" ref={ethMenuRef}>
                          <button 
                            className={`filter-btn ${isEthFilterActive ? 'active' : ''}`} 
                            title={`Filter by ${nativeTokenSymbol}`}
                            onClick={() => showEthMenu ? setShowEthMenu(false) : openEthMenu()}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                            </svg>
                          </button>
                          {showEthMenu && (
                            <div className="filter-dropdown-menu amount-filter-menu">
                              <div className="amount-filter-inputs">
                                <div className="amount-input-group">
                                  <label>Min {nativeTokenSymbol}</label>
                                  <input
                                    type="number"
                                    placeholder="0"
                                    value={pendingEthFilter.min}
                                    onChange={(e) => setPendingEthFilter(prev => ({ ...prev, min: e.target.value }))}
                                  />
                                </div>
                                <div className="amount-input-group">
                                  <label>Max {nativeTokenSymbol}</label>
                                  <input
                                    type="number"
                                    placeholder="∞"
                                    value={pendingEthFilter.max}
                                    onChange={(e) => setPendingEthFilter(prev => ({ ...prev, max: e.target.value }))}
                                  />
                                </div>
                              </div>
                              <div className="amount-filter-actions">
                                <button className="clear-filter-btn" onClick={clearEthFilter}>Clear</button>
                                <button className="apply-filter-btn" onClick={applyEthFilter}>Apply</button>
                              </div>
                            </div>
                          )}
                          {isEthFilterActive && (
                            <span className="active-filter-badge eth">
                              {ethFilter.min || '0'}-{ethFilter.max || '∞'} {nativeTokenSymbol}
                              <button className="filter-badge-close" onClick={(e) => { e.stopPropagation(); clearEthFilter(); }}>×</button>
                            </span>
                          )}
                        </div>
                      </span>
                    </th>
                    <th>
                      <span className="th-content">
                        Maker
                        <div className="filter-dropdown-wrapper" ref={makerMenuRef}>
                          <button 
                            className={`filter-btn ${isMakerFilterActive ? 'active' : ''}`} 
                            title="Filter by maker"
                            onClick={() => showMakerMenu ? setShowMakerMenu(false) : openMakerMenu()}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                            </svg>
                          </button>
                          {showMakerMenu && (
                            <div className="filter-dropdown-menu maker-filter-menu">
                              <div className="maker-filter-input">
                                <label>Maker Address</label>
                                <input
                                  type="text"
                                  placeholder="0x..."
                                  value={pendingMakerFilter}
                                  onChange={(e) => setPendingMakerFilter(e.target.value)}
                                />
                              </div>
                              {makerStatsMap.size > 0 && (
                                <div className="maker-quick-list">
                                  <div className="maker-quick-head">
                                    <label>Top Makers</label>
                                    <div className="maker-window-seg" role="group" aria-label="Top makers window">
                                      {[
                                        { w: '1h', label: '1H', title: 'Makers active in the last hour' },
                                        { w: '24h', label: '24H', title: 'Makers active in the last 24h (bounded by how far the loaded tape reaches)' },
                                      ].map(({ w, label, title }) => (
                                        <button
                                          key={w}
                                          type="button"
                                          title={title}
                                          className={`maker-window-seg__btn ${makerWindow === w ? 'active' : ''}`}
                                          onClick={() => setMakerWindow(w)}
                                        >
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="maker-quick-rows">
                                    {uniqueMakers.length > 0 ? (
                                      uniqueMakers.map(([address, stats], i) => (
                                        <button
                                          key={address}
                                          className={`maker-quick-item ${pendingMakerFilter === address ? 'active' : ''}`}
                                          onClick={() => setPendingMakerFilter(address)}
                                        >
                                          <span className="maker-quick-rank">{i + 1}</span>
                                          <span className={`maker-quick-lean maker-quick-lean--${stats.lean}`} aria-hidden="true" />
                                          <span className="maker-quick-address">{truncateAddress(address)}</span>
                                          <span className="maker-quick-count">{stats.count} txs</span>
                                        </button>
                                      ))
                                    ) : (
                                      <div className="maker-quick-empty">No makers in this window</div>
                                    )}
                                  </div>
                                </div>
                              )}
                              <div className="amount-filter-actions">
                                <button className="clear-filter-btn" onClick={clearMakerFilter}>
                                  Clear
                                </button>
                                <button className="apply-filter-btn" onClick={applyMakerFilter}>
                                  Apply
                                </button>
                              </div>
                            </div>
                          )}
                          {isMakerFilterActive && (
                            <span className="active-filter-badge maker">
                              {truncateAddress(makerFilter)}
                              <button className="filter-badge-close" onClick={(e) => { e.stopPropagation(); clearMakerFilter(); }}>×</button>
                            </span>
                          )}
                        </div>
                      </span>
                    </th>
                </tr>
              </thead>
              <tbody>
                  {filteredTrades.length === 0 ? (
                    <tr className="empty-filter-row">
                      <td colSpan={7}>
                        <div className="empty-state empty-state--in-table">
                          <p>No {typeFilter ? (typeFilterOptions.find(o => o.value === typeFilter)?.label || typeFilter).toLowerCase() : 'matching'} transactions</p>
                          <span>Try a different filter</span>
                          <button type="button" className="clear-all-filters-btn" onClick={clearAllFilters}>
                            Clear all filters
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : tradeRows}
              </tbody>
            </table>
              {hasMore && (
                <div className="load-more-container">
                  <button 
                    className="load-more-btn"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <span className="spinner-small"></span>
                        Loading...
                      </>
                    ) : (
                      <>Load More Transactions</>
                    )}
                  </button>
                  <span className="loaded-count">{trades.length} transactions loaded</span>
                </div>
              )}
              </>
            )}
          </div>
        )}

        {!isMajor && activeTab === 'toptraders' && (
          <div className="table-wrapper table-wrapper--toptraders" ref={tableWrapperRef}>
            <TopTradersPanel
              token={token}
              fallbackTraders={topTraders}
              onMakerTap={(m) => {
                if (isMobile) handleMakerTap(m)
                else { filterByMaker(m); setActiveTab('transactions') }
              }}
            />
          </div>
        )}

        {!isMajor && activeTab === 'liquidity' && (
          <div className="table-wrapper table-wrapper--liquidity" ref={tableWrapperRef}>
            <LiquidityPanel
              token={token}
              marketCap={marketCap}
              tokenPrice={liveTokenData?.price || token?.price || 0}
              onCopy={(text) => { try { navigator.clipboard?.writeText(text); triggerCopyToast() } catch { /* no clipboard */ } }}
              explorerUrl={(addr) => getExplorerUrl(addr, token?.networkId || 1, 'address')}
            />
          </div>
        )}

        {activeTab === 'holders' && (
          <div className="holders-section">
            {!isHoldersChartSupported(token?.networkId) ? (
              <div className="empty-state">
                <span>Holder data is not available on this chain</span>
                <span>Supported on EVM networks</span>
              </div>
            ) : holdersLoading && holderRows.length === 0 ? (
              /* Shimmer skeleton, not a spinner (design-system rule). Row count
                 and column grid match the real table so nothing jumps on load. */
              <div className="table-wrapper table-wrapper--holders">
                <table className="data-table hld-table">
                  <colgroup>
                    <col className="hld-col-rank" /><col className="hld-col-wallet" />
                    <col className="hld-col-amount" /><col className="hld-col-share" />
                    <col className="hld-col-value" /><col className="hld-col-pnl" />
                    <col className="hld-col-remain" /><col className="hld-col-act" />
                  </colgroup>
                  <tbody>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="hld-skel-row">
                        {Array.from({ length: 8 }).map((__, j) => (
                          <td key={j}><span className="hld-skel" /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : holderRows.length === 0 ? (
              <div className="empty-state">
                <span>No holder data available</span>
                <span>Nothing returned for this token yet</span>
              </div>
            ) : (
              <div className="table-wrapper table-wrapper--holders">
                <table className="data-table hld-table">
                  <colgroup>
                    <col className="hld-col-rank" /><col className="hld-col-wallet" />
                    <col className="hld-col-amount" /><col className="hld-col-share" />
                    <col className="hld-col-value" /><col className="hld-col-pnl" />
                    <col className="hld-col-remain" /><col className="hld-col-act" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Wallet</th>
                      <th>Amount</th>
                      <th>Share</th>
                      <th>Value</th>
                      <th>PnL</th>
                      <th>Remaining</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {holderRows.map((h) => (
                      <HolderRow
                        key={h.address || h.rank}
                        h={h}
                        maxPct={holderMaxPct}
                        symbol={token?.symbol}
                        networkId={token?.networkId}
                        isFiltered={makerFilter === h.address}
                        onFilterSwaps={(addr) => { filterByMaker(addr); setActiveTab('transactions') }}
                        onCopy={triggerCopyToast}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* CLEARED 2026-08-17 (Gleb) - rebuilt from scratch below.
                Removed: the four analytics stat cards (Top 10 Concentration,
                Exchange Holdings, Large Holders, 24h Movement); the "Token
                Distribution by Holder Type" block with its total-tracked
                readout, All/CEX/DEX/Whale/Holder/Team/VC/Other filter chips
                and Sort control; and the holders table (#/Holder/Supply/
                Value/Share/24h delta/Last Active/Actions).

                STILL WIRED and ready to build on - nothing below was touched:
                  useTopHolders(holdersAddr, networkId, 50)   -> realHolders
                  useHoldersChart(holdersAddr, networkId, ..) -> holderChartData
                  the `holders` and `holderAnalytics` memos
                Both hooks are gated on this tab being open and are EVM-only
                (Solana returns [] without a request). Ask and I will strip
                that data layer too. */}
          </div>
        )}

        {activeTab === 'analytics' && (
          <Suspense fallback={null}>
          <AnalyticsTab
            token={token}
            poolAddress={wsPoolAddress}
          />
          </Suspense>
        )}
        {/* X Charts — mention-vs-price social charts (XFullView engine). */}
        {activeTab === 'xcharts' && (
          <Suspense fallback={null}>
            <XChartsTab token={token} />
          </Suspense>
        )}
        {/* Liquidation, On-Chain (Bubblemap) and X Bubblemap tabs removed
            from the tab strip - their content branches are gone too. */}
      </div>

      {/* Coming Soon tooltip — portaled to <body> so position: fixed is
          actually viewport-relative. .data-tabs--i7 uses backdrop-filter,
          which makes ANY position: fixed descendant containing-block-
          rooted at the section instead of the viewport (CSS containing-
          block spec). Without the portal the tooltip lands mid-table
          instead of above the hovered tab. */}
      {comingSoonTooltip.visible && createPortal(
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
        </div>,
        document.body
      )}

      {infoTip.visible && createPortal(
        <div
          className="tx-flow-info-tip"
          style={{
            position: 'fixed',
            left: `${infoTip.x}px`,
            top: `${infoTip.y}px`,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 99999,
          }}
        >
          {infoTip.text}
        </div>,
        document.body
      )}

      {accumOpen && createPortal(
        <>
          <div className="tx-accum-backdrop" onClick={() => setAccumOpen(false)} />
          <div
            className="tx-accum-pop"
            style={{ position: 'fixed', left: `${accumPos.x}px`, top: `${accumPos.y}px`, zIndex: 100000 }}
          >
            <div className="tx-accum-pop__head">
              <span>Accumulating wallets</span>
              <span className="tx-accum-pop__count">{flowStats.accumulatorCount}</span>
            </div>
            <div className="tx-accum-pop__list">
              {flowStats.accumulators && flowStats.accumulators.length ? flowStats.accumulators.map((a, i) => (
                <div
                  className="tx-accum-row"
                  key={a.w}
                  style={{ '--accum-bar': `${Math.max(8, Math.round((a.net / (flowStats.accumulators[0]?.net || a.net || 1)) * 100))}%` }}
                >
                  <span className="tx-accum-row__rank">{i + 1}</span>
                  <span className="tx-accum-row__addr" title={a.w}>{a.w.slice(0, 6)}…{a.w.slice(-4)}</span>
                  <span className="tx-accum-row__net">+{formatUsd(a.net)}</span>
                  <span className="tx-accum-row__acts">
                    <button
                      type="button"
                      className="tx-accum-row__act"
                      title="Copy address"
                      onClick={() => { navigator.clipboard?.writeText(a.w); triggerCopyToast?.('Address copied!') }}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`tx-accum-row__act tx-accum-row__filter ${makerFilter === a.w ? 'active' : ''}`}
                      title={makerFilter === a.w ? 'Clear filter' : 'Filter the table by this wallet'}
                      onClick={() => {
                        if (makerFilter === a.w) clearMakerFilter()
                        else filterByMaker(a.w)
                        setAccumOpen(false)
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                        <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z" />
                      </svg>
                    </button>
                  </span>
                </div>
              )) : (
                <div className="tx-accum-empty">No accumulating wallets in this window</div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

export default React.memo(DataTabs)
