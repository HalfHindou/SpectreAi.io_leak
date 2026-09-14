/**
 * Curated corrections for token records whose upstream data (CoinGecko) is
 * verifiably wrong. Keyed by CoinGecko id and applied as a final overlay in
 * use-research-zone-data.js, so every RZ surface (pro / lite / mobile / share
 * card) reads the corrected fact from one place.
 *
 * An entry here is a last resort: file the correction upstream too (CoinGecko's
 * update-request form) and delete the entry once the upstream record is fixed.
 */

export const CURATED_TOKEN_FACTS = {
  // Our own token. CoinGecko's record (checked 2026-08-25) is wrong twice:
  //  - description: calls the platform an "AI-powered predictive learning
  //    tool". CoinMarketCap already carries the team's real copy, used below.
  //  - ath $11.04 @ 2025-08-18T19:13Z: a phantom print. The full SPECTRE/WETH
  //    candle history (Nov 2023 -> today, own candle store + GeckoTerminal,
  //    pool 0x8a6d9525a0f07dcdc17fff15644342c314025a80) never traded above
  //    $6.08 (2024-12-12); the real high on CG's claimed ATH day was $2.90.
  'spectre-ai': {
    description:
      'Spectre AI is the intelligence layer for financial research and trading — crypto, stocks and commodities. One AI-native platform connecting research, social intelligence and execution in one click. SPECTRE is the platform’s native token on Ethereum.',
    ath: 6.08,
    athDate: '2024-12-12T00:00:00.000Z',
  },
}

export function curatedTokenFacts(cgId) {
  return (cgId && CURATED_TOKEN_FACTS[cgId]) || null
}
