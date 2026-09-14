/**
 * Derivations for the Yearly Analysis board.
 *
 * Everything here is pure and runs on the month array `/api/seasonality`
 * returns, so switching a toggle recomputes instantly instead of refetching.
 *
 * A month row from the API:
 *   { y, m, o, h, l, c, r, src, hl, partial, dd, up, vol }
 * `r` is the close-to-close return; `partial` marks the month still running,
 * which is excluded from every average, win rate and backtest below.
 */

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* Bitcoin halvings — the clock crypto actually runs on. A calendar year is an
   accounting artefact; the cycle is what repeats. */
export const HALVINGS = [
  { date: '2012-11-28', y: 2012, m: 11, label: '2012' },
  { date: '2016-07-09', y: 2016, m: 7, label: '2016' },
  { date: '2020-05-11', y: 2020, m: 5, label: '2020' },
  { date: '2024-04-19', y: 2024, m: 4, label: '2024' },
  { date: '2028-04-01', y: 2028, m: 4, label: '2028 (est)' },
]

/* US presidential cycle — the equivalent four-year clock for equities and macro. */
export const ELECTION_ANCHORS = [1984, 1988, 1992, 1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024, 2028]
export const ELECTION_YEAR_LABELS = ['Election', 'Post-election', 'Midterm', 'Pre-election']

/* ── basics ─────────────────────────────────────────────────────────────── */
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
export const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}
export const quantile = (a, q) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** Share of `arr` at or below `v`, 0..1. Null for an empty sample. */
export const percentileOf = (v, arr) => {
  if (!arr.length || !Number.isFinite(v)) return null
  return arr.filter((x) => x <= v).length / arr.length
}

/* ── the calendar grid ──────────────────────────────────────────────────── */
export function buildMatrix(months) {
  const byYear = new Map()
  for (const mo of months) {
    if (!byYear.has(mo.y)) byYear.set(mo.y, new Array(12).fill(null))
    byYear.get(mo.y)[mo.m - 1] = mo
  }
  const years = [...byYear.keys()].sort((a, b) => b - a)
  return years.map((y) => {
    const cells = byYear.get(y)
    const done = cells.filter((c) => c && Number.isFinite(c.r))
    const g = done.reduce((acc, c) => acc * (1 + c.r), 1)
    return {
      y,
      cells,
      total: done.length ? g - 1 : null,
      count: done.length,
      partial: done.length < 12,
      running: cells.some((c) => c?.partial),
    }
  })
}

/**
 * Same grid re-indexed onto the four-year clock: rows are cycles, columns are
 * months elapsed since the anchor. Reading BTC by calendar year compares month
 * 7 of a bull run against month 31 of a bear; this compares like with like.
 */
export function buildCycleMatrix(months, market) {
  const anchors = market === 'crypto'
    ? HALVINGS.map((h) => ({ key: h.label, y: h.y, m: h.m }))
    : ELECTION_ANCHORS.map((y) => ({ key: String(y), y, m: 1 }))
  const idx = (y, m) => y * 12 + (m - 1)
  const rows = []
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const start = idx(a.y, a.m)
    const end = anchors[i + 1] ? idx(anchors[i + 1].y, anchors[i + 1].m) : start + 48
    const cells = new Array(Math.min(48, end - start)).fill(null)
    for (const mo of months) {
      const off = idx(mo.y, mo.m) - start
      if (off >= 0 && off < cells.length) cells[off] = mo
    }
    const done = cells.filter((c) => c && Number.isFinite(c.r))
    if (!done.length) continue
    const g = done.reduce((acc, c) => acc * (1 + c.r), 1)
    rows.push({
      key: a.key,
      anchor: a,
      cells,
      total: g - 1,
      count: done.length,
      // The cycle still running — everything after `count` is unwritten.
      running: cells.some((c) => c?.partial),
    })
  }
  return rows.reverse()
}

