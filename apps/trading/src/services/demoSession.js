/**
 * Demo-session header transport (SEC-20260521-DEMOTOKEN / R2).
 *
 * When the trading app is embedded as research's "Trading Lite" iframe, research
 * postMessages a signed, IP-bound, 15-min, read-only demo token to us and we
 * attach it as an `x-demo-token` header on our own read-only market-data calls.
 * (This is the prod path per R2 - the same-site cookie was reverted because it
 * broke cross-origin backends tuned for spectre-trading.vercel.app.)
 *
 * Standalone trading (real gate cookie / Privy) never receives a token, so the
 * fetch wrapper stays inert there.
 *
 * RACE HANDLING: the token arrives via postMessage AFTER the iframe boots, so
 * the first market-data calls can fire before it's set. The wrapper therefore
 * RETRIES a same-origin /api GET that 401s once the token lands (bounded wait),
 * so boot-time calls recover instead of leaving "No data". Research also
 * (re)sends the token on an embed-ready handshake to guarantee delivery.
 *
 * Scope guards (must not widen what the cookie already allowed):
 *   - header added only to SAME-ORIGIN, RELATIVE `/api/*` GET requests
 *   - mutations are POST, so they never receive it; the server also only honors
 *     it inside isDemoSession (read-only handlers)
 *   - never logged
 */

let _token = null
let _expectToken = false
let _resolveReady
const _tokenReady = new Promise((resolve) => { _resolveReady = resolve })

export function setDemoToken(token) {
  if (typeof token === 'string' && token.length > 0) {
    _token = token
    try { _resolveReady?.(token) } catch (_) { /* noop */ }
  }
}

export function getDemoToken() {
  return _token
}

// Call when embedded: tells the wrapper a demo token is expected to arrive, so
// it waits/retries rather than giving up on a boot-time 401.
export function expectDemoToken() {
  _expectToken = true
}

let _installed = false

function _isSameOriginApiGet(input, init) {
  if (typeof input !== 'string') return false
  const method = (init?.method || 'GET').toUpperCase()
  if (method !== 'GET') return false
  return input.startsWith('/api/') || input.startsWith(`${window.location.origin}/api/`)
}

// Wrap window.fetch ONCE to inject x-demo-token on same-origin read-only /api
// GETs while a demo token is held. Inert until expectDemoToken() + a token are
// set, so it has zero effect on standalone trading.
export function installDemoFetchHeader() {
  if (_installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  _installed = true
  const orig = window.fetch.bind(window)

  const sendWithToken = (input, init) => {
    if (!_token) return orig(input, init)
    const headers = new Headers(init?.headers || {})
    headers.set('x-demo-token', _token)
    return orig(input, { ...init, headers })
  }

  window.fetch = async (input, init = {}) => {
    try {
      if (!_isSameOriginApiGet(input, init)) return orig(input, init)

      // Pre-await: when embedded and a demo token is expected but hasn't arrived
      // yet, wait BRIEFLY for it so the FIRST call fires WITH the header instead
      // of 401-then-retry. Research now mints in parallel with iframe load and
      // delivers the token via the embed-ready handshake, so it arrives in
      // ~hundreds of ms - a short cap keeps data off the critical path while a
      // missing token (authed users / mint failure) doesn't stall for long.
      if (!_token && _expectToken) {
        await Promise.race([_tokenReady, new Promise((r) => setTimeout(r, 1000))])
      }

      let res = await sendWithToken(input, init)

      // Backstop: if it still 401s and the token lands just after we fired,
      // retry ONCE with the header.
      if (res && res.status === 401 && !_token && _expectToken) {
        await Promise.race([_tokenReady, new Promise((r) => setTimeout(r, 1500))])
        if (_token) res = await sendWithToken(input, init)
      }
      return res
    } catch (_) {
      // never let the wrapper break a fetch
      return orig(input, init)
    }
  }
}
