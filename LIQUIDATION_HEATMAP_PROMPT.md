# LIQUIDATION HEATMAP CHART — BUILD PROMPT

> **Read `SPECTRE_DESIGN_LAW.md`, `CLAUDE.md`, and `src/index.css` BEFORE writing any code.**

---

## WHAT THIS IS

A **Liquidation Heatmap** — NOT a regular heatmap, NOT a treemap, NOT a market cap grid. This is a **price-chart-overlaid density map** showing where leveraged liquidation clusters exist above and below the current price. Think of it as a thermal camera pointed at the futures orderbook — it reveals where the pain is stacked.

**Reference:** https://www.coinglass.com/pro/futures/LiquidationHeatMap

---

## VISUAL ANATOMY (READ THIS CAREFULLY)

The chart has **4 distinct visual layers** composited onto a single canvas:

### Layer 1: Heatmap Background (THE CORE)
- The entire chart area is a **2D density field** rendered on `<canvas>`
- **X-axis** = time (horizontal, bottom)
- **Y-axis** = price levels (vertical, right side)
- Each pixel/cell represents a **liquidation leverage dollar amount** at that price level at that point in time
- Color scale: **dark purple (near zero) → blue → cyan/teal → green → yellow (highest concentration)**
- The color gradient max is labeled in the top-left corner (e.g., "37.42M" = max liquidation leverage value)
- Dense horizontal bands = price levels with heavy liquidation clustering
- This is NOT discrete cells — it should look like a smooth thermal/density field with horizontal banding

### Layer 2: Candlestick Price Overlay
- Standard OHLC candlesticks rendered ON TOP of the heatmap
- Green candles = bullish, Red candles = bearish
- The candlesticks trace the actual BTC price path through the liquidation field
- This shows how price navigates through liquidation zones — when price hits a dense band, cascading liquidations occur

### Layer 3: Right-Side Liquidation Level Distribution
- A **separate panel** on the right edge of the chart (~15% width)
- Shows a **horizontal bar chart / histogram** of cumulative liquidation levels at each price
- **Bars pointing LEFT from the right axis** = liquidation volume at that price level
- Color coding: 
  - **Blue/teal bars** = SHORT liquidation levels (above current price — shorts get liquidated if price goes UP)
  - **Green bars** = LONG liquidation levels (below current price — longs get liquidated if price goes DOWN)
  - Some implementations use red for longs instead of green
- A **price line (thin green/teal curve)** traces through this panel showing the price profile
- The current price is marked with a horizontal line/indicator
- This panel gives an instant read on: "How much liquidation firepower sits above vs below current price?"

### Layer 4: Interactive Overlays
- **Crosshair** on hover — vertical time line + horizontal price line
- **Tooltip** showing: Date/Time, Price, Liquidation Leverage value at that point
- Current price marker on the Y-axis

---

## DATA MODEL

```javascript
// Each data point in the heatmap grid:
{
  timestamp: 1711108500,      // Unix timestamp (x-axis position)
  price: 69748.86,            // Price level (y-axis position)  
  liquidationLeverage: 4200000 // Dollar amount of liquidations at this level (color intensity)
}

// The heatmap is a 2D matrix:
// rows = price levels (e.g., $65,000 to $73,500 in $10-$50 increments)
// columns = time intervals (e.g., every 5min or 15min candle)
// cell value = aggregated liquidation leverage in USD

// Right-side distribution bars:
{
  price: 69000,
  longLiquidation: 12500000,   // Total long liquidation leverage at this price
  shortLiquidation: 8200000,   // Total short liquidation leverage at this price
  type: 'long' | 'short'       // Determined by position relative to current price
}
```

---

## DATA SOURCES

Use the Coinglass API or build a proxy endpoint. Key data needed:

1. **Liquidation heatmap data** — aggregated liquidation levels across exchanges (Binance, OKX, Bybit) at each price point over time
2. **OHLCV candle data** — standard price candles (already available via Binance WebSocket or REST)
3. **Liquidation level distribution** — cumulative liq levels at each price for the sidebar histogram

If Coinglass API requires a paid key, build the endpoint at `/api/liquidation-heatmap` on the Express server with:
- Proxy to Coinglass public endpoints
- Fallback: Aggregate from Binance/OKX/Bybit futures liquidation streams
- Cache with 30-60 second TTL

