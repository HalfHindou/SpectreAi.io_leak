/**
 * Spectre AI Telegram Bot
 * Every response is a screenshot of the real running Spectre app.
 * No canvas renderers — pixel-perfect real UI only.
 *
 * Commands:
 *   /start           — Welcome card
 *   /gm              — GM Dashboard (live screenshot)
 *   /heatmap         — Heatmaps page
 *   /liquidation     — Liquidation heatmap
 *   /price [symbol]  — Research zone for token
 *   /news            — News page
 *   /feargreed       — Fear & Greed page
 *   /market          — Welcome page overview
 *   /trending        — Discovery page
 *   /brief           — AI Brief tab
 *   /sectors         — Sectors tab
 *   /flows           — Flows tab
 *   /bubbles         — Bubbles page
 *   /calendar        — Economic calendar
 *   /categories      — Token categories
 *   /app [page]      — Screenshot any page
 *
 * Requires: TELEGRAM_BOT_TOKEN + running Spectre app on localhost:5180
 */

const { Telegraf, Markup } = require('telegraf')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

const { screenshotPage, isAppRunning, closeBrowser } = require('./screenshot')
const { renderWelcome } = require('./renderers/welcome')
const { SYMBOL_MAP } = require('./data/coingecko')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env')
  process.exit(1)
}

const APP_URL = 'https://app.spectreai.io'

const bot = new Telegraf(BOT_TOKEN)

// ── Helper: send image with loading message ──
async function sendImage(ctx, loadingText, generateFn) {
  const msg = await ctx.reply(loadingText)
  try {
    const { buffer, caption } = await generateFn()
    await ctx.replyWithPhoto(
      { source: buffer },
      { caption, parse_mode: 'Markdown' }
    )
    await ctx.deleteMessage(msg.message_id).catch(() => {})
  } catch (err) {
    console.error(err)
    await ctx.reply('Failed to generate. Try again in a moment.')
  }
}

// ── Helper: screenshot a route ──
async function captureRoute(routePath, name, opts = {}) {
  const running = await isAppRunning()
  if (!running) throw new Error('Spectre app is not running on localhost:5180')
  const buffer = await screenshotPage({
    path: routePath,
    waitMs: opts.waitMs || 4000,
    viewport: { width: 1440, height: 900 },
    ...opts,
  })
  if (!buffer) throw new Error('Screenshot failed')
  return {
    buffer,
    caption: `*${name}*\n_${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · spectreai.io_`,
  }
}

// ── Helper: screenshot home page with a specific tab clicked ──
async function captureHomeTab(tabText, name, opts = {}) {
  return captureRoute('/', name, {
    waitMs: opts.waitMs || 5000,
    beforeScreenshot: async (page) => {
      await page.evaluate((text) => {
        const tabs = document.querySelectorAll('button')
        for (const t of tabs) {
          if (t.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
            t.click()
            break
          }
        }
      }, tabText)
      await new Promise(r => setTimeout(r, 2500))
    },
    ...opts,
  })
}

// ── /start — Welcome card + Mini App button ──
bot.start(async (ctx) => {
  await sendImage(ctx, 'Welcome to Spectre AI...', async () => ({
    buffer: await renderWelcome(),
    caption: `*SPECTRE AI* — Crypto Intelligence Bot\nType / to see all commands.`,
  }))
  // WebApp buttons only work in private chats
  if (ctx.chat.type === 'private') {
    await ctx.reply('Open the full dashboard inside Telegram:', Markup.inlineKeyboard([
      [Markup.button.webApp('Open Spectre Dashboard', APP_URL)],
      [
        Markup.button.webApp('Heatmaps', `${APP_URL}/heatmaps`),
        Markup.button.webApp('F&G', `${APP_URL}/fear-greed`),
      ],
      [
        Markup.button.webApp('News', `${APP_URL}/news`),
        Markup.button.webApp('Discover', `${APP_URL}/discover`),
      ],
    ]))
  }
})

// ── /help — Welcome card ──
bot.help(async (ctx) => {
  await sendImage(ctx, 'Welcome to Spectre AI...', async () => ({
    buffer: await renderWelcome(),
    caption: `*SPECTRE AI* — Crypto Intelligence Bot\nType / to see all commands.`,
  }))
})

