const { Bot, InputFile } = require('grammy')
const { autoRetry } = require('@grammyjs/auto-retry')
const { BOT_TOKEN, TIMEFRAMES, DEFAULT_TF, SCAN_TF, BOT_ACCESS, BOT_INVITE_CODE } = require('./config')
const guard = require('./guard')
const waitlist = require('./waitlist')
const boards = require('./boards')
const { welcomeCard } = require('./welcome-card')
const store = require('./store')
const api = require('./spectre-api')
const cards = require('./cards')
const { chartPng } = require('./chart-service')
const { THEMES } = require('./themes')
const { esc, price, move, usd, ago } = require('./format')
const kb = require('./keyboards')
const { fearGreedChart } = require('./gauge')
const appShot = require('./app-shot')
const { handleAlertCommand, startAlertPoller } = require('./alerts')
const utils = require('./utils')
const subs = require('./subscriptions')
const buybot = require('./buybot')
const marketOverview = require('./market-overview')
const gm = require('./gm-card')
const i18n = require('./i18n')
const runnerEngine = require('./runner-engine')
const stocks = require('./stocks')

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN missing — set it in the repo root .env')
  process.exit(1)
}

const bot = new Bot(BOT_TOKEN)
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }))

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }

function userTf(id) {
  const tf = store.user(id).prefs.tf
  return TIMEFRAMES[tf] ? tf : DEFAULT_TF
}
function userTheme(id) {
  const t = store.user(id).prefs.theme
  return THEMES[t] ? t : 'spectre'
}
// common coin NAMES → tickers, so "/chart bitcoin" never resolves a junk
// "BITCOIN"-symbol token from the price lane
const SYMBOL_ALIASES = {
  BITCOIN: 'BTC', ETHEREUM: 'ETH', SOLANA: 'SOL', DOGECOIN: 'DOGE', CARDANO: 'ADA',
  RIPPLE: 'XRP', LITECOIN: 'LTC', CHAINLINK: 'LINK', POLKADOT: 'DOT', AVALANCHE: 'AVAX',
  POLYGON: 'POL', TRON: 'TRX', TONCOIN: 'TON', BINANCE: 'BNB', MONERO: 'XMR',
}
function parseSymbol(match, fallback = 'BTC') {
  const args = (match || '').trim().split(/\s+/).filter(Boolean)
  const raw = (args[0] || fallback).replace(/^\$/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 15)
  const up = (raw || fallback).toUpperCase()
  return { symbol: SYMBOL_ALIASES[up] || up, rest: args.slice(1) }
}

// ---------- access gate + rate limits (before every handler)

bot.use(async (ctx, next) => {
  if (!ctx.from || ctx.from.is_bot) return
  const uid = ctx.from.id
  const text = ctx.msg?.text || ''

  // BUYBOT-ONLY TIER: in groups, the buy bot is open to everyone — teams run
  // /buybot + its panel without Spectre Intelligence access. Every other
  // feature stays invite-gated (their Scan taps funnel to the invite prompt).
  const isGroup = ctx.chat && ctx.chat.type !== 'private'
  const buybotScoped =
    isGroup &&
    (/^\/(buybot|calls)\b/.test(text) ||
      String(ctx.callbackQuery?.data || '').startsWith('by|') ||
      buybot.hasPending(ctx.chat.id, uid))
  if (!guard.hasAccess(uid) && buybotScoped) {
    const gate = guard.allow(uid, 'heavy')
    if (!gate.ok) return
    return next()
  }

  if (!guard.hasAccess(uid)) {
    const code = text.match(/^\/start\s+(\S+)/)?.[1] || text.match(/^\/code\s+(\S+)/)?.[1]
    let granted = false
    if (code && guard.tryCode(uid, code)) granted = true
    // beta-waitlist sync: signed up for the Spectre beta with this @username → in
    else if (ctx.from.username && (await waitlist.isWhitelisted(ctx.from.username))) {
      store.setAccess(uid, true)
      granted = true
    }
    // admin whitelisted this @handle before the user ever messaged the bot
    else if (ctx.from.username && store.consumePendingGrant(ctx.from.username)) {
      store.setAccess(uid, true)
      granted = true
    }
    if (granted) {
      store.touchProfile(uid, ctx.from)
      if (/^\/start/.test(text)) {
        await sendWelcome(ctx)
        return
      }
      // fall through — first message can be any command
    } else {
      if (/^\/myid/.test(text)) return ctx.reply(`Your Telegram ID: <code>${uid}</code>`, { parse_mode: 'HTML' })
      if (ctx.chat?.type === 'private' && (/^\/start/.test(text) || /^\/code/.test(text))) {
        return ctx.reply(
          '🜲 <b>Spectre AI Intelligence</b> is in private beta.\n\n' +
            'Spectre beta members are recognized automatically by their Telegram @username — ' +
            'if you joined the beta, make sure your @username matches your signup and hit /start again.\n\n' +
            'Otherwise enter with <code>/code YOUR-INVITE</code> or ask the Spectre team for an invite.',
          { parse_mode: 'HTML' },
        )
      }
      return // silent for everything else (especially in groups)
    }
  }

  const heavy = /^\/(c|x|chart|scan|heatmap|hm|bubbles|bb|picks|lore)\b/.test(text) || Boolean(ctx.callbackQuery)
  const gate = guard.allow(uid, heavy ? 'heavy' : 'all')
  if (!gate.ok) {
    if (ctx.callbackQuery) return ctx.answerCallbackQuery({ text: `Easy — try again in ${gate.waitS}s` }).catch(() => {})
    if (ctx.chat?.type === 'private') return ctx.reply(`⏳ Rate limit — try again in ${gate.waitS}s.`).catch(() => {})
    return
  }
  await next()
})

// buy-bot settings answers (emoji / media uploads) are consumed before any
// other handler sees the message
bot.use(async (ctx, next) => {
  if (ctx.msg && !String(ctx.msg.text || '').startsWith('/')) {
    const consumed = await buybot.captureSetting(ctx).catch(() => false)
    if (consumed) return
  }
  return next()
})

async function sendWelcome(ctx) {
  try {
    // brand hero art first; generated card only if the asset is missing
    const fs = require('fs')
    const heroPath = require('path').resolve(__dirname, '../assets/welcome-hero.png')
    const png = fs.existsSync(heroPath) ? fs.readFileSync(heroPath) : await welcomeCard()
    await ctx.replyWithPhoto(new InputFile(png, 'spectre-welcome.png'), {
      caption: WELCOME_CAPTION,
      parse_mode: 'HTML',
      reply_markup: kb.startKeyboard(),
    })
  } catch {
    await ctx.reply(START_TEXT, { ...HTML, reply_markup: kb.startKeyboard() })
  }
}

// ---------- shared actions (used by commands AND callbacks)

// THE link policy — single choke point for every "open in app" button:
// contract resolvable → trade terminal by CA (can never hit a clone);
// verified top-100 major → Research Zone by ticker (unambiguous);
// anything else → X-Dash board. NO ticker-guessed token pages, ever.
const { APP_URL, tradeTokenUrl } = require('./config')
let majorsCache = { at: 0, set: new Set() }
async function majorsSet() {
  if (Date.now() - majorsCache.at > 10 * 60e3) {
    const rows = (await api.markets(100).catch(() => null)) || []
    if (rows.length) majorsCache = { at: Date.now(), set: new Set(rows.map((r) => r.symbol.toUpperCase())) }
  }
  return majorsCache.set
}
// Up to two deep links, ALWAYS token-connected — never a generic board.
async function tokenLink(symbol) {
  const sym = String(symbol || '').toUpperCase()
  const links = []
  // Known major → canonical Research Zone page by ticker FIRST. Never let a
  // scraped contract override a major (the STX/Stacks clone: a $18K Cronos "STX"
  // must not shadow real Stacks).
  if ((await majorsSet()).has(sym)) links.push({ label: 'Spectre ↗', url: `${APP_URL}/research-zone/${sym.toLowerCase()}` })
  const row = await api.socialRow(sym).catch(() => null)
  const contract =
    row &&
    (Object.values(row.platforms || {}).find(api.isTokenAddress) ||
      (api.isTokenAddress(row.contract_address) ? row.contract_address : null))
  // Only deep-link a CA that on-chain-verifies as this token.
  if (!links.length && contract && (await api.verifyToken(contract, sym))) links.push({ label: 'AI Screener ↗', url: tradeTokenUrl(contract) })
  const cgId = row?.token_id || row?.cg_id
  if (cgId) links.push({ label: '𝕏 X-Dash ↗', url: `${APP_URL}/x-dash/token/${encodeURIComponent(cgId)}?view=full` })
  return links.slice(0, 2)
}

async function sendPriceCard(ctx, symbol) {
  const c = await cards.coin(symbol)
  if (c) return ctx.reply(cards.priceCard(c), { ...HTML, reply_markup: kb.priceKeyboard(c.symbol, userTf(ctx.from.id)) })
  // US stocks + indices (NVDA, SPX/SP500, VIX…)
  const s = await api.stockQuote(symbol).catch(() => null)
  if (!s) return ctx.reply(`Couldn't find <b>${esc(symbol)}</b> — crypto, US stocks and SPX/NDX/VIX/DXY work.`, HTML)
  const { price: fmtPrice, usd, move, pct } = require('./format')
  const lines = [
    `<b>${esc(s.name)}</b> · ${esc(s.symbol)}  <i>${s.kind === 'index' ? 'index' : 'US stock'}</i>`,
    `<b>${fmtPrice(s.price)}</b>  ${move(s.change24)} 24h`,
    '',
    `7d ${pct(s.change7d)}${s.mcap ? ` · MCap ${usd(s.mcap)}` : ''}`,
    `<i>/alert ${s.symbol.toLowerCase()} &gt;${Math.round(s.price * 1.05)} — alerts work on stocks too</i>`,
  ]
  return ctx.reply(lines.join('\n'), HTML)
}

