/**
 * HeroArticle - Lead story with OG image as hero background.
 * Full-width image with gradient overlay and headline text.
 * Premium editorial design with clear source attribution.
 */
import { memo } from 'react'
import { useNavigate } from 'react-router-dom'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function SentimentPill({ sentiment }) {
  if (!sentiment) return null
  const icon = sentiment === 'bullish' ? '▲' : sentiment === 'bearish' ? '▼' : '-'
  return (
    <span className={`nr-hero__sentiment nr-hero__sentiment--${sentiment}`}>
      {icon} {sentiment}
    </span>
  )
}

// memo: re-rendered by the 30s price poll but only takes a stable `article`.
function HeroArticle({ article }) {
  const navigate = useNavigate()

  if (!article) return null

  const type = article.type || 'news'
  const headline = (article.headline || article.title || 'Untitled').replace(/\*\*/g, '')
  const hasImage = !!article.ogImage
  const isBreaking = article.isBreaking
  const isSpectre = !article.sourceArticle?.url || article.sourceArticle?.source === 'Spectre AI'
  const source = article.sourceArticle?.source || 'Spectre AI'

  // When we have an OG image, it already contains the headline - show just the image
  // with a thin metadata bar. When no image, show the full text overlay.
  return (
    <div
      className={`nr-hero${isBreaking ? ' nr-hero--breaking' : ''}${!hasImage ? ' nr-hero--no-image' : ''}`}
      onClick={() => navigate(`/intelligence/${type}/${article.slug}`)}
    >
      {hasImage ? (
        <>
          <img
            className="nr-hero__img"
            src={article.ogImage}
            alt={headline}
            loading="eager"
          />
          {/* Thin metadata bar below the OG image - no headline duplication */}
          <div className="nr-hero__bar">
            <div className="nr-hero__bar-left">
              {isBreaking && (
                <span className="nr-hero__badge nr-hero__badge--breaking">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>
                  BREAKING
                </span>
              )}
              {article.category && !isBreaking && (
                <span className="nr-hero__badge nr-hero__badge--category">
                  {article.category.toUpperCase()}
                </span>
              )}
              <span className="nr-hero__source">{source}</span>
              <span className="nr-hero__meta-sep">·</span>
              <span>{timeAgo(article.publishedAt)}</span>
              <SentimentPill sentiment={article.sentiment} />
            </div>
            <div className="nr-hero__bar-right">
              {article.tickers?.length > 0 && (
                <span className="nr-hero__tickers">{article.tickers.slice(0, 3).join(' · ')}</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="nr-hero__img nr-hero__img--fallback" />
          <div className="nr-hero__overlay">
            <div className="nr-hero__content">
              <div className="nr-hero__labels">
                {isBreaking && (
                  <span className="nr-hero__badge nr-hero__badge--breaking">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>
                    BREAKING
                  </span>
                )}
                {article.category && !isBreaking && (
                  <span className="nr-hero__badge nr-hero__badge--category">
                    {article.category.toUpperCase()}
                  </span>
                )}
                {isSpectre && (
                  <span className="nr-hero__badge nr-hero__badge--spectre">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    SPECTRE AI
                  </span>
                )}
              </div>
              <h2 className="nr-hero__headline">{headline}</h2>
              {article.summary && (
                <p className="nr-hero__summary">{article.summary.replace(/[#*]/g, '')}</p>
              )}
              <div className="nr-hero__meta">
                <span className="nr-hero__source">{source}</span>
                <span className="nr-hero__meta-sep">·</span>
                <span>{timeAgo(article.publishedAt)}</span>
                <SentimentPill sentiment={article.sentiment} />
                {article.tickers?.length > 0 && (
                  <span className="nr-hero__tickers">{article.tickers.slice(0, 3).join(' · ')}</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(HeroArticle)
