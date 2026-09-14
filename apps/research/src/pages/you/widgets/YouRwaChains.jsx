/**
 * YouRwaChains — Tokenized assets TVL by chain breakdown.
 * Pulls /api/rwa/chains.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouRwaChains.css'

function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${Math.round(v)}`
}

export default function YouRwaChains() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/rwa/chains', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 5 * 60 * 1000)

  const rows = useMemo(() => {
    const arr = Array.isArray(data?.chains) ? data.chains : Array.isArray(data) ? data : []
    return arr.slice(0, 8).map(c => ({
      name: c.name || c.chain || 'Unknown',
      tvl: Number(c.tvl ?? c.total_tvl ?? 0),
      pct: Number(c.pct ?? c.dominance ?? 0),
    })).filter(c => c.tvl > 0)
  }, [data])

  if (loading && rows.length === 0) return <div className="you-rc">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 18, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-rc-empty">RWA chain data unavailable.</div>

  const max = rows.reduce((m, r) => Math.max(m, r.tvl), 0)

  return (
    <ul className="you-rc">
      {rows.map((r, i) => {
        const w = Math.max(4, (r.tvl / max) * 100)
        return (
          <li key={r.name + i} className="you-rc-row">
            <span className="you-rc-name">{r.name}</span>
            <div className="you-rc-bar"><span className="you-rc-bar-fill" style={{ width: `${w}%` }} /></div>
            <span className="you-rc-tvl mono">{fmtUsd(r.tvl)}</span>
          </li>
        )
      })}
    </ul>
  )
}