async function sendChart(ctx, symbol, tfKey) {
  await ctx.replyWithChatAction('upload_photo').catch(() => {})
  const c = await cards.coin(symbol).catch(() => null)
  const { png, usedTf, fellBack, busy } = await chartPng({
    symbol,
    tfKey,
    themeName: userTheme(ctx.from.id),
    change24h: c?.change?.['24h'],
  })
  if (!png) {
    if (busy) return ctx.reply('🔥 High load — try again in a few seconds.')
    // not a crypto ticker? maybe it's a stock (/chart nvda works too)
    const sq = await stocks.resolveStock(symbol).catch(() => null)
    if (sq) return sendStockCard(ctx, sq.symbol)
    return ctx.reply(`No chart data for <b>${esc(symbol)}</b> right now — the candle lane may be warming up. Try /price ${symbol.toLowerCase()}.`, HTML)
  }
  let caption = `<b>${esc(symbol)}/USD</b> · ${TIMEFRAMES[usedTf].label}`
  // only real values on the caption — never "$0" or a dangling dash
  if (c && c.price > 0) caption += ` — ${price(c.price)}`
  const ch24 = c?.change?.['24h']
  if (ch24 != null && isFinite(ch24)) caption += ` ${move(ch24)} 24h`
  if (fellBack) caption += `\n<i>${TIMEFRAMES[tfKey].label} lane cold — showing ${TIMEFRAMES[usedTf].label}</i>`
  return ctx.replyWithPhoto(new InputFile(png, `${symbol}-${usedTf}.png`), {
    caption,
    parse_mode: 'HTML',
    reply_markup: kb.tfKeyboard(symbol, usedTf, await tokenLink(symbol)),
  })
}

async function sendScan(ctx, symbol, tfOverride) {
  await ctx.replyWithChatAction('upload_photo').catch(() => {})
  // scans always open wide (SCAN_TF, not the chart pref) — TF taps override
  const tfKey = tfOverride && TIMEFRAMES[tfOverride] ? tfOverride : SCAN_TF
  let [c, social] = await Promise.all([
    cards.coin(symbol).catch(() => null),
    api.socialRow(symbol).catch(() => null),
  ])
  // The prices lane is CG-keyed — X-Dash/codex low-caps come back thin
  // (price but $0 mcap/vol, null changes, slug-cased name). Heal from
  // DexScreener by verified contract, then the X-Dash row itself.
  if (!c || !c.market_cap || !c.volume_24h || c.change?.['24h'] == null) {
    const contract =
      social &&
      (Object.values(social.platforms || {}).find(api.isTokenAddress) ||
        (api.isTokenAddress(social.contract_address) ? social.contract_address : null))
    const dex = contract && (await api.verifyToken(contract, symbol)) ? await subs.dexEnrich(contract).catch(() => null) : null
    if (dex) {
      c = c || { symbol: String(symbol).toUpperCase() }
      c.change = c.change || {}
      if (c.price == null) c.price = dex.price
      if (!c.market_cap) c.market_cap = dex.mcap
      if (!c.volume_24h) c.volume_24h = dex.vol24
      if (!c.liquidity) c.liquidity = dex.liq
      if (c.change['24h'] == null) c.change['24h'] = dex.ch24
      if (c.change['1h'] == null) c.change['1h'] = dex.ch1
      if (!c.name || c.name === String(c.name).toLowerCase()) c.name = dex.name || social?.name || c.symbol
    }
    if (c && !c.market_cap && social?.market_cap) c.market_cap = social.market_cap
  }
  if (!c) return ctx.reply(`Couldn't find <b>${esc(symbol)}</b> — check the ticker.`, HTML)
  const { png, usedTf, candles } = await chartPng({
    symbol: c.symbol,
    tfKey,
    themeName: userTheme(ctx.from.id),
    change24h: c.change?.['24h'],
  })
  let caption = cards.scanCard(c, social, candles, usedTf ? TIMEFRAMES[usedTf].label : '')
  // the depth line — deterministic read from data already in hand, zero LLM
  const tones = await api.get(`/v1/social/tone?symbols=${encodeURIComponent(c.symbol)}`, { ttlMs: 60e3 }).catch(() => null)
  const read = subs.tokenRead({ row: social, mcap: c.market_cap, vol24: c.volume_24h, ch1: c.change?.['1h'], ch24: c.change?.['24h'], tone: tones?.[c.symbol] })
  if (read) caption += `\n\n<blockquote>🧠 ${read}</blockquote>`
  const receipt = callReceipt(ctx, c.symbol, c.symbol, c.market_cap, null)
  if (receipt) caption += `\n\n${receipt}`
  if (png) {
    return ctx.replyWithPhoto(new InputFile(png, `${c.symbol}-scan.png`), {
      caption: caption.slice(0, 1024),
      parse_mode: 'HTML',
      reply_markup: kb.scanKeyboard(c.symbol, usedTf || tfKey, await tokenLink(c.symbol)),
    })
  }
  return ctx.reply(caption, { ...HTML, reply_markup: kb.scanKeyboard(c.symbol, tfKey, await tokenLink(c.symbol)) })
}

// ── group call ledger: every group scan is a CALL. First caller owns the
// receipt; later scans show what the call did. /calls = the leaderboard.
function callReceipt(ctx, key, symbol, mcap, ca) {
  try {
    if (!ctx?.chat || ctx.chat.type === 'private' || !ctx.from || !(mcap > 0)) return null
    const caller = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || 'anon'
    const { first, call } = store.recordCall(ctx.chat.id, String(key).toLowerCase(), {
      symbol: String(symbol || '').toUpperCase(),
      ca: ca || null,
      mcap,
      peakMcap: mcap,
      lastMcap: mcap,
      caller: { id: ctx.from.id, name: caller },
      ts: Date.now(),
    })
    if (first) return `🎯 <b>${esc(caller)}</b> is FIRST on $${esc(String(symbol).toUpperCase())} here — called @ <b>${usd(mcap)}</b>`
    const delta = call.mcap > 0 ? ((mcap - call.mcap) / call.mcap) * 100 : null
    const deltaTxt = delta == null ? '' : ` → now <b>${delta >= 0 ? '+' : ''}${Math.abs(delta) >= 100 ? Math.round(delta) : delta.toFixed(1)}%</b>`
    return `🏆 First call: <b>${esc(call.caller?.name || '?')}</b> @ ${usd(call.mcap)} · ${ago(call.ts)}${deltaTxt}`
  } catch {
    return null
  }
}

