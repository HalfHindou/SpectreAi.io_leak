/**
 * YouStockMovers — Top US stock gainers and losers from /api/stocks/movers.
 * Compact two-column list (gainers / losers) with mono prices and percent.
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouStockMovers.css'

export default function YouStockMovers() {
  const [data, setData] = useState({ gainers: [], losers: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/movers', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`stocks/movers ${res.status}`)
      const json = await res.json()
      setData({
        gainers: Array.isArray(json.gainers) ? json.gainers.slice(0, 6) : [],
        losers: Array.isArray(json.losers) ? json.losers.slice(0, 6) : [],
      })
      setError(null)
    } catch (err) {
      setError(err?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 60_000)

  const Row = ({ s, tone }) => (
    <li key={s.symbol} className="you-sm-row">
      <span className="you-sm-sym mono">{s.symbol}</span>
      <span className="you-sm-px mono">${s.price?.toFixed(2)}</span>
      <span className={`you-sm-ch you-sm-ch--${tone} mono`}>
        {s.change >= 0 ? '+' : ''}{s.change?.toFixed(2)}%
      </span>
    </li>
  )

  if (loading && data.gainers.length === 0 && data.losers.length === 0) {
    return (
      <div className="you-sm">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="you-shimmer" style={{ width: '100%', height: 14, marginBottom: 6, borderRadius: 4 }} />
        ))}
      </div>
    )
  }
  if (error || (data.gainers.length === 0 && data.losers.length === 0)) {
    return <div className="you-sm-empty"><span>Stock movers unavailable.</span></div>
  }

  return (
    <div className="you-sm">
      <section className="you-sm-col">
        <h4 className="you-sm-label">Gainers</h4>
        <ul className="you-sm-list">{data.gainers.map(s => <Row key={s.symbol} s={s} tone="bull" />)}</ul>
      </section>
      <section className="you-sm-col">
        <h4 className="you-sm-label">Losers</h4>
        <ul className="you-sm-list">{data.losers.map(s => <Row key={s.symbol} s={s} tone="bear" />)}</ul>
      </section>
    </div>
  )
}
