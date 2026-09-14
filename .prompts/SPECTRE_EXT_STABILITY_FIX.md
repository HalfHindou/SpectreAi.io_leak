# SPECTRE CHROME EXTENSION — Backend Stability Fix Prompt

> **MISSION: The extension backend is unreliable. Tokens sometimes resolve, sometimes don't. Charts appear randomly — sometimes OHLCV candles, sometimes a line, sometimes nothing. WebSocket disconnects constantly. This prompt identifies every root cause and provides exact surgical fixes. The goal is ALWAYS ONLINE — every request returns useful data, even if degraded.**

---

## RULE 0: DIAGNOSE BEFORE CODING

Before writing ANY fix, read and understand these files completely:

1. **`server/index.js`** — The entire 5,200+ line file. Search for:
   - Every `KNOWN_TOKEN_ADDRESSES` declaration (there are MULTIPLE — this is a bug)
   - Every `WELL_KNOWN_TOKENS` declaration
   - The `/api/bars` endpoint
   - The `/api/tokens/search` endpoint
   - The `/api/tokens/price/:symbol` endpoint
   - The `/api/tokens/prices` endpoint
   - The WebSocket section (`wss.on('connection'...)`)
   - The `startPricePoller` function
   - The `executeCodexQuery` function

2. **`api/codex.js`** — The Vercel serverless version. Search for:
   - Its own `KNOWN_TOKEN_ADDRESSES` (DIFFERENT from server/index.js — this is a bug)
   - Its own `WELL_KNOWN_TOKENS` (DIFFERENT — another bug)
   - `handleBars`, `handleTokenSearch`, `handleTokenPrices`, `handleTokenDetails`

3. **Extension frontend files** — Find the popup, content script, and background script. Understand:
   - How it calls the backend (which base URL, which endpoints)
   - How it handles the response (what it expects)
   - How it decides between candle chart vs line chart vs no chart

---

## ROOT CAUSE ANALYSIS: THE 6 BUGS

### BUG 1: DUPLICATE TOKEN REGISTRIES (Token Resolution Inconsistency)

**Problem:** `KNOWN_TOKEN_ADDRESSES` exists in BOTH `server/index.js` AND `api/codex.js` with DIFFERENT entries. When the extension resolves a token, which registry it hits depends on whether the request goes to the Express server (dev) or the Vercel serverless function (prod). They have different tokens, different addresses, different network IDs.

**Evidence from project files:**

`server/index.js` has:
```javascript
const KNOWN_TOKEN_ADDRESSES = {
  'BTC': { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1 },
  'ETH': { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 },
  'SOL': { address: 'So11111111111111111111111111111111111111112', networkId: 1399811149 },
  'BNB': { address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', networkId: 1 },
  'XRP': { address: null, networkId: 1 },   // ← NULL! Returns empty bars
  'ADA': { address: null, networkId: 1 },   // ← NULL! Returns empty bars
  'AVAX': { address: null, networkId: 1 },  // ← NULL!
  'DOT': { address: null, networkId: 1 },   // ← NULL!
  // ...more
};
```

`api/codex.js` has a DIFFERENT set:
```javascript
const KNOWN_TOKEN_ADDRESSES = {
  'SPECTRE': { address: '0x9cf0ed...', networkId: 1 },
  'PEPE': { ... },
  'BONK': { ... },
  'MOODENG': { ... },
  'PAAL': { ... },
  // Missing BTC, ETH, SOL, BNB entirely!
};
```

And ALSO `WELL_KNOWN_TOKENS` in `api/codex.js`:
```javascript
const WELL_KNOWN_TOKENS = {
  BTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1 },
  ETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 },
  SOL: { address: 'So11111111111111111111111111111111111111112', networkId: 1399811149 },
};
```

**Result:** "BTC" resolves in one context but not the other. "BONK" resolves in codex.js but not in server/index.js bars. "XRP" has `address: null` so bars returns empty.

### FIX 1: SINGLE SOURCE OF TRUTH TOKEN REGISTRY

Create ONE canonical registry file that both server/index.js and api/codex.js import:

