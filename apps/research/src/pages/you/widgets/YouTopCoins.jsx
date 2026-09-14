/**
 * YouTopCoins — Top 10 coins by market cap.
 * Fetches real data from CoinGecko, falls back to static mock.
 * Supports 3 remix modes: list (default), compact, cards.
 */
import { useState, useEffect, useCallback } from 'react'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useCurrency } from '@/hooks/useCurrency'

// 2026-05-26 beta-quality fix: removed hardcoded BTC=$97,450 stale fallback.
// On CoinGecko failure the widget used to render Jan-2025 prices as "live".
// Now empty array -> shimmer/empty state until real data arrives.
const FALLBACK_COINS = []

// Deterministic color from symbol string
const avatarColor = (sym) => {
  const colors = ['#f7931a', '#627eea', '#9945ff', '#f3ba2f', '#00aae4', '#0033ad', '#e84142', '#c2a633', '#e6007a', '#2a5ada']
  const map = { BTC: 0, ETH: 1, SOL: 2, BNB: 3, XRP: 4, ADA: 5, AVAX: 6, DOGE: 7, DOT: 8, LINK: 9 }
  if (map[sym] !== undefined) return colors[map[sym]]
  let hash = 0
  for (let i = 0; i < sym.length; i++) hash = sym.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

const formatMcap = (n) => {
  if (!n) return '--'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toLocaleString()}`
}

const REMIX_MODES = ['list', 'compact', 'cards']
const STORAGE_KEY = 'spectre:you-remix-you-top-coins'

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

function ShimmerRows() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 0' }}>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <div className="you-shimmer" style={{ width: 16, height: 12, borderRadius: 4 }} />
          <div className="you-shimmer" style={{ width: 24, height: 24, borderRadius: '50%' }} />
          <div className="you-shimmer" style={{ flex: 1, height: 12, borderRadius: 4 }} />
          <div className="you-shimmer" style={{ width: 48, height: 12, borderRadius: 4 }} />
          <div className="you-shimmer" style={{ width: 56, height: 18, borderRadius: 10 }} />
        </div>
      ))}
    </div>
  )
}

/* ── List remix (default) ── */
function ListView({ coins, formatPrice }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 4px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {[{ label: '#', w: 16 }, { label: 'Coin', flex: 1, pl: 32 }, { label: 'MCap', w: 48 }, { label: 'Price', w: 64 }, { label: '24h', w: 56, ta: 'center' }].map(h => (
          <span key={h.label} style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            width: h.w, flex: h.flex, textAlign: h.ta || 'right',
            paddingLeft: h.pl, flexShrink: h.flex ? undefined : 0,
          }}>{h.label}</span>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {coins.map((coin, i) => (
          <div key={coin.symbol + i} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: i < coins.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
            cursor: 'pointer',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', width: 16, textAlign: 'center', flexShrink: 0 }}>{coin.rank}</span>
            <CoinLogo image={coin.image} symbol={coin.symbol} size={24} />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{coin.symbol}</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>{coin.name}</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', width: 48, textAlign: 'right', flexShrink: 0 }}>{formatMcap(coin.mcap)}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', width: 64, textAlign: 'right', flexShrink: 0 }}>{formatPrice(coin.price)}</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
              color: coin.change >= 0 ? 'var(--bull)' : 'var(--bear)',
              background: coin.change >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              borderRadius: 20, padding: '2px 8px', width: 56, textAlign: 'center', flexShrink: 0,
            }}>
              {coin.change >= 0 ? '+' : ''}{(coin.change ?? 0).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Compact remix ── */
function CompactView({ coins, formatPrice }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px',
      height: '100%', padding: '2px 0', alignContent: 'start', overflowY: 'auto',
    }}>
      {coins.map((coin, i) => (
        <div key={coin.symbol + i} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0',
          borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer',
        }}>
          <CoinLogo image={coin.image} symbol={coin.symbol} size={18} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{coin.symbol}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', marginLeft: 'auto' }}>{formatPrice(coin.price)}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
            color: coin.change >= 0 ? 'var(--bull)' : 'var(--bear)',
          }}>
            {coin.change >= 0 ? '+' : ''}{(coin.change ?? 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

/* ── Cards remix ── */
function CardsView({ coins, formatPrice }) {
  return (
    <div style={{
      display: 'flex', gap: 8, height: '100%', overflowX: 'auto', overflowY: 'hidden',
      padding: '2px 0', alignItems: 'flex-start',
    }}>
      {coins.map((coin, i) => (
        <div key={coin.symbol + i} style={{
          minWidth: 100, maxWidth: 110, padding: '10px 10px 8px', flexShrink: 0,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
          transition: 'all 0.2s ease',
        }}>
          <CoinLogo image={coin.image} symbol={coin.symbol} size={28} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{coin.symbol}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{formatPrice(coin.price)}</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
            color: coin.change >= 0 ? 'var(--bull)' : 'var(--bear)',
            background: coin.change >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            borderRadius: 20, padding: '1px 6px',
          }}>
            {coin.change >= 0 ? '+' : ''}{(coin.change ?? 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function YouTopCoins() {
  const { fmtPrice: formatPrice } = useCurrency()
  const [coins, setCoins] = useState(FALLBACK_COINS)
  const [loading, setLoading] = useState(true)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'list' } catch { return 'list' }
  })
  const fetchData = useCallback(async () => {
    try {
      const raw = await getTopCoinsMarketsPage(1, 10)
      if (Array.isArray(raw) && raw.length > 0) {
        setCoins(raw.map(coin => ({
          rank: coin.market_cap_rank,
          symbol: (coin.symbol || '').toUpperCase(),
          name: coin.name,
          price: coin.current_price,
          change: coin.price_change_percentage_24h,
          mcap: coin.market_cap,
          image: coin.image,
        })))
      }
    } catch {
      // keep fallback
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useAdaptivePolling(fetchData, { interval: 60_000 })

  const cycleRemix = () => {
    const next = REMIX_MODES[(REMIX_MODES.indexOf(remix) + 1) % REMIX_MODES.length]
    setRemix(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }

  if (loading) return <ShimmerRows />

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
      {remix === 'list' && <ListView coins={coins} formatPrice={formatPrice} />}
      {remix === 'compact' && <CompactView coins={coins} formatPrice={formatPrice} />}
      {remix === 'cards' && <CardsView coins={coins} formatPrice={formatPrice} />}
    </div>
  )
}
