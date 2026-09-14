# Correction Log
Auto-maintained. Max 30 entries. Entries >14 days old that have been promoted to rules are pruned.

| Date | Domain | Severity | Description | Root Cause | Rule Created? |
|------|--------|----------|-------------|------------|---------------|
| 2026-03-15 | CSS/Layout | HIGH | Ambient orbs confined to content area instead of full viewport | Used position: absolute inside max-width container. Should be position: fixed with inset: 0 outside the content container | Yes - design-system.md |
| 2026-03-15 | Workflow | MEDIUM | Not updating memory/rules files automatically after corrections | No explicit trigger list in workflow rules | Yes - workflow.md |
| 2026-03-15 | UX/Verify | LOW | Excessive MCP screenshot calls for CSS verification | Should use preview_snapshot or preview_eval, never preview_screenshot | Yes - dev-workflow.md |
| 2026-03-15 | Cross-app | MEDIUM | Icon URL fixed in research app but not trading app | Changes to shared patterns must be applied to both apps | No - needs rule |
| 2026-03-18 | Mobile/Layout | CRITICAL | Duplicate Command Center sections visible on mobile — desktop sidebar-row with CommandCenter was rendering alongside mobile MobileContentTabs | Desktop sections relied on CSS `display:none` inside `@media (max-width:768px)` but inline style logic `style={horizontalLayout && !isMobile ? {display:'none'} : {}}` produced empty style `{}` on mobile, and CSS hide was fragile. Never rely on CSS alone to hide desktop sections on mobile when a JSX `{!isMobile && ...}` guard is available. | Yes - mobile-design-system.md |
| 2026-03-19 | Mobile/CSS | HIGH | `.welcome-page` padding-top overlaid by header on mobile — 3 CSS files (`mobile-2026.css`, `welcome-page-responsive.css`, `welcome-page.mobile.css`) all set `.welcome-page` padding with `!important` at equal specificity. Winner depends on CSS load order which differs between dev and prod. | Cross-file `!important` conflict at same specificity. Review agents checked individual files but didn't cross-check for duplicate `!important` rules on the same selector across files. Also: missing `ui.btcDominance` i18n key showed raw key string. | Yes - workflow.md |
| 2026-03-18 | Review/QA | HIGH | 3 review agents (audy, frontyr, explore) failed to catch duplicate rendering of Command Center on mobile | Agents reviewed individual components in isolation (mobile-content-tabs.jsx, command-center.jsx) but didn't trace the full render tree in welcome-page.jsx to detect that BOTH were being rendered. Review agents must check full-page rendering guards (`isMobile`, `!isMobile`) for ALL major sections, not just individual components. | Yes - workflow.md |
| 2026-03-18 | CSS/Day-mode | CRITICAL | `replace_all` on `.mobile-brief-card.day-mode` created broken comma-grouped selectors where global day mode selector targeted card root instead of children | Bulk find-replace doesn't preserve context of child selectors. When converting day mode selectors, each rule must be individually rewritten with correct child paths. Never use `replace_all` for CSS selector migration — handle each rule manually. | Yes - coding-standards.md |
| 2026-03-19 | Mobile/Layout | HIGH | MobileMarketPulse (F&G + MCap) overlapped by fixed header. Content didn't clear the 52px header because parent `.welcome-page` had `padding: 8px !important` from a `@media(max-width:640px)` rule that competed with the child's `padding-top: calc(52px + ...)`. Fix: set `.welcome-page { padding-top: 0 !important }` on mobile, and use `!important` + CSS var `--m-header-h` on `.welcome-mobile-content` padding-top. **Why Audy missed it:** Audy checks CSS rules in isolation but doesn't simulate the full cascade chain (parent padding + child padding + `!important` specificity). | Yes - workflow.md, audy SOUL.md |
| 2026-03-19 | Mobile/Render | HIGH | TokenTicker marquee + Breaking News banner rendering on mobile below mobile content — unguarded by `{!isMobile}`. FrontyR visual audit found it; 3 prior review agents missed it. | Same pattern as sidebar-row bug: desktop sections outside the `{isMobile && ...}` block relied on CSS to hide but CSS didn't cover these elements. Fix: wrap in `{!isMobile && ...}`. | Yes - already in mobile-design-system.md |
| 2026-03-19 | Mobile/Perf | MEDIUM | Mobile header used `blur(20px)` violating the 12px max cap. Causes scroll jank on mid-range Android. | Hardcoded blur value not using `--m-blur-heavy` token. Fix: `var(--m-blur-heavy, blur(12px))`. | Already in rules |
| 2026-03-18 | Mobile/UX | CRITICAL | User reported "2 Command Center sections" — MobileBriefCard showed AI brief text, then Command Center's AI Brief tab showed identical content directly below. 3 review agents + my own analysis all misidentified it as a desktop/mobile rendering guard issue, when the real problem was same-data duplication between two mobile components. | Root cause: I added MobileBriefCard as a standalone card AND kept AI Brief as the default Command Center tab. Both show `briefDisplay` text. Fix: removed MobileBriefCard — Command Center AI Brief tab is sufficient. **Lesson: before adding a new mobile section, check if any existing section already displays the same data.** | Yes - mobile-design-system.md |

