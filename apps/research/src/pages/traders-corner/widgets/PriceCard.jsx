/**
 * W-001 · Price Card Widget
 * Creative hero card with token-specific gradient backgrounds.
 * Inspired by Superpower/Apple card design — immersive, cinematic.
 *
 * Fetches directly from /api/binance-ticker (backend proxy, cached).
 * All 4 PriceCards share one module-level fetch — zero duplication.
 * Sparklines use CoinGecko/Binance chart history so Spectre metric sparsity does not flatten cards.
 *
 * Remix modes: hero (full), compact (horizontal row), mini (price-only).
 * Auto-adapts layout when container is resized below breakpoints.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getSpectrePricesBySymbols, getSpectreSparkline } from '@/services/spectreMarketApi'
import './PriceCard.css'

/* ── Shared fetch cache (module-level, all PriceCards share it) ── */
let tickerCache = null
let tickerPromise = null
let tickerAge = 0

async function getTickerData() {
  // Cache for 10s
  if (tickerCache && Date.now() - tickerAge < 10000) return tickerCache
  // Deduplicate concurrent calls
  if (tickerPromise) return tickerPromise

  tickerPromise = (async () => {
    try {
      const prices = await getSpectrePricesBySymbols(Object.keys(THEMES))
      if (prices && Object.keys(prices).length > 0) {
        const map = {}
        Object.entries(prices).forEach(([symbol, row]) => {
          map[`${symbol}USDT`] = {
            symbol: `${symbol}USDT`,
            lastPrice: String(row.price ?? 0),
            priceChangePercent: String(row.change24h ?? row.change ?? 0),
            quoteVolume: String(row.volume ?? 0),
            highPrice: String(row.high24h ?? 0),
            lowPrice: String(row.low24h ?? 0),
          }
        })
        tickerCache = map
        tickerAge = Date.now()
      }
    } catch (err) {
      try {
        const res = await fetch('/api/binance-ticker')
        if (res.ok) {
          const data = await res.json()
          const map = {}
          data.forEach(t => { if (t.symbol && t.lastPrice) map[t.symbol] = t })
          tickerCache = map
          tickerAge = Date.now()
        }
      } catch (_) { console.error(_) }
    }
    tickerPromise = null
    return tickerCache
  })()

  return tickerPromise
}

/* ── Chart sparkline (shared cache) ── */
const sparkCache = {}

async function fetchSparkline(symbol) {
  const pair = `${symbol}USDT`
  if (sparkCache[pair]?.ts > Date.now() - 120000) return sparkCache[pair].data

  try {
    const spectreLine = await getSpectreSparkline(symbol, { days: 1 })
    if (Array.isArray(spectreLine) && spectreLine.length > 1) {
      const closes = spectreLine.slice(-48)
      sparkCache[pair] = { data: closes, ts: Date.now() }
      return closes
    }
  } catch (_) { console.error(_) }

  // Local dashboards often mount several price widgets at once. Avoid turning
  // those decorative sparklines into a CoinGecko rate-limit storm during audits.
  if (import.meta.env.DEV) return null

  const cgId = SYMBOL_TO_COINGECKO_ID[symbol]
  if (cgId) {
    try {
      const res = await fetch(`/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=1`)
      if (res.ok) {
        const data = await res.json()
        const closes = (data.prices || [])
          .map(([, price]) => Number(price))
          .filter((price) => Number.isFinite(price) && price > 0)
          .slice(-48)
        if (closes.length > 1) {
          sparkCache[pair] = { data: closes, ts: Date.now() }
          return closes
        }
      }
    } catch (_) { console.error(_) }
  }

  try {
    if (import.meta.env.DEV) return null
    const res = await fetch(`/api/binance-klines?symbol=${pair}&interval=1h&limit=24`)
    if (!res.ok) return null
    const klines = await res.json()
    const closes = klines.map(k => parseFloat(k[4])).filter((price) => Number.isFinite(price) && price > 0)
    if (!closes.length) return null
    sparkCache[pair] = { data: closes, ts: Date.now() }
    return closes
  } catch (_) { return null }
}

