// GM cards — the app's "Good morning" screen as Telegram /gm /gd /gn. Themed
// sky→sea gradient with frosted-glass panels (Top 5 Crypto · Stocks · News),
// rendered via headless Chrome. Founder art 2026-07-18.
const fs = require('fs')
const path = require('path')
const api = require('./spectre-api')
const shot = require('./app-shot')

const g = (p, ttl = 60e3) => api.get(p, { ttlMs: ttl })
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const CRYPTO = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']
const STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META']

let _logo = null
function spectreLogo() {
  if (_logo !== null) return _logo
  try { _logo = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../assets/spectre-logo.png')).toString('base64')}` } catch { _logo = '' }
  return _logo
}
function price(n) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (a >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const d = Math.max(2, 3 - Math.floor(Math.log10(a || 1)))
  return '$' + n.toFixed(Math.min(d, 8))
}
const chgHtml = (v) => (isFinite(v) ? `<span class="chg ${v >= 0 ? 'up' : 'dn'}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>` : '')

// our GM backgrounds (the app's rotating Unsplash scenes), picked per time of
// day: sunrise beach / bright shore / starry night
const PHOTO = { gm: 'photo-1507525428034-b723cf961d3e', gd: 'photo-1519046904884-53103b34b206', gn: 'photo-1519681393784-d120267933ba' }
const photoUrl = (period) => `https://images.unsplash.com/${PHOTO[period] || PHOTO.gm}?w=1920&q=80&auto=format&fit=crop`
// scrim over the photo so white text + glass panels stay legible
const SCRIM = { gm: 'linear-gradient(180deg,rgba(12,14,26,.34),rgba(12,14,26,.2) 34%,rgba(10,12,20,.58))', gd: 'linear-gradient(180deg,rgba(10,16,30,.36),rgba(10,16,30,.2) 34%,rgba(8,12,22,.58))', gn: 'linear-gradient(180deg,rgba(6,8,20,.5),rgba(6,8,20,.4) 34%,rgba(5,7,16,.68))' }
const THEMES = { gm: { greet: 'Good morning' }, gd: { greet: 'Good afternoon' }, gn: { greet: 'Good evening' } }

async function fetchNews() {
  const EXCLUDE = /block mined|8-?K\b|10-[QK]\b|form 4|funding (rate|flip)|open interest|long.short|liquidation|scam|fraud|jailed|indict|sentenc|malware|phish|arrest|stolen|launder|ponzi|presale|airdrop|giveaway|1000x/i
  const [breaking, news] = await Promise.all([g('/v1/news/breaking?limit=20', 3 * 60e3).catch(() => null), api.news(25).catch(() => null)])
  const items = [...(Array.isArray(news) ? news : []), ...(Array.isArray(breaking) ? breaking : [])]
  const out = []
  const seen = new Set()
  for (const n of items) {
    let t = String(n.title || '').replace(/https?:\/\/\S+/g, ' ').trim()
    const cjk = t.search(/[぀-ヿ一-鿿가-힯]/)
    if (cjk === 0) continue
    if (cjk > 0) t = t.slice(0, cjk).trim()
    if (t.length < 18 || t.length > 120 || EXCLUDE.test(t)) continue
    const k = t.toLowerCase().slice(0, 40)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= 5) break
  }
  return out
}

