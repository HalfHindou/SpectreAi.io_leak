# Real-Time WebSocket Infrastructure — Stream Prompts

> **How to use:** Open a new Cursor Composer session for each stream below.
> Copy the entire prompt (between the `---` markers) and paste it as your first message.
> Launch all 8 sessions simultaneously for maximum parallelism.
> After all complete, run the **Post-Merge Integration** prompt in a final session.

---

## STREAM 1: Database Schema & Models

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Backend: Express.js running on Node.js in `server/`
- Frontend: React 18 + Vite in `src/`
- Current state: MVP with API proxy to Codex/CoinGecko, no database yet
- Shared types are defined in `packages/shared/src/types/database.ts`

**Your task:** Create the PostgreSQL database layer from scratch.

**Files you MUST create (and ONLY these files):**

```
server/db/connection.js          — PostgreSQL connection pool using pg library
server/db/migrate.js             — Migration runner script
server/db/migrations/001_create_tokens.sql
server/db/migrations/002_create_pairs.sql
server/db/migrations/003_create_trades.sql
server/db/migrations/004_create_orders.sql
server/db/migrations/005_create_alerts.sql
server/db/migrations/006_create_sessions.sql
server/db/models/tokenModel.js
server/db/models/pairModel.js
server/db/models/tradeModel.js
server/db/models/orderModel.js
```

**DO NOT touch any other files.** Especially not `server/index.js`, `src/`, or `package.json`.

**Database schema requirements:**

1. **tokens** table: id (UUID), address, network_id, symbol, name, decimals, logo_url, description, total_supply, circulating_supply, social links (twitter, discord, telegram, website), is_verified, timestamps. Unique constraint on (address, network_id). Index on address, symbol, network_id.

2. **pairs** table: id (UUID), address, network_id, token0_address, token1_address, dex, liquidity, volume_24h, fee_tier, timestamps. Unique constraint on (address, network_id). Index on token addresses.

3. **trades** table: id (UUID), token_address, pair_address, network_id, trade_type (buy/sell), price_usd, amount_token, amount_usd, maker_address, tx_hash, block_number, timestamp. Index on (token_address, timestamp DESC), (pair_address, timestamp DESC), tx_hash.

4. **orders** table: id (UUID), user_id, token_address, pair_address, network_id, order_type, side, status, price, amount, filled_amount, trigger_price, slippage, wallet_address, tx_hash, error_message, timestamps. Index on (wallet_address, status), (token_address, status).

5. **alerts** table: id (UUID), user_id, token_address, network_id, alert_type, threshold, is_active, last_triggered, created_at. Index on (user_id, is_active).

6. **user_sessions** table: id (UUID), wallet_address, network_id, nonce, signature, is_active, expires_at, created_at. Index on wallet_address.

**connection.js requirements:**
- Use `pg` library's Pool
- Read config from environment variables: DATABASE_URL or individual PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
- Connection pool with min: 2, max: 20
- Export the pool instance

**migrate.js requirements:**
- Read all .sql files from migrations/ directory in order
- Create a `_migrations` tracking table
- Skip already-applied migrations
- Run with: `node server/db/migrate.js`

**Model files requirements:**
- Each model exports functions: findById, findByAddress, create, update, delete (soft)
- Use parameterized queries (no SQL injection)
- Return plain objects matching the types in `packages/shared/src/types/database.ts`
- Include pagination support (limit/offset) for list queries
- tradeModel: include findByToken(tokenAddress, networkId, limit, offset) and findByPair(pairAddress, networkId, limit, offset)

**Success criteria:**
- All SQL files are valid PostgreSQL syntax
- All models use parameterized queries
- Migration runner is idempotent (can run multiple times safely)
- Indexes cover common query patterns (by address, by time, by status)

---

## STREAM 2: WebSocket Server

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Backend: Express.js on Node.js in `server/`, currently HTTP-only
- The HTTP server is created in `server/index.js` with `app.listen(PORT)`
- Shared types in `packages/shared/src/types/websocket.ts` define all WS message types
- Shared constants in `packages/shared/src/constants/trading.ts` define WS_HEARTBEAT_INTERVAL_MS (30000), WS_RECONNECT_BASE_DELAY_MS, WS_MAX_RECONNECT_ATTEMPTS

