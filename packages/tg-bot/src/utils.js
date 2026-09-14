// Utility cards: derivatives, ETF flows, gas, hacks, macro, stocks, momentum,
// yields, RWA, KOL dossiers, token security, regime. All zero-LLM templates.
const api = require('./spectre-api')
const { esc, usd, price, move, pct, compact, ago } = require('./format')

const g = (p, ttl = 60e3) => api.get(p, { ttlMs: ttl })

// funding: weighted_funding_rate is per-8h
async function fundingCard() {
  const rows = (await g('/v1/derivatives/funding-rates?limit=200')) || []
  const clean = rows.filter((r) => r.asset && isFinite(r.weighted_funding_rate))
  if (!clean.length) return '💸 Funding data warming up.'
  clean.sort((a, b) => b.weighted_funding_rate - a.weighted_funding_rate)
  const fmt = (r) => {
    const pct8 = r.weighted_funding_rate * 100
    const apr = pct8 * 3 * 365
    return `${esc(r.asset)} <code>${pct8 >= 0 ? '+' : ''}${pct8.toFixed(4)}%</code> 8h · ${apr.toFixed(1)}% APR`
  }
  const lines = ['💸 <b>Funding Rates</b> — composite, per 8h', '', '<b>Longs paying (hot)</b>']
  for (const r of clean.slice(0, 5)) lines.push(fmt(r))
  lines.push('', '<b>Shorts paying (squeezy)</b>')
  for (const r of clean.slice(-5).reverse()) lines.push(fmt(r))
  // the read: who is paying to hold, and what that usually costs them
  const pos = clean.filter((r) => r.weighted_funding_rate > 0).length
  const share = pos / clean.length
  const hot = clean[0]
  const sq = clean[clean.length - 1]
  const bits = []
  if (share > 0.75) bits.push('longs are paying across almost the whole board — the crowded side is long, and flushes hit the crowd')
  else if (share < 0.35) bits.push('shorts are paying to press — negative funding is squeeze fuel if price stops going down')
  else bits.push('funding is split — no side is paying a real premium, positioning is not the story today')
  if (hot?.weighted_funding_rate * 100 * 3 * 365 > 50) bits.push(`${hot.asset} longs are paying ${(hot.weighted_funding_rate * 100 * 3 * 365).toFixed(0)}% APR to stay in — that is chase money, not conviction`)
  if (sq?.weighted_funding_rate < 0 && Math.abs(sq.weighted_funding_rate * 100 * 3 * 365) > 30) bits.push(`${sq.asset} shorts pay ${Math.abs(sq.weighted_funding_rate * 100 * 3 * 365).toFixed(0)}% APR — a firm bid there forces covers`)
  // Playbook line (holder feedback 2026-07-20: "translate the numbers into
  // clear guidance newer traders can use") — plain language, action-shaped,
  // always conditional. Never "buy/sell now"; setups, not signals.
  const playbook = share > 0.75
    ? 'Longs are crowded AND paying to stay in — the risky move here is chasing green candles. Look for potential short setups if price stalls at resistance; the fast move is usually the flush down.'
    : share < 0.35
      ? 'Shorts are paying to press — every strong bounce forces them to buy back. Look for long setups at levels that hold; avoid opening new shorts into negative funding.'
      : 'No side is crowded today — positioning gives no edge either way, so take setups from levels and volume instead.'
  lines.push('', `<blockquote>🧠 ${bits.join('. ').replace(/^./, (ch) => ch.toUpperCase())}.\n📌 <b>Playbook:</b> ${playbook}</blockquote>`)
  return lines.join('\n')
}

async function oiCard() {
  const rows = (await g('/v1/derivatives/open-interest?limit=100')) || []
  const clean = rows.filter((r) => r.asset && r.oi_usd > 0).sort((a, b) => b.oi_usd - a.oi_usd)
  if (!clean.length) return '📐 OI data warming up.'
  const total = clean.reduce((a, r) => a + r.oi_usd, 0)
  const lines = [`📐 <b>Open Interest</b> — total ${usd(total)}`, '']
  for (const r of clean.slice(0, 10)) {
    const top = r.oi_exchange_breakdown
      ? Object.entries(r.oi_exchange_breakdown).sort((a, b) => b[1] - a[1])[0]
      : null
    lines.push(`<b>${esc(r.asset)}</b> ${usd(r.oi_usd)}${top ? ` · top ${esc(top[0])}` : ''}`)
  }
  const majorsShare = clean.slice(0, 2).reduce((a, r) => a + r.oi_usd, 0) / total
  lines.push('', `<blockquote>🧠 ${clean[0].asset} + ${clean[1]?.asset || ''} hold ${(majorsShare * 100).toFixed(0)}% of open leverage — the pain trades live in the majors. Thin alt OI means alt moves are spot-led: slower, but stickier when they run.\n📌 <b>Playbook:</b> The violent moves (squeezes, cascades) happen where the borrowed money sits — expect them in ${clean[0].asset}/${clean[1]?.asset || 'ETH'}. Alts trend more cleanly but move slower; size and stops accordingly.</blockquote>`)
  return lines.join('\n')
}

async function liqsCard() {
  const rows = (await g('/v1/derivatives/liquidations?limit=300', 30e3)) || []
  const evts = rows
    .filter((r) => r.price > 0 && r.quantity > 0)
    .map((r) => ({ ...r, notional: r.price * r.quantity }))
  if (!evts.length) return '💥 No recent liquidations captured.'
  const longs = evts.filter((e) => e.side === 'long').reduce((a, e) => a + e.notional, 0)
  const shorts = evts.filter((e) => e.side === 'short').reduce((a, e) => a + e.notional, 0)
  const lines = [
    '💥 <b>Liquidations</b> — recent tape',
    `Longs rekt ${usd(longs)} · Shorts rekt ${usd(shorts)}`,
    '',
    '<b>Biggest hits</b>',
  ]
  for (const e of evts.sort((a, b) => b.notional - a.notional).slice(0, 6)) {
    lines.push(
      `${e.side === 'long' ? '🔻' : '🔺'} <b>${esc(e.asset)}</b> ${e.side} ${usd(e.notional)} @ ${price(e.price)} · ${esc(e.exchange || '')}${e.time ? ` · ${ago(e.time)}` : ''}`,
    )
  }
  const lp = longs / Math.max(1, longs + shorts)
  const liqRead = lp > 0.65
    ? `${(lp * 100).toFixed(0)}% of the wipeout was longs — late leverage got flushed. Post-flush tape is usually cleaner: weak hands are out.\n📌 <b>Playbook:</b> A long flush often marks a short-term low once it slows. Do not catch the falling knife — watch for price to stop making new lows and reclaim a level; the reclaim is the long setup.`
    : lp < 0.35
      ? `${((1 - lp) * 100).toFixed(0)}% of the damage hit shorts — a squeeze tape. Chasing it late is how the next flush finds its fuel.\n📌 <b>Playbook:</b> Late longs chasing a squeeze are next in line to be liquidated. If you missed the move, wait for the pullback — if it holds higher, the trend is real and you lose nothing by waiting.`
      : 'Balanced churn — both sides paying tuition, no directional flush to lean on.\n📌 <b>Playbook:</b> The liquidation tape has no edge today — let support/resistance levels decide your setups.'
  lines.push('', `<blockquote>🧠 ${liqRead}</blockquote>`)
  return lines.join('\n')
}

