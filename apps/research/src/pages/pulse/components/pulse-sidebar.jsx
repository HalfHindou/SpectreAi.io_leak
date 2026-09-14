import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTopCoinPrices } from '@/services/binanceApi'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { getGlobalMetrics } from '@/services/fearGreedApi'
import useFearGreed from '@/pages/home/components/use-fear-greed'
import Sparkline from '@/pages/home/components/sparkline'
import { getTokenRowStyle, getTokenAvatarRingStyle } from '@/constants/tokenColors'
import SparkChart from './spark-chart'
import './pulse-sidebar.css'

/* --- Fallback mock sparkline generator --- */
const rw = (base, vol, n = 60) => {
  const pts = [base]
  for (let i = 1; i < n; i++) {
    pts.push(pts[i - 1] + (Math.random() - 0.48) * vol)
  }
  return pts
}

const HERO_TOKENS = ['BTC', 'ETH', 'SOL']

const TOKEN_META = {
  BTC: { name: 'Bitcoin', logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png' },
  ETH: { name: 'Ethereum', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  SOL: { name: 'Solana', logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
}

/* --- Data Hook --- */

function usePulseSidebarData() {
  const [prices, setPrices] = useState(null)
  const [topCoins, setTopCoins] = useState(null)
  const [globalStats, setGlobalStats] = useState(null)
  const fearGreed = useFearGreed()

  useEffect(() => {
    let mounted = true
    const fetchPrices = async () => {
      try {
        const data = await getTopCoinPrices(HERO_TOKENS)
        if (mounted && data && Object.keys(data).length > 0) setPrices(data)
      } catch (_) { /* ignore */ }
    }
    fetchPrices()
    const interval = setInterval(() => { if (!document.hidden) fetchPrices() }, 30000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  useEffect(() => {
    let mounted = true
    const fetchTopCoins = async () => {
      try {
        const data = await getTopCoinsMarketsPage(1, 10)
        if (mounted && Array.isArray(data) && data.length > 0) setTopCoins(data)
      } catch (_) { /* ignore */ }
    }
    fetchTopCoins()
    const interval = setInterval(() => { if (!document.hidden) fetchTopCoins() }, 120000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  useEffect(() => {
    let mounted = true
    const fetchGlobal = async () => {
      try {
        const data = await getGlobalMetrics()
        if (mounted && data) setGlobalStats(data)
      } catch (_) { /* ignore */ }
    }
    fetchGlobal()
    const interval = setInterval(() => { if (!document.hidden) fetchGlobal() }, 120000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  return { prices, topCoins, fearGreed, globalStats }
}

/* --- Helpers --- */

function formatPrice(p) {
  if (p == null || isNaN(p)) return '0.00'
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1) return p.toFixed(2)
  if (p >= 0.01) return p.toFixed(4)
  return p.toFixed(6)
}

function formatLargeNum(n) {
  if (n == null || isNaN(n)) return '$0'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function fngClassification(v) {
  if (v >= 75) return 'Extreme Greed'
  if (v >= 60) return 'Greed'
  if (v >= 40) return 'Neutral'
  if (v >= 25) return 'Fear'
  return 'Extreme Fear'
}

/* --- AnimatedValue --- */

function AnimatedValue({ value, prefix = '', suffix = '', formatFn, className = '' }) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)
  const rafRef = useRef(null)

  useEffect(() => {
    if (value == null || isNaN(value)) return
    if (prevRef.current === value) return
    const start = prevRef.current
    const end = value
    const duration = 600
    const startTime = performance.now()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const animate = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(start + (end - start) * eased)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        prevRef.current = end
        rafRef.current = null
      }
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value])

  useEffect(() => {
    if (value != null && !isNaN(value) && prevRef.current === value) {
      setDisplay(value)
    }
  }, [value])

  const formatted = formatFn ? formatFn(display) : formatPrice(display)
  return <span className={className}>{prefix}{formatted}{suffix}</span>
}

function ChangeText({ value, className = '' }) {
  if (value == null || isNaN(value)) return null
  const positive = value >= 0
  return (
    <span className={`ps-change ${positive ? 'ps-change--bull' : 'ps-change--bear'} ${className}`}>
      {positive ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}

/* --- Price Cards - with colored sparklines --- */

function PriceCards({ prices }) {
  // 2026-05-26 beta-quality fix: drop the BTC=$87421 / ETH=$2048 / SOL=$142
  // hardcoded fallback row that rendered when the Binance fetch was in-flight
  // or had errored. Hide the affected card until live data arrives instead.
  const cards = HERO_TOKENS.map(sym => {
    const meta = TOKEN_META[sym]
    const live = prices?.[sym]
    if (live && live.price > 0) {
      return {
        symbol: sym, name: meta.name, logo: live.logo || meta.logo,
        price: live.price, change: live.change || 0,
        // 2026-05-26 beta-quality fix: no Math.random sparkline walk fallback.
        // If upstream lacks sparkline_7d, render an empty array (Sparkline shows nothing).
        spark: live.sparkline_7d || [],
      }
    }
    return null
  }).filter(Boolean)

  if (cards.length === 0) return null

  return (
    <div className="ps-price-cards">
      {cards.map(t => {
        const sparkColor = t.change >= 0 ? '#10B981' : '#EF4444'
        return (
          <div key={t.symbol} className="ps-price-card">
            <div className="ps-pc-top">
              <div className="ps-pc-left">
                <img src={t.logo} alt={t.symbol} className="ps-pc-logo" width="20" height="20" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                <span className="ps-pc-name">{t.symbol}</span>
              </div>
              <ChangeText value={t.change} className="ps-pc-change" />
            </div>
            <div className="ps-pc-price-row">
              <AnimatedValue value={t.price} prefix="$" className="ps-pc-price" />
            </div>
            <div className="ps-pc-chart">
              <SparkChart data={t.spark} width={200} height={52} color={sparkColor} showDot showGrid={false} type="area" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* --- Fear & Greed + Market Stats - Single Dense Panel --- */

function MarketPanel({ fearGreed, globalStats }) {
  // 2026-05-26 beta-quality fix: don't render fake F&G=35/btcDom=58.4/ethDom=10.2/
  // mcap=$2.41T/vol=$89.2B when upstream is loading. Use null + em-dash placeholder.
  const fng = fearGreed?.value
  const btcDom = globalStats?.btcDominance
  const ethDom = globalStats?.ethDominance
  const mcap = globalStats?.totalMarketCap
  const vol = globalStats?.totalVolume
  const mcapChange = globalStats?.marketCapChange24h

  // FnG needle position for the gradient bar
  const fngPct = fng != null ? Math.min(100, Math.max(0, fng)) : 50

  return (
    <div className="ps-market-panel">
      {/* Fear & Greed - gradient bar */}
      <div className="ps-mp-fng">
        <div className="ps-mp-fng-header">
          <span className="ps-mp-label">Fear & Greed</span>
          <span className="ps-mp-fng-class" style={{ color: fng != null && fng >= 60 ? 'var(--bull)' : fng != null && fng >= 40 ? 'var(--text-tertiary)' : fng != null ? 'var(--bear)' : 'var(--text-muted)' }}>
            {fng != null ? fngClassification(fng) : '—'}
          </span>
        </div>
        <div className="ps-mp-fng-row">
          <span className="ps-mp-fng-value">{fng != null ? fng : '—'}</span>
          <div className="ps-mp-fng-bar">
            <div className="ps-mp-fng-track" />
            {fng != null && <div className="ps-mp-fng-needle" style={{ left: `${fngPct}%` }} />}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="ps-mp-divider" />

      {/* Market stats - dense horizontal rows */}
      <div className="ps-mp-stats">
        <div className="ps-mp-stat-row">
          <span className="ps-mp-stat-label">Market Cap</span>
          <span className="ps-mp-stat-value">
            {mcap ? formatLargeNum(mcap) : '—'}
            {mcapChange != null && (
              <span className={`ps-mp-stat-delta ${mcapChange >= 0 ? 'ps-mp-stat-delta--bull' : 'ps-mp-stat-delta--bear'}`}>
                {mcapChange >= 0 ? '+' : ''}{mcapChange.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
        <div className="ps-mp-stat-row">
          <span className="ps-mp-stat-label">24h Volume</span>
          <span className="ps-mp-stat-value">{vol ? formatLargeNum(vol) : '—'}</span>
        </div>
        <div className="ps-mp-stat-row">
          <span className="ps-mp-stat-label">BTC Dominance</span>
          <span className="ps-mp-stat-value">{btcDom != null ? `${btcDom.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="ps-mp-stat-row">
          <span className="ps-mp-stat-label">ETH Dominance</span>
          <span className="ps-mp-stat-value">{ethDom != null ? `${ethDom.toFixed(1)}%` : '—'}</span>
        </div>
      </div>
    </div>
  )
}

/* --- AI Brief - Cinematic --- */

function AIBriefMini({ prices, fearGreed, globalStats }) {
  const [slideIndex, setSlideIndex] = useState(0)
  const [fading, setFading] = useState(false)

  const slides = useMemo(() => {
    const fng = fearGreed?.value || 35
    const btcPrice = prices?.BTC?.price || 87000
    const ethPrice = prices?.ETH?.price || 2048
    const solPrice = prices?.SOL?.price || 142
    const mcap = globalStats?.totalMarketCap
    const btcDom = globalStats?.btcDominance

    return [
      `Bitcoin trading at $${formatPrice(btcPrice)} with ${fng > 50 ? 'bullish' : 'cautious'} sentiment. Fear & Greed at ${fng} - ${fngClassification(fng)}.`,
      `Ethereum at $${formatPrice(ethPrice)}. ${ethPrice > 2000 ? 'Holding above key $2K support.' : 'Testing critical support levels.'} DeFi TVL steady.`,
      `Solana momentum ${solPrice > 140 ? 'strong' : 'building'} at $${formatPrice(solPrice)}. Ecosystem activity remains elevated across DEX volumes.`,
      mcap ? `Total crypto market cap at ${formatLargeNum(mcap)}. ${btcDom > 55 ? 'BTC dominance elevated - alt rotation may follow.' : 'Alts gaining relative strength.'}` : 'Market structure favors selective positioning. Focus on high-conviction setups.',
      `Risk management key: ${fng > 70 ? 'Extreme greed signals potential correction. Tighten stops.' : fng < 30 ? 'Fear creates opportunity. Scale into strength.' : 'Neutral zone - follow the trend, not the crowd.'}`,
    ]
  }, [prices, fearGreed, globalStats])

  useEffect(() => {
    const timer = setInterval(() => {
      setFading(true)
      setTimeout(() => {
        setSlideIndex(i => (i + 1) % slides.length)
        setFading(false)
      }, 300)
    }, 8000)
    return () => clearInterval(timer)
  }, [slides.length])

  return (
    <div className="ps-brief">
      <div className="ps-brief-glow" aria-hidden="true" />
      <div className="ps-brief-header">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span className="ps-brief-title">AI Brief</span>
        <span className="ps-brief-live">Live</span>
      </div>
      <div className={`ps-brief-text ${fading ? 'ps-brief-text--fading' : ''}`}>
        {slides[slideIndex]}
      </div>
      <div className="ps-brief-dots">
        {slides.map((_, i) => (
          <button key={i} className={`ps-brief-dot ${i === slideIndex ? 'ps-brief-dot--active' : ''}`} onClick={() => { setSlideIndex(i); setFading(false) }} aria-label={`Slide ${i + 1}`} />
        ))}
      </div>
      <div className="ps-brief-attr">Spectre Intelligence</div>
    </div>
  )
}

/* --- Trending Assets - Top movers by 24h change --- */

function TrendingAssets({ topCoins }) {
  if (!topCoins || topCoins.length === 0) return null
  const trending = [...topCoins]
    .sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0))
    .slice(0, 5)

  return (
    <div className="ps-section">
      <h3 className="ps-section-title">Trending Now</h3>
      <div className="ps-trending">
        {trending.map((coin, i) => {
          const sym = (coin.symbol || '').toUpperCase()
          const change = coin.price_change_percentage_24h || 0
          const positive = change >= 0
          return (
            <div key={coin.id || sym} className="ps-trend-row">
              <span className="ps-trend-rank">{i + 1}</span>
              {coin.image ? (
                <img src={coin.image} alt={sym} className="ps-trend-logo" width="24" height="24" loading="lazy" />
              ) : (
                <div className="ps-trend-logo ps-trend-logo--fallback">{sym[0]}</div>
              )}
              <div className="ps-trend-info">
                <span className="ps-trend-name">{coin.name}</span>
                <span className="ps-trend-symbol">{sym}</span>
              </div>
              <div className="ps-trend-data">
                <span className="ps-trend-price">${formatPrice(coin.current_price)}</span>
                <span className={`ps-change ${positive ? 'ps-change--bull' : 'ps-change--bear'}`}>
                  {positive ? '+' : ''}{change.toFixed(1)}%
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* --- Volume Leaders - Top 5 by 24h volume --- */

function VolumeLeaders({ topCoins }) {
  if (!topCoins || topCoins.length === 0) return null
  const leaders = [...topCoins]
    .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
    .slice(0, 5)

  return (
    <div className="ps-section">
      <h3 className="ps-section-title">Volume Leaders</h3>
      <div className="ps-vol-leaders">
        {leaders.map((coin) => {
          const sym = (coin.symbol || '').toUpperCase()
          const vol = coin.total_volume
          const volStr = vol >= 1e9 ? `$${(vol / 1e9).toFixed(1)}B` : vol >= 1e6 ? `$${(vol / 1e6).toFixed(0)}M` : `$${Math.round(vol).toLocaleString()}`
          return (
            <div key={coin.id || sym} className="ps-vol-row">
              {coin.image ? (
                <img src={coin.image} alt={sym} className="ps-vol-logo" width="20" height="20" loading="lazy" />
              ) : (
                <div className="ps-vol-logo ps-vol-logo--fallback">{sym[0]}</div>
              )}
              <span className="ps-vol-symbol">{sym}</span>
              <span className="ps-vol-amount">{volStr}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* --- Top Coins - Compact Rows --- */

function PulseTopCoins({ topCoins }) {
  const navigate = useNavigate()
  if (!topCoins || topCoins.length === 0) return null
  const coins = topCoins.slice(0, 8)

  return (
    <div className="ps-section ps-section--flush">
      <h3 className="ps-section-title">Top Coins</h3>
      <div className="ps-topcoins">
        {coins.map((coin, i) => {
          const sym = (coin.symbol || '').toUpperCase()
          const change = coin.price_change_percentage_24h || 0
          const positive = change >= 0
          const spark = coin.sparkline_in_7d?.price
          return (
            <div key={coin.id || sym} className={`ps-tc-row ${i % 2 === 1 ? 'ps-tc-row--alt' : ''}`} onClick={() => navigate(`/token?id=${coin.id}`)} style={getTokenRowStyle(sym)}>
              <span className="ps-tc-rank">{i + 1}</span>
              <div className="ps-tc-avatar" style={getTokenAvatarRingStyle(sym)}>
                <div className="ps-tc-avatar-inner">
                  {coin.image ? (
                    <img src={coin.image} alt={sym} width="22" height="22" loading="lazy" />
                  ) : (
                    <span>{sym[0]}</span>
                  )}
                </div>
              </div>
              <div className="ps-tc-info">
                <span className="ps-tc-symbol">{sym}</span>
              </div>
              {spark && spark.length > 10 && (
                <div className="ps-tc-spark">
                  <Sparkline data={spark} positive={positive} width={48} height={18} />
                </div>
              )}
              <span className="ps-tc-price">${formatPrice(coin.current_price)}</span>
              <ChangeText value={change} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* --- Main Sidebar --- */

export default function PulseSidebar({ dayMode }) {
  const { prices, topCoins, fearGreed, globalStats } = usePulseSidebarData()

  const handleSidebarMouseMove = useCallback((e) => {
    const card = e.target.closest('.ps-section, .ps-price-card, .ps-topcoins, .ps-market-panel, .ps-brief')
    if (!card) return
    const rect = card.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1)
    const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1)
    card.style.setProperty('--spot-x', x + '%')
    card.style.setProperty('--spot-y', y + '%')
  }, [])

  return (
    <aside className="ps-sidebar" onMouseMove={handleSidebarMouseMove}>
      <PriceCards prices={prices} />
      <MarketPanel fearGreed={fearGreed} globalStats={globalStats} />
      <TrendingAssets topCoins={topCoins} />
      <AIBriefMini prices={prices} fearGreed={fearGreed} globalStats={globalStats} />
      <VolumeLeaders topCoins={topCoins} />
      <PulseTopCoins topCoins={topCoins} />
    </aside>
  )
}

/* Export the data hook so pulse-page.jsx can access topCoins for market widgets */
export { usePulseSidebarData }
