/**
 * Research Zone localStorage service.
 * Single source of truth for all RZ personalization keys.
 * All reads return safe defaults on parse failure.
 */

const KEYS = {
  annotations: (symbol) => `spectre-rz-annotations:${(symbol || '').toUpperCase()}`,
  history: 'spectre-rz-history',
  compare: 'spectre-rz-compare',
  whatif: (symbol) => `spectre-rz-whatif:${(symbol || '').toUpperCase()}`,
  session: 'spectre-rz-session',
  chartSetups: 'spectre-rz-chart-setups',
}

// ── Cross-device sync plumbing ──────────────────────────────────────────────
// The personal families (annotations, what-if, chart setups, TA drawings)
// sync to the server per user (services/userDataSync.js). Every local write
// stamps a per-slot timestamp in the meta map — that stamp is what the
// hydrate merge compares (LWW per slot), so a note edited on the phone beats
// the desktop's stale copy without guessing from the data shapes themselves.
// A window event tells the sync layer a push is due.
export const RZ_SYNC_EVENT = 'spectre-rz-personal-write'
export const RZ_SYNC_META_KEY = 'spectre-rz-sync-meta'

export function getRzSyncMeta() {
  const m = safeGet(RZ_SYNC_META_KEY, {})
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
}

export function setRzSyncMeta(meta) {
  safeSet(RZ_SYNC_META_KEY, meta && typeof meta === 'object' ? meta : {})
}

/** Record that slot (`ann:SYM` / `whatif:SYM` / `setups:SYM` / `draw:SYM`)
 *  changed locally just now, and wake the sync layer. */
export function stampRzWrite(slot) {
  if (!slot) return
  const meta = getRzSyncMeta()
  meta[slot] = Date.now()
  setRzSyncMeta(meta)
  try { window.dispatchEvent(new CustomEvent(RZ_SYNC_EVENT, { detail: { slot } })) } catch { /* SSR */ }
}

/** A resumable session older than this is not worth offering. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const HISTORY_LIMIT = 20

/** How many tokens keep their own chart setup before the oldest is dropped. */
const SETUP_LIMIT = 24

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

// History — recently viewed tokens
export function getHistory() {
  const list = safeGet(KEYS.history, [])
  return Array.isArray(list) ? list : []
}

export function pushHistory({ symbol, name, logo, isStock }) {
  if (!symbol) return
  const sym = symbol.toUpperCase()
  const list = getHistory().filter(item => item.symbol !== sym)
  list.unshift({
    symbol: sym,
    name: name || sym,
    logo: logo || null,
    isStock: !!isStock,
    lastViewedAt: Date.now(),
  })
  safeSet(KEYS.history, list.slice(0, HISTORY_LIMIT))
}

/**
 * Fill in a stored entry's identity IN PLACE (same slot, same timestamp).
 *
 * A token's name and logo resolve a beat AFTER its symbol lands, and history is
 * pushed on the symbol change — so a freshly opened token was stored as
 * `{ name: 'ETH', logo: null }` and, because it is never re-pushed, stayed that
 * way forever (the quick switcher then drew a letter chip instead of the logo).
 * Only fills gaps and upgrades a placeholder name; never reorders, never
 * creates a row, and returns false when nothing changed so callers can skip a
 * re-render.
 */
export function updateHistoryMeta({ symbol, name, logo, isStock }) {
  if (!symbol) return false
  const sym = String(symbol).toUpperCase()
  const list = getHistory()
  const idx = list.findIndex(item => item.symbol === sym)
  if (idx === -1) return false
  const entry = list[idx]
  const nextName = name && name !== sym ? name : entry.name
  const nextLogo = logo || entry.logo || null
  const nextIsStock = typeof isStock === 'boolean' ? isStock : entry.isStock
  if (entry.name === nextName && entry.logo === nextLogo && entry.isStock === nextIsStock) return false
  list[idx] = { ...entry, name: nextName, logo: nextLogo, isStock: nextIsStock }
  return safeSet(KEYS.history, list)
}

export function clearHistory() {
  safeRemove(KEYS.history)
}

// Compare — overlay token (stored as { symbol, cgId, name, logo })
export function getCompareToken() {
  const raw = safeGet(KEYS.compare, null)
  if (!raw) return null
  if (typeof raw === 'string') return { symbol: raw.toUpperCase(), cgId: null, name: null, logo: null }
  if (typeof raw === 'object' && raw.symbol) {
    return {
      symbol: String(raw.symbol).toUpperCase(),
      cgId: raw.cgId || null,
      name: raw.name || null,
      logo: raw.logo || null,
    }
  }
  return null
}

