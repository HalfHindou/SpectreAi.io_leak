/**
 * WatchlistRow
 * Extracted from watchlists-page to enable React.memo. With 50+ tokens and
 * 1Hz price polling, mapping rows inline forced every row to re-render every
 * tick. The custom comparator below skips re-render when only unrelated props
 * shift (callbacks, indices) but price/change/pinned still update normally.
 */
import React from 'react'
import { getTokenRowStyle, getTokenAvatarRingStyle } from '@/constants/tokenColors'
import { MiniSparkline, getSparkPoints, getTokenChainInfo } from './watchlists-utils'

const changePillClass = (value) => {
  if (value === null || value === undefined || isNaN(value)) return 'neutral'
  return value >= 0 ? 'positive' : 'negative'
}

const formatChange = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '-'
  const num = typeof value === 'number' ? value : parseFloat(value)
  if (isNaN(num)) return '-'
  if (Math.abs(num) >= 10000) {
    const sign = num >= 0 ? '+' : '-'
    return `${sign}>9999%`
  }
  const sign = num >= 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

const formatAge = (age) => {
  const empty = age == null || age === '' || age === '-'
  return empty ? '-' : String(age)
}

const formatOptionalNumber = (value, locale) => {
  const num = value != null ? Number(value) : 0
  const empty = num === 0 || isNaN(num)
  if (empty) return '-'
  return locale ? new Intl.NumberFormat(locale).format(num) : num.toLocaleString()
}

