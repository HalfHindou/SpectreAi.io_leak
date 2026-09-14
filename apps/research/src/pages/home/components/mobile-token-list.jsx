/**
 * MobileTokenList — CoinMarketCap-mobile "Markets" list for the Welcome page's
 * Top Coins tab, in Spectre's dark-glass identity.
 *
 * Row anatomy (mirrors CMC exactly), on a ~50px pitch:
 *   rank | 22px logo | SYMBOL over MARKET CAP | price | star | 7d spark over 24h%
 *
 * Above it: a compact filter-pill row and a slim column-header row that labels
 * the columns and carries the active sort. Header and rows share ONE grid
 * template (`--mtl-grid`), so the labels sit over the columns they name.
 *
 * Scroll: the list is part of the PAGE scroll — no inner pane, no max-height,
 * no numbered pager. An IntersectionObserver sentinel near the end asks the
 * parent for the next server page, which the data hook APPENDS
 * (use-top-section-data `shouldAppend`), so scrolling just keeps going.
 *
 * Props:
 *   tokens[]          — token rows from filteredTopCoins / sortedTopCoins
 *   loading           — boolean, show skeleton while fetching the first page
 *   onSelect          — fn(token) navigate to token detail
 *   onAddToWatchlist  — fn(token)
 *   isInWatchlist     — fn(token) => boolean
 *   favoriteTokens[]  — THE WATCHLIST ITSELF (live rows). The Favorites pill
 *                       renders this verbatim rather than filtering `tokens`,
 *                       because `tokens` is only the top-coins page that
 *                       happens to be loaded — a starred micro-cap sitting at
 *                       rank 900 was silently missing from "Favorites" while
 *                       still being in the watchlist. Parity by construction.
 *   dayMode           — boolean
 *   pageOffset        — first row's ordinal - 1 (the list numbers by POSITION,
 *                       not by the feed's market-cap rank: the feed filters
 *                       rows, so a rank column would skip numbers. CMC's
 *                       column is unbroken, so ours is too.)
 *   onLoadNextPage    — fn() append the next server page
 *   hasMorePages      — boolean
 *   isLoadingMore     — boolean
 */
import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { getTokenRowStyle } from '@/constants/tokenColors'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { useCopyToast } from '@/contexts/CopyToastContext'
import { generateSeededSparkline } from '@/utils/sparkline'
import { coinLogoUrl } from '@/utils/coin-logo'
import './mobile-token-list.css'

/* ── Sort keys. Shared by the filter pills and the column headers so the two
      can never disagree about what the list is ordered by. ── */

const SORT_OPTIONS = [
  { id: 'marketCap', label: 'Market Cap' },
  { id: 'price', label: 'Price' },
  { id: 'change', label: '24h %' },
  { id: 'change7d', label: '7d %' },
  { id: 'volume', label: 'Volume' },
]

const readSortValue = (row, key) => {
  switch (key) {
    case 'marketCap': return row.marketCap || 0
    case 'price': return row.price || 0
    case 'change': return row.change ?? row.priceChange24h ?? 0
    case 'change7d': return row.change7d || 0
    case 'volume': return row.volume ?? row.volume24h ?? 0
    default: return 0
  }
}

/* ── Inline icons ── */

const Caret = ({ up }) => (
  <svg viewBox="0 0 10 6" width="8" height="5" fill="currentColor" aria-hidden="true">
    {up ? <path d="M5 0L10 6H0z" /> : <path d="M5 6L0 0h10z" />}
  </svg>
)

const ChangeArrow = ({ up }) => (
  <svg viewBox="0 0 8 6" width="7" height="5" fill="currentColor" aria-hidden="true" className="mtl-chg-arrow">
    {up ? <path d="M4 0l4 6H0z" /> : <path d="M4 6L0 0h8z" />}
  </svg>
)

const StarGlyph = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="13" height="13"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? '1.5' : '1.8'}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)

