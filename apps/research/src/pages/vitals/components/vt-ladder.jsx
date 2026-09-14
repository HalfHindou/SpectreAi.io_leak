/**
 * vt-ladder.jsx — THE LADDER, the VITALS leaderboards.
 *
 * One board per metric, ranked server-side so the thresholds that keep a board
 * honest (a growth rank needs a real prior base; a take rate over 100% means
 * two adapters disagree, not a miracle) live next to the data rather than in
 * the view.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import VtSeg from './vt-seg'
import VtSpark from './vt-spark'
import VtLogo from './vt-logo'
import { byKind, usd, count, pct, toneOf } from './vt-format'

/** How many rows the Overview summary carries before it hands off to Boards. */
const TOP_N = 10

const BOARDS = [
  { id: 'fees', label: 'Fees', col: 'Fees, 30d', note: 'Total paid by users over 30 days.' },
  { id: 'revenue', label: 'Revenue', col: 'Revenue, 30d', note: 'The slice the protocol keeps, 30 days.' },
  { id: 'users', label: 'Users', col: 'Traders / day', note: 'Daily active traders, counted by us from raw fills.', firstHand: true },
  { id: 'growth', label: 'Growth', col: 'Fee change, 30d', note: 'Fee change vs the previous 30 days. Needs $100k in both windows.' },
  { id: 'perpVolume', label: 'Perp volume', col: 'Perp volume, 24h', note: 'Notional routed through the platform in a day.', firstHand: true },
  { id: 'userPnl', label: 'User PnL', col: 'Trader PnL, 24h', note: 'Net realised profit of the platform’s own traders in a day.', firstHand: true },
  { id: 'takeRate', label: 'Take rate', col: 'Take rate', note: 'Revenue as a share of fees. Needs $100k of 30d fees.' },
  { id: 'tvl', label: 'TVL', col: 'TVL', note: 'Value locked. Not shown for platforms where it is meaningless.' },
  { id: 'pf', label: 'P/F', col: 'P/F', note: 'Market cap over annualised fees, cheapest first.' },
]

/**
 * The header for the stacked row. Two lines, on the row's own grid and areas —
 * the ranked figure is on line one and the trend / change sit on line two, so a
 * single-line header would have labelled the wrong things.
 *
 * The trailing column is left UNLABELLED on purpose: `subFact` picks a different
 * unit per row (traders, revenue, fees, trades), so any one header word would be
 * wrong for some of the rows under it. Each cell prints its own unit instead.
 */
function LadderHead({ col, scaled }) {
  return (
    <div className="vt-thead vt-thead--stacked" aria-hidden="true">
      <span className="vt-thead__rank">#</span>
      <span className="vt-thead__name">Platform</span>
      <span className="vt-thead__meta">Sector</span>
      <span className="vt-thead__bar">{scaled ? 'vs #1' : ''}</span>
      <span className="vt-thead__value">{col}</span>
      <span className="vt-thead__spark">30d trend</span>
      <span className="vt-thead__stats">
        <span className="vt-thead__delta">Chg</span>
        <span className="vt-thead__sub" />
      </span>
    </div>
  )
}

/**
 * The trailing column carries a SECOND fact, never the one the board already
 * ranks by — a fees board that printed "$45.5m ... $45.5m fees" was spending a
 * column to say nothing.
 *
 * It also has to stay in the SAME lane as the ranked value. On the users board
 * the rank is our own count of traders routed through one venue; pairing that
 * with a shadow 30-day revenue that covers all of a platform's products reads
 * as one row about one thing when it is two rows about two.
 */
function subFact(row, metric, firstHandBoard) {
  if (firstHandBoard) {
    if (metric !== 'perpVolume' && row.perpVolume24h != null) return `${usd(row.perpVolume24h)} vol`
    if (metric !== 'users' && row.dau != null) return `${count(row.dau)} traders`
    if (row.trades != null) return `${count(row.trades)} trades`
    return '—'
  }
  if (row.dau != null) return `${count(row.dau)} traders`
  if (metric !== 'revenue' && row.revenue30d != null) return `${usd(row.revenue30d)} rev`
  if (metric !== 'fees' && row.fees30d != null) return `${usd(row.fees30d)} fees`
  if (row.feesAnn != null) return `${usd(row.feesAnn)} ann.`
  return '—'
}

