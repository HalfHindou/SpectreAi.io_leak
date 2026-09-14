/**
 * smu-vc-snapshots — local portfolio change detection. Persists each fund's
 * holding set with first-seen timestamps in localStorage; on every visit it
 * diffs the current set against the stored one to surface what was ADDED or
 * REMOVED since you last looked, and how long each position has been tracked.
 *
 * Honest by design: the static registry has no history, so the first time you
 * open a fund everything is "tracked since now" (baseline). Real add/remove
 * events are detected from that point forward as the underlying data shifts.
 */
const KEY = 'spectre-vc-snapshots-v1'
const U = (s) => String(s || '').toUpperCase()

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
function save(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)) } catch { /* quota / private mode */ }
}

/**
 * Reconcile a fund's current holdings against the stored snapshot.
 * @returns { firstSeen: {SYM: isoDate}, added: [SYM], removed: [SYM], baseline: bool }
 */
export function reconcileSnapshot(vcId, tokens) {
  if (!vcId) return { firstSeen: {}, added: [], removed: [], baseline: true }
  const now = new Date().toISOString()
  const current = [...new Set((tokens || []).map(U))]
  const store = load()
  const prev = store[vcId]

  if (!prev) {
    const firstSeen = {}
    current.forEach((t) => { firstSeen[t] = now })
    store[vcId] = { tokens: current, firstSeen, updatedAt: now }
    save(store)
    return { firstSeen, added: [], removed: [], baseline: true }
  }

  const prevSet = new Set(prev.tokens || [])
  const curSet = new Set(current)
  const added = current.filter((t) => !prevSet.has(t))
  const removed = (prev.tokens || []).filter((t) => !curSet.has(t))

  const firstSeen = { ...(prev.firstSeen || {}) }
  added.forEach((t) => { firstSeen[t] = now })
  // keep removed tokens' firstSeen so we can still date them if they return

  store[vcId] = { tokens: current, firstSeen, updatedAt: now }
  save(store)
  return { firstSeen, added, removed, baseline: false }
}
