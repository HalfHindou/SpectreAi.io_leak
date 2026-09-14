import React, { useState, useMemo, useCallback, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import AppPortal from '@/components/app-portal'
import usePulseFeed from './use-pulse-feed'
import StoryRail from './story-rail'
const StoryViewer = lazy(() => import('./story-viewer'))
import FeedItem from './feed-item'
// Default tab is 'feed' — protocol and match views only on tab click
const ConnectionProtocol = lazy(() => import('./connection-protocol'))
const MatchMaker = lazy(() => import('./match-maker'))
import PulseSidebar from './pulse-sidebar'
import './pulse-page.css'

/**
 * PulsePage - Instagram-style crypto KOL feed.
 *
 * Layout (desktop >1200px):
 *   Stories rail (full width)
 *   Tab bar: Feed | Protocol | Match
 *   Two-column: Feed (65%, 2-col masonry) + Sidebar (35%, sticky)
 *
 * Layout (tablet 769-1200px):
 *   Stacked: feed then sidebar below
 *
 * Layout (mobile <=768px):
 *   Single column feed, no sidebar
 */

const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'protocol', label: 'Protocol' },
  { id: 'match', label: 'Match' },
]

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'tweets', label: 'Tweets' },
  { id: 'videos', label: 'Videos' },
  { id: 'insights', label: 'Insights' },
]

