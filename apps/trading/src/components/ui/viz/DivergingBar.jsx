/**
 * DivergingBar — center-axis dual fill. Left grows mint, right grows
 * coral, split point is the net-pressure read. One instrument per
 * row replaces the three two-tone .dsb-progress bars in the flow
 * cluster. Also powers the market-pulse breadth strip above the
 * explorer.
 */
import React, { useMemo } from 'react'
import './DivergingBar.css'

function DivergingBar({
  left = 0,
  right = 0,
  labels,             // { left, right } strings under the bar
  height = 8,
  className = '',
}) {
  const total = useMemo(() => {
    const l = Number(left) || 0
    const r = Number(right) || 0
    return l + r
  }, [left, right])

  const leftPct = total > 0 ? ((Number(left) || 0) / total) * 100 : 50
  const rightPct = 100 - leftPct

  return (
    <div className={['dvb', className].filter(Boolean).join(' ')}>
      <div className="dvb-track" style={{ height }}>
        <div className="dvb-fill dvb-fill--left"  style={{ width: `${leftPct}%`  }} />
        <div className="dvb-fill dvb-fill--right" style={{ width: `${rightPct}%` }} />
      </div>
      {labels && (
        <div className="dvb-labels">
          <span className="dvb-label dvb-label--left">{labels.left}</span>
          <span className="dvb-label dvb-label--right">{labels.right}</span>
        </div>
      )}
    </div>
  )
}

export default React.memo(DivergingBar)
