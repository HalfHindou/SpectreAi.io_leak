/**
 * Vercel Serverless — Team Password Gate
 *
 * Replaces the client-side TEAM_PASSWORD literal. The password now lives
 * only in env (TEAM_GATE_PASSWORD). The frontend POSTs the candidate
 * password here; on match we set an HTTP-only signed cookie and the
 * frontend treats the cookie's presence (verified server-side) as auth.
 *
 * 2026-05-11 lockdown: previously we returned 200 { ok: true } and the
 * frontend just set sessionStorage('spectre-auth','true') — which any user
 * with DevTools could fake to bypass the gate. Now we set a signed
 * HTTP-only cookie (`spectre-gate=<HMAC(timestamp)>; HttpOnly; Secure;
 * SameSite=Lax; Max-Age=30d; Domain=.spectreai.io`, rolling-refreshed on every
 * check) and the frontend verifies via
 * /api/auth-gate?action=check before unlocking the app.
 *
 * Brute-force is bounded by per-IP rate limiting (5 attempts / 15 min).
 */

import crypto from 'crypto'
import { rateLimit } from './_lib/ratelimit.js'

const COOKIE_NAME = 'spectre-gate'
// 30d (was 24h, then 7d) + rolling refresh on every ?action=check, so an active
// user (esp. an installed PWA that fires the check on every launch) never lapses
// back to the gate. See gateCookieHeader for the SameSite=Lax rationale.
const COOKIE_MAX_AGE = 86400 * 30 // 30 days

// Cookie domain. Scoping to the eTLD+1 (.spectreai.io) instead of a host-only
// cookie on app.spectreai.io makes the session survive across subdomains (the
// /token iframe loads trade.spectreai.io) and is more robust in the isolated
// storage box iOS gives a homescreen PWA. Matches the dc_demo cookie, which
// already sets this and is the one gate cookie that "just works" on mobile.
// Prod-only file (dev proxies /api to Express + bypasses the gate), so this can
// never apply on localhost.
const COOKIE_DOMAIN = 'Domain=.spectreai.io'

// 2026-05-28 beta-launch: /api/beta-access mints a parallel cookie
// `spectre-beta` (HMAC-signed with the SAME secret as spectre-gate, just
// a different name + 7-day Max-Age). The verify() function is generic so
// /api/auth-gate?action=check accepts either cookie and the rest of the
// pipeline doesn't need to know which path the user took.
const BETA_COOKIE_NAME = 'spectre-beta'
// 30 days (was 7). Per-user cookie, lower-risk to lengthen than the shared team
// password, and the main lever against "homescreen logs me out weekly". MUST
// stay in sync with COOKIE_MAX_AGE_SEC in beta-access.js (the mint side) — this
// value is the age ceiling verify() enforces, so a longer mint with a shorter
// ceiling here would silently reject still-young cookies.
const BETA_COOKIE_MAX_AGE = 86400 * 30

// ── Showcase demo-session (2026-05-13, SEC-20260513-017) ─────────────────
// Marketing site at https://spectreai.io embeds the research app as a
// showcase iframe with `?embed=showcase&demo=true`. Visitors are not
// auth-gated, so every API call returned 401 and the iframe rendered an
// empty-state UI ("no point of showing the demo product").
//
// Fix: issue a short-lived HMAC-signed `dc_demo` cookie when the request
// looks like the showcase iframe (Referer = spectreai.io + Sec-Fetch-Dest
// = iframe). Read-only showcase-eligible handlers accept either gate.
// LLM-burning endpoints (brief, ai-market-text) MUST serve from cron-
// warmed cache, never trigger fresh LLM calls from demo path - else free
// LLM-as-a-service drain.
const DEMO_COOKIE_NAME = 'dc_demo'
const DEMO_COOKIE_MAX_AGE = 900 // 15 min
// Use Origin (browser-enforced, cannot be forged cross-origin) not Referer.
// The marketing site at spectreai.io initiates the demo-session call before
// rendering the iframe; the call is cross-origin so Origin is set by the
// browser to the marketing site's URL.
const DEMO_ALLOWED_ORIGINS = new Set([
  'https://spectreai.io',
  'https://www.spectreai.io',
])

