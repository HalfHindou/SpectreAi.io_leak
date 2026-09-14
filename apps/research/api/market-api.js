/**
 * Vercel Serverless – Market data router.
 * Consolidates: fear-greed, heatmap, sector-lines, market-intel, search-api, polymarket
 * Dispatches via ?fn= query parameter.
 */
import fearGreed from './_lib/handlers/fear-greed.js'
import heatmap from './_lib/handlers/heatmap.js'
import sectorLines from './_lib/handlers/sector-lines.js'
import sectorSnapshot from './_lib/handlers/sector-snapshot.js'
import marketIntel from './_lib/handlers/market-intel.js'
import searchApi from './_lib/handlers/search-api.js'
import polymarket from './_lib/handlers/polymarket.js'
import kalshi from './_lib/handlers/kalshi.js'
import chartsProxy from './_lib/handlers/charts-proxy.js'
import brain from './_lib/handlers/brain.js'
import seasonality from './_lib/handlers/seasonality.js'
import crossasset from './_lib/handlers/crossasset.js'
import equityOptions from './_lib/handlers/equity-options.js'
import tokenFlow from './_lib/handlers/token-flow.js'
import { isAuthGateValid, isDemoSession } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { sealGatedResponse } from './_lib/gate-cache.js'

const handlers = {
  'fear-greed': fearGreed,
  'heatmap': heatmap,
  'sector-lines': sectorLines,
  'sector-snapshot': sectorSnapshot,
  'market-intel': marketIntel,
  'search-api': searchApi,
  'polymarket': polymarket,
  'kalshi': kalshi,
  'charts-proxy': chartsProxy,
  'brain': brain,
  'seasonality': seasonality,
  'crossasset': crossasset,
  'equity-options': equityOptions,
  'token-flow': tokenFlow,
}

// Three-tier access (2026-05-13 SEC-20260513-017):
//
// TIER 1 - always-public (no cookie required):
//   `fear-greed` - horizontal-bar widget, also used by api/cron/warm-cache.js
//   `polymarket` - upstream is public API, gating costs nothing
//
// TIER 2 - demo-session OR full gate (read-only, cron-cached or low-cost):
//   `market-intel?route=ai-market-text` - LLM-generated, MUST read cron-
//     warmed cache in the showcase code path (no fresh Anthropic per visitor)
//   `sector-lines` - cached sector index lines
//   `heatmap` - market cap heatmap, cheap to compute
//   `seasonality` - month/year return history, KV-cached 1h, free upstreams
//   `crossasset` - cross-asset levels + correlation, KV-cached 15min, free upstreams
//   `equity-options` - CBOE delayed option chains, summarised server-side, KV 5min
//   `token-flow`     - free keyless on-chain taker flow (GeckoTerminal + DexScreener), KV 4min
//
// TIER 3 - full gate only:
//   `brain` - Groq Brain proxy, $$$
//   `search-api` - hits Spectre Data API search index
//   `charts-proxy` - derivatives heatmap with $$ per upstream call
//   `market-intel` everything except route=ai-market-text
const TIER1_PUBLIC = new Set(['fear-greed', 'polymarket', 'kalshi'])
const TIER1_PUBLIC_ROUTES = {
  // /api/market/regime serves the fear-greed Reason card. Same access tier as
  // fear-greed itself: always-public, cheap upstream proxy, server-cached 5min.
  // alt-season: CoinMarketCap Altcoin Season Index. Cheap public CMC proxy shown
  // in the always-visible quick-stats bar - same access tier as fear-greed/regime.
  'market-intel': new Set(['regime', 'alt-season']),
}
const TIER2_DEMO_OR_GATE_FN = new Set(['sector-lines', 'heatmap', 'seasonality', 'crossasset', 'equity-options', 'token-flow'])
const TIER2_DEMO_OR_GATE_ROUTES = {
  'market-intel': new Set(['ai-market-text']),
}

