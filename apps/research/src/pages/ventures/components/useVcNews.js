/**
 * useVcNews — recent crypto market news via /api/news. Module-cached 5 min and
 * shared across mounts (the feed is the same for every fund).
 */
import { useState, useEffect } from 'react'

const _cache = { data: null, ts: 0 }
const TTL = 5 * 60 * 1000

export default function useVcNews() {
  const [state, setState] = useState(() => (_cache.data ? { news: _cache.data, loading: false } : { news: [], loading: true }))

  useEffect(() => {
    if (_cache.data && Date.now() - _cache.ts < TTL) { setState({ news: _cache.data, loading: false }); return undefined }
    let cancelled = false
    fetch('/api/news?limit=14')
      .then((r) => r.json())
      .then((j) => {
        const arr = j?.Data || j?.articles || j?.data || (Array.isArray(j) ? j : [])
        const news = (arr || []).map((n) => ({
          title: n.title || n.headline || '',
          url: n.url && n.url !== '#' ? n.url : null,
          source: n.source || n.source_info?.name || '',
          summary: n.summary || n.body || '',
          image: n.imageUrl || n.imageurl || null,
          ts: n.publishedOn || n.published_on || 0,
        })).filter((n) => n.title)
        _cache.data = news
        _cache.ts = Date.now()
        if (!cancelled) setState({ news, loading: false })
      })
      .catch(() => { if (!cancelled) setState({ news: [], loading: false }) })
    return () => { cancelled = true }
  }, [])

  return state
}
