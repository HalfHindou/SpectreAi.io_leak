# Tokenized Assets — Design Direction

> Overhaul spec for `/tokenized-assets`. Reference only. No code yet.
> Tokens live in `apps/research/src/index.css`. Mobile base in `apps/research/src/styles/mobile-2026.css`. Do not invent new tokens — extend existing ones.

---

## 1. Page architecture

### 1.1 Top-of-fold (new)

```
+---------------------------------------------------------------+
| Tokenized Real World Assets                      [Updated 4m] |
| Stablecoins, treasuries, credit, commodities, infrastructure. |
+---------------------------------------------------------------+
| [ Total Value ]  [ 30D Change ]  [ Holders ]   [ Issuers ]    |
+---------------------------------------------------------------+
| Overview · Stablecoins · Treasuries · Credit · Commodities    |
| · Infrastructure · Screener                       [filter ⌄]  |
+---------------------------------------------------------------+
```

- Hero band compressed to ~200px: eyebrow + h1 + one-line description + live-refresh chip.
- 4-card KPI strip **always visible** across every tab (the cards reskin per tab — same shape, new metrics). Sticky until scroll-past.
- Tab bar sticky below KPI strip (56px), scroll-snapping on mobile.

### 1.2 Tab count: 7 → 6 + Screener (decision)

**Keep Networks and Platforms as separate tabs. Merge them only visually under an "Infrastructure" group label in the tab bar.** Rationale: Networks (Ethereum, Polygon, Stellar, Avalanche) and Platforms (Ondo, Securitize, Franklin) answer orthogonal questions — "where is the value settled" vs "who issued the wrapper." Merging them loses the %-Distributed-per-chain vs AUM-per-issuer distinction, which is the single most-linked data point on rwa.xyz.

Final bar: **Overview · Stablecoins · Treasuries · Credit · Commodities · Networks · Platforms · Screener** (8 slots, but Networks + Platforms live under an "Infrastructure" label visually).

### 1.3 Screener (new, cross-cutting)

Not a tab clone. A full-page filter surface that cross-slices every asset class. Preset chips on top, filter grid below, dense result table. See §3 `ScreenerChips`.

---

## 2. Per-tab blueprint

Every tab shares the same vertical rhythm (8 of these, not 7):

1. **4-card KPI strip** (tab-specific metrics)
2. **AI Analysis Card** (§3 `AIAnalysisCard`)
3. **Hero chart + 3-axis slicer** (§3 `SlicerControl`)
4. **Two-up section** (donut/bars + breakdown OR flow + peer comparison)
5. **League table** (§3 `MarketShareTable`) — row click → `AssetDetailPanel`
6. **Asset-class widget** (unique per tab)

### 2.1 Overview
```
+---------------- KPI strip ----------------+
| Total Value | MoM Growth | Holders | Nets |
+-------------------------------------------+
| [🧠 Spectre Brain · 4h]                   |
|  AI takes the pulse of RWA. Net growth... |
+-------------------------------------------+
| [Asset Type × Metric × Grouping] slicer   |
| [   Hero chart, 360px, timeframe pills ]  |
+-------------------------------------------+
| Class split donut │  Top 10 issuers list  |
+-------------------------------------------+
| League table: top 25 protocols across all |
+-------------------------------------------+
| Widget: CLASS SHARE RACE (stacked bars    |
|   over 90D showing mix evolution)         |
+-------------------------------------------+
```
- **KPIs:** Total RWA Value · 30D Δ · Holders (unique) · Active Networks
- **Slicer axes:** Class (All / Stables / Treasuries / Credit / Commodities) × Metric (Value / Holders / Flows) × Grouping (Class / Network / Platform)
- **Widget:** 100%-stacked area, asset-class mix over 90D.

