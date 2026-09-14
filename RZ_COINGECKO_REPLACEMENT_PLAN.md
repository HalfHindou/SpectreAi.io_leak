# Research Zone — CoinGecko Replacement Plan

**Audience:** Alaa (CTO) + Haitam (backend)
**Goal:** Eliminate every CoinGecko call on the Research Zone codepath. Fall back to CG only when Spectre Data API genuinely doesn't have the data, and stand up the missing endpoints + ingestion workers.
**Why:** CG free tier is rate-limited (~9 req/min) and Pro is metered. Every CG call also forces us through a third party we don't control. RZ today fires 3-5 CG calls per token view × every user → choke point + cost.

---

## 1. Inventory — every CoinGecko call on the RZ codepath

| # | Caller | Function | Endpoint hit | Purpose | Used by |
|---|---|---|---|---|---|
| 1 | `use-research-zone-data.js` | `getCoinMarketDataBySymbol(sym)` | `/coins/markets?symbols=…` | Price, 24h/7d/30d change, mcap, volume, FDV, ATH/ATL, supply | RZ price hero, right-rail Performance, watchlist majors |
| 2 | `use-research-zone-data.js` | `getCoinDetails(sym, cgId)` | `/coins/:id` | About blurb, links (twitter/telegram/website), categories, image_large | RZ "About" panel + project tab |
| 3 | `use-research-zone-data.js` | `getTopCoinsMarketsPage(1, 20)` | `/coins/markets` (page 1) | Trending list (right-rail "Other Tokens") | RZ trending strip |
| 4 | `research-zone-lite.jsx` | `getTokenMarkets(sym, cgId)` | `/coins/:id/tickers` | Markets tab — exchanges, pairs, prices, volumes, trust | RZ Markets tab |
| 5 | `rz-compare-picker.jsx` | `searchCoinsForROI(q)` | `/search?query=` | Compare-token picker autocomplete | RZ compare modal |

`coinGeckoApi.js` already tries Spectre first for some of these (`getCoinDetails` checks `getSpectreTokenProfile`, search calls `getSpectreSearch`). The gaps below are the ones that fall through to CG today.

---

## 2. What Spectre API already covers — use these, drop the CG path

These exist and work (verified `curl http://204.168.244.18:3850 …` returns 200 with real data). Frontend should use them as primary, CG as last-resort fallback only.

| RZ need | Spectre endpoint | Notes |
|---|---|---|
| Price + market data per asset | `GET /v1/coins/:id` | CG-shape adapter, drop-in for `getCoinDetails` |
| Top coins by market cap | `GET /v1/coins/markets?per_page=N` | CG-shape adapter, drop-in for `getTopCoinsMarketsPage` |
| Per-symbol simple price | `GET /v1/prices?symbols=BTC,ETH,…` | Lower-latency than `/coins/markets` for hero numbers |
| Whole-market snapshot | `GET /v1/global` | BTC dominance, total cap |
| Top movers | `GET /v1/movers` | RZ trending fallback |
| Asset omnibus | `GET /v1/asset/:symbol/profile` | Heavy single-shot — price + technicals + score + signals + social + whales + derivs + funding + correlations + narratives + community + developer. **This is the right shape for RZ first-paint** — see §4.A. |
| Search | `GET /v1/search?q=…` | Already used by `getSpectreSearch`, drop-in for `searchCoinsForROI` |
| Sentiment / fear-greed | `GET /v1/sentiment/:asset`, `GET /v1/sentiment/fear-greed`, `GET /v1/sentiment/global` | Already partially wired |
| Trending tokens | `GET /v1/trending` | Already wired |
| Categories | `GET /v1/categories` | Already wired |
| Calendar | `GET /v1/calendar` | Already wired |

**Frontend action (this session):** rewrite `getCoinMarketDataBySymbol` and `getTopCoinsMarketsPage` to call `/v1/coins/markets` first via the existing `getSpectreTopMarketsFallback` helper, with CG as fallback only if 5xx/timeout. `getCoinDetails` already prefers `getSpectreTokenProfile` — extend this preference to `getTokenMarkets` once §3.1 is built.

