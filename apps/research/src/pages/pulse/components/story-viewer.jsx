import React, { useEffect, useState, useRef, useCallback } from 'react'

/**
 * Instagram-style fullscreen story viewer with multi-slide support.
 * Fixed overlay, centered card, segmented progress bar, swipe between KOLs,
 * tap zones for prev/next slide, pause on hold.
 *
 * Props:
 *   stories       - array of KOL story objects (the full rail minus 'add')
 *   activeIndex   - which story (KOL) is currently active
 *   storyTweets   - Map<screen_name, tweet[]> from usePulseFeed
 *   onClose       - close viewer
 *   onChangeIndex - navigate to a different KOL story
 */

const SLIDE_DURATION = 8000 // 8 seconds per slide

const fmtNum = (n) => {
  if (n == null) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const VerifiedIcon = () => (
  <svg viewBox="0 0 22 22" width="14" height="14" style={{ flexShrink: 0 }}>
    <circle cx="11" cy="11" r="10" fill="#1D9BF0" />
    <path d="M9.5 14.25l-3.5-3.5 1.41-1.41L9.5 11.42l5.09-5.09L16 7.75l-6.5 6.5z" fill="#fff" />
  </svg>
)

const ExternalLinkIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

const ChevronLeftIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 6 15 12 9 18" />
  </svg>
)

