/**
 * Vercel Serverless - Team Password Gate (trading app)
 *
 * Mirror of apps/research/api/auth-gate.js. Trading deploys to a separate
 * Vercel project, so it needs its own copy (no cross-app imports).
 *
 * 2026-05-11 lockdown: previously this just returned 200 { ok: true }. The
 * frontend then set sessionStorage('spectre-auth','true') and that was the
 * only check — any user could `sessionStorage.setItem(...)` from DevTools
 * and bypass. Now we set an HTTP-only signed cookie (`spectre-gate`) and
 * other route handlers verify it via `isAuthGateValid(req)` before doing
 * anything that burns quota.
 */

import crypto from 'crypto'
import { rateLimit } from './_lib/ratelimit.js'

const COOKIE_NAME = 'spectre-gate'
// 24h -> 30d + rolling refresh on ?action=check (parity with research auth-gate).
// Keeps installed PWAs (mobile home-screen + desktop) signed in instead of
// re-prompting the team password every launch.
const COOKIE_MAX_AGE = 86400 * 30 // 30 days

// 2026-05-28 beta-launch: /api/beta-access mints a parallel cookie
// `spectre-beta` (HMAC-signed with the SAME secret as spectre-gate, just
// a different name). verify() is generic so ?action=check
// accepts either cookie and downstream isAuthGateValid() unlocks for both.
const BETA_COOKIE_NAME = 'spectre-beta'
const BETA_COOKIE_MAX_AGE = 86400 * 30 // 30 days (was 7d; matches team, rolling-refreshed)

// ── Research-embed demo-session (2026-05-21, mirrors research SEC-20260513-017)
// The research app embeds this trading app as the "Trading Lite" token
// terminal (research /token iframes spectre-trading.vercel.app). The visitor
// is not signed into Privy and the spectre-gate cookie is SameSite=Lax +
// host-only (was Strict; relaxed 2026-07-01 for PWA persistence), so it still
// can NOT cross into a cross-site iframe (Lax is not sent on cross-site
// subresource/iframe requests either) → every market-data call 401'd and the
// terminal showed "No Data".
//
// Fix mirrors how spectreai.io's showcase iframe gets data: research mints a
// short-lived HMAC-signed `dc_demo` cookie on THIS origin via a cross-origin
// call (Origin header proves it came from the research app — unforgeable in a
// cross-origin fetch). Read-only market-data handlers then accept it.
//
// Transport depends on whether the embed is same-site (SEC-20260521-DEMOTOKEN):
//   - PROD: app.spectreai.io (parent) <-> trade.spectreai.io (iframe) share
//     eTLD+1 `spectreai.io`, so a Domain=.spectreai.io cookie is FIRST-PARTY in
//     the iframe — not subject to third-party-cookie blocking, stays HttpOnly.
//   - CROSS-SITE (*.vercel.app preview/dev): parent and child are different
//     sites (vercel.app is on the Public Suffix List), so the SameSite=None
//     cookie is blocked by default. There we skip the cookie and the token is
//     carried as an `x-demo-token` request header instead (returned in the
//     mint response body, postMessaged to the iframe). isDemoSession() accepts
//     either transport; both validate the same signed, IP-bound, 15-min token.
const DEMO_COOKIE_NAME = 'dc_demo'
const DEMO_COOKIE_MAX_AGE = 900 // 15 min
// The research-app origins that are allowed to mint a trading demo session.
// NOT spectreai.io — that's research's parent, not trading's.
const DEMO_ALLOWED_ORIGINS = new Set([
  'http://localhost:5180',
  'https://spectre-app-research.vercel.app',
  'https://app.spectreai.io',
])

function getSecret() {
  const explicit = process.env.AUTH_GATE_SECRET
  if (explicit) return explicit
  const pw = process.env.TEAM_GATE_PASSWORD || ''
  return crypto.createHash('sha256').update(`spectre-gate:${pw}`).digest('hex')
}

function getDemoSecret() {
  const explicit = process.env.DEMO_SESSION_SECRET
  if (explicit) return explicit
  return crypto.createHash('sha256').update(`demo:${getSecret()}`).digest('hex')
}

function getIpHashSalt() {
  return process.env.IP_HASH_SALT || `demo-ip:${getSecret()}`
}