```javascript
// server/lib/token-registry.js (NEW FILE)

/**
 * SINGLE SOURCE OF TRUTH for all token address mappings.
 * Both server/index.js and api/codex.js must use this.
 * 
 * Rules:
 * - Every token MUST have a `binanceSymbol` for Binance REST/klines fallback
 * - Tokens with DEX addresses get `address` + `networkId` for Codex
 * - Tokens without DEX addresses (XRP, ADA) get `address: null` but MUST have `binanceSymbol`
 * - `coingeckoId` is optional, used for CoinGecko fallback
 */

const TOKEN_REGISTRY = {
  // === MAJORS (have both Codex address AND Binance pair) ===
  'BTC': {
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC on Ethereum
    networkId: 1,
    binanceSymbol: 'BTCUSDT',
    coingeckoId: 'bitcoin',
    name: 'Bitcoin',
    decimals: 8,
  },
  'ETH': {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    networkId: 1,
    binanceSymbol: 'ETHUSDT',
    coingeckoId: 'ethereum',
    name: 'Ethereum',
    decimals: 18,
  },
  'SOL': {
    address: 'So11111111111111111111111111111111111111112',
    networkId: 1399811149,
    binanceSymbol: 'SOLUSDT',
    coingeckoId: 'solana',
    name: 'Solana',
    decimals: 9,
  },
  'BNB': {
    address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52',
    networkId: 1,
    binanceSymbol: 'BNBUSDT',
    coingeckoId: 'binancecoin',
    name: 'BNB',
    decimals: 18,
  },

  // === CEX-ONLY MAJORS (no DEX address, Binance is primary) ===
  'XRP': {
    address: null, // No ERC-20
    networkId: null,
    binanceSymbol: 'XRPUSDT',
    coingeckoId: 'ripple',
    name: 'XRP',
  },
  'ADA': {
    address: null,
    networkId: null,
    binanceSymbol: 'ADAUSDT',
    coingeckoId: 'cardano',
    name: 'Cardano',
  },
  'AVAX': {
    address: null,
    networkId: null,
    binanceSymbol: 'AVAXUSDT',
    coingeckoId: 'avalanche-2',
    name: 'Avalanche',
  },
  'DOT': {
    address: null,
    networkId: null,
    binanceSymbol: 'DOTUSDT',
    coingeckoId: 'polkadot',
    name: 'Polkadot',
  },
  'NEAR': {
    address: null,
    networkId: null,
    binanceSymbol: 'NEARUSDT',
    coingeckoId: 'near',
    name: 'NEAR Protocol',
  },
  'APT': {
    address: null,
    networkId: null,
    binanceSymbol: 'APTUSDT',
    coingeckoId: 'aptos',
    name: 'Aptos',
  },
  'SUI': {
    address: null,
    networkId: null,
    binanceSymbol: 'SUIUSDT',
    coingeckoId: 'sui',
    name: 'Sui',
  },
  'INJ': {
    address: null,
    networkId: null,
    binanceSymbol: 'INJUSDT',
    coingeckoId: 'injective-protocol',
    name: 'Injective',
  },
  'FET': {
    address: null,
    networkId: null,
    binanceSymbol: 'FETUSDT',
    coingeckoId: 'fetch-ai',
    name: 'Fetch.ai',
  },
  'DOGE': {
    address: '0x4206931337dc273a630d328dA6441786BfaD668f',
    networkId: 1,
    binanceSymbol: 'DOGEUSDT',
    coingeckoId: 'dogecoin',
    name: 'Dogecoin',
  },

  // === DEX TOKENS (Ethereum) ===
  'SPECTRE': {
    address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6',
    networkId: 1,
    binanceSymbol: null, // Not on Binance
    coingeckoId: 'spectre-ai',
    name: 'Spectre AI',
  },
  'PEPE': {
    address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
    networkId: 1,
    binanceSymbol: 'PEPEUSDT',
    coingeckoId: 'pepe',
    name: 'Pepe',
  },
  'SHIB': {
    address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
    networkId: 1,
    binanceSymbol: 'SHIBUSDT',
    coingeckoId: 'shiba-inu',
    name: 'Shiba Inu',
  },
  'FLOKI': {
    address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E',
    networkId: 1,
    binanceSymbol: 'FLOKIUSDT',
    coingeckoId: 'floki',
    name: 'Floki',
  },
  'UNI': {
    address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    networkId: 1,
    binanceSymbol: 'UNIUSDT',
    coingeckoId: 'uniswap',
    name: 'Uniswap',
  },
  'AAVE': {
    address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    networkId: 1,
    binanceSymbol: 'AAVEUSDT',
    coingeckoId: 'aave',
    name: 'Aave',
  },
  'LINK': {
    address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    networkId: 1,
    binanceSymbol: 'LINKUSDT',
    coingeckoId: 'chainlink',
    name: 'Chainlink',
  },
  'MKR': {
    address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
    networkId: 1,
    binanceSymbol: 'MKRUSDT',
    coingeckoId: 'maker',
    name: 'Maker',
  },
  'CRV': {
    address: '0xD533a949740bb3306d119CC777fa900bA034cd52',
    networkId: 1,
    binanceSymbol: 'CRVUSDT',
    coingeckoId: 'curve-dao-token',
    name: 'Curve DAO',
  },
  'ARB': {
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    networkId: 42161,
    binanceSymbol: 'ARBUSDT',
    coingeckoId: 'arbitrum',
    name: 'Arbitrum',
  },
  'OP': {
    address: '0x4200000000000000000000000000000000000042',
    networkId: 10,
    binanceSymbol: 'OPUSDT',
    coingeckoId: 'optimism',
    name: 'Optimism',
  },
  'MATIC': {
    address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0',
    networkId: 1,
    binanceSymbol: 'MATICUSDT',
    coingeckoId: 'matic-network',
    name: 'Polygon',
  },
  'RENDER': {
    address: null,
    networkId: null,
    binanceSymbol: 'RENDERUSDT',
    coingeckoId: 'render-token',
    name: 'Render',
  },
  'LTC': {
    address: null,
    networkId: null,
    binanceSymbol: 'LTCUSDT',
    coingeckoId: 'litecoin',
    name: 'Litecoin',
  },
  'ATOM': {
    address: null,
    networkId: null,
    binanceSymbol: 'ATOMUSDT',
    coingeckoId: 'cosmos',
    name: 'Cosmos',
  },

  // === SOLANA DEX TOKENS ===
  'WIF': {
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    networkId: 1399811149,
    binanceSymbol: 'WIFUSDT',
    coingeckoId: 'dogwifcoin',
    name: 'dogwifhat',
  },
  'BONK': {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    networkId: 1399811149,
    binanceSymbol: 'BONKUSDT',
    coingeckoId: 'bonk',
    name: 'Bonk',
  },
  'MOODENG': {
    address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY',
    networkId: 1399811149,
    binanceSymbol: null,
    coingeckoId: null,
    name: 'Moo Deng',
  },
  'PAAL': {
    address: '0x14fee680690900ba0cccfc76ad70fd1b95d10e16',
    networkId: 1,
    binanceSymbol: null,
    coingeckoId: null,
    name: 'PAAL AI',
  },
  'ONDO': {
    address: null,
    networkId: null,
    binanceSymbol: 'ONDOUSDT',
    coingeckoId: 'ondo-finance',
    name: 'Ondo Finance',
  },
  'TIA': {
    address: null,
    networkId: null,
    binanceSymbol: 'TIAUSDT',
    coingeckoId: 'celestia',
    name: 'Celestia',
  },
  'SEI': {
    address: null,
    networkId: null,
    binanceSymbol: 'SEIUSDT',
    coingeckoId: 'sei-network',
    name: 'Sei',
  },
  'PENDLE': {
    address: '0x808507121B80c02388fAd14726482e061B8da827',
    networkId: 1,
    binanceSymbol: 'PENDLEUSDT',
    coingeckoId: 'pendle',
    name: 'Pendle',
  },
  'NFLX': null, // Stocks are NOT in this registry — use FALLBACK_STOCK_DATA
  'AAPL': null,
};

// Helpers
function getTokenInfo(symbol) {
  return TOKEN_REGISTRY[symbol.toUpperCase()] || null;
}

function hasCodexAddress(symbol) {
  const info = getTokenInfo(symbol);
  return info && info.address !== null;
}

function hasBinancePair(symbol) {
  const info = getTokenInfo(symbol);
  return info && info.binanceSymbol !== null;
}

function getBinanceSymbol(symbol) {
  const info = getTokenInfo(symbol);
  return info?.binanceSymbol || null;
}

function getAllSymbols() {
  return Object.keys(TOKEN_REGISTRY).filter(k => TOKEN_REGISTRY[k] !== null);
}

function getBinanceSymbols() {
  return getAllSymbols().filter(hasBinancePair);
}

module.exports = {
  TOKEN_REGISTRY,
  getTokenInfo,
  hasCodexAddress,
  hasBinancePair,
  getBinanceSymbol,
  getAllSymbols,
  getBinanceSymbols,
};
```

