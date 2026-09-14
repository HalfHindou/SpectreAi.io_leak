/**
 * Project Dossier — per-token "what is this project" AI brief for the RZ
 * Sentiment tab (and reusable anywhere a fundamentals read is wanted).
 *
 * GET /api/project-dossier?symbol=SPECTRE&cgId=spectre-ai
 *
 * The sentiment engine answers "what is the CROWD doing" — this answers the
 * prior question the crowd read assumes: "what IS this thing, and what does it
 * do for the space." It is the fundamentals frame that makes the sentiment
 * thesis land.
 *
 * House pattern (see market-snapshot.js / sentiment-read.js): every input is
 * gathered IN-PROCESS from real upstreams — Spectre's own data-api (prices +
 * social profile) as the reliable spine, with a listing record as silent
 * enrichment — never by self-fetching our own /api routes. The panel presents
 * the read as Spectre's own intelligence; upstream providers are NEVER named in
 * the output or the UI.
 *
 * ALWAYS PRODUCES A READ: a low-cost LLM writes the thesis from whatever data
 * we have plus its own knowledge of well-known projects (grounded to the sheet,
 * honest when it doesn't recognise a token). Deterministic `facts` come from the
 * price feed (mcap / rank — symbol-keyed, reliable), so the panel is never empty
 * even if the listing record or the model is unavailable.
 *
 * SPEED / COST: dossiers are near-static → KV 24h per asset + 60s gen lock, and
 * the cheap `fast` LLM tier. localStorage seed on the client paints instantly.
 * Registered under intel-api (tier3, gate-only) — LLM burn is never anonymous.
 */
import { chat } from '../llm-gateway.js'
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { rateLimit } from '../ratelimit.js'

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''
const CG_BASE = COINGECKO_API_KEY ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
const CG_HEADERS = { Accept: 'application/json', ...(COINGECKO_API_KEY ? { 'x-cg-pro-api-key': COINGECKO_API_KEY } : {}) }

const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').trim().replace(/\/+$/, '')
const SPECTRE_HEADERS = {
  Accept: 'application/json',
  ...(process.env.SPECTRE_API_KEY ? { 'X-API-Key': process.env.SPECTRE_API_KEY.trim() } : {}),
}

// X Dash dashboard — the project's OWN X account (bio = current positioning,
// fresher and more accurate than any listing description).
const DASHBOARD_API_BASE = (process.env.DASHBOARD_API_BASE_URL || process.env.X_DASH_BASE || 'http://5.78.199.87:8092').replace(/\/+$/, '')
const DASHBOARD_API_KEY = process.env.XDASH_API_TOKEN || process.env.DASHBOARD_API_KEY || process.env.X_DASH_API_KEY || ''
const DASHBOARD_HEADERS = DASHBOARD_API_KEY
  ? { Accept: 'application/json', Authorization: `Bearer ${DASHBOARD_API_KEY}`, 'X-API-Key': DASHBOARD_API_KEY }
  : { Accept: 'application/json' }

// Parse an X/Twitter handle from a URL or a raw @handle.
function parseHandle(v) {
  if (!v) return null
  const s = String(v).trim()
  const m = s.match(/(?:x\.com|twitter\.com)\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i) || s.match(/^@?([A-Za-z0-9_]{1,15})$/)
  const h = m?.[1] || null
  return h && !/^(home|i|intent|share|hashtag|search)$/i.test(h) ? h : null
}

