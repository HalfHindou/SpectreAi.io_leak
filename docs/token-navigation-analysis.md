# Token Navigation & Data Flow Analysis

Three pages display token data. Each has a different identification strategy.
This doc maps how tokens flow from search → navigation → page → data fetching,
what fields each page needs, and what's broken.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SEARCH (Header.jsx)                        │
│  Codex unified API returns: symbol, name, address, networkId,      │
│  price, change, logo, cgId, tokenId, marketCap, volume             │
└───────────┬─────────────────────────┬───────────────────────────────┘
            │ onSelectTokenAndOpen    │ selectToken
            ▼                         ▼
┌───────────────────────┐   ┌────────────────────────────┐
│  setResearchZoneToken │   │  selectToken (AppState)     │
│  + navigate to RZ     │   │  → localStorage persist     │
│  (app-shell.jsx:214)  │   │  → postMessage to iframe    │
└───────────┬───────────┘   └──────────┬─────────────────┘
            │                           │
            ▼                           ▼
┌──────────────────────┐   ┌──────────────────────────────┐
│  RESEARCH ZONE       │   │  TOKEN PAGE (/token)         │
│  /research-zone/:slug│   │  iframe → Trading App        │
│  URL-driven          │   │  postMessage-driven          │
└──────────────────────┘   └──────────────────────────────┘
                                        │
                                        ▼
                           ┌──────────────────────────────┐
                           │  TRADING APP (standalone)     │
                           │  #token/<address>             │
                           │  address-driven               │
                           └──────────────────────────────┘
```

---

## Page-by-Page Token Identification

### 1. Research Zone (`/research-zone/:coinSlug`)

**Primary key:** URL slug (CoinGecko ID or derived name)
**Context backup:** `researchZoneToken` from AppStateContext

| Step | What happens | File:Line |
|------|-------------|-----------|
| URL slug received | `useParams()` → `coinSlug` | index.jsx:9 |
| Canonical redirect | `/research-zone/btc` → `/research-zone/bitcoin` | index.jsx:28-35 |
| Slug → symbol | `resolveSlugToSymbol(slug)` | index.jsx:37-39 |
| Context match | Compare context `symbol` or `cgId` to slug | index.jsx:42-47 |
| Symbol → address | `CHART_TOKEN_ADDRESSES[sym]` (34 tokens) | rz-lite.jsx:89-103 |
| Unknown fallback | `searchTokens(symbol)` via Codex | rz-lite.jsx:105-118 |
| URL sync | `getTokenSlug()` keeps URL canonical | rz-lite.jsx:201-215 |

**Required fields for correct navigation:**
```
{
  symbol:    "PALM"          // REQUIRED - primary identifier
  name:      "PaLM AI"       // NEEDED for name-based slug ("palm-ai")
  cgId:      "palm-ai"       // PREFERRED - used as slug directly
  address:   "0xf1d..."      // OPTIONAL at nav time (resolved later)
  networkId: 1               // OPTIONAL at nav time (resolved later)
}
```

**How slug is built:**
```
Priority: cgId > SYMBOL_TO_COINGECKO_ID[symbol] > name-derived > symbol.toLowerCase()

Examples:
  ETH + cgId=null    → "ethereum"      (from SYMBOL_TO_COINGECKO_ID)
  PALM + cgId=null   → "palm-ai"       (from name "PaLM AI")
  PALM + cgId="palm-ai" → "palm-ai"    (cgId used directly)
  AAPL (stock)       → "aapl"          (symbol lowercased)
```

**How slug resolves back:**
```
"bitcoin"    → BTC           (COINGECKO_ID_TO_SYMBOL reverse map)
"btc"        → redirect to "bitcoin" (getCanonicalSlug)
"palm-ai"    → PALM-AI       (uppercased, WRONG for symbol)
             → BUT context match on cgId saves it (index.jsx:44)
             → Direct URL access: searches "PALM-AI" via Codex (fragile)
```

---

### 2. Token Page (`/token`) — Research App iframe wrapper

**Primary key:** `token` from AppStateContext (no URL params for token)
**Communication:** postMessage to Trading App iframe

| Step | What happens | File:Line |
|------|-------------|-----------|
| Read context | `useAppState().token` | token/index.jsx:13 |
| Build iframe | `?embedded=true#token` (no token in URL) | token/index.jsx:24-28 |
| Send token | `postMessage('spectre:select-token', token)` | token/index.jsx:36-39 |
| Sync changes | Re-sends on `token` change | token/index.jsx:55-63 |

