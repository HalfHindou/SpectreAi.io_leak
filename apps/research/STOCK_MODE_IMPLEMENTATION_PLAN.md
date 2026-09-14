# Stock Market Mode Implementation Plan

## Overview
Transform Spectre Vibe from a crypto-only platform to a dual-mode platform supporting both **Crypto** and **Stocks** markets. When the user toggles to "Stocks" mode, ALL data throughout the app switches to stock market data.

---

## Phase 1: Foundation (API Services & Hooks)

### 1.1 Create Stock API Service
**File:** `/src/services/stockApi.js`

Use **Finnhub** (free tier: 60 calls/min) or **Yahoo Finance** (no key needed) for:
- Real-time stock quotes
- Historical OHLC data for charts
- Stock search by ticker/company name
- Company fundamentals (P/E, EPS, market cap, sector)
- Top gainers/losers

**Functions to implement:**
```javascript
getStockQuote(symbol)           // Real-time price
getStockQuotesBatch(symbols)    // Multiple stocks at once
searchStocks(query)             // Search by ticker or company name
getStockCandles(symbol, resolution, from, to)  // OHLC for charts
getCompanyProfile(symbol)       // Company info, sector, description
getMarketMovers()               // Top gainers, losers, most active
getMarketStatus()               // Market open/closed status
```

### 1.2 Create Stock News Service
**File:** `/src/services/stockNewsApi.js`

Use **Finnhub** news endpoint or **NewsAPI** for financial news:
```javascript
getStockNews(symbol)            // News for specific stock
getMarketNews(category)         // General market news
getTrendingNews()               // Top financial headlines
```

### 1.3 Create Stock Data Hooks
**Files:**
- `/src/hooks/useStockPrices.js` - Real-time stock prices with polling
- `/src/hooks/useStockSearch.js` - Stock search with debouncing
- `/src/hooks/useStockNews.js` - Stock news fetching
- `/src/hooks/useStockTrending.js` - Market movers (gainers/losers)

### 1.4 Create Stock Constants
**File:** `/src/constants/stockData.js`
```javascript
// Top stocks to show by default (like TOP_COINS)
export const TOP_STOCKS = [
  { symbol: 'SPY', name: 'S&P 500 ETF', sector: 'Index' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', sector: 'Index' },
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Automotive' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Technology' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financial' },
  { symbol: 'V', name: 'Visa Inc.', sector: 'Financial' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
]

export const STOCK_SECTORS = [
  'Technology', 'Healthcare', 'Financial', 'Consumer',
  'Industrial', 'Energy', 'Materials', 'Utilities',
  'Real Estate', 'Communication'
]

export const STOCK_LOGOS = {
  'AAPL': 'https://logo.clearbit.com/apple.com',
  'MSFT': 'https://logo.clearbit.com/microsoft.com',
  // ... etc
}
```

---

## Phase 2: Core Component Updates

### 2.1 WelcomePage.jsx - Main Dashboard
**Changes needed:**

| Section | Crypto Mode | Stock Mode |
|---------|-------------|------------|
| Welcome Widget | BTC, ETH, SOL prices | SPY, QQQ, AAPL prices |
| Top Coins | TOP_COINS list | TOP_STOCKS list |
| Trending | Trending tokens | Top gainers/losers |
| News | Crypto news | Financial news |
| On-Chain | DEX tokens, volume | N/A or Sector performance |
| Fear & Greed | Crypto Fear & Greed | VIX / Market Sentiment |

**Implementation approach:**
```jsx
// In WelcomePage.jsx
const isStocks = marketMode === 'stocks'

// Use different data sources based on mode
const { prices } = isStocks
  ? useStockPrices(TOP_STOCK_SYMBOLS)
  : useBinanceTopCoinPrices(topCoinSymbols)

const { news } = isStocks
  ? useStockNews()
  : useCryptoNews()

const { trending } = isStocks
  ? useStockTrending()
  : useTrendingTokens()
```

### 2.2 Header.jsx - Search
**Changes needed:**
- Search placeholder: "Search tokens..." → "Search stocks..."
- Search results: Show ticker symbols + company names
- Remove "Contract address" display for stocks

### 2.3 TradingChart.jsx - Charts
**Changes needed:**
- Data source: Switch between Binance/Codex → Stock OHLC API
- The chart rendering itself is the same (OHLC structure is compatible)

### 2.4 LeftPanel.jsx - Watchlist
**Changes needed:**
- Watchlist items: Token addresses → Stock tickers
- Price updates: Crypto APIs → Stock APIs
- Search hints: Token names → Stock tickers

### 2.5 AI Command Center (MonarchChat)
**Changes needed:**
- Context awareness: Know if user is asking about stocks vs crypto
- Data fetching: Pull stock data when in stock mode
- Responses: Reference stock terminology (P/E, earnings, dividends)

---

## Phase 3: Secondary Components

### 3.1 ResearchZoneLite.jsx
- Stock research view with fundamentals
- Earnings calendar
- Analyst ratings

