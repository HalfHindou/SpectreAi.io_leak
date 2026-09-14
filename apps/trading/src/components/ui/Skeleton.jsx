/**
 * Skeleton — glass shimmer placeholder for loading states.
 *
 * Match the shape and size of the incoming content. Multiple lines via
 * `lines` prop. NEVER use a spinner; the brief is explicit on this.
 *
 * The shimmer sweep is faint-lime tinted so loading states still
 * announce "this is SPECTRE" rather than a generic gray bar.
 */

import React from 'react'
import './Skeleton.css'

function Skeleton({
  w = '100%',          // CSS width
  h = 16,              // CSS height (px or string)
  r,                   // border-radius override (defaults to var(--r-sm))
  lines = 1,           // when >1, renders a stack of bars with a slightly varied widths
  className = '',
  style = {},
}) {
  if (lines > 1) {
    return (
      <div className={`skeleton-stack ${className}`} aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className="skeleton skeleton--bar"
            style={{
              width: i === lines - 1 ? '62%' : '100%',
              height: typeof h === 'number' ? `${h}px` : h,
              borderRadius: r,
            }}
          />
        ))}
      </div>
    )
  }
  return (
    <span
      className={`skeleton ${className}`}
      style={{
        width: typeof w === 'number' ? `${w}px` : w,
        height: typeof h === 'number' ? `${h}px` : h,
        borderRadius: r,
        ...style,
      }}
      aria-hidden="true"
    />
  )
}

export default React.memo(Skeleton)
