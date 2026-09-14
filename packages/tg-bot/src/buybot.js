// Buy Bot — posts every on-chain buy of a configured token into the chats
// that enabled it (/buybot <contract>). Self-serve: any group admin can add
// their token; each chat carries its own settings (min buy, on/off).
//
// Data path: pools + price + mcap from DexScreener (10-min refresh), buys
// from the Etherscan V2 multichain API (one poll per TOKEN per tick no
// matter how many chats share it; free key). A buy = a transfer OUT of a
// known pool that isn't into another pool.
//
// Latency honesty: a buy exists when its block does (~12s on ETH). Polling
// every BUYBOT_POLL_MS lands cards ~15-35s after the buy. True "instant"
// (~1-3s post-block) needs a websocket node subscription — upgrade path,
// not a poller tweak.
const path = require('path')
const fs = require('fs')
const { InlineKeyboard, InputFile } = require('grammy')
const store = require('./store')
const api = require('./spectre-api')
const { esc, usd, price, compact } = require('./format')
const { tradeTokenUrl } = require('./config')
const { t: tr, LANGS } = require('./i18n')

const ETHERSCAN_KEY = (process.env.ETHERSCAN_API_KEY || '').trim()
const POLL_MS = parseInt(process.env.BUYBOT_POLL_MS || '20000', 10)
const DEFAULT_MEDIA = path.resolve(__dirname, '../assets/buybot-default.mp4')
const MIN_STEPS = [10, 25, 50, 100, 250, 500]
const STEP_STEPS = [10, 25, 50, 100, 250] // $ of buy per emoji in the row
const WHALE_STEPS = [5000, 10000, 25000, 50000, 0] // wallet net-worth trigger; 0 = off

const CHAIN_IDS = { ethereum: 1, base: 8453, bsc: 56, arbitrum: 42161, polygon: 137, optimism: 10 }
const EXPLORER = { ethereum: 'etherscan.io', base: 'basescan.org', bsc: 'bscscan.com', arbitrum: 'arbiscan.io', polygon: 'polygonscan.com', optimism: 'optimistic.etherscan.io' }
const NATIVE = { ethereum: 'ETH', base: 'ETH', arbitrum: 'ETH', optimism: 'ETH', bsc: 'BNB', polygon: 'POL' }
const BURN_ADDRS = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead'])
const CHAIN_GLYPH = { ethereum: '⟠ ETH', solana: '◎ SOL', base: '🔵 BASE', bsc: '🟡 BNB', arbitrum: '🔷 ARB', polygon: '🟣 POL', optimism: '🔴 OP', robinhood: '🏹 RH' }

// custom-emoji glyphs from the Spectre pack (a set the BOT created — Telegram
// allows bots to send custom emoji from their own sets, no Fragment username
// needed; proven live 07-15). Map built by the set-creation script. Gated by
// BUYBOT_EMOJI_PACK=1 so cards only switch when Sunny flips it.
let EMOJI_IDS = {}
try {
  if (process.env.BUYBOT_EMOJI_PACK === '1') {
    EMOJI_IDS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/emoji-pack.json'), 'utf8')).ids || {}
  }
} catch {}
const ge = (slug, fallback) => (EMOJI_IDS[slug] ? `<tg-emoji emoji-id="${EMOJI_IDS[slug]}">${fallback}</tg-emoji>` : fallback)

// per-token runtime state (keyed by lowercase CA)
const tokens = new Map()
let mediaFileId = null

const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`
const isEvmAddress = (v) => /^0x[a-fA-F0-9]{40}$/.test(String(v || ''))

async function dsPairs(ca) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(10e3) }).catch(() => null)
  const pairs = res?.ok ? (await res.json().catch(() => null))?.pairs || [] : []
  return pairs.filter((p) => String(p.baseToken?.address || '').toLowerCase() === String(ca).toLowerCase())
}

async function resolveTokenMeta(ca) {
  const pairs = await dsPairs(ca)
  if (!pairs.length) return null
  const top = pairs.reduce((a, b) => ((b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a))
  const chain = top.chainId
  const meta = {
    chain,
    chainId: CHAIN_IDS[chain] || null,
    watchable: !!CHAIN_IDS[chain], // buy DETECTION is EVM/Etherscan; any chain displays
    symbol: (top.baseToken?.symbol || '').toUpperCase(),
    name: top.baseToken?.name || top.baseToken?.symbol || '',
    pools: new Set(pairs.map((p) => String(p.pairAddress || '').toLowerCase()).filter(Boolean)),
    priceUsd: top.priceUsd != null ? Number(top.priceUsd) : null,
    mcap: Math.max(Number(top.marketCap) || 0, Number(top.fdv) || 0) || null,
    liq: top.liquidity?.usd ?? null,
    vol24: top.volume?.h24 ?? null,
    dexUrl: top.url || `https://dexscreener.com/${chain}/${ca}`,
  }
  if (chain === 'solana') {
    const m = await solTokenMcap(ca, meta.priceUsd).catch(() => null)
    if (m) meta.mcap = m
  }
  return meta
}

// Solana-side mcap from the chain itself: getTokenSupply × price.
// DexScreener under-reports bridged side-supplies (NEURAL: $25K vs real $149K).
async function solTokenMcap(ca, priceUsd) {
  if (!priceUsd) return null
  const res = await fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [ca] }),
    signal: AbortSignal.timeout(8e3),
  }).catch(() => null)
  const v = res?.ok ? (await res.json().catch(() => null))?.result?.value : null
  const supply = v ? Number(v.uiAmountString || v.uiAmount) : null
  return supply && isFinite(supply) && supply > 0 ? supply * priceUsd : null
}

