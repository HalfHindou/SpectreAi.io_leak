/**
 * cosmos-data.js — token → celestial-body model for the Spectre Cosmos.
 *
 * Pure math, no three.js. Builds the body list once per (tokens, timeframe)
 * change; the engine consumes it and animates between LAYOUTS:
 *   solar  — 3D orbital system. The market leader is the sun; orbit distance
 *            maps PERFORMANCE (gainers pulled toward the light, losers drift
 *            to the outer dark). Size maps market cap. Slight per-body
 *            inclination gives the disc organic 3D depth.
 *   map    — the same system flattened to the ecliptic, viewed top-down.
 *   galaxy — bodies regroup into ecosystem star-clusters arranged in a ring
 *            around the sun, with constellation lines inside each cluster.
 */

/* ── Ecosystem mapping (crypto) ── */
export const CRYPTO_ECOSYSTEM_MAP = {
  // Layer 1s
  BTC: 'Bitcoin', WBTC: 'Bitcoin', LBTC: 'Bitcoin',
  ETH: 'Ethereum', STETH: 'Ethereum', WETH: 'Ethereum', ETC: 'Ethereum', EETH: 'Ethereum',
  SOL: 'Solana', BNB: 'BNB Chain', ADA: 'Cardano', AVAX: 'Avalanche',
  DOT: 'Polkadot', KSM: 'Polkadot', ATOM: 'Cosmos', OSMO: 'Cosmos', INJ: 'Cosmos',
  NEAR: 'NEAR', APT: 'Aptos', SUI: 'Sui', TON: 'TON', NOT: 'TON',
  TRX: 'Tron', ICP: 'ICP', XRP: 'XRP', LTC: 'Litecoin',
  HBAR: 'Hedera', ALGO: 'Algorand', XLM: 'Stellar', FIL: 'Filecoin',
  // Ethereum ecosystem
  LINK: 'Ethereum', UNI: 'Ethereum', AAVE: 'Ethereum', MKR: 'Ethereum',
  LDO: 'Ethereum', CRV: 'Ethereum', GRT: 'Ethereum', ENS: 'Ethereum',
  PEPE: 'Ethereum', SHIB: 'Ethereum', FLOKI: 'Ethereum', DOGE: 'Meme',
  WIF: 'Solana', BONK: 'Solana', POPCAT: 'Solana', JUP: 'Solana', PYTH: 'Solana',
  RAY: 'Solana', ORCA: 'Solana', TRUMP: 'Solana', FARTCOIN: 'Solana',
  // Layer 2s
  ARB: 'Ethereum L2', OP: 'Ethereum L2', MATIC: 'Ethereum L2', POL: 'Ethereum L2',
  IMX: 'Ethereum L2', STRK: 'Ethereum L2', MNT: 'Ethereum L2', ZK: 'Ethereum L2',
  // AI
  FET: 'AI', TAO: 'AI', RENDER: 'AI', AKT: 'AI', RNDR: 'AI',
  VIRTUAL: 'AI', AIOZ: 'AI', AI16Z: 'AI',
  // Stablecoins
  USDT: 'Stablecoin', USDC: 'Stablecoin', DAI: 'Stablecoin', USDE: 'Stablecoin',
  FDUSD: 'Stablecoin', TUSD: 'Stablecoin', PYUSD: 'Stablecoin',
  // DeFi
  ONDO: 'RWA', PENDLE: 'DeFi', CAKE: 'BNB Chain', COMP: 'DeFi', SNX: 'DeFi',
  DYDX: 'DeFi', GMX: 'DeFi', '1INCH': 'DeFi',
  // Gaming
  AXS: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', GALA: 'Gaming', ILV: 'Gaming',
}

export const ECOSYSTEM_COLORS = {
  'Bitcoin':      [247, 147, 26],
  'Ethereum':     [98, 126, 234],
  'Solana':       [0, 255, 163],
  'BNB Chain':    [243, 186, 47],
  'Cardano':      [64, 115, 220],
  'Avalanche':    [232, 65, 66],
  'Polkadot':     [230, 0, 122],
  'Cosmos':       [166, 136, 241],
  'NEAR':         [0, 206, 160],
  'Aptos':        [42, 217, 143],
  'Sui':          [75, 160, 255],
  'TON':          [0, 136, 204],
  'Tron':         [255, 60, 60],
  'ICP':          [41, 171, 226],
  'XRP':          [70, 140, 200],
  'Litecoin':     [120, 150, 200],
  'Hedera':       [140, 140, 160],
  'Algorand':     [160, 160, 170],
  'Stellar':      [20, 177, 212],
  'Filecoin':     [66, 154, 232],
  'Ethereum L2':  [99, 102, 241],
  'AI':           [6, 182, 212],
  'Stablecoin':   [38, 161, 123],
  'DeFi':         [168, 85, 247],
  'RWA':          [251, 146, 60],
  'Meme':         [236, 72, 153],
  'Gaming':       [234, 179, 8],
  'Other':        [148, 163, 184],
}

