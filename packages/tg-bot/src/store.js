const fs = require('fs')
const path = require('path')
const { DEFAULT_TF } = require('./config')
const { DEFAULT_THEME } = require('./themes')

// Flat-file user store for Phase 1 (single process, low write volume).
// Interface is deliberately Postgres-shaped so Phase 2 can swap the backend.
const FILE = path.resolve(__dirname, '../data/store.json')

let state = { users: {} }
try {
  state = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch (e) {
  // a CORRUPT store (half-written file from a crash) must not be silently
  // replaced by an empty one on the next flush — park it for recovery.
  // A missing file is the normal first boot.
  if (fs.existsSync(FILE)) {
    const bak = `${FILE}.corrupt-${Date.now()}`
    try {
      fs.renameSync(FILE, bak)
      console.error(`[store] store.json failed to parse (${e.message}) — moved to ${bak}, starting empty`)
    } catch {}
  }
}

let saveTimer = null
function flush() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  // atomic: a kill mid-write must never leave a truncated store.json
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, FILE)
}
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 400)
}
// debounced saves must survive restarts — a lost seen-set replays alerts
process.on('exit', () => {
  try {
    if (saveTimer) flush()
  } catch {}
})
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      flush()
    } catch {}
    process.exit(0)
  })
}

function user(id) {
  const key = String(id)
  if (!state.users[key]) {
    state.users[key] = {
      prefs: { tf: DEFAULT_TF, theme: DEFAULT_THEME },
      watchlist: [],
      alerts: [], // { id, symbol, op: '>'|'<', price, createdAt }
      alertSeq: 0,
      firstSeen: new Date().toISOString(),
    }
    save()
  }
  return state.users[key]
}

function setPref(id, key, value) {
  user(id).prefs[key] = value
  save()
}

function setAccess(id, value) {
  user(id).access = value
  save()
}

// keep a display handle so /users is readable
function touchProfile(id, from) {
  const u = user(id)
  const handle = from?.username ? '@' + from.username : from?.first_name || null
  if (handle && u.handle !== handle) {
    u.handle = handle
    save()
  }
}

function allUsers() {
  return Object.entries(state.users).map(([id, u]) => ({ id, ...u }))
}

function addWatch(id, symbol) {
  const u = user(id)
  const s = symbol.toUpperCase()
  if (!u.watchlist.includes(s)) {
    u.watchlist.push(s)
    save()
    return true
  }
  return false
}

// ---- portfolio holdings: [{ symbol, qty, entry }] per user
function holdings(id) {
  return user(id).holdings || []
}
function setHolding(id, symbol, qty, entry) {
  const u = user(id)
  u.holdings = u.holdings || []
  const s = String(symbol).toUpperCase()
  const i = u.holdings.findIndex((h) => h.symbol === s)
  const rec = { symbol: s, qty: Number(qty), entry: entry != null ? Number(entry) : null }
  if (i >= 0) u.holdings[i] = rec
  else u.holdings.push(rec)
  save()
  return rec
}
function rmHolding(id, symbol) {
  const u = user(id)
  u.holdings = u.holdings || []
  const s = String(symbol).toUpperCase()
  const before = u.holdings.length
  u.holdings = u.holdings.filter((h) => h.symbol !== s)
  save()
  return u.holdings.length < before
}

function rmWatch(id, symbol) {
  const u = user(id)
  const s = symbol.toUpperCase()
  const i = u.watchlist.indexOf(s)
  if (i >= 0) {
    u.watchlist.splice(i, 1)
    save()
    return true
  }
  return false
}

function addAlert(id, symbol, op, price) {
  const u = user(id)
  const alert = { id: ++u.alertSeq, symbol: symbol.toUpperCase(), op, price, createdAt: new Date().toISOString() }
  u.alerts.push(alert)
  save()
  return alert
}

function rmAlert(id, alertId) {
  const u = user(id)
  const before = u.alerts.length
  u.alerts = u.alerts.filter((a) => a.id !== alertId)
  save()
  return u.alerts.length < before
}

function clearAlerts(id) {
  const u = user(id)
  const n = u.alerts.length
  u.alerts = []
  save()
  return n
}

// For the alert poller: every (userId, alert) pair across all users
function allAlerts() {
  const out = []
  for (const [id, u] of Object.entries(state.users)) {
    for (const a of u.alerts || []) out.push({ userId: id, alert: a })
  }
  return out
}

// ---- signal subscriptions (DMs, groups, channels)

function sub(chatId) {
  if (!state.subs) state.subs = {}
  const s = state.subs[String(chatId)] || null
  // migrate pre-breaking-era subs to the current category set
  if (s && s.cats && s.cats.breaking === undefined) {
    s.cats = {
      breaking: true,
      runners: s.cats.runners ?? true,
      social: s.cats.social ?? s.cats.edges ?? true,
      data: s.cats.data ?? false,
      risk: s.cats.risk ?? true,
      pulse: s.cats.pulse ?? false,
    }
    if (s.maxPerHour === undefined) s.maxPerHour = 6
    save()
  }
  return s
}

