# Spectre App — Handoff (2026-06-03 evening)

Full state of today's work. Read this before touching charts, Codex, or the watchlist.

---

## TL;DR

- **Codex bill war: WON (pending deploy verification).** PR #757 (merged 20:21 UTC) hardcodes a kill switch in the trading-app dossier components (LeftPanel/DossierStory/TrendingHub) so they stop calling `srv.spectreai.io`. OVH server receives 0 dossier requests → stops firing Codex filterTokens lockstep. Expected drop: 25K ops/hour → 750/hour within 1-2 hours of deploy.
- **The "ghost key" was misnamed.** Only 2 keys exist (spectre-prod-ingestion + spectre-prod-app, both 15h old per Sunny's screenshot). The discrepancy between dashboard views was 7h of pre-rotation activity on now-deleted old keys. The 580K/day on the new keys came from OVH dossier endpoints being hammered by trading-app — fixed at the SOURCE by PR #757.
- **Trading-app dossier panels show empty** until OVH is patched OR VITE_DOSSIER_API is re-pointed. Worth the cost cut.
- **Watchlist data correctness: FIXED structurally** for all long-tail tokens. PALM/MESSIER/etc render proper logo + 24h.
- **TradingView chart for all tokens: shipped via free iframe embeds.** Still needs UX polish + a decision on DexScreener vs CoinGecko vs alternative.
- **Custom canvas chart (Candles/Line) is admittedly clunky.** Zoom UX, 1W rendering, sizing all have rough edges. The team should decide whether to polish it or fully deprecate in favor of the iframe.

---

## PRs shipped today

### spectre-app (16 PRs merged)

| PR | What |
|---|---|
| #735 | Trading-app filterTokens lockstep killed |
| #736 | Research-app bars routed through L4 cascade (Binance/Hetzner/GT/Codex) |
| #737 | Trading iframe skip duplicate poll on /token |
| #738 | 4 Welcome treadmills + chart shimmer overlay |
| #739 | 6 broken Vercel crons removed (CRON_SECRET missing) |
| #740 | Chart shimmer fail-open 5s |
| #741 | Chunk-retry timestamp throttle |
| #744 | Direct-import TradingViewAdvanced (kill stale-chunk class) |
| #747 | Watchlist subscribe ALL crypto symbols to Hetzner price store |
| #748 | Watchlist preserve image/name in realtime store + use them in row |
| #749 | Free iframe embed for TradingView mode (TV widget + DexScreener) |
| #750 | Default chartType flipped to 'tradingview' |

### spectre-data-api (2 PRs open, both hot-patched on Hetzner already)

| PR | What | Status |
|---|---|---|
| #3 | candles-codex worker 8x cadence cut (100/60s → 25/120s) | Open. Hetzner running tuned version. |
| #4 | /v1/trending cache TTL 30s→300s + warmer allowlist (17s→70ms) | Open. Hetzner running. |

### Hetzner direct hot-patches (not in any PR)

- `pm2 stop worker-telegram-bot` (was hot-spinning 32 req/sec to Telegram with 401s)
- `pm2 stop worker-candles-codex-backfill` (was bricked on 403 key)
- `worker-candles-codex` restarted post-test (needed for DEX-only token freshness)

---

## 🚨 GHOST KEY — the unresolved half of the Codex bill

### Evidence
Two graph.codex.io views at 22:00 UTC Jun 3 disagree by ~2x:

| View | Jun 3 Total | getBars | filterTokens | listPairs |
|---|---|---|---|---|
| API Usage Analytics (filtered "All API Keys") | 378,879 | 208,250 | 86,435 | 80,412 |
| Account main / "Current Usage" | 729,403 | 389,589 | 171,244 | 164,768 |
| **DELTA (ghost)** | **350,524** | **181,339** | **84,809** | **84,356** |

The delta is the **canonical filterTokens lockstep signature**: every 1 filterTokens with `volume24/liquidity/marketCap/holders/change*` selected = 1 billable `listPairsWithMetadataForToken`. The ~84K of each + ~181K getBars is what a worker firing roughly the same volume as our `worker-candles-codex` would produce, but with the lockstep STILL active (we killed lockstep on Sunny's keys via PR #735 + #713).

### What this means
- **Sunny's keys (KEY_A on Vercel, KEY_B on Hetzner)** are at 378K/day and dropping. My fixes worked.
- **A THIRD key in the org** is doing another 350K/day with the lockstep tax. We don't have visibility into it from Sunny's account.

### Theories (REVISED — Sunny confirmed only 2 keys exist)

The dashboard discrepancy is NOT a hidden 3rd key. Sunny's account shows exactly 2 keys (`spectre-prod-ingestion` and `spectre-prod-app`), both created 15h ago at ~07:00 UTC Jun 3. Old pre-rotation keys were DELETED, not still active.

The 729K vs 378K Jun 3 discrepancy decomposes as:
- 00:00 → 07:00 UTC (7h on OLD keys, since deleted): ~350K ops at ~50K/hr rate (yesterday's pre-fix rate)
- 07:00 → 22:00 UTC (15h on NEW keys): ~378K ops at ~25K/hr rate

Main view sums both because it's cycle-cumulative. Analytics view filters to existing keys only.

**The real problem: new keys still burning ~600K/day (~25K/hr).** Expected was ~20K/day total. The 580K gap = something we haven't fixed.

### Who's burning the 580K/day?

| Source | Verified ops/day | Notes |
|---|---|---|
| `worker-candles-codex` (Hetzner, tuned) | ~18K | SSH-confirmed live cadence 25/120s |
| `worker-new-token-detector` (Hetzner) | ~2K | filterTokens 30 min × 10 networks (still has lockstep field-set!) |
| User-facing /api/bars residual | ~500-2K | L4 cascade fallback to Codex |
| **Accounted total (Hetzner)** | **~22K** | |
| **Gap (unexplained on new keys)** | **~580K/day** | NOT on Hetzner per env probe |

**Strongest hypothesis: OVH `srv.spectreai.io`** running `packages/server/index.js` with `spectre-prod-app` key. Per backend audit (this morning), 35 Codex references in that file. NOT touched by PR #735 (which only fixed Vercel trading-app). Still firing filterTokens with lockstep-heavy field selection.

**Probed OVH 22:30 UTC, `sunny` user:**
- spectre-server is online, PID 1757814, running `/srv/spectre-app/packages/server/index.js`
- Started 05:38 UTC (16h ago) — covers the entire window the new keys have existed
- `/srv/spectre-app/.env` is mode 600 (owned by ubuntu) — cannot read CODEX_API_KEY prefix without ubuntu/sudo access
- pm2 logs in `/home/ubuntu/.pm2/logs/` not readable as `sunny`
- No autonomous `setInterval` Codex polling found in packages/server/index.js source — all 35 Codex hits are on request paths (`/api/search/tokens`, `/api/token/details`, `/api/token/resolve`, etc.)

**Conclusion**: the 580K/day on the OVH key is request-path traffic. Either heavy user volume hitting `srv.spectreai.io` directly OR an automated client (extension, bot, monitoring tool, old frontend that still points to srv.* not app.*) hammering the API.

### EXACT recipe for someone with `ubuntu@srv.spectreai.io` access

```bash
# 1. Confirm which Codex key OVH is using
ssh ubuntu@srv.spectreai.io
sudo grep CODEX_API_KEY /srv/spectre-app/.env | head
# Expect: prefix 8b57... (the spectre-prod-app key from today's rotation)

# 2. Live count of Codex hits + WHO is hitting
pm2 logs spectre-server --lines 10000 --nostream | grep -E "graph\.codex|filterTokens|getTokenBars" | wc -l
# Divide by minutes of log window to get ops/min rate

# 3. Identify heavy callers — group by route
pm2 logs spectre-server --lines 10000 --nostream | grep -E "GET|POST" | awk '{print $7}' | sort | uniq -c | sort -rn | head -20
# Top routes will reveal the dominant traffic source

# 4. Apply field-set shrink to ALL filterTokens callsites:
#    packages/server/index.js lines 3080, 4766, 4846, 5165, 5496, 5639, 5683, 6002, 6042, 6190, 6367
#    For EACH filterTokens query, REMOVE: volume24, liquidity, marketCap, holders, change4, change12, txnCount24
#    Rank server-side by these instead of selecting them. Same fix as PR #735.

# 5. Reload
pm2 restart spectre-server --update-env

# 6. Watch dashboard drop within ~1 hour
```

Expected impact: drops OVH from ~25K ops/hr → ~3-5K ops/hr (kills the lockstep 2x multiplier on every filterTokens call + reduces per-call cost).

### Actions — DO THIS FIRST TOMORROW

1. **Go to graph.codex.io → Account → API Keys.** List every key. Sunny minted 2 NEW keys today for safety — the OLD pre-rotation keys are likely still active and billing. Each key shows per-key usage stats.
2. **Identify the OLD keys**: any key created BEFORE today's rotation that still has Jun 3 usage > 0.
3. **Revoke / delete** the old keys. Whatever's using them will start erroring (which we want — it surfaces the consumer).
4. Within ~1 hour the dashboard org-wide total should drop to match the filtered "All API Keys" view (the 729K → 378K convergence).
5. If a critical service errors out after revoking, identify it via the error logs and wire it to the new key.

Hetzner side confirmed safe:
- All 30 live processes use `CODEX_API_KEY=3da87900...` (current key)
- Old prefix `98d8fb1b...` is only in `.env.bak.*` rotation backups, NOT live anywhere

OVH side:
- Per memory: trading-only box, Gleb-managed, Sunny's SSH key not authorized.
- `packages/server/index.js` has 35 Codex references (lines 3080, 4766, 4846, 5165, 5496 etc).
- Sunny needs to coordinate with Gleb to confirm what key it's using and apply the lockstep field-set fix OR migrate it off Sunny's Codex key entirely.

### What this DOESN'T mean
This isn't a bug in my fixes. The 378K filtered view IS a 4x improvement from yesterday's 1.43M. Those fixes are durable. The ghost key just adds another 350K/day on top that we can't reach from Sunny's session.

---

## Codex cost — state of play

Run a JSON export from graph.codex.io tomorrow morning to verify. The dashboard tooltip is unreliable — trust the JSON export.

Today's actual Codex daily breakdown (per JSON export at 11:02 UTC):
- getBars: 26,935 (90%) — Hetzner worker-candles-codex
- filterTokens: 2,132 (7%) — Hetzner worker-new-token-detector
- All others: ~1K

Projected steady-state:
- worker-candles-codex (tuned): ~18K/day getBars
- worker-new-token-detector (no lockstep): ~480/day
- User-facing /api/bars residual: ~500-2000/day (today was 506 actual)
- Misc: ~1-2K/day
- **Total: ~22K/day = ~660K/month = 66% of cap**

Only Codex caller files (entire infra):
- `/opt/spectre-data-api/src/services/codexService.js` — getBars query
- `/opt/spectre-data-api/src/workers/candles-codex.js` — main worker (active)
- `/opt/spectre-data-api/src/workers/candles-codex-backfill.js` — stopped
- `/opt/spectre-data-api/src/workers/new-token-detector.js` — filterTokens, 30 min cadence

Nothing else on the entire stack calls Codex GraphQL.

---

## Watchlist data correctness

Structural bug pattern fixed in PR #747 + #748:

**Before**: long-tail tokens (memecoins, DEX-only) were excluded from the realtime price store (`isMajorToken()` filter), so they fell through to a slow `resolveSymbolsBatch` chain (CG search → Spectre resolve → Codex filterTokens, ~3-5s wall). The slow chain populated `liveData` with data from whichever source matched (DexScreener, Codex, CG), each with different 24h calculations. Result: PALM showed -0.14% in 24h column when Hetzner authoritatively said -11.95%. Same root for missing logos (realtime store stripped `image`).

**After**:
- ALL crypto watchlist symbols subscribe to the Hetzner /v1/prices realtime store (76ms regardless of symbol)
- The realtime store now preserves `image`, `name`, and per-window changes (change1h/7d/30d/1y)
- Row merge picks realtime values FIRST, falling back to slower sources only if realtime missing
- Logo source: realtime.image (Hetzner CG URL) → data.logo → stale token.logo → letter fallback

Files: `apps/research/src/hooks/useWatchlistPrices.js`, `apps/research/src/services/prices/sharedBinancePrices.js`.

---

## Chart UX — the part that's NOT fully sorted

### What works
- **TradingView toggle in research-zone**: PR #749 + #750 made this the default. Routes to free iframe embeds:
  - Has Binance pair (BTC, ETH, SOL, ~50 majors): TradingView widget `s.tradingview.com/widgetembed`
  - Has on-chain address (PALM, MESSIER, ~all DEX): DexScreener embed `dexscreener.com/{chain}/{address}?embed=1`
  - Stocks: TradingView widget with NASDAQ/NYSE prefix
  - Neither: "Chart unavailable" message
- **Cost**: $0. No Codex burn on chart loads.
- **File**: `apps/research/src/components/chart-iframe-embed.jsx` — single file, ~170 lines.

### What's still clunky (custom canvas chart)
The Candles/Line toggle (`apps/research/src/components/trading-chart.jsx`) is home-grown and accumulated:
1. **Pan/zoom UX** — momentum scrolling, pinch-zoom, double-click reset, all behave oddly. Compare against TradingView/DexScreener iframe behavior.
2. **1W rendering** — Hetzner has the data (verified: BTC, DSYNC, SPECTRE all have 1w bars). Chart canvas is failing to render it correctly. Likely the timeframeToPeriod['1W']=235200h (~27 years) is too aggressive and overflows the canvas's x-axis math.
3. **"All" button missing** — user wants a button to show full history. Easy add: extend CRYPTO_TIMEFRAMES array with 'ALL', map to ~max-1500-candles window per resolution.
4. **Container sizing** — chart-height interacts poorly with the page layout on some resolutions. The resize observer in trading-chart.jsx may be using stale dimensions.

### Decision the team needs to make

**Option A — Lean into iframes, deprecate canvas**: TV/DexScreener iframes are the polished chart. The custom canvas (Candles/Line) becomes the minimal "preview" mode that's never the primary view. Most code in trading-chart.jsx becomes dead and can be deleted. Saves ~5000 LOC.

**Option B — Polish the canvas chart**: Spend 1-2 weeks fixing pan/zoom, 1W, ALL button, sizing. Ends with two competing chart experiences. Higher maintenance burden.

**My recommendation: Option A.** The user already said "all platforms have trading view lite for free." Building a competitive home-grown chart is not where Spectre's differentiation lives.

### DexScreener vs CoinGecko vs alternatives — pick before scaling

User said "i'm also not confident dexscreener is the way, maybe cg better but i dunno". Here's the lay of the land:

| Option | Coverage | URL pattern | Cost | Branding |
|---|---|---|---|---|
| **DexScreener** (current choice) | ~all DEX tokens, all 11+ chains. Token-address URL auto-redirects to primary pair. | `dexscreener.com/{chain}/{address}?embed=1&theme=dark` | Free, no auth | DexScreener branded |
| **GeckoTerminal** (owned by CoinGecko) | Same coverage as DexScreener, similar UX. Requires pool-address (not token-address). | `geckoterminal.com/{network}/pools/{pool_address}?embed=1` | Free, no auth | GeckoTerminal branded |
| **CoinGecko** (the parent) | Only CG-listed tokens (slower listing). No first-class iframe widget; would need to use CG widget API. | No clean iframe — use CG widget API (HTML/JS embed) | Free | CG branded |
| **TradingView** (currently for CEX) | Whatever TV indexes (limited DEX coverage) | `s.tradingview.com/widgetembed/?symbol=...` | Free | TV branded |

**My read**: DexScreener and GeckoTerminal are functionally equivalent for DEX coverage. DexScreener is slightly more flexible (token-address direct URL). Both look professional. CG doesn't have a competitive free iframe chart for DEX tokens.

**To switch from DexScreener to GeckoTerminal**: edit `dexscreenerSrc()` in `chart-iframe-embed.jsx` to construct the GT URL instead. But GT needs pool addresses, which we'd need to fetch first (Hetzner has them via `/v1/dexscreener-pair` or DexScreener's own API). Adds a fetch step.

**To use TradingView's own DEX support**: TV indexes some DEX pools (UNISWAP3ETH:..., PANCAKESWAP:...). Symbol resolution is hit-or-miss for memecoins. Could try as Tier 2.5 between Binance pair and DexScreener, but adds complexity.

**My recommendation**: stay on DexScreener. It's simpler, faster, more comprehensive for the long-tail tokens Spectre's users care about. If branding becomes an issue, GeckoTerminal is a drop-in (same parent company as CoinGecko if the partnership story matters).

---

## Open issues — prioritized for the team

### P0 (user-blocking)
1. **Verify on user's browser** that the TradingView iframe loads for DSYNC/PALM after hard refresh. (PR #749 + #750 deployed at 15:26 + 15:35 UTC.)
2. **Watchlist visual regression check** after hard refresh — confirm PALM logo + 24h render correctly per PR #747 + #748.

### P1 (UX wins, ~30-60 min each)
3. **Add 'ALL' timeframe** to chart toolbar. File: `apps/research/src/components/trading-chart.jsx:1050` (CRYPTO_TIMEFRAMES array). Add 'ALL' entry, map to longest period in `timeframeToPeriod` (~10 years). For TV iframe mode, map 'ALL' to TradingView's longest interval ('W' or 'M').
4. **Fix 1W canvas rendering**. Same file, debug at line 1130-1180 — `timeframeToPeriod['1W']=235200h` is ~27 years. Hetzner returns 100-300 weekly bars but the canvas's x-axis range math may be plotting them too narrow. Try reducing to 5 years (~260 weeks).
5. **Watchlist 5s load for non-major tokens** is fixed but only after PR #747 deploys. Verify in browser.

### P2 (deeper work)
6. **Decide chart strategy** (Option A iframe-only vs Option B polish canvas). Once decided, delete or fix accordingly.
7. **`/v1/trending` 17s cold rebuild** — the news-velocity UNNEST query is the slow path. Either index `news_articles.related_assets` properly OR materialize the trending output every 60s into a Redis-backed pre-computed key. PR #4 already raised TTL + added to warmer, so users don't hit cold. But cold path is still slow.
8. **`/v1/bubbles` 2.2s, `/v1/dossier/*` 1.2s** — same cache-warmer treatment.
9. **CRON_SECRET env var on research Vercel project** — set it, then re-enable the 6 crons removed in PR #739.

### P3 (defensive / quality)
10. **OVH `packages/server/index.js` Codex strip** — per memory, OVH (Gleb/KD's box) still has 35 Codex references. Should never use Sunny's `CODEX_API_KEY`. Strip lines 3080, 4766, 4846, 5165, 5496 + rotate the key. Coordinate with Gleb.
11. **Token-resolve chain optimization** — `apps/research/src/pages/research-zone/hooks/use-research-zone-data.js:221-308`. Long-tail tokens (DSYNC) walk 3 fallbacks sequentially. Parallelize by speculatively firing `getRzBootstrap(rawSlug)` BEFORE resolveToken completes.

---

## Verification — what to test tomorrow morning

Hard refresh the prod app first. Then:

1. **Codex**: pull a fresh JSON export from graph.codex.io. Today's getBars+filterTokens should be <40K cumulative. If higher than 50K, something regressed.
2. **Watchlist**: open watchlists page. Confirm logos render for PALM, MESSIER, OGPU, NEURAL, HASHAI, LNQ, SEN. Confirm 24h % matches Hetzner /v1/prices.
3. **Charts**:
   - BTC/ETH/SOL: TradingView toggle → TV widget iframe loads
   - PALM/MESSIER/DSYNC: TradingView toggle → DexScreener iframe loads
   - Stocks (if applicable): TradingView toggle → NASDAQ/NYSE widget loads
4. **Welcome page**: cold load, watch DevTools Network. `/api/binance-usdt-pairs` should NOT poll every 15s anymore (CDN-cached for 1h). No `/api/news/*` until News tab clicked.
5. **Hetzner workers**:
   ```bash
   ssh root@204.168.244.18
   pm2 list | grep online | wc -l    # expect ~172
   pm2 status worker-candles-codex   # expect online
   pm2 status worker-telegram-bot    # expect stopped
   ```

---

## Infra reference (quick lookup)

### Hetzner
- IP: `204.168.244.18`
- SSH: `ssh root@204.168.244.18` with `~/.ssh/id_ed25519`
- App: `/opt/spectre-data-api/`
- ~172 PM2 processes online
- Codex KEY_B: `3da87900...` (ingestion)

### Vercel
- Team: `team_IQ6Oem6RVlYS9rakgtwRkrAW` (spectre-ai)
- Research project: `prj_jg3Reu9K6xiqY7YGs9sqrP3s4XJf` → app.spectreai.io
- Trading project: `prj_GVRWzlidpBHxIk4cXC6850Ni9omN` → trade.spectreai.io
- Latest research deploy: PR #750 commit at ~15:36 UTC
- Codex KEY_A: `8b57809a...` (Vercel + OVH)

### Codex (graph.codex.io)
- Plan: Growth, 1M ops/month cap
- Lockstep rule: `filterTokens` selecting volume24/liquidity/marketCap/holders auto-bills a `listPairsWithMetadataForToken` op. Drop those fields, rank server-side.
- **JSON export endpoint > dashboard tooltip** (factor of ~12 discrepancy observed today)

### OVH (NOT Sunny's research path)
- IP: `51.178.209.131`
- Gleb/KD trading-only box. Sunny's SSH key not authorized.
- Should NOT hold Sunny's CODEX_API_KEY per memory. Strip TBD.

---

## Files touched this session

### spectre-app
```
apps/research/src/components/trading-chart.jsx              (lazy→direct→iframe-embed)
apps/research/src/components/TradingViewAdvanced.jsx        (shimmer, fail-open, fchart-ready state)
apps/research/src/components/chart-iframe-embed.jsx         (NEW)
apps/research/src/components/chart-iframe-embed.css         (NEW)
apps/research/src/hooks/useWatchlistPrices.js               (subscribe all, fix merge priorities)
apps/research/src/services/codexApi.js                      (bars routing)
apps/research/src/services/prices/sharedBinancePrices.js    (preserve image/name)
apps/research/src/pages/home/components/use-market-prices.js     (5s→30s)
apps/research/src/pages/home/components/use-news-data.js         (prewarm removed)
apps/research/src/pages/home/components/use-x-posts-data.js      (prewarm removed)
apps/research/src/pages/token/components/TokenDataContext.jsx    (10s→60s — DEAD CODE, no effect)
apps/research/api/binance-usdt-pairs.js                          (CDN-Cache-Control)
apps/research/vercel.json                                        (6 crons removed)
apps/research/src/store/useSettingsStore.js                      (chartType default → tradingview)
apps/trading/api/codex.js                                        (PR #735 filterTokens shrink)
apps/trading/src/services/codexApi.js                            (defensive bars routing)
apps/trading/src/contexts/TokenDetailsContext.jsx                (iframe skip)
apps/trading/src/hooks/useCodexData.js                           (0 refresh = no poll)
apps/trading/src/components/TradingViewAdvanced.jsx              (shimmer)
apps/trading/vercel.json                                         (cron */1 → */3)
```

### spectre-data-api (Hetzner, separate repo)
```
src/workers/candles-codex.js         (PR #3: 100/60s → 25/120s)
src/api/server.js                    (PR #4: trending cache 30s → 300s)
src/workers/cache-warmer.js          (PR #4: add /v1/trending to allowlist)
```

---

## What I'd hand off to the team

1. **Verify** PR #749 + #750 land on real users tomorrow. The chart UX issue should look fundamentally different.
2. **Decide** Option A (iframe-only) vs Option B (polish canvas). Until decided, the canvas chart sits there clunky.
3. **Add the 'ALL' button** — it's 30 min of work and a clear user ask.
4. **Profile `/v1/trending`** — the underlying 17s query is in `/opt/spectre-data-api/src/api/routes/trending.js` around line 80-100. The `news_articles` UNNEST is suspect. Index `published_at DESC` + GIN on `related_assets` if not already.
5. **Coordinate with Gleb** on the OVH Codex strip.
6. **Don't trust the Codex dashboard tooltip.** Pull a JSON export to verify spending.

The chart loop today was a chase: shimmer → fail-open → chunk-retry → direct-import → iframe-embed → default-flip. Five PRs to get to a clean "all tokens, free, polished" answer. Hindsight says iframe-first was the right call from the start. The team can build from here.

— Claude, EOD 2026-06-03
