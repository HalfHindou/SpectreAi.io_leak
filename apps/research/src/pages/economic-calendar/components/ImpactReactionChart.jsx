/**
 * ImpactReactionChart — SVG chart showing BTC/SPY reactions
 * to past releases of this event type.
 * X: time relative to release (-1h to +24h)
 * Y: % change
 * BTC orange (#F7931A), SPY blue (#3B82F6)
 */

import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getReactionData } from '../data/impactHistory'
import './ImpactReactionChart.css'

const W = 720
const H = 200
const PAD = { top: 20, right: 50, bottom: 32, left: 48 }
const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top - PAD.bottom

const BTC_COLOR = '#F7931A'
const SPY_COLOR = '#3B82F6'

function formatMinutes(m) {
  if (m === 0) return '0'
  if (m < 0) return `${m}m`
  if (m < 60) return `+${m}m`
  if (m < 1440) return `+${m / 60}h`
  return `+${m / 1440}d`
}

function buildPath(points, xScale, yScale, key) {
  return points.map((p, i) => {
    const x = PAD.left + xScale(p.m)
    const y = PAD.top + yScale(p[key])
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

const ImpactReactionChart = ({ eventName }) => {
  const { t } = useTranslation()
  const [scenario, setScenario] = useState('beat')
  const data = useMemo(() => getReactionData(eventName), [eventName])

  if (!data) return null

  const points = data[scenario] || []
  if (points.length < 2) return null

  // Compute scales
  const minM = Math.min(...points.map(p => p.m))
  const maxM = Math.max(...points.map(p => p.m))
  const allVals = points.flatMap(p => [p.btc, p.spy])
  const minVal = Math.min(...allVals, 0)
  const maxVal = Math.max(...allVals, 0)
  const range = Math.max(maxVal - minVal, 0.5)

  const xScale = (m) => ((m - minM) / (maxM - minM)) * CHART_W
  const yScale = (v) => ((maxVal - v) / range) * CHART_H

  const btcPath = buildPath(points, xScale, yScale, 'btc')
  const spyPath = buildPath(points, xScale, yScale, 'spy')

  // Zero line
  const zeroY = PAD.top + yScale(0)

  // X-axis labels (subset)
  const labelIndices = [0, Math.floor(points.length * 0.3), Math.floor(points.length * 0.6), points.length - 1]
  const xLabels = [...new Set(labelIndices)].map(i => points[i])

  // Y-axis labels
  const yTicks = [maxVal, maxVal / 2, 0, minVal / 2, minVal].filter((v, i, arr) => {
    if (i === 0) return true
    return Math.abs(v - arr[i-1]) > range * 0.15
  })

  return (
    <div className="impact-chart">
      <div className="impact-chart__header">
        <h4 className="impact-chart__title">{t('economicCalendar.reactionChart.title', 'Market Reaction')}</h4>
        <div className="impact-chart__legend">
          <span className="impact-chart__legend-item">
            <span className="impact-chart__legend-dot" style={{ background: BTC_COLOR }} />
            BTC
          </span>
          <span className="impact-chart__legend-item">
            <span className="impact-chart__legend-dot" style={{ background: SPY_COLOR }} />
            SPY
          </span>
        </div>
      </div>

      <div className="impact-chart__tabs">
        <button
          className={`impact-chart__tab${scenario === 'beat' ? ' impact-chart__tab--active' : ''}`}
          onClick={() => setScenario('beat')}
        >
          {t('economicCalendar.reactionChart.beatTab', 'Beat Forecast')}
        </button>
        <button
          className={`impact-chart__tab${scenario === 'miss' ? ' impact-chart__tab--active' : ''}`}
          onClick={() => setScenario('miss')}
        >
          {t('economicCalendar.reactionChart.missTab', 'Miss Forecast')}
        </button>
      </div>

      <svg className="impact-chart__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yTicks.map((v, i) => {
          const y = PAD.top + yScale(v)
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
                stroke="currentColor" strokeOpacity={v === 0 ? 0.15 : 0.06} strokeWidth="0.5" />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end"
                className="impact-chart__y-label">
                {v > 0 ? '+' : ''}{v.toFixed(1)}%
              </text>
            </g>
          )
        })}

        {/* Release marker */}
        <line x1={PAD.left + xScale(0)} x2={PAD.left + xScale(0)}
          y1={PAD.top} y2={H - PAD.bottom}
          stroke="currentColor" strokeOpacity="0.2" strokeWidth="0.5" strokeDasharray="4 4" />
        <text x={PAD.left + xScale(0)} y={H - PAD.bottom + 14}
          textAnchor="middle" className="impact-chart__x-label" style={{ fontWeight: 600 }}>
          {t('economicCalendar.reactionChart.release', 'RELEASE')}
        </text>

        {/* X labels */}
        {xLabels.map((p, i) => {
          if (p.m === 0) return null
          return (
            <text key={i} x={PAD.left + xScale(p.m)} y={H - PAD.bottom + 14}
              textAnchor="middle" className="impact-chart__x-label">
              {formatMinutes(p.m)}
            </text>
          )
        })}

        {/* BTC area fill */}
        <path
          d={`${btcPath} L${(PAD.left + xScale(points[points.length-1].m)).toFixed(1)},${zeroY.toFixed(1)} L${(PAD.left + xScale(points[0].m)).toFixed(1)},${zeroY.toFixed(1)} Z`}
          fill={BTC_COLOR} fillOpacity="0.06"
        />

        {/* SPY area fill */}
        <path
          d={`${spyPath} L${(PAD.left + xScale(points[points.length-1].m)).toFixed(1)},${zeroY.toFixed(1)} L${(PAD.left + xScale(points[0].m)).toFixed(1)},${zeroY.toFixed(1)} Z`}
          fill={SPY_COLOR} fillOpacity="0.06"
        />

        {/* BTC line */}
        <path d={btcPath} fill="none" stroke={BTC_COLOR} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* SPY line */}
        <path d={spyPath} fill="none" stroke={SPY_COLOR} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 4" />

        {/* End value labels */}
        {points.length > 0 && (
          <>
            <text
              x={PAD.left + xScale(points[points.length-1].m) + 4}
              y={PAD.top + yScale(points[points.length-1].btc) + 3}
              className="impact-chart__end-label" fill={BTC_COLOR}
            >
              {points[points.length-1].btc > 0 ? '+' : ''}{points[points.length-1].btc.toFixed(1)}%
            </text>
            <text
              x={PAD.left + xScale(points[points.length-1].m) + 4}
              y={PAD.top + yScale(points[points.length-1].spy) + 3}
              className="impact-chart__end-label" fill={SPY_COLOR}
            >
              {points[points.length-1].spy > 0 ? '+' : ''}{points[points.length-1].spy.toFixed(1)}%
            </text>
          </>
        )}
      </svg>

      <p className="impact-chart__note">
        {t('economicCalendar.reactionChart.note', 'Average {{label}} reaction based on last 8 releases', { label: data.label })}
      </p>
    </div>
  )
}

export default ImpactReactionChart
