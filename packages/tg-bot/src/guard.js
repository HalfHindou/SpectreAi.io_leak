// Access gate + anti-abuse. The app isn't publicly gated yet, so the bot ships
// CLOSED by default: users need the invite code (deep link) or an admin id.
// Flip BOT_ACCESS=open in .env at launch — rate limits stay on either way.
const store = require('./store')
const { BOT_ACCESS, BOT_INVITE_CODE, BOT_ADMIN_IDS } = require('./config')

// sliding-window limits per user
const LIMITS = {
  all: { max: 20, windowMs: 60e3 }, // any interaction
  heavy: { max: 8, windowMs: 60e3 }, // chart renders / scans / callbacks
}
const buckets = new Map() // `${userId}:${kind}` -> timestamps[]

function allow(userId, kind) {
  const cfg = LIMITS[kind] || LIMITS.all
  const key = `${userId}:${kind}`
  const now = Date.now()
  const stamps = (buckets.get(key) || []).filter((ts) => now - ts < cfg.windowMs)
  if (stamps.length >= cfg.max) {
    buckets.set(key, stamps)
    return { ok: false, waitS: Math.ceil((cfg.windowMs - (now - stamps[0])) / 1000) }
  }
  stamps.push(now)
  buckets.set(key, stamps)
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value)
  return { ok: true }
}

// global concurrency cap on chart renders — protects the box's candle lane
let rendering = 0
const MAX_CONCURRENT_RENDERS = 3
function acquireRender() {
  if (rendering >= MAX_CONCURRENT_RENDERS) return false
  rendering++
  return true
}
function releaseRender() {
  rendering = Math.max(0, rendering - 1)
}

const isAdmin = (id) => BOT_ADMIN_IDS.includes(Number(id))

function hasAccess(id) {
  if (BOT_ACCESS === 'open') return true
  if (isAdmin(id)) return true
  return store.user(id).access === true
}

function tryCode(id, code) {
  if (!BOT_INVITE_CODE) return false
  if (String(code).trim() !== BOT_INVITE_CODE) return false
  store.setAccess(id, true)
  return true
}

module.exports = { allow, acquireRender, releaseRender, isAdmin, hasAccess, tryCode }