// /scan <contract> — any CA, any chain DexScreener tracks. Identity is exact
// (resolved by address), so this can never land on a same-ticker clone.
async function sendScanCa(ctx, ca) {
  await ctx.replyWithChatAction('typing').catch(() => {})
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(10e3) }).catch(() => null)
  const pairs = (res?.ok ? (await res.json().catch(() => null))?.pairs || [] : []).filter(
    (p) => String(p.baseToken?.address || '').toLowerCase() === String(ca).toLowerCase(),
  )
  if (!pairs.length) return ctx.reply('No live DEX pair found for that contract.', HTML)
  const top = pairs.reduce((x, y) => (((y.liquidity?.usd || 0) > (x.liquidity?.usd || 0)) ? y : x))
  const sym = (top.baseToken?.symbol || '?').toUpperCase()
  const c = {
    symbol: sym,
    name: top.baseToken?.name || sym,
    price: Number(top.priceUsd) || null,
    market_cap: Math.max(Number(top.marketCap) || 0, Number(top.fdv) || 0) || null,
    liquidity: top.liquidity?.usd ?? null,
    volume_24h: top.volume?.h24 ?? null,
    change: { '1h': top.priceChange?.h1 ?? null, '24h': top.priceChange?.h24 ?? null },
  }
  // X-Dash identity strictly by contract match — social stats + deep link
  const boot = await api.xdashBootstrap('24h', 250).catch(() => null)
  const row = (boot?.tokens || []).find((t) => {
    const cas = [...Object.values(t.platforms || {}), t.contract_address].filter(Boolean).map((v) => String(v).toLowerCase())
    return cas.includes(String(ca).toLowerCase())
  })
  // safety + provenance lines: GoPlus (holders/tax/honeypot), DEX-paid,
  // pair age, and Spectre's own Spotted receipt when the radar tracked it
  const extras = []
  if (top.pairCreatedAt) {
    const h = (Date.now() - top.pairCreatedAt) / 3600e3
    extras.push(`⏳ age ${h < 48 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`}`)
  }
  const GOPLUS_IDS = { ethereum: 1, bsc: 56, base: 8453, arbitrum: 42161, polygon: 137, optimism: 10 }
  const gpChain = GOPLUS_IDS[top.chainId]
  if (gpChain) {
    const gp = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${gpChain}?contract_addresses=${ca}`, { signal: AbortSignal.timeout(8e3) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    const t = gp?.result?.[String(ca).toLowerCase()]
    if (t) {
      const bits = []
      if (t.holder_count) bits.push(`${Number(t.holder_count).toLocaleString('en-US')} holders`)
      const top10 = Array.isArray(t.holders) ? t.holders.slice(0, 10).reduce((sum, x) => sum + (parseFloat(x.percent) || 0), 0) : null
      if (top10) bits.push(`top10 ${(top10 * 100).toFixed(0)}%`)
      if (t.buy_tax != null && t.sell_tax != null) bits.push(`tax ${Math.round(parseFloat(t.buy_tax) * 100)}/${Math.round(parseFloat(t.sell_tax) * 100)}%`)
      if (String(t.is_honeypot) === '1') bits.push('🚨 <b>HONEYPOT</b>')
      if (bits.length) extras.push(`🛡 ${bits.join(' · ')}`)
    }
  }
  const orders = await fetch(`https://api.dexscreener.com/orders/v1/${top.chainId}/${ca}`, { signal: AbortSignal.timeout(6e3) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (Array.isArray(orders) && orders.some((o) => o.type === 'tokenProfile' && o.status === 'approved')) extras.push('✅ Dex profile paid')
  const mo = await api.get(`/v1/social/momentum-origin/${encodeURIComponent(sym.toLowerCase())}`, { ttlMs: 10 * 60e3 }).catch(() => null)
  if (mo?.entry_market_cap > 0 && String(mo.symbol || '').toUpperCase() === sym) {
    extras.push(`📡 Spotted by Spectre @ ${usd(mo.entry_market_cap)}${mo.peak_market_cap > mo.entry_market_cap ? ` → peak ${usd(mo.peak_market_cap)}` : ''}`)
  }
  const tones = await api.get(`/v1/social/tone?symbols=${encodeURIComponent(sym)}`, { ttlMs: 60e3 }).catch(() => null)
  const caRead = subs.tokenRead({ row: row || null, mcap: c.market_cap, vol24: c.volume_24h, ch1: c.change?.['1h'], ch24: c.change?.['24h'], tone: tones?.[sym] })
  const receipt = callReceipt(ctx, ca, sym, c.market_cap, ca)
  const caption = [
    cards.scanCard(c, row || null, null, ''),
    ...(extras.length ? ['', ...extras] : []),
    ...(caRead ? ['', `<blockquote>🧠 ${caRead}</blockquote>`] : []),
    ...(receipt ? ['', receipt] : []),
    '',
    `<code>${esc(ca)}</code>`,
    `<i>⌁ Spectre Intelligence · ${esc(top.chainId || '')} · CA scan</i>`,
  ].join('\n')
  const links = [{ label: 'AI Screener ↗', url: tradeTokenUrl(ca) }]
  if (top.url) links.push({ label: 'DexScreener ↗', url: top.url })
  const cgId = row?.token_id || row?.cg_id
  if (cgId) links.push({ label: '𝕏 X-Dash ↗', url: `${APP_URL}/x-dash/token/${encodeURIComponent(cgId)}?view=full` })
  const kbd = kb.scanKeyboard(sym, userTf(ctx.from.id), links.slice(0, 2))
  const banner = top.info?.header
  if (banner) {
    return ctx.replyWithPhoto(banner, { caption: caption.slice(0, 1024), parse_mode: 'HTML', reply_markup: kbd }).catch(() => ctx.reply(caption, { ...HTML, reply_markup: kbd }))
  }
  return ctx.reply(caption, { ...HTML, reply_markup: kbd })
}

async function sendKols(ctx, symbol) {
  const row = await api.socialRow(symbol).catch(() => null)
  return ctx.reply(cards.kolCard(symbol, row), HTML)
}

// ---------- commands

const START_TEXT = [
  '🜲 <b>Spectre AI Intelligence</b>',
  '<i>The market brain of app.spectreai.io — in your chat.</i>',
  '',
  '<b>Token</b>',
  '/price btc · /chart btc 4h · /scan sol — full read (price + 𝕏 + TA)',
  '/scan &lt;contract&gt; — scan ANY CA · /lore sym — the project story',
  '',
  '<b>Boards</b>',
  '/heatmap — market heatmap · /heatmap x — 𝕏 attention',
  '/bubbles — mover bubbles · /bubbles x — 𝕏 bubbles',
  '/top — gainers &amp; losers · /runners — low-cap runners',
  '/picks [eth|sol|base|robinhood] — 5 runner picks, 𝕏 × Codex × safety',
  '',
  '<b>Intelligence</b>',
  '/signals — detector + hunter feed · /receipts — our graded scoreboard',
  '/desk — Brain desk · /regime — market regime',
  '/xdash — 𝕏 attention board · /kol wif · /author handle — KOL dossier',
  '/gainers — momentum engine · /security pepe — rug check',
  '',
  '<b>Derivatives</b>',
  '/funding · /oi · /liqs · /lsr · /etf — ETF flows',
  '',
  '<b>Macro & more</b>',
  '/market · /feargreed · /thesis · /calendar · /stocks · /gas · /news · /hacks',
  '/yields — DeFi yields · /rwa — tokenized assets',
  '',
  '<b>Alerts — the point of all this</b>',
  '/subscribe — signal alerts in this chat (🚀 runners · 𝕏 social · 📊 data · ⚠️ risk)',
  '/connect @yourchannel — pipe alerts into your own channel',
  '/alert btc &gt;70k — price cross · <b>stocks too</b>: /alert nvda &gt;220 · /alert spx &gt;7600',
  '',
  '<b>Yours</b>',
  '/watchlist add btc · /settings — themes &amp; defaults',
  '',
  'Boards take options: <code>/heatmap x</code> = 𝕏 attention · <code>/bubbles 7d</code> = timeframe.',
  'Tip: send <code>$BTC</code> for an instant card. Reply <code>x</code> to any of my messages to delete it.',
].join('\n')

// photo captions cap at 1024 chars — welcome card gets the short version
const WELCOME_CAPTION = [
  '🜲 <b>Spectre AI Intelligence</b>',
  '<i>The market brain of app.spectreai.io — in your chat.</i>',
  '',
  '/scan sol — full token read · /chart btc 4h',
  '/heatmap · /bubbles · /runners · /gainers · /signals',
  '/funding · /etf · /liqs · /desk · /xdash · /security',
  '',
  '/help — everything else. Send <code>$BTC</code> anytime.',
].join('\n')

bot.command('start', (ctx) => {
  store.touchProfile(ctx.from.id, ctx.from)
  // deep link from a channel alert: t.me/bot?start=scan_SYM → run the scan
  const payload = (ctx.match || '').trim()
  if (/^scan_/i.test(payload)) return sendScan(ctx, payload.slice(5).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15))
  return sendWelcome(ctx)
})
bot.command('help', (ctx) => ctx.reply(START_TEXT, { ...HTML, reply_markup: kb.startKeyboard() }))
bot.command('myid', (ctx) => ctx.reply(`Your Telegram ID: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' }))

// ---------- admin (BOT_ADMIN_IDS only)

bot.command('users', (ctx) => {
  if (!guard.isAdmin(ctx.from.id)) return
  const granted = store.allUsers().filter((u) => u.access === true)
  const wl = waitlist.status()
  const wlLine = wl.enabled
    ? `Beta-waitlist sync: ON (${wl.handles} handles${wl.syncedAt ? `, synced ${wl.syncedAt.slice(11, 16)}Z` : ', first sync on next join'})`
    : `Beta-waitlist sync: OFF — ${esc(wl.reason)}`
  const lines = ['👥 <b>Access</b>', wlLine, '']
  if (granted.length) {
    lines.push('<b>Granted users</b>')
    for (const u of granted) lines.push(`• <code>${u.id}</code> ${esc(u.handle || '')} — since ${(u.firstSeen || '').slice(0, 10)}`)
  } else {
    lines.push('<i>No users granted yet (waitlist members join automatically).</i>')
  }
  lines.push('', `<i>/grant ID · /revoke ID · invite code: ${esc(BOT_INVITE_CODE)}</i>`)
  return ctx.reply(lines.join('\n'), HTML)
})

bot.command('grant', (ctx) => {
  if (!guard.isAdmin(ctx.from.id)) return
  const arg = String(ctx.match || '').trim()
  if (/^@?[a-zA-Z][a-zA-Z0-9_]{3,}$/.test(arg) && !/^\d+$/.test(arg)) {
    const n = store.addPendingGrant(arg)
    return ctx.reply(`✅ @${n} whitelisted — access activates the moment they message the bot (/start).`)
  }
  const id = parseInt(arg, 10)
  if (!id) return ctx.reply('Usage: /grant @handle — or /grant TELEGRAM_ID (they can get theirs with /myid)')
  store.setAccess(id, true)
  return ctx.reply(`✅ ${id} granted access.`)
})

bot.command('revoke', (ctx) => {
  if (!guard.isAdmin(ctx.from.id)) return
  const id = parseInt((ctx.match || '').trim(), 10)
  if (!id) return ctx.reply('Usage: /revoke TELEGRAM_ID')
  store.setAccess(id, false)
  return ctx.reply(`🚫 ${id} revoked.`)
})

bot.command(['price', 'p'], (ctx) => sendPriceCard(ctx, parseSymbol(ctx.match).symbol))
bot.command(['chart', 'c'], (ctx) => {
  const { symbol, rest } = parseSymbol(ctx.match)
  const tfArg = (rest[0] || '').toLowerCase()
  return sendChart(ctx, symbol, TIMEFRAMES[tfArg] ? tfArg : userTf(ctx.from.id))
})
bot.command(['scan', 'x'], (ctx) => {
  const raw = String(ctx.match || '').trim().split(/\s+/)[0] || ''
  if (api.isTokenAddress(raw)) return sendScanCa(ctx, raw)
  return sendScan(ctx, parseSymbol(ctx.match).symbol)
})
bot.command('kol', (ctx) => sendKols(ctx, parseSymbol(ctx.match).symbol))
bot.command(['market', 'm', 'macro'], async (ctx) => replyT(ctx, await cards.marketCard()))
// app-style dashboard card (founder ref shot 2026-07-17): /overview for the
// AI-analysis card, /overview morning|midday|evening for the scheduled looks,
// /overview auto on|off (admin) subscribes this chat to all three daily slots
// per-slot auto-schedule panel (founder: morning/midday/evening toggles,
// default all 3 on). Cards post daily at 07:00 / 12:00 / 18:00 UTC.
const OV_SLOTS = [['morning', '🌅 Morning', '07:00'], ['midday', '☀️ Midday', '12:00'], ['evening', '🌆 Evening', '18:00']]
function overviewScheduleText(chatId) {
  const cfg = store.overviewConfig(chatId)
  const anyOn = cfg.morning || cfg.midday || cfg.evening
  const lines = ['🗓 <b>Scheduled Market Overview</b>', anyOn ? '<i>Auto-posting the cards you’ve enabled below (UTC):</i>' : '<i>Tap a slot to start auto-posting the Market Overview card (UTC):</i>', '']
  for (const [k, label, time] of OV_SLOTS) lines.push(`${cfg[k] ? '✅' : '☐'} ${label} · ${time}`)
  return lines.join('\n')
}
function overviewScheduleKeyboard(chatId) {
  const cfg = store.overviewConfig(chatId)
  const kb = new InlineKeyboard()
  for (const [k, label] of OV_SLOTS) kb.text(`${cfg[k] ? '✅' : '☐'} ${label}`, `ov|${chatId}|${k}`)
  kb.row().text('🔕 All off', `ov|${chatId}|off`)
  return kb
}

bot.command(['overview', 'analysis'], async (ctx) => {
  const arg = String(ctx.match || '').trim().toLowerCase()
  if (arg.startsWith('auto') || arg === 'schedule') {
    if (ctx.chat.type !== 'private') {
      const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id).catch(() => null)
      const isAdm = (member && ['administrator', 'creator'].includes(member.status)) || guard.isAdmin(ctx.from.id)
      if (!isAdm) return
    }
    // shortcuts: "auto on" = all three, "auto off" = none
    if (/\bon\b/.test(arg)) store.setOverviewAuto(ctx.chat.id, true)
    else if (/\boff\b/.test(arg)) store.setOverviewAuto(ctx.chat.id, false)
    return ctx.reply(overviewScheduleText(ctx.chat.id), { ...HTML, reply_markup: overviewScheduleKeyboard(ctx.chat.id) })
  }
  const variant = ['morning', 'midday', 'evening'].includes(arg) ? arg : 'analysis'
  await ctx.replyWithChatAction('upload_photo').catch(() => {})
  try {
    const { png, caption } = await marketOverview.overviewCard(variant)
    return await ctx.replyWithPhoto(new InputFile(png, `overview-${variant}.png`), { caption, parse_mode: 'HTML' })
  } catch {
    return replyT(ctx, await cards.marketCard()) // data lane cold — degrade to the text card
  }
})
bot.command(['others', 'others2', 'total3'], async (ctx) => {
  try {
    const card = await marketOverview.othersCardImage()
    if (card) return await ctx.replyWithPhoto(new InputFile(card.png, 'others2.png'), { caption: card.caption, parse_mode: 'HTML' })
  } catch (e) { console.error('[others] render', e.message) }
  return ctx.reply(await marketOverview.othersCard(), HTML) // degrade to text if render/data cold
})
// GM cards — /gm morning · /gd afternoon · /gn evening (app's Good-morning screen)
async function sendGm(ctx, period) {
  await ctx.replyWithChatAction('upload_photo').catch(() => {})
  try {
    const { png, caption } = await gm.gmCard(period)
    return ctx.replyWithPhoto(new InputFile(png, `${period}.png`), { caption, parse_mode: 'HTML' })
  } catch {
    return ctx.reply('☀️ GM data is warming up — try again in a moment.')
  }
}
bot.command(['gm', 'goodmorning'], (ctx) => sendGm(ctx, 'gm'))
bot.command(['gd', 'gday', 'goodafternoon'], (ctx) => sendGm(ctx, 'gd'))
bot.command(['gn', 'goodnight', 'goodevening'], (ctx) => sendGm(ctx, 'gn'))
bot.command(['feargreed', 'fg', 'fear'], async (ctx) => {
  await ctx.replyWithChatAction('upload_photo').catch(() => {})
  const fgKbd = { inline_keyboard: [[{ text: '📊 Full Fear & Greed ↗', url: `${APP_URL}/fear-greed` }]] }
  try {
    // the app's own chart card, captured live (founder: the canvas re-render
    // "is ugly and text overlays" — ship real app pixels); canvas = fallback
    let png = await appShot.fearGreedShot().catch(() => null)
    if (!png) {
      const fg = await api.fearGreed()
      const cur = fg?.current
      if (!cur) throw new Error('no data')
      png = await fearGreedChart({ current: Number(cur.value), classification: cur.classification })
    }
    if (!png) throw new Error('render failed')
    const caption = await cards.fearGreedCard('caption')
    return await ctx.replyWithPhoto(new InputFile(png, 'fear-greed.png'), { caption: caption.slice(0, 1024), parse_mode: 'HTML', reply_markup: fgKbd })
  } catch {
    return ctx.reply(await cards.fearGreedCard(), { ...HTML, reply_markup: fgKbd })
  }
})

// translated reply for user-initiated commands — cached per content+lang
async function replyT(ctx, text, extra = {}) {
  const lang = store.chatLang(ctx.chat.id)
  const out = lang !== 'en' ? await i18n.translateCard(lang, text) : text
  return ctx.reply(out, { ...HTML, ...extra })
}

function langKeyboard() {
  const kbd = new (require('grammy').InlineKeyboard)()
  const entries = Object.entries(i18n.LANGS)
  entries.forEach(([code, label], i) => {
    kbd.text(label, `lg|${code}`)
    if (i % 3 === 2) kbd.row()
  })
  return kbd
}

bot.command(['language', 'lang'], async (ctx) => {
  if (ctx.chat.type !== 'private') {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id).catch(() => null)
    const isAdm = (member && ['administrator', 'creator'].includes(member.status)) || guard.isAdmin(ctx.from.id)
    if (!isAdm) return
  }
  return ctx.reply(i18n.t(store.chatLang(ctx.chat.id), 'lang.pick'), { ...HTML, reply_markup: langKeyboard() })
})

// group call ledger — the group's own graded scoreboard
bot.command(['calls', 'ledger'], async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('Run /calls in a group — it is the group call ledger.', HTML)
  const rows = store.chatCalls(ctx.chat.id)
  if (!rows.length) return ctx.reply('📒 No calls on the book yet — /scan a token or paste a CA to open it.', HTML)
  // refresh live caps for CA-backed calls (bounded)
  for (const r of rows.filter((x) => x.ca).slice(0, 8)) {
    const d = await subs.dexEnrich(r.ca).catch(() => null)
    if (d?.mcap) store.recordCall(ctx.chat.id, r.key, { mcap: d.mcap, ts: Date.now() })
  }
  const fresh = store.chatCalls(ctx.chat.id)
  const scored = fresh
    .map((r) => ({ ...r, x: r.mcap > 0 && r.peakMcap > 0 ? r.peakMcap / r.mcap : 1 }))
    .sort((a, b) => b.x - a.x)
    .slice(0, 10)
  const lines = ['🏆 <b>GROUP CALL LEDGER</b>', '<i>first caller · entry → peak, graded vs live caps</i>', '']
  scored.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ` ${i + 1}.`
    lines.push(`${medal} <b>$${esc(r.symbol)}</b> — ${esc(r.caller?.name || '?')} @ ${usd(r.mcap)} → peak ${usd(r.peakMcap)} (<b>${r.x >= 10 ? r.x.toFixed(0) : r.x.toFixed(1)}×</b>)`)
  })
  lines.push('', '<i>⌁ Spectre Intelligence · every scan is a call</i>')
  return ctx.reply(lines.join('\n'), HTML)
})
bot.command('thesis', async (ctx) => replyT(ctx, await cards.thesisCard()))
// /lore — the Brain tells a project's story (origin, team, narrative, perception)
bot.command('lore', async (ctx) => {
  const { symbol } = parseSymbol(ctx.match, '')
  if (!symbol) return ctx.reply('Usage: <code>/lore sym</code> — e.g. /lore spectre', HTML)
  await ctx.replyWithChatAction('typing').catch(() => {})
  const card = await cards.loreCard(symbol).catch(() => null)
  if (!card) return ctx.reply('🧠 The Brain is mid-thought — try /lore again in a minute.', HTML)
  return ctx.reply(card, HTML)
})
bot.command('news', async (ctx) => replyT(ctx, await cards.newsCard()))
bot.command('desk', async (ctx) => replyT(ctx, await cards.deskCard()))
bot.command(['xdash', 'xd'], async (ctx) => ctx.reply(await cards.xdashCard(), HTML))
bot.command(['alert', 'alerts'], handleAlertCommand)

// ---------- boards (heatmaps / bubbles / lists)

const BOARD_TFS = ['1h', '24h', '7d']

async function sendBoard(ctx, kind, variant, tf = '24h', edit = false) {
  if (!edit) await ctx.replyWithChatAction('upload_photo').catch(() => {})
  const theme = userTheme(ctx.from.id)
  const build =
    kind === 'hm' ? (variant === 'x' ? boards.xHeatmap : boards.marketHeatmap) : variant === 'x' ? boards.xBubbles : boards.marketBubbles
  const res = await build(theme, tf)
  if (!res) {
    if (!edit) await ctx.reply('Board data is warming up — try again shortly.')
    return
  }
  const markup = kb.boardKeyboard(kind, variant, tf)
  const media = new InputFile(res.png, `${kind}-${variant}-${tf}.png`)
  if (edit) {
    await ctx
      .editMessageMedia({ type: 'photo', media, caption: res.caption, parse_mode: 'HTML' }, { reply_markup: markup })
      .catch((err) => {
        if (!/not modified/i.test(String(err))) throw err
      })
  } else {
    await ctx.replyWithPhoto(media, { caption: res.caption, parse_mode: 'HTML', reply_markup: markup })
  }
}

function parseBoardArgs(match) {
  const args = (match || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  return {
    variant: args.includes('x') ? 'x' : 'm',
    tf: args.find((a) => BOARD_TFS.includes(a)) || '24h',
  }
}

// market heatmap/bubbles ship the LIVE app page pixels (app.spectreai.io) —
// the same treatment as /feargreed; every view the app has is reachable by a
// keyword. The X-Dash social variant + canvas render stay as the fallback.
// Founder 07-16: "same we have with heatmaps and bubbles… more heatmap views
// and cosmos in bubbles, do all".
const HM_VIEWS = {
  treemap: { label: '🗺 MARKET HEATMAP · Treemap', blurb: 'Every major sized by cap, colored by 24h move' },
  bars: { label: '📊 MARKET HEATMAP · Bars', blurb: 'Ranked bars — the day’s moves at a glance' },
  dual: { label: '⚖️ MARKET HEATMAP · Gainers vs Losers', blurb: 'Top runners against the biggest bleeders, side by side' },
}
const BB_VIEWS = {
  bubbles: { label: '🫧 MARKET BUBBLES', blurb: 'The market as a living field — size = cap, color = 24h' },
  cosmos: { label: '🌌 SPECTRE COSMOS', blurb: 'The market as a solar system — BTC the sun, tokens in orbit' },
}
function parseVizView(match, views, fallback) {
  const args = (match || '').trim().toLowerCase().split(/\s+/)
  return Object.keys(views).find((v) => args.includes(v)) || fallback
}
async function sendAppViz(ctx, kind, forcedView = null) {
  const { variant, tf } = parseBoardArgs(ctx.match)
  if (variant !== 'x') {
    await ctx.replyWithChatAction('upload_photo').catch(() => {})
    const isHm = kind === 'hm'
    const views = isHm ? HM_VIEWS : BB_VIEWS
    const view = forcedView || parseVizView(ctx.match, views, isHm ? 'treemap' : 'bubbles')
    const shot = (isHm ? appShot.HEATMAP_SHOTS : appShot.BUBBLE_SHOTS)[view]
    const png = await shot().catch(() => null)
    if (png) {
      const v = views[view]
      const path = isHm ? 'heatmaps' : 'bubbles'
      const other = Object.keys(views).filter((k) => k !== view)
      const hint = other.length ? `\n<i>More views: ${other.map((o) => `/${isHm ? 'heatmap' : 'bubbles'} ${o}`).join(' · ')}</i>` : ''
      const caption = `<b>${v.label}</b>\n<i>${v.blurb}. Live from app.spectreai.io.</i>${hint}\n\n<i>⌁ Spectre Intelligence</i>`
      return ctx.replyWithPhoto(new InputFile(png, `${kind}-${view}.png`), {
        caption,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: `${isHm ? '🗺 Full Heatmap' : '🫧 Full Bubbles'} ↗`, url: `${APP_URL}/${path}` }]] },
      })
    }
  }
  return sendBoard(ctx, kind, variant, tf)
}
bot.command(['heatmap', 'hm'], (ctx) => sendAppViz(ctx, 'hm'))
bot.command(['bubbles', 'bb'], (ctx) => sendAppViz(ctx, 'bb'))
bot.command(['cosmos', 'universe'], (ctx) => sendAppViz(ctx, 'bb', 'cosmos'))
bot.command('runners', async (ctx) => ctx.reply(await boards.runnersCard(), HTML))
bot.command('receipts', async (ctx) => ctx.reply(require('./grader').receiptsCard(), HTML))
bot.command('picks', async (ctx) => {
  const arg = (ctx.match || '').trim().toLowerCase().split(/\s+/)[0] || null
  const waiting = await ctx.reply('🍳 Cooking picks — 𝕏 X-Dash × Codex onchain × safety…')
  const data = await runnerEngine.picks(arg)
  return ctx.api
    .editMessageText(ctx.chat.id, waiting.message_id, runnerEngine.picksCard(data), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    })
    .catch(() => {})
})
bot.command('signals', async (ctx) => ctx.reply(await boards.signalsCard(), HTML))
bot.command('top', async (ctx) => ctx.reply(await boards.topCard(), HTML))

// ---------- utilities (derivatives · macro · research)

const UTIL_COMMANDS = {
  funding: utils.fundingCard,
  oi: utils.oiCard,
  liqs: utils.liqsCard,
  lsr: utils.lsrCard,
  etf: utils.etfCard,
  gas: utils.gasCard,
  hacks: utils.hacksCard,
  calendar: utils.calendarCard,
  gainers: utils.gainersCard,
  yields: utils.yieldsCard,
  rwa: utils.rwaCard,
  regime: utils.regimeCard,
  whales: utils.whalesCard,
  options: utils.optionsCard,
  paper: utils.paperCard,
  stables: utils.stablesCard,
  clusters: utils.clustersCard,
  smart: utils.smartMoneyCard,
  rotation: utils.rotationCard,
  world: utils.worldCard,
  brief: utils.briefCard,
}

// /stocks = majors board · /stocks nvidia = that stock's card + chart
async function sendStockCard(ctx, query, tfKey = stocks.DEFAULT_STOCK_TF, edit = false) {
  const q = await stocks.resolveStock(query)
  if (!q) return ctx.reply(`Couldn't find a US stock or index matching <b>${esc(query)}</b>.`, HTML)
  if (!edit) await ctx.replyWithChatAction('upload_photo').catch(() => {})
  const png = await stocks.stockChartPng({ symbol: q.symbol, tfKey, themeName: userTheme(ctx.from.id), change24h: q.change24 })
  const caption = stocks.stockCaption(q, tfKey)
  const markup = stocks.stockKeyboard(q.symbol, tfKey)
  if (!png) return ctx.reply(caption + '\n<i>Chart unavailable right now.</i>', { ...HTML, reply_markup: markup })
  const media = new InputFile(png, `${q.symbol}-${tfKey}.png`)
  if (edit) {
    return ctx
      .editMessageMedia({ type: 'photo', media, caption, parse_mode: 'HTML' }, { reply_markup: markup })
      .catch((err) => {
        if (!/not modified/i.test(String(err))) throw err
      })
  }
  return ctx.replyWithPhoto(media, { caption, parse_mode: 'HTML', reply_markup: markup })
}

// /buybot — self-serve buy alerts for any EVM token. Group admins (or bot
// admins) configure per chat; the panel owns min-buy / pause / test / remove.
bot.command('buybot', async (ctx) => {
  const chat = ctx.chat
  if (chat.type !== 'private') {
    const member = await ctx.api.getChatMember(chat.id, ctx.from.id).catch(() => null)
    const isAdm = (member && ['administrator', 'creator'].includes(member.status)) || guard.isAdmin(ctx.from.id)
    if (!isAdm) return ctx.reply('Only group admins can configure the buy bot here.')
  }
  const arg = String(ctx.match || '').trim()
  if (arg) {
    const res = await buybot.setup(chat.id, arg, ctx.from.id)
    if (res.error) return ctx.reply(res.error, HTML)
    return ctx.reply(buybot.panelText(res.cfg), { ...HTML, reply_markup: buybot.panelKeyboard(chat.id, res.cfg) })
  }
  const cfg = store.buybot(chat.id)
  if (cfg?.ca) return ctx.reply(buybot.panelText(cfg), { ...HTML, reply_markup: buybot.panelKeyboard(chat.id, cfg) })
  return ctx.reply(
    [
      '🟢 <b>Buy Bot</b>',
      'Every on-chain buy of your token lands here: animated card, buyer, New Holder / Position read, whale alerts, live price + MC (multichain). Free for any community.',
      '',
      'Set up: <code>/buybot 0x…contract</code>',
      'Then tune it all from the panel: min buy · whale threshold · emoji + $-per-emoji scale · your own GIF · extra chains.',
      '',
      '<i>Buy detection: ETH · Base · BSC · Arbitrum · Polygon · Optimism (any chain shows price/MC). Powered by Spectre AI — app.spectreai.io</i>',
    ].join('\n'),
    HTML,
  )
})

bot.command('stocks', async (ctx) => {
  const arg = (ctx.match || '').trim()
  if (!arg) return ctx.reply(await utils.stocksCard(), HTML)
  return sendStockCard(ctx, arg)
})
for (const [cmd, fn] of Object.entries(UTIL_COMMANDS)) {
  bot.command(cmd, async (ctx) => ctx.reply(await fn(), HTML))
}
bot.command(['calendar', 'cal'], async (ctx) =>
  ctx.reply(await utils.calendarCard(), {
    ...HTML,
    reply_markup: { inline_keyboard: [[{ text: '📅 Full Economic Calendar ↗', url: `${APP_URL}/economic-calendar` }]] },
  }))
bot.command('author', async (ctx) => ctx.reply(await utils.authorCard((ctx.match || '').trim()), HTML))
bot.command(['security', 'rug'], async (ctx) => ctx.reply(await utils.securityCard((ctx.match || '').trim()), HTML))
bot.command(['hl', 'hyper', 'perp'], async (ctx) => ctx.reply(await utils.hyperliquidCard(ctx.match), HTML))
bot.command(['chatter', 'sentiment'], async (ctx) => ctx.reply(await utils.chatterCard(ctx.match), HTML))
bot.command(['origin', 'spotted'], async (ctx) => ctx.reply(await utils.originCard(ctx.match), HTML))
bot.command(['compare', 'vs'], async (ctx) => ctx.reply(await utils.compareCard(ctx.match), HTML))
bot.command(['convert', 'conv'], async (ctx) => ctx.reply(await utils.convertCard(ctx.match), HTML))
bot.command('ath', async (ctx) => ctx.reply(await utils.athCard(ctx.match), HTML))
bot.command('supply', async (ctx) => ctx.reply(await utils.supplyCard(ctx.match), HTML))
bot.command(['dom', 'dominance'], async (ctx) => ctx.reply(await utils.dominanceCard(), HTML))
bot.command('roi', async (ctx) => ctx.reply(await utils.roiCard(ctx.match), HTML))
bot.command(['callers', 'topcallers'], async (ctx) => {
  if (ctx.chat?.type === 'private') return ctx.reply('🏆 The caller leaderboard lives in groups — every /scan there is a logged call.', HTML)
  return ctx.reply(utils.callersCard(store.chatCalls(ctx.chat.id)), HTML)
})
bot.command(['portfolio', 'pf', 'bags'], async (ctx) => {
  const args = (ctx.match || '').trim().split(/\s+/).filter(Boolean)
  const uid = ctx.from.id
  if (args[0] === 'add' && args[1]) {
    const sym = args[1].replace(/^\$/, '').toUpperCase()
    const qty = parseFloat(args[2])
    if (!isFinite(qty)) return ctx.reply('Usage: <code>/portfolio add SOL 10 120</code> — symbol, qty, entry (entry optional).', HTML)
    store.setHolding(uid, sym, qty, args[3] != null ? parseFloat(args[3]) : null)
    return ctx.reply(`💼 Added <b>${qty} ${esc(sym)}</b>${args[3] ? ` @ ${esc(args[3])}` : ''} to your portfolio.`, HTML)
  }
  if ((args[0] === 'remove' || args[0] === 'rm') && args[1]) {
    const ok = store.rmHolding(uid, args[1].replace(/^\$/, ''))
    return ctx.reply(ok ? `Removed <b>${esc(args[1].toUpperCase())}</b>.` : 'Not in your portfolio.', HTML)
  }
  return ctx.reply(await utils.portfolioCard(store.holdings(uid)), HTML)
})

// ---------- signal subscriptions (DM / group / channel alerts)

bot.command(['subscribe', 'sub'], async (ctx) => {
  const chat = ctx.chat
  if (chat.type !== 'private') {
    const member = await ctx.api.getChatMember(chat.id, ctx.from.id).catch(() => null)
    if (!member || !['administrator', 'creator'].includes(member.status)) {
      return ctx.reply('Only group admins can manage Spectre alerts here.')
    }
  }
  if (!store.sub(chat.id)) {
    store.upsertSub(chat.id, { title: chat.title || 'DM', type: chat.type, owner: ctx.from.id })
  }
  return ctx.reply(subs.subText(chat), { ...HTML, reply_markup: subs.subKeyboard(chat.id) })
})

bot.command('connect', async (ctx) => {
  if (ctx.chat.type !== 'private') return ctx.reply('Run /connect in a DM with me.')
  const arg = (ctx.match || '').trim()
  if (!arg) {
    return ctx.reply(
      '📡 <b>Connect a channel</b>\n\n1. Add me as an <b>admin</b> of your channel (Post messages right)\n2. Run <code>/connect @yourchannel</code> here\n\nAlerts you pick will post straight into the channel.',
      { parse_mode: 'HTML' },
    )
  }
  const target = /^-?\d+$/.test(arg) ? Number(arg) : arg.startsWith('@') ? arg : '@' + arg
  const chat = await ctx.api.getChat(target).catch(() => null)
  if (!chat) return ctx.reply("Can't see that channel — add me as an admin there first, then retry.")
  const test = await ctx.api
    .sendMessage(chat.id, '✅ <b>Spectre AI Intelligence connected</b> — signal alerts will land here.', { parse_mode: 'HTML' })
    .catch(() => null)
  if (!test) return ctx.reply("Found the channel but can't post — give me the 'Post messages' admin right and retry.")
  store.upsertSub(chat.id, { title: chat.title || String(chat.id), type: chat.type, owner: ctx.from.id })
  return ctx.reply(`Connected <b>${esc(chat.title || arg)}</b>. Pick its alerts:`, {
    ...HTML,
    reply_markup: subs.subKeyboard(chat.id),
  })
})

bot.command('channels', async (ctx) => {
  if (ctx.chat.type !== 'private') return
  const mine = store.allSubs().filter((s) => s.owner === ctx.from.id && String(s.chatId) !== String(ctx.chat.id))
  if (!mine.length) {
    return ctx.reply('No channels or groups connected yet.\n<code>/connect @yourchannel</code> after adding me as admin.', { parse_mode: 'HTML' })
  }
  for (const s of mine) {
    await ctx.reply(`⚙️ <b>${esc(s.title || s.chatId)}</b>`, { ...HTML, reply_markup: subs.subKeyboard(s.chatId) })
  }
})

bot.command(['watchlist', 'wl'], async (ctx) => {
  const args = (ctx.match || '').trim().split(/\s+/).filter(Boolean)
  const uid = ctx.from.id
  if (args[0] === 'add' && args[1]) {
    const added = args.slice(1).filter((s) => store.addWatch(uid, s.replace(/^\$/, '')))
    return ctx.reply(added.length ? `⭐ Added ${added.map((s) => s.toUpperCase()).join(', ')}` : 'Already on your list.')
  }
  if ((args[0] === 'rm' || args[0] === 'remove') && args[1]) {
    const ok = store.rmWatch(uid, args[1].replace(/^\$/, ''))
    return ctx.reply(ok ? 'Removed.' : 'Not on your list.')
  }
  const list = store.user(uid).watchlist
  if (!list.length) return ctx.reply('Watchlist empty. <code>/watchlist add btc eth sol</code>', { parse_mode: 'HTML' })
  const data = await api.prices(list).catch(() => null)
  const lines = ['⭐ <b>Watchlist</b>', '']
  for (const s of list) {
    const r = data?.[s]
    lines.push(r ? `<b>${esc(s)}</b> ${price(r.price)} ${move(r.change?.['24h'])}` : `<b>${esc(s)}</b> —`)
  }
  lines.push('', '<i>/watchlist add SYM · /watchlist rm SYM</i>')
  return ctx.reply(lines.join('\n'), HTML)
})

bot.command(['settings', 'theme'], (ctx) => {
  const u = store.user(ctx.from.id)
  return ctx.reply(
    `⚙️ <b>Settings</b>\nTheme: <b>${esc(THEMES[u.prefs.theme]?.label || u.prefs.theme)}</b> · Default TF: <b>${esc(u.prefs.tf)}</b>`,
    { ...HTML, reply_markup: kb.settingsKeyboard(u.prefs) },
  )
})

// ---------- callback queries (inline keyboard taps)

bot.on('callback_query:data', async (ctx) => {
  const [verb, a, b] = ctx.callbackQuery.data.split('|')
  try {
    if (verb === 'c') {
      // TF switch: re-render and swap the photo in place
      await ctx.answerCallbackQuery({ text: `Rendering ${TIMEFRAMES[b]?.label || b}…` })
      const c = await cards.coin(a).catch(() => null)
      const { png, usedTf, fellBack } = await chartPng({
        symbol: a,
        tfKey: b,
        themeName: userTheme(ctx.from.id),
        change24h: c?.change?.['24h'],
      })
      if (!png) return
      let caption = `<b>${esc(a)}/USD</b> · ${TIMEFRAMES[usedTf].label}`
      if (c) caption += ` — ${price(c.price)} ${move(c.change?.['24h'])} 24h`
      if (fellBack) caption += `\n<i>${TIMEFRAMES[b].label} lane cold — showing ${TIMEFRAMES[usedTf].label}</i>`
      await ctx
        .editMessageMedia(
          { type: 'photo', media: new InputFile(png, `${a}-${usedTf}.png`), caption, parse_mode: 'HTML' },
          { reply_markup: kb.tfKeyboard(a, usedTf, await tokenLink(a)) },
        )
        .catch((err) => {
          if (!/not modified/i.test(String(err))) throw err
        })
    } else if (verb === 'x') {
      await ctx.answerCallbackQuery()
      await sendScan(ctx, a, b && TIMEFRAMES[b] ? b : undefined)
    } else if (verb === 'k') {
      await ctx.answerCallbackQuery()
      await sendKols(ctx, a)
    } else if (verb === 'wl' && a === 'a') {
      const added = store.addWatch(ctx.from.id, b)
      await ctx.answerCallbackQuery({ text: added ? `⭐ ${b} added to watchlist` : `${b} already on watchlist` })
    } else if (verb === 'st') {
      if (a === 't' && THEMES[b]) store.setPref(ctx.from.id, 'theme', b)
      if (a === 'f' && TIMEFRAMES[b]) store.setPref(ctx.from.id, 'tf', b)
      const u = store.user(ctx.from.id)
      await ctx.answerCallbackQuery({ text: 'Saved' })
      await ctx
        .editMessageText(
          `⚙️ <b>Settings</b>\nTheme: <b>${esc(THEMES[u.prefs.theme]?.label || u.prefs.theme)}</b> · Default TF: <b>${esc(u.prefs.tf)}</b>`,
          { parse_mode: 'HTML', reply_markup: kb.settingsKeyboard(u.prefs) },
        )
        .catch(() => {})
    } else if (verb === 'hm' || verb === 'bb') {
      // board toggle: swap the image in place (a = variant, b = timeframe)
      await ctx.answerCallbackQuery({ text: 'Rendering…' })
      await sendBoard(ctx, verb, a === 'x' ? 'x' : 'm', BOARD_TFS.includes(b) ? b : '24h', true)
    } else if (verb === 'lg') {
      if (ctx.chat.type !== 'private') {
        const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id).catch(() => null)
        const isAdm = (member && ['administrator', 'creator'].includes(member.status)) || guard.isAdmin(ctx.from.id)
        if (!isAdm) return ctx.answerCallbackQuery({ text: 'Admins only.' })
      }
      const code = i18n.LANGS[a] ? a : 'en'
      store.setChatLang(ctx.chat.id, code)
      await ctx.answerCallbackQuery({ text: i18n.LANGS[code] })
      if (code !== 'en') {
        const pack = await i18n.ensureLang(code) // builds once, cached forever
        if (!pack) await ctx.reply(i18n.t('en', 'lang.building', { lang: i18n.LANGS[code] })).catch(() => {})
      }
      await ctx.editMessageText(i18n.t(code, 'lang.set', { lang: i18n.LANGS[code] }), { parse_mode: 'HTML' }).catch(() => {})
    } else if (verb === 'by') {
      // buy bot panel: a = chat id, b = action
      const target = a
      const cfg = store.buybot(target)
      if (!cfg) return ctx.answerCallbackQuery({ text: 'No buy bot configured here.' })
      const sameChat = String(ctx.chat?.id) === String(target)
      let allowed = guard.isAdmin(ctx.from.id) || cfg.addedBy === ctx.from.id || (sameChat && ctx.chat.type === 'private')
      if (!allowed && sameChat) {
        const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id).catch(() => null)
        allowed = member && ['administrator', 'creator'].includes(member.status)
      }
      if (!allowed) return ctx.answerCallbackQuery({ text: 'Only admins can change this.' })
      if (b === 'min') {
        const next = buybot.cycleMin(target)
        await ctx.answerCallbackQuery({ text: `Min buy $${next}` })
      } else if (b === 'whale') {
        const next = buybot.cycleWhale(target)
        await ctx.answerCallbackQuery({ text: next > 0 ? `Whale alert: wallet ≥ $${next.toLocaleString('en-US')}` : 'Whale alert off' })
      } else if (b === 'step') {
        const next = buybot.cycleStep(target)
        await ctx.answerCallbackQuery({ text: `1 emoji per $${next} bought` })
      } else if (b === 'emoji') {
        buybot.setPending(target, ctx.from.id, 'emoji')
        await ctx.answerCallbackQuery({ text: 'Send the emoji now' })
        await ctx.reply('<b>Reply to this message</b> with the emoji for buy rows — or <code>default</code> for size tiers (🟢/🔥).', { parse_mode: 'HTML' }).catch(() => {})
      } else if (b === 'lang') {
        await ctx.answerCallbackQuery()
        await ctx.reply(i18n.t(store.chatLang(target), 'lang.pick'), { parse_mode: 'HTML', reply_markup: langKeyboard() }).catch(() => {})
      } else if (b === 'leg') {
        buybot.setPending(target, ctx.from.id, 'leg')
        await ctx.answerCallbackQuery({ text: 'Send the contract now' })
        await ctx.reply('<b>Reply to this message</b> with the OTHER chain\'s contract address (EVM 0x… or Solana) — or <code>default</code> to clear extra chains.', { parse_mode: 'HTML' }).catch(() => {})
      } else if (b === 'media') {
        buybot.setPending(target, ctx.from.id, 'media')
        await ctx.answerCallbackQuery({ text: 'Send a GIF now' })
        await ctx.reply('<b>Reply to this message</b> with the GIF / video / image for your buy cards — or <code>default</code> for the Spectre animation.', { parse_mode: 'HTML' }).catch(() => {})
      } else if (b === 'toggle') {
        const next = !(cfg.enabled !== false)
        store.upsertBuybot(target, { enabled: next })
        await ctx.answerCallbackQuery({ text: next ? 'Watching buys' : 'Paused' })
      } else if (b === 'test') {
        await ctx.answerCallbackQuery({ text: 'Posting test…' })
        const ok = await buybot.testPost(bot, target).catch(() => false)
        if (!ok) await ctx.reply('Test failed — token may have no live pool right now.').catch(() => {})
      } else if (b === 'rm') {
        store.removeBuybot(target)
        await ctx.answerCallbackQuery({ text: 'Removed' })
        await ctx.editMessageText('🗑 Buy bot removed from this chat. /buybot to set up again.').catch(() => {})
        return
      }
      const fresh = store.buybot(target)
      if (fresh) {
        await ctx.editMessageText(buybot.panelText(fresh), { parse_mode: 'HTML', reply_markup: buybot.panelKeyboard(target, fresh) }).catch(() => {})
      }
    } else if (verb === 'ov') {
      // overview schedule toggle: a = chat id, b = slot | 'off'
      const targetChat = a
      const sameChat = String(ctx.chat?.id) === String(targetChat)
      let allowed = guard.isAdmin(ctx.from.id) || (sameChat && ctx.chat.type === 'private')
      if (!allowed && sameChat) {
        const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id).catch(() => null)
        allowed = member && ['administrator', 'creator'].includes(member.status)
      }
      if (!allowed) return ctx.answerCallbackQuery({ text: 'Only admins can change this.' })
      if (b === 'off') {
        store.setOverviewAuto(targetChat, false)
        await ctx.answerCallbackQuery({ text: 'All daily cards off' })
      } else {
        store.toggleOverviewSlot(targetChat, b)
        await ctx.answerCallbackQuery({ text: 'Saved' })
      }
      await ctx.editMessageText(overviewScheduleText(targetChat), { parse_mode: 'HTML', reply_markup: overviewScheduleKeyboard(targetChat) }).catch(() => {})
    } else if (verb === 'sb') {
      // subscription toggle: a = target chat id, b = category | 'off'
      const targetChat = a
      const s = store.sub(targetChat)
      const sameChat = String(ctx.chat?.id) === String(targetChat)
      let allowed = guard.isAdmin(ctx.from.id) || s?.owner === ctx.from.id || (sameChat && ctx.chat.type === 'private')
      if (!allowed && sameChat) {
        const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id).catch(() => null)
        allowed = member && ['administrator', 'creator'].includes(member.status)
      }
      if (!allowed) return ctx.answerCallbackQuery({ text: 'Only the owner or admins can change this.' })
      if (b === 'off') {
        store.removeSub(targetChat)
        await ctx.answerCallbackQuery({ text: 'Unsubscribed' })
        await ctx.editMessageText('🔕 Unsubscribed. /subscribe anytime to turn alerts back on.').catch(() => {})
        return
      }
      if (!s) store.upsertSub(targetChat, { owner: ctx.from.id, type: sameChat ? ctx.chat.type : 'channel', title: ctx.chat?.title || 'DM' })
      if (b === 'freq') {
        const next = subs.cycleFreq(targetChat)
        await ctx.answerCallbackQuery({ text: `Max ${next === 0 ? 'unlimited' : next + '/hr'}` })
      } else if (b === 'view') {
        const next = store.sub(targetChat)?.view === 'compact' ? 'card' : 'compact'
        store.upsertSub(targetChat, { view: next })
        await ctx.answerCallbackQuery({ text: next === 'compact' ? '✍️ One-liner alerts' : '🖼 Full photo cards' })
      } else {
        store.toggleSubCat(targetChat, b)
        await ctx.answerCallbackQuery({ text: 'Saved' })
      }
      await ctx.editMessageReplyMarkup({ reply_markup: subs.subKeyboard(targetChat) }).catch(() => {})
    } else if (verb === 'sc') {
      // stock chart TF switch (a = symbol, b = tf)
      await ctx.answerCallbackQuery({ text: 'Rendering…' })
      await sendStockCard(ctx, a, stocks.STOCK_TFS[b] ? b : stocks.DEFAULT_STOCK_TF, true)
    } else if (verb === 'sa') {
      // one-tap stock alert at ±5% of live price (a = symbol, b = 'u'|'d')
      const q = await api.stockQuote(a, { ttlMs: 1 }).catch(() => null)
      if (!q) return ctx.answerCallbackQuery({ text: 'Quote unavailable — try again.' })
      const up = b === 'u'
      const target = Math.round(q.price * (up ? 1.05 : 0.95) * 100) / 100
      const alert = store.addAlert(ctx.from.id, q.symbol, up ? '>' : '<', target)
      const u = store.user(ctx.from.id)
      u.alerts[u.alerts.length - 1].kind = 'stock'
      await ctx.answerCallbackQuery({ text: `🔔 ${q.symbol} ${up ? '>' : '<'} $${target} set (#${alert.id})`, show_alert: false })
    } else if (verb === 'go') {
      await ctx.answerCallbackQuery()
      if (a === 'm') await ctx.reply(await cards.marketCard(), HTML)
      if (a === 'desk') await ctx.reply(await cards.deskCard(), HTML)
      if (a === 'xd') await ctx.reply(await cards.xdashCard(), HTML)
      if (a === 'sig') await ctx.reply(await boards.signalsCard(), HTML)
      if (a === 'hm') await sendBoard(ctx, 'hm', 'm', '24h')
      if (a === 'bb') await sendBoard(ctx, 'bb', 'm', '24h')
    }
  } catch (err) {
    console.error('[callback]', ctx.callbackQuery.data, err.message)
    await ctx.answerCallbackQuery({ text: 'Something hiccuped — try again.' }).catch(() => {})
  }
})

