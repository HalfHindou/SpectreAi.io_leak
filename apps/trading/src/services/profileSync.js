/**
 * Profile Sync Service (Trading App)
 * Syncs user settings/profile to server on change, fetches on login.
 * Works with both Express dev server and Vercel serverless.
 */

const API_BASE = '/api/user'

let _authToken = null

/**
 * Set the auth token for API calls (Privy access token).
 */
export function setAuthToken(token) {
  _authToken = token
}

/**
 * Clear auth token on logout.
 */
export function clearAuthToken() {
  _authToken = null
}

/**
 * Get current auth token (for sync checks).
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
 */
export async function fetchProfile() {
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
 */
export async function pushProfile(profile, settings) {
  if (!_authToken) return false

  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ profile, settings }),
    })
    return res.ok
  } catch (err) {
    console.error('[profileSync] pushProfile error:', err.message)
    return false
  }
}

/**
 * Fetch user watchlist from server.
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
