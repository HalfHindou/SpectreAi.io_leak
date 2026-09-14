// Alpha cards — the 2026-07-20 idea-pack renderers (founder: "ui ux has to be
// immaculate pristine with gradients"). Same glassmorphic HTML→headless-Chrome
// pipeline as market-overview.js; every card is a self-contained buildHtml +
// a render fn returning a PNG buffer. Data is passed IN (route-agnostic) so
// the sample harness and the future commands share one renderer.
const fs = require('fs')
const path = require('path')
const shot = require('./app-shot')

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function usd(n) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}$${a.toFixed(2)}`
}
function price(n) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (a >= 1) return '$' + n.toFixed(2)
  const d = Math.max(2, 3 - Math.floor(Math.log10(a || 1)))
  return '$' + n.toFixed(Math.min(d, 8))
}
const pctChip = (v, size = 15) => {
  if (v == null || !isFinite(v)) return ''
  const up = v >= 0
  return `<span class="chip ${up ? 'up' : 'down'}" style="font-size:${size}px">${up ? '▲' : '▼'} ${up ? '+' : ''}${v.toFixed(1)}%</span>`
}
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')
const ago = (ts) => {
  const h = (Date.now() - new Date(ts).getTime()) / 3600e3
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

let _logo = null
function logoUri() {
  if (_logo !== null) return _logo
  try { _logo = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../assets/spectre-logo.png')).toString('base64')}` }
  catch { _logo = '' }
  return _logo
}

// Shared shell: bg gradients + starfield + glass cards + brand header/footer.
const BASE_CSS = `
  *{box-sizing:border-box;margin:0;padding:0;font-family:Inter,ui-sans-serif,-apple-system,'Segoe UI',sans-serif}
  body{width:1440px;color:#f7f8fb;background:#04060b}
  .stage{position:relative;width:1440px;min-height:100%;padding:40px 44px;color:#f7f8fb;overflow:hidden;
    background:radial-gradient(circle at 78% 90%,rgba(78,92,164,.26),transparent 32%),radial-gradient(circle at 4% 2%,rgba(85,77,144,.20),transparent 34%),linear-gradient(135deg,#06080e 0%,#020409 60%,#0b101c 100%)}
  .stage::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.34) .8px,transparent .8px);background-size:170px 170px;opacity:.15}
  .stage.accent-green{background:radial-gradient(circle at 82% 12%,rgba(46,189,133,.16),transparent 34%),radial-gradient(circle at 6% 90%,rgba(85,77,144,.18),transparent 34%),linear-gradient(135deg,#06080e 0%,#020409 60%,#081410 100%)}
  .stage.accent-gold{background:radial-gradient(circle at 82% 10%,rgba(224,166,58,.15),transparent 34%),radial-gradient(circle at 6% 92%,rgba(85,77,144,.18),transparent 34%),linear-gradient(135deg,#06080e 0%,#020409 60%,#14100a 100%)}
  header{position:relative;display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
  .lockup{display:flex;align-items:center;gap:14px}
  .lockup img{width:54px;height:54px;border-radius:14px;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 14px 34px rgba(0,0,0,.4)}
  .lockup .t h1{font-size:30px;font-weight:700;letter-spacing:-.03em}
  .lockup .t h1 em{font-style:normal;background:linear-gradient(92deg,#c8bcff 0%,#8f7dff 55%,#6aa2f7 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .lockup .t p{margin-top:3px;color:#8d91b0;font-size:14.5px;font-weight:500}
  .pill{display:flex;align-items:center;gap:8px;padding:11px 19px;border-radius:999px;font-size:14px;font-weight:600;color:#f4f5f9;
    border:1px solid rgba(150,160,192,.26);background:linear-gradient(180deg,rgba(25,30,43,.85),rgba(10,13,20,.92));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 26px rgba(128,105,255,.10)}
  .pill i{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#8f7dff,#6aa2f7);box-shadow:0 0 10px rgba(143,125,255,.8)}
  .card{position:relative;border-radius:22px;padding:24px 26px;border:1px solid rgba(150,160,192,.17);
    background:linear-gradient(158deg,rgba(32,38,56,.52),rgba(14,18,29,.62) 52%,rgba(8,11,19,.72));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 22px 48px rgba(0,0,0,.36)}
  .card::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;border-radius:22px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.20),transparent);pointer-events:none}
  .kicker{display:flex;align-items:center;gap:10px;color:#a9aec7;font-size:14px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
  .kicker::before{content:"";width:22px;height:2px;border-radius:2px;background:linear-gradient(90deg,#8f7dff,#6aa2f7)}
  .chip{display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:10px;font-weight:600;white-space:nowrap}
  .chip.up{color:#42d889;background:linear-gradient(180deg,rgba(24,94,58,.55),rgba(14,58,38,.45));box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
  .chip.down{color:#ff5b66;background:linear-gradient(180deg,rgba(104,26,34,.55),rgba(64,18,24,.45));box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
  .meter{position:relative;height:12px;border-radius:999px;background:rgba(9,12,19,.85);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);overflow:hidden}
  .meter b{position:absolute;inset:0 auto 0 0;border-radius:999px}
  footer{position:relative;display:flex;align-items:center;justify-content:space-between;margin-top:26px;color:#6f7490;font-size:13.5px;font-weight:500}
  footer .wm{letter-spacing:.06em}
  .num{font-variant-numeric:tabular-nums}
`

