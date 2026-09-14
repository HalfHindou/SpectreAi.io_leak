/*
 * PGBoard - the persistent Potential Gainers signal board.
 *
 * Renders signals from /api/momentum/setups/signals, grouped by lifecycle
 * phase into product-ordered sections:
 *   Fresh -> Developing -> Runners -> Already Moved -> Matured & Stalled
 *
 * This is NOT a daily leaderboard. Every token is a PG signal carried
 * forward, so a user can see what to watch now (fresh / developing) and what
 * already proved out (runners / matured) - all tracked from the first PG
 * signal timestamp.
 *
 * Shimmer skeletons while loading - never a spinner.
 */
import { useMemo, useState } from 'react'
import PGTokenCard from './pg-token-card'
import { lifecycleMeta } from './pg-utils'

/* Board sections, in product order. `desc` is the framing a serious user
   needs to read each section correctly - especially that runners / already-
   moved are proof, not fresh alpha. */
const GROUPS = [
  {
    key: 'fresh',
    title: 'Fresh Signals',
    desc: 'New Potential Gainers signals, still inside the early discovery window — the closest thing to a current opportunity.',
  },
  {
    key: 'developing',
    title: 'Developing',
    desc: 'Inside the 24-72h window where prior winners matured. The setup is still playing out.',
  },
  {
    key: 'runner',
    title: 'Runners',
    desc: 'Already made a strong post-signal move. Spectre flagged them early — track continuation and pullbacks, not fresh discovery.',
  },
  {
    key: 'already_ran',
    title: 'Already Moved',
    desc: 'Made a major move after the signal. Shown as proof Spectre called them early — most of the move has already happened.',
  },
  {
    key: 'accountability',
    title: 'Matured & Stalled',
    desc: 'The accountability layer — completed calls that aged positive, plus the ones that stalled or went underwater. Shown in full, for honesty.',
    collapsible: true,
  },
]

/* fresh / developing sort newest-first (freshest opportunity leads);
   every other group sorts by return since signal, biggest move first. */
const FRESH_GROUPS = new Set(['fresh', 'developing'])

function sortByReturn(a, b) {
  const ra = Number(a?.potential_gainer?.return_since_signal_pct)
  const rb = Number(b?.potential_gainer?.return_since_signal_pct)
  return (Number.isFinite(rb) ? rb : -Infinity) - (Number.isFinite(ra) ? ra : -Infinity)
}
function sortByFreshest(a, b) {
  return String(b?.potential_gainer?.signal?.signaled_at || '')
    .localeCompare(String(a?.potential_gainer?.signal?.signaled_at || ''))
}

function BoardShimmer({ count = 6 }) {
  return (
    <div className="pg-grp">
      <div className="pg-grp__head pg-grp__head--shimmer">
        <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
      </div>
      <div className="pg-grp__rows">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="pg-row pg-row--shimmer">
            <div className="pg-row__identity">
              <span className="pg-shimmer-avatar animate-shimmer" />
              <span className="pg-shimmer-bar pg-shimmer-bar--md animate-shimmer" />
            </div>
            <span className="pg-shimmer-bar pg-shimmer-bar--row animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SignalGroup({ group, rows, onOpenToken }) {
  const [open, setOpen] = useState(!group.collapsible)
  if (rows.length === 0) return null

  const headInner = (
    <>
      {group.collapsible && (
        <span className="pg-grp__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      )}
      <span className="pg-grp__title">{group.title}</span>
      <span className="pg-grp__count">{rows.length}</span>
      <span className="pg-grp__desc">{group.desc}</span>
    </>
  )

  return (
    <section
      id={`pg-grp-${group.key}`}
      className={`pg-grp pg-grp--${group.key}${open ? '' : ' pg-grp--collapsed'}`}
    >
      {group.collapsible ? (
        <button
          type="button"
          className="pg-grp__head pg-grp__head--btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {headInner}
        </button>
      ) : (
        <div className="pg-grp__head">{headInner}</div>
      )}
      {open && (
        <div className="pg-grp__rows">
          {rows.map((row, i) => (
            <PGTokenCard
              key={row?.token?.cg_id || row?.token?.symbol || i}
              row={row}
              onOpenToken={onOpenToken}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default function PGBoard({ signals, loading, error, onRetry, masked, onOpenToken }) {
  const grouped = useMemo(() => {
    const buckets = {}
    ;(Array.isArray(signals) ? signals : []).forEach((row) => {
      const g = lifecycleMeta(row?.potential_gainer?.lifecycle?.phase).group
      ;(buckets[g] = buckets[g] || []).push(row)
    })
    Object.entries(buckets).forEach(([g, rows]) => {
      rows.sort(FRESH_GROUPS.has(g) ? sortByFreshest : sortByReturn)
    })
    return buckets
  }, [signals])

  if (loading) return <BoardShimmer count={masked ? 3 : 6} />

  if (error) {
    return (
      <div className="pg-empty pg-empty--error">
        <div className="pg-empty__title">Signal board unavailable</div>
        <div className="pg-empty__detail">{error}</div>
        {onRetry && (
          <button type="button" className="pg-btn pg-btn--ghost" onClick={onRetry}>Retry</button>
        )}
      </div>
    )
  }

  const list = Array.isArray(signals) ? signals : []
  if (list.length === 0) {
    return (
      <div className="pg-empty">
        <div className="pg-empty__title">No live signals right now</div>
        <div className="pg-empty__detail">
          Potential Gainers signals appear when clean social-momentum setups surface from X intelligence.
        </div>
      </div>
    )
  }

  // Free preview: a masked taste of the freshest 3 signals, ungrouped.
  if (masked) {
    return (
      <div className="pg-board">
        <div className="pg-grp__rows">
          {list.slice(0, 3).map((row, i) => (
            <PGTokenCard key={i} row={row} masked />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="pg-board">
      {GROUPS.map((group) => (
        <SignalGroup
          key={group.key}
          group={group}
          rows={grouped[group.key] || []}
          onOpenToken={onOpenToken}
        />
      ))}
    </div>
  )
}
