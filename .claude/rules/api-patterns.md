---
paths:
  - "apps/*/src/services/**"
  - "apps/*/api/**"
  - "packages/server/routes/**"
  - "apps/*/src/hooks/use*Data*.js"
---

# API & Service Layer Rules

---

## A. Architecture Overview

```
Browser  --/api/*-->  Vite Proxy  -->  Express Server (dev, port 3001)  -->  External APIs
Browser  --/api/*-->  Vercel Rewrites  -->  Serverless Functions (prod)  -->  External APIs
```

- **Dev**: ALL `/api` requests proxy to `packages/server/` (Express, 60+ routes)
- **Prod**: each route needs its own serverless function in `apps/{app}/api/`
- **Gap**: features depending on Express-only routes silently break in production

### Proxy Configuration

Research `vite.config.js` proxies:
```
/api           -> http://localhost:{API_PORT}     (Express server)
/og            -> http://localhost:{API_PORT}     (OG image generation)
/coingecko     -> https://api.coingecko.com/api/v3  (direct, dev only)
/tweets-api    -> https://backend-...us-central1.run.app
/ext-api       -> https://appresearchbeta-...us-central1.run.app
/spectre-api   -> https://us-central1-...cloudfunctions.net/SearchEngineApiV4
```

Trading `vite.config.js` proxies `/api` only - no `/spectre-api`, `/tweets-api`, or `/ext-api`.

Both Vite configs read `../../.claude/launch.json` at startup to find the server port. Falls back to 3001.

---

## B. Frontend Service Files

### Research App (`apps/research/src/services/`)

| File | API | Cache | Dedup | Error handling |
|------|-----|-------|-------|----------------|
| `coinGeckoApi.js` | CoinGecko via `/api/coingecko` | `priceCache` 30s, `allCoinsCache` 5min | Boolean flag + stored Promise | Returns stale cache or static fallback |
| `binanceApi.js` | Binance via `/api/binance-ticker` | None (server caches) | None | Returns `{}` (empty object) |
| `codexApi.js` | Codex via `/api/codex` (prod) or `/api/tokens/*` (dev) | Per-function Maps, 10s-30s | `inflightRequests` Map | Returns `null` or `{ getBars: [] }` |
| `cryptoNewsApi.js` | CryptoPanic + CryptoCompare via `/api/*` | `newsCache` 3min | None | Returns `[]`, silent swallow |
| `polymarketApi.js` | Gamma API via `/api/polymarket/events` | `allEventsCache` 3min | None | Returns `[]`, stale cache |
| `fearGreedApi.js` | `/api/fear-greed/*` | `_cache` object, 30s-30min per key | `_inflight` object (full dedup) | **Throws** (callers must catch) |
| `spectreApi.js` | `/spectre-api` (Cloud Function) | `cache` Map, 5min | None | Returns `null` |
| `stockApi.js` | `/api/stocks/*` | None | None | Returns `null`, falls to CORS proxies |
| `analytics.js` | PostHog direct | `_timedEvents` Map (durations) | N/A | Never throws (try/catch wrapper) |
| `walletService.js` | Direct RPC (ethers + @solana/web3.js) | `providerCache` Map (permanent) | N/A | Throws (callers catch) |
| `profileSync.js` | `/api/user/*` | None | None | Silent swallow |
| `swapService.js` | `/api/swap/*` | Fee config 5min | None | Returns error object |

### Trading App Services

Copies of research equivalents with different import paths. Key difference: trading `codexApi.js` includes agent team management functions (`createTeam`, `spawnAgent`, `connectTeamStream` via EventSource) that research lacks.

---

## C. Dev vs Prod URL Routing

### The `isDev` Check

Both `codexApi.js` files use different URL patterns in dev vs prod:

```js
// Dev:  GET /api/tokens/search?q=bitcoin       (Express REST route)
// Prod: GET /api/codex?action=search&q=bitcoin  (query-string dispatch in serverless fn)
```