// ── /dashboard — Open Mini App with page picker (private chats only) ──
bot.command('dashboard', (ctx) => {
  if (ctx.chat.type !== 'private') {
    return ctx.reply('Open @SpectreAI\\_Bot in a DM to use the Mini App dashboard.')
  }
  ctx.reply('Choose a section to open:', Markup.inlineKeyboard([
    [Markup.button.webApp('Full Dashboard', APP_URL)],
    [
      Markup.button.webApp('Heatmaps', `${APP_URL}/heatmaps`),
      Markup.button.webApp('Fear & Greed', `${APP_URL}/fear-greed`),
    ],
    [
      Markup.button.webApp('News', `${APP_URL}/news`),
      Markup.button.webApp('Discover', `${APP_URL}/discover`),
    ],
    [
      Markup.button.webApp('GM Dashboard', `${APP_URL}/gm-dashboard`),
      Markup.button.webApp('Bubbles', `${APP_URL}/bubbles`),
    ],
    [
      Markup.button.webApp('Liquidation', `${APP_URL}/liquidation-heatmap`),
      Markup.button.webApp('Calendar', `${APP_URL}/economic-calendar`),
    ],
    [
      Markup.button.webApp('Categories', `${APP_URL}/categories`),
      Markup.button.webApp('Sectors', `${APP_URL}/sectors`),
    ],
  ]))
})

// ── /gm — GM Dashboard ──
bot.command('gm', (ctx) => sendImage(ctx, 'GM...', () =>
  captureRoute('/gm-dashboard', 'GM Dashboard', { waitMs: 5000 })
))

// ── /heatmap — Heatmaps page ──
bot.command('heatmap', (ctx) => sendImage(ctx, 'Capturing heatmap...', () =>
  captureRoute('/heatmaps', 'Crypto Heatmap')
))

// ── /liquidation — Liquidation heatmap ──
bot.command('liquidation', (ctx) => sendImage(ctx, 'Capturing liquidation map...', () =>
  captureRoute('/liquidation-heatmap', 'Liquidation Heatmap', { waitMs: 5000 })
))

// ── /price & /chart & /p — Research zone for token ──
const handlePrice = (ctx) => {
  const symbol = (ctx.message.text.split(' ')[1] || '').toUpperCase()
  if (!symbol) return ctx.reply('Usage: /price BTC')
  const slug = SYMBOL_MAP[symbol]
  if (!slug) return ctx.reply(`Unknown token: ${symbol}\nTry: BTC, ETH, SOL, etc.`)
  return sendImage(ctx, `Looking up ${symbol}...`, () =>
    captureRoute(`/research-zone/${slug}`, `${symbol} Research`, { waitMs: 5000 })
  )
}
bot.command('price', handlePrice)
bot.command('chart', handlePrice)
bot.command('p', handlePrice)

// ── /news — News page ──
bot.command('news', (ctx) => sendImage(ctx, 'Fetching headlines...', () =>
  captureRoute('/news', 'News Feed')
))

// ── /feargreed & /fg — Fear & Greed page ──
const handleFG = (ctx) => sendImage(ctx, 'Reading sentiment...', () =>
  captureRoute('/fear-greed', 'Fear & Greed Index', { waitMs: 5000 })
)
bot.command('feargreed', handleFG)
bot.command('fg', handleFG)

// ── /market — Welcome page (market overview) ──
bot.command('market', (ctx) => sendImage(ctx, 'Loading market...', () =>
  captureRoute('/', 'Market Overview')
))

// ── /trending — Discovery page ──
bot.command('trending', (ctx) => sendImage(ctx, 'Finding trending...', () =>
  captureRoute('/discover', 'Trending & Discovery', { waitMs: 4500 })
))

// ── /brief — AI Brief tab on home ──
bot.command('brief', (ctx) => sendImage(ctx, 'Capturing Brief...', () =>
  captureHomeTab('brief', 'The Brief')
))

// ── /sectors — Sectors tab on home ──
bot.command('sectors', (ctx) => sendImage(ctx, 'Capturing Sectors...', () =>
  captureHomeTab('sector', 'Sector Performance')
))

// ── /flows — Flows tab on home ──
bot.command('flows', (ctx) => sendImage(ctx, 'Capturing Flows...', () =>
  captureHomeTab('flow', 'Exchange Flows')
))

