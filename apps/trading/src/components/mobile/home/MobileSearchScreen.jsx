/**
 * MobileSearchScreen — full-screen token search tab (prefix msrch-).
 *
 * Input autofocuses when the tab becomes active. Results ride the same
 * useTokenSearch pipeline as the header/command palette (fast tier +
 * settled Codex tier). Empty query shows recent searches (localStorage)
 * + the trending board as suggestions (cache-shared hook call — same key
 * the screener polls, so this adds no extra upstream traffic).
 *
 * Recents render as full MobileTokenRows (price / 1H / 24H / mcap) hydrated
 * by the same details-batch the watchlist tab uses — one request for the
 * whole list, polled only while this tab is on the idle (no-query) state.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Search, X, Clock3, Flame } from 'lucide-react'
import { useTokenSearch, useTrendingTokens } from '../../../hooks/useCodexData'
import { ALL_TREND_CHAINS } from '../../../lib/marketFormat'
import MobileTokenRow from './MobileTokenRow'
import MobilePullRefresh from '../MobilePullRefresh'
import useWatchlistLiveData from './useWatchlistLiveData'
import './MobileSearchScreen.css'

const RECENT_KEY = 'spectre-mobile-recent'
const RECENT_MAX = 8

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

export default function MobileSearchScreen({
  active,
  selectToken,
  isInWatchlist,
  addToWatchlist,
  removeFromWatchlist,
}) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(readRecent)
  const inputRef = useRef(null)

  const { results, loading } = useTokenSearch(query)
  // Suggestions: identical cache key to the screener's default board — served
  // from the shared module cache, no second upstream fetch.
  const { tokens: trending, refresh: refreshTrending } = useTrendingTokens(120000, ALL_TREND_CHAINS, '24h')

  const trimmed = query.trim()
  const idle = !trimmed

  // Live price/mcap for the recents list — same details-batch hook the
  // watchlist tab uses (one request for all entries, 90s poll, visibility
  // guarded). Only runs on the idle state, where the list is visible.
  const { dataMap: recentLive, refresh: refreshRecent } = useWatchlistLiveData(
    recent,
    active && idle && recent.length > 0,
  )

  // Pull-to-refresh: refetch the trending suggestions + the recents batch
  // (the query results re-run live as the user types — nothing to force there).
  const handlePullRefresh = useCallback(
    () => Promise.all([refreshTrending(true, { fresh: true }), refreshRecent()]),
    [refreshTrending, refreshRecent],
  )

  useEffect(() => {
    if (active) {
      // Delay focus past the tab transition so the keyboard doesn't fight it.
      const t = setTimeout(() => inputRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
    inputRef.current?.blur()
  }, [active])

  const saveRecent = useCallback((token) => {
    setRecent(prev => {
      const id = token.address || token.symbol
      const next = [
        { symbol: token.symbol, name: token.name, address: token.address, networkId: token.networkId || 1, logo: token.logo },
        ...prev.filter(r => (r.address || r.symbol) !== id),
      ].slice(0, RECENT_MAX)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])

  const pick = useCallback((token) => {
    saveRecent(token)
    selectToken?.(token, 'mobile-search')
  }, [saveRecent, selectToken])

  const clearRecent = useCallback(() => {
    setRecent([])
    try { localStorage.removeItem(RECENT_KEY) } catch { /* noop */ }
  }, [])

  const removeRecent = useCallback((id) => {
    setRecent(prev => {
      const next = prev.filter(r => (r.address || r.symbol) !== id)
      try {
        if (next.length) localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        else localStorage.removeItem(RECENT_KEY)
      } catch { /* quota */ }
      return next
    })
  }, [])

  const toggleWatchlist = useCallback((token) => {
    const id = token.address || token.symbol
    if (isInWatchlist?.(id)) removeFromWatchlist?.(id)
    else addToWatchlist?.({ symbol: token.symbol, name: token.name, address: token.address, networkId: token.networkId || 1, logo: token.logo })
  }, [isInWatchlist, addToWatchlist, removeFromWatchlist])

  const suggestions = useMemo(() => (trending || []).slice(0, 10), [trending])

  // Merge the stored identity with whatever the live batch returned. Live
  // logo wins when the stored one is missing/stale; numbers stay undefined
  // until the batch lands so the row shows "—", never a fake $0.
  const recentRows = useMemo(() => recent.map((r) => {
    const live = recentLive[String(r.address || r.symbol || '').toLowerCase()]
    return live ? { ...r, ...live, logo: r.logo || live.logo } : r
  }), [recent, recentLive])

  return (
    <MobilePullRefresh onRefresh={handlePullRefresh} disabled={!active}>
    <div className="msrch">
      <div className="msrch-bar">
        <div className="msrch-field">
          <Search size={16} strokeWidth={2} className="msrch-icon" />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            placeholder="Token name, ticker or contract"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tokens"
          />
          {query && (
            <button type="button" className="msrch-clear" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Clear search">
              <X size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {trimmed ? (
        <div className="msrch-results">
          {loading && results.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="msrch-skel">
                <div className="msrch-skel-logo animate-shimmer" />
                <div className="msrch-skel-line animate-shimmer" />
              </div>
            ))
          ) : results.length === 0 ? (
            <div className="msrch-none">Nothing found for “{trimmed}”</div>
          ) : (
            results.map(t => (
              <MobileTokenRow
                key={`${t.address || t.symbol}-${t.networkId || ''}`}
                token={t}
                onSelect={pick}
                onSwipeRight={toggleWatchlist}
                inWatchlist={!!isInWatchlist?.(t.address || t.symbol)}
                showChips={false}
              />
            ))
          )}
        </div>
      ) : (
        <div className="msrch-idle">
          {recent.length > 0 && (
            <>
              <div className="msrch-section">
                <Clock3 size={13} strokeWidth={2} />
                <span>Recent</span>
                <button type="button" onClick={clearRecent}>Clear</button>
              </div>
              <div className="msrch-recent">
                {recentRows.map(r => (
                  <MobileTokenRow
                    key={`${r.address || r.symbol}-${r.networkId || ''}`}
                    token={r}
                    onSelect={pick}
                    onSwipeRight={toggleWatchlist}
                    onSwipeLeft={(t) => removeRecent(t.address || t.symbol)}
                    inWatchlist={!!isInWatchlist?.(r.address || r.symbol)}
                    showChips={false}
                  />
                ))}
              </div>
            </>
          )}

          <div className="msrch-section">
            <Flame size={13} strokeWidth={2} />
            <span>Trending now</span>
          </div>
          {suggestions.map(t => (
            <MobileTokenRow
              key={`${t.address || t.symbol}-${t.networkId || ''}`}
              token={t}
              onSelect={pick}
              onSwipeRight={toggleWatchlist}
              inWatchlist={!!isInWatchlist?.(t.address || t.symbol)}
              showChips={false}
            />
          ))}
        </div>
      )}
    </div>
    </MobilePullRefresh>
  )
}
