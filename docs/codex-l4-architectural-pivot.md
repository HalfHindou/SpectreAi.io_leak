# Codex L4 — Architectural Pivot (2026-06-03)

**Status:** Design doc. Approved-pending. PR-1 implementation starts immediately after this doc.
**Author:** backend-architect agent (forensic read + Hetzner/PG probe).
**Tonight's reality:** bill is 1.55M ops/day on 50-100 users (idle guards in PR #716 cut this to ~700K but the linear-in-users curve is unchanged).
**Goal of L4:** **Zero client → Codex paths within a week.** Codex becomes a *background ingestion source*, billed by a controlled cadence, not by user count. Bill becomes **fixed** by cron schedule, not user concurrency.

**Round 2 audit incorporated** (`docs/codex-bleed-audit-round-2-2026-06-03.md`):
- 4 new component-level leaks identified in trading app (DataTabs ETH/SOL 60s poll, RightPanel ETH/SOL/BNB 30s poll, TrendingHub 7×screenTokens-per-mount, TradingViewAdvanced 5000ms initial-poll bug).
- These are **orthogonal to L4** — they're treadmill bugs PR-716 missed because the leaks are inside components, not custom hooks. They'll ship as a separate sibling PR. L4's architectural rewrite makes them **structurally cheaper** even before that PR lands (e.g. RightPanel's `/api/codex?action=prices` will be routed through Hetzner under L4-PR1 even when KV is cold, instead of triple-network filterTokens).

---

## 1. Premise — why this works

The Codex bill is broken because every Vercel handler that fronts a Codex query *is itself a billable Codex consumer per user request*. Idle gates reduce frequency; they don't change the relationship `cost ∝ users`. What we need is to break that relationship entirely:

```
TODAY (broken — linear in user concurrency):
  Browser hook → /api/codex?action=… → Codex GraphQL  (billable, every call)

L4 TARGET (flat — bounded by cron + KV TTLs):
  Background cron → Codex GraphQL → Hetzner Postgres + Vercel KV
                                       ↓
  Browser hook → /api/codex?action=… → Hetzner /v1/… + cg:snap KV (free)
                                          ↓ (last resort, < 5% of traffic)
                                       Codex (only for unindexed tokens)
```

Hetzner already runs the ingestion pipeline we need (`worker-candles-codex`, `worker-binance`, `refresh-cg-snapshot`, `candles_1m` Timescale table covering 11,096 assets, fresh to the last minute). The architectural pivot is **routing the user request path through Hetzner first**, not standing up new infrastructure.

---

## 2. Current state map — every Vercel handler that calls Codex

Source: `apps/research/api/codex.js` + `apps/trading/api/codex.js` (audited against the round-1 bleed audit).

### Research app (`apps/research/api/codex.js`)

| Action | Handler | What Codex call(s) it makes | Daily call volume (rough) | KV/Spectre tiers TODAY |
|--------|---------|-----------------------------|---------------------------|------------------------|
| `details` | `handleTokenDetails` (L680) | `token(input:…)` + `filterTokens(phrase:)` (2 ops/call when neither tier hits) | ~10-20K | KV `cg:snap` + KV `codex:snap` + Spectre `/v1/coins/{cgId}` (1s timeout) → Codex |
| `details-batch` | `handleTokenDetailsBatch` (L456) | `filterTokens(tokens:[…])` once per batch (2 ops via lockstep — Lever-3 trimmed selection) | ~30-50K post-PR-716 | KV snap + spectre-data backfill → Codex |
| `search` | `handleTokenSearch` (L945) | `filterTokens(phrase:)` per-network + token info merge | ~5-15K | Spectre `/v1/search` (500ms) for non-address queries → Codex |
| `trending` | `handleTrendingTokens` (L1259) | 7 parallel `filterTokens(rankings:[…])` queries (14 ops on miss, KV-cached 5min) | ~3K (mostly cached) | KV `codex:trending:` + CG-snap derivation → Codex 7-query rebuild |
| `prices` | `handleTokenPrices` (L1401) | `filterTokens(tokens:[…])` for known-by-address; `filterTokens(phrase:)` for unknowns | ~5K post-PR-716 | KV `cg:snap` + KV `codex:snap` → Codex |
| `batchPrices` | `handleBatchPrices` (L2165) | `filterTokens(tokens:[…])` mega-batch | ~80K (Welcome page) | KV-aware but Codex is primary write target |
| `bars` | `handleBars` (L1631) | `getTokenBars` (per chart-poll) | **721K** (46% of bill) | Binance klines first → Codex → CG market_chart → Spectre `/v1/coins/{id}/market_chart` |
| `ath` | `handleATH` (L1917) | One-shot ATH read | <1K | Spectre `/v1/coins/{id}` → CG |
| `trades` | `handleTrades` (L2003) | `getTokenEvents` | ~50K | None — straight to Codex |

