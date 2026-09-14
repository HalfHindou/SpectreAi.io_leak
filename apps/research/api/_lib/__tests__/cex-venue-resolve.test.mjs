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
