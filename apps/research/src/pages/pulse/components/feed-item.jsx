import React, { useState, useCallback } from 'react'
import SparkChart from './spark-chart'
import useTiltEffect from './use-tilt-effect'
import useScrollReveal from './use-scroll-reveal'
import AnimatedNumber from './animated-number'

/**
 * Wrapper that gives each card its own 3D tilt + glow instance.
 * Replaces <article> so every card gets independent refs.
 */
function TiltCard({ className, style, children, staggerDelay = 0 }) {
  const { tiltProps, glowRef } = useTiltEffect({ maxTilt: 4, scale: 1.01 })
  const { ref: revealCallbackRef, visible } = useScrollReveal({ delay: staggerDelay })
  // Merge tilt style but strip CSS custom props (they're set via setProperty in the hook)
  const { '--spot-x': _a, '--spot-y': _b, '--spot-opacity': _c, ...restTiltStyle } = tiltProps.style

  // Combine refs: tilt uses useRef, scroll reveal uses callback ref
  const combinedRef = useCallback((el) => {
    tiltProps.ref.current = el
    revealCallbackRef(el)
  }, [tiltProps.ref, revealCallbackRef])

  return (
    <article
      className={`${className}${visible ? ' pfi--revealed' : ' pfi--hidden'}`}
      style={{ ...style, ...restTiltStyle }}
      ref={combinedRef}
      onMouseMove={tiltProps.onMouseMove}
      onMouseLeave={tiltProps.onMouseLeave}
    >
      <div ref={glowRef} className="pfi-tilt-glow" />
      {children}
    </article>
  )
}

/**
 * Instagram-style feed card for tweets and token data.
 * Borderless card with divider separation.
 *
 * item shape (tweet):
 *   id, type:'tweet', user, handle, avatar, avatarColor, verified, time, body,
 *   engagement: { comments, retweets, likes, views },
 *   media: { type, title, subtitle, heroNumber, gradient, accent, chartData },
 *   tier, xUrl
 */

/* Inline SVG icons - no icon library dependency */
const HeartIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
)

const CommentIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

const BookmarkIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

const VerifiedIcon = () => (
  <svg viewBox="0 0 22 22" width="12" height="12" className="pfi-verified-icon">
    <circle cx="11" cy="11" r="10" fill="#1D9BF0" />
    <path d="M9.5 14.25l-3.5-3.5 1.41-1.41L9.5 11.42l5.09-5.09L16 7.75l-6.5 6.5z" fill="#fff" />
  </svg>
)

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
)

const TIER_LABELS = { S: 'S', A: 'A', B: 'B', C: 'C' }

