/**
 * Engine-side store operations - thin extensions over the shared
 * agent-orders-core (same Upstash instance the app routes write to).
 * Adds the engine-only pieces: active-set scanning, atomic exec slots,
 * status transitions with audit, daily volume caps, kill switch.
 */
const path = require('path')
const core = require(path.join(__dirname, '..', '..', '..', 'packages', 'server', 'lib', 'agent-orders-core.js'))

const { kvCmd, orderKey, ACTIVE_SET } = core

async function listActiveOrderIds() {
  return (await kvCmd(['SMEMBERS', ACTIVE_SET])) || []
}

async function loadOrders(ids) {
  if (!ids.length) return []
  const raws = await kvCmd(['MGET', ...ids.map(orderKey)])
  const docs = []
  for (let i = 0; i < ids.length; i++) {
    const raw = raws?.[i]
    if (!raw) { await kvCmd(['SREM', ACTIVE_SET, ids[i]]).catch(() => {}); continue } // orphan id
    try {
      const doc = JSON.parse(raw)
      // Self-heal strays: terminal-status docs lingering in ACTIVE_SET
      // (e.g. a cancel whose SREM failed) get removed here every tick.
      if (!core.OPEN_STATUSES.has(doc.status)) {
        await kvCmd(['SREM', ACTIVE_SET, ids[i]]).catch(() => {})
        continue
      }
      docs.push(doc)
    } catch { /* skip corrupt */ }
  }
  return docs
}

/**
 * Persist an order doc. TERMINAL-STATUS GUARD: never clobber a user
 * cancellation (or any terminal state) with a stale in-memory snapshot -
 * the executor holds its doc across multi-second gates, and a cancel
 * landing in that window must WIN. Returns the doc that is actually in
 * KV after the call (the fresh terminal one when the guard fires).
 */
const TERMINAL = new Set(['filled', 'partial_filled', 'failed', 'cancelled', 'expired'])

async function saveOrder(doc, { audit } = {}) {
  const current = await core.getOrder(doc.id).catch(() => null)
  if (current && TERMINAL.has(current.status) && !TERMINAL.has(doc.status)) {
    await kvCmd(['SREM', ACTIVE_SET, doc.id]).catch(() => {})
    return current // the terminal state (e.g. user cancel) wins
  }
  if (audit) doc.audit = [...(doc.audit || []), { ts: Date.now(), ...audit }].slice(-40)
  await kvCmd(['SET', orderKey(doc.id), JSON.stringify(doc)])
  if (!core.OPEN_STATUSES.has(doc.status)) await kvCmd(['SREM', ACTIVE_SET, doc.id]).catch(() => {})
  return doc
}

/** Atomic execution slot: SET NX EX 900 - prevents double-fire across
    restarts/instances. Returns true when THIS process claimed it. */
async function claimExecSlot(orderId, tranche = 0) {
  const r = await kvCmd(['SET', `agent:exec:${orderId}:${tranche}`, String(Date.now()), 'NX', 'EX', '900'])
  return r === 'OK'
}

async function releaseExecSlot(orderId, tranche = 0) {
  await kvCmd(['DEL', `agent:exec:${orderId}:${tranche}`])
}

/** Per-user daily executed volume cap (USD). Returns the new total. */
async function bumpDailyVolume(userId, usd) {
  const d = new Date()
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  const key = `agent:daily:${userId}:${ymd}`
  const total = await kvCmd(['INCRBYFLOAT', key, String(usd)])
  await kvCmd(['EXPIRE', key, '90000'])
  return Number(total)
}

async function getDailyVolume(userId) {
  const d = new Date()
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  return Number(await kvCmd(['GET', `agent:daily:${userId}:${ymd}`])) || 0
}

async function killSwitchOn() {
  if (/^(1|true|on)$/i.test(process.env.ORDER_ENGINE_KILL || '')) return true
  try { return !!(await kvCmd(['GET', 'agent:killswitch'])) } catch { return true } // KV down = fail closed
}

/**
 * Engine liveness/diagnostic heartbeat -> KV `agent:engine:health` (EX 120s).
 * The Cloud Run engine's logs + /healthz are blocked for our GCP identity
 * (Gaia-id issue), so this is the only reliable window into the running
 * engine's state: is it ticking, what price does it see per armed order, is it
 * erroring. Read it with `GET agent:engine:health`. Best-effort - never throws.
 */
async function setHeartbeat(data) {
  try { await kvCmd(['SET', 'agent:engine:health', JSON.stringify({ ...data, ts: Date.now() }), 'EX', '120']) } catch { /* best effort */ }
}

module.exports = {
  ...core,
  listActiveOrderIds,
  loadOrders,
  saveOrder,
  claimExecSlot,
  releaseExecSlot,
  bumpDailyVolume,
  getDailyVolume,
  killSwitchOn,
  setHeartbeat,
}
