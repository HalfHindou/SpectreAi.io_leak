/**
 * ProjectSearchBar — Top-left floating search bar for switching projects
 * on the X Intelligence graph. Uses the X Dash search API to find tokens,
 * then loads their social graph.
 *
 * Separate from SearchOverlay (Cmd+K) which searches WITHIN the current graph.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useXDashSearch } from '@/hooks/useXDashSearch'

function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function DropdownPanel({ results, loading, query, activeIndex, onSelect, onHover, anchorRef, dayMode }) {
  // Calculate position inline - anchorRef.current changes dimensions on layout
  // so we recalculate every render (no stale useEffect)
  const rect = anchorRef.current?.getBoundingClientRect()
  const pos = rect
    ? { top: rect.bottom + 6, left: rect.left, width: rect.width }
    : { top: 100, left: 100, width: 260 }

  return (
    <div
      className={`xi-project-search__dropdown ${dayMode ? 'xi-project-search--day' : ''}`}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 260) }}
    >
      {loading && results.length === 0 && (
        <div className="xi-project-search__loading">
          <div className="xi-project-search__shimmer" />
          <div className="xi-project-search__shimmer" style={{ width: '60%' }} />
        </div>
      )}

      {!loading && results.length === 0 && query.trim().length >= 2 && (
        <div className="xi-project-search__empty">No projects found</div>
      )}

      {results.map((r, i) => {
        const mentions = r.external_mentions_24h || r.external_mentions || 0
        const authors = r.unique_authors_24h || r.unique_external_authors_24h || 0
        return (
          <button
            key={r.cg_id || r.symbol || i}
            className={`xi-project-search__result ${i === activeIndex ? 'xi-project-search__result--active' : ''}`}
            onClick={() => onSelect(r)}
            onMouseEnter={() => onHover(i)}
          >
            {r.image_small || r.image ? (
              <img
                className="xi-project-search__avatar"
                src={r.image_small || r.image}
                alt=""
                width="28"
                height="28"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            ) : (
              <span className="xi-project-search__avatar-fallback">
                {(r.symbol || r.name || '?')[0].toUpperCase()}
              </span>
            )}
            <div className="xi-project-search__result-info">
              <span className="xi-project-search__result-name">{r.name || r.symbol}</span>
              <span className="xi-project-search__result-symbol">{r.cashtag || `$${r.symbol}`}</span>
            </div>
            <div className="xi-project-search__result-stats">
              <span className="xi-project-search__result-stat">{formatNumber(mentions)} mentions</span>
              <span className="xi-project-search__result-stat">{formatNumber(authors)} authors</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export default function ProjectSearchBar({ currentProject, onSelectProject, dayMode, autoFocus }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  // Auto-focus on mount if requested
  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 100)
  }, [autoFocus])

  const { data: searchResults, loading: searchLoading, search: doSearch, clear: clearSearch } =
    useXDashSearch()

  // Search - hook handles debounce internally
  const handleInputChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)
    setActiveIndex(0)

    if (val.trim().length >= 2) {
      setIsOpen(true)
      doSearch(val)
    } else {
      clearSearch()
      setIsOpen(false)
    }
  }, [doSearch, clearSearch])

  // Select a project
  const handleSelect = useCallback((result) => {
    const cgId = result.cg_id || result.cgId
    if (!cgId) return
    onSelectProject({
      cgId,
      name: result.name || result.symbol,
      symbol: result.symbol,
      image: result.image_small || result.image || null,
    })
    setQuery('')
    setIsOpen(false)
    clearSearch()
    inputRef.current?.blur()
  }, [onSelectProject, clearSearch])

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    const results = searchResults?.tokens || []
    if (e.key === 'Escape') {
      setIsOpen(false)
      setQuery('')
      clearSearch()
      inputRef.current?.blur()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[activeIndex]) handleSelect(results[activeIndex])
    }
  }, [searchResults, activeIndex, handleSelect, clearSearch])

  // Click outside to close (check both container and portal dropdown)
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e) => {
      const inContainer = containerRef.current?.contains(e.target)
      const inDropdown = e.target.closest('.xi-project-search__dropdown')
      if (!inContainer && !inDropdown) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const results = searchResults?.tokens || []

  return (
    <div className={`xi-project-search ${dayMode ? 'xi-project-search--day' : ''}`} ref={containerRef}>
      <div className="xi-project-search__current" onClick={() => inputRef.current?.focus()}>
        <span className="xi-project-search__label">Project</span>
        <span className="xi-project-search__name">{currentProject}</span>
      </div>

      <div className="xi-project-search__input-wrap">
        <svg className="xi-project-search__icon" width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6.5" cy="6.5" r="5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          ref={inputRef}
          className="xi-project-search__input"
          type="text"
          placeholder="Search any project..."
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim().length >= 2) setIsOpen(true) }}
        />
      </div>

      {isOpen && createPortal(
        <DropdownPanel
          results={results}
          loading={searchLoading}
          query={query}
          activeIndex={activeIndex}
          onSelect={handleSelect}
          onHover={setActiveIndex}
          anchorRef={containerRef}
          dayMode={dayMode}
        />,
        document.body,
      )}
    </div>
  )
}