---

## 3. What Spectre API has but is incomplete — backend extension

### 3.1 `GET /v1/markets/:asset` — missing live per-pair price/volume

**Current state:** returns pair list (`base/quote/exchange/market_type`) but no price/volume/depth/trust per pair. Verified on SPECTRE — got 2 pairs with no quote data.

**RZ need:** Markets tab requires per-pair `price`, `volume_24h_usd`, `change_24h_pct`, `liquidity_usd` (or `bid_depth_2pct`/`ask_depth_2pct`), `trust_score`, `last_traded_at`, `volume_share_pct`. Today the frontend hits CG `/coins/:id/tickers` to fill this in.

**Spec:**

```
GET /v1/markets/:asset?vs=usd
→ {
  data: {
    asset: { symbol, name, logo_url, price_usd, market_cap_usd },
    pairs: [
      {
        pair: "BTC/USDT",
        base: "BTC", quote: "USDT",
        market_type: "spot" | "perp" | "futures" | "dex",
        exchange: { name, slug, trust_score, logo_url },
        price_usd: 81344.39,
        change_24h_pct: 1.31,
        volume_24h_usd: 1245678,
        volume_share_pct: 8.7,           // % of total 24h vol across all pairs
        liquidity_usd: 234567,
        bid_depth_2pct_usd: 12345,
        ask_depth_2pct_usd: 12345,
        last_traded_at: "2026-05-07T05:24:29Z",
        is_anomalous: false
      }, …
    ],
    pair_count: 42,
    total_volume_24h_usd: 14289000000
  },
  meta: { ts, source: "exchange-feeds" | "cache" }
}
```

**Ingestion needed:** a permanent worker that polls each tracked exchange's ticker stream (Binance, OKX, Bybit, Kraken, Coinbase, Kucoin already healthy per `spectre status` — extend coverage), upserts into a `market_pairs_live` table keyed by `(asset_id, exchange_id, pair)`. Update cadence: 30s for spot, 15s for perps. TTL the row at 5min — anything older is `last_traded_at` and rendered grey in the table. DEX side: subscribe to Codex `getNewTokens` / pair stats stream for any `market_type='dex'` pair, refreshed every 60s.

**Acceptance:** `GET /v1/markets/BTC` returns ≥10 pairs each with non-null `price_usd`, `volume_24h_usd`, `last_traded_at` within 60s of asking. P95 latency < 200ms. Cache TTL 60s.

### 3.2 `GET /v1/candles/:asset` — empty for DEX-only tokens

**Current state:** SPECTRE candles returned `data: []`. The `candles_1m` table only has CEX-pair candles.

**RZ need:** OHLCV candles for ALL tokens including DEX-only (SPECTRE, low-cap memecoins). The chart component falls through to Codex `getBars` directly when this is empty — but that's another upstream we don't fully control.

**Spec:**

```
GET /v1/candles/:asset?tf=1h&from=…&to=…&source=auto
→ {
  data: [
    { t: 1778131000, o, h, l, c, v },          // unix seconds
    …
  ],
  meta: {
    asset, interval, count, from, to,
    source: "binance" | "codex" | "merged",
    spike_filter_applied: true,
    bad_data_clamped: 2
  }
}
```

**Ingestion needed:**
- Per-asset resolver: native L1 (BTC/ETH) → Binance klines; CEX-listed tokens → Binance/OKX klines; DEX-only → Codex `getBars` keyed on the canonical address from `MAJOR_TOKEN_INFO` or `assets.address`.
- Permanent worker per asset: continuously persist 1m candles to `candles_1m` so reads are O(table-scan) not O(upstream-fetch).
- Outlier filter: any bar's `high/low` more than 3× the 30-bar median → clamp. Already specified in `spectre-app/.claude/rules/charts-system.md` §E1.
- Aggregation: query computes 5m/15m/1h/4h/1d on read by GROUP BY time bucket. No need to store every interval.

