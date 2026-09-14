# Feature: Real-Time WebSocket Infrastructure

**Estimated Serial Time:** 4-5 days
**Estimated Parallel Time:** 3-4 hours
**Streams:** 8
**Status:** Ready to launch

---

## Pre-Launch: Shared Interfaces (ALREADY DONE)

The shared contracts are defined in `packages/shared/src/`:
- `types/websocket.ts` — WS message types, channels, payloads
- `types/api.ts` — REST API request/response types
- `types/database.ts` — Database model types
- `constants/networks.ts` — Network IDs, names, helpers
- `constants/trading.ts` — Cache TTLs, trading limits
- `events/channels.ts` — Redis pub/sub channel names, cache keys

---

## Stream Overview

| # | Stream | Files Owned | Composer Session |
|---|--------|-------------|------------------|
| 1 | Database Schema | `server/db/` | Session 1 |
| 2 | WebSocket Server | `server/ws/` | Session 2 |
| 3 | Redis Cache Layer | `server/cache/` | Session 3 |
| 4 | Frontend WebSocket Client | `src/hooks/useWebSocket.js`, `src/services/wsClient.js` | Session 4 |
| 5 | REST API Routes | `server/routes/` | Session 5 |
| 6 | Test Suite | `tests/` | Session 6 |
| 7 | Error Handling & Logging | `server/middleware/`, `src/components/ErrorBoundary.jsx` | Session 7 |
| 8 | Documentation | `docs/` | Session 8 |

---

## Merge Order

1. Database Schema (no deps)
2. Redis Cache Layer (no deps)
3. REST API Routes (reads DB schema)
4. WebSocket Server (reads types + cache)
5. Frontend WebSocket Client (reads WS types)
6. Error Handling (wraps all layers)
7. Tests (reads everything)
8. Documentation (reads everything)

### Post-Merge Integration (do in a final Composer session)

After all 8 streams complete:
1. Update `server/index.js` to import and mount new routes, WS server, middleware
2. Update `src/App.jsx` to wrap with ErrorBoundary and WebSocket provider
3. Update `package.json` with new dependencies (ws, pg, redis, etc.)
4. Update `.env.example` with new environment variables
5. Run `npm install` and verify dev server starts

---

## Stream 1: Database Schema

### Files Owned
```
server/db/
  ├── connection.js          # PostgreSQL connection pool
  ├── migrations/
  │   ├── 001_create_tokens.sql
  │   ├── 002_create_pairs.sql
  │   ├── 003_create_trades.sql
  │   ├── 004_create_orders.sql
  │   ├── 005_create_alerts.sql
  │   └── 006_create_sessions.sql
  ├── migrate.js             # Migration runner script
  └── models/
      ├── tokenModel.js      # Token CRUD operations
      ├── pairModel.js       # Pair CRUD operations
      ├── tradeModel.js      # Trade CRUD + queries
      └── orderModel.js      # Order CRUD + status updates
```

### Deliverables
- [ ] PostgreSQL connection pool with env-based config
- [ ] SQL migration files for all tables (tokens, pairs, trades, orders, alerts, sessions)
- [ ] Proper indexes for trading queries (by address, timestamp, network)
- [ ] Model files with typed CRUD operations
- [ ] Migration runner script (`node server/db/migrate.js`)

---

## Stream 2: WebSocket Server

### Files Owned
```
server/ws/
  ├── wsServer.js            # WebSocket server setup
  ├── connectionManager.js   # Track client connections + subscriptions
  ├── messageHandler.js      # Route incoming messages to handlers
  ├── channels/
  │   ├── priceChannel.js    # Price update broadcasting
  │   ├── tradeChannel.js    # Trade event broadcasting
  │   └── statsChannel.js    # Token stats broadcasting
  └── heartbeat.js           # Ping/pong keepalive
```

### Deliverables
- [ ] WebSocket server using `ws` library, attaches to existing HTTP server
- [ ] Connection manager tracking clients and their subscriptions
- [ ] Message router dispatching subscribe/unsubscribe/ping messages
- [ ] Channel handlers that broadcast updates to subscribed clients
- [ ] Heartbeat mechanism (30s interval ping/pong)
- [ ] Graceful disconnect and cleanup

---

## Stream 3: Redis Cache Layer

### Files Owned
```
server/cache/
  ├── redisClient.js         # Redis connection + reconnection
  ├── cacheService.js        # Generic get/set/delete with TTL
  ├── tokenCache.js          # Token-specific cache operations
  ├── priceCache.js          # Price-specific cache with short TTL
  └── pubsub.js              # Redis pub/sub for broadcasting
```

