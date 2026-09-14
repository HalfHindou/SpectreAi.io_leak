import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { track, Events } from '@/services/analytics'
import useSettingsStore from '@/store/useSettingsStore'
import { fetchResearchWatchlists, pushResearchWatchlists } from '@/services/profileSync'

import { normalizeAssetForMarket } from '@/lib/asset-identity'
import { isCryptoWatchlistEntry, reorderExistingTokens } from '@/lib/watchlist-market'

const WatchlistsContext = createContext()

export const useWatchlists = () => useContext(WatchlistsContext)

const DEFAULT_CRYPTO_TOKENS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
]

const DEFAULT_STOCK_TOKENS = [
  { symbol: 'AAPL', name: 'Apple Inc.', isStock: true, assetClass: 'stock' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', isStock: true, assetClass: 'stock' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', isStock: true, assetClass: 'stock' },
  { symbol: 'TSLA', name: 'Tesla Inc.', isStock: true, assetClass: 'stock' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', isStock: true, assetClass: 'stock' },
]

const getWatchlistStorageKeys = (mode) => ({
  listKey: mode === 'stocks' ? 'spectre-stock-watchlists' : 'spectre-watchlists',
  activeKey: mode === 'stocks' ? 'spectre-stock-active-watchlist-id' : 'spectre-active-watchlist-id',
})

const persistWatchlistsForMode = (mode, list, activeId) => {
  const { listKey, activeKey } = getWatchlistStorageKeys(mode)
  localStorage.setItem(listKey, JSON.stringify(list))
  if (activeId != null) localStorage.setItem(activeKey, activeId)
}

const now = () => Date.now()

// Collapse duplicate tokens within a single watchlist: prefer the entry with
// a resolved address (richer data), then fall back to the one that's pinned.
// Symbol + address are BOTH matched case-insensitively, so "SPECTRE" with no
// address dedupes against "spectre" with an address.
const dedupeTokens = (tokens) => {
  if (!Array.isArray(tokens)) return []
  const out = []
  const seenSymbols = new Map()
  const seenAddresses = new Map()
  for (const tk of tokens) {
    if (!tk) continue
    const sym = (tk.symbol || '').toUpperCase()
    const addr = (tk.address || '').toLowerCase()
    let existingIdx = -1
    if (addr && seenAddresses.has(addr)) {
      existingIdx = seenAddresses.get(addr)
    } else if (sym && seenSymbols.has(sym)) {
      existingIdx = seenSymbols.get(sym)
    }
    if (existingIdx >= 0) {
      const existing = out[existingIdx]
      const keepNew = (!existing.address && tk.address) || (!existing.pinned && tk.pinned)
      if (keepNew) {
        out[existingIdx] = { ...existing, ...tk, pinned: existing.pinned || tk.pinned }
        // Refresh address bookkeeping if the merged entry now has one.
        const mergedAddr = (out[existingIdx].address || '').toLowerCase()
        if (mergedAddr) seenAddresses.set(mergedAddr, existingIdx)
      }
      continue
    }
    const idx = out.push(tk) - 1
    if (sym) seenSymbols.set(sym, idx)
    if (addr) seenAddresses.set(addr, idx)
  }
  return out
}

const loadWatchlistsForMode = (mode) => {
  const { listKey } = getWatchlistStorageKeys(mode)
  const saved = localStorage.getItem(listKey)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(w => {
          // Never let a bug in dedupeTokens wipe the user's saved watchlist.
          let tokens = Array.isArray(w.tokens) ? w.tokens : []
          try { tokens = dedupeTokens(tokens) } catch { /* keep raw */ }
          return { ...w, tokens: tokens.map(token => normalizeAssetForMarket(token, mode)), updatedAt: w.updatedAt ?? now() }
        })
      }
    } catch { /* ignore */ }
  }
  if (mode === 'crypto') {
    const old = localStorage.getItem('spectre-watchlist')
    if (old) {
      try {
        const tokens = JSON.parse(old)
        if (Array.isArray(tokens) && tokens.length > 0) {
          return [{ id: 'default', name: 'My Watchlist', tokens, updatedAt: now() }]
        }
      } catch { /* ignore */ }
    }
    return [{ id: 'default', name: 'My Watchlist', tokens: DEFAULT_CRYPTO_TOKENS, updatedAt: now() }]
  }
  return [{ id: 'default', name: 'My Watchlist', tokens: DEFAULT_STOCK_TOKENS, updatedAt: now() }]
}

