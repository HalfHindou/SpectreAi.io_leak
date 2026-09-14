---
paths:
  - "apps/*/src/components/trading-chart.jsx"
  - "apps/*/src/components/TradingChart.jsx"
  - "apps/*/src/components/TradingViewAdvanced.jsx"
  - "apps/*/api/**"
  - "apps/*/src/hooks/codex/**"
  - "packages/server/lib/token-registry.js"
---

# Charts System - Comprehensive Audit & Upgrade Plan

**Created:** 2026-04-05
**Status:** AUDIT COMPLETE - Execution pending
**Priority:** P0 - The single most important upgrade for the research app

---

## A. Executive Summary

Charts are broken, slow, and inconsistent across the app. This document is the single source of truth for every chart implementation, its current state, known issues, and the fix plan.

**Scale:** 52+ files with canvas/chart code, 4 chart technologies, 3 data pipelines, across 2 apps.

---

## B. Chart Technology Inventory

| Technology | Where Used | Status |
|-----------|-----------|--------|
| TradingView Advanced (self-hosted charting_library v27) | Research: Traders Corner main chart, Research Zone | **BROKEN** - bad data spikes, slow loading, aggressive pre-loading |
| TradingView Lightweight Charts | Trading app: TradingChart.jsx | Working but limited |
| TradingView iframe embed (widgetembed) | Traders Corner widget (W-010) | Works but no data control |
| Custom canvas (2D context) | 52+ files: sparklines, heatmaps, liquidation charts, bubbles, treemaps, donut charts, gauges | Mixed - some working, some broken |
| Recharts | AI Charts Lab, X-Dash, RWA, Stickers | Working |

---

## C. Chart Inventory by Location

### C1. TradingView Advanced (Self-Hosted) - HIGH PRIORITY

**File:** `apps/research/src/components/TradingViewAdvanced.jsx` (636 lines)
**Used by:** Traders Corner (`index.jsx` L1862), Research Zone (`research-zone-lite.jsx`)

**How it works:**
```
TradingViewAdvanced component
  -> createDatafeed() - custom IExternalDatafeed implementation
  -> fetchBars() -> GET /api/tradingview/udf/history
  -> Server: /api/tradingview/udf/history (L5461)
    -> Stocks: Yahoo Finance klines
    -> Crypto: /api/bars -> Codex getBars + Binance klines
```

**Known Issues:**
1. **BAD DATA SPIKES** - Chart shows wild price jumps (67K to 160K+, drops to near 0). The `/api/bars` endpoint merges Codex and Binance data, but Codex returns sparse DEX data with anomalous OHLCV values for some tokens
2. **Aggressive pre-loading** - On first load, fetches 20 chunks of 500 bars each in waves of 5, totaling up to 10,000 bars. Slams the server with parallel requests
3. **Scroll-to-load uses `setSymbol()`** - Forces a full widget reload instead of using `resetData()` properly
4. **Bad data detection too permissive** - Only checks last 30 bars for anomalies, allows spikes within recent bars if median looks OK
5. **15s polling** - Polls every 15s for live updates; not using WebSocket
6. **No loading shimmer** - Just shows an empty container while data loads
7. **`isDev` hardcodes localhost:3001** for API_BASE - breaks in worktree with different ports

**Timeframes:** 1S, 1M, 5M, 15M, 1H, 4H, 1D, 1W (via TIMEFRAME_TO_RESOLUTION map)

### C2. Server UDF History Endpoint

**File:** `packages/server/index.js` L5461-5560
**Route:** `GET /api/tradingview/udf/history`

**How it works:**
- Stocks: Yahoo Finance klines (with circuit breaker)
- Crypto: proxies to self at `/api/bars` which calls Codex GraphQL `getBars` + Binance klines

**Issues:**
1. **Crypto bars go through internal self-call** (`http://localhost:${PORT}/api/bars`) - adds latency
2. **No outlier filtering** - Only filters null/zero OHLC, doesn't detect price spikes
3. **Cache key includes exact from/to** - Similar time ranges don't hit cache
4. **No Binance klines fallback for major coins** - Only uses Codex which has worse data for BTC/ETH

### C3. Server /api/bars Endpoint

**Must also audit** - this is the actual data source for crypto OHLCV:
- Codex GraphQL `getBars` query for token OHLCV
- Binance klines as primary source for major tokens
- Data quality filtering happens here

### C4. Trading App - TradingChart.jsx

**File:** `apps/trading/src/components/TradingChart.jsx`
**Library:** TradingView Lightweight Charts (npm)
**Data:** Codex getBars via `useCodexData` hook

**Issues:**
1. Uses Lightweight Charts v4 - separate from research app's Advanced Charts
2. Different data pipeline than research app
3. No data quality filtering
4. HoldersChart.jsx also uses createChart

### C5. Research App - trading-chart.jsx (Shared Component)

**File:** `apps/research/src/components/trading-chart.jsx`
**Used by:** Research Zone, AI Charts, other pages
**Library:** Custom canvas (NOT TradingView)

**Issues:**
1. Canvas-based custom chart - not a standard charting library
2. Also contains xBubbles/physics simulation code (unrelated to charts)
3. Complex file doing too many things

### C6. Traders Corner - Chart Widgets

| Widget | File | Type | Data Source | Issues |
|--------|------|------|-------------|--------|
| TradingViewChart (W-010) | `widgets/TradingViewChart.jsx` | TradingView iframe embed | `s.tradingview.com/widgetembed` | No data control, relies on TV's data |
| CVDChart | `widgets/CVDChart.jsx` | Custom canvas | `tradersCornerApi` | Needs CORS proxy data |
| OrderBookDepth | `widgets/OrderBookDepth.jsx` | Custom canvas | `tradersCornerApi` | Needs CORS proxy data |
| LiquidationBars | `widgets/LiquidationBars.jsx` | Custom canvas | `tradersCornerApi` | Needs CORS proxy data |
| LiquidationBubbles | `widgets/LiquidationBubbles.jsx` | Custom canvas | `tradersCornerApi` | Needs CORS proxy data |
| LiquidationTimeline | `widgets/LiquidationTimeline.jsx` | Custom canvas | `tradersCornerApi` | Needs CORS proxy data |
| Spark (inline) | `index.jsx` ~L1500 | Custom canvas sparkline | tradersCornerApi klines | Inline component, no file |
| LiqTreemap (inline) | `index.jsx` ~L1450 | Custom canvas treemap | tradersCornerApi OI data | Inline component, no file |

### C7. Sparklines (52+ canvas instances)

Custom `<canvas>` sparklines appear across the entire app:

| Location | File | Data Source |
|----------|------|-------------|
| Welcome page token cards | `home/components/` (multiple) | CoinGecko `sparkline_in_7d.price[]` |
| Discovery panel | `home/components/discovery-section.jsx` | CoinGecko sparklines |
| Watchlist strip | `home/components/mobile-watchlist-strip.jsx` | CoinGecko sparklines |
| Mobile token rows | `home/components/mobile-token-list.jsx` | CoinGecko sparklines |
| Categories page | `categories/` | CoinGecko sparklines |
| Heatmaps page | `heatmaps/` | CoinGecko sparklines |
| Token page data tabs | `token/components/data-tabs.jsx` | CoinGecko sparklines |
| User dashboard | `user-dashboard/components/` | CoinGecko sparklines |

**Pattern:** 168-point hourly data from CoinGecko, drawn as single-stroke line path. Color from `--bull`/`--bear` based on 7d change direction.

### C8. Visualization Pages (Custom Canvas)

| Page | File(s) | Visualization | Issues |
|------|---------|---------------|--------|
| Bubbles | `bubbles/components/bubbles-page.jsx` | Force-directed bubble chart | Canvas-based, GPU-intensive |
| Liquidation Heatmap | `liquidation-heatmap/components/` (5 files) | Heatmap, levels, 3D, zones views | Multiple canvas implementations |
| Heatmaps | `heatmaps/components/` | Treemap, grid, CoinGeckoPriceChart | FloatingChartWindow uses TV |
| Fear & Greed | `fear-greed/` | Gauge (SVG), history chart | Custom SVG gauge |
| X-Intelligence | `x-intelligence/components/GraphCanvas.jsx` | Force-directed social graph | Heavy canvas |
| X-Beta | `x-beta/components/` | RadarDashboard, VelocityBubbles, NetworkMap | Multiple canvas visualizations |

### C9. Recharts Usage

| Page | File | Charts |
|------|------|--------|
| AI Charts Lab | `ai-charts-lab/components/ai-charts-lab-page.jsx` | AreaChart, LineChart, BarChart |
| X-Dashboard | `x-dash/components/x-dash-page.jsx` | ResponsiveContainer charts |
| RWA/Tokenized Assets | `tokenized-assets/components/rwa-bar-chart.jsx` | Bar charts |
| Stickers | `you/studio/stickers/core/LineChart.jsx` | Decorative charts |

### C10. Other Chart Components