const STOCK_SECTOR_COLORS = {
  Technology: [59, 130, 246],
  Semiconductor: [0, 200, 220],
  Financial: [168, 85, 247],
  Healthcare: [16, 185, 129],
  Consumer: [251, 146, 60],
  Communication: [236, 72, 153],
  Energy: [234, 179, 8],
  Industrial: [148, 163, 184],
  Automotive: [239, 68, 68],
  RealEstate: [45, 212, 191],
  Commodity: [212, 175, 55],
  Index: [99, 102, 241],
}

/**
 * Industry sector map — the primary classification (sector constellation,
 * galaxy clusters). Broad coverage of the CG top ~150 so sectors carry real
 * membership instead of dumping everything into 'Other'.
 */
export const CRYPTO_SECTOR_MAP = {
  // Bitcoin & Ethereum cores
  BTC: 'Bitcoin', WBTC: 'Bitcoin', LBTC: 'Bitcoin', CBBTC: 'Bitcoin',
  ETH: 'Ethereum', WETH: 'Ethereum', STETH: 'Ethereum', WSTETH: 'Ethereum',
  WEETH: 'Ethereum', EETH: 'Ethereum', RETH: 'Ethereum', WBETH: 'Ethereum', ETC: 'Ethereum',
  // Layer 1s
  SOL: 'Layer 1', ADA: 'Layer 1', TRX: 'Layer 1', TON: 'Layer 1', AVAX: 'Layer 1',
  HBAR: 'Layer 1', SUI: 'Layer 1', APT: 'Layer 1', NEAR: 'Layer 1', ICP: 'Layer 1',
  KAS: 'Layer 1', VET: 'Layer 1', ALGO: 'Layer 1', SEI: 'Layer 1', TIA: 'Layer 1',
  XTZ: 'Layer 1', EGLD: 'Layer 1', FLOW: 'Layer 1', NEO: 'Layer 1', CFX: 'Layer 1',
  PI: 'Layer 1', KAIA: 'Layer 1', BERA: 'Layer 1', S: 'Layer 1', FTM: 'Layer 1',
  XDC: 'Layer 1', EOS: 'Layer 1', ONE: 'Layer 1', TRON: 'Layer 1', INJ: 'Layer 1',
  MON: 'Layer 1', NIGHT: 'Layer 1', CC: 'Layer 1', HYPE: 'Layer 1',
  // Layer 2s
  ARB: 'Layer 2', OP: 'Layer 2', POL: 'Layer 2', MATIC: 'Layer 2', MNT: 'Layer 2',
  IMX: 'Layer 2', STRK: 'Layer 2', ZK: 'Layer 2', BLAST: 'Layer 2', STX: 'Layer 2',
  MOVE: 'Layer 2', METIS: 'Layer 2', MANTA: 'Layer 2',
  // DeFi
  UNI: 'DeFi', AAVE: 'DeFi', LINK: 'DeFi', SKY: 'DeFi', MKR: 'DeFi', CRV: 'DeFi',
  LDO: 'DeFi', PENDLE: 'DeFi', CAKE: 'DeFi', COMP: 'DeFi', SNX: 'DeFi', DYDX: 'DeFi',
  GMX: 'DeFi', RAY: 'DeFi', JUP: 'DeFi', JTO: 'DeFi', ENA: 'DeFi', ETHFI: 'DeFi',
  MORPHO: 'DeFi', AERO: 'DeFi', WLFI: 'DeFi', DEXE: 'DeFi', PYTH: 'DeFi',
  '1INCH': 'DeFi', SUSHI: 'DeFi', OSMO: 'DeFi', EIGEN: 'DeFi', ORCA: 'DeFi',
  PENGUIN: 'DeFi', LUNC: 'DeFi', ONDO: 'RWA',
  // Exchange tokens
  BNB: 'Exchange', LEO: 'Exchange', OKB: 'Exchange', BGB: 'Exchange', GT: 'Exchange',
  KCS: 'Exchange', CRO: 'Exchange', WBT: 'Exchange', HTX: 'Exchange', NEXO: 'Exchange',
  TWT: 'Exchange', HT: 'Exchange', FTT: 'Exchange', BSV: 'Payments',
  // Memes
  DOGE: 'Meme', SHIB: 'Meme', PEPE: 'Meme', WIF: 'Meme', FLOKI: 'Meme', BONK: 'Meme',
  PENGU: 'Meme', TRUMP: 'Meme', SPX: 'Meme', FARTCOIN: 'Meme', NOT: 'Meme', MOG: 'Meme',
  BRETT: 'Meme', POPCAT: 'Meme', M: 'Meme', TURBO: 'Meme', BABYDOGE: 'Meme', DOG: 'Meme',
  // AI
  TAO: 'AI', RENDER: 'AI', RNDR: 'AI', FET: 'AI', WLD: 'AI', GRT: 'AI', VIRTUAL: 'AI',
  AI16Z: 'AI', AKT: 'AI', AIOZ: 'AI', ARKM: 'AI', IO: 'AI', TRAC: 'AI',
  // Stablecoins
  USDT: 'Stablecoin', USDC: 'Stablecoin', DAI: 'Stablecoin', USDE: 'Stablecoin',
  USDS: 'Stablecoin', FDUSD: 'Stablecoin', PYUSD: 'Stablecoin', TUSD: 'Stablecoin',
  USD1: 'Stablecoin', USDD: 'Stablecoin', GUSD: 'Stablecoin', USDG: 'Stablecoin',
  USDT0: 'Stablecoin', USDF: 'Stablecoin', RLUSD: 'Stablecoin',
  // RWA & gold
  OM: 'RWA', PAXG: 'RWA', XAUT: 'RWA', USDY: 'RWA', OUSG: 'RWA',
  // Gaming & metaverse
  GALA: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', AXS: 'Gaming', ILV: 'Gaming',
  BEAM: 'Gaming', RON: 'Gaming', PIXEL: 'Gaming',
  // Payments
  XRP: 'Payments', XLM: 'Payments', LTC: 'Payments', BCH: 'Payments', DASH: 'Payments',
  XNO: 'Payments', ACH: 'Payments',
  // Privacy
  XMR: 'Privacy', ZEC: 'Privacy', SCRT: 'Privacy', ZEN: 'Privacy',
  // DePIN & storage
  FIL: 'DePIN', AR: 'DePIN', HNT: 'DePIN', IOTA: 'DePIN', THETA: 'DePIN',
  BTT: 'DePIN', STORJ: 'DePIN', IOTX: 'DePIN',
  // Interop
  DOT: 'Interop', KSM: 'Interop', ATOM: 'Interop', QNT: 'Interop', FLR: 'Interop',
  W: 'Interop', ZRO: 'Interop', AXL: 'Interop',
  // Social & identity
  ENS: 'Social', ME: 'Social', CHZ: 'Social', GAL: 'Social',
}

