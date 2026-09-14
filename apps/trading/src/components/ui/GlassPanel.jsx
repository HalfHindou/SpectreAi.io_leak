/**
 * GlassPanel — the canonical card surface for the Obsidian & Lime system.
 *
 * Three variants:
 *   - `default`  : standard glass card. --glass-fill bg, hairline border,
 *                  top-edge highlight, --shadow-2 underneath.
 *   - `featured` : gradient-lime border ::before mask + stronger shadow.
 *                  Use sparingly — for the page hero (TokenBanner) and
 *                  the trade-panel primary moment only.
 *   - `inset`    : recessed feel, smaller shadow, for nested sub-cards.
 *
 * Renders an element with `position: relative` so descendants can absolute-
 * position freely. No data hooks. Forwards className + ...rest to the root.
 */

import React from 'react'
import './GlassPanel.css'

const GlassPanel = React.forwardRef(function GlassPanel(
  {
    variant = 'default',
    elevation = 2,        // 1 | 2 | 3 — controls shadow strength
    as: Tag = 'div',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const cls = [
    'glass-panel',
    `glass-panel--${variant}`,
    `glass-panel--e${elevation}`,
    className,
  ].filter(Boolean).join(' ')

  return (
    <Tag ref={ref} className={cls} {...rest}>
      {children}
    </Tag>
  )
})

export default GlassPanel
