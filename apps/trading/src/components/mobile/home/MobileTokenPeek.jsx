/**
 * MobileTokenPeek — long-press peek card (prefix mpk-).
 *
 * A bottom glass card that previews a token without leaving the list:
 * identity, price + 24H, a deterministic sparkline (seeded from the address —
 * same synthetic curve the desktop discovery table draws), LIQ/VOL/MCAP/AGE
 * grid, and two actions: Open (token page) + Watchlist toggle.
 *
 * Renders via portal; parent owns `token` (null = closed).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Star, ArrowUpRight } from 'lucide-react'
import { formatPrice, formatLargeNumber } from '../../../services/codexApi'
import { resolveNetwork, formatAge, readCodexChangePct } from '../../../lib/marketFormat'
import { generateSeededSparkline, sparklineToPoints } from '../../../utils/sparkline'
import { gradeClass, fmtPct } from './MobileTokenRow'
import './MobileTokenPeek.css'

const SPARK_W = 280
const SPARK_H = 56

export default function MobileTokenPeek({
  token,
  onClose,
  onOpen,
  onToggleWatchlist,
  inWatchlist = false,
}) {
  const [closing, setClosing] = useState(false)

  useEffect(() => { setClosing(false) }, [token])

  const close = () => {
    setClosing(true)
    setTimeout(() => onClose?.(), 180)
  }

  useEffect(() => {
    if (!token) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const chg24h = token ? readCodexChangePct(token.change24h ?? token.change) : null

  const sparkPoints = useMemo(() => {
    if (!token) return ''
    const data = generateSeededSparkline(chg24h ?? 0, token.address || token.symbol || 'x', 26)
    return sparklineToPoints(data, SPARK_W, SPARK_H, 4)
  }, [token, chg24h])

  if (!token) return null

  const net = resolveNetwork(token.network)
  const up = (chg24h ?? 0) >= 0

  return createPortal(
    <div className={`mpk-root${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={`${token.symbol} preview`}>
      <div className="mpk-backdrop" onClick={close} />
      <div className="mpk-card">
        <div className="mpk-grabber" />

        <div className="mpk-head">
          <div className="mpk-logo">
            {token.logo
              ? <img src={token.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              : <span className="mpk-logo-fallback">{(token.symbol || '?').slice(0, 2)}</span>}
          </div>
          <div className="mpk-id">
            <span className="mpk-sym">{token.symbol || '—'}</span>
            <span className="mpk-name">
              {token.name || '—'}
              {net && <em className="mpk-net" style={{ color: net.color }}>{net.abbrev || net.label}</em>}
            </span>
          </div>
          <div className="mpk-pricewrap">
            <span className="mpk-price">{formatPrice(token.price)}</span>
            <b className={gradeClass(chg24h)}>{fmtPct(chg24h)} 24H</b>
          </div>
        </div>

        <svg
          className="mpk-spark"
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={sparkPoints}
            fill="none"
            stroke={up ? 'var(--up, #34E89E)' : 'var(--down, #FF5169)'}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />
        </svg>

        <div className="mpk-grid">
          <div className="mpk-cell"><span>LIQ</span><b>{formatLargeNumber(token.liquidity)}</b></div>
          <div className="mpk-cell"><span>VOL 24H</span><b>{formatLargeNumber(token.volume24h ?? token.volume)}</b></div>
          <div className="mpk-cell"><span>MCAP</span><b>{formatLargeNumber(token.marketCap)}</b></div>
          <div className="mpk-cell"><span>AGE</span><b>{token.createdAt ? formatAge(token.createdAt) : '—'}</b></div>
        </div>

        <div className="mpk-actions">
          <button
            type="button"
            className={`mpk-btn mpk-btn--watch${inWatchlist ? ' is-on' : ''}`}
            onClick={() => onToggleWatchlist?.(token)}
          >
            <Star size={16} strokeWidth={2} fill={inWatchlist ? 'currentColor' : 'none'} />
            {inWatchlist ? 'Watching' : 'Watchlist'}
          </button>
          <button
            type="button"
            className="mpk-btn mpk-btn--open"
            onClick={() => { onOpen?.(token); onClose?.() }}
          >
            Open <ArrowUpRight size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
