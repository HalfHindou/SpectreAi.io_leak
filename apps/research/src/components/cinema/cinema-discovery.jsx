/**
 * CinemaDiscovery - Netflix-style token discovery rows
 *
 * Creative overhaul: Rich cards with sparkline charts, brand-color gradients,
 * proper data hierarchy, ambient glow, and cinematic presence.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TOKEN_ROW_COLORS, getTokenDisplayColors } from '@/constants/tokenColors'
import { getBinanceKlines } from '@/services/binanceApi'
import { getStockLogoUrl } from '@/services/stockApi'
import { useCurrency } from '@/hooks/useCurrency'

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN DATA MAPS
// ═══════════════════════════════════════════════════════════════════════════════

const TOKEN_LOGOS = {
  'BTC': 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  'ETH': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  'SOL': 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  'BNB': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  'XRP': 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  'ADA': 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  'DOGE': 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  'AVAX': 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  'LINK': 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  'UNI': 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg',
  'MATIC': 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  'ARB': 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  'OP': 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  'PEPE': 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  'SHIB': 'https://assets.coingecko.com/coins/images/11939/small/shiba.png',
  'AAVE': 'https://assets.coingecko.com/coins/images/12645/small/AAVE.png',
  'MKR': 'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png',
  'CRV': 'https://assets.coingecko.com/coins/images/12124/small/Curve.png',
  'FET': 'https://assets.coingecko.com/coins/images/5681/small/Fetch.jpg',
  'RNDR': 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  'INJ': 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
  'SUI': 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  'APT': 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  'DOT': 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  'NEAR': 'https://assets.coingecko.com/coins/images/10365/small/near.jpg',
  'ATOM': 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png',
  'FIL': 'https://assets.coingecko.com/coins/images/12817/small/filecoin.png',
  'LTC': 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  'TRX': 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  'SPECTRE': '/round-logo.png',
}

const TOKEN_TAGLINES = {
  'BTC': 'Digital Gold',
  'ETH': 'World Computer',
  'SOL': 'Speed of Light',
  'BNB': 'Exchange Powerhouse',
  'XRP': 'Global Payments',
  'ADA': 'Academic Rigor',
  'DOGE': 'The People\'s Coin',
  'AVAX': 'Subnet Pioneer',
  'LINK': 'Oracle Network',
  'UNI': 'DEX King',
  'MATIC': 'Scaling Ethereum',
  'ARB': 'Layer 2 Leader',
  'OP': 'Optimistic Future',
  'PEPE': 'Meme Supreme',
  'SHIB': 'Shiba Army',
  'AAVE': 'Lending Protocol',
  'MKR': 'Stablecoin Maker',
  'CRV': 'Curve Finance',
  'FET': 'AI Agents',
  'RNDR': 'GPU Computing',
  'INJ': 'DeFi Hub',
  'SUI': 'Move Language',
  'APT': 'Aptos Chain',
  'DOT': 'Interoperability',
  'NEAR': 'Chain Abstraction',
  'ATOM': 'Internet of Blockchains',
  'FIL': 'Decentralized Storage',
  'LTC': 'Silver Standard',
  'TRX': 'Entertainment Chain',
  'SPECTRE': 'AI Intelligence',
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY DEFINITIONS - Richer, fuller categories
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORIES = [
  {
    id: 'layer1',
    title: 'Layer 1 Blockchains',
    subtitle: 'Foundation protocols powering web3',
    symbols: ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'SUI', 'APT', 'DOT', 'NEAR', 'ATOM'],
  },
  {
    id: 'defi',
    title: 'DeFi Blue Chips',
    subtitle: 'Decentralized finance leaders',
    symbols: ['UNI', 'AAVE', 'MKR', 'CRV', 'LINK', 'INJ'],
  },
  {
    id: 'momentum',
    title: 'Meme & Momentum',
    subtitle: 'Community-driven tokens',
    symbols: ['DOGE', 'SHIB', 'PEPE'],
  },
  {
    id: 'scaling',
    title: 'Scaling & L2',
    subtitle: 'Layer 2 networks & scaling solutions',
    symbols: ['ARB', 'OP', 'MATIC'],
  },
  {
    id: 'ai',
    title: 'AI & Compute',
    subtitle: 'Machine intelligence on-chain',
    symbols: ['FET', 'RNDR'],
  },
]

const STOCK_CATEGORIES = [
  {
    id: 'mag7',
    title: 'Magnificent 7',
    subtitle: 'The mega-cap tech leaders driving the market',
    symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'],
  },
  {
    id: 'ai-semi',
    title: 'AI & Semiconductors',
    subtitle: 'Powering the artificial intelligence revolution',
    symbols: ['NVDA', 'AMD', 'AVGO', 'INTC', 'QCOM', 'TSM'],
  },
  {
    id: 'finance',
    title: 'Big Finance',
    subtitle: 'Banking, payments, and financial infrastructure',
    symbols: ['JPM', 'V', 'MA', 'BAC', 'GS', 'MS'],
  },
  {
    id: 'healthcare',
    title: 'Healthcare Giants',
    subtitle: 'Pharma, biotech, and healthcare leaders',
    symbols: ['JNJ', 'UNH', 'PFE', 'LLY', 'ABBV', 'MRK'],
  },
  {
    id: 'consumer',
    title: 'Consumer Favorites',
    subtitle: 'Retail, food, and consumer brands',
    symbols: ['WMT', 'COST', 'HD', 'NKE', 'SBUX', 'MCD'],
  },
]

const STOCK_TAGLINES = {
  'AAPL': 'Think Different', 'MSFT': 'Cloud & AI', 'GOOGL': 'Search & AI', 'AMZN': 'Everything Store',
  'NVDA': 'GPU Revolution', 'META': 'Social Empire', 'TSLA': 'EV Pioneer', 'AMD': 'Chipmaker',
  'AVGO': 'Semiconductor', 'INTC': 'Intel Inside', 'QCOM': 'Mobile Chips', 'TSM': 'Foundry King',
  'JPM': 'Banking Giant', 'V': 'Payment Network', 'MA': 'Mastercard', 'BAC': 'Bank of America',
  'GS': 'Goldman Sachs', 'MS': 'Morgan Stanley', 'JNJ': 'Healthcare', 'UNH': 'Health Insurance',
  'PFE': 'Pharma Giant', 'LLY': 'Eli Lilly', 'ABBV': 'Biopharma', 'MRK': 'Merck & Co',
  'WMT': 'Retail King', 'COST': 'Wholesale Club', 'HD': 'Home Depot', 'NKE': 'Just Do It',
  'SBUX': 'Coffee Empire', 'MCD': 'Golden Arches', 'SPY': 'S&P 500 ETF', 'QQQ': 'Nasdaq 100 ETF',
  'NFLX': 'Streaming King', 'DIS': 'Entertainment', 'CRM': 'Cloud CRM', 'ORCL': 'Enterprise',
  'PLTR': 'Data Analytics', 'GOOG': 'Alphabet',
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// BREATHING CHART BACKGROUND - Rich animated canvas for hero card
// ═══════════════════════════════════════════════════════════════════════════════

// 2026-05-26 beta-quality fix: flat baseline instead of synthesized random-walk
// trend line, which users mistook for the token's real price chart.
const generateSyntheticSparkline = (_isPositive, points = 80) => {
  return Array.from({ length: points }, () => 100)
}

const BreathingChartBackground = React.memo(({ sparklineData, brandColor, isPositive }) => {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const syntheticRef = useRef(null)

  // Generate stable synthetic data once
  if (!syntheticRef.current) {
    syntheticRef.current = generateSyntheticSparkline(isPositive)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    let currentWidth = 0
    let currentHeight = 0

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return false
      currentWidth = rect.width
      currentHeight = rect.height
      canvas.width = currentWidth * dpr
      canvas.height = currentHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return true
    }

    if (!resize()) {
      const retryTimeout = setTimeout(() => resize(), 50)
      return () => clearTimeout(retryTimeout)
    }

    window.addEventListener('resize', resize)

    let time = 0
    const rgb = brandColor || (isPositive ? '34, 197, 94' : '239, 68, 68')
    const chartData = sparklineData?.length > 10 ? sparklineData : syntheticRef.current
    // Cap breathing-chart background at 30fps — invisible difference, half CPU.
    const FRAME_MS = 1000 / 30
    let lastFrame = 0

    const draw = (now) => {
      animationRef.current = requestAnimationFrame(draw)
      if (now - lastFrame < FRAME_MS) return
      lastFrame = now

      const w = currentWidth
      const h = currentHeight
      if (w === 0 || h === 0) return

      ctx.clearRect(0, 0, w, h)

      const breathe = Math.sin(time * 0.025) * 0.12 + 1
      const verticalShift = Math.sin(time * 0.018) * 10

      if (chartData) {
        const min = Math.min(...chartData)
        const max = Math.max(...chartData)
        const range = max - min || 1
        const padding = h * 0.12

        // Multiple glow passes for richer effect
        for (let pass = 0; pass < 3; pass++) {
          ctx.beginPath()
          chartData.forEach((val, i) => {
            const x = (i / (chartData.length - 1)) * w
            const normalizedY = (val - min) / range
            const y = h - padding - (normalizedY * (h * 0.65) * breathe) + verticalShift
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })

          if (pass === 0) {
            ctx.lineTo(w, h)
            ctx.lineTo(0, h)
            ctx.closePath()
            const gradient = ctx.createLinearGradient(0, h * 0.15, 0, h)
            gradient.addColorStop(0, `rgba(${rgb}, 0.35)`)
            gradient.addColorStop(0.4, `rgba(${rgb}, 0.15)`)
            gradient.addColorStop(0.7, `rgba(${rgb}, 0.05)`)
            gradient.addColorStop(1, `rgba(${rgb}, 0)`)
            ctx.fillStyle = gradient
            ctx.fill()
          } else {
            const alphas = [0.7, 0.45, 0.25]
            const widths = [4, 2.5, 1.5]
            ctx.strokeStyle = `rgba(${rgb}, ${alphas[pass - 1] || 0.3})`
            ctx.lineWidth = widths[pass - 1] || 1
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            if (pass === 1) {
              ctx.shadowColor = `rgba(${rgb}, 0.6)`
              ctx.shadowBlur = 25
            } else {
              ctx.shadowBlur = 0
            }
            ctx.stroke()
          }
        }

        // Animated pulse dot at current price
        const lastX = w - 15
        const lastY = h - padding - (((chartData[chartData.length - 1] - min) / range) * (h * 0.65) * breathe) + verticalShift
        const pulseSize = 5 + Math.sin(time * 0.1) * 3

        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize + 12, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${rgb}, ${0.15 + Math.sin(time * 0.1) * 0.08})`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize + 5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${rgb}, ${0.3 + Math.sin(time * 0.1) * 0.12})`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${rgb})`
        ctx.shadowColor = `rgba(${rgb}, 0.7)`
        ctx.shadowBlur = 15
        ctx.fill()
        ctx.shadowBlur = 0

        ctx.beginPath()
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
      } else {
        // Fallback: animated sine waves
        for (let layer = 0; layer < 2; layer++) {
          ctx.beginPath()
          const amplitude = (40 + layer * 20) * breathe
          const frequency = 0.015 - layer * 0.003
          const speed = 0.025 + layer * 0.008
          const yOffset = h * 0.55 + layer * 25 + verticalShift
          const alpha = 0.25 - layer * 0.08

          for (let x = 0; x <= w; x += 2) {
            const y = yOffset + Math.sin(x * frequency + time * speed) * amplitude
            if (x === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.lineTo(w, h)
          ctx.lineTo(0, h)
          ctx.closePath()

          const waveGradient = ctx.createLinearGradient(0, yOffset - amplitude, 0, h)
          waveGradient.addColorStop(0, `rgba(${rgb}, ${alpha})`)
          waveGradient.addColorStop(0.6, `rgba(${rgb}, ${alpha * 0.3})`)
          waveGradient.addColorStop(1, `rgba(${rgb}, 0)`)
          ctx.fillStyle = waveGradient
          ctx.fill()

          ctx.beginPath()
          for (let x = 0; x <= w; x += 2) {
            const y = yOffset + Math.sin(x * frequency + time * speed) * amplitude
            if (x === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.strokeStyle = `rgba(${rgb}, ${alpha + 0.2})`
          ctx.lineWidth = 2 - layer * 0.5
          ctx.shadowColor = `rgba(${rgb}, 0.4)`
          ctx.shadowBlur = layer === 0 ? 12 : 0
          ctx.stroke()
          ctx.shadowBlur = 0
        }
      }

      time++
    }

    const start = () => {
      if (animationRef.current) return
      lastFrame = 0
      animationRef.current = requestAnimationFrame(draw)
    }
    const stop = () => {
      if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null }
    }
    const onVis = () => { if (document.hidden) stop(); else start() }
    document.addEventListener('visibilitychange', onVis)
    if (!document.hidden) start()

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      stop()
    }
  }, [sparklineData, brandColor, isPositive])

  return <canvas ref={canvasRef} className="breathing-chart-canvas" />
})

// ═══════════════════════════════════════════════════════════════════════════════
// SPARKLINE SVG - Beautiful mini line chart
// ═══════════════════════════════════════════════════════════════════════════════

const SparklineSVG = ({ data, width = 160, height = 48, positive = true, brandRgb = '139,92,246' }) => {
  if (!data || data.length < 2) return null

  // Downsample to ~40 points for smooth curves
  const step = Math.max(1, Math.floor(data.length / 40))
  const sampled = data.filter((_, i) => i % step === 0)

  const min = Math.min(...sampled)
  const max = Math.max(...sampled)
  const range = max - min || 1

  const points = sampled.map((val, i) => {
    const x = (i / (sampled.length - 1)) * width
    const y = height - 4 - ((val - min) / range) * (height - 8)
    return `${x},${y}`
  }).join(' ')

  // Create gradient fill path
  const firstY = height - 4 - ((sampled[0] - min) / range) * (height - 8)
  const lastY = height - 4 - ((sampled[sampled.length - 1] - min) / range) * (height - 8)
  const fillPath = `M0,${firstY} L${points.split(' ').map(p => p).join(' L')} L${width},${height} L0,${height} Z`

  const color = positive ? `rgba(${brandRgb}, 1)` : 'rgba(239, 68, 68, 1)'
  const colorFaded = positive ? `rgba(${brandRgb}, 0.15)` : 'rgba(239, 68, 68, 0.12)'

  return (
    <svg
      className="cinema-sparkline-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`sparkGrad-${brandRgb.replace(/,/g, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorFaded} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      {/* Gradient fill */}
      <path
        d={fillPath}
        fill={`url(#sparkGrad-${brandRgb.replace(/,/g, '')})`}
      />
      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* End dot */}
      <circle
        cx={width}
        cy={lastY}
        r="2.5"
        fill={color}
        className="cinema-sparkline-dot"
      />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CINEMA TOKEN CARD - Rich, cinematic card with sparkline
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaTokenCard = React.memo(({
  symbol,
  name,
  price,
  change,
  marketCap,
  volume,
  sparkline,
  rank,
  index,
  onClick,
  onAddToWatchlist,
  isWatchlisted,
}) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const [isHovered, setIsHovered] = useState(false)
  const changeNum = typeof change === 'string' ? parseFloat(change) : (change || 0)
  const displayColors = getTokenDisplayColors(symbol)
  const rgb = displayColors.raw
  const sparkRgb = displayColors.accent // contrast-safe version for visible sparklines on dark bg
  const isPositive = changeNum >= 0
  const isStock = !TOKEN_LOGOS[symbol] && !!STOCK_TAGLINES[symbol]
  const logo = TOKEN_LOGOS[symbol] || getStockLogoUrl(symbol)
  const tagline = TOKEN_TAGLINES[symbol] || STOCK_TAGLINES[symbol] || (isStock ? 'Stock' : 'Digital Asset')
  const mcFormatted = marketCap ? fmtLarge(marketCap) : ''
  const volFormatted = volume ? fmtLarge(volume) : ''

  return (
    <div
      className={`cinema-token-card ${isHovered ? 'hovered' : ''} ${isWatchlisted ? 'in-watchlist' : ''}`}
      style={{ '--brand-rgb': sparkRgb, '--card-index': index }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick?.({ symbol, name, price, change })}
    >
      {/* Background glow on hover */}
      <div className="cinema-token-card-glow" />

      {/* Sparkline chart - background visual */}
      <div className="cinema-token-card-sparkline">
        <SparklineSVG data={sparkline} positive={isPositive} brandRgb={sparkRgb} />
      </div>

      {/* Watchlist star */}
      <button
        className={`cinema-token-card-star ${isWatchlisted ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onAddToWatchlist?.({ symbol })
        }}
      >
        <svg viewBox="0 0 24 24" fill={isWatchlisted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>

      {/* Top section: Logo + Identity */}
      <div className="cinema-token-card-top">
        <div className="cinema-token-card-logo">
          <div className="cinema-token-card-logo-ring" />
          {logo ? <img src={logo} alt={symbol} onError={isStock ? (e) => { e.target.style.display = 'none' } : undefined} /> : <span className="cinema-token-card-logo-fallback">{symbol[0]}</span>}
        </div>
        <div className="cinema-token-card-identity">
          <span className="cinema-token-card-symbol">{symbol}</span>
          <span className="cinema-token-card-name">{tagline}</span>
        </div>
      </div>

      {/* Bottom section: Price + Stats */}
      <div className="cinema-token-card-bottom">
        <div className="cinema-token-card-price-row">
          <span className="cinema-token-card-price">{fmtPrice(price)}</span>
          <span className={`cinema-token-card-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '+' : ''}{changeNum.toFixed(2)}%
          </span>
        </div>
        {mcFormatted && (
          <div className="cinema-token-card-meta">
            <span>{t('common.marketCap')} {mcFormatted}</span>
            {volFormatted && <span>{t('chart.vol')} {volFormatted}</span>}
          </div>
        )}
      </div>
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY ROW - Horizontal scroll with edge fades
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaCategoryRow = ({
  title,
  subtitle,
  tokens,
  onTokenClick,
  onAddToWatchlist,
  isInWatchlist,
  large = false,
}) => {
  const { t } = useTranslation()
  const scrollRef = useRef(null)
  const rafRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const handleScroll = useCallback(() => {
    if (rafRef.current) return // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el) return
      const left = el.scrollLeft > 20
      const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 20
      setCanScrollLeft(prev => prev !== left ? left : prev)
      setCanScrollRight(prev => prev !== right ? right : prev)
    })
  }, [])

  const scroll = (direction) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction === 'left' ? -500 : 500, behavior: 'smooth' })
  }

  if (!tokens || tokens.length === 0) return null

  return (
    <section className={`cinema-category-row ${large ? 'cinema-category-row--large' : ''}`}>
      {/* Chapter-style divider */}
      <div className="cinema-category-chapter">
        <span className="cinema-category-chapter-line" />
        <span className="cinema-category-chapter-label">{t('cinemaDiscover.collection')}</span>
        <span className="cinema-category-chapter-line" />
      </div>

      <div className="cinema-category-header">
        <div className="cinema-category-titles">
          <h2 className="cinema-category-title">{title}</h2>
          {subtitle && <p className="cinema-category-subtitle">{subtitle}</p>}
        </div>
        <div className="cinema-category-nav">
          <span className="cinema-category-count">{t('cinemaDiscover.tokenCount', { count: tokens.length })}</span>
          <button
            className={`cinema-category-arrow ${!canScrollLeft ? 'disabled' : ''}`}
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            className={`cinema-category-arrow ${!canScrollRight ? 'disabled' : ''}`}
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="cinema-category-scroll-wrapper">
        {/* Left fade */}
        {canScrollLeft && <div className="cinema-category-fade cinema-category-fade--left" />}

        <div
          className="cinema-category-scroll"
          ref={scrollRef}
          onScroll={handleScroll}
        >
          {tokens.map((token, idx) => (
            <CinemaTokenCard
              key={token.symbol || idx}
              symbol={token.symbol}
              name={token.name}
              price={token.price}
              change={token.change}
              marketCap={token.marketCap}
              volume={token.volume}
              sparkline={token.sparkline}
              rank={token.rank}
              index={idx}
              onClick={onTokenClick}
              onAddToWatchlist={onAddToWatchlist}
              isWatchlisted={isInWatchlist?.(token.symbol)}
            />
          ))}
        </div>

        {/* Right fade */}
        {canScrollRight && <div className="cinema-category-fade cinema-category-fade--right" />}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN EXCHANGES - Curated for known tokens, API fallback for others
// ═══════════════════════════════════════════════════════════════════════════════

// Curated exchange lists for tokens with known, verified trading venues
const CURATED_EXCHANGES = {
  BTC: ['Binance', 'Coinbase', 'Kraken', 'Bybit', 'OKX'],
  ETH: ['Binance', 'Coinbase', 'Kraken', 'Uniswap', 'OKX'],
  SOL: ['Binance', 'Coinbase', 'Kraken', 'Jupiter', 'Raydium'],
  BNB: ['Binance', 'Gate.io', 'KuCoin', 'MEXC', 'PancakeSwap'],
  XRP: ['Binance', 'Kraken', 'Bitstamp', 'Coinbase', 'Bitfinex'],
  ADA: ['Binance', 'Coinbase', 'Kraken', 'Minswap', 'OKX'],
  DOGE: ['Binance', 'Coinbase', 'Kraken', 'Robinhood', 'OKX'],
  AVAX: ['Binance', 'Coinbase', 'Kraken', 'TraderJoe', 'OKX'],
  LINK: ['Binance', 'Coinbase', 'Kraken', 'Uniswap', 'OKX'],
  UNI: ['Binance', 'Coinbase', 'Kraken', 'Uniswap', 'OKX'],
  ARB: ['Binance', 'Coinbase', 'KuCoin', 'Uniswap', 'OKX'],
  OP: ['Binance', 'Coinbase', 'KuCoin', 'Uniswap', 'OKX'],
  PEPE: ['Binance', 'Coinbase', 'OKX', 'Uniswap', 'Bybit'],
  SPECTRE: ['Uniswap V2', 'BVOX'],
}

// In-memory cache so we don't re-fetch for the same symbol within a session
const exchangeSessionCache = {}

async function fetchTokenExchanges(symbol) {
  if (!symbol) return []
  const key = symbol.toUpperCase()

  // Use curated list for known tokens
  if (CURATED_EXCHANGES[key]) return CURATED_EXCHANGES[key]

  if (exchangeSessionCache[key]) return exchangeSessionCache[key]

  try {
    const res = await fetch(`/api/token-exchanges?symbol=${encodeURIComponent(key)}`)
    if (res.ok) {
      const data = await res.json()
      const exchanges = data.exchanges || []
      if (exchanges.length > 0) {
        exchangeSessionCache[key] = exchanges
        return exchanges
      }
    }
  } catch (e) {
    // silently handled
  }
  return []
}

// ═══════════════════════════════════════════════════════════════════════════════
// HERO FEATURED TOKEN - Full Storybook Immersive Style
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaHeroToken = ({ token, sparkline, onClick, featuredTokens = [], featuredIndex = 0, onDotClick }) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  if (!token) return null

  const displayColors = getTokenDisplayColors(token.symbol)
  const rgb = displayColors.accent // contrast-safe for dark bg
  const isStockToken = token.isStock || (!TOKEN_LOGOS[token.symbol] && !!STOCK_TAGLINES[token.symbol])
  const logo = TOKEN_LOGOS[token.symbol] || token.logo || (isStockToken ? getStockLogoUrl(token.symbol) : '')
  const tagline = TOKEN_TAGLINES[token.symbol] || STOCK_TAGLINES[token.symbol] || (isStockToken ? 'Stock' : 'Crypto Asset')
  const changeNum = typeof token.change === 'string' ? parseFloat(token.change) : (token.change || 0)
  const isPositive = changeNum >= 0
  const mcFormatted = token.marketCap ? fmtLarge(token.marketCap) : ''
  const rank = token.rank

  // Fetch real exchange data from backend - never fabricated
  const [exchanges, setExchanges] = useState([])
  useEffect(() => {
    if (!token?.symbol) return
    let cancelled = false
    fetchTokenExchanges(token.symbol).then(exs => {
      if (!cancelled) setExchanges(exs)
    })
    return () => { cancelled = true }
  }, [token?.symbol])

  return (
    <div className="cinema-hero-token" style={{ '--brand-rgb': rgb }}>
      {/* Multi-layer glow */}
      <div className="cinema-hero-glow" />
      <div className="cinema-hero-glow-secondary" />

      {/* Animated breathing chart background - matches Discover quality */}
      <div className="cinema-hero-chart-bg">
        <BreathingChartBackground
          sparklineData={sparkline}
          brandColor={rgb}
          isPositive={isPositive}
        />
      </div>

      {/* Gradient overlay for readability */}
      <div className="cinema-hero-overlay" />

      {/* Content - centered vertical Storybook stack */}
      <div className="cinema-hero-content">
        {/* Live badge */}
        <div className="cinema-hero-badge">
          <span className="cinema-hero-badge-dot" />
          {t('ticker.live')}
        </div>

        {/* Logo with glow halo */}
        <div className="cinema-hero-logo-wrap">
          <div className="cinema-hero-logo-glow" style={{ background: `rgb(${rgb})` }} />
          <img
            src={logo}
            alt={token.symbol}
            className="cinema-hero-logo"
            onError={isStockToken ? (e) => { e.target.style.opacity = '0.3' } : undefined}
          />
        </div>

        {/* Rank badge */}
        {rank && (
          <div className="cinema-hero-rank">
            <span className="cinema-hero-rank-label">RANK #{rank}</span>
            <span className="cinema-hero-rank-meta">
              {t('common.marketCap')} {mcFormatted} · Blockchain
            </span>
          </div>
        )}

        {/* HUGE Storybook title */}
        <h1 className="cinema-hero-symbol">{TOKEN_NAMES[token.symbol] || token.symbol}</h1>
        <p className="cinema-hero-tagline">{tagline}</p>

        {/* Price */}
        <div className="cinema-hero-price">
          <span className="cinema-hero-price-value">{fmtPrice(token.price)}</span>
          <span className={`cinema-hero-price-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '▲' : '▼'} {Math.abs(changeNum).toFixed(2)}%
          </span>
        </div>

        {/* Exchange badges - only shown when real data is available */}
        {exchanges.length > 0 && (
          <div className="cinema-hero-exchanges">
            <span className="cinema-hero-exchanges-label">{t('cinemaBar.tradeOn')}</span>
            <div className="cinema-hero-exchanges-list">
              {exchanges.map(ex => (
                <span key={ex} className="cinema-hero-exchange-badge">{ex}</span>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <button
          className="cinema-hero-cta"
          onClick={() => onClick?.(token)}
        >
          {t('cinemaBar.exploreStory')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Navigation dots for rotation */}
      {featuredTokens.length > 1 && (
        <div className="cinema-hero-dots">
          {featuredTokens.map((t, idx) => (
            <button
              key={t.symbol}
              className={`cinema-hero-dot ${idx === featuredIndex ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onDotClick?.(idx) }}
              style={{ '--dot-rgb': (TOKEN_ROW_COLORS[t.symbol]?.bg || '139, 92, 246') }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Full token names for Storybook-style hero title
const TOKEN_NAMES = {
  'BTC': 'Bitcoin',
  'ETH': 'Ethereum',
  'SOL': 'Solana',
  'BNB': 'BNB Chain',
  'XRP': 'Ripple',
  'ADA': 'Cardano',
  'DOGE': 'Dogecoin',
  'AVAX': 'Avalanche',
  'LINK': 'Chainlink',
  'UNI': 'Uniswap',
  'MATIC': 'Polygon',
  'ARB': 'Arbitrum',
  'OP': 'Optimism',
  'PEPE': 'Pepe',
  'SHIB': 'Shiba Inu',
  'AAVE': 'Aave',
  'MKR': 'Maker',
  'CRV': 'Curve',
  'FET': 'Fetch.AI',
  'RNDR': 'Render',
  'INJ': 'Injective',
  'SUI': 'Sui',
  'APT': 'Aptos',
  'DOT': 'Polkadot',
  'NEAR': 'Near Protocol',
  'ATOM': 'Cosmos',
  'FIL': 'Filecoin',
  'LTC': 'Litecoin',
  'TRX': 'Tron',
  'SPECTRE': 'Spectre AI',
  // Stocks
  'AAPL': 'Apple',
  'MSFT': 'Microsoft',
  'GOOGL': 'Alphabet',
  'GOOG': 'Alphabet',
  'AMZN': 'Amazon',
  'NVDA': 'NVIDIA',
  'META': 'Meta Platforms',
  'TSLA': 'Tesla',
  'AMD': 'AMD',
  'AVGO': 'Broadcom',
  'INTC': 'Intel',
  'QCOM': 'Qualcomm',
  'TSM': 'TSMC',
  'JPM': 'JPMorgan Chase',
  'V': 'Visa',
  'MA': 'Mastercard',
  'BAC': 'Bank of America',
  'GS': 'Goldman Sachs',
  'MS': 'Morgan Stanley',
  'JNJ': 'Johnson & Johnson',
  'UNH': 'UnitedHealth',
  'PFE': 'Pfizer',
  'LLY': 'Eli Lilly',
  'ABBV': 'AbbVie',
  'MRK': 'Merck',
  'WMT': 'Walmart',
  'COST': 'Costco',
  'HD': 'Home Depot',
  'NKE': 'Nike',
  'SBUX': 'Starbucks',
  'MCD': 'McDonald\'s',
  'SPY': 'S&P 500 ETF',
  'QQQ': 'Nasdaq 100 ETF',
  'NFLX': 'Netflix',
  'DIS': 'Disney',
  'CRM': 'Salesforce',
  'ORCL': 'Oracle',
  'PLTR': 'Palantir',
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOP GAINERS ROW - Special horizontal ribbon
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaTopGainersRow = ({ tokens, onClick }) => {
  const { t } = useTranslation()
  if (!tokens || tokens.length === 0) return null

  return (
    <div className="cinema-gainers-row">
      <div className="cinema-gainers-label">
        <span className="cinema-gainers-pulse" />
        {t('cinemaDiscover.topMovers24h')}
      </div>
      <div className="cinema-gainers-scroll">
        {tokens.map((t, i) => {
          const changeNum = typeof t.change === 'string' ? parseFloat(t.change) : (t.change || 0)
          const isPositive = changeNum >= 0
          const dc = getTokenDisplayColors(t.symbol)
          const rgb = dc.accent
          const logo = TOKEN_LOGOS[t.symbol] || (t.isStock ? getStockLogoUrl(t.symbol) : '')
          return (
            <button
              key={t.symbol}
              className={`cinema-gainer-chip ${isPositive ? 'positive' : 'negative'}`}
              style={{ '--brand-rgb': rgb, '--chip-index': i }}
              onClick={() => onClick?.({ symbol: t.symbol, isStock: t.isStock })}
            >
              <div className="cinema-gainer-chip-logo">
                {logo ? <img src={logo} alt={t.symbol} onError={t.isStock ? (e) => { e.target.style.display = 'none' } : undefined} /> : <span>{t.symbol[0]}</span>}
              </div>
              <span className="cinema-gainer-chip-symbol">{t.symbol}</span>
              <span className={`cinema-gainer-chip-change ${isPositive ? 'positive' : 'negative'}`}>
                {isPositive ? '+' : ''}{changeNum.toFixed(1)}%
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DISCOVERY COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaDiscovery = ({
  dayMode,
  marketMode,
  topCoinPrices,
  topCoinsTokens,
  trendingTokens,
  onChainTokens,
  selectToken,
  onOpenResearchZone,
  onOpenStorybook,
  addToWatchlist,
  isInWatchlist,
  featuredToken,
  featuredTokens = [],
  featuredIndex = 0,
  onHeroDotClick,
  renderMode,
  stockPrices,
}) => {
  const isStocks = marketMode === 'stocks'

  // Build enriched token from topCoinPrices or stockPrices
  const buildToken = useCallback((symbol) => {
    const data = isStocks ? stockPrices?.[symbol] : topCoinPrices?.[symbol]
    if (!data) return null
    return {
      symbol,
      name: data.name || symbol,
      price: data.price,
      change: data.change,
      marketCap: data.marketCap,
      volume: data.volume,
      sparkline: data.sparkline_7d || null,
      rank: data.rank,
      isStock: isStocks,
    }
  }, [topCoinPrices, stockPrices, isStocks])

  // Top Gainers - sorted by absolute change, showing biggest movers
  const topGainers = useMemo(() => {
    const priceSource = isStocks ? stockPrices : topCoinPrices
    if (!priceSource) return []
    return Object.entries(priceSource)
      .filter(([_, data]) => data?.price && data?.change != null)
      .sort((a, b) => Math.abs(parseFloat(b[1].change) || 0) - Math.abs(parseFloat(a[1].change) || 0))
      .slice(0, 12)
      .map(([symbol, data]) => ({
        symbol,
        price: data.price,
        change: data.change,
        isStock: isStocks,
      }))
  }, [topCoinPrices, stockPrices, isStocks])

  // Build category data with sparklines
  const categoryData = useMemo(() => {
    const priceSource = isStocks ? stockPrices : topCoinPrices
    if (!priceSource) return []
    const cats = isStocks ? STOCK_CATEGORIES : CATEGORIES

    return cats.map(category => {
      const tokens = category.symbols
        .map(buildToken)
        .filter(Boolean)
        .filter(t => t.price && parseFloat(t.price) > 0)

      return {
        ...category,
        tokens,
      }
    }).filter(cat => cat.tokens.length >= 2)
  }, [topCoinPrices, stockPrices, isStocks, buildToken])

  // Enriched featured token with sparkline
  const enrichedFeatured = useMemo(() => {
    if (!featuredToken) return null
    const priceSource = isStocks ? stockPrices : topCoinPrices
    if (!priceSource) return featuredToken
    const data = priceSource[featuredToken.symbol]
    if (!data) return featuredToken
    return {
      ...featuredToken,
      marketCap: data.marketCap || featuredToken.marketCap,
      volume: data.volume || featuredToken.volume,
      isStock: isStocks || featuredToken.isStock,
    }
  }, [featuredToken, topCoinPrices, stockPrices, isStocks])

  // Sparkline: prefer CoinGecko data, fallback to Binance klines
  const geckoSparkline = useMemo(() => {
    if (!featuredToken) return null
    const fromPrices = topCoinPrices?.[featuredToken.symbol]?.sparkline_7d
    const fromToken = featuredToken.sparkline_7d
    const sparkline = fromPrices || fromToken || null
    if (Array.isArray(sparkline) && sparkline.length > 10) return sparkline
    return null
  }, [featuredToken, topCoinPrices])

  // Binance klines fallback when CoinGecko sparkline is unavailable
  const [binanceSparkline, setBinanceSparkline] = useState(null)
  const binanceFetchedRef = useRef(null)

  useEffect(() => {
    if (geckoSparkline) return // CoinGecko data available, no need for Binance
    if (!featuredToken?.symbol) return

    const symbol = featuredToken.symbol
    // Reset if symbol changed
    if (binanceFetchedRef.current !== symbol) {
      setBinanceSparkline(null)
      binanceFetchedRef.current = symbol

      const now = Math.floor(Date.now() / 1000)
      const sevenDaysAgo = now - 7 * 24 * 60 * 60

      getBinanceKlines(symbol, '60', sevenDaysAgo, now)
        .then(result => {
          if (result?.getBars?.length > 10 && binanceFetchedRef.current === symbol) {
            const closePrices = result.getBars.map(b => b.c)
            setBinanceSparkline(closePrices)
          }
        })
        .catch(() => {})
    }
  }, [featuredToken?.symbol, geckoSparkline])

  const featuredSparkline = geckoSparkline || binanceSparkline

  const showHero = !renderMode || renderMode === 'hero'
  const showRows = !renderMode || renderMode === 'rows'

  return (
    <div className="cinema-discovery">
      {/* Hero Featured Token - Rotating Storybook */}
      {showHero && enrichedFeatured && (
        <CinemaHeroToken
          token={enrichedFeatured}
          sparkline={featuredSparkline}
          onClick={onOpenStorybook || selectToken}
          featuredTokens={featuredTokens}
          featuredIndex={featuredIndex}
          onDotClick={onHeroDotClick}
        />
      )}

      {/* Category Rows */}
      {showRows && (
        <div className="cinema-discovery-rows">
          {categoryData.map((category, i) => (
            <CinemaCategoryRow
              key={category.id}
              title={category.title}
              subtitle={category.subtitle}
              tokens={category.tokens}
              large={i === 0}
              onTokenClick={selectToken}
              onAddToWatchlist={addToWatchlist}
              isInWatchlist={isInWatchlist}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default CinemaDiscovery
