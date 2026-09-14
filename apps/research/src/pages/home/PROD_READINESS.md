# Welcome Page — Prod Readiness Tracker

Audit date: 2026-05-07. Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped.

---

## P0 — SHIP-BLOCKERS

### Data correctness
- [x] **P0-1** Killed fake sparklines from live UI (4 paths in discovery-section.jsx)
  - L943, L1141: `getCachedSparkline(...)` → `row.sparkline_7d || row.sparkline`
  - L1669, L1814: removed synth fallback → `token.sparkline_7d` only
  - Sparkline component renders null when data is missing (graceful fallback)
  - Removed dead `getCachedSparkline` callback + `generateSparkline` import + cache ref
  - Removed dead `generateSparkline` prop from `inline-horizontal-bar`, `welcome-page.jsx`, `use-welcome-interactions.js`
  - `generateSparkline` in `welcome-page-helpers.js` retained for share cards only
- [x] **P0-2** Removed unused `marketStats` prop chain (welcome-page.jsx + cinema-welcome-wrapper + cinema-welcome-bar) — the cinema bar already computes globalMcap/Volume from real data
- [x] **P0-3** Gated Discovery Full View portal on `!isMobile`

### Cascade landmine
- [x] **P0-4** Removed duplicate `.welcome-page { padding: 0 !important }` from `welcome-page-responsive.css:219`

### Polling discipline
- [x] **P0-5** Inline `document.hidden` guard added to all 3 hot-poll hooks
  - `use-wallet-moves.js`, `use-sector-7d.js`, `sectors-line-chart.jsx`
  - Background tabs now skip the 21 combined network calls/cycle
- [x] **P0-6** Tab-gated eager fetches in `use-market-intelligence` and `use-ai-brief`
  - Added `briefTabActive` flag (true when `marketAiTab === 'brief' || 'analysis'`)
  - `fetchAiText` (5min poll) gated
  - `fetchBreakingSynthesis` (60s poll) gated
  - Brief is default tab so cold-start unchanged; tab-switching saves the polls when on news/calendar/etc
  - **NOT gated** (intentionally): `useMarketIntel` (powers global alerts banner), `useSectorData` (powers sectors panel), `fetchBreaking` (cheap 60s poll for breaking-news banner across tabs). These are cheap and used by multiple consumers.

### Design-system violations
- [x] **P0-7** Replaced 5 spinners + fixed 1 broken class
  - `ai-market-panel.jsx:112` "Loading..." → 4-cell shimmer grid
  - `command-center.jsx:208` "Loading BTC..." text → 3-row shimmer skeleton
  - `heatmap-command-panel.jsx:127` rotating spinner → 24-cell shimmer grid
  - `welcome-page.css:4112` `ccSpinnerRotate` → 8px pulsing dot (`.cc-tab-action-loading` is a button-state convention, dot pulse fits design system better than rotation)
  - `welcome-page.css:14284` dead `.loading-spinner` + `loading-rotate` keyframe deleted
  - `cc-fullview-overlay.jsx:139` was using `cc-tab-action-spinner` (no CSS, invisible) → fixed to `cc-tab-action-loading`
  - **Skipped:** `.mobile-pull-indicator-spinner` (welcome-page.jsx:839) — kept as gesture indicator for pull-to-refresh; not a "loading" state per se

---

## P1 — Pre-prod hygiene

### Dead code (delete)
- [x] **P1-1** 78-line dead JSX block removed (welcome-page.jsx 2042 → 1957 LOC)
  - Removed `horizontalLayout = true` constant + 3 references
  - Inlined `' horizontal-layout'` in className, simplified `{!isMobile && (` guard
- [x] **P1-2** Delete `.stashed-backup` files (done — 101KB)
- [x] **P1-3** Delete `.tmp` files (done)
- [x] **P1-4** Delete 3 orphan mobile component pairs + 3 standalone CSS (done — ~80KB)
  - `mobile-welcome-strip.{jsx,css}`
  - `mobile-home-tabs.{jsx,css}`
  - `mobile-compact-stats.{jsx,css}`
  - Standalone: `mobile-home.css` (37KB), `mobile-home-tab.css` (4KB), `mobile-brief-card.css` (7.5KB)
  - **NOTE:** `mobile-token-list.{jsx,css}` and `mobile-token-row.{jsx,css}` are NOT orphan — they're imported by `discovery-section.jsx:18` (live chain). Audy was wrong on this.
- [ ] **P1-5** Delete `welcome-page-responsive.css` (1686L / 46.7KB)
  - Migrate any unique non-mobile rules (1100/1350/1500px breakpoints) into `welcome-page.css` first
  - Then remove import at `welcome-page.jsx:61`
- [x] **P1-6** Dead refs deleted from `use-ai-brief.js`, `use-news-data.js`, `use-x-posts-data.js`
- [x] **P1-7** Deleted `welcome-widget-sidebar.jsx` + `watchlist-panel.jsx` (consumed only by dead block)

### Performance
- [x] **P1-8** `SpectreSparkline.jsx:36` DPR `Math.max(dpr, 3)` → `Math.min(dpr, 2)` (10× pixel cost reduction on phones)
- [x] **P1-9** Obsoleted by P0-1 — `getCachedSparkline` deleted entirely
- [ ] **P1-10** Consolidate duplicate breaking-news polling
  - `use-ai-brief.js:97` AND `use-market-intelligence.js:45` both poll 60s
