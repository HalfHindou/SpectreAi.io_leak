# SPECTRE — TRADER'S CORNER DESIGN SPECIFICATION

> This document is the single source of truth for the Trader's Corner subpage.
> Every widget, interaction, layout rule, and data display is defined here.
> This sits below `SPECTRE_DESIGN_LAW.md` in the hierarchy — read that first, always.

---

## WHAT THIS PAGE IS

Trader's Corner is **the operational center of Spectre** — where users actually trade, watch, and think. It is not a dashboard. It is not an overview. It is an active intelligence workspace that adapts to what the trader is doing right now.

The mental model: **Bloomberg Terminal + Arc Browser + your own trading journal** — modular, live, with an AI layer that never announces itself but always makes the experience sharper.

**Who it's for:**
- Active traders managing positions and watchlists
- Researchers building token conviction
- Whale trackers monitoring smart money
- Multi-asset traders crossing crypto and stocks

**What it replaces:** The trader's habit of having 8 tabs open across TradingView, Coinglass, Debank, Etherscan, and Twitter. Everything lives here.

---

## LAYOUT SYSTEM — MODULAR GRID

### Core Philosophy

Trader's Corner uses a **drag-and-drop bento grid**. Every widget is a module that can be:
- Moved anywhere in the grid
- Resized (small `1×1`, medium `2×1`, wide `2×2`, full `3×1`)
- Removed and re-added from the Widget Library
- Saved as a named layout preset

The grid is **12 columns**, 8px gutter, fluid. Rows are 160px minimum height units. Widgets snap to grid on drop.

```
GRID: 12 columns · 8px gap · 160px row unit
┌────────────────────────────────────────────────────────┐
│  TOPBAR (fixed, non-modular)                           │
├────────────────────────────────────────────────────────┤
│  GHOST MODE BANNER (conditional, non-modular)          │
├────────────────────────────────────────────────────────┤
│  TICKER STRIP (fixed, non-modular)                     │
├─────────────┬─────────────┬────────────────────────────┤
│  Widget A   │  Widget B   │  Widget C                  │
│  (4 col)    │  (4 col)    │  (4 col)                   │
├─────────────┴─────────────┼────────────────────────────┤
│  Widget D (8 col)         │  Widget E (4 col)          │
├───────────┬───────────────┴────────────────────────────┤
│  Widget F │  Widget G                │  Widget H       │
│  (4 col)  │  (4 col)                │  (4 col)        │
└───────────┴─────────────────────────┴─────────────────┘
```

### Widget Sizes

| Size Class | Grid Columns | Typical Use |
|---|---|---|
| `xs` | 3 col | Stat cards, single metric, mini-gauge |
| `sm` | 4 col | Watchlist, alerts, ETF flows |
| `md` | 6 col | Liquidation map, flow panel, screener |
| `lg` | 8 col | Main chart, positions table |
| `xl` | 12 col | Full-width heatmap, expanded chart |

### Widget Resize Rules

- Minimum size per widget type is enforced — a chart cannot go below `sm`
- Header always visible at any size; body content collapses gracefully
- At `xs` size, widget shows only its primary metric + title
- At `lg/xl`, secondary panels expand into view (indicator row, sub-tables)

---

## TOPBAR — NON-MODULAR

Fixed at top. Always visible. Does not scroll.

```
[Trader's Corner]  [● LIVE]  ————————————  [Overview | Crypto | Stocks | DeFi]  [+ Add Widget]  [☁ Save Layout]  [⚡ Analyze All]
```

### Topbar Rules

- Page title: `font-display`, 22px, weight 700, tracking `-0.04em`. "Corner" in `font-cinema` italic at `--accent`
- LIVE badge: `font-mono` 10px, `--bull` green, pulse dot animation, `rgba(16,185,129,0.08)` background
- Tab selector: `bg-surface` pill container, active tab gets `bg-elevated` + `text-primary`
- **Add Widget** button: ghost style, `bg-elevated`, `border-default`
- **Save Layout** button: ghost style
- **Analyze All** button: accent primary style — `rgba(139,92,246,0.25)` bg, `rgba(139,92,246,0.4)` border, `#c4b5fd` text

### Tab Behavior

| Tab | Shows |
|---|---|
| Overview | All widget types, mixed crypto + stocks + macro |
| Crypto | Crypto-only widgets, hides stock widgets |
| Stocks | Tokenized stocks, ETF flows, equity screener |
| DeFi | On-chain metrics, protocol flows, TVL, yield widgets |

---

## GHOST MODE BANNER — CONDITIONAL

Only renders when Spectre Ghost Mode has an active opinion on a position or intended trade. Hidden when no signal exists.

```
[ 👻 ]  Spectre Ghost Mode — AI disagrees with your $SOL long. Click to see why.   [ VIEW VERDICT ]
```

### Banner Rules

- Background: `linear-gradient(135deg, rgba(139,92,246,0.08), rgba(99,60,210,0.04))`
- Border: `1px solid rgba(139,92,246,0.2)`, `border-radius: var(--radius-md)`
- Ghost icon: `opacity: 0.5`, no color, no glow
- Message text: `font-body` 12px, `text-secondary`. Token symbol highlighted in `#c4b5fd`
- **VIEW VERDICT** button: `font-mono` 10px uppercase, `--accent` color, `rgba(139,92,246,0.08)` bg, `rgba(139,92,246,0.3)` border
- When clicked: opens AI panel expanded state, scrolls to relevant widget or opens a modal overlay
- **NEVER** label this as "AI". The banner copy must sound like an intelligent collaborator, not a bot alert

