# Codex Cost War — Handoff Brief

**Date:** 2026-06-02 evening
**Status:** Diagnosis complete, fixes not yet shipped. Next session picks up at TASK 1 (dossier kill) onward.
**Previous session:** ran ~3 hours, included one harness compression. Starting fresh for the actual surgery.

---

## THE GROUND TRUTH (Sunny's Codex dashboard, Jun 1 full day)

| Operation | Calls/day | % of bill | What it is |
|---|---|---|---|
| `getBars` | 721,059 | **46%** | Hetzner candles workers (NOT app chart path) |
| `filterTokens` | 416,599 | **27%** | Token discovery (workers + request path) |
| `listPairsWithMetadataForToken` | 411,260 | **27%** | **Lockstep** — auto-billed when `filterTokens` selects `volume24`/`liquidity`/pair fields |
| `getTokenBars` (app chart) | 1,324 | <0.1% | The actual `/api/tradingview/udf/history` + `/api/bars` path |
| Everything else | <0.3% | — | — |
| **Total** | **~1.55M/day** | 100% | Growth 1M plan ($350/mo) blown 1.55x daily |

**Critical:** the bill is **ingestion-dominated, NOT request-path-dominated**. Migrating reads off Codex (PROMPT 2) does almost nothing. The fixes are at the worker layer.

**`codex-metrics-kv` admin endpoint undercounts ~18x** — only 84K/day visible there. Do NOT use it as the source of truth. The Codex dashboard is canonical.

---

## What shipped tonight (and what it actually did)

| PR | Change | Real impact |
|---|---|---|
| #706 | `apps/research/api/_lib/handlers/tradingview-udf.js` cache-wrap with shared key to `/api/bars` | Real correctness fix, but addresses `getTokenBars` (1,324 calls/day) — **~0% of bill** |
| #706 | New `apps/research/api/admin/codex-metrics.js` | Useful for partial visibility, but only sees instrumented surfaces |
| #707 | Empty commit (canceled by Vercel dedup) | No-op |
| #708 | One-line comment commit to force redeploy for `ADMIN_KEY` env propagation | No-op for bill |

**Honest framing:** tonight's UDF cache wrap was based on a wrong reading of the cost shape. The "getBars 46%" earlier framing was `getBars` (lowercase, Hetzner candles), not `getTokenBars` (the app chart). The cache is good architecture/hygiene but does NOT touch the bill. Web Claude and I both acknowledged this once Sunny pasted the actual dashboard numbers.

**Net effect of tonight's session:** zero meaningful change to the Codex bill. Architecture cleaner, but the surgery hasn't happened yet.

---

## The actual fix plan (3 levers, ranked by impact)

### LEVER 1 — Kill the dossier worker (≈5% of bill, easy, fully audited)

**What:** OVH (`srv.spectreai.io`) Express server runs `packages/server/src/dossier/sources/codex.js` workers on boot via `index.js:1656 dossier.startWorkers()`. These were deleted from the repo in commit `74674a09` (Evgeniy, "replace SQLite dossier with stateless aggregator proxy"), but OVH deploys via rsync without `--delete` so stale files remain. The workers use deprecated `filterTokens(tokens:[...], filters:{network:[...]})` shape that Codex schema rejects, but Codex bills failed calls anyway. Net: **78,120 errored Codex calls/day, 100% waste.**

The replacement is `apps/research/api/_lib/handlers/dossier-proxy.js` (948 lines, Vercel) which aggregates Hetzner `/v1/dossier/:sym` + 6 other Hetzner endpoints + CoinGecko/CoinPaprika. **No Codex calls in the new path.** Verified in this session.

**Field-parity audit (partial — finish in next session):**
- `/v1/dossier/:asset` (Hetzner, `src/api/routes/dossier.js`) returns: `asset` (identity+market), `thesis` (brain_convictions), `voices` (brain_signals), `catalysts` (token_unlocks/governance_proposals/economic_events), `risk_flags`, `onchain` (whale_transactions), `derivatives` (funding/OI/liq from history tables), `technicals`, `brain_voice`, `conviction`, `fact_check`, `hit_rate`. **Zero Codex.**
- Old composeFull (OVH) returned: `tokens`, `market`, `safety`, `socials`, `lore`, `holders`, `flows`, `mindshare`, `events`. Gaps vs new: `safety`, `socials`, `lore`, `holders`, `mindshare`. But aggregator (`dossier-proxy.js`) fills these by hitting `/v1/intelligence/projects/:sym`, `/v1/profiles/:sym`, `/v1/brain/dossier/:sym/full`, `/v1/asset/:sym/profile`, `/v1/intelligence/signals/:sym`, `/v1/token-intel/website/:sym`.

