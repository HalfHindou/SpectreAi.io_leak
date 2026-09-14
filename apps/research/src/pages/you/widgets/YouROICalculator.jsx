/**
 * YouROICalculator — Compact ROI calculator widget.
 * Select a coin, enter investment amount, see value at ATH with profit.
 *
 * Real data: fetches current price + ATH from CoinGecko via getCoinROIData.
 * Remix modes: calculator (default), compact, compare
 */
import { useState, useEffect, useCallback } from 'react'
import { getCoinROIData } from '@/services/coinGeckoApi'
import { useCurrency } from '@/hooks/useCurrency'

// 2026-05-26 beta-quality fix: removed hardcoded prices/ATH/athDate that
// were stale Jan-2025 snapshots. They rendered as "Current $97,450" for BTC
// on first paint and stayed that way if CoinGecko failed. Only static
// identifiers (symbol/name) remain; price/ath come from getCoinROIData.
const COINS = {
  bitcoin:     { symbol: 'BTC', name: 'Bitcoin' },
  ethereum:    { symbol: 'ETH', name: 'Ethereum' },
  solana:      { symbol: 'SOL', name: 'Solana' },
  binancecoin: { symbol: 'BNB', name: 'BNB' },
  ripple:      { symbol: 'XRP', name: 'XRP' },
  cardano:     { symbol: 'ADA', name: 'Cardano' },
}

const COIN_IDS = Object.keys(COINS)
const REMIX_MODES = ['calculator', 'compact', 'compare']
const STORAGE_KEY = 'spectre:you-remix-you-roi-calculator'

function formatUSD(v) {
  const num = parseFloat(v)
  if (isNaN(num)) return '$0'
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatAthDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  } catch { return '' }
}

