// Shared auth helper - verifies Privy access tokens server-side with `jose`
// against Privy's public JWKS. Mirrors apps/<app>/api/_lib/auth.js (which
// dropped the Privy server SDK on 2026-05-24) but in CJS for Express.
//
// Privy tokens are standard ES256 JWTs signed against the public JWKS at
// https://auth.privy.io/api/v1/apps/{app_id}/jwks.json, so
// jwtVerify(token, jwks, { issuer: 'privy.io', audience: appId }) is full
// verification. The `sub` claim is the user's DID ("did:privy:...").
//
// Requires env: PRIVY_APP_ID. (PRIVY_APP_SECRET only for getPrivyClient.)

let _jose = null
let _jwks = null
let _jwksAppId = null

async function loadJose() {
  if (_jose) return _jose
  _jose = await import('jose')
  return _jose
}

function getJwks(jose) {
  const appId = process.env.PRIVY_APP_ID
  if (!appId) throw new Error('PRIVY_APP_ID must be set')
  // Re-create if the app id changed (dev app swap without process restart)
  if (_jwks && _jwksAppId === appId) return _jwks
  _jwks = jose.createRemoteJWKSet(
    new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`)
  )
  _jwksAppId = appId
  return _jwks
}

/**
 * Extract the Privy access token: `Authorization: Bearer` header primary,
 * `privy-token` first-party cookie as fallback (mirrors serverless twin).
 */
function extractToken(req) {
  const auth = req.headers && req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim()
    if (t) return t
  }
  const cookieHeader = req.headers && req.headers.cookie
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      if (part.slice(0, eq).trim() === 'privy-token') {
        const v = part.slice(eq + 1).trim()
        if (v) return decodeURIComponent(v)
      }
    }
  }
  return null
}

/**
 * Verify the Privy access token from the request.
 * Returns the verified userId (Privy DID) or null if invalid.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string|null>}
 */
async function verifyPrivyToken(req) {
  const token = extractToken(req)
  if (!token) return null

  try {
    const jose = await loadJose()
    const { payload } = await jose.jwtVerify(token, getJwks(jose), {
      issuer: 'privy.io',
      audience: process.env.PRIVY_APP_ID,
      // jose checks exp + nbf automatically; tokens are ES256-signed by Privy.
    })
    return (payload && payload.sub) || null
  } catch (err) {
    console.warn(
      '[auth] Token verification failed:',
      (err && (err.code || err.name)) || 'Error',
      err && err.message
    )
    return null
  }
}

/**
 * Express middleware - verifies JWT, sets req.userId, or returns 401.
 */
async function requirePrivyAuth(req, res, next) {
  const userId = await verifyPrivyToken(req)
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  req.userId = userId
  next()
}

/**
 * DEAD in practice: @privy-io/server-auth is no longer installed anywhere in
 * the monorepo, so this throws at call time (same behavior as before the jose
 * rewrite). Sole consumer is routes/social.js. Port that call to Privy's REST
 * API or @privy-io/node before relying on it.
 */
let _client = null
let _clientPromise = null

async function getPrivyClient() {
  if (_client) return _client
  if (_clientPromise) return _clientPromise

  _clientPromise = (async () => {
    const appId = process.env.PRIVY_APP_ID
    const appSecret = process.env.PRIVY_APP_SECRET
    if (!appId || !appSecret) {
      throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET must be set')
    }
    const { PrivyClient } = await import('@privy-io/server-auth')
    _client = new PrivyClient(appId, appSecret)
    return _client
  })()

  return _clientPromise
}

module.exports = { verifyPrivyToken, requirePrivyAuth, getPrivyClient }
