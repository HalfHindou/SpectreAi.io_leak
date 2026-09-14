/**
 * DeltaChip — directional ± % chip with a soft glow halo.
 * Mint for up, coral for down. Used on every change cell.
 */
import React from 'react'
import './DeltaChip.css'

function DeltaChip({
  value,
  decimals = 2,
  size = 'md',         // 'sm' | 'md'
  showGlyph = true,
  className = '',
}) {
  if (value == null || isNaN(value)) return null
  const dir = value >= 0 ? 'up' : 'down'
  const num = Math.abs(value).toFixed(decimals)
  return (
    <span
      className={[
        'delta-chip',
        `delta-chip--${dir}`,
        `delta-chip--${size}`,
        className,
      ].filter(Boolean).join(' ')}
    >
      {showGlyph && (
        <span className="delta-chip-glyph" aria-hidden="true">
          {dir === 'up' ? '▲' : '▼'}
        </span>
      )}
      <span className="delta-chip-value">
        {value >= 0 ? '+' : '−'}{num}%
      </span>
    </span>
  )
}

export default React.memo(DeltaChip)
