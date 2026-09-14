// Signal subscriptions: proactive alerts fanned out to DMs, groups and
// user-owned channels, with per-chat frequency caps (no spam) and quality
// gates (data signals = majors only; degen runner radar owns the low-cap lane).
//
// Sources: /v1/news/breaking (45s, instant), /v1/notifications/feed +
// /v1/brain/hunter (90s), xdash runner radar (3min).
const { InlineKeyboard, InputFile } = require('grammy')
const api = require('./spectre-api')
const banners = require('./signal-banners')
const majorsWatch = require('./majors-watch')
const i18n = require('./i18n')
const store = require('./store')
const { esc, usd, compact, pct, move, price, ago } = require('./format')
const { APP_URL, tradeTokenUrl, XDASH_BASE, XDASH_KEY } = require('./config')

// direct X-Dash collector API — fast-breakout stream, filtered by the FIRE rule
// from the 2026-07-10 backtests. On TRUE CoinGecko hourly curves (board-snapshot
// outcomes proved unreliable): n=43, WR15 21% at 72h, median −3%, but 26% touch
// +50% within 7d — the value is TAIL EXPOSURE, not median edge. Still ~3x the
// broad-stream base rate. Continuation/late entries backtested NEGATIVE
// (R24≥+50% → median −22% next 48h): one alert per token, never re-alert
// strength, copy stays "high-variance lottery ticket", never a promise.
const FIRE = { mcapMin: 1e6, mcapMax: 25e6, maxAuthors: 25, tierAMcap: 5e6 }

async function fastBreakouts() {
  if (!XDASH_KEY) return null
  const res = await fetch(`${XDASH_BASE}/api/momentum/breakouts/fast?version=fast_breakout_watch_v1&timeframe=24h&limit=50`, {
    headers: { 'X-API-Key': XDASH_KEY },
    signal: AbortSignal.timeout(20e3),
  }).catch(() => null)
  if (!res?.ok) return null
  return res.json().catch(() => null)
}

function fireRule(fb) {
  const mcap = fb?.signal_market_cap
  const authors = fb?.metrics_used?.unique_external_authors_24h
  if (!mcap || mcap < FIRE.mcapMin || mcap >= FIRE.mcapMax) return null
  if (authors == null || authors >= FIRE.maxAuthors) return null
  return { tierA: mcap >= FIRE.tierAMcap }
}

// ---- the card design system (premium pass, 2026-07-13):
// CAPS header with a hairline rule, ▸ stat rows with bold labels and
// monospace values, 🧠 blockquote read, branded italic footer. Emoji are
// deliberate and sparse — one category glyph per card, geometry elsewhere.
const HEADS = {
  breaking: '⚡️ <b>BREAKING</b>',
  runners: '🛰 <b>DEGEN RUNNER</b>',
  social: '𝕏 <b>SOCIAL SURGE</b>',
  brain: '🧠 <b>AI DESK CALL</b>',
  risk: '🛡 <b>RISK ALERT</b>',
  stocks: '📈 <b>EQUITY EVENT</b>',
  data: '📊 <b>DATA SIGNAL</b>',
  pulse: '🌐 <b>MARKET PULSE</b>',
}

// Spectre speaks in its own voice — "Source: TradingView."-style credits and
// "<Outlet> EN:" wire prefixes are stripped wherever upstream copy carries
// them (founder rule 07-16: never cite TradingView or any outlet). The credit
// match requires Capitalized name words so "Sources: officials say…"
// journalism copy survives.
const SOURCE_RX = /\b[Ss]ources?\s*[:：]\s*[A-Z][\w@.&'’-]{1,24}(?:\s+[A-Z][\w@.&'’-]{1,24}){0,2}\s*(?=[.;)]|$)/g
// upstream copy arrives with HTML entities baked in ("&#036;BTC" showed
// LITERALLY on a live card — our esc() re-escaped the ampersand). Decode
// numeric + common named entities here, ONCE, always before esc().
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d{1,7});/g, (m, n) => { const c = parseInt(n, 10); return c > 31 && c <= 0x10ffff ? String.fromCodePoint(c) : m })
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => { const c = parseInt(h, 16); return c > 31 && c <= 0x10ffff ? String.fromCodePoint(c) : m })
    .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
}
function stripSource(s) {
  let t = decodeEntities(s)
  t = t.replace(/^[A-Za-z][\w]{1,18}\s+(EN|News|Feed|Wire)\s*:\s*/i, '')
  t = t.replace(/[（(]\s*sources?\s*[:：][^)）]{2,60}[)）]/gi, ' ')
  t = t.replace(SOURCE_RX, '')
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([.;,!?])/g, '$1').replace(/\.{2,}/g, '.').trim()
}

// "->" from upstream detectors renders as a proper arrow
const polish = (s) => stripSource(String(s ?? '').replace(/\s*->\s*/g, ' → '))

const brandFooter = (tag) => `<i>⌁ Spectre Intelligence${tag ? ` · ${tag}` : ''}</i>`

// best category for the read: skip "<Chain> Ecosystem" tags — they just
// repeat the chain ("BNB Chain Ecosystem on BNB Chain")
function pickCategory(primary, arr) {
  const cands = [primary, ...(Array.isArray(arr) ? arr : [])].filter(Boolean)
  return cands.find((c) => !/ecosystem/i.test(String(c))) || null
}

// "$SYM — Name · ⛓ Chain" identity row (name skipped when it just repeats the ticker)
function identityRow(symbol, name, chain) {
  const sym = String(symbol || '').toUpperCase()
  const nm = name && String(name).toUpperCase() !== sym ? ` — ${esc(name)}` : ''
  const ch = chainTag(chain)
  return `<b>$${esc(sym)}</b>${nm}${ch ? ` · ${ch}` : ''}`
}

function breakoutMessage(row, tierA) {
  const t = row.token || {}
  const fb = row.fast_breakout_watch || {}
  const m = fb.metrics_used || {}
  const contract = Object.values(t.platforms || {}).find((v) => /^[a-zA-Z0-9.:]{20,}$/.test(String(v))) || null
  const lines = [
    `🚀 <b>BREAKOUT SIGNAL</b>${tierA ? ' · ⭐ HIGH CONVICTION' : ''}`,
    identityRow(t.symbol, t.name, t.chain),
    `▸ <b>Voices</b> ${m.unique_external_authors_24h ?? '—'} (early) · <b>Velocity</b> ${m.velocity_ratio?.toFixed(1) ?? '—'}×`,
    `▸ <b>Score</b> ${fb.breakout_score?.toFixed(0) ?? '—'} · <b>Signal cap</b> <code>${usd(fb.signal_market_cap)}</code>`,
    brandFooter(`${prettyTag(fb.stage)} — high-variance lottery ticket; most fade, tail pays. Never chase green.`),
  ]
  return {
    text: lines.join('\n'),
    asset: (t.symbol || '').toUpperCase(),
    contract,
    cgId: t.cg_id || t.token_id || null,
    social: {
      name: t.name,
      category: pickCategory(t.primary_category, t.category),
      chain: t.chain,
      mcap: fb.signal_market_cap,
      velocity: m.velocity_ratio,
    },
  }
}

// Priority order matters: when a chat hits its frequency cap, higher wins.
const CATS = {
  breaking: { label: '⚡️ Breaking News', hint: 'headlines the second they drop', priority: 0 },
  runners: { label: '🛰 Degen Runners', hint: 'low-cap onchain runners — Robinhood/SOL/Base heat', priority: 1 },
  brain: { label: '🧠 AI Desk Calls', hint: 'published Brain desk calls — gated, receipts-tracked', priority: 2 },
  social: { label: '𝕏 Social Surge', hint: 'mention spikes, narrative onsets', priority: 3 },
  risk: { label: '🛡 Risk', hint: 'fragility warnings, hacks', priority: 4 },
  stocks: { label: '📈 Equities', hint: 'stock movers & key events — SPCX, majors', priority: 5 },
  data: { label: '📊 Data Signals', hint: 'funding/OI anomalies — majors only', priority: 6 },
  pulse: { label: '🌐 Market Pulse', hint: 'macro reads, BTC/ETH key levels & big moves', priority: 7 },
}

const FREQ_CYCLE = [6, 12, 0, 2] // alerts/hour; 0 = unlimited
const CHAIN_TAG = { robinhood: '🏹 Robinhood', solana: '◎ Solana', base: '🔵 Base', ethereum: '⟠ Ethereum', 'binance-smart-chain': '🟡 BNB Chain' }

// Proper-case chain names for upstream prose. early_runner bodies arrive lower-
// cased ("...on solana." / "...on bsc.") — render them professionally. Only a
// lowercase token right after "on " that is a known chain is rewritten, so
// "On-chain" / "buzzing on X" are never touched.
const CHAIN_NAMES = {
  solana: 'Solana', base: 'Base', bsc: 'BNB Chain', 'binance-smart-chain': 'BNB Chain',
  ethereum: 'Ethereum', eth: 'Ethereum', monad: 'Monad', robinhood: 'Robinhood',
  arbitrum: 'Arbitrum', polygon: 'Polygon', avalanche: 'Avalanche', avax: 'Avalanche',
  optimism: 'Optimism', tron: 'Tron', ton: 'TON', sui: 'Sui', aptos: 'Aptos',
  blast: 'Blast', hyperliquid: 'Hyperliquid', cronos: 'Cronos', berachain: 'Berachain',
}
function prettifyChains(text) {
  if (!text) return text
  return String(text).replace(/\bon ([a-z][a-z0-9-]+)\b/g, (m, c) => (CHAIN_NAMES[c.toLowerCase()] ? `on ${CHAIN_NAMES[c.toLowerCase()]}` : m))
}

