---
description: Research app map - page-by-page index, layout tiers, state map, service/hook navigation, footguns. Load before any apps/research task to navigate without re-exploring.
paths: ["apps/research/**"]
---

# Research Platform Map

> Navigation hub for `apps/research/`. Answers "where does X live / what feeds page Y / which shell tier" in one lookup.
> This file is an **index**, not a restatement. For depth, follow the cross-references in section J - it deliberately does NOT duplicate `api-patterns.md`, `data-sources.md`, `design-system.md`, `coding-standards.md`, or `page-patterns.md`.
> **Re-verified against `App.jsx` + filesystem on 2026-09-03:** **~68 page folders**, **~31 services**, **~59 hooks**, **~36 serverless routers + ~63 handlers**.
>
> 🪤 This file was written on 2026-05-21 to be the one place with correct counts, and it called every other doc stale. By 2026-09-03 it was stale itself - 56 vs 68 folders, and **11 pages were missing from section D entirely**. Exact counts in prose rot; do not trust any number here without re-running the check. The page index is worth keeping because it says what each page DOES, not because the total is right.
>
> Re-check the index against the filesystem before relying on it:
> ```bash
> comm -23 <(ls -d apps/research/src/pages/*/ | xargs -n1 basename | sort) \
>          <(grep -o '`[a-z0-9-]*/`' apps/research/.claude/rules/research-platform.md | tr -d '`/' | sort -u)
> ```
> Anything it prints is a page the index does not mention.

---

## A. How a page renders (URL to pixels)

`main.jsx` mounts React inside `AppErrorBoundary`, runs `migrateOldSettings()` (hydrates Zustand from localStorage) and analytics init **before** first render, then conditionally wraps in `PrivyProvider` (only if `PRIVY_APP_ID` set). `App.jsx` then nests the provider stack, matches the route, and renders the page through its layout tier. Page reads state from Zustand (prefs) + Contexts (token, watchlists, currency) and fetches via hooks -> services -> `/api/*` (Vite proxy to Express :3001 in dev, Vercel functions in prod). Theme = `.app.app-day-mode` class toggled from `dayMode`.

### Provider stack (outer -> inner), `App.jsx` L349-462
```
[ProfileSyncInit if PRIVY_APP_ID]  [DemoMode if ?demo=true]
I18nCurrencyProvider -> CopyToastProvider -> AppStateProvider -> MonarchProvider
  -> WatchlistsProvider -> SocialDossierProvider -> AuthGate -> DemoLockGate
  -> Suspense(fallback=null) -> [ShowcaseLockSentinel, SurfaceTracker, RouteMeta] -> Routes
```
Order matters: I18nCurrency is outermost domain provider (others read currency/lang); AppState wraps Monarch+Watchlists (they read selected token); AuthGate/DemoLockGate sit innermost before routes. `BrowserRouter` itself is in `main.jsx`.

---

## B. Layout tiers (from the `App.jsx` route tree)

Every route is wrapped in `<PageErrorBoundary>` and gated by `<EmbedGuard>` (showcase iframe lock). Three render tiers:

| Tier | Wrapper | Pages |
|------|---------|-------|
| **Standalone** (no AppShell, no nav/header) | `EmbedGuard` only | newsroom, embed-chart, website, website2 (+ /api, /api/signup, /api/login, /api/dashboard), lp, facts, admin-tg-onboard, dev-spectre-audit, vs/:competitor, how-to/:guide |
| **AppShell only** (nav+header, own full-viewport body) | `<AppShell>` | token (+/:tokenId), gm-dashboard, monarch-chat, world, x-intelligence, x-bubbles |
| **AppShell + PageShell** (standard chrome + page padding) | `<AppShell><PageShell>` | everything else (see section D) |
| Catch-all `*` | - | `<Navigate to="/" replace>` |

Shell files: `components/layouts/{app-shell,page-shell,page-layout}.jsx`. Chrome: `components/header.jsx` + `navigation-sidebar.jsx` (collapse from `navSidebarCollapsed`); mobile `mobile-header.jsx` + `mobile-bottom-nav.jsx`.

**Showcase lock** (`App.jsx` L20-152): when embedded in the `/website2` marketing iframe (`?embed=showcase` or cross-frame), only `SHOWCASE_ALLOWED_PATHS` render; everything else fires a toast and redirects to `/`. Enforced 3 ways - a module-load `history.pushState`/`replaceState` patch, the render-time `EmbedGuard`, and the `ShowcaseLockSentinel` effect. Touch with care.

---

## C. Page folder convention

`src/pages/{kebab-name}/index.jsx` = thin wrapper (reads stores/contexts, passes flat props). UI + CSS live in `src/pages/{kebab-name}/components/`. So the **folder is the anchor** - open it and the `components/` subfolder holds the actual page component (usually `{kebab-name}-page.jsx`). See `page-patterns.md`.

---

## D. Page index (~68 folders)

### Standalone / marketing
| Route | Folder | What it does | Cx |
|-------|--------|--------------|----|
| `/newsroom` | `newsroom/` | CoinDesk-style publication: hero, breaking news, live tickers | C |
| `/embed/chart/:cgId` | `embed-chart/` | Standalone embeddable token chart iframe | S |
| `/website` | `website/` | Legacy marketing landing (being phased out) | M |
| `/website2` (+`/api`,`/api/signup`,`/api/login`,`/api/dashboard`) | `website2/` | Modern marketing home + public API hub/auth/dashboard. **Geist/Fustat fonts, NO mono - see design-system L** | M |
| `/lp` | `lp/` | Optimized landing page, in-page anchors, Instrument Serif hero | M |
| `/facts` | `facts/` | Canonical company facts for LLM/GEO ingestion (JSON-LD) | S |
| `/admin/tg-onboard` | `admin-tg-onboard/` | Telegram session QR generation + polling (admin setup) | M |
| `/dev/spectre-audit` | `dev-spectre-audit/` | Internal Spectre-vs-legacy side-by-side audit (8 tabs) | C |
| `/vs/:competitor` | `vs/` | Competitor comparison pages (catalog in `vs/.../competitors.js`) | M |
| `/how-to/:guide` | `how-to/` | Educational guides (catalog `guides.js`) | S |

### Special layout (AppShell, no PageShell)
| Route | Folder | What it does | Key data | Cx |
|-------|--------|--------------|----------|----|
| `/token`, `/token/:tokenId` | `token/` | **iframe embed of trading app** (chart+swap). Research owns left token list + watchlist postMessage sync. Don't duplicate chart/swap here | iframe postMessage, `useWatchlists`, `useAppState` | C |
| `/gm-dashboard` | `gm-dashboard/` | Full-screen GM overlay dashboard | internal | M |
| `/monarch-chat` | `monarch-chat/` | 3-column AI chat (history\|chat\|context) | `MonarchContext`, monarch-api | C |
| `/world` | `world/` | Full-screen 3D globe "War Room" (WebGL) | live market data | C |
| `/x-intelligence` | `x-intelligence/` | Full-viewport force-directed social graph | X social graph | C |
| `/x-bubbles` | `x-bubbles/` | Full-viewport X influence force graph (canvas) | X social graph | C |

### Data / markets (AppShell + PageShell)
| Route | Folder | What it does | Key data | Cx |
|-------|--------|--------------|----------|----|
| `/` | `home/` | Welcome page: hero, trending cards, market-mode toggle, tabbed bar (Brief/News/Liq/Heatmap/Sectors/Mindshare/Calendar/Flows). **Reference impl** | `useMarketIntel`, `useSectorData`, `useMindshareData`, CoinGecko, Binance | C |
| `/discover` | `discover/` | Curated token discovery cards, click -> research-zone | trending, token metadata | M |
| `/watchlists` | `watchlists/` | Watchlist CRUD (crypto+stock), rename/reorder/pin | **`WatchlistsContext`**, `useWatchlistPrices` | M |
| `/categories`(+`/:categoryId`) | `categories/` | Market category heatmap + drill-down | CoinGecko categories | M |
| `/heatmaps` | `heatmaps/` | Market-cap heatmap (canvas) | market cap, prices | M |
| `/bubbles` | `bubbles/` | Bubble chart (size=mcap, pos=24h%) canvas | market metrics | M |
| `/fear-greed` | `fear-greed/` | Fear & Greed gauge + history + sentiment movers | `fearGreedApi` (**throws**) | M |
| `/tokenized-assets` | `tokenized-assets/` | RWA marketplace grid | RWA token data | M |
| `/liquidation-heatmap` | `liquidation-heatmap/` | Exchange liquidation cascade heatmap | liq aggregation | M |
| `/research-zone/:coinSlug?` | `research-zone/` | Deep token research, 3-col (markets\|charts\|tools) | `useSpectreAssetData`, charts, `rzLocalStorage` | C |
| `/dossier`(+`/:chain/:ca`) | `dossier/` | Contract dossier: deployer, holders, tx, code | `dossierApi`, `useDossierProject` | M |
| `/pulse` | `pulse/` | Real-time market pulse / heartbeat | live aggregation | M |
| `/ventures` | `ventures/` | VC-backed projects + funding rounds | funding data | M |
| `/private-markets` | `private-markets/` | Private equity / secondary listings | private market feeds | M |
| `/zigchain` | `zigchain/` | ZIGChain protocol hub | protocol data | M |
| `/predictions`(+`/:eventSlug`) | `predictions/` | Prediction markets, grid->detail (lazy split) | `polymarketApi` | M |

### AI / content
| Route | Folder | What it does | Key data | Cx |
|-------|--------|--------------|----------|----|
| `/intelligence` | `intelligence/` | Editorial hub: hero, breaking, daily brief, analysis, detective feed | `useDetectiveFeed`, `useAdaptivePolling`, intel-api | C |
| `/intelligence/:type/:slug` | `intelligence/components/ArticlePage` | Single article reader (lazy-split) | article content | M |
| `/insights`, `/intelligence-feed` | `intelligence-feed/` | Streaming intelligence feed | `useSignalEngine`, adaptive polling | M |
| `/news`(+`/:articleId`) | `news/` | Crypto news feed + reader | `cryptoNewsApi` | M |
| `/ai-charts` | `ai-charts/` | AI-generated TA charts | AI analysis | C |
| `/ai-market-analysis` | `ai-market-analysis/` | Macro+micro AI analysis reports | market+AI | M |
| `/ai-media-center` | `media-center/` | AI-generated market videos (own error boundary) | `mediaApi`, `useMediaStore` | M |
| `/brain` | `brain/` | Spectre AI knowledge brain / chat | `useBrainChat`, `useBrainStream` | M |

### Social / X
| Route | Folder | What it does | Key data | Cx |
|-------|--------|--------------|----------|----|
| `/social-zone` | `social-zone/` | Cross-platform social sentiment | social APIs | M |
| `/x-dash`(+ 6 sub-routes) | `x-dash/` | X analytics dashboard: creators, token/:cgId, author/:authorId, new-tokens, rotations, creator-edits | **`useXDash*` (12 hooks)** | C |
| `/x-intel` | `x-intel/` | Aggregated X mentions, trends, bot detection | `useTokenMentions` | M |
| `/lens` | `lens/` | Lens Protocol social graph | Lens API | M |

### Tools
| Route | Folder | What it does | Key data | Cx |
|-------|--------|--------------|----------|----|
| `/search-engine`, `/search` | `search-engine/` (v1) · `search-engine-v2/` (`?v=2`) | Semantic token search. v1 = default (good-morning hero + trending); v2 = opt-in results-only refactor | `useWhisperSearch`*, search-api | C |
| `/roi-calculator` | `roi-calculator/` | Entry/exit position calculator | form state | S |
| `/economic-calendar` | `economic-calendar/` | Macro events calendar w/ impact | calendar-api | M |
| `/traders-corner` | `traders-corner/` | Bloomberg-terminal-grade 3-col (intel\|chart\|derivatives): funding, OI, L/S ratio, liq heatmap, TV embed | derivatives-proxy, page-local `tradersCornerApi` | C |
| `/alerts` | `alerts/` | User custom alerts (price / volume / news) management | notifications-api, `useNotificationPoller` | M |
| `/structure-guide` | `structure-guide/` | Protocol/chain org diagrams (static) | SVG | S |

### User
| Route | Folder | What it does | Key data | Cx |
|-------|--------|--------------|----------|----|
| `/you` | `you/` | Modular personal dashboard, react-grid-layout, 36+ widgets, 2 tabs (dashboard+studio). **Largest page** | `useYouComposer`, `useYouTracking` | C |
| `/user-dashboard` | `user-dashboard/` | Account: profile, wallets, referral, plan, history | Privy, `useWalletBalances`, `profileSync` | M |

### Unrouted folders (exist, NOT in App.jsx - treat as dead/internal unless reviving)
`admin/`, `auth/`, `pricing/`, `x-bubble-maps/`. (`glossary/` no longer exists - referenced only in stale `responsive-rollout-plan.md`.)

\* `useWhisperSearch` (NL "whisper mode") -> `POST /api/search/whisper`. Dev = real Groq+Spectre parsing (`packages/server/routes/search.js`); prod serverless handler is a **deliberate stub** (`api/_lib/handlers/search-api.js` route=whisper) returning `{ fallback:true, results:[] }`. So NL mode is a no-op in prod - but regular token search (`route=tokens`) works fully. See section H.

---

### Added since the 2026-05-21 index (found missing 2026-09-03)

These 11 were routed in `App.jsx` but absent from every table above, i.e.
invisible to anyone navigating by this file.

| Route | Folder | What it does | Cx |
|-------|--------|--------------|----|
| `/alt-rotation` | `alt-rotation/` | Alt Rotation Radar - "is it go time to bid alts from majors?", verdict-led, grouped by chain then meme/utility | C |
| `/why` | `why/` | Why Mode - what is moving the market right now and who did it; divergence read as the answer, timeline as evidence | C |
| `/potential-gainers` | `potential-gainers/` | PGBoard - persistent signal board off `/api/momentum/setups/signals`, grouped by lifecycle | M |
| `/etfs` | `etf-flows/` | Dedicated page around the shared `EtfFlowsView` | M |
| `/vitals`, `/vitals/:slug` | `vitals/` | VITALS index - platform fundamentals behind a segmented control (not a scroll) | C |
| `/world-state` | `world-state/` | Macro briefing wall built to show it is being maintained | C |
| `/arena` | `arena/` | Agent Arena - twelve machine books trading the same tape under fixed rules, scoreboard | C |
| `/cinema` | `market-cinema/` | Live market cinema stage - lanes, narration, HUD; feed via `use-cnm-feed` | C |
| `/lite` | `lite/` | Spectre LITE cinema - immersive one-token-at-a-time flip-through over Trending / Watchlist / Movers | C |
| `/wallets` | `wallets/` | Full wallet-analysis surface - AI Read hero + Flows / Smart Money / Hyperliquid / Tape tabs (whale radar, CEX-ETF-stables ledgers, Nansen netflow board) | C |
| `/dev/freshness` | `dev-freshness/` | Internal diagnostic - freshness of every critical data endpoint at a glance | M |

`screener-lite/` is **not a routed page** - it is a CSS-only folder whose
stylesheets `lite/components/lite-cinema.jsx` imports. It has no `index.jsx`.

## E. State map

### Zustand stores (`src/store/`) - persisted user prefs
| Store | localStorage key | Holds |
|-------|------------------|-------|
| `useSettingsStore.js` | `spectre-settings` | dayMode, appDisplayMode, marketMode, navSidebarCollapsed, currency, language, profile, chart prefs, notificationPrefs + **server sync** (debounced POST `/api/user/settings`, `partialize` drops `_sync*`) |
| `useNotificationStore.js` | `spectre-notifications` | signal notifications, read/unread |
| `useMediaStore.js` | `spectre-media` | media playback / upload caches |
| `migrateOldSettings.js` | - | runs once before React mounts; only touch when changing localStorage keys |

Use selectors for granular re-renders: `useSettingsStore((s) => s.dayMode)`. Never `localStorage.getItem/setItem` for settings - go through the store.

### Contexts (`src/contexts/`) - transient + domain state
| Context | Owns |
|---------|------|
| `AppStateContext.jsx` | selected `token`, `researchZoneToken`, panel collapse flags, `mobileTokenTab` (persists `spectre-selected-token`) |
| `WatchlistsContext.jsx` | crypto + stock watchlists, active id, full CRUD (persists `spectre-watchlists*`) |
| `I18nCurrencyContext.jsx` | currency, language, exchange rate (15min), `fmtPrice`/`fmtLarge` formatters - use via `useCurrency()` |
| `MonarchContext.jsx` | AI chat messages, streaming state (persists `monarch-chat-history`) |
| `CopyToastContext.jsx` | copy-to-clipboard toast (2s auto-clear) |
| `MobilePreviewContext.js` | mobile preview-frame flag |
| `SocialDossierProvider` | `components/social-dossiers/use-social-dossier` - social dossier data + Monarch integration |

Rule: Zustand = persisted prefs; Context = transient/domain. See `coding-standards.md` H + `page-patterns.md`.

---

## F. Data layer (navigation index)

> Cache TTLs, dedup, error-return shapes, dev/prod URL split, Binance fallback, data-source priority -> **`api-patterns.md`** and **`data-sources.md`** (authoritative). This is just the where-does-it-live index for all 26 services / 44 hooks.

### Services (`src/services/`, 26)
**Market data** - `coinGeckoApi` (markets/sparklines, 30s/5min cache), `binanceApi` (24h ticker, stables=1), `binanceCatalog` (which symbols have Binance pairs), `codexApi` (Codex GraphQL: search/details/bars/trending), `codexStreamApi` (Codex WS live), `dexscreenerApi` (DEX pairs), `stockApi` (Yahoo/Finnhub + CORS proxies + hardcoded fallback), `fearGreedApi` (**throws** on error), `sectorSnapshot`, `polymarketApi` (Gamma, 3min).
**Spectre backends** - `spectreMarketApi` (low-level fetchers, `/spectre-market-api` + `/data-api/v1`, TTL map), `spectreApi` (Cloud Function `SearchEngineApiV4` via `/spectre-api`: sentiment/social/AI, 5min), `spectreDataApi` (Hetzner bridge `204.168.244.18` via `/data-api/*`, **flag `USE_SPECTRE_API=true`**), `appResearchApi` (legacy Cloud Run, now `/api/search/tokens` + `/api/token/market-profile`), `researchApi` (`/api/token/market-profile|market-scenario|fundamentals`, Groq routes pending).
**On-chain / wallet / swap** - `onchainApi` (api-eth backend via `/api/onchain/*`, mirrors codexApi signatures, EVM 1/56 + Solana), `onchainWs`, `dossierApi` (`/api/dossier/*`, single source of truth), `walletService` (RPC providers cached per chain), `swapService` (Jupiter/0x quotes, fee config 5min, sign client-side).
**Content / social** - `cryptoNewsApi` (CryptoCompare+CryptoPanic), `stockNewsApi`, `mediaApi`.
**Infra / util** - `analytics` (PostHog wrapper - always `import { track, Events } from '@/services/analytics'`), `profileSync` (`setAuthToken`/`fetchProfile` -> Vercel KV), `rzLocalStorage` (research-zone persistence).

### Hooks (`src/hooks/`, 44)
**Market/price** - useCodexData (master, 7 sub-hooks), useLivePrices (12s, visibility-gated), useWatchlistPrices, useTrendingTickers, useMarketIntel (slim/full modes), useMarketScenario, useSectorData, useStockData, useTokenFundamentals, useTokenProfile, useSpectreAssetData, useAssetStream.
**On-chain/forensics** - useOnchainData, usePairTrades, useLiveDumpForensics, useSignalEngine, useDossierProject.
**Wallet** - useWalletBalance (header), useWalletBalances (Multicall3 batch, 30s, visibility-gated).
**Social / X / mindshare** - useMindshareData, useTokenMentions, useDetectiveFeed, useXDashBootstrap, useXDashSurface, useXDashCreators, useXDashAuthor, useXDashToken, useXDashCategories, useXDashCategoryTokens, useXDashPrices, useXDashSearch.
**AI / brain / search** - useBrainChat, useBrainStream, useWhisperSearch (NL search; prod = graceful stub, see H), useChartVoiceControl.
**You** - useYouComposer, useYouTracking.
**Infra / UX** - useCurrency, useMediaQuery, useAdaptivePolling (polling helper - respects visibility), useNotificationPoller, usePullToRefresh, useSwipeNavigation, useTokenBrandColor.

### Serverless (`apps/research/api/`) - dev/prod parity
~30 top-level functions + ~45 handlers in `_lib/handlers/`. Many top-level files are **thin routers** dispatching to handlers by `?route=`: `market-api`, `intel-api`, `social-api`, `you-api`, `data-api`, `monarch-api`, `news-api`, `media-api`, `account-api`, `trade-api`. Standalone: `codex`, `cg-proxy`, `binance-ticker`, `img-proxy`, `stocks`, `token-resolve`, `swap` (handler), `fear-greed` (handler), `privy-webhook`, `cron/warm-cache`, `cron/warm-showcase`. Shared `_lib/`: `auth.js` (Privy JWT), `kv.js`, `ratelimit.js`, `safe-url.js`, `codex-guard.js`. **Rule: every Express route needs a matching function here or it breaks in prod** (`api-patterns.md` C).

---

## G. Conventions (quick refs, don't restate)

- **Imports**: `@/` alias for cross-dir, relative for siblings; CSS `@import` relative only.
- **Icons**: `spectreIcons` from `src/icons/` (50+ SVG) - never import an icon library.
- **Formatting**: `useCurrency()` bound `fmtPrice`/`fmtLarge` - never raw `formatPrice()`. Numbers in `var(--font-mono)` (resolves to system sans). website2 = Geist, no mono.
- **Analytics**: `@/services/analytics` wrapper only, `Events.*` constants.
- **Auth**: `AuthGate` = team password (sessionStorage, dev-bypassed) - NOT Privy. Privy = wallet/identity, optional.
- **CSS**: paired `.css` + `.day-mode.css` + `.mobile.css` per component; every dark style needs an `.app.app-day-mode` counterpart.
- Full rules: `coding-standards.md`, `design-system.md`, `page-patterns.md`.

---

## H. Footguns & hotspots

### Footguns
| Issue | Detail |
|-------|--------|
| **Whisper NL search is dev-only** | `/api/search/whisper`: dev Express does real Groq+Spectre NL parsing; the prod serverless handler is an intentional stub returning `{ fallback:true, results:[] }`. NL "whisper mode" returns empty in prod (no crash); regular token search works. Barely used + Tier-3 auth-gated. To make it work in prod, port `routes/search.js` into `search-api.js` route=whisper + add the LLM key to Vercel env. |
| **`fearGreedApi` throws** | Only service that throws instead of returning null/`[]`. Callers MUST try/catch. |
| **Binance IP-block in prod** | Vercel IPs blocked; `binance-ticker.js` does triple fallback (direct -> allorigins.win -> per-symbol). Frontend `binanceApi` does NOT - relies on the function. |
| **Settings two-source-of-truth** | Trading app mutates `spectre-settings` localStorage directly (referral, chart prefs), bypassing Zustand. Don't add more raw localStorage writes. |
| **Showcase history patch** | Module-load monkey-patch of `history.pushState/replaceState` + `EmbedGuard` + `ShowcaseLockSentinel`. Debug embed/redirect issues here first (`App.jsx` L20-152). |
| **Zustand selector** | Destructuring the whole store re-renders on any change - always inline selectors. |
| **Spectre backend toggle** | `USE_SPECTRE_API` in `spectreDataApi.js` routes hooks to the Hetzner bridge vs legacy Codex/CG/Binance. Flip if bridge data looks wrong. |
| **Stale sibling docs** | `data-sources.md` "4 serverless functions" and the page counts in both `CLAUDE.md`s + `page-patterns.md` are wrong. Trust this file + `App.jsx`. |

### Hotspots (most complex / most likely to need work)
`you` (128 files, grid+widgets) · `traders-corner` (terminal-grade, derivatives, TV embed) · `home` (entry point, market-mode + demo branching) · `intelligence` (multi-section adaptive polling) · `research-zone` (multi-panel chart sync) · `token` (cross-app iframe postMessage) · `world` / `x-intelligence` / `x-bubbles` (WebGL + force graphs) · `x-dash` (12 hooks, 7 sub-routes).

Charts are their own deep audit - see `.claude/rules/charts-system.md`.

---

## I. Cross-references (hub)
- `apps/research/.claude/rules/page-patterns.md` - folder-per-page, imports, new-page checklist
- `apps/research/.claude/rules/git-workflow.md` - branch flow (session -> engineering -> main)
- `.claude/rules/api-patterns.md` - services, caching, dev/prod routing, serverless patterns
- `.claude/rules/data-sources.md` - external APIs, keys, token pipeline, formatting
- `.claude/rules/design-system.md` - tokens, glass, day mode, fonts, instant-fails
- `.claude/rules/coding-standards.md` - language, structure, hook/component patterns
- `.claude/rules/charts-system.md` - chart inventory + upgrade plan
- `.claude/rules/privy.md` - auth/wallet (login modal v1, gotchas) · `.claude/rules/solana-web3.md` - chains, swaps
- `.claude/rules/responsive-rollout-plan.md` - mobile rollout (page list there is stale; use section D here)

## J. Maintenance
Update when: a page is added/removed (add/remove a row in D + adjust the header count), a route changes shell tier (B), a new service/hook lands (F), or a new footgun is found (H). Keep rows one-line - this file auto-loads on every `apps/research/**` task, so terseness = lower context cost.
