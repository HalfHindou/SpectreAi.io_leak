# Spectre Codebase Census — April 12, 2026
# Prepared for production hardening (100K user target)

## Executive Summary

| Metric | Count |
|--------|-------|
| Total source files (src/ + server/ + api/) | ~1,100 |
| Total lines of code | ~491,000 (src/) + 13,312 (server/index.js) |
| Dead files (knip raw) | 654 (includes false positives from lazy-loaded pages) |
| **Confirmed dead files** | **74 files, ~15,800 lines** (verified: 0 imports static or dynamic) |
| Likely false positive (imported somewhere) | 43 files (lazy-loaded pages, sub-components with imports) |
| Unused npm dependencies | 12 prod + 7 dev |
| Circular dependencies (madge) | 0 |
| Orphan files (madge) | 29 (services, stores, utils — loaded at runtime not import) |
| Files over 500 lines (.jsx/.js) | 18 |
| Files over 300 lines (.css) | 40+ |
| Pages missing error boundaries | 46 of 49 (only 3 have them: you, research-zone, media-center) |
| Console.logs in src/ | 10 |
| Console.logs in server/ | 226 |
| Inline styles in src/ | 2,615 occurrences |
| Hardcoded localhost URLs in src/ | 4 |
| Spinner references | 86 |
| Images missing alt | 1 |
| Event listener adds vs removes | 438 vs 351 (87 potential leaks) |
| Files with fetch vs files with AbortController | 106 vs 131 |
| Server routes (GET/POST/USE) | 122 GET + 9 POST + 25 USE = 156 |
| Server index.js lines | 13,312 |
| Vercel functions | 14 |

---

## 1. Dead Code

### Knip Notes
Knip reports 654 "unused files" but many are false positives:
- **Lazy-loaded pages** (loaded via `React.lazy()` in App.jsx) show as unused because knip doesn't trace dynamic imports
- **Services** (coinGeckoApi, binanceApi, etc.) are imported dynamically or via other services
- **Stores** (Zustand) are imported in components knip can't trace
- **CSS files** aren't tracked by knip's JS resolver

**Truly dead files (confirmed by manual grep):** Need Wave 1 verification per file. Key candidates:
- `src/components/mobile-navigation.jsx` — likely replaced by newer mobile nav
- `src/components/mobile-subpage-header.jsx` — same
- `src/components/onboarding-popup.jsx` — may be disabled
- `src/contexts/DemoModeContext.jsx` — demo mode may be removed
- `src/hooks/useBinanceStream.js` — replaced by polling
- `src/hooks/useSwipeNavigation.js` — may be unused
- `src/pages/auth/index.jsx` — AuthGate replaced this
- `src/pages/pricing/index.jsx` — may be placeholder
- Several economic-calendar data files (mock data)

### Unused npm Dependencies (12 prod, 7 dev)

| Package | Location | Status |
|---------|----------|--------|
| html2canvas | research | Verify — may be used dynamically |
| @privy-io/server-auth | trading | Verify — may be server-side |
| @vercel/kv | trading | Likely dead |
| buffer | trading | Verify — Solana needs it |
| @reown/appkit-controllers | root | Likely dead (wallet connect remnant) |
| @solana-program/memo | root | Used by Privy (keep) |
| @solana-program/system | root | Verify — Solana transactions |
| @solana-program/token | root | Verify — token transfers |
| @solana/kit | root | Required by @solana-program/memo (keep) |
| @xyflow/react | root | Verify — may be used in x-intelligence |
| react-window | root | Likely dead (was for virtual lists) |
| x402 | root | Likely dead |

---

## 2. Monoliths (files over 500 lines, .jsx/.js only)

| File | Lines | Notes |
|------|-------|-------|
| trading-chart.jsx | 4,390 | DO NOT TOUCH — being replaced |
| bubbles-page.jsx | 2,513 | Canvas physics — hard to split |
| traders-corner/index.jsx | 2,172 | SPLIT TARGET — has clear sections |
| ai-charts-lab-page.jsx | 2,005 | Complex — needs plan |
| mockEvents.js | 1,981 | Data file — ok as-is |
| watchlists-page.jsx | 1,942 | SPLIT TARGET |
| data-tabs.jsx (token) | 1,898 | SPLIT TARGET |
| discovery-section.jsx | 1,852 | SPLIT TARGET |
| heatmaps-page.jsx | 1,805 | Canvas heavy |
| welcome-page.jsx | 1,789 | SPLIT TARGET |
| categories-page.jsx | 1,706 | SPLIT TARGET |
| useCodexData.js | 1,667 | Hook with 7 sub-hooks — candidate for split |
| website2/index.jsx | 1,644 | Landing page |
| header.jsx | 1,576 | Shared component |
| right-panel.jsx (token) | 1,571 | SPLIT TARGET |
| x-dash-page.jsx | 1,346 | SPLIT TARGET |
| x-bubbles-page.jsx | 1,329 | Canvas |
| left-panel.jsx (token) | 1,324 | SPLIT TARGET |