function fmtViews(n) {
  if (typeof n === 'string') return n
  if (n == null) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function fmtPrice(n) {
  if (n == null) return '-'
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return '$' + n.toFixed(2)
  if (n >= 0.01) return '$' + n.toFixed(4)
  return '$' + n.toPrecision(4)
}

function fmtMcap(n) {
  if (n == null) return null
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(1) + 'T'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(0) + 'M'
  return '$' + (n / 1e3).toFixed(0) + 'K'
}

function timeAgoShort(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Linkify $TICKER mentions and t.co URLs in tweet body text.
 */
function renderBody(text) {
  if (!text) return null
  // Split on $TICKER patterns and URLs
  const parts = text.split(/(\$[A-Za-z]{2,10}|https?:\/\/t\.co\/\S+)/g)
  return parts.map((part, i) => {
    if (part.match(/^\$[A-Za-z]{2,10}$/)) {
      return <span key={i} className="pfi-ticker">{part}</span>
    }
    if (part.match(/^https?:\/\/t\.co\//)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="pfi-link">
          {part}
        </a>
      )
    }
    return part
  })
}

/**
 * Scroll-reveal wrapper for non-tilt cards (market-widget, fng-widget).
 */
function RevealArticle({ className, style, children, staggerDelay = 0 }) {
  const { ref: revealRef, visible } = useScrollReveal({ delay: staggerDelay })
  return (
    <article
      ref={revealRef}
      className={`${className}${visible ? ' pfi--revealed' : ' pfi--hidden'}`}
      style={style}
    >
      {children}
    </article>
  )
}

export default function FeedItem({ item, index = 0 }) {
  const [liked, setLiked] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)

  const toggleLike = useCallback(() => setLiked(v => !v), [])
  const toggleBookmark = useCallback(() => setBookmarked(v => !v), [])

  if (!item || !item.type) return null

  // Video card - media center content
  if (item.type === 'video') {
    const dur = item.duration
    const durStr = dur > 0
      ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`
      : item.isShort ? 'Short' : 'Live'
    return (
      <TiltCard className="pfi pfi--video" staggerDelay={Math.min(index * 60, 600)} style={{}}>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="pfi-video-link"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pfi-video-thumb-wrap">
            {item.thumbnail ? (
              <img
                src={item.thumbnail}
                alt={item.title}
                className="pfi-video-thumb"
                loading="lazy"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            ) : (
              <div className="pfi-video-thumb pfi-video-thumb--placeholder" style={{ background: item.gradient }} />
            )}
            <div className="pfi-video-play">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span className="pfi-video-dur">{durStr}</span>
            {item.isShort && <span className="pfi-video-short-badge">Short</span>}
          </div>
        </a>
        <div className="pfi-video-info">
          <div className="pfi-video-channel-row">
            {item.channelAvatar ? (
              <img src={item.channelAvatar} alt="" className="pfi-video-channel-img" onError={(e) => { e.target.style.display = 'none' }} />
            ) : (
              <span className="pfi-video-channel-img pfi-video-channel-img--fallback">
                {(item.channel || '?')[0]}
              </span>
            )}
            <span className="pfi-video-channel">{item.channel}</span>
            {item.tags && item.tags.length > 0 && (
              <span className="pfi-video-tag">${item.tags[0]}</span>
            )}
          </div>
          <span className="pfi-video-title">{item.title}</span>
          <span className="pfi-video-meta">
            {item.views > 0 && <>{fmtViews(item.views)} views</>}
            {item.publishedAt && <> &middot; {timeAgoShort(item.publishedAt)}</>}
          </span>
        </div>
      </TiltCard>
    )
  }

  // Market widget - mini price chart
  if (item.type === 'market-widget') {
    const isUp = (item.change || 0) >= 0
    return (
      <RevealArticle className="pfi pfi--market-widget" staggerDelay={Math.min(index * 60, 600)} style={{}}>
        <div className="pfi-mw-header">
          {item.image ? (
            <img src={item.image} alt={item.name} className="pfi-mw-logo" onError={(e) => { e.target.style.display = 'none' }} />
          ) : (
            <div className="pfi-mw-logo pfi-mw-logo--fallback" style={{ background: (item.color || '#333') + '30', color: item.color }}>
              {(item.symbol || '?')[0]}
            </div>
          )}
          <div>
            <span className="pfi-mw-name">{item.name}<span className="pfi-mw-symbol"> {item.symbol}</span></span>
          </div>
          <div className="pfi-mw-price-row">
            <span className="pfi-mw-price">{item.price}</span>
            <span className={`pfi-mw-change pfi-mw-change--${isUp ? 'up' : 'down'}`}>
              {isUp ? '+' : ''}{typeof item.change === 'number' ? item.change.toFixed(1) : item.change}%
            </span>
          </div>
        </div>
        {item.sparkline && item.sparkline.length > 0 && (
          <div className="pfi-mw-chart">
            <SparkChart
              data={item.sparkline}
              color={isUp ? 'var(--bull)' : 'var(--bear)'}
              width={240}
              height={40}
              type="area"
            />
          </div>
        )}
        <div className="pfi-mw-label">7-day price action</div>
      </RevealArticle>
    )
  }

  // Fear & Greed widget
  if (item.type === 'fng-widget') {
    const val = item.value || 50
    const circumference = 2 * Math.PI * 30
    const offset = circumference - (val / 100) * circumference
    const gaugeColor = val <= 25 ? '#ef4444' : val <= 45 ? '#f59e0b' : val <= 55 ? '#eab308' : val <= 75 ? '#10b981' : '#059669'
    return (
      <RevealArticle className="pfi pfi--fng-widget" staggerDelay={Math.min(index * 60, 600)} style={{}}>
        <div className="pfi-fg-label">Market Sentiment</div>
        <div className="pfi-fg-row">
          <div className="pfi-fg-gauge">
            <svg viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="30" className="pfi-fg-gauge-bg" />
              <circle
                cx="36" cy="36" r="30"
                className="pfi-fg-gauge-fill"
                stroke={gaugeColor}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
            </svg>
            <div className="pfi-fg-value">{val}</div>
          </div>
          <div className="pfi-fg-info">
            <span className="pfi-fg-class" style={{ color: gaugeColor }}>{item.classification || 'Neutral'}</span>
            <span className="pfi-fg-desc">Crypto Fear & Greed Index measures market emotion from extreme fear (0) to extreme greed (100).</span>
          </div>
        </div>
        <div className="pfi-fg-bar">
          <div className="pfi-fg-needle" style={{ left: `${val}%` }} />
        </div>
      </RevealArticle>
    )
  }

  // News headline card - bold typography, fills the square
  if (item.type === 'news') {
    return (
      <TiltCard className="pfi pfi--news" staggerDelay={Math.min(index * 60, 600)} style={{}}>
        <div className="pfi-news-badge">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
            <path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" />
          </svg>
          NEWS
        </div>
        <div className="pfi-news-headline">{item.title}</div>
        {item.currencies && item.currencies.length > 0 && (
          <div className="pfi-news-tokens">
            {item.currencies.map((c, i) => (
              <span key={i} className="pfi-news-token" style={{ color: item.accent }}>
                ${(c.code || c.symbol || '').toUpperCase()}
              </span>
            ))}
          </div>
        )}
        <div className="pfi-news-footer">
          <span className="pfi-news-source">{item.source}</span>
          {item.time && <span className="pfi-news-time">{item.time}</span>}
        </div>
      </TiltCard>
    )
  }

  // Tweet card - Instagram style with rich data fill
  if (item.type === 'tweet') {
    const hasChart = item.media?.chartData && item.media.chartData.length > 0
    const isUp = item.priceData?.change24h >= 0
    const chartColor = hasChart
      ? (isUp ? 'var(--bull)' : 'var(--bear)')
      : (item.media?.accent || 'rgba(255,255,255,0.82)')

    return (
      <TiltCard className="pfi" staggerDelay={Math.min(index * 60, 600)} style={{}}>
        {/* Tier accent glow */}
        {item.tier && (item.tier === 'S' || item.tier === 'A' || item.tier === 'B') && (
          <div className={`pfi-tier-accent pfi-tier-accent--${item.tier.toLowerCase()}`} />
        )}
        {/* Header row: avatar + name + verified + tier + more button */}
        <div className="pfi-header">
          <div className="pfi-avatar-wrap">
            {item.avatar ? (
              <>
                <img
                  src={item.avatar}
                  alt={item.user}
                  className="pfi-avatar-img"
                  loading="lazy"
                  onError={(e) => {
                    e.target.style.display = 'none'
                    if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'
                  }}
                />
                <span className="pfi-avatar-fallback" style={{ display: 'none' }}>
                  {(item.user || '?')[0]}
                </span>
              </>
            ) : (
              <span className="pfi-avatar-fallback" style={{ background: item.avatarColor || 'var(--bg-elevated)' }}>
                {(item.user || '?')[0]}
              </span>
            )}
          </div>
          <div className="pfi-user-info">
            <div className="pfi-name-row">
              <span className="pfi-username">{item.user}</span>
              {item.verified && <VerifiedIcon />}
              {item.tier && TIER_LABELS[item.tier] && (
                <span className={`pfi-tier pfi-tier--${item.tier.toLowerCase()}`}>
                  {item.tier}
                </span>
              )}
              {item.handle && (
                <span className="pfi-handle">@{item.handle}</span>
              )}
            </div>
            <span className="pfi-timestamp">{item.time}</span>
          </div>
          <button className="pfi-more-btn" aria-label="More options">
            <MoreIcon />
          </button>
        </div>

        {/* Body text - full content, no clipping */}
        <div className={`pfi-body${!hasChart ? ' pfi-body--hero' : ''}`}>
          {renderBody(item.body)}
        </div>

        {/* Token pill */}
        {item.media?.title && (
          <div className="pfi-token-pill">
            {item.media.tokenImage && (
              <img src={item.media.tokenImage} alt="" className="pfi-token-pill-img" onError={(e) => { e.target.style.display = 'none' }} />
            )}
            <span className="pfi-token-pill-label" style={{ color: item.media.accent }}>{item.media.title}</span>
          </div>
        )}

        {/* Sparkline chart - 7-day price action from CoinGecko */}
        {hasChart && (
          <div className="pfi-media">
            <div className="pfi-chart-wrap">
              <div className="pfi-chart-header">
                <div className="pfi-chart-meta">
                  <span className="pfi-chart-title">{item.media.title}</span>
                  {item.media.subtitle && (
                    <span className="pfi-chart-sub">{item.media.subtitle}</span>
                  )}
                </div>
              </div>
              <SparkChart
                data={item.media.chartData}
                color={chartColor}
                width={280}
                height={64}
                type="area"
                showDot
              />
            </div>
          </div>
        )}

        {/* Price context row - shows live price + 24h change + mcap */}
        {item.priceData && (
          <div className="pfi-price-row">
            <span className="pfi-price-val">{fmtPrice(item.priceData.price)}</span>
            {item.priceData.change24h != null && (
              <span className={`pfi-price-change pfi-price-change--${isUp ? 'up' : 'down'}`}>
                {isUp ? '+' : ''}{item.priceData.change24h.toFixed(1)}%
              </span>
            )}
            {item.priceData.mcap && (
              <span className="pfi-price-mcap">MCap {fmtMcap(item.priceData.mcap)}</span>
            )}
          </div>
        )}

        {/* Sentiment indicator */}
        {item.sentiment && (
          <div className="pfi-sentiment-bar">
            <span className={`pfi-sentiment-label pfi-sentiment-label--${item.sentiment}`}>
              {item.sentiment === 'bullish' ? '▲ Bullish' : '▼ Bearish'}
            </span>
          </div>
        )}

        {/* Engagement stats row */}
        {item.engagement && (item.engagement.views > 0 || item.engagement.likes > 0) && (
          <div className="pfi-engagement-row">
            {item.engagement.views > 0 && (
              <span className="pfi-eng-views">{fmtViews(item.engagement.views)} views</span>
            )}
            {item.engagement.retweets > 0 && (
              <span className="pfi-eng-stat">{fmtViews(item.engagement.retweets)} retweets</span>
            )}
            {item.engagement.likes > 0 && (
              <span className="pfi-eng-stat">{fmtViews(item.engagement.likes)} likes</span>
            )}
          </div>
        )}

        {/* Action bar */}
        <div className="pfi-actions">
          <div className="pfi-actions-left">
            <button
              className={`pfi-action-btn ${liked ? 'pfi-action-btn--liked' : ''}`}
              onClick={toggleLike}
              aria-label="Like"
            >
              <HeartIcon />
              {item.engagement?.likes > 0 && <span className="pfi-action-count">{fmtViews(item.engagement.likes)}</span>}
            </button>
            <button className="pfi-action-btn" aria-label="Reply">
              <CommentIcon />
              {item.engagement?.comments > 0 && <span className="pfi-action-count">{fmtViews(item.engagement.comments)}</span>}
            </button>
            <button className="pfi-action-btn" aria-label="Share">
              <ShareIcon />
              {item.engagement?.retweets > 0 && <span className="pfi-action-count">{fmtViews(item.engagement.retweets)}</span>}
            </button>
          </div>
          <button
            className={`pfi-action-btn ${bookmarked ? 'pfi-action-btn--bookmarked' : ''}`}
            onClick={toggleBookmark}
            aria-label="Bookmark"
          >
            <BookmarkIcon />
          </button>
        </div>
      </TiltCard>
    )
  }

  // Bold magazine-style insight card - fills entire square
  if (item.type === 'insight') {
    return (
      <TiltCard className="pfi pfi--insight" staggerDelay={Math.min(index * 60, 600)} style={{ '--insight-accent': item.accent || '#f5f5f7', borderTopColor: item.accent || 'rgba(255,255,255,0.06)' }}>
        {/* Decorative background glow */}
        <div className="pfi-insight-glow" style={{ background: `radial-gradient(ellipse at 30% 20%, ${item.statColor || item.accent}12 0%, transparent 70%)` }} />
        <div className="pfi-insight-tag" style={{ color: item.accent }}>
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke={item.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {item.tag}
        </div>
        {/* Hero stat - animated count-up number */}
        <div className="pfi-insight-stat" style={{
          color: item.statColor,
          textShadow: `0 0 30px ${item.statColor}40, 0 0 60px ${item.statColor}20`
        }}>
          <AnimatedNumber value={item.stat} duration={1400} />
        </div>
        {item.statLabel && (
          <div className="pfi-insight-stat-label">{item.statLabel}</div>
        )}
        {/* Headline fills remaining space */}
        <div className="pfi-insight-headline">
          {item.headline.split('\n').map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
        {/* Subtitle expands to fill */}
        <div className="pfi-insight-subtitle">{item.subtitle}</div>
        {/* Source anchored at bottom */}
        <div className="pfi-insight-source">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Spectre Intelligence
        </div>
      </TiltCard>
    )
  }

  // Token data card - social metrics focus (live API data)
  if (item.type === 'token-card') {
    return (
      <TiltCard className="pfi pfi--token" staggerDelay={Math.min(index * 60, 600)} style={{}}>
        {/* Top row: logo + name left, category right */}
        <div className="pfi-tw-top">
          <div className="pfi-tw-left">
            {item.image ? (
              <img
                src={item.image}
                alt={item.name}
                className="pfi-tw-logo"
                style={{ boxShadow: `0 0 12px ${item.color || 'rgba(255,255,255,0.06)'}40` }}
                onError={(e) => { e.target.style.display = 'none' }}
              />
            ) : (
              <div className="pfi-tw-logo pfi-tw-logo--fallback" style={{ background: item.color + '30', color: item.color, boxShadow: `0 0 12px ${item.color || 'rgba(255,255,255,0.06)'}40` }}>
                {(item.symbol || '?')[0]}
              </div>
            )}
            <div>
              <span className="pfi-tw-name">{item.name}</span>
              <span className="pfi-tw-symbol">{item.symbol}</span>
            </div>
          </div>
          <div className="pfi-tw-right">
            {item.category && (
              <span className="pfi-tw-category">{item.category}</span>
            )}
          </div>
        </div>
        {/* Social metrics grid */}
        <div className="pfi-tw-stats pfi-tw-stats--social">
          <div className="pfi-tw-stat">
            <span className="pfi-tw-stat-val">{item.mentions}</span>
            <span className="pfi-tw-stat-label">Mentions</span>
          </div>
          <div className="pfi-tw-stat">
            <span className="pfi-tw-stat-val">{item.authors}</span>
            <span className="pfi-tw-stat-label">Authors</span>
          </div>
          <div className="pfi-tw-stat">
            <span className="pfi-tw-stat-val">{item.engagement}</span>
            <span className="pfi-tw-stat-label">Engagement</span>
          </div>
          <div className="pfi-tw-stat">
            <span className="pfi-tw-stat-val">{item.mcap}</span>
            <span className="pfi-tw-stat-label">MCap</span>
          </div>
        </div>
        {/* Velocity badge - pulses when accelerating (>1.0x) */}
        {item.velocity && (
          <div className={`pfi-tw-velocity${parseFloat(item.velocity) > 1.0 ? ' pfi-tw-velocity--accelerating' : ''}`}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
            <span style={{ color: item.color }}>{item.velocity} velocity</span>
          </div>
        )}
      </TiltCard>
    )
  }

  return null
}
