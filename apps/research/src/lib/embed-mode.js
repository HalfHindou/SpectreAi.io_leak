// Showcase-embed detection - true when the research app runs inside the
// spectreai.io landing-page iframe (?embed=showcase) or any other
// cross-origin frame. Mirrors the module-level IIFE in
// hooks/useWalletBalance.js. Computed once at module load - the value
// cannot change for the lifetime of the page.
//
// Used to skip work that is wasted or actively harmful inside the
// embed: geolocation prompts (blocked by the embedder's
// Permissions-Policy, logs a console violation), the /api/geo IP
// lookup (burns the rate limit for a demo frame) and optional data
// probes whose failures would dirty the host page's console.
export const IS_SHOWCASE_EMBED = (() => {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
})()