**Then update `server/index.js`:**
```javascript
// At the top, replace ALL local KNOWN_TOKEN_ADDRESSES and WELL_KNOWN_TOKENS with:
const { TOKEN_REGISTRY, getTokenInfo, hasCodexAddress, hasBinancePair, getBinanceSymbol } = require('./lib/token-registry');
```

**And update `api/codex.js`:**
```javascript
// Import the SAME registry (adjust path for Vercel):
const { TOKEN_REGISTRY, getTokenInfo, hasCodexAddress, hasBinancePair, getBinanceSymbol } = require('../server/lib/token-registry');
```

**DELETE every other `KNOWN_TOKEN_ADDRESSES` and `WELL_KNOWN_TOKENS` declaration across the codebase.** Search globally. There should be exactly ONE source: `server/lib/token-registry.js`.

---

### BUG 2: CHARTS RETURN EMPTY FOR CEX-ONLY TOKENS

**Problem:** When the extension requests bars for "XRP", the `/api/bars` endpoint does this:

```javascript
if (tokenInfo && tokenInfo.address) {
  // has address → fetch from Codex ✅
} else {
  console.log(`No on-chain address for ${upperSymbol}, client will use Binance fallback`);
  return res.json({ bars: [] }); // ← RETURNS EMPTY! Expects client to handle fallback
}
```