### 3.2 CategoriesPage.jsx
- Crypto categories → Stock sectors
- (Technology, Healthcare, Financial, etc.)

### 3.3 HeatmapsPage.jsx
- Sector-based heatmap (like finviz.com)
- Market cap treemap

### 3.4 WatchlistsPage.jsx
- Separate crypto vs stock watchlists
- OR unified watchlist with asset type indicator

### 3.5 MarketAnalyticsPage.jsx
- Stock market analytics
- Sector rotation
- Market breadth indicators

---

## Phase 4: Data Structure Compatibility

### Unified Asset Interface
Create a common interface that works for both crypto and stocks:

```typescript
interface Asset {
  symbol: string        // 'BTC' or 'AAPL'
  name: string          // 'Bitcoin' or 'Apple Inc.'
  type: 'crypto' | 'stock'
  price: number
  change24h: number     // Percent change
  marketCap?: number
  volume?: number

  // Crypto-specific
  address?: string
  networkId?: number
  liquidity?: number

  // Stock-specific
  sector?: string
  exchange?: string
  pe?: number
  eps?: number
  dividendYield?: number
}
```

---

## Phase 5: UI/UX Considerations

### 5.1 Visual Indicators
- Different accent colors for stocks mode (optional)
- Clear "STOCKS" label in header when in stock mode
- Different empty state messages

### 5.2 Text Changes
| Location | Crypto | Stocks |
|----------|--------|--------|
| Search placeholder | "Search tokens, contracts..." | "Search stocks, tickers..." |
| Watchlist empty | "Add tokens to watchlist" | "Add stocks to watchlist" |
| Chart title | "Token Chart" | "Stock Chart" |
| News section | "Crypto News" | "Market News" |

### 5.3 Market Hours Awareness
- Show market open/closed status prominently
- Indicate if prices are delayed (after hours)
- Show next market open time when closed

---

## Implementation Order (Priority)

### Week 1-2: Foundation
1. [ ] Create `/src/services/stockApi.js` with Finnhub/Yahoo
2. [ ] Create `/src/hooks/useStockPrices.js`
3. [ ] Create `/src/constants/stockData.js`
4. [ ] Test API integration standalone

### Week 3-4: WelcomePage
5. [ ] Update WelcomePage welcome widget for stocks
6. [ ] Update Top Coins → Top Stocks section
7. [ ] Update trending section
8. [ ] Update news section

### Week 5-6: Core Features
9. [ ] Update Header search for stocks
10. [ ] Update TradingChart for stock OHLC
11. [ ] Update LeftPanel watchlist

### Week 7-8: Secondary Features
12. [ ] Update AI Command Center context
13. [ ] Update ResearchZoneLite
14. [ ] Update CategoriesPage (sectors)

### Week 9-10: Polish
15. [ ] Update remaining pages
16. [ ] Add market hours indicator
17. [ ] Test all flows end-to-end
18. [ ] Performance optimization

---

## API Keys Required

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| **Finnhub** | Stock quotes, fundamentals, news | 60 calls/min |
| **Alpha Vantage** | Backup stock data | 5 calls/min |
| **NewsAPI** | Financial news (optional) | 100 calls/day |
| **Clearbit** | Company logos | Free for logos |

---

## Risk Mitigation

1. **Rate Limiting**: Implement caching and request queuing
2. **Market Hours**: Clearly indicate when data is stale
3. **API Failures**: Graceful fallbacks, show cached data
4. **Data Consistency**: Ensure mode switch doesn't mix data

---

## Files Summary

### New Files to Create (8)
- `/src/services/stockApi.js`
- `/src/services/stockNewsApi.js`
- `/src/hooks/useStockPrices.js`
- `/src/hooks/useStockSearch.js`
- `/src/hooks/useStockNews.js`
- `/src/hooks/useStockTrending.js`
- `/src/constants/stockData.js`
- `/src/constants/stockLogos.js`

### Files to Modify (15+)
- `/src/components/WelcomePage.jsx` (major)
- `/src/components/Header.jsx` (major)
- `/src/components/TradingChart.jsx` (medium)
- `/src/components/LeftPanel.jsx` (medium)
- `/src/components/ResearchZoneLite.jsx` (medium)
- `/src/components/CategoriesPage.jsx` (medium)
- `/src/components/WatchlistsPage.jsx` (medium)
- `/src/components/HeatmapsPage.jsx` (low)
- `/src/components/MarketAnalyticsPage.jsx` (low)
- `/src/components/TokenBanner.jsx` (low)
- `/src/components/TokenTicker.jsx` (low)
- `/src/hooks/useWatchlistPrices.js` (medium)
- And others...

---

## Next Steps

1. **Decide on primary stock API** (Finnhub recommended)
2. **Get API key** and test endpoints
3. **Start with Phase 1** - create stockApi.js service
4. **Iterate** through phases

Ready to begin implementation?
