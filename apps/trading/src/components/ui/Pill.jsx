/**
 * Pill — the foundational rounded control / tag / chip.
 *
 * Variants:
 *   - `ghost`  : transparent bg, hairline border, --text-2 → --text-1 on hover
 *   - `filled` : --glass-fill bg, --glass-border, --text-1
 *   - `lime`   : lime-tinted bg + border, lime text (the brand accent)
 *   - `mint`   : mint-tinted (use ONLY for buy / up semantic)
 *   - `coral`  : coral-tinted (use ONLY for sell / down semantic)
 *
 * Renders as `<button>` by default; pass `as="span"` for non-interactive
 * use (tags inside table cells, badges).
 */

import React from 'react'
import './Pill.css'

const Pill = React.forwardRef(function Pill(
  {
    variant = 'ghost',
    size = 'md',           // 'sm' | 'md' | 'lg'
    icon = null,           // leading icon element (e.g. <Search size={14} />)
    iconRight = null,      // trailing icon element
    active = false,        // forces active styling regardless of :hover
    as: Tag = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const cls = [
    'pill',
    `pill--${variant}`,
    `pill--${size}`,
    active && 'pill--active',
    icon || iconRight ? 'pill--has-icon' : '',
    className,
  ].filter(Boolean).join(' ')

  // type=button when used as a <button> to avoid form submissions
  const extraProps = Tag === 'button' && !rest.type ? { type: 'button' } : {}

  return (
    <Tag ref={ref} className={cls} {...extraProps} {...rest}>
      {icon && <span className="pill-icon">{icon}</span>}
      {children && <span className="pill-label">{children}</span>}
      {iconRight && <span className="pill-icon pill-icon--right">{iconRight}</span>}
    </Tag>
  )
})

export default Pill
