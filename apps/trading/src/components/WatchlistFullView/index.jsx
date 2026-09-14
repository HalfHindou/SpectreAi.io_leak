/**
 * WatchlistFullView - Full screen watchlist (DexScreener-style table).
 * Spectre design language but with strong contrast for readability.
 *
 * Features:
 * - Watchlist GROUPS (Main + user-created lists, persisted to localStorage)
 * - Chain filter, timeframe filter, search filter
 * - Quick filter pills: Top, Gainers, Losers
 * - Sortable columns
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Icon from '../Icon'
import { getHardcodedLogo } from '../../services/codexApi'
import { generateSeededSparkline, generateSparklineFromPriceHistory, subsample, sparklineToPoints } from '../../utils/sparkline'
import './WatchlistFullView.css'

const formatPrice = (price) => {
  const n = typeof price === 'number' ? price : parseFloat(price)
  if (!isFinite(n) || isNaN(n)) return '$0.00'
  if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (n >= 1) return `$${n.toFixed(4)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  if (n >= 0.0001) return `$${n.toFixed(6)}`
  if (n > 0) return `$${n.toFixed(8)}`
  return '$0.00'
}

const formatChange = (change) => {
  const n = typeof change === 'number' ? change : parseFloat(change)
  if (!isFinite(n) || isNaN(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

const formatLargeUSD = (val) => {
  if (val == null || val === 0) return '—'
  const n = Number(val)
  if (!isFinite(n)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

const NETWORK_LABEL = {
  1: 'ETH',
  56: 'BSC',
  137: 'POLY',
  8453: 'BASE',
  42161: 'ARB',
  10: 'OP',
  43114: 'AVAX',
  1399811149: 'SOL',
}

const CHAIN_FILTERS = [
  { id: 'all', label: 'All Chains', short: 'All', networkIds: null },
  { id: 'eth', label: 'Ethereum', short: 'ETH', networkIds: [1] },
  { id: 'sol', label: 'Solana', short: 'SOL', networkIds: [1399811149] },
  { id: 'bsc', label: 'BSC', short: 'BSC', networkIds: [56] },
  { id: 'base', label: 'Base', short: 'BASE', networkIds: [8453] },
  { id: 'arb', label: 'Arbitrum', short: 'ARB', networkIds: [42161] },
]

const QUICK_FILTERS = [
  { id: 'top', label: 'Top', sort: { key: 'marketCap', dir: 'desc' } },
  { id: 'gainers', label: 'Gainers', sort: { key: 'change', dir: 'desc' } },
  { id: 'losers', label: 'Losers', sort: { key: 'change', dir: 'asc' } },
]

const GROUPS_KEY = 'spectre-watchlist-groups'
const ACTIVE_GROUP_KEY = 'spectre-watchlist-active-group'

function loadGroups() {
  try {
    const raw = localStorage.getItem(GROUPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function saveGroups(groups) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)) } catch {}
}

const TableSparkline = React.memo(function TableSparkline({ prices, change, seed }) {
  const isPositive = (Number(change) || 0) >= 0
  const w = 96, h = 28, pad = 2
  const data = prices && prices.length >= 2
    ? generateSparklineFromPriceHistory(subsample(prices, 28))
    : generateSeededSparkline(Number(change) || 0, seed, 18)
  const linePoints = sparklineToPoints(data, w, h, pad)
  const fillPoints = `${linePoints} ${w - pad},${h} ${pad},${h}`
  const color = isPositive ? '#10B981' : '#EF4444'
  const safe = (seed || 'x').toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(-6) || 'x'
  const gradId = `wfv-${isPositive ? 'b' : 'r'}-${safe}`
  return (
    <svg className="wfv-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="60%" stopColor={color} stopOpacity="0.05" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#${gradId})`} />
      <polyline points={linePoints} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
})

function WatchlistFullView({
  watchlist = [],
  sparklinePrices = {},
  onClose,
  selectToken,
  togglePinWatchlist,
  removeFromWatchlist,
  refresh,
  onImport,
}) {
  const [groups, setGroups] = useState(() => loadGroups())
  const [activeGroupId, setActiveGroupId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_GROUP_KEY) || 'main' } catch { return 'main' }
  })
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef(null)

  const [chainId, setChainId] = useState('all')
  const [quickFilter, setQuickFilter] = useState(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('rank')
  const [sortDir, setSortDir] = useState('asc')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { saveGroups(groups) }, [groups])
  useEffect(() => {
    try { localStorage.setItem(ACTIVE_GROUP_KEY, activeGroupId) } catch {}
  }, [activeGroupId])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (renamingId) { setRenamingId(null); return }
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, renamingId])

  const activeTokens = useMemo(() => {
    if (activeGroupId === 'main') return watchlist
    const g = groups.find((x) => x.id === activeGroupId)
    return g?.tokens || []
  }, [activeGroupId, groups, watchlist])

  const chainFiltered = useMemo(() => {
    const chain = CHAIN_FILTERS.find((c) => c.id === chainId)
    if (!chain || !chain.networkIds) return activeTokens
    const ids = new Set(chain.networkIds)
    return activeTokens.filter((t) => ids.has(Number(t.networkId) || 1))
  }, [activeTokens, chainId])

  const searchFiltered = useMemo(() => {
    if (!query.trim()) return chainFiltered
    const q = query.trim().toLowerCase()
    return chainFiltered.filter((t) =>
      (t.symbol || '').toLowerCase().includes(q) ||
      (t.name || '').toLowerCase().includes(q) ||
      (t.address || '').toLowerCase().includes(q)
    )
  }, [chainFiltered, query])

  const effectiveSort = useMemo(() => {
    if (quickFilter) {
      const qf = QUICK_FILTERS.find((f) => f.id === quickFilter)
      if (qf) return qf.sort
    }
    return { key: sortKey, dir: sortDir }
  }, [quickFilter, sortKey, sortDir])

  const sorted = useMemo(() => {
    if (effectiveSort.key === 'rank') return searchFiltered
    const accessor = {
      token: (t) => (t.symbol || '').toLowerCase(),
      price: (t) => Number(t.price) || 0,
      change: (t) => Number(t.change) || 0,
      marketCap: (t) => Number(t.marketCap) || 0,
      volume: (t) => Number(t.volume24) || 0,
      liquidity: (t) => Number(t.liquidity) || 0,
    }[effectiveSort.key]
    if (!accessor) return searchFiltered
    const out = [...searchFiltered].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (typeof av === 'string') return av.localeCompare(bv)
      return av - bv
    })
    return effectiveSort.dir === 'desc' ? out.reverse() : out
  }, [searchFiltered, effectiveSort])

  const setSort = useCallback((key) => {
    setQuickFilter(null)
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'token' || key === 'rank' ? 'asc' : 'desc')
    }
  }, [sortKey])

  const createGroup = () => {
    const id = `g-${Date.now().toString(36)}`
    const newGroup = { id, name: `Watchlist ${groups.length + 2}`, tokens: [] }
    setGroups((prev) => [...prev, newGroup])
    setActiveGroupId(id)
    setRenamingId(id)
    setRenameValue(newGroup.name)
    setTimeout(() => renameInputRef.current?.select(), 50)
  }
  const startRename = (id, currentName) => {
    setRenamingId(id)
    setRenameValue(currentName)
    setTimeout(() => renameInputRef.current?.select(), 50)
  }
  const commitRename = () => {
    if (!renamingId) return
    const trimmed = renameValue.trim() || 'Untitled'
    setGroups((prev) => prev.map((g) => (g.id === renamingId ? { ...g, name: trimmed } : g)))
    setRenamingId(null)
  }
  const deleteGroup = (id) => {
    if (id === 'main') return
    if (!confirm('Delete this watchlist group?')) return
    setGroups((prev) => prev.filter((g) => g.id !== id))
    if (activeGroupId === id) setActiveGroupId('main')
  }

  const totals = useMemo(() => {
    let mcap = 0, vol = 0, liq = 0, gainers = 0, losers = 0
    for (const t of activeTokens) {
      mcap += Number(t.marketCap) || 0
      vol += Number(t.volume24) || 0
      liq += Number(t.liquidity) || 0
      const c = Number(t.change) || 0
      if (c > 0) gainers++
      else if (c < 0) losers++
    }
    return { mcap, vol, liq, gainers, losers }
  }, [activeTokens])

  const handleRefresh = async () => {
    if (!refresh || refreshing) return
    setRefreshing(true)
    try { await refresh() } catch (_) { /* ignore */ }
    setTimeout(() => setRefreshing(false), 400)
  }

  const allTabs = [{ id: 'main', name: 'Main Watchlist', system: true, count: watchlist.length }]
    .concat(groups.map((g) => ({ id: g.id, name: g.name, system: false, count: g.tokens?.length || 0 })))

  return (
    <div
      className="wfv-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483646,
        background: 'rgba(8, 8, 12, 0.85)',
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="wfv-shell"
        style={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          background: '#0c0c10',
          color: '#f5f5f7',
          overflow: 'hidden',
        }}
      >
        <header className="wfv-header">
          <div className="wfv-header-left">
            <button className="wfv-close" onClick={onClose} title="Close (Esc)">
              <Icon name="close" size={18} />
            </button>
            <div className="wfv-title-block">
              <h1 className="wfv-title">Watchlists</h1>
              <span className="wfv-subtitle">Spectre on-chain · Multi-chain</span>
            </div>
          </div>

          <div className="wfv-header-stats">
            <div className="wfv-stat">
              <span className="wfv-stat-label">Total MCAP</span>
              <span className="wfv-stat-value mono">{formatLargeUSD(totals.mcap)}</span>
            </div>
            <div className="wfv-stat">
              <span className="wfv-stat-label">24H Volume</span>
              <span className="wfv-stat-value mono">{formatLargeUSD(totals.vol)}</span>
            </div>
            <div className="wfv-stat">
              <span className="wfv-stat-label">Liquidity</span>
              <span className="wfv-stat-value mono">{formatLargeUSD(totals.liq)}</span>
            </div>
            <div className="wfv-stat">
              <span className="wfv-stat-label">Gainers / Losers</span>
              <span className="wfv-stat-value mono">
                <span className="wfv-pos">{totals.gainers}</span>
                <span className="wfv-divider">/</span>
                <span className="wfv-neg">{totals.losers}</span>
              </span>
            </div>
          </div>
        </header>

        <div className="wfv-tabs-row">
          <div className="wfv-tabs">
            {allTabs.map((tab) => (
              <div
                key={tab.id}
                className={`wfv-tab${activeGroupId === tab.id ? ' active' : ''}`}
                onClick={() => activeGroupId !== tab.id && setActiveGroupId(tab.id)}
                onDoubleClick={() => !tab.system && startRename(tab.id, tab.name)}
              >
                {renamingId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    className="wfv-tab-rename"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') setRenamingId(null)
                    }}
                    autoFocus
                  />
                ) : (
                  <>
                    <span className="wfv-tab-name">{tab.name}</span>
                    <span className="wfv-tab-count">{tab.count}</span>
                    {!tab.system && activeGroupId === tab.id && (
                      <button
                        className="wfv-tab-delete"
                        onClick={(e) => { e.stopPropagation(); deleteGroup(tab.id) }}
                        title="Delete list"
                      >
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            <button className="wfv-tab-add" onClick={createGroup} title="New watchlist group">
              <span>+</span>
              <span>New list</span>
            </button>
          </div>
          {onImport && (
            <button className="wfv-import-cta" onClick={onImport}>
              <Icon name="external-link" size={14} />
              <span>Import from DexScreener</span>
            </button>
          )}
        </div>

        <div className="wfv-filter-bar">
          <div className="wfv-filter-pills">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.id}
                className={`wfv-pill${quickFilter === f.id ? ' active' : ''}`}
                onClick={() => setQuickFilter(quickFilter === f.id ? null : f.id)}
              >
                {f.label}
              </button>
            ))}
            <span className="wfv-divider-vert" />
            {CHAIN_FILTERS.map((c) => (
              <button
                key={c.id}
                className={`wfv-pill chain${chainId === c.id ? ' active' : ''}`}
                onClick={() => setChainId(c.id)}
              >
                {c.short || c.label}
              </button>
            ))}
          </div>

          <div className="wfv-filter-right">
            <div className="wfv-search">
              <Icon name="search" size={14} className="wfv-search-icon" />
              <input
                type="text"
                placeholder="Filter by name, symbol, or address"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="wfv-search-input"
              />
              {query && (
                <button className="wfv-search-clear" onClick={() => setQuery('')} title="Clear">
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
            <button
              className={`wfv-tool-btn ${refreshing ? 'spinning' : ''}`}
              onClick={handleRefresh}
              title="Refresh"
              disabled={refreshing || !refresh}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
        </div>

        <div className="wfv-table-wrap">
          {sorted.length === 0 ? (
            <div className="wfv-empty">
              <Icon name="watchlist" size={40} />
              <p>{query || chainId !== 'all' ? 'No tokens match these filters' : 'This watchlist is empty'}</p>
              <span>{query || chainId !== 'all' ? 'Try clearing filters' : 'Add tokens from the watchlist sidebar or import from DexScreener'}</span>
              {onImport && !query && chainId === 'all' && (
                <button className="wfv-empty-cta" onClick={onImport}>Import from DexScreener</button>
              )}
            </div>
          ) : (
            <table className="wfv-table">
              <thead>
                <tr>
                  <th className="wfv-th-rank">#</th>
                  <th className="wfv-th-token">
                    <button className="wfv-th-btn" onClick={() => setSort('token')}>
                      Token
                      {effectiveSort.key === 'token' && <span className={`wfv-sort-arrow ${effectiveSort.dir}`} />}
                    </button>
                  </th>
                  <th className="wfv-th-num">
                    <button className="wfv-th-btn" onClick={() => setSort('price')}>
                      Price
                      {effectiveSort.key === 'price' && <span className={`wfv-sort-arrow ${effectiveSort.dir}`} />}
                    </button>
                  </th>
                  <th className="wfv-th-num highlight">
                    <button className="wfv-th-btn" onClick={() => setSort('marketCap')}>
                      MCAP
                      {effectiveSort.key === 'marketCap' && <span className={`wfv-sort-arrow ${effectiveSort.dir}`} />}
                    </button>
                  </th>
                  <th className="wfv-th-num">
                    <button className="wfv-th-btn" onClick={() => setSort('volume')}>
                      Volume
                      {effectiveSort.key === 'volume' && <span className={`wfv-sort-arrow ${effectiveSort.dir}`} />}
                    </button>
                  </th>
                  <th className="wfv-th-num">
                    <button className="wfv-th-btn" onClick={() => setSort('change')}>
                      24H
                      {effectiveSort.key === 'change' && <span className={`wfv-sort-arrow ${effectiveSort.dir}`} />}
                    </button>
                  </th>
                  <th className="wfv-th-num">
                    <button className="wfv-th-btn" onClick={() => setSort('liquidity')}>
                      Liquidity
                      {effectiveSort.key === 'liquidity' && <span className={`wfv-sort-arrow ${effectiveSort.dir}`} />}
                    </button>
                  </th>
                  <th className="wfv-th-spark">Trend</th>
                  <th className="wfv-th-actions"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((token, i) => {
                  const change = Number(token.change) || 0
                  const positive = change >= 0
                  const logo = getHardcodedLogo(token.address) || token.logo
                  const networkLabel = NETWORK_LABEL[token.networkId] || ''
                  const sparks = sparklinePrices[(token.address || '').toLowerCase()] || null
                  return (
                    <tr
                      key={token.address || token.symbol}
                      className={`wfv-row ${token.pinned ? 'pinned' : ''}`}
                      onClick={() => selectToken?.({
                        symbol: token.symbol,
                        name: token.name,
                        address: token.address,
                        networkId: token.networkId || 1,
                        price: token.price,
                        change: token.change,
                        logo: token.logo,
                      }, 'watchlist-fullview')}
                    >
                      <td className="wfv-td-rank"><span className="wfv-rank">#{i + 1}</span></td>
                      <td className="wfv-td-token">
                        <div className="wfv-token-cell">
                          <div className={`wfv-avatar ${logo ? 'has-logo' : ''}`}>
                            {logo ? (
                              <img src={logo} alt={token.symbol} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                            ) : (
                              <span>{(token.symbol || '?')[0]}</span>
                            )}
                          </div>
                          <div className="wfv-token-meta">
                            <div className="wfv-token-row1">
                              <span className="wfv-symbol">{token.symbol}</span>
                              {networkLabel && <span className="wfv-chain">{networkLabel}</span>}
                              {token.pinned && (
                                <span className="wfv-pin-mark" title="Pinned">
                                  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                                    <path d="M12 2 14 8 20 8 15 12 17 18 12 14 7 18 9 12 4 8 10 8z" />
                                  </svg>
                                </span>
                              )}
                            </div>
                            <span className="wfv-name">{token.name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="wfv-td-num mono">{formatPrice(token.price)}</td>
                      <td className="wfv-td-num mono highlight">{formatLargeUSD(token.marketCap)}</td>
                      <td className="wfv-td-num mono">{formatLargeUSD(token.volume24)}</td>
                      <td className={`wfv-td-num mono ${positive ? 'pos' : 'neg'}`}>
                        {formatChange(token.change)}
                      </td>
                      <td className="wfv-td-num mono">{formatLargeUSD(token.liquidity)}</td>
                      <td className="wfv-td-spark">
                        <TableSparkline prices={sparks} change={change} seed={token.address || token.symbol} />
                      </td>
                      <td className="wfv-td-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className={`wfv-action-btn ${token.pinned ? 'active' : ''}`}
                          onClick={() => togglePinWatchlist?.(token.address || token.symbol)}
                          title={token.pinned ? 'Unpin' : 'Pin to top'}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 17v5" />
                            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                          </svg>
                        </button>
                        <button
                          className="wfv-action-btn danger"
                          onClick={() => removeFromWatchlist?.(token.address || token.symbol)}
                          title="Remove"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="wfv-footer">
          <span className="wfv-hint">
            {sorted.length} {sorted.length === 1 ? 'token' : 'tokens'}
            {(query || chainId !== 'all' || quickFilter) && ` (filtered from ${activeTokens.length})`}
          </span>
          <span className="wfv-hint">Press <kbd>Esc</kbd> to close · double-click a tab to rename</span>
        </footer>
      </div>
    </div>
  )
}

export default WatchlistFullView
