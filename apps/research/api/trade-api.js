/**
 * Vercel Serverless – Trading & on-chain router.
 * Consolidates: swap, tradingview-udf/symbol/search, onchain, onchain-path, project-crawl, bars
 * Dispatches via ?fn= query parameter.
 */
import swap from './_lib/handlers/swap.js'
import tradingviewUdf from './_lib/handlers/tradingview-udf.js'
import tradingviewSymbol from './_lib/handlers/tradingview-symbol.js'
import tradingviewSearch from './_lib/handlers/tradingview-search.js'
import onchain from './_lib/handlers/onchain.js'
import onchainPath from './_lib/handlers/onchain-path.js'
import projectCrawl from './_lib/handlers/project-crawl.js'
import bars from './_lib/handlers/bars.js'
import { isAuthGateValid, isDemoSession } from './auth-gate.js'
import { sealGatedResponse } from './_lib/gate-cache.js'
import { rateLimit } from './_lib/ratelimit.js'

const handlers = {
  'swap': swap,
  'tradingview-udf': tradingviewUdf,
  'tradingview-symbol': tradingviewSymbol,
  'tradingview-search': tradingviewSearch,
  'onchain': onchain,
  'onchain-path': onchainPath,
  'project-crawl': projectCrawl,
  'bars': bars,
}

// `swap` has its own Privy JWT verification per-call (auth.js). Everything
// else burns Codex bars / on-chain quotas anonymously.
const PUBLIC_FNS = new Set(['swap'])

// 2026-05-13 SEC-20260513-017: read-only on-chain reads the showcase
// iframe needs to render real trending tokens. `onchain` covers the
// Spectre Onchain Data Bridge (ETH/BSC trending + token-detail); strict
// per-IP rate-limit caps total volume. `bars` for sparkline OHLCV on the
// demo Welcome page. `project-crawl` and `tradingview-*` stay gate-only
// (SSRF surface + Codex quota cost) - those aren't needed by the iframe.
const DEMO_ALLOWED_FNS = new Set(['onchain', 'bars'])

export default async function handler(req, res) {
  const fn = req.query.fn
  const authed = isAuthGateValid(req)
  if (!PUBLIC_FNS.has(fn) && !authed) {
    const demoOk = DEMO_ALLOWED_FNS.has(fn) && isDemoSession(req)
    if (!demoOk) {
      return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
    }
    // Demo callers get a tighter per-IP cap on top of any per-handler limit.
    if (await rateLimit(req, res, { bucket: 'trade-api-demo', max: 30, windowMs: 60_000 })) return
  }

  // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
  // function, while the handlers below set `public, s-maxage=…`. Composed,
  // those two let a warm edge entry serve a gated payload to a caller who
  // never reached this line — measured on /api/private/* 2026-08-25. data-api
  // was sealed then; every other gated entrypoint was not.
  // DEMO_ALLOWED_FNS are read-only market data the showcase iframe already
  // serves to the public, and `bars` is the app's highest-volume endpoint —
  // its edge cache is load-bearing (writeBarsPayload sets CDN-Cache-Control
  // on purpose). Everything else here (project-crawl, tradingview-*) is
  // gate-only and must not sit on a shared edge.
  if (!PUBLIC_FNS.has(fn) && !DEMO_ALLOWED_FNS.has(fn)) sealGatedResponse(res)
  const h = handlers[fn]
  if (!h) return res.status(400).json({ error: `Unknown trade-api function: ${fn}` })
  return h(req, res)
}
