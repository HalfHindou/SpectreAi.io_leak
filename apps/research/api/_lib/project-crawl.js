/**
 * project-crawl — Phase 2 of the Sentiment Intelligence plan.
 *
 * Reads a project from its OWN website + docs (not just CG's blurb), extracts
 * structured fundamentals with a CHEAP (`fast`/groq) LLM pass, and caches the
 * result 24h in KV keyed by cgId. Fundamentals move slowly, so one crawl serves
 * every viewer for a day — the low-cost contract.
 *
 * Never throws. Returns null when there's nothing to crawl or the extract fails,
 * so the desk read degrades to the free CG fundamentals (Phase 1).
 */
import { chat } from './llm-gateway.js'
import { getJsonWithTTL, setJsonWithTTL } from './kv.js'

const CRAWL_TTL_S = 24 * 3600
const PER_PAGE_CHARS = 6000
const CORPUS_CHARS = 9000

// Strip a page to readable text — no heavy readability dep (keeps the bundle
// lean and the crawl cheap). Drops script/style/nav noise, collapses whitespace.
function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// GitHub owners/repos linked from a page — the site is where the REAL repo lives
// (CoinGecko often lacks the link, which makes a shipping project read "0 commits").
function findGithub(html) {
  const out = new Set()
  const re = /github\.com\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?/g
  let m
  while ((m = re.exec(String(html || ''))) !== null) {
    const owner = m[1]
    if (/^(?:features|about|pricing|marketplace|topics|sponsors|login|join|orgs|site|readme|apps)$/i.test(owner)) continue
    out.add(m[2] ? `${owner}/${m[2].replace(/\.git$/, '')}` : owner)
    if (out.size >= 6) break
  }
  return [...out]
}

// Social links the site itself points at — the site naming an X handle is the
// verification that the handle belongs to THIS project (CG's handle field can
// be stale or absent; a site's own footer link cannot be someone else's).
function findSocial(html) {
  const src = String(html || '')
  const out = {}
  const xRe = /(?:twitter|x)\.com\/(?:@|#!\/)?([A-Za-z0-9_]{2,15})(?=["'/?#\s])/g
  const X_SKIP = new Set(['intent', 'share', 'home', 'search', 'hashtag', 'i', 'login', 'signup', 'privacy', 'tos', 'settings', 'explore', 'notifications', 'messages', 'compose'])
  let m
  while ((m = xRe.exec(src)) !== null) {
    if (X_SKIP.has(m[1].toLowerCase())) continue
    out.x = m[1]
    break
  }
  const tg = src.match(/t\.me\/(?:@)?([A-Za-z0-9_]{4,32})/)
  if (tg && !/^(share|joinchat|addstickers)$/i.test(tg[1])) out.telegram = tg[1]
  const dc = src.match(/discord(?:\.gg|(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})/)
  if (dc) out.discord = dc[1]
  return out
}

async function fetchText(url, timeoutMs = 8000) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpectreResearch/1.0)', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (!/html|text/i.test(ct)) return null
    const html = await r.text()
    const text = htmlToText(html)
    if (text.length <= 80) return null
    return { text: text.slice(0, PER_PAGE_CHARS), github: findGithub(html), social: findSocial(html) }
  } catch {
    return null
  }
}

