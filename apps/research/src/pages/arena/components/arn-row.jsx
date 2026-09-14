/**
 * ArnRow — one book, 64px.
 *
 * THE SORT KEY IS R:DD — return divided by the deepest drawdown that book has
 * recorded. Ranking by equity would put the biggest starting balance on top and
 * call it skill; ranking by return would reward a book that went to −60% and
 * came back the same as one that never went down. The ratio is drawn as well as
 * printed, on a scale SHARED by every row on the page, so the reader can see
 * the spread rather than comparing eight decimals by eye.
 *
 * A book under the sample floor keeps its row, its name, its spark and its full
 * type weight — it simply does not get a rank, a return or a ratio, because
 * fifteen closes is where those stop being noise. It says "building 7/15" where
 * its rank would be. Nothing is dimmed or hidden.
 *
 * Retired books use this same component at data-state="retired": the ink drops
 * one step and the spark goes dashed. No opacity, no collapse, no smaller type.
 * A book that was switched off is the most informative row on the page.
 */
import { useEffect, useRef, useState } from 'react'
import ArnSpark from './arn-spark'
import { ArnAge } from './arn-ticker'
import { fmtDd, fmtPct, fmtRate, fmtRdd, SAMPLE_FLOOR } from './arn-format'

/** True for ~600ms after `value` changes, skipping the first paint. Drives the
 *  one-shot arrive pulse on the CHANGED CELL — never on the card. */
function useFlash(value) {
  const [on, setOn] = useState(false)
  const prev = useRef(value)
  const primed = useRef(false)
  useEffect(() => {
    if (!primed.current) { primed.current = true; prev.current = value; return undefined }
    if (prev.current === value) return undefined
    prev.current = value
    setOn(true)
    const t = setTimeout(() => setOn(false), 620)
    return () => clearTimeout(t)
  }, [value])
  return on ? 'true' : undefined
}

function Caret({ open }) {
  return (
    <svg className="arn-caret" data-open={open ? 'true' : 'false'} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 4.5L6 8l3-3.5" />
    </svg>
  )
}

