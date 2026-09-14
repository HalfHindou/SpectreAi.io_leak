/**
 * YouLlamaRaises — Crypto-native fundraising rounds via DefiLlama.
 * Pulls /api/private/llama-raises — surfaces protocol raises with
 * round size, lead investor, and category.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouLlamaRaises.css'

function fmtAmount(v) {
  if (v == null || isNaN(v)) return null
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}

function fmtAgo(date) {
  if (!date) return ''
  const t = typeof date === 'number' ? (date < 1e12 ? date * 1000 : date) : new Date(date).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  const h = Math.floor(diff / 36e5)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function YouLlamaRaises() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/private/llama-raises?limit=30', { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data
        : Array.isArray(json?.raises) ? json.raises
        : Array.isArray(json) ? json : []
      setItems(arr)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 15 * 60_000 })

  const rows = useMemo(() => items.map(it => ({
    id: it.id || it.name + (it.date || ''),
    name: it.name || it.protocol || it.company || '',
    amount: it.amount ?? it.raised ?? it.amountUsd ?? null,
    round: it.round || it.roundType || null,
    valuation: it.valuation || it.valuationUsd || null,
    category: it.category || it.sector || it.tags?.[0] || null,
    lead: it.leadInvestors || it.leadInvestor || (Array.isArray(it.investors) ? it.investors[0] : null) || null,
    date: it.date || it.publishedAt || null,
    chains: Array.isArray(it.chains) ? it.chains : null,
  })).filter(r => r.name).slice(0, 18), [items])

  if (loading && rows.length === 0) return <div className="you-llr">{[0,1,2,3,4].map(i => <div key={i} className="you-shimmer" style={{ height: 38, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-llr-empty">No crypto raises in the feed.</div>

  return (
    <ul className="you-llr">
      {rows.map((r, i) => (
        <li key={r.id || i} className="you-llr-row">
          <div className="you-llr-main">
            <span className="you-llr-name">{r.name}</span>
            {r.amount != null && <span className="you-llr-amount mono">{fmtAmount(r.amount)}</span>}
            {r.round && <span className="you-llr-round mono">{r.round}</span>}
          </div>
          <div className="you-llr-sub">
            {r.category && <span className="you-llr-cat mono">{r.category}</span>}
            {r.lead && <span className="you-llr-lead">led by {Array.isArray(r.lead) ? r.lead[0] : r.lead}</span>}
            {r.valuation && <span className="you-llr-val mono">@ {fmtAmount(r.valuation)}</span>}
            <span className="you-llr-when mono">{fmtAgo(r.date)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