// ---------- message listeners

// $SYM anywhere → instant price card (DMs always; groups only for $CASHTAG-only messages)
bot.hears(/^\$([a-zA-Z0-9]{2,12})$/, (ctx) => sendPriceCard(ctx, ctx.match[1].toUpperCase()))

// Reply "x" to any bot message deletes it (Rick-style chat hygiene)
bot.hears(/^x$/i, async (ctx) => {
  const target = ctx.msg.reply_to_message
  if (!target || target.from?.id !== ctx.me.id) return
  await ctx.api.deleteMessage(ctx.chat.id, target.message_id).catch(() => {})
  await ctx.api.deleteMessage(ctx.chat.id, ctx.msg.message_id).catch(() => {})
})

bot.catch((err) => console.error('[bot]', err.error?.message || err.message))

async function main() {
  await bot.api.setMyCommands([
    { command: 'subscribe', description: '🔔 Signal alerts here — runners, social, data' },
    { command: 'connect', description: 'Pipe alerts into your channel' },
    { command: 'price', description: 'Price card — /price btc' },
    { command: 'chart', description: 'Pro chart — /chart btc 4h' },
    { command: 'scan', description: 'Full Spectre scan — /scan sol' },
    { command: 'heatmap', description: 'Market heatmap · add "x" for 𝕏 attention' },
    { command: 'bubbles', description: 'Bubble map · add "x" for 𝕏 bubbles' },
    { command: 'runners', description: 'Low-cap runners with 𝕏 backing' },
    { command: 'picks', description: '🍳 5 runner picks — /picks robinhood' },
    { command: 'signals', description: 'Live Spectre signal feed' },
    { command: 'receipts', description: '🧾 Alert scoreboard — we grade ourselves' },
    { command: 'top', description: 'Top gainers & losers' },
    { command: 'overview', description: '📊 Market Overview card · morning/midday/evening' },
    { command: 'gm', description: '🌅 Good morning — crypto · stocks · news' },
    { command: 'gn', description: '🌙 Good evening — crypto · stocks · news' },
    { command: 'others', description: '📊 OTHERS2 — the alt long tail (ex-top 100)' },
    { command: 'cosmos', description: '🌌 The market as a solar system (live)' },
    { command: 'xdash', description: 'X-Dash attention leaderboard' },
    { command: 'desk', description: 'Spectre Brain desk read' },
    { command: 'paper', description: '🧾 Paper book — the desk trades its calls' },
    { command: 'whales', description: '🐋 Large on-chain transfers + flow read' },
    { command: 'hl', description: 'Hyperliquid perp — /hl sol' },
    { command: 'options', description: '📐 BTC/ETH options — put/call, max pain' },
    { command: 'clusters', description: '𝕏 Which KOL clusters drive what' },
    { command: 'stables', description: '💵 Stablecoin supply — dry powder' },
    { command: 'smart', description: '💼 Smart-money netflow (flow × attention)' },
    { command: 'rotation', description: '🧭 Where money is rotating' },
    { command: 'dominance', description: 'BTC dominance + alt-season read' },
    { command: 'compare', description: 'Head to head — /compare btc eth' },
    { command: 'chatter', description: '𝕏 Crowd sentiment — /chatter wif' },
    { command: 'origin', description: '📡 When Spectre spotted it — /origin wif' },
    { command: 'ath', description: 'Distance from all-time high — /ath sol' },
    { command: 'supply', description: 'Supply & dilution — /supply arb' },
    { command: 'convert', description: 'Convert — /convert 0.5 eth' },
    { command: 'roi', description: 'Position P&L — /roi sol 120' },
    { command: 'portfolio', description: '💼 Track your bags — /portfolio add sol 10 120' },
    { command: 'brief', description: '🗞 The market in one card' },
    { command: 'world', description: '🌍 Macro & rate odds' },
    { command: 'callers', description: '🏆 Top callers (in groups)' },
    { command: 'kol', description: "Who's talking — /kol wif" },
    { command: 'market', description: 'Market overview' },
    { command: 'overview', description: '🖼 Market dashboard card — /overview morning' },
    { command: 'news', description: 'Latest headlines' },
    { command: 'watchlist', description: 'Your watchlist' },
    { command: 'alert', description: 'Price alert — /alert btc >70k' },
    { command: 'gainers', description: 'Potential gainers — momentum engine' },
    { command: 'funding', description: 'Funding rates — longs vs shorts' },
    { command: 'oi', description: 'Open interest' },
    { command: 'liqs', description: 'Liquidations tape' },
    { command: 'lsr', description: 'Long/short ratio' },
    { command: 'etf', description: 'BTC & ETH ETF flows' },
    { command: 'security', description: 'Token security / rug check — /security pepe' },
    { command: 'author', description: 'KOL dossier — /author blknoiz06' },
    { command: 'calendar', description: 'Macro calendar (CPI, FOMC…)' },
    { command: 'stocks', description: 'Stocks — /stocks nvidia for chart + alerts' },
    { command: 'gas', description: 'Gas prices' },
    { command: 'hacks', description: 'Recent hacks & exploits' },
    { command: 'yields', description: 'DeFi yields (junk filtered)' },
    { command: 'rwa', description: 'Tokenized assets overview' },
    { command: 'regime', description: 'Market regime + world state' },
    { command: 'settings', description: 'Theme & default timeframe' },
    { command: 'help', description: 'All commands' },
  ])
  startAlertPoller(bot)
  // command menus (autocomplete): groups advertise ONLY the buy bot — the
  // open tier; DMs get the full Spectre Intelligence set
  bot.api.setMyCommands(
    [
      { command: 'buybot', description: 'Buy alerts for your token — setup & settings' },
      { command: 'calls', description: 'Group call ledger — first callers, graded' },
      { command: 'scan', description: 'Scan a token — ticker or contract' },
    ],
    { scope: { type: 'all_group_chats' } },
  ).catch(() => {})
  bot.api.setMyCommands(
    [
      { command: 'start', description: 'Welcome + overview' },
      { command: 'scan', description: 'Full token read — ticker or ANY contract' },
      { command: 'price', description: 'Price card — crypto, stocks, indices' },
      { command: 'chart', description: 'Chart with indicators' },
      { command: 'buybot', description: 'Buy bot for your community' },
      { command: 'calls', description: 'Group call ledger — first callers, graded' },
      { command: 'subscribe', description: 'Signal alerts in this chat' },
      { command: 'market', description: 'Market overview + regime read' },
      { command: 'overview', description: '🖼 Market dashboard card — AI analysis' },
      { command: 'feargreed', description: 'Fear & Greed — the chart' },
      { command: 'thesis', description: 'X social market thesis' },
      { command: 'lore', description: 'Project lore from the Brain' },
      { command: 'desk', description: 'Spectre Brain desk' },
      { command: 'regime', description: 'Market regime read' },
      { command: 'xdash', description: 'X attention board' },
      { command: 'runners', description: 'Low-cap runners' },
      { command: 'picks', description: '5 runner picks — X × Codex × safety' },
      { command: 'gainers', description: 'Momentum engine board' },
      { command: 'signals', description: 'Detector + hunter feed' },
      { command: 'receipts', description: 'Graded alert scoreboard' },
      { command: 'kol', description: 'Who is talking a token' },
      { command: 'author', description: 'KOL dossier by handle' },
      { command: 'security', description: 'Rug check — tax, honeypot, holders' },
      { command: 'funding', description: 'Funding rates + crowding read' },
      { command: 'oi', description: 'Open interest + concentration read' },
      { command: 'liqs', description: 'Liquidations + flush read' },
      { command: 'lsr', description: 'Long/short ratio + positioning read' },
      { command: 'etf', description: 'ETF flows + rotation read' },
      { command: 'calendar', description: 'Macro calendar + the week ahead' },
      { command: 'stocks', description: 'US stocks & indices' },
      { command: 'news', description: 'Latest headlines' },
      { command: 'hacks', description: 'Recent exploits' },
      { command: 'gas', description: 'Gas prices' },
      { command: 'yields', description: 'DeFi yields' },
      { command: 'rwa', description: 'Tokenized assets' },
      { command: 'heatmap', description: 'Market heatmap (add x for X attention)' },
      { command: 'bubbles', description: 'Mover bubbles (add x for X bubbles)' },
      { command: 'top', description: 'Gainers & losers' },
      { command: 'watchlist', description: 'Your watchlist' },
      { command: 'alert', description: 'Price alerts — crypto & stocks' },
      { command: 'settings', description: 'Theme + default timeframe' },
      { command: 'help', description: 'All commands' },
    ],
    { scope: { type: 'default' } },
  ).catch(() => {})

  subs.startSignalPoller(bot)
  buybot.startBuyBot(bot)
  subs.startNewswire(bot)
  marketOverview.startOverviewScheduler(bot)
  require('./grader').startGrader()
  bot.start({
    onStart: (me) => console.log(`Spectre AI Intelligence online as @${me.username}`),
  })
}

main().catch((e) => {
  console.error('[fatal] startup failed:', e)
  process.exit(1) // let pm2 restart us rather than idle as a zombie
})