**Required fields:**
```
{
  symbol:    "PALM"          // REQUIRED - display
  name:      "PaLM AI"       // REQUIRED - display
  address:   "0xf1d..."      // CRITICAL - chart data, on-chain lookups
  networkId: 1               // CRITICAL - determines chain for API calls
  logo:      "https://..."   // display
  price:     0.0288          // initial display before live fetch
  change:    2.67            // initial display
}
```

**Note:** Token page does NOT use cgId or tokenId - those are unused by the Trading app.

---

### 3. Trading App (`#token/<address>`) — Standalone

**Primary key:** Contract address (EVM `0x...` or Solana base58)
**State source:** postMessage (embedded) or localStorage (standalone)

| Step | What happens | File:Line |
|------|-------------|-----------|
| Embedded mode | Receives `spectre:select-token` postMessage | App.jsx:173-178 |
| Standalone | Reads from localStorage `spectre-selected-token` | App.jsx:257-266 |
| Deep link | Parse `#token/<address>`, search Codex | App.jsx:339-367 |
| Cache prewarm | `prewarmTokenDetailsCache()` + `prefetchChartBars()` | App.jsx:176-177 |
| Data fetch | `useTokenDetails(address, networkId)` | useCodexData.js:1188 |
| Chart data | `useChartData(address, resolution, networkId)` | useCodexData.js:683 |

**Required fields:**
```
{
  address:   "0xf1d..."      // CRITICAL - ALL data lookups use this
  networkId: 1               // CRITICAL - chain identification
  symbol:    "PALM"          // display only
  name:      "PaLM AI"       // display only
}
```

**Without address:** Chart renders empty, token details fetch fails, on-chain data unavailable.

---

## Field Flow: Search → Pages

```
Search API Response
│
├─ symbol ──────────────── ✓ tokenData ──── ✓ selectToken ──── ✓ Token Page
├─ name ────────────────── ✓ tokenData ──── ✓ selectToken ──── ✓ Token Page
├─ address (as .ca) ────── ✓ tokenData ──── ✓ selectToken ──── ✓ Token Page
├─ networkId ───────────── ✓ tokenData ──── ✓ selectToken ──── ✓ Token Page
├─ price ───────────────── ✓ tokenData ──── ✓ selectToken ──── ✓ Token Page
├─ change ──────────────── ✓ tokenData ──── ✓ selectToken ──── ✓ Token Page
├─ logo ────────────────── ✓ tokenData ──── ✓ selectToken ──── ✓ Token Page
├─ cgId ────────────────── ✓ tokenData ──── ✓ selectToken ──── ✓ RZ (slug match)
├─ tokenId ─────────────── ✓ tokenData ──── ✓ selectToken ──── unused
│
├─ volume ──────────────── ✗ LOST at tokenData construction
├─ liquidity ───────────── ✗ LOST at tokenData construction
├─ marketCap ───────────── ✗ LOST at tokenData construction
├─ network (chain name) ── ✗ LOST at tokenData construction
└─ formattedMcap ────────  display only, not persisted
```

### Search History (RECENT tokens)

```
Saved to localStorage 'searchHistoryTokens':
  symbol, name, logo, price, change, mcap, liquidity,
  network, ca, networkId, cgId, tokenId

On re-click from RECENT:
  tokenData.cgId  = token.cgId   ← NOW SAVED (was missing before fix)
  tokenData.name  = token.name   ← available for slug derivation
```

### Watchlist tokens

```
Saved to watchlist:
  symbol, name, price, change, marketCap, logo,
  address, networkId, pinned, isStock, sector, exchange

MISSING: cgId, tokenId
→ Navigation from watchlist to RZ uses getTokenSlug(symbol, isStock, cgId=undefined, name)
→ Falls back to name-derived slug or lowercased symbol
```

---

## Bugs & Issues

### BUG 1: Name-based slugs don't round-trip (PARTIALLY FIXED)

**Scenario:** Navigate to `/research-zone/palm-ai` via direct URL (no context)

```
resolveSlugToSymbol('palm-ai')
→ Not in COINGECKO_ID_TO_SYMBOL
→ Not in SYMBOL_TO_COINGECKO_ID (as 'PALM-AI')
→ Returns 'PALM-AI' (uppercased slug)
→ RZ lite searches Codex for 'PALM-AI' — may not find 'PALM'
```

**Status:** Partially fixed - works when navigating from search (context carries data).
Breaks on direct URL access/bookmark/share.

**Fix needed:** `resolveSlugToSymbol` should strip hyphens and try matching, OR
the search API should handle hyphenated queries, OR store a slug→symbol map.

---

### BUG 2: RZ URL canonicalization fights name-based slugs (FIXED)

**Was:** After navigating to `/research-zone/palm-ai`, the URL sync effect
would rewrite to `/research-zone/palm` because `getTokenSlug('PALM')` = `'palm'`.

