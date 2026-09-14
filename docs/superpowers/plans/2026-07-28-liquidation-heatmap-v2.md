# Liquidation Heatmap 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/liquidation-heatmap` main heatmap with real multi-exchange data (real liquidation prints, aggregate OI, tape-calibrated leverage mix) and a CoinGlass-grade renderer (sharp navy→cyan→yellow bands, prints overlay, crosshair tooltip with cumulative $, clickable pinned levels, exchange filter, day mode).

**Architecture:** Server keeps the existing cohort/eviction synthesizer (`liq-heatmap-binance.js`) but its two weakest inputs get real data: seed notional = live aggregate OI across Binance+Bybit+OKX+Hyperliquid, and leverage tier weights calibrated from the real liquidation tape our Spectre data-api box already collects (`/v1/derivatives/liquidations`, Bybit full feed + OKX, ~7d history). A new `/api/charts/liq-prints` endpoint serves real events to the client. The canvas renderer is rewritten in place.

**Tech Stack:** Plain JS (no TS), ESM handler modules shared by Express (dev) + Vercel serverless (prod), canvas 2D renderer, React 18 view component.

**Spec:** `docs/superpowers/specs/2026-07-28-liquidation-heatmap-v2-design.md`

## Global Constraints

- **NO git commits/pushes anywhere in this plan** — Evgeniy commits manually. Leave everything in the working tree. (Standing user rule overrides the usual commit-per-task discipline.)
- No TypeScript in app code; `.js`/`.jsx` only.
- Every new dev Express route must have a serverless mirror + `vercel.json` rewrite (CLAUDE.md rule 5).
- Fail-soft everywhere: a dead venue/tape must never blank the heatmap. All upstream fetches use `AbortSignal.timeout(8000)`.
- Binance fapi is geo-blocked from Vercel — never remove the Bybit fallbacks in `liq-heatmap-binance.js`.
- No fabricated data: empty tape → empty overlay, never synthetic dots.
- Design system: shimmer not spinners, `--bull`/`--bear` only for market semantics, day-mode counterpart for every dark style (research selector: `.app.app-day-mode`).
- No test runner exists in this repo — pure-logic tests are plain `node` scripts (pattern: `packages/server/lib/__tests__/agent-core.test.mjs`). UI verified by build + browser.
- After each task: `npm run build:research` must pass with green `[check-critical-path]`.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/research/api/_lib/handlers/liq-tape.js` | Create | Spectre tape client: fetch real liquidation events, shape prints payload, symbol→asset mapping |
| `apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs` | Create | Node tests for tape client (injected fetch) + payload shaping |
| `apps/research/api/_lib/handlers/liq-heatmap-binance.js` | Modify | Synthesizer: aggregate OI seed, tape-calibrated tiers, exchange preference, `_stats` |
| `apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs` | Create | Node tests for the calibration math |
| `apps/research/api/_lib/handlers/charts-proxy.js` | Modify | Serverless: new `liq-prints` route; pass `exchange` into builder |
| `packages/server/index.js` | Modify (~line 11020, after liq-heatmap route) | Dev Express: new `/api/charts/liq-prints`; pass `exchange` into builder |
| `apps/research/vercel.json` | Modify (line ~105) | Rewrite for `/api/charts/liq-prints` |
| `apps/research/src/pages/traders-corner/tradersCornerApi.js` | Modify | `getLiqPrints()` client fetcher |
| `apps/research/src/pages/liquidation-heatmap/components/use-real-heatmap.js` | Modify | Fetch prints alongside heatmap; exchange state; TF window hours |
| `apps/research/src/pages/liquidation-heatmap/components/real-heatmap-chart.js` | Modify (rewrite paint) | New ramps + day mode, sharp bands, prints layer, pins, upgraded tooltip, geometry return |
| `apps/research/src/pages/liquidation-heatmap/components/heatmap-view.jsx` | Modify | Prints toggle, exchange pills, click-to-pin, pass opts to renderer |
| `apps/research/src/pages/liquidation-heatmap/components/liquidation-page.jsx` | Modify (line 463, 648-656, 871-879) | Pass new props through |
| `apps/research/src/pages/liquidation-heatmap/components/liquidation-page.css` | Modify | Styles for pills/toggle + day-mode counterparts |

---

### Task 1: Tape client module (`liq-tape.js`) + tests

**Files:**
- Create: `apps/research/api/_lib/handlers/liq-tape.js`
- Create: `apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs`

**Interfaces (Produces):**
- `symbolToAsset(symbol: string) → string` — `'BTCUSDT'→'BTC'`, `'1000PEPEUSDT'→'PEPE'`
- `fetchTapeEvents(asset: string, hours?: number, opts?: { fetchImpl }) → Promise<Array<{t:number(ms), p:number, side:'long'|'short', usd:number, ex:string}>>` — newest-first from API, returned in fetched order; stops at window cutoff or 6 pages
- `shapePrintsPayload(events, hours) → { events, count, truncated, window_covered_hours, requested_hours }` — caps at 1500 largest by usd

- [ ] **Step 1: Write the failing test**

```js
// apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs
// Run with: node apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs
import assert from 'node:assert'
import { symbolToAsset, fetchTapeEvents, shapePrintsPayload } from '../liq-tape.js'

// symbolToAsset
assert.equal(symbolToAsset('BTCUSDT'), 'BTC')
assert.equal(symbolToAsset('ethusdt'), 'ETH')
assert.equal(symbolToAsset('SOLUSD'), 'SOL')
assert.equal(symbolToAsset('1000PEPEUSDT'), 'PEPE')
assert.equal(symbolToAsset(''), 'BTC')

// fetchTapeEvents: paginates, stops at cutoff, drops bad rows
const now = Date.now()
const page = (rows) => ({ ok: true, json: async () => ({ data: rows }) })
const mkRow = (agoMs, price, usd, side = 'long', exchange = 'bybit') => ({
  time: new Date(now - agoMs).toISOString(),
  time_unix: Math.floor((now - agoMs) / 1000),
  asset: 'BTC', exchange, side, quantity: 1, price, usd_value: usd,
})
const calls = []
const fetchImpl = async (url) => {
  calls.push(url)
  if (calls.length === 1) return page([mkRow(1000, 63000, 5000), mkRow(2000, 63010, 300), { price: 'x', usd_value: -1 }])
  // second page: first row inside window, second row older than cutoff
  return page([mkRow(3600_000, 62900, 800), mkRow(80 * 3600_000, 60000, 999)])
}
const events = await fetchTapeEvents('BTC', 72, { fetchImpl })
assert.equal(calls.length, 2, 'stops after cutoff page')
assert.ok(calls[0].includes('asset=BTC') && calls[0].includes('limit=500') && calls[0].includes('offset=0'))
assert.ok(calls[1].includes('offset=500'))
assert.equal(events.length, 3, 'drops malformed + beyond-cutoff rows')
assert.equal(events[0].usd, 5000)
assert.equal(events[0].side, 'long')
assert.equal(typeof events[0].t, 'number')

// fetchTapeEvents: empty page ends pagination, no throw
const emptyEvents = await fetchTapeEvents('BTC', 72, { fetchImpl: async () => page([]) })
assert.deepEqual(emptyEvents, [])

// fetchTapeEvents: HTTP error → returns what it has, no throw
const errEvents = await fetchTapeEvents('BTC', 72, { fetchImpl: async () => ({ ok: false }) })
assert.deepEqual(errEvents, [])

