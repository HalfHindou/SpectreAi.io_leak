/**
 * CoinGecko contract-address lookup with a module cache.
 *
 * Purpose (Gleb 2026-06-12): address-searched tokens are resolved by Codex,
 * which doesn't know CoinGecko ids - so a CG-LISTED token found by pasting
 * its contract (e.g. PAAL 0x14fe...0e16) carried no cgId and the degen
 * routing rule sent it to Trading Lite instead of Research Zone. This module
 * answers "is this contract CG-listed?" cheaply so the router can classify
 * correctly: cgId found -> Research Zone, 404 -> true degen -> Trading Lite.
 *
 * Goes through /api/coingecko/* (same proxy the app already uses in dev and
 * prod, Pro key added server-side). Results - including misses - are cached
 * for the session, and the search UIs prewarm on result render so the
 * click-time await is usually instant.
 */

const NETWORK_TO_CG_PLATFORM = {
  1: 'ethereum',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  42161: 'arbitrum-one',
  10: 'optimistic-ethereum',
  8453: 'base',
  43114: 'avalanche',
  250: 'fantom',
  1399811149: 'solana',
  4663: 'robinhood',
}

const _cache = new Map() // `${networkId}:${addressLower}` -> Promise<{cgId,name,image}|null>

function _fetchLookup(address, networkId) {
  const platform = NETWORK_TO_CG_PLATFORM[Number(networkId)]
  if (!platform) return Promise.resolve(null)
  const url = `/api/coingecko/coins/${platform}/contract/${encodeURIComponent(address)}`
  return fetch(url, { signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j || !j.id) return null
      return {
        cgId: j.id,
        name: j.name || null,
        image: j.image?.small || j.image?.thumb || null,
      }
    })
    .catch(() => null)
}

/**
 * lookupCgByContract(address, networkId, timeoutMs?) -> {cgId,name,image}|null
 * Cached per session (misses too). timeoutMs caps THIS call's wait - the
 * underlying fetch keeps running and lands in the cache for next time.
 */
export function lookupCgByContract(address, networkId, timeoutMs = 900) {
  if (!address || networkId == null) return Promise.resolve(null)
  const key = `${networkId}:${String(address).toLowerCase()}`
  let p = _cache.get(key)
  if (!p) {
    p = _fetchLookup(address, networkId)
    _cache.set(key, p)
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return p
  return Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))])
}

/** Fire-and-forget warm-up so the click-time lookup is already resolved. */
export function prewarmCgContractLookup(address, networkId) {
  lookupCgByContract(address, networkId, 0)
}
