/**
 * Vercel Serverless — YOU V2 umbrella router.
 *
 * Dispatches to events / compose handlers via ?fn= query parameter.
 * Keeps function count low to minimize Vercel builder costs (matches the
 * data-api / market-api / trade-api convention used elsewhere in this app).
 *
 * Rewrites in vercel.json route:
 *   /api/you/events  → /api/you-api?fn=events
 *   /api/you/compose → /api/you-api?fn=compose
 */

import youEvents from './_lib/handlers/you-events.js'
import youCompose from './_lib/handlers/you-compose.js'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const handlers = {
  events: youEvents,
  compose: youCompose,
}

// Per-fn caps. `compose` calls Groq (paid LLM, ~$0.001/call) so it has the
// tightest budget. `events` is feed-read, cheaper but still needs a cap.
const FN_LIMITS = {
  compose: { user: 20, anon: 10, bucket: 'you-compose' },
  events:  { user: 60, anon: 30, bucket: 'you-events' },
}

export default async function handler(req, res) {
  const fn = req.query?.fn
  const limits = FN_LIMITS[fn]

  // 2026-05-11 lockdown + Wave 5h (SEC-20260516-003): /you is the personal
  // compose surface. Tiered gate: prefer Privy user identity, fall back to
  // auth-gate cookie with tighter per-IP cap. Anonymous = 401.
  if (limits) {
    const userId = await verifyPrivyToken(req)
    if (userId) {
      if (await userRateLimit(res, { bucket: limits.bucket, userId, max: limits.user, windowMs: 60_000 })) return
    } else if (isAuthGateValid(req)) {
      if (await rateLimit(req, res, { bucket: `${limits.bucket}-anon`, max: limits.anon, windowMs: 60_000 })) return
    } else {
      return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
    }
  } else if (!isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  sealGatedResponse(res)

  const h = handlers[fn]
  if (!h) {
    return res.status(400).json({ error: `Unknown you-api function: ${fn}` })
  }
  return h(req, res)
}
