/**
 * TradingView UDF + bars + trades routes — chart data pipeline.
 * Extracted from index.js for maintainability.
 */
const express = require('express')
const router = express.Router()
const fetch = require('node-fetch')
const { getHelpers } = require('./_helpers')

function h() { return getHelpers() }

// Bars cache - historical bars don't change, only trailing edge updates
const barsCache = new Map();
const BARS_CACHE_TTL = 60_000;            // timestamp-based (scroll-back, polling)
const BARS_COUNTBACK_CACHE_TTL = 300_000; // countback-based (initial loads - 5min, historical bars are immutable)

router.get('/bars', async (req, res) => {
  try {
    const { symbol, from, to, resolution = '60', networkId: reqNetworkId, countback: reqCountback } = req.query;
    if (!symbol || !from || !to) {
      return res.status(400).json({ error: 'Missing required parameters: symbol, from, to' });
    }

    // Check bars cache first
    // When countback is present, use resolution-based key (high hit rate - same for all users viewing same token/timeframe)
    // When absent (scroll-back requests), use timestamp-based key
    const barsCacheKey = reqCountback
      ? `${symbol}:${resolution}:countback:${reqCountback}:${reqNetworkId || ''}`
      : `${symbol}:${resolution}:${from}:${to}:${reqNetworkId || ''}`;
    const cachedBars = barsCache.get(barsCacheKey);
    const barsTtl = reqCountback ? BARS_COUNTBACK_CACHE_TTL : BARS_CACHE_TTL;
    if (cachedBars && (Date.now() - cachedBars.ts) < barsTtl) {
      return res.json(cachedBars.data);
    }

    const upperSymbol = symbol.toUpperCase();
    const tokenInfo = getTokenInfo(upperSymbol); // Uses unified TOKEN_REGISTRY
    let bars = null;
    let source = null;

    // Validate bar prices are sane (reject raw on-chain amounts, NaN, Infinity)
    function hasValidPrices(barsArr) {
      if (!barsArr || barsArr.length === 0) return false;
      const recent = barsArr.slice(-30);
      // All zeros = no data
      if (recent.every(b => b.o === 0 && b.h === 0 && b.l === 0 && b.c === 0)) return false;
      // Any impossible value: NaN, Infinity, negative, > $1T per token
      if (recent.some(b => [b.o, b.h, b.l, b.c].some(v => !Number.isFinite(v) || v < 0 || v > 1e12))) return false;
      return true;
    }

    // ══════════════════════════════════════════
    // SPEED FIX: Try Codex FIRST (fast, <500ms), then onchain as fallback (slow, 5-15s)
    // Codex block moved up from Tier 1 position - see "TIER 1: Codex" below
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
        } else if (tokenInfo && tokenInfo.address) {
          tokenAddress = tokenInfo.address;
          networkId = tokenInfo.networkId;
        } else {
          tokenAddress = null;
        }

        if (tokenAddress) {
          const isSolana = !tokenAddress.startsWith('0x') && tokenAddress.length >= 32;
          if (isSolana && networkId === 1) networkId = 1399811149;
          const formatted = isSolana ? tokenAddress : tokenAddress.toLowerCase();
          const resMap = { '1S': '1S', '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240', '720': '720', 'D': '1D', '1D': '1D', 'W': '7D', '1W': '7D' };
          const codexRes = resMap[resolution] || resolution;
          const tokenSymbol = `${formatted}:${networkId}`;

          const result = await executeCodexQuery(
            `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!,$countback:Int){
              getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true,countback:$countback){s o h l c t volume}
            }`,
            { symbol: tokenSymbol, from: parseInt(from), to: parseInt(to), resolution: codexRes, countback: reqCountback ? parseInt(reqCountback) : 1500 },
          );

          const barsData = result?.getTokenBars;
          // Fast check: Codex returns s="no_data" when empty
          if (barsData?.s === 'no_data') {
            // Skip - no data available
          } else if (barsData?.t?.length > 0) {
            // Single-pass: map columnar → row format + filter nulls in one loop
            const realBars = [];
            for (let i = 0; i < barsData.t.length; i++) {
              if (barsData.o[i] != null && barsData.c[i] != null) {
                realBars.push({
                  t: barsData.t[i], o: barsData.o[i], h: barsData.h[i],
                  l: barsData.l[i], c: barsData.c[i],
                  v: parseFloat(barsData.volume?.[i]) || 0,
                });
              }
            }
            if (realBars.length > 0) {
              bars = realBars;
              source = 'codex-fast';
              console.log(`[Bars] ${symbol}: Codex fast path → ${bars.length} bars`);
            }
          }
        }
      } catch (e) {
        console.warn(`[Bars] Codex fast path failed for ${symbol}:`, e.message);
      }
    }

    // ══════════════════════════════════════════
    // TIER 0: Spectre Onchain API - fallback when Codex has no bars
    // Skip for: Solana (unreliable), polling requests (tiny time ranges <5min)
    // ══════════════════════════════════════════
    const timeRange = parseInt(to) - parseInt(from);
    if (!bars && timeRange > 300 && req.query.onchain !== 'false') {
      try {
        let tokenAddress, networkId;
        if (symbol.includes(':')) {
          const parts = symbol.split(':');
          tokenAddress = parts[0];
          networkId = parseInt(parts[1]) || 1;
        } else if (symbol.startsWith('0x') || symbol.length >= 32) {
          tokenAddress = symbol;
          networkId = parseInt(reqNetworkId) || 1;
        } else if (tokenInfo && tokenInfo.address) {
          // Resolve from TOKEN_REGISTRY (e.g. "SPECTRE" → address)
          tokenAddress = tokenInfo.address;
          networkId = tokenInfo.networkId || parseInt(reqNetworkId) || 1;
        } else {
          tokenAddress = null;
        }

        if (tokenAddress) {
          const isSolana = !tokenAddress.startsWith('0x') && tokenAddress.length >= 32;
          if (isSolana && networkId === 1) networkId = 1399811149;
          const addr = isSolana ? tokenAddress : tokenAddress.toLowerCase();

          // Only try for EVM chains where onchain API is reliable
          // Solana excluded: pool lookups consistently timeout/502, Codex handles Solana bars
          const onchainChains = new Set([1, 56]);
          console.log(`[Bars-T0] symbol=${symbol} addr=${addr} chainId=${networkId} res=${resolution} circuit=${onchainClient.circuit.state}`);
          if (onchainChains.has(networkId)) {
          // Step 1: Get primary pool for this token
          const poolPath = isSolana
            ? `/v2/solana/token/${addr}/markets`
            : `/v2/token/${addr}/pools`;
          const poolResult = await onchainClient.get(poolPath, isSolana ? {} : { chainId: networkId }, 5_000);
          const poolAddr = Array.isArray(poolResult.data) && poolResult.data.length > 0
            ? (poolResult.data[0].address || poolResult.data[0].market_address)
            : null;
          console.log(`[Bars-T0] pools result: poolAddr=${poolAddr} error=${poolResult.error || 'none'}`);

          if (poolAddr) {
            // Step 2: Fetch OHLCV for the pool
            // Convert Unix timestamps (seconds) to ISO strings for api-eth
            const isoFrom = from ? new Date(parseInt(from) * 1000).toISOString() : undefined;
            const isoTo = to ? new Date(parseInt(to) * 1000).toISOString() : undefined;
            const intervalMap = { '1': '1m', '5': '5m', '15': '15m', '30': '30s', '60': '1h', '240': '4h', 'D': '1d', '1D': '1d', 'W': '1d', '1W': '1d' };
            const interval = intervalMap[resolution] || '1h';
            const ohlcPath = isSolana
              ? `/v2/solana/market/${poolAddr}/ohlcv`
              : `/v2/pool/${poolAddr}/ohlc`;
            const ohlcParams = isSolana
              ? { interval, from: isoFrom, to: isoTo, limit: 1500 }
              : { chainId: networkId, interval, from: isoFrom, to: isoTo, limit: 1500 };
            console.log(`[Bars-T0] fetching OHLCV: path=${ohlcPath} interval=${interval} from=${isoFrom} to=${isoTo}`);
            const ohlcResult = await onchainClient.get(ohlcPath, ohlcParams, 5_000);
            console.log(`[Bars-T0] OHLCV result: isArray=${Array.isArray(ohlcResult.data)} len=${ohlcResult.data?.length ?? 'null'} error=${ohlcResult.error || 'none'}`);

            if (Array.isArray(ohlcResult.data) && ohlcResult.data.length > 0) {
              const mapped = ohlcResult.data.map(b => ({
                t: b.bucket ? Math.floor(new Date(b.bucket).getTime() / 1000) : 0,
                o: parseFloat(b.open) || 0,
                h: parseFloat(b.high) || 0,
                l: parseFloat(b.low) || 0,
                c: parseFloat(b.close) || 0,
                v: parseFloat(b.volume_usd) || 0,
              })).filter(b => b.t > 0);
              if (hasValidPrices(mapped)) {
                bars = mapped;
                source = 'spectre-api';
                console.log(`[Bars-T0] SUCCESS: ${bars.length} bars from spectre-api`);
              } else {
                console.warn(`[Bars-T0] Bad price data for ${symbol}, skipping to next tier`);
              }
            }
          }
        }
        } // close if (tokenAddress)
      } catch (e) {
        console.warn(`[Bars-T0] FAILED for ${symbol}:`, e.message);
      }
    }

    // ══════════════════════════════════════════
    // TIER 1: Codex (SKIP - already tried in fast path above)
    // ══════════════════════════════════════════
    if (false && !bars && (hasCodexAddress(upperSymbol) || symbol.includes(':') || symbol.startsWith('0x') || symbol.length >= 32)) {
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

        const resMap = { '1S': '1S', '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240', '720': '720', 'D': '1D', '1D': '1D', 'W': '7D', '1W': '7D' };
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
          const mapped = barsData.t.map((t, i) => ({
            t, o: barsData.o[i], h: barsData.h[i], l: barsData.l[i], c: barsData.c[i],
            v: parseFloat(barsData.volume?.[i]) || 0,
          }));
          // Only accept if majority of bars have real OHLC data
          const realCount = mapped.filter(b => b.o != null && b.c != null).length;
          const realRatio = realCount / mapped.length;
          if (realRatio > 0.5) {
            const filtered = mapped.filter(b => b.o != null && b.c != null);
            if (hasValidPrices(filtered)) {
              bars = filtered;
              source = 'codex';
            } else {
              console.warn(`[Bars] Codex returned bad price data for ${symbol}, skipping`);
            }
          }
        }

        // Fallback: if weekly (7D) returned empty, fetch daily bars and aggregate into weeks
        if (!bars && codexRes === '7D') {
          const dailyResult = await executeCodexQuery(
            `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
              getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true){o h l c t volume}
            }`,
            { symbol: tokenSymbol, from: parseInt(from), to: parseInt(to), resolution: '1D' },
          );
          const dailyBars = dailyResult?.getTokenBars;
          if (dailyBars?.t?.length > 0) {
            const daily = dailyBars.t.map((t, i) => ({
              t, o: dailyBars.o[i], h: dailyBars.h[i], l: dailyBars.l[i], c: dailyBars.c[i],
              v: parseFloat(dailyBars.volume?.[i]) || 0,
            }));
            // Group by ISO week (Monday-start)
            const weeks = new Map();
            for (const b of daily) {
              const d = new Date(b.t * 1000);
              const day = d.getUTCDay();
              const mondayMs = d.getTime() - ((day === 0 ? 6 : day - 1) * 86400000);
              const weekKey = Math.floor(mondayMs / 1000 / 86400) * 86400;
              if (!weeks.has(weekKey)) {
                weeks.set(weekKey, { t: weekKey, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
              } else {
                const w = weeks.get(weekKey);
                w.h = Math.max(w.h, b.h);
                w.l = Math.min(w.l, b.l);
                w.c = b.c;
                w.v += b.v;
              }
            }
            bars = [...weeks.values()].sort((a, b) => a.t - b.t);
            source = 'codex';
            console.log(`[Bars] ${symbol}: aggregated ${daily.length} daily bars into ${bars.length} weekly bars`);
          }
        }
      } catch (e) {
        console.warn(`[Bars] Codex failed for ${symbol}:`, e.message);
      }
    }

    // ══════════════════════════════════════════
    // TIER 1.5: Dynamic Codex search for unknown symbols
    // When symbol isn't in registry, search Codex to find its on-chain address
    // ══════════════════════════════════════════
    if (!bars && !hasCodexAddress(upperSymbol) && !symbol.includes(':') && !symbol.startsWith('0x') && symbol.length < 32) {
      try {
        const searchResult = await executeCodexQuery(
          `query($search:String!,$limit:Int!){
            filterTokens(phrase:$search,limit:$limit,rankings:[{attribute:liquidity,direction:DESC}]){
              results{token{address symbol name networkId}priceUSD}
            }
          }`,
          { search: upperSymbol, limit: 5 }
        );
        const results = searchResult?.filterTokens?.results || [];
        const match = results.find(r => (r.token?.symbol || '').toUpperCase() === upperSymbol) || results[0];

        if (match?.token?.address) {
          const addr = match.token.address;
          const netId = match.token.networkId || parseInt(reqNetworkId) || 1;
          const isSolana = !addr.startsWith('0x') && addr.length >= 32;
          const formatted = isSolana ? addr : addr.toLowerCase();
          const resMap = { '1S': '1S', '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240', '720': '720', 'D': '1D', '1D': '1D', 'W': '7D', '1W': '7D' };
          const codexRes = resMap[resolution] || resolution;
          const tokenSymbol = `${formatted}:${netId}`;

          const result = await executeCodexQuery(
            `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
              getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true){o h l c t volume}
            }`,
            { symbol: tokenSymbol, from: parseInt(from), to: parseInt(to), resolution: codexRes },
          );

          const barsData = result?.getTokenBars;
          if (barsData?.t?.length > 0) {
            const mapped = barsData.t.map((t, i) => ({
              t, o: barsData.o[i], h: barsData.h[i], l: barsData.l[i], c: barsData.c[i],
              v: parseFloat(barsData.volume?.[i]) || 0,
            }));
            // Only accept if majority of bars have real OHLC data
            const realCount = mapped.filter(b => b.o != null && b.c != null).length;
            const realRatio = realCount / mapped.length;
            if (realRatio > 0.5) {
              const filtered = mapped.filter(b => b.o != null && b.c != null);
              if (hasValidPrices(filtered)) {
                bars = filtered;
                source = 'codex';
                console.log(`[Bars] ${symbol}: Dynamic resolved → ${match.token.symbol} (${tokenSymbol}), ${bars.length} bars (${realCount}/${mapped.length} valid)`);
              } else {
                console.warn(`[Bars] ${symbol}: Dynamic resolved → ${match.token.symbol} but prices are invalid (>$1T or NaN), skipping`);
              }
            } else {
              console.log(`[Bars] ${symbol}: Dynamic resolved → ${match.token.symbol} (${tokenSymbol}) but only ${realCount}/${mapped.length} bars have data, skipping`);
            }
          }
        }
      } catch (e) {
        console.warn(`[Bars] Dynamic Codex search failed for ${symbol}:`, e.message);
      }
    }

    // ══════════════════════════════════════════
    // TIER 2: Binance REST klines (if token has Binance pair)
    // ══════════════════════════════════════════
    if (!bars && hasBinancePair(upperSymbol)) {
      try {
        const binanceSym = getBinanceSymbol(upperSymbol);
        const intervalMap = { '1S': '1s', '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '240': '4h', 'D': '1d', '1D': '1d', 'W': '1w', '1W': '1w' };
        const interval = intervalMap[resolution] || '1h';

        // Use endTime only (no startTime) to get the MOST RECENT 1000 bars.
        // With startTime, Binance returns oldest-first and caps at 1000, which
        // cuts off recent data when the requested period > 1000 bars.
        const endMs = parseInt(to) * 1000;
        const fromMs = parseInt(from) * 1000;
        // Calculate how many bars fit in the requested window at this interval
        const intervalMs = { '1s': 1e3, '1m': 6e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 };
        const barMs = intervalMs[interval] || 36e5;
        const requestedBars = Math.ceil((endMs - fromMs) / barMs);
        // Only use startTime if the window fits within 1000 bars, otherwise
        // fetch the most recent 1000 to avoid cutting off current data
        const url = requestedBars <= 1000
          ? `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&startTime=${fromMs}&endTime=${endMs}&limit=1000`
          : `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&endTime=${endMs}&limit=1000`;
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
    // TIER 3: CoinGecko market_chart (line chart data - broad token coverage)
    // Returns price-only points (o=h=l=c=price) for line chart rendering
    // ══════════════════════════════════════════
    if (!bars) {
      try {
        const cgId = SYMBOL_TO_COINGECKO_ID[upperSymbol] || req.query.cgId;
        if (cgId) {
          const rangeSeconds = parseInt(to) - parseInt(from);
          const days = Math.max(1, Math.ceil(rangeSeconds / 86400));
          const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`;
          const opts = { headers: { Accept: 'application/json' } };
          if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
          console.log(`[Bars-T3] Trying CoinGecko market_chart for ${symbol} (cgId=${cgId}, days=${days})`);
          const response = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
          if (response.ok) {
            const chartData = await response.json();
            if (chartData.prices?.length > 0) {
              const volumeMap = new Map();
              if (chartData.total_volumes) {
                for (const [ts, vol] of chartData.total_volumes) {
                  volumeMap.set(ts, vol);
                }
              }
              bars = chartData.prices.map(([tsMs, price]) => ({
                t: Math.floor(tsMs / 1000),
                o: price, h: price, l: price, c: price,
                v: volumeMap.get(tsMs) || 0,
              }));
              source = 'coingecko-chart';
              console.log(`[Bars-T3] ${symbol}: ${bars.length} line points from CoinGecko market_chart`);
            }
          }
        }
      } catch (e) {
        console.warn(`[Bars-T3] CoinGecko market_chart failed for ${symbol}:`, e.message);
      }
    }

    // ══════════════════════════════════════════
    // Return whatever we have
    // ══════════════════════════════════════════
    if (bars && bars.length > 0) {
      console.log(`[Bars] ${symbol}: ${bars.length} bars from ${source}`);
      const response = {
        bars,
        source,
        chartType: source === 'coingecko-chart' ? 'line' : (bars.length >= 10 ? 'candlestick' : bars.length >= 2 ? 'line' : 'single'),
      };
      barsCache.set(barsCacheKey, { data: response, ts: Date.now() });
      // Evict oldest entry (O(n) scan instead of O(n log n) sort)
      if (barsCache.size > 200) {
        let oldestKey = null, oldestTs = Infinity;
        for (const [k, v] of barsCache) {
          if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
        }
        if (oldestKey) barsCache.delete(oldestKey);
      }
      // Browser cache: 30s fresh, serve stale up to 60s while revalidating
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return res.json(response);
    }

    console.log(`[Bars] ${symbol}: No bars from any source`);
    res.json({ bars: [], source: 'none', chartType: 'empty' });

  } catch (error) {
    console.error('Bars error:', error);
    res.json({ bars: [], source: 'error', chartType: 'empty', error: error.message });
  }
});

/**
 * Get token pairs/pools
 */
router.get('/api/tokens/:address/pairs', async (req, res) => {
  try {
    const { address } = req.params;
    const { networkId = 1, limit = 10 } = req.query;
    
    const query = `
      query GetTokenPairs($tokenAddress: String!, $networkId: Int!, $limit: Int!) {
        listPairsForToken(
          tokenAddress: $tokenAddress
          networkId: $networkId
          limit: $limit
        ) {
          address
          token0
          token1
        }
      }
    `;
    
    const result = await executeCodexQuery(query, { 
      tokenAddress: address.toLowerCase(), 
      networkId: parseInt(networkId),
      limit: parseInt(limit)
    });
    
    res.json({ pairs: result?.listPairsForToken || [] });
    
  } catch (error) {
    console.error('Pairs error:', error);
    res.status(500).json({ error: error.message, pairs: [] });
  }
});

/**
 * Resolve TradingView symbol for any DEX token.
 * TradingView uses format: DEX:TOKEN0TOKEN1_POOLSUFFIX.USD
 * Example: UNISWAP:SPECTREWETH_8A6D95.USD
 * We query Codex for the token's top pair, then construct the TV symbol.
 */
router.get('/tradingview/symbol', async (req, res) => {
  try {
    const { address, networkId = 1, symbol: tokenSymbolParam = '' } = req.query;
    if (!address) return res.status(400).json({ error: 'Missing address parameter' });

    // Map networkId to DEX name for TradingView
    const DEX_NAMES = {
      1: 'UNISWAP',       // Ethereum → Uniswap
      56: 'PANCAKESWAP',   // BSC → PancakeSwap
      137: 'QUICKSWAP',    // Polygon → QuickSwap
      42161: 'CAMELOT',    // Arbitrum → Camelot
      8453: 'AERODROME',   // Base → Aerodrome
      43114: 'TRADERJOE',  // Avalanche → Trader Joe
      10: 'VELODROME',     // Optimism → Velodrome
      1399811149: 'RAYDIUM', // Solana → Raydium
    };

    const dexName = DEX_NAMES[parseInt(networkId)] || 'UNISWAP';
    const formattedAddress = address.startsWith('0x') ? address.toLowerCase() : address;

    // Query Codex for the token's pairs — minimal fields (Pair type only has address, token0, token1)
    const query = `
      query GetTokenPairs($tokenAddress: String!, $networkId: Int!) {
        listPairsForToken(
          tokenAddress: $tokenAddress
          networkId: $networkId
          limit: 5
        ) {
          address
          token0
          token1
        }
      }
    `;

    const result = await executeCodexQuery(query, {
      tokenAddress: formattedAddress,
      networkId: parseInt(networkId),
    });

    const pairs = result?.listPairsForToken || [];
    if (pairs.length === 0) {
      return res.json({ symbol: null, supported: false });
    }

    // Use the first pair (Codex returns them ordered by relevance)
    const topPair = pairs[0];

    // We need to resolve token0/token1 addresses to symbols
    // Common quote tokens with known symbols
    const KNOWN_QUOTES = {
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
      '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB',
      '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WMATIC',
      'so11111111111111111111111111111111111111112': 'SOL',
    };

    // Determine which token is the target and which is the quote
    const isToken0 = topPair.token0?.toLowerCase() === formattedAddress.toLowerCase();
    const quoteAddr = isToken0 ? topPair.token1 : topPair.token0;
    const targetSym = (tokenSymbolParam || address.slice(0, 6)).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const quoteSym = KNOWN_QUOTES[quoteAddr?.toLowerCase()] || 'WETH';
    const poolSuffix = topPair.address.slice(-6).toUpperCase();

    // TradingView format: DEX:TOKEN0TOKEN1_POOLSUFFIX.USD
    const tvSymbol = `${dexName}:${targetSym}${quoteSym}_${poolSuffix}.USD`;

    console.log(`[TV] Resolved ${address} → ${tvSymbol} (pair: ${topPair.address})`);

    res.json({
      symbol: tvSymbol,
      supported: true,
      dex: dexName,
      pair: `${targetSym}/${quoteSym}`,
      pairAddress: topPair.address,
    });
  } catch (error) {
    console.error('TradingView symbol resolve error:', error);
    res.json({ symbol: null, supported: false, error: error.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   TradingView Universal Symbol Search — resolves ANY asset worldwide
   Uses TradingView's own symbol search API for stocks, crypto, forex, etc.
   Results are cached for 10 minutes to avoid rate-limiting.
   ═══════════════════════════════════════════════════════════════ */
const tvSearchCache = new Map();
const TV_SEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
_standaloneCaches.push({ map: tvSearchCache, ttlField: 'ts', ttlMs: TV_SEARCH_CACHE_TTL });

router.get('/tradingview/search', async (req, res) => {
  try {
    const { query, type = '' } = req.query;
    if (!query || query.length < 1) {
      return res.status(400).json({ error: 'query parameter required' });
    }

    const cacheKey = `${query.toUpperCase()}:${type}`;
    const cached = tvSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TV_SEARCH_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Call TradingView's symbol search API
    const params = new URLSearchParams({
      text: query,
      hl: '1',
      exchange: '',
      lang: 'en',
      type: type, // 'stock', 'crypto', 'futures', 'forex', 'index', 'fund', '' for all
      domain: 'production',
    });

    const tvRes = await fetch(
      `https://symbol-search.tradingview.com/symbol_search/?${params}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Origin': 'https://www.tradingview.com',
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!tvRes.ok) throw new Error(`TradingView search HTTP ${tvRes.status}`);
    const results = await tvRes.json();

    // Pick the best result — prioritize: spot > index > fund, primary_listing, USD pairs
    // For stocks: first result with is_primary_listing and type=stock
    // For crypto: first USDT spot on Binance, or first USD pair, or first spot
    let bestMatch = null;
    const sym = query.toUpperCase();

    if (type === 'stock') {
      // For stocks: prefer primary US listing
      bestMatch = results.find(r =>
        r.type === 'stock' && r.is_primary_listing && r.country === 'US'
      ) || results.find(r =>
        r.type === 'stock' && r.is_primary_listing
      ) || results.find(r =>
        r.type === 'stock'
      ) || results.find(r =>
        r.type === 'fund' && r.is_primary_listing
      );
    } else if (type === 'crypto') {
      // For crypto: prioritize Binance USDT, then major CEXes, then CRYPTO:XXXUSD
      const CEX_PRIORITY = ['BINANCE', 'BYBIT', 'OKX', 'COINBASE', 'KRAKEN', 'MEXC', 'BITGET'];
      const cleanSym = sym.replace(/<\/?em>/g, '');

      // 1. Exact match: Binance XXXUSDT spot
      bestMatch = results.find(r =>
        r.type === 'spot' && r.source_id === 'BINANCE' &&
        r.symbol.replace(/<\/?em>/g, '') === `${cleanSym}USDT`
      );
      // 2. Any Binance spot pair
      if (!bestMatch) bestMatch = results.find(r =>
        r.type === 'spot' && r.source_id === 'BINANCE'
      );
      // 3. USDT spot on major CEX
      if (!bestMatch) bestMatch = results.find(r =>
        r.type === 'spot' && r.currency_code === 'USDT' &&
        CEX_PRIORITY.includes(r.source_id)
      );
      // 4. USD spot on major CEX (Coinbase, Kraken often have USD pairs)
      if (!bestMatch) bestMatch = results.find(r =>
        r.type === 'spot' && r.currency_code === 'USD' &&
        CEX_PRIORITY.includes(r.source_id)
      );
      // 5. CRYPTO:XXXUSD (TradingView's own aggregated data)
      if (!bestMatch) bestMatch = results.find(r =>
        r.type === 'spot' && r.source_id === 'CRYPTO' &&
        r.symbol.replace(/<\/?em>/g, '').endsWith('USD')
      );
      // 6. Any USDT spot pair
      if (!bestMatch) bestMatch = results.find(r =>
        r.type === 'spot' && r.currency_code === 'USDT'
      );
      // 7. Any spot pair at all
      if (!bestMatch) bestMatch = results.find(r =>
        r.type === 'spot'
      );
    } else {
      // General: just pick the first result
      bestMatch = results[0];
    }

    if (!bestMatch) {
      const data = { found: false, symbol: null, exchange: null, type: null };
      evictIfFull(tvSearchCache, CACHE_MAX_ENTRIES);
      tvSearchCache.set(cacheKey, { ts: Date.now(), data });
      return res.json(data);
    }

    // Build the TradingView-formatted symbol
    const exchange = (bestMatch.prefix || bestMatch.source_id || bestMatch.exchange || '').toUpperCase();
    const tvSymbol = exchange ? `${exchange}:${bestMatch.symbol.replace(/<\/?em>/g, '')}` : bestMatch.symbol.replace(/<\/?em>/g, '');

    const data = {
      found: true,
      symbol: tvSymbol,
      exchange: exchange,
      description: (bestMatch.description || '').replace(/<\/?em>/g, ''),
      type: bestMatch.type,
      country: bestMatch.country || null,
      isPrimaryListing: bestMatch.is_primary_listing || false,
    };

    evictIfFull(tvSearchCache, CACHE_MAX_ENTRIES);
    tvSearchCache.set(cacheKey, { ts: Date.now(), data });
    res.json(data);
  } catch (error) {
    console.error('TradingView search error:', error.message);
    res.json({ found: false, symbol: null, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE S6: TRADINGVIEW UDF ENDPOINTS — stock + crypto charting
// Standard TradingView UDF protocol: /config, /symbols, /search, /time, /history
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/tradingview/udf/config', (req, res) => {
  res.json({
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [
      { value: '', name: 'All Exchanges', desc: '' },
      { value: 'NYSE', name: 'NYSE', desc: 'New York Stock Exchange' },
      { value: 'NASDAQ', name: 'NASDAQ', desc: 'Nasdaq' },
      { value: 'CRYPTO', name: 'Crypto', desc: 'Cryptocurrency' },
    ],
    symbols_types: [
      { name: 'All types', value: '' },
      { name: 'Stock', value: 'stock' },
      { name: 'Crypto', value: 'crypto' },
    ],
    supported_resolutions: ['1S', '1', '5', '15', '30', '60', '240', '720', '1D', '1W'],
  });
});

router.get('/tradingview/udf/time', (req, res) => {
  res.send(String(Math.floor(Date.now() / 1000)));
});

router.get('/tradingview/udf/symbols', async (req, res) => {
  const rawSymbol = (req.query.symbol || '');
  const isAddress = rawSymbol.startsWith('0x') || rawSymbol.includes(':');
  const symbol = isAddress ? rawSymbol : rawSymbol.toUpperCase();
  if (!symbol) return res.status(400).json({ s: 'error', errmsg: 'Missing symbol' });

  const fb = FALLBACK_STOCK_DATA[symbol];
  const isStock = POPULAR_STOCK_SYMBOLS.includes(symbol) || !!fb;

  // Calculate appropriate pricescale from a price value
  // pricescale determines decimal places: 100=2, 10000=4, 100000000=8, etc.
  function pricescaleFromPrice(price) {
    if (!price || price <= 0) return 100000000; // 8 decimals default
    if (price >= 10000) return 100;              // 2 decimals ($10,000+)
    if (price >= 100) return 10000;              // 4 decimals ($100+)
    if (price >= 1) return 10000;                // 4 decimals ($1+)
    if (price >= 0.01) return 1000000;           // 6 decimals ($0.01+)
    if (price >= 0.0001) return 100000000;       // 8 decimals ($0.0001+)
    return 10000000000;                           // 10 decimals (micro-cap)
  }

  if (isStock) {
    return res.json({
      name: symbol,
      'full_name': `${fb?.exchange || 'NYSE'}:${symbol}`,
      description: fb?.name || symbol,
      type: 'stock',
      session: '0930-1600',
      exchange: fb?.exchange || 'NYSE',
      'listed_exchange': fb?.exchange || 'NYSE',
      timezone: 'America/New_York',
      'has_intraday': true,
      'has_daily': true,
      'has_weekly_and_monthly': true,
      'supported_resolutions': ['1', '5', '15', '30', '60', 'D', 'W'],
      pricescale: 100,
      minmov: 1,
      'currency_code': 'USD',
    });
  }

  // Crypto — dynamically determine pricescale from actual token price
  // When symbol is "address:networkId", resolve the ticker name for display
  let displayName = symbol;
  let pricescale = 100000000; // default 8 decimals for unknowns

  if (isAddress) {
    // Try to resolve ticker from token registry or query param
    const addr = symbol.includes(':') ? symbol.split(':')[0] : symbol;
    const nid = symbol.includes(':') ? parseInt(symbol.split(':')[1]) : 1;
    // Look up in TOKEN_REGISTRY by address
    const registryEntry = Object.values(TOKEN_REGISTRY || {}).find(
      t => t.address && t.address.toLowerCase() === addr.toLowerCase() && (t.networkId === nid || !t.networkId)
    );
    if (registryEntry) {
      displayName = Object.keys(TOKEN_REGISTRY).find(k => TOKEN_REGISTRY[k] === registryEntry) || addr.slice(0, 8);
    } else {
      // Use ticker from query param if provided, otherwise abbreviate address
      displayName = (req.query.ticker || '').toUpperCase() || addr.slice(0, 6) + '...' + addr.slice(-4);
    }
    try {
      const priceData = await getPriceForSymbol(addr);
      if (priceData?.price > 0) pricescale = pricescaleFromPrice(priceData.price);
    } catch (e) {}
  } else if (symbol === 'BTC' || symbol === 'ETH') {
    pricescale = 100;
  } else {
    try {
      const priceData = await getPriceForSymbol(symbol);
      if (priceData?.price > 0) {
        pricescale = pricescaleFromPrice(priceData.price);
      }
    } catch (e) {
      // Keep default 8 decimals — safe for micro-cap tokens
    }
  }

  res.json({
    name: displayName,
    'full_name': `CRYPTO:${displayName}USD`,
    description: `${displayName}/USD`,
    type: 'crypto',
    session: '24x7',
    exchange: 'CRYPTO',
    'listed_exchange': 'CRYPTO',
    timezone: 'Etc/UTC',
    'has_intraday': true,
    'has_seconds': true,
    'has_daily': true,
    'has_weekly_and_monthly': true,
    'supported_resolutions': ['1S', '1', '5', '15', '30', '60', '240', 'D', 'W'],
    'seconds_multipliers': ['1'],
    pricescale,
    minmov: 1,
    'currency_code': 'USD',
  });
});

router.get('/tradingview/udf/search', async (req, res) => {
  const query = (req.query.query || '').toUpperCase();
  const limit = parseInt(req.query.limit) || 10;
  if (!query) return res.json([]);

  const results = [];

  // Search stocks first
  Object.entries(FALLBACK_STOCK_DATA).forEach(([sym, info]) => {
    if (sym.includes(query) || (info.name || '').toUpperCase().includes(query)) {
      results.push({
        symbol: sym,
        full_name: `${info.exchange || 'NYSE'}:${sym}`,
        description: info.name || sym,
        exchange: info.exchange || 'NYSE',
        type: 'stock',
      });
    }
  });

  // Also search POPULAR_STOCK_SYMBOLS that may not be in fallback
  POPULAR_STOCK_SYMBOLS.forEach(sym => {
    if (sym.includes(query) && !results.find(r => r.symbol === sym)) {
      results.push({
        symbol: sym,
        full_name: `NYSE:${sym}`,
        description: sym,
        exchange: 'NYSE',
        type: 'stock',
      });
    }
  });

  res.json(results.slice(0, limit));
});

// ── Outlier detection for chart bars (catches Codex DEX data spikes) ──
// If a bar's high exceeds 3x the median close of surrounding bars, clamp it.
// If a bar's low is below 0.2x the median, clamp it.
function filterOutlierBars(bars) {
  if (bars.length < 5) return bars;
  const WINDOW = 5; // look at 5 bars on each side
  const HIGH_THRESHOLD = 3; // bar high > 3x median = spike
  const LOW_THRESHOLD = 0.2; // bar low < 0.2x median = dip

  return bars.map((bar, i) => {
    // Get surrounding bars (excluding current)
    const start = Math.max(0, i - WINDOW);
    const end = Math.min(bars.length, i + WINDOW + 1);
    const neighbors = [];
    for (let j = start; j < end; j++) {
      if (j !== i && bars[j].c > 0) neighbors.push(bars[j].c);
    }
    if (neighbors.length < 2) return bar;

    neighbors.sort((a, b) => a - b);
    const median = neighbors[Math.floor(neighbors.length / 2)];
    if (median <= 0) return bar;

    let { t, o, h, l, c, v } = bar;
    const isSpike = h > median * HIGH_THRESHOLD || c > median * HIGH_THRESHOLD || o > median * HIGH_THRESHOLD;
    const isDip = l > 0 && l < median * LOW_THRESHOLD;

    if (isSpike) {
      // Clamp to 2x median - preserves general shape without the spike
      const clampHigh = median * 2;
      h = Math.min(h, clampHigh);
      o = Math.min(o, clampHigh);
      c = Math.min(c, clampHigh);
      l = Math.min(l, clampHigh);
      console.warn(`[UDF Outlier] Bar at ${new Date(t * 1000).toISOString()} clamped HIGH: h=${bar.h.toFixed(2)} -> ${h.toFixed(2)} (median=${median.toFixed(2)})`);
    }
    if (isDip) {
      const clampLow = median * 0.5;
      l = Math.max(l, clampLow);
      o = Math.max(o, clampLow);
      c = Math.max(c, clampLow);
      h = Math.max(h, clampLow);
      console.warn(`[UDF Outlier] Bar at ${new Date(t * 1000).toISOString()} clamped LOW: l=${bar.l.toFixed(2)} -> ${l.toFixed(2)} (median=${median.toFixed(2)})`);
    }

    return { t, o, h, l, c, v };
  });
}

// ── UDF history cache (avoids redundant Codex/Binance calls during TV chart loading) ──
const udfHistoryCache = new Map();
const UDF_CACHE_MAX = 500;
function getUdfCache(key) {
  const entry = udfHistoryCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.ts;
  // Recent data (last 5 min) → 15s TTL; older data → 120s TTL
  const ttl = entry.recent ? 15000 : 120000;
  if (age > ttl) { udfHistoryCache.delete(key); return null; }
  return entry.data;
}
function setUdfCache(key, data, isRecent) {
  if (udfHistoryCache.size > UDF_CACHE_MAX) {
    const firstKey = udfHistoryCache.keys().next().value;
    udfHistoryCache.delete(firstKey);
  }
  udfHistoryCache.set(key, { data, ts: Date.now(), recent: isRecent });
}

router.get('/tradingview/udf/history', async (req, res) => {
  const rawSymbol = (req.query.symbol || '');
  // Preserve case for contract addresses (0x...), uppercase only for ticker symbols
  const isAddress = rawSymbol.startsWith('0x') || rawSymbol.includes(':');
  const symbol = isAddress ? rawSymbol : rawSymbol.toUpperCase();
  const from = parseInt(req.query.from) || 0;
  const to = parseInt(req.query.to) || Math.floor(Date.now() / 1000);
  const resolution = req.query.resolution || 'D';

  if (!symbol) return res.json({ s: 'error', errmsg: 'Missing symbol' });

  console.log(`[UDF History] ${symbol} res=${resolution} from=${new Date(from * 1000).toISOString()} to=${new Date(to * 1000).toISOString()}`);

  // Normalize cache key to 5-minute windows to improve cache hit rate
  // (TradingView sends slightly different from/to on each chunk)
  const normFrom = Math.floor(from / 300) * 300;
  const normTo = Math.ceil(to / 300) * 300;
  const cacheKey = `${symbol}:${resolution}:${normFrom}:${normTo}`;
  const cached = getUdfCache(cacheKey);
  if (cached) return res.json(cached);

  const isStock = POPULAR_STOCK_SYMBOLS.includes(symbol) || !!FALLBACK_STOCK_DATA[symbol];

  if (isStock) {
    if (!breakers.yahoo.isAvailable()) {
      return res.json({ s: 'no_data', nextTime: to + 60 });
    }

    try {
      const start = Date.now();
      const yahooIntervalMap = {
        '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '60m',
        'D': '1d', '1D': '1d', 'W': '1wk', '1W': '1wk',
      };
      const interval = yahooIntervalMap[resolution] || '1d';
      const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=${interval}&period1=${from}&period2=${to}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000),
      });

      if (!resp.ok) throw new Error(`Yahoo history ${resp.status}`);
      const data = await resp.json();
      breakers.yahoo.recordSuccess(Date.now() - start);

      const result = data?.chart?.result?.[0];
      if (result?.timestamp?.length > 0) {
        const q = result.indicators?.quote?.[0] || {};
        const resp = {
          s: 'ok',
          t: result.timestamp,
          o: (q.open || []).map(v => v != null ? Number(v) : 0),
          h: (q.high || []).map(v => v != null ? Number(v) : 0),
          l: (q.low || []).map(v => v != null ? Number(v) : 0),
          c: (q.close || []).map(v => v != null ? Number(v) : 0),
          v: (q.volume || []).map(v => v != null ? Number(v) : 0),
        };
        const isRecent = to > Math.floor(Date.now() / 1000) - 300;
        setUdfCache(cacheKey, resp, isRecent);
        return res.json(resp);
      }
    } catch (e) {
      breakers.yahoo.recordFailure(e);
    }

    const noDataResp = { s: 'no_data', nextTime: to + 60 };
    setUdfCache(cacheKey, noDataResp, false);
    return res.json(noDataResp);
  }

  // ── Crypto: Binance-first for major tokens, /api/bars fallback for others ──

  // Step 1: Try Binance klines directly for tokens with a Binance pair
  // WHY: /api/bars tries Codex DEX data first (Tier 0/1), which has anomalous
  // price spikes for major tokens. Binance klines are clean and fast.
  if (hasBinancePair(symbol)) {
    try {
      const binanceSym = getBinanceSymbol(symbol);
      const intervalMap = { '1S': '1s', '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '240': '4h', 'D': '1d', '1D': '1d', 'W': '1w', '1W': '1w' };
      const interval = intervalMap[resolution] || '1h';
      const fromMs = from * 1000;
      const endMs = to * 1000;

      // Calculate if window fits in 1000 bars
      const intervalMs = { '1s': 1e3, '1m': 6e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 };
      const barMs = intervalMs[interval] || 36e5;
      const requestedBars = Math.ceil((endMs - fromMs) / barMs);
      const url = requestedBars <= 1000
        ? `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&startTime=${fromMs}&endTime=${endMs}&limit=1000`
        : `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&endTime=${endMs}&limit=1000`;

      const binanceResp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (binanceResp.ok) {
        const klines = await binanceResp.json();
        if (klines.length > 0) {
          const resp = {
            s: 'ok',
            t: klines.map(k => Math.floor(k[0] / 1000)),
            o: klines.map(k => parseFloat(k[1])),
            h: klines.map(k => parseFloat(k[2])),
            l: klines.map(k => parseFloat(k[3])),
            c: klines.map(k => parseFloat(k[4])),
            v: klines.map(k => parseFloat(k[5])),
          };
          const isRecent = to > Math.floor(Date.now() / 1000) - 300;
          setUdfCache(cacheKey, resp, isRecent);
          console.log(`[UDF] ${symbol}: Binance direct - ${klines.length} bars`);
          return res.json(resp);
        }
      }
    } catch (e) {
      console.warn(`[UDF] Binance direct failed for ${symbol}:`, e.message);
    }
  }

  // Step 2: Fallback to /api/bars (Codex/onchain data) for non-major tokens
  // or if Binance failed. Apply outlier filtering to the returned bars.
  try {
    const resMap = { 'D': '1D', 'W': '1W' };
    const barsResolution = resMap[resolution] || resolution;
    // Parse networkId from "address:networkId" format, default to 1
    let barsSymbol = symbol;
    let networkId = 1;
    if (symbol.includes(':')) {
      const parts = symbol.split(':');
      barsSymbol = parts[0];
      networkId = parseInt(parts[1]) || 1;
    }
    const barsUrl = `http://localhost:${PORT}/api/bars?symbol=${encodeURIComponent(barsSymbol)}&from=${from}&to=${to}&resolution=${barsResolution}&networkId=${networkId}`;
    const barsResp = await fetch(barsUrl, { signal: AbortSignal.timeout(25000) });
    if (barsResp.ok) {
      const barsData = await barsResp.json();
      if (barsData.bars && barsData.bars.length > 0) {
        // Filter out bars with null/zero OHLC values (sparse DEX token data)
        let validBars = barsData.bars.filter(b => b.o != null && b.c != null && (b.o !== 0 || b.c !== 0));

        // Outlier detection: clamp bars where high/low deviates wildly from neighbors
        // This catches the Codex DEX data spikes (e.g. BTC 67K -> 160K)
        if (validBars.length > 5) {
          validBars = filterOutlierBars(validBars);
        }

        if (validBars.length > 0) {
          const resp = {
            s: 'ok',
            t: validBars.map(b => b.t),
            o: validBars.map(b => b.o),
            h: validBars.map(b => b.h),
            l: validBars.map(b => b.l),
            c: validBars.map(b => b.c),
            v: validBars.map(b => b.v || 0),
          };
          const isRecent = to > Math.floor(Date.now() / 1000) - 300;
          setUdfCache(cacheKey, resp, isRecent);
          return res.json(resp);
        }
      }
    }
  } catch (e) {
    console.warn(`[UDF] Crypto history failed for ${symbol}:`, e.message);
  }
  const noDataResp = { s: 'no_data' };
  setUdfCache(cacheKey, noDataResp, false);
  res.json(noDataResp);
});

/**
 * Get latest trades for a pair
 */
router.get('/trades/:pairAddress', async (req, res) => {
  try {
    const { pairAddress } = req.params;
    const { networkId = 1, limit = 50 } = req.query;
    
    const query = `
      query GetLatestTrades($pairAddress: String!, $networkId: Int!, $limit: Int!) {
        getLatestTrades(
          pairAddress: $pairAddress
          networkId: $networkId
          limit: $limit
        ) {
          timestamp
          type
          priceUSD
          amountToken
          amountUSD
          maker
          txHash
        }
      }
    `;
    
    const result = await executeCodexQuery(query, { 
      pairAddress: pairAddress.toLowerCase(), 
      networkId: parseInt(networkId),
      limit: parseInt(limit)
    });
    
    res.json({ trades: result?.getLatestTrades || [] });
    
  } catch (error) {
    console.error('Trades error:', error);
    res.status(500).json({ error: error.message, trades: [] });
  }
});

/**
 * Get trades for a token by token address (finds pairs first, then fetches trades)
 * Optimized: pairs + decimals fetched in parallel, 30s server-side cache
 */
const tradesCache = new Map();
const TRADES_CACHE_TTL = 60_000; // 60 seconds (doubled from 30s for better hit rate)
const tradesInflight = new Map(); // key -> Promise (dedup concurrent requests)

// Static token metadata caches - pairs + decimals are immutable on-chain facts
const pairsCache = new Map();       // key: `${address}:${networkId}` -> { data, ts }
const PAIRS_CACHE_TTL = 86_400_000; // 24 hours
const decimalsCache = new Map();    // key: `${address}:${networkId}` -> { data, ts }
const DECIMALS_CACHE_TTL = 86_400_000; // 24 hours

function evictOldest(map, maxSize) {
  if (map.size <= maxSize) return;
  let oldestKey = null, oldestTs = Infinity;
  for (const [k, v] of map) {
    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
  }
  if (oldestKey) map.delete(oldestKey);
}

router.get('/token/trades', async (req, res) => {
  try {
    const { address, networkId = 1, limit = 50 } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const netId = parseInt(networkId);
    const isSolana = netId === 1399811149;
    const queryAddress = isSolana ? address : address.toLowerCase();

    // Check trades cache first (60s TTL)
    const tradesCacheKey = `${queryAddress}:${netId}:${limit}`;
    const cachedTrades = tradesCache.get(tradesCacheKey);
    if (cachedTrades && (Date.now() - cachedTrades.ts) < TRADES_CACHE_TTL) {
      return res.json(cachedTrades.data);
    }

    // In-flight dedup: if same request is already running, await it
    if (tradesInflight.has(tradesCacheKey)) {
      try {
        const result = await tradesInflight.get(tradesCacheKey);
        return res.json(result);
      } catch (e) { /* fall through to make own request */ }
    }

    // Queries
    const pairsQuery = `
      query GetPairs($tokenAddress: String!, $networkId: Int!) {
        listPairsForToken(
          tokenAddress: $tokenAddress
          networkId: $networkId
          limit: 5
        ) {
          address
          token0
          token1
        }
      }
    `;

    const tokenInfoQuery = `
      query GetTokenInfo($address: String!, $networkId: Int!) {
        token(input: { address: $address, networkId: $networkId }) {
          decimals
        }
      }
    `;

    const eventsQuery = `
      query GetTokenEvents($address: String!, $networkId: Int!, $limit: Int!) {
        getTokenEvents(
          query: {
            address: $address
            networkId: $networkId
          }
          limit: $limit
        ) {
          items {
            timestamp
            eventType
            token0SwapValueUsd
            token1SwapValueUsd
            maker
            transactionHash
            data {
              ... on SwapEventData {
                amount0In
                amount0Out
                amount1In
                amount1Out
                priceUsd
                amount0
                amount1
              }
            }
          }
        }
      }
    `;

    // Check permanent caches for pairs + decimals (immutable on-chain data, 24h TTL)
    const staticKey = `${queryAddress}:${netId}`;
    const cachedPairsEntry = pairsCache.get(staticKey);
    const cachedDecimalsEntry = decimalsCache.get(staticKey);
    const pairsFresh = cachedPairsEntry && (Date.now() - cachedPairsEntry.ts) < PAIRS_CACHE_TTL;
    const decimalsFresh = cachedDecimalsEntry && (Date.now() - cachedDecimalsEntry.ts) < DECIMALS_CACHE_TTL;

    const [pairsResult, tokenInfoResult] = await Promise.all([
      pairsFresh
        ? Promise.resolve(cachedPairsEntry.data)
        : executeCodexQuery(pairsQuery, { tokenAddress: queryAddress, networkId: netId })
            .then(r => { pairsCache.set(staticKey, { data: r, ts: Date.now() }); evictOldest(pairsCache, 500); return r; }),
      decimalsFresh
        ? Promise.resolve(cachedDecimalsEntry.data)
        : executeCodexQuery(tokenInfoQuery, { address: queryAddress, networkId: netId })
            .then(r => { decimalsCache.set(staticKey, { data: r, ts: Date.now() }); evictOldest(decimalsCache, 500); return r; })
            .catch(e => { console.log('Could not fetch token decimals, using default:', e.message); return null; }),
    ]);

    const pairs = pairsResult?.listPairsForToken || [];

    if (pairs.length === 0) {
      console.log(`No pairs found for token ${queryAddress}`);
      return res.json({ trades: [], pairs: [] });
    }

    // Extract decimals from parallel result
    let tokenDecimals = isSolana ? 9 : 18;
    const d = tokenInfoResult?.token?.decimals;
    if (d != null && d >= 0 && d <= 24) tokenDecimals = d;

    // Take first pair
    const mainPair = pairs[0];

    // Don't lowercase Solana addresses - they are Base58 and case-sensitive
    const pairAddress = isSolana ? mainPair.address : mainPair.address.toLowerCase();

    // Fetch events (must be sequential - needs pair address from above)
    const eventsResult = await executeCodexQuery(eventsQuery, {
      address: pairAddress,
      networkId: netId,
      limit: parseInt(limit),
    });

    const events = eventsResult?.getTokenEvents?.items || [];

    // Find which token is our target token
    const isToken0 = isSolana
      ? mainPair.token0 === queryAddress
      : (mainPair.token0 || '').toLowerCase() === queryAddress.toLowerCase();

    // Use actual token decimals for amount conversion
    const TOKEN_DIVISOR = Math.pow(10, tokenDecimals);

    const trades = events
      .filter(event => event.eventType === 'Swap' || event.eventType === 'swap' || event.data)
      .map(event => {
        let isBuy;
        let tokenAmount;
        let otherTokenAmount;
        let totalUsd;
        const pricePerToken = parseFloat(event.data?.priceUsd || 0);
        
        if (isSolana) {
          // SOLANA: Uses amount0 and amount1 (positive = in, negative = out)
          const amount0 = parseFloat(event.data?.amount0 || 0);
          const amount1 = parseFloat(event.data?.amount1 || 0);
          
          // Determine direction and amounts based on which token is our target
          // Codex API convention for Solana: amounts are from POOL's perspective
          // Positive = tokens IN to pool (user SOLD to pool)
          // Negative = tokens OUT of pool (user BOUGHT from pool)
          if (isToken0) {
            // Our token is token0
            // If amount0 is negative, tokens went OUT of pool to user (BUY)
            // If amount0 is positive, tokens went IN to pool from user (SELL)
            isBuy = amount0 < 0;
            tokenAmount = Math.abs(amount0);
            otherTokenAmount = Math.abs(amount1);
          } else {
            // Our token is token1
            // If amount1 is negative, tokens went OUT of pool to user (BUY)
            // If amount1 is positive, tokens went IN to pool from user (SELL)
            isBuy = amount1 < 0;
            tokenAmount = Math.abs(amount1);
            otherTokenAmount = Math.abs(amount0);
          }
          
          // Calculate USD from token amount and price
          // tokenAmount is in raw units, pricePerToken is per human-readable token
          const humanReadableAmount = tokenAmount / TOKEN_DIVISOR;
          totalUsd = humanReadableAmount * pricePerToken;
          
          // Also convert tokenAmount to human-readable for display
          tokenAmount = humanReadableAmount;
        } else {
          // EVM CHAINS: Uses amount0In/Out with actual token decimals
          const amount0In = parseFloat(event.data?.amount0In || 0) / TOKEN_DIVISOR;
          const amount0Out = parseFloat(event.data?.amount0Out || 0) / TOKEN_DIVISOR;
          const amount1In = parseFloat(event.data?.amount1In || 0) / TOKEN_DIVISOR;
          const amount1Out = parseFloat(event.data?.amount1Out || 0) / TOKEN_DIVISOR;
          
          // Determine if buy or sell based on token flow
          // For our target token: if tokens going IN to the pair (user selling), it's a SELL
          // If tokens going OUT of the pair (user buying), it's a BUY
          if (isToken0) {
            isBuy = amount0Out > amount0In;
            tokenAmount = amount0In > 0 ? amount0In : amount0Out;
            otherTokenAmount = amount1In > 0 ? amount1In : amount1Out;
          } else {
            isBuy = amount1Out > amount1In;
            tokenAmount = amount1In > 0 ? amount1In : amount1Out;
            otherTokenAmount = amount0In > 0 ? amount0In : amount0Out;
          }
          
          // Calculate total USD value (amount * price)
          totalUsd = tokenAmount * pricePerToken;

          // Fallback: if amounts are zero, use Codex token0/1SwapValueUsd
          if (tokenAmount === 0 || totalUsd === 0) {
            const swapUsd = isToken0
              ? parseFloat(event.token0SwapValueUsd || 0)
              : parseFloat(event.token1SwapValueUsd || 0);
            if (swapUsd > 0) {
              totalUsd = swapUsd;
              tokenAmount = pricePerToken > 0 ? swapUsd / pricePerToken : 0;
            }
          }
        }

        return {
          timestamp: event.timestamp,
          type: isBuy ? 'Buy' : 'Sell',
          priceUSD: pricePerToken,
          amountToken: tokenAmount,
          amountUSD: totalUsd,
          amountOther: otherTokenAmount,
          maker: event.maker,
          txHash: event.transactionHash,
          isSolana: isSolana, // Pass this to frontend for proper formatting
        };
      });
    
    console.log(`Fetched ${trades.length} trades for ${queryAddress}`);
    const result = { trades, pairs: [mainPair] };
    tradesCache.set(tradesCacheKey, { data: result, ts: Date.now() });
    evictOldest(tradesCache, 200);
    res.json(result);

  } catch (error) {
    console.error('Token trades error:', error);
    res.status(500).json({ error: error.message, trades: [], pairs: [] });
  }
});

module.exports = router
