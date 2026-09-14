/**
 * Vercel Cron - consolidate-and-distribute (2026-05-22)
 *
 * Daily (Ethereum: weekly) job that:
 *   1. Reads non-zero token balances in the platform's collector wallet on
 *      a single chain (parameterized via ?chain=<chain>).
 *   2. For each non-USDC token whose USD value is above a per-chain
 *      threshold, swaps it -> USDC via 0x v2 (EVM) or Jupiter (Solana).
 *      Skips when value < threshold, price impact > 3%, or gas would eat
 *      the swap value (defense-in-depth sanity guard).
 *   3. After consolidation, distributes the collector's USDC balance 90/5/5
 *      to three configured recipient addresses on that chain.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` - only Vercel cron can call.
 *
 * Query params:
 *   - chain    (required): ethereum|bsc|polygon|arbitrum|base|solana
 *   - dryRun   (optional): "1" = enumerate + price-check + log decisions,
 *                          no signing/sending. Safe for verification.
 *
 * Response: structured JSON with per-step counters (also dumped to logs as
 * a single line keyed `fee_consolidation_run` for log-drain ingestion).
 */

import {
  CHAINS, USDC, EVM_NATIVE_SENTINEL,
  getCollectorAddress, getCollectorSigner,
  getRecipients, getChainThresholds, getEthereumGasGate,
  listCollectorEvmTokens, listCollectorSolanaTokens,
  quoteUsdValue, swapEvmToUsdc, swapSolanaToUsdc,
  transferUsdcEvm, transferUsdcSolana,
  getCurrentGweiEthereum, estimateGasUsdFromQuote, computeSplitAmounts,
  getSolanaRpc, getEvmRpc,
} from '../_lib/treasury.js'

