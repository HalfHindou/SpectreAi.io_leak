/**
 * HistoryChart Component
 * SVG line chart of historical release values with forecast reference line.
 * No external dependencies — pure SVG with hover tooltips via state.
 */

import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './HistoryChart.css'

/** Padding around the SVG content area */
const PADDING = { top: 16, right: 48, bottom: 28, left: 48 }

/**
 * Parse a numeric value from strings like "4.50%", "180K", "-68.5B", "3.2M".
 * Returns NaN if unparseable.
 */
function parseNumericValue(val) {
  if (val == null) return NaN
  if (typeof val === 'number') return val
  const str = String(val).replace(/[,$\s]/g, '')
  const match = str.match(/^([+-]?\d+\.?\d*)/)
  if (!match) return NaN
  return parseFloat(match[1])
}

/**
 * Format a date string to abbreviated form (e.g. "Jan '25").
 */
function formatAxisDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const month = d.toLocaleDateString('en-US', { month: 'short' })
    const year = String(d.getFullYear()).slice(2)
    return `${month} '${year}`
  } catch {
    return dateStr
  }
}

/**
 * Format a date string to a longer form for tooltip (e.g. "Jan 31, 2025").
 */
function formatTooltipDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

const HistoryChart = ({ history = [], forecast }) => {
  const { t } = useTranslation()
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const chartData = useMemo(() => {
    // Sort oldest first for chronological plotting
    const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date))

    // Extract numeric values from actual field
    const points = sorted
      .map((h) => ({
        date: h.date,
        value: parseNumericValue(h.actual),
        raw: h.actual,
      }))
      .filter((p) => !isNaN(p.value))

    if (points.length === 0) return null

    const forecastValue = parseNumericValue(forecast)
    const allValues = points.map((p) => p.value)
    if (!isNaN(forecastValue)) allValues.push(forecastValue)

    const minVal = Math.min(...allValues)
    const maxVal = Math.max(...allValues)
    const range = maxVal - minVal || 1

    return { points, forecastValue, minVal, maxVal, range }
  }, [history, forecast])

  if (!chartData || chartData.points.length < 2) {
    return (
      <div className="history-chart history-chart--empty">
        <span className="history-chart__empty-text">{t('economicCalendar.historyChart.empty', 'Not enough data to chart.')}</span>
      </div>
    )
  }

  const { points, forecastValue, minVal, maxVal, range } = chartData

  // SVG dimensions (we use viewBox for responsiveness)
  const svgWidth = 600
  const svgHeight = 180
  const plotW = svgWidth - PADDING.left - PADDING.right
  const plotH = svgHeight - PADDING.top - PADDING.bottom

  // Map data to SVG coordinates
  const mapX = (i) => PADDING.left + (i / (points.length - 1)) * plotW
  const mapY = (val) => PADDING.top + plotH - ((val - minVal) / range) * plotH

  // Build polyline path
  const linePath = points.map((p, i) => `${mapX(i)},${mapY(p.value)}`).join(' ')

  // Forecast line Y position
  const hasForecast = !isNaN(forecastValue)
  const forecastY = hasForecast ? mapY(forecastValue) : 0

  // X-axis labels: show first, last, and up to 3 middle labels
  const xLabelIndices = getAxisLabelIndices(points.length, 5)

  return (
    <div className="history-chart">
      <svg
        className="history-chart__svg"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Forecast dashed line */}
        {hasForecast && (
          <line
            x1={PADDING.left}
            y1={forecastY}
            x2={svgWidth - PADDING.right}
            y2={forecastY}
            className="history-chart__forecast-line"
          />
        )}

        {/* Forecast label */}
        {hasForecast && (
          <text
            x={svgWidth - PADDING.right + 6}
            y={forecastY + 4}
            className="history-chart__forecast-label"
          >
            {t('economicCalendar.fcst', 'Fcst')}
          </text>
        )}

        {/* Data line */}
        <polyline
          points={linePath}
          className="history-chart__line"
          fill="none"
        />

        {/* Data dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={mapX(i)}
            cy={mapY(p.value)}
            r={hoveredIndex === i ? 4.5 : 3}
            className={`history-chart__dot ${hoveredIndex === i ? 'history-chart__dot--active' : ''}`}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}

        {/* Y-axis: min and max labels */}
        <text
          x={PADDING.left - 8}
          y={PADDING.top + 4}
          className="history-chart__y-label"
          textAnchor="end"
        >
          {maxVal}
        </text>
        <text
          x={PADDING.left - 8}
          y={PADDING.top + plotH + 4}
          className="history-chart__y-label"
          textAnchor="end"
        >
          {minVal}
        </text>

        {/* X-axis labels */}
        {xLabelIndices.map((idx) => (
          <text
            key={idx}
            x={mapX(idx)}
            y={svgHeight - 4}
            className="history-chart__x-label"
            textAnchor="middle"
          >
            {formatAxisDate(points[idx].date)}
          </text>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div
          className="history-chart__tooltip"
          style={{
            left: `${(mapX(hoveredIndex) / svgWidth) * 100}%`,
            top: `${(mapY(points[hoveredIndex].value) / svgHeight) * 100 - 12}%`,
          }}
        >
          <span className="history-chart__tooltip-date">
            {formatTooltipDate(points[hoveredIndex].date)}
          </span>
          <span className="history-chart__tooltip-value">
            {points[hoveredIndex].raw}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Get evenly spaced indices for axis labels.
 */
function getAxisLabelIndices(total, maxLabels) {
  if (total <= maxLabels) {
    return Array.from({ length: total }, (_, i) => i)
  }
  const indices = [0]
  const step = (total - 1) / (maxLabels - 1)
  for (let i = 1; i < maxLabels - 1; i++) {
    indices.push(Math.round(step * i))
  }
  indices.push(total - 1)
  return indices
}

export default HistoryChart
