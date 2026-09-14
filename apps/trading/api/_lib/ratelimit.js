/**
 * Sliding-window rate limiter for Vercel serverless functions.
 *
 * 2026-05-18 architecture decision: in-memory only. KV stays free-tier
 * (10k commands/day) and is reserved for persistent state that MUST
 * survive cold starts (alerts ownership in alerts.js, fee config, user
 * profiles). Rate limiting is ephemeral per-instance state - acceptable
 * to lose on cold start in exchange for never blowing the KV quota.
 *
 * Trade-off: an attacker can rotate Vercel cold starts to multiply
 * effective rate-limit buckets. In practice each instance stays warm
 * 10-15 min so the limit holds during sustained traffic; bursty
 * cold-start abuse gets a small multiplier (typically 2-4x). Worth it
 * to stay free + never DOS the team via KV exhaustion (witnessed
 * 2026-05-18 when Upstash free-tier quota hit and the prior
 * fail-closed change locked the entire trading auth-gate).
 *
 * To re-enable KV-backed rate limiting later (e.g. after upgrading
 * Upstash to Pay-As-You-Go), set RATELIMIT_USE_KV=1 in the project
 * env. Code path is preserved below behind that flag.
 *
 * Usage:
 *   import { rateLimit } from './_lib/ratelimit.js'
 *   const limited = await rateLimit(req, res, { bucket: 'swap-quote', max: 30, windowMs: 60_000 })
 *   if (limited) return
 */

let kvClientPromise = null
const memoryHits = new Map()

async function getKvClient() {
  if (kvClientPromise) return kvClientPromise
  if (process.env.RATELIMIT_USE_KV !== '1') {
    // KV deliberately disabled for rate limiting - see file header.
    kvClientPromise = Promise.resolve(null)
    return kvClientPromise
  }
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    kvClientPromise = Promise.resolve(null)
    return kvClientPromise
  }
  kvClientPromise = import('@vercel/kv').then(m => m.kv).catch(() => null)
  return kvClientPromise
}

function clientIp(req) {
  // SEC-20260513-RT-12: drop x-real-ip (client-spoofable on Vercel).
  const vercelIp = req.headers?.['x-vercel-forwarded-for']
  if (typeof vercelIp === 'string' && vercelIp.length) {
    // x-vercel-forwarded-for is a comma list; the LAST entry is the trusted hop.
    const parts = vercelIp.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  // Fallback to x-forwarded-for: use the LAST entry (closest to the edge),
  // never the first (which is fully attacker-controlled — attacker can set
  // `X-Forwarded-For: 1.2.3.4` to rotate fake IPs per request).
  const xff = req.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff.length) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown'
}

async function applyLimit(res, key, max, windowMs) {
  const windowKey = Math.floor(Date.now() / windowMs)
  const scopedKey = `${key}:${windowKey}`
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000))

  let count = 0
  let kvFailed = false
  const kv = await getKvClient()

  if (kv) {
    try {
      count = await kv.incr(scopedKey)
      if (count === 1) await kv.expire(scopedKey, ttlSec)
    } catch (err) {
      // SEC-20260513-RT-12 v2 (2026-05-18 hotfix): fall back to in-memory
      // bucket on KV outage instead of failing closed. The original
      // fail-closed change locked EVERYONE out of the trading auth-gate
      // when the trading project's Vercel KV started throwing - a global
      // outage rather than the intended per-IP-bucket protection. In-memory
      // fallback keeps the limit enforced (process-local, resets per cold
      // start) without bricking legitimate users. Attacker can still get
      // bypass-via-KV-outage but pays in noise: each cold start resets
      // the in-memory counter and the attack must be timed to outages.
      console.error('[ratelimit] KV error - falling back to in-memory:', err?.message || err)
      kvFailed = true
    }
  }

  if (!kv || kvFailed) {
    const now = Date.now()
    const entry = memoryHits.get(scopedKey)
    if (!entry || entry.expires < now) {
      memoryHits.set(scopedKey, { count: 1, expires: now + windowMs })
      count = 1
    } else {
      entry.count++
      count = entry.count
    }
    if (memoryHits.size > 2000) {
      for (const [k, v] of memoryHits) if (v.expires < now) memoryHits.delete(k)
    }
  }

  if (count > max) {
    const retryAfter = Math.ceil(((windowKey + 1) * windowMs - Date.now()) / 1000)
    res.setHeader('Retry-After', String(Math.max(1, retryAfter)))
    res.status(429).json({ error: 'Too many requests' })
    return true
  }
  return false
}

export async function rateLimit(req, res, { bucket, max, windowMs }) {
  const ip = clientIp(req)
  return applyLimit(res, `rl:${bucket}:${ip}`, max, windowMs)
}

/**
 * Per-user sliding-window rate limiter. The caller must have already
 * verified the Privy JWT and extracted userId. Partitions strictly by
 * userId so testers behind a shared NAT don't share the bucket, AND a
 * stolen JWT used from many IPs still hits one cap.
 *
 * Returns true if the request was limited (response already sent).
 */
export async function userRateLimit(res, { bucket, userId, max, windowMs }) {
  if (!userId) return false
  return applyLimit(res, `rl:${bucket}:user:${userId}`, max, windowMs)
}
