# SPECTRE YOU — Build Instructions for Claude Code

> Read this entire file before writing a single line of code.
> Then read the codebase. Then build.

---

## WHAT YOU ARE BUILDING

A new subpage at route `/you`. It does not touch the landing page, WelcomePage, or any existing component except the router and sidebar nav to register the new route.

**Spectre YOU is a personalized modular dashboard.** The user's layout is shaped by what they actually do in the app — which tokens they search, which features they use, which briefs they read. The grid learns silently and rearranges itself over time. The user can also fully customize it manually: drag, drop, resize, add, remove widgets.

The second major feature is **Share My Setup** — users get a public URL for their dashboard that other users can view live and clone to their own account.

This is not a configuration screen. It is a living space. It should feel personal, premium, and alive.

---

## BEFORE WRITING CODE — READ THESE FILES

```
SPECTRE_DESIGN_LAW.md                          ← design rules, absolute law
src/components/WelcomePage.jsx                 ← visual north star, do not modify
src/components/WelcomePage.css                 ← do not modify
src/icons/spectreIcons.jsx                     ← only icon source allowed
src/index.css                                  ← only CSS variable source allowed
src/components/TraderCorner/ (or wherever it lives) ← reuse the grid and widget system
src/App.jsx or src/Router.jsx                  ← to register the /you route
src/components/Sidebar/ or nav component       ← to add YOU to the nav
```

After reading, confirm:
- What import pattern the codebase uses
- Where Trader's Corner grid code lives (you will import it, not copy it)
- What data fetching pattern the app uses
- Where to add the sidebar nav entry

---

## DESIGN RULES — NON-NEGOTIABLE

These apply to every pixel of Spectre YOU. No exceptions.

**Colors — use CSS variables only, never hardcoded hex:**
```css
--bg-base: #0c0c0e          /* main page background */
--bg-surface: #131316        /* card surfaces */
--bg-elevated: #1a1a1f       /* elevated cards */
--bg-overlay: #222228        /* modals, overlays */
--bg-hover: #2a2a30          /* hover states */
--text-primary: rgba(255,255,255,1)
--text-secondary: rgba(255,255,255,0.72)
--text-tertiary: rgba(255,255,255,0.48)
--text-muted: rgba(255,255,255,0.28)
--bull: #10B981              /* gains, positive — semantic only, never decorative */
--bear: #EF4444              /* losses, negative — semantic only */
--accent: #8B5CF6            /* primary CTAs and active states ONLY */
--border-subtle: rgba(255,255,255,0.04)
--border-default: rgba(255,255,255,0.08)
--border-strong: rgba(255,255,255,0.14)
--border-accent: rgba(139,92,246,0.4)
--radius-sm: 8px  --radius-md: 12px  --radius-lg: 16px  --radius-xl: 24px
--font-display: 'Space Grotesk'
--font-body: 'Inter'
--font-mono: 'JetBrains Mono'
--font-cinema: 'Playfair Display'
```

**Rules that are never broken:**
- Every number, price, percentage, address → `font-family: var(--font-mono)`. No exceptions.
- Every icon → `spectreIcons.jsx` only. No Lucide, no FontAwesome, no emoji as UI.
- Every card → glass depth: `inset 0 1px 0 rgba(255,255,255,0.07)` top highlight + outer shadow.
- Every interactive element → `transform: translateY(-2px)` on hover, `transition: all 0.2s cubic-bezier(0.16,1,0.3,1)`.
- `--accent` purple → only on primary CTAs and active states. Never decorative.
- `--bull` green and `--bear` red → only for financial direction. Never decorative.
- Loading states → skeleton shimmer only. Never spinners.
- The word "AI", "Powered by AI", "AI-Generated" → never visible to the user. The intelligence is invisible.
- Day mode → every dark-mode style needs `.app.app-day-mode` counterpart.

**Card pattern (copy this exactly):**
```css
.you-card {
  background: linear-gradient(168deg, rgba(22,22,28,0.97) 0%, rgba(14,14,18,0.99) 100%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl); /* 24px — slightly larger than Trader's Corner */
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.07),
    inset 0 -1px 0 rgba(0,0,0,0.3),
    0 4px 12px rgba(0,0,0,0.45),
    0 8px 24px rgba(0,0,0,0.3);
  transition: all 0.3s cubic-bezier(0.16,1,0.3,1);
}
.you-card:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.09),
    0 8px 24px rgba(0,0,0,0.55);
  transform: translateY(-2px);
}
```

**YOU vs Trader's Corner tone — YOU is a home, not a terminal:**
```
Widget gap:      14px  (TC: 10px)
Card radius:     24px  (TC: 16px)
Card padding:    18px  (TC: 14px)
Font size body:  12px  (TC: 11px)
Color density:   Lower — fewer red/green signals visible by default
```

