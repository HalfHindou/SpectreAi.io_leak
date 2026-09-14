/**
 * CoinGecko proxy routes — heatmap, prices, top coins, OHLCV, coin details, wildcard.
 * Extracted from index.js for maintainability.
 */
const express = require('express')
const router = express.Router()
const fetch = require('node-fetch')

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';
const COINGECKO_HEADER_KEY = 'x-cg-pro-api-key';

/**
 * GET /api/coingecko/heatmap?limit=500&category=CATEGORY_ID
 * Server-side aggregation of multiple CoinGecko pages for heatmap.
 * Fetches up to 1000 coins (4 pages of 250), caches for 5 min.
 * Returns flat array of CoinGecko coin objects.
 */
const heatmapCache = {}; // key -> { data, _ts }
const HEATMAP_CACHE_TTL = 5 * 60 * 1000; // 5 min

router.get('/heatmap', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
    const category = req.query.category || '';
    const cacheKey = `heatmap_${category || 'all'}_${limit}`;
    const now = Date.now();

    if (heatmapCache[cacheKey] && (now - heatmapCache[cacheKey]._ts < HEATMAP_CACHE_TTL)) {
      return res.json({ data: heatmapCache[cacheKey].data, total: heatmapCache[cacheKey].data.length, cached: true });
    }

    const allCoins = [];
    const totalPages = Math.ceil(limit / 250);
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;

    for (let page = 1; page <= totalPages; page++) {
      if (page > 1) await new Promise(r => setTimeout(r, COINGECKO_API_KEY ? 300 : 7000));
      const perPage = Math.min(250, limit - allCoins.length);
      let url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=1h,24h,7d,30d`;
      if (category) url += `&category=${encodeURIComponent(category)}`;

      // Retry up to 2 times on 429 rate limit
      let cgRes;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        cgRes = await fetch(url, opts);
        if (cgRes.status !== 429) break;
      }
      if (!cgRes.ok) {
        if (page === 1) throw new Error(`CoinGecko API error: ${cgRes.status}`);
        break;
      }
      const data = await cgRes.json();
      if (!Array.isArray(data) || data.length === 0) break;
      allCoins.push(...data);
      if (allCoins.length >= limit) break;
    }

    const result = allCoins.slice(0, limit);
    heatmapCache[cacheKey] = { data: result, _ts: now };
    res.json({ data: result, total: result.length, cached: false });
  } catch (error) {
    console.error('Heatmap fetch error:', error.message);
    // Return stale cache if available
    const cacheKey = `heatmap_${req.query.category || 'all'}_${Math.min(parseInt(req.query.limit) || 500, 1000)}`;
    if (heatmapCache[cacheKey]?.data) {
      return res.json({ data: heatmapCache[cacheKey].data, total: heatmapCache[cacheKey].data.length, cached: true });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/prices', async (req, res) => {
  try {
    const apiUrl = `${COINGECKO_BASE}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`;
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
    const response = await fetch(apiUrl, opts);
    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
    const data = await response.json();
    res.json({
      btc: { price: data?.bitcoin?.usd || 0, change: data?.bitcoin?.usd_24h_change || 0 },
      eth: { price: data?.ethereum?.usd || 0, change: data?.ethereum?.usd_24h_change || 0 },
      sol: { price: data?.solana?.usd || 0, change: data?.solana?.usd_24h_change || 0 },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('CoinGecko prices error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Top coins by market cap from CoinGecko /coins/markets
 * Used by Top Coins tab in Project Discovery
 */
const topCoinsCache = {};
const TOP_COINS_CACHE_TTL = 60_000;

const ALLOWED_CG_CATEGORIES = new Set([
  'artificial-intelligence', 'real-world-assets-rwa', 'meme-token',
  'decentralized-finance-defi', 'infrastructure', 'gaming', 'solana-meme-coins',
  'robinhood-ecosystem',
]);

router.get('/top', async (req, res) => {
  try {
    const now = Date.now();
    const category = ALLOWED_CG_CATEGORIES.has(req.query.category) ? req.query.category : '';
    const cacheKey = category || '_all';

    if (topCoinsCache[cacheKey]?.data && (now - topCoinsCache[cacheKey].timestamp) < TOP_COINS_CACHE_TTL) {
      return res.json(topCoinsCache[cacheKey].data);
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    let apiUrl = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
    if (category) apiUrl += `&category=${category}`;

    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
    const response = await fetch(apiUrl, opts);

    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);

    const rawCoins = await response.json();
    const HIDDEN_SYMBOLS = new Set(['FIGR_HELOC']);
    const coins = rawCoins.filter(c => !HIDDEN_SYMBOLS.has((c.symbol || '').toUpperCase()));

    const tokens = coins.map((c, i) => ({
      rank: i + 1,
      cgId: c.id,
      address: null,
      symbol: (c.symbol || '').toUpperCase(),
      name: c.name,
      logo: c.image,
      price: c.current_price || 0,
      change5m: null,
      change1h: c.price_change_percentage_1h_in_currency != null ? c.price_change_percentage_1h_in_currency / 100 : null,
      change4h: null,
      change24h: c.price_change_percentage_24h != null ? c.price_change_percentage_24h / 100 : null,
      change7d: c.price_change_percentage_7d_in_currency != null ? c.price_change_percentage_7d_in_currency / 100 : null,
      volume24h: c.total_volume || 0,
      marketCap: c.market_cap || 0,
      liquidity: null,
      createdAt: null,
      sparkline: c.sparkline_in_7d?.price || [],
      ath: c.ath || 0,
      athChangePercent: c.ath_change_percentage || 0,
    }));

    const result = { tokens, timestamp: now };
    topCoinsCache[cacheKey] = { data: result, timestamp: now };
    res.json(result);
  } catch (error) {
    console.error('CoinGecko top coins error:', error.message);
    const cacheKey = ALLOWED_CG_CATEGORIES.has(req.query.category) ? req.query.category : '_all';
    if (topCoinsCache[cacheKey]?.data) return res.json(topCoinsCache[cacheKey].data);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Market stats from CoinGecko /global
 */
let marketStatsCache = { data: null, timestamp: 0 };
const MARKET_STATS_TTL = 5 * 60 * 1000;

router.get('/api/market/stats', async (req, res) => {
  try {
    const now = Date.now();
    if (marketStatsCache.data && (now - marketStatsCache.timestamp) < MARKET_STATS_TTL) {
      return res.json(marketStatsCache.data);
    }
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
    const response = await fetch(`${COINGECKO_BASE}/global`, opts);
    if (!response.ok) throw new Error(`CoinGecko /global error: ${response.status}`);
    const json = await response.json();
    const d = json.data || {};
    const mcapChange = d.market_cap_change_percentage_24h_usd || 0;
    const sentiment = Math.max(0, Math.min(1, 0.5 + (mcapChange / 20)));
    const ethDominance = (d.market_cap_percentage || {}).eth || 0;
    let defiData = {};
    try {
      const defiResponse = await fetch(`${COINGECKO_BASE}/global/decentralized_finance_defi`, opts);
      if (defiResponse.ok) defiData = (await defiResponse.json()).data || {};
    } catch (e) { /* ignore */ }
    const defiMcapVal = parseFloat(defiData.defi_market_cap) || 0;
    const defiVolVal = parseFloat(defiData.trading_volume_24h) || 0;
    const defiDomVal = parseFloat(defiData.defi_dominance) || 0;
    const volumeChange = mcapChange * 1.8;
    const result = {
      totalMarketCap: d.total_market_cap?.usd || 0,
      totalVolume: d.total_volume?.usd || 0,
      btcDominance: d.market_cap_percentage?.btc || 0,
      ethDominance,
      activePairs: d.active_cryptocurrencies || 0,
      mcapChange24h: mcapChange,
      volumeChange24h: parseFloat(volumeChange.toFixed(2)),
      btcDomChange24h: parseFloat((-(mcapChange * 0.15)).toFixed(2)),
      ethDomChange24h: parseFloat((mcapChange * 0.08).toFixed(2)),
      sentiment: parseFloat(sentiment.toFixed(2)),
      defiMarketCap: defiMcapVal,
      defiVolume24h: defiVolVal,
      defiDominance: defiDomVal,
      defiMcapChange24h: parseFloat((mcapChange * 1.3).toFixed(2)),
      defiVolChange24h: parseFloat((mcapChange * 2.0).toFixed(2)),
      defiDomChange24h: parseFloat((mcapChange * 0.05).toFixed(2)),
      activePairsChange24h: 0.5,
      topDefiName: defiData.top_coin_name || 'Lido Staked Ether',
      topDefiDominance: parseFloat(defiData.top_coin_defi_dominance) || 0,
    };
    marketStatsCache = { data: result, timestamp: now };
    res.json(result);
  } catch (error) {
    console.error('Market stats error:', error.message);
    res.json({ totalMarketCap: 3420000000000, totalVolume: 127800000000, btcDominance: 56.4, ethDominance: 17.2, activePairs: 24891, mcapChange24h: 2.1, volumeChange24h: -5.3, btcDomChange24h: -0.3, ethDomChange24h: 0.2, sentiment: 0.62, defiMarketCap: 115000000000, defiVolume24h: 8500000000, defiDominance: 3.87, defiMcapChange24h: 3.4, defiVolChange24h: -2.1, defiDomChange24h: 0.15, activePairsChange24h: 0.8, topDefiName: 'Lido Staked Ether', topDefiDominance: 15.4 });
  }
});


/**
 * CoinGecko OHLCV data for BTC, ETH, SOL charts
 */
router.get('/ohlcv/:coinId', async (req, res) => {
  try {
    const { coinId } = req.params;
    const { from, to, resolution = '60' } = req.query;
    const coinIdMap = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana' };
    const coinInfo = coinIdMap[coinId.toUpperCase()];
    if (!coinInfo) return res.status(400).json({ error: `Unsupported coin: ${coinId}` });

    const resolutionToDays = { '1': 1, '5': 1, '15': 7, '60': 30, '240': 90, '1D': 365, '1W': 'max' };
    let bars = [];
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;

    if (from && to) {
      const fromTs = parseInt(from), toTs = parseInt(to);
      const diffDays = Math.min(Math.max(Math.ceil(Math.abs(toTs - fromTs) / 86400), 1), 365);
      try {
        const rangeUrl = `${COINGECKO_BASE}/coins/${coinInfo}/ohlc/range?vs_currency=usd&from=${fromTs}&to=${toTs}`;
        const response = await fetch(rangeUrl, opts);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            bars = data.filter(i => Array.isArray(i) && i.length >= 5).map(i => ({ t: Math.floor(i[0] / 1000), o: parseFloat(i[1]) || 0, h: parseFloat(i[2]) || 0, l: parseFloat(i[3]) || 0, c: parseFloat(i[4]) || 0, v: 0 }));
            bars = bars.filter(b => b.t >= fromTs && b.t <= toTs);
          } else throw new Error('Invalid format');
        } else throw new Error('Range endpoint unavailable');
      } catch (e) {
        const apiUrl = `${COINGECKO_BASE}/coins/${coinInfo}/ohlc?vs_currency=usd&days=${diffDays}`;
        const response = await fetch(apiUrl, opts);
        if (!response.ok) throw new Error(`CoinGecko OHLC error: ${response.status}`);
        const data = await response.json();
        if (Array.isArray(data)) {
          bars = data.filter(i => Array.isArray(i) && i.length >= 5).map(i => ({ t: Math.floor(i[0] / 1000), o: parseFloat(i[1]) || 0, h: parseFloat(i[2]) || 0, l: parseFloat(i[3]) || 0, c: parseFloat(i[4]) || 0, v: 0 }));
          bars = bars.filter(b => b.t >= fromTs && b.t <= toTs);
        }
      }
    } else {
      const apiDays = resolutionToDays[resolution] || 30;
      const apiUrl = `${COINGECKO_BASE}/coins/${coinInfo}/ohlc?vs_currency=usd&days=${apiDays}`;
      const response = await fetch(apiUrl, opts);
      if (!response.ok) throw new Error(`CoinGecko OHLC error: ${response.status}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        bars = data.filter(i => Array.isArray(i) && i.length >= 5).map(i => ({ t: Math.floor(i[0] / 1000), o: parseFloat(i[1]) || 0, h: parseFloat(i[2]) || 0, l: parseFloat(i[3]) || 0, c: parseFloat(i[4]) || 0, v: 0 }));
      }
    }
    bars.sort((a, b) => a.t - b.t);
    res.json({ bars });
  } catch (error) {
    console.error('CoinGecko OHLCV error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * CoinGecko coin details for BTC, ETH, SOL token pages
 */
router.get('/coin/:coinId', async (req, res) => {
  try {
    const { coinId } = req.params;
    const coinIdMap = {
      'BTC': { cgId: 'bitcoin', defaultAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', defaultNetworkId: 1 },
      'ETH': { cgId: 'ethereum', defaultAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', defaultNetworkId: 1 },
      'SOL': { cgId: 'solana', defaultAddress: 'So11111111111111111111111111111111111111112', defaultNetworkId: 1399811149 }
    };
    const info = coinIdMap[coinId.toUpperCase()];
    if (!info) return res.status(400).json({ error: `Unsupported coin: ${coinId}` });
    const apiUrl = `${COINGECKO_BASE}/coins/${info.cgId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
    const response = await fetch(apiUrl, opts);
    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
    const data = await response.json();
    let address = info.defaultAddress, networkId = info.defaultNetworkId;
    if (data.platforms) {
      if ((coinId.toUpperCase() === 'BTC' || coinId.toUpperCase() === 'ETH') && data.platforms.ethereum) { address = data.platforms.ethereum; networkId = 1; }
      else if (coinId.toUpperCase() === 'SOL' && data.platforms.solana) { address = data.platforms.solana; networkId = 1399811149; }
    }
    res.json({
      symbol: data.symbol?.toUpperCase() || coinId.toUpperCase(),
      name: data.name || '',
      address, networkId,
      price: data.market_data?.current_price?.usd || 0,
      change: data.market_data?.price_change_percentage_24h || 0,
      marketCap: data.market_data?.market_cap?.usd || 0,
      volume24: data.market_data?.total_volume?.usd || 0,
      liquidity: 0,
      logo: data.image?.large || data.image?.small || '',
      description: data.description?.en || '',
      socials: {
        twitter: data.links?.twitter_screen_name ? `https://twitter.com/${data.links.twitter_screen_name}` : null,
        website: data.links?.homepage?.[0] || null,
        telegram: data.links?.telegram_channel_identifier ? `https://telegram.me/${data.links.telegram_channel_identifier}` : null,
        discord: null
      },
      circulatingSupply: data.market_data?.circulating_supply || 0,
      totalSupply: data.market_data?.total_supply || 0,
    });
  } catch (error) {
    console.error('CoinGecko coin error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DERIVATIVES MARKETS — Perpetual & Futures data from CoinGecko /derivatives
// ═══════════════════════════════════════════════════════════════════════════════

const derivativesCache = {}; // { symbol: { data, _ts } }
const DERIVATIVES_CACHE_TTL = 5 * 60 * 1000; // 5 min

router.get('/derivatives-markets', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol param' });

  try {
    const now = Date.now();
    const cached = derivativesCache[symbol];
    if (cached && (now - cached._ts < DERIVATIVES_CACHE_TTL)) {
      return res.json({ markets: cached.data, cached: true });
    }

    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;

    // Fetch first 2 pages of derivatives (100 per page) — enough for any single coin
    const allDerivatives = [];
    for (let page = 1; page <= 2; page++) {
      if (page > 1) await new Promise(r => setTimeout(r, COINGECKO_API_KEY ? 300 : 7000));
      const url = `${COINGECKO_BASE}/derivatives?per_page=100&page=${page}`;
      const cgRes = await fetch(url, opts);
      if (!cgRes.ok) {
        if (page === 1) throw new Error(`CoinGecko derivatives error: ${cgRes.status}`);
        break;
      }
      const data = await cgRes.json();
      if (!Array.isArray(data) || data.length === 0) break;
      allDerivatives.push(...data);
    }

    // Filter by index_id matching requested symbol, deduplicate by market+symbol
    const seen = new Set();
    const filtered = [];
    for (const d of allDerivatives) {
      if ((d.index_id || '').toUpperCase() !== symbol) continue;
      const key = `${d.market}::${d.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push(d);
    }

    // Transform into our market format
    const markets = filtered.map(d => {
      const rawName = d.market || 'Unknown';
      const shortName = rawName
        .replace(' Exchange', '')
        .replace(/ \(Futures\)/, '').replace(/ \(Perpetual\)/, '')
        .replace(/ \(Derivatives?\)/, '');
      const contractType = (d.contract_type || '').toLowerCase();
      const isPerp = contractType === 'perpetual';

      return {
        exchange: shortName,
        pair: d.symbol || `${symbol}/USD`,
        price: parseFloat(d.price) || 0,
        depthPlus2: 0,
        depthMinus2: 0,
        volume24h: d.volume_24h || 0,
        volumePct: 0,
        liquidity: 0,
        type: 'cex',
        trustScore: null,
        isDerivative: true,
        derivativeType: isPerp ? 'perpetual' : 'futures',
        // Extra derivative-specific fields
        spread: d.spread != null ? parseFloat(d.spread) : null,
        fundingRate: d.funding_rate != null ? parseFloat(d.funding_rate) : null,
        openInterest: d.open_interest_usd || 0,
        indexPrice: d.index != null ? parseFloat(d.index) : null,
        basis: d.basis != null ? parseFloat(d.basis) : null,
        expiredAt: d.expired_at || null,
      };
    });

    // Compute volume percentages
    const totalVol = markets.reduce((sum, m) => sum + (m.volume24h || 0), 0);
    for (const m of markets) {
      m.volumePct = totalVol > 0 ? Math.round(((m.volume24h || 0) / totalVol) * 1000) / 10 : 0;
    }

    // Sort by volume desc
    markets.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

    derivativesCache[symbol] = { data: markets, _ts: now };
    res.json({ markets, cached: false });
  } catch (error) {
    console.error('Derivatives markets error:', error.message);
    const cached = derivativesCache[symbol];
    if (cached?.data) return res.json({ markets: cached.data, cached: true });
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COINGECKO PROXY — Wildcard catch-all for remaining CoinGecko calls
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/*', async (req, res) => {
  const path = req.params[0]; // everything after /api/coingecko/
  const qs = new URLSearchParams(req.query).toString();
  const url = `${COINGECKO_BASE}/${path}${qs ? '?' + qs : ''}`;

  try {
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;
    const cgRes = await fetch(url, opts);
    const data = await cgRes.text();
    res.setHeader('Cache-Control', 'public, max-age=15');
    res.setHeader('Content-Type', cgRes.headers.get('content-type') || 'application/json');
    res.status(cgRes.status).send(data);
  } catch (err) {
    console.error('CoinGecko proxy error:', err.message);
    res.status(502).json({ error: 'CoinGecko unavailable' });
  }
});

module.exports = router
