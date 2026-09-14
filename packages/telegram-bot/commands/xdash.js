/**
 * X-Dash Telegram commands.
 *
 * Text-mode (data answers):
 *   /top [n]          top N tokens by 24h attention (default 15)
 *   /signals          current Spectre Momentum Top-25 board
 *   /runners          tokens that entered the board in last 24h
 *   /fresh            entered in last 6h (aggressive)
 *   /movers           biggest UP rank movers vs previous board
 *   /dump             biggest DOWN rank movers (attention bleeding)
 *   /clean [n]        top by clean_signal_score (filters out shill)
 *   /token <sym>      full brief for one token
 *   /who <sym>        top creators carrying this token
 *   /quality <sym>    spam + clean-signal breakdown
 *   /compare <s1> <s2> side-by-side
 *   /creators [n]     top KOLs by carrier impact across the board
 *   /narratives       top narratives by aggregate attention
 *   /digest           one-screen overview (top 5 + runners + creators)
 *
 * Visual (screenshot via Puppeteer):
 *   /xdmap            X-Dash leaderboard attention heatmap
 *   /narrmap          X-Dash narratives heatmap
 *   /creatormap       X-Dash creators heatmap
 *   /drawer <sym>     X-Dash token drawer
 *
 * Subscriptions:
 *   /alerts on|off    push notifications for new runners
 *   /watch <sym>      per-token alerts (unusual activity)
 *   /unwatch <sym>
 *   /xdhelp           list every X-Dash command
 */
const path = require('path')
const fs = require('fs')
const {
  getXDashBootstrap,
  getXDashToken,
  getXDashLeaderboardBundle,
  getMomentumSetups,
  fmtUsd,
  fmtNum,
  fmtPct,
  fmtAgo,
} = require('../services/spectre-api')

const SUBS_PATH = path.resolve(__dirname, '../data/subscribers.json')

/* ─── Subscriber persistence (runner alerts + per-token watches) ──── */
function loadSubsFile() {
  try {
    const raw = fs.readFileSync(SUBS_PATH, 'utf8')
    return JSON.parse(raw)
  } catch { return { runnerSubs: [], watches: {} } }
}
function saveSubsFile(state) {
  fs.mkdirSync(path.dirname(SUBS_PATH), { recursive: true })
  fs.writeFileSync(SUBS_PATH, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2))
}
function loadSubs() { return loadSubsFile().runnerSubs || [] }
function isSubscribed(chatId) { return loadSubs().includes(chatId) }
function subscribe(chatId) {
  const s = loadSubsFile()
  if (s.runnerSubs?.includes(chatId)) return false
  s.runnerSubs = [...(s.runnerSubs || []), chatId]
  saveSubsFile(s)
  return true
}
function unsubscribe(chatId) {
  const s = loadSubsFile()
  s.runnerSubs = (s.runnerSubs || []).filter((id) => id !== chatId)
  saveSubsFile(s)
}
function loadWatches() { return loadSubsFile().watches || {} }
function addWatch(chatId, symbol) {
  const s = loadSubsFile()
  s.watches = s.watches || {}
  const list = new Set(s.watches[String(chatId)] || [])
  list.add(symbol.toUpperCase())
  s.watches[String(chatId)] = [...list]
  saveSubsFile(s)
}
function removeWatch(chatId, symbol) {
  const s = loadSubsFile()
  if (!s.watches?.[String(chatId)]) return
  s.watches[String(chatId)] = s.watches[String(chatId)].filter((sy) => sy !== symbol.toUpperCase())
  if (!s.watches[String(chatId)].length) delete s.watches[String(chatId)]
  saveSubsFile(s)
}

/* ─── Telegram MarkdownV2 escape ─────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

/* ─── Token lookup helpers ───────────────────────────────────────── */
async function findToken(symbolOrCgId) {
  const data = await getXDashBootstrap({ perPage: 100 })
  const sym = String(symbolOrCgId || '').toUpperCase().replace(/^\$/, '')
  const tokens = data.tokens || []
  return tokens.find((t) => {
    const tk = t.token || {}
    return String(tk.symbol || '').toUpperCase() === sym
      || String(tk.cg_id || '').toLowerCase() === sym.toLowerCase()
  })
}

function argFromMessage(text, cmd) {
  const re = new RegExp(`^/${cmd}(?:\\s+(.+))?`, 'i')
  const m = (text || '').match(re)
  return (m?.[1] || '').trim()
}

/* ──────────────────────────────────────────────────────────────────
   TEXT COMMANDS
   ────────────────────────────────────────────────────────────────── */

