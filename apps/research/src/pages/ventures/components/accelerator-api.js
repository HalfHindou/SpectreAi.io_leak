/**
 * Accelerator API service — YC crypto feed.
 *
 * YC data routes through the Spectre server at /api/accelerators/yc
 * (backed by packages/server/routes/accelerators.js in dev, mirrored in
 * apps/research/api/_lib/handlers/extended-proxy.js in prod). The server
 * route caches the upstream yc-oss data for 6h and normalizes the shape.
 *
 * All functions return { companies, total, sources, batches } or [] on
 * failure. Never throws.
 */

// Primary: server-proxied endpoint (fast, cached, reliable)
const YC_SERVER_ENDPOINT = '/api/accelerators/yc?crypto=true'
// Fallback: direct github pages URL, for when the server is unreachable
const YC_DIRECT_FALLBACK = 'https://yc-oss.github.io/api/companies/all.json'
const CACHE_KEY = 'spectre:accelerators:yc:v2'
const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

const CRYPTO_TAG_MATCHERS = [
  'crypto',
  'web3',
  'blockchain',
  'defi',
  'nft',
  'stablecoin',
  'bitcoin',
  'ethereum',
  'cryptocurrency',
  'digital assets',
  'smart contracts',
  'dao',
]

function isCryptoYC(company) {
  const tags = (company.tags || []).map((t) => String(t).toLowerCase())
  const industry = String(company.subindustry || company.industry || '').toLowerCase()
  if (tags.some((t) => CRYPTO_TAG_MATCHERS.some((m) => t.includes(m)))) return true
  if (industry.includes('crypto') || industry.includes('blockchain') || industry.includes('web3')) return true
  return false
}

function normalizeYC(company) {
  return {
    id: `yc-${company.id}`,
    source: 'YC',
    name: company.name,
    slug: company.slug,
    website: company.website,
    logo: company.small_logo_thumb_url || null,
    one_liner: company.one_liner,
    long_description: company.long_description,
    batch: company.batch,
    status: company.status,
    industry: company.industry,
    subindustry: company.subindustry,
    tags: company.tags || [],
    team_size: company.team_size,
    top_company: !!company.top_company,
    stage: company.stage,
    url: company.url || (company.slug ? `https://www.ycombinator.com/companies/${company.slug}` : null),
    is_crypto: isCryptoYC(company),
  }
}

// Cache helpers ─────────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.ts || !Array.isArray(parsed.data)) return null
    if (Date.now() - parsed.ts > CACHE_TTL) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // Storage full or disabled — fail silently.
  }
}

// Public API ────────────────────────────────────────────────────────────────

// Normalize the server-side /api/accelerators/yc shape back into the
// original client shape used by the existing Ventures UI. The server
// uses camelCase (oneLiner, logoUrl, topCompany), the Ventures page
// expects snake_case (one_liner, logo, top_company) — we remap here
// so no downstream JSX needs to change.
function adaptServerCompany(c) {
  return {
    id: c.id,
    source: 'YC',
    name: c.name,
    slug: c.slug,
    website: c.website,
    logo: c.logoUrl || null,
    one_liner: c.oneLiner,
    long_description: c.longDescription,
    batch: c.batch,
    status: c.status,
    industry: c.industry,
    subindustry: c.subindustry,
    tags: Array.isArray(c.tags) ? c.tags : [],
    team_size: c.teamSize,
    top_company: !!c.topCompany,
    stage: c.stage,
    url: c.url || (c.slug ? `https://www.ycombinator.com/companies/${c.slug}` : null),
    is_crypto: !!c.isCrypto,
  }
}

/**
 * Fetch YC crypto companies via the Spectre server proxy. Falls back to the
 * direct github pages JSON if the server endpoint isn't reachable (e.g. prod
 * without serverless function parity yet).
 */
export async function getYCCryptoCompanies() {
  const cached = readCache()
  if (cached) return cached

  // Try 1: server-proxied endpoint — fast, cached, normalized
  try {
    const res = await fetch(YC_SERVER_ENDPOINT, { signal: AbortSignal.timeout(15000) })
    if (res.ok) {
      const json = await res.json()
      const arr = Array.isArray(json?.data) ? json.data : null
      if (arr && arr.length > 0) {
        const mapped = arr.map(adaptServerCompany)
        writeCache(mapped)
        return mapped
      }
    }
  } catch {
    // swallow, try direct fallback
  }

  // Try 2: direct github pages JSON (legacy path)
  try {
    const res = await fetch(YC_DIRECT_FALLBACK, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`YC direct ${res.status}`)
    const all = await res.json()
    if (!Array.isArray(all)) throw new Error('YC direct: unexpected shape')
    const crypto = all.filter(isCryptoYC).map(normalizeYC)
    writeCache(crypto)
    return crypto
  } catch {
    return []
  }
}

/**
 * Accelerator feed — YC crypto only.
 * Sort: top_company → newest batch → rest.
 */
export async function getUnifiedAcceleratorFeed() {
  const yc = await getYCCryptoCompanies()

  // YC batches are strings like "Winter 2024" or "W24" — we sort descending
  // by a derived numeric key so Winter 2026 > Summer 2025 > Winter 2025 etc.
  const batchKey = (batch) => {
    if (!batch) return 0
    const m = String(batch).match(/(\d{4})/)
    const year = m ? parseInt(m[1], 10) : 0
    const seasonBump = /winter|^w/i.test(batch) ? 0.1 : 0
    return year + seasonBump
  }

  const sorted = yc.slice().sort((a, b) => {
    if (a.top_company && !b.top_company) return -1
    if (!a.top_company && b.top_company) return 1
    return batchKey(b.batch) - batchKey(a.batch)
  })

  const batches = [...new Set(sorted.map((c) => c.batch).filter(Boolean))]
    .sort((a, b) => batchKey(b) - batchKey(a))

  return {
    total: sorted.length,
    sources: { yc: sorted.length },
    batches,
    companies: sorted,
  }
}