function Row({ row, kind, index, metric, firstHandBoard, scale }) {
  const tone = toneOf(row.feeChg30d)
  // A ranked figure that can be negative — User PnL is the board where it
  // matters — printed in the same ink as a winning one. The delta column
  // carries the fee change, which on a first-hand board is often absent, so it
  // could not stand in. Only losses are tinted: everything else stays neutral
  // so the board does not turn into a wall of green.
  const valueTone = row.value < 0 ? ' vt-tone--down' : ''
  // Same reason for the trend line: with no fee change to read, `toneOf(null)`
  // is 'flat', which fell through to the up colour and drew a green sparkline
  // under a six-figure loss.
  const sparkTone = row.feeChg30d != null
    ? (tone === 'down' ? 'down' : 'up')
    : (row.value < 0 ? 'down' : 'up')
  // THE MAGNITUDE BAR. A ranked board is a picture of relative size and this one
  // was refusing to draw it: on a wide screen the row put "Tether" and "$479m"
  // at opposite ends of ~700px of nothing (founder: "sad design and lots of
  // empty space"), and the only way to learn that Tether earns two and a half
  // times Circle was to read two numbers and divide. The bar is that ratio, in
  // the space the row was wasting.
  const share = scale && Number.isFinite(row.value) ? Math.abs(row.value) / scale : null
  return (
    <li className="vt-row" style={{ '--vt-row-i': index }}>
      <Link to={`/vitals/${row.slug}`} className="vt-row__link">
        <span className="vt-row__rank">{row.rank}</span>
        <VtLogo logo={row.logo} slug={row.slug} name={row.name} />
        {/* Two lines, not one. On a wide screen a single row stretched the name
            column to 1fr and left ~1000px of dead space between a platform and
            its own numbers (founder: "organize columns in two rows too much
            empty space"). Identity sits on line one with the ranked figure it is
            ranked BY; the supporting detail sits under it. Same data, half the
            horizontal travel for the eye. */}
        <span className="vt-row__name">
          {row.name}
          {row.provenance === 'first_hand' ? (
            <span className="vt-chip vt-chip--own" title="Measured by Spectre from raw fills">own</span>
          ) : null}
          {/* The double-count flag describes the SHADOW fee attribution. On a
              first-hand board the ranked number is our own count of fills, which
              is not double counted by anything — showing it there would warn
              about a figure the row is not displaying. */}
          {row.doubleCounted && !firstHandBoard ? (
            <span className="vt-chip vt-chip--warn" title="Fees also counted by an underlying venue">double-counted</span>
          ) : null}
        </span>
        {share != null ? (
          <span className={`vt-row__bar${row.value < 0 ? ' is-down' : ''}`} aria-hidden="true">
            {/* Never fully invisible: a platform that earned 0.2% of the leader
                still earned something, and a 0px bar reads as missing data. */}
            <i style={{ width: `max(3px, ${(share * 100).toFixed(2)}%)` }} />
          </span>
        ) : null}
        <span className={`vt-row__value${valueTone}`}>{byKind(row.value, kind)}</span>
        <span className="vt-row__meta">
          {row.category}
          {row.chains?.length ? ` · ${row.chains.slice(0, 2).join(', ')}${row.chains.length > 2 ? ` +${row.chains.length - 2}` : ''}` : ''}
        </span>
        {/* The trend sits in the SAME column as the bar above it, not in the
            numbers cluster on the right. Two long horizontal marks starting at
            two different x positions read as two unrelated lanes; stacked on one
            axis they read as one block — magnitude, then direction. */}
        <VtSpark points={row.spark} tone={sparkTone} />
        <span className="vt-row__stats">
          <span className={`vt-row__delta vt-tone--${tone}`}>{pct(row.feeChg30d)}</span>
          <span className="vt-row__sub">{subFact(row, metric, firstHandBoard)}</span>
        </span>
      </Link>
    </li>
  )
}

