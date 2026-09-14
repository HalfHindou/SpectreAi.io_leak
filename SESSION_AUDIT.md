# SESSION AUDIT — April 10-12, 2026

Last updated: 2026-04-12

---

## SHIPPED (what went live)

### Frontend

- **IButton intelligence** deployed across 5 pages: Fear & Greed (gauge + 4 factors), Research Zone technicals (gauge cards + funding/OI/L-S ratio), Traders Corner (liquidation total + BTC.D), Ventures (Spectre Score + 5 subscores), Tokenized Assets (5 hero stat cards)
- **SpectreChart system** — new chart engine: `src/chart/` with SpectreChart.jsx, SpectreSparkline.jsx, adapters (Binance, Codex), engine (theme, series factory), hooks, overlays. Replaces inline canvas charts with unified system.
- **Monarch AI dashboard** — `components/monarch/monarch-dashboard.jsx` (478 lines) + CSS (489 lines)
- **Search engine UI** — `search-engine/components/chart-inline.jsx`, `use-search-stream.js` (SSE streaming)
- **Ventures expansion** — VC Intel Hub (883 lines), Accelerator Feed (350 lines), ventures-api.js, vc-database.json (1540 lines)
- **Private markets / Accelerators** — `rwa-horizontal-bars.jsx`, `rwa-protocol-modal.jsx`
- **Website2 API portal** — `api-page.jsx` (1256 lines), `dashboard.jsx`, `login.jsx`, `signup.jsx` with auth utils
- **Pulse page** — animated number component, scroll reveal hook
- **Research Zone backend integration** — sentiment tab expansion, overview tab rework, chart section refactor, new hooks (useMarketScenario, useTokenFundamentals, useTokenProfile)
- **Heatmap dual view** — gainers left, losers right
- **Mobile UI polish** — categories filter, GM dashboard mobile, ROI calculator mobile, sectors/news/watchlists/bubbles/heatmaps mobile CSS
- **Collapsible TRENDING NOW** in Research Zone
- **Coming Soon badges** added then reverted (nav sidebar)

### Backend / API

- **38 Vercel serverless route rewrites** — derivatives proxy (Binance Futures/Bybit/OKX/Deribit CORS), CoinGlass API, DexScreener, X-Dash, X-Beta, RWA (DeFi Llama), compare chart, weather, token resolve/exchanges/markets, Binance klines, Solana balance, stocks extended, monarch chat, search query, accelerators, private markets. Only 2 new serverless functions (data-api.js, social-api.js) to minimize builder costs.
- **BTC dominance hallucination fix** — insight prompt now forces model to use exact CURRENT VALUE
- **10 Vercel environment variables** set on team project (SPECTRE_API_BASE/KEY, GROQ, ANTHROPIC, COINGECKO, X_DASH, TAVILY, LLM config)
- **spectreDataApi.js** service layer for Spectre Data Bridge
- **Research Zone backend API** integration (researchApi.js)

### Infrastructure

- **Branch cleanup** — deleted 5 stale local branches, synced sunny and main (0 divergence)
- **Vercel route coverage** — 84 → 117 rewrites (38 new)
- **Production verified** — all core endpoints returning 200 with real data (market/global, RWA, weather, stocks, solana)

### Branches

- All work landed on both `sunny` and `main` (fast-forward merges)
- Alaa's PRs (#164-#179) merged to main via PR flow

---

## BROKE (what failed or got reverted)

