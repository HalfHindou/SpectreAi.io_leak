---
paths:
  - "apps/*/src/services/**"
  - "apps/*/src/hooks/useCodexData.js"
  - "apps/*/src/hooks/useWalletBalances.js"
  - "packages/server/**"
  - "apps/*/api/**"
---

# Spectre Data Sources

Where data comes from, how it's fetched, and where to find the code.

---

## A. API Architecture

```
Browser --/api/*--> Vite Proxy --> Express Server (dev, port 3001) --> External APIs
Browser --/api/*--> Vercel Functions (prod) --> External APIs
```

- **Dev**: all `/api` requests proxy to `packages/server/` (Express, port 3001)
- **Prod**: only 4 serverless functions exist: `codex`, `cg-proxy`, `binance-ticker`, `img-proxy`
- **Implication**: features depending on Express-only routes (stocks, news, AI chat, 60+ routes) silently break in production
- Vite proxy config: each app's `vite.config.js` has `server.proxy['/api']` pointing to `localhost:{PORT}`

---

## B. External APIs

| API | Purpose | Auth Key | Endpoint |
|-----|---------|----------|----------|
| **Codex GraphQL** | Token search, details, OHLCV bars, filtering, trades | `CODEX_API_KEY` (header) | `https://graph.codex.io/graphql` |
| **CoinGecko Pro** | Market data, sparklines, global stats, trending, categories | `COINGECKO_API_KEY` (header `x-cg-pro-api-key`) | `https://pro-api.coingecko.com/api/v3/*` |
| **Binance** | Real-time 24h ticker, klines | None (public) | `https://api.binance.com/api/v3/*` |
| **CryptoCompare** | News feed | `CRYPTOCOMPARE_API_KEY` | `https://min-api.cryptocompare.com/data/*` |
| **CryptoPanic** | News with sentiment scoring | `CRYPTOPANIC_API_KEY` | `https://cryptopanic.com/api/v1/*` |
| **Alternative.me** | Fear & Greed Index | None | `https://api.alternative.me/fcp/v1/fear-and-greed` |
| **Yahoo Finance** | Stock data (via server only) | None | Express routes in `packages/server/` |
| **Finnhub** | Stock quotes | `FINNHUB_API_KEY` | `https://finnhub.io/api/v1/*` |
| **Polygon.io** | US market open/close status | `POLYGON_API_KEY` | `https://api.polygon.io/v1/marketstatus/*` |
| **PostHog** | Analytics event capture | `VITE_POSTHOG_KEY` (frontend) | `https://us.i.posthog.com` |

### Binance Special Case
Binance blocks Vercel's IP ranges. Production uses triple fallback:
1. Direct API call (may fail)
2. `allorigins.win` CORS proxy (free, no SLA)
3. Per-symbol individual fetches

Serverless function: `apps/research/api/binance-ticker.js`

---

## C. Frontend Services (where fetch calls live)

| File | Role | API Used |
|------|------|----------|
| `src/services/codexApi.js` | Token search/details/bars/trades | Codex GraphQL via `/api/codex` |
| `src/services/coinGeckoApi.js` | Top coins, sparklines, global stats | CoinGecko via `/api/coingecko` |
| `src/services/binanceApi.js` | Real-time 24h ticker, klines | Binance via `/api/binance-ticker` |
| `src/services/cryptoNewsApi.js` | News feed aggregation | CryptoCompare + CryptoPanic via `/api/news` |
| `src/services/stockApi.js` | Stock quotes, market status | Yahoo/Finnhub via `/api/stocks` |
| `src/services/analytics.js` | PostHog event tracking | PostHog direct (no proxy) |

All services use relative `/api` paths. Vite proxy resolves in dev; Vercel functions in prod.

---

## D. Token Data Pipeline

### Master Hook: `useCodexData.js` (1180 lines, 7 sub-hooks)

