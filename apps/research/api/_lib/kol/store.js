/**
 * KOL Radar — persistence layer (Vercel serverless / ESM mirror of the dev CJS
 * store at packages/server/lib/kol/store.js).
 *
 * Uses the SAME KV keys as the dev store so dev + prod share state:
 *   kol:registry            -> { kols: KolRow[], updatedAt }
 *   kol:following:<handle>  -> { handle, accounts: Account[], updatedAt }
 *   kol:events              -> { events: FollowEvent[] (ring, cap ~2000) }
 *   kol:signals             -> { signals: ConvergenceSignal[], generated_at_utc }
 *
 * Connection: mirrors apps/research/api/_lib/kv.js env-var resolution (Upstash
 * Redis via @upstash/redis, with the legacy KV_REST_API_* and STORAGE_KV_REST_*
 * aliases). Falls back to an in-memory Map when no store is configured (local
 * dev / preview without Upstash). The bare get/set (no TTL) matches the dev
 * store's `kv.get` / `kv.set`, so the JSON shape on the shared keys is identical.
 */

const EVENTS_CAP = 2000

let redisClient = null
let usingMemoryFallback = false
const memoryStore = new Map()

async function getKv() {
  if (redisClient !== null) return redisClient
  if (usingMemoryFallback) return null

  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.STORAGE_KV_REST_API_URL ||
    process.env.KV_REST_API_URL
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.STORAGE_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    usingMemoryFallback = true
    return null
  }

  try {
    const { Redis } = await import('@upstash/redis')
    redisClient = new Redis({ url, token })
    return redisClient
  } catch (err) {
    console.warn('[kol/store] @upstash/redis unavailable - memory fallback:', err.message)
    usingMemoryFallback = true
    return null
  }
}

// ---- unified get/set (bare, no TTL — same shape the dev store writes) ----
async function get(key) {
  try {
    const kv = await getKv()
    if (kv) {
      const data = await kv.get(key)
      return data || null
    }
  } catch (err) {
    console.warn(`[kol/store] KV get ${key} failed, memory fallback:`, err?.message)
  }
  return memoryStore.get(key) || null
}

async function set(key, data) {
  try {
    const kv = await getKv()
    if (kv) {
      await kv.set(key, data)
      return
    }
  } catch (err) {
    console.warn(`[kol/store] KV set ${key} failed, memory fallback:`, err?.message)
  }
  memoryStore.set(key, data)
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

export default {
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
