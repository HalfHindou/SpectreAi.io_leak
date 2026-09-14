/**
 * Lazy firebase-admin client for Vercel serverless functions.
 *
 * Used by /api/beta-access (and any future Firestore-backed handler).
 * Dynamic import so a missing/bad credential never crashes unrelated
 * handlers in the same lambda bundle.
 *
 * Required env vars (set in Vercel dashboard, marked Sensitive):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  stringified service-account JSON
 *   FIREBASE_PROJECT_ID            project id (e.g. "third-opus-411016")
 *
 * The named app `spectre-beta-gate` avoids collision if another module
 * in the same lambda also calls initializeApp() with a different cred.
 */

const APP_NAME = 'spectre-beta-gate'

let _initPromise = null

async function init() {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const adminMod = await import('firebase-admin')
    const admin = adminMod.default || adminMod
    const existing = admin.apps?.find?.(a => a && a.name === APP_NAME)
    if (existing) return { admin, app: existing }

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var is required')

    let sa
    try {
      sa = JSON.parse(raw)
    } catch (e) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`)
    }
    if (!sa.private_key || !sa.client_email) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON missing private_key or client_email')
    }

    const app = admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: process.env.FIREBASE_PROJECT_ID || sa.project_id,
    }, APP_NAME)

    return { admin, app }
  })().catch(err => {
    _initPromise = null
    throw err
  })
  return _initPromise
}

export async function getDb() {
  const { admin, app } = await init()
  return admin.firestore(app)
}

export async function getFieldValue() {
  const { admin } = await init()
  return admin.firestore.FieldValue
}
