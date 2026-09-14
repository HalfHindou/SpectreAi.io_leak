/**
 * VenturesFeaturedHero - Horizontal scroll row of featured project cards
 */
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import VenturesDealCard from './ventures-deal-card'
import InfoTip from '@/components/InfoTip'

const VenturesFeaturedHero = ({ projects, onProjectClick, dayMode, liveDataMap = {} }) => {
  const { t } = useTranslation()
  const scrollRef = useRef(null)

  const scroll = (direction) => {
    if (!scrollRef.current) return
    const amount = 400
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    })
  }

  if (!projects?.length) return null

  return (
    <section className="ventures-hero-section">
      <div className="ventures-hero-header">
        <div>
          <span className="ventures-hero-label">{t('ventures.curatedSelection')}</span>
          <h2 className="ventures-section-title">{t('ventures.featuredDeals')}<InfoTip text="Hand-curated selection of high-conviction projects. These are highlighted for their strong fundamentals, notable team, or significant smart money inflows." position="bottom" /></h2>
          <p className="ventures-section-subtitle">{t('ventures.featuredSubtitle')}</p>
        </div>
        <div className="ventures-hero-nav">
          <button
            className={`ventures-nav-btn ${dayMode ? 'day-mode' : ''}`}
            onClick={() => scroll('left')}
            aria-label={t('ventures.scrollLeft')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            className={`ventures-nav-btn ${dayMode ? 'day-mode' : ''}`}
            onClick={() => scroll('right')}
            aria-label={t('ventures.scrollRight')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
      <div className="ventures-hero-scroll" ref={scrollRef}>
        {projects.map((project, idx) => (
          <VenturesDealCard
            key={project.id}
            project={project}
            variant="featured"
            index={idx}
            onClick={onProjectClick}
            dayMode={dayMode}
            liveData={liveDataMap[project.coingeckoId] || null}
          />
        ))}
      </div>
    </section>
  )
}

export default VenturesFeaturedHero
