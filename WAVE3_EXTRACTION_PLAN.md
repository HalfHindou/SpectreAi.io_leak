# Wave 3 — Monolith Extraction Plan

25 files over 500 lines. Categorized by extractability and risk.

---

## TIER 1: EXTRACT NOW (clear section boundaries, low risk)

### 1. traders-corner/index.jsx — 2,172 lines → target ~600 lines

The file has 3 distinct zones separated by `// ══════` dividers:

| Extract To | Lines | What | Props Needed |
|-----------|-------|------|-------------|
| `components/tc-formatters.js` | 28-55 | fmt, fmtK, fmtPrice, cx, formatNewsTime | None (pure functions) |
| `components/tc-token-logo.jsx` | 58-64 | `Tk` component | s, sz |
| `components/tc-spark.jsx` | 67-85 | `Spark` inline chart | data, color, w, h |
| `components/tc-liq-treemap.jsx` | 88-313 | `LiqTreemap` (225 lines) | oi, liqData |
| `components/tc-funding-bars.jsx` | 316-366 | `FundingBars` + `FC` cell | data, h |
| `components/tc-external-heatmap.jsx` | 371-955 | `ExternalLiqHeatmap` canvas (584 lines) | data, klines, symbol, height |
| `components/tc-liq-heatmap-chart.jsx` | 968-1535 | `LiquidationHeatmapChart` canvas (567 lines) | klines, symbol, timeframe, height |

**After extraction:** index.jsx drops from 2,172 to ~600 lines (the main page component with state, data fetching, and layout). The 7 extracted components are pure — they receive props and render. No state coupling.

**Extraction order:** Start with formatters (zero risk), then small components (Tk, Spark, Shim), then the two big canvas components last.

---

### 2. ventures/components/ventures-page.jsx — 2,192 lines → target ~800 lines

| Extract To | Lines | What | Props Needed |
|-----------|-------|------|-------------|
| `ventures-formatters.js` | various | formatLargeNumber, gradeColor, fmtPct, hashColor | None (pure) |
| `ventures-dropdown.jsx` | 358-407 | `VenturesDropdown` | value, options, onChange |
| `ventures-grade-badge.jsx` | 430-462 | `GradeBadge` + `ScoreDelta` | grade, size, change |
| `ventures-signals-row.jsx` | 464-578 | `SignalsRow` | live, compact |
| `ventures-market-pulse.jsx` | 580-662 | `MarketPulse` + `MarketPulseStrip` + skeleton | signals, loading, onSymbolClick |
| `ventures-logo.jsx` | 663-708 | `LogoOrFallback` | logo, symbol, size |
| `ventures-score-widgets.jsx` | 710-776 | `DimensionMiniBars` + `ScoreGauge` | score, size |
| `ventures-deal-row.jsx` | 778-893 | `DealRow` + `ChangeCell` | project, onClick, index, livePriceRow |

**After extraction:** ventures-page.jsx drops to ~800 lines (main layout, filters, data fetching). 8 extracted components are all presentational.

---

### 3. watchlists/components/watchlists-page.jsx — 1,942 lines → target ~700 lines

| Extract To | Lines | What | Props Needed |
|-----------|-------|------|-------------|
| `watchlists-utils.js` | 31-112 | Chain helpers, hash, seededRandom, generatePath | None (pure) |
| `watchlists-sparkline.jsx` | 113-226 | `MiniSparkline` + `getSparkPoints` | data, width, height, positive |
| `watchlists-token-logo.jsx` | 227-260 | `getTokenLogo` + logo component | symbol, tokenLogo |

Need to scan deeper for more extraction candidates. The page likely has table rows, modals, and toolbar components that can be split.

---

## TIER 2: EXTRACT WITH CARE (larger, more coupled)

### 4. home/components/discovery-section.jsx — 1,852 lines

Single large component with heavy memoization. Internal sections (Top Coins table, On-Chain table, sparkline cache) could extract but share significant state. Need deeper analysis before splitting.

### 5. home/components/welcome-page.jsx — 1,789 lines

The main welcome page orchestrator. Already delegates to many sub-components (46 in the components/ folder). The file itself is mostly props-passing and tab switching logic. Extracting more would create prop-drilling without benefit.

### 6. heatmaps/components/heatmaps-page.jsx — 1,805 lines

Treemap rendering + grid layout. Canvas-heavy. Similar to bubbles — the rendering logic is tightly coupled to the layout logic.

### 7. categories/components/categories-page.jsx — 1,704 lines

Token grid with filters and sorting. Could extract filter bar, token card, and sort controls.

### 8. header.jsx — 1,670 lines

Shared component. Has search bar, notification bell, profile menu, market mode toggle. Could extract each section but risk is higher since it's imported everywhere.

### 9. x-dash/components/x-dash-page.jsx — 1,346 lines

Social intelligence dashboard. Multiple card types that could extract.

---

## TIER 3: LEAVE ALONE (high risk or being replaced)

| File | Lines | Reason |
|------|-------|--------|
| trading-chart.jsx | 4,390 | Being replaced by chart overhaul |
| bubbles-page.jsx | 2,513 | Canvas physics engine — splitting breaks the simulation loop |
| website2/index.jsx | 2,290 | Marketing page — mostly JSX, low bug risk |
| ai-charts-lab-page.jsx | 2,005 | Complex chart interactions, tightly coupled |
| mockEvents.js | 1,981 | Data file, not a component |
| useCodexData.js | 1,667 | Hook with 7 sub-hooks — already well-structured internally |
| website2/components/api-page.jsx | 1,256 | New work, will evolve |
| token-storybook.jsx | 1,206 | Canvas rendering, self-contained |
| x-bubbles-page.jsx | 1,329 | Canvas, same as bubbles |

---

## RECOMMENDED EXECUTION ORDER

1. **traders-corner formatters + small components** (3 commits, ~zero risk)
2. **traders-corner ExternalLiqHeatmap** (1 commit, 584 lines out)
3. **traders-corner LiquidationHeatmapChart** (1 commit, 567 lines out)
4. **ventures formatters + small components** (3 commits)
5. **ventures larger components** (3 commits)
6. **watchlists utils + sparkline** (2 commits)

Total: ~15 commits, each with build verification. Traders Corner goes from 2,172 → ~600. Ventures from 2,192 → ~800. Watchlists from 1,942 → ~700.

**All Tier 2 and Tier 3 files are deferred.** They need deeper analysis or are being replaced.
