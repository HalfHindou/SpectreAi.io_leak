/**
 * TokenStorybook - Cinematic Poetry-Book Experience V2
 *
 * A full-screen immersive story experience for each token.
 * Now with REAL-TIME DATA, live charts, and dynamic insights.
 *
 * Features:
 * - Chapter-based narrative flow
 * - LIVE price sparkline visualization
 * - Real-time market metrics
 * - Dynamic chapter content based on token performance
 * - Exchange listings & trading info
 * - Smooth scroll-triggered animations
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { TOKEN_ROW_COLORS, getTokenDisplayColors } from '@/constants/tokenColors'
import { useCurrency } from '@/hooks/useCurrency'
import './token-storybook.css'

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN STORIES - Poetic narratives for each token
// ═══════════════════════════════════════════════════════════════════════════════

const TOKEN_STORIES = {
  BTC: {
    title: 'Bitcoin',
    tagline: 'Digital Gold',
    origin: { year: 2009, founder: 'Satoshi Nakamoto', type: 'Proof of Work' },
    exchanges: ['Binance', 'Coinbase', 'Kraken', 'Bybit', 'OKX'],
    chapters: [
      {
        number: '01',
        title: 'The Genesis',
        subtitle: 'Where it all began',
        narrative: 'In 2009, a mysterious figure named Satoshi Nakamoto released code that would change money forever. No banks. No borders. Just math and belief.',
        dynamicStat: 'ath',
      },
      {
        number: '02',
        title: 'The Scarcity',
        subtitle: 'Digital gold standard',
        narrative: 'Only 21 million will ever exist. Each halving reduces supply inflation. The next halving is the most anticipated event in crypto.',
        dynamicStat: 'supply',
      },
      {
        number: '03',
        title: 'The Dominance',
        subtitle: 'King of crypto',
        narrative: 'Bitcoin\'s market dominance defines market cycles. When BTC leads, altcoins follow. When BTC rests, altseason begins.',
        dynamicStat: 'dominance',
      },
    ],
  },
  ETH: {
    title: 'Ethereum',
    tagline: 'World Computer',
    origin: { year: 2015, founder: 'Vitalik Buterin', type: 'Proof of Stake' },
    exchanges: ['Binance', 'Coinbase', 'Kraken', 'Uniswap', 'Curve'],
    chapters: [
      {
        number: '01',
        title: 'The Platform',
        subtitle: 'Build anything',
        narrative: 'Ethereum isn\'t just a currency - it\'s a global computer. Smart contracts execute automatically, trustlessly, forever.',
        dynamicStat: 'ath',
      },
      {
        number: '02',
        title: 'The Ecosystem',
        subtitle: 'DeFi & NFT home',
        narrative: 'Uniswap, Aave, OpenSea - the protocols that define Web3 run on Ethereum. Over $50B locked in its smart contracts.',
        dynamicStat: 'volume',
      },
      {
        number: '03',
        title: 'The Future',
        subtitle: 'Scaling with L2s',
        narrative: 'Arbitrum, Optimism, Base - Layer 2s multiply Ethereum\'s capacity. The roadmap: millions of transactions per second.',
        dynamicStat: 'performance',
      },
    ],
  },
  SOL: {
    title: 'Solana',
    tagline: 'Speed of Light',
    origin: { year: 2020, founder: 'Anatoly Yakovenko', type: 'Proof of History' },
    exchanges: ['Binance', 'Coinbase', 'Kraken', 'Jupiter', 'Raydium'],
    chapters: [
      {
        number: '01',
        title: 'The Speed',
        subtitle: '400ms blocks',
        narrative: 'While Ethereum processes 15 TPS, Solana handles thousands. Speed isn\'t a feature - it\'s the foundation.',
        dynamicStat: 'performance',
      },
      {
        number: '02',
        title: 'The Memes',
        subtitle: 'Culture capital',
        narrative: 'BONK, WIF, POPCAT - Solana became the home of meme coins. Where culture meets crypto, fortunes are made.',
        dynamicStat: 'volume',
      },
      {
        number: '03',
        title: 'The Comeback',
        subtitle: 'Phoenix rising',
        narrative: 'After FTX, everyone wrote Solana off. Then came the builders. Now it\'s processing more DEX volume than Ethereum.',
        dynamicStat: 'ath',
      },
    ],
  },
  XRP: {
    title: 'XRP',
    tagline: 'Global Payments',
    origin: { year: 2012, founder: 'Chris Larsen & Jed McCaleb', type: 'Consensus' },
    exchanges: ['Binance', 'Kraken', 'Bitstamp', 'Uphold', 'Bitfinex'],
    chapters: [
      {
        number: '01',
        title: 'The Bridge',
        subtitle: '3-second settlements',
        narrative: 'Banks move trillions daily through outdated SWIFT rails. XRP settles cross-border payments in seconds, not days.',
        dynamicStat: 'performance',
      },
      {
        number: '02',
        title: 'The Victory',
        subtitle: 'SEC defeated',
        narrative: 'After 3 years of legal battle, XRP won clarity. "Not a security" - the ruling that changed everything.',
        dynamicStat: 'volume',
      },
      {
        number: '03',
        title: 'The Adoption',
        subtitle: 'Banks onboarding',
        narrative: 'Santander, SBI Holdings, Bank of America - financial giants are integrating RippleNet. Utility drives value.',
        dynamicStat: 'ath',
      },
    ],
  },
  DOGE: {
    title: 'Dogecoin',
    tagline: 'Much Wow',
    origin: { year: 2013, founder: 'Billy Markus & Jackson Palmer', type: 'Proof of Work' },
    exchanges: ['Binance', 'Coinbase', 'Kraken', 'Robinhood', 'eToro'],
    chapters: [
      {
        number: '01',
        title: 'The Meme',
        subtitle: 'Joke to billions',
        narrative: 'Created in 2 hours as a parody. Now accepted by Tesla, SpaceX, AMC. The original meme coin that started it all.',
        dynamicStat: 'ath',
      },
      {
        number: '02',
        title: 'The Army',
        subtitle: 'Community power',
        narrative: '5 million holders united by humor and hope. They funded NASCAR cars, Olympic athletes, and clean water projects.',
        dynamicStat: 'volume',
      },
      {
        number: '03',
        title: 'The Elon Effect',
        subtitle: 'To the moon',
        narrative: 'One tweet moves billions. Elon\'s "Dogefather" tweets created more millionaires than most hedge funds.',
        dynamicStat: 'performance',
      },
    ],
  },
  ADA: {
    title: 'Cardano',
    tagline: 'Third Generation',
    origin: { year: 2017, founder: 'Charles Hoskinson', type: 'Proof of Stake' },
    exchanges: ['Binance', 'Coinbase', 'Kraken', 'Minswap', 'SundaeSwap'],
    chapters: [
      {
        number: '01',
        title: 'The Method',
        subtitle: 'Peer-reviewed code',
        narrative: 'Built by academics, verified by mathematicians. 140+ research papers. Cardano does things right, not just fast.',
        dynamicStat: 'ath',
      },
      {
        number: '02',
        title: 'The Mission',
        subtitle: 'Banking the unbanked',
        narrative: 'Ethiopia\'s 5 million students. Kenya\'s farmers. Africa is Cardano\'s proving ground for real-world adoption.',
        dynamicStat: 'volume',
      },
      {
        number: '03',
        title: 'The Governance',
        subtitle: 'Voltaire era',
        narrative: 'On-chain governance gives every ADA holder a voice. Treasury proposals, catalyst voting - true decentralization.',
        dynamicStat: 'supply',
      },
    ],
  },
  SPECTRE: {
    title: 'Spectre AI',
    tagline: 'AI Intelligence',
    origin: { year: 2024, founder: 'Spectre Team', type: 'ERC-20' },
    exchanges: ['Uniswap V2', 'BVOX'],
    chapters: [
      {
        number: '01',
        title: 'The Vision',
        subtitle: 'Intelligence meets DeFi',
        narrative: 'In a market of noise, Spectre brings signal. Real-time analytics, live sentiment, and institutional-grade intelligence - built for the on-chain generation.',
        dynamicStat: 'ath',
      },
      {
        number: '02',
        title: 'The Engine',
        subtitle: 'Data is the new alpha',
        narrative: 'Spectre fuses on-chain data, social sentiment, and market microstructure into a single intelligence layer. Every wallet, every trade, every trend - analyzed in real time.',
        dynamicStat: 'volume',
      },
      {
        number: '03',
        title: 'The Community',
        subtitle: 'Built by traders, for traders',
        narrative: 'Not just another dashboard - a living ecosystem. Spectre holders shape the product, vote on features, and earn rewards for contributing intelligence.',
        dynamicStat: 'performance',
      },
    ],
  },
  PEPE: {
    title: 'Pepe',
    tagline: 'Meme Supreme',
    origin: { year: 2023, founder: 'Anonymous', type: 'ERC-20' },
    exchanges: ['Binance', 'Coinbase', 'OKX', 'Uniswap', 'Bybit'],
    chapters: [
      {
        number: '01',
        title: 'The Frog',
        subtitle: 'Internet culture, tokenized',
        narrative: 'Born from the most iconic meme of a generation. No roadmap, no promises - just a frog and a dream that captured billions in market cap.',
        dynamicStat: 'ath',
      },
      {
        number: '02',
        title: 'The Movement',
        subtitle: 'Community-driven chaos',
        narrative: 'Holders turned believers. Twitter raids, diamond hands, and a community that refuses to sell. Meme coins aren\'t about utility - they\'re about conviction.',
        dynamicStat: 'volume',
      },
      {
        number: '03',
        title: 'The Legacy',
        subtitle: 'Meme to mainstream',
        narrative: 'Listed on every major exchange. Billions in daily volume. PEPE proved that culture is the strongest force in crypto.',
        dynamicStat: 'performance',
      },
    ],
  },
}

// Default story template for tokens without custom narrative
const DEFAULT_STORY = {
  chapters: [
    {
      number: '01',
      title: 'The Asset',
      subtitle: 'Market position',
      narrative: 'Every token tells a story of innovation, community, and ambition. This one has captured enough attention to be here.',
      dynamicStat: 'ath',
    },
    {
      number: '02',
      title: 'The Opportunity',
      subtitle: 'Trading dynamics',
      narrative: 'Volume reveals conviction. Volatility creates opportunity. Understanding the numbers is the first step to alpha.',
      dynamicStat: 'volume',
    },
    {
      number: '03',
      title: 'The Analysis',
      subtitle: 'Your edge',
      narrative: 'Charts tell the past, fundamentals hint at the future. DYOR isn\'t just advice - it\'s survival.',
      dynamicStat: 'performance',
    },
  ],
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATED LIVE CHART BACKGROUND - The chart IS the background
// ═══════════════════════════════════════════════════════════════════════════════

const LiveChartBackground = React.memo(({ brandColor, priceChange, sparklineData, scrollProgressRef }) => {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: false })
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

    let w = window.innerWidth
    let h = window.innerHeight

    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let time = 0
    let lastFrameTime = 0
    const targetFPS = 30
    const frameInterval = 1000 / targetFPS

    const isPositive = priceChange >= 0

    // Determine if brand color is neutral/gray — boost with accent if so
    const parts = (brandColor || '139,92,246').split(',').map(Number)
    const maxC = Math.max(parts[0], parts[1], parts[2])
    const minC = Math.min(parts[0], parts[1], parts[2])
    const isNeutral = (maxC - minC) < 40 // low saturation = neutral
    const rgb = brandColor || (isPositive ? '34, 197, 94' : '239, 68, 68')
    // Accent color for glow when brand is neutral
    const glowRgb = isNeutral ? '139, 92, 246' : rgb

    // 2026-05-26 beta-quality fix: flat baseline instead of random-walk fakery
    // when sparkline data is missing.
    const chartData = sparklineData?.length > 10
      ? sparklineData
      : Array.from({ length: 48 }, () => 50)
    const dataMin = Math.min(...chartData)
    const dataMax = Math.max(...chartData)
    const dataRange = dataMax - dataMin || 1

    const draw = (currentTime) => {
      animationRef.current = requestAnimationFrame(draw)

      const elapsed = currentTime - lastFrameTime
      if (elapsed < frameInterval) return
      lastFrameTime = currentTime - (elapsed % frameInterval)

      // perf: skip the full-canvas redraw (fillRect + radial gradient alloc +
      // chart stroke) when the tab is hidden - this loop otherwise burns GPU
      // forever in a background tab. rAF stays scheduled so it resumes on focus.
      if (document.hidden) return

      const sp = scrollProgressRef?.current || 0 // 0 = hero, 1 = last chapter

      // Dark background
      ctx.fillStyle = '#0a0a0f'
      ctx.fillRect(0, 0, w, h)

      // Central radial glow — intensifies as you scroll
      const glowIntensity = 0.12 + sp * 0.15
      const glowRadius = w * (0.4 + sp * 0.2)
      const radGlow = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.5, glowRadius)
      radGlow.addColorStop(0, `rgba(${glowRgb}, ${glowIntensity})`)
      radGlow.addColorStop(1, 'transparent')
      ctx.fillStyle = radGlow
      ctx.fillRect(0, 0, w, h)

      // Breathing + scroll-driven vertical shift
      const breathe = Math.sin(time * 0.015) * 0.08 + 1
      const scrollShift = sp * h * 0.3 // chart rises as you scroll deeper
      const verticalShift = Math.sin(time * 0.01) * 15 - scrollShift

      // Chart zoom & opacity based on scroll
      const chartScale = 1 + sp * 0.3 // chart grows
      const chartOpacity = Math.max(0.3, 1 - sp * 0.4) // fades slightly in deep chapters

      {
        const padding = h * 0.15
        const chartH = h * 0.5 * chartScale

        // Draw gradient fill
        ctx.globalAlpha = chartOpacity
        ctx.beginPath()
        for (let i = 0; i < chartData.length; i++) {
          const x = (i / (chartData.length - 1)) * w
          const normalizedY = (chartData[i] - dataMin) / dataRange
          const y = h - padding - (normalizedY * chartH * breathe) + verticalShift
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h)
        ctx.lineTo(0, h)
        ctx.closePath()

        const gradient = ctx.createLinearGradient(0, h * 0.2, 0, h)
        gradient.addColorStop(0, `rgba(${rgb}, 0.25)`)
        gradient.addColorStop(0.4, `rgba(${rgb}, 0.12)`)
        gradient.addColorStop(1, `rgba(${rgb}, 0)`)
        ctx.fillStyle = gradient
        ctx.fill()

        // Outer glow line
        ctx.beginPath()
        for (let i = 0; i < chartData.length; i++) {
          const x = (i / (chartData.length - 1)) * w
          const normalizedY = (chartData[i] - dataMin) / dataRange
          const y = h - padding - (normalizedY * chartH * breathe) + verticalShift
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = `rgba(${rgb}, 0.4)`
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()

        // Main bright line
        ctx.strokeStyle = `rgba(${rgb}, 0.8)`
        ctx.lineWidth = 2
        ctx.stroke()

        // Inner glow line
        ctx.strokeStyle = `rgba(255, 255, 255, 0.15)`
        ctx.lineWidth = 1
        ctx.stroke()

        // Pulse dot at end
        const lastX = w - 20
        const lastNorm = (chartData[chartData.length - 1] - dataMin) / dataRange
        const lastY = h - padding - (lastNorm * chartH * breathe) + verticalShift
        const pulseSize = 5 + Math.sin(time * 0.06) * 2

        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize + 10, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${glowRgb}, 0.2)`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(lastX, lastY, pulseSize, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${rgb})`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(lastX, lastY, 2, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()

        ctx.globalAlpha = 1
      }

      time++
    }

    animationRef.current = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [brandColor, priceChange, sparklineData])

  return <canvas ref={canvasRef} className="storybook-wave-canvas" />
})

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC STAT CARD - Shows real-time data based on type
// ═══════════════════════════════════════════════════════════════════════════════

const DynamicStatCard = React.memo(({ type, token, brandColor }) => {
  const rgb = brandColor || '139, 92, 246'
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()

  const stats = useMemo(() => {
    const price = token?.current_price || 0
    const change24h = token?.price_change_percentage_24h || 0
    const change7d = token?.price_change_percentage_7d_in_currency || 0
    const change30d = token?.price_change_percentage_30d_in_currency || 0
    const marketCap = token?.market_cap || 0
    const volume = token?.total_volume || 0
    const ath = token?.ath || price * 1.5
    const athChange = token?.ath_change_percentage || -30
    const high24h = token?.high_24h || price * 1.02
    const low24h = token?.low_24h || price * 0.98
    const circulatingSupply = token?.circulating_supply || 0
    const totalSupply = token?.total_supply || circulatingSupply
    const maxSupply = token?.max_supply || null

    switch (type) {
      case 'ath':
        return {
          label: t('storybook.allTimeHigh'),
          value: fmtPrice(ath),
          sublabel: `${athChange.toFixed(1)}% from ATH`,
          trend: athChange > -20 ? 'hot' : athChange > -50 ? 'warm' : 'cold',
        }
      case 'volume':
        const volumeToMcap = marketCap > 0 ? (volume / marketCap * 100).toFixed(1) : 0
        return {
          label: t('storybook.volume24h'),
          value: fmtLarge(volume),
          sublabel: `${volumeToMcap}% of market cap`,
          trend: volumeToMcap > 10 ? 'hot' : volumeToMcap > 5 ? 'warm' : 'normal',
        }
      case 'performance':
        return {
          label: t('storybook.change7d'),
          value: `${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}%`,
          sublabel: `30d: ${change30d >= 0 ? '+' : ''}${change30d.toFixed(1)}%`,
          trend: change7d > 10 ? 'bullish' : change7d < -10 ? 'bearish' : 'neutral',
        }
      case 'supply':
        const supplyPercent = maxSupply ? ((circulatingSupply / maxSupply) * 100).toFixed(1) : null
        return {
          label: t('storybook.circulatingSupply'),
          value: circulatingSupply >= 1e9 ? `${(circulatingSupply / 1e9).toFixed(1)}B` :
                 circulatingSupply >= 1e6 ? `${(circulatingSupply / 1e6).toFixed(1)}M` :
                 circulatingSupply.toLocaleString(),
          sublabel: maxSupply ? `${supplyPercent}% of max supply` : 'No max supply',
          trend: supplyPercent > 90 ? 'scarce' : 'normal',
        }
      case 'dominance':
        // This would need global market data, using placeholder
        return {
          label: t('storybook.marketRank'),
          value: `#${token?.market_cap_rank || '?'}`,
          sublabel: `${fmtLarge(marketCap)} mcap`,
          trend: (token?.market_cap_rank || 100) <= 10 ? 'elite' : 'normal',
        }
      default:
        return {
          label: t('storybook.range24h'),
          value: `${fmtPrice(low24h)} - ${fmtPrice(high24h)}`,
          sublabel: `Current: ${fmtPrice(price)}`,
          trend: 'normal',
        }
    }
  }, [type, token, fmtPrice, fmtLarge, t])

  return (
    <div className={`storybook-dynamic-stat trend-${stats.trend}`} style={{ '--brand-rgb': rgb }}>
      <span className="storybook-dynamic-stat-label">{stats.label}</span>
      <span className="storybook-dynamic-stat-value">{stats.value}</span>
      <span className="storybook-dynamic-stat-sublabel">{stats.sublabel}</span>
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// EXCHANGE BADGES
// ═══════════════════════════════════════════════════════════════════════════════

const ExchangeBadges = React.memo(({ exchanges, brandColor }) => {
  const { t } = useTranslation()
  const defaultExchanges = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit']
  const displayExchanges = exchanges || defaultExchanges

  return (
    <div className="storybook-exchanges">
      <span className="storybook-exchanges-label">{t('storybook.tradeOn')}</span>
      <div className="storybook-exchanges-list">
        {displayExchanges.slice(0, 5).map((ex, i) => (
          <span key={ex} className="storybook-exchange-badge" style={{ animationDelay: `${i * 0.1}s` }}>
            {ex}
          </span>
        ))}
      </div>
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const Chapter = React.memo(({ chapter, index, isActive, brandColor, token }) => {
  const { t } = useTranslation()
  const rgb = brandColor || '139, 92, 246'

  return (
    <section className={`storybook-chapter ${isActive ? 'active' : ''}`}>
      <div className="storybook-chapter-content">
        {/* Chapter marker */}
        <div className="storybook-chapter-marker">
          <span className="storybook-chapter-label">{t('storybook.chapter')}</span>
          <span className="storybook-chapter-number" style={{ color: `rgb(${rgb})` }}>
            {chapter.number}
          </span>
          <div className="storybook-chapter-line" style={{ background: `rgb(${rgb})` }} />
        </div>

        {/* Chapter title */}
        <h2 className="storybook-chapter-title">{chapter.title}</h2>
        <p className="storybook-chapter-subtitle">{chapter.subtitle}</p>

        {/* Narrative text */}
        <p className="storybook-chapter-narrative">{chapter.narrative}</p>

        {/* Dynamic stat based on chapter type */}
        <DynamicStatCard type={chapter.dynamicStat} token={token} brandColor={rgb} />
      </div>
    </section>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE METRICS TICKER
