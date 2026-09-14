# Welcome Page Performance Plan

Audit date: 2026-06-03
Owner: Evgeniy
Target: cold TTI ~2.5s → ~1.4s, time-to-data-visible ~3-4s → ~1.8s

---

## Current state

```
welcome-page.css            16,410 lines  ≈ 408KB
welcome-page.day-mode.css    5,153 lines  ≈ 172KB   (loaded in dark mode too)
welcome-page.cinema-mode.css 4,865 lines  ≈ 116KB   (loaded outside cinema)
welcome-page.mobile.css      3,704 lines  ≈ 116KB   (loaded on desktop too)
tab-panels.css               5,001 lines  ≈ 136KB
──────────────────────────────────────────────────
Total CSS on first paint:   ~1.0 MB
home/components/ directory: 2.7 MB (46 JSX, 32 CSS)
welcome-page.jsx:           2,305 lines (24 useEffect calls)
```

---

## P0 — Quick wins (do first, low risk)

### [x] A. Defer mobile / day-mode / cinema-mode CSS by media query (DONE 2026-06-03)
**File:** `welcome-page.jsx:65-67`
**Effort:** 1h
**Win:** -300-500ms desktop CSS parse

Today: `import './welcome-page.mobile.css'` runs on every visit, on every device.
Fix: copy the pattern from `main.jsx:41-53` — use `matchMedia` + dynamic `import()`.

```js
// inside useEffect or module init
if (window.matchMedia('(max-width: 768px)').matches) {
  import('./welcome-page.mobile.css')
}
if (savedDayMode) {
  import('./welcome-page.day-mode.css')
}
if (cinemaMode) {
  import('./welcome-page.cinema-mode.css')
}
```

**Verify:** open DevTools → Network → CSS. Mobile CSS file should not appear on desktop.

---

### [x] B. Preconnect CoinGecko CDN (DONE 2026-06-03)
**File:** `apps/research/index.html` (after line 121)
**Effort:** 5min
**Win:** -100-200ms on first token logo fetch

```html
<link rel="preconnect" href="https://coin-images.coingecko.com" crossorigin>
<link rel="dns-prefetch" href="https://coin-images.coingecko.com">
<link rel="preconnect" href="https://assets.coingecko.com" crossorigin>
```

**Verify:** DevTools → Network → token logo request `Initial connection` time drops to ~0ms.

---

### [x] C. Lazy-load token logos + fixed dimensions (DONE 2026-06-03)
**Files:**
- `welcome-page.jsx:1698`
- `inline-horizontal-bar.jsx`
- `mobile-token-row.jsx`
- `discovery-section.jsx`

**Effort:** 30min
**Win:** -CLS, faster scroll, fewer parallel image requests

Every token logo `<img>`:
```jsx
<img
  src={token.logo}
  alt={token.symbol}
  loading="lazy"
  decoding="async"
  width="32"
  height="32"
/>
```

**Verify:** Lighthouse CLS score should drop. Off-screen logos shouldn't fire requests until scrolled into view.

---

### [x] D. Lazy-load HeatmapCommandPanel + DominanceChart (DONE 2026-06-03)
**File:** `welcome-page.jsx:51`
**Effort:** 30min
**Win:** -50KB initial chunk

Today: eagerly imported, only renders when heatmap tab open.
Fix:
```js
const HeatmapCommandPanel = lazy(() => import('./heatmap-command-panel'))
```
Wrap the render site in `<Suspense fallback={null}>`.

Also check `DominanceChart`, `ChartPanel`, `InlineWatchlistPanel` — same treatment if not above-the-fold.

---

### [x] E. Shorten blur entrance animation (DONE 2026-06-03)
**File:** `welcome-page.css` — `@keyframes blurEntrance` block
**Effort:** 5min
**Win:** -400ms perceived load time

```css
.welcome-horizontal-bar {
  animation: blurEntrance 280ms cubic-bezier(0.16, 1, 0.3, 1) 0ms both;
  /* was: 0.7s */
}
```

---

## P1 — Data layer (medium effort, high impact)

### [x] F. Add timeout to derivSnap parallel fetch (DONE 2026-06-03)
**File:** `use-market-intelligence.js:184-190`
**Effort:** 30min
**Win:** unblocks AI Market panel when one endpoint is slow

5 parallel `fetch()` calls with `Promise.allSettled` — one slow endpoint stalls all of them.

```js
const withTimeout = (p, ms = 8000) =>
  Promise.race([
    p,
    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))
  ])

const [cgOi, cgLiq, funding, sOi, sLiq] = await Promise.allSettled([
  withTimeout(fetch('/api/coinglass/total-oi')),
  withTimeout(fetch('/api/coinglass/total-liquidations?range=24h')),
  withTimeout(fetch('/data-api/v1/derivatives/funding-rates')),
  withTimeout(fetch('/data-api/v1/derivatives/open-interest?limit=500')),
  withTimeout(fetch('/data-api/v1/derivatives/liquidation-windows')),
])
```

