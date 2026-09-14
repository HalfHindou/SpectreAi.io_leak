/**
 * PR-4 (perf): persisted stale-while-revalidate snapshot layer.
 *
 * CMC paints real numbers instantly because data ships in its SSR HTML. The
 * SPA equivalent: persist the last good response for the handful of payloads
 * that drive first paint (RZ bootstrap per symbol, welcome top prices, fear
 * & greed, trending, watchlist prices) and hydrate state from the snapshot
 * SYNCHRONOUSLY on mount - real numbers at first React commit - while the
 * normal fetch revalidates and silently updates in place (the app already
 * mutates prices in place on every poll, so this is pixel-identical).
 *
 * Rules:
 * - localStorage, one entry per key, prefix `spectre-snap.v1.` - bump the
 *   version to invalidate the schema; init sweeps foreign-version keys.
 * - 24h hard cap by default; callers can pass a tighter maxAge.
 * - Caps: 60 entries / ~2.5MB total, single payloads over 300KB are skipped,
 *   LRU eviction on quota pressure.
 * - NEVER persists nullish/empty payloads. Service layers throw on non-OK
 *   responses (incl. 401 GATE_REQUIRED), so a gated/failed response can
 *   never overwrite a good snapshot. Only public market data belongs here -
 *   nothing user-scoped.
 * - Every operation is try/catch wrapped: Safari private mode, quota-full,
 *   and corrupted entries all degrade to "no snapshot", never a crash.
 */

const PREFIX = 'spectre-snap.v1.'
const LEGACY_PREFIX = 'spectre-snap.'
const MAX_ENTRIES = 60
const MAX_TOTAL_BYTES = 2.5 * 1024 * 1024
const MAX_ENTRY_BYTES = 300 * 1024
const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000

const _hasStorage = (() => {
  try {
    const k = PREFIX + '__probe'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
})()

// Throttle lastUsed bumps to one per key per minute - peeks happen on render.
const _lastUsedBumped = {}

function _idle(fn) {
  try {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 3000 })
    else setTimeout(fn, 250)
  } catch {
    try { fn() } catch { /* ignore */ }
  }
}

function _allSnapKeys() {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k)
  }
  return keys
}

/**
 * Synchronous, render-safe read. Returns { data, ts } or null.
 * Deletes entries older than maxAgeMs as it encounters them.
 */
export function snapPeek(key, maxAgeMs = DEFAULT_MAX_AGE) {
  if (!_hasStorage) return null
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (!entry || typeof entry.ts !== 'number' || entry.data == null) {
      localStorage.removeItem(PREFIX + key)
      return null
    }
    const age = Date.now() - entry.ts
    if (age > Math.min(maxAgeMs, DEFAULT_MAX_AGE)) {
      localStorage.removeItem(PREFIX + key)
      return null
    }
    // LRU bookkeeping (throttled; write deferred off the render path)
    const now = Date.now()
    if (!_lastUsedBumped[key] || now - _lastUsedBumped[key] > 60_000) {
      _lastUsedBumped[key] = now
      _idle(() => {
        try {
          entry.lastUsed = now
          localStorage.setItem(PREFIX + key, JSON.stringify(entry))
        } catch { /* quota - the eviction in snapPut handles pressure */ }
      })
    }
    return { data: entry.data, ts: entry.ts }
  } catch {
    try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ }
    return null
  }
}

function _evictLru(countToFree) {
  try {
    const entries = _allSnapKeys().map((k) => {
      try {
        const e = JSON.parse(localStorage.getItem(k))
        return { k, lastUsed: e?.lastUsed || e?.ts || 0 }
      } catch {
        return { k, lastUsed: 0 }
      }
    })
    entries.sort((a, b) => a.lastUsed - b.lastUsed)
    for (const { k } of entries.slice(0, countToFree)) localStorage.removeItem(k)
  } catch { /* ignore */ }
}

/**
 * Fire-and-forget persist (write scheduled at idle). Refuses nullish data,
 * empty arrays/objects and oversized payloads.
 */
export function snapPut(key, data) {
  if (!_hasStorage) return
  if (data == null) return
  if (Array.isArray(data) && data.length === 0) return
  if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) return
  _idle(() => {
    try {
      const payload = JSON.stringify({ ts: Date.now(), lastUsed: Date.now(), data })
      if (payload.length > MAX_ENTRY_BYTES) return
      const keys = _allSnapKeys()
      if (keys.length >= MAX_ENTRIES) _evictLru(Math.ceil(MAX_ENTRIES / 4))
      // rough total-size pressure check
      let total = 0
      for (const k of _allSnapKeys()) total += (localStorage.getItem(k) || '').length
      if (total + payload.length > MAX_TOTAL_BYTES) _evictLru(Math.ceil(MAX_ENTRIES / 3))
      try {
        localStorage.setItem(PREFIX + key, payload)
      } catch {
        // QuotaExceededError - evict half and retry once
        _evictLru(Math.ceil(MAX_ENTRIES / 2))
        try { localStorage.setItem(PREFIX + key, payload) } catch { /* give up silently */ }
      }
    } catch { /* never break the app for a cache write */ }
  })
}

/**
 * Wrap a fetch: await it, persist on a truthy validated result, return it.
 * `validate` (optional) gets the resolved value; persist only when truthy.
 */
export async function snapWrap(key, fetchFn, validate) {
  const result = await fetchFn()
  try {
    if (result != null && (!validate || validate(result))) snapPut(key, result)
  } catch { /* ignore */ }
  return result
}

// One-time idle sweep: drop entries from older schema versions.
if (_hasStorage) {
  _idle(() => {
    try {
      for (const k of _allSnapKeys()) {
        if (!k.startsWith(PREFIX)) localStorage.removeItem(k)
      }
    } catch { /* ignore */ }
  })
}
