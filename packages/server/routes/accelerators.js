/**
 * Spectre Accelerators — YC + Hub71 + unified feed
 *
 *   GET /api/accelerators/yc     — Y Combinator companies (5,690 total, free, daily-updated)
 *   GET /api/accelerators/hub71  — Hub71 Abu Dhabi (curated seed; Mubadala-backed)
 *   GET /api/accelerators/all    — merged feed with filters
 *
 * YC source: yc-oss.github.io/api/companies/all.json — unofficial but authoritative.
 * GitHub Actions rebuilds daily from the official YC website's Algolia index.
 * Shape: { id, name, slug, small_logo_thumb_url, website, one_liner, long_description,
 *          batch, status, industry, subindustry, tags, team_size, top_company, ... }
 *
 * Hub71 is JS-rendered and has no public API. Phase 1 ships a curated crypto-
 * focused seed from their Hub71+ Digital Assets program. Phase 2 can layer a
 * Puppeteer scraper if we want full coverage.
 *
 * All endpoints return `{ data, source, cached }` and NEVER throw.
 */
const express = require('express');
const path = require('path');
const router = express.Router();
const fetch = require('node-fetch');

// Load the curated Hub71 JSON that the Ventures UI also bundles, so both
// the Ventures Accelerator Pipeline and the Private Markets Accelerators
// tab display the identical set of 12 companies.
const HUB71_BUNDLED = (() => {
  try {
    return require(path.resolve(
      __dirname,
      '../../../apps/research/src/pages/ventures/components/hub71-crypto-seed.json'
    ));
  } catch (err) {
    console.warn('[accelerators] Hub71 bundled seed not found, using inline fallback');
    return { companies: [] };
  }
})();