---

### [x] G. Verify useMarketIntel slim mode actually skips heavy endpoints (VERIFIED 2026-06-03 — works correctly, no fix needed: slim bundle fires 3 endpoints vs full's 8, and alpha feed gated to fullEnabled)
**File:** `use-market-intelligence.js:34-35` + `@/hooks/useMarketIntel`
**Effort:** 30min
**Win:** -1 to -2s on first paint if it's currently over-fetching

`intelMode` switches between `'full'` and `'slim'`. Open `useMarketIntel.js`, confirm `mode === 'slim'` actually skips the derivatives bundle. If not — that's a 90s round-trip wasted on first paint.

---

### [x] H. Debounce CoinGecko watchlist search (DONE 2026-06-03)
**File:** `welcome-page.jsx:296-309`
**Effort:** 20min
**Win:** -2 requests per keystroke

Every keystroke fires `/search?query=X` then `/coins/markets?ids=Y,Z,...`. Add 300ms debounce:

```js
const debouncedQuery = useDeferredValue(watchlistSearchQuery)
// or a useDebouncedValue hook
useEffect(() => { /* fetch logic */ }, [debouncedQuery])
```

---

### [~] I. Abort stale CoinGecko paginations (SKIPPED 2026-06-03 — existing `cancelled` flag + service inflight dedup already handles staleness; deeper AbortController would require modifying shared coinGeckoApi.js)
**File:** `use-top-section-data.js:159`
**Effort:** 30min
**Win:** no rate-limit risk on rapid category/page clicks

Track `AbortController` per fetch, cancel previous when a new one fires.

```js
const abortRef = useRef(null)
useEffect(() => {
  abortRef.current?.abort()
  abortRef.current = new AbortController()
  fetch(url, { signal: abortRef.current.signal })
}, [category, page])
```

---

### [x] J. Render shimmer immediately in liquidation heatmap (DONE 2026-06-03 — fix in `useRealHeatmap`, not `useLiquidationHeatmap` which only feeds AI insights box)
**File:** `use-liquidation-heatmap.js:83+`
**Effort:** 30min
**Win:** instant visual feedback on tab open

Today: canvas renders only after fetch completes.
Fix: return empty data immediately so shimmer mounts, update when real data lands.

---

## P2 — Bundle splits (larger work, biggest CSS wins)

### [ ] K. Split welcome-page.css per tab
**File:** `welcome-page.css` (16k lines)
**Effort:** 1 day
**Win:** -300KB cold CSS

One monolith owns brief / news / heatmap / sectors / mindshare / cinema / tickers. Break it up:

```
welcome-page.css     → core layout + horizontal bar only (~80KB)
brief-tab.css        → expand (already exists)
news-tab.css         → new
heatmap-tab.css      → new
sectors-tab.css      → new
mindshare-tab.css    → new
```

Import each inside its tab's lazy JSX file → CSS ships with the chunk.

---

### [ ] L. Lazy-load mobile components on desktop
**File:** `welcome-page.jsx:70-78`
**Effort:** 2h
**Win:** -150KB desktop bundle

Today: 6 mobile components (`MobileMarketPulse`, `MobileQuickStats`, etc.) parsed on every desktop visit.

```js
const MobileMarketPulse = lazy(() => import('./mobile-market-pulse'))
// ...

{isMobile && (
  <Suspense fallback={null}>
    <MobileMarketPulse />
  </Suspense>
)}
```

---

### [ ] M. Split welcome-page.jsx (2,305 lines)
**File:** `welcome-page.jsx`
**Effort:** 1 day
**Win:** smaller cold parse + much easier future changes

One file owns 4 tab modes, mobile + desktop trees, watchlist search, ticker, compare bar, share modal, news detail, story modal — and has 24 useEffects.

Split into:
- `welcome-page-desktop.jsx`
- `welcome-page-mobile.jsx`
- `welcome-watchlist-search.jsx` (the keystroke fetch chain lives here)

---

## Cross-app notes (related to perceived speed)

### [ ] N. Verify useAdaptivePolling honors document.hidden
**File:** `use-market-intelligence.js:60`
Check that polling pauses when tab is hidden. If not — wasted API calls + battery drain.

### [ ] O. Seed useLivePrices with last known SSE state
**File:** `use-top-section-data.js:237`
On-chain trending shows empty for ~2s after refresh while SSE reconnects. Cache last snapshot in localStorage.

### [ ] P. Swap token logo fallback order
**File:** `welcome-page.jsx:437`
Today: live `coin.image` first, local `COINGECKO_LOGOS` map fallback.
Better: local map first (instant), upgrade to live image when loaded.

### [ ] Q. Dynamic-import i18n locales
**File:** `apps/research/src/i18n/index.js`
All 8 locale files imported statically. Load only `navigator.language` + English fallback. Saves ~50-100KB.