/* ── 7d sparkline ──
   Vector so it stays razor-sharp at any DPR, drawn into a fixed 90x36 viewBox
   and stretched by CSS to the column width (`non-scaling-stroke` keeps the
   line 1.5px whatever the scale). Colored line + soft gradient fill under it. */

const SPARK_VB_W = 90
const SPARK_VB_H = 36

const MiniSpark = memo(({ data, positive, gradId }) => {
  const pts = useMemo(
    () => (Array.isArray(data) ? data.filter((v) => v != null && isFinite(v)) : []),
    [data]
  )
  if (pts.length < 2) return null
  const pad = 3
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = (max - min) || 1
  const step = (SPARK_VB_W - pad * 2) / (pts.length - 1)
  const coords = pts.map((v, i) => [
    +(pad + i * step).toFixed(2),
    +(pad + (1 - (v - min) / range) * (SPARK_VB_H - pad * 2)).toFixed(2),
  ])
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const area = `${line} L${coords[coords.length - 1][0]} ${SPARK_VB_H} L${coords[0][0]} ${SPARK_VB_H} Z`
  const color = positive ? 'var(--bull, #10B981)' : 'var(--bear, #EF4444)'
  return (
    <svg
      className="mtl-spark"
      viewBox={`0 0 ${SPARK_VB_W} ${SPARK_VB_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}, (p, n) => p.positive === n.positive && p.data === n.data && p.gradId === n.gradId)

/* ── Format helpers ── */

function formatChangeAbs(c) {
  if (c == null || !isFinite(c)) return '0.00%'
  return `${Math.abs(c).toFixed(2)}%`
}

/* ── One row ──
   Its own component so a live price tick re-renders exactly one row (and can
   flash it) instead of the whole list. */

const MtlRow = memo(function MtlRow({
  token, rank, formatPrice, fmtLargeShort, onSelect, onToggleWatchlist, inWatchlist,
}) {
  const symbol = (token.symbol || '').toUpperCase()
  const price = token.price
  const change = token.change ?? token.priceChange24h ?? 0
  const isPositive = change >= 0
  // The feed hands back CoinGecko's 250px `large` mark for every row and this
  // circle is 22px (20 on the narrow tier, 24 on the wide one) — ~12KB of image
  // for a slot that can show ~44 device pixels. Fifty rows of that is why the
  // logos crawl on a phone. `small` is the same picture at a fifth of the bytes.
  const logo = coinLogoUrl(token.logo || token.image || null, 24)
  const [imgFailed, setImgFailed] = useState(false)

  // CMC tints the price on a live tick. Only fires when the price actually
  // moves, so a static list never flashes.
  const prevPrice = useRef(price)
  const [flash, setFlash] = useState('')
  useEffect(() => {
    if (prevPrice.current != null && price != null && price !== prevPrice.current) {
      const dir = price > prevPrice.current ? 'up' : 'down'
      prevPrice.current = price
      setFlash(dir)
      const id = setTimeout(() => setFlash(''), 700)
      return () => clearTimeout(id)
    }
    prevPrice.current = price
  }, [price])

  // The line and the % under it share one column, and that column is headed
  // 24H % — so the line has to be those same 24 hours. Drawing the full 7d
  // series here hung a red week under a green day (founder, 08-02: "if charts
  // is red % should be red"). Windowing to 24h fixes the mismatch at its
  // source; colouring the 7d line green would only have hidden it.
  //
  // The older rule still holds — never colour a series by a window it doesn't
  // draw — so this narrows the DRAWING to the number's window rather than
  // bending the colour to the number.
  const { spark, sparkPositive } = useMemo(() => {
    const real = (Array.isArray(token.sparkline_7d) && token.sparkline_7d.length > 1 && token.sparkline_7d)
      || (Array.isArray(token.sparkline) && token.sparkline.length > 1 && token.sparkline)
      || null
    // `sparkline_7d` is 168 hourly points, so the last seventh is the last 24h.
    // Guarded on length: a feed that already hands us a short/24h series must
    // be drawn whole, not sliced down to a stub.
    const windowed = real && real.length >= 48
      ? real.slice(-Math.max(2, Math.round(real.length / 7)))
      : real
    // The synthetic fallback is already seeded from the 24h change.
    const series = windowed || generateSeededSparkline(change, token.address || symbol)
    const clean = series.filter((v) => v != null && isFinite(v))
    // Prefer the printed number so the colour can never contradict the text
    // beside it; fall back to the drawn series when the feed has no change.
    const up = (change != null && isFinite(change))
      ? change >= 0
      : (clean.length > 1 ? clean[clean.length - 1] >= clean[0] : true)
    return { spark: series, sparkPositive: up }
  }, [token.sparkline_7d, token.sparkline, change, token.address, symbol])

  const rowStyle = getTokenRowStyle(symbol)
  const fallbackBg = rowStyle ? `rgba(${rowStyle['--row-bg-rgb']}, 0.25)` : undefined

  return (
    <div
      className="mtl-row"
      onClick={() => onSelect && onSelect(token)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect && onSelect(token) }
      }}
    >
      {onToggleWatchlist ? (
        <button
          type="button"
          className={`mtl-star${inWatchlist ? ' is-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleWatchlist(token) }}
          aria-label={inWatchlist ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
        >
          <StarGlyph filled={inWatchlist} />
        </button>
      ) : <span className="mtl-star mtl-star--placeholder" aria-hidden="true" />}

      <span className="mtl-rank">{rank}</span>

      <div className="mtl-logo">
        {logo && !imgFailed ? (
          <img src={logo} alt="" loading="lazy" decoding="async" width={22} height={22} onError={() => setImgFailed(true)} />
        ) : (
          <span className="mtl-logo-fallback" style={fallbackBg ? { background: fallbackBg } : undefined}>
            {(token.name || symbol || '?').charAt(0)}
          </span>
        )}
      </div>

      <div className="mtl-id">
        <span className="mtl-sym">{symbol || '-'}</span>
        {token.marketCap > 0 && <span className="mtl-mcap">{fmtLargeShort(token.marketCap)}</span>}
      </div>

      <span className={`mtl-price${flash ? ` mtl-price--${flash}` : ''}`}>{formatPrice(price)}</span>

      <div className="mtl-trend">
        <div className="mtl-trend-spark">
          <MiniSpark data={spark} positive={sparkPositive} gradId={`mtlspk-${symbol || rank}-${rank}`} />
        </div>
        <span className={`mtl-chg ${isPositive ? 'positive' : 'negative'}`}>
          <ChangeArrow up={isPositive} />{formatChangeAbs(change)}
        </span>
      </div>
    </div>
  )
}, (p, n) => (
  p.token === n.token
  && p.rank === n.rank
  && p.inWatchlist === n.inWatchlist
  && p.formatPrice === n.formatPrice
  && p.fmtLargeShort === n.fmtLargeShort
  && p.onSelect === n.onSelect
  && p.onToggleWatchlist === n.onToggleWatchlist
))

/* ── Skeleton row — same grid, same shapes, shimmering ── */

function MtlSkeletonRows({ count = 10 }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="mtl-row mtl-row--skeleton" aria-hidden="true">
      <span className="mtl-star mtl-star--placeholder" />
      <span className="mtl-sk mtl-sk-rank animate-shimmer" />
      <span className="mtl-sk mtl-sk-logo animate-shimmer" />
      <div className="mtl-id">
        <span className="mtl-sk mtl-sk-sym animate-shimmer" />
        <span className="mtl-sk mtl-sk-mcap animate-shimmer" />
      </div>
      <span className="mtl-sk mtl-sk-price animate-shimmer" />
      <div className="mtl-trend">
        <span className="mtl-sk mtl-sk-spark animate-shimmer" />
        <span className="mtl-sk mtl-sk-chg animate-shimmer" />
      </div>
    </div>
  ))
}

