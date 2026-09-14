/**
 * Where an Intelligence Feed card goes when you click it.
 *
 * Lived inside signal-card.jsx until the bell and the Intel Desk had each
 * grown their OWN copy of the "what do I do with a destination" switch. One
 * card, one destination, one opener — this module is all three.
 *
 * ── The bug this exists to kill (2026-08-24, Nick via TG) ──────────────────
 * A DEGEN RUNNERS card read "CATALORIAN breakout — 24 authors @ $1.42M" and
 * landed the reader on a DIFFERENT CATALORIAN: a $254K Ethereum meme, not the
 * $1.42M Solana one the detector actually scored. The payload carried a bare
 * ticker (`meta.asset`), so Research Zone re-resolved "CATALORIAN" from
 * scratch and picked a same-symbol stranger. A micro-cap ticker is NOT an
 * identity — thousands of them collide across chains.
 *
 * So the rule here is: NEVER route a shitcoin by its ticker. X Dash already
 * knows exactly which token it scored (cg_id + chain + contract address) and
 * now ships it on the signal, so:
 *
 *   1. a contract address  -> the AI Screener / trading terminal, BY ADDRESS.
 *      An on-chain micro-cap's real market is a DEX pair; that is the page
 *      with its chart, and an address can only ever mean one token.
 *   2. a CoinGecko id      -> Research Zone, PINNED to that id. A cgId is the
 *      globally-unique slug, so RZ has nothing left to guess.
 *   3. a bare ticker       -> Research Zone by symbol (the old path), kept
 *      only for the majors/CEX assets where a ticker IS unambiguous.
 *
 * Identity beats guessing at every step, and the card's label says which page
 * it is about to open so the promise matches the landing.
 */
import { isTradableContract, openTradingTerminal } from '@/lib/trading-terminal'
import { getPathForPageId } from '@/constants/pageRoutes'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getCgSearchHits } from '@/services/cgSearchService'

/* `asset` values upstream uses as a LABEL for the desk itself, not a tradable
   thing. Linking them would open a Research Zone page for a token that has
   never existed. */
export const PSEUDO_ASSETS = new Set(['BRAIN', 'DESK', 'MARKET', 'GLOBAL', 'MACRO'])

/* Above this market cap a token's price lives on exchanges and CoinGecko, so
   Research Zone (fundamentals, CEX markets, TA) is the better page. Below it
   the token IS its DEX pair — the AI Screener charts that, Research Zone
   frequently cannot ("CHART DATA UNAVAILABLE FOR THIS TOKEN"). A signal with a
   contract but no market cap at all is treated as unlisted, i.e. degen. */
export const SCREENER_MAX_MCAP = 50e6

/* Human chain label for the "Open X on Solana" affordance. Anything not listed
   falls back to a capitalised form of whatever X Dash sent. */
const CHAIN_LABELS = {
  solana: 'Solana', ethereum: 'Ethereum', eth: 'Ethereum', base: 'Base',
  bsc: 'BNB Chain', 'binance-smart-chain': 'BNB Chain', polygon: 'Polygon',
  'polygon-pos': 'Polygon', arbitrum: 'Arbitrum', 'arbitrum-one': 'Arbitrum',
  optimism: 'Optimism', 'optimistic-ethereum': 'Optimism', avalanche: 'Avalanche',
  tron: 'Tron', sui: 'Sui', ton: 'TON', hyperliquid: 'Hyperliquid',
  robinhood: 'Robinhood', plasma: 'Plasma', abstract: 'Abstract', blast: 'Blast',
}

export function chainLabel(chain) {
  const key = String(chain || '').trim().toLowerCase()
  if (!key) return null
  return CHAIN_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1)
}

