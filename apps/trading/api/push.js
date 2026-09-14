/**
 * Vercel Serverless Function - Web Push subscription CRUD
 *
 * POST /api/push   - store the caller's PushSubscription (Privy JWT required)
 * DELETE /api/push - remove a subscription by endpoint
 *
 * KV: hash push:subs:{userId}  field = subscription endpoint, value = JSON.
 */
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { userRateLimit } from './_lib/ratelimit.js'

let _kvPromise = null
async function getKv() {
  if (_kvPromise) return _kvPromise
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) { _kvPromise = Promise.resolve(null); return _kvPromise }
  _kvPromise = import('@upstash/redis').then(m => new m.Redis({ url, token })).catch(() => null)
  return _kvPromise
}

const ALLOWED_ORIGINS = ['http://localhost:5180', 'http://localhost:5181']

export default async function handler(req, res) {
  const origin = req.headers?.origin
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (!isAuthGateValid(req)) return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Privy auth required', code: 'PRIVY_REQUIRED' })
  if (await userRateLimit(res, { bucket: 'push', userId, max: 20, windowMs: 60_000 })) return

  const kv = await getKv()
  if (!kv) return res.status(503).json({ error: 'KV not configured' })

  try {
    if (req.method === 'POST') {
      const sub = req.body
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return res.status(400).json({ error: 'Invalid subscription' })
      }
      await kv.hset(`push:subs:${userId}`, { [sub.endpoint]: JSON.stringify(sub) })
      return res.status(201).json({ ok: true })
    }
    if (req.method === 'DELETE') {
      const { endpoint } = req.body || {}
      if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
      await kv.hdel(`push:subs:${userId}`, endpoint)
      return res.json({ ok: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[push] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
