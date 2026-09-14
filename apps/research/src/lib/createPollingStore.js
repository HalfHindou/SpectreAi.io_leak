/**
 * createPollingStore — module-level shared polling primitive.
 *
 * Folds the "every component spins its own setInterval" problem into one
 * timer + one HTTP request per tick, broadcasting to all subscribers.
 * Used for cross-component price feeds where multiple hooks want
 * overlapping symbol sets refreshed at similar cadence.
 *
 * Config:
 *   - name           identifier used in warn logs
 *   - fetch(keys[])  async fetcher; returns Record<key, raw> for the union
 *                    of all subscribed keys. Errors are caught and logged.
 *   - normalize(raw) per-row normalizer, default identity
 *   - diffKey(row)   change-detection key; if old/new diff keys match we
 *                    skip broadcast to avoid useless re-renders
 *   - defaultInterval fallback interval (ms) when a subscriber omits one
 *   - storageKey     optional localStorage key for instant-paint cache
 *                    seed across reloads
 *   - storageTTL     ms; entries younger than this are treated as fresh
 *   - staleServeMax  ms; entries older than storageTTL but younger than this
 *                    still hydrate the cache for instant paint - the
 *                    subscribe-time forced fetch revalidates them within a
 *                    second or two. Beyond this age the seed is discarded.
 *
 * Returns: { subscribe, getCached }
 *   subscribe(keys, intervalMs?, onUpdate) → unsubscribe
 *     - new subscribers receive the current cache synchronously
 *     - cadence = min(intervalMs across subscribers); fastest wins
 *     - pauses while document.hidden, fires one catch-up on resume
 *
 * Design notes:
 *   - Single in-flight fetch; concurrent ticks coalesce to one + one
 *     follow-up via the `pending` flag.
 *   - We deliberately do NOT support per-subscriber rate limits — every
 *     consumer gets every broadcast. If you need to rate-limit a slow
 *     consumer, throttle inside its onUpdate.
 */