## 2026-04-08 | Codex onEventsCreated subscription fields
- **Domain:** API/WebSocket
- **Severity:** High
- **Description:** Codex `onEventsCreated` subscription does NOT support `priceUsd`, `priceUsdTotal`, or `priceBaseTokenTotal` fields. Adding these fields silently kills the subscription (no error, no data). Only `token0SwapValueUsd`, `token1SwapValueUsd`, `eventDisplayType`, `timestamp`, `transactionHash`, `maker` are confirmed working.
- **Root cause:** Assumed query fields from REST API docs were available in subscription responses. Subscription schema is a subset of the query schema.
- **Fix:** Keep subscription fields minimal (only confirmed working fields). Derive computed values (trade USD amount, token quantity) on the frontend using live token price from `onPricesUpdated`.

## 2026-04-08 | Codex onBarsUpdated returns pair-level prices, not token-level
- **Domain:** API/WebSocket
- **Severity:** High
- **Description:** `onBarsUpdated` subscription returns OHLCV for the pair's quote token (e.g. SOL at ~$84), not the memecoin's USD price. Injecting these into the chart creates a massive spike candle.
- **Root cause:** `quoteToken` parameter determines which side of the pair the bars represent. Without knowing which token0/token1 is the one being viewed, the data is ambiguous.
- **Fix:** Use `onPricesUpdated` (correct USD price per token) to update the last candle's close/high/low instead of `onBarsUpdated`.

## 2026-04-08 | Codex trade events - token0SwapValueUsd vs token1SwapValueUsd
- **Domain:** API/WebSocket
- **Severity:** Medium
- **Description:** For memecoin/SOL pairs, `token0SwapValueUsd` is microscopic ($0.00001) while `token1SwapValueUsd` is ~$83 (1 SOL). Both represent the same swap. `Math.max()` gives the correct trade USD value. Pump.fun tokens genuinely have uniform ~1 SOL trades.
- **Root cause:** Each swap value represents one side of the pair. The SOL side has the reliable USD pricing.
- **Fix:** Use `Math.max(t0Usd, t1Usd)` for trade USD value. Derive token amount from `usd / liveTokenPrice` on the frontend.

## 2026-04-08 | Codex onEventsCreated - amount0/amount1 not available
- **Domain:** API/WebSocket
- **Severity:** High
- **Description:** `amount0` and `amount1` fields do NOT exist on the subscription `Event` type. Causes "Cannot query field" error that silently kills the subscription.
- **Root cause:** Subscription schema is a strict subset of the query schema. Raw swap amounts are only available via REST queries, not real-time subscriptions.
- **Fix:** Use `token0SwapValueUsd` / `token1SwapValueUsd` only. These give the total USD value of each side. For pump.fun tokens, trades are genuinely uniform (~1 SOL each), so identical USD values are correct data, not a bug.

## 2026-04-08 | Codex onEventsCreated - getting actual trade amounts via SwapEventData
- **Domain:** API/WebSocket
- **Severity:** Critical (previous correction was WRONG)
- **Description:** Codex subscriptions DO support actual trade amounts via `data { ... on SwapEventData { amount0 amount1 amount0In amount0Out amount1In amount1Out } }`. These are RAW on-chain values (not decimals-adjusted). Divide by 10^decimals (9 for Solana, 18 for EVM) then multiply by tokenXSwapValueUsd to get real trade USD.
- **Previous wrong correction:** Said "pump.fun tokens genuinely have uniform ~1 SOL trades" and "subscription can't provide actual trade sizes" - BOTH WRONG. The trades DO vary ($1-$200) and the data IS available via SwapEventData.
- **Fields that DON'T work on subscriptions:** priceUsdTotal, priceBaseTokenTotal, priceUsd, amountNonLiquidityToken, amount0 (top-level), amount1 (top-level). All cause "Cannot query field" errors.
- **Fields that DO work:** data { ... on SwapEventData { amount0 amount1 amount0In amount0Out amount1In amount1Out } }
- **Fix:** Use SwapEventData amounts + network decimals to compute real trade USD. This gives GMGN-matching varied trade sizes.

