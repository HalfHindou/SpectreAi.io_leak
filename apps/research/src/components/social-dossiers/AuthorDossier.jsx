import { useEffect, useMemo, useState } from 'react'
import './social-dossier-shared.css'

function fmtCount(n) {
  if (n == null || !isFinite(n)) return '—'
  const num = Number(n)
  if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(1)}B`
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(1)}M`
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(1)}K`
  return Math.round(num).toLocaleString()
}
function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—'
  return `${(Number(n) * (Math.abs(n) <= 1 ? 100 : 1)).toFixed(1)}%`
}
function fmtHours(h) {
  if (h == null || !isFinite(h)) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${Number(h).toFixed(1)}h`
  return `${Math.round(h / 24)}d`
}

function useAuthorData(handle) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  useEffect(() => {
    if (!handle) return undefined
    let cancelled = false
    setState({ loading: true, data: null, error: null })
    const clean = String(handle).replace(/^@/, '')
    fetch(`/api/xdash/author/${encodeURIComponent(clean)}`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => {
        if (cancelled) return
        const d = j?.data || j
        setState({ loading: false, data: d, error: null })
      })
      .catch((e) => {
        if (cancelled) return
        setState({ loading: false, data: null, error: e?.message || 'load failed' })
      })
    return () => { cancelled = true }
  }, [handle])
  return state
}

function MiniSpark({ values, color = 'rgba(245,245,247,0.55)' }) {
  const path = useMemo(() => {
    if (!values || values.length < 2) return ''
    const w = 80, h = 18
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    return values.map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [values])
  if (!path) return <span className="sd-spark-empty mono">—</span>
  return (
    <svg className="sd-spark" width="80" height="18" viewBox="0 0 80 18" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TokenMovedRow({ row }) {
  const series = Array.isArray(row.frequency || row.sparkline) ? (row.frequency || row.sparkline) : []
  return (
    <div className="sd-token-row">
      {row.image
        ? <img className="sd-token-row-logo" src={row.image} alt="" />
        : <span className="sd-token-row-logo sd-token-row-logo-ph">{(row.asset || '?').slice(0, 1)}</span>}
      <div className="sd-token-row-id">
        <div className="sd-token-row-sym mono">{row.asset || row.symbol || '—'}</div>
        {row.name && <div className="sd-token-row-name">{row.name}</div>}
      </div>
      <MiniSpark values={series} />
      {row.mention_count != null && (
        <div className="sd-token-row-count mono">{fmtCount(row.mention_count)}</div>
      )}
    </div>
  )
}

function TweetCard({ tweet }) {
  const text = tweet.full_text || tweet.text || ''
  const truncated = text.length > 220 ? `${text.slice(0, 220)}…` : text
  const url = tweet.url || tweet.x_url
  const Tag = url ? 'a' : 'div'
  return (
    <Tag className="sd-tweet" {...(url ? { href: url, target: '_blank', rel: 'noreferrer' } : {})}>
      <div className="sd-tweet-text">{truncated}</div>
      <div className="sd-tweet-stats mono">
        {tweet.metrics?.likes != null && <span>♥ {fmtCount(tweet.metrics.likes)}</span>}
        {tweet.metrics?.retweets != null && <span>↻ {fmtCount(tweet.metrics.retweets)}</span>}
        {tweet.metrics?.replies != null && <span>↩ {fmtCount(tweet.metrics.replies)}</span>}
      </div>
    </Tag>
  )
}

export default function AuthorDossier({ handle, onClose }) {
  const { loading, data, error } = useAuthorData(handle)
  const a = data?.author || data || {}
  const tokensMoved = data?.tokens_moved || data?.tokens || []
  const tweets = data?.tweets || data?.recent_tweets || []
  const m = data?.metrics || {}
  const initial = (a.name || a.handle || handle || '?').slice(0, 1).toUpperCase()
  const verified = !!(a.verified || a.is_verified)

  return (
    <div className="sd-body">
      <header className="sd-header">
        <div className="sd-header-id">
          {a.avatar
            ? <img className="sd-logo" src={a.avatar} alt="" />
            : <span className="sd-logo sd-logo-ph">{initial}</span>}
          <div className="sd-id">
            <div className="sd-id-row">
              <span className="sd-name">{a.name || handle || 'Author'}</span>
              {verified && <span className="sd-verified" title="Verified">✓</span>}
            </div>
            <div className="sd-id-row">
              <span className="sd-handle mono">@{(a.handle || handle || '').replace(/^@/, '')}</span>
              {a.followers != null && (
                <span className="sd-handle-followers mono">{fmtCount(a.followers)} followers</span>
              )}
            </div>
          </div>
        </div>
        <button type="button" className="sd-close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      {error && (
        <div className="sd-warn">Author data unavailable · showing limited profile</div>
      )}

      {/* Metrics */}
      <section className="sd-section">
        <div className="sd-section-label mono">Author Metrics · 7d</div>
        <div className="sd-metric-grid">
          {loading ? (
            <>
              <div className="sd-metric-shim animate-shimmer" />
              <div className="sd-metric-shim animate-shimmer" />
              <div className="sd-metric-shim animate-shimmer" />
              <div className="sd-metric-shim animate-shimmer" />
            </>
          ) : (
            <>
              <div className="sd-metric">
                <div className="sd-metric-label mono">Mentions</div>
                <div className="sd-metric-value mono">{fmtCount(m.mentions_7d ?? m.mentions)}</div>
              </div>
              <div className="sd-metric">
                <div className="sd-metric-label mono">Engagement</div>
                <div className="sd-metric-value mono">{fmtCount(m.weighted_engagement ?? m.engagement)}</div>
              </div>
              <div className="sd-metric">
                <div className="sd-metric-label mono">Lead Time</div>
                <div className="sd-metric-value mono">{fmtHours(m.lead_time_avg ?? m.lead_time)}</div>
              </div>
              <div className="sd-metric">
                <div className="sd-metric-label mono">Hit Rate</div>
                <div className="sd-metric-value mono">{fmtPct(m.hit_rate)}</div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Tokens this author moves */}
      <section className="sd-section">
        <div className="sd-section-label mono">Tokens Moved</div>
        {loading ? (
          <div className="sd-list">
            <div className="sd-row-shim animate-shimmer" />
            <div className="sd-row-shim animate-shimmer" />
            <div className="sd-row-shim animate-shimmer" />
          </div>
        ) : tokensMoved.length === 0 ? (
          <div className="sd-empty">No tracked tokens for this author yet</div>
        ) : (
          <div className="sd-list">
            {tokensMoved.slice(0, 8).map((t, i) => (
              <TokenMovedRow key={t.asset || t.symbol || i} row={t} />
            ))}
          </div>
        )}
      </section>

      {/* Recent posts */}
      <section className="sd-section">
        <div className="sd-section-label mono">Recent Posts</div>
        {loading ? (
          <div className="sd-list">
            <div className="sd-tweet-shim animate-shimmer" />
            <div className="sd-tweet-shim animate-shimmer" />
          </div>
        ) : tweets.length === 0 ? (
          <div className="sd-empty">No recent posts cached</div>
        ) : (
          <div className="sd-list">
            {tweets.slice(0, 6).map((t, i) => (
              <TweetCard key={t.tweet_id || t.id || i} tweet={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
