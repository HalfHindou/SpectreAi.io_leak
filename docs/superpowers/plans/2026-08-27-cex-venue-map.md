# CEX Venue Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve chart bars from Binance/Bybit/OKX for the ~226 top-500 tokens whose Binance pair the hand-written registry never knew, without changing any chart that renders correctly today.

**Architecture:** `lookupBinancePair()` keeps its exact current behaviour. When it returns `null` AND the request carries a `cgId`, a new `resolveCexVenue(cgId)` asks CoinGecko which CEX pair that *specific coin* trades as, caches the answer in KV for 7 days, and a new `cex` tier fetches klines from that venue. The lane is unreachable whenever `lookupBinancePair` succeeds, so "holes only" is structural rather than a convention.

**Tech Stack:** Node ESM, Vercel serverless + Express (one shared handler), Upstash KV, CoinGecko PRO `/coins/{id}/tickers`, Binance/Bybit/OKX public kline APIs. Tests are plain `node:assert` scripts run with `node <path>` — no test runner in this repo.

**Spec:** `.claude/rules/cex-venue-map-plan.md`

## Global Constraints

- **No TypeScript.** `.js` / `.mjs` only in this tree.
- **Holes only.** No code path may run the CEX lane when `ctx.binancePair` is truthy.
- **Venue allowlist is exactly three:** CoinGecko ids `binance`, `bybit_spot`, `okex`. Note the legacy ids — `okx` is not a valid id and returns silently nothing.
- **Quote allowlist is exactly three:** `USDT`, `USD`, `USDC`. No KRW, no EUR (adds 1 token across the top 500 and drags in FX).
- **Every CoinGecko request MUST send a `User-Agent` header.** Without one Cloudflare answers `error code: 1010`, which looks exactly like a 403 plan restriction.
- **A failed fetch is never cached.** Only a clean 200 whose ticker list contains no match may write a negative cache entry.
- **Kill switch:** `CEX_VENUE_MAP=0` must make the whole lane inert.
- Bar shape everywhere is `{ t, o, h, l, c, v }` with `t` in **seconds**, ascending, `o > 0 && c > 0`, all of o/h/l/c finite — matching `_parseKlines` in `binance-bars.js:281`.
- Commit after every task. Do not push; pushing requires its own explicit go from Evgeniy.

---

### Task 1: Venue picking (pure)

**Files:**
- Create: `apps/research/api/_lib/cex-venue-map.js`
- Test: `apps/research/api/_lib/__tests__/cex-venue-map.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `CEX_VENUE_BY_CG_ID` (object, CoinGecko exchange id → internal venue name), `CEX_EXCHANGE_IDS` (string), `CEX_QUOTES` (Set), `pickCexVenue(tickers) -> { venue, base, target, volUsd } | null`. `venue` is one of `'binance' | 'bybit' | 'okx'`.

- [ ] **Step 1: Write the failing test**

Create `apps/research/api/_lib/__tests__/cex-venue-map.test.mjs`:

```js
// Node tests for pickCexVenue (cex-venue-map.js). Fixtures are REAL rows
// measured from CoinGecko PRO /coins/{id}/tickers on 2026-08-27.
// Run: node apps/research/api/_lib/__tests__/cex-venue-map.test.mjs
import assert from 'node:assert/strict'
import { pickCexVenue } from '../cex-venue-map.js'

let passed = 0
function ok(name, fn) { fn(); passed++; console.log('ok -', name) }

const row = (identifier, base, target, usd, extra = {}) => ({
  base, target,
  market: { name: identifier, identifier },
  converted_volume: { usd },
  is_stale: false, is_anomaly: false,
  ...extra,
})

// hyperliquid, as measured: NOT on Binance, OKX deepest.
const HYPE = [
  row('okex', 'HYPE', 'USDT', 63251281),
  row('bybit_spot', 'HYPE', 'USDT', 57340292),
]

ok('picks the deepest allowlisted venue', () => {
  const p = pickCexVenue(HYPE)
  assert.equal(p.venue, 'okx')
  assert.equal(p.base, 'HYPE')
  assert.equal(p.target, 'USDT')
})

ok('maps legacy CoinGecko ids to internal venue names', () => {
  assert.equal(pickCexVenue([row('okex', 'X', 'USDT', 1)]).venue, 'okx')
  assert.equal(pickCexVenue([row('bybit_spot', 'X', 'USDT', 1)]).venue, 'bybit')
  assert.equal(pickCexVenue([row('binance', 'X', 'USDT', 1)]).venue, 'binance')
})

ok('ignores venues outside the allowlist even at higher volume', () => {
  const p = pickCexVenue([
    row('mxc', 'X', 'USDT', 999999999),
    row('binance', 'X', 'USDT', 1),
  ])
  assert.equal(p.venue, 'binance')
})

ok('rejects non-USD quotes (the official-trump/Upbit KRW case)', () => {
  assert.equal(pickCexVenue([row('binance', 'TRUMP', 'KRW', 999)]), null)
  assert.equal(pickCexVenue([row('binance', 'X', 'EUR', 999)]), null)
})

