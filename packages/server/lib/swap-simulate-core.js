/**
 * swap-simulate-core - pre-trade "will this swap actually execute" simulation.
 *
 * Powers the swap panel's "Simulate" / safety-check button: before the user
 * signs anything, dry-run the exact trade and report whether it would succeed,
 * would revert (with a decoded reason), or is risky. Catches honeypots, sell
 * taxes that break min-out, transfer restrictions, thin-liquidity reverts, and
 * stale routes - the class of failure that otherwise wastes a signed, gas-paying
 * tx that reverts on-chain (e.g. the MARV TRANSFER_FROM_FAILED case).
 *
 * NO signature and NO gas - both paths are pure simulation:
 *   - Solana: build the Jupiter swap, then RPC `simulateTransaction`
 *     (sigVerify:false, replaceRecentBlockhash) - runs the whole tx dry.
 *   - EVM: fetch 0x's signature-free ALLOWANCE-HOLDER quote, then `eth_call`
 *     it with an allowance state-override (so the router can pull the token
 *     without a real approval). Native-input buys need no override.
 *
 * Shared by the dev Express route (routes/swap.js `simulate` action) and the
 * prod serverless (apps/trading/api/swap.js). CommonJS + global fetch; ethers is
 * used only for keccak/abi in EVM allowance-slot detection (resolves via
 * workspace hoisting in dev, trading node_modules in prod).
 */

const { ethers } = require('ethers');

const ZEROX_API = 'https://api.0x.org';
const ZEROX_API_KEY = process.env.ZEROX_API_KEY || '';
const JUPITER_API = process.env.JUPITER_API_URL || 'https://lite-api.jup.ag/swap/v1';
const JUP_HEADERS = process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {};

const EVM_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const WSOL = 'So11111111111111111111111111111111111111112';
const MAX_UINT = '0x' + 'f'.repeat(64);
// ~100,000 ETH in wei - injected as the caller's balance in the sim state
// override so a native-coin buy tests token SAFETY rather than failing on the
// wallet's current balance (affordability is surfaced separately by the UI).
const SIM_FUND_WEI = '0x152d02c7e14af6800000';

const EVM_IDS = { ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, base: 8453, robinhood: 4663 };
// publicnode is used as the safe fallback because it supports eth_call state
// overrides (required for the sell-allowance override) on every chain. An env
// RPC is preferred when set - but if it lacks override support, sells degrade to
// an honest "inconclusive" rather than a false "would fail".
const EVM_RPC = {
  1: process.env.VITE_ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
  56: process.env.VITE_BSC_RPC_URL || 'https://bsc-rpc.publicnode.com',
  137: process.env.VITE_POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
  42161: process.env.VITE_ARB_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com',
  8453: process.env.VITE_BASE_RPC_URL || 'https://base-rpc.publicnode.com',
  4663: process.env.VITE_ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
};
const SOLANA_RPC = process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

const toHex = (v) => { if (v == null || v === '') return '0x0'; if (typeof v === 'string' && v.startsWith('0x')) return v; return '0x' + BigInt(v).toString(16); };

async function jsonRpc(url, method, params) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  return r.json();
}

// Decode an EVM revert into a human string. Error(string) -> the string;
// Panic(code) -> named; custom-error selector -> hex marker.
function decodeEvmRevert(error) {
  const data = typeof error?.data === 'string' ? error.data : error?.data?.data;
  if (typeof data === 'string' && data.startsWith('0x08c379a0')) {
    // Error(string): 0x(2) + selector(8) + offset(64) + length(64) + data.
    // Length starts at char 74, string at 138. Strip any non-printable bytes
    // (padding / stray control chars) so the reason renders clean.
    try {
      const len = parseInt(data.slice(74, 138), 16);
      const str = Buffer.from(data.slice(138, 138 + len * 2), 'hex').toString('utf8');
      const clean = str.replace(/[^\x20-\x7E]/g, '').trim();
      if (clean) return clean;
    } catch { /* fall through */ }
  }
  if (typeof data === 'string' && data.startsWith('0x4e487b71')) return `arithmetic/panic (0x${data.slice(-2)})`;
  const msg = error?.message || '';
  if (/execution reverted/i.test(msg)) return msg.replace(/execution reverted:?\s*/i, '').trim() || 'reverted';
  return msg || 'reverted';
}