---

## RENDERING APPROACH

**USE CANVAS, NOT SVG OR DOM ELEMENTS.**

The heatmap contains potentially tens of thousands of data points. DOM-based rendering will be unusable.

```
┌─────────────────────────────────────────────┬──────────┐
│                                             │          │
│          CANVAS (heatmap + candles)          │  RIGHT   │
│                                             │  PANEL   │
│   [density field with color bands]          │  (bars)  │
│   [candlesticks overlaid on top]            │          │
│   [crosshair + tooltip on hover]            │          │
│                                             │          │
├─────────────────────────────────────────────┤          │
│   Time Axis (bottom)                        │  Price   │
│   21,16:35  21,18:05  22,00:05  22,15:05   │  Axis    │
└─────────────────────────────────────────────┴──────────┘
```

### Canvas Architecture:
1. **Main canvas** — full chart area for heatmap density + candlestick overlay
2. **Overlay canvas** (stacked on top, transparent) — crosshair, tooltip, hover interactions
3. **Right panel** — can be a separate smaller canvas OR SVG since it's fewer elements
4. **Axes** — DOM elements positioned absolute around the canvas (price labels on right, time labels on bottom)

### Heatmap Rendering:
```javascript
// For each cell in the data matrix:
// 1. Map timestamp → x pixel position
// 2. Map price → y pixel position  
// 3. Map liquidationLeverage → color from gradient
// 4. Fill rect or use putImageData for performance

// Color gradient function:
function leverageToColor(value, maxValue) {
  const ratio = value / maxValue;
  // 0.0 = dark purple (#1a0533)
  // 0.2 = deep blue (#1e3a5f)  
  // 0.4 = teal (#0d9488)
  // 0.6 = cyan (#06b6d4)
  // 0.7 = green (#10b981)
  // 0.85 = yellow-green (#84cc16)
  // 1.0 = bright yellow (#eab308)
  // Use linear interpolation between stops
}
```

### Performance Requirements:
- Use `requestAnimationFrame` for smooth panning/zooming
- Use `ImageData` and `putImageData` for bulk pixel writes — do NOT use individual `fillRect` for each cell
- Debounce resize handlers
- Only re-render visible viewport on pan/zoom (virtual scrolling concept)
- Cache the heatmap as an offscreen canvas, only re-render on new data or timeframe change

---

## INTERACTIONS

### Zoom
- **Mouse wheel** = zoom in/out on both axes (or X-axis only with shift modifier)
- Zoom should feel smooth and centered on the cursor position
- Minimum zoom: full data range visible. Maximum zoom: individual candle-level detail
- Pinch-to-zoom on touch devices

### Pan
- **Click + drag** on the chart area = pan the viewport
- Pan should be inertial (slight momentum on release)
- Boundary clamping — don't let user pan beyond data range

### Hover / Crosshair
- Thin crosshair lines (1px, semi-transparent white) following cursor
- **Tooltip card** near cursor showing:
  ```
  22 Mar 2026, 16:15
  Price         69,748.86
  Liq Leverage  4.2M
  ```
- Tooltip styled as a glass card (matching Spectre design system)
- Price label appears on the right Y-axis at cursor height
- Time label appears on the bottom X-axis at cursor position

### Timeframe Controls
- Toolbar above chart: 1H, 4H, 12H, 1D, 3D, 7D, 1M
- Each timeframe adjusts: candle interval, heatmap resolution, data range
- Active timeframe gets accent highlight

### Symbol Selector
- Default: BTC. Allow switching to ETH, SOL, etc.
- Dropdown or pill selector above the chart

---

## Y-AXIS (RIGHT SIDE) — CRITICAL

The price axis is on the **RIGHT side**, not the left. This is standard for financial charts.

- Price labels in USD, formatted with commas: `$69,748`, `$70,000`, `$72,000`
- Labels spaced at round-number intervals that adjust with zoom level
- Current price highlighted with a small horizontal line extending into the chart area
- Font: JetBrains Mono, 11px, `rgba(255,255,255,0.6)`

## X-AXIS (BOTTOM)

- Time labels formatted as: `22, 04:35` (day, HH:MM)
- Spacing adjusts with zoom level
- Same font as Y-axis

---

## RIGHT PANEL: LIQUIDATION LEVEL SIDEBAR

