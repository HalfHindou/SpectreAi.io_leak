/**
 * LiveTabTitle - the browser tab reads "CATE ↑ $58.74K | Spectre AI" and keeps
 * ticking while the user is on another tab, GMGN-style.
 *
 * Renders nothing. Mounted inside TokenDetailsProvider so it reads the SAME
 * live price the banner shows (SSE stream, 320ms throttle). Market cap is
 * re-derived from that live price (details only carry the 60s-poll mcap):
 * price x circulating supply, else the details mcap scaled by the price move,
 * else the details mcap as-is, else the price itself.
 *
 * Background ticking is the point, and it needs two things this component
 * arranges: (1) the stream service keeps ONE narrowed connection open while
 * hidden for the pinned token (setBackgroundToken - budgeted, see
 * codexStreamApi), because background timers are throttled to once a minute
 * but EventSource messages are not; (2) React still commits in a hidden tab,
 * so the effect below runs on every flushed tick.
 *
 * `active` false (token view parked / another view) restores the default title
 * and unpins the background token.
 */
import { useEffect, useRef } from 'react'
import { useSharedTokenDetails, useTokenDetailsStatic } from '../contexts/TokenDetailsContext'
import { setBackgroundToken } from '../services/codexStreamApi'
import { formatPrice, inferNetworkId } from '../services/codexApi'

const DEFAULT_TITLE = 'Spectre AI - Trading Platform'

// GMGN's compact mcap: $58.74K / $1.23M / $4.56B. Two decimals under a unit,
// no decimals for plain dollars.
function fmtCompactUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export default function LiveTabTitle({ token, active = true }) {
  // Fast lane (live price overlay) + slow lane (the 60s poll, whose price is
  // the poll-time price the polled mcap was computed at).
  const { tokenData } = useSharedTokenDetails() || {}
  const { tokenData: polled } = useTokenDetailsStatic() || {}
  const symbol = String(tokenData?.symbol || token?.symbol || '').replace(/^\$/, '').trim()
  const price = parseFloat(tokenData?.price) || parseFloat(token?.price) || 0
  const supply = parseFloat(polled?.circulatingSupply) || 0
  const polledMcap = parseFloat(polled?.marketCap) || parseFloat(token?.marketCap) || 0
  const polledPrice = parseFloat(polled?.price) || 0
  const change24 = parseFloat(tokenData?.change24 ?? token?.change ?? 0) || 0

  // Live market cap from the live price: price x supply when supply is known,
  // else the polled mcap scaled by how far the price moved since that poll.
  let mcap = 0
  if (price > 0 && supply > 0) mcap = price * supply
  else if (polledMcap > 0) mcap = (polledPrice > 0 && price > 0) ? polledMcap * (price / polledPrice) : polledMcap

  // Arrow = direction of the last price move; seeded from the 24h sign so the
  // very first title is not blank, and held through flat ticks.
  const lastPriceRef = useRef(0)
  const arrowRef = useRef(change24 < 0 ? '↓' : '↑')
  if (price > 0 && lastPriceRef.current > 0 && price !== lastPriceRef.current) {
    arrowRef.current = price > lastPriceRef.current ? '↑' : '↓'
  }
  if (price > 0) lastPriceRef.current = price

  const figure = fmtCompactUsd(mcap) || (price > 0 ? formatPrice(price) : null)
  const title = active && symbol && figure
    ? `${symbol} ${arrowRef.current} ${figure} | Spectre AI`
    : DEFAULT_TITLE

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.title !== title) document.title = title
  }, [title])

  // Pin the active token for background streaming; unpin on leave/unmount.
  const address = token?.address || null
  const networkId = address ? inferNetworkId(address, token?.networkId) : null
  useEffect(() => {
    if (!active || !address) { setBackgroundToken(null); return }
    setBackgroundToken(`${address}:${networkId}`)
    return () => setBackgroundToken(null)
  }, [active, address, networkId])

  // Reset the arrow memory on token switch so the new token does not inherit
  // the previous token's last move.
  useEffect(() => {
    lastPriceRef.current = 0
    arrowRef.current = change24 < 0 ? '↓' : '↑'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  useEffect(() => () => {
    if (typeof document !== 'undefined') document.title = DEFAULT_TITLE
  }, [])

  return null
}
