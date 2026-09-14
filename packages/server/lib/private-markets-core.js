/**
 * Spectre Private Markets — shared core logic (transport-agnostic).
 *
 * Single source of truth for the VC funding intelligence feed. Consumed by:
 *   - packages/server/routes/private-markets.js  (Express dev server)
 *   - apps/research/api/_lib/handlers/extended-proxy.js  (Vercel serverless, prod)
 *
 * Both wrappers call handlePrivateMarketsRoute(sub, query) and forward the
 * returned { status, body }. Keeping the curated seed + fetchers here means the
 * editorial team updates one file and dev + prod stay in lockstep.
 *
 * Data source priority for the deal feed:
 *   1. Spectre Curated seed (editorial, always present)
 *   2. DeFiLlama /raises   (clean, structured, per-round metadata)
 *   3. TechCrunch + Bloomberg + Crunchbase RSS (broader coverage)
 *   4. SEC EDGAR Form D    (regulatory, entity-name-only signal)
 *
 * Never throws — failures degrade to stale cache or empty arrays per
 * .claude/rules/api-patterns.md F.
 */

// Node 18+/22 ships global fetch. node-fetch is only loaded if a host runtime
// somehow lacks it (kept for belt-and-suspenders parity with the old route).
const fetch = globalThis.fetch || require('node-fetch');

// ─── Cache primitives ───────────────────────────────────────────────────────
function makeCache() {
  return new Map();
}
function getCached(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
function setCached(cache, key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
  if (cache.size > 200) {
    let oldestKey = null;
    let oldestExp = Infinity;
    for (const [k, v] of cache.entries()) {
      if (v.expires < oldestExp) {
        oldestExp = v.expires;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

const llamaCache = makeCache();
const secCache = makeCache();
const rssCache = makeCache();
const companyCache = makeCache();
const unicornCache = makeCache();
const dealsCache = makeCache();
const valuationCache = makeCache();
const spectreCache = makeCache();
const statsCache = makeCache();

const LLAMA_TTL = 15 * 60 * 1000; // 15 minutes
const SEC_TTL = 30 * 60 * 1000; // 30 minutes
const RSS_TTL = 15 * 60 * 1000; // 15 minutes
const COMPANY_TTL = 6 * 60 * 60 * 1000; // 6 hours
const UNICORN_TTL = 24 * 60 * 60 * 1000; // 24 hours
const DEALS_TTL = 2 * 60 * 1000; // 2 minutes (was 10 — Spectre fundraising is realtime)
const VALUATION_TTL = 30 * 60 * 1000; // 30 minutes
const SPECTRE_TTL = 2 * 60 * 1000; // 2 minutes
const STATS_TTL = 5 * 60 * 1000; // 5 minutes

// Spectre Data API origin. Defaults to the direct Hetzner IP so we bypass the
// Cloudflare WAF on api.spectreai.io, which blocks server-to-server calls.
const SPECTRE_API_BASE =
  process.env.SPECTRE_API_BASE ||
  process.env.SPECTRE_API_ORIGIN ||
  'http://204.168.244.18:3850';
const SPECTRE_API_KEY =
  process.env.SPECTRE_API_KEY ||
  process.env.SPECTRE_DATA_API_KEY ||
  process.env.SPECTRE_DATA_BRIDGE_KEY ||
  '';

// ─── Utility: parse RSS 2.0 and Atom feeds with zero dependencies ───────────
function _parseRss(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const items = [];
  const blockRe = /<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[2];
    items.push({
      title: _tag(block, 'title'),
      link: _tag(block, 'link') || _attr(block, 'link', 'href'),
      description: _tag(block, 'description') || _tag(block, 'summary') || _tag(block, 'content'),
      pubDate: _tag(block, 'pubDate') || _tag(block, 'published') || _tag(block, 'updated'),
      author: _tag(block, 'author') || _tag(block, 'dc:creator'),
      categories: _tagAll(block, 'category'),
    });
  }
  return items;
}
function _tag(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return null;
  return _decodeEntities(m[1].trim());
}
function _tagAll(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) out.push(_decodeEntities(m[1].trim()));
  return out;
}
function _attr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*\\/?>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}
function _decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '');
}

// ─── Utility: amount parsing ────────────────────────────────────────────────
const MILLION = 1_000_000;
const BILLION = 1_000_000_000;
function parseAmount(str) {
  if (!str) return null;
  const s = String(str);
  const m = s.match(/\$?\s*([0-9][0-9,.]*)\s*(billion|million|thousand|B|M|K)?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'billion' || unit === 'b') return num * BILLION;
  if (unit === 'million' || unit === 'm') return num * MILLION;
  if (unit === 'thousand' || unit === 'k') return num * 1000;
  return num;
}

function detectRoundType(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/pre[\s-]?ipo|late.?stage|secondary tender/.test(t)) return 'Pre-IPO';
  if (/series\s?h\b/.test(t)) return 'Series H';
  if (/series\s?g\b/.test(t)) return 'Series G';
  if (/series\s?f\b/.test(t)) return 'Series F';
  if (/series\s?e\b/.test(t)) return 'Series E';
  if (/series\s?d\b/.test(t)) return 'Series D';
  if (/series\s?c\b/.test(t)) return 'Series C';
  if (/series\s?b\b/.test(t)) return 'Series B';
  if (/series\s?a\b/.test(t)) return 'Series A';
  if (/pre[\s-]?seed/.test(t)) return 'Pre-Seed';
  if (/\bseed\b|seed round/.test(t)) return 'Seed';
  if (/growth round|growth equity/.test(t)) return 'Growth';
  return null;
}

function detectSector(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(ai|llm|gpt|artificial intelligence|machine learning|foundation model|generative)\b/.test(t)) return 'AI';
  if (/\b(defense|defence|military|aerospace|drone|missile)\b/.test(t)) return 'Defence';
  if (/\b(fintech|payments|banking|lending|neobank|crypto exchange)\b/.test(t)) return 'Fintech';
  if (/\b(robot|robotics|autonomous)\b/.test(t)) return 'Robotics';
  if (/\b(biotech|drug|pharma|therapeutic|clinical|vaccine)\b/.test(t)) return 'BioTech';
  if (/\b(climate|carbon|battery|solar|energy storage|clean energy)\b/.test(t)) return 'Climate';
  if (/\b(web3|blockchain|crypto|token|l2|onchain|zk)\b/.test(t)) return 'Crypto';
  if (/\b(saas|enterprise software|devtool|developer)\b/.test(t)) return 'SaaS';
  if (/\b(space|satellite|launch vehicle)\b/.test(t)) return 'Space';
  return 'Other';
}

