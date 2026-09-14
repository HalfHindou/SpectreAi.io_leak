import { memo, useMemo } from 'react'

/**
 * KOLTrustCard — Phase 1.
 *
 * Shows the credibility of the selected tweet's author, computed entirely
 * from `intel.top_authors` (already fetched by the parent), so this panel
 * costs zero new network calls.
 *
 * Metrics surfaced:
 *   - avatar + name + handle + verified badge
 *   - followers
 *   - mentions of $TOKEN in the tracking window
 *   - influence tier (HIGH / MID / LOW)
 *   - bias (% bullish) — graceful fallback to "tracking..." if unknown
 *   - track-record placeholder for Phase 2
 */
function KOLTrustCard({ tweet, token, intel }) {
  const symbol = token?.symbol || ''
  const tweetHandle = normalizeHandle(tweet?.handle || tweet?._sourceHandle)

  const authorRow = useMemo(() => {
    const list = normalizeAuthors(intel)
    if (!list.length || !tweetHandle) return null
    return list.find((a) => normalizeHandle(a.handle) === tweetHandle) || null
  }, [intel, tweetHandle])

  const tier = authorRow
    ? authorRow.influenceScore >= 70 ? 'high'
      : authorRow.influenceScore >= 35 ? 'mid'
      : 'low'
    : null

  const tierLabel = tier ? tier.toUpperCase() : '—'
  const followers = authorRow?.followers ? formatCompact(authorRow.followers) : (tweet?.followers ? formatCompact(tweet.followers) : '—')
  const mentions = authorRow?.mentionCount ?? null
  const bias = computeBias(authorRow)

  return (
    <div className="xfv-intel-section xfv-intel-trust">
      <div className="xfv-intel-section-label">
        <span>KOL TRUST</span>
        {tier && <span className={`xfv-intel-trust-tier xfv-intel-trust-tier--${tier}`}>{tierLabel}</span>}
      </div>

      <div className="xfv-intel-trust-row">
        {(tweet?.avatar || authorRow?.avatar) && (
          <img
            className="xfv-intel-trust-avatar"
            src={tweet?.avatar || authorRow?.avatar}
            alt=""
            loading="lazy"
          />
        )}
        <div className="xfv-intel-trust-id">
          <div className="xfv-intel-trust-name">{tweet?.user || authorRow?.name || 'Unknown'}</div>
          <div className="xfv-intel-trust-handle">{tweet?.handle || authorRow?.handle || ''}</div>
        </div>
      </div>

      <div className="xfv-intel-trust-metrics">
        <Metric label="Followers" value={followers} />
        <Metric
          label={symbol ? `$${symbol} mentions` : 'Mentions'}
          value={mentions != null ? String(mentions) : '—'}
        />
        <Metric
          label="Bias"
          value={bias.label}
          tone={bias.tone}
        />
      </div>

      <div className="xfv-intel-trust-track">
        <span className="xfv-intel-trust-track-dot" aria-hidden="true" />
        Track record · tracking...
      </div>
    </div>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div className={`xfv-intel-metric ${tone ? `xfv-intel-metric--${tone}` : ''}`}>
      <div className="xfv-intel-metric-label">{label}</div>
      <div className="xfv-intel-metric-value">{value}</div>
    </div>
  )
}

function computeBias(author) {
  if (!author) return { label: '—', tone: null }
  const sentiment = author.sentiment
  if (sentiment == null || !Number.isFinite(sentiment)) {
    return { label: 'tracking...', tone: null }
  }
  // sentiment scale: assume -1..1 OR 0..100. Normalize.
  let pct
  if (sentiment >= -1 && sentiment <= 1) {
    pct = Math.round(((sentiment + 1) / 2) * 100)
  } else {
    pct = Math.max(0, Math.min(100, Math.round(sentiment)))
  }
  if (pct >= 60) return { label: `${pct}% bullish`, tone: 'bull' }
  if (pct <= 40) return { label: `${100 - pct}% bearish`, tone: 'bear' }
  return { label: 'neutral', tone: null }
}

function normalizeHandle(h) {
  if (!h) return ''
  return String(h).replace(/^@/, '').toLowerCase()
}

function normalizeAuthors(intel) {
  if (!intel) return []
  const raw = intel.top_authors || intel.authors || intel.token?.top_authors || []
  if (!Array.isArray(raw)) return []
  return raw.map((a) => {
    const handle = a.handle || a.screen_name || a.username || a.author_handle || ''
    return {
      id: a.user_id || a.id || handle,
      handle: handle.startsWith('@') ? handle : `@${handle}`,
      name: a.name || a.display_name || a.author_name || handle,
      avatar: a.avatar_url || a.profile_image || a.author_avatar_url || a.avatar || null,
      followers: num(a.followers ?? a.followers_count ?? a.author_followers),
      mentionCount: num(a.mention_count ?? a.mentions ?? a.tweets_count ?? 0),
      influenceScore: num(a.influence_score ?? a.score ?? 0),
      sentiment: a.sentiment ?? a.bias ?? a.sentiment_score ?? null,
    }
  })
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function formatCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export default memo(KOLTrustCard)