---

## TICKER STRIP — NON-MODULAR

Bloomberg-style data strip at the top of the content area. Always visible. Scrolls horizontally on a loop.

### Content (in order)

```
BTC $96,420 +2.14% | ETH $3,280 +1.87% | SOL $182.40 −0.63% | TOTAL MCAP $3.42T +1.92% | BTC DOM 56.4% | OPEN INT $42.8B | FUNDING 0.021% LONGS PAYING | 24H LIQS $284M | ...
```

### Ticker Rules

- Container: `bg-surface`, `border-default`, `radius-md`, `padding: 10px 16px`
- Font: `font-mono`, 11px
- Symbol: `text-primary`, weight 600
- Price: `text-secondary`
- Change: `--bull` or `--bear`, weight 500
- Divider `|` character: `border-default` color, not a real border
- Loop: duplicated content for seamless CSS animation, `animation: ticker 40s linear infinite`
- On hover over strip: animation pauses (`animation-play-state: paused`)
- Funding rate shows `LONGS PAYING` or `SHORTS PAYING` label in `#FBB924` amber — never red or green

---

## WIDGET LIBRARY

The complete list of available widgets. All follow the glass card standard. All are draggable/removable.

### WIDGET REGISTRATION FORMAT

Every widget has:
```
ID          Unique key for layout persistence
Name        Display name in widget picker
Category    Metrics | Chart | Flow | AI | Portfolio | Social
Sizes       Which size classes it supports
Default     Default size class on first add
Data        Data sources it consumes
Refresh     How often it polls
```

---

## WIDGET SPECS — METRICS

---

### W-001 · Price Card

```
ID: price-card
Category: Metrics
Sizes: xs, sm
Default: xs
```

Displays one token's current price, 24h change, sparkline, market cap, and volume.

**Visual:**
- `stat-label`: token full name, `font-body` 11px `text-muted`
- `stat-value`: price in `font-mono` 24px weight 600 `text-primary`
- Change: `--bull` or `--bear`, prefixed with `▲` or `▼`
- Sparkline: inline SVG 48×24px, polyline with matching bull/bear stroke color
- Footer: `MCap` and `Vol` in `font-mono` 10px `text-muted`
- Card background tinted: `rgba(16,185,129,0.04)` for positive 24h, `rgba(239,68,68,0.04)` for negative

**Hover:** Full card lifts `translateY(-2px)`, opens token detail flyout on click

---

### W-002 · Liquidation Summary

```
ID: liq-summary
Category: Metrics
Sizes: xs, sm
Default: xs
```

Shows 24h total liquidations, split between long wipes and short wipes.

**Visual:**
- Value: `font-mono` 24px, `--bear` color (liquidations are always bad news regardless of direction)
- Long wipes: `--bear` value + "LONG" label in 9px monospace badge
- Short wipes: `--bull` value + "SHORT" label
- Mini bar chart: 7 vertical bars showing hourly liquidation volume, bars in `rgba(239,68,68,*)` opacity scaling with intensity

---

### W-003 · Open Interest

```
ID: open-interest
Category: Metrics
Sizes: xs, sm
Default: xs
```

**Visual:**
- OI value: `font-mono` 24px `text-primary`
- 24h change: `--bull/--bear`
- Footer: funding rate in `font-mono` 10px. Funding shown in amber `#FBB924` with "LONGS PAYING" / "SHORTS PAYING" label
- Background tint: `accent-glow` `rgba(139,92,246,0.04)` — OI is a neutral metric, neither bull nor bear

---

### W-004 · Fear & Greed Gauge

```
ID: fear-greed
Category: Metrics
Sizes: xs, sm
Default: xs
```

**Visual:**
- Semi-circular SVG arc gauge
- Arc gradient: `#EF4444` → `#F59E0B` → `#84CC16` → `#10B981`
- Background track: `rgba(255,255,255,0.06)` stroke, 10px width
- Needle: white `rgba(255,255,255,0.8)` 1.5px line from center to arc edge
- Center pivot: small circle `bg-overlay` with `border-strong`
- Value: `font-mono` 26px weight 700 below gauge
- Label: "Extreme Fear" / "Fear" / "Neutral" / "Greed" / "Extreme Greed" in `text-muted` 10px uppercase
- Footer: Yesterday and Last Week comparison values
- **Gauge segments and needle position are calculated dynamically from the live index value (0–100)**

---

### W-005 · Funding Rate Heatmap

```
ID: funding-heatmap
Category: Metrics
Sizes: sm, md
Default: sm
```

Grid of tokens × exchanges showing funding rates as colored cells.

**Visual:**
- Rows: tokens (BTC, ETH, SOL, BNB, ARB...)
- Columns: exchanges (Binance, Bybit, OKX, Deribit, Hyperliquid)
- Cell color: continuous scale from `#EF4444` (−0.1%) through `rgba(255,255,255,0.06)` (0%) to `#10B981` (+0.1%)
- Cell text: `font-mono` 10px funding rate value
- Highlighted cells: when rate exceeds ±0.05%, cell gets a 1px solid border matching its fill color
- **This widget is a strong "screenshot bait" moment — a red/green grid is immediately readable and viral**

---

## WIDGET SPECS — CHARTS

---