## 2026-05-20 - CSP hardening broke TradingView chart (reverted)
- **What I did wrong:** Tightened trading app CSP by removing `'unsafe-inline'` from `script-src` (P2 #15, commit 3baa57f). Verified only via `npm run build` + checking `dist/index.html` had no inline `<script>` tags. Concluded it was safe.
- **Why it was wrong:** The TradingView Advanced Charting Library creates `srcdoc` iframes AT RUNTIME whose bodies contain inline `<script>` blocks. Those iframes inherit the parent document CSP. Removing `'unsafe-inline'` blocks them → chart silently fails (blank canvas + `changeSymbol/changeTheme/activeChart undefined` errors). The built `dist/index.html` has zero inline scripts, so a build-time check CANNOT catch this - the inline scripts only appear at runtime inside TradingView's srcdoc iframes.
- **Impact:** Broke prod (3rd time this exact CSP/TradingView bug has hit the team). Team reverted and added a DO-NOT-REMOVE comment block to `apps/trading/index.html`.
- **Rule going forward:** Any CSP change touching the trading app MUST be tested against a LIVE TradingView chart render (open a token page, confirm the chart boots), not just `npm run build` + dist inspection. `dist/index.html` inline-script absence is necessary but NOT sufficient. Trading's `script-src 'unsafe-inline'` is intentional - leave it until someone SHA-256-hashes every TradingView srcdoc inline script.

## 2026-05-26 - Token accent reliability: 7 compounding bugs (full system rebuild)
- **Domain:** Token-color extraction + accent pipeline + deep-link routing
- **Severity:** CRITICAL
- **Symptom:** User reported "we have cache-bugged issues" — uncurated tokens all looked silver/white; PAAL appeared green (hash hue) instead of purple; hard-refreshing a deep-link sometimes loaded UNI; switching tokens left stale colours.
- **Full reference (read this when working on accents):** `.claude/rules/token-accent-system.md`

### Bug #1: `#D4D4D8` sentinel collision (silver value used as failure signal)
- **Where:** `packages/server/index.js` `/api/token-color`, `apps/trading/src/utils/tokenColors.js` `fetchTokenColorFromServer`, `extractDominantColor`
- **Root cause:** Failure paths returned `'#D4D4D8'` (warm silver). That value is ALSO a legit brand colour (SPECTRE uses it, USDC variants too). Failure and a real colour were indistinguishable. Every uncurated token whose extraction failed converged to the same near-white, looking like "stale cache".
- **Fix:** Failure paths return `null`. Sentinel guards (`!== '#D4D4D8'`) dropped from all 4 callers (App.jsx orb tinter, RightPanel banner, TokenBanner, useAccentTheme priority 4). Server negative-caches `null` with 60s TTL (was 1h with the sentinel).
- **Rule:** A failure sentinel must NEVER be a legal value in the same domain. Failure = `null`/`undefined`/explicit `{ ok: false }`.

### Bug #2: 1D linear stride sampling kills square logos
- **Where:** `extractDominantColor` in `packages/server/index.js` AND the mirror function in `tokenColors.js`
- **Root cause:** Sampled pixels with `step = totalPixels / 256` over a flat array. For a 256×256 image that step equals `width`, so every sample lands in COLUMN 0. Token logos are typically centred on transparent backgrounds → column 0 is all alpha=0 → buckets stays empty → extraction returns null → fallback to hash hue.
- **Fix:** Walk a 2D grid: `gridStep = round(sqrt(totalPixels / 256))`, iterate `(x, y)` in nested loops.
- **Rule:** When sampling 2D raster data, NEVER use a linear stride over the flat buffer. Always walk a 2D grid, or use a stride coprime with `width`. Any stride that's a multiple of `width` collapses to a single column.

### Bug #3: Hard luminance rejection discards vibrant dark brand colours
- **Where:** `extractDominantColor` in `packages/server/index.js` end-of-function
- **Root cause:** `if (finalLum < 45) return null` threw away pure purple (lum=22), navy (lum=15), deep red (lum=27), forest green (lum=30) — all legitimate brand colours that happen to be naturally dark by luminance.
- **Fix:** Lift dark vibrant colours into a usable band: `if (lum < 80 && sat >= 0.1) { boost = 80/lum; r *= boost; g *= boost; b *= boost }`. Matches the client canvas extractor's behaviour for consistency.
- **Rule:** When normalising extracted colours, BOOST dark vibrants — don't reject them. Reject only desaturated greys (where there's no hue to preserve).

