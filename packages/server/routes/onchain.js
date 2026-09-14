/**
 * Spectre Onchain API Proxy Routes
 *
 * Server-side proxy to our api-eth backend with:
 * - Response normalization (adapter pattern)
 * - Per-route cache TTLs
 * - Source attribution logging
 */

const express = require('express');
const fetch = require('node-fetch');
const { client } = require('../lib/onchain-client');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// Supported chains
// ═══════════════════════════════════════════════════════════════════════════════

const SUPPORTED_CHAINS = new Set([1, 56]); // ETH, BSC
const SOLANA_NETWORK_ID = 1399811149;

function isSupported(chainId) {
  return SUPPORTED_CHAINS.has(chainId) || chainId === SOLANA_NETWORK_ID;
}

function isSolana(chainId) {
  return chainId === SOLANA_NETWORK_ID;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Address validation — defense-in-depth before forwarding to upstream onchain API.
// Returns null when the format looks valid for the given chain, otherwise an
// error string. The upstream service should validate too, but rejecting
// malformed input here saves a round trip and prevents log pollution.
// ═══════════════════════════════════════════════════════════════════════════════

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, 32-44 chars

function validateAddress(address, chainId) {
  if (typeof address !== 'string' || address.length === 0) return 'Address is required';
  if (address.length > 64) return 'Address too long';
  if (isSolana(chainId)) {
    if (!SOLANA_ADDRESS_RE.test(address)) return 'Invalid Solana address format';
  } else {
    if (!EVM_ADDRESS_RE.test(address)) return 'Invalid EVM address format';
  }
  return null;
}

// Apply validation to every route that has an :address param. Runs before
// the route handler. Rejects with 400 on malformed input so we never forward
// garbage to the upstream on-chain service.
router.param('address', (req, res, next, address) => {
  const chainId = parseInt(req.query.chainId) || parseInt(req.query.networkId) || 1;
  const err = validateAddress(address, chainId);
  if (err) return res.status(400).json({ error: err, address });
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Response normalizers — transform our API responses to match frontend shapes
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeToken(raw, chainId) {
  if (!raw) return null;
  const price = parseFloat(raw.price_usd) || 0;
  const totalSupply = parseFloat(raw.total_supply) || 0;
  const decimals = parseInt(raw.decimals) || 18;
  const humanSupply = totalSupply > 0 ? totalSupply / Math.pow(10, decimals) : 0;
  const rawCirculating = parseFloat(raw.circulating_supply) || 0;
  const circulating = rawCirculating > 0 ? rawCirculating / Math.pow(10, decimals) : humanSupply;

  return {
    address: raw.address,
    name: raw.name || '',
    symbol: raw.symbol || '',
    decimals: parseInt(raw.decimals) || 18,
    networkId: chainId,
    network: chainId === 1 ? 'Ethereum' : chainId === 56 ? 'BNB Chain' : 'Unknown',
    price,
    priceUSD: price,
    volume24h: parseFloat(raw.volume_24h) || 0,
    volume1h: parseFloat(raw.volume_1h) || 0,
    volume5m: parseFloat(raw.volume_5m) || 0,
    volume6h: parseFloat(raw.volume_6h) || 0,
    volume12h: parseFloat(raw.volume_12h) || 0,
    change24: parseFloat(raw.price_change_24h) || 0,
    change24h: parseFloat(raw.price_change_24h) || 0,
    change1h: parseFloat(raw.price_change_1h) || 0,
    change5m: parseFloat(raw.price_change_5m) || 0,
    change6h: parseFloat(raw.price_change_6h) || 0,
    change12h: parseFloat(raw.price_change_12h) || 0,
    marketCap: parseFloat(raw.market_cap_usd) || (price * circulating) || 0,
    fdv: price * humanSupply || 0,
    liquidity: parseFloat(raw.liquidity_usd) || 0,
    holders: parseInt(raw.total_holder_count || raw.holder_count) || 0,
    totalSupply: humanSupply,
    circulatingSupply: circulating,
    logo: raw.logo_url || raw.info?.imageThumbUrl || '',
    createdAt: raw.created_at_time ? Math.floor(new Date(raw.created_at_time).getTime() / 1000) : null,
    deployerAddress: raw.deployer_address || null,
    launchSource: raw.launch_source || null,
    primaryPool: raw.primary_pool_address || null,
    lastTradeTime: raw.last_swap_time || null,
    txn24h: parseInt(raw.txn_count_24h || raw.txn_24h) || 0,
    buys24h: parseInt(raw.buys_24h) || 0,
    sells24h: parseInt(raw.sells_24h) || 0,
    // Extra fields our API provides
    burnedSupply: parseFloat(raw.burned_supply) > 0 ? parseFloat(raw.burned_supply) / Math.pow(10, decimals) : 0,
    isVerified: raw.is_verified || false,
    bondingCurveAddress: raw.bonding_curve_address || null,
    graduationPoolAddress: raw.graduation_pool_address || null,
    graduatedAt: raw.graduated_at || null,
    _source: 'spectre-api',
  };
}

function normalizePool(raw, chainId) {
  if (!raw) return null;
  return {
    address: raw.address,
    chainId,
    dexId: raw.dex_id,
    dexName: raw.dex_name || raw.dex_slug || '',
    token0: raw.token0_address,
    token1: raw.token1_address,
    feeTier: raw.fee_tier,
    createdAtBlock: raw.created_at_block,
    createdAtTime: raw.created_at_time,
    reserve0: raw.reserve0,
    reserve1: raw.reserve1,
    liquidity: parseFloat(raw.liquidity_usd) || 0,
    _source: 'spectre-api',
  };
}

function normalizeBar(raw) {
  return {
    t: raw.bucket ? Math.floor(new Date(raw.bucket).getTime() / 1000) : raw.t,
    o: parseFloat(raw.open) || 0,
    h: parseFloat(raw.high) || 0,
    l: parseFloat(raw.low) || 0,
    c: parseFloat(raw.close) || 0,
    v: parseFloat(raw.volume_usd) || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Quality filter for trending tokens — runs purely on normalized api-eth shape.
// No external calls, no curated allowlist, no upstream dependency.
// Strategy: overfetch from upstream, drop scams/wash-traded micro-caps,
// fall back to raw top-N if filter empties the list.
// ═══════════════════════════════════════════════════════════════════════════════

const TRENDING_MIN_LIQ = { 1: 250_000, 56: 100_000 };
const TRENDING_MIN_HOLDERS = { 1: 500, 56: 200 };
const TRENDING_MIN_MCAP = { 1: 1_000_000, 56: 250_000 };

function isQualityToken(t, chainId) {
  const sym = String(t.symbol || '').toUpperCase();
  if (!sym || sym.length > 10 || /[^A-Z0-9]/.test(sym)) return false;
  const name = String(t.name || '').toLowerCase();
  if (name.length > 60 || name.includes('_') || name.includes('  ')) return false;

  const liq = Number(t.liquidity) || 0;
  const holders = Number(t.holders) || 0;
  const mcap = Number(t.marketCap) || 0;
  const vol = Number(t.volume24h) || 0;

  if (liq < (TRENDING_MIN_LIQ[chainId] || 50_000)) return false;
  if (holders < (TRENDING_MIN_HOLDERS[chainId] || 100)) return false;
  if (mcap < (TRENDING_MIN_MCAP[chainId] || 500_000)) return false;

  // Wash-trade detector: sane vol/mcap ratio
  if (mcap > 0 && vol / mcap > 50) return false;

  // Honeypot/overflow detector: insane recent moves
  const moves = [t.change5m, t.change1h, t.change24].map(c => Math.abs(Number(c) || 0));
  if (moves.some(m => m > 500)) return false;

  return true;
}

/**
 * Map api-eth labels to frontend display labels.
 * Combines factual labels (dev, sniper, top_N) with behavioral labels (NEW, DCA, TP, REKT)
 * computed from maker_pool_stats.
 */
function computeTradeLabel(raw) {
  const labels = raw.labels || [];
  const isBuy = raw.is_buy;
  const totalBuys = parseInt(raw.total_buys) || 0;
  const totalSells = parseInt(raw.total_sells) || 0;
  const pnlUsd = parseFloat(raw.pnl_usd) || 0;
  const totalBuyUsd = parseFloat(raw.total_buy_usd) || 0;
  const totalSellUsd = parseFloat(raw.total_sell_usd) || 0;

  // Priority 1: Factual labels from api-eth (dev, sniper, bundled, top holder)
  for (const label of labels) {
    if (label === 'dev_buy') return { label: 'DB', name: 'Dev Buy', color: '#BE123C' };
    if (label === 'dev_sell') return { label: 'DS', name: 'Dev Sell', color: '#BE123C' };
    if (label === 'dev_transfer_buy') return { label: 'DTB', name: 'Dev Transfer Buy', color: '#9F1239' };
    if (label === 'dev_transfer_sell') return { label: 'DTS', name: 'Dev Transfer Sell', color: '#9F1239' };
    if (label === 'sniper_buy') return { label: 'SB', name: 'Sniper Buy', color: '#F43F5E' };
    if (label === 'sniper_sell') return { label: 'SS', name: 'Sniper Sell', color: '#F43F5E' };
    if (label === 'bundled_buy') return { label: 'BB', name: 'Bundle Buy', color: '#EC4899' };
    if (label === 'bundled_sell') return { label: 'BS', name: 'Bundle Sell', color: '#EC4899' };
    if (label.startsWith('top_')) {
      const m = label.match(/top_(\d+)_(buy|sell)/);
      if (m) {
        const rank = m[1];
        const side = m[2] === 'buy' ? 'B' : 'S';
        return {
          label: `T${rank}${side}`,
          name: `Top ${rank} Holder ${m[2] === 'buy' ? 'Buy' : 'Sell'}`,
          color: m[2] === 'buy' ? '#22C55E' : '#FB923C',
        };
      }
    }
  }

  // Priority 2: Behavioral labels from maker stats
  if (isBuy) {
    if (totalBuys <= 1) return { label: 'NEW', name: 'New Holder', color: '#10B981' };
    return { label: 'DCA', name: 'Dollar-Cost Average', color: '#06B6D4' };
  } else {
    // Sell labels
    if (totalSellUsd > 0 && totalBuyUsd > 0) {
      const lossRatio = pnlUsd / totalBuyUsd;
      if (lossRatio < -0.7) return { label: 'REKT', name: 'Heavy Loss Exit', color: '#991B1B' };
      if (pnlUsd < 0) return { label: 'SAL', name: 'Sell at Loss', color: '#EF4444' };
      if (pnlUsd > 0) return { label: 'TP', name: 'Take Profit', color: '#10B981' };
    }
    return { label: 'SELL', name: 'Sell', color: '#F97316' };
  }
}

function normalizeTrade(raw) {
  const priceUSD = parseFloat(raw.price_usd) || 0;
  const amountUSD = parseFloat(raw.swap_usd) || 0;
  // Derive human-readable token amount from USD values (raw amounts have 18+ decimals)
  const amountToken = priceUSD > 0 ? amountUSD / priceUSD : 0;
  const tradeLabel = computeTradeLabel(raw);

  return {
    timestamp: raw.block_timestamp ? Math.floor(new Date(raw.block_timestamp).getTime() / 1000) : 0,
    type: raw.is_buy ? 'Buy' : 'Sell',
    priceUSD,
    amountToken,
    amountUSD,
    maker: raw.trader_address || '',
    txHash: raw.tx_hash || '',
    poolAddress: raw.pool_address || '',
    // Trade label from api-eth (factual) + computed (behavioral)
    makerLabel: tradeLabel,
    // Maker stats from maker_pool_stats (all-time for this pool)
    makerTotalBuys: parseInt(raw.total_buys) || 0,
    makerTotalSells: parseInt(raw.total_sells) || 0,
    makerPnlUsd: parseFloat(raw.pnl_usd) || 0,
    makerTotalBuyUsd: parseFloat(raw.total_buy_usd) || 0,
    makerTotalSellUsd: parseFloat(raw.total_sell_usd) || 0,
    _source: 'spectre-api',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware — extract chainId
// ═══════════════════════════════════════════════════════════════════════════════

function getChainId(req) {
  const raw = req.query.chainId || req.query.chain_id || req.query.networkId || req.headers['x-chain-id'];
  if (!raw) return 1; // default ETH
  const str = String(raw).toLowerCase();
  if (str === 'eth' || str === 'ethereum') return 1;
  if (str === 'bsc' || str === 'bnb') return 56;
  if (str === 'solana' || str === 'sol') return SOLANA_NETWORK_ID;
  return parseInt(raw) || 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════════

// --- Token details ---
router.get('/token/:address', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get(`/v2/token/${address}`, { chainId }, 15_000);
    if (result.data) {
      const normalized = normalizeToken(result.data, chainId);

      // Enrich with pool liquidity if token doesn't have liquidity_usd
      if (!normalized.liquidity && result.data.primary_pool_address) {
        try {
          const poolResult = await client.get(`/v2/pool/${result.data.primary_pool_address}`, { chainId }, 10_000);
          if (poolResult.data) {
            normalized.liquidity = parseFloat(poolResult.data.liquidity_usd) || 0;
            normalized.pooledToken = poolResult.data.reserve0;
            normalized.pooledBase = poolResult.data.reserve1;
            normalized.dexName = poolResult.data.dex_name || poolResult.data.dex_slug || '';
            normalized.quoteTokenSymbol = poolResult.data.quote_token_symbol || '';
          }
        } catch (_) { /* non-critical */ }
      }

      // Enrich holder count: if total_holder_count is 0 (snapshots lagging), get from holders endpoint
      if (!normalized.holders) {
        try {
          const holdersResult = await client.get(`/v2/token/${address}/top-holders`, { chainId, limit: 1 }, 60_000);
          if (holdersResult._raw?.total_count) {
            normalized.holders = parseInt(holdersResult._raw.total_count) || 0;
          } else if (Array.isArray(holdersResult.data) && holdersResult.data.length > 0) {
            // At minimum we know there are holders; use the array length as a lower bound
            normalized.holders = holdersResult.data.length;
          }
        } catch (_) { /* non-critical */ }
      }

      return res.json({ success: true, data: normalized, _source: 'spectre-api' });
    }
    console.log(`[onchain] GET /token/${address} → MISSED reason:${result.error || 'no-data'}`);
  } else if (isSolana(chainId)) {
    const result = await client.get(`/v2/solana/token/${address}`, {}, 15_000);
    if (result.data) {
      return res.json({ success: true, data: result.data, _source: 'spectre-api' });
    }
  }

  return res.json({ success: true, data: null, _source: 'none', error: 'Token not found on supported chains' });
});

// --- Token pools ---
router.get('/token/:address/pools', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get(`/v2/token/${address}/pools`, { chainId }, 30_000);
    if (result.data) {
      const pools = Array.isArray(result.data) ? result.data.map(p => normalizePool(p, chainId)) : [];
      return res.json({ success: true, data: pools, _source: 'spectre-api' });
    }
  } else if (isSolana(chainId)) {
    const result = await client.get(`/v2/solana/token/${address}/markets`, {}, 30_000);
    if (result.data) {
      return res.json({ success: true, data: result.data, _source: 'spectre-api' });
    }
  }

  return res.json({ success: true, data: [], _source: 'none' });
});

// --- Token swaps/trades ---
router.get('/token/:address/swaps', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();
  const { limit, cursor, maker } = req.query;
  // Default to last 24h if from/to not provided (api-eth requires ISO dates)
  const to = req.query.to || new Date().toISOString();
  const from = req.query.from || new Date(Date.now() - 86400000).toISOString();

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get(`/v2/token/${address}/swaps`, {
      chainId, from, to, limit: limit || 50, cursor, maker, extended: true,
    }, 5_000);
    if (result.data) {
      const raw = Array.isArray(result.data) ? result.data : (result.data.data || []);
      const trades = raw.map(normalizeTrade);
      return res.json({
        success: true,
        data: trades,
        cursors: result.data.cursors || {},
        base_token: result.data.base_token || null,
        quote_token: result.data.quote_token || null,
        _source: 'spectre-api',
      });
    }
  } else if (isSolana(chainId)) {
    const result = await client.get(`/v2/solana/token/${address}/trades`, {
      from, to, limit: limit || 50,
    }, 5_000);
    if (result.data) {
      return res.json({ success: true, data: result.data, _source: 'spectre-api' });
    }
  }

  return res.json({ success: true, data: [], _source: 'none' });
});

// --- Top holders (spectre-only, no fallback) ---
router.get('/token/:address/holders', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();
  const limit = parseInt(req.query.limit) || 20;

  if (!isSupported(chainId) || isSolana(chainId)) {
    return res.json({ success: true, data: [], _source: 'none', note: 'Holder data not available for this chain' });
  }

  const result = await client.get(`/v2/token/${address}/top-holders`, { chainId, limit }, 60_000);
  if (result.data) {
    return res.json({ success: true, data: result.data, _source: 'spectre-api' });
  }

  // Upstream refused on a chain we DO support. Report that honestly - this
  // branch used to reuse the "not available for this chain" note above, which
  // sent a debugging session chasing the chain gate for an hour.
  // On localhost the cause is always Cloudflare bot-blocking our server egress
  // to onchain.spectreai.io (403 `cf-mitigated: challenge`; the client treats
  // 4xx as "not a server failure" and swallows it without logging). The browser
  // hooks call upstream directly and are unaffected - see useTopHolders.js.
  return res.json({
    success: true,
    data: [],
    _source: 'none',
    note: 'Upstream holder data unavailable (server egress to onchain.spectreai.io is bot-blocked; the browser calls it directly)',
    _error: result.error || 'upstream_unavailable',
  });
});

// --- Holders chart (spectre-only, no fallback) ---
router.get('/token/:address/holders/chart', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();
  const { bucket, from, to, limit } = req.query;

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get(`/v2/token/${address}/holders/chart`, {
      chainId, bucket: bucket || '1h', from, to, limit: limit || 500,
    }, 60_000);
    if (result.data) {
      return res.json({ success: true, data: result.data, _source: 'spectre-api' });
    }
  }

  return res.json({ success: true, data: [], _source: 'none' });
});

