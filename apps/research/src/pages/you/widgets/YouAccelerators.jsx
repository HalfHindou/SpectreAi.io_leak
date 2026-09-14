/**
 * YouAccelerators — YC + Hub71 (and similar) accelerator company feed.
 * Pulls /api/accelerators/all — useful for spotting early-stage Web3/AI
 * startups before they raise institutional rounds.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouAccelerators.css'

const SOURCES = [
  { key: 'all', label: 'All' },
  { key: 'yc', label: 'YC' },
  { key: 'hub71', label: 'Hub71' },
]

export default function YouAccelerators() {
  const [source, setSource] = useState(SOURCES[0])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const path = source.key === 'all' ? '/api/accelerators/all' : `/api/accelerators/${source.key}`
      const res = await fetch(`${path}?limit=40`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      setItems(arr)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [source.key])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 30 * 60_000 })

  const rows = useMemo(() => items.map(it => ({
    id: it.id || it.slug || it.name,
    name: it.name || it.companyName || '',
    one: it.oneLiner || it.description || it.tagline || '',
    logo: it.logoUrl || it.logo || null,
    website: it.website || it.url || null,
    batch: it.batch || it.cohort || null,
    program: it.program || (it.id?.startsWith?.('yc') ? 'YC' : it.id?.startsWith?.('hub71') ? 'Hub71' : null),
  })).filter(r => r.name).slice(0, 24), [items])

  if (loading && rows.length === 0) return <div className="you-acc">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 36, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-acc-empty">Accelerator feed unavailable.</div>

  return (
    <div className="you-acc-wrap">
      <div className="you-acc-tabs">
        {SOURCES.map(s => (
          <button
            key={s.key}
            type="button"
            className={`you-acc-tab${source.key === s.key ? ' you-acc-tab--on' : ''}`}
            onClick={() => setSource(s)}
          >{s.label}</button>
        ))}
      </div>
      <ul className="you-acc">
        {rows.map((r, i) => (
          <li key={r.id || i} className="you-acc-row">
            <a className="you-acc-link" href={r.website || '#'} target={r.website ? '_blank' : undefined} rel="noreferrer">
              {r.logo
                ? <img className="you-acc-logo" src={r.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                : <span className="you-acc-logo you-acc-logo--ph">{r.name.charAt(0).toUpperCase()}</span>}
              <div className="you-acc-body">
                <div className="you-acc-head">
                  <span className="you-acc-name">{r.name}</span>
                  {r.program && <span className="you-acc-program mono">{r.program}{r.batch ? ` ${r.batch}` : ''}</span>}
                </div>
                {r.one && <div className="you-acc-one">{r.one}</div>}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