async function lsrCard() {
  const rows = (await g('/v1/derivatives/long-short-ratio?limit=100')) || []
  const clean = rows.filter((r) => r.asset && isFinite(r.long_short_ratio))
  if (!clean.length) return '⚖️ L/S data warming up.'
  const fmt = (r) => {
    const longPct = (r.long_short_ratio / (1 + r.long_short_ratio)) * 100
    const bias = longPct >= 60 ? '🟢 longs crowded' : longPct <= 40 ? '🔴 shorts crowded' : '⚪ balanced'
    return `<b>${esc(r.asset)}</b> ${r.long_short_ratio.toFixed(2)} → ${longPct.toFixed(0)}% long ${bias}`
  }
  const majors = ['BTC', 'ETH', 'SOL']
  const lines = ['⚖️ <b>Long/Short Ratio</b>', '']
  for (const m of majors) {
    const r = clean.find((x) => x.asset === m)
    if (r) lines.push(fmt(r))
  }
  const rest = clean
    .filter((r) => !majors.includes(r.asset))
    .sort((a, b) => Math.abs(b.long_short_ratio - 1) - Math.abs(a.long_short_ratio - 1))
    .slice(0, 5)
  if (rest.length) {
    lines.push('', '<b>Most skewed</b>')
    for (const r of rest) lines.push(fmt(r))
  }
  const btc = clean.find((x) => x.asset === 'BTC')
  if (btc) {
    const lp = (btc.long_short_ratio / (1 + btc.long_short_ratio)) * 100
    const lsrRead = lp >= 62
      ? `Retail is ${lp.toFixed(0)}% long BTC — crowded positioning is contrarian tinder; if funding is paying too, squeezes run the other way first.\n📌 <b>Playbook:</b> Long positioning is crowded — look for potential short setups on failed breakouts, and be slow to chase longs. The fuel for a fast move is on the downside.`
      : lp <= 42
        ? `Retail is ${(100 - lp).toFixed(0)}% short BTC — fear positioning. Down-moves get sold into cover fast; rallies run further than they should.\n📌 <b>Playbook:</b> Short positioning is crowded — look for potential long setups at levels that hold. Squeezes up run further than they should; avoid adding to shorts late.`
        : 'BTC positioning is near balance — the ratio is not the edge today; watch funding and flows instead.\n📌 <b>Playbook:</b> No crowd to fade here — skip positioning-based trades today and work levels, volume and news instead.'
    lines.push('', `<blockquote>🧠 ${lsrRead}</blockquote>`)
  }
  return lines.join('\n')
}