/** Where the running cycle sits right now, so the grid can mark "you are here". */
export function cyclePosition(market, now = new Date()) {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const anchors = market === 'crypto'
    ? HALVINGS.map((h) => ({ key: h.label, y: h.y, m: h.m }))
    : ELECTION_ANCHORS.map((yy) => ({ key: String(yy), y: yy, m: 1 }))
  const idx = (yy, mm) => yy * 12 + (mm - 1)
  let cur = null
  for (const a of anchors) {
    if (idx(a.y, a.m) <= idx(y, m)) cur = a
  }
  if (!cur) return null
  return { key: cur.key, offset: idx(y, m) - idx(cur.y, cur.m) }
}

/* ── streaks ────────────────────────────────────────────────────────────── */
export function longestStreaks(months) {
  let best = null; let worst = null
  let run = null
  for (const mo of months) {
    if (!Number.isFinite(mo.r) || mo.partial) { run = null; continue }
    const dir = mo.r >= 0 ? 1 : -1
    if (!run || run.dir !== dir) run = { dir, from: mo, to: mo, n: 1, g: 1 + mo.r }
    else { run.to = mo; run.n += 1; run.g *= 1 + mo.r }
    if (dir > 0 && (!best || run.n > best.n)) best = { ...run }
    if (dir < 0 && (!worst || run.n > worst.n)) worst = { ...run }
  }
  return { best, worst }
}

/* ── the seasonal-edge backtest ─────────────────────────────────────────── */
/**
 * Hold the asset only in `picked` calendar months, flat (0% return) otherwise,
 * against buy-and-hold on the same series. No leverage, no fees, no shorting.
 *
 * This is deliberately in-sample: the months are picked from the same history
 * it is scored on, so the edge it prints is an upper bound, not a forecast.
 * The UI says so out loud.
 */
export function seasonalEdge(months, picked) {
  const set = picked instanceof Set ? picked : new Set(picked)
  const rows = months.filter((mo) => Number.isFinite(mo.r) && !mo.partial)
  if (rows.length < 12) return null

  let stratEq = 1; let holdEq = 1
  let stratPeak = 1; let holdPeak = 1
  let stratDD = 0; let holdDD = 0
  const curve = []
  let wins = 0; let taken = 0

  for (const mo of rows) {
    const inMarket = set.has(mo.m)
    if (inMarket) {
      stratEq *= 1 + mo.r
      taken += 1
      if (mo.r > 0) wins += 1
    }
    holdEq *= 1 + mo.r
    stratPeak = Math.max(stratPeak, stratEq)
    holdPeak = Math.max(holdPeak, holdEq)
    stratDD = Math.min(stratDD, stratEq / stratPeak - 1)
    holdDD = Math.min(holdDD, holdEq / holdPeak - 1)
    curve.push({ y: mo.y, m: mo.m, s: stratEq, h: holdEq, inMarket })
  }

  const years = rows.length / 12
  const cagr = (eq) => (years > 0 ? Math.pow(eq, 1 / years) - 1 : null)
  return {
    curve,
    years,
    exposure: taken / rows.length,
    strategy: { eq: stratEq, cagr: cagr(stratEq), dd: stratDD, hit: taken ? wins / taken : null },
    hold: { eq: holdEq, cagr: cagr(holdEq), dd: holdDD },
  }
}

/** Months ranked by the statistic the board is currently reading. */
export function rankMonths(profile, stat = 'med') {
  return [...profile]
    .filter((p) => p.n > 0 && Number.isFinite(p[stat]))
    .sort((a, b) => b[stat] - a[stat])
}

/**
 * A behaviour line for a month, derived rather than folklore. The card that
 * inspired this board asserted "April — historically very strong" with no
 * sample size and no source; every phrase below is a statement about the
 * numbers on screen.
 */
