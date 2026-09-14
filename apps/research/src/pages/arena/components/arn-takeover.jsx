/**
 * ArnTakeover — one book, in place.
 *
 * Not a modal. It pushes ?trader= on the same route, so the back button works,
 * the URL is shareable, and PageShell keys its Suspense by pathname — a search
 * param does not remount the page underneath. Esc closes it and the roster's
 * scroll offset is restored exactly, because losing your place in a twelve-row
 * board to read one row is a tax the reader did not agree to pay.
 *
 * REALISED AND UNREALISED P&L ARE NEVER SUMMED. They are two different claims —
 * one is settled, the other is a mark — and adding them produced a headline
 * number nine times the truth the last time this data was shown that way.
 */
import { useEffect, useMemo, useRef } from 'react'
import ArnCurve from './arn-curve'
import ArnDeaths from './arn-deaths'
import { useTraderDetail } from './use-trader-equity'
import { familyDelta } from './arn-lineage'
import {
  assetLabel, fmtDd, fmtMoney, fmtPct, fmtRate, fmtRdd, fmtSize, fmtSpan, fmtStamp, reasonLabel,
} from './arn-format'

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

function Stat({ k, v, tone, sub }) {
  return (
    <div className="arn-stat">
      <div className={`arn-stat__v arn-num${tone ? ` is-${tone}` : ''}`}>{v}</div>
      <div className="arn-stat__k">{k}{sub ? <span className="arn-stat__sub">{sub}</span> : null}</div>
    </div>
  )
}

