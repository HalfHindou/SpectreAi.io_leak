/**
 * Vercel Serverless - Spectre Onchain API proxy
 * Proxies /api/onchain/* to the Spectre api-eth backend and normalizes responses.
 * Mirrors packages/server/routes/onchain.js logic for Vercel production.
 *
 * Routes handled:
 *   /api/onchain/token/{address}/swaps  - Trade history
 *   /api/onchain/token/{address}        - Token details
 *   /api/onchain/token/{address}/pools  - Token pools
 *   /api/onchain/token/{address}/holders - Top holders
 *   /api/onchain/pool/{address}/ohlcv   - OHLCV bars
 */

import { rateLimit } from '../ratelimit.js'

const ONCHAIN_API_URL = process.env.SPECTRE_ONCHAIN_API_URL || 'https://onchain.spectreai.io/api';
const TIMEOUT_MS = 10000;

// ── Normalizers (same logic as packages/server/routes/onchain.js) ──

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
    if (label === 'dev_transfer_buy') return { label: 'DTB', name: 'Dev Transfer Buy', color: '#9F1239' };
    if (label === 'dev_transfer_sell') return { label: 'DTS', name: 'Dev Transfer Sell', color: '#9F1239' };
    if (label === 'sniper_buy') return { label: 'SB', name: 'Sniper Buy', color: '#F43F5E' };
    if (label === 'sniper_sell') return { label: 'SS', name: 'Sniper Sell', color: '#F43F5E' };
    if (label === 'bundled_buy') return { label: 'BB', name: 'Bundle Buy', color: '#EC4899' };
    if (label === 'bundled_sell') return { label: 'BS', name: 'Bundle Sell', color: '#EC4899' };
    if (label.startsWith('top_')) {
      const m = label.match(/top_(\d+)_(buy|sell)/);
      if (m) {
        return {
          label: `T${m[1]}${m[2] === 'buy' ? 'B' : 'S'}`,
          name: `Top ${m[1]} Holder ${m[2] === 'buy' ? 'Buy' : 'Sell'}`,
          color: m[2] === 'buy' ? '#22C55E' : '#FB923C',
        };
      }
    }
  }

  if (isBuy) {
    if (totalBuys <= 1) return { label: 'NEW', name: 'New Holder', color: '#10B981' };
    return { label: 'DCA', name: 'Dollar-Cost Average', color: '#06B6D4' };
  } else {
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
  const amountToken = priceUSD > 0 ? amountUSD / priceUSD : 0;
  return {
    timestamp: raw.block_timestamp ? Math.floor(new Date(raw.block_timestamp).getTime() / 1000) : 0,
    type: raw.is_buy ? 'Buy' : 'Sell',
    priceUSD,
    amountToken,
    amountUSD,
    maker: raw.trader_address || '',
    txHash: raw.tx_hash || '',
    poolAddress: raw.pool_address || '',
    makerLabel: computeTradeLabel(raw),
    makerTotalBuys: parseInt(raw.total_buys) || 0,
    makerTotalSells: parseInt(raw.total_sells) || 0,
    makerPnlUsd: parseFloat(raw.pnl_usd) || 0,
    makerTotalBuyUsd: parseFloat(raw.total_buy_usd) || 0,
    makerTotalSellUsd: parseFloat(raw.total_sell_usd) || 0,
    _source: 'spectre-api',
  };
}

