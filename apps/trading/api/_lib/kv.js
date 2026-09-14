/**
 * Shared Vercel KV helpers with in-memory fallback for local dev.
 *
 * @vercel/kv auto-reads KV_REST_API_URL and KV_REST_API_TOKEN from env.
 * When those are missing (local dev), falls back to an in-memory Map
 * so the API still works without a KV store connected.
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
  const url = process.env.UPSTASH_REDIS_REST_URL
    || process.env.STORAGE_KV_REST_API_URL
    || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
    || process.env.STORAGE_KV_REST_API_TOKEN
    || process.env.KV_REST_API_TOKEN

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
    console.warn('[kv] get failed, falling back to memory:', err?.message)
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
// already existed. Closes TOCTOU windows where two concurrent writers must
// not both succeed (claiming a referral code, recording an apply). Mirrors
// Redis `SET ... NX`.
async function kvSetIfNotExists(key, value) {
  try {
    const kv = await getKv()
    if (kv) {
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

// TTL-aware JSON cache. Used to amortize expensive Codex round-trips across
// concurrent Vercel Lambda instances. Upstash supports `EX` directly; the
// in-memory fallback simulates by storing `{ value, expiresAt }`.
//
// Critical for trending/details/ath at beta scale: one cold rebuild costs
// 12 parallel Codex queries; if any other Lambda has populated KV in the
// last N seconds, this lookup short-circuits and returns 0 Codex calls.
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

// L4-PR1 (2026-06-03): public JSON helpers — mirrors the research-app kv.js
// API surface so `spectre-data.js` can be ported verbatim from research →
// trading. Upstash `kv.get` already returns parsed JSON for values written
// via `kv.set`, so kvGetWithTTL/kvSetWithTTL are JSON-safe today.
export async function getJsonWithTTL(key) {
  return kvGetWithTTL(key)
}

export async function setJsonWithTTL(key, value, ttlSeconds) {
  return kvSetWithTTL(key, value, ttlSeconds)
}

// ---------- Idempotency helpers ----------
//
// Three-call protocol for dedupe on retried POSTs:
//   1. `claimIdempotencySlot(scope, key, value, ttl)` - atomic SET NX EX. Returns
//      true if newly claimed, false if the slot was already taken.
//   2. `getIdempotencySlot(scope, key)` - read the original claim payload (so a
//      retry can compare its current request against the original and reject
//      hash mismatches that would indicate key reuse).
//   3. `releaseIdempotencySlot(scope, key)` - delete the claim. Called when the
//      claiming request failed downstream (RPC error, verification reject) so
//      that a retry with corrected data can proceed instead of getting a
//      cached failure.
//
// The `scope` namespaces keys to prevent collision between unrelated callers
// (e.g., swap-log vs profile-write). Keys are stored as `idempotency:{scope}:{key}`.
// Default TTL: 24h. Anything longer would burden the KV store; anything shorter
// risks repeated processing on retries that exceed the window.

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
// When the Privy webhook receiver verifies an event, it writes a small
// summary to KV so the rest of the app can short-circuit polling / enrich
// analytics. Two scopes today:
//   1. `tx-status:{txHash}` - latest known status from transaction.* events.
//      Lets client-side waitForConfirmation skip RPC polling if KV already
//      knows the tx is confirmed/failed. 7-day TTL keeps the store bounded.
//   2. `user-events:{did}` - rolling list (capped at 50) of user lifecycle
//      events (login, wallet creation, MFA changes). Useful for support
//      tooling + lightweight funnel analytics without paying a posthog-node
//      dependency yet.

// EVM 0x-hex(64) or Solana base58(87-88). Defense-in-depth: the webhook
// pulls the hash from (signature-verified but attacker-shaped) event data,
// so validate the shape before it becomes a KV key to prevent key injection.
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

// ---------- Token-view leaderboard ("Most Visited" tab) ----------
//
// Real Trading-Platform token-page visits, ranked by visits WITHIN a selected
// window (5m/1h/6h/24h). That needs per-hit TIMESTAMPS, not just counts - so we
// store one JSON blob `{ member: { ...meta, hits: [ts...], lv } }`, mirroring the
// dev in-memory Map exactly (unified counting logic). The reader counts hits
// >= now-window per token and ranks by that. Reads are ONE KV get (cheap; the
// tab is polled + 15s KV-cached); writes are a read-modify-write of the blob,
// bounded (cap members + hits, 24h prune, 48h TTL). Beta-appropriate; revisit
// with per-token timestamp ZSETs if write volume ever dwarfs reads.

const VIEW_BLOB_KEY = 'mv:views:v2'         // v2: timestamps (v1 was daily counts)
const VIEW_BLOB_TTL = 2 * 24 * 60 * 60       // 48h
const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000   // max retained window
const VIEW_MAX_MEMBERS = 2000                // bound the blob
const VIEW_MAX_HITS = 300                     // bound per-token timestamps

// member = `${networkId}:${normAddr}`; meta = { address, networkId, symbol, name, logo, createdAt }.
export async function recordTokenViewKv(member, meta, now) {
  if (!member) return
  try {
    const blob = (await getJsonWithTTL(VIEW_BLOB_KEY)) || {}
    const cutoff = now - VIEW_WINDOW_MS
    let entry = blob[member]
    if (!entry) {
      const keys = Object.keys(blob)
      if (keys.length >= VIEW_MAX_MEMBERS) {
        // evict the least-recently-viewed token to stay bounded
        let oldestK = null, oldestLv = Infinity
        for (const k of keys) { const lv = blob[k]?.lv || 0; if (lv < oldestLv) { oldestLv = lv; oldestK = k } }
        if (oldestK) delete blob[oldestK]
      }
      entry = { a: meta.address, n: Number(meta.networkId), s: '', nm: '', l: '', c: null, hits: [] }
      blob[member] = entry
    }
    if (meta.symbol) entry.s = meta.symbol
    if (meta.name) entry.nm = meta.name
    if (meta.logo) entry.l = meta.logo
    if (meta.createdAt) entry.c = meta.createdAt
    entry.hits = (entry.hits || []).filter(t => t >= cutoff)
    entry.hits.push(now)
    if (entry.hits.length > VIEW_MAX_HITS) entry.hits = entry.hits.slice(-VIEW_MAX_HITS)
    entry.lv = now
    await setJsonWithTTL(VIEW_BLOB_KEY, blob, VIEW_BLOB_TTL)
  } catch (err) {
    console.warn('[kv] recordTokenView failed:', err?.message)
  }
}

// Returns [{ member, views, total24h, meta }] ranked by visits in the last
// windowMs. views = hits within the window; total24h = full retained count.
export async function getTopTokenViewsKv(windowMs, now, limit = 30) {
  try {
    const blob = (await getJsonWithTTL(VIEW_BLOB_KEY)) || {}
    const winStart = now - windowMs
    const out = []
    for (const [member, e] of Object.entries(blob)) {
      if (!e || !Array.isArray(e.hits)) continue
      let views = 0
      for (const t of e.hits) if (t >= winStart) views++
      if (!views) continue
      out.push({
        member,
        views,
        total24h: e.hits.length,
        lv: e.lv || 0,
        meta: { address: e.a, networkId: e.n, symbol: e.s, name: e.nm, logo: e.l, createdAt: e.c },
      })
    }
    out.sort((a, b) => (b.views - a.views) || (b.lv - a.lv))
    return out.slice(0, limit)
  } catch (err) {
    console.warn('[kv] getTopTokenViews failed:', err?.message)
    return []
  }
}

export async function getCodexCache(action, paramsKey) {
  return kvGetWithTTL(`codex:v1:${action}:${paramsKey}`)
}

export async function setCodexCache(action, paramsKey, value, ttlSeconds) {
  return kvSetWithTTL(`codex:v1:${action}:${paramsKey}`, value, ttlSeconds)
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

export async function getTokenColorsBatch(logoUrls) {
  if (!Array.isArray(logoUrls) || logoUrls.length === 0) return {}
  const unique = [...new Set(logoUrls.filter(Boolean))]
  const results = await Promise.all(unique.map(async (url) => [url, await getTokenColor(url)]))
  return Object.fromEntries(results)
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

  // SET NX on the reverse-lookup closes a TOCTOU window where two
  // concurrent /code calls could collide on the same generated code.
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

// SET NX on `referred:{userId}` so two concurrent /apply calls for
// different codes can't both succeed for the same user. Returns true
// if the referral was recorded, false if the user was already referred.
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

// ---------- Fee config (admin-managed, KV-backed, shared with research) ----------
//
// Both research and trading apps read the same KV key so an admin update
// on one is reflected on the other. See apps/research/api/_lib/kv.js for the
// full migration rationale. Module-level cache: 60s.

const FEE_CONFIG_KEY = 'admin:fee-config'
const FEE_CONFIG_TTL_MS = 60_000

let _feeCache = null
let _feeCacheExpiry = 0

// Fee config schema (refactored 2026-05-22 for the 90/5/5 unified custodial
// + USDC consolidation architecture). New shape:
//   {
//     fee: { bps, percentage },
//     collector: { evm, solana },       // aggregator routes fees here (single per chain)
//     recipients: {                       // 90/5/5 USDC destinations per chain
//       evm: [{ address, shareBps }, ...],
//       solana: [{ address, shareBps }, ...],
//     },
//     // Legacy (deprecated, kept for transition window):
//     feePercentage, feeBps, feeWallets,
//   }
// Server-only signing keys (COLLECTOR_EVM_PRIVATE_KEY, COLLECTOR_SOL_SECRET_KEY)
// are NEVER part of feeConfig - read directly from process.env by the cron only.

function buildDefaultFeeConfig() {
  const feePercentage = parseFloat(process.env.FEE_PERCENTAGE || '1.0')
  const feeBps = parseInt(process.env.FEE_BPS || '100', 10)

  // Prefer new env vars; fall back to legacy primary so existing deploys
  // keep working until env is migrated.
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

    // Legacy fields - written so old readers keep working through the
    // deploy window. Remove after Day 5 when verified env is fully migrated.
    feePercentage,
    feeBps,
    // Shares mirror the wired split (recipients shareBps 9000/500/500 = 90/5/5).
    // The `share` field is display-only (admin panel), but it MUST agree with
    // the real split or it misleads - 96/2/2 was stale.
    feeWallets: {
      primary: { evm: collectorEvm, solana: collectorSol, share: 90 },
      secondary: {
        evm: process.env.FEE_WALLET_SECONDARY_EVM || recipientsEvm[1]?.address || '',
        solana: process.env.FEE_WALLET_SECONDARY_SOL || recipientsSol[1]?.address || '',
        share: 5,
      },
      tertiary: {
        evm: process.env.FEE_WALLET_TERTIARY_EVM || recipientsEvm[2]?.address || '',
        solana: process.env.FEE_WALLET_TERTIARY_SOL || recipientsSol[2]?.address || '',
        share: 5,
      },
    },
  }
}

// Normalize a stored fee-config to guarantee the NEW shape (collector, recipients,
// fee) is present even when the KV value was written under the old schema.
// Idempotent: safe to call on already-normalized configs.
function normalizeFeeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return buildDefaultFeeConfig()

  const out = { ...cfg }

  if (!out.fee) {
    out.fee = {
      bps: cfg.feeBps ?? parseInt(process.env.FEE_BPS || '100', 10),
      percentage: cfg.feePercentage ?? parseFloat(process.env.FEE_PERCENTAGE || '1.0'),
    }
  }
  // collector: ALWAYS resolve, letting a non-empty env/legacy value backfill an
  // EMPTY stored field - not just an absent one. buildDefaultFeeConfig seeds a
  // `collector` object into KV, so a config first written before
  // COLLECTOR_EVM_ADDRESS existed pins collector.evm='' in KV. Since the stored
  // config wins over env, the fee recipient would stay "(none)" forever even
  // after the env is set + redeployed (exactly what blocked prod EVM fees). The
  // env now backfills an empty stored value.
  out.collector = {
    evm: cfg.collector?.evm || cfg.feeWallets?.primary?.evm || process.env.COLLECTOR_EVM_ADDRESS || '',
    solana: cfg.collector?.solana || cfg.feeWallets?.primary?.solana || process.env.COLLECTOR_SOL_ADDRESS || '',
  }
  if (!out.recipients) {
    // Derive from legacy primary/secondary/tertiary at the documented 90/5/5
    // shares. If the stored config had different shares, they were not
    // actually consumed anywhere - safe to canonicalize to 9000/500/500.
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