### W-010 · Main Price Chart

```
ID: price-chart
Category: Chart
Sizes: md, lg, xl
Default: lg
```

The primary candlestick chart. Houses the TradingView integration.

**Header:**
- Token pair label: `font-display` 12px uppercase `text-tertiary`
- 24h change badge: `badge-green` or `badge-red`
- Timeframe selector: `15m | 1h | 4h | 1D | 1W | 1M` — pill tabs in `bg-surface`, active in `bg-elevated`

**Chart Area:**
- Background: `bg-base`, zero padding — chart fills the container edge to edge below the header
- TradingView widget `ColorTheme: "dark"` with custom CSS overrides matching our `--bg-base`
- Price label overlay (top-left inside chart): `font-mono` 20px weight 700 `text-primary`
- Dollar change overlay (top-left beside price): `font-mono` 12px bull/bear

**Indicator Footer:**
- `border-top: 1px solid var(--border-subtle)`
- Shows active indicator badges: `badge-purple` for RSI value, `badge-green/red` for MACD signal, etc.
- `+ Add Indicator` link-style action right-aligned in `--accent`
- Volume: `font-mono` 10px `text-muted` far right

**Size Behavior:**
- `md`: Header + chart only, no indicator footer
- `lg`: Full with indicator footer
- `xl`: Chart fills, additional panel below with order book depth columns alongside

---

### W-011 · Liquidation Chart — Heatmap Bar

```
ID: liq-chart-bars
Category: Chart
Sizes: sm, md
Default: md
```

The signature liquidation visualization. Shows clustered long/short liquidation levels as horizontal bars above and below current price.

**Structure:**

```
┌─────────────────────────────────────────────────────┐
│ LIQUIDATION MAP · BTC          [192M Longs][92M Shorts] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  $100,000  ██████████████████████ $48M              │  ← long clusters above price (bearish risk)
│  $98,500   ████████████ $32M                        │
│  $97,200   ████████ $22M                            │
│                                                     │
│  ─────────── ▶ CURRENT $96,420 ◀ ───────────        │  ← price divider line
│                                                     │
│  $95,000   ██████████ $28M                          │  ← short clusters below price (bearish stop)
│  $93,500   ████████████████ $40M                    │
│  $91,000   ██████████████████████ $52M              │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Next major hunt: $100k → $48M Longs                │
└─────────────────────────────────────────────────────┘
```

**Visual Rules:**

- Long liquidation bars (ABOVE price): `linear-gradient(90deg, rgba(239,68,68,0.15), rgba(239,68,68,0.4))` — red bars pointing right
- Short liquidation bars (BELOW price): `linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.4))` — green bars pointing right
- Bar background track: `rgba(255,255,255,0.03)`, `border-radius: 4px`
- Bar fill: animates from `0% → target%` on mount, `cubic-bezier(0.22,1,0.36,1)` 1.2s
- Price level labels: `font-mono` 10px `text-muted`, right-aligned, fixed 80px width
- Amount labels: `font-mono` 9px weight 600, inside bar at right edge, opacity matches the bar intensity
- **Current price divider:** centered row with `─────` pattern, price in `font-mono` 10px `text-muted` uppercase bold, centered. Full-width `border-top/border-bottom` at `border-subtle`
- Footer: "Next major hunt" — plain language summary, `font-mono` 10px, identifies the nearest large cluster

**Color Logic:**
- Long liquidation bars = RED because these are trapped longs that will get wiped if price rises to that level (market makers hunt upward)
- Short liquidation bars = GREEN because these are trapped shorts below current price
- Bar opacity scales with size — largest cluster gets 80% opacity, smallest gets 20%

**Token Selector:**
- Top-right dropdown to switch between BTC / ETH / SOL etc.
- On switch: bars animate out left → new bars animate in right

---

### W-012 · Liquidation Chart — Bubble Map

```
ID: liq-chart-bubbles
Category: Chart
Sizes: md, lg
Default: md
```

Alternative liquidation view. Price on X axis. Bubble size = liquidation cluster size. Color = long (red) or short (green).

**Visual:**
- Background: `bg-base` with subtle `rgba(255,255,255,0.02)` horizontal grid lines
- X-axis: price levels in `font-mono` 9px `text-muted`
- Y-axis: not labeled — Y position is random jitter to prevent overlap
- Bubbles: circles, `border-radius: 50%`, filled with red/green at 40% opacity, `border: 1px solid` matching color at 60% opacity
- Current price: vertical dashed line `rgba(255,255,255,0.2)` with price label in `font-mono` 10px `text-primary`
- On hover over bubble: tooltip shows `$price level · $amount · [LONG/SHORT]` — glass card tooltip, `bg-elevated`, `border-strong`
- Largest clusters pulse with subtle `box-shadow` animation

---

### W-013 · Liquidation Chart — Cascade Timeline

```
ID: liq-chart-timeline
Category: Chart
Sizes: md, lg
Default: md
```

Historical liquidation volume over time. Shows WHEN liquidations happened, not WHERE. Good for identifying cascade events.

**Visual:**
- Area/bar chart, time on X, USD volume on Y
- Bars: long liqs in `rgba(239,68,68,0.5)`, short liqs in `rgba(16,185,129,0.5)`, stacked
- Spike events (>$50M in one candle): highlight bar with stronger opacity + small tooltip pin above
- Timeframe control: `1H | 4H | 1D | 7D` — switches chart resolution
- Gradient fill under area: matching color at 30% top, 0% at bottom

