/**
 * Vercel Cron Job - Cache Warmer
 * Runs every 10 minutes to pre-warm frequently-accessed endpoints.
 * Reduces cold-start latency for frequently-called functions
 * by keeping their edge caches populated.
 *
 * L4-PR6 (2026-06-03): cadence slowed from 5min -> 10min. The two endpoints
 * warmed (binance-ticker s-maxage=10, fear-greed s-maxage=300) both have
 * long enough TTLs that 5min was overkill - by minute 5 the binance edge
 * cache had already been cold for ~4.5min anyway. 10min keeps user-perceived
 * latency unchanged while halving the function invocations and outbound
 * fetches. Zero Codex impact (both endpoints are non-Codex).
 *
 * Schedule: every 10 minutes (configured in vercel.json)
 */

import { timingSafeEqual } from 'node:crypto'
import { rateLimit } from '../_lib/ratelimit.js'

// 2026-05-11 lockdown: cg-proxy + news-api are now gated by the auth cookie.
// The cron warmer has no cookie (it's an unauthenticated internal HTTP call),
// so we skip those endpoints — they warm naturally on the first logged-in
// hit. We still warm binance-ticker + fear-greed because they're public.
const ENDPOINTS = [
  '/api/binance-ticker',
  '/api/market-api?fn=fear-greed&path=current',
  // RWA tokenized-assets bundle. Prod has no in-process warmer (that's dev's
  // rwaWarmer), so without this the serverless function re-assembles the cold
  // 8MB-DeFiLlama + Spectre-origin bundle whenever the edge cache lapses — the
  // ~10s shimmer users see on the tokenized-assets page. Touching both tiers
  // here keeps the CDN edge (s-maxage=300, SWR=900) permanently warm. Public
  // (no auth cookie needed), so the cron fetch warms them cleanly.
  '/api/rwa/bundle?tier=core',
  '/api/rwa/bundle?tier=history&range=2y',
  // Spectre Brain daily analyses (2026-08-14). Each is a KV read (~50ms) when
  // fresh; at most one topic per run pays a Gemini generation (~5-10s) when
  // its 23h edition expires — so the first user of the day never stares at
  // the "Analyzing live signal" shimmer. rwa-analysis accepts the cron UA.
  '/api/rwa/analysis/overview',
  '/api/rwa/analysis/stablecoins',
  '/api/rwa/analysis/treasuries',
  '/api/rwa/analysis/credit',
  '/api/rwa/analysis/commodities',
  '/api/rwa/analysis/networks',
  '/api/rwa/analysis/platforms',
];

export default async function handler(req, res) {
  // SEC-20260518-002: defense-in-depth IP cap. A correct CRON_SECRET still
  // makes this endpoint a 1× amplifier; bound replay attempts per IP.
  if (await rateLimit(req, res, { bucket: 'cron-warm-cache', max: 10, windowMs: 60_000 })) return

  // 2026-05-12 lockdown: the previous comment ("Vercel automatically
  // secures cron endpoints") was wrong. /api/cron/* is publicly
  // addressable unless we explicitly verify either:
  //   (a) Authorization: Bearer ${CRON_SECRET}, OR
  //   (b) x-vercel-cron header (set by Vercel on real cron invocations)
  // Without this check, anyone could hit /api/cron/warm-cache and
  // trigger 2 outbound fetches per call — a 1× amplification primitive
  // useful in DoS chains. Now we accept either the configured secret
  // OR the Vercel-set header.
  //
  // SEC-20260518-002: use timingSafeEqual instead of `===`. With the old
  // string comparison, secret length and prefix could leak via response
  // timing differences — letting an attacker recover the secret one byte
  // at a time over many requests.
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
    // 2026-07-02: prod runtime logs showed EVERY Vercel cron invocation
    // 401ing - Vercel does not send x-vercel-cron on this project and no
    // CRON_SECRET env is set, so neither branch ever matched and the cache
    // warmers/snapshots have been dead (cold caches, slow loads app-wide).
    // Vercel's documented cron signature is the user-agent; accept it. This
    // is the same trust level as the x-vercel-cron header (both spoofable -
    // verified externally), so no new exposure: the rate limit above and the
    // idempotent read-only work remain the actual defense. Setting a real
    // CRON_SECRET in the Vercel project env stays the preferred hardening.
    || String(req.headers['user-agent'] || '').startsWith('vercel-cron/')
  const auth = req.headers.authorization || ''
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  let hasValidSecret = false
  if (expectedAuth) {
    const a = Buffer.from(auth || '')
    const b = Buffer.from(expectedAuth)
    // timingSafeEqual throws on unequal-length inputs — short-circuit first.
    if (a.length === b.length && timingSafeEqual(a, b)) {
      hasValidSecret = true
    }
  }
  if (!isVercelCron && !hasValidSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const baseUrl = `https://${req.headers.host}`;
  // RWA warm fetches must BYPASS Cloudflare. app.spectreai.io is CF-proxied and
  // challenges non-browser server-to-server requests (the cron's loopback gets a
  // 403), so warming the bundle via the custom domain never populates KV. Hit the
  // Vercel origin alias directly instead so the bundle handler runs and writes KV
  // (env-overridable if the alias changes or gains deployment protection). The
  // binance/fear-greed endpoints below are CDN-cache warmers, so they stay on the
  // request host (they WANT to populate the edge CF/Vercel sees).
  const rwaOrigin = process.env.RWA_WARM_ORIGIN || 'https://spectre-app-research.vercel.app';
  const results = [];

  // Fire all warming requests in parallel
  const promises = ENDPOINTS.map(async (endpoint) => {
    const base = endpoint.startsWith('/api/rwa/') ? rwaOrigin : baseUrl;
    const url = `${base}${endpoint}`;
    const start = Date.now();
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Vercel-Cron-Warmer' },
        signal: AbortSignal.timeout(15000),
      });
      results.push({
        endpoint,
        status: response.status,
        ms: Date.now() - start,
      });
    } catch (err) {
      results.push({
        endpoint,
        status: 'error',
        error: err.message,
        ms: Date.now() - start,
      });
    }
  });

  await Promise.all(promises);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    warmed: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