### Deliverables
- [ ] Redis client with connection pooling and reconnection
- [ ] Generic cache service (get, set, delete, getOrFetch pattern)
- [ ] Token cache with 60s TTL
- [ ] Price cache with 2s TTL
- [ ] Pub/sub publisher and subscriber for real-time broadcasts
- [ ] Cache key generation using functions from `packages/shared/`

---

## Stream 4: Frontend WebSocket Client

### Files Owned
```
src/
  ├── services/
  │   └── wsClient.js        # WebSocket client singleton
  └── hooks/
      ├── useWebSocket.js    # Main WS hook (connect, subscribe, state)
      ├── useLivePrice.js    # Subscribe to price updates for a token
      ├── useLiveTrades.js   # Subscribe to live trade feed
      └── useConnectionStatus.js  # WS connection state hook
```

### Deliverables
- [ ] WebSocket client class with auto-reconnection (exponential backoff)
- [ ] `useWebSocket` hook managing connection lifecycle
- [ ] `useLivePrice(tokenAddress, networkId)` — returns live price data
- [ ] `useLiveTrades(tokenAddress, networkId)` — returns live trade feed
- [ ] `useConnectionStatus()` — returns connection state for UI indicator
- [ ] Message serialization/deserialization matching server protocol

---

## Stream 5: REST API Routes

### Files Owned
```
server/routes/
  ├── index.js               # Route registration
  ├── tokenRoutes.js         # /api/v1/tokens/* endpoints
  ├── tradeRoutes.js         # /api/v1/trades/* endpoints
  ├── orderRoutes.js         # /api/v1/orders/* endpoints
  └── portfolioRoutes.js     # /api/v1/portfolio/* endpoints
```

### Deliverables
- [ ] Modular route files (extracted from monolithic `server/index.js`)
- [ ] Versioned API paths (`/api/v1/`)
- [ ] Token routes: search, details, trending, price
- [ ] Trade routes: history by token, history by pair
- [ ] Order routes: create, cancel, list (placeholder for wallet integration)
- [ ] Portfolio routes: positions, PnL summary (placeholder)
- [ ] Input validation using Zod or manual checks

---

## Stream 6: Test Suite

### Files Owned
```
tests/
  ├── setup.js               # Test configuration
  ├── unit/
  │   ├── cacheService.test.js
  │   ├── connectionManager.test.js
  │   ├── messageHandler.test.js
  │   └── tokenModel.test.js
  ├── integration/
  │   ├── tokenRoutes.test.js
  │   ├── tradeRoutes.test.js
  │   └── wsServer.test.js
  └── mocks/
      ├── mockRedis.js
      ├── mockDatabase.js
      └── mockWebSocket.js
```

### Deliverables
- [ ] Test setup with mocks for Redis, PostgreSQL, WebSocket
- [ ] Unit tests for cache service (get, set, TTL, getOrFetch)
- [ ] Unit tests for WS connection manager (add, remove, subscribe)
- [ ] Unit tests for WS message handler (routing, validation)
- [ ] Unit tests for token model (CRUD operations)
- [ ] Integration tests for token API routes
- [ ] Integration tests for trade API routes
- [ ] Integration test for WebSocket server (connect, subscribe, receive)
- [ ] Target: >80% coverage on new code

---

## Stream 7: Error Handling & Logging

### Files Owned
```
server/middleware/
  ├── errorHandler.js        # Express error middleware
  ├── requestLogger.js       # HTTP request logging
  ├── rateLimiter.js         # Rate limiting middleware
  └── validator.js           # Input validation middleware
src/components/
  └── ErrorBoundary.jsx      # React error boundary
  └── ErrorBoundary.css
```

### Deliverables
- [ ] Express error handling middleware (catches all errors, formats response)
- [ ] Request logging middleware (method, path, status, duration)
- [ ] Rate limiter (configurable per-route limits)
- [ ] Input validation middleware (sanitize query params, validate types)
- [ ] React ErrorBoundary component with fallback UI
- [ ] Structured logging format (JSON with timestamp, level, context)

---

## Stream 8: Documentation

### Files Owned
```
docs/
  ├── API.md                 # REST API reference
  ├── WEBSOCKET.md           # WebSocket protocol reference
  ├── DATABASE.md            # Database schema reference
  ├── SETUP.md               # Development setup guide
  └── ARCHITECTURE.md        # System architecture overview
```

### Deliverables
- [ ] REST API reference with all endpoints, params, responses
- [ ] WebSocket protocol reference (message types, channels, examples)
- [ ] Database schema reference (tables, columns, indexes, relationships)
- [ ] Development setup guide (prerequisites, env vars, running locally)
- [ ] Architecture overview diagram and description
