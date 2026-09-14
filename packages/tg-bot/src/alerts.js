const api = require('./spectre-api')
const store = require('./store')
const { esc, price, move } = require('./format')

// /alert btc >70k · /alert eth <1800 · /alert list · /alert rm 2 · /alert clear
function parseTarget(raw) {
  const m = String(raw).trim().toLowerCase().match(/^([\d.]+)([km]?)$/)
  if (!m) return null
  let v = parseFloat(m[1])
  if (!isFinite(v)) return null
  if (m[2] === 'k') v *= 1e3
  if (m[2] === 'm') v *= 1e6
  return v
}

async function handleAlertCommand(ctx) {
  const args = (ctx.match || '').trim().split(/\s+/).filter(Boolean)
  const uid = ctx.from.id

  if (!args.length || args[0] === 'list') {
    const u = store.user(uid)
    if (!u.alerts.length) return ctx.reply('No active alerts. Set one: <code>/alert btc &gt;70k</code>', { parse_mode: 'HTML' })
    const lines = ['🔔 <b>Active alerts</b>', '']
    for (const a of u.alerts) lines.push(`#${a.id} — ${esc(a.symbol)} ${a.op === '>' ? 'above' : 'below'} ${price(a.price)}`)
    lines.push('', '<i>/alert rm N · /alert clear</i>')
    return ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }
  if (args[0] === 'clear') {
    const n = store.clearAlerts(uid)
    return ctx.reply(`Cleared ${n} alert${n === 1 ? '' : 's'}.`)
  }
  if (args[0] === 'rm' && args[1]) {
    const ok = store.rmAlert(uid, parseInt(args[1], 10))
    return ctx.reply(ok ? 'Alert removed.' : 'No alert with that id — /alert list')
  }

  // /alert btc >70k  (also tolerate "/alert btc > 70k")
  const symbol = args[0]
  const rest = args.slice(1).join('')
  const m = rest.match(/^([<>])(.+)$/)
  const target = m && parseTarget(m[2])
  if (!m || target == null) {
    return ctx.reply('Format: <code>/alert btc &gt;70k</code> or <code>/alert eth &lt;1800</code>', { parse_mode: 'HTML' })
  }
  // crypto first, then US stocks/indices (NVDA, SPX/SP500, VIX…)
  const crypto = (await api.prices([symbol]).catch(() => null))?.[symbol.toUpperCase()]
  const stock = crypto ? null : await api.stockQuote(symbol).catch(() => null)
  if (!crypto && !stock) return ctx.reply(`Unknown ticker "${esc(symbol.toUpperCase())}" — crypto, US stocks and SPX/NDX/VIX/DXY work.`, { parse_mode: 'HTML' })
  const a = store.addAlert(uid, stock ? stock.symbol : symbol, m[1], target)
  if (stock) {
    const u = store.user(uid)
    u.alerts[u.alerts.length - 1].kind = 'stock'
  }
  const now = crypto ? crypto.price : stock.price
  const chg = crypto ? crypto.change?.['24h'] : stock.change24
  return ctx.reply(
    `🔔 Alert #${a.id} set: <b>${esc(a.symbol)}</b> ${a.op === '>' ? 'above' : 'below'} <b>${price(a.price)}</b>${stock ? ` <i>(${stock.kind === 'index' ? 'index' : 'US stock'})</i>` : ''}\n` +
      `Now: ${price(now)} ${move(chg)} 24h`,
    { parse_mode: 'HTML' },
  )
}

// 60s poll over one batched /v1/prices call for all alert symbols
function startAlertPoller(bot) {
  setInterval(async () => {
    try {
      const pairs = store.allAlerts()
      if (!pairs.length) return
      const cryptoPairs = pairs.filter((p) => p.alert.kind !== 'stock')
      const stockPairs = pairs.filter((p) => p.alert.kind === 'stock')
      const symbols = [...new Set(cryptoPairs.map((p) => p.alert.symbol))]
      const data = symbols.length ? await api.prices(symbols, { ttlMs: 1 }) : {}
      const stockPrices = {}
      for (const sym of [...new Set(stockPairs.map((p) => p.alert.symbol))]) {
        const q = await api.stockQuote(sym, { ttlMs: 1 }).catch(() => null)
        if (q) stockPrices[sym] = { price: q.price, change: { '24h': q.change24 } }
      }
      for (const { userId, alert } of pairs) {
        const row = alert.kind === 'stock' ? stockPrices[alert.symbol] : data?.[alert.symbol]
        if (!row || row.price == null) continue
        const hit = alert.op === '>' ? row.price >= alert.price : row.price <= alert.price
        if (!hit) continue
        store.rmAlert(userId, alert.id)
        await bot.api
          .sendMessage(
            userId,
            `🔔 <b>${esc(alert.symbol)}</b> crossed ${alert.op === '>' ? 'above' : 'below'} <b>${price(alert.price)}</b>\n` +
              `Now ${price(row.price)} ${move(row.change?.['24h'])} 24h` +
              (alert.kind === 'stock' ? '' : `\n\n/chart ${alert.symbol.toLowerCase()} for the chart`),
            { parse_mode: 'HTML' },
          )
          .catch(() => {})
      }
    } catch (err) {
      console.error('[alerts] poll error:', err.message)
    }
  }, 60e3)
}

module.exports = { handleAlertCommand, startAlertPoller }
