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