// shapePrintsPayload: passthrough under cap
const shaped = shapePrintsPayload(events, 72)
assert.equal(shaped.count, 3)
assert.equal(shaped.truncated, false)
assert.equal(shaped.requested_hours, 72)
assert.ok(shaped.window_covered_hours > 0)

// shapePrintsPayload: caps at 1500 largest, re-sorted by time ascending
const many = Array.from({ length: 2000 }, (_, i) => ({ t: now - i * 1000, p: 100, side: 'long', usd: i + 1, ex: 'okx' }))
const capped = shapePrintsPayload(many, 24)
assert.equal(capped.count, 1500)
assert.equal(capped.truncated, true)
assert.equal(Math.min(...capped.events.map(e => e.usd)), 501, 'kept the largest 1500')
for (let i = 1; i < capped.events.length; i++) assert.ok(capped.events[i].t >= capped.events[i - 1].t, 'time ascending')

console.log('liq-tape.test.mjs OK')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs`
Expected: FAIL — `Cannot find module '../liq-tape.js'`

- [ ] **Step 3: Implement `liq-tape.js`**

```js
// apps/research/api/_lib/handlers/liq-tape.js
/**
 * Real liquidation tape client — Spectre data-api box.
 *
 * The box runs 24/7 collectors on Bybit's `allLiquidation` WebSocket (ALL
 * liquidations, not the old 1/sec sample) + OKX, and serves the event tape at
 * /v1/derivatives/liquidations (asset filter, offset pagination, ~7d history —
 * probed 2026-07-28: BTC offset 5000 reached 7 days back).
 *
 * Consumers: /api/charts/liq-prints (real-prints overlay) and the heatmap
 * synthesizer's leverage calibration (liq-heatmap-binance.js).
 *
 * Fail-soft: every function returns what it has on error — never throws to
 * the route level.
 */

const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || ''

const PAGE_SIZE = 500
const MAX_PAGES = 6
const MAX_PRINTS = 1500

export function symbolToAsset(symbol) {
  let s = String(symbol || 'BTCUSDT').toUpperCase().replace(/USDT$|USDC$|USD$/, '')
  // Binance-style multiplier prefixes: 1000PEPE / 1000000MOG → PEPE / MOG
  s = s.replace(/^1000000/, '').replace(/^1000/, '')
  return s || 'BTC'
}

function tapeHeaders() {
  const h = { accept: 'application/json' }
  if (SPECTRE_API_KEY) h['X-API-Key'] = SPECTRE_API_KEY
  return h
}

export async function fetchTapeEvents(asset, hours = 72, { fetchImpl = fetch } = {}) {
  const cutoff = Date.now() - hours * 3600_000
  const events = []
  try {
    for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      const url = `${SPECTRE_API_BASE}/v1/derivatives/liquidations?asset=${encodeURIComponent(asset)}&limit=${PAGE_SIZE}&offset=${pageIdx * PAGE_SIZE}`
      const res = await fetchImpl(url, { headers: tapeHeaders(), signal: AbortSignal.timeout(8000) })
      if (!res.ok) break
      const j = await res.json().catch(() => null)
      const rows = j?.data
      if (!Array.isArray(rows) || rows.length === 0) break
      let reachedCutoff = false
      for (const r of rows) {
        const t = Number(r.time_unix) * 1000 || Date.parse(r.time)
        if (!Number.isFinite(t)) continue
        if (t < cutoff) { reachedCutoff = true; break }
        const usd = Number(r.usd_value)
        const p = Number(r.price)
        if (!(usd > 0) || !(p > 0)) continue
        events.push({ t, p, side: r.side === 'short' ? 'short' : 'long', usd, ex: String(r.exchange || '').toLowerCase() })
      }
      if (reachedCutoff || rows.length < PAGE_SIZE) break
    }
  } catch { /* fail-soft: return what we have */ }
  return events
}

export function shapePrintsPayload(events, hours) {
  const truncated = events.length > MAX_PRINTS
  let out = events
  if (truncated) {
    out = [...events].sort((a, b) => b.usd - a.usd).slice(0, MAX_PRINTS)
  }
  out = [...out].sort((a, b) => a.t - b.t)
  let oldest = Infinity
  for (const e of events) if (e.t < oldest) oldest = e.t
  return {
    events: out,
    count: out.length,
    truncated,
    window_covered_hours: Number.isFinite(oldest)
      ? Math.round(((Date.now() - oldest) / 3600_000) * 10) / 10
      : 0,
    requested_hours: hours,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs`
Expected: `liq-tape.test.mjs OK`

- [ ] **Step 5: Live smoke against the real box** (network sanity, not a unit test)

Run: `node -e "import('./apps/research/api/_lib/handlers/liq-tape.js').then(async m => { const ev = await m.fetchTapeEvents('BTC', 24); console.log('events:', ev.length, 'sample:', ev[0]) })"`
Expected: `events:` several hundred, sample has `{t, p, side, usd, ex}` with `ex` `'bybit'` or `'okx'`. (Needs `SPECTRE_DATA_API_KEY`/`SPECTRE_API_KEY` in root `.env` — already present.)

---

### Task 2: Prints endpoints — Express + serverless + rewrite

**Files:**
- Modify: `packages/server/index.js` — insert after the `/api/charts/liq-heatmap` route's closing `});` (search for `app.get('/api/charts/exchange-list'` and insert BEFORE it)
- Modify: `apps/research/api/_lib/handlers/charts-proxy.js` — new route branch before the final `return res.status(400)`
- Modify: `apps/research/vercel.json` — after line 104 (`exchange-list` rewrite)

**Interfaces:**
- Consumes: `symbolToAsset`, `fetchTapeEvents`, `shapePrintsPayload` from Task 1.
- Produces: `GET /api/charts/liq-prints?symbol=BTCUSDT&hours=72` → `{ success: true, symbol, events: [{t,p,side,usd,ex}], count, truncated, window_covered_hours, requested_hours }` (same shape dev + prod). On total failure: `{ success: true, events: [], count: 0, ... , _error }` — HTTP 200 always.

- [ ] **Step 1: Express route** (`packages/server/index.js`, before the `exchange-list` route)

```js
app.get('/api/charts/liq-prints', async (req, res) => {
  const symbol = req.query.symbol || 'BTCUSDT';
  const hours = Math.max(1, Math.min(168, parseInt(req.query.hours, 10) || 72));
  const cacheKey = `prints-${symbol}-${hours}`;
  const cached = chartsCacheGet(cacheKey, 60_000);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.json(cached);
  }
  try {
    const { symbolToAsset, fetchTapeEvents, shapePrintsPayload } =
      await import('../../apps/research/api/_lib/handlers/liq-tape.js');
    const events = await fetchTapeEvents(symbolToAsset(symbol), hours);
    const payload = { success: true, symbol, ...shapePrintsPayload(events, hours) };
    chartsCacheSet(cacheKey, payload);
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(payload);
  } catch (err) {
    console.error('[Charts Proxy] liq-prints error:', err.message);
    res.json({ success: true, symbol, events: [], count: 0, truncated: false, window_covered_hours: 0, requested_hours: hours, _error: err.message });
  }
});
```

- [ ] **Step 2: Serverless route** (`charts-proxy.js`, insert before `return res.status(400)`)

```js
  if (route === 'liq-prints') {
    const symbol = req.query.symbol || 'BTCUSDT'
    const hours = Math.max(1, Math.min(168, parseInt(req.query.hours, 10) || 72))
    const cacheKey = `prints-${symbol}-${hours}`
    const cached = getCached(cacheKey, 60_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }
    try {
      const { symbolToAsset, fetchTapeEvents, shapePrintsPayload } = await import('./liq-tape.js')
      const events = await fetchTapeEvents(symbolToAsset(symbol), hours)
      const payload = { success: true, symbol, ...shapePrintsPayload(events, hours) }
      setCache(cacheKey, payload)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(payload)
    } catch (err) {
      console.error('[charts-proxy] liq-prints error:', err.message)
      const stale = _cache[cacheKey]
      if (stale) return res.status(200).json(stale.data)
      return res.status(200).json({ success: true, symbol, events: [], count: 0, truncated: false, window_covered_hours: 0, requested_hours: hours, _error: err.message })
    }
  }
