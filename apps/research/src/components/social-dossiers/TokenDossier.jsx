import { useEffect, useState } from 'react'
import './social-dossier-shared.css'

/* ── format helpers ──────────────────────────────────────────────────────── */
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
  const sign = n > 0 ? '+' : ''
  return `${sign}${Number(n).toFixed(1)}%`
}
function fmtSentiment(s) {
  if (s == null || !isFinite(s)) return '—'
  return Number(s).toFixed(2)
}
function fmtRatio(r) {
  if (r == null || !isFinite(r)) return '—'
  return `${Number(r).toFixed(2)}×`
}
function timeAgo(iso) {
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
function deltaColor(n) {
  if (n == null || !isFinite(n)) return 'var(--text-tertiary)'
  if (n > 0) return 'var(--bull)'
  if (n < 0) return 'var(--bear)'
  return 'var(--text-tertiary)'
}

/* ── data hook ───────────────────────────────────────────────────────────── */
function useTokenDossierData(asset) {
  const [state, setState] = useState({ loading: true, data: null, error: null, signals: [] })
  useEffect(() => {
    if (!asset) return undefined
    let cancelled = false
    setState({ loading: true, data: null, error: null, signals: [] })

    const fetchToken = fetch(`/api/x-bubbles/${encodeURIComponent(asset)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => j?.data || j)
      .catch((e) => ({ __err: e?.message || 'load failed' }))

    const fetchSignals = fetch(`/api/social-signals/feed?asset=${encodeURIComponent(asset)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return []
        const list = Array.isArray(j) ? j : (j.signals || j.data || j.feed || [])
        return Array.isArray(list) ? list.filter((s) => !s.asset || String(s.asset).toUpperCase() === String(asset).toUpperCase()) : []
      })
      .catch(() => [])

    Promise.all([fetchToken, fetchSignals]).then(([data, signals]) => {
      if (cancelled) return
      if (data?.__err) {
        setState({ loading: false, data: null, error: data.__err, signals })
      } else {
        setState({ loading: false, data, error: null, signals })
      }
    })

    return () => { cancelled = true }
  }, [asset])
  return state
}

/* ── pieces ──────────────────────────────────────────────────────────────── */
function Metric({ label, value, accent }) {
  return (
    <div className="sd-metric">
      <div className="sd-metric-label mono">{label}</div>
      <div className="sd-metric-value mono" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  )
}

function CarrierRow({ author }) {
  const initial = (author.name || author.handle || '?').slice(0, 1).toUpperCase()
  return (
    <div className="sd-carrier">
      {author.avatar
        ? <img className="sd-carrier-avatar" src={author.avatar} alt="" />
        : <span className="sd-carrier-avatar sd-carrier-avatar-fb">{initial}</span>}
      <div className="sd-carrier-id">
        <div className="sd-carrier-name">{author.name || author.handle || 'Anonymous'}</div>
        {author.handle && <div className="sd-carrier-handle mono">@{author.handle}</div>}
      </div>
      <div className="sd-carrier-stats">
        {author.followers != null && (
          <div className="sd-carrier-followers mono">{fmtCount(author.followers)}</div>
        )}
        {author.mention_count != null && (
          <div className="sd-carrier-contrib mono">{fmtCount(author.mention_count)} mentions</div>
        )}
      </div>
    </div>
  )
}

function TweetCard({ tweet }) {
  const a = tweet.author || {}
  const initial = (a.name || a.handle || '?').slice(0, 1).toUpperCase()
  const text = tweet.full_text || tweet.text || ''
  const truncated = text.length > 240 ? `${text.slice(0, 240)}…` : text
  const url = tweet.url || tweet.x_url
  const Tag = url ? 'a' : 'div'
  return (
    <Tag className="sd-tweet" {...(url ? { href: url, target: '_blank', rel: 'noreferrer' } : {})}>
      <div className="sd-tweet-head">
        {a.avatar
          ? <img className="sd-tweet-avatar" src={a.avatar} alt="" />
          : <span className="sd-tweet-avatar sd-tweet-avatar-fb">{initial}</span>}
        <div className="sd-tweet-author">
          <span className="sd-tweet-name">{a.name || a.handle || 'Anonymous'}</span>
          {a.handle && <span className="sd-tweet-handle mono">@{a.handle}</span>}
        </div>
      </div>
      <div className="sd-tweet-text">{truncated}</div>
      <div className="sd-tweet-stats mono">
        {tweet.metrics?.likes != null && <span>♥ {fmtCount(tweet.metrics.likes)}</span>}
        {tweet.metrics?.retweets != null && <span>↻ {fmtCount(tweet.metrics.retweets)}</span>}
        {tweet.metrics?.replies != null && <span>↩ {fmtCount(tweet.metrics.replies)}</span>}
      </div>
    </Tag>
  )
}

function SignalChip({ signal }) {
  const sev = signal.severity || signal.grade || 'C'
  return (
    <div className="sd-signal-chip" data-severity={sev}>
      <span className="sd-signal-grade mono">{sev}</span>
      <span className="sd-signal-type">{signal.type || 'signal'}</span>
      <span className="sd-signal-summary">{signal.summary || ''}</span>
      {signal.ts && <span className="sd-signal-time mono">{timeAgo(signal.ts)}</span>}
    </div>
  )
}

/* ── main component ──────────────────────────────────────────────────────── */
export default function TokenDossier({ asset, onClose }) {
  const { loading, data, error, signals } = useTokenDossierData(asset)
  const m = data?.metrics
  const tweets = data?.tweets || []
  const carriers = data?.top_authors || data?.carriers || []
  const name = data?.name || asset
  const image = data?.image
  const rank = data?.rank
  const symbol = String(asset || '').toUpperCase()

  return (
    <div className="sd-body">
      {/* Header */}
      <header className="sd-header">
        <div className="sd-header-id">
          {image
            ? <img className="sd-logo" src={image} alt="" />
            : <span className="sd-logo sd-logo-ph">{symbol.slice(0, 1)}</span>}
          <div className="sd-id">
            <div className="sd-id-row">
              <span className="sd-symbol mono">{symbol}</span>
              {rank != null && <span className="sd-rank mono">#{rank}</span>}
            </div>
            <div className="sd-name">{name}</div>
          </div>
        </div>
        <button type="button" className="sd-close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      {error && (
        <div className="sd-error">Couldn't load dossier — {error}</div>
      )}

      {/* Metrics */}
      <section className="sd-section">
        <div className="sd-section-label mono">Metrics · 24h</div>
        <div className="sd-metric-grid">
          {loading ? (
            <>
              <div className="sd-metric-shim animate-shimmer" />
              <div className="sd-metric-shim animate-shimmer" />
              <div className="sd-metric-shim animate-shimmer" />
              <div className="sd-metric-shim animate-shimmer" />
              <div className="sd-metric-shim animate-shimmer" />
            </>
          ) : (
            <>
              <Metric label="Mentions" value={fmtCount(m?.mentions_24h)} />
              <Metric label="7d Avg" value={fmtCount(m?.mentions_7d_avg)} />
              <Metric label="Growth" value={fmtPct(m?.growth_pct)} accent={deltaColor(m?.growth_pct)} />
              <Metric label="Sentiment" value={fmtSentiment(m?.sentiment)} accent={deltaColor(m?.sentiment)} />
              <Metric label="Velocity" value={fmtRatio(m?.velocity_ratio)} />
            </>
          )}
        </div>
      </section>

      {/* Carriers */}
      <section className="sd-section">
        <div className="sd-section-label mono">Top Carriers</div>
        {loading ? (
          <div className="sd-list">
            <div className="sd-row-shim animate-shimmer" />
            <div className="sd-row-shim animate-shimmer" />
            <div className="sd-row-shim animate-shimmer" />
          </div>
        ) : carriers.length === 0 ? (
          <div className="sd-empty">No carrier data</div>
        ) : (
          <div className="sd-list">
            {carriers.slice(0, 5).map((a, i) => (
              <CarrierRow key={a.id || a.handle || i} author={a} />
            ))}
          </div>
        )}
      </section>

      {/* Signals */}
      <section className="sd-section">
        <div className="sd-section-label mono">Active Signals</div>
        {signals.length === 0 ? (
          <div className="sd-empty">No active signals</div>
        ) : (
          <div className="sd-signals">
            {signals.slice(0, 4).map((s) => <SignalChip key={s.id || s.ts} signal={s} />)}
          </div>
        )}
      </section>

      {/* Tweets */}
      <section className="sd-section">
        <div className="sd-section-label mono">Top Mentions</div>
        {loading ? (
          <div className="sd-list">
            <div className="sd-tweet-shim animate-shimmer" />
            <div className="sd-tweet-shim animate-shimmer" />
            <div className="sd-tweet-shim animate-shimmer" />
          </div>
        ) : tweets.length === 0 ? (
          <div className="sd-empty">No fresh tweets cached</div>
        ) : (
          <div className="sd-list">
            {tweets.slice(0, 8).map((t, i) => (
              <TweetCard key={t.tweet_id || t.id || i} tweet={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
