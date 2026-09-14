/**
 * token-class.js — a real market-class read for the TA surfaces.
 *
 * The Technicals tab used to decide "is this a macro major or an on-chain
 * runner?" with `isMajorToken(sym)` — a hard-coded SYMBOL list built for API
 * routing (it even contains on-chain microcaps like SPECTRE/PALM and stables).
 * So a Solana clone whose ticker collides with the list (a scam "SUI"/"LINK")
 * was silently treated as a CEX major, and real microcaps were mis-bucketed.
 * This classifies by what a token actually IS — market cap, rank, venue (deep
 * CEX pair vs bare on-chain address) — mirroring the class ladder in
 * rz-market-context.jsx's classifyTokenClass, plus an explicit on-chain/venue
 * read.
 *
 * MAJOR_SYMBOLS / isMajorToken stays in constants/majorTokens.js for DATA-
 * SOURCE ROUTING only (which API serves bars/prices) — this module is the
 * MARKET-CLASS truth. Stocks bypass this entirely (assetClass === 'stock').
 *
 * Returns { key, label, isMeme, onchain, isMacro, isSmallCap }.
 *   key: 'btc' | 'major' | 'large' | 'mid' | 'micro' | 'nano'
 */
const num = (v) => {
  if (v == null) return null // null rank must NOT coerce to 0 (0 <= 10 → false "major")
  if (typeof v === 'string' && v.trim() === '') return null // whitespace ≠ 0
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const LABELS = {
  btc: 'Macro Anchor',
  major: 'Major · Top 10',
  large: 'Large Cap',
  mid: 'Mid Cap',
  micro: 'Micro Cap',
  nano: 'Nano Cap',
}

export function classifyToken({
  sym,
  address = null,
  binancePair = null,
  rank = null,
  marketCap = null,
  categories = [],
  primaryCategory = null,
} = {}) {
  const s = String(sym || '').toUpperCase().split(':')[0]
  const cats = [...(Array.isArray(categories) ? categories : []), primaryCategory]
    .filter(Boolean).map((c) => String(c).toLowerCase())
  const isMeme = cats.some((c) => c.includes('meme'))
  const r = num(rank)
  const mc = num(marketCap)

  // Rank sentinel guard: some feeds emit 0 for "unranked" — 0 must NOT read as
  // top-10. Only a positive rank counts as a real rank.
  const ranked = r != null && r > 0

  // Venue: a deep CEX pair, a top rank, OR a $1B+ cap is CEX-grade liquidity; a
  // bare on-chain address with none of those is a DEX / on-chain token. Folding
  // mcap in stops a large-cap that merely also has a contract (WBTC, wrapped
  // majors) from being mislabeled on-chain when binancePair isn't populated.
  const cexGrade = !!binancePair || (ranked && r <= 50) || (mc != null && mc >= 1e9)

  let key
  if (s === 'BTC') key = 'btc'
  else if (ranked && r <= 10) key = 'major'
  else if ((ranked && r <= 100) || (mc != null && mc >= 1e9)) key = 'large'
  else if (mc != null && mc >= 1e8) key = 'mid'
  else if (mc != null && mc >= 5e6) key = 'micro'
  else if (mc != null) key = 'nano'
  // No market cap → derive from rank TIERS (a rank alone doesn't imply large).
  else if (ranked) key = r <= 100 ? 'large' : r <= 500 ? 'mid' : 'micro'
  else key = 'micro'

  const isMacro = key === 'btc' || key === 'major' || key === 'large'
  const isSmallCap = key === 'micro' || key === 'nano'
  // On-chain = has a contract AND is genuinely a DEX / smaller token — never a
  // CEX-grade major that merely also carries an address.
  const onchain = !!address && !isMacro && !cexGrade

  return {
    key,
    label: isMeme ? `Memecoin · ${LABELS[key]}` : LABELS[key],
    isMeme,
    onchain,
    isMacro,
    isSmallCap,
  }
}
