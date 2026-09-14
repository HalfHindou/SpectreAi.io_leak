/**
 * SpectreLoader — universal loading affordance for the research app.
 *
 * Three variants, one component. Pick by `variant`:
 *   - "pulse"   (default) : 3 vertical bars breathing on the brand-glow ring.
 *                            Use when the wait is ~1-4s and you want the page
 *                            to feel alive without showing skeleton geometry.
 *   - "skeleton"          : Shimmering glass card placeholder. Use when the
 *                            wait is for structured content (lists, panels)
 *                            and you want the layout to hold its shape.
 *   - "inline"            : Tiny 3-dot ring for buttons / row-level loads.
 *                            Use inside a `<button>` or a single cell.
 *   - "logo"              : The Spectre phoenix mark inside a rotating warm-
 *                            white arc + breathing glow. The premium, branded
 *                            wait — use for whole-feature / TA loads.
 *
 * Props:
 *   variant?:  'pulse' | 'skeleton' | 'inline' | 'logo'   (default 'pulse')
 *   label?:    string — optional caption under the loader
 *   size?:     'sm' | 'md' | 'lg'                (default 'md')
 *   fullCard?: boolean — wraps in a glass card surface (variant 'pulse' only)
 *
 * Usage:
 *   {loading && <SpectreLoader label="Reading the chain" />}
 *   {loading ? <SpectreLoader variant="skeleton" /> : <RealContent />}
 *   <button>{busy ? <SpectreLoader variant="inline" /> : 'Save'}</button>
 */
import React from 'react'
import './spectre-loader.css'

const SpectreLoader = React.memo(function SpectreLoader({
  variant = 'pulse',
  label,
  size = 'md',
  fullCard = false,
}) {
  if (variant === 'inline') {
    return (
      <span className={`spectre-loader spectre-loader--inline spectre-loader--${size}`} role="status" aria-label={label || 'Loading'}>
        <span className="sl-dot" />
        <span className="sl-dot" />
        <span className="sl-dot" />
      </span>
    )
  }

  if (variant === 'logo') {
    const wrap = fullCard ? 'spectre-loader spectre-loader--card' : 'spectre-loader'
    return (
      <div className={`${wrap} spectre-loader--logo spectre-loader--${size}`} role="status" aria-label={label || 'Loading'}>
        <span className="sl-logo">
          <span className="sl-logo-arc" />
          <span className="sl-logo-glow" />
          <img src="/icon-512x512.png" alt="" className="sl-logo-mark" width="52" height="52" draggable="false" />
        </span>
        {label && <span className="sl-label">{label}</span>}
      </div>
    )
  }

  if (variant === 'skeleton') {
    return (
      <div className={`spectre-loader spectre-loader--skeleton spectre-loader--${size}`} role="status" aria-label={label || 'Loading'}>
        <div className="sl-sk-row sl-sk-row--head" />
        <div className="sl-sk-row sl-sk-row--md" />
        <div className="sl-sk-row sl-sk-row--lg" />
        <div className="sl-sk-row sl-sk-row--sm" />
        {label && <span className="sl-sk-label">{label}</span>}
      </div>
    )
  }

  // pulse (default)
  const wrap = fullCard ? 'spectre-loader spectre-loader--card' : 'spectre-loader'
  return (
    <div className={`${wrap} spectre-loader--pulse spectre-loader--${size}`} role="status" aria-label={label || 'Loading'}>
      <div className="sl-orb">
        <span className="sl-orb-ring sl-orb-ring--1" />
        <span className="sl-orb-ring sl-orb-ring--2" />
        <span className="sl-orb-ring sl-orb-ring--3" />
        <span className="sl-orb-bars">
          <span className="sl-bar" />
          <span className="sl-bar" />
          <span className="sl-bar" />
        </span>
      </div>
      {label && <span className="sl-label">{label}</span>}
    </div>
  )
})

export default SpectreLoader
