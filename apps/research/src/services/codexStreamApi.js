/**
 * Codex Real-time Price Stream Client
 *
 * Connects to the Express SSE relay at /api/codex/stream to receive
 * real-time Codex price updates. Singleton pattern - one connection
 * shared across all consumers.
 *
 * Key design: the EventSource is opened ONCE and only replaced when the
 * token set genuinely changes AND the new connection successfully opens.
 * This prevents rapid React lifecycle churn (strict mode double-effects,
 * HMR, component remounts) from thrashing the connection.
 *
 * Usage:
 *   import { subscribe, getLatestPrice } from './codexStreamApi'
 *   const unsub = subscribe(['0xC02a...Cc2:1', 'So111...112:1399811149'], (price) => {
 *     console.log(price.address, price.priceUsd)
 *   })
 *   // later: unsub()
 */

// Active listeners: callback -> Set of tokenKeys
const _listeners = new Map()
// All token keys currently needed: tokenKey -> refcount
const _tokenRefs = new Map()
// Latest price cache: tokenKey -> { address, networkId, priceUsd, timestamp }
const _prices = new Map()
// EventSource connection
let _es = null
let _esTokenSet = '' // Sorted token set string of the active connection
let _reconnectTimer = null
let _reconnectAttempts = 0
let _connectTimer = null
// Set when a hidden tab caused us to skip/close the connection, so the
// visibilitychange handler knows to re-open on return.
let _visibilityPaused = false
const RECONNECT_BASE_MS = 2000
// 2026-09-01: raised from 30s. When the relay box is DOWN (nginx 502/503 —
// measured on prod, stream.spectreai.io returning 502 for hours) every failed
// attempt prints a red network line in the user's console. A 30s ceiling means
// 2 lines/min forever; 5 min means 1 line/5min while still recovering on its
// own once the relay comes back.
const RECONNECT_MAX_MS = 300000
const CONNECT_DEBOUNCE_MS = 150

function _currentTokenSet() {
  const keys = [..._tokenRefs.keys()]
  if (keys.length === 0) return ''
  return keys.sort().join(',')
}

function _handleMessage(event) {
  // Belt-and-braces with the 'connected' listener below: data arriving IS a
  // working connection, so the backoff must reset here too. Without this, a
  // relay that stopped emitting 'connected' would let the delay climb to the
  // 5-minute ceiling on a stream that is actually healthy.
  _reconnectAttempts = 0
  try {
    const data = JSON.parse(event.data)
    if (data.address && data.priceUsd !== undefined) {
      const key = `${data.address}:${data.networkId}`
      _prices.set(key, data)
      for (const [cb, tokenSet] of _listeners) {
        if (tokenSet.has(key)) {
          try { cb(data) } catch { /* listener error */ }
        }
      }
    }
  } catch { /* parse error */ }
}

function _openConnection(tokenSet) {
  // Close existing connection
  if (_es) {
    _es.close()
    _es = null
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }

  if (!tokenSet) {
    _esTokenSet = ''
    return
  }

  // In production, connect directly to OVH SSE relay (persistent server).
  // In dev, go through Vite proxy to Express.
  const sseBase = import.meta.env.PROD ? 'https://stream.spectreai.io' : ''
  const url = `${sseBase}/api/codex/stream?tokens=${tokenSet}`
  // Don't hold a connection open for a tab nobody is looking at. The
  // visibilitychange handler below closes it on hide; without this guard a
  // reconnect timer that fires while hidden would re-open it behind the
  // handler's back.
  if (typeof document !== 'undefined' && document.hidden) {
    _esTokenSet = ''
    _visibilityPaused = true
    return
  }

  _esTokenSet = tokenSet
  const es = new EventSource(url)
  _es = es

  es.onmessage = _handleMessage

  es.addEventListener('connected', () => {
    _reconnectAttempts = 0
  })

  es.onerror = () => {
    // 🪤 The old guard was `if (_es?.readyState === CLOSED)`, which meant a
    // failing connection that the browser keeps in CONNECTING was left alone —
    // and EventSource's OWN retry loop (3s, not ours, not backed off) then
    // hammered the dead endpoint forever. Measured on prod with the relay at
    // 502: 52 requests in 2.5 minutes, one red console line each, for the life
    // of the tab. Always close it here so the native loop stops and OUR
    // backoff is the only thing that decides when to try again.
    try { es.close() } catch (_) { /* already closed */ }
    if (_es !== es) return // a newer connection superseded this one
    _es = null
    _esTokenSet = ''
    _scheduleReconnect()
  }
}