const loadActiveIdForMode = (mode) => {
  const { activeKey } = getWatchlistStorageKeys(mode)
  return localStorage.getItem(activeKey) || 'default'
}

// True when this device has NO saved watchlist for `mode` and is therefore
// showing the built-in default seed. On a fresh install the seed's updatedAt is
// "app-open time" (very recent), which must NOT be allowed to win LWW and
// clobber the real server copy - so the first hydrate forces server-wins here.
const isFreshDevice = (mode) => {
  const { listKey } = getWatchlistStorageKeys(mode)
  if (localStorage.getItem(listKey)) return false
  if (mode === 'crypto' && localStorage.getItem('spectre-watchlist')) return false
  return true
}

// Cross-device merge: last-writer-wins per list id (by updatedAt), so BOTH
// additions AND deletions propagate across devices. The old union merge could
// only ever grow, so a token deleted on one device reappeared from the other.
// Lists that exist on only one side are kept as-is (a newly created named list
// is never destroyed). Rules for a shared id:
//   - serverWins (fresh-install seed): server always wins - the default seed
//     must never overwrite real data on the first pull.
//   - otherwise the side with the greater updatedAt wins the WHOLE token set;
//     equal timestamps resolve to server (the canonical already-shared state).
// Whole-set replacement is what makes deletions stick. Tradeoff: editing BOTH
// devices between syncs keeps only the last-saved edit (no token-level merge) -
// acceptable for a single user switching phone<->PC.
const mergeWatchlistSets = (localLists, serverLists, { serverWins = false } = {}) => {
  const byId = new Map()
  const norm = (l) => ({
    ...l,
    tokens: dedupeTokens(Array.isArray(l.tokens) ? l.tokens : []),
    updatedAt: Number(l.updatedAt) || 0,
  })
  for (const l of (Array.isArray(localLists) ? localLists : [])) {
    if (l && l.id) byId.set(l.id, norm(l))
  }
  for (const l of (Array.isArray(serverLists) ? serverLists : [])) {
    if (!l || !l.id) continue
    const server = norm(l)
    const existing = byId.get(l.id)
    if (!existing || serverWins || server.updatedAt >= (existing.updatedAt || 0)) {
      byId.set(l.id, server)
    }
  }
  return Array.from(byId.values()).map((l) => ({ ...l, updatedAt: l.updatedAt || now() }))
}

