/**
 * Vercel Serverless – Media & content router.
 * Consolidates: media, tweets, voice-speak
 * Dispatches via ?fn= query parameter.
 */
import media from './_lib/handlers/media.js'
import tweets from './_lib/handlers/tweets.js'
import voiceSpeak from './_lib/handlers/voice-speak.js'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const handlers = {
  'media': media,
  'tweets': tweets,
  'voice-speak': voiceSpeak,
}

// Wave 5h (SEC-20260516-API-FARM-001): per-fn caps. voice-speak hits
// ElevenLabs (~$0.30/1k chars) so its budget is the tightest.
const FN_LIMITS = {
  'media':       { user: 60, anon: 30 },
  'tweets':      { user: 60, anon: 30 },
  'voice-speak': { user: 10, anon: 5  },
}

export default async function handler(req, res) {
  const fn = req.query.fn

  // 2026-05-11 lockdown + Wave 5h: voice-speak hits ElevenLabs (paid per
  // char), tweets proxy X-Dash, media library is auth-only content.
  const userId = await verifyPrivyToken(req)
  const limits = FN_LIMITS[fn] || { user: 60, anon: 30 }
  if (userId) {
    if (await userRateLimit(res, { bucket: `media-${fn || 'unknown'}`, userId, max: limits.user, windowMs: 60_000 })) return
  } else if (isAuthGateValid(req)) {
    if (await rateLimit(req, res, { bucket: `media-${fn || 'unknown'}-anon`, max: limits.anon, windowMs: 60_000 })) return
  } else {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  sealGatedResponse(res)

  const h = handlers[fn]
  if (!h) return res.status(400).json({ error: `Unknown media-api function: ${fn}` })
  return h(req, res)
}