// Turn a raw revert into user-facing safety copy.
function friendlyEvmReason(raw) {
  const r = String(raw || '').toUpperCase();
  // We grant the router MAX allowance in the sim, so a subtraction/underflow in
  // the token's transferFrom means the AMOUNT exceeds the wallet's balance -
  // typically typing the rounded displayed balance, which rounds just past the
  // exact amount.
  if (r.includes('SUBTRACTION OVERFLOW') || r.includes('SAFEMATH') || r.includes('UNDERFLOW') || (r.includes('ARITHMETIC') && r.includes('PANIC'))) {
    return 'Amount is more than your on-chain balance - reduce it. Your displayed balance may be higher than what you actually hold (it refreshes from the chain).';
  }
  if (r.includes('TRANSFER_FROM_FAILED') || r.includes('TRANSFERFROM')) return 'The token could not be pulled for the swap - the route may be stale or the token restricts transfers. Try re-quoting.';
  if (r.includes('INSUFFICIENT') && r.includes('OUTPUT')) return 'Output below your slippage tolerance - price moved. Raise slippage or reduce size.';
  if (r.includes('K') && r.includes('UNISWAP')) return 'Pool math failed (thin liquidity). Reduce the amount.';
  if (r.includes('TRANSFER') && r.includes('TAX')) return 'The token takes a transfer tax that breaks the swap.';
  return raw ? `Would revert: ${raw}` : 'The swap would revert on-chain.';
}

// Cache the ERC-20 _allowances BASE storage slot per (chain, token). The base is
// a property of the token's storage layout, so once found it's reused for ANY
// owner/spender - turning a ~20-round-trip probe into zero RPC calls on repeat
// sims. Sequential probing on a slow public RPC was the main reason the sell sim
// hit its timeout.
const _baseSlotCache = new Map();

// Find the ERC-20 _allowances base slot by override-and-verify: set the computed
// slot for allowance[owner][spender] to MAX and see if allowance() reads it back.
// Probes in small PARALLEL batches (most tokens live at a low base slot) and
// caches the base so later sims skip detection entirely.
async function detectAllowanceSlot(rpc, token, owner, spender, cacheKey) {
  const allowanceCalldata = '0xdd62ed3e' + owner.slice(2).toLowerCase().padStart(64, '0') + spender.slice(2).toLowerCase().padStart(64, '0');
  const slotFor = (base) => {
    const inner = ethers.keccak256(ethers.concat([ethers.zeroPadValue(owner, 32), ethers.zeroPadValue(ethers.toBeHex(base), 32)]));
    return ethers.keccak256(ethers.concat([ethers.zeroPadValue(spender, 32), inner]));
  };
  if (cacheKey && _baseSlotCache.has(cacheKey)) {
    const base = _baseSlotCache.get(cacheKey);
    return base == null ? null : slotFor(base);
  }
  const probe = async (base) => {
    try {
      const r = await jsonRpc(rpc, 'eth_call', [{ to: token, data: allowanceCalldata }, 'latest', { [token]: { stateDiff: { [slotFor(base)]: MAX_UINT } } }]);
      return (r && !r.error && r.result && BigInt(r.result) > 10n ** 30n) ? base : null;
    } catch { return null; }
  };
  let foundBase = null;
  for (let start = 0; start <= 20 && foundBase == null; start += 6) {
    const bases = [];
    for (let b = start; b <= Math.min(start + 5, 20); b++) bases.push(b);
    const hit = (await Promise.all(bases.map(probe))).find((b) => b != null);
    if (hit != null) foundBase = hit;
  }
  if (cacheKey) _baseSlotCache.set(cacheKey, foundBase);
  return foundBase == null ? null : slotFor(foundBase);
}

