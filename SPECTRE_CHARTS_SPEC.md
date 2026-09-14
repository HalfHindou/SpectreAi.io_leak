# SPECTRE — INTERACTIVE CHARTS & COMPARISON INTELLIGENCE SPEC

> Charts are not decoration. Every chart in Spectre must answer a question a trader actually has. "How has NVDA performed vs MSFT vs Gold over 90 days?" is a question. A chart of BTC price with no context is not.

---

## PART 1 — WHEN CHARTS APPEAR

Charts are context-triggered, not always-on. The system detects when a chart adds genuine value and renders it automatically. The user never has to click "show chart" — it just appears in the right place.

### Trigger Conditions

```javascript
function shouldRenderChart(query, resolvedEntities, queryType) {

  // ALWAYS render chart:
  if (resolvedEntities.length >= 2) return 'COMPARISON';
  // Any multi-asset query gets a comparison chart

  if (queryType === 'TOKEN_RESEARCH' || queryType === 'STOCK_RESEARCH') return 'SINGLE';
  // Any single asset deep thesis gets a price chart

  if (queryType === 'SECTOR_ANALYSIS') return 'SECTOR_HEATMAP';
  // "Top AI tokens", "Best performing DeFi" → sector heatmap

  if (queryType === 'NARRATIVE') return 'NARRATIVE_PERFORMANCE';
  // "How is the RWA narrative doing?" → narrative basket chart

  // NEVER render chart:
  if (queryType === 'GENERAL') return null;
  // "What is a CLMM?" → no chart needed

  return null;
}
```

### Chart Placement Rules

**In Search Engine — Deep Thesis tab:**
Chart renders immediately below the price card, above the written thesis. It is the first thing after price. The thesis text references the chart: "As shown above, NVDA has outperformed MSFT by 34% over 90 days..."

**In Intelligence Hub — Article view:**
Chart renders inline within the article at the point where data is first discussed. Not at the top, not at the bottom — at the sentence where it's referenced.

**In Search Engine — Quick Intel tab:**
No chart. Quick Intel is fast answers only. "Go deeper →" button takes to Deep Thesis which has the chart.

---

## PART 2 — CHART LIBRARY SELECTION

### Why Highcharts

Highcharts is the right choice for Spectre specifically:

- **Financial chart types built-in:** candlestick, OHLCV, range, area, column — no custom work needed
- **Stock.js module:** purpose-built for financial data with range selectors (1D/1W/1M/3M/1Y/ALL), navigator, crosshair
- **Export built-in:** users can download PNG, SVG, CSV directly from the chart — no extra code
- **Annotations module:** draw trend lines, support/resistance levels, mark events (earnings, listings, news) programmatically
- **Accessibility:** screen reader support built in — important for professional/institutional users
- **License:** $X/year for commercial use — evaluate vs Chart.js (free) based on budget

### Alternative: Lightweight Charts (TradingView)

TradingView's open-source `lightweight-charts` library is free, performant, and purpose-built for financial data. Fewer features than Highcharts but faster render and no licensing cost. Use this if licensing is a concern.

**Decision framework:**
- Highcharts if you want annotations, export, and the range navigator out of the box
- Lightweight Charts if you want zero licensing cost and maximum performance
- Both are compatible with the architecture below — the data layer is identical

---

## PART 3 — CHART TYPES

### Type 1: Single Asset — Price + Volume

Rendered for any single-token or single-stock deep thesis.

```
┌────────────────────────────────────────────────────────┐
│  NeuralAI ($NEURAL)              1D  1W  1M  3M  1Y   │
│                                                        │
│  $0.63  ▼ -4.2%                                       │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │                                    ╱╲            │ │
│  │                              ╱╲╱╲╱  ╲           │ │
│  │                        ╱╲╱╲╱        ╲╱╲        │ │
│  │  ╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱               ╲╱╲╱╲ │ │
│  └──────────────────────────────────────────────────┘ │
│  ▓▓░░░▓▓░░░▓▓░░░▓▓░░░▓▓░░░▓▓░░░  ← volume bars      │
│                                                        │
│  ── Price    ── 20 EMA    ── 50 EMA                   │
│                                                        │
│  ⚡ APG Arena launch marked on chart (Feb 18)          │
└────────────────────────────────────────────────────────┘
```

**Data source:** Internal price feed (Binance/CoinGecko OHLCV)
**Indicators overlaid by default:** 20 EMA, 50 EMA, volume
**Event markers:** Breaking news, major announcements auto-pinned to the chart date
**Range selector:** 1D, 1W, 1M, 3M, 1Y, ALL — defaults to 3M