/* ── Token brand themes ── */
const THEMES = {
  BTC: {
    gradient: 'linear-gradient(135deg, #F7931A 0%, #E8720C 30%, #C25E08 60%, #8B3F06 100%)',
    accent: '#FFC266',
    glow: 'rgba(247, 147, 26, 0.4)',
    icon: '₿',
    overlay: 'radial-gradient(circle at 85% 20%, rgba(255,194,102,0.3) 0%, transparent 50%), radial-gradient(circle at 15% 80%, rgba(139,63,6,0.4) 0%, transparent 50%)',
  },
  ETH: {
    gradient: 'linear-gradient(135deg, #627EEA 0%, #4A6BD4 30%, #3558BE 60%, #1A3A8C 100%)',
    accent: '#A5B4F4',
    glow: 'rgba(98, 126, 234, 0.4)',
    icon: 'Ξ',
    overlay: 'radial-gradient(circle at 80% 15%, rgba(165,180,244,0.25) 0%, transparent 45%), radial-gradient(circle at 20% 85%, rgba(26,58,140,0.4) 0%, transparent 50%)',
  },
  SOL: {
    gradient: 'linear-gradient(135deg, #14F195 0%, #0DD87E 25%, #06B968 50%, #039652 75%, #027A42 100%)',
    accent: '#7DFBC7',
    glow: 'rgba(20, 241, 149, 0.35)',
    icon: '◎',
    overlay: 'radial-gradient(circle at 75% 25%, rgba(125,251,199,0.25) 0%, transparent 45%), radial-gradient(circle at 25% 80%, rgba(2,122,66,0.4) 0%, transparent 50%)',
  },
  BNB: {
    gradient: 'linear-gradient(135deg, #F0B90B 0%, #D9A60A 30%, #B88D08 60%, #8C6B06 100%)',
    accent: '#FFD966',
    glow: 'rgba(240, 185, 11, 0.4)',
    icon: '◆',
    overlay: 'radial-gradient(circle at 80% 20%, rgba(255,217,102,0.25) 0%, transparent 45%), radial-gradient(circle at 20% 80%, rgba(140,107,6,0.4) 0%, transparent 50%)',
  },
}

const DEFAULT_THEME = {
  gradient: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 40%, #3730A3 100%)',
  accent: '#A5B4FC',
  glow: 'rgba(99, 102, 241, 0.4)',
  icon: '●',
  overlay: 'radial-gradient(circle at 80% 20%, rgba(165,180,252,0.2) 0%, transparent 45%)',
}

/* ── Formatters ── */
function formatPrice(raw) {
  const price = Number(raw)
  if (!price || isNaN(price)) return '—'
  if (price >= 1) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (price >= 0.01) return `$${price.toFixed(4)}`
  return `$${price.toFixed(6)}`
}

function formatAbbrev(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '—'
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`
  return `$${num.toLocaleString()}`
}

function Sparkline({ data }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 80
  const h = 36
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', flexShrink: 0, opacity: 0.7 }}>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${points} ${w},${h}`}
        fill="url(#spark-fill)"
      />
      <polyline
        points={points}
        fill="none"
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ── Remix modes ── */
const MODES = ['hero', 'compact', 'mini']

