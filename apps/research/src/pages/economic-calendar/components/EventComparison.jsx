/**
 * EventComparison — Dual-overlay SVG chart comparing two past releases.
 * Two polylines on same axes (warm white + blue).
 * Pill selectors for choosing which releases to compare.
 */

import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './EventComparison.css'

const W = 600
const H = 180
const PAD = { top: 20, right: 40, bottom: 28, left: 44 }
const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top - PAD.bottom

const COLOR_A = '#f5f5f7'
const COLOR_B = '#3B82F6'

function buildLine(points, xScale, yScale) {
  return points.map((p, i) => {
    const x = PAD.left + xScale(i)
    const y = PAD.top + yScale(p.value)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

const EventComparison = ({ history = [], onClose }) => {
  const { t } = useTranslation()
  const [idxA, setIdxA] = useState(0)
  const [idxB, setIdxB] = useState(Math.min(1, history.length - 1))

  const releaseA = history[idxA]
  const releaseB = history[idxB]

  const { pathA, pathB, yTicks, zeroY } = useMemo(() => {
    if (!releaseA || !releaseB) return { pathA: '', pathB: '', yTicks: [], zeroY: 0 }

    // Normalize: compute % change from each release's previous
    const normalize = (release) => {
      const base = release.previous || release.actual || 1
      return (release.history || [{ value: release.previous }, { value: release.actual }])
        .map(p => ({ value: ((p.value - base) / Math.abs(base)) * 100 }))
    }

    const ptsA = normalize(releaseA)
    const ptsB = normalize(releaseB)

    if (ptsA.length < 2 && ptsB.length < 2) return { pathA: '', pathB: '', yTicks: [], zeroY: 0 }

    const maxLen = Math.max(ptsA.length, ptsB.length)
    const allVals = [...ptsA.map(p => p.value), ...ptsB.map(p => p.value)]
    const minV = Math.min(...allVals, 0)
    const maxV = Math.max(...allVals, 0)
    const range = Math.max(maxV - minV, 0.5)

    const xScale = (i) => (i / Math.max(maxLen - 1, 1)) * CHART_W
    const yScale = (v) => ((maxV - v) / range) * CHART_H

    const ticks = [maxV, 0, minV].filter((v, i, arr) =>
      i === 0 || Math.abs(v - arr[i - 1]) > range * 0.2
    )

    return {
      pathA: buildLine(ptsA, xScale, yScale),
      pathB: buildLine(ptsB, xScale, yScale),
      yTicks: ticks.map(v => ({ v, y: PAD.top + yScale(v) })),
      zeroY: PAD.top + yScale(0),
    }
  }, [releaseA, releaseB])

  if (history.length < 2) return null

  return (
    <div className="event-compare">
      <div className="event-compare__header">
        <h4 className="event-compare__title">{t('economicCalendar.comparison.title', 'Compare Releases')}</h4>
        <button className="event-compare__close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="event-compare__selectors">
        <div className="event-compare__selector">
          <span className="event-compare__selector-dot" style={{ background: COLOR_A }} />
          <select
            value={idxA}
            onChange={(e) => setIdxA(Number(e.target.value))}
            className="event-compare__select"
          >
            {history.map((h, i) => (
              <option key={i} value={i}>{h.date} — {h.actual}</option>
            ))}
          </select>
        </div>
        <span className="event-compare__vs">{t('economicCalendar.comparison.vs', 'vs')}</span>
        <div className="event-compare__selector">
          <span className="event-compare__selector-dot" style={{ background: COLOR_B }} />
          <select
            value={idxB}
            onChange={(e) => setIdxB(Number(e.target.value))}
            className="event-compare__select"
          >
            {history.map((h, i) => (
              <option key={i} value={i}>{h.date} — {h.actual}</option>
            ))}
          </select>
        </div>
      </div>

      <svg className="event-compare__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
              stroke="currentColor" strokeOpacity={t.v === 0 ? 0.12 : 0.05} strokeWidth="0.5" />
            <text x={PAD.left - 6} y={t.y + 3} textAnchor="end" className="event-compare__label">
              {t.v > 0 ? '+' : ''}{t.v.toFixed(1)}%
            </text>
          </g>
        ))}

        {/* Zero line */}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY}
          stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" strokeDasharray="4 4" />

        {/* Release A */}
        {pathA && <path d={pathA} fill="none" stroke={COLOR_A} strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.8" />}

        {/* Release B */}
        {pathB && <path d={pathB} fill="none" stroke={COLOR_B} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="6 4" />}
      </svg>
    </div>
  )
}

export default EventComparison