The client is SUPPOSED to fallback to Binance klines, but this is unreliable because:
- The extension popup may not implement the same fallback logic as the main app
- The Binance fallback is client-side (requires CORS proxy or direct Binance call)
- If the client doesn't implement fallback, user sees NO chart

### FIX 2: SERVER-SIDE BINANCE KLINES FALLBACK IN `/api/bars`

**The server must NEVER return empty bars if data is available ANYWHERE.** The fallback chain should be: Codex → Binance REST → CoinGecko → empty.

```javascript
// REPLACE the current /api/bars endpoint logic:

app.get('/api/bars', async (req, res) => {
  try {
    const { symbol, from, to, resolution = '60', networkId: reqNetworkId } = req.query;
    if (!symbol || !from || !to) {
      return res.status(400).json({ error: 'Missing required parameters: symbol, from, to' });
    }

    const upperSymbol = symbol.toUpperCase();
    const tokenInfo = getTokenInfo(upperSymbol);
    let bars = null;
    let source = null;

    // ══════════════════════════════════════════
    // TIER 1: Codex (if token has on-chain address)
    // ══════════════════════════════════════════
    if (hasCodexAddress(upperSymbol) || symbol.includes(':') || symbol.startsWith('0x') || symbol.length >= 32) {
      try {
        let tokenAddress, networkId;

        if (symbol.includes(':')) {
          const parts = symbol.split(':');
          tokenAddress = parts[0];
          networkId = parseInt(parts[1]) || 1;
        } else if (symbol.startsWith('0x') || symbol.length >= 32) {
          tokenAddress = symbol;
          networkId = parseInt(reqNetworkId) || 1;
        } else {
          tokenAddress = tokenInfo.address;
          networkId = tokenInfo.networkId;
        }

        const isSolana = !tokenAddress.startsWith('0x') && tokenAddress.length >= 32;
        if (isSolana && networkId === 1) networkId = 1399811149;
        const formatted = isSolana ? tokenAddress : tokenAddress.toLowerCase();

        const resMap = { '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240', 'D': '1D', '1D': '1D', 'W': '1W', '1W': '1W' };
        const codexRes = resMap[resolution] || resolution;
        const tokenSymbol = `${formatted}:${networkId}`;

        const result = await executeCodexQuery(
          `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
            getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution){o h l c t volume}
          }`,
          { symbol: tokenSymbol, from: parseInt(from), to: parseInt(to), resolution: codexRes },
        );

        const barsData = result?.getTokenBars;
        if (barsData?.t?.length > 0) {
          bars = barsData.t.map((t, i) => ({
            t, o: barsData.o[i], h: barsData.h[i], l: barsData.l[i], c: barsData.c[i],
            v: parseFloat(barsData.volume?.[i]) || 0,
          }));
          source = 'codex';
        }
      } catch (e) {
        console.warn(`[Bars] Codex failed for ${symbol}:`, e.message);
      }
    }

    // ══════════════════════════════════════════
    // TIER 2: Binance REST klines (if token has Binance pair)
    // ══════════════════════════════════════════
    if (!bars && hasBinancePair(upperSymbol)) {
      try {
        const binanceSym = getBinanceSymbol(upperSymbol);
        const intervalMap = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '240': '4h', 'D': '1d', '1D': '1d', 'W': '1w', '1W': '1w' };
        const interval = intervalMap[resolution] || '1h';

        const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&startTime=${parseInt(from) * 1000}&endTime=${parseInt(to) * 1000}&limit=1000`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (response.ok) {
          const klines = await response.json();
          if (klines.length > 0) {
            bars = klines.map(k => ({
              t: Math.floor(k[0] / 1000),
              o: parseFloat(k[1]),
              h: parseFloat(k[2]),
              l: parseFloat(k[3]),
              c: parseFloat(k[4]),
              v: parseFloat(k[5]),
            }));
            source = 'binance';
          }
        }
      } catch (e) {
        console.warn(`[Bars] Binance failed for ${symbol}:`, e.message);
      }
    }

    // ══════════════════════════════════════════
    // TIER 3: Return whatever we have
    // ══════════════════════════════════════════
    if (bars && bars.length > 0) {
      console.log(`[Bars] ${symbol}: ${bars.length} bars from ${source}`);
      return res.json({ bars, source });
    }

    console.log(`[Bars] ${symbol}: No bars from any source`);
    res.json({ bars: [], source: 'none' });

  } catch (error) {
    console.error('Bars error:', error);
    res.json({ bars: [], source: 'error', error: error.message });
  }
});
```

**Critical change:** XRP, ADA, DOT, NEAR, APT, SUI, INJ, FET — all tokens that previously returned `{ bars: [] }` — now get Binance klines SERVER-SIDE. The extension never has to implement its own fallback.

---

### BUG 3: WEBSOCKET DISCONNECTS + CODEX POLLING IS EXPENSIVE

**Problem:** The WebSocket price poller uses `getTokenBars` with a 2-minute window every 5 seconds per token. This is:
- Expensive: 20 tokens = 240 Codex API calls/min
- Fragile: If Codex is slow/down, ALL price updates stop
- Laggy: 5s minimum latency
- Disconnect-prone: If any poll errors, the poller keeps running silently with stale data

**Current code issues:**
```javascript
// Current: Catches error silently, no reconnection logic
try {
  const result = await executeCodexQuery(priceQuery, { symbol: tokenSymbol });
  // ...
} catch (err) {
  // Silently continue polling - occasional errors are expected
  // ← BUG: After enough silent failures, data goes stale with no indication
}
```

And the keep-alive:
```javascript
// Current: Terminates on missed pong, no reconnect from client side
const wsKeepAlive = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate(); // ← Just kills it. Client has to reconnect.
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
```

### FIX 3: HYBRID PRICE SYSTEM (Binance WS + Codex Polling)

**For tokens WITH Binance pairs (BTC, ETH, SOL, etc.):** Use the Binance WebSocket stream (sub-second updates, zero API calls, free). This was specified in the Backend Real-Time prompt but may not be implemented yet.

**For tokens WITHOUT Binance pairs (SPECTRE, MOODENG, etc.):** Keep Codex polling but add error counting + stale data warning.

**Upgrade the WebSocket handler:**

```javascript
// Add error tracking to price pollers
const pollerErrorCounts = new Map(); // key → consecutive error count
const MAX_POLL_ERRORS = 5; // After 5 consecutive errors, notify clients