The `isDev` flag comes from `src/utils/env.js`. **Never hardcode** a dev-only URL path in a service file without a prod equivalent.

### Routes That Work in Dev Only

These Express routes have NO serverless function equivalent:

| Route | Feature | Impact |
|-------|---------|--------|
| `/api/tokens/search`, `/api/tokens/trending` | REST-style token endpoints | Prod uses `/api/codex?action=...` instead |
| `/api/health`, `/api/health/detailed` | Server health check | No prod equivalent |
| `/api/agents/*` | Agent team management | No prod equivalent |
| `/api/monarch-chat` | AI chat (Claude) | No prod equivalent |
| `/api/polymarket/events` | Prediction markets | Frontend falls back to direct Gamma API |
| `/api/token/market-profile` | Token market profile | No prod equivalent |
| `/og/*` | OG image generation | No prod equivalent |
| `/api/lens/*`, `/api/posting/*`, `/api/war-room/*` | Social features | No prod equivalent |

**Rule**: when adding a new `/api` route, ALWAYS create a matching serverless function in `apps/{app}/api/` or the feature silently breaks in production.

---

## D. Serverless Function Patterns

### CORS Headers (standard across all functions)

```js
const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181',
  'https://app.spectreai.io'
]
res.setHeader('Access-Control-Allow-Origin',
  ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : ''
)
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
if (req.method === 'OPTIONS') return res.status(200).end()
```

Copy this exactly. Do not use `*` wildcard.

### Cache-Control Headers

| Function | Cache-Control |
|----------|--------------|
| `cg-proxy.js` | `public, s-maxage=30, stale-while-revalidate=60` |
| `binance-ticker.js` | `public, s-maxage=10, stale-while-revalidate=20` |
| `img-proxy.js` | `public, max-age=86400, s-maxage=86400, stale-while-revalidate=172800` |
| `news.js` | `public, s-maxage=120, stale-while-revalidate=240` |
| `fear-greed.js` (current) | `public, s-maxage=300, stale-while-revalidate=600` |

### Auth Pattern (for protected endpoints)

```js
import { verifyPrivyToken } from './_lib/auth.js'
const userId = await verifyPrivyToken(req)
if (!userId) return res.status(401).json({ error: 'Unauthorized' })
```

Functions requiring auth: `user.js`, `swap.js` (log/history only; quote is public), `referral.js`, `admin.js`.

### Multi-Action Routing (for functions handling multiple endpoints)

```js
const route = req.query.route || ''
if (route === 'profile' && req.method === 'GET') { /* ... */ }
if (route === 'profile' && req.method === 'POST') { /* ... */ }
if (route === 'settings') { /* ... */ }
```

Used by: `user.js`, `swap.js`, `fear-greed.js`, `calendar-api.js`, `intelligence-api.js`.

### Error Responses

```js
// Input validation
return res.status(400).json({ error: 'Missing required field' })
// Upstream failure
return res.status(502).json({ error: 'Service unavailable' })
// Exception: news.js returns 200 with empty array even on error (never 5xx)
```

---

## E. Client-Side Cache Patterns

### Preferred Pattern (use for new services)

From `fearGreedApi.js` - combines cache + dedup in one clean abstraction:

```js
const _cache = {}       // { [key]: { data, ts } }
const _inflight = {}    // { [key]: Promise }
const FETCH_TIMEOUT = 15000

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) { delete _cache[key]; return null }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

function _deduped(cacheKey, ttlMs, url) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]
  const promise = _fetchJSON(url)
    .then(data => { _setCached(cacheKey, data); delete _inflight[cacheKey]; return data })
    .catch(err => { delete _inflight[cacheKey]; throw err })
  _inflight[cacheKey] = promise
  return promise
}
```

### Timeout Patterns

Two styles coexist. Use `AbortSignal.timeout()` for new code:

```js
// Preferred (modern)
const res = await fetch(url, { signal: AbortSignal.timeout(15000) })

// Legacy (manual controller) - don't introduce new
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 8000)
const res = await fetch(url, { signal: controller.signal })
clearTimeout(timeoutId)
```

