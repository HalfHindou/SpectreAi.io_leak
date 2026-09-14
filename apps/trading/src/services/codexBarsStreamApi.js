/**
 * Codex Real-time BAR Stream Client (authoritative OHLCV)
 *
 * Connects to the Express SSE relay at /api/codex/bars-stream to receive
 * real-time Codex `onBarsUpdated` candle updates — REAL open/high/low/close
 * AND real volume, per pair+resolution. This is the authoritative live-candle
 * feed (the same mechanism Axiom's `b-<pairAddress>` room delivers), replacing
 * the older approach of synthesizing candles from `onPricesUpdated` price ticks
 * (which carried volume:0 and forked from real bars until a reconcile healed).
 *
 * Singleton pattern mirroring codexStreamApi.js: one EventSource per distinct
 * (pairId, resolution) key, refcounted across consumers, visibility-aware.
 *
 * The server SSE endpoint narrows the Codex all-resolutions push to ONE
 * resolution per connection (routes/codex-stream.js broadcastBarUpdate), so we
 * key by `${pairId}|${resolution}`. Only resolutions the server maps are
 * supported ('1','5','15','60','240','1D'); others return a no-op subscribe so
 * the caller falls back to the synthesized-candle path.
 *
 * Usage:
 *   import { subscribe as subscribeBars, isBarResolutionSupported } from './codexBarsStreamApi'
 *   const unsub = subscribeBars('0xpair...:1', '60', (bar) => {
 *     // bar = { time(ms), open, high, low, close, volume }
 *   })
 *   // later: unsub()
 */

// Resolutions the server bars relay can serve (RES_MAP in routes/codex-stream.js).
import { subscribeActivity } from '../lib/idleManager'

const SUPPORTED_RES = new Set(['1', '5', '15', '60', '240', '1D', 'D'])

// key = `${pairId}|${resolution}`
// Per-key connection state: { es, listeners:Set<cb>, refs, last, reconnectTimer, attempts }
const _conns = new Map()
let _visibilityPaused = false

const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 30000

export function isBarResolutionSupported(resolution) {
  return SUPPORTED_RES.has(String(resolution))
}

function _normalizeBar(raw) {
  if (!raw) return null
  const o = Number(raw.open), h = Number(raw.high), l = Number(raw.low), c = Number(raw.close)
  if (!Number.isFinite(o) || !Number.isFinite(c) || o <= 0 || c <= 0) return null
  // Codex bar timestamps are Unix SECONDS; TVA's series works in ms.
  let t = Number(raw.time)
  if (!Number.isFinite(t) || t <= 0) return null
  if (t < 1e12) t = t * 1000
  const v = Number(raw.volume)
  return {
    time: t,
    open: o,
    high: Number.isFinite(h) ? h : Math.max(o, c),
    low: Number.isFinite(l) ? l : Math.min(o, c),
    close: c,
    volume: Number.isFinite(v) && v >= 0 ? v : 0,
  }
}

function _open(key, conn) {
  if (conn.es) { try { conn.es.close() } catch { /* ok */ } conn.es = null }
  if (conn.reconnectTimer) { clearTimeout(conn.reconnectTimer); conn.reconnectTimer = null }
  if (_visibilityPaused) return

  const [pairId, resolution, quoteToken] = key.split('|')
  const sseBase = import.meta.env.PROD ? 'https://stream.spectreai.io' : ''
  const url = `${sseBase}/api/codex/bars-stream?pairId=${encodeURIComponent(pairId)}&resolution=${encodeURIComponent(resolution)}&quoteToken=${encodeURIComponent(quoteToken || 'token1')}`
  const es = new EventSource(url)
  conn.es = es

  es.onmessage = (event) => {
    try {
      const bar = _normalizeBar(JSON.parse(event.data))
      if (!bar) return
      conn.last = bar
      for (const cb of conn.listeners) {
        try { cb(bar) } catch { /* listener error */ }
      }
    } catch { /* parse error / keepalive */ }
  }

  es.addEventListener('connected', () => { conn.attempts = 0 })

  es.onerror = () => {
    if (conn.es?.readyState === EventSource.CLOSED) _scheduleReconnect(key, conn)
  }
}

function _scheduleReconnect(key, conn) {
  if (conn.reconnectTimer) return
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, conn.attempts), RECONNECT_MAX_MS)
  conn.attempts++
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null
    if (conn.listeners.size > 0) _open(key, conn)
  }, delay)
}

/**
 * Subscribe to authoritative live OHLCV bars for a pair at a resolution.
 * @param {string} pairId - `${pairAddress}:${networkId}`
 * @param {string} resolution - '1' | '5' | '15' | '60' | '240' | '1D'
 * @param {(bar:{time:number,open:number,high:number,low:number,close:number,volume:number})=>void} callback
 * @param {'token0'|'token1'} [quoteToken='token1'] - which side of the pair the
 *   target token is quoted against; the caller auto-flips if the default scale
 *   is wrong (a token1 token needs token0, and vice-versa).
 * @returns {() => void} unsubscribe (no-op if resolution unsupported / bad args)
 */
export function subscribe(pairId, resolution, callback, quoteToken = 'token1') {
  if (!pairId || !callback || !isBarResolutionSupported(resolution)) return () => {}
  const key = `${pairId}|${resolution}|${quoteToken}`
  let conn = _conns.get(key)
  if (!conn) {
    conn = { es: null, listeners: new Set(), refs: 0, last: null, reconnectTimer: null, attempts: 0 }
    _conns.set(key, conn)
  }
  conn.listeners.add(callback)
  conn.refs++

  // Replay the last-known bar so a fresh subscriber isn't blind until the next push.
  if (conn.last) { try { callback(conn.last) } catch { /* ok */ } }

  if (!conn.es && !_visibilityPaused) _open(key, conn)

  return () => {
    conn.listeners.delete(callback)
    conn.refs = Math.max(0, conn.refs - 1)
    if (conn.refs === 0) {
      if (conn.es) { try { conn.es.close() } catch { /* ok */ } }
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
      _conns.delete(key)
    }
  }
}

/** Latest cached bar for a pair+resolution (sync, no network). */
export function getLatestBar(pairId, resolution) {
  return _conns.get(`${pairId}|${resolution}`)?.last || null
}

// ─── Visibility- and idle-aware pausing (mirror codexStreamApi) ─────────────
// Hidden tab or 5 min without input → close every bars EventSource (stops the
// Codex WS subscriptions, which bill per delivered bar); resume + reopen the
// ones that still have listeners when the user is back.
function _pauseAll() {
  for (const conn of _conns.values()) {
    if (conn.es) { try { conn.es.close() } catch { /* ok */ } conn.es = null }
    if (conn.reconnectTimer) { clearTimeout(conn.reconnectTimer); conn.reconnectTimer = null }
  }
}
function _resumeAll() {
  for (const [key, conn] of _conns) {
    conn.attempts = 0
    if (conn.listeners.size > 0 && !conn.es) _open(key, conn)
  }
}
let _idlePaused = false
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _visibilityPaused = true
      _pauseAll()
    } else if (_visibilityPaused) {
      _visibilityPaused = false
      if (!_idlePaused) _resumeAll()
    }
  })
  subscribeActivity((active) => {
    if (!active) {
      if (document.hidden) return
      _idlePaused = true
      _pauseAll()
    } else if (_idlePaused) {
      _idlePaused = false
      if (!document.hidden) _resumeAll()
    }
  })
}
