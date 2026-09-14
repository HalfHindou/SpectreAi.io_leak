/**
 * Per-symbol manual seed for the dossier when upstream sources don't index a
 * project's structured metadata (team, funding rounds, partnerships, etc.).
 *
 * Used by useDossierProject — fields here only fill in when the live API
 * returns null/empty. Keep entries small and source-attributed.
 *
 * Adding a new symbol: drop another `[SYMBOL]: { ... }` block. Shape mirrors
 * the dossier-proxy translate() output so the project tab consumes either
 * source transparently.
 */
import {
  ZIGCHAIN_STATIC,
  ZIG_SOCIALS,
  PARTNER_LOGOS,
} from '@/pages/zigchain/zigchain.constants'

const ua = (handle) => handle ? `https://unavatar.io/twitter/${handle}` : null
const uaDomain = (domain) => domain ? `https://unavatar.io/${domain}` : null

// Known X handles for ZIG partners + investors → unavatar.io profile pic.
// unavatar.io falls back gracefully (gravatar/duckduckgo) so a missing handle
// still renders a generic globe rather than a hard 404.
const ZIG_ENTITY_HANDLES = {
  'Apex Group': 'apexgroupltd',
  'Zamanat': 'ZamanatHQ',
  'SEGG Media': 'SEGGMedia',
  'BTCS Inc.': 'BTCS_Inc',
  'Tokeny (via Apex)': 'TokenySolutions',
  'Truleum Ventures': null,
  'DWF Labs': 'DWFLabs',
  'OKX Ventures': 'OKX_Ventures',
  'Ryze Labs': 'ryze_labs',
  'DAO Maker': 'TheDaoMaker',
  'AU21 Capital': 'AU21Capital',
  'GEM Global': 'GEMDigitalLtd',
  'Disrupt': null,
}