**Server monolith:** `packages/server/index.js` at 13,312 lines with 122 GET + 9 POST routes. Already has 22 route modules extracted — but 131 routes still inline.

---

## 3. Page Health Report

| Page | Lines | EB | Load | Day | Comps | Health |
|------|-------|----|------|-----|-------|--------|
| research-zone | 64 | YES | YES | NO | 20 | YELLOW |
| media-center | 55 | YES | YES | NO | 12 | YELLOW |
| you | 371 | YES | YES | NO | 3 | YELLOW |
| home | 74 | NO | YES | YES | 46 | RED |
| fear-greed | 29 | NO | YES | NO | 14 | RED |
| traders-corner | 2172 | NO | YES | NO | 4 | RED |
| tokenized-assets | 9 | NO | YES | NO | 15 | RED |
| intelligence | 689 | NO | YES | NO | 28 | RED |
| economic-calendar | 20 | NO | YES | NO | 44 | RED |
| ventures | 35 | NO | YES | NO | 7 | RED |
| private-markets | 14 | NO | YES | YES | 7 | RED |
| website2 | 1644 | NO | NO | NO | 2 | RED |
| website | 892 | NO | NO | NO | 1 | RED |
| pricing | 285 | NO | NO | NO | 0 | RED |
| (40 other pages) | various | NO | varies | NO | varies | RED |

**Only 3 pages have error boundaries.** 46 pages will white-screen on any JS error.

---

## 4. Production Hardening Gaps

### Missing Error Boundaries
46 of 49 pages have NO error boundary. A single uncaught error on any of these pages crashes the entire view.

### Console.logs
- src/: 10 (low — good)
- server/: 226 (expected for server-side debugging)

### Hardcoded Localhost URLs
4 files in src/ reference `localhost` directly.

### Inline Styles
2,615 `style={{}}` occurrences. Many are dynamic (canvas positioning, chart sizing) which are legitimate. Design system violations are a subset.

### Spinners
86 references to spinner-like patterns. Need manual review — some may be CSS class names for skeleton animations.

### Event Listener Leaks
438 addEventListener/setInterval/setTimeout calls vs 351 cleanup calls. ~87 potential leaks. Under sustained use (100K users keeping tabs open), these accumulate.

### Fetch Without Abort
106 files make fetch calls, 131 files use AbortController. Coverage is decent but gaps exist in page-level useEffects.

### Missing Alt Tags
1 image missing alt — very clean.

---

## 5. Server Anatomy

| Domain | Inline Routes | Extracted Module | Status |
|--------|--------------|-----------------|--------|
| Crypto/CoinGecko | ~15 | No | INLINE |
| Binance | ~8 | No | INLINE |
| Stocks/Yahoo | ~12 | No | INLINE |
| Derivatives | ~5 | No | INLINE |
| CoinGlass | ~3 | No | INLINE |
| DexScreener | ~4 | No | INLINE |
| Polymarket | ~6 | No | INLINE |
| X-Dash | ~8 | routes/x-dash.js | PARTIAL |
| X-Beta | ~3 | routes/x-beta.js | EXTRACTED |
| Intelligence | ~8 | routes/intelligence.js | EXTRACTED |
| Monarch AI | ~3 | routes/monarch-chat.js | EXTRACTED |
| Calendar | ~5 | routes/calendar.js | EXTRACTED |
| RWA | ~6 | routes/rwa.js | EXTRACTED |
| Accelerators | ~3 | routes/accelerators.js | EXTRACTED |
| Swap | ~4 | routes/swap.js | EXTRACTED |
| Onchain | ~5 | routes/onchain.js | EXTRACTED |
| Private Markets | ~8 | routes/private-markets.js | EXTRACTED |
| User/Admin | ~6 | routes/users.js + admin.js | EXTRACTED |
| Media | ~5 | routes/media.js | EXTRACTED |
| SEO/OG | ~3 | routes/seo.js | EXTRACTED |
| Misc (weather, ambient, etc.) | ~10 | No | INLINE |

~60 routes still inline in index.js. The rest (~70) are in route modules.

---

## 6. Vercel Functions Health

