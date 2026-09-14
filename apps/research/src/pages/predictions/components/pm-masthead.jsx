/**
 * PmMasthead — the editorial band that leads the page. Title + canonical metric
 * (live aggregate open interest across both sources). Transparent, no card
 * chrome — this is breath, not a box.
 *
 * Headline + eyebrow swap by category (CATEGORY_COPY).
 */
import { CATEGORY_COPY } from './predictions-constants'
import './pm-masthead.css'

function PmMasthead({ category = 'trending', openInterest, marketCount, sources = [], fmtVol }) {
  const copy = CATEGORY_COPY[category] || CATEGORY_COPY.trending
  const sourceLabel = sources.length === 2
    ? 'Polymarket + Kalshi'
    : sources.length === 1
      ? (sources[0] === 'kalshi' ? 'Kalshi' : 'Polymarket')
      : 'Polymarket + Kalshi'

  return (
    <header className="pm-masthead animate-fade-up">
      <div className="pm-masthead__eyebrow-row">
        <span className="pm-masthead__eyebrow">{copy.eyebrow}</span>
        <span className="pm-masthead__live">
          <span className="pd-live-dot" />
          Live
        </span>
      </div>
      <h1 className="pm-masthead__title">{copy.headline}</h1>
      <p className="pm-masthead__metric">
        {openInterest != null && (
          <>
            <span className="pm-masthead__oi mono">{fmtVol ? fmtVol(openInterest) : openInterest}</span>
            <span className="pm-masthead__oi-label"> open interest</span>
          </>
        )}
        <span className="pm-masthead__dot">·</span>
        <span className="pm-masthead__sources">{sourceLabel}</span>
        {marketCount != null && (
          <>
            <span className="pm-masthead__dot">·</span>
            <span className="mono">{marketCount.toLocaleString('en-US')}</span>
            <span className="pm-masthead__oi-label"> markets</span>
          </>
        )}
      </p>
    </header>
  )
}

export default PmMasthead
