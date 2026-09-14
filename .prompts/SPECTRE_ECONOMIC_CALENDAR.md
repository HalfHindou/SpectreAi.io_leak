# SPECTRE ECONOMIC CALENDAR — Claude Code Build Prompt

> The macro intelligence layer. Every serious trader watches the economic calendar before they watch the chart. This is where Spectre turns raw event data into an edge.

---

## READ FIRST

1. `SPECTRE_DESIGN_LAW.md` — every pixel follows this
2. `src/index.css` — CSS variable source of truth
3. `src/icons/spectreIcons.jsx` — ONLY these icons
4. The existing page routing to understand how to add a new page
5. This entire document

---

## WHERE IT LIVES

The Economic Calendar is a **full page** in the main navigation sidebar.

```
Sidebar
├── Home
├── Research
├── Discover
├── Watchlists
├── AI Screener
├── Categories
├── Economic Calendar   ← THIS — new page
├── Intelligence Hub
└── YOU
```

**Route:** `/calendar`
**Nav label:** `Calendar`
**Nav icon:** Use the globe or calendar icon from `spectreIcons.jsx`

---

## PAGE STRUCTURE

```
┌────────────────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                                │
│  Economic Calendar          [Day] [Week] [Month]     Filters ▾    Today → │
├─────────────────────────────────────┬──────────────────────────────────────┤
│                                     │                                      │
│   NEXT UP HERO CARD                 │   LIVE / UPCOMING COUNTDOWN          │
│   (next critical event, big,        │   SIDEBAR (stacked event             │
│    countdown, analysis)             │   countdown cards)                   │
│                                     │                                      │
├─────────────────────────────────────┴──────────────────────────────────────┤
│                                                                            │
│   CALENDAR VIEW (Day / Week / Month — switches based on toggle)            │
│                                                                            │
│   Each event row shows:                                                    │
│   Time | Impact | Flag | Event Name | Previous | Forecast | Actual | Chart │
│                                                                            │
│   Events grouped by date, sorted by time                                   │
│   Impact color-coded: Low / Medium / High / Critical                       │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   EXPANDED EVENT DETAIL (when an event row is clicked)                     │
│   History table, analysis, crypto impact, livestream embed                 │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. HEADER BAR

Fixed at the top of the page. Contains:

```
Economic Calendar                    [Day] [Week] [Month]    [⊕ Filters ▾]    [← Today →]
```

### Left: Page Title
- `Economic Calendar` in `var(--font-display)` (Space Grotesk), 24px, weight 600
- Subtitle below: `Macro events that move markets` in `var(--text-tertiary)`, 13px Inter

### Center: View Toggle
Three-segment toggle pill (like iOS segmented control):
- `Day` | `Week` | `Month`
- Active segment: `var(--accent)` background, white text
- Inactive: transparent background, `var(--text-muted)` text
- Rounded pill container with `var(--border-default)` border
- Font: `var(--font-mono)`, 12px, uppercase

### Right: Filters + Navigation

**Filters dropdown** — opens a glass panel below the header:
```
┌────────────────────────────────────────────┐
│  Impact Level                              │
│  [● Low] [● Medium] [● High] [● Critical] │
│                                            │
│  Currency / Region                         │
│  [● USD] [● EUR] [● GBP] [● JPY]          │
│  [● CNY] [● AUD] [● CAD] [● CHF]          │
│                                            │
│  Category                                  │
│  [● Interest Rate] [● Employment]          │
│  [● Inflation] [● GDP] [● Housing]         │
│  [● Consumer] [● Manufacturing]            │
│  [● Trade] [● Speeches]                    │
│                                            │
│  [ Reset ]              [ Apply Filters ]  │
└────────────────────────────────────────────┘
```

Each filter is a pill toggle (on/off). Active = filled, inactive = outlined. Multiple can be selected.

**Date Navigation:**
- `←` previous (day/week/month depending on view)
- `Today` button (jumps back to current)
- `→` next
- Current date range displayed: `Mon Feb 22, 2026` (day) or `Feb 22 – 28, 2026` (week) or `February 2026` (month)
- Font: `var(--font-mono)`, 12px

---

## 2. NEXT UP HERO CARD

The single most important upcoming event gets hero treatment. This is a premium glass card spanning ~65% of the page width.

### Layout:
```
┌──────────────────────────────────────────────────────────────────┐
│  ● CRITICAL                            📡 LIVE IN  02:14:32:08  │
│                                                                  │
│  FOMC Interest Rate Decision                                     │
│  Federal Reserve · United States                                 │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                         │
│  │ Previous │ │ Forecast │ │  Actual  │                         │
│  │  4.50%   │ │  4.50%   │ │   ——     │  ← empty until release  │
│  └──────────┘ └──────────┘ └──────────┘                         │
│                                                                  │
│  ┌─ SPECTRE ANALYSIS ────────────────────────────────────────┐  │
│  │  Markets pricing in a hold with 94% probability.          │  │
│  │  Watch for dot plot revisions and Powell's tone on         │  │
│  │  inflation trajectory. Hawkish surprise = risk-off.       │  │
│  │  Key phrases: "data dependent", "further progress",       │  │
│  │  "labor market cooling"                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Crypto Impact: BTC typically moves ±3.2% within 4h of FOMC     │
│  Historical: Last 6 decisions → 4 bullish, 2 bearish for BTC    │
│                                                                  │
│  [ View Full History ]  [ Set Alert ]  [ 📡 Watch Live ]        │
└──────────────────────────────────────────────────────────────────┘
```

### Visual Spec:

**Impact badge** (top-left):
- `● CRITICAL` — pulsing red dot + text in 10px mono uppercase
- Red dot animation: `box-shadow: 0 0 0 0 rgba(239,68,68,0.6)` pulsing to `0 0 0 6px rgba(239,68,68,0)`

**Countdown timer** (top-right):
- `LIVE IN` label: 10px mono muted
- Timer: `02:14:32:08` (days:hours:minutes:seconds) — `var(--font-mono)`, 24px, `var(--text-primary)`
- Updates EVERY SECOND — this is a real ticking countdown
- When <1 hour remaining: timer turns `var(--bear)` red and pulses gently
- When <5 minutes: entire hero card gets a subtle red border glow `box-shadow: 0 0 20px rgba(239,68,68,0.08)`
- When event is LIVE (currently happening): countdown replaced with `● LIVE NOW` pulsing badge
- When event has released: countdown replaced with result (see RESULT STATE below)

**Event title:**
- Name: `var(--font-display)`, 28px, weight 600
- Source + country: 14px Inter, `var(--text-secondary)`, with small flag icon (SVG country flag or flag emoji equivalent from a flag library — NOT emoji in UI, use small 16px SVG flag images)

**Previous / Forecast / Actual boxes:**
Three glass inner cards in a row:
```css
background: linear-gradient(180deg, #0c0c10 0%, #08080c 100%);
border: 1px solid rgba(255,255,255,0.12);
border-radius: 12px;
padding: 16px 24px;
text-align: center;
```
- Label: 10px mono uppercase muted
- Value: 24px mono bold
- Previous: `var(--text-secondary)`
- Forecast: `var(--text-primary)`
- Actual: empty `——` until released, then bold + color-coded (green if better than forecast, red if worse)

**Spectre Analysis block:**
- Glass inner card with subtle accent left border (3px `var(--accent)`)
- Label: `SPECTRE ANALYSIS` in 10px mono uppercase accent color
- Body: 14px Inter, `var(--text-secondary)`, line-height 1.65
- AI-generated analysis text (mock for now, real later via Intelligence Hub)

**Crypto Impact line:**
- 12px Inter, `var(--text-tertiary)`
- `BTC typically moves ±3.2% within 4h of FOMC` — the percentage in bold, positive in green negative in red

**Action buttons:**
- `View Full History` — ghost button (outlined)
- `Set Alert` — ghost button
- `Watch Live` — accent button (when a livestream is available, see LIVESTREAM section below)

---

## 3. COUNTDOWN SIDEBAR

Right side of the hero area. Stacked vertical list of the next 3-5 upcoming events, each as a compact countdown card:

```
┌─────────────────────────────────┐
│  ●● HIGH           in 4h 22m   │
│  US CPI (YoY)                   │
│  Forecast: 3.1%    Prev: 3.0%  │
├─────────────────────────────────┤
│  ● MEDIUM          in 1d 6h    │
│  ECB Rate Decision              │
│  Forecast: 4.00%   Prev: 4.00% │
├─────────────────────────────────┤
│  ● LOW             in 2d 14h   │
│  UK Retail Sales                │
│  Forecast: 0.3%    Prev: -0.1% │
└─────────────────────────────────┘
```

Each card:
- Impact dots (see IMPACT SYSTEM below)
- Countdown in relative time: `in 4h 22m` — `var(--font-mono)`, accent colored if critical
- Event name: 14px Inter medium
- Forecast + Previous: 11px mono, muted
- On hover: `translateY(-2px)` + border brightens
- On click: scrolls to that event in the calendar view below and expands its detail

---

## 4. IMPACT LEVEL SYSTEM

Four levels. Each has a color, a dot indicator, and a visual weight:

| Level | Color | Dot | Visual Treatment |
|-------|-------|-----|------------------|
| **Low** | `var(--text-muted)` (gray) | `●` (1 dot, gray) | Dimmed row, normal text weight |
| **Medium** | `#F59E0B` (amber) | `●●` (2 dots, amber) | Normal row, amber accent |
| **High** | `#F97316` (orange) | `●●●` (3 dots, orange) | Slightly brighter row, orange accent, bold event name |
| **Critical** | `var(--bear)` (#EF4444) | `●●●●` (4 dots, red, pulsing) | Row has faint red background tint `rgba(239,68,68,0.04)`, bold everything, event name larger |

### What's Critical vs High:

**CRITICAL** (these move EVERYTHING — crypto, stocks, forex, bonds):
- FOMC Interest Rate Decision
- FOMC Meeting Minutes
- Non-Farm Payrolls (NFP)
- CPI (Consumer Price Index) — both MoM and YoY
- PPI (Producer Price Index)
- PCE Price Index (Fed's preferred inflation measure)
- GDP (advance estimate)
- Federal Reserve Chair speaks (Powell press conferences)
- ECB Interest Rate Decision
- BOJ Interest Rate Decision
- BOE Interest Rate Decision
- US Jobs Report (Employment Situation)

**HIGH:**
- Retail Sales
- ISM Manufacturing PMI
- ISM Services PMI
- Initial Jobless Claims (weekly)
- Consumer Confidence
- Durable Goods Orders
- Housing Starts / Building Permits
- Trade Balance
- Any central bank governor speech
- OPEC meetings

**MEDIUM:**
- Industrial Production
- Capacity Utilization
- Chicago PMI
- Michigan Consumer Sentiment
- Existing Home Sales
- New Home Sales
- Personal Income / Spending
- Empire State Manufacturing
- Philly Fed Index

**LOW:**
- Redbook Index
- Baker Hughes Rig Count
- Treasury Auctions (unless 10Y/30Y)
- Minor regional Fed surveys
- Wholesale Trade
- Business Inventories

---

## 5. CALENDAR VIEWS

### DAY VIEW

Shows all events for a single day in a timeline format.

**Left time axis:** Vertical line with hour markers (6:00, 7:00, 8:00... through 22:00). Current time marked with a horizontal accent line + pulsing dot.

**Event rows:** Each event is a horizontal card positioned at its time on the axis.

```
  08:30  ●●●● CRITICAL   🇺🇸  Non-Farm Payrolls          Prev: 216K   Fcst: 200K   Act: ——     [▸ 02:14:08]
  08:30  ●●●  HIGH        🇺🇸  Unemployment Rate          Prev: 3.7%   Fcst: 3.8%   Act: ——     [▸ 02:14:08]
  10:00  ●●   MEDIUM      🇺🇸  ISM Manufacturing PMI      Prev: 49.2   Fcst: 49.5   Act: ——     [▸ 03:44:08]
  13:00  ●    LOW          🇺🇸  Baker Hughes Rig Count     Prev: 621    Fcst: ——     Act: ——     [▸ 06:44:08]
  14:00  ●●●● CRITICAL   🇺🇸  FOMC Press Conference       —           —            —           [▸ 07:44:08]
```

**Row layout (left to right):**
1. **Time** — `var(--font-mono)`, 12px, muted. Local timezone with timezone label (e.g., `08:30 EST`)
2. **Impact dots** — 1-4 dots in impact color
3. **Impact label** — `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` in 9px mono uppercase, impact color
4. **Country flag** — 16px SVG flag (US, EU, UK, JP, CN, AU, CA, CH)
5. **Event name** — 14px Inter medium. Critical events: 15px bold.
6. **Previous** — `Prev: 216K` in 12px mono, muted label, value in `var(--text-secondary)`
7. **Forecast** — `Fcst: 200K` in 12px mono, muted label, value in `var(--text-primary)`
8. **Actual** — `Act: ——` placeholder. When released: value in bold, colored green/red based on vs. forecast
9. **Countdown/Status** — right-aligned. Either countdown timer `02:14:08` or status badge `RELEASED` or `LIVE`

**Row styles by state:**
- **Upcoming:** Normal. Countdown timer ticking in `var(--text-tertiary)`.
- **Live (within ±5 min of event time):** Faint red border-left (3px). Pulsing indicator. `● LIVE` badge.
- **Released:** Actual column filled in. If actual > forecast: green tint on actual + green check. If actual < forecast: red tint + red arrow down. Row has subtle `rgba(16,185,129,0.03)` or `rgba(239,68,68,0.03)` background based on result.
- **Passed (>1hr ago, no market impact):** Dimmed row at 0.5 opacity.

**Row click → expands to DETAIL VIEW** (see section 7 below).

---

### WEEK VIEW

Shows Mon → Fri as columns (or Mon → Sun). Each column = one day. Events stacked vertically within each day column.

```
         Mon 22           Tue 23           Wed 24           Thu 25           Fri 26
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │              │ │              │ │ ●●●● FOMC    │ │              │ │ ●●●● NFP     │
    │ ● Chicago    │ │ ●● Consumer  │ │ 14:00 EST    │ │ ●●● Jobless  │ │ 08:30 EST    │
    │ PMI          │ │ Confidence   │ │              │ │ Claims       │ │              │
    │ 09:45 EST    │ │ 10:00 EST    │ │ ●●● New Home │ │ 08:30 EST    │ │ ●● ISM Svc   │
    │              │ │              │ │ Sales        │ │              │ │ 10:00 EST    │
    │              │ │ ●● Richmond  │ │ 10:00 EST    │ │ ●● Pending   │ │              │
    │              │ │ Fed          │ │              │ │ Home Sales   │ │              │
    │              │ │ 10:00 EST    │ │              │ │ 10:00 EST    │ │              │
    └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**Each day column:**
- Day header: `Mon 22` in 12px mono muted. Today gets accent underline.
- Events stacked top to bottom by time
- Each event: compact card with impact dots + name + time
- Critical events: slightly taller card, red-tinted left border, bolder text
- Today's column: faint accent border or background tint `rgba(139,92,246,0.04)`
- On click: expands event detail OR switches to day view for that day

**Week column width:** equal distribution across available width. If narrow viewport, horizontal scroll.

---

### MONTH VIEW

Traditional calendar grid. 7 columns (Mon–Sun), 4-6 rows.

```
  February 2026

  Mon        Tue        Wed        Thu        Fri        Sat        Sun
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│    2     │    3     │    4     │    5     │    6     │    7     │    8     │
│          │ ●●       │ ●●●      │ ●        │ ●●●●     │          │          │
│          │ 2 events │ 3 events │ 1 event  │ NFP      │          │          │
│          │          │          │          │ 4 events │          │          │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│    9     │   10     │   11     │   12     │   13     │   14     │   15     │
│ ●        │ ●●       │ ●●●●     │ ●●●      │ ●●       │          │          │
│ 1 event  │ 2 events │ CPI      │ PPI      │ 2 events │          │          │
│          │          │ 3 events │ 2 events │          │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

**Each day cell:**
- Day number: 16px mono, top-left
- Highest impact dots for that day
- If a critical event exists: show its name (abbreviated). e.g., `FOMC`, `NFP`, `CPI`
- Event count: `3 events` in 10px muted
- Today's cell: accent border + faint accent background
- Days with critical events: faint red tint `rgba(239,68,68,0.03)`
- Click day → switches to DAY VIEW for that date

---

## 6. RESULT STATE — WHEN DATA DROPS

The moment an economic release happens, the row transforms:

### Flash Animation
When actual data appears:
1. Entire row flashes briefly — `background: rgba(255,255,255,0.08)` flash over 400ms
2. The `Actual` column animates in: count-up from 0 to final value over 500ms
3. Color resolves: green pulse if better than forecast, red pulse if worse
4. Beat/miss badge appears next to actual: `BEAT` (green) or `MISS` (red) or `IN LINE` (gray)

### Visual Comparison
```
  Prev: 216K     Fcst: 200K     Act: 256K  ▲ BEAT
                                 ↑
                           bold green, 
                    subtle green row tint
```

The actual value styling:
- **Better than forecast:** `var(--bull)` green, bold. Row gets `rgba(16,185,129,0.04)` background.
- **Worse than forecast:** `var(--bear)` red, bold. Row gets `rgba(239,68,68,0.04)` background.
- **In line with forecast:** `var(--text-primary)` white, normal weight. Neutral.

### Deviation Indicator
Show how far actual deviated from forecast:
- `+28.0%` deviation badge (green if positive surprise, red if negative)
- Small horizontal bar showing the deviation visually

### Immediate Market Impact
When a result drops (especially critical events), show a quick inline snapshot below the result:

```
┌── MARKET REACTION (first 5 min) ──────────────────────────────┐
│  BTC: $97,241 → $98,102 (+0.88%)   ▲                         │
│  SPX: 5,842 → 5,861 (+0.32%)       ▲                         │
│  DXY: 105.2 → 104.8 (-0.38%)       ▼                         │
│  US10Y: 4.32% → 4.28% (-4bps)      ▼                         │
│                                                                │
│  BTC 5-min chart: [tiny sparkline showing the move]            │
└────────────────────────────────────────────────────────────────┘
```

This appears automatically as an expandable section under the event row when actual data is filled in. Simulated for now (random market reactions based on beat/miss direction).

---

## 7. EXPANDED EVENT DETAIL

When a user clicks any event row, it expands downward to show a rich detail panel:

```
┌── FOMC Interest Rate Decision ──────────────────────────────────────────────────┐
│                                                                                  │
│  ┌─ RESULT TABLE ─────────────────────────────────────────────────────────────┐  │
│  │  Date           Previous    Forecast    Actual    Deviation    BTC Move    │  │
│  │  Jan 29, 2026   4.50%       4.50%       4.50%    In Line      -1.2%       │  │
│  │  Dec 18, 2025   4.75%       4.50%       4.50%    In Line      +4.8%       │  │
│  │  Nov 07, 2025   5.00%       4.75%       4.75%    In Line      +2.1%       │  │
│  │  Sep 18, 2025   5.25%       5.00%       5.00%    In Line      +1.4%       │  │
│  │  Jul 30, 2025   5.25%       5.25%       5.25%    In Line      -0.3%       │  │
│  │  Jun 11, 2025   5.25%       5.25%       5.25%    In Line      +0.7%       │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌─ HISTORICAL CHART ─────────────┐  ┌─ SPECTRE ANALYSIS ──────────────────┐   │
│  │                                │  │                                      │   │
│  │  Line chart showing the        │  │  The Fed is expected to hold rates   │   │
│  │  indicator value over last     │  │  steady at 4.50% as inflation        │   │
│  │  12 releases. X-axis = dates,  │  │  remains above the 2% target.       │   │
│  │  Y-axis = values.              │  │                                      │   │
│  │                                │  │  Key signals to watch:               │   │
│  │  Current forecast marked       │  │  • Dot plot median for 2026          │   │
│  │  with dashed horizontal line.  │  │  • Balance sheet guidance            │   │
│  │                                │  │  • Inflation language changes        │   │
│  └────────────────────────────────┘  │                                      │   │
│                                      │  Hawkish = bearish crypto short-term │   │
│                                      │  Dovish = bullish crypto risk-on     │   │
│                                      └──────────────────────────────────────┘   │
│                                                                                  │
│  ┌─ FOR FED EVENTS: SENTIMENT METER ─────────────────────────────────────────┐  │
│  │                                                                            │  │
│  │  HAWKISH ◄━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━► DOVISH                         │  │
│  │                     NEUTRAL                                                │  │
│  │                                                                            │  │
│  │  Last decision: Slightly Hawkish                                           │  │
│  │  Market expectation: Neutral to Dovish                                     │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌─ LIVESTREAM (when available) ──────────────────────────────────────────────┐  │
│  │                                                                            │  │
│  │  Powell Press Conference — FED YouTube Channel                              │  │
│  │  [  ▶  Watch Live                                              ]           │  │
│  │                                                                            │  │
│  │  When clicked: embeds YouTube iframe directly in this panel                │  │
│  │  Pre-configured stream URLs for:                                           │  │
│  │  - Fed press conferences (Fed YouTube channel)                             │  │
│  │  - ECB press conferences                                                   │  │
│  │  - BOE/BOJ announcements                                                  │  │
│  │  - Jackson Hole, Davos, etc.                                               │  │
│  │                                                                            │  │
│  │  When no official stream: show "No livestream available. Follow on X →"    │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  [ Set Price Alert for This Event ]  [ Share Event Card ↗ ]  [ Add to Watchlist] │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Result History Table

Glass inner card with a clean data table:
- Header row: muted labels, 10px mono uppercase
- Data rows: alternating subtle striping `rgba(255,255,255,0.02)` every other row
- Values: `var(--font-mono)`, 13px
- `BTC Move` column: colored green/red based on direction. This shows BTC price change in the 4 hours following the event.
- Table sorted newest first
- Show last 6–12 releases

**Column definitions:**
| Column | Description |
|--------|-------------|
| Date | Release date, formatted: `Jan 29, 2026` |
| Previous | Previous period's value |
| Forecast | Market consensus before release |
| Actual | Released value |
| Deviation | % deviation from forecast. Green = positive surprise, red = negative |
| BTC Move | BTC price change in 4h following release. `+4.8%` green or `-1.2%` red |

### Historical Chart

SVG line chart showing the indicator value over last 12 releases:
- X-axis: release dates (abbreviated)
- Y-axis: indicator values
- Line color: `var(--accent)`
- Forecast for upcoming release: dashed horizontal line
- Previous releases: dots on the line
- Hover tooltip: date + value

Size: ~320×180px. Clean, no grid, minimal axis labels.

### Spectre Analysis Block

AI-generated analysis specific to this event:
- Glass card with `var(--accent)` left border (3px)
- `SPECTRE ANALYSIS` label in 10px mono uppercase accent
- Analysis text: 14px Inter, `var(--text-secondary)`, line-height 1.65
- 3-5 sentences covering: what to expect, key signals, crypto impact, historical context
- For mock data: write realistic analysis based on the event type

### Fed Sentiment Meter (ONLY for Fed/central bank events)

A horizontal slider/gauge showing hawkish ↔ dovish positioning:

```
HAWKISH ◄━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━► DOVISH
```

- Horizontal bar with gradient: red (hawkish) → gray (neutral) → green (dovish)
- Marker dot showing current assessment
- Label below: `Last decision: Slightly Hawkish` in 12px Inter muted
- Market expectation: `Market expecting: Neutral to Dovish`

**Only shown for these events:**
- FOMC Rate Decision
- FOMC Minutes
- Fed Chair Press Conference
- ECB Rate Decision
- BOE Rate Decision
- BOJ Rate Decision
- Any central bank governor speech

### Livestream Embed

For major events (Fed press conferences, ECB pressers, Jackson Hole), offer livestream:

**Before event:**
- Button: `Watch Live` (accent button)
- Subtitle: `Powell Press Conference — Federal Reserve YouTube`
- Click → opens YouTube iframe embed directly in the detail panel (like Studio media stickers)
- iframe: `allow="autoplay; encrypted-media"`, 16:9 aspect ratio, ~560×315px

**Pre-configured stream sources:**
```javascript
const LIVESTREAM_SOURCES = {
  'FOMC Press Conference': 'https://www.youtube.com/embed/live_stream?channel=UCTfE9UzOxRCRGrOPmnH1bXQ', // Fed YouTube
  'ECB Press Conference': 'https://www.youtube.com/embed/live_stream?channel=UCl4pyJJnkMVP28S63Ug3YDA', // ECB YouTube
  // Fallback: search YouTube for "[Event Name] live" and embed top result
};
```

**During event:** Stream auto-loads if user has detail panel open.
**After event:** Replace stream with `View Recording →` link.
**No stream available:** Show `No livestream available. Follow live commentary on X →` with link to Spectre's X account.

---

## 8. CRYPTO IMPACT SECTION

Every event detail includes a "Crypto Impact" subsection showing how this type of event historically affects crypto:

```
┌─ CRYPTO IMPACT ─────────────────────────────────────────────────┐
│                                                                  │
│  BTC Average Move (4h post-release):                            │
│                                                                  │
│  Beat forecast:   +2.8% avg  (last 6 instances)                 │
│  ████████████████████████████░░░░░  positive                    │
│                                                                  │
│  Miss forecast:   -1.9% avg  (last 6 instances)                 │
│  ░░░░░░████████████████████░░░░░░  negative                    │
│                                                                  │
│  In-line:         +0.4% avg  (last 6 instances)                 │
│  ░░░░░░░░░░░░██░░░░░░░░░░░░░░░░░  neutral                     │
│                                                                  │
│  Correlation with traditional markets:                           │
│  SPX: 0.72 (high)  |  DXY: -0.58 (inverse)  |  Gold: 0.34     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. SPECIAL: FED MEETING COMPREHENSIVE VIEW

When the expanded detail is for an FOMC event, add an extra section:

```
┌─ FED DECISION BREAKDOWN ─────────────────────────────────────────┐
│                                                                   │
│  Rate Decision: HOLD at 4.50%     ✓ As Expected                  │
│                                                                   │
│  Statement Changes:                                               │
│  • Removed "some further" before "progress" on inflation          │
│  • Added language on "labor market rebalancing"                   │
│  • Maintained "data dependent" framework                          │
│                                                                   │
│  Dot Plot Summary:                                                │
│  2026 median: 4.00% (prev: 4.25%) → 2 cuts expected              │
│  2027 median: 3.25% (prev: 3.50%)                                │
│  Long run: 3.00% (unchanged)                                     │
│                                                                   │
│  Market Probability (pre-meeting):                                │
│  Hold: 94% → Cut 25bp: 4% → Cut 50bp: 2%                        │
│                                                                   │
│  Tone: [HAWKISH ◄━━━━━━━━━●━━━━━━━━━━━━► DOVISH]                │
│         Slightly Hawkish                                          │
│                                                                   │
│  Key Phrases:                                                     │
│  "inflation remains somewhat elevated" — ⚠ hawkish signal        │
│  "labor market has continued to rebalance" — dovish signal        │
│  "data dependent" — neutral/expected                              │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

This is ONLY for FOMC events. It breaks down the decision in a way that's immediately actionable for traders. Mock this data for now — the structure matters.

---

## 10. WHAT HAPPENS NEXT STRIP

At the bottom of the page (or floating as a subtle bar), show:

```
┌─ WHAT'S NEXT ───────────────────────────────────────────────────────────┐
│  Next Critical:  FOMC Rate Decision  ·  Wed Feb 25  ·  14:00 EST       │
│  Next High:      Initial Claims  ·  Thu Feb 26  ·  08:30 EST           │
│  This Week:      12 events  ·  3 critical  ·  4 high                   │
└─────────────────────────────────────────────────────────────────────────┘
```

Compact strip, glass background, monospace. Always visible as a quick reference.

---

## 11. DATA STRUCTURE

### Event Object
```typescript
interface EconomicEvent {
  id: string;
  name: string;                    // "Non-Farm Payrolls"
  nameShort: string;               // "NFP"
  country: string;                 // "US"
  countryFlag: string;             // "🇺🇸" or SVG path
  currency: string;                // "USD"
  category: string;                // "Employment" | "Inflation" | "Interest Rate" | "GDP" | etc.
  impact: 'low' | 'medium' | 'high' | 'critical';
  dateTime: string;                // ISO datetime "2026-02-25T19:00:00Z"
  
  previous: string | null;         // "4.50%"
  forecast: string | null;         // "4.50%"
  actual: string | null;           // null until released
  unit: string;                    // "%", "K", "B", "index"
  
  isBetterThanExpected: boolean | null;  // null until released
  deviation: number | null;        // % deviation from forecast
  
  // Rich data
  analysis: string;                // AI analysis text
  cryptoImpact: {
    btcAvgMoveBeat: string;        // "+2.8%"
    btcAvgMoveMiss: string;        // "-1.9%"
    btcAvgMoveInline: string;      // "+0.4%"
    correlations: { asset: string; value: number }[];
  };
  
  history: {
    date: string;
    previous: string;
    forecast: string;
    actual: string;
    deviation: number;
    btcMove: string;
  }[];
  
  // Fed-specific
  isFedEvent: boolean;
  sentiment: 'hawkish' | 'slightly-hawkish' | 'neutral' | 'slightly-dovish' | 'dovish' | null;
  livestreamUrl: string | null;
  
  // State
  status: 'upcoming' | 'live' | 'released' | 'passed';
}
```

### Mock Data (Phase 1 only)

Generate 30-40 mock events for initial frontend development. BUT — the mock data shape MUST match the real API response format below so swapping is seamless.

### Real Data Sources (Phase 2+ backend integration)

These endpoints are ALREADY DESIGNED in the Spectre backend architecture. Some exist, some need building. The calendar page consumes them all.

**PRIMARY: Finnhub Economic Calendar**
```
GET /api/calendar/economic
  Source: Finnhub API (https://finnhub.io/docs/api/economic-calendar)
  Filter: high-impact events, next 7-14 days
  Cache: 15 minutes
  Polling: every 15 minutes
  Returns: [{ event, datetime, impact, country, estimate, previous, actual }]
  
  Finnhub free tier: 60 calls/min — more than enough at 15min polling
  API key: stored in env vars, already in the project config
```

Map Finnhub's `impact` field to our 4-tier system:
- Finnhub "high" → check against our CRITICAL list (Section 4) → CRITICAL or HIGH
- Finnhub "medium" → MEDIUM
- Finnhub "low" → LOW

When `actual` field populates (Finnhub updates within minutes of release), trigger the Result Flash animation on the frontend. Poll more aggressively (every 2 minutes) during windows when a critical event is expected (±30 min of scheduled time).

**EARNINGS CALENDAR:**
```
GET /api/calendar/earnings?symbols=AAPL,NVDA,TSLA,MSFT,AMZN,GOOGL,META
  Source: Finnhub earnings calendar
  Cache: 1 hour
  Returns: [{ symbol, date, hour, epsEstimate, epsActual, revenueEstimate, revenueActual }]
```

Earnings show in the calendar as HIGH impact events with a stock icon instead of country flag. Major tech earnings (NVDA, AAPL, MSFT, TSLA, AMZN, GOOGL, META) = HIGH. Others from user watchlist = MEDIUM.

**CRYPTO-SPECIFIC EVENTS:**
```
GET /api/crypto/unlocks
  Source: TokenUnlocks API or DeFiLlama
  Filter: > $10M unlock value, next 7 days
  Cache: 1 hour
  Returns: [{ token, symbol, amount_usd, unlock_date, type }]
```

Token unlocks show as MEDIUM or HIGH impact (HIGH if >$50M). Flag = token logo icon.

**FOMC DATES:**
```
Source: Hardcoded annual schedule (already in project as static JSON)
Path: /src/data/fomcDates.json
These are the anchors — CRITICAL events known months in advance.
Update once per year when the Fed publishes the next year's meeting schedule.
```

**MARKET PRICES (for Market Reaction panel):**
```
Already existing endpoints — reuse:
- /api/market/global → CoinGecko (MCap, dominance, volume)
- /api/market/tickers → Binance WSS (BTC, ETH, SOL real-time)
- /api/stocks/indices → Yahoo Finance (SPX, NDX, DXY, VIX) — 30s poll
- /api/stocks/sectors → Yahoo Finance — 2min poll
```

When a critical event releases data, the Market Reaction panel pulls current prices from these existing endpoints and compares to a snapshot taken 5 minutes before the release. The before-snapshot is cached client-side when the countdown hits T-5min.

**CME GAPS (bonus context):**
```
GET /api/market/cme-gaps
  Source: Curated JSON + live price comparison
  Cache: 5 minutes
  Returns: [{ asset, low, high, status: "UNFILLED"|"FILLED", filled_date }]
```

Can optionally show unfilled CME gaps as context in the BTC event detail panels.

### Data Flow Architecture

```
POLLING:
├── 15min  → Finnhub economic calendar → /api/calendar/economic
├── 1hr    → Finnhub earnings calendar → /api/calendar/earnings  
├── 1hr    → Token unlocks → /api/crypto/unlocks
├── 2min   → During critical event window (±30min of scheduled time)
└── static → FOMC dates JSON (hardcoded)

EXISTING (reuse for Market Reaction):
├── WSS    → Binance (BTC, ETH, SOL live prices)
├── 30s    → Yahoo Finance (SPX, NDX, DXY, VIX)
├── 5min   → Alternative.me (Fear & Greed)
└── 60s    → CoinGecko (global market data)
```

### Swap Plan

Phase 1-3: Use mock data. Shape matches real API responses exactly.
Phase 4+: Swap `mockEvents.js` import with `useCalendarData.js` hook that calls the real endpoints. Zero UI changes needed — the component contracts don't change.

---

## 12. COMPONENT STRUCTURE

```
src/pages/EconomicCalendar/
  EconomicCalendarPage.jsx         ← Main page component
  EconomicCalendarPage.css
  
  components/
    CalendarHeader.jsx             ← Title, view toggle, filters, navigation
    FilterPanel.jsx                ← Expandable filter dropdown
    
    NextUpHero.jsx                 ← Hero card for next critical event
    CountdownSidebar.jsx           ← Stacked upcoming event countdown cards
    CountdownTimer.jsx             ← Reusable ticking countdown (updates every second)
    
    DayView.jsx                    ← Day timeline view
    WeekView.jsx                   ← Week column view
    MonthView.jsx                  ← Month calendar grid view
    
    EventRow.jsx                   ← Single event in day/week views
    EventDetail.jsx                ← Expanded detail panel (history, analysis, chart, livestream)
    ResultFlash.jsx                ← Flash animation when actual data drops
    MarketReaction.jsx             ← Inline market reaction snapshot
    
    ImpactBadge.jsx                ← Reusable impact dots + label
    HistoryTable.jsx               ← Release history data table
    HistoryChart.jsx               ← SVG line chart of historical values
    
    FedSentimentMeter.jsx          ← Hawkish ↔ Dovish gauge
    FedDecisionBreakdown.jsx       ← FOMC-specific breakdown
    CryptoImpact.jsx               ← BTC avg move section
    LivestreamEmbed.jsx            ← YouTube iframe embed
    SpecterAnalysis.jsx            ← AI analysis block (reusable)
    
    WhatsNext.jsx                  ← Bottom strip showing next events
  
  hooks/
    useCalendarData.js             ← Fetches/manages event data
    useCountdown.js                ← Countdown timer hook (returns d:h:m:s, ticks every second)
    useEventStatus.js              ← Determines upcoming/live/released/passed state
    useFilters.js                  ← Filter state management
    
  data/
    mockEvents.js                  ← 30-40 mock events for development
    impactClassification.js        ← Map of event names → impact levels
    livestreamSources.js           ← Map of events → YouTube stream URLs
    analysisTemplates.js           ← Mock analysis text per event type
  
  utils/
    formatters.js                  ← Time formatting, value formatting, deviation calc
    timezone.js                    ← Timezone conversion helpers
```

---

## 13. DAY MODE SUPPORT

Every element needs a `.app.app-day-mode` counterpart:
- Glass cards → white cards with subtle shadows
- Borders → `rgba(0,0,0,0.08)` instead of `rgba(255,255,255,0.08)`
- Text → dark on light
- Impact colors stay the same (red is red in both modes)
- Countdown timer → dark text
- Critical row tint → stays `rgba(239,68,68,0.04)` (works on both)
- Charts → dark lines on light background

---

## 14. PHASE BUILD ORDER

### Phase 1 — Page + Header + Mock Data
1. Create the page route `/calendar`
2. Add to sidebar navigation
3. Build CalendarHeader with view toggle (Day/Week/Month) and date navigation
4. Generate 30+ mock events in `mockEvents.js`
5. Build ImpactBadge component
6. **Render a basic Day View** showing all events for today in time-ordered rows
7. Each row: time, impact dots, flag placeholder, event name, previous, forecast, actual placeholder

**CHECKPOINT:** You see a page with events listed by time, impact dots colored correctly, working date navigation.

### Phase 2 — Hero + Countdowns
8. NextUpHero card showing next critical event with countdown timer
9. CountdownSidebar with next 3-5 upcoming events
10. CountdownTimer hook that ticks every second
11. Countdown turns red when <1 hour, pulses when <5 min

**CHECKPOINT:** Hero card shows FOMC with a live ticking countdown. Sidebar shows stacked upcoming events.

### Phase 3 — Event Detail Expansion
12. Click event row → expands to show EventDetail
13. HistoryTable with last 6 releases
14. HistoryChart (SVG line chart)
15. SpecterAnalysis block with mock analysis text
16. CryptoImpact section with avg BTC moves

**CHECKPOINT:** Click NFP → see history table, chart, analysis, and crypto impact.

### Phase 4 — Result State + Market Reaction
17. ResultFlash animation when actual data appears
18. Beat/Miss/In-Line badge
19. Deviation calculation and display
20. MarketReaction inline snapshot (BTC, SPX, DXY, US10Y)
21. Row color-coding based on result

**CHECKPOINT:** Simulate a data release (click a button to fill in "actual"). See the flash animation, color change, and market reaction appear.

### Phase 5 — Fed Special Features
22. FedSentimentMeter (hawkish ↔ dovish gauge)
23. FedDecisionBreakdown (rate, statement changes, dot plot, key phrases)
24. LivestreamEmbed with YouTube iframe
25. "Watch Live" button that loads the stream

**CHECKPOINT:** FOMC detail shows sentiment meter, decision breakdown, and working livestream embed.

### Phase 6 — Week + Month Views
26. WeekView with 5-7 day columns
27. MonthView with calendar grid
28. Clicking day in month → switches to day view
29. Critical events highlighted in both views

### Phase 7 — Filters + Polish
30. FilterPanel with impact, currency, category toggles
31. WhatsNext bottom strip
32. Smooth expand/collapse animations
33. Day mode support for all components
34. Responsive layout for narrow viewports

---

## 15. VISUAL RULES

- **Every number in monospace.** Prices, percentages, dates, countdowns — all `var(--font-mono)`
- **Impact colors are semantic.** Red = critical/danger, orange = high, amber = medium, gray = low. Never decorative.
- **The countdown is the star.** It should feel like watching a bomb timer. Tension. Precision. Every second matters.
- **Expand transitions are smooth.** Event detail opens with `max-height` + `opacity` transition, 300ms ease-out. Not instant. Not janky.
- **No empty states.** If no events today, show: `No events scheduled. Next event: [name] on [date]` with a calm, professional empty state.
- **Critical events demand attention.** Bigger text, colored rows, pulsing indicators. The eye should be drawn to what matters.
- **History tables should feel like Bloomberg data.** Dense but readable. Monospace values. Alternating row tints. Clean headers.

---

## 16. ANIMATIONS

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Countdown tick | Number morphing (digits change, not hard-swap) | 200ms | ease-out |
| Event row hover | `translateY(-1px)` + border brighten | 150ms | ease |
| Detail expand | `max-height: 0 → auto` + `opacity: 0 → 1` | 300ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Result flash | White flash overlay + fade | 400ms | ease-out |
| Actual value count-up | Number counts from 0 to value | 500ms | ease-out |
| Beat/Miss badge | Scale from 0.8 → 1 + fade in | 250ms | spring |
| Livestream button pulse | Subtle glow pulse when stream is live | 2s infinite | ease-in-out |
| Impact dot pulse (critical) | Scale 1 → 1.3 → 1 with opacity shift | 2s infinite | ease-in-out |

---

## 17. SMART EVENT DENSITY — DON'T OVERWHELM

The calendar should feel like a curated intelligence feed, not a spammy data dump. Most users care about 5-8 events per week, not 40.

### Default Visibility Rules

**CRITICAL events:** Always fully visible. Expanded row height, bold, impossible to miss. These are the events that move portfolios.

**HIGH events:** Always visible but at normal row height. Standard weight text. Users see these without any action.

**MEDIUM events:** **Collapsed into a group by default.** Show a subtle expandable row:

```
  ──── 4 more events this morning ──── [Show ▾]
```

Clicking "Show" expands them inline with a gentle slide-down animation. They render at reduced visual weight — slightly dimmer text, thinner row padding. The group label counts how many are hidden: `3 more events` or `5 more events today`.

**LOW events:** **Hidden by default.** Not even a group row. Accessible ONLY through the filter panel toggle: `[Show Low Impact]` toggle at top of calendar view. When toggled on, they appear at minimum visual weight — 0.45 opacity, smallest text, no hover effects. A subtle info note appears: `Showing low-impact events. These rarely move crypto or equity markets.`

### Grouping Logic

Group collapsed events by time cluster. If 3 medium events all happen between 08:00–09:00, they collapse into one group row at 08:00. If a medium event is at 08:30 and the next is at 14:00, those are separate groups.

### User Memory

If a user expands a collapsed group, remember that preference for the session. Don't re-collapse on them if they navigate away and come back.

### View-Specific Behavior

- **Day View:** Medium events grouped/collapsed. Low hidden.
- **Week View:** Only Critical + High shown in the day columns. Medium/Low completely hidden (too dense otherwise). A small badge on each day column: `+4 more` linking to the Day View.
- **Month View:** Only Critical events shown by name. High events shown as dot count. Medium/Low contribute only to the `X events` count in each cell.

### The Principle

> The calendar should feel calm by default and dense on demand. A glance tells you the 2-3 things that matter this week. A click reveals everything else.

---

## 18. CROSS-ASSET FOCUS — STOCKS, CRYPTO, MACRO, COMMODITIES

This is NOT a forex-only calendar. Spectre users trade crypto, watch equities, track macro, and care about commodities. Every event should be framed through the lens of: **how does this affect my portfolio?**

### Asset Coverage

Every event shows impact across these asset classes:

| Asset | Symbol | Why It Matters |
|-------|--------|---------------|
| Bitcoin | BTC | Risk asset, liquidity proxy, correlated to rate expectations |
| Ethereum | ETH | DeFi proxy, correlated to BTC + tech sector sentiment |
| S&P 500 | SPX | Equity benchmark, risk-on/risk-off signal |
| Nasdaq | NDX | Tech/growth proxy, rate-sensitive |
| DXY (Dollar Index) | DXY | Inverse correlation to crypto, measures dollar strength |
| Gold | XAU | Safe haven, inflation hedge, inversely correlated to real rates |
| US 10-Year Yield | US10Y | Rate expectations, bond market signal, affects all risk assets |
| Crude Oil | WTI | Inflation input, geopolitical proxy |

### How This Shows in the UI

**Hero Card — Crypto Impact line should be MULTI-ASSET:**
```
Market Impact:
BTC ±3.2% avg · SPX ±0.8% avg · DXY ±0.4% avg · Gold ±1.1% avg
```

Not just BTC — show the expected move across all relevant assets.

**Event Detail — Market Reaction panel shows ALL assets:**
```
┌── MARKET REACTION (first 15 min) ─────────────────────────────┐
│  BTC:   $97,241 → $98,102  (+0.88%)   ▲                      │
│  ETH:   $3,280 → $3,312    (+0.97%)   ▲                      │
│  SPX:   5,842 → 5,861      (+0.32%)   ▲                      │
│  NDX:   18,420 → 18,501    (+0.44%)   ▲                      │
│  DXY:   105.2 → 104.8      (-0.38%)   ▼                      │
│  Gold:  $2,680 → $2,695    (+0.56%)   ▲                      │
│  US10Y: 4.32% → 4.28%      (-4bps)    ▼                      │
│  WTI:   $78.40 → $78.90    (+0.64%)   ▲                      │
└────────────────────────────────────────────────────────────────┘
```

**History Table — BTC Move column becomes MULTI-ASSET:**
Add columns or a toggle: `[BTC] [SPX] [DXY] [Gold]` — user picks which asset's historical move to see alongside each release. Default: BTC for crypto users.

**Crypto Impact section becomes ASSET IMPACT:**
```
┌─ ASSET IMPACT (4h post-release averages) ──────────────────────┐
│                                                                  │
│  On BEAT:     BTC +2.8%  ·  SPX +0.6%  ·  DXY -0.4%  ·  Gold +0.3%  │
│  On MISS:     BTC -1.9%  ·  SPX -0.4%  ·  DXY +0.5%  ·  Gold +0.8%  │
│  In-line:     BTC +0.4%  ·  SPX +0.1%  ·  DXY -0.1%  ·  Gold +0.1%  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Analysis Framing

Spectre Analysis text should ALWAYS connect macro events to crypto and equities, not just describe the event in isolation:

**Bad (generic forex calendar):**
> "The Fed is expected to hold rates at 4.50%. The dollar may strengthen on hawkish language."

**Good (Spectre style — cross-asset, crypto-aware):**
> "Markets pricing a hold at 4.50% with 94% probability. For crypto: hawkish surprise = risk-off, BTC likely retests $94K support. Dovish tilt = risk-on, BTC could challenge $100K. Watch the dot plot — if 2026 median shifts from 2 cuts to 1, expect DXY strength and broad crypto weakness. SPX futures will signal direction before crypto reacts. Gold benefits either way if real rates compress."

Every analysis should answer the trader's real question: **"What does this mean for my positions?"**

### Event Categorization for Relevance

Tag each event with which assets it primarily affects:

```typescript
interface EconomicEvent {
  // ... existing fields ...
  affectedAssets: ('BTC' | 'ETH' | 'SPX' | 'NDX' | 'DXY' | 'XAU' | 'US10Y' | 'WTI')[];
  primaryAsset: string;  // the most affected asset for this event type
}
```

Examples:
- CPI → affects ALL (inflation changes everything)
- FOMC → affects ALL
- NFP → primarily SPX, DXY, US10Y, then BTC
- Housing Starts → primarily SPX, low crypto impact
- Oil Inventories → primarily WTI, then SPX, low crypto impact
- Crypto-specific events (ETH upgrade, BTC halving, SEC rulings) → primarily BTC/ETH

### Crypto-Specific Events

The calendar should also include major crypto events that function like economic releases:

| Event | Impact | Frequency |
|-------|--------|-----------|
| Bitcoin Halving | CRITICAL | ~4 years |
| ETH Network Upgrades | HIGH | As scheduled |
| SEC/Regulatory Rulings | CRITICAL | Ad hoc |
| Crypto ETF Flow Reports | MEDIUM | Weekly |
| Stablecoin Supply Reports | MEDIUM | Weekly |
| Exchange Reserve Changes | LOW | Daily |
| Major Token Unlocks | HIGH | As scheduled |
| Protocol Governance Votes | MEDIUM | Ad hoc |

These get their own flag: a BTC/ETH icon instead of a country flag. They appear in the calendar alongside macro events, so a user sees:

```
  08:30  ●●●● CRITICAL   🇺🇸  CPI (YoY)                 Prev: 3.0%   Fcst: 3.1%
  10:00  ●●   MEDIUM      🇺🇸  Michigan Sentiment         Prev: 79.2   Fcst: 80.0
  12:00  ●●●  HIGH        ₿   ARK 21Shares BTC ETF Flow   Prev: +$142M  Fcst: ——
  14:00  ●●●  HIGH        Ξ   Dencun Upgrade Goes Live    ——           ——
```

Crypto events use the same detail expansion pattern — history, analysis, asset impact — but the analysis is crypto-native.

---

## 19. FILTER PANEL UPDATE

Add these filter categories to the filter panel from Section 1:

```
Asset Focus
[● Crypto Impact]  [● Equities Impact]  [● Commodities]  [● Bonds/Rates]

Event Source
[● Macro/Economic]  [● Crypto-Specific]  [● Central Bank]  [● Earnings-Related]
```

The "Asset Focus" filter shows only events that affect the selected asset classes. So a pure crypto trader can toggle on `Crypto Impact` and see only events that historically move BTC/ETH significantly. An equities trader can focus on SPX-relevant events.

---

## 20. WEEKLY MARKET CONTEXT — THE INTELLIGENCE LAYER

The calendar alone tells you WHAT's scheduled. This section tells you WHY it matters, WHAT's moving, and HOW events connect to each other. This is the layer that turns a data table into an intelligence product.

This section sits **between the Hero/Countdown area and the Calendar View**. It's collapsible — defaults to open on first visit, user can collapse to `[ ▾ Market Context ]` to focus on just the calendar.

### Layout

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  MARKET CONTEXT — Week of Feb 23–27, 2026                           [Collapse ▴]  │
├────────────────────────────────┬───────────────────────────────────────────────────┤
│                                │                                                   │
│  MARKET REGIME STRIP           │   DOMINANT THEMES (2-3 narrative cards)            │
│  (compact horizontal bar)      │                                                   │
│                                │                                                   │
└────────────────────────────────┴───────────────────────────────────────────────────┘
```

---

### 20a. MARKET REGIME STRIP

A compact horizontal bar showing current state across all major asset classes. One glance = full picture. This updates weekly (or when significant regime shifts happen).

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  SPX & INDICES          BTC & CRYPTO           DXY & RATES           COMMODITIES    │
│                                                                                      │
│  SPX 5,901 ▼1%         BTC $67,900 ▬ flat     DXY 107.2 ▲ strong    Gold $2,680 ▲   │
│  VIX 19.09 elevated    ETH $3,280 ▬ flat      US10Y 4.52% ▲         WTI $78.4 ▲     │
│  Breadth: mixed         Fear/Greed: 31 Fear    Rate cuts: 2 priced   Oil vol: high   │
│                                                                                      │
│  ● Cautious             ● Waiting               ● Dollar strong       ● Tension       │
│                                                                                      │
│  ○SPX ○VIX ●QQQ ○IWM   ●BTC ●ETH ○MSTR ●GBTC  ○TLT ○HYG            ○GLD ○USO      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Visual spec:**

4 equal columns inside a glass card. Each column:

- **Asset class label:** 10px mono uppercase, muted. `SPX & INDICES` etc.
- **Key values:** 14px mono. Price + direction arrow (▲ green, ▼ red, ▬ gray for flat). Bold for primary (SPX, BTC, DXY, Gold), normal for secondary.
- **Context line:** 12px Inter muted. One-line summary: `Breadth: mixed` or `Fear/Greed: 31 Fear` or `Rate cuts: 2 priced`.
- **Regime badge:** Small colored pill at bottom of each column. One or two words. Color matches sentiment:
  - Green pills: `Bullish`, `Risk On`, `Breakout`, `Accumulation`
  - Red pills: `Bearish`, `Risk Off`, `Distribution`, `Capitulation`
  - Amber pills: `Cautious`, `Waiting`, `Transition`, `Choppy`
  - Gray pills: `Neutral`, `Flat`, `Range-bound`
- **Ticker bubbles:** Bottom row of small circular bubbles for related tickers. Filled = relevant to watch this week. Just visual reference, not interactive.

**One-liner summary** below the strip — the "Spectre Verdict" in 12px Inter italic muted:

```
Spectre Verdict: Risk appetite subdued. Markets range-bound ahead of Wednesday FOMC. Dollar strength capping crypto upside. Watch dot plot for direction.
```

One sentence. Maximum two. This is the TL;DR of the entire week. Written in Spectre's hedge-fund intelligence tone — no hype, no fear, just positioning.

---

### 20b. DOMINANT THEMES

Below the regime strip: 2-3 narrative cards showing the biggest stories driving markets THIS WEEK. These are not calendar events — they're the macro narratives that give calendar events their significance.

```
┌─ DOMINANT THEMES ─────────────────────────────────────────────────────────────────┐
│                                                                                    │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  Stagflation Signal: GDP Misses     │  │  NVIDIA Earnings — AI Narrative     │  │
│  │  While PCE Runs Hot                 │  │  Make-or-Break                      │  │
│  │                                     │  │                                     │  │
│  │  Q4 GDP at 1.4% vs 3.0% expected.  │  │  NVDA reports Wednesday after       │  │
│  │  PCE prices rose 0.4% MoM. Markets  │  │  close. AI sector IV at 26.6% —    │  │
│  │  now pricing roughly 2 cuts start-  │  │  highest among majors. Strong       │  │
│  │  ing June at earliest.             │  │  guidance = rotation into tech.     │  │
│  │                                     │  │  Miss = risk-off across crypto.     │  │
│  │  KEY CATALYSTS                      │  │                                     │  │
│  │  · CPI/PPI this week for confirm.  │  │  KEY CATALYSTS                      │  │
│  │  · Fed speakers post-FOMC          │  │  · Forward guidance on data center  │  │
│  │  · Q1 GDP tracking estimates       │  │  · China export restriction impact  │  │
│  │                                     │  │  · Read-through to MSFT, AMZN      │  │
│  │                                     │  │                                     │  │
│  │  AFFECTED:                          │  │  AFFECTED:                          │  │
│  │  SPX · DXY · US10Y · BTC · Gold    │  │  NVDA · QQQ · SMH · BTC · SOL      │  │
│  └─────────────────────────────────────┘  └─────────────────────────────────────┘  │
│                                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │  KEY FOCUS: U.S.–Iran Tensions Push Oil to 2026 Highs                      │   │
│  │  Military strike decision within 10 days. Crude at $66+, XLE implied vol   │   │
│  │  surging. Energy stocks firming as hedge. Oil shock risk = inflation risk   │   │
│  │  = Fed complication. Watch IAEA diplomacy and OPEC+ response signals.      │   │
│  │  AFFECTED: WTI · XLE · XOP · HAL · DXY · Gold · BTC                       │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Each theme card is a glass inner card:**

- **Headline:** 16px `var(--font-display)` weight 600. Sharp, editorial. Written like a Bloomberg headline, not a tweet.
- **Body:** 13px Inter, `var(--text-secondary)`, line-height 1.6. 3-5 sentences MAX. Dense with information, no filler words. Every sentence adds a fact, a number, or a positioning insight.
- **Key Catalysts:** Bulleted list (use `·` character, not bullet unicode), 12px Inter. 2-4 specific things to watch. Each catalyst should be concrete and time-bound: "CPI/PPI this week" not "inflation data soon."
- **Affected tickers:** Bottom row of ticker pills. Small rounded rectangles: `SPX` `DXY` `BTC` etc. Color matches the asset class (equities = blue, crypto = purple, forex = gray, commodities = amber).

**Card limit:** 2 major theme cards + 1 compact "Key Focus" card (the Key Focus is a single-row alert-style card for a developing story that isn't a full narrative yet but traders should know about).

**Writing tone — THIS IS CRITICAL for Intelligence Hub SEO:**

These narratives must read like they were written by a macro strategist at a hedge fund, not a crypto influencer. Specific rules:

- Lead with the data point or event, not opinion
- Include specific numbers: `"GDP at 1.4% vs 3.0% expected"` not `"GDP missed badly"`
- Name specific tickers affected, not vague categories
- Always connect the narrative to actionable implications: `"Strong guidance = rotation into tech. Miss = risk-off across crypto."`
- Never use: "to the moon", "bullish af", "wen pump", "wagmi", or any crypto slang
- Never use exclamation points
- End each catalyst with a dash and brief context: `"· China export restriction impact — affecting data center capex guidance"`

This tone is what makes the content citable by Perplexity, ChatGPT, and Google Featured Snippets. Professional financial analysis that happens to cover crypto alongside traditional assets.

---

### 20c. HOW THEMES CONNECT TO CALENDAR EVENTS

Each dominant theme should visually link to the calendar events it relates to. Implementation:

1. **Theme tag on event rows:** When a calendar event is part of a dominant theme, show a small colored tag after the event name:

```
  08:30  ●●●● CRITICAL  🇺🇸  CPI (YoY)  [Stagflation]     Prev: 3.0%  Fcst: 3.1%
```

The `[Stagflation]` tag is a small pill linking back to the theme card. Clicking it scrolls up to the theme. Color matches the theme card's accent.

2. **Theme detail on event expand:** When you expand a calendar event, if it belongs to a theme, show a connection block:

```
┌─ PART OF: Stagflation Signal ─────────────────────────────────┐
│  This CPI release is the key confirmation data point for the   │
│  stagflation narrative. A hot print (>3.2%) confirms the       │
│  GDP/PCE divergence and likely delays rate cuts further.       │
│  A cool print (<2.9%) challenges the stagflation thesis.       │
└────────────────────────────────────────────────────────────────┘
```

This connects the isolated data release to the bigger picture — exactly what a trading desk does internally, now available to every Spectre user.

---

### 20d. DATA STRUCTURE FOR THEMES

```typescript
interface MarketRegime {
  weekOf: string;                    // "Feb 23–27, 2026"
  verdict: string;                   // One-line Spectre Verdict

  columns: {
    label: string;                   // "SPX & INDICES"
    primary: { symbol: string; value: string; direction: 'up' | 'down' | 'flat'; change: string; };
    secondary: { symbol: string; value: string; direction: string; }[];
    context: string;                 // "Breadth: mixed"
    regime: { label: string; sentiment: 'bullish' | 'bearish' | 'cautious' | 'neutral'; };
    tickers: string[];               // ["SPX", "VIX", "QQQ", "IWM"]
  }[];
}

interface DominantTheme {
  id: string;
  headline: string;                  // Sharp editorial headline
  body: string;                      // 3-5 sentence analysis
  catalysts: string[];               // Key things to watch
  affectedTickers: {
    symbol: string;
    assetClass: 'equity' | 'crypto' | 'forex' | 'commodity' | 'bond';
  }[];
  relatedEventIds: string[];         // Links to calendar events
  type: 'major' | 'focus';          // major = full card, focus = compact alert
  publishedAt: string;
  updatedAt: string;
}
```

### 20e. INTELLIGENCE HUB INTEGRATION

These weekly narratives are GOLD for content distribution:

1. **Auto-publish to Intelligence Hub:** Every Monday, the Market Regime + Dominant Themes auto-generate an Intelligence Hub article: *"Spectre Weekly Briefing: Feb 23–27, 2026"*. This gets indexed by Google, cited by AI search engines, shared on social.

2. **Mid-week updates:** If a dominant theme develops (e.g., CPI releases and confirms stagflation), the theme card updates AND a follow-up Intelligence Hub article publishes: *"CPI Confirms Stagflation Signal — What Crypto Traders Need to Know"*

3. **SEO structure:** Each theme headline is designed to match search queries:
   - "stagflation signal GDP PCE 2026" → search hit
   - "NVIDIA earnings AI crypto impact" → search hit
   - "FOMC rate decision February 2026 bitcoin" → search hit

4. **Shareable theme cards:** Each theme card has a share button that generates a branded OG image card (like the AI Brief share cards) — the headline + affected tickers + Spectre branding. One-tap share to X.

---

### 20f. GENERATION — WHO WRITES THIS

**For MVP (mock):** Write 2-3 realistic narrative cards per week based on whatever macro events are in the mock data. Make them detailed and specific.

**For production:** These are generated by the Intelligence Hub AI agents, specifically:

- **Macro Regime Agent** — runs Sunday evening, analyzes weekly closes across all assets, generates the regime strip
- **Narrative Agent** — runs Sunday evening + Wednesday midweek, identifies the 2-3 dominant stories from news + data + price action, generates theme cards
- **Event Linker** — after each critical/high event releases data, updates the relevant theme card with the new information and publishes a follow-up

The calendar page consumes these via the same content pipeline as Intelligence Hub. The narratives appear on the calendar page AND as standalone Intelligence Hub articles — one source of truth, two distribution surfaces.

---

### 20g. COMPONENT ADDITIONS

Add to the component structure:

```
src/pages/EconomicCalendar/
  components/
    MarketContext.jsx              ← Collapsible wrapper for regime + themes
    MarketRegimeStrip.jsx          ← 4-column regime bar
    DominantThemes.jsx             ← 2-3 narrative cards grid
    ThemeCard.jsx                  ← Individual theme card (major or focus variant)
    RegimeBadge.jsx                ← Colored sentiment pill
    TickerBubble.jsx               ← Small ticker reference pill
    ThemeTag.jsx                   ← Small tag on event rows linking to themes
    ShareThemeCard.jsx             ← OG image generator for theme sharing

  data/
    mockRegime.js                  ← Mock regime data for this week
    mockThemes.js                  ← 2-3 mock dominant themes with realistic content
```

---

### 20h. PHASE ADDITION

Insert after Phase 2 (Hero + Countdowns), before Phase 3 (Event Detail):

**Phase 2.5 — Market Context Layer**
1. MarketRegimeStrip with 4 columns showing asset classes
2. DominantThemes with 2 major cards + 1 focus card
3. ThemeCard with headline, body, catalysts, affected tickers
4. Collapsible wrapper (open by default)
5. Spectre Verdict one-liner below regime strip
6. Theme tags on relevant event rows in the calendar

**CHECKPOINT:** Between the hero card and the calendar, you see a regime strip with SPX/BTC/DXY/Gold status + 2-3 narrative cards with sharp headlines, analysis, and ticker pills. Clicking "Collapse" hides the entire context section to show just the calendar.

---

## START COMMAND

```
Read SPECTRE_DESIGN_LAW.md first.
Read this file (SPECTRE_ECONOMIC_CALENDAR.md) — ALL of it, including sections 17-20.
Build Phase 1: page route, sidebar nav item, header with view toggle, mock data (30+ events with proper impact classification), Day View rendering events with smart density (medium collapsed, low hidden), impact dots, time ordering.
Use the existing page patterns (look at how other pages like CategoriesPage or WatchlistsPage are structured).
Include crypto-specific events (ETF flows, token unlocks) alongside macro events in mock data.
Load today's events by default.
Report back what you built before Phase 2.
```