// --- Pool detail ---
router.get('/pool/:address', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get(`/v2/pool/${address}`, { chainId }, 15_000);
    if (result.data) {
      return res.json({ success: true, data: normalizePool(result.data, chainId), _source: 'spectre-api' });
    }
  } else if (isSolana(chainId)) {
    const result = await client.get(`/v2/solana/market/${address}`, {}, 15_000);
    if (result.data) {
      return res.json({ success: true, data: result.data, _source: 'spectre-api' });
    }
  }

  return res.status(404).json({ success: false, error: 'Pool not found', _source: 'none' });
});

// --- OHLCV candles ---
router.get('/pool/:address/ohlcv', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();
  const { interval, from, to, limit, token } = req.query;

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get(`/v2/pool/${address}/ohlc`, {
      chainId, interval: interval || '1h', from, to, limit: limit || 500, token,
    }, 30_000);
    if (result.data) {
      // Gap-fill is now done in api-eth — just normalize bar fields
      const bars = Array.isArray(result.data) ? result.data.map(normalizeBar) : [];
      return res.json({ success: true, data: bars, _source: 'spectre-api' });
    }
  } else if (isSolana(chainId)) {
    const result = await client.get(`/v2/solana/market/${address}/ohlcv`, {
      interval: interval || '1h', from, to, limit: limit || 500,
    }, 30_000);
    if (result.data) {
      const bars = Array.isArray(result.data) ? result.data.map(normalizeBar) : [];
      return res.json({ success: true, data: bars, _source: 'spectre-api' });
    }
  }

  return res.json({ success: true, data: [], _source: 'none' });
});

