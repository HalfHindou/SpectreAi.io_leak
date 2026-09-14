import { fmtClock, fmtUsd, fmtCount, whaleWord } from './cnm-map'

/**
 * cnm-static — the reduced-motion reading of the stage.
 *
 * Not a fallback and not an apology: the same replayed events, at their real
 * timestamps, newest first. Someone who has switched motion off gets the tape,
 * in words, at the same pace the canvas would have drawn it.
 *
 * Also the populated list behind degradation ladder step 5 (saveData / battery
 * under 15%), where the stage starts paused.
 */
export default function CnmStatic({ rows, pending, shimmer = false }) {
  const empty = !rows.length
  return (
    <section className="cnm-static" aria-label="Replayed events">
      <header className="cnm-static__head">
        <span className="cnm-static__eyebrow">Replayed events</span>
        <span className="cnm-static__n cnm-num">
          {empty && pending ? 'waiting' : `n=${fmtCount(rows.length)}`}
        </span>
      </header>

      <ol className="cnm-static__list">
        {empty && pending && [0, 1, 2].map(i => (
          <li key={`s${i}`} className={`cnm-static__row cnm-static__row--wait${shimmer ? ' animate-shimmer' : ''}`} aria-hidden="true">
            <span className="cnm-static__bar" style={{ width: '54px' }} />
            <span className="cnm-static__bar" style={{ width: '38px' }} />
            <span className="cnm-static__bar" style={{ width: '36px' }} />
            <span className="cnm-static__bar" style={{ width: '64px' }} />
            <span className="cnm-static__bar" style={{ width: '40%' }} />
          </li>
        ))}

        {rows.map(ev => (
          <li key={ev.id} className="cnm-static__row">
            <span className="cnm-static__t cnm-num">{fmtClock(ev.t)}</span>
            <span className="cnm-static__a">{ev.asset}</span>
            <span className={`cnm-static__s cnm-static__s--${ev.kind === 'liq' ? ev.side : ev.cls}`}>
              {ev.kind === 'liq' ? ev.side : whaleWord(ev.cls)}
            </span>
            <span className="cnm-static__v cnm-num">{fmtUsd(ev.usd)}</span>
            <span className="cnm-static__l">{ev.kind === 'liq' ? ev.exchange : ev.line}</span>
          </li>
        ))}
      </ol>

      {empty && !pending && (
        <p className="cnm-static__empty">
          Nothing above the floor has replayed since this page opened.
        </p>
      )}
    </section>
  )
}