const COMPANY_STOPWORDS = new Set([
  'exclusive', 'breaking', 'report', 'reports', 'analysis', 'opinion',
  'the week', 'the top', 'this week', 'weekly', 'daily', 'watch',
  'updated', 'revealed', 'explained', 'wall street', 'in a',
]);
function extractCompanyFromHeadline(title) {
  if (!title) return null;
  const cleaned = title.replace(/^(exclusive|breaking|report|opinion|analysis)\s*:\s*/i, '');
  const m = cleaned.match(/^([A-Z][A-Za-z0-9.&'\- ]{1,40}?)\s+(?:raises|secures|closes|completes|nets|lands|announces|confirms)\b/);
  const name = m ? m[1].trim() : (() => {
    const cap = cleaned.match(/^([A-Z][A-Za-z0-9.&']+(?:\s[A-Z][A-Za-z0-9.&']+){0,3})/);
    return cap ? cap[1].trim() : null;
  })();
  if (!name) return null;
  if (COMPANY_STOPWORDS.has(name.toLowerCase())) return null;
  if (name.length < 2) return null;
  if (/^(a|an|the|in|on|of|for|with|by|as|at|to|from|and|or|but)$/i.test(name)) return null;
  return name;
}

/**
 * A company name, not the headline it was cut out of.
 *
 * Both feeding lanes hand us sentence fragments where a name belongs. The
 * upstream fundraising table carries "GameStop launches 45M share ATM
 * offering," and "Tarun Chitra's Gauntlet"; the press lanes carry
 * "OpenAI-backed Thrive Holdings". A card that prints those reads as broken,
 * and — worse — two spellings of one round survive dedupe as two deals.
 *
 * Only transformations that cannot invent a different company are applied.
 * A fragment with no name in it at all ("VCs Pour Billions Into", "Hinge
 * founder") is left exactly as it came: truncating it would name the wrong
 * company, which is worse than printing an awkward one.
 */
const ACTION_VERBS = [
  'raises', 'raised', 'secures', 'secured', 'closes', 'closed', 'completes',
  'announces', 'announced', 'confirms', 'confirmed', 'launches', 'launched',
  'files', 'filed', 'acquires', 'acquired', 'pours', 'poured', 'valued',
  'seeks', 'plans', 'weighs', 'taps', 'picks',
];
// `nets` and `lands` are deliberately absent — "Brooklyn Nets", "Lands' End".
const ACTION_RE = new RegExp(`\\s+(?:${ACTION_VERBS.join('|')}|in talks)\\b.*$`, 'i');

function cleanCompanyName(raw) {
  let name = String(raw == null ? '' : raw).trim();
  if (!name) return raw;

  // "GameStop launches 45M share ATM offering," -> "GameStop"
  const truncated = name.replace(ACTION_RE, '').trim();
  if (truncated.length >= 2 && truncated !== name) name = truncated;

  // "OpenAI-backed Thrive Holdings" -> "Thrive Holdings"
  name = name.replace(/^[A-Za-z0-9.&']+-(?:backed|led|owned|founded|incubated)\s+/i, '').trim();

  // "Tarun Chitra's Gauntlet" -> "Gauntlet" (straight and curly apostrophes)
  const possessive = name.match(/^.+?['\u2019]s\s+(.+)$/);
  if (possessive && possessive[1].trim().length >= 2) name = possessive[1].trim();

  // A trailing comma is always the headline's, never the company's.
  name = name.replace(/[\s,;:]+$/, '').trim();

  return name.length >= 2 ? name : String(raw).trim();
}

/**
 * Two rows that are one round.
 *
 * The existing dedupe keys on company-slug + month, so a round survives twice
 * whenever the two lanes spell the company differently — measured on the live
 * feed: GameStop's $933M appears as both "GameStop" and "GameStop launches 45M
 * share ATM offering," on 2026-07-27, and Thrive Holdings' $2B as both "Thrive
 * Holdings" and "OpenAI-backed Thrive Holdings" on 2026-08-12.
 *
 * Matching on amount + day ALONE would be wrong: two unrelated startups closing
 * $10M on the same Tuesday is ordinary. So the names have to be related too —
 * one slug containing the other, which is exactly the shape a headline fragment
 * takes around the name it wraps. The survivor is the higher-priority source,
 * and it inherits any field the loser had and it did not.
 */
const ROUND_SOURCE_PRIORITY = { Spectre: 0, 'Spectre Curated': 1, DeFiLlama: 2 };
const slugOf = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');

function mergeSameRound(rows) {
  const out = [];
  const byRound = new Map(); // `${amount}:${day}` -> [index in out]
  for (const row of rows) {
    const amount = row && row.amountUsd;
    const t = row && row.date ? Date.parse(row.date) : NaN;
    if (!(amount > 0) || !Number.isFinite(t)) { out.push(row); continue; }

    const key = `${amount}:${new Date(t).toISOString().slice(0, 10)}`;
    const bucket = byRound.get(key);
    if (!bucket) { byRound.set(key, [out.length]); out.push(row); continue; }

    const slug = slugOf(row.company);
    const twinIdx = bucket.find((i) => {
      const other = slugOf(out[i].company);
      if (!slug || !other) return false;
      return slug === other || slug.includes(other) || other.includes(slug);
    });
    if (twinIdx == null) { bucket.push(out.length); out.push(row); continue; }

    const kept = out[twinIdx];
    const keptPri = ROUND_SOURCE_PRIORITY[kept.sourceBadge] ?? 9;
    const rowPri = ROUND_SOURCE_PRIORITY[row.sourceBadge] ?? 9;
    // Same source tier: the shorter name is the one that is a name and not a
    // headline. Different tiers: the better-sourced row wins outright.
    const winner = rowPri < keptPri ? row
      : rowPri > keptPri ? kept
        : (String(row.company || '').length < String(kept.company || '').length ? row : kept);
    const loser = winner === kept ? row : kept;
    const merged = { ...loser, ...winner };
    // `{...winner}` would let the winner's nulls erase the loser's real values.
    for (const field of ['valuationUsd', 'leadInvestor', 'roundType', 'sector', 'description', 'link']) {
      if (merged[field] == null && loser[field] != null) merged[field] = loser[field];
    }
    out[twinIdx] = merged;
  }
  return out;
}

function logoUrlForDomain(domain) {
  if (!domain) return null;
  const clean = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!clean) return null;
  // Clearbit's free logo API still works (better hit-rate + nicer rendering than
  // Google S2 favicons, which often return blank 16x16 PNGs). Fronted on the
  // frontend with an onError fallback to S2 -> initial.
  return `https://logo.clearbit.com/${encodeURIComponent(clean)}`;
}
function guessLogoUrl(companyName, assetSymbol) {
  if (!companyName && !assetSymbol) return null;
  // Try common crypto-project TLDs first when we have a symbol — those projects
  // rarely live on .com.
  if (assetSymbol) {
    const slug = String(assetSymbol).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (slug) return logoUrlForDomain(`${slug}.xyz`);
  }
  if (!companyName) return null;
  const slug = String(companyName)
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|ai|labs|technologies|technology|therapeutics|ventures|capital|finance|protocol|network)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  if (!slug) return null;
  return logoUrlForDomain(`${slug}.com`);
}

// ─── Internal fetcher: Spectre Data API /v1/fundraising/rounds ──────────────
// This is the real-time source of truth — Alaa's fundraising pipeline runs on
// Hetzner with ~200 sized rounds + a constant DefiLlama-listing stream. Output
// shape: { data: [{ id, asset, project_name, round_type, amount_raised_usd,
//   valuation_usd, date, lead_investors[], all_investors[], source_url }] }
async function fetchSpectreFundraising() {
  const cacheKey = 'spectre:rounds';
  const cached = getCached(spectreCache, cacheKey);
  if (cached) return cached;

  try {
    const headers = { Accept: 'application/json', 'User-Agent': 'Spectre-AI/1.0' };
    if (SPECTRE_API_KEY) headers['X-API-Key'] = SPECTRE_API_KEY;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const r = await fetch(`${SPECTRE_API_BASE}/v1/fundraising/rounds?limit=500`, {
      signal: ctrl.signal,
      headers,
    }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`spectre-${r.status}`);
    const json = await r.json();
    const rows = Array.isArray(json?.data) ? json.data : [];

    const normalized = rows
      // Drop DefiLlama project listings — they have no amount and clutter the deal feed.
      .filter((row) => row.round_type !== 'defillama_listing')
      .filter((row) => row.amount_raised_usd && row.amount_raised_usd > 0)
      .map((row) => {
        const name = row.project_name || 'Unknown';
        const date = row.date ? new Date(row.date).toISOString() : null;
        const amountUsd = Number(row.amount_raised_usd) || null;
        const valuationUsd = row.valuation_usd ? Number(row.valuation_usd) : null;
        const leadInvestors = Array.isArray(row.lead_investors) ? row.lead_investors : [];
        const otherInvestors = Array.isArray(row.all_investors)
          ? row.all_investors.filter((x) => !leadInvestors.includes(x))
          : [];
        const sector = detectSector(name) || 'Crypto';
        const headline = `${name} raises ${formatAmountShort(amountUsd)} ${row.round_type || 'round'}${
          leadInvestors[0] ? `, led by ${leadInvestors[0]}` : ''
        }`;
        return {
          id: `spectre-${row.id}`,
          company: name,
          asset: row.asset || null,
          logoUrl: logoForCompany(name, row.asset),
          roundType: normalizeLlamaRound(row.round_type),
          amountUsd,
          valuationUsd,
          sector,
          category: sector,
          chains: [],
          leadInvestor: leadInvestors[0] || null,
          leadInvestors,
          otherInvestors,
          date,
          headline,
          description: null,
          sourceBadge: 'Spectre',
          link: row.source_url || null,
        };
      });

    setCached(spectreCache, cacheKey, normalized, SPECTRE_TTL);
    return normalized;
  } catch (err) {
    console.warn('[private-markets] spectre fetch failed:', err.message);
    return getCached(spectreCache, cacheKey) || [];
  }
}

async function fetchSpectreStats() {
  const cacheKey = 'spectre:stats';
  const cached = getCached(statsCache, cacheKey);
  if (cached) return cached;
  try {
    const headers = { Accept: 'application/json' };
    if (SPECTRE_API_KEY) headers['X-API-Key'] = SPECTRE_API_KEY;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(`${SPECTRE_API_BASE}/v1/fundraising/stats`, {
      signal: ctrl.signal,
      headers,
    }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`stats-${r.status}`);
    const json = await r.json();
    const data = json?.data || null;
    if (data) setCached(statsCache, cacheKey, data, STATS_TTL);
    return data;
  } catch (err) {
    console.warn('[private-markets] spectre stats failed:', err.message);
    return getCached(statsCache, cacheKey) || null;
  }
}

// ─── Internal fetcher: DeFiLlama /raises ────────────────────────────────────
async function fetchLlamaRaises() {
  const cacheKey = 'llama:all';
  const cached = getCached(llamaCache, cacheKey);
  if (cached) return cached;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const apiRes = await fetch('https://api.llama.fi/raises', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Spectre-AI/1.0 (+https://spectreai.io)' },
    }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
    clearTimeout(timer);

    if (!apiRes.ok) throw new Error(`llama-${apiRes.status}`);
    const json = await apiRes.json();
    const raises = Array.isArray(json?.raises) ? json.raises : [];

    const normalized = raises
      .filter((r) => r && r.amount > 0 && r.date)
      .map((r) => {
        const amountUsd = Number(r.amount) * 1e6;
        const valuationUsd = r.valuation ? Number(r.valuation) * 1e6 : null;
        const sectorRaw = r.category || r.sector || '';
        const sector = mapLlamaCategoryToSector(sectorRaw);
        const leadInvestors = Array.isArray(r.leadInvestors) ? r.leadInvestors : [];
        const otherInvestors = Array.isArray(r.otherInvestors) ? r.otherInvestors : [];
        const roundType = normalizeLlamaRound(r.round);
        return {
          id: `llama-${r.date}-${(r.name || '').replace(/[^a-z0-9]/gi, '')}`,
          company: r.name || 'Unknown',
          roundType,
          amountUsd,
          valuationUsd,
          sector,
          category: sectorRaw || 'Other',
          chains: Array.isArray(r.chains) ? r.chains : [],
          leadInvestor: leadInvestors[0] || null,
          leadInvestors,
          otherInvestors,
          date: new Date(r.date * 1000).toISOString(),
          sourceBadge: 'DeFiLlama',
          link: r.source || null,
          headline: buildLlamaHeadline(r, amountUsd),
          description: null,
        };
      });

    setCached(llamaCache, cacheKey, normalized, LLAMA_TTL);
    return normalized;
  } catch (err) {
    console.warn('[private-markets] llama fetch failed:', err.message);
    return getCached(llamaCache, cacheKey) || [];
  }
}
function normalizeLlamaRound(round) {
  if (!round) return null;
  const r = String(round).trim();
  if (/^series\s+[a-h]/i.test(r)) {
    return r.replace(/^series\s+/i, 'Series ').replace(/([a-h])$/i, (m) => m.toUpperCase());
  }
  if (/pre[-\s]?seed/i.test(r)) return 'Pre-Seed';
  if (/^seed/i.test(r)) return 'Seed';
  if (/strategic/i.test(r)) return 'Strategic';
  if (/growth/i.test(r)) return 'Growth';
  if (/pre[-\s]?ipo|late[-\s]?stage/i.test(r)) return 'Pre-IPO';
  if (/grant/i.test(r)) return 'Grant';
  if (/acquisition/i.test(r)) return 'Acquisition';
  return r;
}
function mapLlamaCategoryToSector(raw) {
  if (!raw) return 'Crypto';
  const r = String(raw).toLowerCase();
  if (/\bai\b|machine learning|llm/.test(r)) return 'AI';
  if (/defi|dex|lending|stablecoin|cefi|derivatives|cex|amm/.test(r)) return 'Crypto';
  if (/gaming|gamefi|nft|metaverse/.test(r)) return 'Crypto';
  if (/l2|rollup|scaling|bridge|chain|infra|zk/.test(r)) return 'Crypto';
  if (/payment|remittance|banking|fintech/.test(r)) return 'Fintech';
  if (/commerce|marketplace|retail/.test(r)) return 'Commerce';
  if (/climate|carbon|energy/.test(r)) return 'Climate';
  if (/saas|enterprise|devtool|b2b/.test(r)) return 'SaaS';
  return 'Crypto';
}
function buildLlamaHeadline(r, amountUsd) {
  const amt =
    amountUsd >= 1e9
      ? `$${(amountUsd / 1e9).toFixed(1)}B`
      : `$${Math.round(amountUsd / 1e6)}M`;
  const round = r.round || 'round';
  const lead = Array.isArray(r.leadInvestors) && r.leadInvestors[0] ? `, led by ${r.leadInvestors[0]}` : '';
  return `${r.name || 'Unknown'} raises ${amt} ${round}${lead}`;
}

// ─── Internal fetcher: SEC EDGAR Form D filings ─────────────────────────────
async function fetchSecFilings() {
  const cacheKey = 'sec:form-d:7d';
  const cached = getCached(secCache, cacheKey);
  if (cached) return cached;

  try {
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().split('T')[0];
    const url = `https://efts.sec.gov/LATEST/search-index?q=&forms=D&dateRange=custom&startdt=${fmt(sevenDaysAgo)}&enddt=${fmt(today)}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const apiRes = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Spectre AI Research Platform contact@spectreai.io',
        Accept: 'application/json',
      },
    }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
    clearTimeout(timer);

    if (!apiRes.ok) throw new Error(`sec-${apiRes.status}`);
    const json = await apiRes.json();
    const hits = json?.hits?.hits || [];

    const filings = hits
      .map((h) => {
        const src = h._source || {};
        return {
          id: h._id || `${src.adsh || ''}-${src.ciks?.[0] || ''}`,
          entityName: src.display_names?.[0] || src.entity_name || null,
          formType: src.form || 'D',
          filedAt: src.file_date || src.file_filed || null,
          periodOfReport: src.period_ending || null,
          accessionNumber: src.adsh || null,
          cik: src.ciks?.[0] || null,
          totalOfferingAmount: null,
          url: src.adsh
            ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.ciks?.[0] || ''}&type=D&dateb=&owner=include&count=40`
            : null,
        };
      })
      .filter((f) => f.entityName);

    setCached(secCache, cacheKey, filings, SEC_TTL);
    return filings;
  } catch (err) {
    console.warn('[private-markets] sec fetch failed:', err.message);
    return getCached(secCache, cacheKey) || [];
  }
}

// ─── RSS funding news ───────────────────────────────────────────────────────
const RSS_FEEDS = [
  { name: 'TechCrunch Venture', url: 'https://techcrunch.com/category/venture/feed/' },
  { name: 'Crunchbase News', url: 'https://news.crunchbase.com/feed/' },
  { name: 'Bloomberg Technology', url: 'https://feeds.bloomberg.com/technology/news.rss' },
];
const STRONG_FUNDING_SIGNALS = [
  /\braises?\s+\$?[\d.]/i,
  /\braised\s+\$?[\d.]/i,
  /\bsecures?\s+\$?[\d.]/i,
  /\bcloses?\s+(?:a|its)?\s*\$?[\d.]/i,
  /\bnets?\s+\$?[\d.]/i,
  /\blands?\s+\$?[\d.]/i,
  /\bseries\s+[a-h]\b/i,
  /\bseed\s+round\b/i,
  /\bseed\s+funding\b/i,
  /\bpre-?seed\b/i,
  /\bpre-?ipo\b/i,
  /\bfunding\s+round\b/i,
  /\bventure\s+round\b/i,
  /\bgrowth\s+round\b/i,
  /\bat\s+\$?\d+\s*(?:billion|million|B\b|M\b).*valuation/i,
];
const NEGATIVE_SIGNALS = [
  /\bipo\s+(?:files?|filed|filing)/i,
  /\bfiles?\s+for\s+ipo/i,
  /\bshareholder\s+meeting\b/i,
  /\bearnings\b/i,
  /\bhiring\b/i,
  /\blayoff/i,
];
function matchesFunding(item) {
  const hay = `${item.title || ''} ${item.description || ''}`;
  if (NEGATIVE_SIGNALS.some((re) => re.test(hay))) return false;
  return STRONG_FUNDING_SIGNALS.some((re) => re.test(hay));
}

async function fetchFundingNews() {
  const cacheKey = 'rss:funding:all';
  const cached = getCached(rssCache, cacheKey);
  if (cached) return cached;

  try {
    const feedResults = await Promise.all(
      RSS_FEEDS.map(async (feed) => {
        try {
          const ctrl = new AbortController();
          // 3 s cap (was 8 s). On cold cache the deals endpoint is gated on
          // the slowest RSS feed; capping prevents long-tail Bloomberg/etc.
          // from blocking the entire response. Feeds that miss the window
          // fall through to the cache from the previous successful fetch.
          const timer = setTimeout(() => ctrl.abort(), 3_000);
          const r = await fetch(feed.url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Spectre-AI/1.0 (+https://spectreai.io)' },
          });
          clearTimeout(timer);
          if (!r.ok) return [];
          const xml = await r.text();
          const items = _parseRss(xml);
          return items
            .filter(matchesFunding)
            .map((item) => {
              const amountUsd = parseAmount(`${item.title || ''} ${item.description || ''}`);
              const company = extractCompanyFromHeadline(item.title);
              const sector = detectSector(`${item.title || ''} ${item.description || ''}`);
              const roundType = detectRoundType(`${item.title || ''} ${item.description || ''}`);
              return {
                id: `${feed.name}-${item.link || item.title}`.slice(0, 200),
                headline: item.title,
                company,
                logoUrl: guessLogoUrl(company),
                link: item.link,
                description: (item.description || '').slice(0, 500),
                publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
                source: feed.name,
                amountUsd,
                roundType,
                sector,
              };
            });
        } catch (err) {
          console.warn(`[private-markets] feed ${feed.name} failed:`, err.message);
          return [];
        }
      })
    );

    const merged = feedResults.flat().filter((x) => x.headline);
    const seen = new Set();
    const deduped = [];
    for (const it of merged) {
      const key = (it.headline || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
      if (key && !seen.has(key)) {
        seen.add(key);
        deduped.push(it);
      }
    }
    deduped.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    });

    setCached(rssCache, cacheKey, deduped, RSS_TTL);
    return deduped;
  } catch (err) {
    console.warn('[private-markets] rss fetch failed:', err.message);
    return getCached(rssCache, cacheKey) || [];
  }
}

