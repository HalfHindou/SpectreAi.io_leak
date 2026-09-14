/**
 * Shared Binance price store.
 *
 * One store instance for every consumer of real-time Binance prices on the
 * research app. Replaces the per-hook setInterval pattern: subscribers
 * (useBinanceTopCoinPrices + useWatchlistPrices realtime feed + traders-corner
 * widgets) share one timer and one fetch with the union of their symbols.
 *
 * Tries Spectre Data API first (free, our infra) and falls back to the
 * Binance ticker proxy if Spectre returns empty.
 */
import { createPollingStore } from '@/lib/createPollingStore'
import { getTopCoinPrices, isSpectreRowStale } from '@/services/binanceApi'
import { USE_SPECTRE_API, getTokenPricesBatch as spectreGetPricesBatch } from '@/services/spectreDataApi'

async function fetchBinancePrices(symbols) {
  let raw = null
  if (USE_SPECTRE_API) {
    try { raw = await spectreGetPricesBatch(symbols) } catch (_) { /* fall through */ }
  }
  if (!raw || Object.keys(raw).length === 0) {
    return (await getTopCoinPrices(symbols)) || {}
  }
  // Ingester-stall guard (data-lane #7, recurred 2026-07-10): a stalled
  // Hetzner /v1/prices keeps returning rows - just frozen ones - so the
  // empty-map fallback above never fires and this store served hours-old
  // prices at realtime cadence (stale BTC/SPECTRE watchlist report).
  // Re-source live price/change for known-stale rows via getTopCoinPrices
  // (its CG+Binance leg), keeping the Spectre row's enrichment (image/name/
  // mcap). Rows with no live source left are flagged `stale: true` so
  // consumers can prefer their own fresher path (e.g. Codex by contract).
  const staleSyms = Object.keys(raw).filter((sym) => isSpectreRowStale(raw[sym]))
  if (staleSyms.length > 0) {
    let live = {}
    try { live = (await getTopCoinPrices(staleSyms)) || {} } catch (_) { /* stale beats nothing */ }
    for (const sym of staleSyms) {
      const l = live[sym]
      // getTopCoinPrices flags rows it could NOT re-source live (no Binance
      // pair, no CG mapping) - those keep the frozen price, so `price > 0`
      // alone can't distinguish live from frozen.
      if (l?.price > 0 && !l.stale) {
        raw[sym] = { ...raw[sym], price: l.price, change: l.change, change24: l.change }
      } else {
        raw[sym] = { ...raw[sym], stale: true }
      }
    }
  }
  return raw
}

function normalizeBinanceRow(data) {
  return {
    price: data.price,
    change: data.change ?? data.change24 ?? 0,
    change24: data.change ?? data.change24 ?? 0,
    change1h: data.change1h ?? 0,
    change7d: data.change7d ?? 0,
    change30d: data.change30d ?? 0,
    change1y: data.change1y ?? 0,
    volume: data.volume ?? 0,
    marketCap: data.marketCap ?? 0,
    liquidity: data.liquidity ?? data.volume ?? 0,
    // 2026-06-03 watchlist audit: preserve image + name so the watchlist row's
    // fallback chain can pick them up from the realtime store (Hetzner price
    // payload includes both). Pre-fix, PALM/NEURAL/etc rendered the letter
    // fallback because liveData's heavy fetchWatchlistData path didn't always
    // populate them in time, and the realtime store stripped them out.
    image: data.image || data.logo || null,
    name: data.name || null,
    // Ingester-stall flag: true when the Spectre row is frozen (updated_at
    // >5min old) AND no live CG/Binance source could re-price it. Consumers
    // (useWatchlistPrices) skip stale realtime rows so their own enriched
    // path (Codex by contract) wins instead.
    stale: data.stale === true,
  }
}

export const binancePricesStore = createPollingStore({
  name: 'binance-prices',
  fetch: fetchBinancePrices,
  normalize: normalizeBinanceRow,
  // Binance is the realtime feed — price/change drive every re-render decision
  // downstream, marketCap is rarely populated on Binance side so skip from diff.
  diffKey: (r) => `${r.price}|${r.change}`,
  defaultInterval: 10000,
})
