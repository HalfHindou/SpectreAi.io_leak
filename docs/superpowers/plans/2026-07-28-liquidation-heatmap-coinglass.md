# Liquidation Heatmap CoinGlass-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Heatmap tab on `/liquidation-heatmap` visually and functionally match CoinGlass Pro Liquidation HeatMap (Model 1) using our free Binance/Bybit-derived cohort model.

**Architecture:** Server-side cohort synthesizer (`liq-heatmap-binance.js`, shared dev Express + prod serverless) keeps its ΔOI-cohort + eviction math but gets a CoinGlass leverage ladder and payload changes; the client canvas renderer gets the full CoinGlass anatomy: legend bar, percentile tone-mapping with a live Liquidity Threshold slider, readable candles, and a cumulative liquidity panel.

**Tech Stack:** Plain JS (no TS), canvas 2D, Express dev route `/api/charts/liq-heatmap` → same handler as Vercel prod. No test infra in this repo — each task verifies via curl probes / `npm run build:research` / browser.

## Global Constraints

- NO git commits/pushes — user gives explicit go separately (project memory rule).
- API envelope `{success, code, data.liqHeatMap:{chartInterval,end,chartTimeArray,priceArray,data:[[col,row,value]]}}` must not change (frontend contract).
- Every new visual element needs a day-mode counterpart (`dayMode` theme objects in the renderer, `.app.app-day-mode` in CSS).
- Design language: Spectre glass (design-system.md) — no CoinGlass blue buttons; shimmer skeletons, no spinners; no emojis.
- Mobile (canvas width ≤500px) must not regress: side panels collapse, chart still draws.
- `npm run build:research` + green `[check-critical-path]` after client changes.

---

### Task 1: Model rebalance — CoinGlass leverage ladder + visible band births

**Files:**
- Modify: `apps/research/api/_lib/handlers/liq-heatmap-binance.js`

**Interfaces:**
- Produces: same `buildBinanceLiqHeatmap()` return shape; `_stats` gains `mid_window_births` (int) for probing. `LEV_TIERS` export becomes the 4-tier CoinGlass ladder.

- [ ] **Step 1: Replace LEV_TIERS with the CoinGlass Model-1 ladder**

```js
// CoinGlass Model 1 leverage groups: 10x / 25x / 50x / 100x. High leverage
// (near-price) carries most weight — that is what creates the dense band
// cluster hugging price in their reference. 10x (≈10% away) keeps the far
// field present but sparse. Sums to 1.0.
export const LEV_TIERS = [
  { lev: 10,  w: 0.12 },
  { lev: 25,  w: 0.28 },
  { lev: 50,  w: 0.32 },
  { lev: 100, w: 0.28 },
]
```

Keep `MAINT_MARGIN = 0.005` and the projection formulas unchanged. Note: `calibrateSideTiers` stays unused (static ladder), leave as-is.

- [ ] **Step 2: Lower the server sparsify floor so the client slider owns the cut**

In the sparsify block change `const floor = maxVal * 0.004` → `const floor = maxVal * 0.001`. The server floor only trims payload; visibility decisions move to the client percentile threshold.

- [ ] **Step 3: Shrink the dead cushion**

Max liq distance is now 10x ≈ 10.5% (incl. margin). Change
`const cushion = Math.max(span * 0.5, maxP * 0.12)` →
`const cushion = Math.max(span * 0.35, maxP * 0.115)`.

- [ ] **Step 4: Add a seed damping knob + mid-window-birth stat**

Add near the top of `buildBinanceLiqHeatmap`:

```js
// Seed cohorts (standing OI) vs flow cohorts (ΔOI bursts): the seed is ~10x
// the flow notional, which under a percentile tone-map erases every band
// born inside the window. Damp the seed so window births stay visible.
// 1.0 = honest standing OI; tuned visually against the CoinGlass reference.
const SEED_DAMP = 0.5
```