function normalizeToken(raw, chainId) {
  if (!raw) return null;
  const price = parseFloat(raw.price_usd) || 0;
  const decimals = parseInt(raw.decimals) || 18;
  const totalSupply = parseFloat(raw.total_supply) || 0;
  const humanSupply = totalSupply > 0 ? totalSupply / Math.pow(10, decimals) : 0;
  const rawCirculating = parseFloat(raw.circulating_supply) || 0;
  const circulating = rawCirculating > 0 ? rawCirculating / Math.pow(10, decimals) : humanSupply;
  return {
    address: raw.address, name: raw.name || '', symbol: raw.symbol || '',
    decimals, networkId: chainId,
    network: chainId === 1 ? 'Ethereum' : chainId === 56 ? 'BNB Chain' : 'Unknown',
    price, priceUSD: price,
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
    burnedSupply: parseFloat(raw.burned_supply) > 0 ? parseFloat(raw.burned_supply) / Math.pow(10, decimals) : 0,
    isVerified: raw.is_verified || false,
    bondingCurveAddress: raw.bonding_curve_address || null,
    graduationPoolAddress: raw.graduation_pool_address || null,
    graduatedAt: raw.graduated_at || null,
    _source: 'spectre-api',
  };
}

// ── Trending quality filter (mirrors packages/server/routes/onchain.js) ──
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

async function fetchPoolSparkline(poolAddress, chainId) {
  if (!poolAddress) return null;
  try {
    const path = chainId === 1399811149
      ? `/v2/solana/market/${poolAddress.toLowerCase()}/ohlcv`
      : `/v2/pool/${poolAddress.toLowerCase()}/ohlc`;
    const result = await apiGet(path, { chainId, interval: '1h', limit: 168 });
    const bars = Array.isArray(result?.data) ? result.data : [];
    return bars
      .map(b => parseFloat(b.close ?? b.c))
      .filter(v => Number.isFinite(v) && v > 0);
  } catch {
    return [];
  }
}

