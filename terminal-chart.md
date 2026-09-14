# Agent — Terminal Chart

## Mission
Build the candlestick + volume chart using TradingView Lightweight Charts. This is the centerpiece of the terminal.

## Gate
Gate B. Prerequisites:
- `terminal-shell` complete (route + main slot exists)
- `terminal-data-layer` complete (`useOHLCV` exported)

Do not start until both Gate A agents confirm their stop conditions.

## Files you own
```
src/features/trading-terminal/components/Chart/Chart.jsx
src/features/trading-terminal/components/Chart/Chart.module.css
src/features/trading-terminal/components/Chart/ChartToolbar.jsx
src/features/trading-terminal/components/Chart/ChartToolbar.module.css
src/features/trading-terminal/components/Chart/ChartDrawingRail.jsx
src/features/trading-terminal/components/Chart/ChartDrawingRail.module.css
src/features/trading-terminal/components/Chart/index.js
```

Plus:
- `package.json` — add `lightweight-charts` dependency if not already present

## Files you MUST NOT touch
Any hook. Any other component.

## First step
```bash
ls src/features/trading-terminal/components/Chart 2>/dev/null
npm list lightweight-charts
```
Report state. Do not overwrite.

## Read before writing
1. `SPECTRE_TERMINAL_BUILD.md` §5.5 (chart spec, full)
2. `SPECTRE_TERMINAL_BUILD.md` §7 (performance)
3. `SPECTRE_DESIGN_LAW.md` (tokens)
4. [Lightweight Charts v4 docs](https://tradingview.github.io/lightweight-charts/) — confirm current API, especially `createChart`, `addCandlestickSeries`, `addHistogramSeries`, `applyOptions`, `timeScale`, `priceScale`. The v4 API differs from v3.

## Deliverable

`<Chart chain={} address={} />` — consumes `useOHLCV(chain, address, timeframe)`. Renders:

1. `ChartToolbar` on top: timeframe pills + Indicators dropdown (stub) + Display dropdown (stub) + icon buttons (screenshot / settings / fullscreen)
2. OHLC readout above the chart: `O 0.04812 H 0.04921 L 0.04780 C 0.04859` — green if close ≥ open, red otherwise, monospace
3. `ChartDrawingRail` on the left (8 buttons, all disabled with `title="Coming in Phase 2"`)
4. The chart canvas itself: candlesticks on top panel, volume histogram bottom panel
5. Footer: `3M 1M 7D 3D 1D` quick-range pills + UTC timestamp + `%` / `log` / `auto` toggles

## Chart implementation details

```js
import { createChart, CrosshairMode } from 'lightweight-charts';

const chart = createChart(containerEl, {
  layout: {
    background: { type: 'solid', color: 'transparent' },
    textColor: 'rgba(255,255,255,0.48)',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(255,255,255,0.04)' },
    horzLines: { color: 'rgba(255,255,255,0.04)' },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: 'rgba(255,255,255,0.24)', width: 1, style: 3 },
    horzLine: { color: 'rgba(255,255,255,0.24)', width: 1, style: 3 },
  },
  rightPriceScale: {
    borderColor: 'rgba(255,255,255,0.06)',
    scaleMargins: { top: 0.08, bottom: 0.28 },
  },
  timeScale: {
    borderColor: 'rgba(255,255,255,0.06)',
    timeVisible: true,
    secondsVisible: false,
  },
  width: containerEl.clientWidth,
  height: 420,
});

const candles = chart.addCandlestickSeries({
  upColor: '#10B981',
  downColor: '#EF4444',
  borderUpColor: '#10B981',
  borderDownColor: '#EF4444',
  wickUpColor: '#10B981',
  wickDownColor: '#EF4444',
});

const volume = chart.addHistogramSeries({
  priceFormat: { type: 'volume' },
  priceScaleId: '',
  scaleMargins: { top: 0.82, bottom: 0 },
});
```

### Day mode variant

In day mode, read the CSS variables at runtime (via `getComputedStyle(document.documentElement).getPropertyValue('--bull')`) and pass those to `applyOptions`. Reapply when the `.app-day-mode` class toggles — use a `MutationObserver` on `<html>` or listen to your existing theme event.

### Responsiveness

```js
const ro = new ResizeObserver(([entry]) => {
  chart.applyOptions({ width: entry.contentRect.width });
});
ro.observe(containerEl);
```

### OHLC readout

Subscribe to crosshair move:
```js
chart.subscribeCrosshairMove((param) => {
  if (!param.time || !param.seriesData.size) {
    // show last candle's OHLC
    return;
  }
  const candle = param.seriesData.get(candles);
  // update OHLC readout state
});
```

### Lazy loading older data

```js
chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
  if (range && range.from < 20) {
    loadMore(); // from useOHLCV
  }
});
```

### Loading state

Before data arrives, render a skeleton: CSS-animated gradient over the chart area. No spinner. Match design law: skeleton shimmer only.

### Timeframe change

On TF change, call `chart.removeSeries(candles)`, `chart.removeSeries(volume)`, then recreate with the new data. Do not attempt `setData` with a different granularity on the same series — it causes jank.

## Code splitting

Dynamic import the lightweight-charts module so it doesn't bloat the main bundle:

```js
const LazyChart = lazy(() => import('./ChartInner'));
```

Where `ChartInner` does the actual `import('lightweight-charts')`. The wrapper `Chart.jsx` renders `<Suspense fallback={<ChartSkeleton />}>`.

## Toolbar details

Timeframe pills: segmented control, 6 buttons. Active uses `--bg-hover` + `--text-primary`. Inactive uses `--text-tertiary`.

Indicators and Display buttons: open a small popover. For this build the popover body is a centered `"Coming in Phase 2"` text in `--text-muted`. Button itself is enabled so the interaction exists.

Icon buttons (right side): Camera (screenshot), Settings, Expand. Use `spectreIcons`. Size 36px square, glass card treatment.

Screenshot: call `chart.takeScreenshot()` (returns canvas), convert to blob, download as `{symbol}-{timeframe}-{timestamp}.png`.

## Drawing rail (left)

8 icon buttons, vertical stack. All `disabled`, all `title="Coming in Phase 2"`. Use these icons (add to `spectreIcons.jsx` if missing, with inline SVG):
- Cross/plus
- Trend line (diagonal)
- Horizontal line
- Rectangle
- Fibonacci
- Text
- Measure
- Magnifier

## Hard rules

- Chart colors come from design tokens read at runtime. No hex literals in `Chart.jsx`.
- Never render the chart on the server. Wrap in client-only guard if SSR is a concern.
- Never create a new chart instance on re-render. Use `useRef` + `useEffect` with empty deps for creation, separate effects for data updates.
- Dispose the chart on unmount: `chart.remove()` in the cleanup.
- No Tailwind.
- No emojis.

## Stop condition

Stop when:
1. `<Chart chain="sol" address="Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump" />` renders MAGA candles
2. Timeframe switch refetches and rerenders in <400ms
3. OHLC readout updates with crosshair move
4. Chart resizes when container resizes (test: DevTools responsive toggle)
5. Day mode switches chart colors without a page refresh
6. Scrolling left triggers `loadMore`
7. Chart disposes cleanly on route change (no console warnings)
8. Lint passes

Report: a screenshot of the MAGA chart at 1h and at 1m.