// ─── Curated seed ───────────────────────────────────────────────────────────
const COMPANY_DOMAINS = {
  Anthropic: 'anthropic.com',
  OpenAI: 'openai.com',
  xAI: 'x.ai',
  'Mistral AI': 'mistral.ai',
  Cohere: 'cohere.com',
  Perplexity: 'perplexity.ai',
  'Safe Superintelligence': 'ssi.inc',
  Harvey: 'harvey.ai',
  'Hugging Face': 'huggingface.co',
  'Scale AI': 'scale.com',
  Databricks: 'databricks.com',
  'Figure AI': 'figure.ai',
  'Physical Intelligence': 'physicalintelligence.company',
  Groq: 'groq.com',
  CoreWeave: 'coreweave.com',
  Lambda: 'lambdalabs.com',
  'Celestial AI': 'celestial.ai',
  'Together AI': 'together.ai',
  Anduril: 'anduril.com',
  'Shield AI': 'shield.ai',
  Saronic: 'saronic.com',
  Helsing: 'helsing.ai',
  Stripe: 'stripe.com',
  Ramp: 'ramp.com',
  Rippling: 'rippling.com',
  Plaid: 'plaid.com',
  Revolut: 'revolut.com',
  Kraken: 'kraken.com',
  Monad: 'monad.xyz',
  Berachain: 'berachain.com',
  EigenLayer: 'eigenlayer.xyz',
  Farcaster: 'farcaster.xyz',
  SpaceX: 'spacex.com',
  'Impulse Space': 'impulsespace.com',
  'Stoke Space': 'stokespace.com',
  'Commonwealth Fusion': 'cfs.energy',
  'Xaira Therapeutics': 'xaira.com',
  'Isomorphic Labs': 'isomorphiclabs.com',
  Canva: 'canva.com',
  Glean: 'glean.com',
};
function logoForCompany(name, assetSymbol) {
  if (!name) return null;
  const domain = COMPANY_DOMAINS[name] || null;
  if (domain) return logoUrlForDomain(domain);
  return guessLogoUrl(name, assetSymbol);
}