**Risk:** frontend still has refs to `/api/dossier` (OVH) — needs verification before kill. Found:
- `apps/research/src/services/dossierApi.js:5: const BASE = '/api/dossier'`
- `apps/trading/src/components/DossierFeed.jsx:5` — uses `/api/dossier` via `VITE_DOSSIER_API`
- `apps/trading/src/hooks/useDossier.js:16` — same
- `apps/trading/src/components/DossierStory.jsx:7` — same
- `apps/trading/src/components/LeftPanel.jsx:156` — same
- `apps/trading/src/components/TrendingHub/index.jsx:463` — same
- Plus `apps/research/src/pages/dev-freshness/index.jsx:60-61` — dev tool, OK

**This means trading app still consumes OVH `/api/dossier`. Killing the WORKER (`DOSSIER_ENABLED=false`) is safe (worker is the bleeder), but the ROUTE may need to stay alive briefly until trading app migrates to `/api/dossier-proxy` or `/v1/dossier`.** Verify in next session.

**Fix steps (next session):**
1. Confirm `DOSSIER_ENABLED=false` disables ONLY the workers, not the `/api/dossier` ROUTE.
2. If yes: SSH to OVH (`srv.spectreai.io`, IP `51.178.209.131`), set `DOSSIER_ENABLED=false` in PM2 ecosystem env, `pm2 reload spectre-server`.
3. If `DOSSIER_ENABLED=false` ALSO kills the route → trading app breaks. Need to migrate trading-app dossier callers to `/api/dossier-proxy` first.

**Savings:** 78K Codex ops/day eliminated. ~5% of bill.

---

### LEVER 2 — Cut the candles worker frequency/scope (≈46% of bill, medium effort)

**What:** Hetzner `src/workers/candles-codex.js` runs every 60s, fetches 1m bars for up to 100 DEX-only assets. Code:
```js
TICK_INTERVAL = 60_000;       // 60s tick
ACTIVE_LIMIT = 100;            // assets per tick
RESOLUTION = '1';              // 1-minute bars
TAIL_MINUTES = 65;             // last 65 min per call
```
Math: 100 calls × 1440 ticks/day = 144,000/day expected. Dashboard shows 721K → factor of 5x gap. Likely sources:
- `candles-codex-backfill.js` running concurrently (10-min tick, 30 windows × 25h = month of history per tick = lots of getBars calls)
- The SELECT query in candles-codex returns up to 100 STALE assets — if there are more than 100 active, the rotation cycles them, but each cycle is fresh calls
- Possible env override of `ACTIVE_LIMIT` in production (worth checking on OVH/Hetzner env)

**Mid-investigation findings:**
- Only TWO Hetzner files call `codex.getBars(...)`:
  - `src/workers/candles-codex.js:158`
  - `src/workers/candles-codex-backfill.js:121`
- Backfill cadence: 10-min ticks, MAX_WINDOWS_PER_TICK=30 → up to 30 getBars calls per tick per asset = 30 × 144 ticks/day = 4,320 backfill calls/day MAX (much less than the 580K gap)
- Real gap is unexplained; needs `pm2 logs` on Hetzner for the candles-codex worker to read actual ops/tick.

**Fix paths (ranked):**
1. **Reduce ACTIVE_LIMIT to ~20 ("actively-charted" tokens only).** Need to define "actively charted" — tokens with WS subscribers OR in user watchlists in last 24h. Drops baseline by 5x → ~30K/day saved per 100 reduction.
2. **Slow-refresh the tail.** Why 1m bars every 60s? A token with no open chart doesn't need second-by-second freshness. Tiered cadence: 5min for actively-charted (top 20), 30min for watchlist tokens (next 100), 4h for the long tail.
3. **Trust `candles_1m` table for reads.** Charts read from Postgres, not from Codex live. Already partially shipped (worker writes to Postgres). Verify nothing in the read path re-hits Codex.
4. **Residual on CoinGecko `/onchain` or flat-rate Codex.** Once worker scope is tight, residual cost is small enough to negotiate or absorb.

**Savings target:** 70-80% of the 721K line = ~500-580K/day eliminated. Biggest single lever.

---

### LEVER 3 — Eliminate the filterTokens lockstep (≈27% of bill, surgical)

**What:** Every `filterTokens(...)` call that selects `volume24` or `liquidity` or pair-metadata fields **auto-bills a `listPairsWithMetadataForToken` call** on Codex's backend. That's the 1:1 lockstep ratio in the data: 416K filterTokens + 411K listPairsWithMetadataForToken = same calls, double-billed.

**Per Codex docs:** This is a published behavior. Fields that trigger the lockstep:
- `volume24` (any volume field)
- `liquidity`
- `pairs` / pair metadata
- `holders` (sometimes, depending on which sub-field)

