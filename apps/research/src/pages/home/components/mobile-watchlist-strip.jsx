/**
 * MobileWatchlistStrip — horizontal scrolling watchlist for the mobile Welcome page.
 *
 * Shows user's watchlisted tokens as compact glass cards in a single scrollable row.
 * Each card displays logo, symbol, price, and 24h change.
 * Includes an "Add" card at the end and an empty state when no tokens are tracked.
 *
 * Props come from WelcomePage's WatchlistsContext (watchlistWithLiveData)
 * and page-level callbacks (selectToken, onPageChange).
 */
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { isMajorToken } from '@/constants/majorTokens'
import './mobile-watchlist-strip.css'

/* ── Price formatting ── */

function fmtCompactPrice(price) {
  if (price == null || isNaN(price)) return '-'
  const n = Number(price)
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  if (n >= 1) return `$${n.toFixed(2)}`.slice(0, 7)
  if (n >= 0.01) return `$${n.toFixed(2)}`
  // Very small prices — significant digits
  return `$${n.toPrecision(2)}`
}

function fmtPct(value) {
  if (value == null || isNaN(value)) return null
  const n = Number(value)
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

/* ── Brand color lookup for fallback avatars ── */

function getTokenBrandBg(symbol) {
  const entry = TOKEN_ROW_COLORS[(symbol || '').toUpperCase()]
  if (!entry) return 'rgba(245, 245, 247, 0.1)'
  return `rgb(${entry.bg})`
}

/* ── Loading skeleton ── */

function StripSkeleton() {
  return (
    <div className="mws-scroll" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`mws-skeleton animate-shimmer stagger-${i + 1}`} />
      ))}
    </div>
  )
}

/* ── Individual token card ── */

const TokenCard = React.memo(function TokenCard({ token, onTap }) {
  const { symbol, name, image, logo, price, priceChange24h, change24h } = token
  const tokenImage = image || logo
  const pctRaw = priceChange24h ?? change24h
  const change = pctRaw != null ? Number(pctRaw) : null
  const pctStr = fmtPct(change)
  const isPositive = change != null && change >= 0

  const brandRgb = TOKEN_ROW_COLORS[(symbol || '').toUpperCase()]?.bg
  const cardStyle = brandRgb ? { '--mws-brand': brandRgb } : undefined

  const handleClick = useCallback(() => {
    if (onTap) onTap(token)
  }, [onTap, token])

  return (
    <button type="button" className={`mws-card${brandRgb ? ' mws-card--branded' : ''}`} style={cardStyle} onClick={handleClick}>
      <div className="mws-card-logo">
        {tokenImage ? (
          <img src={tokenImage} alt="" width={24} height={24} loading="lazy" />
        ) : (
          <span
            className="mws-card-logo-fallback"
            style={{ backgroundColor: getTokenBrandBg(symbol) }}
          >
            {(symbol || '?').charAt(0)}
          </span>
        )}
      </div>
      <span className="mws-card-symbol">{symbol}</span>
      <span className="mws-card-price">{fmtCompactPrice(price)}</span>
      {pctStr && (
        <span className={`mws-card-change ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '▲' : '▼'} {pctStr}
        </span>
      )}
    </button>
  )
})

/* ── "Add" card ── */

function AddCard({ onTap }) {
  const { t } = useTranslation()
  return (
    <button type="button" className="mws-card mws-add" onClick={onTap}>
      <div className="mws-add-icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          width={16}
          height={16}
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <span className="mws-add-label">{t('homePage.mobileWatchlistStrip.add.add', "Add")}</span>
    </button>
  )
}

/* ── Empty state ── */

function EmptyState({ onTap, t }) {
  return (
    <button type="button" className="mws-empty" onClick={onTap}>
      <svg
        className="mws-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        width={20}
        height={20}
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      <span className="mws-empty-title">
        {t?.('watchlist.trackFavorites') || 'Track your favorites'}
      </span>
      <span className="mws-empty-cta">
        {t?.('watchlist.browseTokens') || 'Browse tokens'}
      </span>
    </button>
  )
}

/* ── Main component ── */

function MobileWatchlistStrip({
  watchlistWithLiveData,
  selectToken,
  onOpenResearchZone,
  onOpenAIScreener,
  onPageChange,
  activeWatchlistName,
  dayMode,
  t,
}) {
  // WS prices merged upstream in useWatchlistPrices
  const liveWatchlist = watchlistWithLiveData

  const hasData = liveWatchlist && liveWatchlist.length > 0
  const isLoading = liveWatchlist === undefined

  const handleSeeAll = useCallback(() => {
    onPageChange?.('watchlists')
  }, [onPageChange])

  // Add btn opens Full View (search bar is visible there) rather than Discover.
  const handleAddTap = useCallback(() => {
    onPageChange?.('watchlists')
  }, [onPageChange])

  const handleEmptyTap = useCallback(() => {
    onPageChange?.('watchlists')
  }, [onPageChange])

  // Route on-chain tokens to AI Screener, major/spot to Research Zone.
  // "Major" = hardcoded MAJOR_SYMBOLS OR any token with CoinGecko data
  // (useWatchlistPrices sets token.isMajor=true for dynamically-resolved
  // cgId tokens like PAAL, HYPE, POPCAT etc.).
  const handleTokenTap = useCallback((token) => {
    const sym = (token?.symbol || '').toUpperCase()
    const isMajor = token?.isMajor === true || isMajorToken(sym)
    if (isMajor) {
      if (onOpenResearchZone) return onOpenResearchZone(token)
    } else {
      if (onOpenAIScreener) return onOpenAIScreener(token)
    }
    if (selectToken) selectToken(token)
  }, [onOpenResearchZone, onOpenAIScreener, selectToken])

  return (
    <div className={`mws${dayMode ? ' mws--day' : ''}`}>
      {/* Section header */}
      <div className="mws-header">
        <span className="mws-header-label">
          {activeWatchlistName || t?.('ui.myWatchlist') || 'Watchlist'}
        </span>
        {hasData && (
          <button type="button" className="mws-header-action" onClick={handleSeeAll}>
            {t?.('ui.seeAll') || 'See All'}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width={12}
              height={12}
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <StripSkeleton />
      ) : hasData ? (
        <div className="mws-scroll">
          {liveWatchlist.map((token, idx) => (
            <TokenCard
              key={token.address || token.symbol || idx}
              token={token}
              onTap={handleTokenTap}
            />
          ))}
          <AddCard onTap={handleAddTap} />
        </div>
      ) : (
        <div className="mws-scroll">
          <EmptyState onTap={handleEmptyTap} t={t} />
        </div>
      )}
    </div>
  )
}

/* ── Memoize with shallow watchlist comparison ── */
export default React.memo(MobileWatchlistStrip, (prev, next) => {
  if (prev.dayMode !== next.dayMode) return false
  if (prev.activeWatchlistName !== next.activeWatchlistName) return false

  const prevList = prev.watchlistWithLiveData
  const nextList = next.watchlistWithLiveData

  // Structural change (loading → loaded, empty → populated, length change)
  if (prevList === nextList) return true
  if (prevList == null || nextList == null) return false
  if (prevList.length !== nextList.length) return false

  // Check if any price or change value shifted
  for (let i = 0; i < prevList.length; i++) {
    const a = prevList[i]
    const b = nextList[i]
    if (a.symbol !== b.symbol) return false
    if (a.price !== b.price) return false
    if (a.priceChange24h !== b.priceChange24h) return false
  }

  return true
})
