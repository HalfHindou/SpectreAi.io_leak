#!/usr/bin/env node
/**
 * Chart history-pager audit.
 *
 * Replays the canvas chart's scroll-back walk against a LIVE /api/bars and
 * audits the series it ends up with. Exists because this pager has produced the
 * same two bug families over and over (rz-chart-audit-plan steps 5-8, 16):
 *
 *   A. a guard declares live history exhausted and latches the wall
 *   B. a tier whose data describes a different instrument gets spliced in,
 *      and the index-plotted canvas renders the seam as a cliff
 *
 * Both are invisible in a unit test (they need the real upstreams) and painful
 * to catch by hand (they only appear several scroll-back pages deep).
 *
 * The GUARDS are imported from the real module - this file must never grow its
 * own copy of them, or it stops testing the thing that ships. The walk itself
 * is a replay of useChartData's loop; it cannot import that (React), so keep it
 * thin and keep the decisions in the imported helpers.
 *
 * NOT covered: the resolution-contamination guard (only reachable through a
 * timeframe-switch race, which has no meaning outside the component) and the
 * React wiring (unit tests + build cover that).
 *
 *   node scripts/chart-history-audit.mjs                       # pinned suite
 *   node scripts/chart-history-audit.mjs --case m87            # one case
 *   node scripts/chart-history-audit.mjs --sweep 25            # whatever is trending
 *   node scripts/chart-history-audit.mjs --base http://localhost:3009
 *   node scripts/chart-history-audit.mjs --json
 *
 * SWEEP exists so nobody has to hand-write a fixture per token. The pinned
 * suite freezes three shapes we understand; the sweep points the SAME nets at
 * whatever the market is doing right now.
 *
 * What a sweep does and does not see:
 *   head-only (default)  one request per token, the RECENT window only. Catches
 *                        corruption that is live now. It would NOT have found
 *                        the LEO case, whose bad bars sit in Jan 2023.
 *   --pages N            walks N scroll-back pages per token, so historical
 *                        eras are covered too - at N+1 billed queries a token.
 * COST: the codex tier bills per query. head-only x 25 tokens = 25 queries.
 */
import {
  DEEP_PAGE_COUNTBACK, historyWindow, eraCliffToleranceMs, seamContractBroken,
} from '../apps/research/src/hooks/codex/chart-history-window.js'

const args = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const BASE = arg('base', 'http://localhost:3001')
const AS_JSON = args.includes('--json')
const MAX_ROUNDS = parseInt(arg('rounds', '12'), 10)
const SWEEP_N = args.includes('--sweep') ? parseInt(arg('sweep', '20'), 10) || 20 : 0
const SWEEP_PAGES = parseInt(arg('pages', '0'), 10)
const SWEEP_RES = arg('res', '5')
// Self-test switch. A detector that has never gone red is not a detector, so
// `--no-seam-gate` replays the walk WITHOUT the shipped guard: the suite must
// fail on m87 when it is off and pass when it is on. Never a runtime option -
// it exists so CI can prove the harness still sees the bug it was built for.
const SEAM_GATE = !args.includes('--no-seam-gate')

// Hours the chart's head fetch covers, per resolution (mirrors the range
// presets' 4x fetch buffer closely enough for a pager audit).
const HEAD_HOURS = { '1': 24, '5': 96, '15': 300, '60': 1200, '240': 2880, '1D': 17520 }
const RES_SEC = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, '1D': 86400, '1W': 604800 }
const STRIDE_HOURS = { '1': 16, '5': 80, '15': 250, '30': 500, '60': 1000, '240': 4000, '720': 12000, '1D': 24000, '1W': 26280 }

const SUITE = [
  { name: 'm87-cross-tier', symbol: '0x80122c6a83c8202ea365233363d3f4837d13e888:1', networkId: 1, cgId: 'messier', res: '240',
    why: 'deep scroll-back falls past the DEX genesis into CoinGecko\'s close-only aggregate (26x cliff, 2026-08-26)' },
  { name: 'leo-sparse',     symbol: '0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3:1', networkId: 1, cgId: 'leo-token', res: '5',
    why: 'thin DEX tape: a bucket-sized window returns single digits of bars' },
  { name: 'btc-dense',      symbol: 'BTC', networkId: 1, cgId: 'bitcoin', binancePair: 'BTCUSDT', res: '5',
    why: 'dense CEX control - the pager must behave exactly as before here' },
]

