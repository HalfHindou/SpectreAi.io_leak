/**
 * AI Media Center – Videos, Shorts, Live, Channels
 * Lazy fetches per-tab on first visit. Theater/Mini-player/Queue overlays preserved.
 */
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import lazyWithRetry from '@/lib/lazy-with-retry'
import spectreIcons from '@/icons/spectreIcons'
import useMediaStore from '@/store/useMediaStore'
import * as mediaApi from '@/services/mediaApi'
import { isAppActive } from '@/lib/idleManager'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import MediaCard from './media-card'
import ShortsCard from './shorts-card'
import ChannelCard from './channel-card'
import MediaTabHeader from './media-tab-header'
import ForYouEmpty from './for-you-empty'
import LiveBadge from './live-badge'
import DiscoverHome from './discover-home'
const PodcastsTab = lazyWithRetry(() => import('./podcasts-tab'))
// Modal-style surfaces — only mount when actually opened/active.
const TheaterMode   = lazyWithRetry(() => import('./theater-mode'))
const QueueDrawer   = lazyWithRetry(() => import('./queue-drawer'))
const ShortsViewer  = lazyWithRetry(() => import('./shorts-viewer'))
import InfoTip from '@/components/InfoTip'
import MobileBackButton from '@/components/mobile-back-button'
import './media-center-page.css'
import './media-center-page.mobile.css'
import './discover-home.css'

/* ── Tabs definition ───────────────────────────────── */
/* Tab IDs are stable; labels resolve at render time via i18n. */

const TAB_IDS = ['discover', 'videos', 'podcasts', 'shorts', 'live', 'channels', 'saved']

/* ── Skeleton helpers ──────────────────────────────── */