// --- First buyers (spectre-only) ---
router.get('/pool/:address/first-buyers', async (req, res) => {
  const chainId = getChainId(req);
  const address = req.params.address.toLowerCase();
  const limit = parseInt(req.query.limit) || 100;

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get(`/v2/pool/${address}/first-buyers`, { chainId, limit }, 300_000);
    if (result.data) {
      // Use _raw to preserve top-level fields like summary, pool, base_token
      // (client.get extracts json.data which is just the buyers array)
      const raw = result._raw || {};
      return res.json({
        success: true,
        data: Array.isArray(result.data) ? result.data : raw.data || [],
        summary: raw.summary || {},
        pool: raw.pool || address,
        _source: 'spectre-api',
      });
    }
  }

  return res.json({ success: true, data: [], summary: {}, _source: 'none' });
});

// --- Token search ---
router.get('/tokens/search', async (req, res) => {
  const chainId = getChainId(req);
  const q = (req.query.q || '').trim();
  const limit = parseInt(req.query.limit) || 20;

  if (!q) return res.status(400).json({ success: false, error: 'q parameter required' });

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get('/v2/tokens/search', { chainId, q, limit }, 10_000);
    if (result.data) {
      const tokens = Array.isArray(result.data) ? result.data.map(t => normalizeToken(t, chainId)) : [];
      return res.json({ success: true, data: tokens, _source: 'spectre-api' });
    }
    console.log(`[onchain] GET /tokens/search?q=${q} → MISSED reason:${result.error || 'no-data'}`);
  }

  // No data available — return empty results
  return res.json({ success: true, data: [], _source: 'none' });
});

