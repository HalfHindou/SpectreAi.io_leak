/**
 * CEX venue map — which exchange pair a CoinGecko-listed coin actually trades
 * as, keyed by cgId (never by ticker: a ticker is not an identity).
 *
 * Consulted ONLY when token-registry could not resolve a Binance pair.
 * See .claude/rules/cex-venue-map-plan.md for the measurements behind the
 * allowlist and the trap list.
 */
import { getJsonWithTTL, setJsonWithTTL } from './kv.js';

// CoinGecko exchange ids are LEGACY. `okx`, `coinbase`, `mexc` are not valid
// ids and return silently nothing — always use the left-hand values here.
export const CEX_VENUE_BY_CG_ID = {
  binance: 'binance',
  bybit_spot: 'bybit',
  okex: 'okx',
};

export const CEX_EXCHANGE_IDS = Object.keys(CEX_VENUE_BY_CG_ID).join(',');

// USD-quoted only. Allowing KRW/EUR adds exactly 1 token across the top 500
// and would drag FX conversion into candle prices.
export const CEX_QUOTES = new Set(['USDT', 'USD', 'USDC']);

// A CEX ticker row carries a SYMBOL in `base`; DEX rows can carry a contract.
// The venue allowlist should already exclude those, but this is the cheap
// second lock (spec §J).
const TICKER_SHAPE = /^[A-Z0-9]{1,20}$/;

/**
 * Choose the price-forming venue from a CoinGecko `/tickers` payload's rows.
 * Highest 24h USD volume wins — the same "deepest venue" principle already
 * used for the Codex pool pin.
 *
 * @param {Array} tickers  payload.tickers from /coins/{id}/tickers
 * @returns {{venue: string, base: string, target: string, volUsd: number}|null}
 */
export function pickCexVenue(tickers) {
  if (!Array.isArray(tickers)) return null;
  let best = null;
  for (const t of tickers) {
    const venue = CEX_VENUE_BY_CG_ID[t?.market?.identifier];
    if (!venue) continue;
    if (!CEX_QUOTES.has(t?.target)) continue;
    if (t?.is_stale || t?.is_anomaly) continue;
    const base = typeof t?.base === 'string' ? t.base.toUpperCase() : '';
    if (!TICKER_SHAPE.test(base)) continue;
    const volUsd = Number(t?.converted_volume?.usd) || 0;
    if (!best || volUsd > best.volUsd) best = { venue, base, target: t.target, volUsd };
  }
  return best;
}

// Long ON PURPOSE. This is stickiness, not thrift: the top-volume venue for a
// coin genuinely changes between days (ASTER: Binance on 2026-08-26, KuCoin on
// 2026-08-27). Re-picking per request would reintroduce exactly the
// per-request nondeterminism this lane exists to remove.
export const VENUE_TTL_SEC = 7 * 24 * 3600;
export const NEGATIVE_TTL_SEC = 24 * 3600;
export const RESOLVE_TIMEOUT_MS = 1200;

export const venueCacheKey = (cgId) => `bars:cexvenue:v1:${cgId}`;

/* A FAILED lookup still must not be free to repeat.
   The KV negative above is only ever written for "CoinGecko answered and knows
   no CEX pair" — a transport error, a timeout or a 429 is deliberately NOT
   cached there, because it is not evidence about the coin. But this resolve
   sits on the synchronous path of every /api/bars request for a token without
   a registry Binance pair, so an uncached failure means a fresh 1.2s-timeout
   CoinGecko call per chart request for as long as CG is unhappy — exactly when
   it can least afford them. A short in-memory backoff (per lambda instance, no
   KV) bounds that to one attempt a minute without ever pinning a wrong answer:
   the next minute retries from scratch. */
export const FAILURE_BACKOFF_MS = 60_000;
const _failedAt = new Map(); // cgId -> ts of the last transport/HTTP failure
const FAILURE_MEMO_MAX = 500;   // bounded: a long outage must not grow forever
function _noteFailure(cgId) {
  if (_failedAt.size >= FAILURE_MEMO_MAX) _failedAt.delete(_failedAt.keys().next().value);
  _failedAt.set(cgId, Date.now());
}

/**
 * Resolve the CEX venue for a cgId. KV-cached; a MISS costs one CoinGecko call
 * (measured 358-442 ms scoped to three venues).
 *
 * `deps` exists for tests only — production passes nothing.
 */
export async function resolveCexVenue(cgId, deps = {}) {
  if (!cgId) return null;
  const kvGet = deps.kvGet || getJsonWithTTL;
  const kvSet = deps.kvSet || setJsonWithTTL;
  const fetchFn = deps.fetchFn || fetch;
  const key = venueCacheKey(cgId);

  // A cached MISS is `{ v: null }`; absence of the key is a different thing.
  try {
    const hit = await kvGet(key);
    if (hit && typeof hit === 'object' && 'v' in hit) return hit.v;
  } catch { /* best-effort */ }

  const failedTs = _failedAt.get(cgId);
  if (failedTs && Date.now() - failedTs < FAILURE_BACKOFF_MS) return null;

  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) return null;

  const url = `https://pro-api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}`
    + `/tickers?exchange_ids=${CEX_EXCHANGE_IDS}&depth=false`;

  let payload;
  try {
    const r = await fetchFn(url, {
      // Cloudflare answers `error code: 1010` to a request with no UA, which
      // reads exactly like a 403 plan restriction. Always send one.
      headers: { 'x-cg-pro-api-key': apiKey, 'User-Agent': 'spectre-bars' },
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    // NOT cached in KV: a transport failure or a 429 is not evidence that the
    // coin has no CEX pair. Caching it would blank a working token for 24h.
    // The in-memory backoff above is a different thing — it only stops us
    // re-asking a sick upstream once a second on the chart hot path.
    if (!r.ok) { _noteFailure(cgId); return null; }
    payload = await r.json();
  } catch {
    _noteFailure(cgId);
    return null;
  }

  _failedAt.delete(cgId);
  const picked = pickCexVenue(payload?.tickers);
  try {
    await kvSet(key, { v: picked }, picked ? VENUE_TTL_SEC : NEGATIVE_TTL_SEC);
  } catch { /* best-effort */ }
  return picked;
}
