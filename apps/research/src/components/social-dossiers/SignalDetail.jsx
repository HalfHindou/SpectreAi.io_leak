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
function ageOf(iso) {
  if (!iso) return ''
  const then = typeof iso === 'string' ? new Date(iso).getTime() : iso
  const diff = Math.max(0, Date.now() - then)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function useSignal(signalId) {
  const [state, setState] = useState({ loading: true, signal: null, error: null })
  useEffect(() => {
    if (!signalId) return undefined
    let cancelled = false
    setState({ loading: true, signal: null, error: null })

    const direct = fetch(`/api/social-signals/signal/${encodeURIComponent(signalId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return null
        return j?.data || j?.signal || j
      })
      .catch(() => null)

    direct.then((d) => {
      if (cancelled) return
      if (d && (d.id || d.type)) {
        setState({ loading: false, signal: d, error: null })
        return
      }
      // Fallback: scan the feed for the id
      fetch('/api/social-signals/feed?limit=200')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled) return
          if (!j) {
            setState({ loading: false, signal: null, error: 'Signal feed unavailable' })
            return
          }
          const list = Array.isArray(j) ? j : (j.signals || j.data || j.feed || [])
          const found = list.find((s) => String(s.id) === String(signalId))
          if (found) {
            setState({ loading: false, signal: found, error: null })
          } else {
            setState({ loading: false, signal: null, error: 'Signal not found' })
          }
        })
        .catch((e) => {
          if (cancelled) return
          setState({ loading: false, signal: null, error: e?.message || 'load failed' })
        })
    })

    return () => { cancelled = true }
  }, [signalId])
  return state
}

function ReplayChart({ series, fireTs }) {
  const path = useMemo(() => {
    if (!series || series.length < 2) return ''
    const w = 360, h = 80
    const values = series.map((p) => Number(p.v ?? p.value ?? p[1] ?? 0))
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    return values.map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [series])

  if (!path) {
    return (
      <div className="sd-replay-empty">
        <span className="sd-replay-empty-text">No replay data available</span>
      </div>
    )
  }

  // Find fire-time x-position if timestamps are present
  let fireX = null
  if (fireTs && series && series.length > 1) {
    const ts = series.map((p) => Number(p.t ?? p.ts ?? p[0] ?? 0))
    const fire = typeof fireTs === 'string' ? new Date(fireTs).getTime() : Number(fireTs)
    if (ts.every((t) => isFinite(t)) && ts.length) {
      const minT = ts[0], maxT = ts[ts.length - 1]
      if (maxT > minT && fire >= minT && fire <= maxT) {
        fireX = ((fire - minT) / (maxT - minT)) * 360
      }
    }
  }

  return (
    <svg className="sd-replay" width="100%" height="80" viewBox="0 0 360 80" preserveAspectRatio="none" aria-hidden>
      <path d={path} fill="none" stroke="rgba(245,245,247,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {fireX != null && (
        <line x1={fireX} y1="0" x2={fireX} y2="80" stroke="var(--bull)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
      )}
    </svg>
  )
}

export default function SignalDetail({ signalId, onClose }) {
  const { loading, signal, error } = useSignal(signalId)
  const sev = signal?.severity || signal?.grade || 'C'
  const evidence = signal?.evidence || {}
  const authors = evidence?.authors || signal?.authors || []
  const tweetIds = evidence?.tweet_ids || []
  const tweets = evidence?.tweets || signal?.tweets || []
  const replay = signal?.replay || signal?.timeseries || evidence?.timeseries || []

  return (
    <div className="sd-body">
      <header className="sd-header">
        <div className="sd-header-id">
          <span className="sd-signal-badge" data-severity={sev}>{sev}</span>
          <div className="sd-id">
            <div className="sd-id-row">
              <span className="sd-symbol mono">{signal?.type || 'signal'}</span>
              {signal?.asset && <span className="sd-asset-chip mono">${String(signal.asset).toUpperCase()}</span>}
            </div>
            <div className="sd-name mono">{signal?.ts ? ageOf(signal.ts) : 'Loading…'}</div>
          </div>
        </div>
        <button type="button" className="sd-close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      {error && (
        <div className="sd-error">Couldn't load signal — {error}</div>
      )}

      {/* Summary */}
      <section className="sd-section">
        <div className="sd-section-label mono">Summary</div>
        {loading ? (
          <div className="sd-row-shim animate-shimmer" />
        ) : (
          <div className="sd-summary">{signal?.summary || 'No summary'}</div>
        )}
      </section>

      {/* Evidence */}
      <section className="sd-section">
        <div className="sd-section-label mono">Evidence</div>
        {loading ? (
          <div className="sd-list">
            <div className="sd-row-shim animate-shimmer" />
            <div className="sd-row-shim animate-shimmer" />
          </div>
        ) : (authors.length === 0 && tweetIds.length === 0 && tweets.length === 0) ? (
          <div className="sd-empty">No evidence captured</div>
        ) : (
          <div className="sd-evidence">
            {authors.length > 0 && (
              <div className="sd-evidence-block">
                <div className="sd-evidence-sub mono">Authors</div>
                <div className="sd-evidence-authors">
                  {authors.slice(0, 6).map((a, i) => (
                    <span key={a.id || a.handle || i} className="sd-evidence-author">
                      {a.avatar
                        ? <img className="sd-evidence-avatar" src={a.avatar} alt="" />
                        : <span className="sd-evidence-avatar sd-evidence-avatar-fb">
                            {(a.name || a.handle || '?').slice(0, 1).toUpperCase()}
                          </span>}
                      <span className="sd-evidence-author-meta">
                        <span className="sd-evidence-handle mono">@{a.handle || a.id}</span>
                        {a.followers != null && (
                          <span className="sd-evidence-followers mono">{fmtCount(a.followers)}</span>
                        )}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {tweets.length > 0 && (
              <div className="sd-evidence-block">
                <div className="sd-evidence-sub mono">Tweets</div>
                <div className="sd-list">
                  {tweets.slice(0, 4).map((t, i) => {
                    const text = t.full_text || t.text || ''
                    const truncated = text.length > 200 ? `${text.slice(0, 200)}…` : text
                    const url = t.url || t.x_url
                    const Tag = url ? 'a' : 'div'
                    return (
                      <Tag key={t.tweet_id || t.id || i} className="sd-tweet" {...(url ? { href: url, target: '_blank', rel: 'noreferrer' } : {})}>
                        <div className="sd-tweet-text">{truncated}</div>
                      </Tag>
                    )
                  })}
                </div>
              </div>
            )}
            {tweets.length === 0 && tweetIds.length > 0 && (
              <div className="sd-evidence-block">
                <div className="sd-evidence-sub mono">Tweet IDs</div>
                <div className="sd-evidence-ids mono">
                  {tweetIds.slice(0, 8).map((id) => <span key={id} className="sd-evidence-id">{id}</span>)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Replay timeline */}
      <section className="sd-section">
        <div className="sd-section-label mono">Replay · mentions/hr</div>
        {loading ? (
          <div className="sd-replay-shim animate-shimmer" />
        ) : (
          <ReplayChart series={replay} fireTs={signal?.ts} />
        )}
        {signal?.lead_time_hint && (
          <div className="sd-lead mono">Lead time: {signal.lead_time_hint}</div>
        )}
      </section>
    </div>
  )
}