| Component | File | Type |
|-----------|------|------|
| Sector Compare Chart | `components/sector-compare-chart.jsx` | Canvas line chart |
| Monarch Chart | `components/monarch/monarch-chart.jsx` | Canvas chart in AI chat |
| Token Storybook | `components/token-storybook.jsx` | Canvas sparklines |
| RWA Interactive Chart | `tokenized-assets/components/rwa-interactive-chart.jsx` | Canvas |
| RWA Donut Chart | `tokenized-assets/components/rwa-donut-chart.jsx` | Canvas donut |
| Compare Charts | `heatmaps/components/CompareOverlayChart.jsx`, `ai-charts-lab/components/compare-chart.jsx` | Canvas |

---

## D. Data Pipeline Audit

### D1. Primary Pipeline: Codex GraphQL -> getBars

```
Frontend hook (useTokenChart / useCodexData)
  -> codexApi.getBars(address, networkId, resolution, from, to)
  -> POST /api/codex { action: 'getBars', ... }
  -> Server: Codex GraphQL getBars query
  -> Returns: { bars: [{ t, o, h, l, c, v }] }
```

**Available resolutions (Codex):** 1, 5, 15, 30, 60, 240, 720, 1D
**Issues:**
- Codex returns DEX-level data - sparse for low-liquidity tokens
- Price spikes from low-liquidity trades on DEXes
- No built-in data quality filtering
- Requires token address + networkId (not just symbol)

### D2. Binance Klines Pipeline

```
Server: /api/bars (when token has Binance pair)
  -> Binance klines API: /api/v3/klines?symbol=BTCUSDT&interval=1h
  -> Returns clean OHLCV data for major tokens
```

**Available intervals:** 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
**Issues:**
- Only works for tokens with Binance spot pairs
- Not used as primary source for TradingView Advanced charts (goes through Codex first)
- Should be the PRIMARY source for BTC, ETH, SOL etc. but isn't always

### D3. TradingView UDF Pipeline

```
TradingViewAdvanced datafeed
  -> GET /api/tradingview/udf/history?symbol=BTC&resolution=60
  -> Server: /api/tradingview/udf/history
    -> Self-calls /api/bars (crypto)
    -> Yahoo Finance (stocks)
  -> Returns UDF format: { s: 'ok', t: [], o: [], h: [], l: [], c: [], v: [] }
```

**Issues:**
- Internal self-call adds latency
- No direct Binance klines path for major coins
- Cache key too granular (exact from/to)

### D4. CoinGecko Sparkline Pipeline

```
coinGeckoApi.getTopCoins() or individual coin data
  -> CoinGecko /coins/markets?sparkline=true
  -> Returns sparkline_in_7d.price[] (168 points, hourly)
```

**Issues:**
- Only 7-day data, hourly resolution
- No zoom/pan - static sparklines only
- Sometimes returns null for low-cap tokens

### D5. Traders Corner Data Pipeline

```
tradersCornerApi.js
  -> /api/derivatives/{exchange}/* (proxied to exchange APIs)
  -> Binance Futures, Bybit, OKX, Deribit
  -> Returns: klines, funding rates, OI, liquidations, order books
```

**Issues:**
- Recently fixed CORS issues (proxy added)
- Some symbols need special mapping (PEPE -> 1000PEPEUSDT)
- No WebSocket for real-time data

---

## E. Critical Bugs (Fix First)

### E1. TradingView Advanced - Bad Data Spikes (P0)

**Symptom:** Chart shows impossible price spikes (e.g., BTC jumps from 67K to 160K+ then back)
**Root cause:** Codex returns DEX data with anomalous trades. The `/api/bars` endpoint doesn't filter outliers.
**Fix plan:**
1. For major tokens (BTC, ETH, SOL, etc.), use Binance klines as PRIMARY source in `/api/tradingview/udf/history`
2. Add outlier detection in server's `/api/bars`: if any bar's high/low exceeds 3x the median of surrounding bars, clamp it
3. Add a moving-window filter in the datafeed's `fetchBars()`: compare each bar against its neighbors
4. Improve the `isBadData` check in TradingViewAdvanced.jsx to detect per-bar anomalies, not just aggregate

### E2. TradingView Advanced - Slow Initial Load (P0)

**Symptom:** Chart takes 5-10+ seconds to load due to aggressive pre-loading
**Root cause:** Fetches 20 chunks of 500 bars (10,000 total) in parallel waves before showing anything
**Fix plan:**
1. Show the first batch of bars IMMEDIATELY (1 fetch, ~500 bars)
2. Pre-load additional history in the BACKGROUND after the chart is visible
3. Use `requestIdleCallback` for background pre-loading
4. Reduce initial parallel waves from 20 chunks to 5 max
5. Add shimmer loading state to the chart container

### E3. isDev Hardcoded Port (P1)

**Symptom:** TradingViewAdvanced.jsx hardcodes `http://localhost:3001` for dev mode
**Root cause:** `const API_BASE = isDev ? 'http://localhost:3001' : ''`
**Fix plan:** Use empty string for both (Vite proxy handles routing). Or read from `__SERVER_PORT__` define.

---

## F. Upgrade Plan - Phased Execution

### Phase 1: Data Quality (P0 - Do First)

**Goal:** Clean data flowing to all charts. No spikes, no gaps, no stale data.

| Task | Files | Priority |
|------|-------|----------|
| Add Binance klines as primary source for major tokens in UDF history | `packages/server/index.js` | P0 |
| Add outlier detection/clamping in `/api/bars` | `packages/server/index.js` | P0 |
| Fix isDev hardcoded port in TradingViewAdvanced | `components/TradingViewAdvanced.jsx` | P0 |
| Add per-bar anomaly filtering in datafeed | `components/TradingViewAdvanced.jsx` | P0 |
| Fix PEPE -> 1000PEPEUSDT mapping in token-registry | `packages/server/lib/token-registry.js` | P1 |

### Phase 2: Performance (P0 - Do Second)

**Goal:** Charts load in under 2 seconds. No UI freezes.

| Task | Files | Priority |
|------|-------|----------|
| Show first bars immediately, pre-load in background | `components/TradingViewAdvanced.jsx` | P0 |
| Reduce pre-load from 20 chunks to 5 max | `components/TradingViewAdvanced.jsx` | P0 |
| Add shimmer loading state to chart containers | `components/TradingViewAdvanced.jsx`, pages | P0 |
| Debounce timeframe switching (prevent rapid-fire fetches) | `components/TradingViewAdvanced.jsx` | P1 |
| Add server-side bar aggregation caching | `packages/server/index.js` | P1 |
| Eliminate internal self-call in UDF history (inline the logic) | `packages/server/index.js` | P1 |

### Phase 3: Chart UX Polish (P1)

**Goal:** Professional trading-grade chart experience.

| Task | Files | Priority |
|------|-------|----------|
| Add volume overlay styling (scale to bottom 25%) | `components/TradingViewAdvanced.jsx` | P1 |
| Add proper crosshair formatting (price decimals, date format) | `components/TradingViewAdvanced.jsx` | P1 |
| Fix scroll-to-load (use resetData instead of setSymbol) | `components/TradingViewAdvanced.jsx` | P1 |
| Add chart type toggle (candlestick/line/area) | UI addition | P1 |
| Add drawing tools persistence (localStorage) | TradingView config | P2 |
| Add indicator presets (RSI, MACD, Bollinger) | TradingView config | P2 |

### Phase 4: Sparkline Upgrade (P1)

**Goal:** Consistent, fast sparklines everywhere.

| Task | Files | Priority |
|------|-------|----------|
| Create shared `<Sparkline>` component | New: `components/sparkline.jsx` | P1 |
| Standardize sparkline rendering across 52+ files | All sparkline locations | P1 |
| Add hover tooltip to sparklines | `components/sparkline.jsx` | P2 |
| Support 24h + 7d + 30d sparkline data | Data pipeline change | P2 |

### Phase 5: Traders Corner Widgets (P1)

**Goal:** All Traders Corner chart widgets render real data correctly.

| Task | Files | Priority |
|------|-------|----------|
| Audit all widget data flows post-CORS fix | `widgets/*.jsx` | P1 |
| CVDChart - verify real CVD data rendering | `widgets/CVDChart.jsx` | P1 |
| OrderBookDepth - verify real depth data | `widgets/OrderBookDepth.jsx` | P1 |
| LiquidationBars/Bubbles/Timeline - verify | `widgets/Liquidation*.jsx` | P1 |
| Add consistent shimmer states to all widgets | All widgets | P1 |

### Phase 6: Trading App Charts (P2)

**Goal:** Trading app charts match research app quality.

| Task | Files | Priority |
|------|-------|----------|
| Upgrade TradingChart.jsx to use TradingView Advanced | `apps/trading/src/components/TradingChart.jsx` | P2 |
| Share the TradingViewAdvanced component via package or copy | Architecture decision | P2 |
| Add data quality filtering to trading app pipeline | `apps/trading/src/hooks/useCodexData.js` | P2 |
| HoldersChart.jsx audit and fix | `apps/trading/src/components/HoldersChart.jsx` | P2 |

### Phase 7: Visualization Pages (P2)

**Goal:** All canvas visualizations perform well and look polished.

