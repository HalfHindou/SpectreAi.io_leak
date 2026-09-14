// Message-card builders (HTML). One dense message = full decision surface.
// Photo captions are capped at 1024 chars — scan card must stay tight.
const api = require('./spectre-api')
const { ema, rsi } = require('./indicators')
const { esc, price, usd, compact, pct, move, ago } = require('./format')

async function coin(symbol) {
  const data = await api.prices([symbol])
  const row = data?.[symbol.toUpperCase()]
  if (!row || !(row.price > 0)) return null // zero-price rows are junk catalog entries
  return row
}

function priceCard(c) {
  const ch = c.change || {}
  return [
    `<b>${esc(c.name)}</b> · ${esc(c.symbol)}${c.rank ? `  #${c.rank}` : ''}`,
    `<b>${price(c.price)}</b>  ${move(ch['24h'])} 24h`,
    '',
    `1h ${pct(ch['1h'])} · 7d ${pct(ch['7d'])} · 30d ${pct(ch['30d'])}`,
    `MCap ${usd(c.market_cap)} · Vol ${usd(c.volume_24h)}`,
    `24h range ${price(c.low_24h)} — ${price(c.high_24h)}`,
  ].join('\n')
}

// One-line technical read computed from candles — no LLM
function taLine(candles, tfLabel) {
  if (!candles || candles.length < 21) return null
  const closes = candles.map((x) => x.close)
  const last = closes[closes.length - 1]
  const e20 = ema(closes, 20)[closes.length - 1]
  const e50 = ema(closes, 50)[closes.length - 1]
  const r = rsi(closes)[closes.length - 1]
  const parts = []
  if (e20 != null && e50 != null) {
    if (last > e20 && e20 > e50) parts.push('bull stack (P&gt;EMA20&gt;EMA50)')
    else if (last < e20 && e20 < e50) parts.push('bear stack (P&lt;EMA20&lt;EMA50)')
    else parts.push(last > e20 ? 'above EMA20, mixed trend' : 'below EMA20, mixed trend')
  } else if (e20 != null) {
    parts.push(last > e20 ? 'above EMA20' : 'below EMA20')
  }
  if (r != null) {
    const zone = r >= 70 ? 'stretched' : r <= 30 ? 'washed out' : r >= 55 ? 'momentum up' : r <= 45 ? 'momentum down' : 'neutral'
    parts.push(`RSI ${r.toFixed(0)} ${zone}`)
  }
  return parts.length ? `<b>TA ${esc(tfLabel)}</b>: ${parts.join(' · ')}` : null
}

function socialLine(row) {
  if (!row) return null
  const mentions = row.effective_external_mentions_24h ?? row.external_mentions_24h ?? row.mentions_24h
  const authors = row.effective_unique_external_authors_24h ?? row.unique_external_authors_24h
  if (mentions == null) return null
  const parts = [`${compact(mentions)} mentions`, authors != null ? `${compact(authors)} voices` : null]
  const avg = row.external_mentions_prev_daily_avg
  if (avg > 0 && mentions != null) {
    const delta = ((mentions - avg) / avg) * 100
    parts.push(`${delta >= 0 ? '▲' : '▼'} ${pct(delta, 0)} vs avg`)
  }
  if (row.clean_signal_score_24h != null) parts.push(`signal ${Math.round(row.clean_signal_score_24h)}`)
  return `<b>𝕏 24h</b>: ${parts.filter(Boolean).join(' · ')}`
}

// Author entries arrive in several shapes across lanes — X-Dash bootstrap uses
// `screen_name`. Anything without an extractable handle is dropped, never
// stringified (the "@[object Object]" bug).
function topAuthors(row, limit = 6) {
  const list = row?.top_authors
  if (!Array.isArray(list) || !list.length) return []
  return list
    .slice(0, limit)
    .map((a) => {
      if (typeof a === 'string') return { handle: a, n: null }
      const handle =
        a.handle || a.username || a.screen_name ||
        (typeof a.author === 'string' ? a.author : a.author?.handle || a.author?.screen_name) ||
        null
      return handle ? { handle, n: a.mentions ?? a.mention_count ?? a.count ?? null } : null
    })
    .filter(Boolean)
}

