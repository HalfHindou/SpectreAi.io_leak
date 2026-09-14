# TASK: Spectre Brain — Complete Page Redesign

## THIS REPLACES THE CURRENT BrainPage.jsx ENTIRELY.

## MANDATORY: Read before writing ANY code
1. `SPECTRE_DESIGN_LAW.md` (root) — READ THE FULL THING including Creative Agent section
2. `src/index.css` (`:root` variables)
3. `src/icons/spectreIcons.jsx`
4. `src/components/WelcomePage.jsx` + `WelcomePage.css` (design reference)

---

## THE VISION

The Brain page is not a dashboard. It's not a feed. It's the VOICE of Spectre AI.

Think of it as: what if Bloomberg Terminal had a soul. What if every data point 
you could access across 500+ API endpoints was distilled into one living, breathing 
surface that tells you what matters right now and why.

The page has two modes of consumption:
1. **Glance** (5 seconds): Stance, key levels, F&G, top movers. You know the market mood instantly.
2. **Deep read** (5 minutes): Thesis, narratives, signals, derivatives, DeFi flows, whale activity, upcoming catalysts, track record. Full picture.

Layout: Full-width bento grid. Not a single column blog post. Apple widget-style 
cards of different sizes that create visual rhythm. Dense with information but 
never cluttered because hierarchy does the work.

---

## API ENDPOINTS (all via /api/brain proxy to api.spectreai.io)

```
GET /v1/brain                     -> state (market_data, defi_data, social_data, onchain_data, calendar_data) + conviction
GET /v1/brain/signals             -> signal feed with filtering
GET /v1/brain/narratives          -> active narratives  
GET /v1/brain/conviction?limit=20 -> conviction history
GET /v1/brain/track-record        -> graded stats + proof cards
GET /v1/brain/tokens/trending     -> tokens by signal activity
GET /v1/brain/tokens/risky        -> FDV:liquidity anomalies
GET /v1/brain/token/:symbol       -> individual token intelligence
```

The brain_state object contains sub-objects for each data domain:
- market_data: prices, F&G, top_prices (top 20 tokens with price/change/volume)
- defi_data: total_tvl, top_protocols, top_yields, stablecoin_mcap
- social_data: trending_topics, sentiment per asset
- onchain_data: whale moves, exchange flows
- calendar_data: upcoming economic events
- conviction: stance, confidence, risk, levels, verdict, narratives, catalysts

---

## PAGE LAYOUT: BENTO GRID

Max-width: 1200px centered. 12-column grid. Gap: 16px.
Mobile: single column, cards stack.

```
┌─────────────────────────────────────────────────────────────┐
│                    THE THESIS (full width)                    │
│   Stance + Conviction + Verdict + Key Levels                 │
│                    (8 cols)              (4 cols: F&G gauge   │
│                                          + risk bar          │
│                                          + prices strip)     │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐ ┌───────────┐
│   MARKET PULSE       │ │   DERIVATIVES        │ │ NEXT      │
│   BTC ETH SOL        │ │   OI, Funding,       │ │ CATALYST  │
│   prices + sparklines│ │   Liquidations       │ │           │
│   (4 cols)           │ │   (4 cols)           │ │ (4 cols)  │
└──────────────────────┘ └──────────────────────┘ └───────────┘
┌──────────────────────────────────┐ ┌────────────────────────┐
│   NARRATIVES (8 cols)            │ │  DEFI FLOWS (4 cols)   │
│   Horizontal scroll of narrative │ │  TVL, top movers,      │
│   cards with lifecycle status    │ │  yield opportunities   │
└──────────────────────────────────┘ └────────────────────────┘
┌──────────────────────────────────┐ ┌────────────────────────┐
│   SIGNAL FEED (8 cols)           │ │  WHALE ACTIVITY        │
│   Mixed signal types, live feel  │ │  (4 cols)              │
│   Timestamps, severity bars      │ │  Recent large moves    │
│                                  │ │  + exchange flows      │
│                                  │ ├────────────────────────┤
│                                  │ │  SOCIAL TRENDING       │
│                                  │ │  (4 cols)              │
│                                  │ │  Hot topics from X     │
└──────────────────────────────────┘ └────────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐ ┌───────────┐
│   TOKEN RADAR        │ │  TRACK RECORD        │ │ CONVICTION│
│   Trending by signal │ │  Stats + proof cards │ │ TIMELINE  │
│   activity           │ │                      │ │           │
│   (4 cols)           │ │  (4 cols)            │ │ (4 cols)  │
└──────────────────────┘ └──────────────────────┘ └───────────┘
```