export default function PulsePage({ dayMode }) {
  const [activeStoryIndex, setActiveStoryIndex] = useState(null)
  const [activeTab, setActiveTab] = useState('feed')
  const [activeFilter, setActiveFilter] = useState('all')
  const [activeSector, setActiveSector] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch real tweets from X Intelligence graph data
  const {
    feed: liveFeed,
    stories: liveStories,
    insightCards,
    tokenCards,
    videos,
    storyTweets,
    loading,
  } = usePulseFeed()

  // Filter to KOL stories only (skip 'add' item for story viewer navigation)
  const kolStories = useMemo(() =>
    liveStories.filter(s => s.type === 'kol'),
    [liveStories]
  )

  const handleStoryClick = useCallback((story) => {
    const idx = kolStories.findIndex(s => s.id === story.id)
    if (idx >= 0) setActiveStoryIndex(idx)
  }, [kolStories])

  const handleCloseStory = useCallback(() => {
    setActiveStoryIndex(null)
  }, [])

  const handleChangeStoryIndex = useCallback((idx) => {
    if (idx < 0 || idx >= kolStories.length) {
      setActiveStoryIndex(null)
    } else {
      setActiveStoryIndex(idx)
    }
  }, [kolStories.length])

  const handleSearchChange = useCallback((q) => {
    setSearchQuery(q)
  }, [])

  // Merge live tweets with insight + token + video cards for mixed feed
  const feedData = useMemo(() => {
    let tweets = liveFeed
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      tweets = tweets.filter(t =>
        (t.user || '').toLowerCase().includes(q) ||
        (t.handle || '').toLowerCase().includes(q) ||
        (t.body || '').toLowerCase().includes(q)
      )
    }

    if (activeFilter === 'tweets') return tweets
    if (activeFilter === 'videos') return videos || []
    if (activeFilter === 'insights') return [...insightCards, ...tokenCards]

    // "all" - mixed feed: interleave insights, token cards, and videos into tweets
    const mixed = []
    let tIdx = 0, iIdx = 0, tkIdx = 0, vIdx = 0

    const total = tweets.length + insightCards.length + tokenCards.length + (videos?.length || 0)
    for (let i = 0; i < total; i++) {
      if (i % 7 === 5 && vIdx < (videos?.length || 0)) {
        mixed.push(videos[vIdx++])
      } else if (i % 4 === 1 && iIdx < insightCards.length) {
        mixed.push(insightCards[iIdx++])
      } else if (i % 6 === 4 && tkIdx < tokenCards.length) {
        mixed.push(tokenCards[tkIdx++])
      } else if (tIdx < tweets.length) {
        mixed.push(tweets[tIdx++])
      }
    }
    // Drain remaining
    while (vIdx < (videos?.length || 0)) mixed.push(videos[vIdx++])
    while (iIdx < insightCards.length) mixed.push(insightCards[iIdx++])
    while (tkIdx < tokenCards.length) mixed.push(tokenCards[tkIdx++])
    while (tIdx < tweets.length) mixed.push(tweets[tIdx++])
    return mixed
  }, [liveFeed, insightCards, tokenCards, videos, searchQuery, activeFilter])

  return (
    <div className={`pp-root ${dayMode ? 'pp-root--day' : ''}`}>
      {/* Bokeh background - floating soft circles */}
      <div className="pp-bokeh" aria-hidden="true">
        <div className="pp-bokeh-circle pp-bokeh-1" />
        <div className="pp-bokeh-circle pp-bokeh-2" />
        <div className="pp-bokeh-circle pp-bokeh-3" />
        <div className="pp-bokeh-circle pp-bokeh-4" />
        <div className="pp-bokeh-circle pp-bokeh-5" />
        <div className="pp-bokeh-circle pp-bokeh-6" />
        <div className="pp-bokeh-circle pp-bokeh-7" />
      </div>

      {/* Story viewer overlay - portalled to body so it pops out above everything.
          AppPortal instead of a bare createPortal: the bare one dropped the
          overlay out of `.app` AND out of `.pp-root--day`, so every day-mode
          rule for `.psv-*` silently stopped matching. The carrier re-supplies
          both. It carries `pp-root--day` WITHOUT `pp-root` on purpose -
          `.pp-root > *:not(.pp-bokeh)` sets `position: relative` and would beat
          the overlay's own `position: fixed`. */}
      {activeStoryIndex !== null && kolStories.length > 0 && (
        <AppPortal className={dayMode ? 'pp-root--day' : ''}>
          <Suspense fallback={null}>
            <StoryViewer
              stories={kolStories}
              activeIndex={activeStoryIndex}
              storyTweets={storyTweets}
              onClose={handleCloseStory}
              onChangeIndex={handleChangeStoryIndex}
            />
          </Suspense>
        </AppPortal>
      )}

      {/* Stories rail - full width */}
      <StoryRail
        stories={liveStories}
        onStoryClick={handleStoryClick}
        onSearchChange={handleSearchChange}
      />

      {/* Tab bar + content filter */}
      <div className="pp-tab-row">
        <nav className="pp-tabs" role="tablist">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`pp-tab ${activeTab === tab.id ? 'pp-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          {loading && <span className="pp-loading-dot" />}
        </nav>

        {activeTab === 'feed' && (
          <div className="pp-filters">
            {FILTERS.map(f => (
              <button
                key={f.id}
                className={`pp-filter ${activeFilter === f.id ? 'pp-filter--active' : ''}`}
                onClick={() => setActiveFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="pp-layout">
        {activeTab === 'feed' && (
          <div className="pp-two-col">
            {loading && feedData.length === 0 ? (
              <div className="pp-feed-col pp-feed-grid">
                {[0,1,2,3,4,5].map(i => (
                  <div key={i} className={`pp-skeleton-card ${i < 2 ? 'pp-skeleton-card--tall' : i < 4 ? 'pp-skeleton-card--med' : 'pp-skeleton-card--short'}`}>
                    <div className="pp-skel-header">
                      <div className="pp-skel-avatar" />
                      <div className="pp-skel-lines">
                        <div className="pp-skel-line pp-skel-line--w60" />
                        <div className="pp-skel-line pp-skel-line--w40" />
                      </div>
                    </div>
                    <div className="pp-skel-body">
                      <div className="pp-skel-line pp-skel-line--w80" />
                      <div className="pp-skel-line pp-skel-line--w60" />
                      {i < 4 && <div className="pp-skel-block" />}
                    </div>
                    <div className="pp-skel-actions">
                      <div className="pp-skel-action" />
                      <div className="pp-skel-action" />
                      <div className="pp-skel-action" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pp-feed-col pp-feed-grid">
                {feedData.map((item, i) => (
                  <FeedItem key={item.id} item={item} index={i} />
                ))}
              </div>
            )}
            <div className="pp-sidebar-col">
              <PulseSidebar dayMode={dayMode} />
            </div>
          </div>
        )}

        {activeTab === 'protocol' && (
          <div className="pp-protocol-embed">
            <Suspense fallback={null}>
              <ConnectionProtocol activeSector={activeSector} onSectorChange={setActiveSector} />
            </Suspense>
          </div>
        )}

        {activeTab === 'match' && (
          <div className="pp-match-embed">
            <Suspense fallback={null}>
              <MatchMaker />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  )
}
