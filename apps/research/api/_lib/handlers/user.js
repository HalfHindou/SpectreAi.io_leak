/**
 * Vercel Serverless - User Profile Sync
 * Handles /api/user/profile and /api/user/watchlist
 *
 * Auth: Privy JWT verification (cryptographic, not base64 decode)
 * Storage: Vercel KV (persistent) with in-memory fallback for local dev
 */

import { verifyPrivyToken } from '../auth.js'
import { getUser, setUser } from '../kv.js'
import { userRateLimit } from '../ratelimit.js'

// Must cover every key the client pushes (SYNC_KEYS in useSettingsStore.js) -
// a key missing here is silently dropped and that setting never syncs across
// devices. aiChartsFavorites is additionally sanitized below (list-shaped).
const ALLOWED_SETTINGS = [
  'dayMode', 'appDisplayMode', 'marketMode', 'navSidebarCollapsed',
  'chartViewMode', 'chartTimeframe', 'chartType', 'chartTypeMobile',
  'currency', 'language', 'tempUnit', 'timeFormat',
  'showMoodWall', 'moodWallBrightness', 'tokenColoring', 'infoMode',
  'pinnedCCTab', 'gmWidgets', 'gmSound', 'gmBg', 'gmBgPaused',
  'welcomeSectionsCollapsed',
  'aiChartsFavorites', 'aiChartsAdded', 'aiChartsOrder', 'aiChartsType',
  'proThemeLook', 'proThemeBg', 'proThemePaper', 'proThemeDepth',
  'proDataPlane', 'proThemeFocus', 'proThemePrevDay',
  'liteLook', 'liteTodayPanels', 'liteTodayOrder', 'liteBg', 'litePaperBg',
  'liteChartStyle', 'liteMusicSource', 'liteMusicVolume',
  'scrollTint',
]

// ── Media library + RZ personal data (whole-blob sync fields) ──────────────
// The client owns the merge (src/services/userDataSync.js); the server only
// caps sizes so one user record can't balloon the KV row. Mirrors
// packages/server/routes/users.js.

const MAX_USER_BLOB_JSON = 500_000

const capArray = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : [])
const capMap = (obj, n) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out = {}
  // Key cap is generous (podcast-episode ids are long GUIDs); truncating a
  // key would silently orphan its value on the round-trip.
  for (const key of Object.keys(obj).slice(0, n)) out[String(key).slice(0, 160)] = obj[key]
  return out
}

const sanitizeMediaBlob = (m) => ({
  savedItems: capArray(m.savedItems, 300),
  recentlyWatched: capArray(m.recentlyWatched, 50),
  playlists: capArray(m.playlists, 50),
  podcastResume: capMap(m.podcastResume, 120),
  podcastRate: Number.isFinite(m.podcastRate) ? m.podcastRate : undefined,
  podcastCaptionsOn: typeof m.podcastCaptionsOn === 'boolean' ? m.podcastCaptionsOn : undefined,
  autoPlay: typeof m.autoPlay === 'boolean' ? m.autoPlay : undefined,
})

const sanitizeRzBlob = (rz) => {
  const perSymbolArrays = (map, perCap) => {
    const out = capMap(map, 150)
    for (const sym of Object.keys(out)) out[sym] = capArray(out[sym], perCap)
    return out
  }
  return {
    annotations: perSymbolArrays(rz.annotations, 100),
    whatif: capMap(rz.whatif, 150),
    taDraw: perSymbolArrays(rz.taDraw, 40),
    chartSetups: capMap(rz.chartSetups, 48),
    meta: capMap(rz.meta, 600),
  }
}

// Only allow https: image URLs from known image hosts. Blocks javascript:,
// data:, file:, and other vectors that would render as active content.
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

// KOL Radar follow-list handle validation (mirrors dev routes/users.js).
const KOL_HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/

