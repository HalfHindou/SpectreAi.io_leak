/**
 * Execution pipeline - the only place engine code moves money, and every
 * step is a gate:
 *
 *   fresh KV re-read -> kill switch -> exec slot (SET NX) -> delegated:true
 *   recheck -> guards (token-tax, liquidity floor + pool-notional cap,
 *   REAL-USD daily/spend caps) -> INTERNAL /api/swap/quote (fees baked -
 *   the engine NEVER quotes Jupiter direct) -> impact ceiling -> STATUS
 *   RE-READ (a user cancel landing during the gates wins) -> Privy TEE
 *   sign+send -> confirm poll -> /api/swap/log (internal branch, on-chain
 *   verification stays on) -> order update + inbox notify.
 *
 * RETRY POLICY (double-spend safety): a fresh-quote retry happens ONLY for
 * failures that provably occurred BEFORE any broadcast (quote errors,
 * pre-broadcast Privy API rejections). Once a sign call has been
 * DISPATCHED, an unknown outcome (confirm timeout, lost response) STOPS
 * the pipeline and flags the order for review - never a second signature
 * while the first's fate is unknown.
 *
 * USD caps are enforced against the ACTUAL native spend valued at the
 * live native price - never against the client/LLM-supplied capUsd alone.
 *
 * Log lines carry NO amounts (repo privacy convention) - amounts live in
 * the KV order doc and swap history only.
 */
const store = require('./store')
const privy = require('./privy')

const APP_BASE = process.env.APP_BASE || 'https://spectre-trading.vercel.app'
const INTERNAL_KEY = process.env.ORDER_ENGINE_INTERNAL_KEY || ''
const SOLANA_RPC = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const DRY_RUN = /^(1|true|on)$/i.test(process.env.ORDER_ENGINE_DRY_RUN || '')

const DAILY_VOLUME_CAP_USD = Number(process.env.ORDER_ENGINE_DAILY_CAP_USD) || 2000
const MIN_LIQUIDITY_USD = 10_000
const MAX_POOL_FRACTION = 0.02
const MAX_IMPACT_PCT = 5
const MAX_QUOTE_ATTEMPTS = 2
const TRANCHE_CAP_SLACK = 1.1 // 10% price-drift headroom on the per-tranche USD cap

