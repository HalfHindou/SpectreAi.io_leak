/**
 * Shared auth helper - verifies Privy JWT tokens server-side.
 *
 * 2026-05-24: dropped @privy-io/node and verify Privy access tokens
 * directly with `jose`. The @privy-io/node package pulls svix (webhooks)
 * + several @hpke crypto deps; Vercel's nft was not following them
 * through our dynamic `await import('@privy-io/node')`, the import
 * threw `[auth] loadDeps fail step=import-privy ...node_modules/svix/...`,
 * and every authed endpoint 401'd silently.
 *
 * Privy tokens are standard ES256 JWTs signed against the public JWKS
 * served at https://auth.privy.io/api/v1/apps/{app_id}/jwks.json, so
 * `jose.jwtVerify(token, jwks, { issuer: 'privy.io', audience: appId })`
 * gives equivalent verification with one tiny dep that Vercel reliably
 * bundles. The shape we return is unchanged: { user_id } payload sub.
 *
 * Required env: PRIVY_APP_ID
 */

let _jwtVerify = null
let _createRemoteJWKSet = null
let _jwks = null
let _loadError = null

async function loadDeps() {
  if (_jwtVerify && _createRemoteJWKSet) return true
  if (_loadError) return false
  try {
    const jose = await import('jose')
    _jwtVerify = jose.jwtVerify
    _createRemoteJWKSet = jose.createRemoteJWKSet
    if (typeof _jwtVerify !== 'function') throw new Error(`jose.jwtVerify is ${typeof _jwtVerify}`)
    if (typeof _createRemoteJWKSet !== 'function') throw new Error(`jose.createRemoteJWKSet is ${typeof _createRemoteJWKSet}`)
    return true
  } catch (err) {
    _loadError = err
    const code = err?.code || err?.name || 'Error'
    const msg = (err?.message || String(err)).slice(0, 200)
    console.error(`[auth] loadDeps fail code=${code} msg=${msg}`)
    return false
  }
}

function getJwks() {
  if (_jwks) return _jwks
  const appId = process.env.PRIVY_APP_ID
  if (!appId) {
    throw new Error('PRIVY_APP_ID must be set')
  }
  _jwks = _createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`))
  return _jwks
}

/**
 * Extract the Privy access token from a request.
 *
 * Primary source: the `Authorization: Bearer <token>` header (localStorage
 * mode - the frontend always sends this via getAccessToken(), which keeps
 * working even when HttpOnly cookies are enabled).
 *
 * Fallback: the `privy-token` first-party cookie. Once HttpOnly cookies are
 * enabled on the production Privy app (cookie domain spectreai.io, for
 * cross-subdomain SSO), the access token also rides as this cookie. Reading
 * it here is defense-in-depth for cookie-only / future-SSR callers that may
 * not set the Authorization header. Non-breaking: header takes precedence.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function extractToken(req) {
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7)
    if (t) return t
  }
  const cookieHeader = req.headers.cookie
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
 * Verify the Privy access token (Authorization header or privy-token cookie).
 * Returns the verified userId (Privy DID) or null if invalid.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string|null>} userId (e.g. "did:privy:abc123") or null
 */
export async function verifyPrivyToken(req) {
  const token = extractToken(req)
  if (!token) return null

  const loaded = await loadDeps()
  if (!loaded) return null

  try {
    const { payload } = await _jwtVerify(token, getJwks(), {
      issuer: 'privy.io',
      audience: process.env.PRIVY_APP_ID,
      // jose checks exp + nbf automatically; tokens are ES256-signed by Privy.
    })
    // Privy JWT `sub` is the user's DID (e.g. "did:privy:abc123").
    return payload?.sub || null
  } catch (err) {
    // Token expired, invalid signature, wrong audience, JWKS fetch failed, etc.
    console.warn('[auth] Token verification failed:', err?.code || err?.name || 'Error', err?.message)
    return null
  }
}
