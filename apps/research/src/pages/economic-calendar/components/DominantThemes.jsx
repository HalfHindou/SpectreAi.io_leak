/**
 * DominantThemes Component
 * Renders 2-3 narrative cards showing the biggest stories driving markets this week.
 * Major themes in a 2-column grid, focus theme in a full-width row below.
 * Supports loading state with shimmer skeleton cards.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import ThemeCard from './ThemeCard'
import './DominantThemes.css'

/* ── Skeleton shimmer card ── */
const SkeletonCard = () => (
  <div className="dt-skeleton">
    <div className="dt-skeleton__line" style={{ width: '70%', height: 12 }} />
    <div className="dt-skeleton__line" style={{ width: '100%', height: 10, marginTop: 10 }} />
    <div className="dt-skeleton__line" style={{ width: '85%', height: 10, marginTop: 6 }} />
    <div className="dt-skeleton__line" style={{ width: '60%', height: 10, marginTop: 6 }} />
    <div className="dt-skeleton__tags">
      <div className="dt-skeleton__tag" />
      <div className="dt-skeleton__tag" />
      <div className="dt-skeleton__tag" />
    </div>
  </div>
)

const DominantThemes = ({ themes = [], loading }) => {
  const { t } = useTranslation()
  // Loading state: show skeleton cards
  if (loading) {
    return (
      <div className="dominant-themes">
        <div className="dominant-themes__label">{t('economicCalendar.dominantThemes', 'Dominant Themes')}</div>
        <div className="dominant-themes__grid">
          <div className="dominant-themes__card-wrap">
            <SkeletonCard />
          </div>
          <div className="dominant-themes__card-wrap">
            <SkeletonCard />
          </div>
        </div>
      </div>
    )
  }

  if (themes.length === 0) return null

  const majorThemes = themes.filter((t) => t.type === 'major')
  const focusThemes = themes.filter((t) => t.type === 'focus')

  return (
    <div className="dominant-themes">
      {/* Key Focus cards — full width, shown first */}
      {focusThemes.length > 0 && (
        <div className="dominant-themes__focus-section">
          {focusThemes.map((theme, i) => (
            <ThemeCard key={theme.id} theme={theme} variant="focus" />
          ))}
        </div>
      )}

      {/* Dominant theme cards — 2 column grid */}
      {majorThemes.length > 0 && (
        <>
          <div className="dominant-themes__label">{t('economicCalendar.dominantThemes', 'Dominant Themes')}</div>
          <div className="dominant-themes__grid">
            {majorThemes.map((theme, i) => (
              <div key={theme.id} className="dominant-themes__card-wrap" style={{ animationDelay: `${i * 80}ms` }}>
                <ThemeCard theme={theme} variant="major" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default DominantThemes
