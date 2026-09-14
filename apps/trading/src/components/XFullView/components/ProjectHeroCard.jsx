import { memo } from 'react'

/**
 * ProjectHeroCard — the cinematic top section of the X Intelligence dashboard.
 *
 * Wall Street terminal meets Apple: heavy glass, banner, big avatar, bio,
 * Follow-on-X CTA, follower/following counts, category chips, key metrics row.
 *
 * Data sources:
 *   - `author`  → from /api/tweets/official (followers, bio, banner, verified)
 *   - `intel`   → X Dash API (mentions, velocity, engagement, market cap, rank)
 *   - `token`   → currently selected token (fallback identity)
 */
function ProjectHeroCard({ token, intel, author, alphaSignals, rug }) {
  // The /token/:cgId payload carries the asset metadata at `intel.token`
  // (name, cashtag, tags, market_cap, global_rank…). Older/alt shapes nested
  // it at `intel.asset` / `intel.token.token`, so fall through all three.
  const asset = intel?.asset || intel?.token?.token || intel?.token || {}
  const metrics = intel?.metrics || intel?.token?.metrics || {}
  const quality = intel?.quality || intel?.token?.quality || {}

  // Identity — author wins because it has bio + counts; intel.asset is the
  // canonical fallback when tweets endpoint is empty.
  const displayName =
    author?.name ||
    asset.name ||
    token?.name ||
    token?.symbol ||
    '—'

  const handle =
    author?.screen_name ||
    asset.handle ||
    null

  const avatar =
    upgradeAvatar(author?.avatar_image_url) ||
    asset.image_large ||
    asset.image_url ||
    token?.logo ||
    '/round-logo.png'

  const banner = author?.profile_banner_url || null

  const bio = author?.description || buildFallbackBio(asset)
  const isVerified = !!(author?.account_state?.is_blue_verified || author?.account_state?.verified)

  const followers = num(author?.counts?.followers_count)
  const following = num(author?.counts?.friends_count)
  const totalTweets = num(author?.counts?.statuses_count)

  const cashtag = asset.cashtag || (token?.symbol ? `$${token.symbol}` : null)
  const chain = asset.chain || token?.chain || token?.network || null
  const marketCap = num(asset.market_cap)
  const globalRank = num(asset.global_rank)

  // Tags / categories — first 4
  const tags = Array.isArray(asset.tags) ? asset.tags.slice(0, 4) : []

  // Metrics row (real X Dash fields)
  const mentions24h = num(metrics.mentions_24h)
  const totalMentions = num(metrics.total_mentions)
  const uniqueAuthors24h = num(metrics.unique_external_authors_24h)
  const uniqueAuthors = num(metrics.unique_authors)
  const velocityRatio = num(metrics.velocity_ratio)
  const engagement24h = num(metrics.external_weighted_engagement_24h)
  const totalEngagement = num(metrics.total_weighted_engagement)
  const cleanSignal = num(quality.clean_signal_score) // 0..1

  const followUrl = handle
    ? `https://x.com/intent/follow?screen_name=${encodeURIComponent(handle)}`
    : null
  const profileUrl = handle ? `https://x.com/${handle}` : null

  // Top 3 alpha signals — shown on the right column of the hero
  const topAlpha = Array.isArray(alphaSignals) ? alphaSignals.slice(0, 3) : []

  return (
    <section className="xfv-hero-card">
      {/* Banner background */}
      <div className="xfv-hero-banner" aria-hidden="true">
        {banner && (
          <img
            src={banner}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <div className="xfv-hero-banner-fade" />
      </div>

      {/* Foreground content */}
      <div className="xfv-hero-card-body">
        {/* LEFT — profile identity */}
        <div className="xfv-hero-profile">
          <div className="xfv-hero-avatar-wrap">
            <img
              className="xfv-hero-avatar-lg"
              src={avatar}
              alt={displayName}
              loading="lazy"
              onError={(e) => { e.currentTarget.src = '/round-logo.png' }}
            />
            {isVerified && (
              <span className="xfv-hero-verified" title="Verified">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M9 16.17l-3.88-3.88L3.7 13.7 9 19l11-11-1.41-1.42z" />
                </svg>
              </span>
            )}
          </div>

          <div className="xfv-hero-id">
            <h1 className="xfv-hero-name">{displayName}</h1>
            <div className="xfv-hero-meta-row">
              {handle && <span className="xfv-hero-handle-lg">@{handle}</span>}
              {cashtag && <span className="xfv-hero-cashtag">{cashtag}</span>}
              {chain && <span className="xfv-hero-chain">{chain}</span>}
              {rug?.tag && (
                <span className={`xfv-hero-rug xfv-hero-rug--${rug.tier}`} title={rug.thesis}>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <path d="M12 9v4M12 17h.01" />
                  </svg>
                  {rug.label}
                </span>
              )}
            </div>

            {bio && <p className="xfv-hero-bio">{bio}</p>}

            {/* Author profile arrives late (or never, for unlinked tokens) —
                don't render a fake "0 following · 0 followers" row. */}
            {author && (followers > 0 || following > 0 || totalTweets > 0) && (
              <div className="xfv-hero-counts">
                <span className="xfv-hero-count">
                  <span className="xfv-hero-count-num">{formatCompact(following)}</span>
                  <span className="xfv-hero-count-label">Following</span>
                </span>
                <span className="xfv-hero-count xfv-hero-count--accent">
                  <span className="xfv-hero-count-num">{formatCompact(followers)}</span>
                  <span className="xfv-hero-count-label">Followers</span>
                </span>
                {totalTweets > 0 && (
                  <span className="xfv-hero-count">
                    <span className="xfv-hero-count-num">{formatCompact(totalTweets)}</span>
                    <span className="xfv-hero-count-label">Posts</span>
                  </span>
                )}
              </div>
            )}

            <div className="xfv-hero-actions">
              {followUrl && (
                <a
                  href={followUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="xfv-hero-follow-btn"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  <span>Follow</span>
                </a>
              )}
              {profileUrl && (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="xfv-hero-profile-btn"
                >
                  View profile
                </a>
              )}
            </div>

            {tags.length > 0 && (
              <div className="xfv-hero-tags">
                {tags.map((t) => (
                  <span key={t} className="xfv-hero-tag">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — metrics + alpha */}
        <div className="xfv-hero-metrics">
          <div className="xfv-hero-metrics-grid">
            <MetricTile
              label="Mentions 24h"
              value={formatCompact(mentions24h)}
              sub={totalMentions > 0 ? `${formatCompact(totalMentions)} total` : null}
              tone={mentions24h > 0 ? 'live' : 'muted'}
            />
            <MetricTile
              label="Velocity"
              value={velocityRatio > 0 ? `${velocityRatio.toFixed(2)}x` : '—'}
              sub={velocityRatio > 1.5 ? 'Accelerating' : velocityRatio > 0 ? 'Steady' : null}
              tone={velocityRatio >= 2 ? 'hot' : velocityRatio >= 1.2 ? 'warm' : 'muted'}
            />
            <MetricTile
              label="KOLs 24h"
              value={formatCompact(uniqueAuthors24h)}
              sub={uniqueAuthors > 0 ? `${formatCompact(uniqueAuthors)} all-time` : null}
              tone={uniqueAuthors24h > 0 ? 'live' : 'muted'}
            />
            <MetricTile
              label="Engagement 24h"
              value={formatCompact(engagement24h)}
              sub={totalEngagement > 0 ? `${formatCompact(totalEngagement)} total` : null}
              tone={engagement24h > 0 ? 'live' : 'muted'}
            />
            <MetricTile
              label="Signal Quality"
              value={cleanSignal > 0 ? `${Math.round(cleanSignal * 100)}%` : '—'}
              sub={cleanSignal >= 0.6 ? 'High signal' : cleanSignal >= 0.3 ? 'Mixed' : null}
              tone={cleanSignal >= 0.6 ? 'hot' : cleanSignal >= 0.3 ? 'warm' : 'muted'}
            />
            <MetricTile
              label="Market Cap"
              value={marketCap > 0 ? `$${formatCompact(marketCap)}` : '—'}
              sub={globalRank > 0 ? `Rank #${globalRank}` : null}
              tone="muted"
            />
          </div>

          {topAlpha.length > 0 && (
            <div className="xfv-hero-alpha">
              <div className="xfv-hero-alpha-label">Alpha Signals</div>
              <div className="xfv-hero-alpha-list">
                {topAlpha.map((s) => (
                  <div key={s.id} className={`xfv-hero-alpha-pill xfv-hero-alpha-pill--${s.severity}`}>
                    <span className="xfv-hero-alpha-pill-label">{s.label}</span>
                    {s.value && <span className="xfv-hero-alpha-pill-value">{s.value}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function MetricTile({ label, value, sub, tone = 'muted' }) {
  return (
    <div className={`xfv-metric-tile xfv-metric-tile--${tone}`}>
      <div className="xfv-metric-tile-label">{label}</div>
      <div className="xfv-metric-tile-value">{value}</div>
      {sub && <div className="xfv-metric-tile-sub">{sub}</div>}
    </div>
  )
}

// Twitter avatars come back as `_normal` (48px). Upgrade to `_400x400` so the
// big hero avatar isn't pixelated when blown up.
function upgradeAvatar(url) {
  if (!url || typeof url !== 'string') return null
  return url.replace(/_normal\.(jpg|png|jpeg|webp|gif)/i, '_400x400.$1')
}

function buildFallbackBio(asset) {
  if (!asset || typeof asset !== 'object') return null
  const parts = []
  if (asset.primary_category) parts.push(asset.primary_category)
  if (asset.chain) parts.push(`${asset.chain} chain`)
  if (Array.isArray(asset.tags) && asset.tags.length > 0) {
    parts.push(asset.tags.slice(0, 2).join(', '))
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function formatCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export default memo(ProjectHeroCard)
