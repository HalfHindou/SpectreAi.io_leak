/**
 * Grounded web search — first-party first, vendors as fallback.
 *
 * WHY THIS EXISTS
 * Every LLM surface in the app needed "what actually happened" context, and
 * each one reached straight for Tavily. That is a paid third party sitting in
 * the hot path of our own product, holding data we already collect: the box
 * ingests ~8k news articles a month, a macro wire, and our own desk research.
 * So we search OURS first (/v1/news/search, first-party, no marginal cost, and
 * a sellable endpoint of the Spectre API), and only pay a vendor when our
 * corpus genuinely cannot answer — an open-web question about a person, a
 * protocol doc, a claim on a website we do not ingest.
 *
 * LADDER — first provider that clears the bar wins:
 *   1. spectre  — our corpus. Short-circuits at >= minResults hits.
 *   2. tavily   — TAVILY_API_KEY
 *   3. brave    — BRAVE_SEARCH_API_KEY (independent index; not Google-derived)
 *   4. serpapi  — SERPAPI_KEY
 *
 * Every provider degrades to [] instead of throwing: a search outage must
 * never take down the chat that called it. If all of them fail we return the
 * best partial we saw with degraded:true, so a caller can say "no web context"
 * honestly instead of inventing one.
 */

const SPECTRE_API_BASE = (process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850').trim().replace(/\/+$/, '')
const SPECTRE_API_KEY = (process.env.SPECTRE_API_KEY || '').trim()
const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || '').trim()
const BRAVE_API_KEY = (process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || '').trim()
const SERPAPI_KEY = (process.env.SERPAPI_KEY || process.env.SERP_API_KEY || '').trim()

const TIMEOUT_MS = 8000

function log(...args) { console.log('[websearch]', ...args) }

async function jsonFetch(url, init, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/* ── 1. Spectre first-party corpus ─────────────────────────────────────────
 * news_articles + the macro wire + our published desk research, ranked by
 * relevance x recency. `window` defaults wide because a catalyst question can
 * reach back a few weeks ("why has ETH lagged since the ETF decision"). */
async function searchSpectre(query, { limit = 5, window = '30d', assets = null, lanes = null } = {}) {
  if (!SPECTRE_API_KEY) return []
  const qs = new URLSearchParams({ q: query, limit: String(limit), window })
  if (assets && assets.length) qs.set('assets', assets.join(','))
  if (lanes && lanes.length) qs.set('lanes', lanes.join(','))
  const json = await jsonFetch(`${SPECTRE_API_BASE}/v1/news/search?${qs}`, {
    headers: { Accept: 'application/json', 'X-API-Key': SPECTRE_API_KEY },
  })
  const rows = json?.data?.results
  if (!Array.isArray(rows)) return []
  const out = rows.map((r) => ({
    title: r.title || '',
    url: r.url || null,
    content: (r.content || '').slice(0, 500),
    source: r.source || null,
    publishedAt: r.publishedAt || null,
    lane: r.lane || null,
  }))
  // WEAK means: nothing in our corpus matched every term, so the endpoint fell
  // back to its broad pass. The rows are still the best WE have, but they are
  // loose — "what did X say about Y" returns four on-topic-ish headlines that
  // do not answer the question. Full-count-but-weak must not short-circuit the
  // ladder, or we would never reach a vendor for a genuinely open-web question.
  const passes = json?.meta?.passes
  out.weak = Array.isArray(passes) && passes.includes('broad')
  return out
}

/* ── 2. Tavily ─────────────────────────────────────────────────────────── */
async function searchTavily(query, { limit = 5 } = {}) {
  if (!TAVILY_API_KEY) return []
  const json = await jsonFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: limit, search_depth: 'basic', include_answer: false }),
  })
  const rows = Array.isArray(json?.results) ? json.results : []
  return rows.map((r) => ({
    title: r.title || '',
    url: r.url || null,
    content: (r.content || '').slice(0, 500),
    source: r.url ? safeHost(r.url) : null,
    publishedAt: r.published_date || null,
    lane: 'web',
  }))
}

