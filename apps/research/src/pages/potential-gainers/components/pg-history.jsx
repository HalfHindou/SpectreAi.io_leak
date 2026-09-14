/*
 * PGHistory - Hourly Signal Tape. Redesigned as a heat-timeline.
 *
 * Each snapshot (hour) is a compact unit: timestamp + matured/pending counts
 * + a strip of small cells (one per token called) coloured by post-signal
 * return sign: green = positive, red = negative, grey = pending (not yet aged).
 * Click/tap a snapshot to expand the full token detail for that hour.
 *
 * The heat cells qualify as return-encoded values and use --bull/--bear per
 * the design system (not decorative colour).
 *
 * Show 14 snapshots initially; "show all" reveals the remaining 48.
 * The most recent snapshot opens by default.
 *
 * Data shape (from /api/momentum/setups/history):
 *   snapshot.tokens[].returns.{return_24h_pct, return_48h_pct, return_72h_pct}
 *   hasAged when any return horizon has a real non-null number.
 */
import { useMemo, useState } from 'react'
import { useMomentumHistory } from '@/hooks/useMomentumData'
import {
  formatHourLabel, relativeTime, stageMeta, formatMarketCap, formatSignedPct,
  returnTone, clampScore, toNumber,
} from './pg-utils'

const INITIAL_SNAPSHOTS = 14

/* A single-return horizon check: the first non-null horizon value. */
function bestReturn(returns) {
  const v24 = toNumber(returns?.return_24h_pct)
  const v48 = toNumber(returns?.return_48h_pct)
  const v72 = toNumber(returns?.return_72h_pct)
  if (v24 != null) return v24
  if (v48 != null) return v48
  if (v72 != null) return v72
  return null
}

function hasAged(returns) {
  return bestReturn(returns) != null
}

/* Return ladder shown in the expanded detail row. */
function ReturnLadder({ returns }) {
  const cells = [
    { k: '24h', v: toNumber(returns?.return_24h_pct) },
    { k: '48h', v: toNumber(returns?.return_48h_pct) },
    { k: '72h', v: toNumber(returns?.return_72h_pct) },
  ]
  return (
    <span className="pg-snap__rets" role="group" aria-label="Post-signal returns">
      {cells.map((cell) => (
        <span className="pg-snap__ret" key={cell.k}>
          <span className="pg-snap__ret-k">{cell.k}</span>
          <span className={`pg-snap__ret-v pg-tone--${returnTone(cell.v)}`}>
            {cell.v != null ? formatSignedPct(cell.v, 0) : '—'}
          </span>
        </span>
      ))}
    </span>
  )
}

