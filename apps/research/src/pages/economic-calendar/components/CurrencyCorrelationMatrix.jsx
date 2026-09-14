/**
 * CurrencyCorrelationMatrix — 5x5 heatmap grid.
 * Cells colored red↔green by correlation coefficient.
 * Active row/col highlights for event's currency.
 */

import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getCorrelationMatrix, CURRENCIES } from '../data/correlationData'
import './CurrencyCorrelationMatrix.css'

function getColor(val) {
  if (val >= 0.8) return 'rgba(16, 185, 129, 0.5)'
  if (val >= 0.4) return 'rgba(16, 185, 129, 0.25)'
  if (val >= 0.1) return 'rgba(16, 185, 129, 0.1)'
  if (val > -0.1) return 'rgba(255, 255, 255, 0.04)'
  if (val > -0.4) return 'rgba(239, 68, 68, 0.1)'
  if (val > -0.8) return 'rgba(239, 68, 68, 0.25)'
  return 'rgba(239, 68, 68, 0.5)'
}

const CurrencyCorrelationMatrix = ({ category, activeCurrency }) => {
  const { t } = useTranslation()
  const [hover, setHover] = useState(null)
  const matrix = useMemo(() => getCorrelationMatrix(category), [category])
  const activeIdx = CURRENCIES.indexOf(activeCurrency)

  return (
    <div className="corr-matrix">
      <h4 className="corr-matrix__title">{t('economicCalendar.correlationMatrix.title', 'Currency Correlations')}</h4>
      {category && <span className="corr-matrix__category">{category}</span>}

      <div className="corr-matrix__grid">
        {/* Header row */}
        <div className="corr-matrix__cell corr-matrix__cell--empty" />
        {CURRENCIES.map((c, i) => (
          <div key={c} className={`corr-matrix__cell corr-matrix__cell--header${i === activeIdx ? ' corr-matrix__cell--active' : ''}`}>
            {c}
          </div>
        ))}

        {/* Data rows */}
        {matrix.map((row, ri) => (
          <React.Fragment key={ri}>
            <div className={`corr-matrix__cell corr-matrix__cell--header${ri === activeIdx ? ' corr-matrix__cell--active' : ''}`}>
              {CURRENCIES[ri]}
            </div>
            {row.map((val, ci) => {
              const isActive = ri === activeIdx || ci === activeIdx
              const isHovered = hover && (hover.r === ri && hover.c === ci)
              return (
                <div
                  key={ci}
                  className={`corr-matrix__cell corr-matrix__cell--data${isActive ? ' corr-matrix__cell--highlight' : ''}${isHovered ? ' corr-matrix__cell--hovered' : ''}`}
                  style={{ background: getColor(val) }}
                  onMouseEnter={() => setHover({ r: ri, c: ci, val })}
                  onMouseLeave={() => setHover(null)}
                  title={`${CURRENCIES[ri]}/${CURRENCIES[ci]}: ${val.toFixed(2)}`}
                >
                  {ri === ci ? '\u2014' : val.toFixed(2)}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>

      {hover && (
        <div className="corr-matrix__tooltip">
          {CURRENCIES[hover.r]}/{CURRENCIES[hover.c]}: <strong>{hover.val.toFixed(2)}</strong>
        </div>
      )}
    </div>
  )
}

export default CurrencyCorrelationMatrix
