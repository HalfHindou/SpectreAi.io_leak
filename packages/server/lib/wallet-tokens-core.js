/**
 * wallet-tokens-core - Codex-powered wallet token auto-discovery.
 *
 * Replaces the hardcoded per-chain COMMON_TOKENS enumeration (native + a couple
 * stables) in the trading app's walletService. Given a wallet address + a Codex
 * networkId, returns EVERY token the wallet actually holds - native + any ERC-20
 * / SPL - with live balances, prices and USD values, so a deposited token the
 * curated list never knew about (ARB, GMX, a random meme, an SPL) still shows.
 *
 * Two Codex GraphQL calls per chain:
 *   1. balances(input:{walletAddress, networks:[net], includeNative}) - LIVE
 *      holdings. Verified real-time (matches on-chain RPC to the wei). Native
 *      comes back as tokenId "native:<net>" carrying the wrapped-token metadata.
 *   2. filterTokens(tokens:[ids]) - priceUSD + liquidity for the discovered
 *      tokens (and the wrapped-native, to price the native leg).
 *
 * Shared by BOTH the dev Express route (packages/server/routes/wallet-tokens.js)
 * and the prod serverless function (apps/trading/api/wallet-tokens.js) so dev and
 * prod stay in parity. CommonJS + global fetch (matches apps/trading/api/codex.js).
 *
 * Reads CODEX_API_KEY / CODEX_ORIGIN from the environment. Never throws to the
 * caller for a price hiccup - only a hard balances failure throws, so the caller
 * can 502 and the frontend can fall back to its Multicall3 path.
 */

const CODEX_BASE_URL = 'https://graph.codex.io/graphql';
// The Codex key enforces an Origin allowlist; server-to-server calls carry no
// Origin by default -> "unauthorized origin: undefined". Send the allowed one.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';

const SOLANA_NETWORK_ID = 1399811149;

// Canonical wrapped-native token per network - used ONLY to price the native
// leg (Codex prices tokens, and native has no token address).
const WRAPPED_NATIVE = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',       // WETH
  56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',      // WBNB
  137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',     // WPOL (ex-WMATIC)
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',   // WETH (Arbitrum)
  8453: '0x4200000000000000000000000000000000000006',    // WETH (Base)
  [SOLANA_NETWORK_ID]: 'So11111111111111111111111111111111111111112', // WSOL
};

// Hide priced sub-cent dust + unpriceable spam airdrops from the wallet. Native
// is always kept. Only applied when pricing actually succeeded (see below), so a
// Codex price outage never hides a real holding.
const DUST_USD = 0.01;
const MAX_TOKENS = 60;

// Tiny per-instance cache so the 15s frontend poll (and concurrent tabs) don't
// re-hit Codex on every tick. Per-wallet+chain, 12s TTL. Ephemeral on serverless.
const _cache = new Map(); // key -> { ts, data }
const CACHE_TTL_MS = 12_000;

// Codex tokenId: EVM addresses are lowercased, Solana (base58) is case-sensitive.
function idFor(address, networkId) {
  return `${networkId === SOLANA_NETWORK_ID ? address : String(address).toLowerCase()}:${networkId}`;
}

async function codexQuery(query, variables) {
  const key = process.env.CODEX_API_KEY;
  if (!key) throw new Error('CODEX_API_KEY not configured');
  const res = await fetch(CODEX_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key, Origin: CODEX_ORIGIN },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'Codex GraphQL error');
  return data.data;
}

const BALANCES_QUERY = `
  query WalletBalances($input: BalancesInput!) {
    balances(input: $input) {
      items {
        tokenId
        shiftedBalance
        token {
          address
          symbol
          name
          decimals
          networkId
          info { imageThumbUrl imageLargeUrl }
        }
      }
    }
  }
`;

const PRICES_QUERY = `
  query WalletTokenPrices($tokens: [String!]) {
    filterTokens(tokens: $tokens, limit: 200) {
      results {
        priceUSD
        liquidity
        token { address networkId }
      }
    }
  }
`;

/**
 * Discover + price every token a wallet holds on one chain.
 * @returns Array<{ isNative, address, networkId, symbol, name, decimals,
 *                  balance, price, balanceUsd, liquidity, logo }>
 * Native always first, then holdings by USD value desc. Throws only on a hard
 * balances-query failure.
 */
