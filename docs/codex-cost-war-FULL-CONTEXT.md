# Spectre AI — Codex API Cost War: Full Context Brief

> Read this if you're being asked to audit the architecture and find what's wrong.
> Updated: 2026-06-02 19:00 UTC, after a full day of optimization work.
> Author has been deep in this for 8 hours and may be wrong about something obvious.

---

## TL;DR

Crypto research/intelligence platform. Live to ~40-50 DAU for 5 days. Codex API
(`graph.codex.io`, formerly Defined.fi) spend hit **5.2M ops / $1,820 in 5 days**
when the plan is **1M ops / $350/mo**. Projected end-of-cycle: 22-26M ops = ~$8-9K
this month at 40 DAU. Architecture optimizations cut ~40% today. Sunny rightly
suspects something fundamental is wrong because **other platforms with 10× our
users don't spend like this**. Looking for the architectural mistake we can't see.

---

## The Business

**Spectre AI** = crypto research platform (`app.spectreai.io`) + trading terminal
(`trade.spectreai.io`).

- Research app: market analytics, token research, AI intelligence, news, watchlists
- Trading app: token charts, swap UI, embedded as iframe in research /token page
- Live to users for 5 days
- ~40-50 DAU currently
- Target: 1000 DAU within a quarter
- Cost ceiling: $700/month for external APIs at 1000 DAU

---

## The Stack

### Frontend (Vercel)
- `apps/research` (Vite + React, deploys to `spectre-app-research` Vercel project)
- `apps/trading` (Vite + React, deploys to `spectre-trading` Vercel project)
- Both serve via Cloudflare WAF (`app.spectreai.io`, `trade.spectreai.io`)

### Serverless layer (Vercel functions)
- ~35 functions per app under `apps/{research,trading}/api/`
- Biggest one: `api/codex.js` (dispatcher for token data: details, prices, bars, search, trending, etc.)
- KV layer: **Upstash Redis** wired via `KV_REST_API_*` or `UPSTASH_REDIS_REST_*` env vars
- Cron jobs in `apps/research/api/cron/`

### Express server (`packages/server/`)
- Used in dev only (`localhost:3001`)
- 60+ routes, vast majority of business logic
- WebSocket server for real-time price streaming (port `/ws`)
- Also runs on OVH `srv.spectreai.io` for trading-app SSE relay
- 14K+ lines of `index.js` (legacy monolith)

### Spectre Data API (Sunny's Hetzner box, `204.168.244.18:3850`)
- 799 endpoints under `/v1/*` (verified via OpenAPI spec)
- 152 PM2 workers ingesting from CoinGecko Pro, Codex, Binance, DexScreener,
  X Dash (`5.78.199.87`), Etherscan, Moralis, Helius
- TimescaleDB Postgres holding `candles_1m`, `assets`, `screener_snapshot`,
  `social_*`, `intelligence_signals`
- Hetzner box ALSO has a Codex API key (`98d8fb1b…`) — **completely separate billing account from our Vercel side (`950286c4…`)**
- `worker-candles-codex` mirrors Codex `getBars` data into Postgres every 60s
- `worker-data-refresh-v2` pulls CG top-5000 every 5 min into Postgres

### External paid APIs (Vercel-side, the cost target)
| Vendor | Plan | Monthly cost | What we use |
|---|---|---:|---|
| **Codex (graph.codex.io)** | Starter ($350/M ops) | **OVERSPEND — $1,820 in 5 days** | DEX-tier token data: filterTokens, getBars, listPairsForToken, getTokenEvents |
| CoinGecko Pro | Lite ($79/mo) | $79 flat | Major-token markets, OHLC, search, trending |
| Binance | Free | $0 | Spot klines (BTC/ETH/SOL etc.) |
| Spectre Data API | Hetzner box | already paid | Everything Spectre's workers ingest |

---

## The Cost Curve (Codex spend, real data)