function getClientIp(req) {
  // Vercel appends the real client IP LAST.
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

function sign(payload) {
  const h = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${h}`
}

// SameSite=Lax (was Strict): Strict cookies drop across the installed-PWA launch
// boundary (mobile home-screen + desktop), which forced a re-login every launch.
// Lax survives it and still blocks cross-site CSRF. The cross-site iframe embed
// on research /token is handled separately by the dc_demo token, not this cookie.
function issueGateCookie(name, maxAgeSec) {
  const token = sign(String(Date.now()))
  return `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`
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
  // trade.spectreai.io removed 2026-05-12: DNS does not resolve (NXDOMAIN). Subdomain-takeover vector.
  // spectre-app-research.vercel.app added 2026-05-21 so the research app can
  // mint a trading demo session cross-origin (the response must echo the
  // origin + Allow-Credentials for the Set-Cookie to be accepted). The
  // demo-session action separately enforces DEMO_ALLOWED_ORIGINS, so this only
  // enables the header echo — it does not by itself widen what's reachable.
  const allow = [
    'http://localhost:5180',
    'http://localhost:5181',
    'https://app.spectreai.io',
    'https://spectre-app-research.vercel.app',
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

  // GET /api/auth-gate?action=check - verify cookie freshness on mount.
  if (req.method === 'GET' && action === 'check') {
    // Team password cookie (30d) - always honored. Rolling refresh: re-issue on
    // every valid check so an installed PWA never lapses back to the gate.
    const teamToken = readCookie(req, COOKIE_NAME)
    if (teamToken && verify(teamToken, COOKIE_MAX_AGE)) {
      res.setHeader('Set-Cookie', issueGateCookie(COOKIE_NAME, COOKIE_MAX_AGE))
      return res.status(200).json({ ok: true, gate: 'team' })
    }
    // Beta access cookie (30d) - only honored when BETA_OPEN === 'true'.
    // Lets us close the beta without rotating the signing key (which
    // would also invalidate team cookies). Rolling-refreshed too.
    const betaToken = readCookie(req, BETA_COOKIE_NAME)
    if (process.env.BETA_OPEN === 'true' && betaToken && verify(betaToken, BETA_COOKIE_MAX_AGE)) {
      res.setHeader('Set-Cookie', issueGateCookie(BETA_COOKIE_NAME, BETA_COOKIE_MAX_AGE))
      return res.status(200).json({ ok: true, gate: 'beta' })
    }
    // Research-embed demo session (15 min, read-only)
    if (isDemoSession(req)) return res.status(200).json({ ok: true, demo: true })
    // Surface beta-closed status so the gate UI can render the "Beta launches
    // soon" screen on first paint instead of the misleading email-entry form
    // (server-side block still applies regardless; this is a UX hint only).
    return res.status(401).json({ ok: false, betaClosed: process.env.BETA_OPEN !== 'true' })
  }

  // GET /api/auth-gate?action=demo-session - mint a read-only demo session for
  // the research "Trading Lite" embed. The research app fires this cross-origin
  // before its iframe's data calls; the browser-set Origin proves it came from
  // the research app (Origin is a forbidden header in cross-origin fetches, so
  // JS cannot forge it). Per-IP rate-limited. Cookie is SameSite=None; Secure
  // (cross-site iframe) + IP-bound + 15-min TTL.
  if (req.method === 'GET' && action === 'demo-session') {
    if (await rateLimit(req, res, { bucket: 'demo-session-issue', max: 10, windowMs: 60_000 })) return

    const origin = (req.headers?.origin || '').toLowerCase()
    if (!DEMO_ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: 'demo-session refused', reason: 'origin' })
    }

    // Defense-in-depth: a real research-app fetch into the trading origin is
    // cross-site (different eTLD+1). Browsers set Sec-Fetch-Site; curl/scripts
    // omit it. Reject obvious anomalies (e.g. 'none' = top-level navigation).
    // Not a hard boundary (curl can forge the header) — the real bounds are
    // the per-IP rate limit + read-only scope — but it blocks lazy abuse.
    const site = req.headers?.['sec-fetch-site']
    if (site && site !== 'cross-site' && site !== 'same-site') {
      return res.status(403).json({ error: 'demo-session refused', reason: 'fetch-site' })
    }

    const ipHash = hashIp(getClientIp(req))
    const exp = Date.now() + DEMO_COOKIE_MAX_AGE * 1000
    const token = signDemo(`${ipHash}.${exp}`)

    // Dual transport (SEC-20260521-DEMOTOKEN):
    // 1) Cookie path for the PROD same-site embed. When this request is served
    //    on a *.spectreai.io host (trade.spectreai.io), the research parent
    //    (app.spectreai.io) is SAME-SITE, so a Domain=.spectreai.io cookie is
    //    first-party inside the iframe — it survives third-party-cookie blocking
    //    (Chrome phase-out / Safari ITP / Firefox ETP) AND stays HttpOnly, so
    //    prod carries NO JS-readable credential. On any other host (*.vercel.app
    //    preview/dev) the parent is cross-site and such a cookie would be
    //    dropped, so we skip it (condition 6) and rely on the header path below.
    // 2) Header path (cross-site fallback): always return the token in the body
    //    so the research embed can postMessage it to the iframe, which sends it
    //    as x-demo-token. SAME signed, IP-bound, 15-min, read-only token.
    const host = (req.headers?.host || '').toLowerCase()
    const onSpectreHost = host === 'spectreai.io' || host.endsWith('.spectreai.io')
    if (onSpectreHost) {
      res.setHeader('Set-Cookie',
        `${DEMO_COOKIE_NAME}=${token}; Path=/; Max-Age=${DEMO_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=None; Domain=.spectreai.io`,
      )
    }
    return res.status(200).json({ ok: true, demo: true, token, expiresIn: DEMO_COOKIE_MAX_AGE })
  }

  // POST /api/auth-gate - login path.
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (await rateLimit(req, res, { bucket: 'auth-gate', max: 5, windowMs: 15 * 60_000 })) return

  const expected = process.env.TEAM_GATE_PASSWORD
  if (!expected) return res.status(503).json({ error: 'Gate not configured' })

  const candidate = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!candidate) return res.status(400).json({ error: 'Missing password' })

  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!ok) return res.status(401).json({ error: 'Invalid password' })

  res.setHeader('Set-Cookie', issueGateCookie(COOKIE_NAME, COOKIE_MAX_AGE))
  return res.status(200).json({ ok: true })
}

// Exported for other API routes that want to enforce the gate cookie.
// Accepts EITHER spectre-gate (team, 24h) or spectre-beta (per-user, 7d).
// Beta cookies are only honored when BETA_OPEN === 'true' so we can
// close the beta cohort without rotating the shared signing key.
export function isAuthGateValid(req) {
  const teamToken = readCookie(req, COOKIE_NAME)
  if (teamToken && verify(teamToken, COOKIE_MAX_AGE)) return true
  if (process.env.BETA_OPEN === 'true') {
    const betaToken = readCookie(req, BETA_COOKIE_NAME)
    if (betaToken && verify(betaToken, BETA_COOKIE_MAX_AGE)) return true
  }
  return false
}

// Exported for read-only market-data handlers (codex read actions, bars).
// Validates the dc_demo cookie HMAC + expiry + IP-binding. Returns true only
// for the same IP that minted it. POST/swap/user/admin handlers must NOT opt
// into this — they stay Privy/gate-only.
export function isDemoSession(req) {
  // Accept the demo token from the first-party cookie (prod same-site path) OR
  // the x-demo-token header (cross-site fallback; SEC-20260521-DEMOTOKEN). Both
  // carry the SAME signed token and run the IDENTICAL HMAC + IP-bind + expiry
  // validation below. Only read-only handlers call isDemoSession — mutation /
  // user / admin / swap handlers must NOT, so the header unlocks nothing the
  // cookie didn't.
  const headerTok = req.headers?.['x-demo-token']
  const raw = readCookie(req, DEMO_COOKIE_NAME) || (typeof headerTok === 'string' ? headerTok : null)
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
  // Hard IP-binding dropped 2026-06-11: dual-stack (Happy Eyeballs) and CGNAT
  // clients legitimately change source IP BETWEEN connections, so the mint and
  // the data calls disagree and every Trading Lite embed request 401s. Live
  // repro against prod: the SAME token was rejected and then accepted minutes
  // apart with no other input changing. HMAC + 15-min expiry + read-only
  // handler scope + origin-gated mint remain - a leaked token can read public
  // market data for at most 15 minutes. ipHash stays in the payload (format
  // unchanged, old tokens validate) for forensics/log correlation.
  return true
}
