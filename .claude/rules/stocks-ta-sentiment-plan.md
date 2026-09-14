---
paths:
  - "apps/research/src/pages/research-zone/**"
  - "apps/research/src/services/stockApi.js"
  - "apps/research/api/stocks.js"
---

# Stocks — Technical Analysis + Sentiment Wiring Plan (audited)

**Created:** 2026-07-06
**Owner:** Sunny
**Trigger:** "Wire technical analysis and sentiment analysis into stocks. We did it for crypto — audit and now do it for the stock market. Audit the whole plan."
**Companions:** `~/spectre-rz-ta-audit-2026-07-04.md` (crypto TA audit — 3-phase redesign, UNSHIPPED), `sentiment-intelligence-plan.md` (crypto sentiment — Phases 0-3 shipped, 4-5 open).

---

## A. AUDIT VERDICT — read before building

Three parallel audits (stock infrastructure map, TA-stack coupling, sentiment-stack coupling) against the working tree + origin/main. Full detail in section G.

1. **The crypto TA redesign (2026-07-04) has NOT shipped — zero commits touch the TA stack since audit day.** No `scoreIndicator()`, no `lib/token-regime.js`. The tab still scores the same RSI three opposite ways on one screen, has no regime awareness, fake MTF on thin history, and two disagreeing server engines. **Porting the TA tab to stocks as-is ports the lies to a second asset class.** The stock rollout must ship on the fixed scorer, not fork the broken one.
2. **Stock plumbing is far better than expected.** Full `marketMode` stocks mode, stock search/watchlists/RZ-lite already exist. `/api/stocks/candles` (Yahoo v8, dev + serverless parity) already accepts `interval`+`range` — intraday 1m–60m + 1d/1wk bars are one adapter away. RZ opens for stocks but hard-locks to the Markets tab; Technicals + Sentiment are explicitly disabled (`research-zone-pro.jsx:119-131`, `research-zone-lite.jsx:349`).
3. **The TA math ports cleanly; the plumbing does not.** Indicator engine (`use-kline-indicators.js`) + S/R (`sr-levels.js`) are asset-agnostic pure math. What breaks on a stock: the bars fetch chain is crypto-only (`/data-api/v1/chart` → `/api/bars`, a stock ticker returns `no_data` — or worse, **a crypto token with the same ticker returns ITS bars**, the frankenrow class again); 24/7-continuous-bars assumptions (`from = to − resSec*barCount` under-fetches across nights/weekends — zero session handling anywhere); token-safety/microcap/tax/honeypot blocks; crypto macro chips (BTC dominance, funding, alt season); `isMajorToken()` routing.
4. **Sentiment: the client engine ports, the data legs don't.** `useSentimentEngine` verdict rules/gauges/KV-ring/charts are asset-agnostic. Every FEED is crypto: X Dash collector (Alaa's box, cg_id + cashtag universe), mindshare_v2 (own scrapers → Groq classify), momentum-origin. The desk read (`sentiment-read.js`) is PORTABLE-WITH-SWAP: replace CG fundamentals with Yahoo `quoteSummary`/Finnhub profile (both already in repo), rewrite the class-frame + prompt; site-crawl + LLM-gateway + KV layers work on any company. **Zero stock social source exists today** (no StockTwits, no WSB sweep, Finnhub news is headline-only on a dead 'demo' key).
5. **Identity is the landmine.** There is no asset classifier — `isStock` is inferred from `marketMode` (RZ decides by MODE not token), the UDF stock branch is a hardcoded ~20-ticker set (PLTR would route as crypto), and the crypto bars chain resolves bare tickers case-insensitively against crypto registries. Also live today: **RZ mobile fires the full crypto TA hook chain (up to 8 fetches) for every stock view** — hooks are called unguarded (`research-zone-mobile.jsx:1174-1195`).
6. **Fragility to price in:** Yahoo is unauthenticated (cookie/crumb 401/429 already killed quoteSummary on the Hetzner host); `FINNHUB_API_KEY` is EMPTY everywhere → news/analyst enrichment silently dead; `packages/server/routes/stocks.js` (1549 lines) is **extracted but NOT mounted** — live dev routes are inline in `index.js` (edit there or mount the module, or dev silently diverges).

