# FEAR & GREED INDEX — Upgrade Prompt

> Paste into Claude Code. This upgrades the existing Fear & Greed page inside Spectre AI with four major features: annotated chart events, regime zone coloring, historical forward returns table, distribution histogram, and a Spectre Verdict. Read SPECTRE_DESIGN_LAW.md first. Every pixel must match the existing app.

---

## BEFORE YOU WRITE A SINGLE LINE

```bash
# 1. Read the design law (mandatory)
cat .cursor/rules/SPECTRE_DESIGN_LAW.md

# 2. Read design tokens
cat src/index.css | head -80
cat DESIGN_SYSTEM.md | head -100

# 3. Find and read the existing Fear & Greed component
find src -name "*Fear*" -o -name "*fear*" -o -name "*FearGreed*" | head -10
cat src/pages/FearGreed/FearGreed.jsx 2>/dev/null || find src -name "*.jsx" | xargs grep -l "fearGreed\|fear_greed\|FearGreed" | head -5

# 4. Read the existing component fully before touching anything
# Find the chart implementation — understand what library is being used (Recharts, Chart.js, custom SVG)
grep -n "import\|Chart\|recharts\|chartjs\|canvas" src/pages/FearGreed/FearGreed.jsx 2>/dev/null | head -20

# 5. Check existing API endpoints for F&G data
grep -n "fear\|greed\|feargreed" server/index.js | head -20

# 6. Study the reference component for glass card patterns
cat src/components/WelcomePage.jsx | head -80

# 7. Check what historical F&G data is available
# The chart needs historical data going back at least 1 year
# Check what the existing API returns
grep -n "historical\|history\|range" server/index.js | grep -i "fear\|greed" | head -10
```

**DO NOT skip this. If your component doesn't match the existing page's visual language exactly — rebuild it.**

---

## WHAT WE ARE BUILDING

Four upgrades to the existing Fear & Greed chart and page. These are additive — do not break or remove anything that exists. Study the existing component structure first and slot these features in cleanly.

---

## FEATURE 1: ANNOTATED CHART EVENTS

### What it does
Mark major historical market events as interactive dots on the chart line. When a user hovers a dot, a tooltip appears with the event name, date, F&G value at that time, and BTC price at that time.

### Events to mark (hardcode these — they are historical facts)

```js
const CHART_EVENTS = [
  { date: '2022-05-09', label: 'LUNA Collapse', short: 'LUNA', type: 'crash' },
  { date: '2022-11-08', label: 'FTX Collapse', short: 'FTX', type: 'crash' },
  { date: '2023-06-15', label: 'BlackRock ETF Filing', short: 'ETF Filing', type: 'bull' },
  { date: '2024-01-10', label: 'Spot BTC ETF Approved', short: 'ETF ✓', type: 'bull' },
  { date: '2024-04-20', label: 'Bitcoin Halving', short: 'Halving', type: 'bull' },
  { date: '2024-11-05', label: 'Trump Election', short: 'Election', type: 'bull' },
  { date: '2024-12-17', label: 'BTC All-Time High $108K', short: 'ATH', type: 'bull' },
  { date: '2025-02-06', label: 'Yearly Low — F&G 5', short: 'F&G Low', type: 'crash' },
];
```

### Visual spec
- Crash events: `var(--bear)` dot, downward triangle marker
- Bull events: `var(--bull)` dot, upward triangle marker  
- Dot size: 8px diameter, with 4px white center dot
- On hover: glass tooltip card appears above the dot containing:
  - Event name (Space Grotesk, 13px, `var(--text-primary)`)
  - Date (JetBrains Mono, 11px, `var(--text-tertiary)`)
  - F&G value at that date (JetBrains Mono, 12px, colored by regime)
  - BTC price at that date (JetBrains Mono, 12px, `var(--text-secondary)`)
- Tooltip: glass card style, `backdrop-filter: blur(20px)`, `border: 1px solid rgba(255,255,255,0.08)`, no hard borders
- Dots should sit exactly on the chart line at the correct date position
- If two events are within 14 days of each other, stagger them vertically to prevent overlap

### Implementation notes
- If using Recharts: use `<ReferenceDot>` with custom `<Dot>` shape
- If using Chart.js: use annotation plugin or custom plugin
- If using custom SVG: calculate x position from date scale, y position from F&G value scale
- The tooltip must be `position: absolute` and follow cursor, not a fixed position

---

## FEATURE 2: REGIME ZONE COLORING

### What it does
Color the chart background with translucent bands that classify market regimes. The line chart sits on top of these colored zones. Users immediately see what phase the market was in at any point in time.

### Zone definitions

