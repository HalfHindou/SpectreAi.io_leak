/**
 * SearchOverlay — Top-center floating search bar for the X Intelligence graph.
 *
 * Provides fuzzy search over node names and handles with a dropdown of results.
 * Keyboard navigation: Escape closes, ArrowDown/Up cycles, Enter selects.
 */
import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { TIER_COLORS } from '../data/zigchainGraph'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFollowers(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="6.5" r="5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SearchOverlay({ nodes, onSelectNode, dayMode }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)

  // ── Fuzzy search results ─────────────────────────────────────────────────
  const results = useMemo(() => {
    if (!query || query.length < 1) return []
    const q = query.toLowerCase()

    const matches = nodes.filter((n) => {
      const name = (n.name || '').toLowerCase()
      const handle = (n.handle || n.id || '').toLowerCase()
      return name.includes(q) || handle.includes(q)
    })

    // Sort: exact/startsWith first, then by follower count
    matches.sort((a, b) => {
      const aName = (a.name || '').toLowerCase()
      const bName = (b.name || '').toLowerCase()
      const aExact = aName === q || aName.startsWith(q) ? 1 : 0
      const bExact = bName === q || bName.startsWith(q) ? 1 : 0
      if (aExact !== bExact) return bExact - aExact
      return (b.followers || 0) - (a.followers || 0)
    })

    return matches.slice(0, 8)
  }, [nodes, query])

  // ── Keyboard shortcut (Cmd/Ctrl+K) ───────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSelect = useCallback(
    (nodeId) => {
      onSelectNode(nodeId)
      setQuery('')
      setIsOpen(false)
      inputRef.current?.blur()
    },
    [onSelectNode],
  )

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        inputRef.current?.blur()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault()
        handleSelect(results[activeIndex]?.id)
      }
    },
    [results, activeIndex, handleSelect],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [results])

  const showDropdown = isOpen && query.length > 0 && results.length > 0

  return (
    <div className="xi-search">
      <div className="xi-search__input-wrap">
        <span className="xi-search__icon"><SearchIcon /></span>
        <input
          ref={inputRef}
          type="text"
          className="xi-search__input xi-glass"
          placeholder="Search KOLs, exchanges..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <kbd className="xi-search__kbd">
          {navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}K
        </kbd>
      </div>

      {showDropdown && (
        <div className="xi-search__results xi-glass">
          {results.map((node, i) => {
            const tierColor = TIER_COLORS[node.tier] || TIER_COLORS.C
            const handle = node.handle?.startsWith('@') ? node.handle : `@${node.id}`
            return (
              <div
                key={node.id}
                className={`xi-search__result ${i === activeIndex ? 'xi-search__result--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(node.id)
                }}
                onMouseEnter={() => setActiveIndex(i)}
                role="option"
                aria-selected={i === activeIndex}
              >
                <div
                  className="xi-search__result-avatar"
                  style={{ borderColor: tierColor }}
                >
                  {node.avatar ? (
                    <img
                      src={node.avatar}
                      alt=""
                      crossOrigin="anonymous"
                      onError={(e) => { e.target.style.display = 'none' }}
                    />
                  ) : (
                    <span style={{ color: tierColor, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                      {(node.name || '?')[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="xi-search__result-info">
                  <span className="xi-search__result-name">{node.name}</span>
                  <span className="xi-search__result-handle">{handle}</span>
                </div>
                <div className="xi-search__result-meta">
                  <span
                    className="xi-search__result-tier"
                    style={{ background: tierColor + '18', color: tierColor }}
                  >
                    {node.tier}-Tier
                  </span>
                  <span className="xi-search__result-followers">
                    {formatFollowers(node.followers)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