const CURATED_RAISES_SEED = [
  // ═══ AI — Anthropic (full history) ═══
  { company: 'Anthropic', date: '2021-05-28', round: 'Series A', amountUsd: 124e6, valuationUsd: 845e6, sector: 'AI', leadInvestor: 'Skype Founder James McClave', investors: ['Skype Founder James McClave', 'Jaan Tallinn', 'Center for Emerging Risk Research'], description: 'Anthropic Series A. Founded by Dario and Daniela Amodei.' },
  { company: 'Anthropic', date: '2022-04-28', round: 'Series B', amountUsd: 580e6, valuationUsd: 4e9, sector: 'AI', leadInvestor: 'Sam Bankman-Fried', investors: ['Sam Bankman-Fried', 'Caroline Ellison', 'Jaan Tallinn', 'Dustin Moskovitz'], description: 'Series B. Claude 1 development underway.' },
  { company: 'Anthropic', date: '2023-05-23', round: 'Series C', amountUsd: 450e6, valuationUsd: 4.1e9, sector: 'AI', leadInvestor: 'Spark Capital', investors: ['Spark Capital', 'Google', 'Salesforce', 'Sound Ventures'], description: 'Claude 2 launched. Series C.' },
  { company: 'Anthropic', date: '2023-09-25', round: 'Strategic', amountUsd: 4e9, valuationUsd: 18e9, sector: 'AI', leadInvestor: 'Amazon', investors: ['Amazon'], description: 'Amazon strategic investment. AWS becomes primary cloud provider.' },
  { company: 'Anthropic', date: '2024-01-01', round: 'Strategic', amountUsd: 2e9, valuationUsd: 20e9, sector: 'AI', leadInvestor: 'Google', investors: ['Google'], description: 'Google extends its strategic commitment to Anthropic.' },
  { company: 'Anthropic', date: '2025-03-03', round: 'Series E', amountUsd: 3.5e9, valuationUsd: 61.5e9, sector: 'AI', leadInvestor: 'Lightspeed', investors: ['Lightspeed', 'Salesforce', 'Cisco', 'Fidelity'], description: 'Series E values Anthropic at $61.5B post-money.' },
  { company: 'Anthropic', date: '2026-03-03', round: 'Series F', amountUsd: 13.5e9, valuationUsd: 183.5e9, sector: 'AI', leadInvestor: 'Lightspeed', investors: ['Lightspeed', 'Fidelity', 'BlackRock', 'GIC'], description: 'Claude 4.5 family shipping. Series F at $183.5B post-money.' },

  // ═══ AI — OpenAI (full history) ═══
  { company: 'OpenAI', date: '2019-07-22', round: 'Strategic', amountUsd: 1e9, valuationUsd: 12e9, sector: 'AI', leadInvestor: 'Microsoft', investors: ['Microsoft'], description: 'Microsoft strategic partnership. Azure becomes exclusive cloud.' },
  { company: 'OpenAI', date: '2023-01-23', round: 'Strategic', amountUsd: 10e9, valuationUsd: 29e9, sector: 'AI', leadInvestor: 'Microsoft', investors: ['Microsoft'], description: 'Multi-year Microsoft extension. Post-ChatGPT launch.' },
  { company: 'OpenAI', date: '2024-01-10', round: 'Tender Offer', amountUsd: 0.3e9, valuationUsd: 86e9, sector: 'AI', leadInvestor: 'Thrive Capital', investors: ['Thrive Capital'], description: 'Employee tender offer at $86B valuation.' },
  { company: 'OpenAI', date: '2024-10-02', round: 'Late Stage', amountUsd: 6.6e9, valuationUsd: 157e9, sector: 'AI', leadInvestor: 'Thrive Capital', investors: ['Thrive', 'Microsoft', 'Nvidia', 'SoftBank', 'MGX'], description: 'GPT-4, o1, and ChatGPT. Largest private round to date.' },
  { company: 'OpenAI', date: '2025-03-31', round: 'Series E', amountUsd: 40e9, valuationUsd: 300e9, sector: 'AI', leadInvestor: 'SoftBank', investors: ['SoftBank', 'Microsoft', 'Coatue', 'Thrive', 'Altimeter'], description: 'SoftBank leads record-breaking round at $300B valuation.' },

  // ═══ AI — xAI (full history) ═══
  { company: 'xAI', date: '2023-12-29', round: 'Series A', amountUsd: 134.7e6, valuationUsd: null, sector: 'AI', leadInvestor: 'Undisclosed', investors: ['Undisclosed'], description: 'xAI founding round. Team assembled from DeepMind, Google, OpenAI.' },
  { company: 'xAI', date: '2024-05-26', round: 'Series B', amountUsd: 6e9, valuationUsd: 24e9, sector: 'AI', leadInvestor: 'Valor Equity Partners', investors: ['Valor', 'Vy Capital', 'a16z', 'Sequoia', 'Fidelity'], description: 'Grok-2 development. Memphis supercluster.' },
  { company: 'xAI', date: '2024-12-23', round: 'Series C', amountUsd: 6e9, valuationUsd: 50e9, sector: 'AI', leadInvestor: 'Valor Equity Partners', investors: ['Valor', 'Vy Capital', 'a16z', 'Sequoia', 'Qatar Investment Authority'], description: 'Series C values xAI at $50B.' },
  { company: 'xAI', date: '2025-03-28', round: 'Series D', amountUsd: 10e9, valuationUsd: 75e9, sector: 'AI', leadInvestor: 'Valor Equity Partners', investors: ['Valor', 'Andreessen Horowitz', 'Sequoia', 'Fidelity'], description: 'Grok-3 launched. Series D at $75B.' },
  { company: 'xAI', date: '2025-12-01', round: 'Series E', amountUsd: 12e9, valuationUsd: 120e9, sector: 'AI', leadInvestor: 'Valor Equity Partners', investors: ['Valor', 'a16z', 'BlackRock', 'Kingdom Holdings'], description: 'Colossus 2 compute buildout. Grok-4 in training.' },
  { company: 'Mistral AI', date: '2025-06-10', round: 'Series B', amountUsd: 640e6, valuationUsd: 6e9, sector: 'AI', leadInvestor: 'General Catalyst', investors: ['General Catalyst', 'Lightspeed', 'a16z'], description: 'Open-weight European frontier lab. Mixtral/Mistral model family.' },
  { company: 'Cohere', date: '2024-07-22', round: 'Series D', amountUsd: 500e6, valuationUsd: 5.5e9, sector: 'AI', leadInvestor: 'PSP Investments', investors: ['PSP Investments', 'Cisco', 'Fujitsu', 'Nvidia'], description: 'Enterprise LLM platform. Command R foundation model.' },
  { company: 'Perplexity', date: '2025-03-12', round: 'Series D', amountUsd: 500e6, valuationUsd: 9e9, sector: 'AI', leadInvestor: 'IVP', investors: ['IVP', 'NEA', 'Jeff Bezos', 'Nvidia'], description: 'Conversational AI search engine. Grows to 15M monthly users.' },
  { company: 'Safe Superintelligence', date: '2025-04-18', round: 'Seed', amountUsd: 1e9, valuationUsd: 5e9, sector: 'AI', leadInvestor: 'Sequoia', investors: ['Sequoia', 'a16z', 'DST', 'SV Angel', 'NFDG'], description: 'Ilya Sutskever new venture focused solely on superintelligence safety.' },
  { company: 'Harvey', date: '2025-02-05', round: 'Series C', amountUsd: 100e6, valuationUsd: 1.5e9, sector: 'SaaS', leadInvestor: 'GV', investors: ['GV', 'Kleiner Perkins', 'Sequoia'], description: 'Legal AI copilot built on GPT-4. Serves BigLaw.' },
  { company: 'Hugging Face', date: '2023-08-24', round: 'Series D', amountUsd: 235e6, valuationUsd: 4.5e9, sector: 'AI', leadInvestor: 'Salesforce Ventures', investors: ['Salesforce', 'Google', 'Nvidia', 'AMD', 'Intel'], description: 'Open-source AI platform. Model + dataset hub of record.' },
  { company: 'Scale AI', date: '2024-05-21', round: 'Series F', amountUsd: 1e9, valuationUsd: 13.8e9, sector: 'AI', leadInvestor: 'Accel', investors: ['Accel', 'Nvidia', 'Amazon', 'Meta'], description: 'Data labeling and eval infrastructure for frontier AI models.' },
  { company: 'Databricks', date: '2024-12-17', round: 'Series J', amountUsd: 10e9, valuationUsd: 62e9, sector: 'AI', leadInvestor: 'Thrive Capital', investors: ['Thrive', 'a16z', 'Tiger', 'Temasek', 'Wellington'], description: 'Data + AI platform. Acquired MosaicML. Largest software private round of 2024.' },
  { company: 'Figure AI', date: '2024-02-29', round: 'Series B', amountUsd: 675e6, valuationUsd: 2.6e9, sector: 'Robotics', leadInvestor: 'Microsoft', investors: ['Microsoft', 'OpenAI', 'Nvidia', 'Jeff Bezos'], description: 'Humanoid robot startup. Figure 02 released.' },
  { company: 'Physical Intelligence', date: '2024-11-04', round: 'Series A', amountUsd: 400e6, valuationUsd: 2.4e9, sector: 'Robotics', leadInvestor: 'Jeff Bezos', investors: ['Jeff Bezos', 'Thrive', 'Lux Capital'], description: 'Foundation model for general-purpose robotics.' },
  { company: 'Groq', date: '2024-08-05', round: 'Series D', amountUsd: 640e6, valuationUsd: 2.8e9, sector: 'AI', leadInvestor: 'BlackRock', investors: ['BlackRock', 'Neuberger Berman', 'Cisco', 'Samsung Catalyst'], description: 'LPU inference chips for LLMs. Ultra-low-latency serving.' },
  { company: 'CoreWeave', date: '2024-05-01', round: 'Series C', amountUsd: 1.1e9, valuationUsd: 19e9, sector: 'AI', leadInvestor: 'Coatue', investors: ['Coatue', 'Magnetar', 'Blackstone', 'Fidelity'], description: 'GPU cloud for AI training. Nvidia H100 hyperscaler.' },
  { company: 'Lambda', date: '2025-02-19', round: 'Series D', amountUsd: 480e6, valuationUsd: 2.5e9, sector: 'AI', leadInvestor: 'USIT', investors: ['USIT', 'Nvidia', 'ARK Invest', 'In-Q-Tel'], description: 'GPU cloud specialized for ML training workloads.' },
  { company: 'Celestial AI', date: '2024-03-27', round: 'Series C', amountUsd: 175e6, valuationUsd: 1.3e9, sector: 'AI', leadInvestor: 'Thomas Tull', investors: ['Thomas Tull', 'BlackRock', 'Fidelity'], description: 'Photonic interconnect fabric for AI accelerators.' },
  { company: 'Together AI', date: '2025-02-20', round: 'Series B', amountUsd: 305e6, valuationUsd: 3.3e9, sector: 'AI', leadInvestor: 'General Catalyst', investors: ['General Catalyst', 'Salesforce', 'Coatue', 'Lux'], description: 'Open-model inference cloud. Llama, Mixtral fine-tuning infrastructure.' },

  // Defence & Aerospace
  { company: 'Anduril', date: '2024-08-08', round: 'Series F', amountUsd: 1.5e9, valuationUsd: 14e9, sector: 'Defence', leadInvestor: 'Founders Fund', investors: ['Founders Fund', 'Sands Capital', 'Fidelity', 'Counterpoint'], description: 'Autonomous defense systems. Lattice OS for the Pentagon.' },
  { company: 'Shield AI', date: '2024-11-13', round: 'Series F', amountUsd: 300e6, valuationUsd: 5.3e9, sector: 'Defence', leadInvestor: 'Riot Ventures', investors: ['Riot Ventures', 'US Innovative Technology Fund', 'Hanwha'], description: 'Autonomous AI pilots for military aircraft. Hivemind stack.' },
  { company: 'Saronic', date: '2025-02-19', round: 'Series C', amountUsd: 600e6, valuationUsd: 4e9, sector: 'Defence', leadInvestor: 'Elad Gil', investors: ['Elad Gil', 'Andreessen Horowitz', 'General Catalyst'], description: 'Unmanned surface vessels for naval operations.' },
  { company: 'Helsing', date: '2025-06-30', round: 'Series D', amountUsd: 487e6, valuationUsd: 5.4e9, sector: 'Defence', leadInvestor: 'Prima Materia', investors: ['Prima Materia', 'General Catalyst', 'Lightspeed'], description: 'European defence AI. Frontline battlefield intelligence software.' },

  // Fintech
  { company: 'Stripe', date: '2025-02-27', round: 'Tender Offer', amountUsd: 694e6, valuationUsd: 91.5e9, sector: 'Fintech', leadInvestor: 'Sequoia', investors: ['Sequoia', 'a16z', 'GC'], description: 'Payments infrastructure. Secondary tender offer valuing Stripe at $91.5B.' },
  { company: 'Ramp', date: '2025-03-25', round: 'Series D Ext', amountUsd: 150e6, valuationUsd: 13e9, sector: 'Fintech', leadInvestor: 'Founders Fund', investors: ['Founders Fund', 'Thrive', 'Khosla', 'General Catalyst'], description: 'Corporate spend + AP automation. Fastest-growing US B2B SaaS.' },
  { company: 'Rippling', date: '2024-04-02', round: 'Series F', amountUsd: 200e6, valuationUsd: 13.5e9, sector: 'Fintech', leadInvestor: 'Coatue', investors: ['Coatue', 'Founders Fund', 'Greenoaks', 'Sequoia'], description: 'Workforce management + global payroll + device management.' },
  { company: 'Plaid', date: '2025-04-09', round: 'Common Stock', amountUsd: 575e6, valuationUsd: 6.1e9, sector: 'Fintech', leadInvestor: 'Franklin Templeton', investors: ['Franklin Templeton', 'Fidelity', 'BlackRock', 'NEA'], description: 'Financial data API. Secondary round ahead of anticipated IPO.' },
  { company: 'Revolut', date: '2024-08-16', round: 'Secondary', amountUsd: 500e6, valuationUsd: 45e9, sector: 'Fintech', leadInvestor: 'Coatue', investors: ['Coatue', 'D1 Capital', 'Tiger'], description: 'UK neobank. Employee tender offer at $45B valuation.' },

  // Crypto
  { company: 'Kraken', date: '2025-03-18', round: 'Pre-IPO', amountUsd: 100e6, valuationUsd: 15e9, sector: 'Crypto', leadInvestor: 'Undisclosed', investors: ['Undisclosed'], description: 'US crypto exchange preparing for 2026 IPO listing.' },
  { company: 'Monad', date: '2024-04-09', round: 'Series A', amountUsd: 225e6, valuationUsd: 3e9, sector: 'Crypto', leadInvestor: 'Paradigm', investors: ['Paradigm', 'Electric Capital', 'Greenoaks'], description: 'EVM-compatible L1 with parallel execution.' },
  { company: 'Berachain', date: '2024-04-11', round: 'Series B', amountUsd: 100e6, valuationUsd: 1.5e9, sector: 'Crypto', leadInvestor: 'Framework Ventures', investors: ['Framework', 'Brevan Howard Digital'], description: 'Proof-of-liquidity L1 with native DeFi primitives.' },
  { company: 'EigenLayer', date: '2024-02-22', round: 'Series B', amountUsd: 100e6, valuationUsd: 1e9, sector: 'Crypto', leadInvestor: 'a16z Crypto', investors: ['a16z Crypto', 'Electric Capital'], description: 'Ethereum restaking protocol. AVS architecture.' },
  { company: 'Farcaster', date: '2024-05-21', round: 'Series A', amountUsd: 150e6, valuationUsd: 1e9, sector: 'Crypto', leadInvestor: 'Paradigm', investors: ['Paradigm', 'a16z', 'Electric Capital'], description: 'Decentralized social protocol. Frames + mini-apps ecosystem.' },

  // Space & Climate
  { company: 'SpaceX', date: '2024-12-11', round: 'Tender Offer', amountUsd: 1.25e9, valuationUsd: 350e9, sector: 'Space', leadInvestor: 'Internal/Employees', investors: ['Founders Fund', 'a16z', 'Sequoia'], description: 'Starship + Starlink. Secondary tender at $350B valuation.' },
  { company: 'Impulse Space', date: '2024-10-28', round: 'Series B', amountUsd: 150e6, valuationUsd: 1e9, sector: 'Space', leadInvestor: 'Founders Fund', investors: ['Founders Fund', 'DCVC', 'Lux'], description: 'In-space transportation. Mira orbital vehicle.' },
  { company: 'Stoke Space', date: '2024-10-16', round: 'Series B', amountUsd: 100e6, valuationUsd: 530e6, sector: 'Space', leadInvestor: 'Industrious Ventures', investors: ['Industrious', 'Y Combinator', 'Point72'], description: 'Fully reusable medium-lift launch vehicle.' },
  { company: 'Commonwealth Fusion', date: '2024-12-02', round: 'Series B Ext', amountUsd: 863e6, valuationUsd: 7e9, sector: 'Climate', leadInvestor: 'Breakthrough Energy Ventures', investors: ['Breakthrough Energy', 'Google', 'Eni'], description: 'SPARC tokamak fusion reactor, targeting net energy 2027.' },

  // Healthcare/BioTech
  { company: 'Xaira Therapeutics', date: '2024-04-23', round: 'Series A', amountUsd: 1e9, valuationUsd: 3e9, sector: 'BioTech', leadInvestor: 'ARCH Venture Partners', investors: ['ARCH', 'Foresite Labs', 'Nvidia'], description: 'AI-native drug discovery. Foundation models for protein design.' },
  { company: 'Isomorphic Labs', date: '2025-03-31', round: 'Series A', amountUsd: 600e6, valuationUsd: 3e9, sector: 'BioTech', leadInvestor: 'Thrive Capital', investors: ['Thrive', 'Alphabet', 'GV'], description: 'AlphaFold-based drug discovery spin-out from DeepMind.' },

  // Consumer/Other
  { company: 'Canva', date: '2025-09-15', round: 'Secondary', amountUsd: 1.6e9, valuationUsd: 32e9, sector: 'SaaS', leadInvestor: 'Internal', investors: ['ICONIQ', 'Sequoia', 'Bessemer'], description: 'Design platform. Secondary tender offer at $32B valuation.' },
  { company: 'Glean', date: '2025-01-15', round: 'Series F', amountUsd: 260e6, valuationUsd: 7.2e9, sector: 'SaaS', leadInvestor: 'Kleiner Perkins', investors: ['Kleiner Perkins', 'ICONIQ', 'Sequoia', 'Lightspeed'], description: 'Enterprise AI search and knowledge work assistant.' },
];