### AbortController for User-Triggered Requests

User-initiated fetches (search, swap quotes) use `AbortController` stored in a ref so the previous request is cancelled when a new one starts:

```js
const abortRef = useRef(null)

function fetchQuote() {
  abortRef.current?.abort()
  abortRef.current = new AbortController()
  fetch(url, { signal: abortRef.current.signal })
    .catch(err => {
      if (err.name === 'AbortError') return  // silently ignore
      setError(err.message)
    })
}
```

Background polling hooks do NOT use AbortController - they use the `let cancelled = false` cleanup pattern instead.

---

## F. Error Handling Inconsistencies

Error handling is NOT consistent across services. Know what each returns:

| Service | On error returns | Throws? |
|---------|-----------------|---------|
| `coinGeckoApi.js` | Stale cache, then static fallback data | No |
| `binanceApi.js` | `{}` (empty object) | No |
| `codexApi.js` | `null` or `{ getBars: [] }` | No (internal rethrow caught by public functions) |
| `cryptoNewsApi.js` | `[]` (falls through to next source) | No |
| `polymarketApi.js` | `[]` or stale cache | No |
| `fearGreedApi.js` | N/A | **YES - callers must catch** |
| `spectreApi.js` | `null` | No |
| `stockApi.js` | `null`, falls to CORS proxies | No |

**Rule for new services**: return `null` or `[]` on failure, never throw. Log with `console.error`. The `fearGreedApi.js` throw pattern is an exception, not a template.

---

## G. Express Server Internals

### Cache System (`packages/server/index.js`)

All server caches use `Map` with `getCached(map, key, ttlMs)` / `setCached(map, key, data, ttlMs)`. Max 500 entries per map. Eviction: delete oldest by `.expires`. Garbage sweep every 5 minutes.

Key server-side TTLs: prices 30s, details 15s, trending 2min, stock quotes 30s, stock candles 5min, news 5min, AI analysis 30min, market status 1min.

### Rate Limiting (Express only, not on Vercel)

```
AI endpoints:     10 req/min per IP
Audio TTS:        5 req/min per IP
Search:           15 req/min per IP
```

In-memory `Map` keyed by `req.ip`. Returns `429` with `Retry-After`. No distributed rate limiting.

### Circuit Breakers

```
Yahoo Finance:   3 failures -> OPEN for 60s
Finnhub:         5 failures -> OPEN for 60s
CMC:             3 failures -> OPEN for 120s
```

States: CLOSED -> OPEN (skip calls, return 503) -> HALF_OPEN (single test request). Status at `GET /api/health/detailed`.

### CoinGecko Rate Queue

Serial request queue with `CG_MIN_INTERVAL`:
- With API key: 2200ms between requests (~27 req/min)
- Without API key: 6500ms between requests (~9 req/min)

Same serial queue pattern for CMC (2000ms interval).

---

## H. Binance Special Case

Binance blocks Vercel's IP ranges. The `binance-ticker.js` serverless function implements triple fallback:

```
1. Direct Binance API call (may fail from Vercel IPs)
2. allorigins.win CORS proxy (free, no SLA)
3. Per-symbol individual fetches (slower, partial results ok)
4. CoinGecko fallback (last resort, different data shape)
```

The frontend `binanceApi.js` does NOT implement this fallback - it relies on the serverless function handling it.

---

## I. Two-Tier Caching

Server cache reduces external API calls. Client cache reduces server calls. TTLs are NOT coordinated.

```
User sees data that is at most (client TTL + server TTL) stale:
  Token prices: 30s client + 30s server = up to 60s stale
  News: 3min client + 5min server = up to 8min stale
  Top coins: 5min client + 5min server = up to 10min stale
```

This is acceptable for market data. Do not add more caching layers.

---

## J. Data Source Hierarchy

