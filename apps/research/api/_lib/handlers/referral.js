/**
 * Vercel Serverless - Referral Code API
 * POST /api/referral/apply  - apply a referrer's code (authenticated)
 * GET  /api/referral/code   - get the authenticated user's own code
 * GET  /api/referral/stats  - get authenticated user's referral stats
 *
 * Codes are random base32 (see kv.js), NOT derived from userId. The userId
 * always comes from the verified Privy JWT - never from a path param or body.
 */

import { verifyPrivyToken } from '../auth.js'
import { rateLimit, userRateLimit } from '../ratelimit.js'
import {
  addReferral,
  getReferrals,
  isUserReferred,
  isValidReferralCode,
  getReferralOwner,
  getOrCreateUserReferralCode,
} from '../kv.js'

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
]

export default async function handler(req, res) {
  const origin = req.headers?.origin
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  // Support both URL path parsing and query-based routing (via vercel.json rewrite).
  const queryPath = req.query?.path || ''
  let parts = queryPath ? queryPath.split('/').filter(Boolean) : []
  if (parts.length === 0) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    parts = url.pathname.replace(/^\/api\/referral\/?/, '').split('/').filter(Boolean)
  }
  const action = parts[0]

  if (req.method === 'POST' && action === 'apply') {
    // Tight rate limit on apply: real users hit this exactly once. Blocks
    // code-enumeration sprays (per-user 5/min) and IP-level pool abuse
    // (per-IP 20/min).
    if (await rateLimit(req, res, { bucket: 'referral-apply', max: 20, windowMs: 60_000 })) return
    if (await userRateLimit(res, { bucket: 'referral-apply', userId, max: 5, windowMs: 60_000 })) return

    const raw = (req.body && typeof req.body === 'object') ? req.body.code : undefined
    if (typeof raw !== 'string' || raw.length > 16) {
      return res.status(400).json({ error: 'code required' })
    }
    const code = raw.toUpperCase().trim()
    if (!isValidReferralCode(code)) {
      // 400 reserved for malformed shape only. Existence is opaque past here.
      return res.status(400).json({ error: 'Invalid referral code' })
    }

    if (await isUserReferred(userId)) {
      return res.status(409).json({ error: 'User already has a referral' })
    }

    // Collapse "code not found" and "code is yours" into one identical
    // response. Pre-fix this was a 3-way oracle (404/400/200) that a
    // fresh-signup attacker could use to fingerprint code ownership.
    const ownerId = await getReferralOwner(code)
    if (!ownerId || ownerId === userId) {
      return res.status(404).json({ error: 'Referral code not found' })
    }

    // addReferral uses SET NX so a concurrent /apply for a different
    // code can't also win — the loser sees claimed === false and maps
    // to 409, idempotent with the isUserReferred check above.
    const recorded = await addReferral({
      userId,
      referrerCode: code,
      appliedAt: new Date().toISOString(),
    })
    if (!recorded) {
      return res.status(409).json({ error: 'User already has a referral' })
    }
    return res.json({ success: true })
  }

  if (req.method === 'GET' && action === 'code') {
    try {
      const code = await getOrCreateUserReferralCode(userId)
      const referred = await getReferrals(code)
      return res.json({ code, referredCount: referred.length })
    } catch (err) {
      console.error('[referral/code] error:', err.message)
      return res.status(503).json({ error: 'Referral code unavailable' })
    }
  }

  if (req.method === 'GET' && action === 'stats') {
    try {
      const code = await getOrCreateUserReferralCode(userId)
      const referred = await getReferrals(code)
      // Drop the per-referral userId field — the pre-fix slice(0, 12)
      // mask leaked 2 unique chars per user (every Privy DID prefix is
      // exactly 'did:privy:cm') and looked like effort while being
      // theater. Owner dashboard only needs aggregate count + dates.
      return res.json({
        code,
        referredCount: referred.length,
        referrals: referred.map(r => ({ appliedAt: r.appliedAt })),
      })
    } catch (err) {
      console.error('[referral/stats] error:', err.message)
      return res.status(503).json({ error: 'Referral stats unavailable' })
    }
  }

  return res.status(404).json({ error: 'Not found' })
}
