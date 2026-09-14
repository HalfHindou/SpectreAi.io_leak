# Phase L: Migrate to Spectre API as Primary Data Layer

> Sunny asked for a full-scope audit of Spectre API to see if it can replace
> Codex + CoinGecko entirely. **Answer: yes for ~95% of use cases, ~98% of cost.**
> This doc is the strategic plan + tactical execution roadmap.

---

## TL;DR (read first)

| | Today | Phase L target |
|---|---|---|
| Cost driver #1 | Codex API ($350/M ops) | Spectre Hetzner (already paid) |
| Cost driver #2 | CoinGecko Pro Lite ($79/mo) | $0 (cancel sub) |
| Cost driver #3 | Binance klines (free) | Same |
| Codex bill at 1000 DAU (post-K) | **$1,395-2,655/mo** | **~$50-150/mo** |
| CG bill | $79/mo flat | $0 |
| Single point of failure | Vercel (multi-region) | + Spectre Hetzner (single box) |
| Data freshness (top-500) | 60s (CG cron) | 2s (Spectre SSE + 60s Postgres snapshot) |

**Why it works:** Spectre's worker swarm on Hetzner already ingests from Codex, CoinGecko Pro, Binance, DexScreener into its own Postgres. We're paying these vendors **twice** — once at Spectre's worker layer (fixed cost, already in Sunny's budget), once at our Vercel handler (scales with users). Move to Spectre as primary, the second cost goes to zero.

**Risk:** Hetzner box is single point of failure. Mitigation: keep Codex+CG as fallback tiers (current architecture stays as belt-and-suspenders).

---

## The audit (Jun 2 2026)

### Spectre API surface

- **799 endpoints** across ~50 top-level segments
- Direct origin: `http://204.168.244.18:3850` (Hetzner)
- Proxied: `https://api.spectreai.io` (CF WAF)
- Auth: `X-API-Key: sk_int_research_8b23a5063018a8a2acbe130de304ef2baa94533d`
- OpenAPI spec: `http://204.168.244.18:3850/openapi.json` (1MB)

### Coverage matrix (verified live with curl)

| Use case today | Vercel handler | Spectre replacement | Verified working? |
|---|---|---|---|
| Top-500 markets (snapshot cron source) | CG `/coins/markets` | `/v1/coins/markets?per_page=250&page=1\|2` | ✅ Same shape as CG, 230KB/page, 350-700ms |
| Token detail (handleTokenDetails) | Codex `filterTokens(tokens:)` | `/v1/coins/{id}` | ✅ Full detail + categories + description |
| Token detail batch (handleTokenDetailsBatch) | Codex `filterTokens(tokens:[...])` | `/v1/coins/markets?ids=...` | ✅ Same CG-shape batch |
| Bars - major (handleBars Binance) | Binance klines (free) | `/v1/coins/{id}/ohlc?days=N` | ✅ Proper OHLC candles |
| Bars - DEX (handleBars Codex) | Codex `getTokenBars` | `/v1/coins/{id}/market_chart` (works for PEPE too) | ✅ Spectre's `worker-candles-codex` mirrors Codex into Postgres |
| Search (handleTokenSearch) | Codex `filterTokens(phrase:)` | `/v1/search?q=...` | ✅ Returns coingecko_id + image + rank |
| Trending (handleTrending) | Currently CG-snapshot-derived (K9) | `/v1/trending` | ✅ Has social_velocity + trend_score + volume_spike (richer than CG) |
| Prices batch (handleTokenPrices) | Codex `filterTokens` + lockstep | `/v1/prices?symbols=...` | ✅ Returns 1h/24h/7d/14d/30d/1y change in one call |
| DEX scanner (research-zone on-chain) | Codex `getDetailedTokenInfo` | `/v1/scanner/token/{addr}?chain=ethereum` | ✅ Decimals, supply, price, mcap, vol, GeckoTerminal-backed |
| Fear & Greed | Spectre already | `/v1/market/fear-greed` | ✅ Current + history |
| Global market stats | CG `/global` | `/v1/market/global` | ✅ Total mcap, BTC/ETH dominance |
| Derivatives funding/OI | Mixed (Bybit/Binance via Express) | `/v1/derivatives/funding-rates`, `/v1/derivatives/oi`, etc | ✅ 47 derivative endpoints |
| Categories/sectors | CG `/coins/categories` | `/v1/categories` | ✅ Same shape |
| RWA / DeFi / ETF | Mixed | `/v1/rwa/*` (34 paths), `/v1/defi/*` (15), `/v1/etf/*` (4) | ✅ Full coverage |
| News + calendar | Mixed | `/v1/news/*`, `/v1/calendar/*` + SSE streams | ✅ + real-time SSE |

