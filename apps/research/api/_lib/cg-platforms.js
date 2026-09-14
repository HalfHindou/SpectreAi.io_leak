// CoinGecko platform slug → Codex network id — THE canonical map.
//
// WHY THIS FILE EXISTS (2026-08-25, the "M"/HYPE chartless class): this map
// used to live as FIVE divergent inline copies (spectreMarketApi, the RZ
// enrichment, extended-proxy, the Express resolve route, LITE) and every copy
// was missing chains the app actually lists — so any token whose only CG
// platform was an unmapped chain (Hyperliquid/HyperEVM, Sui, Sonic, …)
// resolved to an ADDRESS-LESS identity and lost BOTH the Candles and the
// self-hosted TradingView chart. One map, imported everywhere, means a new
// chain is added ONCE and every resolve path picks it up.
//
// KEEP IN SYNC with the client twin: apps/research/src/lib/cg-platforms.js
// (two runtimes, same content — a drift here re-opens the chartless class).
// Enforced by `node scripts/check-bars-parity.mjs` (also run by
// scripts/pre-deploy-check.sh): it imports both copies and compares the
// exported map + function source, so only the headers may differ.
//
// Order = chart-stack preference for multi-platform tokens (deepest
// ecosystems first — the tiers behind the address are keyed by it). Network
// ids are Codex ids: EVM chains use the chain id verbatim; the non-EVM /
// special ids (solana 1399811149, sui 101, hyperevm 999, robinhood 4663)
// were read off Codex getNetworks (charts-system §I3). GT coverage for the
// same ids lives in geckoterminal-bars.js GT_NETWORK_MAP.
export const CG_PLATFORM_TO_NETWORK_ID = [
  ['ethereum', 1],
  ['solana', 1399811149],
  ['base', 8453],
  ['binance-smart-chain', 56],
  ['bsc', 56],
  ['arbitrum-one', 42161],
  ['arbitrum', 42161],
  ['polygon-pos', 137],
  ['polygon', 137],
  ['avalanche', 43114],
  ['optimistic-ethereum', 10],
  ['optimism', 10],
  // hyperliquid is CG's slug for the Hyperliquid chain (HyperEVM/HyperCore
  // token ids — 32-hex, not 40); Codex network 999, GT slug 'hyperevm'.
  ['hyperliquid', 999],
  ['hyperevm', 999],
  ['sui', 101],
  ['robinhood', 4663],
  ['sonic', 146],
  ['fantom', 250],
  ['cronos', 25],
  ['linea', 59144],
  ['blast', 81457],
  ['scroll', 534352],
  ['mantle', 5000],
  ['xdai', 100],
]

// CG coin profile (or anything carrying a CG-shaped `platforms` map) →
// { address, networkId } for the first mapped platform, or null. The verified
// CG platform record is the contract AUTHORITY for CG-listed tokens — never
// a ticker-keyed search guess (the clone class).
export function contractFromPlatforms(profile) {
  const platforms = profile?.platforms
  if (!platforms || typeof platforms !== 'object') return null
  for (const [slug, networkId] of CG_PLATFORM_TO_NETWORK_ID) {
    const addr = platforms[slug]
    if (typeof addr === 'string' && addr.trim()) {
      return { address: addr.trim(), networkId }
    }
  }
  return null
}
