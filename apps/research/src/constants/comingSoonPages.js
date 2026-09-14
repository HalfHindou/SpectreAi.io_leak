/**
 * Coming Soon Pages — single source of truth.
 *
 * Used by:
 *   - navigation-sidebar.jsx (renders the "Coming Soon" badge + blocks clicks)
 *   - App.jsx <ComingSoonGuard> (blocks direct-URL / deep-link / programmatic
 *     navigation to these routes)
 *   - PageResults / mobile-search-overlay (blocks navigation from search)
 *
 * To pause a feature, add its page id here (see PAGE_PATHS in pageRoutes.js
 * for the id <-> path map). To unpause, remove it.
 */
import { PAGE_PATHS } from './pageRoutes'

export const COMING_SOON_PAGE_IDS = new Set([
  'monarch-ai-chat',
  'you',
  'brain',
  // 'discover' UNLOCKED 2026-06-23 (X-Dash social-pulse), RE-LOCKED 2026-06-24
  'discover',
  // 2026-08-18: UNLOCKED as the Intel Desk. The route no longer serves the
  // old /v1/intelligence/feed signal board (measured that day: 97 of 100 rows
  // had a signal type the bell already refuses, and exactly 1 carried the
  // accuracy data that was meant to be its headline stat). It now renders the
  // curated notifications feed, laned, with history and search.
  'search-engine',
  // 2026-07-28: 'liquidation-heatmap' UNLOCKED
  // 2026-08-24: 'ai-market-analysis' UNLOCKED. It is now the home of the
  // Seasonality board (founder: "do it in ai market analysis and we can give
  // more features in there"), and a locked page cannot host a feature. The two
  // visible defects on The Loop went with it: the tape was printing an i18n
  // error into the UI, and its header badge said LIVE unconditionally — it now
  // follows the last real HTTP response and turns amber when the data stops.
  // Re-lock by restoring 'ai-market-analysis' to this list.

  'world',
  'pulse',
  'social-zone',
  // x-dash relaunched 2026-06-09: box recent-window data flowing again (24h ~600 tokens)
  // 2026-06-14: the public "X Intelligence" page (Social-Intelligence dashboard,
  // /v1/social/x-bubbles, 1000 rows hourly) is served at /x-intelligence and is
  // UNLOCKED (id 'x-intelligence' absent here). The legacy graph at /x-bubbles
  // (id 'x-bubbles', labeled "X Bubbles") stays gated below.
  // 2026-06-15: 'potential-gainers' UNLOCKED — upstream /api/momentum/setups is
  // live + fresh (board regenerates ~every 20m; verified generated_at within
  // minutes of request) and useMomentumAccess already forces isPaid:true.
  // 2026-07-16: X Bubbles RE-LOCKED (Sunny) — legacy graph parked for now; the
  // Cosmos surfaces stay live (Cosmos tab in /x-dash + /bubbles).
  'x-bubbles',
  // 2026-06-24: X Bubble Map re-locked in the nav (desktop + mobile)
  // 2026-07-11: x-intel RE-LOCKED (Sunny) after the Signal Desk viewing session.
  'x-intel',
  // 2026-08-16: the three flagship pages shipped in 99b4d0492 (Agent Arena,
  // Market Cinema, World State) were never meant to reach users. Sunny pulled
  // their rows OUT of navTree.js entirely — not even a Coming Soon row — so
  // these ids exist here only to keep the ROUTES inert (typed URL, deep link,
  // stale bookmark, search result). The pages stay in the tree and stay open
  // on localhost (below). Remove these three ids when they go live.
  'arena',
  'market-cinema',
  'world-state',
])

// Dev-only: unlock the Brain page on localhost for preview/development, WITHOUT
// shipping it to production (stays "Coming Soon" for users). import.meta.env.DEV
// is true only under the Vite dev server. Must run before the path-map below.
if (import.meta.env?.DEV) COMING_SOON_PAGE_IDS.delete('brain')
// 2026-07-10: Monarch chat redesign in progress (grouped rail + live data
// blocks) — same dev-only unlock; prod stays gated until Sunny flips it.
if (import.meta.env?.DEV) COMING_SOON_PAGE_IDS.delete('monarch-ai-chat')
// 2026-08-16: the three flagship pages stay openable on localhost so the work
// can continue; prod stays gated until Sunny flips it.
if (import.meta.env?.DEV) COMING_SOON_PAGE_IDS.delete('arena')
if (import.meta.env?.DEV) COMING_SOON_PAGE_IDS.delete('market-cinema')
if (import.meta.env?.DEV) COMING_SOON_PAGE_IDS.delete('world-state')