---

### W-014 · Cumulative Delta Chart

```
ID: cvd-chart
Category: Chart
Sizes: sm, md
Default: sm
```

Cumulative Volume Delta — the difference between aggressive buying and selling. Divergence from price = key signal.

**Visual:**
- Line chart, zero baseline in `border-subtle`
- Positive CVD (buyers winning): `--bull` line
- Negative CVD (sellers winning): `--bear` line
- Price line overlay: `rgba(255,255,255,0.4)` thin line, secondary Y-axis
- Divergence zones highlighted with `rgba(139,92,246,0.08)` shaded background — where CVD and price move opposite
- Footer badge: "Bullish Divergence" / "Bearish Divergence" / "Confirming" in matching badge style

---

### W-015 · Order Book Depth Chart

```
ID: orderbook-depth
Category: Chart
Sizes: sm, md
Default: sm
```

Classic order book depth visualization. Bid/ask depth as mirrored area charts.

**Visual:**
- Left half: bids (buy walls) in `rgba(16,185,129,0.25)` fill with `--bull` stroke
- Right half: asks (sell walls) in `rgba(239,68,68,0.25)` fill with `--bear` stroke
- Center: current price as a vertical divider with label
- X-axis: price in `font-mono` 9px
- Y-axis: cumulative quantity in `font-mono` 9px
- Large walls (top 10% by size): labeled directly on chart with `font-mono` 9px
- Refreshes every 2 seconds with smooth area transition

---

## WIDGET SPECS — FLOW & ON-CHAIN

---

### W-020 · Exchange Flow Monitor

```
ID: exchange-flows
Category: Flow
Sizes: sm, md
Default: sm
```

Real-time exchange inflow/outflow events.

**Header Stats Row:**
- Three columns: `Net Inflow` (bull/bear depending on sign) | `Total Out` (--bear) | `Total In` (--bull)
- Values in `font-mono` 16px weight 700
- Labels in `font-body` 9px uppercase `text-muted`

**Event Feed:**
```
[Token]   [IN/OUT badge]   ─────────   [$Amount]   [Xm ago]
```
- Token name: `font-body` 12px weight 600 `text-primary`
- Badge: `INFLOW` = `rgba(16,185,129,0.12)` bg + `--bull` text / `OUTFLOW` = bear equivalent
- Amount: `font-mono` 11px weight 600, bull/bear colored
- Time: `font-mono` 9px `text-muted`
- New entries slide in from left: `@keyframes slideIn { from { opacity:0; transform: translateX(-8px) } }`
- Tab selector: `Live | 24h | 7d` changes from real-time feed to historical chart view

---

### W-021 · ETF Flows

```
ID: etf-flows
Category: Flow
Sizes: sm, md
Default: sm
```

Daily ETF inflow/outflow data per fund.

**Header Badge:** Net daily total — `badge-green` if positive, `badge-red` if negative

**Rows:**
```
[ETF Name]          [+$284M]
[TICKER · Issuer]   [AUM $48.2B]
```
- ETF name: `font-body` 12px weight 600 `text-primary`
- Ticker + issuer: `font-mono` 10px `text-muted`
- Flow amount: `font-mono` 12px weight 600, bull/bear colored
- AUM: `font-mono` 10px `text-muted`
- Outflowing funds: subtle `rgba(239,68,68,0.04)` row tint
- 7-day sparkline column per fund at `md` size

---

### W-022 · Whale Alert Feed

```
ID: whale-alerts
Category: Flow
Sizes: sm, md
Default: sm
```

Large on-chain transactions flagged in real-time.

**Row format:**
```
[● pulse]  [CHAIN]  [Token]  [from → to]  [$Amount]  [Xm ago]
```
- Pulse dot: `--bull` for DEX/cold wallet moves, `--bear` for exchange deposits, amber for unknown
- Chain badge: `font-mono` 8px uppercase, chain-colored
- From/To: truncated addresses in `font-mono` 10px — shown as ENS if resolvable
- Amount: `font-mono` 12px weight 700 `text-primary`
- On click: opens wallet profile flyout (Spectre internal profile, not Etherscan link)

---

### W-023 · On-Chain Metrics

```
ID: onchain-metrics
Category: Flow
Sizes: sm, md
Default: sm
```

Key on-chain health indicators for selected token.

**Metrics displayed (at `sm`):**
- Active Addresses 24h
- Net Exchange Reserve Change
- HODL Wave (% supply unmoved 1y+)
- MVRV Ratio

**Visual:**
- Each metric: label in `text-muted` 10px uppercase, value in `font-mono` 14px weight 600
- Trend arrow: `▲` bull / `▼` bear + % change in 10px mono
- MVRV shown as a mini progress bar — below 1.0 = undervalued zone (green), above 3.5 = overvalued (red)
- Token selector dropdown in card header

---

## WIDGET SPECS — AI INTELLIGENCE

---

### W-030 · Spectre Verdict

```
ID: spectre-verdict
Category: AI
Sizes: sm, md
Default: sm
```

The AI analysis panel. **The intelligence is invisible** — no badges, no "AI-generated" labels, no robot icons. It reads like a sharp analyst wrote it 2 minutes ago.

**Structure:**