function normalizeSeedToDeal(row) {
  const date = new Date(row.date).toISOString();
  const headline = `${row.company} raises ${formatAmountShort(row.amountUsd)} ${row.round}${row.leadInvestor ? `, led by ${row.leadInvestor}` : ''}`;
  return {
    id: `curated-${row.company.toLowerCase().replace(/[^a-z0-9]/g, '')}-${row.date}`,
    company: row.company,
    logoUrl: logoForCompany(row.company),
    domain: COMPANY_DOMAINS[row.company] || null,
    roundType: row.round,
    amountUsd: row.amountUsd,
    valuationUsd: row.valuationUsd,
    sector: row.sector,
    category: row.sector,
    leadInvestor: row.leadInvestor,
    leadInvestors: row.investors || [],
    otherInvestors: [],
    chains: [],
    date,
    headline,
    description: row.description,
    sourceBadge: 'Spectre Curated',
    link: null,
  };
}
function formatAmountShort(usd) {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 10e9 ? 0 : 1)}B`;
  if (usd >= 1e6) return `$${Math.round(usd / 1e6)}M`;
  return `$${usd}`;
}

const UNICORN_SEED = [
  { company: 'SpaceX', valuation: 350e9, sector: 'Space', country: 'US', dateJoined: '2012-12-01', investors: ['Founders Fund', 'a16z'] },
  { company: 'OpenAI', valuation: 157e9, sector: 'AI', country: 'US', dateJoined: '2019-03-01', investors: ['Microsoft', 'Thrive'] },
  { company: 'ByteDance', valuation: 220e9, sector: 'Consumer', country: 'CN', dateJoined: '2017-04-01', investors: ['Sequoia China', 'Softbank'] },
  { company: 'Anthropic', valuation: 40e9, sector: 'AI', country: 'US', dateJoined: '2023-05-01', investors: ['Google', 'Spark Capital'] },
  { company: 'xAI', valuation: 50e9, sector: 'AI', country: 'US', dateJoined: '2024-05-01', investors: ['Valor', 'Sequoia'] },
  { company: 'Stripe', valuation: 70e9, sector: 'Fintech', country: 'US', dateJoined: '2014-01-01', investors: ['Sequoia', 'a16z'] },
  { company: 'Databricks', valuation: 62e9, sector: 'AI', country: 'US', dateJoined: '2019-02-01', investors: ['a16z', 'Tiger'] },
  { company: 'Canva', valuation: 32e9, sector: 'SaaS', country: 'AU', dateJoined: '2018-01-01', investors: ['Sequoia', 'Bessemer'] },
  { company: 'Revolut', valuation: 45e9, sector: 'Fintech', country: 'UK', dateJoined: '2018-04-01', investors: ['Softbank', 'Tiger'] },
  { company: 'Epic Games', valuation: 31.5e9, sector: 'Gaming', country: 'US', dateJoined: '2018-10-01', investors: ['Tencent', 'KKR'] },
  { company: 'Fanatics', valuation: 31e9, sector: 'Commerce', country: 'US', dateJoined: '2017-08-01', investors: ['Softbank', 'Silver Lake'] },
  { company: 'Chime', valuation: 25e9, sector: 'Fintech', country: 'US', dateJoined: '2019-03-01', investors: ['DST', 'Tiger'] },
  { company: 'Shein', valuation: 66e9, sector: 'Commerce', country: 'CN', dateJoined: '2020-08-01', investors: ['Tiger', 'General Atlantic'] },
  { company: 'Discord', valuation: 15e9, sector: 'Consumer', country: 'US', dateJoined: '2018-12-01', investors: ['Benchmark', 'Index'] },
  { company: 'Scale AI', valuation: 14e9, sector: 'AI', country: 'US', dateJoined: '2019-08-01', investors: ['Tiger', 'a16z'] },
  { company: 'Celonis', valuation: 13e9, sector: 'SaaS', country: 'DE', dateJoined: '2018-06-01', investors: ['Accel', 'Franklin Templeton'] },
  { company: 'Anduril', valuation: 14e9, sector: 'Defence', country: 'US', dateJoined: '2019-09-01', investors: ['Founders Fund', 'a16z'] },
  { company: 'Perplexity', valuation: 9e9, sector: 'AI', country: 'US', dateJoined: '2024-01-01', investors: ['IVP', 'NEA'] },
];
function unicornTier(valuation) {
  if (valuation >= 100e9) return 'Hectocorn';
  if (valuation >= 10e9) return 'Decacorn';
  return 'Unicorn';
}

// ─── High-level data getters (return { status, body }) ──────────────────────
async function getLlamaRaises() {
  const data = await fetchLlamaRaises();
  return { status: 200, body: { data, source: 'defillama' } };
}
async function getSecFilingsResponse() {
  const data = await fetchSecFilings();
  return { status: 200, body: { data, source: 'sec-edgar' } };
}
async function getFundingNewsResponse() {
  const data = await fetchFundingNews();
  return { status: 200, body: { data, source: 'rss' } };
}

async function getDeals(query = {}) {
  try {
    // Default window is "all time" — the Spectre fundraising pipeline goes back
    // ~3y. Frontend filters by age on top. Capped at 3650 days (10y) to keep
    // the cache key bounded.
    const days = Math.max(1, Math.min(3650, parseInt(query.days, 10) || 3650));
    const cacheKey = `deals:v2:${days}`;
    const cached = getCached(dealsCache, cacheKey);
    if (cached) {
      return {
        status: 200,
        body: {
          data: cached.data,
          cached: true,
          total: cached.data.length,
          totalRaised: cached.data.reduce((s, d) => s + (d.amountUsd || 0), 0),
          sources: ['Spectre Fundraising', 'Spectre Curated', 'DeFiLlama', 'TechCrunch', 'Crunchbase News', 'Bloomberg Technology'],
          counts: cached.counts,
        },
      };
    }

    // DeFiLlama /raises moved to a paid plan in early 2026 — every call from
    // this endpoint returned 402 and contributed nothing to the deal feed.
    // fetchLlamaRaises() is still exported for getValuationHistory but is no
    // longer in the hot path here. Saves ~80-220 ms on every cold /deals call.
    //
    // RSS funding news is now read out-of-band from rssCache instead of being
    // awaited inline. Cold-path latency drops from max(spectre 340 ms, RSS
    // ~640 ms) to just spectre. We fire-and-forget fetchFundingNews() so the
    // cache warms for the next call; on the very first invocation news will
    // be [] for one request, then populated thereafter. fetchFundingNews has
    // its own internal cache short-circuit, so this is a noop when warm.
    const [spectreRes] = await Promise.allSettled([
      fetchSpectreFundraising(),
    ]);
    // Background warm — never awaited. Errors swallowed; the function logs
    // failures internally and falls back to its own cache.
    Promise.resolve().then(() => fetchFundingNews()).catch(() => {});

    const spectre = spectreRes.status === 'fulfilled' ? spectreRes.value : [];
    const llama = [];
    const news = getCached(rssCache, 'rss:funding:all') || [];

    const curated = CURATED_RAISES_SEED.map(normalizeSeedToDeal);

    const deals = [];

    // Spectre realtime first — these are the freshest signals.
    for (const item of spectre) deals.push(item);

    for (const item of curated) deals.push(item);

    for (const item of llama) {
      deals.push({
        id: item.id,
        company: item.company,
        logoUrl: logoForCompany(item.company),
        roundType: item.roundType,
        amountUsd: item.amountUsd,
        valuationUsd: item.valuationUsd,
        sector: item.sector,
        category: item.category,
        leadInvestor: item.leadInvestor,
        leadInvestors: item.leadInvestors,
        otherInvestors: item.otherInvestors,
        chains: item.chains,
        date: item.date,
        headline: item.headline,
        description: item.description,
        sourceBadge: 'DeFiLlama',
        link: item.link,
      });
    }

    for (const item of news) {
      deals.push({
        id: item.id,
        company: item.company || 'Unknown',
        logoUrl: item.logoUrl || logoForCompany(item.company),
        roundType: item.roundType || null,
        amountUsd: item.amountUsd || null,
        valuationUsd: null,
        sector: item.sector || 'Other',
        leadInvestor: null,
        date: item.publishedAt || null,
        headline: item.headline,
        description: item.description,
        sourceBadge: item.source,
        link: item.link,
      });
    }

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const windowed = deals
      .filter((d) => {
        if (!d.date) return false;
        if (!(d.amountUsd > 0)) return false;
        const t = Date.parse(d.date);
        return Number.isFinite(t) && t >= cutoff;
      })
      // BEFORE the dedupe, not after: the key below is the company slug, so a
      // headline fragment and the name it wraps only collapse into one round if
      // they have already been reduced to the same name.
      .map((d) => {
        const company = cleanCompanyName(d.company);
        return company === d.company ? d : { ...d, company };
      });

    // Dedupe by company + month — keep the first occurrence, which is the
    // higher-priority source (Spectre first, then curated, then llama, then RSS).
    const SOURCE_PRIORITY = { Spectre: 0, 'Spectre Curated': 1, DeFiLlama: 2 };
    const seen = new Map(); // key -> index in result array
    const deduped = [];
    for (const d of windowed) {
      const month = d.date ? Math.floor(Date.parse(d.date) / (1000 * 60 * 60 * 24 * 30)) : 0;
      const key = `${(d.company || '').toLowerCase().replace(/[^a-z0-9]/g, '')}:${month}`;
      if (!key) continue;
      const existingIdx = seen.get(key);
      if (existingIdx == null) {
        seen.set(key, deduped.length);
        deduped.push(d);
        continue;
      }
      // Replace if the incoming source is higher priority (lower number).
      const existing = deduped[existingIdx];
      const oldPri = SOURCE_PRIORITY[existing.sourceBadge] ?? 9;
      const newPri = SOURCE_PRIORITY[d.sourceBadge] ?? 9;
      if (newPri < oldPri) deduped[existingIdx] = d;
    }

    // Second pass: the key above is company-slug + month, so one round spelled
    // two ways survives as two deals. Collapse on amount + day + a name that
    // contains the other. See mergeSameRound.
    const merged = mergeSameRound(deduped);

    // Sort: most recent first. Tier-by-source is no longer needed because
    // Spectre rows already carry round type + amount.
    merged.sort((a, b) => {
      const da = a.date ? Date.parse(a.date) : 0;
      const db = b.date ? Date.parse(b.date) : 0;
      return db - da;
    });

    const counts = { spectre: spectre.length, curated: curated.length, llama: llama.length, rss: news.length };
    setCached(dealsCache, cacheKey, { data: merged, counts }, DEALS_TTL);
    return {
      status: 200,
      body: {
        data: merged,
        cached: false,
        total: merged.length,
        totalRaised: merged.reduce((s, d) => s + (d.amountUsd || 0), 0),
        sources: ['Spectre Fundraising', 'Spectre Curated', 'DeFiLlama', 'TechCrunch', 'Crunchbase News', 'Bloomberg Technology'],
        counts,
      },
    };
  } catch (err) {
    console.error('[private-markets] /deals error:', err.message);
    return { status: 200, body: { data: [], error: err.message } };
  }
}

async function getStats() {
  try {
    const stats = await fetchSpectreStats();
    return { status: 200, body: { data: stats || null } };
  } catch (err) {
    return { status: 200, body: { data: null, error: err.message } };
  }
}

async function getValuationHistory(rawNameInput) {
  try {
    const rawName = String(rawNameInput || '').trim();
    if (!rawName) return { status: 400, body: { error: 'company required' } };

    const cacheKey = `valuation:${rawName.toLowerCase()}`;
    const cached = getCached(valuationCache, cacheKey);
    if (cached) return { status: 200, body: { data: cached, cached: true } };

    const [llama] = await Promise.all([fetchLlamaRaises()]);
    const needle = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchCompany = (name) => {
      const norm = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return norm === needle;
    };

    const fromLlama = llama.filter((r) => matchCompany(r.company)).map((r) => ({
      date: r.date,
      roundType: r.roundType,
      amountUsd: r.amountUsd,
      valuationUsd: r.valuationUsd,
      leadInvestor: r.leadInvestor,
      source: r.link,
      origin: 'defillama',
    }));
    const fromCurated = CURATED_RAISES_SEED.filter((r) => matchCompany(r.company)).map((r) => ({
      date: new Date(r.date).toISOString(),
      roundType: r.round,
      amountUsd: r.amountUsd,
      valuationUsd: r.valuationUsd,
      leadInvestor: r.leadInvestor,
      source: null,
      origin: 'curated',
    }));

    const seen = new Set();
    const rounds = [...fromCurated, ...fromLlama]
      .filter((r) => {
        const key = `${r.date.slice(0, 10)}:${r.roundType || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    const response = {
      company: rawName,
      rounds,
      totalRaised: rounds.reduce((s, r) => s + (r.amountUsd || 0), 0),
      latestValuation: rounds.filter((r) => r.valuationUsd).slice(-1)[0]?.valuationUsd || null,
      firstRound: rounds[0]?.date || null,
      lastRound: rounds[rounds.length - 1]?.date || null,
    };

    setCached(valuationCache, cacheKey, response, VALUATION_TTL);
    return { status: 200, body: { data: response, cached: false } };
  } catch (err) {
    console.error('[private-markets] /valuation-history error:', err.message);
    return { status: 200, body: { data: null, error: err.message } };
  }
}

