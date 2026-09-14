# TradingView Chart Data Pipeline — Line/Candle Routing

**Date:** 2026-04-22
**Status:** Draft — pending review
**Scope:** Research app + Trading app TradingView Advanced chart, `/api/bars`, `/api/tradingview/udf/history`
**Out of scope:** Sparklines (52+ files), Traders Corner widgets, Lightweight Charts, mobile responsive

---

## A. Problem

1. **Bad data spikes** on BTC/ETH/SOL charts — Codex DEX prices poison candles for tokens that have a clean Binance pair.
2. **Slow first paint** (5–10s) — aggressive pre-load fetches 5 chunks of 500 bars in parallel before showing anything.
3. **Scroll-to-load broken** — current code calls `w.setSymbol()` which rebuilds the widget instead of returning older bars via TV's pagination API.
4. **No line chart option for long-tail tokens** — non-Binance tokens try Codex candles even when they have clean CoinGecko price history that would render fine as a line.

## B. Decisions (locked)

1. **Default style by token class**
   - Token has Binance pair → candles from Binance.
   - Token has only a CoinGecko ID → line from CoinGecko.
   - DEX-only token → line from Codex (with outlier clamping).
2. **User can override via TV's built-in chart-style button.** We subscribe to the change event and re-fetch with the correct `preferStyle`.
3. **Codex stops being a primary source for any token with a Binance pair.** Only used as a fallback, and only with outlier clamping.
4. **No more pre-load chunking.** One fetch on first request. TV's native `getBars(firstDataRequest=false)` pagination handles older bars as the user scrolls.

## C. Architecture

### C.1 Data source hierarchy

| Token class | Style (auto) | Primary | Fallback |
|-------------|--------------|---------|----------|
| Binance pair (BTC, ETH, SOL, ~50 majors) | Candles | Binance klines | CoinGecko (line) |
| CoinGecko ID only | Line | CoinGecko `market_chart` | Codex clamped |
| DEX-only (no Binance pair, no CoinGecko ID — typical memecoin) | Line | Codex clamped | — |

When the user toggles the TV chart style:
- Line requested → prefer CoinGecko, else Binance close-only, else Codex line points.
- Candle requested → prefer Binance, else Codex clamped. If neither works, stay on line from CoinGecko and disable the toggle with a tooltip ("Candles not available — showing line data").

### C.2 Server `/api/bars` changes

File: `packages/server/index.js` (around L5640–5820)

- Add query param: `preferStyle=line|candles` (default: `auto`).
- Reorder tier flow:
  - If `preferStyle=candles` OR token has Binance pair:
    1. Binance klines
    2. Codex clamped
    3. CoinGecko line (as last-resort line fallback)
  - If `preferStyle=line` OR token is non-Binance:
    1. CoinGecko `market_chart`
    2. Binance klines (if pair exists) — collapse to close-only line points
    3. Codex clamped