Apply at the seed deposit sites: `standingUsd * SEED_DAMP * (seedW[i] / seedWSum)` and in the no-pre-window fallback `mkCohort(preLen, close[preLen], standingUsd * SEED_DAMP, ...)`.

After the accumulation pass, compute births for `_stats`:

```js
let midWindowBirths = 0
for (let t = 5; t < cols; t++) {
  for (let r = 0; r < rows; r++) {
    if (dense[t * rows + r] > 0 && dense[(t - 1) * rows + r] === 0) { midWindowBirths++; break }
  }
}
```

Add `mid_window_births: midWindowBirths` to `_stats`.

- [ ] **Step 5: Verify via API probe (server restarts on nodemon; else restart dev server)**

```bash
curl -s 'http://localhost:3001/api/charts/liq-heatmap?symbol=BTCUSDT&interval=1d&exchange=All' | python3 -c "
import json,sys
d=json.load(sys.stdin); s=d['_stats']; hm=d['data']['liqHeatMap']
print('cells', len(hm['data']), 'births', s.get('mid_window_births'), 'flow', s['flow_source'])"
```

Expected: cells > 5000, `mid_window_births` ≥ 15 (bands born inside the window exist), flow `delta-oi`. NOTE: the Express route caches 2 min per (exchange,symbol,interval) — bump a query param or restart to bypass while iterating.

### Task 2: Renderer — tone mapping + threshold + legend + candles + prints default

**Files:**
- Modify: `apps/research/src/pages/liquidation-heatmap/components/real-heatmap-chart.js`
- Modify: `apps/research/src/pages/liquidation-heatmap/components/heatmap-view.jsx`

**Interfaces:**
- Consumes: unchanged data shape from `useRealHeatmap`.
- Produces: `drawRealHeatmap(canvas, dims, data, klines, mouse, view, fmtPrice, opts)` — `opts` gains `threshold` (number 0.5–1.0, default 0.85). `heatmap-view.jsx` holds `const [threshold, setThreshold] = useState(0.85)` and passes it in opts.

- [ ] **Step 1: Percentile tone-map driven by `opts.threshold`**

Replace the fixed `LIQUIDITY_THRESHOLD = 0.6` block:

```js
const LIQUIDITY_THRESHOLD = Math.max(0.5, Math.min(1, opts?.threshold ?? 0.85))
```

and widen the visible ramp — survivors map from 0.15 (dim indigo, barely above floor) instead of 0.22, and `toneHi` uses the 99.9th percentile (`fsub[Math.floor(fvc * 0.999)]`). Most bands must land indigo/blue/teal; only the top ~1% reach yellow.

- [ ] **Step 2: Left color-scale legend**

Add `const legendW = opts?.hideSidebar ? 0 : 30` and shift `chartL` right by `legendW`. After the field paint, draw at x `chartL - legendW`:
- a 10px-wide vertical gradient bar (iterate 64 steps sampling `T.lut`, bottom = floor color, top = peak yellow), height = chartH, 3px radius;
- above it the max label `fmtK(toneHi)` in `9px FONT_MONO`, `T.textSecondary`, left-aligned at the bar's x, y = chartT - 2 (the existing 14px top inset holds it).

Day mode: bar uses `LUT_DAY` automatically via `T.lut`; label colors from `T`.

- [ ] **Step 3: Candles readable, CoinGlass-size**

In LAYER 2: `const bodyW = Math.max(2, Math.min(slotW * 0.8, 6))`; outline pass `lineWidth = bodyW + 1` (was +2); wick `lineWidth = 1`. Body outline padding 1px kept.

- [ ] **Step 4: Prints overlay off by default + smaller**

`heatmap-view.jsx`: `useState(true)` → `useState(false)` for `showPrints`.
`real-heatmap-chart.js`: radius clamp `Math.min(10, ...)` → `Math.min(5, ...)`, fill alphas 0.55/0.5 → 0.4.