// --- Sparkline cache (in-memory, 60s TTL, 500 max entries) ---
const _sparklineCache = new Map();
const SPARKLINE_TTL_MS = 60_000;
const SPARKLINE_MAX = 500;

function cacheSparklineGet(key) {
  const e = _sparklineCache.get(key);
  if (!e || Date.now() - e.ts > SPARKLINE_TTL_MS) return null;
  return e.data;
}
function cacheSparklineSet(key, data) {
  if (_sparklineCache.size >= SPARKLINE_MAX) {
    const firstKey = _sparklineCache.keys().next().value;
    _sparklineCache.delete(firstKey);
  }
  _sparklineCache.set(key, { data, ts: Date.now() });
}

async function fetchPoolSparkline(poolAddress, chainId) {
  if (!poolAddress) return null;
  const cacheKey = `${chainId}:${poolAddress}`;
  const cached = cacheSparklineGet(cacheKey);
  if (cached !== null) return cached; // includes [] (no-data marker)
  try {
    const path = isSolana(chainId)
      ? `/v2/solana/market/${poolAddress.toLowerCase()}/ohlcv`
      : `/v2/pool/${poolAddress.toLowerCase()}/ohlc`;
    const result = await client.get(path, { chainId, interval: '1h', limit: 168 }, 8_000);
    const bars = Array.isArray(result?.data) ? result.data : [];
    const closes = bars
      .map(b => parseFloat(b.close ?? b.c))
      .filter(v => Number.isFinite(v) && v > 0);
    cacheSparklineSet(cacheKey, closes);
    return closes;
  } catch {
    cacheSparklineSet(cacheKey, []); // remember failure so we don't retry every poll
    return [];
  }
}