export function WatchlistsProvider({ children }) {
  const marketMode = useSettingsStore((s) => s.marketMode)

  const [cryptoWatchlists, setCryptoWatchlists] = useState(() => loadWatchlistsForMode('crypto'))
  const [cryptoActiveId, setCryptoActiveId] = useState(() => loadActiveIdForMode('crypto'))
  const [stockWatchlists, setStockWatchlists] = useState(() => loadWatchlistsForMode('stocks'))
  const [stockActiveId, setStockActiveId] = useState(() => loadActiveIdForMode('stocks'))

  // ── Cross-device sync (logged-in Privy users) ───────────────────────
  // `_syncEnabled` flips true in ProfileSyncInit AFTER the auth token is set,
  // so by the time this fires fetch/push already have a token. Anonymous users
  // (no Privy) keep the pure-localStorage behavior — syncEnabled stays false.
  const syncEnabled = useSettingsStore((s) => s._syncEnabled)
  // Latest snapshot for the debounced push + the pagehide flush (avoids stale
  // closures without threading state through deps).
  const latestRef = useRef({ crypto: cryptoWatchlists, stocks: stockWatchlists })
  latestRef.current = { crypto: cryptoWatchlists, stocks: stockWatchlists }
  // Pushes are gated until the FIRST server fetch+merge completes, so we never
  // overwrite the server with a local-only payload (which would clobber the
  // other device's lists). Stays false if the fetch fails -> no push this
  // session, server data untouched.
  const hydratedRef = useRef(false)
  const pushTimerRef = useRef(null)
  // Timestamp of the last server pull; throttles the focus/visibility re-pull so
  // returning to the tab refreshes at most once per REPULL_THROTTLE.
  const lastPullRef = useRef(0)
  // Bumped once when hydration finishes so the push effect fires a seed push
  // even if the merge changed nothing locally (so a device whose lists the
  // server didn't have still uploads them for the other device).
  const [syncTick, setSyncTick] = useState(0)

  // Fetch the server set and LWW-merge it into local for both modes. Returns
  // false if the fetch failed. serverWins is computed per-mode so a fresh-install
  // default seed can't clobber real server data on the very first pull.
  const pullAndMerge = useCallback(async () => {
    lastPullRef.current = now() // set up-front so concurrent triggers dedupe
    const data = await fetchResearchWatchlists()
    if (!data) return false // null = fetch failed
    const sv = data.watchlists
    const cryptoFresh = isFreshDevice('crypto')
    const stocksFresh = isFreshDevice('stocks')
    if (sv && Array.isArray(sv.crypto) && sv.crypto.length) {
      setCryptoWatchlists((prev) => {
        const merged = mergeWatchlistSets(prev, sv.crypto, { serverWins: cryptoFresh })
        persistWatchlistsForMode('crypto', merged, null)
        return merged
      })
    }
    if (sv && Array.isArray(sv.stocks) && sv.stocks.length) {
      setStockWatchlists((prev) => {
        const merged = mergeWatchlistSets(prev, sv.stocks, { serverWins: stocksFresh }).map(list => ({
          ...list, tokens: (list.tokens || []).map(token => normalizeAssetForMarket(token, 'stocks')),
        }))
        persistWatchlistsForMode('stocks', merged, null)
        return merged
      })
    }
    return true
  }, [setCryptoWatchlists, setStockWatchlists])

  // Hydrate from server once per login (LWW-merge), then enable pushes.
  useEffect(() => {
    if (!syncEnabled || hydratedRef.current) return
    let cancelled = false
    ;(async () => {
      const ok = await pullAndMerge()
      if (cancelled || !ok) return // fetch failed -> don't enable pushes
      hydratedRef.current = true // success -> seed it
      setSyncTick((t) => t + 1) // fire one seed push of the merge
    })()
    return () => { cancelled = true }
  }, [syncEnabled, pullAndMerge])

  // Re-pull when the user returns to the tab (focus / becomes visible) so an
  // already-open device converges without a manual reload. Throttled, and only
  // after the initial hydrate. This is the "normal sync" refresh - not a live
  // socket, just a refresh on return.
  useEffect(() => {
    if (!syncEnabled) return
    const REPULL_THROTTLE = 15_000
    const maybePull = () => {
      if (!hydratedRef.current) return
      if (document.visibilityState === 'hidden') return
      if (now() - lastPullRef.current < REPULL_THROTTLE) return
      pullAndMerge().catch(() => {})
    }
    window.addEventListener('focus', maybePull)
    document.addEventListener('visibilitychange', maybePull)
    return () => {
      window.removeEventListener('focus', maybePull)
      document.removeEventListener('visibilitychange', maybePull)
    }
  }, [syncEnabled, pullAndMerge])

  // Debounced push on any list change (only after hydrate, so the pushed
  // payload is always the merged superset — never a clobbering local-only set).
  useEffect(() => {
    if (!syncEnabled || !hydratedRef.current) return
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(() => {
      pushResearchWatchlists(latestRef.current).catch(() => {})
    }, 800)
    return () => { if (pushTimerRef.current) clearTimeout(pushTimerRef.current) }
  }, [cryptoWatchlists, stockWatchlists, syncTick, syncEnabled])

  // Flush a pending change before the tab closes (keepalive survives unload).
  useEffect(() => {
    const flush = () => {
      if (!syncEnabled || !hydratedRef.current) return
      pushResearchWatchlists(latestRef.current, { keepalive: true }).catch(() => {})
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [syncEnabled])

  const isStocksMode = marketMode === 'stocks'
  // Keep the original stored rows intact for recovery, but never price known
  // crypto entries as equities. Older Trading Lite syncs could put them here.
  const visibleStockWatchlists = useMemo(() => stockWatchlists.map(list => ({
    ...list, tokens: list.tokens.filter(token => !isCryptoWatchlistEntry(token, cryptoWatchlists)),
  })), [stockWatchlists, cryptoWatchlists])
  const storedWatchlists = isStocksMode ? stockWatchlists : cryptoWatchlists
  const watchlists = isStocksMode ? visibleStockWatchlists : cryptoWatchlists
  const setWatchlists = isStocksMode ? setStockWatchlists : setCryptoWatchlists
  const savedActiveId = isStocksMode ? stockActiveId : cryptoActiveId
  const activeWatchlistId = watchlists.some(list => list.id === savedActiveId) ? savedActiveId : watchlists[0]?.id
  const setActiveWatchlistId = isStocksMode ? setStockActiveId : setCryptoActiveId

  const activeWatchlist = watchlists.find(w => w.id === activeWatchlistId) || watchlists[0]
  const watchlist = useMemo(() => activeWatchlist?.tokens ?? [], [activeWatchlist?.tokens])

  const watchlistsSummary = useMemo(() =>
    watchlists.map(w => ({ id: w.id, name: w.name, tokenCount: w.tokens?.length ?? 0 })),
    [watchlists]
  )

  const addWatchlist = useCallback((name) => {
    const listName = (name && String(name).trim()) || 'New list'
    track(Events.WATCHLIST_ACTION, { action: 'create', watchlist_name: listName })
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wl-${Date.now()}`
    const next = [...storedWatchlists, { id, name: listName, tokens: [], updatedAt: now() }]
    setWatchlists(next)
    setActiveWatchlistId(id)
    persistWatchlistsForMode(marketMode, next, id)
  }, [storedWatchlists, setWatchlists, setActiveWatchlistId, marketMode])

  const removeWatchlist = useCallback((id) => {
    const target = watchlists.find(w => w.id === id)
    track(Events.WATCHLIST_ACTION, { action: 'delete', watchlist_name: target?.name })
    const next = storedWatchlists.filter(w => w.id !== id)
    if (next.length === 0) return
    setWatchlists(next)
    const newActive = activeWatchlistId === id ? next[0].id : activeWatchlistId
    setActiveWatchlistId(newActive)
    persistWatchlistsForMode(marketMode, next, newActive)
  }, [watchlists, storedWatchlists, setWatchlists, activeWatchlistId, setActiveWatchlistId, marketMode])

  const renameWatchlist = useCallback((id, name) => {
    const trimmed = (name || '').trim() || 'Unnamed'
    setWatchlists(prev => {
      const next = prev.map(w => w.id === id ? { ...w, name: trimmed, updatedAt: now() } : w)
      persistWatchlistsForMode(marketMode, next, activeWatchlistId)
      return next
    })
  }, [setWatchlists, marketMode, activeWatchlistId])

  const setActiveWatchlist = useCallback((id) => {
    setActiveWatchlistId(id)
    persistWatchlistsForMode(marketMode, storedWatchlists, id)
  }, [setActiveWatchlistId, marketMode, storedWatchlists])

  const addToWatchlist = useCallback((tokenData) => {
    if (marketMode === 'stocks' && isCryptoWatchlistEntry(tokenData, cryptoWatchlists)) return
    tokenData = normalizeAssetForMarket(tokenData, marketMode)
    const activeList = watchlists.find(w => w.id === activeWatchlistId)
    track(Events.WATCHLIST_ACTION, { action: 'add', symbol: tokenData.symbol, token_address: tokenData.address || null, watchlist_name: activeList?.name })
    // Dedup by address AND by symbol independently. A "SPECTRE" added from the
    // default list (no address) should still block a second "SPECTRE" added
    // from search (with an address) and vice versa.
    const newSym = (tokenData.symbol || '').toUpperCase()
    const newAddr = (tokenData.address || '').toLowerCase()
    const isDuplicate = (t) => {
      const tSym = (t.symbol || '').toUpperCase()
      const tAddr = (t.address || '').toLowerCase()
      if (newAddr && tAddr && newAddr === tAddr) return true
      if (newSym && tSym && newSym === tSym) return true
      return false
    }
    setWatchlists(prev => {
      const next = prev.map(w => {
        if (w.id !== activeWatchlistId) return w
        if (w.tokens.some(isDuplicate)) return w
        return { ...w, tokens: [...w.tokens, tokenData], updatedAt: now() }
      })
      persistWatchlistsForMode(marketMode, next, activeWatchlistId)
      return next
    })
  }, [setWatchlists, activeWatchlistId, marketMode, watchlists, cryptoWatchlists])

  const removeFromWatchlist = useCallback((identifier) => {
    const activeList = watchlists.find(w => w.id === activeWatchlistId)
    const token = activeList?.tokens?.find(t => (t.address || t.symbol) === identifier || t.symbol === identifier)
    track(Events.WATCHLIST_ACTION, { action: 'remove', symbol: token?.symbol || identifier, token_address: token?.address || null, watchlist_name: activeList?.name })
    setWatchlists(prev => {
      const next = prev.map(w => {
        if (w.id !== activeWatchlistId) return w
        return { ...w, tokens: w.tokens.filter(t => (t.address || t.symbol) !== identifier && t.symbol !== identifier), updatedAt: now() }
      })
      persistWatchlistsForMode(marketMode, next, activeWatchlistId)
      return next
    })
  }, [setWatchlists, activeWatchlistId, marketMode, watchlists])

  const isInWatchlist = useCallback((identifier) => {
    if (identifier == null) return false
    const idStr = String(identifier)
    const idLower = idStr.toLowerCase()
    const idUpper = idStr.toUpperCase()
    return watchlist.some(t => {
      if (t.address && t.address.toLowerCase() === idLower) return true
      if (t.symbol && t.symbol.toUpperCase() === idUpper) return true
      return false
    })
  }, [watchlist])

  const togglePinWatchlist = useCallback((identifier) => {
    setWatchlists(prev => {
      const next = prev.map(w => {
        if (w.id !== activeWatchlistId) return w
        const tokens = w.tokens.map(t =>
          (t.address || t.symbol) === identifier || t.symbol === identifier ? { ...t, pinned: !t.pinned } : t
        )
        return { ...w, tokens, updatedAt: now() }
      })
      persistWatchlistsForMode(marketMode, next, activeWatchlistId)
      return next
    })
  }, [setWatchlists, activeWatchlistId, marketMode])

  const reorderWatchlist = useCallback((newOrder) => {
    setWatchlists(prev => {
      const next = prev.map(w => w.id === activeWatchlistId ? { ...w, tokens: reorderExistingTokens(w.tokens, newOrder), updatedAt: now() } : w)
      persistWatchlistsForMode(marketMode, next, activeWatchlistId)
      return next
    })
  }, [setWatchlists, activeWatchlistId, marketMode])

  // Trading Lite is crypto-only. Its messages must never target the selected
  // Stocks list, including when a reply arrives after a market toggle.
  const tradingActiveId = cryptoWatchlists.some(list => list.id === cryptoActiveId)
    ? cryptoActiveId : cryptoWatchlists[0]?.id
  const tradingWatchlist = useMemo(() => cryptoWatchlists.find(list => list.id === tradingActiveId)?.tokens || [], [cryptoWatchlists, tradingActiveId])
  const syncTradingWatchlist = useCallback(tokens => {
    const cryptoTokens = tokens.filter(token => !token.isStock && token.assetClass !== 'stock' && token.type !== 'stock')
    setCryptoWatchlists(prev => {
      const next = prev.map(list => list.id === tradingActiveId
        ? { ...list, tokens: dedupeTokens(cryptoTokens), updatedAt: now() } : list)
      persistWatchlistsForMode('crypto', next, tradingActiveId)
      return next
    })
  }, [tradingActiveId])

  const value = useMemo(() => ({
    watchlists, watchlist, watchlistsSummary, tradingWatchlist, syncTradingWatchlist,
    activeWatchlistId, activeWatchlist,
    addWatchlist, removeWatchlist, renameWatchlist,
    setActiveWatchlist,
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    togglePinWatchlist, reorderWatchlist,
  }), [
    watchlists, watchlist, watchlistsSummary, tradingWatchlist, syncTradingWatchlist,
    activeWatchlistId, activeWatchlist,
    addWatchlist, removeWatchlist, renameWatchlist,
    setActiveWatchlist,
    addToWatchlist, removeFromWatchlist, isInWatchlist,
    togglePinWatchlist, reorderWatchlist,
  ])

  return (
    <WatchlistsContext.Provider value={value}>
      {children}
    </WatchlistsContext.Provider>
  )
}

export default WatchlistsContext
