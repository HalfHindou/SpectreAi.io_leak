/**
 * spectre-order-engine - always-on Cloud Run worker (min=max=1 instance,
 * single-writer invariant) that watches price/mcap triggers for Spectre
 * Agent conditional orders and executes them via Privy session signers.
 *
 * Loop: every EVAL_INTERVAL_MS scan the active set -> update the SSE
 * watchlist -> evaluate each order against live data -> execute fires.
 * Expiry sweep piggybacks on the same scan. /healthz for uptime checks.
 *
 * Env (Secret Manager on Cloud Run; local .env for dev):
 *   KV_REST_API_URL / KV_REST_API_TOKEN     Upstash (same instance as app)
 *   PRIVY_APP_ID / PRIVY_APP_SECRET         Privy server credentials
 *   PRIVY_AUTHORIZATION_KEY_B64 | _FILE     quorum P-256 key
 *   ORDER_ENGINE_INTERNAL_KEY               internal swap quote/log branches
 *   APP_BASE / STREAM_BASE / HELIUS_RPC_URL
 *   ORDER_ENGINE_KILL / ORDER_ENGINE_DRY_RUN / ORDER_ENGINE_CODEX_RPM
 */
const http = require('http')
const store = require('./store')
const feed = require('./priceFeed')
const { evaluate, dropState, rearmForRetry } = require('./evaluator')
const executor = require('./executor')

const EVAL_INTERVAL_MS = Math.max(1000, parseInt(process.env.ORDER_ENGINE_EVAL_MS || '2000', 10))
const PORT = process.env.PORT || 8080
// Transient execute() failures per order (delegation-check blip, KV spike).
// Each retry re-runs the full wick filter (~5-7s backoff); after the cap the
// order parks for review - fail-closed, never an unbounded retry loop.
const MAX_TRANSIENT_RETRIES = 5
const transientFails = new Map() // orderId -> consecutive transient count

let lastEvalTs = 0
let lastExecTs = 0
let armedCount = 0
let busy = false
let consecutiveErrors = 0

function log(event, fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

async function tick() {
  if (busy) return
  busy = true
  try {
    if (await store.killSwitchOn()) { armedCount = 0; return }

    const ids = await store.listActiveOrderIds()
    const orders = await store.loadOrders(ids)
    const armed = orders.filter((o) => o.status === 'armed')
    armedCount = armed.length
    lastEvalTs = Date.now()

    feed.setWatchlist(armed.map((o) => o.token))

    // Stuck-'executing' sweep: a crash or KV failure between sign and
    // bookkeeping leaves an order in 'executing' forever - after 10 min,
    // park it for review (funds may have moved; never silently retry).
    for (const order of orders.filter((o) => o.status === 'executing' || o.status === 'triggered')) {
      const triggeredAt = [...(order.audit || [])].reverse().find((a) => a.event === 'triggered')?.ts || order.createdAt
      if (Date.now() - triggeredAt > 10 * 60_000) {
        order.status = 'failed'
        order.execution = order.execution || {}
        order.execution.lastError = 'NEEDS REVIEW: stuck executing > 10min'
        await store.saveOrder(order, { audit: { event: 'needs_review', reason: 'stuck_executing' } })
        await store.pushInbox(order.owner, { type: 'order_failed', orderId: order.id, summary: 'Order paused for review: execution did not complete - check your wallet before re-placing' })
        log('order_needs_review', { orderId: order.id, reason: 'stuck_executing' })
        dropState(order.id)
      }
    }

    const evalSnap = []
    for (const order of armed) {
      // Expiry sweep.
      if (order.expiresAt && Date.now() > order.expiresAt) {
        order.status = 'expired'
        await store.saveOrder(order, { audit: { event: 'expired' } })
        await store.pushInbox(order.owner, { type: 'order_expired', orderId: order.id, summary: `${order.token.symbol} order expired unfilled` })
        dropState(order.id)
        continue
      }

      const live = await feed.getLive(order.token.address, order.token.networkId)
      const verdict = evaluate(order, live)
      // Diagnostic snapshot: the price the engine actually saw for this order.
      // price:null here = the feed can't reach a price (reconcile/token-snapshot
      // failing) - the exact signal that was invisible without GCP logs.
      evalSnap.push({ id: order.id.slice(0, 8), sym: order.token?.symbol, price: live?.priceUsd ?? null, trig: order.trigger?.value, metric: order.trigger?.metric, op: order.trigger?.op, fire: !!verdict.fire, reason: verdict.reason })
      if (!verdict.fire) continue

      log('trigger_fired', { orderId: order.id, tranche: verdict.tranche, metricNow: verdict.metricNow })
      lastExecTs = Date.now()
      // Sequential execution (single instance, low volume) - deliberate.
      const result = await executor.execute(order.id, { ...verdict, priceUsd: live.priceUsd, liquidity: live.liquidity })
      if (result?.transient) {
        const fails = (transientFails.get(order.id) || 0) + 1
        transientFails.set(order.id, fails)
        if (fails >= MAX_TRANSIENT_RETRIES) {
          order.status = 'failed'
          order.execution = order.execution || {}
          order.execution.lastError = `NEEDS REVIEW: ${fails} transient execution failures - last: ${result.transient}`
          await store.saveOrder(order, { audit: { event: 'needs_review', reason: 'transient_retries_exhausted', detail: result.transient } })
          await store.pushInbox(order.owner, { type: 'order_failed', orderId: order.id, summary: 'Order paused for review: execution kept failing on infrastructure errors - nothing was traded' })
          log('order_needs_review', { orderId: order.id, reason: 'transient_retries_exhausted' })
          dropState(order.id)
          transientFails.delete(order.id)
        } else {
          rearmForRetry(order.id)
          log('execute_retry_armed', { orderId: order.id, attempt: fails, of: MAX_TRANSIENT_RETRIES })
        }
      } else {
        transientFails.delete(order.id)
      }
    }
    // Heartbeat AFTER the eval loop so evalSnap carries the per-order price the
    // engine saw. Readable via KV `GET agent:engine:health` (our only window in;
    // Cloud Run logs/healthz are Gaia-blocked for our identity).
    await store.setHeartbeat({ armedCount, evalSnap, lastExecTs, ...feed.stats() }).catch(() => {})
    consecutiveErrors = 0
  } catch (e) {
    consecutiveErrors++
    log('tick_error', { error: String(e?.message || e).slice(0, 200), consecutiveErrors })
    await store.setHeartbeat({ armedCount, lastError: String(e?.message || e).slice(0, 200), consecutiveErrors, ...feed.stats() }).catch(() => {})
  } finally {
    busy = false
  }
}

setInterval(tick, EVAL_INTERVAL_MS)
tick()

http.createServer((req, res) => {
  if (req.url === '/healthz') {
    const feedStats = feed.stats()
    const body = {
      ok: consecutiveErrors < 5,
      dryRun: executor.DRY_RUN,
      armedOrders: armedCount,
      lastEvalTs,
      lastExecTs,
      ...feedStats,
    }
    res.writeHead(body.ok ? 200 : 503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(body))
  }
  res.writeHead(404)
  res.end()
}).listen(PORT, () => log('engine_started', { port: PORT, dryRun: executor.DRY_RUN, evalMs: EVAL_INTERVAL_MS }))
