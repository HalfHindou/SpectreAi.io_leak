/**
 * Momentum runner watcher.
 *
 * Polls /api/momentum/setups on a 90s cadence. Maintains a state file of
 * cgIds we have already announced. When a NEW cgId appears AND its
 * momentum_entry.entered_at is fresh (< 6h old), broadcast a "🔥 New
 * runner" message to every subscribed chat.
 *
 * Also fires per-token watches: when a /watch'd token sees a meaningful
 * jump in mentions vs the previous tick, ping the subscribing chats.
 *
 * Persistence: data/known-runners.json — { cgIds: [...], updatedAt }
 *              data/known-mentions.json — { [cgId]: lastMentions, ... }
 */
const path = require('path')
const fs = require('fs')
const {
  getMomentumSetups,
  getXDashBootstrap,
  fmtUsd,
  fmtNum,
  fmtAgo,
} = require('../services/spectre-api')
const { loadSubs, loadWatches } = require('../commands/xdash')

const STATE_DIR = path.resolve(__dirname, '../data')
const KNOWN_RUNNERS = path.join(STATE_DIR, 'known-runners.json')
const KNOWN_MENTIONS = path.join(STATE_DIR, 'known-mentions.json')

const POLL_INTERVAL_MS = 90_000
const FRESH_ENTRY_WINDOW_MS = 6 * 60 * 60 * 1000
const MENTION_SPIKE_MULTIPLIER = 1.5    // 50% jump qualifies
const MENTION_SPIKE_MIN_ABSOLUTE = 25   // tokens must clear 25 mentions/24h

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { return fallback }
}
function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function escMd(s) {
  return String(s ?? '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

async function broadcast(bot, chatIds, text, opts = {}) {
  for (const chatId of chatIds) {
    try {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', ...opts })
    } catch (e) {
      // Common errors: chat blocked, bot kicked from group. Don't crash the loop.
      console.warn(`broadcast to ${chatId} failed: ${e.description || e.message}`)
    }
  }
}

async function checkRunners(bot) {
  let data
  try { data = await getMomentumSetups({ limit: 25 }) }
  catch (e) { console.warn(`[watcher] momentum fetch failed: ${e.message}`); return }

  const tokens = data.tokens || []
  const knownState = loadJson(KNOWN_RUNNERS, { cgIds: [] })
  const known = new Set(knownState.cgIds || [])
  const subs = loadSubs()
  const now = Date.now()

  const newRunners = []
  const currentCgIds = []
  for (const row of tokens) {
    const cgId = row.token?.cg_id
    if (!cgId) continue
    currentCgIds.push(cgId)
    const enteredAt = new Date(row.momentum_entry?.entered_at || 0).getTime()
    if (!Number.isFinite(enteredAt)) continue
    const isFreshEntry = (now - enteredAt) <= FRESH_ENTRY_WINDOW_MS
    if (!known.has(cgId) && isFreshEntry) {
      newRunners.push(row)
    }
  }

  // Update state regardless of subscriptions (so first-poll baseline gets set)
  saveJson(KNOWN_RUNNERS, { cgIds: currentCgIds, updatedAt: new Date().toISOString() })

  if (!newRunners.length || !subs.length) return

  // Skip the first poll's "discoveries" — if known list was empty, every
  // token would look new. Only announce when we already had a baseline.
  if (!knownState.cgIds || knownState.cgIds.length === 0) {
    console.log(`[watcher] baseline established with ${currentCgIds.length} known runners; will alert from next cycle`)
    return
  }

  for (const row of newRunners) {
    const tok = row.token || {}
    const sym = (tok.symbol || '?').toUpperCase()
    const entry = row.momentum_entry || {}
    const entryMcap = Number(entry.entry_market_cap || 0)
    const liveMcap = Number(tok.market_cap || 0)
    const pct = entryMcap > 0 && liveMcap > 0
      ? ((liveMcap - entryMcap) / entryMcap) * 100
      : null
    const tone = pct == null ? '·' : pct >= 0 ? '🟢' : '🔴'
    const lines = [
      `*🔥 New runner — ${escMd(`$${sym}`)}*`,
      `${escMd(tok.name || sym)} · ${escMd(tok.chain || '?')}`,
      '',
      `Entered Momentum Top 25 ${tone}`,
      `*Entry rank*: \\#${escMd(String(entry.entry_rank ?? '?'))}`,
      `*Entry mcap*: ${escMd(fmtUsd(entryMcap))}${liveMcap ? ' → ' + escMd(fmtUsd(liveMcap)) : ''}`,
      pct != null ? `*Since entry*: ${escMd((pct >= 0 ? '+' : '') + pct.toFixed(1) + '%')}` : '',
      '',
      `*Entry signal*: ${escMd(fmtNum(entry.metrics?.external_mentions_24h || 0))} mentions · ${escMd(fmtNum(entry.metrics?.unique_external_authors_24h || 0))} authors`,
      '',
      `_/token ${escMd(sym)} for full brief · /watch ${escMd(sym)} for per\\-token alerts_`,
    ].filter(Boolean)
    await broadcast(bot, subs, lines.join('\n'))
  }
  console.log(`[watcher] announced ${newRunners.length} new runners to ${subs.length} subs`)
}

async function checkWatches(bot) {
  const watches = loadWatches()
  const watchedSyms = new Set()
  for (const list of Object.values(watches)) {
    for (const s of list) watchedSyms.add(s.toUpperCase())
  }
  if (!watchedSyms.size) return

  let data
  try { data = await getXDashBootstrap({ perPage: 100 }) }
  catch (e) { console.warn(`[watcher] bootstrap fetch failed: ${e.message}`); return }

  const lastMentions = loadJson(KNOWN_MENTIONS, {})
  const updated = {}
  const spikes = []  // { row, prevMentions }

  for (const row of (data.tokens || [])) {
    const sym = String(row.token?.symbol || '').toUpperCase()
    if (!watchedSyms.has(sym)) continue
    const cgId = row.token?.cg_id || sym.toLowerCase()
    const current = Number(row.metrics?.external_mentions_24h || 0)
    updated[cgId] = current
    const prev = Number(lastMentions[cgId] || 0)
    if (prev > 0 && current >= MENTION_SPIKE_MIN_ABSOLUTE && current >= prev * MENTION_SPIKE_MULTIPLIER) {
      spikes.push({ row, prev, current })
    }
  }
  saveJson(KNOWN_MENTIONS, { ...lastMentions, ...updated })

  for (const { row, prev, current } of spikes) {
    const tok = row.token || {}
    const sym = String(tok.symbol || '').toUpperCase()
    const subs = Object.entries(watches)
      .filter(([, list]) => list.includes(sym))
      .map(([chatId]) => Number(chatId))
    if (!subs.length) continue

    const delta = current - prev
    const pct = prev > 0 ? ((current - prev) / prev) * 100 : null
    const lines = [
      `*👁 Watch alert — ${escMd(`$${sym}`)}*`,
      `Mentions 24h jumped ${escMd(fmtNum(prev))} → ${escMd(fmtNum(current))}${pct != null ? ' \\(' + escMd((pct >= 0 ? '+' : '') + pct.toFixed(0) + '%') + '\\)' : ''}`,
      '',
      `*Rank*: \\#${escMd(String(row.rank_position))}${row.rank_change_positions ? ' \\(' + escMd((row.rank_change_positions > 0 ? '+' : '') + row.rank_change_positions) + '\\)' : ''}`,
      `*Authors*: ${escMd(fmtNum(row.metrics?.unique_external_authors_24h || 0))}`,
      `*Engagement*: ${escMd(fmtNum(row.metrics?.total_weighted_engagement || 0))}`,
      '',
      `_/token ${escMd(sym)} · /unwatch ${escMd(sym)}_`,
    ]
    await broadcast(bot, subs, lines.join('\n'))
  }
  if (spikes.length) console.log(`[watcher] fired ${spikes.length} watch alerts`)
}

function startWatcher(bot) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await checkRunners(bot)
      await checkWatches(bot)
    } catch (e) {
      console.error('[watcher] tick failed:', e.message)
    } finally {
      running = false
    }
  }

  // First tick: establish baseline. Subsequent ticks: real alerts.
  setTimeout(tick, 5_000)
  const intervalId = setInterval(tick, POLL_INTERVAL_MS)
  console.log(`[watcher] started — polling every ${POLL_INTERVAL_MS / 1000}s`)
  return () => clearInterval(intervalId)
}

module.exports = { startWatcher }