---

## FILES TO CREATE

```
src/components/SpectreYou/
  SpectreYou.jsx          ← main page component, route target
  SpectreYou.css          ← page-level styles only
  YouHeader.jsx           ← editorial header section
  YouBehavior.js          ← behavioral scoring (pure JS, no UI)
  YouShareSheet.jsx       ← share overlay
  YouShareSheet.css
  widgets/                ← YOU-specific widgets only
    AiBriefCard.jsx       ← the editorial brief card
    TopCoinsCarousel.jsx  ← horizontal coin pill row
    BubbleMap.jsx         ← force-directed bubble chart
    LinearAreaChart.jsx   ← line/area multi-token chart
    ExchangeBubbles.jsx   ← exchange volume bubbles
```

Widgets that already exist in Trader's Corner (Fear & Greed, Liquidation Charts, Candle Chart, Screener, Positions, Watchlist, ETF Flows, Exchange Flows, Whale Alerts, Funding Heatmap, Order Book, Alerts) → **import and reuse directly. Do not rebuild them.**

## FILES TO MODIFY

```
src/App.jsx or Router.jsx    ← add /you route
src/components/Sidebar/      ← add YOU nav entry
```

**That is the complete list. Nothing else gets modified.**

---

## THE PAGE STRUCTURE

```
<SpectreYou>
  <YouHeader />              ← editorial section, no background
  <IntelligenceBanner />     ← one contextual sentence, auto-dismisses
  <ModularGrid>              ← imported from Trader's Corner, adapted
    <Widget ... />           ← dynamically rendered from user layout
    <Widget ... />
    <SuggestedSlot />        ← AI suggests next widget based on behavior
    <AddZones />             ← dashed empty zones to invite adding
  </ModularGrid>
  <YouShareSheet />          ← hidden until triggered
</SpectreYou>
```

---

## THE YOU HEADER

This is editorial. It has no background, no card, no border. It sits in open space.

```
Spectre                    [● live · Updated 2m ago]   [Share ↗]
    YOU

Your market universe, assembled by intelligence.

"Watching 5 tokens · Reading Intelligence · Active in DeFi"
```

**Exact typography:**
- `Spectre` line: `font-display` 12px uppercase `text-muted` letter-spacing 0.15em
- `YOU`: `font-display` 52px weight 700 letter-spacing -0.05em `text-primary`. This is the hero word.
- Behind `YOU`: `radial-gradient(ellipse at center, rgba(139,92,246,0.07) 0%, transparent 70%)` — barely perceptible glow
- Tagline: `font-cinema` (Playfair Display) italic 16px `text-secondary` line-height 1.5
- Activity line: `font-body` 11px `text-muted` — generated from behavioral data
- Live badge: `font-mono` 9px `--bull` pulse dot
- Share button: ghost style, `spectreIcons` share icon, right-aligned to header

**Spacing below header before first widget:** 28px

---

## THE INTELLIGENCE BANNER

One sentence, maximum. Auto-dismisses after 8 seconds. No close button. No icon. No background.

Examples of valid copy:
```
"BTC down 3.2% overnight. Your 2 tracked DeFi protocols are up."
"Quiet morning. 14 new briefs since you last checked."
"Funding elevated on your SOL position. Worth watching."
```

Styling: `font-body` 12px `text-muted`. Just text. It fades in, lives for 8 seconds, fades out. Never returns in the same session.

---

## THE MODULAR GRID

Import the grid engine directly from Trader's Corner. The grid logic — drag and drop, resize, widget library panel, drop ghosts, add zones — is identical. Do not rebuild it.

**Adapt these values:**
```javascript
const YOU_GRID_CONFIG = {
  columns: 12,
  gap: 14,          // was 10 in Trader's Corner
  minRowHeight: 180, // was 160
  snapSpans: [3, 4, 6, 8, 12],
};
```

**The Flubber feel — ensure these animation values:**
```javascript
// Widget enter
animation: 'widget-enter 0.45s cubic-bezier(0.16,1,0.3,1) both'
// keyframes: from { opacity:0; transform: scale(0.92) translateY(10px) }

// Widget exit
animation: 'widget-exit 0.3s cubic-bezier(0.16,1,0.3,1) forwards'
// keyframes: to { opacity:0; transform: scale(0.9) }

// Grid reflow when widget added/removed
transition: 'all 0.45s cubic-bezier(0.16,1,0.3,1)'

// Drop ghost pulse
animation: 'ghost-pulse 1.5s ease-in-out infinite'
// border-color oscillates rgba(139,92,246,0.2) → rgba(139,92,246,0.45)
```

