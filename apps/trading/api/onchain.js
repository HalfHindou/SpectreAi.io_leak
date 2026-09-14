/**
 * Vercel Serverless Function — Spectre Onchain API Proxy (catch-all)
 *
 * Handles all /api/onchain/* requests by parsing path segments.
 * Mirrors packages/server/routes/onchain.js for production deployment.
 * Routes to api-eth backend with circuit breaker, caching, response normalization.
 */

const ONCHAIN_API_URL = process.env.SPECTRE_ONCHAIN_API_URL || 'https://onchain.spectreai.io/api';
const SPECTRE_API_ONLY = process.env.SPECTRE_API_ONLY === 'true';
const CODEX_API_KEY = process.env.CODEX_API_KEY;
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';

const SUPPORTED_CHAINS = new Set([1, 56]);
const SOLANA_NETWORK_ID = 1399811149;
function isSupported(chainId) { return SUPPORTED_CHAINS.has(chainId) || chainId === SOLANA_NETWORK_ID; }
function isSolana(chainId) { return chainId === SOLANA_NETWORK_ID; }

// ── Simple in-memory cache (per cold start) ─────────────────────────────────
const cache = new Map();
const CACHE_MAX = 2000;

function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiry) { cache.delete(key); return undefined; }
  return e.data;
}

function cacheSet(key, data, ttlMs) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

// ── Circuit breaker state ────────────────────────────────────────────────────
let cbFailures = [];
let cbState = 'closed';
let cbOpenedAt = 0;
const CB_THRESHOLD = 3, CB_WINDOW = 30000, CB_OPEN_MS = 60000;

function cbIsOpen() {
  if (cbState === 'open' && Date.now() - cbOpenedAt >= CB_OPEN_MS) { cbState = 'half-open'; return false; }
  return cbState === 'open';
}
function cbSuccess() { cbState = 'closed'; cbFailures = []; }
function cbFail() {
  const now = Date.now();
  cbFailures = cbFailures.filter(t => now - t < CB_WINDOW);
  cbFailures.push(now);
  if (cbFailures.length >= CB_THRESHOLD) { cbState = 'open'; cbOpenedAt = now; }
}