```
┌─────────────────────────────────────────────────────┐
│ SPECTRE VERDICT                    UPDATED 2m AGO   │
├─────────────────────────────────────────────────────┤
│                                                     │
│ "ETF inflows are accelerating while exchange        │
│  reserves decline — historically a pre-rally        │
│  setup."                                            │
│                                                     │
├─────────────────────────────────────────────────────┤
│ ● Spot buying pressure exceeds derivative           │
│   activity. Organic demand signal.        [BULLISH] │
├─────────────────────────────────────────────────────┤
│ ● Funding rates elevated. $98k longs are            │
│   a wipe risk.                            [CAUTION] │
├─────────────────────────────────────────────────────┤
│ ● SOL showing distribution on-chain. Smart          │
│   money exiting quietly.                 [BEARISH]  │
└─────────────────────────────────────────────────────┘
```

**Visual Rules:**

**Card container:**
- Background: `linear-gradient(168deg, rgba(139,92,246,0.06), rgba(19,19,22,0.98))`
- Border: `1px solid rgba(139,92,246,0.2)`
- Top-edge accent line: `::before` pseudo-element, `height: 1px`, `linear-gradient(90deg, transparent, rgba(139,92,246,0.4), transparent)` — creates an ambient glow along the top edge

**Header:**
- Title: `SPECTRE VERDICT` in `font-body` 11px uppercase 600 `text-muted`, with purple tint `rgba(196,181,253,0.7)`
- Timestamp: `font-mono` 9px `rgba(139,92,246,0.6)` — precise, not vague

**Main quote:**
- `font-cinema` (Playfair Display) italic 15px `text-secondary` line-height 1.6
- Padding: 14px 16px
- `border-bottom: 1px solid rgba(139,92,246,0.1)`
- This is the single premium editorial moment — serif in a mono/sans world

**Signal rows:**
- Lead dot: 6px circle, `--bull` / `--bear` / amber `#FBB924`
- Signal text: `font-body` 11px `text-secondary` line-height 1.4
- Signal tag right-aligned: `BULLISH` / `BEARISH` / `CAUTION` / `NEUTRAL` in 9px monospace badge

**Tag colors:**
```
BULLISH  → rgba(16,185,129,0.12) bg, #10B981 text
BEARISH  → rgba(239,68,68,0.12) bg, #EF4444 text
CAUTION  → rgba(251,191,36,0.12) bg, #FBB924 text
NEUTRAL  → rgba(255,255,255,0.06) bg, text-tertiary
```

**Tone of voice for AI-generated signal text:**
- Declarative. No hedging. No "might" or "could".
- Max 15 words per signal sentence.
- No emojis. No "I think" or "In my analysis".
- Uses specific data references: "at $98k" not "at that level"
- Ends signals with a precise noun, not a trailing clause

---

### W-031 · Ghost Mode Panel

```
ID: ghost-mode
Category: AI
Sizes: sm, md
Default: sm
```

Expanded view of the Ghost Mode counter-argument when activated.

**States:**
1. **Idle**: shows `ghost-banner` (non-modular strip at top of page)
2. **Active / Panel open**: full widget card with detailed counter-thesis

**Active Panel Visual:**
- Same purple ambient card style as Spectre Verdict
- Header shows which position it's arguing against: "Arguing against your $SOL 3× Long"
- Counter-thesis in `font-cinema` italic
- Supporting data points as signal rows (same style as Verdict)
- Bottom: two buttons — `I understand the risk, keep position` (ghost) and `Close position` (bear red, accent)
- Button copy is neutral — never shaming, never cheerleading

---

### W-032 · AI Brief Snapshot

```
ID: ai-brief
Category: AI
Sizes: xs, sm
Default: xs
```

One-paragraph AI brief on current market state. Updates every 15 minutes.

**Visual:**
- Compact card, no header section separator
- Timestamp: `font-mono` 9px `text-muted` top-right
- Body: `font-body` 12px `text-secondary` line-height 1.6
- "Read Full Brief →" link action at bottom in `--accent`
- On click: navigates to Spectre Times / Intelligence Hub full brief

---

## WIDGET SPECS — PORTFOLIO & POSITIONS

---

### W-040 · Open Positions

```
ID: positions
Category: Portfolio
Sizes: sm, md, lg
Default: md
```

Live positions table from connected exchange or manual entry.

**Column layout:**

```
[Token + Side + Leverage]   [Entry / Current]   [P&L $]   [P&L %]
```

**Row visual:**
- Token name: `font-body` 13px weight 600 `text-primary`
- Side badge: `LONG` = `rgba(16,185,129,0.15)` + `--bull` / `SHORT` = bear equivalent — `font-mono` 9px uppercase
- Leverage: `font-mono` 9px `text-muted` inline after badge
- Entry label + price: `font-mono` 11px `text-tertiary`
- P&L dollar: `font-mono` 13px weight 700, bull/bear colored
- P&L percent: `font-mono` 11px `text-tertiary`
- Row tint: `rgba(16,185,129,0.015)` for profitable positions, `rgba(239,68,68,0.015)` for underwater
- On hover: row background lifts, close button appears right-aligned

---

### W-041 · Portfolio Ring

```
ID: portfolio-ring
Category: Portfolio
Sizes: sm, md
Default: sm
```

Donut chart showing portfolio allocation by token.

**Visual:**
- SVG donut chart, 120px diameter
- Each segment colored with token ambient color (BTC = `#F7931A` tint, ETH = `#627EEA` tint, etc.)
- Center: total portfolio value in `font-mono` 18px weight 700
- Legend beside ring: token name, allocation % in `font-mono` 11px, color dot
- Hover segment: segment lifts slightly (SVG transform), tooltip shows `$value · %`