export function groupOf(token, isStocks) {
  if (isStocks) return token.sector || 'Other'
  const sym = (token.symbol || '').toUpperCase()
  return CRYPTO_SECTOR_MAP[sym] || CRYPTO_ECOSYSTEM_MAP[sym] || 'Other'
}

/* ── chain resolution (per-chain filter) ──
   Sources, in priority order: explicit native-chain overrides (L2s + newer
   L1s the ecosystem map files under sectors), the X Dash catalog's `chain`
   field (matched by symbol), then the ecosystem map's chain-name groups. */
const CHAIN_OVERRIDES = {
  ARB: 'Arbitrum', OP: 'Optimism', POL: 'Polygon', MATIC: 'Polygon',
  MNT: 'Mantle', STRK: 'Starknet', IMX: 'Immutable', ZK: 'zkSync',
  STX: 'Stacks', TIA: 'Celestia', SEI: 'Sei', INJ: 'Injective',
  KAS: 'Kaspa', HYPE: 'Hyperliquid', S: 'Sonic', BERA: 'Berachain',
  APT: 'Aptos', SUI: 'Sui', NEAR: 'NEAR', MOVE: 'Movement',
  DOGE: 'Dogecoin', BCH: 'Bitcoin Cash', XMR: 'Monero', ZEC: 'Zcash',
  DASH: 'Dash', ETC: 'Ethereum Classic', VET: 'VeChain', EGLD: 'MultiversX',
  FLOW: 'Flow', XTZ: 'Tezos', NEO: 'Neo', IOTA: 'IOTA', CRO: 'Cronos',
  KAIA: 'Kaia', FLR: 'Flare', XDC: 'XDC', CFX: 'Conflux', MON: 'Monad',
}
const CHAIN_GROUPS = new Set([
  'Bitcoin', 'Ethereum', 'Solana', 'BNB Chain', 'Cardano', 'Avalanche',
  'Polkadot', 'Cosmos', 'NEAR', 'Aptos', 'Sui', 'TON', 'Tron', 'ICP',
  'XRP', 'Litecoin', 'Hedera', 'Algorand', 'Stellar', 'Filecoin',
])
const CHAIN_ALIASES = {
  eth: 'Ethereum', ethereum: 'Ethereum', sol: 'Solana', solana: 'Solana',
  bsc: 'BNB Chain', bnb: 'BNB Chain', 'binance-smart-chain': 'BNB Chain',
  base: 'Base', arbitrum: 'Arbitrum', 'arbitrum-one': 'Arbitrum',
  polygon: 'Polygon', 'polygon-pos': 'Polygon', optimism: 'Optimism',
  'optimistic-ethereum': 'Optimism', avalanche: 'Avalanche', avax: 'Avalanche',
  sui: 'Sui', aptos: 'Aptos', ton: 'TON', 'the-open-network': 'TON',
  tron: 'Tron', hyperliquid: 'Hyperliquid', blast: 'Blast', sei: 'Sei',
  near: 'NEAR', 'near-protocol': 'NEAR', cardano: 'Cardano', abstract: 'Abstract',
  hyperevm: 'Hyperliquid', linea: 'Linea', scroll: 'Scroll', monad: 'Monad',
  berachain: 'Berachain', sonic: 'Sonic', xrp: 'XRP', 'xrp-ledger': 'XRP',
}

