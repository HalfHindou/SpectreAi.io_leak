# ROI Calculator – Plan

## Goal
Add a **%** button next to **GM** in the header. Clicking it opens an **ROI calculator** where the user can:
1. **Enter or select a project** (token name or symbol, e.g. "Spectre", "BTC").
2. See **current price**, **current market cap**, **ATH** (all-time high price and/or ATH market cap).
3. Enter an **amount** (e.g. $1,000) and see **ROI % to ATH** and **value at ATH**.

Example: *Spectre is $0.33 now, 3.3M MC; ATH was 75M MC → show ROI from current to ATH and “If you put $X today, at ATH that would be $Y.”*

---

## 1. Placement & Trigger
- **Location:** Header, immediately **next to the GM button** (same row as date/time + GM).
- **Control:** A single **%** button (or “ROI” / percent icon).
- **Behavior:** Click opens a **modal** or **slide-over panel** (same pattern as GM opening the zen dashboard) containing the ROI calculator UI.
- **Close:** X button + click outside / Escape (same as GM dashboard).

---

## 2. Data Model & API

### 2.1 What we need per project
| Field | Source | Notes |
|-------|--------|------|
| **Current price** (USD) | CoinGecko | `market_data.current_price.usd` |
| **Current market cap** | CoinGecko | `market_data.market_cap.usd` |
| **ATH price** (USD) | CoinGecko | `market_data.ath.usd` |
| **ATH date** | CoinGecko | `market_data.ath_date.usd` (optional, for display) |
| **ATH market cap** | Derived or API | Can derive: `ath_mcap ≈ current_mcap × (ath_price / current_price)` if supply unchanged |

CoinGecko **GET /coins/{id}** returns `market_data` with:
- `current_price.usd`
- `market_cap.usd`
- `ath.usd`
- `ath_date.usd`

So we can show: **current price**, **current MC**, **ATH price**, **ATH date**, and **ROI % to ATH** = `(ath_price / current_price - 1) * 100`.

### 2.2 Resolving “project” to a coin
- **Known symbols:** If user types "BTC", "ETH", "Spectre" (or symbol from our list), resolve via:
  - **Option A:** Existing `SYMBOL_TO_COINGECKO_ID` for major tokens.
  - **Option B:** **CoinGecko Search** `GET /search?query=spectre` → returns list of coins with `id`, `symbol`, `name`; pick first or let user pick; then **GET /coins/{id}** for full market data (price, mcap, ath).
- **Arbitrary projects:** Use CoinGecko **/search** so user can type "Spectre" and we fetch that coin’s id, then **/coins/{id}** for current + ATH.

### 2.3 New/updated API surface
- **Backend (optional):** Proxy CoinGecko **/coins/{id}** and **/search** to avoid CORS and rate limits. If frontend already calls CoinGecko, we can add:
  - `getCoinMarketData(id)` – fetch one coin by CoinGecko **id**; return `{ currentPrice, marketCap, athPrice, athDate }`.
  - `searchCoins(query)` – call CoinGecko **/search?query=**; return `[{ id, symbol, name }]` for typeahead/selection.
- **Frontend:** New service helpers (e.g. in `coinGeckoApi.js`):
  - `searchCoinsForROI(query)` → list of { id, symbol, name }.
  - `getCoinROIData(coinId)` → { currentPrice, marketCap, athPrice, athDate, symbol, name }.

---

## 3. ROI Calculator UI (inside modal/panel)

### 3.1 Layout (sections)
1. **Project input**
   - Search/typeahead: user types project name or symbol (e.g. "Spectre", "BTC").
   - Results: list of matches (name, symbol, id); on select, load that coin’s data.
   - Optional: show small logo + selected name/symbol after selection.

2. **Current vs ATH (read-only)**
   - **Current:** Price (e.g. $0.33), Market cap (e.g. $3.3M).
   - **ATH:** Price (e.g. $7.50), Date (e.g. “Nov 2021”), optional ATH market cap (e.g. $75M).
   - **ROI to ATH:** Single prominent line, e.g. **“+2,172% to ATH”** (or “X.XXx”).

3. **Amount input**
   - Label: “Amount (USD)” or “If I invest…”
   - Input: number, default e.g. 1000 (dollars).
   - Output: “At ATH that would be **$X,XXX**” (and optionally “+X,XXX% ROI”).