const CRUNCHBASE_KEY = process.env.CRUNCHBASE_KEY || '';
async function getCompany(slug) {
  if (!slug) return { status: 400, body: { error: 'slug required' } };

  try {
    const cacheKey = `cb:${slug}`;
    const cached = getCached(companyCache, cacheKey);
    if (cached) return { status: 200, body: { data: cached, cached: true } };

    if (!CRUNCHBASE_KEY) {
      return {
        status: 200,
        body: {
          data: null,
          source: 'crunchbase',
          error: 'CRUNCHBASE_KEY not configured — using RSS fallback',
        },
      };
    }

    const fieldIds = [
      'short_description',
      'founded_on',
      'funding_total',
      'last_funding_type',
      'last_funding_at',
      'investor_identifiers',
      'num_funding_rounds',
      'valuation',
      'website_url',
      'image_url',
      'categories',
      'headquarters_address',
    ].join(',');

    const url = `https://api.crunchbase.com/api/v4/entities/organizations/${encodeURIComponent(slug)}?user_key=${CRUNCHBASE_KEY}&field_ids=${fieldIds}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const apiRes = await fetch(url, { signal: ctrl.signal }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
    clearTimeout(timer);

    if (!apiRes.ok) {
      const stale = companyCache.get(cacheKey);
      return {
        status: 200,
        body: {
          data: stale?.data || null,
          source: 'crunchbase',
          error: `cb-${apiRes.status}`,
        },
      };
    }

    const json = await apiRes.json();
    const props = json?.properties || {};
    const company = {
      slug,
      name: props.name || slug,
      description: props.short_description || null,
      foundedOn: props.founded_on?.value || null,
      websiteUrl: props.website_url?.value || null,
      imageUrl: props.image_url || null,
      fundingTotalUsd: props.funding_total?.value_usd || null,
      lastFundingType: props.last_funding_type || null,
      lastFundingAt: props.last_funding_at || null,
      numFundingRounds: props.num_funding_rounds || null,
      investors: Array.isArray(props.investor_identifiers)
        ? props.investor_identifiers.map((i) => i.value || i).filter(Boolean)
        : [],
      valuationUsd: props.valuation?.value_usd || null,
      categories: Array.isArray(props.categories) ? props.categories.map((c) => c.value || c) : [],
      headquarters: props.headquarters_address?.[0]?.value || null,
    };

    setCached(companyCache, cacheKey, company, COMPANY_TTL);
    return { status: 200, body: { data: company, cached: false } };
  } catch (err) {
    console.error('[private-markets] /companies error:', err.message);
    return { status: 200, body: { data: null, error: err.message } };
  }
}

async function getUnicorns() {
  try {
    const cacheKey = 'unicorns:all';
    const cached = getCached(unicornCache, cacheKey);
    if (cached) return { status: 200, body: { data: cached, source: 'curated', cached: true } };

    const enriched = UNICORN_SEED.map((u) => ({
      ...u,
      logoUrl: logoForCompany(u.company),
      tier: unicornTier(u.valuation),
    }));

    enriched.sort((a, b) => (b.valuation || 0) - (a.valuation || 0));

    setCached(unicornCache, cacheKey, enriched, UNICORN_TTL);
    return { status: 200, body: { data: enriched, source: 'curated', cached: false } };
  } catch (err) {
    console.error('[private-markets] /unicorns error:', err.message);
    return { status: 200, body: { data: [], error: err.message } };
  }
}

const preipoCache = makeCache();
const PREIPO_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Build the Pre-IPO roster from the curated raise history + unicorn board.
 *
 * The curated VALUATION/raise seed carries multiple rounds per company. We
 * collapse each company to one roster entry:
 *   - currentValuation  = latest round that carries a valuation
 *   - firstValuation    = earliest round that carries a valuation
 *   - valuationMultiple  = current / first (how much it appreciated privately)
 *   - totalRaised        = sum of all round amounts
 *   - investors          = union across rounds, latest-first, "Undisclosed" dropped
 *   - valuationSeries    = [{date, valuationUsd, roundType}] for the card sparkline
 * Unicorn-board companies with no detailed raise history (ByteDance, Shein,
 * Discord, …) are merged in as single-point entries so the roster is complete.
 * Sorted by current valuation descending.
 */
function buildPreIPORoster() {
  const byCompany = new Map();
  for (const r of CURATED_RAISES_SEED) {
    if (!byCompany.has(r.company)) byCompany.set(r.company, []);
    byCompany.get(r.company).push(r);
  }

  const roster = [];
  for (const [company, rawRounds] of byCompany.entries()) {
    const rounds = rawRounds
      .slice()
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const latest = rounds[rounds.length - 1];
    const valued = rounds.filter((r) => Number.isFinite(r.valuationUsd) && r.valuationUsd > 0);
    const currentValuation = valued.length ? valued[valued.length - 1].valuationUsd : null;
    const firstValuation = valued.length ? valued[0].valuationUsd : null;
    const valuationMultiple =
      currentValuation && firstValuation && firstValuation > 0
        ? currentValuation / firstValuation
        : null;
    const totalRaised = rounds.reduce((s, r) => s + (r.amountUsd || 0), 0);

    // Union investors, latest round first, dropping the "Undisclosed" filler.
    const investors = [];
    for (let i = rounds.length - 1; i >= 0; i--) {
      for (const inv of rounds[i].investors || []) {
        if (inv && inv !== 'Undisclosed' && !investors.includes(inv)) investors.push(inv);
      }
    }

    const valuationSeries = valued.map((r) => ({
      date: new Date(r.date).toISOString(),
      valuationUsd: r.valuationUsd,
      amountUsd: r.amountUsd,
      roundType: r.round,
    }));

    roster.push({
      company,
      domain: COMPANY_DOMAINS[company] || null,
      logoUrl: logoForCompany(company),
      sector: latest.sector,
      currentValuation,
      firstValuation,
      valuationMultiple,
      totalRaised,
      roundCount: rounds.length,
      lastRound: latest.round,
      lastRoundDate: new Date(latest.date).toISOString(),
      lastRoundAmount: latest.amountUsd,
      leadInvestor: latest.leadInvestor || null,
      investors: investors.slice(0, 14),
      description: latest.description || null,
      valuationSeries,
      tier: currentValuation != null ? unicornTier(currentValuation) : null,
      source: 'curated-raises',
    });
  }

  // Merge unicorn-board companies that have no detailed raise history.
  const have = new Set(roster.map((r) => r.company.toLowerCase()));
  for (const u of UNICORN_SEED) {
    if (have.has(u.company.toLowerCase())) continue;
    roster.push({
      company: u.company,
      domain: COMPANY_DOMAINS[u.company] || null,
      logoUrl: logoForCompany(u.company),
      sector: u.sector,
      currentValuation: u.valuation,
      firstValuation: null,
      valuationMultiple: null,
      totalRaised: null,
      roundCount: null,
      lastRound: null,
      lastRoundDate: u.dateJoined ? new Date(u.dateJoined).toISOString() : null,
      lastRoundAmount: null,
      leadInvestor: null,
      investors: (u.investors || []).filter((i) => i && i !== 'Undisclosed').slice(0, 14),
      description: null,
      country: u.country || null,
      valuationSeries: [],
      tier: unicornTier(u.valuation),
      source: 'curated-unicorn',
    });
  }

  roster.sort((a, b) => (b.currentValuation || 0) - (a.currentValuation || 0));
  return roster;
}

async function getPreIPO() {
  try {
    const cacheKey = 'preipo:all';
    const cached = getCached(preipoCache, cacheKey);
    if (cached) {
      return { status: 200, body: { data: cached.roster, summary: cached.summary, source: 'curated', cached: true } };
    }

    const roster = buildPreIPORoster();
    const summary = {
      count: roster.length,
      totalValuation: roster.reduce((s, r) => s + (r.currentValuation || 0), 0),
      sectors: [...new Set(roster.map((r) => r.sector).filter(Boolean))].sort(),
      decacorns: roster.filter((r) => (r.currentValuation || 0) >= 10e9).length,
      hectocorns: roster.filter((r) => (r.currentValuation || 0) >= 100e9).length,
    };

    setCached(preipoCache, cacheKey, { roster, summary }, PREIPO_TTL);
    return { status: 200, body: { data: roster, summary, source: 'curated', cached: false } };
  } catch (err) {
    console.error('[private-markets] /preipo error:', err.message);
    return { status: 200, body: { data: [], summary: null, error: err.message } };
  }
}

async function getSectorHeatmap() {
  try {
    const [llama, news] = await Promise.all([fetchLlamaRaises(), fetchFundingNews()]);
    const buckets = {};
    const now = Date.now();
    const quarter = 90 * 24 * 60 * 60 * 1000;

    const bump = (item, dateField) => {
      const sector = item.sector || 'Other';
      if (!buckets[sector]) {
        buckets[sector] = { sector, totalDeployed: 0, rounds: 0, largestRound: 0, largestCompany: null };
      }
      const ts = item[dateField] ? Date.parse(item[dateField]) : NaN;
      if (!Number.isFinite(ts) || now - ts > quarter) return;
      buckets[sector].rounds += 1;
      if (item.amountUsd) {
        buckets[sector].totalDeployed += item.amountUsd;
        if (item.amountUsd > buckets[sector].largestRound) {
          buckets[sector].largestRound = item.amountUsd;
          buckets[sector].largestCompany = item.company;
        }
      }
    };

    for (const item of llama) bump(item, 'date');
    for (const item of news) bump(item, 'publishedAt');

    const rows = Object.values(buckets).sort((a, b) => b.totalDeployed - a.totalDeployed);
    return { status: 200, body: { data: rows } };
  } catch (err) {
    console.error('[private-markets] /sector-heatmap error:', err.message);
    return { status: 200, body: { data: [], error: err.message } };
  }
}

/**
 * Transport-agnostic dispatcher. `sub` is the path after /api/private/
 * (e.g. 'deals', 'valuation-history/Anthropic', 'companies/openai'). `query`
 * is the parsed query string. Returns { status, body }.
 */
async function handlePrivateMarketsRoute(sub, query = {}) {
  const clean = String(sub || '').replace(/^\/+|\/+$/g, '');
  const segments = clean.split('/').filter(Boolean);
  const resource = segments[0] || '';

  switch (resource) {
    case '':
    case 'deals':
      return getDeals(query);
    case 'llama-raises':
      return getLlamaRaises();
    case 'sec-filings':
      return getSecFilingsResponse();
    case 'funding-news':
      return getFundingNewsResponse();
    case 'valuation-history':
      return getValuationHistory(decodeURIComponent(segments.slice(1).join('/')));
    case 'companies':
      return getCompany(decodeURIComponent(segments.slice(1).join('/')));
    case 'unicorns':
      return getUnicorns();
    case 'preipo':
    case 'pre-ipo':
      return getPreIPO();
    case 'sector-heatmap':
      return getSectorHeatmap();
    case 'stats':
      return getStats();
    default:
      return { status: 404, body: { error: `unknown private-markets route: ${resource}` } };
  }
}

module.exports = {
  handlePrivateMarketsRoute,
  // Individual getters exposed for the thin Express wrapper.
  getDeals,
  getStats,
  getLlamaRaises,
  getSecFilingsResponse,
  getFundingNewsResponse,
  getValuationHistory,
  getCompany,
  getUnicorns,
  getPreIPO,
  getSectorHeatmap,
  // Exported for apps/research/tests/privateMarketsFeed.test.js — the two rules
  // that decide what a card is called and whether two rows are one round.
  cleanCompanyName,
  mergeSameRound,
};
