/**
 * Vercel Serverless - Dossier Aggregator (Project Tab)
 *
 * Stateless aggregator. Fans out to multiple upstreams in parallel and merges
 * into a single rich dossier shape consumed by rz-project-cinema.jsx. Zero
 * local storage - relies on Vercel CDN edge cache + in-memory function cache.
 *
 * Upstreams (all parallel, allSettled, missing values are silently skipped):
 *
 *   spectre-data-api (X-API-Key + TLS bypass for cert mismatch):
 *     /v1/intelligence/projects/:sym   team, partnerships, github, whitepaper
 *     /v1/profiles/:sym                 tagline, categories, links, scores
 *     /v1/dossier/:sym                  thesis, catalysts, risk_flags, brain_voice
 *     /v1/intelligence/signals/:sym     live signals
 *     /v1/token-intel/website/:sym      live web crawl: roadmap, team, blog
 *
 *   public APIs (skip if hint params missing):
 *     CoinGecko /coins/:cgId            description, categories, repos, homepage, twitter
 *     DeFiLlama /protocol/:slug         TVL by chain, audits, category
 *     DexScreener /tokens/:address      DEX pairs, liquidity, age
 *     GitHub /repos/:owner/:repo        live stars, forks, pushed_at, issues
 *
 * Path: /api/dossier-proxy?symbol=BTC[&address=0x...][&networkId=1][&cgId=bitcoin][&githubUrl=...]
 *   ?refresh=1   bypass cache
 */
import https from 'node:https'
import http from 'node:http'
import { fetchProjectIntel } from '../project-intel.js'

// SPECTRE_API_BASE env switches between CF-fronted (TLS) and direct Hetzner
// (HTTP). Default to direct origin so cold-starts work even when the env var
// is not set on Vercel — `api.spectreai.io` is CF-WAF blocked for server-to-
// server traffic from Vercel's egress IPs (audit 2026-05-26).
const _spectreBase = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
const _spectreUrl = new URL(_spectreBase)
const SPECTRE_HOST = _spectreUrl.hostname
const SPECTRE_PORT = _spectreUrl.port ? parseInt(_spectreUrl.port, 10) : (_spectreUrl.protocol === 'https:' ? 443 : 80)
const _httpMod = _spectreUrl.protocol === 'https:' ? https : http
const FETCH_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 5 * 60 * 1000

const _cache = new Map()
function getCached(key) {
  const e = _cache.get(key)
  if (!e || Date.now() - e.ts > CACHE_TTL_MS) { _cache.delete(key); return null }
  return e.data
}
function setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() })
  if (_cache.size > 500) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) _cache.delete(oldest[0])
  }
}

// ── Upstream fetchers ─────────────────────────────────────────────────────────

function fetchSpectre(path, apiKey) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: SPECTRE_HOST,
      port: SPECTRE_PORT,
      path,
      method: 'GET',
      headers: { 'X-API-Key': apiKey, Accept: 'application/json', 'User-Agent': 'spectre-research/dossier-proxy' },
      rejectUnauthorized: false,
      timeout: FETCH_TIMEOUT_MS,
    }
    const req = _httpMod.request(opts, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 500, json: body ? JSON.parse(body) : null }) }
        catch (e) { reject(new Error('spectre JSON parse: ' + e.message)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('spectre timeout')))
    req.end()
  })
}

async function fetchPublic(url, headers = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'spectre-research/dossier-proxy', ...headers },
      signal: ctrl.signal,
    })
    if (!res.ok) return { status: res.status, json: null }
    return { status: res.status, json: await res.json() }
  } finally {
    clearTimeout(timer)
  }
}

function fetchCoinGecko(cgId, cgKey) {
  if (!cgId) return Promise.resolve(null)
  const base = cgKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
  const url = `${base}/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`
  const headers = cgKey ? { 'x-cg-pro-api-key': cgKey } : {}
  return fetchPublic(url, headers).then(r => (r && r.status === 200 ? r.json : null)).catch(() => null)
}

// When the caller didn't pass a cgId hint, resolve one via CoinGecko search.
// Picks the highest-rank exact-symbol match. Cached 24h per symbol.
const _cgSlugCache = new Map() // symbol -> { slug, ts }
const CG_SLUG_TTL = 24 * 60 * 60 * 1000
async function resolveCoinGeckoId(symbol, cgKey) {
  if (!symbol) return null
  const cached = _cgSlugCache.get(symbol)
  if (cached && Date.now() - cached.ts < CG_SLUG_TTL) return cached.slug
  const base = cgKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
  const headers = cgKey ? { 'x-cg-pro-api-key': cgKey } : {}
  try {
    const r = await fetchPublic(`${base}/search?query=${encodeURIComponent(symbol)}`, headers)
    if (!r || r.status !== 200) return null
    const coins = Array.isArray(r.json?.coins) ? r.json.coins : []
    const exact = coins.filter(c => (c.symbol || '').toUpperCase() === symbol.toUpperCase())
    const best = exact.sort((a, b) => {
      const ra = a.market_cap_rank == null ? 1e9 : a.market_cap_rank
      const rb = b.market_cap_rank == null ? 1e9 : b.market_cap_rank
      return ra - rb
    })[0] || coins[0]
    const slug = best?.id || null
    if (slug) _cgSlugCache.set(symbol, { slug, ts: Date.now() })
    return slug
  } catch { return null }
}

// Fetch the coin profile, resolving cgId via search if not provided.
async function fetchCoinGeckoSmart(cgId, symbol, cgKey) {
  const id = cgId || await resolveCoinGeckoId(symbol, cgKey)
  if (!id) return null
  return fetchCoinGecko(id, cgKey)
}

