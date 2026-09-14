/**
 * Watchlists — shared utilities, constants, and MiniSparkline component.
 * Extracted from watchlists-page.jsx for maintainability.
 */
import React, { useMemo, useRef } from 'react'
import { getNetworkName } from '@/services/codexApi'
import { isMajorToken } from '@/constants/majorTokens'

import MobileBottomSheet, { BottomSheetAction } from './mobile-bottom-sheet'
import SwipeableRow from './swipeable-row'
import InfoTip from '@/components/InfoTip'

const NETWORK_NAMES = {
  1: 'ETH',
  56: 'BSC',
  137: 'MATIC',
  42161: 'ARB',
  8453: 'BASE',
  43114: 'AVAX',
  10: 'OP',
  250: 'FTM',
  1399811149: 'SOL',
}
const getChainName = (networkId) => NETWORK_NAMES[networkId] ?? getNetworkName(networkId) ?? '-'

// Chain logos for display
const CHAIN_LOGOS = {
  1: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  56: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  137: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  42161: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  8453: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', // Base uses ETH
  43114: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  10: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  250: 'https://assets.coingecko.com/coins/images/4001/small/Fantom_round.png',
  1399811149: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
}
const getChainLogo = (networkId) => CHAIN_LOGOS[networkId] || CHAIN_LOGOS[1]

// Get pair quote token based on chain
const getPairQuote = (networkId, symbol) => {
  // For major tokens without real DEX pair, show USDT
  const upperSymbol = (symbol || '').toUpperCase()
  if (isMajorToken(upperSymbol)) {
    return '/USDT'
  }
  switch (networkId) {
    case 1399811149: return '/SOL'  // Solana
    case 56: return '/BNB'          // BSC
    case 137: return '/MATIC'       // Polygon
    case 43114: return '/AVAX'      // Avalanche
    case 250: return '/FTM'         // Fantom
    default: return '/WETH'         // ETH, ARB, BASE, OP
  }
}

// Get correct chain for token (majors use their native chain)
const getTokenChainInfo = (networkId, symbol) => {
  const upperSymbol = (symbol || '').toUpperCase()
  // Major tokens - use their native chain logo
  if (upperSymbol === 'BTC' || upperSymbol === 'WBTC') {
    return { logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', name: 'BTC' }
  }
  if (upperSymbol === 'ETH' || upperSymbol === 'WETH') {
    return { logo: CHAIN_LOGOS[1], name: 'ETH' }
  }
  if (upperSymbol === 'SOL') {
    return { logo: CHAIN_LOGOS[1399811149], name: 'SOL' }
  }
  // On-chain tokens - use actual network
  return { logo: getChainLogo(networkId), name: getChainName(networkId) }
}

import '@/components/watchlist-shared.css'
import './watchlists-page.css'
import './watchlists-page.mobile.css'

// Seeded PRNG — deterministic noise per token
const seedHash = (str) => {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return h
}
const seededRandom = (seed) => {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s & 0x7fffffff) / 2147483647 }
}

// Generate realistic price path between two values with N steps
const generatePath = (from, to, steps, rng, volatility) => {
  const pts = [from]
  // Brownian bridge: random walk that ends at target
  const drift = (to - from) / steps
  let val = from
  for (let i = 1; i < steps; i++) {
    const noise = (rng() - 0.5) * 2 * volatility
    const pull = (to - val) / (steps - i) * 0.3 // gentle pull toward target
    val += drift + noise + pull
    pts.push(val)
  }
  pts.push(to)
  return pts
}

// Mini sparkline SVG — smooth bezier trend with glow + end-point marker.
// Wrapped in React.memo at the bottom of this file so 46-token watchlists
// don't redraw all 46 SVG paths on every Binance price tick.
const MiniSparklineImpl = ({ data = [], width = 120, height = 32, positive = true }) => {
  const idRef = useRef(null)
  if (!idRef.current) idRef.current = Math.random().toString(36).slice(2, 11)
  const gradId = `spark-grad-${idRef.current}`
  const glowId = `spark-glow-${idRef.current}`
  if (!data || data.length < 2) return <div className="mini-sparkline-empty" style={{ width: 72, height: 24 }} />

  const padY = 3
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - padY - ((v - min) / range) * (height - padY * 2),
  }))

  // Catmull-Rom -> cubic bezier for an Apple-grade smooth curve
  const tension = 0.5
  let linePath = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension
    linePath += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

  const color = positive ? 'var(--bull)' : 'var(--bear)'
  const fillTop = positive ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'
  const fillMid = positive ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)'
  const last = points[points.length - 1]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mini-sparkline-svg" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillTop} />
          <stop offset="55%" stopColor={fillMid} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="0.9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} vectorEffect="non-scaling-stroke" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.x} cy={last.y} r="1.6" fill={color} className="mini-sparkline-dot" />
    </svg>
  )
}

