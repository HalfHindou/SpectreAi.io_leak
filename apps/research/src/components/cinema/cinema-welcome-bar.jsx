/**
 * CinemaWelcomeBar - Cinematic Storybook-Style Welcome Bar
 *
 * Redesigned with the TokenStorybook design language:
 * - Glassmorphic cards with backdrop-filter blur
 * - Playfair Display serif for editorial labels
 * - Inter for data values
 * - Dynamic stat cards with trend-based left border accents
 * - Animated glow rings on logos
 * - Corner accent borders for editorial feel
 * - Live pulse indicators
 */

import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { getStockLogoUrl } from '@/services/stockApi'
import { useCurrency } from '@/hooks/useCurrency'

// Token logos
const TOKEN_LOGOS = {
  'BTC': 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  'ETH': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  'SOL': 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  'BNB': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
}

// Format helpers
const formatChange = (val) => {
  const c = typeof val === 'string' ? parseFloat(val) : val
  if (c == null || isNaN(c)) return '0.00'
  return Math.abs(c).toFixed(2)
}

const computeGlobalMcap = (btcMcap, btcDom) => {
  if (!btcMcap || btcDom <= 0) return null
  return btcMcap / (btcDom / 100)
}

const computeGlobalVolume = (btcVol, ethVol, solVol, dom) => {
  const knownDom = (dom.btc + dom.eth + dom.sol) / 100
  return knownDom > 0 ? (btcVol + ethVol + solVol) / knownDom : null
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINI SPARKLINE - Storybook-style SVG sparkline
// ═══════════════════════════════════════════════════════════════════════════════

const MiniSparkline = ({ data, positive, width = 80, height = 32, id = 'default' }) => {
  if (!data || data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((val - min) / range) * height * 0.8 - height * 0.1
    return `${x},${y}`
  }).join(' ')

  const color = positive ? '#22c55e' : '#ef4444'

  return (
    <svg width={width} height={height} className="cinema-bar-sparkline-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`bar-spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#bar-spark-${id})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE CARD - Storybook cinematic style with corner accents and glow rings
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaPriceCard = ({ symbol, data, onClick, index }) => {
  const { fmtPrice } = useCurrency()
  const price = data?.price
  const change = data?.change ?? data?.change24
  const changeNum = typeof change === 'string' ? parseFloat(change) : (change || 0)
  const sparkline = data?.sparkline_7d || data?.sparkline || []
  const isPositive = changeNum >= 0
  const isStock = !TOKEN_LOGOS[symbol]
  const logo = TOKEN_LOGOS[symbol] || getStockLogoUrl(symbol)
  const colors = TOKEN_ROW_COLORS[symbol] || {}
  const rgb = colors.rgb || (isPositive ? '34, 197, 94' : '239, 68, 68')

  const displaySparkline = sparkline.length > 5 ? sparkline : Array.from({ length: 24 }, (_, i) =>
    100 + Math.sin(i * 0.5) * 10 + changeNum * i / 24
  )

  return (
    <div
      className={`cwb-price-card ${isPositive ? 'is-positive' : 'is-negative'}`}
      style={{ '--brand-rgb': rgb, '--card-index': index }}
      onClick={() => onClick?.({ symbol })}
    >
      {/* Corner accent borders - editorial feel */}
      <div className="cwb-price-corner cwb-price-corner--tl" />
      <div className="cwb-price-corner cwb-price-corner--br" />

      {/* Background sparkline */}
      <div className="cwb-price-sparkline-bg">
        <MiniSparkline data={displaySparkline} positive={isPositive} width={200} height={80} id={`price-${symbol}`} />
      </div>

      {/* Ambient glow */}
      <div className="cwb-price-glow" />

      {/* Logo with glow rings */}
      <div className="cwb-price-logo-wrap">
        {logo && <img src={logo} alt={symbol} className="cwb-price-logo" onError={isStock ? (e) => { e.target.style.display = 'none' } : undefined} />}
        <div className="cwb-price-ring cwb-price-ring-1" />
        <div className="cwb-price-ring cwb-price-ring-2" />
      </div>

      {/* Content */}
      <div className="cwb-price-content">
        <span className="cwb-price-symbol">{symbol}</span>
        <span className="cwb-price-value">{fmtPrice(price)}</span>
      </div>

      {/* Change badge */}
      <div className={`cwb-price-change ${isPositive ? 'positive' : 'negative'}`}>
        <span className="cwb-price-change-arrow">{isPositive ? '↑' : '↓'}</span>
        {formatChange(change)}%
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEAR & GREED - Storybook dynamic stat with trend accent
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaFearGreedGauge = ({ value, classification }) => {
  const { t } = useTranslation()
  const safeValue = value ?? 50
  const trend = safeValue >= 70 ? 'greed' : safeValue >= 56 ? 'warm-greed' : safeValue <= 30 ? 'fear' : safeValue <= 45 ? 'warm-fear' : 'neutral'
  const trendColor = trend === 'greed' ? '34, 197, 94'
    : trend === 'warm-greed' ? '132, 204, 22'
    : trend === 'fear' ? '239, 68, 68'
    : trend === 'warm-fear' ? '249, 115, 22'
    : '234, 179, 8'

  return (
    <div className="cwb-stat-card cwb-fng" style={{ '--stat-rgb': trendColor }} data-trend={trend}>
      {/* Left accent border (storybook style) */}
      <div className="cwb-stat-accent" />

      <div className="cwb-stat-header">
        <span className="cwb-stat-label">{t('cinemaBar.fearGreed')}</span>
        <span className="cwb-stat-live-dot" />
      </div>

      <div className="cwb-stat-body">
        <span className="cwb-stat-value">{value ?? '-'}</span>
        <span className="cwb-stat-sublabel">{classification || ''}</span>
      </div>

      {/* Gradient bar */}
      <div className="cwb-fng-bar">
        <div className="cwb-fng-track">
          <div
            className="cwb-fng-indicator"
            style={{ left: `${Math.min(100, Math.max(0, safeValue))}%` }}
          />
        </div>
        <div className="cwb-fng-range">
          <span>{t('fearGreed.fear')}</span>
          <span>{t('fearGreed.greed')}</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALT SEASON - Storybook dynamic stat
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaAltSeason = ({ value, label, btcShare, ethShare }) => {
  const { t } = useTranslation()
  const safeVal = value ?? 50
  const trend = safeVal >= 75 ? 'alt-season' : safeVal <= 25 ? 'btc-season' : 'mixed'
  const trendColor = trend === 'alt-season' ? '139, 92, 246'
    : trend === 'btc-season' ? '247, 147, 26'
    : '234, 179, 8'

  return (
    <div className="cwb-stat-card cwb-alt" style={{ '--stat-rgb': trendColor }} data-trend={trend}>
      <div className="cwb-stat-accent" />

      <div className="cwb-stat-header">
        <span className="cwb-stat-label">{t('cinemaBar.altSeason')}</span>
      </div>

      <div className="cwb-stat-body">
        <span className="cwb-stat-value">{value ?? '-'}</span>
        <span className="cwb-stat-sublabel">{label || ''}</span>
      </div>

      <div className="cwb-alt-shares">
        <div className="cwb-alt-share">
          <span className="cwb-alt-dot" style={{ background: '#f7931a' }} />
          <span>BTC {btcShare}%</span>
        </div>
        <div className="cwb-alt-share">
          <span className="cwb-alt-dot" style={{ background: '#627eea' }} />
          <span>ETH {ethShare}%</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET DOMINANCE - Storybook stacked visualization
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaMarketDominance = ({ dominance }) => {
  const { t } = useTranslation()
  const { btc = 0, eth = 0, sol = 0, alts = 0 } = dominance || {}

  return (
    <div className="cwb-stat-card cwb-dom" style={{ '--stat-rgb': '247, 147, 26' }}>
      <div className="cwb-stat-accent cwb-dom-accent" />

      <div className="cwb-stat-header">
        <span className="cwb-stat-label">{t('cinemaBar.dominance')}</span>
      </div>

      <div className="cwb-dom-bar">
        <div className="cwb-dom-seg cwb-dom-btc" style={{ width: `${btc}%` }}>
          {btc >= 15 && <span>{btc.toFixed(0)}%</span>}
        </div>
        <div className="cwb-dom-seg cwb-dom-eth" style={{ width: `${eth}%` }}>
          {eth >= 10 && <span>{eth.toFixed(0)}%</span>}
        </div>
        <div className="cwb-dom-seg cwb-dom-sol" style={{ width: `${sol}%` }} />
        <div className="cwb-dom-seg cwb-dom-alts" style={{ width: `${alts}%` }} />
      </div>

      <div className="cwb-dom-legend">
        <span><span className="cwb-dom-dot" style={{ background: '#f7931a' }} /> BTC</span>
        <span><span className="cwb-dom-dot" style={{ background: '#627eea' }} /> ETH</span>
        <span><span className="cwb-dom-dot" style={{ background: '#14f195' }} /> SOL</span>
        <span><span className="cwb-dom-dot" style={{ background: 'rgba(255,255,255,0.25)' }} /> Alt</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPOTIFY AMBIENT WIDGET - Decorative "Now Playing" vibe card
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaSpotifyWidget = () => {
  return (
    <div className="cwb-spotify">
      <span className="cwb-spotify-label">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
        Spotify
      </span>
      <iframe
        src="https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator&theme=0"
        title="Spotify"
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="cwb-spotify-iframe"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL MARKET CAP - Storybook dynamic stat
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaGlobalMcap = ({ mcap, volume, change }) => {
  const { t } = useTranslation()
  const changeNum = typeof change === 'string' ? parseFloat(change) : (change || 0)
  const trend = changeNum >= 2 ? 'hot' : changeNum >= 0 ? 'warm' : changeNum >= -2 ? 'cool' : 'cold'
  const trendColor = trend === 'hot' ? '34, 197, 94'
    : trend === 'warm' ? '132, 204, 22'
    : trend === 'cool' ? '249, 115, 22'
    : '239, 68, 68'

  return (
    <div className="cwb-stat-card cwb-mcap" style={{ '--stat-rgb': trendColor }} data-trend={trend}>
      <div className="cwb-stat-accent" />

      <div className="cwb-stat-header">
        <span className="cwb-stat-label">{t('cinemaBar.cryptoMarket')}</span>
        <span className="cwb-stat-live-dot" />
      </div>

      <div className="cwb-mcap-value-row">
        <span className="cwb-mcap-value">{mcap}</span>
        {change != null && (
          <span className={`cwb-mcap-change ${changeNum >= 0 ? 'positive' : 'negative'}`}>
            {changeNum >= 0 ? '+' : ''}{changeNum.toFixed(1)}%
          </span>
        )}
      </div>

      <span className="cwb-mcap-vol">{t('cinemaBar.vol24h')} {volume}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIX GAUGE - Stock mode replacement for Fear & Greed
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaVixGauge = ({ value, label, change }) => {
  const { t } = useTranslation()
  const safeValue = value ?? 20
  // VIX: low = green (complacent), high = red (fear). Inverse of F&G.
  const trend = safeValue >= 30 ? 'fear' : safeValue >= 25 ? 'warm-fear' : safeValue <= 14 ? 'greed' : safeValue <= 18 ? 'warm-greed' : 'neutral'
  const trendColor = trend === 'fear' ? '239, 68, 68'
    : trend === 'warm-fear' ? '249, 115, 22'
    : trend === 'greed' ? '34, 197, 94'
    : trend === 'warm-greed' ? '132, 204, 22'
    : '234, 179, 8'

  // Map VIX 10-40 to 0-100% bar position
  const barPct = Math.min(100, Math.max(0, ((safeValue - 10) / 30) * 100))

  return (
    <div className="cwb-stat-card cwb-fng" style={{ '--stat-rgb': trendColor }} data-trend={trend}>
      <div className="cwb-stat-accent" />
      <div className="cwb-stat-header">
        <span className="cwb-stat-label">{t('cinemaBar.vixIndex')}</span>
        <span className="cwb-stat-live-dot" />
      </div>
      <div className="cwb-stat-body">
        <span className="cwb-stat-value">{value != null ? value.toFixed(2) : '-'}</span>
        <span className="cwb-stat-sublabel">{label || ''}</span>
      </div>
      <div className="cwb-fng-bar">
        <div className="cwb-fng-track">
          <div className="cwb-fng-indicator" style={{ left: `${barPct}%` }} />
        </div>
        <div className="cwb-fng-range">
          <span>{t('chart.low')}</span>
          <span>{t('chart.high')}</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK APPETITE - Stock mode replacement for Alt Season
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaRiskAppetite = ({ value, label, sp500, nasdaq }) => {
  const { t } = useTranslation()
  const safeVal = value ?? 50
  const trend = safeVal >= 65 ? 'risk-on' : safeVal <= 35 ? 'risk-off' : 'neutral'
  const trendColor = trend === 'risk-on' ? '34, 197, 94'
    : trend === 'risk-off' ? '239, 68, 68'
    : '234, 179, 8'

  return (
    <div className="cwb-stat-card cwb-alt" style={{ '--stat-rgb': trendColor }} data-trend={trend}>
      <div className="cwb-stat-accent" />
      <div className="cwb-stat-header">
        <span className="cwb-stat-label">{t('cinemaBar.riskAppetite')}</span>
      </div>
      <div className="cwb-stat-body">
        <span className="cwb-stat-value">{value ?? '-'}</span>
        <span className="cwb-stat-sublabel">{label || ''}</span>
      </div>
      <div className="cwb-alt-shares">
        <div className="cwb-alt-share">
          <span className="cwb-alt-dot" style={{ background: '#3b82f6' }} />
          <span>S&P {Number(sp500) >= 0 ? '+' : ''}{sp500}%</span>
        </div>
        <div className="cwb-alt-share">
          <span className="cwb-alt-dot" style={{ background: '#8b5cf6' }} />
          <span>NDQ {Number(nasdaq) >= 0 ? '+' : ''}{nasdaq}%</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX ALLOCATION - Stock mode replacement for Market Dominance
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaIndexAllocation = ({ allocation }) => {
  const { t } = useTranslation()
  const { sp500 = 45, nasdaq = 28, smallCap = 12, commodities = 15 } = allocation || {}

  return (
    <div className="cwb-stat-card cwb-dom" style={{ '--stat-rgb': '59, 130, 246' }}>
      <div className="cwb-stat-accent cwb-dom-accent" />
      <div className="cwb-stat-header">
        <span className="cwb-stat-label">{t('cinemaBar.indexAllocation')}</span>
      </div>
      <div className="cwb-dom-bar">
        <div className="cwb-dom-seg cwb-dom-btc" style={{ width: `${sp500}%` }}>
          {sp500 >= 15 && <span>{sp500.toFixed(0)}%</span>}
        </div>
        <div className="cwb-dom-seg cwb-dom-eth" style={{ width: `${nasdaq}%` }}>
          {nasdaq >= 10 && <span>{nasdaq.toFixed(0)}%</span>}
        </div>
        <div className="cwb-dom-seg cwb-dom-sol" style={{ width: `${smallCap}%` }} />
        <div className="cwb-dom-seg cwb-dom-alts" style={{ width: `${commodities}%` }} />
      </div>
      <div className="cwb-dom-legend">
        <span><span className="cwb-dom-dot" style={{ background: '#3b82f6' }} /> S&P</span>
        <span><span className="cwb-dom-dot" style={{ background: '#8b5cf6' }} /> NDQ</span>
        <span><span className="cwb-dom-dot" style={{ background: '#22c55e' }} /> Small</span>
        <span><span className="cwb-dom-dot" style={{ background: 'rgba(255,255,255,0.25)' }} /> Cmdty</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// US MARKET STATUS - Live open/closed with countdown
// ═══════════════════════════════════════════════════════════════════════════════

const useUsMarketStatus = () => {
  const [status, setStatus] = useState({ isOpen: false, label: 'Closed', time: '9:30 AM ET', countdown: '' })
  useEffect(() => {
    const calc = () => {
      const now = new Date()
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const day = et.getDay()
      const hrs = et.getHours()
      const mins = et.getMinutes()
      const isWeekday = day >= 1 && day <= 5
      const openMins = 9 * 60 + 30
      const closeMins = 16 * 60
      const cur = hrs * 60 + mins
      if (isWeekday && cur >= openMins && cur < closeMins) {
        const rem = closeMins - cur
        const h = Math.floor(rem / 60)
        const m = rem % 60
        setStatus({ isOpen: true, label: 'Live', time: '4:00 PM ET', countdown: h > 0 ? `Closes in ${h}h ${m}m` : `Closes in ${m}m` })
      } else if (isWeekday && cur < openMins) {
        const rem = openMins - cur
        const h = Math.floor(rem / 60)
        const m = rem % 60
        setStatus({ isOpen: false, label: 'Closed', time: '9:30 AM ET', countdown: h > 0 ? `Opens in ${h}h ${m}m` : `Opens in ${m}m` })
      } else {
        const nextDay = !isWeekday ? 'Monday' : day === 5 ? 'Monday' : 'Tomorrow'
        setStatus({ isOpen: false, label: 'Closed', time: `${nextDay} 9:30 AM ET`, countdown: `Opens ${nextDay}` })
      }
    }
    calc()
    const t = setInterval(() => { if (!document.hidden) calc() }, 60000)
    // recompute immediately when the tab becomes visible so the countdown is fresh
    const onVis = () => { if (!document.hidden) calc() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return status
}

const CinemaUsMarket = () => {
  const { t } = useTranslation()
  const s = useUsMarketStatus()
  const trendColor = s.isOpen ? '52, 211, 153' : '239, 68, 68'
  return (
    <div className="cwb-stat-card cwb-us-market" style={{ '--stat-rgb': trendColor }}>
      <div className="cwb-stat-accent" />
      <div className="cwb-stat-header">
        <span className="cwb-stat-label">US Market</span>
        <span className={`cwb-market-dot ${s.isOpen ? 'is-open' : 'is-closed'}`} />
      </div>
      <div className="cwb-stat-body">
        <span className="cwb-market-status-tag" data-open={s.isOpen}>{s.label}</span>
      </div>
      <div className="cwb-market-meta">
        <span className="cwb-market-time">{s.time}</span>
        {s.countdown && <span className="cwb-market-countdown">{s.countdown}</span>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaWelcomeBar = ({
  profile,
  dayMode,
  marketMode,
  topCoinPrices,
  fearGreed,
  altSeason,
  marketDominance,
  selectToken,
  stockPrices,
  liveVix,
  stocksRiskOnOff,
  indexAllocation,
}) => {
  const { t } = useTranslation()
  const { fmtLarge } = useCurrency()
  const isStocks = marketMode === 'stocks'
  const name = profile?.name || 'Trader'
  const btcData = topCoinPrices?.BTC || {}
  const ethData = topCoinPrices?.ETH || {}
  const solData = topCoinPrices?.SOL || {}

  // Stock data for price cards
  const spyData = stockPrices?.SPY || {}
  const qqqData = stockPrices?.QQQ || {}
  const aaplData = stockPrices?.AAPL || {}

  const rawMcap = computeGlobalMcap(btcData.marketCap, marketDominance?.btc || 50)
  const globalMcap = rawMcap ? fmtLarge(rawMcap) : '-'
  const rawVolume = computeGlobalVolume(
    btcData.volume || 0,
    ethData.volume || 0,
    solData.volume || 0,
    marketDominance || { btc: 50, eth: 15, sol: 3 }
  )
  const globalVolume = rawVolume ? fmtLarge(rawVolume) : '-'
  const btcChange = btcData.change
  const btcChangeNum = typeof btcChange === 'string' ? parseFloat(btcChange) : (btcChange || 0)

  // Time-based greeting
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('cinemaBar.goodMorning') : hour < 18 ? t('cinemaBar.goodAfternoon') : t('cinemaBar.goodEvening')

  // Market mood text - VIX-based for stocks, Fear & Greed for crypto
  const moodText = isStocks
    ? (liveVix?.price != null
      ? (liveVix.price >= 30 ? t('cinemaBar.extremeVolatility') : liveVix.price >= 25 ? t('cinemaBar.highVolatility') : liveVix.price >= 20 ? t('cinemaBar.elevatedVolatility') : liveVix.price >= 15 ? t('cinemaBar.normalConditions') : t('cinemaBar.lowVolatility'))
      : t('cinemaBar.loadingMarketData'))
    : (() => {
      const fgVal = fearGreed?.value ?? 50
      return fgVal >= 70 ? t('cinemaBar.marketsEuphoric') : fgVal >= 55 ? t('cinemaBar.sentimentBullish') : fgVal <= 30 ? t('cinemaBar.marketsInFear') : fgVal <= 45 ? t('cinemaBar.cautiousSentiment') : t('cinemaBar.neutralTerritory')
    })()

  const moodSub = isStocks
    ? (liveVix?.price != null ? `VIX ${liveVix.price.toFixed(2)}` : 'Loading')
    : (fearGreed?.classification || 'Loading')

  return (
    <header className="cinema-welcome-bar cwb-storybook">
      {/* Single row: Greeting | Price Cards | Stats + Gauges */}
      <div className="cwb-single-row">
        {/* Left: Greeting */}
        <div className="cwb-greeting-section">
          <div className="cwb-profile-avatar">
            {profile?.imageUrl ? (
              <img src={profile.imageUrl} alt="" />
            ) : (
              <span>{name[0]?.toUpperCase() || 'T'}</span>
            )}
            <div className="cwb-profile-ring" />
          </div>
          <div className="cwb-greeting-text">
            <h1 className="cwb-profile-greeting">
              {greeting}, <em>{name}</em>
            </h1>
            <span className="cwb-mood-line">{moodText} · {moodSub}</span>
          </div>
        </div>

        {/* Center: Price Cards */}
        <div className="cwb-center">
          {isStocks ? (
            <>
              <CinemaPriceCard symbol="SPY" data={spyData} onClick={selectToken} index={0} />
              <CinemaPriceCard symbol="QQQ" data={qqqData} onClick={selectToken} index={1} />
              <CinemaPriceCard symbol="AAPL" data={aaplData} onClick={selectToken} index={2} />
            </>
          ) : (
            <>
              <CinemaPriceCard symbol="BTC" data={btcData} onClick={selectToken} index={0} />
              <CinemaPriceCard symbol="ETH" data={ethData} onClick={selectToken} index={1} />
              <CinemaPriceCard symbol="SOL" data={solData} onClick={selectToken} index={2} />
            </>
          )}
        </div>

        {/* Right: Gauges + Stats */}
        <div className="cwb-right">
          <CinemaUsMarket />
          {isStocks ? (
            <>
              <CinemaVixGauge value={liveVix?.price} label={liveVix?.label} change={liveVix?.change} />
              <CinemaRiskAppetite value={stocksRiskOnOff?.value} label={stocksRiskOnOff?.label} sp500={stocksRiskOnOff?.sp500} nasdaq={stocksRiskOnOff?.nasdaq} />
              <CinemaIndexAllocation allocation={indexAllocation} />
            </>
          ) : (
            <>
              <CinemaFearGreedGauge value={fearGreed?.value} classification={fearGreed?.classification} />
              <CinemaAltSeason
                value={altSeason?.value}
                label={altSeason?.label}
                btcShare={altSeason?.btcShare || 50}
                ethShare={altSeason?.ethShare || 10}
              />
              <CinemaMarketDominance dominance={marketDominance} />
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default CinemaWelcomeBar