| Task | Files | Priority |
|------|-------|----------|
| Bubbles page performance audit | `bubbles/components/bubbles-page.jsx` | P2 |
| Liquidation Heatmap all views audit | `liquidation-heatmap/components/*.js` | P2 |
| X-Intelligence graph canvas audit | `x-intelligence/components/GraphCanvas.jsx` | P2 |
| X-Beta radar/velocity/network audit | `x-beta/components/*.jsx` | P2 |

---

## G. Architecture Decisions

### G1. TradingView Advanced vs Lightweight Charts

**Decision:** Keep TradingView Advanced (self-hosted charting_library) as the primary chart for Research Zone and Traders Corner. It provides the full trading experience (drawing tools, indicators, studies).

**Lightweight Charts** stays in the trading app for now (simpler, lighter). Phase 6 may upgrade it.

### G2. Data Source Priority for Major Tokens

```
BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, DOT, ARB:
  PRIMARY: Binance klines (clean, reliable, real-time)
  FALLBACK: Codex getBars (DEX data)

All other tokens:
  PRIMARY: Codex getBars (only available source)
  FILTER: Outlier detection + clamping
```

### G3. Shared Sparkline Component

Create one `<Sparkline>` component used everywhere instead of 52+ inline canvas implementations. Props: `data`, `width`, `height`, `color`, `strokeWidth`, `filled`.

### G4. Chart Loading States

All charts must show shimmer skeleton matching the chart area dimensions. No spinners, no "Loading..." text, no empty containers.

---

## H. File Map

```
CHART DATA PIPELINE:
  packages/server/index.js
    L5304-5329  /api/tradingview/udf/config, /time
    L5330-5404  /api/tradingview/udf/symbols
    L5405-5460  /api/tradingview/udf/search
    L5461-5560  /api/tradingview/udf/history (THE critical endpoint)
    /api/bars    (Codex + Binance OHLCV - need to find line number)

  apps/research/api/_lib/handlers/tradingview-udf.js (prod serverless)

CHART COMPONENTS:
  apps/research/src/components/TradingViewAdvanced.jsx (636 lines - MAIN CHART)
  apps/research/src/components/trading-chart.jsx (custom canvas chart)
  apps/research/src/components/trading-chart.css
  apps/research/src/components/sector-compare-chart.jsx
  apps/research/src/components/monarch/monarch-chart.jsx
  apps/research/src/components/token-storybook.jsx

  apps/trading/src/components/TradingChart.jsx (Lightweight Charts)
  apps/trading/src/components/TradingChart.css
  apps/trading/src/components/HoldersChart.jsx

TRADERS CORNER WIDGETS:
  apps/research/src/pages/traders-corner/widgets/TradingViewChart.jsx (iframe)
  apps/research/src/pages/traders-corner/widgets/CVDChart.jsx
  apps/research/src/pages/traders-corner/widgets/OrderBookDepth.jsx
  apps/research/src/pages/traders-corner/widgets/LiquidationBars.jsx
  apps/research/src/pages/traders-corner/widgets/LiquidationBubbles.jsx
  apps/research/src/pages/traders-corner/widgets/LiquidationTimeline.jsx

VISUALIZATION PAGES:
  apps/research/src/pages/bubbles/components/bubbles-page.jsx
  apps/research/src/pages/liquidation-heatmap/components/*.js (5 files)
  apps/research/src/pages/heatmaps/components/*.jsx (3+ files)
  apps/research/src/pages/fear-greed/ (gauge + history)
  apps/research/src/pages/x-intelligence/components/GraphCanvas.jsx
  apps/research/src/pages/x-beta/components/*.jsx (4 files)

RECHARTS:
  apps/research/src/pages/ai-charts-lab/components/ai-charts-lab-page.jsx
  apps/research/src/pages/x-dash/components/x-dash-page.jsx
  apps/research/src/pages/tokenized-assets/components/rwa-bar-chart.jsx
  apps/research/src/pages/you/studio/stickers/core/LineChart.jsx
```

---

## I1c. 🪤 A CSS-fullscreen chart overlay needs the ANCESTORS unwound, not just `position: fixed`

**Measured 2026-07-29** while adding the fullscreen button to the four
liquidation-heatmap views (`use-chart-fullscreen.js`). Charts use the browser
Fullscreen API first, which promotes the element to the **top layer** and is
immune to everything below — but the CSS fallback (iOS Safari on non-video
elements, installed PWAs, any tab where `requestFullscreen` rejects) is a plain
`position: fixed; inset: 0`, and on this page that landed the overlay at
**(244, 337)** with the app header and sidebar painted on top of it.

Two independent ancestor problems, both of which must be unwound for the
duration and restored on exit:

1. **Containing block.** `position: fixed` anchors to the nearest ancestor with
   `transform` / `filter` / `perspective` / `will-change` / `backdrop-filter` —
   not the viewport. `.page-layout` has `will-change: scroll-position` (it is
   only neutralized under `@media (max-width: 768px)`, with a comment saying
   exactly why), and `.liqp` + `.liqp-heatmap-section` run `liqpFadeIn` with
   `animation-fill-mode: both`, so the final keyframe `transform: translateY(0)`
   sticks forever — and a **zero transform still creates a containing block**.
   ⚠️ Overriding the property is NOT enough: an element with an animation whose
   keyframes touch `transform`/`filter` keeps the containing block even when the
   computed value reads `none`. With `transform: none !important` applied the
   overlay was still at (244, 337); adding `animation: none !important` snapped
   it to (0, 0) and `offsetParent` went null. Detect via
   `el.getAnimations()` → `effect.getKeyframes()` and only suspend animations
   whose keyframes actually list a containing-block property (an opacity-only
   pulse elsewhere must keep running).
2. **Stacking context.** `.app-main-content` is `position: relative; z-index: 1`,
   so an overlay inside it resolves its z-index *within* that context — `z-index:
   2000` still painted under `.header` (300) and `.navigation-sidebar` (101). No
   z-index on the overlay itself can fix this; the containing context has to be
   lifted (or the overlay portaled out).

Verify with `elementFromPoint(innerWidth/2, 40)` — it must return the chart, not
the header — and by re-measuring the wrapper rect (`{t:0,l:0}` + full viewport).
On exit, assert the ancestors' inline styles are gone and the entrance animation
is back; the fix restores `el.style.cssText` wholesale for that reason.

🪤 A trusted click from CDP/automation still gets `requestFullscreen` **rejected**
(`document.fullscreenElement` stays null), so an automated tab always exercises
the CSS fallback. Useful for testing that path — and a reminder that you cannot
verify the browser-API path this way.
🪤 `await new Promise(r => requestAnimationFrame(r))` **hangs the renderer** in a
Chrome-MCP tab (rAF is frozen while `document.hidden`) and the CDP call dies at
the 45s timeout. Use `setTimeout` for waits in that environment.

---

## I. Success Criteria

1. **BTC 1H chart loads in < 2 seconds** with clean data, no spikes
2. **All timeframes work** (1M, 5M, 15M, 1H, 4H, 1D, 1W) with correct data
3. **No hardcoded mock data** anywhere in chart code
4. **Shimmer loading states** on every chart while data loads
5. **Sparklines render consistently** across all 52+ locations
6. **Traders Corner widgets** show real exchange data (not mocked)
7. **Timeframe switching** is instant (< 500ms perceived)
8. **Charts handle resize** properly (no stretching, no overflow)
9. **Day mode** works on all charts
10. **Mobile** charts are responsive and touch-friendly

---

## I1b. 🪤 A canvas whose CLICK mutates state will mutate on every touch

**Measured 2026-07-29** on the liquidation heatmap (`heatmap-view.jsx`). Its
`onMouseUp` treated a zero-distance down→up as a click and pinned a price level.
After a touch, the browser replays the gesture as **compatibility mouse events**
(mousemove → mousedown → mouseup → click, all at the lift point) — so on a phone
every tap AND every pan dropped a pin, and the chart filled with a stack of pin
labels nobody asked for. `touch-action: none` does not suppress this; it removes
the scroll that would otherwise cancel the replay, which makes it *more* likely.
`preventDefault()` in a React `onTouchStart` can't stop it either — React binds
touch listeners passively.

Rules for any canvas that mutates on click:
- Stamp `lastTouchRef` in every touch handler and early-return from ALL mouse
  handlers within ~700ms of a touch. A timestamp, not a device sniff — hybrid
  laptops must keep real click-to-mutate.
- Mutating gestures on touch go on **long-press** (≥500ms, cancel on >8px move),
  never on tap. Tap has to stay the inspect gesture — it is also how you find out
  the chart doesn't scroll.
- Ship an escape hatch (a clear-all control) for anything a gesture can create.
- Container-width tier classes (`--md/--sm/--xs`) are mutually exclusive: rules
  written only on `--md` do NOT apply at `--xs`, so the tightest layout silently
  gets the LEAST trimming. Repeat each trim on every narrower tier.
