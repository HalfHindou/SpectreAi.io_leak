/**
 * TreemapTooltip — Rich hover card for treemap cells.
 * Portal to document.body, viewport-aware positioning.
 * Lazy-loads coin description from CoinGecko, caches per-session.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { getCoinDetails } from '@/services/coinGeckoApi'
import { useCurrency } from '@/hooks/useCurrency'

/* ── Description cache (persists for session, not across reloads) ── */
const descCache = new Map()

/* ── Shorten CoinGecko descriptions to first 2 sentences ── */
function truncateDesc(raw) {
  if (!raw) return null
  // Strip HTML tags
  const clean = raw.replace(/<[^>]+>/g, '').trim()
  // Take first 2 sentences
  const sentences = clean.match(/[^.!?]+[.!?]+/g)
  if (!sentences) return clean.slice(0, 180)
  return sentences.slice(0, 2).join(' ').trim()
}

export default function TreemapTooltip({ token, position, getChange, fmtPrice, isStocks, dayMode }) {
  const { t } = useTranslation()
  const { fmtLarge } = useCurrency()
  const tooltipRef = useRef(null)
  const [adjustedPos, setAdjustedPos] = useState({ x: 0, y: 0 })
  const [desc, setDesc] = useState(null)
  const [descLoading, setDescLoading] = useState(false)

  // Lazy-load description
  useEffect(() => {
    if (!token || isStocks) return
    const key = token.id || token.symbol
    if (descCache.has(key)) {
      setDesc(descCache.get(key))
      return
    }
    setDescLoading(true)
    setDesc(null)
    const timer = setTimeout(() => {
      getCoinDetails(token.symbol, token.id)
        .then(data => {
          const text = truncateDesc(data?.description)
          descCache.set(key, text)
          setDesc(text)
        })
        .catch(() => {
          descCache.set(key, null)
          setDesc(null)
        })
        .finally(() => setDescLoading(false))
    }, 100) // slight delay to avoid burst-fetching on fast mouse movement

    return () => clearTimeout(timer)
  }, [token, isStocks])

  // Viewport-aware positioning (pattern from NodeTooltip.jsx)
  useEffect(() => {
    if (!position || !tooltipRef.current) return

    const el = tooltipRef.current
    const rect = el.getBoundingClientRect()
    const vW = window.innerWidth
    const vH = window.innerHeight

    let x = position.x + 16
    let y = position.y - 8

    // Flip left if overflows right
    if (x + rect.width > vW - 16) {
      x = position.x - rect.width - 16
    }
    // Push up if overflows bottom
    if (y + rect.height > vH - 16) {
      y = vH - rect.height - 16
    }
    // Clamp top
    if (y < 8) y = 8
    // Clamp left
    if (x < 8) x = 8

    setAdjustedPos({ x, y })
  }, [position])

  if (!token || !position) return null

  const change = getChange(token)
  const isPositive = change >= 0
  const changeStr = `${isPositive ? '+' : ''}${change.toFixed(2)}%`
  const price = fmtPrice(token._livePrice ?? token.price)

  const breadcrumb = isStocks
    ? token.sector || t('heatmaps.equities')
    : (token.category || t('heatmaps.cryptocurrency'))

  return createPortal(
    <div
      ref={tooltipRef}
      className={`treemap-tooltip${dayMode ? ' day-mode' : ''}`}
      style={{
        position: 'fixed',
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 10000,
      }}
    >
      {/* Breadcrumb */}
      <div className="treemap-tooltip-breadcrumb">{breadcrumb}</div>

      {/* Header: logo + ticker + name */}
      <div className="treemap-tooltip-header">
        {token.logo && (
          <img className="treemap-tooltip-logo" src={token.logo} alt="" width={24} height={24} />
        )}
        <span className="treemap-tooltip-ticker">{token.symbol}</span>
        <span className="treemap-tooltip-name">{token.name}</span>
      </div>

      {/* Price row */}
      <div className="treemap-tooltip-price-row">
        <span className="treemap-tooltip-price">{price}</span>
        <span className={`treemap-tooltip-change ${isPositive ? 'positive' : 'negative'}`}>
          {changeStr} {isPositive ? '↑' : '↓'}
        </span>
      </div>

      {/* Market cap + volume */}
      <div className="treemap-tooltip-stats">
        <span>{t('heatmaps.mcap')} {fmtLarge(token.marketCap)}</span>
        <span className="treemap-tooltip-stats-sep">·</span>
        <span>{t('heatmaps.vol')} {fmtLarge(token.volume)}</span>
      </div>

      {/* Description (crypto only) */}
      {!isStocks && (
        <div className="treemap-tooltip-desc">
          {descLoading && (
            <div className="treemap-tooltip-shimmer">
              <div className="treemap-tooltip-shimmer-line" />
              <div className="treemap-tooltip-shimmer-line short" />
            </div>
          )}
          {!descLoading && desc && <p>{desc}</p>}
        </div>
      )}
    </div>,
    document.body
  )
}
