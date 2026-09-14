/**
 * Shared primitives for recovering from stale-deploy chunk errors.
 *
 * Two failure modes converge here:
 *   1. `vite:preloadError` (initial module-preload fail) — handled in main.jsx
 *   2. Runtime dynamic-import failure inside React.lazy() — handled by
 *      `lazy-with-retry.js`, which falls through to `triggerChunkRecovery()`
 *      after an in-place retry fails.
 *
 * Both code paths read+bump the same `sessionStorage` counter so a single tab
 * can't auto-reload more than MAX_CHUNK_RECOVER_ATTEMPTS times in a row. After
 * the cap the PageErrorBoundary surfaces a visible "New version" UI.
 *
 * `purgePwaCaches()` unregisters the service worker and deletes Cache Storage
 * before reload — otherwise the SW returns the stale `index.html` from cache
 * and we reload straight back into the broken state.
 */

export const RELOAD_PARAM = '_reload'
export const CBUST_PARAM = '_cbust'
export const CHUNK_RECOVER_PARAM = '_chunkrecover'
export const CHUNK_RECOVER_KEY = '__spectre_chunk_recover'
export const MAX_CHUNK_RECOVER_ATTEMPTS = 2

/**
 * MIRROR ESCAPE HATCH. Cloudflare fronts app.spectreai.io and its bot
 * scoring hard-403s /assets requests for clients it distrusts (VPNs,
 * flagged IPs, unlucky fingerprints) — the document loads but route chunks
 * die, which no amount of cache purging can fix. The SAME deployment is
 * reachable directly at the Vercel alias, bypassing Cloudflare entirely
 * (verified live 2026-07-01: a client whose chunk fetches were 403'd on
 * the main domain loaded the mirror perfectly). Once a recovery reload has
 * proven the failure is not staleness, the error card offers a one-click
 * navigation to the mirror. It must be a FULL navigation, not a per-asset
 * origin flip: chunks fetched cross-origin resolve their static imports
 * (vendor-react, shared services) against the new origin while the
 * already-loaded entry graph stays same-origin — two React instances,
 * guaranteed hook crash. One document, one origin, one module graph.
 * The mirror is a separate cookie/storage origin, so the user may need to
 * pass the gate / sign in again — the card copy says so.
 */
export const MIRROR_ORIGIN = 'https://spectre-app-research.vercel.app'

export function isOnMirror() {
  try { return window.location.origin === MIRROR_ORIGIN } catch (_) { return false }
}

export function getMirrorUrl() {
  try {
    const u = new URL(window.location.href)
    u.searchParams.delete(RELOAD_PARAM)
    u.searchParams.delete(CBUST_PARAM)
    u.searchParams.delete(CHUNK_RECOVER_PARAM)
    return MIRROR_ORIGIN + u.pathname + u.search + u.hash
  } catch (_) {
    return MIRROR_ORIGIN
  }
}

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

/**
 * Force a clean reload to pick up a fresh `index.html` + current chunk hashes.
 * Returns a never-resolving promise so the caller can keep Suspense holding
 * its fallback through the reload (no flash of error UI).
 */
let __reloadInFlight = false
export function triggerChunkRecovery(reason) {
  if (typeof window === 'undefined') return Promise.reject(reason)
  if (__reloadInFlight) return new Promise(() => {})
  const priorAttempts = getChunkRecoverAttempt()
  if (priorAttempts >= MAX_CHUNK_RECOVER_ATTEMPTS) {
    // Budget exhausted — let the error boundary render its visible UI.
    return Promise.reject(reason)
  }
  __reloadInFlight = true
  bumpChunkRecoverAttempt()
  // eslint-disable-next-line no-console
  console.warn('[chunk-recovery] stale deploy detected, purging caches + reloading:', reason?.message || reason)
  // A wedged service worker can hang getRegistrations()/caches.keys()
  // indefinitely — without the timeout race the reload below never fires,
  // __reloadInFlight stays latched, and every navigation to a stale chunk
  // dies silently (URL changes, old page stays) for the rest of the session.
  const purgeTimeout = new Promise((resolve) => setTimeout(resolve, 4000))
  Promise.race([purgePwaCaches(), purgeTimeout]).finally(() => {
    const url = new URL(window.location.href)
    url.searchParams.set(RELOAD_PARAM, '1')
    url.searchParams.set(CBUST_PARAM, String(Date.now()))
    window.location.replace(url.toString())
  })
  return new Promise(() => {})
}

export function isChunkLoadError(error) {
  const msg = String(error?.message || error || '')
  // "Unable to preload CSS" is Vite's preload helper failing on a lazy
  // chunk's STYLESHEET (the hashed .css is gone after a deploy while the
  // .js may still resolve) - same stale-deploy class, same recovery.
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg)
}
