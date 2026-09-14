/**
 * Vercel Serverless Function - Token Security (Deployer Security panel)
 * GoPlus Security API - free tier. Codex has no honeypot/tax/LP-burn data
 * (only isScam + mintable/freezable), so GoPlus is the source.
 * Mirrors the Express route in packages/server/index.js (/api/token-tax).
 *
 * Scale hardening (free plan is 30 req/min):
 * - KV-backed cache shared across lambda instances + regions, tiered TTL:
 *   established tokens (>=1000 holders) 24h - their security profile is
 *   effectively immutable; fresh launches 30min - renounce/LP-burn/limit
 *   changes happen early in a token's life.
 * - Optional signed auth: set GOPLUS_APP_KEY + GOPLUS_APP_SECRET and the
 *   quota attaches to our key instead of Vercel's shared egress IP.
 *   Without the env vars it degrades to unauthenticated (still works).
 */
import { createHash } from 'node:crypto'
import { getJsonWithTTL, setJsonWithTTL } from './_lib/kv.js'

const SOLANA_NETWORK_ID = 1399811149
const TTL_ESTABLISHED = 24 * 60 * 60 // 24h - >=1000 holders, profile frozen in practice
const TTL_FRESH = 30 * 60            // 30min - fresh launch, security can still change
const TTL_NEGATIVE = 5 * 60          // 5min - not indexed by GoPlus yet
const ESTABLISHED_HOLDERS = 1000
const LP_BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
])

// ---------- GoPlus signed auth (optional, activates via env) ----------
// POST /api/v1/token with sign = sha1(app_key + time + app_secret); the
// returned access_token goes in the Authorization header (raw, no Bearer).
let _gpToken = null
let _gpTokenExpiry = 0

async function goplusAuthHeaders() {
  const appKey = process.env.GOPLUS_APP_KEY
  const appSecret = process.env.GOPLUS_APP_SECRET
  if (!appKey || !appSecret) return {}
  const now = Date.now()
  if (_gpToken && now < _gpTokenExpiry) return { Authorization: _gpToken }
  try {
    const time = Math.floor(now / 1000)
    const sign = createHash('sha1').update(`${appKey}${time}${appSecret}`).digest('hex')
    const r = await fetch('https://api.gopluslabs.io/api/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_key: appKey, time, sign }),
      signal: AbortSignal.timeout(5000),
    })
    const j = await r.json()
    const token = j?.result?.access_token
    if (token) {
      _gpToken = token
      // renew 5min before expiry (GoPlus default validity ~1h)
      _gpTokenExpiry = now + Math.max(60, (Number(j.result.expires_in) || 3600) - 300) * 1000
      return { Authorization: token }
    }
  } catch { /* fall through to unauthenticated */ }
  return {}
}

// ---------- GoPlus response mapping ----------

function top10Percent(holders) {
  if (!Array.isArray(holders) || holders.length === 0) return null
  let sum = 0
  for (const h of holders.slice(0, 10)) sum += parseFloat(h.percent) || 0
  return Math.min(100, sum * 100)
}

function mapGoPlusEvm(d, tokenAddress) {
  const pct = (v) => (v === '' || v == null || isNaN(parseFloat(v)) ? null : parseFloat(v) * 100)
  let burned = 0, locked = 0
  const lockers = []
  const addrLower = String(tokenAddress).toLowerCase()
  for (const h of d.lp_holders || []) {
    const a = String(h.address || '').toLowerCase()
    const p = parseFloat(h.percent) || 0
    // LP sent to zero/dead or to the token's own contract is unrecoverable -
    // market convention (PEPE holds 99.9% of its V2 LP in the token contract).
    if (LP_BURN_ADDRESSES.has(a) || a === addrLower) burned += p
    else if (h.is_locked === 1 || h.is_locked === '1') {
      locked += p
      // Who holds the lock - GoPlus tags known lockers (TeamFinance, UNCX, PinkLock...)
      if (p >= 0.001) lockers.push({ tag: h.tag || null, address: h.address, percent: Math.min(100, p * 100) })
    }
  }
  lockers.sort((x, y) => y.percent - x.percent)
  // Main pool pair (V2-style 20-byte addresses only - V4 pool ids are 32 bytes
  // and have no token page). lp_holders refer to this pair's LP token; the
  // explorer link {explorer}/token/{pair}?a={locker} is the on-chain lock proof.
  let lpPair = null, lpLiq = -1
  for (const p of d.dex || []) {
    const liq = parseFloat(p.liquidity) || 0
    if (/^0x[0-9a-fA-F]{40}$/.test(p.pair || '') && liq > lpLiq) { lpPair = p.pair; lpLiq = liq }
  }
  // Ownership: '' or zero/dead owner = renounced (GoPlus: ownerless / black
  // hole owner). hidden_owner or take-back trumps - that "renounce" is a rug vector.
  const owner = d.owner_address == null ? null : String(d.owner_address).toLowerCase()
  const hiddenOwner = d.hidden_owner === '1'
  const renounced = owner == null ? null
    : (!hiddenOwner && d.can_take_back_ownership !== '1' && (owner === '' || LP_BURN_ADDRESSES.has(owner)))
  // GoPlus capability flags report function EXISTENCE in the contract. With
  // ownership truly renounced nobody can call the owner-gated setters, so
  // report the exploitable state, not the dead code (SPECTRE: slippage_modifiable
  // =1 but owner is the zero address - taxes can never change).
  const ownerDead = renounced === true
  return {
    buyTax: pct(d.buy_tax),
    sellTax: pct(d.sell_tax),
    isHoneypot: d.is_honeypot === '1',
    cannotSellAll: d.cannot_sell_all === '1',
    taxModifiable: ownerDead ? false : (d.slippage_modifiable === '1' || d.personal_slippage_modifiable === '1'),
    mintable: d.is_mintable == null ? null : (ownerDead ? false : d.is_mintable === '1'),
    canFreeze: ownerDead ? false : (d.is_blacklisted === '1' || d.transfer_pausable === '1'),
    renounced,
    hiddenOwner,
    openSource: d.is_open_source == null ? null : d.is_open_source === '1',
    top10Percent: top10Percent(d.holders),
    hasCooldown: d.trading_cooldown === '1',
    hasAntiWhale: d.is_anti_whale == null ? null : d.is_anti_whale === '1',
    maxTxPercent: null, // GoPlus reports anti-whale as a flag, not a percent
    lpBurnedPercent: (d.lp_holders || []).length ? Math.min(100, burned * 100) : null,
    lpLockedPercent: (d.lp_holders || []).length ? Math.min(100, locked * 100) : null,
    lpLockers: lockers.slice(0, 3),
    lpPair,
  }
}

