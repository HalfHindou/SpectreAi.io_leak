---
paths:
  - "apps/research/src/services/**"
  - "apps/research/src/hooks/**"
  - "apps/research/api/**"
  - "packages/server/**"
---

# API Optimization Plan — Research App + Server

**Created:** 2026-06-16
**Status:** AUDIT COMPLETE — execution pending (report-first; no code changed yet)
**Owner:** Evgeniy
**Scope:** Every user-accessible research-app page + the shared frontend data layer + the shared Express/serverless endpoints those pages call. Goal: kill request waterfalls, dedupe repeated fetches, extend caching, defer below-the-fold boot calls, and trim oversized payloads.

> Companion to `performance-smoothness-plan.md` (which covers scroll/render/GPU smoothness + bundle weight). This doc is the **network/API** side. Where the two overlap (A7/A8 boot deferral, H7 top-coins dedup, H9-H13 polling) this doc supersedes with verified-against-current-code findings.

---

## A. Method & Scope

8 read-only audit agents traced `index.jsx → components → hooks → services → endpoint` for each page, on 8 axes: on-mount requests, waterfalls, duplicate fetches, cache gaps, polling guards, payload bloat, boot deferral, parallelism.

**Pages audited (user-accessible only — excludes admin / dev / marketing / Coming-Soon-gated):**

| Cluster | Pages |
|---|---|
| Home / overview | `/` home, `/gm-dashboard`, `/fear-greed`, `/categories` |
| Token data | `/token`, `/research-zone`, `/dossier`, `/watchlists`, `/user-dashboard` |
| Discovery / viz | `/heatmaps`, `/bubbles`, `/potential-gainers`, `/tokenized-assets`, `/zigchain` |
| Social / X | `/x-dash` (+subroutes), `/x-intelligence`, `/lens`, `/alerts` |
| Content / AI | `/intelligence` (+article), `/news`, `/newsroom`, `/ai-charts`, `/ai-media-center`, `/traders-corner` |
| Tools / misc | `/economic-calendar`, `/roi-calculator`, `/ventures`, `/private-markets`, `/predictions`, `/monarch-chat` |
| Cross-cutting | shared data layer (services + hooks), server/serverless endpoints |

**Gated pages NOT audited** (Coming-Soon set in `comingSoonPages.js` as of 2026-06-15): discover, you, brain, insights/intelligence-feed, search-engine, liquidation-heatmap, ai-market-analysis, world, pulse, social-zone, x-bubbles, x-intel. Re-audit these when they unlock — several (you, discover, pulse, brain) are heavy.

---

## B. Corrections to Prior Assumptions (read first — don't chase non-bugs)

The audit overturned several beliefs baked into `performance-smoothness-plan.md` / `charts-system.md`. Verify nothing here before "fixing" it:

1. **H7 "duplicate top-250 fetches" is mostly ALREADY SOLVED.** All page-1 callers (any `perPage ≤ 250`) collapse onto ONE shared upstream fetch via `_page1SpectreInflight` / `_page1CgInflight`; `_singlePageCache` holds the full 250-row payload and `.slice(0, perPage)`s it (`coinGeckoApi.js:171-247`). home(1,50), discover(1,250), you(1,10/30/50), pulse, roi all share one 412KB fetch within the 5-min TTL. The `page1:${perPage}` key is only the per-promise inflight key, NOT the cache key. **The real remaining gap is localStorage instant-paint, not dedup** — see C1. Re-scope H7 from "cache unification" (done) to "localStorage seed unification" (not done).

2. **`binanceApi.getTopCoinPrices` does NOT triple-fetch-and-discard — DISPUTED, lean refute.** The data-layer agent reads `binanceApi.js:249-291` as Spectre-first with early `return` on success (`:263`); CG+Binance `Promise.all` is a fallback only. The home-cluster agent read it as a P0 double-fetch. **Verify the early-return before acting.** Most likely a non-bug.

3. **`coinGeckoApi.getMajorTokenPrices` does NOT fetch CG twice — DISPUTED, lean refute.** Data-layer agent: one Spectre + one CG in parallel `Promise.all` (`:375`), the `:430` CG call is a failure-path fallback. Home-cluster agent flagged it P0. **Verify the `:430` branch is catch-only before acting.**

4. **UDF / bars "cache-key-too-granular" is ALREADY FIXED.** Both Express (`index.js:7885-7887`) and serverless (`tradingview-udf.js:177-185`) bucket by resolution, not exact from/to. The `charts-system.md` C2/E-section claim is stale.

5. **traders-corner heavy widgets are DEAD CODE.** The CVDChart / OrderBookDepth / LiquidationBars/Bubbles/Timeline self-polling widgets live in `widget-registry.js` / `default-layouts.js` — NOT mounted by the routed page (`index.jsx`). The routed page uses tiered, idle-deferred loaders and is one of the best-optimized in the app. The "widgets slam the derivatives proxy" worry does not apply to the live route.

