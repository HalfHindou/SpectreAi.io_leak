/**
 * Swap Routes
 * POST /api/swap/quote - Get swap quote from Jupiter (Solana) or 0x (EVM)
 * POST /api/swap/execute - Not used server-side; signing happens in the browser.
 *                          This endpoint logs the swap for analytics.
 *
 * Architecture:
 *   Frontend -> /api/swap/quote -> Server proxies to Jupiter/0x (hides API keys)
 *   Frontend gets unsigned tx -> signs with Privy wallet -> submits on-chain
 *   Frontend -> /api/swap/execute (POST) -> Server logs the completed swap
 */
const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { verifyPrivyToken } = require('../lib/auth');
const { simulateSwap } = require('../lib/swap-simulate-core');

// Reuse TLS connections to Jupiter/0x. node-fetch v2 rides the default
// global agent (keepAlive OFF), so every quote paid a fresh handshake -
// measured ~700ms cold vs ~300ms warm to api.0x.org. One shared agent
// removes that tax from every quote after the first.
const UPSTREAM_AGENT = new https.Agent({ keepAlive: true, maxSockets: 50 });

const router = express.Router();

const ZEROX_API_KEY = process.env.ZEROX_API_KEY || '';
// Official Jupiter Swap API. The free QuickNode mirror (public.jupiterapi.com)
// builds STALE Pump.fun AMM instructions - every pump.fun-routed swap failed
// on-chain with Jupiter error 6014 IncorrectTokenProgramID (verified by
// simulation 2026-07-06: mirror build fails, official build succeeds for the
// identical quote). lite-api.jup.ag is Jupiter's official free tier; set
// JUPITER_API_URL to the paid api.jup.ag base when volume needs it.
const JUPITER_API = process.env.JUPITER_API_URL || 'https://lite-api.jup.ag/swap/v1';
// Optional API key (portal.jup.ag). With JUPITER_API_URL=https://api.jup.ag/swap/v1
// this unlocks the paid tier: consistent ~100-200ms quotes vs lite-api's
// free-tier variance (occasional 1-3s spikes users feel as "Getting quote").
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';
const JUP_HEADERS = JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {};

// One bounded retry on TRANSIENT upstream failures - network-level errors
// (connection reset / DNS / timeout; node-fetch throws) and 5xx gateway blips.
// lite-api.jup.ag occasionally drops connections on the free tier; without a
// retry a single blip nulls the quote and strands the UI on "Get a quote
// first". HTTP 4xx never retries (real answer, not a blip).
const RETRYABLE_STATUS = new Set([502, 503, 504]);
async function fetchUpstream(url, opts) {
  const merged = String(url).startsWith('https:')
    ? { agent: UPSTREAM_AGENT, ...opts }
    : opts;
  try {
    const res = await fetch(url, merged);
    if (!RETRYABLE_STATUS.has(res.status)) return res;
    console.warn(`[swap] upstream ${res.status}, retrying once:`, String(url).slice(0, 120));
  } catch (err) {
    console.warn('[swap] upstream network error, retrying once:', err.message);
  }
  await new Promise((r) => setTimeout(r, 350));
  return fetch(url, merged);
}

// Load fee config
function loadFeeConfig() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'fee-config.json'), 'utf8'));
  } catch {
    cfg = { feeBps: 100, feeWallets: { primary: { evm: '', solana: '' } } };
  }
  // Env override for the collector addresses (dev parity with prod, which
  // reads COLLECTOR_*_ADDRESS from KV/env). Lets local fee-collection testing
  // set a collector without editing the checked-in JSON. Env wins when set.
  const envSol = process.env.COLLECTOR_SOL_ADDRESS || process.env.FEE_WALLET_PRIMARY_SOL || '';
  const envEvm = process.env.COLLECTOR_EVM_ADDRESS || process.env.FEE_WALLET_PRIMARY_EVM || '';
  if (envSol || envEvm) {
    cfg.feeWallets = cfg.feeWallets || {};
    cfg.feeWallets.primary = cfg.feeWallets.primary || {};
    if (envSol) cfg.feeWallets.primary.solana = envSol;
    if (envEvm) cfg.feeWallets.primary.evm = envEvm;
  }
  return cfg;
}