### 2.2 Stablecoins
```
[KPI: Supply │ 30D Δ │ Holders │ De-Pegs 30D]
[AI Analysis]
[Slicer: Peg currency × Metric × Grouping(Issuer/Network)]
[Supply chart 360px]
[Peg stability cards (2-col)  │  Issuer share bars]
[League table: issuers w/ market-share bar behind %]
[Widget: PEG STABILITY GRID — 2-col cards]
```
- **KPIs:** Total Supply · 30D Δ · Unique Holders · De-Peg Events (30D)
- **Peg grid redesign:** current 4-col cramped → **2-col cards, 144px tall**, each with peg label, current deviation (mono, big), 24h min/max range as inline bar, sparkline of last 24h peg, 3 issuers carrying it (logos).

### 2.3 Treasuries
```
[KPI: AUM │ 30D Δ │ Wgt Avg Yield │ Duration]
[AI Analysis]
[Slicer: Maturity bucket × Metric × Grouping(Issuer/Custodian)]
[AUM chart 360px]
[Yield curve │ Top issuers bars]
[League table: products w/ yield + AUM bars]
[Widget: MATURITY LADDER — stacked bars 0-3M, 3-6M, 6-12M, 1-3Y, 3Y+]
```
- **KPIs:** AUM · 30D Net Flows · Weighted-Avg Yield · Avg Duration (months)

### 2.4 Credit
```
[KPI: Active Loans │ Outstanding │ Avg APY │ Default Rate]
[AI Analysis]
[Slicer: Pool type × Metric × Grouping(Vintage/Borrower type)]
[Outstanding chart 360px]
[Active vs Repaid │ Top pools bars]
[League table: pools w/ APY + utilization bar]
[Widget: VINTAGE HEATMAP — rows=origination quarter, cols=months-since, cells=repayment rate]
```
- **KPIs:** Outstanding Principal · Active Loans · Wgt Avg APY · 90D Default Rate

### 2.5 Commodities
```
[KPI: Total Value │ 30D Δ │ Gold Share │ Silver Share]
[AI Analysis]
[Slicer: Metal × Metric × Grouping(Issuer/Network)]
[Value chart 360px]
[Gold vs Silver split donut │ Spot premium/discount]
[League table: tokenized metals]
[Widget: GOLD vs SILVER SPLIT — paired bars w/ vault attestation timestamps]
```
- **KPIs:** Total Value · 30D Δ · Gold Share % · Silver Share %