---

### W-042 · Watchlist

```
ID: watchlist
Category: Portfolio
Sizes: sm, md
Default: sm
```

User's saved tokens and stocks.

**Row format:**
```
[Avatar]  [Name / Market Cap]  [48px Sparkline]  [Price / 24h%]
```

**Visual Rules:**
- Token avatar: 32px circle, token-ambient-color background, `font-mono` 10px weight 700 symbol label
- Token-ambient colors (background / text / border):
  ```
  BTC  → rgba(247,147,26,0.15)  / #F7931A / rgba(247,147,26,0.25)
  ETH  → rgba(98,126,234,0.15)  / #627EEA / rgba(98,126,234,0.25)
  SOL  → rgba(20,241,149,0.12)  / #14F195 / rgba(20,241,149,0.2)
  BNB  → rgba(240,185,11,0.12)  / #F0B90B / rgba(240,185,11,0.2)
  ARB  → rgba(40,160,240,0.12)  / #28A0F0 / rgba(40,160,240,0.2)
  MATIC→ rgba(130,71,229,0.12)  / #8247E5 / rgba(130,71,229,0.2)
  ```
- Sparkline: 48×24px inline SVG, stroke matches 24h direction (bull/bear)
- Price: `font-mono` 13px weight 600 `text-primary`
- Change %: `font-mono` 10px weight 500, bull/bear colored
- Footer row: dashed `add-widget-btn` — "⊕ Add Token or Stock"

**Multi-watchlist support:**
- Dropdown in card header to switch between named watchlists
- `+ New List` option at bottom of dropdown

---

### W-043 · Active Alerts

```
ID: alerts
Category: Portfolio
Sizes: xs, sm
Default: sm
```

User-configured price and condition alerts.

**Row format:**
```
[● pulse dot]  [TOKEN]  [Alert description]  [Time / Status]
```

- Pulse dot: amber `#F59E0B` animation for "watching", red static for triggered, green static for resolved
- Token: `font-mono` 11px weight 700 in token ambient color
- Description: `font-body` 11px `text-secondary`
- Status: `font-mono` 9px `text-muted` — either relative time "Watching" / "3h 20m" or "Triggered"

---

## WIDGET SPECS — SCREENER

---

### W-050 · AI Screener Table

```
ID: screener
Category: Metrics
Sizes: md, lg, xl
Default: lg
```

AI-filtered market scan showing top movers and signals.

**Columns:**

| Column | Font | Notes |
|---|---|---|
| Asset | `font-body` 12px | Token symbol bold + name muted |
| Price | `font-mono` 12px | `text-secondary` |
| 1h % | `font-mono` 12px | bull/bear colored |
| 24h % | `font-mono` 12px | bull/bear colored |
| Volume | `font-mono` 12px | `text-tertiary` |
| OI Change | `font-mono` 12px | bull/bear colored |
| Signal | badge | ACCUMULATE / WATCH / AVOID / BREAKOUT |
| Heat | pill | Visual gradient bar with position indicator dot |

**Signal badge colors:**
```
ACCUMULATE → badge-green
WATCH      → badge-purple
AVOID      → badge-red
BREAKOUT   → badge-green with pulse animation on the row
```

**Heat pill:**
- 60px × 6px horizontal gradient bar: `rgba(239,68,68,0.3) → rgba(251,191,36,0.4) → rgba(16,185,129,0.5)`
- Indicator dot (6×10px rounded rect) positioned along bar to show where token sits in the heat spectrum
- Breakout tokens: dot pulses with `animation: pulse-green 1s infinite`

**Table rules:**
- Row hover: `rgba(255,255,255,0.015)` background — extremely subtle
- Header: `font-body` 10px uppercase `text-muted` `letter-spacing: 0.08em`, right-aligned except first column
- Table `border-collapse: collapse`, each row separated by `border-bottom: 1px solid var(--border-subtle)`
- Last row: no border-bottom

---

## MODULAR SYSTEM — DRAG AND DROP

### Drag Behavior

- **Drag handle:** `⠿` braille dots icon from `spectreIcons`, top-right corner of every card
- Handle opacity: `0` by default, `0.5` on card hover, `1` when actively dragging
- Handle cursor: `grab` on hover, `grabbing` while dragging
- On drag start: card gets `opacity: 0.5`, placeholder ghost appears in original position with `border: 1px dashed rgba(255,255,255,0.1)`
- On drag over valid zone: placeholder gets `background: rgba(139,92,246,0.06)` tint + `border: 1px dashed rgba(139,92,246,0.3)`
- On drop: card snaps to new position, `transition: transform 0.3s cubic-bezier(0.16,1,0.3,1)`

### Resize Behavior

- Resize handle: bottom-right corner of card only, `4×4px` `bg-hover` dot, visible on hover
- On resize drag: card border becomes `border-accent` (`rgba(139,92,246,0.4)`)
- Width snaps to nearest column step (3 / 4 / 6 / 8 / 12 col)
- Height snaps to row unit steps (160px / 320px / 480px)
- Content inside gracefully collapses or expands — each widget has defined `sm-content` and `lg-content` JSX variants
- `transition: width 0.2s, height 0.2s` on snap

### Layout Persistence