// Scan caption — the /x money shot. Target ≤1000 chars. Every row renders
// only the fields that exist — a thin low-cap must never print "$0" or "—".
function scanCard(c, social, candles, tfLabel) {
  const ch = c.change || {}
  const sameName = !c.name || String(c.name).toUpperCase() === String(c.symbol).toUpperCase()
  const head = `<b>${esc(c.symbol)}${sameName ? '' : ` · ${esc(c.name)}`}</b> — <b>${price(c.price)}</b>${ch['24h'] != null ? ` ${move(ch['24h'])}` : ''}`
  const l2 = []
  if (c.market_cap) l2.push(`MCap ${usd(c.market_cap)}`)
  if (c.liquidity) l2.push(`Liq ${usd(c.liquidity)}`)
  if (c.volume_24h) l2.push(`Vol ${usd(c.volume_24h)}`)
  if (c.rank) l2.push(`#${c.rank}`)
  const l3 = []
  if (ch['1h'] != null) l3.push(`1h ${pct(ch['1h'])}`)
  if (ch['7d'] != null) l3.push(`7d ${pct(ch['7d'])}`)
  if (ch['30d'] != null) l3.push(`30d ${pct(ch['30d'])}`)
  if (c.low_24h != null && c.high_24h != null) l3.push(`range ${price(c.low_24h)}–${price(c.high_24h)}`)
  const lines = [head]
  if (l2.length) lines.push(l2.join(' · '))
  if (l3.length) lines.push(l3.join(' · '))
  const soc = socialLine(social)
  if (soc) {
    lines.push('', soc)
    const authors = topAuthors(social, 3)
    if (authors.length) lines.push(`Top voices: ${authors.map((a) => '@' + esc(a.handle)).join(' · ')}`)
  }
  const ta = taLine(candles, tfLabel)
  if (ta) lines.push('', ta)
  return lines.join('\n')
}

async function marketCard() {
  const [g, fg, p] = await Promise.all([
    api.globalStats().catch(() => null),
    api.fearGreed().catch(() => null),
    api.prices(['BTC', 'ETH', 'SOL']).catch(() => null),
  ])
  const lines = ['🌐 <b>Market</b>']
  if (g) {
    lines.push(
      `Total MCap ${usd(+g.total_market_cap)} ${move(+g.market_cap_change_24h)} · Vol ${usd(+g.total_volume_24h)}`,
      `BTC dom ${(+g.btc_dominance).toFixed(1)}% · ETH dom ${(+g.eth_dominance).toFixed(1)}%`,
    )
  }
  const cur = fg?.current
  if (cur) lines.push(`Fear &amp; Greed: <b>${cur.value}</b> — ${esc(cur.classification)}`)
  if (p) {
    lines.push('')
    for (const s of ['BTC', 'ETH', 'SOL']) {
      const r = p[s]
      if (r) lines.push(`${s} ${price(r.price)} ${move(r.change?.['24h'])}`)
    }
  }
  // regime read composed from the numbers above — no LLM
  if (g) {
    const mc = +g.market_cap_change_24h
    const dom = +g.btc_dominance
    const fgv = fg?.current ? Number(fg.current.value) : null
    const read =
      mc > 1.5
        ? `Tape is green (+${mc.toFixed(1)}% total cap)${fgv != null && fgv < 45 ? ' while the crowd still reads fear — disbelief rallies are the ones that keep going' : dom > 55 ? ', led by BTC — alts follow only if dominance stalls' : ' with breadth — risk appetite is real today'}`
        : mc < -1.5
          ? `Tape is red (${mc.toFixed(1)}% total cap)${dom > 55 ? ' and dominance is high — money hides in BTC while alts take the beating' : ' with alts holding share — controlled de-risk, not panic'}`
          : `Flat tape (${mc >= 0 ? '+' : ''}${mc.toFixed(1)}%)${fgv != null ? ` with the crowd at ${fgv} — compression like this usually resolves with one violent move` : ' — coiling, not trending'}`
    const playbook =
      mc > 1.5
        ? 'Strength is confirmed when dips get bought — buying the first pullback beats chasing the candle. If you missed the move, waiting costs nothing.'
        : mc < -1.5
          ? 'Defense first: smaller size, fewer trades. Let the selling exhaust itself — the reclaim of a lost level is your entry signal, not the dip itself.'
          : 'Quiet tape = preparation time. Mark the range edges, set alerts there, and wait for the market to invite you in — forcing trades in chop pays fees, not profits.'
    lines.push('', `<blockquote>🧠 ${read}.\n📌 <b>Playbook:</b> ${playbook}</blockquote>`)
  }
  return lines.join('\n')
}

