/**
 * Vercel Serverless – Data & derivatives router.
 * Consolidates: derivatives-proxy, coinglass, dexscreener, extended-proxy
 * Dispatches via ?fn= query parameter.
 * Keeps function count low to minimize Vercel builder costs.
 */
import derivativesProxy from './_lib/handlers/derivatives-proxy.js'
import dexscreenerProxy from './_lib/handlers/dexscreener-proxy.js'
import extendedProxy from './_lib/handlers/extended-proxy.js'
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const handlers = {
  'derivatives-proxy': derivativesProxy,
  'dexscreener-proxy': dexscreenerProxy,
  'extended-proxy': extendedProxy,
}

// 2026-05-12 post-lockdown demo amendment: a narrow allowlist of
// (fn, route) combinations is reachable anonymously (rate-limited)
// so the spectreai.io showcase iframe can render real prices + news
// + intelligence-feed on the demo Welcome page. Coinglass +
// DexScreener proxies stay gated — those route through derivatives-
// and dexscreener-proxy which are NOT on this list.
//
// extended-proxy → v1-proxy forwards to api.spectreai.io (our own
// data backend) for /data-api/v1/* endpoints — prices, news, etc.
// Public-grade data from our own infra; rate-limit caps the cost.
const DEMO_SAFE_ROUTES = {
  // token-resolve added 2026-06-10: symbol → {cgId, address, networkId}
  // identity from our own backend. Public-grade data; without it anonymous
  // sessions never get token addresses and every DEX-token chart degrades
  // to the plain-symbol bars path. Same anon rate-limit bucket applies.
  // token-markets added 2026-07-02: CG tickers (public on coingecko.com,
  // same post-lockdown rationale as cg-proxy) — it's the token page's
  // default-tab data; gating it just forced anon sessions onto slower
  // client-side fallbacks. Anon rate-limit bucket still applies.
  'extended-proxy': new Set(['v1-proxy', 'token-resolve', 'token-markets']),
}

// Sub-scoped anonymous allowances — narrower than a whole route family.
// rwa/bundle added 2026-08-14: the warm-cache cron fetches it with no cookie
// and had been 401ing since the rwa warm entries shipped, so the KV pre-warm
// the bundle handler's design depends on NEVER ran — every cold region paid
// the full 8MB-DeFiLlama assembly live (the "tokenized-assets loads slow"
// report). Bundle is aggregate public-market data; the anon 30/min bucket
// still applies, and only `sub=bundle` opens — signals/protocols/etc stay
// gated.
const DEMO_SAFE_SUBS = {
  'extended-proxy': { rwa: new Set(['bundle']) },
}

function isDemoSafe(req) {
  const fn = req.query?.fn
  const route = req.query?.route
  if (!fn) return false
  const allowed = DEMO_SAFE_ROUTES[fn]
  if (allowed && allowed.has(route)) return true
  const subAllowed = DEMO_SAFE_SUBS[fn]?.[route]
  return Boolean(subAllowed && subAllowed.has(String(req.query?.sub || '')))
}

// Wave 5h (SEC-20260516-API-FARM-001): per-fn caps. derivatives-proxy gets
// polled live (~every 5s on Traders Corner). Others polled less often.
const FN_LIMITS = {
  'derivatives-proxy': { user: 120, gate: 60 },
  'dexscreener-proxy': { user: 60,  gate: 30 },
  // extended-proxy 60/30 -> 120/120 (2026-06-10 RZ war): ONE research-zone
  // token view costs 5-8 hits on this shared bucket (bootstrap + resolve +
  // search + token-markets + binance-klines + signals), and hover-prewarm +
  // HTML-parse early-fetch add more. At gate:30, three token views plus some
  // hovering inside a minute 429'd EVERY panel at once. The gate cookie
  // already proves team membership; the anon/demo buckets above remain the
  // actual abuse guard.
  'extended-proxy':    { user: 120, gate: 120 },
}

export default async function handler(req, res) {
  const fn = req.query.fn
  const userId = await verifyPrivyToken(req)
  const authed = userId || isAuthGateValid(req)
  if (!authed) {
    if (!isDemoSafe(req)) {
      return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
    }
    // Tighter anonymous bucket so abuse can't drain Sunny's data-api quota.
    if (await rateLimit(req, res, { bucket: 'data-api-anon', max: 30, windowMs: 60_000 })) return
  } else {
    // The gate runs HERE, inside the function, while the handlers below set
    // `public, s-maxage=…` so the CDN can skip a cold boot. Composed, those two
    // let a warm edge entry serve a gated payload to a caller who never reached
    // this line — measured on /api/private/* 2026-08-25. Seal the response
    // unless the route is one we have declared anonymous-safe, in which case
    // there is nothing to bypass. See _lib/gate-cache.js.
    if (!isDemoSafe(req)) sealGatedResponse(res)

    // Tiered per-fn cap on top of the gate decision.
    const limits = FN_LIMITS[fn] || { user: 60, gate: 30 }
    if (userId) {
      if (await userRateLimit(res, { bucket: `data-${fn}`, userId, max: limits.user, windowMs: 60_000 })) return
    } else {
      if (await rateLimit(req, res, { bucket: `data-${fn}-gate`, max: limits.gate, windowMs: 60_000 })) return
    }
  }
  const h = handlers[fn]
  if (!h) return res.status(400).json({ error: `Unknown data-api function: ${fn}` })
  return h(req, res)
}