// Real build signal from GitHub's free API (60/hr unauth — fine on-demand +
// cached). Given an "owner" or "owner/repo", report last push + recent activity.
const GH_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'SpectreResearch/1.0' }
async function checkGithub(ownerOrRepo) {
  try {
    const parts = String(ownerOrRepo).split('/')
    let repo = null
    let scope = 'repo'
    if (parts.length >= 2) {
      const r = await fetch(`https://api.github.com/repos/${parts[0]}/${parts[1]}`, { headers: GH_HEADERS, signal: AbortSignal.timeout(7000) })
      if (r.ok) repo = await r.json()
    }
    if (!repo) {
      // org/user → most recently pushed public repo. This measures the newest
      // PUBLIC push only — teams shipping in private repos look idle here, so
      // consumers must never read this as team inactivity (the SPECTRE lesson:
      // a 549d-idle public mirror became "minimal development activity").
      const r = await fetch(`https://api.github.com/users/${parts[0]}/repos?sort=pushed&per_page=5`, { headers: GH_HEADERS, signal: AbortSignal.timeout(7000) })
      if (!r.ok) return null
      const list = await r.json()
      repo = Array.isArray(list) ? list.find((x) => !x.fork) || list[0] : null
      scope = 'org-newest-public'
    }
    if (!repo || !repo.full_name) return null
    const pushedAt = repo.pushed_at || null
    const daysSincePush = pushedAt ? Math.round((Date.now() - new Date(pushedAt).getTime()) / 86400000) : null
    return {
      repo: repo.full_name,
      scope,
      stars: Number(repo.stargazers_count) || 0,
      lastPushDays: daysSincePush,
      openIssues: Number(repo.open_issues_count) || 0,
      language: repo.language || null,
      active: daysSincePush != null && daysSincePush <= 45,
    }
  } catch {
    return null
  }
}

const EXTRACT_PROMPT = `You are a crypto research analyst extracting fundamentals from a project's OWN website and docs. Return STRICT JSON only, no markdown. Use null / [] when a fact is NOT stated — NEVER invent a team member, backer, partner, metric, or date. Be skeptical: marketing copy is not proof of a shipped product.

CRITICAL — do NOT confuse listings/logos with backing:
- A CENTRALISED EXCHANGE the token trades on (Binance, Coinbase, Bitget, MEXC, Gate, KuCoin, OKX, Bybit, Kraken, HTX, etc.) is a LISTING, not a backer, investor, or partner. Every token is listed somewhere.
- A DATA AGGREGATOR (CoinGecko, CoinMarketCap, DexScreener, DEXTools, GeckoTerminal, DeFiLlama) is NOT a backer or partner — every token is on them.
- "backers" = only NAMED venture funds / angel investors / strategic partners the site explicitly frames as having invested in or partnered with the project. If in doubt, leave backers empty.
- Put any exchanges the token is listed on in "exchanges" (a liquidity signal), NOT in backers.

{
  "what_it_does": "one plain sentence, or null",
  "product_stage": "live" | "beta" | "testnet" | "prelaunch" | "unknown",
  "team": "doxxed" | "named" | "anon" | "unknown",
  "backers": ["ONLY named VCs/investors/strategic partners explicitly stated — never exchanges or aggregators"],
  "exchanges": ["CEXes the token is listed on, if stated"],
  "traction": ["only concrete stated metrics: users, TVL, revenue, integrations"],
  "roadmap_next": "the next concrete milestone the site states, or null",
  "differentiator": "one sentence on the edge/moat if stated, or null",
  "evidence_of_shipping": "live product/app/demo link or usage described? yes | claimed | no"
}`

const STAGES = new Set(['live', 'beta', 'testnet', 'prelaunch', 'unknown'])
const TEAMS = new Set(['doxxed', 'named', 'anon', 'unknown'])
const SHIP = new Set(['yes', 'claimed', 'no'])

