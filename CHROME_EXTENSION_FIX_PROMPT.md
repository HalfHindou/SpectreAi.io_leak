# SPECTRE CHROME EXTENSION — EMERGENCY FIX PROMPT

> **PASTE THIS ENTIRE PROMPT INTO CLAUDE CODE. This is a debugging and fixing task, not a build-from-scratch task. The extension exists but is broken. Your job is to find every bug and fix it systematically.**

---

## THE PROBLEM (WITH SCREENSHOTS)

The Spectre Chrome extension hover popup is broken in multiple ways. Here's what's happening:

### Bug 1: STOCK TICKERS RESOLVE TO WRONG CRYPTO TOKENS
- User hovers `$AMZN` on Twitter → popup shows "Amazon (...)" with symbol **"AMZNON"** (a random shitcoin)
- Price shows **$0.000000** instead of ~$230
- Market cap shows **$32.00** (obviously wrong)
- This means the resolve/search logic is hitting the **crypto search API first** and finding garbage matches

### Bug 2: CRYPTO TOKENS FAIL TO RESOLVE
- User hovers `$ZIG` → popup shows "ZIGChain" but says **"Price unavailable"**
- Market cap: **N/A**, Volume: **N/A**
- The token was found (name resolved) but price fetching failed completely

### Bug 3: NO CHART DATA — EVER
- Both screenshots show **"No chart data"** in the 7D CHART section
- The sparkline/chart endpoint is either not being called, returning empty, or the response format doesn't match what the popup expects

### Bug 4: NO LOGOS
- AMZN shows a generic "A" letter instead of the Amazon logo
- ZIG shows a generic "Z" letter instead of any logo
- Logo URL resolution is broken or not attempted

### Bug 5: AI ANALYSIS IS GENERIC/BROKEN
- Both cards show nearly identical text: "[TOKEN] navigating fear (F&G: 8). Contrarian opportunities emerging for patient buyers."
- This is the same template regardless of token — no actual AI analysis happening
- The analysis references "F&G: 8" (Fear & Greed) which is a global crypto metric being blindly applied to everything including stocks

### Bug 6: MAJOR STOCKS SHOW WRONG DATA
- Apple reportedly showed **260% rise** (should be ~1-2%)
- AMZN, TSLA, MSFT, PLTR show no data or wrong data
- NVDA sometimes works
- The stock data pipeline is unreliable

### Bug 7: BTC.D AND ETH.D SHOWING ON STOCK CARDS
- The AMZN popup shows "BTC.D 0.0% · ETH.D 0.0%" — this is crypto-only data that should NOT appear on stock cards

---

## ROOT CAUSE ANALYSIS

The bugs stem from **5 architectural failures**:

1. **No stock-vs-crypto disambiguation** — When the extension sees `$AMZN`, it searches the crypto token API first and finds a garbage match called "AMZNON." It never checks if AMZN is a well-known stock ticker.

2. **No stock ticker registry** — There's no hardcoded list of known stock tickers (AAPL, MSFT, AMZN, TSLA, etc.) to short-circuit the resolve. Everything goes through crypto search.

3. **Chart endpoint only calls Codex** — The sparkline/chart data only tries the Codex GraphQL API (crypto). For stocks, it needs Yahoo Finance. For crypto tokens that Codex can't resolve, it returns nothing.

4. **Price fetching has no fallback chain** — If the primary price source fails, there's no fallback. Price shows $0 or "unavailable" instead of trying alternative sources.

5. **AI analysis is a static template** — The analysis text is generated from a simple string template using only the global Fear & Greed index. No per-token data is incorporated.

---

## STEP 0: BEFORE YOU WRITE ANY CODE

**Read the existing codebase first.** Run these commands:

```bash
# Find ALL extension-related files
find . -path "*/extension*" -o -path "*/ext*" -o -name "manifest.json" | grep -v node_modules | grep -v .git | head -50

# Find the popup component
find . -name "*.jsx" -o -name "*.tsx" -o -name "*.js" -o -name "*.html" | xargs grep -l "popup\|hover.*card\|token.*card\|cashtag" 2>/dev/null | grep -v node_modules | head -20

# Find the content script (cashtag detection)
find . -name "*.js" -o -name "*.jsx" | xargs grep -l "cashtag\|\\\$[A-Z]\|content.script\|content_script" 2>/dev/null | grep -v node_modules | head -20

# Find the resolve/lookup logic
find . -name "*.js" -o -name "*.jsx" | xargs grep -l "resolve.*token\|lookup.*ticker\|fetch.*price\|getToken" 2>/dev/null | grep -v node_modules | head -20

# Find the background/service worker
find . -name "background*" -o -name "service*worker*" | grep -v node_modules | head -10

# Find the server-side extension endpoints
grep -n "api/ext\|extension" server/index.js | head -30

# Check if there's a stock ticker list anywhere
grep -rn "AAPL\|MSFT\|AMZN\|stock.*ticker\|STOCK.*SYMBOL\|FALLBACK_STOCK" server/index.js | head -20

# Check existing resolve endpoint
grep -n "resolve\|cashtag" server/index.js | head -20

# Read the manifest to understand extension structure
cat extension/manifest.json 2>/dev/null || find . -name "manifest.json" -not -path "*/node_modules/*" -exec cat {} \;
```

