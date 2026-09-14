# Research Zone Unified Data Flow - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented data fetching in research-zone with a single unified hook that provides one canonical price to header, chart, and sidebar - while eliminating all mock data.

**Architecture:** New server endpoint `/api/token/resolve` exposes the existing `token-registry.js` to the client. New `useResearchZoneData` hook centralizes all data fetching with cache/dedup. Mock data file stripped down to utility-only constants.

**Tech Stack:** React 18 hooks, Express route, Vercel serverless function, existing Binance/CoinGecko/Codex service files.

**Spec:** `docs/superpowers/specs/2026-04-07-research-zone-data-flow-design.md`

---

### Task 1: Server endpoint `/api/token/resolve`

**Files:**
- Modify: `packages/server/index.js` (add route)
- Read: `packages/server/lib/token-registry.js` (existing helpers)

- [ ] **Step 1: Add the Express route**

Add this route near the other token-related routes (around line 3527 where `/api/token/details` lives). The route wraps the existing `token-registry.js` helpers with CoinGecko and Codex fallback for unknown symbols.

```js
// ── Token resolve endpoint ─────────────────────────────────────────────────
app.get('/api/token/resolve', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase().trim();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });

  const cacheKey = `token-resolve:${symbol}`;
  const cached = getCached(cache.details, cacheKey, 3600000); // 1 hour TTL
  if (cached) return res.json(cached);

  // 1. Check token-registry.js (instant, 50+ tokens)
  const registryInfo = getTokenInfo(symbol);
  if (registryInfo) {
    const result = {
      symbol,
      name: registryInfo.name || symbol,
      cgId: registryInfo.coingeckoId || null,
      binancePair: registryInfo.binanceSymbol || null,
      address: registryInfo.address || null,
      networkId: registryInfo.networkId || null,
    };
    setCached(cache.details, cacheKey, result, 3600000);
    return res.json(result);
  }

  // 2. Check SYMBOL_TO_COINGECKO_ID map (covers tokens in CG but not in registry)
  const cgId = SYMBOL_TO_COINGECKO_ID[symbol] || null;

  // 3. Codex search fallback (for DEX tokens not in registry)
  let codexAddress = null;
  let codexNetworkId = null;
  let codexName = symbol;
  try {
    const query = `{
      filterTokens(phrase: "${symbol}", limit: 5) {
        results {
          token { address symbol name networkId }
        }
      }
    }`;
    const codexResult = await executeCodexQuery(query);
    const tokens = codexResult?.filterTokens?.results || [];
    const match = tokens.find(r => (r.token?.symbol || '').toUpperCase() === symbol) || tokens[0];
    if (match?.token) {
      codexAddress = match.token.address || null;
      codexNetworkId = match.token.networkId || null;
      codexName = match.token.name || symbol;
    }
  } catch (_) { /* Codex search is best-effort */ }

  // 4. Derive binancePair by convention if not in registry
  const derivedBinancePair = `${symbol}USDT`;

  const result = {
    symbol,
    name: codexName,
    cgId: cgId,
    binancePair: derivedBinancePair,
    address: codexAddress,
    networkId: codexNetworkId,
  };
  setCached(cache.details, cacheKey, result, 3600000);
  res.json(result);
});
```

Note: `getTokenInfo`, `executeCodexQuery`, `getCached`, `setCached`, `SYMBOL_TO_COINGECKO_ID`, and `cache.details` are all already available in `index.js` scope.

- [ ] **Step 2: Verify the route works**

Run: `cd packages/server && node -e "console.log('server starts')" && cd ../..`

Then with the dev server running, test:
```bash
curl -s http://localhost:3001/api/token/resolve?symbol=BTC | head -c 200
curl -s http://localhost:3001/api/token/resolve?symbol=SPECTRE | head -c 200
curl -s http://localhost:3001/api/token/resolve?symbol=UNKNOWN_TOKEN | head -c 200
```

Expected: JSON with `{ symbol, name, cgId, binancePair, address, networkId }` for each.

- [ ] **Step 3: Commit**

```bash
git add packages/server/index.js
git commit -m "feat(server): add /api/token/resolve endpoint for dynamic token identity"
```

---

### Task 2: Serverless function `token-resolve.js`

**Files:**
- Create: `apps/research/api/token-resolve.js`
- Read: `apps/research/api/binance-ticker.js` (reference for CORS pattern)

- [ ] **Step 1: Create the serverless function**

This must exist for production (Vercel). It mirrors the Express route but uses the token-registry module directly.

```js
/**
 * Vercel Serverless - Token identity resolution.
 * Returns cgId, binancePair, address, networkId for a given symbol.
 * Uses token-registry.js as primary source, Codex search as fallback.
 */
const { getTokenInfo } = require('../../packages/server/lib/token-registry');

const CODEX_API_KEY = process.env.CODEX_API_KEY;
const CODEX_URL = 'https://graph.codex.io/graphql';

// CoinGecko ID map for tokens not in registry but known
const SYMBOL_TO_COINGECKO_ID = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
  USDT: 'tether', USDC: 'usd-coin', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  LINK: 'chainlink', DOT: 'polkadot', MATIC: 'matic-network', UNI: 'uniswap',
  LTC: 'litecoin', SHIB: 'shiba-inu', ARB: 'arbitrum', OP: 'optimism',
  PEPE: 'pepe', FLOKI: 'floki', WIF: 'dogwifcoin', AAVE: 'aave',
  CRV: 'curve-dao-token', MKR: 'maker', GRT: 'the-graph', RENDER: 'render-token',
  INJ: 'injective-protocol', FET: 'fetch-ai', BONK: 'bonk', TIA: 'celestia',
  SEI: 'sei-network', SUI: 'sui', APT: 'aptos', ATOM: 'cosmos', NEAR: 'near',
  ONDO: 'ondo-finance', TAO: 'bittensor', SPECTRE: 'spectre-ai',
};

// HOSTILE-DOMAIN NOTE (2026-05-18): this snippet originally listed
// `https://spectre.bot` - that domain is NOT team-owned per secy
// MEMORY.md FIX-RT03. Replaced with canonical prod hosts. Do NOT
// reintroduce spectre.bot in any new code.
const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181',
  'https://app.spectreai.io',
  'https://spectre-app-research.vercel.app',
  'https://spectre-trading.vercel.app',
];