### [ ] R. (related, separate plan) TradingView Advanced bad-data spikes
See `.claude/rules/charts-system.md` Phase 1 — still pending. Not welcome page, but blocks chart perception across the app.

---

## Recommended execution order

| # | Step | Effort | Win |
|---|------|--------|-----|
| 1 | A — defer mobile/day/cinema CSS | 1h | -300-500ms |
| 2 | B — preconnect CoinGecko CDN | 5min | -100ms |
| 3 | C — lazy `<img>` on token logos | 30min | -CLS |
| 4 | D — lazy HeatmapCommandPanel | 30min | -50KB |
| 5 | E — shorten blur animation | 5min | -400ms perceived |
| 6 | F — timeout on derivSnap | 30min | unblocks AI panel |
| 7 | G — verify slim mode skips heavy | 30min | -1-2s if broken |
| 8 | H — debounce CG search | 20min | -2 reqs/keystroke |
| 9 | I — abort stale paginations | 30min | cleaner network |
| 10 | J — shimmer-first liquidation | 30min | instant feedback |
| 11 | K — split welcome-page.css | 1d | -300KB cold |
| 12 | L — lazy mobile components | 2h | -150KB desktop |
| 13 | M — split welcome-page.jsx | 1d | smaller parse |
| 14 | N-Q — cross-app cleanups | 2-3h total | misc |

**Total P0 + P1:** ~4-5 hours, ships in one PR.
**Total P2:** ~2.5 days, separate PRs per item.

---

## Verification checklist (run after each step)

- [ ] `npm run build:research` clean
- [ ] DevTools → Network → check no regressions (request count, timing)
- [ ] DevTools → Performance → cold reload, check Largest Contentful Paint
- [ ] Lighthouse score (Performance) before vs after
- [ ] Visual check: dark mode, day mode, cinema mode, mobile viewport all still render
- [ ] Console errors clean

---

## Target metrics

| Metric | Before | After P0+P1 | After P2 |
|--------|--------|-------------|----------|
| Cold TTI (fast 3G) | ~2.5s | ~1.8s | ~1.4s |
| Time-to-data-visible (horizontal bar) | ~3-4s | ~2s | ~1.8s |
| CSS bytes on first paint | ~1.0MB | ~600KB | ~250KB |
| LCP | ~1.8s | ~1.4s | ~1.0s |
| CLS | varies | <0.1 | <0.05 |

---

## Implementation log (2026-06-03 session)

All P0 (A-E) and P1 (F-J) shipped in one session. Build: clean (`npm run build:research` ✓ 50.25s).

### Files touched

```
apps/research/index.html                                  +6 lines  (P0-B preconnect)
apps/research/src/pages/home/components/
  welcome-page.jsx                                        ~40 lines (P0-A,C,D + P1-H)
  welcome-page.css                                        ~20 lines (P0-E animation, comment for P0-A)
  inline-horizontal-bar.jsx                               2 lines   (P0-C)
  inline-watchlist-panel.jsx                              4 lines   (P0-C)
  discovery-section.jsx                                   6 lines   (P0-C)
  token-card-popup.jsx                                    1 line    (P0-C)
  use-market-intelligence.js                              ~15 lines (P1-F)
apps/research/src/pages/liquidation-heatmap/components/
  use-real-heatmap.js                                     ~5 lines  (P1-J)
```

### Build chunks generated by the CSS split (P0-A win)

Before: 1 big welcome-page CSS chunk (everything concatenated).
After: 4 separate chunks, only the first is required on the default dark+desktop path:

```
welcome-page-okw68Qdl.css    338,154 B  always loaded (main)
welcome-page-BP1mOvMo.css    130,843 B  day-mode (lazy)
welcome-page-TcvK_vG-.css     80,240 B  cinema-mode (lazy)
welcome-page-D3741EFu.css     74,108 B  mobile (lazy)
```
**~285KB CSS removed from the default cold-load path.**

Plus new lazy chunks for P0-D:
```
heatmap-command-panel-*.css   19,701 B  lazy (heatmaps tab only)
heatmap-command-panel-*.js    12,756 B  lazy
DominanceChart-*.css           6,482 B  lazy (modal only)
DominanceChart-*.js            2,452 B  lazy
```

### Not committed

Per project rule "no commit/push/PR without explicit instruction" — all changes are working-tree only. Next steps (when ready):
1. `git status` to review
2. Visual smoke test in dev server (toggle day mode, cinema mode, mobile view, watchlist search, open heatmap tab)
3. Run `gh pr create` when ready

### Deferred (P2) — separate PRs

- K. Split welcome-page.css per tab (~1 day, -300KB cold)
- L. Lazy-load mobile components on desktop (~2h, -150KB desktop)
- M. Split welcome-page.jsx 2,305 lines (~1 day)
- N-Q. Cross-app cleanups