### Trading app (`apps/trading/api/codex.js`)

| Action | Handler | Notes vs research |
|--------|---------|-------------------|
| `details` | `handleTokenDetails` (L290) | NO `spectre-data` helper. NO `/v1/coins/{cgId}` tier. Snapshot-only fallback, then straight to Codex (full lockstep selection — heavier than research). |
| `search` | `handleTokenSearch` (L444) | NO Spectre `/v1/search` tier. Codex primary. |
| `trending` | `handleTrendingTokens` (L686) | NO CG-snap derivation. Codex primary, KV-cached only. |
| `screener` | dispatch in switch L1836 | Codex primary. |
| `prices` | `handleTokenPrices` (L855) | Snapshot fallback only. |
| `batch-prices` | `handleBatchPrices` (L983) | Same. |
| `top-tokens` | `handleTopTokens` (L1025) | Codex `filterTokens` rankings. |
| `bars` | `handleBars` (L1100) | **NO Binance-first path** — straight to Codex. Trading bears more `getBars` cost per user than research per-tab. |
| `ath` | `handleATH` (L1262) | CG-direct, not Spectre. |
| `trades` | `handleTrades` (L1335) | Codex direct. |
| `market-stats` | `handleMarketStats` (L1588) | Non-Codex aggregation. |
| `tweets` | dispatch L2077 | Non-Codex. |

**Summary**: trading app is **structurally behind research** — research has been getting Lever-3 / Phase-L1 / Phase-K patches over the last weeks; trading has only received snapshot reads. The L4 pivot has to bring trading up to (and past) research.

---

## 3. Target architecture per handler

For every handler, the rewrite makes Hetzner/KV the primary read. Codex stays plugged in as the bottom of the fallback chain ONLY for:
- Long-tail DEX tokens that CG doesn't have AND Hetzner hasn't indexed
- Brand-new contract deployments where address-strict resolution matters
- Whatever the residual surfaces we explicitly accept (see §6)

| Action | New primary | Secondary | Codex (fallback) | Response-shape change? |
|--------|-------------|-----------|------------------|------------------------|
| `details` | KV `cg:snap:<cgId>` (sub-ms) | Hetzner `/v1/coins/{cgId}` (100-400ms) OR `/v1/scanner/token/{addr}` for DEX (150-400ms) | Codex `token` query (when both fail AND address looks brand-new) | None. `_snapToDetailResponse` shape already matches. Add fields from scanner where present. |
| `details-batch` | KV `cg:snap` per-token + Hetzner `/v1/coins/markets?ids=…` bulk (one call for the entire batch) | Hetzner `/v1/scanner/token/{addr}` for misses (TIER3_CONCURRENCY=10) | Codex `filterTokens(tokens:[…])` for items neither tier resolved | None. Already implemented as the *backfill* in PR-713; we *invert* the order (was Codex-then-helper, becomes helper-then-Codex). |
| `search` | Hetzner `/v1/search/?q=` (already tier-2 today, ~80-250ms) | Hetzner `/v1/markets/search` for richer text matching | Codex `filterTokens(phrase:)` ONLY for raw contract address queries | None. Spectre search response is already shape-converted in `_fetchSpectreSearch`. |
| `trending` | Hetzner `/v1/market/trending` + `/v1/discovery/trending-tiered` | KV `cg:snap` top-N derivation (already implemented in PR-713) | Codex 7-query rebuild ONLY when both Hetzner trending endpoints fail AND the KV derivation has < 20 results | None. Result shape `{ results: [{ token, priceUSD, volume24, change24, ... }] }` already implemented. |
| `prices` | KV `cg:snap` (tier-1, 95% hit) + KV `codex:snap` (tier-2) | Hetzner `/v1/coins/markets?ids=…` for known cgIds not in KV | Codex `filterTokens(tokens:)` for the residual (genuine long-tail) | None. |
| `batchPrices` | Same as `prices`, larger scale | Same | Same | None. |
| `bars` (major tokens) | Binance klines (already PR-713) | Hetzner `/v1/candles/{symbol}` (NEW — symbol-keyed, Timescale-backed) | Codex `getTokenBars` for tokens neither covers | None for line/candle bars. Need `to`/`from`/`resolution` translation (see §4). |
| `bars` (DEX tokens) | Hetzner `/v1/candles/{symbol}` if Hetzner has indexed it | Codex `getTokenBars` for DEX tokens Hetzner hasn't covered | (same) | (same) |
| `ath` | KV `cg:snap.ath` if cron writes it | Hetzner `/v1/coins/{cgId}` (`market_data.ath.usd`) | CG `/coins/{id}` direct | None. |
| `trades` | Hetzner `/v1/scanner/token/{addr}` if it surfaces recent trades | Codex `getTokenEvents` | (residual) | Need to evaluate Hetzner trade surfacing — flagged as L4-PR follow-up, not PR-1 scope. |

