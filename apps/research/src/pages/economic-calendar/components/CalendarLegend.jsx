/**
 * CalendarLegend — states the grid's colour language in one line.
 *
 * The calendar carries two independent colour axes and nothing on screen said
 * so: TIER (how much a release can move crypto — the dots) and RESULT (which
 * side of consensus a print landed on — green/red on the value). Without this
 * a red dot next to a green number is a puzzle.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import './calendar-temporal.css'

const CalendarLegend = () => {
  const { t } = useTranslation()

  return (
    <div className="cal-legend">
      <span className="cal-legend__item">
        <span className="cal-legend__dot cal-legend__dot--critical" />
        {t('economicCalendar.impactCriticalUpper', 'CRITICAL')}
      </span>
      <span className="cal-legend__item">
        <span className="cal-legend__dot cal-legend__dot--high" />
        {t('economicCalendar.impactHighUpper', 'HIGH')}
      </span>
      <span className="cal-legend__item">
        <span className="cal-legend__dot cal-legend__dot--medium" />
        {t('economicCalendar.impactMediumUpper', 'MEDIUM')}
      </span>

      <span className="cal-legend__sep" aria-hidden="true" />

      <span className="cal-legend__item">
        <span className="cal-legend__swatch" />
        {t('economicCalendar.legendToday', 'Today')}
      </span>
      <span className="cal-legend__item">
        <span className="cal-legend__dot cal-legend__dot--past" />
        {t('economicCalendar.legendReleased', 'Released')}
      </span>

      <span className="cal-legend__sep" aria-hidden="true" />

      <span className="cal-legend__item">
        <span className="cal-result cal-result--beat">↑</span>
        {t('economicCalendar.legendAboveEst', 'Above est.')}
      </span>
      <span className="cal-legend__item">
        <span className="cal-result cal-result--miss">↓</span>
        {t('economicCalendar.legendBelowEst', 'Below est.')}
      </span>
    </div>
  )
}

export default React.memo(CalendarLegend)