export default function ArnRow({
  row,
  rank,
  rankDelta,
  scale,
  series,
  degraded = false,
  sub = false,
  generations = 0,
  expanded = false,
  onToggle,
  onOpen,
}) {
  const state = row.active ? 'live' : 'retired'
  // The pulse marks the cell whose OWN number moved, so each flash is bound to
  // the value that cell prints — not to a poll tick.
  const flashRet = useFlash(row.returnPct)
  const flashDd = useFlash(row.maxDd)
  const flashWin = useFlash(row.winRatePct)
  const flashOpen = useFlash(row.openPositions)

  const showNumbers = row.floorCleared
  const rddK = row.rdd != null && scale > 0 ? Math.min(1, Math.abs(row.rdd) / scale) : 0

  return (
    <div
      className={`arn-row${sub ? ' arn-row--sub' : ''}`}
      data-state={state}
      role="row"
    >
      <button
        type="button"
        className="arn-row__hit"
        onClick={() => onOpen?.(row)}
        aria-label={`Open ${row.name}`}
      />

      <div className="arn-row__rank arn-num" role="cell">
        {sub ? (
          <span className="arn-row__subtick" aria-hidden="true" />
        ) : showNumbers ? (
          <>
            <span>{rank ? String(rank).padStart(2, '0') : '—'}</span>
            {rankDelta ? (
              <span className={`arn-row__delta${rankDelta > 0 ? ' is-up' : ' is-down'}`}>
                {rankDelta > 0 ? '▲' : '▼'}{Math.abs(rankDelta)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="arn-row__building">{row.closed}/{SAMPLE_FLOOR}</span>
        )}
      </div>

      <div className="arn-row__id" role="cell">
        <span className="arn-row__name">{row.name}</span>
        {row.generation ? <span className="arn-chip arn-chip--gen">{row.generation.genLabel}</span> : null}
        {!row.floorCleared && row.generation ? (
          <span className="arn-chip arn-chip--chal">CHALLENGER · building {row.closed}/{SAMPLE_FLOOR}</span>
        ) : null}
        {row.isNew ? <span className="arn-chip arn-chip--new">NEW</span> : null}
        {!row.onBoard && !degraded ? (
          <span className="arn-chip arn-chip--off">NO CURVE YET</span>
        ) : null}
        {generations > 1 ? (
          <button
            type="button"
            className="arn-row__caret"
            onClick={(e) => { e.stopPropagation(); onToggle?.() }}
            aria-expanded={expanded}
          >
            <Caret open={expanded} />
            <span>{generations} generations</span>
          </button>
        ) : null}
      </div>

      <div className="arn-row__meta" role="cell">
        {/* On a phone the rank column is gone, so a book under the floor says
            what it is doing instead of naming its strategy — the more useful
            fact at that size. Both spans exist; CSS picks one. */}
        <span className={`arn-row__strat${showNumbers ? '' : ' arn-row__strat--d'}`}>
          {row.strategy || 'unpublished strategy'}
        </span>
        {!showNumbers ? (
          <span className="arn-row__strat--m">building {row.closed}/{SAMPLE_FLOOR}</span>
        ) : null}
        <span className="arn-sep">·</span>
        <span className="arn-num">n={row.closed}</span>
        {/* The age gives up its seat on a phone — line 2's width belongs to
            the strategy name and the three numbers beside it. */}
        <span className="arn-row__agewrap">
          <span className="arn-sep">·</span>
          <ArnAge at={row.startedAt} className="arn-num" />
        </span>
      </div>

      <div className="arn-row__spark" role="cell">
        <ArnSpark
          points={series?.points}
          starting={row.starting}
          current={row.equity}
          state={state}
        />
      </div>

      <div className="arn-row__ret arn-num arn-cell" data-flash={flashRet} role="cell">
        {showNumbers ? (
          <span className={row.returnPct > 0 ? 'is-up' : row.returnPct < 0 ? 'is-down' : ''}>
            {fmtPct(row.returnPct)}
          </span>
        ) : <span className="arn-none">—</span>}
      </div>

      <div className="arn-row__dd arn-num arn-cell" data-flash={flashDd} role="cell">
        {row.maxDd > 0 ? fmtDd(row.maxDd) : <span className="arn-none">—</span>}
      </div>

      <div className="arn-row__rdd arn-cell" role="cell">
        {showNumbers && row.rdd != null ? (
          <>
            <span className="arn-num">{fmtRdd(row.rdd)}</span>
            <span className="arn-mb" aria-hidden="true">
              <span className="arn-mb__zero" />
              <span
                className={`arn-mb__fill${row.rdd >= 0 ? ' is-up' : ' is-down'}`}
                style={{ '--k': rddK.toFixed(3) }}
              />
            </span>
          </>
        ) : showNumbers && row.noRiskOnRecord ? (
          <span className="arn-none arn-none--wrap">no risk on record</span>
        ) : (
          <span className="arn-none">—</span>
        )}
      </div>

      <div className="arn-row__win arn-num arn-cell" data-flash={flashWin} role="cell">
        {row.winRatePct != null && row.closed > 0 ? (
          <>
            <span>{fmtRate(row.winRatePct, row.closed)}</span>
            <span className="arn-row__n">n={row.closed}</span>
          </>
        ) : <span className="arn-none">—</span>}
      </div>

      <div className="arn-row__open arn-num arn-cell" data-flash={flashOpen} role="cell">
        <span>{row.openPositions}</span>
        <span className="arn-row__openw"> open</span>
      </div>

      <div className="arn-row__chev" role="cell" aria-hidden="true">
        <svg viewBox="0 0 12 12"><path d="M4.5 3L8 6l-3.5 3" /></svg>
      </div>
    </div>
  )
}
