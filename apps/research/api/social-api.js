/**
 * Vercel Serverless – Social intelligence router.
 * Consolidates: xdash, x-beta proxies, KOL Radar (kol).
 * Dispatches via ?fn= query parameter.
 */
import socialProxy from './_lib/handlers/social-proxy.js'
import kol from './_lib/handlers/kol.js'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

// 2026-05-12 post-lockdown demo amendment: x-bubbles (the X-mentions
// bubble/leaderboard widget on the spectreai.io demo Welcome page) is
// reachable anonymously with a tighter rate limit. Costs us X
// scraping quota; the rate limit caps daily exposure. Everything else
// (X-Dash drilldowns, individual KOL feeds, etc.) stays gated.
const DEMO_SAFE_FNS = new Set(['x-bubbles'])

// KOL Radar read surface is publicly readable like xdash bootstrap — the DB
// grid, the new-follow feed (scope=all), the convergence signals (scope=all)
// and per-KOL dossiers are non-sensitive aggregate data. The handler itself
// enforces Privy JWT on `alerts` and on the `mine` scope of feed/signals.
// `sync` is the snapshot refresh (idempotent, also driven by the Vercel cron,
// which carries no gate cookie or Privy token), so it stays open too.
// A per-IP rate limit still caps abuse on the kol fn.
export default async function handler(req, res) {
  const fn = req.query?.fn

  // KOL Radar: public-read, self-authing for private routes (alerts / mine).
  if (fn === 'kol') {
    if (await rateLimit(req, res, { bucket: 'kol-min', max: 120, windowMs: 60_000 })) return
    if (await rateLimit(req, res, { bucket: 'kol-hour', max: 2000, windowMs: 3_600_000 })) return
    return kol(req, res)
  }

  // Wave 5h (SEC-20260516-API-FARM-001): tiered gate. X-scraping is the
  // single most expensive upstream we proxy (~$5-20/day at sustained
  // abuse), so caps are conservative.
  const userId = await verifyPrivyToken(req)
  if (userId) {
    if (await userRateLimit(res, { bucket: 'social-xdash', userId, max: 60, windowMs: 60_000 })) return
  } else if (isAuthGateValid(req)) {
    if (await rateLimit(req, res, { bucket: 'social-xdash-gate', max: 30, windowMs: 60_000 })) return
  } else if (DEMO_SAFE_FNS.has(fn)) {
    if (await rateLimit(req, res, { bucket: 'social-api-anon', max: 20, windowMs: 60_000 })) return
  } else {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  // DEMO_SAFE_FNS are declared anonymous-safe, so they keep the edge cache.
  if (!DEMO_SAFE_FNS.has(fn)) sealGatedResponse(res)
  return socialProxy(req, res)
}