// --- Trending tokens (with optional sparkline enrichment) ---
router.get('/tokens/trending', async (req, res) => {
  const chainId = getChainId(req);
  const sort = req.query.sort || 'volume_24h';
  const limit = parseInt(req.query.limit) || 50;
  const includeSparklines = req.query.sparklines === '1' || req.query.sparklines === 'true';
  // Opt-in quality filter — research app passes quality=1; trading stays raw
  const quality = req.query.quality === '1' || req.query.quality === 'true';
  // Overfetch only when we'll filter, so the trading-app raw firehose stays unchanged
  const upstreamLimit = quality ? Math.min(Math.max(limit * 4, 200), 500) : limit;

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get('/v2/tokens/trending', { chainId, sort, limit: upstreamLimit }, 15_000);
    if (result.data) {
      const raw = Array.isArray(result.data) ? result.data.map(t => normalizeToken(t, chainId)) : [];

      let tokens;
      if (quality) {
        const filtered = raw.filter(t => isQualityToken(t, chainId));
        // Safety net: if the filter wiped the list, return raw top-N rather than nothing
        tokens = (filtered.length >= limit ? filtered : raw).slice(0, limit);
      } else {
        tokens = raw.slice(0, limit);
      }

      if (includeSparklines && tokens.length > 0) {
        // Concurrency-bounded fan-out: 8 parallel pool OHLCV lookups, no client-side bursts
        const CONCURRENCY = 8;
        const queue = tokens.filter(t => t.primaryPool).slice(0);
        const sparklineByAddress = new Map();
        const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
          while (queue.length > 0) {
            const t = queue.shift();
            if (!t) return;
            const sp = await fetchPoolSparkline(t.primaryPool, chainId);
            if (Array.isArray(sp) && sp.length >= 2) {
              sparklineByAddress.set(t.address, sp);
            }
          }
        });
        await Promise.all(workers);
        for (const t of tokens) {
          const sp = sparklineByAddress.get(t.address);
          if (sp) t.sparkline_7d = sp;
        }
      }

      res.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
      return res.json({ success: true, data: tokens, _source: 'spectre-api' });
    }
  }

  // No data available — return empty results
  return res.json({ success: true, data: [], _source: 'none' });
});