/**
 * `metric` / `onMetric` are optional. The page passes them so the board you
 * picked on Overview is the board you land on in Boards — with the state held
 * per instance, picking "User PnL" and then following through to the full board
 * dropped you back on Fees.
 */
export default function VtLadder({ ladders, loading, compact = false, metric, onMetric, onSeeAll }) {
  const available = useMemo(
    () => BOARDS.filter((b) => ladders?.[b.id]?.rows?.length),
    [ladders]
  )
  const [ownActive, setOwnActive] = useState('fees')
  const active = metric ?? ownActive
  const setActive = onMetric ?? setOwnActive

  const board = ladders?.[active]
  const meta = BOARDS.find((b) => b.id === active)
  const shown = available.length ? available : BOARDS.slice(0, 4)

  const rows = useMemo(() => {
    if (!board?.rows?.length) return null
    return compact ? board.rows.slice(0, TOP_N) : board.rows
  }, [board, compact])

  /**
   * What one full bar is worth. Every board here except P/F ranks by magnitude
   * descending, so the leader IS the maximum and the bar reads as "share of #1".
   *
   * P/F ranks CHEAPEST first, where the winner holds the smallest number — a bar
   * scaled to the maximum would give the top row the shortest bar and the bottom
   * row the longest, which looks like a board sorted backwards. That board keeps
   * its numbers and skips the bar rather than drawing a misleading one, which is
   * what `scale === null` means downstream.
   */
  const scale = useMemo(() => {
    const vals = (rows || []).map((r) => Number(r.value)).filter(Number.isFinite)
    if (vals.length < 2) return null
    const max = Math.max(...vals.map(Math.abs))
    if (!(max > 0)) return null
    // Descending only: the first row has to be the biggest thing on the board.
    return Math.abs(vals[0]) >= max - 1e-9 ? max : null
  }, [rows])

  return (
    <section className="vt-section vt-ladder" id="ladder">
      <header className="vt-section__head">
        <div>
          <span className="vt-eyebrow">The ladder</span>
          <h2>Ranked by what a platform actually does</h2>
        </div>
      </header>

      <VtSeg
        label="Leaderboard metric"
        value={active}
        onChange={setActive}
        items={shown.map((b) => ({
          id: b.id,
          label: b.label,
          dot: b.firstHand,
          disabled: !ladders?.[b.id]?.rows?.length && !loading,
          title: b.note,
        }))}
      />

      {meta ? <p className="vt-note">{meta.note}</p> : null}
      {meta?.firstHand && board?.rows?.[0]?.scope?.partial ? (
        <div className="vt-scopewarn" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="vt-chip vt-chip--scope">{board.rows[0].scope.label}</span>
          <span>{board.rows[0].scope.note}</span>
        </div>
      ) : null}

      {loading && !board ? (
        <ul className="vt-rows vt-rows--skeleton" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <li key={i} className="vt-row vt-row--skeleton" />)}
        </ul>
      ) : board?.rows?.length ? (
        <>
          <LadderHead col={meta?.col || 'Value'} scaled={scale != null} />
          <ol className={`vt-rows vt-rows--stacked${scale != null ? ' vt-rows--barred' : ''}`}>
            {rows.map((row, i) => (
              <Row key={row.slug} row={row} kind={board.kind} index={i}
                metric={active} firstHandBoard={!!meta?.firstHand} scale={scale} />
            ))}
          </ol>
          {/* Overview showed ten of eighteen hundred and then said so in a dim
              footnote with nothing to click. The count is the reason to go on,
              so it sits next to the control that takes you there. */}
          <div className="vt-ladder__foot">
            <p className="vt-note vt-note--dim">
              {compact && board.rows.length > TOP_N
                ? `Top ${TOP_N} of ${board.total.toLocaleString('en-US')} platforms on this board.`
                : `${board.total.toLocaleString('en-US')} platforms qualified for this board.`}
            </p>
            {compact && onSeeAll && board.rows.length > TOP_N ? (
              <button type="button" className="vt-pill vt-pill--sm" onClick={onSeeAll}>
                See the full board
                <span aria-hidden="true">&rarr;</span>
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="vt-empty">Nothing qualifies for this board yet.</p>
      )}
    </section>
  )
}
