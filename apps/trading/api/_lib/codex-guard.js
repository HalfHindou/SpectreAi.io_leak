/**
 * Codex proxy guard — locks down /api/codex and /api/codex-stream against
 * public abuse. Burns of our Codex token quota by anonymous browsers and
 * cross-origin scrapers prompted this in 2026-05-11.
 *
 * Layers:
 *   1. Origin allowlist (rejects 403 if Origin header is set to a non-allowed
 *      value — includes direct curl with custom Origin, which CORS does not
 *      block). Same-origin browser calls send no Origin header (or echo our
 *      own host) and pass.
 *   2. Per-action rate limits — search/trending/bars/details are expensive;
 *      health/prices are cheap. Tighter caps on expensive actions.
 *
 * Allowlist overridable via `CODEX_ALLOWED_ORIGINS` env (comma-list).
 *
 * Trading-app copy of apps/research/api/_lib/codex-guard.js. Keep in sync.
 */

import { rateLimit } from './ratelimit.js'

const DEFAULT_ALLOWED = [
  'http://localhost:5180',
  'http://localhost:5181',
  'http://localhost:5182',
  'http://localhost:3000',
  'https://app.spectreai.io',
  'https://spectreai.io',
  'https://www.spectreai.io',
  'https://trade.spectreai.io',
]

function _allowedOrigins() {
  const env = process.env.CODEX_ALLOWED_ORIGINS
  if (!env) return DEFAULT_ALLOWED
  const extras = env.split(',').map(s => s.trim()).filter(Boolean)
  return [...new Set([...DEFAULT_ALLOWED, ...extras])]
}

export function validateOrigin(req) {
  const origin = (req.headers?.origin || '').toLowerCase()
  const fetchSite = (req.headers?.['sec-fetch-site'] || '').toLowerCase()

  const allowed = _allowedOrigins().map(s => s.toLowerCase())

  if (!origin) {
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

const ACTION_LIMITS = {
  health: 600,
  prices: 120,
  details: 60,
  'details-batch': 30,
  search: 20,
  // Leading-edge keystroke tier (search?fast=1): Hetzner-only + edge-cached,
  // structurally zero Codex. Generous on purpose - a fast typist fires
  // several per word and CDN HITs never reach this limiter anyway.
  'search-fast': 120,
  trending: 30,
  bars: 60,
  ath: 30,
  trades: 30,
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

export async function codexGuard(req, res, { action = 'unknown' } = {}) {
  const v = validateOrigin(req)
  if (!v.ok) {
    res.setHeader('Vary', 'Origin')
    res.status(403).json({ error: 'Forbidden', reason: 'origin' })
    return true
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', v.echo)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return true
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