// --- Batch prices ---
router.get('/tokens/prices', async (req, res) => {
  const chainId = getChainId(req);
  const raw = (req.query.addresses || '').trim();
  if (!raw) return res.status(400).json({ success: false, error: 'addresses parameter required' });

  const addresses = raw.split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
  if (addresses.length > 50) return res.status(400).json({ success: false, error: 'Max 50 addresses' });

  if (isSupported(chainId) && !isSolana(chainId)) {
    const result = await client.get('/v2/tokens/prices', { chainId, addresses: addresses.join(',') }, 10_000);
    if (result.data) {
      return res.json({ success: true, data: result.data, _source: 'spectre-api' });
    }
  }

  return res.json({ success: true, data: [], _source: 'none' });
});

// --- Networks ---
router.get('/networks', async (_req, res) => {
  const result = await client.get('/v2/networks', {}, 60_000);
  if (result.data) {
    return res.json({ success: true, data: result.data, _source: 'spectre-api' });
  }

  // Static fallback
  return res.json({
    success: true,
    data: [
      { chain_id: 1, name: 'Ethereum', slug: 'eth' },
      { chain_id: 56, name: 'BNB Chain', slug: 'bsc' },
    ],
    _source: 'static-fallback',
  });
});

// --- Heatmap ---
router.get('/heatmap', async (req, res) => {
  const chainId = getChainId(req);
  const result = await client.get('/v2/heatmap', { chainId }, 60_000);
  if (result.data) {
    return res.json({ success: true, data: result.data, _source: 'spectre-api' });
  }
  return res.json({ success: true, data: [], _source: 'none' });
});