// Path -> id map for fast pathname lookups.
const COMING_SOON_PATH_MAP = (() => {
  const map = new Map()
  for (const id of COMING_SOON_PAGE_IDS) {
    const path = PAGE_PATHS[id]
    if (path) map.set(path, id)
  }
  return map
})()

// Aliases for paths whose primary entry in PAGE_PATHS differs from the
// route declared in App.jsx (e.g. intelligence-feed -> /insights).
const COMING_SOON_PATH_ALIASES = new Map([
  ['/intelligence-feed', 'intelligence-feed'],
  ['/search', 'search-engine'],
])

// Routes whose subpaths must ALSO be blocked (dynamic params like
// /x-dash/token/:cgId, /x-dash/author/:authorId, etc).
const COMING_SOON_PATH_PREFIXES = []

const normalizePath = (path = '/') => {
  const cleaned = (path || '/').replace(/\/+$/, '')
  return cleaned || '/'
}

/**
 * True when navigating to `pathname` should be blocked because the
 * destination is a Coming Soon page.
 */
export const isComingSoonPath = (pathname) => {
  const normalized = normalizePath(pathname)
  if (COMING_SOON_PATH_MAP.has(normalized)) return true
  if (COMING_SOON_PATH_ALIASES.has(normalized)) return true
  return COMING_SOON_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

/**
 * Returns the page id for a Coming Soon pathname, or null when the
 * pathname is allowed.
 */
export const getComingSoonIdForPath = (pathname) => {
  const normalized = normalizePath(pathname)
  if (COMING_SOON_PATH_MAP.has(normalized)) return COMING_SOON_PATH_MAP.get(normalized)
  if (COMING_SOON_PATH_ALIASES.has(normalized)) return COMING_SOON_PATH_ALIASES.get(normalized)
  for (const prefix of COMING_SOON_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      const id = prefix.replace(/\/$/, '').replace(/^\//, '')
      return COMING_SOON_PAGE_IDS.has(id) ? id : null
    }
  }
  return null
}

export const fireComingSoonLockEvent = (detail = {}) => {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
      detail: { reason: 'coming-soon', ...detail },
    }))
  } catch { /* noop */ }
}

/**
 * Patches `window.history.pushState` / `replaceState` so any programmatic
 * navigation (React Router `navigate()`, `<Link>` clicks, manual history
 * pushes) toward a Coming Soon path is swallowed: the URL never changes,
 * the user stays on whatever page they're already viewing, and the
 * existing "Coming Soon" toast fires.
 *
 * Runs once on module load. Doesn't intercept direct address-bar entry —
 * that's handled by `<ComingSoonGuard>` in App.jsx, which renders null
 * (blank content area inside the AppShell chrome) for those rare cases.
 */
let historyPatched = false
export function patchHistoryForComingSoon() {
  if (historyPatched || typeof window === 'undefined') return
  historyPatched = true
  const origPush = window.history.pushState.bind(window.history)
  const origReplace = window.history.replaceState.bind(window.history)

  function extractPath(urlArg) {
    if (!urlArg) return null
    try {
      if (typeof urlArg === 'string') {
        if (urlArg.startsWith('/')) return urlArg.split('?')[0].split('#')[0]
        const u = new URL(urlArg, window.location.href)
        return u.pathname
      }
      if (urlArg.pathname) return urlArg.pathname
    } catch { /* noop */ }
    return null
  }

  window.history.pushState = function patchedPush(state, title, url) {
    const path = extractPath(url)
    if (path && isComingSoonPath(path)) {
      fireComingSoonLockEvent({
        source: 'history.pushState',
        path,
        itemId: getComingSoonIdForPath(path),
      })
      return
    }
    return origPush(state, title, url)
  }

  window.history.replaceState = function patchedReplace(state, title, url) {
    const path = extractPath(url)
    // Allow same-path replaceState (query/hash updates on the current page).
    if (path && isComingSoonPath(path) && path !== window.location.pathname) {
      fireComingSoonLockEvent({
        source: 'history.replaceState',
        path,
        itemId: getComingSoonIdForPath(path),
      })
      return
    }
    return origReplace(state, title, url)
  }
}

if (typeof window !== 'undefined') patchHistoryForComingSoon()
