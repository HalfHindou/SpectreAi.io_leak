# Mobile Info view - DexScreener-style redesign (design)

**Date:** 2026-07-17
**Requested by:** Evgeniy ("Info needs redoing. Too much text no one reads. Traders want prices and volumes and bars. Redo info like dexscreener.")
**Surface:** trading app `MobileInfoBody` (the Info view of `MobileTokenPage`).

## Problem

The current Info view leads with an AI dossier + a long About paragraph. Traders skip text;
they want the DexScreener panel: prices, liquidity/FDV/mcap cards, and per-timeframe
TXNS / VOLUME / MAKERS with green/red buy-sell split bars.

## New layout (top to bottom, data only)

1. **Links row** - DexScreener-style buttons: Website / X / Telegram + copy-CA chip.
   Identity + live price stay in the pinned `MobilePriceHero` above (no duplication).
2. **Price cards** - `PRICE USD` | `PRICE <NATIVE>` (SOL/ETH/BNB..., token price divided
   by the chain's native token USD price).
3. **Three cards** - `LIQUIDITY` | `FDV` | `MARKET CAP`.
4. **Timeframe tabs** - `5M / 1H / 4H / 24H`, each shows its % change
   (Codex windows: min5/hour1/hour4/day1 - no 6H, matches the hero chips).
   The selected tab drives the stats block.
5. **Stats block** - three rows, split bars like DexScreener:
   - `TXNS` - buys vs sells
   - `VOLUME` - buy vol vs sell vol
   - `MAKERS` - buyers vs sellers
6. **Kept below (compact, data-only):** supply bar + age + ATH, Safety grid
   (honeypot / tax / mint+freeze / LP / top-10), Holders count + 14d sparkline.
7. **Removed:** About paragraph, AI dossier (`HeaderDossier`), the duplicated big price
   line, the old Key Metrics grid (numbers absorbed by the cards above).

No banner image (project-uploaded asset we don't have).

## v2 additions (same day)

- **Pair strip** at the top of Info: `TOKEN / QUOTE` + `Chain › DEX` breadcrumb with
  chain + exchange icons (real quote token + venue, DexScreener's header line).
- **Pair Info section** (after the meta strip): Pair created (age), Pooled TOKEN /
  Pooled QUOTE (amounts + USD - each side priced directly: token side by live price,
  quote side by the quote coin's USD price, wrapped natives mapped, stables = $1),
  Pair address + Token address rows with copy + EXP explorer links (CHAINS map
  exported from MobilePriceHero; pair links swap /token/ for /address/ / /account/).
- New Codex proxy action **`pair-info`** (`listPairsWithMetadataForToken` limit 1 =
  top-liquidity pair): exchange name/icon/tradeUrl, quote token, pooled amounts,
  createdAt, pair address. Prod serverless + dev Express parity, 5-min caches.
- The meta strip's Age row hides once pair-info lands (replaced by "Pair created").

## Data

- New Codex proxy action **`token-stats`**: `getDetailedTokenStats(tokenAddress, networkId,
  durations: [min5, hour1, hour4, day1])` -> per window: transactions, buys/sells,
  buyVolume/sellVolume (USD), buyers/sellers/traders. Token-level (all pairs aggregated),
  so no dependency on `topPairAddress`. Added to BOTH `apps/trading/api/codex.js`
  (prod serverless, KV-cached ~30-60s) and the dev Express twin (CLAUDE.md rule 5 parity).
- % change per window: already on token details (`change5m/change1/change4/change24`).
- Native quote price: token `priceUsd / nativeUsd` where nativeUsd comes from the existing
  prices endpoint for the chain's native symbol (cached).
- Everything else (liquidity, fdv, mcap, supply, safety, holders) - already loaded;
  no refetching.

## Failure states

- token-stats error/empty -> hide the stats block (no fake zeros).
- Native price unavailable -> show only the USD price card.
- Shimmer skeletons while pair-stats loads (never spinners).

## Out of scope

Watchlist/Alerts buttons (hero heart + Buy/Sell dock own those), banner images,
desktop RightPanel changes.