**Your task:** Create a WebSocket server that attaches to the existing HTTP server and supports pub/sub channels for real-time price updates, trade feeds, and token stats.

**Files you MUST create (and ONLY these files):**

```
server/ws/wsServer.js            — WebSocket server setup, attaches to HTTP server
server/ws/connectionManager.js   — Tracks clients and their channel subscriptions
server/ws/messageHandler.js      — Routes incoming WS messages to appropriate handlers
server/ws/channels/priceChannel.js   — Price update broadcasting logic
server/ws/channels/tradeChannel.js   — Trade event broadcasting logic
server/ws/channels/statsChannel.js   — Token stats broadcasting logic
server/ws/heartbeat.js           — Ping/pong keepalive mechanism
server/ws/index.js               — Barrel export
```

**DO NOT touch any other files.** Especially not `server/index.js`.

**WebSocket protocol (from shared types):**

Client → Server messages:
- `{ type: "subscribe", payload: { channel: "prices"|"trades"|"orderbook"|"token_stats", params: { tokenAddress, networkId, pairAddress, tokenAddresses } } }`
- `{ type: "unsubscribe", payload: { channel, subscriptionId } }`
- `{ type: "ping", payload: {} }`

Server → Client messages:
- `{ type: "subscribed", payload: { channel, subscriptionId }, timestamp }`
- `{ type: "unsubscribed", payload: { channel, subscriptionId }, timestamp }`
- `{ type: "pong", payload: {}, timestamp }`
- `{ type: "price_update", payload: { tokenAddress, networkId, priceUSD, change24h, volume24h, ... }, timestamp }`
- `{ type: "trade", payload: { tokenAddress, pairAddress, networkId, type, priceUSD, amountToken, amountUSD, maker, txHash, ... }, timestamp }`
- `{ type: "error", payload: { code, message }, timestamp }`
- `{ type: "heartbeat", payload: {}, timestamp }`

**wsServer.js requirements:**
- Use the `ws` library (WebSocket.Server)
- Export a function `createWSServer(httpServer)` that attaches WS to an existing HTTP server
- Handle connection, message, close, error events
- Delegate message handling to messageHandler
- Log connections and disconnections

**connectionManager.js requirements:**
- Track all connected clients with a Map<clientId, { ws, subscriptions: Set<string>, lastPong }>
- `addClient(ws)` — assigns unique ID, stores client
- `removeClient(clientId)` — cleans up all subscriptions
- `subscribe(clientId, channel, params)` — returns subscriptionId
- `unsubscribe(clientId, subscriptionId)` — removes subscription
- `getSubscribers(channel, params)` — returns array of ws connections subscribed to a channel+params combo
- `broadcastToChannel(channel, params, message)` — sends message to all subscribers

**messageHandler.js requirements:**
- Parse incoming JSON messages
- Validate message structure (type, payload)
- Route to appropriate handler based on message type
- Return error messages for invalid/unknown types

**Channel files requirements:**
- Each channel file exports a `broadcast(connectionManager, data)` function
- priceChannel: broadcasts PriceUpdate to all clients subscribed to that token
- tradeChannel: broadcasts TradeUpdate to all clients subscribed to that pair/token
- statsChannel: broadcasts TokenStatsUpdate to all clients subscribed to that token

**heartbeat.js requirements:**
- Start interval timer (30s) that sends ping to all connected clients
- Track last pong time per client
- Terminate clients that haven't responded to 2 consecutive pings (60s timeout)
- Export `startHeartbeat(connectionManager)` and `stopHeartbeat()`

**Success criteria:**
- WS server starts without errors when attached to an HTTP server
- Clients can connect, subscribe to channels, receive messages
- Clients are cleaned up on disconnect
- Heartbeat detects and removes dead connections
- All messages follow the protocol defined in shared types

---

