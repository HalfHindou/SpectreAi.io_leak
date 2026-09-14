/**
 * Vercel Serverless — IP geolocation proxy (replaces direct ipapi.co calls).
 *
 * 2026-05-28 hide-apis: the header weather widget and the GM dashboard both
 * hit `https://ipapi.co/json/` from the browser as the fallback when
 * `navigator.geolocation` is unavailable / denied. That direct call put
 * `ipapi.co` in the user's CSP connect-src + Network tab.
 *
 * This proxy preserves the EXACT ipapi.co JSON shape (latitude, longitude,
 * city, region, country, etc.) so client code doesn't change beyond the URL.
 * Per-IP in-memory cache (24h TTL — geo is stable) + per-IP rate limit
 * (5/min — no real user needs more) + 5s upstream timeout.
 *
 * Per the existing ratelimit.js pattern, the cache is in-memory only (no KV
 * commit). Cold starts cycle the cache — acceptable trade-off vs blowing
 * the Upstash free-tier quota.
 */

import { rateLimit } from './_lib/ratelimit.js'

const IPAPI_URL = 'https://ipapi.co/json/'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const UPSTREAM_TIMEOUT_MS = 5_000

const _cache = new Map() // ip -> { data, ts }

function getClientIp(req) {
  // Mirrors the convention used elsewhere in this API surface (Vercel
  // appends the real client IP LAST on x-forwarded-for).
  const xff = req.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return req.headers?.['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=3600') // browser-side hint; we do server cache too

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
