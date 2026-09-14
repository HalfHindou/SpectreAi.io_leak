# SPECTRE INTELLIGENCE BUTTON — Build Prompt
## The "i" that turns every metric into a trading thesis

---

## BEFORE YOU WRITE ANY CODE

1. Read `SPECTRE_DESIGN_LAW.md` — visual constitution
2. Read `CLAUDE.md` — boot sequence
3. Read `src/index.css` — CSS variable source of truth
4. Read `src/icons/spectreIcons.jsx` — icon system
5. Audit EVERY page in the app and catalogue every metric, number, score, percentage, and data point that currently exists. The "i" button goes next to ALL of them.

---

## WHAT IS THIS

A 16px circle with the letter "i" that appears next to every single metric in the Spectre AI app. On hover (desktop) or tap (mobile), it opens a contextual intelligence tooltip that answers one question: **"How could this data point make me money?"**

This is not a help tooltip. This is not a definition. This is a contextual AI-generated trading thesis based on the specific metric, its current value, and historical patterns. Every tooltip is unique to the current data state.

**Why this matters:** 10,000 crypto tools show you numbers. Nobody tells you what to do with them. A user sees "$47M inflow to DeFi lending" and thinks "is that a lot? should I care?" The "i" button answers that instantly with historical context, pattern recognition, and actionable angles.

---

## ARCHITECTURE

```
src/
  components/
    intelligence/
      IButton.jsx              — The core "i" circle component
      IButton.css              — Styles (glass tooltip, animations)
      ITooltip.jsx             — The tooltip panel content renderer
      ITooltipSkeleton.jsx     — Shimmer loading state while AI generates
      
      insights/
        useInsight.js           — Hook: fetches/generates insight for a metric
        insightCache.js         — In-memory cache (avoids re-generating same insight)
        insightPrompts.js       — Prompt templates per metric type
        insightTypes.js         — TypeScript-style type definitions
      
      feed/
        InsightFeed.jsx         — Dedicated page: all insights as a scrollable feed
        InsightFeedCard.jsx     — Individual insight rendered as a feed card
        InsightRSS.jsx          — RSS feed generation endpoint
        
  api/
    insight.js                  — Backend endpoint: generates insight via AI
    insightRSS.js               — RSS/Atom feed endpoint
```

---

## THE IBUTTON COMPONENT

### Visual Design

```
Default state:
  ┌───┐
  │ i │   16x16px circle
  └───┘
  - background: rgba(255,255,255,0.04)
  - border: 1px solid var(--border-default)  /* rgba(255,255,255,0.08) */
  - "i" text: 9px, font-weight 700, color var(--text-muted)
  - cursor: pointer

Hover state:
  ┌───┐
  │ i │   Same size, color shift
  └───┘
  - background: rgba(139,92,246,0.15)  /* or contextColor at 15% */
  - border: 1px solid {contextColor}40
  - "i" text: color {contextColor}
  - transition: all 150ms ease

Active/pinned state:
  Same as hover but persistent until click-away
```

### Props

```jsx
<IButton
  // REQUIRED
  metricType="capital-flow"        // determines prompt template
  metricValue="+$47M"              // current value
  metricLabel="DeFi lending inflow" // human-readable context
  
  // OPTIONAL
  contextColor="#10B981"           // tooltip accent (defaults to --accent)
  tokenSymbol="AAVE"              // if metric relates to specific token
  sector="defi"                   // sector context
  timeframe="6h"                  // data timeframe
  additionalContext={{             // any extra data for richer insight
    previousOccurrences: 5,
    avgOutcome: "+18%",
    relatedTokens: ["AAVE", "MORPHO", "COMP"]
  }}
  position="top"                  // tooltip position: top|bottom|left|right
  size="sm"                       // sm (16px) | md (20px) — sm is default
/>
```

### Behavior

**Desktop:**
- Hover opens tooltip instantly (no delay — user asked for it, give it to them immediately)
- Click pins tooltip open (stays until click outside)
- Pinned tooltip shows a subtle "pinned" indicator
- ESC key closes

**Mobile:**
- Tap opens tooltip (no hover)
- Tap outside closes
- Swipe down on tooltip closes
- Tooltip appears as a bottom sheet on screens < 768px

**Loading:**
- Tooltip opens immediately with skeleton shimmer
- AI generates insight in background (typically 500-1500ms)
- Content fades in when ready
- Cache hit = instant (no skeleton)

---

## THE TOOLTIP PANEL

### Layout

```
┌─────────────────────────────────────────┐
│ [i] CAPITAL FLOW SIGNAL                 │  <- Label (contextColor, uppercase, 10px)
│                                         │
│ Large DeFi inflows historically         │  <- Title (white, 12px semibold)
│ precede sector rallies                  │
│                                         │
│ When $30M+ rotates into DeFi lending    │  <- Body (text-secondary, 11px)
│ in under 12 hours, it typically signals │
│ institutional positioning ahead of a    │
│ sector move.                            │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ HISTORICAL PATTERN                  │ │  <- Pattern card (bg-surface)
│ │ Last 5 occurrences: DeFi index      │ │
│ │ rallied 12-28% within 14 days.      │ │
│ │ Hit rate: 4/5 (80%).                │ │
│ │ Avg time to peak: 8 days.           │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ● DeFi governance tokens (AAVE, COMP,  │  <- Bullish action (green dot)
│   MKR) tend to move first as TVL rises  │
│                                         │
│ ● Lending rate tokens (MORPHO, PENDLE)  │  <- Bullish action (green dot)
│   benefit from increased utilization    │
│                                         │
│ ● If inflow reverses within 48h,       │  <- Bearish action (red dot)
│   likely a false signal — set alerts    │
│                                         │
│ ─────────────────────────────────────── │
│ Intelligence context only. Not          │  <- Disclaimer (text-muted, 9px)
│ financial advice. Always DYOR.          │
└─────────────────────────────────────────┘
```

