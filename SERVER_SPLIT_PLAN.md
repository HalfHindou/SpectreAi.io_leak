# Server Split Plan — packages/server/index.js

**Current:** 13,592 lines, ~130 inline routes, 25 already-extracted route modules.
**Target:** index.js under 1,500 lines (startup, middleware, shared infra, route mounting).

---

## Architecture: What stays in index.js

These are shared infrastructure that ALL routes depend on. They STAY:

| Section | Lines | What |
|---------|-------|------|
| Imports + config | 1-65 | Express, env vars, API base URLs |
| CoinGecko queue | 66-101 | `cgFetch`, serial rate queue |
| CMC queue | 102-152 | `cmcFetch`, serial rate queue |
| `fetchCoinGeckoPrice` | 153-206 | Shared CG price fetcher |
| Rate limiter factory | 207-240 | `createRateLimiter`, aiRateLimit, searchRateLimit, audioRateLimit |
| Cache infrastructure | 278-365 | Global `cache` object (30+ Maps), `getCached`/`setCached`/`evictIfFull` |
| Codex GraphQL client | 458-571 | `executeCodexQuery`, CODEX_API_KEY |
| PNG pixel decoder | 572-770 | `decodePngPixels`, `extractDominantColor` (used by token-color) |
| CORS, JSON middleware | 192-206 | Express middleware |
| Route mounting | 13218-13358 | All `app.use()` calls |
| Server startup | 13400-13592 | `app.listen`, health, OG images, notifications |

**~1,200 lines of core infra stays.** Everything else moves.

---

## Extraction Plan: 10 new route modules

### 1. `routes/tokens.js` — Token data (Codex + CoinGecko)
**Lines:** 769-900, 2129-2145, 3725-4714, 4880-5295, 5296-5838
**Routes:**
- GET /api/token-color
- GET /api/token-tax
- GET /api/token/market-profile
- GET /api/token/resolve
- GET /api/token/details
- GET /api/tokens/search
- GET /api/networks
- GET /api/tokens/prices
- POST /api/tokens/batch-prices
- GET /api/tokens/price/:symbol
- GET /api/tokens/trending
- GET /api/tokens/:address
- GET /api/tokens/:address/pairs
- GET /api/token-exchanges
- GET /api/token-markets

**Dependencies:** `cache.prices`, `cache.details`, `cache.trending`, `executeCodexQuery`, `cgFetch`, `decodePngPixels`, `extractDominantColor`, `getCached`/`setCached`/`evictIfFull`
**Estimated lines:** ~2,800
**Risk:** MEDIUM — heavy use of shared cache + Codex client. Need to export cache helpers.

### 2. `routes/tradingview.js` — TradingView UDF data feed
**Lines:** 5393-5877, 5878-6500
**Routes:**
- GET /api/bars
- GET /api/tradingview/symbol
- GET /api/tradingview/search
- GET /api/tradingview/udf/config
- GET /api/tradingview/udf/time
- GET /api/tradingview/udf/symbols
- GET /api/tradingview/udf/search
- GET /api/tradingview/udf/history
- GET /api/trades/:pairAddress
- GET /api/token/trades

**Dependencies:** `executeCodexQuery`, `cgFetch`, `getCached`/`setCached`
**Estimated lines:** ~1,100
**Risk:** MEDIUM — UDF history is the most critical chart data endpoint

### 3. `routes/market.js` — Market overview data
**Lines:** 2876-2934, 6777-7300
**Routes:**
- GET /api/market/stats
- GET /api/market/funding
- GET /api/market/oi
- GET /api/market/ls-ratio
- GET /api/market/global
- GET /api/market/tickers
- GET /api/market/ai-analyse
- GET /api/market/liquidations
- GET /api/market/ai-market-text
- GET /api/market/sectors
- GET /api/market/sectors/top-movers
- GET /api/market/sectors/ai-analysis
- GET /api/market/mindshare
- GET /api/market/dominance-history
- GET /api/market/fear-greed

**Dependencies:** Binance API, CG API, `RESEARCH_API_BASE`, `CHARTS_PROXY_BASE`, liquidation WebSocket buffer
**Estimated lines:** ~800
**Risk:** LOW — mostly independent fetch-and-cache

### 4. `routes/stocks.js` — Stock market data
**Lines:** 8098-9264, 10372-10407
**Routes:**
- GET /api/stocks/quotes
- GET /api/stocks/quote/:sym
- GET /api/stocks/search
- GET /api/stocks/candles
- GET /api/stocks/movers
- GET /api/stocks/indices
- GET /api/stocks/news/market
- GET /api/stocks/news/:symbol
- GET /api/stocks/sectors
- GET /api/stocks/fundamentals/:symbol
- GET /api/stocks/analysts/:symbol
- GET /api/stocks/earnings-calendar
- GET /api/stocks/market-status
- GET /api/stocks/ai-analysis/:symbol
- GET /api/stocks/sparkline/:symbol

**Dependencies:** `cache.stockQuotes`, `cache.stockCandles`, etc., Yahoo Finance, Finnhub, Polygon
**Estimated lines:** ~1,200
**Risk:** LOW — self-contained, uses own cache maps