// ── Fetch from api-eth with retry ────────────────────────────────────────────
async function apiGet(path, params = {}, cacheTtlMs = 0) {
  const url = new URL(`${ONCHAIN_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const cacheKey = url.toString();
  if (cacheTtlMs > 0) {
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return { data: cached, source: 'spectre-api' };
  }
  if (cbIsOpen()) return { data: null, error: 'circuit-open' };

  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8000),
        headers: {
          Accept: 'application/json',
          'x-chain-id': params.chainId || '',
          // Cloudflare in front of onchain.spectreai.io bot-blocks empty
          // / SDK-style User-Agents. Pose as a real browser from the same
          // origin so the upstream returns data instead of an HTML
          // challenge page. Both UA + Origin together pass through.
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Origin: 'https://trade.spectreai.io',
          Referer: 'https://trade.spectreai.io/',
        },
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) { cbSuccess(); return { data: null, error: `http-${res.status}` }; }
        continue;
      }
      const json = await res.json();
      const data = json.data ?? json;
      cbSuccess();
      if (cacheTtlMs > 0) cacheSet(cacheKey, data, cacheTtlMs);
      return { data, source: 'spectre-api' };
    } catch { /* retry */ }
  }
  cbFail();
  return { data: null, error: 'fetch-failed' };
}

async function apiPost(path, body, chainId) {
  try {
    const res = await fetch(`${ONCHAIN_API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-chain-id': String(chainId) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

// ── Codex fallback ───────────────────────────────────────────────────────────
async function codexQuery(query, variables = {}) {
  if (!CODEX_API_KEY || SPECTRE_API_ONLY) return null;
  try {
    const res = await fetch('https://graph.codex.io/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: CODEX_API_KEY, Origin: CODEX_ORIGIN },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch { return null; }
}

// ── Normalizers ──────────────────────────────────────────────────────────────
function normalizeToken(raw, chainId) {
  if (!raw) return null;
  const price = parseFloat(raw.price_usd) || 0;
  const totalSupply = parseFloat(raw.total_supply) || 0;
  const decimals = parseInt(raw.decimals) || 18;
  const humanSupply = totalSupply > 0 ? totalSupply / Math.pow(10, decimals) : 0;
  const rawCirc = parseFloat(raw.circulating_supply) || 0;
  const circulating = rawCirc > 0 ? rawCirc / Math.pow(10, decimals) : humanSupply;

  return {
    address: raw.address, name: raw.name || '', symbol: raw.symbol || '',
    decimals, networkId: chainId,
    price, priceUSD: price,
    volume24h: parseFloat(raw.volume_24h) || 0,
    volume1h: parseFloat(raw.volume_1h) || 0,
    change24: parseFloat(raw.price_change_24h) || 0,
    change24h: parseFloat(raw.price_change_24h) || 0,
    change1h: parseFloat(raw.price_change_1h) || 0,
    change5m: parseFloat(raw.price_change_5m) || 0,
    marketCap: parseFloat(raw.market_cap_usd) || (price * circulating) || 0,
    fdv: price * humanSupply || 0,
    liquidity: parseFloat(raw.liquidity_usd) || 0,
    holders: parseInt(raw.total_holder_count || raw.holder_count) || 0,
    totalSupply: humanSupply, circulatingSupply: circulating,
    logo: raw.logo_url || '', createdAt: raw.created_at_time ? Math.floor(new Date(raw.created_at_time).getTime() / 1000) : null,
    deployerAddress: raw.deployer_address || null,
    launchSource: raw.launch_source || null,
    primaryPool: raw.primary_pool_address || null,
    txn24h: parseInt(raw.txn_count_24h) || 0,
    _source: 'spectre-api',
  };
}

function normalizePool(raw, chainId) {
  if (!raw) return null;
  return {
    address: raw.address, chainId, dexId: raw.dex_id, dexName: raw.dex_name || '',
    token0: raw.token0_address, token1: raw.token1_address, feeTier: raw.fee_tier,
    liquidity: parseFloat(raw.liquidity_usd) || 0, _source: 'spectre-api',
  };
}

function normalizeBar(raw) {
  return {
    t: raw.bucket ? Math.floor(new Date(raw.bucket).getTime() / 1000) : raw.t,
    o: parseFloat(raw.open) || 0, h: parseFloat(raw.high) || 0,
    l: parseFloat(raw.low) || 0, c: parseFloat(raw.close) || 0,
    v: parseFloat(raw.volume_usd) || 0,
  };
}

function computeTradeLabel(raw) {
  const labels = raw.labels || [];
  const isBuy = raw.is_buy;
  const totalBuys = parseInt(raw.total_buys) || 0;
  const pnlUsd = parseFloat(raw.pnl_usd) || 0;
  const totalBuyUsd = parseFloat(raw.total_buy_usd) || 0;
  const totalSellUsd = parseFloat(raw.total_sell_usd) || 0;

  for (const label of labels) {
    if (label === 'dev_buy') return { label: 'DB', name: 'Dev Buy', color: '#BE123C' };
    if (label === 'dev_sell') return { label: 'DS', name: 'Dev Sell', color: '#BE123C' };
    if (label === 'sniper_buy') return { label: 'SB', name: 'Sniper Buy', color: '#F43F5E' };
    if (label === 'sniper_sell') return { label: 'SS', name: 'Sniper Sell', color: '#F43F5E' };
    if (label === 'bundled_buy') return { label: 'BB', name: 'Bundle Buy', color: '#EC4899' };
    if (label === 'bundled_sell') return { label: 'BS', name: 'Bundle Sell', color: '#EC4899' };
    if (label.startsWith('top_')) {
      const m = label.match(/top_(\d+)_(buy|sell)/);
      if (m) return { label: `T${m[1]}${m[2] === 'buy' ? 'B' : 'S'}`, name: `Top ${m[1]} Holder ${m[2] === 'buy' ? 'Buy' : 'Sell'}`, color: m[2] === 'buy' ? '#22C55E' : '#FB923C' };
    }
  }
  if (isBuy) {
    if (totalBuys <= 1) return { label: 'NEW', name: 'New Holder', color: '#10B981' };
    return { label: 'DCA', name: 'Dollar-Cost Average', color: '#06B6D4' };
  }
  if (totalSellUsd > 0 && totalBuyUsd > 0) {
    const lossRatio = pnlUsd / totalBuyUsd;
    if (lossRatio < -0.7) return { label: 'REKT', name: 'Heavy Loss Exit', color: '#991B1B' };
    if (pnlUsd < 0) return { label: 'SAL', name: 'Sell at Loss', color: '#EF4444' };
    if (pnlUsd > 0) return { label: 'TP', name: 'Take Profit', color: '#10B981' };
  }
  return { label: 'SELL', name: 'Sell', color: '#F97316' };
}

function normalizeTrade(raw) {
  const priceUSD = parseFloat(raw.price_usd) || 0;
  const amountUSD = parseFloat(raw.swap_usd) || 0;
  return {
    timestamp: raw.block_timestamp ? Math.floor(new Date(raw.block_timestamp).getTime() / 1000) : 0,
    type: raw.is_buy ? 'Buy' : 'Sell', priceUSD, amountToken: priceUSD > 0 ? amountUSD / priceUSD : 0, amountUSD,
    maker: raw.trader_address || '', txHash: raw.tx_hash || '', poolAddress: raw.pool_address || '',
    makerLabel: computeTradeLabel(raw),
    makerTotalBuys: parseInt(raw.total_buys) || 0, makerTotalSells: parseInt(raw.total_sells) || 0,
    makerPnlUsd: parseFloat(raw.pnl_usd) || 0,
    makerTotalBuyUsd: parseFloat(raw.total_buy_usd) || 0, makerTotalSellUsd: parseFloat(raw.total_sell_usd) || 0,
    _source: 'spectre-api',
  };
}

// ── Extract chainId from query ───────────────────────────────────────────────
function getChainId(query) {
  const raw = query.chainId || query.chain_id || query.networkId;
  if (!raw) return 1;
  const s = String(raw).toLowerCase();
  if (s === 'eth') return 1;
  if (s === 'bsc' || s === 'bnb') return 56;
  if (s === 'solana' || s === 'sol') return SOLANA_NETWORK_ID;
  return parseInt(raw) || 1;
}

// ═════════════════════════════════════════════════════════════════════════════
// Route matching — parse path segments from Vercel catch-all
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Parse path segments into { route, address, sub }
 * Examples:
 *   ['token', '0x1234']                  → { route: 'token', address: '0x1234' }
 *   ['token', '0x1234', 'pools']         → { route: 'token-pools', address: '0x1234' }
 *   ['token', '0x1234', 'swaps']         → { route: 'token-swaps', address: '0x1234' }
 *   ['token', '0x1234', 'holders']       → { route: 'token-holders', address: '0x1234' }
 *   ['token', '0x1234', 'holders', 'chart'] → { route: 'holders-chart', address: '0x1234' }
 *   ['tokens', 'search']                 → { route: 'search' }
 *   ['tokens', 'trending']               → { route: 'trending' }
 *   ['tokens', 'prices']                 → { route: 'prices' }
 *   ['pool', '0x1234']                   → { route: 'pool', address: '0x1234' }
 *   ['pool', '0x1234', 'ohlcv']          → { route: 'pool-ohlcv', address: '0x1234' }
 *   ['pool', '0x1234', 'first-buyers']   → { route: 'first-buyers', address: '0x1234' }
 *   ['networks']                         → { route: 'networks' }
 *   ['heatmap']                          → { route: 'heatmap' }
 *   ['analytics', 'vwap']               → { route: 'analytics', sub: 'vwap' }
 *   ['_stats']                           → { route: '_stats' }
 */
function parseRoute(segments) {
  if (!segments || !segments.length) return { route: null };
  const [first, second, third, fourth] = segments;

  if (first === 'token' && second) {
    const address = second.toLowerCase();
    if (third === 'pools') return { route: 'token-pools', address };
    if (third === 'swaps') return { route: 'token-swaps', address };
    if (third === 'holders' && fourth === 'chart') return { route: 'holders-chart', address };
    if (third === 'holders') return { route: 'token-holders', address };
    return { route: 'token', address };
  }
  if (first === 'tokens') {
    if (second === 'search') return { route: 'search' };
    if (second === 'trending') return { route: 'trending' };
    if (second === 'prices') return { route: 'prices' };
  }
  if (first === 'pool' && second) {
    const address = second.toLowerCase();
    if (third === 'ohlcv') return { route: 'pool-ohlcv', address };
    if (third === 'first-buyers') return { route: 'first-buyers', address };
    return { route: 'pool', address };
  }
  if (first === 'networks') return { route: 'networks' };
  if (first === 'heatmap') return { route: 'heatmap' };
  if (first === 'analytics' && second) return { route: 'analytics', sub: second };
  if (first === '_stats') return { route: '_stats' };

  return { route: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// Handler
// ═════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  // Public on-chain data endpoint - no credentials. Echo ONLY a matched origin;
  // never reflect an unknown origin and never fall back to a default (that is a
  // credentialed-CORS reflection bug that bit us before - SEC M4). Aligned to
  // the production custom domains plus localhost dev ports.
  const ALLOWED_ORIGINS = [
    'https://trade.spectreai.io',
    'https://app.spectreai.io',
    'https://spectre-trading.vercel.app',
    'https://spectre-app-research.vercel.app',
    'http://localhost:5180',
    'http://localhost:5181',
    'http://localhost:5182',
    'http://localhost:5183',
  ];
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Flat file: path comes from vercel.json rewrite as _path query param
  // e.g. /api/onchain/token/0x.../swaps → _path=token/0x.../swaps
  const rawPath = req.query._path || req.query.path || '';
  const segments = Array.isArray(rawPath) ? rawPath : rawPath.split('/').filter(Boolean);
  const { route, address, sub } = parseRoute(segments);
  const chainId = getChainId(req.query);

  try {
    // ── Token details ────────────────────────────────────────────────────
    if (route === 'token') {
      if (!address) return res.status(400).json({ error: 'address required' });

      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/token/${address}`, { chainId }, 15000);
        if (result.data) {
          const normalized = normalizeToken(result.data, chainId);
          if (!normalized.liquidity && result.data.primary_pool_address) {
            const poolRes = await apiGet(`/v2/pool/${result.data.primary_pool_address}`, { chainId }, 10000);
            if (poolRes.data) {
              normalized.liquidity = parseFloat(poolRes.data.liquidity_usd) || 0;
              normalized.dexName = poolRes.data.dex_name || '';
              normalized.quoteTokenSymbol = poolRes.data.quote_token_symbol || '';
            }
          }
          return res.json({ success: true, data: normalized, _source: 'spectre-api' });
        }
      } else if (isSolana(chainId)) {
        const result = await apiGet(`/v2/solana/token/${address}`, {}, 15000);
        if (result.data) return res.json({ success: true, data: result.data, _source: 'spectre-api' });
      }
      // Codex fallback
      const data = await codexQuery(`query($a:String!,$n:Int!){token(input:{address:$a,networkId:$n}){address name symbol decimals networkId info{imageThumbUrl circulatingSupply totalSupply}}}`, { a: address, n: chainId });
      if (data?.token) {
        return res.json({ success: true, data: { address: data.token.address, name: data.token.name, symbol: data.token.symbol, decimals: data.token.decimals, networkId: data.token.networkId, price: 0, volume24h: 0, change24: 0, marketCap: 0, liquidity: 0, logo: data.token.info?.imageThumbUrl || '', _source: 'codex-fallback' } });
      }
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    // ── Token pools ──────────────────────────────────────────────────────
    if (route === 'token-pools') {
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/token/${address}/pools`, { chainId }, 30000);
        if (result.data) {
          const pools = Array.isArray(result.data) ? result.data.map(p => normalizePool(p, chainId)) : [];
          return res.json({ success: true, data: pools, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Token swaps ──────────────────────────────────────────────────────
    if (route === 'token-swaps') {
      const to = req.query.to || new Date().toISOString();
      const from = req.query.from || new Date(Date.now() - 86400000).toISOString();
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/token/${address}/swaps`, { chainId, from, to, limit: req.query.limit || 50, cursor: req.query.cursor, maker: req.query.maker, extended: true }, 5000);
        if (result.data) {
          const raw = Array.isArray(result.data) ? result.data : (result.data.data || []);
          return res.json({ success: true, data: raw.map(normalizeTrade), cursors: result.data.cursors || {}, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Top holders ──────────────────────────────────────────────────────
    if (route === 'token-holders') {
      const limit = parseInt(req.query.limit) || 20;
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/token/${address}/top-holders`, { chainId, limit }, 60000);
        if (result.data) return res.json({ success: true, data: result.data, _source: 'spectre-api' });
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Holders chart ────────────────────────────────────────────────────
    if (route === 'holders-chart') {
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/token/${address}/holders/chart`, { chainId, bucket: req.query.bucket || '1h', from: req.query.from, to: req.query.to, limit: req.query.limit || 500 }, 60000);
        if (result.data) return res.json({ success: true, data: result.data, _source: 'spectre-api' });
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Pool detail ──────────────────────────────────────────────────────
    if (route === 'pool') {
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/pool/${address}`, { chainId }, 15000);
        if (result.data) return res.json({ success: true, data: normalizePool(result.data, chainId), _source: 'spectre-api' });
      }
      return res.status(404).json({ success: false, error: 'Pool not found' });
    }

    // ── Pool OHLCV ───────────────────────────────────────────────────────
    if (route === 'pool-ohlcv') {
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/pool/${address}/ohlc`, { chainId, interval: req.query.interval || '1h', from: req.query.from, to: req.query.to, limit: req.query.limit || 500, token: req.query.token }, 30000);
        if (result.data) {
          const bars = Array.isArray(result.data) ? result.data.map(normalizeBar) : [];
          return res.json({ success: true, data: bars, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── First buyers ─────────────────────────────────────────────────────
    if (route === 'first-buyers') {
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet(`/v2/pool/${address}/first-buyers`, { chainId, limit: req.query.limit || 100 }, 300000);
        if (result.data) return res.json({ success: true, ...result.data, _source: 'spectre-api' });
      }
      return res.json({ success: true, data: [], summary: {}, _source: 'none' });
    }

    // ── Token search ─────────────────────────────────────────────────────
    if (route === 'search') {
      const q = (req.query.q || '').trim();
      const limit = parseInt(req.query.limit) || 20;
      if (!q) return res.status(400).json({ error: 'q required' });

      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet('/v2/tokens/search', { chainId, q, limit }, 10000);
        if (result.data) {
          const tokens = Array.isArray(result.data) ? result.data.map(t => normalizeToken(t, chainId)) : [];
          return res.json({ success: true, data: tokens, _source: 'spectre-api' });
        }
      }
      // Codex fallback
      const data = await codexQuery(`query($p:String!,$n:[Int!]){filterTokens(filters:{network:$n},phrase:$p,limit:${limit},rankings:{attribute:volume24,direction:DESC}){results{token{address name symbol networkId info{imageThumbUrl}}volume24 liquidity priceUSD change24}}}`, { p: q, n: [chainId] });
      // Codex change24 is a RATIO fraction; spectre-api serves percent - convert for shape parity
      const results = (data?.filterTokens?.results || []).map(r => ({ address: r.token?.address, name: r.token?.name, symbol: r.token?.symbol, networkId: r.token?.networkId || chainId, price: parseFloat(r.priceUSD) || 0, volume24h: parseFloat(r.volume24) || 0, change24: (parseFloat(r.change24) || 0) * 100, liquidity: parseFloat(r.liquidity) || 0, logo: r.token?.info?.imageThumbUrl || '', _source: 'codex-fallback' }));
      return res.json({ success: true, data: results, _source: 'codex-fallback' });
    }

    // ── Trending tokens ──────────────────────────────────────────────────
    if (route === 'trending') {
      const sort = req.query.sort || 'volume_24h';
      const limit = parseInt(req.query.limit) || 50;
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet('/v2/tokens/trending', { chainId, sort, limit }, 15000);
        if (result.data) {
          const tokens = Array.isArray(result.data) ? result.data.map(t => normalizeToken(t, chainId)) : [];
          return res.json({ success: true, data: tokens, _source: 'spectre-api' });
        }
      }
      // Codex fallback
      // Codex change fields are RATIO fractions (-0.0056 = -0.56%) while the
      // spectre-api tier above serves PERCENT units - convert so both tiers
      // agree and downstream consumers (research relay bridge-shape mapper)
      // don't render 100x-too-small values as +0.00%.
      const codexSort = sort === 'gainers' ? 'change24' : 'volume24';
      const data = await codexQuery(`query($n:[Int!]){filterTokens(filters:{network:$n},limit:${limit},rankings:{attribute:${codexSort},direction:DESC}){results{token{address name symbol networkId info{imageThumbUrl}}volume24 liquidity priceUSD change5m change1 change4 change12 change24 marketCap}}}`, { n: [chainId] });
      const pct = (v) => (parseFloat(v) || 0) * 100;
      const results = (data?.filterTokens?.results || []).map(r => ({ address: r.token?.address, name: r.token?.name, symbol: r.token?.symbol, networkId: r.token?.networkId || chainId, price: parseFloat(r.priceUSD) || 0, volume24h: parseFloat(r.volume24) || 0, change24: pct(r.change24), change24h: pct(r.change24), change1h: pct(r.change1), change5m: pct(r.change5m), change4h: pct(r.change4), change12h: pct(r.change12), liquidity: parseFloat(r.liquidity) || 0, marketCap: parseFloat(r.marketCap) || 0, logo: r.token?.info?.imageThumbUrl || '', _source: 'codex-fallback' }));
      return res.json({ success: true, data: results, _source: 'codex-fallback' });
    }

    // ── Batch prices ─────────────────────────────────────────────────────
    if (route === 'prices') {
      const raw = (req.query.addresses || '').trim();
      if (!raw) return res.status(400).json({ error: 'addresses required' });
      const addresses = raw.split(',').map(a => a.trim().toLowerCase()).filter(Boolean).slice(0, 50);
      if (isSupported(chainId) && !isSolana(chainId)) {
        const result = await apiGet('/v2/tokens/prices', { chainId, addresses: addresses.join(',') }, 10000);
        if (result.data) return res.json({ success: true, data: result.data, _source: 'spectre-api' });
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Networks ─────────────────────────────────────────────────────────
    if (route === 'networks') {
      const result = await apiGet('/v2/networks', {}, 60000);
      if (result.data) return res.json({ success: true, data: result.data, _source: 'spectre-api' });
      return res.json({ success: true, data: [{ chain_id: 1, name: 'Ethereum' }, { chain_id: 56, name: 'BNB Chain' }], _source: 'static' });
    }

    // ── Heatmap ──────────────────────────────────────────────────────────
    if (route === 'heatmap') {
      const result = await apiGet('/v2/heatmap', { chainId }, 60000);
      if (result.data) return res.json({ success: true, data: result.data, _source: 'spectre-api' });
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Analytics (POST) ─────────────────────────────────────────────────
    if (route === 'analytics') {
      const analyticsAction = sub;
      const map = { biggestbuy: '/api/biggestbuy', biggestsell: '/api/biggestsell', topmakersbypnl: '/api/topmakersbypnl', vwap: '/api/vwap', tradesizepercentiles: '/api/tradesizepercentiles', uniquemakersbybucket: '/api/uniquemakersbybucket' };
      const path = map[analyticsAction];
      if (!path) return res.status(400).json({ error: `Unknown analytics action: ${analyticsAction}` });
      let body = {};
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) { return res.status(400).json({ error: 'Invalid JSON body' }); }
      const data = await apiPost(path, body, chainId);
      return res.json({ ...data, _source: 'spectre-api' });
    }

    // ── Stats (internal) ─────────────────────────────────────────────────
    if (route === '_stats') {
      return res.json({ circuit_state: cbState, cache_size: cache.size, spectre_api_only: SPECTRE_API_ONLY });
    }

    return res.status(404).json({ error: `Unknown route: /${segments.join('/')}` });
  } catch (err) {
    console.error('[onchain] Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