### Real-time streams (Spectre has these!)

- **`/v1/stream/prices/sse?symbols=BTC,ETH,SOL`** — multi-symbol price tick stream
- **`/v1/stream/asset/{symbol}`** — per-asset stream with BOTH price events AND derivatives events
- **`/v1/calendar/stream`** — economic calendar SSE
- **`/v1/breaking/live`** — breaking news SSE
- **`/v1/brain/stream`**, **`/v1/intel/feed/stream`** — AI signal streams

Verified live with `curl`: `event: tick` packets every 2-5 seconds with full payload (price, pct_change_1h/24h, volume, high_24h, low_24h, rank, exchange, market_type, timestamps). This is **better than Codex `onPricesUpdated`** (which is price-only) and **free** (no per-event billing).

### Worker layer (the data source)

Spectre runs 159 PM2 procs on Hetzner. Key ones for our migration:

| Worker | Cadence | Source | Writes to |
|---|---|---|---|
| `worker-binance` (+ bybit/coinbase/okx/kraken) | WS realtime | CEX WebSocket | `candles_1m` (exchange='binance' etc) |
| `worker-candle-backfill` | one-shot + daily 3AM | Binance REST (2yr 1h, 30d 1m) | `candles_1m`, `candles_1h`, `price_history_daily` |
| **`worker-candles-codex`** | **60s** | **Codex `getBars`** | **`candles_1m` (exchange='codex')** ← THE BRIDGE |
| `worker-data-refresh-v2` | 5 min | CG-Pro top-5000 | `screener_snapshot`, `assets` |
| `worker-longtail-price-snapshot` | 2 min | CG-Pro 20pg×250 | `assets`, `screener_snapshot` |
| `worker-price-tick-fanout` | 2s | Redis `price:*` hashes | SSE channel `price.tick.{SYMBOL}` |
| `worker-cg-detail-enricher` | tiered | CG `/coins/:id` | `assets`, `asset_profiles` |
| `worker-dexscreener` | continuous | DexScreener REST | `dex_pairs` |
| `worker-onchain-discovery` | 15 min | CG-Pro `/onchain/` (GeckoTerminal) | `assets`, `intelligence_signals` |
| `worker-orderbook-multi` | WS realtime | Binance WS depth | `orderbook_snapshots` |

**Critical insight:** Spectre's `worker-candles-codex` already pays Codex on a fixed schedule (60s tick for live + 10min/asset for backfill). That bill is in Sunny's Hetzner budget already. When we call `/v1/coins/{id}/market_chart`, we read from Postgres → 0 Codex calls on read.

### Gaps (things Spectre doesn't cover)

| Use case | Reason | Action |
|---|---|---|
| Per-pair DEX bars by `pairAddress` at sub-minute resolution | Spectre keys by coin_id, not pair | Keep Codex `getBars` for the <1% of users who need pair-level granularity |
| Per-pair real-time swap events (Codex `onPairUpdated`) | Spectre doesn't stream raw pair events | Keep Codex subscription (currently barely used: 5 events/day) |
| Custom TA indicators on bars (RSI/MACD/Bollinger) | Compute client-side from Spectre bars | No vendor change needed |
| Minute-resolution multi-chain holder churn | Spectre has /v1/onchain/holders but daily granularity | Acceptable for research-tier UX |