export function behaviourOf(p, allProfile) {
  if (!p || !p.n) return { tone: 'flat', text: 'No history' }
  const spreads = allProfile.filter((x) => Number.isFinite(x.sd)).map((x) => x.sd)
  const wideBar = quantile(spreads, 0.75)
  const wide = Number.isFinite(p.sd) && Number.isFinite(wideBar) && p.sd >= wideBar
  const decided = p.win >= 0.7 || p.win <= 0.3

  if (p.win >= 0.7 && p.med > 0.01) return { tone: 'bull', text: wide ? 'Reliably up, violently so' : 'The most dependable month' }
  if (p.win <= 0.3 && p.med < -0.01) return { tone: 'bear', text: wide ? 'Usually down and unstable' : 'Consistently soft' }
  if (p.med > 0.01 && !decided) return { tone: 'bull', text: 'Positive lean, no promise' }
  if (p.med < -0.01 && !decided) return { tone: 'bear', text: 'Negative lean, no promise' }
  if (wide) return { tone: 'flat', text: 'A coin flip with fat tails' }
  return { tone: 'flat', text: 'Directionless — chop' }
}

/**
 * Mean vs median disagreeing means one year is carrying the month. Worth
 * naming: BTC's November average is dragged by a single +453% print in 2013.
 */
export function skewWarning(p) {
  if (!p || p.n < 4 || !Number.isFinite(p.avg) || !Number.isFinite(p.med)) return null
  const gap = Math.abs(p.avg - p.med)
  if (gap < 0.05) return null
  const outlier = Math.abs(p.best?.r ?? 0) > Math.abs(p.worst?.r ?? 0) ? p.best : p.worst
  if (!outlier) return null
  return { gap, year: outlier.y, r: outlier.r }
}

/* ── formatting ─────────────────────────────────────────────────────────── */
export const pct = (v, dp = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%` : '—')
export const pctBare = (v, dp = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—')

export function priceLabel(v) {
  if (!Number.isFinite(v)) return '—'
  // No k-suffix: a column that reads $94,172 / $102k / $87,648 is harder to
  // scan than one that reads all three the same way.
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (v >= 1) return `$${v.toFixed(2)}`
  if (v >= 0.01) return `$${v.toFixed(4)}`
  return `$${v.toPrecision(2)}`
}

/**
 * Diverging red→green fill. The scale is anchored on a robust spread (the 85th
 * percentile of |return|) rather than the max, so one 453% month doesn't wash
 * every other cell to the same pale tint.
 */
export function makeScale(values, day = false) {
  const abs = values.filter(Number.isFinite).map(Math.abs)
  const anchor = Math.max(0.02, quantile(abs, 0.85) ?? 0.1)
  // The same alpha ramp reads as a strong tint on near-black and as barely
  // there on white, so light mode gets its own floor, ceiling and ink.
  // Light mode tops out lower on purpose: past ~0.6 the fill saturates far
  // enough that even #7f1d1d ink loses contrast against it, and the strongest
  // months — the ones you most want to read — go muddiest first.
  const a0 = day ? 0.16 : 0.08
  const a1 = day ? 0.56 : 0.5
  return (v) => {
    if (!Number.isFinite(v)) return { bg: 'transparent', fg: 'var(--text-disabled)', t: 0 }
    const t = Math.min(1, Math.abs(v) / anchor)
    const eased = Math.pow(t, 0.72)
    const up = v >= 0
    const rgb = up ? '16, 185, 129' : '239, 68, 68'
    const strong = eased > 0.55
    return {
      bg: `rgba(${rgb}, ${(a0 + eased * a1).toFixed(3)})`,
      ring: `rgba(${rgb}, ${(0.12 + eased * 0.35).toFixed(3)})`,
      fg: day
        ? (strong ? (up ? '#064e3b' : '#7f1d1d') : (up ? '#047857' : '#b91c1c'))
        : (strong ? (up ? '#d1fae5' : '#fee2e2') : (up ? 'var(--bull-bright)' : 'var(--bear-bright)')),
      t: eased,
      up,
    }
  }
}
