/**
 * liquidity-flow.js — estimate the dollar liquidity added/removed over a window
 * from market-cap + % change. Powers the LiquidityPulse "money in / money out"
 * headline above the heatmaps + bubbles.
 *
 * The math: a token now worth `cap` that moved `pct`% over the window was worth
 *   prev = cap / (1 + pct/100)
 * before the move, so the dollars added (or removed, if negative) are
 *   delta = cap - prev = cap * pct / (100 + pct)
 * Summed across the visible names this approximates the net capital that flowed
 * in or out — the same framing as "$286B added to the market today".
 */

/** Dollar delta implied by a `pct`% move on a current market cap. */
export function dollarFlow(marketCap, pct) {
  const cap = Number(marketCap)
  const p = Number(pct)
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(p)) return 0
  const denom = 100 + p
  if (denom <= 0) return 0 // guard the -100% collapse (prev cap → ∞)
  return (cap * p) / denom
}

/**
 * Sum the flow across cells and rank the biggest signed contributors.
 * @param {Array} cells   heatmap/bubble rows carrying `marketCap` + a change field
 * @param {Function} getPct  (cell) => % change for the active timeframe
 * @param {object} [opts]  { topN = 3 }
 * @returns {{ net, inflow, outflow, contributors, coverage }}
 */
export function computeLiquidityFlow(cells, getPct, { topN = 3 } = {}) {
  let net = 0
  let inflow = 0
  let outflow = 0
  const contributions = []

  for (const cell of cells || []) {
    const cap = Number(cell?.marketCap ?? cell?.market_cap) || 0
    if (cap <= 0) continue
    const pct = Number(
      getPct ? getPct(cell) : (cell?.change24h ?? cell?.change_24h)
    ) || 0
    const flow = dollarFlow(cap, pct)
    if (!flow) continue

    net += flow
    if (flow > 0) inflow += flow
    else outflow += flow

    contributions.push({
      symbol: (cell.symbol || '').toUpperCase(),
      name: cell.name || cell.symbol || '',
      logo: cell.logo || cell.image || cell.image_small || cell.imageSmall || null,
      pct,
      flow,
    })
  }

  contributions.sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow))

  return {
    net,
    inflow,
    outflow: Math.abs(outflow),
    contributors: contributions.slice(0, Math.max(0, topN)),
    coverage: contributions.length,
  }
}

/**
 * The same sum, but it also reports WHAT IT COULD NOT COUNT.
 *
 * 🪤 This exists because "money added today" was silently answering a different
 * question on every surface (measured 2026-08-07): the heatmap header said
 * $402.10B over 202 names, its own treemap two inches below said $391.14B
 * because it was handed ONE PAGE of the pagination, and LITE said $538.92B
 * because its board carried SPCX (+$239.66B on the day) and the PRO list did
 * not. Three numbers, all labelled "added to US stocks today".
 *
 * A total that quietly drops rows is the whole problem, so this returns the
 * drop alongside the sum and callers are expected to print it. Rows are skipped
 * for exactly one honest reason: no market cap. Index funds and commodity ETFs
 * report a cap of 0 by design - their AUM is the same shares already counted in
 * the constituents, so including them would double-count the market against
 * itself.
 *
 * @param {Array} rows  objects carrying `marketCap` and `change` (percent)
 * @returns {{ inflow, outflow, net, counted, skipped }}
 */
export function summariseFlow(rows) {
  let inflow = 0
  let outflow = 0
  let counted = 0
  let skipped = 0
  for (const r of rows || []) {
    const cap = Number(r?.marketCap)
    const pct = Number(r?.change)
    if (!(cap > 0) || !Number.isFinite(pct)) { skipped += 1; continue }
    const f = dollarFlow(cap, pct)
    counted += 1
    if (f >= 0) inflow += f
    else outflow += -f
  }
  return { inflow, outflow, net: inflow - outflow, counted, skipped }
}
