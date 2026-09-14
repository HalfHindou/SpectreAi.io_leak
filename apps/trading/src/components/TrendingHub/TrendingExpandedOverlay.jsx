/**
 * TrendingExpandedOverlay - full-screen overlay for a single Trending section.
 * Reuses Spectre's table aesthetic; supports search, sort, chain/tf change.
 */
import React, { useEffect, useMemo, useState } from 'react'
import Icon from '../Icon'
import { screenTokens, getHardcodedLogo } from '../../services/codexApi'
import { fetchGtScreenerRows, gtOnlyNetworkFor } from '../../services/geckoTerminalApi'

const fmtUSD = (n) => {
  if (n == null || isNaN(Number(n)) || Number(n) === 0) return '—'
  const v = Number(n)
  if (v >= 1e12) return `$${(v/1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v/1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v/1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v/1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}
const fmtPrice = (n) => {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '$0.00'
  if (v >= 1000) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (v >= 1) return `$${v.toFixed(4)}`
  if (v >= 0.0001) return `$${v.toFixed(6)}`
  if (v > 0) return `$${v.toFixed(8)}`
  return '$0.00'
}
const fmtPct = (n) => {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function mapCodexRow(r) {
  const t = r.token || {}
  return {
    address: r.address || t.address || '',
    symbol: r.symbol || t.symbol || '',
    name: r.name || t.name || '',
    networkId: r.networkId || t.networkId || 1,
    price: parseFloat(r.price ?? r.priceUSD ?? t.price) || 0,
    change: parseFloat(r.change24h ?? r.change24 ?? r.priceChange24) || 0,
    marketCap: parseFloat(r.marketCap || t.marketCap) || 0,
    volume24: parseFloat(r.volume24h ?? r.volume24 ?? t.volume24) || 0,
    liquidity: parseFloat(r.liquidity || t.liquidity) || 0,
    logo: r.logo || t.imageThumbUrl || t.imageBannerUrl || t.imageUrl || t.logo || '',
  }
}

export default function TrendingExpandedOverlay({
  sectionId, sectionDef, chain: initialChain, tf: initialTf,
  initialRows = [], categories = [], onClose, selectToken,
  chainOptions, tfOptions,
}) {
  const [chain, setChain] = useState(initialChain)
  const [tf, setTf] = useState(initialTf)
  const [rows, setRows] = useState(initialRows)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  // Lock body scroll + ESC
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // For categories, reuse passed-in categories array (no Codex fetch)
  useEffect(() => {
    if (sectionId === 'categories') {
      setRows(categories || [])
      return
    }
    if (sectionId === 'trending-cg') {
      // Already populated from initialRows; refetch optional
      setRows(initialRows)
      return
    }
    let cancelled = false
    setLoading(true)
    const networkIds = chainOptions.find((c) => c.id === chain)?.networkIds || [1]
    // GT-only chains (Robinhood): Codex can't screen them - sort the cached GT
    // pool list client-side per section instead.
    const gtNet = gtOnlyNetworkFor(networkIds)
    if (gtNet) {
      const kind = sectionId === 'new-pairs' ? 'new' : 'top'
      fetchGtScreenerRows(gtNet, { kind })
        .then((gtRows) => {
          if (cancelled) return
          const chg = { '5m': 'change5m', '1h': 'change1h', '6h': 'change4h', '24h': 'change' }[tf] || 'change'
          const out = [...gtRows]
          if (sectionId === 'top-gainers')          out.sort((a, b) => (b[chg] || 0) - (a[chg] || 0))
          else if (sectionId === 'top-losers')      out.sort((a, b) => (a[chg] || 0) - (b[chg] || 0))
          else if (sectionId === 'most-traded')     out.sort((a, b) => (b.txns || 0) - (a.txns || 0))
          else if (sectionId === 'new-pairs')       out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          else                                      out.sort((a, b) => (b.volume24 || 0) - (a.volume24 || 0))
          setRows(out)
        })
        .catch(() => { if (!cancelled) setRows([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }
    const codexChangeAttr = { '5m': 'change5m', '1h': 'change1', '6h': 'change4', '24h': 'change24' }[tf] || 'change24'
    const sortBy =
      sectionId === 'top-gainers' || sectionId === 'top-losers' ? codexChangeAttr
      : sectionId === 'volume-leaders' ? 'volume24'
      : sectionId === 'most-traded' ? 'txnCount24'
      : sectionId === 'new-pairs' ? 'createdAt'
      : 'volume24'
    const sortDirInternal = sectionId === 'top-losers' ? 'ASC' : 'DESC'
    const filters = { liquidity: { gte: sectionId === 'new-pairs' ? 1000 : 5000 } }
    screenTokens(filters, { networks: networkIds, sort: sortBy, sortDir: sortDirInternal, limit: 200 })
      .then((results) => {
        if (cancelled) return
        let out = (results || []).map(mapCodexRow)
        if (sectionId === 'top-gainers') out.sort((a, b) => (b.change || 0) - (a.change || 0))
        if (sectionId === 'top-losers')  out.sort((a, b) => (a.change || 0) - (b.change || 0))
        setRows(out)
      })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sectionId, chain, tf, chainOptions, categories, initialRows])

  const filtered = useMemo(() => {
    if (!query.trim()) return rows
    const q = query.trim().toLowerCase()
    return rows.filter((r) =>
      (r.symbol || r.name || '').toLowerCase().includes(q) ||
      (r.name || '').toLowerCase().includes(q) ||
      (r.address || '').toLowerCase().includes(q)
    )
  }, [rows, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const accessor = {
      price: (r) => Number(r.price) || 0,
      change: (r) => Number(r.change) || 0,
      marketCap: (r) => Number(r.marketCap) || 0,
      volume: (r) => Number(r.volume24) || 0,
      liquidity: (r) => Number(r.liquidity) || 0,
      symbol: (r) => (r.symbol || '').toLowerCase(),
    }[sortKey]
    if (!accessor) return filtered
    const out = [...filtered].sort((a, b) => {
      const av = accessor(a); const bv = accessor(b)
      if (typeof av === 'string') return av.localeCompare(bv)
      return av - bv
    })
    return sortDir === 'desc' ? out.reverse() : out
  }, [filtered, sortKey, sortDir])

  const setSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'symbol' ? 'asc' : 'desc') }
  }

  const isCategoriesView = sectionId === 'categories'

  return (
    <div className="thx-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 2147483646,
      background: 'rgba(8,8,12,0.85)',
      backdropFilter: 'blur(16px) saturate(140%)',
      WebkitBackdropFilter: 'blur(16px) saturate(140%)',
      display: 'flex', flexDirection: 'column',
    }}>
      <header className="thx-head">
        <button className="thx-close" onClick={onClose} title="Close (Esc)">
          <Icon name="close" size={16} />
        </button>
        <div className="thx-title-block">
          <h2 className="thx-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden style={{ display: 'inline-flex', width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: `${sectionDef?.accent || '#fff'}22`, color: sectionDef?.accent || '#fff' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2-6 4 12 2-9 2 6 4-3" /></svg>
            </span>
            {sectionDef?.title}
          </h2>
          <span className="thx-subtitle">{sectionDef?.desc}</span>
        </div>

        {!isCategoriesView && sectionId !== 'trending-cg' && (
          <div className="thx-controls">
            <div className="th-chain-pills">
              {chainOptions.map((c) => (
                <button key={c.id} className={`th-pill chain${chain === c.id ? ' active' : ''}`} onClick={() => setChain(c.id)}>{c.short}</button>
              ))}
            </div>
            <div className="th-tf-pills">
              {tfOptions.map((t) => (
                <button key={t.id} className={`th-pill${tf === t.id ? ' active' : ''}`} onClick={() => setTf(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="thx-toolbar">
        <div className="thx-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder={isCategoriesView ? 'Filter categories…' : 'Filter by name, symbol, or address'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button onClick={() => setQuery('')}><Icon name="close" size={12} /></button>}
        </div>
        <span className="thx-count">{sorted.length} {sorted.length === 1 ? 'result' : 'results'}</span>
      </div>

      <div className="thx-body">
        {loading ? (
          <div className="th-skeleton">{[...Array(10)].map((_, i) => <div key={i} className="th-skeleton-row" />)}</div>
        ) : isCategoriesView ? (
          <div className="thx-cat-grid">
            {sorted.map((c) => {
              const change = Number(c.market_cap_change_24h) || 0
              return (
                <div key={c.id || c.name} className="thx-cat-card">
                  <span className="thx-cat-name">{c.name}</span>
                  <span className="thx-cat-mcap mono">{fmtUSD(c.market_cap)}</span>
                  <span className={`thx-cat-vol mono`}>Vol: {fmtUSD(c.volume_24h)}</span>
                  <span className={`thx-cat-change mono ${change >= 0 ? 'pos' : 'neg'}`}>{fmtPct(change)}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <table className="thx-table">
            <thead>
              <tr>
                <th>#</th>
                <th><button onClick={() => setSort('symbol')}>Token</button></th>
                <th className="num"><button onClick={() => setSort('price')}>Price</button></th>
                <th className="num"><button onClick={() => setSort('change')}>{tf.toUpperCase()}</button></th>
                <th className="num"><button onClick={() => setSort('marketCap')}>MCAP</button></th>
                <th className="num"><button onClick={() => setSort('volume')}>Volume</button></th>
                <th className="num"><button onClick={() => setSort('liquidity')}>Liquidity</button></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const change = Number(r.change) || 0
                const positive = change >= 0
                const logo = getHardcodedLogo(r.address) || r.logo
                return (
                  <tr
                    key={r.address || r.symbol || i}
                    onClick={() => selectToken?.({
                      symbol: r.symbol, name: r.name, address: r.address, networkId: r.networkId || 1,
                      price: r.price, change: r.change, logo: r.logo,
                    }, 'trending-expanded')}
                  >
                    <td><span className="th-rank">#{i + 1}</span></td>
                    <td>
                      <div className="thx-token-cell">
                        <div className={`th-avatar ${logo ? 'has-logo' : ''}`}>
                          {logo ? <img src={logo} alt={r.symbol} onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <span>{(r.symbol || '?')[0]}</span>}
                        </div>
                        <div className="th-token-meta">
                          <span className="th-symbol">{r.symbol}</span>
                          <span className="th-name">{r.name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="num mono">{fmtPrice(r.price)}</td>
                    <td className={`num mono ${positive ? 'pos' : 'neg'}`}>{fmtPct(change)}</td>
                    <td className="num mono dim">{fmtUSD(r.marketCap)}</td>
                    <td className="num mono dim">{fmtUSD(r.volume24)}</td>
                    <td className="num mono dim">{fmtUSD(r.liquidity)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="thx-foot">
        <span>Press <kbd>Esc</kbd> to close · click a row to open in terminal</span>
      </footer>
    </div>
  )
}
