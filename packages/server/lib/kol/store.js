/**
 * KOL Radar — persistence layer.
 *
 * KV (Vercel) when KV_REST_API_URL/TOKEN are set, JSON-file fallback in dev.
 * Mirrors the getKv()/load/save pattern in routes/users.js.
 *
 * Keys:
 *   kol:registry            -> { kols: KolRow[], updatedAt }
 *   kol:following:<handle>  -> { handle, accounts: Account[], updatedAt }
 *   kol:events              -> { events: FollowEvent[] (ring, cap ~2000) }
 *   kol:signals             -> { signals: ConvergenceSignal[], generated_at_utc }
 *
 * JSON fallback dir: packages/server/data/kol/
 */
const path = require('path')
const fs = require('fs')

const EVENTS_CAP = 2000

let kvStore = null
let kvChecked = false

async function getKv() {
  if (kvChecked) return kvStore
  kvChecked = true

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null
  }
  try {
    const { kv } = await import('@vercel/kv')
    kvStore = kv
    console.log('[kol/store] Connected to Vercel KV')
    return kvStore
  } catch (err) {
    console.warn('[kol/store] @vercel/kv unavailable - JSON file fallback:', err.message)
    return null
  }
}

// ---- JSON file fallback ----
const KOL_DIR = path.resolve(__dirname, '..', '..', 'data', 'kol')
if (!fs.existsSync(KOL_DIR)) {
  fs.mkdirSync(KOL_DIR, { recursive: true })
}

function keyToFile(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(KOL_DIR, `${safe}.json`)
}

function readFile(key) {
  const fp = keyToFile(key)
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch (err) {
    console.error(`[kol/store] read ${key}:`, err.message)
  }
  return null
}

function writeFile(key, data) {
  const fp = keyToFile(key)
  try {
    fs.writeFileSync(fp, JSON.stringify(data))
  } catch (err) {
    console.error(`[kol/store] write ${key}:`, err.message)
  }
}

// ---- unified get/set ----
async function get(key) {
  try {
    const kv = await getKv()
    if (kv) {
      const data = await kv.get(key)
      return data || null
    }
  } catch (err) {
    console.warn(`[kol/store] KV get ${key} failed, file fallback:`, err?.message)
  }
  return readFile(key)
}

async function set(key, data) {
  try {
    const kv = await getKv()
    if (kv) {
      await kv.set(key, data)
      return
    }
  } catch (err) {
    console.warn(`[kol/store] KV set ${key} failed, file fallback:`, err?.message)
  }
  writeFile(key, data)
}

// ---- typed helpers ----
// v2: quality floor (5k followers) + curated tier classification. Bumping the
// namespace abandons the v1 junk-seeded snapshots/events so the DB rebuilds clean.
const REGISTRY_KEY = 'kol:v2:registry'
const EVENTS_KEY = 'kol:v2:events'
const SIGNALS_KEY = 'kol:v2:signals'
const followingKey = (handle) => `kol:v2:following:${String(handle).toLowerCase()}`

async function getRegistry() {
  return (await get(REGISTRY_KEY)) || { kols: [], updatedAt: null }
}
async function saveRegistry(kols) {
  await set(REGISTRY_KEY, { kols, updatedAt: new Date().toISOString() })
}

async function getFollowing(handle) {
  return (await get(followingKey(handle))) || null
}
async function saveFollowing(handle, accounts) {
  await set(followingKey(handle), {
    handle: String(handle).toLowerCase(),
    accounts,
    updatedAt: new Date().toISOString(),
  })
}

async function getEvents() {
  const d = await get(EVENTS_KEY)
  return Array.isArray(d?.events) ? d.events : []
}
// Prepend new events (newest-first), ring-cap at EVENTS_CAP.
async function appendEvents(newEvents) {
  if (!newEvents || !newEvents.length) return await getEvents()
  const existing = await getEvents()
  const merged = [...newEvents, ...existing].slice(0, EVENTS_CAP)
  await set(EVENTS_KEY, { events: merged })
  return merged
}

async function getSignals() {
  const d = await get(SIGNALS_KEY)
  return Array.isArray(d?.signals) ? d : { signals: [], generated_at_utc: null }
}
async function saveSignals(signals) {
  await set(SIGNALS_KEY, { signals, generated_at_utc: new Date().toISOString() })
}

module.exports = {
  EVENTS_CAP,
  get,
  set,
  getRegistry,
  saveRegistry,
  getFollowing,
  saveFollowing,
  getEvents,
  appendEvents,
  getSignals,
  saveSignals,
}
