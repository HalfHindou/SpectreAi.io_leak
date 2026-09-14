/**
 * MobileMakerSheet — DexScreener-style trader popup for a tapped maker.
 *
 * Top block = the trade ledger from the loaded tape: (-) Bought / (+) Sold
 * (USD + token amount + txn counts), (=) PNL (sold - bought), Unrealized
 * (unknown - we don't index balances). Below: tier glyph + address, the tier
 * descriptor ("Dolphin: $10k-$50k bought or sold"), first-seen age, the
 * newly-active spark, then explorer / copy / filter actions.
 *
 * `profile` comes from DataTabs' makerProfiles (per-maker aggregation over the
 * loaded tape) - stats are honest-per-sample, not all-time. Prefix: mmk-.
 */
import React, { useEffect, useRef, useState } from 'react'
import { X, Copy, ExternalLink, Filter, Sparkles } from 'lucide-react'
import { TierIcon, tierLabel, tierRange } from './TraderTier'
import './MobileMakerSheet.css'

const fmtUsd = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e4) return `$${(v / 1e3).toFixed(1)}K`
  if (v >= 1) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (v > 0) return `$${v.toFixed(2)}`
  return '$0'
}

const fmtAmt = (n) => {
  const v = Number(n) || 0
  if (v <= 0) return null
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/* ms-ago → "15h 14m" / "3d 4h" / "12m" */
const fmtSince = (ts) => {
  if (!ts) return null
  const diff = Math.max(0, Date.now() - ts)
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

const shortAddr = (a) => (!a ? '' : a.length <= 14 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`)

export default function MobileMakerSheet({
  open,
  maker,
  profile,
  explorerUrl,
  isActiveFilter,
  onClose,
  onCopy,
  onFilter,
}) {
  // Drag-to-dismiss, matching the mfs-/mss-/mwd- sheets: track the grabber
  // region's vertical travel, follow the finger, and close past the same
  // 120px threshold the siblings use.
  const startYRef = useRef(null)
  const [dragOffset, setDragOffset] = useState(0)

  useEffect(() => { if (open) setDragOffset(0) }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !maker) return null

  const handleTouchStart = (e) => { startYRef.current = e.touches?.[0]?.clientY ?? null }
  const handleTouchMove = (e) => {
    if (startYRef.current == null) return
    const dy = (e.touches?.[0]?.clientY ?? startYRef.current) - startYRef.current
    if (dy > 0) setDragOffset(dy)
  }
  const handleTouchEnd = () => {
    if (dragOffset > 120) onClose?.()
    else setDragOffset(0)
    startYRef.current = null
  }

  const p = profile || null
  const pnl = p ? (p.sellUsd || 0) - (p.buyUsd || 0) : 0
  const pnlSide = pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'flat'
  const tier = p?.tier || 1
  const lean = p?.lean || 'flat'
  const since = fmtSince(p?.firstTs)

  return (
    <div className="mmk-root" role="dialog" aria-modal="true" aria-label="Trader details">
      <button type="button" className="mmk-backdrop" aria-label="Close" onClick={onClose} />

      <div
        className="mmk-sheet"
        // `mmkSheetIn` uses fill-mode `both`, and a CSS animation's computed
        // value BEATS an inline style - so the entrance keyframe's
        // translateY(0) would pin the sheet and the drag would never move it.
        // Drop the animation for the duration of the drag.
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, animation: 'none' } : undefined}
      >
        <div
          className="mmk-grabber-region"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mmk-grabber" aria-hidden="true" />
        </div>

        <div className="mmk-addr-row">
          <span className="mmk-addr">{maker}</span>
          <button type="button" className="mmk-close" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* ── Trade ledger (loaded tape) ─────────────────────── */}
        {p && (
          <div className="mmk-ledger">
            <div className="mmk-ledger-row">
              <span className="mmk-ledger-label"><i className="mmk-sign">(−)</i> Bought:</span>
              <span className="mmk-ledger-usd mmk-ledger-usd--buy">{fmtUsd(p.buyUsd)}</span>
              <span className="mmk-ledger-amt">{fmtAmt(p.buyTokens) || '—'}</span>
              <span className="mmk-ledger-count">{p.buys || 0} txns</span>
            </div>
            <div className="mmk-ledger-row">
              <span className="mmk-ledger-label"><i className="mmk-sign">(+)</i> Sold:</span>
              <span className="mmk-ledger-usd mmk-ledger-usd--sell">{fmtUsd(p.sellUsd)}</span>
              <span className="mmk-ledger-amt">{fmtAmt(p.sellTokens) || '—'}</span>
              <span className="mmk-ledger-count">{p.sells || 0} txns</span>
            </div>
            <div className="mmk-ledger-row mmk-ledger-row--pnl">
              <span className="mmk-ledger-label"><i className="mmk-sign">(=)</i> PNL:</span>
              <span className={`mmk-ledger-usd mmk-ledger-usd--${pnlSide}`}>
                {pnl < 0 ? '−' : ''}{fmtUsd(Math.abs(pnl))}
              </span>
              <span className="mmk-ledger-amt" />
              <span className="mmk-ledger-count" />
            </div>
            <div className="mmk-ledger-row mmk-ledger-row--unreal">
              <span className="mmk-ledger-label">Unrealized:</span>
              <span className="mmk-ledger-usd">—</span>
              <span className="mmk-ledger-amt" />
              <span className="mmk-ledger-count">Unknown balance</span>
            </div>
            <div className="mmk-ledger-note">From the loaded trade tape — not all-time history.</div>
          </div>
        )}

        {/* ── Identity: tier glyph + descriptors ─────────────── */}
        <div className="mmk-id">
          <span className={`mmk-id-icon mmk-id-icon--${lean}`}>
            <TierIcon tier={tier} size={26} />
          </span>
          <div className="mmk-id-lines">
            <span className="mmk-id-addr">{shortAddr(maker)}</span>
            <span className="mmk-id-tier">
              {tierLabel(tier)}: {tierRange(tier)} bought or sold
            </span>
            {since && <span className="mmk-id-since">Active since: {since}</span>}
            {p?.newlyActive && (
              <span className="mmk-id-new">
                <Sparkles size={11} strokeWidth={2.5} aria-hidden="true" />
                Newly active on this pair
              </span>
            )}
          </div>
        </div>

        {explorerUrl && (
          <a
            className="mmk-explorer"
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            Open in block explorer
            <ExternalLink size={14} strokeWidth={2} />
          </a>
        )}

        <div className="mmk-actions mmk-actions--row">
          <button type="button" className="mmk-action" onClick={() => { onCopy?.(); onClose?.() }}>
            <Copy size={16} strokeWidth={2} />
            <span>Copy address</span>
          </button>

          <button
            type="button"
            className={`mmk-action${isActiveFilter ? ' mmk-action--active' : ''}`}
            onClick={onFilter}
          >
            <Filter size={16} strokeWidth={2} />
            <span>{isActiveFilter ? 'Clear filter' : 'Filter txns'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