function startPricePoller(address, networkId) {
  const key = `${address.toLowerCase()}_${networkId}`;
  if (activePricePollers.has(key)) return;

  const upperSymbol = findSymbolByAddress(address, networkId);

  // If this token has a Binance pair AND binanceStream is available, use that instead
  if (upperSymbol && hasBinancePair(upperSymbol) && global.binanceStream) {
    const binSym = getBinanceSymbol(upperSymbol).toLowerCase();
    global.binanceStream.subscribe(binSym, (data) => {
      const subscribers = priceSubscriptions.get(key);
      if (!subscribers || subscribers.size === 0) return;

      const msg = JSON.stringify({
        type: 'price_update',
        address,
        networkId,
        price: data.price,
        volume: data.volume,
        open: data.open,
        change: data.open > 0 ? ((data.price - data.open) / data.open) : 0,
        timestamp: Math.floor(Date.now() / 1000),
        source: 'binance_ws',
      });

      subscribers.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      });
    });
    console.log(`[WS] Using Binance stream for ${upperSymbol} (${key})`);
    activePricePollers.set(key, 'binance_ws'); // Mark as using Binance WS, not interval
    return;
  }

  // Fallback: Codex polling for DEX-only tokens
  console.log(`[WS] Starting Codex poller for ${key}`);
  pollerErrorCounts.set(key, 0);

  const poll = async () => {
    const subscribers = priceSubscriptions.get(key);
    if (!subscribers || subscribers.size === 0) {
      clearInterval(activePricePollers.get(key));
      activePricePollers.delete(key);
      lastKnownPrices.delete(key);
      pollerErrorCounts.delete(key);
      return;
    }

    try {
      const formattedAddress = address.startsWith('0x') ? address.toLowerCase() : address;
      const tokenSymbol = `${formattedAddress}:${networkId}`;

      const result = await executeCodexQuery(
        `query($symbol:String!){getTokenBars(symbol:$symbol,from:${Math.floor(Date.now() / 1000) - 120},to:${Math.floor(Date.now() / 1000)},resolution:"1"){o h l c t volume}}`,
        { symbol: tokenSymbol },
      );

      const bars = result?.getTokenBars;
      if (bars?.t?.length > 0) {
        const lastIdx = bars.t.length - 1;
        const price = parseFloat(bars.c[lastIdx]);
        const volume = parseFloat(bars.volume?.[lastIdx]) || 0;
        const open = parseFloat(bars.o[0]);

        // Reset error count on success
        pollerErrorCounts.set(key, 0);

        const lastPrice = lastKnownPrices.get(key);
        if (lastPrice !== price) {
          lastKnownPrices.set(key, price);

          const msg = JSON.stringify({
            type: 'price_update',
            address, networkId, price, volume, open,
            change: open > 0 ? ((price - open) / open) : 0,
            timestamp: bars.t[lastIdx],
            source: 'codex_poll',
          });

          subscribers.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
          });
        }
      }
    } catch (err) {
      const errorCount = (pollerErrorCounts.get(key) || 0) + 1;
      pollerErrorCounts.set(key, errorCount);

      if (errorCount >= MAX_POLL_ERRORS) {
        // Notify clients that data is stale
        const subscribers = priceSubscriptions.get(key);
        if (subscribers) {
          const staleMsg = JSON.stringify({
            type: 'price_stale',
            address, networkId,
            message: 'Price data source temporarily unavailable',
            lastKnownPrice: lastKnownPrices.get(key) || null,
          });
          subscribers.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) ws.send(staleMsg);
          });
        }
        console.warn(`[WS] ${key}: ${errorCount} consecutive errors, notified clients`);
      }
    }
  };

  poll();
  activePricePollers.set(key, setInterval(poll, 5000));
}