```

- [ ] **Step 3: vercel.json rewrite** (after line 104)

```json
    { "source": "/api/charts/liq-prints", "destination": "/api/market-api?fn=charts-proxy&route=liq-prints" },
```

Also verify `market-api.js` dispatches `fn=charts-proxy` dynamically (it already serves the two existing charts routes — grep `charts-proxy` in `apps/research/api/market-api.js`; no change expected).

- [ ] **Step 4: Verify dev endpoint**

Run: `curl -s 'http://localhost:3001/api/charts/liq-prints?symbol=BTCUSDT&hours=24' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['success'], d['count'], d['events'][0] if d['events'] else 'EMPTY', d.get('_error'))"`
Expected: `True <several hundred> {'t': ..., 'p': ..., 'side': ..., 'usd': ..., 'ex': 'bybit'|'okx'} None`
(Restart the dev server first if it was running before this change: the route is new code.)

Also: `curl -s 'http://localhost:3001/api/charts/liq-prints?symbol=1000PEPEUSDT&hours=24'` → success true (count may be 0 for thin assets — that's the honest-empty path, not an error).

- [ ] **Step 5: Build**

Run: `npm run build:research`
Expected: clean, `[check-critical-path] OK`

---

### Task 3: Synthesizer upgrade — aggregate OI seed + tape calibration + exchange preference

**Files:**
- Modify: `apps/research/api/_lib/handlers/liq-heatmap-binance.js`
- Create: `apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs`
- Modify: `apps/research/api/_lib/handlers/charts-proxy.js` (pass `exchange` into builder, line ~113)
- Modify: `packages/server/index.js` (same, in the `/api/charts/liq-heatmap` route)

**Interfaces:**
- Consumes: `fetchTapeEvents`, `symbolToAsset` from Task 1.
- Produces: `buildBinanceLiqHeatmap(symbol, timeframe, { exchange = 'All' } = {})` — third param NEW, back-compatible. `'Bybit'` prefers Bybit sources; `'Binance'` prefers Binance; `'All'` = current source order + aggregate OI seed. Exported for tests: `calibrateSideTiers(events, side, binOf, VP, rows, staticTiers)` → `Array<{lev, w}>` or `null`. Response `_stats` gains `calibration: 'tape'|'static'`, `oi_venues: string[]`, `seed_total_usd: number`.

- [ ] **Step 1: Write the failing calibration test**

```js
// apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs
// Run with: node apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs
import assert from 'node:assert'
import { calibrateSideTiers, LEV_TIERS } from '../liq-heatmap-binance.js'

// Grid: prices 100..260 in 160 rows of step 1.
const rows = 160
const minP = 100
const binOf = (p) => Math.floor(p - minP)
// Volume profile concentrated at price 200 (rows 95..105).
const VP = new Float64Array(rows)
for (let r = 95; r <= 105; r++) VP[r] = 1000

// Synthetic long-liq events at price 180: entry≈200 implies 1/L ≈ (200-180)/200 = 10% → 10x.
// (MAINT_MARGIN shifts this slightly; the 10x tier must still dominate.)
const events = Array.from({ length: 200 }, (_, i) => ({ t: i, p: 180, side: 'long', usd: 1000, ex: 'bybit' }))

const tiers = calibrateSideTiers(events, 'long', binOf, VP, rows, LEV_TIERS)
assert.ok(tiers, 'enough events → calibrated tiers')
assert.equal(tiers.length, LEV_TIERS.length)
const sum = tiers.reduce((a, t) => a + t.w, 0)
assert.ok(Math.abs(sum - 1) < 1e-9, 'weights normalized')
const w10 = tiers.find(t => t.lev === 10).w
const static10 = LEV_TIERS.find(t => t.lev === 10).w
assert.ok(w10 > static10, `10x weight lifted by calibration (${w10} > ${static10})`)
const wMax = Math.max(...tiers.map(t => t.w))
assert.equal(tiers.find(t => t.w === wMax).lev, 10, '10x is the dominant calibrated tier')

// Too few events → null (caller keeps static tiers)
assert.equal(calibrateSideTiers(events.slice(0, 20), 'long', binOf, VP, rows, LEV_TIERS), null)
// Wrong side filtered out → null
assert.equal(calibrateSideTiers(events, 'short', binOf, VP, rows, LEV_TIERS), null)
// Events whose implied entries all miss the VP → null
const farEvents = Array.from({ length: 200 }, (_, i) => ({ t: i, p: 500, side: 'long', usd: 1, ex: 'okx' }))
assert.equal(calibrateSideTiers(farEvents, 'long', binOf, VP, rows, LEV_TIERS), null)

console.log('liq-calibration.test.mjs OK')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs`
Expected: FAIL — `calibrateSideTiers` / `LEV_TIERS` not exported.

- [ ] **Step 3: Implement in `liq-heatmap-binance.js`**

3a. Export `LEV_TIERS` (change `const LEV_TIERS` → `export const LEV_TIERS`) and add imports at top:

```js
import { fetchTapeEvents, symbolToAsset } from './liq-tape.js'
```

3b. Add the calibration function (below `LEV_TIERS`):

```js
// ── Tape-calibrated leverage mix ────────────────────────────────────────────
// The static LEV_TIERS weights are a guess. When the Spectre tape has enough
// real liquidation events for this asset, estimate the ACTUAL leverage mix:
// for each real liq print, each candidate leverage L implies an entry price
// (invert the projection used below: long liq = open×(1−1/L+MM) → open =
// liq/(1−1/L+MM)); weight the candidate by the volume actually traded at that
// entry price (the VP the synthesizer already builds). Aggregate across events,
// blend 70/30 with the static prior for stability, renormalize.
const CALIB_MIN_EVENTS = 100
const CALIB_BLEND = 0.7

export function calibrateSideTiers(events, side, binOf, VP, rows, staticTiers) {
  const agg = new Float64Array(staticTiers.length)
  let used = 0
  for (const e of events) {
    if (e.side !== side) continue
    let sum = 0
    const w = new Float64Array(staticTiers.length)
    for (let i = 0; i < staticTiers.length; i++) {
      const { lev } = staticTiers[i]
      const entry = side === 'long'
        ? e.p / (1 - 1 / lev + MAINT_MARGIN)
        : e.p / (1 + 1 / lev - MAINT_MARGIN)
      const r = binOf(entry)
      const v = r >= 0 && r < rows ? VP[r] : 0
      w[i] = v
      sum += v
    }
    if (sum <= 0) continue
    for (let i = 0; i < staticTiers.length; i++) agg[i] += w[i] / sum
    used++
  }
  if (used < CALIB_MIN_EVENTS) return null
  let aggSum = 0
  for (let i = 0; i < agg.length; i++) aggSum += agg[i]
  if (aggSum <= 0) return null
  const blended = staticTiers.map((t, i) => ({
    lev: t.lev,
    w: CALIB_BLEND * (agg[i] / aggSum) + (1 - CALIB_BLEND) * t.w,
  }))
  const s = blended.reduce((a, t) => a + t.w, 0)
  return blended.map(t => ({ lev: t.lev, w: t.w / s }))
}
```

3c. Add the aggregate-OI fetcher (below the Bybit fallback helpers):

```js
// ── Multi-venue open interest (current snapshot, $ notional) ────────────────
// Sizes the SEED cohorts with the real standing OI across the four venues we
// can read keylessly, instead of the old `1.5 × window volume` guess. Each leg
// fails soft; zero legs up → caller falls back to the volume heuristic.
const OKX_API = 'https://www.okx.com'
const HL_API = 'https://api.hyperliquid.xyz'

async function fetchAggregateOiUsd(symbol, lastClose, exchange = 'All') {
  const asset = symbolToAsset(symbol)
  const want = (name) => exchange === 'All' || exchange.toLowerCase() === name
  const legs = []
  const names = []
  if (want('binance')) {
    names.push('binance')
    legs.push(fetchJSON(`${BINANCE_FUT}/fapi/v1/openInterest?symbol=${symbol}`)
      .then(j => Number(j.openInterest) * lastClose))
  }
  if (want('bybit')) {
    names.push('bybit')
    legs.push(fetchJSON(`${BYBIT_FUT}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=1`)
      .then(j => Number(j?.result?.list?.[0]?.openInterest) * lastClose))
  }
  if (want('okx')) {
    names.push('okx')
    legs.push(fetchJSON(`${OKX_API}/api/v5/public/open-interest?instType=SWAP&instId=${asset}-USDT-SWAP`)
      .then(j => Number(j?.data?.[0]?.oiCcy) * lastClose))
  }
  if (exchange === 'All') {
    names.push('hyperliquid')
    legs.push((async () => {
      const res = await fetch(`${HL_API}/info`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`hl ${res.status}`)
      const [meta, ctxs] = await res.json()
      const idx = (meta?.universe || []).findIndex(u => u.name === asset)
      if (idx < 0) throw new Error('hl asset not listed')
      return Number(ctxs?.[idx]?.openInterest) * lastClose
    })())
  }
  const settled = await Promise.allSettled(legs)
  const byVenue = {}
  let total = 0
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && Number.isFinite(r.value) && r.value > 0) {
      byVenue[names[i]] = r.value
      total += r.value
    }
  })
  return { total, venues: Object.keys(byVenue), byVenue }
}
```

3d. Signature + exchange preference. Change the builder signature:

```js
export async function buildBinanceLiqHeatmap(symbol = 'BTCUSDT', timeframe = '3d', { exchange = 'All' } = {}) {
```

Give the two fallback helpers a `preferBybit` flag and thread it:

```js
async function fetchKlinesWithFallback(symbol, interval, limit, preferBybit = false) {
  const binance = () => fetchJSON(`${BINANCE_FUT}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  const bybit = async () => {
    const bi = BYBIT_KLINE_INTERVAL[interval] || '60'
    const j = await fetchJSON(`${BYBIT_FUT}/v5/market/kline?category=linear&symbol=${symbol}&interval=${bi}&limit=${Math.min(limit, 1000)}`)
    const list = j?.result?.list
    if (!Array.isArray(list) || list.length === 0) throw new Error('Bybit klines empty')
    return list.slice().reverse().map(r => [Number(r[0]), r[1], r[2], r[3], r[4], r[5], Number(r[0]) + 1, r[6]])
  }
  if (preferBybit) { try { return await bybit() } catch { return await binance() } }
  try { return await binance() } catch { return await bybit() }
}
```

(Same restructure for `fetchLSRatioWithFallback` — Binance leg and Bybit leg become named inner functions, order flipped by `preferBybit`; the Bybit LS leg keeps its `.catch(() => null)` + empty-array fallback exactly as today.)

In the builder: `const preferBybit = exchange === 'Bybit'`, pass it to both helpers.

3e. Wire the seed + calibration inside the builder. After the VP block (`let vpSum = ...`) and before `── Build cohorts ──`, replace:

```js
  let totalQVol = 0
  for (let i = 0; i < cols; i++) totalQVol += quoteVol[i]
  const seedTotal = totalQVol * 1.5
