import React from 'react'

/* ── Default glyph: a quiet "no signal" mark (no robots/brains/sparkles) ── */
function DefaultGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17l5-5 4 3 5-6 4 4" />
      <circle cx="12" cy="12" r="9" opacity="0.35" />
    </svg>
  )
}

/**
 * RwaEmptyState — the shared premium empty/zero-data pattern for the
 * Tokenized Assets page. Use ANY time a tab has no rows / sparse data
 * instead of a bare sentence. Renders a glass shell, a subtle glyph and
 * tight copy. Pass `framed` to draw its own glass box (when it is the
 * whole panel); omit when it sits inside an existing .ta-glass-card.
 *
 * Props:
 *   title    — short headline (e.g. "No flows yet")
 *   copy     — one-line explanation
 *   icon     — optional custom glyph node (defaults to a chart-line mark)
 *   framed   — draw the glass box (default true)
 *   action   — optional { label, onClick } for a quiet retry/CTA button
 */
export default function RwaEmptyState({ title, copy, icon, framed = true, action }) {
  return (
    <div className={`ta-empty${framed ? ' ta-empty--framed' : ''}`} role="status">
      <span className="ta-empty__glyph">{icon || <DefaultGlyph />}</span>
      {title && <span className="ta-empty__title">{title}</span>}
      {copy && <span className="ta-empty__copy">{copy}</span>}
      {action?.label && (
        <button type="button" className="ta-empty__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
