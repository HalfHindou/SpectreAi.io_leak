/**
 * ArnLedger — four census numbers about the whole roster.
 *
 * DELIBERATELY ABSENT: a fleet return, a fleet P&L, a blended equity curve.
 * Summing twelve books into one performance number would invent a fund that
 * nobody runs and that nobody could have bought. What is here instead is a
 * census — how much is on the table, how many trades are settled, how often
 * they settled green, and how deep the deepest hole got — with the book that
 * owns the last one named.
 */
import { fmtDd, fmtMoney, fmtRate } from './arn-format'

export default function ArnLedger({ totals }) {
  const worst = totals.worstDd

  return (
    <div className="arn-ledger" role="group" aria-label="Roster ledger">
      <div className="arn-lcell">
        <div className="arn-lcell__v arn-num">{fmtMoney(totals.equity)}</div>
        <div className="arn-lcell__k">
          equity across {totals.books} books
          {totals.equityFallback ? <span className="arn-dagger">†</span> : null}
        </div>
      </div>

      <div className="arn-lcell arn-lcell--closed">
        <div className="arn-lcell__v arn-num">{totals.closed.toLocaleString('en-US')}</div>
        <div className="arn-lcell__k">closed trades</div>
      </div>

      <div className="arn-lcell">
        <div className="arn-lcell__v arn-num">
          {totals.winRatePct != null ? fmtRate(totals.winRatePct, totals.closed) : '—'}
        </div>
        <div className="arn-lcell__k">
          closed green <span className="arn-num">n={totals.closed.toLocaleString('en-US')}</span>
        </div>
      </div>

      <div className="arn-lcell">
        <div className="arn-lcell__v arn-lcell__v--loud arn-num">
          {worst ? fmtDd(worst.maxDd) : '—'}
        </div>
        <div className="arn-lcell__k">
          deepest drawdown{worst ? <> · {worst.name}</> : null}
        </div>
      </div>
    </div>
  )
}
