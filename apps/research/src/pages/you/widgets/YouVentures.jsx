/**
 * YouVentures — Recent crypto/AI venture funding feed.
 * Pulls /api/private/funding-news — surfaces new raises with company,
 * round size, sector, and source link.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouVentures.css'

function fmtAmount(v) {
  if (v == null || isNaN(v)) return null
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}

function fmtAgo(date) {
  if (!date) return ''
  const t = new Date(date).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  const h = Math.floor(diff / 36e5)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function YouVentures() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/private/funding-news?limit=20', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      setItems(arr.slice(0, 20))
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 10 * 60_000 })

  const rows = useMemo(() => items.map(it => ({
    id: it.id || it.link || it.headline,
    company: it.company || it.companyName || '',
    headline: it.headline || it.description || '',
    logo: it.logoUrl || it.logo || null,
    amount: it.amountUsd ?? it.amount ?? null,
    round: it.roundType || it.round || null,
    sector: it.sector || null,
    date: it.date || it.publishedAt || it.createdAt || null,
    link: it.link || it.url || null,
  })).filter(r => r.company || r.headline), [items])

  if (loading && rows.length === 0) return <div className="you-vc">{[0,1,2,3,4].map(i => <div key={i} className="you-shimmer" style={{ height: 38, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-vc-empty">No recent raises found.</div>

  return (
    <ul className="you-vc">
      {rows.map((r, i) => (
        <li key={r.id || i} className="you-vc-row">
          <a className="you-vc-link" href={r.link || '#'} target={r.link ? '_blank' : undefined} rel="noreferrer">
            {r.logo
              ? <img className="you-vc-logo" src={r.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
              : <span className="you-vc-logo you-vc-logo--ph">{(r.company || '?').charAt(0).toUpperCase()}</span>}
            <div className="you-vc-body">
              <div className="you-vc-headline">
                <span className="you-vc-company">{r.company || 'Unknown'}</span>
                {r.amount && <span className="you-vc-amount mono">{fmtAmount(r.amount)}</span>}
                {r.round && <span className="you-vc-round mono">{r.round}</span>}
              </div>
              {r.headline && <div className="you-vc-sub">{r.headline}</div>}
              <div className="you-vc-meta">
                {r.sector && <span className="you-vc-sector mono">{r.sector}</span>}
                <span className="you-vc-when mono">{fmtAgo(r.date)}</span>
              </div>
            </div>
          </a>
        </li>
      ))}
    </ul>
  )
}