async function newsCard(limit = 6) {
  const items = await api.news(limit)
  if (!Array.isArray(items) || !items.length) return '📰 No fresh headlines right now.'
  const lines = ['📰 <b>Latest</b>', '']
  for (const n of items.slice(0, limit)) {
    const title = esc((n.title || '').slice(0, 110))
    const when = n.publishedAt || n.published_at || n.time || n.created_at
    lines.push(`• <a href="${esc(n.url)}">${title}</a>`)
    // no source names in bot output — importance + recency only
    lines.push(`   ${n.importance ? `${esc(n.importance)} · ` : ''}${when ? ago(when) : ''}`)
  }
  return lines.join('\n')
}

async function deskCard() {
  const d = await api.brainDesk()
  if (!d) return '🧠 Desk is regenerating — try again in a minute.'
  const lines = ['🧠 <b>Spectre Brain — Desk</b>']
  if (d.regime) lines.push(`<i>${esc(d.regime)}</i>`, '')
  for (const b of (d.brief || []).slice(0, 3)) lines.push(`• ${esc(b)}`)
  const watching = (d.watching || []).slice(0, 3)
  if (watching.length) {
    lines.push('', '<b>Watching</b>')
    for (const w of watching) lines.push(`• ${esc(w)}`)
  }
  const conv = (d.convergence || [])[0]
  if (conv?.asset) {
    lines.push('', `<b>Top convergence</b>: ${esc(conv.asset)}${conv.tier ? ` (${esc(conv.tier)})` : ''}`)
    if (conv.why) lines.push(`<blockquote expandable>${esc(conv.why)}</blockquote>`)
  }
  return lines.join('\n')
}

async function xdashCard() {
  const boot = await api.xdashBootstrap('24h', 30)
  const tokens = (boot?.tokens || []).slice(0, 10)
  if (!tokens.length) return '𝕏 X-Dash feed is warming up — try again shortly.'
  const lines = ['𝕏 <b>X-Dash — Attention (24h)</b>', '']
  tokens.forEach((t, i) => {
    const mentions = t.effective_external_mentions_24h ?? t.external_mentions_24h ?? t.mentions_24h
    const authors = t.effective_unique_external_authors_24h ?? t.unique_external_authors_24h
    const chg = t.price_change_24h
    lines.push(
      `${i + 1}. <b>${esc(t.symbol || t.our_symbol)}</b> — ${compact(mentions)} mentions · ${compact(authors)} voices` +
        `${t.market_cap ? ` · ${usd(t.market_cap)}` : ''}${chg != null ? ` · ${move(chg)}` : ''}`,
    )
  })
  lines.push('', '<i>/scan SYMBOL for a full scan · /kol SYMBOL for voices</i>')
  return lines.join('\n')
}

function kolCard(symbol, row) {
  if (!row) return `𝕏 No X-Dash coverage for <b>${esc(symbol.toUpperCase())}</b> in the last 24h.`
  const authors = topAuthors(row, 8)
  const lines = [`𝕏 <b>Who's talking ${esc(row.symbol || symbol.toUpperCase())}</b> (24h)`]
  const soc = socialLine(row)
  if (soc) lines.push(soc, '')
  if (authors.length) for (const a of authors) lines.push(`• @${esc(a.handle)}${a.n != null ? ` — ${a.n}` : ''}`)
  else lines.push('<i>Author breakdown not available for this token.</i>')
  if (row.latest_mention_at) lines.push('', `Last mention ${ago(row.latest_mention_at)}`)
  return lines.join('\n')
}