// 0x v2 API - single endpoint, chainId as query param
const ZEROX_API = 'https://api.0x.org';
const ZEROX_CHAIN_IDS = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  // Robinhood Chain (Arbitrum Orbit L2, mainnet 2026-07-01). 0x supports it at
  // launch on the same api.0x.org endpoint via the chainId param, so it needs
  // no special-casing beyond this entry - Uniswap-on-RH liquidity is routable.
  robinhood: 4663,
};
// Keep old name for the route check
const ZEROX_CHAINS = ZEROX_CHAIN_IDS;

// -------------------------------------------------------
// POST /api/swap/quote
// Body: { chainId, inputToken, outputToken, amount, slippageBps, userAddress }
// chainId: 'ethereum' | 'bsc' | 'polygon' | 'arbitrum' | 'base' | 'solana'
// -------------------------------------------------------
// Max allowed slippage in basis points (5% = 500 bps). Anything higher is almost
// always a MEV-sandwich footgun, so we clamp server-side regardless of client input.
const MAX_SLIPPAGE_BPS = 500;
const MIN_SLIPPAGE_BPS = 1;

function clampSlippage(input) {
  const raw = Number(input);
  if (!Number.isFinite(raw)) return 50;
  return Math.min(Math.max(Math.floor(raw), MIN_SLIPPAGE_BPS), MAX_SLIPPAGE_BPS);
}

// Server-side hard ceiling on price impact (percent). Client warns at 5%; this
// is a higher backstop so a direct API caller cannot pull a quote for a
// catastrophic-impact trade. Kept in sync with the Vercel swap handlers.
const MAX_PRICE_IMPACT_PCT = 15;

// Amounts are base units (wei / lamports). Validate as a positive integer
// STRING - never via Number (18-decimal amounts overflow MAX_SAFE_INTEGER).
function isValidBaseUnitAmount(amount) {
  if (amount === null || amount === undefined) return false;
  const s = String(amount).trim();
  if (!/^\d+$/.test(s)) return false;
  try { return BigInt(s) > 0n; } catch { return false; }
}