### Bug #4: Express search inflight Promise leak (concurrent search hang)
- **Where:** `packages/server/index.js` `/api/tokens/search` lines 5129 + 5250 (early returns inside try block)
- **Root cause:** Route uses `_codexSearchInflight` Map to dedupe concurrent searches. Inflight Promise was created at line 5031 but the two early-returns (`return res.json({...})` for "token not found" and "found with market data") returned WITHOUT calling `_resolveInflight(data)`. Promise stayed pending forever. Next caller for same query awaited the orphan → hung for `CODEX_SEARCH_CACHE_TTL` (30s) until the next request bypassed.
- **Fix:** Every early return inside the try block now `_resolveInflight(data)` + `_codexSearchCache.set(cacheKey, ...)` BEFORE `return res.json(data)`.
- **Rule:** Whenever you create an in-flight Promise outside a try/finally, audit EVERY early-return inside the try for `resolve(data)` calls. Better: use try/finally with a single resolve, or wrap the whole handler body in an async IIFE.

### Bug #5: Deep-link resolver substituted UNI for low-cap addresses (fuzzy search blind pick)
- **Where:** `apps/trading/src/App.jsx` line 638-655 deep-link `resolveToken()`
- **Root cause:** Used `searchTokens(address)` then took `results[0]` without validating the address matched the request. Codex's search is fuzzy: low-cap addresses Codex doesn't index returned UNI (top liquidity/popularity) as the best fuzzy match. Hard-refresh of any random low-cap deep-link silently navigated to UNI.
- **Fix:** Replace `results[0]` with `.find(r => r.token.address.toLowerCase() === wantedAddr)`. Also validate the `getDetailedTokenInfo` fallback's returned address before calling `selectToken`.
- **Rule:** NEVER trust fuzzy search results when an exact lookup is needed. Always validate `result.identifier === requested.identifier` before using `results[0]`.

### Bug #6: 2s client timeout on `/api/token-color` too tight for cold page load
- **Where:** `apps/trading/src/utils/tokenColors.js` `fetchTokenColorFromServer`
- **Root cause:** 2-second `AbortSignal.timeout(2000)` competed with browser request queueing on cold page load (~30 concurrent requests: Codex search/details/bars, dossier, image proxies, etc.). Server responded in 50ms once it got to handle the request but the browser sometimes queued it for >2s. Async accent upgrade silently fell back to hash hue.
- **Fix:** Bumped to 5000ms. Server itself caps PNG fetch at 5s upstream, so client timeout matches server timeout.
- **Rule:** Client timeouts on `/api/*` should account for cold-load request queueing — not just server response time. Minimum 5s for non-critical extraction calls. Test with browser DevTools → Network throttling "Fast 3G" to simulate.

### Bug #7: Deep-link placeholder dropped logo when localStorage cache didn't match
- **Where:** `apps/trading/src/App.jsx` line 454-484 `useState` initialiser
- **Root cause:** Deep-link branch always seeded `{ ...defaultToken, address: <addr>, symbol: '...', name: '' }` — no logo. useAccentTheme priority 4 gates on `if (token.logo)` so it never ran. Hash hue stuck until the async resolver eventually populated the token (which silently failed for various reasons — Codex timeouts, fuzzy-match wrong-token, etc.).
- **Fix:** Initialiser now checks if localStorage cache's address matches the deep-link address; if so, return the cached token (with full data including logo) instead of placeholder. Placeholder only fires when there's NO matching cache.
- **Rule:** When initialising state from URL/deep-link, exhaust ALL available local sources (localStorage cache by address, URL params, sessionStorage) before falling back to a placeholder. Placeholders gate downstream effects.

### Cross-cutting lesson
Bugs 1+2+3 compound in extraction systems: a bad sentinel hid the failure, bad sampling caused the failure, and bad rejection threshold caused more failures. Each individual fix unmasked the next bug down the stack. When debugging an extraction pipeline, fix the FAILURE SIGNAL (null vs sentinel) FIRST — without that, you can't tell which sub-step is broken.

