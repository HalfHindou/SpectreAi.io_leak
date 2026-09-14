/**
 * nativePricesStore — ONE poller for native/base token USD prices.
 *
 * Before this store the token page ran three uncoordinated pollers for the
 * same handful of prices:
 *   - RightPanel:      /api/tokens/prices?symbols=ETH,SOL,BNB,POL   every 30s
 *   - DataTabs:        Codex getDetailedTokenInfo(WETH|WSOL)        every 60s
 *   - UserDashboard:   /api/tokens/prices?symbols=ETH,SOL,BNB,...   every 60s
 * (DataTabs paid a FULL Codex details round-trip just to read one price.)
 *
 * This module owns a single visibility-aware 30s poll over the superset
 * symbol list and pushes the raw { SYM: price } map to subscribers, who
 * derive their own shapes. Polling runs only while at least one consumer
 * is subscribed; the first poll is idle-deferred so it never competes with
 * the snapshot/bars critical path in the first second.
 */

import { isAppActive } from '../lib/idleManager'
import { whenIdle } from '../utils/whenIdle'

const SYMBOLS = 'ETH,SOL,BNB,POL,MATIC,ARB'
const POLL_MS = 30_000

let _prices = null        // { ETH: 3500, SOL: 200, ... } raw parsed map
let _ts = 0
let _timer = null
let _inflight = null
let _cancelIdle = null
const _subs = new Set()

function notify() {
  for (const cb of _subs) {
    try { cb(_prices) } catch { /* consumer error must not break the loop */ }
  }
}

async function poll() {
  // Idle/visibility guard - stops pings on forgotten tabs.
  if (typeof document !== 'undefined' && document.hidden) return
  if (!isAppActive()) return
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      const res = await fetch(`/api/tokens/prices?symbols=${SYMBOLS}`)
      if (!res.ok) return
      const data = await res.json()
      if (!data) return
      const map = {}
      // Server returns { ETH: { symbol, price }, ... }
      for (const [sym, info] of Object.entries(data)) {
        const v = parseFloat(info?.price ?? info)
        if (Number.isFinite(v) && v > 0) map[sym] = v
      }
      if (Object.keys(map).length > 0) {
        _prices = map
        _ts = Date.now()
        notify()
      }
    } catch { /* keep last known prices */ } finally {
      _inflight = null
    }
  })()
  return _inflight
}

function start() {
  if (_timer) return
  // Idle-defer the first fetch (mirrors the old RightPanel behavior) unless
  // we already hold a fresh-enough map from a previous mount.
  if (!_prices || Date.now() - _ts > POLL_MS) {
    _cancelIdle = whenIdle(poll, { timeout: 3000 })
  }
  _timer = setInterval(poll, POLL_MS)
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null }
  if (_cancelIdle) { _cancelIdle(); _cancelIdle = null }
}

/**
 * Subscribe to native price updates. `cb` receives the raw { SYM: price }
 * map immediately when one is already cached, then on every poll tick.
 * Returns an unsubscribe function; the poller stops when the last
 * subscriber leaves.
 */
export function subscribeNativePrices(cb) {
  _subs.add(cb)
  if (_prices) {
    try { cb(_prices) } catch { /* consumer error */ }
  }
  start()
  return () => {
    _subs.delete(cb)
    if (_subs.size === 0) stop()
  }
}

/** Last known raw price map (or null before the first successful poll). */
export function getNativePrices() {
  return _prices
}