**READ the output carefully before proceeding.** Understand:
- Where is the popup UI code?
- Where is the content script that detects cashtags?
- Where is the background service worker?
- What API endpoints does the extension call?
- What does the resolve endpoint do currently?

---

## STEP 1: ADD STOCK TICKER REGISTRY (SERVER-SIDE)

**The #1 fix.** Before ANY crypto search happens, check if the ticker is a known stock.

Find the resolve endpoint in `server/index.js` (likely `/api/ext/resolve` or `/api/resolve` or similar). If it doesn't exist, find whatever endpoint the extension calls when a cashtag is detected.

**Add this STOCK_TICKERS registry** near the top of the file (or in the existing stock constants area):

```javascript
// ═══════════════════════════════════════════════════════════════
// STOCK TICKER REGISTRY — CHECKED BEFORE CRYPTO SEARCH
// If a cashtag matches here, we SKIP crypto search entirely
// ═══════════════════════════════════════════════════════════════
const STOCK_TICKERS = {
  // Mega caps
  'AAPL':  { name: 'Apple Inc.', sector: 'Technology', exchange: 'NASDAQ', domain: 'apple.com' },
  'MSFT':  { name: 'Microsoft Corp.', sector: 'Technology', exchange: 'NASDAQ', domain: 'microsoft.com' },
  'GOOGL': { name: 'Alphabet Inc.', sector: 'Technology', exchange: 'NASDAQ', domain: 'google.com' },
  'GOOG':  { name: 'Alphabet Inc.', sector: 'Technology', exchange: 'NASDAQ', domain: 'google.com', alias: 'GOOGL' },
  'AMZN':  { name: 'Amazon.com Inc.', sector: 'Consumer', exchange: 'NASDAQ', domain: 'amazon.com' },
  'NVDA':  { name: 'NVIDIA Corp.', sector: 'Technology', exchange: 'NASDAQ', domain: 'nvidia.com' },
  'TSLA':  { name: 'Tesla Inc.', sector: 'Automotive', exchange: 'NASDAQ', domain: 'tesla.com' },
  'META':  { name: 'Meta Platforms', sector: 'Technology', exchange: 'NASDAQ', domain: 'meta.com' },
  'BRK.A': { name: 'Berkshire Hathaway A', sector: 'Financial', exchange: 'NYSE', domain: 'berkshirehathaway.com' },
  'BRK.B': { name: 'Berkshire Hathaway B', sector: 'Financial', exchange: 'NYSE', domain: 'berkshirehathaway.com' },
  'LLY':   { name: 'Eli Lilly', sector: 'Healthcare', exchange: 'NYSE', domain: 'lilly.com' },
  'AVGO':  { name: 'Broadcom Inc.', sector: 'Technology', exchange: 'NASDAQ', domain: 'broadcom.com' },
  'JPM':   { name: 'JPMorgan Chase', sector: 'Financial', exchange: 'NYSE', domain: 'jpmorganchase.com' },
  'V':     { name: 'Visa Inc.', sector: 'Financial', exchange: 'NYSE', domain: 'visa.com' },
  'UNH':   { name: 'UnitedHealth Group', sector: 'Healthcare', exchange: 'NYSE', domain: 'unitedhealthgroup.com' },
  'MA':    { name: 'Mastercard Inc.', sector: 'Financial', exchange: 'NYSE', domain: 'mastercard.com' },
  'XOM':   { name: 'Exxon Mobil', sector: 'Energy', exchange: 'NYSE', domain: 'exxonmobil.com' },
  'HD':    { name: 'Home Depot', sector: 'Consumer', exchange: 'NYSE', domain: 'homedepot.com' },
  'PG':    { name: 'Procter & Gamble', sector: 'Consumer', exchange: 'NYSE', domain: 'pg.com' },
  'COST':  { name: 'Costco Wholesale', sector: 'Consumer', exchange: 'NASDAQ', domain: 'costco.com' },
  'JNJ':   { name: 'Johnson & Johnson', sector: 'Healthcare', exchange: 'NYSE', domain: 'jnj.com' },
  'ABBV':  { name: 'AbbVie Inc.', sector: 'Healthcare', exchange: 'NYSE', domain: 'abbvie.com' },
  'NFLX':  { name: 'Netflix Inc.', sector: 'Technology', exchange: 'NASDAQ', domain: 'netflix.com' },
  'CRM':   { name: 'Salesforce Inc.', sector: 'Technology', exchange: 'NYSE', domain: 'salesforce.com' },
  'AMD':   { name: 'AMD', sector: 'Technology', exchange: 'NASDAQ', domain: 'amd.com' },
  'ORCL':  { name: 'Oracle Corp.', sector: 'Technology', exchange: 'NYSE', domain: 'oracle.com' },
  'ADBE':  { name: 'Adobe Inc.', sector: 'Technology', exchange: 'NASDAQ', domain: 'adobe.com' },
  'INTC':  { name: 'Intel Corp.', sector: 'Technology', exchange: 'NASDAQ', domain: 'intel.com' },
  'DIS':   { name: 'Walt Disney Co.', sector: 'Communication', exchange: 'NYSE', domain: 'disney.com' },
  'BAC':   { name: 'Bank of America', sector: 'Financial', exchange: 'NYSE', domain: 'bankofamerica.com' },
  'WMT':   { name: 'Walmart Inc.', sector: 'Consumer', exchange: 'NYSE', domain: 'walmart.com' },
  'PYPL':  { name: 'PayPal Holdings', sector: 'Financial', exchange: 'NASDAQ', domain: 'paypal.com' },
  'BA':    { name: 'Boeing Co.', sector: 'Industrial', exchange: 'NYSE', domain: 'boeing.com' },
  'GS':    { name: 'Goldman Sachs', sector: 'Financial', exchange: 'NYSE', domain: 'goldmansachs.com' },
  'CVX':   { name: 'Chevron Corp.', sector: 'Energy', exchange: 'NYSE', domain: 'chevron.com' },
  'KO':    { name: 'Coca-Cola Co.', sector: 'Consumer', exchange: 'NYSE', domain: 'coca-colacompany.com' },
  'PEP':   { name: 'PepsiCo Inc.', sector: 'Consumer', exchange: 'NASDAQ', domain: 'pepsico.com' },
  'MRK':   { name: 'Merck & Co.', sector: 'Healthcare', exchange: 'NYSE', domain: 'merck.com' },
  'PFE':   { name: 'Pfizer Inc.', sector: 'Healthcare', exchange: 'NYSE', domain: 'pfizer.com' },
  'CAT':   { name: 'Caterpillar Inc.', sector: 'Industrial', exchange: 'NYSE', domain: 'caterpillar.com' },
  'GE':    { name: 'General Electric', sector: 'Industrial', exchange: 'NYSE', domain: 'ge.com' },
  'COIN':  { name: 'Coinbase Global', sector: 'Financial', exchange: 'NASDAQ', domain: 'coinbase.com' },

  // Popular mid-caps and meme stocks
  'PLTR':  { name: 'Palantir Technologies', sector: 'Technology', exchange: 'NYSE', domain: 'palantir.com' },
  'SQ':    { name: 'Block Inc.', sector: 'Financial', exchange: 'NYSE', domain: 'block.xyz' },
  'SHOP':  { name: 'Shopify Inc.', sector: 'Technology', exchange: 'NYSE', domain: 'shopify.com' },
  'SNAP':  { name: 'Snap Inc.', sector: 'Technology', exchange: 'NYSE', domain: 'snap.com' },
  'UBER':  { name: 'Uber Technologies', sector: 'Technology', exchange: 'NYSE', domain: 'uber.com' },
  'GME':   { name: 'GameStop Corp.', sector: 'Consumer', exchange: 'NYSE', domain: 'gamestop.com' },
  'AMC':   { name: 'AMC Entertainment', sector: 'Communication', exchange: 'NYSE', domain: 'amctheatres.com' },
  'RIVN':  { name: 'Rivian Automotive', sector: 'Automotive', exchange: 'NASDAQ', domain: 'rivian.com' },
  'LCID':  { name: 'Lucid Group', sector: 'Automotive', exchange: 'NASDAQ', domain: 'lucidmotors.com' },
  'SOFI':  { name: 'SoFi Technologies', sector: 'Financial', exchange: 'NASDAQ', domain: 'sofi.com' },
  'HOOD':  { name: 'Robinhood Markets', sector: 'Financial', exchange: 'NASDAQ', domain: 'robinhood.com' },
  'MSTR':  { name: 'MicroStrategy', sector: 'Technology', exchange: 'NASDAQ', domain: 'microstrategy.com' },
  'ARM':   { name: 'ARM Holdings', sector: 'Technology', exchange: 'NASDAQ', domain: 'arm.com' },
  'SMCI':  { name: 'Super Micro Computer', sector: 'Technology', exchange: 'NASDAQ', domain: 'supermicro.com' },
  'CRWD':  { name: 'CrowdStrike', sector: 'Technology', exchange: 'NASDAQ', domain: 'crowdstrike.com' },
  'PANW':  { name: 'Palo Alto Networks', sector: 'Technology', exchange: 'NASDAQ', domain: 'paloaltonetworks.com' },
  'NOW':   { name: 'ServiceNow', sector: 'Technology', exchange: 'NYSE', domain: 'servicenow.com' },
  'MU':    { name: 'Micron Technology', sector: 'Technology', exchange: 'NASDAQ', domain: 'micron.com' },
  'ROKU':  { name: 'Roku Inc.', sector: 'Technology', exchange: 'NASDAQ', domain: 'roku.com' },
  'RBLX':  { name: 'Roblox Corp.', sector: 'Technology', exchange: 'NYSE', domain: 'roblox.com' },
  'NET':   { name: 'Cloudflare Inc.', sector: 'Technology', exchange: 'NYSE', domain: 'cloudflare.com' },
  'DKNG':  { name: 'DraftKings Inc.', sector: 'Consumer', exchange: 'NASDAQ', domain: 'draftkings.com' },

  // ETFs
  'SPY':   { name: 'S&P 500 ETF', sector: 'Index', exchange: 'NYSE', domain: 'ssga.com' },
  'QQQ':   { name: 'Nasdaq 100 ETF', sector: 'Index', exchange: 'NASDAQ', domain: 'invesco.com' },
  'IWM':   { name: 'Russell 2000 ETF', sector: 'Index', exchange: 'NYSE', domain: 'ishares.com' },
  'DIA':   { name: 'Dow Jones ETF', sector: 'Index', exchange: 'NYSE', domain: 'ssga.com' },
  'GLD':   { name: 'Gold ETF', sector: 'Commodity', exchange: 'NYSE', domain: 'spdrgoldshares.com' },
  'SLV':   { name: 'Silver ETF', sector: 'Commodity', exchange: 'NYSE', domain: 'ishares.com' },
  'VOO':   { name: 'Vanguard S&P 500 ETF', sector: 'Index', exchange: 'NYSE', domain: 'vanguard.com' },
  'ARKK':  { name: 'ARK Innovation ETF', sector: 'Thematic', exchange: 'NYSE', domain: 'ark-invest.com' },
  'XLF':   { name: 'Financial Select SPDR', sector: 'Financial', exchange: 'NYSE', domain: 'ssga.com' },
  'XLK':   { name: 'Technology Select SPDR', sector: 'Technology', exchange: 'NYSE', domain: 'ssga.com' },
  'XLE':   { name: 'Energy Select SPDR', sector: 'Energy', exchange: 'NYSE', domain: 'ssga.com' },
  'TLT':   { name: '20+ Year Treasury Bond', sector: 'Bond', exchange: 'NASDAQ', domain: 'ishares.com' },
};
```