| Date | Ops/day | Notes |
|---|---:|---|
| May 25 | 12K | pre-beta |
| May 28 | 82K | beta launch day |
| May 29 | 946K | first full day at ~40 DAU |
| May 30 | 1.04M | Phase H landed (server-side trending KV cache) |
| May 31 | 1.03M | filterTokens dropped 30%, getBars exploded |
| **Jun 1** | **1.55M** | WORST DAY. ~$540. Phase I+J shipped end of day. |
| Jun 2 (17h elapsed) | 913K projecting 1.29M | Phase 1-L all shipped throughout the day |

**Per-op breakdown on Jun 1 (worst day):**
- `getBars`: 721K (46%)
- `filterTokens`: 417K (27%)
- `listPairsWithMetadataForToken`: 411K (27%) — **billed automatically as a lockstep with any filterTokens that selects volume24/liquidity**
- Everything else: <1%

99.6% of cost = 3 operations.

---

## What We've Tried Today (21 commits, all on `main`)

### Phase 1: Polling reduction (4 commits, morning)
- TradingViewAdvanced chart polling: doubled all intervals (1m: 15s→30s, 1H: 60s→120s, 1D: 5min→10min)
- Pricescale-detection getBars cache (avoid 1 getBars per chart mount just to compute decimal precision)
- Bucket-rounded `fetchBars` dedup (research /token iframe double-mount no longer fires 2 separate calls)
- Watchlist refresh 60s → 120s
- Trading `useTokenDetails` default 60s → 120s
- Idle gating extended to X Dash + token-mentions hooks

**Result**: ~20% reduction visible in Jun 2 data (Phase 1 is the working baseline)

### Phase K: KV snapshot fan-out (3 commits)
- New cron `refresh-token-snapshot` every 60s writes `codex:snap:<addr:net>` for ~16 seed tokens via ONE `filterTokens(tokens:[…])` Codex call
- New cron `refresh-cg-snapshot` every 60s writes 500 `cg:snap:<cgId>` entries from CG `/coins/markets` (zero Codex)
- `handleTokenDetailsBatch` reads `codex:snap` first
- `handleTokenPrices` reads `cg:snap` via SYMBOL_TO_COINGECKO_ID
- `handleTrending` derives from `cg:snap:_all` aggregate key (zero Codex)
- Per-resolution bars KV TTL (1H = 5min, 1D = 30min, 1W = 1h)
- Cost watchdogs added (Codex + CG)
- Tracking doc + per-team-member action items (`docs/codex-cost-war.md`)

### Phase L: Spectre API as fallback (3 commits)
- `handleTokenDetails` 3-tier: snapshot KV → Spectre `/v1/coins/{cgId}` (1000ms timeout) → Codex
- `handleTokenSearch` Spectre `/v1/search?q=` primary, Codex fallback when <3 results
- `handleATH` Spectre `/v1/coins/{cgId}` for ATH field, CG fallback
- `handleBars` CG-market-chart fallback chain now tries Spectre first (rare path, behind Binance + Codex)

### Phase N: Real architectural fix (this evening, after we found the smoking gun)

**The smoking gun**: `KV_REST_API_URL` and `KV_REST_API_TOKEN` in production Vercel were **EMPTY strings**. The Upstash integration was connected to the project but the env vars never actually populated. So all 14 Phase K/L commits — every snapshot read, every CG cron write — were silently no-op'd because `getKv()` fell through to in-memory store, which doesn't persist between lambda invocations. **All of today's K/L architecture was effectively running like Phase 0.**