export function setCompareToken(token) {
  if (!token) {
    safeRemove(KEYS.compare)
    return
  }
  safeSet(KEYS.compare, {
    symbol: String(token.symbol || '').toUpperCase(),
    cgId: token.cgId || null,
    name: token.name || null,
    logo: token.logo || null,
  })
}

// Back-compat shims
export function getCompareSymbol() {
  return getCompareToken()?.symbol || null
}
export function setCompareSymbol(symbol) {
  if (!symbol) { safeRemove(KEYS.compare); return }
  setCompareToken({ symbol, cgId: null, name: null, logo: null })
}

// What-if — last input per token
export function getWhatIf(symbol) {
  return safeGet(KEYS.whatif(symbol), null)
}

export function setWhatIf(symbol, payload) {
  if (!symbol || !payload) return
  safeSet(KEYS.whatif(symbol), payload)
  stampRzWrite(`whatif:${String(symbol).toUpperCase()}`)
}

// Annotations — pinned notes per token
export function getAnnotations(symbol) {
  const list = safeGet(KEYS.annotations(symbol), [])
  return Array.isArray(list) ? list : []
}

export function saveAnnotations(symbol, annotations) {
  if (!symbol) return
  const safe = Array.isArray(annotations) ? annotations : []
  safeSet(KEYS.annotations(symbol), safe)
  stampRzWrite(`ann:${String(symbol).toUpperCase()}`)
}

export function addAnnotation(symbol, annotation) {
  const list = getAnnotations(symbol)
  list.push(annotation)
  saveAnnotations(symbol, list)
  return list
}

export function updateAnnotation(symbol, id, patch) {
  const list = getAnnotations(symbol).map(a => (a.id === id ? { ...a, ...patch } : a))
  saveAnnotations(symbol, list)
  return list
}

export function removeAnnotation(symbol, id) {
  const list = getAnnotations(symbol).filter(a => a.id !== id)
  saveAnnotations(symbol, list)
  return list
}

// ── Last session — "pick up where you left off" ─────────────────────────────
// The recent-token history says WHAT was opened; this says how it was being
// LOOKED at, so returning to /research-zone can offer the desk exactly as it
// was left instead of resetting to the default token (beta feedback, 08-24).

/** Record the token + chart setup currently on screen. */
export function saveSession(session) {
  if (!session?.symbol) return false
  return safeSet(KEYS.session, { ...session, at: Date.now() })
}

/**
 * The last session, or null when there is nothing worth resuming — no record,
 * a stale one, or one that names no token.
 */
export function getSession() {
  const s = safeGet(KEYS.session, null)
  if (!s?.symbol) return null
  if (!Number.isFinite(s.at) || Date.now() - s.at > SESSION_MAX_AGE_MS) return null
  return s
}

export function clearSession() {
  return safeRemove(KEYS.session)
}

// ── Per-token chart setup — "what timeframe was I on for THIS project" ──────
// chartTimeframe / chartType / chartTypeMobile are single GLOBAL settings, so
// moving between tokens carried one project's timeframe onto the next, and the
// one you had chosen for a project was gone the moment you looked at anything
// else. These remember the setup per token and hand it back on return.

const upperKey = (symbol) => (symbol ? String(symbol).toUpperCase() : '')

/** Remember the chart setup the reader chose for this token. */
export function saveChartSetup(symbol, setup) {
  const key = upperKey(symbol)
  if (!key || !setup) return false
  const all = safeGet(KEYS.chartSetups, {}) || {}
  all[key] = { ...setup, at: Date.now() }
  // Keep only the most recently used: an unbounded map would grow with every
  // token ever opened, and every write pays the cost of the whole JSON.
  const keys = Object.keys(all)
  if (keys.length > SETUP_LIMIT) {
    keys.sort((a, b) => (all[b]?.at || 0) - (all[a]?.at || 0))
      .slice(SETUP_LIMIT)
      .forEach((k) => { delete all[k] })
  }
  const ok = safeSet(KEYS.chartSetups, all)
  stampRzWrite(`setups:${key}`)
  return ok
}

/** The chart setup last used for this token, or null. */
export function getChartSetup(symbol) {
  const key = upperKey(symbol)
  if (!key) return null
  const all = safeGet(KEYS.chartSetups, {}) || {}
  const s = all[key]
  return s && (s.chartTimeframe || s.chartType || s.chartTypeMobile) ? s : null
}

export const RZ_STORAGE_KEYS = KEYS
