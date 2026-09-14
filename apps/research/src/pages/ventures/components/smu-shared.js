/**
 * Smart Money Universe — shared, pure helpers.
 *
 * The Universe surface (Token Consensus / VC Bubbles / Sector Map) derives
 * everything from two inputs:
 *   1. the static `vc-database.json` entity registry (who holds what + AUM)
 *   2. a LIVE price map keyed by uppercase symbol (from /v1/prices)
 *
 * Nothing here renders — it's the deterministic data layer all three views
 * share so the numbers stay consistent across tabs. No hardcoded market
 * figures: every cap / momentum / pool number is computed from the live feed
 * at call time.
 */

// ── formatting ──────────────────────────────────────────────────────────────

export function fmtUsdCompact(n) {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export function fmtPriceUsd(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  if (n > 0) return `$${n.toFixed(8)}`
  return '—'
}

export function fmtPct(n) {
  if (!Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function classOfPct(n) {
  if (!Number.isFinite(n) || n === 0) return ''
  return n > 0 ? 'is-bull' : 'is-bear'
}

const U = (s) => String(s || '').toUpperCase()

// ── AUM parsing ─────────────────────────────────────────────────────────────
// AUM strings are human-formatted: "$12B", "$1.5T (total)", "$30B+ IBIT/ETHA",
// "$500M", or BTC-denominated for corporate/sovereign holders ("~9,720 BTC",
// "500,000+ BTC", "~9,400 BTC + ETH"). We convert BTC reserves to USD via the
// live BTC price so the bubble field sizes those holders honestly.

const USD_RE = /\$\s*([\d.,]+)\s*([TBMK])/i
const BTC_RE = /([\d.,]+)\s*\+?\s*BTC/i
const SCALE = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }

/** USD AUM only — null for BTC-denominated / undisclosed. Used for the
 *  "Combined AUM" headline + AUM ordering of declared funds. */
export function parseUsdAum(raw) {
  if (typeof raw !== 'string') return null
  const m = USD_RE.exec(raw)
  if (!m) return null
  const v = parseFloat(m[1].replace(/,/g, ''))
  if (!Number.isFinite(v)) return null
  return v * (SCALE[m[2].toUpperCase()] || 1)
}

/** Effective AUM for sizing — USD if declared, else BTC reserves × live price,
 *  else a small floor so every entity still renders as a bubble. */
export function effectiveAumUsd(entity, btcPrice) {
  const usd = parseUsdAum(entity?.aum_estimate)
  if (usd != null) return usd
  if (Number.isFinite(btcPrice)) {
    const m = BTC_RE.exec(entity?.aum_estimate || '')
    if (m) {
      const btc = parseFloat(m[1].replace(/,/g, ''))
      if (Number.isFinite(btc)) return btc * btcPrice
    }
  }
  return 250e6 // floor for undisclosed funds
}

// ── token symbol hygiene ────────────────────────────────────────────────────
// A few "tokens" in the DB are really product/index labels ("BTC (VIA IBIT)",
// "10 LARGE CAP CRYPTO INDEX"). They identify ETF/index exposure for sector
// membership but never resolve on /v1/prices, so we keep them out of the price
// fetch + out of the tradeable consensus rows.

const NON_TRADEABLE = /\(VIA|INDEX|LARGE CAP|PROTOCOL$|^DFINITY$|^HELIUM$|^WORM$/i

export function isTradeableSymbol(sym) {
  const s = String(sym || '').trim()
  if (!s) return false
  if (NON_TRADEABLE.test(s)) return false
  if (s.length > 8) return false
  return true
}

/** Every distinct tradeable symbol referenced across the entity set. */
export function collectSymbols(entities) {
  const set = new Set()
  for (const e of entities || []) {
    for (const t of e.known_portfolio_tokens || []) {
      if (isTradeableSymbol(t)) set.add(U(t))
    }
  }
  return [...set].sort()
}

// ── Token Consensus ─────────────────────────────────────────────────────────
// Invert the holdings graph: for each token, which funds back it (ordered by
// declared AUM, biggest first). Pool AUM = combined AUM of those backers.

export function buildConsensus(entities, priceMap) {
  const byToken = new Map()
  for (const e of entities || []) {
    const aum = parseUsdAum(e.aum_estimate) || 0
    const seen = new Set()
    for (const raw of e.known_portfolio_tokens || []) {
      if (!isTradeableSymbol(raw)) continue
      const sym = U(raw)
      if (seen.has(sym)) continue
      seen.add(sym)
      if (!byToken.has(sym)) byToken.set(sym, { backers: [], poolAum: 0 })
      const row = byToken.get(sym)
      row.backers.push(e)
      row.poolAum += aum
    }
  }

  const rows = []
  for (const [sym, { backers, poolAum }] of byToken) {
    const p = priceMap?.[sym] || null
    backers.sort((a, b) => (parseUsdAum(b.aum_estimate) || 0) - (parseUsdAum(a.aum_estimate) || 0))
    rows.push({
      symbol: sym,
      name: p?.name || '',
      image: p?.image || null,
      price: p?.price ?? null,
      change24h: p?.change24h ?? null,
      change7d: p?.change7d ?? null,
      marketCap: p?.marketCap ?? null,
      volume24h: p?.volume24h ?? null,
      backers,
      backerCount: backers.length,
      poolAum,
    })
  }

  // Order by conviction: most backers first, then pool AUM, then mcap.
  rows.sort((a, b) =>
    b.backerCount - a.backerCount ||
    b.poolAum - a.poolAum ||
    (b.marketCap || 0) - (a.marketCap || 0),
  )
  return rows
}

// ── Sector taxonomy ─────────────────────────────────────────────────────────
// Each sector is keyed by a signature token set drawn from the live universe.
// A fund "belongs" to a sector when its known holdings intersect the signature.
// Mega-caps (BTC/ETH/SOL) are deliberately kept out of thematic signatures so
// the membership signal stays meaningful — almost every fund holds the majors.

export const SECTORS = [
  { key: 'ai', label: 'AI', tokens: ['FET', 'RNDR', 'OCEAN', 'IO', 'NMR', 'TAO', 'AGIX'] },
  { key: 'defi', label: 'DeFi', tokens: ['AAVE', 'UNI', 'COMP', 'SNX', '1INCH', 'SPELL', 'RUNE', 'OSMO', 'JUP'] },
  { key: 'infra', label: 'Infrastructure', tokens: ['LINK', 'GRT', 'FIL', 'AR', 'PYTH', 'TRB', 'ENS', 'GNO', 'JTO'] },
  { key: 'l1', label: 'L1', tokens: ['ADA', 'AVAX', 'DOT', 'APT', 'SUI', 'ALGO', 'CELO', 'FTM', 'KAVA', 'NEAR', 'BNB', 'BCH'] },
  { key: 'rwa', label: 'RWA', tokens: ['ONDO', 'OM', 'MKR', 'DUSK', 'PENDLE'] },
  { key: 'gaming', label: 'Gaming', tokens: ['IMX', 'AXS', 'SAND', 'GALA', 'YGG', 'APE', 'FLOW'] },
  { key: 'perps', label: 'Perps', tokens: ['DYDX', 'PERP', 'INJ', 'SNX'] },
  { key: 'stablecoins', label: 'Stablecoins', tokens: ['ENA', 'FXS', 'MKR'] },
  { key: 'modular', label: 'Modular', tokens: ['TIA', 'EIGEN', 'MNT', 'MON'] },
  { key: 'restaking', label: 'Restaking', tokens: ['EIGEN', 'PENDLE'] },
  { key: 'depin', label: 'DePIN', tokens: ['HNT', 'IO', 'RNDR', 'AR'] },
  { key: 'nft', label: 'NFT', tokens: ['BLUR', 'APE', 'FLOW', 'SAND'] },
  { key: 'social', label: 'Social', tokens: ['RLY', 'CYBER', 'MOCA', 'CHZ'] },
  { key: 'consumer', label: 'Consumer', tokens: ['BLUR', 'CYBER', 'RLY', 'MOCA', 'APE'] },
  { key: 'etfs', label: 'Spot ETFs', tokens: ['BTC (VIA IBIT)', '10 LARGE CAP CRYPTO INDEX', 'LARGE CAP CRYPTO INDEX'] },
]
// Note: no "Majors" sector — BTC/ETH/SOL are held by almost every fund, so a
// majors bucket would swamp the map and isn't a real allocation theme.

/**
 * Build sector cells for a given timeframe ('24h' | '7d' | '30d').
 * momentum = average live % move of the sector's signature tokens that have a
 * price; aum = combined AUM of member funds; fundCount = member fund count.
 */
export function buildSectors(entities, priceMap, timeframe = '24h') {
  const changeKey = timeframe === '7d' ? 'change7d' : timeframe === '30d' ? 'change30d' : 'change24h'
  const cells = []

  for (const sector of SECTORS) {
    const sig = new Set(sector.tokens.map(U))
    const funds = (entities || []).filter((e) =>
      (e.known_portfolio_tokens || []).some((t) => sig.has(U(t))),
    )
    if (funds.length === 0) continue

    // Live momentum from the sector's signature tokens.
    const moves = []
    const chips = []
    for (const raw of sector.tokens) {
      const sym = U(raw)
      const p = priceMap?.[sym]
      if (p && Number.isFinite(p[changeKey])) moves.push(p[changeKey])
      if (isTradeableSymbol(raw)) chips.push({ symbol: sym, image: p?.image || null })
    }
    const momentum = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null
    const aum = funds.reduce((s, e) => s + (parseUsdAum(e.aum_estimate) || 0), 0)

    cells.push({
      key: sector.key,
      label: sector.label,
      funds,
      fundCount: funds.length,
      aum,
      momentum,
      tokens: sector.tokens,
      chips: chips.slice(0, 6),
    })
  }

  // Biggest clusters first.
  cells.sort((a, b) => b.fundCount - a.fundCount || b.aum - a.aum)
  return cells
}

// ── momentum → colour ───────────────────────────────────────────────────────
// Bear (red) → neutral → bull (green). Returns a translucent fill + border for
// the heatmap cell. Saturation scales with |momentum|, clamped at ±6%.

export function momentumFill(pct) {
  if (!Number.isFinite(pct)) {
    return { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', glow: 'transparent' }
  }
  const t = Math.max(-1, Math.min(1, pct / 6))
  const mag = Math.abs(t)
  if (t >= 0) {
    const a = 0.10 + mag * 0.34
    return {
      bg: `rgba(16, 185, 129, ${a.toFixed(3)})`,
      border: `rgba(52, 211, 153, ${(0.18 + mag * 0.4).toFixed(3)})`,
      glow: `rgba(16, 185, 129, ${(mag * 0.22).toFixed(3)})`,
    }
  }
  const a = 0.10 + mag * 0.34
  return {
    bg: `rgba(239, 68, 68, ${a.toFixed(3)})`,
    border: `rgba(248, 113, 113, ${(0.18 + mag * 0.4).toFixed(3)})`,
    glow: `rgba(239, 68, 68, ${(mag * 0.22).toFixed(3)})`,
  }
}

// Domain-logo helper mirroring vc-intel-hub's EntityLogo ladder, so the views
// can render fund avatars without importing the component.
export const LOGO_CHAIN = [
  (d) => `https://icon.horse/icon/${d}`,
  (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`,
  (d) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
]
export function logoFromDomain(domain, idx = 0) {
  if (!domain) return null
  return LOGO_CHAIN[idx]?.(domain) || null
}