// Simple in-memory cache (per cold-start lifetime)
const _cache = {};
function getCached(key, ttlMs) {
  const e = _cache[key];
  if (!e) return null;
  if (Date.now() - e.ts > ttlMs) { delete _cache[key]; return null; }
  return e.data;
}
function setCached(key, data) { _cache[key] = { data, ts: Date.now() }; }

module.exports = async function handler(req, res) {
  const origin = req.headers?.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const symbol = (req.query.symbol || '').toUpperCase().trim();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol parameter' });

  // Check cache
  const cacheKey = `resolve:${symbol}`;
  const cached = getCached(cacheKey, 3600000);
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.json(cached);
  }

  // 1. Token registry (primary)
  const info = getTokenInfo(symbol);
  if (info) {
    const result = {
      symbol,
      name: info.name || symbol,
      cgId: info.coingeckoId || null,
      binancePair: info.binanceSymbol || null,
      address: info.address || null,
      networkId: info.networkId || null,
    };
    setCached(cacheKey, result);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.json(result);
  }

  // 2. CoinGecko ID lookup
  const cgId = SYMBOL_TO_COINGECKO_ID[symbol] || null;

  // 3. Codex search fallback
  let codexAddress = null, codexNetworkId = null, codexName = symbol;
  if (CODEX_API_KEY) {
    try {
      const query = JSON.stringify({
        query: `{ filterTokens(phrase: "${symbol}", limit: 5) { results { token { address symbol name networkId } } } }`,
      });
      const r = await fetch(CODEX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY },
        body: query,
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const data = await r.json();
        const tokens = data?.data?.filterTokens?.results || [];
        const match = tokens.find(t => (t.token?.symbol || '').toUpperCase() === symbol) || tokens[0];
        if (match?.token) {
          codexAddress = match.token.address || null;
          codexNetworkId = match.token.networkId || null;
          codexName = match.token.name || symbol;
        }
      }
    } catch (_) { /* best-effort */ }
  }

  const result = {
    symbol,
    name: codexName,
    cgId,
    binancePair: `${symbol}USDT`,
    address: codexAddress,
    networkId: codexNetworkId,
  };
  setCached(cacheKey, result);
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
  res.json(result);
};
```

- [ ] **Step 2: Add Vercel rewrite if needed**

Check `apps/research/vercel.json` for rewrite patterns. If rewrites use a wildcard `/api/:path*`, this function will be picked up automatically. If not, add a rewrite entry.

- [ ] **Step 3: Commit**

```bash
git add apps/research/api/token-resolve.js
git commit -m "feat(serverless): add token-resolve function for production"
```

---

### Task 3: Create `data/rz-constants.js` (stripped mock-data replacement)

**Files:**
- Create: `apps/research/src/pages/research-zone/data/rz-constants.js`
- Read: `apps/research/src/pages/research-zone/data/mock-data.js` (source of kept items)

- [ ] **Step 1: Create the stripped constants file**

Extract only the non-mock utilities from `mock-data.js`. Everything else is deleted.

```js
/**
 * Research Zone - Constants and utility functions.
 * All mock data has been removed. Token data comes from APIs via useResearchZoneData hook.
 */

export const DEFAULT_SYMBOL = 'BTC'

export const MARKET_FILTERS = [
  { id: 'all', label: 'ALL' },
  { id: 'cex', label: 'CEX' },
  { id: 'dex', label: 'DEX' },
  { id: 'spot', label: 'Spot' },
  { id: 'perpetual', label: 'Perpetual' },
  { id: 'futures', label: 'Futures' },
]

export function formatChange(n) {
  if (n == null || Number.isNaN(n)) return '0.00'
  return Number(n).toFixed(2)
}

export function formatNewsTime(publishedOn) {
  if (!publishedOn) return ''
  const sec = Math.floor(Date.now() / 1000) - Number(publishedOn)
  if (sec < 60) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`
  return `${Math.floor(sec / 604800)}w`
}

// Grade color mapping (used by overview tab for real API data display)
export const GRADE_COLORS = {
  'A+': '#10B981', 'A': '#10B981', 'A-': '#34D399',
  'B+': '#FBBF24', 'B': '#F59E0B', 'B-': '#F97316',
  'C+': '#F97316', 'C': '#EF4444', 'C-': '#EF4444',
  'D': '#DC2626', 'F': '#991B1B',
}

export const GRADE_PCT = {
  'A+': 97, 'A': 90, 'A-': 85,
  'B+': 78, 'B': 70, 'B-': 63,
  'C+': 55, 'C': 48, 'C-': 40,
  'D': 30, 'F': 15,
}

// Technical analysis data generators (compute from real price data, not mock)
export { generateMAData, generateOscillatorData, calculatePivotPoints, generateTechnicalSummary } from './mock-data'
```

Note: The technical analysis generators (`generateMAData`, `generateOscillatorData`, `calculatePivotPoints`, `generateTechnicalSummary`) compute from real price/change inputs - they are pure functions, not mock data. We re-export them from the old file temporarily. They will be inlined or moved in a later cleanup.

- [ ] **Step 2: Commit**

```bash
git add apps/research/src/pages/research-zone/data/rz-constants.js
git commit -m "feat(rz): create rz-constants.js with non-mock utilities"
```

---

### Task 4: Create `useResearchZoneData` hook

**Files:**
- Create: `apps/research/src/pages/research-zone/hooks/use-research-zone-data.js`
- Read: `apps/research/src/services/rzDataService.js` (absorb cache/dedup pattern)
- Read: `apps/research/src/services/binanceApi.js`, `coinGeckoApi.js`, `codexApi.js` (call directly)
- Read: `apps/research/src/services/stockApi.js` (for stock mode)
- Read: `apps/research/src/hooks/useAdaptivePolling.js` (for polling)

This is the largest task. The hook replaces ~400 lines in research-zone-lite.jsx and all of rzDataService.js.

- [ ] **Step 1: Create the hook file with cache/dedup infrastructure**

```js
/**
 * useResearchZoneData - Unified data hook for the research-zone page.
 *
 * Provides a single canonical price shared by header, chart, and sidebar.
 * All token identity comes from /api/token/resolve (no hardcoded registry).
 * All mock data fallbacks have been removed - returns null with loading states.
 *
 * Price priority: Binance ticker > CoinGecko > Codex
 * Polling: price 15s, market 60s, onchain 30s
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getBinancePrices } from '@/services/binanceApi'
import { getCoinMarketDataBySymbol, getCoinDetails, getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import { getDetailedTokenInfo, searchTokens } from '@/services/codexApi'
import { getStockQuote, getStockQuotes, getCompanyProfile, getStockLogoUrl, FALLBACK_STOCK_DATA } from '@/services/stockApi'

// ---------------------------------------------------------------------------
// Module-level cache for token resolution (session lifetime)
// ---------------------------------------------------------------------------
const _tokenCache = new Map()

async function resolveTokenIdentity(symbol) {
  if (!symbol) return null
  const upper = symbol.toUpperCase()
  if (_tokenCache.has(upper)) return _tokenCache.get(upper)

  try {
    const res = await fetch(`/api/token/resolve?symbol=${encodeURIComponent(upper)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    _tokenCache.set(upper, data)
    return data
  } catch (err) {
    console.error('[RZ Data] Token resolve failed:', err?.message)
    // Return minimal identity so the page can still render
    const fallback = { symbol: upper, name: upper, cgId: null, binancePair: null, address: null, networkId: null }
    _tokenCache.set(upper, fallback)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Cache + dedup for data fetches (from rzDataService.js pattern)
// ---------------------------------------------------------------------------
const _cache = {}
const _inflight = {}

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) { delete _cache[key]; return null }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

function _deduped(cacheKey, ttlMs, fetchFn) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]
  const promise = fetchFn()
    .then(data => { _setCached(cacheKey, data); delete _inflight[cacheKey]; return data })
    .catch(err => { delete _inflight[cacheKey]; console.error(`[RZ Data] ${cacheKey}:`, err?.message); return null })
  _inflight[cacheKey] = promise
  return promise
}