## STREAM 3: Redis Cache Layer

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Backend: Express.js on Node.js in `server/`
- Shared constants in `packages/shared/src/constants/trading.ts` define cache TTLs:
  - PRICE_CACHE_TTL_MS = 2000 (2s)
  - TOKEN_CACHE_TTL_MS = 60000 (60s)
  - TRENDING_CACHE_TTL_MS = 30000 (30s)
  - SEARCH_CACHE_TTL_MS = 10000 (10s)
- Shared events in `packages/shared/src/events/channels.ts` define cache key generators and pub/sub channel names

**Your task:** Create a Redis caching layer with pub/sub support for real-time broadcasting.

**Files you MUST create (and ONLY these files):**

```
server/cache/redisClient.js      — Redis connection with reconnection logic
server/cache/cacheService.js     — Generic cache operations (get, set, delete, getOrFetch)
server/cache/tokenCache.js       — Token-specific caching (details, search, trending)
server/cache/priceCache.js       — Price-specific caching with 2s TTL
server/cache/pubsub.js           — Redis pub/sub for broadcasting real-time updates
server/cache/index.js            — Barrel export
```

**DO NOT touch any other files.**

**redisClient.js requirements:**
- Use the `redis` library (createClient)
- Read config from env: REDIS_URL or individual REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
- Auto-reconnect on connection loss
- Log connection state changes
- Export: `getRedisClient()`, `connectRedis()`, `disconnectRedis()`

**cacheService.js requirements:**
- `get(key)` — returns parsed JSON or null
- `set(key, value, ttlMs)` — stores JSON-serialized value with TTL
- `del(key)` — deletes a key
- `getOrFetch(key, ttlMs, fetchFn)` — returns cached value if exists, otherwise calls fetchFn, caches result, and returns it (cache-aside pattern)
- `invalidate(pattern)` — delete all keys matching a glob pattern
- All operations handle Redis connection errors gracefully (fall through to direct fetch)

**tokenCache.js requirements:**
- `getCachedTokenDetails(networkId, address)` / `cacheTokenDetails(networkId, address, data)`
- `getCachedSearchResults(query, networks)` / `cacheSearchResults(query, networks, data)`
- `getCachedTrending(timeframe, networks)` / `cacheTrending(timeframe, networks, data)`
- Uses cache key generators from `packages/shared/src/events/channels.ts`
- Uses TTLs from `packages/shared/src/constants/trading.ts`

**priceCache.js requirements:**
- `getCachedPrice(networkId, address)` / `cachePrice(networkId, address, data)`
- Very short TTL (2 seconds) for price data
- Batch operations: `getCachedPrices(tokens)` where tokens is array of {networkId, address}
- `cachePrices(priceUpdates)` — batch cache multiple prices

**pubsub.js requirements:**
- Separate Redis connection for subscriber (Redis requires this)
- `publish(channel, message)` — publish JSON message to a channel
- `subscribe(channel, callback)` — subscribe to a channel with message handler
- `unsubscribe(channel)` — unsubscribe from a channel
- Channel names use functions from `packages/shared/src/events/channels.ts`

**Success criteria:**
- Redis client connects and reconnects automatically
- Cache operations are transparent (app works without Redis, just slower)
- TTLs match the constants defined in shared package
- Pub/sub can broadcast messages between server processes
- All cache keys use the shared key generator functions

---

## STREAM 4: Frontend WebSocket Client

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Frontend: React 18 + Vite in `src/`
- Current state: Polling-based data fetching via `src/services/codexApi.js` and `src/hooks/useCodexData.js`
- No state management library (using React hooks + localStorage)
- Styling: CSS files alongside components

**Your task:** Create a WebSocket client and React hooks for real-time data subscriptions.

**Files you MUST create (and ONLY these files):**

```
src/services/wsClient.js          — WebSocket client singleton with auto-reconnect
src/hooks/useWebSocket.js         — REPLACE existing file — main WS lifecycle hook
src/hooks/useLivePrice.js         — Hook to subscribe to live price updates
src/hooks/useLiveTrades.js        — Hook to subscribe to live trade feed
src/hooks/useConnectionStatus.js  — Hook exposing WS connection state
```

**DO NOT touch any other files.** The existing `src/hooks/useCodexData.js` stays untouched.

**WebSocket protocol (must match server):**