// DefiLlama: try a few common slug variants (some protocols use -v3, -v2 suffixes)
async function fetchDefiLlama(symbol) {
  const slugs = [symbol.toLowerCase(), `${symbol.toLowerCase()}-v3`, `${symbol.toLowerCase()}-v2`]
  for (const slug of slugs) {
    try {
      const r = await fetchPublic(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`)
      if (r.status === 200 && r.json && r.json.name) return r.json
    } catch (_) { /* next */ }
  }
  return null
}

function fetchDexScreener(address) {
  if (!address) return Promise.resolve(null)
  const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`
  return fetchPublic(url).then(r => (r && r.status === 200 ? r.json : null)).catch(() => null)
}

// CoinPaprika: 25k req/month free tier. Cache slug map and coin payload aggressively.
const _cpSlugCache = new Map() // symbol -> { slug, ts } (24h TTL)
const _cpDataCache = new Map() // slug -> { data, ts } (1h TTL)
const CP_SLUG_TTL = 24 * 60 * 60 * 1000
const CP_DATA_TTL = 60 * 60 * 1000

async function _cpResolveSlug(symbol) {
  const cached = _cpSlugCache.get(symbol)
  if (cached && Date.now() - cached.ts < CP_SLUG_TTL) return cached.slug
  try {
    const r = await fetchPublic(`https://api.coinpaprika.com/v1/search/?q=${encodeURIComponent(symbol)}&c=currencies&limit=8`)
    if (r.status !== 200 || !r.json) return null
    const list = r.json.currencies || []
    // Prefer exact symbol match with highest rank
    const exact = list.filter(c => (c.symbol || '').toUpperCase() === symbol.toUpperCase())
    const best = exact.sort((a, b) => {
      const ra = (a.rank || 0) === 0 ? 99999 : a.rank
      const rb = (b.rank || 0) === 0 ? 99999 : b.rank
      return ra - rb
    })[0] || list[0]
    if (!best?.id) return null
    _cpSlugCache.set(symbol, { slug: best.id, ts: Date.now() })
    return best.id
  } catch {
    return null
  }
}

async function fetchCoinPaprika(symbol) {
  const slug = await _cpResolveSlug(symbol)
  if (!slug) return null
  const cached = _cpDataCache.get(slug)
  if (cached && Date.now() - cached.ts < CP_DATA_TTL) return cached.data
  try {
    const r = await fetchPublic(`https://api.coinpaprika.com/v1/coins/${encodeURIComponent(slug)}`)
    if (r.status !== 200 || !r.json) return null
    _cpDataCache.set(slug, { data: r.json, ts: Date.now() })
    return r.json
  } catch {
    return null
  }
}

// Blockscout — open-source EVM explorer family. No API key, free, covers
// Ethereum, Base, Arbitrum, Polygon, Optimism, Gnosis, zkSync, Scroll.
const BLOCKSCOUT_HOSTS = {
  1: 'eth.blockscout.com',
  10: 'optimism.blockscout.com',
  56: null, // BSC has no official Blockscout instance — skip
  100: 'gnosis.blockscout.com',
  137: 'polygon.blockscout.com',
  324: 'zksync.blockscout.com',
  8453: 'base.blockscout.com',
  42161: 'arbitrum.blockscout.com',
  534352: 'scroll.blockscout.com',
}

async function fetchBlockscout(address, networkId) {
  if (!address || !networkId) return null
  const host = BLOCKSCOUT_HOSTS[networkId]
  if (!host) return null
  try {
    const [tok, counters, holders] = await Promise.allSettled([
      fetchPublic(`https://${host}/api/v2/tokens/${address}`),
      fetchPublic(`https://${host}/api/v2/tokens/${address}/counters`),
      fetchPublic(`https://${host}/api/v2/tokens/${address}/holders`)
    ])
    const get = (s) => s.status === 'fulfilled' && s.value?.status === 200 ? s.value.json : null
    const tokData = get(tok)
    if (!tokData) return null
    const cnt = get(counters) || {}
    const hold = get(holders) || {}
    return {
      name: tokData.name || null,
      symbol: tokData.symbol || null,
      decimals: tokData.decimals != null ? Number(tokData.decimals) : null,
      type: tokData.type || null,
      totalSupply: tokData.total_supply || null,
      iconUrl: tokData.icon_url || null,
      exchangeRate: tokData.exchange_rate ? Number(tokData.exchange_rate) : null,
      volume24hUsd: tokData.volume_24h ? Number(tokData.volume_24h) : null,
      circulatingMarketCapUsd: tokData.circulating_market_cap ? Number(tokData.circulating_market_cap) : null,
      holdersCount: tokData.holders_count != null ? Number(tokData.holders_count) : (cnt.token_holders_count ? Number(cnt.token_holders_count) : null),
      transfersCount: cnt.transfers_count ? Number(cnt.transfers_count) : null,
      topHolders: Array.isArray(hold.items) ? hold.items.slice(0, 10).map(h => ({
        address: h.address?.hash || null,
        balance: h.value || null,
      })) : null,
      explorerHost: host,
    }
  } catch {
    return null
  }
}

// GitBook public spaces expose `/llms.txt` (markdown TOC for AI agents) and
// `/sitemap-pages.xml`. We parse llms.txt into a structured docs ToC.
function _parseGitBookLlms(text) {
  if (!text || typeof text !== 'string') return null
  const out = []
  const lines = text.split(/\r?\n/)
  let section = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // Heading like "## Section Name"
    const heading = line.match(/^##+\s+(.+)/)
    if (heading) {
      section = heading[1].trim()
      continue
    }
    // Bullet `- [Title](url): description`
    const m = line.match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?/)
    if (m) {
      out.push({
        section: section || null,
        title: m[1].trim(),
        url: m[2].trim(),
        description: (m[3] || '').trim() || null,
      })
    }
  }
  return out.length ? out : null
}

async function fetchGitBookToc(whitepaperUrl) {
  if (!whitepaperUrl || typeof whitepaperUrl !== 'string') return null
  if (!whitepaperUrl.includes('gitbook.io')) return null
  try {
    // Extract space root: https://xxx.gitbook.io/yyy/page → https://xxx.gitbook.io
    const u = new URL(whitepaperUrl)
    const llmsUrl = `${u.protocol}//${u.host}/llms.txt`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const r = await fetch(llmsUrl, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'spectre-research/dossier-proxy' } })
      if (!r.ok) return null
      const text = await r.text()
      return _parseGitBookLlms(text)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

function parseGithubRepo(url) {
  if (!url || typeof url !== 'string') return null
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/i)
  if (!m) return null
  const owner = m[1]
  const repo = m[2].replace(/\.git$/, '')
  if (!owner || !repo) return null
  return `${owner}/${repo}`
}

function fetchGithub(repoPath) {
  if (!repoPath) return Promise.resolve(null)
  return fetchPublic(`https://api.github.com/repos/${repoPath}`).then(r => (r && r.status === 200 ? r.json : null)).catch(() => null)
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

const firstTruthy = (...xs) => { for (const x of xs) { if (x !== null && x !== undefined && x !== '') return x } return null }
const firstArray = (...xs) => { for (const x of xs) { if (Array.isArray(x) && x.length) return x } return null }

function normalizePeople(input) {
  if (!Array.isArray(input) || !input.length) return null
  return input.map(p => (typeof p === 'string' ? { name: p } : p)).filter(p => p && p.name)
}

function normalizeRoadmap(input) {
  if (!Array.isArray(input) || !input.length) return null
  return input.map(r => {
    if (typeof r === 'string') return { milestone: r, status: null, date: null }
    return {
      milestone: r.milestone || r.title || r.name || null,
      status: r.status || null,
      date: r.date || r.timestamp || null,
    }
  }).filter(r => r.milestone)
}

function buildAudits(projectsData, defiLlamaData) {
  const audits = []
  // upstream project_intelligence audit_info shape varies
  if (projectsData?.audit_info) {
    const ai = projectsData.audit_info
    if (Array.isArray(ai)) ai.forEach(a => audits.push(typeof a === 'string' ? { auditor: a } : a))
    else if (typeof ai === 'string') audits.push({ auditor: ai })
    else audits.push(ai)
  }
  // DeFiLlama: audits is integer count, audit_links is array of URLs
  if (defiLlamaData?.audit_links && Array.isArray(defiLlamaData.audit_links)) {
    defiLlamaData.audit_links.forEach(url => {
      if (url && typeof url === 'string') audits.push({ auditor: 'DeFiLlama-listed', url })
    })
  }
  return audits.length ? audits : null
}

function buildSpectreTake(dossierFull, profilesData) {
  // Spectre Brain voice / thesis. Several possible field names from upstream.
  const voice = dossierFull?.brain_voice || dossierFull?.brainVoice || null
  // thesis can be { bull_case[], bear_case[] } or a string or { summary, thesis }
  const thesisRaw = dossierFull?.thesis
  const thesisSummary = typeof thesisRaw === 'string'
    ? thesisRaw
    : (thesisRaw?.summary || thesisRaw?.thesis || (Array.isArray(thesisRaw?.bull_case) && thesisRaw.bull_case[0]?.thesis) || null)
  const conviction = dossierFull?.conviction || null
  const text = firstTruthy(voice, thesisSummary, profilesData?.tagline)
  if (!text) return { take: null, takeAt: null, conviction: null }
  return {
    take: text,
    takeAt: dossierFull?.generated_at || dossierFull?.generatedAt || dossierFull?.last_brain_thought_at || dossierFull?.metadata?.generated_at || null,
    conviction,
  }
}

function buildHolderBreakdown(dossierFull) {
  const o = dossierFull?.onchain
  if (!o || typeof o !== 'object') return null
  const out = {}
  if (Number.isFinite(o.holders_top10_pct)) out.top10Pct = o.holders_top10_pct
  if (Number.isFinite(o.holders_top100_pct)) out.top100Pct = o.holders_top100_pct
  if (Number.isFinite(o.fresh_wallets_24h)) out.freshWallets24h = o.fresh_wallets_24h
  if (Number.isFinite(o.smart_money_net_flow_7d)) out.smartMoneyNetFlow7d = o.smart_money_net_flow_7d
  if (Number.isFinite(o.exchange_inflow_24h)) out.exchangeInflow24h = o.exchange_inflow_24h
  if (Number.isFinite(o.exchange_outflow_24h)) out.exchangeOutflow24h = o.exchange_outflow_24h
  if (Number.isFinite(o.exchange_net_flow_24h)) out.exchangeNetFlow24h = o.exchange_net_flow_24h
  return Object.keys(out).length ? out : null
}

function normalizeSignals(input) {
  if (!Array.isArray(input) || !input.length) return null
  return input.map(s => {
    if (typeof s === 'string') return { headline: s }
    return {
      headline: s.headline || s.title || s.text || s.message || null,
      kind: s.kind || s.type || s.category || null,
      severity: s.severity || s.priority || null,
      ts: s.ts || s.timestamp || s.created_at || null,
      url: s.url || s.link || null,
      source: s.source || null,
    }
  }).filter(s => s.headline).slice(0, 12)
}

function buildRiskComposite(dossierFull, projectsData) {
  // /v1/dossier returns risk_flags array of { flag, severity, evidence }
  const flags = Array.isArray(dossierFull?.risk_flags) ? dossierFull.risk_flags : []
  if (!flags.length) return null
  const sev = { high: 3, med: 2, low: 1 }
  const total = flags.reduce((acc, f) => acc + (sev[f?.severity] || 1), 0)
  // Normalize to 0..100 for UI gauge - higher is worse.
  const score = Math.min(100, total * 12)
  return {
    score,
    band: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low',
    flags: flags.slice(0, 10),
    sourcesUsed: ['dossier:risk_flags'],
  }
}

function buildBlogActivity(websiteIntelData) {
  const w = websiteIntelData?.data || websiteIntelData
  if (!w) return null
  const items = []
  if (w.latest_blog) items.push({ kind: 'blog', ...w.latest_blog })
  if (w.latest_changelog) items.push({ kind: 'changelog', ...w.latest_changelog })
  return items.length ? items : null
}

function buildTvl(defiLlamaData) {
  if (!defiLlamaData?.currentChainTvls) return null
  const chains = Object.entries(defiLlamaData.currentChainTvls)
    .filter(([k]) => !k.includes('-borrowed'))
    .map(([chain, tvl]) => ({ chain, tvl: Number(tvl) || 0 }))
    .sort((a, b) => b.tvl - a.tvl)
  if (!chains.length) return null
  const total = chains.reduce((a, c) => a + c.tvl, 0)
  return { total, byChain: chains.slice(0, 10), category: defiLlamaData.category || null }
}

function buildDexPairs(dexData, address) {
  if (!dexData?.pairs || !Array.isArray(dexData.pairs)) return null
  const pairs = dexData.pairs
    .filter(p => p && p.chainId && p.dexId)
    .filter(p => !address || (p.baseToken?.address || '').toLowerCase() === address.toLowerCase() || (p.quoteToken?.address || '').toLowerCase() === address.toLowerCase())
    .map(p => ({
      chain: p.chainId,
      dex: p.dexId,
      url: p.url || null,
      pairAddress: p.pairAddress,
      base: p.baseToken?.symbol,
      quote: p.quoteToken?.symbol,
      priceUsd: parseFloat(p.priceUsd) || null,
      liquidityUsd: p.liquidity?.usd || null,
      volume24h: p.volume?.h24 || null,
      pairCreatedAt: p.pairCreatedAt || null,
    }))
    .sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0))
  return pairs.length ? pairs.slice(0, 12) : null
}

