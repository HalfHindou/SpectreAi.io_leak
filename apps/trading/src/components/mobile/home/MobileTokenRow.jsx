/**
 * MobileTokenRow — the shared dense token row for the mobile home screens
 * (screener / search / watchlist). DexScreener information density in the
 * Spectre warm-white language.
 *
 * Layout (~76px, two lines + chip rail):
 *   [36 logo+chain dot]  SYMBOL ·age ★        $price
 *                        Name                 1H -3.0%   24H +100%
 *                        LIQ $160K · VOL $821K · MCAP $2.2M
 *
 * Gestures:
 *   tap          → onSelect(token)
 *   swipe-right  → onSwipeRight(token)  (watchlist toggle — star underlay)
 *   swipe-left   → onSwipeLeft(token)   (only when provided — remove underlay)
 *   long-press   → onPeek(token)        (peek card, handled by parent)
 *
 * Live: price flashes up/down when the polled value changes.
 * Change fields are MIXED-UNIT from Codex — always normalized through
 * readCodexChangePct before display/grading (the fmtChange heuristic).
 */
import React, { useEffect, useRef, useState, memo } from 'react'
import { Star, Trash2 } from 'lucide-react'
import { formatPrice } from '../../../services/codexApi'
import { formatAge, readCodexChangePct } from '../../../lib/marketFormat'
import { ChainIcon } from '../../../utils/chainIcons'
import { getTokenColor } from '../../../utils/tokenColors'
import './MobileTokenRow.css'

const SWIPE_TRIGGER = 68
const SWIPE_MAX = 96
const LONG_PRESS_MS = 420

/** Magnitude color grading (mobile-crypto-ux B2) on a NORMALIZED percent. */
export function gradeClass(pct) {
  if (pct == null) return 'mrow-chg-val neutral'
  const a = Math.abs(pct)
  if (a < 0.05) return 'mrow-chg-val neutral'
  const dir = pct >= 0 ? 'up' : 'down'
  const g = a < 0.5 ? 'g0' : a < 2 ? 'g1' : a < 5 ? 'g2' : a < 10 ? 'g3' : 'g4'
  return `mrow-chg-val ${dir} ${g}`
}

/** Compact market cap for the dense line-1 slot: $790K / $95.46M / $4.5B —
 *  full formatLargeNumber ($790,217) ate the symbol's width. */