async function gmCard(period = 'gm', name = '') {
  const th = THEMES[period] || THEMES.gm
  const [px, stocks, news] = await Promise.all([
    api.prices(CRYPTO, { ttlMs: 30e3 }).catch(() => null),
    g(`/v1/macro/equity-quotes?symbols=${STOCKS.join(',')}`, 60e3).catch(() => null),
    fetchNews().catch(() => []),
  ])
  const cryptoRows = CRYPTO.map((s) => {
    const p = px?.[s] || {}
    return { sym: s, price: p.price, chg: Number(p.change?.['24h'] ?? NaN) }
  }).filter((r) => isFinite(r.price))
  const stockMap = {}
  for (const r of Array.isArray(stocks) ? stocks : []) stockMap[r.symbol] = r
  const stockRows = STOCKS.map((s) => stockMap[s]).filter(Boolean).map((r) => ({ sym: r.symbol, price: r.price, chg: Number(r.change_24h_pct) }))

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const rowHtml = (r) => `<div class="row"><span class="sym">${esc(r.sym)}</span><span class="px">${price(r.price)}</span>${chgHtml(r.chg)}</div>`
  const greeting = `${th.greet}, Spectre`

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:Inter,-apple-system,'Segoe UI',sans-serif}
    .gm{position:relative;width:1500px;padding:64px 70px 54px;color:#fff;overflow:hidden;background-color:#0b0f1c;
      background-image:${SCRIM[period] || SCRIM.gm},url('${photoUrl(period)}');background-size:cover;background-position:center}
    .gm::after{content:"";position:absolute;inset:0;background:radial-gradient(1300px 760px at 50% -18%,rgba(255,255,255,.05),transparent 60%);pointer-events:none}
    .head{position:relative;text-align:center;margin-bottom:30px}
    .head h1{font-size:52px;font-weight:600;letter-spacing:-.03em;text-shadow:0 2px 24px rgba(0,0,0,.28)}
    .chips{display:flex;justify-content:center;gap:12px;margin-top:20px}
    .chip{padding:9px 18px;border-radius:999px;font-size:15px;font-weight:500;color:rgba(255,255,255,.94);background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(14px);box-shadow:0 4px 18px rgba(0,0,0,.14)}
    .grid{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:22px}
    .panel{padding:26px 30px;border-radius:24px;background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 24px 60px rgba(0,0,0,.22);backdrop-filter:blur(34px);-webkit-backdrop-filter:blur(34px)}
    .panel.wide{grid-column:1 / -1;margin-top:22px}
    .ptitle{font-size:13px;font-weight:700;letter-spacing:.14em;color:rgba(255,255,255,.72);margin-bottom:16px}
    .ptitle .live{color:#5ef0a8;margin-left:8px}
    .row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:20px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.12)}
    .row:last-child{border-bottom:none}
    .sym{font-size:20px;font-weight:600}
    .px{font-size:20px;font-weight:500;text-align:right;font-variant-numeric:tabular-nums}
    .chg{font-size:16px;font-weight:600;text-align:right;min-width:88px}
    .chg.up{color:#5ef0a8}.chg.dn{color:#ff9ba3}
    .news .nrow{padding:13px 0;border-bottom:1px solid rgba(255,255,255,.1)}
    .news .nrow:last-child{border-bottom:none}
    .news .nt{font-size:19px;font-weight:500;line-height:1.35}
    .foot{position:relative;text-align:center;margin-top:34px;color:rgba(255,255,255,.82)}
    .foot .p{font-size:15px;font-weight:500;margin-bottom:12px}
    .foot .brand{display:inline-flex;align-items:center;gap:10px;padding:11px 22px;border-radius:999px;font-size:16px;font-weight:600;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(14px)}
    .foot .brand img{width:24px;height:24px;border-radius:7px}
  </style></head>
  <body><img src="${photoUrl(period)}" style="position:absolute;width:1px;height:1px;opacity:0" alt=""/><div class="gm">
    <div class="head"><h1>${greeting}</h1><div class="chips"><span class="chip">${esc(dateLabel)} · UTC</span></div></div>
    <div class="grid">
      <div class="panel"><div class="ptitle">TOP 5 CRYPTO</div>${cryptoRows.map(rowHtml).join('')}</div>
      <div class="panel"><div class="ptitle">TOP 5 STOCKS</div>${stockRows.length ? stockRows.map(rowHtml).join('') : '<div class="row"><span class="sym" style="opacity:.6">Market closed</span></div>'}</div>
      <div class="panel wide news"><div class="ptitle">TOP 5 NEWS<span class="live">● LIVE</span></div>${(news || []).map((t) => `<div class="nrow"><div class="nt">${esc(t)}</div></div>`).join('') || '<div class="nrow"><div class="nt" style="opacity:.7">Wire is quiet right now.</div></div>'}</div>
    </div>
    <div class="foot"><div class="p">Peace, brought to you by</div><div class="brand"><img src="${spectreLogo()}"/>Spectre AI</div></div>
  </div></body></html>`

  const png = await shot.renderHtml(html, { width: 1500, height: 1150, selector: '.gm', settleMs: 1400 })
  if (!png) throw new Error('render failed')
  const btc = cryptoRows.find((r) => r.sym === 'BTC')
  const caption = [`${period === 'gn' ? '🌙' : period === 'gd' ? '☀️' : '🌅'} <b>${greeting}</b>`, btc?.price ? `BTC ${price(btc.price)}${isFinite(btc.chg) ? ` (${btc.chg >= 0 ? '+' : ''}${btc.chg.toFixed(1)}%)` : ''}` : '', '<i>⌁ Spectre Intelligence</i>'].filter(Boolean).join('\n')
  return { png, caption }
}

module.exports = { gmCard }
