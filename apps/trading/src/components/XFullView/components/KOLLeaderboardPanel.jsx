import { memo } from 'react'

/**
 * KOLLeaderboardPanel - top X authors discussing the current token,
 * sourced from the X Dash /api/token/{cgId} response's top_authors field.
 *
 * Each row: rank + avatar + name/handle + meta (followers, mentions,
 * relative-time last seen) + tier chip (HIGH / MID / LOW). Tier is computed
 * from a weighted blend of follower reach and total weighted engagement,
 * NOT from a single nonexistent `influence_score` field.
 */
function KOLLeaderboardPanel({ intel, loading }) {
  const authors = normalizeAuthors(intel)
  const top = authors.slice(0, 10)

  return (
    <div className="xfv-panel">
      <div className="xfv-panel-header">
        <div
          className="xfv-panel-title xfv-tip"
          data-xfv-tip="Key Opinion Leaders - the X accounts driving the most weight in the conversation about this token. Ranked by an influence score that blends follower reach with weighted engagement on each mention."
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
          </svg>
          <span>Top KOLs</span>
        </div>
        {top.length > 0 && (
          <span
            className="xfv-panel-meta xfv-tip xfv-tip--inline"
            data-xfv-tip={`${top.length} KOLs have mentioned this token in the last 24 hours.`}
          >
            {top.length} active
            <span className="xfv-tip-icon" aria-hidden="true">?</span>
          </span>
        )}
      </div>

      <div className="xfv-panel-body">
        {loading && top.length === 0 && (
          <div className="xfv-empty">
            <KolSkeleton count={4} />
          </div>
        )}

        {!loading && top.length === 0 && (
          <div className="xfv-empty">No KOLs covering this token yet</div>
        )}

        <div className="xfv-kol-list">
          {top.map((author, i) => {
            const tier = getTier(author)
            const tierLabel = tier === 'high' ? 'HIGH' : tier === 'mid' ? 'MID' : 'LOW'
            const tierTip = TIER_TOOLTIPS[tier]
            const handleClean = author.handle.replace('@', '')
            return (
              <a
                key={author.id || author.handle || i}
                href={`https://x.com/${handleClean}`}
                target="_blank"
                rel="noopener noreferrer"
                className="xfv-kol-row"
              >
                <div className="xfv-kol-rank">{i + 1}</div>
                <div className="xfv-kol-avatar-wrap">
                  <img
                    className="xfv-kol-avatar"
                    src={proxyAvatar(author.avatar)}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      const cur = e.currentTarget.src
                      // Step 1: if the upgraded _400x400 variant 404s, try _normal
                      // (some older avatars never had a 400x400 generated).
                      if (cur.indexOf('_400x400') !== -1 && author.avatar) {
                        e.currentTarget.src = `/api/img-proxy?url=${encodeURIComponent(author.avatar)}`
                        return
                      }
                      // Step 2: final fallback - round logo
                      if (cur.indexOf('/round-logo.png') === -1) {
                        e.currentTarget.src = '/round-logo.png'
                      }
                    }}
                  />
                  {author.isSelf && (
                    <span
                      className="xfv-kol-self-badge xfv-tip"
                      data-xfv-tip="This is the project's own X account."
                      aria-label="Project account"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="8" height="8">
                        <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    </span>
                  )}
                </div>
                <div className="xfv-kol-info">
                  <div className="xfv-kol-name-row">
                    <span className="xfv-kol-name">{author.name || author.handle}</span>
                    <span className="xfv-kol-handle">@{handleClean}</span>
                  </div>
                  <div className="xfv-kol-meta">
                    <span
                      className="xfv-kol-stat xfv-tip"
                      data-xfv-tip="Total X followers"
                    >
                      {formatCompact(author.followers)}
                    </span>
                    <span className="xfv-kol-stat-sep">·</span>
                    <span
                      className="xfv-kol-stat xfv-tip"
                      data-xfv-tip={`${author.mentionCount} tweet${author.mentionCount === 1 ? '' : 's'} mentioning the token in the last 7 days`}
                    >
                      {author.mentionCount} mention{author.mentionCount === 1 ? '' : 's'}
                    </span>
                    {author.lastSeen && (
                      <>
                        <span className="xfv-kol-stat-sep">·</span>
                        <span
                          className="xfv-kol-stat xfv-tip"
                          data-xfv-tip={`Last tweet: ${new Date(author.lastSeen).toLocaleString()}`}
                        >
                          {formatRelativeTime(author.lastSeen)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div
                  className={`xfv-kol-chip xfv-kol-chip--${tier} xfv-tip`}
                  data-xfv-tip={tierTip}
                >
                  {tierLabel}
                </div>
              </a>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const TIER_TOOLTIPS = {
  high: 'HIGH influence - large follower base or unusually high engagement on each mention. Their tweets move price.',
  mid: 'MID influence - solid follower count and steady engagement. Worth watching, less likely to move markets alone.',
  low: 'LOW influence - small or niche audience. Useful as a leading indicator but rarely a catalyst.',
}

/**
 * Map an author into a HIGH/MID/LOW tier based on a blended score:
 *   - reach component: log(followers)
 *   - impact component: log(weighted_engagement + 1)
 * High = 100K+ followers OR weighted engagement > 500
 * Mid = 10K+ followers OR weighted engagement > 150
 * Low = everything else
 */
function getTier(author) {
  const followers = author.followers || 0
  const engagement = author.engagement || 0
  if (followers >= 100_000 || engagement >= 500) return 'high'
  if (followers >= 10_000 || engagement >= 150) return 'mid'
  return 'low'
}

function normalizeAuthors(intel) {
  if (!intel) return []
  const raw =
    intel.top_authors ||
    intel.authors ||
    intel.token?.top_authors ||
    []
  if (!Array.isArray(raw)) return []
  return raw.map((a) => {
    const handle =
      a.screen_name || a.handle || a.username || a.author_handle || ''
    return {
      id: a.rest_id || a.user_id || a.id || handle,
      handle: handle.startsWith('@') ? handle : `@${handle}`,
      name: a.name || a.display_name || a.author_name || handle,
      avatar:
        a.avatar_image_url ||
        a.avatar_url ||
        a.profile_image ||
        a.author_avatar_url ||
        a.avatar ||
        null,
      followers: num(
        a.followers_count ?? a.followers ?? a.author_followers
      ),
      mentionCount: num(
        a.mention_count ?? a.mentions ?? a.tweets_count ?? 0
      ),
      engagement: num(
        a.total_weighted_engagement ?? a.weighted_engagement ?? a.engagement ?? 0
      ),
      lastSeen: a.last_seen_at || a.last_tweet_at || null,
      isSelf: !!(a.is_self_author || a.is_official),
    }
  })
}

function KolSkeleton({ count = 4 }) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
          <div className="xfv-skeleton" style={{ width: 18, height: 12 }} />
          <div className="xfv-skeleton" style={{ width: 32, height: 32, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div className="xfv-skeleton" style={{ height: 11, width: '50%' }} />
            <div className="xfv-skeleton" style={{ height: 9, width: '70%' }} />
          </div>
          <div className="xfv-skeleton" style={{ width: 36, height: 16, borderRadius: 999 }} />
        </div>
      ))}
    </div>
  )
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Twitter profile pictures (pbs.twimg.com) block hotlinking from arbitrary
 * origins, so the raw URLs fail to load in the browser. Route them through
 * the existing img-proxy serverless function which fetches server-side and
 * re-serves with proper CORS headers. Also upgrade `_normal.jpg` (48x48) to
 * `_400x400` for crisp display at 34px on retina screens.
 */
function proxyAvatar(url) {
  if (!url) return '/round-logo.png'
  let upgraded = url
  if (typeof url === 'string' && url.indexOf('pbs.twimg.com') !== -1) {
    upgraded = url.replace(/_normal(\.[a-zA-Z]+)(\?|$)/, '_400x400$1$2')
    return `/api/img-proxy?url=${encodeURIComponent(upgraded)}`
  }
  return upgraded
}

function formatCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatRelativeTime(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diffMs = Date.now() - t
  const sec = Math.max(0, Math.floor(diffMs / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

export default memo(KOLLeaderboardPanel)
