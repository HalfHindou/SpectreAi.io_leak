import React, { useEffect, useState, useMemo } from 'react'
import './RwaNewsStrip.css'

/* Keyword banks — ordered by signal strength.
   High-signal hits jump to the top of the strip; generic hits fill remaining slots. */
const KW_BREAKING = ['exploit', 'hack', 'attack', 'drain', 'stolen', 'paused', 'halt', 'sec sues', 'sec charges']
const KW_PROTOCOLS = [
  'aave', 'ondo', 'maker', 'makerdao', 'sky', 'usdc', 'usdt', 'tether', 'circle',
  'blackrock', 'buidl', 'franklin', 'benji', 'centrifuge', 'maple', 'goldfinch',
  'ethena', 'usde', 'dai', 'usds', 'clearpool', 'anemoy', 'superstate', 'openeden',
  'hashnote', 'paxos', 'anzen', 'plume', 'xstocks', 'backed', 'swarm',
]
const KW_TOPICS = [
  'rwa', 'tokeniz', 'real-world asset', 'real world asset',
  'treasur', 'treasuries', 't-bill', 'tbill', 'treasury bill',
  'stablecoin', 'money market fund', 'private credit',
  'yield-bearing', 'yield bearing', 'tokenized stock', 'etf on-chain',
  'asset-backed', 'asset backed', 'on-chain bond', 'on-chain securit',
  'regulat', 'genius act', 'mica',
]

function scoreHeadline(title) {
  const t = (title || '').toLowerCase()
  if (!t) return 0
  let score = 0
  for (const k of KW_BREAKING) if (t.includes(k)) score += 20
  for (const k of KW_PROTOCOLS) if (t.includes(k)) score += 5
  for (const k of KW_TOPICS) if (t.includes(k)) score += 3
  return score
}

/* Relative time (stories are recent; hide if older than 3 days) */
function relativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  if (!d) return ''
  const diffSec = Math.max(1, Math.floor((Date.now() - d) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const m = Math.floor(diffSec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

const STALE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

export default function RwaNewsStrip() {
  const [items, setItems] = useState(null) // null = loading, [] = loaded empty
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/news/rss?limit=60')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const results = Array.isArray(json.results) ? json.results : []
        if (!cancelled) setItems(results)
      } catch (err) {
        if (!cancelled) { setError(true); setItems([]) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const ranked = useMemo(() => {
    if (!items) return null
    const now = Date.now()
    const scored = items
      .map(it => ({ ...it, _score: scoreHeadline(it.title) }))
      .filter(it => it._score > 0)
      .filter(it => {
        const ts = new Date(it.publishedAt || 0).getTime()
        return ts && (now - ts) < STALE_MS
      })
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      })
      .slice(0, 6)
    return scored
  }, [items])

  // Don't render shell at all while empty — keep the tab clean.
  if (items !== null && (!ranked || ranked.length === 0)) return null

  const loading = ranked === null

  return (
    <section className="rwa-news" aria-label="RWA news">
      <div className="rwa-news__head">
        <span className="rwa-news__chip">
          <span className="rwa-news__chip-dot" />
          RWA Pulse
        </span>
        <span className="rwa-news__sub">Headlines relevant to tokenized assets · 72h</span>
      </div>

      <div className="rwa-news__scroller" role="list">
        {loading
          ? [0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`rwa-news__card rwa-news__card--skel animate-shimmer stagger-${(i % 5) + 1}`}
                aria-hidden
              />
            ))
          : ranked.map(it => {
              const isBreaking = it._score >= 20
              return (
                <a
                  key={it.id || it.url}
                  role="listitem"
                  className={`rwa-news__card${isBreaking ? ' rwa-news__card--breaking' : ''}`}
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {isBreaking && <span className="rwa-news__flag">Breaking</span>}
                  <span className="rwa-news__title">{it.title}</span>
                  <div className="rwa-news__meta">
                    {it.sourceIcon ? (
                      <img className="rwa-news__src-icon" src={it.sourceIcon} alt="" loading="lazy" />
                    ) : null}
                    <span className="rwa-news__src">{it.source || 'News'}</span>
                    <span className="rwa-news__dot" aria-hidden>·</span>
                    <span className="rwa-news__time mono">{relativeTime(it.publishedAt)}</span>
                  </div>
                </a>
              )
            })}
      </div>
    </section>
  )
}
