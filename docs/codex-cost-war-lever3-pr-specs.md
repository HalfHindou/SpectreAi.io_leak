# Lever 3 — filterTokens Lockstep Elimination PR Specs

**Status:** Spec for review. NO code shipped. Read-only investigation.
**Date:** 2026-06-02
**Author:** backend lead
**Approver gate:** Sunny + Gleb sign-off on this doc before PR drafts open.

---

## TL;DR

Codex bills a `listPairsWithMetadataForToken` op **for every `filterTokens` op whose result-set selects any of:** `volume24`, `liquidity`, `marketCap` (sometimes), `holders`, `txnCount24`, or pair-metadata fields. The June 1 dashboard shows the lockstep is 1:1 — `filterTokens` 416K + `listPairsWithMetadataForToken` 411K = **827K paired ops / day, 54% of the bill**.

Lever 3 = stop selecting those four fields in every `filterTokens` query where the data is recoverable from a non-Codex source (Hetzner Postgres via `/v1/coins/markets`, Vercel KV `cg:snap:<cgId>`, or DexScreener via `dex_pairs`). The `filterTokens` op itself still bills, but the lockstep `listPairsWithMetadataForToken` drops out. Projected daily save: **~330-400K ops, ~21-26% of bill**, on top of Lever 1+2.

---

## A. Lockstep trigger contract (what we know for sure)

| Selection in filterTokens | Triggers listPairs lockstep? |
|---|---|
| `priceUSD` | NO |
| `change1` / `change24` (and friends) | NO |
| `token { address symbol name decimals networkId info { … } createdAt }` | NO |
| `volume24` | **YES** |
| `liquidity` | **YES** |
| `marketCap` | YES (per Codex docs note; conservative assumption) |
| `holders` | **YES** |
| `txnCount24` | **YES** |
| `pair { … }` or `pairs { … }` | YES |

Source: Codex docs + observed 1:1 ratio in dashboard. **A "safe selection"** for Lever 3 is: `token { … }`, `priceUSD`, `change1`, `change24`, `change4`, `change5m`, `createdAt`. Everything else must be backfilled.

---

## B. Backfill source availability (verified on Hetzner 2026-06-02)

SSH `root@204.168.244.18`, `psql` against `$DB_*` from `/opt/spectre-data-api/.env`.

### B1. `asset_price_changes` (Postgres, owned by `worker-data-refresh-v2`)

```
asset                       text       PK
price_usd                   double precision
market_cap_usd              double precision
total_volume_usd            double precision    -- volume24 backfill
market_cap_rank             integer
pct_change_1h               double precision    -- change1
pct_change_24h              double precision    -- change24
pct_change_7d               double precision
pct_change_14d              double precision
pct_change_30d              double precision
high_24h, low_24h           double precision
sparkline_7d                double precision[]
updated_at                  timestamptz default now()
```

**Freshness verified:** `max(updated_at) = 38 seconds ago`, 18,558 rows. `worker-data-refresh-v2` online for 7d, 0 restarts. **Backfill is hot.**

**Gaps vs Codex fields we're dropping:**
- `change4` (4h) — NOT IN this table. Codex-only.
- `change12` (12h) — NOT IN this table. Codex-only.
- `liquidity` — NOT IN this table. See B2.
- `holders` — NOT IN this table. See B3.
- `txnCount24` — NOT IN this table. See B2.

### B2. `dex_pairs` (Postgres, owned by DexScreener worker)

```
pair_address, chain         PK
base_token_address, base_token_symbol
price_usd                   numeric
volume_24h                  numeric      -- alt volume backfill (DEX-side)
liquidity_usd               numeric      -- LIQUIDITY backfill, this is what we need
fdv, market_cap             numeric
txns_buys_24h               integer      -- combine for txnCount24
txns_sells_24h              integer
updated_at                  timestamptz default now()
```

**Freshness verified:** `max(updated_at) = 2m 57s ago`, 2,031 rows. Acceptable for liquidity (changes slowly).

**Surfaced via Hetzner API:** `/v1/scanner/token/{address}` returns liquidity + 24h volume from this table. Aggregated across all pairs for the token. **Use this endpoint, do not direct-query Postgres from OVH/Vercel.**

### B3. Holders availability — partial

Tables exist (`token_holders`, `solana_holders`, `erc20_holders`, `rwa_holders`) but the abstraction endpoint `/v1/token/holders/{chain}/{contract}` returns `status: "not_indexed"` for DAI (a well-known ERC-20). **Coverage is sparse.** For most tokens, Hetzner cannot supply a holder count.

**Verdict:** drop `holders` from the GraphQL selection. UI consumers must either:
1. Read from `/v1/token/holders/{chain}/{contract}` and accept `null` when not indexed (degraded gracefully).
2. Remove the holder count display in `useWatchlistPrices.js:407,409` and `useTrendingTokens.js:68` for paths backed by this.

For Lever 3 PR scope: holders is treated as **opportunistic, may be null**. UI must handle null.

### B4. Vercel KV `cg:snap:<cgId>` (read path B)

Populated by `apps/research/api/cron/refresh-cg-snapshot.js` every 60s, top-500 tokens by mcap. Schema verified by reading cron source:

```js
{
  id, symbol, name, logo,
  price, priceUSD, marketCap, rank,
  volume24,                              // CG total_volume
  circulatingSupply, totalSupply,
  change24, change1h, change7d,          // CG % changes
  ath, athChangePercent, athDate,
  fdv,
  _source: 'cg-snapshot',
  _snappedAt
}
```