**Bottom line:** TA for stocks = one bars adapter + session-aware windowing + equity swaps for the crypto-only thesis blocks + (mandatory) the shared scorer from the crypto audit's Phase 1. Sentiment for stocks = ship the fundamentals-grounded desk read first (all sources already in repo), add a crowd feed (StockTwits/Reddit) second. No paid infra needed.

---

## B. ARCHITECTURE DECISIONS

1. **Do NOT touch the crypto `/api/bars` waterfall** (project memory: intentional cost-optimization, cutting pieces blanked prod once). Stocks get their own leg: `use-kline-indicators.fetchSeriesBars()` branches on `assetClass==='stock'` → `getStockCandles(symbol, interval, range)` (`stockApi.js`, `/api/stocks/candles`). Crypto path untouched; stock path never enters the crypto chain (kills the ticker-collision class and the mobile fetch waste in one move).
2. **Thread real identity, not mode.** `tokenData.assetClass: 'stock'` set at every stock entry point (search mapping already sets `isStock:true`; watchlists duck-type it). The TA/sentiment hooks receive `assetClass`, never read `marketMode`. Keep `marketMode` for nav/data-source defaults only.
3. **One scorer, both asset classes.** Build the crypto audit's Phase-1 `scoreIndicator()` shared module NOW, as part of stock Phase 1 — the matrix, gauge, bull/bear cases (and the stock tab) all derive from it. We're editing those exact files anyway; forking the tri-contradiction into stocks would double the cleanup later.
4. **Session-aware fetch, not session-aware math.** Wilder RSI/ATR/MACD on session bars is standard practice — the math needs no change. What must change: bar-count windowing (ask Yahoo by `range` — e.g. 60m needs `range=1mo`+ to yield 210 bars, not `from=to−210·3600s`), the "Volume 1h" label (per-bar $ volume; `vol*close` on Yahoo share-volume is actually the correct $-volume conversion), and MTF clock labels (15m/1H clocks only meaningful in RTH; use `use-us-market-status.js` — already in app-shell — to caveat "market closed — intraday clocks as of Friday close").
5. **Equity thesis blocks replace crypto ones — same slots.** `use-token-safety` (tax/honeypot) → `use-stock-structure`: mcap band, avg $-volume, beta, 52w position, short % (if Finnhub key lands), **earnings-date proximity** (the equity "rug risk": no thesis without an earnings-gap warning inside ~7d). `rz-macro-analysis` (BTC dominance/funding) → equity macro chips: SPY vs 200D, QQQ trend, VIX regime, sector RS (`/api/stocks/sectors` exists), market open/closed. `classifyTokenClass` (exists, `rz-market-context.jsx:24`) gains an equity branch: `index-etf | mega | large | mid | small | micro-penny`.
6. **Sentiment ships in two honesty tiers.** Tier 1 (no crowd data): fundamentals-grounded "desk read" — Yahoo quoteSummary + Finnhub profile + analyst/earnings + news headlines through the existing llm-gateway investor prompt (equity rewrite). Cards render; crowd gauge shows an explicit "no crowd feed yet" state — never a fabricated score. Tier 2: real crowd feed (StockTwits has native bull/bear labels; Reddit sweep clones the existing `worker-reddit-firehose` pattern for r/stocks + r/wallstreetbets) → equity mindshare rollup → the existing crowd-stance KV ring + charts, with an EQUITY lexicon (calls/puts/moon/bagholder/short-squeeze ≠ rug/jeet/wagmi).
7. **Deploy surfaces:** APP = Vercel research app (most of this plan). HETZNER = data-api (Tier-2 crowd workers + optional equity-quote reuse — `macro_equity_quotes`/`tradfi_spot` tables + `/v1/macro/equity-*` routes already exist, unused by the app). Express dev parity: stock routes live INLINE in `packages/server/index.js` (12527-13409) — `routes/stocks.js` is NOT mounted.

---

## C. PHASED EXECUTION

