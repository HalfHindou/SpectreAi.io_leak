/**
 * VCIntelHub — Smart Money intelligence surface.
 *
 * Three-panel layout:
 *   LEFT  (260px): filterable entity list
 *   CENTER (flex): VCProfilePanel — Holdings / Portfolio / Activity / AI Signal tabs
 *   RIGHT (300px): unified activity feed across all entities
 *
 * Phase 1 (this file): static vcDatabase.json layer — always renders, no
 * API dependencies. Search, filter, portfolio from known_portfolio_companies.
 *
 * Phase 2 will wire DeFiLlama `/raises` enrichment, Phase 3 the Arkham
 * holdings/history/transactions layer, Phase 4 the AI Signal + scraper cron.
 * The component is structured so those phases drop in as new tabs without
 * touching the shell.
 */
import React, { useState, useMemo, useCallback, useEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import vcDatabase from './vc-database.json'
import InfoTip from '@/components/InfoTip'
import { getPriceRows } from './ventures-prices-store'
import useUniversePrices from './useUniversePrices'
import VcAiAnalyst from './vc-ai-analyst'
import VcPulseFeed from './vc-pulse-feed'
import VcInvestmentActivity from './vc-investment-activity'
import useVcInvestments from './useVcInvestments'
import { reconcileSnapshot } from './smu-vc-snapshots'
import { isTradeableSymbol } from './smu-shared'

// Cross-VC "Smart Money Universe" views — lazy so only the active tab mounts.
const VCUniverseMap = lazy(() => import('./vc-universe-map'))
const VCBubblesView = lazy(() => import('./vc-bubbles-view'))
const VCSectorsGrid = lazy(() => import('./vc-sectors-grid'))
const VCSocialSignal = lazy(() => import('./vc-social-signal'))

const UNIVERSE_VIEWS = [
  { value: 'consensus', label: 'Token Consensus' },
  { value: 'bubbles', label: 'VC Bubbles' },
  { value: 'sectors', label: 'Sector Map' },
  { value: 'social', label: 'Social Signal' },
]

// AUM strings in vc-database.json are pre-formatted USD ("$12B", "$1.5T (total)",
// "$30B+ IBIT/ETHA"). Parse the leading dollar amount, reformat through the
// user's currency, and re-append any trailing annotation so EUR/JPY/etc. users
// don't see hardcoded "$" on every stat tile.
const AUM_REGEX = /^\$([\d.]+)\s*([TBMK])?(.*)$/i
const AUM_SCALE = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }
function formatAumString(raw, fmt) {
  if (typeof raw !== 'string') return raw
  const m = raw.trim().match(AUM_REGEX)
  if (!m) return raw
  const n = parseFloat(m[1])
  if (!isFinite(n)) return raw
  const scale = m[2] ? AUM_SCALE[m[2].toUpperCase()] || 1 : 1
  const usd = n * scale
  const tail = (m[3] || '').trim()
  const formatted = fmt(usd)
  return tail ? `${formatted} ${tail}` : formatted
}
import './vc-intel-hub.css'
import './vc-intel-hub.day-mode.css'
import './vc-intel-hub.mobile.css'

// ═══════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════

const ENTITY_TYPE_FILTERS = [
  { value: 'all',           labelKey: 'ventures.vcHub.entityTypes.all' },
  { value: 'crypto_vc',     labelKey: 'ventures.vcHub.entityTypes.cryptoVc' },
  { value: 'generalist_vc', labelKey: 'ventures.vcHub.entityTypes.generalist' },
  { value: 'asset_manager', labelKey: 'ventures.vcHub.entityTypes.assetMgr' },
  { value: 'corporate',     labelKey: 'ventures.vcHub.entityTypes.corporate' },
  { value: 'sovereign',     labelKey: 'ventures.vcHub.entityTypes.sovereign' },
]

// Sector filter chips for the entity list. Each chip maps to a clean
// canonical sector and matches a small group of raw `focus_sectors` aliases
// from vc-database.json (which has 40+ messy long-tail values). Multi-select
// with OR logic: a VC matches if ANY of its focus_sectors hits ANY selected
// chip's aliases. Long-tail singletons (Privacy, Identity, DAO, etc.) are
// intentionally not chips — they stay reachable via the search box.
const VC_SECTOR_FILTERS = [
  { value: 'infrastructure', label: 'Infrastructure', aliases: ['Infrastructure', 'BTC Infrastructure', 'Developer Tools'] },
  { value: 'defi',     label: 'DeFi',     aliases: ['DeFi', 'MEV', 'Trading', 'Exchanges', 'Exchange'] },
  { value: 'ai',       label: 'AI',       aliases: ['AI', 'DePIN'] },
  { value: 'rwa',      label: 'RWA',      aliases: ['RWA', 'Tokenization'] },
  { value: 'gaming',   label: 'Gaming',   aliases: ['Gaming', 'GameFi', 'Metaverse'] },
  { value: 'consumer', label: 'Consumer', aliases: ['Consumer', 'Social', 'NFT'] },
  { value: 'treasury', label: 'Treasury', aliases: ['Treasury BTC', 'Treasury', 'Sovereign Reserve', 'National Reserve', 'Sovereign Wealth', 'Legal Tender'] },
  { value: 'etf',      label: 'ETF',      aliases: ['ETF', 'ETP', 'Index Funds', 'Futures'] },
]

// Build a lookup: raw alias (lowercased) -> Set of chip values it belongs to.
const SECTOR_ALIAS_TO_VALUES = (() => {
  const map = new Map()
  VC_SECTOR_FILTERS.forEach((f) => {
    f.aliases.forEach((a) => {
      const key = a.toLowerCase()
      if (!map.has(key)) map.set(key, new Set())
      map.get(key).add(f.value)
    })
  })
  return map
})()

