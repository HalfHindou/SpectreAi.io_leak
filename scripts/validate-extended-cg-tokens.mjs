// One-off validation for EXTENDED_CG_TOKENS (search hydration expansion).
// For every candidate, fetches CoinGecko /coins/{id} platform contracts via
// the local Express CG proxy and verifies our address matches EXACTLY.
// A wrong address here would route a real trade to a wrong contract - every
// entry must print OK before it is allowed into token-registry.js.
//
// Usage: node scripts/validate-extended-cg-tokens.mjs   (Express on :3001)

const CG_PLATFORM_TO_NETWORK = {
  ethereum: 1,
  'binance-smart-chain': 56,
  'polygon-pos': 137,
  'arbitrum-one': 42161,
  base: 8453,
  solana: 1399811149,
};

const CANDIDATES = {
  // cgId: { symbol, name, address, networkId }
  'lido-dao': { symbol: 'LDO', name: 'Lido DAO', address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32', networkId: 1 },
  'render-token': { symbol: 'RENDER', name: 'Render', address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', networkId: 1399811149 },
  'jupiter-exchange-solana': { symbol: 'JUP', name: 'Jupiter', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', networkId: 1399811149 },
  'pyth-network': { symbol: 'PYTH', name: 'Pyth Network', address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', networkId: 1399811149 },
  'jito-governance-token': { symbol: 'JTO', name: 'Jito', address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', networkId: 1399811149 },
  'popcat': { symbol: 'POPCAT', name: 'Popcat', address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', networkId: 1399811149 },
  'book-of-meme': { symbol: 'BOME', name: 'Book of Meme', address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', networkId: 1399811149 },
  'ondo-finance': { symbol: 'ONDO', name: 'Ondo', address: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3', networkId: 1 },
  'ethena': { symbol: 'ENA', name: 'Ethena', address: '0x57e114b691db790c35207b2e685d4a43181e6061', networkId: 1 },
  'worldcoin-wld': { symbol: 'WLD', name: 'Worldcoin', address: '0x163f8c2467924be0ae7b5347228cabf260318753', networkId: 1 },
  'fetch-ai': { symbol: 'FET', name: 'Artificial Superintelligence Alliance', address: '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85', networkId: 1 },
  'injective-protocol': { symbol: 'INJ', name: 'Injective', address: '0xe28b3b32b6c345a34ff64674606124dd5aceca30', networkId: 1 },
  'immutable-x': { symbol: 'IMX', name: 'Immutable', address: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff', networkId: 1 },
  'havven': { symbol: 'SNX', name: 'Synthetix', address: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', networkId: 1 },
  'compound-governance-token': { symbol: 'COMP', name: 'Compound', address: '0xc00e94cb662c3520282e6f5717214004a7f26888', networkId: 1 },
  'apecoin': { symbol: 'APE', name: 'ApeCoin', address: '0x4d224452801aced8b2f0aebe155379bb5d594381', networkId: 1 },
  'ethereum-name-service': { symbol: 'ENS', name: 'Ethereum Name Service', address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72', networkId: 1 },
  'chiliz': { symbol: 'CHZ', name: 'Chiliz', address: '0x3506424f91fd33084466f402d5d97f05f8e3b4af', networkId: 1 },
  'the-sandbox': { symbol: 'SAND', name: 'The Sandbox', address: '0x3845badade8e6dff049820680d1f14bd3903a5d0', networkId: 1 },
  'decentraland': { symbol: 'MANA', name: 'Decentraland', address: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942', networkId: 1 },
  'loopring': { symbol: 'LRC', name: 'Loopring', address: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd', networkId: 1 },
  '1inch': { symbol: '1INCH', name: '1inch', address: '0x111111111117dc0aa78b770fa6a738034120c302', networkId: 1 },
  'dai': { symbol: 'DAI', name: 'Dai', address: '0x6b175474e89094c44da98b954eedeac495271d0f', networkId: 1 },
  'wrapped-bitcoin': { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', networkId: 1 },
  'staked-ether': { symbol: 'STETH', name: 'Lido Staked Ether', address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', networkId: 1 },
  'wrapped-steth': { symbol: 'WSTETH', name: 'Wrapped stETH', address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', networkId: 1 },
  'leo-token': { symbol: 'LEO', name: 'LEO Token', address: '0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3', networkId: 1 },
  'okb': { symbol: 'OKB', name: 'OKB', address: '0x75231f58b43240c9718dd58b4967c5114342a86c', networkId: 1 },
  'fartcoin': { symbol: 'FARTCOIN', name: 'Fartcoin', address: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', networkId: 1399811149 },
  'pudgy-penguins': { symbol: 'PENGU', name: 'Pudgy Penguins', address: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', networkId: 1399811149 },
  'official-trump': { symbol: 'TRUMP', name: 'Official Trump', address: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', networkId: 1399811149 },
  'aerodrome-finance': { symbol: 'AERO', name: 'Aerodrome Finance', address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', networkId: 8453 },
  'based-brett': { symbol: 'BRETT', name: 'Brett', address: '0x532f27101965dd16442e59d40670faf5ebb142e4', networkId: 8453 },
  'virtual-protocol': { symbol: 'VIRTUAL', name: 'Virtuals Protocol', address: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', networkId: 8453 },
  'aixbt': { symbol: 'AIXBT', name: 'aixbt by Virtuals', address: '0x4f9fd6be4a90f2620860d680c0d4d5fb53d1a825', networkId: 8453 },
};

const NETWORK_TO_PLATFORM = Object.fromEntries(
  Object.entries(CG_PLATFORM_TO_NETWORK).map(([p, n]) => [n, p])
);

let ok = 0, bad = 0, unknown = 0;
for (const [cgId, info] of Object.entries(CANDIDATES)) {
  const platform = NETWORK_TO_PLATFORM[info.networkId];
  try {
    const r = await fetch(
      `http://127.0.0.1:3001/api/coingecko/coins/${cgId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
      { signal: AbortSignal.timeout(20000) }
    );
    if (!r.ok) { console.log(`?? ${cgId}: HTTP ${r.status}`); unknown++; continue; }
    const j = await r.json();
    const cgAddr = (j?.platforms?.[platform] || '').trim();
    const ours = info.address;
    const match = info.networkId === 1399811149
      ? cgAddr === ours
      : cgAddr.toLowerCase() === ours.toLowerCase();
    if (!cgAddr) { console.log(`?? ${cgId}: CG has no ${platform} platform entry (platforms: ${Object.keys(j?.platforms || {}).join(',') || 'none'})`); unknown++; }
    else if (match) { console.log(`OK ${cgId} (${info.symbol})`); ok++; }
    else { console.log(`BAD ${cgId}: ours=${ours} cg=${cgAddr}`); bad++; }
  } catch (e) {
    console.log(`?? ${cgId}: ${e.message}`); unknown++;
  }
}
console.log(`\nresult: ${ok} ok, ${bad} bad, ${unknown} unknown of ${Object.keys(CANDIDATES).length}`);