// Cache for synthesised sparklines. Real CoinGecko sparklines (sparkline_7d
// array) are stable by reference and only change when CG returns new data
// (every ~60s). The synthesised path is fully decorative — it just needs to
// LOOK like a price trend for a given symbol. We key it ONLY by symbol +
// sign(change24h) so the curve stays put across ticks and the SVG never
// re-renders mid-session.
const _sparkCache = new Map()

const getSparkPoints = (token) => {
  // Real sparkline from CoinGecko (168 hourly prices over 7 days).
  //
  // Every consumer of this pairs the line with a 24h change (mobile + desktop
  // rows colour by `change24h`, the search result by `change`), so the line is
  // windowed to the last 24h — the last seventh of a 168-point 7d series.
  // Drawing the whole week under a 24h number put a red line beside a green %
  // (founder, 08-02). Windowing is the honest fix: the colour and the drawing
  // now describe the same 24 hours.
  if (Array.isArray(token.sparkline_7d) && token.sparkline_7d.length >= 20) {
    const full = token.sparkline_7d
    // Guarded on length so a feed that already hands us a short/24h series is
    // drawn whole instead of sliced to a stub.
    const src = full.length >= 48
      ? full.slice(-Math.max(2, Math.round(full.length / 7)))
      : full
    if (src.length <= 48) {
      // The slice is a fresh array each call, which would defeat MiniSparkline's
      // reference check — cache it against the stable source array.
      const hit = _sparkCache.get(full)
      if (hit && hit.length === src.length) return hit
      _sparkCache.set(full, src)
      return src
    }
    const cached = _sparkCache.get(full)
    if (cached) return cached
    const step = (src.length - 1) / 47
    const out = []
    for (let i = 0; i < 48; i++) out.push(src[Math.round(i * step)])
    _sparkCache.set(full, out)
    return out
  }

  // Synthesised path — key on symbol + sign(change24h) only. The curve will
  // flip up/down if the 24h sign changes (so a token that went red shows a
  // declining curve), but won't twitch on every 0.05% wiggle.
  const sym = (token.symbol || 'X').toUpperCase()
  const sign = (Number(token.change24h) || 0) >= 0 ? 'p' : 'n'
  const cacheKey = `${sym}|${sign}`
  const cached = _sparkCache.get(cacheKey)
  if (cached) return cached

  const rng = seededRandom(Math.abs(seedHash(sym)) || 1)
  const c24h = Number(token.change24h) || 0
  const c1h = Number(token.change1h) || 0
  const c6h = Number(token.change6h) || 0
  const c7d = Number(token.change7d) || 0
  const now = 100
  const p24h = now / (1 + c24h / 100)
  const p6h = now / (1 + c6h / 100)
  const p1h = now / (1 + c1h / 100)
  const p7d = now / (1 + c7d / 100)
  const maxChange = Math.max(Math.abs(c24h), Math.abs(c7d), Math.abs(c1h), 0.5)
  const vol = maxChange * 0.12
  const seg1 = generatePath(p7d, p24h, 18, rng, vol)
  const seg2 = generatePath(p24h, p6h, 10, rng, vol * 0.8)
  const seg3 = generatePath(p6h, p1h, 8, rng, vol * 0.6)
  const seg4 = generatePath(p1h, now, 6, rng, vol * 0.4)
  const out = [...seg1, ...seg2.slice(1), ...seg3.slice(1), ...seg4.slice(1)]

  if (_sparkCache.size > 500) {
    const firstKey = _sparkCache.keys().next().value
    _sparkCache.delete(firstKey)
  }
  _sparkCache.set(cacheKey, out)
  return out
}