// --- Analytics proxy (generic) ---
router.post('/analytics/:action', async (req, res) => {
  const chainId = getChainId(req);
  const action = req.params.action;
  const body = req.body || {};

  // Map analytics action to api-eth endpoint
  const actionMap = {
    biggestbuy: '/api/biggestbuy',
    biggestsell: '/api/biggestsell',
    topmakersbypnl: '/api/topmakersbypnl',
    topmakersbyvolume: '/api/topmakersbyvolume',
    vwap: '/api/vwap',
    tradesizepercentiles: '/api/tradesizepercentiles',
    uniquemakersbybucket: '/api/uniquemakersbybucket',
    newmakerscount: '/api/newmakerscount',
  };

  const apiPath = actionMap[action];
  if (!apiPath) return res.status(400).json({ success: false, error: `Unknown action: ${action}` });

  // Normalize body: frontend sends 'pool', api-eth expects 'lp'
  const apiBody = { ...body };
  if (apiBody.pool && !apiBody.lp) {
    apiBody.lp = apiBody.pool;
    delete apiBody.pool;
  }
  // Default time range to last 7 days (api-eth capRange defaults to 2100 which breaks queries)
  if (!apiBody.from) apiBody.from = new Date(Date.now() - 7 * 86400000).toISOString();
  if (!apiBody.to) apiBody.to = new Date().toISOString();

  // Forward as POST body to api-eth
  try {
    const url = new URL(apiPath, client.baseUrl);
    const apiRes = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-chain-id': String(chainId),
      },
      body: JSON.stringify(apiBody),
      signal: AbortSignal.timeout(10000),
    });
    if (!apiRes.ok) throw new Error(`http-${apiRes.status}`);
    const data = await apiRes.json();
    return res.json({ ...data, _source: 'spectre-api' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, _source: 'error' });
  }
});

// --- Stats endpoint (internal) ---
router.get('/_stats', (_req, res) => {
  const stats = client.stats.getStats();
  stats.circuit_state = client.circuit.state;
  stats.healthy = client.healthy;
  stats.cache_size = client.cache.size;
  return res.json(stats);
});

module.exports = router;
