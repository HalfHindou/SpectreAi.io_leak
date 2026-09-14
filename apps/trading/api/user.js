/**
 * Vercel Serverless - User Profile Sync (Trading App)
 * Handles /api/user/profile and /api/user/watchlist
 *
 * Auth: Privy JWT verification (cryptographic, not base64 decode)
 * Storage: Vercel KV (persistent) with in-memory fallback for local dev
 */

import { verifyPrivyToken } from './_lib/auth.js'
import { getUser, setUser } from './_lib/kv.js'
import { userRateLimit } from './_lib/ratelimit.js'

const ALLOWED_SETTINGS = [
  'dayMode', 'appDisplayMode', 'marketMode', 'navSidebarCollapsed',
  'chartViewMode', 'chartTimeframe', 'chartType',
  'currency', 'language', 'tempUnit', 'timeFormat',
  'showMoodWall', 'tokenColoring', 'infoMode',
]

const IMAGE_HOST_ALLOWLIST = [
  'assets.coingecko.com',
  'coin-images.coingecko.com',
  's2.coinmarketcap.com',
  'pbs.twimg.com',
  'abs.twimg.com',
  'imgur.com',
  'i.imgur.com',
  'privy.io',
  'public.blob.vercel-storage.com',
]

// Inline base64-encoded image (user-uploaded avatar). Client-side compresses
// to 256x256 @ 0.85 JPEG quality (~30-50KB raw -> ~40-65KB base64). Cap at
// 200KB to block abuse but leave headroom for slightly larger PNGs/WebPs.
// img/svg+xml is intentionally EXCLUDED - SVG can carry <script> payloads
// that browsers execute when the URL renders as an <img src=...>.
const DATA_IMAGE_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/
const MAX_DATA_URL_LEN = 200_000

function isSafeImageUrl(url) {
  if (typeof url !== 'string') return false
  // Branch 1: inline data URL (user-uploaded avatar)
  if (url.startsWith('data:')) {
    if (url.length > MAX_DATA_URL_LEN) return false
    return DATA_IMAGE_RE.test(url)
  }
  // Branch 2: https URL on the host allowlist (provider pfps, hosted logos)
  if (url.length > 500) return false
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return IMAGE_HOST_ALLOWLIST.some(allowed =>
    host === allowed || host.endsWith('.' + allowed)
  )
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const userId = await verifyPrivyToken(req)
  if (!userId) {
    // Diagnostic logging for the cross-app profile sync 401 issue
    // (will surface in Vercel function logs at vercel.com -> Project -> Logs).
    // Tells us: was env var set? was a token actually sent? cookie present?
    try {
      console.warn('[user] 401 unauthorized', {
        appIdSet: !!process.env.PRIVY_APP_ID,
        appIdLen: (process.env.PRIVY_APP_ID || '').length,
        hasAuthHeader: !!(req.headers.authorization && req.headers.authorization.startsWith('Bearer ')),
        hasCookie: !!(req.headers.cookie && req.headers.cookie.includes('privy-token=')),
        origin: req.headers.origin || null,
      })
    } catch { /* logging is best-effort */ }
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const route = req.query.route || ''

  // GET /api/user/profile
  if (route === 'profile' && req.method === 'GET') {
    const userData = await getUser(userId)
    return res.json({
      userId,
      profile: userData.profile,
      settings: userData.settings,
      updatedAt: userData.updatedAt,
    })
  }

  // PUT /api/user/profile
  if (route === 'profile' && req.method === 'PUT') {
    // 10 writes per minute per user across all /api/user/* PUTs. Defends
    // against a stolen JWT spamming writes to bloat KV or grief settings.
    if (await userRateLimit(res, { bucket: 'user-write', userId, max: 10, windowMs: 60_000 })) return
    const { profile, settings } = req.body || {}
    const userData = await getUser(userId)

    if (profile && typeof profile === 'object') {
      if (typeof profile.name === 'string') userData.profile.name = profile.name.slice(0, 80)
      if (typeof profile.imageUrl === 'string' && isSafeImageUrl(profile.imageUrl)) {
        userData.profile.imageUrl = profile.imageUrl
      }
    }

    if (settings && typeof settings === 'object') {
      for (const key of ALLOWED_SETTINGS) {
        if (key in settings) userData.settings[key] = settings[key]
      }
    }

    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({ ok: true, updatedAt: userData.updatedAt })
  }

  // GET /api/user/watchlist
  if (route === 'watchlist' && req.method === 'GET') {
    const userData = await getUser(userId)
    return res.json({
      userId,
      watchlist: userData.watchlist,
      updatedAt: userData.updatedAt,
    })
  }

  // PUT /api/user/watchlist
  if (route === 'watchlist' && req.method === 'PUT') {
    if (await userRateLimit(res, { bucket: 'user-write', userId, max: 10, windowMs: 60_000 })) return
    const { watchlist } = req.body || {}
    if (!Array.isArray(watchlist)) {
      return res.status(400).json({ error: 'watchlist must be an array' })
    }

    const userData = await getUser(userId)
    userData.watchlist = watchlist.slice(0, 200).map((t) => ({
      symbol: String(t.symbol || '').slice(0, 32),
      name: String(t.name || '').slice(0, 128),
      address: String(t.address || '').slice(0, 64),
      networkId: Number(t.networkId) || 0,
      pinned: Boolean(t.pinned),
      // 2026-05-12 lockdown: validate logo against the same image-host
      // allowlist as profile.imageUrl. Previously any string accepted —
      // `javascript:alert(1)`, tracker pixels, or `data:` HTML payloads.
      logo: t.logo && isSafeImageUrl(t.logo) ? t.logo : undefined,
      isStock: Boolean(t.isStock),
    }))

    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({ ok: true, count: userData.watchlist.length, updatedAt: userData.updatedAt })
  }

  return res.status(404).json({ error: 'Not found' })
}
