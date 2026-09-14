/**
 * MonthView Component
 * Traditional calendar grid: 7 columns (Mon-Sun), 4-6 rows.
 * Each cell: day number, impact dots (highest tier first), the day's top
 * market-movers by name, and the total event count.
 *
 * 2026-08-24: the dots were sliced in CHRONOLOGICAL order, so a day whose
 * critical print landed at 14:30 behind nine 09:00 auctions showed four grey
 * dots and hid the red one in the "+N" tail; and only 'critical' events were
 * ever named, so a day carrying the week's biggest event at 'high' — a Fed
 * speech, an ECB accounts release — read as an anonymous count.
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { isReleased, resultClass } from '../utils/eventResult'
import './calendar-temporal.css'
import './MonthView.css'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Append `unit` to `actual`. Pre-2026-05-26 the inline template
 * double-appended `%` when `actual` was already a stringified value like
 * "2.4%", giving "2.4%%". 2026-06-10: no longer defaults unitless numerics
 * to `%` — TradingView-sourced events are numeric and unit-explicit, so a
 * bare number (e.g. a confidence index at -14) means there IS no unit.
 */
function formatActualWithUnit(actual, unit) {
  if (actual == null || actual === '') return ''
  const str = String(actual).trim()
  // If the string already ends with %, $, k, M, B etc. or has letter unit, return as-is.
  if (/[%a-zA-Z$]$/.test(str)) return str
  if (unit) return `${str}${unit}`
  return str
}

/**
 * Get all calendar cells for a month view (includes prev/next month padding).
 * Returns 6-row grid of dates, each tagged with { date, isCurrentMonth }.
 */
function getMonthGrid(date) {
  const year = date.getFullYear()
  const month = date.getMonth()

  // First day of the month
  const firstDay = new Date(year, month, 1)
  // Day of week (0=Sun ... 6=Sat) -> adjust to Mon start (0=Mon ... 6=Sun)
  let startOffset = firstDay.getDay() - 1
  if (startOffset < 0) startOffset = 6

  // Total days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []

  // Previous month padding
  const prevMonthDays = new Date(year, month, 0).getDate()
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({
      date: new Date(year, month - 1, prevMonthDays - i),
      isCurrentMonth: false,
    })
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: new Date(year, month, d),
      isCurrentMonth: true,
    })
  }

  // Next month padding (fill to complete 6 rows = 42 cells, or minimum rows needed)
  const totalRows = Math.ceil(cells.length / 7)
  const targetCells = totalRows * 7
  let nextDay = 1
  while (cells.length < targetCells) {
    cells.push({
      date: new Date(year, month + 1, nextDay++),
      isCurrentMonth: false,
    })
  }

  return cells
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isToday(date) {
  return isSameDay(date, new Date())
}

// Cell ordering: what matters most first, ties by time of day.
const IMPACT_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

// A day's shape in one object: how many of each tier, and which tier leads it.
// This replaces the row of 6px dots, which read as dust at 42 cells and told
// you nothing about WEIGHT — four dots looked the same on a day with four
// events and a day with twenty-six.
function tierCounts(evts) {
  const c = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const e of evts) if (c[e.impact] !== undefined) c[e.impact] += 1
  const top = c.critical ? 'critical' : c.high ? 'high' : c.medium ? 'medium' : c.low ? 'low' : null
  return { ...c, top, weighted: c.critical * 3 + c.high * 2 + c.medium }
}
function byImpactThenTime(a, b) {
  const ra = IMPACT_RANK[a.impact] ?? 3
  const rb = IMPACT_RANK[b.impact] ?? 3
  if (ra !== rb) return ra - rb
  return new Date(a.dateTime || a.date || 0) - new Date(b.dateTime || b.date || 0)
}

function isPastDay(date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d < today
}

