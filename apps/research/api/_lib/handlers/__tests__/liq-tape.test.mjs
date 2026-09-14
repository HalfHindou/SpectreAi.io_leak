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

// fetchTapeEvents: parallel pages, filters cutoff + malformed rows
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
  const offset = Number(new URL(url).searchParams.get('offset'))
  if (offset === 0) return page([mkRow(1000, 63000, 5000), mkRow(2000, 63010, 300), { price: 'x', usd_value: -1 }])
  if (offset === 500) return page([mkRow(3600_000, 62900, 800), mkRow(80 * 3600_000, 60000, 999)])
  return page([])
}
const events = await fetchTapeEvents('BTC', 72, { fetchImpl })
assert.equal(calls.length, 6, 'all pages fetched in parallel')
assert.ok(calls[0].includes('asset=BTC') && calls[0].includes('limit=500') && calls[0].includes('offset=0'))
assert.ok(calls.some(u => u.includes('offset=2500')), 'covers all 6 offsets')
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