// Identity prose barely changes ("what is BTC" is stable for months) — cache
// by CLASS: majors/large 30d, mid 14d, micro/on-chain 7d (they pivot/rebrand).
// Volatile numbers (mcap/rank) are overlaid LIVE on every cache hit below, so
// a month-old dossier never shows a month-old market cap.
const CACHE_TTL_S = 24 * 60 * 60 // fallback when class is unknown
const ttlForFacts = (f) => {
  const rank = Number(f?.rank)
  const looksMajor = (Number.isFinite(rank) && rank <= 100) || f?.stage === 'bluechip' || f?.stage === 'established'
  if (looksMajor) return 30 * 24 * 3600
  if (f?.stage === 'emerging') return 14 * 24 * 3600
  return 7 * 24 * 3600
}
const FACTS_ONLY_TTL_S = 600     // 10 min — retry the read next visit
const LOCK_TTL_S = 60

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const fmtUsd = (v) => {
  if (v == null) return null
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Number(v).toFixed(2)}`
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-' }
function decodeEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

// Listing descriptions are HTML with <a> tags and \r\n. Flatten to clean prose.
function cleanDescription(html, max = 900) {
  if (!html) return null
  let s = decodeEntities(String(html))
    .replace(/<a\b[^>]*>/gi, '')
    .replace(/<\/a>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (s.length > max) {
    const slice = s.slice(0, max)
    const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
    s = (lastStop > max * 0.5 ? slice.slice(0, lastStop + 1) : slice).trim()
  }
  return s || null
}

// Strip URLs/whitespace from a tweet but KEEP @handles + $cashtags (signal).
function cleanTweet(t, max = 240) {
  if (!t) return null
  const s = decodeEntities(String(t)).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

async function safeJson(url, headers, timeoutMs = 8000) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

async function resolveCgId(symbol) {
  const s = await safeJson(`${CG_BASE}/search?query=${encodeURIComponent(symbol.replace(/-/g, ' '))}`, CG_HEADERS, 6000)
  const coins = s?.coins || []
  const match = coins.find((c) => (c.symbol || '').toUpperCase() === symbol) || coins[0] || null
  return match?.id || null
}

function classifyStage({ rank, marketCap, tvl }) {
  if (rank != null && rank <= 20) return 'bluechip'
  if ((rank != null && rank <= 100) || (marketCap != null && marketCap >= 1e9) || (tvl != null && tvl >= 5e8)) return 'established'
  if ((rank != null && rank <= 350) || (marketCap != null && marketCap >= 1e8)) return 'emerging'
  if (marketCap != null && marketCap >= 1e7) return 'early'
  return 'speculative'
}

// Best-effort CoinMarketCap slug (project name, hyphenated). Often matches; when
// it doesn't the link lands on CMC's search rather than a hard 404.
function slugify(name, fallback) {
  const s = String(name || '').toLowerCase().trim().replace(/['.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || fallback || null
}

export async function gatherProjectFacts(symbol, cgIdIn) {
  const sym = String(symbol || '').toUpperCase()
  let cgId = cgIdIn || null

  // Spectre's own feeds are the reliable spine (symbol-keyed): prices give mcap
  // and rank for every token, x-bubbles carries a description + categories. The
  // listing record is silent enrichment (richer description + links + TVL).
  const [pricesRes, xbRes, coinPre] = await Promise.all([
    safeJson(`${SPECTRE_API_BASE}/v1/prices?symbols=${encodeURIComponent(sym)}`, SPECTRE_HEADERS, 7000),
    safeJson(`${SPECTRE_API_BASE}/v1/social/x-bubbles/${encodeURIComponent(sym)}`, SPECTRE_HEADERS, 9000),
    cgId ? safeJson(`${CG_BASE}/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, CG_HEADERS, 9000) : null,
  ])

  let coin = coinPre
  if (!coin && !cgId) {
    cgId = await resolveCgId(sym)
    if (cgId) coin = await safeJson(`${CG_BASE}/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, CG_HEADERS, 9000)
  }

  const px = pricesRes?.data?.[sym] || null
  const xb = xbRes?.data || xbRes || null
  const md = coin?.market_data || {}
  const links = coin?.links || {}
  const xbSocials = xb?.socials || xb?.social || {}

  // CG's official taxonomy FIRST — x-bubbles categories are social-derived
  // (which chatter circles discuss the token), so a memecoin talked about in
  // DeFi circles was getting badged "DeFi" and the read invented a DeFi thesis.
  const categories = (
    (Array.isArray(coin?.categories) && coin.categories.length ? coin.categories : xb?.categories) || []
  ).filter(Boolean).slice(0, 6)

  // Market cap, identity-anchored. /v1/prices is symbol-keyed and collides on
  // shared tickers ($ANSEM -> the "Ansem's minutes" clone at $166K). Drop the
  // px row when it disagrees with CoinGecko's identity by ~an order of
  // magnitude. Then, for an on-chain fixed-supply memecoin, quote FULL-SUPPLY
  // (FDV) like the market/DexScreener/chart do — CG's circulating undercounts
  // founder-held-but-liquid supply ($ANSEM $146M circ vs $351M full-supply).
  const cgCirc = num(md.market_cap?.usd)
  const cgFdv = num(md.fully_diluted_valuation?.usd)
  const cgPrice = num(md.current_price?.usd)
  const cgTotal = num(md.total_supply) ?? num(md.max_supply)
  const pxMcap = num(px?.market_cap)
  const pxTrusted = !(cgCirc != null && pxMcap != null && (cgCirc / pxMcap > 8 || pxMcap / cgCirc > 8))
  const circMcap = (pxTrusted ? pxMcap : null) ?? cgCirc ?? num(xb?.market_cap_usd)
  const dossierContract = coin?.contract_address
    || (coin?.platforms && Object.values(coin.platforms).find((v) => v && String(v).length > 20))
    || null
  const looksMeme = /meme|pump/.test(categories.join(' ').toLowerCase()) || /pump$/i.test(String(dossierContract || ''))
  const fullSupplyMcap = (cgPrice != null && cgTotal != null) ? cgPrice * cgTotal : cgFdv
  const useFullSupply = !!dossierContract && looksMeme && fullSupplyMcap != null && circMcap != null && fullSupplyMcap > circMcap * 1.3
  const marketCap = useFullSupply ? fullSupplyMcap : circMcap
  const rank = (pxTrusted ? num(px?.rank) : null) ?? num(coin?.market_cap_rank) ?? num(md.market_cap_rank) ?? num(xb?.rank)
  const tvl = num(md.total_value_locked?.usd)
  const name = coin?.name || xb?.name || sym
  const chain = coin?.asset_platform_id || xb?.chain || xb?.primary_chain || null
  const genesis = coin?.genesis_date || null

  const website = (Array.isArray(links.homepage) ? links.homepage.find(Boolean) : null) || xbSocials.website || null
  const handle = links.twitter_screen_name || parseHandle(xbSocials.twitter || xbSocials.x || xb?.twitter || xb?.handle)
  const twitter = handle ? `https://x.com/${handle}` : (xbSocials.twitter || xbSocials.x || null)
  const whitepaper = links.whitepaper || xbSocials.docs || xbSocials.whitepaper || null

  const description = cleanDescription(xb?.description) || cleanDescription(coin?.description?.en)

  // The project's OWN X bio + recent high-signal tweets about it — freshest,
  // most accurate "what it does / what it's shipping now" (listing descriptions
  // go stale; the account bio + live chatter track current positioning). Both
  // come from ONE author fetch.
  let xBio = null, followers = null, verified = false, recentTweets = []
  if (handle) {
    const authorPayload = await safeJson(`${DASHBOARD_API_BASE}/api/author/${encodeURIComponent(handle)}`, DASHBOARD_HEADERS, 9000)
    const author = authorPayload?.author || null
    if (author) {
      xBio = cleanDescription(author.description, 400)
      followers = num(author.followers_count)
      verified = !!(author.is_blue_verified || author.legacy_verified)
    }
    const seen = new Set()
    for (const m of (authorPayload?.top_mentions || authorPayload?.mentions || [])) {
      const text = cleanTweet(m?.tweet?.full_text || m?.tweet?.text)
      if (!text || text.length < 24) continue
      const dupKey = text.slice(0, 60).toLowerCase()
      if (seen.has(dupKey)) continue
      seen.add(dupKey)
      recentTweets.push({ by: m?.author?.screen_name || parseHandle(m?.tweet?.x_url), text })
      if (recentTweets.length >= 5) break
    }
  }

  const facts = {
    name,
    symbol: sym,
    cgId: cgId || null,
    category: categories[0] || xb?.primary_category || null,
    categories,
    stage: classifyStage({ rank, marketCap, tvl }),
    marketCap,
    marketCapFmt: fmtUsd(marketCap),
    mcapBasis: useFullSupply ? 'fdv' : 'circulating',
    isMeme: looksMeme,
    rank,
    tvl,
    tvlFmt: fmtUsd(tvl),
    chain,
    launched: genesis,
    links: {
      website: website || null,
      twitter: twitter || null,
      whitepaper: whitepaper || null,
      coinmarketcap: slugify(name, cgId) ? `https://coinmarketcap.com/currencies/${slugify(name, cgId)}/` : null,
      defillama: tvl != null && cgId ? `https://defillama.com/protocol/${cgId}` : null,
    },
  }

  return {
    sym,
    cgId: cgId || null,
    facts,
    xBio,
    handle: handle || null,
    followers,
    verified,
    recentTweets,
    description,
    coin: coin ? {
      ath: num(md.ath?.usd),
      athChangePct: num(md.ath_change_percentage?.usd),
      athDate: md.ath_date?.usd || null,
      change30d: num(md.price_change_percentage_30d),
      fdv: num(md.fully_diluted_valuation?.usd),
      circSupply: num(md.circulating_supply),
      totalSupply: num(md.total_supply) ?? num(md.max_supply),
    } : null,
  }
}

const SYSTEM_PROMPT = `You are the lead analyst at Spectre, a crypto market-intelligence desk. Write the investor-grade "what is this and is it worth attention" brief that frames the sentiment read. You have deep crypto context — place the project precisely and think like an allocator, not a marketer.

THE LENS (think through each, then write):
- SECTOR: classify from what the PRODUCT ACTUALLY DOES (the bio + tweets), NOT from the token's exchange category tags — those tags are noisy and usually list several buzzwords at once. Name the single tightest real sector. If it is an AI project, do NOT stop at "AI" and do NOT default to "DeFAI" — pick the specific AI sub-sector: AI agents (autonomous on-chain agents), AI infrastructure / compute / DePIN-AI, AI data & market-intelligence / analytics tooling, DeFAI (AI that EXECUTES DeFi — only when on-chain execution is genuinely core), AI gaming, or AI consumer apps. Non-AI sectors: L1/L2 infra, DeFi (DEX/lending/perps/stablecoins), RWA/tokenized assets, DePIN, memecoins, prediction markets, gaming, restaking, social/consumer, data/oracles. Match the bio's ACTUAL verbs. Calibration: "generates research / charts / signals / market intelligence" → AI market-intelligence & analytics; "generates 3D worlds / assets / in-game content" → AI gaming; "autonomous agents that act/trade on-chain" → AI agents; "GPU / compute / inference / model-hosting network" → AI infrastructure / DePIN-AI; "executes swaps/yield on-chain via AI" → DeFAI. Do not force everything into "market intelligence" or "DeFAI" — pick the sub-sector the product's verbs point to. LEAD with the ONE primary sector; add at most one secondary facet in a short clause and only if it is genuinely core — never give co-equal billing to tag-derived buzzwords (e.g. an AI market-intelligence platform that is "agentic" is AI market-intelligence FIRST, not an "AI agents / DeFAI" project).
- TANGIBLE UTILITY (keep a skeptical eye): the rarest, most valuable signal in crypto is a product that ACTUALLY WORKS and people use. But crypto is also full of projects that LARP — all narrative, no shipping product — and outright scams. Judge honestly from the bio, recent tweets and traction: is there a real, shipping, used product with genuine utility, or is this narrative/speculation/vaporware? Objectivity cuts BOTH ways — a project with clear evidence of a delivered, working product earns a genuinely bullish read on merit; one that only promises does NOT, and when the product is unproven or the signals look manufactured/larpy/scammy, say so plainly and make it the central risk.
- NARRATIVE / META: which attention wave does it ride (AI agents, AI tooling/intelligence, DeFAI, RWA, AI/neural gaming, prediction markets, DePIN, memecoins, etc.), and is that meta hot or cooling? The narrative MUST be consistent with the sector you named — do NOT attach a gaming or "neural gaming" meta to a non-gaming project, nor a market-intelligence meta to a gaming project. A strong product in a dead narrative and a thin product in a hot one are different bets — say which this is.
- REPUTATION & RECEIPTS (think like a trader with a memory — THIS IS WHERE MOST READS FAIL): judge the project's TRACK RECORD and standing in the culture, not its marketing. CONNECT THE DOTS: a token tied to a public figure, founder, or a known crypto venture INHERITS that entity's reputation and receipts — reason about the associated people/organisations, their other projects, and how the market treats them. Ask: did insiders/team extract value from holders (large insider or locked float, unlock dumps, a collapse from ATH after a hype launch)? Is it tied to a rug, a cash-grab, a scam, an extraction vehicle, or ongoing controversy — or conversely does it have a genuine record of delivery and honest tokenomics? Crypto has a LONG memory: a token can still trade actively while carrying heavy reputational baggage — "tradeable" is not "legitimate". Say it plainly. Example lens: a celebrity or political memecoin where insiders control most of the float, price is down heavily from ATH, and the associated figure/venture has pulled large sums out is a DISTRIBUTION / EXTRACTION vehicle a trader treats with deep suspicion — name that even though it "still trades"; a project with a shipped, used product and fair tokenomics earns the opposite read.
  CRUCIAL — do NOT confuse ordinary drawdown with extraction. After the 2024 hype cycle MOST tokens (including good ones) are down 80-95% from ATH; a large drawdown BY ITSELF is not a rug, extraction, or a red flag. Treat drawdown as an extraction / distribution tell ONLY when it combines with insider-controlled float AND the absence of a real product AND/OR a cash-grab or bad-actor pattern. A project with a genuine, shipping, USED product that is down from ATH is a small cap that retraced in a broad drawdown — NOT an extraction vehicle; do not flag it as one. Let the TANGIBLE-UTILITY finding gate this: real product → drawdown is cyclical; no product + insider float → drawdown is distribution.
- INVESTOR TAKE: the honest thesis — the single strongest reason it could win, and the single biggest risk. No price targets, no predictions, no shilling.

SOURCING PRIORITY:
- PROJECT X BIO = the account's OWN current positioning: MOST AUTHORITATIVE for what it IS. Lead with it; when it conflicts with the reference description, trust the bio (listing descriptions go stale — a project now calling itself a "market-intelligence platform" is NOT a "predictive learning tool" because an old listing says so).
- RECENT TWEETS = live context on what it's SHIPPING and how the market perceives it right now. Use them for the utility + narrative reads; if they name specific products, integrations or partners, use those concretely. Weigh them as signal, not gospel.
- REFERENCE DESCRIPTION = secondary, may be stale; never let it override the bio/tweets.
- For gaps on a project you recognise, use your own knowledge; for a project you don't recognise with no bio/tweets, stay general and NEVER invent a team, mechanism, partner, product or date.
- Numbers ONLY from the sheet (market cap, rank, TVL, followers). Never fabricate a figure.
- NEVER name, credit or reference any third-party data provider, index, aggregator or exchange in your output. Present the read as Spectre's own.

VOICE: dry, precise, allocator-to-allocator. BANNED: "revolutionary", "game-changer", "disrupt", "next-gen", "to the moon", exclamation marks, emojis, hype adjectives.

Respond with STRICT JSON, no markdown fences:
{
  "one_liner": "string, <= 120 chars — what it IS in one plain line",
  "what_it_does": "2-3 sentences: the actual product and what a user does with it",
  "sector_read": "1-2 sentences: the precise sector and where it honestly sits vs peers (leader / challenger / niche / speculative)",
  "utility_read": "1-2 sentences: is there a real, working product with tangible utility, or narrative-only? be honest — this is the rare, valuable signal",
  "narrative_read": "1-2 sentences: the meta/narrative it rides and whether attention is currently with it",
  "investor_take": "2-3 sentences: the strongest reason it could win + the single biggest risk, informed by its track record and reputation. No predictions.",
  "red_flags": ["0-3 SPECIFIC, DIFFERENTIATING red flags — a genuine trader concern UNIQUE to this token, never boilerplate. HARD BAN (never output — these apply to nearly all crypto and are pure noise): 'high volatility', 'volatility', 'regulatory risk', 'regulatory uncertainty', 'market risk', 'macro risk', 'competition', 'competitive market', 'adoption risk', 'liquidity risk', 'small cap', 'early stage', 'market cap', 'speculative' (as a standalone). ONLY surface a flag when it is a real, specific concern grounded in the sheet or the project's known reputation: insider-controlled float / unlock overhang, FDV far above market cap, no working product (pure speculation), extraction or rug reputation, a heavy drawdown ON TOP OF having no product, dependence on one controversial figure/entity, quarantined or manufactured chatter. If it is a blue-chip or simply has no genuine token-specific concern, return [] — an EMPTY list is the correct, expected answer and is far better than a generic flag. NEVER invent a flag to fill the field."],
  "comparable_to": ["1-3 well-known reference projects a reader would recognise, or []"],
  "tags": ["2-4 short sector/theme tags"]
}`

function buildUserContent(s) {
  const f = s.facts
  const lines = [
    `PROJECT: ${f.name} ($${f.symbol})${s.handle ? ` · @${s.handle}` : ''}`,
    f.categories.length ? `CATEGORIES: ${f.categories.join(', ')}` : 'CATEGORIES: n/a',
    `MARKET STANDING: rank ${f.rank ?? 'n/a'} · market cap ${f.marketCapFmt || 'n/a'}${f.tvlFmt ? ` · TVL ${f.tvlFmt}` : ''}${s.followers > 0 ? ` · ${s.followers.toLocaleString()} X followers${s.verified ? ' (verified)' : ''}` : ''}`,
    f.chain ? `PRIMARY CHAIN: ${f.chain}` : null,
    f.launched ? `LAUNCHED: ${f.launched}` : null,
    s.coin?.ath != null ? `ATH ${fmtUsd(s.coin.ath)}${s.coin.athChangePct != null ? ` (${s.coin.athChangePct.toFixed(0)}% from ATH${s.coin.athDate ? `, ${s.coin.athDate.slice(0, 7)}` : ''})` : ''}` : null,
    // Market-structure FACTS (neutral — interpret them per the reputation lens;
    // a big drawdown on a project WITH a real product is ordinary cyclicality,
    // NOT extraction. Only insider-float + no-product + bad-actor patterns are).
    (() => {
      const c = s.coin
      if (!c) return null
      const parts = []
      if (c.athChangePct != null && c.athChangePct <= -60) parts.push(`down ${Math.abs(Math.round(c.athChangePct))}% from ATH`)
      if (c.fdv != null && f.marketCap != null && f.marketCap > 0) {
        const r = c.fdv / f.marketCap
        // "non-circulating" ≠ "locked". For a memecoin it is founder/insider-held
        // and fully sellable (concentration / distribution risk); only a project
        // with an actual vesting schedule is "locked/unvested". Say both, let the
        // reputation lens pick — never assert a lockup that may not exist.
        if (r >= 1.6) parts.push(`FDV ${fmtUsd(c.fdv)} = ${r.toFixed(1)}x market cap (large non-circulating float — for a memecoin this is founder/insider-held & sellable, not a vesting lockup)`)
      }
      if (c.circSupply != null && c.totalSupply != null && c.totalSupply > 0) {
        const pct = 100 * c.circSupply / c.totalSupply
        if (pct < 55) parts.push(`only ${Math.round(pct)}% of supply circulating${f.isMeme ? ' (memecoin: the rest is founder/insider-held & liquid — concentration/distribution risk, NOT a vesting lockup)' : ''}`)
      }
      return parts.length ? `MARKET STRUCTURE (neutral facts — interpret in context): ${parts.join(' · ')}` : null
    })(),
    '',
    s.xBio
      ? `PROJECT X BIO (the account's OWN current positioning — MOST AUTHORITATIVE, lead with this):\n${s.xBio}`
      : 'PROJECT X BIO: unavailable.',
    s.recentTweets?.length
      ? `RECENT HIGH-SIGNAL TWEETS ABOUT THE PROJECT (live context on what it's shipping + how it's perceived — use for the utility + narrative reads):\n${s.recentTweets.map((t) => `  - ${t.by ? `@${t.by}: ` : ''}${t.text}`).join('\n')}`
      : null,
    s.description
      ? `REFERENCE DESCRIPTION (secondary — may be outdated, do not let it override the bio/tweets):\n${s.description}`
      : (s.xBio ? null : 'REFERENCE DESCRIPTION: none. If you recognise this project describe it from your own knowledge; otherwise infer from category + market standing and keep it general.'),
  ]
  return lines.filter((l) => l !== null).join('\n')
}

// Generic, applies-to-all-crypto flags that carry no signal — stripped even if
// the model emits them (belt-and-suspenders over the prompt ban).
const GENERIC_FLAG_RE = /\b(high\s+)?volatilit|regulator|\bmarket\s+risk|\bmacro\s+risk|competit|adoption\s+risk|liquidity\s+risk|small[\s-]?cap|early[\s-]?stage|\bmarket\s+cap\b|price\s+risk|market\s+conditions|market\s+downturn/i
function isGenericFlag(f) {
  const s = String(f).trim()
  return GENERIC_FLAG_RE.test(s) || /^speculative\.?$/i.test(s)
}

function sanitizeRead(raw) {
  if (!raw || typeof raw !== 'object') return null
  const str = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const arr = (v, maxItems, maxLen = 48) => (Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [])
  const one = str(raw.one_liner, 140)
  const what = str(raw.what_it_does, 600)
  if (!one && !what) return null
  return {
    one_liner: one,
    what_it_does: what,
    sector_read: str(raw.sector_read, 400),
    utility_read: str(raw.utility_read, 400),
    narrative_read: str(raw.narrative_read, 400),
    investor_take: str(raw.investor_take, 500),
    red_flags: (Array.isArray(raw.red_flags) ? raw.red_flags.map((x) => str(x, 72)).filter(Boolean).filter((f) => !isGenericFlag(f)) : []).slice(0, 3),
    comparable_to: arr(raw.comparable_to, 3),
    tags: arr(raw.tags, 4),
  }
}

export async function generateDossier(symbol, cgId) {
  const snapshot = await gatherProjectFacts(symbol, cgId)

  let read = null
  try {
    const r = await chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(snapshot) },
      ],
      tier: 'smart', // 70b — enough world/crypto knowledge to reason about reputation, entity ties, extraction
      json: true,
      maxTokens: 850,
      temperature: 0.2, // tighter — sticks to the primary-sector-first framing
      timeoutMs: 24_000,
    })
    if (r.ok && r.text) {
      let parsed = null
      try {
        parsed = JSON.parse(r.text)
      } catch {
        const m = r.text.match(/\{[\s\S]*\}/)
        if (m) { try { parsed = JSON.parse(m[0]) } catch { parsed = null } }
      }
      read = sanitizeRead(parsed)
      if (read) read.provider = r.provider
    }
  } catch {
    read = null // deterministic facts still stand
  }

  return {
    facts: snapshot.facts,
    summary: snapshot.xBio || snapshot.description, // prefer the current X bio
    read,
    generatedAt: new Date().toISOString(),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const symbol = String(req.query.symbol || '').trim().toUpperCase()
  const cgId = String(req.query.cgId || '').trim() || null
  if (!symbol || !/^[A-Z0-9$._-]{1,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbol required' })
  }
  if (await rateLimit(req, res, { bucket: 'project-dossier', max: 20, windowMs: 60_000 })) return

  // v9: categories CG-first (social-derived xb tags demoted) + followers>0 guard
  const key = `project-dossier:v9:${(cgId || symbol).toLowerCase()}`
  const lockKey = `${key}:gen`

  const factsOnly = async () => {
    const snap = await gatherProjectFacts(symbol, cgId)
    return { facts: snap.facts, summary: snap.description, read: null, generatedAt: new Date().toISOString() }
  }

  try {
    const cached = await getJsonWithTTL(key)
    if (cached?.facts) {
      // Overlay LIVE market numbers on the cached identity prose (1.2s budget,
      // serve as-is if the feed is slow) — long-cached dossiers stay honest.
      try {
        const pxRes = await safeJson(`${SPECTRE_API_BASE}/v1/prices?symbols=${encodeURIComponent(symbol)}`, SPECTRE_HEADERS, 1_200)
        const row = pxRes?.data?.[symbol]
        const liveMcap = num(row?.market_cap)
        const liveRank = num(row?.rank)
        if (liveMcap != null && cached.facts.marketCap != null
          && liveMcap / cached.facts.marketCap < 8 && cached.facts.marketCap / liveMcap < 8) {
          cached.facts.marketCap = liveMcap
          cached.facts.marketCapFmt = fmtUsd(liveMcap)
          if (liveRank != null) cached.facts.rank = liveRank
        }
      } catch { /* serve cached numbers */ }
      return res.status(200).json({ dossier: cached, cached: true })
    }

    const lock = await getJsonWithTTL(lockKey)
    if (lock) {
      // another instance is generating the LLM read — return the cheap facts now
      // (no empty state), no cache.
      return res.status(200).json({ dossier: await factsOnly(), pending: true })
    }
    await setJsonWithTTL(lockKey, { ts: Date.now() }, LOCK_TTL_S)

    const dossier = await generateDossier(symbol, cgId)
    // Cache HARD once the read landed; facts-only caches short so the read fills
    // in on the next visit rather than sticking 24h.
    await setJsonWithTTL(key, dossier, dossier.read ? ttlForFacts(dossier.facts) : FACTS_ONLY_TTL_S)
    return res.status(200).json({ dossier, cached: false })
  } catch (err) {
    console.error('[project-dossier] error:', err.message)
    try {
      return res.status(200).json({ dossier: await factsOnly(), error: 'partial' })
    } catch {
      return res.status(200).json({ dossier: null, error: 'unavailable' })
    }
  }
}
