/*
 * PGLifecycleRail - Signal Lifecycle Pipeline
 *
 * A compact horizontal pipeline at the top of the board section.
 * 5 stages left-to-right: Fresh -> Developing -> Runner -> Already Ran -> Stalled
 * Each node shows stage name, count, and up to 3 token logo chips.
 * Clicking a stage scrolls to that board section.
 *
 * The 7 API phases map onto 5 rail stages:
 *   fresh -> Fresh
 *   developing -> Developing
 *   runner -> Runner
 *   already_ran + matured_positive -> Already Ran
 *   stalled + drawdown -> Stalled
 *
 * Board group scroll IDs: pg-grp-fresh, pg-grp-developing, pg-grp-runner,
 *   pg-grp-already_ran, pg-grp-accountability
 */

import { useMemo } from 'react'

/* The 5 visible rail stages in pipeline order. */
const RAIL_STAGES = [
  {
    key: 'fresh',
    label: 'Fresh',
    phases: ['fresh'],
    scrollId: 'pg-grp-fresh',
    cls: 'pg-rail__node--fresh',
  },
  {
    key: 'developing',
    label: 'Developing',
    phases: ['developing'],
    scrollId: 'pg-grp-developing',
    cls: 'pg-rail__node--developing',
  },
  {
    key: 'runner',
    label: 'Runner',
    phases: ['runner'],
    scrollId: 'pg-grp-runner',
    cls: 'pg-rail__node--runner',
  },
  {
    key: 'already_ran',
    label: 'Already Ran',
    phases: ['already_ran', 'matured_positive'],
    scrollId: 'pg-grp-already_ran',
    cls: 'pg-rail__node--ran',
  },
  {
    key: 'stalled',
    label: 'Stalled',
    phases: ['stalled', 'drawdown'],
    scrollId: 'pg-grp-accountability',
    cls: 'pg-rail__node--stalled',
  },
]

/* Small breathing margin above the scrolled-to group. */
const SCROLL_GAP = 16

/* Find the real scroll container by walking up from the element. The research
   app scrolls an inner container (.page-layout on desktop), not the window -
   and scrollIntoView does not reliably move it - so we resolve the scroller
   and scroll it directly. */
function findScroller(el) {
  let n = el?.parentElement
  while (n && n !== document.body) {
    const cs = getComputedStyle(n)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
      && n.scrollHeight > n.clientHeight + 4) {
      return n
    }
    n = n.parentElement
  }
  return document.scrollingElement || document.documentElement
}

/* Jump a board group to the top of its scroll container.
   Two quirks handled:
   - native scrollTo({behavior:'smooth'}) is a no-op on this app's inner
     scroll container, so we scroll instantly;
   - a focused (now off-screen) control makes the browser yank the scroll
     back to it, so we blur the active element and re-assert the jump on the
     next ticks - the re-asserts run after any focus-yank and win. */
function scrollToGroup(scrollId) {
  const el = document.getElementById(scrollId)
  if (!el) return
  const scroller = findScroller(el)
  const apply = () => {
    const top = el.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
      + scroller.scrollTop
      - SCROLL_GAP
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
  }
  apply()
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur()
  }
  setTimeout(apply, 0)
}

function RailChip({ token, masked }) {
  const sym = token?.token?.symbol || ''
  const letter = String(sym).replace(/^\$/, '').charAt(0).toUpperCase() || '?'
  const src = token?.token?.image_small || token?.token?.image_url

  if (masked || !src) {
    return (
      <span
        className="pg-rail__chip pg-rail__chip--fallback"
        title={masked ? undefined : sym}
        aria-hidden="true"
      >
        {masked ? '?' : letter}
      </span>
    )
  }
  return (
    <img
      className="pg-rail__chip"
      src={src}
      alt={sym}
      title={sym}
      loading="lazy"
      width={20}
      height={20}
      onError={(e) => {
        const span = document.createElement('span')
        span.className = 'pg-rail__chip pg-rail__chip--fallback'
        span.textContent = letter
        e.currentTarget.replaceWith(span)
      }}
    />
  )
}

function RailNodeShimmer() {
  return (
    <div className="pg-rail__node pg-rail__node--shimmer">
      <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" style={{ width: 48 }} />
      <span className="pg-shimmer-bar animate-shimmer" style={{ width: 20, height: 20, borderRadius: 10 }} />
    </div>
  )
}

export default function PGLifecycleRail({ signals, loading, phaseCounts }) {
  /* Build per-stage buckets from the live signals array.
     phase_counts from the API is an alternate fast-path for totals. */
  const stageBuckets = useMemo(() => {
    const map = {}
    RAIL_STAGES.forEach((s) => { map[s.key] = [] })
    ;(Array.isArray(signals) ? signals : []).forEach((row) => {
      const phase = row?.potential_gainer?.lifecycle?.phase
      if (!phase) return
      const stage = RAIL_STAGES.find((s) => s.phases.includes(phase))
      if (stage) {
        map[stage.key].push(row)
      }
    })
    return map
  }, [signals])

  /* Use API phase_counts for the total numbers when available and signals list
     may be trimmed by the limit param. */
  const stageCount = (stageKey) => {
    const stage = RAIL_STAGES.find((s) => s.key === stageKey)
    if (!stage) return 0
    if (phaseCounts) {
      return stage.phases.reduce((acc, p) => acc + (Number(phaseCounts[p]) || 0), 0)
    }
    return stageBuckets[stageKey]?.length || 0
  }

  const totalCount = RAIL_STAGES.reduce((sum, s) => sum + stageCount(s.key), 0)

  return (
    <div className="pg-rail" role="navigation" aria-label="Signal lifecycle stages">
      <div className="pg-rail__inner">
        {RAIL_STAGES.map((stage, i) => {
          const count = stageCount(stage.key)
          const tokens = stageBuckets[stage.key] || []
          /* Show up to 3 chips, prefer the first 3 */
          const chips = tokens.slice(0, 3)

          return (
            <div key={stage.key} className="pg-rail__step">
              {/* connector line between nodes */}
              {i > 0 && (
                <div className="pg-rail__connector" aria-hidden="true">
                  <div
                    className={`pg-rail__connector-fill${count > 0 ? ' pg-rail__connector-fill--active' : ''}`}
                  />
                </div>
              )}

              {loading ? (
                <RailNodeShimmer />
              ) : (
                <button
                  type="button"
                  className={`pg-rail__node${count > 0 ? ` ${stage.cls}` : ' pg-rail__node--empty'}`}
                  /* preventDefault on mousedown stops the button grabbing
                     focus on click - a focused off-screen button makes the
                     browser yank the scroll back to it, fighting scrollToGroup */
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => scrollToGroup(stage.scrollId)}
                  title={`Scroll to ${stage.label} signals`}
                  aria-label={`${stage.label}: ${count} signal${count !== 1 ? 's' : ''}`}
                >
                  <div className="pg-rail__node-top">
                    <span className="pg-rail__node-label">{stage.label}</span>
                    <span className="pg-rail__node-count">{count}</span>
                  </div>
                  {chips.length > 0 && (
                    <div className="pg-rail__node-chips" aria-hidden="true">
                      {chips.map((row, ci) => (
                        <RailChip
                          key={row?.token?.cg_id || ci}
                          token={row}
                        />
                      ))}
                      {count > 3 && (
                        <span className="pg-rail__chip-more">+{count - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {!loading && totalCount > 0 && (
        <div className="pg-rail__footer" aria-live="polite">
          <span className="pg-rail__total">{totalCount} live signals tracked</span>
        </div>
      )}
    </div>
  )
}