### Phase 0 — Identity + hygiene (small, ship first) `[APP]`
- Thread `assetClass:'stock'` through stock search results, watchlist entries, RZ tokenData (`use-research-zone-data.js` stock branch), and `buildResearchZoneLocation`.
- **Stop the mobile leak:** guard `useKlineIndicators`/`useMtfThesis`/`useTokenSafety` calls in `research-zone-mobile.jsx:1174-1195` (pass null symbol when stock until Phase 1 lands).
- Replace UDF `POPULAR_STOCK_SYMBOLS` membership test with quoteType/known-exchange resolution (`resolveStockSymbol` in `lib/tradingViewSymbols.js` already does this properly) so long-tail tickers stop routing as crypto.
- Get a real `FINNHUB_API_KEY` into env (free tier 60/min — chosen source per `STOCK_MODE_FIX_PLAN.md`); news/analysts/short-interest silently unlock.

### Phase 1 — Stock TA (the core ask) `[APP]`
- **Bars adapter:** `fetchSeriesBars` stock branch → `/api/stocks/candles` with a resolution→(interval,range) map sized to yield ≥210 bars where Yahoo allows (1m:7d cap, 15m/30m/60m:~1-2mo, 1d:2y, 1wk:5y). Normalize to the same `{t,o,h,l,c,v}` shape; cache key gains `assetClass`. MIN_BARS honesty rules apply unchanged (EMA200 on 60m needs `range=60d`+; if Yahoo caps it, the tab says "needs N bars" — the engine already does this right).
- **Shared `scoreIndicator()`** (crypto audit Phase 1, both asset classes): one semantic for RSI/Stoch/BB consumed by `computeSignals` (rz-technicals-tab), `digestOne` (use-mtf-thesis), `buildCases` (rz-trade-thesis), + the mobile inline clones. Kill the 3-way contradiction before it reaches stocks.
- **MTF clocks for stocks:** same 5-clock architecture; label honestly per session state (RTH/closed/pre-post), drop the 15M clock when the market's been closed >1 session instead of showing a stale "clock".
- **Equity thesis swaps:** new `use-stock-structure.js` (slot where `use-token-safety` sits): mcap band, avg $-vol, beta, 52w range position, next-earnings proximity (Yahoo `quoteSummary` earnings + `/api/stocks/earnings-calendar` exist) → thesis renders "Earnings in 3d — gap risk, size down / no swing entry into the print" the way crypto renders honeypot warnings. Equity macro chips in the `rz-macro-analysis` slot: SPY vs 200D, QQQ, VIX band, sector RS, market status.
- **Unlock the tab:** `research-zone-pro.jsx` stock gate → allow `technicals`; mobile `TABS_STOCK` + `renderTechnicalsPanel` for stocks. S/R + TV-overlay drawing works as-is (pure math); chart hero for stocks stays the hosted TV widget (fine — S/R zones draw on the UDF-fed `TradingViewAdvanced` only where mounted for stocks later; not a Phase-1 blocker).
- **Copy sweep:** no "microcap/on-chain/DEX/LP" language on the equity branch.

### Phase 2 — Stock sentiment Tier 1: the grounded desk read `[APP]`
- `sentiment-read.js` equity branch (keyed `assetClass`): swap CG detail → Yahoo `quoteSummary` (price/keyStats/summaryDetail/assetProfile — handler exists at `api/stocks.js:254`) + Finnhub profile; inputs = analyst recs/targets (`/api/stocks/analysts`), earnings calendar, company news headlines (Finnhub + Google-RSS `company-news` proxy), sector/index context (reuse the equities brief snapshot from `marketBrief.js`). Equity investor SYSTEM_PROMPT (valuation frame, growth vs profitability, analyst-consensus asymmetry, earnings catalysts — not "team doxxed/LARP"). Same llm-gateway `smart` tier, same 20-min KV cache, new key namespace `sentiment-read-eq:v1:{TICKER}`.
- RZ Sentiment tab unlocked for stocks: "The Company" / "Investor Take" cards render; crowd gauge + mindshare chart show the explicit no-feed empty state (Tier 2 fills them). `composeVerdict` gets a fundamentals-only path (verdict from analyst/valuation/earnings inputs, labeled "desk read — no crowd data").
- The generic `project-crawl.js` optionally pointed at the company's IR/about page for non-mega-caps where Yahoo's profile is thin (works on any URL, cached 24h).

