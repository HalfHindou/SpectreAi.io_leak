#!/usr/bin/env node
/**
 * charts-health.mjs — the charts data-pipeline HEALTH CONTRACT.
 *
 * A zero-dependency (plain `fetch`) probe harness that asserts the /api/bars
 * tier router, the UDF history endpoint, and the stocks candles endpoint all
 * still honour their contracts. It is the executable counterpart to
 * `.claude/rules/charts-system.md` — every assertion here maps to a regression
 * we have actually shipped and then fixed (see inline tags like C1, S1...).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHEN TO RUN
 *   - After ANY change to apps/research/api/_lib/handlers/bars.js (or the tier
 *     helpers it calls: binance-bars / hetzner-bars / geckoterminal-bars /
 *     cg-ohlc-bars), the UDF history route, or the stocks candles route.
 *   - Post-deploy smoke against prod, to catch a tier silently going dark
 *     (e.g. a kill-switch left flipped, a registry that failed to bundle).
 *   - It is intentionally cheap on the metered Codex tier: the matrix is
 *     designed to cost <= ~6 Codex ops per run (only the genuinely Codex-only
 *     long-tail probes can reach Codex, and most of those have free fallbacks).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW TO RUN
 *
 *   Local dev (Express delegates /api/bars ungated — no cookie needed):
 *     node apps/research/scripts/charts-health.mjs --base http://localhost:3001
 *
 *   Against prod (research /api/bars sits behind the AuthGate; you must pass a
 *   valid `spectre-gate` cookie or every probe 401s):
 *     node apps/research/scripts/charts-health.mjs \
 *       --base https://app.spectreai.io \
 *       --gate-cookie "spectre-gate=<value>"
 *
 *   Budget accounting only (print the matrix + the Codex-cost note, skip the
 *   network calls — useful in CI to prove the matrix stays cheap):
 *     node apps/research/scripts/charts-health.mjs --budget-only
 *
 * Exit code: 0 if every assertion passed, 1 if any failed (a summary table of
 * failures is printed last).
 */

// ── Tier vocabulary (X-Spectre-Tier header values from bars.js) ──────────────
// binance | hetzner | geckoterminal | cg-ohlc | codex | no_data

const TIERS = ['binance', 'hetzner', 'geckoterminal', 'cg-ohlc', 'codex', 'no_data']

// ── CLI parsing (no deps) ────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { base: 'http://localhost:3001', gateCookie: null, budgetOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') args.base = argv[++i]
    else if (a === '--gate-cookie') args.gateCookie = argv[++i]
    else if (a === '--budget-only') args.budgetOnly = true
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0) }
  }
  args.base = String(args.base || '').replace(/\/$/, '')
  return args
}

function printUsage() {
  console.log(`charts-health.mjs — charts data-pipeline health contract

Usage:
  node apps/research/scripts/charts-health.mjs --base <url> [--gate-cookie "<cookie>"] [--budget-only]

Options:
  --base <url>          API origin. Default http://localhost:3001 (Express dev).
  --gate-cookie "<c>"   Cookie header value for prod (research /api/bars is
                        behind the AuthGate; pass a spectre-gate cookie).
  --budget-only         Print the matrix + Codex-cost note, make no requests.
`)
}

// ── Time helpers ─────────────────────────────────────────────────────────────
const NOW = Math.floor(Date.now() / 1000)
const HOUR = 3600
const DAY = 86400

// Interval seconds per resolution (mirrors bars.js _BARS_BUCKET_SEC for the
// freshness window math).
const RES_SECONDS = { '1': 60, '60': 3600, '1D': 86400 }

// Sensible windows per resolution. The wide probe uses from=0 to exercise the
// S1 window-normalization clamp (from=0 used to kill every tier → blank pane).
function windowFor(resolution, wide) {
  if (wide) return { from: 0, to: NOW }
  if (resolution === '1') return { from: NOW - 6 * HOUR, to: NOW }       // last 6h
  if (resolution === '60') return { from: NOW - 7 * DAY, to: NOW }       // last 7d
  if (resolution === '1D') return { from: NOW - 180 * DAY, to: NOW }     // last 180d
  return { from: NOW - 7 * DAY, to: NOW }
}

