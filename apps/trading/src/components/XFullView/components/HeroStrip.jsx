import { memo } from 'react'
import MetricGauge from './MetricGauge'
import MentionVelocityTile from './MentionVelocityTile'

/**
 * The hero strip — top row of the X Intelligence dashboard.
 *
 * Layout (single horizontal row of 7 cells):
 *   [Profile] [Mentions 24h] [Momentum] [Conviction] [Sentiment] [Reach] [Alpha]
 *
 * Profile and Alpha are wider; the 5 metric cells are equal-width.
 *
 * Pulls all values from the X Dash token detail response. Falls back to
 * placeholder rendering when intel is null/loading.
 */
function HeroStrip({ token, intel, loading, error, alphaSignals }) {
  const metrics = (intel && (intel.metrics || intel.token?.metrics)) || {}

  const mentions24h = num(metrics.mention_count_24h ?? metrics.mentions_24h)
  const mentions7d = num(metrics.mention_count_7d ?? metrics.mentions_7d)
  const momentum = num(metrics.momentum_score)
  const conviction = num(metrics.conviction_score)
  const sentiment = num(metrics.sentiment_score) // -1..+1
  const reach = num(metrics.reach_estimate ?? metrics.reach ?? metrics.reach_24h)

  // Velocity delta: 24h vs 7d-day-avg
  const dailyAvg = mentions7d > 0 ? mentions7d / 7 : 0
  const mentionDelta = dailyAvg > 0 ? ((mentions24h / dailyAvg) - 1) * 100 : null

  // Velocity sparkline series — try common shapes from the API.
  const seriesRaw =
    intel?.timeseries?.mentions_per_hour ||
    intel?.token?.mention_timeseries ||
    intel?.mention_timeseries ||
    intel?.metrics?.mention_timeseries ||
    null
  const series = Array.isArray(seriesRaw)
    ? seriesRaw
        .map((p) => (typeof p === 'number' ? p : num(p?.count ?? p?.value ?? p?.mentions)))
        .filter((n) => Number.isFinite(n))
        .slice(-24)
    : []

  // Sentiment for gauge: map -1..+1 -> 0..100
  const sentimentForGauge = Number.isFinite(sentiment) ? Math.round(((sentiment + 1) / 2) * 100) : null
  const sentimentTier =
    sentimentForGauge == null
      ? 'neutral'
      : sentiment >= 0.4
      ? 'hot'
      : sentiment >= -0.1
      ? 'warm'
      : 'cool'

  // Profile fields
  const profileName =
    intel?.token?.twitter_name ||
    intel?.token?.name ||
    token?.name ||
    token?.symbol ||
    '—'
  const profileHandle =
    intel?.token?.twitter_handle ||
    intel?.token?.handle ||
    null
  const followers = num(intel?.token?.twitter_followers ?? intel?.token?.followers)
  const avatar =
    intel?.token?.twitter_avatar ||
    intel?.token?.image ||
    intel?.token?.logo ||
    token?.logo ||
    '/round-logo.png'

  // Top 3 alpha signals for the alpha cell
  const topAlpha = Array.isArray(alphaSignals) ? alphaSignals.slice(0, 3) : []

  return (
    <div className="xfv-hero">
      {/* Profile */}
      <div className="xfv-hero-cell xfv-hero-cell--profile">
        <img className="xfv-hero-avatar" src={avatar} alt="" loading="lazy" />
        <div className="xfv-hero-profile-text">
          <div className="xfv-hero-profile-name">{profileName}</div>
          {profileHandle && <div className="xfv-hero-profile-handle">@{profileHandle}</div>}
          <div className="xfv-hero-profile-meta">
            {followers > 0 ? `${formatCompact(followers)} followers` : 'X profile'}
          </div>
        </div>
      </div>

      {/* Mentions 24h with sparkline */}
      <MentionVelocityTile
        label="MENTIONS 24H"
        value={mentions24h}
        delta={mentionDelta}
        series={series}
      />

      {/* Momentum gauge */}
      <div className="xfv-hero-cell xfv-hero-cell--metric">
        <div className="xfv-hero-label">MOMENTUM</div>
        <MetricGauge value={momentum} max={100} />
        <div className="xfv-hero-value" style={{ fontSize: 14 }}>
          {momentum > 0 ? Math.round(momentum) : '—'}
        </div>
      </div>

      {/* Conviction gauge */}
      <div className="xfv-hero-cell xfv-hero-cell--metric">
        <div className="xfv-hero-label">CONVICTION</div>
        <MetricGauge value={conviction} max={100} />
        <div className="xfv-hero-value" style={{ fontSize: 14 }}>
          {conviction > 0 ? Math.round(conviction) : '—'}
        </div>
      </div>

      {/* Sentiment gauge */}
      <div className="xfv-hero-cell xfv-hero-cell--metric">
        <div className="xfv-hero-label">SENTIMENT</div>
        <MetricGauge value={sentimentForGauge} max={100} tier={sentimentTier} />
        <div className="xfv-hero-value" style={{ fontSize: 14 }}>
          {Number.isFinite(sentiment) ? sentiment.toFixed(2) : '—'}
        </div>
      </div>

      {/* Reach */}
      <div className="xfv-hero-cell xfv-hero-cell--metric">
        <div className="xfv-hero-label">REACH</div>
        <div className="xfv-hero-value">{reach > 0 ? formatCompact(reach) : '—'}</div>
        <div className="xfv-hero-delta xfv-hero-delta--flat">est. impressions</div>
      </div>

      {/* Alpha signals (top 3) */}
      <div className="xfv-hero-cell xfv-hero-cell--alpha">
        <div className="xfv-hero-label">ALPHA</div>
        {topAlpha.length > 0 ? (
          <div className="xfv-alpha-badges">
            {topAlpha.map((s) => (
              <div key={s.id} className={`xfv-alpha-badge xfv-alpha-badge--${s.severity}`}>
                <span>{s.label}</span>
                {s.value && <span className="xfv-alpha-badge-value">{s.value}</span>}
              </div>
            ))}
          </div>
        ) : loading ? (
          <div className="xfv-alpha-empty">Analyzing…</div>
        ) : error ? (
          <div className="xfv-alpha-empty">Intelligence offline</div>
        ) : (
          <div className="xfv-alpha-empty">No signals yet</div>
        )}
      </div>
    </div>
  )
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function formatCompact(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export default memo(HeroStrip)