### Tooltip Specs

```css
.i-tooltip {
  width: 300px;  /* fixed — never wider, never narrower */
  padding: 14px;
  background: var(--bg-overlay);  /* #222228 with blur */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid {contextColor} at 15% opacity;
  border-radius: var(--radius-md);  /* 12px */
  box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
  z-index: 1000;
  animation: iTooltipIn 150ms ease;
}

@keyframes iTooltipIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Mobile bottom sheet variant */
@media (max-width: 768px) {
  .i-tooltip {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-height: 70vh;
    overflow-y: auto;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding: 20px 16px 32px;
    animation: iSheetUp 200ms ease;
  }
  @keyframes iSheetUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
}
```

### Tooltip Content Sections

**1. Label row:** Icon + metric type label in contextColor, uppercase, 10px, 600 weight, letter-spacing 0.05em

**2. Title:** 12px, font-weight 600, color var(--text-primary). One sentence. The actionable headline.

**3. Body:** 11px, color var(--text-secondary), line-height 1.65. 2-4 sentences explaining WHY this metric matters for trading. No fluff. Dense, useful context.

**4. Historical pattern card (optional):** Only shows if there's real pattern data. Background var(--bg-surface), 1px solid var(--border-subtle), radius-sm, padding 8px 10px.
- "HISTORICAL PATTERN" label in var(--text-muted), 9px uppercase
- Pattern data in var(--text-tertiary), 11px
- Key stats in var(--font-mono): hit rate, average return, timeframe

