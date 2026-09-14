import useChartFullscreen from './use-chart-fullscreen'

/** The two-state icon, shared so every fullscreen button on the page matches. */
export function FullscreenIcon({ active }) {
  return active ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14h6v6m10-10h-6V4m0 6l7-7M3 21l7-7" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  )
}

/**
 * ChartFullscreen — owns the fullscreen element + state for a chart that has no
 * fullscreen control of its own, and hands the BUTTON back to the chart so it
 * can sit in that chart's own toolbar next to its own controls. Floating it
 * absolutely over the corner read as detached from the panel.
 *
 * Render-prop rather than a plain wrapper because the button belongs inside the
 * child's markup, not beside it:
 *
 *   <ChartFullscreen>
 *     {({ button }) => <LiqMagnetField {...data} action={button} />}
 *   </ChartFullscreen>
 *
 * The charts all redraw from their container size via ResizeObserver, so growing
 * the box is the whole resize story; the CSS in liquidation-page.css tells each
 * one to fill it.
 */
export default function ChartFullscreen({ children, className = '' }) {
  const { ref, isFullscreen, toggle } = useChartFullscreen()

  const button = (
    <button
      type="button"
      className="liqp-chart-fs-btn"
      title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      onClick={toggle}
    >
      <FullscreenIcon active={isFullscreen} />
    </button>
  )

  return (
    <div
      ref={ref}
      className={`liqp-chart-fs${isFullscreen ? ' is-fullscreen' : ''}${className ? ` ${className}` : ''}`}
    >
      {/* Render-prop is the intended form; plain children are tolerated so a
          caller that forgets the slot renders without its button rather than
          taking the whole page down with "children is not a function". */}
      {typeof children === 'function' ? children({ button, isFullscreen, toggle }) : children}
    </div>
  )
}