Client → Server:
```json
{ "type": "subscribe", "payload": { "channel": "prices", "params": { "tokenAddress": "0x...", "networkId": 1 } } }
{ "type": "unsubscribe", "payload": { "channel": "prices", "subscriptionId": "sub_123" } }
{ "type": "ping", "payload": {} }
```

Server → Client:
```json
{ "type": "subscribed", "payload": { "channel": "prices", "subscriptionId": "sub_123" }, "timestamp": 1700000000 }
{ "type": "price_update", "payload": { "tokenAddress": "0x...", "networkId": 1, "priceUSD": 1.23, "change24h": 5.4, ... }, "timestamp": 1700000000 }
{ "type": "trade", "payload": { "tokenAddress": "0x...", "type": "buy", "priceUSD": 1.23, "amountUSD": 500, ... }, "timestamp": 1700000000 }
{ "type": "pong", "payload": {}, "timestamp": 1700000000 }
```

**wsClient.js requirements:**
- Singleton class `WSClient` with methods: connect(), disconnect(), subscribe(channel, params), unsubscribe(subscriptionId), send(message)
- Auto-reconnection with exponential backoff: 1s, 2s, 4s, 8s... up to 30s max, 20 attempts max
- Event emitter pattern: on(event, callback), off(event, callback)
- Events: 'open', 'close', 'error', 'message', 'reconnecting', 'reconnected'
- Message queue: buffer messages sent while disconnected, flush on reconnect
- Auto-resubscribe: restore all active subscriptions after reconnect
- WS URL from environment: `import.meta.env.VITE_WS_URL || 'ws://localhost:3001'`
- Ping/pong: send ping every 30s, track latency from pong response

**useWebSocket.js requirements:**
- Manages WSClient lifecycle (connect on mount, disconnect on unmount)
- Returns: { isConnected, connectionState, latency, subscribe, unsubscribe }
- `subscribe(channel, params, onMessage)` — returns subscriptionId
- `unsubscribe(subscriptionId)` — cleans up subscription
- Cleans up all subscriptions on unmount

**useLivePrice.js requirements:**
- `useLivePrice(tokenAddress, networkId)`
- Returns: `{ price, change24h, volume24h, liquidity, marketCap, loading, error }`
- Subscribes to 'prices' channel on mount, unsubscribes on unmount
- Falls back to polling if WS is not connected
- Updates state on each price_update message

**useLiveTrades.js requirements:**
- `useLiveTrades(tokenAddress, networkId, maxTrades = 50)`
- Returns: `{ trades, loading, error }` where trades is array of recent trades
- Subscribes to 'trades' channel on mount, unsubscribes on unmount
- Prepends new trades to array, trims to maxTrades
- Each trade: { type, priceUSD, amountToken, amountUSD, maker, txHash, timestamp }

**useConnectionStatus.js requirements:**
- `useConnectionStatus()`
- Returns: `{ state, reconnectAttempts, lastConnected, latency }`
- state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
- Updates reactively when connection state changes

**Success criteria:**
- WS client connects to server and handles reconnection automatically
- Hooks properly subscribe/unsubscribe and prevent memory leaks
- Price hook provides real-time price updates to any component
- Trade hook provides a live feed of recent trades
- Connection status is observable for UI indicators

---

## STREAM 5: REST API Routes (Modular)

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Backend: Express.js on Node.js in `server/`
- Current state: ALL routes are in a single `server/index.js` file (2273 lines)
- Shared types in `packages/shared/src/types/api.ts` define all API request/response shapes
- The server proxies to Codex GraphQL API and CoinGecko API

**Your task:** Create modular route files that mirror the existing endpoints plus new ones. These will be wired into the main server later (post-merge integration step).

**Files you MUST create (and ONLY these files):**

```
server/routes/index.js           — Registers all route modules on an Express Router
server/routes/tokenRoutes.js     — /api/v1/tokens/* endpoints
server/routes/tradeRoutes.js     — /api/v1/trades/* endpoints
server/routes/chartRoutes.js     — /api/v1/charts/* endpoints
server/routes/orderRoutes.js     — /api/v1/orders/* endpoints (placeholder)
server/routes/portfolioRoutes.js — /api/v1/portfolio/* endpoints (placeholder)
```

