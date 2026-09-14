---
paths:
  - "apps/research/src/services/**"
  - "apps/research/src/hooks/useXDash*.js"
  - "apps/research/src/pages/x-dash/**"
  - "apps/research/api/_lib/**"
---

# X Dash / Social data-lane — fixes needed upstream (for Alaa)

**From:** Sunny (via Claude Code session, 2026-07-04/05)
**Owner:** Alaa (collector box + Spectre Data API on Hetzner)
**Why this doc:** a run of X Dash bugs this weekend all bottom out in the data layer, not the app. The app has been patched to *stop looking broken* (band-aids noted per item), but the real fixes live in the collector / data-api. This is the list, prioritized, with the exact fields/endpoints involved.

**Surfaces affected:** `/api/xdash/bootstrap` (board), `/api/xdash/token/:id` (drawer detail), `/api/xdash/intel/token/:id`, `/api/xdash/momentum-origin/:id`. Data API box: `204.168.244.18:3850`. Collector box = Alaa's (app/CC has no SSH there).

---

## Priority summary

| # | Issue | Symptom users see | Real fix lives in | Sev |
|---|-------|-------------------|-------------------|-----|
| 1 | Frozen market cap | Board + drawer show a stale mcap (e.g. $DOT $2M when it's $3.5M) | collector `last_market_cap` OR data-api live override | **P0** |
| 2 | Ticker-keyed identity / cg_id pollution | $DOT (Base memecoin) resolves to Polkadot — wrong price/chart/tweets/mcap | collector token identity keyed by CONTRACT not ticker | **P0** |
| 3 | Thin per-token detail (blank drawer) | Drawer opens with 0% quality, no tweets, no match-structure for a token that's live on the board | collector index per-token detail for every board token + honor `force=1` | **P1** |
| 4 | Mention count vs tweet list mismatch | Board says "26 mentions 24h", drawer says "No tweets captured in this window" | store the actual tweets keyed to token+window | **P1** |
| 5 | Match Structure: add CA-match | Only cashtag/handle tracked — misfires on ticker collisions | collector parse CA from post text → `ca_match_24h` | **P1** (spec ready) |
| 6 | Collector cadence | Board data can lag 20–60 min | collector cadence / freshness | P2 |
| 7 | `/v1/prices` ingester STALLS (whole-board freeze) | 2026-07-06: ALL majors frozen at 14:19Z for 3.5h+ — BTC served 61,860 while Binance tape was 63,700 (-3%). Every price surface in the app (hero, tickers, tables) rode the stale value | data-api price ingester health: needs a watchdog/auto-restart + alert when `updated_at` stops advancing | **P0** |
| 8 | `/v1/prices` + `/v1/search` cold-query latency 3-7s | Prod Network panel fills with slow (8-15s) and 502 `prices?symbols=` / `search?q=` requests; client polls kept re-firing into them (app-side backoff shipped 2026-07-07) | box query handler: any symbol set / search query not in its cache takes 3-7s (repeat = 130ms), and the cache key is ORDER-SENSITIVE (`DOT,ATOM` ≠ `ATOM,DOT`). Fix: normalize (sort) the cache key + speed up / pre-warm the per-symbol path | **P1** |

---

## 1. Frozen market cap (P0)

**Symptom:** ~11% of tokens (~148/1331 measured) have `entry_mc == last_mc` — the market cap is frozen at the value from when the token was first surfaced and never updates. `$DOT` (usedot-ai) shows **$2.00M** on the board and drawer; the real live mcap is **~$3.55M** (confirmed on the trading page, Codex by contract). ROI/"NOW" reads +0% because entry == now == the frozen value.

**Root cause:** the collector writes `metadata.market_cap` once at entry and doesn't refresh `last_market_cap` on subsequent snapshots for these tokens (the "ANSEM-class" freeze).

**App band-aid (shipped, PR #1211):** the **drawer** now fetches live mcap by CONTRACT from Codex (`getTokenWithPrice(address, networkId)`) and overrides the displayed value. **This does NOT fix the board rows** — every leaderboard row still reads the frozen catalog field (doing a live per-contract fetch for 50+ rows/render is too expensive client-side).

**What Alaa needs to do:** keep `last_market_cap` (and the mcap the board/`bootstrap` serves) **live** — refresh it each snapshot from the on-chain/Codex source by contract, not frozen at entry. Keep `entry_market_cap` immutable (that's correct — it's the historical anchor); only the CURRENT mcap must move. Once the board serves a live current mcap, the app can drop the per-token drawer override.

---

## 2. Ticker-keyed identity / cg_id pollution (P0)

**Symptom:** `usedot-ai` is a Base token, ticker **DOT**, contract `0x23A2…FE51`. But its `cg_id` resolves to **`polkadot`**. Downstream that meant: Research Zone opened Polkadot's page, the price chart showed Polkadot, and the X-tweets feed mixed usedotai + Polkadot. It's a ticker collision — "DOT" the memecoin got mapped to Polkadot's CoinGecko slug.

**Root cause:** token identity / CoinGecko-id resolution is keyed (or falls back to) the **ticker symbol**, so any on-chain token whose ticker collides with a major (DOT, BTC, ETH, …) inherits the major's slug + metadata.

**App band-aids (shipped, #1206/#1210/#1211):** app now refuses to *act* on the bad identity — on-chain tokens (those with a contract) never route to a "major" by ticker, they route by contract to the AI Screener; mcap + chart resolve by contract. But the catalog record itself is still wrong.

**What Alaa needs to do:** key token identity by **contract address (+ chain)**, which is project-unique — never by ticker. The CoinGecko-id join should only attach when the contract matches CG's platform address for that coin, not when the ticker matches. A Base "DOT" must NOT carry `cg_id: polkadot`.

---

## 3. Thin per-token detail — the blank drawer (P1)

**Symptom:** clicking a token that's clearly live on the board opens a drawer that's mostly empty — Quality all 0%, "No match-structure data", "No tweets captured in this window", "No social graph yet", rank "-". Happens *often*, not just edge tokens (repro'd on `$MANIFEST`, previously `$ZIG`/zignaly ranked #3).

**Root cause:** `/api/xdash/bootstrap` (board) and `/api/xdash/token/:id` (drawer) are **different pipelines**. The board carries top-line metrics; the per-token detail (quality envelope, match structure, the actual tweets, social graph) is a separate index that frequently hasn't been built for that token/window — so the detail lands "thin".

**App band-aids (shipped, PR #1213):** (a) when the detail lands thin the drawer now calls the detail endpoint once with **`force=1`** to nudge a warm; (b) missing quality now shows an honest "indexing…" line instead of fake 0% bars. But if the collector can't/doesn't warm it, the data still isn't there.

**What Alaa needs to do:**
- Make `/api/xdash/token/:id` return the **same real metrics for every token that appears on `/api/xdash/bootstrap`** — if it's good enough to rank, its detail should exist.
- Make **`force=1` actually warm-and-return** synchronously (index the token's detail on demand and return it in that response), so the app's on-demand warm resolves the drawer in one hop.
- Confirm the detail endpoint keys on the **same id** the board uses (a cg_id/slug mismatch between board and detail would explain the emptiness — see #2).

---

## 4. Mention count vs tweet list mismatch (P1)

**Symptom:** the board row says e.g. `$MANIFEST · 26 mentions 24h`, but the drawer's Mentions Feed says **"No tweets captured in this window."** The COUNT exists but the underlying TWEETS don't.

**Root cause:** the mention *count* aggregate and the stored *tweet objects* are decoupled — the collector increments a count but doesn't retain (or doesn't serve, keyed to token+window) the actual posts.

**What Alaa needs to do:** persist the actual tweet objects (id, author, text, ts, engagement) keyed to `token + window`, and serve them on the detail endpoint so the count and the list always agree. This also unblocks #5 (need the post TEXT to match CAs) and the drawer's Social Graph.

---

## 5. Match Structure — add a CA-match dimension (P1, spec ready)

Full spec already written: **`.claude/rules/ca-match-structure-spec.md`** (in the research repo). Short version:

Match Structure today = `both / cashtag-only / handle-only`. Add **`ca-match`**: does the post text contain the token's **contract address**? It's the most reliable signal a post is about THIS project (kills the ticker-collision from #2), correlates with fresh launches (freshness input), and gives users the correct CA to copy.

**What Alaa needs to do:** in the same classifier that sets both/cashtag/handle per post, also scan the post text for the token's contract and emit:
```
ca_match_24h        int     # posts whose text contains the contract address
ca_match_share_24h  float   # ca_match_24h / external_mentions_24h
```
Surface it in the token-detail payload alongside `match_structure`. (Needs the stored post text from #4.) App-side rendering (a "CA MATCH %" segment + a freshness bump) is trivial once the field lands; there's already an interim client-side CA badge on the drawer tweets (PR #1207).

---

## 6. Collector cadence (P2)

Board data can lag **20–60 min** (collector refresh cadence). Not breaking, but it's why "updated Xm ago" sometimes reads old and why fresh runners appear late. Worth a look if the cadence can tighten for the hot tail.

---

## Also noted (different lane — Gleb / trading app)

- **Trading `/token` "Markets" tab → "Market data unavailable"** for some Base tokens even though the chart, txns (678), liquidity and holders all resolve from the contract. The DEX markets/pairs feed for the token page returns empty. That's the trading app's markets endpoint, not X Dash — flagging so it's not lost.

---

## 7. `/v1/prices` ingester stall (P0, added 2026-07-06)

**Symptom:** every row `/v1/prices` served (BTC/ETH/SOL/… all with the same `updated_at: 2026-07-06T14:19:02Z`) froze for 3.5h+. The app's price layer is Spectre-first (cost war), so hero prices, candle live-overlays, tickers and tables all showed the stale tape (BTC -3% off). The self-hosted TradingView chart stayed correct because it reads `/api/bars` (real Binance klines) — which is how the bug was spotted (chart vs hero disagreed).

**App band-aid (shipped, 2026-07-06):** `binanceApi.getBinancePrices` + `getTopCoinPrices` now check `updated_at`; rows older than 5 min are overlaid with the live Binance ticker (price/24h change), Spectre keeps mcap/liquidity/multi-window changes. `coinGeckoApi.getMajorTokenPrices`/watchlists already had the equivalent CG-override. Other Spectre-fed list surfaces (`getSpectreTopMarketsPage` home tables etc.) still serve the frozen values when the ingester stalls.

**What Alaa needs to do:** watchdog on the price ingester — alert + auto-restart when `updated_at` stops advancing for >2-3 min. Optionally serve a `stale: true` flag on rows so clients can degrade honestly.

**RECURRED 2026-07-10** (user report: stale watchlist prices, SPECTRE 0.3631 vs 0.373 live): at 11:24Z every `/v1/prices` row was frozen at `updated_at: 2026-07-10T10:36:26.985Z` (48+ min), and values older than that had been served earlier in the morning — the stall is repeating. Same window: `/v1/rz/BTC/bootstrap` cold = **13.4s** (worse than the 2.4-8.2s measured 2026-07-07), repeat 0.3s — the box degrades as a whole when this happens, which users perceive as "Research Zone slowed down again". The watchdog above is still not deployed and is now the #1 ask. App-side gap closed same day: the shared realtime store (`sharedBinancePrices.js`) used to bypass the stale-overlay band-aid because it only fell back when Spectre returned an EMPTY map — a stalled ingester returns non-empty frozen rows. It now re-sources stale rows through the CG+Binance leg and flags un-re-sourceable rows `stale: true` (watchlist then prefers its Codex/DexScreener path).

---

## 9. Cloudflare bot-challenge blocks server egress to onchain.spectreai.io (P1, added 2026-07-08 — infra, Alaa/Gleb/KD)

**Symptom:** the Onchain Data Bridge (`onchain.spectreai.io/api/v2/*`) returns **403 "Just a moment…"** to every server-to-server request — the browser-UA workaround baked into `packages/server/lib/onchain-client.js` (and the research serverless `onchain.js`) no longer passes the challenge (verified curl 2026-07-08, including the health probe `/v2/networks`). Consequences: the dev Express bridge leg ALWAYS returns `_source:"none"` (trending, token details, pools, swaps, holders — the whole onchain.js router), and prod research only survives via the relay through `trade.spectreai.io` (whose Vercel egress has a WAF skip) — an extra hop that also drops sparkline enrichment.

**App band-aid (shipped 2026-07-08):** client stamps a 5-min `spectre-onchain-bridge-down-until` cooldown after an empty bridge answer and goes straight to the Codex fallback; index.html pre-fires the fallback at HTML-parse time. Trending is fast again, but the bridge's granular per-window data is simply LOST while the WAF blocks it.

**What infra needs to do:** add a Cloudflare WAF skip rule (or a service token / grey-cloud) covering (a) developer localhost egress and (b) the research Vercel project's egress to `onchain.spectreai.io` — same exception the trading project already has.

**UPDATE 2026-08-17 - the block is TLS-fingerprint based, NOT User-Agent based.** Measured against `/v2/token/:addr/top-holders` and `/v2/networks` from the same machine, same minute:

| caller | headers | result |
|---|---|---|
| curl | `Accept` only | **403** |
| curl | full browser UA + Origin + Referer (exactly what `onchain-client.js` sends) | **200 + data** |
| Node `fetch` (undici) | byte-identical to the passing curl | **403 `cf-mitigated: challenge`** |
| real browser, origin `http://localhost:5181` | `Accept` only | **200 + data** |

The UA matters (bare curl is blocked) but is not sufficient - undici's TLS/JA3 fingerprint is challenged regardless, so **no server-side header tweak can fix this**; only the WAF rule above can. Two consequences:

- **A browser can go direct from ANY origin.** Upstream sends `Access-Control-Allow-Origin: *`, and a request sending only `Accept` (CORS-safelisted) triggers no preflight. The "dev must use the Express proxy because CORS would block a direct call" comment in `useHoldersChart.js` / `useTopHolders.js` was wrong - both now call upstream directly in EVERY environment, so the trading Holders tab works on localhost with no infra change.
- **The failure is SILENT.** `onchain-client.js` `get()` treats 4xx as "not a server failure": it records a circuit-breaker *success*, logs nothing, and returns `{data:null}`. Never read "no `[onchain]` errors in the log" as "upstream is healthy". The dev `/token/:address/holders` route also reused its "not available for this chain" note for this path, which cost an hour of chasing the (perfectly fine) chain gate - it now reports the real cause separately.

## 10. KOL lane (P1, added 2026-07-13 — Sunny: "follow big guns", Alaa owns the KOL DB)

**(a) Untracked big-gun handles.** The app's curated S-tier list includes `gcrclassic`, `hsakatrades`, `notthreadguy`, `altcoingordon`, `defi_squared`, `saliencexbt`, `0xngmi` — but `/api/kols` + `/api/author/:handle` don't track them. UPDATE 2026-07-13: the app registry now SELF-RESOLVES missing curated handles through our own tweets backend (profile + reach land in the KOL DB, `source:'x-direct'` — Hsaka/ThreadGuy live). What the direct lane CANNOT give them is xdash mention/engagement/early-call data — so the collector ask stands: track these handles natively and the full signal pipeline lights up. Verified-tracked and fine: blknoiz06 (Ansem), IncomeSharks, CryptoWizardd, Pentosh1, cobie, CredibleCrypto, CryptoKaleo, inversebrah, theunipcs, rektcapital, CryptoHayes, AltcoinSherpa, Tradermayne, frankdegods, traderpow.

**(b) `/api/kols` sort keys.** Only `activity | momentum | reach` work; `sort=hit_rate` / `sort=lead_time` are silently ignored (fall back to default order). The Creators board shows hit-rate/lead-time columns but can't rank by them — the most actionable sort on the board. per_page also caps at 50 (fine, documented), so client-side sorting can't substitute.

**App side already shipped 2026-07-13:** new users' KOL Radar seeds the big-guns follow pack by default; one-click "Follow the big guns" for existing radars; Creators honors timeframe 24h/7d.

---

## 11. Codex spike on `spectre-prod-ingestion` (P0, 2026-08-13) — what we ruled OUT, and the one question left

Alaa saw Codex requests spike from 2026-08-12 on `spectre-prod-ingestion` (the box's key, not the app's) and disabled it. We shipped a real app-side fix (PR #1423, below) but **the causal chain is NOT confirmed** — and the mechanism first proposed for it does not survive a probe.

**REFUTED: `/v1/scanner/token/{address}` is not a live Codex call.** The initial analysis said spectre-api serves it "with live Codex `filterTokens` + `listPairsWithMetadataForToken`". Measured 2026-08-13 with the ingestion key already DISABLED:

| probe | result |
|---|---|
| scanner, WETH / SOL / BONK / PEPE / a $62k long-tail | `200`, real liquidity, **0.34-0.62s**, all of them |
| scanner, bogus address | `404 "token not found on DEX/GT for this chain"` — the error text names the sources; no Codex fallback |
| our own `dossier-api.js:11` | documents this endpoint as "DS/GT composite (**no Codex**)" |

**Also ruled out — nothing we call is Codex-dependent at request time.** With the key off: `/v1/search?q=pepe` 0.93s · `/v1/prices` 0.14s · `/v1/coins/markets` 0.25s · `/v1/rz/BTC/bootstrap` 2.81s · `/v1/market/trending` 0.27s. All `200`, all healthy.

**`/v1/token/holders/` is its own block indexer, not Codex** — the row carries `indexed_through_block`, `last_run_at`, `stale_seconds`, `source`. It covers a subset: WETH/USDC have a row (`holders: 0, backfill_complete: false`), PEPE and the long-tail token return `status: not_indexed`.

**FINAL (same day, reconciled against box-side SQL by Gleb).** Our serverless = 2,036 Codex queries on Aug 13 vs 1,079,181 account-wide (0.2%). The two halves of the spike:
- `getBars` 566K/day = the box's **seeded backfill queue** draining steadily since Aug 5-7 (3.8K tokens/day × ~130 paginated getBars; 36K pending + 40K paused ≈ 10 more days). Not app-triggered. Kill-switch-confirmed: key off → `candles-codex` 25/25 `circuit_open` errors.
- The **Aug-12 step** = filterTokens+listPairs (~470K/day) from per-request scanner lookups on the box, driven by #1421 un-breaking search + the lite on-chain charts. The scanner serves from DS/GT (why key-off probes still returned data) but its Codex enrichment bills asynchronously on the box's key. **PR #1423 (scanner cache+cap) is the fix for this half**; watch the filterTokens line after deploy — if it does not drop fully, scanner callers outside `spectre-data.js` (lite/RZ fast-paths via v1-proxy) need the same cache.
- The registration-burst theory was refuted by `chart_assets` data (3,950 regs Aug 12 vs 4,217 Aug 11; our address change = 16 `on_demand` rows). PR #1424 (warm gate) stays as hygiene.
- Do NOT delete chart_assets rows (spend is sunk; deleting re-spends). **Re-enable the key WITH a rate limit immediately** — a disabled key freezes prod DEX charts (queue stalled, new-token detector blind). Backfill-queue cap/finish = Gleb+Sunny product decision.

The original open question below is kept for the record:

> Does the ingestion worker enqueue a backfill when a request arrives for an address it has not seen (via `/v1/scanner/token/` or `/v1/token/holders/`)? And do its Codex calls on 2026-08-12 correlate with such requests for previously-unknown addresses?

Why that is the leading hypothesis: `backfill_complete: false` says the box dozes on what it is asked about, and from Aug 12 the app started handing it **up to 50 previously-unseen addresses per search, uncached, repeatedly** — a discovery firehose whose cost would land on the ingestion key, not on the request path. If confirmed, PR #1423 removes the source (it cuts distinct-address volume, which is exactly the lever). If not, the source is still unfound and the key should stay off.

**Worth doing regardless: a per-key rate limit on the box.** Every protection we can build lives in our code and therefore only covers mistakes we anticipated. A ceiling on the key covers the ones we did not.

### App-side fix already shipped (PR #1423, merged 2026-08-13)
`spectre-data.js` handed EVERY address to tier 3 with no cache of any kind — tiers 1/2 hardcode `liquidity`/`holders`/`txnCount24` to null, so the tier-3 skip condition could never be satisfied. Fan-out per request: search up to 50, `handleTopTokens` up to 100, `details-batch` = watchlist size, and the same token re-billed once per search, per surface, per user (since `2f4031ff4`, Jun 3). Now: per-address cache (KV 120s + in-instance memo + in-flight dedup), negative cache 300s but **only for 400/404** (a 5xx/429/401 is transient — caching those would blank a live token platform-wide), a real budget passed into the helper so it stops *issuing* calls, and a 30-row cap on the search path. Measured 1200 → 568 scanner calls over a 24-search session.

---

## 12. `/v1/prices/{SYM}/ohlcv` contradicts `/v1/prices?symbols={SYM}` (P1, added 2026-08-20)

Three tokens, three different magnitudes of the same fault - the two price
surfaces disagree for the SAME symbol, so anything that charts the series and
labels it with the quote draws a cliff:

| symbol | `/v1/prices` (quote) | `/v1/prices/{SYM}/ohlcv` (series) | gap | note |
|---|---|---|---|---|
| BULL | 0.00530103 | 2 rows at ~1.4e-7 | **6000x** | quote agrees with its own perf chips + 24h range, series does not |
| DEALER | 4.77e-06 | 13 rows Aug 8-20 peaking 0.0038473 | **~800x** | `meta.symbol` came back as **`"DEALER_DEALER"`**; the series belongs to a different Dealer (6+ Solana tokens share the ticker) |
| LICKINGCAT | 2.0748e-05 | 2 rows at ~3.1e-05 | 10x | contract-keyed GT/Codex both say 3.10e-04, so BOTH box surfaces are wrong here |

Also seen on these rows: `market_cap: 0` and every `change.*` null while
`updated_at` is FRESH (minutes old) - so freshness cannot be used to detect it.
And several series arrive with `o == h == l == c` on every row, i.e. a daily close
repeated rather than real OHLC, which makes candle rendering impossible.

**What the app now does** (so you can see what is being worked around): on-chain
caps are charted from GeckoTerminal/Codex BY CONTRACT and never from a symbol
lane, and a series whose newest close is >50x from the live quote is refused
outright rather than drawn.

**Asks:** (a) key the per-symbol OHLCV by the same identity as the quote row -
the `"DEALER_DEALER"` meta suggests a symbol-collision key is leaking into it;
(b) never serve a series whose scale contradicts the quote for the same symbol;
(c) emit real OHLC or mark close-only series as such; (d) BULL's `contract` is
64-hex with `chain: null` - without a chain the app cannot fall back to GT/Codex
at all, so a chain on every contract row would let us route around (a)-(c).

## 13. `/v1/social/mentions/{SYM}` stores SOME rows double-encoded (P2, added 2026-08-20)

Measured on `/v1/social/mentions/BULLSHIT?limit=6`: **3 of 6 rows** came back
mojibake'd - utf-8 bytes written through a cp1252 decode. The response header is
correct (`application/json; charset=utf-8`), so this is at INGEST, not in
transport, and the same tweet arrives twice - once clean, once broken:

```
row 1  "We are shilling now, don't join late"      <- correct
row 3  "We are shilling now, donâ€™t join late"   <- same tweet, mojibake
row 6  "at $2.72M MC ðŸ�³"                   <- emoji, and a byte already LOST
```

Row 6 matters most: `0x90` is unmapped in cp1252, so it became U+FFFD before the
row was stored. That byte is **gone** - no consumer can recover the emoji. So the
fix has to be upstream: decode the collector's fetch as utf-8 once and store the
string, never re-decode a byte string with a single-byte codec.

**App band-aid (shipped 2026-08-20, `lite-research.jsx` `repairMojibake`):** the
LITE X-mentions card repairs recoverable runs client-side (cp1252 reverse-map ->
TextDecoder) and drops runs carrying U+FFFD. It is per-run, so a row that mixes
clean text with one broken sequence keeps the rest. Every other consumer of this
endpoint still shows the raw mojibake.

## 14. `/v1/prices` serves `price: 0` with a FRESH timestamp (P1, added 2026-08-20)

Third variant of the symbol-keyed rot, and the nastiest to detect: the row looks
healthy. Measured on BULLSHIT:

```json
"price": 0, "market_cap": 0, "volume_24h": 0,
"change": {"1h": null, "24h": null, "7d": null},
"contract": "BjhkosH9fvuaVYmdpDqFf4vACx1Ni3Vs19oUxxJf6xj4", "chain": null,
"updated_at": "2026-08-20T16:16:39Z"     <- minutes old
```

`updated_at` is fresh, so neither the ingester-stall guard nor any staleness
check catches it, and the row carries no `coingecko_id`, so the CG re-source
lane in `spectreMarketApi` has nothing to key on. LITE printed it as
**"$0.00 / +0.00% today"** while the chart beside it drew the real
$0.00072 -> $0.00376 tape (CoinGecko lists this coin as `bullshit-coin`,
mcap $2.45M, rank 2055 - so it is not obscure).

The attached `contract` is also a DIFFERENT token: `BjhkosH9…` is "SOME
BULLSHIT WITH A GITHUB", which GeckoTerminal reports with `price_usd: null`,
`top_pools: []` and a total reserve of ~2.6e-9. The real one per the tracked
mentions is `3ra4pt…ijHL`. Same ticker-keyed identity bug as §2, and because
`chain` is null the app cannot route around it to GT/Codex either.

**App band-aid (shipped 2026-08-20, `lite-research.jsx`):** a zero price is no
longer rendered as a price (hero shows `-`), and when the box has no price the
hero borrows the CoinGecko quote the chart lane already resolved.

**Asks:** (a) never serve `price: 0` - omit the row, or mark it `tracked:
false`, so consumers can tell "no data" from "worth nothing"; (b) attach
`coingecko_id` when CG lists the ticker (that alone would have fixed this row);
(c) `chain` on every `contract` (still open from §12d); (d) the contract on this
row is the wrong token - §2 again.

## 15. Measured: the whole LITE Gainers board is unidentifiable (P0, 2026-08-20)

The individual reports in §2 / §12 / §14 are not anecdotes - they are the norm
on the long tail. Sampled every token on the LITE Gainers board on 2026-08-20
(19 symbols: BULLSHIT, UP, DOS, LICKINGCAT, GME, BULL, KTA, LFI, BERT, DEALER,
PEPEONTRON, EYE, PORTAL, DUSK, TENDIES, CASHCAT, HMM, JOTCHUA, JACKET):

| field | result |
|---|---|
| `coingecko_id` | **null on 19 of 19** |
| `chain` | **null on 13 of 19** (contract present, chain missing) |
| `price` | **0 on 5 of 19** (BULLSHIT, DOS, TENDIES, HMM, JOTCHUA) - see §14 |
| `/v1/prices/{SYM}/ohlcv` scale vs the quote | 1.0x on 5 · 1.1-30x on 7 · **369x (DEALER)** · **5,936x (BULL)** · empty on 4 |

Two of the OHLCV rows announce the collision in their own metadata:
`meta.symbol` reads **`DEALER_DEALER`** and **`JOTCHUA_JOTCHU`**.

Spot checks on the contracts themselves (GeckoTerminal, by contract):
- **BULLSHIT** `BjhkosH9…6xj4` is "SOME BULLSHIT WITH A GITHUB", whose only pool
  holds a **$0.0000000026** reserve. The real Bullshit Coin is
  `zj1jpp7Q…ry2k` - CoinGecko `bullshit-coin`, $0.00214, $2.08M cap, which is
  also what the page's own X rail was quoting ("sitting around $2.4M").
- **TENDIES** `H37TVqp6…66HX` is "Costco Tendies": reserve $9.7k, **no price**,
  24h volume 0.
- **BULL** `ce32007a…2554c4c` is a **Cardano** asset id - 56-hex policy plus
  `42554c4c`, which is the ASCII for "BULL" - and GeckoTerminal prices that
  asset at **$0.0000189 with an $18.9k cap**, against the box's $0.0053 /
  $5.3M. Either the contract is the wrong token or the quote is; they cannot
  both be right.

**Why this matters more than it looks:** with no `chain` the app cannot use the
contract at all (it has no network to query), with no `coingecko_id` it cannot
fall back to a listing, and with a symbol-keyed OHLCV lane that answers for a
different token it cannot chart the ticker either. The app now refuses any
series more than 50x from the quote, so the honest outcome for those rows is an
empty chart under a live price.

**Asks, in order:** (a) `chain` on every row that carries a `contract` - this is
the cheapest single fix and unlocks the contract lane for 13 of 19; (b) key
per-symbol OHLCV by the same identity as the quote (`DEALER_DEALER` says it is
not); (c) `coingecko_id` when CG lists the asset - `bullshit-coin` was one
search away; (d) never serve `price: 0` as a quote (§14).

**§15 addendum (2026-08-21, HMM):** same class, now on a CG-ranked token (thinking-cat, rank ~1083, $11.5M cap): box row = `price: 0`, `chain: null`, contract `0x0b4a55cc...bbef` - which has ZERO GT pools on any network, while CoinGecko's listing carries `0x7fe995a8...d87f` on `robinhood` with a $597k pool. The app now recovers identity from CG's own coin record when the box can't name a chain (`lite-research.jsx resolveCgPlatform`), but the box row remains wrong on both fields.

**§12/§14 addendum (2026-08-21, BULL):** the BULL quote is FROZEN, not just wrong - `/v1/prices` served **0.00530103 verbatim on both 2026-08-20 and 2026-08-21** (same 8 significant digits, fresh `updated_at`), while the token the page is actually about (`the-bull`, Robinhood chain `0x49bac4...97c6`, the same one the momentum board tracks at $1.79M) trades at $0.00178 on a $116k GT pool - 3.0x apart. The row's `contract` is still the unrelated Cardano asset. So this row combines the frozen-price class (§1), the wrong-contract class (§2) and `chain: null` (§15) in one. The app now recovers it via CoinGecko name-matching + GT ratification and replaces the frozen hero with the pool reading.

## 16. `/v1/social/author/aixbt_agent` mention window FROZE (P1, added 2026-08-25)

**Symptom:** the author dossier's `mentions` window for `aixbt_agent` serves the same ~24 posts every tick, newest stuck at **2026-08-24T16:56Z** while aixbt demonstrably kept posting (their own public grounding feed shows evidence minutes fresh at 05:28Z on 08-25). The dossier's `generated_at_utc` stays CURRENT while the posts inside it are 13h+ old — so freshness of the envelope hides staleness of the content, and downstream consumers (our `brain-aixbt-tracker`, which feeds the desk's peer-consciousness domain and the aixbt grade bench) starved silently at `new_posts: 0` per tick.

**What we did on our side (2026-08-25):** the tracker now reports `source_up` from the WINDOW's newest-post age (≤6h) instead of HTTP success, the box freshness watchdog gained an `aixbt_takes` age+rate lane, and the desk's aixbt context is supplemented from aixbt's public `api.aixbt.tech/v2/grounding` feed — so the desk keeps market context even while the post window is frozen. But the graded TAKES bench (aixbt's calls graded by our own grader) can only come from the posts.

**Asks:** (a) unfreeze the collector's `aixbt_agent` capture (it was delivering ~24-post windows fine until 08-24 ~17:00Z); (b) carry the newest-post timestamp at the top level of the author payload (e.g. `latest_post_at`) so consumers can tell a fresh envelope with stale content from a fresh window; (c) still open from §10a: the official-tweets endpoint (`get_official_tweets`) has 500'd on every handle since 2026-07-06 — the dossier fallback is the only aixbt post source we have.

## 17. `/api/narratives?timeframe=24h` returns ZERO narratives (P1, added 2026-08-31)

**Symptom:** the Welcome page's Sectors -> Attention tab painted its empty state
("the narrative feed has nothing for the last 24 hours yet") while the 7-day
feed was healthy.

**Measured** (direct to the box, `5.78.199.87:8092`, 2026-08-31 16:0x UTC):

```
/api/narratives?timeframe=24h  ->  narrative_count 0,  items 0
/api/narratives?timeframe=7d   ->  narrative_count 9   (Solana Memes 24, Base Memes 18, ...)
```

Both answers carry `window_hours: 168`, and the 24h one reports
`totals.tokens_with_external_mentions_24h: 0` against `tokens_with_mentions: 66`.
At token level inside the 7d payload every 24h counter is zeroed while the
window counters are real - SPX6900: `external_mentions 11`,
`external_mentions_24h 0`, `unique_external_authors 8`,
`unique_external_authors_24h 0`, `velocity_ratio 0.0`.

**Only `7d` is a supported timeframe value.** `24h`, `48h`, `3d` and `30d` all
echo back as `"timeframe": "24h"` with nothing in them.

**The two surfaces disagree with each other.** `/api/tokens` (our
`/api/xdash/bootstrap`) reports the SAME tokens with
`external_mentions_24h: 11` (SPX), i.e. it fills the 24h field from the
168h window, while the narrative aggregation computes a real 24h figure and
gets zero. One of the two is wrong; they cannot both be right.

**App band-aid (shipped 2026-08-31, `use-narrative-attention.js`):** when the
24h request settles empty the hook falls back to the 7d feed and REPORTS the
window it is showing, so the panel says "last 7 days" instead of claiming 24
hours. In that mode acceleration and per-token velocity are suppressed (both
are derived from the zeroed counters, so the feed's own `velocity_ratio` reads
0.0 for everything and must not be drawn as a real reading).

**Asks:** (a) fix the 24h counters in the narrative aggregation, or (b) if the
collector genuinely has no posts inside the last 24 hours, say so in the
payload (a `stale`/`latest_post_at` field - same ask as SS16b) instead of
returning an empty list that is indistinguishable from "nobody is talking";
(c) reconcile the 24h metric between `/api/tokens` and `/api/narratives`.

## TL;DR for Alaa

Two P0s: **(1)** stop freezing `last_market_cap` — serve a live current mcap by contract; **(2)** key token identity by **contract, not ticker** so `$DOT`-on-Base stops inheriting Polkadot. Then **(3/4)** make the per-token detail (quality + the actual tweets) exist for every board token and honor `force=1`. **(5)** add `ca_match` to Match Structure (spec ready). Everything else the app can render the moment the fields exist.

**Newest (2026-08-31):** §17 - `/api/narratives?timeframe=24h` returns zero
narratives (every `*_24h` counter zeroed) while `?timeframe=7d` returns nine, and
`/api/tokens` reports a non-zero 24h figure for the very same tokens. Only `7d`
is a supported timeframe value.

**2026-08-20:** §15 - measured the ENTIRE LITE Gainers board: 19/19
rows have no `coingecko_id`, 13/19 have a contract with no `chain`, 5/19 have
`price: 0`, and two OHLCV rows label their own collision in `meta.symbol`
(`DEALER_DEALER`, `JOTCHUA_JOTCHU`). This is the identity bug at scale, not a
handful of bad rows. Start with `chain` on every contract-bearing row.

**2026-08-13, blocking:** §11 — before re-enabling `spectre-prod-ingestion`, answer whether the ingestion worker backfills on request for unseen addresses. `/v1/scanner/token/` has been RULED OUT as a live Codex path, so the mechanism everyone assumed is wrong and the real source is still unidentified. Plus: put a rate limit on the key.
