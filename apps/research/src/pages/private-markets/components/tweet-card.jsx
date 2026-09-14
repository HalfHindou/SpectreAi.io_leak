/**
 * TweetCard — a single linked tweet in a Pre-IPO surface.
 *
 * Renders the author, body, optional media, engagement, and links out to the
 * source post on X. Used by the hero rail and the company detail panel. Pure
 * presentational — the normalized Tweet shape comes from private-markets-api.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const VerifiedBadge = () => (
  <svg className="pi-tweet-verified" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
  </svg>
)

const formatCount = (n) => {
  if (!n) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

// Linkify $CASHTAGS / @handles / #hashtags into muted highlights (no anchors —
// the whole card already links to the source).
function renderText(text) {
  if (!text) return null
  const parts = text.split(/(\$[A-Za-z]{1,8}\b|@\w{1,20}|#\w+)/g)
  return parts.map((p, i) => {
    if (/^[$@#]/.test(p)) return <span key={i} className="pi-tweet-entity">{p}</span>
    return <span key={i}>{p}</span>
  })
}

export default function TweetCard({ tweet, compact = false }) {
  const { t } = useTranslation()
  const [mediaFailed, setMediaFailed] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  if (!tweet) return null

  const likes = formatCount(tweet.likes)
  const retweets = formatCount(tweet.retweets)
  const replies = formatCount(tweet.replies)
  const views = formatCount(tweet.views)
  const initial = (tweet.name || tweet.username || '?').trim().charAt(0).toUpperCase()

  return (
    <a
      href={tweet.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className={`pi-tweet glass-card${compact ? ' pi-tweet-compact' : ''}`}
    >
      <div className="pi-tweet-head">
        <span className="pi-tweet-avatar">
          {tweet.avatar && !avatarFailed ? (
            <img src={tweet.avatar} alt="" onError={() => setAvatarFailed(true)} loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className="pi-tweet-avatar-fallback">{initial}</span>
          )}
        </span>
        <div className="pi-tweet-id">
          <span className="pi-tweet-name">
            {tweet.name || tweet.username}
            {tweet.verified && <VerifiedBadge />}
          </span>
          {tweet.username && <span className="pi-tweet-handle">@{tweet.username}</span>}
        </div>
        <svg className="pi-tweet-x" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </div>

      <p className="pi-tweet-text">{renderText(tweet.text)}</p>

      {tweet.media && !mediaFailed && !compact && (
        <div className="pi-tweet-media">
          <img src={tweet.media} alt="" onError={() => setMediaFailed(true)} loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}

      <div className="pi-tweet-meta">
        {tweet.date && <span className="pi-tweet-date">{tweet.date}</span>}
        <span className="pi-tweet-stats">
          {replies && <span className="pi-tweet-stat" title={t('privateMarkets.tweet.replies', 'Replies')}>{replies}</span>}
          {retweets && <span className="pi-tweet-stat" title={t('privateMarkets.tweet.reposts', 'Reposts')}>{retweets}</span>}
          {likes && <span className="pi-tweet-stat pi-tweet-stat-like" title={t('privateMarkets.tweet.likes', 'Likes')}>{likes}</span>}
          {views && <span className="pi-tweet-stat" title={t('privateMarkets.tweet.views', 'Views')}>{t('privateMarkets.tweet.viewsCount', '{{n}} views', { n: views })}</span>}
        </span>
      </div>
    </a>
  )
}