### Bug #8: Trading day-mode CSS written with `.app.app-day-mode` (dead) instead of `body.theme-light`  (2026-06-25, review)
- **Where:** `apps/trading/src/components/MajorCoinPanel.css`
- **Domain:** design-system / day-mode · Severity: CRITICAL (visible)
- **Root cause:** Followed design-system.md's "every dark style needs `.app.app-day-mode`", but the TRADING app NEVER applies that class — it toggles `body.theme-light` (App.jsx:383/439, Header.jsx:166). So the rules were dead, and since the panel lives inside DataTabs (which flips to light via 91 `body.theme-light` rules) it would render as a dark obsidian island in a light container. Obsidian tokens (`--text-1`, `--ob-surface-*`, `--glass-*`) are NOT redefined under `body.theme-light`, so token-only components stay dark regardless.
- **Fix:** Swapped all `.app.app-day-mode .mcp*` -> `body.theme-light .mcp*` (light colors already correct). Build re-verified.
- **Rule:** Trading day-mode = `body.theme-light`, NOT `.app.app-day-mode` (research-only). Grep a sibling component's CSS for the established selector before writing day-mode CSS. design-system.md §H updated.

### Bug #9: External CoinGecko `trade_url` placed into an `<a href>` without scheme validation  (2026-06-25, review)
- **Where:** `apps/trading/src/hooks/useMajorMarketData.js`
- **Domain:** data safety / XSS · Severity: CRITICAL (defense-in-depth)
- **Root cause:** `tradeUrl: t.trade_url` from CoinGecko piped straight into `<a href>`; a `javascript:`-scheme value would execute on click.
- **Fix:** Sanitize at the data layer — `tradeUrl: /^https?:\/\//i.test(t.trade_url) ? t.trade_url : null`.
- **Rule:** Never interpolate an external/API URL into an `href`/`src`/`window.open` without validating the scheme is `http(s)`. Treat API data as untrusted for URL sinks.

## 2026-07-06 — Stocks TA/Sentiment rollout: five user corrections in one review cycle
**What happened:** Shipped stock Technicals/Sentiment across two review rounds where Sunny found: broken TV chart (NMS:AAPL), dead left-rail fields (0.00% dividend = unit bug), missing Sentiment tab, desk read blind to the Nasdaq-100 catalyst sitting in our own Agent RSS rail, empty crowd box while the Tweets rail was full, and a widget-only chart with no S/R/EMA overlays.
**Root causes:** (1) Never opened the rendered page — verified only builds + curls. Every finding was visible on first glance in a browser. (2) Treated scope boundaries ("Phase 2") as shipped-state without flagging the hole in the product surface. (3) Built new data legs (Google News) without first auditing what feeds the page ALREADY has (rz-catalysts, stock tweets).
**Rules:** Browser-verify EVERY user-facing change before reporting done (claude-in-chrome exists — use it: all tabs, ≥2 tickers incl. one NYSE name, console errors). Before adding a data source, grep what the page already fetches and reuse it. When scoping a surface out, say loudly what will be visibly missing.

## 2026-07-07 - data layer - medium - stale-seed + INFLIGHT ordering
When adding stale-while-revalidate to a cache layer (fetchBaseJson), preserving the seed's real ts in the memory cache made the SECOND concurrent caller fall into the INFLIGHT branch and await the network instead of painting from the seed. Rule: any stale-serve path must be checked in EVERY early-return branch of the fetch function (memory hit, INFLIGHT hit, cooldown), not just the main path. Root cause: branch order in cache-aside functions is part of the contract.

## 2026-07-08 - data layer - medium - early-fetch adoption needs a freshness window
Wiring consumeEarlyFetch into a service that can be called LONG after boot (codexTrendingCached - re-entered on 5-min trending-cache expiry and by late fallback paths) would have adopted an HTML-parse-time response minutes stale and cached it as fresh. Rule: every consumeEarlyFetch adopter must gate on a boot window (`performance.now() < ~30s`) unless the consumer provably runs only at boot. Root cause: early-fetch promises carry no timestamp; consume-once semantics do not protect against LATE consumption, only against double consumption.

## 2026-07-27 — "более профессиональные иконки" != заменить иконки на шкалу