**Fix:** drop those fields from filterTokens calls when the data is available elsewhere. The data IS available elsewhere:
- `volume24` → Postgres `asset_price_changes.total_volume_usd` (worker-data-refresh-v2 writes this every cycle)
- `liquidity` → Postgres `dex_pairs` table OR DexScreener via Hetzner `worker-dexscreener`
- `marketCap` → Postgres `asset_price_changes.market_cap_usd`
- `priceUSD` → Postgres + Binance fallback

**Audit needed (next session):** read each filterTokens caller and identify which fields it selects. The dominant volume comes from:
- `src/workers/new-token-detector.js:209` — `filterTokens(filters, rankings, limit)` (volume-ranked discovery, definitely selects volume24)
- OVH `packages/server/index.js` ~15 different filterTokens queries (search/screener/trending/details)
- Vercel `apps/research/api/codex.js` (cron `refresh-token-snapshot` + request handlers)
- Vercel cron `/api/cron/refresh-token-snapshot` every 60s (16 seed tokens + trending probe)

**Lockstep verdict (likely):** ELIMINABLE for ingestion paths (new-token-detector, refresh-token-snapshot) because the data is in Postgres. For request paths, partially eliminable but lower volume.

**Savings target:** ~60-80% of 411K = ~250-330K/day. ~20% of bill.

---

## Total projected savings (if all 3 levers land)

| Lever | Today | Saved | After |
|---|---|---|---|
| Dossier kill | 78K | 78K | 0 |
| Candles freq/scope cut | 721K | ~500K | ~220K |
| Lockstep elimination | 411K (lockstep alone) | ~250K | ~160K |
| Other (untouched) | 340K | 0 | 340K |
| **Daily total** | **~1.55M** | **~830K** | **~720K** |

Bill drops by **>50%**, brings you under the Growth 1M plan cap (~720K vs 1M cap), with headroom for growth.