async function esRaw(chainId, params) {
  if (!ETHERSCAN_KEY) return null
  const qs = new URLSearchParams({ chainid: String(chainId), apikey: ETHERSCAN_KEY, ...params })
  // the key is shared with the data-api workers on this box — 3/sec collisions
  // are routine, and a swallowed rate-limit response is a swallowed BUY.
  // Back off and retry instead of treating "Max calls per sec" as an answer.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.etherscan.io/v2/api?${qs}`, { signal: AbortSignal.timeout(12e3) }).catch(() => null)
    const j = res?.ok ? await res.json().catch(() => null) : null
    const r = j?.result ?? null
    if (typeof r === 'string' && /rate limit/i.test(r) && attempt < 2) {
      await new Promise((ok) => setTimeout(ok, 800 + attempt * 700))
      continue
    }
    return r
  }
}
let _esWarnAt = 0
async function es(chainId, params) {
  const r = await esRaw(chainId, params)
  if (Array.isArray(r)) return r
  if (r != null && Date.now() - _esWarnAt > 10 * 60e3) {
    _esWarnAt = Date.now()
    console.warn('[buybot] etherscan non-array result:', String(r).slice(0, 120))
  }
  return []
}

// one balance call gives both reads: balance_before ≈ 0 → New Holder,
// otherwise Position +X% (how much this buy grew the buyer's bag)
async function positionRead(chainId, ca, buyer, amount, decimals) {
  const raw = await esRaw(chainId, { module: 'account', action: 'tokenbalance', contractaddress: ca, address: buyer, tag: 'latest' }).catch(() => null)
  const bal = raw != null ? Number(raw) / 10 ** decimals : null
  if (bal == null || !isFinite(bal) || bal <= 0) return null
  const before = bal - amount
  if (before <= amount * 0.005) return { newHolder: true, bal }
  return { newHolder: false, pct: (amount / before) * 100, bal }
}

// chain-truth total supply (1h cache) — the FDV-side mcap floor. DexScreener's
// marketCap/fdv lag the pump by a quote cycle; supply × live price never
// undershoots (founder: mcap reads on the higher end, like other buybots).
const _supplies = new Map() // ca → { v, at }
async function tokenTotalSupply(chainId, ca, decimals) {
  const hit = _supplies.get(ca)
  if (hit && Date.now() - hit.at < 3600e3) return hit.v
  const raw = await esRaw(chainId, { module: 'stats', action: 'tokensupply', contractaddress: ca }).catch(() => null)
  const v = raw != null && isFinite(Number(raw)) ? Number(raw) / 10 ** decimals : null
  if (v && v > 0) _supplies.set(ca, { v, at: Date.now() })
  return v && v > 0 ? v : null
}

// wallet net value = native balance + this token's bag (full-portfolio
// indexing is a paid-API job; native + bag catches the whales that matter)
async function walletNetUsd(chainId, chain, buyer, tokenBagUsd) {
  const raw = await esRaw(chainId, { module: 'account', action: 'balance', address: buyer, tag: 'latest' }).catch(() => null)
  let nativeUsd = 0
  if (raw != null) {
    const bal = Number(raw) / 1e18
    const sym = NATIVE[chain]
    const p = sym ? await api.prices([sym], { ttlMs: 60e3 }).catch(() => null) : null
    const px = p?.[sym]?.price
    if (px && isFinite(bal)) nativeUsd = bal * px
  }
  return nativeUsd + (tokenBagUsd || 0)
}

// approx native spend from USD via our own price lane (same-block precision
// isn't needed for display; labeled with ≈)
async function nativeSpend(chain, usdVal) {
  if (!usdVal) return null
  const sym = NATIVE[chain]
  if (!sym) return null
  const p = await api.prices([sym], { ttlMs: 60e3 }).catch(() => null)
  const px = p?.[sym]?.price
  if (!px) return null
  const n = usdVal / px
  return { text: `${fmtNative(n)} ${sym}`, n }
}

const fmtNative = (n) => (n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(5))

// the REAL native spend comes from the tx value (router ETH-in). The token
// side alone under-reads taxed tokens (buyer receives post-tax) — this is why
// naive cards disagree with Safeguard by exactly the tax percentage.
async function exactSpend(chainId, chain, buy) {
  let tx = await esRaw(chainId, { module: 'proxy', action: 'eth_getTransactionByHash', txhash: buy.hash }).catch(() => null)
  if (!tx?.value) {
    // transient proxy misses turn an exact "0.217 ETH" into a ≈estimate —
    // one more try is worth 600ms
    await new Promise((ok) => setTimeout(ok, 600))
    tx = await esRaw(chainId, { module: 'proxy', action: 'eth_getTransactionByHash', txhash: buy.hash }).catch(() => null)
  }
  const wei = tx?.value ? parseInt(tx.value, 16) : 0
  if (!(wei > 0)) return false
  const n = wei / 1e18
  const sym = NATIVE[chain]
  const p = sym ? await api.prices([sym], { ttlMs: 60e3 }).catch(() => null) : null
  const px = p?.[sym]?.price
  // token-to-token / aggregator buys carry dust tx.value — a $1,950 buy once
  // rendered "$0.24 (0.000 ETH)". Trust tx.value only when it's in the same
  // universe as the token-side estimate; otherwise fall back to ≈.
  if (px && isFinite(px) && buy.usd != null && n * px < buy.usd * 0.5) return false
  buy.native = `${fmtNative(n)} ${sym}`
  buy.ethSpend = n
  if (px && isFinite(px)) buy.usd = n * px
  return true
}

