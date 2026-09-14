/**
 * YouHeatmap — Market heatmap widget.
 * Fetches real top-30 coins from CoinGecko, falls back to static mock.
 * Supports 3 remix modes: treemap (default), bubbles, bars.
 */
import { useState, useEffect, useCallback } from 'react'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

// 2026-05-26 beta-quality fix: removed 30-row hardcoded heatmap including
// the renamed MATIC ticker and invented +/-% changes. Visible if CG fails.
const FALLBACK_COINS = []

/**
 * Map a change% to an RGB color.
 * -10% = deep red, 0% = neutral gray, +10% = deep green.
 * Clamps at +/-15% for extreme outliers.
 */
const changeToColor = (change) => {
  const clamped = Math.max(-15, Math.min(15, change))
  const t = (clamped + 15) / 30 // 0..1, where 0.5 = neutral

  if (t < 0.5) {
    const f = t / 0.5
    const r = Math.round(180 + (50 - 180) * f)
    const g = Math.round(40 + (50 - 40) * f)
    const b = Math.round(40 + (55 - 40) * f)
    return `rgb(${r},${g},${b})`
  } else {
    const f = (t - 0.5) / 0.5
    const r = Math.round(50 + (16 - 50) * f)
    const g = Math.round(50 + (150 - 50) * f)
    const b = Math.round(55 + (90 - 55) * f)
    return `rgb(${r},${g},${b})`
  }
}

const REMIX_MODES = ['treemap', 'bubbles', 'bars']
const STORAGE_KEY = 'spectre:you-remix-you-heatmap'

function ShimmerGrid() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, height: '100%', alignContent: 'flex-start' }}>
      {Array.from({ length: 20 }, (_, i) => (
        <div key={i} className="you-shimmer" style={{
          flexGrow: Math.max(1, 10 - i),
          flexBasis: `${Math.max(8, 30 - i * 2)}%`,
          minWidth: 32, minHeight: 28, maxHeight: 60,
          borderRadius: 4,
        }} />
      ))}
    </div>
  )
}

const Legend = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 0 }}>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)' }}>-10%</span>
    <div style={{ width: 80, height: 6, borderRadius: 3, background: 'linear-gradient(to right, rgb(180,40,40), rgb(50,50,55), rgb(16,150,90))' }} />
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)' }}>+10%</span>
  </div>
)

/* ── Treemap (default) ── */
function TreemapView({ coins, totalWeight }) {
  return (
    <>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', gap: 2, alignContent: 'flex-start', overflow: 'hidden' }}>
        {coins.map(coin => {
          const pct = (coin.weight / totalWeight) * 100
          const isLarge = coin.weight >= 5
          const isMedium = coin.weight >= 1 && coin.weight < 5
          return (
            <div key={coin.symbol} style={{
              flexGrow: coin.weight, flexShrink: 0,
              flexBasis: `${Math.max(pct * 0.9, 8)}%`,
              minWidth: isLarge ? 60 : isMedium ? 42 : 32,
              minHeight: isLarge ? 48 : isMedium ? 36 : 28,
              maxHeight: isLarge ? 120 : isMedium ? 60 : 40,
              background: changeToColor(coin.change), borderRadius: 4,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 1, padding: '2px 4px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
              transition: 'filter 0.15s ease',
            }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: isLarge ? 13 : isMedium ? 10 : 8, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.4)', lineHeight: 1 }}>{coin.symbol}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: isLarge ? 11 : isMedium ? 9 : 7, fontWeight: 500, color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 2px rgba(0,0,0,0.3)', lineHeight: 1 }}>
                {(coin.change ?? 0) >= 0 ? '+' : ''}{(coin.change ?? 0).toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
      <Legend />
    </>
  )
}

/* ── Bubbles remix ── */
function BubblesView({ coins, totalWeight }) {
  return (
    <>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', gap: 4,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 4,
      }}>
        {coins.slice(0, 20).map(coin => {
          const ratio = coin.weight / totalWeight
          const size = Math.max(28, Math.min(80, ratio * 600))
          return (
            <div key={coin.symbol} style={{
              width: size, height: size, borderRadius: '50%',
              background: changeToColor(coin.change),
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'transform 0.2s ease',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: Math.max(7, size * 0.16), fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.4)', lineHeight: 1 }}>{coin.symbol}</span>
              {size > 36 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: Math.max(6, size * 0.12), fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1, marginTop: 1 }}>
                  {(coin.change ?? 0) >= 0 ? '+' : ''}{(coin.change ?? 0).toFixed(1)}%
                </span>
              )}
            </div>
          )
        })}
      </div>
      <Legend />
    </>
  )
}

/* ── Bars remix ── */
function BarsView({ coins }) {
  const sorted = [...coins].sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 15)
  const maxAbs = Math.max(...sorted.map(c => Math.abs(c.change ?? 0)), 1)

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, padding: '2px 0' }}>
      {sorted.map(coin => (
        <div key={coin.symbol} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, fontWeight: 600, color: 'var(--text-secondary)', width: 40, textAlign: 'right', flexShrink: 0 }}>{coin.symbol}</span>
          <div style={{ flex: 1, height: 14, borderRadius: 3, background: 'rgba(255,255,255,0.03)', overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: (coin.change ?? 0) >= 0 ? '50%' : undefined,
              right: (coin.change ?? 0) < 0 ? '50%' : undefined,
              width: `${(Math.abs(coin.change ?? 0) / maxAbs) * 50}%`,
              background: (coin.change ?? 0) >= 0 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)',
              borderRadius: 3, transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, width: 42, textAlign: 'right', flexShrink: 0,
            color: (coin.change ?? 0) >= 0 ? 'var(--bull)' : 'var(--bear)',
          }}>
            {(coin.change ?? 0) >= 0 ? '+' : ''}{(coin.change ?? 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function YouHeatmap() {
  const [coins, setCoins] = useState(FALLBACK_COINS)
  const [loading, setLoading] = useState(true)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'treemap' } catch { return 'treemap' }
  })
  const fetchData = useCallback(async () => {
    try {
      const raw = await getTopCoinsMarketsPage(1, 30)
      if (Array.isArray(raw) && raw.length > 0) {
        const totalMcap = raw.reduce((sum, c) => sum + (c.market_cap || 0), 0)
        setCoins(raw.map(coin => ({
          symbol: (coin.symbol || '').toUpperCase(),
          change: coin.price_change_percentage_24h ?? 0,
          weight: totalMcap > 0 ? ((coin.market_cap || 0) / totalMcap) * 100 : 1,
        })))
      }
    } catch {
      // keep fallback
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useAdaptivePolling(fetchData, { interval: 120_000 })

  const cycleRemix = () => {
    const next = REMIX_MODES[(REMIX_MODES.indexOf(remix) + 1) % REMIX_MODES.length]
    setRemix(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }

  const totalWeight = coins.reduce((sum, c) => sum + c.weight, 0)

  if (loading) return <ShimmerGrid />

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0' }}>
      <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
      {remix === 'treemap' && <TreemapView coins={coins} totalWeight={totalWeight} />}
      {remix === 'bubbles' && <BubblesView coins={coins} totalWeight={totalWeight} />}
      {remix === 'bars' && <BarsView coins={coins} />}
    </div>
  )
}