**DO NOT touch `server/index.js` or any other files.**

**Route structure:**
Each route file exports an Express Router. The index.js combines them:

```javascript
// server/routes/index.js
const { Router } = require('express');
const tokenRoutes = require('./tokenRoutes');
const tradeRoutes = require('./tradeRoutes');
// etc.
const router = Router();
router.use('/tokens', tokenRoutes);
router.use('/trades', tradeRoutes);
// etc.
module.exports = router;
// Mounted in server/index.js as: app.use('/api/v1', routes);
```

**tokenRoutes.js endpoints (mirror existing + new):**
- `GET /search?q=&networks=` — search tokens by name/symbol/address
- `GET /trending?limit=&networks=&timeframe=` — trending tokens
- `GET /price/:symbol` — price by symbol
- `GET /:address?networkId=` — token details by address
- `GET /:address/pairs?networkId=&limit=` — token pairs

Each route handler should:
1. Validate input (check required params)
2. Delegate to a service function or direct API call (for now, include the logic inline — it will be extracted to services later)
3. Return consistent JSON: `{ data: ..., timestamp: Date.now() }` for success, `{ error: ..., code: ..., timestamp: Date.now() }` for errors

**tradeRoutes.js endpoints:**
- `GET /token/:address?networkId=&limit=` — trades for a token
- `GET /pair/:pairAddress?networkId=&limit=` — trades for a pair

**chartRoutes.js endpoints:**
- `GET /bars?symbol=&from=&to=&resolution=&networkId=` — OHLCV bars
- `GET /coingecko/ohlcv/:coinId?from=&to=&resolution=` — CoinGecko OHLCV

**orderRoutes.js (placeholder — returns 501 Not Implemented):**
- `POST /` — create order
- `DELETE /:orderId` — cancel order
- `GET /?walletAddress=&status=` — list orders

**portfolioRoutes.js (placeholder — returns 501 Not Implemented):**
- `GET /:walletAddress` — portfolio summary
- `GET /:walletAddress/positions` — individual positions

**Important:** The route files need access to the Codex and CoinGecko API helpers. For now, duplicate the `executeCodexQuery` and `executeCodexQueryAllowPartial` functions at the top of the file that needs them (they will be extracted to a shared service in a later refactor). Copy them from `server/index.js`:

```javascript
const CODEX_API_KEY = process.env.CODEX_API_KEY;
const CODEX_BASE_URL = 'https://graph.codex.io/graphql';
async function executeCodexQuery(query, variables = {}) { /* ... */ }
```

**Success criteria:**
- Each route file is self-contained and exports an Express Router
- index.js cleanly registers all routes under /api/v1/
- Existing functionality is preserved (same responses as current endpoints)
- New placeholder routes return proper 501 responses
- Input validation on all endpoints

---

## STREAM 6: Test Suite

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Backend: Express.js on Node.js in `server/`
- No tests exist yet — you are creating the entire test infrastructure
- The project uses `bun` as the runtime (also supports Node.js)
- Shared types are in `packages/shared/src/`

**Your task:** Create a comprehensive test suite with mocks, unit tests, and integration tests.

**Files you MUST create (and ONLY these files):**

```
tests/setup.js                       — Test configuration and global setup
tests/mocks/mockRedis.js             — Redis client mock
tests/mocks/mockDatabase.js          — PostgreSQL pool mock
tests/mocks/mockWebSocket.js         — WebSocket mock (both server and client)
tests/unit/cacheService.test.js      — Unit tests for cache service
tests/unit/connectionManager.test.js — Unit tests for WS connection manager
tests/unit/messageHandler.test.js    — Unit tests for WS message handler
tests/unit/tokenModel.test.js        — Unit tests for token model
tests/integration/tokenRoutes.test.js  — Integration tests for token API
tests/integration/tradeRoutes.test.js  — Integration tests for trade API
tests/integration/wsServer.test.js     — Integration tests for WebSocket
```

**DO NOT touch any other files.** Write tests AGAINST the interfaces defined in the shared types.