**Add zones (empty slots that invite adding):**
```
border: 1.5px dashed rgba(255,255,255,0.07)
border-radius: var(--radius-xl)
background: transparent
min-height: 100px
cursor: pointer

on hover:
border-color: rgba(139,92,246,0.35)
background: rgba(139,92,246,0.04)
color: var(--accent)
```

---

## WIDGET LIBRARY PANEL

Same slide-in panel from Trader's Corner. Import it. Categories for YOU:

```
All · Markets · Visualize · Intelligence · Analytics · DeFi · Portfolio · Stocks
```

---

## BEHAVIORAL INTELLIGENCE — `YouBehavior.js`

Pure JavaScript module. No React, no UI. Tracks user behavior in `localStorage` and outputs a scored widget list.

```javascript
// src/components/SpectreYou/YouBehavior.js

const STORAGE_KEY = 'spectre_behavior_v1';

// What gets tracked
const defaultSignals = {
  tokensViewed: {},      // { BTC: 42, ETH: 18, SOL: 7 }
  featuresUsed: {},      // { heatmap: 5, bubbles: 2, intelligence: 12 }
  briefsRead: 0,
  briefTopics: [],       // ['macro', 'defi', 'btc']
  hasPositions: false,
  sessionCount: 0,
};

export function getSignals() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultSignals;
  } catch {
    return defaultSignals;
  }
}

export function trackEvent(type, payload) {
  const signals = getSignals();
  switch (type) {
    case 'token_viewed':
      signals.tokensViewed[payload.symbol] = (signals.tokensViewed[payload.symbol] || 0) + 1;
      break;
    case 'feature_used':
      signals.featuresUsed[payload.feature] = (signals.featuresUsed[payload.feature] || 0) + 1;
      break;
    case 'brief_read':
      signals.briefsRead++;
      if (payload.topic && !signals.briefTopics.includes(payload.topic)) {
        signals.briefTopics.push(payload.topic);
      }
      break;
    case 'session_start':
      signals.sessionCount++;
      break;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(signals));
}

// Scoring — returns widgets sorted by relevance score
export function scoreWidgets(allWidgets) {
  const signals = getSignals();

  // Don't personalize until session 3
  if (signals.sessionCount < 3) return allWidgets;

  return allWidgets
    .map(w => ({ ...w, score: computeScore(w.id, signals) }))
    .sort((a, b) => b.score - a.score)
    .filter(w => w.score > 15);
}

function computeScore(widgetId, signals) {
  const btcViews = signals.tokensViewed['BTC'] || 0;
  const heatmapUse = signals.featuresUsed['heatmap'] || 0;
  const bubblesUse = signals.featuresUsed['bubbles'] || 0;
  const intelUse = signals.featuresUsed['intelligence'] || 0;
  const defiInterest = signals.briefTopics.includes('defi');
  const stocksUse = signals.featuresUsed['stocks'] || 0;

  const scores = {
    'you-ai-brief':        Math.min(95, 40 + intelUse * 5),
    'you-top-coins':       60, // always shown
    'you-fear-greed':      60, // always shown
    'you-btc-price':       Math.min(95, 30 + btcViews * 1.5),
    'you-heatmap':         Math.min(90, 20 + heatmapUse * 14),
    'you-bubbles':         Math.min(85, 15 + bubblesUse * 18),
    'you-main-chart':      55,
    'you-liq-bars':        signals.featuresUsed['liquidations'] > 2 ? 75 : 20,
    'you-liq-bubbles':     signals.featuresUsed['liquidations'] > 4 ? 65 : 15,
    'you-liq-timeline':    signals.featuresUsed['liquidations'] > 6 ? 60 : 10,
    'you-onchain':         defiInterest ? 72 : 20,
    'you-protocol-tvl':    defiInterest ? 68 : 15,
    'you-funding-heatmap': signals.featuresUsed['liquidations'] > 3 ? 65 : 20,
    'you-whale-alerts':    signals.featuresUsed['onchain'] > 2 ? 70 : 25,
    'you-screener':        signals.featuresUsed['screener'] > 1 ? 75 : 30,
    'you-positions':       signals.hasPositions ? 95 : 10,
    'you-portfolio':       signals.hasPositions ? 80 : 10,
    'you-etf-flows':       btcViews > 10 ? 65 : 25,
    'you-exchange-flows':  signals.featuresUsed['flows'] > 2 ? 68 : 22,
    'you-stocks':          stocksUse > 2 ? 65 : 5,
    'you-alerts':          45,
    'you-brief-archive':   Math.min(70, 15 + signals.briefsRead * 2),
    'you-sentiment':       intelUse > 5 ? 60 : 20,
  };

  return scores[widgetId] ?? 20;
}

// Suggested widget — what should the system recommend next
export function getSuggestedWidget(activeWidgetIds, allWidgets) {
  const signals = getSignals();
  if (signals.sessionCount < 3) return null;

  const suggestions = {
    3: { widgetId: 'you-liq-bars', reason: "You've checked liquidation data 3 times." },
    5: { widgetId: 'you-bubbles', reason: "Bubble maps show market weight at a glance." },
    4: { widgetId: 'you-onchain', reason: "You've been reading DeFi briefs." },
  };

  for (const [threshold, suggestion] of Object.entries(suggestions)) {
    const relevant =
      (signals.featuresUsed['liquidations'] || 0) >= threshold ||
      (signals.featuresUsed['bubbles'] || 0) >= threshold ||
      (signals.briefTopics.includes('defi') && threshold == 4);

    if (relevant && !activeWidgetIds.includes(suggestion.widgetId)) {
      const widgetDef = allWidgets.find(w => w.id === suggestion.widgetId);
      if (widgetDef) return { widget: widgetDef, reason: suggestion.reason };
    }
  }

  return null;
}
```

