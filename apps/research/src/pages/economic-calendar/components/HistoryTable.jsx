/**
 * HistoryTable Component
 * Release history data table in a glass card.
 * Shows date, previous, forecast, actual, deviation, and BTC move per release.
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './HistoryTable.css'

/**
 * Format deviation with +/- sign and coloring class.
 */
function getDeviationInfo(deviation) {
  if (deviation == null || deviation === '' || deviation === '--') {
    return { text: '--', className: '' }
  }
  const str = String(deviation)
  const num = parseFloat(str.replace(/[^0-9.\-+]/g, ''))
  if (isNaN(num)) return { text: str, className: '' }

  const sign = num > 0 ? '+' : ''
  const unit = str.replace(/^[+-]?\d+\.?\d*\s*/, '').trim()
  return {
    text: `${sign}${num}${unit}`,
    className: num > 0 ? 'history-table__value--bull' : num < 0 ? 'history-table__value--bear' : '',
  }
}

/**
 * Format BTC move with coloring class.
 */
function getBtcMoveInfo(btcMove) {
  if (btcMove == null || btcMove === '' || btcMove === '--') {
    return { text: '--', className: '' }
  }
  const str = String(btcMove)
  const num = parseFloat(str.replace(/[^0-9.\-+]/g, ''))
  if (isNaN(num)) return { text: str, className: '' }

  const sign = num > 0 ? '+' : ''
  return {
    text: `${sign}${num}%`,
    className: num > 0 ? 'history-table__value--bull' : num < 0 ? 'history-table__value--bear' : '',
  }
}

/**
 * Format a date string to abbreviated form (e.g. "Jan 31, 2025").
 */
function formatDate(dateStr) {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

const HistoryTable = ({ history = [] }) => {
  const { t } = useTranslation()
  const headers = [
    t('economicCalendar.historyTable.date', 'Date'),
    t('economicCalendar.historyTable.previous', 'Previous'),
    t('economicCalendar.historyTable.forecast', 'Forecast'),
    t('economicCalendar.historyTable.actual', 'Actual'),
    t('economicCalendar.historyTable.deviation', 'Deviation'),
    t('economicCalendar.historyTable.btcMove', 'BTC Move'),
  ]
  // Sort newest first — memoized so an unrelated parent re-render doesn't re-sort
  // the full (unbounded) history every time.
  const sorted = useMemo(() => (
    [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  ), [history])

  if (sorted.length === 0) {
    return (
      <div className="history-table history-table--empty">
        <span className="history-table__empty-text">{t('economicCalendar.historyTable.empty', 'No release history available.')}</span>
      </div>
    )
  }

  return (
    <div className="history-table">
      <table className="history-table__table">
        <thead>
          <tr className="history-table__header-row">
            {headers.map((h) => (
              <th key={h} className="history-table__header-cell">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const deviation = getDeviationInfo(row.deviation)
            const btcMove = getBtcMoveInfo(row.btcMove)

            return (
              <tr
                key={row.date || i}
                className={`history-table__row ${i % 2 === 1 ? 'history-table__row--striped' : ''}`}
              >
                <td className="history-table__cell history-table__cell--date">
                  {formatDate(row.date)}
                </td>
                <td className="history-table__cell">
                  {row.previous ?? '--'}
                </td>
                <td className="history-table__cell">
                  {row.forecast ?? '--'}
                </td>
                <td className="history-table__cell history-table__cell--actual">
                  {row.actual ?? '--'}
                </td>
                <td className={`history-table__cell ${deviation.className}`}>
                  {deviation.text}
                </td>
                <td className={`history-table__cell ${btcMove.className}`}>
                  {btcMove.text}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default HistoryTable
