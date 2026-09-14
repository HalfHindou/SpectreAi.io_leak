---
paths:
  - "apps/*/vite.config.js"
  - "apps/*/src/components/**"
  - "apps/*/src/contexts/**"
  - "apps/*/src/**/*.css"
---

# Performance & Smoothness Plan

**Created:** 2026-06-11
**Status:** AUDIT COMPLETE — execution pending
**Owner:** Evgeniy
**Scope:** Make the research + trading apps load lighter and feel smoother (scroll/navigation at 60fps).

---

## A. Measured Baseline — CORRECTED 2026-06-11

> ⚠️ The first baseline below was measured against a **stale Jun 10 dist built
> BEFORE commit `731bb493` ("take three/recharts/d3 off the boot critical
> path")**. That commit is the B1 fix — it already shipped. The stale numbers
> overstated the problem. Real current numbers follow.

**STALE (pre-731bb493, do not use):** entry 839 KB gz + vendor-three 250 + vendor-recharts 115 + react 57 + ... ≈ **1320 KB gzip boot**. This is what the old dist preloaded. No longer true.

**ACTUAL current boot path (fresh build, gzipped):**

| Boot chunk | gzip | Note |
|-----------|------|------|
| `index-*.js` (entry) | **204 KB** | app shell + boot code |
| `vendor-react` | 61 KB | |
| `vendor-i18n` | 19 KB | |
| `vendor-zustand` | 3 KB | |
| `chunk-helpers` | 1 KB | |
| **TOTAL boot JS** | **~288 KB gzip** | three/recharts/d3 are NOT preloaded |

A `scripts/check-critical-path.mjs` guard now FAILS the build if a heavy vendor
chunk lands on the boot path — so B1 stays fixed permanently. **The research
boot path is already lean.** There is no 1 MB bundle problem to chase anymore.

Trading app: `main` entry **1.1 MB raw**, `core` **760 KB raw** (web3/reown unsplit) — this app has NOT had the equivalent fix, so B2/B3 below are still valid.

**Conclusion:** the remaining research wins are RUNTIME SMOOTHNESS (scroll, re-renders, background GPU), not boot weight. Boot weight is solved.

---

## B. Expected Result After Fixes (corrected)

Research **boot weight is already solved** (B1 shipped). The realistic wins from
this plan are runtime smoothness + a small entry trim + the trading app.

| Metric | Before | After | Source |
|--------|--------|-------|--------|
| Research boot JS (gzip) | ~288 KB | ~270–280 KB | A6 codex leaf-import trims the entry slightly; not the headline |
| Scroll smoothness (every page) | janky — fixed full-viewport `blur(40px)` re-painted per frame | smooth | A1 header blur 40→18px — **the felt win** |
| 60s forced shell re-render | yes | gone | A2 market-status equality guard |
| Background-tab GPU burn | 2 always-on rAF loops (token-storybook, AmbientGlow) | gone | A3 + A4 visibility guards |
| ParticleBackground re-renders | on every shell render (toast/poll/tick) | renders once | A9 memo |
| Boot API requests | 5-call derivatives `Promise.all` on first paint | deferred to idle | A7 |
| Trading discover/welcome boot | 1.1 MB entry raw | ~600–650 KB | B2 lazy token panels (not yet done) |

**Honest framing:**
- The big bundle win (three/recharts off boot, ~365 KB gz) was **already done by the team** in `731bb493`. My earlier "−35% boot" estimate was based on a stale build — it does not apply.
- What Batch A actually delivers is **felt smoothness**: scroll on every page, no periodic shell re-renders, no background GPU burn. Users feel this; it does not show up as KB.
- The remaining measurable boot win is in the **trading app** (B2/B3), which never got the research app's chunk fix.

---

## C. Batch A — Low-Risk, High-Impact (do first)

No chunk-config changes. Safe to ship together. Build + browser-verify after.

### A1. Header blur 40px → 18px  `[S effort, every-page scroll win]`
- **File:** `apps/research/src/components/header.css:37`
- **Now:** `.header { position: fixed; backdrop-filter: blur(40px) saturate(150%) }` — a 74px full-width fixed bar re-blurs the whole viewport behind it on every scroll frame, on every page. #1 scroll-jank source.
- **Fix:** change `blur(40px)` → `blur(18px)`, keep `saturate(150%)`. The 0.85 bg alpha already carries the look; perceptual diff above ~20px is negligible.
- **Also check:** `header.css:1874`, `header.css:3972` (dropdown/panel blurs) — reduce to ≤24px.
- **Verify:** scroll any data-dense page (discover), confirm no visual regression on the bar.

### A2. `useUsMarketStatus` — stop the 60s forced shell re-render  `[S]`
- **File:** `apps/research/src/pages/home/components/use-us-market-status.js:85`
- **Now:** `getStatus()` on a 60s poll unconditionally calls `setUsMarketStatus({...new object})` even when nothing changed → AppShell (called at `app-shell.jsx:102`) re-renders every minute.
- **Fix:** bail when unchanged:
  ```js
  setUsMarketStatus(prev =>
    (prev && prev.isOpen === next.isOpen && prev.label === next.label && prev.countdown === next.countdown)
      ? prev : next)
  ```
- **Verify:** React DevTools Profiler — AppShell no longer re-renders on the 60s tick.

### A3. Visibility guard on `token-storybook` rAF  `[M]`
- **File:** `apps/research/src/components/token-storybook.jsx:343` (`draw()`), kickoff `:451`
- **Now:** never-stopping rAF that `fillRect`s the whole canvas + allocates a fresh `createRadialGradient` **every frame**, no `document.hidden` / off-screen guard.
- **Fix:** (1) early-return + re-arm on `visibilitychange` when `document.hidden` (mirror `bubbles-page.jsx:1322`); (2) IntersectionObserver to pause when scrolled out of view; (3) hoist the radial gradient out of the loop — recompute only when `sp`-dependent inputs change.
- **Verify:** background the tab, confirm the loop stops (add a temp `console.count` in `draw`, remove after).

### A4. Visibility guard on `AmbientGlow` rAF  `[S]`
- **File:** `apps/research/src/pages/x-intelligence/components/AmbientGlow.jsx:88` (`draw()`), `running` flips false only on unmount at `:144`
- **Fix:** top of `draw()`: `if (document.hidden) { requestAnimationFrame(draw); return }` — or stop and restart on `visibilitychange`.

### A5. Lazy-load `en.json` out of the entry chunk  `[S–M, ~70 KB gz off boot]`
- **File:** `apps/research/src/i18n/index.js:6` — `import en from '@/i18n/locales/en.json'` (static → baked into entry).
- **Fix:** init i18n with an empty `en` bundle, then `await import('@/i18n/locales/en.json')` on the idle tick and `addResourceBundle('en', ...)` — same pattern the other 19 locales already use (`loadLocale`). Keys fall back to inline defaults during the brief load tick.
- **Risk:** medium — touches i18n boot. Verify English text renders immediately (no flash of keys). If a flash appears, keep `en` eager and instead split only the long-form/rarely-used half of `en.json` into a deferred namespace.
- **Verify:** `grep` the new entry chunk for a distinctive en.json string — should be gone; an `en-*.js` chunk should exist.

### A6. Header: import codex hook from leaf, not the barrel  `[S, ~60–90 KB raw off boot]`
- **File:** `apps/research/src/components/header.jsx:15` — `import { useTokenSearch } from '@/hooks/useCodexData'`
- **Now:** `useCodexData.js:24-34` is a barrel that static-imports all 11 codex hooks; the always-mounted header drags them all onto boot.
- **Fix:** import from the leaf: `import { useTokenSearch } from '@/hooks/codex/useTokenSearch'` (verify exact leaf path). Audit other boot-path importers of `@/hooks/useCodexData` and repoint. Consider deleting the barrel's default export (the thing defeating tree-shaking).
- **Verify:** build, confirm `useChartData`/`useFullTokenData` strings no longer appear in the entry chunk.

### A7. Defer the home derivatives boot calls  `[S, −5 boot requests]`
- **File:** `apps/research/src/pages/home/components/use-market-intelligence.js:199-205`
- **Now:** default `brief` tab flips `_derivTabActive` true on mount → `fetchDerivSnap` fires 5 parallel heavy calls (total-oi, total-liquidations, funding-rates, open-interest?limit=500, liquidation-windows) that feed below-the-fold widgets.
- **Fix:** gate `fetchDerivSnap` behind `requestIdleCallback` (fallback `setTimeout`) or first interaction with the brief tab.

### A8. Boot `useMarketIntel` in `slim` mode  `[S, −6 boot requests combined with A7]`
- **File:** `apps/research/src/hooks/useMarketIntel.js:397, 466`
- **Now:** boots in `full` (7 upstream calls) when only the dominance/funding bar shows above the fold; `slim` covers that.
- **Fix:** boot in `slim`, upgrade to `full` after first paint (idle tick / on brief-tab interaction).

### A9. `React.memo` the shell chrome  `[M]`
- **File:** `apps/research/src/components/layouts/app-shell.jsx` (Header `:?`, NavigationSidebar `:360`, ParticleBackground)
- **Now:** AppShell rebuilds its full inline `appContent` (`:352-591`) on any of ~12 selectors / 5 contexts / toast / notification poll — re-rendering Header + Sidebar + ParticleBackground even when their props didn't change.
- **Fix:** wrap `NavigationSidebar`, `Header`, `ParticleBackground` in `React.memo`; wrap the inline `onPageChange` arrow (`:360`) and bottom-nav callbacks in `useCallback` so memo actually holds. ParticleBackground is self-driving via rAF → with no props it should render exactly once.
- **Verify:** Profiler — a toast/notification tick no longer re-renders sidebar/header/canvas.

### A10. Pass `sparkline=false` for non-sparkline consumers  `[S–M, 4–5× smaller payload]`
- **File:** `apps/research/src/services/coinGeckoApi.js:203, 223`
- **Now:** page-1 fast path hardcodes `sparkline=true` (~412 KB). Consumers `YouHeatmap`, `pulse-sidebar`, `YouTopCoins` discard the sparkline arrays.
- **Fix:** expose a `sparkline` arg, pass `false` for those consumers (or route them through the existing `{sparkline:false}` ~86 KB path).

---

## D. Batch B — Bundle Chunking (high win, needs careful browser verify)

⚠️ **The `manualChunks` Buffer-eval-order landmine** (documented at `apps/research/vite.config.js:~190` and `apps/trading/vite.config.js:95-115`) can cause a blank black page. Every chunk change here MUST be verified in a real browser, not just a headless build. Do these one at a time.

### B1. ✅ ALREADY DONE — three+recharts off the boot path
- **Shipped in `731bb493`** ("take three/recharts/d3 off the boot critical path - chunk graph fix"). The fresh build no longer preloads vendor-three / vendor-recharts, and `scripts/check-critical-path.mjs` now fails the build if they ever come back. No action needed.
- _Historical note (for reference only):_
- **File:** `apps/research/vite.config.js` `manualChunks`
- **Problem:** the entry statically imports `vendor-three` (250 KB gz) and `vendor-recharts` (115 KB gz) to reach a small shared module Rollup trapped inside them. No boot-path source file imports three/recharts.
- **Step 1:** build once with `rollup-plugin-visualizer` (or `npx vite-bundle-visualizer`) to name the exact trapped module — likely d3-shape/d3-scale primitives (`stack`, `scaleBand`, `scaleLinear`, `interpolate`) leaking through recharts.
- **Step 2:** route those primitives to the existing `vendor-d3` chunk (rule already exists at `vite.config.js:~246`), or pin the specific shared package to its own tiny chunk like the existing `vendor-shared` case.
- **Step 3:** rebuild, confirm `index.html` no longer emits `modulepreload` for `vendor-three`/`vendor-recharts`, and the entry chunk no longer `import`s from them.
- **Verify in browser:** load home, `/world`, and a chart page — no blank page, charts + globe still render.

### B2. Trading: lazy the token-view panels  `[M, ~500 KB raw off discover/welcome boot]`
- **File:** `apps/trading/src/App.jsx:39-51`
- **Now:** `LeftPanel` (2031L), `RightPanel` (1470L), `DataTabs` (2142L), `TokenBanner` (840L) are eager though `discover` is the default view (`App.jsx:222`).
- **Fix:** `React.lazy` the panels behind `currentView === 'token'`; prefetch on idle / first hover of a token row (existing `prefetch.js` pattern) to keep token-switch instant.
- **Verify:** token switch latency stays low; discover/welcome boot drops.

### B3. Trading: split web3/reown out of `core`  `[M]`
- **File:** `apps/trading/vite.config.js:108-121` `manualChunks`
- **Now:** ethers, `@solana/web3.js`, `@reown/appkit*` all fall into `core` (760 KB).
- **Fix:** split them into a lazy wallet chunk that loads with `RightPanel`/swap UI — **respecting** the Buffer contract (keep them with their lazy consumer, NOT as a boot sibling that evaluates before the polyfill).
- **Verify:** wallet connect + swap still work; no blank page on boot.

---

## E. Batch C — Render Depth (medium, optional polish)

### C1. Split `location.pathname` out of MonarchContext value  `[M]`
- **File:** `apps/research/src/contexts/MonarchContext.jsx:355-359, 664-681`
- **Now:** `currentContext` (depends on `location.pathname`) is part of the provider value → every navigation produces a new Monarch value → AppShell + all `useMonarch` consumers re-render on every route change.
- **Fix:** move `currentContext` into a separate `MonarchPageContext` consumed only by the chat page/mini-chat, or drop pathname from the value and have the chat read `useLocation()` itself.

### C2. Stable callbacks on token cards  `[S–M]`
- **File:** `apps/research/src/pages/discover/components/discover-page.jsx:313, 408, 478` (pattern repeats on home rows)
- **Now:** `React.memo` cards receive inline `onClick={() => onClick?.(token)}` → memo is a no-op, all cards re-render on every price tick.
- **Fix:** card takes `token` + stable `onSelect`, calls `onSelect(token)` internally; pass a `useCallback`-stable handler from the parent.

### C3. Trading: `TokenTicker` rAF visibility guard  `[S]`
- **File:** `apps/trading/src/components/TokenTicker.jsx:208-234`
- **Now:** marquee rAF writes `style.transform` every frame for the life of the token page; checks hover pause but not `document.hidden`.
- **Fix:** skip the transform write + `lastTime` advance when `document.hidden`; optionally pause via existing `useInViewport`.

### C4. Trading: delete dead chart + three code  `[S]`
- **Files:** `apps/trading/src/components/TradingChart.jsx:1060-1341` (commented-out legacy LW-charts candle init + the now-unreachable `candleSeriesRef`/`volumeSeriesRef`/`vwapSeriesRef` live-update effects at `:1563-1620`); `apps/trading/src/components/AIAssistant.jsx` + `CursorTrail.jsx` (never mounted, import the whole three.js stack — a future boot-trap).
- **Fix:** delete; drop `three`/`@react-three/fiber`/`drei` from trading `package.json` if nothing else uses them. Grep-verify refs unused first.

### C5. Trading: remove the 200ms resize interval  `[S]`
- **File:** `apps/trading/src/components/TradingChart.jsx:2103-2105`
- **Now:** `setInterval(() => resizeChart(), 200)` reads `getBoundingClientRect()` (forced layout) 5×/s forever, redundant with the ResizeObserver + transitionend already present.
- **Fix:** remove the interval, or gate on `document.hidden` + only resize when dimensions actually changed.

---

## F. Execution Checklist

**Batch A (low-risk):**
- [x] A1 Header blur 40→18px (+ search-modal 40→24, profile-dropdown 40→20) — `header.css`
- [x] A2 useUsMarketStatus equality guard — `use-us-market-status.js`
- [x] A3 token-storybook rAF `document.hidden` guard — `token-storybook.jsx` (gradient hoist deferred, lower value)
- [x] A4 AmbientGlow rAF `document.hidden` guard — `AmbientGlow.jsx`
- [x] A6 header codex leaf-import — `header.jsx`
- [x] A7 defer derivatives boot calls to idle — `use-market-intelligence.js`
- [x] A9 React.memo ParticleBackground (`particle-background.jsx`) + NavigationSidebar with stable `handleSidebarNav` useCallback (`app-shell.jsx`, `navigation-sidebar.jsx`)
- [x] A5 en.json namespace split — `en.json` keeps shell/home/common (eager); 24 page-specific sections moved to `en-rest.json`, dynamic-imported in parallel at boot. **Entry 204→171 KB gz, boot 288→254 KB gz (−12%).** Page sections verified scoped to lazy routes (no shell/home flash). `ADDING_LANGUAGES.md` updated for the two-file reference.
- [x] A8 useMarketIntel slim boot — **DONE** (verified 2026-06-18). `useMarketIntel` has a `mode: 'slim' | 'full'` param; home boots `slim` and upgrades to `full` only when a derivatives tab opens (`use-market-intelligence.js:36` — `DERIVATIVES_TABS.includes(marketAiTab) ? 'full' : 'slim'`). Slim bundle skips the alpha-feed fetch + poll too. The "deferred" note was stale.
- [x] A10 sparkline=false — **WON'T DO** (verified net-negative). The page-1 cache feeds discover + pulse-sidebar, which DO render sparklines, so it must hold them. Only the 3 `You*` widgets discard sparklines, and `/you` is normally visited after home/discover where the cache is already warm — they reuse it for free. A separate `sparkline=false` path would remove that free reuse and add a 2nd fetch in the common journey. The real fix is cache unification (one shared store), not sparkline fragmentation.
- [x] Build `npm run build:research` — clean, `check-critical-path` OK
- [ ] Browser verify (scroll, navigate, profiler) — pending dev-server check

**Batch B:**
- [x] B1 three+recharts off boot — **already shipped in `731bb493`**
- [x] B2 (=H2) trading lazy token panels — `App.jsx`: `TokenTicker`/`LeftPanel`/`TokenBanner`/`DataTabs`/`RightPanel`/`MobileTokenPage` now `React.lazy`, wrapped in Suspense, prefetched on idle after first paint (`prefetchTokenPanels()`) so token-switch stays instant. **`main` 1,126→304 KB raw (346→88 KB gz, −258 KB gz off boot).** Panels moved to lazy chunks (RightPanel+wallet/ethers → its own chunk). index.html preloads verified clean (only main+react-vendor+privy-vendor). Build clean.
- [ ] B3 (=H3) trading split web3/reown — mostly falls out of H1 (lazy Privy); verify `core` not boot-loaded after.
- [ ] **H1 lazy-mount Privy in trading** — the BIG remaining win (~832 KB gz + core 216 KB still preloaded). 15-file/43-callsite migration to safe hooks (port research's `privy-boundary.jsx` + `use-privy-safe.jsx`). MUST be browser-verified (wallet connect, swap, Telegram login, /token iframe) — headless build insufficient. Own PR.

**Batch C (polish):**
- [x] C1 MonarchContext pathname split — `currentContext` moved to its own `MonarchPageContext` (`MonarchContext.jsx`), consumed by `monarch-mini-chat.jsx` + `monarch-chat-page.jsx` via `useMonarchPage()`. The main Monarch value no longer changes on navigation, so AppShell (`useMonarch` for chatOpen/toggleChat) stops re-rendering on every route change.
- [x] C2 token card stable callbacks — **WON'T DO** (already correct). The plan's premise (inline `onClick={() => onClick?.(token)}` defeats memo → cards re-render every tick) is wrong: that arrow is INTERNAL to the memo'd card, it doesn't affect memoization. Discover cards (`discover-page.jsx`) are `React.memo`'d and already receive `useCallback`-stable handler props (`handleTokenClick`/`handleAddToWatchlist`/`checkIsInWatchlist`, with `addToWatchlist`/`isInWatchlist` from WatchlistsContext also `useCallback`'d). Home rows (`mobile-token-row.jsx`) go further — `React.memo` with a VALUE-based custom comparator that ignores callback identity entirely. Cards re-render on price tick only because token DATA changed, which is required. No change needed.
- [x] C3 TokenTicker rAF guard — `document.hidden` folded into `paused` in the `animate` loop (`TokenTicker.jsx`); skips the `style.transform` write + advances `lastTime=0` when backgrounded, mirroring the hover-pause path. Resumes smoothly.
- [x] C4 delete dead trading three code — deleted `AIAssistant.jsx` (+ `.css`, sole three.js consumer) + `CursorTrail.jsx` (both verified fully unreferenced — no import/lazy/mount anywhere). Dropped `three` / `@react-three/fiber` / `@react-three/drei` from `apps/trading/package.json` (lockfile updated). **TradingChart.jsx portion N/A** — the plan's claim that lines 1060-1341/1563-1620 are commented-out/unreachable is STALE: those `candleSeriesRef`/`volumeSeriesRef`/`vwapSeriesRef` are LIVE (series created ~1209, WebSocket candle-update effect ~1561, main setData path ~1677). File was refactored since the plan was written. Left untouched.
- [x] C5 remove 200ms resize interval — removed the `setInterval(resizeChart, 200)` + its `clearInterval` (`TradingChart.jsx`). `resizeChart()` already guards on dimension change (only `chart.resize()` when w/h differ), but the interval still ran `getBoundingClientRect()` (forced layout) 5x/s forever. ResizeObserver + MutationObserver (class/style) + window-resize + transitionend already cover every resize trigger.
- [x] Build `npm run build:trading` + `npm run build:research` — both clean, `check-critical-path` OK

---

## G. What's Already Good (don't touch)

- All 50+ pages are `React.lazy`; 19 non-English locales code-split.
- Polling hooks: **100% visibility-guard coverage** (`useAdaptivePolling` + `createPollingStore`).
- Wallet stack (`core`, 744 KB) correctly lazy via PrivyBoundary.
- Inflight dedup on hot endpoints (coinGecko, fearGreed, spectreMarket).
- localStorage instant-paint seeds on prices/top-coins.
- `SpectreSparkline` draws once (not in a loop); `rz-kol-bubbles` settle-and-stop; `GraphCanvas`/`particle-background`/`bubbles-page` already gate on `document.hidden`.
- three.js fully tree-shaken from the trading prod bundle.

---

## H. Audit Round 2 — 2026-06-11 (post Batch A/C)

Fresh 4-axis audit (bundle, research runtime, trading runtime, data/network), grounded in measured builds + read code. Batch A + C are shipped; this captures what they MISSED. Ordered by impact/effort. **The headline: the trading app never got research's lazy-Privy fix, and that one change dwarfs everything else.**

### Measured baseline (fresh build)

| App | Boot (gzip) | Status |
|-----|------------|--------|
| Research | **~254 KB** (entry 176 + react 62 + i18n 19 + zustand/helpers) | solved — fenced by `check-critical-path.mjs` |
| Trading | **~1.44 MB** (privy-vendor 832 + main 346 + react 46, then core 216 pulled immediately) | **heavy — main target** |

Research boot is genuinely done. Trading boots ~1.44 MB gzip of wallet code before the default `#discover` view, which needs none of it.

### TIER 1 — Trading bundle (biggest wins, do first)

**H1. Lazy-mount Privy in trading — port research's `PrivyBoundary`  `[M, ~832 KB gz off boot + defers core 216 KB → trading boot ~1.44MB→~400KB gz]`**
- **File:** `apps/trading/src/main.jsx:10` eager-imports `PrivyProvider`, so `privy-vendor` (832 KB gz) is `modulepreload`ed and pulls `core` (216 KB gz) immediately — ~1 MB gz of wallet code before first paint.
- **Fix exists in research:** `apps/research/src/lib/privy-boundary.jsx` + `lib/use-privy-safe.jsx` lazy-mount the real provider after first paint (idle / login click / auth-gate), app runs on a safe stub meanwhile. Port it.
- **Risk:** M — preserve the Buffer-eval-order contract (polyfill first; boundary mounts after). Browser-verify wallet connect + swap, no blank page. **This is the single highest-value change in the repo.** Supersedes/subsumes much of old B2/B3.

**H2. (was B2) Lazy the token-view panels  `[M, main 1.13MB→~600KB raw, ethers off boot]`**
- **File:** `apps/trading/src/App.jsx:40,49,50,51` — `LeftPanel`/`DataTabs`/`TokenBanner`/`RightPanel` are static though default view is `#discover` (render branch `:1097`, token branch `:1102`). Only `TradingChart` is lazy. `RightPanel`→`walletService`→eager `ethers` is why `main` carries it.
- **Fix:** `React.lazy` all four behind the existing token-view `Suspense`; prefetch on idle / first token-row hover (existing prefetch pattern, `App.jsx:17`).

**H3. (was B3) Confirm `core` (web3/reown) no longer boot-loads after H1  `[S verify]`**
- **File:** `apps/trading/vite.config.js:108-121`. After H1, `core` should only load with wallet UI. Verify it's not transitively preloaded; respect the Buffer landmine (`vite.config.js:95-115`).

### TIER 2 — Felt scroll/hover jank (real data pages)

**H4. Heatmaps re-sorts the full token list on every price tick + inline row handlers  `[M, felt hover/scroll stutter]`**
- **Files:** `pages/heatmaps/components/heatmaps-page.jsx:858-888` (chart view — map+sort+reduce in render closure, driven by live `binancePrices`, 4 inline arrow handlers + inline style per row), `:926-959` (dual view filter+sort), `:740,790-793` (grid tiles, inline handlers). The d3 `TreemapView.jsx` path IS memo'd (fine).
- **Fix:** precompute sorted data in `useMemo` keyed on a stable price snapshot; extract `React.memo` rows with stable callbacks.

**H5. Trading custom-canvas crosshair: 3 setState + forced layout read per mousemove  `[M, worst trading interaction]`**
- **File:** `apps/trading/src/components/TradingChart.jsx:3191` (handler), wired `:4915`. Unthrottled mousemove → `getBoundingClientRect()` (reflow) + `Math.max(...map())` alloc + up to 3 `setState`, each reconciling the 4,942-line component. (Default custom-canvas chart, `!showTradingView`.)
- **Fix:** rAF-throttle; cache `rect` (update on resize/scroll); precompute `maxVolume` into a ref; coalesce the 3 setStates into one.

**H6. Trading discovery-table sticky toolbar `backdrop-filter: blur(32px)`  `[S, scroll jank — same class as A1]`**
- **File:** `apps/trading/src/components/TokenDiscoveryTable.css:105`. Sticky bar re-blurs the backdrop every scroll frame over a scrolling list.
- **Fix:** `blur(32px)` → `blur(18px)`; the `rgba(9,9,11,0.92)` bg already carries the look.

### TIER 3 — Data / network (fewer requests, faster data-ready)

**H7. Adopt `useSharedTopCoins` — collapse 8 independent top-250 fetches into one  `[M, headline network win]`**
- **Where:** `services/prices/sharedTopCoinsStore.js` (built, visibility-aware, localStorage-seeded) is used ONLY by the dev audit panel. 8 real surfaces still call `getTopCoinsMarketsPage(1, 250)` independently (`discover-page.jsx`, `use-heatmap-data.js`, `use-top-section-data.js`, `pulse-sidebar.jsx`, `use-research-zone-data.js`, `YouDiscovery/YouHeatmap/YouTopCoins.jsx`). home→discover→you = 3× 412 KB fetches on cache miss → 1.
- **Fix:** replace calls with `useSharedTopCoins()` + client `.slice(0,N)`, one page at a time, verify via `/dev/spectre-audit`. Unlocks H8.

**H8. `getSpectreMarketTickers` re-fetches top-200 every 90s inside the intel bundle  `[M, after H7]`** — `spectreMarketApi.js:889-893`; feed from the shared store cache instead.

**H9. `fetchExchangeRates()` fires for every user incl. USD default  `[S, removes 1 boot req + timer for most users]`**
- **File:** `contexts/I18nCurrencyContext.jsx:27-38` — gate on `currency !== 'USD'` (USD rate is always 1).

**H10. Binance 30s batch overlaps the SSE price stream  `[M, needs SSE-detection — coordinate w/ Blocky]`** — `use-market-prices.js:24-30`; batch only `allBinanceSymbols − sseSymbols` when SSE connected.

**H11. `open-interest?limit=500` payload oversized for home AI panel  `[S frontend / needs backend param — coordinate w/ Backy]`** — `spectreMarketApi.js:273,683`; home reads only `meta.total_oi_usd` + BTC/ETH. Needs a `?meta_only`/`limit=50` backend variant (rows are iterated by funding/LSR fallback, can't blindly shrink).

### TIER 4 — Background GPU + unguarded timers (quick consistency cleanup)

**H12. rAF loops missing `document.hidden` guard  `[S each]`** — `pages/pulse/components/connection-protocol.jsx:458` (force-graph, never stops — highest reach), `you/studio/stickers/media/AudioVisualizer.jsx:66`, `components/spectre-runner-game.jsx:690`, trading `TradingChart.jsx:558` (bubble-physics, drag-gated). Mirror the `bubbles-page.jsx:1322` pattern.

**H13. Polls without `document.hidden` guard  `[S each]`** — Trading: `LeftPanel.jsx:194`, `RightPanel.jsx:387`, `BrainSays.jsx:58`, `DossierFeed.jsx:59`, `SpectreSocial.jsx:415`, `DossierStory.jsx:58` (all 30s, older code; add `if (document.hidden || !isAppActive()) return`). Research: `components/freshness-tag.jsx:70` (30s, multi-instance — pure render, most-instantiated), `hooks/codex/useChartData.js:717` + `useRealtimePrice.js:89` + `useLatestTrades.js:161` (network).

**H14. Runaway 2s QR poll, no max timeout  `[S, safety — same class as the Privy loop]`** — `pages/admin-tg-onboard/index.jsx:66`; add a 5min cap + clear on success.

### TIER 5 — List memoization (growth-path hygiene; no virtualization lib installed)

**H15.** News `NewsCard` not memo'd + holds `prices` on a 60s poll → re-renders all cards each poll (`pages/news/components/NewsPage.jsx:593,770`); memo it + lift `prices`.
**H16.** Calendar `HistoryTable.jsx:73` sorts in render body (wrap in `useMemo`); `EventRow` (`DayView.jsx:189`/`EventRow.jsx:301`) not memo'd.
**H17.** `CopyToastContext.jsx:24` value is an inline object (9 page consumers) — `useMemo` it. Low frequency.

### Status (research pass, 2026-06-11)
- [x] **H4** heatmaps hover storm — rAF-throttle the tooltip-follow `setHoverPos` (`heatmaps-page.jsx`): moving the cursor inside a tile fired a full-page re-render per mousemove; now coalesced to ≤1/frame. (Full row-component extraction skipped — higher regression risk, and the 10s price tick re-render is tolerable.)
- [x] **H9** I18nCurrency — skip the exchange-rate fetch + 15-min timer for USD users (the default); re-runs when currency changes. (`I18nCurrencyContext.jsx`)
- [x] **H12** Pulse `connection-protocol.jsx` force-graph rAF — `document.hidden` early-return + re-arm.
- [x] **H13** `freshness-tag.jsx` — guard the 30s tick on `document.hidden` (multi-instance: was re-rendering dozens of cards on a backgrounded tab).
- [x] **H17** `CopyToastContext` value — `useMemo` (was recreated each render → cascaded to 9 page consumers).
- [x] **H15** News `NewsCard` — `React.memo` so the page-level 60s prices/fear-greed polls don't re-render every article card.
- [x] **H16** Economic calendar — `HistoryTable` sort wrapped in `useMemo([history])` (was re-sorting unbounded history every render); `EventRow` wrapped in `React.memo` (day view renders many rows; live status ticks / focus changes no longer re-render every row — props are stable per row, `handleEventToggle` is `useCallback`'d).
- [x] **H18** Economic calendar `.ec-panel__bar` — `backdrop-filter: blur(20px)→12px`. The bar is `position:sticky` over the dense scrollable calendar body, so the backdrop re-composited every scroll frame (same class as the header A1). 12px keeps the frosted glass (translucent gradient bg + saturate carry it). `economic-calendar-page.css`.
- **Round-2 deep sweep finding (2026-06-11):** a very-thorough read-only investigation of research found the app otherwise well-optimized — heavy compute is already in useMemo/useCallback, effect deps are stable, large lists on the big pages (you/traders-corner/intelligence) are memoized or virtualized, localStorage parsing is in useState initializers. H18 was the only genuine new dip. Remaining known dips are all TRADING: H6 (TokenDiscoveryTable sticky `blur(32px)` over scroll), H1 (lazy Privy), H2-done.
- **H7 cache unification — WON'T DO.** `getTopCoinsMarketsPage` is ALREADY backed by the Spectre store cache + inflight dedup (`allCoinsCache`/`_singlePageCache`/`_page1SpectreInflight` in `coinGeckoApi.js`) AND has a direct-CG fallback for the 30D/1Y columns that the raw `sharedTopCoinsStore` strips. Swapping consumers to the raw store = marginal benefit (service layer already dedupes within TTL) + a real regression (missing 30D/1Y columns). The audit overstated this — the existing path is better.
- **H13 codex price polls — already guarded** (audit was stale): `useChartData.js:719`, `useRealtimePrice.js:36`, `useLatestTrades.js:163` all already gate on `document.hidden`/`isAppActive()`.
- [x] Build `npm run build:research` — clean, `check-critical-path` OK.

### Status (trading + cross-app pass, 2026-06-12)
- [x] **H6** TokenDiscoveryTable sticky toolbar `backdrop-filter: blur(32px)→18px` (`TokenDiscoveryTable.css:105`). Sticky bar over the scrolling discovery list re-composited the backdrop every scroll frame (same class as A1/H18); `rgba(9,9,11,0.92)` bg + saturate carry the frosted look.
- [x] **H12** rAF `document.hidden` guards added (re-arm + skip work while backgrounded): `AudioVisualizer.jsx` (48 SVG attr writes/frame — sticker studio), `spectre-runner-game.jsx` (freeze physics + repaint — easter-egg game), trading `TradingChart.jsx` bubble-physics `simulate` (skips the `setBubblePhysics` setState loop). Low-reach surfaces, but now consistent with A3/A4. Note: browsers already throttle/pause rAF on hidden tabs, so this is belt-and-suspenders for the throttled-not-stopped case.
- [x] **H13** Trading 30s polls without visibility guard — wrapped the interval callback in `if (document.hidden || !isAppActive()) return` (mirrors RightPanel, which already had it): `LeftPanel.jsx` (brain-logs), `BrainSays.jsx`, `DossierFeed.jsx`, `SpectreSocial.jsx`, `DossierStory.jsx`. Initial `load()` still fires on mount; only background/idle polls skip. `isAppActive` imported from `../lib/idleManager` in each.
- [x] **H14** admin-tg-onboard QR poll — added a 5-min hard deadline (`pollDeadlineRef`); if the server keeps returning `waiting` forever the 2s poll now self-terminates with "QR timed out" instead of running indefinitely on a forgotten tab.
- [x] Build `npm run build:trading` + `npm run build:research` — both clean, `check-critical-path` OK.
- **Remaining from H-audit:** H1 (lazy Privy in trading — the big one, own PR, browser-verify), H3 (verify `core` deferred, falls out of H1), H5 (trading canvas crosshair throttle), H8/H10/H11 (need backend/SSE coordination).

### Status (GPU-heat pass, 2026-07-07)
- [x] **ParticleBackground GPU heat** — user report "Mac heats up on prod". Live profiling (prod + localhost, identical baseline): main thread idle (0 long tasks), but the full-viewport particle canvas (3600×1824 retina buffer) redrew ~26-30fps UNDER 29-48 `backdrop-filter` elements — every redraw forces the GPU to re-upload the 6.5MP texture and re-filter every blurred surface above it. Fix (`particle-background.jsx`): buffer dpr 2→1 (4× fewer pixels; invisible for a soft glow field at opacity 0.8), 30fps→20fps with `MOTION_SCALE` keeping the drift pace, and full stop on 5-min idle via `subscribeActivity`/`isAppActive`. Browser-verified: buffer 1800×912, ~19fps effective, no visual regression, no console errors. Prod-only heat amplifiers on top of this shared baseline: PostHog session replay serializing ~120 DOM mutations/s (consider sampling — product decision, Sunny/Gleb) + the /data-api 502-retry spam (fixed same day: failure cooldown + stale-on-error in `spectreMarketApi.js`, edge TTL prices/search → 30s in `extended-proxy.js`).

### Status (welcome ticker CPU pass, 2026-07-08)
- [x] **TokenTicker main-thread storm** — user report "CPU 82% on welcome". CDP-measured attribution: the ticker was ~85% of renderer main-thread (756 ms/s baseline → 111 hidden). Three fixes in `token-ticker.css`/`.jsx`:
  1. **114 infinite per-item CSS animations removed** — 38× `dotPulse` animated SVG `r` (a LAYOUT per frame, 109 layouts/sec page-wide), 38× `arrowBounce`, 38× `livePulse`; plus `drop-shadow` on 38 sparkline paths and `backdrop-filter: blur(12px)` on top-gainer chips INSIDE the moving track. Static equivalents keep the look.
  2. **Marquee rAF → Web Animations API** — the rAF wrote `style.transform` per frame; each inline write forced a ~2ms style recalc over the ~800-node track subtree (~230 ms/s, 117 style mutations/sec — found via MutationObserver, NOT via the CSS-animation theory). `element.animate()` runs the transform on the compositor: 0 mutations/sec, position lives in `currentTime`, width changes rebuild preserving progress.
  3. **Pause coverage** — hover (React state → `anim.pause()`), offscreen (IntersectionObserver), hidden tab (visibilitychange), 5-min idle (`subscribeActivity`).
- **Measured after: 756 → 197 ms/s main thread (−74%), recalc 255→21 ms/s, layouts 109→5/sec.** Browser-verified: marquee scrolls, hover pauses/resumes, 40 items render, visuals unchanged.
- **Measurement trap for future audits:** dispatching a synthetic `mouseenter` does NOT trigger React `onMouseEnter` (React synthesizes enter/leave from mouseover/mouseout) — a "paused" A/B arm silently didn't pause; use real `page.mouse.move` instead.

### Status (trading search / chart / logos pass, 2026-07-22)
User report: "search bar, charts and logos load slow in trading app". Measured on dev (`localhost:3001`/`:5181`) + prod static. Data endpoints were NOT the problem — `/api/bars` is 0.6-1.1s cold / 0.15-0.25s warm.
- [x] **Search fast-tier budget was silently 3x its declared value.** `useTokenSearch`'s leading-edge tier calls the server with a 500ms Hetzner budget, but `_spectreSearchHetznerDev` (dev `packages/server/index.js`) and `_fetchSpectreSearch` (prod `apps/trading/api/codex.js`) both nested a price backfill that started its OWN fresh 900ms clock — so every cold `fast=1` search cost a suspiciously constant **~1.405s**, i.e. SLOWER than the settled tier it exists to beat (~1.1s). Both now pass the *remaining* budget to the backfill, and the dev fast branch has one wall-clock ceiling (`FAST_TIER_BUDGET_MS = 900`) covering the registry-fallback path too. Measured after restart: **1.405s constant → 0.50-0.91s** (0.50s = registry miss, no backfill; 0.91s = budget ceiling). Settled tier unchanged and still 15/15 rows priced — no `$0.00` regression (PR #1328 class). Note both upstream legs (`/v1/search`, `/v1/prices`) were TIMING OUT during the measurement — the documented Hetzner stall — so these are worst-case numbers; a healthy box lands far under the ceiling.
- [x] **Chart: the 4.4MB TradingView bundle was only warmed on deep links.** `charting_library.js` in `index.html` is a 28KB loader; the real chart is `/charting_library/bundles/library.<hash>.js` (**4.4MB raw / 800KB gzip / brotli in prod**) and the loader doesn't request it until `new TradingView.widget()`. TV Advanced is the DEFAULT engine (`TradingChart.jsx:184`, every viewport), so anyone landing on `#discover` and clicking a token paid that download cold, at click time — the existing `fetchpriority=high` preload only fired for `#token/` URLs. Added an idle, low-priority `rel=prefetch` for the main bundle on non-deep-link loads (deep links still go high-priority immediately). The hash is read out of the loader source at runtime, so a TradingView version bump can't strand a stale filename. Gated on `saveData` and, off-localhost, on `spectre-auth` so someone stuck at the password gate doesn't eat 4.4MB. Browser-verified: `link[rel=prefetch]` present with the correct hash, 4310KB fetched at idle.
- [x] **Logos: no lazy loading.** Token avatars come straight off `token-media.defined.fi` — raw S3, no CDN edge: **600-900ms TTFB each regardless of the 2-11KB payload** (some legacy URLs are worse — 88KB with NO `Cache-Control`, and `media.thegrid.id` serves a 131KB PNG into a 32px circle). `TokenLogo.jsx` fired every avatar in the first frame. Now `loading="lazy"` (new `eager` prop opts above-the-fold avatars out) + `decoding="async"` + intrinsic `width`/`height` + `fetchPriority`; same attributes added to `TokenDiscoveryTable` rows and the mobile `MobileTokenRow`/`MobileSearchScreen` images. Browser-verified 25/27 images lazy on the discover page.
- **NOT done (deliberate):** (a) routing logos through `/api/img-proxy` — ⚠️ **this idea was REFUTED by measurement on 2026-07-22, do not revive it**, see the pass below. (b) making `lightweight-charts` (54KB gz, dead weight when TV Advanced is the default) a dynamic import in `TradingChart.jsx` — ✅ **done 2026-07-22**, and the stated blocker ("`createChart` + the series constructors are used across many effects") was wrong: that whole tier is dead code. See below.
- **Follow-up shipped same day — dead day-mode selectors (bucket A).** `TokenLogo.css` turned out to be one of **35 trading CSS files carrying 553 `.app.app-day-mode` rules**, none of which can ever match: trading only ever sets `body.theme-light` (`App.jsx:435/494`, `Header.jsx:167`, `MobileMenuScreen.jsx:32`), and the research iframe is a separate document so nothing leaks in. Split into two buckets — **A: 15 files / 226 rules with NO working `theme-light` rules alongside** (day mode genuinely unstyled there), and **B: 20 files / 327 rules sitting next to working ones** (leftovers). `UserDashboard.css` counted as B but is really A (162 dead vs 8 live; 110 `color` + 94 `background` + 61 `border-color` — the dashboard is essentially unpainted in day mode). Converted bucket A + UserDashboard (**16 files, 389 rules**) to `body.theme-light`; **bucket B left untouched**, still 19 files / 164 rules to delete later.
  - Verified before converting that no occurrence was self-targeting (`.app.app-day-mode { }` styling `.app` itself) or inside a comment — every one was a descendant prefix, so a mechanical selector swap was safe.
  - `ProfileEditModal.css` used research's paired `.app-day-mode X, .day-mode X` convention; the `.day-mode` half is dead in trading too, so it was dropped (18 rules) rather than left as a no-op sibling.
  - **Specificity matters here:** `.app.app-day-mode .x` is [3,0] and `body.theme-light .x` is only [2,1], so a naive swap can let a `:hover`/`.active` dark rule start winning where the original tied and won on source order. Wrote a checker (rule-level specificity + property overlap, discounting cases where a state-specific light override already exists) — 10 raw hits, 8 already covered by the author's own state rules, 1 benign (`.dsb-tf-tab.active .dsb-tf-label` uses `var(--text-secondary)`, which IS remapped under `body.theme-light` in `index.css:178`), 1 real: `.ud-linked-tile:not(.is-connected):hover .ud-linked-tile-icon` is a hardcoded white wash that makes the chip vanish on a light tile — added the black-wash counterpart.
  - Also verified every `var()` in the revived rules resolves to a token the trading app actually defines (these rules had never rendered, so a research-only token would have silently broken them). All clean.
  - **Verified:** build + check-critical-path green, brace balance intact in all 16 files, day mode browser-checked on `#discover` and the token page (`.env-capsule` → `rgba(0,0,0,0.03)` / `#475569`, `.dsb-tf-label` → `rgba(15,23,42,0.55)`). 🪤 Probing computed styles during boot gives DARK values for lazily-chunked components — their CSS chunk hasn't landed yet. Wait for the page to settle before trusting a day-mode probe.
  - **NOT visually verified:** SpectreSocial, DossierStory, BrainSays, AIIntelligenceCard, WatchlistFullView, UserDashboard, the three Mobile*Sheet files — not mounted on the two screens reachable while signed out. Worth a pass in day mode when signed in.

### Status (mobile chart-resize snap-back, 2026-07-22)
User report: dragging the mobile chart-height handle down makes the chart spring back up on release. Root cause: **two sources of truth for the chart height.** `MobileResizeHandle` (`MobileChartCard.jsx`) clamped to a flat 220-800px, but the per-view rules in `MobileTokenPage.css` layer their own `height` on top of `--mcc-chart-h` — `chart-txns` caps it at `min(var, max(300px, 100dvh - 500px))` (~430px on a 930px phone) and `chart` pins it outright at `max(380px, 100dvh - 315px)`, ignoring the var. So the handle happily followed the finger to 800px (the drag paints via an inline wrap height + a `scaleY` illusion), and on release the inline overrides dropped and CSS snapped the chart back to its cap.
- **Fix, part 1 — measure the range, don't hardcode it.** `measureRange()` pins `--mcc-chart-h` to each extreme and reads back what the chart ACTUALLY becomes, so whichever CSS rule wins, the handle's limits are right. Avoids duplicating the `100dvh - 500px` formulas in JS (two sources of truth that would drift). `.trading-chart` carries `transition: height 0.4s`, so the transition is disabled for the probe — otherwise the read returns the height it is animating FROM. Original var + transition are restored (verified: no residue, height returns to 560).
- **Fix, part 2 — pin the drag origin at the limit.** `clampHeight()` now rebases `startYRef` when the height hits a bound, so the finger can't bank phantom travel past it. Previously overshooting by 300px meant the next 300px of upward drag did nothing (a dead zone that reads as the handle sticking, then lurching).
- **Fix, part 3 — inert handle in pinned views.** A view that fixes the height reports a zero-width range; `onStart` bails instead of stretching the chart and snapping it back. (chart-only was the worst case: dragging there did nothing but produce the snap.)
- **Verified** by replaying the real CSS cascade in a synthetic DOM in-browser: `chart-txns` → range 220-789 on a 1289px viewport (= `max(300, 1289-500)`, not 800); `chart` → min === max → bail; no per-view rule → 220-800. Drag sim (down 600px past the cap, then back up): `500, 600, 700, 789, 789, 789, 739, 689` — pins at the cap and responds on the FIRST reversing move. Build + check-critical-path green.
- 🪤 **Could not verify with a real drag.** `resize_window` is ignored while the Chrome window is fullscreen (viewport stayed 2560px, so the mobile shell never mounts), and the documented iframe-harness fallback failed here — the trading app renders blank in a cross-origin frame, and same-origin scripting into it isn't possible across ports. Worth one finger-drag pass on a device.

**Follow-up: the chart visibly STRETCHED while dragging** (user report, same handle). The drag faked the resize with `transform: scaleY(h/start)` on `.trading-chart` while the wrapper grew — so candles, axis labels and the whole drawing toolbar distorted mid-drag and only snapped back to correct proportions on release. The code justified it as "relayout every frame, too heavy — that was the lag". **That diagnosis was wrong**, and it's a trap worth remembering: `.trading-chart` carries `transition: height 0.4s ease-out`, so writing the height every frame restarts a 400ms animation every frame and the element never arrives. Proven in-browser against an element with the same transition — writing targets 420/440/460/480 on consecutive frames rendered **400, 400, 400, 400** with a fresh transition running each time; with the transition suspended the same writes rendered **420, 440, 460, 480** exactly, zero animations. The previous author had already found this fix for the release commit ("killing it for the commit makes the release SNAP") but didn't extend it to the drag. Now: transition suspended for the whole drag, real height committed once per rAF (skipping sub-pixel deltas), transition restored a frame after release so the fullscreen / Chart↔Chart+Txns collapse animations still work. `scaleY`, `transformOrigin` and the inline wrapper height are gone; `getCurrentHeight` reads `.trading-chart` (the element the per-view caps actually land on) instead of its wrapper. **Same viewport caveat as above — the live-resize smoothness itself still wants one pass on a real device.**

### Status (trading follow-up pass, 2026-07-22 — H5 + LW split + day-mode bucket B + logo hosts)
Measured baseline first: **trading boot is now ~165 KB gzip** (main 109 + react-vendor 45 + buffer-polyfill 8 + zustand/shared 3). H1 and H2 ARE shipped — `main.jsx` mounts `PrivyBoundary`, i18n is idle-deferred, and the chart chunks are preloaded only on a `#token/<addr>` deep link. Treat the 1.44 MB figure in section H as historical.

- [x] **H5 — canvas crosshair (`TradingChart.jsx`).** The raw `onMouseMove` binding ran a forced-layout `getBoundingClientRect()`, a spread `Math.max(...visible.map())` over every visible candle, and up to three setStates on **every pointer sample** (well above 60/s on a high-report-rate mouse). Now: `maxVolume` is hoisted out of the draw block into `chartDimensionsRef` (no per-move recompute); the handler body moved to `applyHoverAt(clientX, clientY)` and `handleMouseMove` only stores the latest position + schedules ONE rAF; `setCrosshair`/`setOhlcvLegend`/`setTooltip` return the previous object when nothing changed, so moving *within* one candle no longer re-renders a 5.8k-line component; the queued frame is cancelled on `mouseleave` and unmount. Browser-verified on the native canvas chart: crosshair tracks, price + time labels update, OHLCV legend recomputes per candle, volume tooltip still hits (proves the hoisted `maxVolume`), leave clears, no console errors.
  - 🪤 **The coalescing itself could NOT be measured in-browser.** Synthetic `MouseEvent`s dispatched from the extension reach the DOM (listeners on the canvas, `.chart-body` and `#root` all fire) but React's `onMouseMove` does not respond — same class of trap as the documented `mouseenter` one. And a CDP-driven real cursor produces ~1 move per frame, so the burst the throttle exists for never happens. Verify on real hardware, not with dispatched events.
- [x] **`lightweight-charts` off the token page (54.65 KB gz).** The blocker recorded above was wrong. In `TradingChart.jsx` the entire LW init block (~L1279-1575) is **commented out** ("Legacy LW-charts TV init removed"), so `lightweightChartRef` / `candleSeriesRef` / `volumeSeriesRef` / `vwapSeriesRef` / `tvPriceLineRef` are never assigned and the ~400 lines of live-looking effects that read them all bail on their first guard. The only real consumer is the Holders placeholder (`chartType === 'holders'`, data hardcoded `[]`, Types menu marks it Coming Soon, the `h` shortcut still reaches it). Static import replaced with an on-demand `loadLightweightCharts()`; the Holders effect fetches the chunk itself (with cancel-if-mode-changed); the three remaining references in dead branches go through `LW?.` so nothing throws if that tier is ever revived. Also dropped the `lwc` entry from the deep-link preload hint (`vite.config.js` + `index.html`) — otherwise the chunk downloaded anyway. Verified in the built bundle: TradingChart chunk has **zero static edges** to lightweight-charts, only a dynamic one; browser-verified TV mode, canvas candles, and Holders (chunk loads on demand, chart mounts, no errors).
  - Still there: that ~400-line dead tier + the 296-line commented block. Own cleanup PR; a comment at the import explains what is dead and why.
- [x] **Day-mode bucket B — but the split above was wrong.** 152 live `.app.app-day-mode` selectors remained across 11 files (the other 8 files only mention the class in prose). Classifying each one against the file's own `body.theme-light` rules: **74 are exact leftovers** (a working twin selector already exists) → deleted; **78 have NO twin** → those surfaces were simply unpainted in day mode, so they were converted to `body.theme-light` (`.dsec-*` in RightPanel, `.screener-*`, the `.mct*` mobile toolbar, DataTabs chrome, `.hd`). So bucket B was not "164 rules to delete" — half of it was unshipped styling.
  - Verified: 0 residual live `.app.app-day-mode`, brace balance intact, **no newly-introduced duplicate selectors** (diffed against HEAD — the duplicates that exist were already there), every `var()` in the revived rules (`--accent`, `--accent-wash`) is defined in trading, build green. Browser: light mode gives `.hd` / `.tx-icon-btn` / `.deployer-security` their new light values; dark mode probes unchanged.
  - **7 states stay dark in day mode** — conversion drops specificity [3,0] → [2,1], so a 3-class dark rule now wins: `.mdt .maker-action-btn.filter-btn-icon.active`, `.mct-toggle-btn:hover:not(.is-static)` (×2 light rules), `.tx-icon-btn.tx-filter-btn.has-active`, `.tx-icon-btn.refresh-btn.spinning`, `.tab-item--i7.is-locked:hover`, `.deployer-security:hover`. **Not a regression** — the rules were 100% dead, so this is exactly today's behavior; the author's intent for those states just isn't realised yet. Deliberately did not invent new overrides (two are mobile-only and unverifiable at this viewport).
  - 🪤 Doing this with a regex that slices selector *spans* out of the file cost two bad passes (a lost `{`, and the first selector of every group skipped because a preceding comment landed in the same slice). Every occurrence in this codebase starts its own line in one of three shapes (`sel,` / `sel {` / `sel { … }`) — a **line-oriented** rewrite is the safe tool here.
- [x] **Logo hosts: preconnect, NOT img-proxy.** Measured on prod before touching anything, and the plan's premise did not survive it. Direct CDN: **667ms on the first request (cold DNS), then 97-127ms**; through `/api/img-proxy`: **MISS 594ms, edge HIT 193-231ms**. The "600-900ms TTFB per image" figure was cold DNS+TLS to a new host, not per-image latency — so the proxy is ~2× SLOWER per image (it is an extra hop), quite apart from the rate limit. And the limit is decisive on its own: one `#discover` load pulls **184 images across five third-party origins** (`token-media.defined.fi` 64, `coin-images.coingecko.com` 42, `icons.llamao.fi` 38, `assets.coingecko.com` 36, `media.thegrid.id` 1), so a single page load exceeds the 120/min per-IP bucket and would 429 immediately. **Do not route row logos through the proxy.** The real cost is the handshake per origin (~80-135ms warm, ~670ms cold DNS) paid *after* React renders, because that is when the hosts become known — so `index.html` now preconnects the two heaviest origins and dns-prefetches the other two, no `crossorigin` (row logos are plain `<img>`; the share-card canvas is the only CORS consumer and is user-initiated). The proxy stays for that share-card race — bounded, 10 tokens, click-driven.
  - Not measured: the before/after delta. Dev can't show it (Vite overruns the 250-entry resource-timing buffer) and prod needs a deploy. The win is bounded by the handshake cost above and comes off the post-render path, not off total load time.

### Recommended sequence
1. ~~**H1** (lazy Privy in trading)~~ — SHIPPED; boot is ~165 KB gz. See the 2026-07-22 pass.
2. ~~**H2**~~ SHIPPED (token panels lazy). **H3** — re-confirm `core` isn't boot-loaded; should fall out of H1.
3. ~~**H9** / **H6** / **H14**~~ — all shipped in the 2026-06-11/12 passes.
4. ~~**H5**~~ SHIPPED (chart crosshair, 2026-07-22). **H4** (heatmaps) had its hover storm fixed; the row-component extraction is still open.
5. ~~**H7**~~ — WON'T DO, see the note in the 2026-06-11 status (the service layer already dedupes and the raw store drops the 30D/1Y columns).
6. **H12/H13** (timer/rAF guard consistency sweep) — mostly done; the remaining trading `setInterval`s without a guard are clock ticks (`MobileTimeframeRow`, `AgentTradeCard`, `MobileChartToolbar`, `useWeather`, `useProfileSync`, `LiveFeedPanel`), not network polls.
7. H10/H11 need backend/SSE coordination — scope separately. H15-H17 when list sizes grow.

### Status (trading chart load + TF-switch pass, 2026-07-23 — Evgeniy)
User report: "charts load slow + TF switches lag" (tick-streak-host section, all 3 chart engines). Measured on dev (network layer valid; the Chrome-MCP tab is `document.hidden` so TV WIDGET rendering could NOT be verified — rAF frozen, widget never inits, `tvNoData` fallback fires. That blank-TV/stale-legend state is a MEASUREMENT ARTIFACT, do not chase it as a bug).
- **Measured:** solo `/api/bars` is fast (wide probe 0.4-1.3s warm, cb=1500 0.14s, tail 0.65s) — but a token open fires ~10-12 bars requests in ~8s (boot wide + deep-fill cb=1500 + tail reval + warmTimeframes fan-out + live poll), and the trending keep-warm (TokenTicker + LeftPanel `prewarmChartBarsList`, ~2 req/s while walking 20 tokens) rides on top. Under dev HTTP/1.1 (6 conns/origin) the same requests measured **4-7.5s in-page** — pure queueing. A TF click inside that burst window = the felt lag.
- **Shipped fix 1 (TVA warm tame):** `WARM_RESOLUTIONS` dropped '720' (12H lives in the More dropdown — least-clicked slice of the burst; visible row 1m/5m/15m/1H/4H/1D is exactly what warms now) + warm pool `CONCURRENCY` 3→2. Also corrected the stale "FIXED RECENT WINDOW" comment (code sends from=0; that IS the post-clamp bounded wide probe — same KV bucket as boot/switch fetches, keep the shape).
- **Shipped fix 2 (canvas TF warm):** the canvas charts (Candles/Line + tvNoData fallback) had NO timeframe warm — every TF switch paid a cold 0.6-2.7s span fetch unless hover-prefetch happened to fire. Wired the previously-orphaned `prefetchChartBarsMulti` in `TradingChart.jsx`: once per symbol, after real candles paint (`candleData.length > 0` gate keeps sparse tokens from fanning out billed-empty Codex queries), visible-row resolutions minus active, serial 250ms. Spend parity: canvas and TVA are exclusive surfaces, so a token open costs the same ~5 warm fetches either way. **Browser-verified: canvas 1H→4H switch = ZERO network, candles paint instantly from cache.**
- **Visible-tab verification (same day, user brought the window forward):** TVA token-switch (ticker click) — candles paint ~1-1.5s; warm fires exactly 5/15/60/240/1D (no 720), ≤2 concurrent. TF switches 1m→1H→4H paint INSTANTLY from the warm `resolutionCaches`; network shows only background revalidation (hover-prefetch wide + tail fetch). **The "snapshot dupe" suspicion is RESOLVED — there is no datafeed dupe**: stack-instrumented fetch showed the extra wide `/api/bars` requests on token open belong to `VitalsBento` (fetchMcapSeries res=1D wide + fetchHourlyVolumeBars res=60 24h), `useBarChangeWindows` (res=60 26h), and the deep-fill (cb=1500). The datafeed correctly joins the in-flight snapshot via `hasSnapshotPending`. 🪤 Stack-capture trick for attribution: wrap `window.fetch`, record `new Error().stack` per /api/bars call — Vite dev gives real file:line callers.
- **Shipped fix 4 (warm write-through), same day:** TVA's `warmTimeframes` wrote only its closure-internal `resolutionCaches`, so the TF-pill hover-prefetch (module-level `chartBarsCache`) re-fetched resolutions TVA already held, and a TV->canvas engine switch couldn't reuse the warm. New `seedChartBarsCache()` export in `useCodexData.js`; warm now write-throughs each fetched resolution to the `-countback` key (shape verified identical: `{time(ms),open,high,low,close,volume}`). In-page verified: seed lands under the lowercase key, `hasCachedBarsSync` sees it, per-resolution isolation holds. One visible-tab sanity check pending: hover a TF pill after warm completes -> no network.
- **Shipped fix 3 (cold-boot keep-warm hold-off), same day.** User asked "what about a first launch?" — cold-start test (cleared sessionStorage, cold deep-link) exposed the real first-launch cost: TokenTicker + LeftPanel each kick `prewarmChartBarsList` over ~20 trending tokens via whenIdle within ~1-4s of boot → **~40 cold wide /api/bars (1-4.4s each) in the first 9 seconds**, exactly while the active token's chart does its own cold load (UNI time-to-candles was ~5-7s under the storm; the TVA warm itself politely waited until t≈14s). Fix: all three keep-warm kick sites (ticker, LeftPanel trending, LeftPanel watchlist) hold the FIRST pass until the page is ~15s old (`Math.max(0, 15_000 - performance.now())` before the idle kick) — later passes (set changes, 240s repoll) fire immediately as before. **Verified cold (AAVE deep-link): candles on screen by the +2s screenshot (was 5-7s), only the active token's ~9 requests in the first 6s, keep-warm resumed at exactly t=15.0s.** Tradeoff: a ticker click in the first 15s pays the same cold fetch it always effectively did (the old storm rarely reached a given token that fast anyway) — minus the contention.
- **Known-heavy, left by design (do not "fix" blind):** canvas buffer-extend fires 6 parallel 1400h windows ×2 rounds on boot (deep scroll-back buffer, stops at genesis); trending keep-warm re-walks ~20 tokens per surface per ~4min (cost-war-sanctioned, TTL-deduped). If further lag reports come in, the next lever is a tiny global scheduler that gives user-initiated bars fetches priority over ALL background warms — design change, needs Gleb.
- 🪤 Resource-timing in this app: extension redacts URLs with query strings — log `pathname` + whitelisted params computed in-page. Hash-navigate to the same URL does NOT reload (module caches + timing buffer survive); use `location.reload()` for clean boots.

### Status (MOBILE chart load + TF-switch pass, 2026-07-23 — Evgeniy)
User report: on a phone the chart loads much slower and TF switches lag (vs the now-fast desktop). Traced the mobile tree (`MobileHomeShell`/`MobileTokenPage`/`MobileChartCard` → shared `TradingChart`/TVA) against the desktop warm layers — three desktop-only assumptions were the cause, all fixed:
- **TV 4.4MB bundle warm was DEAD on iOS.** The idle warm in `index.html` used `<link rel=prefetch>`, which Safari (all of iOS) silently ignores — so every mobile token open paid the full 800KB-gz download + 4.4MB parse at click time. Now feature-detects `relList.supports('prefetch')` and falls back to a plain `fetch()` (the bundle is `max-age=31536000, immutable` per vercel.json, so fetch fills the HTTP cache and the later `<script>` load is a cache hit; body read via `.blob()` so the download completes). Deep-link `rel=preload` path unchanged (Safari supports preload).
- **No bars keep-warm on the mobile tree.** `prewarmChartBarsList`/hover-prefetch live only in `TokenTicker`+`LeftPanel`, which never mount on mobile (mobile home is `MobileHomeShell`), and touch has no hover — so every row tap paid the cold ~1-2.5s Codex fetch. Added the same keep-warm to `MobileScreener` (visible board rows, `active`-gated) and `MobileWatchlistScreen` (tab-open-gated): identical guards to the desktop kick sites (15s cold-boot hold-off, `whenIdle` kick, address-SET churn key, TTL-aware passes, 240s `useAdaptivePolling` repoll), but `cap: 12` instead of 20 — phones pay for the bytes. Click-time `prefetchChartBars` in `selectToken` (App.jsx) was already shared, so the tap itself overlaps a fetch either way.
- **12H was warm-excluded but is a first-class mobile pill.** `WARM_RESOLUTIONS` dropped '720' on 2026-07-23 because 12H "lives in the More dropdown" — true only on desktop; `MobileTimeframeRow` renders 12H (and 1W/All) as visible pills, so a 12H tap always cold-fetched. `warmTimeframes` now warms `['1','5','15','60','240','720','1D']` when `MOBILE_MEDIA_QUERY` matches (same query that mounts the mobile tree; the file already imported it). 1W stays excluded on both (Monday-anchor issue); 'All' maps to 1D which is already warm. Desktop list unchanged.
- **Verified:** build + check-critical-path green; all three index.html inline scripts pass `node --check`; dist carries the new warm script. 🪤 NOT device-verified — same viewport traps as the 2026-07-22 passes (fullscreen Chrome ignores resize_window, hidden tabs render zero TV frames); worth one pass on a real phone: cold home → token open (bundle should come from disk cache), TF taps incl. 12H after the ~15-20s warm window.

**Open after the 2026-07-22 pass:** the ~700 lines of dead lightweight-charts plumbing in `TradingChart.jsx` (own PR); the 7 day-mode states listed above; and the two things that need hardware or a signed-in session — a real finger-drag on the mobile chart-resize handle, and a day-mode look at SpectreSocial / DossierStory / BrainSays / AIIntelligenceCard / WatchlistFullView / UserDashboard / the Mobile*Sheet files.

### Status (trading TV cold-token >3s = shimmer outliving the data, 2026-08-05 — Evgeniy, working tree NOT pushed)
User report: TV chart takes >3s on first-ever-opened tokens while /api/bars answers <1s. Measured on prod (visible tab, search-click flow): the DATA was never the problem — `tv-first-result` lands at 0.13-0.94s. The shimmer stayed up **8-18s** because on a cold (non-cached) token switch **TV v27's setSymbol completion callback and onDataLoaded never fire** — `setChartReady(true)` has no trigger and the loader only dies via the 8s `chartShimmerVisible` cap (± restarts on token-object churn ≈ 18s observed twice).
- **Why TV wedges (traced with a fetch hook + fiber-extracted widget handle + vr sampler):** during setSymbol the timescale is transiently `[1970-01-01, 1970-01-01]`. On a SPARSE series the first window undershoots TV's `countBack` (empty buckets), and the old scroll-back cache path answered follow-ups with narrow `[from..to)` slices that undershoot again → TV marches 53→10→3-bar windows, then asks the whole epoch-anchored viewport (`from=-26100, countBack=1,984,025` ≈ `to/900`), gets superset+noData — and never signals completion. DENSE cold tokens (WOJAK) complete fine: callback 3ms after first result, shimmer 1.03s. Warm switches fine (759ms). So the bug class = **sparse tokens** — exactly what "первый раз открываю" usually is.
- **Fix 1 (datafeed contract):** the scroll-back cache hit now answers with the SUPERSET (all cached bars < to), not the narrow slice — the same shape the page-walk path already returns, and the shape measured to complete TV's load (warm trace: superset answer → callback in 1ms). Kills the marching cascade + the billed epoch-monster fetch.
- **Fix 2 (the guarantee):** cold-switch early-ready — `applySymbolSwitch` arms `coldSwitchSymRef`; the datafeed's first-window wrapper fires a new `onFirstWindowPaint(key)` hook when REAL candles for the current symbol are handed to TV; the component then runs stickyFitChart + `setChartReady(true)` 120ms later. Mirror of the existing cold-create "2c" early-ready; setSymbol callback stays as idempotent fallback and clears the ref. Empty first windows keep the no-data → canvas-fallback path untouched (hook fires only on bars.length>0).
- **Verified (dev, visible tab):** extreme-sparse cold Ponke-Base 1m → shimmer gone at **data+167ms** (2.54s total, of which 2.37s is dev's cold /api/bars; prod bars are 0.7-0.9s → ~1s to candles); cold MOODENG → data+140ms; build + check-critical-path green. Warm path untouched by the diff.
- 🪤 `.chart-loading-state` exists TWICE in TradingChart.jsx — the TV overlay (:5039) and an UNGUARDED canvas-path loader (~:5135, renders in TV mode too, hidden behind the TV container's z-index). A shimmer poller must scope to `.tradingview-advanced .chart-loading-state` or it measures the invisible one. Also: the search modal prefetches bars for result rows — top results are WARM switches; only 2nd+ results reproduce cold.
- 🪤 Widget handle without source maps: walk `__reactFiber$` up from the TV iframe's parent, scan hook chains for `{current: {activeChart: fn}}`. `spectre-tv-debug=1` localStorage flag turns on the `[tv-dbg]` request log — it's what exposed the epoch-0 march.
- **NOT fixed (pre-existing, noted):** raw `#token/0xEVMADDR` hash navigation without chain context resolves Base addresses as Ethereum (empty token) — the deep-link identity class; and TV's callback still doesn't fire on some sparse 1m switches even with superset answers (early-ready covers it).

**Follow-up same day — deep-link bars early-fetch (same branch).** Deep links couldn't benefit from the search/click prefetches, and GP6's snapshot (fired at HTML-parse) still gates its fast phase on details+bars settling together (~1.2-1.5s cold) while a lone `/api/bars` is 0.65-0.9s. Three changes:
- **index.html GP6 block** fires a DIRECT `/api/bars` alongside the snapshot (`window.__SPECTRE_BOOT.bars`, wide boot shape, 3y clamp kept in sync with `MAX_BARS_RANGE_SEC`) — only when the network is known (Solana by address format; EVM only on a saved-token networkId match, so an unknown 0x never burns a wrong-chain Codex query).
- **codexApi.getBars** adopts the handoff once (guards: address/networkId/resolution/wide-shape/60s age; empty or failed early fetch re-enters the normal path). `main.jsx`'s early-prefetch skip was retargeted: with a bars handoff present, `prefetchChartBars` IS its consumer (seeds `chartBarsCache` → the datafeed's `getCachedBars` reads it) — and the snapshot adoption in `fetchTokenSnapshot` now deletes only its own member of `__SPECTRE_BOOT`, not the whole object (it was racing the bars adoption and silently dropping it).
- 🪤 **Found while verifying: the index.html `tfRes` copy had drifted** — it only carried the legacy UPPERCASE timeframe keys ('5M'), while the saved timeframe migrated to lowercase minutes ('5m'), so on every minute-TF user the GP6 snapshot has been fetching resolution '60' and the chart seed silently missed. Synced with `chartTimeframes.js` (the "KEEP IN SYNC" comment had not been honored). This alone fixes deep-link boots for minute-TF users independent of the new bars handoff.
- **Verified (dev, deep link на Solana):** `boot-bars-fired` 260ms → `boot-bars-adopted` 470ms → chart's first datafeed request answers from the seeded cache (`tv-data-loaded` +8ms). No duplicate wide fetch (single consumption). Non-deep-link boots untouched (no `#token/` hash → GP6 returns early; adoption no-ops without `__SPECTRE_BOOT`).

### Status (trading token-open / first-candles, 2026-08-04 — Evgeniy)
Follows PRs #1398 (eight measured wins), #1399 (the token snapshot was returning
163 bytes of nulls for every token — self-fetch base + a poisoned KV entry) and
#1400 (snapshot head-start race). All merged.

**Baseline on prod, in-app click → `spectre:tv-first-result`** (5 tokens, window
raised and focused): 74ms (client-cache hit), then **1488 / 1667 / 1397 / 1315ms**
— median 1443ms cold. Anatomy of one cold open, from the marks + a fetch
interceptor:

```
0     click                      1906  bars land (1314ms)
149   tv-getbars-enter           2031  tv-first-result  ← candles
592   direct bars starts         2225  deep-fill (cb=1500)
        ^ 443ms of head start    3474  second tv-data-loaded (repaint)
```

- **The 400ms snapshot head start never wins — removed.** #1400 gave the
  snapshot a head start so a warm one could save the extra Codex bars call.
  Measured head-to-head on 7 unvisited tokens, both fired on the same tick:
  snapshot `2348 1572 1575 1373 1373 1352 2059` (median 1573) vs direct bars
  `887 767 670 765 666 643 726` (median 726). **Direct bars won 7/7 by
  608-1461ms.** For the head start to save a call the snapshot would have to
  land within ~550ms of the click; it never does, so the direct arm fired
  anyway, every time, 400ms late. Zero calls saved, 400ms paid on every cold
  open. Both arms now fire on the same tick — same spend, ~28% off first
  candles (expected ~1040ms median).
- **Contention was NOT the cause — hypothesis refuted.** Bars inside a
  7-way burst (snapshot + details + trades + bootstrap + tweets/search +
  momentum-origin) measured **518ms** vs 449-832ms solo. The backend takes the
  token-open fan-out fine; don't go looking for a request scheduler.
- 🪤 **A blank TradingView pane in a Chrome-MCP tab is the documented artifact,
  not a bug.** Chased a token whose chart drew nothing for a full minute while
  `tv-first-result` and `tv-data-loaded` both fired and `/api/bars` returned 12
  valid current bars. `document.hidden` had flipped to true mid-session (the
  window was occluded, not minimized) → rAF frozen → the widget never painted.
  With the window genuinely raised (`osascript`: `minimized=false` +
  `active tab index` + `index=1` + activate) the same token drew fine. **Re-check
  `document.hidden` immediately before believing any chart screenshot.**
- 🪤 `mcp__claude-in-chrome__javascript_tool` returns `{}` for a top-level
  `async` IIFE — the promise is not awaited despite the tool description.
  Assign to a `window.__X` global inside the async body and read it in a
  second call.
- 🪤 The extension blocks any tool output containing a query string. Classify
  requests in-page (path + whitelisted param names) and emit only that.

### Status (trading TV scroll-back "прыгает назад влево" = cascade viewport drift, 2026-08-13 — Evgeniy, working tree NOT pushed)
User report: drag right to load history on Candles (TVA, PALM 5m mcap) → while
waiting nothing happens, then when bars land the chart jumps left instead of
just drawing them. Reproduced live on prod with `spectre-tv-debug=1`:
- **Root cause: the per-delivery viewport capture legitimized TV's own drift.**
  Each scroll-back delivery captured a "fresh" visible range (`_vpCaptureSeq`
  monotonic id) and scheduled restore checks at +0/200/600ms. But after every
  prepend TV auto-pages for more history (~0.8s apart, cb walking 584→132 on a
  sparse token), and EACH new request minted a new capture seq — killing the
  previous delivery's still-pending checks. TV's late ingest shift (200-900ms
  after a delivery) went uncorrected, and the next delivery captured the
  SHIFTED view as its reference. Measured on prod: held whitespace view at
  from=1783649100 drifted to 1783293600 (~98h left) over a 12-page cascade —
  each step defended by the restore itself.
- **Fix (`TradingViewAdvanced.jsx`): one module-level `_sbViewAnchor` per
  cascade instead of per-delivery captures.** Minted at delivery time, reused
  by every later delivery while `_lastGestureTs <= anchor.at` — only a USER
  gesture (or `clearSbViewAnchor()` from a deliberate refit: stickyFitChart,
  the onDeepHistory hand-off) can move the reference; TV's own shifts never
  re-anchor. Checks (+0/200/600/**1200**ms, each delivery re-arms against the
  SAME anchor) form near-continuous coverage across the cascade.
- **Verified live (dev, visible tab, PALM 5m):** SNAPs fire and correct TV
  shifts of -78000s/-114300s; subsequent checks log `hold delta=0`; after
  dragging to the history wall and waiting, the viewport is byte-identical
  6s later while pages merge — bars just appear. Build + check-critical-path
  green, zero console errors.
- 🪤 The blank-pane-in-hidden-tab artifact bit again mid-verify: the MCP tab
  silently lost visibility between reloads (user switched tabs) and BOTH A/B
  arms rendered empty — looked exactly like the fix breaking the initial
  paint. Re-check `document.visibilityState` before believing any A/B arm.
- **Follow-up 4 (2026-08-14, THE ONE FOR WHITESPACE): anchor by RIGHT EDGE +
  BAR SPACING, never by [from..to].** On this index-based (removeEmptyBars)
  axis, bars materializing INSIDE a visible whitespace window change the
  time-to-pixel mapping even when the [from..to] range is perfectly held: the
  window now contains more real bars, setVisibleRange re-derives the spacing,
  and every old candle re-shuffles - so the from-based restore itself CAUSED
  a visible jump on every whitespace fill (and a from-comparison with the
  tightened threshold fired on every legit materialization). The anchor now
  stores right-edge time + barSpacing; drift detection compares those two
  (`from` drift is legitimate when whitespace fills); the restore is
  two-step: setVisibleRange pins the right-edge time, then setBarSpacing -
  which zooms FROM the right edge and sticks - restores pixels-per-bar. Old
  candles keep their index distance to the right-edge bar across a prepend,
  so they land on their exact pixels and new bars just fill the whitespace.
  Verified pixel-by-pixel on a whitespace-left/candles-right view: after the
  load the candle pattern and crosshair are identical, whitespace filled with
  Jul 6-9 bars, all checks `hold dTo=0`. (setRightOffset would be the
  one-call primitive but is INERT for scrolled-back views on this build -
  re-verified live: ro=-379, setRightOffset(ro+30) no-ops.)
- **Follow-up 3 (2026-08-14): the timer-window FLASH was the visible jump.**
  Even with the anchor correcting every shift, the correction ran on timers
  (+0/200/600/1200ms) while TV's ingest shift lands on TV's own queue between
  them - a multi-DAY index-space teleport painted for up to 200ms before the
  next timer restored it (user session log: SNAP delta=-637500 = 7.4 days,
  corrected but visibly late - "график прыгает влево при подгрузке, если есть
  пустое место"). Fix: restoreViewportAfterPrepend also subscribes `check` to
  `onVisibleRangeChanged` for 1.5s per delivery - the correction runs on the
  tick of the shift, before paint. Measured: a -249300s (2.9-day) ingest
  shift reverted in **2ms** (same tick; a frame is 16ms), so the flash
  physically cannot render. Re-entry safe (own setVisibleRange re-fires the
  event, delta 0 no-ops); user pans stamp the gesture in capture phase before
  TV moves, so the guard yields first.
- **Follow-up 2 (2026-08-14): deliveries landing MID-GESTURE were the third
  leak.** The gesture guard rightly refuses to correct while the user pans, so
  a history response arriving during an active drag put TV's insert-shift
  under the finger with nothing ever correcting it — synthetic (instant)
  drags never reproduced this, real continuous dragging hits it on ~half the
  deliveries. Fix: `deliverWhenQuiet()` — a scroll-back onResult is HELD until
  ~200ms of gesture silence (cap 4s), so the prepend never happens under an
  active gesture; the anchor + checks then own the viewport. TV waits on its
  callback indefinitely and repeat asks are cache-served, so nothing
  re-fetches. Token-switch race re-checked inside the deferred delivery.
- **Follow-up (2026-08-14): the 25-bar restore threshold was a second, smaller
  leak.** User re-report: "курсор был на одном времени, после догрузки стало
  другое" — sub-25-bar ingest shifts (up to 2h on 5m) logged `hold` and stood,
  because the wide margin predates the gesture guard and existed to avoid
  fighting user pans. Tightened to 1.5 bars (TV's insert-shift equals the
  prepended bar count, so real shifts are always multi-bar; sub-bar deltas are
  float noise). Verified live with a parked crosshair through a real cascade:
  a `delta=-900` (3-bar) shift that the old threshold would have kept now
  SNAPs; crosshair reads the same time before and after the load. Verify
  method: 100ms `getVisibleRange` sampler via the fiber-walked widget handle
  (`window.__tvW`) + crosshair zoom-screenshot of the axis label.
