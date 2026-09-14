/*
 * PGHeatGrid - Return Heat Grid
 *
 * Returns matrix. Rows = tokens (sorted by current return, largest first).
 * Columns = 72h / Current / Peak
 * (return_72h_pct / return_since_signal_pct / peak_return_since_signal_pct)
 *
 * 24h/48h checkpoints are intentionally not promoted in the product UI yet:
 * older rows can contain stale market caps from before the CoinGecko refresh
 * job existed, which makes those early checkpoints look falsely flat.
 *
 * Each cell colored by return magnitude — alpha scales with |return|:
 *   null -> neutral "—"
 *   small moves muted, big moves saturated
 *
 * Color encodes sign: green = positive (--bull), red = negative (--bear).
 * Magnitude = alpha ramp from 0.06 (near-zero) to 0.30 (large move).
 *
 * On mobile: horizontal scroll inside own container, never the page.
 */

import { useMemo } from 'react'
import { toNumber, formatSignedPct, returnTone, lifecycleMeta } from './pg-utils'

const COLS = [
  { key: 'r72', label: '72h', field: 'return_72h_pct' },
  { key: 'cur', label: 'Current', field: 'return_since_signal_pct' },
  { key: 'peak', label: 'Peak', field: 'peak_return_since_signal_pct' },
]

/* Magnitude-graded cell background alpha.
   Scales from near-0 for tiny moves to 0.28 for >50% moves. */
function cellAlpha(absRet) {
  if (absRet == null || absRet < 1) return 0
  if (absRet < 5) return 0.06
  if (absRet < 10) return 0.10
  if (absRet < 20) return 0.14
  if (absRet < 35) return 0.18
  if (absRet < 50) return 0.22
  return 0.28
}

function cellStyle(value) {
  if (value == null) return {}
  const abs = Math.abs(value)
  const alpha = cellAlpha(abs)
  if (alpha === 0) return {}
  if (value > 0) return { background: `rgba(16,185,129,${alpha})` }
  return { background: `rgba(239,68,68,${alpha})` }
}

function TokenCell({ row }) {
  const token = row?.token || {}
  const sym = token.symbol ? String(token.symbol).replace(/^\$/, '') : '?'
  const letter = sym.charAt(0).toUpperCase() || '?'
  const lc = lifecycleMeta(row?.potential_gainer?.lifecycle?.phase)
  const src = token.image_small || token.image_url

  return (
    <div className="pg-hg__token-cell">
      {src ? (
        <img
          className="pg-hg__token-logo"
          src={src}
          alt={sym}
          width={20}
          height={20}
          loading="lazy"
          onError={(e) => {
            const span = document.createElement('span')
            span.className = 'pg-hg__token-logo pg-hg__token-logo--fallback'
            span.textContent = letter
            e.currentTarget.replaceWith(span)
          }}
        />
      ) : (
        <span className="pg-hg__token-logo pg-hg__token-logo--fallback">{letter}</span>
      )}
      <div className="pg-hg__token-info">
        <span className="pg-hg__token-sym">{sym}</span>
        <span className={`pg-hg__token-phase ${lc.cls}`}>{lc.label}</span>
      </div>
    </div>
  )
}

function ReturnCell({ value }) {
  if (value == null) {
    return (
      <div className="pg-hg__cell pg-hg__cell--null">
        <span className="pg-hg__cell-dash">—</span>
      </div>
    )
  }
  const tone = returnTone(value)
  const style = cellStyle(value)
  return (
    <div className="pg-hg__cell" style={style}>
      <span className={`pg-hg__cell-val pg-tone--${tone}`}>
        {formatSignedPct(value, 0)}
      </span>
    </div>
  )
}

function HeatGridShimmer() {
  return (
    <div className="pg-hg pg-hg--shimmer">
      <div className="pg-hg__header">
        <span className="pg-shimmer-bar animate-shimmer" style={{ width: 110, height: 14 }} />
      </div>
      <div className="pg-hg__scroll">
        <div className="pg-hg__inner">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="pg-hg__row pg-hg__row--shimmer">
              <span className="pg-shimmer-bar animate-shimmer" style={{ width: 100, height: 32 }} />
              {COLS.map((c) => (
                <span key={c.key} className="pg-shimmer-bar animate-shimmer" style={{ width: 64, height: 28 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function PGHeatGrid({ signals, loading, onOpenToken }) {
  const rows = useMemo(() => {
    const list = Array.isArray(signals) ? signals : []
    return [...list]
      .filter((row) => row?.potential_gainer)
      .sort((a, b) => {
        const ra = toNumber(a?.potential_gainer?.return_since_signal_pct) ?? -Infinity
        const rb = toNumber(b?.potential_gainer?.return_since_signal_pct) ?? -Infinity
        return rb - ra
      })
  }, [signals])

  if (loading) return <HeatGridShimmer />

  if (rows.length === 0) {
    return (
      <div className="pg-hg">
        <div className="pg-hg__header">
          <span className="pg-hg__title">Returns Matrix</span>
        </div>
        <div className="pg-empty pg-empty--compact">
          <div className="pg-empty__detail">No signal data yet</div>
        </div>
      </div>
    )
  }

  return (
    <div className="pg-hg">
      <div className="pg-hg__header">
        <div>
          <span className="pg-hg__title">Returns Matrix</span>
          <span className="pg-hg__sub">
            Reliable return checkpoints anchored to each token&rsquo;s PG signal timestamp.
            24h/48h are hidden until historical market-cap backfill is complete.
          </span>
        </div>
        <div className="pg-hg__legend" aria-hidden="true">
          <span className="pg-hg__legend-item">
            <span className="pg-hg__legend-swatch pg-hg__legend-swatch--bull" />
            Positive
          </span>
          <span className="pg-hg__legend-item">
            <span className="pg-hg__legend-swatch pg-hg__legend-swatch--bear" />
            Negative
          </span>
          <span className="pg-hg__legend-item pg-hg__legend-item--null">
            — Not yet aged
          </span>
        </div>
      </div>

      <div className="pg-hg__scroll" tabIndex={0} aria-label="Returns matrix, scroll horizontally to see all columns">
        <div className="pg-hg__inner" role="table" aria-label="Token return heat grid">
          {/* Header row */}
          <div className="pg-hg__row pg-hg__row--head" role="row">
            <div className="pg-hg__col-token" role="columnheader">Token</div>
            {COLS.map((col) => (
              <div key={col.key} className="pg-hg__col-cell" role="columnheader">
                {col.label}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {rows.map((row, i) => {
            const pg = row.potential_gainer || {}
            const cgId = row?.token?.cg_id
            const clickable = Boolean(cgId) && typeof onOpenToken === 'function'
            const openDetail = () => { if (clickable) onOpenToken(cgId) }
            return (
              <div
                key={cgId || i}
                className={`pg-hg__row${clickable ? ' pg-hg__row--clickable' : ''}`}
                role="row"
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? `Open ${row?.token?.symbol || 'token'} signal detail` : undefined}
                onClick={clickable ? openDetail : undefined}
                onKeyDown={clickable ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openDetail()
                  }
                } : undefined}
              >
                <div className="pg-hg__col-token" role="cell">
                  <TokenCell row={row} />
                </div>
                {COLS.map((col) => (
                  <div key={col.key} className="pg-hg__col-cell" role="cell">
                    <ReturnCell value={toNumber(pg[col.field])} />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