const TTL = {
  price: 10_000,
  meta: 60_000,
  details: 300_000,
  onchain: 30_000,
  trending: 300_000,
}

// ---------------------------------------------------------------------------
// Data fetchers (pure async functions, no React)
// ---------------------------------------------------------------------------

async function fetchPrice(symbol, binancePair, cgId) {
  const sym = symbol.toUpperCase()

  // 1. Binance (primary)
  if (binancePair) {
    try {
      const data = await getBinancePrices([sym])
      const row = data?.[sym]
      if (row && row.price > 0) {
        return {
          current: row.price,
          change24h: row.change || 0,
          high24h: row.highPrice || 0,
          low24h: row.lowPrice || 0,
          volume24h: row.volume || 0,
          source: 'binance',
        }
      }
    } catch (_) { /* fall through */ }
  }

  // 2. CoinGecko (fallback)
  if (cgId) {
    try {
      const cg = await getCoinMarketDataBySymbol(sym)
      if (cg && cg.price > 0) {
        return {
          current: cg.price,
          change24h: cg.change24h || 0,
          high24h: cg.high24h || 0,
          low24h: cg.low24h || 0,
          volume24h: cg.volume24h || 0,
          source: 'coingecko',
        }
      }
    } catch (_) { /* fall through */ }
  }

  // 3. Codex (last resort for DEX-only tokens)
  try {
    const cg = await getCoinMarketDataBySymbol(sym)
    if (cg && cg.price > 0) {
      return {
        current: cg.price,
        change24h: cg.change24h || 0,
        high24h: cg.high24h || 0,
        low24h: cg.low24h || 0,
        volume24h: cg.volume24h || 0,
        source: 'coingecko',
      }
    }
  } catch (_) { /* fall through */ }

  return null
}

async function fetchMarket(symbol) {
  return _deduped(`market:${symbol}`, TTL.meta, async () => {
    const cg = await getCoinMarketDataBySymbol(symbol)
    if (!cg) return null
    return {
      mcap: cg.mcap || 0,
      fdv: cg.fdv || null,
      circulatingSupply: cg.circulating || null,
      totalSupply: cg.maxSupply || null,
      volMcapPct: cg.volMcapPct || '0',
      ath: cg.ath || null,
      athDate: cg.athDate || null,
      athChangePct: cg.athChangePct || null,
      atl: cg.atl || null,
      atlDate: cg.atlDate || null,
      atlChangePct: cg.atlChangePct || null,
      // Also extract fields that go to token and performance
      _logo: cg._image || null,
      _name: cg._name || null,
      _rank: cg.rank || null,
      _change1h: cg.change1h || 0,
      _change7d: cg.change7d || 0,
      _change30d: cg.change30d || 0,
      _sparkline7d: cg.sparkline7d || null,
      _coingeckoId: cg._coingeckoId || null,
    }
  })
}

async function fetchAbout(symbol, cgId) {
  return _deduped(`about:${cgId || symbol}`, TTL.details, async () => {
    const details = await getCoinDetails(symbol, cgId)
    return details || null
  })
}

async function fetchOnchain(address, networkId) {
  if (!address) return null
  return _deduped(`onchain:${address}`, TTL.onchain, async () => {
    const info = await getDetailedTokenInfo(address, networkId || 1)
    if (!info) return null
    return {
      holders: info.holders || null,
      liquidity: info.liquidity || info.totalLiquidityUsd || null,
      txnCount24: info.txnCount24 || null,
      age: info.age || null,
    }
  })
}

async function fetchTrending() {
  return _deduped('trending', TTL.trending, async () => {
    const coins = await getTopCoinsMarketsPage(1, 20)
    if (!Array.isArray(coins)) return []
    return coins.map(c => ({
      id: c.id,
      symbol: (c.symbol || '').toUpperCase(),
      image: c.image,
      current_price: c.current_price,
      price_change_percentage_24h: c.price_change_percentage_24h,
    }))
  })
}

// Stock data fetchers
async function fetchStockPrice(symbol) {
  try {
    const quote = await getStockQuote(symbol)
    if (quote?.price != null && Number.isFinite(quote.price)) {
      return {
        current: quote.price,
        change24h: quote.change || 0,
        high24h: quote.high || 0,
        low24h: quote.low || 0,
        volume24h: quote.volume || 0,
        source: 'stock',
        _stockData: quote,
      }
    }
  } catch (_) { /* fall through */ }
  return null
}