Fix: added `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars with values from local `.env` (the working KV is `desired-gibbon-109967.upstash.io`). Triggered redeploy. Verified cron writes succeed (500 tokens / minute), KV writes/reads work.

**Then found the next bug**: cron writes 500 `cg:snap:<id>` keys but `handleTokenDetailsBatch` was only checking `codex:snap:<addr:net>` (22 keys via static `KNOWN_TOKEN_ADDRESSES` bridge). So only 22 of 500 cached tokens were reachable from the hot batch path.

**Phase N2 fix shipped**: new daily cron `refresh-cg-platform-map` fetches CG `/coins/list?include_platform=true` (17K coins, 2.6MB, 1.15s) and builds a 34K-entry `addr:net → cgId` map in KV. `_readSnapshotBatch` now uses this for tier-B lookup. Expected coverage: 25/500 → ~500/500.

**Identified but deferred (N1)**: 15s `getTokenBars` poller in `packages/server/index.js:14635` per active WS subscription. Currently 683 ops/day (low) but scales linearly with WS usage. Should be replaced by delegating to `codex-stream.js` existing `onPricesUpdated` subscription.

---

## Today's Honest Numbers

**Codex Jun 2 (17 hours):** 913K ops (53K/hr).
- vs Jun 1 (24h, no fixes): 1.55M (64K/hr)
- vs Jun 1 same window (~17h proportional): ~1.10M
- **Real cut: ~17% so far**

By op:
- getBars: 409K (24K/hr) vs Jun 1 30K/hr → -20% (Phase 1 chart cuts)
- filterTokens: 252K (15K/hr) vs Jun 1 17K/hr → -12%
- listPairsWithMeta: 250K (auto, matches filterTokens)

Phase 1 is the main contributor. Phase K/L impact is **near zero** because:
1. KV was empty all day (just fixed at 17:00 UTC)
2. After fix, coverage was 25/500 tokens (now ~500/500 after N2 cron fires)

So tomorrow (Jun 3) is the first day with the architecture actually running.

---

## Open Architectural Questions (what I want a reviewer to challenge)

### 1. Are we routing through the wrong layer?

We have a Vercel handler that calls Codex DIRECTLY. We ALSO have Sunny's Hetzner
box that's already pulling Codex data into TimescaleDB via `worker-candles-codex`.

**The question**: should the Vercel handler ever call Codex at all? Or should it
always go through `api.spectreai.io` and read from the Hetzner Postgres that
already has the data?

Pros of routing through Hetzner:
- Codex cost stops scaling with DAU entirely
- Spectre Hetzner already paid (sunk cost in monthly hosting)
- Worker-codex on Hetzner does ONE `getBars` per minute per token regardless of user count

Cons:
- Single point of failure (Hetzner box)
- Latency Vercel POP (IAD/CDG) → Hetzner Frankfurt = +80-110ms baseline
- Hetzner box has its OWN Codex bill (Account B) we haven't checked yet
- If Account B is at $50/mo, this is the play. If Account B is at $1000/mo, no savings.

### 2. The lockstep we can't escape

Every `filterTokens` query that selects `volume24` or `liquidity` triggers
`listPairsWithMetadataForToken` automatically. **2 ops billed per call**. We've
verified this with the perfect 1:1 ratio in dashboard data.

Codex docs say this is intentional (pair-derived fields need pair data). We can:
a) Skip the volume/liquidity selections (but we need that data — it's load-bearing for spam filtering + ranking)
b) Cache the result aggressively (we do — KV TTL)
c) Subscribe via `onPairMetadataUpdated` (per-event billing risk)
d) **Flat-rate plan** (Codex offers unlimited network-wide on Growth/Enterprise — email drafted)

**Is there an architecture that breaks the lockstep without losing the data?** I keep coming back to "no, just cache it harder." Reviewer: what am I missing?

### 3. Why is getBars STILL so high after Phase 1 cuts?

getBars is 46% of cost. Phase 1 doubled all poll intervals + bucket-deduped + cached at KV level. Still 24K/hr at 40 DAU.

At 1000 DAU (linear scale) that's 600K/hr just on getBars. Implausible.

Possible answers:
a) Polling per chart is unavoidable — even 120s × 8 hours × multiple charts × 40 users = 19K bars/day. Math is what it is.
b) The `cacheAside` KV cache isn't sharing across users as I expected (every user gets a unique `to` timestamp → different bucket → different cache key → no shared cache hit). I checked, but maybe wrong.
c) Some background hook is firing getBars without me knowing. I audited 4 times today.
d) The trading app `LIVE_POLL_MS` (60s) is firing per concurrent chart viewer = 1 op/min per chart. If 50 charts open simultaneously across users = 72K/day just from that.

### 4. Subscriptions: are we wrong to defer?

`onPricesUpdated`: free per-event but ANY popular token can tick 100×/min during volatility. Defer.

`onTokenBarsUpdated`: per-event billing same problem.

`onFilterTokensUpdated`: streams updates to a filterTokens result set. We don't use it. Could replace our 5-min trending KV rebuild.

**Web Claude said**: get the FLAT-RATE network-wide plan (Growth/Enterprise tier). Codex offers unlimited price updates for a fixed monthly fee on certain networks. This is the structural fix.

Have we tried this? **No.** Email drafted but not sent yet. Behind on Sunny's TODO #2.

### 5. Are we paying twice (the question Sunny keeps coming back to)?

YES for Codex: two separate accounts (`950286c4…` Vercel + `98d8fb1b…` Hetzner).
ALMOST for CoinGecko: SAME key, but our Vercel cron fetches `/coins/markets` every 60s AND Spectre's `worker-data-refresh-v2` fetches every 5min — same data, duplicate work against the same monthly quota.

**The fix**: route Vercel cron to read from Hetzner's already-refreshed Postgres instead of calling CG directly. Sunny said wait on this — Hetzner /v1/coins/markets filters out stablecoins (USDT, USDC), making it not a drop-in replacement. We verified this in a parity test.

### 6. Reasonability check

> Sunny: "API cost is just not reasonable for any platform. You must be doing something wrong."

He's right to push back. Comparable platforms:
- CoinGecko itself serves ~100M req/day on a single Pro plan
- DexScreener serves millions of token detail views at much lower cost
- Other Codex customers (per their docs) routinely run 5-10M ops/month

We're at 1.5M ops/day for 40 users = **37K ops/user/day = 1.1M/user/month.**

**That's the smoking gun.** A user opens the app, browses tokens. They might
look at 20-50 token details, open 5-10 charts. That's maybe 100 ops/user/day
needed. We're at 370× that.

The remaining 99.7% must be:
- Polling (the obvious one — Phase 1 cut some)
- Background refreshes (some)
- Per-render double-mounts (audited, didn't find much)
- Snapshot misses falling through to live Codex (N2 should fix this)
- **OR**: something fundamentally wrong with how requests fan out that I haven't seen

---

## What I Suspect Might Be Wrong (Looking For Outside Audit)

1. **The chart polling architecture is fundamentally O(N tokens × M users) instead of O(N tokens).** The Phase I server-side KV cache should share across users, but the bucket logic uses `to=now` which differs per user. Reviewer: verify the cache key actually shares.

2. **Per-token detail polling is happening in places I haven't audited.** `useTokenProfile`, `useSpectreAssetData`, `useDossierProject` — these hooks might be in pages I didn't check. They might fire Codex calls.

3. **The trading app iframe inside research /token doubles every chart open** — Phase 1 dedup helped but iframe-side polling intervals are separate. Audited but maybe wrong.

4. **The snapshot read path I built has logic bugs** the smoke tests didn't catch. Reviewer: read `apps/research/api/codex.js` lines 263-340 (`_readSnapshotBatch`, `_resolveCgId`) and verify the address→cgId logic is correct.

5. **The Phase K snapshot cron writes the wrong key format** that doesn't match the read path. Verified in admin snapshot-health endpoint but maybe wrong.

6. **There's a runaway recursive cron or worker** I haven't found. The 5-day spike from 12K to 1.55M ops/day is too steep for organic user growth alone (40-50 DAU is stable). Either users grew 100× silently (no — analytics flat) OR there's amplification somewhere.

---

## Files Reviewer Should Read

1. `apps/research/api/codex.js` (~1900 lines) — the dispatcher + all handlers. Most of the cost flows through here.
2. `apps/research/api/cron/refresh-cg-snapshot.js` — the cron that should be killing fan-out
3. `apps/research/api/cron/refresh-cg-platform-map.js` — the N2 address-map fix
4. `apps/research/api/_lib/kv.js` — KV abstraction (env var resolution order)
5. `packages/server/index.js` lines 14490-14640 — the latent WS poller bomb
6. `packages/server/routes/codex-stream.js` — the existing onPricesUpdated subscription infrastructure
7. `docs/codex-cost-war.md` — the team-facing tracking doc
8. `docs/phase-L-spectre-api-migration.md` — Spectre API audit results
9. `docs/codex-sales-email.md` — drafted email for flat-rate plan ask

---

## What I Need From a Reviewer

1. **Is there a fundamentally different architecture we should be using?** (Not "tweak this code", but "you're solving the wrong problem"). Examples:
   - Always-Spectre-for-reads model with Codex confined to one fixed-rate ingestion job
   - Edge-cached static JSON snapshots with no per-request computation
   - Subscriptions-everywhere with throttled SSE
   - Cloudflare Workers KV at the edge instead of Upstash via Vercel functions
2. **Where's the 99% leak?** If 100 ops/user/day is the theoretical floor and we're at 37K/user/day, **what 370× amplification is hiding?**
3. **Is there a Codex billing optimization we're missing?** Flat-rate plan I've identified. Anything else?
4. **Is our snapshot architecture wrong in concept?** I keep iterating on the same pattern (write to KV, read from KV). Maybe the pattern itself doesn't work for our access shape.
5. **Should we kill the Vercel handler entirely** and serve all token data from Spectre's Hetzner box via SSE/CDN, with Codex only at the worker-ingestion layer?

---

## The Numbers That Matter Right Now (snapshot of state)

- **Codex spend today (Jun 2, 17h):** 913K ops (~$320). Projecting 1.29M for the day.
- **Plan limit:** 1M ops/month for $350. We're at 5.6M/mo and rising.
- **CoinGecko Pro Lite:** 2.73% of 2M monthly limit used. Lots of headroom.
- **Spectre Hetzner Codex (Account B):** unknown. Sunny TODO.
- **DAU:** 40-50 stable.
- **Live commits today:** 21 (`main`). Latest = `a2a255a6`.
- **Production deploy:** `spectre-app-research.vercel.app` aliased to `app.spectreai.io` (Cloudflare WAF in front).

---

## Glossary

- **`graph.codex.io`** = Codex GraphQL API (formerly Defined.fi). DEX-tier token data.
- **`filterTokens` / `getBars` / `listPairsWithMetadata`** = Codex GraphQL operations. Billed per-call.
- **Lockstep** = `filterTokens` selecting `volume24` or `liquidity` automatically pulls `listPairsWithMetadata` for pair-derived fields = 2 ops per call.
- **Codex flat-rate** = Growth/Enterprise tier offers unlimited price updates across an entire network for fixed monthly fee.
- **Spectre Data API** = Sunny's Hetzner-hosted layer that aggregates Codex + CG + Binance + DexScreener into Postgres.
- **Vercel KV** = Upstash Redis exposed via Vercel marketplace integration. Used for snapshot fan-out.
- **Cloudflare WAF** = sits in front of `app.spectreai.io`. Blocks bot UAs (which is why our admin curls 403 until you set a real UA).
- **Phase 1 / K / L / N** = my internal phase numbering. K = snapshot fan-out, L = Spectre fallbacks, N = post-KV-fix.

---

## Bottom line for the reviewer

The architecture I built today is correct in pattern. The execution had a hidden
blocker (empty KV env vars) we just found and fixed. There's likely STILL
something architecturally wrong because the per-user op rate (37K/day) is 370×
the theoretical floor (100/day).

If you can spot the structural error — the place where the architecture itself
generates the amplification, not just a missed optimization — that's the answer.