export default function StoryViewer({ stories, activeIndex, storyTweets, onClose, onChangeIndex }) {
  const story = stories[activeIndex]
  const tweets = storyTweets?.get(story?.name) || []
  const slideCount = Math.max(tweets.length, 1)

  const [slideIdx, setSlideIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)

  const animRef = useRef(null)
  const startRef = useRef(null)
  const pausedAtRef = useRef(0)
  const swipeStartRef = useRef(null)

  // Reset slide index when story changes
  useEffect(() => {
    setSlideIdx(0)
    setProgress(0)
    startRef.current = performance.now()
    pausedAtRef.current = 0
  }, [activeIndex])

  // Keyboard: Escape to close, arrows for slides
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') goNextSlide()
      if (e.key === 'ArrowLeft') goPrevSlide()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, slideIdx, slideCount, activeIndex])

  // Progress bar animation
  useEffect(() => {
    if (paused) {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      return
    }

    startRef.current = performance.now() - pausedAtRef.current

    const tick = (now) => {
      const elapsed = now - startRef.current
      const pct = Math.min(elapsed / SLIDE_DURATION, 1)
      setProgress(pct)
      if (pct < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        goNextSlide()
      }
    }
    animRef.current = requestAnimationFrame(tick)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [slideIdx, paused, activeIndex])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const goNextSlide = useCallback(() => {
    setSlideIdx(prev => {
      const next = prev + 1
      if (next >= slideCount) {
        // Schedule parent state change outside updater
        setTimeout(() => {
          if (activeIndex < stories.length - 1) {
            onChangeIndex(activeIndex + 1)
          } else {
            onClose()
          }
        }, 0)
        return 0
      }
      setProgress(0)
      startRef.current = performance.now()
      pausedAtRef.current = 0
      return next
    })
  }, [slideCount, activeIndex, stories.length, onChangeIndex, onClose])

  const goPrevSlide = useCallback(() => {
    setSlideIdx(prev => {
      if (prev > 0) {
        setProgress(0)
        startRef.current = performance.now()
        pausedAtRef.current = 0
        return prev - 1
      }
      // Schedule parent state change outside updater
      if (activeIndex > 0) {
        setTimeout(() => onChangeIndex(activeIndex - 1), 0)
      }
      return 0
    })
  }, [activeIndex, onChangeIndex])

  // Tap zones: left 30% = prev, right 70% = next
  const handleTap = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = x / rect.width
    if (pct < 0.3) {
      goPrevSlide()
    } else {
      goNextSlide()
    }
  }, [goPrevSlide, goNextSlide])

  // Pause on hold
  const handlePointerDown = useCallback(() => {
    pausedAtRef.current = performance.now() - (startRef.current || performance.now())
    setPaused(true)
  }, [])

  const handlePointerUp = useCallback(() => {
    setPaused(false)
  }, [])

  // Swipe between stories
  const handleTouchStart = useCallback((e) => {
    swipeStartRef.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (swipeStartRef.current === null) return
    const diff = e.changedTouches[0].clientX - swipeStartRef.current
    swipeStartRef.current = null
    if (Math.abs(diff) > 60) {
      if (diff < 0 && activeIndex < stories.length - 1) {
        onChangeIndex(activeIndex + 1)
      } else if (diff > 0 && activeIndex > 0) {
        onChangeIndex(activeIndex - 1)
      }
    }
  }, [activeIndex, stories.length, onChangeIndex])

  const handleBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  if (!story) return null

  const name = story.displayName || story.name || 'Unknown'
  const handle = story.name ? `@${story.name}` : ''
  const currentTweet = tweets[slideIdx] || null

  // Extract t.co URLs from tweet text
  const extractLinks = (text) => {
    if (!text) return { cleanText: text, links: [] }
    const linkRegex = /https?:\/\/t\.co\/\S+/g
    const links = text.match(linkRegex) || []
    const cleanText = text.replace(linkRegex, '').trim()
    return { cleanText, links }
  }

  const tweetContent = currentTweet ? extractLinks(currentTweet.text) : { cleanText: '', links: [] }
  const isLongTweet = (tweetContent.cleanText || '').length > 200

  // Mini bar chart data for engagement visual
  const makeBarHeights = (val) => {
    const base = Math.min(val / 1000, 1)
    return [0.3, 0.5, 0.7, 1, 0.8, 0.6].map(m => Math.max(2, Math.round(m * base * 10)))
  }

  // KOL profile gradient color based on tier
  const kolGradient = story.color
    ? `radial-gradient(ellipse at 50% 0%, ${story.color}30 0%, transparent 70%)`
    : 'none'

  return (
    <div
      className="psv-overlay"
      onClick={handleBackdrop}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Prev KOL arrow (desktop) */}
      {activeIndex > 0 && (
        <button
          className="psv-nav-arrow psv-nav-arrow--left"
          onClick={(e) => { e.stopPropagation(); onChangeIndex(activeIndex - 1) }}
          aria-label="Previous story"
        >
          <ChevronLeftIcon />
        </button>
      )}

      <div className="psv-card">
        {/* KOL profile gradient at card top */}
        <div className="psv-kol-gradient" style={{ background: kolGradient }} />

        {/* Segmented progress bar */}
        <div className="psv-segments">
          {Array.from({ length: slideCount }, (_, i) => (
            <div key={i} className="psv-segment">
              <div
                className="psv-segment-fill"
                style={{
                  width: i < slideIdx ? '100%' : i === slideIdx ? `${progress * 100}%` : '0%',
                  transition: i === slideIdx ? 'none' : 'width 200ms ease',
                }}
              />
            </div>
          ))}
        </div>

        {/* Header: avatar + user + close */}
        <div className="psv-header">
          <div className="psv-user-row">
            {story.image ? (
              <img
                src={story.image}
                alt={name}
                className="psv-avatar"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            ) : (
              <div className="psv-avatar psv-avatar--fallback">
                {(name || '?')[0]}
              </div>
            )}
            <div className="psv-user-info">
              <div className="psv-name-row">
                <span className="psv-name">{name}</span>
                {story.verified && <VerifiedIcon />}
              </div>
              <span className="psv-handle">{handle}</span>
            </div>
            {story.followers && (
              <span className="psv-follower-badge">
                {fmtNum(story.followers)} followers
              </span>
            )}
          </div>
          <button className="psv-close" onClick={onClose} aria-label="Close story">
            <CloseIcon />
          </button>
        </div>

        {/* Tap zone + main content */}
        <div
          className="psv-content"
          onClick={handleTap}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {currentTweet ? (
            <>
              <div className={`psv-tweet-text${isLongTweet ? ' psv-tweet-text--editorial' : ''}`}>
                {tweetContent.cleanText}
              </div>

              {/* Link cards for t.co URLs */}
              {tweetContent.links.map((link, i) => (
                <a
                  key={i}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="psv-link-card"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="psv-link-icon">
                    <ExternalLinkIcon />
                  </div>
                  <span className="psv-link-text">{link}</span>
                </a>
              ))}

              {/* Token context badge with logo */}
              {currentTweet.tokenName && (
                <div className="psv-token-badge">
                  {currentTweet.tokenImage && (
                    <img
                      src={currentTweet.tokenImage}
                      alt={currentTweet.tokenSymbol}
                      className="psv-token-logo"
                      onError={(e) => { e.target.style.display = 'none' }}
                    />
                  )}
                  <span className="psv-token-badge-label">
                    ${currentTweet.tokenSymbol}
                  </span>
                  <span className="psv-token-badge-name">
                    {currentTweet.tokenName}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="psv-no-tweets">
              <div className="psv-no-tweets-text">
                {name} is being discussed across trending tokens
              </div>
              {story.tokenName && (
                <div className="psv-token-badge">
                  <span className="psv-token-badge-name">
                    Active in {story.tokenName} conversation
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Engagement stats with visual mini bars */}
        {currentTweet && (
          <div className="psv-stats">
            <span className="psv-stat">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
              {fmtNum(currentTweet.likes)}
              <span className="psv-stat-bar">
                {makeBarHeights(currentTweet.likes).map((h, i) => (
                  <span key={i} className="psv-stat-bar-seg" style={{ height: h + 'px' }} />
                ))}
              </span>
            </span>
            <span className="psv-stat">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              {fmtNum(currentTweet.replies)}
              <span className="psv-stat-bar">
                {makeBarHeights(currentTweet.replies).map((h, i) => (
                  <span key={i} className="psv-stat-bar-seg" style={{ height: h + 'px' }} />
                ))}
              </span>
            </span>
            <span className="psv-stat">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
              {fmtNum(currentTweet.retweets)}
            </span>
            <span className="psv-stat">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              {fmtNum(currentTweet.views)}
            </span>
          </div>
        )}

        {/* Footer: View on X link + slide counter */}
        <div className="psv-footer">
          {currentTweet?.xUrl && (
            <a
              href={currentTweet.xUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="psv-view-x"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLinkIcon />
              View on X
            </a>
          )}
          {slideCount > 1 && (
            <span className="psv-slide-counter">
              {slideIdx + 1} / {slideCount}
            </span>
          )}
        </div>
      </div>

      {/* Next KOL arrow (desktop) */}
      {activeIndex < stories.length - 1 && (
        <button
          className="psv-nav-arrow psv-nav-arrow--right"
          onClick={(e) => { e.stopPropagation(); onChangeIndex(activeIndex + 1) }}
          aria-label="Next story"
        >
          <ChevronRightIcon />
        </button>
      )}
    </div>
  )
}
