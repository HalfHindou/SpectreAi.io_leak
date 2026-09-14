import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'

/**
 * Instagram-style story rail with compact search pill above.
 * Search: frosted glass pill, filters stories + emits query to parent.
 * Autocomplete: dropdown matching KOLs by name/handle.
 * Stories: 56px avatar circles with gradient ring, horizontal scroll.
 */

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
    stroke="rgba(245,245,247,0.5)" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const FilterIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="8" y1="12" x2="16" y2="12" />
    <line x1="11" y1="18" x2="13" y2="18" />
  </svg>
)

const fmtFollowers = (n) => {
  if (n == null) return ''
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export default function StoryRail({ stories, onStoryClick, onSearchChange }) {
  const items = stories || []
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [acIndex, setAcIndex] = useState(-1)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  // Filter stories by query
  const filteredStories = useMemo(() => {
    if (!query.trim()) return items
    const q = query.toLowerCase()
    return items.filter(s =>
      s.type === 'add' ||
      (s.name || '').toLowerCase().includes(q) ||
      (s.displayName || '').toLowerCase().includes(q)
    )
  }, [items, query])

  // Autocomplete suggestions - KOL stories matching query
  const suggestions = useMemo(() => {
    if (!query.trim() || query.length < 2) return []
    const q = query.toLowerCase()
    return items
      .filter(s => s.type === 'kol' && (
        (s.name || '').toLowerCase().includes(q) ||
        (s.displayName || '').toLowerCase().includes(q)
      ))
      .slice(0, 5)
  }, [items, query])

  const showDropdown = focused && query.length >= 2

  // Propagate search to parent for feed filtering
  const handleChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)
    setAcIndex(-1)
    onSearchChange?.(val)
  }, [onSearchChange])

  const handleSelectSuggestion = useCallback((story) => {
    setQuery(story.displayName || story.name || '')
    setFocused(false)
    onSearchChange?.(story.name || '')
    onStoryClick?.(story)
  }, [onSearchChange, onStoryClick])

  // Keyboard navigation in autocomplete
  const handleKeyDown = useCallback((e) => {
    if (!showDropdown || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAcIndex(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAcIndex(prev => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && acIndex >= 0) {
      e.preventDefault()
      handleSelectSuggestion(suggestions[acIndex])
    } else if (e.key === 'Escape') {
      setFocused(false)
    }
  }, [showDropdown, suggestions, acIndex, handleSelectSuggestion])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return
    const handle = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showDropdown])

  return (
    <div className="psr">
      {/* Search bar */}
      <div className="psr-search-bar" ref={wrapRef}>
        <div className="psr-search-input-wrap">
          <span className="psr-search-icon"><SearchIcon /></span>
          <input
            ref={inputRef}
            className="psr-search-input"
            type="text"
            placeholder="Search KOLs..."
            value={query}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button
              className="psr-mic-btn"
              onClick={() => { setQuery(''); onSearchChange?.(''); setAcIndex(-1) }}
              aria-label="Clear search"
              style={{ borderLeft: 'none', padding: '4px' }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <button className="psr-filter-btn" aria-label="Filters">
          <FilterIcon />
        </button>

        {/* Autocomplete dropdown */}
        {showDropdown && suggestions.length > 0 && (
          <div className="psr-autocomplete">
            {suggestions.map((s, i) => (
              <button
                key={s.id}
                className={`psr-ac-item${i === acIndex ? ' psr-ac-item--active' : ''}`}
                onClick={() => handleSelectSuggestion(s)}
                onMouseEnter={() => setAcIndex(i)}
              >
                {s.image ? (
                  <img src={s.image} alt={s.displayName || s.name} className="psr-ac-avatar" />
                ) : (
                  <div className="psr-ac-avatar psr-ac-avatar--fallback">
                    {(s.displayName || s.name || '?')[0]}
                  </div>
                )}
                <div className="psr-ac-info">
                  <span className="psr-ac-name">{s.displayName || s.name}</span>
                  <span className="psr-ac-handle">@{s.name}</span>
                </div>
                {s.followers && (
                  <span className="psr-ac-followers">{fmtFollowers(s.followers)}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {showDropdown && suggestions.length === 0 && query.length >= 2 && (
          <div className="psr-autocomplete">
            <div className="psr-ac-empty">No KOLs matching "{query}"</div>
          </div>
        )}
      </div>

      <div className="psr-label">Stories</div>
      <div className="psr-scroll">
        {filteredStories.map((item) => {
          const isAdd = item.type === 'add'
          return (
            <button
              key={item.id}
              className="psr-item"
              onClick={() => !isAdd && onStoryClick?.(item)}
              aria-label={isAdd ? 'Add your story' : item.name}
            >
              {/* Outer ring - gradient for KOLs, dashed for add */}
              <div className={`psr-ring ${isAdd ? 'psr-ring--add' : ''}`}>
                {/* Inner white gap + avatar */}
                <div className="psr-gap">
                  <div className="psr-avatar">
                    {isAdd ? (
                      <PlusIcon />
                    ) : item.image ? (
                      <>
                        <img
                          src={item.image}
                          alt={item.name}
                          className="psr-img"
                          loading="lazy"
                          onError={(e) => {
                            e.target.style.display = 'none'
                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'
                          }}
                        />
                        <span className="psr-fallback" style={{ display: 'none' }}>
                          {(item.name || '?')[0].toUpperCase()}
                        </span>
                      </>
                    ) : (
                      <span className="psr-fallback">
                        {(item.name || '?')[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <span className="psr-name">
                {isAdd ? 'Your Story' : (item.name || '').slice(0, 10)}
                {!isAdd && (item.name || '').length > 10 ? '...' : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