This is the killer feature that shows WHERE the liquidity walls are.

```
Price ↑
73,460 |                          ▌▌  (short liq - small)
73,000 |                     ▌▌▌▌▌▌  (short liq - medium)  
72,000 |              ▌▌▌▌▌▌▌▌▌▌▌▌▌  (short liq - large cluster)
71,000 |         ▌▌▌▌▌▌▌▌▌▌▌         (short liq)
70,000 |====== CURRENT PRICE ======== (yellow/orange horizontal line)
69,500 |         ████████████          (long liq)
69,000 |    ██████████████████████     (long liq - DENSE)
68,000 |       █████████████████       (long liq - large cluster)
67,000 |              ███████          (long liq - medium)
66,000 |                   ██          (long liq - small)
65,524 |                               
```

- Bars grow LEFT from the right edge
- Short liquidation bars (above current price): blue/teal color
- Long liquidation bars (below current price): red/pink or green color
- A thin price line curves through the panel showing the price trajectory
- The current price has a distinct marker (yellow/orange horizontal line)
- Width: ~120-150px fixed, with its own scale

---

## COLOR SCALE LEGEND

Top-left corner of the chart:
- A vertical gradient bar (~20px wide, ~100px tall)
- Shows the min-to-max color range
- Max value labeled at top (e.g., "37.42M")
- "0" at bottom

---

## COMPONENT STRUCTURE

```
src/pages/LiquidationHeatmap/
├── index.jsx                          // Page wrapper
├── LiquidationHeatmap.css             // Styles
├── components/
│   ├── HeatmapCanvas.jsx              // Main canvas (heatmap + candles)
│   ├── HeatmapOverlay.jsx             // Crosshair + tooltip canvas
│   ├── LiquidationSidebar.jsx         // Right panel histogram
│   ├── HeatmapControls.jsx            // Timeframe, symbol selectors
│   ├── ColorScaleLegend.jsx           // Gradient legend
│   ├── PriceAxis.jsx                  // Right Y-axis labels
│   └── TimeAxis.jsx                   // Bottom X-axis labels
├── hooks/
│   ├── useLiquidationData.js          // Data fetching + WebSocket
│   ├── useHeatmapViewport.js          // Zoom/pan state management
│   └── useHeatmapRenderer.js          // Canvas rendering logic
└── utils/
    ├── colorScale.js                  // Leverage → color mapping
    ├── heatmapMath.js                 // Coordinate transforms, interpolation
    └── liquidationAggregator.js       // Raw data → heatmap matrix
```

---

## STYLING

Follow `SPECTRE_DESIGN_LAW.md` exactly:
- Background: transparent (inherits page background from CSS vars)
- Glass card container for the overall chart wrapper
- Controls use existing `GlassSelect` component
- Tooltip uses glass morphism: `backdrop-filter: blur(12px)`, `background: rgba(15,15,20,0.8)`, `border: 1px solid rgba(255,255,255,0.08)`
- All colors from `src/index.css` CSS variables
- Font for data: JetBrains Mono. Font for labels: Space Grotesk.
- No generic dark UI — this should look institutional and premium

---

## WHAT NOT TO DO

- DO NOT render the heatmap as a grid of `<div>` elements — it will be unusable
- DO NOT use a charting library like Recharts or Chart.js — they can't handle this visualization type
- DO NOT put the price axis on the left side
- DO NOT make the heatmap look like a discrete grid of colored squares — it should be a smooth density field with horizontal banding patterns
- DO NOT skip the right-side liquidation level histogram — that's the most actionable part
- DO NOT use placeholder/mock data — connect to real endpoints
- DO NOT forget zoom and pan — without them the chart is useless at any real data density
- DO NOT make the candlestick overlay opaque — it sits on top of the heatmap, so candle bodies should be semi-transparent or have thin outlines so the heatmap shows through

---

## SUCCESS CRITERIA

When done correctly, a user should be able to:
1. See instantly where heavy liquidation walls exist above and below current price
2. Watch price candles navigate through liquidation zones in real time
3. Zoom into a specific 2-hour window to see granular liquidation clusters
4. Hover any point and get exact price + liquidation leverage reading
5. Glance at the right sidebar and know: "There's $180M in long liquidations stacked at $68K — if price drops there, cascade incoming"
6. The visual should rival Coinglass quality — not look like a homework assignment
