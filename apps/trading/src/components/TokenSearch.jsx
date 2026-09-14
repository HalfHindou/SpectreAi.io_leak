/**
 * TokenSearch - Global Token Search Bar
 * Apple-style search with dropdown results.
 * Searches the whitelisted token registry and shows
 * which sections have analysis coverage for each token.
 * Selecting a token fires onSelect(symbol) which
 * auto-activates that token across all sections.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { track, Events } from '../services/analytics'
import { searchRegistry, SECTION_META, buildRegistryFromProjects, mergeRegistry } from '../data/tokenRegistry'
import { getTokenLogo } from '../data/alphaFeedData'
import './TokenSearch.css'

function TokenSearch({ onSelect, activeSymbol, onClear, projects = null }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const containerRef = useRef(null)

  // Merge the static whitelist with the live bundle projects so search covers
  // the dynamic emerging-DeFi feed. Falls back to the static registry when the
  // bundle is empty/absent.
  const registry = useMemo(
    () => mergeRegistry(buildRegistryFromProjects(projects)),
    [projects]
  )
  // Quick lookup for a project's logo (dynamic projects aren't in the static
  // symbol→logo map). Keyed by uppercased symbol.
  const logoBySymbol = useMemo(() => {
    const map = {}
    if (Array.isArray(projects)) {
      for (const p of projects) {
        if (p?.symbol && p?.logo) map[p.symbol.toUpperCase()] = p.logo
      }
    }
    return map
  }, [projects])
  const resolveLogo = useCallback(
    (symbol) => logoBySymbol[symbol?.toUpperCase()] || getTokenLogo(symbol),
    [logoBySymbol]
  )

  const results = searchRegistry(query, registry)

  /* Close on outside click */
  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  /* Keyboard navigation */
  const handleKeyDown = useCallback((e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex(prev => Math.min(prev + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (focusedIndex >= 0 && results[focusedIndex]) {
          handleSelect(results[focusedIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        setFocusedIndex(-1)
        inputRef.current?.blur()
        break
      default:
        break
    }
  }, [isOpen, focusedIndex, results])

  // Accepts the full result object (falls back to a bare symbol string) so
  // the Search event carries the token's name + contract address for the
  // analytics dashboard. onSelect keeps receiving the symbol - unchanged.
  const handleSelect = useCallback((tokenOrSymbol) => {
    const tok = typeof tokenOrSymbol === 'string' ? { symbol: tokenOrSymbol } : (tokenOrSymbol || {})
    track(Events.SEARCH, {
      search_query: query,
      results_count: results.length,
      selected_token: tok.symbol,
      selected_token_name: tok.name || null,
      selected_token_address: tok.address || null,
    })
    setQuery('')
    setIsOpen(false)
    setFocusedIndex(-1)
    if (onSelect) onSelect(tok.symbol)
  }, [onSelect, query, results.length])

  const handleClear = useCallback(() => {
    setQuery('')
    setIsOpen(false)
    if (onClear) onClear()
  }, [onClear])

  const handleInputChange = useCallback((e) => {
    setQuery(e.target.value)
    setIsOpen(true)
    setFocusedIndex(-1)
  }, [])

  const handleFocus = useCallback(() => {
    if (query.length > 0) setIsOpen(true)
  }, [query])

  return (
    <div className="tsearch" ref={containerRef}>
      <div className={`tsearch-bar ${isOpen && results.length > 0 ? 'is-open' : ''} ${activeSymbol ? 'has-active' : ''}`}>
        {/* Search icon */}
        <svg className="tsearch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>

        <input
          ref={inputRef}
          className="tsearch-input"
          type="text"
          placeholder="Search tokens for analysis..."
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck="false"
        />

        {/* Active token badge */}
        {activeSymbol && !query && (
          <div className="tsearch-active">
            {(() => {
              const logo = resolveLogo(activeSymbol)
              return logo ? <img className="tsearch-active-logo" src={logo} alt={activeSymbol} /> : null
            })()}
            <span className="tsearch-active-symbol">{activeSymbol}</span>
            <button className="tsearch-active-clear" onClick={handleClear} title="Clear filter">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Clear query button */}
        {query && (
          <button className="tsearch-clear" onClick={() => { setQuery(''); setIsOpen(false) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Keyboard hint */}
        {!query && !activeSymbol && (
          <span className="tsearch-hint">
            <kbd>/</kbd>
          </span>
        )}
      </div>

      {/* Dropdown results */}
      {isOpen && query.length > 0 && (
        <div className="tsearch-dropdown" ref={dropdownRef}>
          {results.length > 0 ? (
            <>
              <div className="tsearch-dropdown-label">
                {results.length} whitelisted token{results.length !== 1 ? 's' : ''} found
              </div>
              {results.map((token, i) => {
                const logo = token.logo || resolveLogo(token.symbol)
                return (
                  <button
                    key={token.address || token.id || `${token.symbol}-${i}`}
                    className={`tsearch-result ${i === focusedIndex ? 'is-focused' : ''} ${token.symbol === activeSymbol ? 'is-active' : ''}`}
                    onClick={() => handleSelect(token)}
                    onMouseEnter={() => setFocusedIndex(i)}
                  >
                    <div className="tsearch-result-left">
                      {logo ? (
                        <img className="tsearch-result-logo" src={logo} alt={token.symbol} />
                      ) : (
                        <div className="tsearch-result-logo tsearch-result-logo--fallback">
                          {token.symbol.charAt(0)}
                        </div>
                      )}
                      <div className="tsearch-result-names">
                        <span className="tsearch-result-symbol">{token.symbol}</span>
                        <span className="tsearch-result-name">{token.name}</span>
                      </div>
                      <span className="tsearch-result-sector">{token.sector}</span>
                    </div>
                    <div className="tsearch-result-sections">
                      {token.sections.map(sec => (
                        <span key={sec} className="tsearch-result-badge" title={SECTION_META[sec]?.label}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d={SECTION_META[sec]?.icon} />
                          </svg>
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </>
          ) : (
            <div className="tsearch-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              <div className="tsearch-empty-text">
                <span className="tsearch-empty-title">No analysis available</span>
                <span className="tsearch-empty-desc">
                  "{query}" is not in our whitelist yet. Analysis coverage is expanding - check back soon.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TokenSearch
