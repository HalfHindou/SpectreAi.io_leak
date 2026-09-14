/**
 * Shared Upstash Redis helpers with in-memory fallback for local dev.
 *
 * Migrated from @vercel/kv (deprecated as of 2026) to @upstash/redis. Vercel
 * KV's data was auto-migrated to Upstash Redis under Marketplace integrations.
 * The Upstash + Vercel native integration auto-injects KV_REST_API_URL/TOKEN
 * (legacy compat) and UPSTASH_REDIS_REST_URL/TOKEN. We accept either set so
 * the same code works whether the project was provisioned via the old KV
 * pathway or the new Marketplace pathway.
 *
 * When neither set is present (local dev without an Upstash store), falls
 * back to an in-memory Map so the API still works.
 */

import { randomBytes } from 'node:crypto'

let redisClient = null
let usingMemoryFallback = false

// In-memory fallback for local dev (no Upstash env vars)
const memoryStore = new Map()

async function getKv() {
  if (redisClient !== null) return redisClient
  if (usingMemoryFallback) return null

  // Vercel's Upstash marketplace integration injects env vars under several
  // names depending on integration version + connection prefix:
  //   - UPSTASH_REDIS_REST_*      (Upstash-native modern)
  //   - STORAGE_KV_REST_API_*     (Vercel Storage integration w/ "STORAGE" prefix
  //                                - what the cinnabar-candle integration uses)
  //   - KV_REST_API_*             (Vercel KV legacy compat aliases)
  // Resolution order: Upstash native -> current STORAGE-prefixed integration ->
  // bare legacy names (which can be STALE from an earlier disconnected
  // integration; research had this exact problem 2026-05-24 - stale unprefixed
  // KV_REST_API_URL pointed at a dead db while the live integration's vars
  // were STORAGE-prefixed and went unread).
  // Probe ALL possible env var names so we can log which one matched.
  const urlSources = {
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    STORAGE_KV_REST_API_URL: process.env.STORAGE_KV_REST_API_URL,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
  }
  const tokenSources = {
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    STORAGE_KV_REST_API_TOKEN: process.env.STORAGE_KV_REST_API_TOKEN,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  }
  // One-shot diagnostic listing which env vars are populated. Logs only
  // presence (true/false), no secret material. Safe.
  try {
    const urlPresent = Object.entries(urlSources).map(([k, v]) => `${k}=${!!v}`).join(' ')
    const tokenPresent = Object.entries(tokenSources).map(([k, v]) => `${k}=${!!v}`).join(' ')
    console.warn(`[kv] env probe: ${urlPresent} | ${tokenPresent}`)
  } catch { /* logging is best-effort */ }
  const url = urlSources.UPSTASH_REDIS_REST_URL
    || urlSources.STORAGE_KV_REST_API_URL
    || urlSources.KV_REST_API_URL
  const token = tokenSources.UPSTASH_REDIS_REST_TOKEN
    || tokenSources.STORAGE_KV_REST_API_TOKEN
    || tokenSources.KV_REST_API_TOKEN

  if (!url || !token) {
    console.warn('[kv] No Upstash/KV env vars set - using in-memory fallback')
    usingMemoryFallback = true
    return null
  }

  try {
    const { Redis } = await import('@upstash/redis')
    redisClient = new Redis({ url, token })
    // One-shot diagnostic so we can confirm which Upstash database this
    // function is talking to. Logs only the host (no token). Safe to log.
    try {
      const host = new URL(url).host
      console.log(`[kv] connected upstash host=${host}`)
    } catch { /* malformed URL - ignore */ }
    return redisClient
  } catch (err) {
    console.warn('[kv] Failed to load @upstash/redis - using in-memory fallback:', err.message)
    usingMemoryFallback = true
    return null
  }
}

// ---------- Low-level wrappers ----------
//
// Every wrapper catches its own errors and falls back to the in-memory store.
// Without this, a misconfigured Upstash client (bad creds, expired token,
// network outage) throws on every call and the consuming serverless function
// dies with FUNCTION_INVOCATION_FAILED. The fallback is best-effort - data
// won't persist across cold starts in degraded mode, but the function stays
// alive and the user sees a successful response with an empty/default value.

async function kvGet(key) {
  try {
    const kv = await getKv()
    if (kv) return await kv.get(key)
  } catch (err) {
    // Single-line dump so Vercel MCP log query catches the full reason.
    const code = err?.code || err?.name || 'Error'
    const status = err?.status || err?.statusCode || '?'
    const msg = (err?.message || String(err)).replace(/\s+/g, ' ').slice(0, 180)
    console.warn(`[kv] GET fail key=${key.slice(0,40)} code=${code} status=${status} msg=${msg}`)
  }
  return memoryStore.get(key) || null
}