ok('rejects stale and anomalous rows', () => {
  assert.equal(pickCexVenue([row('binance', 'X', 'USDT', 999, { is_stale: true })]), null)
  assert.equal(pickCexVenue([row('binance', 'X', 'USDT', 999, { is_anomaly: true })]), null)
})

ok('rejects a contract-shaped base (DEX rows must never win)', () => {
  const addr = '0xb2000000000000000000002d0ba3164cc74f58b7'
  assert.equal(pickCexVenue([row('binance', addr, 'USDT', 999)]), null)
})

ok('a row with no converted_volume is still eligible at volUsd 0', () => {
  const p = pickCexVenue([{ base: 'X', target: 'USDT', market: { identifier: 'binance' } }])
  assert.equal(p.venue, 'binance')
  assert.equal(p.volUsd, 0)
})

ok('empty / junk input returns null, never throws', () => {
  assert.equal(pickCexVenue([]), null)
  assert.equal(pickCexVenue(null), null)
  assert.equal(pickCexVenue(undefined), null)
  assert.equal(pickCexVenue([{}, { market: {} }]), null)
})

console.log(`\n${passed} passed`)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/research/api/_lib/__tests__/cex-venue-map.test.mjs`
Expected: FAIL — `Cannot find module '../cex-venue-map.js'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/research/api/_lib/cex-venue-map.js`:

```js
/**
 * CEX venue map — which exchange pair a CoinGecko-listed coin actually trades
 * as, keyed by cgId (never by ticker: a ticker is not an identity).
 *
 * Consulted ONLY when token-registry could not resolve a Binance pair.
 * See .claude/rules/cex-venue-map-plan.md for the measurements behind the
 * allowlist and the trap list.
 */

// CoinGecko exchange ids are LEGACY. `okx`, `coinbase`, `mexc` are not valid
// ids and return silently nothing — always use the left-hand values here.
export const CEX_VENUE_BY_CG_ID = {
  binance: 'binance',
  bybit_spot: 'bybit',
  okex: 'okx',
};

export const CEX_EXCHANGE_IDS = Object.keys(CEX_VENUE_BY_CG_ID).join(',');

// USD-quoted only. Allowing KRW/EUR adds exactly 1 token across the top 500
// and would drag FX conversion into candle prices.
export const CEX_QUOTES = new Set(['USDT', 'USD', 'USDC']);

// A CEX ticker row carries a SYMBOL in `base`; DEX rows can carry a contract.
// The venue allowlist should already exclude those, but this is the cheap
// second lock (spec §J).
const TICKER_SHAPE = /^[A-Z0-9]{1,20}$/;

/**
 * Choose the price-forming venue from a CoinGecko `/tickers` payload's rows.
 * Highest 24h USD volume wins — the same "deepest venue" principle already
 * used for the Codex pool pin.
 *
 * @param {Array} tickers  payload.tickers from /coins/{id}/tickers
 * @returns {{venue: string, base: string, target: string, volUsd: number}|null}
 */