**Test framework:** Use `bun:test` (built-in to Bun) which is compatible with Jest API:
```javascript
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
```

If the project doesn't use Bun, fall back to basic Node.js test runner:
```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
```

**Mock requirements:**

mockRedis.js:
- In-memory store (Map) that mimics Redis get/set/del/expire
- publish/subscribe mock that tracks messages
- Export: createMockRedis()

mockDatabase.js:
- Mock Pool that records queries and returns configurable results
- Export: createMockPool({ queryResults })
- Support for transaction mocking (BEGIN, COMMIT, ROLLBACK)

mockWebSocket.js:
- Mock WebSocket class that records sent messages
- Mock WebSocket.Server that manages mock connections
- Export: createMockWS(), createMockWSServer()

**Unit test requirements:**

cacheService.test.js:
- Test get() returns null for missing keys
- Test set() + get() round-trip with JSON serialization
- Test TTL expiration (use fake timers)
- Test getOrFetch() calls fetchFn only on cache miss
- Test getOrFetch() returns cached value on cache hit
- Test graceful handling when Redis is disconnected

connectionManager.test.js:
- Test addClient() assigns unique ID
- Test removeClient() cleans up subscriptions
- Test subscribe() returns subscription ID and tracks it
- Test unsubscribe() removes subscription
- Test getSubscribers() returns correct clients for channel+params
- Test broadcastToChannel() sends to all subscribers

messageHandler.test.js:
- Test routing subscribe message to subscribe handler
- Test routing unsubscribe message to unsubscribe handler
- Test routing ping returns pong
- Test invalid JSON returns error
- Test unknown message type returns error
- Test missing required fields returns error

tokenModel.test.js:
- Test create() inserts token and returns it
- Test findByAddress() returns token or null
- Test update() modifies fields
- Test findById() with non-existent ID returns null
- Test pagination (limit/offset)

**Integration test requirements:**

tokenRoutes.test.js:
- Test GET /api/v1/tokens/search?q=ETH returns results
- Test GET /api/v1/tokens/search with no query returns empty
- Test GET /api/v1/tokens/trending returns array
- Test GET /api/v1/tokens/price/ETH returns price data
- Mock the Codex API responses

tradeRoutes.test.js:
- Test GET /api/v1/trades/token/:address returns trades
- Test GET /api/v1/trades/token/:address with invalid address returns 400
- Mock the Codex API responses

wsServer.test.js:
- Test client connects and receives welcome
- Test subscribe sends subscribed confirmation
- Test unsubscribe sends unsubscribed confirmation
- Test ping receives pong
- Test invalid message receives error
- Test client disconnect cleans up subscriptions

**Success criteria:**
- All tests can run with `bun test` or `node --test`
- Mocks are reusable across test files
- Unit tests don't make network calls
- Integration tests use mocked external APIs
- At least 30 test cases total
- Clear test descriptions explaining what each test verifies

---

## STREAM 7: Error Handling & Logging

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Backend: Express.js on Node.js in `server/`
- Frontend: React 18 + Vite in `src/`
- Current state: Error handling is inline (try/catch in each route), no structured logging, no rate limiting
- Styling: CSS files alongside components

**Your task:** Create middleware for error handling, logging, rate limiting, and input validation on the backend, plus a React ErrorBoundary on the frontend.

**Files you MUST create (and ONLY these files):**

```
server/middleware/errorHandler.js    — Express error handling middleware
server/middleware/requestLogger.js   — HTTP request logging middleware
server/middleware/rateLimiter.js     — Rate limiting middleware
server/middleware/validator.js       — Input validation helpers
server/middleware/index.js           — Barrel export
src/components/ErrorBoundary.jsx     — React error boundary component
src/components/ErrorBoundary.css     — Styling for error boundary
```

**DO NOT touch any other files.**

**errorHandler.js requirements:**
- Express error middleware signature: `(err, req, res, next)`
- Categorize errors: ValidationError (400), NotFoundError (404), RateLimitError (429), InternalError (500)
- Export custom error classes: `AppError`, `ValidationError`, `NotFoundError`, `RateLimitError`
- Always return JSON: `{ error: message, code: ERROR_CODE, timestamp: Date.now() }`
- In production: don't expose stack traces
- In development: include stack trace and details
- Log all errors with context (request method, path, user agent)