// chain chip for headlines — emoji tag when we have one, proper name otherwise
function chainTag(chain) {
  if (!chain) return ''
  const c = String(chain).toLowerCase()
  return CHAIN_TAG[c] || esc(CHAIN_NAMES[c] || c.charAt(0).toUpperCase() + c.slice(1))
}

// "narrative_onset" → "Narrative Onset" — signal tags render like copy, not code
const prettyTag = (s) => esc(
  String(s || '').replace(/[_-]+/g, ' ').trim().replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase()),
)

// ---- quality gates

let majorsCache = { at: 0, set: new Set() }
async function majorsSet() {
  if (Date.now() - majorsCache.at < 10 * 60e3) return majorsCache.set
  const rows = (await api.markets(100).catch(() => null)) || []
  if (rows.length) majorsCache = { at: Date.now(), set: new Set(rows.map((r) => r.symbol.toUpperCase())) }
  return majorsCache.set
}

const BREAKING_NOISE = /block mined|difficulty adjust|transactions?, 1\./i
function breakingWorthy(n) {
  if (!n.title || BREAKING_NOISE.test(n.title)) return false
  // plain VIP tweets (x_vip lane) are not breaking NEWS — they read as spam.
  // Real headlines only; tweet-sourced items must carry a "JUST IN"-class marker.
  const src = `${n.source || ''} ${n.source_type || ''} ${n.sourceDomain || ''}`.toLowerCase()
  if ((src.includes('x_vip') || src.includes('tweet') || /^@|\(@/.test(n.title)) && !/just in|breaking/i.test(n.title)) return false
  return n.importance === 'alert' || n.importance === 'high' || (n.score ?? 0) >= 75
}

// US equities don't trade weekends — an equity "today" mover on a closed
// market is stale/garbage (founder 07-19: "markets are closed today", NFLX
// -7.3% on a Sunday at a bogus $68.95). True unless a session has actually run
// today in New York (weekday, at/after the 09:30 ET open — through after-hours
// and the evening the move stays valid to report).
function usMarketHadSessionToday() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date())
    const wd = parts.find((p) => p.type === 'weekday')?.value
    const hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const min = Number(parts.find((p) => p.type === 'minute')?.value)
    if (wd === 'Sat' || wd === 'Sun') return false            // no weekend session
    if (hour < 9 || (hour === 9 && min < 30)) return false     // before the 09:30 ET open — "today" hasn't traded
    return true
  } catch { return true }
}

function classifyFeed(item) {
  const t = String(item.signalType || item.type || '').toLowerCase()
  if (t.includes('breakout') || t.includes('early_runner') || t.includes('runner') || t.includes('listing')) return 'runners'
  if (t.includes('momentum') || t.includes('social') || t.includes('mindshare')) return 'social'
  if (t.includes('fragility') || t.includes('hack') || t.includes('security')) return 'risk'
  if (t.includes('equity') || t.includes('stock') || t.includes('earnings') || t.includes('ipo')) return 'stocks'
  if (t.includes('funding') || t.includes('oi') || t.includes('volume') || t.includes('liquidation')) return 'data'
  return 'pulse'
}

// Derivative anomalies leak into the /v1/news/breaking lane upstream
// ("SOL funding flip: negative -> positive"). They are DATA signals, not
// headlines — reroute. And a flip where every number rounds to zero
// (−0.0000% → 0.0000%) is detector noise, not a signal — drop it.
const DERIV_RX = /funding (rate|flip)|open interest|long.short|liquidation cascade|orderbook/i
function derivNoise(text) {
  const nums = String(text).match(/-?\d+\.\d+\s*%/g) || []
  return nums.length > 0 && nums.every((v) => Math.abs(parseFloat(v)) < 0.001)
}

function classifyEdge(edge) {
  const d = String(edge.detector || '').toLowerCase()
  if (d.includes('listing')) return 'runners'
  if (d.includes('onset') || d.includes('narrative') || d.includes('social')) return 'social'
  return 'data'
}

// ---- message builders

const SEV_EMOJI = { critical: '🔴', high: '🔴' } // medium/low dots were noise

function breakingMessage(n) {
  const lines = [HEADS.breaking, `<b>${esc(polish(n.title))}</b>`]
  if (n.summary && n.summary !== n.title) lines.push('', esc(polish(String(n.summary).slice(0, 220))))
  // timestamp only — never the source name (Spectre's voice, no attribution)
  lines.push('', brandFooter(n.publishedAt ? `Newswire · ${ago(n.publishedAt)}` : 'Newswire'))
  return { text: lines.join('\n'), asset: n.relatedAssets?.[0], url: n.url }
}

// "BTC $63.9K (-1.7% 24h) · ETH $1.9K (-2.7% 24h) · BTC dominance 56.2% ·
// Fear & Greed 34 (Fear)" — upstream digests glue stats into one ·-run that
// wraps mid-number on phones (founder 07-16: "line per line, not fitted next
// to each other"). 3+ short ·-segments become ▸ rows, metric names bolded.
function dotRows(body) {
  const parts = String(body).split(' · ').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 3 || parts.some((p) => p.length > 60)) return null
  return parts.map((p) => `▸ ${esc(p).replace(/^([^\d$(]{2,}?)(?=[\d$(])/, '<b>$1</b>')}`)
}

// Upstream digest bodies abbreviate PRICES to $X.XK ("ETH $1.8K") which shreds
// precision on a ~$1,875 number (founder 07-17 "make full eth price its too
// shorted"). Find "<SYM> $<n>K" price cells and swap the abbreviation for the
// real full price. Prices are never K-abbreviated; mcaps/volumes still are.
// group 1 = "<SYM>" + optional </b> + whitespace (preserved); group 2 = SYM.
// Tolerates dotRows' `<b>BTC </b>$62.7K` AND a raw `BTC $62.7K` body. Only the
// $X.XK token is swapped, so the bold/spacing survive.
const PRICE_ABBR_RX = /(\b([A-Z]{2,6})\b(?:\s*<\/b>)?\s*)\$[\d,.]+K\b/g
async function expandMajorPrices(text) {
  if (!text) return text
  const matches = [...text.matchAll(PRICE_ABBR_RX)]
  if (!matches.length) return text
  const syms = [...new Set(matches.map((m) => m[2].toUpperCase()))]
  const px = await api.prices(syms, { ttlMs: 30e3 }).catch(() => null)
  if (!px) return text
  return text.replace(PRICE_ABBR_RX, (full, prefix, sym) => {
    const p = px[sym.toUpperCase()]
    return p?.price ? `${prefix}${price(p.price)}` : full
  })
}

// A market-snapshot pulse (BTC + ETH + dominance + Fear&Greed rows) arrives with
// a single-asset title ("ETH -5.2% in 24h — risk-off move") that just repeats
// one of the rows (founder 07-17 "showing eth twice… better headline"). When
// the body is that snapshot, compose a market-WIDE headline from the numbers so
// the title adds context instead of duplicating a row.
function marketPulseHeadline(body) {
  const chOf = (sym) => {
    const m = String(body).match(new RegExp(`\\b${sym}\\b[^(]*\\(([+-]?[\\d.]+)%`, 'i'))
    return m ? parseFloat(m[1]) : null
  }
  const btc = chOf('BTC')
  const eth = chOf('ETH')
  const fgM = String(body).match(/Fear\s*&(?:amp;)?\s*Greed\s+(\d+)\s*\(([^)]+)\)/i)
  const fg = fgM ? parseInt(fgM[1], 10) : null
  const fgClass = fgM ? fgM[2].trim() : null
  if (btc == null && eth == null) return null
  const vals = [btc, eth].filter((v) => v != null)
  const allDown = vals.every((v) => v < -0.5)
  const allUp = vals.every((v) => v > 0.5)
  const worst = eth != null && btc != null ? (eth < btc ? 'ETH' : 'BTC') : null
  const fgWord = fgClass ? fgClass.toLowerCase() : null
  let lead
  if (allDown) {
    const deepest = Math.min(...vals)
    lead = deepest <= -4 ? 'Broad risk-off — majors bleeding' : 'Majors slip into the red'
    if (fgWord && /fear/i.test(fgWord)) lead += `, ${fgWord} grips the tape`
    else if (worst) lead += `, ${worst} leading the drop`
  } else if (allUp) {
    lead = 'Risk-on — majors bid across the board'
    if (fgWord && /greed/i.test(fgWord)) lead += `, ${fgWord} building`
  } else {
    lead = 'Majors split — no clean risk signal'
  }
  // RAW text contract: this return value becomes `title`, which feedMessage
  // runs through esc() — pre-escaping here double-escapes ("F&amp;amp;G"
  // rendered literally as "F&amp;G 35" on a live card, holder feedback
  // 2026-07-20). Plain "&" only; esc() owns the escaping.
  return `${lead}${fg != null ? ` (F&G ${fg})` : ''}`
}

