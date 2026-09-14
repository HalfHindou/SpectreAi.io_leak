/**
 * YouSecFilings — Recent SEC filings tracker. Surfaces public filings
 * from /api/private/sec-filings — useful for spotting institutional
 * crypto exposure and regulatory disclosures before they hit headlines.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouSecFilings.css'

function fmtUsd(v) {
  if (v == null || isNaN(v)) return null
  const n = Number(v)
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}

function fmtDate(d) {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const FORM_TONE = {
  'D':   'fund',
  'D/A': 'fund',
  '13F': 'holding',
  '13F-HR': 'holding',
  '13G': 'holding',
  '13D': 'holding',
  '8-K': 'event',
  '10-K': 'annual',
  '10-Q': 'quarterly',
  'S-1': 'ipo',
  'S-3': 'shelf',
}

export default function YouSecFilings() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/private/sec-filings?limit=30', { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      setItems(arr)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 15 * 60_000 })

  const rows = useMemo(() => items.map(it => {
    const formType = (it.formType || it.form || '').toUpperCase()
    return {
      id: it.id || it.accessionNumber || (it.entityName + formType),
      entity: (it.entityName || it.companyName || '').replace(/\s+\(CIK [^)]+\)/, ''),
      formType,
      tone: FORM_TONE[formType] || 'other',
      filedAt: it.filedAt || it.dateFiled || it.date || null,
      amount: it.totalOfferingAmount,
      url: it.url || it.link || null,
    }
  }).filter(r => r.entity).slice(0, 18), [items])

  if (loading && rows.length === 0) return <div className="you-sec">{[0,1,2,3,4].map(i => <div key={i} className="you-shimmer" style={{ height: 32, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-sec-empty">No SEC filings in feed.</div>

  return (
    <ul className="you-sec">
      {rows.map((r, i) => (
        <li key={r.id || i} className="you-sec-row">
          <a className="you-sec-link" href={r.url || '#'} target={r.url ? '_blank' : undefined} rel="noreferrer">
            <span className={`you-sec-form you-sec-form--${r.tone} mono`}>{r.formType || '—'}</span>
            <div className="you-sec-body">
              <span className="you-sec-entity">{r.entity}</span>
              <div className="you-sec-meta">
                {r.amount && <span className="you-sec-amount mono">{fmtUsd(r.amount)}</span>}
                <span className="you-sec-date mono">{fmtDate(r.filedAt)}</span>
              </div>
            </div>
          </a>
        </li>
      ))}
    </ul>
  )
}
