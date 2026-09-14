/**
 * Vercel Serverless – News & feeds router.
 * Consolidates: news, cryptopanic, news-rss, rss-feed
 * Dispatches via ?fn= query parameter.
 */
import news from './_lib/handlers/news.js'
import cryptopanic from './_lib/handlers/cryptopanic.js'
import newsRss from './_lib/handlers/news-rss.js'
import rssFeed from './_lib/handlers/rss-feed.js'
import newsHistory from './_lib/handlers/news-history.js'
import newsBrief from './_lib/handlers/news-brief.js'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const handlers = {
  'news': news,
  'cryptopanic': cryptopanic,
  'news-rss': newsRss,
  'rss-feed': rssFeed,
  'news-history': newsHistory,
  'news-brief': newsBrief,
}

export default async function handler(req, res) {
  const fn = req.query.fn

  // Wave 5h (SEC-20260516-API-FARM-001): tiered gate. News surfaces poll
  // often (intel feed polls ~every 30s) so the per-user cap is generous.
  // CryptoCompare + CryptoPanic still bound by their own keys upstream;
  // these caps keep one runaway client from draining the whole quota.
  const userId = await verifyPrivyToken(req)
  if (userId) {
    if (await userRateLimit(res, { bucket: `news-${fn || 'unknown'}`, userId, max: 120, windowMs: 60_000 })) return
  } else if (isAuthGateValid(req)) {
    if (await rateLimit(req, res, { bucket: `news-${fn || 'unknown'}-anon`, max: 60, windowMs: 60_000 })) return
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
  if (!h) return res.status(400).json({ error: `Unknown news-api function: ${fn}` })
  return h(req, res)
}
