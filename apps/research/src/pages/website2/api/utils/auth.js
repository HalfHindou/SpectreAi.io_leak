export const API_BASE = 'https://api.spectreai.io'

const API_KEY = 'spectre_api_key'
const API_SECRET = 'spectre_api_secret'

// SEC-20260513-001/002 close (2026-05-18): Replaced the dead JWT flow
// with the API-key auth model that the backend actually exposes
// (auth-v2.js at /opt/spectre-data-api on Sunny's Hetzner box).
//
// API keys ARE designed to be stored client-side (same as Stripe / OpenAI
// developer portals). The security boundary is the tier-based daily_limit
// and the read-only nature of the explorer/analyst tiers - not "hide the
// key from JavaScript". XSS-readable storage is acceptable for the
// "developer copies their key into curl scripts" use case.
//
// We keep tokens in sessionStorage (not localStorage) by default so a
// closed-tab user has to re-enter their key. Power users can paste in
// once per session - acceptable trade-off for the rare-access pattern
// (most flows hit the key via copy-paste-into-curl, not via the dashboard).

export function getApiKey() {
  return sessionStorage.getItem(API_KEY)
}

export function getApiSecret() {
  return sessionStorage.getItem(API_SECRET)
}

export function setApiKey(apiKey, apiSecret) {
  if (apiKey) sessionStorage.setItem(API_KEY, apiKey)
  if (apiSecret) sessionStorage.setItem(API_SECRET, apiSecret)
  // Clean up any legacy localStorage entries from the dead JWT flow.
  try {
    localStorage.removeItem('spectre_api_jwt')
    localStorage.removeItem('spectre_api_refresh')
    localStorage.removeItem(API_KEY)
    localStorage.removeItem(API_SECRET)
  } catch { /* ignore */ }
}

export function clearApiKey() {
  sessionStorage.removeItem(API_KEY)
  sessionStorage.removeItem(API_SECRET)
  try {
    localStorage.removeItem('spectre_api_jwt')
    localStorage.removeItem('spectre_api_refresh')
    localStorage.removeItem(API_KEY)
    localStorage.removeItem(API_SECRET)
  } catch { /* ignore */ }
}

export function isAuthenticated() {
  return Boolean(getApiKey())
}

// Async server-side validation - confirms the key is still active.
// Replaces the old client-side JWT decode which was forgeable.
export async function isAuthenticatedAsync() {
  const apiKey = getApiKey()
  if (!apiKey) return false
  try {
    const res = await fetch(`${API_BASE}/v1/auth/usage`, {
      headers: { 'X-API-Key': apiKey },
    })
    if (res.status === 200) return true
    if (res.status === 401) {
      // Key revoked or invalid
      clearApiKey()
      return false
    }
    return false
  } catch {
    // Network failure - don't lock out, return presence check
    return Boolean(apiKey)
  }
}

export async function apiCall(path, options = {}) {
  const apiKey = getApiKey()
  if (!apiKey) {
    window.location.href = '/website2/api/login'
    return null
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
    ...options.headers,
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (res.status === 401) {
    clearApiKey()
    window.location.href = '/website2/api/login'
    return null
  }
  return res
}
