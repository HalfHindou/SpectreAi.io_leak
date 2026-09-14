/**
 * User Profile Sync Routes
 * Stores user settings/watchlists so they persist across devices and sync
 * between research and trading apps.
 *
 * Auth: Privy JWT in Authorization header (Bearer <token>).
 * Storage: Vercel KV when KV_REST_API_URL is set, JSON files as fallback.
 *
 * GET  /api/user/profile    - Fetch user profile + settings
 * PUT  /api/user/profile    - Update user profile + settings
 * GET  /api/user/watchlist   - Fetch user watchlist
 * PUT  /api/user/watchlist   - Update user watchlist
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const { verifyPrivyToken } = require('../lib/auth')

const router = express.Router()

// ---------- Storage layer: Vercel KV with JSON file fallback ----------

let kvStore = null
let kvChecked = false

async function getKv() {
  if (kvChecked) return kvStore
  kvChecked = true

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.log('[users] No KV_REST_API_URL - using JSON file storage')
    return null
  }

  try {
    const { kv } = await import('@vercel/kv')
    kvStore = kv
    console.log('[users] Connected to Vercel KV')
    return kvStore
  } catch (err) {
    console.warn('[users] Failed to load @vercel/kv - using JSON file fallback:', err.message)
    return null
  }
}

// JSON file fallback
const USERS_DIR = path.resolve(__dirname, '..', 'data', 'users')
if (!fs.existsSync(USERS_DIR)) {
  fs.mkdirSync(USERS_DIR, { recursive: true })
}

function getUserFilePath(userId) {
  // Sanitize for filesystem - colons are illegal on Windows
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(USERS_DIR, `${safe}.json`)
}

function loadUserDataFromFile(userId) {
  const filePath = getUserFilePath(userId)
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (err) {
    console.error(`[users] Error reading user ${userId}:`, err.message)
  }
  return { profile: {}, settings: {}, watchlist: [], updatedAt: null }
}

function saveUserDataToFile(userId, data) {
  const filePath = getUserFilePath(userId)
  data.updatedAt = new Date().toISOString()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// Unified storage interface
// KV operations wrapped in try/catch — if Vercel KV is misconfigured (stale
// creds, expired token, network blip), fall back to JSON file storage instead
// of throwing up to the route handler and 500ing the request. Same defensive
// pattern as apps/{trading,research}/api/_lib/kv.js.
async function loadUserData(userId) {
  try {
    const kv = await getKv()
    if (kv) {
      const data = await kv.get(`user:${userId}:profile`)
      return data || { profile: {}, settings: {}, watchlist: [], updatedAt: null }
    }
  } catch (err) {
    console.warn('[users] KV get failed, falling back to file:', err?.message)
  }
  return loadUserDataFromFile(userId)
}

async function saveUserData(userId, data) {
  data.updatedAt = new Date().toISOString()
  try {
    const kv = await getKv()
    if (kv) {
      await kv.set(`user:${userId}:profile`, data)
      return
    }
  } catch (err) {
    console.warn('[users] KV set failed, falling back to file:', err?.message)
  }
  saveUserDataToFile(userId, data)
}

// ---------- Privy JWT verification middleware ----------

async function requireAuth(req, res, next) {
  const userId = await verifyPrivyToken(req)
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  req.userId = userId.replace(/[^a-zA-Z0-9:_-]/g, '_')
  next()
}

// Allowed settings keys to persist
// Must cover every key the client pushes (SYNC_KEYS in useSettingsStore.js) -
// a key missing here is silently dropped and that setting never syncs across
// devices. aiChartsFavorites is additionally sanitized in the PUT handler.
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

function isSafeImageUrl(url) {
  if (typeof url !== 'string' || url.length > 500) return false
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return IMAGE_HOST_ALLOWLIST.some(allowed =>
    host === allowed || host.endsWith('.' + allowed)
  )
}

// ---------- Routes ----------

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userData = await loadUserData(req.userId)
    res.json({
      userId: req.userId,
      profile: userData.profile || {},
      settings: userData.settings || {},
      updatedAt: userData.updatedAt,
    })
  } catch (err) {
    console.error('[users] GET /profile error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/user/profile
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { profile, settings } = req.body || {}
    const userData = await loadUserData(req.userId)

    if (profile && typeof profile === 'object') {
      if (!userData.profile) userData.profile = {}
      if (typeof profile.name === 'string') userData.profile.name = profile.name.slice(0, 80)
      if (typeof profile.imageUrl === 'string' && isSafeImageUrl(profile.imageUrl)) {
        userData.profile.imageUrl = profile.imageUrl
      }
    }

    if (settings && typeof settings === 'object') {
      if (!userData.settings) userData.settings = {}
      for (const key of ALLOWED_SETTINGS) {
        if (key in settings) userData.settings[key] = settings[key]
      }
      if ('aiChartsFavorites' in settings) {
        userData.settings.aiChartsFavorites = Array.isArray(settings.aiChartsFavorites)
          ? settings.aiChartsFavorites.slice(0, 200).map((s) => String(s).slice(0, 32))
          : []
      }
    }

    await saveUserData(req.userId, userData)
    res.json({ ok: true, updatedAt: userData.updatedAt })
  } catch (err) {
    console.error('[users] PUT /profile error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/user/watchlist
router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const userData = await loadUserData(req.userId)
    res.json({
      userId: req.userId,
      watchlist: userData.watchlist || [],
      updatedAt: userData.updatedAt,
    })
  } catch (err) {
    console.error('[users] GET /watchlist error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/user/watchlist
router.put('/watchlist', requireAuth, async (req, res) => {
  try {
    const { watchlist } = req.body || {}
    if (!Array.isArray(watchlist)) {
      return res.status(400).json({ error: 'watchlist must be an array' })
    }

    const userData = await loadUserData(req.userId)
    userData.watchlist = watchlist.slice(0, 200).map((t) => ({
      symbol: String(t.symbol || ''),
      name: String(t.name || ''),
      address: String(t.address || ''),
      networkId: Number(t.networkId) || 0,
      pinned: Boolean(t.pinned),
      logo: t.logo ? String(t.logo) : undefined,
      isStock: Boolean(t.isStock),
    }))

    await saveUserData(req.userId, userData)
    res.json({ ok: true, count: userData.watchlist.length, updatedAt: userData.updatedAt })
  } catch (err) {
    console.error('[users] PUT /watchlist error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Research watchlists (named lists, crypto + stock) ────────────────
// Richer structure than the flat /watchlist (trading) field — stored under
// its own `watchlistsResearch` field so the two apps don't clobber each other.
// Shape: { crypto: [{id,name,tokens,updatedAt}], stocks: [...] }
const sanitizeWatchlistToken = (t) => ({
  symbol: String(t?.symbol || '').slice(0, 32),
  name: String(t?.name || '').slice(0, 128),
  address: String(t?.address || '').slice(0, 64),
  networkId: Number(t?.networkId) || 0,
  pinned: Boolean(t?.pinned),
  logo: t?.logo ? String(t.logo) : undefined,
  isStock: Boolean(t?.isStock),
})

// GET /api/user/watchlists-research
router.get('/watchlists-research', requireAuth, async (req, res) => {
  try {
    const userData = await loadUserData(req.userId)
    res.json({
      userId: req.userId,
      watchlists: userData.watchlistsResearch || null,
      updatedAt: userData.updatedAt,
    })
  } catch (err) {
    console.error('[users] GET /watchlists-research error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/user/watchlists-research
router.put('/watchlists-research', requireAuth, async (req, res) => {
  try {
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
    const sanitizeSet = (arr) =>
      (Array.isArray(arr) ? arr : []).slice(0, 50).map(sanitizeList).filter((l) => l.id)

    const userData = await loadUserData(req.userId)
    userData.watchlistsResearch = {
      crypto: sanitizeSet(watchlists.crypto),
      stocks: sanitizeSet(watchlists.stocks),
    }
    await saveUserData(req.userId, userData)
    res.json({
      ok: true,
      crypto: userData.watchlistsResearch.crypto.length,
      stocks: userData.watchlistsResearch.stocks.length,
      updatedAt: userData.updatedAt,
    })
  } catch (err) {
    console.error('[users] PUT /watchlists-research error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Media library + Research Zone personal data ─────────────────────────────
// Whole-blob GET/PUT per field, sanitized server-side. The client owns the
// merge (services/userDataSync.js) - the server only caps sizes so one user
// record can't balloon the KV row. Mirrors apps/research/api/_lib/handlers/user.js.

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

// GET /api/user/media
router.get('/media', requireAuth, async (req, res) => {
  try {
    const userData = await loadUserData(req.userId)
    res.json({ userId: req.userId, media: userData.media || null, updatedAt: userData.updatedAt })
  } catch (err) {
    console.error('[users] GET /media error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/user/media
router.put('/media', requireAuth, async (req, res) => {
  try {
    const { media } = req.body || {}
    if (!media || typeof media !== 'object') {
      return res.status(400).json({ error: 'media must be an object' })
    }
    if (JSON.stringify(media).length > MAX_USER_BLOB_JSON) {
      return res.status(413).json({ error: 'media payload too large' })
    }
    const userData = await loadUserData(req.userId)
    userData.media = sanitizeMediaBlob(media)
    await saveUserData(req.userId, userData)
    res.json({ ok: true, updatedAt: userData.updatedAt })
  } catch (err) {
    console.error('[users] PUT /media error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/user/rz-personal
router.get('/rz-personal', requireAuth, async (req, res) => {
  try {
    const userData = await loadUserData(req.userId)
    res.json({ userId: req.userId, rz: userData.rzPersonal || null, updatedAt: userData.updatedAt })
  } catch (err) {
    console.error('[users] GET /rz-personal error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/user/rz-personal
router.put('/rz-personal', requireAuth, async (req, res) => {
  try {
    const { rz } = req.body || {}
    if (!rz || typeof rz !== 'object') {
      return res.status(400).json({ error: 'rz must be an object' })
    }
    if (JSON.stringify(rz).length > MAX_USER_BLOB_JSON) {
      return res.status(413).json({ error: 'rz payload too large' })
    }
    const userData = await loadUserData(req.userId)
    userData.rzPersonal = sanitizeRzBlob(rz)
    await saveUserData(req.userId, userData)
    res.json({ ok: true, updatedAt: userData.updatedAt })
  } catch (err) {
    console.error('[users] PUT /rz-personal error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/user/kol-follows  - the handles of KOLs this user follows (KOL Radar)
router.get('/kol-follows', requireAuth, async (req, res) => {
  try {
    const userData = await loadUserData(req.userId)
    res.json({
      follows: Array.isArray(userData.kolFollows) ? userData.kolFollows : [],
      updatedAt: userData.updatedAt,
    })
  } catch (err) {
    console.error('[users] GET /kol-follows error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/user/kol-follows  - replace the user's followed-KOL handle list (cap 200)
const KOL_HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/
router.put('/kol-follows', requireAuth, async (req, res) => {
  try {
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

    const userData = await loadUserData(req.userId)
    userData.kolFollows = clean
    await saveUserData(req.userId, userData)
    res.json({ ok: true, count: clean.length, updatedAt: userData.updatedAt })
  } catch (err) {
    console.error('[users] PUT /kol-follows error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

module.exports = router