async function simulateEvm({ chainId, inputToken, outputToken, amount, userAddress, slippageBps }) {
  const id = EVM_IDS[chainId];
  const rpc = EVM_RPC[id];
  if (!id || !rpc) return { ok: false, chain: chainId, reason: `Unsupported chain: ${chainId}` };
  if (!ZEROX_API_KEY) return { ok: null, chain: chainId, inconclusive: true, reason: 'Simulation unavailable (0x key not set).' };

  const sellToken = inputToken === 'native' ? EVM_NATIVE : inputToken;
  const buyToken = outputToken === 'native' ? EVM_NATIVE : outputToken;
  const inputIsNative = sellToken.toLowerCase() === EVM_NATIVE.toLowerCase();

  // 1. 0x allowance-holder quote (signature-free calldata)
  const params = new URLSearchParams({ sellToken, buyToken, sellAmount: String(amount), chainId: String(id), taker: userAddress });
  if (slippageBps) params.set('slippageBps', String(slippageBps));
  let q;
  try {
    const res = await fetch(`${ZEROX_API}/swap/allowance-holder/quote?${params}`, { headers: { '0x-api-key': ZEROX_API_KEY, '0x-version': 'v2' }, signal: AbortSignal.timeout(12000) });
    q = await res.json();
  } catch (e) {
    return { ok: null, chain: chainId, inconclusive: true, reason: 'Could not reach the quote service. Try again.' };
  }
  if (q?.liquidityAvailable === false) return { ok: false, chain: chainId, reason: 'No liquidity for this trade right now.' };
  if (!q?.transaction?.to) {
    if (q?.issues?.balance) return { ok: false, chain: chainId, reason: 'Insufficient balance for this amount.' };
    return { ok: false, chain: chainId, reason: 'No executable route for this trade.' };
  }

  // 2. State overrides for the eth_call. ALWAYS fund the caller so a wallet
  //    light on the native coin doesn't fail the sim on affordability - Simulate
  //    tests token SAFETY (honeypot / tax / dead route), not whether you hold
  //    enough right now (the swap UI surfaces balance separately). For sells,
  //    also grant the AllowanceHolder max allowance on the sell token.
  const override = { [userAddress]: { balance: SIM_FUND_WEI } };
  let allowanceOverridden = false;
  if (!inputIsNative) {
    const spender = q.issues?.allowance?.spender || q.transaction.to;
    const slot = await detectAllowanceSlot(rpc, sellToken, userAddress, spender, `${id}:${sellToken.toLowerCase()}`);
    if (slot) { override[sellToken] = { stateDiff: { [slot]: MAX_UINT } }; allowanceOverridden = true; }
  }

  // 3. eth_call the swap (override always present)
  const tx = { from: userAddress, to: q.transaction.to, data: q.transaction.data, value: toHex(q.transaction.value) };
  let sim;
  try { sim = await jsonRpc(rpc, 'eth_call', [tx, 'latest', override]); }
  catch {
    // Public-RPC state-override calls are variable under load - one retry before
    // giving up (the slot cache above already cut the pre-call RPC pressure).
    try { sim = await jsonRpc(rpc, 'eth_call', [tx, 'latest', override]); }
    catch { return { ok: null, chain: chainId, inconclusive: true, reason: 'Simulation timed out. Try again.' }; }
  }

  if (sim.error) {
    const raw = decodeEvmRevert(sim.error);
    // Couldn't grant allowance (override unsupported) AND it failed on the pull:
    // that's a simulation limitation, not a real failure - stay honest.
    if (!allowanceOverridden && !inputIsNative && /TRANSFER_FROM_FAILED|allowance|transferfrom/i.test(raw)) {
      return { ok: null, chain: chainId, inconclusive: true, reason: 'Could not fully simulate this sell (approval step). Retrying the trade usually resolves it.', buyAmount: q.buyAmount };
    }
    return { ok: false, chain: chainId, reason: friendlyEvmReason(raw), rawReason: raw, buyAmount: q.buyAmount };
  }
  return { ok: true, chain: chainId, buyAmount: q.buyAmount };
}

