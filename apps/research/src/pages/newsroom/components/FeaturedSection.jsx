/**
 * FeaturedSection - Center column: hero article + top stories grid + latest list.
 * CoinDesk-style editorial layout with premium section dividers.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import HeroArticle from './HeroArticle'
import ArticleCard from './ArticleCard'
import LatestArticleRow from './LatestArticleRow'

export default function FeaturedSection({ articles, featured, dailyBrief }) {
  // Derive hero + grid + latest once per articles/featured change instead of
  // on every parent render (the page re-renders on the 30s price poll).
  const { heroArticle, gridArticles, latestArticles } = useMemo(() => {
    // Pick the hero article: first breaking > first featured > dailyBrief > first article
    const breaking = (articles || []).find(a => a.isBreaking)
    const hero = breaking || (featured && featured[0]) || dailyBrief || (articles && articles[0]) || null

    // Grid articles: featured minus hero, then remaining articles
    const heroSlug = hero?.slug
    const gridCandidates = [
      ...(featured || []).filter(a => a.slug !== heroSlug),
      ...(articles || []).filter(a => a.slug !== heroSlug && !(featured || []).some(f => f.slug === a.slug)),
    ]
    return {
      heroArticle: hero,
      gridArticles: gridCandidates.slice(0, 4),
      latestArticles: gridCandidates.slice(4, 14),
    }
  }, [articles, featured, dailyBrief])

  const hasContent = heroArticle || gridArticles.length > 0

  if (!hasContent) {
    return (
      <div className="nr-featured">
        <div className="nr-featured__empty">
          <div className="nr-featured__empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
              <path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>
            </svg>
          </div>
          <div className="nr-featured__empty-title">Newsroom Initializing</div>
          <div className="nr-featured__empty-desc">
            Spectre AI agents are scanning global news feeds. Articles will appear here as they are generated.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="nr-featured">
      {/* Hero */}
      {heroArticle && <HeroArticle article={heroArticle} />}

      {/* Top Stories Grid */}
      {gridArticles.length > 0 && (
        <>
          <div className="nr-section-header">
            <div className="nr-section-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Top Stories
            </div>
            <div className="nr-section-line" />
          </div>
          <div className="nr-grid">
            {gridArticles.map(a => (
              <ArticleCard key={a.slug} article={a} />
            ))}
          </div>
        </>
      )}

      {/* Latest */}
      {latestArticles.length > 0 && (
        <div className="nr-latest">
          <div className="nr-section-header">
            <div className="nr-section-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Latest
            </div>
            <div className="nr-section-line" />
          </div>
          {latestArticles.map(a => (
            <LatestArticleRow key={a.slug} article={a} />
          ))}
        </div>
      )}

      {/* View All */}
      <Link to="/intelligence?tab=news" className="nr-view-all">
        View All Intelligence
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </Link>
    </div>
  )
}