- Past a point, trimming labels stops helping: eight controls wrapping over four
  rows cost ~200px above a 440px chart. The phone tier keeps symbol + timeframe
  inline and moves the rest into `.liqp-hm-sheet` (`heatmap-view.jsx`) — one
  control row + magnets, ~87px. Anchor such a sheet to the PANEL by default
  (it also renders in a narrow Command Center card) and promote it to
  `position: fixed` above the bottom nav only under `@media (max-width: 768px)`.

## I2. 🪤 Canvas DPR auditing — headless Chromium LIES about device-pixel-content-box

**Measured 2026-07-29.** Auditing canvas sharpness at `deviceScaleFactor: 2` gives
a FALSE "renders at 1x" verdict for `lightweight-charts` (and anything else built
on `fancy-canvas`), because headless reports the wrong units:

```
headless=true   devicePixelContentBoxSize.inlineSize = 300   (WRONG)  cssInline 300
headless=false  devicePixelContentBoxSize.inlineSize = 600   (right)  cssInline 300
```

LWC v5 sizes its bitmap from exactly that value, so in **headless only** it comes
out 1x. Verified in a headed browser: the Traders Corner Chart tab canvases are
780 css -> 1560 backing, i.e. correct. **Do not "fix" this** — forcing a DPR
multiply would double-scale and break a working chart in real browsers.

Rules for this class of audit:
- Charts that read `window.devicePixelRatio` themselves (our own canvases: liq
  heatmap/map/levels/zones/magnets, tc-treemap, OI chart) DO measure correctly in
  headless — `devicePixelRatio` is honoured there. Those results are trustworthy.
- Any third-party canvas sized via a ResizeObserver `device-pixel-content-box`
  must be confirmed with `chromium.launch({ headless: false })` before you believe
  a blur verdict.
- `ParticleBackground` is dpr 1 **on purpose** (2026-07-07 thermal fix). Not a bug.

Related real bug found in the same pass (fixed, `0664f995`): a canvas sized from a
`dims` STATE whose ResizeObserver never attached, because the component
early-returned a different container carrying no ref while loading and the effect's
dep array never re-ran it. Backing store froze at the seed width and stretched 1.4x
on Retina. **Measure the canvas rect live at draw time; never size from state.**

Same family, 2026-07-29 (`heatmap-view.jsx`): the RO was attached correctly, but
`dims` seeds at `{800,400}` and nothing measured until the observer's FIRST
delivery — which is tied to the rendering steps, so **in a hidden/automated tab it
never arrives** and the canvas stays 800px wide, CSS-stretched to the real width.
Fixed by reading `getBoundingClientRect()` synchronously inside the RO effect
before `observe()`. Two lessons: seed dims from the live rect, and treat any
RO-driven measurement in a Chrome-MCP tab as unverifiable (`document.hidden` is
true there — the same freeze that kills rAF).

## I3. LITE Research + TradingView on ON-CHAIN tokens (fixed 2026-08-20)

Founder report: "in lite, for onchain tokens the TradingView chart works bad, for
some no info, timeframe different." Three independent defects, all measured on
LICKINGCAT (`EjD5Y9NVhXmtEqU7wYvAyZvDWZFQeEuHXFatJmTbpump`, Solana).

**1. The HERO price was wrong, not the chart.** The screenshot's contradiction
($0.00002075 in the hero vs 0.000315 on the chart) was the hero lying. The box's
symbol-keyed `/v1/prices` row for this contract read **2.0748e-5** with
`market_cap: 0` and a FRESH `updated_at`, while GeckoTerminal and Codex - both
by contract - said **3.10e-4**. Its `/v1/prices/{sym}/ohlcv` is 10x off too and
stale by 11 days. So the box's on-chain price for barely-tracked caps is simply
wrong, and `updated_at` will not catch it.
The old GT patch in `lite-research.jsx` only overrode price when the CONTRACT
mismatched, so a same-contract wrong price stood. Now a >1.5x disagreement with
the live pool is treated exactly like a contract mismatch: the whole row is
distrusted (`mergeGtStats`). Also fixed a race - the box loader's `setStats` was
an unconditional overwrite that discarded a GT patch which had landed first.
⚠️ This is a data-lane bug too - add it to `data-lane-fixes-for-alaa.md` §1 if
it recurs on other contracts.

**2. `GT_PRICE` could be a DIFFERENT token's price.** `loadGtPool` picked the
deepest pool by reserve across ALL pools and read `base_token_price_usd`.
lickingcat's pool list contains a `CATE / lickingcat` pair - had that been the
deepest, the hero would have printed CATE. Base-side pools now win outright; a
quote-side pool is a last resort and carries `side` so the OHLCV call can pass
`&token=quote` (GT's pool OHLCV prices the BASE token by default, so the candles
had the same bug).

**3. The timeframe pills were disconnected from the widget.** `TV_TF` mapped
THREE of seven pills; 1M/3M/6M/1Y all fell through to `'1D'` and drew the same
chart. And nothing ever set a visible RANGE - the prop is a RESOLUTION - so "1D"
rendered TV's own bar count (~2 days of 30m candles).
On a fresh cap the fallthrough read as "no data": measured, `/api/bars` at res
`1D` returns **1-2 bars** for a days-old token (MADE 1, eJungle 1, CHILLBULL 1,
MILES 2) and `ALL -> '1W'` returns 3. Now `tvWindowFor()` picks the candle size
from the window it intends to show, clamps that window to the history the token
HAS (from `taRows`/`rows`, no extra request), and hands TVA both via the new
opt-in `visibleRangeSec` prop.

🪤 **setResolution and setVisibleRange must be ONE ordered effect.** Firing the
range on a timer while `setResolution` was still swapping the series left the
toolbar on the new interval and the legend + candles on the OLD one - a chart
that silently ignored the pill. Use `setResolution(res, cb)`; the callback fires
once the new series' data has loaded.
🪤 **A wide range lands short on the first try** (187 of 365 days on BTC) because
it can only frame bars TV already holds. One bounded retry ~1.2s later widens it
to 380.
🪤 **Break resolution ties toward the FINER rung.** A nearest-match pick flips
between two rungs whenever the span sits on their geometric midpoint - a token
~12.5 days old ties 1H against 4H, so the same pill answered differently on
consecutive clicks. The ladder now only steps coarser on a clear win.
🪤 `'1M'` means one MINUTE in `TIMEFRAME_TO_RESOLUTION` and one MONTH in the LITE
pills. Never pass a pill id through as a resolution label.
🪤 **An unsupported resolution fails SILENTLY and lands somewhere absurd.**
`/api/tradingview/udf/symbols` answers majors with
`["1S","1","5","15","30","60","240","D","W"]` - **no `720`** - and resolveSymbol
hands that list to the widget. `setResolution('720')` then left
`chart.resolution()` reading **`'1S'`**: 30 minutes of one-second candles under a
"3M" pill. The 12H rung is gone from the ladder for every symbol; always check
the symbol payload's `supported_resolutions` before adding a rung.
🪤 **Setting the range once is not enough - it has to be HELD.** TV AUTO-FITS to
late-arriving bars after the range is set, in both directions: "1D" rendered 3.3
days on a token whose 15m series is 304 bars, and "1Y" rendered **1403** days
once daily history streamed in. Fixed by subscribing to
`onVisibleRangeChanged` for a 4s settling window and re-asserting whenever the
span drifts >25% off target (bounded: 6 corrections max, and our own
setVisibleRange re-fires the event with delta 0, so it no-ops). Same primitive
the trading app's scroll-back anchor uses.
🪤 `setResolution`'s CALLBACK, not its promise, is the moment a range can stick -
the promise can settle before the data loads. Applying on the promise and then
suppressing the callback is exactly what let the autofit win.
🪤 Stocks get the ladder but NOT `visibleRangeSec`: nothing in this stack models
session gaps (see `stocks-ta-sentiment-plan.md` §A.3), so a wall-clock "1D"
window on a Monday would frame the weekend.
🪤 **Never hand the widget a `referencePrice` you do not trust.** TVA's bad-data
guard kills the chart when the bars' median is >100x from it, so the wrong hero
price above would have nuked a good series and printed "no data". LITE now passes
it only once a contract-keyed GT reading has landed (`stats._gt`).
🪤 **Every chain in `GT_NET` must resolve a `CODEX_NETWORK_ID`.** A chain GT knows
but that map does not leaves `tvToken` null, which silently removes the entire
TradingView tab - sui / robinhood / hyperliquid were in that state. Ids read off
Codex's own `getNetworks` (Sui 101, HyperEVM 999, Robinhood 4663). TON is the one
correct omission: Codex has no TON network.

**Verified** by reading `activeChart().resolution()` + `getVisibleRange()` per
pill (screenshots are not trustworthy here, see below).
BTC: 1D=15m/1.03d · 1W=1h/7.25d · 1M=4h/31.2d · 3M=1D/94d · 6M=1D/188d ·
1Y=1D/378d · ALL=1W/1897d.
LICKINGCAT: 1D=15m/1.05d · 1W=1h/7.25d · ALL=1h/12.67d (its whole life), hero
price agreeing with the chart's last close. Build + check-critical-path green.

