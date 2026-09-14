# Spectre Research API (appresearchbeta)

External backend hosted on Google Cloud Run. Provides token search, market intelligence, sector analysis, and AI-generated content for the Spectre AI platform.

**Base URL:** `https://appresearchbeta-277369611639.us-central1.run.app`

---

## Access Patterns

The backend is accessed through three proxy layers depending on environment:

| Environment | Proxy | Config |
|-------------|-------|--------|
| **Dev (Express)** | `packages/server/index.js` routes call the backend directly | Express routes at `/api/search/tokens`, `/api/market/*`, etc. |
| **Dev (Vite)** | `/ext-api/*` proxy rewrites to backend | `apps/research/vite.config.js` line 123-126 |
| **Prod (Vercel)** | Vercel rewrites + serverless functions | `apps/research/vercel.json` line 52 + `api/search-api.js`, `api/market-intel.js` |

**Vercel catch-all rewrite:**
```
/ext-api/:path(*) -> https://appresearchbeta-277369611639.us-central1.run.app/:path
```

This means any endpoint on the backend can be reached in prod via `/ext-api/<path>`.

---

## Endpoints

### 1. `GET /fetch_tokens?query={query}`

**Purpose:** Unified token search - returns tokens matching a text query, sorted by market cap descending.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Token name, ticker, or keyword (e.g. `bitcoin`, `xrp`, `sol`) |

**Response:** JSON array of token objects. Typically returns 15-20 results.

**Token object schema:**
```json
{
  "cg_id": "bitcoin",              // CoinGecko ID (null for tokens not on CoinGecko)
  "chain": null,                    // Chain name or null for native/L1 tokens
  "change_1h": 0.959,              // 1-hour price change as decimal (0.959 = +0.96%)
  "contract_address": null,         // Contract address (null for native tokens)
  "logo": "https://coin-images.coingecko.com/...",  // Logo URL (null for some wrapped/bridged tokens)
  "market_cap": 1413968092342,      // Market cap in USD
  "name": "Bitcoin",                // Human-readable token name
  "price": 70620.0,                // Current price in USD
  "ticker": "BTC",                 // Ticker symbol
  "token_id": "bitcoin",           // Unique identifier (CoinGecko slug OR `{contract}:{chainId}`)
  "volume": 46012980454             // 24h trading volume in USD
}
```

**Key behaviors:**
- Returns both native L1 tokens (chain: null, contract_address: null) and on-chain tokens (with chain + contract)
- `token_id` format for on-chain tokens: `{contract_address}:{network_id}` (e.g. `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599:1`)
- `token_id` format for CoinGecko-listed tokens: CoinGecko slug (e.g. `bitcoin`, `ripple`)
- Chain values include: `ethereum`, `arbitrum`, `polygon`, `optimism`, `avalanche`, `bsc`, `base`, `celo`, `1399811149` (Solana network ID)
- `change_1h` can be null for tokens with no recent trades
- `logo` is null for most wrapped/bridged variants - the frontend falls back to a colored circle with the token initial
- Results are sorted by `market_cap` descending
- Includes wrapped/bridged versions of the same token across chains (e.g. WBTC on Ethereum, Arbitrum, Polygon, Optimism, Avalanche, Solana)
- Includes meme tokens and unrelated tokens that match the query string loosely

**Consumed by:**
- `apps/research/src/hooks/useCodexData.js` - `useTokenSearch()` hook (line 467)
  - Frontend maps response to internal format with `chainToDisplayName()` and `chainToNetworkId()`
  - Results are used in the header search bar, discover page, and token selection
- `packages/server/index.js` - `/api/search/tokens` route (line 1776) - passthrough proxy
- `apps/research/api/search-api.js` - Vercel serverless `route=tokens` handler (line 37) - passthrough proxy with 60s CDN cache

**Example:**
```
GET /fetch_tokens?query=bitcoin
```
Returns ~18 results: Bitcoin (BTC), Bitcoin Cash (BCH), Wrapped BTC variants across 6+ chains, Bitcoin SV, Bitcoin Gold, Bitcoin Diamond, etc.

---

### 2. `GET /get-token-market-profile?cg_id={cg_id}`

**Purpose:** Detailed market profile for a single token.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `cg_id` | string | Yes | CoinGecko ID (e.g. `bitcoin`, `ethereum`) |

**Consumed by:**
- `packages/server/index.js` - `/api/token/market-profile` route (line 1759)

---

### 3. `GET /dashboard_ai_market_text`

**Purpose:** AI-generated market commentary for the dashboard. Returns structured sections with market analysis.

**Response structure:**
```json
{
  "success": true,
  "data": {
    "response": {
      "sections": [...]
    }
  }
}
```

