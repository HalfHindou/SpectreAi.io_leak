/**
 * DiscoverPage - CINEMATIC EDITORIAL V3
 * Matches the TokenStorybook aesthetic
 *
 * Features:
 * - Full-screen breathing chart backgrounds
 * - Editorial typography (Playfair Display)
 * - Cinema mode cards that preview the storybook experience
 * - Immersive scrolling with parallax
 * - Documentary-style token presentations
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useTranslation } from 'react-i18next'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { getStockQuotes, getStockLogoUrl, POPULAR_STOCKS, FALLBACK_STOCK_DATA } from '@/services/stockApi'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import spectreIcons from '@/icons/spectreIcons'
import TokenStorybook from '@/components/token-storybook'
import TokenBottomSheet from '@/components/mobile/token-bottom-sheet'
import { useCurrency } from '@/hooks/useCurrency'
import ShareXButton from '@/components/share-x-button'
import ShareXModal from '@/components/share-x-modal'
import FreshnessTag from '@/components/freshness-tag'
import { renderShareCard, preloadLogos, roundRect, drawCardDivider, formatLargeNumber, getSpectreLogo, generateSparkline, FONT, FONT_MONO, CARD_PAD } from '@/lib/shareToX'
import useDiscoverXDash from './use-discover-xdash'
import DiscoverSocialPulse from './discover-social-pulse'
import DiscoverSocialBadge from './discover-social-badge'
import './discover-page.css'
import './discover-page.mobile.css'

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN STORIES DATA (subset for discover preview)
// ═══════════════════════════════════════════════════════════════════════════════

const TOKEN_TAGLINES = {
  BTC: { tagline: 'Digital Gold', description: 'The original cryptocurrency and store of value' },
  ETH: { tagline: 'World Computer', description: 'Powering decentralized applications worldwide' },
  SOL: { tagline: 'Speed of Light', description: 'High-performance blockchain for DeFi and NFTs' },
  XRP: { tagline: 'Global Payments', description: 'Enterprise-grade cross-border settlement' },
  DOGE: { tagline: 'The People\'s Coin', description: 'Community-driven digital currency' },
  ADA: { tagline: 'Third Generation', description: 'Research-driven blockchain platform' },
  AVAX: { tagline: 'Blazing Fast', description: 'Sub-second finality for DeFi applications' },
  DOT: { tagline: 'Connected Chains', description: 'Multi-chain interoperability protocol' },
  LINK: { tagline: 'Oracle Network', description: 'Connecting smart contracts to real-world data' },
  MATIC: { tagline: 'Ethereum Scaled', description: 'Layer 2 scaling for mass adoption' },
  UNI: { tagline: 'DeFi Pioneer', description: 'The leading decentralized exchange protocol' },
  SHIB: { tagline: 'Meme Powerhouse', description: 'Community token with growing ecosystem' },
  LTC: { tagline: 'Digital Silver', description: 'Fast and lightweight peer-to-peer payments' },
  ATOM: { tagline: 'Internet of Blockchains', description: 'Sovereign interoperable blockchains' },
  ARB: { tagline: 'Optimistic Rollup', description: 'Leading Ethereum Layer 2 by TVL' },
  OP: { tagline: 'Superchain Vision', description: 'Scaling Ethereum with optimistic rollups' },
  NEAR: { tagline: 'Chain Abstraction', description: 'User-friendly blockchain platform' },
  FIL: { tagline: 'Decentralized Storage', description: 'Incentivized file storage network' },
  APT: { tagline: 'Move Smart Contracts', description: 'Next-gen Layer 1 with parallel execution' },
  INJ: { tagline: 'DeFi Unlocked', description: 'Interoperable DeFi-optimized blockchain' },
}

const STOCK_TAGLINES = {
  AAPL: { tagline: 'Think Different', description: 'Consumer tech giant with unmatched ecosystem' },
  MSFT: { tagline: 'Cloud & AI Leader', description: 'Enterprise software and cloud computing titan' },
  GOOGL: { tagline: 'Organizing Information', description: 'Search, cloud, and AI innovation powerhouse' },
  AMZN: { tagline: 'Everything Store', description: 'E-commerce and cloud infrastructure leader' },
  NVDA: { tagline: 'AI Chip Pioneer', description: 'Powering the artificial intelligence revolution' },
  TSLA: { tagline: 'Accelerating EVs', description: 'Electric vehicles, energy, and autonomy' },
  META: { tagline: 'Connecting Billions', description: 'Social platforms and metaverse technology' },
  JPM: { tagline: 'Banking Titan', description: 'Global leader in investment and commercial banking' },
  V: { tagline: 'Payments Everywhere', description: 'World\'s largest electronic payments network' },
  MA: { tagline: 'Priceless Network', description: 'Global payment technology and processing' },
  AMD: { tagline: 'High Performance', description: 'CPUs, GPUs, and data center acceleration' },
  NFLX: { tagline: 'Stream Everything', description: 'Global entertainment streaming platform' },
  DIS: { tagline: 'Magic & Storytelling', description: 'Entertainment, parks, and streaming empire' },
  JNJ: { tagline: 'Healthcare Pioneer', description: 'Pharmaceutical and medical device leader' },
  WMT: { tagline: 'Everyday Low Prices', description: 'World\'s largest retailer by revenue' },
  SPY: { tagline: 'S&P 500 Tracker', description: 'The benchmark US large-cap index fund' },
  QQQ: { tagline: 'Tech-Heavy 100', description: 'Nasdaq 100 index tracking fund' },
  XOM: { tagline: 'Energy Major', description: 'Integrated oil and gas supermajor' },
  GS: { tagline: 'Wall Street Icon', description: 'Global investment banking and securities' },
  BA: { tagline: 'Aerospace Giant', description: 'Commercial aircraft and defense systems' },
}

const getTokenTagline = (symbol, isStock = false, t) => {
  if (isStock) {
    return STOCK_TAGLINES[symbol?.toUpperCase()] || {
      tagline: t ? t('discover.fallback.publicCompany', 'Public Company') : 'Public Company',
      description: t ? t('discover.fallback.nyseListed', 'NYSE / NASDAQ Listed') : 'NYSE / NASDAQ Listed'
    }
  }
  return TOKEN_TAGLINES[symbol?.toUpperCase()] || {
    tagline: t ? t('discover.fallback.digitalAsset', 'Digital Asset') : 'Digital Asset',
    description: t ? t('discover.fallback.crypto', 'Cryptocurrency') : 'Cryptocurrency'
  }
}

const STOCK_DISCOVER_CATEGORIES = [
  {
    id: 'mag7',
    title: 'Magnificent 7',
    subtitle: 'The market\'s power players',
    symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'],
  },
  {
    id: 'ai-semi',
    title: 'AI & Semiconductors',
    subtitle: 'The future of intelligence',
    symbols: ['NVDA', 'AMD', 'INTC', 'AVGO', 'CRM', 'ADBE', 'ORCL'],
  },
  {
    id: 'finance',
    title: 'Big Finance',
    subtitle: 'Wall Street heavyweights',
    symbols: ['JPM', 'V', 'MA', 'BAC', 'GS', 'MS', 'PYPL', 'COIN'],
  },
  {
    id: 'healthcare',
    title: 'Healthcare Giants',
    subtitle: 'Innovation in medicine',
    symbols: ['JNJ', 'UNH', 'PFE', 'LLY', 'ABBV', 'MRK'],
  },
  {
    id: 'consumer',
    title: 'Consumer Favorites',
    subtitle: 'Brands you know and love',
    symbols: ['WMT', 'COST', 'HD', 'NKE', 'SBUX', 'MCD', 'KO', 'PEP'],
  },
  {
    id: 'energy',
    title: 'Energy & Commodities',
    subtitle: 'Power and resources',
    symbols: ['XOM', 'CVX', 'COP', 'GLD', 'SLV'],
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATED BREATHING CHART BACKGROUND - Matches storybook style
// ═══════════════════════════════════════════════════════════════════════════════

const BreathingChartBackground = React.memo(({ sparklineData, brandColor, isPositive }) => {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)

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
      // Retry after a short delay if parent not ready
      const retryTimeout = setTimeout(() => resize(), 50)
      return () => clearTimeout(retryTimeout)
    }

    window.addEventListener('resize', resize)

    let time = 0
    const rgb = brandColor || (isPositive ? '34, 197, 94' : '239, 68, 68')

    // 2026-05-26 beta-quality fix: when real sparkline data is missing, use a deterministic
    // smooth sine wave instead of Math.random() noise. The previous synthetic line looked
    // like a real price chart, which is misleading on a token hero card where users expect
    // every line to be live data.
    const chartData = sparklineData?.length > 10
      ? sparklineData
      : (() => {
          const points = []
          for (let i = 0; i < 48; i++) {
            // Pure decorative wave — clearly ambient, not price action
            points.push(50 + Math.sin(i * 0.35) * 10 + Math.sin(i * 0.11) * 4)
          }
          return points
        })()

    const draw = () => {
      const w = currentWidth
      const h = currentHeight
      if (w === 0 || h === 0) {
        animationRef.current = requestAnimationFrame(draw)
        return
      }

      ctx.clearRect(0, 0, w, h)

      const breathe = Math.sin(time * 0.025) * 0.12 + 1
      const verticalShift = Math.sin(time * 0.018) * 10

      {
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
            // Fill area under curve
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
            // Glow lines
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

        // Outer glow
        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize + 12, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${rgb}, ${0.15 + Math.sin(time * 0.1) * 0.08})`
        ctx.fill()

        // Middle ring
        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize + 5, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${rgb}, ${0.3 + Math.sin(time * 0.1) * 0.12})`
        ctx.fill()

        // Core dot
        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${rgb})`
        ctx.shadowColor = `rgba(${rgb}, 0.7)`
        ctx.shadowBlur = 15
        ctx.fill()
        ctx.shadowBlur = 0

        // White center
        ctx.beginPath()
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
      }

      time++
      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      window.removeEventListener('resize', resize)
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [sparklineData, brandColor, isPositive])

  return <canvas ref={canvasRef} className="breathing-chart-canvas" />
})

// ═══════════════════════════════════════════════════════════════════════════════
// CINEMATIC HERO CARD - Editorial style featured token
// ═══════════════════════════════════════════════════════════════════════════════

const CinematicHeroCard = React.memo(({ token, onClick, brandColor, lastUpdated }) => {
  const { fmtPrice } = useCurrency()
  const { t } = useTranslation()
  const symbol = (token?.symbol || '').toUpperCase()
  const isStock = token?.isStock || false
  const taglineData = getTokenTagline(symbol, isStock, t)
  const change = token?.price_change_percentage_24h ?? token?.change ?? 0
  const isPositive = change >= 0
  const rgb = brandColor || '245, 245, 247'

  return (
    <div
      className="cinematic-hero-card"
      onClick={() => onClick?.(token)}
      style={{ '--brand-rgb': rgb }}
    >
      {/* Breathing chart background */}
      <div className="cinematic-hero-chart-bg">
        <BreathingChartBackground
          sparklineData={token?.sparkline_in_7d?.price}
          brandColor={rgb}
          isPositive={isPositive}
        />
      </div>

      {/* Gradient overlay */}
      <div className="cinematic-hero-overlay" />

      {/* Content */}
      <div className="cinematic-hero-content">
        {/* Freshness badge — tied to actual token data refresh, not a static "Live". */}
        <div className="cinematic-hero-live">
          <FreshnessTag timestamp={lastUpdated} tier="hot" label={t('discover.live', 'Live')} />
        </div>

        {/* Logo */}
        <div className="cinematic-hero-logo-wrap">
          <div className="cinematic-hero-logo-glow" style={{ background: `rgb(${rgb})` }} />
          <img
            src={isStock ? (token?.logo || getStockLogoUrl(symbol)) : token?.image}
            alt={symbol}
            className={`cinematic-hero-logo ${isStock ? 'cinematic-hero-logo--stock' : ''}`}
          />
        </div>

        {/* Rank / Sector */}
        {isStock ? (
          token?.sector && (
            <div className="cinematic-hero-rank" style={{ color: `rgb(${rgb})` }}>
              {token.sector.toUpperCase()} · {token.exchange || 'NYSE'}
            </div>
          )
        ) : (
          token?.market_cap_rank && (
            <div className="cinematic-hero-rank" style={{ color: `rgb(${rgb})` }}>
              {t('common.rank').toUpperCase()} #{token.market_cap_rank}
            </div>
          )
        )}

        {/* Title - Editorial style */}
        <h1 className="cinematic-hero-title">{token?.name}</h1>
        <p className="cinematic-hero-tagline">{taglineData.tagline}</p>

        {/* Price */}
        <div className="cinematic-hero-price-section">
          <span className="cinematic-hero-price">{fmtPrice(isStock ? token?.price : token?.current_price)}</span>
          <span className={`cinematic-hero-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
          </span>
        </div>

        {/* Description */}
        <p className="cinematic-hero-description">{taglineData.description}</p>

        {/* CTA */}
        <button className="cinematic-hero-cta" style={{ background: `rgb(${rgb})` }}>
          {t('discover.exploreStory')} →
        </button>
      </div>

      {/* Corner accents */}
      <div className="cinematic-hero-corner tl" style={{ borderColor: `rgba(${rgb}, 0.4)` }} />
      <div className="cinematic-hero-corner br" style={{ borderColor: `rgba(${rgb}, 0.4)` }} />
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// CINEMA TOKEN CARD - Storybook preview style
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaTokenCard = React.memo(({ token, index, onClick, onAddToWatchlist, isInWatchlist, socialEntry }) => {
  const { fmtPrice } = useCurrency()
  const { t } = useTranslation()
  const symbol = (token?.symbol || '').toUpperCase()
  const isStock = token?.isStock || false
  const colors = TOKEN_ROW_COLORS[symbol]
  const taglineData = getTokenTagline(symbol, isStock, t)
  const change = token?.price_change_percentage_24h ?? token?.change ?? 0
  const isPositive = change >= 0
  const rgb = colors?.bg || '245, 245, 247'
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      className={`cinema-token-card ${isHovered ? 'hovered' : ''}`}
      style={{ '--brand-rgb': rgb, '--card-index': index }}
      onClick={() => onClick?.(token)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Breathing chart on hover */}
      <div className="cinema-card-chart">
        {isHovered && (
          <BreathingChartBackground
            sparklineData={token?.sparkline_in_7d?.price?.slice(-48)}
            brandColor={rgb}
            isPositive={isPositive}
          />
        )}
      </div>

      {/* Gradient overlay */}
      <div className="cinema-card-overlay" />

      {/* Glow effect */}
      <div className="cinema-card-glow" />

      {/* Content */}
      <div className="cinema-card-content">
        {/* Logo with ring */}
        <div className="cinema-card-logo-section">
          <div className="cinema-card-ring" style={{ borderColor: `rgba(${rgb}, 0.5)` }} />
          <img
            src={isStock ? (token?.logo || getStockLogoUrl(symbol)) : token?.image}
            alt={symbol}
            className={`cinema-card-logo ${isStock ? 'cinema-card-logo--stock' : ''}`}
            loading="lazy"
          />
        </div>

        {/* Info */}
        <div className="cinema-card-info">
          <span className="cinema-card-symbol">{symbol}</span>
          <span className="cinema-card-name">{token?.name}</span>
          {isHovered && (
            <span className="cinema-card-tagline">{taglineData.tagline}</span>
          )}
          {isStock && token?.sector && (
            <span className="cinema-card-sector">{token.sector}</span>
          )}
        </div>

        {/* Price section */}
        <div className="cinema-card-price-section">
          <span className="cinema-card-price">{fmtPrice(isStock ? token?.price : token?.current_price)}</span>
          <span className={`cinema-card-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '+' : ''}{(typeof change === 'number' ? change : 0).toFixed(2)}%
          </span>
        </div>

        {/* Rank badge for top 10 */}
        {token?.market_cap_rank && token.market_cap_rank <= 10 && (
          <div className="cinema-card-rank">#{token.market_cap_rank}</div>
        )}

        {/* Social-momentum whisper — only for tokens with notable X chatter */}
        {socialEntry && <DiscoverSocialBadge entry={socialEntry} />}

        {/* Hover reveal */}
        {isHovered && (
          <div className="cinema-card-hover-reveal">
            <span className="cinema-card-explore">{t('discover.viewStory')} →</span>
          </div>
        )}
      </div>

      {/* Watchlist button */}
      <button
        className={`cinema-card-watchlist ${isInWatchlist?.(token) ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onAddToWatchlist?.(token)
        }}
        aria-label={isInWatchlist?.(token) ? t('watchlist.removeAria', { symbol: token.symbol, defaultValue: `Remove ${token.symbol} from watchlist` }) : t('watchlist.addAria', { symbol: token.symbol, defaultValue: `Add ${token.symbol} to watchlist` })}
      >
        {spectreIcons.star}
      </button>
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY ROW - Editorial section headers
// ═══════════════════════════════════════════════════════════════════════════════

const DISCOVER_CATEGORIES = [
  {
    id: 'trending',
    title: 'Trending Now',
    subtitle: 'Hottest movers today',
    filter: (tokens) => [...tokens].sort((a, b) =>
      Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0)
    ).slice(0, 12),
  },
  {
    id: 'layer1',
    title: 'Layer 1 Blockchains',
    subtitle: 'The foundation of crypto',
    symbols: ['BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'NEAR', 'APT', 'SUI', 'TON', 'DOT', 'ATOM'],
  },
  {
    id: 'defi',
    title: 'DeFi Protocols',
    subtitle: 'Decentralized finance',
    symbols: ['UNI', 'AAVE', 'MKR', 'CRV', 'LDO', 'LINK', 'INJ', 'GRT'],
  },
  {
    id: 'meme',
    title: 'Meme Season',
    subtitle: 'Community driven',
    symbols: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI'],
  },
  {
    id: 'ai',
    title: 'AI & Compute',
    subtitle: 'The future of intelligence',
    symbols: ['TAO', 'FET', 'RNDR', 'NEAR', 'GRT'],
  },
]

const CATEGORY_I18N_MAP = {
  trending: { title: 'welcome.trendingNow', subtitle: 'discover.hottestMovers' },
  layer1: { title: 'discover.layer1Blockchains', subtitle: 'discover.foundationOfCrypto' },
  defi: { title: 'discover.defiProtocols', subtitle: 'discover.decentralizedFinance' },
  meme: { title: 'discover.memeSeason', subtitle: 'discover.communityDriven' },
  ai: { title: 'discover.aiAndCompute', subtitle: 'discover.futureOfIntelligence' },
  mag7: { title: 'discover.magnificent7', subtitle: 'discover.magnificent7Sub' },
  'ai-semi': { title: 'discover.aiSemiconductors', subtitle: 'discover.aiSemiconductorsSub' },
  finance: { title: 'discover.bigFinance', subtitle: 'discover.bigFinanceSub' },
  healthcare: { title: 'discover.healthcareGiants', subtitle: 'discover.healthcareGiantsSub' },
  consumer: { title: 'discover.consumerFavorites', subtitle: 'discover.consumerFavoritesSub' },
  energy: { title: 'discover.energyCommodities', subtitle: 'discover.energyCommoditiesSub' },
}

const CategoryRow = ({ category, tokens, onTokenClick, onAddToWatchlist, isInWatchlist, isMobile = false, socialLookup }) => {
  const { t } = useTranslation()
  const scrollRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const checkScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
    setCanScrollLeft(scrollLeft > 20)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 20)
  }, [])

  useEffect(() => {
    checkScroll()
  }, [tokens, checkScroll])

  const scroll = (direction) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: direction === 'left' ? -400 : 400, behavior: 'smooth' })
  }

  return (
    <section className="category-row">
      <div className="category-header">
        <div className="category-title-group">
          <h2 className="category-title">{CATEGORY_I18N_MAP[category.id] ? t(CATEGORY_I18N_MAP[category.id].title) : category.title}</h2>
          <span className="category-subtitle">{CATEGORY_I18N_MAP[category.id] ? t(CATEGORY_I18N_MAP[category.id].subtitle) : category.subtitle}</span>
        </div>
        {!isMobile && (
          <div className="category-nav">
            <button
              className={`category-arrow ${!canScrollLeft ? 'disabled' : ''}`}
              onClick={() => scroll('left')}
              disabled={!canScrollLeft}
              aria-label={t('discover.scrollLeftAria', 'Scroll categories left')}
            >
              ←
            </button>
            <button
              className={`category-arrow ${!canScrollRight ? 'disabled' : ''}`}
              onClick={() => scroll('right')}
              disabled={!canScrollRight}
              aria-label={t('discover.scrollRightAria', 'Scroll categories right')}
            >
              →
            </button>
          </div>
        )}
      </div>

      <div
        className="category-scroll"
        ref={scrollRef}
        onScroll={checkScroll}
      >
        {tokens.map((token, idx) => (
          <CinemaTokenCard
            key={token.id || token.symbol}
            token={token}
            index={idx}
            onClick={onTokenClick}
            onAddToWatchlist={onAddToWatchlist}
            isInWatchlist={isInWatchlist}
            socialEntry={socialLookup ? socialLookup(token) : null}
          />
        ))}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DISCOVER PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const DiscoverPage = ({
  dayMode = false,
  isMobile = false,
  selectToken,
  onOpenResearchZone,
  addToWatchlist,
  isInWatchlist,
  marketMode = 'crypto',
}) => {
  const isStocks = marketMode === 'stocks'
  const { t } = useTranslation()

  const [allTokens, setAllTokens] = useState([])
  // FreshnessTag timestamp — updated on every successful token fetch.
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [featuredIndex, setFeaturedIndex] = useState(0)

  const { fmtPrice: discoverFmtPrice, fmtLarge } = useCurrency()

  // Storybook state
  const [storybookToken, setStorybookToken] = useState(null)
  const [isStorybookOpen, setIsStorybookOpen] = useState(false)

  // Share state
  const [isDiscoverShareExporting, setIsDiscoverShareExporting] = useState(false)
  const [discoverShareModalOpen, setDiscoverShareModalOpen] = useState(false)
  const [discoverShareImageUrl, setDiscoverShareImageUrl] = useState(null)
  const [discoverShareDescription, setDiscoverShareDescription] = useState('')

  // Fetch tokens - crypto or stock depending on mode
  useEffect(() => {
    let cancelled = false

    const fetchCrypto = async () => {
      try {
        setFetchError(null)
        // 2026-05-26 beta-quality fix: removed instant fallback render that
        // displayed STALE hardcoded prices (BTC $78,450, ETH $2,330) on every
        // first load before live data arrived. Show shimmer skeleton instead.
        const data = await Promise.race([
          getTopCoinsMarketsPage(1, 100),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), 8000)),
        ])
        if (!cancelled && data?.length > 0) { setAllTokens(data); setLastUpdated(Date.now()) }
      } catch (err) {
        // silently handled
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const fetchStocks = async () => {
      // 2026-05-26 beta-quality fix: removed instant-fallback render that pushed
      // 150+ stock cards with price=0 / change=0 / marketCap=0 on every first load.
      // FALLBACK_STOCK_DATA had its numeric fields stripped (see services/stockApi.js
      // module init) so the fallback was a wall of $0.00. Show shimmer skeleton and
      // wait for live quotes instead.
      try {
        const allSymbols = POPULAR_STOCKS.map(s => s.symbol)
        const quotes = await getStockQuotes(allSymbols)
        if (cancelled) return
        if (Object.keys(quotes).length > 0) {
          const liveTokens = POPULAR_STOCKS.map((stock, index) => {
            const q = quotes[stock.symbol]
            const fb = FALLBACK_STOCK_DATA[stock.symbol]
            return {
              id: stock.symbol,
              symbol: stock.symbol,
              name: q?.name || stock.name,
              image: getStockLogoUrl(stock.symbol),
              logo: getStockLogoUrl(stock.symbol),
              current_price: q?.price || fb?.price || 0,
              price: q?.price || fb?.price || 0,
              price_change_percentage_24h: q?.change || fb?.change || 0,
              change: q?.change || fb?.change || 0,
              market_cap: q?.marketCap || fb?.marketCap || 0,
              marketCap: q?.marketCap || fb?.marketCap || 0,
              total_volume: q?.volume || fb?.volume || 0,
              market_cap_rank: index + 1,
              sector: q?.sector || stock.sector || '',
              exchange: q?.exchange || stock.exchange || '',
              pe: q?.pe || fb?.pe || null,
              isStock: true,
            }
          })
          setAllTokens(liveTokens); setLastUpdated(Date.now())
        }
      } catch (err) {
        // silently handled
      } finally {
        // 2026-05-26 beta-quality fix: clear loading flag for stocks path so the
        // shimmer doesn't hang forever when live quotes fail or return empty.
        if (!cancelled) setLoading(false)
      }
    }

    if (isStocks) {
      fetchStocks()
    } else {
      fetchCrypto()
    }

    return () => { cancelled = true }
  }, [isStocks])

  // Polling callback for token refresh (no cancelled guard - useAdaptivePolling handles lifecycle)
  const pollDiscoverTokens = useCallback(async () => {
    if (isStocks) {
      try {
        const allSymbols = POPULAR_STOCKS.map(s => s.symbol)
        const quotes = await getStockQuotes(allSymbols)
        if (Object.keys(quotes).length > 0) {
          const liveTokens = POPULAR_STOCKS.map((stock, index) => {
            const q = quotes[stock.symbol]
            const fb = FALLBACK_STOCK_DATA[stock.symbol]
            return {
              id: stock.symbol, symbol: stock.symbol, name: q?.name || stock.name,
              image: getStockLogoUrl(stock.symbol), logo: getStockLogoUrl(stock.symbol),
              current_price: q?.price || fb?.price || 0, price: q?.price || fb?.price || 0,
              price_change_percentage_24h: q?.change || fb?.change || 0, change: q?.change || fb?.change || 0,
              market_cap: q?.marketCap || fb?.marketCap || 0, marketCap: q?.marketCap || fb?.marketCap || 0,
              total_volume: q?.volume || fb?.volume || 0, market_cap_rank: index + 1,
              sector: q?.sector || stock.sector || '', exchange: q?.exchange || stock.exchange || '',
              pe: q?.pe || fb?.pe || null, isStock: true,
            }
          })
          setAllTokens(liveTokens); setLastUpdated(Date.now())
        }
      } catch {}
    } else {
      try {
        const data = await getTopCoinsMarketsPage(1, 100)
        if (data?.length > 0) { setAllTokens(data); setLastUpdated(Date.now()) }
      } catch {}
    }
  }, [isStocks])

  // Adaptive polling for discover token data
  useAdaptivePolling(pollDiscoverTokens, { interval: isStocks ? 2 * 60 * 1000 : 60000 })

  // X-Dash social momentum — crypto only (the leaderboard is crypto-native).
  // Stocks mode skips the fetch entirely.
  const social = useDiscoverXDash({ enabled: !isStocks })
  const socialLookup = social.lookup

  // Featured tokens (top 5)
  const featuredTokens = useMemo(() => {
    if (isStocks) {
      // Featured stocks: AAPL, NVDA, MSFT, TSLA, AMZN
      const featured = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN']
      return featured.map(sym => allTokens.find(t => (t.symbol || '').toUpperCase() === sym)).filter(Boolean)
    }
    return allTokens.slice(0, 5)
  }, [allTokens, isStocks])
  const featuredToken = featuredTokens[featuredIndex % (featuredTokens.length || 1)]
  const featuredColors = TOKEN_ROW_COLORS[(featuredToken?.symbol || '').toUpperCase()]

  // Auto-rotate featured
  useEffect(() => {
    if (featuredTokens.length <= 1) return
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setFeaturedIndex(prev => (prev + 1) % featuredTokens.length)
    }, 10000)
    return () => clearInterval(interval)
  }, [featuredTokens.length])

  // Reset featured index on mode change
  useEffect(() => { setFeaturedIndex(0) }, [isStocks])

  // Build category data
  const activeCategories = isStocks ? STOCK_DISCOVER_CATEGORIES : DISCOVER_CATEGORIES

  const categoryData = useMemo(() => {
    if (!allTokens.length) return {}
    const result = {}
    activeCategories.forEach(cat => {
      if (cat.filter) {
        result[cat.id] = cat.filter(allTokens)
      } else if (cat.symbols) {
        result[cat.id] = cat.symbols
          .map(sym => allTokens.find(t => (t.symbol || '').toUpperCase() === sym))
          .filter(Boolean)
      }
    })
    return result
  }, [allTokens, activeCategories])

  // Token click -> open storybook
  const handleTokenClick = useCallback((token) => {
    setStorybookToken(token)
    setIsStorybookOpen(true)
  }, [])

  const handleStorybookClose = useCallback(() => {
    setIsStorybookOpen(false)
  }, [])

  const handleStorybookWatchlist = useCallback((token) => {
    const isStock = token?.isStock || false
    addToWatchlist?.({
      symbol: (token.symbol || '').toUpperCase(),
      name: token.name,
      logo: isStock ? (token.logo || getStockLogoUrl(token.symbol)) : token.image,
      price: isStock ? token.price : token.current_price,
      change: isStock ? token.change : token.price_change_percentage_24h,
      marketCap: isStock ? token.marketCap : token.market_cap,
      pinned: false,
      isStock,
      sector: token.sector || '',
    })
  }, [addToWatchlist])

  const checkIsInWatchlist = useCallback((token) => {
    if (!isInWatchlist) return false
    return isInWatchlist({ symbol: (token?.symbol || '').toUpperCase() })
  }, [isInWatchlist])

  const handleAddToWatchlist = useCallback((token) => {
    const isStock = token?.isStock || false
    addToWatchlist?.({
      symbol: (token.symbol || '').toUpperCase(),
      name: token.name,
      logo: isStock ? (token.logo || getStockLogoUrl(token.symbol)) : token.image,
      price: isStock ? token.price : token.current_price,
      change: isStock ? token.change : token.price_change_percentage_24h,
      marketCap: isStock ? token.marketCap : token.market_cap,
      pinned: false,
      isStock,
      sector: token.sector || '',
    })
  }, [addToWatchlist])

  // ── Share Discover to X ──
  const handleShareDiscover = useCallback(async () => {
    if (isDiscoverShareExporting) return
    setIsDiscoverShareExporting(true)
    setDiscoverShareImageUrl(null)
    setDiscoverShareModalOpen(true)

    try {
      const tokens = featuredTokens.slice(0, 8)
      const modeLabel = isStocks ? 'Stock' : 'Crypto'

      // Build tweet description
      const topList = tokens.slice(0, 5).map((tk, i) => {
        const sym = (tk.symbol || '').toUpperCase()
        const ch = isStocks ? (tk.change || 0) : (tk.price_change_percentage_24h || 0)
        return `${i + 1}. $${sym} ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`
      }).join('\n')
      setDiscoverShareDescription(`🎬 ${modeLabel} Discovery\n\n${topList}\n\n@Spectre__Ai #crypto`)

      // Pre-load logos + Spectre logo
      const [logoMap, spectreLogo] = await Promise.all([
        preloadLogos(
          tokens.map(tk => ({ symbol: (tk.symbol || '').toUpperCase() })),
          (tk) => isStocks ? getStockLogoUrl(tk.symbol) : allTokens.find(t => (t.symbol || '').toUpperCase() === tk.symbol)?.image
        ),
        getSpectreLogo(),
      ])

      // Get sparkline data for background chart (from first token)
      const heroToken = tokens[0]
      const heroSym = (heroToken?.symbol || '').toUpperCase()
      const heroBrandRgb = TOKEN_ROW_COLORS[heroSym]?.bg || '245, 245, 247'
      const sparkData = heroToken?.sparkline_in_7d?.price?.slice(-48) || generateSparkline(0, 48)

      const dataUrl = renderShareCard(
        (ctx, w, contentTop, c, fonts) => {
          const pad = CARD_PAD
          let y = contentTop + 6

          // ── Cinematic chart background ──
          if (sparkData.length > 2) {
            const chartMin = Math.min(...sparkData)
            const chartMax = Math.max(...sparkData)
            const chartRange = chartMax - chartMin || 1
            const chartTop = contentTop - 10
            const chartH = 380
            const chartW = w

            // Chart fill area
            ctx.save()
            ctx.beginPath()
            sparkData.forEach((val, i) => {
              const x = (i / (sparkData.length - 1)) * chartW
              const ny = (val - chartMin) / chartRange
              const cy = chartTop + chartH - (ny * chartH * 0.55) - chartH * 0.15
              if (i === 0) ctx.moveTo(x, cy); else ctx.lineTo(x, cy)
            })
            ctx.lineTo(chartW, chartTop + chartH)
            ctx.lineTo(0, chartTop + chartH)
            ctx.closePath()
            const chartFill = ctx.createLinearGradient(0, chartTop, 0, chartTop + chartH)
            chartFill.addColorStop(0, `rgba(${heroBrandRgb}, ${c.isLight ? 0.06 : 0.12})`)
            chartFill.addColorStop(0.6, `rgba(${heroBrandRgb}, ${c.isLight ? 0.02 : 0.04})`)
            chartFill.addColorStop(1, 'transparent')
            ctx.fillStyle = chartFill
            ctx.fill()

            // Chart line
            ctx.beginPath()
            sparkData.forEach((val, i) => {
              const x = (i / (sparkData.length - 1)) * chartW
              const ny = (val - chartMin) / chartRange
              const cy = chartTop + chartH - (ny * chartH * 0.55) - chartH * 0.15
              if (i === 0) ctx.moveTo(x, cy); else ctx.lineTo(x, cy)
            })
            ctx.strokeStyle = `rgba(${heroBrandRgb}, ${c.isLight ? 0.18 : 0.30})`
            ctx.lineWidth = 1.5
            ctx.stroke()
            ctx.restore()
          }

          // ── Ambient cinematic glow ──
          const ambGlow = ctx.createRadialGradient(w * 0.3, y + 100, 0, w * 0.3, y + 100, 300)
          ambGlow.addColorStop(0, c.isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.04)')
          ambGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = ambGlow
          ctx.fillRect(0, contentTop, w, 500)

          // ── Token rows ──
          const rowH = 48
          const rowGap = 4
          tokens.forEach((tk, i) => {
            const sym = (tk.symbol || '').toUpperCase()
            const price = isStocks ? tk.price : tk.current_price
            const ch = isStocks ? (tk.change || 0) : (tk.price_change_percentage_24h || 0)
            const mcap = isStocks ? tk.marketCap : tk.market_cap
            const brandRgb = TOKEN_ROW_COLORS[sym]?.bg || '245, 245, 247'
            const ry = y + i * (rowH + rowGap)

            // Row background with glass effect
            roundRect(ctx, pad, ry, w - pad * 2, rowH, 8)
            const rowBg = ctx.createLinearGradient(pad, ry, w - pad, ry + rowH)
            if (i % 2 === 0) {
              rowBg.addColorStop(0, c.isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.028)')
              rowBg.addColorStop(1, c.isLight ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.012)')
            } else {
              rowBg.addColorStop(0, c.isLight ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.015)')
              rowBg.addColorStop(1, c.isLight ? 'rgba(0,0,0,0.005)' : 'rgba(255,255,255,0.005)')
            }
            ctx.fillStyle = rowBg
            ctx.fill()

            // Glass shimmer top edge
            ctx.fillStyle = c.isLight ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.04)'
            ctx.fillRect(pad + 8, ry, w - pad * 2 - 16, 0.5)

            // Subtle row border
            roundRect(ctx, pad, ry, w - pad * 2, rowH, 8)
            ctx.strokeStyle = c.isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'
            ctx.lineWidth = 0.5
            ctx.stroke()

            // Rank
            ctx.textAlign = 'left'
            ctx.font = `500 10px ${fonts.mono}`
            ctx.fillStyle = c.rank
            ctx.fillText(`${i + 1}`, pad + 10, ry + rowH / 2 + 4)

            // Logo
            const logoSize = 28
            const logoX = pad + 30
            const logoCY = ry + rowH / 2
            const logo = logoMap[sym]
            if (logo) {
              ctx.save()
              ctx.beginPath()
              ctx.arc(logoX + logoSize / 2, logoCY, logoSize / 2, 0, Math.PI * 2)
              ctx.clip()
              ctx.drawImage(logo, logoX, logoCY - logoSize / 2, logoSize, logoSize)
              ctx.restore()
              ctx.beginPath()
              ctx.arc(logoX + logoSize / 2, logoCY, logoSize / 2, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(${brandRgb}, 0.20)`
              ctx.lineWidth = 1
              ctx.stroke()
            } else {
              ctx.beginPath()
              ctx.arc(logoX + logoSize / 2, logoCY, logoSize / 2, 0, Math.PI * 2)
              ctx.fillStyle = c.fallbackBg
              ctx.fill()
              ctx.font = `600 11px ${fonts.body}`
              ctx.fillStyle = c.fallbackText
              ctx.textAlign = 'center'
              ctx.fillText(sym.charAt(0), logoX + logoSize / 2, logoCY + 4)
            }

            // Symbol + name
            ctx.textAlign = 'left'
            ctx.font = `700 13px ${fonts.body}`
            ctx.fillStyle = c.symbol
            ctx.fillText(sym, logoX + logoSize + 10, logoCY - 2)
            ctx.font = `400 10px ${fonts.body}`
            ctx.fillStyle = c.name
            const nameText = tk.name || ''
            ctx.fillText(nameText.length > 18 ? nameText.slice(0, 18) + '\u2026' : nameText, logoX + logoSize + 10, logoCY + 12)

            // Price (right-aligned)
            ctx.textAlign = 'right'
            ctx.font = `600 13px ${fonts.mono}`
            ctx.fillStyle = c.price
            const priceTxt = price != null ? discoverFmtPrice(price) : '-'
            ctx.fillText(priceTxt, w - pad - 80, logoCY - 2)

            // Change %
            ctx.font = `600 12px ${fonts.mono}`
            ctx.fillStyle = ch >= 0 ? c.bull : c.bear
            ctx.fillText(`${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`, w - pad - 10, logoCY - 2)

            // Market cap
            if (mcap) {
              ctx.font = `400 9px ${fonts.mono}`
              ctx.fillStyle = c.muted
              ctx.fillText(formatLargeNumber(mcap), w - pad - 10, logoCY + 12)
            }
          })

          y += tokens.length * (rowH + rowGap) + 8

          // ── Bottom accent ──
          drawCardDivider(ctx, y, w, c, pad)

          return (y - contentTop) + 8
        },
        {
          title: `${modeLabel} Discovery`,
          badges: [
            { text: isStocks ? 'STOCKS' : 'CRYPTO', filled: true },
            { text: 'DISCOVER', filled: false },
          ],
          subtitle: `Top ${tokens.length} Featured`,
          logo: spectreLogo,
        },
      )
      setDiscoverShareImageUrl(dataUrl)
    } catch (err) {
      console.error('Discover share failed:', err)
      setDiscoverShareModalOpen(false)
    }
    setIsDiscoverShareExporting(false)
  }, [isDiscoverShareExporting, featuredTokens, allTokens, isStocks, discoverFmtPrice])

  if (loading) {
    return (
      <div className={`discover-page ${dayMode ? 'day-mode' : ''}`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', padding: '20px' }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-shimmer" style={{ height: '180px', borderRadius: '12px' }} />
          ))}
        </div>
      </div>
    )
  }

  if (fetchError && allTokens.length === 0) {
    return (
      <div className={`discover-page ${dayMode ? 'day-mode' : ''}`}>
        <div className="discover-loading">
          <span className="discover-loading-text" style={{ color: 'rgba(239,68,68,0.9)' }}>{t(fetchError)}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16, padding: '10px 24px', background: 'rgba(245,245,247,0.08)',
              border: '1px solid rgba(245,245,247,0.1)', borderRadius: 8, color: 'rgba(245,245,247,0.7)',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`discover-page ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stocks-mode' : ''}`}>
      {/* ═══ CINEMATIC HERO ═══ */}
      <section className="discover-hero-section">
        <div className="discover-hero-header">
          <span className="discover-hero-label">SPECTRE AI</span>
          <h1 className="discover-hero-headline">{isStocks ? t('discover.stockDiscovery') : t('discover.title')}</h1>
          <p className="discover-hero-subheadline">
            {isStocks ? t('discover.exploreStockStories') : t('discover.exploreTokenStories')}
          </p>
          {!isMobile && (
            <ShareXButton onClick={handleShareDiscover} isExporting={isDiscoverShareExporting} compact />
          )}
        </div>

        {/* Featured token carousel */}
        <div className="discover-hero-carousel">
          {featuredToken && (
            <CinematicHeroCard
              token={featuredToken}
              onClick={handleTokenClick}
              brandColor={featuredColors?.bg}
              lastUpdated={lastUpdated}
            />
          )}

          {/* Navigation dots */}
          <div className="discover-hero-dots">
            {featuredTokens.map((tk, idx) => (
              <button
                key={tk.id}
                className={`hero-dot ${idx === featuredIndex ? 'active' : ''}`}
                onClick={() => setFeaturedIndex(idx)}
                aria-label={t('common.goToSlideAria', { n: idx + 1, defaultValue: `Go to slide ${idx + 1}` })}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SOCIAL PULSE (crypto only) — what the timeline is moving ═══ */}
      {!isStocks && <DiscoverSocialPulse social={social} isMobile={isMobile} />}

      {/* ═══ CATEGORY ROWS ═══ */}
      <section className="discover-categories">
        {activeCategories.map(category => {
          const tokens = categoryData[category.id] || []
          if (tokens.length === 0) return null
          return (
            <CategoryRow
              key={category.id}
              category={category}
              tokens={tokens}
              onTokenClick={handleTokenClick}
              onAddToWatchlist={handleAddToWatchlist}
              isInWatchlist={checkIsInWatchlist}
              isMobile={isMobile}
              socialLookup={isStocks ? null : socialLookup}
            />
          )
        })}
      </section>

      {/* ═══ TOKEN STORYBOOK / BOTTOM SHEET ═══ */}
      {isMobile ? (
        <TokenBottomSheet
          token={storybookToken}
          isOpen={isStorybookOpen}
          onClose={handleStorybookClose}
          fmtPrice={discoverFmtPrice}
          fmtMcap={fmtLarge}
          onViewResearch={onOpenResearchZone ? () => {
            handleStorybookClose()
            onOpenResearchZone(storybookToken)
          } : undefined}
          isInWatchlist={storybookToken ? checkIsInWatchlist(storybookToken) : false}
          onToggleWatchlist={() => storybookToken && handleStorybookWatchlist(storybookToken)}
        />
      ) : (
        <TokenStorybook
          token={storybookToken}
          isOpen={isStorybookOpen}
          onClose={handleStorybookClose}
          onAddToWatchlist={handleStorybookWatchlist}
          isInWatchlist={checkIsInWatchlist}
          dayMode={dayMode}
        />
      )}
      {!isMobile && (
        <ShareXModal
          open={discoverShareModalOpen}
          onClose={() => { setDiscoverShareModalOpen(false); setDiscoverShareImageUrl(null) }}
          imageUrl={discoverShareImageUrl}
          defaultDescription={discoverShareDescription}
          filename={`spectre_discover_${isStocks ? 'stocks' : 'crypto'}.png`}
        />
      )}
    </div>
  )
}

export default DiscoverPage