---

## WIDGET REGISTRY FOR SPECTRE YOU

Full list of widgets available in YOU. Widgets marked **[REUSE]** are imported from Trader's Corner — do not rebuild them.

```javascript
export const YOU_WIDGETS = [

  // ── TIER 1: Always shown to new users ──────────────────────────────

  {
    id: 'you-ai-brief',
    name: 'Intelligence Brief',
    desc: 'Latest Spectre market brief in editorial format',
    cat: 'intelligence',
    defaultSpan: 6,
    render: AiBriefCard,
  },
  {
    id: 'you-top-coins',
    name: 'Top Coins',
    desc: 'Top 10 by market cap as scrollable glass pills',
    cat: 'markets',
    defaultSpan: 12,
    render: TopCoinsCarousel,
  },
  {
    id: 'you-fear-greed',
    name: 'Fear & Greed',
    desc: 'Market sentiment arc gauge',
    cat: 'markets',
    defaultSpan: 3,
    render: FearGreedWidget, // [REUSE] from Trader's Corner
  },
  {
    id: 'you-btc-price',
    name: 'BTC Price',
    desc: 'Live Bitcoin price with digit animation',
    cat: 'markets',
    defaultSpan: 4,
    render: PriceHero, // [REUSE] from Trader's Corner, larger variant
  },
  {
    id: 'you-heatmap',
    name: 'Market Heatmap',
    desc: 'Top 50 coins as treemap colored by 24h performance',
    cat: 'visualize',
    defaultSpan: 8,
    render: MarketHeatmap,
  },
  {
    id: 'you-alerts',
    name: 'Price Alerts',
    desc: 'Your configured price and condition alerts',
    cat: 'portfolio',
    defaultSpan: 3,
    render: AlertsWidget, // [REUSE] from Trader's Corner
  },

  // ── TIER 2: Behavioral unlock (score > 50) ─────────────────────────

  {
    id: 'you-bubbles',
    name: 'Bubble Map',
    desc: 'Force-directed bubbles sized by market cap',
    cat: 'visualize',
    defaultSpan: 6,
    render: BubbleMap,
  },
  {
    id: 'you-main-chart',
    name: 'Price Chart',
    desc: 'TradingView candlestick chart, any token',
    cat: 'charts',
    defaultSpan: 8,
    render: CandleChartWidget, // [REUSE] from Trader's Corner
  },
  {
    id: 'you-candle',
    name: 'Candle Chart',
    desc: 'Compact candlestick for a secondary token',
    cat: 'charts',
    defaultSpan: 4,
    render: CandleChartWidget, // [REUSE] same component, compact prop
  },
  {
    id: 'you-linear-chart',
    name: 'Line / Area Chart',
    desc: 'Multi-token line chart with normalized mode',
    cat: 'charts',
    defaultSpan: 4,
    render: LinearAreaChart,
  },
  {
    id: 'you-exchange-bubbles',
    name: 'Exchange Bubbles',
    desc: 'Exchange volume as sized bubbles',
    cat: 'visualize',
    defaultSpan: 6,
    render: ExchangeBubbles,
  },
  {
    id: 'you-liq-bars',
    name: 'Liquidation Heatmap',
    desc: 'Long/short clusters by price level',
    cat: 'analytics',
    defaultSpan: 6,
    render: LiqBarsWidget, // [REUSE] from Trader's Corner
  },
  {
    id: 'you-liq-bubbles',
    name: 'Liquidation Bubbles',
    desc: 'Cluster size as bubbles across price levels',
    cat: 'analytics',
    defaultSpan: 4,
    render: LiqBubblesWidget, // [REUSE]
  },
  {
    id: 'you-liq-timeline',
    name: 'Liquidation Timeline',
    desc: 'Historical cascade volume over time',
    cat: 'analytics',
    defaultSpan: 6,
    render: LiqTimelineWidget, // [REUSE]
  },
  {
    id: 'you-funding-heatmap',
    name: 'Funding Rate Grid',
    desc: 'Rates across tokens × exchanges',
    cat: 'analytics',
    defaultSpan: 6,
    render: FundingHeatmapWidget, // [REUSE]
  },
  {
    id: 'you-whale-alerts',
    name: 'Whale Alerts',
    desc: 'Large on-chain transactions in real time',
    cat: 'analytics',
    defaultSpan: 4,
    render: WhaleAlertsWidget, // [REUSE]
  },
  {
    id: 'you-screener',
    name: 'AI Screener',
    desc: 'Market scan with signals and heat scores',
    cat: 'analytics',
    defaultSpan: 12,
    render: ScreenerWidget, // [REUSE]
  },
  {
    id: 'you-exchange-flows',
    name: 'Exchange Flows',
    desc: 'Real-time inflow/outflow events',
    cat: 'analytics',
    defaultSpan: 4,
    render: ExchangeFlowsWidget, // [REUSE]
  },
  {
    id: 'you-etf-flows',
    name: 'ETF Flows',
    desc: 'Daily ETF inflow/outflow per fund',
    cat: 'analytics',
    defaultSpan: 4,
    render: EtfFlowsWidget, // [REUSE]
  },
  {
    id: 'you-orderbook',
    name: 'Order Book Depth',
    desc: 'Bid/ask depth chart',
    cat: 'charts',
    defaultSpan: 4,
    render: OrderBookWidget, // [REUSE]
  },

  // ── TIER 3: Power user unlock (score > 70) ─────────────────────────

  {
    id: 'you-positions',
    name: 'Open Positions',
    desc: 'Live P&L for all open trades',
    cat: 'portfolio',
    defaultSpan: 8,
    render: PositionsWidget, // [REUSE]
  },
  {
    id: 'you-portfolio',
    name: 'Portfolio Ring',
    desc: 'Allocation donut chart',
    cat: 'portfolio',
    defaultSpan: 3,
    render: PortfolioRingWidget, // [REUSE]
  },
  {
    id: 'you-watchlist',
    name: 'Watchlist',
    desc: 'Your saved tokens with live prices',
    cat: 'portfolio',
    defaultSpan: 4,
    render: WatchlistWidget, // [REUSE]
  },
  {
    id: 'you-onchain',
    name: 'On-Chain Metrics',
    desc: 'Active addresses, MVRV, exchange flow, HODL wave',
    cat: 'defi',
    defaultSpan: 4,
    render: OnChainMetricsWidget,
  },
  {
    id: 'you-protocol-tvl',
    name: 'Protocol TVL',
    desc: 'Top DeFi protocols by TVL with 7d change',
    cat: 'defi',
    defaultSpan: 4,
    render: ProtocolTVLWidget,
  },
  {
    id: 'you-sentiment',
    name: 'Sentiment Feed',
    desc: 'Market sentiment across social channels per token',
    cat: 'intelligence',
    defaultSpan: 4,
    render: SentimentWidget,
  },
  {
    id: 'you-brief-archive',
    name: 'Brief Archive',
    desc: 'Recent Spectre briefs — read/unread',
    cat: 'intelligence',
    defaultSpan: 4,
    render: BriefArchiveWidget,
  },
  {
    id: 'you-stocks',
    name: 'Stocks Movers',
    desc: 'MSTR, COIN, RIOT, MARA and crypto-adjacent equities',
    cat: 'stocks',
    defaultSpan: 4,
    render: StockMoversWidget,
  },
];
```

