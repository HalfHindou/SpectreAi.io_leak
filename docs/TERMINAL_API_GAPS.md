# Terminal — API Gaps

> Auto-logged from `src/pages/terminal/components/use-terminal-data.js`
> when Codex endpoints return 402 (billing), 5xx, or time out.
> Each hook falls back to a deterministic mock; this file tracks what
> still needs a real backend before the page goes from "demo data" mode
> to live data everywhere.

## Current gap status (v1 scaffold — 2026-04-22)

| Surface | Hook | Codex endpoint used | Gap | Status |
|---|---|---|---|---|
| Token header | `useTerminalToken` | `getDetailedTokenInfo` via `/api/codex` | None — works when Codex is billed. Falls back to `MOCK_TOKEN` on 402. | Ready |
| Candles | `useTerminalBars` | `getBars` via `/api/codex` | None — works when Codex is billed. Falls back to `generateMockBars(500)` on 402. | Ready |
| Live trades | `useTerminalTrades` | `getLatestTrades` via `/api/codex`, polled 3s | **WebSocket subscription not wired.** v1 polls. | Needs WS proxy |
| Movers rail | `useTerminalMovers` | `getTrendingTokens` via `/api/codex` | None. Falls back to `MOCK_MOVERS`. | Ready |
| Insights card | `useTerminalInsights` | **Not wired to backend.** Returns `MOCK_INSIGHTS`. | Needs Brain signals endpoint. | Mocked only |
| Footer strip (sentiment/fear-greed/dominance/altcoin) | `useTerminalInsights` | **Not wired to backend.** Returns `MOCK_FOOTER`. | Needs global macro aggregate endpoint. | Mocked only |
| Watchlist (right rail) | inline `MOCK_WATCHLIST` | Not wired. | Integrate existing `WatchlistsContext` → per-user watchlist. | Mocked only |
| Trending tokens (right rail) | inline `MOCK_TRENDING` | Same as movers but with different filter. | Re-use `getTrendingTokens` with different params. | Mocked only |

## Resolution order (suggested)

1. **Wire watchlist + trending right-rail** to existing `WatchlistsContext` and `getTrendingTokens` (easy win, no new backend).
2. **Move polling → subscription** for `useTerminalTrades`. Codex exposes `onTokenEventsCreated` GraphQL subscription; needs a server-side WebSocket proxy in `packages/server` since the browser doesn't hold the Codex API key.
3. **Insights endpoint.** Spectre Brain (`spectre_brain_signals` / `spectre_brain_narratives`) already produces per-asset signals. Expose at `/api/brain/token-insights?chain=&address=` and wire `useTerminalInsights` to it.
4. **Macro aggregate endpoint.** Combine fear-greed + dominance + market cap into one `/api/macro/footer` response. The parts already exist (fear-greed has its own serverless function, CoinGecko has dominance). Server aggregates and caches 60s.

## Mock-detection contract

Every hook that returns mock data sets `__mock: true` on the returned object (or one of its fields). `Terminal.jsx` aggregates those flags and shows a small "Demo data active" pill in the top-right while any panel is mocked. This is deliberate — it's transparent, not failure-mode UI.

## How to remove a mock

Once a real endpoint is wired:

1. Update the hook in `use-terminal-data.js` to consume the new endpoint.
2. Remove the matching mock import from `terminal-mocks.js` if nothing else references it.
3. Delete or update the row above.
4. Smoke-test against `/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump` — the demo-data pill should disappear when the last mock flag clears.