- [ ] **Step 5: Threshold slider in the toolbar**

In `heatmap-view.jsx` toolbar (between exchange pills and the Liqs button):

```jsx
<div className="liqp-hm-threshold" title="Liquidity Threshold — hides cells below this percentile">
  <span className="liqp-hm-threshold-label">Threshold</span>
  <input
    type="range" min="0.5" max="1" step="0.01" value={threshold}
    onChange={e => setThreshold(parseFloat(e.target.value))}
  />
  <span className="liqp-hm-threshold-val">{threshold.toFixed(2)}</span>
</div>
```

Pass `threshold` into the draw `opts` and add it to the render effect deps.

- [ ] **Step 6: Verify draw path compiles + renders**

`npm run build:research` → clean + `[check-critical-path] OK`. Browser: open `/liquidation-heatmap`, confirm legend bar + max label, thin candles readable (no bubbles), slider moves → field visibly re-cuts instantly, no console errors.

### Task 3: Right cumulative liquidity panel (replaces bucket sidebar)

**Files:**
- Modify: `apps/research/src/pages/liquidation-heatmap/components/real-heatmap-chart.js` (LAYER 3 block)

**Interfaces:**
- Consumes: `field` Float32Array + `fieldW`, `lastPrice`, `priceToY`, theme `T` — all already in scope at LAYER 3.

- [ ] **Step 1: Replace the bucket-bar sidebar with CoinGlass cumulative curves**

Delete the buckets/bars/outline-curve code inside `if (sidebarW > 0) { ... }` and replace with:

```js
// CoinGlass right panel: cumulative liquidation liquidity from the current
// price outward, computed on the LATEST visible column. Green stepped curve
// above price = cumulative short-liq $, red below = cumulative long-liq $.
const lastCol = vEnd - vStart
let curRow = 0
if (priceArray) for (let r = 0; r < rows; r++) { if (priceArray[r] <= lastPrice) curRow = r }
const cumUp = new Float64Array(rows)
const cumDn = new Float64Array(rows)
let acc = 0
for (let r = curRow + 1; r < rows; r++) { acc += field[r * fieldW + lastCol]; cumUp[r] = acc }
let maxCum = acc
acc = 0
for (let r = curRow - 1; r >= 0; r--) { acc += field[r * fieldW + lastCol]; cumDn[r] = acc }
if (acc > maxCum) maxCum = acc
if (maxCum === 0) maxCum = 1

ctx.fillStyle = T.panelBg
ctx.fillRect(sideL, chartT, sidebarW, chartH)
const panelPad = 6
const panelW = sidebarW - panelPad * 2

// faint per-row bars (the raw standing liquidity at each level)
let maxRowV = 0
for (let r = 0; r < rows; r++) { const v = field[r * fieldW + lastCol]; if (v > maxRowV) maxRowV = v }
if (maxRowV > 0) {
  for (let r = 0; r < rows; r++) {
    const v = field[r * fieldW + lastCol]
    if (v <= 0) continue
    const y = priceToY(priceArray[r] + tickSize / 2)
    if (y < chartT || y > chartB) continue
    const bw = (v / maxRowV) * panelW
    ctx.fillStyle = r > curRow
      ? (T.dark ? 'rgba(16,185,129,0.16)' : 'rgba(5,150,105,0.16)')
      : (T.dark ? 'rgba(239,68,68,0.16)' : 'rgba(220,38,38,0.16)')
    ctx.fillRect(sideL + panelPad, y - 0.5, bw, 1)
  }
}

// stepped cumulative curves
function drawCum(fromRow, toRow, arr, color) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.beginPath()
  let started = false
  const step = fromRow <= toRow ? 1 : -1
  for (let r = fromRow; step > 0 ? r <= toRow : r >= toRow; r += step) {
    const y = priceToY(priceArray[r] + tickSize / 2)
    if (y < chartT - 2 || y > chartB + 2) continue
    const x = sideL + panelPad + (arr[r] / maxCum) * panelW
    if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
  }
  ctx.stroke()
}
drawCum(curRow + 1, rows - 1, cumUp, T.dark ? 'rgba(52,211,153,0.9)' : 'rgba(5,150,105,0.9)')
drawCum(curRow - 1, 0, cumDn, T.dark ? 'rgba(248,113,113,0.9)' : 'rgba(220,38,38,0.9)')

// hairline divider against the field
ctx.strokeStyle = T.borderDefault
ctx.beginPath(); ctx.moveTo(sideL + 0.5, chartT); ctx.lineTo(sideL + 0.5, chartB); ctx.stroke()
```