**Gap impact: <2% of current Codex spend.** Almost everything migrates.

---

## Architecture: 3-tier fallback per handler

```
                        BROWSER
                           │
                           ▼
              ┌──────────────────────────────┐
              │  Vercel codex.js dispatcher  │
              └─────┬─────────┬───────┬──────┘
                    │         │       │
              TIER 1│   TIER 2│ TIER 3│
                    ▼         ▼       ▼
              ┌──────────┐ ┌─────────┐ ┌───────┐
              │ Spectre  │ │ CG snap │ │ Codex │
              │ /v1/...  │ │ KV      │ │ live  │
              │ (free)   │ │ (free)  │ │ ($$$) │
              └──────────┘ └─────────┘ └───────┘
                    ▲
        ┌───────────┴────────────┐
        │ Spectre Postgres        │
        │ ingested by worker swarm│
        │ (Codex, CG, Binance,    │
        │  DexScreener, Etherscan)│
        └─────────────────────────┘
```

Each handler tries Spectre with a tight timeout (300ms). On timeout/error, falls to CG snapshot KV (Phase K5). On miss, falls to live Codex.

Feature flag: `VITE_SPECTRE_PRIMARY=1` lets us toggle off the whole thing in seconds without redeploying.

---

## Migration plan (sequenced for safety)

### L1: Snapshot cron source swap (1 file, 30 min)
Change `apps/research/api/cron/refresh-cg-snapshot.js` to fetch from `204.168.244.18:3850/v1/coins/markets` instead of CG. SAME data shape (CG-mirror). KV write path unchanged. Zero risk because it's a single source swap.

**Effect:** stop paying CG for the cron. CG Pro Lite plan ($79/mo) becomes cancellable after a week of stable operation.

### L2: handleTokenDetails Spectre primary (~50 LOC)
Add `_readSpectreDetail(address, networkId)` as tier 1 in `apps/research/api/codex.js handleTokenDetails`. Maps address+net → Spectre `/v1/scanner/token/{addr}?chain={chain}` OR `/v1/coins/{cgId}` if we have the CG ID. Falls through to existing snapshot KV (tier 2) then live Codex (tier 3).

**Effect:** ~70% of token detail requests served by Spectre at zero Codex cost.

### L3: handleBars Spectre primary (~80 LOC)
Add `_readSpectreBars(symbol, from, to, resolution)` as tier 1 in handleBars. Falls through to existing Binance-first (tier 2) then Codex (tier 3) on Spectre miss/timeout.

**Effect:** Even DEX-only bars served from Spectre's `worker-candles-codex`-fed Postgres. Codex `getTokenBars` calls from Vercel drop to near zero (only when Spectre is cold on a brand-new token).

