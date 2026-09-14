import { Link } from 'react-router-dom'

export default function NewsroomHeader() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <header className="newsroom-header">
      <div className="newsroom-header__top">
        <Link to="/intelligence" className="newsroom-header__back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          Intelligence Hub
        </Link>
        <span className="newsroom-header__date">{dateStr.toUpperCase()}</span>
        <span className="newsroom-header__live">
          <span className="newsroom-header__live-dot" />
          LIVE
        </span>
      </div>
      <div className="newsroom-header__masthead">
        <h1 className="newsroom-header__title">
          SPECTRE <span className="newsroom-header__diamond">◆</span> NEWSROOM
        </h1>
        <div className="newsroom-header__tagline">
          <span>Real-Time Market Intelligence</span>
          <span className="newsroom-header__dot">·</span>
          <span>Market Analysis</span>
          <span className="newsroom-header__dot">·</span>
          <span>24/7 Coverage</span>
        </div>
      </div>
    </header>
  )
}