**requestLogger.js requirements:**
- Express middleware that logs every request
- Log format (JSON): `{ method, path, statusCode, duration_ms, ip, userAgent, timestamp }`
- Use `process.stdout.write` for structured JSON logging (not console.log)
- Measure duration using `process.hrtime.bigint()` or `performance.now()`
- Skip logging for health check endpoint (`/api/health`)
- Export the middleware function

**rateLimiter.js requirements:**
- In-memory rate limiter (no Redis dependency — works standalone)
- Configurable: `createRateLimiter({ windowMs, maxRequests, keyGenerator })`
- Default key: IP address from `req.ip`
- Default limits: 100 requests per 60 seconds
- Returns 429 with `{ error: "Rate limit exceeded", retryAfter: seconds }`
- Clean up expired entries periodically (every 60s)
- Export: `createRateLimiter(options)`, and pre-configured limiters:
  - `apiLimiter` — 100 req/min for general API
  - `searchLimiter` — 30 req/min for search endpoints
  - `wsLimiter` — 10 connections/min for WebSocket

**validator.js requirements:**
- `validateQuery(schema)` — middleware that validates req.query against a schema
- `validateParams(schema)` — middleware that validates req.params
- `validateBody(schema)` — middleware that validates req.body
- Schema format (simple, no Zod dependency):
  ```javascript
  const schema = {
    q: { type: 'string', required: true, minLength: 2 },
    networkId: { type: 'number', required: false, default: 1 },
    limit: { type: 'number', required: false, min: 1, max: 100, default: 15 },
  };
  ```
- Returns 400 with specific error messages for validation failures
- Sanitize strings (trim, limit length to 500 chars)
- Coerce types (string "123" to number 123 for number fields)

**ErrorBoundary.jsx requirements:**
- React class component that catches render errors
- Displays a user-friendly error UI (not a blank screen)
- "Something went wrong" message with a "Try Again" button
- In development: show error details and stack trace
- Log errors to console with component stack
- Match the existing dark theme styling (dark backgrounds, white text)
- CSS in ErrorBoundary.css