function friendlySolReason(err, logs) {
  const s = JSON.stringify(err || '');
  if (s.includes('6001')) return 'Price moved beyond your slippage tolerance. Raise slippage or reduce size.';
  if (s.includes('6014')) return 'Route built a stale program instruction. Re-quote and try again.';
  if (s.includes('InsufficientFundsForRent')) return 'Not enough SOL to cover rent/fees for this trade.';
  const last = Array.isArray(logs) ? logs.filter((l) => /fail|error|insufficient|slippage/i.test(l)).slice(-1)[0] : null;
  if (last) return `Would fail: ${last.replace(/^Program log:\s*/, '').slice(0, 120)}`;
  return 'The swap would fail to execute (route or liquidity issue).';
}

async function simulateSolana({ inputToken, outputToken, amount, userAddress, slippageBps }) {
  const inMint = inputToken === 'native' ? WSOL : inputToken;
  const outMint = outputToken === 'native' ? WSOL : outputToken;
  let Q;
  try {
    const r = await fetch(`${JUPITER_API}/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=${slippageBps || 100}`, { headers: JUP_HEADERS, signal: AbortSignal.timeout(12000) });
    Q = await r.json();
  } catch { return { ok: null, chain: 'solana', inconclusive: true, reason: 'Could not reach the quote service. Try again.' }; }
  if (Q?.error || !Q?.outAmount) return { ok: false, chain: 'solana', reason: 'No route / no liquidity for this trade.' };

  let SI;
  try {
    const r = await fetch(`${JUPITER_API}/swap`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...JUP_HEADERS }, body: JSON.stringify({ quoteResponse: Q, userPublicKey: userAddress, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }), signal: AbortSignal.timeout(12000) });
    SI = await r.json();
  } catch { return { ok: null, chain: 'solana', inconclusive: true, reason: 'Could not build the swap. Try again.' }; }
  if (!SI?.swapTransaction) return { ok: false, chain: 'solana', reason: SI?.error || 'Could not build the swap for this token.' };

  let sim;
  try {
    sim = await jsonRpc(SOLANA_RPC, 'simulateTransaction', [SI.swapTransaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }]);
  } catch { return { ok: null, chain: 'solana', inconclusive: true, reason: 'Simulation timed out. Try again.' }; }

  const val = sim?.result?.value;
  if (!val) return { ok: null, chain: 'solana', inconclusive: true, reason: 'Simulation unavailable. Try again.' };
  if (val.err) return { ok: false, chain: 'solana', reason: friendlySolReason(val.err, val.logs), outAmount: Q.outAmount };
  return { ok: true, chain: 'solana', outAmount: Q.outAmount, unitsConsumed: val.unitsConsumed || null };
}

/**
 * Simulate a swap. Returns { ok: true|false|null, chain, reason?, ... }.
 *   ok:true  -> would execute.  ok:false -> would revert (reason set).
 *   ok:null  -> inconclusive (couldn't simulate; reason set).
 */
async function simulateSwap({ chainId, inputToken, outputToken, amount, userAddress, slippageBps }) {
  if (!chainId || !inputToken || !outputToken || !amount || !userAddress) {
    return { ok: null, inconclusive: true, reason: 'Missing trade parameters.' };
  }
  if (chainId === 'solana') return simulateSolana({ inputToken, outputToken, amount, userAddress, slippageBps });
  return simulateEvm({ chainId, inputToken, outputToken, amount, userAddress, slippageBps });
}

module.exports = { simulateSwap };