// ═══════════════════════════════════════════════════════════════════════════════

const LiveMetricsTicker = React.memo(({ token, brandColor }) => {
  const { fmtPrice, fmtLarge } = useCurrency()
  const price = token?.current_price || 0
  const change24h = token?.price_change_percentage_24h || 0
  const change1h = token?.price_change_percentage_1h_in_currency || 0
  const high24h = token?.high_24h || price
  const low24h = token?.low_24h || price
  const volume = token?.total_volume || 0

  return (
    <div className="storybook-live-ticker">
      <div className="storybook-ticker-item">
        <span className="storybook-ticker-label">1H</span>
        <span className={`storybook-ticker-value ${change1h >= 0 ? 'positive' : 'negative'}`}>
          {change1h >= 0 ? '+' : ''}{change1h?.toFixed(2) || '0.00'}%
        </span>
      </div>
      <div className="storybook-ticker-item">
        <span className="storybook-ticker-label">24H</span>
        <span className={`storybook-ticker-value ${change24h >= 0 ? 'positive' : 'negative'}`}>
          {change24h >= 0 ? '+' : ''}{change24h?.toFixed(2) || '0.00'}%
        </span>
      </div>
      <div className="storybook-ticker-divider" />
      <div className="storybook-ticker-item">
        <span className="storybook-ticker-label">HIGH</span>
        <span className="storybook-ticker-value">{fmtPrice(high24h || 0)}</span>
      </div>
      <div className="storybook-ticker-item">
        <span className="storybook-ticker-label">LOW</span>
        <span className="storybook-ticker-value">{fmtPrice(low24h || 0)}</span>
      </div>
      <div className="storybook-ticker-divider" />
      <div className="storybook-ticker-item">
        <span className="storybook-ticker-label">VOL</span>
        <span className="storybook-ticker-value">{fmtLarge(volume)}</span>
      </div>
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN STORYBOOK COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const TokenStorybook = ({
  token,
  isOpen,
  onClose,
  onAddToWatchlist,
  isInWatchlist,
  dayMode = false,
}) => {
  const { t } = useTranslation()
  const [activeChapter, setActiveChapter] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const containerRef = useRef(null)
  const scrollProgressRef = useRef(0)

  // Get token data
  const symbol = (token?.symbol || '').toUpperCase()
  const name = token?.name || symbol
  const price = token?.current_price || token?.price || 0
  const priceChange = token?.price_change_percentage_24h || token?.change || 0
  const marketCap = token?.market_cap || token?.marketCap || 0
  const volume = token?.total_volume || 0
  const logo = token?.image || token?.logo
  const sparklineData = token?.sparkline_in_7d?.price || []

  // Get brand color - with brightness-safe variants for both themes
  const colors = TOKEN_ROW_COLORS[symbol]
  const displayColors = useMemo(() => getTokenDisplayColors(symbol), [symbol])
  const brandColorRaw = displayColors.raw  // original for glow/bg use
  // Pick the right accent based on current theme
  const brandColor = dayMode ? displayColors.accentDay : displayColors.accent
  const brandColorDay = displayColors.accentDay

  // Get story
  const baseStory = TOKEN_STORIES[symbol] || { title: name, tagline: 'Crypto Asset', ...DEFAULT_STORY }
  const story = {
    ...baseStory,
    title: baseStory.title || name,
    tagline: baseStory.tagline || 'Digital Asset',
  }

  // Currency formatting from hook
  const { fmtPrice, fmtLarge, currencySymbol } = useCurrency()

  // Lock body scroll when storybook is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.width = '100%'
      document.body.style.overflow = 'hidden'

      return () => {
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.width = ''
        document.body.style.overflow = ''
        window.scrollTo(0, scrollY)
      }
    }
  }, [isOpen])

  // Handle scroll for chapter detection - debounced for performance
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let rafId = null
    let lastChapter = 0

    const handleScroll = () => {
      if (rafId) return // Skip if already scheduled

      rafId = requestAnimationFrame(() => {
        const scrollTop = container.scrollTop
        const chapterHeight = window.innerHeight
        const newChapter = Math.min(
          Math.floor((scrollTop + chapterHeight * 0.4) / chapterHeight),
          story.chapters.length
        )
        if (newChapter !== lastChapter) {
          lastChapter = newChapter
          setActiveChapter(newChapter)
          // Sync ref so keyboard nav stays accurate after manual scroll
          if (!scrollAnimRef.current) targetChapterRef.current = newChapter
        }
        // Track continuous scroll progress via ref (no re-render)
        const maxScroll = container.scrollHeight - container.clientHeight
        scrollProgressRef.current = maxScroll > 0 ? scrollTop / maxScroll : 0
        rafId = null
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [story.chapters.length])

  // Handle close
  const handleClose = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => {
      setIsExiting(false)
      setActiveChapter(0)
      targetChapterRef.current = 0
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current)
      scrollAnimRef.current = null
      onClose?.()
    }, 500)
  }, [onClose])

  // Animation lock — prevents overlapping scroll animations
  const scrollAnimRef = useRef(null)
  // Track intended chapter for keyboard nav (avoids stale activeChapter)
  const targetChapterRef = useRef(0)

  const scrollToChapter = useCallback((index) => {
    const container = containerRef.current
    if (!container) return
    const sections = container.querySelectorAll('.storybook-hero, .storybook-chapter, .storybook-cta')
    const target = sections[index]
    if (!target) return

    // Cancel any in-flight animation
    if (scrollAnimRef.current) {
      cancelAnimationFrame(scrollAnimRef.current)
      scrollAnimRef.current = null
    }

    targetChapterRef.current = index

    const targetTop = target.offsetTop
    const startTop = container.scrollTop
    const distance = targetTop - startTop
    if (Math.abs(distance) < 2) return // already there

    const duration = 1200 // slower, more cinematic
    let startTime = null

    // Smooth ease-in-out — gentle start, gentle end
    const easeInOutQuart = (t) =>
      t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2

    const step = (timestamp) => {
      if (!startTime) startTime = timestamp
      const elapsed = timestamp - startTime
      const progress = Math.min(elapsed / duration, 1)
      container.scrollTop = startTop + distance * easeInOutQuart(progress)
      if (progress < 1) {
        scrollAnimRef.current = requestAnimationFrame(step)
      } else {
        scrollAnimRef.current = null
      }
    }
    scrollAnimRef.current = requestAnimationFrame(step)
  }, [])

  // Keyboard navigation — uses targetChapterRef to avoid stale state
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        const totalSections = story.chapters.length + 1 // chapters + CTA
        const next = Math.min(targetChapterRef.current + 1, totalSections)
        if (next !== targetChapterRef.current) {
          scrollToChapter(next)
        }
      }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        const prev = Math.max(targetChapterRef.current - 1, 0)
        if (prev !== targetChapterRef.current) {
          scrollToChapter(prev)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleClose, story.chapters.length, scrollToChapter])

  const handleWatchlist = useCallback(() => {
    onAddToWatchlist?.(token)
  }, [onAddToWatchlist, token])

  // Export 4K image for sharing to X
  const [isExporting, setIsExporting] = useState(false)

  const export4KImage = useCallback(async () => {
    setIsExporting(true)

    try {
      // Create canvas for export (1920x1080 for faster generation)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const width = 1920
      const height = 1080

      canvas.width = width
      canvas.height = height

      // Dark background
      ctx.fillStyle = '#0a0a0f'
      ctx.fillRect(0, 0, width, height)

      // Background gradient glow
      const bgGradient = ctx.createRadialGradient(
        width * 0.5, height * 0.4, 0,
        width * 0.5, height * 0.5, width * 0.6
      )
      bgGradient.addColorStop(0, `rgba(${brandColor}, 0.2)`)
      bgGradient.addColorStop(1, 'transparent')
      ctx.fillStyle = bgGradient
      ctx.fillRect(0, 0, width, height)

      // Draw chart background - 2026-05-26 beta-quality fix: flat baseline
      // when sparkline data is missing (was a random walk shown to user).
      {
        const chartData = sparklineData?.length > 10 ? sparklineData : Array.from({ length: 48 }, () => 50)
        const min = Math.min(...chartData)
        const max = Math.max(...chartData)
        const range = max - min || 1
        const padding = height * 0.2

        // Fill area
        ctx.beginPath()
        chartData.forEach((val, i) => {
          const x = (i / (chartData.length - 1)) * width
          const normalizedY = (val - min) / range
          const y = height - padding - (normalizedY * (height * 0.4))
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.lineTo(width, height)
        ctx.lineTo(0, height)
        ctx.closePath()

        const chartGradient = ctx.createLinearGradient(0, height * 0.3, 0, height)
        chartGradient.addColorStop(0, `rgba(${brandColor}, 0.2)`)
        chartGradient.addColorStop(1, `rgba(${brandColor}, 0)`)
        ctx.fillStyle = chartGradient
        ctx.fill()

        // Line
        ctx.beginPath()
        chartData.forEach((val, i) => {
          const x = (i / (chartData.length - 1)) * width
          const normalizedY = (val - min) / range
          const y = height - padding - (normalizedY * (height * 0.4))
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = `rgba(${brandColor}, 0.6)`
        ctx.lineWidth = 3
        ctx.stroke()
      }

      // Token name
      ctx.textAlign = 'center'
      ctx.fillStyle = 'white'
      ctx.font = 'bold 90px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillText(story.title || name, width / 2, height * 0.35)

      // Tagline
      ctx.font = 'italic 32px Georgia, serif'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.fillText(story.tagline || 'Crypto Asset', width / 2, height * 0.43)

      // Price
      ctx.font = 'bold 72px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = 'white'
      ctx.fillText(fmtPrice(price), width / 2, height * 0.58)

      // Change percentage
      const changeColor = priceChange >= 0 ? '#22c55e' : '#ef4444'
      const changeSymbol = priceChange >= 0 ? '▲' : '▼'
      ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = changeColor
      ctx.fillText(`${changeSymbol} ${Math.abs(priceChange).toFixed(2)}%`, width / 2, height * 0.67)

      // Spectre AI branding
      ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = `rgb(${brandColor})`
      ctx.textAlign = 'left'
      ctx.fillText('SPECTRE AI', 40, height - 50)

      ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.fillText('Cinema Mode', 40, height - 25)

      // Timestamp
      ctx.textAlign = 'right'
      ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.fillText(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), width - 40, height - 35)

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (!blob) {
          console.error('Failed to create blob')
          setIsExporting(false)
          return
        }

        const url = URL.createObjectURL(blob)

        // Download the image
        const link = document.createElement('a')
        link.download = `${symbol}_spectre.png`
        link.href = url
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        // Open X with pre-filled tweet after short delay
        setTimeout(() => {
          const tweetText = encodeURIComponent(
            `$${symbol} ${priceChange >= 0 ? '📈' : '📉'} ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%\n\nPrice: ${fmtPrice(price)}\n\nExplored with @Spectre__Ai 🎬\n\n#crypto #${symbol}`
          )
          window.open(`https://twitter.com/intent/tweet?text=${tweetText}`, '_blank')
          URL.revokeObjectURL(url)
          setIsExporting(false)
        }, 500)
      }, 'image/png', 0.95)

    } catch (err) {
      console.error('Export failed:', err)
      setIsExporting(false)
    }
  }, [brandColor, sparklineData, story, name, symbol, price, priceChange, fmtPrice])

  if (!isOpen) return null

  return (
    <div className={`storybook-overlay ${isExiting ? 'exiting' : 'entering'} ${dayMode ? 'day-mode' : ''}`} style={{ '--brand-rgb': brandColor, '--brand-rgb-raw': brandColorRaw, '--brand-rgb-day': brandColorDay, '--brand-glow-opacity': displayColors.glowOpacity }}>
      {/* Animated LIVE chart as background - use accent (brightness-safe) for chart lines */}
      <LiveChartBackground brandColor={brandColor} priceChange={priceChange} sparklineData={sparklineData} scrollProgressRef={scrollProgressRef} />

      {/* Header */}
      <header className="storybook-header">
        <div className="storybook-header-left">
          <div className="storybook-badge" style={{ background: `rgba(${brandColor}, 0.2)`, color: `rgb(${brandColor})` }}>
            <span className="storybook-badge-dot" />
            SPECTRE AI - CINEMA MODE
          </div>
        </div>
        <div className="storybook-header-right">
          {/* Share to X button */}
          <button
            className="storybook-share-x"
            onClick={export4KImage}
            disabled={isExporting}
            style={{ '--brand-rgb': brandColor }}
          >
            {isExporting ? (
              <span className="share-loading-indicator" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            )}
            <span>{isExporting ? t('storybook.exporting') : t('storybook.shareToX')}</span>
          </button>

          {/* Back button */}
          <button
            className="storybook-back-btn"
            onClick={handleClose}
            style={{ '--brand-rgb': brandColor }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>{t('common.back')}</span>
          </button>

          <button className="storybook-close" onClick={handleClose}>
            ESC
          </button>
        </div>
      </header>

      {/* Live metrics ticker */}
      <LiveMetricsTicker token={token} brandColor={brandColor} />

      {/* Scrollable content */}
      <div ref={containerRef} className="storybook-scroll-container">
        {/* Hero section */}
        <section className="storybook-hero">
          <div className="storybook-hero-content" style={{ '--brand-rgb': brandColor }}>
            {/* Live indicator */}
            <div className="storybook-live-indicator">
              <span className="storybook-live-dot" />
              <span className="storybook-live-text">{t('storybook.liveData')}</span>
            </div>

            {/* Token logo with rings and glow */}
            {logo && (
              <div className="storybook-hero-logo-wrapper">
                <div className="storybook-logo-glow" style={{ background: `rgb(${brandColor})`, opacity: displayColors.isDark ? 0.3 : undefined }} />
                <div className="storybook-logo-ring" style={{ borderColor: `rgba(${brandColor}, 0.4)` }} />
                <div className="storybook-logo-ring" style={{ borderColor: `rgba(${brandColor}, 0.3)` }} />
                <div className="storybook-logo-ring" style={{ borderColor: `rgba(${brandColor}, 0.2)` }} />
                <div className="storybook-hero-logo" style={{ boxShadow: `0 0 60px rgba(${brandColor}, 0.4)` }}>
                  <img src={logo} alt={symbol} />
                </div>
              </div>
            )}

            {/* Token rank & meta */}
            {token?.market_cap_rank && (
              <div className="storybook-rank">
                <span className="storybook-rank-label" style={{ color: `rgb(${brandColor})` }}>
                  RANK #{token.market_cap_rank}
                </span>
                <span className="storybook-rank-meta">
                  MCap {fmtLarge(marketCap)} · {story.origin?.type || 'Blockchain'}
                </span>
              </div>
            )}

            {/* Token name */}
            <h1 className="storybook-title">{story.title}</h1>
            <p className="storybook-tagline">{story.tagline}</p>

            {/* Origin info badges */}
            {story.origin && (
              <div className="storybook-origin">
                <div className="storybook-origin-item">
                  <span className="storybook-origin-label">FOUNDED</span>
                  <span className="storybook-origin-value">{story.origin.year}</span>
                </div>
                {story.origin.founder && (
                  <div className="storybook-origin-item">
                    <span className="storybook-origin-label">CREATOR</span>
                    <span className="storybook-origin-value">{story.origin.founder.split('&')[0].trim()}</span>
                  </div>
                )}
                <div className="storybook-origin-item">
                  <span className="storybook-origin-label">CONSENSUS</span>
                  <span className="storybook-origin-value">{story.origin.type}</span>
                </div>
              </div>
            )}

            {/* Price display */}
            <div className="storybook-price">
              <span className="storybook-price-value">{fmtPrice(price)}</span>
              <span className={`storybook-price-change ${priceChange >= 0 ? 'positive' : 'negative'}`}>
                {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
              </span>
            </div>

            {/* Exchange badges */}
            <ExchangeBadges exchanges={story.exchanges} brandColor={brandColor} />

          </div>

          {/* Scroll indicator — pinned to bottom of hero viewport */}
          <div className="storybook-scroll-indicator" onClick={() => scrollToChapter(1)} role="button" tabIndex={-1}>
            <div className="storybook-scroll-mouse">
              <div className="storybook-scroll-wheel" style={{ background: `rgb(${brandColor})` }} />
            </div>
            <span>{t('storybook.scrollToExplore')}</span>
          </div>
        </section>

        {/* Chapters */}
        {story.chapters.map((chapter, index) => (
          <Chapter
            key={chapter.number}
            chapter={chapter}
            index={index}
            isActive={activeChapter === index + 1}
            brandColor={brandColor}
            token={token}
          />
        ))}

        {/* Final CTA section */}
        <section className="storybook-cta">
          <div className="storybook-cta-content">
            <h2 className="storybook-cta-title">{t('storybook.yourMove')}</h2>
            <p className="storybook-cta-text">
              Knowledge is alpha. Now that you understand {symbol}, what will you do with it?
            </p>

            <div className="storybook-cta-buttons">
              <button
                className="storybook-cta-btn primary"
                style={{
                  background: `linear-gradient(135deg, rgb(${brandColor}), rgba(${brandColor}, 0.7))`,
                  boxShadow: `0 8px 32px rgba(${brandColor}, 0.3)`
                }}
                onClick={handleWatchlist}
              >
                {isInWatchlist?.(token) ? `✓ ${t('storybook.inWatchlist')}` : `+ ${t('storybook.addToWatchlist')}`}
              </button>
              <button className="storybook-cta-btn secondary" onClick={handleClose}>
                {t('storybook.continueExploring')}
              </button>
            </div>

            {/* Token watermark */}
            {logo && (
              <div className="storybook-watermark">
                <img src={logo} alt={symbol} />
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Chapter navigation dots */}
      <nav className="storybook-nav">
        <button
          className={`storybook-nav-dot ${activeChapter === 0 ? 'active' : ''}`}
          onClick={() => scrollToChapter(0)}
          style={{ '--dot-color': `rgb(${brandColor})` }}
        />
        {story.chapters.map((_, index) => (
          <button
            key={index}
            className={`storybook-nav-dot ${activeChapter === index + 1 ? 'active' : ''}`}
            onClick={() => scrollToChapter(index + 1)}
            style={{ '--dot-color': `rgb(${brandColor})` }}
          />
        ))}
        <button
          className={`storybook-nav-dot ${activeChapter === story.chapters.length + 1 ? 'active' : ''}`}
          onClick={() => scrollToChapter(story.chapters.length + 1)}
          style={{ '--dot-color': `rgb(${brandColor})` }}
        />
      </nav>
    </div>
  )
}

export default memo(TokenStorybook)
