/**
 * Vercel Serverless - TradingView symbol resolver.
 * Mirrors packages/server/index.js GET /api/tradingview/symbol.
 *
 * Resolves a token address+networkId to a TradingView-formatted symbol like
 * UNISWAP:WETHUSDT_ABC123.USD by looking up the token's top pair on Codex.
 */

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
let codexMetricsKv = null;
try { codexMetricsKv = _require('../../../../../packages/server/lib/codex-metrics-kv'); } catch {}

const CODEX_API_KEY = process.env.CODEX_API_KEY || '';
const CODEX_URL = 'https://graph.codex.io/graphql';
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';

const ALLOWED = ['http://localhost:5180', 'http://localhost:5181'];

function _extractOp(query) {
  if (!query) return 'unknown';
  const m = query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/);
  return m ? m[1] : 'unknown';
}

const DEX_NAMES = {
  1: 'UNISWAP',
  56: 'PANCAKESWAP',
  137: 'QUICKSWAP',
  42161: 'CAMELOT',
  8453: 'AERODROME',
  43114: 'TRADERJOE',
  10: 'VELODROME',
  1399811149: 'RAYDIUM',
};

const KNOWN_QUOTES = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB',
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WMATIC',
  'so11111111111111111111111111111111111111112': 'SOL',
};

async function executeCodex(query, variables) {
  if (!CODEX_API_KEY) throw new Error('CODEX_API_KEY missing');
  const startTime = Date.now();
  const operation = _extractOp(query);
  let errored = false;
  try {
    const r = await fetch(CODEX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: CODEX_API_KEY, Origin: CODEX_ORIGIN },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { errored = true; throw new Error(`Codex ${r.status}`); }
    const data = await r.json();
    if (data.errors) { errored = true; throw new Error(data.errors[0]?.message || 'GraphQL error'); }
    return data.data;
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    try { codexMetricsKv?.trackQuery(operation, Date.now() - startTime, errored, 'prod-research'); } catch {}
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { address, networkId = 1, symbol: tokenSymbolParam = '' } = req.query;
    if (!address) return res.status(400).json({ error: 'Missing address parameter' });

    const dexName = DEX_NAMES[parseInt(networkId)] || 'UNISWAP';
    const formattedAddress = String(address).startsWith('0x') ? String(address).toLowerCase() : String(address);

    const query = `
      query GetTokenPairs($tokenAddress: String!, $networkId: Int!) {
        listPairsForToken(tokenAddress: $tokenAddress, networkId: $networkId, limit: 5) {
          address
          token0
          token1
        }
      }
    `;

    const result = await executeCodex(query, {
      tokenAddress: formattedAddress,
      networkId: parseInt(networkId),
    });

    const pairs = result?.listPairsForToken || [];
    if (pairs.length === 0) {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ symbol: null, supported: false });
    }

    const topPair = pairs[0];
    const isToken0 = topPair.token0?.toLowerCase() === formattedAddress.toLowerCase();
    const quoteAddr = isToken0 ? topPair.token1 : topPair.token0;
    const targetSym = (tokenSymbolParam || String(address).slice(0, 6)).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const quoteSym = KNOWN_QUOTES[quoteAddr?.toLowerCase()] || 'WETH';
    const poolSuffix = topPair.address.slice(-6).toUpperCase();
    const tvSymbol = `${dexName}:${targetSym}${quoteSym}_${poolSuffix}.USD`;

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({
      symbol: tvSymbol,
      supported: true,
      dex: dexName,
      pair: `${targetSym}/${quoteSym}`,
      pairAddress: topPair.address,
    });
  } catch (err) {
    console.warn('[tradingview-symbol] error:', err.message);
    return res.status(200).json({ symbol: null, supported: false, error: err.message });
  }
}