```

with:

```js
  let totalQVol = 0
  for (let i = 0; i < cols; i++) totalQVol += quoteVol[i]
  const aggOi = await fetchAggregateOiUsd(symbol, close[cols - 1], exchange)
    .catch(() => ({ total: 0, venues: [], byVenue: {} }))
  // Real standing OI when we have it; the old volume heuristic when all venues fail.
  const seedTotal = aggOi.total > 0 ? aggOi.total : totalQVol * 1.5

  // Tape-calibrated leverage mix (6h cache per asset; weights are a leverage
  // DISTRIBUTION, so reusing them across timeframes is sound).
  let longTiers = LEV_TIERS
  let shortTiers = LEV_TIERS
  let calibSource = 'static'
  try {
    const asset = symbolToAsset(symbol)
    const cachedCal = _calibCache.get(asset)
    if (cachedCal && Date.now() - cachedCal.ts < CALIB_TTL) {
      longTiers = cachedCal.long
      shortTiers = cachedCal.short
      calibSource = cachedCal.source
    } else {
      const tapeEvents = await fetchTapeEvents(asset, 72)
      const lt = calibrateSideTiers(tapeEvents, 'long', binOf, VP, rows, LEV_TIERS)
      const st = calibrateSideTiers(tapeEvents, 'short', binOf, VP, rows, LEV_TIERS)
      if (lt) longTiers = lt
      if (st) shortTiers = st
      calibSource = (lt || st) ? 'tape' : 'static'
      _calibCache.set(asset, { long: longTiers, short: shortTiers, source: calibSource, ts: Date.now() })
    }
  } catch { /* static tiers */ }
```

Module-level, next to the other constants:

```js
const _calibCache = new Map() // asset → { long, short, source, ts }
const CALIB_TTL = 6 * 3600_000
```

3f. Use the calibrated tiers in the accumulation loops: in the `Long tiers` loop replace `LEV_TIERS[li]` → `longTiers[li]` and `LEV_TIERS.length` → `longTiers.length`; in the `Short tiers` loop `LEV_TIERS[si]` → `shortTiers[si]` etc. (`mkCohort`'s `Uint8Array(LEV_TIERS.length)` can stay — all tier arrays share the ladder length.)

3g. Extend `_stats` in the return:

```js
      calibration: calibSource,
      oi_venues: aggOi.venues,
      seed_total_usd: Math.round(seedTotal),
```

3h. Pass `exchange` through both callers:
- `charts-proxy.js` line ~113: `const hm = await buildBinanceLiqHeatmap(symbol, interval, { exchange })`
- `packages/server/index.js` liq-heatmap route: same one-line change.

- [ ] **Step 4: Run tests**

Run: `node apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs && node apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs`
Expected: both OK.

- [ ] **Step 5: Verify live build output** (restart dev server first)

Run: `curl -s 'http://localhost:3001/api/charts/liq-heatmap?symbol=BTCUSDT&interval=3d' | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('_stats',{}); print('source:',d.get('_source'),'calib:',s.get('calibration'),'venues:',s.get('oi_venues'),'seed:',s.get('seed_total_usd'),'cells:',s.get('total_cells'))"`
Expected: `calib: tape`, `venues:` ≥2 of `['binance','bybit','okx','hyperliquid']`, `seed:` in the tens of billions for BTC, cells > 0.