- Remove the current TIER 1 "dynamic Codex resolve when no address" path for any symbol where a Binance pair or CoinGecko ID exists. It's the primary source of spike data on major tokens.
- Add `clampOutliers(bars)` helper:
  - For each bar, compute median of surrounding 20 bars' closes.
  - If `bar.high > median * 3` → clamp `high = median * 3`. Same for `low < median / 3`. Same for `open`/`close`.
  - Bars with all four values outside the band → drop the bar (sparse gaps render fine, spikes don't).
- Response shape (unchanged except for one new field):
  ```json
  {
    "bars": [...],
    "source": "binance" | "codex" | "coingecko-chart",
    "chartType": "candlestick" | "line",
    "dataSource": "binance" | "codex" | "coingecko",
    "linePoints": [...]
  }
  ```

### C.3 Server `/api/tradingview/udf/history` changes

File: `packages/server/index.js` (L5461–5560) + `apps/research/api/_lib/handlers/tradingview-udf.js`

- Pass through `preferStyle` query param to `/api/bars`.
- Inline the `/api/bars` call (no more self-fetch via `http://localhost:PORT`) — import the handler directly. Saves ~50ms per request and unblocks worktree port variance.
- Include `chartType` in UDF response meta (TV ignores unknown fields, safe to add).

### C.4 `TradingViewAdvanced.jsx` changes

File: `apps/research/src/components/TradingViewAdvanced.jsx` + mirror in `apps/trading/src/components/TradingViewAdvanced.jsx`

**Props:**
- Add `chartStyle = 'auto' | 'line' | 'candles'` (default `'auto'`).

**Datafeed:**
- `fetchBars()` appends `&preferStyle=${style}` where `style` is derived from the current chart style (tracked via `chartStyleRef`).
- On first response, read `chartType` from the UDF response meta. If `'line'` and current widget style is not line, call `chart.setChartType(2)` (Line).
- Remove the `chunkRanges` pre-load loop in `getBars`. Fetch `[from, to]` once, return.
- `firstDataRequest=false` branch: just fetch `[from, to]` and return directly via `onResult(bars, { noData: !bars.length })`. No cache prepend, no `_earliestBarTime` tracking.
- Keep `allBarsCache` only for polling continuity (last known bars so polling can update the right one). Drop the running-cache-across-calls logic.

**Scroll-to-load:**
- Delete the entire `onVisibleRangeChanged` → `setSymbol` block. TV handles it natively via `firstDataRequest=false`.

**Style change listener:**
- On `onChartReady`: subscribe to `chart.onChartTypeChanged()` (or equivalent TV API). Update `chartStyleRef` and call `chart.resetData()` to re-request bars with new `preferStyle`.

**Bad-data detection:**
- Keep the existing `isBadData` check (last 30 bars, known-price ratio) as a safety net. The clamp on the server should prevent it, but better to render nothing than garbage.

### C.5 Shimmer loading state

- Add a CSS shimmer placeholder inside `.tradingview-advanced-container` that renders until the widget fires `onChartReady`.
- Matches the chart area dimensions. Uses the existing `.animate-shimmer` class from `design-system.md` §E.
- Hide via a `data-ready="true"` attribute toggled when `onChartReady` fires.

## D. Files touched

| File | Change |
|------|--------|
| `packages/server/index.js` | `/api/bars` tier reorder, `clampOutliers()`, `preferStyle` param |
| `packages/server/index.js` | `/api/tradingview/udf/history` inline call + pass-through |
| `apps/research/api/_lib/handlers/tradingview-udf.js` | Mirror prod serverless |
| `apps/research/src/components/TradingViewAdvanced.jsx` | Props, datafeed rewrite, style listener, shimmer |
| `apps/trading/src/components/TradingViewAdvanced.jsx` | Same (they're near-duplicates — diff and sync) |
| `apps/research/src/components/TradingViewAdvanced.css` (new) | Shimmer placeholder styling |

## E. Success criteria

1. BTC 1H chart renders first bars in under 1 second. No price spikes visible.
2. A token with only a CoinGecko ID (e.g. a mid-cap not on Binance) renders a clean line chart by default, no Codex noise.
3. User clicks TV's "Candles" button on a CoinGecko-only token — if Codex has valid data, candles appear; if not, a toast says "Candles unavailable" and style stays line.
4. User scrolls left — older bars load in-place (no widget rebuild, no flicker, no visible fetch wave).
5. Day mode, mobile, and existing trade-marker features all still work.
6. No build errors, no console errors in dev or prod.

## F. Rollout

- Single PR from `prod` → `main`.
- No feature flag — changes are strictly better than current state (current state is broken).
- Manual QA checklist:
  - BTC/ETH/SOL candles look clean on 1M/5M/15M/1H/4H/1D.
  - PEPE, SHIB, DOGE candles clean.
  - A random long-tail token (e.g. from trending list) renders as line.
  - Scroll left 3× — older data loads smoothly.
  - Toggle Line → Candle → Line on BTC.
  - Day mode on all of the above.

## G. Open questions (none blocking)

- Should `clampOutliers` also apply to CoinGecko data? Probably not — CoinGecko is already smoothed. Skip for now, revisit if a spike appears.
- Should we cache per-`preferStyle` separately on the server, or share the cache key? Share — the bars array is the same payload; only the client's render choice differs. Keep cache key as `symbol:resolution:from:to`.