async function fetchBars({ symbol, res, from, to, networkId, cgId, binancePair, countback }) {
  const q = new URLSearchParams({ symbol, resolution: res, from: String(from), to: String(to), networkId: String(networkId) })
  if (cgId) q.set('cgId', cgId)
  if (binancePair) q.set('binancePair', binancePair)
  if (countback) q.set('countback', String(countback))
  const t0 = Date.now()
  try {
    const r = await fetch(`${BASE}/api/bars?${q}`, { signal: AbortSignal.timeout(30000) })
    const j = await r.json()
    return {
      bars: (j?.bars || []).map(b => ({ time: b.t * 1000, open: +b.o, high: +b.h, low: +b.l, close: +b.c, volume: +b.v || 0 })),
      source: j?.source || r.headers.get('x-spectre-tier') || null,
      meta: j?.meta || null,
      failed: j?.failed === true,
      ms: Date.now() - t0,
    }
  } catch (e) {
    return { bars: [], source: null, meta: null, failed: true, ms: Date.now() - t0, error: String(e.message || e) }
  }
}

const medianIntervalMs = (bars) => {
  const d = []
  for (let i = 1; i < Math.min(bars.length, 21); i++) if (bars[i].time > bars[i - 1].time) d.push(bars[i].time - bars[i - 1].time)
  if (!d.length) return 0
  d.sort((a, b) => a - b)
  return d[Math.floor(d.length / 2)]
}

/** Replay of the scroll-back walk. Decisions come from the imported guards. */
async function walk(tc, maxRounds = MAX_ROUNDS) {
  const strideSec = Math.floor((STRIDE_HOURS[tc.res] || 1000) * 3600)
  const nowSec = Math.floor(Date.now() / 1000)
  const headHours = HEAD_HOURS[tc.res] || 1200
  const head = await fetchBars({ ...tc, from: nowSec - headHours * 3600, to: nowSec })
  if (!head.bars.length) return { fatal: `head window returned no bars (${head.error || 'empty'})` }

  let series = head.bars.slice()
  const rounds = [{ round: 'head', bars: head.bars.length, source: head.source, ms: head.ms }]
  const tiers = new Set([head.source].filter(Boolean))
  let stoppedBy = 'max-rounds'
  let emptyStreak = 0

  for (let k = 0; k < maxRounds; k++) {
    const toSec = Math.floor(series[0].time / 1000) - 1
    const { fromSec, windowSec } = historyWindow(toSec, { deep: true, strideSec })
    const page = await fetchBars({ ...tc, from: fromSec, to: toSec, countback: DEEP_PAGE_COUNTBACK })
    if (page.source) tiers.add(page.source)

    if (!page.bars.length) {
      // Steps 7-8: a BROKEN request is not evidence of genesis. Two genuinely
      // empty rounds are.
      if (page.failed) { stoppedBy = 'transient-failure'; rounds.push({ round: k, bars: 0, failed: true, ms: page.ms }); break }
      emptyStreak++
      rounds.push({ round: k, bars: 0, ms: page.ms })
      if (emptyStreak >= 2) { stoppedBy = 'genesis'; break }
      continue
    }
    emptyStreak = 0

    // --- the guards that ship ---
    if (SEAM_GATE && seamContractBroken({ batchBars: page.bars, batchMeta: page.meta, heldBars: series })) {
      rounds.push({ round: k, bars: page.bars.length, source: page.source, ms: page.ms, rejected: 'close-only' })
      stoppedBy = 'seam-contract'
      break
    }
    const gapMs = series[0].time - page.bars[page.bars.length - 1].time
    const tol = eraCliffToleranceMs(medianIntervalMs(series), windowSec)
    const iv = medianIntervalMs(series)
    if (iv && gapMs > tol) {
      rounds.push({ round: k, bars: page.bars.length, source: page.source, ms: page.ms, rejected: 'era-cliff' })
      stoppedBy = 'era-cliff'
      break
    }

    const seen = new Set(series.map(b => b.time))
    const fresh = page.bars.filter(b => !seen.has(b.time) && b.time < series[0].time)
    rounds.push({ round: k, bars: page.bars.length, added: fresh.length, source: page.source, ms: page.ms })
    if (!fresh.length) { stoppedBy = 'overlap-only'; break }
    series = fresh.concat(series).sort((a, b) => a.time - b.time)
  }
  return { series, rounds, tiers: [...tiers], stoppedBy }
}