### 5. `routes/coingecko.js` — CoinGecko proxy
**Lines:** 2728-3403
**Routes:**
- GET /api/coingecko/heatmap
- GET /api/coingecko/prices
- GET /api/coingecko/top
- GET /api/coingecko/ohlcv/:coinId
- GET /api/coingecko/coin/:coinId
- GET /api/coingecko/*

**Dependencies:** `cgFetch`, `getCached`/`setCached`
**Estimated lines:** ~700
**Risk:** LOW — pure proxy

### 6. `routes/derivatives.js` — Derivatives + CoinGlass
**Lines:** 2225-2417, 2258-2400
**Routes:**
- GET /api/binance/ticker/24hr
- GET /api/binance-ticker
- GET /api/derivatives/:exchange/*
- GET /api/coinglass/coins-markets
- GET /api/coinglass/total-oi
- GET /api/coinglass/total-liquidations

**Dependencies:** `DERIVATIVES_TARGETS`, `derivativesCache`, `coinglassCache`, `COINGLASS_API_KEY`
**Estimated lines:** ~400
**Risk:** LOW — self-contained proxies

### 7. `routes/polymarket.js` — Prediction markets
**Lines:** 2935-3240
**Routes:**
- GET /api/polymarket/events
- GET /api/polymarket/event/:slug
- GET /api/polymarket/prices-history
- GET /api/polymarket/analysis
- GET /api/polymarket/orderbook
- GET /api/polymarket/trades

**Dependencies:** `cache.polymarketEvent`, `cache.polymarketPrices`, `cache.polymarketAnalysis`, `getCached`/`setCached`, Anthropic API (for analysis)
**Estimated lines:** ~300
**Risk:** LOW

### 8. `routes/dexscreener.js` — DexScreener proxy
**Lines:** 3404-3724
**Routes:**
- GET /api/dexscreener-watchlist/:id
- GET /api/dexscreener-pair/:chain/:address

**Dependencies:** `DEXSCREENER_CHAIN_TO_NETWORK` mapping
**Estimated lines:** ~320
**Risk:** LOW — pure proxy

### 9. `routes/brief.js` — AI brief generation + voice
**Lines:** 11453-12883
**Routes:**
- POST /api/brief/generate
- POST /api/brief/breaking-synthesis
- GET /api/brief/voices
- POST /api/voice/speak
- POST /api/brief/audio

**Dependencies:** Anthropic API, ElevenLabs API, `ELEVENLABS_VOICES`, `audioRateLimit`
**Estimated lines:** ~1,400
**Risk:** LOW — self-contained AI pipeline

### 10. `routes/misc.js` — Utility endpoints
**Lines:** 493-533, 933-1160, 1184-1203, 2146-2165, 9393-9537, 10155-10407
**Routes:**
- GET / (health)
- GET /api/health
- GET /api/health/sources
- GET /api/img-proxy
- GET /api/env-check
- GET /api/project/crawl
- GET /api/project/latest-tweet
- GET /api/tweets/official
- GET /api/tweets/search
- GET /api/weather
- GET /api/ambient
- GET /api/cryptopanic
- GET /api/search/tokens
- GET /api/ext/resolve
- GET /api/ext/x-activity
- GET /api/ext/market-state
- GET /api/ext/prices
- GET /api/ext/sparkline
- GET /api/ext/health
- GET /api/solana-balance

**Dependencies:** Various external APIs, minimal cache usage
**Estimated lines:** ~1,500
**Risk:** LOW — grab bag of independent utilities

---

## Shared Module: `routes/_helpers.js`

Export from index.js (or a new shared file) for route modules to import:

```js
module.exports = {
  cache,              // the global cache object with 30+ Maps
  getCached,          // cache read helper
  setCached,          // cache write helper
  evictIfFull,        // cache eviction
  cgFetch,            // CoinGecko rate-limited fetch
  cmcFetch,           // CoinMarketCap rate-limited fetch
  executeCodexQuery,  // Codex GraphQL client
  fetchCoinGeckoPrice,// single price lookup
  decodePngPixels,    // PNG pixel decoder (for token-color)
  extractDominantColor,// color extraction
  CODEX_API_KEY,
  COINGECKO_API_KEY,
  COINGECKO_BASE,
  CHARTS_PROXY_BASE,
  RESEARCH_API_BASE,
  X_DASH_BASE,
  X_DASH_API_KEY,
}
```

---

## Execution Order (safest first)

| Order | Module | Lines Out | Risk |
|-------|--------|-----------|------|
| 1 | `routes/misc.js` | ~1,500 | LOW — independent utilities |
| 2 | `routes/polymarket.js` | ~300 | LOW — self-contained |
| 3 | `routes/dexscreener.js` | ~320 | LOW — pure proxy |
| 4 | `routes/derivatives.js` | ~400 | LOW — self-contained proxies |
| 5 | `routes/coingecko.js` | ~700 | LOW — pure proxy |
| 6 | `routes/stocks.js` | ~1,200 | LOW — uses own cache maps |
| 7 | `routes/market.js` | ~800 | LOW — mostly fetch-and-cache |
| 8 | `routes/brief.js` | ~1,400 | LOW — self-contained AI pipeline |
| 9 | `routes/tradingview.js` | ~1,100 | MEDIUM — critical chart data |
| 10 | `routes/tokens.js` | ~2,800 | MEDIUM — heavy shared cache use |

**First step:** Create `routes/_helpers.js` to export shared infra. Then extract modules one at a time, build + `node packages/server/index.js` to verify server starts after each.

**Total lines to extract:** ~10,520 of 13,592 → index.js drops to ~3,000 lines.

---

## NOT extracting (stays in index.js)

| Section | Why |
|---------|-----|
| Liquidation WebSocket + aggregator (7000-7162) | Tightly coupled to in-memory buffer |
| AI answer endpoint (1648-2128) | Complex monarch tool system |
| Whisper search (1788-2128) | Multiple interleaved functions |
| News routes (1241-1422) | Interleaved with cryptopanic |
| CMC routes (7661-8097) | Uses CMC queue directly |
| Compare/Sector charts (10700-11452) | Uses multiple shared caches |
| Notifications (13500-13590) | Tiny, stays near server startup |

These ~3,000 lines stay in index.js for now. They're more coupled and need deeper refactoring to extract safely.