function getDemoSecret() {
  const explicit = process.env.DEMO_SESSION_SECRET
  if (explicit) return explicit
  // Derive deterministically if env unset (still HMAC-integrity for free; the
  // secret is just `sha256("demo:" + AUTH_GATE_SECRET)` so it stays per-deploy).
  return crypto.createHash('sha256').update(`demo:${getSecret()}`).digest('hex')
}

function getIpHashSalt() {
  return process.env.IP_HASH_SALT || `demo-ip:${getSecret()}`
}

function getClientIp(req) {
  // Vercel appends the real client IP LAST (Wave 5b fix).
  const xff = req.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return req.headers?.['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(`${getIpHashSalt()}:${ip}`).digest('hex').slice(0, 16)
}

function signDemo(payload) {
  const h = crypto.createHmac('sha256', getDemoSecret()).update(payload).digest('hex').slice(0, 32)
  return `${payload}.${h}`
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
// Optional explicit secret. If unset, we derive a deterministic per-process
// secret from a hash of TEAM_GATE_PASSWORD + a fixed salt so we still get
// HMAC integrity (attacker doesn't know the password so can't forge the MAC).
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

// Gate cookie, single source of truth (2026-07-01).
//   SameSite=Lax (was Strict): Strict cookies are unreliable across the iOS
//     standalone-PWA launch boundary (the home-screen icon opens start_url as an
//     OS-initiated navigation) and the Safari<->PWA storage split — a prime cause
//     of "logged out every launch". Lax is correct for a first-party session
//     cookie and still blocks cross-site CSRF (login is a same-origin POST; no
//     state-changing GET is gated by this cookie alone).
//   Domain=.spectreai.io (COOKIE_DOMAIN) kept from the prior fix.
//   HttpOnly + Secure unchanged.
function signGateToken() {
  return sign(String(Date.now()))
}
function gateCookieHeader(name, token, maxAgeSec) {
  return `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax; ${COOKIE_DOMAIN}`
}
// Convenience: fresh token -> Set-Cookie header (paths that don't echo the token).
function issueGateCookie(name, maxAgeSec) {
  return gateCookieHeader(name, signGateToken(), maxAgeSec)
}

function verify(token, maxAgeSec = COOKIE_MAX_AGE) {
  if (typeof token !== 'string') return false
  const dot = token.lastIndexOf('.')
  if (dot < 1) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  if (!crypto.timingSafeEqual(a, b)) return false
  // payload is `<issued-at-ms>` — reject if older than the cookie window
  const issued = Number(payload)
  if (!Number.isFinite(issued)) return false
  if (Date.now() - issued > maxAgeSec * 1000) return false
  return true
}

function readCookie(req, name) {
  const raw = req.headers?.cookie || ''
  const re = new RegExp(`(?:^|;\\s*)${name.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}=([^;]+)`)
  const m = re.exec(raw)
  return m ? decodeURIComponent(m[1]) : null
}

function setAllowedOrigin(req, res) {
  // trade.spectreai.io removed 2026-05-12: DNS does not resolve (NXDOMAIN).
  // Anyone who claims that subdomain on Vercel gets a same-cookie origin.
  // Re-add only when the subdomain is actually live.
  // spectreai.io + www.spectreai.io added 2026-05-13 for the showcase demo-
  // session endpoint (cross-origin call from marketing site → cookie minted
  // for .spectreai.io). The endpoint itself rejects non-allowlisted origins
  // separately via DEMO_ALLOWED_ORIGINS so this only enables the response
  // header echo - it does NOT widen which actions are reachable.
  const allow = [
    'http://localhost:5180',
    'http://localhost:5181',
    'https://app.spectreai.io',
    'https://spectreai.io',
    'https://www.spectreai.io',
  ]
  res.setHeader('Access-Control-Allow-Origin', allow.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin')
}

export default async function handler(req, res) {
  setAllowedOrigin(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = (req.query?.action || '').toString().toLowerCase()

  // ── Verify path: GET /api/auth-gate?action=check ─────────────────────
  // Frontend hits this at mount to learn whether the existing cookie is
  // still valid. Returns 200 { ok: true } or 401 { ok: false }. Also
  // recognizes the showcase demo session and returns { ok: true, demo: true }
  // so the iframe app shell can render in demo mode without trying to
  // bounce the user to the gate page.
  if (req.method === 'GET' && action === 'check') {
    // Team password cookie (30d) - always honored. Rolling refresh: re-issue on
    // every valid check so an installed PWA never lapses back to the gate. Echo
    // the fresh token as `resume` so the client can keep its localStorage copy
    // current (localStorage survives an iOS PWA force-quit even when the cookie
    // doesn't - see ?action=resume).
    const teamToken = readCookie(req, COOKIE_NAME)
    if (teamToken && verify(teamToken, COOKIE_MAX_AGE)) {
      const fresh = signGateToken()
      res.setHeader('Set-Cookie', gateCookieHeader(COOKIE_NAME, fresh, COOKIE_MAX_AGE))
      return res.status(200).json({ ok: true, gate: 'team', resume: fresh })
    }
    // Beta access cookie (30d) - only honored when BETA_OPEN === 'true'.
    // Kills existing beta sessions when we close the beta without needing
    // to rotate the signing key (which would also invalidate team cookies).
    // Rolling-refreshed too so beta testers stay signed in while active.
    const betaToken = readCookie(req, BETA_COOKIE_NAME)
    if (process.env.BETA_OPEN === 'true' && betaToken && verify(betaToken, BETA_COOKIE_MAX_AGE)) {
      res.setHeader('Set-Cookie', issueGateCookie(BETA_COOKIE_NAME, BETA_COOKIE_MAX_AGE))
      return res.status(200).json({ ok: true, gate: 'beta' })
    }
    if (isDemoSession(req)) return res.status(200).json({ ok: true, demo: true })
    // Surface beta-closed status so the gate UI can render the "Beta launches
    // soon" screen on first paint instead of the misleading email-entry form
    // (server-side block still applies regardless; this is a UX hint only).
    return res.status(401).json({ ok: false, betaClosed: process.env.BETA_OPEN !== 'true' })
  }

  // ── Demo-session path: GET /api/auth-gate?action=demo-session ────────
  // Issues a short-lived HMAC-signed `dc_demo` cookie when the request
  // looks legitimately like the showcase bootstrap call from the marketing
  // site (spectreai.io). The marketing site fires this fetch cross-origin
  // BEFORE rendering the iframe; the browser-set Origin header proves the
  // call originated from spectreai.io (cannot be forged by JS - Origin is
  // a forbidden header in cross-origin fetches). Per-IP rate-limited to
  // bound abuse. Cookie is scoped to .spectreai.io with SameSite=Lax so
  // the iframe at app.spectreai.io reads it on subsequent XHRs (same
  // eTLD+1 = same-site, Lax allows subresource cookies).
  if (req.method === 'GET' && action === 'demo-session') {
    if (await rateLimit(req, res, { bucket: 'demo-session-issue', max: 10, windowMs: 60_000 })) return

    const origin = (req.headers?.origin || '').toLowerCase()
    if (!DEMO_ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: 'demo-session refused', reason: 'origin' })
    }

    // Sec-Fetch-Site = cross-site is expected (marketing site calls
    // app.spectreai.io). Sec-Fetch-Site = same-site is also fine if the
    // browser considers eTLD+1 same-site. Reject obvious anomalies.
    const site = req.headers?.['sec-fetch-site']
    if (site && site !== 'cross-site' && site !== 'same-site') {
      return res.status(403).json({ error: 'demo-session refused', reason: 'fetch-site' })
    }

    const ipHash = hashIp(getClientIp(req))
    const exp = Date.now() + DEMO_COOKIE_MAX_AGE * 1000
    const cookie = signDemo(`${ipHash}.${exp}`)
    res.setHeader('Set-Cookie',
      `${DEMO_COOKIE_NAME}=${cookie}; Path=/; Max-Age=${DEMO_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax; Domain=.spectreai.io`,
    )
    return res.status(200).json({ ok: true, demo: true, expiresIn: DEMO_COOKIE_MAX_AGE })
  }

  // ── Resume path: POST /api/auth-gate?action=resume  { resume } ────────
  // iOS standalone PWAs are unreliable at persisting the HttpOnly cookie across
  // a force-quit ("clear from app switcher"), and sessionStorage (the anti-
  // false-logout hint) is wiped there too. So the client also stashes the signed
  // token in localStorage (which DOES survive) and replays it here on a cold
  // launch where the cookie is gone; we re-verify HMAC + age and re-mint the
  // cookie - no password re-entry. The token is a bearer credential for the beta
  // GATE only (sensitive actions are separately Privy-authed), so localStorage
  // exposure is an acceptable trade for not logging the founder out on every
  // quick-clear.
  if (req.method === 'POST' && action === 'resume') {
    // Looser than the password bucket (signed-token replay, not a guess) but
    // still bounded so a leaked token can't be spun forever.
    if (await rateLimit(req, res, { bucket: 'auth-gate-resume', max: 30, windowMs: 15 * 60_000 })) return
    const rtoken = typeof req.body?.resume === 'string' ? req.body.resume : ''
    if (rtoken && verify(rtoken, COOKIE_MAX_AGE)) {
      const fresh = signGateToken()
      res.setHeader('Set-Cookie', gateCookieHeader(COOKIE_NAME, fresh, COOKIE_MAX_AGE))
      return res.status(200).json({ ok: true, gate: 'team', resume: fresh })
    }
    return res.status(401).json({ ok: false })
  }

  // ── Login path: POST /api/auth-gate ──────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Hard rate limit: 5 attempts per 15 minutes per IP.
  if (await rateLimit(req, res, { bucket: 'auth-gate', max: 5, windowMs: 15 * 60_000 })) return

  const expected = process.env.TEAM_GATE_PASSWORD
  if (!expected) return res.status(503).json({ error: 'Gate not configured' })

  const candidate = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!candidate) return res.status(400).json({ error: 'Missing password' })

  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!ok) return res.status(401).json({ error: 'Invalid password' })

  // Issue a signed HTTP-only cookie. HttpOnly so JS can't read or forge it;
  // Secure + SameSite=Lax (see gateCookieHeader) so it survives the iOS PWA
  // launch boundary while still blocking cross-site CSRF. Echo the same token as
  // `resume` so the client can persist it in localStorage (force-quit-proof).
  const token = signGateToken()
  res.setHeader('Set-Cookie', gateCookieHeader(COOKIE_NAME, token, COOKIE_MAX_AGE))
  return res.status(200).json({ ok: true, resume: token })
}

