/**
 * Token page chunk prefetching utility.
 * Separated from App.jsx to avoid circular imports
 * (TokenDiscoveryTable -> App -> DiscoverPage -> TokenDiscoveryTable).
 */

let chunkImports = []
let chunksPrefetched = false

/** Called once by App.jsx to register the lazy import factories. */
export function _registerChunkImports(imports) {
  chunkImports = imports
}

/**
 * Prefetch all token page JS chunks.
 * Call on hover over discovery table rows so chunks are
 * cached by the time the user clicks.
 */
export function prefetchTokenPageChunks() {
  if (chunksPrefetched || chunkImports.length === 0) return
  chunksPrefetched = true
  chunkImports.forEach(fn => fn())
}