const STOCK_TRENDING_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'AMD', 'NFLX', 'DIS', 'BA', 'GS', 'COST']

async function fetchStockTrending(currentSymbol) {
  const symbols = STOCK_TRENDING_SYMBOLS.filter(s => s !== currentSymbol)
  try {
    const quotes = await getStockQuotes(symbols)
    return symbols.map(s => {
      const q = quotes[s]
      if (!q) return null
      return {
        id: s,
        symbol: s,
        name: q.name,
        image: getStockLogoUrl(s),
        current_price: q.price,
        price_change_percentage_24h: q.change,
        isStock: true,
      }
    }).filter(Boolean)
  } catch (_) { return [] }
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

const EMPTY_PRICE = { current: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, source: null }
const EMPTY_MARKET = { mcap: 0, fdv: null, circulatingSupply: null, totalSupply: null, volMcapPct: '0', ath: null, athDate: null, athChangePct: null, atl: null, atlDate: null, atlChangePct: null }
const EMPTY_PERFORMANCE = { change1h: 0, change7d: 0, change30d: 0, change1y: null, sparkline7d: null }

export default function useResearchZoneData(symbol, options = {}) {
  const { isStock = false, marketMode = 'crypto' } = options

  // State
  const [tokenIdentity, setTokenIdentity] = useState(null)
  const [price, setPrice] = useState(EMPTY_PRICE)
  const [market, setMarket] = useState(EMPTY_MARKET)
  const [performance, setPerformance] = useState(EMPTY_PERFORMANCE)
  const [onchain, setOnchain] = useState(null)
  const [about, setAbout] = useState(null)
  const [trending, setTrending] = useState([])
  const [stockData, setStockData] = useState(null)

  const [loading, setLoading] = useState({
    token: true,
    price: true,
    market: true,
    onchain: true,
    about: true,
  })

  const setLoadingField = useCallback((field, value) => {
    setLoading(prev => prev[field] === value ? prev : { ...prev, [field]: value })
  }, [])

  const sym = (symbol || '').toUpperCase()

  // ── 1. TOKEN RESOLUTION ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sym) return
    let cancelled = false

    // Reset all state on symbol change
    setTokenIdentity(null)
    setPrice(EMPTY_PRICE)
    setMarket(EMPTY_MARKET)
    setPerformance(EMPTY_PERFORMANCE)
    setOnchain(null)
    setAbout(null)
    setStockData(null)
    setLoading({ token: true, price: true, market: true, onchain: true, about: true })

    if (isStock) {
      // Stocks don't need token resolution
      const stockIdent = { symbol: sym, name: FALLBACK_STOCK_DATA[sym]?.name || sym, cgId: null, binancePair: null, address: null, networkId: null }
      setTokenIdentity(stockIdent)
      setLoadingField('token', false)
    } else {
      resolveTokenIdentity(sym).then(identity => {
        if (cancelled) return
        setTokenIdentity(identity)
        setLoadingField('token', false)
      })
    }

    return () => { cancelled = true }
  }, [sym, isStock, setLoadingField])

  // ── 2. PARALLEL DATA FETCH (after token resolved) ────────────────────────
  useEffect(() => {
    if (!tokenIdentity) return
    let cancelled = false
    const { symbol: resolvedSym, cgId, binancePair, address, networkId } = tokenIdentity

    if (isStock) {
      // Stock: fetch price + company profile + trending
      fetchStockPrice(resolvedSym).then(p => {
        if (cancelled) return
        if (p) {
          setPrice(p)
          setStockData(p._stockData || null)
          // Build market from stock data
          const sd = p._stockData
          if (sd) {
            setMarket({
              mcap: sd.marketCap || 0,
              fdv: null,
              circulatingSupply: null,
              totalSupply: null,
              volMcapPct: sd.marketCap ? ((sd.volume || 0) / sd.marketCap * 100).toFixed(1) : '0',
              ath: sd.week52High || null,
              athDate: null,
              athChangePct: sd.week52High && sd.price ? ((sd.price - sd.week52High) / sd.week52High * 100) : null,
              atl: sd.week52Low || null,
              atlDate: null,
              atlChangePct: sd.week52Low && sd.price ? ((sd.price - sd.week52Low) / sd.week52Low * 100) : null,
            })
          }
        }
        setLoadingField('price', false)
        setLoadingField('market', false)
      })

      getCompanyProfile(resolvedSym).then(profile => {
        if (cancelled) return
        if (profile) {
          setAbout({
            description: `${profile.name} (${profile.symbol}) trades on the ${profile.exchange || 'US'} exchange in the ${profile.sector || 'N/A'} sector.`,
            links: { website: profile.website || '' },
            categories: [profile.sector, profile.industry].filter(Boolean),
          })
          // Update token identity with real name
          setTokenIdentity(prev => prev ? { ...prev, name: profile.name || prev.name } : prev)
        }
        setLoadingField('about', false)
      })

      setLoadingField('onchain', false) // no on-chain for stocks
      fetchStockTrending(resolvedSym).then(t => { if (!cancelled) setTrending(t) })
    } else {
      // Crypto: parallel fetch all data sources
      // Price (Binance primary)
      fetchPrice(resolvedSym, binancePair, cgId).then(p => {
        if (cancelled) return
        if (p) setPrice(p)
        setLoadingField('price', false)
      })

      // Market metadata (CoinGecko) - also extracts logo, rank, performance
      fetchMarket(resolvedSym).then(m => {
        if (cancelled) return
        if (m) {
          const { _logo, _name, _rank, _change1h, _change7d, _change30d, _sparkline7d, _coingeckoId, ...marketData } = m
          setMarket(marketData)
          setPerformance({ change1h: _change1h, change7d: _change7d, change30d: _change30d, change1y: null, sparkline7d: _sparkline7d })
          // Enrich token identity with CoinGecko data
          setTokenIdentity(prev => {
            if (!prev) return prev
            return {
              ...prev,
              logo: _logo || prev.logo,
              name: _name || prev.name,
              rank: _rank || prev.rank,
              cgId: _coingeckoId || prev.cgId,
            }
          })
        }
        setLoadingField('market', false)
      })

      // About (CoinGecko details - description, links, categories)
      fetchAbout(resolvedSym, cgId).then(a => {
        if (cancelled) return
        if (a) {
          setAbout(a)
          // Enrich token identity with categories
          if (a.categories?.length > 0) {
            setTokenIdentity(prev => prev ? { ...prev, categories: a.categories } : prev)
          }
        }
        setLoadingField('about', false)
      })

      // On-chain (Codex)
      if (address) {
        fetchOnchain(address, networkId).then(o => {
          if (cancelled) return
          setOnchain(o)
          setLoadingField('onchain', false)
        })
      } else {
        setLoadingField('onchain', false)
      }

      // Trending (background, no loading state)
      fetchTrending().then(t => { if (!cancelled) setTrending(t) })
    }

    return () => { cancelled = true }
  }, [tokenIdentity, isStock, setLoadingField])

  // ── 3. POLLING ───────────────────────────────────────────────────────────
  const pollPrice = useCallback(() => {
    if (!tokenIdentity) return
    if (isStock) {
      fetchStockPrice(tokenIdentity.symbol).then(p => {
        if (p) {
          setPrice(p)
          if (p._stockData) setStockData(p._stockData)
        }
      })
    } else {
      fetchPrice(tokenIdentity.symbol, tokenIdentity.binancePair, tokenIdentity.cgId).then(p => {
        if (p) setPrice(p)
      })
    }
  }, [tokenIdentity, isStock])

  const pollMarket = useCallback(() => {
    if (!tokenIdentity || isStock) return
    // Invalidate cache so we get fresh data
    delete _cache[`market:${tokenIdentity.symbol}`]
    fetchMarket(tokenIdentity.symbol).then(m => {
      if (m) {
        const { _logo, _name, _rank, _change1h, _change7d, _change30d, _sparkline7d, _coingeckoId, ...marketData } = m
        setMarket(marketData)
        setPerformance({ change1h: _change1h, change7d: _change7d, change30d: _change30d, change1y: null, sparkline7d: _sparkline7d })
      }
    })
  }, [tokenIdentity, isStock])

  const pollOnchain = useCallback(() => {
    if (!tokenIdentity?.address || isStock) return
    delete _cache[`onchain:${tokenIdentity.address}`]
    fetchOnchain(tokenIdentity.address, tokenIdentity.networkId).then(o => {
      if (o) setOnchain(o)
    })
  }, [tokenIdentity, isStock])

  useAdaptivePolling(pollPrice, { interval: isStock ? 30_000 : 15_000, enabled: !!tokenIdentity })
  useAdaptivePolling(pollMarket, { interval: 60_000, enabled: !!tokenIdentity && !isStock })
  useAdaptivePolling(pollOnchain, { interval: 30_000, enabled: !!tokenIdentity?.address && !isStock })

  // ── 4. RETURN VALUE ──────────────────────────────────────────────────────
  const token = useMemo(() => ({
    symbol: tokenIdentity?.symbol || sym,
    name: tokenIdentity?.name || sym,
    cgId: tokenIdentity?.cgId || null,
    binancePair: tokenIdentity?.binancePair || null,
    address: tokenIdentity?.address || null,
    networkId: tokenIdentity?.networkId || null,
    logo: tokenIdentity?.logo || null,
    rank: tokenIdentity?.rank || null,
    categories: tokenIdentity?.categories || [],
  }), [tokenIdentity, sym])

  const chartToken = useMemo(() => ({
    symbol: tokenIdentity?.symbol || sym,
    address: tokenIdentity?.address || null,
    networkId: tokenIdentity?.networkId || null,
    isStock,
  }), [tokenIdentity, sym, isStock])

  return {
    token,
    price,
    market,
    performance,
    onchain,
    about,
    chartToken,
    trending,
    loading,
    stockData,
  }
}
```

- [ ] **Step 2: Verify the hook file has no syntax errors**

Run: `cd apps/research && npx -y acorn --ecma2022 --module src/pages/research-zone/hooks/use-research-zone-data.js > /dev/null 2>&1 && echo "OK" || echo "SYNTAX ERROR"`

If acorn is not available, just verify the build in the next task.

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/research-zone/hooks/use-research-zone-data.js
git commit -m "feat(rz): add useResearchZoneData unified data hook"
```

