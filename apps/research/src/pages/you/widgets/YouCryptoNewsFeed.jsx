/**
 * YouCryptoNewsFeed — Refined news widget pulling /api/news with sentiment
 * scoring + source badge. Sister of you-news-feed but focused on crypto-only
 * with sentiment color coding.
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouCryptoNewsFeed.css'

function relTime(t) {
  const ts = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : new Date(t).getTime()
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export default function YouCryptoNewsFeed() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/news?limit=15&category=crypto', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      const arr = Array.isArray(json?.articles) ? json.articles : Array.isArray(json) ? json : []
      setItems(arr.slice(0, 15))
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 2 * 60 * 1000)

  if (loading && items.length === 0) return <div className="you-cn">{[0,1,2,3,4].map(i => <div key={i} className="you-shimmer" style={{ height: 36, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || items.length === 0) return <div className="you-cn-empty">News feed unavailable.</div>

  return (
    <ul className="you-cn">
      {items.map((a, i) => {
        const s = a.sentiment || a.sentiment_score
        const tone = (s === 'bullish' || s === 'positive' || s > 0.2) ? 'bull'
          : (s === 'bearish' || s === 'negative' || s < -0.2) ? 'bear' : 'neutral'
        const headline = a.title || a.headline || a.subject || ''
        const source = a.source || a.publisher || a.feed || ''
        const time = a.publishedAt || a.timestamp || a.published_at
        return (
          <li key={a.id || a.slug || i} className="you-cn-row">
            <a href={a.url || '#'} target="_blank" rel="noopener noreferrer" className="you-cn-link">
              <span className={`you-cn-dot you-cn-dot--${tone}`} aria-hidden="true" />
              <div className="you-cn-meta">
                <span className="you-cn-headline">{headline}</span>
                <div className="you-cn-sub">
                  {source && <span className="you-cn-source">{source}</span>}
                  {time && <span className="you-cn-time mono">{relTime(time)}</span>}
                </div>
              </div>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