**The "BTC pane is blank" scare was the ENVIRONMENT - settled, no code change.**
It reproduced identically on an unmodified tree, and the decisive read is
paint-independent: with the model holding **300 real bars @ 71648.01**, all three
TV BACKGROUND canvas layers were 100% filled while all three CONTENT layers were
**exactly 0** - pane, price axis AND time axis. A broken series would still draw
axis labels and the grid off a valid price scale; three empty content layers mean
no render pass ever ran. The same tab measured **3 fps** and completed 2 loop
iterations in 60s. Sample a rAF loop FIRST: if the promise never resolves, frames
are frozen and every visual is meaningless.
🪤 The Chrome-MCP tab reports `hidden: false` / `hasFocus: true` and still runs
at **2 fps** (or 0) when the OS window is occluded - `document.hidden` is NOT a
sufficient check. Raise the window (`osascript`: `minimized=false` +
`active tab index` + `index=1` + activate), then measure rAF frames, and only
then trust a screenshot. At 122 fps everything painted correctly.
🪤 `javascript_tool` returns `{}` for a top-level async IIFE - assign to a
`window.__x` global and read it in a second call. And the extension BLOCKS any
result containing a query string: classify requests in-page and emit only the
path plus whitelisted params.

## I4. On-chain caps are CONTRACT-keyed, everywhere (2026-08-20, second pass)

Founder, on THE DEALER (`2YctT9F5...5wueeryppump`, Solana): "графики растянуты,
trading view не работает... хочу чтобы ончейн нормально работали, используй
geckoterminal или codex api для onchain." Right diagnosis. Every symptom on that
screen came from ONE thing: a **symbol-keyed source answering for an on-chain
token**, at three different layers.

Ground truth for that contract, GT and Codex agreeing to the third digit:
**4 daily bars, all 2026-07-20..23, prices 2.16e-6 - 5.5e-6.** What the page drew:
13 rows, Aug 8-20, peaking at **0.0038473**. That series is
`/v1/prices/DEALER/ohlcv` - a different Dealer (at least six Solana tokens answer
to the ticker), and the box's own `meta.symbol` read `"DEALER_DEALER"`.

Three layers, three fixes:

1. **`loadDailyWindow` preferred symbol lanes and then kept the LONGEST series.**
   13 wrong rows beat 4 right ones. It now short-circuits for on-chain refs
   (`ref.contract && !SYMBOL_TO_COINGECKO_ID[sym]`) into a new
   `loadOnchainWindow()` - GeckoTerminal by contract, then Codex by contract,
   **first answer wins, not longest**, and no symbol fallback at all. A short
   honest series beats a long wrong one; "no price history" beats another asset's
   chart. This function also feeds the Technicals panel, so the same bug was
   printing somebody else's RSI.
2. **The chart effect asked the BARE-TICKER UDF lane first.** Now on-chain goes
   straight to `loadOnchainWindow`. `loadCodexBars` gained a resolution argument
   (`CODEX_TF`, mirroring `GT_TF`) - the Codex leg was daily-only, so the 1D and
   1W pills used to fall back to 1-2 bars.
3. **TVA's own Spectre-OHLCV fallback did it again, one layer deeper.** Its guard
   was `!symbol.includes(':')`, but `symbol` is the DISPLAY ticker while the bars
   had just been fetched BY CONTRACT (`barsSymbol`), so the guard was true for
   every on-chain cap. It answered with the wrong DEALER, the bad-data guard saw a
   786x gap against the live price and killed the chart, and LITE bounced the user
   off the TradingView tab - which is what "TradingView doesn't work" was. Now
   gated on `barsSymbol !== symbol`; contract-form majors (WBTC:1), the case it was
   written for, keep it.

**Bonus symptom explained:** those wrong rows carried `o == h == l == c`, so the
Candles toggle had no bodies to draw and silently rendered a line. With real
GT/Codex OHLC the candles are back (verified: 5 bodies at x=1/197/393/589/785 with
wicks, in an 800-wide viewBox).

🪤 **A dead tape needs a dead-tape anchor.** TV always requests a window ending
NOW, and the thin-token probe was 1500 intervals - only ~15 days at 15m. A token
whose last trade was 28 days ago came back empty from BOTH, fired onNoData and
retired the tab. LITE now passes `visibleRangeEndSec` (the newest bar it knows,
only when >6h stale); TVA anchors both the empty-window probe and the visible
range to it. Verified: probe fired `2026-06-21 -> 2026-07-23`, 9 bars landed,
window sat on Jul 20-22, the TradingView tab stayed selected.
🪤 `historySec` must be the SPAN OF DATA YOU HAVE (`newest - oldest`), not
`now - oldest`. On a token whose tape stopped weeks ago those differ by weeks, and
the resolution ladder picks a candle size for a window that is mostly empty.

