import { useState, useMemo, memo, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

import KolCosmos from './KolCosmos'
import '../XChartsTab.css' // .xct-bubble-tip / empty-state styles reused by the Cosmos view

/**
 * LiveFeedPanel — the cinematic terminal-style live feed.
 *
 * Reuses tweets already fetched by the parent LeftPanel (via tweetsData prop)
 * so we never double-fetch.
 *
 * tweetsData shape:
 *   {
 *     categorized: { posts, replies, influencers, community } | null,
 *     allTweets:   array,
 *     loading:     boolean,
 *     error:       string | null,
 *     twitterUsername: string | null,
 *     author: { name, screen_name, ... } | null,
 *   }
 */
const SEGMENTS = [
  { key: 'posts', label: 'Project Posts' },
  { key: 'replies', label: 'Replies' },
  { key: 'community', label: 'Community' },
  { key: 'influencers', label: 'KOLs' },
  { key: 'all', label: 'All' },
]

const BUBBLE_METRICS = [
  { id: 'followers', label: 'Followers' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'mentions', label: 'Mentions' },
]

const MAX_FEED_ITEMS = 200

function LiveFeedPanel({ token, tweetsData, intel }) {
  const [segment, setSegment] = useState('posts')
  const [view, setView] = useState('feed') // 'feed' | 'cosmos'
  const [bubbleMetric, setBubbleMetric] = useState('followers')
  const [now, setNow] = useState(() => new Date())
  const [fullView, setFullView] = useState(false)
  const [scrollToTweetId, setScrollToTweetId] = useState(null)
  // Segment auto-fallback only runs until the user picks one themselves.
  const userPickedSegmentRef = useRef(false)

  const handleTweetClick = useCallback((tweet) => {
    setScrollToTweetId(tweet.id ?? null)
    setFullView(true)
  }, [])

  const handleOpenFullView = useCallback(() => {
    setScrollToTweetId(null)
    setFullView(true)
  }, [])

  const handleCloseFullView = useCallback(() => {
    setFullView(false)
    setScrollToTweetId(null)
  }, [])

  // Live UTC clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const tweets = useMemo(() => {
    if (!tweetsData) return []
    const { categorized, allTweets } = tweetsData
    if (segment === 'all') return (allTweets || []).slice(0, MAX_FEED_ITEMS)
    if (!categorized) return []
    const list = categorized[segment] || []
    return list.slice(0, MAX_FEED_ITEMS)
  }, [tweetsData, segment])

  const loading = tweetsData?.loading
  const error = tweetsData?.error
  const username = tweetsData?.twitterUsername
  const utcTime = formatUTC(now)

  const counts = useMemo(() => {
    const c = tweetsData?.categorized
    if (!c) return { posts: 0, replies: 0, community: 0, influencers: 0, all: 0 }
    return {
      posts: c.posts?.length || 0,
      replies: c.replies?.length || 0,
      community: c.community?.length || 0,
      influencers: c.influencers?.length || 0,
      all: tweetsData?.allTweets?.length || 0,
    }
  }, [tweetsData])

  // The default segment (Project Posts) is empty for tokens whose X account
  // resolves late or never — don't strand the user on an empty tab while
  // community/KOL chatter exists. Falls to the first populated segment once,
  // unless the user already picked one.
  useEffect(() => {
    if (userPickedSegmentRef.current || loading) return
    if ((counts[segment] || 0) > 0) return
    const firstPopulated = SEGMENTS.find((s) => (counts[s.key] || 0) > 0)
    if (firstPopulated && firstPopulated.key !== segment) setSegment(firstPopulated.key)
  }, [counts, loading, segment])

  // Grace window before declaring "no X account linked": the project handle
  // arrives with token details, which can take tens of seconds cold.
  const [linkWaitOver, setLinkWaitOver] = useState(false)
  useEffect(() => {
    if (username) return undefined
    const id = setTimeout(() => setLinkWaitOver(true), 60_000)
    return () => clearTimeout(id)
  }, [username])

  const handlePickSegment = useCallback((key) => {
    userPickedSegmentRef.current = true
    setSegment(key)
  }, [])

  const cosmosAuthors = intel?.top_authors || intel?.authors || []
  const symbol = token?.symbol || ''
  const stillLinking = !username && !error && !linkWaitOver

  return (
    <div className="xfv-feed-card">
      {/* Header bar with title + segment pills */}
      <div className="xfv-feed-header">
        <div className="xfv-feed-title-row">
          <div className="xfv-feed-title">
            <span className="xfv-feed-live-dot" aria-hidden="true" />
            <span className="xfv-feed-title-text">LIVE FEED</span>
            {symbol && <span className="xfv-feed-title-cashtag">${symbol}</span>}
          </div>
          <div className="xfv-feed-meta">
            <span className="xfv-feed-meta-clock">{utcTime}<span className="xfv-feed-meta-tz">UTC</span></span>
            <span className="xfv-feed-meta-status">
              <span className="xfv-feed-meta-status-dot" aria-hidden="true" />
              STREAMING
            </span>
            <button
              type="button"
              className="xfv-feed-fullview-btn"
              onClick={handleOpenFullView}
              title="Full View"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </div>
        </div>

        <div className="xfv-feed-segments-row">
          {view === 'feed'
            ? SEGMENTS.map((s) => {
                const isActive = segment === s.key
                const count = counts[s.key] || 0
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`xfv-feed-pill ${isActive ? 'xfv-feed-pill--active' : ''}`}
                    onClick={() => handlePickSegment(s.key)}
                  >
                    <span className="xfv-feed-pill-label">{s.label}</span>
                    {count > 0 && <span className="xfv-feed-pill-count">{count}</span>}
                  </button>
                )
              })
            : BUBBLE_METRICS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`xfv-feed-pill ${bubbleMetric === m.id ? 'xfv-feed-pill--active' : ''}`}
                  onClick={() => setBubbleMetric(m.id)}
                >
                  <span className="xfv-feed-pill-label">{m.label}</span>
                </button>
              ))}
          <div className="xfv-feed-viewtoggle" role="tablist" aria-label="Live feed view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'feed'}
              className={`xfv-feed-viewtoggle-btn${view === 'feed' ? ' is-active' : ''}`}
              onClick={() => setView('feed')}
            >
              Feed
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'cosmos'}
              className={`xfv-feed-viewtoggle-btn${view === 'cosmos' ? ' is-active' : ''}`}
              onClick={() => setView('cosmos')}
            >
              Cosmos
            </button>
          </div>
        </div>
      </div>

      {view === 'cosmos' ? (
        /* Cosmos — the token's KOL universe in the Spectre Cosmos language:
           project sun at the core, voices orbiting by the picked metric.
           Canvas2D previewer, GPU-cheap (no three.js in this bundle). */
        <div className="xfv-feed-cosmos">
          <KolCosmos
            authors={cosmosAuthors}
            metric={bubbleMetric}
            sunImage={intel?.asset?.image_small || intel?.token?.token?.image_small || intel?.token?.image_small || intel?.token?.image_url || token?.logo}
            sunLabel={token?.symbol ? `$${token.symbol}` : ''}
          />
        </div>
      ) : (
      /* Scrollable tweet stream */
      <div className="xfv-feed-stream">
        {(loading || stillLinking) && tweets.length === 0 && <SkeletonStream count={6} />}
        {stillLinking && !loading && tweets.length === 0 && (
          <div className="xfv-feed-empty xfv-feed-empty--soft">
            <span>Linking project X account…</span>
          </div>
        )}

        {!loading && !stillLinking && tweets.length === 0 && error && (
          <div className="xfv-feed-empty">
            <span>{error}</span>
          </div>
        )}

        {!loading && !stillLinking && tweets.length === 0 && !error && (
          <div className="xfv-feed-empty">
            {(() => {
              const label = SEGMENTS.find((s) => s.key === segment)?.label.toLowerCase()
              // Be honest for the live segments: empty here means no live coverage
              // (new / handle-less / not-yet-indexed token), not "nothing exists".
              if (segment === 'community' || segment === 'influencers') {
                return `No live ${label} mentions yet — X Dash polls every 60s. New or handle-less tokens may have no coverage until indexed.`
              }
              if (segment === 'posts' || segment === 'replies') {
                return username ? `No ${label} found` : 'No X account linked for this token'
              }
              return username ? `No ${label} found` : 'No live mentions yet'
            })()}
          </div>
        )}

        {tweets.map((tweet, i) => (
          <Tweet key={tweet.id ?? i} tweet={tweet} index={i} onClick={handleTweetClick} />
        ))}
      </div>
      )}

      {fullView && (
        <LiveFeedFullView
          token={token}
          tweetsData={tweetsData}
          segment={segment}
          onSegmentChange={handlePickSegment}
          counts={counts}
          tweets={tweets}
          loading={loading}
          error={error}
          username={username}
          scrollToTweetId={scrollToTweetId}
          onClose={handleCloseFullView}
        />
      )}
    </div>
  )
}