function log(event, fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

async function internalPost(path, body) {
  const res = await fetch(`${APP_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-spectre-internal': INTERNAL_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const json = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, json }
}

function parseImpactPct(quote) {
  const raw = quote?.priceImpactPct ?? quote?.estimatedPriceImpact
  if (raw == null) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const abs = Math.abs(n)
  if (quote?.provider === 'jupiter') return abs * 100
  if (quote?.provider === '0x') return abs
  return abs < 1 ? abs * 100 : abs
}

// Native (SOL) USD price for real-value cap enforcement. 60s cache; both
// the prod and dev app paths are cheap cached endpoints.
let _nativePrice = { usd: null, ts: 0 }
async function nativePriceUsd() {
  if (_nativePrice.usd && Date.now() - _nativePrice.ts < 60_000) return _nativePrice.usd
  try {
    // /api/tokens/prices -> /api/codex?action=prices is auth-gated; the engine
    // authenticates with the internal key (codex honors it). Without this the
    // SOL price 401s -> null -> the native_price_unavailable guard blocks EVERY
    // order (the trade can't be USD-valued for the caps). Found 2026-07-12.
    const res = await fetch(`${APP_BASE}/api/tokens/prices?symbols=SOL`, { headers: INTERNAL_KEY ? { 'x-spectre-internal': INTERNAL_KEY } : {}, signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const j = await res.json()
      const p = Number(j?.SOL?.price)
      if (p > 0) { _nativePrice = { usd: p, ts: Date.now() }; return p }
    }
  } catch { /* fall through */ }
  return _nativePrice.usd // possibly stale, possibly null - caller decides
}

async function confirmSolana(signature, timeoutMs = 90_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[signature], { searchTransactionHistory: true }] }),
        signal: AbortSignal.timeout(6000),
      })
      const j = await res.json()
      const st = j?.result?.value?.[0]
      if (st) {
        if (st.err) return { confirmed: false, failed: true, error: JSON.stringify(st.err).slice(0, 200) }
        if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return { confirmed: true }
      }
    } catch { /* poll again */ }
    await new Promise((r) => setTimeout(r, 2500))
  }
  return { confirmed: false, failed: false, error: 'confirmation timeout' }
}

/**
 * Execute one fired order (or one DCA tranche). Never throws - always
 * records the outcome on the order doc.
 * @param {object} extras - { tranche, metricNow, supplyUsed, supplySource,
 *                            priceUsd, liquidity } from the evaluator/feed.
 */
async function execute(orderId, { tranche = 0, metricNow, supplyUsed, supplySource, priceUsd, liquidity } = {}) {
  // 1. Fresh re-read (the evaluator worked from a scan snapshot).
  let order = await store.getOrder(orderId)
  if (!order || !store.OPEN_STATUSES.has(order.status)) return { skipped: 'not_open' }
  if (await store.killSwitchOn()) { log('guard_block', { orderId, guard: 'killswitch' }); return { skipped: 'killswitch' } }

  // 2. Atomic slot - one execution per order+tranche across restarts.
  if (!(await store.claimExecSlot(orderId, tranche))) return { skipped: 'slot_taken' }

  try {
    // 3. Revocation recheck before any signing intent.
    const deleg = await privy.verifyStillDelegated({ userId: order.owner, walletAddress: order.walletAddress })
    if (!deleg.ok) {
      order.status = 'cancelled'
      order = await store.saveOrder(order, { audit: { event: 'auto_cancelled', reason: deleg.reason } })
      await store.pushInbox(order.owner, { type: 'order_cancelled', orderId, summary: `Order cancelled: ${deleg.reason === 'signer_revoked' ? 'automation permission was revoked' : deleg.reason}` })
      return { cancelled: deleg.reason }
    }
    const walletId = order.walletId || deleg.walletId
    if (!walletId) {
      order.status = 'failed'
      await store.saveOrder(order, { audit: { event: 'failed', reason: 'no wallet id' } })
      return { failed: 'no_wallet_id' }
    }

    // 4. Security guard (honeypot/sell-tax; Solana nulls do not block).
    try {
      const taxRes = await fetch(`${APP_BASE}/api/token-tax?address=${encodeURIComponent(order.token.address)}&networkId=${order.token.networkId}`, { headers: INTERNAL_KEY ? { 'x-spectre-internal': INTERNAL_KEY } : {}, signal: AbortSignal.timeout(6000) })
      if (taxRes.ok) {
        const tax = await taxRes.json()
        if (tax?.isHoneypot === true || Number(tax?.sellTax) > 25) {
          order.status = 'failed'
          await store.saveOrder(order, { audit: { event: 'guard_block', guard: 'token_tax', detail: tax?.isHoneypot ? 'honeypot' : `sellTax ${tax.sellTax}` } })
          await store.pushInbox(order.owner, { type: 'order_failed', orderId, summary: 'Order blocked: token failed the security check at execution time' })
          return { failed: 'token_tax' }
        }
      }
    } catch { log('guard_soft_fail', { orderId, guard: 'token_tax' }) }

    // 5. REAL-USD valuation of this tranche: actual native amount x live
    // native price. Refuse to execute blind when the native price is
    // unknown - the caps would be unenforceable.
    const amountNative = trancheAmountNative(order)
    // USD value of THIS trade for the caps. A BUY spends `amount` in SOL
    // (value = amount x SOL price); a SELL sells `amount` of the TOKEN
    // (value = amount x TOKEN price, from the live feed). Valuing a sell at the
    // SOL price overvalued it by ~(solPrice/tokenPrice) and ALWAYS tripped the
    // tranche_cap guard - an 838-TRENCHER sell read as ~$64k instead of ~$1
    // (found 2026-07-12, first prod sell). priceUsd is the token's live price.
    const unitUsd = order.side === 'buy' ? await nativePriceUsd() : (Number(priceUsd) > 0 ? Number(priceUsd) : null)
    if (!unitUsd) {
      await store.saveOrder(order, { audit: { event: 'guard_block', guard: order.side === 'buy' ? 'native_price_unavailable' : 'token_price_unavailable' } })
      return { skipped: 'price_unavailable' }
    }
    const trancheUsd = amountNative * unitUsd

    // Per-tranche cap: the user's stated capUsd must actually cover this
    // tranche's real value (with drift slack) - the cap is a promise to
    // the user, not a hint from the model.
    const perTrancheCap = (order.spend.capUsd / (order.kind === 'dca' ? order.dca.tranches : 1)) * TRANCHE_CAP_SLACK
    if (trancheUsd > perTrancheCap) {
      order.status = 'failed'
      await store.saveOrder(order, { audit: { event: 'guard_block', guard: 'tranche_cap', detail: 'real value exceeds stated cap' } })
      await store.pushInbox(order.owner, { type: 'order_failed', orderId, summary: `Order blocked: the real trade value exceeds your $${order.spend.capUsd} cap (native price moved) - place a new order` })
      return { failed: 'tranche_cap' }
    }

    // 6. Liquidity floor + pool-notional cap (from the live feed; a missing
    // liquidity read logs but does not block - thin-token protection then
    // falls to the impact ceiling below).
    if (Number.isFinite(Number(liquidity))) {
      if (Number(liquidity) < MIN_LIQUIDITY_USD) {
        order.status = 'failed'
        await store.saveOrder(order, { audit: { event: 'guard_block', guard: 'liquidity_floor', detail: `pool < $${MIN_LIQUIDITY_USD}` } })
        await store.pushInbox(order.owner, { type: 'order_failed', orderId, summary: 'Order blocked: pool liquidity fell below the safety floor' })
        return { failed: 'liquidity_floor' }
      }
      if (trancheUsd > Number(liquidity) * MAX_POOL_FRACTION) {
        order.status = 'failed'
        await store.saveOrder(order, { audit: { event: 'guard_block', guard: 'pool_fraction', detail: `notional > ${MAX_POOL_FRACTION * 100}% of pool` } })
        await store.pushInbox(order.owner, { type: 'order_failed', orderId, summary: 'Order blocked: order size is too large for the pool' })
        return { failed: 'pool_fraction' }
      }
    } else {
      log('guard_soft_fail', { orderId, guard: 'liquidity_unknown' })
    }

    // 7. Daily volume cap (real USD).
    const dailyUsed = await store.getDailyVolume(order.owner)
    if (dailyUsed + trancheUsd > DAILY_VOLUME_CAP_USD) {
      await store.saveOrder(order, { audit: { event: 'guard_block', guard: 'daily_cap' } })
      return { skipped: 'daily_cap' }
    }

    // 8. Spend-cap bookkeeping (real USD).
    const filled = Number(order.execution?.filledUsd) || 0
    if (filled + trancheUsd > order.spend.capUsd * 1.05) {
      order.status = 'filled'
      await store.saveOrder(order, { audit: { event: 'capped', detail: 'spend cap reached' } })
      return { skipped: 'spend_cap' }
    }

    order.status = 'executing'
    order = await store.saveOrder(order, { audit: { event: 'triggered', tranche, metricNow, supplyUsed, supplySource } })
    if (order.status !== 'executing') return { cancelled: 'terminal_state_won' } // saveOrder guard fired

    // 9. Quote attempts (fresh quote per attempt; retries ONLY for
    // pre-broadcast failures).
    let lastError = null
    for (let attempt = 1; attempt <= MAX_QUOTE_ATTEMPTS; attempt++) {
      const quoteRes = await internalPost('/api/swap/quote', {
        chainId: 'solana',
        inputToken: order.side === 'buy' ? 'native' : order.token.address,
        outputToken: order.side === 'buy' ? order.token.address : 'native',
        amount: toBaseUnits(amountNative, order.side === 'buy' ? 9 : order.token.decimals),
        slippageBps: order.slippageBps,
        userAddress: order.walletAddress,
        inputDecimals: order.side === 'buy' ? 9 : order.token.decimals,
        outputDecimals: order.side === 'buy' ? order.token.decimals : 9,
        via: 'order-engine',
      })
      if (!quoteRes.ok || !quoteRes.json?.swapTransaction) {
        lastError = `quote failed: ${quoteRes.json?.error || quoteRes.status}`
        continue
      }
      const quote = quoteRes.json

      const impact = parseImpactPct(quote)
      if (impact != null && impact > MAX_IMPACT_PCT) { lastError = `impact ${impact.toFixed(2)}% > ${MAX_IMPACT_PCT}%`; break }

      if (DRY_RUN) {
        await store.saveOrder(order, { audit: { event: 'dry_run_would_execute', attempt, tranche, impact } })
        log('dry_run_would_execute', { orderId, tranche, impact })
        order.status = 'armed'
        await store.saveOrder(order)
        return { dryRun: true }
      }

      // 10. CANCEL-RACE GATE: the LAST read before signing. A user cancel
      // that landed during the gates above wins here.
      const fresh = await store.getOrder(orderId)
      if (!fresh || fresh.status !== 'executing') {
        log('pre_sign_abort', { orderId, status: fresh?.status || 'missing' })
        return { cancelled: 'status_changed_pre_sign' }
      }

      // 11. Sign + send. From this point on, NO retry with a new quote -
      // an unknown outcome flags for review instead of double-spending.
      let sig = null
      let dispatched = false
      try {
        dispatched = true
        const sent = await privy.signAndSendSolana({
          walletId,
          transactionB64: quote.swapTransaction,
          idempotencyKey: `${orderId}:${tranche}:${attempt}`,
        })
        sig = sent.hash
      } catch (e) {
        const msg = String(e?.message || e)
        // Policy denial / explicit API rejection = provably not broadcast.
        if (/policy|denied|not allowed|forbidden|invalid/i.test(msg)) {
          lastError = `sign rejected: ${msg.slice(0, 200)}`
          break // terminal - retrying cannot help
        }
        // Timeout / connection loss = UNKNOWN outcome - stop, review.
        return await flagForReview(order, tranche, `sign outcome unknown: ${msg.slice(0, 200)}`)
      }
      if (!sig) {
        // Dispatched, no signature returned - unknown outcome.
        return await flagForReview(order, tranche, 'sign dispatched but no signature returned')
      }

      const conf = await confirmSolana(sig)
      if (!conf.confirmed) {
        if (conf.failed) {
          // On-chain FAILURE is a known outcome - safe to report failed.
          lastError = `tx failed on-chain: ${conf.error}`
          break
        }
        // Timeout - the tx may still land. Never re-sign.
        return await flagForReview(order, tranche, `confirmation timeout for ${sig}`, sig)
      }

      // 12. Record into the shared swap-history lane (verification stays on).
      try {
        await internalPost('/api/swap/log', {
          onBehalfOf: order.owner,
          via: 'agent-order',
          orderId,
          txHash: sig,
          chainId: 'solana',
          inputToken: order.side === 'buy' ? 'native' : order.token.address,
          outputToken: order.side === 'buy' ? order.token.address : 'native',
          inputAmount: quote.inputAmount,
          outputAmount: quote.outputAmount,
          userAddress: order.walletAddress,
          side: order.side,
          tokenSymbol: order.token.symbol,
        })
      } catch { log('swap_log_failed', { orderId }) }

      // 13. Success bookkeeping (real USD).
      order.execution.attempts += attempt
      order.execution.txHashes = [...(order.execution.txHashes || []), sig].slice(-20)
      order.execution.filledUsd = filled + trancheUsd
      await store.bumpDailyVolume(order.owner, trancheUsd)
      if (order.kind === 'dca') {
        order.dca.filledTranches += 1
        order.status = order.dca.filledTranches >= order.dca.tranches ? 'filled' : 'armed'
      } else {
        order.status = 'filled'
      }
      await store.saveOrder(order, { audit: { event: 'executed', tranche, sig } })
      await store.pushInbox(order.owner, {
        type: 'order_filled', orderId, txHash: sig,
        summary: `${order.side === 'buy' ? 'Bought' : 'Sold'} ${order.token.symbol} - ${order.kind === 'dca' ? `tranche ${tranche + 1}/${order.dca.tranches}` : 'trigger order'} filled`,
      })
      log('order_executed', { orderId, tranche })
      return { executed: true, sig }
    }

    // Pre-broadcast failures exhausted.
    order.status = order.kind === 'dca' && (Number(order.dca?.filledTranches) || 0) > 0 ? 'partial_filled' : 'failed'
    order.execution.attempts += MAX_QUOTE_ATTEMPTS
    order.execution.lastError = lastError
    await store.saveOrder(order, { audit: { event: 'order_execution_failed', tranche, error: lastError } })
    await store.pushInbox(order.owner, { type: 'order_failed', orderId, summary: `Order failed: ${lastError}` })
    log('order_execution_failed', { orderId, tranche, error: lastError })
    return { failed: lastError }
  } catch (e) {
    // Transient infrastructure throw (delegation check, KV blip, quote
    // fetch). Nothing was signed on this path: every signAndSend outcome is
    // handled inside the sign block (denial -> terminal, unknown ->
    // flagForReview), and even a post-sign bookkeeping throw cannot re-sign
    // - KV status is 'executing' so the slot stays claimed and the
    // stuck-sweep parks it. When the doc is still 'armed', the finally
    // releases the slot and index.js re-arms the evaluator for a BOUNDED
    // retry instead of stalling until the price re-crosses.
    log('execute_transient', { orderId, tranche, error: String(e?.message || e).slice(0, 160) })
    return { transient: String(e?.message || e).slice(0, 160) }
  } finally {
    // Slot stays claimed 900s for terminal/review outcomes (idempotency);
    // release early only when we merely skipped so the next tick retries.
    const fresh = await store.getOrder(orderId).catch(() => null)
    if (fresh && fresh.status === 'armed') await store.releaseExecSlot(orderId, tranche).catch(() => {})
  }
}

/** Unknown-outcome path: never re-sign; park the order for manual review. */
async function flagForReview(order, tranche, reason, sig) {
  order.status = 'failed'
  order.execution.lastError = `NEEDS REVIEW: ${reason}`
  if (sig) order.execution.txHashes = [...(order.execution.txHashes || []), sig].slice(-20)
  await store.saveOrder(order, { audit: { event: 'needs_review', tranche, reason } })
  await store.pushInbox(order.owner, {
    type: 'order_failed', orderId: order.id, txHash: sig,
    summary: 'Order paused for review: the execution outcome could not be confirmed - check your wallet before re-placing',
  })
  log('order_needs_review', { orderId: order.id, tranche, reason })
  return { needsReview: reason }
}

function trancheAmountNative(order) {
  if (order.kind === 'dca') return order.spend.amount / order.dca.tranches
  return order.spend.amount
}

function toBaseUnits(amount, decimals) {
  const s = Number(amount).toFixed(Math.min(decimals, 12))
  const [whole = '0', frac = ''] = s.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt((whole + fracPadded).replace(/^0+(?=\d)/, '') || '0').toString()
}

module.exports = { execute, DRY_RUN }