Also: `curl -s 'http://localhost:3001/api/charts/liq-heatmap?symbol=BTCUSDT&interval=3d&exchange=Bybit'` → still returns a populated grid (Bybit-preferred path works).

- [ ] **Step 6: Build**

Run: `npm run build:research`
Expected: clean, `[check-critical-path] OK`

---

### Task 4: Client data plumbing — prints fetch + exchange state

**Files:**
- Modify: `apps/research/src/pages/traders-corner/tradersCornerApi.js` (add after `getExternalLiqHeatmap`, ~line 758)
- Modify: `apps/research/src/pages/liquidation-heatmap/components/use-real-heatmap.js`
- Modify: `apps/research/src/pages/liquidation-heatmap/components/liquidation-page.jsx:463` and the two `<HeatmapView>` sites (lines ~648, ~871)

**Interfaces:**
- Produces: `getLiqPrints(symbol, hours) → Promise<{events, count, truncated, window_covered_hours}>` in tradersCornerApi.
- `useRealHeatmap(symbol, defaultExchange = 'All', enabled)` now ALSO returns `{ printsData, exchange, setExchange }`. `exchange ∈ 'All'|'Binance'|'Bybit'|'OKX'`.
- HeatmapView receives new props: `printsData`, `exchange`, `setExchange`.

- [ ] **Step 1: `getLiqPrints` in tradersCornerApi.js**

```js
export async function getLiqPrints(symbol = 'BTCUSDT', hours = 72) {
  return cached(`liq-prints-${symbol}-${hours}`, 60_000, async () => {
    const data = await fetchJSON(`/api/charts/liq-prints?symbol=${symbol}&hours=${hours}`)
    if (!data.success) throw new Error('Liq prints failed')
    return data
  })
}
```

- [ ] **Step 2: `use-real-heatmap.js` changes**

2a. Import: `import { getExternalLiqHeatmap, getExternalExchangeList, getLiqPrints } from '@/pages/traders-corner/tradersCornerApi'`

2b. Add `hours` to every `ALL_TIMEFRAMES` entry:

```js
const ALL_TIMEFRAMES = [
  { key: '12h', label: '12H', api: '12h', klineInterval: '15m', klineLimit: 500, hours: 12 },
  { key: '1d',  label: '1D',  api: '1d',  klineInterval: '15m', klineLimit: 500, hours: 24 },
  { key: '3d',  label: '3D',  api: '3d',  klineInterval: '30m', klineLimit: 500, hours: 72 },
  { key: '1w',  label: '1W',  api: '1w',  klineInterval: '1h',  klineLimit: 500, hours: 168 },
  { key: '2w',  label: '2W',  api: '2w',  klineInterval: '2h',  klineLimit: 500, hours: 336 },
  { key: '1M',  label: '1M',  api: '1M',  klineInterval: '4h',  klineLimit: 500, hours: 720 },
  { key: '3M',  label: '3M',  api: '3M',  klineInterval: '12h', klineLimit: 500, hours: 2160 },
  { key: '6M',  label: '6M',  api: '6M',  klineInterval: '1d',  klineLimit: 500, hours: 4320 },
  { key: '1y',  label: '1Y',  api: '1y',  klineInterval: '1d',  klineLimit: 500, hours: 8760 },
]
```

2c. Hook signature + state (rename the param, add state; existing callers pass `'Binance'` positionally — update the page in Step 3):

```js
export default function useRealHeatmap(symbol, defaultExchange = 'All', enabled = true) {
  ...
  const [printsData, setPrintsData] = useState(null)
  const [exchange, setExchange] = useState(defaultExchange)
```

2d. In `fetchData`, the model request maps OKX→All (OKX has no model source; prints filter handles it client-side), and prints ride the same Promise.all fail-soft:

```js
      const tf = TIMEFRAMES.find(t => t.key === timeframe)
      if (!tf) return
      const apiTf = tf.api
      const modelExchange = exchange === 'OKX' ? 'All' : exchange
      const printsHours = Math.min(tf.hours || 72, 168)

      const [hm, kl, pr] = await Promise.all([
        getExternalLiqHeatmap(modelExchange, symbol, apiTf),
        getExternalExchangeList('Binance', symbol, tf.klineInterval || '30m', tf.klineLimit || 500),
        getLiqPrints(symbol, printsHours).catch(() => null),
      ])

      if (!isCancelled()) {
        setHeatmapData(hm)
        setKlineData(kl)
        setPrintsData(pr)
        setLoading(false)
      }
```

Add `exchange` to the `fetchData` useCallback deps (`[symbol, exchange, timeframe, enabled, isMajor, TIMEFRAMES]` — keep existing deps and add `exchange`).

2e. Return `printsData, exchange, setExchange` from the hook.

Note: `getExternalLiqHeatmap`'s cache key already includes exchange, so toggling re-fetches correctly. Server treats unknown exchange values safely (only `'Bybit'` flips source preference; `'All'`/`'Binance'` behave as before).

- [ ] **Step 3: Page pass-through** (`liquidation-page.jsx`)

Line 463: `const realHeatmap = useRealHeatmap(fullSymbol, 'All', activeView === 'heatmap')`

Both `<HeatmapView ...>` sites currently spread individual props from `realHeatmap` — add to BOTH:

```jsx
  printsData={realHeatmap.printsData}
  exchange={realHeatmap.exchange}
  setExchange={realHeatmap.setExchange}
```

(Check how existing props are passed at lines 648-656 and 871-879 and match the pattern exactly — if they spread `{...realHeatmap}` the new fields ride along free.)

- [ ] **Step 4: Build**

Run: `npm run build:research`
Expected: clean. (UI unchanged so far — renderer ignores the new data until Task 5.)

---

### Task 5: Renderer rewrite — `real-heatmap-chart.js`

**Files:**
- Modify: `apps/research/src/pages/liquidation-heatmap/components/real-heatmap-chart.js`

**Interfaces:**
- `drawRealHeatmap(canvas, dims, data, klines, mouse, view, fmtPrice, opts)` — `opts` gains: `dayMode: bool`, `prints: {events, window_covered_hours}|null`, `showPrints: bool`, `exchangeFilter: 'binance'|'bybit'|'okx'|null`, `pins: number[]` (prices).
- Return value gains geometry the view needs for click-to-pin: `{ chartL, chartR, chartW, chartT, chartB, sidebarW, priceAxisW, minP, maxP }` (minP/maxP are POST-zoom, so `yToPrice` can be reproduced by the caller: `price = minP + (1 - (y - chartT)/(chartB - chartT)) * (maxP - minP)`).

- [ ] **Step 1: Dual color ramps + theme tokens**

Replace the single `RAMP` + static LUT (lines 12-53) with two ramps and two prebaked LUTs:

```js
// ─── Color ramps: CoinGlass-style navy → blue → cyan → green → yellow ───
// Dark ramp floors at the app void so empty field reads as background; only
// liquidation density lights up. Day ramp floors at the light page surface
// and peaks amber so bands stay readable on white.
const RAMP_DARK = [
  [9, 9, 11],      // 0.00 void floor
  [15, 17, 44],    // 0.10 deep navy
  [22, 30, 82],    // 0.20 indigo
  [24, 52, 124],   // 0.30 blue
  [20, 90, 155],   // 0.40 cyan-blue
  [18, 132, 158],  // 0.50 cyan
  [24, 168, 136],  // 0.60 teal
  [80, 194, 96],   // 0.70 green
  [158, 214, 56],  // 0.82 lime
  [220, 226, 40],  // 0.92 yellow
  [253, 240, 80],  // 1.00 bright yellow peak
]
const RAMP_DAY = [
  [246, 247, 249],
  [228, 233, 244],
  [200, 214, 238],
  [158, 188, 230],
  [110, 158, 216],
  [70, 132, 198],
  [46, 148, 152],
  [70, 172, 96],
  [156, 190, 44],
  [216, 176, 24],
  [245, 158, 11],
]
function bakeLut(ramp) {
  const lut = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    const idx = t * (ramp.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, ramp.length - 1)
    const f = idx - lo
    lut[i * 3] = Math.round(ramp[lo][0] + (ramp[hi][0] - ramp[lo][0]) * f)
    lut[i * 3 + 1] = Math.round(ramp[lo][1] + (ramp[hi][1] - ramp[lo][1]) * f)
    lut[i * 3 + 2] = Math.round(ramp[lo][2] + (ramp[hi][2] - ramp[lo][2]) * f)
  }
  return lut
}
const LUT_DARK = bakeLut(RAMP_DARK)
const LUT_DAY = bakeLut(RAMP_DAY)
```

Replace the flat design-token constants (lines 118-130) with two theme objects selected once at the top of `drawRealHeatmap`:

```js
const THEME_DARK = {
  bg: '#09090b', fieldFloor: '#09090b',
  textPrimary: 'rgba(245, 245, 247, 0.9)', textSecondary: 'rgba(245, 245, 247, 0.5)',
  textMuted: 'rgba(245, 245, 247, 0.35)',
  borderSubtle: 'rgba(255, 255, 255, 0.04)', borderDefault: 'rgba(255, 255, 255, 0.06)',
  gridLine: 'rgba(255, 255, 255, 0.03)',
  panelBg: 'rgba(9, 9, 11, 0.92)', panelBgHeavy: 'rgba(9, 9, 11, 0.95)', tipBg: 'rgba(9, 9, 11, 0.88)',
  bull: '#10B981', bear: '#EF4444',
  amber: 'rgba(245, 158, 11, 0.85)', amberBg: 'rgba(245, 158, 11, 0.9)', amberText: '#09090b',
  candleOutline: 'rgba(0, 0, 0, 0.6)', candleBodyOutline: 'rgba(0, 0, 0, 0.5)',
  crosshair: 'rgba(245, 245, 247, 0.15)',
  printStroke: 'rgba(255, 255, 255, 0.55)',
  pinLine: 'rgba(245, 245, 247, 0.45)', pinBg: 'rgba(9, 9, 11, 0.9)',
  lut: LUT_DARK, dark: true,
}
const THEME_DAY = {
  bg: '#ffffff', fieldFloor: '#f6f7f9',
  textPrimary: 'rgba(15, 23, 42, 0.92)', textSecondary: 'rgba(71, 85, 105, 0.9)',
  textMuted: 'rgba(100, 116, 139, 0.7)',
  borderSubtle: 'rgba(15, 23, 42, 0.06)', borderDefault: 'rgba(15, 23, 42, 0.1)',
  gridLine: 'rgba(15, 23, 42, 0.05)',
  panelBg: 'rgba(255, 255, 255, 0.92)', panelBgHeavy: 'rgba(255, 255, 255, 0.96)', tipBg: 'rgba(255, 255, 255, 0.94)',
  bull: '#059669', bear: '#DC2626',
  amber: 'rgba(217, 119, 6, 0.9)', amberBg: 'rgba(217, 119, 6, 0.95)', amberText: '#ffffff',
  candleOutline: 'rgba(255, 255, 255, 0.7)', candleBodyOutline: 'rgba(255, 255, 255, 0.55)',
  crosshair: 'rgba(15, 23, 42, 0.25)',
  printStroke: 'rgba(15, 23, 42, 0.4)',
  pinLine: 'rgba(15, 23, 42, 0.45)', pinBg: 'rgba(255, 255, 255, 0.95)',
  lut: LUT_DAY, dark: false,
}
```

Top of `drawRealHeatmap`: `const T = opts?.dayMode ? THEME_DAY : THEME_DARK` — then mechanically replace every use of `BG_VOID/TEXT_*/BORDER_*/BULL/BEAR/AMBER*/FIELD_FLOOR_CSS/COLOR_LUT` and the hardcoded `rgba(9, 9, 11, …)` panel fills through the whole file with the `T.` equivalents. The watermark call becomes `drawSpectreWatermark(ctx, { w, h, dark: T.dark, ghost: false })`.

- [ ] **Step 2: Sharper field**

In the field-paint block (lines 261-303):
- `const COLOR_GAMMA = 0.5` → `0.7` (less low-end lift → bands separate from field)
- Add a low cut so faint smear drops to the floor. Before the pixel loop: `const lowCut = fieldMax * 0.015`, and in the loop: `const v0 = field[rowOff + ix]; const v = v0 > lowCut ? v0 : 0`
- Keep `blurFieldH(field, fieldW, fieldH, 1)` and the bilinear upscale (they provide horizontal continuity, not the mushiness — the mush was gamma 0.5).

- [ ] **Step 3: Prints overlay layer** (insert AFTER the candlestick layer, BEFORE the current-price line; also declare `let printHits = []` before it and use it later in the crosshair block)

```js
  // ═══════════════════════════════════════════════════
  // LAYER 2b: REAL liquidation prints (Spectre tape — Bybit full feed + OKX)
  // ═══════════════════════════════════════════════════
  let printHits = []
  const printEvents = opts?.showPrints !== false && opts?.prints?.events?.length ? opts.prints.events : null
  if (printEvents) {
    const exFilter = opts?.exchangeFilter || null
    const inView = []
    for (const e of printEvents) {
      if (exFilter && e.ex !== exFilter) continue
      if (e.t < hmStartTs || e.t > hmEndTs) continue
      const x = chartL + ((e.t - hmStartTs) / hmSpan) * chartW
      const y = priceToY(e.p)
      if (y < chartT || y > chartB) continue
      inView.push({ x, y, e })
    }
    // Cap to the 600 largest in view; draw big→small so small stay visible on top.
    inView.sort((a, b) => b.e.usd - a.e.usd)
    printHits = inView.slice(0, 600)
    for (let i = 0; i < printHits.length; i++) {
      const d = printHits[i]
      // $100 → ~1.5px, $10k → ~4.7px, $1M → ~8px, clamp 10
      const r = Math.max(1.5, Math.min(10, 1.5 + (Math.log10(d.e.usd) - 2) * 1.6))
      const isLong = d.e.side === 'long'
      ctx.beginPath()
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
      ctx.fillStyle = isLong
        ? (T.dark ? 'rgba(239, 68, 68, 0.55)' : 'rgba(220, 38, 38, 0.5)')
        : (T.dark ? 'rgba(16, 185, 129, 0.55)' : 'rgba(5, 150, 105, 0.5)')
      ctx.fill()
      ctx.lineWidth = 0.75
      ctx.strokeStyle = T.printStroke
      ctx.stroke()
    }
    // Honest window caption when the tape covers less than the visible range.
    const visHours = hmSpan / 3600_000
    const covered = opts?.prints?.window_covered_hours || 0
    if (covered > 0 && visHours > covered * 1.25) {
      ctx.font = `9px ${FONT_MONO}`
      ctx.fillStyle = T.textMuted
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`prints: last ${Math.round(covered)}h`, chartL + 8, chartB - 6)
    }
  }
```

- [ ] **Step 4: Pinned levels layer** (insert AFTER the current-price line block)

