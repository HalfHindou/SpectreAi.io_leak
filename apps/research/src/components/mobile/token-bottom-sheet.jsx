import React, { useState, useCallback, useEffect, useRef } from 'react'
import { getTokenRowStyle } from '@/constants/tokenColors'
import Sparkline from '@/pages/home/components/sparkline'
import DigitMorph from './digit-morph'
import spectreIcons from '@/icons/spectreIcons'
import './token-bottom-sheet.css'

/**
 * TokenBottomSheet — 75dvh slide-up detail sheet for tapped tokens.
 *
 * Anatomy:
 *   Drag handle → Token header (logo + name + symbol + rank)
 *   → Hero price (large, digit-morph) → 24h change
 *   → Sparkline chart (120px)
 *   → 4 stat pills (MCap, Volume, Dominance, Liquidity)
 *   → [View Full Research] CTA → [Add/Remove Watchlist] secondary
 *
 * Props:
 *   token         — full token object
 *   isOpen        — controls visibility
 *   onClose       — dismiss callback
 *   fmtPrice      — currency formatter
 *   fmtMcap       — market cap abbreviator
 *   onViewResearch — "View Full Research" CTA callback
 *   isInWatchlist  — boolean: is this token in watchlist?
 *   onToggleWatchlist — add/remove watchlist callback
 */
const TokenBottomSheet = React.memo(function TokenBottomSheet({
  token,
  isOpen,
  onClose,
  fmtPrice,
  fmtMcap,
  onViewResearch,
  isInWatchlist,
  onToggleWatchlist,
}) {
  const sheetRef = useRef(null)
  const [imgError, setImgError] = useState(false)
  const handleImgError = useCallback(() => setImgError(true), [])

  // Reset img error state when token changes
  useEffect(() => {
    setImgError(false)
  }, [token?.symbol])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!token) return null

  const {
    symbol, name, logo, price, change,
    sparkline_in_7d, marketCap, volume,
    rank, dominance, liquidity,
  } = token

  const isPositive = (change ?? 0) >= 0
  const changeSign = isPositive ? '+' : ''
  const changeFormatted = `${changeSign}${(change ?? 0).toFixed(2)}%`
  const hasSparkline = sparkline_in_7d?.price?.length > 0

  // Fallback logo
  const rowStyle = getTokenRowStyle(symbol)
  const fallbackBg = rowStyle
    ? `rgba(${rowStyle['--row-bg-rgb']}, 0.25)`
    : undefined

  // Format helpers
  const fmtVal = (val) => {
    if (val == null) return '—'
    const n = Number(val)
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${n.toLocaleString()}`
  }

  const displayPrice = fmtPrice
    ? fmtPrice(price)
    : `$${price?.toLocaleString() ?? '—'}`

  const stats = [
    { label: 'Market Cap', value: fmtMcap ? fmtMcap(marketCap) : fmtVal(marketCap) },
    { label: '24h Volume', value: fmtMcap ? fmtMcap(volume) : fmtVal(volume) },
    dominance != null && { label: 'Dominance', value: `${Number(dominance).toFixed(2)}%` },
    liquidity != null && { label: 'Liquidity', value: fmtVal(liquidity) },
  ].filter(Boolean)

  return (
    <div className={`tbs-root ${isOpen ? 'is-open' : ''}`}>
      {/* Backdrop */}
      <div className="tbs-backdrop" onClick={onClose} />

      {/* Sheet */}
      <div className="tbs-sheet" ref={sheetRef}>
        {/* Drag handle */}
        <div className="tbs-handle-bar">
          <div className="tbs-handle" />
        </div>

        {/* Scrollable content */}
        <div className="tbs-content">
          {/* Token header */}
          <div className="tbs-token-header">
            <div className="tbs-logo">
              {logo && !imgError ? (
                <img
                  src={logo}
                  alt={name}
                  onError={handleImgError}
                />
              ) : (
                <div
                  className="tbs-logo-fallback"
                  style={fallbackBg ? { background: fallbackBg } : undefined}
                >
                  {name ? name.charAt(0) : '?'}
                </div>
              )}
            </div>
            <div className="tbs-token-info">
              <span className="tbs-token-name">{name}</span>
              <span className="tbs-token-meta">
                <span className="tbs-token-symbol">{symbol}</span>
                {rank != null && (
                  <span className="tbs-token-rank">#{rank}</span>
                )}
              </span>
            </div>
            <button className="tbs-close" onClick={onClose} aria-label="Close">
              {spectreIcons.close}
            </button>
          </div>

          {/* Hero price */}
          <div className="tbs-hero-price">
            <DigitMorph
              value={displayPrice}
              className={`tbs-price-value ${isPositive ? 'dm-up' : 'dm-down'}`}
            />
            <span className={`tbs-price-change ${isPositive ? 'positive' : 'negative'}`}>
              {changeFormatted}
            </span>
          </div>

          {/* Sparkline chart */}
          {hasSparkline && (
            <div className="tbs-chart">
              <Sparkline
                data={sparkline_in_7d.price}
                positive={isPositive}
                width={320}
                height={120}
              />
            </div>
          )}

          {/* Stat pills */}
          {stats.length > 0 && (
            <div className="tbs-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="tbs-stat">
                  <span className="tbs-stat-label">{stat.label}</span>
                  <span className="tbs-stat-value">{stat.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* CTAs */}
          <div className="tbs-actions">
            {onViewResearch && (
              <button className="tbs-cta-primary" onClick={() => onViewResearch(token)} type="button">
                View Full Research
                <span className="tbs-cta-arrow">{spectreIcons.chevronRight}</span>
              </button>
            )}
            {onToggleWatchlist && (
              <button
                className={`tbs-cta-secondary ${isInWatchlist ? 'in-watchlist' : ''}`}
                onClick={() => onToggleWatchlist(token)}
                type="button"
              >
                <span className="tbs-cta-icon">
                  {spectreIcons.star}
                </span>
                {isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

export default TokenBottomSheet