export function createPollingStore(config) {
  const {
    name,
    fetch: fetchFn,
    normalize = (r) => r,
    diffKey = (r) => JSON.stringify(r),
    defaultInterval = 10000,
    storageKey = null,
    storageTTL = 5 * 60 * 1000,
    staleServeMax = 60 * 60 * 1000,
  } = config

  let nextId = 0
  const subscribers = new Map() // id -> { keySet, interval, onUpdate }
  let cache = loadFromStorage()
  let timerId = null
  let activeInterval = null
  let isFetching = false
  let pending = false
  let visibilityHandlerInstalled = false
  // Guards the subscribe-time forced fetch. When a page has a single subscriber
  // whose key set churns (e.g. bubbles rebuilds `allTokens` ~per frame), every
  // re-subscribe flips activeInterval null<->N and would force a fresh fetch -
  // observed as 100+ identical /v1/prices requests in a few seconds, which then
  // self-inflicts 500/502s from the flood. Cap forced fetches to one per gap;
  // new subscribers still get the cache synchronously, and the scheduled tick is
  // unaffected.
  let lastForceFetchAt = 0
  const FORCE_FETCH_MIN_GAP_MS = 1500

  function loadFromStorage() {
    if (!storageKey || typeof localStorage === 'undefined') return {}
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      // Stale-but-recent seeds still paint (the forced fetch at first
      // subscribe revalidates them); only truly old snapshots are dropped.
      if (!parsed?.ts || Date.now() - parsed.ts > Math.max(storageTTL, staleServeMax)) return {}
      return parsed.data || {}
    } catch {
      return {}
    }
  }

  function persistToStorage() {
    if (!storageKey || typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ data: cache, ts: Date.now() }))
    } catch { /* quota - ignore */ }
  }

  function unionKeys() {
    const set = new Set()
    for (const sub of subscribers.values()) {
      for (const k of sub.keySet) set.add(k)
    }
    return [...set]
  }

  function effectiveInterval() {
    let min = Infinity
    for (const sub of subscribers.values()) {
      if (sub.interval < min) min = sub.interval
    }
    return min === Infinity ? null : min
  }

  function broadcast() {
    for (const sub of subscribers.values()) {
      try { sub.onUpdate(cache) } catch { /* subscriber threw — keep going */ }
    }
  }

  async function fetchOnce() {
    if (isFetching) { pending = true; return }
    if (typeof document !== 'undefined' && document.hidden) return
    const keys = unionKeys()
    if (keys.length === 0) return
    isFetching = true
    let raw = null
    try {
      raw = await fetchFn(keys)
    } catch (err) {
      console.warn(`[${name}] fetch failed:`, err?.message || err)
    }
    isFetching = false

    if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
      const next = { ...cache }
      let changed = false
      for (const [k, val] of Object.entries(raw)) {
        const normalized = normalize(val)
        const prev = next[k]
        if (!prev || diffKey(prev) !== diffKey(normalized)) {
          next[k] = normalized
          changed = true
        }
      }
      if (changed) {
        cache = next
        persistToStorage()
        broadcast()
      }
    }

    if (pending) {
      pending = false
      fetchOnce()
    }
  }

  function reschedule() {
    if (timerId) { clearInterval(timerId); timerId = null }
    const interval = effectiveInterval()
    if (interval == null) { activeInterval = null; return }
    activeInterval = interval
    timerId = setInterval(fetchOnce, interval)
  }

  function ensureVisibilityHandler() {
    if (visibilityHandlerInstalled || typeof document === 'undefined') return
    visibilityHandlerInstalled = true
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (timerId) { clearInterval(timerId); timerId = null }
      } else if (subscribers.size > 0) {
        fetchOnce()
        reschedule()
      }
    })
  }

  function subscribe(keys, intervalMs, onUpdate) {
    if (typeof intervalMs === 'function') {
      // subscribe(keys, onUpdate) overload — interval defaults
      onUpdate = intervalMs
      intervalMs = defaultInterval
    }
    if (typeof onUpdate !== 'function') {
      throw new Error(`[${name}] subscribe: onUpdate must be a function`)
    }
    ensureVisibilityHandler()
    const id = ++nextId
    const keySet = new Set(keys)
    // Does this subscriber ask for keys nobody else is polling yet? If so the
    // cache push below can't cover it and the next scheduled tick is too far
    // away (up to a full interval) - force a fetch for the widened union.
    let addsNewKeys = subscribers.size === 0
    if (!addsNewKeys) {
      const existing = new Set(unionKeys())
      for (const k of keySet) {
        if (!existing.has(k)) { addsNewKeys = true; break }
      }
    }
    subscribers.set(id, { keySet, interval: intervalMs || defaultInterval, onUpdate })

    if (Object.keys(cache).length > 0) {
      try { onUpdate(cache) } catch { /* ignore */ }
    }

    const prevInterval = activeInterval
    reschedule()
    // Only force-fetch if this subscriber widened the key set or we have no
    // cache yet. Otherwise the cache push above is sufficient until the
    // next scheduled tick.
    const hadCache = Object.keys(cache).length > 0
    if (!hadCache || prevInterval !== activeInterval || addsNewKeys) {
      const now = Date.now()
      // First fetch always passes (lastForceFetchAt starts at 0); rapid
      // re-subscribes within the gap fall back to the cache push above + the
      // scheduled tick instead of stampeding the network.
      if (now - lastForceFetchAt > FORCE_FETCH_MIN_GAP_MS) {
        lastForceFetchAt = now
        fetchOnce()
      }
    }

    return () => {
      subscribers.delete(id)
      if (subscribers.size === 0) {
        if (timerId) { clearInterval(timerId); timerId = null }
        activeInterval = null
      } else {
        const next = effectiveInterval()
        if (next !== activeInterval) reschedule()
      }
    }
  }

  return {
    subscribe,
    getCached: () => cache,
  }
}