// ── Fear & Greed: text gauge card (premium, zero-render-cost) ──
function fgZone(v) {
  return v < 25 ? '😱 Extreme Fear' : v < 45 ? '😨 Fear' : v < 55 ? '😐 Neutral' : v < 75 ? '😊 Greed' : '🤑 Extreme Greed'
}
async function fearGreedCard(mode = 'full') {
  const [fg, g] = await Promise.all([api.fearGreed().catch(() => null), api.globalStats().catch(() => null)])
  const cur = fg?.current
  if (!cur) return '😐 Fear & Greed is refreshing — try again in a minute.'
  const v = Number(cur.value)
  const filled = Math.max(0, Math.min(20, Math.round(v / 5)))
  const bar = '▰'.repeat(filled) + '▱'.repeat(20 - filled)
  const caption = mode === 'caption' // the gauge PNG carries the visual — no text bar
  // walk history for the first reading older than each window
  const hist = fg.history || []
  const now = Date.now()
  const at = (h) => {
    const row = hist.find((x) => now - new Date(x.time).getTime() >= h * 3600e3)
    return row ? Number(row.value) : null
  }
  const yday = at(24)
  const week = at(24 * 7)
  const lines = caption
    ? [`${fgZone(v).split(' ')[0]} <b>FEAR &amp; GREED — ${v}</b> · ${esc(cur.classification || '')}`]
    : [
        `${fgZone(v).split(' ')[0]} <b>FEAR &amp; GREED</b>`,
        '',
        `<b>${v}</b> — ${esc(cur.classification || fgZone(v).split(' ').slice(1).join(' '))}`,
        `<code>${bar}</code>`,
        '<code>0 😱          😐          🤑 100</code>',
      ]
  const deltas = []
  if (yday != null) deltas.push(`24h ago <b>${yday}</b>`)
  if (week != null) deltas.push(`7d ago <b>${week}</b>`)
  if (deltas.length) lines.push('', deltas.join(' · '))
  if (g) lines.push('', `BTC dom ${(+g.btc_dominance).toFixed(1)}% · Total MCap ${usd(+g.total_market_cap)} ${move(+g.market_cap_change_24h)}`)
  lines.push(
    '',
    `<blockquote>🧠 ${
      v < 30
        ? 'Deep fear — historically where forced sellers meet patient bids. Not a timing signal on its own.'
        : v < 45
          ? 'Cautious tape. Crowd leaning defensive — trend needs a catalyst to flip.'
          : v < 65
            ? 'Balanced tape — neither capitulation nor euphoria doing your work for you.'
            : 'Greed zone — crowd is long and loud. Chase risk is at its highest here.'
    }</blockquote>`,
  )
  lines.push('', '<i>⌁ Spectre Intelligence · Fear &amp; Greed</i>')
  return lines.join('\n')
}

// ── 𝕏 social market thesis (hourly writer on the box) ──
async function thesisCard() {
  const t = await api.get('/v1/social/thesis', { ttlMs: 5 * 60e3, timeoutMs: 20e3 }).catch(() => null)
  if (!t) return '𝕏 The social thesis is being rewritten — try again shortly.'
  const lines = ['𝕏 <b>SOCIAL MARKET THESIS</b>']
  if (t.regime?.label) lines.push(`<i>Regime: ${esc(t.regime.label)} · F&amp;G ${t.regime.fear_greed ?? '—'}</i>`)
  if (t.regime?.summary) lines.push('', `<blockquote>${esc(String(t.regime.summary).slice(0, 400))}</blockquote>`)
  const heroRead = t.social?.headline || t.headline || t.read || null
  if (heroRead) lines.push('', `<b>${esc(String(heroRead).slice(0, 200))}</b>`)
  const sectors = (t.sectors || []).slice(0, 4)
  if (sectors.length) {
    lines.push('', '<b>Where the attention is</b>')
    for (const sct of sectors) {
      const drivers = (sct.driving_tokens || []).slice(0, 3).map((d) => `$${esc(d.symbol)}`).join(' ')
      lines.push(`▸ ${esc(sct.sector)} · heat ${Number(sct.heat).toFixed(1)}${drivers ? ` · ${drivers}` : ''}`)
    }
  }
  lines.push('', '<i>⌁ Spectre Intelligence · 𝕏 Thesis — regenerates hourly</i>')
  return lines.join('\n')
}