function feedMessage(item, cat) {
  const isPreCg = String(item.signalType || '').toLowerCase().includes('early_runner')
  const head = isPreCg ? '🌱 <b>PRE-COINGECKO RUNNER</b>' : HEADS[cat] || '📡 <b>SIGNAL</b>'
  const sev = SEV_EMOJI[item.severity]
  // digest titles repeat the stats the body already carries — keep the name
  let title = polish(item.title || '')
  if (/^daily market pulse/i.test(title)) title = 'Daily Market Pulse'
  // market-snapshot pulse → compose a market-wide headline (kills the "ETH twice"
  // dup where the title just echoes an asset row)
  const bodyStr = String(item.body || '')
  if (/dominance/i.test(bodyStr) && /Fear\s*&(?:amp;)?\s*Greed/i.test(bodyStr)) {
    const h = marketPulseHeadline(bodyStr)
    if (h) title = h
  }
  const lines = [`${head}${sev ? ` ${sev}` : ''}`, `<b>${esc(title)}</b>`]
  if (item.body && item.body !== item.title) {
    const body = polish(prettifyChains(String(item.body).slice(0, 300)))
    const rows = dotRows(body)
    if (rows) lines.push(...rows)
    else lines.push(esc(body))
  }
  lines.push(brandFooter([prettyTag(item.signalType), item.asset ? `$${esc(String(item.asset).toUpperCase())}` : null].filter(Boolean).join(' · ')))
  return { text: lines.join('\n'), asset: item.asset }
}

// Published Brain desk convergence → a call card with receipts vocabulary.
// Internal [lens-edge: …] annotations are stripped — desk plumbing, not copy.
function deskCallMessage(c) {
  const dir = String(c.direction || '').toLowerCase()
  const dirTag = dir === 'bull' ? '▲ Bull' : dir === 'bear' ? '▼ Bear' : prettyTag(c.direction)
  const why = String(c.why || '').replace(/\s*\[lens-edge:[^\]]*\]/g, '').trim()
  const lines = [
    HEADS.brain,
    `<b>$${esc(String(c.asset || '').toUpperCase())}</b> — ${dirTag} · ${esc(c.horizon || '—')} horizon${c.altitude ? ` · ${prettyTag(c.altitude)}` : ''}`,
    `▸ <b>Conviction</b> ${c.conviction ?? '—'}/100 · <b>Gate</b> ${prettyTag(c.gate)}`,
  ]
  const lv = []
  if (c.key_level) lv.push(`<b>Key level</b> <code>${price(c.key_level)}</code>`)
  if (c.entry_price) lv.push(`<b>Entry</b> <code>${price(c.entry_price)}</code>`)
  if (lv.length) lines.push(`▸ ${lv.join(' · ')}`)
  if ((c.lenses || []).length) lines.push(`▸ <b>Lenses</b> ${c.lenses.map((l) => esc(l)).join(' · ')}`)
  lines.push(brandFooter('AI Desk · receipts-tracked · not financial advice'))
  return {
    text: lines.join('\n'),
    asset: String(c.asset || '').toUpperCase(),
    cgId: c.cg_id || null,
    rz: c.altitude === 'major',
    readText: why ? why.slice(0, 300) : null, // rides the standard 🧠 slot, after stats
  }
}

function edgeMessage(edge, cat) {
  const tail = ['Hunter', prettyTag(edge.detector), edge.asset ? `$${esc(String(edge.asset).toUpperCase())}` : null].filter(Boolean).join(' · ')
  return {
    text: [HEADS[cat] || '🎯 <b>SIGNAL</b>', `<b>${esc(edge.headline || '')}</b>`, brandFooter(tail)].join('\n'),
    asset: edge.asset,
  }
}

function runnerMessage(t, mentions, velocity) {
  const voices = (t.top_authors || []).slice(0, 2).map((a) => '@' + esc(typeof a === 'string' ? a : a.handle || a.username || '')).filter((s) => s !== '@')
  const plat = t.platforms || {}
  const contract = Object.values(plat).find((v) => /^[a-zA-Z0-9.:]{20,}$/.test(String(v))) || t.contract_address || null
  const lines = [
    HEADS.runners,
    identityRow(t.symbol, t.name, t.chain),
    `▸ <b>Buzz</b> ${compact(mentions)} 𝕏 mentions · ${velocity.toFixed(1)}× daily avg${voices.length ? ` · ${voices.join(' ')}` : ''}`,
    brandFooter('Degen Radar'),
  ]
  return {
    text: lines.join('\n'),
    asset: (t.symbol || '').toUpperCase(),
    contract,
    cgId: t.token_id || t.cg_id || null,
    social: {
      name: t.name,
      category: pickCategory(t.primary_category, t.category),
      chain: t.chain,
      mcap: t.market_cap,
      mentions,
      velocity,
    },
  }
}

// ---- DexScreener enrichment: one lookup per contract powers (a) the live
// stats line (MC / vol / liq / moves / age), (b) the DexScreener button
// (exact top-liquidity pair URL) and (c) the banner image when the team
// uploaded one (Enhanced Token Info). Fail-open: alerts send fine without it.

function pairToDex(p) {
  if (!p) return null
  return {
    url: p.url || null,
    banner: p.info?.header || null,
    chainId: p.chainId || null,
    baseAddress: p.baseToken?.address || null,
    name: p.baseToken?.name || null,
    price: p.priceUsd != null ? Number(p.priceUsd) : null,
    mcap: p.marketCap || p.fdv || null,
    vol24: p.volume?.h24 ?? null,
    liq: p.liquidity?.usd ?? null,
    ch1: p.priceChange?.h1 ?? null,
    ch24: p.priceChange?.h24 ?? null,
    ageMs: p.pairCreatedAt ? Math.max(0, Date.now() - p.pairCreatedAt) : null,
  }
}

// Banner fallback: the pairs API only carries info.header for some profiles,
// but DexScreener hosts every uploaded banner at a predictable CDN path that
// 301s to the image (200) or a JSON 404. One HEAD probe, cached 30min either
// way. EVM paths are lowercase; Solana base58 is case-sensitive — keep as-is.
const _bannerCache = new Map()
async function probeBanner(chainId, address) {
  if (!chainId || !address) return null
  const addr = /^0x/i.test(address) ? String(address).toLowerCase() : String(address)
  const url = `https://dd.dexscreener.com/ds-data/tokens/${chainId}/${addr}/header.png`
  const hit = _bannerCache.get(url)
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.found
  let found = null
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(6e3) })
    // hand Telegram the post-redirect CDN URL — direct image, no 301 hop
    if (res.ok && /image/i.test(res.headers.get('content-type') || '')) found = res.url || url
  } catch { /* fail-open: no banner */ }
  _bannerCache.set(url, { at: Date.now(), found })
  if (_bannerCache.size > 500) _bannerCache.delete(_bannerCache.keys().next().value)
  return found
}