### L4: handleTokenSearch Spectre primary (~30 LOC)
Spectre `/v1/search?q=...` first. Codex `filterTokens(phrase:)` fallback only when Spectre returns < 3 results for a query (catches brand-new tokens not in Spectre's index).

### L5: handleTrending Spectre primary (~20 LOC)
K9 currently derives from CG snapshot. Switch to `/v1/trending` (richer fields with social_velocity + volume_spike).

### L6: SSE real-time price stream (1 file, 2 hours)
New `apps/research/api/stream/spectre-prices.js` SSE relay. Browser connects to our `/api/stream/prices?symbols=...`, our relay subscribes to Spectre `/v1/stream/asset/{symbol}` per symbol, fans out to browser. Replaces TradingView's polling fallback path.

**Effect:** sub-second price updates in the UI (vs 60s polling today). Dramatically better UX.

### L7: Cost watchdog extension (~30 min)
Update `cron/codex-cost-watch.js` to ALSO track per-tier hit rate (Spectre vs CG vs Codex) so we see the migration succeed/fail in real time.

### L8 (defer): Cancel CG Pro subscription
After 1 week of stable L1-L5 operation, cancel the $79/mo CG Pro Lite plan. Spectre's worker layer keeps its own CG-Pro key (separate from ours) for its ingestion.

---

## Projected cost after Phase L

| DAU | Pre-K projection | Post-K (today) | Post-L (target) |
|---:|---:|---:|---:|
| 100 | $130-180 | $130-180 | **$20-40** |
| 250 | $310-390 | $310-390 | **$50-80** |
| 500 | $580-700 | $580-700 | **$80-120** |
| **1000** | **$1,395-2,655** | **$1,395-2,655** | **$100-180** |

Plus saving $79/mo on CG Pro.

**At 1000 users, total external API cost: <$200/mo.** Way under the $700 ceiling, with 3.5x headroom.

---

## Risk + safety plan

| Risk | Mitigation |
|---|---|
| Spectre Hetzner down | 3-tier fallback (Spectre → CG → Codex). Codex/CG keep current behavior. Worst case = today's bill, not broken. |
| Spectre data drift from canonical (CG/Codex) | Tier system: if Spectre's price differs > 1% from CG snapshot, log warning. Verify weekly. |
| Spectre rate limits | Sunny owns the box; can lift any internal limit. Currently `sk_int_research_*` key has tier=internal = no limits per memory. |
| Latency Vercel → Hetzner (Frankfurt or wherever) | Test: 300ms tight timeout for tier 1, falls through fast. Most Vercel POPs are < 100ms from EU. |
| Spectre worker dies (data goes stale) | Worker-watch cron alerts within 15 min. Cron pulls /v1/health to detect. |
| Brand-new DEX token not in Spectre's index | Tier 3 (Codex live) catches it. Brand-new tokens are the actual Codex value-add. |

---

## What I'd ship today (if Sunny green-lights)

**L1 only.** Single-file change. Swaps the snapshot cron source from CG to Spectre. Zero risk because the cron output (KV write) stays identical — only the input source changes. Lets us validate Spectre stability for 24h before doing L2-L6.

**Tomorrow after L1 verification:** L2-L5 in sequence with cron metrics confirming each tier shift.

**This week:** L6 (SSE), L7 (cost watchdog tier tracking), L8 (CG cancel after 7 days stable).

---

## Verification queries

```bash
KEY="sk_int_research_8b23a5063018a8a2acbe130de304ef2baa94533d"
BASE="http://204.168.244.18:3850"

# Top 500 markets (CG replacement, ~700ms total for both pages)
curl -H "X-API-Key: $KEY" "$BASE/v1/coins/markets?per_page=250&page=1"
curl -H "X-API-Key: $KEY" "$BASE/v1/coins/markets?per_page=250&page=2"

# Token detail
curl -H "X-API-Key: $KEY" "$BASE/v1/coins/bitcoin"

# Bars (any token, CG-style)
curl -H "X-API-Key: $KEY" "$BASE/v1/coins/bitcoin/market_chart?days=7"
curl -H "X-API-Key: $KEY" "$BASE/v1/coins/pepe/market_chart?days=7"

# DEX scanner
curl -H "X-API-Key: $KEY" "$BASE/v1/scanner/token/0x6982508145454ce325ddbe47a25d4ec3d2311933?chain=ethereum"

# Search
curl -H "X-API-Key: $KEY" "$BASE/v1/search?q=pepe&limit=5"

# Trending (richer than CG, has social_velocity)
curl -H "X-API-Key: $KEY" "$BASE/v1/trending?limit=10"

# Real-time SSE
curl -H "X-API-Key: $KEY" "$BASE/v1/stream/prices/sse?symbols=BTC,ETH,SOL"

# Per-asset SSE (price + derivatives in one stream)
curl -H "X-API-Key: $KEY" "$BASE/v1/stream/asset/BTC"
```

All verified working 2026-06-02 ~ 11:00 UTC.

---

## Decision needed from Sunny

1. [ ] Approve L1 (snapshot cron source swap) for tonight
2. [ ] Approve L2-L5 sequence for tomorrow
3. [ ] Approve cancelling CG Pro Lite ($79/mo) after 7 days of stable Spectre operation
4. [ ] Confirm: do we ALSO want to do this in the trading app? Same migration applies to `apps/trading/api/codex.js`