export function pickCexVenue(tickers) {
  if (!Array.isArray(tickers)) return null;
  let best = null;
  for (const t of tickers) {
    const venue = CEX_VENUE_BY_CG_ID[t?.market?.identifier];
    if (!venue) continue;
    if (!CEX_QUOTES.has(t?.target)) continue;
    if (t?.is_stale || t?.is_anomaly) continue;
    const base = typeof t?.base === 'string' ? t.base.toUpperCase() : '';
    if (!TICKER_SHAPE.test(base)) continue;
    const volUsd = Number(t?.converted_volume?.usd) || 0;
    if (!best || volUsd > best.volUsd) best = { venue, base, target: t.target, volUsd };
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node apps/research/api/_lib/__tests__/cex-venue-map.test.mjs`
Expected: PASS, `8 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/research/api/_lib/cex-venue-map.js apps/research/api/_lib/__tests__/cex-venue-map.test.mjs
git commit -m "feat(bars): pick a CEX venue for a coin by cgId, not by ticker"
```

---

### Task 2: Venue resolution with KV cache and honest negative caching

**Files:**
- Modify: `apps/research/api/_lib/cex-venue-map.js` (append)
- Test: `apps/research/api/_lib/__tests__/cex-venue-resolve.test.mjs`

**Interfaces:**
- Consumes: `pickCexVenue` from Task 1; `getJsonWithTTL(key)` / `setJsonWithTTL(key, value, ttlSeconds)` from `./kv.js`.
- Produces: `resolveCexVenue(cgId, deps?) -> Promise<{venue, base, target, volUsd} | null>`. `deps` is `{ fetchFn, kvGet, kvSet }`, all optional, for tests only. Also exports `VENUE_TTL_SEC` (604800), `NEGATIVE_TTL_SEC` (86400), `RESOLVE_TIMEOUT_MS` (1200), `venueCacheKey(cgId)`.

- [ ] **Step 1: Write the failing test**

Create `apps/research/api/_lib/__tests__/cex-venue-resolve.test.mjs`:

```js
// Node tests for resolveCexVenue — cache stickiness and the "a failed fetch is
// not a verdict" rule. No network, no KV: deps are injected.
// Run: node apps/research/api/_lib/__tests__/cex-venue-resolve.test.mjs
import assert from 'node:assert/strict'
import {
  resolveCexVenue, venueCacheKey, VENUE_TTL_SEC, NEGATIVE_TTL_SEC,
} from '../cex-venue-map.js'

let passed = 0
const tests = []
function ok(name, fn) { tests.push([name, fn]) }

process.env.COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || 'test-key'

function fakeKv() {
  const store = new Map()
  return {
    store,
    kvGet: async (k) => (store.has(k) ? store.get(k) : null),
    kvSet: async (k, v) => { store.set(k, v) },
  }
}
const okResponse = (tickers) => ({
  ok: true, status: 200, json: async () => ({ tickers }),
})
const BINANCE_ROW = {
  base: 'MORPHO', target: 'USDT',
  market: { identifier: 'binance' },
  converted_volume: { usd: 4332605 },
  is_stale: false, is_anomaly: false,
}

ok('resolves and writes a 7-day cache entry', async () => {
  const kv = fakeKv()
  let calls = 0
  const fetchFn = async () => { calls++; return okResponse([BINANCE_ROW]) }
  const v = await resolveCexVenue('morpho', { ...kv, fetchFn })
  assert.equal(v.venue, 'binance')
  assert.equal(calls, 1)
  assert.deepEqual(kv.store.get(venueCacheKey('morpho')), { v })
})

ok('second call is served from cache — the pick is sticky', async () => {
  const kv = fakeKv()
  let calls = 0
  const fetchFn = async () => { calls++; return okResponse([BINANCE_ROW]) }
  await resolveCexVenue('morpho', { ...kv, fetchFn })
  const again = await resolveCexVenue('morpho', { ...kv, fetchFn })
  assert.equal(calls, 1, 'must not refetch — a per-request pick flaps between venues')
  assert.equal(again.venue, 'binance')
})

ok('a clean empty answer caches null for 24h', async () => {
  const kv = fakeKv()
  let calls = 0
  let ttlSeen = null
  const fetchFn = async () => { calls++; return okResponse([]) }
  const kvSet = async (k, val, ttl) => { ttlSeen = ttl; kv.store.set(k, val) }
  assert.equal(await resolveCexVenue('nope', { kvGet: kv.kvGet, kvSet, fetchFn }), null)
  assert.equal(ttlSeen, NEGATIVE_TTL_SEC)
  assert.equal(await resolveCexVenue('nope', { kvGet: kv.kvGet, kvSet, fetchFn }), null)
  assert.equal(calls, 1, 'a cached null must not refetch')
})

ok('a thrown fetch returns null and caches NOTHING', async () => {
  const kv = fakeKv()
  const fetchFn = async () => { throw new Error('timeout') }
  assert.equal(await resolveCexVenue('boom', { ...kv, fetchFn }), null)
  assert.equal(kv.store.size, 0, 'a failure is not a verdict')
})

ok('a non-200 returns null and caches NOTHING', async () => {
  const kv = fakeKv()
  const fetchFn = async () => ({ ok: false, status: 429, json: async () => ({}) })
  assert.equal(await resolveCexVenue('rate', { ...kv, fetchFn }), null)
  assert.equal(kv.store.size, 0)
})

ok('sends a User-Agent (Cloudflare answers 1010 without one)', async () => {
  const kv = fakeKv()
  let seen = null
  const fetchFn = async (_url, opts) => { seen = opts; return okResponse([BINANCE_ROW]) }
  await resolveCexVenue('morpho', { ...kv, fetchFn })
  assert.ok(seen.headers['User-Agent'], 'User-Agent header is required')
  assert.ok(seen.headers['x-cg-pro-api-key'], 'api key header is required')
})

ok('scopes the request to the three allowlisted exchange ids', async () => {
  const kv = fakeKv()
  let url = null
  const fetchFn = async (u) => { url = u; return okResponse([BINANCE_ROW]) }
  await resolveCexVenue('morpho', { ...kv, fetchFn })
  assert.ok(url.includes('exchange_ids=binance,bybit_spot,okex'),
    'an unscoped /tickers call returns page 1 of an unsorted list — wash-trade venues win')
})

ok('no cgId returns null without touching fetch', async () => {
  let calls = 0
  assert.equal(await resolveCexVenue('', { fetchFn: async () => { calls++ } }), null)
  assert.equal(calls, 0)
})

const run = async () => {
  for (const [name, fn] of tests) { await fn(); passed++; console.log('ok -', name) }
  console.log(`\n${passed} passed`)
}
run().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/research/api/_lib/__tests__/cex-venue-resolve.test.mjs`
Expected: FAIL — `The requested module '../cex-venue-map.js' does not provide an export named 'resolveCexVenue'`

- [ ] **Step 3: Write minimal implementation**

In `apps/research/api/_lib/cex-venue-map.js`, add this import at the **top of the file** (an `import` after other statements is legal but every linter flags it):

```js
import { getJsonWithTTL, setJsonWithTTL } from './kv.js';
```

Then append the rest to the end of the same file:

```js
// Long ON PURPOSE. This is stickiness, not thrift: the top-volume venue for a
// coin genuinely changes between days (ASTER: Binance on 2026-08-26, KuCoin on
// 2026-08-27). Re-picking per request would reintroduce exactly the
// per-request nondeterminism this lane exists to remove.
export const VENUE_TTL_SEC = 7 * 24 * 3600;
export const NEGATIVE_TTL_SEC = 24 * 3600;
export const RESOLVE_TIMEOUT_MS = 1200;

export const venueCacheKey = (cgId) => `bars:cexvenue:v1:${cgId}`;

/**
 * Resolve the CEX venue for a cgId. KV-cached; a MISS costs one CoinGecko call
 * (measured 358-442 ms scoped to three venues).
 *
 * `deps` exists for tests only — production passes nothing.
 */
export async function resolveCexVenue(cgId, deps = {}) {
  if (!cgId) return null;
  const kvGet = deps.kvGet || getJsonWithTTL;
  const kvSet = deps.kvSet || setJsonWithTTL;
  const fetchFn = deps.fetchFn || fetch;
  const key = venueCacheKey(cgId);

  // A cached MISS is `{ v: null }`; absence of the key is a different thing.
  try {
    const hit = await kvGet(key);
    if (hit && typeof hit === 'object' && 'v' in hit) return hit.v;
  } catch { /* best-effort */ }

  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) return null;

  const url = `https://pro-api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}`
    + `/tickers?exchange_ids=${CEX_EXCHANGE_IDS}&depth=false`;

  let payload;
  try {
    const r = await fetchFn(url, {
      // Cloudflare answers `error code: 1010` to a request with no UA, which
      // reads exactly like a 403 plan restriction. Always send one.
      headers: { 'x-cg-pro-api-key': apiKey, 'User-Agent': 'spectre-bars' },
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    // NOT cached: a transport failure or a 429 is not evidence that the coin
    // has no CEX pair. Caching it would blank a working token for 24h.
    if (!r.ok) return null;
    payload = await r.json();
  } catch {
    return null;
  }

  const picked = pickCexVenue(payload?.tickers);
  try {
    await kvSet(key, { v: picked }, picked ? VENUE_TTL_SEC : NEGATIVE_TTL_SEC);
  } catch { /* best-effort */ }
  return picked;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node apps/research/api/_lib/__tests__/cex-venue-resolve.test.mjs`
Expected: PASS, `8 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/research/api/_lib/cex-venue-map.js apps/research/api/_lib/__tests__/cex-venue-resolve.test.mjs
git commit -m "feat(bars): cache the venue pick for 7 days, never cache a failed lookup"
```

---

### Task 3: Kline adapters for Bybit and OKX

**Files:**
- Create: `apps/research/api/_lib/cex-bars.js`
- Test: `apps/research/api/_lib/__tests__/cex-bars.test.mjs`

**Interfaces:**
- Consumes: `fetchBinanceKlines(pair, resolution, fromSec, toSec)` from `./binance-bars.js`.
- Produces: `cexPairSymbol(venue, base, target) -> string`, `parseCexKlines(rows) -> Array<{t,o,h,l,c,v}> | null`, `CEX_INTERVALS` (object), `fetchCexKlines(venue, base, target, resolution, fromSec, toSec) -> Promise<Array|null>`.

- [ ] **Step 1: Write the failing test**

Create `apps/research/api/_lib/__tests__/cex-bars.test.mjs`:

```js
// Node tests for the Bybit/OKX kline adapters. Fixtures are REAL responses
// captured from both venues for HYPEUSDT 1h on 2026-08-27.
// Run: node apps/research/api/_lib/__tests__/cex-bars.test.mjs
import assert from 'node:assert/strict'
import { cexPairSymbol, parseCexKlines, CEX_INTERVALS } from '../cex-bars.js'

let passed = 0
function ok(name, fn) { fn(); passed++; console.log('ok -', name) }

// Both venues answer DESCENDING, ms timestamps, string values, and both put
// [ts, o, h, l, c, volume] in the first six slots — so ONE parser serves both.
const BYBIT = [
  ['1787821200000', '82.5', '82.86', '82.26', '82.74', '11742.612', '970166.69421'],
  ['1787817600000', '81.76', '82.54', '81.46', '82.5', '38313.049', '3148382.78211'],
  ['1787814000000', '81.62', '81.88', '81.28', '81.76', '15070.24', '1229448.40957'],
]
const OKX = [
  ['1787821200000', '82.51', '82.85', '82.259', '82.833', '15343.1276', '1267479.518', '1267479.518', '0'],
  ['1787817600000', '81.732', '82.517', '81.441', '82.507', '48892.4183', '4014057.957', '4014057.957', '1'],
  ['1787814000000', '81.572', '81.849', '81.244', '81.724', '15689.455', '1279307.923', '1279307.923', '1'],
]

ok('formats the pair symbol per venue', () => {
  assert.equal(cexPairSymbol('binance', 'HYPE', 'USDT'), 'HYPEUSDT')
  assert.equal(cexPairSymbol('bybit', 'HYPE', 'USDT'), 'HYPEUSDT')
  assert.equal(cexPairSymbol('okx', 'HYPE', 'USDT'), 'HYPE-USDT')
})

ok('parses Bybit rows into ascending second-stamped bars', () => {
  const bars = parseCexKlines(BYBIT)
  assert.equal(bars.length, 3)
  assert.equal(bars[0].t, 1787814000)
  assert.equal(bars[2].t, 1787821200)
  assert.ok(bars[0].t < bars[1].t && bars[1].t < bars[2].t, 'must be ascending')
  assert.equal(bars[2].o, 82.5)
  assert.equal(bars[2].c, 82.74)
  assert.equal(bars[2].v, 11742.612)
})

ok('parses OKX rows with the same parser', () => {
  const bars = parseCexKlines(OKX)
  assert.equal(bars.length, 3)
  assert.equal(bars[2].t, 1787821200)
  assert.equal(bars[2].c, 82.833)
})

ok('the two venues agree on the same hour', () => {
  const b = parseCexKlines(BYBIT).at(-1)
  const o = parseCexKlines(OKX).at(-1)
  assert.equal(b.t, o.t)
  assert.ok(Math.abs(b.c - o.c) / b.c < 0.01, 'closes within 1%')
})

ok('drops rows with non-finite or non-positive prices', () => {
  const bars = parseCexKlines([
    ['1787814000000', '1', '2', '0.5', '1.5', '10'],
    ['1787817600000', '0', '2', '0.5', '1.5', '10'],
    ['1787821200000', 'nope', '2', '0.5', '1.5', '10'],
  ])
  assert.equal(bars.length, 1)
})

ok('empty / junk input returns null, never throws', () => {
  assert.equal(parseCexKlines([]), null)
  assert.equal(parseCexKlines(null), null)
  assert.equal(parseCexKlines([[1]]), null)
})

ok('maps every resolution the chart offers, for both venues', () => {
  for (const res of ['1', '5', '15', '60', '240', '1D', '1W']) {
    assert.ok(CEX_INTERVALS.bybit[res], `bybit missing ${res}`)
    assert.ok(CEX_INTERVALS.okx[res], `okx missing ${res}`)
  }
  assert.equal(CEX_INTERVALS.okx['60'], '1H')
  assert.equal(CEX_INTERVALS.bybit['60'], '60')
})

console.log(`\n${passed} passed`)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/research/api/_lib/__tests__/cex-bars.test.mjs`
Expected: FAIL — `Cannot find module '../cex-bars.js'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/research/api/_lib/cex-bars.js`:

```js
/**
 * Kline adapters for the CEX venue lane. Binance is delegated to the existing
 * fetchBinanceKlines (which carries the allorigins proxy fallback that is the
 * real prod path — do not reimplement it). Bybit and OKX are new.
 */
import { fetchBinanceKlines } from './binance-bars.js';

// TradingView/Codex resolution -> venue interval. 720 (12H) is deliberately
// present here but is NOT offered by the chart's resolution ladder (no symbol
// payload lists it) — see charts-system.md §I3.
export const CEX_INTERVALS = {
  bybit: {
    '1': '1', '3': '3', '5': '5', '15': '15', '30': '30', '60': '60',
    '120': '120', '240': '240', '360': '360', '720': '720',
    'D': 'D', '1D': 'D', 'W': 'W', '1W': 'W', 'M': 'M', '1M': 'M',
  },
  okx: {
    '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1H',
    '120': '2H', '240': '4H', '360': '6H', '720': '12H',
    'D': '1D', '1D': '1D', 'W': '1W', '1W': '1W', 'M': '1M', '1M': '1M',
  },
};

export function cexPairSymbol(venue, base, target) {
  return venue === 'okx' ? `${base}-${target}` : `${base}${target}`;
}

/**
 * Normalize a Bybit or OKX kline array. Both answer DESCENDING with ms string
 * timestamps and [ts, o, h, l, c, volume] in the first six slots, so one
 * parser serves both. Filters match _parseKlines in binance-bars.js.
 */
export function parseCexKlines(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const t = Math.floor(Number(r[0]) / 1000);
    const o = parseFloat(r[1]);
    const h = parseFloat(r[2]);
    const l = parseFloat(r[3]);
    const c = parseFloat(r[4]);
    const v = parseFloat(r[5]) || 0;
    if (!Number.isFinite(t) || t <= 0) continue;
    if (![o, h, l, c].every(Number.isFinite)) continue;
    if (o <= 0 || c <= 0) continue;
    out.push({ t, o, h, l, c, v });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Fetch klines from the resolved venue. Returns bars or null; never throws.
 *
 * Window limits: Bybit caps at 1000 bars, OKX at 300. The TradingView datafeed
 * pages on its own when a window exceeds what one call returns, exactly as it
 * already does for Binance's 1000-bar cap.
 */
export async function fetchCexKlines(venue, base, target, resolution, fromSec, toSec) {
  if (!venue || !base || !target) return null;
  if (fromSec == null || toSec == null || fromSec >= toSec) return null;

  const pair = cexPairSymbol(venue, base, target);
  if (venue === 'binance') return fetchBinanceKlines(pair, resolution, fromSec, toSec);

  const iv = CEX_INTERVALS[venue]?.[resolution];
  if (!iv) return null;

  const startMs = Math.floor(fromSec * 1000);
  const endMs = Math.floor(toSec * 1000);

  // OKX pagination is inverted from intuition: `before` returns records NEWER
  // than the timestamp, `after` returns records EARLIER. So the window
  // [from..to] is before=from, after=to.
  const url = venue === 'bybit'
    ? `https://api.bybit.com/v5/market/kline?category=spot&symbol=${pair}`
      + `&interval=${iv}&start=${startMs}&end=${endMs}&limit=1000`
    : `https://www.okx.com/api/v5/market/candles?instId=${pair}`
      + `&bar=${iv}&before=${startMs}&after=${endMs}&limit=300`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const rows = venue === 'bybit' ? j?.result?.list : j?.data;
    return parseCexKlines(rows);
  } catch (e) {
    if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') {
      console.warn(`[cex-bars] ${venue} ${pair} ${iv} failed:`, e.message);
    }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node apps/research/api/_lib/__tests__/cex-bars.test.mjs`
Expected: PASS, `7 passed`

- [ ] **Step 5: Verify the adapters against the live venues**

Run:

```bash
node --input-type=module -e "
import { fetchCexKlines } from './apps/research/api/_lib/cex-bars.js';
const to = Math.floor(Date.now()/1000), from = to - 6*3600;
for (const [v,b] of [['bybit','HYPE'],['okx','HYPE'],['binance','MORPHO']]) {
  const bars = await fetchCexKlines(v, b, 'USDT', '60', from, to);
  console.log(v, b, bars ? bars.length+' bars, last close '+bars.at(-1).c : 'NULL');
}
"
```

Expected: each line reports several bars and a plausible close. If a venue returns NULL, stop and diagnose before continuing — the remaining tasks assume the adapters work.

- [ ] **Step 6: Commit**

```bash
git add apps/research/api/_lib/cex-bars.js apps/research/api/_lib/__tests__/cex-bars.test.mjs
git commit -m "feat(bars): Bybit and OKX kline adapters on the shared bar shape"
```

---

### Task 4: The `cex` tier in the router

**Files:**
- Modify: `apps/research/api/_lib/bars-router.js` (imports at top; new tier fn near `tryBinance` at :128; `SOURCE_TO_TIER` at :714; `TIER_FNS` at :981; `buildTierList` at :72)
- Test: `apps/research/api/_lib/__tests__/cex-tier-order.test.mjs`

**Interfaces:**
- Consumes: `fetchCexKlines` from `./cex-bars.js` (Task 3); `ctx.cexVenue` (set by Task 5) shaped `{venue, base, target, volUsd}`.
- Produces: `tryCex(ctx) -> Promise<{bars, source: 'cex', meta} | null>`; `buildTierList(tokenClass, env)` gains the `env.hasCexVenue` boolean; `SOURCE_TO_TIER.cex === 'cex'` so the response header reads `X-Spectre-Tier: cex`.

- [ ] **Step 1: Write the failing test**

Create `apps/research/api/_lib/__tests__/cex-tier-order.test.mjs`:

```js
// Node tests for the cex tier's place in the cascade. Pure — no KV, no fetch.
// Run: node apps/research/api/_lib/__tests__/cex-tier-order.test.mjs
import assert from 'node:assert/strict'
import { __test__ } from '../bars-router.js'

const { buildTierList, SOURCE_TO_TIER } = __test__
let passed = 0
function ok(name, fn) { fn(); passed++; console.log('ok -', name) }

const env = (over = {}) => ({
  codexFirst: false, proCodexOff: false, hetznerServe: false,
  gtOff: false, degenCodexFirst: false, hasCexVenue: false, ...over,
})

ok('without a venue the lists are unchanged', () => {
  assert.deepEqual(buildTierList('address-cg', env()), ['geckoterminal', 'cgOhlc', 'codex'])
  assert.deepEqual(buildTierList('ticker-cg', env()), ['cgOhlc'])
  assert.deepEqual(buildTierList('ticker-binance', env()), ['binance', 'cgOhlc'])
})

ok('with a venue, cex goes first', () => {
  assert.equal(buildTierList('address-cg', env({ hasCexVenue: true }))[0], 'cex')
  assert.equal(buildTierList('ticker-cg', env({ hasCexVenue: true }))[0], 'cex')
})

ok('cex appears exactly once', () => {
  const list = buildTierList('address-cg', env({ hasCexVenue: true }))
  assert.equal(list.filter((t) => t === 'cex').length, 1)
})

ok('cex does not displace the binance tier', () => {
  // ctx.cexVenue can only be set when binancePair is null, so this combination
  // cannot occur in production — but the ordering must still be safe if it did.
  const list = buildTierList('ticker-binance', env({ hasCexVenue: true }))
  assert.ok(list.includes('binance'))
})

ok('the remaining order is preserved under the prepend', () => {
  const list = buildTierList('address-cg', env({ hasCexVenue: true }))
  assert.deepEqual(list, ['cex', 'geckoterminal', 'cgOhlc', 'codex'])
})

ok('codexFirst still wins for address tokens, with cex ahead of it', () => {
  const list = buildTierList('address-cg', env({ hasCexVenue: true, codexFirst: true }))
  assert.deepEqual(list, ['cex', 'codex', 'geckoterminal'])
})

ok('the source tag maps to its own tier name for the response header', () => {
  assert.equal(SOURCE_TO_TIER.cex, 'cex')
})

console.log(`\n${passed} passed`)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/research/api/_lib/__tests__/cex-tier-order.test.mjs`
Expected: FAIL on `with a venue, cex goes first` — `buildTierList` ignores `hasCexVenue`.

- [ ] **Step 3: Write minimal implementation**

In `apps/research/api/_lib/bars-router.js`:

(a) add to the import block near the top, beside the other tier imports:

```js
import { fetchCexKlines } from './cex-bars.js';
```

(b) in `buildTierList`, add this immediately **before** `return list;` — after the kill-switch filters, so a disabled tier can never be reintroduced:

```js
  // CEX venue map (2026-08-27). Prepended, never substituted: ctx.cexVenue is
  // only ever set when the registry did NOT resolve a Binance pair, so this
  // cannot displace a chart that renders today. See
  // .claude/rules/cex-venue-map-plan.md.
  if (env.hasCexVenue) list = ['cex', ...list.filter((t) => t !== 'cex')];
```

(c) add the tier function directly after `tryBinance` ends:

```js
export async function tryCex(ctx) {
  const v = ctx.cexVenue;
  if (!v) return null;
  // Venue is part of the key: a venue change must not serve the old tape.
  const kvKey = `codex:bars:${ctx.tokenSymbol}:${ctx.requestedRes}:`
    + `${ctx.fromBucket}:${ctx.bucket}:cex:${v.venue}`;
  try {
    const cached = await getJsonWithTTL(kvKey);
    if (cached?.bars?.length > 0) return cached;
  } catch { /* best-effort */ }
  try {
    const bars = await fetchCexKlines(
      v.venue, v.base, v.target, ctx.requestedRes, ctx.fromSec, ctx.toSec,
    );
    if (bars?.length > 0) {
      const payload = {
        bars,
        source: 'cex',
        meta: { venue: v.venue, pair: `${v.base}/${v.target}` },
      };
      try { await setJsonWithTTL(kvKey, payload, ctx.freeTierTtl); } catch { /* best-effort */ }
      return payload;
    }
    console.log(`[cex] ${ctx.symbol} -> ${v.venue} ${v.base}/${v.target}: empty, falling back`);
  } catch (e) {
    console.warn(`[cex] ${ctx.symbol} -> ${v.venue}: ${e.message}, falling back`);
  }
  return null;
}
```

(d) add `cex: 'cex',` to `SOURCE_TO_TIER`.

(e) add `cex: tryCex,` to `TIER_FNS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node apps/research/api/_lib/__tests__/cex-tier-order.test.mjs`
Expected: PASS, `7 passed`

- [ ] **Step 5: Run the existing bars tests to prove nothing regressed**

Run:

```bash
node apps/research/api/_lib/__tests__/bars-continuity.test.mjs
node apps/research/api/_lib/__tests__/bars-hole-fill.test.mjs
node apps/research/api/_lib/__tests__/bars-scale-repair.test.mjs
```

Expected: all three PASS with their existing counts.

- [ ] **Step 6: Commit**

```bash
git add apps/research/api/_lib/bars-router.js apps/research/api/_lib/__tests__/cex-tier-order.test.mjs
git commit -m "feat(bars): add the cex tier, prepended only when a venue resolved"
```

---

### Task 5: Wire the lane into the handler — both cascade paths

**Files:**
- Modify: `apps/research/api/_lib/handlers/bars.js` — import block (top); `:331` (after `lookupBinancePair`); `:524` (ctx literal); `:641` (`tierEnv` in the smart path); `:676` (after the legacy `if (binancePair)` block)

**Interfaces:**
- Consumes: `resolveCexVenue(cgId)` from Task 2; `runTier('cex', ctx)` and `env.hasCexVenue` from Task 4.
- Produces: `ctx.cexVenue` — `{venue, base, target, volUsd} | null` — read by `tryCex`.

⚠️ **`SMART_BARS_ROUTER` is opt-in and its prod state is unverified** (`rz-chart-audit-plan` §A3 hypothesis 3). The LEGACY branch is the default. Wiring only one path risks a fix that is invisible in production, so both edits below are required.

- [ ] **Step 1: Add the import**

In `apps/research/api/_lib/handlers/bars.js`, beside the existing `bars-router` import:

```js
import { resolveCexVenue } from '../cex-venue-map.js'
```

- [ ] **Step 2: Resolve the venue after the registry lookup**

Immediately after `const binancePair = lookupBinancePair(symbol, reqCgId, address)` (:331), add:

```js
  // ── CEX VENUE MAP (2026-08-27) ────────────────────────────────────────────
  // HOLES ONLY. Consulted only when the hand-written token-registry did NOT
  // resolve a Binance pair, so no chart that renders today can change. Keyed
  // by cgId, never by ticker. KV-cached 7 days; a cold miss costs one
  // CoinGecko call (~400ms) behind a 1.2s timeout, and a miss falls through
  // to exactly today's behaviour. Kill switch: CEX_VENUE_MAP=0.
  // See .claude/rules/cex-venue-map-plan.md.
  const cexVenue = (!binancePair && reqCgId && process.env.CEX_VENUE_MAP !== '0')
    ? await resolveCexVenue(reqCgId)
    : null
```

- [ ] **Step 3: Put it on the ctx**

In the `ctx` object literal (:524), add `cexVenue` to the line that already carries `binancePair`:

```js
    binancePair, cexVenue, bucketSec, freeTierTtl, codexTierTtl, codexKvKey,
```

- [ ] **Step 4: Wire the SMART path**

In the `tierEnv` object (:641), add:

```js
        hasCexVenue: !!ctx.cexVenue,
```

- [ ] **Step 5: Wire the LEGACY path**

Directly after the legacy `if (binancePair) { ... }` block (:676-681) and before the Hetzner block, add:

```js
    // CEX venue map — same position in the order as Binance, reached only when
    // Binance did not own the token. Mirrors the smart path's prepend.
    if (!binancePair && ctx.cexVenue) {
      const payload = await runTier('cex', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Fall through to Hetzner / GeckoTerminal / Codex exactly as before.
    }
```

- [ ] **Step 6: Prove the kill switch and the holes-only rule by inspection**

Run:

```bash
grep -n "cexVenue" apps/research/api/_lib/handlers/bars.js
```

Expected: every read of `cexVenue` is guarded by `!binancePair`, and the only assignment is guarded by `process.env.CEX_VENUE_MAP !== '0'`. If any read is unguarded, fix it before continuing — that guard is the entire safety argument.

- [ ] **Step 7: Build**

Run: `npm run build:research`
Expected: clean, ending with `[check-critical-path] OK`

- [ ] **Step 8: Commit**

```bash
git add apps/research/api/_lib/handlers/bars.js
git commit -m "feat(bars): consult the CEX venue map when the registry has no pair"
```

---

### Task 6: Live verification against the reported tokens

**Files:** none — this task produces evidence, not code.

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a pass/fail record to paste into `.claude/rules/cex-venue-map-plan.md` as an execution log entry.

- [ ] **Step 1: Start the dev stack**

Run:

```bash
node scripts/setup-ports.js
```

Then start the Express server and the research app per `.claude/rules/dev-workflow.md` §K. Confirm exactly one listener on the server port before probing:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

Expected: exactly one row. Two rows means a stale server is serving old code — kill it first. (This trap cost two debugging rounds in `rz-chart-audit-plan` Steps 12-13.)

- [ ] **Step 2: Probe the five reported tokens**

Each token below is one the founder screenshotted as broken. `cgId` values are the measured ones — note that GRAM's is `the-open-network`, not `gram-2`.

```bash
for t in "GRAM:the-open-network:1.39" "HYPE:hyperliquid:80.94" "ASTER:aster-2:0.697" \
         "WLFI:world-liberty-financial:0.058" "MORPHO:morpho:2.47"; do
  SYM=${t%%:*}; REST=${t#*:}; CG=${REST%%:*}
  TO=$(date +%s); FROM=$((TO - 86400))
  echo "--- $SYM ($CG) ---"
  curl -s -D- -o /tmp/bars.json \
    "http://localhost:3001/api/bars?symbol=$SYM&cgId=$CG&resolution=60&from=$FROM&to=$TO" \
    | grep -i "x-spectre-tier"
  python3 -c "
import json;d=json.load(open('/tmp/bars.json'));b=d.get('bars',[])
print('  bars',len(b),'last close',b[-1]['c'] if b else None,'meta',d.get('meta'))
"
done
```

Expected for every row: `X-Spectre-Tier: cex`, a non-zero bar count, and a last close within a few percent of the third field (the hero price at the time of the report — allow for real market movement since 2026-08-26).

- [ ] **Step 3: Prove majors did not change**

```bash
TO=$(date +%s); FROM=$((TO - 86400))
for S in BTC ETH SOL; do
  curl -s -D- -o /dev/null \
    "http://localhost:3001/api/bars?symbol=$S&resolution=60&from=$FROM&to=$TO" \
    | grep -i "x-spectre-tier"
done
```

Expected: `binance` for all three. They hold a registry pair, so they must never reach the new branch.

- [ ] **Step 4: Prove the kill switch**

Restart the server with `CEX_VENUE_MAP=0` set, then re-run Step 2 for GRAM alone.

Expected: the tier is no longer `cex` — it reverts to whatever it served before this work. Restart without the flag afterwards.

- [ ] **Step 5: Record the result**

Append an execution-log section to `.claude/rules/cex-venue-map-plan.md` with the measured tier, bar count and last close per token, plus the majors regression check. State plainly anything that did not pass.

- [ ] **Step 6: Commit**

```bash
git add .claude/rules/cex-venue-map-plan.md
git commit -m "docs(bars): record the CEX venue map verification run"
```

---

## Deliberately not in this plan

**The freshness guard** (`meta.lastBarAgeSec` plus the app-side staleness rule) is spec §D5, and the spec calls it independent of where bars come from. It touches `writeBarsPayload` and the research chart components — a different surface with its own tests and its own founder call on the user-facing copy. It gets its own plan so that neither piece blocks the other. Note that it, not this plan, is what stops ASTER and WLFI from drawing an old tape silently; this plan is what gives them a current one to draw.

**Letting the CEX lane displace a working DEX chart** (spec §C1, deferred) — revisit with measured prod data after this ships.
