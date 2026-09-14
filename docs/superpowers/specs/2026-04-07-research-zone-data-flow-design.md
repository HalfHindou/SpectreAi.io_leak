# Research Zone Unified Data Flow - Design Spec

> Rebuild the data layer for the research-zone page so header, chart, and right sidebar share a single canonical price from one coordinated service. Eliminate all mock data fallbacks. Optimize request count.

## Problem Statement

The research-zone page has 3 sections (header, chart, right sidebar) that each fetch price data independently from different sources at different intervals:

- **Header**: Binance ticker, 15s poll → `liveTickerPrice`
- **Chart**: Codex bars / Binance klines, 30s TTL → last candle close
- **Sidebar**: CoinGecko markets, 1min poll → `coinMarketData.price`

Result: user sees up to 3 different prices simultaneously (up to 45s drift). Additionally, the page relies heavily on hardcoded mock data as fallbacks (`MOCK_TOKEN_DATA`, `MOCK_CATEGORIES`, `MOCK_TWEETS`, etc.), which masks API failures and shows stale/incorrect data.

Token identity is fragmented across 3 mapping files: `majorTokens.js`, `mock-data.js` (`CHART_TOKEN_ADDRESSES`), and server `token-registry.js`.

## Scope

- **In scope**: research-zone page data flow (header, chart, sidebar), dynamic token resolution via server API, mock data elimination within `apps/research/src/pages/research-zone/`
- **Out of scope**: other pages, TradingChart internals, news/sentiment/tweets fetching (stays in research-zone-lite.jsx)

---

## Architecture

### 1. Token Resolution via Server API (no hardcoded client registry)

No hardcoded token mapping on the client. All token identity comes from the server.

**New server endpoint: `GET /api/token/resolve?symbol=BTC`**

The server already has `token-registry.js` with 50+ tokens mapped to CoinGecko IDs, Binance pairs, and contract addresses. This endpoint exposes it:

```
GET /api/token/resolve?symbol=BTC
→ {
    symbol: 'BTC',
    cgId: 'bitcoin',
    binancePair: 'BTCUSDT',
    name: 'Bitcoin',
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    networkId: 1,
  }
```

**Server resolution chain:**
1. Check `token-registry.js` (instant, covers 50+ major tokens)
2. If not found: CoinGecko `/coins/list` search by symbol
3. If not found: Codex `filterTokens` search by symbol
4. Returns the best match with all IDs populated, or `{ symbol, name: symbol }` with nulls for unknown tokens

**Server caching:** Response cached 1 hour (token identity rarely changes). Server-side implementation is a thin wrapper around existing `getTokenInfo()` + `findSymbolByAddress()` helpers in `token-registry.js`.

**Client caching:** The hook caches resolved tokens in a module-level `Map` (session lifetime). Each symbol is resolved once per browser session, never re-fetched.

```
Symbol "BTC" entered
  → Check session cache → miss
  → GET /api/token/resolve?symbol=BTC
  → Cache result in Map
  → All subsequent fetches use resolved { cgId, binancePair, address, networkId }
  
Symbol "BTC" entered again (e.g. user navigates back)
  → Check session cache → hit (instant, no API call)
```

**Serverless function:** Needs a matching `apps/research/api/token-resolve.js` for production (dev uses Express route).

**Other pages are unaffected:** `majorTokens.js` keeps `MAJOR_SYMBOLS`, `isMajorToken()`, `SYMBOL_TO_COINGECKO_ID` for pages outside research-zone. Those are out of scope for this change.

### 2. Unified Hook (`apps/research/src/pages/research-zone/hooks/use-research-zone-data.js`)

Single hook replacing ~400 lines of useState/useEffect in research-zone-lite.jsx.

**Signature:**
```js
const data = useResearchZoneData(symbol, { isStock, marketMode })
```

