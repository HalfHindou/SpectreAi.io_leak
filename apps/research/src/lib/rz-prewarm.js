/**
 * PR-5 (perf): intent prewarm for token rows/cards/search results.
 *
 * Fires the same symbol-keyed trio the Research Zone hook fetches first
 * (bootstrap composite, Binance price, CG market meta) so that by the time
 * the user's click lands, the data is already in flight or cached. All three
 * services dedup + TTL-cache internally with the SAME keys the RZ hook's
 * fetch pipeline uses, so the hook's own calls join these in-flight requests
 * - zero duplicate upstream calls. Zero Codex involvement (own bridge +
 * Binance + CoinGecko only).
 *
 * Lives in its own tiny module (NOT in use-research-zone-data.js) so entry-
 * chunk consumers like the header search can import it without dragging the
 * 1400-line RZ hook onto the boot critical path.
 */
import { getRzBootstrap } from '@/services/spectreDataApi'
import { getBinancePrices } from '@/services/binanceApi'
import { getCoinMarketDataBySymbol } from '@/services/coinGeckoApi'

export function prewarmResearchZone(symbol) {
  const upper = String(symbol || '').toUpperCase()
  if (!upper || !/^[A-Z0-9]{1,12}$/.test(upper)) return
  try {
    getRzBootstrap(upper).catch(() => {})
    getBinancePrices([upper]).catch(() => {})
    getCoinMarketDataBySymbol(upper).catch(() => {})
  } catch { /* prewarm is best-effort, never break UI */ }
}
