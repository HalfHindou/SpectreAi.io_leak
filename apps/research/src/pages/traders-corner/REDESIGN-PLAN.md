# Traders Corner Redesign — design-system.md conformance

Scope (approved): **Both** the widgets AND the /traders-corner terminal.
Approach (approved): **inline styles → paired CSS files using design tokens** + `.app.app-day-mode` parity.

## Key facts
- `/traders-corner` route = the `tc-*` terminal in `index.jsx` + `TradersCorner.css` (1905 lines, already styled).
- `widgets/` folder renders on the **/you** dashboard via `pages/you/you-widget-registry.js` (NOT on /traders-corner).
- Dead code (no importers): `traders-corner/widget-registry.js`, `traders-corner/default-layouts.js`.
- Theme: research app uses `.app.app-day-mode .child` for light mode. Tokens live in `apps/research/src/index.css`.

## Token cheat-sheet (real vars)
- bg: `--bg-surface #111113`, `--bg-elevated #18181b`, `--bg-void`
- text: `--text-primary #f5f5f7`, `--text-secondary .6`, `--text-tertiary .5`, `--text-muted .35`
- trade: `--bull #10B981` (+ `-bright/-muted/-glow`), `--bear #EF4444` (+ variants), `--amber`
- border: `--border-subtle .03`, `--border-default .04`, `--border-strong .06`, `--glass-border`
- radius: `--radius-xs 4 / -sm 8 / -md 12 / -lg 16`; font: `--font-mono/body/display`
- motion: `--ease-out`, `--ease-spring`, `--duration-fast/base`

## Convention for widget CSS
- Shared primitives in `widgets/_widgets-base.css` (shimmer, empty state, labels, bull/bear helpers). Imported once in `you-widget-registry.js`.
- Each widget gets a paired `widgets/<Name>.css` with a unique class namespace, imported at top of the widget JSX.
- No hardcoded hex/rgba for tokens — use `var(--...)`. No inline `style={{}}` for static styling (dynamic values like bar widths/positions may stay inline).
- Every widget block needs `.app.app-day-mode` overrides where surfaces/borders differ.

## Reference conversions (done first, copy these)
- `ActiveAlerts.jsx` + `ActiveAlerts.css` — simple list widget.
- `LiquidationBars.jsx` + `LiquidationBars.css` — bar/data widget with dynamic widths.

## Batches
- B1 (price/data): PriceCard, OpenInterest, FundingHeatmap, FearGreedGauge, Watchlist
- B2 (liquidation): LiquidationBars*, LiquidationBubbles, LiquidationTimeline, LiquidationSummary
- B3 (flow/AI): WhaleAlerts, ExchangeFlows, ETFFlows, OnChainMetrics, AIScreener, AIBrief, SpectreVerdict, GhostMode
- B4 (charts): CVDChart, OrderBookDepth, TradingViewChart
- B5 (portfolio): PortfolioRing, Positions, ActiveAlerts*
- B6: terminal refresh (TradersCorner.css polish), then delete dead registry/layout files.

## Status
- [x] foundation `_widgets-base.css` (imported once in you-widget-registry.js)
- [x] reference: ActiveAlerts, LiquidationBars
- [x] B1 PriceCard(tcp) OpenInterest(tcoi) FundingHeatmap(tcfh) FearGreedGauge(tcfg) Watchlist(tcwl)
- [x] B2 LiquidationBubbles(tclbb) LiquidationTimeline(tclt) LiquidationSummary(tcls)
- [x] B3 WhaleAlerts(tcwa) ExchangeFlows(tcef) ETFFlows(tcetf) OnChainMetrics(tcom) AIScreener(tcas) AIBrief(tcab) SpectreVerdict(tcsv) GhostMode(tcgm)
- [x] B4 CVDChart(tccvd) OrderBookDepth(tcob) TradingViewChart(tctv)
- [x] B5 PortfolioRing(tcpr) Positions(tcpos) ActiveAlerts(tca) LiquidationBars(tclb)
- [x] B6 terminal conformance pass (TradersCorner.css: #fff→token; otherwise already compliant)
- [ ] dead-code removal (widget-registry.js, default-layouts.js) — RECOMMENDED, awaiting go
- [ ] visual QA on a running dev server (prod build blocked by unrelated @reown/PhVault dep)

## Result
- 23 widgets converted inline→paired CSS, 24 new CSS files (+ _widgets-base.css), all parse clean.
- PriceCard & LiquidationSummary intentionally have no day-mode block (colored card / theme-agnostic bull-bear only) — documented in-file.
