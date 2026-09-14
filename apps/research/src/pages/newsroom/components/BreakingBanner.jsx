import { Link } from 'react-router-dom'

export default function BreakingBanner({ articles }) {
  if (!articles || articles.length === 0) return null

  const latest = articles[0]

  return (
    <div className="breaking-banner">
      <span className="breaking-banner__label">BREAKING</span>
      <span className="breaking-banner__text">
        <Link to={`/intelligence/news/${latest.slug}`}>
          {latest.headline || latest.title}
        </Link>
      </span>
    </div>
  )
}
