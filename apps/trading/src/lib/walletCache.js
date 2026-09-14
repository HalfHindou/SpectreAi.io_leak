/**
 * Cached embedded-wallet ADDRESSES (public data only - never keys, never
 * tokens). The user's Privy embedded wallet addresses are stable across
 * sessions, but the SDK takes 2-5s after a page refresh to re-hydrate them
 * (config fetch + token refresh + wallet iframe). Caching the addresses lets
 * balance reads start at t=0 while Privy hydrates in the background; signing
 * still requires the real hydrated wallet object.
 */
const KEY = 'spectre-wallet-cache-v1'

export function readWalletCache() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || (typeof data.sol !== 'string' && typeof data.evm !== 'string')) return null
    return data
  } catch {
    return null
  }
}

export function writeWalletCache({ did, sol, evm }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ did: did || null, sol: sol || null, evm: evm || null, ts: Date.now() }))
  } catch { /* storage full / private mode - cache is best-effort */ }
}

export function clearWalletCache() {
  try {
    localStorage.removeItem(KEY)
  } catch { /* no-op */ }
}