async function kvSet(key, value) {
  try {
    const kv = await getKv()
    if (kv) return await kv.set(key, value)
  } catch (err) {
    console.warn('[kv] set failed, falling back to memory:', err?.message)
  }
  memoryStore.set(key, value)
}

// Atomic compare-and-set. Returns true if the key was created, false if it
// already existed. Used to close TOCTOU windows where two concurrent writers
// must not both succeed (e.g. claiming a referral code, or recording that a
// user has applied a referral). Mirrors Redis `SET ... NX`.
async function kvSetIfNotExists(key, value) {
  try {
    const kv = await getKv()
    if (kv) {
      // @upstash/redis returns "OK" on success, null when the key already exists.
      const result = await kv.set(key, value, { nx: true })
      return result === 'OK' || result === true
    }
  } catch (err) {
    console.warn('[kv] setnx failed, falling back to memory:', err?.message)
  }
  if (memoryStore.has(key)) return false
  memoryStore.set(key, value)
  return true
}

// TTL-aware get/set. The in-memory fallback simulates Redis TTL by storing
// `{ value, expiresAt }` and lazily evicting on read. Upstash supports `EX`
// natively.
async function kvGetWithTTL(key) {
  try {
    const kv = await getKv()
    if (kv) {
      const v = await kv.get(key)
      return v ?? null
    }
  } catch (err) {
    console.warn('[kv] getWithTTL failed, falling back to memory:', err?.message)
  }
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return entry.value ?? null
}