**Verified after:** THE DEALER - hero $0.00000216 (GT-confirmed), Candles range
`$0.00000216 - $0.00000553` (matches the contract's real min/max), TradingView 9
bars Jul 20 17:30 - Jul 22 14:30 @ 0.0000026293, tab stays. Regression on majors:
BTC 1M = 4h / 31.2d / 300 bars / last close 71678 against a $71,684 hero. Build +
check-critical-path green.

🪤 Do NOT trust a screenshot of the TV pane in an automated tab even now - the
same 3 fps starvation from §I3 applies. Read `activeChart().exportData()` and
`getVisibleRange()`; those are the honest oracle.

## I5. "График растянут по высоте" was LAYOUT, not data (2026-08-20)

Third report on the same screen, and this one is not about numbers at all: the
LITE research chart rendered ~800px tall, a single line running corner to corner.

`.lite-grid` is `align-items: stretch`, and the panel beside the chart is the
token's X feed - a list that routinely runs past 1500px. The chart panel stretched
to match it, and every pixel landed on the drawing area because
`.lite-research-chart .lite-chart` was `flex: 1` and its svg is `height: 100%`.

Measured by forcing the rail to 1500px (the honest isolation - no dependence on
how many tweets a token happens to have):

| | rail ~630px | rail 1500px |
|---|---|---|
| chart svg, before | 263px | **1132px** |
| chart svg, after | 263px | **319px** |
| TV embed, before | 430px | **1161px** (iframe stayed 430 - 700px of dead panel) |
| TV embed, after | 430px | **430px** |

Fix: `max-height: clamp(280px, 36vh, 440px)` on `.lite-research-chart .lite-chart`
and `flex: 0 0 auto` on the TV pane. The PANEL still stretches - the two columns
have to stay aligned - but the chart is sized by the VIEWPORT and the slack falls
through to the stats block, which was already bottom-pinned with `margin-top:auto`.

🪤 The svg already had `preserveAspectRatio="none"`, so the viewBox is not what
sizes it - do not go looking there. Height comes entirely from the flex chain
`.lite-grid(stretch) -> .lite-research-chart -> .lite-chart(flex:1) ->
.lite-chart-stage(flex:1) -> svg(height:100%)`. Any one of those growing hands the
whole panel to the chart.
🪤 Mobile's `.lite-chart svg { height: 200px }` (0,1,1) LOSES to
`.lite-research-chart .lite-chart svg { height: 100%; min-height: 260px }` (0,3,0),
so the research chart was never phone-sized either. The clamp now bounds both.

## I6. "Прыгает UI когда вожу по графику" - and a third box-data variant (2026-08-20)

Two defects on one screen, from the same pair of screenshots.

**1. The header reflowed under the cursor.** `.lite-research-head` was
`display: flex` with two children: the price block and the toggle group (which
carries `flex-wrap: wrap`). The price block's intrinsic width therefore squeezed
the toggles, and scrubbing swaps the headline between `$0.005301 / +2.50% today`
and `$0.00000014 / +3775562.39% - Aug 17`. Swept the panel across six widths in
both layouts, live vs scrub headline, measuring the toggle group's height:

| panel width | flex, live | flex, scrub | grid, live | grid, scrub |
|---|---|---|---|---|
| 760-940px | 80 | 80 | 36 | 36 |
| **1000px** | **36** | **80** | 36 | 36 |
| 1080px | 36 | 36 | 36 | 36 |

At 1000px the toggles flip one row -> two rows on scrub - the whole card jumping
under the cursor, exactly the report. Fixed with
`grid-template-columns: minmax(0, 1fr) auto`: the toggles size themselves first
and the variable-length TEXT absorbs the difference. Stable at every width, and
the auto track can still shrink so the two-row wrap survives where it is really
needed. Also compacted the percent (`fmtPctCompact`) - `+3775562.39%` is 13
characters of unreadable width; big moves now lose decimals, then digits
(`+3.8M%`).

🪤 Any flex row that pairs LIVE-UPDATING TEXT with wrapping chrome will do this.
The text must be the flexible track, never the chrome.
🪤 My first A/B at one window size showed `jumped: false` for BOTH layouts and
looked like the bug did not exist - at 1800px flex is *always* wrapped, so the
tipping point is invisible. Sweep the width; a single-width layout A/B proves
nothing.

**2. A third flavour of the box's symbol-keyed rot.** BULL: `/v1/prices?symbols=BULL`
says **0.00530103** (and its perf chips and 24h range 0.004895-0.006022 agree),
while `/v1/prices/BULL/ohlcv` returns two rows at **~1.4e-7** - the same symbol,
6000x apart. `chartRows` then anchors the newest bar to the live price so the
endpoint matches the headline, which turned that into a **37,855x** diagonal from
corner to corner and poisoned the y-axis, the min-max caption and the scrub
percentage.

New SCALE-AGREEMENT GATE in `chartRows`: if the newest close sits more than
`SERIES_SCALE_TOLERANCE` (50x) from the live price, the two are not the same tape
- return `[]` and let the honest empty state show. Generous on purpose: a degen
can genuinely run 20x in a session, nothing runs 50x between its own last daily
close and the current quote. Verified: BULL now prints "No price history for BULL
on any of our sources yet." instead of the diagonal; BTC unchanged.

⚠️ BULL has NO chart anywhere as a result, and that is a data gap, not a UI one:
its box OHLCV is broken and its `contract` (`ce32007a...`, 64 hex) carries
`chain: null`, so GT and Codex cannot be keyed by it either. Filed under the
data-lane doc.

## I7. LITE had TWO timeframe controls and they did not talk (2026-08-20)

Founder, with an arrow drawn from the "1D" pill to the toolbar's "15m": the
timeframes disagree. They did, in two different ways, and only one of them was
a misread.

**The chart data itself was already fixed.** The screenshot's other half - hero
$0.000136 against a chart in the 0.000049 band - is the §I4 defect, closed the
same day by the on-chain contract routing. Re-measured on LIENFI
(`0x3722264a...`, Base) after that landed: `/api/bars` by contract returns 193
bars ending 0.000136338, and the widget draws exactly those. **The bare ticker
`LFI` returns `no_data` on `/api/bars` and belongs to a different project on
`/v1/prices/LFI/ohlcv`** - which is what the old fallback was answering with.
Prod carried the fix ~40 minutes before the report, and the research app runs a
service worker, so "still broken on prod" here means a stale bundle.

**What WAS live: the pill and TradingView's own interval menu are two controls
in one card, sharing vocabulary and syncing nothing.** The pill sets a RANGE
(and derives a candle from it); TV's toolbar sets the INTERVAL only. Measured:

| | pill | toolbar | drawn |
|---|---|---|---|
| fresh load | 1D | 15m | 24.7h ✅ |
| after picking "1 hour" in TV's menu | **1D**, still lit | 1h | **95h** ❌ |

And there was no way back: clicking `1D` again changed no prop, so the range
effect never re-ran. The pill was simply lying from then on.

**Three rounds of fixes, because the first two solved the wrong half.**

*Round 1 - sync.* `TradingViewAdvanced` subscribes to `onIntervalChanged` and
re-asserts the caller's `visibleRangeSec` at whatever candle the user picked, so
the pill's promise holds: 15m -> 24.8h, 4h -> 24.0h, 1m -> 23.8h, all under one
"1D" pill (was 95h). A `selfChange` flag keeps the programmatic `setResolution`
path byte-identical. Callers that pass no `visibleRangeSec` (stocks, PRO,
traders-corner) are untouched - the re-assert returns early on `span > 0`.

*Round 2 - explain.* A line under the pills spelling the two numbers out as one
sentence. **Not enough** - the founder pointed at the same thing again. A label
that explains a contradiction is still a contradiction.

*Round 3 - THE FIX: in TradingView mode the pills ARE the candle sizes.*
`1m / 5m / 15m / 1h / 4h / 1D / 1W`, TradingView's own vocabulary, bound to the
widget's resolution. Line/Baseline/Candles keep their range pills - those are
our charts and a range is what they mean. TV's duplicate interval picker is
disabled (`header_resolutions`) along with the legend's series title, which
carries the interval a second time, so the interval is now stated in exactly one
place on the card. The little line under the pills flipped over: the pill states
the candle, the line states the window it adds up to ("about 38h shown").

Measured after, every pill against the widget: 1m -> res 1 / 2.6h · 5m -> 5 ·
15m -> 15 / 40h · 1h -> 60 / 6.5d · 4h -> 240 / 26d · 1D -> 1D / 157d ·
1W -> 1W / 2.9y. Switching back to Candles restores `1D 1W 1M 3M 6M 1Y ALL`,
and the chosen interval is remembered per token.

The opening window is `TV_WINDOW_BARS` candles of the chosen interval, **clamped
to the tape that exists**. Without the clamp the line under the pills
over-promised on every young token - CASHCAT's "1D" drew its whole 52-day life
under a claimed 150 days, "1W" drew 98 days under a claimed 2.9 years - and even
BTC's "1W" claimed 2.9y against the 1 year we actually walk. TradingView clamps
the window either way; this stops us ASKING for tape that is not there.

Also fixed on the way: the range held on every pill switch but **not on a cold
first paint** - CASHCAT opened on 1,213 hours under a "1M" pill because the
series settled after the 4s watch window closed. Window raised to 12s with 10
corrections, and the watch now aborts the moment the user touches the chart.

🪤 A window wider than a token's whole life CLAMPS, so the drift never closes
and every correction lands on the same number - the watcher would burn its whole
budget re-applying an impossible range on exactly the small caps this page is
full of. It now gives up on the first correction that changes nothing.

🪤 That abort listener has to go on the **iframe's document**, not the React
container: the chart canvas lives inside the widget's iframe and its events
never bubble out, so a container-level listener never fires and the guard is
decorative. `widget.subscribe('mouse_down', ...)` accepts the subscription and
does not fire for synthetic events, so it cannot be used to verify this either.

Regression sweep, LIENFI: 1D 15m/1.03d · 1W 1h/7.25d · 1M 4h/32d · 3M 1D/94d ·
6M=1Y=ALL 1D/116d. BTC unchanged from the pre-change baseline (1D 15m/1.04d,
1M 4h/31.2d, 1Y 1D/377d). AAPL still gets TV's own fit and no hint.

🪤 **A `flex-basis: 100%` child inflates a wrapping flex container's
max-content.** The hint's first shape was a full-width child of
`.lite-research-toggles`, whose parent is a grid with an `auto` column. A
wrapping container's max-content is the SUM of its items, so a 126px hint took
the column 667 → 793px and squeezed the price block to width 0 - the change
line wrapped mid-sentence. Give such a label its own grid row
(`grid-column: 1 / -1`), never a 100% flex basis. A/B the parent's width with
the label display-toggled; do not eyeball it.

🪤 The 12H rung is still absent from the ladder on purpose (§I3) - `720` is not
in any symbol's `supported_resolutions` and silently lands on `1S`.

## I8. Inferring a chain from the contract shape - TRIED, MEASURED, REVERTED (2026-08-20)

The idea was sound on paper and wrong in fact. `/v1/prices` sometimes returns a
`contract` with `chain: null`, and without a chain LITE's on-chain ref stays
null, so the token never reaches the contract-keyed lanes. A 43-44 char base58
string is unambiguously a Solana mint (Tron is base58 but exactly 34; hex of
that length almost always carries a `0`/`O`/`I`/`l`, which base58 has none of),
so the chain looked free to infer.

**It made the page worse, measured A/B on BULLSHIT:**

| | hero price | chart |
|---|---|---|
| with the inference | $0.00001148 | "No price history", dead TradingView tab |
| without it | **$0.002140** | draws, $0.000721 - $0.003763 |

CoinGecko lists `bullshit-coin` at $0.00214 / $2.08M cap on
`zj1jpp7QMveWHLs61vL9KMZf254KvW7j4AAmBF8ry2k`. The contract the box sent,
`BjhkosH9...6xj4`, is a DIFFERENT token whose only GeckoTerminal pool holds a
$0.00000007 reserve and has zero bars anywhere.

**So the premise was inverted.** The assumption was "the box has the right
contract and merely forgot the chain". On the rows that actually carry
`chain: null`, the box's identity resolution FAILED - the contract is wrong too,
and the missing chain was the only thing keeping the page out of that trap.
Inferring it removed the guard and promoted a dust pool over a working
CoinGecko lane.

Also worth knowing before anyone revives this: **`contract` + `chain: null` does
not appear at all in the top 250** (checked 2026-08-20). The "long tail" it was
meant to serve is, so far, exactly the two known-bad rows in
`data-lane-fixes-for-alaa.md` §12d/§14 - which is a data-lane fix, not an app
one. If it IS revived, gate it on the contract resolving to a pool with real
depth, and never let a dust pool override the symbol/CG lane.

🪤 A "no data" state can mean **we are asking about the wrong token**. Check the
symbol against CoinGecko before believing the empty answer - the tweets in the
page's own X rail said "$2.4M market cap" while our chart said no history.

## I9. The LITE research header crushed its own headline (2026-08-20)

Founder screenshot: the token name and star painted UNDER the Line/Baseline
pills. Not a z-index problem and not from the timeframe work - pure grid sizing,
and it had been there since the TradingView tab made the toggle row wider.

`.lite-research-head` is `grid-template-columns: minmax(0, 1fr) auto`. The
toggles are a WRAPPING flex container, and a grid `auto` track is granted a
wrapping flex container's max-content - which is the SUM of its items, i.e. all
eleven buttons on one line. So the track never shrinks, its own `flex-wrap` can
never engage, and the price column gets the remainder. Measured on a 728px
panel: **45px for the headline against 667px of pills**, and since a price has
no break opportunity the text simply overflowed its track and painted under
them.

Fix: `grid-template-columns: minmax(min-content, 1fr) minmax(0, auto)`. The
headline keeps its min-content; the toggles are allowed below max-content so
they wrap. Swept 400-1100px after: price fits its track at every width, 16px
clear of the pills, and the toggles stay on ONE row at 1100 (wide layout
unchanged) and go to two below that.

🪤 The same trap in miniature: a `flex-basis: 100%` label added to that toggle
container widened the `auto` track 667 -> 793px and squeezed the headline to
zero. Full-width labels in a grid belong on their own row
(`grid-column: 1 / -1`), never as a 100%-basis flex child. A/B the parent's
width with the label display-toggled - this is invisible to the eye until the
viewport is narrow enough.

## I10. The bare-ticker UDF lane was throwing away correct series (2026-08-20)

Founder screenshot: BULL, "No price history for BULL on any of our sources yet"
- under a live $0.005301 quote, a 24h range and four change windows. The copy
was false and the blankness was partly our own doing.

**Measured across the whole LITE Gainers board (19 tokens):** every row came
back with `coingecko_id: null`, **13 of 19 with `chain: null`**, 5 with
`price: 0`, and the box's per-symbol OHLCV ranged from perfect (GME, KTA, EYE,
DUSK, PEPEONTRON at ratio 1.0) to another token entirely (DEALER 369x off, BULL
5,936x). So `chain: null` is not an edge case on the long tail - it is the
majority of that board. (The earlier "0 rows in the top 250" reading in §I8 was
the wrong population; it does not contradict this.)

