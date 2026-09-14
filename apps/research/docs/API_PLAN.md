# API Plan: Top Tokens & On-Chain Data

## Goal
- **Real-time on-chain data**: Codex API (primary).
- **Fallback**: CoinGecko API when Codex fails or returns no data.
- **Refresh**: 60 seconds (no immediate refresh).
- **Scope**: Search, Welcome widgets, Command Center, Watchlists (main + sub), Top coins, prices/volumes/mcaps, AI screener charts.

---

## 1. API Keys (server only)

| API        | Purpose                    | Env var           | Where used      |
|-----------|----------------------------|-------------------|-----------------|
| Codex      | Real-time on-chain (primary) | `CODEX_API_KEY`   | Server only     |
| CoinGecko  | Price/data fallback        | `COINGECKO_API_KEY`| Server only     |

- Keys live in **root `.env`** (never committed). `.env.example` documents names only.
- Server reads env and proxies all requests; frontend never sees keys.
- CoinGecko: free tier works with empty key; Pro key improves rate limits.

---

## 2. Data Flow (choose what works)

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React)                                               │
│  - Search bar (main + watchlist sub): useTokenSearch()           │
│  - Watchlist prices: useWatchlistPrices()                       │
│  - Discover / Top coins: useTrendingTokens() + prices           │
│  - Curated prices (Welcome): useCuratedTokenPrices()            │
│  - Charts (AI screener): useChartData() → getBars               │
│  All call server /api/* (relative URL → Vite proxy in dev)     │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Server (Node, port 3001)                                       │
│  - GET /api/tokens/search?q=          → Codex filterTokens       │
│  - GET /api/tokens/trending           → Codex filterTokens       │
│  - GET /api/tokens/prices?symbols=    → Codex then CoinGecko     │
│  - GET /api/token/details             → Codex token + market     │
│  - GET /api/bars?symbol=&from=&to=     → Codex getTokenBars      │
│  - GET /api/binance-ticker            → Binance (no key)        │
└─────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
       Codex (primary)      CoinGecko (fallback)    Binance (optional)
       graph.codex.io       pro-api.coingecko.com    api.binance.com
       Authorization key   x-cg-pro-api-key         public
```

- **Prices (single/batch)**: Codex first → if no data or error, CoinGecko. Server already does this in `getPriceForSymbol` and `/api/tokens/prices`.
- **Search**: Codex only (no CoinGecko search).
- **Top/Trending**: Codex `filterTokens` by volume; if empty, frontend can show fallback list + fetch prices via `/api/tokens/prices` (Codex+CG).
- **Charts**: Codex `getTokenBars` only; no fallback (graceful empty state).

---

## 3. Refresh Rates (60s target)

| Surface              | Current        | Target   | Notes                    |
|---------------------|----------------|----------|---------------------------|
| Watchlist prices    | 30s            | 60s      | useWatchlistPrices        |
| Discover / Top coins| 5min / 3s      | 60s      | useTrendingTokens, prices |
| Curated prices     | 5min           | 60s      | useCuratedTokenPrices     |
| Chart data         | 15s            | 60s      | useChartData (optional)   |
| Search              | Debounce 300ms | No change| On keystroke only         |
| Token details (banner) | 5min        | 60s      | useTokenDetails           |

---

## 4. Where Data Is Used

| Feature              | Search | Prices | Vol/Mcap | Top list | Charts |
|----------------------|--------|--------|----------|----------|--------|
| Search bar (main)    | ✓ Codex| -      | -        | -        | -      |
| Search bar (watchlist)| ✓ Codex| -      | -        | -        | -      |
| Welcome widgets      | -      | ✓      | ✓        | ✓        | -      |
| Command Center       | -      | ✓      | ✓        | ✓        | -      |
| Watchlist (main)     | ✓      | ✓      | ✓        | -        | -      |
| Watchlist (sub page) | ✓      | ✓      | ✓        | -        | -      |
| Top coins / Discover | -      | ✓      | ✓        | ✓ Codex  | -      |
| AI screener / Charts | -      | -      | -        | -        | ✓ Codex|

---

## 5. Implementation Tasks (in order)

1. **Env & server**
   - Ensure `.env.example` has `CODEX_API_KEY` and `COINGECKO_API_KEY` (placeholders).
   - Confirm server uses `CODEX_API_KEY` for Codex and `COINGECKO_API_KEY` for CoinGecko Pro base URL and header; validate Codex auth header format if needed.

2. **Unify price source**
   - Watchlist: use server `/api/tokens/prices` (Codex → CoinGecko) as primary; optional Binance fallback if server fails; refresh 60s.
   - Discover / curated: same server batch prices; refresh 60s.

3. **Top tokens**
   - Trending: GET `/api/tokens/trending` (Codex); include Solana in `networkFilter`.
   - When trending returns empty: frontend fallback list + fetch prices via `/api/tokens/prices` so prices/volumes/mcaps still work.

4. **Search**
   - Single path: `useTokenSearch` → `searchTokens` → GET `/api/tokens/search`. Used in main page and watchlist subpage; no duplicate logic.

5. **Charts**
   - Keep Codex `/api/bars`; 60s refresh optional; show clear empty/error state when no bars.

6. **Refresh rates**
   - Set 60s for: useWatchlistPrices, useCuratedTokenPrices, useTrendingTokens, useTokenDetails; optionally useChartData.

---

## 6. Files to Touch

- **Server**: `server/index.js` (env usage, Codex auth, CoinGecko Pro header if key set).
- **Env**: `.env.example` (document keys); user creates `.env` with real keys.
- **Frontend**: `src/services/codexApi.js` (ensure all calls relative `/api` for proxy), `src/hooks/useCodexData.js` (refresh intervals, optional fallbacks), `src/hooks/useWatchlistPrices.js` (primary server prices, 60s).

No new APIs with low rate limits required; 60s refresh keeps usage within Codex + CoinGecko limits.