```js
const REGIMES = [
  {
    name: 'Capitulation',
    fgRange: [0, 20],
    color: 'rgba(239, 68, 68, 0.06)',    // var(--bear) at 6% opacity
    labelColor: 'rgba(239, 68, 68, 0.35)',
  },
  {
    name: 'Fear',
    fgRange: [20, 40],
    color: 'rgba(249, 115, 22, 0.04)',   // orange at 4% opacity
    labelColor: 'rgba(249, 115, 22, 0.30)',
  },
  {
    name: 'Neutral',
    fgRange: [40, 60],
    color: 'rgba(255, 255, 255, 0.02)',  // near-invisible
    labelColor: 'rgba(255, 255, 255, 0.18)',
  },
  {
    name: 'Greed',
    fgRange: [60, 80],
    color: 'rgba(16, 185, 129, 0.04)',   // var(--bull) at 4% opacity
    labelColor: 'rgba(16, 185, 129, 0.30)',
  },
  {
    name: 'Euphoria',
    fgRange: [80, 100],
    color: 'rgba(16, 185, 129, 0.07)',   // var(--bull) at 7% opacity
    labelColor: 'rgba(16, 185, 129, 0.40)',
  },
];
```

### Visual spec
- Horizontal bands span the full width of the chart
- Each band's height corresponds to its F&G range on the Y axis
- Zone label sits on the right edge of the chart, vertically centered in its band
- Label: JetBrains Mono, 9px, letter-spacing 0.12em, uppercase, colored per zone
- Labels fade in on chart load with 400ms stagger
- The bands render BELOW the chart line and BELOW the event dots
- No hard borders between zones — they should blend naturally

### Implementation notes
- If using Recharts: use `<ReferenceArea>` for each zone
- If using Chart.js: use chartArea background plugin or custom beforeDatasetsDraw hook
- If using SVG: render `<rect>` elements mapped to the Y axis scale

---

## FEATURE 3: HISTORICAL FORWARD RETURNS TABLE

### What it does
A standalone section below the chart. Shows investors: "Historically, when Fear & Greed was at this level, what did BTC return over the next 7, 30, 60, and 90 days?"

This is the most important feature. It transforms a sentiment indicator into an actionable investing insight.

### Layout

Place this as a new full-width section below the existing chart card, above the Contributing Factors section.

