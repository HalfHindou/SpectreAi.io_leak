/**
 * YouUSMarket — US equity indices snapshot via /api/stocks/indices.
 * SPX / NDX / DJI / RUT with mono prices and percent change.
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouUSMarket.css'

const KEY_INDICES = ['^GSPC', '^IXIC', '^DJI', '^RUT']
const LABELS = { '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow', '^RUT': 'Russell 2K' }

export default function YouUSMarket() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/indices', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`stocks/indices ${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json) ? json : (json.indices || json.data || [])
      setItems(arr.filter(i => KEY_INDICES.includes(i.symbol) || KEY_INDICES.includes('^' + (i.symbol || ''))))
      setError(null)
    } catch (err) {
      setError(err?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 60_000)

  if (loading && items.length === 0) {
    return <div className="you-usm">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 36, marginBottom: 8, borderRadius: 6 }} />)}</div>
  }
  if (error || items.length === 0) {
    return <div className="you-usm-empty">US market unavailable.</div>
  }

  return (
    <ul className="you-usm">
      {items.map(idx => {
        const ch = idx.change ?? idx.changePercent ?? 0
        const tone = ch > 0 ? 'bull' : ch < 0 ? 'bear' : 'neutral'
        return (
          <li key={idx.symbol} className="you-usm-row">
            <span className="you-usm-name">{LABELS[idx.symbol] || idx.name || idx.symbol}</span>
            <span className="you-usm-px mono">{Number(idx.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            <span className={`you-usm-ch you-usm-ch--${tone} mono`}>{ch >= 0 ? '+' : ''}{Number(ch).toFixed(2)}%</span>
          </li>
        )
      })}
    </ul>
  )
}
