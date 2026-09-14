// Beta-waitlist sync: auto-grant bot access to users whose Telegram handle
// matches the `telegram` field in the `new-era-beta-waitlist` Firestore
// collection (same source of truth as the app's /api/beta-access gate).
//
// Needs in root .env (same creds the Vercel beta gate uses):
//   FIREBASE_SERVICE_ACCOUNT_JSON  one-line stringified service-account JSON
//   FIREBASE_PROJECT_ID            e.g. third-opus-411016 (optional, read from SA)
//
// Handles are matched normalized (case-insensitive, @/t.me/ prefixes stripped).
// The full handle list is cached in memory and re-synced every 5 minutes, so a
// new beta signup can use the bot within ~5 min without any restart.

const COLLECTION = 'new-era-beta-waitlist'
const SYNC_MS = 5 * 60e3

let db = null
let disabledReason = null
let cache = { at: 0, handles: new Set() }

function init() {
  if (db || disabledReason) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) {
    disabledReason = 'FIREBASE_SERVICE_ACCOUNT_JSON not set — waitlist sync off (invite code still works)'
    console.warn('[waitlist]', disabledReason)
    return
  }
  try {
    const admin = require('firebase-admin')
    const sa = JSON.parse(raw)
    const APP = 'spectre-tg-gate'
    const app =
      admin.apps.find((a) => a && a.name === APP) ||
      admin.initializeApp(
        { credential: admin.credential.cert(sa), projectId: process.env.FIREBASE_PROJECT_ID || sa.project_id },
        APP,
      )
    db = admin.firestore(app)
    console.log('[waitlist] firestore connected')
  } catch (e) {
    disabledReason = `firestore init failed: ${e.message}`
    console.error('[waitlist]', disabledReason)
  }
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//, '')
    .replace(/^@/, '')
}

async function handleSet() {
  init()
  if (!db) return null
  if (Date.now() - cache.at < SYNC_MS) return cache.handles
  const snap = await db.collection(COLLECTION).select('telegram').get()
  const handles = new Set()
  snap.forEach((doc) => {
    const h = normalize(doc.get('telegram'))
    if (h) handles.add(h)
  })
  cache = { at: Date.now(), handles }
  console.log(`[waitlist] synced ${handles.size} telegram handles from ${snap.size} waitlist rows`)
  return handles
}

async function isWhitelisted(username) {
  if (!username) return false
  try {
    const set = await handleSet()
    return set ? set.has(normalize(username)) : false
  } catch (e) {
    console.error('[waitlist] lookup failed:', e.message)
    return false
  }
}

function status() {
  init()
  if (disabledReason) return { enabled: false, reason: disabledReason }
  return { enabled: true, handles: cache.handles.size, syncedAt: cache.at ? new Date(cache.at).toISOString() : null }
}

module.exports = { isWhitelisted, status }