// Memoised MiniSparkline. The custom comparator does an array-length + first/
// last value check (cheap) before settling on referential equality, so callers
// passing the same cached array from `getSparkPoints` skip re-render entirely.
const MiniSparkline = React.memo(MiniSparklineImpl, (prev, next) => {
  if (prev.width !== next.width || prev.height !== next.height) return false
  if (prev.positive !== next.positive) return false
  if (prev.data === next.data) return true
  if (!Array.isArray(prev.data) || !Array.isArray(next.data)) return false
  if (prev.data.length !== next.data.length) return false
  // Length matches but reference differs — quickly compare first + last as a
  // cheap proxy for "did the underlying series actually change". This is
  // safe because `getSparkPoints` returns the same cached array reference
  // for unchanged tokens; we only get here when the user resized or the
  // sparkline_7d ref legitimately rotated.
  return prev.data[0] === next.data[0] && prev.data[prev.data.length - 1] === next.data[next.data.length - 1]
})

// Token logos - shared with WelcomePage for consistency
const TOKEN_LOGOS = {
  'BTC': 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  'ETH': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  'SOL': 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  'PEPE': 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  'WIF': 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  'BONK': 'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',
  'SHIB': 'https://assets.coingecko.com/coins/images/11939/small/shiba.png',
  'DOGE': 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  'ARB': 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  'OP': 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  'MATIC': 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  'AVAX': 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  'LINK': 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  'UNI': 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg',
  'AAVE': 'https://assets.coingecko.com/coins/images/12645/small/AAVE.png',
  'CRV': 'https://assets.coingecko.com/coins/images/12124/small/Curve.png',
  'MKR': 'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png',
  'LDO': 'https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png',
  'FET': 'https://assets.coingecko.com/coins/images/5681/small/Fetch.jpg',
  'RENDER': 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  'RNDR': 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  'TAO': 'https://assets.coingecko.com/coins/images/28452/small/ARUsPeNQ_400x400.jpeg',
  'OCEAN': 'https://assets.coingecko.com/coins/images/3687/small/ocean-protocol-logo.jpg',
  'GRT': 'https://assets.coingecko.com/coins/images/13397/small/Graph_Token.png',
  'FIL': 'https://assets.coingecko.com/coins/images/12817/small/filecoin.png',
  'INJ': 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
  'SUI': 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  'APT': 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  'SEI': 'https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png',
  'TIA': 'https://assets.coingecko.com/coins/images/31967/small/tia.jpg',
  'ONDO': 'https://assets.coingecko.com/coins/images/26580/small/ONDO.png',
  'JUP': 'https://assets.coingecko.com/coins/images/34188/small/jup.png',
  'PYTH': 'https://assets.coingecko.com/coins/images/31924/small/pyth.png',
  'JTO': 'https://assets.coingecko.com/coins/images/33228/small/jto.png',
  'FLOKI': 'https://assets.coingecko.com/coins/images/16746/small/PNG_image.png',
  'USDT': 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  'USDC': 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  'BNB': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  'SPECTRE': '/round-logo.png',
  'M87': 'https://assets.coingecko.com/coins/images/35071/small/m87.png',
  'NPC': 'https://assets.coingecko.com/coins/images/31229/small/npc.png',
  'NEURAL': 'https://coin-images.coingecko.com/coins/images/36341/small/blackpfp.png',
  'PALM': 'https://coin-images.coingecko.com/coins/images/33097/small/PALM_NEW_LOGO.png',
  'GRAY': 'https://coin-images.coingecko.com/coins/images/66304/small/photo_2025-06-04_14.56.52_%281%29_%281%29.jpeg',
}

// Helper to get logo for a token symbol.
// 2026-05-28: for tokens that have a hardcoded canonical URL in TOKEN_LOGOS
// (BTC/ETH/SOL/etc.), prefer that over the persisted tokenLogo. Watchlist
// entries persist whatever URL was set when the token was first added, so a
// stale CoinGecko URL (or one cached during an upstream blip) sticks around
// in localStorage forever and renders as an empty circle. The hardcoded map
// is the reliable source for majors.
const getTokenLogo = (symbol, tokenLogo) => {
  const upperSymbol = (symbol || '').toUpperCase()
  const canonical = TOKEN_LOGOS[upperSymbol]
  if (canonical) return canonical
  if (tokenLogo && !tokenLogo.includes('placeholder')) return tokenLogo
  return null
}


export { NETWORK_NAMES, CHAIN_LOGOS, TOKEN_LOGOS, getChainName, getChainLogo, getPairQuote, getTokenChainInfo, seedHash, seededRandom, generatePath, MiniSparkline, getSparkPoints, getTokenLogo }