| Data Type | Primary | Fallback | Merge Rule |
|-----------|---------|----------|------------|
| Token metadata (name, logo, market cap) | CoinGecko | Codex | CoinGecko wins |
| Real-time price | Binance | CoinGecko | **Binance wins** (more real-time) |
| On-chain/DEX data (trades, bars, liquidity) | Codex | None | Codex only |
| Token search | Codex `searchTokens` | `majorTokens.js` local filter | API results ranked higher |
| News | CryptoPanic | CryptoCompare | First success wins |
| Fear & Greed | Alternative.me via server | CMC via server | First success wins |
| Stock data | Yahoo Finance | Finnhub | Yahoo preferred, Finnhub fallback |

### Token Resolution Chain

1. `majorTokens.js` - 38 hardcoded major tokens with CoinGecko IDs
2. `SYMBOL_TO_COINGECKO_ID` - maps symbol to CoinGecko slug
3. `MAJOR_SYMBOLS` Set - determines CoinGecko (major) vs Codex (everything else)
4. Server `token-registry.js` - maps symbols to addresses, networkIds, Binance pairs

---

## K. Analytics Service

```js
// CORRECT - always use the service wrapper
import { track, Events } from '@/services/analytics'
track(Events.TOKEN_VIEWED, { symbol: 'BTC', source: 'discovery' })

// WRONG - never import posthog directly
import posthog from 'posthog-js'
```

- All event names live in the `Events` constant object - never inline strings
- `track()` wraps in try/catch - analytics must never break the app
- PostHog is initialized once in `main.jsx` via `init()`, not inside components
- Super properties registered in `App.jsx` effects, not in pages
- `APP_NAME` differs: `'research'` vs `'trading'`

---

## L. Visibility-Gated Fetching

A data hook MUST NOT fire a fetch (or start polling) for content the user is not currently looking at. There are two correct patterns; use whichever fits.

### Pattern 1 — Lazy mount (preferred when possible)

If the panel/section is rendered conditionally and its component is lazy-loaded, put the hook INSIDE the panel. The hook runs only when the panel mounts.

```jsx
// welcome-page.jsx
const SectorsTabPanel = lazy(() => import('./sectors-tab-panel'))

{marketAiTab === 'sector' && (
  <Suspense fallback={null}>
    <SectorsTabPanel />
  </Suspense>
)}

// sectors-tab-panel.jsx — the hook lives here, NOT in the parent
function SectorsTabPanel() {
  const { sectors, loading } = useSectorData({ sectorLimit: 40 })
  // ...
}
```

This is how `useWalletMoves` (Wallets tab), `useSectorData` (Sectors tab), and `getHeatmap` (Volume Heatmap tab) are wired.

### Pattern 2 — `enabled` flag

When the hook MUST live in a parent (e.g. because multiple sibling panels share its data, or it powers always-visible chrome AND a tab), expose an `enabled` parameter and skip both the initial fetch and any polling when false.

```js
// hook
export function useFoo({ enabled = true } = {}) {
  useEffect(() => { if (enabled) fetchOnce() }, [enabled])
  useAdaptivePolling(fetchOnce, { interval: 60_000, enabled })
}

// caller
const fooData = useFoo({ enabled: marketAiTab === 'foo' })
```

If the hook has multiple data slices with different visibility requirements, split the upstream into modes (see `getSpectreIntelBundle({ mode: 'slim' | 'full' })`): a slim mode for always-visible chrome and a full mode only when a derivatives surface is open.

### Banned patterns

- Eager fetch with a "preload" justification while the consumer is hidden behind a tab → if the data is for a tab, the tab is the gate, not a `useRef.current` flag.
- `if (activeTab !== 'foo' && initRef.current) return` — this is an inverted guard that lets the first render slip through. The correct form is `if (activeTab !== 'foo') return`.
- Hidden polling: `setInterval` inside a hook with no `enabled` parameter. Polling without visibility is the most expensive form of unused work.

### Verify after changes

After editing a tab-gated hook, open the Welcome page DevTools Network panel and switch tabs. Each tab's requests should appear only when that tab becomes active and stop being repeated after switching away.