---

## DEFAULT LAYOUT — FIRST-TIME USER

When `sessionCount < 3`, show this fixed layout:

```
Row 1: you-ai-brief (6) · you-fear-greed (3) · you-btc-price (3)
Row 2: you-top-coins (12)
Row 3: you-heatmap (8) · you-alerts (4)
```

Below the grid, centered invitation copy — no card, no background:

```jsx
<div className="you-invitation">
  <p className="you-invitation-quote">"This is your space."</p>
  <p className="you-invitation-sub">Add anything. Remove anything. We'll learn the rest.</p>
  <button className="you-invitation-btn" onClick={openLibrary}>
    Explore All Widgets →
  </button>
</div>
```

```css
.you-invitation {
  text-align: center;
  padding: 32px 0 48px;
}
.you-invitation-quote {
  font-family: var(--font-cinema);
  font-style: italic;
  font-size: 18px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.you-invitation-sub {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 20px;
}
.you-invitation-btn {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  background: transparent;
  border-radius: var(--radius-sm);
  padding: 8px 18px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
}
.you-invitation-btn:hover {
  border-color: var(--border-accent);
  color: var(--accent);
  transform: translateY(-1px);
}
```

---

## SUGGESTED WIDGET SLOT

Rendered at the bottom of the active grid, before the empty add zones.