/* ----------------------------------------------------------------
   Full-screen Live Feed overlay
---------------------------------------------------------------- */
function LiveFeedFullView({
  token, tweetsData, segment, onSegmentChange, counts,
  tweets, loading, error, username, scrollToTweetId, onClose,
}) {
  const scrollRef = useRef(null)
  const [now, setNow] = useState(() => new Date())

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // ESC to close - capture phase, block parent handlers
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handleKey, true)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Scroll to the clicked tweet
  useEffect(() => {
    if (!scrollToTweetId || !scrollRef.current) return
    const el = scrollRef.current.querySelector(`[data-tweet-id="${scrollToTweetId}"]`)
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }, [scrollToTweetId, tweets])

  const symbol = token?.symbol || ''
  const utcTime = formatUTC(now)

  return createPortal(
    <div className="xfv-fv-backdrop" role="dialog" aria-modal="true" aria-label="Live Feed Full View">
      <div className="xfv-fv-container">
        {/* Header */}
        <header className="xfv-fv-header">
          <div className="xfv-fv-header-left">
            <span className="xfv-feed-live-dot" aria-hidden="true" />
            <span className="xfv-fv-title">LIVE FEED</span>
            {symbol && <span className="xfv-fv-cashtag">${symbol}</span>}
            <span className="xfv-fv-count">{tweets.length} posts</span>
          </div>
          <div className="xfv-fv-header-right">
            <span className="xfv-fv-clock">{utcTime}<span className="xfv-feed-meta-tz">UTC</span></span>
            <button type="button" className="xfv-fv-close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* Segment pills */}
        <div className="xfv-fv-segments">
          {SEGMENTS.map((s) => {
            const isActive = segment === s.key
            const count = counts[s.key] || 0
            return (
              <button
                key={s.key}
                type="button"
                className={`xfv-feed-pill ${isActive ? 'xfv-feed-pill--active' : ''}`}
                onClick={() => onSegmentChange(s.key)}
              >
                <span className="xfv-feed-pill-label">{s.label}</span>
                {count > 0 && <span className="xfv-feed-pill-count">{count}</span>}
              </button>
            )
          })}
        </div>

        {/* Scrollable feed */}
        <div className="xfv-fv-stream" ref={scrollRef}>
          {loading && tweets.length === 0 && <SkeletonStream count={10} />}

          {!loading && tweets.length === 0 && error && (
            <div className="xfv-feed-empty"><span>{error}</span></div>
          )}

          {!loading && tweets.length === 0 && !error && (
            <div className="xfv-feed-empty">
              {username
                ? `No ${SEGMENTS.find((s) => s.key === segment)?.label.toLowerCase()} found`
                : 'No X account linked for this token'}
            </div>
          )}

          {tweets.map((tweet, i) => (
            <FullViewTweet key={tweet.id ?? i} tweet={tweet} index={i} isSelected={tweet.id === scrollToTweetId} />
          ))}
        </div>

        {/* Footer */}
        <footer className="xfv-fv-footer">
          <span>Press ESC to close</span>
        </footer>
      </div>
    </div>,
    document.body
  )
}

