/**
 * POST /api/beta-access (trading app)
 *
 * Mirror of apps/research/api/beta-access.js. Trading deploys to a separate
 * Vercel project so it needs its own copy (no cross-app imports).
 *
 * See the research copy for full doc-comment. tl;dr:
 *   - verifyPrivyToken(req)         -> Privy DID
 *   - privy.users()._get(userId)    -> linked_accounts
 *   - lookup any linked email in    -> new-era-beta-waitlist collection
 *   - on match: set spectre-beta    -> HMAC cookie (7d) + write lastLoginAt
 *
 * Same signing key as auth-gate.js so /api/auth-gate?action=check can
 * verify either spectre-gate (team) or spectre-beta (per-user) cookie.
 */

import crypto from 'crypto'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit } from './_lib/ratelimit.js'
import { getDb, getFieldValue } from './_lib/firestore.js'

const COOKIE_NAME = 'spectre-beta'
// 7d -> 30d, parity with auth-gate. Rolling-refreshed on ?action=check.
const COOKIE_MAX_AGE_SEC = 86400 * 30

function getSecret() {
  const explicit = process.env.AUTH_GATE_SECRET
  if (explicit) return explicit
  const pw = process.env.TEAM_GATE_PASSWORD || ''
  return crypto.createHash('sha256').update(`spectre-gate:${pw}`).digest('hex')
}

function sign(payload) {
  const h = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${h}`
}

let _privyClient = null
let _privyInitError = null
async function getPrivy() {
  if (_privyClient) return _privyClient
  if (!process.env.PRIVY_APP_ID) {
    _privyInitError = 'PRIVY_APP_ID not set'
    return null
  }
  if (!process.env.PRIVY_APP_SECRET) {
    _privyInitError = 'PRIVY_APP_SECRET not set'
    return null
  }
  try {
    const mod = await import('@privy-io/node')
    const PrivyClient = mod.PrivyClient || mod.default?.PrivyClient
    if (!PrivyClient) {
      _privyInitError = `PrivyClient not exported (got keys: ${Object.keys(mod).slice(0, 8).join(',')})`
      return null
    }
    _privyClient = new PrivyClient({
      appId: process.env.PRIVY_APP_ID,
      appSecret: process.env.PRIVY_APP_SECRET,
    })
    return _privyClient
  } catch (err) {
    _privyInitError = `${err?.name || 'Error'}: ${err?.message || String(err)}`
    console.error('[beta-access] privy client init failed:', _privyInitError, err?.stack?.split('\n').slice(0, 4).join(' | '))
    return null
  }
}

function extractEmails(user) {
  if (!user || !Array.isArray(user.linked_accounts)) return []
  const out = []
  for (const acct of user.linked_accounts) {
    if (typeof acct.address === 'string' && acct.address.includes('@')) out.push(acct.address)
    if (typeof acct.email === 'string' && acct.email.includes('@')) out.push(acct.email)
  }
  return Array.from(new Set(out.map(e => e.trim().toLowerCase())))
}

function setCors(req, res) {
  const allow = [
    'http://localhost:5180',
    'http://localhost:5181',
    'https://app.spectreai.io',
    'https://trade.spectreai.io',
  ]
  res.setHeader('Access-Control-Allow-Origin', allow.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin')
}

// Best-effort email shape check.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v || v.length > 254 || !EMAIL_RE.test(v)) return null
  return v
}

// Top-level kill switch. BETA_OPEN must be exactly the string 'true' for
// any beta-cohort logins. Default = closed. Team-password access via
// /api/auth-gate is unaffected.
function isBetaOpen() {
  return process.env.BETA_OPEN === 'true'
}

export default async function handler(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' })

  if (!isBetaOpen()) {
    return res.status(403).json({
      ok: false,
      error: 'beta_closed',
      message: 'The Spectre AI Beta is not yet open. We will announce the launch on our X and Telegram.',
    })
  }

  // ── Mode A: precheck (no Privy token, just email lookup) ─────────
  const hasAuth = !!req.headers.authorization
  const bodyEmail = normalizeEmail(req.body?.email)

  if (!hasAuth && bodyEmail) {
    if (await rateLimit(req, res, { bucket: 'beta-access-precheck', max: 5, windowMs: 60_000 })) return

    let db
    try {
      db = await getDb()
    } catch (err) {
      console.error('[beta-access] firestore init failed:', err.message)
      return res.status(503).json({ ok: false, error: 'firestore_unavailable' })
    }

    try {
      const snap = await db.collection('new-era-beta-waitlist').where('email', '==', bodyEmail).limit(1).get()
      if (snap.empty) return res.status(403).json({ ok: false, error: 'not_on_waitlist', email: bodyEmail })
      return res.status(200).json({ ok: true, eligible: true, email: bodyEmail })
    } catch (err) {
      console.error('[beta-access] precheck query failed:', err.message)
      return res.status(503).json({ ok: false, error: 'firestore_query_failed' })
    }
  }

  // ── Mode B: full Privy → waitlist → cookie ───────────────────────

  if (await rateLimit(req, res, { bucket: 'beta-access', max: 10, windowMs: 15 * 60_000 })) return

  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ ok: false, error: 'invalid_token' })

  const privy = await getPrivy()
  if (!privy) return res.status(503).json({ ok: false, error: 'privy_unavailable', detail: _privyInitError || 'unknown' })

  let user
  try {
    user = await privy.users()._get(userId)
  } catch (err) {
    const detail = `${err?.name || 'Error'}: ${err?.message || String(err)}`
    console.error('[beta-access] privy user fetch failed:', detail, err?.stack?.split('\n').slice(0, 4).join(' | '))
    return res.status(503).json({ ok: false, error: 'privy_lookup_failed', detail })
  }

  const emails = extractEmails(user)
  if (emails.length === 0) {
    return res.status(400).json({ ok: false, error: 'no_email_linked' })
  }

  let db
  try {
    db = await getDb()
  } catch (err) {
    console.error('[beta-access] firestore init failed:', err.message)
    return res.status(503).json({ ok: false, error: 'firestore_unavailable' })
  }

  const col = db.collection('new-era-beta-waitlist')
  let matchDoc = null
  let matchEmail = null
  for (const email of emails) {
    try {
      const snap = await col.where('email', '==', email).limit(1).get()
      if (!snap.empty) {
        matchDoc = snap.docs[0]
        matchEmail = email
        break
      }
    } catch (err) {
      console.error('[beta-access] firestore query failed:', err.message)
      return res.status(503).json({ ok: false, error: 'firestore_query_failed' })
    }
  }

  if (!matchDoc) {
    return res.status(403).json({ ok: false, error: 'not_on_waitlist', email: emails[0] })
  }

  // SameSite=Lax (was Strict): survives the installed-PWA launch boundary; still
  // blocks cross-site CSRF. Mirror of issueGateCookie in auth-gate.js.
  const token = sign(String(Date.now()))
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; HttpOnly; Secure; SameSite=Lax`,
  )

  const currentData = matchDoc.data()
  try {
    const FieldValue = await getFieldValue()
    const update = {
      lastLoginAt: FieldValue.serverTimestamp(),
      loginCount: FieldValue.increment(1),
      privyUserId: userId,
    }
    if (currentData.status === 'pending') update.status = 'joined'
    await matchDoc.ref.update(update)
  } catch (err) {
    console.warn('[beta-access] write-back failed (cookie still issued):', err.message)
  }

  return res.status(200).json({
    ok: true,
    email: matchEmail,
    status: currentData.status === 'pending' ? 'joined' : currentData.status,
  })
}