async function etfCard() {
  const rows = (await g('/v1/etf/flows', 5 * 60e3)) || []
  if (!rows.length) return '🏦 ETF flow data warming up.'
  const lines = ['🏦 <b>ETF Flows</b> — latest session', '']
  for (const asset of ['BTC', 'ETH']) {
    const set = rows.filter((r) => r.asset === asset)
    if (!set.length) continue
    const net = set.reduce((a, r) => a + (r.flowUsd || 0), 0)
    lines.push(`<b>${asset}</b> net ${net >= 0 ? '🟢 +' : '🔴 −'}${usd(Math.abs(net)).slice(1)}`)
    const sorted = set.filter((r) => r.flowUsd).sort((a, b) => b.flowUsd - a.flowUsd)
    // inflow line only lists actual inflows — on an all-outflow session the
    // "top two" are still negative and would render as "+-30.0M"
    for (const r of sorted.filter((x) => x.flowUsd > 0).slice(0, 2)) lines.push(`   ${esc(r.ticker)} +${usd(r.flowUsd).slice(1)}`)
    for (const r of sorted.slice(-2).filter((r) => r.flowUsd < 0)) lines.push(`   ${esc(r.ticker)} −${usd(Math.abs(r.flowUsd)).slice(1)}`)
    lines.push('')
  }
  const btcNet = rows.filter((r) => r.asset === 'BTC').reduce((a, r) => a + (r.flowUsd || 0), 0)
  const ethNet = rows.filter((r) => r.asset === 'ETH').reduce((a, r) => a + (r.flowUsd || 0), 0)
  const read =
    btcNet > 0 && ethNet > 0
      ? 'TradFi bid both books — ETF inflows are patient capital, and it absorbs dips before they deepen.'
      : btcNet < 0 && ethNet < 0
        ? 'Both books bled — institutional distribution. Rallies into outflows are for selling, not chasing.'
        : btcNet >= 0 && ethNet < 0
          ? 'Rotation read: BTC absorbs while ETH bleeds — dominance trade on, alts fight the current.'
          : 'Rotation read: ETH catching the bid while BTC rests — beta appetite is back at the margin.'
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`)
  return lines.join('\n').trim()
}

async function gasCard() {
  const rows = (await g('/v1/gas', 60e3)) || []
  if (!rows.length) return '⛽ Gas data warming up.'
  const lines = ['⛽ <b>Gas</b>', '']
  for (const r of rows.slice(0, 8)) {
    const unit = r.chain === 'bitcoin' ? 'sat/vB' : 'gwei'
    const usdPart = r.usdMedium ? ` · ~$${(+r.usdMedium).toFixed(2)}` : ''
    lines.push(`<b>${esc(r.chain)}</b> ${r.low}/${r.medium}/${r.high} ${unit}${usdPart}`)
  }
  return lines.join('\n')
}

async function hacksCard() {
  const rows = (await g('/v1/security/hacks?limit=6', 10 * 60e3)) || []
  if (!rows.length) return '🛡 No recent hacks on record.'
  const lines = ['🛡 <b>Recent Hacks & Exploits</b>', '']
  for (const r of rows) {
    const when = r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''
    lines.push(`🔴 <b>${esc(r.protocol)}</b> — ${usd(r.amount_usd)}`)
    lines.push(`     <i>${esc([r.category, r.chain, r.technique, when].filter(Boolean).join(' · '))}</i>`)
  }
  return lines.join('\n')
}

async function calendarCard() {
  const rows = (await g('/v1/macro/calendar?limit=40', 10 * 60e3)) || []
  const upcoming = rows.filter((r) => new Date(r.date) >= Date.now() - 86400e3)
  const ranked = upcoming.filter((r) => r.importance !== 'low')
  const show = (ranked.length >= 4 ? ranked : upcoming).slice(0, 7)
  if (!show.length) return '📅 No upcoming macro events on the calendar.'
  const lines = ['📅 <b>Macro Calendar</b>', '']
  for (const r of show) {
    const d = new Date(r.date)
    const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    const sev = r.importance === 'high' ? '🔴' : r.importance === 'medium' ? '🟠' : '⚪'
    lines.push(`${sev} <b>${esc(day)}</b> · ${esc(r.country || '')} — ${esc(r.name)}`)
    if (r.forecast != null || r.previous != null) {
      lines.push(`     <i>forecast ${esc(String(r.forecast ?? '—'))} · prev ${esc(String(r.previous ?? '—'))}</i>`)
    }
  }
  const anchor = show.find((r) => r.importance === 'high') || show[0]
  if (anchor) {
    const day = new Date(anchor.date).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    lines.push('', `<blockquote>🧠 The week trades around <b>${esc(anchor.name)}</b> (${esc(day)}). Expect chop into the print and the real move after — positioning ahead of it is a coin flip with fees.</blockquote>`)
  }
  return lines.join('\n')
}

async function stocksCard() {
  const rows = (await g('/v1/macro/equity-quotes', 2 * 60e3)) || []
  if (!rows.length) return '📈 Equity quotes warming up.'
  const cryptoAdj = ['COIN', 'MSTR', 'HOOD', 'CRCL', 'MARA', 'RIOT']
  const lines = ['📈 <b>Equities</b> — crypto-adjacent first', '', '<b>Crypto stocks</b>']
  const adj = rows.filter((r) => cryptoAdj.includes(r.symbol))
  const rest = rows.filter((r) => !cryptoAdj.includes(r.symbol))
  for (const r of adj) lines.push(`<b>${esc(r.symbol)}</b> ${price(r.price)} ${move(r.change_24h_pct)}`)
  if (rest.length) {
    lines.push('', '<b>Big tech</b>')
    for (const r of rest.slice(0, 8)) lines.push(`<b>${esc(r.symbol)}</b> ${price(r.price)} ${move(r.change_24h_pct)}`)
  }
  lines.push('', '<i>/stocks nvidia — chart + alerts for one name · /price spx works too</i>')
  return lines.join('\n')
}

async function gainersCard() {
  const d = await g('/v1/momentum/leaderboard?limit=10', 3 * 60e3)
  const items = d?.items || []
  if (!items.length) return '🚀 Momentum board warming up.'
  const lines = ['🚀 <b>Potential Gainers</b> — social momentum engine', '']
  items.forEach((t, i) => {
    const name = esc(String(t.asset || '').toUpperCase())
    lines.push(
      `${i + 1}. <b>${name}</b> — score ${(t.momentum_score ?? 0).toFixed(2)} · ${compact(t.total_mentions)} mentions · ${t.cluster_count ?? 0} clusters${t.signal_quality === 'full' ? ' · ✅' : ''}`,
    )
  })
  lines.push('', '<i>/scan SYMBOL before you act — momentum ≠ entry</i>')
  return lines.join('\n')
}

async function yieldsCard() {
  const rows = (await g('/v1/defi/yields?limit=100', 10 * 60e3)) || []
  const clean = rows
    .filter((r) => isFinite(r.apy) && r.apy > 0 && r.apy < 300 && (r.tvlUsd == null || r.tvlUsd >= 1e6))
    .sort((a, b) => b.apy - a.apy)
    .slice(0, 8)
  if (!clean.length) return '🌾 Yield data warming up.'
  const lines = ['🌾 <b>DeFi Yields</b> — sane APYs only (junk filtered)', '']
  for (const r of clean) {
    lines.push(
      `<b>${esc(r.symbol)}</b> ${r.apy.toFixed(1)}% — ${esc(r.protocol)} (${esc(r.chain)})${r.tvlUsd ? ` · TVL ${usd(r.tvlUsd)}` : ''}`,
    )
  }
  return lines.join('\n')
}

async function rwaCard() {
  const d = await g('/v1/rwa/overview', 10 * 60e3)
  if (!d?.total_rwa_tvl) return '🏛 RWA data warming up.'
  const lines = [`🏛 <b>RWA</b> — total on-chain TVL ${usd(d.total_rwa_tvl)}`, '']
  for (const [name, cat] of Object.entries(d.categories || {})) {
    if (!cat?.tvl) continue
    lines.push(`<b>${esc(name)}</b> ${usd(cat.tvl)}${cat.count ? ` · ${cat.count} assets` : ''}`)
  }
  return lines.join('\n')
}

async function regimeCard() {
  const [r, w] = await Promise.all([g('/v1/brain/regime', 5 * 60e3).catch(() => null), g('/v1/brain/world', 5 * 60e3).catch(() => null)])
  const lines = ['🧭 <b>Regime</b>']
  if (r?.regime) lines.push(`<b>${esc(String(r.regime).toUpperCase())}</b> · confidence ${Math.round((r.confidence ?? 0) * 100)}%`)
  const odds = w?.doc?.rates?.odds
  if (Array.isArray(odds) && odds.length) {
    lines.push('', '<b>Rates & politics odds</b>')
    for (const o of odds.slice(0, 3)) {
      const p = o.p ?? o.probability ?? o.odds
      lines.push(`• ${esc(o.q || o.question || '')}${isFinite(p) ? ` — ${Math.round(p * 100)}%` : ''}`)
    }
  }
  if (w?.doc?.dxy?.read) lines.push('', `<i>${esc(w.doc.dxy.read)}</i>`)
  return lines.length > 1 ? lines.join('\n') : '🧭 Regime engine warming up.'
}

async function authorCard(handle) {
  const clean = String(handle || '').replace(/^@/, '').trim()
  if (!clean) return 'Usage: <code>/author handle</code> — e.g. /author blknoiz06'
  const d = await g(`/v1/social/author/${encodeURIComponent(clean)}`, 3 * 60e3).catch(() => null)
  const a = d?.author
  if (!a) return `𝕏 No dossier for <b>@${esc(clean)}</b>.`
  const lines = [`𝕏 <b>@${esc(clean)}</b>${a.author_class ? ` — ${esc(a.author_class)}` : ''}`]
  if (a.description) lines.push(`<i>${esc(String(a.description).slice(0, 140))}</i>`)
  lines.push('')
  const hr7 = a.early_signal_hit_rate_7d
  const hr24 = a.early_signal_hit_rate_24h
  if (hr7 != null || hr24 != null) {
    lines.push(`<b>Early-signal hit rate</b>: ${hr24 != null ? `${Math.round(hr24 * 100)}% 24h` : ''}${hr7 != null ? ` · ${Math.round(hr7 * 100)}% 7d` : ''}`)
  }
  if (a.early_calls_7d != null) lines.push(`Early calls (7d): ${a.early_calls_7d}`)
  if (a.avg_lead_minutes_7d != null) lines.push(`Avg lead time: ${Math.round(a.avg_lead_minutes_7d)}m before the crowd`)
  const tokens = (d.tokens || []).slice(0, 5)
  if (tokens.length) {
    lines.push('', '<b>Talking about</b>')
    for (const t of tokens) {
      const sym = t.symbol || t.our_symbol || t.cg_id || ''
      if (sym) lines.push(`• ${esc(String(sym).toUpperCase())}${t.mentions ? ` — ${t.mentions}` : ''}`)
    }
  }
  return lines.join('\n')
}

async function securityCard(query) {
  const q = String(query || '').trim()
  if (!q) return 'Usage: <code>/security pepe</code> or <code>/security 0x…contract</code>'
  const d = await g(`/v1/security/token?query=${encodeURIComponent(q)}`, 5 * 60e3).catch(() => null)
  if (!d?.resolved) return `🛡 Couldn't resolve <b>${esc(q)}</b> for a security read.`
  const id = d.identity || {}
  const lines = [`🛡 <b>${esc(id.symbol || q)} · ${esc(id.name || '')}</b>${id.chain ? ` — ${esc(id.chain)}` : ''}`]
  if (d.scores?.spectre_score != null) lines.push(`Spectre score: <b>${d.scores.spectre_score}/100</b>`)
  const flags = d.risk_flags || []
  if (flags.length) {
    lines.push('', '<b>⚠️ Risk flags</b>')
    for (const f of flags.slice(0, 8)) lines.push(`• ${esc(typeof f === 'string' ? f : f.label || f.flag || JSON.stringify(f))}`)
  } else {
    lines.push('', '✅ No risk flags raised.')
  }
  const sec = d.security || {}
  const secBits = []
  if (sec.is_honeypot != null) secBits.push(sec.is_honeypot ? '🚨 HONEYPOT' : 'not a honeypot')
  if (sec.buy_tax != null) secBits.push(`buy tax ${sec.buy_tax}%`)
  if (sec.sell_tax != null) secBits.push(`sell tax ${sec.sell_tax}%`)
  if (secBits.length) lines.push('', secBits.join(' · '))
  if (id.contract_address) lines.push('', `<code>${esc(id.contract_address)}</code>`)
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────
// New feature cards (2026-07-16) — all zero-LLM, all reuse live /v1 routes.
// ─────────────────────────────────────────────────────────────────────────

// /whales — large on-chain transfers with entity labels + a flow read
async function whalesCard() {
  const rows = (await g('/v1/onchain/whales?limit=40', 60e3)) || []
  const clean = rows.filter((r) => r.amountUsd > 0 && r.asset).slice(0, 12)
  if (!clean.length) return '🐋 Whale tape is quiet — no large transfers in the window.'
  const isExch = (r) => /binance|coinbase|kraken|okx|bybit|exchange|bitfinex|upbit|htx|gate|kucoin|deposit|hot wallet/i.test(`${r.label || ''} ${r.entityName || ''}`)
  const lines = ['🐋 <b>WHALE MOVES</b> — ≥$1M on-chain', '']
  for (const r of clean.slice(0, 8)) {
    const dir = r.action === 'send' ? '→' : '←'
    const who = r.entityName || r.label || `${String(r.address || '').slice(0, 6)}…`
    lines.push(`▸ <b>${esc(r.asset)}</b> <code>${usd(r.amountUsd)}</code> ${dir} ${esc(who)} · ${ago(r.time)}`)
  }
  // flow read: into exchanges (deposits) = distribution pressure; out = accumulation
  let inUsd = 0
  let outUsd = 0
  for (const r of clean) {
    const toExch = r.action === 'send' && isExch(r)
    const fromExch = r.action === 'receive' && isExch(r)
    if (toExch) inUsd += r.amountUsd
    else if (fromExch) outUsd += r.amountUsd
  }
  const total = inUsd + outUsd
  let read
  if (total < 1) read = 'Wallet-to-wallet moves dominate — repositioning, no clear exchange flow.'
  else if (inUsd > outUsd * 1.5) read = `Net flow is exchange-ward (${usd(inUsd)} in vs ${usd(outUsd)} out) — supply hitting order books is distribution pressure, not accumulation.`
  else if (outUsd > inUsd * 1.5) read = `Net flow is leaving exchanges (${usd(outUsd)} out vs ${usd(inUsd)} in) — coins moving to self-custody is accumulation, supply coming off the market.`
  else read = 'Exchange in/out flows are balanced — no dominant whale intent yet.'
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · Whale Watch</i>')
  return lines.join('\n')
}

// /hl <asset> — Hyperliquid perp truth for one asset
async function hyperliquidCard(arg) {
  const sym = String(arg || 'BTC').trim().replace(/^\$/, '').toUpperCase() || 'BTC'
  const d = await g(`/v1/derivatives/hyperliquid/${encodeURIComponent(sym)}`, 60e3)
  if (!d || !isFinite(d.mark_price)) return `⚡ No Hyperliquid perp for <b>${esc(sym)}</b> — try BTC, ETH, SOL, HYPE.`
  const apr = isFinite(d.funding_annualized) ? d.funding_annualized * 100 : d.funding_rate * 3 * 365 * 100
  const lines = [
    `⚡ <b>HYPERLIQUID · ${esc(sym)}</b>`,
    `▸ <b>Mark</b> <code>${price(d.mark_price)}</code>`,
    `▸ <b>Open interest</b> <code>${usd(d.open_interest)}</code>`,
    `▸ <b>Funding</b> <code>${d.funding_rate >= 0 ? '+' : ''}${(d.funding_rate * 100).toFixed(4)}%</code>/8h · <code>${apr.toFixed(1)}%</code> APR`,
    `▸ <b>24h volume</b> <code>${usd(d.volume_24h)}</code>`,
  ]
  // OI trend from history + funding sign → positioning read
  const hist = Array.isArray(d.history) ? d.history : []
  const oiThen = hist.length ? hist[0].open_interest : null
  const oiChg = oiThen ? ((d.open_interest - oiThen) / oiThen) * 100 : null
  const bits = []
  if (oiChg != null && Math.abs(oiChg) >= 3) bits.push(`OI ${oiChg > 0 ? 'building' : 'unwinding'} (${oiChg > 0 ? '+' : ''}${oiChg.toFixed(0)}% over the window)`)
  if (d.funding_rate > 0.00015) bits.push('longs are paying a rich premium — crowded long, squeeze risk points down first')
  else if (d.funding_rate < -0.00005) bits.push('shorts are paying — negative funding is squeeze fuel if the bid holds')
  else bits.push('funding is neutral — no premium either way, positioning is not the story')
  lines.push('', `<blockquote>🧠 ${bits.join('; ').replace(/^./, (c) => c.toUpperCase())}.</blockquote>`, '<i>⌁ Spectre Intelligence · Hyperliquid</i>')
  return lines.join('\n')
}

// /options — BTC/ETH options positioning (put/call, max pain, IV)
async function optionsCard() {
  const rows = (await g('/v1/options/overview', 5 * 60e3)) || []
  const clean = rows.filter((r) => r.asset && isFinite(r.putCallRatio))
  if (!clean.length) return '📐 Options data warming up.'
  const lines = ['📐 <b>OPTIONS POSITIONING</b>', '']
  for (const r of clean.slice(0, 4)) {
    lines.push(`<b>${esc(r.asset)}</b>`)
    lines.push(`▸ <b>Put/Call</b> <code>${r.putCallRatio.toFixed(2)}</code>${isFinite(r.atmIv) ? ` · IV <code>${r.atmIv.toFixed(0)}%</code>` : ''}`)
    if (isFinite(r.maxPain)) lines.push(`▸ <b>Max pain</b> <code>${usd(r.maxPain)}</code>${isFinite(r.totalOiUsd) ? ` · OI <code>${usd(r.totalOiUsd)}</code>` : ''}`)
    lines.push('')
  }
  const btc = clean.find((r) => r.asset === 'BTC') || clean[0]
  const bits = []
  if (btc.putCallRatio < 0.7) bits.push(`${btc.asset} put/call at ${btc.putCallRatio.toFixed(2)} — call-heavy, the options crowd leans up`)
  else if (btc.putCallRatio > 1.1) bits.push(`${btc.asset} put/call at ${btc.putCallRatio.toFixed(2)} — put-heavy, hedging or bearish tilt`)
  else bits.push(`${btc.asset} put/call balanced at ${btc.putCallRatio.toFixed(2)}`)
  bits.push('max pain is the strike where most options expire worthless — dealers often pin price toward it into expiry')
  lines.push(`<blockquote>🧠 ${bits.join('. ').replace(/^./, (c) => c.toUpperCase())}.</blockquote>`, '<i>⌁ Spectre Intelligence · Options</i>')
  return lines.join('\n')
}

// /paper — Spectre's paper-trading book (proof the brain's calls compound)
async function paperCard() {
  const d = await g('/v1/brain/paper', 2 * 60e3)
  const traders = (d?.traders || []).filter((t) => t.total_trades > 0)
  if (!traders.length) return '🧾 Paper book warming up — no closed trades yet.'
  traders.sort((a, b) => (b.current_balance - b.starting_balance) / b.starting_balance - (a.current_balance - a.starting_balance) / a.starting_balance)
  const lines = ['🧾 <b>PAPER BOOK</b> — the desk trading its own calls', '']
  for (const t of traders.slice(0, 6)) {
    const ret = ((t.current_balance - t.starting_balance) / t.starting_balance) * 100
    const wr = t.total_trades ? (t.wins / t.total_trades) * 100 : 0
    const name = esc(String(t.name || t.strategy).replace(/_/g, ' '))
    lines.push(`▸ <b>${name}</b> <code>${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%</code> · ${wr.toFixed(0)}% win · ${t.total_trades} trades${t.open_positions ? ` · ${t.open_positions} open` : ''}`)
  }
  const best = traders[0]
  const bestRet = ((best.current_balance - best.starting_balance) / best.starting_balance) * 100
  const green = traders.filter((t) => t.current_balance > t.starting_balance).length
  lines.push('', `<blockquote>🧠 ${green}/${traders.length} books are green; the edge is <b>${esc(String(best.name || best.strategy).replace(/_/g, ' '))}</b> at ${bestRet >= 0 ? '+' : ''}${bestRet.toFixed(1)}%. Paper, honestly graded — no cherry-picking.</blockquote>`, '<i>⌁ Spectre Intelligence · Paper Book</i>')
  return lines.join('\n')
}

// /stables — stablecoin aggregate supply = the market's dry-powder gauge
async function stablesCard() {
  const d = await g('/v1/rwa/stablecoins-summary', 5 * 60e3)
  const issuers = (d?.issuers || []).filter((i) => i.supply_usd > 0)
  if (!isFinite(d?.total_supply_usd) || !issuers.length) return '💵 Stablecoin data warming up.'
  issuers.sort((a, b) => b.supply_usd - a.supply_usd)
  const lines = [
    '💵 <b>STABLECOINS</b> — the market’s dry powder',
    `▸ <b>Total supply</b> <code>${usd(d.total_supply_usd)}</code>${isFinite(d.total_holders) ? ` · ${compact(d.total_holders)} holders` : ''}`,
    '',
  ]
  for (const i of issuers.slice(0, 6)) {
    const short = String(i.name || '').replace(/\s*\(.*\)/, '')
    lines.push(`▸ <b>${esc(short)}</b> <code>${usd(i.supply_usd)}</code>`)
  }
  lines.push('', '<blockquote>🧠 Stablecoin supply is buying power waiting on the sidelines. Expanding supply = dry powder building for risk-on; contracting = capital leaving the casino. It is the tide under every rally.</blockquote>', '<i>⌁ Spectre Intelligence · Stablecoins</i>')
  return lines.join('\n')
}

// /clusters — which KOL clusters are driving which assets (social heatmap)
async function clustersCard() {
  const d = await g('/v1/social/heatmap?window=24h', 3 * 60e3)
  const items = (d?.items || []).filter((i) => i.total_mentions > 0)
  if (!items.length) return '𝕏 Cluster heat warming up.'
  items.sort((a, b) => b.total_engagement - a.total_engagement)
  const topClusterOf = (it) => {
    const cs = Object.entries(it.clusters || {}).map(([k, v]) => ({ k, ...v }))
    cs.sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    return cs[0]
  }
  const pretty = (k) => esc(String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
  const lines = ['𝕏 <b>CLUSTER HEAT</b> — who’s driving what · 24h', '']
  let narrow = 0
  for (const it of items.slice(0, 8)) {
    const top = topClusterOf(it)
    if (!top) continue
    const share = it.total_engagement ? (top.engagement / it.total_engagement) : 0
    if (share > 0.6) narrow++
    lines.push(`▸ <b>${esc(String(it.asset).toUpperCase())}</b> — ${pretty(top.k)} <code>${top.kols} KOLs</code>${share > 0.6 ? ' ⚠️' : ''}`)
  }
  lines.push('', `<blockquote>🧠 ⚠️ marks assets where one KOL cluster owns >60% of the engagement — a narrow, fragile base (one room pumping). Broad cluster spread is real breadth. ${narrow ? `${narrow} of the top 8 are single-cluster right now.` : 'The top names have broad cluster support.'}</blockquote>`, '<i>⌁ Spectre Intelligence · Cluster Heat</i>')
  return lines.join('\n')
}

// /smart — smart-money netflow board (flow × attention, the Spectre edge)
const TRADE_URL = 'https://trade.spectreai.io'
async function smartMoneyCard() {
  const d = await g('/v1/wallets/board', 90e3)
  const rows = (d?.rows || []).filter((r) => isFinite(r.netflow24h) && !r.isStable && r.symbol)
  if (!rows.length) return '💼 Smart-money board warming up.'
  const inflow = rows.filter((r) => r.netflow24h > 0).sort((a, b) => b.netflow24h - a.netflow24h)
  const outflow = rows.filter((r) => r.netflow24h < 0).sort((a, b) => a.netflow24h - b.netflow24h)
  const readTag = { front_running: '🥷 ahead of the crowd', confirming: '✅ buying the buzz', distributing: '⚠️ selling into strength' }
  const lines = ['💼 <b>SMART MONEY</b> — 24h netflow', '', '<b>Accumulating</b>']
  for (const r of inflow.slice(0, 6)) {
    const tag = readTag[r.attentionRead] ? ` · ${readTag[r.attentionRead]}` : ''
    lines.push(`▸ <b>$${esc(String(r.symbol).toUpperCase())}</b> <code>+${usd(r.netflow24h)}</code> · ${r.traders} wallet${r.traders === 1 ? '' : 's'}${tag}`)
  }
  if (outflow.length) {
    lines.push('', '<b>Distributing</b>')
    for (const r of outflow.slice(0, 4)) lines.push(`▸ <b>$${esc(String(r.symbol).toUpperCase())}</b> <code>-${usd(Math.abs(r.netflow24h))}</code> · ${r.traders} wallet${r.traders === 1 ? '' : 's'}`)
  }
  const front = inflow.filter((r) => r.attentionRead === 'front_running').slice(0, 2)
  const read = front.length
    ? `Smart money is accumulating ${front.map((r) => `$${String(r.symbol).toUpperCase()}`).join(' and ')} BEFORE the crowd notices — pre-attention accumulation is the highest-signal flow. Distribution into buzz is the exit-into-strength warning.`
    : 'Flows read as confirmation, not front-running — smart money is buying names the crowd already sees. The edge is when they buy what nobody is talking about yet.'
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · Smart Money</i>')
  return lines.join('\n')
}

// /chatter <sym> — real crowd sentiment split + top voices (risk-first read)
async function chatterCard(arg) {
  const sym = String(arg || '').trim().replace(/^\$/, '').toUpperCase()
  if (!sym) return 'Usage: <code>/chatter WIF</code> — crowd sentiment for a token.'
  const d = await g(`/v1/social/mentions/${encodeURIComponent(sym)}?limit=25`, 60e3)
  const bs = d?.by_sentiment || []
  const total = d?.totals?.mentions || 0
  if (!total) return `𝕏 No chatter captured for <b>$${esc(sym)}</b> in the last 24h.`
  const get = (s) => bs.find((x) => x.sentiment === s)?.count || 0
  const bull = get('bullish')
  const bear = get('bearish')
  const bullPct = total ? Math.round((bull / total) * 100) : 0
  const bearPct = total ? Math.round((bear / total) * 100) : 0
  const lines = [
    `𝕏 <b>CHATTER · $${esc(sym)}</b> — 24h`,
    `▸ <b>Voices</b> <code>${compact(d.totals.distinct_authors || 0)}</code> · <b>Mentions</b> <code>${compact(total)}</code>`,
    `▸ <b>Tone</b> <code>${bullPct}% bull / ${bearPct}% bear</code>`,
  ]
  const top = (d.top_engaged || []).filter((t) => t.text).slice(0, 2)
  if (top.length) {
    lines.push('')
    for (const t of top) lines.push(`<blockquote>${esc(String(t.text).replace(/\s+/g, ' ').slice(0, 160))}${t.text.length > 160 ? '…' : ''}</blockquote>`)
  }
  // risk-first read (memory doctrine): bullish tone is not safety on its own
  let read
  if (bullPct >= 55 && bullPct >= bearPct * 1.6) read = `Crowd leans bullish (${bullPct}% vs ${bearPct}%). But bullish chatter on its own is not a green light — check the tape: buzz that holds while price bleeds is often people talking their bags, not accumulation.`
  else if (bearPct >= 45 && bearPct >= bullPct * 1.3) read = `Crowd leans bearish (${bearPct}% vs ${bullPct}%). Capitulation chatter near a bottom can be a contrarian tell — but a falling knife with bearish crowd is usually still falling.`
  else read = `Chatter is split (${bullPct}% bull / ${bearPct}% bear) — no crowd conviction, so the tape decides this one, not the timeline.`
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · Chatter</i>')
  return lines.join('\n')
}

// /origin <sym> — Spectre's receipts: when we first tracked it, at what cap, peak
async function originCard(arg) {
  const q = String(arg || '').trim().replace(/^\$/, '').toLowerCase()
  if (!q) return 'Usage: <code>/origin WIF</code> — when Spectre first spotted a token.'
  // resolve symbol → slug via socialRow, then momentum-origin by slug
  const row = await api.socialRow(q).catch(() => null)
  const slug = row?.token_id || row?.cg_id || q
  const o = await g(`/v1/social/momentum-origin/${encodeURIComponent(slug)}`, 5 * 60e3)
  if (!o || !(Number(o.entry_market_cap) > 0)) return `📡 No Spectre origin on record for <b>$${esc(q.toUpperCase())}</b> yet.`
  const sym = String(o.symbol || q).toUpperCase()
  const roiNow = isFinite(o.roi_pct) ? o.roi_pct : null
  const peakRoi = isFinite(o.peak_roi_pct) ? o.peak_roi_pct : null
  const lines = [
    `📡 <b>SPOTTED · $${esc(sym)}</b>`,
    `▸ <b>First seen</b> <code>${usd(o.entry_market_cap)}</code>${o.entry_rank ? ` · rank #${o.entry_rank}` : ''} · ${ago(o.first_entered_at)}`,
  ]
  if (Number(o.peak_market_cap) > Number(o.entry_market_cap)) lines.push(`▸ <b>Peak</b> <code>${usd(o.peak_market_cap)}</code>${peakRoi != null ? ` (+${peakRoi.toFixed(0)}%)` : ''}${o.peak_at ? ` · ${ago(o.peak_at)}` : ''}`)
  if (Number(o.last_market_cap) > 0) lines.push(`▸ <b>Now</b> <code>${usd(o.last_market_cap)}</code>${roiNow != null ? ` (${roiNow >= 0 ? '+' : ''}${roiNow.toFixed(0)}% from spot)` : ''}`)
  let read
  if (peakRoi != null && roiNow != null && roiNow < peakRoi - 20) read = `We spotted it at ${usd(o.entry_market_cap)} and it ran to +${peakRoi.toFixed(0)}% before fading — momentum is spent, it's off the highs. The receipt is honest: entry, peak, and now.`
  else if (roiNow != null && roiNow > 20) read = `Still extending — up ${roiNow.toFixed(0)}% from where we first flagged it. The move isn't over yet.`
  else read = `Spotted early at ${usd(o.entry_market_cap)}; the tape has round-tripped since. Entry, peak, and now — no cherry-picking.`
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · Receipts</i>')
  return lines.join('\n')
}

// /compare <a> <b> — head-to-head on price, cap, momentum
async function compareCard(arg) {
  const parts = String(arg || '').trim().replace(/\$/g, '').split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length < 2) return 'Usage: <code>/compare BTC ETH</code> — two tokens head to head.'
  const [a, b] = parts.map((s) => s.toUpperCase())
  const px = await api.prices([a, b], { ttlMs: 30e3 }).catch(() => null)
  const pa = px?.[a]
  const pb = px?.[b]
  if (!pa?.price || !pb?.price) return `Couldn't price both — check <b>${esc(a)}</b> and <b>${esc(b)}</b>.`
  const ch = (p) => Number(p.change?.['24h'] ?? p.change_24h_pct ?? p.change24h ?? NaN)
  const ch7 = (p) => Number(p.change?.['7d'] ?? p.change_7d_pct ?? NaN)
  const block = (sym, p) => {
    const l = [`<b>$${esc(sym)}</b>`, `▸ <b>Price</b> <code>${price(p.price)}</code>${isFinite(ch(p)) ? ` · 24h ${move(ch(p), 1)}` : ''}`]
    if (p.market_cap) l.push(`▸ <b>Cap</b> <code>${usd(p.market_cap)}</code>${isFinite(ch7(p)) ? ` · 7d ${move(ch7(p), 1)}` : ''}`)
    return l.join('\n')
  }
  const lines = [`⚔️ <b>${esc(a)} vs ${esc(b)}</b>`, '', block(a, pa), '', block(b, pb)]
  const da = isFinite(ch(pa)) ? ch(pa) : 0
  const db = isFinite(ch(pb)) ? ch(pb) : 0
  const win = da === db ? null : da > db ? a : b
  const read = win ? `${win} is outperforming on the day (${move(Math.max(da, db), 1).replace(/<[^>]+>/g, '')} vs ${move(Math.min(da, db), 1).replace(/<[^>]+>/g, '')}). On a relative-strength basis, that's where the bid is right now.` : 'Dead heat on the day — no relative-strength edge between them yet.'
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · Head to Head</i>')
  return lines.join('\n')
}

// /rotation — where money is rotating (dominance, ETH/BTC, stables, ETF)
async function rotationCard() {
  const [gl, px, etf, stab] = await Promise.all([
    api.globalStats().catch(() => null),
    api.prices(['BTC', 'ETH'], { ttlMs: 30e3 }).catch(() => null),
    g('/v1/etf/flows', 5 * 60e3).catch(() => null),
    g('/v1/rwa/stablecoins-summary', 5 * 60e3).catch(() => null),
  ])
  const btcD = Number(gl?.btc_dominance ?? gl?.market_cap_percentage?.btc ?? NaN)
  const btcP = px?.BTC?.price
  const ethP = px?.ETH?.price
  const ethBtc = btcP && ethP ? ethP / btcP : null
  const lines = ['🧭 <b>ROTATION</b> — where the money is moving', '']
  if (isFinite(btcD)) lines.push(`▸ <b>BTC dominance</b> <code>${btcD.toFixed(1)}%</code>`)
  if (ethBtc) lines.push(`▸ <b>ETH/BTC</b> <code>${ethBtc.toFixed(4)}</code>`)
  const ethCh = Number(px?.ETH?.change?.['24h'] ?? NaN)
  const btcCh = Number(px?.BTC?.change?.['24h'] ?? NaN)
  if (isFinite(ethCh) && isFinite(btcCh)) lines.push(`▸ <b>24h</b> BTC ${move(btcCh, 1)} · ETH ${move(ethCh, 1)}`)
  if (isFinite(stab?.total_supply_usd)) lines.push(`▸ <b>Stablecoin supply</b> <code>${usd(stab.total_supply_usd)}</code>`)
  // read: dominance + eth/btc + relative beta
  const bits = []
  if (isFinite(ethCh) && isFinite(btcCh)) {
    if (ethCh > btcCh + 1) bits.push('ETH is outrunning BTC — risk appetite is tilting down the curve toward alts')
    else if (btcCh > ethCh + 1) bits.push('BTC is leading ETH — flight to the majors, alts on the back foot')
    else bits.push('BTC and ETH are moving together — no clear rotation signal yet')
  }
  if (isFinite(btcD)) {
    if (btcD > 56) bits.push(`dominance is high at ${btcD.toFixed(0)}% — money is hiding in BTC, alt-season needs this to roll over first`)
    else if (btcD < 50) bits.push(`dominance is low at ${btcD.toFixed(0)}% — capital has spread into alts, the risk-on tilt is already on`)
  }
  lines.push('', `<blockquote>🧠 ${bits.join('. ').replace(/^./, (c) => c.toUpperCase()) || 'Rotation signals are muted today.'}.</blockquote>`, '<i>⌁ Spectre Intelligence · Rotation</i>')
  return lines.join('\n')
}

// /convert <amt> <from> [to] — quick token↔USD (or token↔token) converter
async function convertCard(arg) {
  const parts = String(arg || '').trim().replace(/\$/g, '').split(/\s+/).filter(Boolean)
  if (parts.length < 2) return 'Usage: <code>/convert 0.5 ETH</code> or <code>/convert 2 ETH BTC</code>.'
  const amt = parseFloat(parts[0].replace(/,/g, ''))
  if (!isFinite(amt)) return 'First give an amount — <code>/convert 0.5 ETH</code>.'
  const from = parts[1].toUpperCase()
  const to = (parts[2] || 'USD').toUpperCase()
  const syms = [from, ...(to === 'USD' ? [] : [to])]
  const px = await api.prices(syms, { ttlMs: 30e3 }).catch(() => null)
  const pf = px?.[from]
  if (!pf?.price) return `Couldn't price <b>${esc(from)}</b>.`
  const usdVal = amt * pf.price
  if (to === 'USD') {
    return `🔁 <b>${esc(parts[0])} ${esc(from)}</b> = <code>${usd(usdVal)}</code>\n<i>at ${price(pf.price)} / ${esc(from)}</i>\n\n<i>⌁ Spectre Intelligence</i>`
  }
  const pt = px?.[to]
  if (!pt?.price) return `Couldn't price <b>${esc(to)}</b>.`
  const out = usdVal / pt.price
  return `🔁 <b>${esc(parts[0])} ${esc(from)}</b> = <code>${out.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${esc(to)}</code>\n<i>≈ ${usd(usdVal)} · ${esc(from)} ${price(pf.price)} / ${esc(to)} ${price(pt.price)}</i>\n\n<i>⌁ Spectre Intelligence</i>`
}

// /ath <sym> — distance from all-time high + what a reclaim needs
async function athCard(arg) {
  const sym = String(arg || '').trim().replace(/^\$/, '').toUpperCase()
  if (!sym) return 'Usage: <code>/ath BTC</code> — distance from the all-time high.'
  const px = await api.prices([sym], { ttlMs: 30e3 }).catch(() => null)
  const p = px?.[sym]
  if (!p?.price || !p.ath?.price) return `No ATH on record for <b>$${esc(sym)}</b>.`
  const fromAth = p.ath.change_pct ?? ((p.price - p.ath.price) / p.ath.price) * 100
  const toReclaim = ((p.ath.price - p.price) / p.price) * 100
  const lines = [
    `🏔 <b>ALL-TIME HIGH · $${esc(sym)}</b>`,
    `▸ <b>ATH</b> <code>${price(p.ath.price)}</code>${p.ath.date ? ` · ${ago(p.ath.date)}` : ''}`,
    `▸ <b>Now</b> <code>${price(p.price)}</code> · <code>${fromAth >= 0 ? '+' : ''}${fromAth.toFixed(1)}%</code> from ATH`,
  ]
  if (toReclaim > 0.5) lines.push(`▸ <b>To reclaim</b> <code>+${toReclaim.toFixed(0)}%</code> from here`)
  let read
  if (fromAth > -5) read = `Within ${Math.abs(fromAth).toFixed(0)}% of its all-time high — price discovery territory, where there's no overhead supply and moves can extend fast (and unwind fast).`
  else if (fromAth > -50) read = `Down ${Math.abs(fromAth).toFixed(0)}% from the top — a normal drawdown zone. Needs +${toReclaim.toFixed(0)}% to reclaim the highs; overhead holders from the last cycle are the resistance.`
  else read = `${Math.abs(fromAth).toFixed(0)}% below its ATH — deep in the valley. A +${toReclaim.toFixed(0)}% round-trip is a different market regime, not a quick bounce.`
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence</i>')
  return lines.join('\n')
}

// /supply <sym> — circulating / total / FDV breakdown + dilution read
async function supplyCard(arg) {
  const sym = String(arg || '').trim().replace(/^\$/, '').toUpperCase()
  if (!sym) return 'Usage: <code>/supply SOL</code> — supply & dilution breakdown.'
  const px = await api.prices([sym], { ttlMs: 60e3 }).catch(() => null)
  const p = px?.[sym]
  if (!p?.price) return `Couldn't find <b>$${esc(sym)}</b>.`
  const circ = Number(p.supply?.circulating) || (p.market_cap && p.price ? p.market_cap / p.price : null)
  const total = Number(p.supply?.total) || Number(p.supply?.max) || null
  const fdv = p.fdv || (total ? total * p.price : null)
  const lines = [`🪙 <b>SUPPLY · $${esc(sym)}</b>`]
  if (p.market_cap) lines.push(`▸ <b>Market cap</b> <code>${usd(p.market_cap)}</code>`)
  if (fdv) lines.push(`▸ <b>FDV</b> <code>${usd(fdv)}</code>`)
  if (circ) lines.push(`▸ <b>Circulating</b> <code>${compact(circ)}</code>`)
  if (total) lines.push(`▸ <b>Total / max</b> <code>${compact(total)}</code>`)
  const pctCirc = circ && total ? (circ / total) * 100 : null
  if (pctCirc != null) lines.push(`▸ <b>In circulation</b> <code>${pctCirc.toFixed(0)}%</code>`)
  let read
  if (pctCirc != null && pctCirc < 60) read = `Only ${pctCirc.toFixed(0)}% of supply is circulating — the other ${(100 - pctCirc).toFixed(0)}% unlocks over time. FDV of ${usd(fdv)} vs a ${usd(p.market_cap)} cap means real dilution pressure ahead; every unlock is new supply that needs a buyer.`
  else if (pctCirc != null) read = `${pctCirc.toFixed(0)}% is already circulating — most of the dilution is behind it, so FDV (${usd(fdv)}) and market cap (${usd(p.market_cap)}) are close. Less unlock overhang than a low-float token.`
  else read = `Market cap ${usd(p.market_cap)}${fdv ? ` on ${usd(fdv)} FDV` : ''}. When FDV sits far above cap, unlocks are the hidden sell pressure to watch.`
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence</i>')
  return lines.join('\n')
}

// /dominance — BTC/ETH dominance + alt-season read
async function dominanceCard() {
  const gl = await api.globalStats().catch(() => null)
  const btcD = Number(gl?.btc_dominance ?? gl?.market_cap_percentage?.btc ?? NaN)
  const ethD = Number(gl?.eth_dominance ?? gl?.market_cap_percentage?.eth ?? NaN)
  if (!isFinite(btcD)) return '🧭 Dominance data warming up.'
  const altD = isFinite(ethD) ? 100 - btcD - ethD : null
  const lines = [
    '🧭 <b>MARKET DOMINANCE</b>',
    `▸ <b>BTC</b> <code>${btcD.toFixed(1)}%</code>`,
  ]
  if (isFinite(ethD)) lines.push(`▸ <b>ETH</b> <code>${ethD.toFixed(1)}%</code>`)
  if (altD != null) lines.push(`▸ <b>Alts</b> <code>${altD.toFixed(1)}%</code>`)
  const totalCap = Number(gl?.total_market_cap)
  const capChg = Number(gl?.market_cap_change_24h)
  if (isFinite(totalCap)) lines.push(`▸ <b>Total cap</b> <code>${usd(totalCap)}</code>${isFinite(capChg) ? ` ${move(capChg, 1)}` : ''}`)
  let read
  if (btcD > 58) read = `BTC dominance is high at ${btcD.toFixed(0)}% — capital is concentrated in Bitcoin. Alt-season doesn't start until this rolls over; fighting dominance early is how alt bags get heavy.`
  else if (btcD < 50) read = `BTC dominance is low at ${btcD.toFixed(0)}% — money has spread into alts, the risk-on tilt is already underway. Late-cycle dominance lows are also where alt euphoria tops.`
  else read = `Dominance is mid-range at ${btcD.toFixed(0)}% — no decisive rotation. Watch the direction: falling dominance in an uptrend is the alt-season tell.`
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · Dominance</i>')
  return lines.join('\n')
}

// /world — macro-politics world state (rate odds, policy) the market trades on
async function worldCard() {
  const d = await g('/v1/brain/world', 5 * 60e3)
  const doc = d?.doc
  if (!doc) return '🌍 World-state warming up.'
  const lines = ['🌍 <b>WORLD STATE</b> — the macro the market trades on', '']
  const odds = (doc.rates?.odds || []).filter((o) => isFinite(o.yes_pct)).sort((a, b) => b.yes_pct - a.yes_pct)
  if (odds.length) {
    lines.push('<b>Rates</b>')
    for (const o of odds.slice(0, 3)) lines.push(`▸ ${esc(String(o.q).replace(/\?$/, ''))} — <code>${o.yes_pct}%</code>`)
    lines.push('')
  }
  const pol = doc.politics?.figures || doc.politics?.stances || []
  if (Array.isArray(pol) && pol.length) {
    lines.push('<b>Politics</b>')
    for (const p of pol.slice(0, 3)) {
      const who = esc(p.actor || p.name || p.figure || '')
      const st = esc(String(p.stance || p.summary || '').slice(0, 90))
      if (who && st) lines.push(`▸ <b>${who}</b> — ${st}`)
    }
    lines.push('')
  }
  if (doc.dxy?.value || doc.dxy?.read) lines.push(`▸ <b>DXY</b> ${doc.dxy.value ? `<code>${Number(doc.dxy.value).toFixed(1)}</code>` : ''}${doc.dxy.read ? ` — ${esc(String(doc.dxy.read).slice(0, 80))}` : ''}`)
  const topOdd = odds[0]
  const read = topOdd
    ? `The market's base case: ${esc(String(topOdd.q).replace(/\?$/, '').toLowerCase())} at ${topOdd.yes_pct}%. Rate path and policy are the tide every risk asset floats on — when the odds move, crypto beta moves with them.`
    : 'Macro is the tide under every trade — rate expectations, policy, and the dollar set the risk backdrop before any token-specific story matters.'
  lines.push(`<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · World State</i>')
  return lines.join('\n')
}

// /roi <sym> <entry> [qty] — position P&L against a live price
async function roiCard(arg) {
  const parts = String(arg || '').trim().replace(/\$/g, '').split(/\s+/).filter(Boolean)
  if (parts.length < 2) return 'Usage: <code>/roi SOL 120</code> (entry price) or <code>/roi SOL 120 10</code> (+ qty).'
  const sym = parts[0].toUpperCase()
  const entry = parseFloat(parts[1].replace(/,/g, ''))
  const qty = parts[2] ? parseFloat(parts[2].replace(/,/g, '')) : null
  if (!isFinite(entry) || entry <= 0) return 'Give a valid entry price — <code>/roi SOL 120</code>.'
  const px = await api.prices([sym], { ttlMs: 30e3 }).catch(() => null)
  const p = px?.[sym]
  if (!p?.price) return `Couldn't price <b>$${esc(sym)}</b>.`
  const roi = ((p.price - entry) / entry) * 100
  const lines = [
    `📊 <b>POSITION · $${esc(sym)}</b>`,
    `▸ <b>Entry</b> <code>${price(entry)}</code> · <b>Now</b> <code>${price(p.price)}</code>`,
    `▸ <b>P&L</b> <code>${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</code>`,
  ]
  if (qty && isFinite(qty)) {
    const cost = entry * qty
    const val = p.price * qty
    lines.push(`▸ <b>${qty} ${esc(sym)}</b> · cost <code>${usd(cost)}</code> → <code>${usd(val)}</code> (<code>${val - cost >= 0 ? '+' : ''}${usd(Math.abs(val - cost))}</code>)`)
  }
  const x = p.price / entry
  const read = roi >= 100 ? `A ${x.toFixed(1)}× — the discipline now is trimming into strength, not round-tripping a winner back to break-even.` : roi >= 0 ? `Green by ${roi.toFixed(0)}%. Know your invalidation before you add — a plan beats a hope.` : `Underwater ${Math.abs(roi).toFixed(0)}%. The only question that matters: is your original thesis still intact, or are you holding out of hope?`
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence</i>')
  return lines.join('\n')
}

// /brief — the composed market digest (market + mood + movers + a runner)
async function briefCard() {
  const [gl, fg, markets] = await Promise.all([
    api.globalStats().catch(() => null),
    api.fearGreed().catch(() => null),
    api.markets(100).catch(() => null),
  ])
  const lines = ['🗞 <b>SPECTRE BRIEF</b>', '']
  const btcD = Number(gl?.btc_dominance)
  const capChg = Number(gl?.market_cap_change_24h)
  if (isFinite(gl?.total_market_cap)) lines.push(`▸ <b>Total cap</b> <code>${usd(Number(gl.total_market_cap))}</code>${isFinite(capChg) ? ` ${move(capChg, 1)}` : ''}${isFinite(btcD) ? ` · BTC.d <code>${btcD.toFixed(1)}%</code>` : ''}`)
  const fgv = Number(fg?.current?.value ?? fg?.value)
  if (isFinite(fgv)) lines.push(`▸ <b>Fear &amp; Greed</b> <code>${Math.round(fgv)}</code> · ${esc(fg?.current?.classification || fg?.classification || '')}`)
  const rows = (Array.isArray(markets) ? markets : []).filter((m) => isFinite(m.price_change_percentage_24h))
  if (rows.length) {
    const sorted = [...rows].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
    const g1 = sorted[0]
    const l1 = sorted[sorted.length - 1]
    lines.push(`▸ <b>Top gainer</b> $${esc(g1.symbol.toUpperCase())} <code>${move(g1.price_change_percentage_24h, 1)}</code> · <b>Worst</b> $${esc(l1.symbol.toUpperCase())} <code>${move(l1.price_change_percentage_24h, 1)}</code>`)
  }
  // a runner from the radar
  const boot = await api.xdashBootstrap('24h', 50).catch(() => null)
  const runner = (boot?.tokens || []).filter((t) => (t.market_cap || 0) > 3e5 && (t.market_cap || 0) < 5e7 && (t.effective_external_mentions_24h ?? t.mentions_24h ?? 0) >= 20 && !t.is_major_asset).sort((a, b) => (b.velocity_ratio || 0) - (a.velocity_ratio || 0))[0]
  if (runner) lines.push(`▸ <b>𝕏 Runner</b> $${esc(String(runner.symbol).toUpperCase())} <code>${usd(runner.market_cap)}</code> · ${compact(runner.effective_external_mentions_24h ?? runner.mentions_24h)} mentions`)
  let mood
  if (isFinite(fgv) && fgv < 30) mood = 'Fear is the tape — the crowd is defensive. Disbelief bottoms are built here, but only price confirms them.'
  else if (isFinite(fgv) && fgv > 70) mood = 'Greed is running — late-cycle energy. Chasing green here is how you become someone else’s exit liquidity.'
  else mood = 'Mood is neutral — no crowd extreme to fade. The setups, not the sentiment, carry the day.'
  lines.push('', `<blockquote>🧠 ${mood}</blockquote>`, '<i>⌁ Spectre Intelligence · Brief</i>')
  return lines.join('\n')
}

// /callers — group caller leaderboard (aggregate the call ledger by peak ROI)
function callersCard(calls) {
  const arr = (calls || []).filter((c) => c.caller?.name && c.mcap > 0)
  if (!arr.length) return '🏆 No calls logged in this group yet. Every /scan here is a call — first caller owns the receipt.'
  const by = {}
  for (const c of arr) {
    const n = c.caller.name
    const peakRoi = c.peakMcap > c.mcap ? ((c.peakMcap - c.mcap) / c.mcap) * 100 : 0
    by[n] = by[n] || { name: n, calls: 0, sumPeak: 0, best: 0, bestSym: '' }
    by[n].calls++
    by[n].sumPeak += peakRoi
    if (peakRoi > by[n].best) { by[n].best = peakRoi; by[n].bestSym = c.symbol }
  }
  const board = Object.values(by).map((x) => ({ ...x, avg: x.sumPeak / x.calls })).sort((a, b) => b.avg - a.avg)
  const medal = ['🥇', '🥈', '🥉']
  const lines = ['🏆 <b>TOP CALLERS</b> — by avg peak ROI', '']
  board.slice(0, 8).forEach((x, i) => {
    lines.push(`${medal[i] || `${i + 1}.`} <b>${esc(x.name)}</b> <code>+${x.avg.toFixed(0)}% avg</code> · ${x.calls} call${x.calls === 1 ? '' : 's'}${x.bestSym ? ` · best $${esc(x.bestSym)} +${x.best.toFixed(0)}%` : ''}`)
  })
  const top = board[0]
  lines.push('', `<blockquote>🧠 Ranked by average PEAK ROI from the call mcap — reward for spotting the move, honest about whether it was one lucky call (${top.calls === 1 ? 'like the leader, 1 call so far' : `${top.calls} calls deep`}) or a real streak. Peak, not last — we show the best it printed.</blockquote>`, '<i>⌁ Spectre Intelligence · Callers</i>')
  return lines.join('\n')
}

// /portfolio — holdings with live P&L (store-backed)
async function portfolioCard(holds) {
  const arr = (holds || []).filter((h) => h.symbol && isFinite(h.qty))
  if (!arr.length) return '💼 Your portfolio is empty.\nAdd a position: <code>/portfolio add SOL 10 120</code> (qty, entry).\nRemove: <code>/portfolio remove SOL</code>.'
  const px = await api.prices(arr.map((h) => h.symbol), { ttlMs: 30e3 }).catch(() => null)
  let totVal = 0
  let totCost = 0
  const rows = []
  for (const h of arr) {
    const p = px?.[h.symbol]
    if (!p?.price) { rows.push(`▸ <b>${esc(h.symbol)}</b> — price unavailable`); continue }
    const val = p.price * h.qty
    totVal += val
    const line = [`▸ <b>${esc(h.symbol)}</b> <code>${usd(val)}</code>`]
    if (h.entry > 0) {
      const cost = h.entry * h.qty
      totCost += cost
      const roi = ((p.price - h.entry) / h.entry) * 100
      line.push(`<code>${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</code>`)
    }
    rows.push(line.join(' · '))
  }
  const lines = ['💼 <b>PORTFOLIO</b>', '', ...rows, '', `▸ <b>Total value</b> <code>${usd(totVal)}</code>`]
  if (totCost > 0) {
    const pnl = totVal - totCost
    const pnlPct = (pnl / totCost) * 100
    lines.push(`▸ <b>P&L</b> <code>${pnl >= 0 ? '+' : ''}${usd(Math.abs(pnl))}</code> (<code>${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</code>)`)
  }
  // concentration read
  const top = [...arr].map((h) => ({ s: h.symbol, v: (px?.[h.symbol]?.price || 0) * h.qty })).sort((a, b) => b.v - a.v)[0]
  const conc = totVal > 0 && top ? (top.v / totVal) * 100 : 0
  const read = conc > 60 ? `${top.s} is ${conc.toFixed(0)}% of the book — that's a concentrated bet, not a portfolio. One token's bad day is your whole day.` : 'Reasonably spread across positions. Size to survive the drawdown you can\'t predict, not the gain you\'re hoping for.'
  lines.push('', `<blockquote>🧠 ${read}</blockquote>`, '<i>⌁ Spectre Intelligence · Portfolio</i>')
  return lines.join('\n')
}

module.exports = {
  fundingCard, oiCard, liqsCard, lsrCard, etfCard, gasCard, hacksCard,
  calendarCard, stocksCard, gainersCard, yieldsCard, rwaCard, regimeCard,
  authorCard, securityCard,
  whalesCard, hyperliquidCard, optionsCard, paperCard, stablesCard, clustersCard,
  smartMoneyCard, chatterCard, originCard, compareCard, rotationCard,
  convertCard, athCard, supplyCard, dominanceCard,
  worldCard, roiCard, briefCard, callersCard, portfolioCard,
}