**Fix applied:** rz-lite.jsx now checks if current slug already resolves to the
same symbol before overwriting.

---

### BUG 3: cgId missing from search history (FIXED)

**Was:** `addToHistory()` in header.jsx didn't save `cgId` or `tokenId`.
Clicking a RECENT token always had `cgId: null`.

**Fix applied:** Now saves `cgId` and `tokenId` in history.

---

### BUG 4: cgId missing from watchlist

**Scenario:** User adds PALM to watchlist. Later clicks it from watchlist.

```
watchlist token = { symbol: 'PALM', name: 'PaLM AI', address: '0x...', ... }
// NO cgId field
getTokenSlug('PALM', false, undefined, 'PaLM AI')
→ name fallback → 'palm-ai' ← works because name is present
```

**Status:** Works by accident (name fallback). But if name were missing, slug = `'palm'`.
Should explicitly save `cgId` in watchlist entries too.

---

### BUG 5: Token page doesn't carry address for some tokens

**Scenario:** BTC has `address: ''` in `defaultBTCToken` (AppStateContext:24).
Token page sends this to Trading app via postMessage.

```
Trading app receives: { symbol: 'BTC', address: '', networkId: 1 }
→ useTokenDetails('', 1) → fails, no data
→ Chart: useChartData('', ...) → can't resolve pool → empty chart
```

**Status:** Trading app has its own address resolution (deep-link search),
but embedded mode relies on parent sending valid address.

**Impacted tokens:** XRP, ADA, DOT, and others in CHART_TOKEN_ADDRESSES with `address: null`.

---

### BUG 6: `setResearchZoneToken` is a raw `useState` setter - no normalization

**Scenario:** Different callers pass different shapes.

```
// app-shell.jsx:214 — passes tokenData directly (has cgId, name, address)
setResearchZoneToken(tokenData)

// app-shell.jsx:188 — passes defaultBTCToken (NO cgId, address is '')
setResearchZoneToken(defaultBTCToken)

// discover/index.jsx:25 — passes tokenData (may or may not have cgId)
setResearchZoneToken(tokenData)
```

**Contrast with `selectToken`:** Goes through normalization (AppStateContext:46-63).
`setResearchZoneToken` does NOT normalize. Whatever shape you pass is stored as-is.

**Fix needed:** Either wrap in a normalizer like selectToken, or document required shape.

---

### BUG 7: Search API `cg_id` field unreliable

**Root cause:** The unified search API (`/api/search/tokens`) proxies to KD's backend
(`appresearchbeta-.../fetch_tokens`). Whether `cg_id` is populated depends on KD's data.

For obscure tokens, `cg_id` may be `null`. This cascades:
- `getTokenSlug` can't use cgId → falls to name derivation
- Research Zone context match may fail
- URL may not be canonical

**Mitigation applied:** Name-based slug fallback. But true fix requires reliable `cg_id`.

---

## Ideal Token Data Shape

Every navigation entry point should construct this object:

```javascript
{
  // Identity (REQUIRED)
  symbol:    string,        // 'PALM' — ticker symbol
  name:      string,        // 'PaLM AI' — display name

  // On-chain resolution (REQUIRED for Token page / Trading app)
  address:   string | null, // '0xf1d...' — EVM or Solana address
  networkId: number,        // 1 = ETH, 56 = BSC, 1399811149 = SOL

  // Slug resolution (REQUIRED for Research Zone)
  cgId:      string | null, // 'palm-ai' — CoinGecko ID, used as URL slug

  // Display (nice to have)
  logo:      string | null, // logo URL
  price:     number,        // current price
  change:    number,        // 24h change %

  // Optional
  tokenId:   string | null, // Codex internal ID
  marketCap: number | null, // for display
  volume:    number | null, // for display
}
```

---

## Fix Priority

| # | Issue | Impact | Effort | Status |
|---|-------|--------|--------|--------|
| 1 | cgId not saved in search history | RZ gets wrong URL from RECENT | Small | FIXED |
| 2 | RZ URL sync overwrites name slugs | URL flickers from palm-ai to palm | Small | FIXED |
| 3 | Name-based slug fallback | PALM → palm instead of palm-ai | Small | FIXED |
| 4 | Direct URL `/research-zone/palm-ai` breaks | PALM-AI searched, may not resolve | Medium | OPEN |
| 5 | cgId missing from watchlist entries | RZ URL wrong from watchlist nav | Small | OPEN |
| 6 | setResearchZoneToken has no normalization | Inconsistent context shape | Small | OPEN |
| 7 | BTC/XRP/ADA have no address in context | Trading app chart empty | Medium | OPEN |
| 8 | Search API cgId unreliable | All slug generation affected | Large (backend) | OPEN |