---

### Task 5: Integrate hook into `research-zone-lite.jsx`

**Files:**
- Modify: `apps/research/src/pages/research-zone/components/research-zone-lite.jsx`

This is the biggest modification. We remove ~400 lines of data fetching and replace with one hook call + thin adapter. News, prediction markets, and Spectre API sentiment fetching stay.

- [ ] **Step 1: Replace imports**

Remove these imports from the top of the file:

```js
// REMOVE these imports:
import { getRzLivePrice, getRzTokenMeta, getRzTokenDetails, getRzOnChainData, getRzMarkets, getRzTrending } from '@/services/rzDataService'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { useChartData } from '@/hooks/useCodexData'
import { searchTokens } from '@/services/codexApi'
```

Remove these mock-data imports:
```js
// REMOVE from the mock-data import:
// TOKEN_NAMES, CHART_TOKEN_ADDRESSES, RZ_TOKEN_LOGOS,
// MOCK_TOKEN_DATA, MOCK_CATEGORIES, MOCK_MARKETS,
// MOCK_TWEETS, MOCK_AGENT_SIGNALS, MOCK_PREDICTION_MARKETS,
```

Replace with:
```js
import useResearchZoneData from '../hooks/use-research-zone-data'
import { DEFAULT_SYMBOL, MARKET_FILTERS, formatChange, formatNewsTime } from '../data/rz-constants'
```

Keep the stock-related imports (`getStockQuote`, `getStockQuotes`, `getStockLogoUrl`, `getCompanyProfile`, `FALLBACK_STOCK_DATA`) because the stock-specific news fetching uses them.

- [ ] **Step 2: Replace state declarations and data fetching**

Inside the component, after `const [symbol, setSymbol] = useState(...)`, add the hook call:

```js
const data = useResearchZoneData(symbol, { isStock, marketMode })
```