### Same-shape contract is mandatory

Every UI consumer parses `parseFloat(x) || 0` on numeric fields and ignores nulls; the L4 rewrites all return Hetzner fields cast into the existing Codex response shape. Any field Hetzner cannot supply (`change4h`, `change12h`, `uniqueWallets24` on truly unindexed tokens) stays as `0` exactly as it does today on Codex-fallback-empty rows.

---

## 4. Charts plan — `/api/bars` and `/api/tradingview/udf/history`

Charts are 46% of the bill (`getBars` = 721K ops/day). The plan is unchanged from the existing PR-713 Binance-first path *for major tokens* and adds a new Hetzner-cached tier *for everything else*.

### 4.1 Major tokens (BTC, ETH, SOL, top-50 with Binance pairs)

Already routed to Binance klines via `_binanceSymFromInput`/`_fetchBinanceKlines` (research/codex.js L1631). **Trading app is missing this path** — PR-4 mirrors it.

Cost: $0 (Binance public API is free, ip-blocked from Vercel so research already uses allorigins fallback).

### 4.2 Hetzner candles (`/v1/candles/:asset` — primary for non-Binance, Timescale-backed)

Hetzner has `candles_1m` (37M rows, 800 CEX assets) + `price_history_daily` (1M rows, 1851 assets back to 2013). The endpoint takes **symbol OR coingecko_id** (not raw addresses — uses `asset-resolver` to canonicalize).

```
GET /v1/candles/pepe?interval=1h&limit=500
GET /v1/candles/PEPE?interval=15m&from=2026-01-01&to=2026-06-01
```

Supported intervals: 1m/2m/3m/5m/15m/30m/45m/1h/2h/3h/4h/1d/1w/1M/3M/6M/12M.
Response shape: `{ data: [{ time, open, high, low, close, volume, quote_volume, trades }], meta: { source: 'candles_1m'|'price_history_daily', queryTimeMs } }`.

Adapter in `apps/research/api/codex.js handleBars` translates Codex resolutions ('60' → '1h', '240' → '4h', '1D' → '1d', '1W' → '1w') and remaps the row format to the Codex-shaped `{ t, o, h, l, c, v }` array.

### 4.3 Codex (residual)

