/**
 * InlineWatchlistPanel - Watchlist sidebar in horizontal desktop layout
 * This is the INLINE version for the horizontal layout - NOT the extracted WatchlistPanel
 * used in the original/mobile layout (those have diverged: this one has 8-item limit, simpler).
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getStockLogo } from '@/constants/stockData'
import { formatChange } from './welcome-page-helpers'
import { getTokenAvatarRingStyle } from '@/constants/tokenColors'
import { TOKEN_LOGOS } from './welcome-page-constants'
import { getCategories, getCategoryCoins } from '@/services/coinGeckoApi'
import { getBinancePrices } from '@/services/binanceApi'
import { hoverIntent, allowDataPrefetch, prefetchRoute } from '@/lib/route-prefetch'
import { prewarmResearchZone } from '@/lib/rz-prewarm'

// Showcase-embed detection (matches BriefAudioPlayer + TokenCardPopup).
// Locks the "See All" CTA when iframed into spectreai.io/website2 so it
// can't deep-link users out of the demo frame to the full Watchlists page.
const isShowcaseEmbed = (() => {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (params.get('demo') === 'true') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
})()

// ─── Curated narrative categories (CoinGecko IDs) ───
const CURATED_NARRATIVES = [
  { id: 'meme-token', label: 'Meme Coins' },
  { id: 'artificial-intelligence', label: 'AI & Big Data' },
  { id: 'decentralized-finance-defi', label: 'DeFi' },
  { id: 'layer-2', label: 'Layer 2' },
  { id: 'real-world-assets-rwa', label: 'RWA' },
  { id: 'gaming', label: 'GameFi' },
  { id: 'decentralized-exchange', label: 'DEX Tokens' },
  { id: 'layer-1', label: 'Layer 1' },
  { id: 'nft', label: 'NFT' },
  { id: 'privacy-coins', label: 'Privacy' },
  { id: 'liquid-staking-tokens', label: 'Liquid Staking' },
  { id: 'exchange-based-tokens', label: 'Exchange Tokens' },
]

// ─── Narrative card with coin stack, mcap, real-time Binance prices ───
const REALTIME_INTERVAL = 10_000

const NarrativeCard = ({ narrative, categoryData, selectToken, fmtPrice, fmtLarge }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [tokens, setTokens] = useState([])
  const [realtimePrices, setRealtimePrices] = useState({})
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef(null)

  const change = categoryData?.market_cap_change_24h ?? 0
  const mcap = categoryData?.market_cap
  const top3 = categoryData?.top_3_coins || []

  const fetchRealtime = useCallback(async (tokenList) => {
    if (!tokenList?.length) return
    const symbols = tokenList.map(c => (c.symbol || '').toUpperCase()).filter(Boolean)
    if (!symbols.length) return
    try {
      const prices = await getBinancePrices(symbols)
      if (prices && Object.keys(prices).length > 0) {
        setRealtimePrices(prev => {
          let changed = false
          for (const sym of Object.keys(prices)) {
            if (!prev[sym] || prev[sym].price !== prices[sym]?.price) { changed = true; break }
          }
          return changed ? { ...prev, ...prices } : prev
        })
      }
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    if (!expanded) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [expanded])

  const handleExpand = async () => {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (tokens.length > 0) {
      fetchRealtime(tokens)
      intervalRef.current = setInterval(() => { if (!document.hidden) fetchRealtime(tokens) }, REALTIME_INTERVAL)
      return
    }
    setLoading(true)
    try {
      const data = await getCategoryCoins(narrative.id, 1, 6)
      setTokens(data || [])
      if (data?.length > 0) {
        fetchRealtime(data)
        intervalRef.current = setInterval(() => { if (!document.hidden) fetchRealtime(data) }, REALTIME_INTERVAL)
      }
    } catch { setTokens([]) }
    setLoading(false)
  }

  return (
    <div className={`narrative-card${expanded ? ' expanded' : ''}`}>
      <button type="button" className="narrative-card-header" onClick={handleExpand}>
        <div className="narrative-coin-stack">
          {top3.slice(0, 3).map((url, i) => (
            <img key={i} src={url} alt="" loading="lazy" decoding="async" width="24" height="24" className="narrative-coin-stack-img" style={{ zIndex: 3 - i }} />
          ))}
          {top3.length === 0 && <div className="narrative-coin-stack-placeholder">{narrative.label[0]}</div>}
        </div>
        <div className="narrative-header-text">
          <span className="narrative-card-label">{narrative.label}</span>
          {mcap != null && fmtLarge && <span className="narrative-card-mcap">{fmtLarge(mcap)}</span>}
        </div>
        <div className="narrative-header-stats">
          <span className={`narrative-card-change ${change >= 0 ? 'positive' : 'negative'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        </div>
        <svg className={`narrative-card-chevron ${expanded ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="narrative-card-tokens">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="narrative-token-skeleton"><div className="animate-shimmer" /></div>)
          ) : tokens.length > 0 ? (
            tokens.map(t => {
              const sym = (t.symbol || '').toUpperCase()
              const rt = realtimePrices[sym]
              const price = (rt?.price > 0 ? rt.price : null) ?? t.current_price
              const chg = rt?.change ?? t.price_change_percentage_24h ?? 0
              const isPos = chg >= 0
              return (
                <div
                  key={t.id}
                  className="narrative-token-row"
                  onClick={() => selectToken?.(sym)}
                  {...hoverIntent(() => {
                    if (!allowDataPrefetch()) return
                    prewarmResearchZone(sym)
                    prefetchRoute('research-zone')
                  })}
                >
                  <div className="narrative-token-logo">
                    {t.image ? <img src={t.image} alt="" loading="lazy" decoding="async" width="24" height="24" /> : <span>{sym[0]}</span>}
                  </div>
                  <div className="narrative-token-info">
                    <span className="narrative-token-symbol">{sym}</span>
                    <span className="narrative-token-name">{t.name}</span>
                  </div>
                  <div className="narrative-token-stats">
                    <span className="narrative-token-price">{fmtPrice?.(price) || `$${price?.toFixed(2)}`}</span>
                    <span className={`narrative-token-change ${isPos ? 'positive' : 'negative'}`}>
                      {isPos ? '+' : ''}{chg.toFixed(2)}%
                    </span>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="narrative-no-tokens">{t('homePage.inlineWatchlistPanel.narrative.noData', "No data")}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Stock sector card (Stocks mode) — same chrome as NarrativeCard but driven
// by the already-live stock list (no extra fetch). Expands to the sector's
// biggest constituents with their live prices. ───
const StockSectorCard = ({ sector, fmtPrice, fmtLarge, handleStockClick }) => {
  const [expanded, setExpanded] = useState(false)
  const change = Number(sector.change) || 0
  return (
    <div className={`narrative-card${expanded ? ' expanded' : ''}`}>
      <button type="button" className="narrative-card-header" onClick={() => setExpanded((e) => !e)}>
        <div className="narrative-coin-stack">
          {sector.topLogos.slice(0, 3).map((url, i) => (
            <img key={i} src={url} alt="" loading="lazy" decoding="async" width="24" height="24" className="narrative-coin-stack-img" style={{ zIndex: 3 - i }} />
          ))}
          {sector.topLogos.length === 0 && <div className="narrative-coin-stack-placeholder">{sector.label[0]}</div>}
        </div>
        <div className="narrative-header-text">
          <span className="narrative-card-label">{sector.label}</span>
          {sector.marketCap > 0 && fmtLarge && <span className="narrative-card-mcap">{fmtLarge(sector.marketCap)}</span>}
        </div>
        <div className="narrative-header-stats">
          <span className={`narrative-card-change ${change >= 0 ? 'positive' : 'negative'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        </div>
        <svg className={`narrative-card-chevron ${expanded ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="narrative-card-tokens">
          {sector.stocks.map((s) => {
            const isPos = (Number(s.change) || 0) >= 0
            return (
              <div key={s.symbol} className="narrative-token-row" onClick={() => handleStockClick?.({ symbol: s.symbol, name: s.name, isStock: true })}>
                <div className="narrative-token-logo">
                  {s.logo ? <img src={s.logo} alt="" loading="lazy" decoding="async" width="24" height="24" /> : <span>{s.symbol[0]}</span>}
                </div>
                <div className="narrative-token-info">
                  <span className="narrative-token-symbol">{s.symbol}</span>
                  <span className="narrative-token-name">{s.name}</span>
                </div>
                <div className="narrative-token-stats">
                  <span className="narrative-token-price">{fmtPrice?.(s.price) || `$${(Number(s.price) || 0).toFixed(2)}`}</span>
                  <span className={`narrative-token-change ${isPos ? 'positive' : 'negative'}`}>
                    {isPos ? '+' : ''}{(Number(s.change) || 0).toFixed(2)}%
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

const InlineWatchlistPanel = ({
  watchlistOpen, setWatchlistOpen,
  watchlistSearchQuery, setWatchlistSearchQuery,
  watchlistSearchLoading, watchlistSearchResults,
  watchlistSearchContainerRef2,
  watchlist, watchlistWithLiveData, sortedWatchlist,
  addToWatchlist, removeFromWatchlist, togglePinWatchlist,
  openTokenCardPopup, handleStockClick, onPageChange,
  fmtPrice, fmtLarge,
  EMPTY_STYLE,
  isStocks, t,
  reorderWatchlist, getSortedWatchlist,
  topCoinPrices, topCoins, stockList,
}) => {
  const { t: tr } = useTranslation()
  const [activeTab, setActiveTab] = useState('watchlist')
  const [categoryData, setCategoryData] = useState({})

  // Stock sectors (Stocks mode) — group the live stock list by sector, ranked
  // by aggregate market cap, with an mcap-weighted sector change.
  const stockSectors = useMemo(() => {
    if (!isStocks || !Array.isArray(stockList) || !stockList.length) return []
    const SKIP = new Set(['index', 'index/etf', 'etf', 'commodity', 'commodities'])
    const groups = {}
    for (const s of stockList) {
      const sector = s.sector || 'Other'
      if (SKIP.has(sector.toLowerCase())) continue
      ;(groups[sector] ||= []).push(s)
    }
    return Object.entries(groups)
      .map(([label, stocks]) => {
        const sorted = stocks.slice().sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
        const mcap = sorted.reduce((sum, s) => sum + (s.marketCap || 0), 0)
        const change = mcap > 0
          ? sorted.reduce((sum, s) => sum + (Number(s.change) || 0) * (s.marketCap || 0), 0) / mcap
          : sorted.reduce((sum, s) => sum + (Number(s.change) || 0), 0) / (sorted.length || 1)
        return {
          id: label,
          label,
          marketCap: mcap,
          change,
          stocks: sorted.slice(0, 8),
          topLogos: sorted.slice(0, 3).map((s) => s.logo).filter(Boolean),
        }
      })
      .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
  }, [isStocks, stockList])
  const [draggedItem, setDraggedItem] = useState(null)
  const [dragOverItem, setDragOverItem] = useState(null)

  // Fetch category data for narrative change % — refresh while the tab is open
  // (was one-shot: it loaded once and froze for the whole session = stale).
  useEffect(() => {
    if (activeTab !== 'narratives') return undefined
    let cancelled = false
    const load = () => {
      getCategories()
        .then(cats => {
          if (cancelled || !cats) return
          const map = {}
          cats.forEach(c => { map[c.id] = c })
          setCategoryData(map)
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 3 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeTab])

  /* Suggested tokens for empty state — top coins with live price data, excluding stablecoins */
  const STABLES = useMemo(() => new Set(['USDT', 'USDC', 'DAI', 'BUSD']), [])
  const suggestedTokens = useMemo(() => {
    if (!topCoins || !topCoinPrices || isStocks) return []
    return topCoins
      .filter(c => !STABLES.has(c.symbol) && topCoinPrices[c.symbol]?.price > 0)
      .slice(0, 6)
      .map(c => ({
        ...c,
        logo: TOKEN_LOGOS[c.symbol],
        price: topCoinPrices[c.symbol]?.price,
        change: topCoinPrices[c.symbol]?.change,
      }))
  }, [topCoins, topCoinPrices, isStocks, STABLES])

  const handleDragStart = (e, index, item) => {
    setDraggedItem({ index, item })
    if (e.target) e.target.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    // Suppress the browser's native drag-image (1x1 transparent gif).
    // Inside the showcase iframe a stale ghost would otherwise paint a
    // token-colored block over the source row when dragend doesn't fire.
    try {
      const ghost = document.createElement('span')
      ghost.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0'
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 0, 0)
      setTimeout(() => ghost.remove(), 0)
    } catch (_) { /* not all browsers support setDragImage */ }
  }
  const handleDragEnter = (e, index) => {
    if (draggedItem === null) return
    if (index !== draggedItem.index) setDragOverItem(index)
  }
  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const handleDragEnd = (e) => {
    if (e.target) e.target.classList.remove('dragging')
    if (draggedItem !== null && dragOverItem !== null && draggedItem.index !== dragOverItem) {
      const sorted = getSortedWatchlist ? getSortedWatchlist() : sortedWatchlist
      const newList = [...sorted]
      const [removed] = newList.splice(draggedItem.index, 1)
      newList.splice(dragOverItem, 0, removed)
      if (reorderWatchlist) reorderWatchlist(newList)
    }
    setDraggedItem(null)
    setDragOverItem(null)
  }
  return (
    <div className={`welcome-watchlist-panel-wrap${!watchlistOpen ? ' is-collapsed' : ''}`}>
      {/* Toggle button to collapse/expand watchlist */}
      <button
        type="button"
        className={`welcome-sidebar-toggle welcome-sidebar-toggle--right${!watchlistOpen ? ' is-closed-panel' : ''}`}
        onClick={() => setWatchlistOpen((o) => !o)}
        title={watchlistOpen ? 'Close watchlist' : 'Open watchlist'}
        aria-label={watchlistOpen ? 'Close watchlist' : 'Open watchlist'}
      >
        <span className="welcome-sidebar-toggle-icon">
          {watchlistOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
          )}
        </span>
      </button>
      {/* Closed-state preview: vertical stack of watchlist token logos with mini change chips */}
      {!watchlistOpen && (
        <div
          className="welcome-watchlist-collapsed-preview"
          onClick={() => setWatchlistOpen(true)}
          role="button"
          tabIndex={0}
          aria-label={tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.ariaExpandWatchlist', "Expand watchlist")}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWatchlistOpen(true) } }}
        >
          <div className="welcome-watchlist-collapsed-label">{tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.watchlist', "Watchlist")}</div>
          <div className="welcome-watchlist-collapsed-stack">
            {(sortedWatchlist || []).slice(0, 8).map((token) => {
              const change = Number(token.change) || 0
              return (
                <div
                  key={token.address || token.symbol}
                  className={`welcome-watchlist-collapsed-tile ${change >= 0 ? 'positive' : 'negative'}`}
                  data-tooltip={`${token.symbol} ${change >= 0 ? '+' : ''}${formatChange(token.change)}%`}
                  data-tooltip-pos="left"
                >
                  {token.logo ? (
                    <img src={token.logo} alt={token.symbol} loading="lazy" decoding="async" width="22" height="22" />
                  ) : (
                    <span className="welcome-watchlist-collapsed-tile-fallback">{token.symbol?.[0] || '?'}</span>
                  )}
                  <span className="welcome-watchlist-collapsed-tile-dot" aria-hidden />
                </div>
              )
            })}
            {(!sortedWatchlist || sortedWatchlist.length === 0) && (
              <div className="welcome-watchlist-collapsed-empty">{tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.empty', "empty")}</div>
            )}
          </div>
        </div>
      )}
      <div className={`welcome-watchlist-widget welcome-watchlist-widget--dark${!watchlistOpen ? ' is-hidden' : ''}`}>
        <div className="welcome-watchlist-inner watchlist welcome-watchlist-inner--no-pad">
          <div className="watchlist-header-row">
            <button
              type="button"
              className="watchlist-panel-toggle"
              onClick={() => setWatchlistOpen((o) => !o)}
              title={watchlistOpen ? 'Close watchlist' : 'Open watchlist'}
              aria-label={watchlistOpen ? 'Close watchlist' : 'Open watchlist'}
            >
              {watchlistOpen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
              )}
            </button>
            <div className="watchlist-tab-toggle">
              <button
                type="button"
                className={`watchlist-tab-btn ${activeTab === 'watchlist' ? 'active' : ''}`}
                onClick={() => setActiveTab('watchlist')}
              >
                {tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.myWatchlist', "My Watchlist")}
              </button>
              <button
                type="button"
                className={`watchlist-tab-btn ${activeTab === 'narratives' ? 'active' : ''}`}
                onClick={() => setActiveTab('narratives')}
              >
                {isStocks ? 'Sectors' : 'Narratives'}
              </button>
              <div className="watchlist-tab-slider" style={{ transform: activeTab === 'narratives' ? 'translateX(100%)' : 'translateX(0)' }} />
            </div>
            {activeTab === 'watchlist' && (
              <button
                type="button"
                className={`watchlist-see-all-btn${isShowcaseEmbed ? ' is-locked' : ''}`}
                onClick={(e) => { if (isShowcaseEmbed) { e.preventDefault(); return } onPageChange?.('watchlists') }}
                aria-disabled={isShowcaseEmbed || undefined}
                title={isShowcaseEmbed ? 'Available in Beta' : undefined}
              >
                {t('ui.seeAll')}
                {isShowcaseEmbed ? (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                )}
              </button>
            )}
          </div>
          {/* ── NARRATIVES TAB ── */}
          {activeTab === 'narratives' && (
            <div className="narratives-list">
              {isStocks
                ? stockSectors.map((sec) => (
                    <StockSectorCard
                      key={sec.id}
                      sector={sec}
                      fmtPrice={fmtPrice}
                      fmtLarge={fmtLarge}
                      handleStockClick={handleStockClick}
                    />
                  ))
                : CURATED_NARRATIVES.map((n) => (
                    <NarrativeCard
                      key={n.id}
                      narrative={n}
                      categoryData={categoryData[n.id]}
                      selectToken={(sym) => openTokenCardPopup(sym)}
                      fmtPrice={fmtPrice}
                      fmtLarge={fmtLarge}
                    />
                  ))}
            </div>
          )}
          {/* ── WATCHLIST TAB ── */}
          {activeTab === 'watchlist' && addToWatchlist && (
            <div className="watchlist-add-row" ref={watchlistSearchContainerRef2}>
              <input
                type="text"
                className="watchlist-add-search"
                placeholder={isStocks ? t('ui.searchStockToAdd') : t('ui.searchTokenToAdd')}
                value={watchlistSearchQuery}
                onChange={(e) => setWatchlistSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    const first = e.target.closest('.watchlist-add-row')?.querySelector('.watchlist-search-result')
                    if (first) first.focus()
                  } else if (e.key === 'Escape') {
                    setWatchlistSearchQuery('')
                  }
                }}
              />
              {watchlistSearchQuery.trim().length >= 1 && (
                <div className="watchlist-search-dropdown">
                  {watchlistSearchLoading && !(watchlistSearchResults?.length > 0) ? (
                    <div className="watchlist-search-loading">{t('ui.searching')}</div>
                  ) : watchlistSearchResults?.length > 0 ? (
                    watchlistSearchResults.slice(0, 6).map((r) => (
                      <button
                        key={`${r.address || r.cgId || r.symbol}-${r.networkId}`}
                        type="button"
                        className="watchlist-search-result"
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') { e.preventDefault(); e.target.nextElementSibling?.focus() }
                          else if (e.key === 'ArrowUp') { e.preventDefault(); e.target.previousElementSibling?.focus() || e.target.closest('.watchlist-add-row')?.querySelector('.watchlist-add-search')?.focus() }
                          else if (e.key === 'Escape') { setWatchlistSearchQuery(''); e.target.closest('.watchlist-add-row')?.querySelector('.watchlist-add-search')?.focus() }
                        }}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          addToWatchlist(isStocks ? {
                            symbol: r.symbol,
                            name: r.name,
                            price: r.price || 0,
                            change: r.change || 0,
                            marketCap: r.marketCap || 0,
                            volume: r.volume || 0,
                            logo: r.logo || getStockLogo(r.symbol, r.sector),
                            sector: r.sector || '',
                            exchange: r.exchange || 'NYSE',
                            pinned: false,
                            isStock: true,
                          } : {
                            symbol: r.symbol,
                            name: r.name,
                            // Store the EXACT identity the user picked (cgId +
                            // address). The price hook prices by this, never by
                            // symbol - otherwise a same-symbol collision (PROS:
                            // new Pharos vs old Prosper) binds the wrong token.
                            cgId: r.cgId || null,
                            address: r.address,
                            networkId: r.networkId || 1,
                            price: r.price,
                            change: r.change,
                            marketCap: r.marketCap,
                            logo: r.logo,
                            pinned: false,
                          })
                          setWatchlistSearchQuery('')
                        }}
                      >
                        <div className="search-result-left">
                          {r.logo && (
                            <img
                              src={r.logo}
                              alt=""
                              className="watchlist-search-result-img"
                              onError={(e) => {
                                const parent = e.target.parentElement
                                e.target.remove()
                                if (parent) {
                                  const span = document.createElement('span')
                                  span.className = 'watchlist-search-result-img watchlist-search-result-img--fallback'
                                  span.textContent = (r.symbol || '?').charAt(0).toUpperCase()
                                  parent.appendChild(span)
                                }
                              }}
                            />
                          )}
                          <div className="search-result-info">
                            <div className="search-result-top">
                              <span className="watchlist-search-result-symbol">{r.symbol}</span>
                              {r.network && <span className="search-result-chain">{r.network}</span>}
                            </div>
                            <span className="watchlist-search-result-name">{r.name}</span>
                          </div>
                        </div>
                        <div className="search-result-right">
                          <div className="search-result-price">{r.formattedPrice || fmtPrice(r.price)}</div>
                          <div className={`search-result-change ${(r.change || 0) >= 0 ? 'positive' : 'negative'}`}>
                            {(Number(r.change) || 0) >= 0 ? '\u2191' : '\u2193'} {Math.abs(Number(r.change) || 0).toFixed(2)}%
                          </div>
                        </div>
                        {r.marketCap > 0 && (
                          <div className="search-result-stat">
                            <span className="stat-label">{tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.mc', "MC")}</span>
                            <span className="stat-value">{r.formattedMcap || (fmtLarge ? fmtLarge(r.marketCap) : `$${(r.marketCap / 1e6).toFixed(1)}M`)}</span>
                          </div>
                        )}
                        {r.liquidity > 0 && (
                          <div className="search-result-stat">
                            <span className="stat-label">{tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.liq', "Liq")}</span>
                            <span className="stat-value">{r.formattedLiquidity || (fmtLarge ? fmtLarge(r.liquidity) : `$${(r.liquidity / 1e6).toFixed(1)}M`)}</span>
                          </div>
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="watchlist-search-empty">{isStocks ? 'No stocks found' : 'No tokens found'}</div>
                  )}
                </div>
              )}
            </div>
          )}
          {activeTab === 'watchlist' && <div className="watchlist-items">
            {sortedWatchlist?.length > 0 ? (
              sortedWatchlist.map((token, idx) => (
                <div
                  key={token.address || token.symbol || idx}
                  className={`watchlist-item ${token.pinned ? 'is-pinned' : ''}${dragOverItem === idx ? ' drag-over' : ''}`}
                  onClick={() => isStocks ? handleStockClick?.({ symbol: token.symbol, name: token.name, isStock: true }) : openTokenCardPopup(token.symbol)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx, token)}
                  onDragEnter={(e) => handleDragEnter(e, idx)}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                >
                  <div className="watchlist-item-drag">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                    </svg>
                  </div>
                  <div className="watchlist-item-info">
                    <div className="watchlist-item-avatar" style={getTokenAvatarRingStyle(token.symbol) || EMPTY_STYLE}>
                      {token.logo ? (
                        <img
                          src={token.logo}
                          alt=""
                          onError={(e) => {
                            // Workbox CacheFirst on assets.coingecko.com can
                            // wedge a broken response for up to 7d. Swap the
                            // img for the first-letter fallback so the avatar
                            // never renders as a blank circle.
                            const parent = e.target.parentElement
                            e.target.remove()
                            const span = document.createElement('span')
                            span.textContent = (token.symbol?.[0] || '?')
                            parent && parent.appendChild(span)
                          }}
                        />
                      ) : (
                        <span>{token.symbol?.[0] || '?'}</span>
                      )}
                    </div>
                    <div className="watchlist-item-text">
                      <span className="watchlist-item-symbol">{token.symbol}</span>
                      <span className="watchlist-item-name">{token.name}</span>
                    </div>
                  </div>
                  <div className="watchlist-item-stats">
                    <span className="watchlist-item-price">{token.price ? fmtPrice(token.price) : '-'}</span>
                    {token.change != null && (
                      <span className={`watchlist-item-change ${(Number(token.change) || 0) >= 0 ? 'positive' : 'negative'}`}>
                        {(Number(token.change) || 0) >= 0 ? '+' : ''}{formatChange(token.change)}%
                      </span>
                    )}
                    {token.marketCap > 0 && (
                      <span className="watchlist-item-mcap">{fmtLarge ? fmtLarge(token.marketCap) : `$${(token.marketCap / 1e6).toFixed(1)}M`}</span>
                    )}
                  </div>
                  <div className="watchlist-item-actions">
                    <button
                      type="button"
                      className="watchlist-item-remove"
                      data-tooltip={t('ui.removeFromWatchlist')}
                      data-tooltip-pos="left"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFromWatchlist && removeFromWatchlist(token.address || token.symbol)
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`watchlist-item-pin ${token.pinned ? 'active' : ''}`}
                      data-tooltip={token.pinned ? t('ui.unpin') : t('ui.pinToTop')}
                      data-tooltip-pos="left"
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePinWatchlist && togglePinWatchlist(token.address || token.symbol)
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill={token.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.76z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            ) : suggestedTokens.length > 0 ? (
              <div className="watchlist-suggestions">
                <div className="watchlist-suggestions-header">
                  <span className="watchlist-suggestions-label">{tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.suggested', "Suggested")}</span>
                </div>
                {suggestedTokens.map((token) => (
                  <div
                    key={token.symbol}
                    className="watchlist-suggestion-item"
                    onClick={() => openTokenCardPopup(token.symbol)}
                  >
                    <button
                      type="button"
                      className="watchlist-suggestion-add"
                      title={tr('homePage.inlineWatchlistPanel.inlinewatchlistpanel.title', "Add to watchlist")}
                      onClick={(e) => {
                        e.stopPropagation()
                        addToWatchlist({
                          symbol: token.symbol,
                          name: token.name,
                          address: token.address,
                          networkId: token.networkId || 1,
                          price: token.price,
                          change: token.change,
                          logo: token.logo,
                          pinned: false,
                        })
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                    <div className="watchlist-item-info">
                      <div className="watchlist-item-avatar" style={getTokenAvatarRingStyle(token.symbol) || EMPTY_STYLE}>
                        {token.logo ? (
                          <img src={token.logo} alt="" loading="lazy" decoding="async" width="28" height="28" />
                        ) : (
                          <span>{token.symbol?.[0] || '?'}</span>
                        )}
                      </div>
                      <div className="watchlist-item-text">
                        <span className="watchlist-item-symbol">{token.symbol}</span>
                        <span className="watchlist-item-name">{token.name}</span>
                      </div>
                    </div>
                    <div className="watchlist-item-stats">
                      <span className="watchlist-item-price">{token.price ? fmtPrice(token.price) : '-'}</span>
                      {token.change != null && (
                        <span className={`watchlist-item-change ${(Number(token.change) || 0) >= 0 ? 'positive' : 'negative'}`}>
                          {(Number(token.change) || 0) >= 0 ? '+' : ''}{formatChange(token.change)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="watchlist-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                <p>{t('ui.watchlistEmpty')}</p>
                <span>{t('ui.watchlistEmptyHint')}</span>
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  )
}

export default InlineWatchlistPanel
