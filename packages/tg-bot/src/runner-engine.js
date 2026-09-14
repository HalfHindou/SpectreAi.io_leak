// Runner engine: X-Dash social candidates × Codex/DexScreener on-chain truth
// (volume, liquidity, buy pressure) × GoPlus safety gate → ranked picks.
// "x dash needs codex connection" — this is that connection.
const api = require('./spectre-api')
const { tradeTokenUrl } = require('./config')
const { esc, usd, move, compact } = require('./format')

const CODEX_KEY = process.env.CODEX_API_KEY
const CHAINS = {
  ethereum: { codexId: 1, tag: '⟠ eth' },
  base: { codexId: 8453, tag: '🔵 base' },
  solana: { codexId: 1399811149, tag: '◎ sol' },
  robinhood: { codexId: null, tag: '🏹 robinhood' }, // not on Codex yet → DexScreener
}
const CHAIN_ALIAS = { eth: 'ethereum', sol: 'solana', rh: 'robinhood', robin: 'robinhood' }

function screenerUrl(contract) {
  return tradeTokenUrl(contract)
}

// ---- on-chain enrichment

async function codexLookup(contract, codexId) {
  if (!CODEX_KEY) return null
  const res = await fetch('https://graph.codex.io/graphql', {
    method: 'POST',
    headers: { Authorization: CODEX_KEY, Origin: 'https://app.spectreai.io', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ filterTokens(tokens: ["${contract}:${codexId}"]) { results { priceUSD volume24 liquidity marketCap change24 uniqueBuys24 uniqueSells24 } } }`,
    }),
    signal: AbortSignal.timeout(12e3),
  }).catch(() => null)
  if (!res?.ok) return null
  const json = await res.json().catch(() => null)
  const r = json?.data?.filterTokens?.results?.[0]
  if (!r) return null
  return {
    source: 'codex',
    vol24: +r.volume24 || 0,
    liq: +r.liquidity || 0,
    mcap: +r.marketCap || 0,
    chg24: (+r.change24 || 0) * 100,
    buys: r.uniqueBuys24 ?? null,
    sells: r.uniqueSells24 ?? null,
  }
}

async function dexscreenerLookup(contract) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`, {
    signal: AbortSignal.timeout(10e3),
  }).catch(() => null)
  if (!res?.ok) return null
  const json = await res.json().catch(() => null)
  const pairs = json?.pairs || []
  if (!pairs.length) return null
  const p = pairs.reduce((a, b) => ((b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a))
  return {
    source: 'dexscreener',
    vol24: p.volume?.h24 || 0,
    liq: p.liquidity?.usd || 0,
    mcap: p.marketCap || p.fdv || 0,
    chg24: p.priceChange?.h24 ?? 0,
    buys: p.txns?.h24?.buys ?? null,
    sells: p.txns?.h24?.sells ?? null,
  }
}

async function enrich(contract, chain) {
  const codexId = CHAINS[chain]?.codexId
  let onchain = codexId ? await codexLookup(contract, codexId) : null
  if (!onchain || (!onchain.vol24 && !onchain.liq)) onchain = await dexscreenerLookup(contract)
  return onchain
}

async function safety(contract) {
  const d = await api.get(`/v1/security/token?query=${encodeURIComponent(contract)}`, { ttlMs: 10 * 60e3, timeoutMs: 15e3 }).catch(() => null)
  if (!d?.resolved) return null
  // the resolver sometimes answers for a DIFFERENT token — only trust an exact contract match
  const resolvedCa = String(d.identity?.contract_address || '').toLowerCase()
  if (resolvedCa !== String(contract).toLowerCase()) return null
  return {
    score: d.scores?.spectre_score ?? null,
    flags: (d.risk_flags || []).length,
    honeypot: d.security?.is_honeypot === true,
  }
}

// ---- candidates + scoring

function extractContract(t) {
  const plat = t.platforms || {}
  for (const chain of Object.keys(CHAINS)) {
    if (plat[chain] && /^[a-zA-Z0-9.:]{20,}$/.test(plat[chain])) return { chain, contract: plat[chain] }
  }
  if (t.contract_address && CHAINS[t.chain]) return { chain: t.chain, contract: t.contract_address }
  return null
}

async function candidates(chainFilter) {
  const boot = await api.xdashBootstrap('24h', 100)
  const out = []
  for (const t of boot?.tokens || []) {
    if (t.is_major_asset || t.is_stable_like || t.is_wrapped_like) continue
    const mc = t.market_cap || 0
    const mentions = t.effective_external_mentions_24h ?? t.mentions_24h ?? 0
    if (mc < 100e3 || mc > 100e6 || mentions < 8) continue
    const loc = extractContract(t)
    if (!loc) continue
    if (chainFilter && loc.chain !== chainFilter) continue
    out.push({
      symbol: (t.symbol || t.our_symbol || '').toUpperCase(),
      name: t.name,
      chain: loc.chain,
      contract: loc.contract,
      mentions,
      velocity: t.velocity_ratio ?? 0,
      authors: t.effective_unique_external_authors_24h ?? t.unique_external_authors_24h ?? 0,
      voices: (t.top_authors || []).slice(0, 2).map((a) => (typeof a === 'string' ? a : a.handle || a.username || '')).filter(Boolean),
      cleanSignal: t.clean_signal_score_24h ?? null,
      mcapSocial: mc,
    })
  }
  // strongest social first — we only enrich the top slice (API budget)
  return out.sort((a, b) => b.velocity * 10 + b.mentions / 10 - (a.velocity * 10 + a.mentions / 10))
}

function scorePick(c) {
  let s = 0
  s += Math.min(c.velocity, 10) * 6 // social acceleration
  s += Math.min(c.mentions / 10, 10) * 2 // social breadth
  const oc = c.onchain
  if (oc) {
    const total = (oc.buys ?? 0) + (oc.sells ?? 0)
    if (total > 20) s += ((oc.buys / total) - 0.5) * 60 // buy pressure (demand)
    const turnover = oc.mcap > 0 ? oc.vol24 / oc.mcap : 0
    s += Math.min(turnover, 3) * 8 // volume vs size
    if (oc.chg24 > 0) s += Math.min(oc.chg24, 150) / 10
    if (oc.liq > 0 && oc.liq < 30e3) s -= 15 // dust liquidity = exit risk
  } else {
    s -= 10 // no on-chain confirmation
  }
  if (c.safety) {
    if (c.safety.honeypot) return -999
    if (c.safety.flags > 2) s -= 25
    else if (c.safety.score >= 70) s += 8
  }
  return s
}

// ---- public API

const cache = new Map()
async function picks(chainArg, limit = 5) {
  const chain = chainArg ? CHAIN_ALIAS[chainArg] || chainArg : null
  if (chain && !CHAINS[chain]) return { error: `Unknown chain "${esc(chainArg)}" — try eth, sol, base or robinhood.` }
  const key = chain || 'all'
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 3 * 60e3) return hit.data

  const cands = (await candidates(chain)).slice(0, 12)
  await Promise.all(
    cands.map(async (c) => {
      const [onchain, safe] = await Promise.all([enrich(c.contract, c.chain), safety(c.contract)])
      c.onchain = onchain
      c.safety = safe
      c.score = scorePick(c)
    }),
  )
  const ranked = cands
    .filter((c) => c.score > -100)
    .filter((c) => !c.onchain || c.onchain.liq >= 15e3) // dust pools are untradeable — out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  const data = { picks: ranked, chain }
  cache.set(key, { at: Date.now(), data })
  return data
}

function picksCard({ picks: list, chain, error }) {
  if (error) return error
  if (!list?.length) return '🍳 Nothing cooking on that chain right now — check back soon.'
  const head = chain ? `${CHAINS[chain].tag}` : 'eth · sol · base · robinhood'
  const lines = [`🍳 <b>Runner Picks</b> — ${head} · 𝕏 social × Codex onchain × safety`, '']
  list.forEach((c, i) => {
    const oc = c.onchain
    const mcap = oc?.mcap || c.mcapSocial
    lines.push(`${i + 1}. <a href="${screenerUrl(c.contract)}"><b>$${esc(c.symbol)}</b></a> ${CHAINS[c.chain].tag} — ${usd(mcap)}${oc ? ` ${move(oc.chg24)}` : ''}`)
    if (oc) {
      const total = (oc.buys ?? 0) + (oc.sells ?? 0)
      const bp = total > 0 ? Math.round((oc.buys / total) * 100) : null
      lines.push(
        `    vol ${usd(oc.vol24)}${mcap > 0 ? ` (${(oc.vol24 / mcap).toFixed(1)}x mcap)` : ''} · liq ${usd(oc.liq)}${bp != null ? ` · buys ${bp}%` : ''}`,
      )
    }
    const safetyBit = c.safety
      ? c.safety.flags === 0
        ? `safety ✅${c.safety.score != null ? ` ${c.safety.score}/100` : ''}`
        : `⚠️ ${c.safety.flags} flags`
      : 'safety —'
    lines.push(`    𝕏 ${compact(c.mentions)} mentions ${c.velocity ? `· ${c.velocity.toFixed(1)}x avg ` : ''}· ${safetyBit}`)
    lines.push(`    <code>${esc(c.contract)}</code>`)
  })
  lines.push('', '<i>Links open the AI Screener · NFA, size like it can rug</i>')
  return lines.join('\n')
}

module.exports = { picks, picksCard, screenerUrl, CHAINS }
