/**
 * DataBarRow — row wrapper that paints a proportional left-anchored
 * background tint behind its children.
 *
 * The signature move of the Living Market List: every row carries a
 * horizontal lime tint proportional to its volume relative to the list
 * maximum, converting a table into a visual chart.
 */
import React from 'react'
import './DataBarRow.css'

function DataBarRow({
  value = 0,             // 0..1
  tint = 'lime',         // 'lime' | 'mint' | 'coral'
  className = '',
  children,
  as: Tag = 'div',
  style,
  ...rest
}) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100
  return (
    <Tag
      className={['data-bar-row', `data-bar-row--${tint}`, className]
        .filter(Boolean)
        .join(' ')}
      style={{ ...(style || {}), '--data-bar-fill': `${pct}%` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export default React.memo(DataBarRow)