/* ----------------------------------------------------------------
   Full-view tweet card (wider, more spacious than inline version)
---------------------------------------------------------------- */
function FullViewTweet({ tweet, index, isSelected }) {
  const sourceHandle = tweet._sourceHandle || tweet.handle || ''
  const sourceId = tweet._sourceTweetId || tweet.id
  const tweetUrl = sourceHandle && sourceId
    ? `https://x.com/${sourceHandle.replace('@', '')}/status/${sourceId}`
    : null

  const isProject = tweet._isFromProject
  const isRetweet = tweet._isRetweet
  const parent = tweet._parentTweet
  const projectReplies = tweet._projectReplies

  const className = [
    'xfv-fv-tweet',
    isProject && 'xfv-fv-tweet--project',
    isSelected && 'xfv-fv-tweet--selected',
  ].filter(Boolean).join(' ')

  return (
    <article className={className} data-tweet-id={tweet.id}>
      {parent && (
        <div className="xfv-tweet-parent">
          <div className="xfv-tweet-parent-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
            Replying to
          </div>
          <div className="xfv-tweet-parent-body">
            <span className="xfv-tweet-parent-handle">{parent.handle}</span>
            <span className="xfv-tweet-parent-text">{parent.content}</span>
          </div>
        </div>
      )}

      <header className="xfv-fv-tweet-header">
        {tweet.avatar && (
          <img className="xfv-fv-tweet-avatar" src={tweet.avatar} alt="" loading="lazy" />
        )}
        <div className="xfv-tweet-byline">
          <div className="xfv-tweet-author-row">
            <span className="xfv-fv-tweet-author">{tweet.user}</span>
            <span className="xfv-tweet-handle">{tweet.handle}</span>
            {isProject && <span className="xfv-tweet-badge xfv-tweet-badge--project">PROJECT</span>}
            {isRetweet && <span className="xfv-tweet-badge xfv-tweet-badge--rt">RT</span>}
          </div>
          {tweet.time && <span className="xfv-tweet-time">{tweet.time}</span>}
        </div>
        {tweetUrl && (
          <a href={tweetUrl} target="_blank" rel="noopener noreferrer" className="xfv-tweet-link" aria-label="Open on X">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </header>

      <div className="xfv-fv-tweet-body">{tweet.content}</div>

      {tweet.media?.url && <TweetMedia media={tweet.media} />}

      <footer className="xfv-tweet-footer">
        <div className="xfv-fv-tweet-stats">
          <Stat icon="reply" value={tweet.replies} />
          <Stat icon="retweet" value={tweet.retweets} />
          <Stat icon="like" value={tweet.likes} />
          {tweet.views !== undefined && <Stat icon="views" value={tweet.views} />}
        </div>
      </footer>

      {projectReplies && projectReplies.length > 0 && (
        <div className="xfv-tweet-replies-context">
          <div className="xfv-tweet-replies-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            Project replied
          </div>
          {projectReplies.map((r, i) => (
            <div key={r.id ?? i} className="xfv-tweet-reply-snippet">
              {r.content}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

/* ----------------------------------------------------------------
   Shared sub-components
---------------------------------------------------------------- */
function TweetMedia({ media }) {
  const isVideo = media.type === 'video'
  return (
    <div className={`xfv-tweet-media ${isVideo ? 'xfv-tweet-media--video' : ''}`}>
      <img
        src={media.url}
        alt=""
        loading="lazy"
        className="xfv-tweet-media-img"
        onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }}
      />
      {isVideo && (
        <div className="xfv-tweet-media-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      )}
    </div>
  )
}

function Tweet({ tweet, index, onClick }) {
  const sourceHandle = tweet._sourceHandle || tweet.handle || ''
  const sourceId = tweet._sourceTweetId || tweet.id
  const tweetUrl = sourceHandle && sourceId
    ? `https://x.com/${sourceHandle.replace('@', '')}/status/${sourceId}`
    : null

  const animDelay = Math.min(index, 8) * 28
  const isProject = tweet._isFromProject
  const isRetweet = tweet._isRetweet
  const parent = tweet._parentTweet
  const projectReplies = tweet._projectReplies

  const className = [
    'xfv-tweet-card',
    isProject && 'xfv-tweet-card--project',
  ].filter(Boolean).join(' ')

  const handleClick = (e) => {
    if (e.target.closest('a') || e.target.closest('button')) return
    onClick?.(tweet)
  }

  return (
    <article
      className={className}
      style={{ animationDelay: `${animDelay}ms` }}
      onClick={handleClick}
    >
      {parent && (
        <div className="xfv-tweet-parent">
          <div className="xfv-tweet-parent-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
            Replying to
          </div>
          <div className="xfv-tweet-parent-body">
            <span className="xfv-tweet-parent-handle">{parent.handle}</span>
            <span className="xfv-tweet-parent-text">
              {truncate(parent.content, 140)}
            </span>
          </div>
        </div>
      )}

      <header className="xfv-tweet-header">
        {tweet.avatar && (
          <img className="xfv-tweet-avatar" src={tweet.avatar} alt="" loading="lazy" />
        )}
        <div className="xfv-tweet-byline">
          <div className="xfv-tweet-author-row">
            <span className="xfv-tweet-author">{tweet.user}</span>
            <span className="xfv-tweet-handle">{tweet.handle}</span>
            {isProject && <span className="xfv-tweet-badge xfv-tweet-badge--project">PROJECT</span>}
            {isRetweet && <span className="xfv-tweet-badge xfv-tweet-badge--rt">RT</span>}
          </div>
          {tweet.time && <span className="xfv-tweet-time">{tweet.time}</span>}
        </div>
        {tweetUrl && (
          <a href={tweetUrl} target="_blank" rel="noopener noreferrer" className="xfv-tweet-link" aria-label="Open on X">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </header>

      <p className="xfv-tweet-body">{tweet.content}</p>

      {tweet.media?.url && <TweetMedia media={tweet.media} />}

      <footer className="xfv-tweet-footer">
        <div className="xfv-tweet-stats-row">
          <Stat icon="reply" value={tweet.replies} />
          <Stat icon="retweet" value={tweet.retweets} />
          <Stat icon="like" value={tweet.likes} />
          {tweet.views !== undefined && <Stat icon="views" value={tweet.views} />}
        </div>
      </footer>

      {projectReplies && projectReplies.length > 0 && (
        <div className="xfv-tweet-replies-context">
          <div className="xfv-tweet-replies-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            Project replied
          </div>
          {projectReplies.slice(0, 2).map((r, i) => (
            <div key={r.id ?? i} className="xfv-tweet-reply-snippet">
              {truncate(r.content, 160)}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function Stat({ icon, value }) {
  return (
    <span className="xfv-tweet-stat">
      <StatIcon name={icon} />
      <span className="xfv-tweet-stat-value">{formatStat(value)}</span>
    </span>
  )
}

function StatIcon({ name }) {
  const props = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    width: 12,
    height: 12,
  }
  switch (name) {
    case 'reply':
      return (
        <svg {...props}>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      )
    case 'retweet':
      return (
        <svg {...props}>
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      )
    case 'like':
      return (
        <svg {...props}>
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      )
    case 'views':
      return (
        <svg {...props}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    default:
      return null
  }
}

function SkeletonStream({ count = 4 }) {
  return (
    <div className="xfv-feed-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="xfv-feed-skeleton-row">
          <div className="xfv-skeleton xfv-feed-skeleton-avatar" />
          <div className="xfv-feed-skeleton-body">
            <div className="xfv-skeleton" style={{ height: 11, width: '32%' }} />
            <div className="xfv-skeleton" style={{ height: 10, width: '92%' }} />
            <div className="xfv-skeleton" style={{ height: 10, width: '78%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function truncate(s, n) {
  if (!s) return ''
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

function formatStat(n) {
  const v = typeof n === 'number' ? n : parseInt(n, 10)
  if (!Number.isFinite(v) || v === 0) return 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v
}

function formatUTC(d) {
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default memo(LiveFeedPanel)
