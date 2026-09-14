/**
 * Profile Sync Service
 * Syncs user settings/profile to server on change, fetches on login.
 * Works with both Express dev server and Vercel serverless.
 */

const API_BASE = '/api/user'

let _authToken = null
let _getFreshToken = null

/**
 * Set the auth token for API calls (Privy access token).
 * Call this when user logs in.
 */
export function setAuthToken(token) {
  _authToken = token
}

/**
 * Register an async token getter (Privy's getAccessToken — it refreshes
 * internally). Privy access tokens live ~1h; a boot-time snapshot silently
 * 401s every push after that, which is how a long-lived iOS PWA session ends
 * up with the server holding stale settings that the next boot's merge then
 * re-applies. Refreshing through the getter before each request keeps the
 * push path alive for the life of the session.
 */
export function setAuthTokenProvider(fn) {
  _getFreshToken = fn
}

async function refreshAuthToken() {
  if (!_getFreshToken) return _authToken
  try {
    const t = await _getFreshToken()
    if (t) _authToken = t
  } catch { /* keep the last known token */ }
  return _authToken
}

/**
 * Clear auth token on logout.
 */
export function clearAuthToken() {
  _authToken = null
}

/**
 * Get the current auth token (for use by other services).
 */
export function getAuthToken() {
  return _authToken
}

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (_authToken) {
    headers['Authorization'] = `Bearer ${_authToken}`
  }
  return headers
}

/**
 * Fetch user profile + settings from server.
 * Returns { profile, settings, updatedAt } or null on error.
 */
export async function fetchProfile() {
  await refreshAuthToken()
  if (!_authToken) return null

  try {
    const res = await fetch(`${API_BASE}/profile`, { headers: getHeaders() })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error('[profileSync] fetchProfile error:', err.message)
    return null
  }
}

/**
 * Push profile + settings to server.
 * Debounce this on the caller side.
 * keepalive: true lets the request survive a tab close / app background
 * (pagehide flush) — same contract as pushResearchWatchlists.
 */
export async function pushProfile(profile, settings, { keepalive = false } = {}) {
  await refreshAuthToken()
  if (!_authToken) return false

  const send = () => fetch(`${API_BASE}/profile`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ profile, settings }),
    keepalive,
  })

  try {
    let res = await send()
    if (res.status === 401 && _getFreshToken) {
      // Token aged out between refresh and request — one fresh retry.
      await refreshAuthToken()
      res = await send()
    }
    if (!res.ok) console.warn(`[profileSync] pushProfile rejected: ${res.status}`)
    return res.ok
  } catch (err) {
    console.error('[profileSync] pushProfile error:', err.message)
    return false
  }
}

/**
 * Fetch user watchlist from server.
 * Returns { watchlist, updatedAt } or null on error.
 */
export async function fetchWatchlist() {
  if (!_authToken) return null

  try {
    const res = await fetch(`${API_BASE}/watchlist`, { headers: getHeaders() })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error('[profileSync] fetchWatchlist error:', err.message)
    return null
  }
}

/**
 * Push watchlist to server.
 */
export async function pushWatchlist(watchlist) {
  if (!_authToken) return false

  try {
    const res = await fetch(`${API_BASE}/watchlist`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ watchlist }),
    })
    return res.ok
  } catch (err) {
    console.error('[profileSync] pushWatchlist error:', err.message)
    return false
  }
}

/**
 * Research watchlists = the richer named-list structure (crypto + stock) the
 * research app uses, stored under its own server field so it never collides
 * with the trading app's flat `watchlist`. Cross-device sync lives here.
 *
 * Returns { watchlists: { crypto, stocks } | null, updatedAt } or null on error.
 * NOTE: null means the request FAILED (don't treat as "server is empty");
 * a fresh user returns { watchlists: null } with a 200.
 */
export async function fetchResearchWatchlists() {
  if (!_authToken) return null

  try {
    const res = await fetch(`${API_BASE}/watchlists-research`, { headers: getHeaders() })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error('[profileSync] fetchResearchWatchlists error:', err.message)
    return null
  }
}

/**
 * Push the research watchlists payload ({ crypto, stocks }) to the server.
 * keepalive: true lets the request survive a tab close (pagehide flush).
 */
export async function pushResearchWatchlists(watchlists, { keepalive = false } = {}) {
  if (!_authToken) return false

  try {
    const res = await fetch(`${API_BASE}/watchlists-research`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ watchlists }),
      keepalive,
    })
    return res.ok
  } catch (err) {
    console.error('[profileSync] pushResearchWatchlists error:', err.message)
    return false
  }
}

/**
 * Generic per-field user-data sync (media library, RZ personal data, ...).
 * GET /api/user/<route> returns the stored blob; PUT replaces it whole.
 * Same auth/token/keepalive contract as the watchlists pair above.
 */
export async function fetchUserBlob(route) {
  await refreshAuthToken()
  if (!_authToken) return null

  try {
    const res = await fetch(`${API_BASE}/${route}`, { headers: getHeaders() })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error(`[profileSync] fetchUserBlob(${route}) error:`, err.message)
    return null
  }
}

export async function pushUserBlob(route, body, { keepalive = false } = {}) {
  await refreshAuthToken()
  if (!_authToken) return false

  try {
    const res = await fetch(`${API_BASE}/${route}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
      keepalive,
    })
    if (!res.ok) console.warn(`[profileSync] pushUserBlob(${route}) rejected: ${res.status}`)
    return res.ok
  } catch (err) {
    console.error(`[profileSync] pushUserBlob(${route}) error:`, err.message)
    return false
  }
}