**ErrorBoundary.css requirements:**
- Dark theme matching existing app (background: #0a0a0f, text: white)
- Centered error message
- Styled "Try Again" button
- Smooth fade-in animation

**Success criteria:**
- Error handler catches all unhandled errors and returns proper JSON
- Request logger produces structured JSON logs for every request
- Rate limiter blocks excessive requests with proper 429 responses
- Validator rejects invalid input with clear error messages
- ErrorBoundary prevents blank screens on frontend errors
- All middleware is opt-in (exported as functions, wired up later)

---

## STREAM 8: Documentation

---

You are working on the **Spectre AI Trading Terminal**, a non-custodial crypto trading platform.

**Project context:**
- Backend: Express.js on Node.js in `server/`
- Frontend: React 18 + Vite in `src/`
- Shared types: `packages/shared/src/`
- WebSocket server: `server/ws/`
- Database: PostgreSQL with migrations in `server/db/`
- Cache: Redis in `server/cache/`
- The platform supports 30+ blockchain networks (Ethereum, Solana, BSC, Polygon, etc.)
- Current endpoints: token search, trending, details, OHLCV charts, trades, CoinGecko proxy

**Your task:** Create comprehensive documentation for the platform.

**Files you MUST create (and ONLY these files):**

```
docs/API.md                — REST API reference
docs/WEBSOCKET.md          — WebSocket protocol reference
docs/DATABASE.md           — Database schema reference
docs/SETUP.md              — Development setup guide
docs/ARCHITECTURE.md       — System architecture overview
```

**DO NOT touch any other files.**

**API.md requirements:**
Document all REST API endpoints with:
- HTTP method and path
- Query parameters / path parameters with types and defaults
- Request body (for POST/PUT)
- Response format with example JSON
- Error responses
- Rate limits

Endpoints to document:
- GET /api/v1/tokens/search?q=&networks=
- GET /api/v1/tokens/trending?limit=&networks=&timeframe=
- GET /api/v1/tokens/price/:symbol
- GET /api/v1/tokens/:address?networkId=
- GET /api/v1/tokens/:address/pairs?networkId=&limit=
- GET /api/v1/trades/token/:address?networkId=&limit=
- GET /api/v1/trades/pair/:pairAddress?networkId=&limit=
- GET /api/v1/charts/bars?symbol=&from=&to=&resolution=&networkId=
- GET /api/v1/charts/coingecko/ohlcv/:coinId?from=&to=&resolution=
- POST /api/v1/orders (planned)
- GET /api/v1/portfolio/:walletAddress (planned)
- GET /api/health

**WEBSOCKET.md requirements:**
Document the WebSocket protocol:
- Connection URL and handshake
- All client→server message types with JSON examples
- All server→client message types with JSON examples
- Channel subscriptions (prices, trades, orderbook, token_stats)
- Heartbeat mechanism
- Reconnection strategy
- Error handling
- Example: complete flow from connect to receiving price updates

**DATABASE.md requirements:**
Document all database tables:
- Table name and purpose
- All columns with types, constraints, defaults
- Indexes and their purpose
- Relationships between tables
- Example queries for common operations

Tables: tokens, pairs, trades, orders, alerts, user_sessions

**SETUP.md requirements:**
Step-by-step development setup:
- Prerequisites (Node.js, PostgreSQL, Redis)
- Clone and install
- Environment variables (list ALL with descriptions and example values)
- Database setup (run migrations)
- Start development server
- Running tests
- Troubleshooting common issues

**ARCHITECTURE.md requirements:**
System architecture overview:
- High-level architecture diagram (use Mermaid or ASCII)
- Component descriptions (frontend, backend, database, cache, WebSocket)
- Data flow for key operations (search, trading, real-time updates)
- Technology choices and rationale
- Deployment overview

**Success criteria:**
- All endpoints are documented with examples
- WebSocket protocol is fully specified
- Database schema is complete and accurate
- Setup guide works for a new developer
- Architecture doc provides clear system understanding
- Markdown is well-formatted and navigable

---

## POST-MERGE: Integration Prompt

> **Run this AFTER all 8 streams are complete.**

---

You are working on the **Spectre AI Trading Terminal**. Eight parallel development streams have just completed building:

1. Database layer in `server/db/`
2. WebSocket server in `server/ws/`
3. Redis cache in `server/cache/`
4. Frontend WS hooks in `src/hooks/` and `src/services/wsClient.js`
5. Modular API routes in `server/routes/`
6. Test suite in `tests/`
7. Error handling middleware in `server/middleware/`
8. Documentation in `docs/`

**Your task:** Wire everything together by updating the integration points.

**Files to update:**

1. **`server/index.js`** — The main server file. Add:
   - Import and mount the modular routes: `app.use('/api/v1', require('./routes'))`
   - Import and apply middleware: errorHandler, requestLogger, rateLimiter
   - Import and attach WebSocket server to the HTTP server
   - Import and connect Redis cache on startup
   - Import and run database connection on startup
   - Keep existing routes working (don't remove `/api/` endpoints yet — they serve as v0)

2. **`src/App.jsx`** — The main React component. Add:
   - Wrap app in ErrorBoundary
   - Initialize WebSocket connection (import useWebSocket hook)

3. **`package.json`** (root) — Add new dependencies:
   - `ws` (WebSocket library)
   - `pg` (PostgreSQL client)
   - `redis` (Redis client)

4. **`server/package.json`** — Add new dependencies:
   - `ws`, `pg`, `redis`

5. **`.env.example`** — Add new environment variables:
   - DATABASE_URL, PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
   - REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
   - VITE_WS_URL

6. **`README.md`** — Update with new features, setup instructions, and link to docs/

**Success criteria:**
- `npm run dev:all` starts the server with all new features
- WebSocket server accepts connections
- API v1 routes are accessible
- Middleware is applied (logging, rate limiting, error handling)
- ErrorBoundary wraps the frontend app
- All new environment variables are documented

---