Remove these state declarations and their related useEffect blocks:
- `const [activeTokenInfo, setActiveTokenInfo]` and its syncing useEffect (lines ~79-120)
- `const [coinMarketData, setCoinMarketData]` and its fetch useEffect (lines ~148, 363-381)
- `const [tokenLoading, setTokenLoading]` (line ~151)
- `const [liveTickerPrice, setLiveTickerPrice]` and `[liveTickerData, setLiveTickerData]` (lines ~428-468)
- `const [trendingTokens, setTrendingTokens]` and its fetch useEffect (lines ~384-425)
- `const [aboutDetails, setAboutDetails]` and its fetch useEffect (lines ~146, 340-361)
- `const [onChainData, setOnChainData]` and its fetch useEffect (lines ~479-493)
- `const [marketsData, setMarketsData]` and its fetch/polling useEffects (lines ~308-335)
- `const [stockData, setStockData]` (line ~338)
- `const { bars: priceBars }` useChartData call (line ~565)
- `const livePriceAndChange` useMemo (lines ~566-576)
- `const baseTokenData` assignment (line ~579)
- The entire `tokenData` useMemo block (lines ~585-699) - including the 100-line merge logic
- `const resolvedCgId` (line ~311)
- `fetchStockPrice` and `fetchCryptoPrice` callbacks and their pollings (lines ~432-468)

Replace the 100-line tokenData useMemo with this thin adapter:

```js
const tokenData = useMemo(() => {
  if (isStock && data.stockData) {
    const sd = data.stockData
    return {
      price: data.price.current,
      change24h: data.price.change24h,
      rank: null,
      mcap: data.market.mcap,
      marketCap: data.market.mcap,
      volume24h: data.price.volume24h,
      volume: data.price.volume24h,
      fdv: null,
      volMcapPct: data.market.volMcapPct,
      circulatingSupply: null,
      maxSupply: null,
      circulating: null,
      pe: sd.pe,
      forwardPe: sd.forwardPe || null,
      eps: sd.eps,
      sector: sd.sector,
      industry: sd.industry || sd.sector || '',
      exchange: sd.exchange,
      week52High: sd.week52High,
      week52Low: sd.week52Low,
      avgVolume: sd.avgVolume,
      country: sd.country || 'US',
      description: sd.description || '',
      ipo: sd.ipo || null,
      employees: sd.employees || null,
      ceo: sd.ceo || null,
      website: sd.website || '',
      dividendYield: sd.dividendYield || null,
      beta: sd.beta || null,
      sharesOutstanding: sd.sharesOutstanding || null,
      previousClose: sd.previousClose || null,
      open: sd.open || null,
      dayHigh: sd.high || null,
      dayLow: sd.low || null,
      ath: data.market.ath,
      athDate: null,
      athChangePct: data.market.athChangePct,
      atl: data.market.atl,
      atlDate: null,
      atlChangePct: data.market.atlChangePct,
      score: null,
      low24h: data.price.low24h,
      high24h: data.price.high24h,
    }
  }
  return {
    price: data.price.current,
    change24h: data.price.change24h,
    change1h: data.performance.change1h,
    rank: data.token.rank,
    mcap: data.market.mcap,
    marketCap: data.market.mcap,
    volume24h: data.price.volume24h,
    volume: data.price.volume24h,
    fdv: data.market.fdv,
    volMcapPct: data.market.volMcapPct,
    circulatingSupply: data.market.circulatingSupply,
    circulating: data.market.circulatingSupply,
    maxSupply: data.market.totalSupply,
    ath: data.market.ath,
    athDate: data.market.athDate,
    athChangePct: data.market.athChangePct,
    atl: data.market.atl,
    atlDate: data.market.atlDate,
    atlChangePct: data.market.atlChangePct,
    score: null,
    low24h: data.price.low24h,
    high24h: data.price.high24h,
  }
}, [data.price, data.market, data.performance, data.token.rank, isStock, data.stockData])
```

- [ ] **Step 3: Update variable references throughout the JSX**

Replace these throughout the render section:

| Old reference | New reference |
|---|---|
| `tokenName` | `data.token.name` (or keep a local: `const tokenName = data.token.name`) |
| `activeTokenInfo` | `data.chartToken` |
| `coinMarketData` | `data.market` |
| `liveTickerPrice` | `data.price.current` |
| `liveTickerData` | (removed - not used directly in JSX) |
| `trendingTokens` | `data.trending` |
| `aboutDetails` | `data.about` |
| `onChainData` | `data.onchain` |
| `tokenLoading` | `data.loading.token \|\| data.loading.price` |
| `coinMarketData?.image` or `RZ_TOKEN_LOGOS[symbol]` | `data.token.logo` |
| `TOKEN_NAMES[symbol]` | `data.token.name` |
| `CHART_TOKEN_ADDRESSES[symbol]` | `data.chartToken` |
| `marketsData` | keep - still fetched in-component if markets section stays |

Keep the `tokenName` variable for backward compat with child component props:
```js
const tokenName = isStock
  ? (data.stockData?.name || FALLBACK_STOCK_DATA[symbol]?.name || data.token.name || symbol)
  : (data.token.name || symbol)
```

Keep the `chartToken` variable:
```js
const chartToken = data.chartToken
```

Update the sentiment style useMemo to use `tokenData?.change24h` (already does).

Update how `displayColors` is derived (already uses `symbol`, no change needed).

- [ ] **Step 4: Update child component props**

Update the RzHeroBanner call:
```jsx
<RzHeroBanner
  symbol={symbol}
  tokenName={tokenName}
  tokenData={tokenData}
  isStock={isStock}
  aboutDetails={data.about}
  icons={icons}
  fmtPrice={fmtPrice}
  formatChange={formatChange}
  displayColors={displayColors}
  tokenLogo={data.token.logo}
  loading={data.loading.token || data.loading.price}
/>
```

Update the RzChartSection call:
```jsx
<RzChartSection
  trendingTokens={data.trending}
  chartToken={chartToken}
  livePrice={data.price.current}
  dayMode={dayMode}
  onSymbolChange={handleSymbolChange}
  // ... other props stay the same
/>
```

Update the sidebar/pro props to pass `data.about?.categories || []` instead of mock categories.

- [ ] **Step 5: Remove MOCK_ references from passed props**