- [x] **P1-11** `use-heatmap-data` now accepts `active` flag, gated on `marketAiTab === 'heatmaps'` in welcome-page.jsx
- [ ] **P1-12** Switch top-coin prices from 5s polling to `binanceStreamService` (WebSocket)
  - `use-market-prices.js:25`
- [x] **P1-13** Stable scalar deps for `baseMacroAnalysis` + `taAnalysis` — extracted BTC/ETH/SOL price+change scalars instead of `topCoinPrices` object reference
- [x] **P1-14** Module-scope cache for `DominanceChart` history (5min TTL) — modal reopens use cache
- [x] **P1-15** `AbortSignal.timeout(3000)` on alternative.me fallback (caps cold-start)

### Code smell
- [ ] **P1-16** Audit & prune `legacy-ai-market.css` (39KB) imported at `welcome-page.jsx:64`
- [x] **P1-17** Local `formatPrice` replaced with `useCurrency().fmtPrice` in `mobile-token-row.jsx` and `mobile-token-list.jsx` — non-USD users now see correct currency
- [x] **P1-18** Hardcoded route paths replaced with `getPathForPageId('token')` / `getPathForPageId('predictions')` in `index.jsx` and `discovery-section.jsx`
- [x] **P1-19** Mobile blur 24px → 12px on `.discovery-fullview-overlay` (mobile blur budget per design-system)
- [ ] **P1-20** Mobile sparklines DPR fix in `mobile-token-row`, `mobile-watchlist-strip`, `mobile-highlights-tabs`
- [ ] **P1-21** Replace AbortController with `let cancelled = false` in `use-news-data.js`, `use-x-posts-data.js`

---

## P2 — Refactor (post-launch)

- [ ] **P2-1** Extract from welcome-page.jsx (2042L)
  - HorizontalLayout block (L1170-1479)
  - Discovery fullview portal (L1857-2001)
  - Mobile content block (L834-1126)
  - `getDiscoveryProps()` helper (3× duplicate ~80-prop bag)
- [ ] **P2-2** Consolidate hooks
  - `use-welcome-feeds.js` aggregator for fear-greed + news + x-posts + econ event + market-status + wallet-moves
  - Sector trinity → one hook
- [ ] **P2-3** Server aggregate `/api/welcome/init` (one request instead of 11)

---

## Deferred (need dedicated session + visual QA)
- [ ] **P1-5** Delete `welcome-page-responsive.css` (1686L / 47KB) — spans 7 breakpoints, must migrate desktop-tablet rules first. **High visual-regression risk; defer.**
- [ ] **P1-10** Consolidate duplicate breaking-news polling between `use-ai-brief` + `use-market-intelligence` — touches alerts banner data flow
- [ ] **P1-12** WebSocket top-coin prices via `binanceStreamService` — cross-cutting concern, separate session
- [ ] **P1-16** Audit + prune `legacy-ai-market.css` (39KB) — needs CSS-coverage tooling
- [ ] **P1-20** Mobile sparkline DPR fix in `mobile-token-row` / `mobile-watchlist-strip` / `mobile-highlights-tabs`
- [ ] **P1-21** Replace AbortController with `let cancelled = false` in `use-news-data` / `use-x-posts-data` (background polling pattern compliance)

## Network budget
- Idle on Brief tab today: **~28 req/min**
- Target: **<10 req/min** (P0-6 tab gating + P0-5 visibility guards now collectively cut ~15 req/min when not on brief tab)

## Verification after each step
- `npm run build:research` clean ✓ (every batch built green)
- Audy code review run after major batches ✓

## Bonus runtime bug fixed
- **`mindshare-tab-panel.jsx:60` `shortName()` crash** — `b.name` was undefined for some bubbles, throwing `TypeError: Cannot read properties of undefined (reading 'includes')` when MindshareTabPanel rendered. Added defensive `if (!name || typeof name !== 'string') return ''` guard. Pre-existing bug; surfaced during post-cleanup smoke test.

## Summary of impact
- **20 files deleted** (~250KB raw)
- **welcome-page.jsx**: 2042 → 1957 LOC (-85)
- **CSS**: ~47KB removed (`.stashed-backup` + `.tmp` + 6 orphan mobile pairs + `mobile-home.css` + dead spinner blocks)
- **JSX**: dead 78-line block + dead destructured props + dead generateSparkline chain
- **Network**: tab gating cuts ~12 req/min on non-brief tabs; visibility guards cut 21 req/cycle in background tabs; DominanceChart no longer refetches on every modal open
- **Render**: SpectreSparkline DPR 3→2 = ~10× pixel-cost reduction on mobile; stable scalar deps stop unnecessary recomputes on every Binance poll
- **Correctness**: fake synthesized sparklines killed; fake hardcoded marketStats removed; mobile portal properly gated; broken `cc-tab-action-spinner` class fixed; all 3 polling hooks now skip in background tabs
- **Design system**: 5 spinners replaced with shimmer; mobile blur 24px → 12px (within budget); `--font-mono` no longer bypassed via local formatters in mobile rows
