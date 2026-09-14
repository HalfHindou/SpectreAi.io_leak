/**
 * LatestArticleRow - Compact single-line row for the "Latest News" section.
 * Shows source badge for Spectre AI original articles.
 */
import { memo } from 'react'
import { useNavigate } from 'react-router-dom'

function formatTime(dateStr) {
  if (!dateStr) return '--:--'
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// memo: re-rendered by the 30s price poll but only takes a stable `article`.
function LatestArticleRow({ article }) {
  const navigate = useNavigate()
  if (!article) return null

  const type = article.type || 'news'
  const headline = (article.headline || article.title || 'Untitled').replace(/\*\*/g, '')
  const isSpectre = !article.sourceArticle?.url || article.sourceArticle?.source === 'Spectre AI'
  const source = article.sourceArticle?.source || 'Spectre AI'
  const sentimentClass = article.sentiment === 'bullish' ? 'nr-latest-row__dot--bullish'
    : article.sentiment === 'bearish' ? 'nr-latest-row__dot--bearish'
    : 'nr-latest-row__dot--neutral'

  return (
    <div
      className={`nr-latest-row${article.isBreaking ? ' nr-latest-row--breaking' : ''}${isSpectre ? ' nr-latest-row--spectre' : ''}`}
      onClick={() => navigate(`/intelligence/${type}/${article.slug}`)}
    >
      <span className="nr-latest-row__time">{formatTime(article.publishedAt)}</span>
      <span className={`nr-latest-row__dot ${sentimentClass}`} />
      <span className="nr-latest-row__headline">{headline}</span>
      <span className={`nr-latest-row__source${isSpectre ? ' nr-latest-row__source--spectre' : ''}`}>
        {isSpectre ? '✦ Spectre' : source}
      </span>
    </div>
  )
}

export default memo(LatestArticleRow)
