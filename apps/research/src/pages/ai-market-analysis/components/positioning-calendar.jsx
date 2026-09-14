/**
 * The earnings calendar — a runway and a month, side by side.
 *
 * The first version was one long list, which is the wrong shape for this data:
 * the prints cluster (one tomorrow, eleven in a single week two months out) and
 * a list flattens a cluster into twelve identical rows you have to scroll past
 * to see. So the surface splits in two — the runway answers "what is next", the
 * month answers "when does it get busy" — and the two sit on one line so the
 * page does not grow to hold them.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getStockLogo } from '@/constants/stockData'
import { earningsMonth, firstPrintMonth, stepMonth, fmtBig } from '@/lib/options-read'

const cx = (...a) => a.filter(Boolean).join(' ')
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/**
 * A logo that degrades to the ticker rather than to a broken-image glyph.
 * FMP covers every US listing we track but it is a third party, and an empty
 * frame in a calendar reads as a data error rather than a missing PNG.
 */
function Logo({ symbol, size = 22 }) {
  const [failed, setFailed] = useState(false)
  const src = failed ? null : getStockLogo(symbol)
  if (!src) {
    return <span className="po-logo po-logo--text" style={{ width: size, height: size }}>{symbol.slice(0, 2)}</span>
  }
  return (
    <img
      className="po-logo"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Whether a scroll container actually overflows.
 *
 * Drives the fade at the bottom of the runway: macOS hides overlay scrollbars
 * at rest, so a list that is capped at six rows gives no sign that a seventh
 * exists — and a fade applied unconditionally would dim the last row of a list
 * that fits, which is worse than no hint at all.
 */
function useOverflows(depKey) {
  const ref = useRef(null)
  const [overflows, setOverflows] = useState(false)
  const measure = useCallback(() => {
    const el = ref.current
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [])
  useLayoutEffect(() => {
    measure()
    if (typeof ResizeObserver !== 'function' || !ref.current) return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [measure, depKey])
  return [ref, overflows]
}

export default function EarningsCalendar({ runway, symbol, onPick }) {
  const [cursor, setCursor] = useState(null)
  const month = cursor || firstPrintMonth(runway)
  const grid = useMemo(() => earningsMonth(runway, month.year, month.month), [runway, month])

  const [next, ...rest] = runway
  const [rowsRef, rowsOverflow] = useOverflows(rest.length)
  if (!next) return null

  return (
    <section className="po-panel po-cal">
      <div className="po-panel-head">
        <h3>The earnings runway</h3>
        <span className="po-panel-sub">next confirmed report for every name on this board</span>
      </div>

      <div className="po-cal-split">
        {/* ── the runway ── */}
        <div className="po-cal-box">
          <span className="po-cal-eyebrow">Next up</span>

          <button
            className={cx('po-next', next.symbol === symbol && 'is-active')}
            onClick={() => onPick(next.symbol)}
          >
            <Logo symbol={next.symbol} size={40} />
            <span className="po-next-body">
              <span className="po-next-top">
                <b>{next.symbol}</b>
                <i className={cx('po-next-count', next.soon && 'is-soon')}>{next.countdown}</i>
              </span>
              <span className="po-next-when">{next.when}</span>
              {(next.epsEstimate != null || next.revenueEstimate != null) && (
                <span className="po-next-est">
                  {next.epsEstimate != null && <>{`$${next.epsEstimate.toFixed(2)}`} a share</>}
                  {next.revenueEstimate != null && <> · {fmtBig(next.revenueEstimate)}</>}
                  <i> expected</i>
                </span>
              )}
            </span>
          </button>

          {rest.length > 0 && (
            <>
              <span className="po-cal-eyebrow po-cal-eyebrow--after">Then</span>
              {/* Capped and scrolled INSIDE the box: twelve names must not set
                  the height of the page. */}
              <div className={cx('po-cal-rows', rowsOverflow && 'is-scrollable')} ref={rowsRef}>
                {rest.map((r) => (
                  <button
                    key={r.symbol}
                    className={cx('po-cal-row', r.soon && 'is-soon', r.symbol === symbol && 'is-active')}
                    onClick={() => onPick(r.symbol)}
                  >
                    <Logo symbol={r.symbol} size={20} />
                    <span className="po-cr-sym">{r.symbol}</span>
                    <span className="po-cr-when">{r.whenShort}</span>
                    <span className={cx('po-cr-count', r.soon && 'is-soon')}>{r.countdown}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── the month ── */}
        <div className="po-cal-box po-cal-box--month">
          <div className="po-mon-head">
            <button className="po-mon-nav" onClick={() => setCursor(stepMonth(month, -1))} aria-label="Previous month">‹</button>
            <span className="po-mon-label">
              {grid.label}
              <i>{grid.count === 0 ? 'nothing scheduled' : grid.count === 1 ? '1 report' : `${grid.count} reports`}</i>
            </span>
            <button className="po-mon-nav" onClick={() => setCursor(stepMonth(month, 1))} aria-label="Next month">›</button>
          </div>

          <div className="po-mon-dow">
            {DOW.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="po-mon-grid">
            {grid.weeks.map((week, wi) => week.map((cell, ci) => {
              if (!cell) return <span key={`${wi}-${ci}`} className="po-mon-cell is-blank" />
              const has = cell.prints.length > 0
              const Tag = has ? 'button' : 'span'
              return (
                <Tag
                  key={`${wi}-${ci}`}
                  className={cx('po-mon-cell', cell.isToday && 'is-today', has && 'has-print',
                    has && cell.prints.some((p) => p.symbol === symbol) && 'is-active')}
                  {...(has ? { onClick: () => onPick(cell.prints[0].symbol), title: cell.prints.map((p) => p.symbol).join(', ') } : {})}
                >
                  <span className="po-mon-day">{cell.day}</span>
                  {has && (
                    <span className="po-mon-marks">
                      {cell.prints.slice(0, 3).map((p) => <Logo key={p.symbol} symbol={p.symbol} size={16} />)}
                      {cell.prints.length > 3 && <i className="po-mon-more">+{cell.prints.length - 3}</i>}
                    </span>
                  )}
                </Tag>
              )
            }))}
          </div>

          {grid.weekend.length > 0 && (
            <p className="po-mon-note">
              {grid.weekend.map((r) => r.symbol).join(', ')} filed for a weekend date — shown in the runway, not the grid.
            </p>
          )}
        </div>
      </div>

      <p className="po-note">
        Dates and Street estimates from the company calendar, not from prices — an options chain can only
        say a date is being paid for, never which date it is. Pick a name to see what its chain has priced in.
      </p>
    </section>
  )
}