export function fmtMcap(v) {
  const n = Number(v) || 0
  // Missing data is missing - a "$0" chip reads as a real (broken) number.
  if (!(n > 0)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

/** GMGN/DexScreener-style tiny price with subscript zero count — keeps the
 *  PRICE chip short enough to share one line with the name. */
export function CompactPrice({ price }) {
  const n = Number(price)
  if (!Number.isFinite(n) || n === 0) return <>—</>
  if (n >= 1000) return <>${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}</>
  if (n >= 1) return <>${n.toFixed(2)}</>
  if (n >= 0.001) return <>${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}</>
  const dec = n.toFixed(20).split('.')[1] || ''
  let zeros = 0
  while (dec[zeros] === '0') zeros++
  const sig = dec.slice(zeros).replace(/0+$/, '').slice(0, 3) || '0'
  return <>$0.0<sub className="mrow-sub">{zeros}</sub>{sig}</>
}

/** Compact signed percent from a NORMALIZED value. */
export function fmtPct(pct) {
  if (pct == null || !isFinite(pct)) return '—'
  const a = Math.abs(pct)
  const s = a >= 10000 ? `${Math.round(a / 1000)}K` : a >= 1000 ? `${(a / 1000).toFixed(1)}K` : a >= 100 ? Math.round(a) : a.toFixed(1)
  return `${pct >= 0 ? '+' : '-'}${s}%`
}

function MobileTokenRow({
  token,
  onSelect,
  onPeek,
  onSwipeRight,
  onSwipeLeft,
  inWatchlist = false,
  showChips = true,
}) {
  const [dx, setDx] = useState(0)
  const [flash, setFlash] = useState(null) // 'up' | 'down'
  const [popStar, setPopStar] = useState(false)

  const startRef = useRef(null)     // {x, y}
  const axisRef = useRef(null)      // 'h' | 'v'
  const pressTimer = useRef(null)
  const longFiredRef = useRef(false)
  const prevPriceRef = useRef(token.price)

  /* live price flash */
  useEffect(() => {
    const prev = prevPriceRef.current
    if (prev != null && token.price != null && token.price !== prev) {
      setFlash(token.price > prev ? 'up' : 'down')
      const t = setTimeout(() => setFlash(null), 650)
      prevPriceRef.current = token.price
      return () => clearTimeout(t)
    }
    prevPriceRef.current = token.price
  }, [token.price])

  const clearPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  const handleTouchStart = (e) => {
    const t = e.touches?.[0]
    if (!t) return
    startRef.current = { x: t.clientX, y: t.clientY }
    axisRef.current = null
    longFiredRef.current = false
    if (onPeek) {
      pressTimer.current = setTimeout(() => {
        longFiredRef.current = true
        onPeek(token)
      }, LONG_PRESS_MS)
    }
  }

  const handleTouchMove = (e) => {
    const s = startRef.current
    const t = e.touches?.[0]
    if (!s || !t) return
    const mx = t.clientX - s.x
    const my = t.clientY - s.y
    if (Math.abs(mx) > 8 || Math.abs(my) > 8) clearPress()
    if (!axisRef.current) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.4) axisRef.current = 'h'
      else if (Math.abs(my) > 10) axisRef.current = 'v'
    }
    if (axisRef.current !== 'h') return
    // resist fully when no handler for that direction, clamp otherwise
    const allowed = mx > 0 ? !!onSwipeRight : !!onSwipeLeft
    const damp = allowed ? 1 : 0.15
    const eased = Math.sign(mx) * Math.min(Math.abs(mx) * damp, SWIPE_MAX)
    setDx(eased)
  }

  const handleTouchEnd = () => {
    clearPress()
    const fired = Math.abs(dx) >= SWIPE_TRIGGER
    if (fired && dx > 0 && onSwipeRight) {
      onSwipeRight(token)
      setPopStar(true)
      setTimeout(() => setPopStar(false), 500)
    } else if (fired && dx < 0 && onSwipeLeft) {
      onSwipeLeft(token)
    }
    setDx(0)
    startRef.current = null
    axisRef.current = null
  }

  const handleClick = () => {
    if (longFiredRef.current) { longFiredRef.current = false; return }
    onSelect?.(token)
  }

  const age = token.createdAt ? formatAge(token.createdAt) : null
  const chg1h = readCodexChangePct(token.change1h)
  const chg24h = readCodexChangePct(token.change24h ?? token.change)
  // MCAP is the primary number (memecoin mental model); price rides the chip
  // rail. Rows without a market cap (thin search results) fall back to price.
  const mcap = Number(token.marketCap) || 0

  return (
    <div className={`mrow${flash ? ` mrow--flash-${flash}` : ''}`}>
      {/* swipe underlays — mounted only mid-gesture so they can never
          bleed through the resting row */}
      {dx > 0 && (
        <div className={`mrow-under mrow-under--right${dx >= SWIPE_TRIGGER ? ' is-armed' : ''}`} aria-hidden="true">
          <Star size={18} strokeWidth={2} fill={inWatchlist ? 'none' : 'currentColor'} />
          <span>{inWatchlist ? 'Remove' : 'Watch'}</span>
        </div>
      )}
      {onSwipeLeft && dx < 0 && (
        <div className={`mrow-under mrow-under--left${dx <= -SWIPE_TRIGGER ? ' is-armed' : ''}`} aria-hidden="true">
          <Trash2 size={18} strokeWidth={2} />
          <span>Remove</span>
        </div>
      )}

      <button
        type="button"
        className="mrow-track"
        style={dx !== 0 ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="mrow-main">
          {/* DexScreener left stack: chain icon on the symbol line, age badge
              on the name line (their DEX slot — we don't track per-row DEX) */}
          <div className="mrow-chaincol">
            {token.networkId ? (
              <span className={`mrow-chainic${Number(token.networkId) === 1 ? ' mrow-chainic--eth' : ''}`}>
                <ChainIcon networkId={token.networkId} size={13} />
              </span>
            ) : null}
            {age && <span className="mrow-age">{age}</span>}
          </div>

          <div className="mrow-left">
            <div className="mrow-logo">
              {token.logo && !token.logo.startsWith('data:')
                ? <img src={token.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                : (
                  /* No real logo (or the gray tokenPlaceholder data-URI) —
                     brand-colored initial from tokenColors instead. */
                  <span
                    className="mrow-logo-fallback"
                    style={{
                      background: `color-mix(in srgb, ${getTokenColor(token.symbol, token.address)} 16%, transparent)`,
                      color: getTokenColor(token.symbol, token.address),
                    }}
                  >
                    {(token.symbol || '?').slice(0, 1)}
                  </span>
                )}
            </div>
          </div>

          <div className="mrow-body">
            {/* line 1 — DexScreener structure: SYMBOL … MC + 1H + 24H */}
            <div className="mrow-line1">
              <span className="mrow-sym">{token.symbol || '—'}</span>
              {(inWatchlist || popStar) && (
                <Star className={`mrow-star${popStar ? ' mrow-star--pop' : ''}`} size={12} strokeWidth={2} fill="currentColor" />
              )}
              <span className="mrow-nums">
                <span className="mrow-price">
                  {mcap > 0
                    ? <><i className="mrow-price-tag">MC</i>{fmtMcap(mcap)}</>
                    : (Number(token.price) > 0 ? formatPrice(token.price) : '—')}
                </span>
                <span className="mrow-chg">1H <b className={gradeClass(chg1h)}>{fmtPct(chg1h)}</b></span>
                <span className="mrow-chg">24H <b className={gradeClass(chg24h)}>{fmtPct(chg24h)}</b></span>
              </span>
            </div>

            {/* line 2 — name … metric chips, ONE line (DexScreener) */}
            <div className="mrow-line2">
              <span className="mrow-name">{token.name || token.network || '—'}</span>
              {showChips ? (
                <span className="mrow-chips">
                  {Number(token.liquidity) > 0
                    ? <span className="mrow-chip">LIQ <b>{fmtMcap(token.liquidity)}</b></span>
                    : <span className="mrow-chip-empty" aria-hidden="true" />}
                  {Number(token.volume24h ?? token.volume) > 0
                    ? <span className="mrow-chip">VOL <b>{fmtMcap(token.volume24h ?? token.volume)}</b></span>
                    : <span className="mrow-chip-empty" aria-hidden="true" />}
                </span>
              ) : (
                Number(token.price) > 0 && mcap > 0 && (
                  <span className="mrow-price2"><CompactPrice price={token.price} /></span>
                )
              )}
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}

export default memo(MobileTokenRow)