function zigInvestors() {
  const list = ZIGCHAIN_STATIC?.funding?.investors || []
  return list.map((raw) => {
    const m = String(raw).match(/^([^(]+?)(?:\s*\((.+)\))?$/)
    const name = (m?.[1] || raw).trim()
    const handle = ZIG_ENTITY_HANDLES[name]
    return { name, note: m?.[2]?.trim() || null, logoUrl: ua(handle) }
  })
}

function zigFundingRounds() {
  const rounds = ZIGCHAIN_STATIC?.funding?.rounds || []
  return rounds.map((r) => {
    const amountUsd = (() => {
      const m = String(r.amount || '').match(/\$\s*([\d.]+)\s*(M|B|K)?/i)
      if (!m) return null
      const n = Number(m[1])
      const mult = (m[2] || '').toUpperCase()
      return n * (mult === 'B' ? 1e9 : mult === 'M' ? 1e6 : mult === 'K' ? 1e3 : 1)
    })()
    return {
      date: r.date || null,
      roundType: r.round || 'Round',
      amountUsd,
      leadInvestors: r.lead ? [r.lead] : [],
    }
  })
}

function zigSocialLinks() {
  const out = {}
  for (const s of ZIG_SOCIALS || []) {
    const k = s.name?.toLowerCase()
    if (!k || !s.url) continue
    if (k.includes('website')) out.website = s.url
    else if (k.includes('twitter') || k === 'x / twitter' || k === 'x') out.twitter = s.url
    else if (k.includes('telegram')) out.telegram = s.url
    else if (k.includes('discord')) out.discord = s.url
    else if (k.includes('medium')) out.medium = s.url
    else if (k.includes('github')) out.github = s.url
    else if (k.includes('doc')) out.docs = s.url
  }
  return out
}

// Abdul Rafay's spotlight payload — milestones, podcasts, hero quote.
// Birthday is `MM-DD`; the renderer compares to today's local date and
// flips the chip on for the day. Update this dataset when new podcasts ship.
const ABDUL_SPOTLIGHT = {
  name: 'Abdul Rafay Gadit',
  role: 'Co-Founder · Master of Coin $ZIG',
  handle: 'ARafayGadit',
  birthday: '05-08',
  portrait: '/founders/abdul-rafay.png',
  bio: 'IBA Karachi → Standard Chartered (6 yr) → Cloudways ($350M exit to DigitalOcean) → Zignaly (2018) → ZIGChain (2025). Managing Partner @ZigLabs · Partner @Disrupt_com.',
  quote: '$ZIG will be the RWA meta asset, time to deliver.',
  quoteDate: '2026-05-05',
  wins: [
    { value: '$350M', label: 'Cloudways exit' },
    { value: '600K+', label: 'Zignaly users' },
    { value: '$3.4T', label: 'Apex AUA partner' },
    { value: '$100M', label: 'Ecosystem Fund' },
    { value: 'Jun 2025', label: 'ZIGChain L1 mainnet' },
  ],
  socials: [
    { kind: 'x', url: 'https://x.com/ARafayGadit', label: '@ARafayGadit' },
    { kind: 'linkedin', url: 'https://pk.linkedin.com/in/argadit', label: 'LinkedIn' },
    { kind: 'web', url: 'https://zigchain.com/', label: 'zigchain.com' },
  ],
  milestones: [
    { year: '2010', kind: 'origin', label: 'IBA Karachi · BBA in Banking, Corporate Finance & Securities Law' },
    { year: '2010 – 16', kind: 'origin', label: 'Standard Chartered Bank · 6 years regional banking' },
    { year: '2018', kind: 'company', label: 'Co-founds Zignaly with Bartolome Bordallo · social copy-trading platform' },
    { year: 'Mar 2021', kind: 'capital', label: 'Series A · $3M' },
    { year: 'Q1 2022', kind: 'exit', label: 'Cloudways exits to DigitalOcean · $350M' },
    { year: 'Mar 2022', kind: 'capital', label: '$50M financing' },
    { year: '2024', kind: 'product', label: 'Zignaly crosses 600K users · 150+ portfolio managers' },
    { year: 'Apr 17 2024', kind: 'event', label: 'ZIGChain announced · $100M Ecosystem Fund backed by DWF Labs' },
    { year: 'Feb 2025', kind: 'product', label: 'ZIGChain testnet live' },
    { year: 'Apr 29 2025', kind: 'event', label: 'ZIGChain Summit Dubai · Zamanat unveiled · $25M DeFAI Fund announced' },
    { year: 'Jun 25 2025', kind: 'product', label: 'ZIGChain Layer 1 mainnet beta ships · Cosmos SDK' },
    { year: 'Jul 25 2025', kind: 'partnership', label: 'Apex Group ($3.4T AUA) strategic alliance · regulated on-chain fund infra' },
    { year: 'Sep 2025', kind: 'partnership', label: 'BTCS Inc. · $30M institutional strategic allocation' },
    { year: 'Dec 2025', kind: 'milestone', label: 'First Proof-of-Stake L1 with Shariah Certification · validators as Wakala (profit-sharing, no fixed interest)' },
    { year: 'Dec 2025', kind: 'product', label: 'Zignaly × ABHI · first RWA private-credit product · $10 min ticket' },
    { year: 'Dec 22 2025', kind: 'listing', label: 'KuCoin lists $ZIG futures · 20× leverage' },
    { year: 'Mar 13 2026', kind: 'product', label: '$78B USDC accessible cross-chain · 16+ source chains' },
    { year: 'Apr 2026', kind: 'partnership', label: 'BeeHive partnership · DFSA-regulated SME lender (AED 5B+ deployed to 2,800+ SMEs across GCC, 11 yr ops) brings private credit onchain' },
    { year: 'Apr 2026', kind: 'partnership', label: 'Taurus integration live · FINMA-regulated custody (Deutsche Bank · State Street · Santander) opens institutional global custody for $ZIG across 5 continents, 12 countries' },
    { year: 'Apr 2026', kind: 'product', label: 'ZIGChain announces EVM compatibility' },
    { year: 'Apr 2026', kind: 'product', label: 'ZIGMarkets launches · AI-powered coordination layer for capital, infrastructure, and distribution — institutional + retail access to onchain opportunities' },
    { year: 'May 2026', kind: 'voice', label: 'Public commit: "$ZIG will be the RWA meta asset"' },
  ],
  // Abdul's own podcast is "Access Granted" (he hosts). Older entries are
  // long-form interviews where he was the guest. Hosted episodes share the
  // same portrait thumbnail so the cards line up uniformly.
  podcasts: [
    {
      title: 'Series premiere — Access Granted launches',
      host: 'Access Granted · Ep. 1',
      date: '2025',
      url: 'https://x.com/ARafayGadit',
      thumbUrl: '/founders/abdul-rafay.png',
      length: 'Host',
      hosting: true,
    },
    {
      title: 'Digital Asset Treasuries as Infrastructure · with Wojtek Kaszycki',
      host: 'Access Granted · Ep. 2',
      date: '2026-02-04',
      url: 'https://x.com/ZIGChain/status/2019111987427283129',
      thumbUrl: '/founders/abdul-rafay.png',
      length: 'Tokenization · DATs',
      hosting: true,
    },
    {
      title: 'DeFi without a learning curve · AI as interface · RWAs as the assets — with Katerina Viko (OroSwap)',
      host: 'Access Granted · Ep. 3',
      date: '2026-04',
      url: 'https://x.com/ARafayGadit/status/2042600969637367948',
      thumbUrl: '/founders/abdul-rafay.png',
      length: 'AI · DeFi · RWA',
      hosting: true,
    },
    {
      title: "What's Next for Crypto in 2026?",
      host: 'Guest · Paklaunch',
      date: '2025-12-21',
      url: 'https://www.youtube.com/watch?v=spHtaweaf7I',
      thumbUrl: 'https://i.ytimg.com/vi/spHtaweaf7I/hqdefault.jpg',
      length: 'Long-form',
    },
    {
      title: 'Blockchain, Digital Wealth Management & Tokenized Assets Explained',
      host: 'Guest · CFO Interview',
      date: '2025-12-05',
      url: 'https://www.youtube.com/watch?v=dXHZKSVF1qs',
      thumbUrl: 'https://i.ytimg.com/vi/dXHZKSVF1qs/hqdefault.jpg',
      length: 'Episode',
    },
    {
      title: '90% of the World’s Muslims Still Lack Access to Global Finance — Can Blockchain Fix It?',
      host: 'Guest · Shariah RWA',
      date: '2025',
      url: 'https://www.youtube.com/watch?v=1RjmGiBxToM',
      thumbUrl: 'https://i.ytimg.com/vi/1RjmGiBxToM/hqdefault.jpg',
      length: 'Long-form',
    },
    {
      title: 'Building WEALTH Generation from Web3 — ZIGChain testnet launch',
      host: 'Guest · Blockchain Interviews',
      date: '2025-01-26',
      url: 'https://www.youtube.com/watch?v=5x2CSqULtAw',
      thumbUrl: 'https://i.ytimg.com/vi/5x2CSqULtAw/hqdefault.jpg',
      length: 'Long-form',
    },
    {
      title: 'Crypto, Regulation & Pakistan’s Financial Future',
      host: 'Guest · Dawn News English',
      date: '2025',
      url: 'https://www.youtube.com/watch?v=uHOUiPpJ_o0',
      thumbUrl: 'https://i.ytimg.com/vi/uHOUiPpJ_o0/hqdefault.jpg',
      length: 'TV',
    },
    {
      title: 'Where AI creates real value in crypto, and where it is just noise',
      host: 'Short',
      date: '2025',
      url: 'https://www.youtube.com/shorts/TcybYElwa_I',
      thumbUrl: 'https://i.ytimg.com/vi/TcybYElwa_I/hqdefault.jpg',
      length: 'Short',
    },
  ],
}

const ZIG_OVERRIDES = {
  tagline: 'Purpose-built Layer 1 for real-world asset tokenization. Cosmos SDK, EVM-compatible, Shariah-certified.',
  team: (ZIGCHAIN_STATIC?.team || []).map((m) => ({
    name: m.name,
    position: m.role,
    bio: m.bg || null,
    // Prefer the explicit `avatar` set in constants (handles per-member
    // overrides like Abdul's portrait or David's LinkedIn fallback);
    // otherwise derive from the X handle via unavatar.io.
    avatar: m.avatar || (m.twitter ? ua(m.twitter) : null),
    urls: {
      ...(m.twitter ? { twitter: `https://x.com/${m.twitter}` } : null),
      ...(m.linkedin ? { linkedin: `https://www.linkedin.com/in/${m.linkedin}` } : null),
    },
  })),
  partners: (ZIGCHAIN_STATIC?.partnerships || []).map((p) => ({
    name: p.name,
    role: p.role,
    logoUrl: PARTNER_LOGOS?.[p.name] || ua(ZIG_ENTITY_HANDLES[p.name]),
  })),
  investors: zigInvestors(),
  fundingRounds: zigFundingRounds(),
  fundingTotal: 53_000_000,
  socialLinks: zigSocialLinks(),
  founderSpotlight: ABDUL_SPOTLIGHT,
}

const REGISTRY = {
  ZIG: ZIG_OVERRIDES,
}

export function getProjectOverrides(symbol) {
  if (!symbol) return null
  return REGISTRY[String(symbol).toUpperCase()] || null
}