---

## STEP 2: FIX THE RESOLVE ENDPOINT

Find the endpoint the extension calls to resolve a cashtag. It's probably something like `/api/ext/resolve`, `/api/resolve`, `/api/token/resolve`, or the extension might call `/api/tokens/search` directly.

**Search for it:**
```bash
# In the extension code, find what URL it calls
grep -rn "resolve\|search\|lookup\|fetch.*token\|api.*ext" extension/ --include="*.js" --include="*.jsx" --include="*.ts" | head -30

# In the server, find the endpoint
grep -n "resolve\|ext/" server/index.js | head -30
```

**The fix pattern — wherever the resolve logic lives, implement this order:**

```javascript
async function resolveTickerToAsset(ticker) {
  const upperTicker = ticker.toUpperCase().replace(/^\$/, '');
  
  // ══════════════════════════════════════════════════════
  // PRIORITY 1: Check if it's a known stock ticker
  // This MUST happen BEFORE any crypto search
  // ══════════════════════════════════════════════════════
  const stockInfo = STOCK_TICKERS[upperTicker];
  if (stockInfo) {
    const resolvedTicker = stockInfo.alias || upperTicker;
    const resolvedInfo = stockInfo.alias ? STOCK_TICKERS[stockInfo.alias] : stockInfo;
    
    // Fetch live stock price from Yahoo
    let priceData = null;
    try {
      priceData = await fetchStockPrice(resolvedTicker);
    } catch (e) {
      console.warn(`[resolve] Stock price failed for ${resolvedTicker}:`, e.message);
      // Try fallback static data
      priceData = FALLBACK_STOCK_DATA[resolvedTicker] || null;
    }
    
    return {
      resolved: true,
      assetType: 'stock',
      symbol: resolvedTicker,
      name: resolvedInfo.name,
      logo: `https://logo.clearbit.com/${resolvedInfo.domain}`,
      sector: resolvedInfo.sector,
      exchange: resolvedInfo.exchange,
      price: priceData?.price || null,
      change24h: priceData?.change || null,
      changeAbs: priceData?.changeAbs || null,
      marketCap: priceData?.marketCap || null,
      volume: priceData?.volume || null,
      pe: priceData?.pe || null,
      week52High: priceData?.week52High || null,
      week52Low: priceData?.week52Low || null,
      // Stock-specific: NO BTC.D, NO ETH.D, NO Fear & Greed
      showBtcDominance: false,
      showEthDominance: false,
      showFearGreed: false,
    };
  }
  
  // ══════════════════════════════════════════════════════
  // PRIORITY 2: Check known crypto symbols (BTC, ETH, SOL, etc.)
  // ══════════════════════════════════════════════════════
  const KNOWN_CRYPTO = {
    'BTC': { name: 'Bitcoin', cgId: 'bitcoin' },
    'ETH': { name: 'Ethereum', cgId: 'ethereum' },
    'SOL': { name: 'Solana', cgId: 'solana' },
    'BNB': { name: 'BNB', cgId: 'binancecoin' },
    'XRP': { name: 'XRP', cgId: 'ripple' },
    'ADA': { name: 'Cardano', cgId: 'cardano' },
    'DOGE': { name: 'Dogecoin', cgId: 'dogecoin' },
    'AVAX': { name: 'Avalanche', cgId: 'avalanche-2' },
    'DOT': { name: 'Polkadot', cgId: 'polkadot' },
    'LINK': { name: 'Chainlink', cgId: 'chainlink' },
    'UNI': { name: 'Uniswap', cgId: 'uniswap' },
    'SHIB': { name: 'Shiba Inu', cgId: 'shiba-inu' },
    'PEPE': { name: 'Pepe', cgId: 'pepe' },
    'ARB': { name: 'Arbitrum', cgId: 'arbitrum' },
    'OP':  { name: 'Optimism', cgId: 'optimism' },
    'SUI': { name: 'Sui', cgId: 'sui' },
    'APT': { name: 'Aptos', cgId: 'aptos' },
    'INJ': { name: 'Injective', cgId: 'injective-protocol' },
    'NEAR': { name: 'NEAR Protocol', cgId: 'near' },
    'FET': { name: 'Fetch.ai', cgId: 'fetch-ai' },
    'RENDER': { name: 'Render', cgId: 'render-token' },
    'RNDR': { name: 'Render', cgId: 'render-token' },
    'TAO': { name: 'Bittensor', cgId: 'bittensor' },
    'WIF': { name: 'dogwifhat', cgId: 'dogwifcoin' },
    'BONK': { name: 'Bonk', cgId: 'bonk' },
    'AAVE': { name: 'Aave', cgId: 'aave' },
    'MKR': { name: 'Maker', cgId: 'maker' },
    // Add more as needed
  };
  
  const knownCrypto = KNOWN_CRYPTO[upperTicker];
  if (knownCrypto) {
    // Fetch from Binance (fastest) or CoinGecko
    let priceData = null;
    try {
      priceData = await fetchCryptoPriceBinance(upperTicker);
    } catch (e) {
      try {
        priceData = await fetchCryptoPriceCoinGecko(knownCrypto.cgId);
      } catch (e2) {
        console.warn(`[resolve] Crypto price failed for ${upperTicker}`);
      }
    }
    
    return {
      resolved: true,
      assetType: 'crypto',
      symbol: upperTicker,
      name: knownCrypto.name,
      logo: `https://assets.coingecko.com/coins/images/${getCoinGeckoImageId(knownCrypto.cgId)}/small/${knownCrypto.cgId}.png`,
      price: priceData?.price || null,
      change24h: priceData?.change24h || null,
      marketCap: priceData?.marketCap || null,
      volume: priceData?.volume || null,
      showBtcDominance: true,
      showEthDominance: true,
      showFearGreed: true,
    };
  }
  
  // ══════════════════════════════════════════════════════
  // PRIORITY 3: Search Codex API for unknown tokens
  // This is the fallback for smaller/newer tokens
  // ══════════════════════════════════════════════════════
  try {
    const searchResult = await searchTokenCodex(upperTicker);
    if (searchResult && searchResult.address) {
      // Fetch price from Codex
      let priceData = null;
      try {
        priceData = await fetchTokenPriceCodex(searchResult.address, searchResult.networkId);
      } catch (e) {
        console.warn(`[resolve] Codex price failed for ${upperTicker}`);
      }
      
      return {
        resolved: true,
        assetType: 'crypto',
        symbol: upperTicker,
        name: searchResult.name || upperTicker,
        address: searchResult.address,
        networkId: searchResult.networkId,
        logo: searchResult.logo || null,
        price: priceData?.price || null,
        change24h: priceData?.change24h || null,
        marketCap: priceData?.marketCap || null,
        volume: priceData?.volume || null,
        showBtcDominance: true,
        showEthDominance: true,
        showFearGreed: true,
      };
    }
  } catch (e) {
    console.warn(`[resolve] Codex search failed for ${upperTicker}:`, e.message);
  }
  
  // ══════════════════════════════════════════════════════
  // PRIORITY 4: Nothing found
  // ══════════════════════════════════════════════════════
  return {
    resolved: false,
    symbol: upperTicker,
    error: 'Token not found',
  };
}
```

### CRITICAL: The stock price fetcher

Make sure a `fetchStockPrice()` function exists that calls Yahoo Finance v8 chart (which is already in your server):

```javascript
// Reuse the EXISTING fetchYahooChartPrice function from server/index.js
// It's already there! Just make sure the resolve endpoint can call it.
// If it's not accessible, extract it or call the existing /api/stocks/quotes endpoint:

async function fetchStockPrice(symbol) {
  // Option A: Call the existing internal endpoint
  try {
    const url = `http://localhost:${PORT}/api/stocks/quotes?symbols=${symbol}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const quote = Array.isArray(data) ? data[0] : data[symbol] || data;
      if (quote && quote.price > 0) return quote;
    }
  } catch (e) { /* fall through */ }
  
  // Option B: Direct Yahoo fetch (if internal call doesn't work)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const prevClose = meta.chartPreviousClose || meta.regularMarketPrice;
    const change = prevClose > 0 ? ((meta.regularMarketPrice - prevClose) / prevClose * 100) : 0;
    return {
      price: meta.regularMarketPrice,
      change: parseFloat(change.toFixed(2)),
      changeAbs: parseFloat((meta.regularMarketPrice - prevClose).toFixed(2)),
      marketCap: meta.marketCap || 0,
      volume: meta.regularMarketVolume || 0,
    };
  } catch (e) {
    return null;
  }
}
```

---

## STEP 3: FIX THE CHART/SPARKLINE ENDPOINT

Find the chart endpoint the extension uses. Search for it:

```bash
grep -rn "sparkline\|chart\|7d.*chart\|candle\|ohlc" extension/ --include="*.js" --include="*.jsx" | head -20
grep -rn "sparkline\|ext.*chart\|ext.*spark" server/index.js | head -20
```

**The fix: Make the chart endpoint handle BOTH stocks and crypto.**

```javascript
// Wherever the extension chart/sparkline endpoint is:

app.get('/api/ext/sparkline', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase();
  const assetType = req.query.assetType || 'auto'; // 'stock', 'crypto', or 'auto'
  const points = parseInt(req.query.points) || 24;
  
  if (!symbol) return res.json({ points: [] });
  
  const isStock = assetType === 'stock' || STOCK_TICKERS[symbol] || FALLBACK_STOCK_DATA?.[symbol];
  
  if (isStock) {
    // ── STOCK SPARKLINE: Yahoo Finance intraday ──
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=30m&range=7d`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const result = data?.chart?.result?.[0];
        if (result?.timestamp?.length > 0) {
          const closes = result.indicators?.quote?.[0]?.close || [];
          const allPoints = result.timestamp.map((t, i) => ({
            t,
            c: closes[i] || 0,
          })).filter(p => p.c > 0);
          
          // Downsample to requested points
          const step = Math.max(1, Math.floor(allPoints.length / points));
          const downsampled = allPoints.filter((_, i) => i % step === 0).slice(0, points);
          
          // Calculate 7d change from first to last point
          const first = downsampled[0]?.c || 0;
          const last = downsampled[downsampled.length - 1]?.c || 0;
          const change7d = first > 0 ? ((last - first) / first * 100) : 0;
          
          return res.json({
            symbol,
            assetType: 'stock',
            points: downsampled,
            change7d: parseFloat(change7d.toFixed(2)),
            source: 'yahoo',
          });
        }
      }
    } catch (e) {
      console.warn(`[sparkline] Yahoo failed for ${symbol}:`, e.message);
    }
    // Stock sparkline failed — return empty
    return res.json({ symbol, assetType: 'stock', points: [], change7d: 0 });
  }
  
  // ── CRYPTO SPARKLINE: Codex or Binance ──
  // First, try to find the token address
  const address = req.query.address;
  const networkId = parseInt(req.query.networkId) || 1;
  
  if (address) {
    // Use Codex bars
    try {
      const now = Math.floor(Date.now() / 1000);
      const from = now - 7 * 24 * 60 * 60; // 7 days
      const formattedAddr = address.startsWith('0x') ? address.toLowerCase() : address;
      const tokenSymbol = `${formattedAddr}:${networkId}`;
      
      const query = `
        query GetTokenBars($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
          getTokenBars(symbol: $symbol, from: $from, to: $to, resolution: "60") {
            c t
          }
        }
      `;
      
      const result = await executeCodexQuery(query, {
        symbol: tokenSymbol,
        from,
        to: now,
        resolution: '60',
      });
      
      const bars = result?.getTokenBars;
      if (bars?.t?.length > 0) {
        const allPoints = bars.t.map((t, i) => ({
          t,
          c: parseFloat(bars.c[i]) || 0,
        })).filter(p => p.c > 0);
        
        const step = Math.max(1, Math.floor(allPoints.length / points));
        const downsampled = allPoints.filter((_, i) => i % step === 0).slice(0, points);
        
        const first = downsampled[0]?.c || 0;
        const last = downsampled[downsampled.length - 1]?.c || 0;
        const change7d = first > 0 ? ((last - first) / first * 100) : 0;
        
        return res.json({
          symbol,
          assetType: 'crypto',
          points: downsampled,
          change7d: parseFloat(change7d.toFixed(2)),
          source: 'codex',
        });
      }
    } catch (e) {
      console.warn(`[sparkline] Codex failed for ${symbol}:`, e.message);
    }
  }
  
  // Fallback: Try Binance klines for major cryptos
  try {
    const binanceSymbol = `${symbol}USDT`;
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=4h&limit=42`; // ~7 days of 4h candles
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const klines = await resp.json();
      if (Array.isArray(klines) && klines.length > 0) {
        const allPoints = klines.map(k => ({
          t: Math.floor(k[0] / 1000),
          c: parseFloat(k[4]) || 0, // Close price
        }));
        
        const step = Math.max(1, Math.floor(allPoints.length / points));
        const downsampled = allPoints.filter((_, i) => i % step === 0).slice(0, points);
        
        const first = downsampled[0]?.c || 0;
        const last = downsampled[downsampled.length - 1]?.c || 0;
        const change7d = first > 0 ? ((last - first) / first * 100) : 0;
        
        return res.json({
          symbol,
          assetType: 'crypto',
          points: downsampled,
          change7d: parseFloat(change7d.toFixed(2)),
          source: 'binance',
        });
      }
    }
  } catch (e) {
    console.warn(`[sparkline] Binance failed for ${symbol}:`, e.message);
  }
  
  // Everything failed
  return res.json({ symbol, assetType: 'crypto', points: [], change7d: 0 });
});
```

---

## STEP 4: FIX THE POPUP UI (FRONTEND)

Find the popup component that renders the hover card:

```bash
# Find it
find . -path "*/extension*" -name "*.jsx" -o -name "*.tsx" -o -name "*.js" -o -name "*.html" | xargs grep -l "chart\|sparkline\|price\|market.cap\|RISK\|View in Spectre" 2>/dev/null | head -10
```

**Fixes needed in the popup/card component:**

### Fix 4A: Handle `assetType` in the response

The popup needs to render differently for stocks vs crypto:

```javascript
// In the popup component, after receiving resolve data:

const isStock = data.assetType === 'stock';

// DON'T show BTC.D and ETH.D for stocks
{!isStock && (
  <div className="dominance-row">
    <span>BTC.D {btcDominance}%</span>
    <span>ETH.D {ethDominance}%</span>
  </div>
)}

// For stocks, show sector and exchange instead
{isStock && (
  <div className="stock-meta-row">
    <span>{data.sector}</span>
    <span>{data.exchange}</span>
  </div>
)}

// For stocks, show P/E ratio instead of Fear & Greed
{isStock && data.pe && (
  <div className="stock-pe">P/E {data.pe.toFixed(1)}</div>
)}
```

### Fix 4B: Handle logos properly

```javascript
// Logo rendering — use the logo URL from the resolve response
const logoUrl = data.logo;
const hasLogo = logoUrl && logoUrl.startsWith('http');

{hasLogo ? (
  <img 
    src={logoUrl} 
    alt={data.symbol} 
    className="token-logo"
    onError={(e) => {
      // Fallback to letter avatar on error
      e.target.style.display = 'none';
      e.target.nextSibling.style.display = 'flex';
    }}
  />
) : null}
<div className="token-logo-fallback" style={{ display: hasLogo ? 'none' : 'flex' }}>
  {(data.symbol || '?')[0]}
</div>
```

### Fix 4C: Handle "no chart data" properly

The popup probably isn't passing the right parameters to the sparkline endpoint:

```javascript
// When fetching sparkline, pass assetType and address
async function fetchSparkline(symbol, assetType, address, networkId) {
  const params = new URLSearchParams({ symbol, points: '24' });
  if (assetType) params.set('assetType', assetType);
  if (address) params.set('address', address);
  if (networkId) params.set('networkId', networkId.toString());
  
  const res = await fetch(`${API_BASE}/api/ext/sparkline?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.points?.length > 0 ? data : null;
}
```

### Fix 4D: Handle price display

```javascript
// Format price based on asset type and magnitude
function formatPrice(price, assetType) {
  if (price === null || price === undefined) return 'Price unavailable';
  if (price === 0) return 'Price unavailable'; // DON'T show $0.000000
  
  if (assetType === 'stock') {
    // Stocks: always 2 decimal places
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  
  // Crypto: dynamic precision
  if (price >= 1) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(8)}`;
}
```

### Fix 4E: Fix AI Analysis

The AI analysis needs to be different for stocks vs crypto, and should use ACTUAL data:

```javascript
function generateQuickAnalysis(data) {
  const { symbol, assetType, price, change24h, pe, marketCap, sector } = data;
  
  if (!price || price === 0) {
    return `${symbol} — data currently unavailable.`;
  }
  
  if (assetType === 'stock') {
    // Stock analysis — use PE, sector, change
    const direction = change24h > 1 ? 'gaining momentum' :
                      change24h > 0 ? 'edging higher' :
                      change24h > -1 ? 'pulling back slightly' :
                      'under pressure';
    
    const valuation = pe ? (pe > 40 ? 'richly valued' : pe > 25 ? 'growth-priced' : pe > 15 ? 'fairly valued' : 'value-priced') : '';
    
    return `${symbol} ${direction} at $${price.toFixed(2)} (${change24h > 0 ? '+' : ''}${change24h?.toFixed(2)}%).${valuation ? ` ${valuation} at ${pe?.toFixed(1)}x earnings.` : ''} ${sector ? `${sector} sector.` : ''}`;
  }
  
  // Crypto analysis — use change, market cap
  const direction = change24h > 5 ? 'surging' :
                    change24h > 1 ? 'climbing' :
                    change24h > 0 ? 'holding steady' :
                    change24h > -5 ? 'retreating' :
                    'selling off';
  
  const mcapLabel = marketCap > 10_000_000_000 ? 'Large cap' :
                    marketCap > 1_000_000_000 ? 'Mid cap' :
                    marketCap > 100_000_000 ? 'Small cap' : 'Micro cap';
  
  return `${symbol} ${direction} at $${formatCompactPrice(price)} (${change24h > 0 ? '+' : ''}${change24h?.toFixed(2)}%). ${mcapLabel}${marketCap ? ` — $${formatCompactNumber(marketCap)} market cap.` : '.'}`;
}
```

---

## STEP 5: FIX THE CONTENT SCRIPT (CASHTAG DETECTION)

Find the content script:
```bash
find . -path "*/extension*" -name "content*" | head -10
grep -l "cashtag\|\\\$[A-Z]\|textContent\|MutationObserver" extension/ -r | head -10
```

**Common bug:** The content script regex might be too greedy or not properly extracting the ticker. Ensure:

```javascript
// Correct cashtag regex — captures $AAPL, $BTC, $SPY, etc.
// Must handle: $AAPL, $BRK.B, $BTC
const CASHTAG_REGEX = /\$([A-Z]{1,5}(?:\.[A-Z])?)\b/g;

// When processing matches, STRIP the $ sign before sending to resolve
const ticker = match[1]; // "AAPL" not "$AAPL"
```

---

## STEP 6: FIX THE MARKET CAP DISPLAY

From the screenshots, AMZN shows market cap as **$32.00** which is obviously the WRONG FIELD being displayed.

```bash
# Find where marketCap is displayed
grep -rn "market.*cap\|marketCap\|mcap" extension/ --include="*.js" --include="*.jsx" | head -20
```

**The fix:** Make sure marketCap is displayed with proper formatting:

```javascript
function formatMarketCap(value) {
  if (!value || value === 0) return 'N/A';
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

// Make sure you're reading the RIGHT field
// The bug might be: displaying `price` in the marketCap slot
// Or: the API returns marketCap in millions and the UI doesn't multiply
```

---

## STEP 7: VERIFICATION CHECKLIST

After making all fixes, test EVERY ONE of these:

```bash
# ── STOCK TESTS ──
curl "http://localhost:3001/api/ext/resolve?ticker=AAPL" | jq '{assetType, name, price, change24h, logo, showBtcDominance}'
# Expected: assetType "stock", name "Apple Inc.", price ~230, logo "https://logo.clearbit.com/apple.com", showBtcDominance false

curl "http://localhost:3001/api/ext/resolve?ticker=AMZN" | jq '{assetType, name, price}'
# Expected: assetType "stock", name "Amazon.com Inc.", price ~230, NOT "AMZNON", NOT $0

curl "http://localhost:3001/api/ext/resolve?ticker=TSLA" | jq '{assetType, name, price}'
# Expected: assetType "stock", name "Tesla Inc.", price > 0

curl "http://localhost:3001/api/ext/resolve?ticker=MSFT" | jq '{assetType, name, price}'
# Expected: assetType "stock", price > 0

curl "http://localhost:3001/api/ext/resolve?ticker=PLTR" | jq '{assetType, name}'
# Expected: assetType "stock", name "Palantir Technologies"

curl "http://localhost:3001/api/ext/resolve?ticker=NVDA" | jq '{assetType, price}'
# Expected: assetType "stock", price > 0

# ── CRYPTO TESTS ──
curl "http://localhost:3001/api/ext/resolve?ticker=BTC" | jq '{assetType, name, price, showBtcDominance}'
# Expected: assetType "crypto", price > 0, showBtcDominance true

curl "http://localhost:3001/api/ext/resolve?ticker=ETH" | jq '{assetType, price}'
# Expected: assetType "crypto", price > 0

curl "http://localhost:3001/api/ext/resolve?ticker=ZIG" | jq '{resolved, name, price}'
# Expected: resolved true (if in Codex), price > 0

curl "http://localhost:3001/api/ext/resolve?ticker=SOL" | jq '{assetType, price}'
# Expected: assetType "crypto", price > 0

# ── SPARKLINE TESTS ──
curl "http://localhost:3001/api/ext/sparkline?symbol=AAPL&assetType=stock" | jq '{symbol, assetType, "pointCount": (.points | length), change7d}'
# Expected: 20+ points, assetType "stock"

curl "http://localhost:3001/api/ext/sparkline?symbol=BTC&assetType=crypto" | jq '{symbol, "pointCount": (.points | length)}'
# Expected: 20+ points

# ── AMBIGUITY TESTS (critical!) ──
curl "http://localhost:3001/api/ext/resolve?ticker=COIN" | jq '{assetType, name}'
# Expected: assetType "stock", name "Coinbase Global" (NOT the crypto token)
# COIN is in STOCK_TICKERS so it should resolve as stock

curl "http://localhost:3001/api/ext/resolve?ticker=SUI" | jq '{assetType, name}'
# Expected: assetType "crypto" (SUI is NOT in STOCK_TICKERS, IS in KNOWN_CRYPTO)

curl "http://localhost:3001/api/ext/resolve?ticker=MOODENG" | jq '{resolved, assetType}'
# Expected: assetType "crypto" via Codex search (not a stock, not in known crypto)
```

---

## STEP 8: COMMON PITFALLS TO AVOID

1. **DON'T change the extension popup's visual design.** Only fix data flow and conditional rendering (stock vs crypto). Read `SPECTRE_DESIGN_LAW.md` for the design rules.

2. **DON'T rebuild existing stock endpoints.** The `/api/stocks/quotes`, `/api/stocks/candles`, etc. already work. Reuse them.

3. **DON'T add new npm dependencies.** Everything you need (fetch, WebSocket, etc.) is already available.

4. **DON'T break the existing crypto flow.** The resolve must still work for all crypto tokens. Stocks are ADDITIVE.

5. **Watch for the `$V` edge case.** "V" is both Visa (stock) and could be mistaken for a 1-letter search. Since it's in `STOCK_TICKERS`, it resolves as Visa. This is correct — there's no major crypto called "V".

6. **Watch for the `$COIN` edge case.** COIN is both Coinbase stock AND could be a generic word. Since it's in `STOCK_TICKERS`, it resolves as Coinbase stock. This is the desired behavior for the extension (crypto traders on Twitter who type $COIN mean Coinbase stock).

7. **The change percentage bug** — Apple showed "260%" which is likely a calculation error. Check: is the `change` field from Yahoo being interpreted as absolute price change instead of percentage? Yahoo's `regularMarketChangePercent` is already in percent. But `regularMarketChange` is in dollars. Make sure you use the right one.

8. **Timeout handling** — If Yahoo or Codex is slow, the popup should show a loading skeleton, not hang forever. Set 5-second timeouts on all API calls.

---

## SUMMARY OF FILES TO MODIFY

| File | What to Fix |
|---|---|
| `server/index.js` | Add STOCK_TICKERS registry, fix resolve endpoint, add/fix sparkline endpoint |
| Extension popup component (find it) | Handle assetType, fix price display, fix chart, fix logo, fix analysis |
| Extension content script (find it) | Verify cashtag regex captures correctly |
| Extension background/service worker | Pass assetType through message pipeline |

**Total estimated changes: ~300-400 lines across 3-4 files.**

**Priority order:**
1. STOCK_TICKERS registry + resolve fix (kills the AMZN→AMZNON bug)
2. Sparkline/chart fix (kills "No chart data")
3. Popup UI conditional rendering (kills BTC.D on stocks, wrong formatting)
4. Price formatting + market cap display (kills $0.000000 and $32.00 mcap)
5. AI analysis per asset type (kills generic template)

DO NOT SKIP STEP 0. Read the codebase first. Find the actual files. Then apply fixes.