---

### Type 2: Multi-Asset Comparison — Normalized Performance

Rendered when 2+ assets are in the query. This is the NVDA vs MSFT vs Gold use case.

Key insight: you cannot compare price directly (NVDA at $800 vs Gold at $2000 is meaningless). You normalize to percentage return from a common start date.

```
┌────────────────────────────────────────────────────────┐
│  Performance Comparison        1W  1M  3M  6M  1Y     │
│  Base: Jan 1, 2026 = 0%                               │
│                                                        │
│  +40%│           ╱── NVDA +38.2%                     │
│  +30%│          ╱                                     │
│  +20%│    ╱────╱──── MSFT +19.7%                     │
│  +10%│   ╱    ╱                                      │
│    0%│──╱────╱──────────────────── GOLD +2.1%        │
│  -10%│ ╱                                              │
│      └────────────────────────────────────────────    │
│       Jan        Feb        Mar        Apr            │
│                                                        │
│  ● NVDA (NASDAQ)  ● MSFT (NASDAQ)  ● GOLD (Commodity) │
└────────────────────────────────────────────────────────┘
```

**Normalization:** All assets reindexed to 0% at the start of the selected period
**Mixed asset support:** Crypto + stocks + commodities + indices on the same chart
**Color coding:** Each asset gets a distinct color from Spectre's palette — never green/red (reserved for gains/losses), use blue, purple, orange, teal, yellow
**Correlation score:** Below the chart — "NVDA and MSFT show 0.87 correlation over this period"

---

### Type 3: Peer Comparison Table + Sparklines

Rendered alongside deep thesis for any asset. Shows context — where does this asset sit within its sector?

**For crypto:** Top tokens in the same category from CoinGecko
**For stocks:** Sector peers from the same GICS classification

```
┌────────────────────────────────────────────────────────┐
│  AI TOKENS — SECTOR COMPARISON                         │
│                                                        │
│  TOKEN      MCAP      7D      30D    SPARKLINE         │
│  ─────────────────────────────────────────────────     │
│  FET        $892M   +12.3%  +44.1%  ▁▃▅▇▆▄▇▇▅       │
│  VIRTUAL    $743M    +8.9%  +31.2%  ▂▄▃▅▇▆▅▄▃       │
│  RENDER     $421M    +6.1%  +22.8%  ▃▂▄▅▆▇▅▄▅       │
│  ▶ NEURAL    $6.3M   -4.2%   -8.1%  ▅▄▃▂▃▂▁▂▁       │
│  AI16Z       $4.1M   -2.1%   -5.3%  ▄▃▃▂▃▂▂▁▂       │
│                                                        │
│  ▶ = Currently viewing                                 │
│  Sorted by: Market Cap  [7D Perf] [30D Perf] [MCap]  │
└────────────────────────────────────────────────────────┘
```

This table answers: "How is NEURAL performing relative to the AI sector?" in 3 seconds.

**Auto-generation logic:**
```javascript
async function buildPeerTable(entity, resolvedCategory) {
  // Get top 10 tokens in same CoinGecko category
  const peers = await fetchCoinGeckoCategoryTokens(resolvedCategory, { limit: 10 });

  // Insert the queried asset if not in top 10, marked as current
  const tableData = peers.map(token => ({
    name:      token.name,
    ticker:    token.symbol,
    mcap:      token.market_cap,
    change7d:  token.price_change_percentage_7d,
    change30d: token.price_change_percentage_30d,
    sparkline: token.sparkline_in_7d?.price || [],
    isCurrent: token.symbol === entity.ticker,
  }));

  return tableData;
}
```

**For Spectre AI self-queries specifically:**
The peer table shows top AI platform tokens: FET, VIRTUAL, RENDER, AI16Z, AGENT, NMT — contexualizes where $SPECTRE sits in the AI tools sector without the user having to ask.

---

### Type 4: Sector Heatmap

Rendered when query is about a sector, not a specific asset. "How is DeFi doing?" / "Top AI tokens this week" / "What's moving in RWA?"

```
┌────────────────────────────────────────────────────────┐
│  AI TOKENS — 7 DAY PERFORMANCE                        │
│                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │          │ │  RENDER  │ │          │              │
│  │   FET    │ │  +6.1%   │ │ VIRTUAL  │              │
│  │  +12.3%  │ │          │ │  +8.9%   │              │
│  │          │ └──────────┘ │          │              │
│  └──────────┘              └──────────┘              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                │
│  │AI16Z │ │NEURAL│ │AGENT │ │ NMT  │                │
│  │-2.1% │ │-4.2% │ │-1.8% │ │-0.9% │                │
│  └──────┘ └──────┘ └──────┘ └──────┘                │
│                                                        │
│  Box size = market cap   Color = 7D performance       │
│  ■ Green (>5%)  ■ Lt Green (<5%)  ■ Red (<0%)        │
└────────────────────────────────────────────────────────┘
```