`worker-candles-codex` on Hetzner is **currently failing** with `circuit_open:codex.graphql` (Hetzner's Codex key `98d8fb1b…` is in circuit-open state per pm2 log @ 22:11). This means **the DEX-only branch of Hetzner candles is going stale**. Vercel's `getTokenBars` direct call is the only path that still works for DEX-only tokens until Hetzner's circuit recovers OR we put the active Vercel key on Hetzner (see §11.B).

**Recommendation**: PR-5 ships the Hetzner candles *adapter* (so when the worker recovers, we benefit immediately) but does NOT remove the Codex fallback path. The fallback chain becomes: `Binance → Hetzner candles → Codex getTokenBars` and we accept that the middle tier may be partially cold for ~5% of DEX-only tokens until Hetzner's Codex key is restored.

### 4.4 TradingView UDF history (`/api/tradingview/udf/history`)

Express `packages/server/index.js` L5461. Self-calls `/api/bars` internally. The L4 changes flow through automatically because `/api/bars` is the canonical surface. No separate UDF rewrite needed; remove the self-call hop in PR-6 as an optimization (saves ~30-50ms per request, no Codex impact).

---

## 5. Cron tightening — `refresh-token-snapshot`

Current schedule: every 60s in BOTH apps (research + trading have separate KV namespaces, each crons at 1m).

**Cost**: ONE `filterTokens(tokens:[union of 200])` per cron tick = 2 billable ops via lockstep × 2 apps × 1440 minutes/day = **5,760 ops/day**. Per the round-1 audit this is "architectural and necessary — do NOT touch."

The audit was correct *for the L3 architecture* where the snapshot was the user-facing primary. In L4 the snapshot's role changes:

| State | Snapshot role | Required cadence |
|-------|---------------|------------------|
| L3 (today) | Reads collapse 40+ users into 1 cron call | 60s (KV TTL 90s) |
| L4 (target) | Hetzner is primary; KV is hot-cache backup. Snapshot only matters when Hetzner is slow/down. | **5 min** (KV TTL 6 min) |

**Projected savings from cadence change alone:**
| Cadence | Daily Codex ops (snapshot) |
|---------|----------------------------|
| 60s (today) | 5,760 |
| 5 min (PR-6) | 576 |
| 15 min (aggressive) | 192 |

Recommendation: PR-6 ships **5-min cadence with 6-min KV TTL**. Going to 15min introduces a risk window where freshly-listed tokens take 15min to appear in snapshot; we'll re-evaluate after L4 stabilizes.

---

## 6. Real-time price feed (L5 preview)

`apps/trading/src/services/codexStreamApi.js` uses Codex SSE for real-time price streams. Today's pattern:
- Open SSE → Codex pushes price/bar updates → reconnect on disconnect (2s → 30s exponential backoff)
- Each SSE connection is a billable Codex stream session

L5 (post-L4) replaces this with:
- **Major tokens**: direct Binance WebSocket (`wss://stream.binance.com:9443/ws`) — free, real-time. Hetzner's `worker-binance` already mirrors this internally; we just connect the browser to the same source. Falls back gracefully via `allorigins` WS proxy if Binance IP-blocks Vercel users on geo (rare).
- **DEX tokens**: Hetzner SSE relay — new endpoint `/v1/stream/candles/{asset}` that broadcasts from the candles-codex worker's UPSERT events via Postgres LISTEN/NOTIFY. Backend has the firehose, browser subscribes to the asset it cares about. ZERO additional Codex ops per browser.

L5 is **out of scope for this week** but the L4 design must not block it — specifically, the `/api/bars` adapter response shape must be identical between the Binance and Hetzner paths so the L5 stream can replace the polling on either path independently.

---

## 7. Edge cases — what CANNOT be retired

These four surfaces stay on Codex permanently. They're the residual bill.

| Surface | Why Codex-only | Estimated daily ops |
|---------|---------------|---------------------|
| **Brand-new DEX deployments** | First 1-24h after a token contract is deployed, no other source has it indexed. Address-strict resolution. | ~2-5K |
| **DEX address resolution for raw `0x` paste** in search | When a user pastes `0xabc…` and we have zero rows for it, Codex `token(input:{address:…})` is the only way to materialize a token row. | ~1-3K |
| **Custom DEX bars where Hetzner has no symbol mapping** | If a token is on a long-tail chain Hetzner doesn't index (e.g. new chains added before Hetzner team wires them), `getTokenBars` is the only source. Should shrink over time. | ~5-10K |
| **`trades` (handleTrades)** — until Hetzner exposes recent-trades endpoint | Today no Hetzner endpoint surfaces a tail of recent trades per token. Codex `getTokenEvents` is the only source. **Possible Hetzner team ask**: add `/v1/scanner/token/{addr}/trades?limit=50` from `dex_swaps` table. | ~50K (this is the main residual) |

**Residual ops/day target**: ~60-70K (mostly from `trades`, easy to cut once Hetzner exposes the table).

---

## 8. PR sequence (4-6 mergeable PRs)

Each PR is independently revertable. Each ships to BOTH apps in lockstep where applicable, OR is explicit about app coverage.

| PR | Title | Scope | Risk | Revert |
|----|-------|-------|------|--------|
| **PR-1** | `perf(codex): L4-PR1 retire Codex from token-details paths (Hetzner primary)` | Flip research+trading `handleTokenDetails` and `handleTokenDetailsBatch`: Hetzner-first, Codex-fallback. Brings trading-app helper parity (port `spectre-data.js` to `apps/trading/api/_lib/`). | LOW — same-shape responses, helper already proven in PR-713. | `git revert <sha>` restores Codex-first; KV/Spectre tiers stay populated. |
| **PR-2** | `perf(codex): L4-PR2 search-first Hetzner across both apps` | Trading-app `handleTokenSearch` gets the `/v1/search/?q=` tier (research already has it). Tighten research: drop Codex fallback to address-only queries. Both apps gain CG `/search` slug-resolve as 3rd tier. | LOW — search results are pure UI; degrading to Spectre-only for text queries is acceptable. | Restore Codex `filterTokens(phrase:)` primary path in both files. |
| **PR-3** | `perf(codex): L4-PR3 trending from Hetzner /v1/market/trending` | Trading-app `handleTrendingTokens`: KV `cg:snap` derivation (mirror of research PR-713 Phase K9) + Hetzner `/v1/market/trending` tier-2. Research-app: collapse the 7-query Codex rebuild to 1 query (the existing volume24/change24 axes) — saves ~14 ops per KV-cache-miss tick. | MEDIUM — trending is a high-visibility surface. Need before/after screenshots. | Restore 7-query Codex rebuild in research; trading reverts to snapshot-only. |
| **PR-4** | `perf(codex): L4-PR4 Binance-first /api/bars in trading app (parity)` | Port `_binanceSymFromInput` + `_fetchBinanceKlines` from research-app `apps/research/api/codex.js handleBars` (already at L1631) to `apps/trading/api/codex.js handleBars`. Net cut: ~50-70% of trading-app `getBars` cost (currently has zero Binance path). | LOW — Binance klines are real-time clean data, already battle-tested in research. | Drop the Binance block; falls back to existing Codex path. |
| **PR-5** | `perf(codex): L4-PR5 Hetzner /v1/candles adapter for both apps` | Add Hetzner candles tier between Binance and Codex in both apps' `handleBars`. Resolution translation: `60→1h`, `240→4h`, `1D→1d`, `1W→1w`, etc. Sync `from`/`to` mapping via Hetzner's `from=`/`to=` params. **Codex remains the bottom tier** because Hetzner's candles-codex worker is currently circuit-open (see §11.B). | MEDIUM — needs visual smoke test of candle counts/timestamps on `/research-zone`, `/token`, and the TradingView Advanced datafeed. | Drop the Hetzner block; flow falls back to existing Binance → Codex chain. |
| **PR-6** | `perf(codex): L4-PR6 cron + snapshot cadence tuning` | (a) refresh-token-snapshot 60s → 5min in BOTH apps + KV TTL 90s → 360s. (b) Drop the self-call hop in `packages/server/index.js` UDF history (call `handleBars` directly). (c) Trading-app `prefetchPopularSearches` warmup goes behind `requestIdleCallback` (research already does this). | LOW — savings come from a cron cadence which is a config change. | Restore `*/1 * * * *` in vercel.json + TTL 90s. |

**Trading-app mirror coverage**: PR-1, PR-2, PR-3, PR-4 each touch BOTH `apps/research/api/codex.js` AND `apps/trading/api/codex.js`. PR-5 touches both. PR-6 cron config touches both `apps/research/vercel.json` and `apps/trading/vercel.json`.

---

## 9. Rollback plan

Every PR is one-commit revertible:

```
git revert <sha>                # restore Codex-primary for that PR's scope
# OR feature-flag (safer for L4-PR1 + L4-PR2):
process.env.L4_FORCE_CODEX_PRIMARY=1   # respect at top of each handler
```

PR-1 will ship the `L4_FORCE_CODEX_PRIMARY` env var as a per-handler kill switch so we can flip back in Vercel dashboard without a deploy if Hetzner has an outage during rollout week.

---

## 10. Projected end-state bill

Assumptions: 100 concurrent users, post-PR-716 idle gates active, L4 PRs fully deployed.

| Surface | Ops/day TODAY (post-PR-716) | Ops/day after L4 | Notes |
|---------|------------------------------|------------------|-------|
| `getBars` (charts) | ~360K (post-idle-gate) | ~30K | Binance covers top-50, Hetzner candles covers ~11K other assets. Residual = brand-new DEX tokens within first 24h. |
| `filterTokens (tokens:[…])` (details-batch) | ~30K | ~3K | Hetzner `/v1/coins/markets` bulk covers all top-500 cgIds; scanner covers DEX addresses. Residual = unindexed contracts. |
| `filterTokens (phrase:)` (search) | ~5K | ~500 | Address-strict queries only. |
| `filterTokens (rankings:[…])` (trending) | ~3K (KV-cached) | ~300 | 5min cadence + Hetzner primary. |
| `filterTokens (tokens:[…])` (prices/batchPrices) | ~60K | ~6K | KV `cg:snap` already 95% hit; the residual is non-major addresses. |
| `getTokenEvents` (trades) | ~50K | ~50K (unchanged) | Stays Codex-only until Hetzner adds `/v1/scanner/token/{addr}/trades`. Single biggest residual. |
| `token` (single-token details fallback) | ~10K | ~1K | Hetzner `/v1/coins/{cgId}` covers majors; `/v1/scanner/token/{addr}` covers DEX. |
| `refresh-token-snapshot` (cron) | 5,760 | 576 | 60s → 5min. |

**Total projected**: **~91K ops/day** vs today's 1.55M (post-L3) and ~700K (post-PR-716).

At Codex pricing (~$0.005/op typical, ranges $0.002-0.01 depending on tier), that's:
- Today: $7.7K-15K/month
- Post-PR-716: $3.5K-7K/month
- **Post-L4 target: $440-880/month** (~**$13-26/day**)

**Honest caveat**: the `trades` line is half the residual. If Sunny wants to get below $500/mo, Hetzner needs to expose `/v1/scanner/token/{addr}/trades`. That's a Hetzner team ask, not a Vercel PR. Without it the floor is ~$450/mo.

---

## 11. Biggest unknowns and blockers

### 11.A — Hetzner Codex key circuit-open (BLOCKS PR-5 freshness)

**Confirmed live**: `worker-candles-codex` on Hetzner @ 22:11 UTC was emitting `circuit_open:codex.graphql` on every getBars call. The DEX-only branch of `candles_1m` is going stale. **Decision required from Sunny**:

- **Option A**: Rotate the active Vercel Codex key (`950286c4…`) onto Hetzner with a dedicated billing flag so Hetzner can refresh DEX candles directly. Cost neutral (we're already paying the bill; just moves the calling surface from Vercel → Hetzner where it's controlled by a worker cadence, not user concurrency).
- **Option B**: Keep Hetzner's circuit-open key. Drop Hetzner candles for DEX tokens entirely; rely on Vercel-direct Codex `getTokenBars` for them. This caps the DEX chart cost at the current Vercel level (~50K ops/day for DEX charts). Defers L4's full bill cut until later.
- **Option C**: Defer DEX chart support; show line-chart-only via CG market_chart for DEX tokens when Hetzner is stale. UX downgrade, but zero Codex.

Recommendation: **Option A**. The cost of letting Hetzner run the ingestion is the same dollar amount but bounded by *worker cadence* (60s × 100 stale assets per tick max) instead of *user count*. Sunny needs to mint a fresh key or transfer billing on the existing one.

### 11.B — Hetzner team trade-feed ask (BLOCKS the $440-880/mo floor)

`/v1/scanner/token/{addr}/trades?limit=50` does not exist today. Sunny/Alaa need to add it from `dex_swaps` table. Until then, `handleTrades` stays on Codex and contributes ~50K ops/day to the residual. **Action**: file an issue against the spectre-data-api repo OR have Alaa ship it in his next push.

### 11.C — Same-shape contract for Hetzner candles vs Codex (BLOCKS PR-5 quality)

Hetzner `/v1/candles/{symbol}` returns `time` (ISO timestamp), `open/high/low/close` (numeric strings from Postgres `numeric`). Codex returns `t` (unix seconds), `o/h/l/c` (numbers). The adapter must:
1. Convert timestamps to unix seconds: `Math.floor(new Date(row.time).getTime()/1000)`
2. Cast strings to numbers: `parseFloat(row.open)`
3. Map field names: `{time, open, high, low, close, volume} → {t, o, h, l, c, v}`

This is straightforward but needs visual test against TradingView Advanced's UDF datafeed (looking for off-by-1 timestamps, wrong volume scaling). Charts agent already has reference patterns in `.claude/rules/charts-system.md` D2/D3 — leverage that file in PR-5.

### 11.D — Latency budget on the hot path

Vercel → Hetzner adds 100-200ms per call (US East → DE typically ~120-180ms). Today's pattern (`Promise.allSettled` + 2500ms `AbortSignal.timeout`) is already deployed in `spectre-data.js`. PR-1 carries that same pattern through. Risk: chart-bars on `getBars`-equivalent path through Hetzner takes ~250-400ms vs Codex direct 120-300ms — borderline noticeable on the chart timeframe-switch button. Mitigation: keep Binance-first for majors so chart UX latency stays sub-200ms for 90% of tokens.

### 11.E — Trading-app helper port

Trading's `_lib/` doesn't have `spectre-data.js`. PR-1 copies it over (no functional change to research). Need to handle the `kv.js` import differently because trading uses different Vercel KV namespace (`@vercel/kv` initialised in `apps/trading/api/_lib/kv.js` with different binding). Pattern: copy spectre-data.js verbatim, adjust the `kv.js` import path. Tested at the time of PR-715 hotfix.

---

## 12. Recommended merge order

PR sequence is independent enough that PRs can ship in parallel, but the safest merge order minimizes blast radius:

1. **PR-1 first** (token-details). Lowest risk, biggest savings. Validates the Hetzner-primary pattern under production load.
2. **PR-4** (Binance bars in trading). Independent of PR-1. Cuts ~25% of trading-app Codex bill immediately.
3. **PR-2** (search). Low-risk text-search routing.
4. **PR-3** (trending). Higher visibility — needs careful smoke.
5. **PR-6** (cron tuning). Once PR-1/2/3 are stable for 24h, drop the cron cadence.
6. **PR-5 last**. Hetzner candles adapter. Largest blast-radius (chart breakage). Ship after Hetzner's Codex circuit recovers AND PR-4 is stable.

---

## 13. Architectural inventory (for future audits)

- `apps/research/api/_lib/spectre-data.js` — triple-tier helper. **Foundation of L4.**
- `apps/trading/api/_lib/` — needs `spectre-data.js` port in PR-1. KV via `_lib/kv.js`.
- `packages/server/lib/token-registry.js` — symbol/address/chain canonical map, used by both app helpers.
- Hetzner `/opt/spectre-data-api/`: 
  - `src/api/routes/candles.js` — chart bars from `candles_1m` + `price_history_daily`. Symbol-resolved.
  - `src/api/routes/coins.js`, `src/api/routes/search.js`, `src/api/routes/scanner.js` — already used as tiers in research-app.
  - `src/workers/candles-codex.js` — refreshes DEX candles from Codex. **Currently circuit-open**, see §11.A.
  - `src/workers/binance.js`, `src/workers/bybit.js`, etc. — refresh CEX candles. **Healthy**, 11K+ assets fresh-to-the-minute.
- Vercel cron `/api/cron/refresh-token-snapshot` (both apps) — KV snapshot writer. Cadence tuneable per PR-6.

---

## 14. Open follow-ups (post-L4)

- **L5**: real-time Binance WS + Hetzner SSE relay (replaces `codexStreamApi.js`). Eliminates `useCodexStream`/`useCodexBarsStream` Codex sessions.
- **L6**: Hetzner trades endpoint (`/v1/scanner/token/{addr}/trades`) — kills the last 50K ops/day residual.
- **L7**: serverless function size audit — `apps/research/api/codex.js` is 2493 lines (60KB). Break into per-action files for cold-start parity once L4 stabilizes.
- **L8**: dedup trading + research codex.js handlers into a shared package (90% duplicated logic, separate deploys today).