/* ── Component ── */

function MobileTokenList({
  tokens = [],
  loading = false,
  onSelect,
  onAddToWatchlist,
  isInWatchlist,
  favoriteTokens = null,
  dayMode = false,
  pageOffset = 0,
  onLoadNextPage,
  hasMorePages = false,
  isLoadingMore = false,
}) {
  const { t } = useTranslation()
  const { fmtPrice: formatPrice, fmtLargeShort } = useCurrency()
  const { triggerCopyToast } = useCopyToast() || {}
  // Favourites view: the same list, filtered to the watchlist. Mobile had no
  // way to reach it at all - the star could ADD a coin but nothing showed you
  // what you had starred.
  const [favOnly, setFavOnly] = useState(false)
  const [sortBy, setSortBy] = useState('marketCap')
  const [sortDir, setSortDir] = useState('desc')
  const sentinelRef = useRef(null)

  const applySort = useCallback((id) => {
    setSortBy((prevKey) => {
      if (prevKey === id) {
        setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
        return prevKey
      }
      setSortDir('desc')
      return id
    })
  }, [])

  // The watchlist, when the parent hands it over. Filtering `tokens` is the
  // fallback only — it can never show a starred coin the loaded page doesn't
  // contain, which is the exact way Favorites drifted from the watchlist.
  const favList = Array.isArray(favoriteTokens) ? favoriteTokens : null
  const canFav = typeof isInWatchlist === 'function' || !!favList

  const sortedTokens = useMemo(() => {
    const base = favOnly
      ? (favList || (typeof isInWatchlist === 'function' ? (tokens || []).filter((t) => isInWatchlist(t)) : []))
      : (tokens || [])
    if (!base.length) return []
    const list = [...base]
    list.sort((a, b) => {
      const av = readSortValue(a, sortBy)
      const bv = readSortValue(b, sortBy)
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return list
  }, [tokens, favList, sortBy, sortDir, favOnly, isInWatchlist])

  // Favorites is a closed set — paging in more top coins adds nothing to it.
  const canLoadMore = typeof onLoadNextPage === 'function' && hasMorePages && !isLoadingMore && !loading && !favOnly

  // Infinite scroll. Root is the viewport (the page scroller is an ancestor
  // that scrolls inside it), and the 600px margin asks for the next page
  // before the user reaches the end so the list never visibly stops.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !canLoadMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadNextPage()
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [canLoadMore, onLoadNextPage, sortedTokens.length])

  const handleToggleWatchlist = useMemo(() => {
    if (!onAddToWatchlist) return null
    return (token) => {
      const symbol = (token?.symbol || '').toUpperCase()
      const was = isInWatchlist ? isInWatchlist(token) : false
      onAddToWatchlist(token)
      triggerCopyToast?.(
        was ? `${symbol} removed from watchlist` : `${symbol} added to watchlist`,
        was ? { variant: 'destructive' } : undefined,
      )
    }
  }, [onAddToWatchlist, isInWatchlist, triggerCopyToast])

  const activeCaret = <span className="mtl-caret"><Caret up={sortDir === 'asc'} /></span>

  const controls = (
    <>
      <div className="mtl-filters-scroll">
        <div className="mtl-filters" role="toolbar" aria-label={t('homePage.mobileTokenList.mobiletokenlist.ariaSortMarkets', "Sort markets")}>
          {canFav && (
            <button
              type="button"
              className={`mtl-filter mtl-filter--fav${favOnly ? ' is-active' : ''}`}
              onClick={() => setFavOnly((v) => !v)}
              aria-pressed={favOnly}
            >
              <StarGlyph filled={favOnly} />
              {t('homePage.mobileTokenList.mobiletokenlist.favorites', "Favorites")}
            </button>
          )}
          {SORT_OPTIONS.map((opt) => {
            const isActive = sortBy === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                className={`mtl-filter${isActive ? ' is-active' : ''}`}
                onClick={() => applySort(opt.id)}
                aria-pressed={isActive}
              >
                {opt.label}
                <Caret up={isActive && sortDir === 'asc'} />
              </button>
            )
          })}
        </div>
      </div>

      <div className="mtl-cols">
        <button
          type="button"
          className={`mtl-col mtl-col--name${sortBy === 'marketCap' ? ' is-active' : ''}`}
          onClick={() => applySort('marketCap')}
        >
          <span className="mtl-col-hash">#</span>
          Market Cap
          {sortBy === 'marketCap' && activeCaret}
        </button>
        <button
          type="button"
          className={`mtl-col mtl-col--price${sortBy === 'price' ? ' is-active' : ''}`}
          onClick={() => applySort('price')}
        >
          Price
          {sortBy === 'price' && activeCaret}
        </button>
        {/* 🪤 There used to be a `.mtl-col-gap` spacer here that ALSO declared
            `grid-column: 6`. Two items in one explicit cell is not a stack —
            grid auto-placement pushed the second into an implicit SECOND ROW,
            so "24h %" sat on its own line under the header, hard against the
            right edge. The sparkline column needs no spacer: the chg button
            already owns column 6. */}
        <button
          type="button"
          className={`mtl-col mtl-col--chg${sortBy === 'change' ? ' is-active' : ''}`}
          onClick={() => applySort('change')}
        >
          24h %
          {sortBy === 'change' && activeCaret}
        </button>
      </div>
    </>
  )

  // Both guards below speak for the TOP-COINS feed. In Favorites the list is
  // the watchlist, which is already in hand — a shimmering top-coins page must
  // not blank it, and an empty feed is not an empty watchlist.
  if (!favOnly && loading && (!tokens || tokens.length === 0)) {
    return (
      <div className={`mtl${dayMode ? ' mtl--day' : ''}`}>
        {controls}
        <div className="mtl-list"><MtlSkeletonRows count={12} /></div>
      </div>
    )
  }

  if (!favOnly && !loading && (!tokens || tokens.length === 0)) {
    return (
      <div className={`mtl${dayMode ? ' mtl--day' : ''}`}>
        {controls}
        <div className="mtl-empty">{t('homePage.mobileTokenList.mobiletokenlist.noTokensFound', "No tokens found")}</div>
      </div>
    )
  }

  return (
    <div className={`mtl${dayMode ? ' mtl--day' : ''}`}>
      {controls}

      <div className="mtl-list">
        {favOnly && !sortedTokens.length && (
          <div className="mtl-empty">
            <StarGlyph filled={false} />
            <p>{t('homePage.mobileTokenList.mobiletokenlist.nothingStarredYet', "Nothing starred yet")}</p>
            <span>{t('homePage.mobileTokenList.mobiletokenlist.tapTheStarOnAnyRowToKee', "Tap the star on any row to keep it here.")}</span>
          </div>
        )}
        {sortedTokens.map((token, index) => (
          <MtlRow
            key={token.address || `${token.symbol}-${token.rank ?? index}`}
            token={token}
            rank={pageOffset + index + 1}
            formatPrice={formatPrice}
            fmtLargeShort={fmtLargeShort}
            onSelect={onSelect}
            onToggleWatchlist={handleToggleWatchlist}
            inWatchlist={isInWatchlist ? isInWatchlist(token) : false}
          />
        ))}
        {isLoadingMore && <MtlSkeletonRows count={4} />}
        {(canLoadMore || isLoadingMore) && <div ref={sentinelRef} className="mtl-sentinel" aria-hidden="true" />}
      </div>
    </div>
  )
}

export default memo(MobileTokenList, (prev, next) => {
  if (prev.dayMode !== next.dayMode) return false
  if (prev.loading !== next.loading) return false
  if (prev.pageOffset !== next.pageOffset) return false
  if (prev.tokens !== next.tokens) return false
  if (prev.isInWatchlist !== next.isInWatchlist) return false
  if (prev.favoriteTokens !== next.favoriteTokens) return false
  if (prev.onAddToWatchlist !== next.onAddToWatchlist) return false
  if (prev.onSelect !== next.onSelect) return false
  if (prev.hasMorePages !== next.hasMorePages) return false
  if (prev.isLoadingMore !== next.isLoadingMore) return false
  if (prev.onLoadNextPage !== next.onLoadNextPage) return false
  return true
})
