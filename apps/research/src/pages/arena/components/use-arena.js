/**
 * useArena — the roster, merged.
 *
 * TWO LANES, ONE BOOK LIST.
 *   /v1/brain/paper                  the engine's own roster. AUTHORITATIVE for
 *                                    `active`, and the only lane that carries
 *                                    the retired books at all.
 *   /v1/paper-trading/leaderboard    ids, published return, win rate, drawdown,
 *                                    daily/weekly pnl. Ranks only what it holds.
 *
 * They are merged BY NAME, because the roster lane publishes no id. A book that
 * appears in the roster and not on the leaderboard has NO CURVE AND NO RANK YET
 * — it has not gone missing. That distinction is the whole reason both lanes are
 * read instead of one.
 *
 * FAILURE POLICY. A failed poll never wipes a good payload. Losing the
 * leaderboard degrades the page (no rank, no curve, no daily/weekly columns) but
 * does not empty it; losing both is the only state that has nothing to show.
 *
 * Paper-trading numbers arrive as STRINGS. Everything is Number()ed here so no
 * downstream cell has to remember.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { brainGet } from '@/pages/brain/components/brain-fetch'
import { parseGeneration } from './arn-lineage'
import { SAMPLE_FLOOR } from './arn-format'

const PAPER_URL = '/data-api/v1/brain/paper'
const BOARD_URL = '/data-api/v1/paper-trading/leaderboard'

const POLL_MS = 60_000
const STALE_MS = 150_000        // one missed poll plus slack
const NEW_MS = 30 * 60_000      // how long a book wears the NEW chip

export { SAMPLE_FLOOR }

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

/**
 * The merge itself, as a pure function — the hook only owns polling and the
 * failure policy. Everything the board renders is derived here, so the whole
 * derivation can be checked against a saved payload without a browser.
 *
 * `seen` is a name → first-seen-at map owned by the caller; `primed` suppresses
 * the NEW chip on the very first payload, when every book is new by definition.
 */
export function mergeArena(paper, board, { seen = new Map(), primed = true, now = Date.now() } = {}) {

    const traders = paper?.traders
    if (!Array.isArray(traders) || !traders.length) return null

    const byName = new Map()
    for (const r of board || []) if (r?.name) byName.set(String(r.name), r)

    const rows = traders.map((t) => {
      const name = String(t.name || '')
      const lb = byName.get(name) || null

      const starting = num(t.starting_balance) ?? 0
      const current = num(t.current_balance) ?? 0
      const wins = num(t.wins) ?? 0
      const losses = num(t.losses) ?? 0
      const closed = wins + losses
      const maxDd = Math.abs(num(lb?.max_drawdown_pct) ?? num(t.max_drawdown_pct) ?? 0)

      // The published return when the leaderboard holds one; otherwise derived
      // from the two balances the roster lane always carries.
      const returnPct = num(lb?.total_return_pct)
        ?? (starting > 0 ? ((current - starting) / starting) * 100 : null)

      const floorCleared = closed >= SAMPLE_FLOOR
      // Under one point of drawdown the ratio is division by noise, so the book
      // is unranked and says why rather than printing a spectacular number.
      const noRiskOnRecord = maxDd < 1
      const rdd = floorCleared && !noRiskOnRecord && Number.isFinite(returnPct)
        ? returnPct / maxDd
        : null

      const seenAt = seen.get(name)
      if (seenAt == null) seen.set(name, primed ? now : 0)

      return {
        name,
        id: lb?.id != null ? String(lb.id) : null,
        onBoard: !!lb,
        strategy: String(t.strategy || ''),
        active: t.active !== false,
        startedAt: t.started_at || null,
        lastSeenAt: lb?.last_snapshot_ts || null,

        starting,
        current,
        equity: num(lb?.total_equity) ?? current,
        equityFromBoard: num(lb?.total_equity) != null,

        wins,
        losses,
        closed,
        totalTrades: num(t.total_trades) ?? closed,
        openPositions: num(lb?.open_positions) ?? num(t.open_positions) ?? 0,

        returnPct,
        maxDd,
        currentDd: Math.abs(num(lb?.drawdown_pct) ?? 0),
        winRatePct: closed > 0 ? (num(lb?.win_rate_pct) ?? (wins / closed) * 100) : null,
        dailyPnlPct: num(lb?.daily_pnl_pct),
        weeklyPnlPct: num(lb?.weekly_pnl_pct),

        pnlRealized: num(t.pnl_realized),
        pnlUnrealized: num(t.pnl_unrealized),

        rdd,
        floorCleared,
        noRiskOnRecord,
        generation: parseGeneration(name),
        isNew: (seen.get(name) || 0) > 0
          && now - (seen.get(name) || 0) < NEW_MS,
      }
    })


    const tape = (paper.recent_trades || []).map((t) => ({
      ts: t.closed_at || t.ts || null,
      openedAt: t.ts || null,
      asset: t.asset || '',
      side: String(t.side || ''),
      sizeUsd: num(t.size_usd),
      pnl: num(t.pnl),
      pnlPct: num(t.pnl_pct),
      reason: t.close_reason || null,
      trader: t.trader || '',
      key: `${t.trader}|${t.asset}|${t.closed_at || t.ts}|${t.pnl}`,
    })).sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))

    const deaths = {}
    for (const t of tape) if (t.reason) deaths[t.reason] = (deaths[t.reason] || 0) + 1

    const live = rows.filter((r) => r.active)
    const retired = rows.filter((r) => !r.active)

    const closedSum = rows.reduce((a, r) => a + r.closed, 0)
    const winsSum = rows.reduce((a, r) => a + r.wins, 0)
    const equitySum = rows.reduce((a, r) => a + r.equity, 0)
    const startingSum = rows.reduce((a, r) => a + r.starting, 0)
    // Underwater is measured on EQUITY (cash + open marks), which is the same
    // number the return column and the waterline print. Measuring it on the cash
    // balance made the h1 disagree with the image directly under it.
    const underwater = rows.filter((r) => r.equity < r.starting)
    const worstDd = rows.reduce((w, r) => (r.maxDd > (w?.maxDd ?? -1) ? r : w), null)
    const worstBook = rows.reduce(
      (w, r) => (Number.isFinite(r.returnPct) && r.returnPct < (w?.returnPct ?? Infinity) ? r : w),
      null,
    )

    return {
      rows,
      live,
      retired,
      tape,
      deaths,
      tapeWindow: tape.length,
      totals: {
        books: rows.length,
        equity: equitySum,
        starting: startingSum,
        // Only the leaderboard publishes total_equity. Where it is missing we
        // fall back to the roster's cash balance, which excludes open positions.
        equityFallback: rows.some((r) => !r.equityFromBoard),
        closed: closedSum,
        wins: winsSum,
        winRatePct: closedSum > 0 ? (winsSum / closedSum) * 100 : null,
        worstDd,
        worstBook,
        underwater: underwater.length,
        offBoard: rows.filter((r) => !r.onBoard),
      },
    }
}