---

## SECTION DETAILS

### 1. THE THESIS (hero, full width, glass card)

The premium welcome-widget treatment. This is the screenshot moment.

**Left zone (8 cols):**

Top-left: Stance as typography, not a badge.
- "LEAN BULL" or "CAUTIOUS" or "BEARISH"
- `--font-display`, 40px, bold, letter-spacing: -0.04em
- Color: `--bull` green for bull variants, `--bear` red for bear, `--text-muted` for neutral
- Below: "85% conviction" in `--font-mono`, 14px, `--text-secondary`

Below the stance: THE VERDICT
- `--font-body`, 14px, line-height 1.8, `--text-secondary`
- First sentence: 16px, `--text-primary` (the hook — the most interesting thing)
- Max-width 640px. Comfortable reading measure.
- Ends with the "We flip if..." condition in `--text-tertiary` italic

Below verdict: Key levels as a compact row
```
BTC $74,631  S: 72K / 70K  R: 78K / 80K    ETH $2,381  S: 2.1K / 1.9K  R: 2.5K / 2.7K
```
All `--font-mono`. Prices `--text-primary`. Support `--bull` at 0.7. Resistance `--bear` at 0.7.

Bottom of left zone: Short-term + medium-term as two compact lines:
- "24-48h: Bearish — watching 73K, PPI at 1:30pm ET today" 
- "1-2 weeks: Neutral — CPI outcome determines direction"
- Small colored dots before each. `--font-body`, 12px.

**Right zone (4 cols):**

Stacked vertically in this order:

**Fear & Greed Gauge:**
Semi-circular arc gauge. NOT a number in a box.
- SVG arc from red (0) through yellow (50) to green (100)
- Needle pointing at current value
- Current value as large number below: "55" in `--font-mono`, 28px
- Label: "Neutral" below in `--text-tertiary`
- Subtle ambient glow matching the zone color (green/yellow/red)

**Risk Level Bar:**
5 horizontal segments (Low / Moderate / Elevated / High / Extreme)
- Each segment: 40px wide, 6px tall, 2px gap
- Filled segments glow with color gradient (green -> yellow -> orange -> red)
- Label below: "MODERATE" in `--text-muted`, 10px, uppercase

**Mini Price Strip:**
Vertical stack of top 3 assets:
```
BTC  $74,631  +2.7%  [sparkline]
ETH   $2,381  +5.8%  [sparkline]
SOL     $128  +4.1%  [sparkline]
```
Each: symbol in `--text-muted`, price in `--font-mono` `--text-primary`, 
change colored bull/bear, tiny 40px sparkline SVG.

---

### 2. MARKET PULSE (4 cols, glass card)

Title: "Market Pulse" in section header style (12px, uppercase, `--text-muted`, letter-spacing 0.1em)

A compact table of the top 10 tokens the brain is tracking.
Data source: `state.market_data.top_prices`

Each row:
```
#  Symbol   Price       24h        Volume
1  BTC      $74,631    +2.7%      $42.3B
2  ETH       $2,381    +5.8%      $18.7B
3  SOL        $128     +4.1%       $3.2B
```

- Rank in `--text-muted`
- Symbol in `--text-primary`, bold
- Price in `--font-mono`
- Change colored green/red with subtle row background tint
- Volume in `--font-mono`, `--text-tertiary`
- Rows: hover lifts slightly, shows border brighten
- No explicit "table" look. Clean rows with subtle dividers (`--border-subtle`)

If a token moved >5% in 1h, add a subtle pulsing glow on that row.

---

### 3. DERIVATIVES PANEL (4 cols, glass card)

Title: "Derivatives"
Data source: `state.market_data` (funding rates, OI, liquidations from the exchanges source)