**The app bug.** For a token that is not on-chain (no chain -> no contract lane),
the series loader asked `/api/tradingview/udf/history?symbol=<BARE TICKER>`
FIRST and returned early on any answer. The on-chain branch three lines above
carries a comment explaining that on-chain tickers collide constantly - the same
is true off-chain. Measured on GME: the box's own daily series is correct to the
digit ($0.00038005 against a $0.000381 quote) and was never requested, because
the UDF lane answered first with one of the FIVE other coins trading as GME. The
render-time 50x gate then refused that, and the page drew nothing.

Two fixes, same rule - **a series that contradicts the live quote is not this
token's**:
- the UDF answer is checked against the quote and falls THROUGH instead of
  returning early;
- inside `loadDailyWindow` the symbol lanes stop letting a wrong candidate win
  on LENGTH (they keep the longest); each candidate is now scale-checked first.
  The quote is part of that function's cache key, because the first call of a
  cold load often lands before the price does and its unvalidated answer must
  not be served back to the validated pass.

The quote reaches the loader through a ref read at call time, not a dep - the
price ticks constantly and depending on it would refetch every series per tick.
The loader's effect already re-runs once when `stats` lands (via `cgHintName`),
which is the moment that matters.

**Result:** GME charts (axis Jul 22 -> Aug 20, $0.000347-$0.000438 around a
$0.000381 quote, candles included). BTC, LIENFI, DEALER, TENDIES unchanged.
BULL and JOTCHUA still have no chart, which is correct - nothing anywhere
returns their tape - but they now say so honestly.

**Three empty states instead of one lie**, each true by construction:
rows held but refused -> "the price history our sources return for X is a
different token's"; nothing held but a live quote -> "no history we can match to
its price"; no quote either -> the original "No price history yet".

🪤 **`toChartRowsFromHistory` passed an ISO STRING through as `time` and
milliseconds as `t`** while every other lane in that file - including the
primary lane sixty lines below it, whose comment says the shape is "what
downstream code expects" - emits unix SECONDS. Invisible until a token actually
fell to that fallback: GME then printed "Invalid Date" on both axis ends, in the
scrub tooltip and in the change caption. It also emitted only long keys, so a
candle renderer reading `o/h/l/c` would have silently drawn a line. Both fixed
at the source; it has exactly one caller.

🪤 In Vite dev you can call an app module directly from the page -
`await import('/src/pages/lite/components/lite-research.jsx')` returns the live
module, so `loadDailyWindow('GME', 30, {price})` can be tested without driving
the UI. It is the fastest way to tell "the loader is wrong" from "the loader is
fine and the component is holding something else" - which is exactly the turn
this investigation took.

## I11. On-chain identity recovered from CoinGecko's own listing (2026-08-21)

