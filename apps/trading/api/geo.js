/**
 * Vercel Serverless — IP geolocation proxy (replaces direct ipapi.co calls).
 *
 * 2026-06-09 parity: mirror of apps/research/api/geo.js. The trading weather
 * widget (src/hooks/useWeather.js) hit `https://ipapi.co/json/` directly from
 * the browser as the geolocation fallback — putting `ipapi.co` in the trading
 * CSP connect-src + the user's Network tab. Research proxied this on 2026-05-28
 * (hide-apis); trading was never given the parity proxy. This closes that gap
 * and lets `ipapi.co` come out of the trading connect-src.
 *
 * Preserves the EXACT ipapi.co JSON shape (latitude, longitude, city, region,
 * country, ...) so client code changes only the URL. Per-IP in-memory cache
 * (24h TTL — geo is stable) + per-IP rate limit (5/min) + 5s upstream timeout.
 * In-memory only (no KV commit), same trade-off as ratelimit.js.
 */

import { rateLimit } from './_lib/ratelimit.js'

const IPAPI_URL = 'https://ipapi.co/json/'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const UPSTREAM_TIMEOUT_MS = 5_000

const _cache = new Map() // ip -> { data, ts }

function getClientIp(req) {
  // Vercel appends the real client IP LAST on x-forwarded-for.
  const xff = req.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return req.headers?.['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=3600') // browser-side hint; server cache below

  // Per-IP rate limit (5/min) — defense-in-depth against farming.
  if (await rateLimit(req, res, { bucket: 'geo', max: 5, windowMs: 60_000 })) return

  const ip = getClientIp(req)
  const cached = _cache.get(ip)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data)
  }

  try {
    const r = await fetch(IPAPI_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!r.ok) return res.status(r.status).json({ error: `geo upstream ${r.status}` })
    const data = await r.json()
    _cache.set(ip, { data, ts: Date.now() })
    return res.status(200).json(data)
  } catch (_err) {
    return res.status(502).json({ error: 'geo upstream failed' })
  }
}