function mapGoPlusSolana(d) {
  // Token-2022 transfer fee; classic SPL has no transfer tax (fee = 0).
  // Shape is sparse/evolving - try fraction, then basis points.
  const tf = d?.transfer_fee || {}
  let feePct = parseFloat(tf.fee_rate ?? d?.transfer_fee_rate)
  if (!Number.isFinite(feePct)) {
    const bps = parseFloat(tf.current_fee_rate ?? tf.transfer_fee_basis_points)
    feePct = Number.isFinite(bps) ? bps / 10000 : 0
  }
  const tax = feePct * 100
  let burn = null
  for (const pool of d.dex || []) {
    const b = parseFloat(pool.burn_percent)
    if (Number.isFinite(b)) burn = Math.max(burn ?? 0, b)
  }
  let locked = 0
  const lockers = []
  for (const h of d.lp_holders || []) {
    const p = parseFloat(h.percent) || 0
    if ((h.is_locked === 1 || h.is_locked === '1') && p >= 0.001) {
      locked += p
      lockers.push({ tag: h.tag || null, address: h.address || h.account || null, percent: Math.min(100, p * 100) })
    }
  }
  lockers.sort((x, y) => y.percent - x.percent)
  const status = (k) => d?.[k]?.status === '1'
  const mintable = status('mintable')
  const canFreeze = status('freezable')
  const balanceMutable = status('balance_mutable_authority')
  const closable = status('closable')
  return {
    buyTax: tax,
    sellTax: tax,
    isHoneypot: d.non_transferable === '1',
    cannotSellAll: false,
    taxModifiable: status('transfer_fee_upgradable'),
    mintable,
    canFreeze,
    // "Renounced" on Solana = the dangerous authorities are all revoked.
    // metadata_mutable excluded - even BONK keeps its metadata authority.
    renounced: !(mintable || canFreeze || balanceMutable || closable),
    hiddenOwner: null,
    openSource: null, // N/A for SPL programs
    top10Percent: top10Percent(d.holders),
    balanceMutable,
    closable,
    transferHook: status('transfer_hook'),
    hasCooldown: false,
    hasAntiWhale: null,
    maxTxPercent: null,
    lpBurnedPercent: burn,
    lpLockedPercent: lockers.length ? Math.min(100, locked * 100) : null,
    lpLockers: lockers.slice(0, 3),
  }
}

function holderCount(entry) {
  const n = parseInt(entry?.holder_count, 10)
  return Number.isFinite(n) ? n : 0
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { address, networkId } = req.query || {}
  if (!address) return res.status(400).json({ error: 'Missing address' })

  const netId = parseInt(networkId) || 1
  const isSolana = netId === SOLANA_NETWORK_ID
  const kvKey = `toktax:v4:${netId}:${isSolana ? address : String(address).toLowerCase()}`

  // KV first - shared across instances and regions, so each token costs
  // one GoPlus call per TTL window globally, not per lambda per region.
  const cached = await getJsonWithTTL(kvKey)
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600')
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=1800')
    return res.json(cached)
  }

  try {
    const url = isSolana
      ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(address)}`
      : `https://api.gopluslabs.io/api/v1/token_security/${netId}?contract_addresses=${encodeURIComponent(address)}`
    const headers = await goplusAuthHeaders()
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`goplus ${response.status}`)

    const json = await response.json()
    const resultMap = json.result || {}
    // GoPlus keys EVM results by lowercased address; Solana keeps case.
    const entry = resultMap[address] || resultMap[String(address).toLowerCase()]
    if (!entry) {
      const negative = { buyTax: null, sellTax: null, isHoneypot: null }
      await setJsonWithTTL(kvKey, negative, TTL_NEGATIVE)
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      return res.json(negative)
    }

    const result = isSolana ? mapGoPlusSolana(entry) : mapGoPlusEvm(entry, address)
    const ttl = holderCount(entry) >= ESTABLISHED_HOLDERS ? TTL_ESTABLISHED : TTL_FRESH
    await setJsonWithTTL(kvKey, result, ttl)

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600')
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=1800')
    return res.json(result)
  } catch {
    // Fail-soft: panel renders dashes, never errors. Short cache so a
    // GoPlus throttle window (429) doesn't pin dashes for long.
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    return res.json({ buyTax: null, sellTax: null, isHoneypot: null })
  }
}