Three mini-sections stacked:

**Open Interest:**
- Total OI as large number: "$259.6B" in `--font-mono`, 20px
- 24h change: "+3.2%" colored
- Mini horizontal bar showing long/short ratio if available

**Funding Rates:**
- BTC: -0.002% | ETH: +0.001% | SOL: -0.005%
- Negative = `--bull` (shorts paying, bullish signal)
- Positive = `--bear` (longs paying)
- Each as a compact row with colored dot

**Recent Liquidations:**
- Last 24h total: "$312M liquidated"
- Largest single: "$144M ETH shorts"
- Sentiment indicator: "Short squeeze" or "Long flush" based on dominant side
- Side bias as a small bar (% longs vs shorts liquidated)

---

### 4. NEXT CATALYST (4 cols, glass card)

Title: "Next Catalyst"
Data source: `state.calendar_data.upcoming_events` + `conviction.catalysts`

Show the single most important upcoming event prominently:
- Event name: "PPI Release" in `--font-display`, 18px
- Date/time: "Today, 1:30 PM ET" in `--font-mono`, `--text-secondary`
- Countdown: "in 4h 23m" with live countdown animation
- Impact badge: "CRITICAL" with red dot + `--bear` color
- Brain's take: 1 sentence from catalysts array: "Hot PPI above 0.4% sends BTC to 70K. Cool print triggers squeeze to 78K."

Below: next 3 upcoming events as compact list:
- Date + name + impact dot
- `--font-mono` for dates, `--font-body` for names

---

### 5. NARRATIVES (8 cols)

Title: "Active Narratives"

Horizontal scroll row of narrative cards. Each card:
- Width: 260px
- Top edge: 3px colored line for lifecycle status
  - emerging: `--accent` purple
  - building: #3B82F6 blue
  - peak: `--bull` green  
  - fading: #F59E0B amber
- Narrative name: `--font-display`, 15px
- Summary: 2 lines max, `--font-body`, 13px, `--text-secondary`
- Asset tags: small pills
- Signal count: "12 signals" in `--text-muted`
- Status label: small text like "BUILDING" in the status color

Minimum 3 cards. If only 1 narrative exists, still show it but add 
ghost cards with "Watching for emerging narratives..." in `--text-muted`.

---

### 6. DEFI FLOWS (4 cols, glass card)

Title: "DeFi"
Data source: `state.defi_data`

**Total TVL:**
- "$187.3B" in `--font-mono`, 22px
- 24h change colored

**Top Movers (3 protocols):**
```
PancakeSwap  $4.2B  +104%
Rhea Lend     $89M   +73%
Aave         $12.1B   +2%
```
Name + TVL + change. Big movers get background tint.

**Top Yield:**
Best yield opportunity as a highlight:
"Aave USDC on Ethereum: 8.2% APY ($2.1B TVL)"
In a subtle highlighted sub-card.

---

### 7. SIGNAL FEED (8 cols)

Title: "Feed" with filter pills: Critical · High · All

This is the living center. Each signal is a CARD, not a table row.

Each signal card:
- Left: 3px severity bar (critical: red, high: amber, medium: gray)
- Top-right: timestamp "3m ago" in `--font-mono`, `--text-muted`
- Signal type: small uppercase badge "WHALE MOVE" "LIQUIDATION" "DEFI FLOW" "GOVERNANCE" "PRICE MOVE" "NARRATIVE" "MACRO EVENT"
  - Each type gets a distinct muted color for the badge
- Title: `--font-body`, 14px, `--text-primary`
- Summary: 13px, `--text-tertiary`, 1-2 lines
- Bottom: asset tags + sentiment dot (green/red/neutral)
- Subtle row background tint for sentiment (barely visible)

DIVERSITY RULE: The feed should never show more than 2 of the same signal_type 
in a row. Mix it up. A whale move, then a liquidation, then a DeFi flow, then 
a governance vote. This is curated intelligence, not a log dump.

Show 10 signals by default. "Load more" as minimal text button.

New signals (< 5 min old): subtle slide-in entrance animation from left.

---

### 8. WHALE ACTIVITY (4 cols, glass card)