// Helper: reverse lookup symbol from address
function findSymbolByAddress(address, networkId) {
  const addrLower = address.toLowerCase();
  for (const [sym, info] of Object.entries(TOKEN_REGISTRY)) {
    if (info && info.address && info.address.toLowerCase() === addrLower) {
      if (!info.networkId || info.networkId === parseInt(networkId)) return sym;
    }
  }
  return null;
}
```

**Upgrade client reconnection (extension side):**

The extension must implement exponential backoff reconnection:

```javascript
// Extension background.js or wherever WS is managed:
class SpectreWebSocket {
  constructor(url) {
    this.url = url;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000; // 30s max
    this.subscriptions = new Map(); // symbol → callback
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[Spectre WS] Connected');
      this.reconnectAttempts = 0;
      // Re-subscribe everything
      this.subscriptions.forEach((callback, key) => {
        const [address, networkId] = key.split('_');
        this.ws.send(JSON.stringify({ type: 'subscribe', address, networkId: parseInt(networkId) }));
      });
    };

    this.ws.onclose = () => {
      console.log('[Spectre WS] Disconnected, reconnecting...');
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), delay);
    };

    this.ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'price_update' || msg.type === 'price_stale') {
          const key = `${msg.address.toLowerCase()}_${msg.networkId}`;
          const callback = this.subscriptions.get(key);
          if (callback) callback(msg);
        }
      } catch (e) {}
    };
  }

  subscribe(address, networkId, callback) {
    const key = `${address.toLowerCase()}_${networkId}`;
    this.subscriptions.set(key, callback);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', address, networkId }));
    }
  }

  unsubscribe(address, networkId) {
    const key = `${address.toLowerCase()}_${networkId}`;
    this.subscriptions.delete(key);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', address, networkId }));
    }
  }
}
```

---

### BUG 4: CHART TYPE INCONSISTENCY (Candle vs Line vs Nothing)

**Problem:** The extension sometimes shows OHLCV candles, sometimes a line chart, sometimes nothing. This happens because:

1. Codex returns table-format bars (`{ o: [], h: [], l: [], c: [], t: [], volume: [] }`) — needs conversion to array
2. Binance returns klines as nested arrays (`[[openTime, open, high, low, close, volume, ...], ...]`) — different format
3. The extension frontend may not handle both formats consistently
4. When bars come back as `{ bars: [] }`, the extension renders nothing instead of showing a "no data" state

### FIX 4: NORMALIZE ALL BAR RESPONSES + ALWAYS RETURN CHART TYPE HINT

**Every bars response must include `chartType` so the extension knows what to render:**

```javascript
// At the end of the /api/bars handler, add to response:
res.json({
  bars,
  source,
  chartType: bars.length >= 2 ? 'candlestick' : bars.length === 1 ? 'line' : 'empty',
  // For line charts (sparkline), also return a simplified points array:
  linePoints: bars.map(b => ({ t: b.t, c: b.c })),
});
```

**Extension frontend rule:** If `chartType === 'candlestick'` → render candle chart. If `chartType === 'line'` → render line. If `chartType === 'empty'` → show skeleton placeholder with "Chart data loading..."

---

### BUG 5: TOKEN SEARCH RETURNS DIFFERENT RESULTS ON DIFFERENT CALLS

**Problem:** `/api/tokens/search?q=PEPE` sometimes returns the right PEPE, sometimes a different PEPE (there are many tokens called PEPE on different chains). The search uses Codex `filterTokens` with fuzzy matching, which returns results ordered by liquidity — but liquidity changes, so ordering changes.

### FIX 5: REGISTRY-FIRST SEARCH WITH CODEX AS SUPPLEMENT

```javascript
// In /api/tokens/search handler, BEFORE calling Codex:

const upperQ = q.toUpperCase().replace(/^\$/, '');
const registryMatch = getTokenInfo(upperQ);

// If exact symbol match in our registry, return it FIRST (pinned to top)
let pinnedResult = null;
if (registryMatch && registryMatch.address) {
  pinnedResult = {
    symbol: upperQ,
    name: registryMatch.name,
    address: registryMatch.address,
    networkId: registryMatch.networkId,
    isPinned: true, // Extension knows this is our canonical match
  };
}

// Then do normal Codex search...
// In the response, pin the registry match to position 0:
const results = pinnedResult ? [pinnedResult, ...codexResults.filter(r =>
  r.address?.toLowerCase() !== pinnedResult.address?.toLowerCase()
)] : codexResults;
```

---

### BUG 6: NO HEALTH MONITORING FOR EXTENSION-SPECIFIC ENDPOINTS

**Problem:** There's no way to know if the extension backend is healthy. Codex could be down, Binance could be blocked, Yahoo could be rate-limited — and the extension just silently fails.

### FIX 6: ADD `/api/ext/health` ENDPOINT

```javascript
app.get('/api/ext/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),

    // Data source status
    sources: {},

    // WebSocket status
    websocket: {
      connectedClients: wss.clients.size,
      activePollers: activePricePollers.size,
      subscribedTokens: priceSubscriptions.size,
    },

    // Registry stats
    registry: {
      totalTokens: getAllSymbols().length,
      withBinance: getBinanceSymbols().length,
      withCodex: getAllSymbols().filter(hasCodexAddress).length,
    },
  };

  // Quick-check Codex (5s timeout)
  try {
    const start = Date.now();
    const test = await executeCodexQuery(
      `query { getNetworks { name } }`, {}, 
    );
    health.sources.codex = {
      status: test ? 'up' : 'down',
      responseTime: Date.now() - start,
    };
  } catch (e) {
    health.sources.codex = { status: 'down', error: e.message };
  }

  // Quick-check Binance (3s timeout)
  try {
    const start = Date.now();
    const r = await fetch('https://api.binance.com/api/v3/ping', { signal: AbortSignal.timeout(3000) });
    health.sources.binance = {
      status: r.ok ? 'up' : 'down',
      responseTime: Date.now() - start,
    };
  } catch (e) {
    health.sources.binance = { status: 'down', error: e.message };
  }

  // If circuit breakers exist, include their states
  if (global.breakers) {
    Object.entries(global.breakers).forEach(([name, breaker]) => {
      health.sources[name.toLowerCase()] = {
        state: breaker.state,
        successRate: breaker.getStats().successRate,
      };
    });
  }

  // Overall status
  const downSources = Object.values(health.sources).filter(s => s.status === 'down');
  if (downSources.length === Object.keys(health.sources).length) {
    health.status = 'critical'; // Everything down
  } else if (downSources.length > 0) {
    health.status = 'degraded'; // Partial outage
  }

  res.json(health);
});
```

---

## EXTENSION FRONTEND RULES (For the Extension Developer)

### Always-Online Display Rules

```
IF price endpoint returns data → show price
IF price endpoint fails → show last cached price + "stale" badge
IF bars endpoint returns bars → show candlestick chart
IF bars endpoint returns empty + token has binanceSymbol → show "Loading..." (server bug, report it)
IF bars endpoint returns empty + token has no binanceSymbol → show "DEX chart unavailable" message
IF resolve endpoint finds token → show full popup
IF resolve endpoint fails → show "$SYMBOL" text with "Tap to search on Spectre" link

