// Market Overview dashboard — a composed glassmorphic card (Spectre design)
// rendered via headless Chrome from live data. Four flavors: live + morning /
// midday / evening updates (period-framed AI read). Founder art 2026-07-17.
const fs = require('fs')
const path = require('path')
const { InputFile } = require('grammy')
const api = require('./spectre-api')
const shot = require('./app-shot')
const store = require('./store')

const g = (p, ttl = 60e3) => api.get(p, { ttlMs: ttl })
const N = (v) => (v == null ? null : Number(v))

// top-8 assets — TRON/ADA swapped for TAO/HYPE per founder
const ASSETS = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'TAO', 'HYPE', 'DOGE']

let _logoDataUri = null
function spectreLogo() {
  if (_logoDataUri !== null) return _logoDataUri
  try {
    const b = fs.readFileSync(path.resolve(__dirname, '../assets/spectre-logo.png'))
    _logoDataUri = `data:image/png;base64,${b.toString('base64')}`
  } catch { _logoDataUri = '' }
  return _logoDataUri
}

// ── formatters ────────────────────────────────────────────────────────────
function usd(n) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}
function price(n) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (a >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const d = Math.max(2, 3 - Math.floor(Math.log10(a || 1)))
  return '$' + n.toFixed(Math.min(d, 8))
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// deterministic seeded sparkline trending with the change sign
function sparkPoints(seedStr, change, w, h) {
  let s = 0
  for (const c of String(seedStr)) s = (s * 31 + c.charCodeAt(0)) % 233280
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  const n = 22
  const trend = Math.max(-0.03, Math.min(0.03, (Number(change) || 0) / 100 / 2.5))
  let v = 0.5 - trend * n / 2
  const pts = []
  for (let i = 0; i < n; i++) { v += trend + (rand() - 0.5) * 0.14; v = Math.max(0.08, Math.min(0.92, v)); pts.push(v) }
  return pts.map((p, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - p * h).toFixed(1)}`).join(' ')
}
let _sparkId = 0
function sparkSvg(seed, change, w = 100, h = 30, forceColor) {
  const c = forceColor || (Number(change) >= 0 ? '#8d78ff' : '#ef565e')
  const pts = sparkPoints(seed, change, w, h)
  const id = `sg${_sparkId++}`
  const area = `${pts} ${w},${h} 0,${h}`
  return `<svg class="mini-chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".24"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs><polygon points="${area}" fill="url(#${id})"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

// inline stroke icons (headless Chrome lacks many emoji glyphs → tofu boxes)
const ICONS = {
  gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 13.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/><path d="M12.9 10.8L16.5 7.5"/><path d="M4.2 18a8 8 0 1115.6 0"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 20V13M10 20V5M15 20v-5M20 20V9"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.7 6 6 1.7-6 1.7-1.7 6-1.7-6-6-1.7 6-1.7 1.7-6z"/></svg>',
  pie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3.5a8.5 8.5 0 108.5 8.5H12V3.5z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 2.4 14.6 0 17M12 3.5c-2.4 2.4-2.4 14.6 0 17"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 20V15M12 20V6M18 20v-8"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8.5 3v4M15.5 3v4"/></svg>',
  btc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M9.5 8h4a2 2 0 010 4h-4zM9.5 12h4.3a2 2 0 010 4H9.5zM10.5 6.5v11M13 6.5v1.5M13 16v1.5" stroke-width="1.4"/></svg>',
  eth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3l5 8.5-5 3-5-3L12 3z"/><path d="M7 12.5l5 3 5-3-5 7.5-5-7.5z"/></svg>',
  wire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12a7 7 0 017 7M5 8a11 11 0 0111 11" opacity=".6"/><path d="M5 16a3 3 0 013 3"/><circle cx="5.5" cy="18.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
}

function pill(chg) {
  const v = Number(chg)
  if (!isFinite(v)) return '<span class="pill flat">—</span>'
  const up = v >= 0
  return `<span class="pill ${up ? 'up' : 'down'}">${up ? '↗' : '↘'} ${up ? '+' : ''}${v.toFixed(2)}%</span>`
}

// ── AI analysis (deterministic, period-framed) ──────────────────────────────
function fgLabel(v) {
  if (v <= 25) return 'extreme fear'
  if (v <= 45) return 'fear'
  if (v <= 55) return 'neutral'
  if (v <= 75) return 'greed'
  return 'extreme greed'
}
function analysis(d, period) {
  const { fg, mcapChg, turnover, rows, altStrength, beatBtcPct, medianAlt, others2Chg } = d
  const frame = { morning: 'Overnight tape into the EU session — ', midday: 'Into the US session — ', evening: 'After the US close — ', live: '' }[period] || ''
  const lines = []
  // fear/greed
  if (fg != null) {
    const l = fgLabel(fg)
    if (fg <= 25) lines.push(`Fear &amp; greed at ${fg} — ${l}. Historically a contrarian buy zone, but capitulation can extend before it turns.`)
    else if (fg >= 75) lines.push(`Fear &amp; greed at ${fg} — ${l}. Late-cycle energy; chasing here is how you become exit liquidity.`)
    else lines.push(`Fear &amp; greed at ${fg} — ${l}. No crowd extreme to fade; the tape decides, not the mood.`)
  }
  // alt strength — breadth + cyclical bear context
  if (altStrength != null && beatBtcPct != null) {
    const bp = Math.round(beatBtcPct)
    if (altStrength < 35) lines.push(`Alt strength ${altStrength}/100 — deep BTC season. Only ${bp}% of alts are beating BTC${medianAlt != null && medianAlt < 0 ? ` and the median alt is bleeding (${medianAlt.toFixed(1)}%)` : ''}. The long tail sits far below its 2024/25 highs — alts are in a bear market until breadth turns.`)
    else if (altStrength < 55) lines.push(`Alt strength ${altStrength}/100 — mixed. ${bp}% of alts beat BTC; no clean rotation yet, majors still set the tone.`)
    else lines.push(`Alt strength ${altStrength}/100 — alts are leading: ${bp}% beating BTC. Rotation down the curve is live${others2Chg != null && others2Chg > 0 ? `, the long tail is expanding (+${others2Chg.toFixed(1)}% 24h)` : ''}.`)
  }
  // liquidity
  if (mcapChg != null) {
    const cap = mcapChg >= 0 ? `Total cap up ${mcapChg.toFixed(1)}%` : `Total cap down ${Math.abs(mcapChg).toFixed(1)}%`
    const liq = turnover != null ? (turnover < 3 ? `, turnover thin at ${turnover.toFixed(1)}% — liquidity drying up` : `, turnover ${turnover.toFixed(1)}% — flow is healthy`) : ''
    lines.push(`${cap}${liq}.`)
  }
  // relative strength
  const ranked = rows.filter((r) => isFinite(r.chg)).sort((a, b) => b.chg - a.chg)
  if (ranked.length >= 2) {
    const best = ranked[0]
    const worst = ranked[ranked.length - 1]
    lines.push(`${best.sym} leading (${best.chg >= 0 ? '+' : ''}${best.chg.toFixed(1)}%), ${worst.sym} lagging (${worst.chg.toFixed(1)}%) — watch for a dominance shift.`)
  }
  if (!lines.length) return []
  return [frame + lines[0], ...lines.slice(1)]
}

// ── macro news-of-the-day (major macro ONLY — no memecoin/crime/filing noise)
const NEWS_EXCLUDE = /block mined|8-?K\b|10-[QK]\b|form 4|funding (rate|flip)|open interest|long.short|liquidation|scam|fraud|jailed|indict|sentenc|malware|hack(ed|er)?|phish|arrest|stolen|launder|ponzi|exploit|rug|presale|airdrop|giveaway|1000x|price prediction|\bwill \$?[a-z]+ (hit|reach|moon)|top \d+ (alt|coin|meme|token)/i
const NEWS_INCLUDE = /\b(fed|fomc|cpi|inflation|unemployment|jobs|nonfarm|payroll|gdp|rate cut|rate hike|rate decision|interest rate|treasury|yield|dollar|dxy|powell|ecb|boj|recession|stimulus|debt ceiling|tariff|trump|senate|congress|sec|etf|blackrock|fidelity|citadel|grayscale|institution|valuation|risk.?off|sell.?off|chip trade|geopolit|sanction|opec|oil)\b/i
function cleanNews(raw) {
  let t = String(raw || '').replace(/https?:\/\/\S+/g, ' ')
  const cjk = t.search(/[぀-ヿ一-鿿가-힯]/)
  if (cjk === 0) return ''
  if (cjk > 0) t = t.slice(0, cjk)
  t = t.replace(/^[A-Za-z][A-Za-z0-9_]{1,18}:\s+/, '').replace(/\s{2,}/g, ' ').trim()
  return t
}
function newsTag(t) {
  if (/\b(fed|fomc|rate|powell|cpi|inflation|unemployment|jobs|payroll|gdp|treasury|yield)\b/i.test(t)) return 'RATES & DATA'
  if (/\b(etf|blackrock|fidelity|citadel|grayscale|institution|valuation|investment|inflow|outflow|flow)\b/i.test(t)) return 'INSTITUTIONAL'
  if (/\b(sec|regulat|senate|congress|tariff|trump|sanction|policy|law)\b/i.test(t)) return 'POLICY'
  return 'MACRO'
}
async function fetchMacroNews() {
  const [breaking, news] = await Promise.all([
    g('/v1/news/breaking?limit=25', 3 * 60e3).catch(() => null),
    api.news(25).catch(() => null),
  ])
  const items = [...(Array.isArray(breaking) ? breaking : []), ...(Array.isArray(news) ? news : [])]
  for (const n of items) {
    const t = cleanNews(n.title)
    if (!t || t.length < 18 || t.length > 118) continue
    if (NEWS_EXCLUDE.test(t)) continue
    if (!NEWS_INCLUDE.test(t)) continue
    return { text: t, tag: newsTag(t) }
  }
  return null
}

// The box /v1/coins/markets EXCLUDES the major stablecoins (no USDT/USDC — only
// a few tiny ones), but globalStats.total INCLUDES them. So total − sum(box
// top-100) wrongly dumps ~$250B of stablecoin cap into the "alt long tail" (it
// was reading OTHERS2 ≈ $400B when the true figure is ~$85B, and TradingView's
// OTHERS index ex-top-10 is only ~$169B). Pull the stablecoin-INCLUSIVE top-100
// sum straight from CoinGecko so OTHERS2 = total − real-top-100 is honest.
let _cgTop100 = { ts: 0, sum: null }
async function cgTop100Sum() {
  if (_cgTop100.sum && Date.now() - _cgTop100.ts < 10 * 60e3) return _cgTop100.sum
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false', { signal: AbortSignal.timeout(12000) })
    if (!r.ok) throw new Error('cg ' + r.status)
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length < 50) throw new Error('cg thin')
    const sum = rows.reduce((s, x) => s + (Number(x.market_cap) || 0), 0)
    if (sum > 0) _cgTop100 = { ts: Date.now(), sum }
    return _cgTop100.sum
  } catch {
    return _cgTop100.sum // stale-on-error (any age) beats the $400B box artifact
  }
}

// ── data gather ─────────────────────────────────────────────────────────────
async function gather() {
  const [gl, fgRaw, alt, px, macro, top100, cgSum] = await Promise.all([
    api.globalStats().catch(() => null),
    api.fearGreed().catch(() => null),
    g('/v1/market/alt-season', 5 * 60e3).catch(() => null),
    api.prices(ASSETS, { ttlMs: 30e3 }).catch(() => null),
    fetchMacroNews().catch(() => null),
    api.markets(250).catch(() => null),
    cgTop100Sum().catch(() => null),
  ])
  const total = N(gl?.total_market_cap)
  const vol = N(gl?.total_volume_24h)
  const btcD = N(gl?.btc_dominance)
  const ethD = N(gl?.eth_dominance)
  const mcapChg = N(gl?.market_cap_change_24h)
  const rows = ASSETS.map((s) => {
    const p = px?.[s] || {}
    return {
      sym: s,
      name: p.name || s,
      price: p.price,
      chg: Number(p.change?.['24h'] ?? p.change_24h_pct ?? NaN),
      mcap: p.market_cap,
      image: p.image || '',
    }
  }).filter((r) => isFinite(r.price))
  const solMcap = rows.find((r) => r.sym === 'SOL')?.mcap
  const solD = solMcap && total ? (solMcap / total) * 100 : null
  const altD = btcD != null && ethD != null && solD != null ? Math.max(0, 100 - btcD - ethD - solD) : null
  const fg = N(fgRaw?.current?.value ?? fgRaw?.value)
  const fgClass = fgRaw?.current?.classification || fgRaw?.classification || ''
  const turnover = total && vol ? (vol / total) * 100 : null
  const markets = Array.isArray(top100) ? top100 : []
  // OTHERS2 — the alt long tail SIZE: total cap minus the stablecoin-inclusive
  // top-100 (from CoinGecko; the box list omits stables → don't use it here).
  // No CG number (cold failure) → null, and the card degrades to breadth-only
  // rather than showing the inflated box figure.
  const sumTop100 = cgSum || null
  const others2 = total && sumTop100 ? total - sumTop100 : null
  const others2Share = others2 && total ? (others2 / total) * 100 : null
  let others2Chg = null
  if (others2) {
    store.pushAltSnapshot(others2)
    const snaps = store.altSnapshots()
    const past = snaps.find((s) => Date.now() - s.ts >= 22 * 3600e3)
    if (past?.o) others2Chg = ((others2 - past.o) / past.o) * 100
  }
  // ALT STRENGTH — the honest read: BREADTH, not dominance (a dead tail can
  // still be 18% of total). Of the real alts (ex BTC / stables / wrapped-staked)
  // how many are actually BEATING BTC + green over 24h. Weak breadth = weak alts.
  const STABLE = /USD|DAI|EUR|USTC|BUIDL/i
  const WRAP = /WBTC|WETH|WEETH|WSTETH|STETH|WBETH|CBBTC|CBETH|RETH|LBTC|SOLVBTC|BNSOL|JITOSOL|MSOL|RSETH|EZETH|SUSDE/i
  const btcRow = markets.find((r) => String(r.symbol || '').toUpperCase() === 'BTC')
  const btcChg = Number(btcRow?.price_change_percentage_24h) || 0
  const realAlts = markets.filter((r) => {
    const s = String(r.symbol || '').toUpperCase()
    return s !== 'BTC' && !STABLE.test(s) && !WRAP.test(s) && isFinite(r.price_change_percentage_24h)
  })
  const altChgs = realAlts.map((r) => r.price_change_percentage_24h)
  const beatBtcPct = altChgs.length ? (altChgs.filter((x) => x > btcChg).length / altChgs.length) * 100 : null
  const greenPct = altChgs.length ? (altChgs.filter((x) => x > 0).length / altChgs.length) * 100 : null
  const sortedChg = [...altChgs].sort((a, b) => a - b)
  const medianAlt = sortedChg.length ? sortedChg[Math.floor(sortedChg.length / 2)] : null
  const altStrength = beatBtcPct != null && greenPct != null ? Math.round(0.65 * beatBtcPct + 0.35 * greenPct) : null
  return { total, vol, btcD, ethD, solD, altD, mcapChg, rows, fg, fgClass, alt, turnover, macro, others2, others2Share, others2Chg, altStrength, beatBtcPct, greenPct, medianAlt, btcChg }
}

// ── HTML template (matches the Spectre Market Overview design pack) ─────────
const TONES = { BTC: 'btc', ETH: 'eth', BNB: 'bnb', XRP: 'xrp', SOL: 'sol', TAO: 'tao', HYPE: 'hype', DOGE: 'doge' }
function coinMark(sym, image, size) {
  const tone = TONES[sym] || 'gen'
  const letter = sym === 'BTC' ? '₿' : esc(String(sym)[0])
  const style = size ? ` style="width:${size}px;height:${size}px"` : ''
  // the letter is a FALLBACK ONLY — hidden while the logo loads so it never
  // bleeds through a transparent PNG (ETH/SOL); onerror reveals it
  if (image) return `<span class="coin-mark ${tone}"${style}><em style="display:none">${letter}</em><img src="${esc(image)}" onerror="this.previousElementSibling.style.display='grid';this.remove()"/></span>`
  return `<span class="coin-mark ${tone}"${style}><em>${letter}</em></span>`
}
function changeBadge(v, suffix) {
  if (!isFinite(v)) return ''
  const up = v >= 0
  return `<span class="change ${up ? 'positive' : 'negative'}"><span>${up ? '↗' : '↘'}</span>${up ? '+' : ''}${v.toFixed(Math.abs(v) % 1 === 0 ? 0 : 2)}%${suffix || ''}</span>`
}

function buildHtml(d, period, dateLabel) {
  const title = { live: 'Market Overview', morning: 'Morning Update', midday: 'Midday Update', evening: 'Evening Update' }[period] || 'Market Overview'
  const fg = d.fg != null ? Math.round(d.fg) : null
  const fgColor = fg == null ? '#9299aa' : fg <= 25 ? '#ff5364' : fg <= 45 ? '#ff981f' : fg <= 55 ? '#e0b93a' : '#39d98a'
  // Alt Strength regime colouring — a low breadth score is BTC season (amber/red),
  // not a neutral "still low" green. Green only when alts genuinely lead.
  const as = d.altStrength
  const asColor = as == null ? '#9299aa' : as < 35 ? '#ff8a3d' : as < 55 ? '#e0b93a' : '#39d98a'
  const asRegime = as == null ? 'Alt breadth · 24h' : as < 35 ? 'Bitcoin season · alts weak' : as < 55 ? 'Mixed · no clean rotation' : 'Alt season · alts leading'
  const aiParas = analysis(d, period)
  const imgOf = (sym) => d.rows.find((r) => r.sym === sym)?.image

  const assetRows = d.rows.map((r) => `
    <article class="asset-row">
      <div class="asset-name">${coinMark(r.sym, r.image)}<div><strong>${esc(r.sym)}</strong><small>${esc(r.name)}</small></div></div>
      <strong class="asset-price">${price(r.price)}</strong>
      ${changeBadge(r.chg)}
      <div class="market-cap"><span>${usd(r.mcap)}</span>${sparkSvg(r.sym, r.chg, 62, 26)}</div>
    </article>`).join('')

  const share = [
    { sym: 'BTC', pct: d.btcD, tone: 'btc' }, { sym: 'ETH', pct: d.ethD, tone: 'eth' },
    { sym: 'SOL', pct: d.solD, tone: 'sol' }, { sym: 'ALTS', pct: d.altD, tone: 'alts' },
  ].filter((s) => s.pct != null)
  const shareItems = share.map((s) => `<div>${s.tone === 'alts' ? '<span class="coin-mark alts"><em>•</em></span>' : coinMark(s.sym, imgOf(s.sym), 27)}<strong>${s.pct.toFixed(0)}%</strong><small>${esc(s.sym)}</small></div>`).join('')
  const shareBar = share.map((s) => `<span class="segment ${s.tone}" style="width:${s.pct}%"></span>`).join('')

  const statCard = (iconHtml, label, value, changeHtml, spark) => `
    <section class="card stat-card">
      <div class="stat-icon-wrap">${iconHtml}</div>
      <div class="stat-copy"><span>${label}</span><div><strong>${value}</strong>${changeHtml || ''}</div></div>
      ${spark}
    </section>`

  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:Inter,ui-sans-serif,-apple-system,'Segoe UI',sans-serif}
    body{width:1680px;color:#f7f8fb}
    .dashboard{position:relative;width:1680px;padding:38px;color:#f7f8fb;
      background:radial-gradient(circle at 75% 88%,rgba(78,92,164,.26),transparent 30%),radial-gradient(circle at 4% 4%,rgba(85,77,144,.18),transparent 32%),linear-gradient(135deg,#06080e 0%,#020409 62%,#0b101c 100%)}
    .dashboard::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.34) .8px,transparent .8px);background-size:180px 180px;opacity:.16}
    .brand-header{position:relative;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:22px;margin-bottom:22px}
    .brand-lockup{display:flex;align-items:center;gap:15px;font-size:32px;font-weight:600;letter-spacing:-.035em}
    .brand-lockup img{width:62px;height:62px;border-radius:16px;object-fit:cover;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 16px 40px rgba(0,0,0,.38)}
    .page-title{text-align:center}
    .page-title h1{font-size:40px;font-weight:600;letter-spacing:-.045em}
    .page-title p{margin-top:5px;color:#8d91b0;font-size:16px}
    .date-pill{justify-self:end;display:flex;align-items:center;gap:9px;padding:12px 20px;border-radius:999px;color:#f4f5f9;font-size:15px;font-weight:500;border:1px solid rgba(150,160,192,.26);background:linear-gradient(180deg,rgba(25,30,43,.85),rgba(10,13,20,.92));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 28px rgba(128,105,255,.10)}
    .date-pill svg{width:16px;height:16px;color:#c5b8ff}
    .card{position:relative;border:1px solid rgba(165,178,222,.15);border-radius:22px;overflow:hidden;
      background:linear-gradient(158deg,rgba(32,38,56,.52),rgba(14,18,29,.62) 52%,rgba(8,11,19,.72));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 46px rgba(110,100,190,.035),0 30px 70px -24px rgba(0,0,0,.85);
      backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px)}
    .card::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:22px;background:linear-gradient(130deg,rgba(255,255,255,.06),transparent 42%)}
    .card::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);pointer-events:none}
    .classic-grid{display:grid;grid-template-columns:.94fr 1.44fr .94fr;gap:16px;align-items:stretch}
    .left-stack,.right-stack{display:grid;gap:15px}
    .left-stack{grid-template-rows:auto auto 1fr}
    .right-stack{grid-template-rows:auto repeat(4,1fr)}
    .score-card{padding:24px 26px 20px}
    .score-topline{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
    .score-topline>div{display:flex;align-items:center;gap:14px}
    .eyebrow-icon{display:grid;place-items:center;width:50px;height:50px;border-radius:15px;color:#cabcff;background:linear-gradient(158deg,rgba(150,124,255,.18),rgba(255,255,255,.03));border:1px solid rgba(155,124,255,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 6px 18px rgba(120,90,255,.16)}
    .eyebrow-icon svg{width:24px;height:24px}
    h2{font-size:23px;font-weight:600;letter-spacing:-.025em}
    .score-topline p,.analysis-title p{margin-top:4px;color:#929aad;font-size:14px}
    .score-topline strong{font-size:26px;color:#9299aa;padding:9px 13px;border-radius:13px;background:rgba(7,9,14,.48);box-shadow:inset 0 0 24px rgba(112,92,193,.08);white-space:nowrap}
    .score-topline strong span{font-size:39px}
    .sentiment-track{position:relative;height:11px;margin-top:24px;border-radius:999px;background:linear-gradient(90deg,#fa2746 0 25%,#ff9a20 25% 48%,#9dd835 48% 74%,#32bb73 74% 100%);box-shadow:inset 0 0 0 4px rgba(6,8,14,.45)}
    .sentiment-track i{position:absolute;top:50%;width:26px;height:26px;border:3px solid #fff;border-radius:50%;background:#11141b;transform:translate(-50%,-50%);box-shadow:0 3px 12px rgba(0,0,0,.5)}
    .alt-gauge{position:relative;height:11px;margin-top:24px;border-radius:999px;background:linear-gradient(90deg,#525a68 0 35%,#e0a63a 35% 55%,#32bb73 55% 100%);box-shadow:inset 0 0 0 4px rgba(6,8,14,.45)}
    .alt-gauge i{position:absolute;top:50%;width:26px;height:26px;border:3px solid #fff;border-radius:50%;background:#11141b;transform:translate(-50%,-50%);box-shadow:0 3px 12px rgba(0,0,0,.5)}
    .track-labels{display:flex;justify-content:space-between;margin-top:13px;color:#929aad;font-size:12px}
    .score-card.fear .track-labels span:first-child{color:#ff5967}
    .score-card.fear .track-labels span:last-child{color:#43d18c}
    .score-card.alt .track-labels span:first-child{color:#9aa2b0}
    .score-card.alt .track-labels span:last-child{color:#43d18c}
    .o2-block{margin-top:16px;padding-top:15px;border-top:1px solid rgba(255,255,255,.08)}
    .o2-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
    .o2-tag{font-size:11px;font-weight:700;letter-spacing:.05em;color:#9aa1b3;white-space:nowrap}
    .o2-score{font-size:15px;font-weight:700;color:#8d92a3}
    .o2-score span{font-size:21px;font-weight:800;color:#5ef0a8}
    .o2-track{height:8px;border-radius:6px;background:rgba(255,255,255,.07);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.4)}
    .o2-track span{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#39d98a,#9af114);box-shadow:0 0 12px rgba(57,217,138,.5)}
    .o2-sub{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:14px;color:#c9cdd8}
    .o2-sub b{font-weight:750;color:#fff;font-size:15.5px}
    .o2-sub .change{padding:4px 8px;font-size:12px}
    .analysis-card{padding:26px;border-color:rgba(150,114,255,.35);box-shadow:inset 0 -1px 0 rgba(145,113,255,.38),0 22px 80px rgba(0,0,0,.18)}
    .analysis-card::before{content:"";position:absolute;left:10%;right:10%;bottom:-1px;height:2px;background:linear-gradient(90deg,transparent,#855dff,transparent);filter:blur(1px)}
    .analysis-title{display:flex;gap:14px;align-items:center}
    .analysis-orb{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;color:#a983ff;background:radial-gradient(circle,rgba(127,84,255,.32),rgba(20,21,39,.25) 60%,transparent);box-shadow:0 0 24px rgba(127,84,255,.18)}
    .analysis-orb svg{width:24px;height:24px}
    .analysis-copy{margin-top:18px;color:#d4d7e0;line-height:1.5;font-size:15px}
    .analysis-copy p{margin-bottom:11px}.analysis-copy p:last-child{margin-bottom:0}
    .asset-panel{display:flex;flex-direction:column;padding:0;min-width:0}
    .macro-wire{margin-top:auto;display:flex;align-items:center;gap:15px;padding:18px 24px;border-top:1px solid rgba(255,255,255,.07);background:linear-gradient(180deg,rgba(150,114,255,.03),rgba(150,114,255,.09))}
    .wire-icon{flex:none;display:grid;place-items:center;width:42px;height:42px;border-radius:12px;color:#c4b5fd;background:linear-gradient(158deg,rgba(167,139,250,.18),rgba(167,139,250,.04));border:1px solid rgba(167,139,250,.18)}
    .wire-icon svg{width:22px;height:22px}
    .wire-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
    .wire-top{display:flex;align-items:center;gap:9px}
    .wire-label{font-size:11px;font-weight:800;letter-spacing:.1em;color:#a983ff}
    .wire-chip{font-size:10.5px;font-weight:700;letter-spacing:.05em;color:#cdd2de;padding:3px 9px;border-radius:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09)}
    .wire-text{font-size:16px;color:#f0f2f7;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wire-live{flex:none;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;color:#39d98a}
    .wire-live i{width:7px;height:7px;border-radius:50%;background:#39d98a;box-shadow:0 0 10px rgba(57,217,138,.9)}
    .asset-head,.asset-row{display:grid;grid-template-columns:minmax(176px,1.3fr) .82fr .9fr 1.32fr;align-items:center;gap:20px}
    .asset-head{padding:18px 26px;color:#a4a9b8;font-size:13px;border-bottom:1px solid rgba(255,255,255,.07)}
    .asset-head span:first-child{color:#f0f1f6}.asset-head span:nth-child(n+2){text-align:right}
    .asset-rows{display:grid}
    .asset-row{padding:13.5px 26px;border-bottom:1px solid rgba(255,255,255,.06)}
    .asset-row:last-child{border-bottom:0}
    .asset-name{display:flex;align-items:center;gap:13px}
    .asset-name div{display:flex;flex-direction:column;min-width:0}
    .asset-name strong{font-size:19px;letter-spacing:-.02em}
    .asset-name small{color:#a6adbf;margin-top:2px;font-size:13px}
    /* FLAT dark base — a radial/inner-highlight showed a lighter disc THROUGH
       transparent logos (founder: something hides behind the logos). Flat solid
       so a transparent PNG (ETH/SOL) sits on a uniform circle. */
    .coin-mark{position:relative;flex:none;display:inline-grid;place-items:center;width:43px;height:43px;border-radius:50%;font-size:17px;font-weight:750;color:#e8eaf0;background:#0e121b;box-shadow:0 2px 6px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08);overflow:hidden}
    .coin-mark em{font-style:normal;position:absolute;inset:0;display:grid;place-items:center;z-index:1}
    .coin-mark img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2}
    /* crisp ring above the logo so every mark shares one consistent frame */
    .coin-mark::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);z-index:3;pointer-events:none}
    .coin-mark.alts{background:linear-gradient(158deg,rgba(154,241,20,.16),rgba(255,255,255,.03));border:1px solid rgba(154,241,20,.22);color:#9af114;font-size:15px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
    .coin-mark.alts::after{box-shadow:none}
    .asset-price{text-align:right;font-size:18px;font-weight:540}
    .change{display:inline-flex;justify-self:end;align-items:center;gap:5px;padding:7px 10px;border-radius:10px;font-size:13px;font-weight:500;white-space:nowrap}
    .change.positive{color:#42d889;background:rgba(14,83,50,.48)}
    .change.negative{color:#ff5b66;background:rgba(93,25,32,.48)}
    .market-cap{display:flex;justify-self:end;align-items:center;gap:14px;min-width:0}
    .market-cap>span{min-width:58px;text-align:right;font-size:15px;color:#e4e6ec;white-space:nowrap}
    .mini-chart{overflow:visible}
    .market-share-card{padding:24px}
    .section-kicker{display:flex;align-items:center;gap:10px;color:#d7dae3;font-size:16px;font-weight:600}
    .donut{width:22px;height:22px;border-radius:50%;background:conic-gradient(#ff981f 0 59%,#6b80e5 59% 71%,#d71ebf 71% 73%,#9af114 73% 100%);box-shadow:inset 0 0 0 7px #0a0d14}
    .share-items{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:22px}
    .share-items>div{display:grid;justify-items:center;gap:5px}
    .share-items strong{font-size:26px;letter-spacing:-.02em}
    .share-items small{color:#a1a8b9;font-size:13px}
    .share-bar{display:flex;height:13px;margin-top:22px;border-radius:999px;overflow:hidden;background:#151925;box-shadow:inset 0 0 0 3px rgba(0,0,0,.25)}
    .segment.btc{background:#ff981f}.segment.eth{background:#6b80e5}.segment.sol{background:#d71ebf}.segment.alts{background:#9af114}
    .stat-card{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;padding:18px 22px}
    .stat-icon-wrap{position:relative;display:grid;place-items:center;width:54px;height:54px;border-radius:15px;color:#cabcff;overflow:hidden;background:linear-gradient(158deg,rgba(120,102,255,.2),rgba(255,255,255,.03));border:1px solid rgba(160,146,255,.24);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 6px 20px rgba(120,102,255,.18)}
    .stat-icon-wrap svg{width:24px;height:24px}
    .stat-icon-wrap .coin-mark{width:44px;height:44px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
    .stat-icon.globe{color:#8fa4ff}
    .stat-copy>span{color:#aab0bf;font-size:15px}
    .stat-copy>div{display:flex;align-items:center;gap:12px;margin-top:7px}
    .stat-copy strong{font-size:27px;letter-spacing:-.02em}
    .stat-card>.mini-chart{width:100px;height:34px}
  </style></head>
  <body><main class="dashboard classic-dashboard">
    <header class="brand-header">
      <div class="brand-lockup"><img src="${spectreLogo()}"/><span>Spectre AI</span></div>
      <div class="page-title"><h1>${title}</h1><p>Real-time crypto market intelligence</p></div>
      <div class="date-pill">${ICONS.calendar}${esc(dateLabel)}</div>
    </header>
    <div class="classic-grid">
      <div class="left-stack">
        <section class="card score-card fear">
          <div class="score-topline"><div><span class="eyebrow-icon">${ICONS.gauge}</span><div><h2>Fear &amp; Greed</h2><p>Market Sentiment Index</p></div></div><strong><span style="color:${fgColor}">${fg ?? '—'}</span>/100</strong></div>
          <div class="sentiment-track"><i style="left:${fg ?? 50}%"></i></div>
          <div class="track-labels"><span>Extreme Fear</span><span>Neutral</span><span>Extreme Greed</span></div>
        </section>
        <section class="card score-card alt">
          <div class="score-topline"><div><span class="eyebrow-icon">${ICONS.bars}</span><div><h2>Alt Strength</h2><p>${asRegime}</p></div></div><strong><span style="color:${asColor}">${as ?? '—'}</span>/100</strong></div>
          <div class="alt-gauge"><i style="left:${as ?? 0}%"></i></div>
          <div class="track-labels"><span>Bitcoin Season</span><span>Mixed</span><span>Alt Season</span></div>
          ${d.others2 ? `<div class="o2-block"><div class="o2-head"><span class="o2-tag">OTHERS2 · alt long tail (ex-top 100)</span><strong class="o2-score" style="font-size:13px;color:#c9cdd8"><b style="color:#fff;font-size:18px;font-weight:800">${usd(d.others2)}</b></strong></div><div class="o2-sub">${d.others2Share != null ? d.others2Share.toFixed(1) + '% of total' : ''}${d.others2Chg != null ? changeBadge(d.others2Chg) : ''} · <span style="color:${asColor};font-weight:700">${d.beatBtcPct != null ? Math.round(d.beatBtcPct) : '—'}% beating BTC</span></div></div>` : ''}
        </section>
        <section class="card analysis-card">
          <div class="analysis-title"><span class="analysis-orb">${ICONS.sparkle}</span><div><h2>AI Analysis</h2><p>Spectre market insight</p></div></div>
          <div class="analysis-copy">${aiParas.map((p) => `<p>${p}</p>`).join('')}</div>
        </section>
      </div>
      <section class="card asset-panel">
        <div class="asset-head"><span>Top Assets</span><span>Price</span><span>24h Change</span><span>Market Cap</span></div>
        <div class="asset-rows">${assetRows}</div>
        ${d.macro ? `<div class="macro-wire"><span class="wire-icon">${ICONS.wire}</span><div class="wire-body"><div class="wire-top"><span class="wire-label">MACRO WIRE</span><span class="wire-chip">${esc(d.macro.tag)}</span></div><span class="wire-text">${esc(d.macro.text)}</span></div><span class="wire-live"><i></i>LIVE</span></div>` : ''}
      </section>
      <div class="right-stack">
        <section class="card market-share-card">
          <div class="section-kicker"><span class="donut"></span>Market Share</div>
          <div class="share-items">${shareItems}</div>
          <div class="share-bar">${shareBar}</div>
        </section>
        ${statCard(`<span class="stat-icon globe">${ICONS.globe}</span>`, 'Total Market Cap', usd(d.total), changeBadge(d.mcapChg), sparkSvg('mcap', d.mcapChg, 100, 34))}
        ${statCard(`<span class="stat-icon">${ICONS.vol}</span>`, 'Market Volume 24h', usd(d.vol), d.turnover != null ? `<span class="change ${d.turnover >= 4 ? 'positive' : 'negative'}">${d.turnover.toFixed(1)}% turn</span>` : '', sparkSvg('vol', d.turnover >= 4 ? 1 : -1, 100, 34, '#ef565e'))}
        ${statCard(imgOf('BTC') ? `<span class="coin-mark btc"><img src="${esc(imgOf('BTC'))}"/></span>` : `<span class="stat-icon">${ICONS.btc}</span>`, 'BTC Dominance', d.btcD != null ? d.btcD.toFixed(1) + '%' : '—', '', sparkSvg('btcd', 0.3, 100, 34, '#ff981f'))}
        ${statCard(imgOf('ETH') ? `<span class="coin-mark eth"><img src="${esc(imgOf('ETH'))}"/></span>` : `<span class="stat-icon">${ICONS.eth}</span>`, 'ETH Dominance', d.ethD != null ? d.ethD.toFixed(2) + '%' : '—', '', sparkSvg('ethd', 0.15, 100, 34, '#9ea5b5'))}
      </div>
    </div>
  </main></body></html>`
}

const COIN_COLORS = { BTC: '#f7931a', ETH: '#627eea', BNB: '#f0b90b', XRP: '#23292f', SOL: '#14f195', TAO: '#4a4a4a', HYPE: '#0f9e8e', DOGE: '#c2a633' }
const coinColor = (s) => COIN_COLORS[s] || '#7c3aed'

function fmtChg(v) {
  return isFinite(v) ? `${v >= 0 ? '▲ +' : '▼ '}${v.toFixed(1)}%` : ''
}
function composeCaption(d, period) {
  const meta = {
    morning: ['🌅', 'Morning Update'], midday: ['☀️', 'Midday Update'],
    evening: ['🌆', 'Evening Update'], live: ['🌐', 'Market Overview'], analysis: ['🌐', 'Market Overview'],
  }[period] || ['🌐', 'Market Overview']
  const btc = d.rows.find((r) => r.sym === 'BTC')
  const bits = []
  if (btc?.price) bits.push(`BTC ${price(btc.price)} ${fmtChg(btc.chg)}`)
  if (d.fg != null) bits.push(`F&amp;G ${Math.round(d.fg)} ${esc(d.fgClass)}`)
  if (d.altStrength != null) bits.push(`Alt strength ${d.altStrength}`)
  return [`${meta[0]} <b>${meta[1]}</b>`, bits.join(' · '), '<i>⌁ Spectre Intelligence · Market Overview</i>'].filter(Boolean).join('\n')
}

// { png, caption } for a variant: analysis(=live) | morning | midday | evening
async function overviewCard(variant = 'analysis') {
  const period = variant === 'analysis' ? 'live' : variant
  const d = await gather()
  if (!d.rows.length) throw new Error('market data cold')
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  const html = buildHtml(d, period, dateLabel)
  const png = await shot.renderHtml(html, { width: 1680, height: 1080, selector: '.dashboard' })
  if (!png) throw new Error('render failed')
  return { png, caption: composeCaption(d, period) }
}

// Scheduled daily cards: morning 07:00 · midday 12:00 · evening 18:00 UTC, to
// every chat that opted in via /overview auto on. Fires once per slot per day.
function startOverviewScheduler(bot) {
  const SLOTS = { 7: 'morning', 12: 'midday', 18: 'evening' }
  const lastFired = {}
  setInterval(async () => {
    const now = new Date()
    const period = SLOTS[now.getUTCHours()]
    if (!period || now.getUTCMinutes() >= 8) return // early in the slot hour only
    const day = now.toISOString().slice(0, 10)
    if (lastFired[period] === day) return
    lastFired[period] = day
    const chats = store.overviewChatsForSlot(period)
    if (!chats.length) return
    let card
    try { card = await overviewCard(period) } catch (e) { console.error('[overview] render', e.message); return }
    for (const chatId of chats) {
      try {
        await bot.api.sendPhoto(chatId, new InputFile(card.png, `overview-${period}.png`), { caption: card.caption, parse_mode: 'HTML' })
      } catch (e) {
        const desc = String(e.description || e.message || '')
        if (/blocked|kicked|chat not found|deactivated/i.test(desc)) store.setOverviewAuto(chatId, false)
      }
      await new Promise((r) => setTimeout(r, 350))
    }
    console.log(`[overview] ${period} sent to ${chats.length} chat(s)`)
  }, 60e3)
}

// /others — the OTHERS2 read (alt long tail): MC, dominance, TOTAL/2/3 context
async function othersCard() {
  const d = await gather()
  if (!d.total || !d.others2) return '📊 OTHERS2 data is warming up — try again shortly.'
  const btc = d.rows.find((r) => r.sym === 'BTC')
  const eth = d.rows.find((r) => r.sym === 'ETH')
  const total2 = btc?.mcap ? d.total - btc.mcap : null
  const total3 = btc?.mcap && eth?.mcap ? d.total - btc.mcap - eth.mcap : null
  const chg = d.others2Chg != null ? ` · ${d.others2Chg >= 0 ? '▲ +' : '▼ '}${Math.abs(d.others2Chg).toFixed(1)}% 24h` : ''
  const as = d.altStrength
  const bp = d.beatBtcPct != null ? Math.round(d.beatBtcPct) : null
  const regime = as == null ? '' : as < 35 ? 'BTC season · alts weak' : as < 55 ? 'mixed · no rotation' : 'alt season · alts leading'
  const lines = [
    '📊 <b>OTHERS2</b> — the alt long tail (ex-top 100)',
    `▸ <b>Market cap</b> <code>${usd(d.others2)}</code>${chg}`,
    `▸ <b>Dominance</b> <code>${d.others2Share.toFixed(1)}%</code> of total`,
  ]
  if (as != null) lines.push(`▸ <b>Alt strength</b> <code>${as}/100</code> — ${regime}${bp != null ? ` (${bp}% of alts beating BTC)` : ''}`)
  const ctx = [`TOTAL <code>${usd(d.total)}</code>`]
  if (total2) ctx.push(`TOTAL2 <code>${usd(total2)}</code>`)
  if (total3) ctx.push(`TOTAL3 <code>${usd(total3)}</code>`)
  lines.push(`▸ ${ctx.join(' · ')}`)
  const share = d.others2Share
  let read
  if (as != null && as < 35) read = `The long tail is in a <b>bear market</b>. Only ${bp}% of alts are outpacing BTC${d.medianAlt != null && d.medianAlt < 0 ? `, the median alt is red (${d.medianAlt.toFixed(1)}%)` : ''}, and OTHERS2 mcap sits far below its 2024/25 highs — microcaps are dead here. Dominance (${share.toFixed(1)}%) can look "mid-pack" while breadth is broken; breadth is the honest signal, and it says majors are the trade until it turns.`
  else if (d.others2Chg != null && d.others2Chg > 1.5) read = `The alt long tail is <b>expanding</b> (+${d.others2Chg.toFixed(1)}% in 24h) and ${bp}% of alts are beating BTC — real capital rotating down the curve into small and mid caps. This is what a genuine alt-season looks like on the tape.`
  else if (d.others2Chg != null && d.others2Chg < -1.5) read = `The alt long tail is <b>contracting</b> (${d.others2Chg.toFixed(1)}% in 24h) — money leaving small caps and consolidating up into the majors. Risk-off within crypto.`
  else read = `OTHERS2 is every token outside the top 100 — the honest alt gauge. Alt strength ${as ?? '—'}/100 (${bp ?? '—'}% beating BTC) says breadth is ${as != null && as < 55 ? 'still with the majors' : 'turning toward alts'}. Dominance ${share.toFixed(1)}% is size, not health — watch breadth and the 24h share trend for the real rotation call.`
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · OTHERS2</i>')
  return lines.join('\n')
}

// ── /others as a DESIGNED card (glass, matches the overview aesthetic) ───────
function othersRead(d) {
  const as = d.altStrength
  const bp = d.beatBtcPct != null ? Math.round(d.beatBtcPct) : null
  const share = d.others2Share
  if (as != null && as < 35) return `The long tail is in a <b>bear market</b>. Only ${bp}% of alts are outpacing BTC${d.medianAlt != null && d.medianAlt < 0 ? `, the median alt is red (${d.medianAlt.toFixed(1)}%)` : ''}, and OTHERS2 sits far below its 2024/25 highs — microcaps are dead here. Dominance (${share != null ? share.toFixed(1) : '—'}%) is size, not health; breadth is the honest signal, and it says majors are the trade until it turns.`
  if (d.others2Chg != null && d.others2Chg > 1.5) return `The alt long tail is <b>expanding</b> (+${d.others2Chg.toFixed(1)}% in 24h) and ${bp}% of alts are beating BTC — real capital rotating down the curve into small and mid caps. This is what a genuine alt-season looks like on the tape.`
  if (d.others2Chg != null && d.others2Chg < -1.5) return `The alt long tail is <b>contracting</b> (${d.others2Chg.toFixed(1)}% in 24h) — money leaving small caps up into the majors. Risk-off within crypto.`
  return `OTHERS2 is every token outside the top 100 — the honest alt gauge. Breadth is ${as != null && as < 55 ? 'still with the majors' : 'turning toward alts'} (${bp ?? '—'}% beating BTC). Dominance ${share != null ? share.toFixed(1) : '—'}% is size, not health — watch breadth and the 24h share trend for the rotation call.`
}

function buildOthersHtml(d) {
  const btc = d.rows.find((r) => r.sym === 'BTC')
  const eth = d.rows.find((r) => r.sym === 'ETH')
  const total2 = btc?.mcap ? d.total - btc.mcap : null
  const total3 = btc?.mcap && eth?.mcap ? d.total - btc.mcap - eth.mcap : null
  const as = d.altStrength
  const asColor = as == null ? '#9299aa' : as < 35 ? '#ff8a3d' : as < 55 ? '#e0b93a' : '#39d98a'
  const asRegime = as == null ? 'Alt breadth · 24h' : as < 35 ? 'Bitcoin season · alts weak' : as < 55 ? 'Mixed · no clean rotation' : 'Alt season · alts leading'
  const bp = d.beatBtcPct != null ? Math.round(d.beatBtcPct) : null
  const gp = d.greenPct != null ? Math.round(d.greenPct) : null
  const med = d.medianAlt
  const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })

  const statChip = (num, color, label) => `<div class="o2c-chip"><strong style="color:${color || '#f4f6fb'}">${num}</strong><span>${label}</span></div>`
  const totalChip = (lbl, val) => `<div class="o2c-total"><span>${lbl}</span><b>${usd(val)}</b></div>`

  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:Inter,ui-sans-serif,-apple-system,'Segoe UI',sans-serif}
    body{width:1180px;color:#f7f8fb}
    .dashboard{position:relative;width:1180px;padding:40px;color:#f7f8fb;
      background:radial-gradient(circle at 78% 90%,rgba(78,92,164,.26),transparent 32%),radial-gradient(circle at 3% 3%,rgba(85,77,144,.18),transparent 34%),linear-gradient(135deg,#06080e 0%,#020409 62%,#0b101c 100%)}
    .dashboard::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.34) .8px,transparent .8px);background-size:170px 170px;opacity:.15}
    .o2c-head{position:relative;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin-bottom:24px}
    .o2c-brand{display:flex;align-items:center;gap:14px;font-size:27px;font-weight:600;letter-spacing:-.03em}
    .o2c-brand img{width:56px;height:56px;border-radius:15px;object-fit:cover;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 14px 34px rgba(0,0,0,.4)}
    .o2c-title{text-align:center}
    .o2c-title h1{font-size:38px;font-weight:700;letter-spacing:-.04em}
    .o2c-title h1 b{color:#9af114;font-weight:800}
    .o2c-title p{margin-top:4px;color:#8d91b0;font-size:15px}
    .o2c-live{justify-self:end;display:flex;align-items:center;gap:8px;padding:11px 18px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.06em;color:#39d98a;border:1px solid rgba(57,217,138,.28);background:linear-gradient(180deg,rgba(25,30,43,.85),rgba(10,13,20,.92))}
    .o2c-live i{width:8px;height:8px;border-radius:50%;background:#39d98a;box-shadow:0 0 10px rgba(57,217,138,.9)}
    .card{position:relative;border:1px solid rgba(165,178,222,.15);border-radius:22px;overflow:hidden;
      background:linear-gradient(158deg,rgba(32,38,56,.52),rgba(14,18,29,.62) 52%,rgba(8,11,19,.72));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 46px rgba(110,100,190,.035),0 30px 70px -24px rgba(0,0,0,.85);
      backdrop-filter:blur(26px)}
    .card::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent)}
    .o2c-hero{display:grid;grid-template-columns:1fr 1.15fr;gap:34px;padding:30px 34px;margin-bottom:16px}
    .o2c-eyebrow{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#9aa1b3}
    .o2c-val{font-size:64px;font-weight:800;letter-spacing:-.03em;line-height:1;margin:12px 0 12px}
    .o2c-share{display:inline-flex;align-items:center;gap:10px;font-size:16px;color:#c9cdd8}
    .o2c-share b{color:#fff;font-weight:750}
    .o2c-hero-r{display:flex;flex-direction:column;justify-content:center;border-left:1px solid rgba(255,255,255,.08);padding-left:34px}
    .o2c-gtop{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px}
    .o2c-gtop span{font-size:15px;font-weight:600;color:#c2c7d4}
    .o2c-gtop strong{font-size:34px;font-weight:800;letter-spacing:-.02em}
    .o2c-gtop strong b{font-size:16px;font-weight:600;opacity:.5}
    .alt-gauge{position:relative;height:12px;border-radius:999px;background:linear-gradient(90deg,#525a68 0 35%,#e0a63a 35% 55%,#32bb73 55% 100%);box-shadow:inset 0 0 0 4px rgba(6,8,14,.45)}
    .alt-gauge i{position:absolute;top:50%;width:26px;height:26px;border:3px solid #fff;border-radius:50%;background:#11141b;transform:translate(-50%,-50%);box-shadow:0 3px 12px rgba(0,0,0,.5)}
    .o2c-glabels{display:flex;justify-content:space-between;margin-top:12px;font-size:12px;color:#929aad}
    .o2c-glabels span:first-child{color:#9aa2b0}.o2c-glabels span:last-child{color:#43d18c}
    .o2c-regime{margin-top:13px;font-size:15px;font-weight:700}
    .o2c-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px}
    .o2c-chip{padding:20px 24px;border-radius:18px;border:1px solid rgba(165,178,222,.13);background:linear-gradient(158deg,rgba(30,36,52,.5),rgba(12,16,26,.6));display:flex;flex-direction:column;gap:6px}
    .o2c-chip strong{font-size:30px;font-weight:800;letter-spacing:-.02em}
    .o2c-chip span{font-size:12.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9aa1b3}
    .o2c-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px}
    .o2c-total{padding:16px 22px;border-radius:16px;border:1px solid rgba(165,178,222,.1);background:rgba(10,13,21,.4);display:flex;flex-direction:column;gap:5px}
    .o2c-total span{font-size:12px;font-weight:700;letter-spacing:.06em;color:#8f97ab}
    .o2c-total b{font-size:22px;font-weight:750;letter-spacing:-.02em}
    .o2c-read{padding:26px 30px;border-color:rgba(150,114,255,.32)}
    .o2c-read::after{content:"";position:absolute;left:10%;right:10%;bottom:-1px;height:2px;background:linear-gradient(90deg,transparent,#855dff,transparent);filter:blur(1px)}
    .o2c-read-head{display:flex;align-items:center;gap:14px;margin-bottom:15px}
    .o2c-orb{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;color:#a983ff;background:radial-gradient(circle,rgba(127,84,255,.32),rgba(20,21,39,.25) 60%,transparent);box-shadow:0 0 24px rgba(127,84,255,.18)}
    .o2c-orb svg{width:23px;height:23px}
    .o2c-read-head h2{font-size:21px;font-weight:600;letter-spacing:-.02em}
    .o2c-read-head p{margin-top:3px;color:#929aad;font-size:13px}
    .o2c-read p.body{font-size:17px;line-height:1.55;color:#d9dce4}
    .o2c-read p.body b{color:#fff;font-weight:700}
    .o2c-foot{margin-top:20px;text-align:center;color:#7f849b;font-size:13px;font-style:italic;letter-spacing:.02em}
    .change{display:inline-flex;align-items:center;gap:3px;padding:5px 10px;border-radius:9px;font-size:14px;font-weight:700}
    .change.positive{color:#39d98a;background:rgba(57,217,138,.12)}
    .change.negative{color:#ff6b73;background:rgba(255,107,115,.12)}
  </style></head>
  <body><div class="dashboard">
    <div class="o2c-head">
      <div class="o2c-brand"><img src="${spectreLogo()}"/>Spectre AI</div>
      <div class="o2c-title"><h1>OTHERS<b>2</b></h1><p>The alt long tail · ex-top 100</p></div>
      <div class="o2c-live"><i></i>LIVE · ${esc(now)}</div>
    </div>
    <section class="card o2c-hero">
      <div class="o2c-hero-l">
        <div class="o2c-eyebrow">Market cap · alt long tail</div>
        <div class="o2c-val">${usd(d.others2)}</div>
        <div class="o2c-share"><b>${d.others2Share != null ? d.others2Share.toFixed(1) : '—'}%</b> of total${d.others2Chg != null ? changeBadge(d.others2Chg, ' 24h') : ''}</div>
      </div>
      <div class="o2c-hero-r">
        <div class="o2c-gtop"><span>Alt Strength · breadth</span><strong style="color:${asColor}">${as ?? '—'}<b>/100</b></strong></div>
        <div class="alt-gauge"><i style="left:${as ?? 0}%"></i></div>
        <div class="o2c-glabels"><span>Bitcoin Season</span><span>Mixed</span><span>Alt Season</span></div>
        <div class="o2c-regime" style="color:${asColor}">${asRegime}</div>
      </div>
    </section>
    <div class="o2c-stats">
      ${statChip(bp != null ? bp + '%' : '—', asColor, 'Alts beating BTC')}
      ${statChip(gp != null ? gp + '%' : '—', null, 'Green · 24h')}
      ${statChip(med != null ? `${med >= 0 ? '+' : ''}${med.toFixed(1)}%` : '—', med != null ? (med >= 0 ? '#39d98a' : '#ff8a6a') : null, 'Median alt · 24h')}
    </div>
    <div class="o2c-totals">
      ${totalChip('TOTAL', d.total)}
      ${totalChip('TOTAL2 · ex-BTC', total2)}
      ${totalChip('TOTAL3 · ex-BTC+ETH', total3)}
    </div>
    <section class="card o2c-read">
      <div class="o2c-read-head"><span class="o2c-orb">${ICONS.sparkle}</span><div><h2>The Read</h2><p>OTHERS2 intelligence · zero-hype</p></div></div>
      <p class="body">${othersRead(d)}</p>
    </section>
    <div class="o2c-foot">⌁ Spectre Intelligence · OTHERS2 = total market cap − the top 100</div>
  </div></body></html>`
}

async function othersCardImage() {
  const d = await gather()
  if (!d.total || !d.others2) return null
  const html = buildOthersHtml(d)
  const png = await shot.renderHtml(html, { width: 1180, selector: '.dashboard' })
  if (!png) return null
  const as = d.altStrength
  const regime = as == null ? '' : as < 35 ? 'Bitcoin season · alts weak' : as < 55 ? 'Mixed' : 'Alt season'
  const caption = [
    '📊 <b>OTHERS2</b> — the alt long tail (ex-top 100)',
    `${usd(d.others2)} · ${d.others2Share != null ? d.others2Share.toFixed(1) + '% of total' : ''}${as != null ? ` · Alt strength ${as}/100 ${regime}` : ''}`,
    '<i>⌁ Spectre Intelligence · OTHERS2</i>',
  ].filter(Boolean).join('\n')
  return { png, caption }
}

module.exports = { overviewCard, startOverviewScheduler, gather, othersCard, othersCardImage }