**Return shape:**
```js
{
  // Token identity (resolved once per symbol change)
  token: {
    symbol: 'BTC',
    name: 'Bitcoin',
    cgId: 'bitcoin',
    binancePair: 'BTCUSDT',
    address: '0x2260...',
    networkId: 1,
    logo: 'https://assets.coingecko.com/...',  // from CoinGecko API response
    rank: 1,
    categories: ['Layer 1', 'Proof of Work'],
  },

  // SINGLE CANONICAL PRICE - shared by header, chart, sidebar
  price: {
    current: 68389.45,       // Binance ticker (primary) or CoinGecko (fallback)
    change24h: -1.74,
    high24h: 69500.00,
    low24h: 67200.00,
    volume24h: 42_280_000_000,
    source: 'binance',       // 'binance' | 'coingecko' | 'codex'
  },

  // Market metadata (CoinGecko, 1min poll - mcap/supply/ath, NOT price)
  market: {
    mcap: 1_370_000_000_000,
    fdv: 1_370_000_000_000,
    circulatingSupply: 20_010_000,
    totalSupply: 21_000_000,
    volMcapPct: 3.1,
    ath: 73750,
    athDate: '2024-03-14',
    athChangePct: -7.3,
    atl: 67.81,
    atlDate: '2013-07-06',
    atlChangePct: 100800,
  },

  // Performance (from CoinGecko market data, 1min TTL)
  performance: {
    change1h: -0.3,
    change7d: -5.2,
    change30d: -12.1,
    change1y: 48.5,
    sparkline7d: [71000, 70500, ...],  // 168 hourly points
  },

  // On-chain data (Codex, 30s TTL)
  onchain: {
    holders: 177092,
    liquidity: 850_000_000,
    txnCount24: 456789,
    age: 5400,  // days since creation
  },

  // About (CoinGecko coin details, 5min TTL - fetched once per symbol)
  about: {
    description: 'Bitcoin is a decentralized...',
    links: { website: '...', twitter: '...', github: '...' },
    categories: ['Layer 1', 'Proof of Work'],
  },

  // Chart token info (passed to TradingChart component)
  chartToken: {
    symbol: 'BTC',
    address: '0x2260...',
    networkId: 1,
  },

  // Trending tokens (CoinGecko, 5min TTL - fetched once)
  trending: [
    { id: 'ethereum', symbol: 'ETH', image: '...', current_price: 2580, price_change_percentage_24h: -3.4 },
    // ...
  ],

  // Per-section loading states (shimmer skeletons, not mock data)
  loading: {
    token: false,    // resolving token identity
    price: false,    // Binance ticker
    market: true,    // CoinGecko metadata
    onchain: true,   // Codex on-chain
    about: false,    // CoinGecko details
  },
}
```

### 3. Price Consistency Mechanism

**Rule: `data.price.current` is the ONLY price value. All 3 sections read from it.**

**Priority chain:**
1. Binance 24h ticker (15s poll) - primary for all major tokens
2. CoinGecko market data price - fallback if Binance has no pair for this token
3. Codex token price - last resort for DEX-only tokens

**How each section uses it:**
- **Header** (`RzHeroBanner`): displays `data.price.current` and `data.price.change24h`
- **Chart** (`RzChartSection`): receives `livePrice={data.price.current}` as overlay on OHLCV bars
- **Sidebar** (`RzProSidebar`): displays `data.price.current` in the price card, uses `data.market.*` for mcap/fdv/supply

**Price does NOT come from CoinGecko market metadata poll.** The `market` object contains mcap, fdv, supply, ath/atl - but NOT price. This prevents the 45s drift problem.

### 4. Data Fetch Lifecycle

```
SYMBOL CHANGES → "BTC"
│
├─ 1. RESOLVE TOKEN (instant if in TOKEN_REGISTRY, async Codex search if unknown)
│     Sets loading.token = true until resolved
│     On resolve: sets token.*, chartToken.*
│
├─ 2. PARALLEL INITIAL FETCH (all fire simultaneously after token resolved):
│     ├─ Binance ticker → price.*             (loading.price)
│     ├─ CoinGecko market data → market.*     (loading.market)
│     │   also extracts: token.logo, token.rank, token.categories, performance.*
│     ├─ CoinGecko coin details → about.*     (loading.about)
│     ├─ Codex on-chain → onchain.*           (loading.onchain)
│     └─ CoinGecko trending → trending[]      (no loading state, background)
│
├─ 3. POLLING (via useAdaptivePolling):
│     ├─ Binance ticker → every 15s           (updates price.*)
│     ├─ CoinGecko market → every 60s         (updates market.*, performance.*)
│     └─ Codex on-chain → every 30s           (updates onchain.*)
│     Note: about + trending do NOT poll (fetched once per symbol change)
│
└─ 4. VISIBILITY GUARDS:
      ├─ Tab hidden < 5min → intervals × 4
      ├─ Tab hidden > 5min → polling stops
      └─ Tab visible → immediate fetch + resume normal rate
```

**Request count per symbol change:**