Bump `sidebarW` from 72 → 84 in both the renderer and the matching `SIDEBAR_W` constant in `heatmap-view.jsx` (drag-region math depends on it).

- [ ] **Step 2: Verify**

Browser: green curve grows upward from the price line, red downward, faint bars behind; hover/crosshair still lands correctly (regions shifted by legendW/sidebarW — test a drag on the price axis and on the chart body). Day mode toggle: panel readable on white.

### Task 4: CSS for the slider + toolbar polish

**Files:**
- Modify: `apps/research/src/pages/liquidation-heatmap/components/liquidation-page.css`
- Modify: `apps/research/src/pages/liquidation-heatmap/components/liquidation-page.mobile.css`

- [ ] **Step 1: Slider styles (Spectre glass)**

```css
.liqp-hm-threshold {
  display: flex; align-items: center; gap: 6px;
  padding: 0 8px; height: 26px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-default);
  border-radius: 8px;
}
.liqp-hm-threshold-label { font-size: 10px; color: var(--text-muted); letter-spacing: 0.04em; }
.liqp-hm-threshold-val { font-size: 10px; font-family: var(--font-mono); color: var(--text-secondary); min-width: 28px; }
.liqp-hm-threshold input[type="range"] {
  -webkit-appearance: none; appearance: none;
  width: 90px; height: 2px; border-radius: 2px;
  background: rgba(255, 255, 255, 0.15); outline: none;
}
.liqp-hm-threshold input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 10px; height: 10px; border-radius: 50%;
  background: #f5f5f7; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.app.app-day-mode .liqp-hm-threshold { background: rgba(15, 23, 42, 0.04); }
.app.app-day-mode .liqp-hm-threshold input[type="range"] { background: rgba(15, 23, 42, 0.15); }
.app.app-day-mode .liqp-hm-threshold input[type="range"]::-webkit-slider-thumb { background: #0f172a; }
```

Mobile css: hide the label text, shrink the track to 60px under 640px; the slider stays usable.

- [ ] **Step 2: Build**

`npm run build:research` → clean + check-critical-path OK.

### Task 5: Side-by-side verification vs CoinGlass

**Files:** none (verification only)

- [ ] **Step 1: API probes** — BTC 12h/1d/3d, ETH 1w, SOL 1d: cells > 0, `mid_window_births` ≥ 15 on 1d.
- [ ] **Step 2: Browser side-by-side** — our BTC 1d vs CoinGlass "Binance BTC/USDT 24 hour": band births + wedges present, density hugging price, dim-indigo majority / rare yellow magnets, legend max in same order of magnitude sanity (ours is a model — order-of-magnitude, not equality).
- [ ] **Step 3: Interactions** — slider re-cuts instantly; zoom/pan/pinch; click-to-pin; tooltip Liq Value + Cum; prints toggle on shows small bubbles that do NOT bury candles.
- [ ] **Step 4: Day mode + mobile ≤500px** — all new elements themed; mobile hides legend+panel (hideSidebar) and still draws field+candles.
- [ ] **Step 5: Console** — zero errors on the page.
- [ ] **Step 6: Tune** — if window-born bands are still invisible on BTC 1d, adjust `SEED_DAMP` (0.3–0.7) and re-probe; record the final value in the spec.