function str(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * resolveDestination(signal) -> {kind, ...} | null
 *
 * `null` means the card names no single subject (the desk scoreboard, a pulse
 * naming three coins) and gets NO pointer — faking an affordance that lands
 * nowhere is worse than not offering one.
 */
export function resolveDestination(signal) {
  const meta = signal?.meta || {}
  const asset = meta.asset
  const sym = String(asset || '').toUpperCase()
  const named = sym && !PSEUDO_ASSETS.has(sym)

  // 1. An on-chain contract is an EXACT identity. For a degen micro-cap it is
  //    also the only page that can chart it, so it wins over everything else.
  const address = str(meta.contractAddress)
  const mcap = num(meta.mcap)
  if (named && address && isTradableContract(address) && (!mcap || mcap < SCREENER_MAX_MCAP)) {
    return {
      kind: 'screener',
      symbol: sym,
      address,
      chain: str(meta.chain),
      chainName: chainLabel(meta.chain),
    }
  }

  // 2. A CoinGecko id is the globally-unique slug — Research Zone opens THAT
  //    token instead of re-searching an ambiguous ticker.
  const cgId = str(meta.cgId)
  if (named && cgId) {
    return { kind: 'rz', symbol: sym, cgId, name: str(meta.tokenName), chain: str(meta.chain) }
  }

  // 3. Bare ticker: the pre-identity path. Safe for the majors this feed is
  //    mostly about; the micro-caps now arrive with identity above.
  if (named) return { kind: 'rz', symbol: sym }

  const url = meta.url
  if (typeof url === 'string' && /^https?:\/\//.test(url)) return { kind: 'url', url }

  // A world headline names no token and carries no source link, but it is not
  // subjectless — it is the Edition's front page. Landing there is a real
  // destination, and the label says exactly that rather than promising "the
  // story" we cannot deep-link to.
  if (signal?.category === 'breaking' || signal?.category === 'news') return { kind: 'edition' }
  return null
}

/* How long a click may wait on the disambiguation lookup before it gives up
   and opens the plain ticker. A click that hangs is worse than a click that
   lands somewhere imperfect. */
const PIN_TIMEOUT_MS = 1200

/**
 * A bare ticker with no identity behind it is a guess, and Research Zone's own
 * resolve chain takes the first thing that answers to the name — which is how
 * a $1.42M Solana CATALORIAN opened a $254K Ethereum one. When we are forced
 * to route on a ticker, pick the BIGGEST token wearing it: market cap first,
 * 24h volume as the tiebreak. That is the one a reader means by the ticker,
 * and the one whose page actually has data.
 *
 * Known majors short-circuit — for BTC/ETH/SOL the ticker IS the identity, and
 * their slug already resolves without a round-trip.
 */
async function pinAmbiguousTicker(dest) {
  if (!dest || dest.kind !== 'rz' || dest.cgId) return dest
  const sym = dest.symbol
  if (!sym || SYMBOL_TO_COINGECKO_ID[sym]) return dest
  try {
    const hits = await Promise.race([
      getCgSearchHits(sym),
      new Promise((resolve) => setTimeout(() => resolve(null), PIN_TIMEOUT_MS)),
    ])
    if (!Array.isArray(hits) || hits.length === 0) return dest
    const exact = hits.filter((h) => String(h.symbol || '').toUpperCase() === sym)
    const pool = exact.length ? exact : hits
    if (pool.length < 2) return dest // only one candidate — nothing to pick between
    const best = pool.slice().sort(
      (a, b) => (Number(b.marketCap) || 0) - (Number(a.marketCap) || 0)
        || (Number(b.volume) || 0) - (Number(a.volume) || 0)
    )[0]
    return best?.cgId ? { ...dest, cgId: best.cgId, name: best.name || dest.name || null } : dest
  } catch {
    return dest
  }
}

/**
 * openSignalDestination(dest, { navigate, onClose })
 *
 * The single opener both the bell panel and the Intel Desk call. `navigate` is
 * react-router's; `onClose` (optional) closes the bell popover on an in-app
 * navigation, and is deliberately NOT called for an external story — the
 * reader is not done with the feed.
 */
export async function openSignalDestination(dest, { navigate, onClose } = {}) {
  if (!dest) return
  if (dest.kind === 'screener') {
    // Standalone terminal by contract (better charts, keeps the Privy session),
    // exactly like every other degen route in the app. In an installed PWA the
    // helper keeps it in-app at /trade/<address> instead of popping the iOS
    // browser sheet. Only a genuinely un-linkable address falls through.
    if (openTradingTerminal(dest.address)) return
    onClose?.()
    navigate?.(`${getPathForPageId('ai-screener')}/${encodeURIComponent(dest.address)}`)
    return
  }
  if (dest.kind === 'rz') {
    const pinned = await pinAmbiguousTicker(dest)
    const loc = buildResearchZoneLocation({
      symbol: pinned.symbol,
      cgId: pinned.cgId || null,
      name: pinned.name || null,
    })
    // 🪤 Do NOT "help" a cgId destination by also passing ?tokenSymbol=. Tried
    // 2026-08-24 to stop Research Zone printing the slug as the ticker
    // ("ELON-S-SPACE-CAT TO USD") on a cold load: the symbol WINS the resolve,
    // the path gets rewritten /elon-s-space-cat -> /catalorian, and the page
    // lands back on the $254K Ethereum namesake — the very bug this module
    // exists to kill. The bare cgId slug is the identity; leave it alone.
    onClose?.()
    navigate?.(`${loc.pathname}${loc.search || ''}`)
    return
  }
  if (dest.kind === 'url') { window.open(dest.url, '_blank', 'noopener,noreferrer'); return }
  if (dest.kind === 'edition') { onClose?.(); navigate?.('/intelligence') }
}