Find all places where `MOCK_TWEETS`, `MOCK_AGENT_SIGNALS`, `MOCK_PREDICTION_MARKETS`, `MOCK_TOKEN_DATA`, `MOCK_CATEGORIES` are passed as props and replace:

```js
// OLD:
agentSignals={MOCK_AGENT_SIGNALS[symbol] || MOCK_AGENT_SIGNALS.BTC}
tweets={MOCK_TWEETS[symbol] || MOCK_TWEETS.BTC}
mockPredictionMarkets={MOCK_PREDICTION_MARKETS[symbol] || MOCK_PREDICTION_MARKETS.BTC}
categories={aboutDetails?.categories?.length > 0 ? aboutDetails.categories : (MOCK_CATEGORIES[symbol] || MOCK_CATEGORIES.BTC)}
mockTokenData={MOCK_TOKEN_DATA}

// NEW:
agentSignals={[]}
tweets={[]}
mockPredictionMarkets={[]}
categories={data.about?.categories || []}
// Remove mockTokenData prop entirely
```

- [ ] **Step 6: Remove the markets fetch (now handled by existing getRzMarkets or keep as-is)**

The markets data fetch (`getRzMarkets`) is used only by `RzMarketsSection` which is not one of the 3 core sections (header/chart/sidebar). Keep the markets fetch in-component BUT replace the `getRzMarkets` import. Since `rzDataService.js` is being deleted, import `getTokenMarkets` from `coinGeckoApi.js` directly:

```js
import { getTokenMarkets } from '@/services/coinGeckoApi'
```

And update the markets fetch effect to use `getTokenMarkets` instead of `getRzMarkets`:

```js
const resolvedCgId = data.token.cgId
// ... markets fetch effect uses getTokenMarkets(symbol, resolvedCgId)
```

- [ ] **Step 7: Build and verify**

Run: `npm run build:research`

Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/research/src/pages/research-zone/components/research-zone-lite.jsx
git commit -m "refactor(rz): replace data fetching with useResearchZoneData hook"
```

---

### Task 6: Remove mock data from child components

**Files:**
- Modify: `apps/research/src/pages/research-zone/components/rz-hero-banner.jsx`
- Modify: `apps/research/src/pages/research-zone/components/rz-pro-sidebar.jsx`
- Modify: `apps/research/src/pages/research-zone/components/rz-feed-panel.jsx`
- Modify: `apps/research/src/pages/research-zone/components/rz-overview-tab.jsx`
- Modify: `apps/research/src/pages/research-zone/components/rz-markets-section.jsx`
- Modify: `apps/research/src/pages/research-zone/components/rz-token-panel.jsx`
- Modify: `apps/research/src/pages/research-zone/components/rz-technicals-tab.jsx`
- Modify: `apps/research/src/pages/research-zone/components/rz-token-popup.jsx`
- Modify: `apps/research/src/pages/research-zone/components/research-zone-pro.jsx`

- [ ] **Step 1: rz-hero-banner.jsx**

Remove: `import { MOCK_CATEGORIES } from '../data/mock-data'`

Change the category fallback:
```js
// OLD:
const categoryLabel = isStock
  ? (tokenData.sector || 'Stock')
  : (aboutDetails?.categories?.[0] || MOCK_CATEGORIES[symbol]?.[0] || tokenName);

// NEW:
const categoryLabel = isStock
  ? (tokenData.sector || 'Stock')
  : (aboutDetails?.categories?.[0] || tokenName);
```

- [ ] **Step 2: rz-pro-sidebar.jsx**

Remove these imports:
```js
// REMOVE:
import { PRO_MOCK_CATEGORIES as MOCK_CATEGORIES, getDefaultMockData } from '../data/mock-data'
import { RZ_TOKEN_LOGOS } from '../data/mock-data'
```

In `RzInfoPanel`, change categories:
```js
// OLD:
const categories = mockData?.categories || MOCK_CATEGORIES[sym] || MOCK_CATEGORIES.BTC || []