**Sub-ms read (KV-local), zero Codex cost. Use this BEFORE Hetzner for any token with a known cgId.**

Gaps: no `change4`, no `change12`, no `liquidity`, no `holders`, no `txnCount24`. Same gaps as B1.

### B5. Hetzner `/v1/coins/markets?ids=...` (CG-shape bulk)

Probed live, 200 OK with `X-API-Key: sk_int_sunny_…`. Returns up to N CG-shape rows in one call. Same superset of fields as B4 but for any cgId (not capped at top-500). Use for **non-top-500** tokens that have a known cgId.

### B6. Hetzner `/v1/scanner/token/{address}` (chain-level)

For tokens identified by address+chain. Returns liquidity (sum across pairs), 24h volume, FDV, holder estimate if available. Use for **DEX-only tokens** that don't have a cgId.

---

## C. Caller inventory — drop/keep decision per callsite

Format: `file:line` · trigger · current selection · safe-to-drop verdict.

### C1. CALLERS ON THE OVH SERVER (`packages/server/index.js`)

#### C1.a — index.js:3084 — search-tokens enrichment (multi-source search)

**Trigger:** `GET /api/search/tokens?q=…` user-facing search.
**Selection today:** `token { name symbol address networkId info { imageThumbUrl } } priceUSD volume24 liquidity marketCap change1 change4` (limit 12).
**Drop verdict:** **YES — safe.** Search results need: price, change for ranking, name/symbol/logo. Volume/liquidity/marketCap are used downstream to sort. We can keep ranking server-side by Codex's own `liquidity` ranking directive (which doesn't materialise the field in the response set per Codex docs — TBD with Codex; if unverified, we keep `liquidity` here, see Risk register R1).
**Fields to keep:** `token { name symbol address networkId info { imageThumbUrl } } priceUSD change1 change4`.
**Fields to drop:** `volume24`, `liquidity`, `marketCap`.
**Backfill source:** For matched results, if `token.address` is recognised as a top-500 cgId via `TOKEN_REGISTRY` reverse-lookup → `cg:snap:<cgId>` (sub-ms). Else → batch call `GET http://204.168.244.18:3850/v1/scanner/token/{address}?chain={chain}` for liquidity + volume24. Marketcap = `price * circulatingSupply` (already computed locally in 4 other handlers in the same file).
**Downstream callers:**
- `apps/research/src/services/codexApi.js` `searchTokens()` consumers
- Header search bar (`apps/research/src/components/header.jsx` via `useTokenSearch`)
- Sort key is `liquidity DESC` server-side, response is returned in that order — frontend doesn't re-sort.
**Shape parity contract:** add `volume24`, `liquidity`, `marketCap` to the response via the backfill pass; downstream sees identical shape.
**Risk:** **medium.** Search ranking; if `liquidity` ranking on Codex side becomes "select-required," we leave it. See R1.
**Test plan:**
- `curl 'http://srv.spectreai.io/api/search/tokens?q=bonk'` — verify `volume24`/`liquidity`/`marketCap` populated.
- `curl 'http://srv.spectreai.io/api/search/tokens?q=pepe'` — same.
- UI: open header search, type "bonk", verify rank order matches today's prod.

#### C1.b — index.js:4766 — token-resolve fallback (DEX lookup)

**Trigger:** `GET /api/token/resolve?symbol=…` for unknown symbols.
**Selection today:** `token { address symbol name networkId } priceUSD` (limit 5, ranked by liquidity DESC).
**Drop verdict:** **N/A — already minimal.** Already drops volume24/liquidity/marketCap. **Confirm this is NOT triggering lockstep** by inspecting Codex billing logs; ranking-only selection per Codex docs does NOT bill lockstep. **No change needed.**

#### C1.c — index.js:4846 — `/api/token/details` (token detail page banner)