Title: "Whales"
Data source: `state.onchain_data`

Recent whale transactions as compact entries:
```
$52M ETH → Coinbase     2h ago
$18M BTC ← Binance      4h ago  
$31M SOL wallet→wallet   6h ago
```

Arrow indicates direction:
- → exchange = potential sell = `--bear` tint
- ← exchange = accumulation = `--bull` tint
- wallet→wallet = neutral

Each entry: amount in `--font-mono` bold, asset, direction, time in `--text-muted`

Show 5 entries max. If no whale data yet, show "Watching the deep waters..." in 
`--text-muted` with subtle wave animation.

Below: Exchange net flow summary if available
"Net outflow: -$142M (24h)" = bullish (coins leaving exchanges)

---

### 9. SOCIAL TRENDING (4 cols, glass card)

Title: "Trending"
Data source: `state.social_data`

Top 8 trending topics/tokens from X:
```
1. Bitcoin       ████████░░  Bullish
2. Ethereum      ██████░░░░  Neutral  
3. Solana        █████░░░░░  Bullish
4. FOMC          ████░░░░░░  Bearish
5. PancakeSwap   ████░░░░░░  Bullish
```

Each: rank, name, sentiment bar (colored segments), sentiment label.
The bar is a tiny inline visualization showing relative mention volume.

If no social data: "Scanning the timeline..." with subtle typing dots animation.

---

### 10. TOKEN RADAR (4 cols, glass card)

Title: "Token Radar"
Data source: `/v1/brain/tokens/trending`

Tokens ranked by brain signal activity (most interesting to the brain right now):

```
BTC    12 signals  ●●●●●●●●●●●●
ETH     8 signals  ●●●●●●●●
ARB     5 signals  ●●●●●
CAKE    4 signals  ●●●●
SOL     3 signals  ●●●
```

Each: symbol, signal count, and a visual dot strip showing relative activity.
Clicking a token could link to that token's detail page (future).

---

### 11. TRACK RECORD (4 cols, glass card)

Title: "Track Record"
Data source: `/v1/brain/track-record`

**HIDDEN if no graded calls yet.** Appears automatically after first 24h grading.

When data exists:

**Stats row:**
```
73% accurate  ·  12 streak  ·  84 calls  ·  Best: A+
```
Single line, `--font-mono`, compact.

**Latest proof card:**
One featured proof card:
- Grade: "A" in large text, colored by quality (A/A+ = `--bull`, B = `--text-secondary`, C/D/F = `--bear`)
- "Called lean_bull at $73,204. BTC +4.2% in 48h."
- Date + F&G at time + window
- This card should feel like a trophy. Subtle glow if it's an A+ grade.

---

### 12. CONVICTION TIMELINE (4 cols, glass card)

Title: "History"
Data source: `/v1/brain/conviction?limit=20`

Vertical timeline (since this is 4 cols, vertical works better than horizontal):
- Each entry: colored dot + timestamp + stance + first 80 chars of verdict
- Dots connected by thin line
- Color: green for bull, red for bear, gray for neutral
- Most recent on top
- Show last 8. "Show all" expands.

---

## DATA FETCHING: src/hooks/useBrainData.js (rewrite)

```js
// Fetches all brain data progressively
// Each sub-resource independent with its own cache TTL
// Page renders as data arrives, never blocks on one endpoint

const REFRESH_RATES = {
  state: 30000,        // 30s - the heartbeat
  signals: 30000,      // 30s - real-time feel
  narratives: 120000,  // 2min - changes slowly
  conviction: 300000,  // 5min - historical
  trending: 120000,    // 2min - token activity
  trackRecord: 300000, // 5min - graded data
};

// Returns: { state, conviction, signals, narratives, 
//            convictionHistory, trending, trackRecord,
//            loading (per-section), error (per-section) }
```

---

## VISUAL DESIGN RULES

**Bento grid card styles:**
Every card follows the glass pattern but with THREE visual tiers:

Tier 1 (The Thesis): Premium welcome-widget gradient
```css
background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
border: 1px solid rgba(255, 255, 255, 0.15);
```

Tier 2 (Data cards): Standard glass
```css
background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
border: 1px solid var(--border-default);
```

