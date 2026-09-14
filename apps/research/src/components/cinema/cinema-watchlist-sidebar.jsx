/**
 * CinemaWatchlistSidebar - Glassmorphic watchlist panel
 *
 * Features:
 * - Toggle between My Watchlist and Trending Narratives
 * - Slide-in panel from right
 * - Token brand gradient on each row (matching LeftPanel design)
 * - Pin/remove buttons on left (appear on hover)
 * - Drag handles for reordering
 * - Trending Narratives: CoinGecko categories with expandable token lists
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TOKEN_ROW_COLORS, getTokenRowStyle, getTokenAvatarRingStyle } from '@/constants/tokenColors'
import { logError } from '@/lib/logger'
import { searchCoinsForROI, getCategories, getCategoryCoins } from '@/services/coinGeckoApi'
import { getStockLogoUrl } from '@/services/stockApi'
import { useCurrency } from '@/hooks/useCurrency'

// Token logos
const TOKEN_LOGOS = {
  'BTC': 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  'ETH': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  'SOL': 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  'BNB': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  'XRP': 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  'ADA': 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  'DOGE': 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  'AVAX': 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  'LINK': 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  'UNI': 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg',
  'MATIC': 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  'ARB': 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  'PEPE': 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  'SPECTRE': '/round-logo.png',
}

// Quick-add suggestions
const QUICK_ADD_TOKENS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'LINK', name: 'Chainlink' },
  { symbol: 'ARB', name: 'Arbitrum' },
  { symbol: 'AVAX', name: 'Avalanche' },
  { symbol: 'PEPE', name: 'Pepe' },
  { symbol: 'UNI', name: 'Uniswap' },
]


// ═══════════════════════════════════════════════════════════════════════════════
// WATCHLIST ITEM - Matches LeftPanel design: gradient bg, pin/remove on left, drag
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaWatchlistItem = ({
  symbol,
  name,
  price,
  change,
  marketCap,
  address,
  cgId,
  index,
  pinned,
  onClick,
  onRemove,
  onTogglePin,
  logo: logoProp,
  isStock,
  draggable,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDragEnd,
}) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const changeNum = typeof change === 'string' ? parseFloat(change) : (change || 0)
  const isPositive = changeNum >= 0
  const logo = TOKEN_LOGOS[symbol] || logoProp || (isStock ? getStockLogoUrl(symbol) : '')
  const rowStyle = getTokenRowStyle(symbol) || {}
  const mcFormatted = marketCap ? fmtLarge(marketCap) : ''

  return (
    <div
      className={`cinema-watchlist-item ${pinned ? 'pinned' : ''}`}
      style={{ '--item-index': index, ...rowStyle }}
      // address + cgId identify the exact asset — a symbol-only payload made
      // selectToken resolve ambiguous tickers to the wrong same-symbol token.
      onClick={() => onClick?.({ symbol, name, price, change, isStock, address, cgId })}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      {/* Token brand gradient overlay (shown on hover + pinned) */}
      <div className="cinema-watchlist-item-gradient" />

      {/* Left action buttons - appear on hover */}
      <div className="cinema-watchlist-item-actions">
        <button
          className="cinema-watchlist-action-btn cinema-watchlist-remove-btn"
          onClick={(e) => { e.stopPropagation(); onRemove?.(symbol) }}
          title={t('token.removeFromWatchlist')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        {/* Drag handle dots */}
        <div className="cinema-watchlist-drag-dots">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>
        <button
          className={`cinema-watchlist-action-btn cinema-watchlist-pin-btn ${pinned ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onTogglePin?.(symbol) }}
          title={pinned ? t('watchlist.unpin') : t('leftPanel.pinToTop')}
        >
          <svg viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.76z" />
          </svg>
        </button>
      </div>

      {/* Logo with avatar ring */}
      <div className="cinema-watchlist-item-logo">
        {logo ? (
          <img src={logo} alt={symbol} onError={isStock ? (e) => { e.target.style.display = 'none' } : undefined} />
        ) : (
          <span className="cinema-watchlist-item-logo-fallback">{(symbol || '?')[0]}</span>
        )}
      </div>

      {/* Token identity */}
      <div className="cinema-watchlist-item-info">
        <span className="cinema-watchlist-item-symbol">{symbol}</span>
        <span className="cinema-watchlist-item-name">{name || symbol}</span>
      </div>

      {/* Stats: price, change, mcap - right-aligned */}
      <div className="cinema-watchlist-item-stats">
        <span className="cinema-watchlist-item-price-value">{fmtPrice(price)}</span>
        <span className={`cinema-watchlist-item-change ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{changeNum.toFixed(2)}%
        </span>
        {mcFormatted && <span className="cinema-watchlist-item-mcap">{mcFormatted}</span>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CURATED NARRATIVES - hand-picked trending categories
// ═══════════════════════════════════════════════════════════════════════════════

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

const NarrativeTokenRow = ({ coin, onClick, fmtPrice, fmtLarge }) => {
  const change = coin.price_change_percentage_24h || 0
  const isPositive = change >= 0
  return (
    <div
      className="narrative-token-row"
      onClick={() => onClick?.({ symbol: coin.symbol?.toUpperCase(), name: coin.name })}
    >
      <div className="narrative-token-logo">
        {coin.image ? (
          <img src={coin.image} alt={coin.symbol} />
        ) : (
          <span className="narrative-token-logo-fallback">{(coin.symbol || '?')[0]}</span>
        )}
      </div>
      <div className="narrative-token-info">
        <span className="narrative-token-symbol">{coin.symbol?.toUpperCase()}</span>
        <span className="narrative-token-name">{coin.name}</span>
      </div>
      <div className="narrative-token-stats">
        <span className="narrative-token-price">{fmtPrice(coin.current_price)}</span>
        <span className={`narrative-token-change ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '+' : ''}{change.toFixed(2)}%
        </span>
      </div>
    </div>
  )
}

const NarrativeCard = ({ narrative, categoryData, selectToken, fmtPrice, fmtLarge }) => {
  const [expanded, setExpanded] = useState(false)
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(false)

  const catInfo = categoryData?.find(c => c.id === narrative.id)
  const mcapChange = catInfo?.market_cap_change_24h

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (tokens.length > 0) return
    setLoading(true)
    try {
      const data = await getCategoryCoins(narrative.id, 1, 8)
      setTokens(data || [])
    } catch (err) { logError('cinemaWatchlistSidebar:getCategoryCoins', err); setTokens([]) }
    setLoading(false)
  }

  return (
    <div className={`narrative-card ${expanded ? 'expanded' : ''}`}>
      <button className="narrative-card-header" onClick={handleExpand}>
        <span className="narrative-card-label">{narrative.label}</span>
        {mcapChange != null && (
          <span className={`narrative-card-change ${mcapChange >= 0 ? 'positive' : 'negative'}`}>
            {mcapChange >= 0 ? '+' : ''}{mcapChange.toFixed(1)}%
          </span>
        )}
        <svg className={`narrative-card-chevron ${expanded ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="narrative-card-tokens">
          {loading ? (
            <>
              <div className="narrative-token-skeleton"><div className="animate-shimmer" /></div>
              <div className="narrative-token-skeleton"><div className="animate-shimmer" /></div>
              <div className="narrative-token-skeleton"><div className="animate-shimmer" /></div>
            </>
          ) : tokens.length === 0 ? (
            <div className="narrative-no-tokens">No tokens found</div>
          ) : (
            tokens.map(coin => (
              <NarrativeTokenRow
                key={coin.id}
                coin={coin}
                onClick={selectToken}
                fmtPrice={fmtPrice}
                fmtLarge={fmtLarge}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const CinemaWatchlistSidebar = ({
  dayMode,
  watchlist,
  watchlists,
  activeWatchlistId,
  onSwitchWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
  togglePinWatchlist,
  reorderWatchlist,
  selectToken,
  topCoinPrices,
  onPageChange,
  isOpen = true,
  onToggle,
}) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const setIsOpen = onToggle ? (v) => onToggle(typeof v === 'function' ? v(isOpen) : v) : () => {}
  const [activeTab, setActiveTab] = useState('watchlist') // 'watchlist' | 'narratives'
  const [categoryData, setCategoryData] = useState([])
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const searchInputRef = useRef(null)
  const searchTimerRef = useRef(null)

  // Drag state
  const [draggedItem, setDraggedItem] = useState(null)
  const [dragOverItem, setDragOverItem] = useState(null)
  const dragNodeRef = useRef(null)

  // Fetch category data when narratives tab opens
  useEffect(() => {
    if (activeTab !== 'narratives' || categoryData.length > 0) return
    getCategories().then(data => setCategoryData(data || [])).catch((err) => logError('cinemaWatchlistSidebar:getCategories', err))
  }, [activeTab])

  // Focus input when search opens
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [showSearch])

  // Debounced search
  const handleSearchChange = useCallback((query) => {
    setSearchQuery(query)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (query.length < 2) {
      setSearchResults([])
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const results = await searchCoinsForROI(query)
        setSearchResults(results)
      } catch (err) { logError('cinemaWatchlistSidebar:searchCoins', err); setSearchResults([]) }
      setIsSearching(false)
    }, 300)
  }, [])

  const handleAddToken = (token) => {
    // Forward cgId + logo — a bare { symbol, name } entry falls back to the
    // symbol-keyed price map, which resolves ambiguous tickers to the WRONG
    // token (the exact footgun the price-merge comment below warns about).
    addToWatchlist?.({
      symbol: token.symbol,
      name: token.name,
      cgId: token.id || token.cgId || null,
      logo: token.large || token.thumb || token.logo || null,
    })
    setSearchQuery('')
    setSearchResults([])
    setShowSearch(false)
  }

  const closeSearch = () => {
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
  }

  // Drag handlers
  const handleDragStart = (e, index, item) => {
    setDraggedItem({ index, item })
    dragNodeRef.current = e.target
    e.target.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
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
    e.target.classList.remove('dragging')
    if (draggedItem !== null && dragOverItem !== null && draggedItem.index !== dragOverItem) {
      const newList = [...watchlistWithPrices]
      const [removed] = newList.splice(draggedItem.index, 1)
      newList.splice(dragOverItem, 0, removed)
      reorderWatchlist?.(newList)
    }
    setDraggedItem(null)
    setDragOverItem(null)
    dragNodeRef.current = null
  }

  // Merge watchlist with live prices
  const watchlistWithPrices = (watchlist || []).map(item => {
    const symbol = item.symbol?.toUpperCase()
    // Only fall back to the SYMBOL-keyed top-coins map for tokens the symbol
    // unambiguously identifies. An identity-pinned token (cgId/address, e.g.
    // PROS = Pharos) must keep its own already-resolved row values - the
    // symbol-keyed map returns the wrong same-symbol token ("Prospective").
    const priceData = (!item.cgId && !item.address) ? (topCoinPrices?.[symbol] || {}) : {}
    return {
      ...item,
      symbol,
      price: item.price || priceData.price,
      change: item.change || priceData.change,
      marketCap: item.marketCap || priceData.marketCap,
    }
  })

  // Sort: pinned first, then original order
  const sortedWatchlist = [...watchlistWithPrices].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return 0
  })

  const itemCount = sortedWatchlist.length

  // Quick-add tokens not already in watchlist
  const quickAddFiltered = QUICK_ADD_TOKENS.filter(t => !isInWatchlist?.(t.symbol))

  return (
    <aside className={`cinema-watchlist-sidebar ${isOpen ? 'open' : 'collapsed'}`}>
      {/* Toggle button */}
      <button
        className="cinema-watchlist-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {isOpen ? (
            <path d="M9 18l6-6-6-6" />
          ) : (
            <path d="M15 18l-6-6 6-6" />
          )}
        </svg>
      </button>

      {/* Header with tab toggle */}
      <div className="cinema-watchlist-header">
        <div className="cinema-watchlist-tab-toggle">
          <button
            className={`cinema-watchlist-tab ${activeTab === 'watchlist' ? 'active' : ''}`}
            onClick={() => { setActiveTab('watchlist'); setShowSearch(false) }}
          >
            My Watchlist
          </button>
          <button
            className={`cinema-watchlist-tab ${activeTab === 'narratives' ? 'active' : ''}`}
            onClick={() => { setActiveTab('narratives'); setShowSearch(false) }}
          >
            Narratives
          </button>
          <div className="cinema-watchlist-tab-indicator" style={{ transform: activeTab === 'narratives' ? 'translateX(100%)' : 'translateX(0)' }} />
        </div>
        {activeTab === 'watchlist' && (
          <div className="cinema-watchlist-header-row">
            <span className="cinema-watchlist-count">{t('cinemaSidebar.tokenCount', { count: itemCount })}</span>
            <div className="cinema-watchlist-header-actions">
              <button
                className="cinema-watchlist-see-all"
                onClick={() => onPageChange?.('watchlists')}
              >
                {t('cinemaSidebar.seeAll')} &rarr;
              </button>
              <button
                className="cinema-watchlist-add-btn"
                onClick={() => setShowSearch(!showSearch)}
                title="Add token"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {showSearch ? (
                    <>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </>
                  ) : (
                    <>
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── WATCHLIST TAB ── */}
      {activeTab === 'watchlist' && (
        <>
          {/* Search Panel */}
          {showSearch && (
            <div className="cinema-watchlist-search-panel">
              <div className="cinema-watchlist-search-input-wrap">
                <svg className="cinema-watchlist-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="cinema-watchlist-search-input"
                  placeholder={t('cinemaSidebar.searchTokens')}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                />
              </div>

              {/* Search Results */}
              {searchQuery.length >= 2 && (
                <div className="cinema-watchlist-search-results">
                  {isSearching ? (
                    <div className="cinema-watchlist-search-loading">{t('common.searching')}</div>
                  ) : searchResults.length === 0 ? (
                    <div className="cinema-watchlist-search-loading">{t('common.noResults')}</div>
                  ) : (
                    searchResults.slice(0, 6).map((coin) => {
                      const alreadyAdded = isInWatchlist?.(coin.symbol)
                      return (
                        <button
                          key={coin.id || coin.symbol}
                          className={`cinema-watchlist-search-result ${alreadyAdded ? 'added' : ''}`}
                          onClick={() => !alreadyAdded && handleAddToken(coin)}
                          disabled={alreadyAdded}
                        >
                          <span className="cinema-watchlist-search-result-symbol">{coin.symbol}</span>
                          <span className="cinema-watchlist-search-result-name">{coin.name}</span>
                          {alreadyAdded ? (
                            <span className="cinema-watchlist-search-check">✓</span>
                          ) : (
                            <span className="cinema-watchlist-search-add">+</span>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              )}

              {/* Quick Add */}
              {searchQuery.length < 2 && quickAddFiltered.length > 0 && (
                <div className="cinema-watchlist-quick-add">
                  <span className="cinema-watchlist-quick-label">{t('cinemaSidebar.quickAdd')}</span>
                  <div className="cinema-watchlist-quick-chips">
                    {quickAddFiltered.slice(0, 6).map((t) => (
                      <button
                        key={t.symbol}
                        className="cinema-watchlist-quick-chip"
                        onClick={() => handleAddToken(t)}
                      >
                        {TOKEN_LOGOS[t.symbol] && (
                          <img src={TOKEN_LOGOS[t.symbol]} alt="" className="cinema-watchlist-quick-chip-logo" />
                        )}
                        {t.symbol}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Watchlist items */}
          <div className="cinema-watchlist-list">
            {sortedWatchlist.length === 0 ? (
              <div className="cinema-watchlist-empty">
                <span className="cinema-watchlist-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </span>
                <span className="cinema-watchlist-empty-text">
                  {t('cinemaSidebar.addTokens')}
                </span>
                <button className="cinema-watchlist-empty-btn" onClick={() => setShowSearch(true)}>
                  {t('cinemaSidebar.addFirstToken')}
                </button>
              </div>
            ) : (
              sortedWatchlist.map((item, idx) => (
                <CinemaWatchlistItem
                  key={item.address || item.symbol || idx}
                  symbol={item.symbol}
                  name={item.name}
                  price={item.price}
                  change={item.change}
                  marketCap={item.marketCap}
                  address={item.address || item.ca || null}
                  cgId={item.cgId || null}
                  logo={item.logo}
                  isStock={item.isStock}
                  pinned={item.pinned}
                  index={idx}
                  onClick={selectToken}
                  onRemove={removeFromWatchlist}
                  onTogglePin={(sym) => togglePinWatchlist?.(item.address || sym)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx, item)}
                  onDragEnter={(e) => handleDragEnter(e, idx)}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* ── NARRATIVES TAB ── */}
      {activeTab === 'narratives' && (
        <div className="cinema-watchlist-list cinema-narratives-list">
          {CURATED_NARRATIVES.map(narrative => (
            <NarrativeCard
              key={narrative.id}
              narrative={narrative}
              categoryData={categoryData}
              selectToken={selectToken}
              fmtPrice={fmtPrice}
              fmtLarge={fmtLarge}
            />
          ))}
        </div>
      )}
    </aside>
  )
}

export default CinemaWatchlistSidebar
