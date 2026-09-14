/**
 * agent-orders-core - the conditional-order store + validation shared by the
 * dev Express route (routes/agent-orders.js), the prod serverless twin
 * (apps/trading/api/agent-orders.js) and the Cloud Run order engine. CJS,
 * raw Upstash REST (same instance both runtimes -> one source of truth).
 *
 * KV layout (plan: harmonic-kindling-shannon):
 *   agent:order:{id}          order doc (JSON)
 *   agent:orders:user:{did}   SET of order ids per owner
 *   agent:orders:active       SET of armed order ids (engine work queue)
 *   agent:inbox:{did}         LIST of notification events (LPUSH/LTRIM 49)
 *
 * v1 executes SOLANA only (Jupiter tx maps 1:1 onto the Privy TEE
 * signAndSendTransaction). Status lifecycle:
 *   created -> armed -> triggered -> executing -> filled|failed|cancelled|expired
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''

const MAX_OPEN_ORDERS = 10
const MAX_SPEND_CAP_USD = 1000
const MAX_EXPIRY_DAYS = 30
const OPEN_STATUSES = new Set(['created', 'armed', 'triggered', 'executing'])

async function kvCmd(cmd) {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV not configured (KV_REST_API_URL/TOKEN)')
  // Upstash REST shows transient multi-second latency spikes (observed
  // 2026-07-11: 3 timeouts in 20 min) - retry twice with backoff before
  // surfacing an error to a user-facing route. NOTE: retries are safe for
  // every command this store issues EXCEPT a hypothetical non-idempotent
  // one - SET/SADD/SREM/DEL/MGET/SMEMBERS/LRANGE/LTRIM are idempotent;
  // INCRBYFLOAT retries only after a TIMEOUT (response never arrived), an
  // acceptable at-most-once-skew on the soft daily-volume counter.
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(KV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd),
        signal: AbortSignal.timeout(attempt === 0 ? 6000 : 9000),
      })
      if (!res.ok) throw new Error(`kv ${cmd[0]} ${res.status}`)
      return (await res.json()).result
    } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  throw lastErr
}

const orderKey = (id) => `agent:order:${id}`
const userSetKey = (did) => `agent:orders:user:${did}`
const ACTIVE_SET = 'agent:orders:active'
const inboxKey = (did) => `agent:inbox:${did}`

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a create-order request body. Returns { error, code } or
 * { order } (the normalized doc, minus owner/wallet fields the route adds).
 */
function validateOrderInput(body) {
  const b = body || {}
  const fail = (code, error) => ({ error, code })

  if (!b.clientOrderId || typeof b.clientOrderId !== 'string' || b.clientOrderId.length > 64) {
    return fail('bad_request', 'clientOrderId (uuid) required')
  }
  const kind = b.kind === 'dca' ? 'dca' : b.kind === 'trigger' ? 'trigger' : null
  if (!kind) return fail('bad_request', "kind must be 'trigger' or 'dca'")
  const side = b.side === 'sell' ? 'sell' : b.side === 'buy' ? 'buy' : null
  if (!side) return fail('bad_request', "side must be 'buy' or 'sell'")

  const t = b.token || {}
  if (!t.address || !t.networkId) return fail('bad_request', 'token {address, networkId} required')
  if (Number(t.networkId) !== 1399811149) {
    return fail('unsupported_chain', 'conditional orders are Solana-only in v1 - EVM support is planned')
  }

  const trig = b.trigger || {}
  const metric = trig.metric === 'price' ? 'price' : trig.metric === 'mcap' ? 'mcap' : null
  if (!metric) return fail('bad_request', "trigger.metric must be 'mcap' or 'price'")
  const op = trig.op === 'gte' ? 'gte' : trig.op === 'lte' ? 'lte' : null
  if (!op) return fail('bad_request', "trigger.op must be 'gte' or 'lte'")
  const value = Number(trig.value)
  if (!Number.isFinite(value) || value <= 0) return fail('bad_request', 'trigger.value must be positive')

  let range = null
  let dca = null
  if (kind === 'dca') {
    const r = b.range || {}
    const lo = Number(r.min), hi = Number(r.max)
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= lo) {
      return fail('bad_request', 'dca range {min, max} must satisfy 0 < min < max')
    }
    const tranches = Math.round(Number(b.tranches ?? r.tranches ?? 4))
    if (!Number.isFinite(tranches) || tranches < 2 || tranches > 10) return fail('bad_request', 'tranches must be 2-10')
    range = { min: lo, max: hi }
    dca = { tranches, minIntervalSec: Math.max(60, Math.round(Number(b.minIntervalSec) || 300)), filledTranches: 0 }
  }

  const spend = b.spend || {}
  const spendAmount = Number(spend.amount)
  if (!Number.isFinite(spendAmount) || spendAmount <= 0) return fail('bad_request', 'spend.amount must be positive')
  const capUsd = Number(spend.capUsd)
  if (!Number.isFinite(capUsd) || capUsd <= 0) return fail('bad_request', 'spend.capUsd required')
  if (capUsd > MAX_SPEND_CAP_USD) return fail('cap_exceeded', `spend.capUsd exceeds the $${MAX_SPEND_CAP_USD} per-order ceiling`)

  const slippageBps = Math.min(Math.max(Math.round(Number(b.slippageBps) || 100), 1), 500)

  const expiresAt = Number(b.expiresAt)
  const maxExpiry = Date.now() + MAX_EXPIRY_DAYS * 86400_000
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return fail('bad_request', 'expiresAt must be in the future (unix ms)')
  if (expiresAt > maxExpiry) return fail('bad_request', `expiresAt exceeds the ${MAX_EXPIRY_DAYS}-day ceiling`)

  return {
    order: {
      v: 1,
      kind, side,
      token: { address: String(t.address), networkId: 1399811149, symbol: t.symbol || '', decimals: Number(t.decimals) || 9 },
      trigger: {
        metric, op, value,
        supplyBasis: 'circulating',
        supplyAtCreate: Number(trig.supplyAtCreate) || null,
        priceAtCreate: Number(trig.priceAtCreate) || null,
      },
      ...(range ? { range } : {}),
      ...(dca ? { dca } : {}),
      spend: { token: 'native', amount: spendAmount, capUsd },
      slippageBps,
      expiresAt,
      clientOrderId: b.clientOrderId,
      createdVia: 'agent-chat',
    },
  }
}