/* ── 3. Brave ──────────────────────────────────────────────────────────── */
async function searchBrave(query, { limit = 5 } = {}) {
  if (!BRAVE_API_KEY) return []
  const qs = new URLSearchParams({ q: query, count: String(Math.min(limit, 20)) })
  const json = await jsonFetch(`https://api.search.brave.com/res/v1/web/search?${qs}`, {
    headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_API_KEY },
  })
  const rows = Array.isArray(json?.web?.results) ? json.web.results : []
  return rows.slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.url || null,
    content: stripTags(r.description || '').slice(0, 500),
    source: r.profile?.name || (r.url ? safeHost(r.url) : null),
    publishedAt: r.age || null,
    lane: 'web',
  }))
}

/* ── 4. SerpAPI ────────────────────────────────────────────────────────── */
async function searchSerp(query, { limit = 5 } = {}) {
  if (!SERPAPI_KEY) return []
  const qs = new URLSearchParams({ q: query, api_key: SERPAPI_KEY })
  const json = await jsonFetch(`https://serpapi.com/search.json?${qs}`)
  const rows = Array.isArray(json?.organic_results) ? json.organic_results : []
  return rows.slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.link || null,
    content: (r.snippet || '').slice(0, 500),
    source: r.source || (r.link ? safeHost(r.link) : null),
    publishedAt: r.date || null,
    lane: 'web',
  }))
}

function safeHost(u) { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }
function stripTags(s) { return String(s).replace(/<[^>]+>/g, '') }

const PROVIDERS = [
  { name: 'spectre', fn: searchSpectre, enabled: () => !!SPECTRE_API_KEY },
  { name: 'tavily', fn: searchTavily, enabled: () => !!TAVILY_API_KEY },
  { name: 'brave', fn: searchBrave, enabled: () => !!BRAVE_API_KEY },
  { name: 'serpapi', fn: searchSerp, enabled: () => !!SERPAPI_KEY },
]

/**
 * @param {string} query
 * @param {object} opts
 *   limit       — results wanted (default 5)
 *   minResults  — how many hits count as "answered"; below this we keep
 *                 descending the ladder (default 3)
 *   firstParty  — 'only' to never touch a vendor, 'skip' to go straight to the
 *                 web (an open-web question our corpus cannot hold)
 *   window/assets/lanes — passed to the Spectre corpus search
 * @returns {Promise<{provider:string|null, results:Array, degraded:boolean, tried:string[]}>}
 */
export async function webSearch(query, opts = {}) {
  const q = String(query || '').trim()
  if (!q) return { provider: null, results: [], degraded: true, tried: [] }

  const { minResults = 3, firstParty = 'auto' } = opts
  const tried = []
  let best = { provider: null, results: [] }

  for (const p of PROVIDERS) {
    if (firstParty === 'only' && p.name !== 'spectre') break
    if (firstParty === 'skip' && p.name === 'spectre') continue
    if (!p.enabled()) continue
    tried.push(p.name)
    try {
      const results = await p.fn(q, opts)
      if (results.length > best.results.length) best = { provider: p.name, results }
      if (results.length >= minResults && !results.weak) {
        log(`${p.name} answered "${q.slice(0, 60)}" with ${results.length}`)
        return { provider: p.name, results, degraded: false, tried }
      }
      if (results.weak) log(`${p.name} matched loosely (${results.length}) — trying the next provider`)
    } catch (err) {
      log(`${p.name} failed: ${err.message}`)
    }
  }

  if (best.results.length) {
    log(`partial from ${best.provider} (${best.results.length}) after ${tried.join(' -> ')}`)
    return { provider: best.provider, results: best.results, degraded: false, tried }
  }
  log(`no results for "${q.slice(0, 60)}" (tried ${tried.join(' -> ') || 'nothing — no keys configured'})`)
  return { provider: null, results: [], degraded: true, tried }
}

/** Convenience: the shape the old tavilySearch() callers expect. */
export async function searchForContext(query, opts = {}) {
  const { results } = await webSearch(query, opts)
  return results.length ? results : null
}

export { searchSpectre, searchTavily, searchBrave, searchSerp }