### 2.6 Networks (Infrastructure-A)
```
[KPI: Chains Active │ Total RWA TVL │ Top Chain Share │ Cross-Chain Assets]
[AI Analysis]
[Slicer: Class × Metric × Grouping(Chain/L1-vs-L2)]
[TVL chart 360px, stacked by chain]
[Chain share donut │ %-Distributed per chain bars]
[League table: networks w/ TVL + class mix inline bars]
[Widget: CHAIN COMPARISON — rows=chains, cols=%Distributed, Tx cost, Finality, Issuers]
```
- **%-Distributed** = share of supply actually held by non-issuer wallets (the metric rwa.xyz doesn't surface clearly — our edge).

### 2.7 Platforms (Infrastructure-B)
```
[KPI: Platforms Tracked │ Combined AUM │ Top Platform Share │ New This Quarter]
[AI Analysis]
[Slicer: Asset class × Metric × Grouping(Platform/Jurisdiction)]
[AUM per platform chart 360px]
[Jurisdiction donut │ Platform growth bars]
[League table: platforms w/ AUM + class mix]
[Widget: SERVICE PROVIDER MAP — issuer → custodian → auditor relationships, compact tri-column]
```

### 2.8 Screener (cross-cutting)
```
[Preset chips: Treasury Mgmt · Yields · Growth · Blue-chip · New]
[Min-AUM tier buttons: $1M+  $10M+  $100M+  $1B+]
[Filter row: Class · Network · Issuer · Peg · Yield-range]
[Dense table: 100 rows, all columns, virtualized]
```

---

## 3. New visual components

Every one of these gets built once in `apps/research/src/pages/tokenized-assets/components/` with a paired CSS file prefixed `ta-` (tokenized-assets). No cross-tab forks.

| Component | Spec |
|---|---|
| **`KpiCard`** (`ta-kpi`) | 180px wide × 112px tall. Label (`.caption`, `--text-tertiary`). Value (display-md, `var(--font-mono)`, `font-variant-numeric: tabular-nums`, `letter-spacing: -0.02em`). 30D delta chip (bull/bear muted bg, arrow + %). Optional 24px sparkline, right-aligned. Hover: `translateY(-1px)`, border brightens. |
| **`SlicerControl`** (`ta-slicer`) | Three segmented controls in a row. 32px tall, pill-grouped. Active segment: `--bg-elevated` bg, `--text-primary`. Inactive: transparent, `--text-tertiary`. 8px gap between the 3 groups, each labeled above (`subheading`, 10px uppercase). |
| **`MarketShareTable`** (`ta-table`) | 44px rows (desktop), 56px (mobile as cards). Columns: rank (10px `.caption`), logo (24px), name + ticker (2-line), metric (mono, right-align), **inline share bar** behind the %-cell — `linear-gradient(to right, var(--accent-muted) 0%, var(--accent-muted) var(--pct), transparent var(--pct))` as row-cell background, % text overlaid in mono. 30D delta chip, sparkline (80px wide). Row hover → `--bg-hover`. Click → opens `AssetDetailPanel`. |
| **`AIAnalysisCard`** (`ta-ai`) | Glass card, 160px tall desktop, collapsible on mobile. Left: 32px Brain glyph + "Spectre Brain" chip (pill, `--accent-muted` bg). Body: 2–3 sentences, `body-lg`, 1.5 line-height. Bottom row: timestamp (`.caption`) + "What changed today" highlight pill (bull/bear bg) + refresh button. Refresh every 4h server-side. |
| **`AssetDetailPanel`** (`ta-drawer`) | Right-side drawer, 560px wide desktop (40vw max), full-screen on <768px. Slide-in 320ms `--ease-out`. Sections collapsible: **Market Data · Product Metrics · Tokens · Primary Market · Service Providers**. Each section has a 16px tall header with chevron. Close via ESC, overlay click, or drawer-swipe on mobile. |
| **`MaturityLadder`** (`ta-ladder`) | Horizontal stacked bar. 5 buckets: 0-3M, 3-6M, 6-12M, 1-3Y, 3Y+. Single palette (cyan→blue progression). Labels below each segment (mono AUM + % share). 80px tall. |
| **`VintageHeatmap`** (`ta-heatmap`) | Grid: rows = origination quarter (8 rows), cols = months-since-origination (24 cols). Cell color: repayment rate, linear-interpolated from `--bear-muted` (low) → `--bull-muted` (high). Hover cell → tooltip with quarter, MoS, repayment %, loan count. |
| **`FlowBars`** (`ta-flows`) | Horizontal inflow/outflow bars. Transaction buckets: $0–100k, $100k–1M, $1M–10M, $10M+. Left = outflow (bear muted), right = inflow (bull muted), zero in middle. Count + USD overlaid. |
| **`ScreenerChips`** (`ta-chips`) | Row 1: preset chips (pill, 32px tall, `--bg-surface` default, active = `--accent-muted` bg + `--border-accent` border). Row 2: Min-AUM tier buttons (segmented group, tabular-nums). Row 3: dropdown filters (glass-select). |
| **Chart upgrade** | Every chart currently 200px → **360px default (desktop), 480px expanded, 240px mobile**. Timeframe pills above every chart: `7D · 30D · 90D · 1Y · All`. Pills in a segmented group right-aligned above the chart. Chart y-axis: tabular-nums, abbreviated ($1.2B). Gridlines at `rgba(255,255,255,0.04)`. |

---

## 4. Color + typography

### 4.1 Categorical palette (single source, 8 + Other)

Every donut, stack, legend uses this exact ordered palette. No per-tab palettes.

```
--ta-cat-1: #06B6D4   /* cyan     — existing --cyan */
--ta-cat-2: #10B981   /* bull     — existing --bull */
--ta-cat-3: #F59E0B   /* amber    — existing --amber */
--ta-cat-4: #3B82F6   /* blue     — existing --blue */
--ta-cat-5: #EC4899   /* pink     — existing --pink */
--ta-cat-6: #A78BFA   /* violet   — existing --violet */
--ta-cat-7: #34D399   /* bull-bright */
--ta-cat-8: #F87171   /* bear-bright (use only when pair needs warning tone) */
--ta-cat-other: rgba(245, 245, 247, 0.20)  /* "Other" grey */
```
All eight already exist in `index.css`. Zero new hex. The order is the assignment order — element N gets `--ta-cat-{N}`. "Other" is always `--ta-cat-other`.

### 4.2 Deltas (existing tokens, no new values)

- **Positive:** `--bull` (`#10B981`) with `--bull-muted` (`rgba(16, 185, 129, 0.08)`) as chip bg.
- **Negative:** `--bear` (`#EF4444`) with `--bear-muted` (`rgba(239, 68, 68, 0.08)`) as chip bg.

(Note: request mentioned `#00E5A6` and `#FF4D6D` — we already ship `#10B981` / `#EF4444`. Use ours. Do not introduce a second green.)

### 4.3 Typography

- **KPI value:** `var(--font-mono)` + `font-variant-numeric: tabular-nums` + `letter-spacing: -0.02em`, 32px desktop / 28px mobile, weight 600.
- **KPI label:** `.caption` / `.subheading` — 11px uppercase, `letter-spacing: 0.08em`, `--text-tertiary`.
- **Table numbers:** `var(--font-mono)`, tabular-nums, right-aligned, 14px.
- **Chart axis labels:** `var(--font-mono)`, 11px, `--text-muted`.
- **AI body:** `var(--font-body)`, 17px, line-height 1.5, `--text-primary`.

### 4.4 Rows

- Table row: 44px desktop, 56px mobile-card. Logo-forward: 24px token/issuer logo at left, never a color chip substitute.

---

## 5. Mobile direction

Builds on `apps/research/src/styles/mobile-2026.css`. Breakpoint: 768px.

- **KPI strip:** horizontal scroll-snap, 80% card width, 1.2 cards in viewport at rest.
- **Tabs:** horizontal scroll-snap, 56px tall, tab underline remains.
- **AI Analysis Card:** collapsed by default, 56px tall (header + chevron). Expand animates height to auto.
- **Hero chart:** full-bleed, 240px tall. Timeframe pills swipe horizontally (not all at once).
- **Slicer:** stacks to 3 rows, each a segmented control 40px tall.
- **Tables → cards:** below 768px, every `MarketShareTable` row becomes a 112px tall card — logo top-left, name+ticker, metric big-mono right, share bar spans full width bottom, delta chip under. Tap → AssetDetailPanel slides up full-screen.
- **Peg grid:** 2-col cards at all breakpoints. On mobile it stays 2-col, cards shrink to 128px.
- **AssetDetailPanel:** slide-up full-screen, 16px drag handle at top, scrollable.

---

## 6. Anti-slop rules (build-time checklist)

1. **No rainbow palettes.** One ordered palette. One Other-grey. Zero per-tab hex.
2. **No sparkline + giant chart on the same card.** Sparklines live in table rows and KPI cards only. Big chart is the hero, once per tab.
3. **No "Share on X" buttons.** None. The page is a data surface, not a share-shelf.
4. **No mini stats with a name but no number** ("Top Platform: Ondo" alone). Every label pairs with a metric ("Ondo $4.2B · 28% share").
5. **No auto-classification by name keyword.** Filters come from the backend enrichment fields (`asset_class`, `network`, `issuer_type`, `peg_currency`). If the backend lacks the field, add it — do not infer from string matching on the frontend.
6. **No 200px charts.** Minimum 240px mobile, 360px desktop. Every chart has timeframe pills.
7. **No inline hardcoded palettes** in `rwa-*-tab.jsx`. Strip them. Pull from `--ta-cat-*`.
8. **No "Loading..." text.** Shimmer skeletons matching component shape (`KpiCardSkeleton`, `ChartSkeleton`, `TableRowSkeleton`).
9. **No drop-shadow-happy "card in a card in a card".** Glass surface once per section, not nested.
10. **No emojis in UI** (including the Brain glyph — use an SVG).

---

## 7. Layout sketches

### 7.1 Overview tab (dashboard pattern)
```
+---------------------------------------------------------------+
| Hero: title + description + [Updated 4m]                      |
+---------------------------------------------------------------+
| [KPI 1] [KPI 2] [KPI 3] [KPI 4]                              |
+---------------------------------------------------------------+
| tabs: Overview · Stablecoins · Treasuries · ...   [filter]   |
+---------------------------------------------------------------+
| [🧠 Spectre Brain · 4h ago]                                   |
|  Net inflows accelerated to $1.2B this week, led by...        |
|  [What changed today: +$340M Treasuries  ] [refresh]          |
+---------------------------------------------------------------+
| [Class] [Metric] [Grouping]              [7D 30D 90D 1Y All]  |
|                                                               |
|    __                                                         |
|   /  \___/\___       Hero chart  360px                        |
|  /         \__/\                                              |
|                                                               |
+---------------------------------------------------------------+
| Class split donut       |  Top 10 issuers (bars)              |
|   o                     |  1. Ondo       ████████ $4.2B      |
|                         |  2. Franklin   █████    $2.1B      |
+---------------------------------------------------------------+
| League table (25 rows, share bar behind %)                    |
|  # | Logo | Name       | AUM     | Share | 30D Δ | Spark      |
|  1 |  ⬤  | USDC       | $32.1B  | ██ 28%|  +2.1%| ~~~~~~~    |
+---------------------------------------------------------------+
| CLASS SHARE RACE (stacked area, 90D mix)                      |
+---------------------------------------------------------------+
```

### 7.2 Asset-class tab (Stablecoins / Treasuries / Credit / Commodities)
```
[KPI strip — class-specific 4 metrics]
[AI Analysis]
[Slicer × Hero chart 360px]
[Two-up: donut/peer split | issuer bars]
[League table]
[CLASS-SPECIFIC WIDGET: peg grid | maturity ladder | vintage heatmap | metals split]
```

### 7.3 Infrastructure tab (Networks / Platforms)
```
[KPI strip — infra-specific 4 metrics]
[AI Analysis]
[Slicer × Hero chart 360px, stacked by chain/platform]
[Two-up: chain-share donut | %-Distributed bars]
[League table — chain/platform w/ inline class-mix bars]
[INFRA WIDGET: chain comparison matrix | service provider map]
```

---

## 8. Out of scope for this spec

- Data-layer changes to `useRwaData.js` beyond confirming fields `asset_class`, `network`, `issuer_type`, `peg_currency`, `maturity_bucket`, `vintage_quarter`, `%_distributed` exist.
- Server-side AI generation pipeline for `AIAnalysisCard` refresh — tracked separately under `project_spectre_brain.md`.
- Day-mode counterparts — every new class below needs `.app.app-day-mode` overrides per `design-system.md` §H. Non-negotiable but not specced here.

---

**Build order:** KpiCard → SlicerControl → MarketShareTable → AIAnalysisCard shell → chart height/timeframe retrofit → AssetDetailPanel → class-specific widgets → Screener → Peg grid redesign → palette purge (delete all inline hex in `rwa-*-tab.jsx`) → mobile card treatments.