- Layout saved to `localStorage` as JSON on every drag/drop/resize action
- Named layouts: saved to user profile via API
- Default layouts defined per Tab (Overview / Crypto / Stocks / DeFi)
- `Save Layout` button in topbar: triggers save + names the layout
- On load: saved layout restored within 100ms before first render (prevents flicker)

### Add Widget Flow

**`+ Add Widget` button → opens Widget Library overlay:**
- Dark modal overlay `rgba(0,0,0,0.6)` with blur `backdrop-filter: blur(20px)`
- Widget library as a grid of glass cards with preview thumbnails
- Categories: All | Metrics | Charts | Flow | AI | Portfolio
- Each widget card shows name, description (one line), supported sizes, live data preview
- Click to add: widget drops at bottom of grid, auto-sized to default, then user can drag it
- Overlay closes on Escape or backdrop click

### Remove Widget

- On card hover: subtle `×` close button appears top-right (opposite to drag handle)
- Opacity: `0` → `0.4` on hover → `0.8` on close-button hover
- On click: confirm state (card header briefly shows "Remove this widget?" with Yes/Cancel inline) — 2 second timeout auto-cancels
- Remove animation: card scales to `0.9` + `opacity: 0` then gap closes with smooth reflow

---

## LIQUIDATION CHART — EXTENDED RULES

Liquidation data is one of the most important trader tools on the platform. It requires special treatment.

### Interpretation Guide (for AI copy and tooltips)

```
Bars ABOVE current price = Trapped Longs (Long Liquidation Clusters)
→ If price pumps to these levels, long positions at those entries get liquidated
→ Market makers often hunt these levels (known as "ripping the stops")
→ Display these in RED

Bars BELOW current price = Trapped Shorts (Short Liquidation Clusters)  
→ If price dumps to these levels, short positions get liquidated
→ Display these in GREEN
```

### Tooltip Content (on hover over bar)

```
┌──────────────────────────────┐
│ $98,500 Long Liquidation     │
│ Cluster Size: $32M           │
│ # Positions: ~1,240 est.     │
│ Distance from price: 2.2%    │
│ Exchange concentration: Bybit│
└──────────────────────────────┘
```

Glass card tooltip: `bg-elevated`, `border-strong`, `border-radius: radius-sm`, `font-body` 11px, value in `font-mono`

### Color Intensity Scaling

Bar opacity scales with relative cluster size:

```
Largest cluster in view:  80% opacity
>75% of largest:          65%
>50% of largest:          50%
>25% of largest:          35%
<25% of largest:          20%
```

This creates a natural visual hierarchy — the dangerous levels are brightest.

### "Next Hunt" Footer

- Below the chart: plain-English summary of nearest large cluster
- Format: `"Next major long hunt: $100,000 → $48M in play"` for bar view
- Font: `font-mono` 10px `text-muted`
- When price is within 1% of a large cluster: text turns amber `#FBB924`, value pulses

### Real-Time Updates

- Liquidation clusters refresh every 30 seconds
- On data update: bars that grew larger animate width-increase
- Bars that disappeared (positions liquidated) fade out `opacity → 0` over 0.5s then remove
- New clusters slide in from edge with full animation

### The Three Chart Variants (W-011, W-012, W-013)

All three should be addable separately. A power user might want all three at once — the bar map showing WHERE, the bubble map for visual scale comparison, and the cascade timeline for WHEN.

---

## TOPBAR TICKER STRIP — DATA SEQUENCE

The ticker follows a fixed data sequence. Items are separated by `|` divider characters. Order matters — macro context first, then individual tokens, then derivatives data.

```
Sequence:
1. BTC price + 24h%
2. ETH price + 24h%
3. SOL price + 24h%
4. BNB price + 24h%
5. [User watchlist token 1] (dynamic — pulls from user's watchlist)
6. [User watchlist token 2]
7. ─────
8. TOTAL MCAP + 24h%
9. BTC DOMINANCE + delta
10. ETH DOMINANCE + delta
11. ─────
12. OPEN INT (BTC perps) + 24h%
13. 24H LIQS + split label
14. FUNDING RATE + direction label
15. ─────
16. [Stock: MSTR] price + 24h% (if stocks tab active)
17. [Stock: COIN] price + 24h%
```

Items 5–6 are user-personalized — pulled from their first active watchlist. If watchlist is empty, defaults to ARB and LINK.

---

## CONTENT RULES — DATA DISPLAY

### Numbers

All numerical data follows these absolute rules:

| Data Type | Format | Example |
|---|---|---|
| Price > $1 | 2 decimal places | `$96,420.42` |
| Price $0.01–$1 | 4 decimal places | `$0.8420` |
| Price < $0.01 | 6 decimal places | `$0.000142` |
| Percentage | 2 decimal places with sign | `+2.14%` or `−0.63%` |
| Market Cap | Abbreviated | `$1.89T`, `$86.4B`, `$420M` |
| Volume | Abbreviated | `$38.2B` |
| Liquidation $ | Abbreviated | `$284M`, `$1.2B` |
| Funding Rate | 4 decimal places | `0.0214%` |

All numbers in `font-family: var(--font-mono)`. No exceptions. Zero exceptions.

Negative numbers use `−` (Unicode minus, U+2212), not `-` (hyphen).

### Price Change Direction Indicators

```
▲  (▲ U+25B2)  for positive — before the percentage, not after
▼  (▼ U+25BC)  for negative — before the percentage
```