function audit(series) {
  const n = series.length
  let maxJump = 0, jumpAt = -1, maxGap = 0, gapAt = -1
  for (let i = 1; i < n; i++) {
    const r = series[i].close / (series[i - 1].close || 1)
    const x = r > 1 ? r : 1 / r
    if (isFinite(x) && x > maxJump) { maxJump = x; jumpAt = i }
    const d = series[i].time - series[i - 1].time
    if (d > maxGap) { maxGap = d; gapAt = i }
  }
  // Longest CONTIGUOUS zero-volume run - the M87 signature is a whole era of it
  // sitting under a tape that otherwise has volume.
  let run = 0, longestZeroRun = 0
  for (const b of series) { run = b.volume > 0 ? 0 : run + 1; if (run > longestZeroRun) longestZeroRun = run }
  // A price is a number a market actually printed. Nothing on our path trades
  // below ~1e-12, so anything under 1e-15 (or non-finite, or <= 0) is a
  // corrupted field, not a quote - measured on the codex tier for LEO 5m:
  // o=3.92 with c=4.10e-36 at full volume, twice in 306 bars.
  const junk = series.filter(b => ![b.open, b.high, b.low, b.close].every(v => Number.isFinite(v) && v > 1e-15))
  const zeroVol = series.filter(b => !(b.volume > 0)).length
  const iso = t => new Date(t).toISOString().slice(0, 16)
  return {
    bars: n, first: iso(series[0].time), last: iso(series[n - 1].time),
    spanDays: +((series[n - 1].time - series[0].time) / 86400000).toFixed(1),
    maxJumpX: +maxJump.toFixed(1),
    jumpAt: jumpAt > 0 ? `${iso(series[jumpAt].time)} ${series[jumpAt - 1].close.toExponential(3)}->${series[jumpAt].close.toExponential(3)}` : null,
    maxGapHours: +(maxGap / 3600000).toFixed(1),
    gapAt: gapAt > 0 ? `${iso(series[gapAt - 1].time)} -> ${iso(series[gapAt].time)}` : null,
    zeroVolShare: +(zeroVol / n).toFixed(3),
    longestZeroRun,
    junkBars: junk.length,
    junkAt: junk.length ? `${iso(junk[0].time)} o=${junk[0].open} c=${junk[0].close}` : null,
  }
}

/** Only signatures we can attribute to a defect fail the run. Volatility does not. */
function verdict(a, walked) {
  const fails = []
  if (a.longestZeroRun >= 50 && a.zeroVolShare < 0.5) {
    fails.push(`MIXED CONTRACT: ${a.longestZeroRun} consecutive volume-less bars inside a tape that is ${(100 - a.zeroVolShare * 100).toFixed(0)}% volume-bearing - a close-only tier was spliced in`)
  }
  if (a.junkBars) {
    fails.push(`JUNK PRICE: ${a.junkBars} bar(s) carry a non-price OHLC field (${a.junkAt}) - a corrupted upstream field, not a market move`)
  }
  // Second net for the same family: both endpoints look like numbers but sit
  // orders of magnitude apart. Deliberately far above any real move (a launch
  // candle can do 100x, nothing does 1e6x) so volatility never trips it.
  if (a.maxJumpX > 1e6) {
    fails.push(`IMPOSSIBLE MOVE: ${a.maxJumpX.toExponential(1)}x between adjacent bars (${a.jumpAt}) - a denomination or source error, not price action`)
  }
  if (walked.stoppedBy === 'transient-failure') {
    fails.push('TRANSIENT WALL: the walk ended on a failed request, which says nothing about whether history exists')
  }
  for (let i = 1; i < walked.series.length; i++) {
    if (walked.series[i].time <= walked.series[i - 1].time) { fails.push('NON-MONOTONIC: merged series has duplicate or out-of-order timestamps'); break }
  }
  return fails
}

/** Discover live tokens so coverage does not depend on anyone writing fixtures. */
async function sweepTokens(n) {
  const r = await fetch(`${BASE}/api/tokens/trending`, { signal: AbortSignal.timeout(20000) })
  const j = await r.json()
  return (j?.results || [])
    .map(x => x.token || x)
    .filter(t => t?.address && t?.networkId && t?.symbol)
    .slice(0, n)
    .map(t => ({ name: t.symbol, symbol: `${t.address}:${t.networkId}`, networkId: t.networkId, res: SWEEP_RES, why: 'live sweep' }))
}

