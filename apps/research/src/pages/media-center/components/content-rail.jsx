/**
 * ContentRail — a titled, horizontally-scrolling rail with arrow controls.
 * Children are the cards (caller maps items -> cards).
 */
import { useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const Chevron = ({ dir }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
  </svg>
)

const ContentRail = ({ title, count, children, onViewAll, trackClass = '' }) => {
  const { t } = useTranslation()
  const trackRef = useRef(null)

  const scrollBy = useCallback((dir) => {
    const el = trackRef.current
    if (!el) return
    const amount = Math.round(el.clientWidth * 0.85) * (dir === 'left' ? -1 : 1)
    el.scrollBy({ left: amount, behavior: 'smooth' })
  }, [])

  return (
    <section className="mcx-rail">
      <header className="mcx-rail-head">
        <h2 className="mcx-rail-title">
          {title}
          {count != null && <span className="mcx-rail-count">{count}</span>}
        </h2>
        <div className="mcx-rail-tools">
          {onViewAll && (
            <button type="button" className="mcx-rail-viewall" onClick={onViewAll}>
              {t('mediaCenter.discover.viewAll')}
            </button>
          )}
          <div className="mcx-rail-arrows">
            <button type="button" className="mcx-rail-arrow" onClick={() => scrollBy('left')} aria-label={t('mediaCenter.discover.scrollLeft')}>
              <Chevron dir="left" />
            </button>
            <button type="button" className="mcx-rail-arrow" onClick={() => scrollBy('right')} aria-label={t('mediaCenter.discover.scrollRight')}>
              <Chevron dir="right" />
            </button>
          </div>
        </div>
      </header>
      <div className={`mcx-rail-track${trackClass ? ' ' + trackClass : ''}`} ref={trackRef}>
        {children}
      </div>
    </section>
  )
}

export default ContentRail
