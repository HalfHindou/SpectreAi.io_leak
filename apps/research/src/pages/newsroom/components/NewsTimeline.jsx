/**
 * NewsTimeline - Left column: chronological live news feed (~250px).
 * Shows latest articles in compact rows with timestamps and sentiment dots.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import LatestArticleRow from './LatestArticleRow'

export default function NewsTimeline({ articles }) {
  // Stable slice so the page's 30s price poll doesn't re-slice every render.
  const timelineItems = useMemo(() => (articles || []).slice(0, 15), [articles])

  return (
    <aside className="nr-timeline">
      <div className="nr-timeline__header">
        <span className="nr-timeline__live-dot" />
        <span className="nr-timeline__title">LIVE FEED</span>
      </div>

      {timelineItems.length === 0 ? (
        <div className="nr-timeline__empty">
          Scanning news feeds...
        </div>
      ) : (
        <div className="nr-timeline__list">
          {timelineItems.map(a => (
            <LatestArticleRow key={a.slug} article={a} />
          ))}
        </div>
      )}

      <Link to="/intelligence?tab=news" className="nr-view-all">
        View All →
      </Link>
    </aside>
  )
}
