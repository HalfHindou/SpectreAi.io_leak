/**
 * PageResults — renders the "Pages" section in the global search dropdown.
 *
 * Consumed by header.jsx. Hidden when there are no matches; shows a section
 * header + clickable rows when matches exist. Matches are pre-ranked by
 * usePageSearch / pageSearchIndex.
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  COMING_SOON_PAGE_IDS,
  isComingSoonPath,
  fireComingSoonLockEvent,
} from '@/constants/comingSoonPages'

const isEntryComingSoon = (entry) => {
  if (!entry) return false
  if (COMING_SOON_PAGE_IDS.has(entry.id)) return true
  if (entry.parent && COMING_SOON_PAGE_IDS.has(entry.parent)) return true
  return isComingSoonPath(entry.path)
}

const SECTION_ICONS = {
  Market: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M21 17V7h-10" />
    </svg>
  ),
  Discovery: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  AI: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  ),
  Social: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <circle cx="17" cy="7" r="3" />
    </svg>
  ),
  Tools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 1 0-5 5L2 19l3 3 7.7-7.7a4 4 0 0 0 5-5z" />
    </svg>
  ),
  Profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
}

const PageResultRow = React.memo(function PageResultRow({ entry, onSelect, focused }) {
  const sectionIcon = SECTION_ICONS[entry.section] || SECTION_ICONS.Tools
  const comingSoon = isEntryComingSoon(entry)
  return (
    <button
      type="button"
      className={`page-result-row${focused ? ' is-focused' : ''}${comingSoon ? ' is-coming-soon' : ''}`}
      onClick={() => onSelect(entry)}
      data-page-id={entry.id}
      aria-disabled={comingSoon || undefined}
    >
      <span className="page-result-icon">{sectionIcon}</span>
      <span className="page-result-body">
        <span className="page-result-title">
          {entry.title}
          {entry.parent ? <span className="page-result-parent"> in {entry.section}</span> : null}
          {comingSoon ? <span className="page-result-badge">Coming Soon</span> : null}
        </span>
        <span className="page-result-desc">{entry.description}</span>
      </span>
      <span className="page-result-path">{entry.path}</span>
      <span className="page-result-enter" aria-hidden>{comingSoon ? '⦰' : '↩'}</span>
    </button>
  )
})

/**
 * @param {object} props
 * @param {Array}  props.matches    — usePageSearch matches
 * @param {fn}     props.onClose    — close the search dropdown
 * @param {number} props.focusedIdx — keyboard-focused index within this list
 */
export default function PageResults({ matches, onClose, focusedIdx = -1 }) {
  const navigate = useNavigate()
  if (!matches || matches.length === 0) return null

  const handleSelect = (entry) => {
    if (isEntryComingSoon(entry)) {
      fireComingSoonLockEvent({
        source: 'search-results',
        itemId: entry.id,
        path: entry.path,
      })
      if (typeof onClose === 'function') onClose()
      return
    }
    navigate(entry.path)
    if (typeof onClose === 'function') onClose()
  }

  return (
    <div className="page-results-section">
      <div className="page-results-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="page-results-header-icon">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        <span className="page-results-label">Pages</span>
        <span className="page-results-hint">
          <kbd>↵</kbd> to go
        </span>
      </div>
      <div className="page-results-list" role="listbox">
        {matches.map(({ entry }, i) => (
          <PageResultRow
            key={entry.id}
            entry={entry}
            onSelect={handleSelect}
            focused={i === focusedIdx}
          />
        ))}
      </div>
    </div>
  )
}