function upsertSub(chatId, patch) {
  if (!state.subs) state.subs = {}
  const key = String(chatId)
  state.subs[key] = {
    cats: { breaking: true, runners: true, social: true, data: false, risk: true, pulse: false },
    maxPerHour: 6,
    addedAt: new Date().toISOString(),
    ...state.subs[key],
    ...patch,
  }
  save()
  return state.subs[key]
}

function toggleSubCat(chatId, cat) {
  const s = sub(chatId)
  if (!s) return null
  s.cats[cat] = !s.cats[cat]
  save()
  return s
}

function removeSub(chatId) {
  if (state.subs) {
    delete state.subs[String(chatId)]
    save()
  }
}

function allSubs() {
  // read through sub() so category migrations apply on EVERY path (the
  // missing-breaking-key bug: delivery skipped chats migrations never touched)
  return Object.keys(state.subs || {}).map((chatId) => ({ chatId, ...sub(chatId) }))
}

// ---- scheduled market-overview cards. Own key, NOT subs — enabling the
// schedule must never create a signal subscription (upsertSub would default
// every category on for a chat that only wanted the daily cards).
const OVERVIEW_SLOTS = ['morning', 'midday', 'evening']
function setOverviewAuto(chatId, on) {
  if (!state.overviewChats) state.overviewChats = {}
  if (on) state.overviewChats[String(chatId)] = { addedAt: new Date().toISOString(), slots: { morning: true, midday: true, evening: true } }
  else delete state.overviewChats[String(chatId)]
  save()
}

// the enabled slots for a chat (default all 3 when subscribed, none otherwise)
function overviewConfig(chatId) {
  const c = (state.overviewChats || {})[String(chatId)]
  if (!c) return { morning: false, midday: false, evening: false }
  return c.slots || { morning: true, midday: true, evening: true }
}

// toggle one slot; enabling on a fresh chat subscribes it, turning the last
// slot off unsubscribes the chat entirely
function toggleOverviewSlot(chatId, slot) {
  if (!OVERVIEW_SLOTS.includes(slot)) return overviewConfig(chatId)
  if (!state.overviewChats) state.overviewChats = {}
  const key = String(chatId)
  if (!state.overviewChats[key]) state.overviewChats[key] = { addedAt: new Date().toISOString(), slots: { morning: false, midday: false, evening: false } }
  const c = state.overviewChats[key]
  c.slots = c.slots || { morning: true, midday: true, evening: true }
  c.slots[slot] = !c.slots[slot]
  if (!c.slots.morning && !c.slots.midday && !c.slots.evening) delete state.overviewChats[key]
  save()
  return overviewConfig(chatId)
}

function overviewChats() {
  return Object.keys(state.overviewChats || {})
}

// chats that have the given slot enabled (the scheduler's per-slot audience)
function overviewChatsForSlot(slot) {
  return Object.entries(state.overviewChats || {})
    .filter(([, c]) => (c.slots || { morning: true, midday: true, evening: true })[slot])
    .map(([id]) => id)
}

// poller cursor: ids we've already delivered (bounded)
function seenSignals() {
  if (!state.seenSignals) state.seenSignals = []
  return new Set(state.seenSignals)
}

function markSignalsSeen(ids) {
  const set = seenSignals()
  for (const id of ids) set.add(id)
  state.seenSignals = [...set].slice(-600)
  save()
}

// rolling OTHERS2 snapshots (alt mkt-cap ex-top-100) → 24h change + real trend
function pushAltSnapshot(others2) {
  if (!(others2 > 0)) return
  const now = Date.now()
  state.altSnaps = (state.altSnaps || []).filter((s) => now - s.ts < 8 * 86400e3)
  const last = state.altSnaps[state.altSnaps.length - 1]
  if (!last || now - last.ts > 20 * 60e3) { // dedupe bursts (renders can cluster)
    state.altSnaps.push({ ts: now, o: others2 })
    state.altSnaps = state.altSnaps.slice(-90)
    save()
  }
}
function altSnapshots() {
  return state.altSnaps || []
}

// content-level dedupe: upstream re-inserts the same signal under new ids,
// so ids alone can't stop repeats. Keyed fingerprint + TTL.
function contentSeen(key, ttlMs) {
  if (!state.contentSeen) state.contentSeen = {}
  const now = Date.now()
  for (const [k, ts] of Object.entries(state.contentSeen)) {
    if (now - ts > 24 * 3600e3) delete state.contentSeen[k]
  }
  const ts = state.contentSeen[key]
  if (ts && now - ts < ttlMs) return true
  state.contentSeen[key] = now
  save()
  return false
}

// ---- delivered-alert ledger (self-grading receipts)