Never use `+` prefix on positive percentages in main displays — use `▲`. Reserve `+` and `-` only for absolute dollar changes.

### Time Formatting

```
Live feed items:   "2m ago", "just now", "1h ago"
Scheduled events:  "Feb 22, 14:30 UTC"
Historical:        "Feb 22"
Within 24h:        "14:30"
```

Never show raw timestamps (Unix / ISO) to users.

---

## EMPTY STATES

Every widget must have a defined empty state. Empty states are **never blank**. They are **never red error boxes**.

### Standard Empty State Pattern

```css
/* Ghost layout with shimmer */
background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
background-size: 200% 100%;
animation: shimmer 1.5s ease-in-out infinite;
```

Each widget's empty state copy:

| Widget | Empty Copy |
|---|---|
| Watchlist | `"Your watchlist is empty. Add tokens to track."` + glass `⊕ Add Token` button |
| Positions | `"No open positions. Connect your exchange or add manually."` |
| Alerts | `"No active alerts. Set one to get notified when levels hit."` |
| Liquidation Chart | `"Fetching liquidation clusters..."` with shimmer bars |
| Verdict | `"Analyzing market conditions..."` with shimmer lines |
| Flow Monitor | `"Watching exchanges for large movements..."` with pulse dot |

**Rules:**
- Copy is calm, not apologetic
- Never say "No data found" or "Error loading"
- Loading = shimmer, not spinner
- Retry is silent and automatic

---

## RESPONSIVE BEHAVIOR

Trader's Corner is primarily a **desktop experience**. On smaller viewports:

| Viewport | Behavior |
|---|---|
| >1440px | Full grid, all widget sizes available |
| 1200–1440px | Grid collapses to 8 columns |
| 1024–1200px | Grid collapses to 6 columns, widgets min-size `sm` |
| <1024px | Single column stack, modular drag disabled, widgets list vertically |
| Mobile | Redirect prompt: "Trader's Corner is optimized for desktop." — with option to proceed anyway |

On mobile (if user proceeds): Ticker strip, Watchlist, Verdict, and Positions visible. Charts and Liquidation maps show a "View Full Chart →" link to native TradingView.

---

## DAY MODE RULES

All widgets must have `.app.app-day-mode` overrides.

### Day Mode Card

```css
.app.app-day-mode .tc-card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
}
.app.app-day-mode .tc-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.06);
}
```

### Day Mode Text

```css
.app.app-day-mode .text-primary   { color: #0f172a; }
.app.app-day-mode .text-secondary { color: #334155; }
.app.app-day-mode .text-tertiary  { color: #64748b; }
.app.app-day-mode .text-muted     { color: #94a3b8; }
```

### Day Mode Sentiment Tinting

In day mode, the card background tints are sentiment-driven:

```css
.app.app-day-mode .stat-tint-bull  { background: rgba(16,185,129,0.04); }
.app.app-day-mode .stat-tint-bear  { background: rgba(239,68,68,0.04); }
.app.app-day-mode .stat-tint-accent { background: rgba(139,92,246,0.04); }
```

### Day Mode Ghost Banner

```css
.app.app-day-mode .ghost-banner {
  background: linear-gradient(135deg, rgba(139,92,246,0.06), rgba(139,92,246,0.02));
  border: 1px solid rgba(139,92,246,0.15);
}
```

### Day Mode Ticker

```css
.app.app-day-mode .ticker-strip {
  background: #f8fafc;
  border: 1px solid rgba(0,0,0,0.06);
}
```

---

## PERFORMANCE REQUIREMENTS

| Metric | Target |
|---|---|
| Initial layout render | < 200ms |
| Widget add animation | < 100ms first frame |
| Chart data fetch | < 1s |
| Ticker strip | Never blocks render |
| Liquidation data refresh | 30s interval, background |
| Flow feed | 10s interval |
| Price data | 5s interval |
| AI Verdict | 5min interval |
| Page load (full) | < 1.5s |

Data fetching rules:
- All API calls use the tiered architecture (Codex → CoinGecko → Binance fallback)
- Stale data shown while refreshing — never blank on refresh
- Failed API calls: silent retry × 3, then show last known value with `text-muted` dimming
- Liquidation data: cached for 30s aggressively (it does not change per-second)

---

## IMPLEMENTATION CHECKLIST

Before shipping any Trader's Corner widget or layout update:

- [ ] Does every number use `var(--font-mono)`?
- [ ] Does every icon come from `spectreIcons.jsx`?
- [ ] Does every color use a CSS variable from the design system?
- [ ] Does every card have inset top-edge highlight + outer shadow?
- [ ] Does every interactive element have `translateY(-2px)` hover lift?
- [ ] Does every widget have a defined empty/loading state?
- [ ] Does the widget have a `.app.app-day-mode` override?
- [ ] Does the drag handle appear only on card hover at correct opacity?
- [ ] Is the AI Verdict panel using `font-cinema` for the main quote?
- [ ] Is `AI` / `AI-Powered` / `AI-Generated` anywhere visible on screen? (It should not be)
- [ ] Does the liquidation chart correctly show red ABOVE price and green BELOW?
- [ ] Does the ticker strip pause on hover?
- [ ] Does Ghost Mode banner only render when there is an active signal?
- [ ] Have you run the "squint test"? Is there one clear hero element per card?
- [ ] Does this look like the same app as WelcomePage? If not, fix it.