### Phase 3 — Stock sentiment Tier 2: the crowd feed `[HETZNER + APP]`
- **StockTwits ingester** (new data-api worker): symbol streams for the tracked equity universe (top ~200 by app usage + watchlists), native bull/bear labels ride free; store into an `equity_social_feed` table (mirror `social_feed` shape).
- **Reddit sweep:** clone `worker-reddit-firehose.js` for r/stocks, r/wallstreetbets, r/investing with ticker (cashtag + $-free uppercase) extraction — the crypto worker is the exact pattern.
- **Rollup:** equity mindshare (mirror `mindshare-rollup.js`, keyed TICKER): weighted mentions, bull/bear pct (StockTwits labels + equity-lexicon/Groq-8b classify for Reddit), 1h/24h/7d → `/v1/social/equity-mindshare/:ticker` (+history).
- **App:** `useSentimentEngine` reads the equity feed when `assetClass==='stock'` — crowd gauge, 30d crowd-vs-price chart (same KV ring pattern, `crowd-hist-eq:v1:{TICKER}`), crowd read folded into the desk-read prompt.
- Equity lexicon for `crowd-stance`-style classify: bull = calls/long/moon/breakout/squeeze/undervalued; bear = puts/short/overvalued/bagholder/dump/miss; keep author-quality × engagement weighting as-is.

### Phase 4 — Regime engine convergence + board (later)
- `lib/token-regime.js` (crypto audit Phase 2) built asset-aware from day one: class (crypto bands | equity bands), volume regime (RVOL — works identically on stocks), price-discovery/ATH branch (applies verbatim to stocks at 52w-high), overbought-in-uptrend reframe. One regime engine, two asset vocabularies.
- Optional later: "Stocks Pulse" board (equity mindshare leaderboard — the X-Dash-lite for stocks) once Tier-2 data accumulates; NOT in scope now.

**Sequencing:** 0 → 1 ship together (TA is the ask); 2 immediately after (all sources in repo, no new infra); 3 needs a Hetzner deploy — stage separately; 4 rides the crypto regime work whenever it lands.

---

## D. RISKS / TRAPS (priced in)

| Risk | Mitigation |
|---|---|
| Yahoo unauth fragility (crumb 401/429 killed quoteSummary on Hetzner host) | Serverless already has cookie/crumb session + circuit breaker + 6h last-known LS fallback; keep Finnhub as candle/quote fallback once keyed; degrade honest ("data unavailable"), never fabricate |
| Yahoo intraday range caps (1m:7d, hourly:~2mo) | Resolution→range map + the engine's existing "needs N bars" honesty; never fake a 200-EMA |
| Ticker collision (crypto token named AAPL serving bars) | assetClass branch means stock path never queries crypto stores; crypto path never queries Yahoo |
| `routes/stocks.js` extracted-not-mounted | All dev-route edits go in `packages/server/index.js` inline block (or mount the module first as its own PR); every new route needs serverless parity (CLAUDE.md rule 5) |
| StockTwits rate limits (~200/hr unauth) | Universe-capped worker cadence + KV cache; watchlist-driven priority |
| Extended-hours prints polluting daily bars | Yahoo RTH default is fine; label pre/post explicitly if we ever add `includePrePost` |
| Shipping the broken scorer to stocks | Phase 1 REQUIRES the shared `scoreIndicator()` — non-negotiable gate |
| LLM cost | Same gateway/caching as crypto (20-min KV, groq-first chain); Tier-1 read ≈ crypto desk-read cost; Tier-2 classify on groq-8b batches. << $0.01/ticker/day amortized |

## E. SUCCESS CRITERIA

1. AAPL/PLTR/NVDA Technicals tab: real Yahoo bars on all offered clocks, honest warm-up nulls, S/R zones, thesis with earnings-gap awareness — zero crypto vocabulary.
2. The same RSI value carries ONE label across matrix/gauge/cases — for stocks AND crypto (shared scorer shipped).
3. Market-closed state is explicit (clocks labeled "as of Fri close"), never a stale-but-live-looking read.
4. Stock RZ Sentiment: grounded company read with sourced fundamentals (analyst consensus, earnings date, valuation frame); crowd gauge only lights up when a real feed exists.
5. No stock view ever fires the crypto bars chain (mobile leak dead; collision class dead).
6. Zero new paid services (Yahoo/StockTwits/Reddit/Finnhub-free/Groq).