function recordDelivery(entry) {
  if (!state.deliveries) state.deliveries = []
  if (state.deliveries.some((d) => d.id === entry.id)) return
  state.deliveries.push(entry)
  if (state.deliveries.length > 400) state.deliveries = state.deliveries.slice(-400)
  save()
}

function updateDelivery(id, patch) {
  const d = (state.deliveries || []).find((x) => x.id === id)
  if (d) {
    Object.assign(d, patch)
    save()
  }
}

function allDeliveries() {
  return state.deliveries || []
}

// ---- buybot persistent seen-set: restarts CATCH UP on missed buys
// (up to the 100-row poll window) instead of priming them away
function seenTx(ca) {
  return (state.buybotSeen || {})[ca] || []
}
function addSeenTx(ca, keys) {
  if (!keys.length) return
  state.buybotSeen = state.buybotSeen || {}
  const cur = new Set(state.buybotSeen[ca] || [])
  for (const k of keys) cur.add(k)
  state.buybotSeen[ca] = [...cur].slice(-400)
  save()
}

// ---- macro storyline governor state: per-topic cooldowns for the news lanes
// (geopolitical wires flip-flop hourly; one card per storyline per window)
function macroStory(k) {
  return (state.macroStories || {})[k] || null
}
function macroStamp(k) {
  state.macroStories = state.macroStories || {}
  const now = Date.now()
  for (const [key, v] of Object.entries(state.macroStories)) if (now - v.at > 24 * 3600e3) delete state.macroStories[key]
  state.macroStories[k] = { at: now, absorbed: 0 }
  save()
}
function macroAbsorb(k) {
  const st = (state.macroStories || {})[k]
  if (st) {
    st.absorbed = (st.absorbed || 0) + 1
    save()
  }
}

// ---- per-chat language (i18n)
function chatLang(chatId) {
  return (state.langs || {})[String(chatId)] || 'en'
}
function setChatLang(chatId, lang) {
  state.langs = state.langs || {}
  state.langs[String(chatId)] = lang
  save()
}

// ---- pending grants by @handle: activates on the user's first message
// (usernames can't be resolved to ids until the user talks to the bot)
const normHandle = (h) => String(h || '').toLowerCase().replace(/^@/, '').trim()
function addPendingGrant(handle) {
  state.pendingGrants = state.pendingGrants || []
  const n = normHandle(handle)
  if (n && !state.pendingGrants.includes(n)) {
    state.pendingGrants.push(n)
    save()
  }
  return n
}
function consumePendingGrant(handle) {
  const n = normHandle(handle)
  if (!n || !(state.pendingGrants || []).includes(n)) return false
  state.pendingGrants = state.pendingGrants.filter((x) => x !== n)
  save()
  return true
}

// ---- group call ledger: first caller per token per chat, with running peaks.
// The receipts layer for communities — who called it, at what cap, what it did.
function recordCall(chatId, key, entry) {
  state.calls = state.calls || {}
  const book = (state.calls[String(chatId)] = state.calls[String(chatId)] || {})
  if (!book[key]) {
    book[key] = entry
    save()
    return { first: true, call: book[key] }
  }
  const c = book[key]
  if (entry.mcap) {
    if (!c.peakMcap || entry.mcap > c.peakMcap) c.peakMcap = entry.mcap
    c.lastMcap = entry.mcap
    c.lastAt = entry.ts || Date.now()
  }
  save()
  return { first: false, call: c }
}
function chatCalls(chatId) {
  return Object.entries((state.calls || {})[String(chatId)] || {}).map(([key, c]) => ({ key, ...c }))
}

// ---- buy bot configs: one per chat, keyed by chat id
function buybot(chatId) {
  return (state.buybots || {})[String(chatId)] || null
}
function upsertBuybot(chatId, patch) {
  state.buybots = state.buybots || {}
  const key = String(chatId)
  state.buybots[key] = { ...(state.buybots[key] || {}), chatId: key, ...patch }
  save()
  return state.buybots[key]
}
function removeBuybot(chatId) {
  if (state.buybots) {
    delete state.buybots[String(chatId)]
    save()
  }
}
function allBuybots() {
  return Object.values(state.buybots || {})
}

module.exports = {
  user, setPref, setAccess, touchProfile, allUsers, addWatch, rmWatch, addAlert, rmAlert, clearAlerts, allAlerts,
  holdings, setHolding, rmHolding,
  sub, upsertSub, toggleSubCat, removeSub, allSubs, seenSignals, markSignalsSeen, contentSeen,
  setOverviewAuto, overviewChats, overviewConfig, toggleOverviewSlot, overviewChatsForSlot,
  pushAltSnapshot, altSnapshots,
  recordDelivery, updateDelivery, allDeliveries,
  buybot, upsertBuybot, removeBuybot, allBuybots,
  recordCall, chatCalls, addPendingGrant, consumePendingGrant, chatLang, setChatLang, seenTx, addSeenTx,
  macroStory, macroStamp, macroAbsorb,
}