Founder, on HMM (thinking-cat, Robinhood chain): Candles pill still drew a line,
and the TradingView tab was missing entirely. Both had ONE root cause: the box's
`/v1/prices` row carried `price: 0`, `chain: null` AND a wrong contract
(`0x0b4a...bbef`, zero GT pools anywhere), so `onchainRef` never resolved -> the
contract lanes (GT candles, Codex bars, the TV tab's `address:networkId`) never
engaged, and the winning series was CoinGecko `market_chart`, which is
CLOSE-ONLY -> `hasOhlc` false -> the Candles pill silently rendered a line.

The fix (`lite-research.jsx` `resolveCgPlatform`): the chart lane already
resolves a CG id for these tokens; CG's coin record carries the VERIFIED
contract + platform (`platforms: {robinhood: 0x7fe9...d87f}` - 20 GT pools,
$597k reserve, while the box's contract had none). When neither the watchlist
entry nor the box row can name a chain, that record now builds the on-chain ref
- ratified against a real GT pool (liquidity >= $500) before it is believed, per
the SI8 lesson, and never field-mixed with the box's contract. Result: GT/Codex
candles with real bodies, the TradingView tab appears (CG platform id ->
`CG_PLATFORM_CHAIN` -> `GT_NET`/`CODEX_NETWORK_ID`), and /api/bars serves the
right token (`0x7fe9...:4663`, codex tier, 160 real 4h bars).

How the LITE chart decides its source for a crypto symbol, post-fix:
1. watchlist entry contract+chain (user identity) - if complete, no CG fetch;
2. box row contract+chain - same;
3. CG platform record for the resolved id, GT-pool-ratified (NEW);
4. no ref at all -> symbol lanes (UDF scale-gated, box chart, CG market_chart) -
   close-only, so Candles degrades to a line there by construction.

trap: `document.hidden` was true for the whole verification tab, so the TV pane
screenshotted blank while `activeChart().exportData()` held 199 correct bars -
the SI3 artifact again. The fiber-walk + exportData oracle is what proved it.

**Same-day follow-up (FUZZY, XRPL):** second failure shape of the same class -
the box's `/v1/prices/FUZZY/ohlcv` answers `source: price_history_daily` with
**35/35 rows o==h==l==c** (a daily close replicated into all four fields), so
`hasOhlc` was true and the Candles pill drew a month of zero-height dashes; the
one tall green candle was the live-price anchor widening the LAST bar. Two
fixes: (a) the candle gate now requires a real range on some non-last bar
(fake-flat series fall back to the line honestly); (b) XRPL wired into the
recovery lane - CG's platform id for XRPL is literally `xrp` and its token id
("CURRENCYHEX.rIssuer") is verbatim what GT's `xrpl` network accepts
(fuzzybear: FUZZY/XRP pool, $1.96M reserve, 30 real daily candles, drift vs
quote 1.002). Codex has no XRPL, so like TON these get GT candles and no
TradingView tab. Verified by replaying the exact lane arithmetic in node
against live CG/GT - not in a browser.

**Third follow-up (BULL, 2026-08-21):** the recovery lane failed on the NAME
rung - the box calls the token "Bull", CG lists "The Bull", and with two
same-symbol candidates the strict resolver correctly refused, so the page fell
to the (broken, 6000x-off) box OHLCV and drew the honest empty state.
`resolveCgId` gained a middle rung: normalized name (lowercase, punctuation
stripped, leading article dropped) accepted only on a UNIQUE candidate match.
With it BULL resolves to `the-bull` (Robinhood), the GT pool ratifies ($116k),
and `mergeGtStats` throws away the box row entirely - its quote is FROZEN at
0.00530103 (byte-identical across two days) while the pool trades at 0.00178,
ratio 2.98 > GT_PRICE_TRUST_RATIO. Hero, candles and the TV tab all come from
the contract lanes after that. Verified in-browser on dev: hero $0.001781,
15 real daily candles, TV pill present.

**Fourth follow-up (GME-eth, 2026-08-21): sparse-cadence auto-step.** A thin
token "supports" any TV interval the user clicks - Codex returns whatever raw
trade bars exist. Measured on GME (Ethereum) at "1m": 14 bars in the last 3h
(8% density), 500 bars spanning 12 days, median gap 9-18 min - so the widget
drew weeks of clumps-with-voids under a label promising hours. Fix in two
halves: `TradingViewAdvanced` gained an opt-in `onSparseInterval` report (fresh
first window only, >=6 bars, median gap > 3x the requested interval, once per
symbol+resolution; report-only so non-opted surfaces are byte-identical), and
LITE steps the interval pill UP to the first rung >= the median gap - visibly,
the pill moves and the span line recomputes. Once per sym+resolution: re-picking
the fine rung afterwards shows the raw sparse truth instead of fighting the
user. Same principle as rz-chart-audit-plan Phase 1 item 2 (auto-pick an honest
resolution, never silently). Verified by replaying the exact math over the real
/api/bars payload - steps 1m -> 15m on GME, no-ops on a dense tape.

Still open (out of scope here): tokens with a CG listing but NO mappable
platform (native L1s outside the majors map) still get close-only rows - the
Candles pill falls back to a line with no indication. A CG `/coins/{id}/ohlc`
lane (verified live: 180 real OHLC rows for thinking-cat) would close that class.

## I12. The TV widget was keyed on a value that arrives LATE (2026-08-24)

Founder: "charts in mobile tend to flicker hard in lite and pro at times."

`lite-research.jsx` keys `<TradingViewAdvanced>` on
`` `${tvSymbol}:${onchainContract || '-'}` `` — correct in intent (a ticker twin's
series must never sit under this header), but `onchainContract` can arrive
AFTER first paint: it comes from `cgRefState`, set by `resolveCgPlatform`, which
is two network hops (CG coin record + GT pool ratification) and deliberately
waits for the stats row so it has a name to disambiguate with. So for every
token that needs identity recovery the key changed post-paint and React tore
down the whole widget and built a new one.

On a phone that is a 4.4MB widget rebuilding mid-view. It reads as intermittent
because it only hits tokens that need recovering — which per
`data-lane-fixes-for-alaa.md` §15 is most of the long tail (13 of 19 gainers
rows carry `chain: null`).

Fix: the embed waits for identity to settle (`tvIdentitySettled`) and renders
the existing skeleton meanwhile. The key is untouched — it is load-bearing. This
also closes a correctness window: before recovery landed the widget was charting
the UNrecovered identity, i.e. potentially a twin's tape (§I10).

🪤 **Never key a heavy component on a value your own code resolves
asynchronously.** The key is an identity assertion; if the identity is still
being computed, do not mount — a late-arriving key is a guaranteed rebuild.

**Measured clean in the same pass** (true 390x845, rAF verified at 121fps, so
paint was honestly measurable): PRO mobile canvas chart — 0 blank frames and 0
changed frames across 2,638-3,085 frames at idle, on a timeframe switch, and
across five viewport-height changes; LITE SVG chart — 0 mutations in 12s idle;
shell blur load 0.93 screens (healthy); the theme globe's 4 infinite animations
run on 36-69px elements (negligible). So the flicker is NOT idle repaint, canvas
churn, blur load, or the globe — do not re-chase those.

🪤 `page.setViewportSize()` via raw Playwright does NOT match the MCP
`browser_resize` tool: asking for 390 yields **487 CSS px** (dpr 0.8, the
documented x1.25). Ask for 312 to get a true 390, and always assert
`innerWidth` before trusting a "mobile" measurement.
🪤 The LITE mode-switch double teardown visible in dev is **React StrictMode**,
not a prod bug — `main.jsx` wraps the tree unconditionally and StrictMode
double-invokes only in dev builds.
## I13. One tape for all three LITE chart modes + the GT-search identity rung (2026-08-22)

Evgeniy: "можем ли мы использовать только GeckoTerminal для line/candles/TV, и
как идентифицировать токен без прямой связки". Two changes, working tree:

**1. `src=gt` pin on /api/bars.** LITE's Line/Candles were already GT-first by
contract (loadOnchainWindow), but the TV tab rode the 5-tier cascade whose
answering tier is ENVIRONMENT-dependent (§A3: dev gets gap-filled GT, prod
often sparse raw Codex) - so one card's three chart modes could draw different
tapes. New pin, symmetric to the terminal's `src=codex`: `handlers/bars.js`
runs the geckoterminal tier first when `src=gt`, FAIL-SOFT - a GT miss (no
pool, keyless-prod 429, timeout) marks `ctx.gtExhausted` (so the cascade below
never re-pays the GT round-trip - bars-router.js gate) and falls through to
today's exact behavior. Wired via `tvToken.barsSrc='gt'` (lite-research +
sl-tv-chart) -> TVA fetchBars appends `&src=gt`. Verified on a live dev
instance: SPECTRE src=gt -> tier geckoterminal; LICKINGCAT default -> codex
but src=gt -> geckoterminal (realBarRatio 1.0); a no-pool address with src=gt
-> falls through to no_data, no error. Default path byte-identical for every
other caller. NOTE: prod GT depends on COINGECKO_API_KEY in the research
Vercel project (the §A3 open question) - fail-soft means a missing key
degrades to today's codex tape, never to blank; check `X-Spectre-Tier:
geckoterminal` on prod after deploy to confirm the key.

**2. `resolveGtSearch` - the LAST identity rung (lite-research.jsx, exported;
consumed by Research's identity effect + Cinema's sl-identity).** The chain was
seed -> box row -> CG platform record (resolveCgPlatform) - and a CG-UNLISTED
token with no usable box row fell to the symbol lanes and an honest empty. GT's
own `/search/pools?query=&include=base_token` closes that class: candidates are
BASE-side pools whose included token SYMBOL matches, one per token (deepest
pool), floored at MIN_PLATFORM_LIQUIDITY (dust never qualifies - §I8). Picking
discipline mirrors resolveCgId, with one upgrade: exact-name / image matches are
RANKED (quote-agreeing first, then deepest), not first-hit - clone farms copy
the name verbatim (measured: 11 exact "world licking cat" candidates, one real
solana pool + a robinhood clone swarm), so "first match" is iteration-order-
dependent, the same class as the first-mappable-platform bug §C fixed. Loose
name stays unique-only; several same-ticker candidates with NO evidence is a
REFUSAL (honest empty beats a twin - GME has 3 six-figure pools on 3 chains).
Only fires after resolveCgPlatform returns null, so CG-listed tokens never pay
it. Verified by replaying the exact arithmetic against live GT (scratchpad
gt-search-replay.mjs pattern): LICKINGCAT+name -> the real solana mint over the
clone swarm; GME no-evidence -> refused; GME+quote -> the agreeing solana pool;
garbage ticker -> refused.

🪤 GT `/search/pools` results carry NO network relationship - the net is the
token id's PREFIX (`{net}_{address}`), and net ids contain underscores
(polygon_pos), so parse it via the included token's own `address` length,
never by splitting on `_`.
🪤 The search answers with the token as BASE or QUOTE; quote-side hits price
somebody else's tape (the CATE/lickingcat lesson) - filter to base-side only.

Deferred (own PR, agreed): the §A lite-cinema module extraction - one identity
module for Research/Cinema/TV instead of primitives imported out of
lite-research.jsx.

## I14. "Loading TradingView" for 30-100s on a thin token = serial history paging at a fine rung (2026-09-05)

Founder, LITE cinema on SPECTRE with the remembered "1m" pill: chart and data load
very slowly. Measured on dev: the panel data lands in ~2s; the TV pane sat under the
shimmer while the widget fired **30+ SERIAL `/api/bars` (~1s each, 60000s windows)**
paging 1m history back to fill its viewport. The GT tier gap-fills, the datafeed
strips synthetic rows, so each window yields 6-25 real bars on a $6K/day tape - TV
lays bars out by INDEX and keeps asking. The same open on 1h: 2 requests.

Two coupled defects in `TradingViewAdvanced.jsx`:
1. The sparse-cadence report (§I11) needed >=6 real bars in the first window -
   SPECTRE 1m had 2, so it never fired. The fresh load now widens ONCE (1000
   intervals older) when 0 < n < `SPARSE_SAMPLE_MIN` and reports from
   `SPARSE_REPORT_MIN` (3).
2. Even once the caller stepped the pill, `setResolution` lives in the effect gated
   on `chartReady`, and `onChartReady` waits on that very paging - a deadlock.
   A caller that STEPPED now returns `true` from `onSparseInterval`; the datafeed
   answers `noData:true` to TV auto-paging on that sym:res (`sparseHalt`,
   cleared on the next resolution change, so re-picking the fine rung pages the
   raw tape as before).

Cinema (`sl-tv-chart.jsx`) opts into `onSparseInterval` like Research; the
auto-step is not persisted, so the next token opens on the user own pick.

Result (dev): SPECTRE cinema 1m: 30+ requests / 25s+ -> 3 requests, shimmer gone
at ~4.1s, pill 1m -> 1h. BTC 1m: 2 requests, 2.2s, pill stays.

🪤 Never gate a correction on `onChartReady` for a chart that is still paging -
ready fires only after TV is satisfied with its history. 🪤 Count `/api/bars`
requests in-page (fetch wrapper, path + whitelisted params) - the extension redacts
query strings and resource-timing alone hides the serial shape.

## J. Agent & Skill References

- **Agent:** `.claude/agents/charts-specialist.md` - dedicated chart specialist agent
- **Skill:** `/charts-audit` - run chart health check across the codebase
- **Rules:** This file (`.claude/rules/charts-system.md`)