**Combined with flat-rate Codex plan email** (Sunny's task, still pending): residual cost stops being per-call. Final ceiling becomes a fixed monthly number regardless of internal optimization.

---

## What is NOT the fix (and why)

- ❌ **The PROMPT 2 read-path migration to Hetzner /v1/*** — this is for the 1,324 `getTokenBars` calls (chart path), which is <0.1% of bill. Not worth the days of work for that delta. **Postpone or skip.**
- ❌ **Tonight's UDF cache wrap (PR #706)** — already shipped, ~no-op on bill. Leave it (it's still good for correctness and future request-path consistency).
- ❌ **Killing candles-codex entirely** — would break DEX charts for any token not on Binance.
- ❌ **Adding more caches** — caches only help request-path. Bill is ingestion-path.

---

## Account/key context (corrected)

- **One Codex account, one API key.** Sunny verified on dashboard. Earlier "Account A vs B" framing was wrong.
- Key prefix: `950286c4...` (40 chars). Used by Vercel, OVH, Hetzner — all share this key.
- **⚠️ Partial key leak in earlier session:** the first 24 chars (`950286c41c50d499484 3269eb94...`) appeared in terminal output during an `od -c` env inspection. **Sunny should rotate the key tonight as hygiene.** Not actively known to be exploited.
- Codex billing: per-request (success OR failure both billed). Errored calls from the dossier worker are real money.

---

## Key files (next session, read first)

| Purpose | Path |
|---|---|
| Hetzner dossier (new, Postgres-only) | `/Users/sunny/spectre-data-api/src/api/routes/dossier.js` |
| Vercel dossier aggregator | `apps/research/api/_lib/handlers/dossier-proxy.js` |
| OVH stale dossier (the worker to kill) | `packages/server/src/dossier/sources/codex.js` (+ `codex_trending.js`, `codex_events.js`) |
| OVH dossier startup line | `packages/server/index.js:1652-1661` |
| Hetzner candles worker (46% bleeder) | `/Users/sunny/spectre-data-api/src/workers/candles-codex.js` |
| Hetzner candles backfill | `/Users/sunny/spectre-data-api/src/workers/candles-codex-backfill.js` |
| Hetzner Codex service wrapper | `/Users/sunny/spectre-data-api/src/services/codexService.js` |
| Hetzner new-token-detector (filterTokens caller) | `/Users/sunny/spectre-data-api/src/workers/new-token-detector.js` |
| OVH filterTokens callers (lockstep) | `packages/server/index.js` lines 4766, 4846, 5165, 5496, 5639, 5683, 6002, 6042, 6367, 6880 |
| Hetzner ecosystem (97 workers) | `/Users/sunny/spectre-data-api/ecosystem.config.js` |
| Admin metrics endpoint (low-value, undercounts) | `apps/research/api/admin/codex-metrics.js` |
| Admin key (local) | `/tmp/spectre-admin-key` (64-hex value) |

---

## Pending Sunny actions (from earlier session, still open)

1. **Send the Codex flat-rate email** tonight. Draft at `docs/codex-sales-email.md`. Independent of any engineering. Highest structural ask.
2. **Rotate Codex API key** on graph.codex.io. Update Vercel env (`vercel env rm + add CODEX_API_KEY production`), Hetzner `/opt/spectre-data-api/.env`, OVH PM2 ecosystem. Reload all three.
3. **Read Codex dashboard** confirms 1.55M/day — DONE this session.

---

## Handoff prompt for the new session

> Read `docs/codex-cost-war-HANDOFF-2026-06-02-evening.md`. We're picking up at LEVER 1 (dossier kill).
>
> First task: verify whether `DOSSIER_ENABLED=false` on OVH `packages/server/index.js:1652` kills ONLY the workers OR also kills the `/api/dossier` ROUTE. If only the workers: SSH to OVH and flip the env var. If also the route: trading-app frontend callers (`apps/trading/src/components/DossierFeed.jsx`, `useDossier.js`, `DossierStory.jsx`, `LeftPanel.jsx`, `TrendingHub/index.jsx`) need migration to `/api/dossier-proxy` first.
>
> Read-only, no Codex calls during audits. Get Sunny's go-ahead before any deploy.
>
> After Lever 1 lands: move to Lever 2 (candles frequency cut) then Lever 3 (lockstep elimination). Plan in the brief.

---

## Memory updates (Sunny: paste these into auto-memory)

**File:** `~/.claude/projects/-Users-sunny/memory/codex-bill-truth-2026-06-02.md`
```
---
name: Codex bill ground truth 2026-06-02
description: Actual Codex op breakdown from dashboard (not the undercounting admin endpoint)
type: project
---

Codex dashboard (Jun 1 full day): 1.55M ops/day.
  - getBars 721K (46%) — Hetzner candles-codex + candles-codex-backfill workers
  - filterTokens 416K (27%) — discovery workers + request path
  - listPairsWithMetadataForToken 411K (27%) — LOCKSTEP, auto-billed when filterTokens selects volume24/liquidity/pair fields
  - getTokenBars 1,324 — app chart path, negligible
  - Everything else <0.3%

**Why:** Bill is ingestion-dominated, NOT request-path-dominated. PROMPT 2 read-path migration addresses <0.1% of bill. The fixes are at the worker layer.

**How to apply:** Don't trust the codex-metrics-kv admin endpoint — it undercounts ~18x because most Hetzner traffic bypasses it. The Codex dashboard at graph.codex.io is canonical.
```

**File:** `~/.claude/projects/-Users-sunny/memory/feedback_codex_admin_metrics.md`
```
---
name: codex-metrics-kv undercounts ~18x
description: The shared codex-metrics-kv admin endpoint only sees instrumented surfaces — most Hetzner Codex traffic is invisible to it
type: feedback
---

The `/api/admin/codex-metrics` endpoint (Vercel) reads from `codex-metrics-kv` which only tracks calls that pass through code paths calling `trackQuery()`. Hetzner workers like `candles-codex` use their own `codexService.js` wrapper which does NOT push to that KV. Result: admin endpoint shows 84K/day while real dashboard shows 1.55M/day.

**Why:** We learned this the hard way in the 2026-06-02 cost war session. I spent an hour reasoning from the 84K number, web Claude built a migration plan on it, both were wrong. Only when Sunny read the Codex dashboard directly did we see the real shape.

**How to apply:** For any future cost analysis, demand the canonical source first. Codex dashboard > admin endpoint > guesswork.
```

---

## Status when this brief is written

Tasks open from the previous session:
- Task #7 (dossier field-parity audit) — IN PROGRESS, partial findings above
- Task #8 (getBars 721K attribution) — IN PROGRESS, math gap unresolved (144K expected vs 721K actual)
- Task #9 (filterTokens 416K attribution) — NOT STARTED, callers identified above
- Task #10 (lockstep elimination feasibility) — NOT STARTED
- Task #11 (consolidated plan with savings) — partially in this brief

Open PRs: none. Latest deploy: `dpl_5kVov...` (PR #708, READY) — has the UDF cache + admin endpoint.

Open notification: background poll `bz2ke7fav` completed earlier; baseline JSON captured.

---

## One final honesty note

Tonight's session correctly identified the dossier worker as waste, correctly shipped the UDF cache as good hygiene, but **did not move the bill needle**. The actual fixes (Lever 2 + Lever 3) are larger surgery. The bill stops being a fire when those land, not before. Don't let "we shipped 3 PRs" feel like the problem is solved.

The plan in this brief, executed across 1-3 days of careful per-lever work, gets you under the cap. Tonight got us aligned on what to do; doing it is the next session's job.