/* SnapshotHeatRow - one hour's compact heat strip + expandable detail. */
function SnapshotHeatRow({ snapshot, defaultOpen }) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const tokens = Array.isArray(snapshot?.tokens) ? snapshot.tokens : []

  const agedCount = tokens.filter((t) => hasAged(t?.returns)).length
  const pendingCount = tokens.length - agedCount
  const allPending = agedCount === 0 && tokens.length > 0

  /* Build heat cells: one per token, coloured by best return sign. */
  const heatCells = tokens.map((entry) => {
    const ret = bestReturn(entry?.returns)
    const aged = ret != null
    let tone = 'pending'
    if (aged) tone = ret > 0 ? 'up' : ret < 0 ? 'down' : 'flat'
    return { tone, ret, symbol: entry?.token?.symbol || '?' }
  })

  const maturedLabel = allPending
    ? 'maturing'
    : `${agedCount}/${tokens.length} aged`

  return (
    <div className={`pg-htl-snap${open ? ' pg-htl-snap--open' : ''}`}>
      {/* Compact header row: tap to expand */}
      <button
        type="button"
        className="pg-htl-snap__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="pg-htl-snap__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="pg-htl-snap__time">{formatHourLabel(snapshot?.snapshot_at)}</span>
        <span className="pg-htl-snap__ago">{relativeTime(snapshot?.snapshot_at)}</span>

        {/* Heat strip - each cell is one signal */}
        <span className="pg-htl-snap__heat" aria-label={`${tokens.length} signals`}>
          {heatCells.map((cell, i) => (
            <span
              key={i}
              className={`pg-htl-cell pg-htl-cell--${cell.tone}`}
              title={`${cell.symbol} · ${cell.tone === 'pending' ? 'pending' : `${cell.ret != null ? formatSignedPct(cell.ret, 0) : '—'}`}`}
              aria-hidden="true"
            />
          ))}
        </span>

        <span className="pg-htl-snap__matured">{maturedLabel}</span>
        <span className="pg-htl-snap__count">{tokens.length}</span>
      </button>

      {/* Expanded detail - exact tokens called at this timestamp */}
      {open && (
        <div className="pg-htl-snap__body">
          {tokens.length === 0 && (
            <div className="pg-snap__empty">No tokens in this snapshot.</div>
          )}
          {tokens.map((entry, i) => {
            const tk = entry?.token || {}
            const stage = stageMeta(entry?.stage)
            const aged = hasAged(entry?.returns)
            const symbol = tk.symbol ? String(tk.symbol).replace(/^\$/, '') : (tk.cg_id || '—')
            return (
              <div className="pg-snap__row" key={`${tk.cg_id || symbol}-${i}`}>
                <span className="pg-snap__rank">{entry?.setup_rank ?? i + 1}</span>
                <span className="pg-snap__token">
                  <span className="pg-snap__sym">{symbol}</span>
                  <span className="pg-snap__name">{tk.name || ''}</span>
                </span>
                <span className={`pg-stage pg-stage--sm ${stage.cls}`}>{stage.label}</span>
                <span className="pg-snap__score">{clampScore(entry?.setup_score)}</span>
                <span className="pg-snap__src">{entry?.source_rank != null ? `#${entry.source_rank}` : '-'}</span>
                <span className="pg-snap__mcap">{formatMarketCap(entry?.signal_market_cap)}</span>
                {aged
                  ? <ReturnLadder returns={entry?.returns} />
                  : <span className="pg-snap__pending">Pending maturation</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PGHistory({ timeframe = '7d', bucket = 'top10', enabled = true }) {
  const [showAll, setShowAll] = useState(false)
  const { data, loading, error, refetch } = useMomentumHistory({
    timeframe, bucket, limitSnapshots: 48, days: 21, enabled,
  })

  const snapshots = useMemo(() => {
    const list = Array.isArray(data?.snapshots) ? data.snapshots : []
    return [...list].sort((a, b) => String(b.snapshot_at || '').localeCompare(String(a.snapshot_at || '')))
  }, [data])

  const visibleSnapshots = showAll ? snapshots : snapshots.slice(0, INITIAL_SNAPSHOTS)

  return (
    <section className="pg-panel pg-history">
      <header className="pg-panel__head">
        <div>
          <h3 className="pg-panel__title">Hourly Signal Tape</h3>
          <p className="pg-panel__sub">
            Heat map of signals called each hour — green cells aged positive, red cells aged
            negative, grey cells still maturing. Tap a row to see the exact tokens called at
            that timestamp.
          </p>
        </div>
      </header>

      {loading && (
        <div className="pg-history__shimmer">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="pg-shimmer-bar pg-shimmer-bar--row animate-shimmer" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="pg-empty pg-empty--error">
          <div className="pg-empty__title">Signal tape unavailable</div>
          <div className="pg-empty__detail">{error}</div>
          <button type="button" className="pg-btn pg-btn--ghost" onClick={() => refetch()}>Retry</button>
        </div>
      )}

      {!loading && !error && snapshots.length === 0 && (
        <div className="pg-empty">
          <div className="pg-empty__title">No snapshots yet</div>
          <div className="pg-empty__detail">Hourly signal tape builds as the board regenerates.</div>
        </div>
      )}

      {!loading && !error && snapshots.length > 0 && (
        <>
          {/* Legend */}
          <div className="pg-htl__legend" aria-label="Heat cell legend">
            <span className="pg-htl__legend-item">
              <span className="pg-htl-cell pg-htl-cell--up" aria-hidden="true" />
              Positive
            </span>
            <span className="pg-htl__legend-item">
              <span className="pg-htl-cell pg-htl-cell--down" aria-hidden="true" />
              Negative
            </span>
            <span className="pg-htl__legend-item">
              <span className="pg-htl-cell pg-htl-cell--pending" aria-hidden="true" />
              Pending
            </span>
          </div>

          <div className="pg-htl__list" role="list">
            {visibleSnapshots.map((snap, i) => (
              <SnapshotHeatRow
                key={snap.snapshot_at || i}
                snapshot={snap}
                defaultOpen={i === 0}
              />
            ))}
          </div>

          {snapshots.length > INITIAL_SNAPSHOTS && (
            <button
              type="button"
              className="pg-btn pg-btn--ghost pg-history__more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? 'Show fewer'
                : `Show all ${snapshots.length} hourly snapshots`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