export default function ArnTakeover({ row, family, onClose }) {
  const { equity, detail, loading, failed } = useTraderDetail(row.id)
  const closeRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const t = detail?.trader || null
  const peak = num(t?.peak_balance)
  const positions = Array.isArray(t?.current_positions) ? t.current_positions : []
  const config = t?.config && typeof t.config === 'object' ? t.config : null

  const trades = useMemo(() => {
    const list = Array.isArray(detail?.recent_trades) ? detail.recent_trades : []
    return list
      .filter((x) => x.closed_at)
      .map((x) => ({
        key: String(x.id ?? `${x.asset}-${x.closed_at}`),
        ts: x.closed_at,
        asset: x.asset,
        side: String(x.side || ''),
        sizeUsd: num(x.size_usd),
        pnl: num(x.pnl),
        pnlPct: num(x.pnl_pct),
        reason: x.close_reason || null,
        reasoning: x.reasoning || null,
      }))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
  }, [detail])

  const deaths = useMemo(() => {
    const d = {}
    for (const x of trades) if (x.reason) d[x.reason] = (d[x.reason] || 0) + 1
    return d
  }, [trades])
  const gradedN = trades.filter((x) => x.reason).length

  const windowMs = equity?.from && equity?.to
    ? new Date(equity.to).getTime() - new Date(equity.from).getTime()
    : null

  const curveLabel = equity
    ? `measured ${fmtStamp(equity.from)} → ${fmtStamp(equity.to)} · ${equity.n} snapshots · ${fmtSpan(windowMs)} of a rolling window`
    : null

  const lineage = family && family.members.length > 1 ? family : null

  return (
    <div className="arn-takeover">
      <button type="button" className="arn-back" onClick={onClose} ref={closeRef}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
        <span>All books</span>
      </button>

      <header className="arn-to__head">
        <div className="arn-to__id">
          <h2 className="arn-to__name">{row.name}</h2>
          {row.generation ? <span className="arn-chip arn-chip--gen">{row.generation.genLabel}</span> : null}
          {!row.active ? <span className="arn-chip arn-chip--retired">RETIRED</span> : null}
        </div>
        <div className="arn-to__rank arn-num">
          {row.rdd != null ? (
            <><span className="arn-to__rdd">{fmtRdd(row.rdd)}</span><span className="arn-to__rlabel">R:DD</span></>
          ) : (
            <span className="arn-none">unranked · {row.closed}/15 closed</span>
          )}
        </div>
      </header>

      <p className="arn-to__sub arn-meta">
        {row.strategy || 'unpublished strategy'}
        <span className="arn-sep">·</span>
        started {fmtStamp(row.startedAt)}
        <span className="arn-sep">·</span>
        {/* One flex item: a bare trailing text node loses its leading space
            inside a flex parent — this rendered as "76closed". */}
        <span><span className="arn-num">{row.closed}</span> closed</span>
      </p>

      <div className="arn-statband">
        <Stat k="equity" v={fmtMoney(row.equity)} />
        <Stat
          k="return"
          v={row.floorCleared ? fmtPct(row.returnPct) : '—'}
          tone={row.floorCleared ? (row.returnPct > 0 ? 'up' : row.returnPct < 0 ? 'down' : null) : null}
        />
        <Stat k="drawdown now" v={row.currentDd ? fmtDd(row.currentDd) : '—'} />
        <Stat k="deepest drawdown" v={row.maxDd ? fmtDd(row.maxDd) : '—'} tone="loud" />
        <Stat
          k="win rate"
          v={row.winRatePct != null ? fmtRate(row.winRatePct, row.closed) : '—'}
          sub={` n=${row.closed}`}
        />
        <Stat k="peak balance" v={peak != null ? fmtMoney(peak) : '—'} />
        <Stat k="open positions" v={String(row.openPositions)} />
      </div>

      <div className="arn-pnlsplit">
        <div className="arn-pnlsplit__cell">
          <span className="arn-pnlsplit__k">realised</span>
          <span className={`arn-pnlsplit__v arn-num${row.pnlRealized > 0 ? ' is-up' : row.pnlRealized < 0 ? ' is-down' : ''}`}>
            {row.pnlRealized != null ? fmtMoney(row.pnlRealized) : '—'}
          </span>
        </div>
        <div className="arn-pnlsplit__cell">
          <span className="arn-pnlsplit__k">unrealised</span>
          <span className={`arn-pnlsplit__v arn-num${row.pnlUnrealized > 0 ? ' is-up' : row.pnlUnrealized < 0 ? ' is-down' : ''}`}>
            {row.pnlUnrealized != null ? fmtMoney(row.pnlUnrealized) : '—'}
          </span>
        </div>
        <p className="arn-pnlsplit__note">
          Settled and marked are kept apart. Added together they would read as one number that
          nobody has banked.
        </p>
      </div>

      {/* ── the curve ─────────────────────────────────────────────── */}
      <section className="arn-to__sec">
        <header className="arn-sechead">
          <span className="arn-eyebrow">EQUITY</span>
          {equity ? <span className="arn-meta arn-num">{equity.n} snapshots</span> : null}
        </header>
        {loading ? (
          <div className="arn-sk animate-shimmer" style={{ height: 340 }} />
        ) : !row.id ? (
          <p className="arn-empty-line">
            {row.name} is not on the leaderboard, so no equity snapshots are published for it.
            Its balances are the only record.
          </p>
        ) : equity && equity.n >= 3 ? (
          <ArnCurve series={equity} starting={row.starting} label={curveLabel} />
        ) : equity ? (
          <p className="arn-empty-line">
            Only {equity.n} {equity.n === 1 ? 'snapshot' : 'snapshots'} on record — too short to chart.
          </p>
        ) : (
          <p className="arn-empty-line">Equity snapshots did not answer. The board above is unaffected.</p>
        )}
      </section>

      {/* ── open positions ────────────────────────────────────────── */}
      <section className="arn-to__sec">
        <header className="arn-sechead">
          <span className="arn-eyebrow">OPEN POSITIONS</span>
          <span className="arn-meta arn-num">{row.openPositions} counted</span>
        </header>
        {positions.length > 0 ? (
          <ul className="arn-pos">
            {positions.map((p, i) => (
              <li className="arn-pos__row" key={`${p.asset || p.symbol || i}-${i}`}>
                <span className="arn-pos__asset">{assetLabel(p.asset || p.symbol)}</span>
                <span className={`arn-tape__side${String(p.side) === 'short' ? ' is-short' : ''}`}>
                  {String(p.side || '').toUpperCase() || '—'}
                </span>
                <span className="arn-num">{fmtSize(num(p.size_usd))}</span>
                <span className="arn-num arn-pos__entry">
                  {num(p.entry_price) != null ? `entry ${num(p.entry_price)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : row.openPositions > 0 ? (
          <p className="arn-empty-line">
            {row.openPositions} open {row.openPositions === 1 ? 'position is' : 'positions are'} counted
            on both lanes, but the book publishes no rows for them. Nothing is shown rather than a guess.
          </p>
        ) : (
          <p className="arn-empty-line">No open positions.</p>
        )}
      </section>

      {/* ── this book's tape ──────────────────────────────────────── */}
      <section className="arn-to__sec">
        <header className="arn-sechead">
          <span className="arn-eyebrow">THE TAPE</span>
          <span className="arn-meta arn-num">{trades.length} published closes</span>
        </header>
        {trades.length ? (
          <ul className="arn-tape arn-tape--wide">
            {trades.slice(0, 12).map((x) => (
              <li className="arn-tape__row" key={x.key}>
                <span className="arn-tape__t arn-num">{fmtStamp(x.ts).slice(0, 6)}</span>
                <span className="arn-tape__asset" title={x.asset}>{assetLabel(x.asset)}</span>
                <span className={`arn-tape__side${x.side === 'short' ? ' is-short' : ''}`}>
                  {x.side.toUpperCase()}
                </span>
                <span className="arn-tape__size arn-num">{fmtSize(x.sizeUsd)}</span>
                <span className={`arn-tape__pnl arn-num${x.pnlPct > 0 ? ' is-up' : x.pnlPct < 0 ? ' is-down' : ''}`}>
                  {fmtPct(x.pnlPct)}
                </span>
                <span className="arn-tape__reason">{x.reason ? reasonLabel(x.reason) : 'OPEN'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="arn-empty-line">
            {failed ? 'The book detail did not answer.' : 'No closes are published for this book.'}
          </p>
        )}
      </section>

      {/* ── how it dies ───────────────────────────────────────────── */}
      {gradedN > 0 ? (
        <section className="arn-to__sec arn-to__sec--deaths">
          <ArnDeaths deaths={deaths} n={gradedN} />
        </section>
      ) : null}

      {/* ── lineage ───────────────────────────────────────────────── */}
      {lineage ? (
        <section className="arn-to__sec">
          <header className="arn-sechead">
            <span className="arn-eyebrow">LINEAGE</span>
            <span className="arn-meta">{lineage.members.length} generations</span>
          </header>
          <p className="arn-read">{familyDelta(lineage.members)}</p>
          <div className="arn-lineage">
            {lineage.members.map((m) => (
              <div className="arn-lineage__col" key={m.name} data-self={m.name === row.name ? 'true' : 'false'}>
                <div className="arn-lineage__name">
                  {m.generation.genLabel}
                  <span className="arn-meta"> {m.name}</span>
                </div>
                <dl className="arn-lineage__stats">
                  <div><dt>return</dt><dd className="arn-num">{m.floorCleared ? fmtPct(m.returnPct) : '—'}</dd></div>
                  <div><dt>deepest dd</dt><dd className="arn-num">{fmtDd(m.maxDd)}</dd></div>
                  <div><dt>R:DD</dt><dd className="arn-num">{m.rdd != null ? fmtRdd(m.rdd) : '—'}</dd></div>
                  <div><dt>win rate</dt><dd className="arn-num">{m.winRatePct != null ? fmtRate(m.winRatePct, m.closed) : '—'} <span className="arn-meta">n={m.closed}</span></dd></div>
                </dl>
              </div>
            ))}
          </div>
          {lineage.diff?.length ? (
            <p className="arn-foot-note">
              Changed: {lineage.diff.map((d) => `${d.key} ${d.from} → ${d.to}`).join(', ')}.
              Everything else inherited.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── doctrine ──────────────────────────────────────────────── */}
      <section className="arn-to__sec">
        <header className="arn-sechead">
          <span className="arn-eyebrow">DOCTRINE</span>
          <span className="arn-meta">as published</span>
        </header>
        {config ? (
          <dl className="arn-doctrine">
            {Object.entries(config)
              .filter(([, v]) => typeof v !== 'object')
              .map(([k, v]) => (
                <div className="arn-doctrine__row" key={k} data-wide={typeof v === 'string' && v.length > 24 ? 'true' : 'false'}>
                  <dt>{k.replace(/_/g, ' ')}</dt>
                  <dd className={typeof v === 'number' ? 'arn-num' : ''}>{String(v)}</dd>
                </div>
              ))}
          </dl>
        ) : loading ? (
          <div className="arn-sk animate-shimmer" style={{ height: 96 }} />
        ) : (
          <p className="arn-empty-line">No published config.</p>
        )}
      </section>
    </div>
  )
}