```jsx
// Only renders if getSuggestedWidget() returns a result
// and the suggestion hasn't been dismissed this session
{suggestion && (
  <div className="you-suggestion">
    <div className="you-suggestion-title">Add {suggestion.widget.name}?</div>
    <div className="you-suggestion-reason">{suggestion.reason}</div>
    <div className="you-suggestion-actions">
      <button onClick={() => addWidget(suggestion.widget)} className="btn-accent-sm">
        Add Now
      </button>
      <button onClick={dismissSuggestion} className="btn-ghost-sm">
        Not for me
      </button>
    </div>
  </div>
)}
```

```css
.you-suggestion {
  border: 1.5px dashed var(--border-default);
  border-radius: var(--radius-xl);
  padding: 20px 24px;
  background: transparent;
  grid-column: span 4;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
}
.you-suggestion:hover {
  border-color: rgba(139,92,246,0.3);
  background: rgba(139,92,246,0.03);
}
.you-suggestion-title {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.you-suggestion-reason {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-muted);
}
.you-suggestion-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
```

---

## WIDGET SPECS — NEW COMPONENTS ONLY

Only widgets that don't exist in Trader's Corner. All others are imported.

---

### AiBriefCard

The most important widget. Editorial. Premium.

```
┌──────────────────────────────────────────────────────────┐
│  INTELLIGENCE                          2h ago · 4min     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  "BTC's Range Tightens as Institutions                   │
│   Accumulate at Key Support"                             │
│                                                          │
│  Market digesting last week's rejection at $98k          │
│  while spot demand continues to build quietly.           │
│  Three signals point to resolution within 48h...         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [MACRO] [BTC] [ACCUMULATE]           Read Full →        │
└──────────────────────────────────────────────────────────┘
```

- Card background: `linear-gradient(168deg, rgba(139,92,246,0.05), rgba(13,13,17,0.99))`
- Top edge line `::before`: `height:1px; background: linear-gradient(90deg, transparent, rgba(139,92,246,0.35), transparent)`
- Title: `font-cinema` italic 19px `text-primary`
- Body: `font-body` 12px `text-secondary` line-height 1.6, max 3 lines then `…`
- Topic tags: `font-mono` 8px uppercase, `bg-elevated` bg, `border-default` border, `radius: 4px`, padding `2px 8px`
- Read Full: `--accent` 10px `font-body`, right-aligned

---

### TopCoinsCarousel

Horizontal row of glass pill cards, one per coin. Scrollable.

Each pill (140px wide, fills widget height):
- Avatar circle 32px: token-ambient colors
- Name: `font-body` 12px weight 600
- Price: `font-mono` 14px weight 700
- Change: `font-mono` 10px bull/bear colored, with `▲` / `▼`
- Sparkline: SVG 80×28px, 7-day data
- Background tint: `rgba(16,185,129,0.04)` if positive, `rgba(239,68,68,0.04)` if negative
- Hover: `translateY(-3px)`, token-ambient `box-shadow` beneath

Token ambient colors:
```javascript
BTC  → bg rgba(247,147,26,0.14)  / text #F7931A / border rgba(247,147,26,0.22)
ETH  → bg rgba(98,126,234,0.14)  / text #627EEA / border rgba(98,126,234,0.22)
SOL  → bg rgba(20,241,149,0.11)  / text #14F195 / border rgba(20,241,149,0.18)
BNB  → bg rgba(240,185,11,0.11)  / text #F0B90B / border rgba(240,185,11,0.18)
ARB  → bg rgba(40,160,240,0.11)  / text #28A0F0 / border rgba(40,160,240,0.18)
MATIC→ bg rgba(130,71,229,0.11)  / text #8247E5 / border rgba(130,71,229,0.18)
```

---

### MarketHeatmap

Treemap. Coins as rectangles sized by market cap, colored by 24h performance.

