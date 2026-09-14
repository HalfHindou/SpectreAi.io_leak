/**
 * YOU V2 — Live market context for the composer.
 *
 * Pulls a small, fixed window of state from the Spectre API at request time
 * so the agent can make market-aware widget choices instead of generic ones.
 *
 *   - /v1/market/global   total mcap, dominance, 24h change, F&G when present
 *   - /v1/trending        top movers (limit 10)
 *
 * Both calls run in parallel with a 4s timeout. Failures are silent — the
 * composer falls back to its base profile-driven prompt without market
 * context. Tracking must never block on an external dependency.
 *
 * Cached in-process for 60s to absorb rapid-fire composer calls (typing,
 * follow-ups). The cache is keyed only on the endpoint, not on user, so
 * it's safe to share across requests.
 */

const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'https://api.spectreai.io').replace(/\/$/, '');
const SPECTRE_API_KEY = process.env.SPECTRE_API_KEY || '';

const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

const cache = new Map(); // key -> { ts, value }

async function fetchJson(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  if (!SPECTRE_API_KEY) return null;

  try {
    const res = await fetch(`${SPECTRE_API_BASE}${path}`, {
      headers: { 'X-API-Key': SPECTRE_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    cache.set(path, { ts: Date.now(), value: json });
    return json;
  } catch {
    return null;
  }
}

/**
 * Returns a compact, prompt-friendly summary of current market state.
 * Shape:
 *   {
 *     ts: ISO string,
 *     global: { total_mcap_usd, btc_dominance_pct, change_24h_pct } | null,
 *     trending: [{ asset, change_24h_pct, volume_spike }, ...]  // up to 5
 *   }
 *
 * Returns null when the Spectre API is unreachable or unconfigured. The
 * composer treats null as "no market context available" without erroring.
 */
async function getMarketContext() {
  const [globalRes, trendingRes] = await Promise.allSettled([
    fetchJson('/v1/market/global'),
    fetchJson('/v1/trending?limit=10'),
  ]);

  const globalRaw = globalRes.status === 'fulfilled' ? globalRes.value : null;
  const trendingRaw = trendingRes.status === 'fulfilled' ? trendingRes.value : null;

  if (!globalRaw && !trendingRaw) return null;

  const g = globalRaw?.data || globalRaw || null;

  const global = g ? {
    total_mcap_usd: g.total_market_cap_usd ?? g.total_mcap ?? null,
    btc_dominance_pct: g.btc_dominance ?? g.btc_dominance_pct ?? null,
    change_24h_pct: g.market_cap_change_24h ?? g.change_24h ?? null,
    fear_greed: g.fear_greed ?? null,
  } : null;

  const trendList = Array.isArray(trendingRaw?.data) ? trendingRaw.data : [];
  const trending = trendList.slice(0, 5).map((t) => ({
    asset: t.asset || t.symbol || null,
    change_24h_pct: t.change_24h ?? null,
    volume_spike: t.volume_spike ?? null,
  })).filter((t) => t.asset);

  if (!global && trending.length === 0) return null;

  return {
    ts: new Date().toISOString(),
    global,
    trending,
  };
}

module.exports = { getMarketContext };