function tierOf(req) {
  const fn = req.query?.fn
  const route = (req.query?.route || '').toLowerCase()
  if (!fn) return 'tier3'
  if (TIER1_PUBLIC.has(fn)) return 'tier1'
  if (TIER1_PUBLIC_ROUTES[fn]?.has(route)) return 'tier1'
  if (TIER2_DEMO_OR_GATE_FN.has(fn)) return 'tier2'
  if (TIER2_DEMO_OR_GATE_ROUTES[fn]?.has(route)) return 'tier2'
  return 'tier3'
}

// Wave 5h (SEC-20260516-API-FARM-001): per-fn rate limits applied AFTER
// the auth tier resolves. Tuned by cost-per-call:
//   - search-api: 30/min user, 15/min anon  (entity resolution, heavier)
//   - others:     60/min user, 30/min anon  (live polling rate)
const FN_LIMITS = {
  'fear-greed':   { user: 60,  anon: 30 },
  'polymarket':   { user: 60,  anon: 30 },
  'kalshi':       { user: 60,  anon: 30 },
  'search-api':   { user: 30,  anon: 15 },
  'heatmap':      { user: 60,  anon: 30 },
  'sector-lines': { user: 60,  anon: 30 },
  'market-intel': { user: 60,  anon: 30 },
  'charts-proxy': { user: 60,  anon: 30 },
  'brain':        { user: 30,  anon: 15 },
  'seasonality':  { user: 60,  anon: 20 },
  'crossasset':   { user: 60,  anon: 20 },
  'equity-options': { user: 60, anon: 20 },
  'token-flow': { user: 60, anon: 20 },
}

export default async function handler(req, res) {
  const fn = req.query.fn
  const tier = tierOf(req)
  const userId = await verifyPrivyToken(req)
  const authed = userId || isAuthGateValid(req)

  // Merge resolution 2026-05-18: combined main's tier-based access (preserves
  // demo iframe via isDemoSession + tier1/tier2/tier3 from PR #404) with
  // Wave 5h's per-user Privy rate limiting. Order:
  //   1. tier3 requires a real session (Privy user OR auth-gate cookie); demo
  //      doesn't unlock tier3 (Wave 5h $$$ endpoints stay closed to demo).
  //   2. tier2 unlocks for Privy user, auth-gate cookie, OR demo-session
  //      (showcase iframe).
  //   3. tier1 is always open (rate-limited only).
  // After the gate, apply per-fn rate limit. Privy user gets their own
  // bucket (catches stolen-JWT amplification across IPs). Anon/demo gets
  // per-IP bucket.
  if (tier === 'tier3' && !authed) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }
  if (tier === 'tier2' && !authed && !isDemoSession(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  // Sealed for TIER3 only, matching data-api's rule: seal unless the payload
  // is one we have declared showable without a full session. Tier1 is open,
  // and tier2 (heatmap / seasonality / crossasset / sector-lines /
  // equity-options / token-flow) is data the demo iframe already shows the
  // public — its edge cache is worth more than the demo-cookie boundary.
  // Tier3 is the metered, private half (brain $$$) and must not sit on a
  // shared edge.
  if (tier === 'tier3') sealGatedResponse(res)

  const limits = FN_LIMITS[fn]
  if (limits) {
    if (userId) {
      if (await userRateLimit(res, { bucket: `market-${fn}`, userId, max: limits.user, windowMs: 60_000 })) return
    } else if (authed) {
      // Auth-gate cookie path.
      if (await rateLimit(req, res, { bucket: `market-${fn}-gate`, max: limits.anon, windowMs: 60_000 })) return
    } else {
      // Anon (tier1) or demo-session (tier2) path.
      const bucketSuffix = isDemoSession(req) ? 'demo' : 'anon'
      if (await rateLimit(req, res, { bucket: `market-${fn}-${bucketSuffix}`, max: limits.anon, windowMs: 60_000 })) return
    }
  }
  const h = handlers[fn]
  if (!h) return res.status(400).json({ error: `Unknown market-api function: ${fn}` })
  return h(req, res)
}