Tier 3 (Sidebar/secondary): Subtle surface
```css
background: var(--bg-surface);
border: 1px solid var(--border-subtle);
```

**Section headers:**
- All caps, 11px, `--text-muted`, letter-spacing: 0.12em, `--font-display`
- No divider lines below. Whitespace does the separation.

**Numbers:**
- ALWAYS `--font-mono`
- Prices 16px+ in data cards, 28px+ in hero moments
- Changes always colored: green positive, red negative
- Include + sign on positive numbers

**Loading states:**
- Each card independently shows skeleton shimmer while loading
- Skeleton matches the actual content layout (not generic bars)
- Cards fade in with stagger as data arrives: `animation-delay: calc(var(--i) * 80ms)`

**Responsive (mobile):**
- Single column, all cards full-width
- The Thesis card: stack left/right zones vertically
- Market Pulse: horizontal scroll for the table
- Narratives: horizontal scroll preserved
- Feed: full width, priority section (moves up in mobile order)
- Sidebar cards (whale, social, radar): horizontal scroll row or stack

**Day mode:**
Every card gets `.app.app-day-mode` counterpart:
```css
.app.app-day-mode .brain-card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
```

---

## ATMOSPHERE

Subtle touches that make it feel alive:

1. **Ambient gradient orb** behind The Thesis card: 
   `radial-gradient(circle at 30% 50%, rgba(139,92,246,0.04), transparent 60%)`
   Shifts color based on stance: purple for neutral, green for bull, red for bear.

2. **Live pulse indicator** in header: green dot with breathing animation. 
   Shows "Updated 1m ago" that counts up in real time.

3. **Sparklines** next to every price. Tiny 40px inline SVG. 
   Even if we don't have the data yet, draw a flat line as placeholder.

4. **Staggered entrance**: All cards animate in on page load with 
   `translateY(12px) -> 0` and `opacity: 0 -> 1`, staggered by 80ms per card.

5. **The Thesis verdict text** uses `--font-cinema` (Playfair Display) for 
   the first sentence only. Serif in a sea of sans-serif. Premium editorial feel.
   Rest of verdict in `--font-body`.

6. **Signal feed new items** slide in from left with a subtle green/red edge glow 
   depending on sentiment, fading after 2 seconds.

---

## FILES

```
src/components/BrainPage.jsx       -- REWRITE (replace current)
src/components/BrainPage.css       -- REWRITE (replace current)
src/hooks/useBrainData.js          -- REWRITE with all endpoints + per-section loading
```

No new files needed. Route, nav entry, and proxy already exist from V1.

---

## THE TEST

When this page is done, apply three tests:

1. **The screenshot test.** Would someone screenshot The Thesis and post it on CT? 
   If the verdict is "the market is poised for growth" — fail. 
   If it's "144M in shorts just got liquidated while F&G sits at 12. Squeeze incoming." — pass.

2. **The glance test.** In 3 seconds, can you tell: market mood, BTC price, F&G, biggest mover, 
   next catalyst? All without reading any paragraph text. The bento cards should communicate 
   this through numbers, colors, and gauges.

3. **The density test.** Does it feel like Bloomberg (information-rich but organized) or like a 
   crypto dashboard (widgets everywhere, no hierarchy)? The Thesis is the hero. Everything else 
   supports it. The eye should go: Thesis → prices → feed → everything else.

---

## DO NOT:
- Use brain/AI/robot imagery
- Label anything "AI-powered"  
- Build a single-column blog layout (USE THE BENTO GRID)
- Show empty white space where data should be (skeleton shimmer instead)
- Use tables with traditional header rows and alternating stripes
- Put everything in the same size card (variety is the point of bento)
- Forget day mode
- Forget mobile responsive
- Hard-code mock data (graceful empty states only)

## REPORT:
- All 12 sections implemented
- Bento grid working on desktop
- Mobile responsive verified  
- Day mode on all cards
- Progressive loading (cards appear as data arrives)
- F&G gauge is SVG arc, not a number
- Sparklines rendered
- Staggered entrance animations
- Signal feed shows mixed types
- Screenshot the final result
