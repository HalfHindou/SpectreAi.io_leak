/**
 * research-desk-intel.js — Research Desk AI content via the WORKING platform AI.
 *
 * The local LLM keys (Groq, Anthropic) are billing-dead, so instead of generating
 * thesis/pitch text locally we reuse the platform's own working AI infrastructure:
 * the Spectre Data API intelligence crawler on the Hetzner box (the same upstream
 * AI Dossier / token-intel uses, authed by SPECTRE_DATA_API_KEY).
 *
 *   POST {SPECTRE_DATA_ORIGIN}/v1/intelligence/projects/{symbol}/crawl
 *     -> { data: { website, roadmap[], tokenomics[{value,metric}], vc_backers[],
 *                  audit_info, key_features[], project_summary, github_url,
 *                  whitepaper_url, documentation_url, social_links, external_links,
 *                  partnerships, funding_rounds, ... }, meta }
 *
 * We map that REAL project intel into the AlphaThesisCards / TokenPitchDeck shapes
 * (the frontend's mergeAiThesis/mergeAiPitch overlay these over the data-derived
 * base). Everything is GRACEFUL + bounded: a missing key, a timeout, or an
 * uncovered token simply yields no entry for that symbol and the frontend keeps
 * its data-derived card. Zero dependency on the dead local LLMs.
 *
 * buildIntelContent(projects, opts) -> { theses: {[SYM]: {...}}, pitches: {[SYM]: {...}} }
 *
 * Mirrored byte-for-byte at apps/trading/api/_lib/research-desk-intel.cjs (no
 * require differences — this module has no local imports).
 */

const SPECTRE_DATA_ORIGIN = process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850'
const SPECTRE_DATA_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || ''

const INTEL_LIMIT = 12          // top-N projects (by compositeScore) to enrich
const INTEL_CONCURRENCY = 4     // parallel crawls
const INTEL_PER_REQ_MS = 28_000 // per-symbol crawl timeout (the crawl is slow cold, cached warm upstream)

const sym = (s) => String(s || '').replace(/^\$/, '').trim().toUpperCase()
const isStr = (v) => typeof v === 'string' && v.trim().length > 0
const cleanStr = (v) => (isStr(v) ? v.trim() : null)
const arr = (v) => (Array.isArray(v) ? v : [])