| Hook | Data | Primary Source | Fallback |
|------|------|---------------|----------|
| `useTokenSearch` | Search results | Codex `searchTokens` | - |
| `useTokenDetails` | Single token info | Codex `tokenInfo` | CoinGecko `/coins/{id}` |
| `useTopTokens` | Top tokens by market cap | Codex `filterTokens` | CoinGecko `/coins/markets` |
| `useTokenChart` | OHLCV candlestick data | Codex `getBars` | - |
| `useTrendingTokens` | Trending tokens | CoinGecko `/search/trending` | - |
| `useCategoryTokens` | Tokens by category | CoinGecko `/coins/markets?category=` | - |
| `useFilteredTokens` | Filtered by criteria | Codex `filterTokens` | - |

### Data Merging Strategy
CoinGecko provides metadata + sparklines. Binance provides real-time price. When both available, **Binance price wins** (more real-time). Merged in `binanceApi.js` `getTopCoinPrices()`.

### Token Resolution
- `majorTokens.js`: 38 hardcoded major tokens (BTC, ETH, SOL...) with CoinGecko IDs
- `SYMBOL_TO_COINGECKO_ID`: maps symbol -> CoinGecko slug (e.g., `ETH` -> `'ethereum'`)
- `MAJOR_SYMBOLS` Set: determines if token uses CoinGecko (major) or Codex (everything else)
- `isMajorToken(symbol)`: check function
- Server-side `token-registry.js`: maps symbols to addresses, networkIds, Binance pairs

### Token Brand Colors
`src/constants/tokenColors.js` - 200+ tokens with brand hex colors.
Used for: chart lines, badge backgrounds, avatar fallback circles.

---

## E. Logo & Image Sources

### Token Logos
- **Primary**: CoinGecko `coin.image.small` field (returned with market data)
- **URL pattern**: `https://assets.coingecko.com/coins/images/{id}/small/{slug}.png`
- **Fallback**: circle element with token's first letter + brand color from `tokenColors.js`
- **CORS proxy**: `/api/img-proxy?url=` for external images that need proxying

### News Source Icons
- Hardcoded per-source in `NEWS_SOURCES` constant object
- Each source has `name`, `icon` (URL or component), `color`

### App Logos
- `spectre-logo-icon.svg` - compact mark for nav/header
- `spectreLogoGlow.svg` - full logo with ambient glow effect
- Located in `src/assets/` or `public/`

---

## F. Environment Variables

Location: `.env` at monorepo root. Both apps read via `envDir` in `vite.config.js`.

### API Keys (server-side, in `packages/server/`)
```
CODEX_API_KEY          # Primary market data (Codex GraphQL)
COINGECKO_API_KEY      # Market data fallback (CoinGecko Pro)
ANTHROPIC_API_KEY      # Claude for Monarch AI agent
ELEVEN_LABS_API_KEY    # Voice generation (ElevenLabs)
CRYPTOCOMPARE_API_KEY  # News feed
CRYPTOPANIC_API_KEY    # News with sentiment
POLYGON_API_KEY        # US market status
FINNHUB_API_KEY        # Stock quotes
```

### Frontend Keys (exposed to browser - must use `VITE_` prefix)
```
VITE_POSTHOG_KEY       # PostHog analytics capture key
```

**Rule**: only `VITE_*` vars are exposed to frontend code by Vite. All other keys stay server-side.

---

## G. Search Implementation

### Whisper Search (`useWhisperSearch.js`)
- **Type**: AI-powered natural language search
- **Endpoint**: `POST /api/search/whisper`. Dev: Express `routes/search.js` (Groq + Spectre API, real NL parsing). Prod: `vercel.json` rewrites to `market-api?fn=search-api&route=whisper`, but that handler is a deliberate stub returning `{ fallback:true, results:[] }` - NL parsing is dev-only. Regular token search (`route=tokens`) does work in prod.
- **Input**: natural language query (min 3 chars)
- **Output**: `{ interpretation, assetClass, filters, symbols, results[] }`
- **Features**: AbortController for request cancellation

### Header Search Bar (client-side instant search)
- Filters `majorTokens.js` locally for instant results (no API call)
- Codex `searchTokens` for API-backed results (debounced 300ms)
- Ranking: exact match > starts-with > includes, boosted by market cap
- Keyboard nav: arrow keys + Enter to select