- Fills all available space with zero gaps (treemap algorithm)
- Color scale: `rgba(239,68,68, opacity)` for negative → `rgba(255,255,255,0.06)` at 0% → `rgba(16,185,129, opacity)` for positive
- Opacity scales with magnitude: `±1%` = 0.25 opacity, `±5%+` = 0.7 opacity
- Labels inside rectangle: symbol in `font-mono` weight 700, sized to fit, min 8px max 16px
- Sub-label: 24h% in `font-mono` weight 600, same size
- Hover: `filter: brightness(1.15)` + glass tooltip with full token data
- At `lg` (8 col): top 50 coins. At `xl` (12 col): top 100.

---

### BubbleMap

Force-directed SVG/Canvas bubble chart.

- Each coin = circle sized by market cap (`r = Math.sqrt(mcap) * constant`)
- Color fill: same scale as heatmap — negative red, positive green, neutral white-4%
- Border: matching color at 30% opacity, 1px
- Micro-drift motion: each bubble has a gentle float — `amplitude: 4-8px`, `period: 4-9s`, randomized per bubble
- Large bubbles (BTC, ETH, BNB, SOL) labeled: `font-mono` weight 700 white, size proportional to radius
- Hover: bubble scales 1.1, full tooltip
- Timeframe toggle: `1h | 24h | 7d | 30d` — recolors all instantly
- Implementation: prefer SVG with `<circle>` elements and CSS animation for drift. Canvas only if performance requires it.

---

### LinearAreaChart

Multi-token area/line chart.

- Up to 3 tokens overlaid on same chart
- Single token mode: area fill below line, gradient from color at 30% → 0%
- Multi-token mode: lines only, no fill (too noisy)
- Normalized toggle (`%`): when on, all lines start at 0% and show relative change
- Token color assignment: BTC `#F7931A`, ETH `#627EEA`, SOL `#14F195`, others use `--accent`, `#FBB924`, `#EC4899`
- X-axis: `font-mono` 8px `text-muted`
- Y-axis: `font-mono` 8px `text-muted`, right-aligned
- Timeframe: `1D | 7D | 30D | 90D | 1Y`
- Grid lines: `rgba(255,255,255,0.04)`, horizontal only

---

### ExchangeBubbles

Exchange volumes as sized bubbles.

- Same force-simulation as BubbleMap
- Bubble size = 24h volume
- Bubble color: positive net flow → `rgba(16,185,129,0.35)`, negative → `rgba(239,68,68,0.3)`
- Label: exchange name in `font-mono` 10px weight 600 white
- Exchanges: Binance, Bybit, OKX, Coinbase, Kraken, Deribit, Hyperliquid
- On click: expands to show top 5 pairs on that exchange in a mini-table below

---

## SHARE MY SETUP

### The Share Button

In the YOU header, right-aligned:
```css
.you-share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
}
.you-share-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
  transform: translateY(-1px);
}
```

### Share Sheet Overlay

Slides up from bottom on click. Not a full modal.

```
┌──────────────────────────────────────────────┐
│  Share Your Setup                        [✕] │
├──────────────────────────────────────────────┤
│                                              │
│  [Dashboard thumbnail — canvas snapshot]     │
│                                              │
│  [Editable name: "Sunny's Setup"]            │
│  12 widgets · Updated now                    │
│                                              │
│  spectre.ai/u/sunny/dashboard                │
│  [──────────────────] [Copy Link]            │
│                                              │
│  ◉ Anyone with the link                     │
│  ○ Spectre members only                     │
│  ○ Private                                   │
│                                              │
│  [Share on X]   [Copy]   [QR Code]           │
│                                              │
└──────────────────────────────────────────────┘
```

```css
.you-share-sheet {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%) translateY(100%);
  width: 480px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding: 24px;
  z-index: 200;
  box-shadow: 0 -16px 60px rgba(0,0,0,0.5);
  transition: transform 0.35s cubic-bezier(0.16,1,0.3,1);
}
.you-share-sheet.open {
  transform: translateX(-50%) translateY(0);
}
```

- Setup name: `contenteditable="true"`, `font-display` 15px weight 600, click to edit
- Link input: readonly, `font-mono` 11px, `bg-surface`, copy on click
- Copy Link button: accent primary style
- Share on X: ghost button
- QR Code: generates inline using a lightweight QR library

### Shared Dashboard URL — Visitor View

Route: `/setup/:setupId` or `/u/:username`

```jsx
// Read-only. No drag handles. No close buttons. No add zones.
// Real-time data still loads. Layout is from the owner's saved config.

<div className="you-shared-header">
  <div className="you-shared-owner">Sunny's Setup</div>
  <div className="you-shared-tagline">"This is how I see the market."</div>
  <div className="you-shared-meta">12 widgets · Shared Feb 22, 2026</div>
  <div className="you-shared-actions">
    <button className="btn-accent">Clone This Setup</button>
    <button className="btn-ghost">Follow This Trader</button>
  </div>
</div>
<ModularGrid readOnly layout={sharedLayout} />
```

