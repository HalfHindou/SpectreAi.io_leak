# Agent — Terminal Data Layer

## Mission
Build every hook, every API call, and the WebSocket manager. Zero UI. Other agents consume what you expose.

## Gate
Gate A. No prerequisites. Runs in parallel with `terminal-shell`.

## Files you own
```
src/features/trading-terminal/api/client.js
src/features/trading-terminal/api/endpoints.js
src/features/trading-terminal/api/socket.js
src/features/trading-terminal/api/mocks/index.js
src/features/trading-terminal/api/mocks/token.js
src/features/trading-terminal/api/mocks/ohlcv.js
src/features/trading-terminal/api/mocks/movers.js
src/features/trading-terminal/api/mocks/insights.js
src/features/trading-terminal/api/mocks/transactions.js
src/features/trading-terminal/hooks/useToken.js
src/features/trading-terminal/hooks/useOHLCV.js
src/features/trading-terminal/hooks/useTransactions.js
src/features/trading-terminal/hooks/useTopMovers.js
src/features/trading-terminal/hooks/useTokenInsights.js
src/features/trading-terminal/hooks/useWallet.js
src/features/trading-terminal/lib/formatNumber.js
src/features/trading-terminal/lib/formatPrice.js
src/features/trading-terminal/lib/formatDuration.js
src/features/trading-terminal/types.js
```

## Files you MUST NOT touch
Any `.jsx` file outside `hooks/` (you don't touch UI). `TradingTerminal.jsx` is terminal-shell's.

## First step
```bash
ls src/features/trading-terminal/api 2>/dev/null
ls src/features/trading-terminal/hooks 2>/dev/null
```
Report if anything exists. Do not overwrite.

## Read before writing
1. `SPECTRE_TERMINAL_BUILD.md` §6 (data contract)
2. `SPECTRE_TERMINAL_BUILD.md` §7 (performance budgets)
3. The existing `spectre-data-api` OpenAPI or route index — find it first before writing client code
4. Any existing `src/api/` or `src/lib/api/` client in the repo — reuse its auth + error handling if present

## Deliverable

All six hooks exposed with the signatures below. Each hook must work with mock data immediately (via `api/mocks/`) if the real endpoint 404s.

### `useToken(chain, address)`
```js
// returns
{
  data: {
    symbol, name, logo, verified,
    price, priceChange24h, mcap, fdv, liquidity, volume24h, holders,
    pair, dex, chain
  } | null,
  error, isLoading, refresh
}
```

### `useOHLCV(chain, address, timeframe)`
```js
// returns
{
  candles: [{ t, o, h, l, c, v }],  // t = unix seconds
  isLoading, error,
  loadMore  // fetches older candles, pagination via `before`
}
```
Timeframes map to API: `1m 5m 15m 1h 4h 1d`.

### `useTransactions(chain, address, { limit = 100 })`
```js
// returns
{
  transactions: [{ id, t, type, price, amount, total, maker, tx }],
  isLoading, error,
  isConnected  // WebSocket state for the table to show reconnecting indicator
}
```
Initial fetch from REST. Live updates prepend via WebSocket. Cap buffer at `limit` rows.

### `useTopMovers(chain)`
Refresh every 30s. SWR `refreshInterval: 30_000`.

### `useTokenInsights(chain, address)`
Single fetch, no polling.

### `useWallet()`
Re-export the existing wallet hook if one exists. If not, create a stub that returns `{ address: null, tier: null, connect: () => {}, disconnect: () => {} }` and add a TODO in `docs/TERMINAL_BUILD_QUESTIONS.md`.

## `api/client.js` contract

```js
// Minimal shape. Match existing repo conventions if they exist.
export const api = {
  get(path, { params, signal } = {}) {
    // attach auth header via existing auth util
    // base URL from import.meta.env.VITE_SPECTRE_API
    // throw typed error on non-2xx with { status, endpoint, body }
  },
  stream(channels, { onMessage, onReconnect }) {
    // returns { unsubscribe }
    // delegates to api/socket.js singleton
  }
};
```

## `api/socket.js` contract

Single WebSocket connection, multiplexed over channels. Reference counting: first subscriber opens, last unsubscribe closes.

- Reconnect: exponential backoff `1s → 2s → 4s → 8s → 16s` cap.
- On reconnect, resend all active subscribe messages.
- Expose `getStatus()` → `'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting'`.
- `onMessage` callbacks receive the raw event `data` parsed as JSON.
- Throttle the outbound subscribe messages (one per 50ms).

## Mock data quality

Mocks must be realistic enough that UI agents can build confidently. MAGA-style meme token shape:
- Price under $0.01 with 5 significant figures
- Mcap in the $10M-$100M range
- Holders 5k-50k
- Candle data: at least 500 candles, smooth trend with 1-2 pump/dump sections so the chart looks alive
- Transactions: 50 rows, 70% buys, varied makers

Put these in `api/mocks/` so they're removable in one commit later.

## Number formatters

`formatNumber.js`
```js
// 1248.37 → "1,248.37"
// 48530000 → "$48.53M"
// 1820000000 → "$1.82B"
// 0 → "$0"
```

`formatPrice.js` — meme-token aware
```js
// 0.04859 → "$0.04859"
// 0.00000123 → "$0.0₅123"  (subscript zero counting)
// 97842 → "$97,842"
```

`formatDuration.js`
```js
// 12 → "12s ago"
// 65 → "1m ago"
// 3700 → "1h ago"
```

Write unit tests (or at least JSDoc examples runnable as a smoke script). Other agents rely on these.

## Performance rules

- `useOHLCV` caches per-`(address, timeframe)` key in SWR. Switching TF back within 60s returns cached instantly.
- WebSocket tick handler writes to a ref buffer. UI reads on `requestAnimationFrame`. Never `setState` per tick.
- `useTransactions` debounces list updates via rAF coalescing: at most one render per frame even if 20 trades arrive.
- Abort in-flight fetches on unmount. Use `AbortController`.
- SWR `dedupingInterval: 2000` on all token metadata fetches.

## Hard rules

- No `axios`. Use `fetch`.
- No `socket.io`. Native `WebSocket`.
- No polling. Live data is WebSocket only.
- No hook may import from any `components/` file. Hooks are pure data.
- Every public function has a JSDoc block with `@param` and `@returns`.
- TypeScript types in `types.js` as JSDoc typedefs (repo uses JS per memory).

## Stop condition

Stop when:
1. All 6 hooks exist, exported from `hooks/index.js` barrel
2. Each hook works with mock data (demo in a dev-only scratch route)
3. WebSocket manager connects, reconnects, multiplexes, and ref-counts correctly
4. Lint passes
5. `docs/TERMINAL_API_GAPS.md` lists any endpoint that wasn't present on `spectre-data-api`

Report: a list of the exported hooks and their signatures, plus the API gaps file.
