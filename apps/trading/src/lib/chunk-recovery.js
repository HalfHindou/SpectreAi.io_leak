/**
 * Recover from stale-deploy chunk errors.
 *
 * After a new Vercel deploy ships, every JS chunk gets a fresh content hash.
 * Any user with the old `index.html` still in their tab will fail to load
 * lazy-imported chunks (404 — the hashed URL is gone). Without recovery the
 * user sees "Something went wrong" until they hard-refresh.
 *
 * `triggerChunkRecovery()` unregisters the SW, deletes Cache Storage, and
 * reloads once. `sessionStorage` caps total auto-reloads per tab at 2 so a
 * genuinely broken deploy can't infinite-loop the user.
 */

export const RELOAD_PARAM = '_reload'
export const CBUST_PARAM = '_cbust'
export const CHUNK_RECOVER_KEY = '__spectre_chunk_recover'
export const MAX_CHUNK_RECOVER_ATTEMPTS = 2

export function getChunkRecoverAttempt() {
  try { return Number(sessionStorage.getItem(CHUNK_RECOVER_KEY) || 0) } catch (_) { return 0 }
}

export function bumpChunkRecoverAttempt() {
  try { sessionStorage.setItem(CHUNK_RECOVER_KEY, String(getChunkRecoverAttempt() + 1)) } catch (_) { /* quota — ignore */ }
}

export async function purgePwaCaches() {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
    }
  } catch (_) { /* ignore */ }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)))
    }
  } catch (_) { /* ignore */ }
}

let __reloadInFlight = false
export function triggerChunkRecovery(reason) {
  if (typeof window === 'undefined') return Promise.reject(reason)
  if (__reloadInFlight) return new Promise(() => {})
  if (getChunkRecoverAttempt() >= MAX_CHUNK_RECOVER_ATTEMPTS) {
    return Promise.reject(reason)
  }
  __reloadInFlight = true
  bumpChunkRecoverAttempt()
  // eslint-disable-next-line no-console
  console.warn('[chunk-recovery] stale deploy detected, purging caches + reloading:', reason?.message || reason)
  purgePwaCaches().finally(() => {
    const url = new URL(window.location.href)
    url.searchParams.set(RELOAD_PARAM, '1')
    url.searchParams.set(CBUST_PARAM, String(Date.now()))
    window.location.replace(url.toString())
  })
  return new Promise(() => {})
}

export function isChunkLoadError(error) {
  const msg = String(error?.message || error || '')
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}