| Function | Lines | Try/Catch | CORS | Timeout | Health |
|----------|-------|-----------|------|---------|--------|
| codex.js | 1,424 | 11 | 4 | 0 | YELLOW (no timeout) |
| stocks.js | 466 | 13 | 2 | 13 | GREEN |
| token-resolve.js | 199 | 17 | 3 | 1 | GREEN |
| binance-ticker.js | 127 | 4 | 1 | 1 | GREEN |
| img-proxy.js | 82 | 2 | 3 | 1 | GREEN |
| cg-proxy.js | 62 | 1 | 3 | 0 | YELLOW (no timeout) |
| market-api.js | 29 | 0 | 0 | 0 | YELLOW (delegates to handlers) |
| trade-api.js | 25 | 0 | 0 | 0 | YELLOW (delegates to handlers) |
| account-api.js | 25 | 0 | 0 | 0 | YELLOW (delegates to handlers) |
| intel-api.js | 23 | 0 | 0 | 0 | YELLOW (delegates to handlers) |
| news-api.js | 23 | 0 | 0 | 0 | YELLOW (delegates to handlers) |
| data-api.js | 22 | 0 | 0 | 0 | YELLOW (delegates to handlers) |
| media-api.js | 21 | 0 | 0 | 0 | YELLOW (delegates to handlers) |
| social-api.js | 10 | 0 | 0 | 0 | YELLOW (delegates to handlers) |

Router files (market-api, trade-api, etc.) delegate to handler files which DO have try/catch and CORS. The routers themselves are thin dispatchers — acceptable.

`codex.js` at 1,424 lines is the largest function and lacks request timeouts.

---

## 7. Traders Corner Anatomy (2,172 lines)

The file is a single default export with ~50 useState calls, ~15 useEffect hooks, and multiple inline sub-components. Natural extraction boundaries:

| Section | Approx Lines | Can Extract | Dependencies |
|---------|-------------|-------------|--------------|
| Imports + constants | 1-30 | No | — |
| FundingBars (inline component) | 315-370 | YES | data, height props |
| Spark (inline component) | ~80 lines | YES | data, color, w, h props |
| LiqTreemap (inline component) | ~100 lines | YES | data, colors props |
| CoinRow (inline component) | ~80 lines | YES | coin data, callbacks |
| Hero cards (OI, Funding, Liq) | ~100 lines | YES | state values |
| Rekt grid (1h/4h/12h/24h) | ~50 lines | YES | liqWindows state |
| Data strip (BTC.D, ETH.D, etc.) | ~50 lines | YES | dom, alt, options state |
| OI Treemap section | ~100 lines | YES | coins, selected state |
| Funding Rates section | ~80 lines | YES | funding, fundingHistory |
| Chart section | ~200 lines | PARTIAL | symbol, exchange, many callbacks |
| Widget area | ~300 lines | YES | widget state |
| Main layout / state | ~500 lines | NO (orchestrator) | — |

---

## 8. Duplicate Patterns

### Format Functions
Multiple pages have their own `formatValue`, `fmtK`, `fmtPrice` functions. Should consolidate into `src/lib/formatters.js` or use `useCurrency()` consistently.

### Fetch Wrappers  
Most services use the `_cache` + `_inflight` dedup pattern from fearGreedApi.js. Some older services (coinGeckoApi, cryptoNewsApi) use different patterns. Not urgent to consolidate but worth noting.

---

## 9. Surgery Plan (recommended wave order)

### Wave 1: Zero-risk deletions
- Verify and delete truly dead files from knip report (estimate: 20-40 files after false positive filtering)
- Remove confirmed unused npm deps (estimate: 4-6 packages)

### Wave 2: Production hardening
- Create SectionErrorBoundary component
- Wrap all 46 unprotected pages (one commit per page)
- Remove 10 console.logs from src/
- Fix 4 hardcoded localhost URLs

### Wave 3: Page extraction (monolith splits)
- Start with traders-corner/index.jsx (clear section boundaries)
- Then discovery-section.jsx, watchlists-page.jsx, welcome-page.jsx

### Wave 4: Dedup pass
- Consolidate format functions
- Standardize fetch patterns in remaining services

### Wave 5: Design system compliance
- Audit 86 spinner references (replace with skeleton shimmers)
- Flag worst inline style offenders

### Wave 6: Performance
- Fix ~87 event listener leak candidates
- Add AbortController to page-level fetches

### Wave 7: Backend surgery
- Extract remaining ~60 inline routes from server/index.js into route modules
- Harden Vercel functions (add timeouts to codex.js, cg-proxy.js)
