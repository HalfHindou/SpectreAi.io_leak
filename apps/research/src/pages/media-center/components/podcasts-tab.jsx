/**
 * PodcastsTab — the listening surface of the AI Media Center.
 *
 * This tab used to render eleven Spotify embed cards and nothing else: the
 * curated EPISODE feed was fetched on every visit (`fetchTab('podcasts')`) and
 * then thrown away unrendered, which is why the tab looked bare. It now leads
 * with what you were listening to, then the freshest episode, then the shows,
 * then the full feed.
 *
 * Every episode row plays through the app-wide player (useMediaStore.playPodcast),
 * so audio follows you out of this page.
 */
import { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useMediaStore from '@/store/useMediaStore'
import ContentRail from './content-rail'
import SpotifyCard from './spotify-card'
import { SPOTIFY_PODCASTS } from './spotify-podcasts'
import { fmtEpLength, fmtDuration, relTime, deriveCategories } from './media-format'
import './podcasts-tab.css'

const IconPlay = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><path d="M8 5.14v14l11-7-11-7z" /></svg>
)

const IconPause = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
)

const IconCaptions = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M9 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" />
  </svg>
)

const IconQueue = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h11M4 12h11M4 17h7M17 14v6M20 17h-6" />
  </svg>
)

/* ── Episode card ────────────────────────────────────────── */