const _dexCache = new Map()
async function dexEnrich(contract) {
  if (!contract) return null
  const key = String(contract).toLowerCase()
  const hit = _dexCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.data
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`, { signal: AbortSignal.timeout(8e3) }).catch(() => null)
  const pairs = res?.ok ? (await res.json().catch(() => null))?.pairs || [] : []
  const data = pairs.length ? pairToDex(pairs.reduce((a, b) => ((b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a))) : null
  if (data && !data.banner) data.banner = await probeBanner(data.chainId, data.baseAddress).catch(() => null)
  _dexCache.set(key, { at: Date.now(), data })
  if (_dexCache.size > 300) _dexCache.delete(_dexCache.keys().next().value)
  return data
}

function fmtAge(ms) {
  if (ms == null) return null
  const h = ms / 3600e3
  if (h < 1) return `${Math.max(1, Math.round(ms / 60e3))}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

// stat rows, one per line (the Rick-bot lesson: scannable > compact).
// DexScreener data when a contract resolved; X-Dash row numbers otherwise
// (full social row only for social-cat alerts — runner cards already carry
// their buzz line, so the fallback stays MC-only there).
function statsRows(msg) {
  const d = msg.dex
  if (d) {
    const rows = []
    const r1 = []
    if (d.mcap) r1.push(`<b>Cap</b> <code>${usd(d.mcap)}</code>`)
    if (d.liq != null) r1.push(`<b>Liq</b> <code>${usd(d.liq)}</code>`)
    if (r1.length) rows.push(`▸ ${r1.join(' · ')}`)
    if (d.vol24 != null) {
      const turn = d.mcap ? ` · ${((d.vol24 / d.mcap) * 100).toFixed(0)}% turnover` : ''
      rows.push(`▸ <b>Vol</b> <code>${usd(d.vol24)}</code>${turn}`)
    }
    const r3 = []
    if (d.ch1 != null) r3.push(`1h ${pct(d.ch1, 1)}`)
    if (d.ch24 != null) r3.push(`24h ${move(d.ch24, 1)}`)
    const age = fmtAge(d.ageMs)
    if (age) r3.push(`age ${age}`)
    if (r3.length) rows.push(`▸ <b>Tape</b> ${r3.join(' · ')}`)
    return rows
  }
  if (msg.stock) {
    const q = msg.stock
    const rows = []
    const r1 = []
    if (q.price != null) r1.push(`<b>Price</b> <code>${price(q.price)}</code>`)
    if (q.change24 != null) r1.push(`24h ${move(q.change24, 1)}`)
    if (q.change7d != null) r1.push(`7d ${pct(q.change7d, 1)}`)
    if (r1.length) rows.push(`▸ ${r1.join(' · ')}`)
    if (q.mcap) rows.push(`▸ <b>Cap</b> <code>${usd(q.mcap)}</code>`)
    return rows
  }
  if (msg.px) {
    const r = []
    if (msg.px.price != null) r.push(`<b>Price</b> <code>${price(msg.px.price)}</code>`)
    const ch = msg.px.change?.['24h'] ?? msg.px.change_24h_pct ?? msg.px.change24h ?? null
    if (ch != null && isFinite(Number(ch))) r.push(`24h ${move(Number(ch), 1)}`)
    if (msg.px.market_cap) r.push(`<b>Cap</b> <code>${usd(msg.px.market_cap)}</code>`)
    return r.length ? [`▸ ${r.join(' · ')}`] : []
  }
  const s = msg.social
  if (!s) return []
  const parts = []
  if (s.mcap) parts.push(`<b>Cap</b> <code>${usd(s.mcap)}</code>`)
  if (msg.cat === 'social') {
    if (s.mentions) parts.push(`𝕏 ${compact(s.mentions)} mentions`)
    if (Number.isFinite(s.velocity) && s.velocity > 0) parts.push(`⚡ ${s.velocity.toFixed(1)}× velocity`)
  }
  return parts.length ? [`▸ ${parts.join(' · ')}`] : []
}

// The read: one honest paragraph composed from numbers already fetched.
// Deterministic — no LLM, no extra latency. Identity → talk-vs-flow → chatter
// tone → price guard, with the risk-first rules from the X-Dash tone work
// (bullish chatter on a falling tape is a warning, not a green light; green
// that already ran is not an entry).
function readLine(msg) {
  const s = msg.social || {}
  const d = msg.dex || {}
  const chainName = s.chain ? (() => { const c = String(s.chain).toLowerCase(); return CHAIN_NAMES[c] || c.charAt(0).toUpperCase() + c.slice(1) })() : null
  // no category → no identity fragment (the chain already sits in the identity
  // row; a bare "on BNB Chain." reads broken)
  const what = s.category ? [s.category, chainName ? `on ${chainName}` : null].filter(Boolean).join(' ') : null
  const turnover = d.vol24 != null && d.mcap ? (d.vol24 / d.mcap) * 100 : null
  const vel = Number.isFinite(s.velocity) && s.velocity > 0 ? s.velocity : null
  const bits = []
  // buzz phrased by direction — 0.5× is cooling, not a surge
  if (vel != null) {
    let flow = vel >= 1.5 ? `buzz ${vel.toFixed(1)}× daily average` : vel >= 0.9 ? 'buzz steady at its daily average' : `buzz cooling — ${vel.toFixed(1)}× daily average`
    if (turnover != null) {
      if (turnover < 4 && vel >= 1.5) flow += ` on a thin tape (${turnover.toFixed(0)}% turnover) — talk running ahead of flow`
      else if (turnover > 40) flow += `, and the tape backs it (${turnover.toFixed(0)}% turnover)`
      else flow += ` with ${turnover.toFixed(0)}% turnover behind it`
    }
    bits.push(flow)
  } else if (turnover != null && turnover > 40) {
    bits.push(`heavy tape — ${turnover.toFixed(0)}% of MC traded in 24h`)
  }
  // lean computed from the shares, not the upstream label — 43% bull vs 7%
  // bear is a lean, whatever the classifier's neutral bucket says
  const t = msg.tone
  if (t && (t.sample ?? 0) >= 12) {
    const bull = Math.round((t.bull_share ?? 0) * 100)
    const bear = Math.round((t.bear_share ?? 0) * 100)
    const bullLean = bull >= 25 && bull >= bear * 1.4
    const bearLean = bear >= 25 && bear >= bull * 1.4
    if (bullLean && d.ch24 != null && d.ch24 <= -10) bits.push(`chatter still bullish (${bull}% vs ${bear}%) into a falling tape — bid or bags?`)
    else if (bullLean) bits.push(`chatter leans bullish (${bull}% vs ${bear}%)`)
    else if (bearLean) bits.push(`chatter leans bearish (${bear}% vs ${bull}%)`)
    else if (bull || bear) bits.push(`chatter split (${bull}% bull / ${bear}% bear)`)
  }
  if (d.ch24 != null && d.ch24 <= -20) bits.push(`down ${Math.abs(d.ch24).toFixed(0)}% on the day — knife, not a dip signal`)
  else if (d.ch24 != null && d.ch24 >= 50) bits.push(`already +${d.ch24.toFixed(0)}% today — never chase green`)
  if (!what && !bits.length) return null
  let sent = bits.join('; ')
  if (sent) sent = sent.charAt(0).toUpperCase() + sent.slice(1) + '.'
  return [what ? `${esc(what)}.` : null, sent ? esc(sent) : null].filter(Boolean).join(' ')
}

// assemble the final card: body → stat rows → 🧠 read → italic footer,
// each block separated by a blank line
function finalizeText(msg) {
  const lines = String(msg.text).split('\n')
  const fi = lines.findIndex((l) => l.startsWith('<i>'))
  const body = fi === -1 ? lines : lines.slice(0, fi)
  const footer = fi === -1 ? [] : lines.slice(fi)
  const out = [...body]
  while (out.length && out[out.length - 1] === '') out.pop()
  const stats = statsRows(msg)
  if (msg.origin) {
    const o = msg.origin
    const bits = [`<b>Spotted</b> <code>${usd(o.entry_market_cap)}</code>${o.first_entered_at ? ` · ${ago(o.first_entered_at)}` : ''}`]
    if (Number(o.peak_market_cap) > Number(o.entry_market_cap)) bits.push(`<b>Peak</b> <code>${usd(o.peak_market_cap)}</code>`)
    stats.push(`▸ ${bits.join(' → ')}`)
  }
  // verified CA, tap-to-copy — skipped when the card body already carries it
  // (Caller Wire) and never rendered for unverified tokens
  if (msg.contract && !String(msg.text).includes(msg.contract)) stats.push(`<code>${esc(msg.contract)}</code>`)
  if (stats.length) out.push('', ...stats)
  const read = msg.readText ? esc(msg.readText) : readLine(msg)
  if (read) out.push('', `<blockquote>🧠 ${read}</blockquote>`)
  if (footer.length) out.push('', ...footer)
  return out.join('\n')
}

// ✍️ compact view: the whole signal as ONE styled line — head · headline ·
// key stat chip. Chosen per-chat from the /subscribe panel; chats that find
// the photo cards heavy keep the intel without the ink. Derived from the
// finalized card so every lane (poller, newswire, caller wire) gets it free.
function compactLine(msg) {
  const lines = String(msg.text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const body = lines.filter((l) => !l.startsWith('<i>') && !l.startsWith('<blockquote') && !l.startsWith('▸') && !l.startsWith('<code>'))
  const head = body[0] || HEADS[msg.cat] || ''
  const main = body[1] && body[1] !== head ? body[1] : ''
  const chips = []
  if (msg.dex?.mcap) chips.push(`<code>${usd(msg.dex.mcap)}</code>`)
  if (msg.dex?.ch24 != null) chips.push(move(msg.dex.ch24, 1))
  else if (msg.stock?.price != null) {
    chips.push(`<code>${price(msg.stock.price)}</code>`)
    if (msg.stock.change24 != null) chips.push(move(msg.stock.change24, 1))
  } else if (msg.px?.price != null) chips.push(`<code>${price(msg.px.price)}</code>`)
  const parts = [head]
  if (main) parts.push(main)
  if (chips.length) parts.push(chips.join(' '))
  return `${parts.join(' · ')} <i>⌁</i>`
}

// Link policy (the NORMIE lesson — RZ resolved a ticker to a $200K clone):
// every Spectre button must land ON THE TOKEN, never on a generic board.
// contract known → AI Screener by CA (trade.spectreai.io/#token/<ca>, always
// right) + DexScreener (exact pair when enriched). cg_id known → X-Dash token
// drawer deep-link (/x-dash/token/<id>?view=full — fullscreen brief). Nothing
// resolvable → Scan only; generic board links trained users to skip buttons.
function alertKeyboard(msg, botUsername, lang = 'en') {
  const T = (k) => i18n.t(lang, k)
  const kbd = new InlineKeyboard()
  if (msg.asset) kbd.url(`🔎 ${T('btn.scan')}`, `https://t.me/${botUsername}?start=scan_${encodeURIComponent(msg.asset)}`)
  if (msg.contract) kbd.url('AI Screener ↗', tradeTokenUrl(msg.contract))
  const row2 = []
  if (msg.cgId) row2.push(['𝕏 X-Dash ↗', `${APP_URL}/x-dash/token/${encodeURIComponent(msg.cgId)}?view=full`])
  if (msg.contract) row2.push(['DexScreener ↗', msg.dex?.url || `https://dexscreener.com/search?q=${encodeURIComponent(msg.contract)}`])
  else if (msg.asset && (msg.cat === 'runners' || msg.cat === 'social')) {
    // no verified contract → DexScreener's own search page (their disambiguation
    // UI, never a guessed pair) so a token card always carries a chart button
    row2.push(['DexScreener ↗', `https://dexscreener.com/search?q=${encodeURIComponent(msg.asset)}`])
  }
  if (msg.asset && (msg.rz || msg.cat === 'data')) row2.push([`📈 ${T('btn.research')} ↗`, `${APP_URL}/research-zone/${String(msg.asset).toLowerCase()}`])
  if (row2.length) {
    kbd.row()
    for (const [label, url] of row2.slice(0, 2)) kbd.url(label, url)
  } else if (msg.url) {
    kbd.url(`${T('btn.read')} ↗`, msg.url)
  }
  return kbd
}

// token resolution for alerts that arrive symbol-only (hunter/feed):
// X-Dash bootstrap → Brain entity registry → nulls (= no unsafe link).
// Returns { contract, cgId } — cgId powers the X-Dash token deep-link, the
// contract powers AI Screener / DexScreener. Every contract candidate is
// on-chain VERIFIED before use (verifyToken), so a wrong address never becomes
// an "AI Screener" deep-link. The registry path is the one that produced the
// STX/Stacks clone — hard-gated below.
async function resolveToken(asset) {
  if (!asset) return { contract: null, cgId: null, social: null }
  const want = String(asset).toUpperCase()
  // 1) X-Dash-tracked row for this symbol — cg_id comes free; the contract is a
  //    strict address, then verified it really is this token (not a
  //    wallet/deployer that got scraped into platforms).
  const row = await api.socialRow(asset).catch(() => null)
  let cgId = row?.token_id || row?.cg_id || null
  // still nothing? momentum_origin resolves symbol → slug for everything the
  // radar ever tracked (deeper than the live board) — enough for the X-Dash link
  if (!cgId) {
    const mo = await api.get(`/v1/social/momentum-origin/${encodeURIComponent(String(asset).toLowerCase())}`, { ttlMs: 10 * 60e3 }).catch(() => null)
    if (mo?.asset && String(mo.symbol || '').toUpperCase() === want) cgId = mo.asset
  }
  const social = row
    ? {
        name: row.name,
        category: pickCategory(row.primary_category, row.category),
        chain: row.chain,
        mcap: row.market_cap,
        mentions: row.effective_external_mentions_24h ?? row.mentions_24h,
        velocity: row.velocity_ratio,
      }
    : null
  const fromRow =
    row &&
    (Object.values(row.platforms || {}).find(api.isTokenAddress) ||
      (api.isTokenAddress(row.contract_address) ? row.contract_address : null))
  if (fromRow && (await api.verifyToken(fromRow, want))) return { contract: fromRow, cgId, social }
  // 2) Brain registry fallback. A CoinGecko-listed project (has cgId) is a KNOWN
  //    coin that resolves by ticker — NEVER hand back a scraped, ticker-matched
  //    contract for it (STX/Stacks: real Stacks [cgId blockstack] was mapped to an
  //    $18K Cronos "STX" clone @ source ds-liquidity / confidence 0.6). Only an
  //    unlisted/fresh token legitimately needs a scraped CA, and only a
  //    confidence≥0.7, on-chain-verified one.
  const reg = await api.get(`/v1/brain/projects/registry?q=${encodeURIComponent(String(asset).toLowerCase())}`, { ttlMs: 10 * 60e3 }).catch(() => null)
  const hit = (reg || []).find((p) => (p.symbol || '').toUpperCase() === want)
  if (!hit || hit.cgId || hit.cg_id) return { contract: null, cgId, social }
  const cands = (hit.contracts || [])
    .map((c) => (typeof c === 'string' ? { address: c, confidence: 0.7 } : c))
    .filter((c) => c && api.isTokenAddress(c.address) && Number(c.confidence ?? 0) >= 0.7)
    .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
  for (const c of cands) if (await api.verifyToken(c.address, want)) return { contract: c.address, cgId, social }
  return { contract: null, cgId, social }
}

// ---- settings UI

function subKeyboard(chatId) {
  const s = store.sub(chatId)
  const kbd = new InlineKeyboard()
  Object.entries(CATS).forEach(([cat, c], i) => {
    kbd.text(`${s?.cats?.[cat] ? '✅' : '☐'} ${c.label}`, `sb|${chatId}|${cat}`)
    if (i % 2 === 1) kbd.row()
  })
  kbd.row()
  const cap = s?.maxPerHour ?? 6
  kbd.text(`⏱ Max ${cap === 0 ? '∞' : cap}/hr — tap to change`, `sb|${chatId}|freq`)
  kbd.row().text(s?.view === 'compact' ? '✍️ View: One-liners — tap for full cards' : '🖼 View: Full cards — tap for one-liners', `sb|${chatId}|view`)
  kbd.row().text('🔕 Unsubscribe all', `sb|${chatId}|off`)
  return kbd
}

function subText(chat) {
  const where = chat.type === 'private' ? 'your DMs' : `<b>${esc(chat.title || 'this chat')}</b>`
  const lines = [`🔔 <b>Spectre signal alerts → ${where}</b>`, '<i>Tap to toggle. Frequency cap keeps it sane — priority signals win.</i>', '']
  for (const c of Object.values(CATS)) lines.push(`${c.label} — <i>${esc(c.hint)}</i>`)
  return lines.join('\n')
}

function cycleFreq(chatId) {
  const s = store.sub(chatId)
  if (!s) return 6
  const cur = s.maxPerHour ?? 6
  const next = FREQ_CYCLE[(FREQ_CYCLE.indexOf(cur) + 1) % FREQ_CYCLE.length]
  store.upsertSub(chatId, { maxPerHour: next })
  return next
}

// per-chat frequency budget
function underCap(s) {
  const cap = s.maxPerHour ?? 6
  if (cap === 0) return true
  const cutoff = Date.now() - 3600e3
  s.sent = (s.sent || []).filter((ts) => ts > cutoff)
  return s.sent.length < cap
}

// ---- collection + delivery

// numbers drift between re-fires of the same signal ("29 authors @ $1.70M" →
// "31 authors @ $1.8M") — fingerprint on the words only
function norm(s) {
  return String(s || '').toLowerCase().replace(/[\d$.,%—–-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

// ---- macro storyline governor: geopolitical wires flip-flop by the hour
// (deal → no talks → strikes → talks again — founder audit 07-16 found 20
// Iran cards/24h incl. a same-minute contradiction pair). Stories are keyed
// by ACTORS, not wording: one card per storyline per 3h; the window breaks
// early only for MATERIAL events, never diplomatic mood swings.
// word-boundary PREFIX match: "iranian"→iran, "senators"→senate — but never
// "seNATOrs"→nato (the substring bug that spawned a phantom NATO storyline)
const MACRO_ACTORS = ['iran', 'israel', 'russia', 'ukrain', 'taiwan', 'gaza', 'hamas', 'hezbollah', 'houthi', 'north korea', 'venezuela', 'cuba', 'saudi', 'syria', 'yemen', 'kuwait', 'opec', 'nato', 'white house', 'trump', 'congress', 'senat', 'fed', 'middle east', 'europe'].map(
  (a) => [a, new RegExp(`\\b${a}\\w*`, 'i')],
)
const MATERIAL_RX = /\b(strikes?|struck|attack(?:ed|s)?|explosions?|blasts?|missiles?|drones?|projectiles?|shelling|raids?|intercept(?:ed|ing|s)?|casualt|killed|invasions?|invade[sd]?|bomb(?:ed|ing|s)?|shot down|declares? war|ceasefire (?:signed|agreed|announced)|deal (?:signed|reached|agreed)|sanctions (?:imposed|announced)|nuclear|rate (?:hike|cut) (?:announced|decision)|passes(?: law| act)?|signed into law)\b/i

function macroStoryline(title) {
  const t = String(title || '')
  const actors = MACRO_ACTORS.filter(([, rx]) => rx.test(t)).map(([a]) => a)
  // PRIMARY actor only: "iran", "iran+trump", "iran+kuwait" are one storyline —
  // per-combination keys would let the same conflict through under fresh keys
  return actors.length ? actors.sort()[0] : null
}

// owns the bookkeeping: absorbs mood swings inside the window, stamps posts
function macroGovernor(title) {
  const story = macroStoryline(title)
  if (!story) return { post: true, note: null }
  const st = store.macroStory(story)
  const cooling = st && Date.now() - st.at < 3 * 3600e3
  if (cooling && !MATERIAL_RX.test(String(title))) {
    store.macroAbsorb(story)
    return { post: false, note: null }
  }
  const absorbed = st?.absorbed || 0
  store.macroStamp(story)
  const label = story.replace(/\+/g, '/')
  return { post: true, note: absorbed >= 2 ? `absorbed ${absorbed} churning ${label} wires in the last hours — material updates only` : null }
}

// reworded-same-story dedupe: the same story arrives re-phrased across lanes
// and minutes ("NY governor terminates…" / "…policy under scrutiny" / "…policy
// criticized" ×3 in one minute) — word-set overlap vs recently posted titles
const _recentTitles = []
function fuzzyDupe(title) {
  const words = new Set(norm(title).split(' ').filter((w) => w.length > 3))
  if (words.size < 4) return false
  const now = Date.now()
  while (_recentTitles.length && now - _recentTitles[0].at > 12 * 3600e3) _recentTitles.shift()
  for (const r of _recentTitles) {
    let inter = 0
    for (const w of words) if (r.words.has(w)) inter++
    const uni = words.size + r.words.size - inter
    if (uni && inter / uni >= 0.6) return true
    // burst rule: rewordings of one story arrive within minutes ("NY governor
    // terminates…" ×3 in one minute) — 3 shared meaningful words in 30min = dup
    if (now - r.at <= 30 * 60e3 && inter >= 3 && words.size >= 5 && r.words.size >= 5) return true
  }
  _recentTitles.push({ words, at: now })
  if (_recentTitles.length > 80) _recentTitles.shift()
  return false
}

async function collect(tick, bootAt, seen) {
  const outbox = []

  // majors watch: every tick — BTC/ETH round-number crosses + violent hours
  // (founder ask 07-16: "like watcher guru does"). Self-gated inside via
  // contentSeen, so it rides the pulse lane without extra dedupe here.
  try {
    for (const m of await majorsWatch.scan()) if (!seen.has(m.id)) outbox.push(m)
  } catch (e) {
    console.error('[majors]', e.message)
  }

  // breaking: every tick (45s) — the WatcherGuru lane
  const breaking = (await api.get('/v1/news/breaking?limit=10', { ttlMs: 1, timeoutMs: 15e3 }).catch(() => null)) || []
  for (const n of breaking) {
    const id = `b:${n.id}`
    if (seen.has(id)) continue
    if (n.publishedAt && new Date(n.publishedAt).getTime() < bootAt - 10 * 60e3) {
      seen.add(id)
      store.contentSeen(`b:${norm(n.title)}`, 24 * 3600e3) // fingerprint skipped items too
      continue
    }
    if (!breakingWorthy(n)) {
      seen.add(id)
      continue
    }
    if (store.contentSeen(`b:${norm(n.title)}`, 24 * 3600e3)) {
      seen.add(id)
      continue
    }
    // derivative anomalies dressed as headlines → the data lane (majors only,
    // proper card), zero-value flips → the bin
    if (DERIV_RX.test(`${n.title} ${n.summary || ''}`)) {
      seen.add(id)
      if (derivNoise(`${n.title} ${n.summary || ''}`)) continue
      const asset = String(n.relatedAssets?.[0] || n.title.split(/\s/)[0] || '').toUpperCase()
      const majors = await majorsSet()
      if (!asset || !majors.has(asset)) continue
      if (store.contentSeen(`deriv:${asset}`, 6 * 3600e3)) continue
      // orderbook items carry venue context on-card (holder ask: which book?)
      const body = /orderbook/i.test(n.title) ? `${n.summary || ''} Binance spot book, top-20 levels, USD-weighted.`.trim() : n.summary
      outbox.push({ id, cat: 'data', ...feedMessage({ title: n.title, body, signalType: 'derivatives', asset, severity: 'medium' }, 'data') })
      continue
    }
    if (fuzzyDupe(n.title)) {
      seen.add(id)
      continue
    }
    const gov = macroGovernor(n.title)
    if (!gov.post) {
      seen.add(id)
      continue
    }
    const nn = gov.note
      ? { ...n, summary: [n.summary && n.summary !== n.title ? String(n.summary) : null, `Desk note: ${gov.note}`].filter(Boolean).join(' — ') }
      : n
    outbox.push({ id, cat: 'breaking', ...breakingMessage(nn) })
  }

  // detector feed + hunter: every 2nd tick (90s)
  if (tick % 2 === 0) {
    const majors = await majorsSet()
    const [feed, hunter] = await Promise.all([
      api.get('/v1/notifications/feed?limit=20', { ttlMs: 1 }).catch(() => null),
      api.get('/v1/brain/hunter', { ttlMs: 1 }).catch(() => null),
    ])
    for (const item of feed || []) {
      const id = `f:${item.id}`
      if (seen.has(id)) continue
      if (item.createdAt && new Date(item.createdAt).getTime() < bootAt - 15 * 60e3) {
        seen.add(id)
        store.contentSeen(`f:${item.signalType}:${item.asset || norm(item.title)}`, 12 * 3600e3)
        continue
      }
      // VIP/KOL account-tweet spam guard (founder 07-19: "6 nansen posts in one
      // shot… cant be this way"). The feed leaks raw brand/KOL tweets
      // (src=x_vip, type=breaking_news — @nansen_ai promo, referral threads,
      // RTs) that fell into the 'pulse' catch-all. These are marketing chatter,
      // not macro pulse: drop RTs + thread-parts + anything without a genuine
      // "JUST IN/BREAKING" marker, and cap real ones to 1 per author / 45min.
      {
        const srcStr = `${item.source || ''} ${item.source_type || ''} ${item.sourceDomain || ''}`.toLowerCase()
        const title = String(item.title || '')
        const handle = (title.match(/\(@(\w+)\)/) || title.match(/^@(\w+)\b/) || [])[1]
        const isVipTweet = srcStr.includes('x_vip') || srcStr.includes('tweet') || srcStr.includes('kol') || !!handle
        if (isVipTweet) {
          const body = title.replace(/^[^(]*\(@\w+\)\s*:\s*"?/, '')
          const isRtOrThread = /^RT @/i.test(body) || /^(\d+\/|end\/)/.test(body.trim())
          const breakingMarked = /\b(just in|breaking)\b/i.test(title)
          if (isRtOrThread || !breakingMarked) { seen.add(id); continue }
          if (handle && store.contentSeen(`vip:${handle.toLowerCase()}`, 45 * 60e3)) { seen.add(id); continue }
        }
      }
      const cat = classifyFeed(item)
      // equity movers on a closed US market are stale (weekend / pre-open) —
      // don't post them (founder 07-19: "markets are closed today")
      if (cat === 'stocks' && !usMarketHadSessionToday()) {
        seen.add(id)
        continue
      }
      if (cat === 'data' && item.asset && !majors.has(String(item.asset).toUpperCase())) {
        seen.add(id) // alt-coin derivative noise — not worth a ping
        continue
      }
      // same signal re-inserted upstream under a new id → one ping per type+asset per 12h;
      // runners dedupe cross-source (feed breakout + hunter listing = same token)
      const fp = cat === 'runners' && item.asset ? `runner:${String(item.asset).toUpperCase()}` : `f:${item.signalType}:${item.asset || norm(item.title)}`
      if (store.contentSeen(fp, 12 * 3600e3)) {
        seen.add(id)
        continue
      }
      let fitem = item
      if (String(item.signalType) === 'macro_news') {
        // THE flip-flop source (founder audit): storyline-govern + fuzzy-dedupe
        if (fuzzyDupe(item.title)) {
          seen.add(id)
          continue
        }
        const gov = macroGovernor(item.title)
        if (!gov.post) {
          seen.add(id)
          continue
        }
        if (gov.note) fitem = { ...item, body: [item.body && item.body !== item.title ? String(item.body) : null, `Desk note: ${gov.note}`].filter(Boolean).join(' — ') }
      }
      // desk self-grade (alpha_report): internal telemetry about the desk
      // itself, not market information — founder 07-16: "looks like a self
      // reporting dashboard but doesnt inform ppl about the market". Never
      // user-facing; it stays visible on /brain where it belongs.
      if (String(item.signalType) === 'alpha_report') {
        seen.add(id)
        continue
      }
      outbox.push({ id, cat, ...feedMessage(fitem, cat) })
    }
    for (const edge of hunter?.edges || []) {
      const id = `h:${edge.id}`
      if (seen.has(id)) continue
      if (edge.ts && new Date(edge.ts).getTime() < bootAt - 15 * 60e3) {
        seen.add(id)
        store.contentSeen(`h:${edge.detector}:${edge.asset || norm(edge.headline)}`, 12 * 3600e3)
        continue
      }
      const cat = classifyEdge(edge)
      if (cat === 'data' && (!edge.asset || !majors.has(String(edge.asset).toUpperCase()))) {
        seen.add(id) // the HEI-class filter: anomalies on random alts stay out
        continue
      }
      const efp = cat === 'runners' && edge.asset ? `runner:${String(edge.asset).toUpperCase()}` : `h:${edge.detector}:${edge.asset || norm(edge.headline)}`
      if (store.contentSeen(efp, 12 * 3600e3)) {
        seen.add(id)
        continue
      }
      outbox.push({ id, cat, ...edgeMessage(edge, cat) })
    }
  }

  // fast breakouts through the FIRE rule: every 2nd tick — THE premium runner lane
  if (tick % 2 === 0) {
    const fbData = await fastBreakouts()
    for (const row of fbData?.tokens || []) {
      const t = row.token || {}
      const fb = row.fast_breakout_watch || {}
      const signaledAt = fb.signal?.signaled_at
      const id = `fb:${t.cg_id || t.symbol}:${signaledAt || ''}`
      if (seen.has(id)) continue
      const verdict = fireRule(fb)
      if (!verdict) {
        seen.add(id) // outside the backtested pocket (incl. mcap≥25M = 9% WR, −31% median)
        continue
      }
      if (signaledAt && new Date(signaledAt).getTime() < bootAt - 30 * 60e3) {
        seen.add(id)
        store.contentSeen(`runner:${(t.symbol || '').toUpperCase()}`, 12 * 3600e3)
        continue
      }
      if (store.contentSeen(`runner:${(t.symbol || '').toUpperCase()}`, 12 * 3600e3)) {
        seen.add(id)
        continue
      }
      outbox.push({ id, cat: 'runners', ...breakoutMessage(row, verdict.tierA) })
    }
  }

  // AI desk calls: every 4th tick, offset from the runner radar — published,
  // gate-cleared convergence only (shadowed/safety-blocked calls stay internal)
  if (tick % 4 === 2) {
    const desk = await api.brainDesk().catch(() => null)
    for (const c of desk?.convergence || []) {
      if (String(c.tier || '').toLowerCase() !== 'published' || c.safety) continue
      const dir = String(c.direction || '').toLowerCase()
      const id = `d:${c.asset}:${dir}:${c.gate || ''}:${c.horizon || ''}`
      if (seen.has(id)) continue
      if (store.contentSeen(`desk:${c.asset}:${dir}`, 12 * 3600e3)) {
        seen.add(id)
        continue // one call per asset+direction per 12h across desk regens
      }
      outbox.push({ id, cat: 'brain', ...deskCallMessage(c) })
    }
  }

  // degen runner radar: every 4th tick (3min) — OUR low-cap detector, chain-aware
  if (tick % 4 === 0) {
    const boot = await api.xdashBootstrap('24h', 100).catch(() => null)
    for (const t of boot?.tokens || []) {
      const mentions = t.effective_external_mentions_24h ?? t.mentions_24h ?? 0
      const velocity = t.velocity_ratio ?? 0
      const mc = t.market_cap || 0
      if (mc < 300e3 || mc > 50e6) continue
      if (mentions < 20 || velocity < 3) continue
      if (t.is_major_asset || t.is_stable_like || t.is_wrapped_like) continue
      const id = `r:${t.token_id || t.cg_id || t.symbol}`
      if (seen.has(id)) continue
      if (store.contentSeen(`runner:${(t.symbol || '').toUpperCase()}`, 12 * 3600e3)) {
        seen.add(id)
        continue // one runner ping per token per 12h, across ALL sources and restarts
      }
      outbox.push({ id, cat: 'runners', ...runnerMessage(t, mentions, velocity) })
    }
  }

  return outbox
}

// Boot prime: fingerprint EVERYTHING currently visible in every source without
// delivering. Restarts can never replay; only post-boot novelties alert.
async function primeSeen() {
  const seen = store.seenSignals()
  const [breaking, feed, hunter] = await Promise.all([
    api.get('/v1/news/breaking?limit=20', { ttlMs: 1 }).catch(() => null),
    api.get('/v1/notifications/feed?limit=30', { ttlMs: 1 }).catch(() => null),
    api.get('/v1/brain/hunter', { ttlMs: 1 }).catch(() => null),
  ])
  for (const n of breaking || []) {
    seen.add(`b:${n.id}`)
    store.contentSeen(`b:${norm(n.title)}`, 24 * 3600e3)
  }
  for (const item of feed || []) {
    seen.add(`f:${item.id}`)
    store.contentSeen(`f:${item.signalType}:${item.asset || norm(item.title)}`, 12 * 3600e3)
  }
  for (const edge of hunter?.edges || []) {
    seen.add(`h:${edge.id}`)
    store.contentSeen(`h:${edge.detector}:${edge.asset || norm(edge.headline)}`, 12 * 3600e3)
  }
  const fbData = await fastBreakouts().catch(() => null)
  for (const row of fbData?.tokens || []) {
    const t = row.token || {}
    seen.add(`fb:${t.cg_id || t.symbol}:${row.fast_breakout_watch?.signal?.signaled_at || ''}`)
    store.contentSeen(`runner:${(t.symbol || '').toUpperCase()}`, 12 * 3600e3)
  }
  const desk = await api.brainDesk().catch(() => null)
  for (const c of desk?.convergence || []) {
    const dir = String(c.direction || '').toLowerCase()
    seen.add(`d:${c.asset}:${dir}:${c.gate || ''}:${c.horizon || ''}`)
    store.contentSeen(`desk:${c.asset}:${dir}`, 12 * 3600e3)
  }
  store.markSignalsSeen([...seen])
  console.log(`[signals] primed ${seen.size} seen ids — only post-boot signals will deliver`)
}

// shared fan-out: caps + per-chat budgets + grader tracking + dead-sub cleanup
async function deliverAll(bot, msgs, seen) {
  const subsList = store.allSubs()
  const me = bot.botInfo.username
  const grader = require('./grader')
  // last-chance resolution so low-cap alerts link by CA / cg_id, never by
  // ticker — then enrichment: DexScreener (stat rows, exact pair URL, banner),
  // Groq mention tone (both cached upstream), and the composed 🧠 read.
  for (const msg of msgs) {
    try {
    const tokenCat = msg.cat === 'runners' || msg.cat === 'social'
    if (msg.asset && tokenCat && (!msg.contract || !msg.cgId || !msg.social)) {
      const r = await resolveToken(msg.asset).catch(() => null)
      if (r) {
        msg.contract = msg.contract || r.contract
        msg.cgId = msg.cgId || r.cgId
        msg.social = msg.social || r.social
      }
    }
    if (msg.contract && msg.dex === undefined) msg.dex = await dexEnrich(msg.contract).catch(() => null)
    if (msg.asset && tokenCat && msg.tone === undefined) {
      const want = String(msg.asset).toUpperCase()
      const tones = await api.get(`/v1/social/tone?symbols=${encodeURIComponent(want)}`, { ttlMs: 60e3 }).catch(() => null)
      msg.tone = tones?.[want] || null
    }
    // equities get a live quote row; crypto data/desk cards get a price row
    if (msg.cat === 'stocks' && msg.asset && msg.stock === undefined) {
      msg.stock = await api.stockQuote(msg.asset).catch(() => null)
    }
    if ((msg.cat === 'data' || msg.cat === 'brain') && msg.asset && !msg.dex && msg.px === undefined) {
      const p = await api.prices([msg.asset], { ttlMs: 30e3 }).catch(() => null)
      msg.px = p?.[String(msg.asset).toUpperCase()] || null
    }
    // provenance: when Spectre FIRST saw the token (the AI Screener's "Spotted"
    // stamp) — a breakout detector fires later than first sight by design, so
    // the card shows both instead of letting the two surfaces disagree
    if (msg.cat === 'runners' && msg.asset && msg.origin === undefined) {
      const slug = String(msg.cgId || msg.asset).toLowerCase()
      const o = await api.get(`/v1/social/momentum-origin/${encodeURIComponent(slug)}`, { ttlMs: 5 * 60e3 }).catch(() => null)
      msg.origin = o && Number(o.entry_market_cap) > 0 ? o : null
    }
    // LIVE-TRUTH GATE (founder screenshot 2026-07-19: "DEGEN RUNNER breakout
    // @ $1.06M" delivered on a token whose live DexScreener row read Cap $6K ·
    // Liq $10K · Vol $697 — a rugged corpse still pumped by residual chatter,
    // the headline cap frozen at signal time). Hype lanes must agree with the
    // chain: corpse-tier cap/liquidity/volume kills the card, and so does a
    // live cap that collapsed ≥4× below what the signal claims — the headline
    // would be a lie either way. Fail-open when there is no DEX row at all
    // (majors / CEX-only tokens); risk-cat cards are exempt on purpose — a rug
    // WARNING about a dead token is legitimate, a runner hype card is not.
    if (tokenCat && msg.dex) {
      const d = msg.dex
      const claim = Math.max(Number(msg.social?.mcap) || 0, Number(msg.origin?.entry_market_cap) || 0)
      const corpse =
        (d.mcap > 0 && d.mcap < 75e3) ||
        (d.liq != null && d.liq < 15e3) ||
        (d.vol24 != null && d.vol24 < 2e3)
      const collapsed = claim > 0 && d.mcap > 0 && d.mcap < claim * 0.25
      if (corpse || collapsed) {
        console.log(
          `[signals] live-truth gate dropped ${msg.asset || msg.id} (${msg.cat}): live cap ${d.mcap ?? '—'} liq ${d.liq ?? '—'} vol24 ${d.vol24 ?? '—'}${collapsed ? ` vs claimed ${Math.round(claim)}` : ''}`,
        )
        msg.text = null // send loop skips null-text; id already fingerprinted in collect()
        continue
      }
    }
    // macro/data digests arrive with K-abbreviated prices — expand to full
    if (['pulse', 'data', 'breaking'].includes(msg.cat) && /\$[\d.]+K\b/.test(msg.text || '')) {
      msg.text = await expandMajorPrices(msg.text)
    }
    msg.text = finalizeText(msg)
    msg.compact = compactLine(msg)
    } catch (e) {
      // one malformed message must not nuke the whole batch — it was already
      // fingerprinted as seen in collect(), so a throw here loses ALL of them
      console.error('[signals] enrich failed for', msg.id, e.message)
    }
  }
  for (const msg of msgs) {
    if (!msg.text) continue // enrichment failed — skip, never send undefined
    let deliveredOnce = false
    // one image per card, always: token banner URL when DexScreener has one,
    // otherwise the branded category banner (rendered once per process,
    // uploaded once — the Telegram file_id covers every later send)
    let photo = msg.dex?.banner || banners.cachedFileId(msg.cat)
    let freshUpload = false
    if (!photo) {
      const buf = await banners.categoryBanner(msg.cat).catch(() => null)
      if (buf) {
        photo = new InputFile(buf, `spectre-${msg.cat}.png`)
        freshUpload = true
      }
    }
    for (const s of subsList) {
      if (!s.cats?.[msg.cat]) continue
      if (!underCap(s)) continue
      try {
        const lang = store.chatLang(s.chatId)
        const kbd = alertKeyboard(msg, me, lang)
        // per-chat view: full photo card (default) or the ✍️ one-liner —
        // compact chats skip the banner entirely, buttons stay
        const compactMode = s.view === 'compact' && msg.compact
        const base = compactMode ? msg.compact : msg.text
        const text = lang !== 'en' ? await i18n.translateCard(lang, base, `${compactMode ? 'sigc' : 'sig'}:${msg.id}`) : base
        // Telegram caps photo captions at 1024 VISIBLE chars (tags become
        // entities) — a rich card (or a longer translation) over the cap keeps
        // its full text and drops the banner instead of failing the send
        const fitsCaption = text.replace(/<[^>]+>/g, '').length <= 1024
        if (photo && fitsCaption && !compactMode) {
          // fall back to plain text when TG rejects the image, but let
          // sub-cleanup errors (blocked/kicked) reach the outer catch
          const sent = await bot.api
            .sendPhoto(s.chatId, photo, { caption: text, parse_mode: 'HTML', reply_markup: kbd })
            .catch(async (err) => {
              const desc = String(err.description || err.message || '')
              if (/blocked|kicked|chat not found|not enough rights|deactivated/i.test(desc)) throw err
              await bot.api.sendMessage(s.chatId, text, {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
                reply_markup: kbd,
              })
              return null
            })
          if (freshUpload && sent?.photo?.length) {
            const fid = sent.photo[sent.photo.length - 1].file_id
            banners.rememberFileId(msg.cat, fid)
            photo = fid
            freshUpload = false
          }
        } else {
          await bot.api.sendMessage(s.chatId, text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: kbd,
          })
        }
        if (!deliveredOnce) {
          deliveredOnce = true
          if (msg.asset || msg.contract) grader.track(msg)
        }
        s.sent = s.sent || []
        s.sent.push(Date.now())
        store.upsertSub(s.chatId, { sent: s.sent })
      } catch (err) {
        const desc = String(err.description || err.message || '')
        if (/blocked|kicked|chat not found|not enough rights|deactivated/i.test(desc)) {
          console.warn(`[signals] dropping sub ${s.chatId}: ${desc}`)
          store.removeSub(s.chatId)
        }
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    if (seen) seen.add(msg.id)
  }
}

// ---- free ultra-fast newswire: public t.me/s/ previews of flash channels
// (WatcherGuru & co post to TG in step with X — polling their public preview
// every 20s gives wire-speed headlines for $0, attributed)
const TG_CHANNELS = (process.env.BREAKING_TG_CHANNELS || 'WatcherGuru,BWEnews,TreeNewsFeed')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const lastPostId = new Map()

async function fetchChannelPosts(ch) {
  const res = await fetch(`https://t.me/s/${ch}`, { signal: AbortSignal.timeout(10e3) }).catch(() => null)
  if (!res?.ok) return []
  const raw = await res.text().catch(() => '')
  const out = []
  const blocks = raw.split('tgme_widget_message_wrap').slice(1)
  for (const block of blocks) {
    const id = parseInt(block.match(/data-post="[^"]+\/(\d+)"/)?.[1] || '0', 10)
    let text = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>(.*?)<\/div>/s)?.[1] || ''
    text = text.replace(/<br\/?>/g, ' ').replace(/<[^>]+>/g, '')
    text = text
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(new RegExp(`@${ch}\\s*$`, 'i'), '')
      .trim()
    if (id && text.length >= 30) out.push({ id, text })
  }
  return out.sort((a, b) => a.id - b.id)
}

// Caller Wire: trusted alpha channels → CA extraction → enriched runner alert.
// This is the VEX lesson: fresh non-catalog tokens are invisible to X-Dash
// (CG-catalog universe + reply-discounting), but caller channels catch them.
const CALLER_CHANNELS = (process.env.CALLER_TG_CHANNELS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

async function callerWireMsgs(ch, posts) {
  const out = []
  for (const p of posts) {
    const cas = [...new Set([...(p.text.match(/0x[a-fA-F0-9]{40}/g) || []), ...(p.text.match(/\b[1-9A-HJ-NP-Za-km-z]{40,44}\b/g) || [])])]
    for (const ca of cas.slice(0, 2)) {
      if (store.contentSeen(`ca:${ca.toLowerCase()}`, 24 * 3600e3)) continue
      // enrich via DexScreener by contract — identity is exact, never guessed
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(10e3) }).catch(() => null)
      const pairs = res?.ok ? (await res.json().catch(() => null))?.pairs || [] : []
      if (!pairs.length) continue
      const pair = pairs.reduce((a, b) => ((b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a))
      const sym = (pair.baseToken?.symbol || '').toUpperCase()
      const dex = pairToDex(pair) // stats line + button + banner ride the same fetch
      if (dex && !dex.banner) dex.banner = await probeBanner(dex.chainId, dex.baseAddress).catch(() => null)
      store.contentSeen(`runner:${sym}`, 12 * 3600e3)
      out.push({
        id: `cw:${ch}:${p.id}:${ca.slice(0, 10)}`,
        cat: 'runners',
        asset: sym,
        contract: ca,
        dex,
        text: [
          '🎯 <b>CALLER WIRE</b>',
                identityRow(sym, pair.baseToken?.name, pair.chainId),
          `<code>${esc(ca)}</code>`,
          brandFooter('Caller Wire — unvetted; check distribution &amp; team'),
        ].join('\n'),
        url: `https://t.me/${ch}/${p.id}`,
      })
    }
  }
  return out
}

// Newswire hygiene — headlines ship in Spectre's voice, English only:
// strip source tags ("AggrNews:"), t.co stubs, bilingual CJK duplicates,
// separator runs, trailing timestamps and "auto match" disclaimers. A post
// with no English left is skipped, never translated-by-accident.
// (A real per-chat language option = LLM translation per post — future.)
function cleanWireText(raw) {
  let text = String(raw || '')
  text = text.replace(/https?:\/\/t\.co\/\S+/gi, ' ')
  const cjk = text.search(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/)
  if (cjk === 0) return null
  if (cjk > 0) text = text.slice(0, cjk)
  text = text.replace(/^[A-Za-z][A-Za-z0-9_]{1,18}:\s+/, '')
  text = text.replace(/[A-Za-z][A-Za-z0-9_]{1,18}:\s*$/, '')
  text = stripSource(text) // "Binance EN:" prefixes + "Source: X" credits
  text = text.replace(/\(\s*Auto match[^)]*\)?/gi, ' ')
  text = text.replace(/[—–\-=]{3,}/g, ' ')
  text = text.replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?\b/g, ' ')
  text = text.replace(/:?\s*(WEBSITE|LINK|SOURCE)\s*$/i, '')
  text = text.replace(/\s{2,}/g, ' ').trim().replace(/[·:;,\-–—]$/, '').trim()
  return text.length >= 30 ? text : null
}

function startNewswire(bot) {
  let primed = false
  let busy = false // a slow delivery must not overlap the next tick
  setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const fresh = []
      for (const ch of TG_CHANNELS) {
        const posts = await fetchChannelPosts(ch)
        if (!posts.length) continue
        const last = lastPostId.get(ch) || 0
        lastPostId.set(ch, posts[posts.length - 1].id)
        if (!primed || last === 0) continue // first sight of a channel = prime only
        for (const p of posts) {
          if (p.id <= last) continue
          const cleaned = cleanWireText(p.text)
          if (!cleaned) continue // no English headline left after hygiene
          // cross-channel + cross-lane dedupe (same headline via our /v1/news/breaking)
          if (store.contentSeen(`b:${norm(cleaned)}`, 24 * 3600e3)) continue
          if (fuzzyDupe(cleaned)) continue
          const gov = macroGovernor(cleaned)
          if (!gov.post) continue
          // NO source attribution, ever — alerts speak in Spectre's voice only
          // (founder rule: "never write watcher guru or another source").
          // Read button routes to our newsroom, not the source channel.
          fresh.push({
            id: `w:${ch}:${p.id}`,
            cat: 'breaking',
            text: [HEADS.breaking, `<b>${esc(cleaned)}</b>`, ...(gov.note ? [`<i>🧠 ${esc(gov.note)}</i>`] : []), brandFooter('Newswire')].join('\n'),
            url: `${APP_URL}/news`,
          })
        }
      }
      for (const ch of CALLER_CHANNELS) {
        const posts = await fetchChannelPosts(ch)
        if (!posts.length) continue
        const last = lastPostId.get(`c:${ch}`) || 0
        lastPostId.set(`c:${ch}`, posts[posts.length - 1].id)
        if (!primed || last === 0) continue
        const newPosts = posts.filter((p) => p.id > last)
        if (newPosts.length) fresh.push(...(await callerWireMsgs(ch, newPosts)))
      }
      primed = true
      if (fresh.length) await deliverAll(bot, fresh.slice(0, 5), null)
    } catch (e) {
      console.error('[newswire]', e.message)
    } finally {
      busy = false
    }
  }, 20e3)
}

let started = false
function startSignalPoller(bot) {
  if (started) return
  started = true
  const bootAt = Date.now()
  let tick = 0
  let busy = false // a slow delivery must not overlap the next tick (racing the seen-set)
  let backlog = [] // cards past the 10-per-tick cap wait here instead of vanishing
  primeSeen().catch((e) => console.error('[signals] prime failed:', e.message))

  setInterval(async () => {
    if (busy) return
    busy = true
    tick++
    try {
      const subsList = store.allSubs()
      if (!subsList.length) return
      const seen = store.seenSignals()
      const outbox = [...backlog, ...(await collect(tick, bootAt, seen))]
      if (!outbox.length) {
        store.markSignalsSeen([...seen])
        return
      }
      // priority first, then cap per tick — the rest carries over (collect
      // already fingerprinted them as seen, so a drop here would be forever)
      outbox.sort((a, b) => (CATS[a.cat]?.priority ?? 9) - (CATS[b.cat]?.priority ?? 9))
      backlog = outbox.slice(10)
      if (backlog.length) console.warn(`[signals] ${backlog.length} card(s) carried to next tick (10-per-tick cap)`)
      await deliverAll(bot, outbox.slice(0, 10), seen)
      store.markSignalsSeen([...seen])
    } catch (err) {
      console.error('[signals] poll error:', err.message)
    } finally {
      busy = false
    }
  }, 45e3)
}

// shared deterministic token read — the same voice as signal cards, reusable
// by scan cards: category + talk-vs-flow + tone + risk-first price guards
function tokenRead({ row, mcap, vol24, ch1, ch24, tone }) {
  const msg = {
    social: row
      ? {
          category: pickCategory(row.primary_category, row.category),
          chain: row.chain,
          mcap: row.market_cap,
          mentions: row.effective_external_mentions_24h ?? row.mentions_24h,
          velocity: row.velocity_ratio,
        }
      : null,
    dex: { mcap: mcap ?? null, vol24: vol24 ?? null, ch1: ch1 ?? null, ch24: ch24 ?? null },
    tone: tone || null,
  }
  return readLine(msg)
}

module.exports = { CATS, subKeyboard, subText, startSignalPoller, startNewswire, alertKeyboard, cycleFreq, dexEnrich, tokenRead }
