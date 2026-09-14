# Liquidation Heatmap — CoinGlass-parity rebuild (design)

**Date:** 2026-07-28 · **Owner:** Evgeniy · **Approved:** yes (chat)
**Scope:** the Heatmap tab only on `/liquidation-heatmap`. Levels / 3D Bubbles / Risk Zones tabs and the stats header are untouched.
**Reference:** https://www.coinglass.com/pro/futures/LiquidationHeatMap (Model 1) + coinank.com liq-heat-map.

## Problem (measured 2026-07-28, dev)

Data is NOT empty (13–28k cells on every TF/symbol) — the failure is model balance + rendering:

1. Barcode instead of wedges: SEED cohorts (standing OI ~$15B market-scaled) all enter before the display window → every band lives from col 0 across the full width. FLOW cohorts (ΔOI bursts, the thing that gives CoinGlass its band "births") are orders of magnitude smaller and vanish after tone mapping.
2. Even comb spacing: LEV_TIERS put heavy weight on 5x–15x (10–20% away from price) while entries cluster in a narrow close-price band → evenly spaced far-field lines. CoinGlass density hugs price (100x/50x/25x).
3. Uniform brightness: threshold 0.6 + 0.22 ramp floor + log compress all surviving lines into one color. CoinGlass: most bands dim indigo/blue, rare yellow magnets.
4. Candles buried: up to 600 "real liq print" bubbles (r≤10px) draw on top of the price path — this is the "price bars look terrible" complaint.
5. Missing CoinGlass chrome: no color-scale legend, no right cumulative liquidity panel, no Liquidity Threshold slider.

## Design

### 1. Model (`apps/research/api/_lib/handlers/liq-heatmap-binance.js`, shared by dev Express + prod serverless)

- Rebalance `LEV_TIERS` toward high leverage (100/50/25/10 primary); far tiers (5x) kept but light. Near-price band density must visibly exceed far-field.
- Rebalance seed vs flow so window-born bands are visible: seed keeps representing standing OI but must not drown ΔOI cohorts after normalization. Acceptance: on BTC 24h, a noticeable share of visible bands start mid-window.
- Widen the value dynamic range (no artificial compression server-side; keep raw $ values in cells, let the client tone-map).
- Keep: cohort math, eviction by high/low crossing, Bybit fallbacks, multi-venue OI seed, envelope shape (`{success, code, data.liqHeatMap}`) — frontend contract unchanged.

### 2. Renderer (`real-heatmap-chart.js`)

CoinGlass anatomy, Spectre design language:

- Left: vertical color-scale legend bar (viridis gradient) with the max cell value label.
- Field: viridis low-res grid → GPU upscale, full chart width (fix the right-side gap), 2px crisp bands, band birth/termination visible.
- Tone mapping: client-side percentile cut driven by the Liquidity Threshold slider (default 0.85, CoinGlass default), then log ramp over a wide range — most bands indigo/teal, top ~1–2% yellow.
- Candles: thin (3–5px), clearly readable over the field. Liq-print bubbles OFF by default (toggle stays), radius capped smaller when on.
- Right: cumulative liquidity panel replacing the bucket sidebar — stepped green curve above current price (cumulative short-liq $ from price upward), stepped red curve below (cumulative long-liq $ downward), subtle per-row bars behind.
- Keep: amber current-price line + pill, crosshair/tooltip (Liq Value + Cum-to-here), pins, zoom/pan/pinch, fullscreen, watermark, day mode (both themes for every new element).

### 3. Controls (`heatmap-view.jsx`)

- New: Liquidity Threshold slider (0.5–1.0, default 0.85), instant client-side re-render.
- Existing kept: symbol dropdown, timeframe dropdown, exchange pills, Liqs toggle (now default off), zoom, fullscreen.

### 4. Out of scope

Other tabs, stats header, CoinGlass Model 2/3, screenshot/share button, paid APIs, mobile layout redesign (mobile inherits the same canvas; just must not regress).

## Verification

- `npm run build:research` clean + check-critical-path OK.
- Browser side-by-side vs CoinGlass: BTC 24h, BTC 3d, ETH 1w — band texture (births, wedges, density near price), legend, cumulative panel.
- Candles readable on every TF; prints toggle on/off works.
- Day mode + mobile width (≤500px) sanity pass; console clean.
- API probe: cells non-zero for BTC/ETH/SOL across TFs (already true — must stay true).

## Execution log (2026-07-28, shipped to working tree, NOT committed)

All plan tasks done + three findings beyond the plan:

1. **The FABRIC population was the missing CoinGlass ingredient.** LEV_TIERS
   rebalance + SEED_DAMP=0.5 alone still rendered a barcode: ΔOI births bands
   on only ~half the candles and their notional drowned under the seed. Added
   per-candle micro-cohorts ∝ traded volume (total budget = damped standing
   OI, display window only, skipped on volume-fallback). That produced the
   woven near-price texture; with it, the CoinGlass default threshold 0.85
   works as-is (no 0.6 hack needed).
2. **Default vertical frame = candle range + 35% padding** (renderer), not the
   full synthesized grid — this is how CoinGlass frames the pane. The full
   grid (±11.5% for the 10x bands) stays reachable via price-axis zoom-out
   (priceZoom floor 0.25→0.1). Required clipping the field upscale + candles
   to the pane rect and clamping the price pill to the pane edge.
3. **Grid rows 240→600** so the visible slice renders 2-3px CoinGlass-fine
   lines ($25-30 bins on BTC). Heaviest payload (BTC 1M): 1.0MB raw / 162KB
   gzip, 2-min server cache — acceptable.
4. **Timeframe-switch bug found live:** `getExternalExchangeList` rides
   `fetchJSON`'s global 3.5s abort; one cold kline/prints fetch failing the
   `Promise.all` discarded a good heatmap response and left the OLD
   timeframe's chart under the NEW label. Candles + prints are now soft
   dependencies (`.catch(() => null)`); only the heatmap fetch is hard.
5. Floor color deepened ([56,8,88] / #380858) to match the CoinGlass zero.

Verified: BTC 12h/1d/3d/1M + ETH 1w + SOL 1d probes healthy
(`mid_window_births` 38-166); side-by-side zoom vs CoinGlass near-identical
texture; threshold slider instant; Liqs bubbles small + off by default; day
mode themed; tooltip/crosshair/pan OK; zero console errors; build clean 2x.
NOT verified on a real phone (Chrome-MCP can't resize a fullscreen window) —
the ≤500px hideSidebar path is unchanged code, but worth one device glance.