router.post('/quote', async (req, res) => {
  try {
    const { chainId, inputToken, outputToken, amount, userAddress } = req.body;
    const slippageBps = clampSlippage(req.body?.slippageBps ?? 50);

    if (!chainId || !inputToken || !outputToken || !amount) {
      return res.status(400).json({ error: 'Missing required fields: chainId, inputToken, outputToken, amount' });
    }

    // Validate amount server-side (L5).
    if (!isValidBaseUnitAmount(amount)) {
      return res.status(400).json({ error: 'Invalid amount: must be a positive integer in base units' });
    }

    const feeConfig = loadFeeConfig();

    if (chainId === 'solana') {
      return await handleJupiterQuote(req, res, { inputToken, outputToken, amount, slippageBps, userAddress, feeConfig });
    }

    if (ZEROX_CHAINS[chainId]) {
      return await handleZeroxQuote(req, res, { chainId, inputToken, outputToken, amount, slippageBps, userAddress, feeConfig });
    }

    return res.status(400).json({ error: `Unsupported chain: ${chainId}` });
  } catch (err) {
    console.error('[swap/quote] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/swap/simulate - dry-run the trade (no signature, no gas) and report
// whether it would execute, revert (with a reason), or is inconclusive. Powers
// the swap panel's pre-trade safety check. Public (same as /quote); per-wallet
// so never cached.
router.post('/simulate', async (req, res) => {
  try {
    const { chainId, inputToken, outputToken, amount, userAddress } = req.body || {};
    const slippageBps = clampSlippage(req.body?.slippageBps ?? 50);
    if (!chainId || !inputToken || !outputToken || !amount || !userAddress) {
      return res.status(400).json({ error: 'Missing required fields: chainId, inputToken, outputToken, amount, userAddress' });
    }
    if (!isValidBaseUnitAmount(amount)) {
      return res.status(400).json({ error: 'Invalid amount: must be a positive integer in base units' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    const result = await simulateSwap({ chainId, inputToken, outputToken, amount, userAddress, slippageBps });
    return res.json(result);
  } catch (err) {
    console.error('[swap/simulate] Error:', err.message);
    // Never fail hard - the caller degrades to "couldn't simulate".
    return res.status(200).json({ ok: null, inconclusive: true, reason: 'Simulation error. Try again.' });
  }
});

// -------------------------------------------------------
// Jupiter fee account resolution
// -------------------------------------------------------
// Jupiter's `feeAccount` must be an INITIALIZED SPL token account for the
// quote's output mint. A raw fee WALLET address does not error - Jupiter
// silently OMITS the fee (verified 2026-07-06: the wallet key was absent
// from the built tx's account list). Derive the fee wallet's ATA for the
// mint and use it ONLY when it exists on-chain; otherwise skip fee params
// so a missing ATA never fails a swap. Mirror of apps/trading/api/swap.js.
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SOLANA_RPC_JUP = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const _feeAtaCache = new Map(); // `${wallet}:${mint}` -> { ata: string|null, expires }

async function resolveJupiterFeeAccount(feeWallet, mint) {
  if (!feeWallet || !mint) return null;
  const cacheKey = `${feeWallet}:${mint}`;
  const hit = _feeAtaCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.ata;
  try {
    // @solana/web3.js resolves from the workspace root (apps depend on it).
    // If unavailable in a stripped server deploy, fees are skipped (logged).
    const { PublicKey, Connection } = require('@solana/web3.js');
    const [ata] = PublicKey.findProgramAddressSync(
      [
        new PublicKey(feeWallet).toBuffer(),
        new PublicKey(SPL_TOKEN_PROGRAM_ID).toBuffer(),
        new PublicKey(mint).toBuffer(),
      ],
      new PublicKey(SPL_ATA_PROGRAM_ID),
    );
    const conn = new Connection(SOLANA_RPC_JUP, 'confirmed');
    const info = await conn.getAccountInfo(ata);
    const initialized = !!info && info.owner && info.owner.toBase58() === SPL_TOKEN_PROGRAM_ID;
    const result = initialized ? ata.toBase58() : null;
    _feeAtaCache.set(cacheKey, { ata: result, expires: Date.now() + (initialized ? 3600000 : 300000) });
    return result;
  } catch (err) {
    console.warn('[swap] Jupiter fee ATA resolve failed:', err.message);
    return null;
  }
}

const WSOL_MINT_STR = 'So11111111111111111111111111111111111111112';

// The 90/5/5 SOL fee recipients. Prefers the 3 env recipients (same vars the
// distribute cron uses), else falls back to the 3 feeWallets in the config.
function getSolFeeRecipients(feeConfig) {
  const env3 = [
    { address: process.env.FEE_RECIPIENT_SOL_PRIMARY, shareBps: 9000 },
    { address: process.env.FEE_RECIPIENT_SOL_SECONDARY, shareBps: 500 },
    { address: process.env.FEE_RECIPIENT_SOL_TERTIARY, shareBps: 500 },
  ].filter((r) => r.address);
  if (env3.length === 3) return env3;
  const fw = feeConfig.feeWallets || {};
  const cfg = [
    { address: fw.primary?.solana, shareBps: Math.round((fw.primary?.share ?? 90) * 100) },
    { address: fw.secondary?.solana, shareBps: Math.round((fw.secondary?.share ?? 5) * 100) },
    { address: fw.tertiary?.solana, shareBps: Math.round((fw.tertiary?.share ?? 5) * 100) },
  ].filter((r) => r.address);
  return cfg;
}

// Split a lamport total by shareBps; last recipient gets the remainder.
function splitFeeLamports(total, recipients) {
  const t = BigInt(total);
  let assigned = 0n;
  return recipients.map((r, i) => {
    if (i === recipients.length - 1) return { address: r.address, lamports: t - assigned };
    const part = (t * BigInt(r.shareBps)) / 10000n;
    assigned += part;
    return { address: r.address, lamports: part };
  });
}

// Every recipient must ALREADY be rent-exempt, else a sub-rent fee transfer to
// a fresh account reverts the whole swap on-chain (InsufficientFundsForRent).
// Prod recipients are funded platform wallets; this only guards a misconfig -
// fall back feeless rather than break the trade. Cached 10min per recipient set.
const RENT_EXEMPT_MIN_LAMPORTS = 900000;
const _recipientsFundedCache = new Map();
async function recipientsAreFunded(conn, recipients, PublicKey) {
  const key = recipients.map((r) => r.address).join(',');
  const hit = _recipientsFundedCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.ok;
  try {
    const infos = await conn.getMultipleAccountsInfo(recipients.map((r) => new PublicKey(r.address)));
    const ok = infos.every((i) => i && i.lamports >= RENT_EXEMPT_MIN_LAMPORTS);
    _recipientsFundedCache.set(key, { ok, expires: Date.now() + 600000 });
    return ok;
  } catch {
    return false;
  }
}

// Build a Solana swap tx that collects the platform fee as OUR OWN SOL
// transfers (90/5/5) - route-agnostic, so it works on Pump.fun where Jupiter's
// built-in platformFee 6014s. Uses /swap-instructions + recompiles a v0 tx with
// the fee transfers appended (proven by scripts/proto-fee-swap.mjs). Returns
// { swapTransaction (base64), lastValidBlockHeight } or null on any failure
// (caller falls back to a feeless /swap so a trade is never blocked).
async function buildJupiterSwapWithFees({ quoteData, userAddress, feeLamports, recipients, slippageBps }) {
  try {
    const { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram } = require('@solana/web3.js');
    const siRes = await fetchUpstream(`${JUPITER_API}/swap-instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...JUP_HEADERS },
      body: JSON.stringify({ quoteResponse: quoteData, userPublicKey: userAddress, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: { maxBps: slippageBps } }),
    });
    if (!siRes.ok) return null;
    const si = await siRes.json();
    if (si.error || !si.swapInstruction) return null;

    const user = new PublicKey(userAddress);
    const de = (ix) => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: (ix.accounts || []).map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
      data: Buffer.from(ix.data, 'base64'),
    });
    const ixs = [];
    (si.computeBudgetInstructions || []).forEach((i) => ixs.push(de(i)));
    (si.setupInstructions || []).forEach((i) => ixs.push(de(i)));
    ixs.push(de(si.swapInstruction));
    if (si.cleanupInstruction) ixs.push(de(si.cleanupInstruction));
    for (const s of splitFeeLamports(feeLamports, recipients)) {
      if (s.lamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(s.address), lamports: s.lamports }));
    }

    const conn = new Connection(SOLANA_RPC_JUP, 'confirmed');
    // Fetch the funded-check, ALL address-lookup-tables, and the blockhash in
    // PARALLEL. These were sequential (1 + N + 1 RPC round-trips), each ALT
    // fetched one-at-a-time - the entire reason the fee-bearing Solana build
    // took seconds on a slow RPC.
    const altAddrs = si.addressLookupTableAddresses || [];
    const [funded, altResults, latest] = await Promise.all([
      recipientsAreFunded(conn, recipients, PublicKey),
      Promise.all(altAddrs.map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value).catch(() => null))),
      conn.getLatestBlockhash(),
    ]);
    // Fail-safe: skip fee collection (feeless) if any recipient is underfunded.
    if (!funded) {
      console.warn('[swap] a fee recipient is not rent-exempt - building feeless to protect the trade');
      return null;
    }
    const alts = altResults.filter(Boolean);
    const { blockhash, lastValidBlockHeight } = latest;
    const msg = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts);
    const tx = new VersionedTransaction(msg);
    return { swapTransaction: Buffer.from(tx.serialize()).toString('base64'), lastValidBlockHeight };
  } catch (err) {
    console.warn('[swap] buildJupiterSwapWithFees failed, falling back feeless:', err.message);
    return null;
  }
}

// -------------------------------------------------------
// Jupiter (Solana) quote
// -------------------------------------------------------
async function handleJupiterQuote(req, res, { inputToken, outputToken, amount, slippageBps, userAddress, feeConfig }) {
  const feeBps = feeConfig.feeBps || 100;

  // Jupiter has no 'native' sentinel - native SOL trades as WRAPPED SOL
  // (wrapAndUnwrapSol on the swap build wraps/unwraps automatically). The
  // client sends 'native' for the pay/receive side (same convention as the
  // EVM path); map it to the wSOL mint here. Response echoes the ORIGINAL
  // values so the client's stale-quote guard (inputToken === payToken.address)
  // keeps matching.
  const WSOL_MINT = 'So11111111111111111111111111111111111111112';
  const inputMint = inputToken === 'native' ? WSOL_MINT : inputToken;
  const outputMint = outputToken === 'native' ? WSOL_MINT : outputToken;

  // Build Jupiter quote URL
  const params = new URLSearchParams({
    inputMint: inputMint,
    outputMint: outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  });

  // Fee is collected via OUR OWN 90/5/5 SOL transfers appended to the swap tx
  // (buildJupiterSwapWithFees) - NOT Jupiter's platformFee, which 6014s on
  // Pump.fun routes. So the QUOTE stays feeless (no platformFeeBps).
  const feeRecipients = getSolFeeRecipients(feeConfig);

  const quoteUrl = `${JUPITER_API}/quote?${params}`;
  console.log('[swap/quote] Jupiter URL:', quoteUrl);

  const quoteRes = await fetchUpstream(quoteUrl, { headers: JUP_HEADERS });
  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    console.error('[swap/quote] Jupiter quote error:', errText);
    return res.status(quoteRes.status).json({ error: 'Jupiter quote failed', details: errText });
  }

  const quoteData = await quoteRes.json();

  // Price-impact backstop (L6). Jupiter priceImpactPct is a decimal fraction.
  const jupImpactPct = Math.abs(parseFloat(quoteData.priceImpactPct || '0')) * 100;
  if (Number.isFinite(jupImpactPct) && jupImpactPct > MAX_PRICE_IMPACT_PCT) {
    return res.status(422).json({ error: `Price impact too high (${jupImpactPct.toFixed(1)}%). Trade refused.`, priceImpactPct: quoteData.priceImpactPct });
  }

  // If user address provided, build the swap transaction.
  if (userAddress) {
    // Fee = feeBps of the SOL leg (buy: input SOL; sell: output SOL). Only
    // SOL-paired trades collect; token<->token (no SOL leg) stays feeless.
    let feeLamports = 0n;
    if (inputMint === WSOL_MINT_STR) feeLamports = (BigInt(quoteData.inAmount) * BigInt(feeBps)) / 10000n;
    else if (outputMint === WSOL_MINT_STR) feeLamports = (BigInt(quoteData.outAmount) * BigInt(feeBps)) / 10000n;

    let swapTransaction = null;
    let lastValidBlockHeight = null;
    let feeCollected = false;

    // Preferred path: collect via our own 90/5/5 SOL transfers (route-agnostic,
    // works on Pump.fun). Falls back to feeless /swap on any failure.
    if (feeRecipients.length > 0 && feeLamports > 0n) {
      const built = await buildJupiterSwapWithFees({ quoteData, userAddress, feeLamports, recipients: feeRecipients, slippageBps });
      if (built) {
        swapTransaction = built.swapTransaction;
        lastValidBlockHeight = built.lastValidBlockHeight;
        feeCollected = true;
      }
    }

    // Feeless build (no recipients, non-SOL pair, or the fee build failed).
    if (!swapTransaction) {
      const swapRes = await fetchUpstream(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...JUP_HEADERS },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: userAddress,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
          dynamicSlippage: { maxBps: slippageBps },
        }),
      });
      if (!swapRes.ok) {
        const errText = await swapRes.text();
        console.error('[swap/quote] Jupiter swap error:', errText);
        return res.status(swapRes.status).json({ error: 'Jupiter swap tx failed', details: errText });
      }
      const swapData = await swapRes.json();
      swapTransaction = swapData.swapTransaction;
      lastValidBlockHeight = swapData.lastValidBlockHeight;
    }

    return res.json({
      provider: 'jupiter',
      chain: 'solana',
      inputToken,
      outputToken,
      inputAmount: quoteData.inAmount,
      outputAmount: quoteData.outAmount,
      otherAmountThreshold: quoteData.otherAmountThreshold,
      priceImpactPct: quoteData.priceImpactPct,
      platformFee: feeCollected ? {
        percentage: feeConfig.feePercentage || 1.0,
        bps: feeBps,
        lamports: feeLamports.toString(),
        recipients: feeRecipients.map((r) => ({ address: r.address, shareBps: r.shareBps })),
      } : null,
      routePlan: quoteData.routePlan?.map(r => ({
        swapInfo: { label: r.swapInfo?.label },
        percent: r.percent,
      })),
      swapTransaction,
      lastValidBlockHeight,
    });
  }

  // Quote only (no transaction) - for preview. Fee is applied only on the
  // swap-build path (our own SOL transfers), so a preview quote has no fee.
  return res.json({
    provider: 'jupiter',
    chain: 'solana',
    inputToken,
    outputToken,
    inputAmount: quoteData.inAmount,
    outputAmount: quoteData.outAmount,
    otherAmountThreshold: quoteData.otherAmountThreshold,
    priceImpactPct: quoteData.priceImpactPct,
    platformFee: null,
    routePlan: quoteData.routePlan?.map(r => ({
      swapInfo: { label: r.swapInfo?.label },
      percent: r.percent,
    })),
  });
}

// Stablecoins per chain - the fee falls back to these when NEITHER leg is
// native (e.g. a USDC-paid buy or a sell into USDC).
const FEE_STABLES = {
  1: new Set(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0x6b175474e89094c44da98b954eedeac495271d0f']),
  8453: new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']),
  42161: new Set(['0xaf88d065e77c8cc2239327c5edb3a432268e5831', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9']),
  56: new Set(['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0x55d398326f99059ff775485246999027b3197955']),
  137: new Set(['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', '0xc2132d05d31c914a87c6611c10748aecb1b4c07d']),
};

// Pick which token the 1% platform fee is taken in. 0x requires it to be the
// sell OR buy token, so we choose the LIQUID / base leg and never the (often
// dead-within-hours) memecoin - the EVM parallel to collecting SOL on Solana:
//   1. native ETH if either leg is native (every ETH buy/sell) - verified 0x
//      accepts the native sentinel and returns the fee in ETH.
//   2. else whichever leg is a known stable (USDC/USDT/DAI).
//   3. else the sell (input) token - only reached on a rare token->token route.
function pickFeeToken(sellToken, buyToken, numericChainId, nativeToken) {
  const s = sellToken.toLowerCase(), b = buyToken.toLowerCase(), n = nativeToken.toLowerCase();
  if (s === n || b === n) return nativeToken;
  const stables = FEE_STABLES[numericChainId];
  if (stables) { if (stables.has(b)) return buyToken; if (stables.has(s)) return sellToken; }
  return sellToken;
}

// -------------------------------------------------------
// 0x (EVM chains) quote
// -------------------------------------------------------
async function handleZeroxQuote(req, res, { chainId, inputToken, outputToken, amount, slippageBps, userAddress, feeConfig }) {
  const numericChainId = ZEROX_CHAIN_IDS[chainId];
  if (!numericChainId) return res.status(400).json({ error: `Unsupported EVM chain: ${chainId}` });

  const feeRecipient = feeConfig.feeWallets?.primary?.evm || '';

  const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
  const sellToken = inputToken === 'native' ? NATIVE_TOKEN : inputToken;
  const buyToken = outputToken === 'native' ? NATIVE_TOKEN : outputToken;

  // 0x v2 uses a single endpoint with chainId as query param
  const params = new URLSearchParams({
    sellToken,
    buyToken,
    sellAmount: amount.toString(),
    chainId: numericChainId.toString(),
  });
  if (userAddress) params.set('taker', userAddress);

  if (slippageBps) {
    params.set('slippageBps', slippageBps.toString());
  }

  // Affiliate fee injection (parity with the serverless handler's
  // GATE-BLOCKER 1 fix): without these three params 0x charges no platform
  // fee - the swap completes but the collector wallet receives nothing.
  // Fee is taken in the LIQUID leg (native ETH / stable), NOT the output
  // memecoin - so we collect real value that doesn't evaporate before the
  // distribution sweep (the EVM parallel to collecting SOL on Solana).
  // Skipped when no recipient is configured so keyless local dev still works.
  const zxFeeBps = feeConfig.feeBps || 100;
  if (feeRecipient) {
    params.set('swapFeeRecipient', feeRecipient);
    params.set('swapFeeBps', zxFeeBps.toString());
    params.set('swapFeeToken', pickFeeToken(sellToken, buyToken, numericChainId, NATIVE_TOKEN));
  }

  // No wallet yet = a DISPLAY quote: use 0x's /price endpoint (indicative,
  // faster, no calldata) instead of /quote with a placeholder taker that
  // generated permit2 payloads nobody could ever sign. The executable
  // /quote path is used the moment a real taker exists, and the client
  // self-heals a tx-less quote at click time by re-quoting with the wallet.
  const zxEndpoint = userAddress ? 'quote' : 'price';
  const quoteUrl = `${ZEROX_API}/swap/permit2/${zxEndpoint}?${params}`;
  console.log('[swap/quote] 0x v2 URL:', quoteUrl);

  const headers = {
    '0x-api-key': ZEROX_API_KEY,
    '0x-version': 'v2',
  };
  const quoteRes = await fetchUpstream(quoteUrl, { headers });

  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    console.error('[swap/quote] 0x v2 quote error:', quoteRes.status, errText);
    return res.status(quoteRes.status).json({ error: '0x quote failed', details: errText });
  }

  const quoteData = await quoteRes.json();

  // Price-impact backstop (L6). 0x estimatedPriceImpact is a percent string and
  // can be null on v2 - only enforce when present.
  const zxImpactPct = Math.abs(parseFloat(quoteData.estimatedPriceImpact));
  if (Number.isFinite(zxImpactPct) && zxImpactPct > MAX_PRICE_IMPACT_PCT) {
    return res.status(422).json({ error: `Price impact too high (${zxImpactPct.toFixed(1)}%). Trade refused.`, estimatedPriceImpact: quoteData.estimatedPriceImpact });
  }

  // Settlement-target sanity guard (parity with the serverless N1 check):
  // the `to` must be a well-formed non-zero address that is NOT one of the
  // swap's own token contracts - a router is never the token. Defense in
  // depth against a tampered upstream response; the client also verifies
  // spender===tx.to at signing time.
  const zxTxTo = quoteData.transaction?.to;
  if (zxTxTo) {
    const to = String(zxTxTo).toLowerCase();
    const isAddr = /^0x[a-f0-9]{40}$/.test(to);
    const isZero = to === '0x0000000000000000000000000000000000000000';
    const isTokenAddr = to === String(sellToken).toLowerCase() || to === String(buyToken).toLowerCase();
    if (!isAddr || isZero || isTokenAddr) {
      console.error('[swap] 0x quote rejected: suspicious settlement target', { to, chainId });
      return res.status(502).json({ error: 'Swap route validation failed. Trade refused.' });
    }
  }

  return res.json({
    provider: '0x',
    chain: chainId,
    inputToken: sellToken,
    outputToken: buyToken,
    inputAmount: quoteData.sellAmount,
    outputAmount: quoteData.buyAmount,
    estimatedPriceImpact: quoteData.estimatedPriceImpact,
    totalNetworkFee: quoteData.totalNetworkFee,
    platformFee: {
      percentage: feeConfig.feePercentage || 1.0,
      bps: feeConfig.feeBps || 100,
      recipient: feeRecipient,
    },
    route: quoteData.route,
    transaction: quoteData.transaction ? {
      to: quoteData.transaction.to,
      data: quoteData.transaction.data,
      value: quoteData.transaction.value,
      gas: quoteData.transaction.gas,
      gasPrice: quoteData.transaction.gasPrice,
    } : null,
    permit2: quoteData.permit2 || null,
  });
}

// In-memory swap log for LOCAL DEV ONLY (production uses Vercel KV).
// Keyed by a cryptographically verified Privy userId.
const swapHistory = new Map(); // userId -> [entries]

function redactAddr(addr) {
  if (!addr || typeof addr !== 'string' || addr.length < 10) return '****';
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

// EVM: 0x + 64 hex. Solana: base58, 87-88 chars (signature length).
const TX_HASH_RE = /^(?:0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{87,88})$/;

// Strip CR/LF so user-controlled fields can't forge log lines in aggregators.
function safeLog(s) {
  if (typeof s !== 'string') return String(s);
  return s.replace(/[\r\n]+/g, ' ').slice(0, 200);
}

// -------------------------------------------------------
// POST /api/swap/log - Log a completed swap (analytics + history)
// -------------------------------------------------------
router.post('/log', async (req, res) => {
  // Order-engine internal branch (prod-parity): onBehalfOf must match the
  // owner of the referenced order doc so a leaked key cannot attribute
  // history to arbitrary DIDs; dev skips on-chain verify like the user
  // path does.
  let userId = null;
  const internalHeader = req.headers['x-spectre-internal'];
  const internalKey = process.env.ORDER_ENGINE_INTERNAL_KEY;
  if (internalHeader && internalKey) {
    const { timingSafeEqual } = require('crypto');
    const a = Buffer.from(String(internalHeader));
    const b = Buffer.from(String(internalKey));
    const bodyDid = req.body?.onBehalfOf;
    const orderId = req.body?.orderId;
    if (a.length === b.length && timingSafeEqual(a, b) &&
        typeof bodyDid === 'string' && bodyDid.startsWith('did:privy:') &&
        typeof orderId === 'string' && orderId.length <= 64) {
      try {
        const ordersCore = require('../lib/agent-orders-core');
        const orderDoc = await ordersCore.getOrder(orderId);
        if (orderDoc && orderDoc.owner === bodyDid) userId = bodyDid;
      } catch { /* fall through to JWT */ }
    }
  }
  if (!userId) {
    userId = await verifyPrivyToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  }

  const { chainId, txHash, inputToken, outputToken, inputAmount, outputAmount, feeAmount, userAddress } = req.body || {};
  if (typeof txHash !== 'string' || !TX_HASH_RE.test(txHash)) {
    return res.status(400).json({ error: 'Invalid txHash' });
  }
  console.log(`[swap/log] ${safeLog(chainId)} tx=${txHash} ${safeLog(inputAmount)} ${safeLog(inputToken)} -> ${safeLog(outputAmount)} ${safeLog(outputToken)} fee=${safeLog(feeAmount)} user=${redactAddr(userAddress)}`);

  // Display metadata for the history UI (bounded + type-checked - user-supplied).
  const b = req.body || {};
  const clampSym = (s) => (typeof s === 'string' ? s.slice(0, 16) : null);
  const clampDec = (d) => (Number.isFinite(Number(d)) && Number(d) >= 0 && Number(d) <= 36 ? Number(d) : null);
  const clampLogo = (u) => (typeof u === 'string' && /^(https?:|data:image\/)/.test(u) ? u.slice(0, 512) : null);
  const entry = {
    chainId, txHash, inputToken, outputToken, inputAmount, outputAmount,
    side: b.side === 'sell' ? 'sell' : b.side === 'buy' ? 'buy' : null,
    inputSymbol: clampSym(b.inputSymbol),
    outputSymbol: clampSym(b.outputSymbol),
    inputDecimals: clampDec(b.inputDecimals),
    outputDecimals: clampDec(b.outputDecimals),
    inputLogo: clampLogo(b.inputLogo),
    outputLogo: clampLogo(b.outputLogo),
    tokenSymbol: clampSym(b.tokenSymbol),
    usd: Number.isFinite(Number(b.usd)) ? Number(b.usd) : null,
    timestamp: new Date().toISOString(),
  };
  if (!swapHistory.has(userId)) swapHistory.set(userId, []);
  const list = swapHistory.get(userId);
  list.unshift(entry);
  if (list.length > 200) list.length = 200;

  res.json({ ok: true });
});

// -------------------------------------------------------
// POST /api/swap/withdraw-log - Log a completed withdrawal (dev parity with
// the Vercel handler's signer-verified version; dev skips on-chain verify)
// -------------------------------------------------------
router.post('/withdraw-log', async (req, res) => {
  const userId = await verifyPrivyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { chainId, txHash, token, amount, toAddress } = req.body || {};
  if (typeof txHash !== 'string' || !TX_HASH_RE.test(txHash)) {
    return res.status(400).json({ error: 'Invalid txHash' });
  }
  console.log(`[withdraw/log] ${safeLog(chainId)} tx=${txHash} ${safeLog(token)} -> ${redactAddr(toAddress)}`);

  const entry = {
    type: 'withdraw', chainId, txHash,
    inputToken: token, outputToken: 'withdrawal',
    inputAmount: amount, outputAmount: '',
    toAddress, timestamp: new Date().toISOString(),
  };
  if (!swapHistory.has(userId)) swapHistory.set(userId, []);
  const wlist = swapHistory.get(userId);
  wlist.unshift(entry);
  if (wlist.length > 200) wlist.length = 200;

  res.json({ ok: true });
});

// -------------------------------------------------------
// GET /api/swap/history - Fetch swap history for authenticated user
// -------------------------------------------------------
router.get('/history', async (req, res) => {
  const userId = await verifyPrivyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  const list = swapHistory.get(userId) || [];

  return res.json({ swaps: list.slice(offset, offset + limit), limit, offset });
});

module.exports = router;
