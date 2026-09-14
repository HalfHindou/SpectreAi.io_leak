# Chart Section Redesign - Wall Street Terminal meets Apple

**Mode:** Founder / EXPANSION
**Scope:** TradingChart top bar + overall chart section UI/UX
**Reference:** TokenBanner (approved "Terminal Finance meets Apple Premium" aesthetic)

---

## F1. Architecture

### Current Layout (vertical stack in `content-main`)
```
┌────────────────────────────────────────────┐
│ TokenBanner  (ghost, terminal-dense)       │  ← approved aesthetic
├────────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐   │
│ │ CHART CONTROLS (dark pill groups)    │   │  ← OLD: heavy dark bg, bordered pills
│ ├──────────────────────────────────────┤   │
│ │                                      │   │
│ │         CHART CANVAS                 │   │
│ │                                      │   │
│ │                                      │   │
│ └──────────────────────────────────────┘   │
├────────────────────────────────────────────┤
│ DataTabs  (glass gradient, subtle)         │  ← updated aesthetic
└────────────────────────────────────────────┘
```

### Proposed Layout (cinematic integration)
```
┌────────────────────────────────────────────┐
│ TokenBanner  (unchanged)                   │
├────────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐   │
│ │                                      │   │
│ │  ┌─ OHLCV Legend (persistent)        │   │
│ │  │ O 2173.12 H 2198.44 L 2161.03    │   │
│ │  │ C 2187.56 V 12.4M  +0.66%        │   │
│ │  └───────────────────────────────────│   │
│ │                                      │   │
│ │         CHART CANVAS                 │   │
│ │                                      │   │
│ │──────── toolbar (inline, bottom) ────│   │  ← NEW: ghostly inline bar
│ │  TV ● ◷ ━ 👥 │ 1m 5m 15m 1H 4H 1D │   │
│ │  Price/MCap   │ ATH VWAP ⛶          │   │
│ └──────────────────────────────────────┘   │
├────────────────────────────────────────────┤
│ DataTabs  (unchanged)                      │
└────────────────────────────────────────────┘
```

### Key Architectural Changes

1. **Controls move INSIDE the chart** - toolbar becomes an overlay at the bottom of the chart canvas, not a separate div above. Fades to near-transparent when not in use.

2. **OHLCV data legend** - persistent overlay in top-left corner of chart, updates on crosshair movement. Shows Open/High/Low/Close/Volume with bull/bear coloring. This is what Bloomberg/TradingView Pro do.

3. **Container becomes borderless** - remove the card border, animated glow border, and card background. The chart canvas sits directly in the content flow with just the faintest separation gap. The chart IS the content.

4. **Keyboard shortcuts** - number keys for timeframes, letter keys for chart type. No UI needed - power users discover naturally.

### File Changes
```
Modified:
  apps/trading/src/components/TradingChart.jsx   (controls restructuring, OHLCV legend, keyboard shortcuts)
  apps/trading/src/components/TradingChart.css    (complete CSS rewrite for controls + container)

No new files needed - this is a reskinning + repositioning of existing elements.
```

### Dependencies
- TradingChart.jsx → useChartData (existing, no changes)
- TradingChart.jsx → lightweight-charts (existing, no changes)
- TradingChart.css → index.css tokens (existing, no changes)

---

## F2. Error Map

| Failure | User Impact | Recovery | Observability |
|---------|-------------|----------|---------------|
| Toolbar overlay clips chart canvas | Controls invisible or unclickable | z-index ordering (overlay > canvas, canvas > chart body) | Visual - obvious on render |
| Keyboard shortcuts conflict with browser | Browser captures key instead of chart | Only bind when chart container is focused/hovered; `e.preventDefault()` on matches | console.warn on conflict |
| OHLCV legend stale after token switch | Shows old token data briefly | Reset legend state in token change effect (already exists) | N/A - subsecond flash |
| Toolbar auto-fade conflicts with dropdown menus | Dropdown opens then toolbar fades away | Keep toolbar visible while any dropdown is open (check `tfDropdownOpen` state) | Visual - test with dropdown open |
| Fullscreen mode breaks overlay positioning | Controls float in wrong position | Fullscreen already has special CSS - overlay positioning adjusts via `.trading-chart.fullscreen .chart-toolbar-overlay` | Visual |
| Resize handle conflicts with bottom toolbar | Can't grab resize handle behind toolbar | Resize handle sits below toolbar (separate z-layer), or toolbar has gap/margin at bottom for handle | Visual |

---

## F3. Security

- No new inputs accepted (controls already exist, just repositioned)
- No auth boundary changes
- No new env vars or keys
- Keyboard shortcuts only fire when chart has focus (not globally)

---

## F4. Edge Cases

### Visual Edge Cases
- **Very narrow viewport (1000px)**: toolbar items overflow - use same responsive collapse as current (hide labels, icon-only mode)
- **Chart collapsed (200px height)**: toolbar + OHLCV legend may not fit - hide OHLCV legend when collapsed, show minimal toolbar
- **Fullscreen mode**: toolbar positioning changes from bottom-overlay to top-overlay (more screen real estate above)
- **xBubbles view mode**: OHLCV legend doesn't apply - hide it; toolbar shows different controls (2D/3D toggle, filters)
- **Holders chart view**: OHLCV legend doesn't apply - show holder count instead
- **Day/light mode**: all new overlay styles need `.theme-light` counterparts

