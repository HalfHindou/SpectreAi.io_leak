/**
 * Route chunk prefetching — warms a page's lazy JS chunk on nav-item hover so
 * the click -> first paint is instant (the chunk is already downloaded, and
 * with the Phase 2 PWA runtimeCaching it's also in the SW cache for next time).
 *
 * Source of truth is import.meta.glob over the page entry files — there is NO
 * hand-maintained parallel import list to drift from App.jsx. A pageId that
 * doesn't resolve to a folder just no-ops; prefetch can never break real
 * navigation (that goes through getPathForPageId independently).
 */
const _modules = import.meta.glob('../pages/*/index.jsx')

// folder name -> dynamic import loader, derived from the glob keys (robust to
// however Vite formats the key prefix).
const _byFolder = {}
for (const key in _modules) {
  const m = key.match(/pages\/([^/]+)\/index\.jsx$/)
  if (m) _byFolder[m[1]] = _modules[key]
}

// Nav pageId -> page folder, only where they differ from the id itself.
const ID_TO_FOLDER = {
  'research-platform': 'home',
  'ai-screener': 'token',
  'monarch-ai-chat': 'monarch-chat',
  'ai-media-center': 'media-center',
}

const _prefetched = new Set()

export function prefetchRoute(pageId) {
  if (!pageId || _prefetched.has(pageId)) return
  const folder = ID_TO_FOLDER[pageId] || pageId
  const loader = _byFolder[folder]
  if (!loader) return
  _prefetched.add(pageId)
  // Fire-and-forget; module cache makes repeat calls free. On failure, allow a
  // later retry rather than poisoning the set.
  Promise.resolve()
    .then(loader)
    .catch(() => { _prefetched.delete(pageId) })
}

// ── PR-5 (perf): hover-intent helper for data/route prewarm on rows ────────
//
// Spread onto any clickable token row / card / search result:
//   <div {...hoverIntent(() => { prewarmResearchZone(sym); prefetchRoute('research-zone') })} onClick={...}>
//
// - 80ms intent delay: scrolling a dense table across 30 rows must not fire
//   30 prefetches; a deliberate hover does.
// - onPointerDown fires immediately (touch never hovers) - the prewarm still
//   beats the route transition by the chunk-load + render gap.
// - Connection guards: skip on Save-Data and 2g.
// - Session cap (data prefetches): hard stop so a pathological hover pattern
//   can't multiply API load. Route-chunk prefetches stay uncapped (SW-cached
//   static assets, already shipped behavior on the sidebar).

const DATA_PREFETCH_SESSION_CAP = 40
let _dataPrefetches = 0

function _connectionAllowsPrefetch() {
  try {
    const c = navigator.connection
    if (!c) return true
    if (c.saveData) return false
    if (typeof c.effectiveType === 'string' && /(^|-)2g$/.test(c.effectiveType)) return false
  } catch { /* ignore */ }
  return true
}

/** Gate a DATA prewarm against connection quality + the session cap. */
export function allowDataPrefetch() {
  if (!_connectionAllowsPrefetch()) return false
  if (_dataPrefetches >= DATA_PREFETCH_SESSION_CAP) return false
  _dataPrefetches++
  return true
}

/**
 * Returns pointer handlers implementing hover-intent. `fn` runs at most once
 * per element instance per render (cheap dedup lives in the prewarm targets'
 * own _deduped caches, so repeat fires are free anyway).
 */
export function hoverIntent(fn, delay = 80) {
  let timer = null
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null } }
  return {
    onPointerEnter: () => {
      cancel()
      timer = setTimeout(() => { timer = null; try { fn() } catch { /* never break UI */ } }, delay)
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // Touch never produces a hover - fire on first contact instead.
    onPointerDown: () => {
      cancel()
      try { fn() } catch { /* never break UI */ }
    },
  }
}
