/**
 * YouEarnings — Upcoming US equity earnings calendar.
 * Pulls /api/stocks/earnings-calendar — important macro context for crypto
 * since equity earnings (NVDA, COIN, MSTR, etc.) move risk-on flows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouEarnings.css'

const CRYPTO_ADJACENT = new Set(['COIN', 'MSTR', 'RIOT', 'MARA', 'CLSK', 'HUT', 'CIFR', 'BITF', 'WULF', 'CORZ', 'IREN', 'BTBT', 'BTDR', 'GLXY', 'HOOD', 'PYPL', 'NVDA', 'TSLA'])

function fmtDate(d) {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtEps(v) {
  if (v == null || isNaN(v)) return null
  return Number(v).toFixed(2)
}

export default function YouEarnings() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/earnings-calendar', { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.earnings) ? json.earnings : Array.isArray(json) ? json : []
      setItems(arr)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 30 * 60_000 })

  const rows = useMemo(() => items
    .map(it => ({
      symbol: (it.symbol || it.ticker || '').toUpperCase(),
      name: it.name || it.companyName || '',
      date: it.date || it.reportDate || it.startdatetime || null,
      timing: it.time || it.hour || it.startTimeType || null,
      epsEst: it.epsEstimate ?? it.epsForecast ?? it.estimate ?? null,
      revEst: it.revenueEstimate ?? it.revenue ?? null,
      crypto: CRYPTO_ADJACENT.has((it.symbol || it.ticker || '').toUpperCase()),
    }))
    .filter(r => r.symbol)
    .slice(0, 18)
  , [items])

  if (loading && rows.length === 0) return <div className="you-er">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 32, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-er-empty">No upcoming earnings.</div>

  return (
    <ul className="you-er">
      {rows.map((r, i) => (
        <li key={r.symbol + i} className={`you-er-row${r.crypto ? ' you-er-row--crypto' : ''}`}>
          <span className="you-er-sym mono">{r.symbol}</span>
          <div className="you-er-body">
            <span className="you-er-name">{r.name || r.symbol}</span>
            <span className="you-er-when mono">{fmtDate(r.date)}{r.timing ? ` · ${r.timing}` : ''}</span>
          </div>
          {fmtEps(r.epsEst) != null && (
            <div className="you-er-est">
              <span className="you-er-est-label mono">EPS est</span>
              <span className="you-er-est-val mono">${fmtEps(r.epsEst)}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