Size of each box is proportional to market cap. Color is 7D performance. This is the standard financial heatmap used by Finviz for stocks — Spectre brings it to crypto sectors.

---

### Type 5: User-Prompted Custom Chart

This is the Highcharts "ask me anything" concept you mentioned. In the search bar, users can type natural language chart requests:

```
"Show me BTC vs ETH vs SOL performance over 6 months"
"Compare NVDA MSFT GOOGL since the start of 2026"
"Chart the top 5 DeFi tokens by TVL growth last 30 days"
"Show me gold vs bitcoin correlation since the rate cuts"
```

The system parses the request, identifies assets and timeframe, and renders the appropriate chart type automatically.

```javascript
async function handleChartQuery(query) {
  // Parse the chart request
  const chartSpec = await parseChartRequest(query);
  // {
  //   assets: ['BTC', 'ETH', 'SOL'],
  //   period: '6M',
  //   chartType: 'comparison',
  //   metric: 'price_performance'
  // }

  // Fetch data for all assets
  const data = await Promise.all(
    chartSpec.assets.map(ticker => fetchOHLCV(ticker, chartSpec.period))
  );

  // Normalize and render
  return {
    type: 'CHART_RESPONSE',
    chartSpec,
    data: normalizeForComparison(data, chartSpec),
    writtenSummary: generateChartSummary(data, chartSpec),
    // e.g. "Over 6 months, BTC led with +42%, ETH returned +28%, SOL +61%"
  };
}
```

---

## PART 4 — IMPLEMENTATION ARCHITECTURE

### Data Layer

Charts pull from a unified time-series endpoint that handles both crypto and stocks:

```javascript
// server/api/timeseries.js

app.get('/api/v1/timeseries/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const { period = '3M', interval = '1D' } = req.query;

  const entity = await entityResolver.resolve(ticker);

  let data;
  if (entity.type === 'crypto') {
    data = await fetchCryptoOHLCV(entity.coingeckoId, period, interval);
  } else if (entity.type === 'stock') {
    data = await fetchStockOHLCV(entity.ticker, period, interval);
    // source: Yahoo Finance v8 or Finnhub
  } else if (entity.type === 'commodity') {
    data = await fetchCommodityPrice(entity.ticker, period);
    // source: FRED API for gold, silver; CME data for oil
  } else if (entity.type === 'index') {
    data = await fetchIndexData(entity.ticker, period);
    // SPX, NDX, DXY, VIX
  }

  res.json({ ticker, entity, data, period, interval });
});
```

**Cache strategy:**
- Intraday data (1D view): cache 5 minutes
- Daily data (1W–3M): cache 1 hour
- Historical data (1Y+): cache 6 hours
- Sparklines for peer tables: cache 1 hour

### Frontend Component

```jsx
// src/components/charts/SpectreChart.jsx

import Highcharts from 'highcharts/highstock';
import HighchartsReact from 'highcharts-react-official';

export function SpectreChart({ assets, period, chartType, events }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchComparisonData(assets, period).then(setData);
  }, [assets, period]);

  if (!data) return <ChartSkeleton />;  // shimmer skeleton, never spinner

  const options = buildHighchartsOptions({
    data,
    chartType,
    events,
    theme: SPECTRE_CHART_THEME,
  });

  return (
    <div className="spectre-chart-container">
      <HighchartsReact highcharts={Highcharts} options={options} />
      {events?.length > 0 && <ChartEventLegend events={events} />}
    </div>
  );
}
```

### Spectre Chart Theme

Charts must look like they belong in the Spectre design system. No default Highcharts light theme.

