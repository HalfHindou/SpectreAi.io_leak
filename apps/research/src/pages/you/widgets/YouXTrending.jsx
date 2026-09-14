/**
 * YouXTrending — Trending tokens by X/Twitter mentions.
 * Pulls /api/x-dash/trending or /api/x-dash/categories — surfaces the
 * top tokens being talked about in the last 24h with mention deltas.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouXTrending.css'

export default function YouXTrending() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/x-dash/trending?limit=10', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json?.tokens) ? json.tokens : Array.isArray(json) ? json : []
      setItems(arr.slice(0, 10))
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 3 * 60 * 1000)

  const rows = useMemo(() => items.map(t => ({
    symbol: (t.symbol || t.ticker || t.asset || '').toUpperCase(),
    name: t.name || '',
    mentions: t.mentions ?? t.mention_count ?? t.count ?? 0,
    change: t.change_24h ?? t.delta ?? t.mention_change_pct ?? 0,
    sentiment: t.sentiment ?? null,
  })).filter(r => r.symbol), [items])

  if (loading && rows.length === 0) return <div className="you-xt">{[0,1,2,3].map(i => <div key={i} className="you-shimmer" style={{ height: 16, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || rows.length === 0) return <div className="you-xt-empty">X trending unavailable.</div>

  return (
    <ul className="you-xt">
      {rows.map((r, i) => {
        const tone = r.change > 0 ? 'bull' : r.change < 0 ? 'bear' : 'neutral'
        return (
          <li key={r.symbol + i} className="you-xt-row">
            <span className="you-xt-rank mono">{String(i + 1).padStart(2, '0')}</span>
            <div className="you-xt-name">
              <span className="you-xt-sym mono">{r.symbol}</span>
              {r.name && <span className="you-xt-full">{r.name}</span>}
            </div>
            <span className="you-xt-mentions mono">{Number(r.mentions).toLocaleString()}</span>
            {r.change !== 0 && (
              <span className={`you-xt-ch you-xt-ch--${tone} mono`}>{r.change >= 0 ? '+' : ''}{Number(r.change).toFixed(0)}%</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
