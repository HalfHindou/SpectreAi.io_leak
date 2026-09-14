/**
 * Privy session-signer execution for the order engine.
 *
 * The user's embedded wallet granted our key quorum as a session signer
 * (policy-scoped: Jupiter swap program stack only). We sign requests with
 * the quorum's P-256 authorization key; Privy's TEE signs the actual
 * Solana transaction with the USER'S key, which never leaves the enclave.
 *
 * The authorization signature is chosen at runtime:
 *   PRIVY_KMS_KEY (prod)  a GCP KMS EC_SIGN_P256_SHA256 key-version resource
 *                         name. Signing runs via the Privy SDK's `sign_fns`
 *                         callback -> GCP KMS asymmetricSign. NO private key
 *                         material ever exists outside KMS.
 *   PRIVY_AUTHORIZATION_KEY_B64 (dev)  base64 PKCS8, no PEM headers.
 *   PRIVY_AUTHORIZATION_KEY_FILE (dev)  path to a PEM file.
 * KMS wins when set; the raw-key path is the dev fallback.
 *
 * Signature-format contract (verified against @privy-io/node@0.16.0
 * lib/authorization.js:55,109): the SDK's raw-key path computes
 * `p256.sign(sha256(payload), key).toBytes('der')` then base64. The
 * `sign_fns` callback receives the ALREADY-canonicalized payload bytes and
 * must return a base64 ECDSA-P256 signature over sha256(payload), DER-
 * encoded. GCP KMS EC_SIGN_P256_SHA256 returns DER natively (no r||s
 * conversion), but does NOT guarantee low-S; noble emits low-S, so we
 * normalize to keep the KMS signature bit-compatible with the raw path.
 * The SDK property is `sign_fns` (NOT the docs' `sign_functions` - the
 * docs example is ahead of the shipped 0.16.0 source).
 */
const fs = require('fs')
const crypto = require('crypto')
const { PrivyClient } = require('@privy-io/node')
const { p256 } = require('@noble/curves/nist')

const SOLANA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'

let _client = null
let _authKey = null
let _kms = null

function authorizationKeyB64() {
  if (_authKey) return _authKey
  if (process.env.PRIVY_AUTHORIZATION_KEY_B64) {
    _authKey = process.env.PRIVY_AUTHORIZATION_KEY_B64.trim()
    return _authKey
  }
  const file = process.env.PRIVY_AUTHORIZATION_KEY_FILE
  if (file && fs.existsSync(file)) {
    const pem = fs.readFileSync(file, 'utf8')
    _authKey = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
    return _authKey
  }
  throw new Error('no authorization key (set PRIVY_AUTHORIZATION_KEY_B64 or PRIVY_AUTHORIZATION_KEY_FILE)')
}

function kmsClient() {
  if (_kms) return _kms
  const { KeyManagementServiceClient } = require('@google-cloud/kms')
  _kms = new KeyManagementServiceClient() // ADC = the Cloud Run SA (cloudkms.signerVerifier)
  return _kms
}

/**
 * Convert a KMS/OpenSSL DER ECDSA-P256 signature into the exact form the
 * Privy API expects: low-S normalized (KMS does not guarantee low-S; the
 * SDK's noble raw-key path emits low-S, and a strict verifier rejects
 * high-S), re-encoded DER, base64. This is the whole KMS-output transform,
 * extracted so it is directly unit-testable without a live KMS.
 */
function derToLowSBase64(der) {
  const buf = Buffer.isBuffer(der) ? der : Buffer.from(der)
  const lowS = p256.Signature.fromBytes(buf, 'der').normalizeS().toBytes('der')
  return Buffer.from(lowS).toString('base64')
}

/**
 * GCP KMS sign function for the Privy `sign_fns` authorization context.
 * payload = the SDK's already-formatted authorization bytes. We sign
 * sha256(payload) (matching the raw-key path's `p256.sign(sha256(payload))`),
 * normalize to low-S, and base64 the DER. Retries transient KMS blips; a
 * throw here happens strictly BEFORE Privy broadcasts, so it is never a
 * double-spend risk (executor parks unknown outcomes for review).
 */
async function kmsSignFn(payload) {
  const name = process.env.PRIVY_KMS_KEY
  const digest = crypto.createHash('sha256').update(payload).digest()
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [res] = await kmsClient().asymmetricSign({ name, digest: { sha256: digest } })
      if (!res?.signature) throw new Error('kms returned no signature')
      return derToLowSBase64(res.signature)
    } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  throw new Error(`kms sign failed: ${lastErr?.message || lastErr}`)
}

/** Build the authorization context: KMS sign_fn in prod, raw key in dev. */
function buildAuthContext() {
  if (process.env.PRIVY_KMS_KEY) return { sign_fns: [kmsSignFn] }
  return { authorization_private_keys: [authorizationKeyB64()] }
}

function client() {
  if (_client) return _client
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) throw new Error('PRIVY_APP_ID/PRIVY_APP_SECRET required')
  _client = new PrivyClient({ appId, appSecret })
  return _client
}

/**
 * Re-verify the wallet still carries delegated:true IMMEDIATELY before
 * signing (revocation is not atomic - this narrows the window).
 * Returns { ok, walletId } or { ok:false, reason }.
 */
async function verifyStillDelegated({ userId, walletAddress }) {
  const appId = process.env.PRIVY_APP_ID
  const auth = 'Basic ' + Buffer.from(`${appId}:${process.env.PRIVY_APP_SECRET}`).toString('base64')
  // Idempotent GET - retried. A single 6s stall here killed a live
  // execution on 2026-07-11 (gate test). Only a definitive 2xx/4xx answers
  // the delegation question: 5xx/429/network THROW after retries so the
  // caller treats the attempt as transient instead of AUTO-CANCELLING the
  // user's order over a Privy blip. Fail-closed is preserved - a throw
  // never signs.
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: auth, 'privy-app-id': appId },
        signal: AbortSignal.timeout(attempt === 0 ? 6000 : 8000),
      })
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`privy ${res.status}`)
      } else if (!res.ok) {
        return { ok: false, reason: `privy user lookup ${res.status}` }
      } else {
        const user = await res.json()
        const wallet = (user?.linked_accounts || []).find((a) =>
          a.type === 'wallet' && a.address && a.address.toLowerCase() === String(walletAddress).toLowerCase())
        if (!wallet) return { ok: false, reason: 'wallet not linked' }
        if (!wallet.delegated) return { ok: false, reason: 'signer_revoked' }
        return { ok: true, walletId: wallet.id || wallet.wallet_id || null }
      }
    } catch (err) { lastErr = err }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
  }
  throw new Error(`delegation check unavailable: ${lastErr?.message || lastErr}`)
}

/**
 * Sign + broadcast a base64 Solana transaction from the user's delegated
 * wallet via the Privy TEE, under the session-signer policy.
 * Returns { hash } or throws (policy denial surfaces as an API error).
 */
async function signAndSendSolana({ walletId, transactionB64, idempotencyKey }) {
  const res = await client().wallets().solana().signAndSendTransaction(walletId, {
    caip2: SOLANA_CAIP2,
    transaction: transactionB64,
    authorization_context: buildAuthContext(),
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  })
  return { hash: res?.hash || res?.signature || null, raw: res }
}

module.exports = { SOLANA_CAIP2, verifyStillDelegated, signAndSendSolana, kmsSignFn, buildAuthContext, derToLowSBase64 }