export function normalizeChain(raw) {
  if (!raw || typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  if (CHAIN_ALIASES[key]) return CHAIN_ALIASES[key]
  // title-case whatever the catalog calls it
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function chainOf(symbol, xdashChain) {
  const sym = (symbol || '').toUpperCase()
  if (CHAIN_OVERRIDES[sym]) return CHAIN_OVERRIDES[sym]
  const fromCatalog = normalizeChain(xdashChain)
  if (fromCatalog) return fromCatalog
  const eco = CRYPTO_ECOSYSTEM_MAP[sym]
  if (eco && CHAIN_GROUPS.has(eco)) return eco
  return null
}

const SECTOR_COLORS = {
  'Bitcoin':    [247, 147, 26],
  'Ethereum':   [98, 126, 234],
  'Layer 1':    [90, 160, 255],
  'Layer 2':    [99, 102, 241],
  'DeFi':       [168, 85, 247],
  'Exchange':   [243, 186, 47],
  'Meme':       [236, 72, 153],
  'AI':         [6, 182, 212],
  'Stablecoin': [38, 161, 123],
  'RWA':        [251, 146, 60],
  'Gaming':     [234, 179, 8],
  'Payments':   [20, 177, 212],
  'Privacy':    [128, 138, 160],
  'DePIN':      [45, 212, 191],
  'Interop':    [166, 136, 241],
  'Social':     [103, 232, 249],
  'Other':      [148, 163, 184],
}

/* stable generated color for group names outside the palettes (e.g. X Dash
   category strings) — hue from the name hash, kept soft/luminous */
function hashColor(key) {
  const h = hash01('col·' + key) * 360
  const f = (n) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (0.62 - 0.34 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export function groupColor(group, isStocks) {
  if (isStocks) return STOCK_SECTOR_COLORS[group] || ECOSYSTEM_COLORS.Other
  return SECTOR_COLORS[group] || ECOSYSTEM_COLORS[group] || hashColor(group)
}

/* X Dash rows carry catalog categories — turn them into readable group names */
export function categoryGroup(row) {
  const raw = row?.primary_category || row?.category || (Array.isArray(row?.tags) ? row.tags[0] : null)
  if (!raw || typeof raw !== 'string') return 'Social'
  const cleaned = raw.replace(/[-_]+/g, ' ').trim()
  if (!cleaned) return 'Social'
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ── World-unit scales (the engine's world is ~[-160..160]) ── */
export const WORLD = {
  minOrbit: 26,       // innermost orbit (hot zone, big gainers)
  maxOrbit: 150,      // outermost orbit (deep red space)
  neutralOrbit: 82,   // ±0% sits here
  minBody: 2.2,       // smallest planet radius
  maxBody: 8.5,       // biggest planet radius
  sunRadius: 11,
  galaxyRingRadius: 96,   // distance of cluster hubs from the sun
  galaxySpread: 30,       // cluster local radius
}

/**
 * Performance → orbit distance. Gainers fall toward the sun, losers drift out.
 * ±25% saturates the band. Sqrt curve spreads the common ±0-3% moves across
 * the band instead of piling everything onto one neutral ring.
 */
export function orbitForChange(change) {
  const c = Math.max(-25, Math.min(25, change || 0))
  if (c >= 0) {
    const t = Math.sqrt(c / 25)
    return WORLD.neutralOrbit - t * (WORLD.neutralOrbit - WORLD.minOrbit)
  }
  const t = Math.sqrt(-c / 25)
  return WORLD.neutralOrbit + t * (WORLD.maxOrbit - WORLD.neutralOrbit)
}

/* deterministic per-symbol hash 0..1 so layouts are stable across refreshes */
export function hash01(str) {
  let h = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/* Golden-angle phase respacing: hash-random phases let same-orbit tokens
   stack at the same angle (the "too clustered" complaint). Walking the
   radius-sorted bodies with the golden angle interleaves neighbors like
   sunflower seeds — quasi-uniform disc coverage, no physics needed. */
export function respacePhases(bodies) {
  const order = bodies
    .map((b, i) => [b.orbitRadius, i])
    .sort((a, b) => a[0] - b[0])
  order.forEach(([, bi], k) => {
    const b = bodies[bi]
    b.phase = k * 2.399963 + b.seed * 0.5
  })
}

/* galaxy layout: clusters sized by membership (constant per-member spacing so
   big clusters GROW instead of cramming), hubs on a ring wide enough to fit
   every cluster's diameter plus breathing room, with vertical banding so
   neighboring clusters separate in depth — navigable, not a wall of chips */
export function layoutGalaxy(bodies, groupsMap) {
  const groups = [...groupsMap.values()].sort((a, b) => b.count - a.count)
  // spacing must respect PLANET SIZE, not just membership: phyllotaxis packs
  // cleanly when neighbor distance ≈ the largest body's diameter + a gap
  for (const g of groups) {
    let maxR = 3
    for (const bi of g.members) maxR = Math.max(maxR, bodies[bi].radius)
    g.spacing = maxR * 2.15 + 2.5
    g.rad = Math.max(10, Math.sqrt(g.count) * g.spacing)
  }
  const circumference = groups.reduce((s, g) => s + g.rad * 2.6, 0)
  const maxClusterRad = groups.reduce((m, g) => Math.max(m, g.rad), 0)
  // ring must fit every cluster's arc AND keep the biggest cluster off the sun
  const ringR = Math.max(
    WORLD.galaxyRingRadius,
    circumference / (Math.PI * 2),
    maxClusterRad + 62,
  )
  let acc = 0
  for (const g of groups) {
    const w = (g.rad * 2.6) / circumference
    const angle = (acc + w / 2) * Math.PI * 2
    acc += w
    g.angle = angle
    g.hub = {
      x: Math.cos(angle) * ringR,
      z: Math.sin(angle) * ringR,
    }
    const bandY = (hash01('band·' + g.key) - 0.5) * 34
    // local golden-spiral placement inside the cluster — size-aware spacing
    g.members.forEach((bi, k) => {
      const b = bodies[bi]
      const a = k * 2.399963 + g.angle
      b.galaxy = {
        // orbit slowly around the hub
        cx: g.hub.x, cz: g.hub.z,
        r: Math.max(3.5, Math.sqrt(k + 0.5) * g.spacing),
        phase: a,
        y: bandY + (hash01(b.id + '·y') - 0.5) * 12,
      }
    })
  }
  return groups
}

/**
 * Build the cosmos model.
 * Returns { sun, bodies, groups } — sun is the largest-mcap token (BTC in an
 * unfiltered crypto universe), bodies are everything else.
 */
export function buildCosmos(tokens, getChange, isStocks) {
  if (!tokens?.length) return { sun: null, bodies: [], groups: [] }

  // The heaviest object bends the space around it — it becomes the sun.
  let sunTok = tokens[0]
  for (const tk of tokens) {
    if ((tk.marketCap || 0) > (sunTok.marketCap || 0)) sunTok = tk
  }

  const rest = tokens.filter(tk => tk !== sunTok)

  // log-scale mcap → body radius
  let minM = Infinity, maxM = -Infinity
  for (const tk of rest) {
    const m = Math.max(1, tk.marketCap || 1)
    if (m < minM) minM = m
    if (m > maxM) maxM = m
  }
  if (!isFinite(minM)) { minM = 1; maxM = 1 }
  const logMin = Math.log(minM)
  const logRange = (Math.log(maxM) - logMin) || 1

  const groupsMap = new Map()

  const bodies = rest.map((token, i) => {
    const sym = (token.symbol || `#${i}`).toUpperCase()
    const change = getChange(token)
    const group = groupOf(token, isStocks)
    const gc = groupColor(group, isStocks)
    const logNorm = (Math.log(Math.max(1, token.marketCap || 1)) - logMin) / logRange
    const radius = WORLD.minBody + Math.pow(logNorm, 0.6) * (WORLD.maxBody - WORLD.minBody)
    const h = hash01(sym)
    const h2 = hash01(sym + '·2')
    const h3 = hash01(sym + '·3')

    let g = groupsMap.get(group)
    if (!g) { g = { key: group, color: gc, count: 0, members: [] }; groupsMap.set(group, g) }
    g.count++
    g.members.push(i)

    return {
      id: sym,
      token,
      change,
      group,
      groupColor: gc,
      radius,
      mcapNorm: logNorm,
      // orbital params (solar/map). Jitter keeps same-change tokens from
      // stacking on the exact same ring (engine re-adds it on re-targets).
      orbitJitter: (h3 - 0.5) * 13,
      orbitRadius: orbitForChange(change) + (h3 - 0.5) * 13,
      phase: h * Math.PI * 2,
      incline: (h2 - 0.5) * 0.42,          // ±12° plane tilt (solar view)
      inclinePhase: h3 * Math.PI * 2,
      // Kepler-ish: closer = faster; scaled to a contemplative pace
      speed: 0.14 / Math.sqrt(Math.max(0.2, orbitForChange(change) / WORLD.neutralOrbit)),
      dir: 1,
      seed: h,
    }
  })

  respacePhases(bodies)
  const groups = layoutGalaxy(bodies, groupsMap)

  const sun = sunTok ? {
    id: (sunTok.symbol || 'SUN').toUpperCase(),
    token: sunTok,
    change: getChange(sunTok),
  } : null

  return { sun, bodies, groups }
}

/**
 * Build the SECTOR CONSTELLATION — every sector/ecosystem collapses into one
 * star orbiting the sun. Star size = the sector's combined market cap, orbit
 * distance = the sector's mcap-weighted performance, the chip shows how many
 * worlds live inside. Clicking a sector star dives INTO it (the view swaps to
 * that sector's own solar system).
 */
export function buildSectorCosmos(tokens, getChange, isStocks) {
  if (!tokens?.length) return { sun: null, bodies: [], groups: [] }

  let sunTok = tokens[0]
  for (const tk of tokens) {
    if ((tk.marketCap || 0) > (sunTok.marketCap || 0)) sunTok = tk
  }
  const rest = tokens.filter(tk => tk !== sunTok)

  const secMap = new Map()
  for (const tk of rest) {
    const key = groupOf(tk, isStocks)
    let s = secMap.get(key)
    if (!s) { s = { key, count: 0, totalMcap: 0, wChange: 0 }; secMap.set(key, s) }
    s.count++
    const m = Math.max(1, tk.marketCap || 1)
    s.totalMcap += m
    s.wChange += getChange(tk) * m
  }

  const sectors = [...secMap.values()]
  let minM = Infinity, maxM = -Infinity
  for (const s of sectors) {
    if (s.totalMcap < minM) minM = s.totalMcap
    if (s.totalMcap > maxM) maxM = s.totalMcap
  }
  const logMin = Math.log(Math.max(1, minM))
  const logRange = (Math.log(Math.max(1, maxM)) - logMin) || 1

  const groupsMap = new Map()
  const bodies = sectors.map((s, i) => {
    const change = s.wChange / s.totalMcap
    const gc = groupColor(s.key, isStocks)
    const id = s.key.toUpperCase()
    const h = hash01('sec·' + s.key)
    const h2 = hash01('sec2·' + s.key)
    const h3 = hash01('sec3·' + s.key)
    const logNorm = (Math.log(Math.max(1, s.totalMcap)) - logMin) / logRange
    const orbitRadius = orbitForChange(change) + (h3 - 0.5) * 13

    let g = groupsMap.get(s.key)
    if (!g) { g = { key: s.key, color: gc, count: s.count, members: [i] }; groupsMap.set(s.key, g) }

    return {
      id,
      isSector: true,
      labelTitle: s.key,
      count: s.count,
      token: { symbol: s.key, name: s.key, marketCap: s.totalMcap },
      change,
      group: s.key,
      groupColor: gc,
      radius: 3.6 + Math.pow(logNorm, 0.7) * 6.4,
      mcapNorm: logNorm,
      orbitJitter: (h3 - 0.5) * 13,
      orbitRadius,
      phase: h * Math.PI * 2,
      incline: (h2 - 0.5) * 0.42,
      inclinePhase: h3 * Math.PI * 2,
      speed: 0.14 / Math.sqrt(Math.max(0.2, orbitRadius / WORLD.neutralOrbit)),
      dir: 1,
      seed: h,
    }
  })

  respacePhases(bodies)
  const groups = layoutGalaxy(bodies, groupsMap)
  const sun = {
    id: (sunTok.symbol || 'SUN').toUpperCase(),
    token: sunTok,
    change: getChange(sunTok),
  }
  return { sun, bodies, groups }
}

/**
 * Build the X DASH UNIVERSE — the social leaderboard AS the solar system.
 * Attention is gravity here: orbit distance = leaderboard rank (most-mentioned
 * closest to the light), size = mentions. Tokens that also exist in the market
 * universe carry their price/change; pure-social tokens glow cyan.
 *
 * anchorSun — pass the market universe's sun ({token, change}) to keep BTC at
 * the center ("with BTC"); pass null and the #1 social token takes the throne.
 */
export function buildSocialCosmos(xdashRows, count, anchorSun, marketTokens, getChange) {
  const rows = (xdashRows || []).slice(0, count)
  if (!rows.length) return { sun: null, bodies: [], groups: [] }

  const marketBySym = new Map()
  for (const tk of marketTokens || []) {
    marketBySym.set((tk.symbol || '').toUpperCase(), tk)
  }

  let sun = anchorSun
  let bodyRows = rows
  if (!sun) {
    const first = rows[0]
    const sym = (first.symbol || 'X').toUpperCase()
    const market = marketBySym.get(sym)
    sun = {
      id: sym,
      token: market || {
        symbol: sym,
        name: first.name || sym,
        logo: first.image_small || first.image || null,
        marketCap: Number(first.market_cap) || 0,
      },
      change: market ? getChange(market) : 0,
      noMarket: !market,
      mentions: Number(first.mentions ?? first.external_mentions) || 0,
      authors: Number(first.unique_authors_24h ?? first.author_count) || 0,
      velocity: Number(first.velocity_ratio) || 0,
    }
    bodyRows = rows.slice(1)
  } else {
    // anchor mode: drop the anchor itself from the field if it also trends
    bodyRows = rows.filter(r => (r.symbol || '').toUpperCase() !== sun.id)
  }

  let maxM = 1
  for (const r of bodyRows) maxM = Math.max(maxM, Number(r.mentions ?? r.external_mentions) || 1)
  const logMax = Math.log(maxM + 1)

  const groupsMap = new Map()
  const bodies = bodyRows.map((row, i) => {
    const sym = (row.symbol || `#${i}`).toUpperCase()
    const market = marketBySym.get(sym)
    const mentions = Number(row.mentions ?? row.external_mentions) || 0
    const authors = Number(row.unique_authors_24h ?? row.author_count) || 0
    const velocity = Number(row.velocity_ratio) || 0
    const noMarket = !market
    const change = market ? getChange(market) : 0
    // group by the token's catalog category (galaxy view clusters by these) —
    // 'Social' only when the catalog has nothing, so one blob can't form
    const group = noMarket ? categoryGroup(row) : groupOf(market, false)
    const gc = groupColor(group, false)
    const h = hash01('xd·' + sym)
    const h2 = hash01('xd2·' + sym)
    const h3 = hash01('xd3·' + sym)

    let g = groupsMap.get(group)
    if (!g) { g = { key: group, color: gc, count: 0, members: [] }; groupsMap.set(group, g) }
    g.count++
    g.members.push(i)

    // rank IS the orbit: #1 hugs the sun, the long tail drifts out
    const rankT = Math.sqrt(i / Math.max(1, bodyRows.length - 1))
    const orbitRadius = WORLD.minOrbit + rankT * (WORLD.maxOrbit - WORLD.minOrbit) + (h3 - 0.5) * 9
    const logNorm = Math.log(mentions + 1) / logMax
    const radius = WORLD.minBody + Math.pow(logNorm, 0.8) * (WORLD.maxBody - WORLD.minBody)

    return {
      id: sym,
      token: market || {
        symbol: sym,
        name: row.name || sym,
        logo: row.image_small || row.image || row.logo_url || null,
        marketCap: Number(row.market_cap) || 0,
        cgId: row.cg_id || row.token_id || null,
      },
      change,
      noMarket,
      mentions,
      authors,
      velocity,
      socialRank: i + (anchorSun ? 1 : 2),
      subLabel: noMarket ? `${mentions >= 1000 ? (mentions / 1000).toFixed(1) + 'k' : mentions} mentions` : null,
      group,
      groupColor: gc,
      radius,
      mcapNorm: logNorm,
      orbitJitter: (h3 - 0.5) * 9,
      orbitRadius,
      phase: h * Math.PI * 2,
      incline: (h2 - 0.5) * 0.42,
      inclinePhase: h3 * Math.PI * 2,
      speed: 0.14 / Math.sqrt(Math.max(0.2, orbitRadius / WORLD.neutralOrbit)),
      dir: 1,
      seed: h,
      // in the social universe every body pulses with its own attention
      social: { rank: i + 1, mentions, authors, velocity, intensity: Math.max(0.3, 1 - i / count) },
    }
  })

  respacePhases(bodies)
  const groups = layoutGalaxy(bodies, groupsMap)
  return { sun, bodies, groups }
}

/* ══════════════════ social layer (X Dash) ══════════════════ */

/**
 * Split the X Dash leaderboard into the two social primitives:
 *   auras  — leaderboard tokens that ALREADY orbit in this universe get a
 *            social heat aura (intensity by leaderboard rank).
 *   comets — trending tokens OUTSIDE the mcap universe become comets on
 *            eccentric ellipses: they dive in from the outer dark, whip
 *            around the sun and leave. Social attention as celestial event.
 */
export function buildSocialLayer(xdashTokens, universeIds, sunId) {
  const auras = []
  const comets = []
  if (!Array.isArray(xdashTokens)) return { auras, comets }

  xdashTokens.forEach((row, i) => {
    const sym = (row.symbol || '').toUpperCase()
    if (!sym) return
    const rank = i + 1
    const mentions = Number(row.mentions ?? row.external_mentions) || 0
    const authors = Number(row.unique_authors_24h ?? row.author_count) || 0
    const velocity = Number(row.velocity_ratio) || 0
    const social = { rank, mentions, authors, velocity }

    if (sym === sunId || universeIds.has(sym)) {
      auras.push({ id: sym, ...social, intensity: Math.max(0.35, 1 - (rank - 1) / 12) })
      return
    }
    if (comets.length >= 6) return
    const h = hash01('comet·' + sym)
    const h2 = hash01('comet2·' + sym)
    const h3 = hash01('comet3·' + sym)
    // eccentric ellipse: perihelion inside the hot zone, aphelion beyond the map
    const q = 34 + h * 26                    // perihelion 34..60
    const e = 0.55 + h2 * 0.25               // eccentricity .55...80
    const a = q / (1 - e)                    // semi-major from q + e
    comets.push({
      id: sym,
      isComet: true,
      token: {
        symbol: sym,
        name: row.name || sym,
        logo: row.image_small || row.image || row.logo_url || null,
        marketCap: Number(row.market_cap) || 0,
        cgId: row.cg_id || row.token_id || null,
        contract: row.contract_address || null,
      },
      ...social,
      ellipse: {
        a, e,
        theta: h3 * Math.PI * 2,             // start anywhere along the path
        node: h2 * Math.PI * 2,              // orientation of the ellipse
        incline: (h - 0.5) * 0.5,            // dive through the ecliptic
        // sweep speed tuned so a full pass is contemplative but alive
        speed: 0.10 + h2 * 0.06,
      },
    })
  })
  return { auras, comets }
}