**5. Action items:** 1-3 items, each with a colored dot:
- Green dot (#10B981) = bullish angle
- Red dot (#EF4444) = bearish angle  
- Amber dot (#F59E0B) = neutral / conditional angle
- Text: 10px, color var(--text-tertiary), line-height 1.4
- Each action card: subtle tinted background matching the dot color at 5% opacity

**6. Disclaimer:** Always present. 9px, var(--text-muted). "Intelligence context only. Not financial advice. Always DYOR." Separated by 1px border-subtle divider.

---

## METRIC TYPES AND PROMPT TEMPLATES

Every "i" button sends a structured request to the backend with the metric type, current value, and context. The backend uses a prompt template to generate the insight via Claude Sonnet.

### Metric Type Registry

Create `insightTypes.js` with every metric type the app displays:

```js
export const METRIC_TYPES = {
  // === PRICE & MARKET ===
  'token-price':          { label: 'Price action',        category: 'market' },
  'price-change-pct':     { label: 'Price movement',      category: 'market' },
  'market-cap':           { label: 'Market cap',          category: 'market' },
  'volume-24h':           { label: 'Trading volume',      category: 'market' },
  'volume-change':        { label: 'Volume shift',        category: 'market' },
  'ath-distance':         { label: 'ATH distance',        category: 'market' },
  'atl-distance':         { label: 'ATL distance',        category: 'market' },
  
  // === ON-CHAIN ===
  'capital-flow':         { label: 'Capital flow signal',  category: 'onchain' },
  'whale-accumulation':   { label: 'Whale activity',       category: 'onchain' },
  'whale-distribution':   { label: 'Whale distribution',   category: 'onchain' },
  'exchange-netflow':     { label: 'Exchange flow',        category: 'onchain' },
  'active-addresses':     { label: 'Network activity',     category: 'onchain' },
  'holder-count':         { label: 'Holder base',          category: 'onchain' },
  'holder-change':        { label: 'Holder momentum',      category: 'onchain' },
  'transaction-count':    { label: 'Transaction velocity', category: 'onchain' },
  
  // === DEFI ===
  'tvl':                  { label: 'Total value locked',   category: 'defi' },
  'tvl-change':           { label: 'TVL movement',         category: 'defi' },
  'protocol-revenue':     { label: 'Protocol revenue',     category: 'defi' },
  'supply-rate':          { label: 'Supply rate',          category: 'defi' },
  'borrow-rate':          { label: 'Borrow rate',          category: 'defi' },
  'utilization-rate':     { label: 'Utilization',          category: 'defi' },
  'liquidation-volume':   { label: 'Liquidations',         category: 'defi' },
  
  // === BUILDER ===
  'builder-score':        { label: 'Builder score',        category: 'builder' },
  'commit-velocity':      { label: 'Development velocity', category: 'builder' },
  'contributor-count':    { label: 'Team activity',        category: 'builder' },
  'deployment-count':     { label: 'Ship frequency',       category: 'builder' },
  'audit-status':         { label: 'Security posture',     category: 'builder' },
  'github-stars':         { label: 'Developer interest',   category: 'builder' },
  
  // === SOCIAL / SENTIMENT ===
  'social-volume':        { label: 'Social attention',     category: 'social' },
  'social-sentiment':     { label: 'Sentiment signal',     category: 'social' },
  'narrative-momentum':   { label: 'Narrative momentum',   category: 'social' },
  'fear-greed':           { label: 'Market sentiment',     category: 'social' },
  'analyst-accuracy':     { label: 'Analyst reputation',   category: 'social' },
  'analyst-position':     { label: 'Verified position',    category: 'social' },
  
  // === PORTFOLIO ===
  'portfolio-pnl':        { label: 'Portfolio signal',     category: 'portfolio' },
  'position-pnl':         { label: 'Position signal',      category: 'portfolio' },
  'co-holder-activity':   { label: 'Co-holder signal',     category: 'portfolio' },
  'correlated-movement':  { label: 'Correlation alert',    category: 'portfolio' },
  
  // === INDEX / MACRO ===
  'sector-attention':     { label: 'Sector signal',        category: 'macro' },
  'btc-dominance':        { label: 'Dominance signal',     category: 'macro' },
  'stablecoin-supply':    { label: 'Stablecoin signal',    category: 'macro' },
  'funding-rate':         { label: 'Funding signal',       category: 'macro' },
  'open-interest':        { label: 'Derivatives signal',   category: 'macro' },
};
```

### Prompt Template Structure

The backend builds a prompt for Claude Sonnet based on the metric type and current data:

```js
// api/insight.js

function buildInsightPrompt(metricType, metricValue, metricLabel, context) {
  return `You are a senior crypto analyst working at a top-tier fund. A user is looking at a specific data point in a trading dashboard and wants to understand its implications for trading.

METRIC TYPE: ${metricType}
CURRENT VALUE: ${metricValue}
LABEL: ${metricLabel}
${context.tokenSymbol ? `TOKEN: ${context.tokenSymbol}` : ''}
${context.sector ? `SECTOR: ${context.sector}` : ''}
${context.timeframe ? `TIMEFRAME: ${context.timeframe}` : ''}
${context.additionalContext ? `ADDITIONAL CONTEXT: ${JSON.stringify(context.additionalContext)}` : ''}

Respond with a JSON object (no markdown, no backticks, just raw JSON):
{
  "title": "One sentence: the actionable headline. Max 12 words.",
  "body": "2-3 sentences explaining WHY this metric matters for trading decisions. Be specific to the current value. Dense, no fluff.",
  "historical": "1-2 sentences about what happened historically when this metric showed similar values. Include specific numbers: hit rates, average returns, timeframes. If no reliable historical pattern exists, set this to null.",
  "actions": [
    {
      "type": "bullish|bearish|neutral",
      "text": "One specific actionable angle. Not generic. Reference specific tokens, timeframes, or strategies."
    }
  ]
}

RULES:
- Be specific to the CURRENT VALUE, not generic.
- If the value is extreme (very high or very low), call that out.
- Actions must be concrete: name tokens, timeframes, price levels, or strategies.
- Include at least one bearish or cautionary action. Never be purely bullish.
- Historical patterns should cite approximate numbers but acknowledge limited sample sizes.
- Never say "buy" or "sell" directly. Frame as "historically correlated with" or "tends to precede" or "may indicate".
- Keep it under 200 words total.
- 2-3 actions maximum.`;
}
```

---

## BACKEND ENDPOINT

### `POST /api/insight`

```js
// Request
{
  metricType: "capital-flow",
  metricValue: "+$47M",
  metricLabel: "DeFi lending inflow (6h)",
  context: {
    sector: "defi",
    timeframe: "6h",
    tokenSymbol: null,
    additionalContext: {
      topProtocols: ["Aave", "Morpho", "Compound"],
      protocolInflows: { "Aave": "$18.2M", "Morpho": "$12.7M", "Compound": "$8.1M" }
    }
  }
}

// Response
{
  insight: {
    label: "Capital flow signal",
    title: "Large DeFi inflows historically precede sector rallies",
    body: "When $30M+ rotates into DeFi lending in under 12 hours, it typically signals institutional positioning...",
    historical: "Last 5 occurrences: DeFi index rallied 12-28% within 14 days. Hit rate: 4/5 (80%).",
    actions: [
      { type: "bullish", text: "DeFi governance tokens (AAVE, COMP, MKR) tend to move first as TVL rises" },
      { type: "bullish", text: "Lending rate tokens (MORPHO, PENDLE) benefit from increased utilization" },
      { type: "bearish", text: "If inflow reverses within 48h, likely a false signal — set alerts on TVL change" }
    ]
  },
  cached: false,
  generatedAt: "2026-03-25T14:32:00Z"
}
```

### Caching Strategy

```
Cache key = hash(metricType + metricValue + tokenSymbol + sector)

Cache rules:
- Price/market metrics: cache 5 minutes (values change fast)
- On-chain metrics: cache 15 minutes 
- Builder metrics: cache 1 hour (commit data doesn't change by the second)
- Social metrics: cache 10 minutes
- Macro metrics: cache 15 minutes

Stale-while-revalidate: serve cached insight immediately, regenerate in background if older than cache window. User always sees instant result.
```

### Rate Limiting

```
Free tier: 20 insight requests per hour
Pro tier: unlimited
Rate limit header: X-Insight-Remaining: 14
When exhausted: tooltip shows "Upgrade to Pro for unlimited intelligence context"
```

This is the paywall. Clean, non-intrusive. The data is always free. The "i" insights are the premium layer.

---

## WHERE THE "i" BUTTON GOES — FULL APP AUDIT

This maps to the real Spectre codebase. Every page, every component, every metric.

### 1. WelcomePage (`src/components/WelcomePage.jsx`)
The landing page / discovery hub. This is the highest-traffic page.

**Welcome Widget (hero section):**
- Fear & Greed Index gauge value → `fear-greed`
- Alt Season Index value → `sector-attention` (contextLabel: "Alt season indicator")
- Market Dominance (BTC/ETH/Other) percentages → `btc-dominance`
- Total market cap → `market-cap`
- 24h total volume → `volume-24h`

**Top Coins section (token rows):**
- Each token's price → `token-price`
- Each token's 24h change % → `price-change-pct`
- Each token's market cap → `market-cap`
- Each token's volume → `volume-24h`
- Each token's sparkline (if present) → NO "i" on chart itself, only on numbers

**Command Center / Market AI widget:**
- Any AI-generated metric in the intelligence cards → varies by card content

**Component files to edit:** `WelcomePage.jsx`, any sub-components it renders for the welcome widget, top coins grid

### 2. Token View — 3-Column Layout (`App.jsx` when `currentView === 'token'`)

This is the deepest metric page. The "i" button will appear dozens of times here.

**TokenBanner (`src/components/TokenBanner.jsx`):**
- Current price → `token-price`
- 24h price change % → `price-change-pct`
- Market cap → `market-cap`
- 24h volume → `volume-24h`
- Circulating supply → `holder-count` (contextLabel: "Circulating supply")
- Total supply → `holder-count` (contextLabel: "Total supply")
- Liquidity → `tvl` (contextLabel: "Available liquidity")
- Token age → NO "i" (not actionable)
- All-time high price → `ath-distance`
- All-time low price → `atl-distance`

**TokenTicker (`src/components/TokenTicker.jsx`):**
- Scrolling ticker prices → `token-price` (one per token in ticker)
- Ticker 24h changes → `price-change-pct`

**TradingChart (`src/components/TradingChart.jsx`):**
- NO "i" on the chart canvas itself
- Chart overlay metrics (if any price labels shown) → NO "i" on overlay
- X Mentions overlay data points → `social-volume` (when hovering a mention spike)

**DataTabs (`src/components/DataTabs.jsx`):**
- Transaction History tab: individual trade sizes → NO "i" (too granular)
- Transaction History tab: aggregated buy/sell ratio → `exchange-netflow` (contextLabel: "Buy/sell pressure")
- Holders tab: top holder percentages → `holder-count`
- Holders tab: holder count change → `holder-change`
- On-Chain Bubblemap tab: cluster sizes → NO "i" (visual, not numeric)

**LeftPanel (`src/components/LeftPanel.jsx`):**
- Watchlist token prices → `token-price`
- Watchlist token 24h changes → `price-change-pct`
- X feed engagement metrics (if shown) → `social-volume`

**RightPanel (`src/components/RightPanel.jsx`):**
- Buy/Sell sentiment percentages → `social-sentiment`
- News sentiment score → `social-sentiment` (contextLabel: "News sentiment")
- Key metrics shown in right panel → varies by content

### 3. ResearchZoneLite (`src/components/ResearchZoneLite.jsx`)

**Left column (token overview):**
- Price → `token-price`
- Market cap → `market-cap`
- Volume → `volume-24h`
- TVL (if DeFi token) → `tvl`
- Any on-chain stats → map to appropriate type

**Center (chart + markets):**
- Chart: NO "i" on chart
- Markets tab: exchange-level price differences → `token-price` (contextLabel: "Exchange price spread")

**Right column:**
- Sentiment gauge → `social-sentiment`
- Social mention count → `social-volume`
- News article count → NO "i" (not a tradeable metric)

### 4. WatchlistsPage (`src/components/WatchlistsPage.jsx`)

Every token row in every watchlist:
- Price → `token-price`
- 24h change → `price-change-pct`
- 7d change → `price-change-pct` (contextLabel: "7-day momentum")
- Market cap → `market-cap`
- Volume → `volume-24h`
- Any custom watchlist columns → map to appropriate type

### 5. SocialZonePage (`src/components/SocialZonePage.jsx`)
- Social volume metrics → `social-volume`
- Trending score → `social-sentiment`
- Engagement metrics on posts → NO "i" (UI chrome, not trading data)

### 6. XBubblesPage (`src/components/XBubblesPage.jsx`)
- Bubble node size / influence score → `social-volume` (contextLabel: "Social influence weight")
- Sector attention in bubble clusters → `sector-attention`
- Any KOL accuracy scores → `analyst-accuracy`

### 7. Header (`src/components/Header.jsx`)
- Portfolio value (if wallet connected) → `portfolio-pnl`
- Any market-level indicator in header → `market-cap` or `fear-greed`

### 8. MobileBottomNav context
- Command Center metrics on mobile → same as WelcomePage Command Center section
- All mobile views inherit the same "i" placements as their desktop counterparts

### 9. Intelligence Hub / Spectre Edition (if integrated into app)
- Every intelligence article's key metric → varies
- Breaking news card metrics → varies
- Daily Brief metrics → varies

### 10. Future pages (placeholder nav items — add "i" when built)
- `ai-media-center` → all metrics when implemented
- `x-dash` → social metrics when implemented
- `ai-charts` → chart-derived metrics when implemented
- `heatmaps` → sector and token heat values when implemented
- `ai-market-analysis` → all analysis metrics when implemented
- `market-analytics` → all analytics metrics when implemented
- `user-dashboard` → portfolio and performance metrics when implemented

### RULE: How to decide if a number gets an "i"

Ask: "Could a trader look at this number and wonder what to do about it?"
- YES → Add "i"
- NO → Don't add "i"

Examples:
- "$3,100" (price) → YES, trader wonders if it's a good entry
- "24h: +5.2%" → YES, trader wonders if momentum continues
- "Market Cap: $380B" → YES, trader wonders about relative valuation
- "Created: 847 days ago" → NO, not actionable
- "87 Comments" → NO, UI engagement metric
- "Fear & Greed: 72" → YES, trader wonders what this means for positioning
- "Builder Score: 94" → YES, trader wonders if this means the team is shipping
- "Holders: 142,000" → YES, trader wonders about distribution

---

## THE INSIGHT FEED — NEW PAGE + RSS PRODUCT

This is NOT an afterthought. The Insight Feed is a standalone product surface and the first brick of Spectre's distribution network.

### Route: `/insights`

A dedicated page accessible from the navigation sidebar. Add a new nav item:

```js
// In NavigationSidebar.jsx, add to nav items:
{ id: 'insights', label: 'Intelligence Feed', icon: spectreIcons.intelligence }
```

### Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Intelligence Feed                                                │
│  Every metric in Spectre, decoded for trading.     [RSS ⊕] [Pro] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  FILTER BAR                                                      │
│  [All] [Market] [On-chain] [DeFi] [Builder] [Social] [Macro]    │
│  [Bullish ●] [Bearish ●] [Mixed ●]          Token: [search]     │
│                                                                  │
│  LIVE COUNTER: 847 insights generated today     ● Streaming      │
│                                                                  │
│  ┌──── INSIGHT CARD ──────────────────────────────────────────┐  │
│  │                                                            │  │
│  │ [● green] CAPITAL FLOW SIGNAL                    4 min ago │  │
│  │                                                            │  │
│  │ Large DeFi inflows historically precede rallies            │  │
│  │                                                            │  │
│  │ CONTEXT: +$47M into DeFi lending (6h)                      │  │
│  │                                                            │  │
│  │ ┌── HISTORICAL ─────────────────────────────────────────┐  │  │
│  │ │ Last 5 occurrences: DeFi index +12-28% within 14d    │  │  │
│  │ │ Hit rate: 80%  |  Avg return: +19.3%  |  8-18 days   │  │  │
│  │ └──────────────────────────────────────────────────────-┘  │  │
│  │                                                            │  │
│  │ ● AAVE, COMP, MKR tend to move first           (bullish)  │  │
│  │ ● MORPHO, PENDLE benefit from utilization       (bullish)  │  │
│  │ ● If inflow reverses within 48h, false signal   (caution)  │  │
│  │                                                            │  │
│  │ Source: Aave +$18.2M • Morpho +$12.7M • Compound +$8.1M   │  │
│  │                                                            │  │
│  │ [Copy] [Share] [Save to watchlist]                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──── INSIGHT CARD ──────────────────────────────────────────┐  │
│  │ [● amber] BUILDER SCORE                        1 hour ago  │  │
│  │ Top-decile builder activity signals sustained dev.          │  │
│  │ CONTEXT: Aave Builder Score 94 (+3 this week)               │  │
│  │ ...                                                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ... infinite scroll (newest first, auto-refreshes) ...          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Insight Feed Card Design

Each card in the feed is a full-width glass card following SPECTRE_DESIGN_LAW:

```css
.insight-feed-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--sp-4) var(--sp-5);
  margin-bottom: var(--sp-3);
  transition: border-color 150ms ease;
}
.insight-feed-card:hover {
  border-color: var(--border-strong);
}
```

Signal type indicator uses a left-side colored dot:
- Bullish dominant insights: green dot (#10B981)
- Bearish dominant insights: red dot (#EF4444)
- Mixed/neutral insights: amber dot (#F59E0B)

**Card content:**
1. **Header row:** Signal dot + category label (uppercase, 10px, contextColor) + timestamp (right-aligned, muted)
2. **Title:** 14px, Space Grotesk, semibold, white
3. **Context line:** The original metric that triggered this insight, in JetBrains Mono. E.g., "CONTEXT: +$47M into DeFi lending (6h)"
4. **Historical pattern card** (if available): same as tooltip version
5. **Action items:** Same colored dot + text format as tooltip
6. **Source chips:** The underlying data points that informed the insight
7. **Action bar:** Copy (copies insight as clean text), Share (generates share image), Save to watchlist (bookmarks the related token)

### Feed Behavior

- **Live streaming:** New insights appear at top with a subtle slide-in animation
- **Auto-refresh:** Poll every 30 seconds for new insights
- **"New insights available" banner:** If user has scrolled down, show a sticky banner at top: "12 new insights" — clicking scrolls to top and loads them
- **Infinite scroll:** Load 20 at a time, fetch more on scroll
- **Deduplication:** If the same metric type + token generates a new insight that's substantially similar to one from <1 hour ago, don't show it (prevents feed spam during sideways markets)

### Filter System

**Category filters (top row):**
All | Market | On-chain | DeFi | Builder | Social | Macro

**Signal type filters:**
Bullish (green dot) | Bearish (red dot) | Mixed (amber dot)

**Token search:** Autocomplete search that filters to insights mentioning a specific token

**All filters are URL-parameterized:**
```
/insights                          — All
/insights?category=onchain         — On-chain only
/insights?signal=bullish           — Bullish only
/insights?token=AAVE               — AAVE-specific
/insights?category=defi&signal=bullish  — Bullish DeFi
```

---

## RSS FEED — FULL SPEC

### Why RSS matters

1. **Power users** subscribe in Feedly/Reeder and get a constant stream of trading intelligence without opening the app
2. **Telegram bot operators** can consume the feed and relay insights to their communities (free distribution)
3. **Newsletter authors** can pull insights into their content (attribution = brand awareness)
4. **Other dashboards** can embed the feed (first step toward the widget network)
5. **SEO/AISEO:** RSS feeds get indexed, cited, and referenced by search engines and AI models. Every insight becomes a citable Spectre source.

### RSS Endpoints

**Main feed:**
```
GET /api/insights/rss
```

**Filtered feeds (all return valid RSS 2.0):**
```
GET /api/insights/rss?category=market       — Market signals only
GET /api/insights/rss?category=onchain      — On-chain signals only
GET /api/insights/rss?category=defi         — DeFi signals only
GET /api/insights/rss?category=builder      — Builder insights only
GET /api/insights/rss?category=social       — Social/sentiment signals only
GET /api/insights/rss?category=macro        — Macro signals only

GET /api/insights/rss?signal=bullish        — Bullish signals only
GET /api/insights/rss?signal=bearish        — Bearish signals only

GET /api/insights/rss?token=AAVE            — AAVE-specific
GET /api/insights/rss?token=ETH             — ETH-specific
GET /api/insights/rss?sector=defi           — Entire DeFi sector

GET /api/insights/rss?category=defi&signal=bullish  — Combined filters
```

### RSS Output Format

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:spectre="https://spectreai.io/rss/ns">
  <channel>
    <title>Spectre Intelligence Feed</title>
    <link>https://app.spectreai.io/insights</link>
    <description>AI-generated trading intelligence. Every metric in crypto, decoded.</description>
    <language>en</language>
    <lastBuildDate>Tue, 25 Mar 2026 14:32:00 GMT</lastBuildDate>
    <ttl>5</ttl>
    <atom:link href="https://app.spectreai.io/api/insights/rss" rel="self" type="application/rss+xml"/>
    <image>
      <url>https://spectreai.io/rss-icon.png</url>
      <title>Spectre Intelligence</title>
      <link>https://app.spectreai.io</link>
    </image>

    <item>
      <title>Capital Flow: Large DeFi inflows historically precede sector rallies</title>
      <description><![CDATA[
        <p><strong>+$47M into DeFi lending (6h)</strong></p>
        <p>When $30M+ rotates into DeFi lending in under 12 hours, it typically signals institutional positioning ahead of a sector move.</p>
        <p><em>Historical: Last 5 occurrences — DeFi index rallied 12-28% within 14 days. Hit rate: 80%.</em></p>
        <ul>
          <li>🟢 DeFi governance tokens (AAVE, COMP, MKR) tend to move first</li>
          <li>🟢 Lending rate tokens (MORPHO, PENDLE) benefit from utilization</li>
          <li>🔴 If inflow reverses within 48h, likely a false signal</li>
        </ul>
        <p><small>Intelligence context only. Not financial advice. — Spectre AI</small></p>
      ]]></description>
      <link>https://app.spectreai.io/insights/cf-47m-defi-20260325</link>
      <guid isPermaLink="true">https://app.spectreai.io/insights/cf-47m-defi-20260325</guid>
      <pubDate>Tue, 25 Mar 2026 14:32:00 GMT</pubDate>
      <category>onchain</category>
      <spectre:signal>bullish</spectre:signal>
      <spectre:metricType>capital-flow</spectre:metricType>
      <spectre:metricValue>+$47M</spectre:metricValue>
      <spectre:tokens>AAVE,MORPHO,COMP</spectre:tokens>
      <spectre:hitRate>80</spectre:hitRate>
    </item>

    <!-- More items, max 50 per feed -->
  </channel>
</rss>
```

### Custom RSS Namespace

The `spectre:` namespace adds structured metadata that consumers can parse:

```xml
spectre:signal      — "bullish" | "bearish" | "mixed"
spectre:metricType  — The metric type from insightTypes.js
spectre:metricValue — The raw metric value
spectre:tokens      — Comma-separated token symbols mentioned
spectre:hitRate     — Historical hit rate percentage (if available)
spectre:sector      — Sector classification
```

This lets sophisticated consumers (bots, dashboards) filter and act on structured data without parsing the description HTML.

### RSS Generation Backend

```js
// api/insightRSS.js

// Insight storage: every generated insight is logged to a database/store
// Schema:
// {
//   id: string (unique),
//   generatedAt: ISO timestamp,
//   metricType: string,
//   metricValue: string,
//   tokenSymbol: string | null,
//   sector: string | null,
//   insight: { title, body, historical, actions },
//   signalType: 'bullish' | 'bearish' | 'mixed',
//   category: string,
//   permalink: string
// }

// On every successful /api/insight response:
// 1. Determine if insight is substantially different from recent ones (dedup)
// 2. If unique, log to insight store
// 3. RSS endpoint queries this store with filters

// RSS endpoint:
// - Query insight store with filter params
// - Limit 50 items
// - Cache RSS XML for 60 seconds (don't regenerate on every request)
// - Set proper headers: Content-Type: application/rss+xml; charset=utf-8
```

### RSS Discovery

Add RSS autodiscovery to the app's HTML head so browsers and feed readers detect it:

```html
<link rel="alternate" type="application/rss+xml" title="Spectre Intelligence Feed" href="https://app.spectreai.io/api/insights/rss" />
```

Add an RSS icon/link on:
- The Insight Feed page (prominent, next to the page title)
- The app footer
- The Intelligence Hub / Edition page

### RSS Feed Page (in-app)

At `/insights/rss` or behind the RSS button, show a simple page:

```
Subscribe to Spectre Intelligence

Main feed:        [copy URL button]  https://app.spectreai.io/api/insights/rss

Category feeds:
  Market signals   [copy]  /api/insights/rss?category=market
  On-chain signals [copy]  /api/insights/rss?category=onchain
  DeFi signals     [copy]  /api/insights/rss?category=defi
  Builder updates  [copy]  /api/insights/rss?category=builder
  Social signals   [copy]  /api/insights/rss?category=social
  Macro signals    [copy]  /api/insights/rss?category=macro

Token-specific feeds:
  [Search token]   /api/insights/rss?token={SYMBOL}

Signal type:
  Bullish only     [copy]  /api/insights/rss?signal=bullish
  Bearish only     [copy]  /api/insights/rss?signal=bearish

Pro tip: Combine filters. DeFi + Bullish:
  /api/insights/rss?category=defi&signal=bullish
```

---

## INSIGHT LOGGING AND AGGREGATION

Every insight generated anywhere in the app (from any "i" button hover) gets logged:

### Log Pipeline

```
User hovers "i" on any metric
  → useInsight hook fires
  → Backend generates insight via Claude Sonnet
  → Response returned to tooltip
  → SIMULTANEOUSLY: insight logged to insight store
  → Insight store feeds:
      1. /insights page (in-app feed)
      2. /api/insights/rss (RSS feed)
      3. Future: Telegram bot relay
      4. Future: widget network distribution
```

### What gets logged (schema)

```js
{
  id: "ins_cf47m_defi_20260325_1432",
  generatedAt: "2026-03-25T14:32:00Z",
  
  // Source metric
  metricType: "capital-flow",
  metricValue: "+$47M",
  metricLabel: "DeFi lending inflow (6h)",
  
  // Context
  tokenSymbol: null,            // null for sector-wide, "AAVE" for token-specific
  sector: "defi",
  category: "onchain",
  
  // Generated content
  title: "Large DeFi inflows historically precede sector rallies",
  body: "When $30M+ rotates into DeFi...",
  historical: "Last 5 occurrences: DeFi index rallied 12-28%...",
  actions: [
    { type: "bullish", text: "DeFi governance tokens tend to move first..." },
    { type: "bullish", text: "Lending rate tokens benefit..." },
    { type: "bearish", text: "If inflow reverses within 48h..." },
  ],
  
  // Derived
  signalType: "bullish",        // determined by majority action types
  mentionedTokens: ["AAVE", "COMP", "MKR", "MORPHO", "PENDLE"],
  hitRate: 80,                  // extracted from historical if present
  
  // Metadata
  permalink: "https://app.spectreai.io/insights/ins_cf47m_defi_20260325_1432",
  triggeredBy: "anonymous",     // no user PII in logs
  sourcePage: "welcome",        // which page the "i" was clicked on
}
```

### Deduplication

Before logging, check if an insight with the same `metricType + tokenSymbol + sector` was generated in the last 60 minutes. If so, compare titles. If >80% similar (simple word overlap), don't log again. This prevents the feed from being flooded with "ETH price at $3,100" then "ETH price at $3,101" then "ETH price at $3,098".

### Background Generation (Pro Feature)

For Pro users or for the main feed: the system doesn't wait for someone to hover an "i". It proactively generates insights for significant metric changes:

```
Every 5 minutes, check:
  - Any token in top 100 with >5% price change in last 1h? → Generate price insight
  - Any capital flow >$10M detected? → Generate flow insight
  - Any Builder Score change >5 points? → Generate builder insight
  - Any Fear & Greed shift >10 points? → Generate sentiment insight
  - Any narrative attention change >100% WoW? → Generate narrative insight

These proactive insights go directly to the feed + RSS without needing a hover trigger.
```

This means the Intelligence Feed is always alive, always generating, always fresh. Users don't have to hover 50 "i" buttons to populate the feed. The system does it on its own for the most significant moves.

---

## REAL-TIME DATA STRATEGY

Insights must reference REAL current data, not generic advice. Here's how the data flows:

### Data Sources (already in Spectre stack or free tier)

```
PRICE DATA:
  - CoinGecko API (existing) → token prices, market caps, volume, ATH/ATL
  - Binance/OKX/Bybit WebSocket feeds (existing, free) → real-time prices

ON-CHAIN:
  - Chainstack RPC (existing) → transaction counts, holder queries
  - DeFiLlama API (free) → TVL, protocol revenue, yields
  - Etherscan/Solscan APIs (free tier) → contract deployments, token transfers
  - Whale Alert API or custom threshold monitoring → large transfers

BUILDER:
  - GitHub API (free tier: 5000 req/hr) → commit velocity, contributors, repos
  - Contract deployment monitoring via RPC → new deployments

SOCIAL:
  - Existing Spectre social sentiment pipeline → social volume, sentiment
  - X API (if available) → mention counts, engagement

MACRO:
  - CoinGecko → global market cap, BTC dominance, Fear & Greed
  - DeFiLlama → stablecoin supply tracking
  - Exchange APIs → funding rates, open interest
```

### Data Enrichment Pipeline

When an "i" request comes in, the backend:

1. **Fetches current data** for the metric (cache-first, API-fallback)
2. **Fetches historical comparison** data (last 30/90/365 days for pattern matching)
3. **Builds the enriched prompt** with real numbers
4. **Generates insight** via Claude Sonnet
5. **Caches the result** with the appropriate TTL
6. **Logs to insight feed** for the RSS/feed aggregation

Example enriched prompt context:

```
METRIC TYPE: capital-flow
CURRENT VALUE: +$47M
CURRENT DATA:
  - Aave TVL 24h change: +$18.2M (from $11.02B to $11.22B)
  - Morpho TVL 24h change: +$12.7M (from $1.58B to $1.61B)
  - Compound TVL 24h change: +$8.1M (from $2.34B to $2.42B)
  - DeFi sector total TVL: $48.2B (+2.1% 24h)
  - Aave supply rate USDC: 3.2% (down from 3.8% 7d ago — rate compression)
  - Top inflow source: ETH staking withdrawals (32% of flow)

HISTORICAL COMPARISON:
  - Similar magnitude flows ($30M+ in <12h) occurred on:
    2025-11-14: DeFi index +22% over next 14 days
    2025-08-03: DeFi index +15% over next 10 days
    2025-05-22: DeFi index -4% (false signal, reversed in 36h)
    2025-02-18: DeFi index +28% over next 18 days
    2024-10-09: DeFi index +12% over next 8 days
  - Hit rate: 4/5 positive outcomes
  - Average positive return: +19.3%
  - Average time to peak: 12.5 days
  - False signal identifier: flow reversed within 36h in the one failure
```

This level of context produces dramatically better insights than a generic prompt.

---

## AI MODEL ROUTING

```
Insight generation: Claude Sonnet (via Anthropic API)
  - Fast enough for near-real-time (500-1500ms)
  - Smart enough for nuanced financial context
  - Cost: ~$0.003-0.008 per insight (acceptable at 20/hr free tier)

Fallback: Cached template-based insights if API is unavailable
  - Pre-generated for common metric types
  - Less specific but always available
  - Clearly marked as "cached insight" not "live intelligence"
```

---

## DESIGN RULES

1. **The "i" is invisible until needed.** 16px, muted colors, never draws attention from the metric itself. It's furniture until you need it.

2. **Tooltip matches the app.** Uses existing glass card pattern from SPECTRE_DESIGN_LAW. Same backgrounds, same borders, same typography. It should feel like it was always part of the app.

3. **Content is scannable in 3 seconds.** Title = headline. Body = context. Historical = proof. Actions = what to do. A user should get value even if they only read the title and action dots.

4. **Action dots are the money shot.** Green = bullish thesis. Red = bearish thesis. Amber = conditional. These colored dots are what the eye goes to first. Make sure the most important insight is in the first action item.

5. **Every tooltip has a bear case.** Never purely bullish. Even the most positive metric gets at least one cautionary action. This builds trust. Users learn they can rely on balanced analysis.

6. **Numbers in tooltips use var(--font-mono).** Hit rates, percentages, timeframes, token symbols. All monospace. Consistent with the rest of the app.

7. **The disclaimer is non-negotiable.** "Intelligence context only. Not financial advice. Always DYOR." Every single tooltip. 9px, muted, but present.

8. **Mobile is a bottom sheet.** Don't try to position a 300px floating tooltip on a 375px screen. Slide up from bottom, full width, dismissable by swipe or tap outside.

9. **Loading is shimmer, never spinner.** Matches existing Spectre loading pattern.

10. **No "i" on decorative elements.** Only on DATA POINTS. If it's a label, a heading, a navigation element, or a status indicator — no "i". If it's a number that a trader would look at and think "what does this mean for me?" — yes "i".

---

## DAY MODE

Every tooltip style needs a `.app-day-mode` counterpart:

```css
.app-day-mode .i-tooltip {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
}
.app-day-mode .i-tooltip .insight-title { color: #0f172a; }
.app-day-mode .i-tooltip .insight-body { color: #475569; }
.app-day-mode .i-tooltip .insight-historical { 
  background: #f8fafc; 
  border-color: rgba(0,0,0,0.06); 
}
.app-day-mode .i-tooltip .insight-disclaimer { color: #94a3b8; }
.app-day-mode .i-button {
  background: rgba(0,0,0,0.04);
  border-color: rgba(0,0,0,0.1);
}
.app-day-mode .i-button:hover {
  background: rgba(139,92,246,0.1);
}
```

---

## BUILD ORDER

1. **`IButton.jsx` + `IButton.css`** — The 16px circle component with hover/click/pin, mobile bottom sheet
2. **`ITooltip.jsx` + `ITooltipSkeleton.jsx`** — Tooltip panel with all sections + shimmer state
3. **`insightTypes.js`** — Full metric type registry (40+ types)
4. **`insightPrompts.js`** — Prompt template builder with data enrichment slots
5. **`insightCache.js`** — In-memory cache with TTL per metric category
6. **`useInsight.js`** — React hook: fetch, cache, loading, error states
7. **`api/insight.js`** — Backend endpoint: data enrichment + Claude Sonnet generation
8. **INTEGRATION PASS 1: WelcomePage** — Add "i" to welcome widget metrics (Fear & Greed, dominance, market cap) + top coins table. Test full pipeline end to end.
9. **INTEGRATION PASS 2: Token View** — Add to TokenBanner (price, change, mcap, volume, ATH/ATL, liquidity), DataTabs (buy/sell ratio, holder stats), LeftPanel (watchlist prices), RightPanel (sentiment)
10. **INTEGRATION PASS 3: ResearchZoneLite** — Add to all metric displays
11. **INTEGRATION PASS 4: WatchlistsPage** — Add to every column in every watchlist row
12. **INTEGRATION PASS 5: XBubblesPage + SocialZonePage** — Add to social metrics, influence scores
13. **INTEGRATION PASS 6: Header** — Portfolio value if wallet connected
14. **Insight logging backend** — Schema, storage, deduplication logic
15. **`InsightFeed.jsx` + `InsightFeedCard.jsx`** — The `/insights` page with filters, live counter, infinite scroll
16. **Navigation update** — Add "Intelligence Feed" to NavigationSidebar.jsx
17. **`api/insightRSS.js`** — RSS 2.0 feed generation with filters and spectre: namespace
18. **RSS subscription page** — In-app page showing all feed URLs with copy buttons
19. **RSS autodiscovery** — Add `<link rel="alternate">` to HTML head
20. **Proactive insight generation** — Background job that generates insights for significant metric changes every 5 minutes
21. **Mobile responsive pass** — All tooltips use bottom sheet on mobile, feed page is full-width
22. **Day mode pass** — All tooltip + feed card styles have `.app-day-mode` counterparts
23. **Rate limiting + paywall** — Free tier (20/hr) vs Pro (unlimited), upgrade prompt in tooltip
24. **Final audit** — Walk every page, verify every number has an "i", verify every insight logs to feed + RSS

---

## SUCCESS CRITERIA

1. **Every single number in the app has an "i" next to it.** WelcomePage, Token View, ResearchZoneLite, WatchlistsPage, SocialZonePage, XBubblesPage, Header. No data point left behind.

2. **Tooltips open instantly on hover.** No delay. Skeleton shimmer shows immediately if AI is generating. Cache hits show content on frame one.

3. **Insights are specific to the current value.** Not generic. If ETH is at $3,100 the insight references $3,100. If TVL dropped 5% the insight references the 5% drop. If Fear & Greed is at 72 the insight talks about what 72 specifically means historically. Stale generic advice is a failure.

4. **Every tooltip has at least one bullish and one bearish/cautionary angle.** Balanced analysis builds trust. Never purely one-sided.

5. **The Intelligence Feed at `/insights` is a living stream** of every insight generated, filterable by category, signal type, token, and sector. Live counter shows insights generated today. Auto-refreshes.

6. **The RSS feed at `/api/insights/rss` returns valid RSS 2.0** that works in Feedly, Reeder, and any standard reader. Filtered feeds (by category, signal, token) all work independently. The custom `spectre:` namespace provides structured metadata.

7. **Proactive generation keeps the feed alive.** Even when no users are hovering "i" buttons, the system generates insights for significant market moves every 5 minutes. The feed is never stale.

8. **Deduplication works.** The feed isn't flooded with near-identical insights about the same metric. One insight per metric per hour unless the value changed significantly.

9. **Mobile bottom sheet feels native.** On screens under 768px, the tooltip slides up from the bottom, full width, dismissable by swipe. Not a floating panel trying to fit on a small screen.

10. **The free tier limit (20/hr) feels generous enough** to demonstrate value but restrictive enough to drive Pro upgrades. The upgrade prompt appears inside the tooltip, not as a modal.

11. **The "i" button becomes the thing people tell their friends about.** "Have you tried Spectre? Every number tells you how to trade it." That's the word-of-mouth driver.

12. **The RSS feed becomes the first distribution node.** Bot operators, newsletter authors, and dashboard builders start consuming the feed. Every subscriber is a distribution surface that Spectre didn't have to build.

If someone compares the "i" button to Bloomberg's analytics or says "nobody else does this" — you've won.