| Request | Current | New | Change |
|---------|---------|-----|--------|
| Binance ticker | 1 | 1 | same |
| CoinGecko market data | 1 | 1 | same |
| CoinGecko coin details | 1 | 1 | same |
| Codex on-chain | 1 | 1 | same |
| CoinGecko trending | 1 | 1 | same |
| `useChartData` 48 bars (price hack) | 1 | 0 | **removed** |
| Duplicate `getCoinMarketDataBySymbol` | 1 | 0 | **removed** |
| **Total** | **7** | **5** | **-2** |

### 5. Mock Data Elimination (research-zone only)

Every component in `apps/research/src/pages/research-zone/` that imports mock data gets updated:

| File | Mock imports removed | Replacement |
|------|---------------------|-------------|
| `research-zone-lite.jsx` | `MOCK_TOKEN_DATA`, `MOCK_CATEGORIES`, `MOCK_MARKETS`, `MOCK_TWEETS`, `MOCK_AGENT_SIGNALS`, `MOCK_PREDICTION_MARKETS`, `TOKEN_NAMES`, `CHART_TOKEN_ADDRESSES`, `RZ_TOKEN_LOGOS` | `useResearchZoneData` hook for all data (token identity resolved via server API) |
| `rz-hero-banner.jsx` | `MOCK_CATEGORIES` | `aboutDetails.categories` from hook, falls back to `tokenName` |
| `rz-pro-sidebar.jsx` | `PRO_MOCK_CATEGORIES`, `getDefaultMockData`, `RZ_TOKEN_LOGOS` | Real data from hook props. Logo from `data.token.logo`. Empty `[]` when no categories. |
| `rz-overview-tab.jsx` | `MOCK_TOKEN_DATA`, `MOCK_PREDICTION_MARKETS`, `MOCK_FUNDAMENTALS_GRADES` | Real Polymarket data (prop). Fundamentals section shows empty state or hides when no data. |
| `rz-feed-panel.jsx` | `MOCK_AGENT_SIGNALS` | Real Spectre API data. "No signals" empty state when unavailable. |
| `rz-markets-section.jsx` | `MOCK_PREDICTION_MARKETS` | Real Polymarket data (prop). Empty state when no markets. |
| `rz-token-panel.jsx` | `MOCK_TOKEN_DATA`, `MOCK_CATEGORIES` | Real data from hook via props. Shimmer skeletons while loading. |
| `rz-technicals-tab.jsx` | `MOCK_TECHNICAL_INDICATORS` | Real technical data or empty state. |
| `rz-token-popup.jsx` | `getHistorySparkline`, `getTokenPredictions` | Real sparkline from CoinGecko `sparkline_in_7d`. |
| `research-zone-pro.jsx` | `getDefaultMockData` | Real data from hook via props. |

**`data/mock-data.js` transformation:**
- Rename to `data/rz-constants.js`
- Keep ONLY: `DEFAULT_SYMBOL` ('BTC'), `MARKET_FILTERS`, `formatChange()`, `formatNewsTime()`
- Delete ALL `MOCK_*` exports, `PRO_MOCK_*` exports, `getDefaultMockData()`, `TOKEN_NAMES`, `CHART_TOKEN_ADDRESSES`, `RZ_TOKEN_LOGOS`, `getHistorySparkline`, `getTokenPredictions`

**Empty state pattern:** When API returns null/empty, components show shimmer skeletons (loading=true) or clean empty states (loading=false, data=null). Never fake data.

### 6. Integration: research-zone-lite.jsx Changes

**Before** (~900 lines, ~400 of data fetching):
```jsx
const ResearchZoneLite = ({ initialSymbol, ... }) => {
  // 15+ useState for data
  const [coinMarketData, setCoinMarketData] = useState(null)
  const [liveTickerPrice, setLiveTickerPrice] = useState(null)
  const [aboutDetails, setAboutDetails] = useState(null)
  const [onChainData, setOnChainData] = useState(null)
  const [trendingTokens, setTrendingTokens] = useState([])
  const [activeTokenInfo, setActiveTokenInfo] = useState(null)
  // ... 10+ useEffect blocks for fetching, polling, fallbacks

  // 100-line tokenData useMemo merging mock + CoinGecko + Binance + Codex
  const tokenData = useMemo(() => {
    const data = coinMarketData || MOCK_TOKEN_DATA[symbol] || { ... }
    if (liveTickerPrice) data.price = liveTickerPrice
    // ... 80 more lines of fallback logic
  }, [12 deps])
}
```

