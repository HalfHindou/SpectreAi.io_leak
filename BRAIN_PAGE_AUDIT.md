# Brain Page Audit

**Audited:** 2026-04-17
**Component:** `apps/research/src/pages/brain/`
**Data source:** `api.spectreai.io/v1/brain` via Express proxy at `/api/brain`

---

## Section Table

| # | Section | File | Data Source | Endpoint | Loading State | Mock or Real |
|---|---------|------|-------------|----------|---------------|--------------|
| 1 | Header strip (signals 24h, critical, BTC, F&G) | `brain-page.jsx:230-257` BrainHeader | API (state) | `GET /api/brain` -> `.state.signals_24h`, `.state.market_data.fear_greed`, `.state.market_data.top_prices` | None (renders dashes if null) | **REAL** - live data confirmed |
| 2 | LEAN BULL verdict + F&G gauge | `brain-page.jsx:259-399` TheThesis | API (state + conviction) | `GET /api/brain` -> `.conviction.market_stance`, `.conviction.verdict`, `.conviction.confidence`, `.state.market_data.fear_greed` | Shimmer skeleton when loading && no conviction | **REAL** - Groq-synthesized conviction |
| 3 | Short-term / medium-term outlook | `brain-page.jsx:360-375` inside TheThesis | API (conviction) | `GET /api/brain` -> `.conviction.short_term.outlook`, `.conviction.medium_term.outlook` | Falls through to parent shimmer | **REAL** - AI-generated outlook text |
| 4 | Market Pulse table | `brain-page.jsx:402-429` MarketPulse | API (state) | `GET /api/brain` -> `.state.market_data.top_prices` (sliced to 10) | Shimmer rows (8 placeholders) | **REAL** - live CoinGecko prices via brain collector |
| 5 | Derivatives (OI, Funding, Liquidations) | `brain-page.jsx:431-504` Derivatives | API (state) | `GET /api/brain` -> `.state.exchanges.open_interest`, `.state.exchanges.funding_rates`, `.state.exchanges.recent_liquidations` | Shimmer block | **REAL** - exchange data from brain sources |
| 6 | Next Catalyst | `brain-page.jsx:507-562` NextCatalyst | API (state + conviction) | `GET /api/brain` -> `.state.calendar_data.upcoming_events`, `.conviction.catalysts` | "No critical catalysts" fallback text | **REAL** - calendar events from Forex Factory + Snapshot |
| 7 | Active Narratives | `brain-page.jsx:565-611` Narratives | API (narratives + conviction fallback) | `GET /api/brain/narratives` -> `.data[]` OR fallback to `.conviction.active_narratives` | Ghost shimmer cards (3 placeholders) | **REAL** - Groq-synthesized narratives |
| 8 | DeFi Flows (TVL, Top Movers, Best Yield) | `brain-page.jsx:614-661` DefiFlows | API (state) | `GET /api/brain` -> `.state.defi_data.total_tvl`, `.state.defi_data.top_protocols`, `.state.defi_data.top_yields` | Shimmer for TVL only | **REAL** - DefiLlama data via brain collector |
| 9 | Feed (Critical/High/All) | `brain-page.jsx:663-724` SignalFeed | API (signals) | `GET /api/brain/signals?severity=critical,high&hours=24` -> `.data[]` | Shimmer cards (5 placeholders) | **REAL** - 14 signals returned, live from brain_signals table |
| 10 | Whales | `brain-page.jsx:727-775` WhaleActivity | API (state) | `GET /api/brain` -> `.state.onchain_data.recent_whale_moves`, `.state.onchain_data.exchange_flows` | "Watching the deep waters..." fallback | **REAL** - whale BTC transfers confirmed ($66-89M moves) |
| 11 | Trending | `brain-page.jsx:778-807` SocialTrending | API (state) | `GET /api/brain` -> `.state.social_data.trending_topics` | "Scanning the timeline..." fallback | **REAL** - 15 trending assets returned, but sentiment all 0 (data quality issue) |
| 12 | Token Radar | `brain-page.jsx:810-841` TokenRadar | API (trending) | `GET /api/brain/tokens/trending` -> `.data[]` | Shimmer rows (6 placeholders) | **BROKEN** - endpoint 404s (see below) |
| 13 | Track Record | `brain-page.jsx:844-867` TrackRecord | API (trackRecord) | `GET /api/brain/track-record` -> `.stats` | Returns null if no data (component returns null) | **REAL** - 24 total calls, 70% avg accuracy, streak data |
| 14 | History (conviction timeline) | `brain-page.jsx:869-913` ConvictionTimeline | API (convictionHistory) | `GET /api/brain/conviction?limit=20` -> `.data[]` | Shimmer rows (5 placeholders) | **REAL** - 20 conviction entries returned with dedup |

