/**
 * KMS authorization-signature format contract.
 *
 * Proves the engine's KMS sign path produces a signature Privy will accept,
 * WITHOUT a live KMS. GCP KMS EC_SIGN_P256_SHA256 returns a DER ECDSA sig
 * over the SHA-256 digest, with NO low-S guarantee - identical in shape to
 * what OpenSSL (node crypto) emits, which we use here as the KMS stand-in.
 * The Privy raw-key path (verified in @privy-io/node@0.16.0 authorization.js:
 * 109) is `p256.sign(sha256(payload), key).toBytes('der')` -> base64, i.e.
 * noble low-S DER. So the KMS output must be normalized to low-S to match.
 *
 * Run: node src/__tests__/kms-signer.test.js
 */
const crypto = require('crypto')
const { p256 } = require('@noble/curves/nist')
const { sha256 } = require('@noble/hashes/sha2')
const privy = require('../privy')

let failures = 0
const check = (cond, msg) => {
  if (cond) { console.log('  ok -', msg) } else { failures++; console.log('  FAIL -', msg) }
}

const HALF_N = p256.CURVE.n / 2n

// node EC keypair; export the public point (uncompressed) for noble verify
const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = kp.publicKey.export({ format: 'jwk' })
const pubUncompressed = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
])

const payload = crypto.randomBytes(96) // stands in for Privy's canonicalized auth payload
const digest = Buffer.from(sha256(payload)) // what both KMS and the raw-key path sign

console.log('KMS signer format contract:')

// 1. KMS stand-in: OpenSSL signs sha256(payload) -> DER, random k, ~50% high-S.
//    Loop until we capture a HIGH-S sig so the normalization branch is exercised.
let highSDer = null
for (let i = 0; i < 60 && !highSDer; i++) {
  const der = crypto.sign('sha256', payload, { key: kp.privateKey, dsaEncoding: 'der' })
  const s = p256.Signature.fromBytes(der, 'der').s
  if (s > HALF_N) highSDer = der
}
check(!!highSDer, 'produced a high-S KMS-like DER signature to exercise normalization')

// 2. The raw high-S sig is a VALID ECDSA sig cryptographically (node accepts it)...
check(crypto.verify('sha256', payload, kp.publicKey, highSDer), 'raw high-S sig verifies under node (cryptographically valid)')
// ...but is high-S, which a strict low-S verifier (noble, Privy) rejects.
check(p256.Signature.fromBytes(highSDer, 'der').s > HALF_N, 'raw sig is confirmed high-S (would be rejected by a low-S verifier)')

// 3. The engine transform: normalize -> low-S DER -> base64.
const b64 = privy.derToLowSBase64(highSDer)
const outDer = Buffer.from(b64, 'base64')
const outSig = p256.Signature.fromBytes(outDer, 'der')

check(outSig.s <= HALF_N, 'normalized signature is low-S (<= n/2)')
check(outSig.r === p256.Signature.fromBytes(highSDer, 'der').r, 'r is unchanged by normalization')
check(p256.verify(outSig, digest, pubUncompressed), 'normalized sig verifies under NOBLE against sha256(payload) - Privy verification path')
check(crypto.verify('sha256', payload, kp.publicKey, outDer), 'normalized sig also verifies under node')

// 4. Idempotency: an already-low-S sig passes through unchanged.
const again = privy.derToLowSBase64(outDer)
check(again === b64, 'normalization is idempotent on an already-low-S signature')

// 5. Equivalence to the SDK raw-key path: noble signs the SAME digest and
//    the sig verifies - confirming the digest semantics (sha256(payload))
//    match what KMS signs. NOTE: noble's p256.sign is NOT low-S by default
//    in v1.9.7, so the SDK raw-key path (which passed the dev gate test with
//    real fills) itself emits high-S ~50% of the time -> Privy accepts high-S.
//    Our low-S normalization is therefore defensive canonicalization
//    (malleability-safe, a strict subset of what Privy accepts), never a
//    correctness dependency. Confirm it is safe on ANY valid sig, incl. the
//    SDK's: normalizing it still verifies and is low-S.
const priv = Buffer.from(kp.privateKey.export({ format: 'jwk' }).d, 'base64url')
const sdkDer = p256.sign(digest, priv).toBytes('der')
check(p256.verify(p256.Signature.fromBytes(sdkDer, 'der'), digest, pubUncompressed), 'SDK-equivalent raw-key sig over the same digest verifies (digest semantics match)')
const normSdk = p256.Signature.fromBytes(Buffer.from(privy.derToLowSBase64(sdkDer), 'base64'), 'der')
check(normSdk.s <= HALF_N && p256.verify(normSdk, digest, pubUncompressed), 'normalizing any valid sig (incl. the SDK path output) yields a verifying low-S sig')

// 6. Context switch: KMS path chosen only when PRIVY_KMS_KEY is set.
const hadKms = process.env.PRIVY_KMS_KEY
const hadB64 = process.env.PRIVY_AUTHORIZATION_KEY_B64
delete process.env.PRIVY_KMS_KEY
process.env.PRIVY_AUTHORIZATION_KEY_B64 = 'ZmFrZQ==' // any value so the raw path resolves
const rawCtx = privy.buildAuthContext()
check(Array.isArray(rawCtx.authorization_private_keys) && !rawCtx.sign_fns, 'no PRIVY_KMS_KEY -> raw-key context (dev path)')
process.env.PRIVY_KMS_KEY = 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1'
const kmsCtx = privy.buildAuthContext()
check(Array.isArray(kmsCtx.sign_fns) && kmsCtx.sign_fns.length === 1 && !kmsCtx.authorization_private_keys, 'PRIVY_KMS_KEY set -> sign_fns context (prod KMS path)')
// restore
if (hadKms === undefined) delete process.env.PRIVY_KMS_KEY; else process.env.PRIVY_KMS_KEY = hadKms
if (hadB64 === undefined) delete process.env.PRIVY_AUTHORIZATION_KEY_B64; else process.env.PRIVY_AUTHORIZATION_KEY_B64 = hadB64

console.log(failures ? `\n${failures} FAILURES` : '\nall KMS signer tests passed')
process.exit(failures ? 1 : 0)