**After** (~500 lines, pure rendering):
```jsx
const ResearchZoneLite = ({ initialSymbol, ... }) => {
  const [symbol, setSymbol] = useState(...)
  const data = useResearchZoneData(symbol, { isStock, marketMode })

  // News, prediction markets, Spectre sentiment/tweets STAY HERE
  // (page-specific, not shared across header/chart/sidebar)
  const [newsItems, setNewsItems] = useState([])
  const [predictionMarkets, setPredictionMarkets] = useState([])
  // ... news/sentiment fetching effects stay

  // Build tokenData shape expected by child components (thin adapter)
  const tokenData = useMemo(() => ({
    price: data.price.current,
    change24h: data.price.change24h,
    high24h: data.price.high24h,
    low24h: data.price.low24h,
    volume24h: data.price.volume24h,
    rank: data.token.rank,
    ...data.market,
    // Rename fields to match existing component expectations
    volume: data.price.volume24h,
    marketCap: data.market.mcap,
  }), [data.price, data.token.rank, data.market])

  return (
    <>
      <RzHeroBanner
        symbol={symbol}
        tokenName={data.token.name}
        tokenData={tokenData}
        tokenLogo={data.token.logo}
        aboutDetails={data.about}
        loading={data.loading.token || data.loading.price}
      />
      <RzChartSection
        trendingTokens={data.trending}
        chartToken={data.chartToken}
        livePrice={data.price.current}
      />
      <RzProSidebar
        sym={symbol}
        td={tokenData}
        performanceData={data.performance}
        onchainData={data.onchain}
        categories={data.about?.categories || []}
        tokenLogo={data.token.logo}
      />
    </>
  )
}
```

### 7. What Stays Unchanged

- **Server endpoints**: Existing `/api/bars`, `/api/coingecko/*`, `/api/binance-ticker`, `/api/codex` stay unchanged. One new endpoint added: `/api/token/resolve` (thin wrapper around existing `token-registry.js`).
- **TradingChart component**: Still receives `chartToken` and `livePrice` props, still calls `/api/bars` internally for OHLCV data. No changes needed.
- **Existing service files**: `binanceApi.js`, `coinGeckoApi.js`, `codexApi.js` stay as-is. The hook calls them directly.
- **`rzDataService.js`**: Gets deleted. Its cache/dedup infrastructure is absorbed into the hook (same `_cache`/`_inflight`/`_deduped` pattern).
- **Other pages**: No changes to any page outside `apps/research/src/pages/research-zone/`.
- **`majorTokens.js`**: Untouched. Keeps `MAJOR_SYMBOLS`, `isMajorToken()`, `SYMBOL_TO_COINGECKO_ID` for other pages.

### 8. Stock Mode

When `isStock === true`, the hook returns stock-specific data:
- `price.*` from `getStockQuote()` instead of Binance
- `market.*` from stock fundamentals (market cap, PE, sector)
- `onchain` returns `null` (no on-chain data for stocks)
- `trending` returns stock movers from `getStockQuotes(STOCK_TRENDING_SYMBOLS)`
- `about` returns company profile from `getCompanyProfile()`

The hook handles the crypto/stock split internally. Components don't need to know.

---

## File Changes Summary

| Action | File | Description |
|--------|------|-------------|
| CREATE | `packages/server/` route for `/api/token/resolve` | Server endpoint for dynamic token identity resolution |
| CREATE | `apps/research/api/token-resolve.js` | Serverless function for production |
| CREATE | `src/pages/research-zone/hooks/use-research-zone-data.js` | Unified data hook |
| RENAME | `data/mock-data.js` → `data/rz-constants.js` | Keep only `DEFAULT_SYMBOL`, `MARKET_FILTERS`, utilities |
| DELETE | `src/services/rzDataService.js` | Replaced by hook internals |
| MODIFY | `research-zone-lite.jsx` | Remove ~400 lines of data fetching, use hook |
| MODIFY | `rz-hero-banner.jsx` | Remove `MOCK_CATEGORIES` import |
| MODIFY | `rz-pro-sidebar.jsx` | Remove mock imports, use real data props |
| MODIFY | `rz-overview-tab.jsx` | Remove mock imports, empty states |
| MODIFY | `rz-feed-panel.jsx` | Remove `MOCK_AGENT_SIGNALS` |
| MODIFY | `rz-markets-section.jsx` | Remove `MOCK_PREDICTION_MARKETS` |
| MODIFY | `rz-token-panel.jsx` | Remove mock imports |
| MODIFY | `rz-technicals-tab.jsx` | Remove `MOCK_TECHNICAL_INDICATORS` |
| MODIFY | `rz-token-popup.jsx` | Remove mock helpers |
| MODIFY | `research-zone-pro.jsx` | Remove `getDefaultMockData` |