NEVER show: blank popup, infinite spinner, error stack trace, or nothing at all
```

### Extension Reconnection Rules

```
WebSocket disconnected → show small orange dot (not red — that implies error)
WebSocket reconnecting → dot pulses
WebSocket reconnected → dot turns green briefly then disappears
More than 30s disconnected → fall back to REST polling every 10s
REST polling → show "delayed" indicator next to prices
```

### Chart Rendering Decision Tree

```
/api/bars response received:
├── bars.length >= 10 → render CANDLESTICK chart (OHLCV)
├── bars.length >= 2 && bars.length < 10 → render LINE chart (close prices only)
├── bars.length === 1 → render single PRICE with change arrow
├── bars.length === 0 && source === 'none' → show "No chart data yet"
└── bars.length === 0 && error → show skeleton + retry in 5s
```

---

## IMPLEMENTATION ORDER

| Priority | Fix | Impact | Effort |
|---|---|---|---|
| 🔴 P0 | FIX 1: Single token registry | Fixes 80% of "token not found" issues | 1 hour |
| 🔴 P0 | FIX 2: Server-side Binance fallback in /api/bars | Fixes "no chart" for XRP, ADA, DOT, etc. | 30 min |
| 🟡 P1 | FIX 4: Normalize bar response + chartType | Fixes candle vs line inconsistency | 20 min |
| 🟡 P1 | FIX 5: Registry-first search | Fixes wrong-token-returned issues | 20 min |
| 🟡 P1 | FIX 3: Hybrid WS (Binance + Codex) | Fixes disconnects + reduces API waste | 1 hour |
| 🟢 P2 | FIX 6: /api/ext/health endpoint | Enables debugging in production | 30 min |

**Total: ~3.5 hours of focused work. Fixes every reported issue.**

---

## VALIDATION CHECKLIST

After implementing all fixes, run these tests:

```bash
# Token registry: every symbol resolves
for SYM in BTC ETH SOL XRP ADA PEPE SPECTRE WIF BONK AVAX DOT NEAR; do
  echo -n "$SYM: "
  curl -s "http://localhost:3001/api/tokens/search?q=$SYM" | jq '.[0].symbol // "FAILED"'
done

# Bars: every token returns chart data (not empty)
for SYM in BTC ETH SOL XRP ADA PEPE SPECTRE WIF BONK; do
  NOW=$(date +%s); FROM=$((NOW - 86400))
  echo -n "$SYM bars: "
  curl -s "http://localhost:3001/api/bars?symbol=$SYM&from=$FROM&to=$NOW&resolution=60" | jq '{count: (.bars | length), source}'
done
# EXPECTED: Every token returns count > 0 and a source (codex or binance)

# Extension health
curl -s "http://localhost:3001/api/ext/health" | jq '{status, sources}'

# WebSocket: connect and subscribe
wscat -c ws://localhost:3001/ws -x '{"type":"subscribe","address":"0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599","networkId":1}'
# Should receive price_update messages within 5s
```

---

## RULES FOR ALL FUTURE EXTENSION ENDPOINTS

1. **NEVER return empty without trying all fallbacks.** The chain is always: Codex → Binance → CoinGecko → Cache → Static fallback → Error object (never crash).

2. **ALWAYS include `source` in every response.** So we can debug which tier served the data.

3. **ALWAYS use `TOKEN_REGISTRY` from `server/lib/token-registry.js`.** Never create local token maps.

4. **ALWAYS use `AbortSignal.timeout()` on every external fetch.** Codex: 8s. Binance: 5s. CoinGecko: 8s. Yahoo: 6s. Finnhub: 6s.

5. **ALWAYS wrap in try/catch and return JSON.** Never let an endpoint crash. `res.json({ error: '...' })` is always better than a 500.

6. **Stock symbols use `FALLBACK_STOCK_DATA` and Yahoo Finance — NOT the TOKEN_REGISTRY.** The token registry is crypto only. Stock detection: `POPULAR_STOCK_SYMBOLS.includes(sym) || FALLBACK_STOCK_DATA[sym]`.

7. **Test with ALL token types after any change:** A Binance-pair major (BTC), a CEX-only token (XRP), an Ethereum DEX token (SPECTRE), a Solana DEX token (WIF), a stock (AAPL).