```javascript
const SPECTRE_CHART_THEME = {
  chart: {
    backgroundColor: 'transparent',
    style: { fontFamily: 'Inter, sans-serif' },
  },
  xAxis: {
    gridLineColor:  'rgba(255,255,255,0.04)',
    lineColor:      'rgba(255,255,255,0.08)',
    tickColor:      'rgba(255,255,255,0.08)',
    labels: { style: { color: 'rgba(255,255,255,0.48)', fontSize: '11px' } },
  },
  yAxis: {
    gridLineColor:  'rgba(255,255,255,0.04)',
    labels: {
      style: { color: 'rgba(255,255,255,0.48)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' },
    },
  },
  tooltip: {
    backgroundColor: '#1a1a1f',
    borderColor:      'rgba(255,255,255,0.08)',
    style: { color: 'rgba(255,255,255,0.9)', fontFamily: 'Inter, sans-serif' },
    valueDecimals: 2,
  },
  legend: {
    itemStyle:      { color: 'rgba(255,255,255,0.72)', fontFamily: 'Inter, sans-serif' },
    itemHoverStyle: { color: '#ffffff' },
  },
  rangeSelector: {
    buttonTheme: {
      fill:   'rgba(255,255,255,0.04)',
      stroke: 'rgba(255,255,255,0.08)',
      style:  { color: 'rgba(255,255,255,0.72)' },
      states: {
        hover:  { fill: 'rgba(255,255,255,0.08)' },
        select: { fill: '#8B5CF6', style: { color: '#ffffff' } },
      },
    },
    inputStyle:  { color: 'rgba(255,255,255,0.72)', backgroundColor: '#131316' },
    labelStyle:  { color: 'rgba(255,255,255,0.48)' },
  },
  navigator: {
    maskFill: 'rgba(139,92,246,0.15)',
    outlineColor: 'rgba(255,255,255,0.08)',
    handles: { backgroundColor: '#1a1a1f', borderColor: 'rgba(255,255,255,0.2)' },
  },
  // Asset color palette — never use red/green (reserved for gain/loss)
  colors: ['#8B5CF6', '#06B6D4', '#F59E0B', '#EC4899', '#10B981', '#6366F1'],
  credits: { enabled: false }, // no Highcharts watermark
};
```

---

## PART 5 — CHART INTERACTION FEATURES

### What Users Can Do

**Zoom:** Click and drag to zoom into any time range. Range selector updates to match.

**Hover crosshair:** Hovering shows exact values for all assets at that date in a unified tooltip. Mixed assets show in their native currency (USD for stocks, USD for crypto) with the normalized % performance.

**Toggle assets:** Click a legend item to show/hide that asset. Useful when comparing 5+ assets — hide the noisy ones to focus.

**Export:** Built-in Highcharts export menu — PNG, SVG, CSV. PNG is the most used — traders screenshot charts for X posts. The exported PNG automatically includes the Spectre watermark.

**Add to comparison:** From any peer table row, a "+" button adds that asset to the current comparison chart without reloading.

**Annotate (Elite tier only):** Draw trend lines, horizontal levels, and text annotations. Annotations save per user account. Gated behind Elite/Holder-7000 as a premium feature.

### Event Markers on Chart

When a thesis is generated, key events from the research are automatically pinned to the chart:

```javascript
function extractChartEvents(dossier) {
  const events = [];

  // Breaking news in last 30 days
  dossier.breakingNews?.forEach(news => {
    events.push({
      date:  news.date,
      label: news.headline.substring(0, 40) + '...',
      type:  'news',
      color: '#F59E0B',
    });
  });

  // Major on-chain events
  if (dossier.onChain?.unusualActivity) {
    events.push({
      date:  dossier.onChain.unusualActivity.date,
      label: dossier.onChain.unusualActivity.description,
      type:  'on-chain',
      color: '#8B5CF6',
    });
  }

  // Token launches, listings
  dossier.recentNews
    ?.filter(n => /listed|launch|listing/i.test(n.title))
    .forEach(n => events.push({
      date:  n.date,
      label: 'Exchange listing',
      type:  'listing',
      color: '#10B981',
    }));

  return events;
}
```

---

## PART 6 — PEER TABLE INTELLIGENCE

### Auto-Category Detection

The peer table populates automatically based on the queried asset's CoinGecko categories. No manual configuration.

```javascript
async function buildContextualPeerTable(entity) {
  // Get the asset's categories
  const cgData = await fetchCoinGeckoDeep(entity.coingeckoId);
  const primaryCategory = cgData.categories?.[0]; // e.g. "Artificial Intelligence"

  // Fetch top 10 in that category
  const peers = await fetchCoinGeckoCategoryTokens(primaryCategory, {
    limit:   10,
    sortBy:  'market_cap',
    include: ['sparkline', 'price_change_7d', 'price_change_30d', 'market_cap'],
  });

  // If queried asset is not in top 10, insert it at its natural position
  const currentAssetInList = peers.find(p => p.symbol === entity.ticker);
  if (!currentAssetInList) {
    const assetData = await fetchCoinGeckoBasic(entity.coingeckoId);
    const insertIndex = peers.findIndex(p => p.market_cap < assetData.market_cap);
    peers.splice(insertIndex === -1 ? peers.length : insertIndex, 0, {
      ...assetData,
      isCurrent: true,
    });
  } else {
    currentAssetInList.isCurrent = true;
  }

  return {
    category:  primaryCategory,
    peers:     peers.slice(0, 11), // top 10 + current if not in top 10
    updatedAt: Date.now(),
  };
}
```