function WatchlistRow({
  token,
  index,
  isStocks,
  viewMode,
  visibleColumns,
  dayMode,
  draggedRowIndex,
  dragOverRowIndex,
  reorderWatchlist,
  onTokenClick,
  resolveRouteMode,
  removeFromWatchlist,
  togglePinWatchlist,
  handleDragStart,
  handleDragEnter,
  handleDragOver,
  handleDragEnd,
  handleDrop,
  fmtPrice,
  fmtLarge,
  t,
  locale,
}) {
  const formatOptionalLarge = (value) => {
    const num = value != null ? Number(value) : 0
    const empty = !num || isNaN(num)
    return empty ? '-' : fmtLarge(value)
  }
  // Memoise the per-symbol style objects. Without this, every row re-render
  // generates fresh `{}` objects for the row + avatar ring inline styles.
  // React diffs the style props by reference and rewrites the 5+ CSS custom
  // properties on the DOM, triggering style-recalc + repaint for every row
  // even when the underlying brand colour is unchanged. Memoising on
  // `token.symbol` keeps the same object reference across price ticks.
  const rowStyle = React.useMemo(() => getTokenRowStyle(token.symbol), [token.symbol])
  const ringStyle = React.useMemo(() => getTokenAvatarRingStyle(token.symbol) || {}, [token.symbol])

  return (
    <tr
      className={`watchlists-row ${token.pinned ? 'pinned' : ''} ${draggedRowIndex === index ? 'watchlists-row-dragging' : ''} ${dragOverRowIndex === index ? 'watchlists-row-drag-over' : ''}${onTokenClick ? ' watchlists-row-clickable' : ''}`}
      style={rowStyle}
      draggable={!!reorderWatchlist}
      onDragStart={reorderWatchlist ? (e) => handleDragStart(e, index) : undefined}
      onDragEnter={reorderWatchlist ? (e) => handleDragEnter(e, index) : undefined}
      onDragOver={reorderWatchlist ? handleDragOver : undefined}
      onDragEnd={reorderWatchlist ? handleDragEnd : undefined}
      onDrop={reorderWatchlist ? (e) => handleDrop(e, index) : undefined}
      onClick={onTokenClick ? () => onTokenClick(token, resolveRouteMode(token)) : undefined}
    >
      <td className="watchlists-td-actions">
        <div className="watchlists-row-actions">
          <button
            type="button"
            className="watchlists-action-btn watchlists-action-remove"
            onClick={(e) => { e.stopPropagation(); removeFromWatchlist?.(token.address || token.symbol) }}
            title={t('watchlistPage.removeFromWatchlist')}
            aria-label={t('common.remove')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <div
            className="watchlists-action-drag"
            title={t('watchlistPage.dragToReorder')}
            aria-hidden
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>
          <button
            type="button"
            className={`watchlists-action-btn watchlists-action-pin ${token.pinned ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); togglePinWatchlist?.(token.address || token.symbol) }}
            title={token.pinned ? t('watchlist.unpin') : t('watchlistPage.pinToTop')}
            aria-label={token.pinned ? t('watchlist.unpin') : t('watchlist.pin')}
          >
            <svg viewBox="0 0 24 24" fill={token.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.76z" />
            </svg>
          </button>
        </div>
      </td>
      <td className="wl-rank-cell">
        {token.rank <= 3 ? (
          <span className={`wl-rank-badge wl-rank-${token.rank}`}>{token.rank}</span>
        ) : (
          <span className="wl-rank-num">{token.rank}</span>
        )}
      </td>
      <td>
        <div className="token-info">
          <div
            className="token-avatar-ring watchlist-avatar-ring"
            style={ringStyle}
          >
            <div className={`token-avatar ${token.logo ? 'has-logo' : ''}`}>
              {token.logo ? (
                <>
                  <img
                    src={token.logo}
                    alt={token.symbol}
                    onError={(e) => {
                      e.target.style.display = 'none'
                      e.target.parentElement.classList.remove('has-logo')
                      if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'
                    }}
                  />
                  <span style={{ display: 'none' }}>{token.symbol?.[0] || '?'}</span>
                </>
              ) : (
                <span>{token.symbol?.[0] || '?'}</span>
              )}
            </div>
          </div>
          <div className="token-text-info">
            <span className="token-name">{token.name}</span>
            <span className="token-symbol" data-ticker>{token.symbol}</span>
          </div>
        </div>
      </td>
      <td>{fmtPrice(token.price)}</td>
      {isStocks ? (
        <>
          <td style={{ opacity: 0.7 }}>{token.exchange || '-'}</td>
          <td style={{ opacity: 0.7 }}>{token.sector || '-'}</td>
          <td>{formatOptionalLarge(token.volume)}</td>
          <td className={`change-pill ${(token.change24h || 0) >= 0 ? 'positive' : 'negative'}`}><span className="change-pill-badge">{formatChange(token.change24h)}</span></td>
          <td style={{ opacity: 0.7 }}>{token.pe != null ? token.pe.toFixed(1) : '-'}</td>
          <td className="wl-52w-cell">
            {token.week52Low != null && token.week52High != null ? (
              <div className="wl-52w-range">
                <span className="wl-52w-val">${token.week52Low.toFixed(0)}</span>
                <div className="wl-52w-bar">
                  <div
                    className="wl-52w-fill"
                    style={{ width: `${Math.min(100, Math.max(0, ((token.price - token.week52Low) / (token.week52High - token.week52Low || 1)) * 100))}%` }}
                  />
                  <div
                    className="wl-52w-dot"
                    style={{ left: `${Math.min(100, Math.max(0, ((token.price - token.week52Low) / (token.week52High - token.week52Low || 1)) * 100))}%` }}
                  />
                </div>
                <span className="wl-52w-val">${token.week52High.toFixed(0)}</span>
              </div>
            ) : '-'}
          </td>
          <td className="wl-sparkline-cell">
            <MiniSparkline data={getSparkPoints(token)} positive={(token.change24h || 0) >= 0} />
          </td>
          <td>{formatOptionalLarge(token.mcap)}</td>
        </>
      ) : (
        <>
          {viewMode === 'onchain' && visibleColumns.chain && (
            <td className="wl-chain-td">
              <img src={getTokenChainInfo(token.networkId, token.symbol).logo} alt={getTokenChainInfo(token.networkId, token.symbol).name} className="chain-logo" title={getTokenChainInfo(token.networkId, token.symbol).name} />
            </td>
          )}
          {viewMode === 'onchain' && visibleColumns.age && <td>{formatAge(token.age)}</td>}
          {viewMode === 'onchain' && visibleColumns.txns && <td>{formatOptionalNumber(token.txns, locale)}</td>}
          {visibleColumns.volume && <td>{formatOptionalLarge(token.volume)}</td>}
          {viewMode === 'onchain' && visibleColumns.makers && <td>{formatOptionalNumber(token.makers, locale)}</td>}
          {viewMode === 'onchain' && visibleColumns.holders && <td>{formatOptionalNumber(token.holders, locale)}</td>}
          {viewMode === 'onchain' && visibleColumns.change5m && <td className={`change-pill ${changePillClass(token.change5m)}`}><span className="change-pill-badge">{formatChange(token.change5m)}</span></td>}
          {visibleColumns.change1h && <td className={`wl-col-1h change-pill ${changePillClass(token.change1h)}`}><span className="change-pill-badge">{formatChange(token.change1h)}</span></td>}
          {viewMode === 'onchain' && visibleColumns.change6h && <td className={`change-pill ${changePillClass(token.change6h)}`}><span className="change-pill-badge">{formatChange(token.change6h)}</span></td>}
          {visibleColumns.change24h && <td className={`change-pill ${changePillClass(token.change24h)}`}><span className="change-pill-badge">{formatChange(token.change24h)}</span></td>}
          {viewMode !== 'onchain' && visibleColumns.change1w && <td className={`change-pill ${changePillClass(token.change1w)}`}><span className="change-pill-badge">{formatChange(token.change1w)}</span></td>}
          {viewMode !== 'onchain' && visibleColumns.change1m && <td className={`change-pill ${changePillClass(token.change1m)}`}><span className="change-pill-badge">{formatChange(token.change1m)}</span></td>}
          {viewMode !== 'onchain' && visibleColumns.change1y && <td className={`wl-col-1y change-pill ${changePillClass(token.change1y)}`}><span className="change-pill-badge">{formatChange(token.change1y)}</span></td>}
          {visibleColumns.trend && <td className="wl-sparkline-cell"><MiniSparkline data={getSparkPoints(token)} positive={(token.change24h || 0) >= 0} /></td>}
          {visibleColumns.liquidity && <td>{formatOptionalLarge(token.liquidity)}</td>}
          {visibleColumns.mcap && <td>{formatOptionalLarge(token.mcap)}</td>}
        </>
      )}
    </tr>
  )
}

// Skip re-render when only price-irrelevant props shift. Compare the fields
// that actually drive a row's visible output. Callbacks are intentionally
// excluded — they tend to be fresh every parent render and ignoring them is
// safe because they read from the latest `token` we pass in.
//
// Drag indices compared as "is THIS row involved" booleans rather than raw
// values, otherwise every row re-renders on every drag event (when ANY row's
// drag state changes the global index changes for everyone).
const arePropsEqual = (prev, next) => {
  const prevDragged = prev.draggedRowIndex === prev.index
  const nextDragged = next.draggedRowIndex === next.index
  if (prevDragged !== nextDragged) return false
  const prevOver = prev.dragOverRowIndex === prev.index
  const nextOver = next.dragOverRowIndex === next.index
  if (prevOver !== nextOver) return false
  return (
    prev.token.id === next.token.id &&
    prev.token.price === next.token.price &&
    prev.token.change === next.token.change &&
    prev.token.change5m === next.token.change5m &&
    prev.token.change1h === next.token.change1h &&
    prev.token.change6h === next.token.change6h &&
    prev.token.change24h === next.token.change24h &&
    prev.token.change1w === next.token.change1w &&
    prev.token.change1m === next.token.change1m &&
    prev.token.change1y === next.token.change1y &&
    prev.token.volume === next.token.volume &&
    prev.token.mcap === next.token.mcap &&
    prev.token.liquidity === next.token.liquidity &&
    prev.token.logo === next.token.logo &&
    prev.token.rank === next.token.rank &&
    prev.token.pinned === next.token.pinned &&
    prev.token.age === next.token.age &&
    prev.token.txns === next.token.txns &&
    prev.token.makers === next.token.makers &&
    prev.token.holders === next.token.holders &&
    prev.index === next.index &&
    prev.isStocks === next.isStocks &&
    prev.viewMode === next.viewMode &&
    prev.dayMode === next.dayMode &&
    prev.visibleColumns === next.visibleColumns &&
    prev.locale === next.locale
  )
}

export default React.memo(WatchlistRow, arePropsEqual)
