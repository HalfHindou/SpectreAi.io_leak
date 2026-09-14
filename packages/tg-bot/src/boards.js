// Board builders: heatmaps, bubble maps, runners, signals, top movers.
const api = require('./spectre-api')
const { heatmapPng, bubblesPng, fmtCompact } = require('./viz')
const { esc, usd, price, move, compact, ago } = require('./format')

const SEV = { critical: '🔴', high: '🔴', medium: '🟠', low: '⚪' }

async function topRows(perPage = 100) {
  const rows = await api.markets(perPage)
  return (rows || []).filter((r) => r.market_cap > 0 && r.symbol && !['usdt', 'usdc', 'dai', 'usde', 'usds'].includes(r.symbol))
}

// xdash bootstrap price_change_24h is often null (collector gap) —
// overlay from one batched /v1/prices call
async function xChangeLookup(tokens) {
  const syms = [...new Set(tokens.map((t) => (t.symbol || t.our_symbol || '').toUpperCase()).filter(Boolean))]
  const data = syms.length ? await api.prices(syms).catch(() => null) : null
  return (t) => {
    if (t.price_change_24h != null && isFinite(t.price_change_24h)) return t.price_change_24h
    return data?.[(t.symbol || t.our_symbol || '').toUpperCase()]?.change?.['24h'] ?? 0
  }
}

// ---- heatmaps

// change-field per timeframe on /v1/coins/markets rows
const CH_FIELD = {
  '1h': 'price_change_percentage_1h_in_currency',
  '24h': 'price_change_percentage_24h',
  '7d': 'price_change_percentage_7d_in_currency',
}

async function marketHeatmap(themeName, tf = '24h') {
  const field = CH_FIELD[tf] || CH_FIELD['24h']
  const rows = (await topRows(50)).slice(0, 40)
  if (!rows.length) return null
  const tiles = rows.map((r) => ({
    label: r.symbol.toUpperCase(),
    value: r.market_cap,
    change: r[field] ?? 0,
    sub: fmtCompact(r.market_cap),
    logo: r.image,
  }))
  const png = await heatmapPng({ tiles, title: 'MARKET HEATMAP', subtitle: `top 40 by market cap · color = ${tf} change`, themeName })
  const best = rows.reduce((a, b) => ((b[field] ?? -99) > (a[field] ?? -99) ? b : a))
  const worst = rows.reduce((a, b) => ((b[field] ?? 99) < (a[field] ?? 99) ? b : a))
  const caption =
    `🔥 <b>Market Heatmap</b> — top 40 caps, ${tf}\n` +
    `Best ${esc(best.symbol.toUpperCase())} ${move(best[field])} · ` +
    `Worst ${esc(worst.symbol.toUpperCase())} ${move(worst[field])}`
  return { png, caption }
}

async function xHeatmap(themeName) {
  const boot = await api.xdashBootstrap('24h', 50)
  const tokens = (boot?.tokens || []).filter((t) => (t.effective_external_mentions_24h ?? t.mentions_24h) > 0).slice(0, 36)
  if (!tokens.length) return null
  const changeOf = await xChangeLookup(tokens)
  const tiles = tokens.map((t) => ({
    label: (t.symbol || t.our_symbol || '').toUpperCase(),
    value: t.effective_external_mentions_24h ?? t.mentions_24h,
    change: changeOf(t),
    sub: `${compact(t.effective_external_mentions_24h ?? t.mentions_24h)} mentions`,
    logo: t.image_small || t.image_thumb || t.image_url,
  }))
  const png = await heatmapPng({ tiles, title: 'X ATTENTION HEATMAP', subtitle: 'size = X mentions 24h · color = price 24h', themeName })
  return { png, caption: `𝕏 <b>Attention Heatmap</b> — size = mentions, color = 24h price\n<i>/scan SYMBOL to dig in</i>` }
}

// ---- bubbles

async function marketBubbles(themeName, tf = '24h') {
  const field = CH_FIELD[tf] || CH_FIELD['24h']
  const rows = (await topRows(100)).sort((a, b) => Math.abs(b[field] ?? 0) - Math.abs(a[field] ?? 0)).slice(0, 26)
  if (!rows.length) return null
  const items = rows.map((r) => ({
    label: r.symbol.toUpperCase(),
    size: Math.max(Math.abs(r[field] ?? 0), 0.4),
    change: r[field] ?? 0,
    sub: fmtCompact(r.market_cap),
    logo: r.image,
  }))
  const png = await bubblesPng({ items, title: 'MARKET BUBBLES', subtitle: `top 100 caps · size = ${tf} move`, themeName })
  return { png, caption: `🫧 <b>Market Bubbles</b> — biggest ${tf} movers in the top 100` }
}