async function handleTop(ctx) {
  const txt = ctx.message?.text || ''
  const m = txt.match(/\/top(?:xd|15)?(?:\s+(\d+))?/i)
  const n = Math.min(25, Math.max(3, Number(m?.[1]) || 15))
  await ctx.reply(`Loading top ${n} by 24h attention…`).catch(() => {})

  let data
  try { data = await getXDashBootstrap({ perPage: n }) }
  catch (e) { return ctx.reply(`X-Dash fetch failed: ${e.message}`) }

  const rows = (data.tokens || []).slice(0, n)
  if (!rows.length) return ctx.reply('No X-Dash data right now.')

  const lines = [
    `*🔥 X\\-Dash · Top ${n} · 24h*`,
    `_${esc(fmtNum(data.token_count || rows.length))} scanned · ${esc(fmtNum(data.mention_count))} mentions_`,
    '',
  ]
  for (const row of rows) {
    const tok = row.token || {}
    const sym = (tok.symbol || '?').toUpperCase()
    const dir = row.rank_direction === 'up' ? '▲' : row.rank_direction === 'down' ? '▼' : '•'
    const mcap = tok.market_cap ? ` · ${fmtUsd(tok.market_cap)}` : ''
    lines.push(`*${esc(`#${row.rank_position}`)}* ${dir} *${esc(`$${sym}`)}* — ${esc(tok.name || sym)}${esc(mcap)}`)
    lines.push(`    ${esc(fmtNum(row.metrics?.external_mentions_24h))} ment · ${esc(fmtNum(row.metrics?.unique_external_authors_24h))} auth · ${esc(fmtNum(row.metrics?.total_weighted_engagement))} eng`)
  }
  lines.push('')
  lines.push('_/signals · /runners · /xdmap_')
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

/**
 * /signals — Spectre Momentum leaderboard.
 *
 * Powered by the canonical X-Dash leaderboard bundle endpoint
 * (`/api/xdash/leaderboard-bundle?ranking=momentum`). Each `board.tokens[]`
 * row already carries full metrics + quality + momentum_entry + rank deltas,
 * so no second fetch is needed.
 *
 * Sort modifiers (default = bundle's native momentum rank):
 *   /signals clean      by clean_signal_score_24h (cleanest carriers first)
 *   /signals mentions   by external_mentions_24h
 *   /signals velocity   by velocity_ratio (acceleration)
 *   /signals perf       by since-entry % (best performers post-entry)
 *   /signals fresh      by entered_at desc (most recent entries first)
 *   /signals climb      by rank_change_positions (biggest rank movers up)
 */
async function handleSignals(ctx) {
  const arg = argFromMessage(ctx.message?.text, 'signals').toLowerCase()
  const validModes = ['clean', 'mentions', 'velocity', 'perf', 'fresh', 'climb']
  const sortMode = validModes.includes(arg) ? arg : 'board'
  const sortLabel = {
    board: 'momentum rank',
    clean: 'clean signal',
    mentions: 'mentions 24h',
    velocity: 'velocity',
    perf: 'since-entry %',
    fresh: 'most recent entries',
    climb: 'rank climbers',
  }[sortMode]

  await ctx.reply(`Loading Momentum leaderboard · ${sortLabel}…`).catch(() => {})

  let bundle
  try {
    bundle = await getXDashLeaderboardBundle({
      timeframe: '24h',
      ranking: 'momentum',
      segment: 'all',
      market: 'all',
      perPage: 20,
      heroLimit: 20,
      treemapLimit: 48,
    })
  } catch (e) {
    return ctx.reply(`Leaderboard fetch failed: ${e.message}`)
  }

  if (bundle.board?.status !== 'ok') {
    return ctx.reply(`Board unavailable: ${bundle.board?.error || 'unknown error'}`)
  }
  const rows = bundle.board?.tokens || []
  if (!rows.length) return ctx.reply('No active momentum setups.')

  // Decorate rows with derived signal fields (sinceEntryPct, enteredAtMs)
  const decorated = rows.map((row) => {
    const tok = row.token || {}
    const entry = row.momentum_entry || {}
    const m = row.metrics || {}
    const q = row.quality || {}
    const entryMcap = Number(entry.entry_market_cap || 0)
    const liveMcap = Number(tok.market_cap || 0)
    const sinceEntryPct = entryMcap > 0 && liveMcap > 0
      ? ((liveMcap - entryMcap) / entryMcap) * 100
      : null
    return {
      ...row,
      _signal: {
        mentions: Number(m.external_mentions_24h || 0),
        authors: Number(m.unique_external_authors_24h || 0),
        engagement: Number(m.total_weighted_engagement || 0),
        velocity: Number(m.velocity_ratio || 0),
        novelty: Number(m.novelty_ratio || 0),
        cleanSignal: Number(q.clean_signal_score_24h ?? q.clean_signal_score ?? 0),
        spamScore: Number(q.spam_score || 0),
        sinceEntryPct,
        enteredAtMs: new Date(entry.entered_at || 0).getTime(),
        rankChange: Number(row.rank_change_positions || 0),
      },
    }
  })

  decorated.sort((a, b) => {
    switch (sortMode) {
      case 'clean':    return b._signal.cleanSignal - a._signal.cleanSignal
      case 'mentions': return b._signal.mentions - a._signal.mentions
      case 'velocity': return b._signal.velocity - a._signal.velocity
      case 'perf': {
        const ax = a._signal.sinceEntryPct ?? -Infinity
        const bx = b._signal.sinceEntryPct ?? -Infinity
        return bx - ax
      }
      case 'fresh':    return b._signal.enteredAtMs - a._signal.enteredAtMs
      case 'climb':    return b._signal.rankChange - a._signal.rankChange
      default:         return (a.rank_position || 0) - (b.rank_position || 0)
    }
  })

  const top = decorated.slice(0, 10)
  const total = bundle.board?.pagination?.total ?? bundle.board?.pagination?.filtered_count ?? rows.length

  const lines = [
    `*📡 Spectre Momentum · Top ${esc(String(top.length))} of ${esc(fmtNum(total))} · 24h*`,
    `_sorted by ${esc(sortLabel)}_`,
    `_/signals clean · mentions · velocity · perf · fresh · climb_`,
    '',
  ]
  for (const row of top) {
    const tok = row.token || {}
    const sym = (tok.symbol || '?').toUpperCase()
    const entry = row.momentum_entry || {}
    const s = row._signal
    const tone = s.sinceEntryPct == null ? '·' : s.sinceEntryPct >= 0 ? '🟢' : '🔴'
    const rankArrow = s.rankChange > 0 ? '▲' : s.rankChange < 0 ? '▼' : ''
    const rankDelta = s.rankChange !== 0 ? ` ${rankArrow}${Math.abs(s.rankChange)}` : ''

    const mcap = tok.market_cap ? ` · ${fmtUsd(tok.market_cap)}` : ''
    lines.push(`*${esc(`#${row.rank_position}`)}*${esc(rankDelta)} ${tone} *${esc(`$${sym}`)}* — ${esc(tok.name || sym)}${esc(mcap)}`)

    const signalParts = []
    if (s.mentions)   signalParts.push(`${fmtNum(s.mentions)} ment`)
    if (s.authors)    signalParts.push(`${fmtNum(s.authors)} auth`)
    if (s.engagement) signalParts.push(`${fmtNum(s.engagement)} eng`)
    if (signalParts.length) lines.push('    ' + esc(signalParts.join(' · ')))

    const scoreParts = []
    if (s.cleanSignal > 0) scoreParts.push(`clean ${(s.cleanSignal * 100).toFixed(0)}%`)
    if (s.velocity > 0)    scoreParts.push(`vel ${s.velocity.toFixed(2)}x`)
    if (s.novelty > 0)     scoreParts.push(`nov ${s.novelty.toFixed(2)}x`)
    if (s.spamScore > 0.1) scoreParts.push(`spam ${(s.spamScore * 100).toFixed(0)}%`)
    if (scoreParts.length) lines.push('    ' + esc(scoreParts.join(' · ')))

    const entryParts = []
    if (entry.entry_rank)        entryParts.push(`entered #${entry.entry_rank}`)
    if (entry.entered_at)        entryParts.push(`${fmtAgo(entry.entered_at)} ago`)
    if (entry.entry_market_cap)  entryParts.push(`${fmtUsd(entry.entry_market_cap)} → ${fmtUsd(tok.market_cap || 0)}`)
    if (s.sinceEntryPct != null) entryParts.push(fmtPct(s.sinceEntryPct))
    if (entryParts.length) lines.push('    ' + esc('↳ ' + entryParts.join(' · ')))

    lines.push('')
  }

  lines.push('_/runners fresh entries · /top pure attention · /clean cleanest signal_')
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleRunners(ctx) {
  return handleEntryWindow(ctx, 24 * 60 * 60 * 1000, '24h')
}
async function handleFresh(ctx) {
  return handleEntryWindow(ctx, 6 * 60 * 60 * 1000, '6h')
}
async function handleEntryWindow(ctx, windowMs, label) {
  await ctx.reply(`Hunting runners (last ${label})…`).catch(() => {})
  let data
  try { data = await getMomentumSetups({ limit: 25 }) }
  catch (e) { return ctx.reply(`Momentum fetch failed: ${e.message}`) }

  const cutoff = Date.now() - windowMs
  const fresh = (data.tokens || []).filter((row) => {
    const ts = new Date(row.momentum_entry?.entered_at || 0).getTime()
    return Number.isFinite(ts) && ts >= cutoff
  })
  if (!fresh.length) return ctx.reply(`No fresh runners in the last ${label}. Spectre is watching.`)

  fresh.sort((a, b) =>
    new Date(b.momentum_entry.entered_at) - new Date(a.momentum_entry.entered_at)
  )

  const lines = [`*🆕 Fresh runners · ${esc(String(fresh.length))} in ${label}*`, '']
  for (const row of fresh) {
    const tok = row.token || {}
    const sym = (tok.symbol || '?').toUpperCase()
    const entry = row.momentum_entry || {}
    const entryMcap = Number(entry.entry_market_cap || 0)
    const liveMcap = Number(tok.market_cap || 0)
    const pct = entryMcap > 0 && liveMcap > 0
      ? ((liveMcap - entryMcap) / entryMcap) * 100
      : null
    const tone = pct == null ? '·' : pct >= 0 ? '🟢' : '🔴'
    lines.push(`${tone} *${esc(`$${sym}`)}* — ${esc(tok.name || sym)}`)
    const detail = [`entered ${fmtAgo(entry.entered_at)} ago at ${fmtUsd(entryMcap)}`]
    if (pct != null) detail.push(fmtPct(pct))
    if (tok.chain) detail.push(tok.chain)
    lines.push('    ' + esc(detail.join(' · ')))
  }
  lines.push('')
  lines.push(isSubscribed(ctx.chat?.id)
    ? '_Alerts ON · /alerts off to stop_'
    : '_/alerts on to get pushed when a new runner enters_')
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleMovers(ctx) {
  return handleRankChange(ctx, 'up')
}
async function handleDump(ctx) {
  return handleRankChange(ctx, 'down')
}
async function handleRankChange(ctx, dir) {
  await ctx.reply(`Loading ${dir === 'up' ? 'climbers' : 'fallers'}…`).catch(() => {})
  let data
  try { data = await getXDashBootstrap({ perPage: 50 }) }
  catch (e) { return ctx.reply(`X-Dash fetch failed: ${e.message}`) }

  const rows = (data.tokens || []).filter((r) => Number.isFinite(r.rank_change_positions))
  const sorted = [...rows].sort((a, b) => dir === 'up'
    ? b.rank_change_positions - a.rank_change_positions
    : a.rank_change_positions - b.rank_change_positions)
  const top = sorted.slice(0, 10)
  if (!top.length) return ctx.reply('No rank-change data yet.')

  const arrow = dir === 'up' ? '⬆️' : '⬇️'
  const title = dir === 'up' ? 'Climbers' : 'Fallers'
  const lines = [`*${arrow} ${esc(title)} · 24h*`, '']
  for (const row of top) {
    const tok = row.token || {}
    const sym = (tok.symbol || '?').toUpperCase()
    const prev = row.previous_rank_position
    const now = row.rank_position
    const delta = row.rank_change_positions
    const sign = delta > 0 ? '+' : ''
    lines.push(`*${esc(`$${sym}`)}* — ${esc(tok.name || sym)}`)
    lines.push(`    rank ${esc(`#${prev}`)} → ${esc(`#${now}`)} \\(${esc(sign + delta)} positions\\) · ${esc(fmtNum(row.metrics?.external_mentions_24h))} ment`)
  }
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleClean(ctx) {
  const txt = ctx.message?.text || ''
  const n = Math.min(15, Math.max(3, Number(txt.match(/(\d+)/)?.[1]) || 10))
  await ctx.reply(`Loading top ${n} by clean signal…`).catch(() => {})

  let data
  try { data = await getXDashBootstrap({ perPage: 100 }) }
  catch (e) { return ctx.reply(`X-Dash fetch failed: ${e.message}`) }

  const rows = (data.tokens || []).filter((r) =>
    Number.isFinite(Number(r.quality?.clean_signal_score_24h ?? r.quality?.clean_signal_score))
  )
  const sorted = [...rows].sort((a, b) => {
    const ax = Number(a.quality?.clean_signal_score_24h ?? a.quality?.clean_signal_score ?? 0)
    const bx = Number(b.quality?.clean_signal_score_24h ?? b.quality?.clean_signal_score ?? 0)
    return bx - ax
  }).slice(0, n)

  if (!sorted.length) return ctx.reply('No clean-signal data yet.')
  const lines = [`*✨ Cleanest signal · Top ${n}*`, `_filters out promo language \\+ bot echo \\+ multi\\-token shilling_`, '']
  for (const row of sorted) {
    const tok = row.token || {}
    const sym = (tok.symbol || '?').toUpperCase()
    const clean = Number(row.quality?.clean_signal_score_24h ?? row.quality?.clean_signal_score ?? 0)
    const spam = Number(row.quality?.spam_score ?? 0)
    lines.push(`*${esc(`$${sym}`)}* — ${esc(tok.name || sym)}`)
    lines.push(`    clean ${esc((clean * 100).toFixed(0) + '%')} · spam ${esc((spam * 100).toFixed(0) + '%')} · rank ${esc(`#${row.rank_position}`)}`)
  }
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleToken(ctx) {
  const sym = argFromMessage(ctx.message?.text, 'token').replace(/^\$/, '').toUpperCase()
  if (!sym) return ctx.reply('Usage: /token <symbol>\nExample: /token VIRL')

  await ctx.reply(`Looking up $${sym}…`).catch(() => {})
  const found = await findToken(sym).catch(() => null)
  if (!found) return ctx.reply(`$${sym} not currently on X-Dash boards.`)

  const tok = found.token || {}
  const m = found.metrics || {}
  const q = found.quality || {}
  const entry = found.momentum_entry || null
  const topAuthors = (found.top_authors || []).slice(0, 3)

  const lines = [
    `*${esc(`$${(tok.symbol || sym).toUpperCase()}`)} — ${esc(tok.name || sym)}*`,
    `_${esc(tok.chain || '?')} · rank ${esc(`#${found.rank_position}`)}${tok.market_cap ? ' · ' + esc(fmtUsd(tok.market_cap)) : ''}_`,
    '',
    `*Mentions 24h*: ${esc(fmtNum(m.external_mentions_24h))}`,
    `*Unique authors 24h*: ${esc(fmtNum(m.unique_external_authors_24h))}`,
    `*Weighted engagement*: ${esc(fmtNum(m.total_weighted_engagement))}`,
    `*Velocity / Novelty*: ${esc((Number(m.velocity_ratio) || 0).toFixed(2))}x / ${esc((Number(m.novelty_ratio) || 0).toFixed(2))}x`,
    `*Clean signal*: ${esc(((Number(q.clean_signal_score_24h ?? q.clean_signal_score) || 0) * 100).toFixed(0) + '%')}`,
  ]
  if (entry?.entered_at) {
    const pct = entry.entry_market_cap && tok.market_cap
      ? ((tok.market_cap - entry.entry_market_cap) / entry.entry_market_cap) * 100
      : null
    lines.push('')
    lines.push(`*📡 Momentum entry*: #${esc(String(entry.entry_rank))} · ${esc(fmtAgo(entry.entered_at))} ago`)
    if (entry.entry_market_cap) {
      lines.push(`    ${esc(fmtUsd(entry.entry_market_cap))} → ${esc(fmtUsd(tok.market_cap || 0))}${pct != null ? ' · ' + esc(fmtPct(pct)) : ''}`)
    }
  }
  if (topAuthors.length) {
    lines.push('')
    lines.push(`*Top carriers*:`)
    for (const a of topAuthors) {
      const handle = a.author?.screen_name || a.screen_name || '?'
      const ment = a.recent_mentions_24h || a.mention_count || 0
      lines.push(`    @${esc(handle)} · ${esc(fmtNum(ment))} ment`)
    }
  }
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleWho(ctx) {
  const sym = argFromMessage(ctx.message?.text, 'who').replace(/^\$/, '').toUpperCase()
  if (!sym) return ctx.reply('Usage: /who <symbol>\nExample: /who VIRL')

  const found = await findToken(sym).catch(() => null)
  if (!found) return ctx.reply(`$${sym} not on the X-Dash board.`)
  const tok = found.token || {}
  const authors = (found.top_authors || []).slice(0, 10)
  if (!authors.length) return ctx.reply(`No carriers tracked for $${sym} yet.`)

  const lines = [`*Carriers · ${esc(`$${(tok.symbol || sym).toUpperCase()}`)}*`, '']
  for (const a of authors) {
    const author = a.author || a
    const handle = author.screen_name || '?'
    const followers = Number(author.followers_count || 0)
    const ment = Number(a.recent_mentions_24h ?? a.mention_count ?? 0)
    const eng = Number(a.recent_weighted_engagement_24h ?? a.total_weighted_engagement ?? 0)
    const tierTag = author.is_blue_verified ? '✓' : author.legacy_verified ? '✓' : ''
    lines.push(`*@${esc(handle)}* ${tierTag} · ${esc(fmtNum(followers))} followers`)
    lines.push(`    ${esc(fmtNum(ment))} ment · ${esc(fmtNum(eng))} eng`)
  }
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleQuality(ctx) {
  const sym = argFromMessage(ctx.message?.text, 'quality').replace(/^\$/, '').toUpperCase()
  if (!sym) return ctx.reply('Usage: /quality <symbol>')

  const found = await findToken(sym).catch(() => null)
  if (!found) return ctx.reply(`$${sym} not on the board.`)
  const tok = found.token || {}
  const q = found.quality || {}

  const lines = [
    `*Quality · ${esc(`$${(tok.symbol || sym).toUpperCase()}`)}*`,
    '',
    `*Status*: ${esc(q.quality_status || '?')}`,
    `*Clean signal*: ${esc(((Number(q.clean_signal_score_24h ?? q.clean_signal_score) || 0) * 100).toFixed(0) + '%')}`,
    `*Spam score*: ${esc(((Number(q.spam_score) || 0) * 100).toFixed(0) + '%')}`,
    `*Promo share*: ${esc(((Number(q.promo_share_24h ?? q.promo_share) || 0) * 100).toFixed(0) + '%')}`,
    `*Unique authors*: ${esc(((Number(q.unique_author_share) || 0) * 100).toFixed(0) + '%')}`,
    `*Cashtag-only*: ${esc(((Number(q.cashtag_only_share) || 0) * 100).toFixed(0) + '%')}`,
    `*Handle-only*: ${esc(((Number(q.handle_only_share) || 0) * 100).toFixed(0) + '%')}`,
    `*Both-match*: ${esc(((Number(q.both_match_share_24h ?? q.both_match_share) || 0) * 100).toFixed(0) + '%')}`,
  ]
  const reasons = Array.isArray(q.quality_reasons) ? q.quality_reasons : []
  if (reasons.length) {
    lines.push('')
    lines.push(`_${esc('flags: ' + reasons.join(', '))}_`)
  }
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleCompare(ctx) {
  const txt = argFromMessage(ctx.message?.text, 'compare')
  const parts = txt.split(/\s+|vs|,/i).map((s) => s.trim().replace(/^\$/, '').toUpperCase()).filter(Boolean)
  if (parts.length < 2) return ctx.reply('Usage: /compare BTC ETH')
  const [s1, s2] = parts

  const [a, b] = await Promise.all([findToken(s1), findToken(s2)]).catch(() => [null, null])
  if (!a || !b) return ctx.reply(`Couldn't find one of: $${s1} / $${s2}.`)

  const row = (r) => {
    const tk = r.token || {}, m = r.metrics || {}, q = r.quality || {}
    return {
      sym: tk.symbol, name: tk.name, rank: r.rank_position,
      mcap: tk.market_cap, ment: m.external_mentions_24h,
      auth: m.unique_external_authors_24h, eng: m.total_weighted_engagement,
      clean: Number(q.clean_signal_score_24h ?? q.clean_signal_score) || 0,
    }
  }
  const A = row(a), B = row(b)
  const arrow = (x, y) => x > y ? '🟢' : x < y ? '🔴' : '⚪️'
  const lines = [
    `*${esc(`$${A.sym}`)} vs ${esc(`$${B.sym}`)}*`,
    '',
    `*Rank*  ${arrow(B.rank, A.rank)} ${esc(`#${A.rank}`)} vs ${esc(`#${B.rank}`)}`,
    `*Mcap*  ${arrow(A.mcap, B.mcap)} ${esc(fmtUsd(A.mcap))} vs ${esc(fmtUsd(B.mcap))}`,
    `*Mentions 24h*  ${arrow(A.ment, B.ment)} ${esc(fmtNum(A.ment))} vs ${esc(fmtNum(B.ment))}`,
    `*Authors 24h*  ${arrow(A.auth, B.auth)} ${esc(fmtNum(A.auth))} vs ${esc(fmtNum(B.auth))}`,
    `*Engagement*  ${arrow(A.eng, B.eng)} ${esc(fmtNum(A.eng))} vs ${esc(fmtNum(B.eng))}`,
    `*Clean signal*  ${arrow(A.clean, B.clean)} ${esc((A.clean * 100).toFixed(0))}% vs ${esc((B.clean * 100).toFixed(0))}%`,
  ]
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleCreators(ctx) {
  const n = Math.min(15, Math.max(3, Number(ctx.message?.text?.match(/(\d+)/)?.[1]) || 10))
  await ctx.reply(`Loading top ${n} creators by board impact…`).catch(() => {})

  let data
  try { data = await getXDashBootstrap({ perPage: 30 }) }
  catch (e) { return ctx.reply(`X-Dash fetch failed: ${e.message}`) }

  // Aggregate carriers across all tokens — sum mentions + weighted engagement
  const agg = new Map()
  for (const row of (data.tokens || [])) {
    for (const a of (row.top_authors || [])) {
      const handle = a.author?.screen_name || a.screen_name
      if (!handle) continue
      const e = agg.get(handle) || {
        handle,
        followers: a.author?.followers_count || 0,
        verified: !!(a.author?.is_blue_verified || a.author?.legacy_verified),
        mentions: 0, engagement: 0, tokens: new Set(),
      }
      e.mentions += Number(a.recent_mentions_24h || a.mention_count || 0)
      e.engagement += Number(a.recent_weighted_engagement_24h || a.total_weighted_engagement || 0)
      e.tokens.add(row.token?.symbol)
      agg.set(handle, e)
    }
  }
  const sorted = [...agg.values()].sort((a, b) => b.engagement - a.engagement).slice(0, n)
  if (!sorted.length) return ctx.reply('No carrier data right now.')

  const lines = [`*👥 Top creators · by board impact*`, '']
  for (const c of sorted) {
    const v = c.verified ? '✓' : ''
    lines.push(`*@${esc(c.handle)}* ${v}`)
    lines.push(`    ${esc(fmtNum(c.followers))} foll · ${esc(fmtNum(c.mentions))} ment · ${esc(fmtNum(c.engagement))} eng · ${esc(String(c.tokens.size))} tokens`)
  }
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleNarratives(ctx) {
  await ctx.reply('Loading narratives…').catch(() => {})
  let data
  try { data = await getXDashBootstrap({ perPage: 50 }) }
  catch (e) { return ctx.reply(`X-Dash fetch failed: ${e.message}`) }

  // Aggregate by token.tags (CG categories) — sum mentions per narrative
  const agg = new Map()
  for (const row of (data.tokens || [])) {
    const tags = (row.token?.tags || row.token?.category || [])
    const mentions = Number(row.metrics?.external_mentions_24h || 0)
    const eng = Number(row.metrics?.total_weighted_engagement || 0)
    for (const tag of tags) {
      const t = agg.get(tag) || { tag, mentions: 0, eng: 0, tokens: 0 }
      t.mentions += mentions
      t.eng += eng
      t.tokens += 1
      agg.set(tag, t)
    }
  }
  const sorted = [...agg.values()].sort((a, b) => b.eng - a.eng).slice(0, 10)
  if (!sorted.length) return ctx.reply('No narrative data yet.')

  const lines = [`*🧭 Narratives · by aggregate eng*`, '']
  for (const n of sorted) {
    lines.push(`*${esc(n.tag)}*`)
    lines.push(`    ${esc(fmtNum(n.eng))} eng · ${esc(fmtNum(n.mentions))} ment · ${esc(String(n.tokens))} tokens`)
  }
  return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
}

async function handleDigest(ctx) {
  await ctx.reply('Building digest…').catch(() => {})
  try {
    const [boot, momentum] = await Promise.all([
      getXDashBootstrap({ perPage: 5 }),
      getMomentumSetups({ limit: 25 }),
    ])
    const lines = [
      `*📊 Spectre Daily Digest*`,
      `_${esc(new Date().toUTCString())}_`,
      '',
      `*🔥 Top 5 by attention*`,
    ]
    for (const r of (boot.tokens || []).slice(0, 5)) {
      const tk = r.token || {}
      const dir = r.rank_direction === 'up' ? '▲' : r.rank_direction === 'down' ? '▼' : '•'
      lines.push(`  ${dir} *${esc(`$${tk.symbol}`)}* · ${esc(fmtNum(r.metrics?.external_mentions_24h))} ment`)
    }

    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const fresh = (momentum.tokens || []).filter((row) => {
      const ts = new Date(row.momentum_entry?.entered_at || 0).getTime()
      return Number.isFinite(ts) && ts >= cutoff
    })
    lines.push('')
    lines.push(`*🆕 Fresh runners 24h*: ${esc(String(fresh.length))}`)
    for (const r of fresh.slice(0, 3)) {
      const tk = r.token || {}
      const entry = r.momentum_entry || {}
      lines.push(`  • *${esc(`$${tk.symbol}`)}* — entered ${esc(fmtAgo(entry.entered_at))} ago`)
    }

    lines.push('')
    lines.push('_/top · /signals · /runners · /xdmap_')
    return ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' })
  } catch (e) {
    return ctx.reply(`Digest failed: ${e.message}`)
  }
}

/* ──────────────────────────────────────────────────────────────────
   SUBSCRIPTIONS
   ────────────────────────────────────────────────────────────────── */

async function handleAlerts(ctx) {
  const txt = (ctx.message?.text || '').toLowerCase()
  const chatId = ctx.chat?.id
  if (!chatId) return ctx.reply('Cannot identify chat.')
  if (/\bon\b/.test(txt)) {
    const added = subscribe(chatId)
    return ctx.reply(added
      ? '✅ Runner alerts ENABLED. You will be pinged when a new token enters the Momentum Top 25.'
      : 'Already subscribed.')
  }
  if (/\boff\b/.test(txt)) {
    unsubscribe(chatId)
    return ctx.reply('🔕 Runner alerts DISABLED.')
  }
  return ctx.reply(isSubscribed(chatId)
    ? 'Alerts: ON\n/alerts off to stop · /watch <sym> for per-token alerts'
    : 'Alerts: OFF\n/alerts on to subscribe · /watch <sym> for per-token alerts')
}

async function handleWatch(ctx) {
  const sym = argFromMessage(ctx.message?.text, 'watch').replace(/^\$/, '').toUpperCase()
  const chatId = ctx.chat?.id
  if (!sym) return ctx.reply('Usage: /watch <symbol>\nExample: /watch VIRL')
  addWatch(chatId, sym)
  const watches = loadWatches()[String(chatId)] || []
  return ctx.reply(`👁 Watching $${sym}.\nCurrent watch list: ${watches.map((s) => '$' + s).join(', ')}`)
}

async function handleUnwatch(ctx) {
  const sym = argFromMessage(ctx.message?.text, 'unwatch').replace(/^\$/, '').toUpperCase()
  const chatId = ctx.chat?.id
  if (!sym) return ctx.reply('Usage: /unwatch <symbol>')
  removeWatch(chatId, sym)
  return ctx.reply(`Stopped watching $${sym}.`)
}

/* ──────────────────────────────────────────────────────────────────
   HELP
   ────────────────────────────────────────────────────────────────── */

const HELP_TEXT = `*🛰 Spectre X-Dash Bot*

*Top of the board*
• /top \\[n\\] — top N by 24h attention
• /signals — Spectre Momentum board
• /runners — entered Top 25 in 24h
• /fresh — entered in last 6h
• /movers — biggest climbers
• /dump — biggest fallers
• /clean \\[n\\] — best clean\\-signal tokens

*Per token*
• /token <sym> — full brief
• /who <sym> — top carriers
• /quality <sym> — spam + clean breakdown
• /compare <s1> <s2> — head to head

*Discovery*
• /creators \\[n\\] — top KOLs by board impact
• /narratives — top narratives by attention
• /digest — one\\-screen overview

*Visual*
• /xdmap — attention heatmap
• /narrmap — narratives heatmap
• /creatormap — creators heatmap
• /drawer <sym> — token drawer

*Alerts*
• /alerts on \\| off — new\\-runner notifications
• /watch <sym> — per\\-token alerts
• /unwatch <sym>
`

async function handleXDHelp(ctx) {
  return ctx.reply(HELP_TEXT, { parse_mode: 'MarkdownV2' })
}

module.exports = {
  // text
  handleTop,
  handleSignals,
  handleRunners,
  handleFresh,
  handleMovers,
  handleDump,
  handleClean,
  handleToken,
  handleWho,
  handleQuality,
  handleCompare,
  handleCreators,
  handleNarratives,
  handleDigest,
  // subs
  handleAlerts,
  handleWatch,
  handleUnwatch,
  // help
  handleXDHelp,
  // watcher hooks
  loadSubs,
  loadWatches,
}
