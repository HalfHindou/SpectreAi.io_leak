/**
 * ShareXButton - Reusable "Share to X" button.
 * Blue glass pill with X logo, label, and spinner state.
 * Use `compact` prop for icon-only variant in tight spaces.
 */
import React from 'react'
import './share-x-button.css'

// Showcase-embed detection — locks the Share button inside the marketing
// iframe so demo viewers can't screenshot-export to X from the preview.
const isShowcaseEmbed = (() => {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (params.get('demo') === 'true') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
})()

const XIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="share-x-icon">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="share-x-icon">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

export default function ShareXButton({ onClick, isExporting = false, compact = false, className = '' }) {
  const locked = isShowcaseEmbed
  return (
    <button
      type="button"
      className={`share-x-btn ${compact ? 'share-x-btn--compact' : ''}${locked ? ' is-locked' : ''} ${className}`.trim()}
      onClick={(e) => { if (locked) { e.preventDefault(); return } onClick?.(e) }}
      disabled={isExporting || locked}
      aria-disabled={locked || undefined}
      title={locked ? 'Available in Beta' : 'Share to X'}
    >
      {isExporting ? <span className="share-x-spinner" /> : locked ? <LockIcon /> : <XIcon />}
      {!compact && (
        <span className="share-x-label">{isExporting ? 'Exporting…' : 'Share'}</span>
      )}
    </button>
  )
}