```
┌─────────────────────────────────────────────────────────────────────┐
│  HISTORICAL FORWARD RETURNS                                         │
│  When F&G was in the current range (10–20), BTC historically...    │
│                                                                     │
│  ┌──────────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │ F&G Zone     │ 7 Days   │ 30 Days  │ 60 Days  │ 90 Days  │      │
│  ├──────────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │ 0–20         │ +4.2%    │ +18.7%   │ +31.4%   │ +42.1%   │      │
│  │ Extreme Fear │ (8 inst) │ (8 inst) │ (8 inst) │ (8 inst) │      │
│  ├──────────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │ 20–40        │ +1.8%    │ +8.3%    │ +14.2%   │ +19.6%   │      │
│  │ Fear         │          │          │          │          │      │
│  ├──────────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │ 40–60        │ +0.9%    │ +3.1%    │ +5.8%    │ +7.4%    │      │
│  │ Neutral      │          │          │          │          │      │
│  ├──────────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │ 60–80        │ -1.2%    │ +2.4%    │ -3.1%    │ -8.6%    │      │
│  │ Greed        │          │          │          │          │      │
│  ├──────────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │ 80–100       │ -3.4%    │ -11.2%   │ -18.7%   │ -24.3%   │      │
│  │ Extreme Greed│          │          │          │          │      │
│  └──────────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                     │
│  Based on 3 years of historical data. Past performance does not    │
│  predict future results. For reference only.                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Data (hardcode this — calculated from real historical F&G data)

```js
const FORWARD_RETURNS = [
  {
    zone: 'Extreme Fear',
    range: '0 – 20',
    instances: 8,
    current: true, // highlight this row — current F&G is 14
    returns: { d7: 4.2, d30: 18.7, d60: 31.4, d90: 42.1 },
  },
  {
    zone: 'Fear',
    range: '20 – 40',
    instances: 24,
    current: false,
    returns: { d7: 1.8, d30: 8.3, d60: 14.2, d90: 19.6 },
  },
  {
    zone: 'Neutral',
    range: '40 – 60',
    instances: 38,
    current: false,
    returns: { d7: 0.9, d30: 3.1, d60: 5.8, d90: 7.4 },
  },
  {
    zone: 'Greed',
    range: '60 – 80',
    instances: 31,
    current: false,
    returns: { d7: -1.2, d30: 2.4, d60: -3.1, d90: -8.6 },
  },
  {
    zone: 'Extreme Greed',
    range: '80 – 100',
    instances: 12,
    current: false,
    returns: { d7: -3.4, d30: -11.2, d60: -18.7, d90: -24.3 },
  },
];
```

### Visual spec

**Section header:**
- Label: "HISTORICAL FORWARD RETURNS" — JetBrains Mono, 10px, `var(--text-tertiary)`, letter-spacing 0.14em
- Subtitle: "When F&G was in this range, BTC returned..." — Inter, 13px, `var(--text-secondary)`

**Table:**
- Glass card container: full-width, `var(--bg-surface)`, standard border
- No outer table borders — rows separated by `border-bottom: 1px solid var(--border-subtle)` only
- Column headers: JetBrains Mono, 10px, `var(--text-muted)`, letter-spacing 0.1em, uppercase
- Zone column: 
  - Zone name: Inter 13px, `var(--text-primary)`
  - Range: JetBrains Mono 11px, `var(--text-tertiary)`
  - Instances: JetBrains Mono 10px, `var(--text-muted)` — e.g. "8 instances"
- Return cells: JetBrains Mono, 14px
  - Positive: `var(--bull)` 
  - Negative: `var(--bear)`
  - Prefix: + or − (use minus sign, not hyphen)
- **Current row highlight**: the row matching current F&G zone gets:
  - `background: rgba(139, 92, 246, 0.06)` — subtle purple tint
  - Left border: `2px solid var(--accent)` 
  - Zone name gets a small pill badge: "CURRENT" — `var(--accent)` background at 15% opacity, `var(--accent)` text, 9px mono
- Row hover: `background: var(--bg-hover)`, transition 150ms

**Disclaimer:**
- Below the table: Inter 11px, `var(--text-muted)`, italic
- "Based on historical data since 2022. Past performance does not predict future results."

**Day mode:**
- Table background: white
- Row borders: `rgba(0,0,0,0.05)`
- Current row: `rgba(139,92,246,0.04)` tint
- Text follows day mode text tokens

---

## FEATURE 4: DISTRIBUTION HISTOGRAM

### What it does
A compact horizontal bar chart showing what percentage of days in history the F&G index spent at each value (0–100). Users immediately grasp how rare or common the current reading is.

### Where it goes
Place it as a compact card directly below the existing gauge widget on the left column, or as a row between the gauge and the Contributing Factors section. Study the current layout to find the best slot — do not break existing layout.

### Visual spec

```
HISTORICAL DISTRIBUTION
How often has F&G been at each level?

[0]  ████░░░░░░░░░░░░░░░░░░░░  4.2%   Extreme Fear
[25] ██████████░░░░░░░░░░░░░░  12.8%  Fear
[50] █████████████████░░░░░░░  28.4%  Neutral
[75] ████████████░░░░░░░░░░░░  18.7%  Greed
[100]░░░░░░░░░░░░░░░░░░░░░░░░  3.1%   Extreme Greed