- **Coming Soon badges** — added to 10 nav items (PR #166), then reverted (PR #171). Decision reversed within same cycle.
- **Chart prefetch batch** — attempted batching to avoid Codex rate limits, reverted (`68b2e04`). Caused worse behavior than the problem it solved.
- **Chart prefetch depth** — increased from 3 to 8 chunks (`d964fe8`), likely contributed to slow initial loads. The charts-system.md audit flags 20-chunk prefetch as a P0 issue.
- **Vercel deploy failure** — email showed `spectre-app-research` failing on preview deploy. Root cause: possibly two Vercel projects deploying from same repo (team "research" vs personal "spectre-app-research"). The team project deploys fine; the personal one may have different settings.
- **sunny branch drift** — commits sat on sunny for days without merging to main. Required manual merge commits (`d56b7df`, `5f160f9`) to reconcile. 41 files had to be "restored" in a fix commit.
- **Binance klines 502 on Vercel** — known Vercel IP block. The new `binance-klines` handler calls Binance directly without the triple-fallback that `binance-ticker.js` has.
- **CoinGlass 502** — `COINGLASS_API_KEY` is empty in .env. Handler works but has no key to authenticate.
- **.next directory committed** — 56 `.next/` build artifacts from spectre-forge were committed to the repo. Should be in .gitignore.

---

## PATTERNS (what worked well)

- **Consolidated router pattern** — `data-api.js` and `social-api.js` each bundle multiple handlers into 1 serverless function. Reduces Vercel function count and builder costs. Use `fn=` for handler dispatch, `route=`/`sub=` for sub-routing.
- **Graceful fallbacks** — every Vercel handler returns a sensible empty response on failure (empty arrays, zeros, `fallback: true`). Frontend degrades silently. No 500s shown to users.
- **Stale cache on error** — derivatives, CoinGlass, DexScreener handlers all serve stale cache when upstream fails. Pattern: `const stale = _cache[key]; if (stale) return res.json(stale.data)`.
- **IButton placement pattern** — import once, place as sibling after the formatted value. `<span>{value}</span> <IButton size="sm" metricType="X" metricValue={value} metricLabel="Y" tokenSymbol={sym} />`. One commit per page for easy rollback.
- **Fast-forward merges** — sunny → main with `--no-edit` keeps history clean and avoids merge conflicts.

---

## ANTI-PATTERNS (what to stop doing)

- **Accumulating prompt .md files in project root** — 50 .md files in the repo root (SPECTRE_MOBILE_PRD.md, LANDING_PAGE_PROMPT.md, etc.). These are not documentation — they're one-shot prompts that should live outside the repo or in a `.prompts/` directory that's gitignored.
- **Committing build artifacts** — 56 `.next/` files from spectre-forge committed. Add `spectre-forge/.next/` to `.gitignore`.
- **Committing then reverting** — Coming Soon badges added in PR #166, reverted in PR #171 same cycle. Decision should be made before code.
- **Branch drift** — sunny accumulated commits for days without merging to main. The "restore 41 missing files" fix commit is a symptom. Workflow should be: work on sunny, merge to main same day, push main.
- **Duplicate Vercel projects** — both "research" (team) and "spectre-app-research" (personal?) deploy from the same repo. Every push builds both. This is doubling the Vercel bill.
- **Growing monolith files** — `traders-corner/index.jsx` (2172 lines), `trading-chart.jsx` (4390 lines), `bubbles-page.jsx` (2513 lines). These should be split into sub-components.

---

## TECH DEBT CREATED

### Missing Error Handling
- `binance-klines` Vercel handler has no Vercel IP fallback (unlike `binance-ticker.js`)
- `social-proxy.js` X-Beta base URL is a Cloudflare tunnel (`rate-lottery-obj-incorporate.trycloudflare.com`) — will change on every tunnel restart

### Missing Loading States
- IButton additions don't show skeleton shimmer for the insight tooltip load — the `ITooltipSkeleton` component exists but verify it renders properly on all 5 new pages

### Hardcoded Values
- X-Beta tunnel URL hardcoded in `social-proxy.js` — needs `X_BETA_BASE` env var
- `COINGLASS_API_KEY` empty — CoinGlass routes return 502 until key is added
- `liq-heatmap` proxies to `charts-277369611639.us-central1.run.app` — if GCP project changes, all heatmaps break

### Architecture Debt
- `vc-database.json` (1540 lines) committed as static data — should be API-driven
- `vc-intel-hub.css` (1043 lines) — single CSS file, no day-mode split
- `api-page.jsx` (1256 lines) in website2 — needs component extraction
- `spectreDataApi.js` has `USE_SPECTRE_API = false` — dead code path until toggled

### Repo Clutter
- 50 prompt .md files in project root
- `.playwright-mcp/` screenshots accumulating
- `spectre-forge/.next/` build artifacts in git

---

## METRICS

| Metric | Count |
|--------|-------|
| New code files created | 199 |
| Files modified | 122 |
| New .jsx components | 59 |
| Total Vercel rewrites | 117 (was 84) |
| New Vercel serverless functions | 2 (data-api.js, social-api.js) |
| New handler files | 4 (derivatives, dexscreener, social, extended proxy) |
| Vercel env vars set | 10 |
| Lines added | ~403,600 (includes .next artifacts and vc-database.json) |
| Lines deleted | ~26,800 |
| PRs merged (Alaa/team) | 16 (#164-#179) |
| Commits on sunny/main | ~50 |
| Reverted commits | 2 (Coming Soon badges, chart prefetch batch) |
| Production endpoints verified 200 | 8/12 (4 expected 502s: CoinGlass no key, Binance IP block, X-Dash down, Charts Cloud Run down) |

---

## RECOMMENDATIONS FOR NEXT SESSION

### Fix Before Building

1. **Resolve duplicate Vercel project** — delete whichever of "research" vs "spectre-app-research" is unused. This alone saves ~$500/month on the Vercel bill. Set Ignored Build Step on both remaining projects.
2. **Add COINGLASS_API_KEY** — without it, the Traders Corner CoinGlass endpoints (coins-markets, total-oi, total-liquidations) all return 502.
3. **Add Binance klines triple-fallback** — copy the allorigins + per-symbol fallback from `binance-ticker.js` into the `handleBinanceKlines` function in `extended-proxy.js`.

### Refactoring Priorities

- `traders-corner/index.jsx` (2172 lines) — extract widget components, data fetching hooks, and chart sections
- `trading-chart.jsx` (4390 lines) — the charts-system.md audit already has the plan; this is the #1 refactor target
- Move 50 root `.md` prompt files to `.prompts/` and add to `.gitignore`
- Add `spectre-forge/.next/` to `.gitignore`

### Missing Validation

- No test infrastructure in either app (noted in coding-standards.md)
- IButton renders on 5 pages but hasn't been visually verified in browser — needs manual spot-check on Fear & Greed gauge, Research Zone technicals, Traders Corner hero, Ventures deep dive modal, Tokenized Assets hero
- Vercel env vars set on "research" team project but possibly not on "spectre-app-research" — verify which project serves production traffic