// full numbers read better on a hype card than compact ($3,446,820 not $3.4M)
const fullUsd = (n) => (n == null || !isFinite(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
const exactUsd = (n) => (n == null || !isFinite(n) ? '—' : n >= 10000 ? fullUsd(n) : `$${n.toFixed(2)}`)
const fmtAmt = (n) => (n == null || !isFinite(n) ? '—' : n >= 1e6 ? compact(n) : Math.round(n).toLocaleString('en-US'))

function buyCard(cfg, tk, buy, botUsername) {
  const L = store.chatLang(cfg.chatId)
  const T = (k, v) => tr(L, k, v)
  const usdV = buy.usd || 0
  // 🐳 belongs to the WALLET-net-value whale alert ONLY (founder rule) —
  // buy size never triggers whale visuals; normal tiers are 🟢 / 🔥
  const whaleAlert = !!buy.whaleAlert
  const tier = whaleAlert ? ge('13_whale', '🐳') : cfg.emoji || (usdV >= 300 ? ge('23_catalyst', '🔥') : ge('01_new_buy', '🟢'))
  // ≥1 native (ETH-class) buys get the big-board treatment: ~40 icons per ETH
  // wrapped in lines of 20, so a 2 ETH buy DOMINATES the card (founder ask).
  // Hard cap 88: Telegram renders at most 100 custom emoji per message and the
  // card's other glyphs need headroom.
  const eth = buy.ethSpend || 0
  const rowLen = whaleAlert
    ? Math.max(20, Math.min(60, Math.round((buy.netUsd || 10000) / 1000)))
    : eth >= 1
      ? Math.min(88, Math.round(40 * eth))
      : Math.max(4, Math.min(28, Math.round(usdV / (cfg.stepUsd || 25)) || 4))
  const cells = Array.from({ length: rowLen }, () => tier)
  const row = Array.from({ length: Math.ceil(cells.length / 20) }, (_, i) => cells.slice(i * 20, i * 20 + 20).join('')).join('\n')
  const exp = EXPLORER[tk.chain] || 'etherscan.io'
  const pos = buy.pos
  const posLine = pos?.newHolder
    ? `${ge('15_new_holder', '✳️')} <b>${T('buy.newHolder')}</b>`
    : pos?.pct != null
      ? `${ge('09_momentum', '📊')} <b>${T('buy.position')}</b> +${pos.pct >= 100 ? Math.round(pos.pct) : pos.pct.toFixed(1)}%`
      : null
  // pack glyphs sit OUTSIDE the <a> — custom emoji nested inside link
  // entities render inconsistently across clients
  const links = [
    `${ge('23_ai_screener', '🤖')} <a href="${tradeTokenUrl(tk.ca)}">AI Screener</a>`,
    `${ge('24_dexscreener', '📊')} <a href="${tk.dexUrl}">DexScreener</a>`,
    tk.cgId ? `<a href="https://app.spectreai.io/x-dash/token/${encodeURIComponent(tk.cgId)}?view=full">𝕏 X-Dash</a>` : null,
    botUsername && tk.symbol ? `${ge('22_scan', '🔎')} <a href="https://t.me/${botUsername}?start=scan_${encodeURIComponent(tk.symbol)}">${T('btn.scan')}</a>` : null,
  ].filter(Boolean)
  const lines = [
    whaleAlert
      ? `<b>${esc(tk.name || tk.symbol)}</b> — <b>${T('buy.whaleAlert')}</b> ${ge('13_whale', '🐳')}${buy.multiChain ? ` · ${CHAIN_GLYPH[tk.chain] || tk.chain}` : ''}`
      : `<b>${esc(tk.name || tk.symbol)}</b> — <b>${T('buy.newBuy')}</b>${buy.multiChain ? ` · ${CHAIN_GLYPH[tk.chain] || tk.chain}` : ''}`,
    row,
    '',
    ...(whaleAlert && buy.netUsd != null ? [`${ge('13_whale', '🐳')} <b>${T('buy.netValue')}</b> ${fullUsd(buy.netUsd)}`] : []),
    `${ge('04_total_value', '💳')} <b>${exactUsd(usdV)}</b>${buy.native ? ` (${esc(buy.native)})` : ''}`,
    `${ge('03_amount', '🪙')} <b>${fmtAmt(buy.amount)} ${esc(tk.symbol)}</b>`,
    `${ge('12_wallet', '👤')} <a href="https://${exp}/address/${esc(buy.buyer)}">${short(buy.buyer)}</a> · <a href="https://${exp}/tx/${esc(buy.hash)}">${T('buy.txn')} ↗</a>`,
    ...(posLine ? [posLine] : []),
    ...(buy.legStats && buy.legStats.length > 1
      ? buy.legStats.map((l) => `${CHAIN_GLYPH[l.chain] || esc(l.chain)} · ${ge('05_price', '🏷')} ${price(l.priceUsd)} · <b>MC</b> ${fullUsd(l.mcap)}`)
      : [
          `${ge('05_price', '🏷')} ${price(tk.priceUsd)}`,
          `${ge('06_market_cap', '📈')} <b>MC</b> ${fullUsd(tk.mcap)}`,
        ]),
    ...(tk.liq || tk.vol24 ? [`${ge('07_liquidity', '💧')} ${usd(tk.liq)}${tk.vol24 != null ? ` · ${ge('08_volume', '🌊')} ${usd(tk.vol24)}` : ''}`] : []),
    '',
    links.join(' · '),
    `<i>⌁ ${T('foot.brand')} · ${T('foot.buyBot')}${buy.test ? ` · 🧪 ${T('foot.test')}` : ''}</i>`,
  ]
  return lines.join('\n')
}

function buyKeyboard(tk, lang) {
  const kbd = new InlineKeyboard()
  // buttons CANNOT carry custom emoji (hard Telegram limit: plain text only)
  // and founder called unicode stand-ins crap — so buttons stay clean text;
  // the pack art lives on the link row above, which serves the same routes
  kbd.url(`${tr(lang, 'btn.buy')} $${tk.symbol} ↗`, tradeTokenUrl(tk.ca))
  kbd.url('AI Screener ↗', tradeTokenUrl(tk.ca))
  kbd.row()
  // X-Dash tab is ALWAYS there (founder ask: 4 tabs) — token deep-link when
  // the identity is clone-verified by contract, X-Dash home otherwise
  kbd.url('𝕏 X-Dash ↗', tk.cgId ? `https://app.spectreai.io/x-dash/token/${encodeURIComponent(tk.cgId)}?view=full` : 'https://app.spectreai.io/x-dash')
  kbd.url('DexScreener ↗', tk.dexUrl)
  return kbd
}

async function legStatsFor(cfg, tk) {
  const legs = [{ ca: cfg.ca, chain: null }, ...(cfg.legs || [])]
  if (legs.length < 2) return null
  const out = []
  for (const leg of legs) {
    const t = await ensureToken(leg.ca, 5 * 60e3).catch(() => null)
    if (t) out.push({ chain: t.chain, priceUsd: t.priceUsd, mcap: t.mcap })
  }
  return out.length > 1 ? out : null
}

async function postBuy(bot, cfg, tk, buy) {
  if (cfg.legs?.length && buy.legStats === undefined) {
    buy.legStats = await legStatsFor(cfg, tk).catch(() => null)
    buy.multiChain = !!buy.legStats
  }
  const caption = buyCard(cfg, tk, buy, bot.botInfo?.username)
  const kbd = buyKeyboard(tk, store.chatLang(cfg.chatId))
  // media priority: the team's own upload → Spectre default animation
  let media = cfg.mediaId || mediaFileId
  const mediaType = cfg.mediaId ? cfg.mediaType || 'animation' : 'animation'
  let fresh = false
  if (!media && fs.existsSync(DEFAULT_MEDIA)) {
    media = new InputFile(DEFAULT_MEDIA)
    fresh = true
  }
  try {
    if (media && mediaType === 'photo') {
      await bot.api.sendPhoto(cfg.chatId, media, { caption, parse_mode: 'HTML', reply_markup: kbd })
    } else if (media) {
      const sent = await bot.api.sendAnimation(cfg.chatId, media, { caption, parse_mode: 'HTML', reply_markup: kbd })
      if (fresh && sent?.animation?.file_id) mediaFileId = sent.animation.file_id
    } else {
      await bot.api.sendMessage(cfg.chatId, caption, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: kbd })
    }
  } catch (err) {
    const desc = String(err.description || err.message || '')
    if (/blocked|kicked|chat not found|not enough rights|deactivated/i.test(desc)) {
      console.warn(`[buybot] disabling for ${cfg.chatId}: ${desc}`)
      store.upsertBuybot(cfg.chatId, { enabled: false, disabledReason: desc })
    } else {
      console.error('[buybot] post failed:', desc)
    }
  }
}

async function ensureToken(ca, maxAge = 10 * 60e3) {
  const key = isEvmAddress(ca) ? String(ca).toLowerCase() : String(ca) // solana base58 is case-SENSITIVE
  let tk = tokens.get(key)
  if (tk && Date.now() - (tk.metaAt || 0) < maxAge) return tk
  const meta = await resolveTokenMeta(key).catch(() => null)
  if (!meta) return tk || null
  if (!tk) {
    const persisted = store.seenTx(key)
    tk = { seen: new Set(persisted), primed: persisted.length > 0, }
  }
  tk = { ...tk, ...meta, ca: key, metaAt: Date.now() }
  // X-Dash identity: only when the board row's CONTRACT matches this CA —
  // a symbol match alone could be a different token with the same ticker
  if (tk.cgId === undefined) {
    const row = await api.socialRow(tk.symbol).catch(() => null)
    const rowCa = row && (Object.values(row.platforms || {}).find(api.isTokenAddress) || row.contract_address)
    tk.cgId = rowCa && String(rowCa).toLowerCase() === key ? row.token_id || row.cg_id || null : null
  }
  tokens.set(key, tk)
  return tk
}

const DEBUG = process.env.BUYBOT_DEBUG === '1'
async function tick(bot) {
  const cfgs = store.allBuybots().filter((c) => c.enabled !== false && c.ca)
  if (DEBUG) console.log('[buybot:dbg] tick — cfgs:', cfgs.length)
  if (!cfgs.length) return
  const byCa = new Map()
  for (const c of cfgs) {
    for (const ca of [c.ca, ...(c.legs || []).map((l) => l.ca)]) {
      if (!ca) continue
      const k = isEvmAddress(ca) ? ca.toLowerCase() : ca
      if (!byCa.has(k)) byCa.set(k, [])
      byCa.get(k).push(c)
    }
  }
  for (const [ca, chats] of byCa) {
    try {
      let tk = await ensureToken(ca)
      if (!tk || !tk.watchable || !tk.pools?.size) continue
      // 100-row window (store keeps 400 keys/token): a restart or a rate-limited
      // stretch has to outlast ~100 transfers before a buy can slide past us
      const rows = await es(tk.chainId, { module: 'account', action: 'tokentx', contractaddress: ca, page: '1', offset: '100', sort: 'desc' })
      if (DEBUG) console.log('[buybot:dbg]', ca.slice(0, 10), 'rows:', rows.length, 'pools:', tk.pools?.size, 'primed:', tk.primed, 'seen:', tk.seen.size)
      const candidates = []
      const newKeys = []
      // full-amount accounting (founder rule: cards show the FULL buy like
      // every other buybot, not post-tax): a taxed transfer splits pool→buyer
      // 95% + pool→contract/burn 5% as separate legs of one tx — the real buy
      // size is EVERYTHING that left the pool in that hash
      const poolOut = new Map() // hash → total tokens out of the pool
      for (const r of rows) {
        const key = `${r.hash}:${r.from}:${r.to}:${r.value}`
        const from = String(r.from || '').toLowerCase()
        const to = String(r.to || '').toLowerCase()
        const decimals = parseInt(r.tokenDecimal || '18', 10)
        const amount = Number(r.value) / 10 ** decimals
        if (tk.pools.has(from) && !tk.pools.has(to) && isFinite(amount) && amount > 0) {
          poolOut.set(r.hash, (poolOut.get(r.hash) || 0) + amount)
        }
        if (tk.seen.has(key)) continue
        tk.seen.add(key)
        newKeys.push(key)
        if (!tk.primed) continue // first sweep after (re)start: fingerprint only, never replay
        if (!tk.pools.has(from) || tk.pools.has(to)) continue // buys leave a pool; pool→pool is a hop
        if (to === ca || BURN_ADDRS.has(to)) continue // tax leg to the token contract / burns — not a buyer
        if (!isFinite(amount) || amount <= 0) continue
        // REALTIME ONLY (founder rule: "if its in past then past — only
        // realtime", holders notice late cards). 5 min covers the normal
        // 15-35s detection path plus rate-limit retries and a failed tick or
        // two; anything older is fingerprinted silently, never posted.
        const ts = Number(r.timeStamp) * 1000
        if (ts && Date.now() - ts > 5 * 60e3) continue
        candidates.push({ hash: r.hash, buyer: r.to, amount, decimals, usd: tk.priceUsd ? amount * tk.priceUsd : null, ts })
      }
      tk.primed = true
      if (newKeys.length) store.addSeenTx(ca, newKeys)
      // taxed buys still split across recipients within one tx — one card per
      // hash, the largest transfer is the real buyer leg
      const byHash = new Map()
      for (const c of candidates) {
        const cur = byHash.get(c.hash)
        if (!cur || c.amount > cur.amount) byHash.set(c.hash, c)
      }
      const fresh = [...byHash.values()]
      for (const c of fresh) {
        const full = poolOut.get(c.hash) || 0
        if (full > c.amount) {
          c.received = c.amount // post-tax leg — what actually landed in the wallet (position math)
          c.amount = full // pre-tax full buy — what the card shows
          if (tk.priceUsd) c.usd = full * tk.priceUsd
        }
      }
      if (DEBUG && (fresh.length || !tk.primedLogged)) { console.log('[buybot:dbg]', ca.slice(0, 10), 'fresh:', fresh.length); tk.primedLogged = true }
      if (tk.seen.size > 2000) tk.seen = new Set([...tk.seen].slice(-800))
      const whaleThrs = chats.map((c) => c.whaleNetUsd ?? 10000).filter((v) => v > 0)
      const anyWhale = whaleThrs.length > 0
      if (fresh.length) {
        // capture the refreshed token — the old code discarded this return, so
        // cards quoted price/MC up to 10 min stale (read LOWER than rival bots
        // mid-pump; founder caught it live)
        tk = (await ensureToken(ca, 60e3)) || tk
        const sup = await tokenTotalSupply(tk.chainId, ca, fresh[0].decimals).catch(() => null)
        if (sup && tk.priceUsd) tk.mcap = Math.max(tk.mcap || 0, sup * tk.priceUsd)
      }
      if (fresh.length > 5) console.warn(`[buybot] ${ca.slice(0, 10)} catch-up: posting newest 5 of ${fresh.length} — ${fresh.length - 5} older buys dropped by the anti-spam cap`)
      for (const buy of fresh.reverse().slice(-5)) {
        const maxMin = Math.min(...chats.map((c) => c.minUsd ?? 25))
        // small buys still get processed when a whale trigger is armed —
        // a $50 top-up from a $30k wallet is the signal, not the size
        const floor = anyWhale ? Math.min(25, maxMin) : maxMin
        if (buy.usd != null && buy.usd < floor) continue
        // exact ETH first — it's the card's money line; position read can
        // afford to eat a rate-limit hiccup, the spend line can't
        const exact = await exactSpend(tk.chainId, tk.chain, buy).catch(() => false)
        buy.pos = await positionRead(tk.chainId, ca, buy.buyer, buy.received ?? buy.amount, buy.decimals).catch(() => null)
        if (!exact) {
          const est = await nativeSpend(tk.chain, buy.usd).catch(() => null)
          buy.native = est ? `≈${est.text}` : null
          if (est) buy.ethSpend = est.n
        }
        if (anyWhale) {
          const bagUsd = buy.pos?.bal != null && tk.priceUsd ? buy.pos.bal * tk.priceUsd : 0
          buy.netUsd = await walletNetUsd(tk.chainId, tk.chain, buy.buyer, bagUsd).catch(() => null)
        }
        for (const cfg of chats) {
          const thr = cfg.whaleNetUsd ?? 10000
          const isWhale = thr > 0 && buy.netUsd != null && buy.netUsd >= thr
          if (!isWhale && buy.usd != null && buy.usd < (cfg.minUsd ?? 25)) continue
          await postBuy(bot, cfg, tk, { ...buy, whaleAlert: isWhale })
          await new Promise((r2) => setTimeout(r2, 150))
        }
      }
    } catch (e) {
      console.error('[buybot] tick error for', ca, e.message)
    }
  }
}

// ---- pending setting capture: panel asks, the admin's NEXT message answers
// (2-min window, keyed chat+user; consumed messages never reach other handlers)

const pending = new Map() // `${chatId}:${userId}` → { kind: 'emoji'|'media', at }

function setPending(chatId, userId, kind) {
  pending.set(`${chatId}:${userId}`, { kind, at: Date.now() })
}

// returns true when the message was a settings answer and got consumed
function hasPending(chatId, userId) {
  const p = pending.get(`${chatId}:${userId}`)
  return !!p && Date.now() - p.at <= 2 * 60e3
}

async function captureSetting(ctx) {
  const key = `${ctx.chat?.id}:${ctx.from?.id}`
  const p = pending.get(key)
  if (!p) return false
  if (Date.now() - p.at > 2 * 60e3) {
    pending.delete(key)
    return false
  }
  // groups run with privacy mode ON — the answer must be a REPLY to the bot
  const isPrivate = ctx.chat?.type === 'private'
  if (!isPrivate && ctx.msg?.reply_to_message?.from?.id !== ctx.me?.id) return false
  const cfg = store.buybot(ctx.chat.id)
  if (!cfg) {
    pending.delete(key)
    return false
  }
  if (p.kind === 'emoji') {
    const text = String(ctx.msg?.text || '').trim()
    if (!text) return false
    pending.delete(key)
    if (/^default$/i.test(text)) {
      store.upsertBuybot(ctx.chat.id, { emoji: null, emojiCustomId: null })
      await ctx.reply('🟢 Emoji reset to the size-tier default (🟢/🔥).').catch(() => {})
      return true
    }
    const emoji = text.replace(/[<>&"]/g, '').slice(0, 8)
    if (!emoji) {
      await ctx.reply('That did not look like an emoji — try again from the panel.').catch(() => {})
      return true
    }
    // Premium custom emoji arrive as entities with a custom_emoji_id + a
    // standard fallback char in the text. Store BOTH: the fallback renders
    // today; the real art switches on automatically once the bot holds a
    // Fragment collectible username (Telegram's rule for bots SENDING
    // custom-emoji entities — not ours).
    const customEnt = (ctx.msg.entities || []).find((e) => e.type === 'custom_emoji')
    store.upsertBuybot(ctx.chat.id, { emoji, emojiCustomId: customEnt?.custom_emoji_id || null })
    if (customEnt) {
      await ctx.reply(`${emoji.repeat(6)}
Custom emoji saved — id kept. It renders as ${emoji} for now: Telegram only lets bots send custom-emoji ART once the bot owns a Fragment collectible username. The moment that lands, your art takes over automatically.`).catch(() => {})
    } else {
      await ctx.reply(`${emoji.repeat(6)}
Buy rows now use ${emoji} in this chat.`).catch(() => {})
    }
    return true
  }
  if (p.kind === 'leg') {
    const text = String(ctx.msg?.text || '').trim()
    if (!text) return false
    pending.delete(key)
    if (/^default$/i.test(text)) {
      store.upsertBuybot(ctx.chat.id, { legs: [] })
      await ctx.reply('➕ Extra chains cleared — single-chain card again.').catch(() => {})
      return true
    }
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)
    if (!isEvmAddress(text) && !isSol) {
      await ctx.reply('That does not look like a contract address — EVM 0x… or Solana base58.').catch(() => {})
      return true
    }
    const meta = await resolveTokenMeta(text).catch(() => null)
    if (!meta) {
      await ctx.reply('No live DEX pair found for that contract.').catch(() => {})
      return true
    }
    const legs = (cfg.legs || []).filter((l) => l.ca.toLowerCase() !== text.toLowerCase())
    legs.push({ ca: text, chain: meta.chain })
    store.upsertBuybot(ctx.chat.id, { legs })
    await ctx.reply(
      `➕ <b>${esc(meta.symbol)}</b> on <b>${esc(meta.chain)}</b> added — cards now show all chains' price + MC.${meta.watchable ? ' Buys on this chain are watched too.' : ' Buy detection on this chain lands with the websocket lane; stats show now.'}`,
      { parse_mode: 'HTML' },
    ).catch(() => {})
    return true
  }
  if (p.kind === 'media') {
    const anim = ctx.msg?.animation
    const video = ctx.msg?.video
    const photo = ctx.msg?.photo?.length ? ctx.msg.photo[ctx.msg.photo.length - 1] : null
    const text = String(ctx.msg?.text || '').trim()
    if (/^default$/i.test(text)) {
      pending.delete(key)
      store.upsertBuybot(ctx.chat.id, { mediaId: null, mediaType: null })
      await ctx.reply('🎞 Media reset to the Spectre default animation.').catch(() => {})
      return true
    }
    const fileId = anim?.file_id || video?.file_id || photo?.file_id
    if (!fileId) return false // let normal messages through until they send media or time out
    pending.delete(key)
    store.upsertBuybot(ctx.chat.id, { mediaId: fileId, mediaType: photo && !anim && !video ? 'photo' : 'animation' })
    await ctx.reply('🎞 Saved — buy cards in this chat now use your media. (Panel → Media → "default" to reset.)').catch(() => {})
    return true
  }
  return false
}

// ---- settings panel

async function setup(chatId, ca, userId) {
  if (!isEvmAddress(ca)) return { error: 'That does not look like an EVM contract address (0x…40 hex). Solana support is on the list.' }
  const meta = await resolveTokenMeta(ca).catch(() => null)
  if (!meta) return { error: 'No live DEX pair found for that contract on DexScreener — nothing to watch yet.' }
  if (!meta.watchable) return { error: `Buy detection on "${esc(meta.chain)}" is not live yet — set an EVM contract as primary (ETH · Base · BSC · Arbitrum · Polygon · Optimism) and add this one as an extra chain from the panel.` }
  const cfg = store.upsertBuybot(chatId, {
    chatId: String(chatId),
    ca: String(ca).toLowerCase(),
    chain: meta.chain,
    symbol: meta.symbol,
    name: meta.name,
    minUsd: store.buybot(chatId)?.minUsd ?? 25,
    enabled: true,
    addedBy: userId,
    createdAt: store.buybot(chatId)?.createdAt || new Date().toISOString(),
  })
  return { cfg }
}

function panelText(cfg) {
  const L = store.chatLang(cfg.chatId)
  const T = (k, v) => tr(L, k, v)
  return [
    `🟢 <b>${T('panel.title')}</b>`,
    `<b>$${esc(cfg.symbol || '?')}</b>${cfg.name ? ` — ${esc(cfg.name)}` : ''} · ${esc(cfg.chain || '')}`,
    `<code>${esc(cfg.ca)}</code>`,
    '',
    ...((cfg.legs || []).length ? [`▸ <b>${T('panel.chains')}</b> ${[cfg.chain, ...(cfg.legs || []).map((l) => l.chain)].join(' + ')}`] : []),
    `▸ <b>${T('panel.minBuy')}</b> $${cfg.minUsd ?? 25}`,
    `▸ <b>${T('panel.whaleAlert')}</b> ${(cfg.whaleNetUsd ?? 10000) > 0 ? `${T('panel.walletGte')} $${(cfg.whaleNetUsd ?? 10000).toLocaleString('en-US')}` : T('panel.off')}`,
    `▸ <b>${T('panel.emojiScale')}</b> ${T('panel.emojiPer', { usd: cfg.stepUsd ?? 25 })}`,
    `▸ <b>${T('panel.rowEmoji')}</b> ${cfg.emoji || `🟢/🔥 ${T('panel.bySize')}`}`,
    `▸ <b>${T('panel.media')}</b> ${cfg.mediaId ? T('panel.mediaCustom') : T('panel.mediaDefault')}`,
    `▸ <b>${T('panel.language')}</b> ${LANGS[L] || 'English'}`,
    `▸ <b>${T('panel.status')}</b> ${cfg.enabled !== false ? T('panel.statusOn') : T('panel.statusOff')}`,
    '',
    `<i>${T('panel.note')}</i>`,
  ].join('\n')
}

function panelKeyboard(chatId, cfg) {
  const L = store.chatLang(chatId)
  const T = (k, v) => tr(L, k, v)
  const kbd = new InlineKeyboard()
  kbd.text(`💵 ${T('panel.minBuy')} $${cfg.minUsd ?? 25}`, `by|${chatId}|min`)
  const wt = cfg.whaleNetUsd ?? 10000
  kbd.text(`🐳 ${wt > 0 ? `$${wt >= 1000 ? `${wt / 1000}K` : wt}` : T('panel.off')}`, `by|${chatId}|whale`)
  kbd.text(`🧮 $${cfg.stepUsd ?? 25}`, `by|${chatId}|step`)
  kbd.row()
  kbd.text(`${cfg.emoji || '🟢'} ${T('panel.rowEmoji')}`, `by|${chatId}|emoji`)
  kbd.text(`🎞 ${T('panel.media')}`, `by|${chatId}|media`)
  kbd.text(`➕ ${T('panel.btnChain')}`, `by|${chatId}|leg`)
  kbd.row()
  kbd.text(`🌐 ${T('panel.language')}`, `by|${chatId}|lang`)
  kbd.text(cfg.enabled !== false ? `⏸ ${T('panel.btnPause')}` : `▶️ ${T('panel.btnResume')}`, `by|${chatId}|toggle`)
  kbd.row()
  kbd.text(`🧪 ${T('panel.btnTest')}`, `by|${chatId}|test`)
  kbd.text(`🗑 ${T('panel.btnRemove')}`, `by|${chatId}|rm`)
  return kbd
}

function cycleMin(chatId) {
  const cfg = store.buybot(chatId)
  const cur = cfg?.minUsd ?? 25
  const next = MIN_STEPS[(MIN_STEPS.indexOf(cur) + 1) % MIN_STEPS.length]
  store.upsertBuybot(chatId, { minUsd: next })
  return next
}

function cycleStep(chatId) {
  const cfg = store.buybot(chatId)
  const cur = cfg?.stepUsd ?? 25
  const next = STEP_STEPS[(STEP_STEPS.indexOf(cur) + 1) % STEP_STEPS.length]
  store.upsertBuybot(chatId, { stepUsd: next })
  return next
}

function cycleWhale(chatId) {
  const cfg = store.buybot(chatId)
  const cur = cfg?.whaleNetUsd ?? 10000
  const next = WHALE_STEPS[(WHALE_STEPS.indexOf(cur) + 1) % WHALE_STEPS.length]
  store.upsertBuybot(chatId, { whaleNetUsd: next })
  return next
}

async function testPost(bot, chatId, opts = {}) {
  const cfg = opts.cfg || store.buybot(chatId)
  if (!cfg?.ca) return false
  const tk = await ensureToken(cfg.ca)
  if (!tk) return false
  // most recent REAL buy if one exists in the last page, else a $100 sample
  const rows = await es(tk.chainId, { module: 'account', action: 'tokentx', contractaddress: cfg.ca, page: '1', offset: '30', sort: 'desc' })
  let buy = null
  for (const r of rows) {
    const from = String(r.from || '').toLowerCase()
    const to = String(r.to || '').toLowerCase()
    if (!tk.pools.has(from) || tk.pools.has(to)) continue
    if (to === String(cfg.ca).toLowerCase() || BURN_ADDRS.has(to)) continue
    const decimals = parseInt(r.tokenDecimal || '18', 10)
    const amount = Number(r.value) / 10 ** decimals
    buy = { hash: r.hash, buyer: r.to, amount, decimals, usd: tk.priceUsd ? amount * tk.priceUsd : null, ts: Number(r.timeStamp) * 1000, test: true }
    // full pre-tax amount, same as the live card: every leg out of the pool
    const full = rows
      .filter((x) => x.hash === buy.hash && tk.pools.has(String(x.from || '').toLowerCase()) && !tk.pools.has(String(x.to || '').toLowerCase()))
      .reduce((a, x) => a + Number(x.value) / 10 ** parseInt(x.tokenDecimal || '18', 10), 0)
    if (isFinite(full) && full > buy.amount) {
      buy.received = buy.amount
      buy.amount = full
      if (tk.priceUsd) buy.usd = full * tk.priceUsd
    }
    break
  }
  if (!buy) buy = { hash: '0x' + '0'.repeat(64), buyer: '0x' + '1'.repeat(40), amount: tk.priceUsd ? 100 / tk.priceUsd : 0, decimals: 18, usd: 100, test: true }
  // same supply-floored mcap as live cards
  const sup = await tokenTotalSupply(tk.chainId, cfg.ca, buy.decimals).catch(() => null)
  if (sup && tk.priceUsd) tk.mcap = Math.max(tk.mcap || 0, sup * tk.priceUsd)
  if (opts.usd) {
    buy.usd = opts.usd
    buy.amount = tk.priceUsd ? opts.usd / tk.priceUsd : buy.amount
    buy.pos = { newHolder: true }
  }
  if (buy.pos === undefined) buy.pos = buy.buyer.startsWith('0x1') ? null : await positionRead(tk.chainId, cfg.ca, buy.buyer, buy.received ?? buy.amount, buy.decimals).catch(() => null)
  const exact = !buy.buyer.startsWith('0x1') && !opts.usd ? await exactSpend(tk.chainId, tk.chain, buy).catch(() => false) : false
  if (!exact) {
    const est = await nativeSpend(tk.chain, buy.usd).catch(() => null)
    buy.native = est ? `≈${est.text}` : null
    if (est) buy.ethSpend = est.n
  }
  if (opts.whale) {
    const bagUsd = buy.pos?.bal != null && tk.priceUsd ? buy.pos.bal * tk.priceUsd : 0
    buy.netUsd = buy.buyer.startsWith('0x1') ? 31755 : await walletNetUsd(tk.chainId, tk.chain, buy.buyer, bagUsd).catch(() => null)
    if (buy.netUsd == null || buy.netUsd < 10000) buy.netUsd = Math.max(buy.netUsd || 0, 10000) // demo floor so the variant is visible
    buy.whaleAlert = true
  }
  await postBuy(bot, cfg, tk, buy)
  return true
}

let started = false
function startBuyBot(bot) {
  if (started) return
  started = true
  if (!ETHERSCAN_KEY) {
    console.warn('[buybot] ETHERSCAN_API_KEY missing — buy bot idle')
    return
  }
  setInterval(() => tick(bot).catch((e) => console.error('[buybot]', e.message)), POLL_MS)
  console.log(`[buybot] watching ${store.allBuybots().filter((c) => c.enabled !== false).length} configured chat(s), poll ${POLL_MS / 1000}s`)
}

module.exports = { startBuyBot, setup, panelText, panelKeyboard, cycleMin, cycleWhale, cycleStep, testPost, setPending, captureSetting, hasPending }
