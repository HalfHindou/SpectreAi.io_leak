# Liquidation Heatmap 2.0 — Design

**Date:** 2026-07-28
**Owner:** Evgeniy
**Scope decision:** one killer heatmap (the main Heatmap view on `/liquidation-heatmap`), approach "C: everything", app-lane only (no new infra, no Hetzner deploys).

## Problem

The current heatmap is 100% synthetic: a cohort model in
`apps/research/api/_lib/handlers/liq-heatmap-binance.js` built from Binance klines +
OI history + top-trader long/short ratio, with a **hardcoded leverage-tier
distribution** (5x–125x guessed weights) and a seed notional set to an arbitrary
`1.5 × window volume`. The renderer (`real-heatmap-chart.js`) blurs the bands into a
muddy green/yellow smear. No real liquidation data touches the page.

## Data reality (verified 2026-07-28)

- **Our own Spectre data-api box already runs a real multi-exchange liquidation
  tape**: `GET /data-api/v1/derivatives/liquidations?asset=&limit=&offset=`
  (dev via Vite proxy; server-side via `SPECTRE_API_BASE` + `X-API-Key`).
  Live-probed: Bybit (full `allLiquidation` feed) + OKX, ~17.8k events / $238M per
  24h, asset filter + pagination work, history reaches ≥7 days
  (offset 5000 on BTC → Jul 21). Fields: `time, time_unix, asset, exchange, side,
  quantity, price, usd_value`.
- Free REST open interest: Binance `openInterestHist` (30d), Bybit
  `/v5/market/open-interest`, OKX `/api/v5/public/open-interest`, Hyperliquid
  `POST api.hyperliquid.xyz/info {"type":"metaAndAssetCtxs"}` (current snapshot
  only). All keyless.
- Binance fapi is geo-blocked from Vercel IPs — the existing Bybit mirror fallback
  in `liq-heatmap-binance.js` MUST be preserved.
- CoinGlass liquidation-heatmap API = paid only; `COINGLASS_API_KEY` is referenced
  in code but not configured. Not used by this design.
- Spectre `/v1/derivatives/heatmap/` exists but returns "No heatmap data cached" —
  the existing tier-1 attempt in `charts-proxy.js` stays as-is (harmless fallthrough).

## Design

### 1. Model upgrade — `apps/research/api/_lib/handlers/liq-heatmap-binance.js`

Keep the cohort/eviction core (VP entry distribution, per-tier liq projection,
crossing eviction, sparse grid output). Change two inputs:

1. **Seed notional = real aggregate OI.** Fetch current OI from Binance + Bybit +
   OKX + Hyperliquid in parallel (8s timeouts, each fail-soft). Seed cohorts are
   sized by `sum(available venue OI in $)` instead of `1.5 × window volume`.
   If every venue fails, fall back to the current volume heuristic (never blank).
2. **Calibrated leverage mix.** New module
   `apps/research/api/_lib/handlers/liq-leverage-calibration.js`:
   - Pull the real tape for the asset (≤6 pages × 500, newest-first, stop when
     older than 7d).
   - For each event, for each candidate leverage L in the tier ladder, the implied
     entry price is `liq ÷ (1 − 1/L)` (long) / `liq ÷ (1 + 1/L)` (short).
     Weight each candidate L by the volume actually traded at that entry price
     (the VP the synthesizer already builds). Normalize per event, aggregate
     across events → empirical per-asset tier weights.
   - Cache in-memory per asset 6h. If the asset has <100 tape events in 7d, use
     the existing static `LEV_TIERS` unchanged.
   - Long and short sides get separate mixes (long-liq events calibrate long
     tiers, short-liq events short tiers).

Response gains `_stats.calibration: 'tape'|'static'` and `_stats.oi_venues` so the
UI/debug can tell what powered a given build.

### 2. New endpoint — real prints

`GET /api/charts/liq-prints?symbol=BTCUSDT&hours=72`

- Server maps page symbol → tape asset (strip `USDT`, handle `1000X` prefixes via
  the same mapping traders-corner uses).
