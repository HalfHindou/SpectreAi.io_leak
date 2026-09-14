# Operation Kill Codex Bill — Team Brief + Tracking Doc

> Living document. Update at end of each day with measured Codex/CG ops + cost.
> Started 2026-06-02 when Codex bill hit 5.2M ops (520% over 1M plan).
> Owner: Sunny. Updated by: any team member shipping a Codex-touching change.

---

## TL;DR for the team (1 minute read)

**The situation:** Codex spent 5.2M ops in 5 days with only 40 DAU (Jun 1 = worst day at 1.55M ops = ~$540/day = $16K/month projected). At 1000 users that would have been ~$406K/month. Unsustainable.

**What we did today (2026-06-02):** 14 commits, 11 phases (1, K, K2-K10). Multi-source routing across CoinGecko (Sunny's Pro plan, free for us), Binance klines (free), and Codex (only for tokens nothing else covers).

**Where we are after:**

| Users | Best case/mo | Worst case/mo | Pre-fix would have been |
|---:|---:|---:|---:|
| 100 | **$130-180** | **$230-280** | $40,687 |
| 250 | $310-390 | $580-680 | $101,718 |
| 500 | $580-700 | $1,100-1,300 | $203,437 |
| 1000 | $1,100-1,400 | $2,200-2,600 | $406,875 |

**Verdict:** safe to launch to 100-250 users today. For 500+ we may need Codex sales discount + 1 more optimization.

**The key architectural shift:**

```
BEFORE: every user polls Vercel lambda → Vercel lambda calls Codex
        (N users = N times the cost)

AFTER:  1 cron writes top-500 token snapshot to KV every 60s using CoinGecko
        every user request reads from KV first (zero Codex cost for top-500)
        Codex only fires for DEX-only long-tail tokens nobody else has data on
        (cost scales O(1) with user count instead of O(N))
```

**What team members need to know going forward:**

1. **NEW RULE: think before adding any Codex call.** Ask: can this come from CG or Spectre API instead? Most top-token data can.
2. **If you must add a Codex call**, route it through `/api/codex` (the snapshot read path catches majors automatically).
3. **Polling intervals**: 60s is the floor for any new poll. Add `isAppActive()` + `document.hidden` gates.
4. **Watch the Slack channel** for `🚨 Codex` or `⚠️ CoinGecko` alerts — they're real cost spikes.
5. **Read this doc** before touching anything that fetches token data.

---

## Targets

| Metric | Target | Why |
|---|---|---|
| Codex ops at 1000 DAU | < 2M/month | Hits $700/mo at $350/1M Codex pricing |
| Codex ops at 40 DAU (current) | < 300K/day | 10x cut from Jun 1 baseline |
| CG calls/month | < 1.5M (of 2M Lite plan) | Headroom on Lite tier |
| Page load TTI (charts) | < 2s | Binance is fast; should not regress |
| Snapshot hit rate | > 90% | Validates the routing strategy |

---

## Baseline (Jun 1, 2026 - worst day)

Source: Codex dashboard CSV export (`usage-export-currentPeriod-2026-06-02.csv`)

| Operation | Ops | % | Driver |
|---|---|---:|---|
| getBars | 721,059 | 46% | TradingView charts (init + polls) |
| filterTokens | 416,599 | 27% | Token detail polling fan-out |
| listPairsWithMetadataForToken | 411,260 | 27% | Auto-billed lockstep with filterTokens |
| getTokenBars | 1,324 | <1% | Negligible |
| token | 1,036 | <1% | Negligible |
| listPairsForToken | 227 | <1% | Negligible |
| getTokenEvents | 213 | <1% | Negligible |
| getTokenPrices | 40 | <1% | Negligible (under-used) |
| **Total** | **1,551,758** | 100% | |
| Subscriptions (onPricesUpdated) | 5 | - | Effectively unused |

**3 operations = 99.6% of cost.** All three addressed by Phase 1 + K series.

---

## Daily ops trend (post-launch beta)

| Date | Total | filterTokens | listPairsWithMeta | getBars | Notes |
|---|---:|---:|---:|---:|---|
| May 25 | 12K | 3.4K | - | 2.3K | pre-beta |
| May 28 | 82K | 39.5K | 21.5K | 0 | beta launch day |
| May 29 | 946K | 422K | 411K | 108K | first full day |
| May 30 | 1.04M | 407K | 402K | 225K | Phase H landed mid-day |
| May 31 | 1.03M | 288K | 284K | 450K | filterTokens dropped 30%, getBars exploded |
| **Jun 1** | **1.55M** | 417K | 411K | **721K** | **WORST DAY**. Phase I+J landed 20:00 UTC |
| Jun 2 (partial) | 545K @ 10:30 UTC | 148K | 147K | 251K | Phase J first measurement |
| Jun 2 (full) | TBD | TBD | TBD | TBD | First full day Phase 1+K shipped |
| Jun 3 | TBD | TBD | TBD | TBD | First day with K5+K6 (CG snapshot + Binance) |
| Jun 4 | TBD | TBD | TBD | TBD | |

---

## Architecture (post Jun 2 deploys)

```
                          BROWSER
                              │
                              ▼
                ┌──────────────────────────────┐
                │  Vercel codex.js (research)  │
                │  Vercel codex.js (trading)   │
                └──┬───────┬──────────┬────────┘
                   │       │          │
              TIER1│  TIER2│   LIVE   │
                   ▼       ▼          ▼
          ┌────────────┐ ┌─────────┐ ┌──────────┐
          │ cg:snap KV │ │ codex:  │ │ Codex    │
          │ (CG, free) │ │ snap KV │ │ live     │
          │ 500 tokens │ │(Codex,  │ │ (DEX     │
          │            │ │16 seeds)│ │  only)   │
          └────────────┘ └─────────┘ └──────────┘
                  ▲           ▲
                  │           │
        ┌─────────┴───┐  ┌───┴──────────┐
        │ CRON 60s    │  │ CRON 60s     │
        │ CG markets  │  │ Codex filter │
        │ (free)      │  │ Tokens (~2)  │
        └─────────────┘  └──────────────┘

Charts (handleBars) routing:
  major tokens → Binance klines (free, ~80% of chart loads)
  DEX-only     → Codex getTokenBars (only path)
  fallback     → CoinGecko market_chart (line only)
```

---

## Shipped commits (2026-06-02, all on `main`)

| Commit | Phase | Cut estimate |
|---|---|---|
| `99f7fc57` | 1 | Research TVA pricescale cache + 2× poll + bucket dedup |
| `078a80fe` | 1 | Trading TVA LIVE_POLL 30→60s + bucket dedup |
| `a48bfaa2` | 1 | Watchlist 60→120s |
| `671ff8d0` | 1 | Trading useTokenDetails 60→120s default |
| `07071153` | K | Snapshot cron + KV-first read + cost watchdog |
| `07c8869c` | K2 | Snapshot-first prices + trending-derived hot set |
| `dfafd1ad` | K3 | RZ poll 60→300s + X Dash + mentions idle gating |
| `d2c1be77` | K4 | Trading-app snapshot mirror |
| `1cb6783d` | K5 | **CoinGecko snapshot cron + Binance-first bars routing** |
| `1179f8be` | K6 | Trading-app CG snapshot mirror |

---

## CoinGecko bill safety

| | |
|---|---|
| Sunny's plan | **Lite (2M calls/month, 500 req/min)** |
| Monthly usage today | 51K (3% of plan, lots of headroom) |
| Expected new load from snapshot crons | 2 calls × 2 apps × 1440 min/day × 30 = 173K/month |
| Total projected after deploy | ~225K/month (11% of plan) |
| Verdict | **Safe. ~10x headroom.** Watchdog still added for paranoia. |

**Burst risk:** both research+trading crons fire at same second = 4 concurrent CG calls. 500 req/min limit means we have 125x burst headroom. Safe.

**Fail-safe behavior:** if CG returns 429 or 5xx, cron logs the error and returns 502 from `/api/cron/refresh-cg-snapshot`. Read path falls through to Codex live query (current behavior). No user-visible regression.

---

## Stress test (simulated, 2026-06-02)

Manual curl tests against CG live API + Binance live API:

| Test | Result |
|---|---|
| `GET /coins/markets?per_page=250&page=1` | 200 in 530ms, 244KB, 250 tokens |
| `GET /coins/markets?per_page=250&page=2` | 200 in 311ms, 243KB, 250 tokens |
| Total cron payload | ~488KB, ~1s wall time |
| Per-token snapshot KV write | ~280 bytes |
| 500 tokens total KV writes | ~140KB per cron tick |
| Binance `GET /klines?symbol=BTCUSDT&interval=1h&limit=24` | 200 in 294ms, 4.3KB, 24 bars |
| CG key check | Plan: Lite, 2M/mo, 500/min, 51K used so far this month |

---

## What's deferred (not shipped today)

| Item | Why deferred | Impact |
|---|---|---|
| `onTokenBarsUpdated` subscription for charts | Per-event billing risk; need throttling design first | Could cut another 30-50% getBars |
| Email Codex sales for WS-heavy discount | Needs Sunny's call | Could drop 20-30% rate, ~$200-300/mo savings |
| Expand `TOKEN_REGISTRY` CG-id-to-address map beyond ~50 entries | Manual curation | Better address-keyed snapshot coverage |
| `handleTokenDetailsBatch` reading cg: snapshot via reverse SYMBOL lookup | Need a SYMBOL_TO_CGID inverse map at the address level | Marginal — most details requests already hit codex:snap |
| Subscription self-heal (auto-resubscribe noisy tokens) | Subscriptions currently barely used | Not urgent |
| Per-IP request budget cap (hard 429 above N ops/min) | Already present at action-level rate limit | Could add per-user cap |

---

## What could still go wrong

| Risk | Likelihood | Mitigation in place | Worst case |
|---|---|---|---|
| Vercel cron doesn't fire | Low | None (untested first run) | Snapshot stale, reads fall through to live Codex (current bill) |
| KV writes fail (Upstash outage) | Very Low | Every write try/catch wrapped | Same as above |
| Binance Geo-blocks Vercel IPs | High in some regions | allorigins fallback already wired | CG market_chart line fallback (lower quality but works) |
| CG returns 429 (rate limit) | Low (we're 3% of plan) | Cron errors → snapshot stales → Codex fallback | Snapshot down for that window |
| Snapshot hit rate < 60% | Medium | KV miss falls through to live Codex | Some users see slightly higher first-load latency, no data quality drop |
| Long-tail token usage explodes | Medium | No specific defense | DEX-only chart cost grows linearly with that traffic |
| CG data quality differs from Codex | Low for top-500 | CG is industry-standard for top tokens | None observed; CG is canonical for these |

---

## Verification checklist (do this tomorrow morning)

- [ ] Hit `https://app.spectreai.io/api/codex-usage?key=$ADMIN_KEY` — compare 24h delta vs Jun 2 baseline
- [ ] Vercel cron logs: confirm `refresh-cg-snapshot` ran 1440 times (1/min)
- [ ] Vercel cron logs: confirm 0 errors in last 24h
- [ ] CG account dashboard: confirm monthly usage didn't spike past 250K
- [ ] Open `/research-zone/bitcoin` — chart loads in <2s
- [ ] Open `/research-zone/<random DEX token>` — chart loads, falls back to Codex
- [ ] Open watchlist with 10 majors — all prices populate without showing skeleton >1s
- [ ] Hit `/api/codex?action=details&address=0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599&networkId=1` — verify response has `_source: 'cg-snapshot'`
- [ ] Hit Codex dashboard EOD — daily total < 300K (vs Jun 1's 1.55M)

---

## Team actions

### Sunny (founder)
1. [ ] **Verify Vercel deploys** (both apps): https://vercel.com/spectre-ai
2. [ ] **Set `SLACK_CODEX_WEBHOOK_URL`** in BOTH Vercel project envs (research + trading) to activate cost watchers
3. [ ] **Email Codex sales** (help@codex.io): "Spectre AI is WebSocket-heavy. Per your FAQ, requesting custom plan discount for WS-dominant workload." Could drop our per-op rate 20-30%.
4. [ ] Tomorrow EOD: paste Jun 3 Codex dashboard total into this doc's "Daily ops trend" table

### Gleb (co-founder, infra)
1. [ ] Confirm Vercel Pro plan supports per-minute crons (we added 2 new `*/1` cron jobs)
2. [ ] If Codex bill stays high tomorrow, decide whether to do the `onTokenBarsUpdated` subscription work (see "Deferred" section below)

### Evgeniy (frontend)
1. [ ] **NEW RULE**: any new hook that fetches token data goes through `/api/codex?action=...` so it gets snapshot-routed automatically. Don't call `/api/tokens/*` directly.
2. [ ] New polling hooks: minimum 60s interval, MUST have `isAppActive()` + `document.hidden` gates. Follow `useWatchlistPrices.js` as the template.

### Alaa (CTO)
1. [ ] If a runaway happens overnight, the kill switch lives in `apps/research/api/codex.js` rate-limit middleware. Tighter cap = change `userRateLimit({ max: 60 })` to a lower number.
2. [ ] Long-term: consider migrating `handleTokenSearch` to Spectre `/v1/search?q=` primary (would route most search away from Codex too). Not urgent.

### Whole team
1. [ ] Watch Slack `#engineering` for `🚨 Codex` or `⚠️ CoinGecko` alerts in next 24-48h. Each one is a real cost spike that needs investigation.
2. [ ] Read this doc top-to-bottom before touching anything that fetches token data.

---

## Update log

- **2026-06-02 (this doc created)**: Phases 1, K, K2, K3, K4, K5, K6, K7, K8 deployed to main. Pre-deploy baseline = 1.55M/day (Jun 1). Target: <300K/day at 40 DAU.
- **2026-06-02 (audit results)**: Deep audit found 3 hidden Codex callers:
  - Header search dropdown firing N parallel /details on open
  - Mobile search overlay same pattern
  - Both fixed in K8 (switch to /details-batch). At 1000 users with mixed major+DEX recents this saves up to 5x per dropdown open.
  - Verified ALREADY covered: useWatchlistPrices, useTrendingTokens, useTokenDetails, useLatestTrades, useRealtimePrice, useChartData, useTokenMentions (Spectre not Codex), X Dash hooks (Spectre not Codex).
  - StrictMode double-mount: all shared subscriber patterns properly cleanup. No leak risk.
- **2026-06-02 17:00 UTC update**: Found the real blocker. KV env vars
  (UPSTASH_REDIS_REST_URL/TOKEN) were EMPTY in production Vercel - the
  Phase K/L snapshot architecture was effectively no-op'd for the entire
  day. Fixed via `vercel env add UPSTASH_REDIS_REST_URL/TOKEN`. After
  redeploy, snapshot cron writes 500 tokens/min successfully (verified via
  new /api/admin/snapshot-health endpoint).
- **2026-06-02 18:00 UTC update**: Snapshot coverage hole discovered. Cron
  writes 500 cg:snap:<id> keys but handleTokenDetailsBatch read path only
  checked codex:snap:<addr:net> (25 keys via static KNOWN_TOKEN_ADDRESSES).
  Phase N2 ships the fix: new daily cron `refresh-cg-platform-map` builds
  a 34K-entry address->cgId map from CG /coins/list, lazy-loaded into
  codex.js for ~95% snapshot hit rate.
- **2026-06-02 latent bomb identified**: 15s `getTokenBars` poller in
  `packages/server/index.js:14635` per-active-token. Currently low
  (683 ops/day) but scales linearly with WS adoption. Refactor deferred -
  needs codex-stream.js subscriber exposure.
- **2026-06-02 web-Claude diagnosis confirmed**: Codex offers flat-rate
  `onPricesUpdated` on Growth/Enterprise tiers. Email draft at
  `docs/codex-sales-email.md` ready for Sunny to send. This is the
  structural fix for the remaining cost - one sales conversation away.
- **2026-06-02 Account B clarified**: Two SEPARATE Codex bills confirmed.
  - Account A (`950286c4...`): our Vercel app, the 5.2M spike we've been
    optimizing.
  - Account B (`98d8fb1b...`): Sunny's Hetzner data layer (workers).
    Bill not visible to us. Sunny TODO: log into B's dashboard.
- **2026-06-03 EOD**: TBD
- **2026-06-04 EOD**: TBD
- **2026-06-10 EOD** (week mark): TBD

---

## Scale projections (post all K phases)

### Per-DAU cost floor (architecture-driven, can't scale away)

| Source | Ops/DAU/day |
|---|---:|
| Snapshot misses for long-tail tokens | ~20 |
| DEX-only chart opens (non-major) | ~50 |
| Sub-feature mini-fetches (post-K8 audit) | ~30-100 |
| **Total per-DAU floor** | **~100-170** |

Plus a flat **2,880 Codex ops/day from the snapshot cron itself** (1 op/min × 2 lockstep × 1440 min). Independent of user count.

### Projected monthly Codex cost at $350/M

| DAU | Best case | Worst case | Pre-fix would have been | Verdict |
|---:|---:|---:|---:|---|
| 40 (today) | **$84** | **$135** | $16,275 | ✅ 120-194× cheaper |
| **100** | **$166** | **$292** | $40,687 | ✅ **Way under $700 target** |
| 250 | $371 | $686 | $101,718 | ✅ Under target |
| 500 | $712 | $1,342 | $203,437 | ⚠️ Borderline |
| **1000** | **$1,395** | **$2,655** | $406,875 | ❌ Over $700 target. Need more cuts (see below) |

### What needs to happen to hit $700 at 1000 users

**STATUS UPDATE 2026-06-02**: 2 of 3 already SHIPPED in K9 + K10.

1. ~~Server-side bar-cache extension~~ → **DONE (K10)**: per-resolution TTL.
   1m=30s, 1h=300s, 1D=1800s, 1W=3600s. Cuts effective getBars 3-5x on
   high-timeframe charts (the most-viewed surface).
2. **`onTokenBarsUpdated` subscription for popular DEX tokens** — STILL
   DEFERRED. Per-event billing risk; need throttling design.
3. **Email Codex sales** for WS-heavy discount per their FAQ — Sunny's
   action.

Plus a third bonus shipped:
4. **K9**: `handleTrending` derives entirely from CG snapshot. The 7 parallel
   filterTokens queries (cost ~14 ops per cache rebuild) eliminated.

### Revised projections post K8/K9/K10

| DAU | Best case/mo | Worst case/mo | Note |
|---:|---:|---:|---|
| 100 | $130-180 | $230-280 | Comfortably under $700 |
| 250 | $310-390 | $580-680 | Still under |
| 500 | $580-700 | $1,100-1,300 | Right at target boundary |
| 1000 | $1,100-1,400 | $2,200-2,600 | Need item #2 + #3 for $700 |

### Phases shipped today (chronological)

| Time | Phase | Cut |
|---|---|---|
| Morning | 1 (4 commits) | Chart polling 2x, bucket dedup, pricescale cache |
| Midday | K  | Codex snapshot cron + read path (kills per-user fan-out) |
| Midday | K2 | Snapshot-first prices |
| Midday | K3 | RZ poll 60→300s + idle gating on X Dash/mentions |
| Midday | K4 | Trading-app snapshot mirror |
| Afternoon | K5 | **CG snapshot + Binance-first bars** (the big one) |
| Afternoon | K6 | Trading-app CG mirror |
| Afternoon | K7 | CG cost watchdog + this tracking doc |
| Afternoon | K8 | Header + mobile search → /details-batch |
| Evening | K9 | handleTrending derives from CG snapshot (0 Codex) |
| Evening | K10 | bars KV TTL scales with resolution |

**Total: 14 commits, 11 phases, structural multi-source routing in place.**