// Deterministic backstop — exchanges + aggregators are NEVER backers, even if the
// model slips (logos on a site read as "partners"). A listing is liquidity, not backing.
const EXCHANGES = new Set(['binance', 'coinbase', 'bitget', 'mexc', 'gate', 'gate.io', 'kucoin', 'okx', 'bybit', 'kraken', 'htx', 'huobi', 'bingx', 'bitmart', 'lbank', 'crypto.com', 'upbit', 'bithumb', 'gemini', 'bitfinex', 'probit', 'coinex', 'digifinex', 'whitebit', 'phemex', 'ascendex', 'bitrue', 'poloniex', 'xt', 'bitstamp'])
const AGGREGATORS = new Set(['coingecko', 'gecko', 'coinmarketcap', 'cmc', 'dexscreener', 'dextools', 'geckoterminal', 'defillama', 'coincodex', 'livecoinwatch', 'cryptocompare', 'nomics'])
function classifyEntity(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9.& ]/g, '').trim()
  if (!n) return 'other'
  for (const a of AGGREGATORS) if (n === a || n.split(/\s+/).includes(a) || n.includes(a)) return 'aggregator'
  for (const x of EXCHANGES) if (n === x || n.split(/\s+/).includes(x) || n.includes(x)) return 'exchange'
  return 'other'
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const str = (v, max = 240) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const arr = (v, n = 6) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, n) : [])

  // Split backers vs exchanges vs aggregators — aggregators dropped entirely,
  // exchanges kept as a listing signal, only real investors survive as backers.
  const backers = []
  const exchanges = new Set(arr(raw.exchanges).filter((e) => classifyEntity(e) !== 'aggregator'))
  for (const b of arr(raw.backers, 10)) {
    const c = classifyEntity(b)
    if (c === 'exchange') exchanges.add(b)
    else if (c === 'aggregator') continue
    else backers.push(b)
  }

  const out = {
    whatItDoes: str(raw.what_it_does),
    productStage: STAGES.has(raw.product_stage) ? raw.product_stage : 'unknown',
    team: TEAMS.has(raw.team) ? raw.team : 'unknown',
    backers: backers.slice(0, 6),
    exchanges: [...exchanges].slice(0, 8),
    traction: arr(raw.traction),
    roadmapNext: str(raw.roadmap_next, 160),
    differentiator: str(raw.differentiator),
    evidenceOfShipping: SHIP.has(raw.evidence_of_shipping) ? raw.evidence_of_shipping : null,
  }
  // Nothing meaningful extracted → treat as no crawl.
  if (!out.whatItDoes && !out.differentiator && !out.backers.length && !out.traction.length) return null
  return out
}

export async function crawlProject({ cgId, website, docs }) {
  const id = String(cgId || '').toLowerCase()
  if (!id || (!website && !docs)) return null
  const key = `proj-crawl:v4:${id}`
  try {
    const cached = await getJsonWithTTL(key)
    if (cached) return cached
  } catch { /* KV miss */ }

  const [sitePage, docsPage] = await Promise.all([
    website ? fetchText(website) : null,
    docs ? fetchText(docs) : null,
  ])
  if (!sitePage && !docsPage) return null

  const corpus = [
    sitePage && `WEBSITE (${website}):\n${sitePage.text}`,
    docsPage && `DOCS (${docs}):\n${docsPage.text}`,
  ].filter(Boolean).join('\n\n---\n\n').slice(0, CORPUS_CHARS)

  // GitHub linked from the site/docs — prefer an owner/repo over a bare owner.
  const ghPick = [...(sitePage?.github || []), ...(docsPage?.github || [])]
    .sort((a, b) => (b.includes('/') ? 1 : 0) - (a.includes('/') ? 1 : 0))[0] || null

  // Extract facts + verify GitHub in parallel.
  const [factsRes, build] = await Promise.all([
    chat({
      messages: [{ role: 'system', content: EXTRACT_PROMPT }, { role: 'user', content: corpus }],
      tier: 'fast', json: true, maxTokens: 500, temperature: 0.2, timeoutMs: 20_000,
    }).catch(() => null),
    ghPick ? checkGithub(ghPick) : Promise.resolve(null),
  ])

  let facts = null
  if (factsRes?.ok && factsRes.text) {
    try { facts = JSON.parse(factsRes.text) } catch {
      const m = factsRes.text.match(/\{[\s\S]*\}/)
      if (m) { try { facts = JSON.parse(m[0]) } catch { facts = null } }
    }
  }

  const out = sanitize(facts)
  if (out) {
    out.sources = [website && 'website', docs && 'docs', build && 'github'].filter(Boolean)
    if (build) out.build = build
    // The site's own outbound social links — the site naming an X handle is
    // the strongest proof the handle belongs to THIS project.
    const social = { ...(docsPage?.social || {}), ...(sitePage?.social || {}) }
    if (Object.keys(social).length) out.links = social
    try { await setJsonWithTTL(key, out, CRAWL_TTL_S) } catch { /* non-fatal */ }
  }
  return out
}