// Sanitize one watchlist token (shared by the flat /watchlist route and the
// richer research /watchlists-research route). Mirrors the inline sanitizer in
// the watchlist PUT: caps string lengths, drops unsafe logo URLs (stored-XSS +
// telemetry surface), coerces types.
function sanitizeWatchlistToken(t) {
  return {
    symbol: String(t?.symbol || '').slice(0, 32),
    name: String(t?.name || '').slice(0, 128),
    address: String(t?.address || '').slice(0, 64),
    networkId: Number(t?.networkId) || 0,
    pinned: Boolean(t?.pinned),
    logo: t?.logo && isSafeImageUrl(t.logo) ? t.logo : undefined,
    isStock: Boolean(t?.isStock),
  }
}

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
    // against a stolen JWT spamming writes to bloat KV or grief the user's
    // settings. Legit clients batch writes; this is plenty.
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
      if ('aiChartsFavorites' in settings) {
        userData.settings.aiChartsFavorites = Array.isArray(settings.aiChartsFavorites)
          ? settings.aiChartsFavorites.slice(0, 200).map((s) => String(s).slice(0, 32))
          : []
      }
    }

    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({ ok: true, updatedAt: userData.updatedAt })
  }

  // GET /api/user/kol-follows  - the handles of KOLs this user follows (KOL Radar)
  if (route === 'kol-follows' && req.method === 'GET') {
    const userData = await getUser(userId)
    return res.json({
      follows: Array.isArray(userData.kolFollows) ? userData.kolFollows : [],
      updatedAt: userData.updatedAt,
    })
  }

  // PUT /api/user/kol-follows  - replace the user's followed-KOL handle list (cap 200)
  if (route === 'kol-follows' && req.method === 'PUT') {
    // Shares the user-write bucket so total user writes are capped.
    if (await userRateLimit(res, { bucket: 'user-write', userId, max: 10, windowMs: 60_000 })) return
    const { follows } = req.body || {}
    if (!Array.isArray(follows)) {
      return res.status(400).json({ error: 'follows must be an array' })
    }
    // sanitize: strip @, validate handle chars, de-dupe (case-insensitive), cap 200
    const seen = new Set()
    const clean = []
    for (const raw of follows) {
      const h = String(raw || '').replace(/^@/, '').trim()
      if (!KOL_HANDLE_RE.test(h)) continue
      const key = h.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      clean.push(h)
      if (clean.length >= 200) break
    }

    const userData = await getUser(userId)
    userData.kolFollows = clean
    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({ ok: true, count: clean.length, updatedAt: userData.updatedAt })
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
    // Shares the bucket with profile-PUT so total user writes are capped.
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
      // allowlist used by profile.imageUrl. Previously any string was
      // accepted including `javascript:alert(1)` and tracker pixel URLs.
      // Stored XSS surface when the frontend renders <img src={logo}>
      // for some logos AND telemetry exfil channel (img src GETs fire
      // even when scheme is rejected). Drop invalid logos silently.
      logo: t.logo && isSafeImageUrl(t.logo) ? t.logo : undefined,
      isStock: Boolean(t.isStock),
    }))

    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({ ok: true, count: userData.watchlist.length, updatedAt: userData.updatedAt })
  }

  // ── Research watchlists (named lists, crypto + stock) ────────────────
  // The research app stores a RICHER structure than the trading app's flat
  // `watchlist` array: multiple named lists, separated into crypto + stock.
  // It lives under its OWN KV field (`watchlistsResearch`) so the two apps
  // never clobber each other's data on the shared user record.
  // Shape: { crypto: [{id,name,tokens,updatedAt}], stocks: [...] }

  // GET /api/user/watchlists-research
  if (route === 'watchlists-research' && req.method === 'GET') {
    const userData = await getUser(userId)
    return res.json({
      userId,
      watchlists: userData.watchlistsResearch || null,
      updatedAt: userData.updatedAt,
    })
  }

  // PUT /api/user/watchlists-research
  if (route === 'watchlists-research' && req.method === 'PUT') {
    // Shares the user-write bucket so total user writes stay capped.
    if (await userRateLimit(res, { bucket: 'user-write', userId, max: 10, windowMs: 60_000 })) return
    const { watchlists } = req.body || {}
    if (!watchlists || typeof watchlists !== 'object') {
      return res.status(400).json({ error: 'watchlists must be an object' })
    }
    const sanitizeList = (l) => ({
      id: String(l?.id || '').slice(0, 64),
      name: String(l?.name || 'Untitled').slice(0, 64),
      updatedAt: Number(l?.updatedAt) || Date.now(),
      tokens: (Array.isArray(l?.tokens) ? l.tokens : []).slice(0, 200).map(sanitizeWatchlistToken),
    })
    // Cap at 50 lists per mode; drop lists with no id (can't round-trip / merge).
    const sanitizeSet = (arr) =>
      (Array.isArray(arr) ? arr : []).slice(0, 50).map(sanitizeList).filter((l) => l.id)

    const userData = await getUser(userId)
    userData.watchlistsResearch = {
      crypto: sanitizeSet(watchlists.crypto),
      stocks: sanitizeSet(watchlists.stocks),
    }
    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({
      ok: true,
      crypto: userData.watchlistsResearch.crypto.length,
      stocks: userData.watchlistsResearch.stocks.length,
      updatedAt: userData.updatedAt,
    })
  }

  // GET /api/user/media
  if (route === 'media' && req.method === 'GET') {
    const userData = await getUser(userId)
    return res.json({ userId, media: userData.media || null, updatedAt: userData.updatedAt })
  }

  // PUT /api/user/media
  if (route === 'media' && req.method === 'PUT') {
    if (await userRateLimit(res, { bucket: 'user-write', userId, max: 10, windowMs: 60_000 })) return
    const { media } = req.body || {}
    if (!media || typeof media !== 'object') {
      return res.status(400).json({ error: 'media must be an object' })
    }
    if (JSON.stringify(media).length > MAX_USER_BLOB_JSON) {
      return res.status(413).json({ error: 'media payload too large' })
    }
    const userData = await getUser(userId)
    userData.media = sanitizeMediaBlob(media)
    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({ ok: true, updatedAt: userData.updatedAt })
  }

  // GET /api/user/rz-personal
  if (route === 'rz-personal' && req.method === 'GET') {
    const userData = await getUser(userId)
    return res.json({ userId, rz: userData.rzPersonal || null, updatedAt: userData.updatedAt })
  }

  // PUT /api/user/rz-personal
  if (route === 'rz-personal' && req.method === 'PUT') {
    if (await userRateLimit(res, { bucket: 'user-write', userId, max: 10, windowMs: 60_000 })) return
    const { rz } = req.body || {}
    if (!rz || typeof rz !== 'object') {
      return res.status(400).json({ error: 'rz must be an object' })
    }
    if (JSON.stringify(rz).length > MAX_USER_BLOB_JSON) {
      return res.status(413).json({ error: 'rz payload too large' })
    }
    const userData = await getUser(userId)
    userData.rzPersonal = sanitizeRzBlob(rz)
    userData.updatedAt = new Date().toISOString()
    await setUser(userId, userData)
    return res.json({ ok: true, updatedAt: userData.updatedAt })
  }

  return res.status(404).json({ error: 'Not found' })
}
