/**
 * agent-kv - minimal Upstash REST KV helper for the Spectre Agent lane (dev
 * Express side). Prod serverless uses apps/trading/api/_lib/kv.js instead;
 * this mirrors just the three operations the agent needs (thread state,
 * daily budget) against the same Upstash instance so dev and prod share
 * state shape. Falls back to an in-process Map when KV env is absent so
 * localhost works without credentials (state then resets per restart).
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''

const _memory = new Map() // key -> { value, expires }
let _warned = false

function memGet(key) {
  const e = _memory.get(key)
  if (!e) return null
  if (e.expires && Date.now() > e.expires) { _memory.delete(key); return null }
  return e.value
}

function memSet(key, value, ttlSec) {
  _memory.set(key, { value, expires: ttlSec ? Date.now() + ttlSec * 1000 : 0 })
  if (_memory.size > 1000) {
    const now = Date.now()
    for (const [k, v] of _memory) if (v.expires && v.expires < now) _memory.delete(k)
  }
}

function hasKv() {
  if (KV_URL && KV_TOKEN) return true
  if (!_warned) { _warned = true; console.warn('[agent-kv] KV_REST_API_URL/TOKEN not set - using in-memory fallback') }
  return false
}

async function kvCommand(cmd, timeoutMs = 4000) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`kv ${cmd[0]} ${res.status}`)
  const j = await res.json()
  return j.result
}

async function kvGet(key) {
  if (!hasKv()) return memGet(key)
  try {
    const raw = await kvCommand(['GET', key])
    if (raw == null) return null
    try { return JSON.parse(raw) } catch { return raw }
  } catch (e) {
    console.warn('[agent-kv] GET failed:', e.message)
    return memGet(key)
  }
}

async function kvSet(key, value, ttlSec) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value)
  if (!hasKv()) return memSet(key, value, ttlSec)
  try {
    const cmd = ttlSec ? ['SET', key, payload, 'EX', String(ttlSec)] : ['SET', key, payload]
    // Large docs (the xfeed archive is ~100KB+ at cap) need a longer window
    // than the 4s default sized for small thread/budget writes.
    await kvCommand(cmd, payload.length > 20_000 ? 10_000 : 4000)
  } catch (e) {
    console.warn('[agent-kv] SET failed:', e.message)
    memSet(key, value, ttlSec)
  }
}

/** INCR + EXPIRE-on-first for daily budgets. Returns the new count. */
async function kvIncrWithExpire(key, ttlSec) {
  if (!hasKv()) {
    const cur = (memGet(key) || 0) + 1
    memSet(key, cur, ttlSec)
    return cur
  }
  try {
    const count = await kvCommand(['INCR', key])
    if (count === 1 && ttlSec) await kvCommand(['EXPIRE', key, String(ttlSec)])
    return count
  } catch (e) {
    console.warn('[agent-kv] INCR failed:', e.message)
    const cur = (memGet(key) || 0) + 1
    memSet(key, cur, ttlSec)
    return cur
  }
}

module.exports = { kvGet, kvSet, kvIncrWithExpire }