Clone behavior:
1. If logged in: confirm dialog "Replace your current YOU with Sunny's? Yours will be saved."
2. Current layout backed up to `localStorage` as `spectre_you_backup_[timestamp]`
3. Widgets fly in with 60ms stagger animation
4. If not logged in: redirect to sign up, clone applied after account creation

---

## LAYOUT PERSISTENCE

```javascript
const LAYOUT_KEY = 'spectre_you_layout_v1';

// Save on every drag/drop/resize/add/remove
function saveLayout(widgets) {
  const layout = widgets.map(w => ({
    id: w.id,
    span: w.span,
    order: w.order,
  }));
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  // Also sync to user profile API if authenticated
  if (isAuthenticated()) {
    api.patch('/user/you-layout', { layout });
  }
}

// Load on mount
function loadLayout() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY));
  } catch {
    return null; // null = use default layout
  }
}
```

---

## EMPTY STATES

Every widget must have one. Never blank. Never a red error box.

| Widget | Empty State Copy |
|---|---|
| AiBriefCard | Skeleton shimmer + "Preparing your briefing..." |
| TopCoinsCarousel | Skeleton pills |
| MarketHeatmap | Skeleton rectangles + "Loading market data..." |
| BubbleMap | Empty canvas + "Bubbles loading..." |
| Any watchlist-dependent widget | "Add tokens to your watchlist to see data here." + ghost add button |
| Positions widget (no positions) | "No open positions. Connect your exchange or add manually." |
| Any chart | Skeleton shimmer in chart area |

Skeleton shimmer pattern:
```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-surface) 25%,
    var(--bg-elevated) 50%,
    var(--bg-surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

---

## DAY MODE

Every dark-mode class needs a `.app.app-day-mode` override.

```css
.app.app-day-mode .you-card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
}
.app.app-day-mode .you-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.06);
}

/* Day mode text */
.app.app-day-mode .you-text-primary   { color: #0f172a; }
.app.app-day-mode .you-text-secondary { color: #334155; }
.app.app-day-mode .you-text-muted     { color: #94a3b8; }

/* Day mode YOU header */
.app.app-day-mode .you-headline {
  color: #0f172a;
}
```

---

## BUILD PHASES — DO THESE IN ORDER

**Phase 1 — Shell**
1. Register `/you` route
2. Add YOU to sidebar nav
3. `SpectreYou.jsx` with YouHeader, static intelligence banner, imported grid, default 6-widget layout
4. Confirm page renders, no console errors

**Phase 2 — Core Widgets**
5. AiBriefCard
6. TopCoinsCarousel  
7. MarketHeatmap
8. BubbleMap
9. LinearAreaChart
10. ExchangeBubbles

**Phase 3 — Share My Setup**
11. YouShareSheet component
12. Share URL generation and persistence
13. Visitor/read-only route
14. Clone flow with confirmation

**Phase 4 — Intelligence Layer**
15. `YouBehavior.js` — tracking + scoring
16. Auto-layout generation from scores
17. Intelligence banner with dynamic copy
18. Suggested widget slot

**Phase 5 — Polish**
19. All empty states
20. All day mode overrides
21. First-time user invitation copy
22. Animation pass — ensure all flubber timings are correct
23. Performance — lazy load all below-fold widgets with IntersectionObserver

---

## CHECKLIST BEFORE SHIPPING

- [ ] `/you` route registered, accessible from sidebar
- [ ] WelcomePage.jsx — not modified, not imported into, untouched
- [ ] Every number uses `var(--font-mono)` 
- [ ] Every icon from `spectreIcons.jsx`
- [ ] Every color is a CSS variable
- [ ] Every card has glass depth (inset top highlight + outer shadow)
- [ ] Every interactive element has `translateY(-2px)` hover
- [ ] Trader's Corner widgets imported, not duplicated
- [ ] `YouBehavior.js` has zero React imports (pure JS only)
- [ ] The word "AI" is not visible anywhere on the page
- [ ] The word "Powered by" is not visible anywhere
- [ ] Intelligence banner auto-dismisses after 8s, never returns same session
- [ ] Default layout shown to users with < 3 sessions
- [ ] Invitation copy shown below default layout for new users
- [ ] Share Sheet opens, generates URL, Copy Link works
- [ ] Shared URL route renders in read-only mode with live data
- [ ] Clone confirms before replacing, backs up current layout
- [ ] All widgets have skeleton empty states
- [ ] Day mode overrides exist for all new CSS classes
- [ ] Layout persists across page refreshes
- [ ] Squint test: hero element obvious in every widget
- [ ] Screenshot test: at least one moment in the full view is worth screenshotting