### 3.2 Formulas
- **ROI % to ATH** = `(ath_price / current_price - 1) * 100`.
- **Value at ATH** = `amount_usd * (ath_price / current_price)` = `amount_usd * (1 + roi_pct/100)`.
- **ATH market cap** (if we want to show it): can use CoinGecko if exposed, or approximate: `current_mcap * (ath_price / current_price)`.

### 3.3 Edge cases
- **No ATH / new coin:** If `ath_price` is null or equals current, show “No ATH data” or “—”.
- **Stablecoins:** ROI to ATH is meaningless; we can show “N/A” or hide calculator for USDT/USDC.
- **Search no results:** “No projects found. Try symbol (e.g. BTC) or full name.”
- **Loading:** Skeleton or spinner while fetching coin data after selection.

---

## 4. Implementation Tasks (checklist)

### Phase 1 – Data & API
- [ ] **R1** Add CoinGecko **search**: `GET /search?query=...` (or proxy on backend). Return list `{ id, symbol, name }` for typeahead.
- [ ] **R2** Add CoinGecko **coin by id** with market data: `GET /coins/{id}` and parse `market_data.current_price`, `market_data.market_cap`, `market_data.ath`, `market_data.ath_date` (all `.usd`). Expose as `getCoinROIData(coinId)` (or similar).
- [ ] **R3** (Optional) Resolve symbol → id for known tokens using existing `SYMBOL_TO_COINGECKO_ID` so typing "BTC" doesn’t require search.

### Phase 2 – Header & entry point
- [ ] **H1** In `Header.jsx`, add a **%** button next to the GM button (same container/wrapper as GM).
- [ ] **H2** Wire click to open ROI calculator (e.g. set `roiCalculatorOpen={true}` or open a modal managed by parent state).
- [ ] **H3** Style the % button to match GM (same size, glass/pill style) so it reads as a pair (GM | %).

### Phase 3 – ROI calculator modal/panel
- [ ] **M1** Create `ROICalculator.jsx` (and `ROICalculator.css`): modal or slide-over content that receives `onClose` and (optional) `isOpen`.
- [ ] **M2** Project input: text input + typeahead using `searchCoinsForROI`. On select, call `getCoinROIData(selectedId)` and store in state.
- [ ] **M3** Display block: current price, current MC, ATH price, ATH date; and one line “ROI to ATH: +X%”.
- [ ] **M4** Amount input (USD): number input; below it show “At ATH that would be $X,XXX” and optionally “+X% ROI”.
- [ ] **M5** Handle loading (fetching coin) and empty/error states (no ATH, no results, stablecoin).
- [ ] **M6** Render ROI calculator in App (or layout) when open; focus trap and Escape to close.

### Phase 4 – Polish
- [ ] **P1** Format numbers: compact for large (3.3M, 75M), 2–4 decimals for price and USD result.
- [ ] **P2** Day mode: ensure modal and inputs follow existing day-mode styles.
- [ ] **P3** Mobile: modal full-screen or bottom sheet so amount input and result are usable.

---

## 5. File changes summary

| File | Change |
|------|--------|
| `src/services/coinGeckoApi.js` | Add `searchCoins(query)`, `getCoinROIData(coinId)` (or extend existing coin fetch to return market_data.ath). |
| `src/components/Header.jsx` | Add % button next to GM; state/callback to open ROI calculator. |
| `src/components/Header.css` | Style for `.header-roi-btn` or `.header-percent-btn` (match GM). |
| **New** `src/components/ROICalculator.jsx` | Modal content: project search, current/ATH block, amount input, “At ATH” result. |
| **New** `src/components/ROICalculator.css` | Layout and styling for calculator modal. |
| `src/App.jsx` (or where Header lives) | State `roiCalculatorOpen`; render `<ROICalculator open={roiCalculatorOpen} onClose={...} />`; pass open callback to Header. |

---

## 6. Example copy (Spectre)

- **Current:** $0.33 · MC $3.3M  
- **ATH:** $7.50 · Nov 2021 · MC ~$75M  
- **ROI to ATH:** +2,172%  
- **If I invest $1,000:** At ATH that would be **$22,727** (+2,172% ROI)

This plan keeps the feature scoped to “project → current vs ATH → amount → value at ATH” and reuses CoinGecko for both search and market data.
