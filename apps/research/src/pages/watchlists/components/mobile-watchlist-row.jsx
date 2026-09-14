/**
 * MobileWatchlistRow
 *
 * The CMC row anatomy the Top Coins list already ships (`mobile-token-list`),
 * on a watchlist: ~50px pitch, 22px logo, SYMBOL over MARKET CAP, price, then
 * the 7d spark stacked over the 24h change on the right. Same grid template
 * (`--wlr-grid`), same type scale — the two lists must read as one product.
 *
 * What this row adds over `mtl`: the swipe rails (pin / delete) and a pinned
 * marker. It does NOT carry a rank (a watchlist has no market-cap ordinal) or a
 * star (everything here is already starred), so those two columns are dropped.
 *
 * React.memo with a VALUE comparator: the throttled realtime-price setState
 * (~2s) would otherwise re-render every row. Callbacks are excluded on purpose
 * — they read the `token` handed to them, so a fresh closure is harmless.
 */
import React from 'react'
import { getTokenAvatarRingStyle } from '@/constants/tokenColors'
import { MiniSparkline, getSparkPoints } from './watchlists-utils'
import SwipeableRow from './swipeable-row'
import { settleImgRef, onImgSettled } from '@/lib/img-settle'

const ChangeArrow = ({ up }) => (
  <svg viewBox="0 0 8 6" width="7" height="5" fill="currentColor" aria-hidden="true" className="wlm-row-chg-arrow">
    {up ? <path d="M4 0l4 6H0z" /> : <path d="M4 6L0 0h8z" />}
  </svg>
)

const formatChangeAbs = (value) => {
  const num = typeof value === 'number' ? value : parseFloat(value)
  if (num === null || num === undefined || isNaN(num)) return '-'
  if (Math.abs(num) >= 10000) return '>9999%'
  return `${Math.abs(num).toFixed(2)}%`
}

function MobileWatchlistRow({ token, t, fmtPrice, fmtLargeShort, onOpen, onPin, onDelete }) {
  const ringStyle = React.useMemo(() => getTokenAvatarRingStyle(token.symbol) || {}, [token.symbol])
  const change = typeof token.change24h === 'number' ? token.change24h : 0
  const isPositive = change >= 0
  const mcap = token.mcap || token.marketCap || 0

  // `getSparkPoints` now windows to the last 24h, i.e. the same span as the %
  // printed under the line, so the colour comes off that number and the two can
  // never disagree (founder, 08-02: "if charts is red % should be red"). The
  // series is the fallback for a row whose feed carries no change.
  const { spark, sparkPositive } = React.useMemo(() => {
    const series = getSparkPoints(token) || []
    const clean = series.filter((v) => v != null && isFinite(v))
    const up = (change != null && isFinite(change))
      ? change >= 0
      : (clean.length > 1 ? clean[clean.length - 1] >= clean[0] : true)
    return { spark: series, sparkPositive: up }
  }, [token, change])

  return (
    <SwipeableRow
      leftActions={[{
        label: token.pinned ? t('watchlist.unpin') : t('watchlist.pin'),
        color: '#fbbf24',
        icon: <svg viewBox="0 0 24 24" width="20" height="20" fill={token.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.76z" /></svg>,
        onClick: () => onPin(token),
      }]}
      rightActions={[{
        label: t('watchlistPage.delete'),
        color: '#ef4444',
        icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
        onClick: () => onDelete(token),
      }]}
    >
      <div
        className="wlm-row"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(token)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(token) }
        }}
      >
        <div className="wlm-row-logo" style={ringStyle}>
          {token.logo ? (
            <img
              src={token.logo}
              alt=""
              width={22}
              height={22}
              loading="lazy"
              decoding="async"
              ref={settleImgRef}
              onLoad={onImgSettled}
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'flex') }}
            />
          ) : null}
          <span className="wlm-row-fallback" style={{ display: token.logo ? 'none' : 'flex' }}>{token.symbol?.[0] || '?'}</span>
        </div>

        <div className="wlm-row-id">
          <span className="wlm-row-sym">
            {token.symbol}
            {token.pinned && <i className="wlm-row-pin" aria-label={t('watchlist.pin')} />}
          </span>
          <span className="wlm-row-mcap">{mcap > 0 ? fmtLargeShort(mcap) : token.name}</span>
        </div>

        <span className="wlm-row-price">{fmtPrice(token.price)}</span>

        <div className="wlm-row-trend">
          <div className="wlm-row-spark">
            <MiniSparkline data={spark} width={72} height={26} positive={sparkPositive} />
          </div>
          <span className={`wlm-row-chg ${isPositive ? 'positive' : 'negative'}`}>
            <ChangeArrow up={isPositive} />{formatChangeAbs(change)}
          </span>
        </div>
      </div>
    </SwipeableRow>
  )
}

const arePropsEqual = (prev, next) => (
  prev.token.id === next.token.id &&
  prev.token.price === next.token.price &&
  prev.token.change24h === next.token.change24h &&
  prev.token.mcap === next.token.mcap &&
  prev.token.pinned === next.token.pinned &&
  prev.token.logo === next.token.logo &&
  prev.token.symbol === next.token.symbol &&
  prev.token.name === next.token.name &&
  prev.fmtLargeShort === next.fmtLargeShort &&
  prev.lang === next.lang
)

export default React.memo(MobileWatchlistRow, arePropsEqual)
