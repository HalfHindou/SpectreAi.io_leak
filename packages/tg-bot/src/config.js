const path = require('path')
const fs = require('fs')
// Package-local .env wins (standalone/box deploy); falls back to monorepo root (dev)
const LOCAL_ENV = path.resolve(__dirname, '../.env')
const ROOT_ENV = path.resolve(__dirname, '../../../.env')
require('dotenv').config({ path: fs.existsSync(LOCAL_ENV) ? LOCAL_ENV : ROOT_ENV })

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API_BASE = process.env.SPECTRE_API_ORIGIN || process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
const API_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_API_KEY || ''
const APP_URL = 'https://app.spectreai.io'
const TRADE_URL = 'https://trade.spectreai.io'

// Deep-link to a specific token on the trading terminal.
// A DIRECT visit to trade.spectreai.io reads a bare `#token/<contract>` hash
// (App.jsx deepLinkAddressRef → resolves the token by contract). The old
// app.spectreai.io/token?address= wrapper IGNORES the address param (it boots
// the iframe to the default SPECTRE token, then only postMessage-selects from
// the research app's own state) — which is why runner alerts landed on the
// Trading-Lite default page instead of the token. Contract must be a BARE
// address (0x… or Solana base58); the trading app ignores non-address slugs.
const tradeTokenUrl = (contract) => `${TRADE_URL}/#token/${contract}`

// /v1/prices/{SYM}/ohlcv quirks (verified 2026-07-10):
// - interval AND range params are REQUIRED (bare call returns empty 200)
// - range value is effectively ignored server-side; 24h works for every interval
// - supported intervals: 15m (200 bars), 1h (holes/slow when cagg is cold), 4h (~190), 1d (~35), 1w (~6)
// - cold queries can take 30s+ → generous timeout + cache + fallback chain
const TIMEFRAMES = {
  '15m': { interval: '15m', label: '15m', maxBars: 140, ttlMs: 5 * 60e3 },
  '1h': { interval: '1h', label: '1H', maxBars: 160, ttlMs: 10 * 60e3 },
  '4h': { interval: '4h', label: '4H', maxBars: 160, ttlMs: 20 * 60e3 },
  '1d': { interval: '1d', label: '1D', maxBars: 120, ttlMs: 30 * 60e3 },
  '1w': { interval: '1w', label: '1W', maxBars: 60, ttlMs: 60 * 60e3 },
}
const TF_ORDER = ['15m', '1h', '4h', '1d', '1w']
// tried in order when the requested TF has no data — widest-first so a cold
// lane never lands the user on a MORE zoomed chart than they asked for
// (SPECTRE's cold 4h lane used to drop /scan onto 15m)
const TF_FALLBACK = ['4h', '1d', '15m']
// default = 4H: ~160 bars ≈ a month of structure — a chart that LOOKS like
// a chart. 15m is a zoom level users opt into, never the first impression.
const DEFAULT_TF = '4h'
// /scan opens on the daily — the full-token read wants the wide story, not an
// intraday tape (founder 07-16: "scan do 1D default so its not so zoomed").
// TF taps on the scan keyboard still override per-invocation.
const SCAN_TF = '1d'

// X-Dash collector API (direct) — the premium event-based runner signals
const XDASH_BASE = process.env.X_DASH_BASE || 'http://5.78.199.87:8092'
const XDASH_KEY = (process.env.X_DASH_API_KEY || '').trim()

// Access control (see guard.js): 'invite' = closed beta, deep-link code grants access
const BOT_ACCESS = (process.env.BOT_ACCESS || 'invite').toLowerCase()
const BOT_INVITE_CODE = process.env.BOT_INVITE_CODE || ''
const BOT_ADMIN_IDS = (process.env.BOT_ADMIN_IDS || '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter(Boolean)

module.exports = {
  BOT_TOKEN, API_BASE, API_KEY, APP_URL, TRADE_URL, tradeTokenUrl, TIMEFRAMES, TF_ORDER, TF_FALLBACK, DEFAULT_TF, SCAN_TF,
  BOT_ACCESS, BOT_INVITE_CODE, BOT_ADMIN_IDS, XDASH_BASE, XDASH_KEY,
}
