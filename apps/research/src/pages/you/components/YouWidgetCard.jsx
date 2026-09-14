/**
 * YouWidgetCard — Glass card wrapper for all Spectre YOU widgets.
 * Adapted from TC's WidgetCard with YOU-specific styling:
 * - 24px radius (vs TC's 16px)
 * - 18px padding (vs TC's 14px)
 * - Softer, home-like feel
 *
 * Header with title, category badge, drag handle, fullscreen toggle, close button.
 * Renders the widget component from the registry.
 * Includes per-widget error boundary to prevent cascade crashes.
 * Description tooltip on header hover.
 */
import { useState, useEffect, useRef, memo, Component } from 'react'
import { useWidgetViewedTracking } from '@/hooks/useYouTracking'

/** Per-widget error boundary — catches runtime errors in individual widgets */
class WidgetErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error(`[YouWidgetCard] Widget "${this.props.widgetId}" crashed:`, error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: 8, padding: 16,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Widget unavailable
          </span>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8, padding: '4px 12px', cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Default userTier=7000 so the registry's tier metadata does not gate widgets
// today. Tier gating activates when callers pass tierLocked={true} explicitly,
// or when a user-tier resolver replaces this default in a later phase.
export default memo(function YouWidgetCard({ id, meta, onRemove, registryEntry, dashboardId, tierLocked = false, userTier = 7000 }) {
  const [confirming, setConfirming] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const timerRef = useRef(null)

  // WIDGET_VIEWED duration tracking with IntersectionObserver pause/resume.
  // Hook returns a ref to attach to the card root.
  const viewedRef = useWidgetViewedTracking(id, dashboardId)

  // Tier-lock determination: explicit prop wins, else derive from registry.
  const isLocked = tierLocked || (registryEntry && registryEntry.tier > userTier)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // ESC to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [fullscreen])

  const toggleFullscreen = () => setFullscreen(f => !f)

  const handleClose = () => {
    setConfirming(true)
    // 8 seconds to decide
    timerRef.current = setTimeout(() => setConfirming(false), 8000)
  }

  const handleConfirm = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setConfirming(false)
    onRemove(id)
  }

  const handleCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setConfirming(false)
  }

  if (!meta) return null

  const WidgetComponent = meta.component

  return (
    <>
      {fullscreen && (
        <div className="you-card-backdrop" onClick={() => setFullscreen(false)} />
      )}
      <div ref={viewedRef} className={`you-card${fullscreen ? ' you-card-fullscreen' : ''}${isLocked ? ' you-card--locked' : ''}`}>
        <div className="you-card-header">
          <div className="you-card-title-group">
            <span className="you-card-title">{meta.name}</span>
            {meta.category && (
              <span className="you-card-category-badge">{meta.category}</span>
            )}
            {meta.description && (
              <span className="you-card-description-tooltip">{meta.description}</span>
            )}
          </div>
          <div className="you-card-actions">
            <span className="you-drag-handle" title="Drag to reorder">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="5" cy="3" r="1.3"/><circle cx="11" cy="3" r="1.3"/>
                <circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/>
                <circle cx="5" cy="13" r="1.3"/><circle cx="11" cy="13" r="1.3"/>
              </svg>
            </span>
            <button className="you-fullscreen-btn" onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9.5,1 9.5,4.5 13,4.5" />
                  <polyline points="4.5,13 4.5,9.5 1,9.5" />
                  <line x1="13" y1="1" x2="9.5" y2="4.5" />
                  <line x1="1" y1="13" x2="4.5" y2="9.5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9,1 13,1 13,5" />
                  <polyline points="5,13 1,13 1,9" />
                  <line x1="13" y1="1" x2="8.5" y2="5.5" />
                  <line x1="1" y1="13" x2="5.5" y2="8.5" />
                </svg>
              )}
            </button>
            <button className="you-close-btn" onClick={handleClose} title="Remove widget">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="3.5" x2="3.5" y2="10.5"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="you-card-body">
          <WidgetErrorBoundary widgetId={id}>
            <WidgetComponent {...(meta.props || {})} />
          </WidgetErrorBoundary>
          {isLocked && (
            <div className="you-card-lock" role="region" aria-label="Tier locked">
              <div className="you-card-lock-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="11" width="16" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              </div>
              <div className="you-card-lock-tier">
                {registryEntry?.tier ? `Requires ${registryEntry.tier} $SPECTRE` : 'Tier locked'}
              </div>
              <button type="button" className="you-card-lock-cta">Upgrade</button>
            </div>
          )}
        </div>

        {confirming && (
          <div className="you-confirm-strip">
            <span>Remove this widget?</span>
            <div className="you-confirm-actions">
              <button className="you-confirm-yes" onClick={handleConfirm}>Remove</button>
              <button className="you-confirm-cancel" onClick={handleCancel}>Keep</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
})