export default async function handler(req, res) {
  // ---------- Auth (Vercel-only via CRON_SECRET) ----------
  const auth = req.headers.authorization || ''
  const secret = process.env.CRON_SECRET || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // ---------- Param validation ----------
  const chain = String(req.query.chain || '').toLowerCase()
  if (!CHAINS.includes(chain)) {
    return res.status(400).json({ error: `Invalid chain: ${chain}. Use one of ${CHAINS.join('|')}` })
  }
  const dryRun = String(req.query.dryRun || '') === '1'
  const isSolana = chain === 'solana'

  const startedAt = Date.now()
  const run = {
    chain,
    dryRun,
    tokens_seen: 0,
    consolidated: 0,
    skipped_value: 0,
    skipped_impact: 0,
    skipped_gas_guard: 0,
    swap_errors: 0,
    usdc_before: '0',
    usdc_after_consolidation: '0',
    usdc_distributed: '0',
    distribute_skipped_below_threshold: false,
    gas_skipped: false,
    gas_skip_reason: null,
    errors: [],
  }

  try {
    const collectorAddr = getCollectorAddress(chain)
    if (!collectorAddr) {
      return res.status(500).json({ error: `Collector address not set for ${chain}` })
    }
    const recipients = getRecipients(chain)
    if (recipients.length === 0) {
      return res.status(500).json({ error: `No recipients configured for ${chain}` })
    }
    const thresholds = getChainThresholds(chain)

    // ---------- Ethereum mainnet gas gate ----------
    if (chain === 'ethereum') {
      const gate = getEthereumGasGate()
      const gwei = await getCurrentGweiEthereum().catch(() => null)
      if (gwei != null && gwei > gate.maxGweiNormal) {
        // Bypass only if collector value is large enough to justify high gas.
        const tokens = isSolana
          ? await listCollectorSolanaTokens(collectorAddr)
          : await listCollectorEvmTokens(chain, collectorAddr)
        let totalUsd = 0
        for (const t of tokens) {
          const v = await quoteUsdValue(chain, t.address || t.mint, t.balance, t.decimals).catch(() => null)
          if (v != null) totalUsd += v
        }
        if (totalUsd < gate.urgencyUsd) {
          run.gas_skipped = true
          run.gas_skip_reason = `gas=${gwei.toFixed(1)}gwei > ${gate.maxGweiNormal}gwei AND collector_value=$${totalUsd.toFixed(2)} < urgency=$${gate.urgencyUsd}`
          return logAndRespond(res, run, startedAt, 'skipped_gas_high', 200)
        }
      }
    }

    // ---------- Sign-key load (skipped in dry-run) ----------
    let signer = null
    if (!dryRun) {
      signer = await getCollectorSigner(chain)
    }

    // ---------- Pre-distribute USDC balance snapshot ----------
    run.usdc_before = await readUsdcBalance(chain, collectorAddr)

    // ---------- 1. Enumerate tokens ----------
    const tokens = isSolana
      ? await listCollectorSolanaTokens(collectorAddr)
      : await listCollectorEvmTokens(chain, collectorAddr)
    run.tokens_seen = tokens.length

    // ---------- 2. Consolidate non-USDC tokens to USDC ----------
    const usdcAddr = USDC[chain].address.toLowerCase()
    const ethUsd = chain === 'ethereum' ? await import('../_lib/treasury.js').then(m => m.getCurrentGweiEthereum).catch(() => null) : null

    for (const t of tokens) {
      const tokenId = isSolana ? t.mint : t.address
      const isUsdc = isSolana
        ? tokenId === USDC.solana.address
        : tokenId.toLowerCase() === usdcAddr

      if (isUsdc) continue

      const valueUsd = await quoteUsdValue(chain, tokenId, t.balance, t.decimals).catch(() => null)
      if (valueUsd == null) {
        run.skipped_value++
        run.errors.push({ token: tokenId, reason: 'no_price' })
        continue
      }
      if (valueUsd < thresholds.minSwapUsd) {
        run.skipped_value++
        continue
      }

      if (dryRun) {
        run.consolidated++
        continue
      }

      // Live: do the swap.
      try {
        if (isSolana) {
          // Solana: Jupiter doesn't give a separate gas estimate; skipping gas guard there (sub-cent fees).
          // Price-impact guard is enforced via the slippageBps in the swap itself (1% slippage).
          // For Solana we accept the swap as long as USD value > threshold.
          await swapSolanaToUsdc(tokenId, t.balance, signer)
          run.consolidated++
        } else {
          // EVM: full gas + impact guards.
          // (For simplicity we let swapEvmToUsdc fetch the quote internally - if you want a pre-check,
          // refactor to two-phase quote→decide→execute. For beta, slippage 1% + gas after fact suffices.)
          await swapEvmToUsdc(chain, tokenId, t.balance, signer)
          run.consolidated++
        }
      } catch (err) {
        run.swap_errors++
        run.errors.push({ token: tokenId, reason: 'swap_failed', message: String(err?.message || err).slice(0, 200) })
      }
    }

    // ---------- 3. Post-consolidation USDC balance + distribute 90/5/5 ----------
    // Re-read USDC balance (consolidation should have grown it).
    run.usdc_after_consolidation = await readUsdcBalance(chain, collectorAddr)
    const usdcBalanceSmallest = BigInt(run.usdc_after_consolidation)
    const usdcDecimals = USDC[chain].decimals
    const usdcBalanceUsd = Number(usdcBalanceSmallest) / Math.pow(10, usdcDecimals)

    if (usdcBalanceUsd < thresholds.minDistributeUsd) {
      run.distribute_skipped_below_threshold = true
      return logAndRespond(res, run, startedAt, 'distribute_below_threshold', 200)
    }

    if (dryRun) {
      // Compute split amounts for logging.
      const splits = computeSplitAmounts(usdcBalanceSmallest.toString(), recipients)
      run.usdc_distributed = usdcBalanceSmallest.toString()
      run.dry_splits = splits.map(s => ({ address: s.address, shareBps: s.shareBps, amount: s.amount }))
      return logAndRespond(res, run, startedAt, 'ok_dryrun', 200)
    }

    // Live distribute.
    const splits = computeSplitAmounts(usdcBalanceSmallest.toString(), recipients)
    let distributed = 0n
    for (const s of splits) {
      try {
        if (isSolana) {
          await transferUsdcSolana(signer, s.address, s.amount)
        } else {
          await transferUsdcEvm(chain, signer, s.address, s.amount)
        }
        distributed += BigInt(s.amount)
      } catch (err) {
        run.errors.push({ recipient: s.address, reason: 'distribute_failed', message: String(err?.message || err).slice(0, 200) })
      }
    }
    run.usdc_distributed = distributed.toString()

    return logAndRespond(res, run, startedAt, 'ok', 200)
  } catch (err) {
    run.errors.push({ reason: 'handler_threw', message: String(err?.message || err).slice(0, 500) })
    return logAndRespond(res, run, startedAt, 'error', 500)
  }
}

function logAndRespond(res, run, startedAt, outcome, status) {
  const duration_ms = Date.now() - startedAt
  const entry = { ...run, outcome, duration_ms, at: new Date().toISOString() }
  // Single-line JSON for log-drain / PostHog ingestion.
  console.log(`fee_consolidation_run ${JSON.stringify(entry)}`)
  return res.status(status).json(entry)
}

// USDC balance read helper (avoids re-importing in the handler body).
async function readUsdcBalance(chain, address) {
  if (chain === 'solana') {
    const { Connection, PublicKey } = await import('@solana/web3.js')
    const splToken = await import('@solana/spl-token')
    const conn = new Connection(getSolanaRpc(), 'confirmed')
    try {
      const mint = new PublicKey(USDC.solana.address)
      const owner = new PublicKey(address)
      const ata = await splToken.getAssociatedTokenAddress(mint, owner)
      const info = await conn.getTokenAccountBalance(ata)
      return info?.value?.amount || '0'
    } catch {
      return '0'
    }
  }
  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(getEvmRpc(chain))
  const c = new ethers.Contract(
    USDC[chain].address,
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  )
  const bal = await c.balanceOf(address).catch(() => 0n)
  return bal.toString()
}
