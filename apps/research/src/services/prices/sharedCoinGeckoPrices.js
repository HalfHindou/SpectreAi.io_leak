/**
 * Shared CoinGecko price store.
 *
 * Was previously three independent useCuratedTokenPrices instances on the
 * welcome page alone (use-market-prices for TOP_COINS, token-ticker for its
 * curated list, ai-market-analysis-page on its own page). Each ran a 60s
 * setInterval with overlapping symbol sets. This consolidates them into
 * one store backed by a single fetch per tick.
 *
 * Persists to the same localStorage key the old hook used, so existing
 * users keep their instant-paint cache across the migration.
 */
import { createPollingStore } from '@/lib/createPollingStore'
import { getMajorTokenPrices } from '@/services/coinGeckoApi'
import { USE_SPECTRE_API, getTokenPricesBatch as spectreGetPricesBatch } from '@/services/spectreDataApi'
import { PRICE_CACHE_KEY } from '@/hooks/codex/_shared'

async function fetchCoinGeckoPrices(symbols) {
  let raw = null
  if (USE_SPECTRE_API) {
    try { raw = await spectreGetPricesBatch(symbols) } catch (_) { /* fall through */ }
  }
  if (!raw || Object.keys(raw).length === 0) {
    raw = await getMajorTokenPrices(symbols)
  }
  return raw || {}
}

export const coinGeckoPricesStore = createPollingStore({
  name: 'coingecko-prices',
  fetch: fetchCoinGeckoPrices,
  // CG payload already carries the full shape callers expect (sparkline_7d,
  // market cap, 24h volume, 7d/30d/1y change). No reshape needed.
  normalize: (data) => data,
  diffKey: (r) => `${r.price}|${r.change}|${r.marketCap ?? 0}`,
  defaultInterval: 60_000,
  storageKey: PRICE_CACHE_KEY,
  storageTTL: 5 * 60 * 1000,
  // Prices move - cap the stale-instant-paint window tighter than the store
  // default (60min). A 30-min-old snapshot paints the hero for the ~1-2s the
  // revalidating fetch needs; anything older shimmers instead of lying.
  staleServeMax: 30 * 60 * 1000,
})