**Consumed by:**
- `packages/server/index.js` - `/api/market/ai-market-text` route (line 5674) - with in-memory cache
- `apps/research/api/market-intel.js` - `handleAiMarketText()` (line 199) - Vercel serverless with 5min cache

---

### 4. `GET /welcome/sectors`

**Purpose:** Sector/category data for the Welcome page Sectors tab.

**Consumed by:**
- `packages/server/index.js` - `/api/market/sectors` route (line 5711) - 5min cache
- `apps/research/api/market-intel.js` - `handleSectors()` (line 159) - 5min cache

---

### 5. `GET /welcome/sectors/top-movers`

**Purpose:** Top-performing tokens within each sector.

**Consumed by:**
- `packages/server/index.js` - `/api/market/sectors/top-movers` route (line 5731) - 5min cache
- `apps/research/api/market-intel.js` - `handleSectorsTopMovers()` (line 169) - 5min cache

---

### 6. `GET /welcome/sectors/ai-analysis`

**Purpose:** AI-generated analysis of sector performance and trends.

**Consumed by:**
- `packages/server/index.js` - `/api/market/sectors/ai-analysis` route (line 5751) - 5min cache
- `apps/research/api/market-intel.js` - `handleSectorsAiAnalysis()` (line 179) - 5min cache

---

### 7. `GET /narratives/mindshare`

**Purpose:** Social media mindshare/narrative tracking data.

**Consumed by:**
- `packages/server/index.js` - `/api/market/mindshare` route (line 5771) - 5min cache
- `apps/research/api/market-intel.js` - `handleMindshare()` (line 189) - 5min cache

---

## Caching Strategy

All proxy layers add their own caching:

| Layer | TTL | Type |
|-------|-----|------|
| Express server (`packages/server/`) | 5min (sectors, mindshare, ai-market-text) | In-memory Map |
| Vercel serverless (`api/market-intel.js`) | 5min (sectors, mindshare) | Per-instance Map |
| Vercel CDN (`api/search-api.js`) | 60s s-maxage + 120s stale-while-revalidate | HTTP Cache-Control |
| Vercel CDN (`api/market-intel.js`) | 30s s-maxage + 60s stale-while-revalidate | HTTP Cache-Control |

**Worst case staleness:** client may see data up to ~10 minutes old (5min server cache + 5min serverless cache, depending on which layer serves the request).

---

## Network Architecture

```
┌─────────────────────┐
│  Browser (React)    │
│  useTokenSearch()   │
└────────┬────────────┘
         │  /api/search/tokens?query=...
         v
┌─────────────────────────────────────────────────┐
│  DEV: Express (port 3001)                        │
│  PROD: Vercel Serverless (search-api.js)         │
│         or Vercel Rewrite (/ext-api/*)           │
└────────┬────────────────────────────────────────┘
         │  /fetch_tokens?query=...
         v
┌─────────────────────────────────────────────────┐
│  Google Cloud Run                                │
│  appresearchbeta-277369611639.us-central1.run.app│
│                                                  │
│  Endpoints:                                      │
│  ├── /fetch_tokens                               │
│  ├── /get-token-market-profile                   │
│  ├── /dashboard_ai_market_text                   │
│  ├── /welcome/sectors                            │
│  ├── /welcome/sectors/top-movers                 │
│  ├── /welcome/sectors/ai-analysis                │
│  └── /narratives/mindshare                       │
└─────────────────────────────────────────────────┘
```

---

## Frontend Data Mapping (`useCodexData.js`)

The `useTokenSearch` hook transforms the `/fetch_tokens` response:

| Backend field | Frontend field | Notes |
|--------------|---------------|-------|
| `ticker` | `symbol` | Direct map |
| `name` | `name` | Direct map |
| `contract_address` | `address` | null for native tokens |
| `chain` | `network` | Mapped via `chainToDisplayName()` to short codes (ETH, BSC, SOL, etc.) |
| `chain` | `networkId` | Mapped via `chainToNetworkId()` to numeric IDs (1, 56, 1399811149, etc.) |
| `price` | `price`, `formattedPrice` | Formatted via `formatPrice()` |
| `change_1h` | `change` | Used for price direction indicators |
| `volume` | `volume` | 24h volume in USD |
| `market_cap` | `marketCap`, `formattedMcap` | Formatted via `formatLargeNumber()` |
| `logo` | `logo` | Falls back to colored circle with initial if null |
| `cg_id` | `cgId` | Used for CoinGecko data enrichment |
| `token_id` | `tokenId` | Unique ID for routing and dedup |

---

## Notes

- The backend is a separate service not part of the Spectre monorepo - its source code is not in this repository
- Authentication: none required (public API, no API key)
- Rate limiting: unknown (Cloud Run defaults apply)
- The `/ext-api/*` Vite proxy and Vercel rewrite provide an escape hatch to hit any backend endpoint directly from the frontend without needing a dedicated server route
