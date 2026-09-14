/**
 * YouUnicorns — Private market unicorns ranked by valuation. Useful for
 * tracking AI / Web3 / fintech giants alongside crypto markets.
 * Pulls /api/private/unicorns.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouUnicorns.css'

function fmtVal(v) {
  if (v == null || isNaN(v)) return null
  const n = Number(v)
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n}`
}

const TIER_TONE = {
  Hectocorn: 'mythic',
  Decacorn: 'high',
  Unicorn: 'mid',
}

export default function YouUnicorns() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('All')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/private/unicorns?limit=80', { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      setItems(arr)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 60 * 60_000 })

  const sectors = useMemo(() => {
    const set = new Set(['All'])
    for (const it of items) if (it.sector) set.add(it.sector)
    return Array.from(set).slice(0, 8)
  }, [items])

  const rows = useMemo(() => items
    .filter(it => filter === 'All' || it.sector === filter)
    .sort((a, b) => Number(b.valuation || 0) - Number(a.valuation || 0))
    .slice(0, 18)
  , [items, filter])

  if (loading && items.length === 0) return <div className="you-uc">{[0,1,2,3,4].map(i => <div key={i} className="you-shimmer" style={{ height: 32, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-uc-empty">Unicorn feed unavailable.</div>

  return (
    <div className="you-uc-wrap">
      <div className="you-uc-tabs">
        {sectors.map(s => (
          <button
            key={s}
            type="button"
            className={`you-uc-tab${filter === s ? ' you-uc-tab--on' : ''}`}
            onClick={() => setFilter(s)}
          >{s}</button>
        ))}
      </div>
      <ul className="you-uc">
        {rows.map((r, i) => {
          const tier = TIER_TONE[r.tier] || 'mid'
          return (
            <li key={r.company || i} className="you-uc-row">
              {r.logoUrl
                ? <img className="you-uc-logo" src={r.logoUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                : <span className="you-uc-logo you-uc-logo--ph">{(r.company || '?').charAt(0).toUpperCase()}</span>}
              <div className="you-uc-body">
                <div className="you-uc-head">
                  <span className="you-uc-name">{r.company}</span>
                  {r.sector && <span className="you-uc-sector mono">{r.sector}</span>}
                </div>
                <div className="you-uc-meta">
                  <span className={`you-uc-tier you-uc-tier--${tier} mono`}>{r.tier || 'Unicorn'}</span>
                  {r.country && <span className="you-uc-country mono">{r.country}</span>}
                </div>
              </div>
              <span className="you-uc-val mono">{fmtVal(r.valuation)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