```js
  // ═══════════════════════════════════════════════════
  // LAYER 2c: pinned levels (click-to-pin)
  // ═══════════════════════════════════════════════════
  const pins = Array.isArray(opts?.pins) ? opts.pins : []
  if (pins.length) {
    // Standing $ at a level = latest visible column's field value around that row.
    const lastCol = vEnd - vStart
    const standingAt = (price) => {
      const r = Math.floor((price - (priceArray ? priceArray[0] : minP)) / tickSize)
      let sum = 0
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr
        if (rr >= 0 && rr < rows) sum += field[rr * fieldW + lastCol]
      }
      return sum
    }
    ctx.font = `bold 10px ${FONT_MONO}`
    for (const price of pins) {
      const y = priceToY(price)
      if (y < chartT || y > chartB) continue
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = T.pinLine
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(chartL, y)
      ctx.lineTo(sideR, y)
      ctx.stroke()
      ctx.setLineDash([])
      const label = `${priceFmt(price)} · ${fmtK(standingAt(price))}`
      const tw = ctx.measureText(label).width
      const bx = chartR - tw - 22
      ctx.fillStyle = T.pinBg
      ctx.beginPath()
      ctx.roundRect(bx, y - 10, tw + 18, 20, 4)
      ctx.fill()
      ctx.strokeStyle = T.borderDefault
      ctx.lineWidth = 0.5
      ctx.stroke()
      ctx.fillStyle = T.textPrimary
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + 6, y)
      // small × affordance
      ctx.fillStyle = T.textMuted
      ctx.fillText('×', bx + tw + 9, y)
    }
  }
```

(Note: `field`/`fieldW` are already in scope from the field-paint block; this layer must live in the same function scope — it does, everything is inside `drawRealHeatmap`.)

- [ ] **Step 5: Tooltip upgrade** (inside the existing crosshair block)

5a. Bubble hover takes priority. At the top of the crosshair block, after `const my = mouse.y`:

```js
    // Nearest print bubble within 8px wins the tooltip.
    let hoverPrint = null
    let bestD = 8
    for (const d of printHits) {
      const dist = Math.hypot(d.x - mx, d.y - my)
      if (dist < bestD) { bestD = dist; hoverPrint = d }
    }
```

5b. Replace the `tipLines` construction with:

```js
    const tipLines = []
    if (hoverPrint) {
      const e = hoverPrint.e
      const td = new Date(e.t)
      tipLines.push({ label: 'REAL LIQUIDATION', value: '', dim: true })
      tipLines.push({ label: e.ex.toUpperCase(), value: e.side === 'long' ? 'LONG REKT' : 'SHORT REKT' })
      tipLines.push({ label: 'Size', value: fmtK(e.usd), highlight: true })
      tipLines.push({ label: 'Price', value: priceFmt(e.p) })
      tipLines.push({
        label: td.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + ', ' +
          td.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        value: '', dim: true,
      })
    } else {
      if (curTime) {
        const td = new Date(curTime)
        tipLines.push({
          label: td.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + ', ' +
            td.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          value: '', dim: true,
        })
      }
      tipLines.push({ label: 'Price', value: priceFmt(curPrice) })
      tipLines.push({ label: 'Liq Value', value: fmtK(curVal), highlight: curVal > maxVal * 0.5 })
      // Cumulative liq $ between the CURRENT price and the hovered level, in
      // the hovered column — "how much fuel between here and there".
      {
        const colIdx = curCol - vStart
        const curPriceRow = Math.floor((lastPrice - (priceArray ? priceArray[0] : minP)) / tickSize)
        const lo = Math.min(curPriceRow, curRow)
        const hi = Math.max(curPriceRow, curRow)
        let cum = 0
        for (let r = Math.max(0, lo); r <= Math.min(rows - 1, hi); r++) cum += field[r * fieldW + colIdx]
        tipLines.push({
          label: curPrice < lastPrice ? 'Cum. longs to here' : 'Cum. shorts to here',
          value: fmtK(cum),
        })
      }
    }
```

(The `curVal` linear grid scan at lines 601-606 can stay — or read `field[curRow * fieldW + (curCol - vStart)]` directly, which is faster and already in scope. Use the field read; delete the scan.)

- [ ] **Step 6: Geometry return**

Change the final return to:

```js
  return { chartL, chartR, chartW, chartT, chartB, sidebarW, priceAxisW, minP, maxP }
```

- [ ] **Step 7: Build**

Run: `npm run build:research`
Expected: clean. Page still renders (opts fields all optional — HeatmapView passes them in Task 6).

---

### Task 6: View controls — prints toggle, exchange pills, click-to-pin + CSS

**Files:**
- Modify: `apps/research/src/pages/liquidation-heatmap/components/heatmap-view.jsx`
- Modify: `apps/research/src/pages/liquidation-heatmap/components/liquidation-page.css` (append)

**Interfaces:**
- Consumes: `printsData`, `exchange`, `setExchange` props (Task 4); renderer `opts` + geometry return (Task 5).

- [ ] **Step 1: State + draw wiring** (`heatmap-view.jsx`)

Props: add `printsData, exchange, setExchange` to the destructured props (line 6-11), with `dayMode` already there.

State + refs near the top:

```js
  const [showPrints, setShowPrints] = useState(true)
  const [pins, setPins] = useState([])
  const geomRef = useRef(null)          // last draw geometry (for click→price)
  const downPosRef = useRef(null)       // mousedown pos to tell click from drag
```

Main render effect (line 123-130) becomes:

```js
  useEffect(() => {
    if (!canvasRef.current || !heatmapData) return
    geomRef.current = drawRealHeatmap(
      canvasRef.current, dims, heatmapData, klineData,
      mouse, viewRef.current, fmtPrice,
      {
        hideSidebar: dims.w <= 500,
        dayMode,
        prints: printsData,
        showPrints,
        exchangeFilter: exchange && exchange !== 'All' ? exchange.toLowerCase() : null,
        pins,
      }
    )
  }, [heatmapData, klineData, dims, mouse, fmtPrice, viewTick, dayMode, printsData, showPrints, exchange, pins])
```

- [ ] **Step 2: Click-to-pin.** Extend `onMouseDown` to record the position, and add a click handler on mouseup:

```js
  const onMouseDown = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    downPosRef.current = { x, y }
    const region = getRegion(x, y)
    viewRef.current = { ...viewRef.current, dragging: true, dragX: e.clientX, dragY: e.clientY, dragRegion: region }
  }, [getRegion])

  const onMouseUp = useCallback((e) => {
    viewRef.current = { ...viewRef.current, dragging: false, dragRegion: null }
    // Click (not drag) inside the chart body → toggle a pinned level.
    const rect = canvasRef.current?.getBoundingClientRect()
    const down = downPosRef.current
    downPosRef.current = null
    if (!rect || !down || !geomRef.current) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (Math.hypot(x - down.x, y - down.y) > 4) return          // it was a drag
    const g = geomRef.current
    if (x < g.chartL || x > g.chartR || y < g.chartT || y > g.chartB) return
    const price = g.minP + (1 - (y - g.chartT) / (g.chartB - g.chartT)) * (g.maxP - g.minP)
    // Near an existing pin (±8px) → unpin it; otherwise pin the new level.
    const pxPerPrice = (g.chartB - g.chartT) / (g.maxP - g.minP)
    setPins(prev => {
      const nearIdx = prev.findIndex(p => Math.abs(p - price) * pxPerPrice < 8)
      if (nearIdx >= 0) return prev.filter((_, i) => i !== nearIdx)
      return [...prev, price]
    })
  }, [])
```