// OR-logic match: true if any selected chip value is satisfied by any of the
// entity's focus_sectors. Empty selection means "all" (no filtering).
function matchesSectors(entity, selectedValues) {
  if (!selectedValues || selectedValues.length === 0) return true
  const selected = new Set(selectedValues)
  const sectors = entity.focus_sectors || []
  for (const s of sectors) {
    const vals = SECTOR_ALIAS_TO_VALUES.get((s || '').toLowerCase())
    if (!vals) continue
    for (const v of vals) {
      if (selected.has(v)) return true
    }
  }
  return false
}

const PROFILE_TABS = [
  { value: 'portfolio', labelKey: 'ventures.vcHub.profileTabs.portfolio' },
  { value: 'holdings',  labelKey: 'ventures.vcHub.profileTabs.holdings' },
  { value: 'activity',  labelKey: 'ventures.vcHub.profileTabs.activity' },
]

// Domain logo helper. We use DuckDuckGo's icons service (`/ip3/{domain}.ico`)
// because Clearbit's free logo API was deprecated and returns connection
// errors. DDG is rock-solid, returns 200 for every real domain, and has no
// rate limits or API key requirements. Falls back to initials if the image
// fails to load in the browser.
function logoFromDomain(domain) {
  if (!domain) return null
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`
}

// Curated project-name → official domain map. Used by Clearbit to render
// real logos on portfolio company cards. Keys are matched case-insensitively
// against entity.known_portfolio_companies entries. When a company isn't in
// the map we fall back to an initials circle.
const PROJECT_DOMAINS = {
  'Coinbase':              'coinbase.com',
  'OpenSea':               'opensea.io',
  'Flashbots':             'flashbots.net',
  'LayerZero':             'layerzero.network',
  'EigenLayer':            'eigenlayer.xyz',
  'Wormhole':              'wormhole.com',
  'Farcaster':             'farcaster.xyz',
  'Magic Eden':            'magiceden.io',
  'Aptos':                 'aptoslabs.com',
  'dYdX':                  'dydx.exchange',
  'Optimism':              'optimism.io',
  'Arbitrum':              'arbitrum.io',
  'Uniswap':               'uniswap.org',
  'Compound':              'compound.finance',
  'MakerDAO':              'makerdao.com',
  'Phantom':               'phantom.app',
  'Alchemy':               'alchemy.com',
  'Figment':               'figment.io',
  'Anchorage':             'anchorage.com',
  'Sky Mavis':             'skymavis.com',
  'Ethena':                'ethena.fi',
  'Monad':                 'monad.xyz',
  'Frax Finance':          'frax.finance',
  'Frax':                  'frax.finance',
  'Lido':                  'lido.fi',
  'Starkware':             'starkware.co',
  'Chainlink':             'chain.link',
  'Argent':                'argent.xyz',
  'Ribbon':                'ribbon.finance',
  'Friend.tech':           'friend.tech',
  'Blur':                  'blur.io',
  'Ripple':                'ripple.com',
  '1inch':                 '1inch.io',
  'Near Protocol':         'near.org',
  'Near':                  'near.org',
  'Filecoin':              'filecoin.io',
  'Algorand':              'algorand.com',
  'Bitstamp':              'bitstamp.net',
  'Circle':                'circle.com',
  'Polkadot':              'polkadot.network',
  'The Graph':             'thegraph.com',
  'Sui':                   'sui.io',
  'Injective':             'injective.com',
  'Ondo Finance':          'ondo.finance',
  'Celestia':              'celestia.org',
  'Berachain':             'berachain.com',
  'Offchain Labs':         'offchainlabs.com',
  'Dfinity':               'dfinity.org',
  'Cosmos':                'cosmos.network',
  'Celo':                  'celo.org',
  'Espresso Systems':      'espressosys.com',
  'Solana':                'solana.com',
  'Helium':                'helium.com',
  'Render':                'renderfoundation.com',
  'Jito':                  'jito.network',
  'Audius':                'audius.co',
  'Arweave':               'arweave.org',
  'io.net':                'io.net',
  'Hivemapper':            'hivemapper.com',
  'Jupiter':               'jup.ag',
  'Dune Analytics':        'dune.com',
  'Dune':                  'dune.com',
  'Mysten Labs':           'mystenlabs.com',
  'Pyth Network':          'pyth.network',
  'Pyth':                  'pyth.network',
  'BlockFi':               'blockfi.com',
  'Etherscan':             'etherscan.io',
  'Base ecosystem':        'base.org',
  'Axie Infinity':         'axieinfinity.com',
  'The Sandbox':           'sandbox.game',
  'Sandbox':               'sandbox.game',
  'Polygon':               'polygon.technology',
  'Yuga Labs':             'yuga.com',
  'Dapper Labs':           'dapperlabs.com',
  'Immutable':             'immutable.com',
  'Dust Labs':             'dust.xyz',
  'Ava Labs':              'avalabs.org',
  'Mantra':                'mantrachain.io',
  'CyberConnect':          'link3.to',
  'Space and Time':        'spaceandtime.io',
  'Venom Foundation':      'venom.foundation',
  'Fetch.ai':              'fetch.ai',
  'Yield Guild':           'yieldguild.io',
  'Yield Guild Games':     'yieldguild.io',
  'Thorchain':             'thorchain.org',
  'Osmosis':               'osmosis.zone',
  'Astroport':             'astroport.fi',
  'Rage Trade':            'rage.trade',
  'Worldcoin':             'worldcoin.org',
  'Aave':                  'aave.com',
  'Kraken':                'kraken.com',
  'Protocol Labs':         'protocol.ai',
  'ENS':                   'ens.domains',
  'Mirror':                'mirror.xyz',
  'Gitcoin':               'gitcoin.co',
  'Aragon':                'aragon.org',
  'Livepeer':              'livepeer.org',
  'Numeraire':             'numer.ai',
  'Zcash':                 'z.cash',
  'Aethir':                'aethir.com',
  'Grass':                 'grass.io',
  'Morpheus':              'mor.org',
  'Hyperbolic':            'hyperbolic.xyz',
  'Succinct':              'succinct.xyz',
  'Matter Labs':           'matter-labs.io',
  'Dragonfly':             'dragonfly.xyz',
  'Aevo':                  'aevo.xyz',
  'SSV Network':           'ssv.network',
  'Morpho':                'morpho.xyz',
  'Aztec':                 'aztec.network',
  'Anduril':               'anduril.com',
  'Brave':                 'brave.com',
  'Ocean Protocol':        'oceanprotocol.com',
  'Synthetix':             'synthetix.io',
  'Chiliz':                'chiliz.com',
  'Eden Network':          'eden.network',
  'Tellor':                'tellor.io',
  'Perpetual Protocol':    'perp.com',
  'Zerion':                'zerion.io',
  'Pangolin':              'pangolin.exchange',
  'Pendle':                'pendle.finance',
  'Gemini':                'gemini.com',
  'Consensys':             'consensys.io',
  'Fireblocks':            'fireblocks.com',
  'Bitgo':                 'bitgo.com',
  'Flexa':                 'flexa.network',
  'Helios':                'helios.fi',
  'Scroll':                'scroll.io',
  'Mantle':                'mantle.xyz',
  'Chain.link':            'chain.link',
  'Chainalysis':           'chainalysis.com',
  'Cash App':              'cash.app',
  'Spiral':                'spiral.xyz',
  'TBD':                   'tbd.website',
  'BITB':                  'bitbwyzer.com',
  'Securitize':            'securitize.io',
  'Near.AI':               'near.ai',
  'Klaytn':                'klaytn.foundation',
  'Nervos':                'nervos.org',
  'Waves':                 'waves.tech',
  'Mina Protocol':         'minaprotocol.com',
  'Mina':                  'minaprotocol.com',
  'OpenZeppelin':          'openzeppelin.com',
  'Rarible':               'rarible.com',
  'Avalanche':             'avax.network',
  'Compound DAO':          'compound.finance',
  'Uniswap DAO':           'uniswap.org',
  'Gala Games':            'gala.games',
  'Polygon ID':            'polygon.technology',
  'Block Inc':             'block.xyz',
  'FTX (historical)':      'ftx.com',
  'Bitcoin Foundation (early)': 'bitcoin.org',
  'BENJI':                 'franklintempleton.com',
}

// Normalize a project name for matching — strip parenthetical notes ("Starkware (historical)"),
// lowercase, collapse whitespace.
function normalizeProjectName(name) {
  if (!name) return ''
  return String(name)
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim()
    .toLowerCase()
}

// Build a lowercase lookup for PROJECT_DOMAINS so callers don't need to match case.
const PROJECT_DOMAIN_LOOKUP = (() => {
  const out = {}
  for (const [k, v] of Object.entries(PROJECT_DOMAINS)) {
    out[normalizeProjectName(k)] = v
  }
  return out
})()

function projectLogoUrl(name) {
  const key = normalizeProjectName(name)
  const domain = PROJECT_DOMAIN_LOOKUP[key]
  return domain ? logoFromDomain(domain) : null
}

// Entity type -> display label. No colour: per design system, UI chrome stays
// warm-white and colour is reserved for live data only. The type reads as a
// muted text label, not a coloured pill.
function typeBadge(type) {
  switch (type) {
    case 'crypto_vc':     return { label: 'Crypto VC' }
    case 'generalist_vc': return { label: 'Generalist' }
    case 'asset_manager': return { label: 'Asset Mgr' }
    case 'corporate':     return { label: 'Corporate' }
    case 'sovereign':     return { label: 'Sovereign' }
    default:              return { label: 'Entity' }
  }
}

// Tier dot colour. Only Tier 1 earns an accent (warm gold, the one sanctioned
// non-white accent). Everything else is a neutral grey dot.
function tierBadgeColor(tier) {
  if (tier === 1) return '#fbbf24'
  return 'rgba(245, 245, 247, 0.28)'
}

// ═══════════════════════════════════════════════════════════════════════════
// Token logo fetcher — extracts real logos for every token symbol referenced
// across the VC database from the shared ventures-prices-store.
//
// Routes through getPriceRows() so the /v1/prices fetch is deduped per-symbol
// against useVenturesPrices (the page's full price map uses the same endpoint
// with an overlapping symbol set) — ETH appearing in both a VC portfolio AND
// the project list is now fetched once, not twice.
//
// Keeps a module-level logo-only mem cache (NOT localStorage — lives for the
// tab session only) so navigating away and back skips even the cache lookup.
// A concurrent inflight promise is deduped so two VCIntelHub mounts in the
// same tick don't double-fire.
// ═══════════════════════════════════════════════════════════════════════════

let _logoMemCache = null      // { [SYM]: imageUrl } once resolved
let _logoMemInflight = null   // Promise<{ [SYM]: imageUrl }> while fetching

async function fetchLogosForSymbols(symbols) {
  if (_logoMemCache) return _logoMemCache
  if (_logoMemInflight) return _logoMemInflight

  _logoMemInflight = getPriceRows(symbols)
    .then((rows) => {
      const next = {}
      for (const [sym, row] of Object.entries(rows)) {
        if (row?.image) next[String(sym).toUpperCase()] = row.image
      }
      // Only commit the cache on a real response. Transient failures
      // (empty next) should NOT poison the cache and block a retry on
      // next navigation.
      if (Object.keys(next).length > 0) {
        _logoMemCache = next
      }
      _logoMemInflight = null
      return next
    })
    .catch(() => {
      _logoMemInflight = null
      return {}
    })

  return _logoMemInflight
}

function useTokenLogos(entities) {
  const [tokenLogoMap, setTokenLogoMap] = useState(() => _logoMemCache || {})

  // Stable sorted symbol string so the effect only re-fires when the set
  // actually changes (not every render).
  const symbolString = useMemo(() => {
    const set = new Set()
    for (const e of entities) {
      for (const t of (e.known_portfolio_tokens || [])) {
        if (t) set.add(String(t).toUpperCase())
      }
    }
    return [...set].sort().join(',')
  }, [entities])

  useEffect(() => {
    if (!symbolString) return
    // Cache hit: state was already seeded from _logoMemCache, no work.
    if (_logoMemCache) return

    let cancelled = false
    const symbols = symbolString.split(',')

    fetchLogosForSymbols(symbols).then((next) => {
      if (cancelled) return
      if (next && Object.keys(next).length > 0) {
        setTokenLogoMap(next)
      }
    })

    return () => { cancelled = true }
  }, [symbolString])

  return tokenLogoMap
}

// ═══════════════════════════════════════════════════════════════════════════
// Token chip with logo
// ═══════════════════════════════════════════════════════════════════════════

function TokenChip({ symbol, logoUrl, isNew, since, live }) {
  const [broken, setBroken] = useState(false)
  const sym = String(symbol).toUpperCase()
  const sinceYear = since ? new Date(since).getFullYear() : null
  // Live 24h change from the shared /v1/prices feed (30s poll).
  const ch = live && Number.isFinite(live.change24h) ? live.change24h : null
  const titleParts = []
  if (since) titleParts.push(`Backed since ${new Date(since).toLocaleDateString()}`)
  if (Number.isFinite(live?.marketCap)) titleParts.push(`Mcap ${(live.marketCap / 1e9).toFixed(2)}B`)
  return (
    <div className={`vcih-token-chip${isNew ? ' vcih-token-chip--new' : ''}`} title={titleParts.join(' · ') || undefined}>
      {logoUrl && !broken ? (
        <img
          src={logoUrl}
          alt=""
          className="vcih-token-chip-logo"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="vcih-token-chip-fallback" aria-hidden="true">
          {sym.slice(0, 1)}
        </span>
      )}
      <span className="vcih-token-chip-sym">${sym}</span>
      {ch != null && (
        <span className={`vcih-token-chip-chg${ch >= 0 ? ' vcih-token-chip-chg--up' : ' vcih-token-chip-chg--down'}`}>
          {ch >= 0 ? '+' : ''}{ch.toFixed(1)}%
        </span>
      )}
      {isNew && <span className="vcih-chip-tag">NEW</span>}
      {!isNew && ch == null && sinceYear && <span className="vcih-chip-since">'{String(sinceYear).slice(2)}</span>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Company card with logo
// ═══════════════════════════════════════════════════════════════════════════

// Normalize a company/project name for matching against fundraising rounds.
function normCompanyName(s) {
  return String(s || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/\s*(labs|protocol|finance|network|foundation|inc\.?)\s*$/i, '').replace(/[^a-z0-9]/g, '').trim()
}

function CompanyCard({ name, round }) {
  const { t } = useTranslation()
  const [broken, setBroken] = useState(false)
  const logo = projectLogoUrl(name)
  const initials = (name || '?').replace(/\(.*?\)/g, '').trim().slice(0, 2).toUpperCase()
  // Real round detail when this company appears in the fundraising graph.
  const detail = round
    ? [round.roundType, round.amount ? `$${(round.amount / 1e6).toFixed(0)}M` : null, round.date ? `'${String(new Date(round.date).getFullYear()).slice(2)}` : null].filter(Boolean).join(' · ')
    : null
  return (
    <div className={`vcih-company-card${round?.isLead ? ' vcih-company-card--lead' : ''}`}>
      <div className="vcih-company-logo-wrap">
        {logo && !broken ? (
          <img
            src={logo}
            alt=""
            className="vcih-company-logo"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="vcih-company-logo vcih-company-logo--fallback">{initials}</div>
        )}
      </div>
      <div className="vcih-company-body">
        <div className="vcih-company-name">
          {name}
          {round?.isLead && <span className="vcih-company-led">LED</span>}
        </div>
        <div className="vcih-company-meta">{detail || t('ventures.vcHub.portfolioInvestment')}</div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Logo with fallback to initials circle
// ═══════════════════════════════════════════════════════════════════════════

function EntityLogo({ entity, size = 28 }) {
  const [broken, setBroken] = useState(false)
  const src = !broken ? logoFromDomain(entity.logo_domain) : null
  const initials = (entity.name || '?').slice(0, 2).toUpperCase()
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="vcih-logo"
        style={{ width: size, height: size, borderRadius: size > 32 ? 12 : 8 }}
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <div
      className="vcih-logo vcih-logo--fallback"
      style={{
        width: size,
        height: size,
        borderRadius: size > 32 ? 12 : 8,
        fontSize: Math.max(9, Math.round(size * 0.34)),
      }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Left panel — entity list
// ═══════════════════════════════════════════════════════════════════════════

function EntityList({ entities, selectedId, onSelect, searchQuery, onSearchChange, typeFilter, onTypeFilterChange, sectorFilter, onToggleSector, onClearSectors }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const filtered = useMemo(() => {
    let list = entities
    if (typeFilter !== 'all') {
      list = list.filter((e) => e.type === typeFilter)
    }
    if (sectorFilter.length > 0) {
      list = list.filter((e) => matchesSectors(e, sectorFilter))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((e) => {
        const name = (e.name || '').toLowerCase()
        const full = (e.full_name || '').toLowerCase()
        const sectors = (e.focus_sectors || []).join(',').toLowerCase()
        return name.includes(q) || full.includes(q) || sectors.includes(q)
      })
    }
    // Sort: tier ASC, then name ASC
    return [...list].sort((a, b) => {
      if ((a.tier || 99) !== (b.tier || 99)) return (a.tier || 99) - (b.tier || 99)
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [entities, typeFilter, sectorFilter, searchQuery])

  return (
    <aside className="vcih-left">
      <div className="vcih-search-wrap">
        <svg className="vcih-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="vcih-search"
          placeholder={t('ventures.vcHub.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchQuery && (
          <button
            className="vcih-search-clear"
            onClick={() => onSearchChange('')}
            aria-label={t('ventures.vcHub.clearSearch')}
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <div className="vcih-type-tabs">
        {ENTITY_TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`vcih-type-tab${typeFilter === f.value ? ' vcih-type-tab--active' : ''}`}
            onClick={() => onTypeFilterChange(f.value)}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <div className="vcih-sector-tabs">
        {VC_SECTOR_FILTERS.map((f) => {
          const active = sectorFilter.includes(f.value)
          return (
            <button
              key={f.value}
              type="button"
              className={`vcih-sector-tab${active ? ' vcih-sector-tab--active' : ''}`}
              onClick={() => onToggleSector(f.value)}
            >
              {f.label}
            </button>
          )
        })}
        {sectorFilter.length > 0 && (
          <button
            type="button"
            className="vcih-sector-clear"
            onClick={onClearSectors}
          >
            Clear
          </button>
        )}
      </div>

      <div className="vcih-entity-count">
        {t(filtered.length === 1 ? 'ventures.vcHub.entityCountOne' : 'ventures.vcHub.entityCountOther', { count: filtered.length })}
      </div>

      <div className="vcih-entity-list">
        {filtered.map((entity) => {
          const type = typeBadge(entity.type)
          const active = entity.id === selectedId
          return (
            <button
              key={entity.id}
              type="button"
              className={`vcih-entity-row${active ? ' vcih-entity-row--active' : ''}`}
              onClick={() => onSelect(entity.id)}
            >
              <EntityLogo entity={entity} size={28} />
              <div className="vcih-entity-text">
                <div className="vcih-entity-name">{entity.name}</div>
                <div className="vcih-entity-meta">
                  <span className="vcih-type-pill">{type.label}</span>
                  {entity.aum_estimate && (
                    <span className="vcih-aum">{formatAumString(entity.aum_estimate, fmtLargeShort)}</span>
                  )}
                </div>
              </div>
              {entity.tier && (
                <span className="vcih-tier-dot" style={{ background: tierBadgeColor(entity.tier) }} title={`Tier ${entity.tier}`} />
              )}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="vcih-empty">{t('ventures.vcHub.noEntitiesMatch')}</div>
        )}
      </div>
    </aside>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Live fund activity — derived from the fundraising graph (useVcInvestments)
// ═══════════════════════════════════════════════════════════════════════════
//
// The vc-database.json header stats (AUM / investment count) are a static,
// bundled seed that never moves. These helpers turn the LIVE fundraising
// rounds into the numbers the profile actually shows: how many tracked rounds,
// when the fund was last active, and how much tracked capital it has deployed.
function computeLiveFundStats(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return { count: 0, lastActiveMs: null, deployedUsd: 0, leadCount: 0 }
  }
  let deployedUsd = 0
  let leadCount = 0
  let lastActiveMs = null
  for (const r of rounds) {
    if (Number.isFinite(r.amount)) deployedUsd += r.amount
    if (r.isLead) leadCount += 1
    const ms = r.date ? Date.parse(r.date) : NaN
    if (Number.isFinite(ms) && (lastActiveMs == null || ms > lastActiveMs)) lastActiveMs = ms
  }
  return { count: rounds.length, lastActiveMs, deployedUsd, leadCount }
}

// Relative age at VC cadence (weeks/months/years) — FreshnessTag's minute/hour
// tiers are the wrong scale for fundraising activity.
function fmtRelAge(ms) {
  if (!Number.isFinite(ms)) return null
  const d = Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
  if (d <= 0) return 'today'
  if (d < 7) return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  const y = Math.floor(d / 365)
  const rem = Math.floor((d % 365) / 30)
  return rem > 0 ? `${y}y ${rem}mo ago` : `${y}y ago`
}

// VC-appropriate recency for the "last active" dot: fresh <90d, slowing <1y,
// dormant beyond. An honest signal about how current the tracked activity is.
function recencyStatus(ms) {
  if (!Number.isFinite(ms)) return 'none'
  const d = (Date.now() - ms) / 86_400_000
  if (d <= 90) return 'fresh'
  if (d <= 365) return 'slowing'
  return 'dormant'
}

// ═══════════════════════════════════════════════════════════════════════════
// Center panel — profile + tabs
// ═══════════════════════════════════════════════════════════════════════════

function VCProfilePanel({ entity, tokenLogoMap, priceMap }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const [activeTab, setActiveTab] = useState('portfolio')

  // Dated investment context: real round dates per project + locally-detected
  // newly-added tokens, used to tag holdings in the Portfolio tab.
  const { rounds, byProject: investedDates, byName: roundsByName } = useVcInvestments(entity)
  // Live header stats from the fundraising graph — replace the frozen seed
  // values (investment count) and add tracked-deployed + last-active.
  const liveStats = useMemo(() => computeLiveFundStats(rounds), [rounds])
  const newTokens = useMemo(() => {
    if (!entity) return new Set()
    const snap = reconcileSnapshot(entity.id, (entity.known_portfolio_tokens || []).filter(isTradeableSymbol))
    const set = new Set(snap.added)
    // also flag positions whose first real round is < 120 days old
    for (const [sym, date] of Object.entries(investedDates || {})) {
      if (date && (Date.now() - new Date(date).getTime()) / 86400000 < 120) set.add(sym)
    }
    return set
  }, [entity, investedDates])

  if (!entity) {
    return (
      <div className="vcih-center vcih-center--empty">
        <div className="vcih-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <div className="vcih-empty-title">{t('ventures.vcHub.emptyTitle')}</div>
          <div className="vcih-empty-sub">{t('ventures.vcHub.emptySub')}</div>
        </div>
      </div>
    )
  }

  const type = typeBadge(entity.type)

  return (
    <section className="vcih-center">
      {/* Header */}
      <div className="vcih-profile-header">
        <div className="vcih-profile-identity">
          <EntityLogo entity={entity} size={56} />
          <div className="vcih-profile-text">
            <h2 className="vcih-profile-name">
              {entity.name}
              {entity.tier === 1 && <span className="vcih-tier-badge vcih-tier-badge--gold">{t('ventures.vcHub.tier1')}</span>}
            </h2>
            <div className="vcih-profile-sub">
              <span className="vcih-type-pill vcih-type-pill--lg">{type.label}</span>
              {entity.website && (
                <a className="vcih-profile-link" href={entity.website} target="_blank" rel="noopener noreferrer">
                  {entity.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="vcih-profile-stats">
          {entity.aum_estimate && (
            <div className="vcih-profile-stat">
              <div className="vcih-profile-stat-label">
                {t('ventures.vcHub.stats.aum')} <span className="vcih-stat-qual">est.</span>
              </div>
              <div className="vcih-profile-stat-value">{formatAumString(entity.aum_estimate, fmtLargeShort)}</div>
            </div>
          )}
          {liveStats.deployedUsd > 0 && (
            <div className="vcih-profile-stat">
              <div className="vcih-profile-stat-label">
                {t('ventures.vcHub.stats.deployed', 'Deployed (tracked)')} <span className="vcih-stat-live">live</span>
              </div>
              <div className="vcih-profile-stat-value">{fmtLargeShort(liveStats.deployedUsd)}</div>
            </div>
          )}
          {entity.founded && (
            <div className="vcih-profile-stat">
              <div className="vcih-profile-stat-label">{t('ventures.vcHub.stats.founded')}</div>
              <div className="vcih-profile-stat-value">{entity.founded}</div>
            </div>
          )}
          {(liveStats.count > 0 || entity.total_investments_tracked != null) && (
            <div className="vcih-profile-stat">
              <div className="vcih-profile-stat-label">
                {t('ventures.vcHub.stats.investments')}{' '}
                <span className={liveStats.count > 0 ? 'vcih-stat-live' : 'vcih-stat-qual'}>
                  {liveStats.count > 0 ? 'live' : 'est.'}
                </span>
              </div>
              <div className="vcih-profile-stat-value">
                {liveStats.count > 0 ? liveStats.count : entity.total_investments_tracked}
              </div>
            </div>
          )}
          {liveStats.lastActiveMs && (
            <div className="vcih-profile-stat">
              <div className="vcih-profile-stat-label">{t('ventures.vcHub.stats.lastActive', 'Last active')}</div>
              <div className="vcih-profile-stat-value vcih-profile-stat-value--sm">
                <span className={`vcih-recency-dot vcih-recency-dot--${recencyStatus(liveStats.lastActiveMs)}`} aria-hidden="true" />
                {fmtRelAge(liveStats.lastActiveMs)}
              </div>
            </div>
          )}
          {entity.hq && (
            <div className="vcih-profile-stat">
              <div className="vcih-profile-stat-label">{t('ventures.vcHub.stats.hq')}</div>
              <div className="vcih-profile-stat-value">{entity.hq}</div>
            </div>
          )}
        </div>
        {entity.focus_sectors?.length > 0 && (
          <div className="vcih-focus-tags">
            {entity.focus_sectors.map((s) => (
              <span key={s} className="vcih-focus-tag">{s}</span>
            ))}
          </div>
        )}
        {entity.thesis && (
          <p className="vcih-thesis">{entity.thesis}</p>
        )}
      </div>

      {/* AI Analyst — always-on read of what this fund is doing */}
      <VcAiAnalyst entity={entity} priceMap={priceMap} />

      {/* Tabs */}
      <div className="vcih-tabs">
        {PROFILE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`vcih-tab${activeTab === tab.value ? ' vcih-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.value)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="vcih-tab-content">
        {activeTab === 'portfolio' && <PortfolioTab entity={entity} tokenLogoMap={tokenLogoMap} priceMap={priceMap} investedDates={investedDates} newTokens={newTokens} roundsByName={roundsByName} />}
        {activeTab === 'holdings'  && <HoldingsTab entity={entity} tokenLogoMap={tokenLogoMap} />}
        {activeTab === 'activity'  && <VcInvestmentActivity entity={entity} />}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Tabs — Phase 1 uses static data only
// ═══════════════════════════════════════════════════════════════════════════

function PortfolioTab({ entity, tokenLogoMap, priceMap, investedDates, newTokens, roundsByName }) {
  const { t } = useTranslation()
  const companies = entity.known_portfolio_companies || []
  const tokens = entity.known_portfolio_tokens || []
  // Any live 24h change across the holdings means the price overlay is warm.
  const hasLive = tokens.some((s) => Number.isFinite(priceMap?.[String(s).toUpperCase()]?.change24h))

  if (companies.length === 0 && tokens.length === 0) {
    return (
      <div className="vcih-tab-empty">
        {t('ventures.vcHub.portfolioComingOnline')}
      </div>
    )
  }

  return (
    <div className="vcih-portfolio">
      <div className="vcih-portfolio-source">
        <span className="vcih-source-dot" />
        {t('ventures.vcHub.staticSeed')}
        {hasLive && (
          <span className="vcih-source-live">
            <span className="vcih-source-live-dot" />
            {t('ventures.vcHub.livePrices', 'live prices')}
          </span>
        )}
      </div>

      {tokens.length > 0 && (
        <section className="vcih-portfolio-section">
          <div className="vcih-section-head">
            <h3 className="vcih-section-title">
              {t('ventures.vcHub.knownTokenHoldings')}
              <InfoTip text="Tokens this entity is publicly known to hold or back. 24h change is live." position="bottom" />
            </h3>
            <span className="vcih-section-count">{tokens.length}</span>
          </div>
          <div className="vcih-token-grid">
            {tokens.map((sym) => {
              const u = String(sym).toUpperCase()
              return (
                <TokenChip
                  key={sym}
                  symbol={sym}
                  logoUrl={tokenLogoMap?.[u] || null}
                  isNew={newTokens?.has(u)}
                  since={investedDates?.[u]}
                  live={priceMap?.[u] || null}
                />
              )
            })}
          </div>
        </section>
      )}

      {companies.length > 0 && (
        <section className="vcih-portfolio-section">
          <div className="vcih-section-head">
            <h3 className="vcih-section-title">
              {t('ventures.vcHub.portfolioCompanies')}
              <InfoTip text="Projects this entity has invested in or publicly supported." position="bottom" />
            </h3>
            <span className="vcih-section-count">{companies.length}</span>
          </div>
          <div className="vcih-company-grid">
            {companies.map((name, i) => (
              <CompanyCard key={`${name}-${i}`} name={name} round={roundsByName?.[normCompanyName(name)]} />
            ))}
          </div>
        </section>
      )}

      {entity.recent_focus_2026 && entity.recent_focus_2026.length > 0 && (
        <section className="vcih-portfolio-section">
          <div className="vcih-section-head">
            <h3 className="vcih-section-title">{t('ventures.vcHub.focus2026')}</h3>
          </div>
          <div className="vcih-focus-cards">
            {entity.recent_focus_2026.map((f) => (
              <div key={f} className="vcih-focus-card">{f}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function HoldingsTab({ entity, tokenLogoMap }) {
  const { t } = useTranslation()
  return (
    <div className="vcih-tab-empty vcih-tab-phase">
      <div className="vcih-phase-label">{t('ventures.vcHub.holdingsPhaseLabel')}</div>
      <div className="vcih-phase-title">{t('ventures.vcHub.holdingsPhaseTitle')}</div>
      <p className="vcih-phase-sub">{t('ventures.vcHub.holdingsPhaseSub')}</p>
      {(entity.known_portfolio_tokens?.length > 0) && (
        <div className="vcih-phase-preview">
          <div className="vcih-phase-preview-label">{t('ventures.vcHub.knownExposure')}</div>
          <div className="vcih-token-grid">
            {entity.known_portfolio_tokens.map((sym) => (
              <TokenChip
                key={sym}
                symbol={sym}
                logoUrl={tokenLogoMap?.[String(sym).toUpperCase()] || null}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityTab({ entity }) {
  const { t } = useTranslation()
  return (
    <div className="vcih-tab-empty vcih-tab-phase">
      <div className="vcih-phase-label">{t('ventures.vcHub.activityPhaseLabel')}</div>
      <div className="vcih-phase-title">{t('ventures.vcHub.activityPhaseTitle')}</div>
      <p className="vcih-phase-sub">{t('ventures.vcHub.activityPhaseSub')}</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Right panel — unified activity feed (placeholder for Phase 2+)
// ═══════════════════════════════════════════════════════════════════════════

function UnifiedActivityFeed({ entities }) {
  const { t } = useTranslation()
  // Phase 1 placeholder: synthesize a shell feed from static focus areas so
  // the panel has visual weight even before /v1/vc/activity/feed comes online.
  const shellItems = useMemo(() => {
    const out = []
    entities.slice(0, 30).forEach((e) => {
      if (e.recent_focus_2026 && e.recent_focus_2026[0]) {
        out.push({
          entity: e,
          action: e.recent_focus_2026.slice(0, 2).join(' · '),
          type: 'narrative',
        })
      }
    })
    return out.slice(0, 20)
  }, [entities])

  return (
    <aside className="vcih-right">
      <div className="vcih-right-header">
        <div className="vcih-right-title">
          {t('ventures.vcHub.activityFeedTitle')}
          <InfoTip text="Each tracked fund's stated 2026 conviction — where smart money says it is rotating." position="left" />
        </div>
        <div className="vcih-right-sub">{t('ventures.vcHub.activityFeedSub')}</div>
      </div>

      <div className="vcih-feed">
        {shellItems.map((item, i) => {
          const type = typeBadge(item.entity.type)
          return (
            <div key={`${item.entity.id}-${i}`} className="vcih-feed-item">
              <EntityLogo entity={item.entity} size={24} />
              <div className="vcih-feed-body">
                <div className="vcih-feed-entity">{item.entity.name}</div>
                <div className="vcih-feed-action">{item.action}</div>
                <div className="vcih-feed-meta">
                  <span className="vcih-feed-src">{type.label}</span>
                </div>
              </div>
            </div>
          )
        })}
        {shellItems.length === 0 && (
          <div className="vcih-empty">{t('ventures.vcHub.feedComesOnline')}</div>
        )}
      </div>
    </aside>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Root
// ═══════════════════════════════════════════════════════════════════════════

const VCIntelHub = () => {
  // Load static entity list. Always available — no loading state needed.
  const entities = useMemo(() => Object.values(vcDatabase), [])
  const [selectedId, setSelectedId] = useState(() => entities[0]?.id || null)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sectorFilter, setSectorFilter] = useState([])

  const handleToggleSector = useCallback((value) => {
    setSectorFilter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }, [])
  const handleClearSectors = useCallback(() => setSectorFilter([]), [])

  // Fetch real token logos for every portfolio token across the full DB in
  // one batched Spectre API call. Module-level cache means re-opening the
  // Intel Hub is instant.
  const tokenLogoMap = useTokenLogos(entities)
  const [universeView, setUniverseView] = useState('consensus')
  const [universeOpen, setUniverseOpen] = useState(false) // collapsed at start — opt-in, lighter first paint
  // Lets a Token-Consensus row deep-link into the VC Bubbles graph focused on
  // that token (its backer constellation). Consumed by VCBubblesView.
  const [graphFocus, setGraphFocus] = useState(null)

  // Single live price feed shared by all three Universe views (30s poll).
  const { priceMap: universePriceMap } = useUniversePrices(entities)

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedId) || null,
    [entities, selectedId],
  )

  // Selecting from a Universe view updates the profile panel below silently —
  // no auto-scroll, so the active view (e.g. the bubble constellation) stays
  // in place. The explicit "open full profile" affordance scrolls on demand.
  const handleSelect = useCallback((id) => setSelectedId(id), [])
  const handleOpenProfile = useCallback((id) => {
    setSelectedId(id)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.querySelector('.vcih-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [])

  return (
    <div className="vcih-root vcih-root--with-universe">
      {/* ── Smart Money Universe · permanent top section ───────────────── */}
      <section className={`vcih-universe-section${universeOpen ? '' : ' vcih-universe-section--collapsed'}`}>
        <header className="vcih-universe-header">
          <div className="vcih-universe-headline">
            <h3 className="vcih-universe-title">Smart Money Universe</h3>
            <span className="vcih-universe-sub">{entities.length} funds · live cross-portfolio map</span>
          </div>
          <div className="vcih-universe-tabs" role="tablist" aria-label="Universe view">
            {UNIVERSE_VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={universeView === v.value}
                className={`vcih-universe-tab${universeView === v.value ? ' vcih-universe-tab--active' : ''}`}
                onClick={() => { setUniverseView(v.value); setUniverseOpen(true) }}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="vcih-universe-toggle"
            onClick={() => setUniverseOpen((o) => !o)}
            aria-label={universeOpen ? 'Collapse universe map' : 'Expand universe map'}
            title={universeOpen ? 'Collapse' : 'Expand'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {universeOpen ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
            </svg>
          </button>
        </header>
        {/* Suspense fallback is a shimmer, not "Loading…" text — mobile-design-system
            §K forbids loading copy and spinners; the skeleton also holds the
            universe's height so the sections below do not jump when it lands. */}
        {universeOpen && (
          <Suspense
            fallback={(
              <div className="vcih-universe-skel" aria-hidden="true">
                <span className="vcih-skel-line vcih-skel-line--head" />
                <span className="vcih-skel-line" />
                <span className="vcih-skel-line" />
                <span className="vcih-skel-line vcih-skel-line--short" />
              </div>
            )}
          >
            <div className="vcih-universe-body">
              {universeView === 'consensus' && (
                <VCUniverseMap
                  entities={entities}
                  priceMap={universePriceMap}
                  onSelectEntity={handleSelect}
                  onOpenToken={(sym) => { setGraphFocus({ type: 'token', symbol: sym }); setUniverseView('bubbles') }}
                />
              )}
              {universeView === 'bubbles' && (
                <VCBubblesView
                  entities={entities}
                  priceMap={universePriceMap}
                  onSelectEntity={handleSelect}
                  onOpenProfile={handleOpenProfile}
                  focus={graphFocus}
                  onFocusConsumed={() => setGraphFocus(null)}
                />
              )}
              {universeView === 'sectors' && (
                <VCSectorsGrid entities={entities} priceMap={universePriceMap} onSelectEntity={handleSelect} />
              )}
              {universeView === 'social' && (
                <VCSocialSignal entities={entities} priceMap={universePriceMap} />
              )}
            </div>
          </Suspense>
        )}
      </section>

      {/* ── 3-pane browse layout · always below the universe ───────────── */}
      <div className="vcih-grid">
        <EntityList
          entities={entities}
          selectedId={selectedId}
          onSelect={handleSelect}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          sectorFilter={sectorFilter}
          onToggleSector={handleToggleSector}
          onClearSectors={handleClearSectors}
        />
        <VCProfilePanel entity={selectedEntity} tokenLogoMap={tokenLogoMap} priceMap={universePriceMap} />
        <VcPulseFeed entity={selectedEntity} />
      </div>
    </div>
  )
}

export default VCIntelHub
