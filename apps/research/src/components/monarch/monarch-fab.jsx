/**
 * MonarchFAB — floating action button for Monarch AI chat.
 * Fixed bottom-right, glass circle with crown icon.
 */
import { spectreIcons } from '@/icons/spectreIcons'
import './monarch-fab.css'

export default function MonarchFAB({ onClick, locked = false }) {
  return (
    <button
      className={`monarch-fab${locked ? ' is-locked' : ''}`}
      onClick={locked ? undefined : onClick}
      aria-label={locked ? 'Monarch AI (coming soon)' : 'Open Monarch AI'}
      aria-disabled={locked || undefined}
      data-tooltip={locked ? 'Coming Soon' : 'Monarch AI'}
    >
      <span className="monarch-fab-icon">{spectreIcons.monarch}</span>
      {locked && (
        <span className="monarch-fab-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
      )}
      <span className="monarch-fab-ring" />
    </button>
  )
}