function shell({ accent = '', title, subtitle, pillText, body, footNote }) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${BASE_CSS}</style></head><body>
  <div class="stage ${accent}">
    <header>
      <div class="lockup"><img src="${logoUri()}"/><div class="t"><h1>${title}</h1><p>${esc(subtitle)}</p></div></div>
      <div class="pill"><i></i>${esc(pillText)}</div>
    </header>
    ${body}
    <footer><span class="wm">⌁ Spectre Intelligence</span><span>${esc(footNote || 'app.spectreai.io')}</span></footer>
  </div></body></html>`
}

// ── 1. SMART DESKS — Hyperliquid top-PnL cohort positioning ────────────────

function smartDesksHtml(d) {
  const t = d.totals || {}
  const gross = (t.longUsd || 0) + (t.shortUsd || 0)
  const longPct = gross > 0 ? ((t.longUsd || 0) / gross) * 100 : 50
  const netShort = (t.shortUsd || 0) > (t.longUsd || 0)
  const skew = (d.skew || []).slice(0, 6)
  // Top DESK rows (accountValue/pnlDay) verified CORRUPT against live HL
  // 2026-07-20 ("$13.5B desk" = $10K account) — worker-hl-smart-desks
  // leaderboard parse bug. The POSITION rows verified exact vs live
  // clearinghouseState, so the strip shows largest live positions instead.
  // Same-position echoes: master + sub-account wallets carry one position
  // twice (identical coin/side/value/uPnL, different address) — one row each.
  const seenPos = []
  const bigPos = (d.positions || [])
    .slice()
    .sort((x, y) => (y.valueUsd || 0) - (x.valueUsd || 0))
    .filter((p) => {
      const dup = seenPos.some((q) => q.coin === p.coin && q.side === p.side
        && Math.abs((q.valueUsd || 0) - (p.valueUsd || 0)) < (q.valueUsd || 1) * 0.02
        && Math.abs((q.uPnl || 0) - (p.uPnl || 0)) < Math.max(1, Math.abs(q.uPnl || 1)) * 0.05)
      if (!dup) seenPos.push(p)
      return !dup
    })
    .slice(0, 3)

  const skewRows = skew.map((s) => {
    const tot = (s.longUsd || 0) + (s.shortUsd || 0)
    const lp = tot > 0 ? ((s.longUsd || 0) / tot) * 100 : 50
    const net = s.netUsd || 0
    const netLong = net >= 0
    return `<div class="srow">
      <strong class="coin">${esc(s.coin)}</strong>
      <div class="meter big"><b style="width:${lp.toFixed(1)}%;background:linear-gradient(90deg,#1f8a5c,#42d889)"></b><b style="left:auto;right:0;width:${(100 - lp).toFixed(1)}%;background:linear-gradient(90deg,#ff5b66,#8f2731)"></b></div>
      <span class="net num ${netLong ? 'g' : 'r'}">${netLong ? '+' : '−'}${usd(Math.abs(net)).replace('$', '$')} ${netLong ? 'LONG' : 'SHORT'}</span>
      <span class="split num">${s.longDesks ?? 0}L · ${s.shortDesks ?? 0}S</span>
    </div>`
  }).join('')

  const deskCells = bigPos.map((p) => {
    const lev = typeof p.leverage === 'number' ? p.leverage : p.leverage?.value
    const long = String(p.side).toLowerCase() === 'long'
    return `
    <div class="desk">
      <span class="rank ${long ? 'rl' : 'rs'}">${long ? 'L' : 'S'}</span>
      <div><strong class="num">${esc(p.coin)} ${long ? 'long' : 'short'} · ${usd(p.valueUsd)}</strong>
        <small>${shortAddr(p.address)} · desk worth ${usd(p.accountValue)}${lev ? ` · ${lev}x` : ''}</small></div>
      <span class="dpnl num ${(p.uPnl || 0) >= 0 ? 'g' : 'r'}">${(p.uPnl || 0) >= 0 ? '+' : '−'}${usd(Math.abs(p.uPnl || 0))} uPnL</span>
    </div>`
  }).join('')

  const body = `<style>
    .hero{display:grid;grid-template-columns:1fr 320px;gap:20px;margin-bottom:20px}
    .hero .card{padding:28px 30px}
    .bias{display:flex;align-items:baseline;gap:16px;margin-top:14px}
    .bias strong{font-size:44px;font-weight:800;letter-spacing:-.03em;background:linear-gradient(92deg,${netShort ? '#ff8a94,#ff5b66' : '#7de8b4,#42d889'});-webkit-background-clip:text;background-clip:text;color:transparent}
    .bias span{color:#8d91b0;font-size:16px;font-weight:500}
    .gmeter{margin-top:20px}
    .glabels{display:flex;justify-content:space-between;margin-top:10px;font-size:14.5px;font-weight:600}
    .glabels .l{color:#42d889}.glabels .r{color:#ff5b66}
    .tstats{display:flex;flex-direction:column;gap:14px;justify-content:center}
    .tstats div{display:flex;justify-content:space-between;align-items:baseline}
    .tstats span{color:#8d91b0;font-size:15px}.tstats strong{font-size:21px;font-weight:700}
    .srow{display:grid;grid-template-columns:86px 1fr 250px 90px;gap:18px;align-items:center;padding:13px 4px;border-bottom:1px solid rgba(255,255,255,.05)}
    .srow:last-child{border-bottom:0}
    .srow .coin{font-size:19px;font-weight:700}
    .meter.big{height:16px}
    .net{font-size:16px;font-weight:700;text-align:right}
    .g{color:#42d889}.r{color:#ff5b66}
    .split{color:#8d91b0;font-size:14px;text-align:right}
    .desks{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:20px}
    .desk{display:flex;align-items:center;gap:12px;border-radius:16px;padding:16px 18px;border:1px solid rgba(150,160,192,.15);background:linear-gradient(158deg,rgba(32,38,56,.45),rgba(10,13,20,.6))}
    .desk .rank{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;font-weight:800;font-size:14px;color:#0a0c12;background:linear-gradient(135deg,#c8bcff,#8f7dff)}
    .desk .rank.rl{background:linear-gradient(135deg,#7de8b4,#2eae74)}
    .desk .rank.rs{background:linear-gradient(135deg,#ff9aa4,#e0455a)}
    .desk strong{font-size:15.5px}.desk small{display:block;color:#8d91b0;font-size:12.5px;margin-top:2px}
    .desk .dpnl{margin-left:auto;font-size:14.5px;font-weight:700}
    .sechead{display:flex;align-items:baseline;justify-content:space-between;margin:22px 2px 10px}
    .sechead h2{font-size:19px;font-weight:700}.sechead span{color:#8d91b0;font-size:13.5px}
  </style>
  <div class="hero">
    <section class="card">
      <div class="kicker">Cohort positioning</div>
      <div class="bias"><strong>${netShort ? 'NET SHORT' : 'NET LONG'}</strong><span>${usd(Math.abs((t.longUsd || 0) - (t.shortUsd || 0)))} net · ${usd(gross)} gross</span></div>
      <div class="meter gmeter big" style="height:18px"><b style="width:${longPct.toFixed(1)}%;background:linear-gradient(90deg,#1f8a5c,#42d889)"></b><b style="left:auto;right:0;width:${(100 - longPct).toFixed(1)}%;background:linear-gradient(90deg,#ff5b66,#8f2731)"></b></div>
      <div class="glabels"><span class="l num">LONG ${usd(t.longUsd)}</span><span class="r num">SHORT ${usd(t.shortUsd)}</span></div>
    </section>
    <section class="card tstats">
      <div><span>Tracked desks</span><strong class="num">${t.desks ?? '—'}</strong></div>
      <div><span>Open positions</span><strong class="num">${t.openPositions ?? '—'}</strong></div>
      <div><span>Unrealized PnL</span><strong class="num ${(t.uPnl || 0) >= 0 ? 'g' : 'r'}">${(t.uPnl || 0) >= 0 ? '+' : '−'}${usd(Math.abs(t.uPnl || 0))}</strong></div>
    </section>
  </div>
  <section class="card">
    <div class="kicker">Where the smart perps sit</div>
    ${skewRows}
  </section>
  <div class="sechead"><h2>Largest live positions</h2><span>clearinghouse-verified · marked to live prices</span></div>
  <div class="desks">${deskCells}</div>`

  return shell({
    title: 'Smart <em>Desks</em>', subtitle: 'Hyperliquid top-PnL cohort · live positioning',
    pillText: 'LIVE · 15-min refresh', body, footNote: 'smart money · derivatives intelligence',
  })
}

// ── 2. ROBINHOOD RADAR — fresh launches, contract-first ────────────────────

// Launch-day moves run to four digits — "+9246.8%" reads like a glitch even
// when real. ≥400% renders as a day-multiple ("93× day") instead.
function radarChip(v) {
  if (v == null || !isFinite(v)) return '<span class="chip fresh">NEW</span>'
  if (v >= 400) {
    const m = 1 + v / 100
    return `<span class="chip up" style="font-size:15px">▲ ${m >= 100 ? m.toFixed(0) : m.toFixed(1)}× day</span>`
  }
  return pctChip(v, 15)
}

function robinhoodRadarHtml(rows) {
  const items = rows.slice(0, 6).map((r, i) => `
    <div class="lrow">
      <span class="idx">${String(i + 1).padStart(2, '0')}</span>
      <div class="ident"><strong>$${esc(r.symbol)}</strong><small>${esc(r.name || '')}</small></div>
      <span class="age num">${ago(r.discovered_at)}</span>
      <span class="stat num"><small>MCAP</small>${usd(r.mcap)}</span>
      <span class="stat num"><small>VOL 24H</small>${usd(r.vol24)}</span>
      ${radarChip(r.chg24)}
    </div>`).join('')

  const body = `<style>
    .radar-hero{display:flex;align-items:center;gap:22px;margin-bottom:20px}
    .radar-hero .beacon{position:relative;width:88px;height:88px;border-radius:50%;flex:none;
      background:radial-gradient(circle at 50% 50%,rgba(66,216,137,.35),rgba(66,216,137,.06) 55%,transparent 70%);
      box-shadow:0 0 44px rgba(66,216,137,.35)}
    .radar-hero .beacon::before{content:"";position:absolute;inset:26px;border-radius:50%;background:linear-gradient(135deg,#7de8b4,#1f8a5c);box-shadow:0 0 22px rgba(66,216,137,.7)}
    .radar-hero .beacon::after{content:"";position:absolute;inset:8px;border-radius:50%;border:1.5px solid rgba(125,232,180,.4)}
    .radar-hero h2{font-size:26px;font-weight:700;letter-spacing:-.02em}
    .radar-hero h2 b{background:linear-gradient(92deg,#7de8b4,#42d889);-webkit-background-clip:text;background-clip:text;color:transparent}
    .radar-hero p{margin-top:5px;color:#8d91b0;font-size:15.5px;max-width:900px}
    .lrow{display:grid;grid-template-columns:52px 1.25fr 120px 170px 170px 130px;gap:16px;align-items:center;padding:15px 6px;border-bottom:1px solid rgba(255,255,255,.05)}
    .lrow:last-child{border-bottom:0}
    .idx{font-size:15px;font-weight:700;color:#57e39b;opacity:.85}
    .ident strong{font-size:19px;font-weight:700}
    .ident small{display:block;color:#8d91b0;font-size:13px;margin-top:2px}
    .age{color:#a9aec7;font-size:14.5px;font-weight:600}
    .stat{display:flex;flex-direction:column;gap:2px;font-size:16.5px;font-weight:700}
    .stat small{color:#8d91b0;font-size:11.5px;font-weight:600;letter-spacing:.1em}
    .chip.fresh{color:#7de8b4;background:linear-gradient(180deg,rgba(24,94,58,.5),rgba(14,58,38,.4));font-size:13px;letter-spacing:.08em}
    .floor{display:flex;gap:12px;margin-top:18px}
    .floor span{padding:9px 15px;border-radius:999px;font-size:13px;font-weight:600;color:#a9aec7;border:1px solid rgba(150,160,192,.18);background:linear-gradient(180deg,rgba(25,30,43,.6),rgba(10,13,20,.7))}
  </style>
  <div class="radar-hero">
    <div class="beacon"></div>
    <div><h2>Fresh launches, <b>caught in minutes</b></h2>
    <p>Contract-first discovery on Robinhood Chain — no waiting for listings. Every entry cleared the liquidity and volume floors before it reached you.</p></div>
  </div>
  <section class="card">${items}</section>
  <div class="floor"><span>✓ liquidity ≥ $5K</span><span>✓ real 24h volume</span><span>✓ corpse-gated — no rugs re-hyped</span><span>⚡ ~30-min detection</span></div>`

  return shell({
    accent: 'accent-green',
    title: 'Robinhood <em>Radar</em>', subtitle: 'New tokens on Robinhood Chain · contract-first',
    pillText: `${rows.length} tracked this window`, body, footNote: 'discovery · robinhood chain',
  })
}

// ── 3. SPOTTED EARLY — the receipts poster ─────────────────────────────────

function spottedHtml(rows) {
  const cells = rows.slice(0, 4).map((r) => {
    const mult = r.entry > 0 && r.peak > 0 ? r.peak / r.entry : null
    const still = r.last > 0 && r.peak > 0 ? r.last / r.peak : null
    return `<section class="card rc">
      <div class="rc-head"><strong>$${esc(r.symbol)}</strong><span>${esc(r.name || '')}</span></div>
      <div class="mult num">${mult ? `${mult >= 10 ? mult.toFixed(0) : mult.toFixed(1)}×` : '—'}</div>
      <div class="path num"><span>spotted at <b>${usd(r.entry)}</b></span><i>→</i><span>peaked at <b>${usd(r.peak)}</b></span></div>
      <div class="rc-foot"><span>${esc(r.when)}</span><span class="${still != null && still >= 0.5 ? 'g' : 'dim'}">${r.last > 0 ? `now ${usd(r.last)}` : ''}</span></div>
    </section>`
  }).join('')

  const body = `<style>
    .lede{margin-bottom:20px;max-width:1050px}
    .lede h2{font-size:27px;font-weight:700;letter-spacing:-.02em}
    .lede h2 b{background:linear-gradient(92deg,#ffd98a,#e0a63a);-webkit-background-clip:text;background-clip:text;color:transparent}
    .lede p{margin-top:6px;color:#8d91b0;font-size:15.5px}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
    .rc{padding:24px 28px}
    .rc-head{display:flex;align-items:baseline;gap:10px}
    .rc-head strong{font-size:22px;font-weight:800}
    .rc-head span{color:#8d91b0;font-size:14px}
    .mult{margin:10px 0 6px;font-size:64px;font-weight:800;letter-spacing:-.04em;line-height:1;
      background:linear-gradient(100deg,#ffe7b0 0%,#f2b94b 45%,#e0863a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
      filter:drop-shadow(0 6px 22px rgba(224,166,58,.25))}
    .path{display:flex;align-items:center;gap:12px;color:#a9aec7;font-size:15.5px}
    .path b{color:#f7f8fb;font-weight:700}
    .path i{font-style:normal;color:#e0a63a;font-weight:700}
    .rc-foot{display:flex;justify-content:space-between;margin-top:14px;font-size:13.5px;color:#6f7490;font-weight:500}
    .g{color:#42d889}.dim{color:#6f7490}
  </style>
  <div class="lede">
    <h2>Attention finds price. <b>Spectre finds attention first.</b></h2>
    <p>Every receipt below is from the Spotted ledger — the market cap the moment Spectre first flagged the token, and where it ran. Graded automatically. No cherry-picking hidden: the ledger keeps the misses too.</p>
  </div>
  <div class="grid">${cells}</div>`

  return shell({
    accent: 'accent-gold',
    title: 'Spotted <em>Early</em>', subtitle: 'The receipts ledger · entry → peak, on the record',
    pillText: 'AUTO-GRADED', body, footNote: 'proof · momentum origin ledger',
  })
}

// ── 4. HEAD TO HEAD — the /vs battle card ──────────────────────────────────

function vsHtml(a, b) {
  // Rows only score a winner when BOTH sides carry a real value — a null vs
  // number "win" is a data gap, not a victory, and renders as a dead row.
  const both = (x, y) => x != null && isFinite(x) && y != null && isFinite(y)
  const rows = [
    ['Price', price(a.price), price(b.price), null],
    both(a.chg24, b.chg24) ? ['24h move', null, null, 'chg'] : null,
    ['Market cap', usd(a.mcap), usd(b.mcap), both(a.mcap, b.mcap) ? (a.mcap > b.mcap ? 'a' : 'b') : null],
    ['Liquidity', usd(a.liq), usd(b.liq), both(a.liq, b.liq) ? (a.liq > b.liq ? 'a' : 'b') : null],
    ['Volume 24h', usd(a.vol24), usd(b.vol24), both(a.vol24, b.vol24) ? (a.vol24 > b.vol24 ? 'a' : 'b') : null],
    ['𝕏 mentions 24h', String(a.mentions ?? '—'), String(b.mentions ?? '—'), both(a.mentions, b.mentions) ? ((a.mentions || 0) > (b.mentions || 0) ? 'a' : 'b') : null],
    ['Unique voices', String(a.authors ?? '—'), String(b.authors ?? '—'), both(a.authors, b.authors) ? ((a.authors || 0) > (b.authors || 0) ? 'a' : 'b') : null],
  ].filter(Boolean)
  let aw = 0; let bw = 0
  const trs = rows.map(([label, va, vb, win]) => {
    let cells
    if (win === 'chg') {
      const wa = (a.chg24 || 0) >= (b.chg24 || 0)
      if (wa) aw++; else bw++
      cells = `<td class="va ${wa ? 'w' : ''}">${pctChip(a.chg24, 16)}</td><td class="lbl">${label}</td><td class="vb ${wa ? '' : 'w'}">${pctChip(b.chg24, 16)}</td>`
    } else {
      if (win === 'a') aw++; else if (win === 'b') bw++
      cells = `<td class="va num ${win === 'a' ? 'w' : ''}">${va}</td><td class="lbl">${label}</td><td class="vb num ${win === 'b' ? 'w' : ''}">${vb}</td>`
    }
    return `<tr>${cells}</tr>`
  }).join('')
  const total = aw + bw
  const aPct = total ? (aw / total) * 100 : 50
  const champ = aw === bw ? null : aw > bw ? a : b

  const body = `<style>
    .arena{display:grid;grid-template-columns:1fr 110px 1fr;align-items:center;gap:10px;margin-bottom:20px}
    .fighter{text-align:center;padding:26px 20px}
    .fighter .sym{font-size:38px;font-weight:800;letter-spacing:-.03em}
    .fighter.fa .sym{background:linear-gradient(92deg,#9fd0ff,#6aa2f7);-webkit-background-clip:text;background-clip:text;color:transparent}
    .fighter.fb .sym{background:linear-gradient(92deg,#ffb0c0,#ff5b8a);-webkit-background-clip:text;background-clip:text;color:transparent}
    .fighter small{display:block;margin-top:5px;color:#8d91b0;font-size:14.5px}
    .vsball{position:relative;display:grid;place-items:center;width:92px;height:92px;margin:0 auto;border-radius:50%;font-size:26px;font-weight:800;color:#0a0c12;
      background:linear-gradient(135deg,#c8bcff,#8f7dff 55%,#6aa2f7);box-shadow:0 0 40px rgba(143,125,255,.45),inset 0 2px 0 rgba(255,255,255,.4)}
    table{width:100%;border-collapse:collapse}
    td{padding:14px 10px;border-bottom:1px solid rgba(255,255,255,.05);font-size:17.5px}
    tr:last-child td{border-bottom:0}
    .lbl{width:220px;text-align:center;color:#8d91b0;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
    .va{text-align:right;font-weight:600}.vb{text-align:left;font-weight:600}
    .va.w,.vb.w{font-weight:800;color:#fff}
    .va.w::after{content:" ●";color:#6aa2f7;font-size:12px}
    .vb.w::before{content:"● ";color:#ff5b8a;font-size:12px}
    .verdict{margin-top:20px}
    .vmeter{height:16px}
    .vlabels{display:flex;justify-content:space-between;margin-top:10px;font-size:15px;font-weight:700}
    .vlabels .a{color:#6aa2f7}.vlabels .b{color:#ff5b8a}
    .crown{text-align:center;margin-top:16px;font-size:17px;color:#a9aec7}
    .crown b{color:#fff;font-weight:800}
  </style>
  <div class="arena">
    <section class="card fighter fa"><div class="sym">$${esc(a.symbol)}</div><small>${esc(a.name || '')}</small></section>
    <div class="vsball">VS</div>
    <section class="card fighter fb"><div class="sym">$${esc(b.symbol)}</div><small>${esc(b.name || '')}</small></section>
  </div>
  <section class="card"><table>${trs}</table></section>
  <section class="card verdict">
    <div class="kicker">Verdict</div>
    <div class="meter vmeter" style="margin-top:14px"><b style="width:${aPct.toFixed(0)}%;background:linear-gradient(90deg,#3e6fd9,#6aa2f7)"></b><b style="left:auto;right:0;width:${(100 - aPct).toFixed(0)}%;background:linear-gradient(90deg,#ff5b8a,#b23057)"></b></div>
    <div class="vlabels"><span class="a">$${esc(a.symbol)} takes ${aw}</span><span class="b">$${esc(b.symbol)} takes ${bw}</span></div>
    ${champ ? `<div class="crown">👑 <b>$${esc(champ.symbol)}</b> wins the tape — ${Math.max(aw, bw)} of ${total} rounds</div>` : '<div class="crown">Dead heat — the tape refuses to pick</div>'}
  </section>`

  return shell({
    title: 'Head to <em>Head</em>', subtitle: `$${a.symbol} vs $${b.symbol} · settled by data, not vibes`,
    pillText: 'BATTLE CARD', body, footNote: 'compare · live market + social',
  })
}

// ── 5. OPTIONS DESK — put/call, max pain vs spot, IV ───────────────────────

// country AND currency codes — the calendar mixes both (tradingview rows
// carry CAD/EUR/JPY, forex_factory rows carry US/UK; same trap as econ prints)
const FLAGS = { US: '🇺🇸', USD: '🇺🇸', EU: '🇪🇺', EUR: '🇪🇺', UK: '🇬🇧', GB: '🇬🇧', GBP: '🇬🇧', JP: '🇯🇵', JPY: '🇯🇵', CA: '🇨🇦', CAD: '🇨🇦', AU: '🇦🇺', AUD: '🇦🇺', NZ: '🇳🇿', NZD: '🇳🇿', CN: '🇨🇳', CNY: '🇨🇳', CH: '🇨🇭', CHF: '🇨🇭', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸', IN: '🇮🇳', INR: '🇮🇳', KR: '🇰🇷', KRW: '🇰🇷', BR: '🇧🇷', BRL: '🇧🇷', MX: '🇲🇽', MXN: '🇲🇽', ZA: '🇿🇦', ZAR: '🇿🇦', TR: '🇹🇷', TRY: '🇹🇷', SE: '🇸🇪', SEK: '🇸🇪', NO: '🇳🇴', NOK: '🇳🇴', SG: '🇸🇬', SGD: '🇸🇬', HK: '🇭🇰', HKD: '🇭🇰', PL: '🇵🇱', PLN: '🇵🇱', ID: '🇮🇩', IDR: '🇮🇩' }

// calendar forecast/previous strings arrive raw ("-1200000000000B") — compact
// anything that parses to a big magnitude, pass short strings through.
function fmtCalVal(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9eE+\-.]/g, ''))
  if (isFinite(n) && Math.abs(n) >= 1e6) {
    const a = Math.abs(n)
    const s = n < 0 ? '-' : ''
    if (a >= 1e12) return `${s}${(a / 1e12).toFixed(1)}T`
    if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`
    return `${s}${(a / 1e6).toFixed(0)}M`
  }
  const str = String(v)
  return str.length <= 10 ? str : str.slice(0, 10)
}

function optionsDeskHtml(assets, spots) {
  const panels = assets.map((o) => {
    const spot = spots[o.asset]
    const callShare = 100 / (1 + (o.putCallRatio || 1))
    const dist = spot && o.maxPain ? ((o.maxPain - spot) / spot) * 100 : null
    const pull = dist == null ? '' : Math.abs(dist) < 0.75
      ? 'spot is pinned at max pain'
      : `spot ${Math.abs(dist).toFixed(1)}% ${dist > 0 ? 'below' : 'above'} max pain — the pin pulls ${dist > 0 ? 'UP' : 'DOWN'} into expiry`
    return `<section class="card opanel">
      <div class="ohead"><strong>${esc(o.asset)}</strong>${o.atmIv != null ? `<span class="ivchip num">IV ${o.atmIv.toFixed(1)}%</span>` : ''}</div>
      <div class="kicker" style="margin-top:14px">Calls vs puts · open interest</div>
      <div class="meter big" style="height:16px;margin-top:12px"><b style="width:${callShare.toFixed(1)}%;background:linear-gradient(90deg,#1f8a5c,#42d889)"></b><b style="left:auto;right:0;width:${(100 - callShare).toFixed(1)}%;background:linear-gradient(90deg,#ff5b66,#8f2731)"></b></div>
      <div class="olabels"><span class="g num">CALLS ${callShare.toFixed(0)}%</span><span class="r num">PUTS ${(100 - callShare).toFixed(0)}%</span></div>
      <div class="pain">
        <div><small>MAX PAIN</small><strong class="num">${price(o.maxPain)}</strong></div>
        <div><small>SPOT</small><strong class="num">${price(spot)}</strong></div>
        <div><small>OPTIONS OI</small><strong class="num">${usd(o.totalOiUsd)}</strong></div>
      </div>
      ${pull ? `<div class="pull">${esc(pull)}</div>` : ''}
    </section>`
  }).join('')

  const btc = assets.find((a) => a.asset === 'BTC')
  const bullish = btc && (btc.putCallRatio || 1) < 0.7
  const body = `<style>
    .ogrid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    .opanel{padding:26px 28px}
    .ohead{display:flex;align-items:center;justify-content:space-between}
    .ohead strong{font-size:30px;font-weight:800;letter-spacing:-.02em}
    .ivchip{padding:8px 14px;border-radius:11px;font-size:15px;font-weight:700;color:#c8bcff;background:linear-gradient(180deg,rgba(76,62,140,.5),rgba(40,32,80,.4));border:1px solid rgba(155,124,255,.25)}
    .olabels{display:flex;justify-content:space-between;margin-top:10px;font-size:14.5px;font-weight:700}
    .g{color:#42d889}.r{color:#ff5b66}
    .pain{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}
    .pain div{border-radius:14px;padding:14px 16px;background:rgba(9,12,19,.55);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
    .pain small{display:block;color:#8d91b0;font-size:11.5px;font-weight:600;letter-spacing:.1em}
    .pain strong{display:block;margin-top:5px;font-size:20px;font-weight:800}
    .pull{margin-top:16px;padding:12px 16px;border-radius:12px;font-size:14.5px;color:#e8d9a8;background:linear-gradient(180deg,rgba(96,78,30,.35),rgba(56,46,18,.3));border:1px solid rgba(224,166,58,.22)}
    .pb{margin-top:20px;padding:18px 22px;border-radius:16px;font-size:15.5px;color:#c9cde0;background:linear-gradient(158deg,rgba(32,38,56,.5),rgba(10,13,20,.62));border:1px solid rgba(150,160,192,.16)}
    .pb b{color:#fff}
  </style>
  <div class="ogrid">${panels}</div>
  <div class="pb">📌 <b>Playbook:</b> ${bullish
    ? 'Options desks lean bullish — calls dominate the book. Max pain often acts like a magnet into Friday expiry: fade violent moves away from it late in the week, and let the pin do the work.'
    : 'Puts are well bid — desks are paying for protection. That is hedging, not always a crash call: watch whether spot keeps rejecting from max pain; sustained trade below it means the hedges are winning.'}</div>`

  return shell({
    title: 'Options <em>Desk</em>', subtitle: 'BTC & ETH options · where the pin lives',
    pillText: 'DERIBIT COMPOSITE', body, footNote: 'derivatives · options intelligence',
  })
}

// ── 6. WEEK AHEAD — macro calendar timeline ────────────────────────────────

function weekAheadHtml(events, anchor) {
  const days = new Map()
  for (const e of events) {
    const d = new Date(e.date)
    const key = d.toISOString().slice(0, 10)
    if (!days.has(key)) days.set(key, { label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }), evts: [] })
    days.get(key).evts.push(e)
  }
  const groups = [...days.values()].slice(0, 5).map((g) => `
    <div class="day">
      <div class="dhead">${esc(g.label)}</div>
      ${g.evts.map((e) => `
        <div class="evt ${e.importance === 'critical' ? 'crit' : e.importance === 'high' ? 'high' : ''}">
          <i></i><span class="flag">${FLAGS[String(e.country || '').toUpperCase()] || '🌐'}</span>
          <strong>${esc(e.name)}</strong>
          ${fmtCalVal(e.forecast) ? `<span class="fx num">fcst ${esc(fmtCalVal(e.forecast))}</span>` : ''}
          ${fmtCalVal(e.previous) ? `<span class="fx num">prev ${esc(fmtCalVal(e.previous))}</span>` : ''}
        </div>`).join('')}
    </div>`).join('')

  const body = `<style>
    .lede{margin-bottom:18px;color:#8d91b0;font-size:15.5px;max-width:1000px}
    .lede b{color:#f7f8fb}
    .day{margin-bottom:16px}
    .dhead{display:flex;align-items:center;gap:12px;color:#a9aec7;font-size:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}
    .dhead::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(150,160,192,.25),transparent)}
    .evt{display:flex;align-items:center;gap:13px;border-radius:14px;padding:13px 18px;margin-bottom:8px;font-size:16px;
      background:linear-gradient(158deg,rgba(32,38,56,.42),rgba(10,13,20,.55));border:1px solid rgba(150,160,192,.13)}
    .evt i{width:9px;height:9px;border-radius:50%;flex:none;background:#6f7490}
    .evt.high i{background:#e0a63a;box-shadow:0 0 12px rgba(224,166,58,.7)}
    .evt.crit i{background:#ff5364;box-shadow:0 0 14px rgba(255,83,100,.8)}
    .evt strong{font-weight:600}
    .evt .flag{font-size:18px}
    .evt .fx{margin-left:auto;color:#8d91b0;font-size:13.5px;font-weight:600}
    .evt .fx+.fx{margin-left:14px}
    .pb{margin-top:6px;padding:18px 22px;border-radius:16px;font-size:15.5px;color:#c9cde0;background:linear-gradient(158deg,rgba(32,38,56,.5),rgba(10,13,20,.62));border:1px solid rgba(150,160,192,.16)}
    .pb b{color:#fff}
  </style>
  ${anchor ? `<div class="lede">The week trades around <b>${esc(anchor.name)}</b> (${esc(new Date(anchor.date).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }))}). Everything before it is positioning; the real move comes after the print.</div>` : ''}
  ${groups}
  <div class="pb">📌 <b>Playbook:</b> Mark the red-dot prints in your session plan. Expect chop and fake moves INTO each release — trading the run-up is a coin flip with fees. The cleaner trade is the reaction: wait for the print, let the first spike exhaust, then trade the direction that holds.</div>`

  return shell({
    title: 'Week <em>Ahead</em>', subtitle: 'The macro prints that move everything · all markets',
    pillText: 'MACRO CALENDAR', body, footNote: 'macro · economic calendar',
  })
}

// ── 7. WHALE DESK WATCH — one verified desk, live positions ────────────────

function whaleDeskHtml(desk) {
  const rows = desk.positions.map((p) => {
    const long = String(p.side).toLowerCase() === 'long'
    const lev = typeof p.leverage === 'number' ? p.leverage : p.leverage?.value
    return `<div class="prow">
      <span class="side ${long ? 'sl' : 'ss'}">${long ? 'LONG' : 'SHORT'}</span>
      <strong class="coin">${esc(p.coin)}</strong>
      <span class="pv num">${usd(p.valueUsd)}</span>
      <span class="meta num">${lev ? `${lev}x` : ''}${p.entryPx ? ` · entry ${price(p.entryPx)}` : ''}${p.liqPx ? ` · liq ${price(p.liqPx)}` : ''}</span>
      <span class="upnl num ${(p.uPnl || 0) >= 0 ? 'g' : 'r'}">${(p.uPnl || 0) >= 0 ? '+' : '−'}${usd(Math.abs(p.uPnl || 0))}</span>
    </div>`
  }).join('')

  const net = desk.positions.reduce((a, p) => a + (p.uPnl || 0), 0)
  const body = `<style>
    .whero{display:flex;align-items:center;gap:20px;margin-bottom:20px;padding:24px 28px}
    .orb{width:66px;height:66px;border-radius:50%;flex:none;background:linear-gradient(135deg,#c8bcff,#8f7dff 60%,#5f4fd1);box-shadow:0 0 34px rgba(143,125,255,.5),inset 0 2px 0 rgba(255,255,255,.4)}
    .wid strong{font-size:26px;font-weight:800;letter-spacing:-.01em}
    .wid small{display:block;margin-top:4px;color:#8d91b0;font-size:15px}
    .wnet{margin-left:auto;text-align:right}
    .wnet small{display:block;color:#8d91b0;font-size:12.5px;letter-spacing:.1em;font-weight:600}
    .wnet strong{font-size:24px;font-weight:800}
    .g{color:#42d889}.r{color:#ff5b66}
    .prow{display:grid;grid-template-columns:92px 90px 150px 1fr 150px;gap:16px;align-items:center;padding:15px 6px;border-bottom:1px solid rgba(255,255,255,.05);font-size:16.5px}
    .prow:last-child{border-bottom:0}
    .side{display:grid;place-items:center;padding:7px 0;border-radius:10px;font-size:12.5px;font-weight:800;letter-spacing:.08em;color:#0a0c12}
    .side.sl{background:linear-gradient(135deg,#7de8b4,#2eae74)}
    .side.ss{background:linear-gradient(135deg,#ff9aa4,#e0455a)}
    .coin{font-size:19px;font-weight:700}
    .pv{font-weight:700}
    .meta{color:#8d91b0;font-size:14px}
    .upnl{text-align:right;font-weight:700}
    .pb{margin-top:20px;padding:18px 22px;border-radius:16px;font-size:15.5px;color:#c9cde0;background:linear-gradient(158deg,rgba(32,38,56,.5),rgba(10,13,20,.62));border:1px solid rgba(150,160,192,.16)}
    .pb b{color:#fff}
  </style>
  <section class="card whero">
    <div class="orb"></div>
    <div class="wid"><strong class="num">${shortAddr(desk.address)}</strong><small>Hyperliquid desk · account value ${usd(desk.accountValue)} · ${desk.positions.length} open position${desk.positions.length === 1 ? '' : 's'}</small></div>
    <div class="wnet"><small>UNREALIZED PNL</small><strong class="num ${net >= 0 ? 'g' : 'r'}">${net >= 0 ? '+' : '−'}${usd(Math.abs(net))}</strong></div>
  </section>
  <section class="card">${rows}</section>
  <div class="pb">📌 <b>Playbook:</b> This is a top-PnL desk trading nine figures — when it opens, flips or closes, that is information. /watch alerts you on every change. One desk is a data point, not a signal: it can be hedging elsewhere. The edge is in the CHANGE, not in copying the book.</div>`

  return shell({
    title: 'Desk <em>Watch</em>', subtitle: 'Clearinghouse-verified whale positioning · live',
    pillText: 'WATCH PREVIEW', body, footNote: 'smart money · /watch',
  })
}

// ── renderers ──────────────────────────────────────────────────────────────

// selector-clip on .stage: the screenshot hugs the card's real content — no
// white/dead bands from viewport slack, whatever the row counts are. Heights
// are generous headroom only; the clip does the cropping.
const render = (html, height) => shot.renderHtml(html, { width: 1440, height, selector: '.stage', deviceScaleFactor: 2, settleMs: 700 })

module.exports = {
  smartDesksCard: (d) => render(smartDesksHtml(d), 1200),
  robinhoodRadarCard: (rows) => render(robinhoodRadarHtml(rows), 1100),
  spottedCard: (rows) => render(spottedHtml(rows), 1100),
  vsCard: (a, b) => render(vsHtml(a, b), 1200),
  optionsDeskCard: (assets, spots) => render(optionsDeskHtml(assets, spots), 1000),
  weekAheadCard: (events, anchor) => render(weekAheadHtml(events, anchor), 1400),
  whaleDeskCard: (desk) => render(whaleDeskHtml(desk), 1000),
}
