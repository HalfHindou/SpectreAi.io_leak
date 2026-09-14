/**
 * YouTopGainers — top crypto gainers + losers in 24h.
 * Pulls coinGeckoApi.getTopCoins which returns sorted-by-market-cap top
 * coins with sparkline + change. We re-rank by 24h change to surface the
 * actual movers, not the giants.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import coinGeckoApi from '@/services/coinGeckoApi'
import './YouTopGainers.css'

export default function YouTopGainers() {
  const [coins, setCoins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const all = await coinGeckoApi.getTopCoins?.(100)
      setCoins(Array.isArray(all) ? all : [])
      setError(null)
    } catch (err) {
      setError(err?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 60_000)

  const { gainers, losers } = useMemo(() => {
    const sortable = coins
      .filter(c => Number.isFinite(c.price_change_percentage_24h))
      .map(c => ({
        symbol: (c.symbol || '').toUpperCase(),
        change: Number(c.price_change_percentage_24h),
        price: Number(c.current_price),
        image: c.image,
      }))
    const g = sortable.slice().sort((a, b) => b.change - a.change).slice(0, 5)
    const l = sortable.slice().sort((a, b) => a.change - b.change).slice(0, 5)
    return { gainers: g, losers: l }
  }, [coins])

  if (loading && coins.length === 0) {
    return <div className="you-tg">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 16, marginBottom: 6, borderRadius: 4 }} />)}</div>
  }
  if (error || coins.length === 0) return <div className="you-tg-empty">Top movers unavailable.</div>

  const Row = ({ c, tone }) => (
    <li key={c.symbol} className="you-tg-row">
      {c.image && <img className="you-tg-logo" src={c.image} alt="" loading="lazy" />}
      <span className="you-tg-sym mono">{c.symbol}</span>
      <span className={`you-tg-ch you-tg-ch--${tone} mono`}>
        {c.change >= 0 ? '+' : ''}{c.change.toFixed(1)}%
      </span>
    </li>
  )

  return (
    <div className="you-tg">
      <section>
        <h4 className="you-tg-label">Gainers 24h</h4>
        <ul>{gainers.map(c => <Row key={c.symbol} c={c} tone="bull" />)}</ul>
      </section>
      <section>
        <h4 className="you-tg-label">Losers 24h</h4>
        <ul>{losers.map(c => <Row key={c.symbol} c={c} tone="bear" />)}</ul>
      </section>
    </div>
  )
}