// ── Probe matrix ─────────────────────────────────────────────────────────────
// Each token row: a name, the bars query params (sans from/to/resolution), and
// the SET of tiers we accept. Multiple tiers are accepted where the upstream
// availability is legitimately fluid (a token can move between GT / CG / Codex
// as pools migrate or get indexed) — we only fail if the tier falls OUTSIDE the
// accepted set, which is how we'd catch a tier going dark.
const TOKENS = [
  {
    name: 'BTC ticker',
    params: { symbol: 'BTC', cgId: 'bitcoin' },
    expect: ['binance'],
    freshness: true,            // BTC must be live → enforce last-bar freshness
  },
  {
    name: 'WBTC address-form',
    // The reverse-map regression fence (S3/C2): an 0x address that resolves
    // back to BTC via the token registry MUST route to Binance, not Codex.
    params: { symbol: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599:1', cgId: 'bitcoin', networkId: '1' },
    expect: ['binance'],
  },
  {
    name: 'LEO cgId',
    // CEX-only alt with no GT pool: served from CoinGecko's OHLC tier.
    // Accept binance too in case LEO ever lists on a Binance USDT pair.
    // 1m is a DOCUMENTED gap for ticker-only requests: CG's OHLC endpoints
    // have no minute granularity and the address-bound tiers (GT/Codex)
    // are skipped without an address. Real clients send the address when
    // known, which unlocks 1m - so no_data here is the correct contract.
    params: { symbol: 'LEO', cgId: 'leo-token' },
    expect: ['cg-ohlc', 'binance'],
    allowEmptyAt: ['1'],
  },
  {
    name: 'PALM address',
    // Long-tail DEX token with a cgId: GT first, CG-OHLC second, Codex last.
    params: { symbol: '0xf1df7305E4BAB3885caB5B1e4dFC338452a67891:1', cgId: 'palm-ai', networkId: '1' },
    expect: ['geckoterminal', 'cg-ohlc', 'codex'],
  },
  {
    name: 'SPECTRE address',
    // The canary degen token (no cgId): GT / Codex / Hetzner are all valid.
    params: { symbol: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6:1', networkId: '1' },
    expect: ['geckoterminal', 'codex', 'hetzner'],
  },
]

const RESOLUTIONS = ['1', '60', '1D']

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function getJson(base, path, gateCookie) {
  const url = `${base}${path}`
  const headers = {}
  if (gateCookie) headers['Cookie'] = gateCookie
  const t0 = Date.now()
  let res, body, err = null
  try {
    res = await fetch(url, { headers })
    const text = await res.text()
    try { body = JSON.parse(text) } catch { body = { _raw: text } }
  } catch (e) {
    err = e
  }
  return {
    url,
    ms: Date.now() - t0,
    status: res ? res.status : 0,
    tier: res ? res.headers.get('x-spectre-tier') : null,
    body,
    err,
  }
}

function barsPath(params, from, to, resolution) {
  const qs = new URLSearchParams({ ...params, from: String(from), to: String(to), resolution })
  return `/api/bars?${qs.toString()}`
}

// ── Assertions ───────────────────────────────────────────────────────────────
// Each probe collects an array of { ok, msg } checks. We never throw on the
// first failure — we gather them all so one run surfaces every regression.
function assertBarsResponse(probe, r) {
  const checks = []
  const push = (ok, msg) => checks.push({ ok, msg })

  // HTTP 200.
  push(r.status === 200, `HTTP 200 (got ${r.status})`)
  if (r.status !== 200) return checks

  const bars = Array.isArray(r.body?.bars) ? r.body.bars : null
  const meta = r.body?.meta || null

  // bars present. Wide probes specifically MUST be non-empty (S1 contract:
  // from=0 clamps to the last N bars and returns history for any live token).
  // Token rows may declare allowEmptyAt: ['1', ...] for documented structural
  // gaps (e.g. CEX-only alts at 1m: CG OHLC has no minute granularity and the
  // address-bound tiers are skipped for ticker-only requests).
  const n = bars ? bars.length : 0
  const emptyAllowed = !probe.wide && Array.isArray(probe.token?.allowEmptyAt) &&
    probe.token.allowEmptyAt.includes(probe.resolution)
  if (probe.wide) {
    push(n > 0, `wide probe bars.length > 0 (got ${n}) [S1 clamp]`)
  } else if (emptyAllowed && n === 0) {
    push(true, 'empty allowed at this resolution (documented gap)')
  } else {
    push(n > 0, `bars.length > 0 (got ${n})`)
  }
  if (!bars || n === 0) return checks

  // t strictly ascending.
  let ascending = true
  for (let i = 1; i < bars.length; i++) {
    if (!(bars[i].t > bars[i - 1].t)) { ascending = false; break }
  }
  push(ascending, 't strictly ascending')

  // X-Spectre-Tier present + in the accepted set for this probe.
  push(TIERS.includes(r.tier), `X-Spectre-Tier is known (${r.tier})`)
  push(probe.expect.includes(r.tier), `tier in {${probe.expect.join(',')}} (got ${r.tier})`)

  // Volume contract: meta.volumeAvailable === false ⇒ every v must be 0.
  if (meta && meta.volumeAvailable === false) {
    const allZero = bars.every((b) => b.v === 0)
    push(allZero, 'volumeAvailable:false ⇒ every v === 0')
  }

  // Flat-bar ratio (o==h==l==c) <= 0.5 UNLESS the GT tier gap-filled this
  // window (meta.gapFilled) — gap-fill legitimately fabricates flat bars.
  const flat = bars.filter((b) => b.o === b.h && b.h === b.l && b.l === b.c).length
  const flatRatio = flat / bars.length
  if (meta && meta.gapFilled) {
    push(true, `flat ratio ${flatRatio.toFixed(2)} (gapFilled — skipped)`)
  } else {
    push(flatRatio <= 0.5, `flat-bar ratio <= 0.5 (got ${flatRatio.toFixed(2)})`)
  }

  // Freshness: for live tokens at 1/60 res, the last bar must be within 5
  // intervals of the window end.
  if (probe.freshness && (probe.resolution === '1' || probe.resolution === '60') && !probe.wide) {
    const intervalSec = RES_SECONDS[probe.resolution] || HOUR
    const lastT = bars[bars.length - 1].t
    const lag = probe.to - lastT
    push(lag <= 5 * intervalSec, `freshness: last bar within 5 intervals (lag ${Math.round(lag / intervalSec)} bars)`)
  }

  // Wide-probe right-edge freshness (2026-06-11 audit fence): wide probes end
  // at ~now, so the LAST bar must be near `to`. The Binance startTime+endTime
  // form returned the EARLIEST 1000 bars of a 1500-bar window - bars came back
  // non-empty but the chart's right edge was ~500 intervals (~3 weeks on 1H)
  // stale, and this matrix previously passed it. Never again.
  if (probe.wide) {
    const intervalSec = RES_SECONDS[probe.resolution] || HOUR
    const lastT = bars[bars.length - 1].t
    const lag = probe.to - lastT
    push(lag <= 12 * intervalSec, `wide-probe right edge fresh: last bar within 12 intervals of to (lag ${Math.round(lag / intervalSec)} bars)`)
  }

  return checks
}

function assertUdfResponse(probe, r) {
  const checks = []
  const push = (ok, msg) => checks.push({ ok, msg })
  push(r.status === 200, `HTTP 200 (got ${r.status})`)
  if (r.status !== 200) return checks

  const s = r.body?.s
  push(s === 'ok' || s === 'no_data', `s is 'ok'|'no_data' (got ${s})`)
  if (s !== 'ok') return checks

  const t = Array.isArray(r.body?.t) ? r.body.t : null
  push(t && t.length > 0, `t.length > 0 (got ${t ? t.length : 0})`)
  if (!t || t.length === 0) return checks

  // Parallel arrays must all match t's length.
  for (const k of ['o', 'h', 'l', 'c', 'v']) {
    const arr = r.body?.[k]
    push(Array.isArray(arr) && arr.length === t.length, `${k}.length === t.length`)
  }

  // t strictly ascending.
  let ascending = true
  for (let i = 1; i < t.length; i++) {
    if (!(t[i] > t[i - 1])) { ascending = false; break }
  }
  push(ascending, 't strictly ascending')

  return checks
}

function assertStockResponse(r) {
  const checks = []
  const push = (ok, msg) => checks.push({ ok, msg })
  push(r.status === 200, `HTTP 200 (got ${r.status})`)
  if (r.status !== 200) return checks

  const bars = Array.isArray(r.body?.bars) ? r.body.bars : null
  push(bars && bars.length > 0, `bars.length > 0 (got ${bars ? bars.length : 0})`)
  if (!bars || bars.length === 0) return checks

  let ascending = true
  for (let i = 1; i < bars.length; i++) {
    if (!(bars[i].t > bars[i - 1].t)) { ascending = false; break }
  }
  push(ascending, 't strictly ascending')
  return checks
}

// ── Reporting ────────────────────────────────────────────────────────────────
function flagsFor(checks, r) {
  const flags = []
  const meta = r.body?.meta
  if (meta?.gapFilled) flags.push('gapFilled')
  if (meta?.volumeAvailable === false) flags.push('noVol')
  if (typeof meta?.realBarRatio === 'number') flags.push(`real=${meta.realBarRatio}`)
  if (checks.some((c) => !c.ok)) flags.push('FAIL')
  return flags.length ? ` [${flags.join(' ')}]` : ''
}

function barsLen(r) {
  return Array.isArray(r.body?.bars) ? r.body.bars.length
    : Array.isArray(r.body?.t) ? r.body.t.length : 0
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2))

  // Build the full probe list. Each entry knows how to fetch + assert itself.
  const probes = []

  for (const tok of TOKENS) {
    for (const resolution of RESOLUTIONS) {
      const w = windowFor(resolution, false)
      probes.push({
        kind: 'bars',
        name: tok.name,
        resolution,
        from: w.from,
        to: w.to,
        wide: false,
        freshness: !!tok.freshness && tok.name === 'BTC ticker',
        expect: tok.expect,
        token: tok,
        path: barsPath(tok.params, w.from, w.to, resolution),
      })
    }
    // One from=0 wide probe per token at 60 (S1 clamp fence).
    const ww = windowFor('60', true)
    probes.push({
      kind: 'bars',
      name: `${tok.name} (wide from=0)`,
      resolution: '60',
      from: ww.from,
      to: ww.to,
      wide: true,
      freshness: false,
      expect: tok.expect,
      token: tok,
      path: barsPath(tok.params, ww.from, ww.to, '60'),
    })
  }

  // UDF history for BTC + the SPECTRE address form at 60.
  const udfW = windowFor('60', false)
  probes.push({
    kind: 'udf',
    name: 'UDF BTC',
    resolution: '60',
    path: `/api/tradingview/udf/history?symbol=BTC&resolution=60&from=${udfW.from}&to=${udfW.to}`,
  })
  probes.push({
    kind: 'udf',
    name: 'UDF SPECTRE address',
    resolution: '60',
    path: `/api/tradingview/udf/history?symbol=${encodeURIComponent('0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6:1')}&resolution=60&from=${udfW.from}&to=${udfW.to}`,
  })

  // AAPL via the stocks candles route. NOTE: this route takes interval/range
  // (Yahoo's param shape), NOT resolution — interval=1d&range=6mo is the daily
  // (1D) regression fence. Response is { bars:[...] } with NO X-Spectre-Tier.
  probes.push({
    kind: 'stock',
    name: 'AAPL stock 1D',
    resolution: '1D',
    path: `/api/stocks/candles?symbol=AAPL&interval=1d&range=6mo`,
  })

  // Codex-cost accounting: count probes whose ACCEPTED tier set is Codex-ONLY
  // (no free fallback before it). Those are the only rows that can actually
  // bill Codex; everything else has a free tier ahead of it. The matrix is
  // designed so this stays <= ~6 ops/run.
  const codexReachable = probes.filter(
    (p) => p.kind === 'bars' && p.expect && p.expect.includes('codex'),
  ).length

  console.log(`charts-health — base=${args.base}`)
  console.log(`probes: ${probes.length} (bars=${probes.filter((p) => p.kind === 'bars').length}, udf=${probes.filter((p) => p.kind === 'udf').length}, stock=${probes.filter((p) => p.kind === 'stock').length})`)
  console.log(`codex-reachable probes (worst-case Codex ops this run): ${codexReachable}\n`)

  if (args.budgetOnly) {
    console.log('--budget-only: matrix printed, no requests made.')
    if (codexReachable > 8) {
      console.error(`\nBUDGET FAIL: ${codexReachable} codex-reachable probes (> 8 ceiling).`)
      process.exit(1)
    }
    process.exit(0)
  }

  const failures = []
  let passCount = 0
  let checkCount = 0

  for (const probe of probes) {
    const r = await getJson(args.base, probe.path, args.gateCookie)

    let checks
    if (r.err) {
      checks = [{ ok: false, msg: `request error: ${r.err.message}` }]
    } else if (probe.kind === 'bars') {
      checks = assertBarsResponse(probe, r)
    } else if (probe.kind === 'udf') {
      checks = assertUdfResponse(probe, r)
    } else {
      checks = assertStockResponse(r)
    }

    checkCount += checks.length
    passCount += checks.filter((c) => c.ok).length

    const tierStr = r.tier || (probe.kind === 'udf' ? `s=${r.body?.s ?? '?'}` : probe.kind === 'stock' ? 'yahoo' : '?')
    console.log(`${probe.name.padEnd(28)} ${String(probe.resolution).padEnd(3)} -> ${String(tierStr).padEnd(14)} bars=${String(barsLen(r)).padEnd(5)}${flagsFor(checks, r)} ms=${r.ms}`)

    for (const c of checks) {
      if (!c.ok) {
        console.log(`    ✗ ${c.msg}`)
        failures.push({ probe: `${probe.name} @${probe.resolution}`, msg: c.msg, tier: tierStr })
      }
    }
  }

  console.log(`\nchecks: ${passCount}/${checkCount} passed`)
  console.log(`codex-reachable probes this run: ${codexReachable} (ceiling ~6-8)`)

  if (failures.length) {
    console.log(`\n── FAILURES (${failures.length}) ─────────────────────────────────────`)
    console.log('PROBE'.padEnd(34) + 'TIER'.padEnd(16) + 'ASSERTION')
    for (const f of failures) {
      console.log(f.probe.padEnd(34) + String(f.tier).padEnd(16) + f.msg)
    }
    process.exit(1)
  }

  console.log('\nALL CONTRACTS HELD ✓')
  process.exit(0)
}

main().catch((e) => {
  console.error('charts-health crashed:', e)
  process.exit(1)
})