// ─── Cache ──────────────────────────────────────────────────────────────────
const cache = new Map();
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
function setCached(key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

const YC_TTL = 6 * 60 * 60 * 1000; // 6 hours (YC updates daily)
const HUB71_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ─── Crypto classifier ─────────────────────────────────────────────────────
const CRYPTO_TAG_KEYWORDS = [
  'crypto', 'web3', 'blockchain', 'defi', 'nft',
  'stablecoin', 'bitcoin', 'ethereum', 'cryptocurrency',
  'digital assets', 'smart contracts', 'zk', 'layer 2', 'l2',
  'rollup', 'wallet', 'dao', 'onchain',
];
function isCryptoYC(company) {
  const tags = (company.tags || []).map((t) => String(t).toLowerCase());
  const industry = String(company.subindustry || company.industry || '').toLowerCase();
  const tagMatch = tags.some((t) => CRYPTO_TAG_KEYWORDS.some((kw) => t.includes(kw)));
  const industryMatch = /crypto|blockchain|web3/.test(industry);
  return tagMatch || industryMatch;
}

// ─── YC fetcher ─────────────────────────────────────────────────────────────
const YC_API = 'https://yc-oss.github.io/api/companies/all.json';
async function fetchYCCompanies() {
  const cached = getCached('yc:all');
  if (cached) return cached;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(YC_API, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Spectre-AI/1.0 (+https://spectreai.io)' },
    }).catch((err) => {
      clearTimeout(timer);
      throw err;
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`yc-${res.status}`);
    const arr = await res.json();
    if (!Array.isArray(arr)) throw new Error('yc-shape');

    // Normalize + tag crypto
    const normalized = arr.map((c) => ({
      id: `yc-${c.id}`,
      name: c.name,
      slug: c.slug,
      website: c.website,
      logoUrl: c.small_logo_thumb_url || null,
      oneLiner: c.one_liner || null,
      longDescription: c.long_description || null,
      batch: c.batch || null,
      status: c.status || null,
      industry: c.industry || null,
      subindustry: c.subindustry || null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      teamSize: c.team_size || null,
      topCompany: !!c.top_company,
      regions: Array.isArray(c.regions) ? c.regions : [],
      stage: c.stage || null,
      url: c.url || null,
      launchedAt: c.launched_at || null,
      isCrypto: isCryptoYC(c),
      accelerator: 'YC',
      acceleratorLogo: 'https://www.ycombinator.com/favicon.ico',
      acceleratorColor: '#FF6600',
    }));

    setCached('yc:all', normalized, YC_TTL);
    return normalized;
  } catch (err) {
    console.warn('[accelerators] YC fetch failed:', err.message);
    return getCached('yc:all') || [];
  }
}

// ─── Hub71 curated seed ─────────────────────────────────────────────────────
// Known Hub71 + Hub71+ Digital Assets cohort members (Abu Dhabi, Mubadala-backed)
const HUB71_SEED = [
  {
    id: 'hub71-fuze',
    name: 'Fuze',
    slug: 'fuze',
    website: 'https://fuze.finance',
    logoUrl: 'https://www.google.com/s2/favicons?domain=fuze.finance&sz=128',
    oneLiner: 'Full-stack digital assets infrastructure for MENA businesses',
    sector: 'Digital Assets Infrastructure',
    stage: 'Series A',
    isCrypto: true,
  },
  {
    id: 'hub71-rain',
    name: 'Rain',
    slug: 'rain',
    website: 'https://rain.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=rain.com&sz=128',
    oneLiner: 'Licensed crypto exchange in Bahrain and UAE',
    sector: 'Crypto Exchange',
    stage: 'Series B',
    isCrypto: true,
  },
  {
    id: 'hub71-fasset',
    name: 'Fasset',
    slug: 'fasset',
    website: 'https://fasset.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=fasset.com&sz=128',
    oneLiner: 'Digital asset platform for emerging markets',
    sector: 'Digital Assets',
    stage: 'Series A',
    isCrypto: true,
  },
  {
    id: 'hub71-haqq',
    name: 'HAQQ Network',
    slug: 'haqq',
    website: 'https://haqq.network',
    logoUrl: 'https://www.google.com/s2/favicons?domain=haqq.network&sz=128',
    oneLiner: 'Ethical Islamic L1 blockchain network',
    sector: 'Blockchain L1',
    stage: 'Seed',
    isCrypto: true,
  },
  {
    id: 'hub71-laser',
    name: 'Laser Digital',
    slug: 'laser-digital',
    website: 'https://laserdigital.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=laserdigital.com&sz=128',
    oneLiner: 'Digital asset investment firm — Nomura subsidiary',
    sector: 'Digital Asset Management',
    stage: 'Corporate',
    isCrypto: true,
  },
  {
    id: 'hub71-mamo',
    name: 'Mamo',
    slug: 'mamo',
    website: 'https://mamopay.com',
    logoUrl: 'https://www.google.com/s2/favicons?domain=mamopay.com&sz=128',
    oneLiner: 'Digital payments and financial services for MENA',
    sector: 'Fintech',
    stage: 'Series A',
    isCrypto: false,
  },
  {
    id: 'hub71-tabby',
    name: 'Tabby',
    slug: 'tabby',
    website: 'https://tabby.ai',
    logoUrl: 'https://www.google.com/s2/favicons?domain=tabby.ai&sz=128',
    oneLiner: 'Buy now, pay later across the Middle East',
    sector: 'Fintech',
    stage: 'Series C',
    isCrypto: false,
  },
  {
    id: 'hub71-flowdesk',
    name: 'Flowdesk',
    slug: 'flowdesk',
    website: 'https://flowdesk.co',
    logoUrl: 'https://www.google.com/s2/favicons?domain=flowdesk.co&sz=128',
    oneLiner: 'Digital asset market making and execution platform',
    sector: 'Market Making',
    stage: 'Series B',
    isCrypto: true,
  },
];

async function fetchHub71Companies() {
  const cached = getCached('hub71:all');
  if (cached) return cached;

  // Prefer the bundled JSON from the Ventures page (12 entries) — single
  // source of truth so Ventures and Private Markets show the same data.
  const bundled = Array.isArray(HUB71_BUNDLED?.companies) ? HUB71_BUNDLED.companies : [];
  const source = bundled.length > 0
    ? bundled.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        website: c.website,
        logoUrl: c.logo_domain
          ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.logo_domain)}&sz=128`
          : null,
        oneLiner: c.one_liner || null,
        longDescription: c.long_description || null,
        batch: c.batch || 'Hub71+ Digital Assets',
        status: c.status || 'Active',
        sector: c.sector || null,
        stage: c.stage || null,
        tags: Array.isArray(c.tags) ? c.tags : [],
        isCrypto: true, // curated crypto seed
      }))
    : HUB71_SEED; // fallback to inline 6-entry seed

  const normalized = source.map((c) => ({
    ...c,
    accelerator: 'Hub71',
    acceleratorLogo: 'https://www.google.com/s2/favicons?domain=hub71.com&sz=128',
    acceleratorColor: '#0066CC',
    region: 'Abu Dhabi, UAE',
    backer: 'Mubadala',
    topCompany: true,
    // preserve existing tags, or synthesize from sector
    tags: (c.tags && c.tags.length > 0)
      ? c.tags
      : [c.sector, 'Crypto'].filter(Boolean),
  }));

  setCached('hub71:all', normalized, HUB71_TTL);
  return normalized;
}

// ─── Filtering helpers ──────────────────────────────────────────────────────
function applyYCFilters(companies, { cryptoOnly, batch, status, topOnly, search }) {
  let result = companies;
  if (cryptoOnly) result = result.filter((c) => c.isCrypto);
  if (batch) result = result.filter((c) => String(c.batch || '').toLowerCase() === String(batch).toLowerCase());
  if (status) result = result.filter((c) => String(c.status || '').toLowerCase() === String(status).toLowerCase());
  if (topOnly) result = result.filter((c) => c.topCompany);
  if (search) {
    const q = String(search).toLowerCase();
    result = result.filter((c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.oneLiner || '').toLowerCase().includes(q) ||
      (c.tags || []).some((t) => String(t).toLowerCase().includes(q))
    );
  }
  return result;
}

function sortAcceleratorFeed(list) {
  return list.slice().sort((a, b) => {
    // Top companies first
    if (a.topCompany && !b.topCompany) return -1;
    if (!a.topCompany && b.topCompany) return 1;
    // Then newest batch (W24, S24, W25 lex-sort)
    const batchA = a.batch || '';
    const batchB = b.batch || '';
    if (batchA && batchB && batchA !== batchB) return batchB.localeCompare(batchA);
    return 0;
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────
router.get('/yc', async (req, res) => {
  try {
    const all = await fetchYCCompanies();
    const cryptoOnly = req.query.crypto === 'true' || req.query.cryptoOnly === 'true';
    const filtered = applyYCFilters(all, {
      cryptoOnly,
      batch: req.query.batch,
      status: req.query.status,
      topOnly: req.query.top === 'true',
      search: req.query.search,
    });
    const sorted = sortAcceleratorFeed(filtered);
    const batches = [...new Set(all.map((c) => c.batch).filter(Boolean))].sort().reverse();
    res.json({
      data: sorted,
      source: 'yc-oss',
      total: all.length,
      cryptoCount: all.filter((c) => c.isCrypto).length,
      batches,
    });
  } catch (err) {
    console.error('[accelerators] /yc error:', err.message);
    res.json({ data: [], error: err.message });
  }
});

router.get('/hub71', async (req, res) => {
  try {
    const all = await fetchHub71Companies();
    const cryptoOnly = req.query.crypto === 'true' || req.query.cryptoOnly === 'true';
    const filtered = cryptoOnly ? all.filter((c) => c.isCrypto) : all;
    res.json({
      data: filtered,
      source: 'hub71-seed',
      total: all.length,
      cryptoCount: all.filter((c) => c.isCrypto).length,
    });
  } catch (err) {
    console.error('[accelerators] /hub71 error:', err.message);
    res.json({ data: [], error: err.message });
  }
});

router.get('/all', async (req, res) => {
  try {
    const cryptoOnly = req.query.crypto === 'true' || req.query.cryptoOnly === 'true';
    const [yc, hub71] = await Promise.all([fetchYCCompanies(), fetchHub71Companies()]);

    const filteredYc = cryptoOnly ? yc.filter((c) => c.isCrypto) : yc;
    const filteredHub71 = cryptoOnly ? hub71.filter((c) => c.isCrypto) : hub71;

    const merged = [...filteredHub71, ...filteredYc];
    const sorted = sortAcceleratorFeed(merged);

    res.json({
      data: sorted,
      total: merged.length,
      counts: {
        yc: filteredYc.length,
        hub71: filteredHub71.length,
      },
      sources: ['YC', 'Hub71'],
    });
  } catch (err) {
    console.error('[accelerators] /all error:', err.message);
    res.json({ data: [], error: err.message });
  }
});

module.exports = router;
