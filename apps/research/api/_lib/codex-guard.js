/**
 * Codex proxy guard — locks down /api/codex and /api/codex-stream against
 * public abuse. Burns of our Codex token quota by anonymous browsers and
 * cross-origin scrapers prompted this in 2026-05-11.
 *
 * Layers:
 *   1. Origin allowlist (rejects 403 if Origin header is set to a non-allowed
 *      value — includes direct curl with custom Origin, which CORS does not
 *      block). Same-origin browser calls send no Origin header (or echo our
 *      own host) and pass. The `Sec-Fetch-Site` hint is checked when present
 *      for an extra signal.
 *   2. Per-action rate limits — search/trending/bars/details are expensive;
 *      health/prices are cheap. Tighter caps on expensive actions.
 *
 * Allowlist can be overridden via `CODEX_ALLOWED_ORIGINS` env (comma-list).
 */

import { rateLimit } from './ratelimit.js'
import { isAuthGateValid, isDemoSession } from '../auth-gate.js'

const DEFAULT_ALLOWED = [
  'http://localhost:5180',
  'http://localhost:5181',
  'http://localhost:5182',
  'http://localhost:3000',
  'https://app.spectreai.io',
  'https://spectreai.io',
  'https://www.spectreai.io',
  // trade.spectreai.io removed 2026-05-12: DNS does not resolve (NXDOMAIN).
  // Re-add only when the subdomain actually exists on Vercel — otherwise it's
  // a takeover vector (whoever claims the name gets a same-cookie origin).
]

// Actions that burn paid Codex quota — must be cookie-gated so anonymous
// bots/curl can't drain our token budget by hammering them. health and prices
// stay public for cold-start UX (the welcome page reads prices before the gate
// is even shown). 2026-05-12 lockdown: pre-fix, `curl -H "Origin: https://app.spectreai.io" /api/codex?action=search` returned 200.
const GATED_ACTIONS = new Set(['search', 'trending', 'bars', 'details', 'details-batch', 'ath', 'trades'])

// Actions reachable via demo-session cookie (showcase iframe). Tighter
// per-IP rate-limit applies (ACTION_LIMITS minus the demo multiplier).
// Only read-only actions with bounded cost. `trending` and `bars` added
// 2026-05-15 so the showcase Welcome page renders the Codex DEX trending
// list and sparkline data. ACTION_LIMITS already rate-limits per-IP
// (trending 30/min, bars 60/min, details 60/min, details-batch 30/min).
// `search` and `trades` stay gate-only - iframe doesn't need them.
// SEC-20260513-017.
const DEMO_ALLOWED_ACTIONS = new Set(['details', 'details-batch', 'ath', 'trending', 'bars'])

function _allowedOrigins() {
  const env = process.env.CODEX_ALLOWED_ORIGINS
  if (!env) return DEFAULT_ALLOWED
  const extras = env.split(',').map(s => s.trim()).filter(Boolean)
  return [...new Set([...DEFAULT_ALLOWED, ...extras])]
}

/**
 * Returns the validated Origin to echo back in CORS headers, or `null` if the
 * request should be rejected. A request is acceptable when:
 *   - Origin header is missing (server-to-server, same-origin GET) AND
 *     Sec-Fetch-Site is missing/none/same-origin, OR
 *   - Origin is in the allowlist.
 *
 * Rejects browser cross-origin requests from unknown origins and any direct
 * curl that sets `Origin: https://evil.example`.
 */
export function validateOrigin(req) {
  const origin = (req.headers?.origin || '').toLowerCase()
  const fetchSite = (req.headers?.['sec-fetch-site'] || '').toLowerCase()

  const allowed = _allowedOrigins().map(s => s.toLowerCase())

  if (!origin) {
    // No Origin header. Browsers send Origin on cross-origin and most same-origin
    // requests now. cURL/server-to-server typically has no Origin. Allow when
    // Sec-Fetch-Site is none/same-origin or missing (server-to-server).
    if (!fetchSite || fetchSite === 'none' || fetchSite === 'same-origin') {
      return { ok: true, echo: '' }
    }
    return { ok: false, reason: 'missing-origin-with-cross-site' }
  }

  if (allowed.includes(origin)) {
    return { ok: true, echo: origin }
  }

  return { ok: false, reason: `origin-not-allowed:${origin}` }
}

/**
 * Per-action limits. Defaults conservative; tunable via env.
 *
 *   CODEX_RATE_DEFAULT_PER_MIN     fallback per-action cap
 *   CODEX_RATE_<ACTION>_PER_MIN    override (e.g. CODEX_RATE_SEARCH_PER_MIN=20)
 *
 * These are PER-IP per minute. With 3 devs in pre-beta a single human almost
 * never exceeds these; bots/loops trip them immediately.
 */
const ACTION_LIMITS = {
  health: 600,
  prices: 120,
  details: 60,
  'details-batch': 30,
  search: 20,
  trending: 30,
  bars: 60,
  ath: 30,
  trades: 30,
  // Catch-all for unknown actions on the same proxy
  _default: 60,
}

function _limitFor(action) {
  const upper = String(action || '').toUpperCase().replace(/-/g, '_')
  const envKey = `CODEX_RATE_${upper}_PER_MIN`
  const envVal = parseInt(process.env[envKey], 10)
  if (Number.isFinite(envVal) && envVal > 0) return envVal
  if (ACTION_LIMITS[action] != null) return ACTION_LIMITS[action]
  const defaultVal = parseInt(process.env.CODEX_RATE_DEFAULT_PER_MIN, 10)
  if (Number.isFinite(defaultVal) && defaultVal > 0) return defaultVal
  return ACTION_LIMITS._default
}

/**
 * Combined guard. Sets CORS headers when the origin is allowed, applies
 * per-action rate limit, and returns `true` if the response has already been
 * sent (caller should return immediately).
 *
 * Usage:
 *   if (await codexGuard(req, res, { action: req.query.action || 'unknown' })) return
 */
export async function codexGuard(req, res, { action = 'unknown' } = {}) {
  const v = validateOrigin(req)
  if (!v.ok) {
    res.setHeader('Vary', 'Origin')
    res.status(403).json({ error: 'Forbidden', reason: 'origin' })
    return true
  }

  // Set CORS headers (allowed origin echoed, or empty string for no-Origin server calls)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', v.echo)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return true
  }

  // Quota-burn defense: expensive actions require the auth-gate cookie. The
  // Origin allowlist alone is not enough — curl can set any Origin header
  // (CORS is browser-enforced; servers must verify independently). The cookie
  // is HttpOnly + HMAC-signed so JS / curl can't forge it.
  //
  // Demo-session bypass (SEC-20260513-017): a narrow set of read-only
  // actions also accept the showcase demo cookie. The cookie itself is
  // IP-bound and 15-min-lived, plus the per-action rate-limit below caps
  // total volume. Other gated actions (search, bars, trades, trending)
  // stay cookie-only.
  if (GATED_ACTIONS.has(action)) {
    const authed = isAuthGateValid(req)
    const demoOk = DEMO_ALLOWED_ACTIONS.has(action) && isDemoSession(req)
    if (!authed && !demoOk) {
      res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
      return true
    }
  }

  const max = _limitFor(action)
  const limited = await rateLimit(req, res, {
    bucket: `codex:${action}`,
    max,
    windowMs: 60_000,
  })
  if (limited) return true

  return false
}

export const _internal = { _allowedOrigins, ACTION_LIMITS, _limitFor }