async function kvSetWithTTL(key, value, ttlSeconds) {
  if (!ttlSeconds || ttlSeconds < 1) return
  try {
    const kv = await getKv()
    if (kv) return await kv.set(key, value, { ex: ttlSeconds })
  } catch (err) {
    console.warn('[kv] setWithTTL failed, falling back to memory:', err?.message)
  }
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

// Generic TTL-aware JSON cache, exported for handlers that need a shared
// cross-lambda cache (e.g. the Codex trending handler, whose 12-query fan-out
// bills ~24 Codex ops per cold rebuild — caching it collapses that to once per
// TTL for the whole user base instead of once per cold lambda).
export async function getJsonWithTTL(key) {
  return kvGetWithTTL(key)
}
export async function setJsonWithTTL(key, value, ttlSeconds) {
  return kvSetWithTTL(key, value, ttlSeconds)
}

async function kvLpush(key, ...values) {
  try {
    const kv = await getKv()
    if (kv) return await kv.lpush(key, ...values)
  } catch (err) {
    console.warn('[kv] lpush failed, falling back to memory:', err?.message)
  }
  if (!memoryStore.has(key)) memoryStore.set(key, [])
  const list = memoryStore.get(key)
  list.unshift(...values)
}

// ---------- Idempotency helpers ----------
//
// Three-call protocol for dedupe on retried POSTs:
//   1. `claimIdempotencySlot(scope, key, value, ttl)` - atomic SET NX EX. Returns
//      true if newly claimed, false if the slot was already taken.
//   2. `getIdempotencySlot(scope, key)` - read the original claim payload so a
//      retry can compare its current request against the original and reject
//      hash mismatches that would indicate key reuse.
//   3. `releaseIdempotencySlot(scope, key)` - delete the claim. Called when the
//      claiming request failed downstream so a retry with corrected data can
//      proceed instead of getting a cached failure.
//
// Mirrors apps/trading/api/_lib/kv.js. Both apps' /api/swap/log endpoints use
// scope='swap-log' and the client's X-Idempotency-Key header value.

export async function claimIdempotencySlot(scope, key, value, ttlSeconds = 86400) {
  const k = `idempotency:${scope}:${key}`
  try {
    const kv = await getKv()
    if (kv) {
      const result = await kv.set(k, value, { nx: true, ex: ttlSeconds })
      return result === 'OK' || result === true
    }
  } catch (err) {
    console.warn('[kv] claimIdempotencySlot failed, falling back to memory:', err?.message)
  }
  if (memoryStore.has(k)) return false
  memoryStore.set(k, value)
  return true
}

export async function getIdempotencySlot(scope, key) {
  return kvGet(`idempotency:${scope}:${key}`)
}

export async function releaseIdempotencySlot(scope, key) {
  const k = `idempotency:${scope}:${key}`
  try {
    const kv = await getKv()
    if (kv) return await kv.del(k)
  } catch (err) {
    console.warn('[kv] releaseIdempotencySlot failed, falling back to memory:', err?.message)
  }
  memoryStore.delete(k)
}

// ---------- Privy webhook state ----------
//
// Mirrors apps/trading/api/_lib/kv.js. See that file's header for full rationale.
// Two scopes:
//   - `tx-status:{txHash}` - 7d TTL, latest known status from transaction.*
//   - `user-events:{did}` - capped list of last 50 user lifecycle events

// EVM 0x-hex(64) or Solana base58(87-88). Defense-in-depth: validate the
// hash shape before it becomes a KV key (the webhook sources it from
// attacker-shaped event data) to prevent key injection.
const TX_HASH_KEY_RE = /^(?:0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{87,88})$/

export async function setWebhookTxStatus(txHash, payload) {
  if (typeof txHash !== 'string' || !TX_HASH_KEY_RE.test(txHash)) return
  await kvSetWithTTL(`tx-status:${txHash}`, payload, 7 * 24 * 60 * 60)
}

export async function getWebhookTxStatus(txHash) {
  return kvGetWithTTL(`tx-status:${txHash}`)
}

export async function recordWebhookUserEvent(did, eventType, data) {
  if (typeof did !== 'string' || did.length === 0) return
  const entry = JSON.stringify({ eventType, data, ts: Date.now() })
  await kvLpush(`user-events:${did}`, entry)
  await kvLtrim(`user-events:${did}`, 0, 49)
}

async function kvLrange(key, start, stop) {
  try {
    const kv = await getKv()
    if (kv) return await kv.lrange(key, start, stop)
  } catch (err) {
    console.warn('[kv] lrange failed, falling back to memory:', err?.message)
  }
  const list = memoryStore.get(key) || []
  // Redis-style: stop is inclusive
  return list.slice(start, stop + 1)
}

async function kvLtrim(key, start, stop) {
  try {
    const kv = await getKv()
    if (kv) return await kv.ltrim(key, start, stop)
  } catch (err) {
    console.warn('[kv] ltrim failed, falling back to memory:', err?.message)
  }
  const list = memoryStore.get(key) || []
  memoryStore.set(key, list.slice(start, stop + 1))
}

// ---------- Token color cache ----------

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function isValidHex(c) {
  return typeof c === 'string' && HEX_RE.test(c)
}

export async function getTokenColor(logoUrl) {
  if (!logoUrl) return null
  const v = await kvGet(`tokencolor:${logoUrl}`)
  return isValidHex(v) ? v : null
}

export async function setTokenColor(logoUrl, color) {
  if (!logoUrl || !isValidHex(color)) return
  await kvSet(`tokencolor:${logoUrl}`, color)
}

// ---------- User profile ----------

export async function getUser(userId) {
  const data = await kvGet(`user:${userId}:profile`)
  return data || { profile: {}, settings: {}, watchlist: [], updatedAt: null }
}

export async function setUser(userId, data) {
  await kvSet(`user:${userId}:profile`, data)
}

// ---------- Referrals ----------
//
// Codes are random 8-char Crockford-style base32 (no 0/1/I/L/O/U) so they
// can't be enumerated from a userId. Reverse lookup `referral:owner:{code}`
// resolves a code back to its owner; forward lookup `referral:code:{userId}`
// is what we return when a user asks "what's my code". Both are written
// once on first call and stable forever after.

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789' // 30 chars
const REFERRAL_CODE_LEN = 8
const REFERRAL_CODE_RE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/

export function isValidReferralCode(code) {
  return typeof code === 'string' && REFERRAL_CODE_RE.test(code)
}

function newReferralCode() {
  const buf = randomBytes(REFERRAL_CODE_LEN)
  let s = ''
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    s += REFERRAL_CODE_ALPHABET[buf[i] % REFERRAL_CODE_ALPHABET.length]
  }
  return s
}

function parseEntry(raw) {
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

export async function getOrCreateUserReferralCode(userId) {
  const existing = parseEntry(await kvGet(`referral:code:${userId}`))
  if (existing?.code) return existing.code

  // Use SET NX on the reverse-lookup so two concurrent calls that happen
  // to roll the same random code can't both claim ownership. Keyspace is
  // 30^8 ≈ 6.5×10^11 so organic collisions are astronomical, but a flood
  // with a known prng seed could converge on a code an attacker has guessed.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode()
    const createdAt = new Date().toISOString()
    const claimed = await kvSetIfNotExists(`referral:owner:${code}`, { userId, createdAt })
    if (claimed) {
      await kvSet(`referral:code:${userId}`, { code, createdAt })
      return code
    }
  }
  throw new Error('referral code generation failed')
}