## F. REUSE MAP

| Need | Reuse |
|---|---|
| Stock OHLC | `/api/stocks/candles` (Yahoo v8, dev+serverless live) via `stockApi.getStockCandles` |
| Fundamentals | Yahoo `quoteSummary` handler (`api/stocks.js:254`) + `getCompanyProfile` |
| Analyst/earnings | `/api/stocks/analysts`, `/api/stocks/earnings-calendar` (inline Express + extended-proxy) |
| Sector/macro | `/api/stocks/sectors`, `use-us-market-status.js`, `marketBrief.js` equities snapshot; Hetzner `tradfi_spot` (VIX/SPX/NDX) if server-side context wanted |
| Indicator math + S/R | `use-kline-indicators.js` internals + `sr-levels.js` — unchanged |
| Class frame | `classifyTokenClass` (`rz-market-context.jsx:24`) + equity branch |
| LLM + cache | `llm-gateway.js` chain + Upstash KV (`kv.js`), 20-min read / 30d ring patterns |
| Crowd pipeline pattern | `worker-reddit-firehose.js`, `mindshare-rollup.js`, `crowd-stance.js` ring — cloned with equity keys/lexicon |
| Session status | `use-us-market-status.js` (already mounted app-wide) |

## F2. PERPLEXITY FINANCE PARITY AUDIT (2026-07-06, Sunny: "check them out… improve our per-stock page and AI market outlook")

Perplexity Finance = per-asset pages (charts+overlays, fundamentals, analyst estimates, ownership: **politicians/insiders/holders/filings**, prediction markets), earnings hub (calendar + Quartr transcripts + live synthesis), NL screener, watchlist AI briefings, cited AI market summary. Their data is PAID/partner: FMP, **Unusual Whales (politician + options)**, Quartr, Fiscal.ai, S&P Global estimates, Polymarket.

**Source feasibility for us (probed live 2026-07-06):**
| Data | Free path | Verdict |
|---|---|---|
| Analyst targets + rec distribution | Yahoo `financialData`+`recommendationTrend` modules on our EXISTING crumbed session — probe: AAPL targetMean 315.09/high 400, rec buy, 42 analysts, full strongBuy…strongSell split | **FREE — P0** |
| Earnings estimates | Yahoo `calendarEvents` (already added for earningsDate) also carries `earningsAverage`/`revenueAverage` | **FREE — P0** |
| Insider trades | SEC EDGAR keyless (`data.sec.gov/submissions/CIK*.json` → Form 4 XML; AAPL shows 589 recent Form 4s) | **FREE — P1** |
| Prediction markets per stock | we ALREADY run Polymarket (`polymarketApi`, /predictions) — match events by ticker/company name | **FREE — P0** |
| Politician trades | community mirrors DEAD (Senate/House StockWatcher S3 = 403). Official: House clerk site 200 (yearly XML filing index + PTR PDFs), Senate eFD 403 (needs session/agreement flow, then HTML txn tables). Perplexity pays Unusual Whales | **SCRAPE BUILD (Hetzner worker) or paid UW/Quiver — P2** |
| Earnings transcripts/audio | Quartr/Fiscal = paid; no clean free source | SKIP |
| 13F holders / filings AI | EDGAR free but heavy parse | P2 |

