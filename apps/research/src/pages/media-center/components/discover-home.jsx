/**
 * DiscoverHome — the editorial Media landing (Rollup-style).
 * Featured hero + category chips + curated rails + All Content grid.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import FeaturedHero from './featured-hero'
import ContentRail from './content-rail'
import CategoryChips from './category-chips'
import EditorialCard from './editorial-card'
import PodcastCard from './podcast-card'
import MediaChatter from './media-chatter'
import SpotifyCard from './spotify-card'
import { SPOTIFY_PODCASTS } from './spotify-podcasts'
import { deriveCategories, flattenDiscover } from './media-format'

function sectionById(data, id) {
  return (data?.sections || []).find(s => s.id === id) || { items: [] }
}

function HomeSkeleton() {
  return (
    <div className="mcx-skel">
      <div className="mcx-skel-hero">
        <div className="mcx-skel-stage animate-shimmer" />
        <div className="mcx-skel-side">
          {[0, 1, 2].map(i => <div key={i} className="mcx-skel-side-row animate-shimmer" style={{ animationDelay: `${i * 0.08}s` }} />)}
        </div>
      </div>
      <div className="mcx-skel-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="mcx-skel-card">
            <div className="mcx-skel-thumb animate-shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
            <div className="mcx-skel-line animate-shimmer" />
            <div className="mcx-skel-line mcx-skel-line--sm animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  )
}

const DiscoverHome = ({ data, loading, onPlay, onToggleSave, onAddToQueue, isSaved }) => {
  const { t } = useTranslation()
  const [activeCategory, setActiveCategory] = useState('all')

  const allItems = useMemo(() => flattenDiscover(data), [data])
  const categories = useMemo(() => deriveCategories(allItems), [allItems])

  if (loading && !data) return <HomeSkeleton />
  if (!data || (!data.featured && allItems.length === 0)) {
    return (
      <div className="mcx-empty">
        <h3 className="mcx-empty-title">{t('mediaCenter.discover.emptyFeed')}</h3>
      </div>
    )
  }

  const newReleases = sectionById(data, 'new-releases').items
  const podcasts = sectionById(data, 'trending-podcasts').items
  const live = sectionById(data, 'live').items
  const allContent = sectionById(data, 'all').items.length ? sectionById(data, 'all').items : allItems

  /* Filtered view: one clean grid scoped to a single category */
  if (activeCategory !== 'all') {
    const filtered = allItems.filter(it => it.category === activeCategory)
    return (
      <div className="mcx-home">
        <CategoryChips categories={categories} active={activeCategory} onChange={setActiveCategory} />
        <div className="mcx-filter-head">
          <h2 className="mcx-section-title">{activeCategory}</h2>
          <button type="button" className="mcx-filter-clear" onClick={() => setActiveCategory('all')}>
            {t('mediaCenter.discover.clearFilter')}
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="mcx-empty"><h3 className="mcx-empty-title">{t('mediaCenter.empty.noCategory')}</h3></div>
        ) : (
          <div className="mcx-grid">
            {filtered.map((it, i) => (
              it.type === 'podcast'
                ? <PodcastCard key={it.id} item={it} variant="grid" index={i} isSaved={isSaved(it.id)} onPlay={onPlay} onToggleSave={onToggleSave} />
                : <EditorialCard key={it.id} item={it} variant="grid" index={i} isSaved={isSaved(it.id)} onPlay={onPlay} onToggleSave={onToggleSave} onAddToQueue={onAddToQueue} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mcx-home">
      <CategoryChips categories={categories} active={activeCategory} onChange={setActiveCategory} />

      <FeaturedHero
        item={data.featured}
        rotation={[data.featured, ...newReleases].filter(Boolean)}
        podcasts={SPOTIFY_PODCASTS}
        onPlay={onPlay}
        onToggleSave={onToggleSave}
        isSaved={isSaved}
      />

      <ContentRail title={t('mediaCenter.spotify.podcasts')} trackClass="mcx-rail-track--sp">
        {SPOTIFY_PODCASTS.map((s, i) => (
          <SpotifyCard key={s.id} show={s} variant="rail" index={i} />
        ))}
      </ContentRail>

      <MediaChatter />

      {newReleases.length > 0 && (
        <ContentRail title={t('mediaCenter.discover.newReleases')}>
          {newReleases.map((it, i) => (
            <EditorialCard key={it.id} item={it} variant="rail" index={i} isSaved={isSaved(it.id)} onPlay={onPlay} onToggleSave={onToggleSave} onAddToQueue={onAddToQueue} />
          ))}
        </ContentRail>
      )}

      {live.length > 0 && (
        <ContentRail title={t('mediaCenter.discover.liveNow')}>
          {live.map((it, i) => (
            <EditorialCard key={it.id} item={it} variant="rail" index={i} isSaved={isSaved(it.id)} onPlay={onPlay} onToggleSave={onToggleSave} onAddToQueue={onAddToQueue} />
          ))}
        </ContentRail>
      )}

      <section className="mcx-allcontent">
        <h2 className="mcx-section-title">{t('mediaCenter.discover.allContent')}</h2>
        <div className="mcx-grid">
          {allContent.map((it, i) => (
            it.type === 'podcast'
              ? <PodcastCard key={it.id} item={it} variant="grid" index={i} isSaved={isSaved(it.id)} onPlay={onPlay} onToggleSave={onToggleSave} />
              : <EditorialCard key={it.id} item={it} variant="grid" index={i} isSaved={isSaved(it.id)} onPlay={onPlay} onToggleSave={onToggleSave} onAddToQueue={onAddToQueue} />
          ))}
        </div>
      </section>
    </div>
  )
}

export default DiscoverHome
