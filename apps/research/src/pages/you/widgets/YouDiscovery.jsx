/**
 * YouDiscovery — Trending tokens discovery widget.
 * Toggle between Trending and Top Gainers views.
 * Fetches real data from CoinGecko, falls back to static mock.
 * Supports 3 remix modes: list (default), grid, minimal.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useCurrency } from '@/hooks/useCurrency'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { getSpectreMarketTrending } from '@/services/spectreMarketApi'

// 2026-05-26 beta-quality fix: removed Jan-2025 trending/gainers snapshots
// that would render as "live" if the API call failed.
const FALLBACK_TRENDING = []
const FALLBACK_GAINERS = []

const avatarColor = (sym) => {
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#6366f1']
  let hash = 0
  for (let i = 0; i < sym.length; i++) hash = sym.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function CoinLogo({ image, symbol = '', size = 24 }) {
  const [failed, setFailed] = useState(false)
  const color = avatarColor(symbol || '?')

  if (!image || failed) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: color + '22',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: size * 0.42, fontWeight: 700, color }}>
          {(symbol || '?')[0]}
        </span>
      </div>
    )
  }

  return (
    <img
      src={image}
      alt={symbol}
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0 }}
      onError={() => setFailed(true)}
    />
  )
}

function ShimmerList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0' }}>
          <div className="you-shimmer" style={{ width: 16, height: 12, borderRadius: 4 }} />
          <div className="you-shimmer" style={{ width: 24, height: 24, borderRadius: '50%' }} />
          <div className="you-shimmer" style={{ flex: 1, height: 12, borderRadius: 4 }} />
          <div className="you-shimmer" style={{ width: 52, height: 18, borderRadius: 10 }} />
        </div>
      ))}
    </div>
  )
}

const REMIX_MODES = ['list', 'grid', 'minimal']
const STORAGE_KEY = 'spectre:you-remix-you-discovery'

/* ── List remix (default) ── */
function ListView({ data, formatPrice }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {data.map((token, i) => (
        <div key={token.symbol + i} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0',
          borderBottom: i < data.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          cursor: 'pointer',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', width: 16, textAlign: 'center', flexShrink: 0 }}>{token.rank}</span>
          <CoinLogo image={token.image} symbol={token.symbol} size={24} />
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{token.symbol}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)', marginLeft: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, textAlign: 'right' }}>{formatPrice(token.price)}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
            color: token.change >= 0 ? 'var(--bull)' : 'var(--bear)',
            borderRadius: 20, padding: '2px 8px',
            background: token.change >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            flexShrink: 0, minWidth: 52, textAlign: 'center',
          }}>
            {token.change >= 0 ? '+' : ''}{(token.change ?? 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

/* ── Grid remix ── */
function GridView({ data, formatPrice }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
      alignContent: 'start', padding: '2px 0',
    }}>
      {data.map((token, i) => (
        <div key={token.symbol + i} style={{
          padding: '10px 10px 8px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 12, cursor: 'pointer',
          display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center',
        }}>
          <CoinLogo image={token.image} symbol={token.symbol} size={26} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{token.symbol}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{formatPrice(token.price)}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
            color: token.change >= 0 ? 'var(--bull)' : 'var(--bear)',
          }}>
            {token.change >= 0 ? '+' : ''}{(token.change ?? 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

/* ── Minimal remix ── */
function MinimalView({ data }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      display: 'flex', flexWrap: 'wrap', gap: '4px 12px',
      alignContent: 'start', padding: '4px 0',
    }}>
      {data.map((token, i) => (
        <div key={token.symbol + i} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 0', minWidth: 90,
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{token.symbol}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
            color: token.change >= 0 ? 'var(--bull)' : 'var(--bear)',
          }}>
            {token.change >= 0 ? '+' : ''}{(token.change ?? 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function YouDiscovery() {
  const { fmtPrice: formatPrice } = useCurrency()
  const [view, setView] = useState('trending')
  const [trendingData, setTrendingData] = useState(FALLBACK_TRENDING)
  const [gainersData, setGainersData] = useState(FALLBACK_GAINERS)
  const [loadingTrending, setLoadingTrending] = useState(true)
  const [loadingGainers, setLoadingGainers] = useState(true)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'list' } catch { return 'list' }
  })
  const intervalRef = useRef(null)

  const fetchTrending = useCallback(async () => {
    try {
      const coins = await getSpectreMarketTrending(8)
      if (coins.length > 0) {
        setTrendingData(coins.slice(0, 8).map((coin, i) => ({
          rank: i + 1,
          symbol: (coin.asset || coin.symbol || '').toUpperCase(),
          name: coin.name || coin.asset || '',
          price: coin.price ?? 0,
          change: coin.change_24h ?? coin.change24h ?? coin.change ?? 0,
          image: coin.image || coin.logo_url || null,
        })))
      }
    } catch {
      // keep fallback
    } finally {
      setLoadingTrending(false)
    }
  }, [])

  const fetchGainers = useCallback(async () => {
    try {
      const raw = await getTopCoinsMarketsPage(1, 50)
      if (Array.isArray(raw) && raw.length > 0) {
        const sorted = [...raw]
          .filter(c => c.price_change_percentage_24h != null)
          .sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0))
          .slice(0, 8)
        setGainersData(sorted.map((coin, i) => ({
          rank: i + 1,
          symbol: (coin.symbol || '').toUpperCase(),
          name: coin.name || '',
          price: coin.current_price || 0,
          change: coin.price_change_percentage_24h || 0,
          image: coin.image || null,
        })))
      }
    } catch {
      // keep fallback
    } finally {
      setLoadingGainers(false)
    }
  }, [])

  const pollDiscovery = useCallback(() => {
    fetchTrending()
    fetchGainers()
  }, [fetchTrending, fetchGainers])

  useEffect(() => {
    fetchTrending()
    fetchGainers()
  }, [fetchTrending, fetchGainers])

  useAdaptivePolling(pollDiscovery, { interval: 120_000 })

  const cycleRemix = () => {
    const next = REMIX_MODES[(REMIX_MODES.indexOf(remix) + 1) % REMIX_MODES.length]
    setRemix(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }

  const data = view === 'trending' ? trendingData : gainersData
  const isLoading = view === 'trending' ? loadingTrending : loadingGainers

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0' }}>
      <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>

      {/* Toggle pills */}
      <div style={{ display: 'flex', gap: 4, padding: 2, borderRadius: 12, background: 'rgba(255,255,255,0.03)', alignSelf: 'flex-start' }}>
        {[
          { key: 'trending', label: 'Trending' },
          { key: 'gainers', label: 'Top Gainers' },
        ].map(tab => {
          const active = view === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: active ? 600 : 400,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none', borderRadius: 10, padding: '4px 12px',
                cursor: 'pointer', transition: 'all 0.15s ease', letterSpacing: '0.02em',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {isLoading ? <ShimmerList /> : (
        <>
          {remix === 'list' && <ListView data={data} formatPrice={formatPrice} />}
          {remix === 'grid' && <GridView data={data} formatPrice={formatPrice} />}
          {remix === 'minimal' && <MinimalView data={data} />}
        </>
      )}
    </div>
  )
}