**Trigger:** `GET /api/token/details?address=…&networkId=…` — token detail page on app.spectreai.io.
**Selection today:** `priceUSD volume24 liquidity marketCap change24 change1 change4 change12 holders txnCount24 createdAt token { createdAt }` (limit 1).
**Drop verdict:** **YES — safe, with backfill.** This is the hot path. Verified frontend consumers: `apps/research/src/services/codexApi.js:131,132,135,231,290,326,328,440,494,495,711-720` and `apps/research/src/hooks/useWatchlistPrices.js:407,409,743,761`.
**Fields to keep:** `priceUSD change1 change24 createdAt token { createdAt }`.
**Fields to drop:** `volume24, liquidity, marketCap, change4, change12, holders, txnCount24`.
**Backfill source per field:**
- `volume24` → if `cgId = TOKEN_REGISTRY[address+net].coingeckoId`, read `cg:snap:<cgId>.volume24`. Else `GET http://204.168.244.18:3850/v1/scanner/token/{address}?chain={chain}` → `.data.market.volume_24h_usd`.
- `liquidity` → `GET http://204.168.244.18:3850/v1/scanner/token/{address}?chain={chain}` → `.data.market.liquidity_usd`. No KV path (CG doesn't have liquidity).
- `marketCap` → if `cg:snap` hit, `.marketCap`. Else compute `priceUSD * token.info.circulatingSupply` locally (already the fallback at line 4892).
- `change4` → if `cg:snap` hit, **no field, return 0**. Else `GET http://204.168.244.18:3850/v1/coins/{cgId}` → `.market_data.price_change_percentage_4h_in_currency.usd` if present (NOT GUARANTEED). If unavailable → drop to UI as `0` / `null`. **UI consumers must accept null/0.**
- `change12` → same as change4. UI accepts null/0.
- `holders` → `GET http://204.168.244.18:3850/v1/token/holders/{chain}/{contract}` → `.data.count` if `status !== "not_indexed"`. Else `null`.
- `txnCount24` → from `/v1/scanner/token/{address}` → `.data.market.txns_24h_total` (sum of `txns_buys_24h + txns_sells_24h` from `dex_pairs`).

**Downstream callers / consumers (the must-not-break list):**
- `apps/research/src/pages/token/components/banner.jsx` — reads `volume24`, `liquidity`, `marketCap` from `/api/token/details`.
- `apps/research/src/pages/token/components/data-tabs.jsx` — reads `holders`, `txnCount24`.
- `apps/research/src/hooks/useTokenDetails.js`
- `apps/research/src/services/codexApi.js` lines 290, 326-328, 440, 494-495.
- `apps/trading/src/hooks/useCodexData.js:1378-1388, 1418-1427` (trade.spectreai.io token page).
- `apps/research/src/hooks/useWatchlistPrices.js:407-409, 743` (watchlist columns).
- `apps/research/src/hooks/codex/useTrendingTokens.js:68` (trending grid holders display).

**Shape parity contract:** every dropped field appears in the response as a populated value (from backfill) OR `null`/`0` if backfill failed. NO field name changes. Frontend tolerates `0`/`null` (verified: `parseFloat(market?.volume24) || 0` pattern is universal).

**Risk:** **medium-high.** Token detail page is the most-rendered shape in the app. Liquidity is most likely to differ slightly between Codex (live DEX) and DexScreener (3-min stale). Acceptable per Sunny's spec (38s + 180s freshness limits).

**Test plan:**
- `curl 'http://srv.spectreai.io/api/token/details?address=0x6b175474e89094c44da98b954eedeac495271d0f&networkId=1' | jq` — DAI. Verify volume24/liquidity/marketCap/change4 populated.
- Same for BONK (`5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC`, networkId 1399811149).
- Same for PEPE.
- UI smoke: app.spectreai.io/token, click DAI → banner renders all numbers, holders tab loads.

#### C1.d — index.js:5165 — `/api/tokens/details/batch` (watchlist refresh)

**Trigger:** `POST /api/tokens/details/batch` body `pairs: [{address, networkId}…]` — fired by `useWatchlistPrices` every 30s while watchlist tab is visible.
**Selection today:** `token { address symbol name networkId createdAt info { imageThumbUrl imageLargeUrl circulatingSupply } } priceUSD volume24 liquidity marketCap change24 change1 change4 change12 holders txnCount24` (limit 100).
**Drop verdict:** **YES — safe.** Same backfill plan as C1.c, but bulk.
**Fields to keep:** `token { … } priceUSD change1 change24`.
**Fields to drop:** `volume24, liquidity, marketCap, change4, change12, holders, txnCount24`.
**Backfill source:**
- Phase 1: bulk read `cg:snap:<cgId>` via `_kvGetJson` for the subset with known cgIds. (Already 95%+ hit rate per memory.)
- Phase 2: for remaining, **one** `GET http://204.168.244.18:3850/v1/coins/markets?ids=<comma-list>` call (bulk Hetzner). Returns the CG-shape rows.
- Phase 3: for tokens still missing (DEX-only), **one** parallel batch of `GET /v1/scanner/token/{address}?chain={chain}` calls (max 10 parallel, address-only).
- For `change4`/`change12` → universal `0` if absent (UI tolerates).
- For `holders` → null if `not_indexed`.

**Downstream callers:**
- `useWatchlistPrices.js` (the main watchlist hook for both apps)
- `useTrendingTokens.js` for the trending grid
- Token strip on welcome page

**Shape parity contract:** unchanged. Same dictionary keyed by lowercased address.
**Risk:** **medium.** Watchlist refresh is fan-out heavy. Backfill must not blow up if Hetzner is slow — use `AbortSignal.timeout(2500)` per backfill call, fail soft per token.
**Test plan:**
- `curl -X POST -H 'Content-Type: application/json' -d '{"pairs":[{"address":"0x6b175474e89094c44da98b954eedeac495271d0f","networkId":1}]}' 'http://srv.spectreai.io/api/tokens/details/batch'`
- UI: open watchlist, verify token volume / liquidity / market cap cells populate within ~3s of mount.

#### C1.e — index.js:5496 / 5639 — `/api/tokens/search` market-data merger (`address+phrase` paths)

**Trigger:** `GET /api/tokens/search?q=…` — internal search endpoint used by `useTokenSearch`.
**Selection today (5496):** `priceUSD change24 volume24 liquidity marketCap` (post-search per-token market-data merge call).
**Selection today (5639):** `priceUSD volume24 liquidity marketCap change24 holders` (popular-Solana branch).
**Drop verdict:** **YES — safe.** Search ranking is upstream; this is the per-result enrichment.
**Fields to keep:** `priceUSD change24` (5496) / `priceUSD change24` (5639).
**Fields to drop:** `volume24, liquidity, marketCap, holders`.
**Backfill source:** same as C1.c for the result address. For the popular-Solana branch, cgId mapping is known → `cg:snap:<cgId>` hits.
**Downstream callers:** same as C1.a search consumers.
**Shape parity contract:** unchanged. `volume`, `liquidity`, `marketCap` keys populated by backfill or `0`.
**Risk:** **low.** Per-result fan-out, but limited to typically 5-12 results per search.
**Test plan:** identical to C1.a.

#### C1.f — index.js:5683 — `/api/tokens/search` phrase search (main search ranking)

**Trigger:** same handler, this is the main ranking query.
**Selection today:** `token { … } volume24 liquidity marketCap priceUSD change24 holders` (limit varies).
**Drop verdict:** **YES — safe, with caveat (see R1).**
**Fields to keep:** `token { … } priceUSD change24` + Codex `rankings: [{ attribute: liquidity, direction: DESC }]` (ranking attr does NOT need to be selected; verify in pilot — R1).
**Fields to drop:** `volume24, liquidity, marketCap, holders`.
**Backfill source:** per result, same chain as C1.a. Bulk read `cg:snap:<cgId>` for known IDs, else parallel `/v1/scanner/token/{address}` calls.
**Downstream callers:** same as C1.a/e.
**Shape parity:** unchanged.
**Risk:** **medium.** If Codex requires `liquidity` field selection to support `liquidity` ranking, this PR pilot uncovers that. Roll back this callsite only if so (others unaffected).
**Test plan:** `curl 'http://srv.spectreai.io/api/tokens/search?q=usd&limit=20'` — verify ranking matches prod.

#### C1.g — index.js:6002 — `/api/token/market-profile` (WELL_KNOWN_TOKENS path)

**Trigger:** `GET /api/token/market-profile?symbol=…` for major tokens (BTC, ETH, etc.).
**Selection today:** `token { address symbol name networkId } priceUSD change24 change1 change4 change12 volume24 marketCap liquidity` (limit 1).
**Drop verdict:** **YES — safe and easy.** WELL_KNOWN_TOKENS by definition have cgIds.
**Fields to keep:** `token { … } priceUSD change1 change24`.
**Fields to drop:** all market fields.
**Backfill source:** `cg:snap:<cgId>` always — these ARE the top tokens. Zero Hetzner fallback needed in 99% of cases.
**Downstream callers:** dossier / token banner for major tokens, `monarch-chat` price tool.
**Shape parity:** unchanged.
**Risk:** **low.**
**Test plan:** `curl 'http://srv.spectreai.io/api/token/market-profile?symbol=BTC'`.

#### C1.h — index.js:6042 — `/api/token/market-profile` (phrase-search fallback)

**Trigger:** same handler, when symbol is NOT in WELL_KNOWN_TOKENS.
**Selection today:** `token { … } priceUSD change24 volume24 marketCap liquidity holders`.
**Drop verdict:** **YES — safe.** Same plan as C1.f.
**Fields to keep:** `token { … } priceUSD change24`.
**Fields to drop:** `volume24, marketCap, liquidity, holders`.
**Backfill source:** for top result address, `/v1/scanner/token/{address}` call. The scoring function `getScore()` at L6060 uses `liquidity` + `volume24` + `marketCap` + `holders` — **scoring must move into the backfill stage** (run AFTER backfill, not before). Sort the merged set.
**Downstream callers:** monarch / dossier / chat tools.
**Shape parity:** unchanged.
**Risk:** **medium.** Scoring relocation must be exact. Pilot one symbol.
**Test plan:** `curl 'http://srv.spectreai.io/api/token/market-profile?symbol=BONK'` — compare scoring order before/after.

#### C1.i — index.js:6367 — `/api/tokens/trending` (TRENDING ENDPOINT)

**Trigger:** `GET /api/tokens/trending?limit=…&networks=…` — homepage trending grid + watchlist suggestions.
**Selection today:** `token { … } volume24 liquidity marketCap priceUSD change24 change12 change4 change1 change5m createdAt` (limit 200, ranked by `volume24 DESC`).
**Drop verdict:** **PARTIAL — defer to Lever 3.5.** Trending intentionally ranks by `volume24 DESC` and the response is scored by `calculateTrendingScore()` which reads `volume24`, `liquidity`, `marketCap` for the score formula. **This is the highest-volume single callsite (1 cron-ish call per network, every ~minute).** Removing the selection here doesn't help because Codex needs the rank attribute and the score function needs the value.

**Lever 3 decision:** **keep this callsite as-is.** Address in Lever 3.5 with one of:
- Move scoring to use `cg:snap` snapshot fields (top-500 only).
- Switch the rank attribute to `change24` or `txnCount24` if Codex's lockstep ignores those (TBD with Codex).
- Replace the call entirely with a Hetzner read: `GET /v1/market/trending` or derive from `cg:snap:_all`.

**Note:** the equivalent Vercel handler (`apps/research/api/codex.js:1200` `handleTrending`) is already KV-snapshot-first (see C2.b). Use that pattern as the template for the OVH cutover in 3.5.

#### C1.j — index.js:6880 — `/api/bars` Tier 1.5 symbol discovery

**Trigger:** when `/api/bars?symbol=X` is called for a symbol not in `token-registry.js`.
**Selection today:** `token { address symbol name networkId } priceUSD` (limit 5).
**Drop verdict:** **N/A — already minimal.** No change.

---

### C2. CALLERS ON VERCEL (`apps/research/api/`)

#### C2.a — cron/refresh-token-snapshot.js:105 — KV-snapshot cron

**Trigger:** Vercel cron, every 60s. Populates `codex:snap:<addr:net>` KV.
**Selection today:** `token { address symbol name networkId createdAt info { imageThumbUrl imageLargeUrl circulatingSupply } } priceUSD volume24 liquidity marketCap change24 change1 change4 change12 holders txnCount24` (limit = `tokens.length` up to 200).
**Drop verdict:** **THIS IS THE MOST IMPORTANT ONE.** Runs forever, 1440 ticks/day. Every tick currently bills 2 ops via lockstep = 2,880 ops/day from this cron alone. Killing the lockstep saves 1,440 ops/day from one callsite.
**Fields to keep:** `token { … } priceUSD change1 change24`.
**Fields to drop:** `volume24, liquidity, marketCap, change4, change12, holders, txnCount24`.
**Backfill source:** **don't backfill — kill the cron entirely** and rely on `cg:snap` cron (which already covers top-500, and the seed list for this cron is 16 tokens that overlap with top-500). The few non-CG-mapped addresses that need this cron should be migrated to read from Hetzner `/v1/coins/markets?ids=` on read-path miss.
**Downstream callers:**
- `codex.js` `_readSnapshotBatch()` reads `codex:snap:<addr:net>`.
- If `codex:snap` doesn't exist, code already falls through to live Codex call.

**Alternative (less invasive):** keep cron, just shrink selection — bills 1 op/tick instead of 2 → saves 1,440 ops/day. KV consumers must tolerate missing fields and fall back to `cg:snap` or Hetzner on read.

**Shape parity:** the `codex:snap:` KV entries lose `volume24, liquidity, marketCap, change4, change12, holders, txnCount24`. Readers in `codex.js _readSnapshotBatch()` MUST be updated to fall back to `cg:snap` then Hetzner for those fields.
**Risk:** **medium.** The cron has been the reliability backbone for hot tokens for months. Recommend "shrink first, kill later." First PR: shrink. Second PR (out of scope): kill.
**Test plan:**
- Trigger cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" 'https://app.spectreai.io/api/cron/refresh-token-snapshot'`.
- Inspect a KV entry: `vercel env pull` → use kv CLI to `GET codex:snap:0x6b1...:1`.
- Probe `/api/codex?action=tokenDetailsBatch&pairs=…` and confirm response shape unchanged.

#### C2.b — codex.js:410 — `handleTokenDetailsBatch` snapshot-miss live path

**Trigger:** `GET /api/codex?action=tokenDetailsBatch` when cache misses.
**Selection today:** `token { address symbol name networkId createdAt info { imageThumbUrl imageLargeUrl circulatingSupply } } priceUSD volume24 liquidity marketCap change24 change1 change4 change12 holders txnCount24` (limit 200).
**Drop verdict:** **YES — safe.** Mirror of C1.d, on Vercel.
**Fields to keep / drop:** identical to C1.d.
**Backfill source:** same triple-tier (KV → `/v1/coins/markets` → `/v1/scanner/token/{address}`). Helper lives in new `apps/research/api/_lib/spectre-data.js`.
**Downstream callers:** `apps/research/src/services/codexApi.js` `getTokenDetailsBatch()`.
**Shape parity:** identical to C1.d.
**Risk:** **medium-high.** Same hot path on the Vercel side.
**Test plan:** `curl 'https://app.spectreai.io/api/codex?action=tokenDetailsBatch&pairs=0x6b175474e89094c44da98b954eedeac495271d0f:1'`.

#### C2.c — codex.js:670 — `handleTokenInfo` market query

**Trigger:** `GET /api/codex?action=tokenInfo&address=…` — single token detail.
**Selection today:** `priceUSD volume24 liquidity marketCap change24 change1 change4 change12 holders txnCount24`.
**Drop verdict:** **YES.** Same as C1.c.
**Fields to keep:** `priceUSD change1 change24`.
**Fields to drop:** all market fields.
**Backfill source:** same.
**Downstream callers:** `useTokenDetails` / `useCodexData`.
**Test plan:** `curl 'https://app.spectreai.io/api/codex?action=tokenInfo&address=0x6b1...&networkId=1'`.

#### C2.d — codex.js:752 — `fetchSolanaToken` (popular Solana lookup)

**Trigger:** when search query matches `POPULAR_SOLANA_TOKENS` map.
**Selection today:** `token { address symbol name networkId info { … } } priceUSD volume24 liquidity marketCap change24 holders` (limit 1).
**Drop verdict:** **YES.** These tokens are in `WELL_KNOWN_TOKENS` and have cgIds.
**Fields to keep:** `token { … } priceUSD change24`.
**Fields to drop:** `volume24, liquidity, marketCap, holders`.
**Backfill source:** `cg:snap:<cgId>` is guaranteed hit for these.
**Risk:** **low.**

#### C2.e — codex.js:879 — `handleSearch` EVM+Solana parallel search

**Trigger:** `GET /api/codex?action=search&q=…` — token search.
**Selection today:** `token { … } priceUSD volume24 liquidity marketCap change24 holders` (limit 30 EVM + 20 Solana).
**Drop verdict:** **YES.** Same as C1.f.
**Fields to keep:** `token { … } priceUSD change24`.
**Fields to drop:** `volume24, liquidity, marketCap, holders`.
**Backfill source:** parallel `/v1/scanner/token/{address}` for top-N results post-filter.
**Risk:** **medium** (same as C1.f, ranking attr).

#### C2.f — codex.js:1202 — `handleTrending` 7-page paginated

**Trigger:** `GET /api/codex?action=trending` when KV cache miss.
**Selection today:** `token { … } volume24 liquidity marketCap priceUSD change24 change12 change4 change1 change5m createdAt` (limit 200 × 7 pages).
**Drop verdict:** **DEFER to Lever 3.5** for the same reason as C1.i — score function needs these fields, ranking attribute is `volume24`. Out of scope for Lever 3 PR.

#### C2.g — codex.js:1383 — `handleTokenPrices` batch-by-address

**Trigger:** `GET /api/codex?action=tokenPrices&symbols=…` — bulk price lookup.
**Selection today:** `token { address symbol name networkId } priceUSD change24` (limit 50).
**Drop verdict:** **N/A — already minimal.** This query DOES NOT trigger lockstep (selection has no `volume24`/`liquidity`/etc.). **No change.**

#### C2.h — codex.js:1424 — `handleTokenPrices` unknown-symbol phrase fallback

**Trigger:** when symbol isn't in `WELL_KNOWN_TOKENS`.
**Selection today:** `token { symbol address } priceUSD change24 liquidity` (limit 5).
**Drop verdict:** **YES — small win.**
**Fields to keep:** `token { … } priceUSD change24`.
**Fields to drop:** `liquidity`.
**Backfill:** liquidity not needed downstream — caller uses it ONLY to filter `liquidity >= 1000`. Replace the filter with: take top result by priceUSD existence, then validate via `/v1/scanner/token/{address}` if downstream cares. For the price-only use case (Monarch chat lookups), liquidity filter can be dropped entirely.
**Risk:** **low.**

#### C2.i — token-resolve.js:72 — Vercel `/api/token-resolve`

**Trigger:** `GET /api/token-resolve?symbol=…` (handler-level resolver).
**Selection today:** `filterTokens(phrase: $phrase, limit: 5) { results { token { … } priceUSD … } }` (need to inspect line 72 — see below).
**Drop verdict:** **likely YES.** Same as C1.b — already minimal at this level. Read the file to confirm exact selection in PR draft.

#### C2.j — _lib/handlers/search-api.js:92 — search-api Codex enrichment

**Trigger:** `/api/search?q=…` user-facing search API.
**Selection today:** `token { name symbol address networkId info { imageThumbUrl } } priceUSD volume24 liquidity marketCap change1 change4`.
**Drop verdict:** **YES.** Mirror of C1.a.
**Fields to drop:** `volume24, liquidity, marketCap`.
**Backfill:** post-result, `/v1/scanner/token/{address}` per top result OR drop volume/liquidity/marketCap from response shape if frontend tolerates `null`. Search UI uses these for sorting + display in result rows.

#### C2.k — _lib/handlers/onchain-path.js:470 — onchain DEX search fallback

**Trigger:** `/api/onchain-path?route=search&q=…&chain=…` when DexScreener is empty.
**Selection today:** `token { … } volume24 liquidity priceUSD change24` (rankings volume24 DESC).
**Drop verdict:** **YES.**
**Fields to drop:** `volume24, liquidity`.
**Backfill:** `/v1/scanner/token/{address}` per result.

#### C2.l — _lib/handlers/onchain-path.js:498 — onchain top-N fallback

**Trigger:** `/api/onchain-path?route=top&chain=…&sort=…` fallback.
**Selection today:** `token { … } volume24 liquidity priceUSD change24 change1 change4 change12 marketCap`.
**Drop verdict:** **YES.**
**Fields to drop:** `volume24, liquidity, marketCap, change4, change12`.
**Backfill:** bulk `/v1/coins/markets` for the result set when cgIds are derivable; else per-token `/v1/scanner/token`.

#### C2.m — _lib/handlers/tradingview-udf.js:559 — symbol discovery for chart bars

**Trigger:** TradingView chart loading an unknown symbol.
**Selection today:** `token { address symbol name networkId } priceUSD` (limit 5).
**Drop verdict:** **N/A — already minimal.** No change.

#### C2.n — admin/codex-metrics.js — observability handler

**Drop verdict:** **N/A — read-only metric handler, doesn't call Codex.**

---

## D. PR-Vercel scope summary

**Files modified:**
1. `apps/research/api/codex.js` — 4 callsite edits (C2.b, C2.c, C2.d, C2.e, C2.h) + read-path fallback updates in `_readSnapshotBatch()` to backfill missing fields.
2. `apps/research/api/cron/refresh-token-snapshot.js` — 1 callsite edit (C2.a, shrink-not-kill).
3. `apps/research/api/_lib/handlers/search-api.js` — 1 callsite edit (C2.j).
4. `apps/research/api/_lib/handlers/onchain-path.js` — 2 callsite edits (C2.k, C2.l).

**Files created:**
5. `apps/research/api/_lib/spectre-data.js` — new shared helper. Exports:
   - `getMarketDataForAddresses(pairs)` → triple-tier lookup (KV cg:snap → Hetzner /v1/coins/markets → Hetzner /v1/scanner/token).
   - `getMarketDataForAddress(address, networkId)` — single.
   - `getHoldersForAddress(address, chain)` → returns count or null.
   - Returns the dropped-field bundle: `{ volume24, liquidity, marketCap, change4, change12, holders, txnCount24 }`.
   - Internal: `AbortSignal.timeout(2500)`, retry once, fail-soft per-field.

**LOC estimate:** ~250 added (new helper), ~150 modified (callsite edits). Net ~+150 LOC.

**Env vars / KV keys that must exist:**
- `SPECTRE_API_BASE` (already in Vercel env? need to verify) — must be set to `http://204.168.244.18:3850`. Per MEMORY.md it may not be; **action: confirm in Vercel dashboard before PR opens**.
- `SPECTRE_DATA_API_KEY` (per env) — verify set in Vercel.
- KV `cg:snap:<cgId>` — already populated, verified live.
- KV `codex:snap:<addr:net>` — exists, will continue to exist (shrunk shape).

**Intentions (not actual diff yet):**
- Per callsite: remove `volume24 liquidity marketCap change4 change12 holders txnCount24` from the GraphQL selection. Keep `token { … } priceUSD change1 change24 createdAt`.
- After Codex query returns, call `getMarketDataForAddresses(results.map(r => r.token))` from the new helper.
- Merge results back into the response shape (existing parseFloat/parseInt logic stays).
- Update `_readSnapshotBatch` in codex.js to call the same helper for snapshot misses' market fields.

## E. PR-OVH scope summary

**File modified:**
1. `packages/server/index.js` — 8 callsite edits (C1.a, C1.c, C1.d, C1.e, C1.f, C1.g, C1.h, plus the trivial C1.b/j confirmed no-op).

**Files created:**
2. `packages/server/lib/spectre-data.js` — new shared helper, parallel implementation to D5. Imports/exports identical signatures. Reads from Hetzner direct origin only (no Vercel KV available from OVH).

**LOC estimate:** ~180 added (helper), ~250 modified (callsite edits). Net ~+170 LOC. **Edited via Bash + python write (file watcher reverts the Edit tool — verified in memory).**

**Env vars that must be set on OVH PM2:**
- `SPECTRE_API_ORIGIN=http://204.168.244.18:3850` — **CRITICAL per memory, currently unset, causes 502s elsewhere**. This Lever 3 PR cannot work without this env. **Hard pre-req. Verify with Gleb before shipping.**
- `SPECTRE_DATA_API_KEY=<internal key>` — must be propagated.

**Intentions (not actual diff yet):**
- Same selection-shrink + backfill pattern as Vercel.
- Backfill caller signature: `getMarketDataForAddresses([{ address, networkId, cgId? }])` → `Map<address.toLowerCase(), { volume24, liquidity, marketCap, change4, change12, holders, txnCount24 }>`.
- Helper uses `safe-fetch.js` (already in `packages/server/lib/`) with timeout=2500ms, retry once.
- For C1.h (`/api/token/market-profile` phrase search) the `getScore()` ranking function must move POST-backfill — minor refactor.

## F. Shared helper plan

Two parallel files, NOT one shared:

```
apps/research/api/_lib/spectre-data.js     (Vercel side — uses KV cg:snap first)
packages/server/lib/spectre-data.js         (OVH side — no KV, Hetzner only)
```

**Why not shared:** Vercel has access to KV `cg:snap` (sub-ms read), OVH does not. The Vercel helper saves 100-200ms per call by hitting KV first for top-500 tokens. OVH can only hit Hetzner. Shared module would force OVH to either: (a) include the @vercel/kv client (won't work — no env), or (b) always skip the fast path. Splitting is simpler and the implementations diverge in exactly one place (the KV tier).

**API parity:** both helpers expose the same function signatures and return shapes. Future migration to a single shared package (`packages/server-shared/`) is possible but out of scope.

## G. Rollout sequence

**Order: Vercel first, OVH second.** Reasoning: Vercel handlers serve the trading app and most of research app's prod traffic. OVH is dev + a few legacy direct paths. Validate the backfill helper end-to-end against the more rigorous test target.

**Step 1 — Vercel PR (3-5 day soak)**

1. Open PR `claude/codex-lever3-vercel` → `main`.
2. Pre-flight: confirm `SPECTRE_API_BASE` env is set in Vercel production. If not, add it; trigger re-deploy.
3. Land PR. Vercel auto-deploys. Verify deploy status (per memory: Vercel sometimes silently blocks — check dashboard).
4. **Verification (immediate after deploy):**
   - `curl https://app.spectreai.io/api/codex?action=tokenDetailsBatch...` returns full shape.
   - Open app.spectreai.io/token (DAI). Banner shows volume, liquidity, mcap. Holders tab loads.
   - Open trade.spectreai.io. Token detail loads.
   - Header search returns ranked results.
   - Trending grid loads (Lever 3 leaves trending unchanged — verify it still works since the cron-snapshot shape shrank).
5. **24h soak.** Watch Codex dashboard for the `listPairsWithMetadataForToken` line. Expect ~20-25% drop within 24h.
6. **3-5 day soak.** Catch any tail-frequency consumers we missed.

**Step 2 — OVH PR (after Vercel soak clears)**

1. Pre-flight: confirm `SPECTRE_API_ORIGIN` + `SPECTRE_DATA_API_KEY` set in OVH PM2 ecosystem.
2. Open PR `claude/codex-lever3-ovh` → `main`.
3. Apply via Bash + python write (file-watcher constraint).
4. `pm2 reload spectre-server` on OVH.
5. **Verification:** same curl probes against `srv.spectreai.io`. Same UI flows (which route through OVH on dev or specific prod paths).
6. **24h soak.** Watch dashboard. Expect another 15-20% drop in lockstep.

**Total expected impact after both ship:** ~330-400K ops/day saved. Brings bill from ~1.55M to ~1.15M (combined with Lever 1+2: ~720K).

## H. Pre-flight verifications needed from Sunny/Gleb

**HARD BLOCKERS — Lever 3 cannot ship without:**

1. **OVH PM2 env: `SPECTRE_API_ORIGIN=http://204.168.244.18:3850`** — required so backfill calls bypass Cloudflare. Per MEMORY.md task #11 this has been pending. Confirm with `pm2 env spectre-server` on OVH. **Source of truth: Gleb.**

2. **OVH PM2 env: `SPECTRE_DATA_API_KEY=sk_int_<…>`** — confirm propagated (master keys minted 2026-05-13 per memory, the OVH process needs one). If not, ask Sunny for an internal key for the OVH process or mint a new one with `tier=internal`.

3. **Vercel production env: `SPECTRE_API_BASE` (or equivalent) → `http://204.168.244.18:3850`** — per `apps/research/api/_lib/handlers/extended-proxy.js` which still defaults to CF-blocked `https://api.spectreai.io`. Verify in Vercel dashboard.

4. **Vercel production env: `SPECTRE_DATA_API_KEY` (or `SPECTRE_API_KEY`)** — internal key for read-side calls.

5. **Active Codex key on Vercel + OVH:** `950286c4…` per handoff brief. Verify Hetzner still uses the broken 403 key (which we are intentionally NOT touching). If Hetzner key is rotated, the entire bill attribution shifts.

**Soft verification (nice-to-have):**

6. **Codex docs / support:** does ranking-by-attribute require selecting the attribute? If `rankings: [{ attribute: liquidity, direction: DESC }]` works WITHOUT selecting `liquidity` in the result set, then C1.f / C2.e dropped fields are clean. If it errors, we keep `liquidity` selected for those two (degraded savings — see R1).

7. **Verify lockstep actually drops** by sampling Codex dashboard 24h after Vercel PR ships. If lockstep doesn't proportionally drop, our trigger-field assumption is wrong and we need to re-audit which fields actually trigger.

## I. Risk register (top 5 by likelihood × blast radius)

| # | Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|---|
| **R1** | Codex `rankings: liquidity` requires selecting `liquidity`. If true, the dropped-field plan for search ranking (C1.a, C1.f, C2.e, C2.j, C2.k) reverts — savings drop from ~26% to ~18%. | medium | medium (search ranking degrades to default Codex order if we mis-handle) | Pilot: ship one search callsite (C1.a) first, observe Codex response shape + bill behavior 24h. If clean, proceed. If error/degraded ranking, keep `liquidity` selected for ranking-active queries only. |
| **R2** | Backfill latency adds 100-300ms to `/api/token/details` and `/api/tokens/details/batch` on every cold-cache call. Token detail page render time regresses. | high | medium (UX, not correctness) | (a) KV `cg:snap` is sub-ms for top-500. (b) Parallelize Hetzner backfill (Promise.allSettled, max 10 concurrent). (c) Cache backfill results in existing `cache.details` Map (same 15s TTL). (d) Set `AbortSignal.timeout(2500)`. (e) UI tolerates `null` (degraded — render as `—` not zero — verify in PR review). |
| **R3** | `dex_pairs` is 3 min stale. Liquidity numbers drift from prod. For a fast-moving token (e.g., a launch on the day), the 3-min lag is visible. | medium | low (numerical drift, not breakage) | Acceptable per Sunny's brief ("fresh enough"). Long-term: cut DexScreener worker cadence to 60s. Out of scope for Lever 3. |
| **R4** | OVH file-watcher reverts edits to `packages/server/index.js`. Lever 3 OVH PR partially lands then silently reverts during deploy. | medium | high (deploy looks green but field still selected → no bill drop) | Use `python -c "open('...','w').write(...)"` write per MEMORY. After deploy, smoke-test by `curl srv.spectreai.io/api/token/details/?…` and grep for `liquidity` in the response payload — if it's `0` for every token, the helper didn't run (lever 3 reverted). |
| **R5** | Vercel KV reaches eviction limit. `cg:snap:<cgId>` entries get evicted mid-day → cold-path hits Hetzner per request, latency spikes. | low | medium | Verify KV quota in Vercel dashboard. Current: 500 keys × ~600 bytes ≈ 300 KB, well under any tier. But warm-load all 500 keys on cron tick (already done). If quota becomes a concern, fall through to Hetzner gracefully. |

**Honorable mentions (not in top-5 but worth noting):**
- **R6:** Holders field becomes universally `null` for non-indexed tokens. Token detail page "Holders" tab shows empty state. **Acceptable** — already null for most low-cap tokens in current behavior.
- **R7:** Codex bills the `filterTokens` call even when our selection is now "safe." We save the lockstep half (411K) but the 416K `filterTokens` line stays. **Expected and OK** — this is exactly the 50% lockstep elimination we promised.
- **R8:** Watchlist refresh (`/api/tokens/details/batch`) fans out 50-100 backfill calls. If Hetzner is slow at peak, watchlist page never finishes loading. **Mitigation:** Promise.allSettled with timeout per call, render partial data, retry missing entries on next 30s tick.

---

## J. Final note

Lever 3 is surgical and high-leverage. The mechanical change is small (selection-set shrink + helper). The execution risk lives in (a) the backfill helper correctness and (b) the OVH file-watcher revert footgun.

The spec is sized for two PRs: Vercel first (lower-risk validation), OVH second. Both rest on the same `spectre-data.js` helper, kept as two parallel files to avoid the KV-vs-no-KV split.

**Approval gate:** confirm pre-flights H1–H5 and the R1 pilot strategy. On green light, draft PR1 (Vercel) and ship for 3-5 day soak before PR2 (OVH).