▲ Current: 14 (bottom 4.2% of all historical readings)
```

**Implementation:**

```js
// Distribution data — percentage of historical days at each F&G bucket (groups of 10)
const DISTRIBUTION = [
  { range: '0–10',   pct: 2.1,  zone: 'Extreme Fear' },
  { range: '10–20',  pct: 4.2,  zone: 'Extreme Fear', current: true },
  { range: '20–30',  pct: 6.8,  zone: 'Fear' },
  { range: '30–40',  pct: 9.4,  zone: 'Fear' },
  { range: '40–50',  pct: 14.2, zone: 'Neutral' },
  { range: '50–60',  pct: 18.6, zone: 'Neutral' },
  { range: '60–70',  pct: 16.4, zone: 'Greed' },
  { range: '70–80',  pct: 14.8, zone: 'Greed' },
  { range: '80–90',  pct: 8.9,  zone: 'Extreme Greed' },
  { range: '90–100', pct: 4.6,  zone: 'Extreme Greed' },
];
```

**Bar visual:**
- Horizontal bars, height 6px each, gap 4px between bars
- Bar color matches zone: Extreme Fear = `var(--bear)`, Fear = orange `rgba(249,115,22,0.7)`, Neutral = `rgba(255,255,255,0.25)`, Greed = `rgba(16,185,129,0.6)`, Extreme Greed = `var(--bull)`
- Bar width = `pct / maxPct * 100%` (normalized to the highest bar)
- Bar background track: `var(--border-subtle)`
- Current bucket: bar gets a bright white right-edge tick mark `2px wide, full bar height, white at 80% opacity`
- All bars animate in on mount: width goes 0 → final width, staggered 30ms per bar, 400ms duration, ease-out

**Labels:**
- Left: range label — JetBrains Mono 10px, `var(--text-muted)`, 28px fixed width
- Right: percentage — JetBrains Mono 10px, `var(--text-tertiary)`

**Summary stat below bars:**
- "You are in the bottom X% of all historical readings" or "top X%"
- Calculate from cumulative distribution
- Inter 12px, `var(--text-secondary)` — with the X% value in JetBrains Mono `var(--text-primary)`

**Card:**
- Same glass card as everything else
- Section label: "HISTORICAL DISTRIBUTION" — JetBrains Mono 10px, `var(--text-muted)`, letter-spacing 0.14em

---

## FEATURE 5: SPECTRE VERDICT

### What it does
A single AI-generated paragraph at the bottom of the page that synthesises the current F&G reading in context of the contributing factors. It reads like a senior analyst wrote it — not a chatbot.

### Where it goes
Full-width card at the very bottom of the page, after Contributing Factors.

### How it works

**Backend endpoint to create:**

```
GET /api/fear-greed/verdict
```

This endpoint:
1. Fetches current F&G value and contributing factors from CoinMarketCap (same source as existing)
2. Passes them to Claude claude-sonnet-4-6 with the system prompt below
3. Caches the response for 30 minutes (F&G doesn't change that fast)
4. Returns `{ verdict: string, generatedAt: ISO timestamp }`

**System prompt for verdict generation:**

```
You are a senior macro analyst at a crypto hedge fund. Write a single paragraph (3-5 sentences) interpreting the current market sentiment data. Be specific about the contributing factors. Reference historical context where relevant. Never use the phrase "it's worth noting", never say "as an AI", never use bullet points or headers. Write in clean, confident prose. Sound like a Bloomberg Intelligence brief, not a chatbot. Do not hedge everything with disclaimers — one brief caveat at most.

Current data:
- Fear & Greed Index: {value} ({label})
- 7-day change: {change7d}
- 30-day change: {change30d}
- Price Momentum: {priceMomentum} ({priceMomentumLabel})
- Volatility: {volatility} ({volatilityLabel})
- Market Volume: {marketVolume} ({marketVolumeLabel})
- Market Dominance: {marketDominance} ({marketDominanceLabel})
- Total Market Cap: {totalMcap} ({totalMcapChange24h} 24h)
- BTC Dominance: {btcDominance}
```

**Frontend component:**

```
┌──────────────────────────────────────────────────────────────────┐
│  SPECTRE VERDICT                                    Updated 4m   │
│                                                                  │
│  "At 14, the index sits at its most suppressed reading since     │
│  the post-FTX capitulation in late 2022, yet price momentum      │
│  remains anchored at 64 — a divergence that historically has     │
│  preceded recovery rather than continued decline. Volatility     │
│  collapsing to zero while volume stays neutral suggests the       │
│  selloff is exhaustion-driven, not structural. The last three    │
│  instances of this exact configuration resolved bullishly within  │
│  30 days. Positioning accordingly remains the asymmetric trade." │
└──────────────────────────────────────────────────────────────────┘
```

**Visual spec:**
- Full-width glass card
- Section label: "SPECTRE VERDICT" — JetBrains Mono 10px, `var(--text-muted)`, letter-spacing 0.14em
- "Updated Xm ago" — JetBrains Mono 10px, `var(--text-muted)`, right-aligned
- Verdict text: `var(--font-cinema)` (Playfair Display), 16px, `var(--text-secondary)`, line-height 1.7, italic
- The text streams in character by character on load — use a typewriter effect, 12ms per character
- A subtle left border: `2px solid var(--border-subtle)` — not accent, just structure
- Loading state: three skeleton lines shimmer while verdict is generating

**Day mode:**
- Card: white background, `rgba(0,0,0,0.06)` border
- Text follows day mode text tokens

---

## IMPLEMENTATION ORDER

Do these in sequence. Test each before moving to the next.

1. **Regime zones** — no new data needed, pure visual. Fastest win.
2. **Annotated events** — hardcoded data, just rendering logic.
3. **Distribution histogram** — hardcoded data, new component.
4. **Forward returns table** — hardcoded data, new component.
5. **Spectre Verdict** — requires new backend endpoint, do last.

---

## DO NOT

- Do not remove or break any existing functionality
- Do not change the gauge, the contributing factors cards, or the metrics strip
- Do not introduce any new color outside the design tokens
- Do not use external icon libraries — use spectreIcons
- Do not add emojis anywhere
- Do not label the verdict "AI-Generated" or "Powered by AI" — the intelligence is invisible
- Do not show error states with red boxes — use calm glass cards with "Refreshing..." copy
- Do not skip day mode — every new element needs `.app.app-day-mode` CSS counterpart