Clear pins when the symbol changes (they're price levels of THAT asset):

```js
  useEffect(() => { setPins([]) }, [fullSymbol])
```

- [ ] **Step 3: Header controls.** After the timeframe dropdown (line ~434), before `liqp-hm-spacer`:

```jsx
        {/* Exchange filter pills */}
        <div className="liqp-hm-ex-pills">
          {['All', 'Binance', 'Bybit', 'OKX'].map(ex => (
            <button
              key={ex}
              className={`liqp-hm-ex-pill${exchange === ex ? ' active' : ''}`}
              onClick={() => setExchange?.(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        {exchange === 'OKX' && <span className="liqp-hm-model-note">model: all venues</span>}

        {/* Real prints toggle */}
        <button
          className={`liqp-hm-prints-btn${showPrints ? ' active' : ''}${!printsData?.events?.length ? ' disabled' : ''}`}
          title={printsData?.events?.length ? 'Real liquidations overlay' : 'No real liquidation data for this asset'}
          onClick={() => printsData?.events?.length && setShowPrints(v => !v)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="7" r="2.4" opacity="0.9"/><circle cx="8.6" cy="4" r="1.6" opacity="0.6"/></svg>
          <span>Liqs</span>
        </button>
```

- [ ] **Step 4: CSS** (append to `liquidation-page.css`, follow the existing `liqp-hm-*` header-button styles for exact colors — copy the `liqp-hm-dropdown-btn` pattern):

```css
/* ── Heatmap 2.0 header controls ── */
.liqp-hm-ex-pills { display: flex; gap: 2px; padding: 2px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-default); border-radius: 8px; }
.liqp-hm-ex-pill { padding: 3px 8px; font-size: 10.5px; font-weight: 500; color: var(--text-tertiary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: all var(--duration-fast) var(--ease-out); }
.liqp-hm-ex-pill:hover { color: var(--text-primary); }
.liqp-hm-ex-pill.active { color: var(--text-primary); background: rgba(255, 255, 255, 0.08); }
.liqp-hm-model-note { font-size: 9.5px; color: var(--text-muted); white-space: nowrap; }
.liqp-hm-prints-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; font-size: 10.5px; font-weight: 500; color: var(--text-tertiary); background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-default); border-radius: 8px; cursor: pointer; transition: all var(--duration-fast) var(--ease-out); }
.liqp-hm-prints-btn:hover { color: var(--text-primary); border-color: var(--border-strong); }
.liqp-hm-prints-btn.active { color: var(--text-primary); background: rgba(255, 255, 255, 0.08); }
.liqp-hm-prints-btn.disabled { opacity: 0.4; cursor: default; }

/* Day mode */
.app.app-day-mode .liqp-hm-ex-pills { background: rgba(15, 23, 42, 0.04); border-color: rgba(15, 23, 42, 0.08); }
.app.app-day-mode .liqp-hm-ex-pill { color: #64748b; }
.app.app-day-mode .liqp-hm-ex-pill:hover, .app.app-day-mode .liqp-hm-ex-pill.active { color: #0f172a; }
.app.app-day-mode .liqp-hm-ex-pill.active { background: rgba(15, 23, 42, 0.08); }
.app.app-day-mode .liqp-hm-model-note { color: #94a3b8; }
.app.app-day-mode .liqp-hm-prints-btn { color: #64748b; background: rgba(15, 23, 42, 0.04); border-color: rgba(15, 23, 42, 0.08); }
.app.app-day-mode .liqp-hm-prints-btn:hover, .app.app-day-mode .liqp-hm-prints-btn.active { color: #0f172a; }
.app.app-day-mode .liqp-hm-prints-btn.active { background: rgba(15, 23, 42, 0.08); }
```

On mobile the header is tight — add to the page's mobile CSS section (or `liquidation-page.mobile.css` if the header rules live there): hide the pills at ≤560px (`.liqp-hm-ex-pills { display: none; }`) — prints toggle stays.

- [ ] **Step 5: Build**

Run: `npm run build:research`
Expected: clean, `[check-critical-path] OK`

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Tests + build**

Run: `node apps/research/api/_lib/handlers/__tests__/liq-tape.test.mjs && node apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs && npm run build:research`
Expected: both tests OK, build clean, `[check-critical-path] OK`.

- [ ] **Step 2: Endpoint checks** (dev server restarted)

```bash
curl -s 'http://localhost:3001/api/charts/liq-heatmap?symbol=BTCUSDT&interval=3d' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['_stats'])"
curl -s 'http://localhost:3001/api/charts/liq-prints?symbol=BTCUSDT&hours=72' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['count'], d['window_covered_hours'])"
curl -s 'http://localhost:3001/api/charts/liq-heatmap?symbol=ETHUSDT&interval=1w&exchange=Bybit' | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['data']['liqHeatMap']['data']))"
```
Expected: `_stats` shows `calibration: 'tape'`, ≥2 `oi_venues`; prints count in the hundreds-to-1500; Bybit variant returns a populated grid.

- [ ] **Step 3: Browser pass** (Chrome extension tools, `http://localhost:5180/liquidation-heatmap`)

Checklist — each item observed, with screenshots:
1. BTC 3D: sharp navy→cyan→yellow bands (not blurry green wash), candles readable on top.
2. Prints bubbles visible; "Liqs" toggle hides/shows them.
3. Hover a band cell → tooltip shows Price / Liq Value / "Cum. longs|shorts to here".
4. Hover a bubble → REAL LIQUIDATION tooltip with exchange, side, size.
5. Click a band → pinned dashed line with `price · $` label; click it again → unpins. Zoom/pan does not misplace pins.
6. Exchange pills: Bybit re-fetches model; OKX shows "model: all venues" note and filters bubbles to OKX only.
7. Timeframe 1M on BTC: "prints: last ~168h" caption appears (tape shallower than window).
8. ETH + SOL + one thin alt (e.g. from the symbol dropdown): all render; thin alt with no tape events → no bubbles, toggle disabled, no errors.
9. Day mode: light ramp, readable axes/tooltip/pills.
10. Zoom (wheel + buttons + price-axis drag), pan, fullscreen still work.
11. Console: zero errors (`read_console_messages` with level error).
12. Mobile width (~430px, via responsive mode): pills hidden, chart renders, no layout break.

- [ ] **Step 4: CoinGlass sanity comparison**

Open CoinGlass BTC liquidation heatmap side by side; major band positions should agree within ~1 price bin. Note any systematic disagreement in the summary (it's a model — positions matter, exact magnitudes don't).

- [ ] **Step 5: Report**

Summarize for Evgeniy: what changed, `_stats` evidence (calibration source, venues), screenshots, and the explicit reminder that nothing is committed.

---

## Self-Review Notes

- Spec coverage: model upgrade (T3), prints endpoint (T1+T2), renderer/colormap/sharp/overlay/tooltip/pins/right-profile*/exchange toggle (T5+T6), degradation (T1-T5 fail-soft), verification (T7). *Right profile: the existing sidebar bars are kept and re-themed via the `T.` token sweep in T5 Step 1 — the spec's "rebuilt sharp" is satisfied by the theme + the existing bucket bars; no structural change needed.
- Type consistency: `{t, p, side, usd, ex}` event shape used identically in liq-tape.js, endpoints, tradersCornerApi, renderer. `exchange` prop values `'All'|'Binance'|'Bybit'|'OKX'` (display case) → lowercased once at the draw-call site for `exchangeFilter` and matched against lowercased `ex` from the tape.
- Known simplification: OKX pill filters prints only (model stays aggregate, labeled in UI) — per spec.
