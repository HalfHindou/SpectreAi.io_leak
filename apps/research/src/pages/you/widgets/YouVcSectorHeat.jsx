/**
 * YouVcSectorHeat — VC capital deployment heatmap by sector (last 30D).
 * Pulls /api/private/sector-heatmap — surfaces where venture money is
 * actually flowing rather than where the news cycle says it should be.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouVcSectorHeat.css'

function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—'
  const n = Number(v)
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}

export default function YouVcSectorHeat() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/private/sector-heatmap', { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      setItems(arr)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 30 * 60_000 })

  const view = useMemo(() => {
    const total = items.reduce((s, it) => s + Number(it.totalDeployed || 0), 0)
    const max = items.reduce((m, it) => Math.max(m, Number(it.totalDeployed || 0)), 0) || 1
    const sorted = [...items].sort((a, b) => Number(b.totalDeployed || 0) - Number(a.totalDeployed || 0)).slice(0, 12)
    return { total, max, sorted }
  }, [items])

  if (loading && items.length === 0) return <div className="you-vsh">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 26, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || view.sorted.length === 0) return <div className="you-vsh-empty">VC heatmap unavailable.</div>

  return (
    <div className="you-vsh">
      <div className="you-vsh-summary">
        <span className="you-vsh-label">30D Deployed</span>
        <span className="you-vsh-total mono">{fmtUsd(view.total)}</span>
      </div>
      <ul className="you-vsh-list">
        {view.sorted.map((s, i) => {
          const pct = (Number(s.totalDeployed || 0) / view.max) * 100
          return (
            <li key={s.sector || i} className="you-vsh-row">
              <span className="you-vsh-sector">{s.sector || 'Other'}</span>
              <span className="you-vsh-bar-wrap">
                <span className="you-vsh-bar" style={{ width: `${Math.max(2, pct)}%` }} />
              </span>
              <span className="you-vsh-amt mono">{fmtUsd(s.totalDeployed)}</span>
              <span className="you-vsh-rounds mono">{s.rounds ?? '—'}<span className="you-vsh-rounds-l"> rounds</span></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