async function xBubbles(themeName) {
  const boot = await api.xdashBootstrap('24h', 50)
  const tokens = (boot?.tokens || []).filter((t) => (t.effective_external_mentions_24h ?? t.mentions_24h) > 0).slice(0, 24)
  if (!tokens.length) return null
  const changeOf = await xChangeLookup(tokens)
  const items = tokens.map((t) => ({
    label: (t.symbol || t.our_symbol || '').toUpperCase(),
    size: t.effective_external_mentions_24h ?? t.mentions_24h,
    change: changeOf(t),
    sub: `${compact(t.effective_external_mentions_24h ?? t.mentions_24h)} X`,
    logo: t.image_small || t.image_thumb || t.image_url,
  }))
  const png = await bubblesPng({ items, title: 'X BUBBLES', subtitle: 'size = X mentions 24h · color = price 24h', themeName })
  return { png, caption: '🫧 <b>X Bubbles</b> — where 𝕏 attention is right now\n<i>/scan SYMBOL or /kol SYMBOL to dig in</i>' }
}

// ---- lists

async function runnersCard() {
  const boot = await api.xdashBootstrap('24h', 100)
  const rows = (boot?.tokens || [])
    .filter((t) => {
      const mc = t.market_cap || 0
      const mentions = t.effective_external_mentions_24h ?? t.mentions_24h ?? 0
      return mc >= 300e3 && mc <= 150e6 && mentions >= 10 && !t.is_major_asset && !t.is_stable_like && !t.is_wrapped_like
    })
    .sort((a, b) => {
      // xdash price_change_24h is often null — rank by 24h move when we have it,
      // velocity (mentions vs daily avg) otherwise
      const score = (t) =>
        isFinite(t.price_change_24h) && t.price_change_24h != null
          ? 1000 + t.price_change_24h
          : t.velocity_ratio ?? (t.effective_external_mentions_24h ?? t.mentions_24h ?? 0) / 100
      return score(b) - score(a)
    })
    .slice(0, 12)
  if (!rows.length) return '🏃 No low-cap runners with social backing right now.'
  const lines = ['🏃 <b>Low-Cap Runners</b> — $300K–$150M mcap, 𝕏-backed, 24h', '']
  rows.forEach((t, i) => {
    const mentions = t.effective_external_mentions_24h ?? t.mentions_24h
    const chain = t.chain ? ` · ${esc(String(t.chain))}` : ''
    const chg = isFinite(t.price_change_24h) && t.price_change_24h != null ? `${move(t.price_change_24h)} · ` : ''
    const vel = t.velocity_ratio > 1.5 ? ` · 🔥${t.velocity_ratio.toFixed(1)}x` : ''
    lines.push(
      `${i + 1}. <b>${esc((t.symbol || '').toUpperCase())}</b> ${chg}${usd(t.market_cap)} · ${compact(mentions)} 𝕏${vel}${chain}`,
    )
  })
  lines.push('', '<i>/scan SYMBOL — full read before you ape</i>')
  return lines.join('\n')
}

async function signalsCard() {
  const [feed, intel, hunter] = await Promise.all([
    api.signalsFeed(14).catch(() => null),
    api.intelSignals(8).catch(() => null),
    api.get('/v1/brain/hunter', { ttlMs: 3 * 60e3 }).catch(() => null),
  ])
  const items = []
  const seen = new Set()
  for (const e of (hunter?.edges || []).slice(0, 4)) {
    const key = (e.headline || '').slice(0, 60)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ sev: '🎯', title: e.headline, tag: ['hunter', e.detector, e.asset].filter(Boolean).join(' · '), at: e.ts })
  }
  for (const s of feed || []) {
    const key = (s.title || '').slice(0, 60)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      sev: SEV[s.severity] || '⚪',
      title: s.title,
      tag: [s.signalType, s.asset].filter(Boolean).join(' · '),
      at: s.createdAt,
    })
  }
  for (const s of intel || []) {
    const key = (s.headline || '').slice(0, 60)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ sev: s.score >= 80 ? '🟠' : '⚪', title: s.headline, tag: [s.signalType, s.asset].filter(Boolean).join(' · '), at: s.createdAt })
  }
  if (!items.length) return '📡 No live signals right now — quiet tape.'
  const lines = ['📡 <b>Spectre Signals</b> — live detector feed', '']
  for (const s of items.slice(0, 10)) {
    lines.push(`${s.sev} <b>${esc(s.title)}</b>`)
    lines.push(`     <i>${esc(s.tag)}${s.at ? ` · ${ago(s.at)}` : ''}</i>`)
  }
  return lines.join('\n')
}

async function topCard() {
  const rows = await topRows(100)
  if (!rows.length) return '📊 Market data warming up — try again shortly.'
  const sorted = rows.slice().sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0))
  const gainers = sorted.slice(0, 6)
  const losers = sorted.slice(-6).reverse()
  const lines = ['📊 <b>Top Movers</b> — top 100 caps, 24h', '', '<b>Gainers</b>']
  for (const r of gainers) lines.push(`${esc(r.symbol.toUpperCase())} ${move(r.price_change_percentage_24h)} · ${price(r.current_price)}`)
  lines.push('', '<b>Losers</b>')
  for (const r of losers) lines.push(`${esc(r.symbol.toUpperCase())} ${move(r.price_change_percentage_24h)} · ${price(r.current_price)}`)
  return lines.join('\n')
}

module.exports = { marketHeatmap, xHeatmap, marketBubbles, xBubbles, runnersCard, signalsCard, topCard }