// NEW:
const categories = props.categories || []
```

Add `categories` to the component's props (passed from parent).

In `RzInfoPanel` price card, replace `RZ_TOKEN_LOGOS[sym]`:
```js
// OLD:
{RZ_TOKEN_LOGOS[sym] ? (
  <img src={RZ_TOKEN_LOGOS[sym]} alt={sym} className="rzrp-price-card-logo" />
) : (

// NEW:
{props.tokenLogo ? (
  <img src={props.tokenLogo} alt={sym} className="rzrp-price-card-logo" />
) : (
```

Add `tokenLogo` to the component's props.

In the main `RzProSidebar` component, remove the `mockData` line:
```js
// REMOVE:
const mockData = useMemo(() => getDefaultMockData(sym), [sym])
```

Pass `categories` and `tokenLogo` through from the parent component props.

- [ ] **Step 3: rz-feed-panel.jsx**

Remove: `import { MOCK_AGENT_SIGNALS, formatNewsTime } from '../data/mock-data'`
Add: `import { formatNewsTime } from '../data/rz-constants'`

Replace the agent signals fallback:
```js
// OLD:
{(agentSignals?.length > 0 ? agentSignals : (MOCK_AGENT_SIGNALS[symbol] || MOCK_AGENT_SIGNALS.BTC)).map((signal) => (

// NEW:
{(agentSignals || []).length > 0 ? agentSignals.map((signal) => (
  // ... existing rendering
)) : (
  <div className="rz-feed-empty">No agent signals available</div>
)}
```

- [ ] **Step 4: rz-overview-tab.jsx**

Remove imports:
```js
// REMOVE:
import { MOCK_TOKEN_DATA, MOCK_PREDICTION_MARKETS, MOCK_FUNDAMENTALS_GRADES } from '../data/mock-data'
```

Add: `import { GRADE_COLORS, GRADE_PCT } from '../data/rz-constants'`

Replace fundamentals grades:
```js
// OLD:
const grades = MOCK_FUNDAMENTALS_GRADES[sym] || MOCK_FUNDAMENTALS_GRADES.BTC

// NEW (hide section when no real data):
const grades = props.fundamentalsGrades || null
```

If `grades` is null, hide the fundamentals section:
```jsx
{grades && (
  // ... existing grade rendering
)}
```

Replace prediction markets:
```js
// OLD:
const predictions = (MOCK_PREDICTION_MARKETS[symbol] || MOCK_PREDICTION_MARKETS.BTC || []).slice(0, 3)

// NEW:
const predictions = (props.predictionMarkets || []).slice(0, 3)
```

If predictions is empty, show an empty state instead of mock data.

- [ ] **Step 5: rz-markets-section.jsx**

Remove: `import { MARKET_FILTERS, MOCK_PREDICTION_MARKETS } from '../data/mock-data'`
Add: `import { MARKET_FILTERS } from '../data/rz-constants'`

Replace prediction markets fallback:
```js
// OLD:
{(predictionMarkets.length > 0 ? predictionMarkets : (MOCK_PREDICTION_MARKETS[symbol] || MOCK_PREDICTION_MARKETS.BTC)).map((row, i) => (

// NEW:
{predictionMarkets.length > 0 ? predictionMarkets.map((row, i) => (
  // ... existing rendering
)) : (
  <div className="rz-feed-empty">No prediction markets available</div>
)}
```

- [ ] **Step 6: rz-token-panel.jsx**

Remove:
```js
import { DEFAULT_SYMBOL, RZ_TOKEN_LOGOS, MOCK_TOKEN_DATA, MOCK_CATEGORIES } from '../data/mock-data'
```
Add:
```js
import { DEFAULT_SYMBOL } from '../data/rz-constants'
```

Replace token panel entries that use mock data:
```js
// OLD:
: (MOCK_CATEGORIES[symbol] || [])

// NEW:
: []
```

```js
// OLD:
const mock = MOCK_TOKEN_DATA[s] || MOCK_TOKEN_DATA[DEFAULT_SYMBOL]

// NEW (use real data from props or show skeleton):
// The token panel should receive real data via props, not look up mocks
```

Replace `RZ_TOKEN_LOGOS` usages with the `tokenLogo` prop or a fallback letter avatar.

- [ ] **Step 7: rz-technicals-tab.jsx**

Remove mock import:
```js
// REMOVE:
import { MOCK_TECHNICAL_INDICATORS } from '../data/mock-data'
```

The technicals tab uses `generateMAData`, `generateOscillatorData`, `calculatePivotPoints`, `generateTechnicalSummary` which are computational functions (not mock data). Re-import them from `rz-constants.js` which re-exports them:

```js
import { generateMAData, generateOscillatorData, calculatePivotPoints, generateTechnicalSummary } from '../data/rz-constants'
```

Remove any `MOCK_TECHNICAL_INDICATORS` usage and show empty state if no data.

- [ ] **Step 8: rz-token-popup.jsx**

Remove:
```js
import { getHistorySparkline, getTokenPredictions } from '../data/mock-data'
```

Replace `getHistorySparkline` with real sparkline from CoinGecko data (passed as prop):
```js
// The sparkline should come from the token's real sparkline_in_7d data
// passed as a prop from the parent. If not available, show no sparkline.
const sparklineData = props.sparkline || []
```

Remove `getTokenPredictions` usage - show empty state for predictions.

- [ ] **Step 9: research-zone-pro.jsx**

Remove:
```js
import { getDefaultMockData } from '../data/mock-data'
```

Remove:
```js
const mockData = useMemo(() => getDefaultMockData(sym), [sym])
```

Replace all `mockData.xxx` references with real data from props. The parent (`research-zone-lite.jsx`) should pass the real data instead.

- [ ] **Step 10: Build and verify**

Run: `npm run build:research`

Expected: Build succeeds with no errors. No remaining imports from `../data/mock-data` except through `rz-constants.js` re-exports.

Verify no mock-data references remain:
```bash
grep -r "mock-data" apps/research/src/pages/research-zone/components/ --include="*.jsx" --include="*.js" | grep -v "rz-constants"
```

Expected: No results (or only the old `mock-data.js` file itself, which we keep for the re-exported technical generators).

- [ ] **Step 11: Commit**

```bash
git add apps/research/src/pages/research-zone/components/
git commit -m "refactor(rz): remove all mock data from research-zone components"
```

---

### Task 7: Delete `rzDataService.js`

**Files:**
- Delete: `apps/research/src/services/rzDataService.js`

- [ ] **Step 1: Verify no other files import rzDataService**

Run: `grep -r "rzDataService" apps/research/src/ --include="*.jsx" --include="*.js"`

Expected: No results (all imports were removed in Task 5).

- [ ] **Step 2: Delete the file**

```bash
rm apps/research/src/services/rzDataService.js
```

- [ ] **Step 3: Build and verify**

Run: `npm run build:research`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A apps/research/src/services/rzDataService.js
git commit -m "chore(rz): delete rzDataService.js (replaced by useResearchZoneData hook)"
```

---

### Task 8: Final verification and cleanup

**Files:**
- Read: all modified files (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build:research`

Expected: Clean build, no warnings about missing modules.

- [ ] **Step 2: Verify no mock data imports remain in research-zone**

```bash
grep -rn "MOCK_\|mock-data\|getDefaultMockData\|RZ_TOKEN_LOGOS\|TOKEN_NAMES\|CHART_TOKEN_ADDRESSES" apps/research/src/pages/research-zone/ --include="*.jsx" --include="*.js" | grep -v "rz-constants.js" | grep -v "mock-data.js"
```

Expected: No results.

- [ ] **Step 3: Verify price consistency in code**

Search for any remaining independent price fetches that bypass the hook:

```bash
grep -rn "getRzLivePrice\|getRzTokenMeta\|getRzTokenPrice\|liveTickerPrice\|coinMarketData" apps/research/src/pages/research-zone/ --include="*.jsx" --include="*.js"
```

Expected: No results (all price access goes through `data.price.current`).

- [ ] **Step 4: Verify token resolution uses server API**

```bash
grep -rn "CHART_TOKEN_ADDRESSES\|TOKEN_NAMES\|RZ_TOKEN_LOGOS" apps/research/src/pages/research-zone/ --include="*.jsx" --include="*.js" | grep -v "mock-data.js" | grep -v "rz-constants.js"
```

Expected: No results (all token identity comes from `/api/token/resolve`).

- [ ] **Step 5: Commit any remaining cleanup**

```bash
git add -A apps/research/src/pages/research-zone/
git commit -m "chore(rz): final cleanup after data flow rebuild"
```
