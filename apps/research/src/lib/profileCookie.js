/**
 * Shared profile cookie helper.
 *
 * Bridges anonymous profile name across trade.spectreai.io and app.spectreai.io.
 * Both subdomains read/write a single cookie at `.spectreai.io` so a name set
 * on one app shows up in the other's greeting without any sign-in.
 *
 * Only the NAME goes in the cookie. Avatar images (base64 data URLs) are too
 * large for cookies and stay per-app in localStorage.
 */

const COOKIE_NAME = 'spectre_name'
const MAX_LEN = 60
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

function getCookieDomain() {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
  if (host.endsWith('.spectreai.io') || host === 'spectreai.io') {
    return '.spectreai.io'
  }
  return null
}

export function readNameCookie() {
  if (typeof document === 'undefined') return ''
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
  if (!raw) return ''
  try {
    return decodeURIComponent(raw.slice(COOKIE_NAME.length + 1)).slice(0, MAX_LEN)
  } catch {
    return ''
  }
}

export function writeNameCookie(name) {
  if (typeof document === 'undefined') return
  const trimmed = (name || '').trim().slice(0, MAX_LEN)
  const domain = getCookieDomain()
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(trimmed)}`,
    'path=/',
    `max-age=${trimmed ? ONE_YEAR_SECONDS : 0}`,
    'SameSite=Lax',
  ]
  if (domain) parts.push(`Domain=${domain}`)
  if (isHttps) parts.push('Secure')
  document.cookie = parts.join('; ')
}