### Peer Table for Stocks

Same logic, using GICS sector classification instead of CoinGecko categories:

```
NVDA searched → category: "Semiconductors" (GICS)
Peer table shows: AMD, INTC, QCOM, AVGO, TSM, ASML, MRVL, KLAC, AMAT, LRCX
```

```javascript
async function buildStockPeerTable(entity) {
  const stockData = await fetchFinnhubProfile(entity.ticker);
  const sector    = stockData.finnhubIndustry; // "Semiconductors"

  const peers = await fetchSectorPeers(sector, { limit: 10 });
  return buildPeerTableObject(peers, entity);
}
```

### Spectre AI Self-Query Peer Table

When someone searches Spectre AI, the peer table shows the AI tools sector — where Spectre would sit if it were tracked on CoinGecko at its current stage:

```javascript
// Special case for SPECTRE self-query
const SPECTRE_PEERS = [
  'FET', 'VIRTUAL', 'RENDER', 'AI16Z', 'AGENT', 'NMT', 'SPECTRAL'
];
// These are fetched live from CoinGecko
// SPECTRE is inserted into the table at its actual market cap position
// This contextualizes Spectre's size and performance vs sector peers
```

---

## PART 7 — WHAT CLAUDE CODE MUST DO

### Step 1: Install dependencies

```bash
npm install highcharts highcharts-react-official
# OR for lightweight-charts:
npm install lightweight-charts
```

### Step 2: Create the timeseries API endpoint

`server/api/timeseries.js` — the unified data endpoint for all chart types. Must handle crypto (CoinGecko), stocks (Finnhub/Yahoo), commodities (FRED), indices.

### Step 3: Create chart components

```
src/components/charts/
  SpectreChart.jsx          ← main chart component (Highcharts wrapper)
  ComparisonChart.jsx       ← multi-asset normalized performance
  PeerTable.jsx             ← sector comparison table with sparklines
  SectorHeatmap.jsx         ← heatmap for sector queries
  ChartSkeleton.jsx         ← shimmer loading state
  chartTheme.js             ← Spectre dark theme config
  chartUtils.js             ← normalization, data formatting helpers
```

### Step 4: Wire into Deep Thesis renderer

In `search-engine-page.jsx` (read with offset+limit, do not load the full 37K token file):

```
grep -n "thesis\|deepThesis\|result" search-engine-page.jsx | head -30
```

Find where the thesis result renders. Insert chart component above the written thesis content. Pass `resolvedEntities` and `dossier.events` as props.

### Step 5: Wire into Intelligence Hub articles

Articles include a `chartData` field in their JSON output. The article renderer checks for this field and renders the chart inline at the first data-heavy section.

### Step 6: Add chart query detection to entity resolver

```javascript
// In entityResolver.js — detect chart-specific queries
const CHART_QUERY_PATTERNS = [
  /compare\s+.+\s+(vs|versus|and|with)\s+/i,
  /show\s+me\s+.+\s+(chart|performance|vs)/i,
  /chart\s+of/i,
  /how\s+(has|have)\s+.+\s+performed/i,
  /plot\s+/i,
];

if (CHART_QUERY_PATTERNS.some(p => p.test(query))) {
  resolution.queryType = 'CHART_REQUEST';
  resolution.chartMode = true;
}
```

---

## QUICK TEST CASES

After implementation, verify these work correctly:

| Query | Expected Output |
|-------|----------------|
| "Compare NVDA vs MSFT vs Gold" | Normalized comparison chart, 3 lines, 3M default |
| "Tell me about NeuralAI $NEURAL" | Single asset chart + AI sector peer table |
| "Tell me about Spectre AI" | Self-query handler + AI peer table with $SPECTRE positioned |
| "Top AI tokens this week" | Sector heatmap, AI category |
| "Show me BTC vs ETH since 2026" | Custom comparison, date-gated to Jan 1 2026 |
| "What is DeFi?" | No chart (general knowledge query) |
| "How is the RWA sector performing?" | Narrative basket chart, top RWA tokens |

---

*Spectre AI — Interactive Charts & Comparison Intelligence*
*February 2026*