### Interaction Edge Cases
- **Mouse leaving chart area**: toolbar stays at current opacity (don't flash-hide)
- **Tooltip open + toolbar fade**: keep toolbar visible while any popup/dropdown is open
- **Rapid timeframe switching**: debounce already exists in useChartData (no additional needed)
- **Touch devices (mobile embed)**: toolbar stays permanently visible (no hover-fade on touch)

---

## F5. Performance

### Re-render Analysis
- OHLCV legend updates on crosshair move (high frequency) - use `useRef` for position, only `setState` for OHLCV values when they change (compare previous values)
- Toolbar opacity animation via CSS only (no React re-renders for fade)
- Keyboard event listener via `useEffect` with cleanup - one listener, switch statement

### API Call Volume
- Zero additional API calls - all data comes from existing `useChartData` and crosshair events
- OHLCV values extracted from Lightweight Charts crosshair callback (already exists in the component)

### Bundle Impact
- No new dependencies
- Slight CSS reduction (removing heavy box-shadow/border rules)
- Net neutral or slightly smaller

---

## F6. Deferred Work

### NOT in scope (explicit exclusions)
1. **Drawing tools implementation** - button exists but is non-functional. Keep the button, don't build the feature.
2. **Indicators panel** - button exists but is non-functional. Keep the button, don't build the feature.
3. **Mobile-specific chart controls** - trading app has no mobile implementation yet. Skip mobile for this phase.
4. **xBubbles view redesign** - separate domain, separate phase.
5. **Chart type: Area** - removed from controls (was dead code). Can add back later.
6. **TradingView widget embed** - the "TV" button toggles Lightweight Charts mode, not actual TradingView widget. No changes to this.
7. **Crosshair glow effect** - nice-to-have cosmetic, skip for v1.
8. **Right-click context menu** - professional terminals have this, defer.

---

## Implementation Plan (ordered steps)

### Phase 1: Container Transformation (CSS-heavy)
Remove the heavy card treatment from `.trading-chart`:
- Kill animated gradient border (`::before`)
- Kill card background, heavy box-shadow
- Ultra-subtle container: `rgba(255,255,255,0.015)` bg, `rgba(255,255,255,0.04)` border (matching TokenBanner)
- Subtle `inset 0 1px 0 rgba(255,255,255,0.03)` top-light
- Keep `border-radius: 12px` to match TokenBanner + DataTabs

### Phase 2: OHLCV Data Legend (JSX + CSS)
Add persistent data legend overlay in top-left of chart:
- Position: absolute inside chart-content-area, top-left with padding
- Shows: symbol, O/H/L/C values (mono font), volume, change %
- Updates from Lightweight Charts crosshair subscriber (existing mechanism)
- Bull/bear coloring on close vs open comparison
- Subtle glass bg `rgba(0,0,0,0.4)` with `backdrop-filter: blur(8px)`
- Fades to 0.4 opacity when crosshair is not active, 1.0 on hover/crosshair

### Phase 3: Toolbar Repositioning (JSX restructure)
Move controls from above chart to INSIDE chart as bottom overlay:
- Restructure JSX: chart-controls div moves inside chart-content-area
- Position: absolute, bottom: 0, full width
- Split into left group (chart types + timeframes) and right group (tools)
- Ghost aesthetic: transparent bg, no pill containers around groups
- Individual buttons: ghost style (transparent, 0.4 opacity text, no border, no bg)
- Active button: 0.9 opacity text + faint underline or dot indicator
- Hover: 0.7 opacity text + `rgba(255,255,255,0.04)` bg
- Toolbar row bg: `linear-gradient(to top, rgba(9,9,11,0.6) 0%, transparent 100%)` - fade from chart bottom

### Phase 4: Toolbar Auto-Fade (CSS + minimal JS)
- Default state: toolbar at 0.35 opacity
- Hover on chart bottom 60px zone: toolbar fades to 1.0
- Any dropdown open: force 1.0
- CSS: `transition: opacity 0.3s ease`
- JS: track mouse Y position relative to chart, set CSS class

### Phase 5: Keyboard Shortcuts (JS)
- When chart container has focus/hover:
  - `1-7` keys → timeframe presets (1m, 5m, 15m, 1H, 4H, 1D, 1W)
  - `C` → candles, `L` → line, `H` → holders
  - `F` → fullscreen toggle
  - `V` → VWAP toggle
  - `A` → ATH lines toggle
- Small floating hint on first visit: "Press 1-7 for timeframes" (dismissible, localStorage flag)

### Phase 6: Polish & Day Mode
- Day mode overrides for all new overlay styles
- Smooth transitions on all state changes
- Verify fullscreen mode works with new positioning
- Verify collapsed state (200px) gracefully hides legend + shrinks toolbar
- Verify resize handle still works below toolbar

### Verification Checklist
- [ ] `npm run build:trading` passes clean
- [ ] Chart renders with new container style (no border glow)
- [ ] OHLCV legend shows correct data on crosshair move
- [ ] Toolbar visible at chart bottom, fades on idle
- [ ] All timeframe buttons work
- [ ] All chart type buttons work
- [ ] Dropdown menus render above toolbar (z-index correct)
- [ ] Fullscreen mode works
- [ ] Keyboard shortcuts work when chart focused
- [ ] Day/light mode looks correct
- [ ] Resize handle still functional
- [ ] No console errors
