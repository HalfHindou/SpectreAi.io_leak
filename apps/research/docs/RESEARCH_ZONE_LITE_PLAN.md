# Research Zone – Structure Plan

## Overview

**Research Zone** has two modes: **LITE** and **PRO**. This plan covers **LITE** only, using a typical CoinMarketCap (CMC) structure: token page with chart, and **Markets** section directly under the chart.

Reference: [CoinMarketCap Bitcoin page](https://coinmarketcap.com/currencies/bitcoin/)

---

## LITE Mode – Layout (CMC-style)

### 1. Page shell

- **Route / entry**: Research Zone is a distinct page (e.g. `currentPage === 'research-zone'`), reachable from nav/sidebar.
- **Mode toggle**: Top of page or in header – **LITE** | **PRO** (PRO disabled or placeholder).
- **Token context**: Page shows one selected token (e.g. BTC, ETH, SOL). Token comes from:
  - URL param (e.g. `?symbol=BTC`), or
  - App state when navigating from Discover / “Research” / “Deep dive”.
  - If no token: show token selector or default (e.g. BTC).

### 2. Three-column layout

| Column   | Role |
|----------|------|
| **Left** | Token overview: logo, name, symbol, rank; price + change; key metrics; optional links. |
| **Center** | Main content: tabs (Chart, Markets, News, About). Default tab = Chart. **Under the chart** = Markets section (same content as “Markets” tab). |
| **Right** | Optional for LITE v1: Buy CTA, Community sentiment, or defer to later. |

### 3. Left column – Token overview

- **Header**: Token logo, name, symbol, rank (#1, #2, …).
- **Price**: Large price, 24h or 1M change (e.g. “−0.39% (1M)”).
- **Optional**: One AI prompt link (e.g. “Why is BTC’s price down today?”) – can be placeholder.
- **Key metrics** (glass cards or list):
  - Market cap (+ % change)
  - Volume (24h) (+ % change)
  - Vol/Mkt Cap (24h)
  - FDV (Fully Diluted Valuation)
  - Circulating supply
  - Max supply (if applicable)
- **Profile score** (optional): e.g. green bar “100%”.
- **Links** (optional for LITE): Website, Whitepaper, Socials, Explorers.

### 4. Center column – Tabs + Chart + Markets

- **Tabs**: **Chart** (default) | **Markets** | **News** | **About**.
- **Chart tab**:
  - **Timeframe**: 24h, 1W, 1M, 1Y, All, Log.
  - **Chart**: TradingView embed or existing `TradingChart` (same as AI Screener).
  - **Below the chart** (no extra click): **Markets** section (same as Markets tab).
- **Markets section** (under chart and/or Markets tab):
  - Heading: “[Token] Markets” (e.g. “Bitcoin Markets”).
  - **Filters**: ALL | CEX | DEX | Spot | Perpetual | Futures + “Filters” button (funnel icon).
  - **Table**:
    - Columns: **#** | **Exchange** | **Pair** | **Price** | **±2% / −2% Depth** | **Volume (24h)** | **Volume %** | **Liquidity**.
    - Rows: one per exchange/pair (Binance, Coinbase, OKX, Bybit, etc.); mock data for LITE.
- **News tab**: Placeholder or simple feed.
- **About tab**: Token description (from API or static).

### 5. Right column (LITE v1 – optional)

- **Buy [Token]** button.
- **Community sentiment**: “Bullish / Bearish” bar (e.g. 81% / 19%); can be mock.
- Or collapse/omit for first version and add in a later task.

### 6. Data

- **Token overview**: Use existing Codex/API or mock for BTC, ETH, SOL (price, market cap, volume, supply).
- **Markets table**: Mock list of 8–12 rows (exchanges: Binance, Coinbase, Upbit, OKX, Bybit, Bitget, Gate, KuCoin, etc.) with Pair, Price, Depth, Volume 24h, Volume %, Liquidity.

### 7. Styling

- Reuse app design system: glass panels, dark theme, same as Welcome / On-Chain.
- Tables: same header/row/hover style as On-Chain table.
- Responsive: on small screens, collapse to single column (stack left → center → right or center-only).

---

## Task breakdown (one by one)

| # | Task | Description |
|---|------|--------------|
| 1 | **Research Zone shell + mode toggle** | New page/route for Research Zone; LITE \| PRO toggle (PRO disabled); token from URL or state (default e.g. BTC). |
| 2 | **LITE layout – three columns** | Left sidebar (fixed width), center (flex), right sidebar (optional); responsive stacking. |
| 3 | **Left column – token overview** | Logo, name, symbol, rank; price + change; key metrics (market cap, volume, FDV, supply). |
| 4 | **Center – Chart tab + chart** | Tabs (Chart, Markets, News, About); Chart tab with timeframe selector and TradingChart (or TradingView embed). |
| 5 | **Markets section under chart** | “[Token] Markets” heading; filters (ALL, CEX, DEX, Spot, Perpetual, Futures); table (Exchange, Pair, Price, Depth, Volume 24h, Volume %, Liquidity); mock data. |
| 6 | **Markets tab + polish** | Markets tab shows same table; optional Right column (Buy, Sentiment); design pass and integration (e.g. open Research Zone from Discover with token). |

---

## Out of scope for LITE (later / PRO)

- PRO mode content.
- Real markets API (use mock for LITE).
- News/About real data (placeholders ok).
- Community sentiment persistence.
