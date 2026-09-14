/**
 * SkeletonLoaders — Shimmer placeholders for calendar views.
 * Reuses the mo-shimmer animation pattern from MarketOutlook.
 */

import React from 'react'
import './SkeletonLoaders.css'

const SkeletonLine = ({ width = '100%', height = 12, style }) => (
  <div
    className="ec-skeleton"
    style={{ width, height, borderRadius: 6, ...style }}
  />
)

/* ── DayView Skeleton ── */
const SkeletonEventCard = () => (
  <div className="ec-skeleton-event">
    <div className="ec-skeleton-event__top">
      <SkeletonLine width={48} height={18} style={{ borderRadius: 8 }} />
      <SkeletonLine width={60} height={10} />
    </div>
    <SkeletonLine width="75%" height={14} style={{ marginTop: 8 }} />
    <SkeletonLine width="50%" height={10} style={{ marginTop: 6 }} />
  </div>
)

const SkeletonDayView = () => (
  <div className="ec-skeleton-day">
    {[0, 1, 2].map((block) => (
      <div key={block} className="ec-skeleton-day__block">
        <SkeletonLine width={56} height={12} />
        <div className="ec-skeleton-day__cards">
          <SkeletonEventCard />
          {block < 2 && <SkeletonEventCard />}
        </div>
      </div>
    ))}
  </div>
)

/* ── WeekView Skeleton ── */
const SkeletonWeekView = () => (
  <div className="ec-skeleton-week">
    {Array.from({ length: 7 }, (_, i) => (
      <div key={i} className="ec-skeleton-week__col">
        <SkeletonLine width={40} height={10} style={{ margin: '0 auto' }} />
        <div className="ec-skeleton-week__cards">
          {i < 5 && (
            <>
              <SkeletonLine width="100%" height={56} style={{ borderRadius: 10 }} />
              {i % 2 === 0 && <SkeletonLine width="100%" height={56} style={{ borderRadius: 10 }} />}
            </>
          )}
        </div>
      </div>
    ))}
  </div>
)

/* ── MonthView Skeleton ── */
const SkeletonMonthView = () => (
  <div className="ec-skeleton-month">
    <div className="ec-skeleton-month__header">
      {Array.from({ length: 7 }, (_, i) => (
        <SkeletonLine key={i} width={28} height={10} style={{ margin: '0 auto' }} />
      ))}
    </div>
    <div className="ec-skeleton-month__grid">
      {Array.from({ length: 35 }, (_, i) => (
        <div key={i} className="ec-skeleton-month__cell">
          <SkeletonLine width={20} height={16} />
          {i % 3 === 0 && (
            <div className="ec-skeleton-month__dots">
              <SkeletonLine width={6} height={6} style={{ borderRadius: '50%' }} />
              <SkeletonLine width={6} height={6} style={{ borderRadius: '50%' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
)

export { SkeletonDayView, SkeletonWeekView, SkeletonMonthView }