6. **`/api/bars` cost waterfall + allorigins timeout — DO NOT TOUCH.** The Binance→Onchain-Bridge→Hetzner→GT→Codex sequence is intentional cost-optimization; the allorigins 4s timeout looks dead locally but is the prod path (`binance-bars.js:228`). Per project memory, cutting it blanked prod charts once (PR #914 reverted).

---

## C. Systemic Wins (cross-cutting — highest leverage, do first)

These help many pages at once. Ranked by impact ÷ effort.

### C1. localStorage instant-paint for the two memory-only hot caches `[P1, M, ~all data pages]`
Two of the highest-traffic caches are memory-only → every cold reload paints a shimmer and re-fetches:
- `spectreMarketApi.fetchBaseJson` — TTL block memory-only (`spectreMarketApi.js:18-30, 42-81`). Backs the home AI panel, intel slim bundle, tickers, markets list, heatmap rows, bubbles rows, news. **Heatmaps + bubbles both shimmer on every cold load purely because of this** (`TTL.list = 15s`, no LS).
- `coinGeckoApi` `_singlePageCache` / `allCoinsCache` — module vars, no LS (`coinGeckoApi.js:57,158`). Top-coins page-1 has no cross-session seed despite the perf-plan claiming it does.
- `useMomentumData` `CLIENT_CACHE` — memory-only LRU (`useMomentumData.js:21-29`); potential-gainers board shimmers on reload.

**Fix:** add a localStorage write-through seed (10-min TTL) to `fetchBaseJson` keyed by URL for the markets-list + slim-intel keys, and to `_singlePageCache`. One change fixes cold-paint on home, heatmaps, bubbles, categories, potential-gainers, news at once.

### C2. Kill or repurpose the orphaned `sharedTopCoinsStore` `[P2, S]`
`services/prices/sharedTopCoinsStore.js` is fully built (visibility-aware, **already has the localStorage-seed logic C1 needs**) but consumed ONLY by the dev audit panel. Its stated purpose (dedupe the top-250 fan-out) was already solved by C1's shared-inflight. Either delete it or wire its LS seed into `_singlePageCache`. Leaving it half-shipped misled multiple audit agents into thinking it was live — it's confusion debt.

### C3. `isAppActive()` idle-guard sweep on raw `setInterval` polls `[P1 for #1, P2 batch]`
`document.hidden` is widely guarded; the 5-min **idle** guard `isAppActive()` is not — so visible-but-abandoned tabs keep burning upstream quota. Only 3 xdash hooks ever got the retrofit.
- **Critical:** `useMomentumData.js:175` — the interval body has NEITHER `document.hidden` NOR `isAppActive()` (the guards at `:167,171` are focus-handler-only). Fix first.
- **Batch (P2, S each):** `useTrendingTickers.js:43`, `useSpectreAssetData.js:114`, `useLiveDumpForensics.js:227`, `usePairTrades.js:86`, `useDetectiveFeed.js:68`, `useXDashPrices.js:156`, `spectre/useMindshareV2.js:98`, `useNotificationPoller.js:153`, `useXDashSurface.js:140` (the always-mounted x-dash hero ticker — high reach), `alerts-page.jsx:200`, `x-bubbles-page.jsx:381`.
- Reference pattern: `useWatchlistPrices.js:621` (`document.hidden || !isAppActive()`), the gold standard — port it everywhere.

### C4. Backend filter/projection params that unlock big frontend payload wins `[P0/P1, coordinate w/ Backy + KD]`
Several pages ship-everything-then-filter-client-side. The fix is a server param. One backend change each, multiple pages helped — see Section E table. Highest value: polymarket `/events?category=&limit=&fields=`, open-interest `?meta_only`, xdash bootstrap `?fields=`.

### C5. Restore dev/prod parity for Express-only routes `[P0, M, prod correctness]`
Several hot routes exist only in Express (dev) with no serverless mirror → 404 or degraded generic-proxy fallthrough on `app.spectreai.io`. See E#3-#6, #15. This is a correctness + perceived-speed bug in prod, not just an optimization.

---

## D. Per-Page Findings

Severity P0/P1/P2 · Effort S/M/L. Only actionable rows shown; "healthy/no-change" items omitted (see Section G).

### `/` home
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DUPLICATE | `useTrendingTokens({enabled:true})` fires `getTrendingTokens` on mount though default tab is `topcoins`; verify the always-on TokenTicker actually consumes `trendingTokens` (vs `topCoinPrices`) — if not, it's a wasted on-mount Codex/Spectre call | `use-top-section-data.js:238-247` | P1 | M | Gate `enabled` on `onChainActive` or confirmed ticker use |
| BOOT | `/api/intelligence/breaking` fetched on mount unconditionally (below-fold AI panel) | `use-market-intelligence.js:60-62` | P2 | S | Defer to `requestIdleCallback` (mirror A7) |
| POLLING | `useStockPrices(...,10000)` polls 10s in stocks mode (vs 30s crypto) | `use-market-prices.js:61` | P2 | S | Raise to 20-30s |
| — | A7 (derivatives idle-deferred) + A8 (slim intel boot) confirmed SHIPPED & working | `use-market-intelligence.js:200-205`, `useMarketIntel.js:464-470` | — | — | No regression |

### `/gm-dashboard`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DUPLICATE | `getTopCoinPrices` Spectre + CG/Binance — **DISPUTED** (see B2); verify early-return at `:263` | `binanceApi.js:249-291` | P1 | M | If no early-return, short-circuit on Spectre success |
| WATERFALL | News chain sequential: Spectre → CryptoPanic → `/api/news` (3 serial awaits) | `cryptoNewsApi.js:78-114` | P1 | S | `Promise.race`/short-circuit first non-empty |
| POLLING | News poll 2min < cache TTL 3min → every poll forces refetch | `gm-dashboard.jsx:356-373` | P2 | S | Align poll ≥ TTL |
| CACHE | `getStockQuotes` no client cache/dedup; 60s poll + concurrent widgets double-fire | `gm-dashboard.jsx:375-386`, `stockApi.js:261` | P2 | S | 30-45s cache + inflight Map |
| CACHE | Weather no localStorage seed; blocks paint on geo+API 1-2s | `gm-dashboard.jsx:291-354` | P2 | M | LS seed (6h TTL), stale-first |

### `/fear-greed`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| BOOT | `getFearGreedHistory(2600)` (~800KB-1MB) fetched on mount, sequential await, blocks below-fold cards | `useFearGreedData.js:149-184` | P1 | L | Defer 2600-day to `requestIdleCallback`; fast tier already serves 365-day |
| WATERFALL | `getBtcPriceHistory(365)` awaited after the 2600-day history despite being independent | `useFearGreedData.js:167-184` | P1 | M | Race with `AbortSignal.timeout(2000)`; render without BTC overlay if slow |
| PAYLOAD | `useChartEvents` news `limit=80` (clustered down anyway) + fires even when `showEvents` off | `useChartEvents.js:30,55-93` | P1 | M | Cap ~40; gate behind `showEvents` |
| CACHE | No LS instant-paint; cold load shimmers up to 30-120s | `useFearGreedData.js:80-91` | P2 | M | Persist 365-day + current |

### `/categories`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DUPLICATE | `getTopCoinsMarketsPage(1,250)` fires twice on startup (fallback + first poll tick) | `categories-page.jsx:317-324,471-476` | P1 | M | Route poll through cached path |
| DUPLICATE | Stock mode `getStockQuotes` twice on mount (init + poll) | `categories-page.jsx:375-421,434-478` | P1 | S | One call, 5min cache |
| POLLING | Stock-sector poll has NO `document.hidden` guard (only crypto path is adaptive) | `categories-page.jsx:434-481` | P1 | M | Wrap in `useAdaptivePolling` |
| POLLING | MomentumBoard `useXDashCategories` polls 120s even off-tab; + TTL(120s)==interval(120s) defeats refresh | `momentum-board.jsx:40`, `useXDashCategories.js:4,36` | P1 | S | `enabled: view==='trending'`; drop TTL to 60s |
| PAYLOAD | Category fetches send `sparkline=true` but table draws SYNTHETIC waves — real arrays never read (~30KB/page) | `coinGeckoApi.js:508,1355`, `categories-page.jsx:76-88` | P2 | S | Strip `sparkline=true` |

### `/token`
Research owns only the iframe wrapper + a demo-session mint. All heavy data is behind the trading-app iframe (out of scope).
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| POLLING | Demo mint re-fires on every `visibilitychange` regardless of token age (15-min token) | `token/index.jsx:114-116` | P2 | S | Skip mint if token age < ~12min |
| CACHE | Demo token held in `useRef` only → re-mint on every `/token` remount | `token/index.jsx:61,84` | P2 | S | Cache signed token+expiry in sessionStorage |

### `/research-zone`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| WATERFALL | Non-major resolve is a sequential 3-hop fallback (CG `/search` → Spectre resolve → Codex) that blocks the parallel data fetch — dominant cold first-paint blocker for non-majors | `use-research-zone-data.js:431-473` | P1 | M | Thread `initialToken` cgId/address (already known from the nav click) into the data hook to skip resolve |
| CACHE | Chart bars (`getBars`) uncached — every timeframe switch refetches ~300 bars | `research-zone/hooks/use-kline-indicators.js` | P1 | M | Per-`{address,networkId,resolution}` module cache + inflight |
| POLLING | SSE asset stream runs alongside a 15s Binance price poll — both update price (redundant) | `use-research-zone-data.js:1258,1268-1301` | P1 | M | Suspend/widen poll to 60s heartbeat when SSE connected |
| CACHE | `onchain` TTL (2min) < poll interval (5min) → dedup never helps the poll | `use-research-zone-data.js:1336` | P2 | S | Align TTL ≥ interval |

### `/dossier`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| POLLING | Detail page runs **6 concurrent unsynchronized intervals per token** (lookup 30s, market-series 60s, signals 30s, candles 60s, …), all `document.hidden`-only | `dossier-panel.jsx:111,134,152`, `dossier-candles.jsx:124-127` | P1 | M | Consolidate to one `useAdaptivePolling` driver; add `isAppActive()` |
| PAYLOAD | Signals `limit=200` then filtered client-side to one `ca`, sliced to 8 | `dossier-panel.jsx:145-148` | P1 | S | Backend `?ca=` filter, `limit=8` (see E#11) |
| DUPLICATE | 3 market-shaped calls per token (lookup `market` + `marketSeries` sparkline + candles) | `dossier-panel.jsx:104`, `dossier-candles.jsx:118` | P2 | M | Derive sparkline from candle bars |
| CACHE | `dossierApi` no module cache/dedup → token re-visit re-runs the blocking enrichment | `services/dossierApi.js:7-15` | P2 | M | Short-TTL cache + inflight keyed by chain/ca/layer |

### `/watchlists`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| WATERFALL | Refresh pipeline: the 3 on-chain enrichment batches (Codex details, DexScreener, CG long-windows) are independent but run sequentially awaited | `useWatchlistPrices.js:400,502,567` | P1 | M | `Promise.all` the three — cuts ~2 RTT off every 120s refresh |
| DUPLICATE | Mount double-fetch: page calls `refreshPrices()` on mount AND the hook fetches on mount | `watchlists-page.jsx:884-888`, `useWatchlistPrices.js:616` | P1 | S | Drop the page-level mount `refreshPrices()` |
| POLLING | Analysis-tab X-Dash fan-out (3min) has `document.hidden` but no `isAppActive()`; `per_page=100` for a mentions count | `wl-analysis-panel.jsx:950-1010,1199` | P2 | M | Add idle guard; lower `per_page` |
| — | Main poll's `document.hidden \|\| !isAppActive()` guard is the codebase gold standard | `useWatchlistPrices.js:621` | — | — | Reference — port to dossier/alerts |

### `/user-dashboard`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| BOOT | `/api/referral/stats` fetched on mount though the Referral section is locked & never rendered | `user-dashboard/index.jsx:170-194` | P1 | S | Gate behind `activeSection==='referral'` |
| ON-MOUNT | Access token awaited twice (auth effect + referral effect) | `index.jsx:101-114,170-194` | P2 | S | Reuse resolved token |

### `/heatmaps` & `/bubbles`
Both gated by C1 (the `fetchBaseJson` LS gap is why they shimmer). Otherwise exemplary — `sparkline:false`, capped pool (250/100), adaptive guarded polling, click-deferred charts; bubbles does phase-split payload (86KB→394KB idle-deferred) + parallel streamed category pages.
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| CACHE | List data memory-only, `TTL.list=15s`, no LS instant-paint | `spectreMarketApi.js:20,42-46`; `heatmaps-page.jsx:241`, `bubbles-page.jsx:811` | P1 | M | C1 (shared fix) + bump heatmap list TTL to ~60s |
| PAYLOAD | bubbles phase-2 `sparkline:true` (~394KB) fetched even on mobile where sparklines aren't drawn | `bubbles-page.jsx:820` | P2 | M | Skip phase-2 on mobile |

### `/potential-gainers`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| BOOT/PAYLOAD | Fetches full board (`scan_limit=500, include_performance=true`) on mount but reads only `performance_summary` | `potential-gainers-page.jsx:132-137` | P1 | M | Backend `summary_only=1` (E#…) or derive from existing perf endpoint |
| CACHE | `/api/momentum/*` memory-only (C1); board shimmers on reload | `useMomentumData.js:21,82` | P1 | M | LS write-through (C1) |
| PAYLOAD | `useMomentumSignals limit=100` but only top10/20 buckets rendered | `potential-gainers-page.jsx:145` | P2 | S | Drop to bucket size + buffer |

### `/tokenized-assets`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| WATERFALL | Overview lands with 4 requests (bundle + analysis/overview + signals + themes) when bundle could carry all | `useRwaData.js:73`, `rwa-brain-sidebar.jsx:205,16-19` | P2 | S | Fold 3 into `/api/rwa/bundle` |
| BOOT | Brain-sidebar analysis fetch eager, not viewport-gated (RwaTweets in same tab IS gated — inconsistent) | `rwa-brain-sidebar.jsx:205` | P2 | S | IntersectionObserver-gate |
| CACHE | Commodities `/api/rwa/issuers` raw `fetch` in `useEffect([])`, no cache | `rwa-commodities-tab.jsx:185-196` | P2 | S | Route through cached service |

### `/zigchain`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DUPLICATE+CACHE | `/api/xdash/author/ARafayGadit` fetched twice (FounderTweets + Episodes), both uncached raw `fetch` | `ZigFounderTweets.jsx:94-97`, `ZigEpisodes.jsx:93-104` | P1 | S | One shared 60s module cache keyed by handle |
| PAYLOAD | Dead `setChainTvl` zeroed-array work nothing reads | `useZIGChainData.js:127-130` | P2 | S | Delete |

### `/x-dash` (+ subroutes)
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DUPLICATE | `/api/xdash/narratives` fetched twice on Leaderboard mount (rail cached + hero `ttlMs:0` cache-bypass) | `xd-leaderboard.jsx:149`, `xd-hero-strip.jsx:424` | P1 | M | Hoist one fetch, prop down to hero |
| DUPLICATE | 3 `useXDashBootstrap` calls on mount (hero perPage=20, table=20, treemap=48) — treemap is a superset | `xd-leaderboard.jsx:259,265,330` | P1 | M | One wide fetch (48) + client slice |
| POLLING | `useXDashSurface` hero ticker polls 60s `ttlMs:0` with `document.hidden` only (no idle guard) — always mounted | `useXDashSurface.js:140-143` | P1 | S | Add `isAppActive()` (C3) |
| CACHE | `useXDashStaying` is the only xdash hook with no inflight dedup | `useXDashStaying.js:54-82` | P2 | S | Add INFLIGHT map |
| WATERFALL | Search awaits a 5th sequential `searchCoinsForROI()` after the `Promise.allSettled` on the 0-result path | `useXDashSearch.js:134` | P2 | M | Move into the allSettled array |
| DEAD | `xd-pulse.jsx` (8 parallel `useXDashToken` N+1) unrouted but latent | `xd-pulse.jsx:177-184` | P2 | S | Delete |

### `/x-intelligence` (pages/x-bubbles)
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| POLLING | `useLeaderboard` re-runs the FULL enrichment cascade every 60s: 6 bootstrap pages → CG sparklines → up to 24 DexScreener → up to 14 Codex bars = **~44 outbound req/poll**, forever on a focused tab | `x-bubbles-page.jsx:381-389,261-371` | P0 | M | Poll only the 6 bootstrap pages; run CG/DEX/Codex enrichment once on load + manual refresh; add `isAppActive()` |
| DUPLICATE | Board uses bespoke `useLeaderboard`, not the shared `useXDashBootstrap` module cache → re-fetches from scratch when navigating /x-dash → /x-intelligence | `x-bubbles-page.jsx:251` vs `useXDashBootstrap.js:4` | P1 | M | Route through `useXDashBootstrap` (shared cache+dedup) |
| N+1 | Up to 24 direct browser DexScreener `search?q=<sym>` calls (no proxy/cache), repeated per poll | `x-bubbles-page.jsx:321-336` | P1 | M | Server proxy + cache; run once |
| CACHE | Token detail/mentions panel uncached + no `AbortSignal.timeout` on detail | `x-bubbles-page.jsx:394-408,458-466` | P2 | S | TTL map + inflight; add timeout |

### `/alerts`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DUPLICATE | Every category/severity pill click re-fires the `/feed` request, though the loaded 50-row set is already client-filterable (and double-filtered) | `alerts-page.jsx:176-177,209-221` | P1 | M | Fetch once, filter in memory |
| POLLING | 30s poll `document.hidden` only, no `isAppActive()` | `alerts-page.jsx:200-207` | P2 | S | Add idle guard (C3) |
| CACHE | No cache/dedup/LS seed | `alerts-page.jsx:173-198` | P2 | S | LS seed + module TTL |

### `/lens`
No fix — web surface is desktop-gated (inert), hover lookups cached at ref + service layer. Lowest priority.

### `/intelligence` (+ article)
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| CACHE | `getFearGreedCurrent` 30s TTL, polled 60s, no LS seed → cold paint every session | `index.jsx:330-343` | P1 | S | LS seed + `fireImmediately` |
| WATERFALL | `fetchAnalyses` awaits signals only after editorial resolves (sequential on sparse-editorial path) | `index.jsx:276-306` | P2 | S | `Promise.allSettled([editorial, signals])` |
| CACHE | ArticlePage refetches prices on every article mount (no shared cache reuse) | `ArticlePage.jsx:117-159` | P2 | S | Route via `getSpectrePricesBySymbols` (already deduped) |
| PAYLOAD | `getSpectreNews({limit:80})` but ~35 rendered on first paint | `index.jsx:246,390` | P2 | M | Tier: 20 on mount, lazy rest |
| BOOT | `DetectiveFeed` (right-rail, below-fold) self-fetches + polls on mount | `index.jsx:897`, `DetectiveFeed.jsx:74-79` | P2 | M | IntersectionObserver-gate |

### `/news` & `/newsroom`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| WATERFALL | NewsArticleReader searches Spectre(50) then Crypto(50) sequentially to locate an article | `NewsArticleReader.jsx:104-155` | P1 | M | `Promise.allSettled`, first match |
| DUPLICATE | newsroom calls `getSpectreNews` 3× on mount (limit 30 / 12 / breaking 8) | `newsroom/index.jsx:68,78,83` | P1 | M | One `limit:50` + client slice |
| BOOT | newsroom `fetchFeatured`/`fetchStats` run after the blocking allSettled → above-fold rail paints empty 1-3s | `newsroom/index.jsx:127-140` | P1 | S | Move into the blocking allSettled |
| POLLING | newsroom uses raw `setInterval` (price 30s/news 120s/breaking 60s), `document.hidden` only, not `useAdaptivePolling` | `newsroom/index.jsx:145-161` | P1 | S | Migrate to `useAdaptivePolling` |
| CACHE | news list no LS seed → skeleton on every cold boot/return | `NewsPage.jsx:720` | P2 | M | LS seed |

### `/ai-charts`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| BOOT | `SectorCompareChart` + `CompareChart` (below-fold) mount eagerly → fire `getSectorSnapshot` + `/api/compare/chart` before visible | `ai-charts-page.jsx:815,821` | P1 | S | Wrap in existing `useInView()` (`:282`) |
| POLLING | `/api/compare/chart` loop has no `document.hidden` guard | `compare-chart.jsx:269` | P1 | S | Add guard + abort on hide |
| CACHE | `getCategories()` no client cache/dedup; refetched per mount/tab | `compare-chart.jsx:135`, `coinGeckoApi.js:1218` | P1 | S | Inflight dedup + sessionStorage |

### `/ai-media-center`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| POLLING | Live tab 10min auto-refresh, no `document.hidden` guard | `media-center-page.jsx:365` | P1 | S | Add guard |
| CACHE | `mediaApi` no client cache; ignores server `meta.cached`; tab re-visits refetch | `mediaApi.js:7-77` | P1 | M | Use Zustand `lastRefreshed` (5min) before refetch |

### `/traders-corner`
Routed page is already best-in-class (tiered loaders, idle deferral, slim intel, service-layer OI dedup). Remaining:
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DEAD | `widget-registry.js`/`default-layouts.js` self-polling widgets unrouted but a latent flood if wired | `widget-registry.js:9-39` | P2 | S | Quarantine/delete |
| PAYLOAD | Heatmap mode `getExternalExchangeList(...,500)` — 500 candles, window rendered | `index.jsx:715`, `tradersCornerApi.js:766` | P2 | M | Drop to ~250 |
| CACHE | OI-chart `openInterestHist?limit=96` refetched on every tab re-entry | `index.jsx:688-700` | P2 | S | Wrap in `cached()` (60s) |

### `/economic-calendar`
Already well-built (`useCalendarBundle` collapses 5 endpoints → 1, below-fold IO-gated, all polling adaptive). Remaining:
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DUPLICATE | Bundle race: `useCalendarData` fires `/economic` + `/analysis` on the same tick the `/bundle` promise is in-flight (seed empty) → cold load is ~3 req not 1 | `useCalendarData.js:333,339`, `useCalendarBundle.js:28` | P1 | M | Gate mount fetches on bundle `loading` |
| DUPLICATE | `/calendar/verdict` fetched by `useMarketRegime` though bundle returns it | `useMarketRegime.js:54-62` | P2 | S | Seed from `bundle.verdict` |
| CACHE | `useThemes` bare `fetch`, no dedup/cache | `useThemes.js:26,43` | P2 | S | Reuse `fetchCalendarJson` dedup |

### `/roi-calculator`
Zero on-mount fetches (interaction-gated). Per-selection cascade is the cost:
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| CACHE | `searchCoinsForROI` + `getCoinROIData` fully uncached, no dedup (each called from 2 components) | `coinGeckoApi.js:976-983,1081` | P1 | S | Query-LRU(60s)+inflight; module cache 30-60s |
| WATERFALL | `getCoinROIData` 3 sequential awaits (Spectre resolve → prices → CG `/coins/{id}`); `useRoiChart` resolve→bars 2 hops | `coinGeckoApi.js:1089→1118`, `use-roi-chart.js:89→100` | P1 | M | Parallelize CG detail; resolve identity in parent |
| PAYLOAD | MarketCapCompare pulls 250-row `sparkline=true` (~412KB), sparklines discarded; TimeMachine pulls `days=max` daily (~4000 pts) | `market-cap-compare.jsx:110`, `time-machine.jsx:72` | P1 | M | `sparkline=false` path; coarser yearly series |

### `/ventures`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| DEAD | `hub71-crypto-seed.json` (8KB) zero importers | `components/hub71-crypto-seed.json` | P2 | S | Delete |
| CACHE | `useVenturesPrices` + `ventures-api.js` memory-only → hard reload refetches ~170KB cold | `useVenturesPrices.js:48`, `ventures-api.js:21-62` | P2 | S | LS/sessionStorage seed |
| DUPLICATE | Two `/v1/prices` fetchers (price map vs VCIntelHub logos), separate caches | `useVenturesPrices.js:81` vs `vc-intel-hub.jsx:305` | P2 | M | Unify on one symbol-keyed store |

### `/private-markets`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| BOOT | preipo tab fires 7 tweet requests (`Promise.all`) + LiveCoverage (3-way news + predictions) on mount, below fold | `use-preipo.js:62-66`, `live-coverage.jsx:25-41` | P1 | M | Idle-defer tweets; IO-gate LiveCoverage |
| PAYLOAD | `getPrivateDeals` returns 500+ rows, all to state, filtered client-side | `private-markets-page.jsx:124-189` | P2 | M | Server pagination (E#2) |
| CACHE | All caches memory-only, no LS seed | `private-markets-api.js:13-27` | P2 | M | LS seed |

### `/predictions`
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| PAYLOAD | `/api/polymarket/events` ships the entire open-events blob; client does all category/dedup/sort/bubble/social derivation | `polymarketApi.js:153-186,194-263` | P1 | L | Server `?category=&limit=&fields=` (E#1) |
| BOOT | Bubble map `React.lazy` but mounts instantly, fires its own `getPredictionMarkets` + d3-sim on the detail critical path | `prediction-detail.jsx:1208-1210`, `prediction-bubble-map.jsx:41-51` | P1 | S | Restore idle/viewport gate; pass cached events as prop |
| BOOT | Detail boots ~4 req (bundle + news + AI analysis + bubble map) | `prediction-detail.jsx:408-448,548-584` | P1 | M | Defer news + analysis to idle |
| CACHE | All caches memory-only, no LS seed | `polymarketApi.js:115-118,441-443` | P2 | M | LS seed `allEventsCache` |

### `/monarch-chat`
Near-optimal (1 on-mount request, true SSE, LS-hydrated history, bounded 20-msg payload).
| Axis | Finding | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|
| CPU/PAYLOAD | Every streamed token re-runs `extractChartSpecs`/`extractDashboardSpec` regex over the full accumulated string + full `messages.map` setState → O(n²) | `MonarchContext.jsx:468-489,87-196` | P2 | M | rAF-throttle parse, or re-parse only on fence char |
| POLLING | `/api/monarch/health` polls 5min app-wide from the global provider (only feeds sidebar label) | `MonarchContext.jsx:355-359` | P2 | M | Gate to chat-open |

---

## E. Server / Serverless Findings

> ## ⚠️ RECALIBRATED 2026-08-19 — this section's severities were WRONG, read this first
>
> Every payload figure below was written against the **raw** response size. Gzip
> has been on globally the whole time (`index.js:297` — this section even lists
> it as a non-issue), and this JSON compresses **6-6.6x**. So every "payload"
> severity here was overstated by roughly 5x. Measured on the live dev server:
>
> | endpoint | raw | **over the wire** | was rated |
> |---|---|---|---|
> | `/api/polymarket/events` | 761KB | **153KB** | P0 "biggest payload win" |
> | `/api/private/deals` | 49KB | **8KB** | P0 |
> | `/api/xdash/bootstrap?per_page=48` | 301KB | **46KB** | P1 |
> | `/api/dossier/signals?limit=100` | 12KB | **2KB** | P1 |
>
> **Consequences, applied to the rows below:**
> - **E#2 (private/deals) and E#11 (dossier `?ca=`) are DEAD.** 8KB and 2KB over
>   the wire. Writing pagination and a scoping filter to save single-digit KB is
>   pure cost. Do not do these.
> - **E#1's `?category=`/`?limit=` half is WRONG, not just low-value.** The
>   predictions UI builds its category pills over the whole set so switching is
>   instant and network-free; filtering server-side would turn each tab switch
>   into a NEW request — more round-trips, not fewer. Only a `fields=`
>   projection (drop `description`, `clobTokenIds`, `createdAt`) is coherent,
>   and it is worth ~60-70KB gz on one secondary page. P3 at best.
> - **E#10 (xdash `fields=`)** would save roughly 20KB gz. Marginal. P3.
>
> **Raw size still matters — but for STORAGE and PARSE, not transfer.**
> localStorage holds bytes uncompressed, which is why the seed trims (Wave 13)
> were correctly sized in raw bytes. Use gzipped size when arguing about the
> network; use raw when arguing about localStorage or JSON.parse cost. The two
> are not in conflict.
>
> **What is actually still worth server work is LATENCY, not bytes:**
> `/api/xdash/token/:cgId` (~270KB, ~2s, no server cache at all) and the
> data-lane endpoints in the Wave 8/11 notes (`/v1/rz/{SYM}/bootstrap` 2.4-8.2s,
> `/v1/prices/{SYM}/ohlcv` 14-17s, both uncached). Seconds beat kilobytes.

| # | Endpoint | Issue | File:line | Sev | Eff | Fix |
|---|---|---|---|---|---|---|
| 1 | `/api/polymarket/events` | 761KB raw but **153KB gzipped**. `?category=`/`?limit=` REJECTED — the UI filters client-side on purpose so tab switches are network-free; server filtering would ADD requests. Only `fields=` is coherent (~60-70KB gz). | dev `routes/polymarket.js:42,59-69`; prod `handlers/polymarket.js:98-118` | ~~P0~~ **P3** | M | `fields=` only, if ever. Note the two twins have drifted on tag limits (50 vs 30) — fix that if touching the file |
| 2 | ~~`/api/private/deals`~~ | ~~No limit/pagination~~ **DEAD — 8KB gzipped.** Not worth a line of code. | `lib/private-markets-core.js:798-945` | ~~P0~~ **DROP** | — | Do not do |
| 3 | `/api/momentum/setups` (+performance/history/receipts) | **No serverless equivalent** — Express-only → breaks on app.spectreai.io | Express `index.js:13852-13948`; no `api/` file | P0 | M | Add serverless handler |
| 4 | `/api/market/stats,liquidations,dominance,dominance-history,mindshare`, `/coinglass/total-oi,total-liquidations` | Express-only, no serverless mirror → 404/degraded in prod | `index.js:4114,8753,11104,11137,9003,3548,3569` | P0 | M | Add serverless handlers / confirm vercel.json |
| 5 | `/api/social/mentions/:asset` | Express-only → 404 in prod | `index.js:10055` | P1 | S | Add to `social-api.js` |
| 6 | UDF `/config`+`/time` | No serverless equiv; widget datafeed init may break in prod | `index.js:7625,7647` | P1 | S | Tiny static serverless handlers |
| 9 | open-interest `?limit=500` | Home AI panel fetches 500 rows, reduces to `total_oi_usd`+BTC/ETH | consumer `use-market-intelligence.js:204`; upstream Spectre Data API (KD) | P1 | M | Backend `?meta_only=1` or `?limit=50` |
| 10 | `/api/xdash/bootstrap` | 301KB raw / **46KB gzipped**; a `fields=` projection saves ~20KB gz | `index.js:13779`; `social-proxy.js:126-155` | ~~P1~~ **P3** | M | Marginal — only if already in the file |
| 11 | ~~`/api/dossier/signals`~~ | ~~No `?ca=` scoping~~ **DEAD — 2KB gzipped.** | `dossier-api.js:608-616` | ~~P1~~ **DROP** | — | Do not do |
| 18 | ~~`/api/xdash/token/:cgId`~~ | ~~no server-side cache~~ **FALSE — measured 2026-08-19, it is cached on all three levels.** Express: 30s in-memory (`CACHE_TTL_XDASH_TOKEN_MS`); serverless: 60s in-memory + `s-maxage=60, SWR=120`; Vercel edge: verified **MISS 3356ms → HIT 111ms → HIT 90ms** on prod with cookies present. Dev: 2.27s → 0.026s. | `index.js` xdash token route; `social-proxy.js:453` | **DROP** | — | Nothing to do. Only the first request per edge region per 60s pays. |
| 13 | `/api/market/funding`+`/oi`+`/ls-ratio` | 3 separate Binance-Futures routes, 3 cache entries | `index.js:8319,8344,8366` | P2 | M | Merge into `/derivatives-snapshot` (`Promise.all`, one cache key) |
| 15 | `/api/coingecko/top` | No dedicated serverless handler → prod falls to generic cg-proxy, loses category+cap+mapping, forces `sparkline=true` | Express `index.js:4049-4099` | P1 | M | Serverless `coingecko-top` mirroring Express logic |
| 16 | Express read routes | No `Cache-Control` on `/coingecko/top`, `/fear-greed/*`, `/xdash/*` (serverless equivalents DO set CDN headers) — parity gap on prod-via-Express | `index.js:4056,10877,…` | P2 | S | Add `s-maxage` matching in-memory TTL |
| 17 | `/api/news/history`, `/api/intelligence` | No field projection/pagination; ship full summaries, client paginates | `index.js:2202`, `intelligence-api.js:51-55` | P2 | M | `?limit`/`?offset`/`?fields=` |
| 7 | UDF history → `/api/bars` | Internal `localhost:PORT` self-call hop (dev only; serverless already inlines) | `index.js:8000-8001` | P2 | M | Inline the handler import |

**Confirmed non-issues (do NOT touch):** `/api/bars` cost waterfall (intentional); allorigins 4s timeout `binance-bars.js:228` (prod path — cutting it blanked prod once); UDF/bars cache keys already resolution-bucketed (B4); global gzip compression already active (`index.js:297`).

### Backend changes that unlock frontend wins (one server change → many pages)

⚠️ Rewritten 2026-08-19 — the byte-driven rows were struck (see the recalibration
box above). What remains is ranked by **seconds**, which is what users feel.

| Server change | Why | Helps pages |
|---|---|---|
| **Data-lane caching (Alaa/KD): `/v1/rz/{SYM}/bootstrap` 2.4-8.2s, `/v1/prices/{SYM}/ohlcv` 14-17s** | latency — **now the only remaining server-side win anywhere**, and it is not our code; the app lane around it is already lean | research-zone (every token open) |
| ~~Cache `/api/xdash/token/:cgId`~~ | **struck** — already cached on all three levels (measured; see E#18) | — |
| open-interest `?meta_only` (Spectre Data API, KD) | 500 rows reduced to 3 numbers — request shape, not size | home boot AI panel, traders-corner |
| `/market/derivatives-snapshot` (3→1) | 3 round-trips → 1; a latency win, not a payload one | home derivatives bar, traders-corner |
| momentum `summary_only=1` | board fetched only for its summary | potential-gainers |
| ~~polymarket `?category=&limit=`~~ | **struck** — wrong for the UI (would add requests) | — |
| ~~dossier signals `?ca=`~~ / ~~`private/deals?limit=`~~ | **struck** — 2KB and 8KB gzipped | — |

> Parity caveat: some "Express-only" routes may still resolve in prod via a vercel.json catch-all rewrite but degrade to the generic proxy (no caching/projection). Confirm against `apps/research/vercel.json` (Vercy's domain) before sizing #3-#6/#15.

---

## F. Prioritized Execution Backlog

> ⚠️ **This backlog is HISTORICAL — most of it is done or struck.** It is kept
> for the reasoning trail. For what is actually open as of 2026-08-19, read
> **Wave 13** at the end of F2, then the recalibration box in Section E. In
> short: the frontend items below are shipped, the serverless-parity P0s were
> closed by other people months ago, and the payload P0s were struck for being
> sized in raw bytes against a gzipped wire.

**P0 (do first — correctness or biggest payload):** — ALL RESOLVED OR STRUCK
- ~~E#3,E#4 serverless parity for momentum + 7 market routes~~ — **already closed by others** (verified 2026-08-18); the one real gap, `market/liquidations`, was fixed in PR #1433
- ~~E#1 polymarket `/events` server filter~~ — **STRUCK**: `?category=` is wrong for the UI, and the payload is 153KB gzipped not 761KB
- ~~E#2 private/deals pagination~~ — **STRUCK**: 8KB gzipped
- ~~`/x-intelligence` 60s enrichment cascade~~ — shipped Wave 1

**P1 (high impact):**
- C1 localStorage instant-paint for `fetchBaseJson` + `_singlePageCache` + momentum (fixes cold-paint on ~6 pages)
- C3 `useMomentumData.js:175` missing visibility guard; `useXDashSurface.js:140` idle guard
- x-dash: collapse 3 bootstrap calls + dedupe double narratives
- research-zone: thread `initialToken` to skip resolve waterfall; cache chart bars; deconflict SSE vs 15s poll
- watchlists: parallelize 3 enrichment batches; drop mount double-fetch
- fear-greed: defer 2600-day history off boot
- ai-charts: IO-gate below-fold charts + add poll guard + cache categories
- newsroom: collapse 3 news calls + fix empty above-fold rail + adaptive polling
- economic-calendar: close the bundle race
- roi-calculator: cache the 2 uncached service fns + kill resolve→bars waterfall
- categories: dedupe double top-250 + double stock-quote + add stock-poll guard
- predictions: re-gate bubble map; defer detail news/analysis
- zigchain: shared cache for the duplicate author fetch
- E#9,E#10,E#11,E#15 backend params (coordinate Backy/KD)

**P2 (polish / consistency):** C2 (orphaned store), C3 batch idle-guard sweep, the various LS-seed + payload-trim + IO-gate items per page, E#13/#16/#17 server consolidation.

---

## F2. Execution Log

### Wave 1 — shipped 2026-06-16 (build clean, pending Codex review)
- **C1 instant-paint** — localStorage write-through seed added to `spectreMarketApi.fetchBaseJson` (10-min TTL, persist:true on markets/coins-markets/bubbles/heatmap/global/dominance/alt-season) and to `coinGeckoApi._singlePageCache` (sparklines stripped before persist). Fixes cold-load shimmer on home/heatmaps/bubbles/categories/news/potential-gainers.
- **C3-critical** — `useMomentumData.js:175` idle guard added (`document.hidden || !isAppActive()`).
- **C3 batch (x-dash)** — idle guards added to `useXDashSurface/Categories/CategoryTokens/Creators/Author/Token`; INFLIGHT dedup added to `useXDashStaying`.
- **x-intelligence P0** — `x-bubbles-page.jsx` cascade split: 60s poll now refetches only the 6 bootstrap pages; CG/DexScreener/Codex enrichment runs once on load + manual refresh (enrichRef cache), idle guard + AbortSignal.timeout added. (~44 req/min → ~6.)
- **x-dash dedup** — double `/narratives` fetch collapsed (hero reuses rail cache); 3 bootstrap calls collapsed to 1 wide fetch (perPage=48 + client slice) on the default `segment==='all'` view; dead `xd-pulse.jsx` + CSS deleted.
- **watchlists** — 3 on-chain enrichment batches parallelized (`Promise.all`, merge order preserved); mount double-fetch removed; analysis-tab idle guard.
- **user-dashboard** — `/api/referral/stats` gated behind the (locked) referral tab.
- **newsroom** — 2 plain `/news` calls collapsed to 1 (limit 50); featured rail moved into blocking allSettled; raw setInterval → useAdaptivePolling. NOTE: breaking kept as its own `/v1/news/breaking` call (it carries signal items absent from `/news` — collapsing it was a content regression, reverted).
- **ai-charts** — below-fold compare charts already IO-gated (no-op); `document.hidden` guard + AbortController added to compare-chart fetch.

**B2/B3 disputed items: confirmed NOT bugs** — `binanceApi.getTopCoinPrices` early-returns on Spectre success (`:263`); `coinGeckoApi.getMajorTokenPrices` `:430` is a catch-path fallback. No change. Drop these from any future plan.

### Wave 2 — shipped 2026-06-16 (build clean, pending Codex review + 1 browser-verify)
- **research-zone** — in-hook `initialToken` seed to skip the 3-hop resolve waterfall (activated via `research-zone-lite.jsx` opts); chart-bar module cache+dedup (`use-kline-indicators.js`, keyed by sym/resolution/networkId, not from/to); onchain TTL aligned to poll + routed poll through `_deduped`. **SSE-vs-15s-poll deconflict (RISKY): price poll widens to 60s when SSE healthy (tick <25s), snaps back to 15s if SSE stalls — watchdog-driven. MUST BROWSER-VERIFY: live price keeps updating (a) SSE on → poll ~60s, (b) SSE blocked → poll 15s, (c) SSE killed mid-session → recovers in ~25s.**
- **fear-greed** — 2600-day history deferred to `requestIdleCallback` (off boot path; `fullHistoryLoadedRef` only set after full payload lands, so the 120s poll never downgrades 2600→365); BTC-history fired parallel not awaited; chart-events news limit 80→40 (already lazy on `showEvents`).
- **dossier** — 6 per-token intervals → `useAdaptivePolling` (idle+hidden guarded); `dossierApi` module cache+inflight (15s, keyed chain/ca/layer) with `invalidate()` on refresh buttons; deleted dead `marketSeries` fetch+interval+state (one fewer call/token); landing signals limit 100→40.
- **economic-calendar** — closed the bundle race (cold mount now waits on the in-flight `/bundle` via `getPendingBundle()`, only fetches the slice the bundle didn't supply; gated by `usesBundleRef` so home panels that reuse the hook aren't affected); verdict deduped (seed from `bundle.verdict`); `useThemes`/`useMarketRegime` routed through `fetchCalendarJson` dedup.
- **categories** — most plan line-refs were STALE (poll already `useAdaptivePolling`-guarded, no mount double-fetch); added `isAppActive()` idle guard to `pollCategories` + `enabled: pageView==='trending'` on MomentumBoard (both render sites). `getStockQuotes` client cache still missing (stockApi.js — service change, deferred).
- **alerts** — fetch once + filter in memory (pill clicks no longer hit network; client-side severity rank); 30s poll idle guard; localStorage instant-paint seed. **VERIFY: severity values must be one of critical/high/medium/low or they rank 0 under a min-severity pill.**
- **predictions** — bubble map re-gated (idle/IntersectionObserver, fed cached events as a stable memoized prop, fallback fetch only on cold cache); detail news + AI-analysis deferred to idle; `allEventsCache` localStorage seed; `use-predictions-social` inflight dedup.
- **roi-calculator** — MarketCapCompare now `getTopCoinsMarketsPage(1,100,{sparkline:false})`; below-fold side panels IO-gated (local `useInView`). Tasks SKIPPED (correctly, would need service edits): resolve→bars threading (parent has no address/networkId; already `_identityCache`-deduped per token) and TimeMachine coarser series (`getCoinPriceHistory` takes no param).
- **media-center** — per-tab 5min freshness skip before refetch (background refresh, no shimmer); `mediaApi` URL-keyed cache honoring `meta.cached` + inflight; AbortController on channel/tab switch. (live-tab `document.hidden` guard already present.)
- **tokenized-assets** — brain-sidebar analysis fetch IO-gated; 60s raw interval → `useAdaptivePolling`; `/api/rwa/issuers` module cache+inflight.
- **zigchain** — new shared `xdash-author-cache.js` (60s TTL+inflight) collapses the duplicate `ARafayGadit` author fetch across FounderTweets+Episodes; deleted dead `setChainTvl`; `useZigComparison` inflight dedup.
- **coinGeckoApi (datay-A)** — `searchCoinsForROI` + `getCoinROIData` cache+dedup; opt-in `getTopCoinsMarketsPage(page,perPage,{sparkline})` (sparkline:false skips shared cache, does its own light fetch — won't poison home/discover sparkline cache); category-coin path stripped to sparkline:false; `getCategories` dedup + 30min sessionStorage cache.

### Wave 3 — shipped 2026-06-16 (build clean, pending Codex review)
- **home** — breaking-news deferred to `requestIdleCallback`; stock poll 10s→30s. (Trending fetch LEFT as-is — verified the always-on TokenTicker genuinely consumes `trendingTokens`, gating it would blank the ticker.)
- **gm-dashboard** — news 3-source chain raced via `Promise.all` (first non-empty wins; note: Spectre/Panic winners now also pass through `filterAndSlice` — no-op for the gm 8-item call); news poll 2min→3.5min (above the 3min cache TTL); weather localStorage instant-paint (6h).
- **intelligence** — Fear&Greed localStorage seed + `fireImmediately`; `fetchAnalyses` parallelized (editorial+signals `allSettled`); DetectiveFeed IO-gated at the mount site (confirmed intelligence-only). ArticlePage prices already routed through `getSpectrePricesBySymbols` (no-op). News-tier skipped (entangled with hero/category/shuffle).
- **news** — article-reader lookup parallelized (Spectre+Crypto `allSettled`, Spectre wins ties); news-list localStorage seed (bodies stripped); poll 120s→180s.
- **traders-corner** — OI-chart fetch wrapped in `cached()` (60s); external exchange-list 500→250 candles (heatmap spreads across width, no range loss); dead `widget-registry.js`/`default-layouts.js` quarantined with a DEAD header (confirmed zero routed importers). NOTE: OI-chart timeout dropped 8s→3.5s (matches sibling fetches) — glance if slow networks show empty.
- **ventures** — deleted dead `hub71-crypto-seed.json`; `useVenturesPrices` localStorage seed; `ventures-api` sessionStorage layer; new `ventures-prices-store.js` unifies the two `/v1/prices` fetchers (per-symbol cache+inflight+sessionStorage, overlapping symbols fetch once). `vc-database.json` 60KB bundle left (bigger change).
- **private-markets** — preipo featured-tweets (~7 req) idle-deferred; LiveCoverage IO-gated (news 3-way + predictions only on view); `private-markets-api` localStorage seed (deals 5m/stats 10m/preipo 30m). Deals server pagination deferred to server PR.
- **monarch-chat** — streaming spec-parse (`extractChartSpecs`/`extractDashboardSpec`, O(n²)) rAF-throttled; plain-text streaming stays per-token (fast path when no spec fence present), final sync parse at stream end. **VERIFY: text answer streams word-by-word; chart_spec answer still renders chart + text.** Health poll gated to chat-open.
- **token** — demo-session mint cached in sessionStorage; reused if age <12min (mount/visibility) / <9min (refresh) instead of re-minting the 15min token every remount + focus.

### Wave 4 — shipped 2026-06-18 (build clean; backend restart needed to verify tiers live)
- **tokenized-assets cold-load** — the page's only first-paint blocker was the atomic `/api/rwa/bundle?range=2y`: 9 server-side `Promise.all` calls, so the hero/tables waited on the slowest 3 (the 2-year history aggregations: `tvl-history` forward-fill, `stablecoin-history`, the remote `breakdown/history`). Split into **two tiers** — `?tier=core` (overview/protocols/stablecoins/movers/breakdown/index) + `?tier=history` (the 3 chart series). Mirrored in BOTH bundle impls (dev `packages/server/routes/rwa.js`, prod `apps/research/api/_lib/handlers/extended-proxy.js`), cached per-tier; omitting `tier` still returns the legacy full payload (back-compat, untouched).
- **useRwaData two-tier + instant-paint** — `fetchData` fetches `tier=core` (3-min poll, paints page), `fetchHistory` fetches `tier=history` (30-min poll, fills charts); both fire in parallel on mount so numbers never wait on charts. `AbortSignal.timeout` on both (15s/20s) so a hung upstream fails fast instead of shimmering forever. **localStorage instant-paint seed** (`spectre-rwa-bundle-v1`, 30-min TTL, 2MB guard, core+history merged, try/catch'd) — returning users paint instantly then revalidate (mirrors Wave-1 C1). **VERIFY after backend restart:** `curl '/api/rwa/bundle?tier=core'` → 6 keys + `meta.tier:'core'`; `?tier=history` → 3 series; no-tier → all 9. Browser: overview paints before TVL/flows charts; repeat cold load instant.

### Wave 4b — tokenized-assets follow-up, shipped 2026-06-18 (build clean; backend restart needed to verify slim core live)
Profiled the live page (warm dev ~1.3s to data-ready, LS instant-paint seed confirmed working at 853KB). Two remaining first-visit costs, both fixed:
- **core payload bloat** — the `tier=core` payload was **591KB**, of which `stablecoins[].chainCirculating` (per-chain circulating map across 381 coins) was **307KB / 52%**. That field is read ONLY by the Stablecoins-tab chain-distribution chart + the Screener's chain count — never the default Overview. Stripped it from the core tier via `slimStablecoins()` in BOTH bundle impls (dev `routes/rwa.js`, prod `extended-proxy.js`). Core drops **591→276KB raw / 105→59KB gzip (−44% over the wire)**. The Stablecoins tab now lazy-fetches the full `/api/rwa/stablecoins` on mount (already lazy + activeTab-gated, so naturally deferred) and merges `chainCirculating` by id; the Screener switched to the lightweight `sc.chains` name array (kept in core). The legacy `full` tier is untouched (still carries chainCirculating for non-tiered callers). Browser-verified: Stablecoins tab lazy-fetch fires (200) + chain chart renders, no new console errors.
- **prod cold-assembly** — the core tier is one `Promise.all` cached as a unit, so first paint waits on the slowest of 6 (8MB DefiLlama `protocols` + Spectre `breakdown`/`index` spikes 1-5s). Dev stays hot via `rwaWarmer` (3-min loop), but **prod serverless has no warmer** — every 60s CDN miss re-paid the cold assembly. Bumped the bundle CDN headers **`s-maxage` 60→180 + SWR 120→600** in both impls (RWA aggregates move slowly, so 3-min CDN + 10-min stale-while-revalidate is safe and keeps prod off the cold path). **VERIFY after backend restart:** `curl '/api/rwa/bundle?tier=core' | wc -c` ≈ 280KB (was ~590KB); stablecoins entries have no `chainCirculating`; `/api/rwa/stablecoins` still full.

### Wave 5 — shipped 2026-06-18 (build clean, check-critical-path OK)
Closed the remaining frontend-only "small things that accumulate" (plan §C1/§D leftovers):
- **A8 confirmed already done** — home `useMarketIntel` boots `slim`, upgrades to `full` only on a derivatives tab (`use-market-intelligence.js:36`). Stale "deferred" note removed.
- **potential-gainers instant-paint** — `useMomentumData` got a localStorage write-through seed (10-min TTL, `spectre-momentum-v1:` prefix, opt-in `persist:true`). Enabled on the two board surfaces (`useMomentumSetups` + `useMomentumSignals`): a fresh-enough snapshot paints the board instantly on cold reload, then revalidates in the background. Seed suppresses the loading flip (`seeded` guard) so no shimmer flash. Other surfaces (performance/receipts/history) unchanged.
- **fear-greed instant-paint** — `useFearGreedData` persists a compact snapshot (`spectre-feargreed-v1`, 1-h TTL): current + 365-day history + global + movers + btc, each capped to the fast-tier size so quota is safe. Hydrated on mount (factors recomputed from seed), then `fetchFast` revalidates + writes through. The 2600-day upgrade still re-loads via the background tier. Save is skipped on an all-failed poll so a good seed isn't clobbered.
- **stock quotes cache+dedup** — `stockApi.getStockQuotes` now has a module cache (25s TTL) + in-flight dedup keyed by the sorted symbol set, killing the gm-dashboard/categories mount double-fire and concurrent-widget double-fetch. LS fallback (`spectre-stockq-v1:`, 6-h TTL) returns last-known prices when the server returns empty (market closed / cold serverless) instead of flashing empty — never fabricated data. (True instant-paint would need caller changes; out of proportion for a P2 — dedup + fallback is the meaningful win within the function contract.)

**Deferred to a server PR (Section E):** polymarket `/events` filter/projection, xdash bootstrap `?fields=`, dossier signals `?ca=`, open-interest `?meta_only` (KD), rwa bundle fold, momentum + market serverless parity, private/deals pagination. Needs vercel.json parity check + Backy/KD coordination.

### Wave 6 — shipped 2026-06-19 (build clean, check-critical-path OK; browser-verify pending)
Fresh re-audit (2 parallel agents: data-layer + bundle/render) over the already-shipped waves — found 4 NET-NEW items, all on LIVE pages. Most of the app re-confirmed clean. Agents rejected several false positives (fallback chains that must not be parallelized: coinGecko fetchAllTopCoins, stockNews/marketNews first-non-empty chains).
- **x-dash recharts off first paint** — the default `leaderboard` view statically pulled `xd-charts` (recharts + d3-hierarchy/selection/zoom, ~70KB gz) even though both chart components there are behind toggles. `XDLeaderboardMap` (list mode `'map'`) + `XDAttentionTreemap` (`attnOpen`) are now `lazy()` + `<Suspense>` inside `views/xd-leaderboard.jsx`. Additionally, all non-default views in `x-dash-page.jsx` (`new/signals/fresh/narratives/categories/creators/rotations/edits/track-record/research/institutions`) converted from static import → `lazyWithRetry` (rendered in the page's existing `<Suspense fallback={null}>`); `XDLeaderboard` (default) + `XDThesis` (always-on strip) stay eager. recharts/d3 now load only when the attention map/map mode opens or a chart-bearing tab is clicked — fulfils the file's own "views are lazy-mounted" header that only `XDConstellation` previously honored. **VERIFY: each tab's content still renders on click; leaderboard map toggle + attention treemap still draw.**
- **potential-gainers below-fold defer** — `PGTrackRecord` (zone 5, below fold) + `PGHistory`/`PGBubbleMap` (inside the collapsed-by-default Advanced section) converted to `lazy()` + `<Suspense>`. `PGEdge` (above-fold equity-curve hero) stays eager — it anchors first paint and is the reason lightweight-charts can't leave the boot path entirely; the win is removing the three below-fold components' own code from the initial page chunk. **VERIFY: Proven-calls chart + Advanced-analytics expand still render.**
- **onchainApi cache+dedup** — the one major data-layer service with zero caching is now guarded: in-flight dedup on EVERY GET (concurrent identical URLs share one promise — kills the duplicate-fetch storm when one token renders across RZ markets + codex hooks + token analytics + trading-chart) + OPT-IN TTL cache via `options.ttl` on slow-moving reads (details 15s, pools/details/trending/holders/holdersChart/heatmap 30s, firstBuyers 60s, networks 5min). Live feeds (`getBatchPrices`, `searchTokens`, `getLatestTrades`) and `getBars` (live candle) are dedup-only, no TTL, to avoid staleness. `getPoolAnalytics` (POST) bypasses entirely.
- **useXDashPrices idle guard** — added `document.hidden || !isAppActive()` to its raw `setInterval` poll; the wave-1 C3 sweep retrofitted the other 6 xdash hooks but missed this one.

**x-intelligence (the /x-intelligence force-graph page — NOT x-bubbles, which §D covered) — slow data load fixed** (`pages/x-intelligence/hooks/useCrawlGraph.js`). The default "galaxy" view did: bootstrap → for top-6 projects, paginate `/api/xdash/token/{id}` up to 8 pages each (~18-48 requests), and only `setData` after ALL settled — so first paint waited on the entire fan-out, and one hung page stalled it to `FETCH_TIMEOUT` (18s). Measured locally: bootstrap 1.08s/141KB; each `/token` page **2.05s / 269KB and NOT server-cached** (identical 2nd call also 2.05s). Three fixes:
  1. **Progressive render** — paint the bootstrap-seeded graph (3 top_authors/project) immediately after ONE request, then enrich the hot projects in the background and swap in the richer graph. First paint = 1 request instead of ~48.
  2. **Bounded enrichment** — page 1 already returns ~20 top_authors, so `DEPTH_MODES.expandPages` caps pages/project: Standard (default) = 1 page, Deep = 3 (was a hard 8-page cap for all). Default enrichment drops from ~18-48 `/token` calls to 6 (one/project, parallel ~2s). Full galaxy now ~3s (bootstrap + 6 parallel page-1) vs the old all-or-nothing fan-out; ~1.6MB vs ~4.8MB over the wire.
  3. **localStorage instant-paint** (`spectre-xintel-crawl-v1:`, 30-min TTL) — persists the plain `rawEntries` (graph Maps don't serialize; rebuilt via `buildCrawlGraph` on hydrate) so a cold reload paints instantly then revalidates. Errors no longer wipe a seed-painted graph.
  - **NOTE/follow-up:** the `/api/xdash/token/{id}` endpoint is ~270KB/2s and uncached server-side, and ships full mention/tweet bodies we discard (we keep only aggregated authors + ~20 top_mentions). A server-side cache + author-only projection is the next lever (backend PR). `useProjectGraph` (single-project drill-down) still paginates up to 10 pages — left as-is (focused view wants the full author set). **VERIFY: galaxy paints fast, fills in ~3s; Deep mode still pulls richer author sets; reload paints from seed.**

**Re-audit confirmed still-clean (no action):** all other xdash hooks (dedup + idle guards present), all 6 contexts (memoized values, Monarch split), render bodies (no new unmemo'd large-array work), three/framer-motion/lightweight already lazy where appropriate, boot path lean (entry ~105KB gz, check-critical-path fenced). Remaining minor P2s noted but skipped: `getSpectreToken*` dedup (useTokenProfile/useMarketScenario), profileSync dedup (already `didSync`-guarded), and the C3 P2 idle-guard backlog (useTrendingTickers/usePairTrades/etc — `document.hidden` present, `isAppActive()` absent).

**Gated pages NOT yet audited (Coming-Soon):** discover, you, brain, pulse, search-engine, liquidation-heatmap, ai-market-analysis, world, social-zone, intelligence-feed. Several heavy (you/discover/pulse/brain) — audit when unlocked.

### Wave 7 — welcome Top Coins ("welcome-discovery-block") slow load, shipped 2026-06-30 (build clean, check-critical-path OK)
User report: Top Coins table on the welcome page often paints slow. Traced the full path (`discovery-section.jsx` → `use-top-section-data.js` → `getTopCoinsMarketsPage` → Spectre `/data-api/v1/coins/markets`, CG fallback). Three fixes:
- **Instant-paint seed was dead on the default view (the real bug).** `use-top-section-data.js:40` guarded the snapshot hydrate with `if (categoryFilter) return []`, but the default tab passes `categoryFilter==='all'` (truthy) — so the page-1 snapshot was WRITTEN every visit (`snapPut('top-coins:p1:${size}')`, line ~214, fires because `isCategory` is false for 'all') but NEVER READ. Every cold reload threw away a good cached table and shimmered while the network ran. Fix: `if (categoryFilter && categoryFilter !== 'all') return []`. Returning visitors (24h snapshot TTL) now paint the table at first commit, numbers instant, sparklines fill on revalidate.
- **Cold-start prod edge TTL.** The primary path bypasses Express entirely — prod resolves `/data-api/v1/coins/markets` via vercel.json → `data-api?fn=extended-proxy&route=v1-proxy` → `handleV1Proxy` (`extended-proxy.js:2625`), which DOES set `s-maxage`+`CDN-Cache-Control` from `ttlForV1Path()` and holds a per-instance memory cache (stale-on-error). But `coins/markets` fell to the generic 300s default. Bumped it to a dedicated **600s** (`ttlForV1Path`, `extended-proxy.js`): the client overlays live prices (`useLivePrices`) and the ranking/7d-sparkline/%-change/mcap columns move slowly, so a 10-min edge + 20-min SWR is safe and cuts cold round-trips to the remote Spectre box (`204.168.244.18:3850`). **VERIFY on a Vercel preview** (dev hits the box directly via the Vite `/data-api` proxy, bypassing this handler — can't verify locally). A backend setInterval warmer does NOT fit here: the primary path is serverless+edge, not an in-process Express cache, so rwaWarmer's pattern doesn't apply.
- **Row skeleton over single shimmer bar (cosmetic).** `discovery-section.jsx` loading state was one 48px `animate-shimmer` bar; replaced with the On-Chain tab's `tdt-loading-skeleton` row pattern matched to the `tdt-top-coins` column grid (rank/fav/project/price/24h/7d/30d/1y/mcap/volume/sparkline). Table shape is visible before data lands, no layout jump. Watchlist-empty text fallback preserved.

### Wave 8 — Research Zone tab audit + fixes, shipped 2026-07-07 (build clean, browser-verified on BTC)
Full RZ re-audit (5 read-only agents + live Playwright network trace per tab). Measured before: Sentiment open ~45 req, Technicals ~24, boot pulled 20 direct Binance kline chunks (~1.4MB). Shipped:
- **Intel bundle gating** — `research-zone-pro.jsx` `intelEnabled` now technicals-only (SentimentTab consumed ZERO intel props — destructured but never read); new `mode:'deriv'` in `useMarketIntel` → new `getSpectreIntelDerivBundle` (funding/OI/LSR only). New `priceScope:'majors'` on `getDerivativeRows` + the three derivative getters skips the 500-symbol `/v1/prices` enrichment (5 chunks ~220KB); the full home bundle is also majors-scoped now; traders-corner keeps `'all'` (its OI heatmap renders per-row prices). **`areTechnicalsEqual` now compares fundingRates/longShortRatio/openInterest** — deriv data lands post-mount and the memo held DEFAULTS (LSR "1.00") until the next price tick.
- **Dead sentiment fetch/code removal** — deleted never-rendered `SentimentChartSection`/`SentimentStrip`/`SentimentHero` (~21KB source) + dead props/comparator lines; shell sentiment block fetches score/90d-plot/market-details only for mobile/cinema (desktop SentimentTab needs only `getTokenSocial`).
- **Dedups** — `useSentimentEngine` xdash call re-shaped to match `useKolBubbles` exactly (`24h/all/50`) → shared CLIENT_CACHE entry, 4→2 requests; macro dominance-history 8d→90d (collapses onto rz-market-context's 90d call); `useSpectreAssetData` + `useDossierProject` got inflight dedup + module cache (Project tab StrictMode/re-open no longer double-fires the 6-request fan-out — verified ×1 live); `getTokenMarkets` reuses the fresh address-less cache entry when identity backfill re-keys (`SYM:cgid` → `SYM:cgid:0x…`).
- **Macro context split** — `use-macro-context.js`: 7-request base load module-cached (120s) and decoupled from funding ticks (previously EVERY 60s funding update re-fired the whole load incl. a 485KB CG top-250-with-sparklines pull; now `sparkline:false` ~90KB + funding recomposes from cache).
- **Chart speculative preload capped** — `useChartData` cheap-source buffer-extend stops at `SPEC_BUFFER_CHEAP=4000` bars without scroll intent (was: full 20k-bar buffer = 20 Binance chunks on every RZ boot). Deep history still loads on real scroll-back intent. Verified: boot 20→5 chunks.
- **Measured after:** Technicals = 3 derivatives calls + 1 majors-price call (was 8 upstreams + 5 chunks, ~220KB); Sentiment open lost the whole intel fan-out + xdash/plot dupes; tab switching no longer re-pulls the bundle.
- **NOT touched (deliberate):** bootstrap-vs-legacy fan-out (`use-research-zone-data.js:660` — bootstrap itself measures 2.4-8.2s uncached on Hetzner; removing the parallel legacy path would SLOW first paint; needs server-side caching first); `/api/x-bubbles/:asset` vs `/v1/social/x-bubbles` dual routes (different sources/shapes — needs a unification pass, both currently slow/aborting).
- **Data-lane blockers for Alaa/KD (measured 2026-07-07, repeat-call):** `/v1/prices/BTC/ohlcv` intraday = **14-17s stable, no cache** (client aborts at 8s → Codex `/api/bars` fallback pays double latency on every Technicals series); `/v1/rz/BTC/bootstrap` **2.4-8.2s, no server cache** (the composite meant to speed RZ boot); `/api/xdash/token` 1.7-10.6s/184KB; `/v1/social/feed` cold 7.4s (why the Tweets rail sits on "Loading tweets…").

### Wave 9 — home data-paint speedup, shipped 2026-07-07 (build clean, browser-verified; NOT pushed)
User report: home page data paints slow. Live-profiled dev (Playwright) + prod (user Chrome). Findings: prod data layer healthy (edge-cached, <1s); a scary "hero stuck on placeholders" repro on prod turned out to be a HIDDEN-TAB artifact (createPollingStore correctly skips fetches while `document.hidden`; automated/background tabs never fetch — do not chase this as a prod bug). The real waste was client-side:
- **createPollingStore stale-seed instant paint** — `loadFromStorage` discarded seeds older than `storageTTL` (5min), so every return-after-5min visit shimmered the hero (market cap / BTC/SOL/ETH / ticker) for 1-2.5s waiting on the network. New `staleServeMax` (60min default): stale-but-recent seeds hydrate instantly, the subscribe-time forced fetch revalidates. Hero paints ~600ms with real numbers on a 20-min-old cache (was: shimmer).
- **createPollingStore subscribe** — comment promised a force-fetch when a subscriber "widened the key set", code only checked interval change; new symbols could wait a full tick (30-60s). Now key-widening triggers the (gap-guarded) fetch.
- **spectreMarketApi.fetchBaseJson background revalidate was a NO-OP** — the persist-seed branch re-stamped the seed `ts=now` into the memory cache, so its recursive "background refresh" hit the fresh cache and never reached the network; stale seeds were served with zero revalidation until the next poll tick. Restructured: seed keeps its original ts, returns instantly, the real network request runs in background (updates CACHE + LS).
- **index.html early-fetch extended for home** — top-250 `/data-api/v1/coins/markets` (~480KB, the page's largest payload) + `/v1/market/global` + `/v1/market/dominance` now fire at HTML-parse time (~600-800ms before the JS boot fired them), each skipped when a fresh (<10min) `spectre-market-seed-v1:` LS seed will paint anyway. Verified consumed on cold loads (`__EARLY_FETCH` keys drained).
- **codexApi trending dedup** — `/api/tokens/trending` fired ×4 per home load: StrictMode double + the empty-Codex path firing the same URL from two call sites (line-809 fallback miss, then `finalize()`'s granular enrichment). New shared `codexTrendingCached` (30s TTL + inflight dedup) used by both; `getTrendingTokens` itself also wrapped in `deduplicatedFetch`. Now ×1.
- **Measurement traps for future audits:** Vite dev overflows the 250-entry resource-timing buffer (400+ module entries) — absent entries ≠ absent requests; Chrome-MCP tabs report `document.hidden=true` (background window), which suppresses every polling store — override `document.hidden` before profiling data hooks.

### Wave 10 — welcome trending ticker first-load, shipped 2026-07-08 (build clean, browser-verified; PR #1248 → main)
User report: token-ticker (sentiment-bullish) tokens load slowly. Traced `TokenTicker` ← `tickerTokens` ← `useTrendingTokens('onchain')` ← `codexApi.fetchTrendingTokens`. Root cause: the PRIMARY Spectre Onchain Bridge (`onchain.spectreai.io`) is dead from dev — **Cloudflare 403 bot-challenge even with the browser-UA workaround** (`onchain-client.js:243`, verified curl 2026-07-08) — so every load burned ~0.5s on two guaranteed-empty bridge calls, THEN serially fired the Codex fallback (1.2s+), then awaited CG top-250 sparkline enrichment. Measured ticker fill: ~1s warm / 2.2s+ cold. Prod research relays via trade.spectreai.io (works, extra hop). Fixes (frontend lane):
- **Bridge-down cooldown persisted in localStorage** (`spectre-onchain-bridge-down-until`, 5 min, `codexApi.js`) — after both chains come back empty/failed, subsequent loads skip the bridge leg entirely; cleared on first success.
- **index.html early-fetch** (home branch): bridge URLs fired at HTML-parse time (skipped when cooldown flag set); the Codex fallback URL pre-fired on localhost always (dev bridge = always CF-blocked) and on prod only when bridge is known-down (cost-war: no extra Codex query while prod bridge healthy). Adopted via `consumeEarlyFetch` in `codexTrendingCached` + the bridge fetches.
- **Sparkline enrichment capped at 1200ms** (`Promise.race`) — a cold 480KB top-250 download no longer blocks ticker/table fill; consumers fall back to synthetic sparklines (`generateSeededSparkline`).
- **Measured after:** first-ever visit (storage cleared) ticker fill **626ms**, repeat visit **480ms**; requests start at t≈40ms; exactly 1 trending fetch (early-fetch consumed, verified via fetch interceptor). Note: Vite dev shows a phantom duplicate resource-timing entry for the early fetch — interceptor proves 1 real call.
- **NOT fixed (other lanes):** CF WAF exception for dev/research egress on onchain.spectreai.io (infra, Gleb/KD — restores the quality bridge feed + kills the prod relay hop); ticker CPU animations (measured: ticker = ~85% of welcome-page renderer main-thread, 756→111 ms/s when hidden; 114 infinite CSS animations, worst = `dotPulse` animating SVG `r` → 109 layouts/sec; fix approved separately).

### Wave 11 — Research Zone full re-audit (bugs + CPU + dedup), shipped 2026-07-09 (build clean, check-critical-path OK; NOT pushed, browser-verify pending)
Fresh 4-agent RZ audit (data-layer / render-CPU / load-speed / functional-bugs) over the post-Wave-8 tree. Wave 8 confirmed mostly holding; this closed the NET-NEW findings. Correctness bugs were the headline (wrong token's data rendering under the new token on switch).
- **Shared `useRef` cancel-flag → per-effect `let cancelled` (5 hooks):** `useSpectreAssetData`, `useDossierProject`, `useTokenMentions`, `usePairTrades`, `useLiveDumpForensics`. RZ keeps these mounted across token switches, so a hook-scope ref reset to `false` by the next effect run let token A's slow (3-15s cold) response `setData` onto token B (A's VC rounds / dossier / mentions / trades / dump-verdict painted under B). Closure flag captures per-run — the pattern `use-token-safety`/`use-mtf-thesis` already use.
- **Reset-on-switch added where missing:** `useTokenMentions` (+`setData(null)` — also stopped a failed B fetch persisting A's mentions), `useLiveDumpForensics`, `useNarrativeRadar`. `usePairTrades` also had `if (resolved) return` that **latched on token A's pool forever** — added ca-change reset of `resolved`+`data` (explicit chain+pair callers unaffected).
- **`useSentimentEngine` mindshareHistory:** was carried across a REAL symbol switch (prevSymRef added) — a fresh runner with no v2 row plotted the previous token's crowd line AND `saveSeed` persisted it into the runner's localStorage seed. Now only carried across a same-sym cgId-resolve.
- **`use-mtf-thesis` barsByTf:** merged onto the previous token's TF slots — a young token with no 1D/1W seed inherited the prior token's daily/weekly and `buildConfluence` blended two assets. Now `setBarsByTf(seeded)` unconditionally on switch.
- **`areSentimentEqual` (rz-sentiment-tab):** the comparator's comment falsely claimed the tab reads only `td.cgId/logo/name`; it passes the whole `td` into `useSentimentEngine`, which reads price/change24h/change7d/marketCap/mcap/fdv/rank/totalSupply — so a price tick was skipped and froze Market-Pulse + the since-tracked ROI (vs live mcap). Added those ticking fields to the comparator (mirrors the earlier `areTechnicalsEqual` fix).
- **`rz-trade-tape`:** negative net flow lost its minus sign (`fmtUsd` does `Math.abs`) — a sell-heavy tape read as balanced. Fixed the sign prefix.
- **CPU — KOL bubbles (`rz-kol-bubbles`):** the force sim is perpetual by design (orbit + breathing never settle — the "settles-and-stops" project-memory note is STALE), and it sits deep in a long Sentiment tab, so it burned 60fps while scrolled out of view. Added an **IntersectionObserver** (run rAF only when on-screen AND tab-visible) + **cached the hub aura radial-gradient** (was `createRadialGradient` every frame → GC churn). Did NOT add a settle detector (would fight the intentional motion).
- **CPU — `ProjectCinema` (live Project tab):** zero memoization → a price tick re-rendered all 11 sections though only 2 read `td`. Extracted the 9 non-`td` sections into a `React.memo`'d `ProjectCinemaBody` (props derive from dossier/spectreData, poll every 5min = stable between ticks). `StageSection`/`ReadSection` stay on the tick path.
- **CPU — mobile `RzmProjectSections`:** not memoized → re-ran the whole 11-section tree on every pull-to-refresh touchmove frame + every tick. `export default React.memo(...)`.
- **CPU — `rz-technicals-tab` `marketStructure`:** live `price` + `mcap` (both tick) in the memo gave it a fresh identity per tick → rebuilt the whole qualitative trade thesis (buildCases/buildLenses/buildRebound). Quantized both to 4 sig-figs (~0.1%, invisible in prose) for the memo.
- **CPU — `use-kline-indicators`:** the 120s force-refetch always `setBars(new array)` even when candles were byte-identical → full indicator recompute (EMA200×2/stochRSI/ATR/MACD/BB/S-R/regime over ~320 bars) for nothing. Added a last-bar+length equality bail. Also added the missing `isAppActive()` idle guard to that poll.
- **Dedup/polling:** `useKolBubbles` `/api/x-bubbles` leg got a module cache+inflight (it duplicated the concept `useSentimentEngine` already pulls; both mount on the same Sentiment tab). Official-tweets poll gained the rail-visibility ref check its sibling search-tweets poll already had.
- **CSS repaint:** lite markets-table sticky `thead` `blur(20px) saturate(180%)`→`blur(10px)` (bg is near-opaque 0.95, saturate was doing nothing); whale-badge infinite `filter: brightness()` keyframe → `opacity` (compositor-only); pro project-explorer sticky thead `blur(12px)`→`blur(8px)`.
- **CHECKED, NOT touched:** `welcome-page.css` (17k lines) IS imported by `research-zone-lite.jsx` but is NOT dead — it holds hundreds of generic non-`welcome-`-prefixed selectors (`.activity-card`, `.ai-agent-*`, `.action-btn`…) that RZ-lite reuses; the load agent's "0 welcome- classNames" was a false read. Removing it would break the layout. Left as-is.
- **Deferred (P2, follow-up):** mobile Technicals derivations gated behind `techEverOpened` (4-memo chain, null-deref risk in consumers — needs full verify); `rz-agent-chat` lazy-mount + streaming rAF-throttle; appresearch pinned-price freeze (touches the RISKY SSE/poll deconfliction — needs browser-verify); voice-mode stale `sendMessage` ref.
- **Data-lane (Alaa/KD, unchanged from Wave 8):** `/v1/rz/{SYM}/bootstrap` 2.4-8.2s uncached, `/v1/prices/{SYM}/ohlcv` 14-17s, `/api/xdash/token` 1.7-10.6s — the real cold-load cost; app-lane is already lean around them.

### Wave 12 — 2026-08-18 platform re-audit + 5 PRs (Evgeniy; #1431-#1435 → main)

Fresh 3-agent verification pass over this plan. **Many long-standing entries are now STALE — corrections first:**

- **E#3-#6 serverless parity: MOSTLY CLOSED by others since June.** momentum/* (social-proxy.js, richer than dev), coinglass total-oi/total-liquidations (derivatives-proxy.js), UDF config+time (tradingview-udf.js, better headers than dev), social/mentions (fixed 2026-07-02), market/mindshare + dominance-history + alt-season all have live prod handlers. Do NOT re-open these.
- **§C3 P2 idle-guard backlog: CLOSED.** useTrendingTickers/useSpectreAssetData/useLiveDumpForensics/usePairTrades/useDetectiveFeed/alerts-page all carry the gold-standard guard now; the last three stragglers (useNotificationPoller — app-wide reach, useMindshareV2, useRealtimePrice) shipped in PR #1431.
- **C2 sharedTopCoinsStore: DELETED** (PR #1431) — executing this plan's own recommendation; Wave 1 shipped the LS seed separately so the store's remaining value was zero. Also deleted: smart-money-pulse.jsx/.css (~1900 lines, unmounted since 2026-02-26, carried an unguarded 25fps SVG radar), useMarketIntel.fetchJSON, Express /api/market/dominance (prod path 400'd unnoticed = proven dead). ⚠️ /api/coingecko/top looked dead from research but the TRADING app calls it (apps/trading/src/services/codexApi.js:897) — kept; check trading before killing any "dead" route.
- **E#16 Cache-Control: DONE** (PR #1434) — fear-greed/current|historical|global-metrics|movers + a scoped middleware for the whole /api/xdash/* band (uniform s-maxage=30/SWR=60 default; per-route setters still win). Bonus real bug: news/history's in-memory cache keyed on days only while the fetch builds per-symbol category sets — BTC history was served to ETH callers; key now includes symbol (mirrors the serverless twin).
- **§B/E "market/liquidations degrades in prod": WORSE than recorded, now FIXED** (PR #1433). The serverless handler proxied a path that NEVER existed on the Hetzner box (404) → all-zero envelope on every request since it was written; AND the dev WS aggregator sat at connected:true / eventCount:0 for 4.6 days (zero events ever received). Both now compose the envelope from the box's live lanes (/v1/derivatives/liquidation-windows + /v1/derivatives/liquidations); dev's empty buffer no longer reports connected:true. Consumers were mostly saved by their primaries — the fallback lane was silently substituting "no liquidations".
- **Resilience** (PR #1432): timeouts on the four hang-forever fetches (useMindshareData 8s — permanent shimmer, prod-only; binanceApi tryFetch 6s; coinGeckoApi getMajorTokenPrices BOTH legs 8s — the Promise.all leg blocked the whole price map when CG hung even with Spectre answered); use-real-heatmap stuck-shimmer guard.
- **Header CPU** (PR #1431): lineFromLeft/Right animated `width` (layout/frame, permanent will-change, visible 3s per 120s) → scaleX; infoRingPulse + day-mode twin animated border-color (paint/frame all session) → opacity-only. Same class as the Wave-10 dotPulse.
- **Dev-lite gaps closed** (PR #1431): trending-brief LLM board-warmer (100 briefs / 5min) + social-signals 90s fan-out now respect SPECTRE_DEV_LITE (social-signals falls back to on-demand tick). NOTE: plain `dev` does NOT set the flag — only `dev:lite`.
- **xdash instant-paint shipped** (PR #1435): opt-in `persist:true` LS seed in useXDashBootstrap (slimmed RAW payload — quality/top_authors/top_mentions/momentum_entry stripped, re-normalized on hydrate: 458KB→162KB) + useXDashSurface. Enabled on the /x-dash hero board fetch (page1/48/all — table+treemap slice it), home social-mindshare-section, hero-strip narratives. Verified: with the API server KILLED the /x-dash board still paints 60 rows + hero cards + treemap from seed, zero shimmer.
- **🪤 NEW PLATFORM CEILING — localStorage seed quota is SATURATED.** Measured on a warm dev profile: 4.9MB of ~5MB used across 133 keys (momentum 689KB, polymarket 641KB, market-seeds ~1.1MB, rwa 413KB, kalshi 401KB, settings 240KB, cg-page1 246KB…). Any NEW seed write throws QuotaExceeded and every seed helper swallows it silently — new instant-paint features simply never engage on warm profiles, with zero signal. The xdash seedPut purges its OWN stale keys and retries once, but the real fix is cross-cutting: a shared seed-budget manager (registry of prefixes + TTLs + LRU eviction) or moving the big seeds (rwa/momentum/polymarket/market) to IndexedDB. This should be the next C-class systemic item.
- **Still open after this wave:** ⚠️ superseded one day later — the payload items listed here (E#1, E#2, E#10, E#11) were RE-MEASURED and mostly struck. See Wave 13 + the recalibration box in Section E before acting on any of them. What genuinely remains: the latency items, and the latent P0s behind Coming-Soon (brain rewrite is single-segment — /api/brain/awareness/full and /api/brain/chat/stream fall to the SPA catch-all; social-signals + ai/answer + you/compose/stream have no prod rewrite) — must land before those pages unlock.

### Wave 13 — 2026-08-19: seed trims + a recalibration of this document (Evgeniy; PR #1436)

**The headline is a correction to how this plan sizes work, not a code change.**

- **Section E was sized in RAW bytes against a gzipped wire.** Gzip has been on globally the whole time and this JSON compresses **6-6.6x**: polymarket/events is 761KB raw but **153KB over the wire**, private/deals **8KB**, xdash/bootstrap **46KB**, dossier/signals **2KB**. Two P0s and two P1s struck; `polymarket ?category=` additionally rejected as *wrong for the UI* (the category pills filter client-side so switching is network-free — server filtering would ADD requests). Full detail in the Section E box. **Use gzipped size for network arguments, raw for localStorage and JSON.parse.**
- **What replaced them:** the backend table in Section E is now ranked by SECONDS. `/api/xdash/token/:cgId` (~270KB, ~2s, no server cache at all) and the data-lane endpoints are the real remaining server wins.

**Shipped (#1436):** the two fattest localStorage seeds trimmed — polymarket 927KB→613KB (3 nested market fields with zero readers; `clobTokenIds` is only ever read off a fresh `/event-bundle`, never off the list cache) + a 150-event cap matching kalshi's; and the `/coins/markets` seed 428KB→214KB (`sparkline_in_7d` stripped from the PERSISTED copy only — callers still receive it, verified 36/40 rows, and consumers already fall back to a synthetic sparkline per Wave 1/7). ~520KB freed, ~10% of the origin budget.

**Deliberately NOT built, and why it matters if someone revives it:** a shared seed-budget/GC layer (registry + quota eviction + boot sweep) was written and then dropped. localStorage is a hard **~4.95MB per origin** (probed), prod sits at **2.5MB** — so the growth is real but the urgency was not, and the boot sweep would have read every seed value on every load. It also carried a defect worth remembering: a `ts` probe scanning only the first 400 chars **misreads `spectre-kalshi-events`, which stores `ts` at byte 413,732** — so a freshly-written seed sorts as "oldest" and would be evicted FIRST. The underlying diagnosis still stands and is the reason to revisit: **every seed TTL in the app is checked lazily on read of its own key, so a cache whose page is never revisited never expires**, and all ~35 writers swallow QuotaExceeded in an empty catch (zero signal when it starts failing).

**The server-side backlog is now EMPTY.** Every remaining server item in this document was re-measured on 2026-08-19 and none survived: the parity P0s were closed by others months ago, the payload P0/P1s were sized in raw bytes against a gzipped wire, and the last one (xdash token "uncached") is cached on all three levels. **The only server-side latency left anywhere is the data lane, which is Alaa/KD's code.** If someone hands you this plan and asks "what's next on the server", the answer is nothing — go measure something new instead of trusting a row in this table.

**🪤 New traps:**
- **`CDN-Cache-Control` is NOT required for Vercel to edge-cache cookie-bearing requests** — despite the 2026-06-03 audit note in `fear-greed.js` claiming "cookies disable edge caching ... single biggest perf lever". Measured on prod from an authenticated session: `/api/xdash/token/*`, which sets ONLY `Cache-Control: s-maxage=60`, went **MISS 3356ms → HIT 111ms → HIT 90ms**. 34 of 41 serverless handlers set no `CDN-Cache-Control` (social-proxy alone has 40 `Cache-Control` sites and zero CDN ones) — **do not "fix" them**, it is a no-op.
- `getSpectreTopMarketsPage(page, perPage)` takes **no third argument** and hits `/prices`, which carries no sparklines. Testing a sparkline change through it reports a false failure — use `getSpectreCoinsMarketsPage(page, perPage, {sparkline})`.
- **A route with zero research consumers may still have a TRADING one.** `/api/coingecko/top` looked dead from research and is called by `apps/trading/src/services/codexApi.js:897`. Grep both apps before deleting.

---

## G. What's Already Good (don't touch)

- **Top-coins page-1 dedup** — shared-inflight collapses all `perPage ≤ 250` callers to one 412KB fetch (B1).
- **Polling visibility** — `useAdaptivePolling` + most raw hooks guard `document.hidden`; watchlist main poll is the gold standard (`document.hidden || !isAppActive()`).
- **Reference-quality pages:** bubbles (phase-split payload, idle enrichment, parallel streamed pages), traders-corner (tiered idle-deferred loaders, slim intel, service-layer OI dedup), economic-calendar (5→1 bundle, IO-gated below-fold), monarch-chat (SSE, LS-hydrated, bounded payload), zigchain (IO gating, LS seed, guarded polling), research-zone below-fold (`deferReady`/tab-gated).
- **Inflight dedup** present on coinGeckoApi (multiple), spectreMarketApi `fetchBaseJson`, intel bundles, fearGreedApi, momentum, codex `_shared`.
- **Server:** global gzip; `/api/bars` cost waterfall; allorigins timeout; resolution-bucketed UDF cache keys.
- **Boot deferral already shipped:** A7 (home derivatives → idle), A8 (slim intel boot), user-dashboard wallet-balance lazy-gate.