**Acceptance:** `GET /v1/candles/SPECTRE?tf=1h&limit=500` returns ≥500 bars within 100ms. SPECTRE specifically must work (the app's namesake token currently has empty candle data).

### 3.3 `GET /v1/asset/:symbol/profile` — extend or document the contract

**Current state:** works on SPECTRE but `price` and `technicals` come back null. The query is fast (754ms) but the price column isn't populated for DEX-only tokens.

**RZ need:** This is the single endpoint that could replace 80% of RZ's first-paint API calls. Today RZ fires 5 phase-2 fetches + 5 spectre-API fetches + 5 secondary-hook fetches = 15 round-trips. If `/v1/asset/:symbol/profile` reliably returned all of: `price + technicals + score + signals + social + whale + derivs + funding + correlations + narratives + community + developer`, RZ could collapse to **one** request.

**Action:** make sure `price.current`, `price.change_24h_pct`, `price.high_24h`, `price.low_24h`, `price.volume_24h_usd`, `price.market_cap_usd` are populated for every active asset. Source: same workers as §3.1/§3.2. `technicals` (RSI/MACD/MA20/50/200) needs a worker that recomputes from `candles_1m` every 5min.

**Acceptance:** `/v1/asset/SPECTRE/profile` returns non-null `price.current` and `technicals.rsi_14` within 30s of any new candle ingestion.

### 3.4 Tweet/social feed for a token

**Current state:** RZ uses `getTokenTweets` which calls `/api/xdash/token/:cgId` (X-Dash) directly. X-Dash is a separate Hetzner box (`5.78.199.87:8092`). Not in Spectre Data API.

**RZ need:** "Tweets" tab in RZ feed panel — recent mentions, with author, avatar, engagement, media URL.

**Spec (proxy or extend):**

```
GET /v1/social/:asset/mentions?limit=50&author_scope=all
→ {
  data: [
    {
      tweet_id, x_url, full_text, created_at_utc,
      author: { screen_name, name, avatar_image_url, followers_count, verified },
      engagement: { likes, retweets, replies, views },
      media: [{ media_url_https, type }],
      match: { matched_terms, matched_by, score }
    }, …
  ],
  meta: { asset, ts, source: "xdash" | "cache" }
}
```

**Action:** either expose X-Dash through Spectre API as a thin proxy (so the frontend has one auth boundary), OR document X-Dash as a permanent first-class data source and stand up a worker that re-publishes its mention stream into Spectre's own `social_mentions` table. Second option preferred — gives us full control over rate limits, retention, and dedup.

**Acceptance:** every active asset has a non-empty mentions array within 5min of a tweet being posted that matches `cashtag/ticker/name`.

---

## 4. New endpoints to build from scratch

### 4.A `GET /v1/rz/:asset/bootstrap` — single-shot RZ first-paint

**Why:** RZ today fires 15+ requests on mount. Even with parallel `Promise.allSettled` the slow tail (CG details ~800ms, X-Dash mentions ~500ms, sector data, mindshare) keeps the page "loading" for 3-5s after the shell paints. A single composite endpoint that returns everything RZ needs for first paint cuts this to one round-trip.

**Spec:**

```
GET /v1/rz/:asset/bootstrap
→ {
  data: {
    identity:    { symbol, name, logo_url, cg_id, address, network_id, categories[] },
    price:       { current, change_1h_pct, change_24h_pct, change_7d_pct, change_30d_pct, change_1y_pct,
                   high_24h, low_24h, ath, ath_date, atl, atl_date,
                   market_cap_usd, fdv_usd, volume_24h_usd, circulating_supply, max_supply },
    score:       { overall, fundamentals, technical, social, risk, momentum },
    technicals:  { rsi_14, macd_line, macd_signal, ma_20, ma_50, ma_200, support_levels[], resistance_levels[] },
    sentiment:   { spectre_sent_score, fear_greed_value, fear_greed_label, plot_data: [{ ts, score }] },
    derivatives: { funding_rate, oi_usd, long_short_ratio, liquidations_24h: { long_usd, short_usd } },
    social:      { followers_x, followers_telegram, top_mentions[3] },
    fundamentals_grades: { revenue, growth, treasury, governance },
    market_scenario: { regime, state, bias },
    sector:      { primary_sector, sector_change_24h_pct, peer_rank, peers_top5[] },
    mindshare:   { phase, phase_label, weight, narrative_velocity },
    about:       { description_html, links: { twitter, telegram, discord, website, github }, contracts: [{ chain, address }] }
  },
  meta: { asset, generated_at, query_time_ms, sources: ["god-profile","candles","sentiment","social","mindshare"] }
}
```

**Implementation:** stitch together the existing god-profile + sentiment + mindshare + social-mentions + sector queries server-side with `Promise.all`, return as one JSON. No new ingestion needed if §3 endpoints are populated — this is just a composite route.

**Acceptance:** `GET /v1/rz/BTC/bootstrap` returns 200 with all top-level keys non-null, P95 < 400ms.

### 4.B `GET /v1/stream/asset/:symbol` — SSE/WebSocket live price + signal feed

**Why:** Today RZ polls `/v1/prices` every 10s for live price updates, plus separate polls for funding (60s), liquidations (30s), social score (60s). That's 4 timers per RZ tab and the user sees stale data for up to 60s. A single SSE stream pushes deltas as they happen, removes 4 polling effects on the frontend, and dramatically reduces server load.

**Spec:**

```
GET /v1/stream/asset/:symbol  (Accept: text/event-stream)

event: price        { current, change_24h_pct, ts }
event: technicals   { rsi_14, macd_line, ts }
event: derivatives  { funding_rate, oi_usd, ts }
event: liquidation  { side, size_usd, exchange, ts }       // when one occurs
event: signal       { type, severity, body, ts }           // breaking events
event: heartbeat    { ts }                                  // every 15s
```

**Implementation:** The api/server.js already has `streamPricesRoutes` mounted at `/v1/stream`. Extend it to per-asset channels, fed from Postgres LISTEN/NOTIFY on the same tables the workers write to. Clients connect once per RZ tab, server fans out updates from a single Postgres subscription.

**Acceptance:** opening `/v1/stream/asset/BTC` and waiting 60s yields ≥4 `price` events, ≥1 `derivatives` event, and steady `heartbeat` every 15s. Memory stable at 100 concurrent connections.

### 4.C `GET /v1/markets/:asset/depth` — order-book snapshot

**Why:** Markets tab currently shows pair list but no depth chart. Asking exchanges for L2 depth is rate-limited; a backend cache that polls every 10s for the top-5 venues per asset and stores latest snapshots makes the depth visualization possible without hammering exchanges from the browser.

**Spec:**

```
GET /v1/markets/:asset/depth?venue=binance&pair=BTC/USDT&levels=20
→ {
  data: {
    bids: [[price, size_base, size_usd], …],
    asks: [[price, size_base, size_usd], …],
    spread_bps: 1.2,
    mid: 81344.39,
    last_updated: "2026-05-07T05:24:29Z"
  }
}
```

**Acceptance:** any active asset/venue combo returns ≥10 bid + 10 ask levels within 200ms. Top-5 venues per asset always have a snapshot ≤30s old.

---

## 5. Frontend cleanup once §3 + §4 land

In order:

1. Replace `getCoinMarketDataBySymbol` body with a call to `/v1/rz/:symbol/bootstrap` and return the `price` block.
2. Replace `getCoinDetails` body with the bootstrap `about` + `categories`.
3. Replace `getTopCoinsMarketsPage` with `/v1/coins/markets` (already CG-shaped).
4. Replace `getTokenMarkets` with `/v1/markets/:asset` once §3.1 ships.
5. Replace `searchCoinsForROI` with `/v1/search` (already partial).
6. Delete `coinGeckoApi.js` direct `https://api.coingecko.com/…` calls. Keep CG only as a server-side fallback inside the Spectre Data API.
7. Switch RZ price/funding/liquidation polling effects to subscribe once to `/v1/stream/asset/:symbol` (§4.B). Each saved poll = one less timer, lower server load, real-time UI.

Result: RZ first-paint goes from **15 fetches** to **1 fetch** + **1 stream subscription**. Cold-cache TTI is bounded by one P95-400ms request instead of the slow tail of 15.

---

## 6. Worker architecture summary

What the backend needs running 24/7 to make all of the above non-stale:

| Worker | Cadence | Writes to | Purpose |
|---|---|---|---|
| `cex-ticker-feed` | 30s | `market_pairs_live` | Per-pair price + volume + depth snapshot from Binance/OKX/Bybit/Kraken/Coinbase/Kucoin |
| `dex-ticker-feed` | 60s | `market_pairs_live` (where `market_type='dex'`) | Codex pair stats for DEX-only assets |
| `candles-binance` | continuous | `candles_1m` | 1m kline stream for all CEX-listed assets |
| `candles-codex` | 60s | `candles_1m` | 1m bar fetch for DEX-only assets, with outlier clamp |
| `technicals-recompute` | 5min | `asset_technicals` | RSI/MACD/MA from `candles_1m` |
| `xdash-mentions-mirror` | 60s | `social_mentions` | Mirror X-Dash mentions stream into our DB |
| `funding-feed` | 60s | `composite_funding` | Already running per `spectre status` |
| `oi-feed` | 60s | `composite_oi` | Already running |
| `liquidation-feed` | 10s | `composite_liquidations` | Already running, healthy |
| `sentiment-recompute` | 5min | `asset_sentiment` | From mention stream + price action |

`spectre status` already shows funding/OI/liquidations/news/sectors/calendar workers running. Gaps are the **per-pair live** + **DEX candles** + **technicals recompute** + **xdash mirror**.

---

## 7. Priorities & shipped status

| Priority | Item | Status | Unblocks |
|---|---|---|---|
| P0 | §3.2 candles populated for DEX-only tokens | **shipped** — `worker-candles-codex` + `services/codexService` + bidirectional fallback in `routes/candles.js` | SPECTRE chart |
| P0 | §3.1 markets tab live data per pair | **shipped** — `worker-cex-ticker-feed` (binance/okx/bybit/kraken, 30s) + `routes/markets.js` SELECT now exposes live columns | Markets tab |
| P0 | §3.3 god-profile populates `price` for DEX assets | partial — hits the same data path as §3.2 once `candles-codex` runs and price-changes worker picks up | Replaces 5+ RZ fetches |
| P1 | §4.A `/v1/rz/:asset/bootstrap` composite | **shipped** — `routes/rz-bootstrap.js` mounted at `/v1/rz` | RZ TTI |
| P1 | §3.4 social mentions in Spectre API | **shipped** — `migrations/073_social_mentions.sql` + `worker-xdash-mentions-mirror` + bootstrap reads from mirror, falls back to live X-Dash | RZ Tweets tab |
| P2 | §4.B SSE per-asset stream | **shipped** — `routes/stream-asset.js` pure pub/sub (price + derivatives + liquidations) + frontend `useAssetStream` hook + Redis publishers added to `derivatives-composite` (binance/okx/bybit liquidation workers already publish) | Removes 4 RZ polling timers |
| P2 | §4.C depth snapshots | **shipped** — `migrations/074_orderbook_depth.sql` + `worker-orderbook-depth` (top-5 venues per asset, 30s) + `GET /v1/markets/:asset/depth` route + per-pair `depth_minus_2_pct/plus_2_pct` mirrored back into market_pairs | Markets-tab depth chart |
| P2 | Codex deep-history backfill | **shipped** — `worker-candles-codex-backfill` (10-min cycles, picks asset with thinnest history, walks 30-day chunks via `getBars`, capped at 1Y target depth) | RZ chart 1Y zoom for DEX-only tokens |

---

**End of plan.** Frontend will keep CG as a fallback in `coinGeckoApi.js` until each §3/§4 item is acceptance-tested green, then the CG path is deleted.