// ── /lore — the desk historian. Gather EVERYTHING we hold on the project
// (registry identity, brain intel, real chatter + sentiment split, receipts,
// live stats) and have the LLM narrate it. One Groq call, heavy-rate-limited.
async function loreCard(symbol) {
  const sym = String(symbol).toUpperCase()
  const [row, mo, reg, mentions] = await Promise.all([
    api.socialRow(sym).catch(() => null),
    api.get(`/v1/social/momentum-origin/${encodeURIComponent(sym.toLowerCase())}`, { ttlMs: 10 * 60e3 }).catch(() => null),
    api.get(`/v1/brain/projects/registry?q=${encodeURIComponent(sym.toLowerCase())}`, { ttlMs: 10 * 60e3 }).catch(() => null),
    api.get(`/v1/social/mentions/${encodeURIComponent(sym)}?limit=25`, { ttlMs: 5 * 60e3 }).catch(() => null),
  ])
  const hit = (reg || []).find((p2) => (p2.symbol || '').toUpperCase() === sym) || null
  let intel = []
  if (hit?.project_key) {
    const all = await api.get('/v1/brain/intel?limit=150', { ttlMs: 10 * 60e3 }).catch(() => null)
    intel = (all || []).filter((it) => it.project_key === hit.project_key).slice(0, 6)
      .map((it) => ({ category: it.category, headline: it.headline, observations: it.observation_count }))
  }
  const tweets = (mentions?.top_engaged || []).slice(0, 5).map((t2) => ({
    author: t2.screen_name || t2.author || null,
    text: String(t2.text || t2.content || '').slice(0, 200),
    engagement: t2.engagement || t2.weighted_engagement || null,
  })).filter((t2) => t2.text)
  const evidence = {
    symbol: sym,
    name: row?.name || hit?.name,
    chain: row?.chain,
    official_x_handle: hit?.x_handle || null,
    contracts: (hit?.contracts || []).slice(0, 3).map((c2) => ({ chain: c2.chain, address: c2.address })),
    category: row?.primary_category || (Array.isArray(row?.category) ? row.category.slice(0, 3) : null),
    market_cap_now: row?.market_cap,
    mentions_24h: mentions?.totals?.mentions ?? row?.effective_external_mentions_24h,
    distinct_voices_24h: mentions?.totals?.distinct_authors,
    crowd_sentiment: mentions?.by_sentiment || null,
    first_tracked_by_spectre: mo?.first_entered_at,
    mcap_when_first_tracked: mo?.entry_market_cap,
    peak_mcap: mo?.peak_market_cap,
    peak_roi_pct: mo?.peak_roi_pct,
    brain_intel_items: intel,
    real_tweets_sample: tweets,
  }
  if (!process.env.GROQ_API_KEY) return null
  const g = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content:
            "You are the Spectre Intelligence desk historian. Write the LORE of a crypto project from the EVIDENCE dossier: what it is, where it surfaced, who carries it (use the official handle and the real voices in the sample), what the crowd believes right now (use the sentiment split), and what its tape has done (use the Spectre first-tracked/peak receipts — that's the project's arc). Quote or paraphrase the real tweets when they capture the vibe. Be vivid and concrete. NEVER write filler like 'not well-documented' or 'information is unclear' — if a chapter is unknown, skip it and tell the story of what IS known. A few tight paragraphs. No financial advice, no price predictions.",
        },
        { role: 'user', content: `EVIDENCE DOSSIER:\n${JSON.stringify(evidence)}` },
      ],
    }),
    signal: AbortSignal.timeout(45e3),
  }).then((r2) => (r2.ok ? r2.json() : null)).catch(() => null)
  const answer = g?.choices?.[0]?.message?.content
  if (!answer) return null
  const receipts = mo?.entry_market_cap > 0
    ? `\n📡 Spotted ${usd(mo.entry_market_cap)}${mo.peak_market_cap > mo.entry_market_cap ? ` → peak ${usd(mo.peak_market_cap)}` : ''}${row?.market_cap ? ` · now ${usd(row.market_cap)}` : ''}`
    : ''
  return [
    `📜 <b>$${esc(sym)} — LORE</b>${row?.name && row.name.toUpperCase() !== sym ? ` · ${esc(row.name)}` : ''}`,
    '',
    `<blockquote expandable>${esc(String(answer).slice(0, 3400))}</blockquote>`,
    receipts,
    '',
    '<i>⌁ Spectre Intelligence · Brain historian</i>',
  ].filter(Boolean).join('\n')
}

module.exports = { coin, priceCard, scanCard, marketCard, newsCard, deskCard, xdashCard, kolCard, taLine, fearGreedCard, thesisCard, loreCard }