export function useArena() {
  const [paper, setPaper] = useState(null)
  const [board, setBoard] = useState(null)
  const [okAt, setOkAt] = useState(null)         // last time the roster lane answered
  const [boardOkAt, setBoardOkAt] = useState(null)
  const [tryAt, setTryAt] = useState(null)
  const [boardTried, setBoardTried] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloads, setReloads] = useState(0)

  const seenRef = useRef(new Map())              // name → first seen at (ms)
  const primedRef = useRef(false)                // suppress NEW chips on first paint
  const aliveRef = useRef(true)

  const load = useCallback(async () => {
    const [p, b] = await Promise.all([brainGet(PAPER_URL), brainGet(BOARD_URL)])
    if (!aliveRef.current) return
    const now = Date.now()
    setTryAt(now)
    setBoardTried(true)
    if (p && Array.isArray(p.traders)) { setPaper(p); setOkAt(now) }
    if (Array.isArray(b)) { setBoard(b); setBoardOkAt(now) }
    setLoading(false)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      aliveRef.current = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, reloads])

  const refresh = useCallback(() => { setReloads((n) => n + 1) }, [])

  const merged = useMemo(
    () => mergeArena(paper, board, { seen: seenRef.current, primed: primedRef.current }),
    [paper, board],
  )
  useEffect(() => { if (merged) primedRef.current = true }, [merged])

  const degraded = boardTried && board == null
  const stale = !!okAt && !!tryAt && tryAt - okAt > STALE_MS
  const boardStale = !!boardOkAt && !!tryAt && tryAt - boardOkAt > STALE_MS

  return {
    data: merged,
    loading: loading && !merged,
    empty: !!paper && !merged,
    error: !loading && !merged && !paper,
    degraded,
    stale: stale || (boardStale && !degraded),
    asOf: okAt,
    refresh,
  }
}

/** Sorting is a view decision, so it lives beside the hook rather than inside
 *  it — the merge does not care how the board is being read today. */
export function sortRows(rows, key) {
  const arr = [...rows]
  const lo = -Infinity
  if (key === 'return') arr.sort((a, b) => (b.returnPct ?? lo) - (a.returnPct ?? lo))
  else if (key === 'drawdown') arr.sort((a, b) => a.maxDd - b.maxDd)
  else if (key === 'newest') arr.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))
  else arr.sort((a, b) => (b.rdd ?? lo) - (a.rdd ?? lo))
  // A book below the sample floor never outranks one that cleared it, whatever
  // the sort — its numbers are not comparable yet.
  return arr.sort((a, b) => Number(b.floorCleared) - Number(a.floorCleared))
}

export const SORTS = [
  { id: 'skill', label: 'Skill per risk' },
  { id: 'return', label: 'Return' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'newest', label: 'Newest' },
]