// ── Fetch one project's crawled intel. Never throws → returns data|null. ──
async function fetchIntel(symbol, hint = {}) {
  if (!SPECTRE_DATA_KEY) return null
  try {
    const res = await fetch(`${SPECTRE_DATA_ORIGIN}/v1/intelligence/projects/${encodeURIComponent(symbol)}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      body: JSON.stringify({
        website: cleanStr(hint.website) || '',
        name: cleanStr(hint.name) || '',
        github: cleanStr(hint.github) || '',
        coingeckoId: cleanStr(hint.coingeckoId) || '',
      }),
      signal: AbortSignal.timeout(INTEL_PER_REQ_MS),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    const data = json && json.data
    return data && typeof data === 'object' ? data : null
  } catch (_) { return null }
}

// ── Map intel.tokenomics [{value, metric}] -> pitch tokenomics fields. ──
function mapTokenomics(tk) {
  const rows = arr(tk).filter((r) => r && (isStr(r.value) || isStr(r.metric)))
  if (!rows.length) return null
  const out = {}
  const extra = []
  for (const r of rows) {
    const metric = (r.metric || '').toLowerCase()
    const value = cleanStr(r.value)
    if (!value) continue
    if (/total supply|max supply|circulating/.test(metric)) out.supply = value
    else if (/inflation|emission/.test(metric)) out.inflation = value
    else if (/lock|stake/.test(metric)) out.staked = value
    else if (/holder|concentration|whale|top ?10/.test(metric)) out.topHolders = value
    else extra.push(`${r.metric}: ${value}`)
  }
  if (extra.length) out.vestingNote = extra.slice(0, 3).join(' · ')
  return Object.keys(out).length ? out : null
}

// ── Pull audit firm names from a free-form audit_info field/array. ──
function mapAudits(auditInfo) {
  if (Array.isArray(auditInfo)) {
    const names = auditInfo.map((a) => (isStr(a) ? a : (a && (a.firm || a.name || a.auditor)))).filter(isStr)
    return names.length ? [...new Set(names)].slice(0, 5) : null
  }
  if (isStr(auditInfo)) {
    const known = ['Trail of Bits', 'OpenZeppelin', 'Certora', 'Certik', 'Halborn', 'Quantstamp', 'Spearbit', 'Sigma Prime', 'SigmaPrime', 'Cyfrin', 'PeckShield', 'Hacken', 'Zellic', 'OtterSec', 'Neodyme', 'Kudelski', 'ChainSecurity', 'Code4rena', 'Sherlock', 'Macro', 'Ackee']
    const hits = known.filter((k) => auditInfo.toLowerCase().includes(k.toLowerCase()))
    return hits.length ? [...new Set(hits)].slice(0, 5) : null
  }
  return null
}

// ── Build a socials object from intel links. ──
function mapSocials(d) {
  const links = arr(d.external_links).concat(arr(d.social_links)).filter(isStr)
  const find = (re) => links.find((l) => re.test(l)) || null
  const out = {}
  if (isStr(d.website)) out.website = d.website.trim()
  const x = find(/(twitter\.com|x\.com)/i); if (x) out.x = x
  const tg = find(/t\.me|telegram/i); if (tg) out.telegram = tg
  const dc = find(/discord/i); if (dc) out.discord = dc
  if (isStr(d.github_url)) out.github = d.github_url.trim()
  return Object.keys(out).length ? out : null
}

// ── intel -> partial AlphaThesisCards thesis (only intel-backed fields; the rest
//    stay data-derived via mergeAiThesis). ──
function mapIntelToThesis(d) {
  if (!d || typeof d !== 'object') return null
  const out = {}
  const note = cleanStr(d.project_summary) || cleanStr(d.description_extracted)
  if (note) out.analystNote = note.slice(0, 600)
  // Roadmap milestones -> catalysts (real, dated where the crawler captured it).
  const roadmap = arr(d.roadmap).filter(isStr).slice(0, 4)
  if (roadmap.length) {
    out.catalysts = roadmap.map((r) => {
      const m = r.match(/\b(Q[1-4]\s*'?\d{2,4}|\d{4}|[A-Z][a-z]+ \d{4})\b/)
      return { event: r.replace(/\s+/g, ' ').slice(0, 110), timing: m ? m[0] : '', impact: 'medium' }
    })
  }
  const socials = mapSocials(d)
  if (socials) out.socials = socials
  return Object.keys(out).length ? out : null
}

// ── intel -> partial TokenPitchDeck pitch (real tokenomics/team/roadmap/moat). ──
function mapIntelToPitch(d) {
  if (!d || typeof d !== 'object') return null
  const out = {}
  const summary = cleanStr(d.project_summary) || cleanStr(d.description_extracted)
  if (summary) { out.problem = undefined; out.solution = summary.slice(0, 600) }

  const tok = mapTokenomics(d.tokenomics)
  if (tok) out.tokenomics = tok

  const backers = arr(d.vc_backers).filter(isStr).slice(0, 8)
  const fromRounds = arr(d.funding_rounds).map((r) => (isStr(r) ? r : (r && (r.investors || r.lead)))).flat().filter(isStr)
  const allBackers = [...new Set(backers.concat(fromRounds))].slice(0, 8)
  const audits = mapAudits(d.audit_info)
  const team = {}
  if (allBackers.length) team.backers = allBackers
  if (audits) { team.audits = audits; team.auditStatus = 'Audited' }
  if (isStr(d.team)) team.founders = d.team.trim()
  if (Object.keys(team).length) out.team = team

  // Moat from key features / partnerships (real, when substantive).
  const feats = arr(d.key_features).filter((f) => isStr(f) && f.trim().length > 6).slice(0, 4)
  const parts = arr(d.partnerships).filter(isStr).slice(0, 4)
  if (feats.length || parts.length) {
    const desc = [feats.length ? `Key features: ${feats.join(', ')}.` : '', parts.length ? `Partners: ${parts.join(', ')}.` : ''].filter(Boolean).join(' ')
    if (desc) out.moat = { description: desc.slice(0, 400) }
  }
  return Object.keys(out).length ? out : null
}

// ── Bounded parallel map over items. ──
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      try { out[idx] = await fn(items[idx], idx) } catch (_) { out[idx] = null }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * Crawl the top-N research-desk projects' real intel and map to thesis + pitch.
 * @param {Array} projects  research-desk core projects (need {symbol, name, url, socials, ...})
 * @param {object} [opts]   { limit=INTEL_LIMIT }
 * @returns {Promise<{ theses: object, pitches: object, meta: object }>}
 */
async function buildIntelContent(projects, opts = {}) {
  const theses = {}
  const pitches = {}
  const meta = { source: 'spectre-intel-crawl', generated: 0, requested: 0, hasKey: !!SPECTRE_DATA_KEY }
  if (!SPECTRE_DATA_KEY || !Array.isArray(projects) || projects.length === 0) return { theses, pitches, meta }

  const top = [...projects]
    .filter((p) => p && isStr(p.symbol))
    .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
    .slice(0, opts.limit || INTEL_LIMIT)
  meta.requested = top.length

  await mapLimited(top, INTEL_CONCURRENCY, async (p) => {
    const s = sym(p.symbol)
    if (!s) return null
    const intel = await fetchIntel(s, {
      website: (p.socials && p.socials.website) || p.url,
      name: p.name,
      github: (p.socials && p.socials.github),
      coingeckoId: p.id,
    })
    if (!intel) return null
    const th = mapIntelToThesis(intel)
    const pi = mapIntelToPitch(intel)
    if (th) theses[s] = th
    if (pi) pitches[s] = pi
    if (th || pi) meta.generated++
    return null
  })

  return { theses, pitches, meta }
}

module.exports = { buildIntelContent, fetchIntel, mapIntelToThesis, mapIntelToPitch }
