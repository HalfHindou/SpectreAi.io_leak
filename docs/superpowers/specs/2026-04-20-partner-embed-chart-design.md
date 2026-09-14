# Partner Embed Chart — Design Spec

**Date:** 2026-04-20
**Owner:** Evgeniy
**Status:** Approved, ready for implementation plan

---

## Goal

Give partners a public, unauthenticated, iframe-embeddable price chart in the Spectre Apple Cinematic style. Drop-in alternative to CoinGecko/TradingView widgets that ships our brand.

## URL and Access

- **Route:** `/embed/chart/:cgId` — e.g. `/embed/chart/bitcoin`
- **Public:** added to `PUBLIC_ROUTES` in `apps/research/src/components/auth-gate.jsx` via the `/embed` prefix (covers future embed widgets).
- **Standalone:** rendered outside `AppShell`, `PageShell`, `AuthGate`. No sidebar, no header — partner controls the frame.

## Layout

```
+--------------------------------------------------+
| [Line|Candle|TV]           [1D][7D][1M][3M][1Y]  |  top toolbar
+--------------------------------------------------+
|                                                  |
|                    CHART                         |
|                                                  |
+--------------------------------------------------+
|  [<<]  |||||||[==== window ====]|||||||||||[>>]  |  range slider
|   Dec       Jan         Feb        Mar           |
+--------------------------------------------------+
```

- Top toolbar: segmented type toggle on the left, timeframe pills on the right.
- Chart body: fills all remaining space.
- Bottom range slider (brush): hidden in TradingView mode (TV owns its time control).

## Chart Types

| Type | Source | Rendering |
|------|--------|-----------|
| Line | CoinGecko `/market_chart` | Canvas, smooth line + subtle gradient fill, hover crosshair |
| Candle | CoinGecko `/ohlc` | Canvas, green/red OHLC bodies (`--bull` / `--bear`) |
| TradingView | `s.tradingview.com/widgetembed` | iframe with CG ID → Binance symbol mapping |

**TradingView fallback:** if CG ID is not in the Binance mapping (`cg-to-binance.js`, ~50 top entries), the TV button is disabled with a tooltip "Not available for this token".

## Data Pipeline (Preload Strategy)

**On mount — parallel fetches:**
1. `GET /coins/{id}/market_chart?days=1` → instant 1D render (5-min intervals, ~288 points)
2. `GET /coins/{id}/market_chart?days=90` in background → hourly cache (~2160 points)

**Timeframe switching:**
- **1D** → from `days=1` cache
- **7D / 1M / 3M** → sliced from `days=90` cache (zero new fetches)
- **1Y** → on-demand `days=365` (daily granularity, ~365 points, fast)

**Candle mode:** parallel cache via CG `/ohlc` endpoint. Cannot be sliced from market_chart, so separate requests per timeframe. Cache keyed by timeframe.

**Requests go through:** `/api/cg-proxy/*` — existing proxy in research app (dev: Express `/api/cg-proxy`, prod: Vercel serverless). Confirm `/ohlc` path is supported; add it in the impl plan phase if missing.

## Timeframe Set

`1D / 7D / 1M / 3M / 1Y` (5 buttons, compact for narrow iframes).

Selecting a timeframe resets the slider window to 100% of the range.

## Range Slider (Brush)

Inspiration: the screenshot with tick marks + window handles.

- **Two handles** + draggable middle window.
- **Drag handle** → resize window from that side.
- **Drag window** → pan without resizing.
- **Double-click slider** → reset to 100%.
- **Mouse wheel on chart** → zoom slider window around cursor x.
- **Pinch on touch** → same as wheel.
- **Tick marks** under the slider with month labels (matches reference screenshot).
- **Hidden in TV mode.**

## Styling (Apple Cinematic, dark only)

- Container: `--bg-base` (#09090b), no external borders (iframe-friendly).
- Toolbar: `.glass-card` pill, segmented control (active = `rgba(255,255,255,0.08)` + `#f5f5f7`).
- Timeframe pills: same pattern as segmented control.
- Slider: glass bg, white handles, tick marks in `--text-muted`, labels in `--text-tertiary`.
- Numbers: `var(--font-mono)` (JetBrains Mono — main app rules, not website2).
- Line color: `--bull` if period close > period open, else `--bear`.
- Loading: shimmer skeleton matching chart shape. No spinner. No "Loading..." text.
- No day-mode: dark only per decision.

## Responsive

| Width | Behavior |
|-------|----------|
| ≥ 640px | Single-row toolbar |
| 480–640px | Toolbar wraps: types row on top, timeframes below |
| < 480px | Tick labels under slider hidden; handles remain |

Height: always `100vh`. Partner controls total size via `<iframe height=...>`.

## Error States

| Error | UI |
|-------|----|
| Invalid CG ID (404) | Centered "Token not found", `--text-tertiary` |
| Network failure | Auto-retry 3× with exponential backoff, then "Unable to load. Tap to retry." |
| No TV mapping | TV button disabled, tooltip "Not available" |

## Performance Targets

- First paint (1D line with skeleton) < 1s from route mount
- 1D line data rendered < 2s on cold load
- Timeframe switch to 7D/1M/3M < 100ms (slice from cache, no network)
- Slider drag: 60fps canvas rerenders (requestAnimationFrame-gated)

## Files to Create

```
apps/research/src/pages/embed-chart/
  index.jsx                    route wrapper, reads :cgId from params
  components/
    embed-chart.jsx            main container, state orchestration
    embed-chart.css            dark-only styles
    embed-chart.mobile.css     responsive breakpoints
    chart-toolbar.jsx          type toggle + timeframe pills
    line-chart.jsx             canvas line chart
    candle-chart.jsx           canvas candle chart
    tradingview-embed.jsx      TV iframe
    range-slider.jsx           brush slider
    use-embed-data.js          fetch + cache hook
    cg-to-binance.js           CG ID → Binance symbol map (~50 entries)
```

## Files to Modify

- `apps/research/src/components/auth-gate.jsx` — add `/embed` to `PUBLIC_ROUTES`
- `apps/research/src/App.jsx` — new `<Route path="/embed/chart/:cgId">` next to `/newsroom`, outside `AppShell` and `AuthGate`, lazy-loaded with `Suspense fallback={null}`
- (Possibly) `apps/research/api/cg-proxy.js` + `packages/server/index.js` — ensure `/coins/{id}/ohlc` endpoint proxied if not already

## Out of Scope

- Light theme (decision: dark only)
- Query-param configuration (decision: ID in path, no other config)
- Branding header / logo / "Open in Spectre" link (decision: minimal)
- +/− zoom buttons (replaced by slider + wheel + pinch)
- Multi-symbol comparison
- Indicators (RSI/MACD etc.) — those live in full Spectre app, TV mode covers that need
- Websocket live updates (polling only, if at all — to be decided in plan)

## Open Items for Implementation Plan

1. Verify `cg-proxy` supports `/coins/{id}/ohlc` in both dev (Express) and prod (Vercel). Add if missing.
2. Decide on live price updates: poll CG `/simple/price` every 30s? Or static snapshot on load?
3. Build `cg-to-binance.js` mapping — enumerate exact 50 tokens covered.
4. Confirm TradingView widgetembed URL format and minimum required params.
5. Confirm canvas chart rendering approach — native 2D canvas (per charts-system.md pattern) vs reuse existing `trading-chart.jsx`.
