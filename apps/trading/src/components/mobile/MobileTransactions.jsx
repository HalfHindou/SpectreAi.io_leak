/**
 * MobileTransactions — DexScreener-style trade tape for the token page (mobile).
 *
 * Single-line rows, 4 columns, matching the DexScreener/Vector mobile tape:
 *
 *   [↑]  $407      $0.3920     ✦ 6f3F98 ›
 *   1h
 *
 *   TXN     arrow chip (buy=up/green, sell=down/red) + age
 *   USD     signed-colour total
 *   PRICE   per-txn price (or mcap when Price/MCap toggled)
 *   TRADER  spectre/rep tag + short maker (tap → maker sheet)
 *
 * A faint size-graded bar sits behind each row (buy green / sell red),
 * proportional to the trade's USD vs the token's MARKET CAP — see
 * `depthPct` below for why that anchor and not the largest loaded trade.
 *
 * Purely presentational — DataTabs owns the fetch, filters and the maker
 * action sheet. The TXN and USD header funnels get DexScreener-style quick
 * controls (instant type dropdown / focused amount sheet) when DataTabs
 * passes the filter setters; PRICE and TRADER still funnel into the full
 * filter sheet via `onOpenFilters`. Prefix: mtx-.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import WalletAvatar from '../WalletAvatar'
import { createPortal } from 'react-dom'
import { RefreshCw, ChevronRight, ArrowUp, ArrowDown, Filter, Check, X, Sparkles } from 'lucide-react'
import { isSpectreSwap } from '../../lib/spectreSwapMarks'
import { formatLargeNumber } from '../../services/codexApi'
import { TierIcon, tierLabel } from './TraderTier'
import useAgeLabel from '../../hooks/useAgeLabel'
import './MobileTransactions.css'

const formatAge = (ts) => {
  if (!ts) return '—'
  const ms = ts instanceof Date ? ts.getTime() : Number(ts) * (Number(ts) > 1e12 ? 1 : 1000)
  const diff = Math.max(0, Date.now() - ms)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const formatDate = (ts) => {
  if (!ts) return '—'
  const d = ts instanceof Date ? ts : new Date(Number(ts) * (Number(ts) > 1e12 ? 1 : 1000))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const fmtUsd = (usd) => {
  const n = Number(usd)
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`
  if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const fmtMcap = (mc) => {
  const n = Number(mc)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

/** GMGN-style tiny-price with subscript zero count (Dexscreener convention). */
function PriceValue({ price }) {
  const n = Number(price)
  if (!Number.isFinite(n) || n === 0) return <>—</>
  if (n >= 1) return <>${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</>
  if (n >= 0.001) return <>${n.toFixed(6).replace(/0+$/, '')}</>
  // sub-milli: 0.0₍zeros₎significant
  const dec = n.toFixed(20).split('.')[1] || ''
  let zeros = 0
  while (dec[zeros] === '0') zeros++
  const sig = dec.slice(zeros).replace(/0+$/, '').slice(0, 5) || '0'
  return <>$0.0<sub className="mtx-sub">{zeros}</sub>{sig}</>
}

/**
 * Depth-bar width for one trade.
 *
 * The bar answers "how big is this trade FOR THIS TOKEN", so the anchor is the
 * token's market cap, not the largest trade in the loaded page. Relative-to-max
 * made a $686 trade fill the whole row on a $3M-cap token (0.02% of the token)
 * purely because nothing bigger happened to be loaded — the scale moved every
 * time a page came in, and the same bar meant a different thing per token.
 *
 * A full bar means 1% of the market cap — a genuine whale at any cap ($34K on
 * $3.4M, $10M on $1B). Between 0 and that the mapping is sqrt, which keeps a
 * small trade visibly small: $1K on a $3.4M token is 0.03% of the token, so it
 * reads as ~17% of the row, not half of it. (A log mapping was tried first and
 * was far too generous down there — it made every ordinary trade look big.)
 *
 * Falls back to the old max-relative scale when supply (hence mcap) is unknown,
 * so the bar never silently disappears.
 */
const CEIL_RATIO = 1e-2    // 1% of mcap == full bar

function depthPct(usd, mcap, maxUsd) {
  if (!(usd > 0)) return 0
  const ref = mcap > 0 ? mcap * CEIL_RATIO : maxUsd
  if (!(ref > 0)) return 0
  return Math.max(1.5, Math.min(100, Math.sqrt(usd / ref) * 100))
}

/* Memoised: a row renders 3-4 lucide SVGs and the tape runs 50-500 rows, so an
   unrelated parent render (opening the filter sheet, a tab change, a maker
   sheet) used to rebuild every one of them. Same fix the desktop table already
   carries - see the `tradeRows` memo comment in DataTabs.jsx. */
const TradeRow = React.memo(function TradeRow({ tx, maxUsd, circulatingSupply, showDateMode, showPriceMode, isSpectre, isFilterActive, onMakerTap, onMakerFilter, profile }) {
  // Memoised on the trade, so the age ticks itself (see useAgeLabel).
  const age = useAgeLabel(tx?.timestamp, formatAge, !showDateMode)
  const type = String(tx?.type || '').toLowerCase()
  const isBuy = type === 'buy'
  const isSell = type === 'sell'
  const side = isBuy ? 'buy' : isSell ? 'sell' : 'neutral'
  const price = Number(tx?.price) || 0
  const amount = Number(tx?.amount) || 0
  const usd = (amount > 0 && price > 0) ? amount * price : (Number(tx?.value) || 0)

  // Size-graded background bar — trade USD against the token's market cap at
  // this trade's price (same mcap the MCAP column shows). See depthPct.
  const mcap = (price > 0 && circulatingSupply > 0) ? price * circulatingSupply : 0
  const barPct = depthPct(usd, mcap, maxUsd)

  const rep = tx?.makerLabel
    ? (typeof tx.makerLabel === 'object' ? tx.makerLabel : { label: tx.makerLabel, color: null })
    : null

  const maker = tx?.maker || ''
  const makerShort = maker ? `${maker.slice(0, 4)}…${maker.slice(-4)}` : '—'

  // Trader classification (from the aggregated maker profile): size tier +
  // net buy/sell lean + volume share. Falls back to this txn's side/tier 1.
  const tier = profile?.tier || 1
  const lean = profile?.lean || side
  const share = profile?.share || 0
  const tierName = tierLabel(tier)

  const Arrow = isSell ? ArrowDown : ArrowUp

  return (
    <div
      className={`mtx-row mtx-row--${side}${isFilterActive ? ' is-filtered' : ''}${maker ? '' : ' is-static'}`}
      role={maker ? 'button' : undefined}
      tabIndex={maker ? 0 : undefined}
      onClick={maker ? () => onMakerTap?.(maker) : undefined}
      onKeyDown={maker ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMakerTap?.(maker) } } : undefined}
    >
      {barPct > 0 && (
        <span
          className={`mtx-depth mtx-depth--${side}`}
          style={{ width: `${barPct}%` }}
          aria-hidden="true"
        />
      )}

      {/* col 0 — the wallet's pfp opens the row (deterministic sigil); the app
          the swap came through (Codex tradeSource) rides its corner as a mini
          tile - a 375px row has no room for a separate slot. Absent source =
          unknown, never "direct". */}
      <span className="mtx-pfp">
        {maker && <WalletAvatar address={maker} size={22} source={tx?.source} className="mtx-avatar" />}
      </span>

      {/* col 1 — arrow chip + age */}
      <span className="mtx-txn">
        <span className={`mtx-ico mtx-ico--${side}`}>
          <Arrow size={13} strokeWidth={2.75} aria-hidden="true" />
        </span>
        <span className="mtx-age">{showDateMode ? formatDate(tx?.timestamp) : age}</span>
      </span>

      {/* col 2 — USD total */}
      <span className="mtx-usd">{fmtUsd(usd)}</span>

      {/* col 3 — price (or mcap) */}
      <span className="mtx-price">
        {showPriceMode ? <PriceValue price={price} /> : fmtMcap(price * circulatingSupply)}
      </span>

      {/* col 4 — trader icon system (size tier + net-lean colour) + maker +
          volume bar + per-row filter funnel (DexScreener) */}
      <span className="mtx-trader">
        {maker && (
          <span className={`mtx-tier mtx-tier--${lean}`} title={`${tierName} · net ${lean}`}>
            <TierIcon tier={tier} size={16} />
            {profile?.newlyActive && (
              <Sparkles className="mtx-tier-spark" size={8} strokeWidth={2.5} aria-hidden="true" />
            )}
          </span>
        )}
        <span className="mtx-trader-main">
          <span className="mtx-trader-id">
            {isSpectre && <img className="mtx-spectre" src="/spectre-icon.png" alt="Spectre" />}
            {rep && (
              <span className="mtx-rep" style={rep.color ? { color: rep.color } : undefined}>{rep.label}</span>
            )}
            <span className="mtx-maker">{makerShort}</span>
          </span>
          {maker && (
            <span className={`mtx-volbar mtx-volbar--${lean}`} aria-hidden="true">
              <span className="mtx-volbar-fill" style={{ width: `${Math.max(6, Math.round(share * 100))}%` }} />
            </span>
          )}
        </span>
        {maker && onMakerFilter ? (
          <button
            type="button"
            className={`mtx-row-funnel${isFilterActive ? ' is-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onMakerFilter(maker) }}
            aria-label={isFilterActive ? 'Clear trader filter' : 'Filter by this trader'}
            title={isFilterActive ? 'Clear filter' : 'Filter by this trader'}
          >
            <Filter size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <ChevronRight className="mtx-chev" size={13} strokeWidth={2} aria-hidden="true" />
        )}
      </span>
    </div>
  )
})

function SkeletonRow() {
  return (
    <div className="mtx-row mtx-row--skel" aria-hidden="true">
      <span className="mtx-txn">
        <span className="mtx-skel mtx-skel--ico" />
        <span className="mtx-skel mtx-skel--w40" />
      </span>
      <span className="mtx-skel mtx-skel--w60" />
      <span className="mtx-skel mtx-skel--w60" />
      <span className="mtx-skel mtx-skel--w70" />
    </div>
  )
}

/** Column header cell. Its funnel triggers this column's filter control
    (TXN→instant type dropdown, USD→amount sheet, PRICE/TRADER→full sheet). */
function HeadCell({ label, align, active, onFilterTap }) {
  return (
    <span className={`mtx-head-cell mtx-head-cell--${align || 'left'}`}>
      <span className="mtx-head-label">{label}</span>
      {onFilterTap && (
        <button
          type="button"
          className={`mtx-head-filter${active ? ' is-active' : ''}`}
          onClick={onFilterTap}
          aria-label={`Filter by ${label.toLowerCase()}`}
        >
          <Filter size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/* DexScreener's "Filter Amount USD" preset floors — min only, max stays open. */
const USD_PRESETS = [
  { label: '>$100', min: '100' },
  { label: '>$500', min: '500' },
  { label: '>$1,000', min: '1000' },
  { label: '>$2,500', min: '2500' },
  { label: '>$5,000', min: '5000' },
  { label: '>$10,000', min: '10000' },
]

/* USD size of one trade — the same derivation the row bars use. */
const tradeUsd = (tx) => {
  const amt = Number(tx?.amount) || 0
  const pr = Number(tx?.price) || 0
  return (amt > 0 && pr > 0) ? amt * pr : (Number(tx?.value) || 0)
}

/** Focused "Filter Amount USD" modal — DexScreener's. Drops in anchored just
    below the table header (anchorY, viewport px), dim backdrop behind. Local
    draft, committed on Apply; Clear wipes and commits in one tap. */
function UsdFilterSheet({ open, anchorY = 0, onClose, valueFilter, onApply, trades = [] }) {
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')

  // Header context chip: the largest loaded trade - the reference point for
  // picking a sensible floor. Live match count keeps the draft honest ("this
  // floor leaves 3 of 200 rows") before Apply commits it. Both are over the
  // LOADED page only, hence "shown".
  const maxUsd = useMemo(() => trades.reduce((m, tx) => Math.max(m, tradeUsd(tx)), 0), [trades])
  const matchCount = useMemo(() => {
    const lo = parseFloat(min)
    const hi = parseFloat(max)
    if (Number.isNaN(lo) && Number.isNaN(hi)) return null
    let n = 0
    for (const tx of trades) {
      const u = tradeUsd(tx)
      if (!Number.isNaN(lo) && u < lo) continue
      if (!Number.isNaN(hi) && u > hi) continue
      n++
    }
    return n
  }, [trades, min, max])

  useEffect(() => {
    if (!open) return
    setMin(valueFilter?.min ?? '')
    setMax(valueFilter?.max ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const commit = (next) => {
    onApply?.(next)
    onClose?.()
  }

  // Clamp so the panel never runs off the bottom (the table header can sit
  // low on the token page — chart above it).
  const top = Math.max(12, Math.min(anchorY + 6, (window.innerHeight || 800) - 400))

  // Portaled to <body> — the table sits under ancestors with
  // backdrop-filter/transform, which would re-anchor position:fixed.
  return createPortal(
    <div className="mtx-usd-root" role="dialog" aria-modal="true" aria-label="Filter amount USD">
      <button type="button" className="mtx-usd-backdrop" aria-label="Close" onClick={onClose} />
      <div className="mtx-usd-sheet" style={{ top }}>
        <header className="mtx-usd-head">
          <h3 className="mtx-usd-title">Filter Amount (USD)</h3>
          {maxUsd > 0 && (
            <span className="mtx-usd-max">
              <i>MAX</i>
              <b>{formatLargeNumber(maxUsd)}</b>
            </span>
          )}
          <button type="button" className="mtx-usd-close" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="mtx-usd-presets">
          {USD_PRESETS.map((p) => {
            const on = min === p.min && max === ''
            return (
              <button
                key={p.label}
                type="button"
                className={`mtx-usd-preset${on ? ' is-active' : ''}`}
                onClick={() => { setMin(on ? '' : p.min); setMax('') }}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <div className="mtx-usd-fields">
          <label className="mtx-usd-field">
            <span className="mtx-usd-prefix" aria-hidden="true">$</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="Min"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </label>
          <span className="mtx-usd-dash" aria-hidden="true">–</span>
          <label className="mtx-usd-field">
            <span className="mtx-usd-prefix" aria-hidden="true">$</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="Max"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
        </div>

        {matchCount != null && (
          <div className={`mtx-usd-hint${matchCount === 0 ? ' mtx-usd-hint--none' : ''}`}>
            <b>{matchCount}</b> of {trades.length} shown txns match
          </div>
        )}

        <footer className="mtx-usd-actions">
          <button
            type="button"
            className="mtx-usd-btn mtx-usd-btn--primary"
            onClick={() => commit({ min: String(min).trim(), max: String(max).trim() })}
          >
            Apply
          </button>
          <button
            type="button"
            className="mtx-usd-btn mtx-usd-btn--ghost"
            onClick={() => commit({ min: '', max: '' })}
          >
            Clear
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

export default function MobileTransactions({
  trades = [],
  loading = false,
  error = null,
  empty = false,
  filteredEmpty = false,
  typeFilter = null,
  typeFilterOptions = null,
  onTypeFilter = null,
  valueFilter = null,
  onValueFilter = null,
  circulatingSupply = 0,
  showDateMode = false,
  showPriceMode = true,
  makerFilter = null,
  makerProfiles = null,
  valueFilterActive = false,
  priceFilterActive = false,
  onMakerTap,
  onMakerFilter,
  onOpenFilters,
  spectreMarks,
  hasMore = false,
  loadingMore = false,
  loadMore,
  tradesCount = 0,
  onRetry,
}) {
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [usdSheetOpen, setUsdSheetOpen] = useState(false)
  const headRef = useRef(null)
  // Where the USD modal anchors: just below the (sticky, visible) header.
  const [usdAnchor, setUsdAnchor] = useState(0)
  const openUsdSheet = () => {
    const r = headRef.current?.getBoundingClientRect()
    setUsdAnchor(r ? Math.round(r.bottom) : 0)
    setUsdSheetOpen(true)
  }

  // Close the type dropdown on any tap outside it. A fixed backdrop can't be
  // used here — the sticky header's backdrop-filter re-anchors position:fixed.
  useEffect(() => {
    if (!typeMenuOpen) return
    const onDown = (e) => {
      if (e.target.closest?.('.mtx-typemenu') || e.target.closest?.('.mtx-head-filter')) return
      setTypeMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [typeMenuOpen])

  // Quick controls only when DataTabs handed us the setters; otherwise the
  // funnels fall back to the full filter sheet.
  const canQuickType = !!(onTypeFilter && typeFilterOptions?.length)
  const canQuickUsd = !!onValueFilter

  const maxUsd = useMemo(() => {
    let m = 0
    for (const tx of trades) {
      const amt = Number(tx?.amount) || 0
      const pr = Number(tx?.price) || 0
      const u = (amt > 0 && pr > 0) ? amt * pr : (Number(tx?.value) || 0)
      if (u > m) m = u
    }
    return m
  }, [trades])

  const activeTypeLabel = typeFilter
    ? (typeFilterOptions?.find((o) => o.value === typeFilter)?.label || typeFilter).toLowerCase()
    : null

  /* The tape is the single most expensive thing this component renders. Any
     unrelated state change in DataTabs (it owns the filter sheet, the maker
     sheet, the tab) re-runs this function, and rebuilding N row elements from
     scratch blocked the frame the sheet was supposed to mount/unmount in - it
     read as the sheet taking a beat to open and to close. Memoised, that render
     hands React the SAME element references and it skips the subtree outright.
     `onMakerFilter` MUST be a stable reference from DataTabs or this busts on
     every render. */
  const rows = useMemo(() => trades.map((tx, i) => (
    <TradeRow
      key={`${tx?.txHash || ''}-${i}`}
      tx={tx}
      maxUsd={maxUsd}
      circulatingSupply={circulatingSupply}
      showDateMode={showDateMode}
      showPriceMode={showPriceMode}
      isSpectre={spectreMarks ? isSpectreSwap(spectreMarks, tx?.txHash) : false}
      isFilterActive={!!makerFilter && makerFilter === tx?.maker}
      onMakerTap={onMakerTap}
      onMakerFilter={onMakerFilter}
      profile={makerProfiles ? makerProfiles.get(tx?.maker) : null}
    />
  )), [
    trades, maxUsd, circulatingSupply, showDateMode, showPriceMode,
    spectreMarks, makerFilter, onMakerTap, onMakerFilter, makerProfiles,
  ])

  return (
    <div className="mtx" role="region" aria-label="Recent transactions">
      <div className="mtx-head" ref={headRef}>
        {/* pfp gutter - no label, keeps the header on the same track as rows */}
        <span className="mtx-head-cell" aria-hidden="true" />
        <HeadCell
          label="TXN"
          align="left"
          active={!!typeFilter}
          onFilterTap={canQuickType ? () => setTypeMenuOpen((v) => !v) : () => onOpenFilters?.('type')}
        />
        <HeadCell
          label="USD"
          align="left"
          active={valueFilterActive}
          onFilterTap={canQuickUsd ? openUsdSheet : () => onOpenFilters?.('value')}
        />
        <HeadCell
          label={showPriceMode ? 'PRICE' : 'MCAP'}
          align="left"
          active={priceFilterActive}
          onFilterTap={() => onOpenFilters?.('price')}
        />
        <HeadCell
          label="TRADER"
          align="right"
          active={!!makerFilter}
          onFilterTap={() => onOpenFilters?.('maker')}
        />

        {/* DexScreener-style instant type dropdown, anchored under TXN */}
        {typeMenuOpen && canQuickType && (
          <div className="mtx-typemenu" role="menu" aria-label="Transaction type">
              {typeFilterOptions.map((opt) => {
                const on = (typeFilter ?? null) === opt.value
                return (
                  <button
                    key={opt.label}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    className={`mtx-typemenu-item${on ? ' is-active' : ''}`}
                    onClick={() => { onTypeFilter(opt.value); setTypeMenuOpen(false) }}
                  >
                    <span className="mtx-typemenu-check" aria-hidden="true">
                      {on && <Check size={14} strokeWidth={2.5} />}
                    </span>
                    {opt.label}
                  </button>
                )
              })}
          </div>
        )}
      </div>

      <UsdFilterSheet
        open={usdSheetOpen}
        anchorY={usdAnchor}
        onClose={() => setUsdSheetOpen(false)}
        valueFilter={valueFilter}
        onApply={onValueFilter}
        trades={trades}
      />

      {loading && (
        <div className="mtx-body">
          {Array.from({ length: 12 }, (_, i) => <SkeletonRow key={i} />)}
        </div>
      )}

      {!loading && error && (
        <div className="mtx-empty">
          <p>Failed to load trades.</p>
          <button type="button" className="mtx-retry" onClick={onRetry}>
            <RefreshCw size={14} strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && empty && (
        <div className="mtx-empty">
          <p>No transactions yet.</p>
          <span>Live trades will appear here.</span>
        </div>
      )}

      {!loading && !error && !empty && filteredEmpty && (
        <div className="mtx-empty">
          <p>No {activeTypeLabel || 'matching'} transactions.</p>
          <span>Try a different filter.</span>
        </div>
      )}

      {!loading && !error && !empty && !filteredEmpty && (
        <>
          <div className="mtx-body">{rows}</div>

          {hasMore && (
            <div className="mtx-more">
              <button type="button" className="mtx-more-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
              <span className="mtx-more-count">{tradesCount} loaded</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