function normalizePool(raw, chainId) {
  if (!raw) return null;
  return {
    address: raw.address, chainId,
    dexId: raw.dex_id, dexName: raw.dex_name || raw.dex_slug || '',
    token0: raw.token0_address, token1: raw.token1_address,
    feeTier: raw.fee_tier, liquidity: parseFloat(raw.liquidity_usd) || 0,
    _source: 'spectre-api',
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

// ── Backend fetch helper ──

async function apiGet(path, params = {}) {
  const url = new URL(`${ONCHAIN_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      'x-chain-id': String(params.chainId || ''),
      // Cloudflare in front of onchain.spectreai.io bot-blocks empty/server
      // UAs (returns an HTML challenge page). Pose as a browser - same
      // workaround as packages/server/lib/onchain-client.js.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Origin: 'https://trade.spectreai.io',
      Referer: 'https://trade.spectreai.io/',
    },
  });
  if (!res.ok) return { data: null, error: `http-${res.status}` };
  const json = await res.json();
  return { data: json.data ?? json, _raw: json };
}

// ── Route handler ──

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (await rateLimit(req, res, { bucket: 'onchain', max: 120, windowMs: 60_000 })) return;

  const { route } = req.query;
  if (!route) return res.status(400).json({ error: 'Missing route parameter' });

  const chainId = parseInt(req.query.chainId) || 1;
  const SOLANA = 1399811149;
  const isSolana = chainId === SOLANA;

  try {
    // ── Trending DEX tokens (welcome On-Chain tab + trending ticker) ──
    // DEV/PROD PARITY (Gleb 2026-07-03): this route existed only in the
    // Express dev server - prod parsed "tokens/trending" as a token address
    // and 400'd ("Invalid EVM address format"), so the On-Chain tab and the
    // welcome ticker were EMPTY in production since #1148 made them depend
    // on this feed exclusively. Mirrors packages/server/routes/onchain.js.
    if (route === 'tokens/trending') {
      const sort = req.query.sort || 'volume_24h';
      const limit = parseInt(req.query.limit) || 50;
      const includeSparklines = req.query.sparklines === '1' || req.query.sparklines === 'true';
      const quality = req.query.quality === '1' || req.query.quality === 'true';
      const upstreamLimit = quality ? Math.min(Math.max(limit * 4, 200), 500) : limit;

      const SUPPORTED = new Set([1, 56]);
      if (!SUPPORTED.has(chainId)) {
        // Solana + other chains: upstream trending not served here (matches dev)
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
        return res.json({ success: true, data: [], _source: 'none' });
      }

      const result = await apiGet('/v2/tokens/trending', { chainId, sort, limit: upstreamLimit });
      let raw = null;
      let relayed = false;
      if (result.data) {
        raw = Array.isArray(result.data) ? result.data.map(t => normalizeToken(t, chainId)) : [];
      } else {
        // Cloudflare challenges THIS Vercel project's egress on
        // onchain.spectreai.io (_upstream http-403, verified 2026-07-03)
        // while the TRADING project's identical transport passes. Until the
        // WAF skip rule covers research (infra, Gleb/KD), relay through the
        // trading app's own serverless trending endpoint - same platform,
        // 15s CDN cache on both ends, returns ALREADY-normalized tokens
        // (do NOT re-normalize: normalizeToken expects raw snake_case).
        try {
          // The trading endpoint's upstream returns EMPTY for limit >= ~250
          // (verified 2026-07-08: limit=200 -> 56KB of rows, limit=250/300/400
          // -> []). The quality overfetch asks for 400, which silently killed
          // the whole relay leg - cap it at 200; the quality filter + slice
          // below still get 2x the requested rows to work with.
          const relayLimit = Math.min(upstreamLimit, 200);
          const relay = await fetch(
            `https://trade.spectreai.io/api/onchain/tokens/trending?chainId=${chainId}&sort=${encodeURIComponent(sort)}&limit=${relayLimit}`,
            { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } }
          );
          if (relay.ok) {
            const j = await relay.json();
            if (Array.isArray(j?.data) && j.data.length) {
              raw = j.data;
              relayed = true;
            }
          }
        } catch { /* fall through to the empty response below */ }
      }
      if (!raw || raw.length === 0) {
        // _upstream names the failure (http-403 = Cloudflare challenge,
        // http-404 = wrong SPECTRE_ONCHAIN_API_URL env, etc.) - ops metadata
        // on an empty response, invisible to the UI.
        return res.json({ success: true, data: [], _source: 'none', _upstream: result.error || 'empty' });
      }
      let tokens;
      if (quality) {
        const filtered = raw.filter(t => isQualityToken(t, chainId));
        // Safety net: if the filter wiped the list, return raw top-N rather than nothing
        tokens = (filtered.length >= limit ? filtered : raw).slice(0, limit);
      } else {
        tokens = raw.slice(0, limit);
      }

      // Sparkline fan-out hits the SAME challenged upstream - skip it on the
      // relay path (all 8 lookups would 403; the UI degrades gracefully
      // without sparklines).
      if (includeSparklines && !relayed && tokens.length > 0) {
        // Concurrency-bounded fan-out: 8 parallel pool OHLCV lookups
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

      res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
      return res.json({ success: true, data: tokens, _source: relayed ? 'trade-relay' : 'spectre-api' });
    }

    // Parse route: "token/0x.../swaps" or "pool/0x.../ohlcv" etc.
    const parts = route.split('/');
    const entityType = parts[0]; // 'token' or 'pool'
    const address = parts[1];
    const action = parts[2]; // 'swaps', 'pools', 'holders', 'ohlcv', or undefined
    const subAction = parts[3]; // 'chart' for holders/chart

    if (!address) return res.status(400).json({ error: 'Missing address' });
    // Defense-in-depth: validate address format before forwarding to upstream
    // on-chain API. EVM = 0x + 40 hex chars. Solana = base58 32-44 chars.
    // Upstream service should validate too; rejecting here saves a round trip.
    if (address.length > 64) return res.status(400).json({ error: 'Address too long' });
    const isValidEvm = /^0x[0-9a-fA-F]{40}$/.test(address);
    const isValidSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    if (isSolana ? !isValidSolana : !isValidEvm) {
      return res.status(400).json({ error: `Invalid ${isSolana ? 'Solana' : 'EVM'} address format`, address });
    }
    const addr = address.toLowerCase();

    // ── Token swaps/trades ──
    if (entityType === 'token' && action === 'swaps') {
      const { limit, cursor, maker } = req.query;
      const to = req.query.to || new Date().toISOString();
      const from = req.query.from || new Date(Date.now() - 86400000).toISOString();

      if (!isSolana) {
        const result = await apiGet(`/v2/token/${addr}/swaps`, {
          chainId, from, to, limit: limit || 50, cursor, maker, extended: true,
        });
        if (result.data) {
          const raw = Array.isArray(result.data) ? result.data : (result.data.data || []);
          const trades = raw.map(normalizeTrade);
          return res.json({
            success: true, data: trades,
            cursors: result.data.cursors || {},
            base_token: result.data.base_token || null,
            quote_token: result.data.quote_token || null,
            _source: 'spectre-api',
          });
        }
      } else {
        const result = await apiGet(`/v2/solana/token/${address}/trades`, {
          from: req.query.from || new Date(Date.now() - 86400000).toISOString(),
          to: req.query.to || new Date().toISOString(),
          limit: limit || 50,
        });
        if (result.data) {
          return res.json({ success: true, data: result.data, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Token details ──
    if (entityType === 'token' && !action) {
      if (!isSolana) {
        const result = await apiGet(`/v2/token/${addr}`, { chainId });
        if (result.data) {
          return res.json({ success: true, data: normalizeToken(result.data, chainId), _source: 'spectre-api' });
        }
      } else {
        const result = await apiGet(`/v2/solana/token/${address}`, {});
        if (result.data) {
          return res.json({ success: true, data: result.data, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: null, _source: 'none' });
    }

    // ── Token pools ──
    if (entityType === 'token' && action === 'pools') {
      if (!isSolana) {
        const result = await apiGet(`/v2/token/${addr}/pools`, { chainId });
        if (result.data) {
          const pools = Array.isArray(result.data) ? result.data.map(p => normalizePool(p, chainId)) : [];
          return res.json({ success: true, data: pools, _source: 'spectre-api' });
        }
      } else {
        const result = await apiGet(`/v2/solana/token/${address}/markets`, {});
        if (result.data) {
          return res.json({ success: true, data: result.data, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Token holders ──
    if (entityType === 'token' && action === 'holders' && !subAction) {
      const limit = parseInt(req.query.limit) || 20;
      if (!isSolana) {
        const result = await apiGet(`/v2/token/${addr}/top-holders`, { chainId, limit });
        if (result.data) {
          return res.json({ success: true, data: result.data, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Holders chart ──
    if (entityType === 'token' && action === 'holders' && subAction === 'chart') {
      const { bucket, from, to } = req.query;
      if (!isSolana) {
        const result = await apiGet(`/v2/token/${addr}/holders/chart`, {
          chainId, bucket: bucket || '1h', from, to,
        });
        if (result.data) {
          return res.json({ success: true, data: result.data, _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    // ── Pool OHLCV ──
    if (entityType === 'pool' && action === 'ohlcv') {
      const { interval, from, to, limit } = req.query;
      if (!isSolana) {
        const result = await apiGet(`/v2/pool/${addr}/ohlc`, {
          chainId, interval: interval || '1h', from, to, limit: limit || 500,
        });
        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          return res.json({ success: true, data: result.data.map(normalizeBar), _source: 'spectre-api' });
        }
      } else {
        const result = await apiGet(`/v2/solana/market/${address}/ohlcv`, {
          interval: interval || '1h', from, to, limit: limit || 500,
        });
        if (result.data && Array.isArray(result.data)) {
          return res.json({ success: true, data: result.data.map(normalizeBar), _source: 'spectre-api' });
        }
      }
      return res.json({ success: true, data: [], _source: 'none' });
    }

    return res.status(404).json({ error: `Unknown onchain route: ${route}` });
  } catch (error) {
    console.error('Onchain API error:', error.message);
    return res.status(500).json({ success: false, data: null, error: error.message });
  }
};