function EpisodeCard({ ep, index, playing, active, progress, onPlay, onQueue, t, variant = 'grid' }) {
  const mins = fmtEpLength(ep.duration)
  const when = relTime(ep.publishedAt, t)
  return (
    <article className={`mcp-ep mcp-ep--${variant}${active ? ' is-active' : ''}`} style={{ '--i': index }}>
      <button
        type="button"
        className="mcp-ep-art"
        onClick={() => onPlay(ep)}
        aria-label={t('mediaCenter.podcasts.playAria', { title: ep.title })}
      >
        {ep.thumbnail
          ? <img src={ep.thumbnail} alt="" loading="lazy" />
          : <span className="mcp-ph">{(ep.channel?.name || '?').charAt(0)}</span>}
        <span className="mcp-ep-scrim" aria-hidden="true" />
        <span className="mcp-ep-play">{active && playing ? <IconPause size={18} /> : <IconPlay size={18} />}</span>
        {progress > 0 && (
          <span className="mcp-ep-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></span>
        )}
      </button>
      <div className="mcp-ep-body">
        <span className="mcp-ep-show">{ep.channel?.name}</span>
        <h3 className="mcp-ep-title" title={ep.title}>{ep.title}</h3>
        <div className="mcp-ep-meta">
          {mins && <span>{mins}</span>}
          {mins && when && <span className="mcp-dot" aria-hidden="true">·</span>}
          {when && <span>{when}</span>}
          {ep.hasTranscript && (
            <span className="mcp-cap-badge" title={t('mediaCenter.podcasts.captionsTip')}>
              <IconCaptions />{t('mediaCenter.podcasts.cc')}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="mcp-ep-queue"
        onClick={(e) => { e.stopPropagation(); onQueue(ep) }}
        title={t('mediaCenter.podcasts.addToQueue')}
      >
        <IconQueue />
      </button>
    </article>
  )
}

/* ── Show tile (derived from the live feed, not a hardcoded id list) ── */

function ShowTile({ show, onPlay, t }) {
  return (
    <button type="button" className="mcp-show" onClick={() => onPlay(show.latest, show.episodes)}>
      <span className="mcp-show-art">
        {show.avatar
          ? <img src={show.avatar} alt="" loading="lazy" />
          : <span className="mcp-ph">{show.name.charAt(0)}</span>}
        <span className="mcp-show-play"><IconPlay size={16} /></span>
      </span>
      <span className="mcp-show-name">{show.name}</span>
      <span className="mcp-show-meta">
        {t('mediaCenter.podcasts.episodeCount', { count: show.episodes.length })}
        {show.latest?.publishedAt && <> · {relTime(show.latest.publishedAt, t)}</>}
      </span>
    </button>
  )
}

/* ── Main ────────────────────────────────────────────────── */

const PodcastsTab = ({ items = [], loading, error, lastRefreshed, onRefresh, searchQuery = '', t }) => {
  const { t: tt } = useTranslation()
  const T = t || tt
  const [category, setCategory] = useState('all')

  const playPodcast = useMediaStore(s => s.playPodcast)
  const enqueue = useMediaStore(s => s.enqueuePodcast)
  const togglePlay = useMediaStore(s => s.togglePodcastPlay)
  const current = useMediaStore(s => s.podcastEpisode)
  const playing = useMediaStore(s => s.podcastPlaying)
  const resume = useMediaStore(s => s.podcastResume)

  /* Only episodes we can actually play belong on a listening surface. */
  const playable = useMemo(() => items.filter(e => e?.audioUrl), [items])

  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return playable
    return playable.filter(e =>
      e.title?.toLowerCase().includes(q)
      || e.channel?.name?.toLowerCase().includes(q)
      || e.description?.toLowerCase().includes(q)
      || e.tags?.some(tag => tag.toLowerCase().includes(q)),
    )
  }, [playable, searchQuery])

  const categories = useMemo(() => deriveCategories(searched), [searched])
  const filtered = useMemo(
    () => (category === 'all' ? searched : searched.filter(e => e.category === category)),
    [searched, category],
  )

  /* Shows, derived from the feed itself — grows as the feed grows, and can
     never point at a show id that has gone stale. */
  const shows = useMemo(() => {
    const byShow = new Map()
    for (const ep of playable) {
      const key = ep.feedId || ep.channel?.name
      if (!key) continue
      if (!byShow.has(key)) {
        byShow.set(key, { key, name: ep.channel?.name || '', avatar: ep.channel?.avatar || ep.thumbnail, episodes: [] })
      }
      byShow.get(key).episodes.push(ep)
    }
    return [...byShow.values()]
      .map(s => ({ ...s, latest: s.episodes[0] }))
      .sort((a, b) => new Date(b.latest?.publishedAt || 0) - new Date(a.latest?.publishedAt || 0))
  }, [playable])

  /* Continue listening — anything with a stored position, newest first. */
  const continueList = useMemo(() => {
    const rows = []
    for (const ep of playable) {
      const r = resume[ep.id]
      if (r?.t > 15) rows.push({ ep, at: r.at || 0, progress: r.d ? Math.min(1, r.t / r.d) : 0, left: r.d ? r.d - r.t : 0 })
    }
    return rows.sort((a, b) => b.at - a.at).slice(0, 12)
  }, [playable, resume])

  const featured = filtered[0] || null
  const rest = featured ? filtered.slice(1) : filtered

  const handlePlay = useCallback((ep, list) => {
    if (!ep) return
    // Tapping the episode that is already loaded toggles it instead of
    // restarting from the resume point.
    if (current?.id === ep.id) { togglePlay(); return }
    playPodcast(ep, list || filtered)
  }, [current?.id, togglePlay, playPodcast, filtered])

  const progressOf = useCallback((ep) => {
    const r = resume[ep.id]
    return r?.d ? Math.min(1, r.t / r.d) : 0
  }, [resume])

  /* ── Loading ── */
  if (loading && !playable.length) {
    return (
      <div className="mcp">
        <div className="mcp-hero mcp-hero--skel">
          <div className="mcp-skel mcp-skel--art animate-shimmer" />
          <div className="mcp-skel-lines">
            <div className="mcp-skel animate-shimmer" style={{ width: '30%' }} />
            <div className="mcp-skel animate-shimmer" style={{ width: '80%', height: 22 }} />
            <div className="mcp-skel animate-shimmer" style={{ width: '55%' }} />
          </div>
        </div>
        <div className="mcp-grid">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="mcp-skel mcp-skel--card animate-shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mcp">
      {/* ── Continue listening ───────────────────────── */}
      {continueList.length > 0 && (
        <ContentRail title={T('mediaCenter.podcasts.continue')} count={continueList.length} trackClass="mcp-rail-track">
          {continueList.map(({ ep, progress, left }, i) => (
            <div key={`cont-${ep.id}`} className="mcp-cont">
              <EpisodeCard
                ep={ep}
                index={i}
                variant="rail"
                playing={playing}
                active={current?.id === ep.id}
                progress={progress}
                onPlay={(e) => handlePlay(e, continueList.map(c => c.ep))}
                onQueue={enqueue}
                t={T}
              />
              {left > 60 && (
                <span className="mcp-cont-left">{T('mediaCenter.podcasts.leftToGo', { time: fmtDuration(left) })}</span>
              )}
            </div>
          ))}
        </ContentRail>
      )}

      {/* ── Featured episode ─────────────────────────── */}
      {featured && (
        <section className="mcp-hero">
          <button
            type="button"
            className="mcp-hero-art"
            onClick={() => handlePlay(featured)}
            aria-label={T('mediaCenter.podcasts.playAria', { title: featured.title })}
          >
            {featured.thumbnail
              ? <img src={featured.thumbnail} alt="" />
              : <span className="mcp-ph">{(featured.channel?.name || '?').charAt(0)}</span>}
            <span className="mcp-hero-play">
              {current?.id === featured.id && playing ? <IconPause size={22} /> : <IconPlay size={22} />}
            </span>
          </button>
          <div className="mcp-hero-body">
            <span className="mcp-hero-eyebrow">{T('mediaCenter.podcasts.latestDrop')}</span>
            <h2 className="mcp-hero-title">{featured.title}</h2>
            <p className="mcp-hero-show">{featured.channel?.name}</p>
            {featured.description && <p className="mcp-hero-desc">{featured.description}</p>}
            <div className="mcp-hero-meta">
              {featured.duration ? <span className="mcp-pill">{fmtEpLength(featured.duration)}</span> : null}
              {featured.publishedAt && <span className="mcp-pill">{relTime(featured.publishedAt, T)}</span>}
              {featured.category && <span className="mcp-pill">{featured.category}</span>}
              {featured.hasTranscript && (
                <span className="mcp-pill mcp-pill--cap"><IconCaptions />{T('mediaCenter.podcasts.liveCaptions')}</span>
              )}
            </div>
            <div className="mcp-hero-actions">
              <button type="button" className="mcp-btn" onClick={() => handlePlay(featured)}>
                {current?.id === featured.id && playing ? <IconPause /> : <IconPlay />}
                {current?.id === featured.id && playing
                  ? T('mediaCenter.podcasts.pause')
                  : (resume[featured.id]?.t > 15 ? T('mediaCenter.podcasts.resume') : T('mediaCenter.podcasts.listen'))}
              </button>
              <button type="button" className="mcp-btn mcp-btn--ghost" onClick={() => enqueue(featured)}>
                <IconQueue />{T('mediaCenter.podcasts.queue')}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Shows from the live feed ─────────────────── */}
      {shows.length > 1 && (
        <ContentRail title={T('mediaCenter.podcasts.shows')} count={shows.length} trackClass="mcp-rail-track">
          {shows.map(show => (
            <ShowTile key={show.key} show={show} onPlay={handlePlay} t={T} />
          ))}
        </ContentRail>
      )}

      {/* ── Featured Spotify shows (full-episode embeds) ── */}
      <ContentRail title={T('mediaCenter.podcasts.featuredShows')} count={SPOTIFY_PODCASTS.length} trackClass="mcp-rail-track">
        {SPOTIFY_PODCASTS.map((show, i) => (
          <SpotifyCard key={show.id} show={show} variant="grid" index={i} />
        ))}
      </ContentRail>

      {/* ── The full feed ────────────────────────────── */}
      <section className="mcp-feed">
        <header className="mcp-feed-head">
          <h2 className="mcp-feed-title">
            {T('mediaCenter.podcasts.allEpisodes')}
            <span className="mcp-feed-count">{filtered.length}</span>
          </h2>
          {onRefresh && (
            <button type="button" className="mcp-btn mcp-btn--ghost mcp-btn--sm" onClick={onRefresh} disabled={loading}>
              {T('mediaCenter.refresh')}
            </button>
          )}
        </header>

        {categories.length > 1 && (
          <div className="mcp-chips" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={category === 'all'}
              className={`mcp-chip${category === 'all' ? ' is-active' : ''}`}
              onClick={() => setCategory('all')}
            >
              {T('mediaCenter.categories.all')}
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={category === cat}
                className={`mcp-chip${category === cat ? ' is-active' : ''}`}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {error ? (
          <div className="mcp-empty">
            <p className="mcp-empty-title">{error}</p>
            {onRefresh && <button type="button" className="mcp-btn" onClick={onRefresh}>{T('mediaCenter.tryAgain')}</button>}
          </div>
        ) : rest.length === 0 ? (
          <div className="mcp-empty">
            <p className="mcp-empty-title">
              {searchQuery.trim() ? T('mediaCenter.empty.noResults') : T('mediaCenter.podcasts.empty')}
            </p>
          </div>
        ) : (
          <div className="mcp-grid">
            {rest.map((ep, i) => (
              <EpisodeCard
                key={ep.id}
                ep={ep}
                index={i}
                playing={playing}
                active={current?.id === ep.id}
                progress={progressOf(ep)}
                onPlay={handlePlay}
                onQueue={enqueue}
                t={T}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default PodcastsTab