/* ── Component ── */
export default function PriceCard({ symbol, name }) {
  const [ticker, setTicker] = useState(null)
  const [sparkline, setSparkline] = useState(null)
  const theme = THEMES[symbol] || DEFAULT_THEME
  const pair = `${symbol}USDT`

  // Remix mode (persisted per symbol)
  const storageKey = `spectre:you-remix-price-${symbol}`
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(storageKey) || 'hero' } catch { return 'hero' }
  })

  // Container size detection
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ w: 300, h: 300 })

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: width, h: height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const cycleMode = (e) => {
    e.stopPropagation()
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
    setMode(next)
    try { localStorage.setItem(storageKey, next) } catch {}
  }

  // Determine effective mode based on container size
  const isNarrow = dims.w < 200
  const isTiny = dims.w < 140
  const isShort = dims.h < 180
  const effectiveMode = isTiny ? 'mini' : mode

  const refreshTicker = useCallback(async () => {
    tickerCache = null // bust cache
    const map = await getTickerData()
    if (map?.[pair]) setTicker(map[pair])
  }, [pair])

  useEffect(() => {
    // Fetch price immediately
    async function load() {
      const map = await getTickerData()
      if (map?.[pair]) setTicker(map[pair])
    }
    load()
  }, [pair])

  useAdaptivePolling(refreshTicker, { interval: 10000 })

  const refreshSparkline = useCallback(async () => {
    sparkCache[pair] = null
    const data = await fetchSparkline(symbol)
    if (data) setSparkline(data)
  }, [symbol, pair])

  // Staggered sparkline initial load
  useEffect(() => {
    let cancelled = false
    const delays = { BTC: 0, ETH: 300, SOL: 600, BNB: 900 }
    // Deterministic stagger for any other symbol: spread by first char-code so
    // the delay is stable across renders instead of random each mount.
    const fallbackDelay = ((symbol || '').charCodeAt(0) % 8) * 150
    const delay = delays[symbol] ?? fallbackDelay

    const timer = setTimeout(async () => {
      const data = await fetchSparkline(symbol)
      if (!cancelled && data) setSparkline(data)
    }, delay)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [symbol])

  useAdaptivePolling(refreshSparkline, { interval: 300000 })

  const price = ticker ? parseFloat(ticker.lastPrice) : null
  const change = ticker ? parseFloat(ticker.priceChangePercent) : null
  const vol = ticker ? parseFloat(ticker.quoteVolume) : null
  const positive = (change ?? 0) >= 0

  /* ── Remix button (shared across all modes) ── */
  const remixBtn = (
    <button className="you-remix-btn tcp-remix" onClick={cycleMode}>
      {effectiveMode === 'hero' ? 'H' : effectiveMode === 'compact' ? 'C' : 'M'}
    </button>
  )

  /* ── Change badge (reused across modes) ── */
  const changeBadge = change != null ? (
    <span className={`tcp-badge ${effectiveMode === 'mini' ? 'tcp-badge--mini' : 'tcp-badge--hero'} ${positive ? 'tcp-badge--up' : 'tcp-badge--down'}`}>
      {positive ? '▲' : '▼'} {Math.abs(Number(change) || 0).toFixed(2)}%
    </span>
  ) : null

  // Shimmer loading (adapts to size)
  if (!ticker) {
    const isCompactShimmer = effectiveMode === 'compact'
    const isMiniShimmer = effectiveMode === 'mini' || isTiny

    return (
      <div ref={containerRef} className="tcp tcp-shimmer" style={{
        background: theme.gradient,
        flexDirection: isMiniShimmer ? 'column' : isCompactShimmer ? 'row' : 'column',
        alignItems: isMiniShimmer ? 'center' : isCompactShimmer ? 'center' : 'stretch',
        justifyContent: isMiniShimmer ? 'center' : 'flex-start',
        gap: isMiniShimmer ? 8 : isCompactShimmer ? 10 : 12,
        padding: isMiniShimmer ? 12 : isCompactShimmer ? '12px 16px' : 20,
      }}>
        {remixBtn}
        {isMiniShimmer ? (
          <>
            <div className="tcp-skel" style={{ width: 32, height: 10 }} />
            <div className="tcp-skel" style={{ width: 64, height: 22, animationDelay: '0.1s' }} />
            <div className="tcp-skel" style={{ width: 48, height: 10, animationDelay: '0.2s' }} />
          </>
        ) : isCompactShimmer ? (
          <>
            <div className="tcp-skel" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
            <div className="tcp-skel" style={{ width: 40, height: 12, animationDelay: '0.1s' }} />
            <div style={{ flex: 1 }} />
            <div className="tcp-skel" style={{ width: 60, height: 16, animationDelay: '0.15s' }} />
            <div className="tcp-skel" style={{ width: 48, height: 12, animationDelay: '0.2s' }} />
          </>
        ) : (
          <>
            <div className="tcp-skel" style={{ width: '40%', height: 10 }} />
            <div className="tcp-skel" style={{ width: '60%', height: 28, animationDelay: '0.1s' }} />
            <div className="tcp-skel" style={{ width: '30%', height: 10, animationDelay: '0.2s' }} />
          </>
        )}
      </div>
    )
  }

  /* ═══════════════════════════════════════════
   *  MINI MODE — centered price, symbol above, change below
   * ═══════════════════════════════════════════ */
  if (effectiveMode === 'mini') {
    return (
      <div ref={containerRef} className="tcp tcp--mini" style={{ background: theme.gradient }}>
        {/* Atmospheric overlay */}
        <div className="tcp-overlay" style={{ background: theme.overlay }} />

        {remixBtn}

        {/* Content */}
        <div className="tcp-mini-body">
          <span className="tcp-mini-symbol">{symbol}</span>
          <span className="tcp-mini-price" style={{ fontSize: isTiny ? 18 : 22, textShadow: `0 2px 12px ${theme.glow}` }}>
            {formatPrice(price)}
          </span>
          {changeBadge}
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════
   *  COMPACT MODE — horizontal row: icon circle + symbol + price + change
   * ═══════════════════════════════════════════ */
  if (effectiveMode === 'compact') {
    return (
      <div ref={containerRef} className="tcp tcp--compact" style={{ background: theme.gradient }}>
        {/* Atmospheric overlay */}
        <div className="tcp-overlay" style={{ background: theme.overlay }} />

        {remixBtn}

        {/* Icon circle */}
        <div className="tcp-compact-icon">{theme.icon}</div>

        {/* Symbol + name */}
        <div className="tcp-compact-names">
          <span className="tcp-compact-symbol">{symbol}</span>
          {!isNarrow && <span className="tcp-compact-name">{name}</span>}
        </div>

        {/* Spacer */}
        <div className="tcp-spacer" />

        {/* Price + change */}
        <div className="tcp-compact-figures">
          <span className="tcp-compact-price" style={{ fontSize: isNarrow ? 14 : 16, textShadow: `0 1px 8px ${theme.glow}` }}>
            {formatPrice(price)}
          </span>
          {!isNarrow && changeBadge}
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════
   *  HERO MODE (default) — full layout with sparkline, icon backdrop, volume footer
   *  Hides sparkline when narrow, hides vol footer when short or narrow
   * ═══════════════════════════════════════════ */
  return (
    <div ref={containerRef} className="tcp tcp--hero" style={{
      background: theme.gradient,
      padding: isNarrow ? '14px 14px 12px' : '18px 20px 16px',
    }}>
      {/* Atmospheric overlay */}
      <div className="tcp-overlay" style={{ background: theme.overlay }} />

      {/* Large faded icon backdrop */}
      {!isNarrow && <div className="tcp-icon-bg">{theme.icon}</div>}

      {remixBtn}

      {/* Content */}
      <div className="tcp-hero-body">

        {/* Token name row */}
        <div className="tcp-hero-namerow">
          <span className="tcp-hero-name" style={{ fontSize: isNarrow ? 12 : 13 }}>{name}</span>
          <span className="tcp-hero-symbol">{symbol}</span>
        </div>

        {/* Price + Sparkline */}
        <div className="tcp-hero-pricerow">
          <div className="tcp-hero-price" style={{ fontSize: isNarrow ? 20 : 26, textShadow: `0 2px 12px ${theme.glow}` }}>
            {formatPrice(price)}
          </div>
          {!isNarrow && <Sparkline data={sparkline} />}
        </div>

        {/* 24h Change pill */}
        {changeBadge && (
          <div className="tcp-hero-badge-wrap">{changeBadge}</div>
        )}

        {/* Vol footer — hidden when narrow or short */}
        {!isNarrow && !isShort && (
          <div className="tcp-hero-footer">
            <div className="tcp-stat">
              <span className="tcp-stat-label">Vol 24h</span>
              <span className="tcp-stat-value">{formatAbbrev(vol)}</span>
            </div>
            <div className="tcp-stat">
              <span className="tcp-stat-label">24h Chg</span>
              <span className={`tcp-stat-value ${positive ? 'tcp-stat-value--up' : 'tcp-stat-value--down'}`}>
                {positive ? '+' : ''}{Number(change || 0).toFixed(2)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