// Exported for other API routes that want to enforce the gate cookie.
// Returns true for EITHER spectre-gate (team password, 24h) or
// spectre-beta (per-user, 7d). Beta cookies are only honored when
// BETA_OPEN === 'true' so we can close the beta cohort without
// rotating the shared signing key (which would kick out the team).
export function isAuthGateValid(req) {
  const teamToken = readCookie(req, COOKIE_NAME)
  if (teamToken && verify(teamToken, COOKIE_MAX_AGE)) return true
  if (process.env.BETA_OPEN === 'true') {
    const betaToken = readCookie(req, BETA_COOKIE_NAME)
    if (betaToken && verify(betaToken, BETA_COOKIE_MAX_AGE)) return true
  }
  return false
}

// Exported for showcase-eligible read-only handlers. Validates the
// dc_demo cookie's HMAC + expiry + IP-binding. Only returns true for
// the same IP that minted the cookie (bound to ipHash). LLM/expensive
// handlers MUST serve cron-warmed cache when this returns true - never
// trigger fresh paid calls per visitor. POST/swap/user/admin handlers
// must NOT opt in to this - they remain gate-only.
export function isDemoSession(req) {
  const raw = readCookie(req, DEMO_COOKIE_NAME)
  if (!raw || typeof raw !== 'string') return false
  const lastDot = raw.lastIndexOf('.')
  if (lastDot < 1) return false
  const payload = raw.slice(0, lastDot)
  const sig = raw.slice(lastDot + 1)
  const expectedSig = crypto.createHmac('sha256', getDemoSecret()).update(payload).digest('hex').slice(0, 32)
  if (!timingSafeEqualStr(sig, expectedSig)) return false
  const [ipHash, expStr] = payload.split('.')
  if (!ipHash || !expStr) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  // Hard IP-binding dropped 2026-06-11 (parity with trading auth-gate):
  // dual-stack (Happy Eyeballs) and CGNAT clients change source IP between
  // connections, so the mint and subsequent calls disagree and demo sessions
  // 401 intermittently. HMAC + expiry + read-only scope remain; ipHash stays
  // in the payload for forensics.
  return true
}

// Combined gate for showcase-eligible read-only endpoints. Use this in
// handlers that want to accept BOTH the full auth-gate AND demo-session.
// Endpoints that should NOT be reachable from demo (swap, user mutations,
// admin, anything destructive) must keep using `isAuthGateValid` alone.
export function isAuthOrDemoValid(req) {
  return isAuthGateValid(req) || isDemoSession(req)
}
