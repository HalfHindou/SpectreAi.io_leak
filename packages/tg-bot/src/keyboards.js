const { InlineKeyboard } = require('grammy')
const { TF_ORDER, TIMEFRAMES, APP_URL } = require('./config')
const { THEMES } = require('./themes')

// callback_data grammar (≤64 bytes): verb|arg1|arg2
//   c|SYM|tf    chart render / TF switch
//   x|SYM       scan
//   k|SYM       KOLs
//   wl|a|SYM    watchlist add
//   st|t|name   set theme · st|f|tf  set default TF
//   go|m / go|xd / go|desk   quick actions

function rzUrl(symbol) {
  return `${APP_URL}/research-zone/${symbol.toLowerCase()}`
}

// links from tokenLink() — array of {label, url}, contract-first, always
// token-connected (a single {label, url} still works)
function linkRow(kb, links, newRow = false) {
  const arr = Array.isArray(links) ? links : links ? [links] : []
  if (!arr.length) return kb
  if (newRow) kb.row()
  for (const l of arr.slice(0, 2)) kb.url(l.label, l.url)
  return kb
}

function tfKeyboard(symbol, activeTf, link) {
  const kb = new InlineKeyboard()
  for (const tf of TF_ORDER) {
    const label = TIMEFRAMES[tf].label
    kb.text(tf === activeTf ? `· ${label} ·` : label, `c|${symbol}|${tf}`)
  }
  kb.row()
  kb.text('🔎 Scan', `x|${symbol}`).text('𝕏 KOLs', `k|${symbol}`)
  return linkRow(kb, link)
}

function priceKeyboard(symbol, tf) {
  return new InlineKeyboard()
    .text('📈 Chart', `c|${symbol}|${tf}`)
    .text('🔎 Scan', `x|${symbol}`)
    .text('⭐ Watch', `wl|a|${symbol}`)
}

function scanKeyboard(symbol, tf, link) {
  const kb = new InlineKeyboard()
  for (const t of TF_ORDER) {
    const label = TIMEFRAMES[t].label
    kb.text(t === tf ? `· ${label} ·` : label, `x|${symbol}|${t}`)
  }
  kb.row()
  kb.text('📈 Chart', `c|${symbol}|${tf}`).text('𝕏 KOLs', `k|${symbol}`).text('⭐ Watch', `wl|a|${symbol}`)
  return linkRow(kb, link, true)
}

function settingsKeyboard(prefs) {
  const kb = new InlineKeyboard()
  for (const [name, t] of Object.entries(THEMES)) {
    kb.text(prefs.theme === name ? `· ${t.label} ·` : t.label, `st|t|${name}`)
  }
  kb.row()
  for (const tf of TF_ORDER) {
    const label = TIMEFRAMES[tf].label
    kb.text(prefs.tf === tf ? `· ${label} ·` : label, `st|f|${tf}`)
  }
  return kb
}

// Heatmap/bubble board controls: timeframe row (market variant) + view toggles
function boardKeyboard(kind, variant, tf = '24h') {
  const kb = new InlineKeyboard()
  if (variant === 'm') {
    for (const t of ['1h', '24h', '7d']) {
      kb.text(t === tf ? `· ${t.toUpperCase()} ·` : t.toUpperCase(), `${kind}|m|${t}`)
    }
    kb.row()
  }
  kb.text(variant === 'x' ? 'Market' : '· Market ·', `${kind}|m|${tf}`)
    .text(variant === 'x' ? '· 𝕏 ·' : '𝕏 Attention', `${kind}|x|${tf}`)
    .text(kind === 'hm' ? '🫧 Bubbles' : '🔥 Heatmap', `${kind === 'hm' ? 'bb' : 'hm'}|${variant}|${tf}`)
  return kb
}

function startKeyboard() {
  return new InlineKeyboard()
    .text('📈 BTC chart', 'c|BTC|15m')
    .text('🔎 BTC scan', 'x|BTC')
    .row()
    .text('🔥 Heatmap', 'go|hm')
    .text('🫧 Bubbles', 'go|bb')
    .text('🧠 Desk', 'go|desk')
    .row()
    .text('🌐 Market', 'go|m')
    .text('𝕏 X-Dash', 'go|xd')
    .text('📡 Signals', 'go|sig')
}

module.exports = { tfKeyboard, priceKeyboard, scanKeyboard, settingsKeyboard, startKeyboard, boardKeyboard, rzUrl }