function _scheduleReconnect() {
  if (_reconnectTimer) return
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, _reconnectAttempts), RECONNECT_MAX_MS)
  _reconnectAttempts++
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    const tokenSet = _currentTokenSet()
    if (tokenSet) _openConnection(tokenSet)
  }, delay)
}

/**
 * Debounced check: do we need to open/change our EventSource?
 * Called after subscribe/unsubscribe. Coalesces rapid changes.
 */
function _maybeReconnect() {
  if (_connectTimer) clearTimeout(_connectTimer)
  _connectTimer = setTimeout(() => {
    _connectTimer = null

    // A backoff attempt is already queued (we are in a failure state). Let it
    // fire — it recomputes the token set itself, so nothing is lost. Opening
    // here instead would cancel the backoff and restart the flood on every
    // token change while the relay is down.
    if (_reconnectTimer) return

    const needed = _currentTokenSet()

    // No tokens needed - shut down
    if (!needed) {
      if (_es) { _es.close(); _es = null; _esTokenSet = '' }
      return
    }

    // Connection exists and covers the exact same tokens - keep it
    if (needed === _esTokenSet && _es && _es.readyState !== EventSource.CLOSED) {
      return
    }

    // Connection exists with a SUPERSET of needed tokens - keep it
    // (server sends extra data we just ignore, cheaper than reconnecting)
    if (_es && _es.readyState !== EventSource.CLOSED && _esTokenSet) {
      const activeTokens = new Set(_esTokenSet.split(','))
      const neededTokens = needed.split(',')
      if (neededTokens.every(t => activeTokens.has(t))) {
        return // All needed tokens are already subscribed
      }
    }

    // Need a new connection (new tokens added that server doesn't know about)
    _openConnection(needed)
  }, CONNECT_DEBOUNCE_MS)
}

/**
 * Subscribe to real-time price updates for a set of tokens.
 * @param {string[]} tokenKeys - Array of "address:networkId" strings
 * @param {function} callback - Called with { address, networkId, priceUsd, timestamp }
 * @returns {function} Unsubscribe function
 */
export function subscribe(tokenKeys, callback) {
  if (!tokenKeys?.length || !callback) return () => {}

  const keySet = new Set(tokenKeys)
  _listeners.set(callback, keySet)

  // Track ref counts
  let hasNewTokens = false
  for (const key of keySet) {
    const count = _tokenRefs.get(key) || 0
    _tokenRefs.set(key, count + 1)
    if (count === 0) hasNewTokens = true
  }

  // Send cached prices immediately
  for (const key of keySet) {
    const cached = _prices.get(key)
    if (cached) {
      try { callback(cached) } catch { /* ok */ }
    }
  }

  if (hasNewTokens) _maybeReconnect()

  // Return unsubscribe function
  return () => {
    _listeners.delete(callback)
    for (const key of keySet) {
      const count = _tokenRefs.get(key) || 0
      if (count <= 1) {
        _tokenRefs.delete(key)
        _prices.delete(key)
      } else {
        _tokenRefs.set(key, count - 1)
      }
    }
    // Only reconnect check if ALL tokens gone (to disconnect)
    // Otherwise keep existing connection - server sends extra data harmlessly
    if (_tokenRefs.size === 0) _maybeReconnect()
  }
}

/**
 * Get the latest cached price for a token.
 * @param {string} address
 * @param {number} networkId
 * @returns {{ address, networkId, priceUsd, timestamp } | null}
 */
export function getLatestPrice(address, networkId) {
  return _prices.get(`${address}:${networkId}`) || null
}

/**
 * Get all cached prices.
 * @returns {Map<string, { address, networkId, priceUsd, timestamp }>}
 */
export function getAllPrices() {
  return new Map(_prices)
}

/**
 * Check if the stream is connected.
 * @returns {boolean}
 */
export function isConnected() {
  return _es?.readyState === EventSource.OPEN
}

// ─── Visibility-aware pausing ──────────────────────────────────────────────
// When the tab is hidden, close the EventSource to stop Codex WS subscriptions.
// Prices Map retains last-known values so UI doesn't flash on resume.
// (_visibilityPaused is declared near the top — _openConnection sets it too.)

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Tab hidden - close connection to save Codex API quota
      if (_es) {
        _es.close()
        _es = null
        _esTokenSet = ''
      }
      if (_reconnectTimer) {
        clearTimeout(_reconnectTimer)
        _reconnectTimer = null
      }
      if (_connectTimer) {
        clearTimeout(_connectTimer)
        _connectTimer = null
      }
      _visibilityPaused = true
    } else if (_visibilityPaused) {
      // Tab visible again - reconnect if there are active subscribers
      _visibilityPaused = false
      _reconnectAttempts = 0
      _maybeReconnect()
    }
  })
}