- Pulls tape pages until the window is covered (≤6 × 500) and returns
  `{ events: [{t, p, side, usd, ex}], window_covered_hours, truncated }` —
  capped at the largest ~1500 events by `usd` when over.
- Dev: inline Express route in `packages/server/index.js` next to the existing
  `/api/charts/liq-heatmap` (~line 10977). Prod: new branch in
  `apps/research/api/_lib/handlers/charts-proxy.js` (the `/api/charts/*` rewrite
  already exists in `vercel.json`). CDN: `s-maxage=60, stale-while-revalidate=120`.
- Client: fetched by the page alongside the heatmap, cached 60s via the existing
  `cached()` helper in `tradersCornerApi.js`.

### 3. Renderer rewrite — `real-heatmap-chart.js` (canvas 2D stays)

- **Colormap:** near-black navy → deep blue → cyan → green → yellow, log/percentile
  normalized (p99 cap + gamma) so clusters glow and noise stays dark. Day-mode
  variant with a light-base ramp (design-system rule H).
- **Sharp bands:** no gaussian upscale blur; crisp row scaling with ≤1px feather.
- **Real prints overlay** (toggle, default ON): bubbles at (time, price),
  radius ~ log(usd), `--bear` for long liqs / `--bull` for short liqs, thin white
  stroke. On timeframes longer than tape depth, a small caption
  "prints: last 7d" renders in the corner.
- **Crosshair + tooltip:** hover snaps to (col,row) → price level, est. $ at that
  level, cumulative $ between current price and the hovered level, column time.
  Hovering a bubble shows the exact event (exchange, side, $, time). Tooltip is a
  DOM element (not canvas text), monospace numbers.
- **Clickable levels:** click a band row → pinned horizontal line + label
  (`$63,400 · ~$1.2B longs`). Click the line again (or its ×) to unpin. Multiple
  pins allowed; pins survive timeframe switches within the session (component
  state only, not persisted).
- **Right profile:** rebuilt sharp — standing liquidation density at the latest
  column, split above/below current price in side colors.
- **Exchange toggle:** `All / Binance / Bybit / OKX` pill row. Filters the prints
  overlay client-side; for the model it re-requests `/api/charts/liq-heatmap`
  with the existing `exchange` param (Binance and Bybit are real sources today;
  OKX selection applies to prints only and the model stays aggregate — labeled so).
- **Keep:** timeframe ladder (12h–1y), symbol picker, zoom/fullscreen behaviors,
  shimmer loading states, mobile CSS hooks.

### 4. Error handling / degradation

- Every upstream fetch: `AbortSignal.timeout(8000)`, individual catch, degrade to
  the next tier. The heatmap NEVER renders blank because a venue is down.
- Prints endpoint failure → overlay silently absent (heatmap unaffected), toggle
  shows a disabled state.
- Calibration failure → static tiers (silent, flagged in `_stats`).
- No fabricated data anywhere: if the tape has no events for an asset, the
  overlay is empty and says so — never synthetic dots.

### 5. Verification

1. `npm run build:research` + green `[check-critical-path]`.
2. `curl` dev: `/api/charts/liq-heatmap?symbol=BTCUSDT&interval=3d` shows
   `_stats.calibration` + `oi_venues`; `/api/charts/liq-prints?symbol=BTCUSDT&hours=72`
   returns real events.
3. Browser (visible tab): BTC 12h/3d/1M, ETH, SOL, one thin alt — bands sharp,
   prints plotted, tooltip numbers sane, pins work, exchange toggle filters,
   day mode ramp, zero console errors.
4. Side-by-side sanity vs CoinGlass BTC heatmap: major band positions within ~1
   price bin.

### Out of scope

- The other page views (Map, Levels, Zones, 3D) — untouched.
- Traders-corner widgets (incl. the hardcoded `LiquidationTimeline`) — untouched.
- Any Hetzner/data-api change (a persistent collector spec can be a later doc).
- CoinGlass API integration.