---

## API Endpoints Called

| Endpoint | Proxy Route | Upstream | Interval | Status |
|----------|-------------|----------|----------|--------|
| `GET /api/brain` | `server/index.js:7142` | `api.spectreai.io/v1/brain` | 30s | **WORKING** |
| `GET /api/brain/signals` | `server/index.js:7150` | `api.spectreai.io/v1/brain/signals` | 30s | **WORKING** (14 results) |
| `GET /api/brain/narratives` | `server/index.js:7150` | `api.spectreai.io/v1/brain/narratives` | 2min | **WORKING** (5 results) |
| `GET /api/brain/conviction` | `server/index.js:7150` | `api.spectreai.io/v1/brain/conviction` | 5min | **WORKING** (20 results) |
| `GET /api/brain/tokens/trending` | `server/index.js:7150` | Would be `api.spectreai.io/v1/brain/tokens/trending` | 2min | **404 - BROKEN** |
| `GET /api/brain/track-record` | `server/index.js:7150` | `api.spectreai.io/v1/brain/track-record` | 5min | **WORKING** |

---

## Mock Data Files Referenced

**None.** Zero mock data files, zero hardcoded arrays, zero faker imports. Every section fetches from a real API.

---

## Token Radar — Why It's Empty

The Express proxy route at `server/index.js:7150` is:
```js
app.get('/api/brain/:path', async (req, res) => { ... })
```

This uses a **single-segment param** (`:path`). The endpoint `/api/brain/tokens/trending` has **two segments** (`tokens/trending`), so Express returns `Cannot GET /api/brain/tokens/trending` (HTML 404). The fix is changing the route to `/api/brain/*` or adding a second route for nested paths.

---

## Sections Needing Rewiring When /v1/brain Lands

**None need rewiring.** The page already calls the production data-api at `api.spectreai.io/v1/brain` via the Express proxy. The brain backend is live, writing to TimescaleDB, and returning real synthesized data. The only change needed is fixing the proxy route to handle nested paths (Token Radar).

---

## Design Law Violations

| Violation | Location | Rule |
|-----------|----------|------|
| Numbers not in `var(--font-mono)` | All price/pct displays use inline `fmtNum`/`fmtPct` without mono class | design-system.md section B: "Numbers/prices/percentages: var(--font-mono) ALWAYS" |
| Trending sentiment all 0.0 | `SocialTrending` — all 15 topics have `sentiment: 0`, so every dot is neutral gray | Data quality issue — brain collector's social source isn't computing sentiment |
| Token Radar permanently shows shimmer | 404 means it never loads, so users see 6 shimmer bars forever | Should show fallback text, not infinite shimmer |

---

## Honest Assessment

**This page is a real product, not a mockup.** 13 of 14 sections render live data from a production backend. The data pipeline is: brain-collector (11 sources, 60s cycle) -> Groq synthesizer -> brain_signals/brain_state tables -> `/v1/brain` API -> Express proxy -> React frontend with polled fetches.

The one broken section (Token Radar) is a one-line proxy route fix. The data quality issues (social sentiment all zeros, exchange flows sometimes empty) are upstream collection gaps, not frontend problems.

The architecture is sound: progressive loading with isolated failures, shimmer skeletons, polled refreshes with visibility-aware guards, no mocks anywhere.

---

BRAIN PAGE AUDIT COMPLETE: 13/14 sections real, 0/14 mock. 1/14 broken (Token Radar — proxy route bug, not a data issue).