function SkeletonCards({ count = 8, type = 'card' }) {
  const items = Array.from({ length: count }, (_, i) => i)
  if (type === 'short') {
    return (
      <div className="mc-grid-shorts">
        {items.map(i => (
          <div key={i} className="mc-skeleton mc-skeleton-short animate-shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
        ))}
      </div>
    )
  }
  if (type === 'channel') {
    return (
      <div className="mc-grid mc-grid-channels">
        {items.map(i => (
          <div key={i} className="mc-skeleton-channel" style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="mc-skeleton mc-skel-avatar animate-shimmer" />
            <div className="mc-skel-lines">
              <div className="mc-skeleton mc-skel-line animate-shimmer" />
              <div className="mc-skeleton mc-skel-line mc-skel-line-short animate-shimmer" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  // default: 16:9 video card
  return (
    <div className="mc-grid">
      {items.map(i => (
        <div key={i} className="mc-skeleton-card" style={{ animationDelay: `${i * 0.05}s` }}>
          <div className="mc-skeleton mc-skel-thumb animate-shimmer" />
          <div className="mc-skeleton mc-skel-line animate-shimmer" />
          <div className="mc-skeleton mc-skel-line mc-skel-line-short animate-shimmer" />
        </div>
      ))}
    </div>
  )
}

/* ── Error state ───────────────────────────────────── */

function TabError({ message, onRetry, t }) {
  return (
    <div className="mc-error">
      <span className="mc-error-msg">{message || t('mediaCenter.crashFallback')}</span>
      <button type="button" className="mc-error-retry" onClick={onRetry}>
        {t('mediaCenter.tryAgain')}
      </button>
    </div>
  )
}

/* ── Empty state ───────────────────────────────────── */

function TabEmpty({ message, t }) {
  return (
    <div className="mc-empty">
      <h3 className="mc-empty-title">{message || t('mediaCenter.empty.noResults')}</h3>
    </div>
  )
}

/* ── Load More Spinner (infinite scroll) ──────────── */

function LoadMoreSpinner() {
  return (
    <div className="mc-load-more">
      <div className="mc-load-more-shimmer animate-shimmer" style={{ width: '70%', height: 14, borderRadius: 6, marginBottom: 8 }} />
      <div className="mc-load-more-shimmer animate-shimmer" style={{ width: '50%', height: 14, borderRadius: 6 }} />
    </div>
  )
}

/* ── Main Component ────────────────────────────────── */

const MediaCenterPage = ({ dayMode = false, isMobile = false }) => {
  const { t } = useTranslation()
  const tabs = useMemo(() => TAB_IDS.map(id => ({ id, label: t(`mediaCenter.tabs.${id}`) })), [t])
  const [activeTab, setActiveTab] = useState('discover')
  const [searchQuery, setSearchQuery] = useState('')
  const [shortsViewerOpen, setShortsViewerOpen] = useState(false)
  const [shortsViewerIndex, setShortsViewerIndex] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [channelVideos, setChannelVideos] = useState([])
  const [channelVideosLoading, setChannelVideosLoading] = useState(false)
  const [channelCategory, setChannelCategory] = useState('all')
  const [channelVideosError, setChannelVideosError] = useState(null)
  const [loadMoreError, setLoadMoreError] = useState(null)
  const searchTimerRef = useRef(null)
  const loadingMoreRef = useRef(false)
  const fetchMoreRef = useRef(null)
  const pageRef = useRef(null)
  const sentinelRef = useRef(null)

  /* ── Store — per-tab data ──────────────────────── */
  const discoverData       = useMediaStore(s => s.discoverData)
  const discoverLoading    = useMediaStore(s => s.discoverLoading)
  const discoverError      = useMediaStore(s => s.discoverError)
  const discoverLastRefreshed = useMediaStore(s => s.discoverLastRefreshed)

  const podcastsItems      = useMediaStore(s => s.podcastsItems)
  const podcastsLoading    = useMediaStore(s => s.podcastsLoading)
  const podcastsError      = useMediaStore(s => s.podcastsError)
  const podcastsLastRefreshed = useMediaStore(s => s.podcastsLastRefreshed)

  const forYouItems        = useMediaStore(s => s.forYouItems)
  const forYouLoading      = useMediaStore(s => s.forYouLoading)
  const forYouError        = useMediaStore(s => s.forYouError)
  const forYouLastRefreshed = useMediaStore(s => s.forYouLastRefreshed)

  const videosItems        = useMediaStore(s => s.videosItems)
  const videosLoading      = useMediaStore(s => s.videosLoading)
  const videosError        = useMediaStore(s => s.videosError)
  const videosLastRefreshed = useMediaStore(s => s.videosLastRefreshed)

  const shortsItems        = useMediaStore(s => s.shortsItems)
  const shortsLoading      = useMediaStore(s => s.shortsLoading)
  const shortsError        = useMediaStore(s => s.shortsError)
  const shortsLastRefreshed = useMediaStore(s => s.shortsLastRefreshed)

  const liveItems          = useMediaStore(s => s.liveItems)
  const liveLoading        = useMediaStore(s => s.liveLoading)
  const liveError          = useMediaStore(s => s.liveError)
  const liveLastRefreshed  = useMediaStore(s => s.liveLastRefreshed)

  const channelsItems      = useMediaStore(s => s.channelsItems)
  const channelsLoading    = useMediaStore(s => s.channelsLoading)
  const channelsError      = useMediaStore(s => s.channelsError)
  const channelsLastRefreshed = useMediaStore(s => s.channelsLastRefreshed)

  /* ── Store — playback & UI ────────────────────── */
  const activeVideo        = useMediaStore(s => s.activeVideo)
  const theaterOpen        = useMediaStore(s => s.theaterOpen)
  const queueDrawerOpen    = useMediaStore(s => s.queueDrawerOpen)
  const savedItems         = useMediaStore(s => s.savedItems)
  const queue              = useMediaStore(s => s.queue)
  const playVideo          = useMediaStore(s => s.playVideo)
  const playPodcast        = useMediaStore(s => s.playPodcast)
  const toggleSave         = useMediaStore(s => s.toggleSave)
  const clearSaved         = useMediaStore(s => s.clearSaved)
  const addToQueue         = useMediaStore(s => s.addToQueue)
  const toggleQueueDrawer  = useMediaStore(s => s.toggleQueueDrawer)
  const setTabLoading      = useMediaStore(s => s.setTabLoading)
  const setTabData         = useMediaStore(s => s.setTabData)
  const setTabError        = useMediaStore(s => s.setTabError)
  const setDiscoverData    = useMediaStore(s => s.setDiscoverData)
  const setSpotifyLatest   = useMediaStore(s => s.setSpotifyLatest)
  const appendTabPage      = useMediaStore(s => s.appendTabPage)
  const pagination         = useMediaStore(s => s.pagination)

  /* ── One play entry point ─────────────────────
     Podcast rows route to the app-wide audio player; everything else opens the
     video theater. Without this a podcast card in Discover opened the theater,
     whose <audio> died the moment you navigated away. */
  const handlePlayItem = useCallback((item) => {
    if (item?.type === 'podcast' && item?.audioUrl) playPodcast(item)
    else playVideo(item)
  }, [playPodcast, playVideo])

  /* ── Watchlists for For You tab ───────────────── */
  const { watchlists } = useWatchlists()
  const watchlistSymbols = useMemo(() => {
    if (!watchlists?.length) return []
    return [...new Set(watchlists.flatMap(w => w.items?.map(i => i.symbol) || []))]
  }, [watchlists])

  /* ── Saved IDs set ────────────────────────────── */
  const savedIdSet = useMemo(() => new Set(savedItems.map(s => s.id)), [savedItems])
  const isSaved = useCallback((id) => savedIdSet.has(id), [savedIdSet])

  /* ── Search filter ────────────────────────────── */
  const filterBySearch = useCallback((items) => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.channel?.name?.toLowerCase().includes(q) ||
      item.channel?.toLowerCase?.()?.includes(q) ||
      item.tags?.some(t => t.toLowerCase().includes(q))
    )
  }, [searchQuery])

  /* ── Fetch a tab's data ───────────────────────── */
  const fetchTab = useCallback(async (tab, refresh = false) => {
    setTabLoading(tab, true)
    try {
      let result
      const opts = refresh ? { refresh: true } : {}
      switch (tab) {
        case 'discover':
          result = await mediaApi.getDiscover(opts)
          setDiscoverData(result)
          return
        case 'podcasts':
          result = await mediaApi.getPodcasts(opts)
          break
        case 'forYou': {
          const tokens = watchlistSymbols
          if (!tokens.length) {
            setTabLoading(tab, false)
            return
          }
          result = await mediaApi.getForYou(tokens, opts)
          break
        }
        case 'videos':
          result = await mediaApi.getVideos('crypto', null, opts)
          break
        case 'shorts':
          result = await mediaApi.getShorts('crypto', null, opts)
          break
        case 'live':
          result = await mediaApi.getLive(opts)
          break
        case 'channels':
          result = await mediaApi.getChannels(opts)
          break
        default:
          return
      }
      setTabData(tab, result)
    } catch (err) {
      setTabError(tab, err.message)
    }
  }, [watchlistSymbols, setTabLoading, setTabData, setTabError, setDiscoverData])

  /* ── Fetch next page (infinite scroll) ────────── */
  const fetchMore = useCallback(async (tab) => {
    if (loadingMoreRef.current) return
    const pg = useMediaStore.getState().pagination[tab]
    if (!pg?.hasMore || !pg?.nextPage) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      let result
      if (tab === 'videos') {
        result = await mediaApi.getVideosPage('crypto', pg.nextPage)
      } else if (tab === 'shorts') {
        result = await mediaApi.getShortsPage('crypto', pg.nextPage)
      } else {
        loadingMoreRef.current = false
        setLoadingMore(false)
        return
      }
      appendTabPage(tab, result)
    } catch (err) {
      console.error(`[MediaCenter] fetchMore ${tab} failed:`, err)
      setLoadMoreError(t('mediaCenter.loadMoreError'))
      setTimeout(() => setLoadMoreError(null), 4000)
    }
    loadingMoreRef.current = false
    setLoadingMore(false)
  }, [appendTabPage, t])

  fetchMoreRef.current = fetchMore

  /* ── Channel click → fetch channel videos ───── */
  const handleChannelClick = useCallback(async (channel) => {
    if (channel.source !== 'youtube') {
      window.open(channel.url, '_blank', 'noopener')
      return
    }
    const ytChannelId = channel.id?.replace('yt_ch_', '') || channel.id
    setSelectedChannel(channel)
    setChannelVideos([])
    setChannelVideosLoading(true)
    setChannelVideosError(null)
    try {
      const result = await mediaApi.getChannelVideos(ytChannelId)
      setChannelVideos(result?.items || [])
    } catch (err) {
      console.error('[MediaCenter] channel videos fetch failed:', err)
      setChannelVideosError(t('mediaCenter.channelVideosError'))
    }
    setChannelVideosLoading(false)
  }, [t])

  const clearSelectedChannel = useCallback(() => {
    setSelectedChannel(null)
    setChannelVideos([])
  }, [])

  /* ── Infinite scroll via IntersectionObserver ── */
  // Re-run when items load so sentinel ref is available in DOM
  const activeTabHasItems = (activeTab === 'videos' && videosItems.length > 0)
    || (activeTab === 'shorts' && shortsItems.length > 0)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const paginatedTabs = ['videos', 'shorts']
    if (!paginatedTabs.includes(activeTab)) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMoreRef.current) {
        fetchMoreRef.current(activeTab)
      }
    }, { rootMargin: '600px' })

    observer.observe(el)
    return () => observer.disconnect()
  }, [activeTab, activeTabHasItems])

  /* ── Debounced API search ───────────────────── */
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = searchQuery.trim()
    if (!q || q.length < 3) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }
    const searchableTabs = ['videos', 'shorts', 'forYou']
    if (!searchableTabs.includes(activeTab)) {
      setSearchResults(null)
      return
    }
    setSearchLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        let result
        if (activeTab === 'videos' || activeTab === 'forYou') {
          result = await mediaApi.getVideos(q)
        } else if (activeTab === 'shorts') {
          result = await mediaApi.getShorts(q)
        }
        setSearchResults(result?.items || [])
      } catch {
        setSearchResults(null)
      }
      setSearchLoading(false)
    }, 500)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery, activeTab])

  /* ── Clear search results & channel on tab change */
  useEffect(() => {
    setSearchResults(null)
    setSearchLoading(false)
    setSelectedChannel(null)
    setChannelVideos([])
  }, [activeTab])

  /* ── Spotify latest-episode metadata (once on mount) ── */
  useEffect(() => {
    let cancelled = false
    mediaApi.getSpotifyLatest()
      .then(r => { if (!cancelled && r?.items) setSpotifyLatest(r.items) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [setSpotifyLatest])

  /* ── Lazy load on tab change ──────────────────── */
  useEffect(() => {
    if (activeTab === 'saved') return
    const state = useMediaStore.getState()
    if (activeTab === 'discover') {
      if (state.discoverData || state.discoverLoading) return
      fetchTab('discover')
      return
    }
    const items = state[`${activeTab}Items`]
    const loading = state[`${activeTab}Loading`]
    if ((items && items.length > 0) || loading) return
    fetchTab(activeTab)
  }, [activeTab, fetchTab])

  /* ── Auto-refresh Live tab every 10 min ──────── */
  useEffect(() => {
    if (activeTab !== 'live') return
    const interval = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      fetchTab('live', true)
    }, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [activeTab, fetchTab])

  /* ── Aggregate per-tab data references ───────── */
  const tabData = {
    discover: { items: [],            loading: discoverLoading, error: discoverError, lastRefreshed: discoverLastRefreshed },
    podcasts: { items: podcastsItems, loading: podcastsLoading, error: podcastsError, lastRefreshed: podcastsLastRefreshed },
    forYou:   { items: forYouItems,   loading: forYouLoading,   error: forYouError,   lastRefreshed: forYouLastRefreshed },
    videos:   { items: videosItems,   loading: videosLoading,   error: videosError,   lastRefreshed: videosLastRefreshed },
    shorts:   { items: shortsItems,   loading: shortsLoading,   error: shortsError,   lastRefreshed: shortsLastRefreshed },
    live:     { items: liveItems,     loading: liveLoading,     error: liveError,     lastRefreshed: liveLastRefreshed },
    channels: { items: channelsItems, loading: channelsLoading, error: channelsError, lastRefreshed: channelsLastRefreshed },
    saved:    { items: savedItems,    loading: false,           error: null,          lastRefreshed: null },
  }

  const current = tabData[activeTab] || { items: [], loading: false, error: null, lastRefreshed: null }
  // Memo so opening the theater / mini-player / queue (all subscribed store state)
  // doesn't re-run the filter over the full active-tab list (hundreds of items).
  const filtered = useMemo(
    () => (searchResults !== null ? searchResults : filterBySearch(current.items)),
    [searchResults, current.items, filterBySearch],
  )

  /* ── Render tab content ───────────────────────── */
  function renderTabContent() {
    const { items, loading, error, lastRefreshed } = current
    const tab = activeTab

    /* ── Discover Tab (editorial home) ──────────── */
    if (tab === 'discover') {
      return (
        <div className="mc-section mc-section-discover">
          <DiscoverHome
            data={discoverData}
            loading={discoverLoading}
            onPlay={handlePlayItem}
            onToggleSave={toggleSave}
            onAddToQueue={addToQueue}
            isSaved={isSaved}
          />
        </div>
      )
    }

    /* ── Podcasts Tab ───────────────────────────── */
    if (tab === 'podcasts') {
      return (
        <div className="mc-section mc-section-podcasts">
          <MediaTabHeader title={t('mediaCenter.podcasts.title')} lastRefreshed={lastRefreshed} loading={loading} onRefresh={() => fetchTab('podcasts', true)}>
            <span className="mcx-sub-inline">{t('mediaCenter.podcasts.subtitle')}</span>
          </MediaTabHeader>
          <Suspense fallback={<SkeletonCards count={6} type="card" />}>
            <PodcastsTab
              items={items}
              loading={loading}
              error={error}
              lastRefreshed={lastRefreshed}
              onRefresh={() => fetchTab('podcasts', true)}
              searchQuery={searchQuery}
              t={t}
            />
          </Suspense>
        </div>
      )
    }

    /* ── Saved Tab ──────────────────────────────── */
    if (tab === 'saved') {
      return (
        <div className="mc-section mc-section-saved">
          <MediaTabHeader
            title={t('mediaCenter.sectionTitles.saved')}
            lastRefreshed={null}
            loading={false}
            onRefresh={null}
          />
          {savedItems.length === 0 ? (
            <div className="mc-empty">
              <span className="mc-empty-icon">{spectreIcons.star}</span>
              <h3 className="mc-empty-title">{t('mediaCenter.empty.savedTitle')}</h3>
              <p className="mc-empty-desc">{t('mediaCenter.empty.savedDesc')}</p>
            </div>
          ) : (
            <>
              <div className="mc-saved-header">
                <span className="mc-saved-count">
                  {savedItems.length} {t('mediaCenter.savedCountSuffix')}
                  <InfoTip text={t('mediaCenter.savedTip')} position="right" />
                </span>
                <button type="button" className="mc-clear-all" onClick={clearSaved}>
                  {t('mediaCenter.clearAll')}
                </button>
              </div>
              <div className="mc-grid">
                {filterBySearch(savedItems).map((item, i) => (
                  <MediaCard
                    key={`${item.id}-saved`}
                    item={item}
                    isSaved={true}
                    onPlay={handlePlayItem}
                    onToggleSave={toggleSave}
                    onAddToQueue={addToQueue}
                    index={i}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )
    }

    /* ── For You Tab ──────────────────────────────── */
    if (tab === 'forYou') {
      const noTokens = !watchlistSymbols.length

      return (
        <div className="mc-section mc-section-for-you">
          <MediaTabHeader
            title={t('mediaCenter.sectionTitles.forYou')}
            lastRefreshed={lastRefreshed}
            loading={loading}
            onRefresh={() => fetchTab('forYou', true)}
          />
          {noTokens ? (
            <div className="mc-for-you-empty">
              <ForYouEmpty />
            </div>
          ) : loading ? (
            <SkeletonCards count={8} type="card" />
          ) : error ? (
            <TabError message={error} onRetry={() => fetchTab('forYou', true)} t={t} />
          ) : filtered.length === 0 ? (
            <TabEmpty message={t('mediaCenter.empty.forYou')} t={t} />
          ) : (
            <div className="mc-grid">
              {filtered.map((item, i) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  isSaved={isSaved(item.id)}
                  onPlay={handlePlayItem}
                  onToggleSave={toggleSave}
                  onAddToQueue={addToQueue}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>
      )
    }

    /* ── Shorts Tab ───────────────────────────────── */
    if (tab === 'shorts') {
      const openShortsViewer = (idx) => {
        setShortsViewerIndex(idx)
        setShortsViewerOpen(true)
      }

      return (
        <div className="mc-section mc-section-shorts">
          <MediaTabHeader
            title={t('mediaCenter.sectionTitles.shorts')}
            lastRefreshed={lastRefreshed}
            loading={loading}
            onRefresh={() => fetchTab('shorts', true)}
          />
          {loading && filtered.length === 0 ? (
            <SkeletonCards count={8} type="short" />
          ) : error ? (
            <TabError message={error} onRetry={() => fetchTab('shorts', true)} t={t} />
          ) : filtered.length === 0 ? (
            <TabEmpty message={t('mediaCenter.empty.noShorts')} t={t} />
          ) : (
            <>
              {searchLoading && <div className="mc-search-indicator">{t('mediaCenter.searching')}</div>}
              <div className="mc-grid-shorts">
                {filtered.map((item, i) => (
                  <ShortsCard
                    key={item.id}
                    item={item}
                    isSaved={isSaved(item.id)}
                    onPlay={() => openShortsViewer(i)}
                    onToggleSave={toggleSave}
                    index={i}
                  />
                ))}
              </div>
              {loadingMore && <LoadMoreSpinner />}
              {loadMoreError && <div className="mc-load-more-error">{loadMoreError}</div>}
              <div ref={sentinelRef} style={{ height: 1 }} />
            </>
          )}
        </div>
      )
    }

    /* ── Channels Tab ─────────────────────────────── */
    if (tab === 'channels') {
      if (selectedChannel) {
        return (
          <div className="mc-section mc-section-channel-videos">
            <div className="mc-channel-back-row">
              <button type="button" className="mc-channel-back-btn" onClick={clearSelectedChannel}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                {t('mediaCenter.allChannels')}
              </button>
              <div className="mc-channel-back-info">
                {selectedChannel.avatar && (
                  <img src={selectedChannel.avatar} alt="" className="mc-channel-back-avatar" />
                )}
                <span className="mc-channel-back-name">{selectedChannel.name}</span>
              </div>
            </div>
            {channelVideosLoading ? (
              <SkeletonCards count={8} type="card" />
            ) : channelVideosError ? (
              <TabError message={channelVideosError} onRetry={() => handleChannelClick(selectedChannel)} t={t} />
            ) : channelVideos.length === 0 ? (
              <TabEmpty message={t('mediaCenter.empty.noChannelVideos', { name: selectedChannel.name })} t={t} />
            ) : (
              <div className="mc-grid">
                {channelVideos.map((item, i) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    isSaved={isSaved(item.id)}
                    onPlay={handlePlayItem}
                    onToggleSave={toggleSave}
                    onAddToQueue={addToQueue}
                    index={i}
                  />
                ))}
              </div>
            )}
          </div>
        )
      }

      const CHANNEL_CATS = [
        { id: 'all',     label: t('mediaCenter.categories.all') },
        { id: 'crypto',  label: t('mediaCenter.categories.crypto') },
        { id: 'finance', label: t('mediaCenter.categories.finance') },
        { id: 'stocks',  label: t('mediaCenter.categories.stocks') },
        { id: 'news',    label: t('mediaCenter.categories.news') },
      ]
      const channelFiltered = channelCategory === 'all'
        ? filtered
        : filtered.filter(ch => ch.category === channelCategory)

      return (
        <div className="mc-section mc-section-channels">
          <MediaTabHeader
            title={t('mediaCenter.sectionTitles.channels')}
            lastRefreshed={lastRefreshed}
            loading={loading}
            onRefresh={() => fetchTab('channels', true)}
          />
          {!loading && (
            <div className="mc-channel-cats">
              {CHANNEL_CATS.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  className={`mc-cat-pill${channelCategory === cat.id ? ' active' : ''}`}
                  onClick={() => setChannelCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
          {loading ? (
            <SkeletonCards count={12} type="channel" />
          ) : error ? (
            <TabError message={error} onRetry={() => fetchTab('channels', true)} t={t} />
          ) : channelFiltered.length === 0 ? (
            <TabEmpty message={t('mediaCenter.empty.noCategory')} t={t} />
          ) : (
            <div className="mc-grid mc-grid-channels">
              {channelFiltered.map((ch, i) => (
                <ChannelCard
                  key={ch.id}
                  channel={ch}
                  onClick={handleChannelClick}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>
      )
    }

    /* ── Live Tab ─────────────────────────────────── */
    if (tab === 'live') {
      return (
        <div className="mc-section mc-section-live">
          <MediaTabHeader
            title={
              <span className="mc-live-header-title">
                <LiveBadge />
                {t('mediaCenter.liveStreamsTitle')}
                <InfoTip
                  text={t('mediaCenter.liveTip')}
                  position="right"
                />
              </span>
            }
            lastRefreshed={lastRefreshed}
            loading={loading}
            onRefresh={() => fetchTab('live', true)}
          />
          {loading ? (
            <SkeletonCards count={6} type="card" />
          ) : error ? (
            <TabError message={error} onRetry={() => fetchTab('live', true)} t={t} />
          ) : filtered.length === 0 ? (
            <TabEmpty message={t('mediaCenter.empty.noLive')} t={t} />
          ) : (
            <div className="mc-grid mc-grid-live">
              {filtered.map((item, i) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  isSaved={isSaved(item.id)}
                  onPlay={handlePlayItem}
                  onToggleSave={toggleSave}
                  onAddToQueue={addToQueue}
                  index={i}
                  isLive
                />
              ))}
            </div>
          )}
        </div>
      )
    }

    /* ── Videos tab ──────────────────────────────── */
    return (
      <div className="mc-section mc-section-videos">
        <MediaTabHeader
          title={t('mediaCenter.sectionTitles.videos')}
          lastRefreshed={lastRefreshed}
          loading={loading}
          onRefresh={() => fetchTab('videos', true)}
        />
        {loading && filtered.length === 0 ? (
          <SkeletonCards count={8} type="card" />
        ) : error ? (
          <TabError message={error} onRetry={() => fetchTab('videos', true)} t={t} />
        ) : filtered.length === 0 ? (
          <TabEmpty message={t('mediaCenter.empty.noVideos')} t={t} />
        ) : (
          <>
            {searchLoading && <div className="mc-search-indicator">{t('mediaCenter.searching')}</div>}
            <div className="mc-grid">
              {filtered.map((item, i) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  isSaved={isSaved(item.id)}
                  onPlay={handlePlayItem}
                  onToggleSave={toggleSave}
                  onAddToQueue={addToQueue}
                  index={i}
                />
              ))}
            </div>
            {loadingMore && <LoadMoreSpinner />}
            {loadMoreError && <div className="mc-load-more-error">{loadMoreError}</div>}
            <div ref={sentinelRef} style={{ height: 1 }} />
          </>
        )}
      </div>
    )
  }

  /* ── Render ───────────────────────────────────── */

  /* ── Mobile Layout ───────────────────────────── */
  if (isMobile) {
    return (
      <div ref={pageRef} className={`mc-page mmc-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mmc-content">
          {/* Spacer for fixed header */}
          <div className="mmc-header-spacer" aria-hidden="true" />

          {/* ── Title + Search ──────────────────── */}
          <div className="mmc-section">
            <div className="mmc-title-row">
              <MobileBackButton className="mmc-back" />
              <div className="mmc-page-label">{t('mediaCenter.pageTitle')}</div>
            </div>
            <div className="mmc-search">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mmc-search-icon">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                className="mmc-search-input"
                placeholder={t('mediaCenter.searchPlaceholderMobile')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="mmc-search-clear" onClick={() => setSearchQuery('')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* ── Tab Pills (horizontal scroll) ──── */}
          <div className="mmc-section-flush">
            <div className="mmc-tabs" role="tablist">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`mmc-tab${activeTab === tab.id ? ' mmc-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === 'live' && <span className="mmc-live-dot" />}
                  {tab.id === 'saved' && savedItems.length > 0 && (
                    <span className="mmc-badge">{savedItems.length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tab Content ────────────────────── */}
          <div className="mmc-section mmc-tab-content" role="tabpanel">
            {renderTabContent()}
          </div>
        </div>

        {/* ── Overlays (unchanged) ─────────────── */}
        {theaterOpen && activeVideo && (
          <Suspense fallback={null}><TheaterMode dayMode={dayMode} /></Suspense>
        )}
        {/* MiniPlayer + SpotifyDock now mount in AppShell — page-local mounts
            died with the route, which is exactly the "it stops when I leave the
            Media Center" bug. */}
        {queueDrawerOpen && (
          <Suspense fallback={null}><QueueDrawer open={queueDrawerOpen} dayMode={dayMode} /></Suspense>
        )}
        {shortsViewerOpen && (
          <Suspense fallback={null}>
            <ShortsViewer
              shorts={filtered}
              startIndex={shortsViewerIndex}
              dayMode={dayMode}
              onClose={() => setShortsViewerOpen(false)}
              onLoadMore={() => fetchMore('shorts')}
              hasMore={pagination.shorts?.hasMore}
            />
          </Suspense>
        )}
      </div>
    )
  }

  /* ── Desktop Layout ──────────────────────────── */
  return (
    <div ref={pageRef} className={`mc-page${dayMode ? ' day-mode' : ''}${queueDrawerOpen ? ' drawer-open' : ''}`}>

      {/* ── Header ─────────────────────────────── */}
      <div className="mc-header">
        <div className="mc-header-left">
          <h1 className="mc-title">
            {t('mediaCenter.pageTitle')}
            <InfoTip
              text={t('mediaCenter.pageTitleTip')}
              position="right"
            />
          </h1>
          <p className="mc-subtitle">{t('mediaCenter.pageSubtitle')}</p>
        </div>
        <div className="mc-header-right">
          <div className="mc-search">
            <span className="mc-search-icon">{spectreIcons.search}</span>
            <input
              type="text"
              className="mc-search-input"
              placeholder={t('mediaCenter.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" className="mc-search-clear" onClick={() => setSearchQuery('')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="button"
            className="mc-queue-toggle"
            onClick={toggleQueueDrawer}
            title={t('mediaCenter.queueAndPlaylists')}
          >
            {spectreIcons.list}
            {queue.length > 0 && <span className="mc-count-badge">{queue.length}</span>}
          </button>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────── */}
      <div className="mc-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`mc-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'live' && <span className="mc-live-dot" />}
            {tab.id === 'saved' && savedItems.length > 0 && (
              <span className="mc-count-badge">{savedItems.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Content ────────────────────────────── */}
      <div className="mc-content">
        {renderTabContent()}
      </div>

      {/* ── Overlays ───────────────────────────── */}
      {theaterOpen && activeVideo && (
        <Suspense fallback={null}><TheaterMode dayMode={dayMode} /></Suspense>
      )}
      {/* MiniPlayer + SpotifyDock mount in AppShell (see the note above). */}
      {queueDrawerOpen && (
        <Suspense fallback={null}><QueueDrawer open={queueDrawerOpen} dayMode={dayMode} /></Suspense>
      )}
      {shortsViewerOpen && (
        <Suspense fallback={null}>
          <ShortsViewer
            shorts={filtered}
            startIndex={shortsViewerIndex}
            dayMode={dayMode}
            onClose={() => setShortsViewerOpen(false)}
            onLoadMore={() => fetchMore('shorts')}
            hasMore={pagination.shorts?.hasMore}
          />
        </Suspense>
      )}
    </div>
  )
}

export default MediaCenterPage
