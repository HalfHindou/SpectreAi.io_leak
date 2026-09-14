/**
 * Vercel Serverless — Monarch AI dispatcher.
 * Routes:
 *   /api/monarch/chat   → ?fn=chat   (SSE streaming chat with Spectre context)
 *   /api/monarch/health → ?fn=health (health/status)
 *
 * The chat handler streams responses up to 60s. Configure `maxDuration` per
 * Vercel plan — Pro paid supports up to 300s for long-running LLM calls.
 */
import { chat, health } from './_lib/handlers/monarch-chat.js'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

export const config = {
  maxDuration: 60,
}

const handlers = { chat, health }

export default async function handler(req, res) {
  const fn = req.query.fn

  // Wave 5h API-farming gate (SEC-20260516-002): tiered Anthropic/Groq
  // burn limit. Per-call LLM inference is the highest-$ surface; cap
  // Privy users at 10/min and rate-limit anon auth-gate sessions at
  // 5/min per IP. Health stays open for external monitors.
  if (fn === 'chat') {
    const userId = await verifyPrivyToken(req)
    if (userId) {
      if (await userRateLimit(res, { bucket: 'monarch-chat', userId, max: 10, windowMs: 60_000 })) return
    } else if (isAuthGateValid(req)) {
      if (await rateLimit(req, res, { bucket: 'monarch-chat-anon', max: 5, windowMs: 60_000 })) return
    } else {
      return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
    }

    // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
    // function, while the handlers below set `public, s-maxage=…`. Composed,
    // those two let a warm edge entry serve a gated payload to a caller who
    // never reached this line — measured on /api/private/* 2026-08-25.
    // data-api was sealed then; every other gated entrypoint was not.
    sealGatedResponse(res)
  }

  const h = handlers[fn]
  if (!h) return res.status(400).json({ error: `Unknown monarch-api function: ${fn}` })
  return h(req, res)
}
