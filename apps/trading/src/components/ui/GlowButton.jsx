/**
 * GlowButton — the page's primary action.
 *
 * Three variants:
 *   - `primary`  : lime fill + --glow-lime halo. THE loudest moment. Use
 *                  for ONE CTA per context (Sign In, Buy, Sell).
 *   - `secondary`: ghost glass pill with stronger border. Used next to
 *                  primary as the secondary option (Discover More, Cancel).
 *   - `ghost`    : transparent until hover. Used for tertiary actions.
 *
 * Spring depress on press, glow flare on focus, optional loading spinner.
 */

import React from 'react'
import './GlowButton.css'

const GlowButton = React.forwardRef(function GlowButton(
  {
    variant = 'primary',
    size = 'md',          // 'sm' | 'md' | 'lg'
    icon = null,
    iconRight = null,
    loading = false,
    disabled = false,
    fullWidth = false,
    as: Tag = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const cls = [
    'glow-btn',
    `glow-btn--${variant}`,
    `glow-btn--${size}`,
    fullWidth && 'glow-btn--full',
    loading && 'glow-btn--loading',
    className,
  ].filter(Boolean).join(' ')

  const extraProps = Tag === 'button'
    ? { type: rest.type || 'button', disabled: disabled || loading }
    : { 'aria-disabled': disabled || loading }

  return (
    <Tag ref={ref} className={cls} {...extraProps} {...rest}>
      {loading && <span className="glow-btn-spinner" aria-hidden="true" />}
      {!loading && icon && <span className="glow-btn-icon">{icon}</span>}
      {children && <span className="glow-btn-label">{children}</span>}
      {!loading && iconRight && (
        <span className="glow-btn-icon glow-btn-icon--right">{iconRight}</span>
      )}
    </Tag>
  )
})

export default GlowButton