// ── /bubbles — Bubbles page ──
bot.command('bubbles', (ctx) => sendImage(ctx, 'Capturing Bubbles...', () =>
  captureRoute('/bubbles', 'Crypto Bubbles', { waitMs: 5000 })
))

// ── /calendar — Economic calendar ──
bot.command('calendar', (ctx) => sendImage(ctx, 'Capturing Calendar...', () =>
  captureRoute('/economic-calendar', 'Economic Calendar')
))

// ── /categories — Token categories page ──
bot.command('categories', (ctx) => sendImage(ctx, 'Capturing Categories...', () =>
  captureRoute('/categories', 'Token Categories')
))

// ── /mindshare — Mindshare tab on home ──
bot.command('mindshare', (ctx) => sendImage(ctx, 'Capturing Mindshare...', () =>
  captureHomeTab('mindshare', 'Mindshare')
))

// ── /wallets — Wallets tab on home ──
bot.command('wallets', (ctx) => sendImage(ctx, 'Capturing Wallets...', () =>
  captureHomeTab('wallet', 'Whale Wallets')
))

// ── X-Dash text + alert commands ────────────────────────
const xdash = require('./commands/xdash')
const { startWatcher } = require('./watchers/momentum-watcher')

bot.command(['top', 'topxd', 'top15'], xdash.handleTop)
bot.command('signals',     xdash.handleSignals)
bot.command('runners',     xdash.handleRunners)
bot.command('fresh',       xdash.handleFresh)
bot.command('movers',      xdash.handleMovers)
bot.command('dump',        xdash.handleDump)
bot.command('clean',       xdash.handleClean)
bot.command('token',       xdash.handleToken)
bot.command('who',         xdash.handleWho)
bot.command('quality',     xdash.handleQuality)
bot.command('compare',     xdash.handleCompare)
bot.command('creators',    xdash.handleCreators)
bot.command(['narratives', 'narr'], xdash.handleNarratives)
bot.command('digest',      xdash.handleDigest)
bot.command('alerts',      xdash.handleAlerts)
bot.command('watch',       xdash.handleWatch)
bot.command('unwatch',     xdash.handleUnwatch)
bot.command(['xdhelp', 'xd'], xdash.handleXDHelp)

// X-Dash visual screenshots
bot.command('xdmap', (ctx) => sendImage(ctx, 'Capturing X-Dash heatmap...', () =>
  captureRoute('/x-dash', 'X-Dash Leaderboard')
))
bot.command('narrmap', (ctx) => sendImage(ctx, 'Capturing narratives map...', () =>
  captureRoute('/x-dash?tab=narratives', 'X-Dash Narratives')
))
bot.command('creatormap', (ctx) => sendImage(ctx, 'Capturing creators map...', () =>
  captureRoute('/x-dash?tab=creators', 'X-Dash Creators')
))
bot.command('drawer', (ctx) => {
  const sym = (ctx.message.text.split(/\s+/)[1] || '').replace(/^\$/, '').toLowerCase()
  if (!sym) return ctx.reply('Usage: /drawer <symbol>\nExample: /drawer virl')
  return sendImage(ctx, `Capturing $${sym.toUpperCase()} drawer...`, () =>
    captureRoute(`/x-dash?token=${encodeURIComponent(sym)}`, `$${sym.toUpperCase()} drawer`)
  )
})

// ── /app [page] — Screenshot any page by name ──
bot.command('app', (ctx) => {
  const arg = (ctx.message.text.split(' ')[1] || '').toLowerCase()
  const routes = {
    '':            { path: '/',                    name: 'Welcome Page' },
    'home':        { path: '/',                    name: 'Welcome Page' },
    'feargreed':   { path: '/fear-greed',          name: 'Fear & Greed' },
    'fg':          { path: '/fear-greed',          name: 'Fear & Greed' },
    'heatmaps':    { path: '/heatmaps',            name: 'Heatmaps' },
    'heatmap':     { path: '/heatmaps',            name: 'Heatmaps' },
    'news':        { path: '/news',                name: 'News' },
    'bubbles':     { path: '/bubbles',             name: 'Bubbles' },
    'categories':  { path: '/categories',          name: 'Categories' },
    'liquidation': { path: '/liquidation-heatmap', name: 'Liquidation' },
    'calendar':    { path: '/economic-calendar',   name: 'Calendar' },
    'discover':    { path: '/discover',            name: 'Discovery' },
    'gm':          { path: '/gm-dashboard',        name: 'GM Dashboard' },
    'watchlists':  { path: '/watchlists',          name: 'Watchlists' },
    'glossary':    { path: '/glossary',            name: 'Glossary' },
    'roi':         { path: '/roi-calculator',      name: 'ROI Calculator' },
  }
  const route = routes[arg] || routes['']
  return sendImage(ctx, `Capturing ${route.name}...`, () =>
    captureRoute(route.path, route.name)
  )
})