const MonthView = ({ events = [], currentDate = new Date(), onDayClick, compact = false }) => {
  const { t } = useTranslation()
  const dayHeaderLabels = [
    t('economicCalendar.dayMon', 'Mon'),
    t('economicCalendar.dayTue', 'Tue'),
    t('economicCalendar.dayWed', 'Wed'),
    t('economicCalendar.dayThu', 'Thu'),
    t('economicCalendar.dayFri', 'Fri'),
    t('economicCalendar.daySat', 'Sat'),
    t('economicCalendar.daySun', 'Sun'),
  ]
  const grid = useMemo(() => getMonthGrid(currentDate), [currentDate])

  // The next critical event still ahead of us. Exactly ONE cell on the board
  // breathes, and it's the one worth walking across the room for — a board
  // where everything pulses is a slot machine.
  const nextBigKey = useMemo(() => {
    const now = Date.now()
    let best = null
    for (const e of events) {
      if (e.impact !== 'critical') continue
      const t = new Date(e.dateTime || e.date || e.datetime)
      if (isNaN(t.getTime()) || t.getTime() < now) continue
      if (!best || t < best) best = t
    }
    return best ? `${best.getFullYear()}-${best.getMonth()}-${best.getDate()}` : null
  }, [events])

  // Map events to day lookup (key: "YYYY-MM-DD" -> events[])
  const eventsByDay = useMemo(() => {
    const map = {}
    events.forEach((event) => {
      const d = new Date(event.dateTime || event.date || event.datetime)
      if (isNaN(d.getTime())) return
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map[key]) map[key] = []
      map[key].push(event)
    })
    // Rank once per month, not once per cell render.
    for (const key of Object.keys(map)) map[key].sort(byImpactThenTime)
    return map
  }, [events])

  const getEventsForDate = (date) => {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    return eventsByDay[key] || []
  }

  return (
    <div className={`month-view${compact ? ' month-view--compact' : ''}`}>
      {/* Day headers */}
      <div className="month-view__header">
        {dayHeaderLabels.map((label, i) => (
          <div key={DAY_HEADERS[i]} className="month-view__header-cell">
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="month-view__grid">
        {grid.map((cell, i) => {
          const dayEvents = getEventsForDate(cell.date)
          const hasCritical = dayEvents.some((e) => e.impact === 'critical')
          const isTodayCell = isToday(cell.date)
          // The day's headline movers — critical first, then high. Naming only
          // 'critical' left days whose biggest event was a Fed speech or an
          // ECB accounts release showing a bare count.
          // TODAY names whatever it has, tier be damned: the one cell everyone
          // looks at should never be a blank card because its two events happen
          // to be medium.
          const headlineEvents = isTodayCell
            ? dayEvents
            : dayEvents.filter((e) => e.impact === 'critical' || e.impact === 'high')
          const isPast = isPastDay(cell.date) && !isTodayCell && cell.isCurrentMonth
          const tiers = tierCounts(dayEvents)
          const cellKey = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
          const isNextBig = !isPast && cellKey === nextBigKey

          return (
            <button
              key={i}
              className={[
                'month-view__cell',
                !cell.isCurrentMonth ? 'month-view__cell--other' : '',
                isTodayCell ? 'month-view__cell--today' : '',
                hasCritical ? 'month-view__cell--critical' : '',
                isPast ? 'month-view__cell--past' : '',
                tiers.top ? `month-view__cell--tier-${tiers.top}` : '',
                dayEvents.length === 0 ? 'month-view__cell--empty' : '',
                isNextBig ? 'month-view__cell--next' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onDayClick && onDayClick(cell.date)}
            >
              <span className="month-view__glow" aria-hidden="true" />
              {/* Day number */}
              <span className="month-view__day-number">{cell.date.getDate()}</span>
              {isTodayCell && (
                <span className="cal-today-chip month-view__today-chip">
                  {t('economicCalendar.todayShort', 'Today')}
                </span>
              )}



              {/* Headline event names + past results */}
              {headlineEvents.slice(0, compact ? 1 : 2).map((ce, j) => (
                <span
                  key={j}
                  className={`month-view__critical-name${ce.impact === 'high' ? ' month-view__critical-name--high' : ''}`}
                >
                  {ce.nameShort || ce.name}
                  {/* The print, tinted against consensus. Gated on `isPast`
                      before, so a release that landed EARLIER TODAY showed no
                      number on today's cell — the one cell everyone looks at. */}
                  {isReleased(ce) && (
                    <span className={`month-view__result cal-result${resultClass(ce)}`}>
                      {' '}{formatActualWithUnit(ce.actual, ce.unit)}
                    </span>
                  )}
                </span>
              ))}

              {/* Footer: the day's weight, then its size. The meter is a
                  proportional read of the tiers — a Friday carrying two
                  criticals and twenty mediums LOOKS different from a Tuesday
                  carrying three mediums, which four identical dots never did. */}
              {dayEvents.length > 0 && (
                <span className="month-view__foot">
                  <span className="month-view__meter" aria-hidden="true">
                    {tiers.critical > 0 && (
                      <span
                        className="month-view__meter-seg month-view__meter-seg--critical"
                        style={{ flexGrow: tiers.critical }}
                      />
                    )}
                    {tiers.high > 0 && (
                      <span
                        className="month-view__meter-seg month-view__meter-seg--high"
                        style={{ flexGrow: tiers.high }}
                      />
                    )}
                    {tiers.medium > 0 && (
                      <span
                        className="month-view__meter-seg month-view__meter-seg--medium"
                        style={{ flexGrow: tiers.medium }}
                      />
                    )}
                    {tiers.low > 0 && (
                      <span
                        className="month-view__meter-seg month-view__meter-seg--low"
                        style={{ flexGrow: tiers.low }}
                      />
                    )}
                  </span>
                  <span className="month-view__event-count">
                    {dayEvents.length}
                  </span>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default React.memo(MonthView)