**Контекст:** иконки тиров трейдера в мобильной ленте транзакций (`apps/trading/src/components/mobile/TraderTier.jsx`).
**Просьба:** "давай их поменяем на более профессиональные, поищешь другие и предложешь варианты".
**Что сделал не так:** предложил 6 абстрактных вариантов (столбики сигнала, точки, кольцо, буквенный чип, текстовый диапазон) — то есть убрал иконки вместо того, чтобы найти иконки лучше. Ответ: "все варианты не очень".
**Правило:** "поищи другие иконки" = искать в иконочных библиотеках в той же метафоре, а не менять метафору. Смена метафоры — отдельное предложение, и только после того, как показал honest поиск по существующим наборам.
**Как искать:** Iconify API даёт поиск по ~200k иконок из 150+ наборов —
`curl "https://api.iconify.design/search?query=whale&limit=999"` и
`curl "https://api.iconify.design/{prefix}.json?icons=a,b,c"` (тела SVG с currentColor).
Считать пересечение наборов по всем нужным глифам: набор без одного зверя развалится.
**Плюс:** смотреть глифы своими глазами в браузере ДО рекомендации. `file://` расширение Chrome не открывает — поднимать `python3 -m http.server` и ходить на 127.0.0.1. Локально будет мохибейка без charset-заголовка (в артефакте кодировка нормальная) — не баг.

## 2026-07-28 — prod source-hierarchy silently overrides the vetted model (liq-heatmap)

**Domain:** serverless handlers / data-source fallback chains. **Severity:** critical (latent).
**Что было:** `charts-proxy.js` liq-heatmap на проде сначала спрашивал Spectre `/v1/derivatives/heatmap/` и при "пригодном" гриде отдавал ЕГО, а синтезатор (модель, под которую выверен рендер) был фолбэком. Пока Hetzner DB лежит — незаметно; в день оживления DB прод молча свапнулся бы на другую текстуру (класс dev/prod-расхождения из rz-chart-audit §A3).
**Root cause:** иерархия источников писалась, когда "authoritative" значило "живой", а не "выверенный". После тюнинга рендера под конкретную модель порядок никто не пересмотрел.
**Правило:** после того как фронт визуально выверен под КОНКРЕТНУЮ модель данных, эта модель становится primary во ВСЕХ окружениях; внешний/DB-источник — только фолбэк, и смена источника должна быть видимой (`_source` в ответе).

## 2026-08-13 — [ATTRIBUTION] Two wrong attributions in one incident: adopted claim, then overcorrection

**Domain:** incident/cost attribution. **Severity:** high (a day of team time, wrong messages to CTO).
**What happened:** Codex spike on the box's `spectre-prod-ingestion` key. Round 1: adopted another agent's mechanism ("scanner = live Codex") without probing → said "yes, it's us" and shipped a PR on that story. Round 2: probed, found scanner serves from DS/GT with the key disabled → swung to "scanner has no Codex at all" — ALSO wrong: its Codex enrichment bills asynchronously, invisible to request-path probes. Round 3: built a registration-burst theory from repo reading — refuted by the box's own SQL (16 rows, no burst). Only counterparty data settled it (seeded queue draining + scanner step).
**Rules:**
1. Probe before adopting anyone's mechanism claim — one negative-case probe (bogus address → the 404 text named the real sources) took 30s and killed round 1.
2. A clean request-path probe does NOT rule out async/deferred spend. Attribution of metered usage needs the counterparty's own data (SQL, worker logs, per-key dashboards), not response observation.
3. Before claiming "file X does not exist", `find` the whole repo — I declared `codex-metrics-kv.js` dead after searching only `apps/*/api/_lib/`; it lives in `packages/server/lib/` and held the decisive number (our apps = 0.2% of spend).
4. Fastest "is it us?" check for any Codex-cost question: read `codex:m:<date>` in Upstash with the `.env` KV creds — per-op, per-source counters, 30 seconds.

## 2026-09-04 - Lite Research redesign: reshuffled cards read as "the same page"

**What happened:** asked to make the Lite Research page "better and prettier", I kept the
same glass cards and re-arranged them (hero strip with price + stats, key numbers moved
to a column). Evgeniy: "не очень нравится" - too similar to the old page, the hero strip
did not land. Second pass (chart with no card around it, one hairline-sectioned
surface below) was the direction he picked.

**Rules:**
1. "Сделай красивее" on an existing page means a visibly different composition, not the
   same panels in a new order. Before building, name what the reader will see differently
   at first glance; if the answer is "the same cards, moved", it is not a redesign.
2. A full-width "hero strip" of stats above the tabs is a dashboard pattern, not a
   research-page pattern - it splits the identity from the chart. Price belongs with the
   chart (Apple Stocks / Robinhood), not in its own bar.
3. Offer 2-3 directions with ASCII previews and let the founder pick BEFORE writing code;
   the first approval was for a plan that sounded different but rendered the same.