// ── Privy delegation check ──────────────────────────────────────────────────

/**
 * Verify the wallet belongs to the DID AND carries delegated:true (session
 * signer granted). Returns { ok, walletId } or { ok:false, reason }.
 */
async function checkDelegation({ userId, walletAddress }) {
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) return { ok: false, reason: 'privy server credentials missing' }
  const auth = 'Basic ' + Buffer.from(`${appId}:${appSecret}`).toString('base64')
  const res = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: auth, 'privy-app-id': appId },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) return { ok: false, reason: `privy user lookup ${res.status}` }
  const user = await res.json()
  const accounts = user?.linked_accounts || []
  const wallet = accounts.find((a) =>
    a.type === 'wallet' &&
    a.address && walletAddress &&
    a.address.toLowerCase() === String(walletAddress).toLowerCase()
  )
  if (!wallet) return { ok: false, reason: 'wallet does not belong to this user' }
  if (!wallet.delegated) return { ok: false, reason: 'signer_not_granted' }
  return { ok: true, walletId: wallet.id || wallet.wallet_id || null }
}

// ── Store operations ────────────────────────────────────────────────────────

async function getOrder(orderId) {
  const raw = await kvCmd(['GET', orderKey(orderId)])
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

async function listOrders(userId, { scope = 'all', tokenAddress, all = false } = {}) {
  const ids = (await kvCmd(['SMEMBERS', userSetKey(userId)])) || []
  if (!ids.length) return []
  const docs = []
  // MGET in one round-trip
  const raws = await kvCmd(['MGET', ...ids.map(orderKey)])
  for (const raw of raws || []) {
    if (!raw) continue
    try {
      const doc = JSON.parse(raw)
      if (scope === 'open' && !OPEN_STATUSES.has(doc.status)) continue
      if (tokenAddress && doc.token?.address?.toLowerCase() !== tokenAddress.toLowerCase()) continue
      docs.push(doc)
    } catch { /* skip corrupt */ }
  }
  docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  // Display callers get the 50 newest; INTERNAL callers (cap enforcement,
  // idempotency) must see everything or old-but-live orders become
  // invisible and the cap bypassable.
  return all ? docs : docs.slice(0, 50)
}

async function createOrder({ userId, walletAddress, walletId, orderInput }) {
  // Atomic idempotency: reserve the clientOrderId with SET NX BEFORE any
  // scan/mint. Two concurrent creates (client retry after a dropped
  // response, overlapping lambdas) race the reservation, not the scan -
  // exactly one mints; the loser replays the winner's order.
  const cidKey = `agent:cid:${userId}:${orderInput.clientOrderId}`
  const id = require('crypto').randomUUID()
  const reserved = await kvCmd(['SET', cidKey, id, 'NX', 'EX', String(30 * 86400)])

  if (reserved !== 'OK') {
    // Replay: resolve the winner's order id from the reservation.
    const winnerId = await kvCmd(['GET', cidKey])
    const winner = winnerId ? await getOrder(winnerId) : null
    if (winner) {
      // Repair path: a KV blip between the winner's three writes can leave
      // the doc missing from a set - re-SADD is idempotent and cheap.
      await kvCmd(['SADD', userSetKey(userId), winner.id])
      if (OPEN_STATUSES.has(winner.status)) await kvCmd(['SADD', ACTIVE_SET, winner.id])
      return { order: winner, idempotent: true }
    }
    // Reservation exists but the doc never landed (mid-create crash) -
    // treat as retryable conflict rather than minting a divergent twin.
    return { error: 'order creation in progress - retry in a moment', code: 'creation_conflict' }
  }

  // Cap check sees the FULL set (no display truncation).
  const existing = await listOrders(userId, { all: true })
  const openCount = existing.filter((o) => OPEN_STATUSES.has(o.status)).length
  if (openCount >= MAX_OPEN_ORDERS) {
    await kvCmd(['DEL', cidKey]).catch(() => {})
    return { error: `open-order limit reached (${MAX_OPEN_ORDERS})`, code: 'too_many_orders' }
  }

  const doc = {
    id,
    ...orderInput,
    owner: userId,
    walletAddress,
    walletId,
    status: 'armed',
    createdAt: Date.now(),
    execution: { attempts: 0, txHashes: [], filledUsd: 0 },
    audit: [{ ts: Date.now(), event: 'created', via: 'agent-chat' }],
  }
  await kvCmd(['SET', orderKey(id), JSON.stringify(doc)])
  await kvCmd(['SADD', userSetKey(userId), id])
  await kvCmd(['SADD', ACTIVE_SET, id])
  return { order: doc }
}

// Only these statuses are user-cancellable. 'triggered'/'executing' are NOT:
// the engine may already be signing - a cancel that returns success while
// funds move is worse than a 409. The engine re-checks status right before
// signing, so cancels landing pre-trigger always win.
const CANCELLABLE = new Set(['created', 'armed'])

async function cancelOrder({ userId, orderId }) {
  const doc = await getOrder(orderId)
  if (!doc) return { error: 'order not found', code: 'not_found' }
  if (doc.owner !== userId) return { error: 'not your order', code: 'forbidden' }
  if (!CANCELLABLE.has(doc.status)) {
    if (doc.status === 'triggered' || doc.status === 'executing') {
      return { error: 'order is executing - it can no longer be cancelled', code: 'executing' }
    }
    return { error: `order is ${doc.status}`, code: 'not_open' }
  }
  doc.status = 'cancelled'
  doc.audit = [...(doc.audit || []), { ts: Date.now(), event: 'cancelled', by: 'user' }].slice(-40)
  await kvCmd(['SET', orderKey(orderId), JSON.stringify(doc)])
  await kvCmd(['SREM', ACTIVE_SET, orderId]).catch(() => {}) // engine self-heals strays
  return { order: doc }
}

async function getInbox(userId) {
  const raw = (await kvCmd(['LRANGE', inboxKey(userId), '0', '19'])) || []
  return raw.map((r) => { try { return JSON.parse(r) } catch { return null } }).filter(Boolean)
}

async function pushInbox(userId, event) {
  await kvCmd(['LPUSH', inboxKey(userId), JSON.stringify({ ts: Date.now(), ...event })])
  await kvCmd(['LTRIM', inboxKey(userId), '0', '49'])
}

/** Display shape - strips wallet/execution internals the client has no use for. */
function toClientOrder(doc) {
  if (!doc) return null
  const { walletId, audit, ...rest } = doc
  return { ...rest, audit: (audit || []).slice(-5) }
}

module.exports = {
  MAX_OPEN_ORDERS,
  MAX_SPEND_CAP_USD,
  OPEN_STATUSES,
  ACTIVE_SET,
  kvCmd,
  orderKey,
  validateOrderInput,
  checkDelegation,
  getOrder,
  listOrders,
  createOrder,
  cancelOrder,
  getInbox,
  pushInbox,
  toClientOrder,
}