---

## H. Chart Rendering

### TradingView Lightweight Charts
- **Package**: `lightweight-charts` (npm)
- **Used in**: both apps for candlestick/line/area charts
- **Data source**: Codex `getBars` (OHLCV) or CoinGecko sparkline arrays
- **Config**: dark theme preset, crosshair, price/time scales
- **File**: `src/components/trading-chart/` (research), component-level in trading app

### Sparkline Charts (custom canvas)
- **Element**: `<canvas>` with 2D context
- **Data**: CoinGecko `sparkline_in_7d.price[]` (168 data points, hourly)
- **Drawing**: `ctx.beginPath()` + `ctx.lineTo()` path, single stroke
- **Color**: `--bull` (positive 7d change) / `--bear` (negative) / neutral gray
- **Used in**: token cards, watchlist items, horizontal bar

### Dominance Chart
- Custom canvas donut/pie chart on Welcome page
- Data: CoinGecko global stats (`/global`) for BTC/ETH/other dominance %

### Heatmap (Welcome page tab)
- CSS grid with colored cells
- Color: interpolated between `--bear` and `--bull` based on % change
- Data: top tokens sorted by market cap, colored by 24h change

---

## I. Currency & Number Formatting

### Rules
- All prices/numbers use `var(--font-mono)` (JetBrains Mono)
- Green (`--bull`) for positive values, red (`--bear`) for negative
- Percentages always with sign: `+3.45%`, `-1.23%`

### Format Patterns
| Range | Format | Example |
|-------|--------|---------|
| >= $1M | Abbreviated | $1.2M, $45.3B |
| >= $1 | 2 decimals | $1,234.56 |
| >= $0.01 | 2-4 decimals | $0.0234 |
| < $0.01 | Significant digits | $0.00001234 |
| Market cap | Abbreviated | $2.1T, $45.3B, $890M |

### Utility
`formatCurrency()` in service utils handles all cases. Always use it instead of manual formatting.

---

## J. Caching Strategy

### Server-side (Express, `packages/server/`)
- In-memory `Map` with TTL per data type
- Token prices: 30s TTL
- Market data: 5min TTL
- News: 10min TTL
- Circuit breaker pattern for unreliable providers (Binance, DexScreener)

### Client-side (frontend services)
- `coinGeckoApi.js`: `priceCache` (30s TTL), `allCoinsCache` (5min TTL)
- `codexApi.js`: no explicit cache (relies on server cache)
- `binanceApi.js`: relies on server-side Binance ticker cache
- React hooks: `useState` + `useEffect` with dependency arrays handle re-fetching

### Two-tier caching
Server cache reduces external API calls. Client cache reduces server calls. TTLs are NOT coordinated - client may show stale data for up to (client TTL + server TTL) duration.

---

## K. Welcome Page Data Hooks

These hooks power specific Welcome page sections (research app only):

| Hook/Function | Tab/Section | Data Source |
|--------------|-------------|-------------|
| `useFearGreedIndex` | Horizontal bar | Alternative.me API |
| `useUSMarketStatus` | Horizontal bar | Polygon.io via server |
| `useEconomicEvents` | Calendar tab | Server-aggregated economic calendar |
| `useLiquidationHeatmap` | Liquidation tab | Server endpoint |
| `useAIBrief` | Brief tab | Anthropic API via server (Claude-generated) |
| `useMindshareData` | Mindshare tab | Server-aggregated social metrics |
| `useSectorData` | Sectors tab | CoinGecko categories |
| `useFlowsData` | Flows tab | Server-aggregated exchange flows |
| `coinGeckoApi.getTopCoins()` | Brief tab, Discovery | CoinGecko `/coins/markets` |
| `coinGeckoApi.getTrending()` | Discovery panel | CoinGecko `/search/trending` |
| `binanceApi.getTopCoinPrices()` | Horizontal bar, cards | Binance 24h ticker |