export async function getReferralOwner(code) {
  if (!isValidReferralCode(code)) return null
  const entry = parseEntry(await kvGet(`referral:owner:${code}`))
  return entry?.userId || null
}

// Atomically record that `entry.userId` is now in `entry.referrerCode`'s
// downline. Uses SET NX on `referred:{userId}` so two concurrent /apply
// calls for different codes can't both succeed for the same user — the
// loser sees `claimed === false` and the caller treats it as 409. The
// list write only happens if the claim was won.
//
// Returns true if the referral was recorded, false if the user was
// already referred.
export async function addReferral(entry) {
  const claimed = await kvSetIfNotExists(`referred:${entry.userId}`, entry.referrerCode)
  if (!claimed) return false
  await kvLpush(`referrals:${entry.referrerCode}`, JSON.stringify(entry))
  return true
}

export async function getReferrals(code) {
  const raw = await kvLrange(`referrals:${code}`, 0, -1)
  return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r)
}

export async function isUserReferred(userId) {
  return !!(await kvGet(`referred:${userId}`))
}

// ---------- Swap history ----------

export async function logSwap(userId, entry) {
  await kvLpush(`swaps:${userId}`, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }))
  await kvLtrim(`swaps:${userId}`, 0, 199) // Keep 200 most recent
}

export async function getSwapHistory(userId, limit = 20, offset = 0) {
  const raw = await kvLrange(`swaps:${userId}`, offset, offset + limit - 1)
  return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r)
}

// ---------- Fee config (admin-managed, KV-backed) ----------
//
// Replaces the previous in-memory module-scope state in admin.js, which
// reset on every cold start. Reads are cached in module memory for 60s to
// avoid hitting KV on every swap quote (Fluid Compute reuses instances).
// Writes invalidate the local cache immediately.
//
// On first ever read with empty KV, defaults are seeded from env vars
// (FEE_PERCENTAGE, FEE_BPS, FEE_WALLET_*) so the first deploy doesn't
// land on a zeroed config.

const FEE_CONFIG_KEY = 'admin:fee-config'
const FEE_CONFIG_TTL_MS = 60_000

let _feeCache = null
let _feeCacheExpiry = 0

// Fee config schema (refactored 2026-05-22 - mirrored from trading kv.js).
// New shape: { fee, collector, recipients } + legacy { feeWallets, feePercentage, feeBps }.
// Server-only signing keys live in process.env only (read by cron handler in the trading app).

function buildDefaultFeeConfig() {
  const feePercentage = parseFloat(process.env.FEE_PERCENTAGE || '1.0')
  const feeBps = parseInt(process.env.FEE_BPS || '100', 10)

  const collectorEvm = process.env.COLLECTOR_EVM_ADDRESS || process.env.FEE_WALLET_PRIMARY_EVM || ''
  const collectorSol = process.env.COLLECTOR_SOL_ADDRESS || process.env.FEE_WALLET_PRIMARY_SOL || ''

  const recipientsEvm = [
    { address: process.env.FEE_RECIPIENT_EVM_PRIMARY || '', shareBps: 9000 },
    { address: process.env.FEE_RECIPIENT_EVM_SECONDARY || '', shareBps: 500 },
    { address: process.env.FEE_RECIPIENT_EVM_TERTIARY || '', shareBps: 500 },
  ].filter(r => r.address)
  const recipientsSol = [
    { address: process.env.FEE_RECIPIENT_SOL_PRIMARY || '', shareBps: 9000 },
    { address: process.env.FEE_RECIPIENT_SOL_SECONDARY || '', shareBps: 500 },
    { address: process.env.FEE_RECIPIENT_SOL_TERTIARY || '', shareBps: 500 },
  ].filter(r => r.address)

  return {
    fee: { bps: feeBps, percentage: feePercentage },
    collector: { evm: collectorEvm, solana: collectorSol },
    recipients: { evm: recipientsEvm, solana: recipientsSol },

    // Legacy fields (deprecated, kept for in-flight deploys / old readers).
    feePercentage,
    feeBps,
    feeWallets: {
      primary: { evm: collectorEvm, solana: collectorSol, share: 96 },
      secondary: {
        evm: process.env.FEE_WALLET_SECONDARY_EVM || recipientsEvm[1]?.address || '',
        solana: process.env.FEE_WALLET_SECONDARY_SOL || recipientsSol[1]?.address || '',
        share: 2,
      },
      tertiary: {
        evm: process.env.FEE_WALLET_TERTIARY_EVM || recipientsEvm[2]?.address || '',
        solana: process.env.FEE_WALLET_TERTIARY_SOL || recipientsSol[2]?.address || '',
        share: 2,
      },
    },
  }
}

function normalizeFeeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return buildDefaultFeeConfig()

  const out = { ...cfg }

  if (!out.fee) {
    out.fee = {
      bps: cfg.feeBps ?? parseInt(process.env.FEE_BPS || '100', 10),
      percentage: cfg.feePercentage ?? parseFloat(process.env.FEE_PERCENTAGE || '1.0'),
    }
  }
  if (!out.collector) {
    out.collector = {
      evm: cfg.feeWallets?.primary?.evm || process.env.COLLECTOR_EVM_ADDRESS || '',
      solana: cfg.feeWallets?.primary?.solana || process.env.COLLECTOR_SOL_ADDRESS || '',
    }
  }
  if (!out.recipients) {
    const fw = cfg.feeWallets || {}
    const evmList = [
      { address: fw.primary?.evm || '', shareBps: 9000 },
      { address: fw.secondary?.evm || '', shareBps: 500 },
      { address: fw.tertiary?.evm || '', shareBps: 500 },
    ].filter(r => r.address)
    const solList = [
      { address: fw.primary?.solana || '', shareBps: 9000 },
      { address: fw.secondary?.solana || '', shareBps: 500 },
      { address: fw.tertiary?.solana || '', shareBps: 500 },
    ].filter(r => r.address)
    out.recipients = { evm: evmList, solana: solList }
  }

  return out
}

export async function getFeeConfig() {
  const now = Date.now()
  if (_feeCache && now < _feeCacheExpiry) return _feeCache

  try {
    const stored = await kvGet(FEE_CONFIG_KEY)
    if (stored) {
      const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored
      _feeCache = normalizeFeeConfig(parsed)
      _feeCacheExpiry = now + FEE_CONFIG_TTL_MS
      return _feeCache
    }
  } catch (err) {
    console.warn('[kv] getFeeConfig read error:', err.message)
  }

  // First read with no stored value - seed defaults from env vars.
  const defaults = buildDefaultFeeConfig()
  try {
    await kvSet(FEE_CONFIG_KEY, defaults)
  } catch (err) {
    console.warn('[kv] getFeeConfig seed error:', err.message)
  }
  _feeCache = defaults
  _feeCacheExpiry = now + FEE_CONFIG_TTL_MS
  return _feeCache
}

export async function setFeeConfig(config) {
  await kvSet(FEE_CONFIG_KEY, config)
  _feeCache = config
  _feeCacheExpiry = Date.now() + FEE_CONFIG_TTL_MS
}

// ---------- Showcase cache (2026-05-13 SEC-20260513-017) ----------
//
// The marketing site at spectreai.io embeds the research app as a showcase
// iframe. To render real data without firing fresh paid LLM/external calls
// on every visitor, a cron pre-warms a small cache and the demo-session
// code paths read from here exclusively. TTL is generous (45 min) because
// the cron runs every 15 min - we tolerate stale data over a missed cache
// entry.
//
// Keys:
//   showcase:brief                   - { brief, generatedAt, source }
//   showcase:market-text:<timeframe> - { text, generatedAt }
//   showcase:intelligence-breaking   - { items: [...], generatedAt }

export async function getShowcaseValue(key) {
  if (typeof key !== 'string' || !key.startsWith('showcase:')) return null
  const raw = await kvGet(key)
  if (!raw) return null
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
}

export async function setShowcaseValue(key, value, ttlSeconds = 4500 /* 75 min - L4-PR6 headroom over 30-min warm-showcase cron */) {
  if (typeof key !== 'string' || !key.startsWith('showcase:')) return
  const kv = await getKv()
  const payload = typeof value === 'string' ? value : JSON.stringify(value)
  if (kv) {
    try {
      // Upstash @upstash/redis supports `ex` for TTL in seconds.
      await kv.set(key, payload, { ex: ttlSeconds })
    } catch (err) {
      console.warn('[kv] setShowcaseValue write error:', err.message)
    }
  } else {
    memoryStore.set(key, payload)
    // In-memory fallback doesn't enforce TTL; rely on cron overwrite.
  }
}
