/**
 * ArticleCard - News card with OG thumbnail for the grid layout.
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

// memo: page polls fetchPrices every 30s -> parent re-renders, but article
// is stable. Only takes `article` (no callback props), so memo holds.
function ArticleCard({ article }) {
  const navigate = useNavigate()
  if (!article) return null

  const type = article.type || 'news'
  const headline = (article.headline || article.title || 'Untitled').replace(/\*\*/g, '')
  const isBreaking = article.isBreaking
  const isSpectre = !article.sourceArticle?.url || article.sourceArticle?.source === 'Spectre AI'
  const source = article.sourceArticle?.source || 'Spectre AI'

  return (
    <div
      className={`nr-card${isBreaking ? ' nr-card--breaking' : ''}${isSpectre ? ' nr-card--spectre' : ''}`}
      onClick={() => navigate(`/intelligence/${type}/${article.slug}`)}
    >
      <div className="nr-card__thumb">
        {article.ogImage ? (
          <img src={article.ogImage} alt={headline} loading="lazy" />
        ) : (
          <div className="nr-card__thumb-placeholder">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
        )}
      </div>
      <div className="nr-card__body">
        <div className="nr-card__labels">
          {isBreaking && (
            <span className="nr-card__label nr-card__label--breaking">BREAKING</span>
          )}
          {article.category && !isBreaking && (
            <span className="nr-card__label nr-card__label--category">{article.category}</span>
          )}
          {isSpectre && (
            <span className="nr-card__label nr-card__label--spectre">SPECTRE AI</span>
          )}
        </div>
        <h3 className="nr-card__headline">{headline}</h3>
        {article.summary && (
          <p className="nr-card__summary">{article.summary.replace(/[#*]/g, '')}</p>
        )}
        <div className="nr-card__meta">
          <span className="nr-card__source">{source}</span>
          <span>·</span>
          <span>{timeAgo(article.publishedAt)}</span>
          {article.sentiment && (
            <span className={`nr-card__sentiment nr-card__sentiment--${article.sentiment}`}>
              {article.sentiment === 'bullish' ? '▲' : article.sentiment === 'bearish' ? '▼' : '-'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(ArticleCard)
