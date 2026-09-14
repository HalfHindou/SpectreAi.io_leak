/**
 * POST /api/beta-access
 *
 * Beta-launch gate (2026-05-28). Replaces the "one shared team password"
 * model with a per-user allowlist:
 *
 *   1. Caller proves Privy identity via Bearer access-token.
 *   2. Server fetches the Privy user, extracts every linked email
 *      (email login + Google/Apple/Discord OAuth).
 *   3. Server looks each email up in the `new-era-beta-waitlist`
 *      Firestore collection (project third-opus-411016).
 *   4. Match -> mint `spectre-beta` HMAC-signed cookie (same signing key
 *      and format as the existing `spectre-gate` team cookie, just a
 *      different name + longer Max-Age so we can tell beta-vs-team apart
 *      in logs and revoke independently).
 *   5. Write back `lastLoginAt`, `loginCount`, and bump `pending -> joined`.
 *
 * The team password (TEAM_GATE_PASSWORD via /api/auth-gate) remains as a
 * hidden secondary path - team members don't have to be in the waitlist.
 *
 * Required env: PRIVY_APP_ID, PRIVY_APP_SECRET, FIREBASE_SERVICE_ACCOUNT_JSON,
 *               FIREBASE_PROJECT_ID, TEAM_GATE_PASSWORD (for signing-key
 *               derivation - we want the SAME secret so /api/auth-gate
 *               ?action=check can verify either cookie with identical code).
 *
 * Responses:
 *   200 { ok, email, status }      + Set-Cookie: spectre-beta
 *   400 { ok: false, error: 'no_email_linked' }
 *   401 { ok: false, error: 'invalid_token' }
 *   403 { ok: false, error: 'not_on_waitlist', email }
 *   429 { ok: false, error: 'rate_limited' }
 *   503 { ok: false, error: 'service_unavailable' }
 */

import crypto from 'crypto'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit } from './_lib/ratelimit.js'
import { getDb, getFieldValue } from './_lib/firestore.js'

const COOKIE_NAME = 'spectre-beta'
// 30 days (was 7). MUST stay in sync with BETA_COOKIE_MAX_AGE in
// apps/research/api/auth-gate.js — that file's verify() rejects any spectre-beta
// token older than its ceiling, so the mint window here and the check window
// there have to match.
const COOKIE_MAX_AGE_SEC = 86400 * 30

// Scope to the eTLD+1 so the session survives subdomains (/token iframe loads
// trade.spectreai.io) and the isolated iOS-PWA storage box. Mirrors the
// spectre-gate cookie in auth-gate.js. Prod-only file.
const COOKIE_DOMAIN = 'Domain=.spectreai.io'

// Signing key MUST match apps/research/api/auth-gate.js so the same
// verify() logic in /api/auth-gate?action=check unlocks both cookies.
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

// Collect every email-like value across Privy linked accounts. A Privy
// user can link multiple identities (email + Google + Discord + wallet),
// and we want to accept ANY of them as a waitlist match - users sign up
// once on the website but might log into the app via a different method.
function extractEmails(user) {
  if (!user || !Array.isArray(user.linked_accounts)) return []
  const out = []
  for (const acct of user.linked_accounts) {
    // Email login -> address holds the email
    if (typeof acct.address === 'string' && acct.address.includes('@')) out.push(acct.address)
    // OAuth providers (google_oauth, apple_oauth, discord_oauth) -> email field
    if (typeof acct.email === 'string' && acct.email.includes('@')) out.push(acct.email)
  }
  return Array.from(new Set(out.map(e => e.trim().toLowerCase())))
}

function setCors(req, res) {
  const allow = [
    'http://localhost:5180',
    'http://localhost:5181',
    'https://app.spectreai.io',
  ]
  res.setHeader('Access-Control-Allow-Origin', allow.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin')
}

// Best-effort email shape check (matches the validator on /api/waitlist).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v || v.length > 254 || !EMAIL_RE.test(v)) return null
  return v
}

// Top-level kill switch. BETA_OPEN must be exactly the string 'true' for
// any beta-cohort logins. Default (unset, any other value) = closed.
// Defense-in-depth: this is checked BEFORE the rate limiter so a 503 storm
// of waitlist-curious users can't burn rate-limit budget while the beta
// is shuttered. Team-password access via /api/auth-gate is unaffected.
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

  // ── Mode A: precheck ─────────────────────────────────────────────
  // Frontend gate fires this BEFORE opening the Privy modal so we can
  // tell the user "not on the list" without burning a Privy magic-link
  // send. Just a Firestore email lookup; no cookie issued, no Privy
  // token required. Tighter rate limit (5/min/IP) to dampen the email
  // enumeration risk - it's a known oracle but acceptable for the
  // closed-beta phase.
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

  // Same bucket budget as auth-gate (5/15min was the password limit; we're
  // a bit more permissive here at 10/15min since a legitimate user might
  // hit this on every fresh tab during the launch frenzy).
  if (await rateLimit(req, res, { bucket: 'beta-access', max: 10, windowMs: 15 * 60_000 })) return

  // 1. Verify the Privy access token (reuses existing helper - JWKS-based)
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ ok: false, error: 'invalid_token' })

  // 2. Fetch the full Privy user object so we can read linked_accounts
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
    // User logged in with wallet only - we can't match them to the waitlist
    return res.status(400).json({ ok: false, error: 'no_email_linked' })
  }

  // 3. Look up waitlist for ANY of the linked emails (first hit wins)
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
    return res.status(403).json({
      ok: false,
      error: 'not_on_waitlist',
      email: emails[0], // surface the primary email so the UI can show it
    })
  }

  // 4. Mint cookie BEFORE the Firestore write so a write hiccup doesn't lock the user out
  // SameSite=Lax (was Strict): survives the installed-PWA launch boundary; still
  // blocks cross-site CSRF. Mirror of gateCookieHeader in auth-gate.js.
  const token = sign(String(Date.now()))
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; HttpOnly; Secure; SameSite=Lax; ${COOKIE_DOMAIN}`,
  )

  // 5. Best-effort write-back: lastLoginAt + loginCount + status bump
  const currentData = matchDoc.data()
  try {
    const FieldValue = await getFieldValue()
    const update = {
      lastLoginAt: FieldValue.serverTimestamp(),
      loginCount: FieldValue.increment(1),
      privyUserId: userId, // first-time learn for future analytics
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