export default function YouROICalculator() {
  const { fmtPrice: formatPrice } = useCurrency()
  const [selectedCoin, setSelectedCoin] = useState('bitcoin')
  const [investAmount, setInvestAmount] = useState(1000)
  const [liveData, setLiveData] = useState({}) // coinId -> { price, ath, athDate }
  const [loading, setLoading] = useState(false)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'calculator' } catch { return 'calculator' }
  })

  const cycleRemix = () => {
    const next = REMIX_MODES[(REMIX_MODES.indexOf(remix) + 1) % REMIX_MODES.length]
    setRemix(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }

  // Fetch real data for a coin
  const fetchCoinData = useCallback(async (coinId) => {
    if (liveData[coinId]) return // already fetched
    setLoading(true)
    try {
      const data = await getCoinROIData(coinId)
      if (data && data.currentPrice && data.athPrice) {
        setLiveData(prev => ({
          ...prev,
          [coinId]: {
            price: data.currentPrice,
            ath: data.athPrice,
            athDate: formatAthDate(data.athDate),
          }
        }))
      }
    } catch {
      // keep mock fallback
    } finally {
      setLoading(false)
    }
  }, [liveData])

  // Fetch on coin change
  useEffect(() => {
    fetchCoinData(selectedCoin)
  }, [selectedCoin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all coins for compare mode
  useEffect(() => {
    if (remix === 'compare') {
      COIN_IDS.forEach(id => fetchCoinData(id))
    }
  }, [remix]) // eslint-disable-line react-hooks/exhaustive-deps

  function getCoin(coinId) {
    const meta = COINS[coinId]
    const live = liveData[coinId]
    return {
      symbol: meta.symbol,
      name: meta.name,
      // 2026-05-26 beta-quality fix: no hardcoded price fallback. Returns
      // null when live data hasn't arrived; UI must guard against null.
      price: live?.price ?? null,
      ath: live?.ath ?? null,
      athDate: live?.athDate ?? '',
    }
  }

  const coin = getCoin(selectedCoin)
  // 2026-05-26 beta-quality fix: only compute when real data is loaded.
  // Falling back to price=1 produced wild multipliers like "108786x" while
  // CoinGecko was still in flight.
  const hasData = coin.price != null && coin.ath != null && coin.price > 0
  const safePrice = hasData ? coin.price : null
  const safeAth = hasData ? coin.ath : null
  const pctFromATH = hasData ? ((safeAth - safePrice) / safeAth * 100).toFixed(1) : '—'
  const valueAtATH = hasData ? (investAmount * (safeAth / safePrice)).toFixed(2) : null
  const profit = hasData ? (valueAtATH - investAmount).toFixed(2) : null
  const multiplier = hasData ? (safeAth / safePrice).toFixed(2) : '—'

  const selectStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--text-primary)',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: '8px 12px',
    width: '100%',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    backgroundSize: '12px',
  }

  const inputStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: '8px 12px',
    width: '100%',
    outline: 'none',
    boxSizing: 'border-box',
  }

  // ── Compact Mode ──
  if (remix === 'compact') {
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            {coin.symbol}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            {formatPrice(coin.price)}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            ATH {formatPrice(coin.ath)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: parseFloat(pctFromATH) > 30 ? 'var(--bear)' : 'var(--bull)' }}>
              {multiplier}x
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              to ATH
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--bear)' }}>
              -{pctFromATH}%
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              below ATH
            </div>
          </div>
        </div>
        {loading && <LoadingDot />}
      </div>
    )
  }

  // ── Compare Mode ──
  if (remix === 'compare') {
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {COIN_IDS.map(id => {
            const c = getCoin(id)
            const mult = (c.ath || 1) / (c.price || 1)
            const maxMult = Math.max(...COIN_IDS.map(cid => {
              const cc = getCoin(cid)
              return (cc.ath || 1) / (cc.price || 1)
            }), 1)
            const barPct = Math.min((mult / maxMult) * 100, 100)
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', width: 32, flexShrink: 0 }}>
                  {c.symbol}
                </span>
                <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${barPct}%`,
                    height: '100%',
                    borderRadius: 5,
                    background: mult > 1.5 ? 'var(--bull)' : mult > 1.1 ? '#facc15' : 'var(--text-muted)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: mult > 1.5 ? 'var(--bull)' : 'var(--text-secondary)', width: 36, textAlign: 'right', flexShrink: 0 }}>
                  {mult.toFixed(1)}x
                </span>
              </div>
            )
          })}
        </div>
        {loading && <LoadingDot />}
      </div>
    )
  }

  // ── Calculator Mode (default) ──
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      height: '100%',
      padding: '2px 0',
      position: 'relative',
    }}>
      <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>

      {/* Coin selector */}
      <select
        value={selectedCoin}
        onChange={(e) => setSelectedCoin(e.target.value)}
        style={selectStyle}
      >
        {COIN_IDS.map(key => {
          const c = COINS[key]
          return (
            <option key={key} value={key} style={{ background: '#111', color: '#fff' }}>
              {c.symbol} - {c.name}
            </option>
          )
        })}
      </select>

      {/* Price vs ATH */}
      <div style={{ display: 'flex', gap: 8, opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
            Current
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {formatPrice(coin.price)}
          </div>
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
            ATH ({coin.athDate})
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {formatPrice(coin.ath)}
          </div>
        </div>
      </div>

      {/* % below ATH */}
      {/* 2026-05-26 beta-quality fix: guard NaN width and "-—%" label when data not yet loaded */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{
            width: hasData ? `${Math.max(0, 100 - parseFloat(pctFromATH))}%` : '0%',
            height: '100%',
            borderRadius: 2,
            background: hasData && parseFloat(pctFromATH) > 30 ? 'var(--bear)' : 'var(--bull)',
            transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--bear)', flexShrink: 0 }}>
          {hasData ? `-${pctFromATH}%` : '—'}
        </span>
      </div>

      {/* Investment input */}
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          Investment Amount (USD)
        </div>
        <input
          type="number"
          min="1"
          value={investAmount}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v) && v >= 0) setInvestAmount(v)
          }}
          style={inputStyle}
        />
      </div>

      {/* Result */}
      <div style={{
        background: 'rgba(16,185,129,0.06)',
        border: '1px solid rgba(16,185,129,0.12)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Value at ATH
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>
            {multiplier}x
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
          {/* 2026-05-26 beta-quality fix: don't render $0/$NaN before data loads */}
          {hasData ? formatUSD(valueAtATH) : '—'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--bull)', fontWeight: 500 }}>
          {hasData ? `+${formatUSD(profit)} profit` : ''}
        </div>
      </div>

      {loading && <LoadingDot />}
    </div>
  )
}

function LoadingDot() {
  return (
    <div style={{
      position: 'absolute',
      bottom: 4,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 4,
      height: 4,
      borderRadius: '50%',
      background: 'var(--text-muted)',
      animation: 'you-pulse 1.5s ease-in-out infinite',
    }} />
  )
}