**Gaps found in OUR stock page while auditing:** analyst route exists (`/api/stocks/analysts`) but NOTHING renders analyst data; the stock Overview "AI Analysis" card (`rz-markets-section.jsx` ~540) is TEMPLATE prose wearing a LIVE badge — same fabrication class the Command Center fix killed (PR #1173); `computeStockMacro` is also canned text.

**Build order:**
- **P0 (free, our rails, small):** (1) Analyst consensus card — add the two Yahoo modules to both fundamentals handlers → price-target (mean/high/low + implied upside vs price) + rec-distribution bar + analyst count on the stock page, and feed targetMean into the Technicals thesis; (2) Earnings card — countdown (earningsDate shipped) + est EPS/revenue; (3) Related prediction markets card (Polymarket event match by ticker/name); (4) kill/relabel the template "AI Analysis · LIVE" card — replace with the Phase-2 grounded desk read.
- **P1:** Insider activity — `/api/stocks/insiders/:symbol` (EDGAR submissions → last N Form 4 XMLs → buys/sells + net-insider-flow 90d; 6h cache, keyless) → card + thesis input ("insider net buying at 52w lows"). Then Phase 2 desk read ships with analyst+insider+earnings as grounded inputs.
- **P2 (the differentiator):** Politician trades — Hetzner worker scraping Senate eFD (session flow → electronic-filing HTML txn tables = parseable) + House yearly XML index (filer/date/PDF; PDF txn parse later) → `congress_trades` PG table → `/v1/congress/{trades,politician/:id}` → per-stock "Politicians" card + a board page (trade tape, top-traded tickers, per-politician portfolio). MVP = Senate txn detail + House filing-index; upgrade path = Unusual Whales API if we ever pay (that's literally Perplexity's vendor).

## G. AUDIT APPENDIX (file:line evidence)

- **TA stack unshipped since audit:** zero commits on origin/main since 2026-07-04 touch `use-kline-indicators.js`, `use-mtf-thesis.js`, `rz-technicals-tab.jsx`, `rz-trade-thesis.jsx`, `sr-levels.js`, `majorTokens.js`; `scoreIndicator`/`token-regime` = 0 hits repo-wide.
- **Stock gates:** `research-zone-lite.jsx:157` (isStock = marketMode), `:331-334` (force markets tab), `:349` (sentiment disabled); `research-zone-pro.jsx:119-131` (markets-only early return). Mobile: `TABS_STOCK` `research-zone-mobile.jsx:262-266`; unguarded hooks `:1174-1195`.
- **AAPL trace through crypto chain:** `/data-api/v1/chart?symbol=AAPL` → `{bars:[]}`; `/api/bars` `ticker-bare` → `no_data` (`bars-router.js:79-83`, `handlers/bars.js:402-441`); case-insensitive crypto resolution collision `bars-router.js:147-149`.
- **24/7 assumptions:** `from = to − resSec*barCount` `use-kline-indicators.js:306-309`; zero session/weekend handling stack-wide (grep-verified); S/R recency uses raw time span `sr-levels.js:129-141` (distortion only, no crash).
- **Stock data layer:** `apps/research/api/stocks.js` (535L serverless, Yahoo+Finnhub); Express inline `index.js:12527-13409` + sparkline `:15746`; `routes/stocks.js` NOT mounted; client `stockApi.js` (912L), hooks `useStockData.js`; UDF stock branch `tradingview-udf.js:92-124,422,616-650` (hardcoded symbol set = the limiter).
- **Hetzner equities (unused by app):** `macro-equity-quotes-ingester.js` (Mag-7+, 1min RTH), `tradfi-spot-ingester.js` (SPX/NDX/VIX/yields), routes `/v1/macro/equity-quotes|equity-indices|commodities|yields|earnings/upcoming` (`server.js:400-402,503`); quotes only, no OHLC history tables.
- **Sentiment portability:** `useSentimentEngine.js` (verdict/gauge asset-agnostic); `crowd-stance.js` (lexicon crypto-slang, KV ring portable); `sentiment-read.js` (CG-id spine + crypto prompt = the swap surface); `project-crawl.js` + GitHub check literally generic; X Dash collector (5.78.199.87:8092, cg_id universe) + mindshare_v2 chain (Groq 8b per-post) + momentum-origin + Spectre Take + Brain desk = CRYPTO-ONLY-REBUILD.
- **No stock sentiment today:** zero StockTwits/WSB/Benzinga hits both repos; Finnhub company-news headline-only on 'demo' key; `computeStockMacro` (`macro-analysis-engine.js:26-83`) is price-derived template text; equities LLM brief exists (`marketBrief.js` STOCK_BRIEF_SYSTEM_PROMPT) but no per-ticker sentiment.
- **Env:** `FINNHUB_API_KEY` empty in `.env` + `.env.example`, absent from `.env.production`; no polygon/alpaca/alphavantage/twelvedata/iex/fmp-API keys anywhere (fmp = logo images only).