// Count how many of the 16 source chips in rz-project-cinema lit up. The
// remaining 4 chips (Spectre Score, Sentiment, Derivatives, Fundraising) are
// driven by spectreData hook on the consumer side.
function _countSourcesFromTranslated(t) {
  const u = t.sourcesUsed || {}
  // Match the 16 boolean chips in rz-project-cinema (the other 4 come from
  // spectreData hook on the consumer side: spectreScore, sentiment, derivatives, fundraising).
  let n = 0
  if (u.coinpaprika) n++
  if (u.coingecko) n++
  if (u.defillama) n++
  if (u.messari) n++
  if (u.github) n++
  if (u.gitbook) n++
  if (u.discord) n++
  if (u.telegram) n++
  if (u.reddit) n++
  if (u.snapshot) n++
  if (u.explorer) n++
  if (u.rugcheck) n++
  if (u.lunarcrush) n++
  if (u.cryptopanic) n++
  if (u.hacks) n++
  if (u.holderBreakdown) n++
  return n
}

// ── Main translate / merge ────────────────────────────────────────────────────

function unwrap(p, key = 'data') {
  if (!p || typeof p !== 'object') return null
  if (key && Object.prototype.hasOwnProperty.call(p, key)) return p[key]
  return p
}

function translate({ symbol, address, projects, profiles, dossier, brainFull, assetProfile, signals, websiteIntel, cg, defiLlama, dex, github, coinPaprika, blockscout, gitbookToc }) {
  const projectsData = unwrap(projects)
  const profilesData = unwrap(profiles)
  const dossierFull = dossier // already top-level keys
  const brainFullData = brainFull
  const assetProfileData = assetProfile
  const signalsData = unwrap(signals)
  const websiteIntelData = unwrap(websiteIntel)

  // Tagline: profile.overview is the CURATED 1-2 sentence summary that
  // `/v1/profiles/:sym` returns (e.g. "SPECTRE is the native token of an
  // innovative AI-powered predictive learning tool..."). Prefer it over
  // the auto-generated `tagline` field which is just "{Name} ({Symbol})".
  const cgFirstSentence = (() => {
    const desc = cg?.description?.en
    if (!desc || typeof desc !== 'string') return null
    const m = desc.replace(/\s+/g, ' ').trim().match(/^(.+?[.!?])(\s|$)/)
    return m ? m[1] : desc.slice(0, 200)
  })()
  const tagline = firstTruthy(
    profilesData?.profile?.overview,
    cgFirstSentence,
    projectsData?.description_extracted,
    coinPaprika?.description?.split('. ').slice(0, 1).join('. '),
    profilesData?.tagline,
    profilesData?.profile?.tagline,
  )

  // Team: projects > coinpaprika > website-crawl. CoinPaprika has rich team
  // arrays for many top-200 tokens with name+position fields.
  const cpTeam = (() => {
    const t = coinPaprika?.team
    if (!Array.isArray(t) || !t.length) return null
    return t.map(m => ({ name: m.name || null, role: m.position || m.role || null })).filter(m => m.name)
  })()
  const team = normalizePeople(
    firstArray(projectsData?.team, cpTeam, websiteIntelData?.team)
  )

  // Partners: projects.partnerships only for now
  const partners = normalizePeople(projectsData?.partnerships)

  // Investors: vc_history from /v1/brain/dossier/full > vc_backers (projects) > funding_rounds
  const investors = (() => {
    const list = []
    if (Array.isArray(brainFullData?.vc_history)) {
      brainFullData.vc_history.forEach(r => {
        if (Array.isArray(r?.lead_investors)) list.push(...r.lead_investors)
      })
    }
    if (Array.isArray(projectsData?.vc_backers)) list.push(...projectsData.vc_backers)
    if (Array.isArray(projectsData?.funding_rounds)) {
      projectsData.funding_rounds.forEach(r => {
        if (Array.isArray(r?.investors)) list.push(...r.investors)
      })
    }
    // dedupe by name
    const seen = new Set()
    const dedup = []
    list.forEach(x => {
      const name = typeof x === 'string' ? x : x?.name
      if (!name || seen.has(name.toLowerCase())) return
      seen.add(name.toLowerCase())
      dedup.push(x)
    })
    return normalizePeople(dedup)
  })()

  // Funding rounds: brainFull vc_history (richest) > assetProfile.funding.rounds > projects
  const fundingRounds = (() => {
    if (Array.isArray(brainFullData?.vc_history) && brainFullData.vc_history.length) {
      return brainFullData.vc_history.map(r => ({
        date: r.date, roundType: r.round_type, amountUsd: r.amount_raised_usd,
        leadInvestors: r.lead_investors || [], project: r.project_name,
      }))
    }
    if (Array.isArray(assetProfileData?.funding?.rounds) && assetProfileData.funding.rounds.length) {
      return assetProfileData.funding.rounds.map(r => ({
        date: r.date, roundType: r.stage, amountUsd: Number(r.amount) || null,
        valuationUsd: Number(r.valuation) || null, leadInvestors: r.investors || [],
      }))
    }
    return Array.isArray(projectsData?.funding_rounds) ? projectsData.funding_rounds : null
  })()

  // Roadmap: projects > website-crawl
  const roadmap = normalizeRoadmap(firstArray(projectsData?.roadmap, websiteIntelData?.roadmap))

  // Whitepaper: projects > coinpaprika > profile links. CoinPaprika also provides
  // a thumbnail image we can show as a preview.
  const whitepaperUrl = firstTruthy(
    projectsData?.whitepaper_url,
    coinPaprika?.whitepaper?.link,
    profilesData?.links?.whitepaper,
  )
  const whitepaperThumb = coinPaprika?.whitepaper?.thumbnail || null

  // Tags / categories: combined (profiles + DefiLlama + CG + brain narratives + CoinPaprika)
  const tags = (() => {
    const out = new Set()
    if (Array.isArray(profilesData?.categories)) profilesData.categories.forEach(c => c && out.add(String(c)))
    if (defiLlama?.category) out.add(defiLlama.category)
    if (Array.isArray(cg?.categories)) cg.categories.slice(0, 8).forEach(c => c && out.add(String(c)))
    if (Array.isArray(brainFullData?.narratives)) brainFullData.narratives.forEach(n => n?.name && out.add(n.name))
    if (Array.isArray(coinPaprika?.tags)) coinPaprika.tags.forEach(t => {
      const name = typeof t === 'string' ? t : t?.name
      if (name) out.add(name)
    })
    return out.size ? [...out].slice(0, 16) : null
  })()

  // Hacks: brainFull.recent_hacks
  const hacks = (() => {
    const list = Array.isArray(brainFullData?.recent_hacks) ? brainFullData.recent_hacks : []
    if (!list.length) return null
    return list.slice(0, 6).map(h => ({
      name: h.name || h.title || h.protocol || 'Incident',
      date: h.date || h.timestamp || null,
      amount: h.amount_lost_usd || h.amount_usd || h.amount || null,
      source: h.source || null,
      url: h.url || h.link || null,
    }))
  })()

  // Catalysts: brainFull.upcoming_unlocks + dossier.catalysts + active_governance
  const catalystsCombined = (() => {
    const list = []
    if (Array.isArray(dossierFull?.catalysts)) list.push(...dossierFull.catalysts)
    if (Array.isArray(brainFullData?.upcoming_unlocks)) {
      brainFullData.upcoming_unlocks.slice(0, 5).forEach(u => list.push({
        headline: `Token unlock: ${u.unlock_date || u.date || 'TBD'}`,
        kind: 'unlock', amountUsd: u.amount_unlocked_usd || u.value_usd || null,
        date: u.unlock_date || u.date || null,
      }))
    }
    if (Array.isArray(brainFullData?.active_governance)) {
      brainFullData.active_governance.slice(0, 5).forEach(g => list.push({
        headline: g.title || 'Governance proposal',
        kind: 'governance', state: g.state || null,
        date: g.end_time || g.start_time || null,
        url: g.url || null,
      }))
    }
    return list.length ? list.slice(0, 8).map(c => (typeof c === 'string' ? { headline: c } : c)) : null
  })()

  // Audits: project audit_info + DeFiLlama audit_links
  const audits = buildAudits(projectsData, defiLlama)

  // Spectre Take + risk (from /v1/dossier)
  const brainTake = buildSpectreTake(dossierFull, profilesData)
  const riskComposite = buildRiskComposite(dossierFull, projectsData)
  const catalysts = catalystsCombined

  // Activity feed: blog + changelog from website intel + signals
  const blog = buildBlogActivity(websiteIntelData)
  const signalsList = normalizeSignals(signalsData)
  const holderBreakdown = (() => {
    const fromDossier = buildHolderBreakdown(dossierFull)
    const whales = assetProfileData?.whales
    if (!whales || typeof whales !== 'object') return fromDossier
    const merged = { ...(fromDossier || {}) }
    if (Number.isFinite(whales.smart_money_24h)) merged.smartMoney24h = whales.smart_money_24h
    if (Number.isFinite(whales.whale_count)) merged.whaleCount = whales.whale_count
    if (Number.isFinite(whales.whales_buying_pct)) merged.whalesBuyingPct = whales.whales_buying_pct
    return Object.keys(merged).length ? merged : null
  })()
  const spectreScore = profilesData?.scores?.spectre_score ?? brainFullData?.spectre_score?.spectre_score ?? null
  const spectreScoreDetail = brainFullData?.spectre_score || null
  const launchDate = profilesData?.details?.launch_date || null
  const treasury = (() => {
    const list = Array.isArray(brainFullData?.treasury_holdings) ? brainFullData.treasury_holdings : []
    if (!list.length) return null
    return list.map(t => ({
      entity: t.entity_name, type: t.entity_type,
      valueUsd: t.total_current_value_usd || null, holdings: t.total_holdings || null,
    }))
  })()
  const governance = (() => {
    const list = Array.isArray(brainFullData?.active_governance) ? brainFullData.active_governance : []
    if (!list.length) return null
    return list.slice(0, 6).map(g => ({
      title: g.title, protocol: g.protocol, state: g.state,
      endTime: g.end_time, startTime: g.start_time, url: g.url || null,
    }))
  })()
  const narratives = (() => {
    const list = Array.isArray(brainFullData?.narratives) ? brainFullData.narratives : (assetProfileData?.narratives || [])
    if (!list || !list.length) return null
    return list.slice(0, 8).map(n => ({ name: n.name, slug: n.slug, weight: parseFloat(n.weight) || null }))
  })()
  const developer = assetProfileData?.developer || null
  const community = assetProfileData?.community || null
  const socialStats = (() => {
    // Two upstream sources for follower counts: assetProfile.social
    // (often zeros) and assetProfile.community (often the real numbers).
    // We merge max of each.
    const s1 = assetProfileData?.social || {}
    const s2 = assetProfileData?.community || {}
    const merged = {}
    const fields = ['twitterFollowers', 'telegramMembers', 'redditSubscribers', 'mentionsTotal', 'sentiment', 'mindshare']
    for (const f of fields) {
      const v = Math.max(Number(s1[f]) || 0, Number(s2[f]) || 0)
      if (v > 0) merged[f] = v
    }
    return Object.keys(merged).length ? merged : null
  })()
  const fundingTotal = (() => {
    const fr = assetProfileData?.funding
    if (!fr || typeof fr !== 'object') return null
    const total = Number(fr.totalRaised) || 0
    if (total > 0) return total
    // Sum from rounds array if totalRaised is missing
    if (Array.isArray(fr.rounds)) {
      const sum = fr.rounds.reduce((a, r) => a + (Number(r.amount) || 0), 0)
      return sum > 0 ? sum : null
    }
    return null
  })()
  const contracts = (() => {
    // Merge multi-chain contracts from every available source. Sources differ
    // per asset: Spectre profiles only has Solana for ZIG, but CoinGecko
    // detail_platforms returns all 5 chains, and CoinPaprika.contracts has
    // Cosmos/Injective wrappers others miss.
    const seen = new Set()
    const out = []
    const push = (chain, address) => {
      if (typeof address !== 'string') return
      const a = address.trim()
      if (!a || a.length < 20) return
      const key = `${String(chain || '').toLowerCase()}:${a.toLowerCase()}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ chain: chain || 'unknown', address: a })
    }
    const platforms = profilesData?.details?.platforms
    if (platforms && typeof platforms === 'object') {
      for (const [chain, addr] of Object.entries(platforms)) push(chain, addr)
    }
    if (cg?.detail_platforms && typeof cg.detail_platforms === 'object') {
      for (const [chain, info] of Object.entries(cg.detail_platforms)) {
        if (!chain) continue
        const addr = typeof info === 'string' ? info : info?.contract_address
        push(chain, addr)
      }
    }
    if (cg?.platforms && typeof cg.platforms === 'object') {
      for (const [chain, addr] of Object.entries(cg.platforms)) push(chain, addr)
    }
    if (Array.isArray(coinPaprika?.contracts)) {
      coinPaprika.contracts.forEach(c => push(c?.platform, c?.contract))
    }
    if (!out.length) {
      const single = profilesData?.details?.contract_address || coinPaprika?.contract
      if (single) push(profilesData?.details?.chain || coinPaprika?.platform || 'unknown', single)
    }
    return out.length ? out : null
  })()
  const maxSupply = profilesData?.details?.max_supply ?? null

  // On-chain (Blockscout) — holders, transfers, top holders, contract meta
  const onchainExplorer = blockscout ? {
    holdersCount: blockscout.holdersCount,
    transfersCount: blockscout.transfersCount,
    topHolders: blockscout.topHolders,
    contractMeta: {
      name: blockscout.name, symbol: blockscout.symbol, decimals: blockscout.decimals,
      type: blockscout.type, totalSupply: blockscout.totalSupply, iconUrl: blockscout.iconUrl,
    },
    explorerHost: blockscout.explorerHost,
  } : null

  // Docs ToC from GitBook llms.txt — structured documentation tree
  const docsTocFinal = Array.isArray(gitbookToc) && gitbookToc.length ? gitbookToc.slice(0, 20) : null

  // TVL + DEX pairs
  const tvl = buildTvl(defiLlama)
  const dexPairs = buildDexPairs(dex, address)

  // GitHub: prefer live API > project-intelligence stale fields
  const githubUrl = firstTruthy(
    projectsData?.github_url,
    cg?.links?.repos_url?.github?.[0],
    profilesData?.links?.github,
  )
  const githubData = github ? {
    url: githubUrl || (github.html_url || null),
    stars: github.stargazers_count ?? null,
    forks: github.forks_count ?? null,
    lastCommit: github.pushed_at ?? null,
    contributors: null,
    openIssues: github.open_issues_count ?? null,
  } : (githubUrl ? {
    url: githubUrl,
    stars: projectsData?.github_stars ?? null,
    forks: projectsData?.github_forks ?? null,
    lastCommit: projectsData?.github_last_commit ?? null,
    contributors: projectsData?.github_contributors ?? null,
    openIssues: null,
  } : null)

  // Social links: profiles + coingecko
  const socialLinks = (() => {
    const out = {}
    const pl = profilesData?.links || {}
    out.website = firstTruthy(pl.website, pl.homepage, projectsData?.website, cg?.links?.homepage?.[0])
    out.twitter = firstTruthy(pl.twitter, cg?.links?.twitter_screen_name && `https://x.com/${cg.links.twitter_screen_name}`)
    out.telegram = firstTruthy(pl.telegram, cg?.links?.telegram_channel_identifier && `https://telegram.me/${cg.links.telegram_channel_identifier}`)
    out.discord = firstTruthy(pl.discord, cg?.links?.chat_url?.find(u => /discord/i.test(u)))
    out.reddit = firstTruthy(pl.reddit, cg?.links?.subreddit_url)
    out.github = firstTruthy(pl.github, githubUrl)
    out.medium = firstTruthy(pl.medium)
    out.dune = firstTruthy(pl.dune, projectsData?.dune_dashboard_url)
    Object.keys(out).forEach(k => { if (!out[k]) delete out[k] })
    return Object.keys(out).length ? out : null
  })()


  // Source provenance — BOOLEAN keys matching the trust-score chip strip in
  // rz-project-cinema.jsx. Each chip lights green if its source contributed.
  const sourcesUsed = {
    coinpaprika: !!(coinPaprika?.id),
    coingecko: !!(cg?.id || cg?.description?.en),
    defillama: !!defiLlama?.name,
    messari: false, // not yet wired
    github: !!(github?.stargazers_count != null || projectsData?.github_url),
    gitbook: !!(docsTocFinal && docsTocFinal.length) || !!(websiteIntelData?.pages_by_type?.docs || websiteIntelData?.pages_by_type?.gitbook),
    discord: !!(socialLinks?.discord),
    telegram: !!(socialLinks?.telegram),
    reddit: !!(socialLinks?.reddit),
    snapshot: !!(governance && governance.length),
    explorer: !!(onchainExplorer && onchainExplorer.holdersCount != null) || !!address,
    rugcheck: !!(riskComposite),
    lunarcrush: !!(community || assetProfileData?.community),
    cryptopanic: !!(catalysts && catalysts.length) || !!(websiteIntelData?.latest_blog),
    hacks: !!(hacks && hacks.length),
    holderBreakdown: !!holderBreakdown,
    // Extra refs (non-trust strip)
    websiteUrl: socialLinks?.website || null,
    githubUrl,
    whitepaperUrl,
    duneDashboard: projectsData?.dune_dashboard_url || null,
    crawledAt: projectsData?.crawled_at || null,
    llamaName: defiLlama?.name || null,
    intelAsOf: websiteIntelData?.as_of || null,
  }

  // Description / longform - prefer coingecko, then coinpaprika, then profiles
  const description = firstTruthy(
    cg?.description?.en,
    coinPaprika?.description,
    profilesData?.profile?.description,
    profilesData?.profile?.summary,
    projectsData?.description_extracted,
  )

  // Launch date: profiles > coinpaprika.started_at > brainFull.core
  const finalLaunchDate = firstTruthy(
    profilesData?.details?.launch_date,
    coinPaprika?.started_at,
    brainFullData?.core?.genesis_date,
  )

  const out = {
    asset: symbol,
    tagline,
    description,
    tags,
    team,
    partners,
    investors,
    roadmap,
    whitepaperUrl,
    whitepaperThumb,
    docsToc: docsTocFinal,
    audits,
    hacks,
    holderBreakdown,
    newsFeed: blog,
    governance,
    narratives,
    treasury,
    spectreScoreDetail,
    developer,
    community,
    socialStats,
    fundingTotal,
    contracts,
    maxSupply,
    onchainExplorer,
    riskComposite,
    opportunityScore: null,
    spectreScore,
    launchDate: finalLaunchDate,
    spectreTake: brainTake.take,
    spectreTakeAt: brainTake.takeAt,
    conviction: brainTake.conviction,
    catalysts,
    signals: signalsList,
    tvl,
    dexPairs,
    socialLinks,
    fundingRounds,
    github: githubData,
    tokenomics: projectsData?.tokenomics || null,
    duneDashboard: projectsData?.dune_dashboard_url || null,
    keyFeatures: Array.isArray(projectsData?.key_features) ? projectsData.key_features : null,
    crawledAt: projectsData?.crawled_at || null,
    sourcesUsed,
    trustScore: 0,
    trustTotal: 20,
  }
  out.trustScore = _countSourcesFromTranslated(out)
  return out
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const symbolRaw = (req.query?.symbol || '').toString().trim()
  const symbol = symbolRaw.toUpperCase()
  if (!symbol || !/^[A-Z0-9]{1,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbol param required (1-20 alphanumeric)' })
  }

  const apiKey = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'SPECTRE_DATA_API_KEY not configured' })
  const cgKey = process.env.COINGECKO_API_KEY || ''

  const address = (req.query?.address || '').toString().trim() || null
  const networkId = req.query?.networkId ? Number(req.query.networkId) : null
  const cgId = (req.query?.cgId || '').toString().trim() || null
  const githubUrlHint = (req.query?.githubUrl || '').toString().trim() || null

  const cacheKey = `proj:${symbol}:${address || ''}:${networkId || ''}:${cgId || ''}`
  const refresh = req.query?.refresh === '1'
  if (!refresh) {
    const cached = getCached(cacheKey)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      res.setHeader('X-Cache', 'HIT')
      return res.status(200).json(cached)
    }
  }

  // Phase 1 — parallel fan-out (12 upstreams)
  const safeSpectre = (path) => fetchSpectre(path, apiKey).catch(() => null)
  const [projectsRes, profilesRes, dossierRes, brainFullRes, assetProfileRes, signalsRes, websiteRes, cgRes, defiRes, dexRes, cpRes, blockscoutRes] = await Promise.allSettled([
    safeSpectre(`/v1/intelligence/projects/${encodeURIComponent(symbol)}`),
    safeSpectre(`/v1/profiles/${encodeURIComponent(symbol)}`),
    safeSpectre(`/v1/dossier/${encodeURIComponent(symbol)}`),
    safeSpectre(`/v1/brain/dossier/${encodeURIComponent(symbol)}/full`),
    safeSpectre(`/v1/asset/${encodeURIComponent(symbol)}/profile`),
    safeSpectre(`/v1/intelligence/signals/${encodeURIComponent(symbol)}`),
    safeSpectre(`/v1/token-intel/website/${encodeURIComponent(symbol)}`),
    fetchCoinGeckoSmart(cgId, symbol, cgKey),
    fetchDefiLlama(symbol),
    fetchDexScreener(address),
    fetchCoinPaprika(symbol),
    fetchBlockscout(address, networkId)
  ])

  const get = (settled) => settled?.status === 'fulfilled' ? settled.value : null
  const okResp = (r) => (r && r.status >= 200 && r.status < 300 ? r.json : null)

  const projects = okResp(get(projectsRes))?.data || null
  const profiles = okResp(get(profilesRes))?.data || null
  const dossier = okResp(get(dossierRes)) || null            // /v1/dossier returns top-level fields, no .data wrap
  const brainFull = okResp(get(brainFullRes))?.data || null  // vc_history, hacks, unlocks, narratives
  const assetProfile = okResp(get(assetProfileRes))?.data || null
  const signals = okResp(get(signalsRes))?.data || null
  const websiteIntel = okResp(get(websiteRes)) || null
  const cg = get(cgRes)
  const defiLlama = get(defiRes)
  const dex = get(dexRes)
  const coinPaprika = get(cpRes)
  const blockscout = get(blockscoutRes)

  // Phase 2 — derive github_url + whitepaperUrl from any phase-1 source, then
  // fan-out github + gitbook in parallel.
  const githubUrl = githubUrlHint
    || projects?.github_url
    || cg?.links?.repos_url?.github?.[0]
    || profiles?.links?.github
    || null
  const repoPath = parseGithubRepo(githubUrl)
  const whitepaperUrlHint = projects?.github_url ? null : (
    projects?.whitepaper_url || coinPaprika?.whitepaper?.link || profiles?.links?.whitepaper || null
  )
  // Crawled-intelligence lane (2026-08-25): the project's OWN site/docs read +
  // its OWN X tape. Identity for the crawl comes from the same phase-1 sources
  // the rest of the dossier trusts.
  const intelWebsite = profiles?.links?.website || profiles?.links?.homepage || projects?.website
    || (Array.isArray(cg?.links?.homepage) ? cg.links.homepage.find(Boolean) : null) || null
  const intelDocs = projects?.whitepaper_url || coinPaprika?.whitepaper?.link || profiles?.links?.whitepaper || null
  const intelHandle = cg?.links?.twitter_screen_name || profiles?.links?.twitter || null

  const [github, gitbookToc, projectIntel] = await Promise.allSettled([
    repoPath ? fetchGithub(repoPath) : Promise.resolve(null),
    fetchGitBookToc(whitepaperUrlHint),
    fetchProjectIntel({ cgId, website: intelWebsite, docs: intelDocs, xHandle: intelHandle })
  ]).then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null))

  const data = translate({ symbol, address, projects, profiles, dossier, brainFull, assetProfile, signals, websiteIntel, cg, defiLlama, dex, github, coinPaprika, blockscout, gitbookToc })
  if (projectIntel?.siteIntel) data.siteIntel = projectIntel.siteIntel
  if (projectIntel?.teamTape) data.teamTape = projectIntel.teamTape

  const payload = { data, status: 'ok', symbol }
  setCache(cacheKey, payload)
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  res.setHeader('X-Cache', 'MISS')
  return res.status(200).json(payload)
}