async function getWalletTokenBalances(address, networkId) {
  const net = parseInt(networkId);
  if (!address || !Number.isFinite(net)) return [];

  const cacheKey = `${String(address).toLowerCase()}:${net}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const isSol = net === SOLANA_NETWORK_ID;

  // 1. Discover holdings (LIVE). Native arrives as tokenId "native:<net>".
  const balData = await codexQuery(BALANCES_QUERY, {
    input: { walletAddress: address, networks: [net], includeNative: true },
  });
  const items = Array.isArray(balData?.balances?.items) ? balData.balances.items : [];

  // 2. Price the real tokens + the wrapped-native (for the native leg).
  const realIds = [];
  for (const it of items) {
    if (it?.tokenId && !it.tokenId.startsWith('native:') && it.token?.address) {
      realIds.push(idFor(it.token.address, net));
    }
  }
  const wrappedId = WRAPPED_NATIVE[net] ? idFor(WRAPPED_NATIVE[net], net) : null;
  const priceIds = [...new Set([...realIds, wrappedId].filter(Boolean))];

  const priceMap = {};
  let pricesOk = false;
  if (priceIds.length) {
    try {
      const pd = await codexQuery(PRICES_QUERY, { tokens: priceIds });
      for (const r of (pd?.filterTokens?.results || [])) {
        if (!r?.token?.address) continue;
        priceMap[idFor(r.token.address, r.token.networkId)] = {
          price: parseFloat(r.priceUSD) || 0,
          liquidity: parseFloat(r.liquidity) || 0,
        };
      }
      pricesOk = true;
    } catch (_) {
      // Price hiccup - keep going with 0 prices; the dust filter is skipped
      // below (pricesOk=false) so no real holding gets hidden by a blip.
    }
  } else {
    pricesOk = true; // nothing to price (native-only wallet)
  }
  const nativePrice = wrappedId ? (priceMap[wrappedId]?.price || 0) : 0;

  // 3. Normalize to the walletService balance shape.
  const out = [];
  let hasNative = false;
  for (const it of items) {
    const isNative = it?.tokenId?.startsWith('native:');
    const bal = Number(it?.shiftedBalance) || 0;
    if (isNative) {
      hasNative = true;
      out.push({
        isNative: true, address: null, networkId: net,
        symbol: it.token?.symbol || null, name: it.token?.name || null,
        decimals: Number.isFinite(it.token?.decimals) ? it.token.decimals : (isSol ? 9 : 18),
        balance: bal, price: nativePrice, balanceUsd: bal * nativePrice,
        liquidity: 0, logo: it.token?.info?.imageThumbUrl || it.token?.info?.imageLargeUrl || null,
      });
    } else if (it?.token?.address) {
      const key = idFor(it.token.address, net);
      const price = priceMap[key]?.price || 0;
      out.push({
        isNative: false, address: it.token.address, networkId: net,
        symbol: it.token?.symbol || null, name: it.token?.name || it.token?.symbol || null,
        decimals: Number.isFinite(it.token?.decimals) ? it.token.decimals : 18,
        balance: bal, price, balanceUsd: bal * price,
        liquidity: priceMap[key]?.liquidity || 0,
        logo: it.token?.info?.imageThumbUrl || it.token?.info?.imageLargeUrl || null,
      });
    }
  }

  // 4. Always surface a native row (even 0) so the chain tab renders it.
  if (!hasNative) {
    out.unshift({
      isNative: true, address: null, networkId: net, symbol: null, name: null,
      decimals: isSol ? 9 : 18, balance: 0, price: nativePrice, balanceUsd: 0,
      liquidity: 0, logo: null,
    });
  }

  // 5. Dust/spam filter (only when pricing worked, so an outage hides nothing),
  //    sort natives-first then by USD desc, cap the list.
  const filtered = out.filter((t) => t.isNative || !pricesOk || t.balanceUsd >= DUST_USD);
  filtered.sort((a, b) => (Number(b.isNative) - Number(a.isNative)) || (b.balanceUsd - a.balanceUsd));
  const result = filtered.slice(0, MAX_TOKENS);

  _cache.set(cacheKey, { ts: Date.now(), data: result });
  return result;
}

module.exports = { getWalletTokenBalances, SOLANA_NETWORK_ID };