const results = []
const only = arg('case', null)

if (SWEEP_N) {
  const toks = await sweepTokens(SWEEP_N)
  console.log(`sweeping ${toks.length} live token(s) at res ${SWEEP_RES}, ${SWEEP_PAGES ? SWEEP_PAGES + ' page(s) each' : 'head window only'}\n`)
  for (const tc of toks) {
    let series, rounds = [], tiers = [], stoppedBy = 'head-only'
    if (SWEEP_PAGES > 0) {
      const w = await walk({ ...tc }, SWEEP_PAGES)
      if (w.fatal) { results.push({ name: tc.name, skipped: w.fatal }); continue }
      ;({ series, rounds, tiers, stoppedBy } = w)
    } else {
      const nowSec = Math.floor(Date.now() / 1000)
      const head = await fetchBars({ ...tc, from: nowSec - (HEAD_HOURS[SWEEP_RES] || 96) * 3600, to: nowSec })
      if (head.bars.length < 2) { results.push({ name: tc.name, skipped: head.error || 'no bars' }); continue }
      series = head.bars; tiers = [head.source].filter(Boolean)
      rounds = [{ round: 'head', bars: head.bars.length, source: head.source, ms: head.ms }]
    }
    const a = audit(series)
    results.push({ name: tc.name, why: tc.why, res: tc.res, ...a, tiers, stoppedBy, rounds, fails: verdict(a, { series, stoppedBy }) })
  }
} else {
  for (const tc of SUITE) {
    if (only && !tc.name.includes(only)) continue
    const walked = await walk(tc)
    if (walked.fatal) { results.push({ name: tc.name, fatal: walked.fatal }); continue }
    const a = audit(walked.series)
    results.push({ name: tc.name, why: tc.why, res: tc.res, ...a, tiers: walked.tiers, stoppedBy: walked.stoppedBy, rounds: walked.rounds, fails: verdict(a, walked) })
  }
}

if (AS_JSON) { console.log(JSON.stringify(results, null, 2)); }
else {
  if (!SEAM_GATE) console.log('\n[--no-seam-gate] shipped seam guard DISABLED - the suite is expected to go red')
  for (const r of results) {
    if (r.fatal) { console.log(`\n✗ ${r.name}\n  FATAL ${r.fatal}`); continue }
    if (r.skipped) { console.log(`·  ${r.name.padEnd(14)} skipped (${r.skipped})`); continue }
    if (SWEEP_N && !r.fails.length) {
      console.log(`✓  ${r.name.padEnd(14)} ${String(r.bars).padStart(5)} bars  jump ${String(r.maxJumpX).padStart(6)}x  ${r.tiers.join(',')}`)
      continue
    }
    console.log(`\n${r.fails.length ? '✗' : '✓'} ${r.name}  (res ${r.res})`)
    console.log(`  ${r.why}`)
    console.log(`  ${r.bars} bars  ${r.first} -> ${r.last}  (${r.spanDays}d)   tiers: ${r.tiers.join(', ') || '-'}   stopped: ${r.stoppedBy}`)
    console.log(`  max adjacent jump ${r.maxJumpX}x${r.jumpAt ? '  @ ' + r.jumpAt : ''}`)
    console.log(`  max time gap ${r.maxGapHours}h${r.gapAt ? '  @ ' + r.gapAt : ''}`)
    console.log(`  volume-less: ${(r.zeroVolShare * 100).toFixed(1)}% of bars, longest run ${r.longestZeroRun}${r.junkBars ? `   junk-price bars: ${r.junkBars}` : ''}`)
    console.log(`  pages: ${r.rounds.filter(x => x.round !== 'head').map(x => x.rejected ? `REJECTED(${x.rejected})` : `+${x.added ?? x.bars}`).join(' ') || '-'}`)
    for (const f of r.fails) console.log(`  FAIL  ${f}`)
  }
}
const failed = results.filter(r => r.fatal || (r.fails && r.fails.length))
console.log(`\n${results.length - failed.length}/${results.length} clean`)
process.exit(failed.length ? 1 : 0)