// ── Register command suggestions in Telegram UI ────────
bot.telegram.setMyCommands([
  { command: 'dashboard',   description: 'Open Spectre Mini App' },
  { command: 'gm',          description: 'GM Dashboard' },
  { command: 'price',       description: 'Token research (e.g. /price BTC)' },
  { command: 'heatmap',     description: 'Crypto heatmaps' },
  { command: 'liquidation', description: 'Liquidation heatmap' },
  { command: 'news',        description: 'News feed' },
  { command: 'feargreed',   description: 'Fear & Greed index' },
  { command: 'market',      description: 'Market overview' },
  { command: 'trending',    description: 'Trending & discovery' },
  { command: 'brief',       description: 'AI market brief' },
  { command: 'sectors',     description: 'Sector performance' },
  { command: 'flows',       description: 'Exchange flows' },
  { command: 'bubbles',     description: 'Crypto bubbles' },
  { command: 'calendar',    description: 'Economic calendar' },
  { command: 'categories',  description: 'Token categories' },
  { command: 'mindshare',   description: 'Mindshare metrics' },
  { command: 'wallets',     description: 'Whale wallets' },
  { command: 'app',         description: 'Screenshot any page' },
  { command: 'help',        description: 'Show all commands' },
  // X-Dash command surface
  { command: 'top',         description: 'X-Dash: top N tokens by attention' },
  { command: 'signals',     description: 'X-Dash: Spectre Momentum board' },
  { command: 'runners',     description: 'X-Dash: fresh runners (24h)' },
  { command: 'fresh',       description: 'X-Dash: fresh runners (6h)' },
  { command: 'movers',      description: 'X-Dash: biggest rank climbers' },
  { command: 'dump',        description: 'X-Dash: biggest rank fallers' },
  { command: 'clean',       description: 'X-Dash: cleanest signal tokens' },
  { command: 'token',       description: 'X-Dash: full brief on a token' },
  { command: 'who',         description: 'X-Dash: who carries this token' },
  { command: 'quality',     description: 'X-Dash: clean/spam breakdown' },
  { command: 'compare',     description: 'X-Dash: two tokens side-by-side' },
  { command: 'creators',    description: 'X-Dash: top KOLs by board impact' },
  { command: 'narratives',  description: 'X-Dash: top narratives by attention' },
  { command: 'digest',      description: 'X-Dash: one-screen overview' },
  { command: 'xdmap',       description: 'X-Dash: attention heatmap image' },
  { command: 'narrmap',     description: 'X-Dash: narratives heatmap image' },
  { command: 'creatormap',  description: 'X-Dash: creators heatmap image' },
  { command: 'drawer',      description: 'X-Dash: token drawer image' },
  { command: 'alerts',      description: 'Toggle new-runner push alerts' },
  { command: 'watch',       description: 'Watch a token for activity spikes' },
  { command: 'unwatch',     description: 'Stop watching a token' },
  { command: 'xdhelp',      description: 'List all X-Dash commands' },
])

// ── Set Mini App menu button (replaces default "/" menu) ────
bot.telegram.setChatMenuButton({
  menuButton: {
    type: 'web_app',
    text: 'Spectre',
    web_app: { url: APP_URL },
  },
}).then(() => console.log('Menu button set to Mini App'))
  .catch(e => console.log('Menu button (per-chat only):', e.message))

// ── Launch ──────────────────────────────────────────────
bot.launch()
console.log('Spectre Telegram Bot is running!')
console.log('Mini App URL:', APP_URL)

// Start the X-Dash runner watcher (polls /api/momentum/setups every 90s
// and broadcasts to /alerts subscribers when a new token enters the
// Momentum Top 25; also fires per-token /watch alerts on mention spikes).
startWatcher(bot)

process.once('SIGINT', () => { closeBrowser(); bot.stop('SIGINT') })
process.once('SIGTERM', () => { closeBrowser(); bot.stop('SIGTERM') })
