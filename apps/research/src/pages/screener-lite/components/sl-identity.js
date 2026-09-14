/**
 * Identity for the Cinema detail: a raw LIST ROW (symbol plus whatever fields
 * the caller happened to have) -> the validated ref every chart lane needs.
 *
 * Every primitive here comes from lite-research.jsx, deliberately: Research and
 * Cinema chart the same tokens, and this file existing as a second *resolver*
 * rather than a thin adapter is exactly how "one bug, fixed three times" keeps
 * happening (see the identity history in charts-system.md).
 *
 * The rule that kills the $0-and-blank class: NEVER guess a contract from a bare
 * symbol search. A contract is trusted only when the row carried one, or an
 * upstream record names it under evidence: CoinGecko's platform record
 * (pool-ratified in resolveCgPlatform), or — last rung — GeckoTerminal's own
 * search, which resolveGtSearch only accepts on hint/quote evidence over a
 * real-depth pool (never a first-hit pick). Anything unresolvable comes back
 * `unknown` and renders as honest empties.
 */
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import {
  resolveCgId, loadCgQuote, resolveCgPlatform, resolveGtSearch, loadGtPool,
  CODEX_NETWORK_ID,
} from '@/pages/lite/components/lite-research'

const REF_TTL = 3 * 60 * 1000
const _refCache = new Map()

const looksLikeContract = (v) => {
  const s = String(v || '')
  return /^0x[a-fA-F0-9]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)
}

const netIdFor = (chain) => CODEX_NETWORK_ID[String(chain || '').toLowerCase()] || null

export async function resolveCinemaRef(row) {
  const sym = String(row?.symbol || row?.ticker || '').toUpperCase()
  if (!sym) return null
  if (row?.isStock || row?.assetClass === 'stock') {
    return { kind: 'stock', symbol: sym, name: row?.name || sym, quote: null }
  }

  const rowContract = row?.address || row?.contract || null
  const rowChain = row?.chain || row?.chainId || row?.network || null
  const key = `${sym}:${rowContract || '-'}`
  const hit = _refCache.get(key)
  if (hit && Date.now() - hit.ts < REF_TTL) return hit.ref

  const image = row?.image || row?.logo || null
  // A row's `cgId` field is only sometimes a real CG slug - callers stuff the
  // bare ticker or even a contract in there, and either would send resolveCgId
  // down the wrong lane.
  const rowCg = row?.cgId && !looksLikeContract(row.cgId)
    && String(row.cgId).toLowerCase() !== sym.toLowerCase()
    ? String(row.cgId) : null
  const mappedCg = SYMBOL_TO_COINGECKO_ID[sym] || null

  let ref
  if (rowContract && !mappedCg) {
    // On-chain cap: the contract IS the identity, and the deepest base-side GT
    // pool is the trusted quote. The box's symbol-keyed row is never the source
    // here - see mergeGtStats in lite-research for why.
    const pool = await loadGtPool(rowContract, rowChain).catch(() => null)
    ref = {
      kind: 'onchain', symbol: sym, name: row?.name || sym, image,
      cgId: rowCg, contract: rowContract, chain: rowChain,
      networkId: Number(row?.networkId) || netIdFor(rowChain),
      quote: Number(pool?.price) > 0 ? {
        price: Number(pool.price),
        change24: Number.isFinite(pool.change24) ? pool.change24 : null,
        marketCap: pool.marketCap || null,
        volume24h: pool.volume24 || null,
        liquidity: pool.liquidity || null,
      } : null,
    }
  } else {
    const hint = { name: row?.name || null, image, cgId: rowCg || mappedCg || null }
    const cgId = await resolveCgId(sym, hint).catch(() => null)
    if (!cgId) {
      // CG has never listed this ticker — last rung: GeckoTerminal's own
      // search (hint-disciplined, dust-floored; see resolveGtSearch in
      // lite-research). Recovers the CG-unlisted on-chain class that
      // otherwise renders as honest empties.
      const g = await resolveGtSearch(sym, hint, 0).catch(() => null)
      const gPool = g ? await loadGtPool(g.contract, g.chain).catch(() => null) : null
      ref = g ? {
        kind: 'onchain', symbol: sym, name: row?.name || sym, image,
        cgId: null, contract: g.contract, chain: g.chain,
        networkId: netIdFor(g.chain),
        quote: Number(gPool?.price) > 0 ? {
          price: Number(gPool.price),
          change24: Number.isFinite(gPool.change24) ? gPool.change24 : null,
          marketCap: gPool.marketCap || null,
          volume24h: gPool.volume24 || null,
          liquidity: gPool.liquidity || null,
        } : null,
      } : {
        kind: 'unknown', symbol: sym, name: row?.name || sym, image,
        contract: rowContract, chain: rowChain, quote: null,
      }
    } else {
      const idHint = { ...hint, cgId }
      const q = await loadCgQuote(sym, idHint).catch(() => null)
      // A CG-listed token with a known contract can ride the address-first chart
      // lanes too (real DEX candles, the TradingView tab). Majors are excluded -
      // their bare ticker already rides the clean Binance lane. Sequenced after
      // the quote so the platform pick can compare pool prices against it.
      // resolveGtSearch backs the platform record up (same fallback Research
      // runs): a CG listing with no mappable platform can still have a real
      // GT pool, and the CG quote ratifies the pick.
      let oc = null
      if (!rowContract && !mappedCg) {
        oc = await resolveCgPlatform(sym, idHint).catch(() => null)
        if (!oc) oc = await resolveGtSearch(sym, idHint, Number(q?.price) || 0).catch(() => null)
      }
      ref = {
        kind: 'cg', symbol: sym, cgId,
        name: q?.name || row?.name || sym,
        image: q?.image || image,
        contract: rowContract || oc?.contract || null,
        chain: rowChain || oc?.chain || null,
        networkId: Number(row?.networkId) || netIdFor(rowChain || oc?.chain),
        quote: q ? {
          price: q.price, change24: q.change24, marketCap: q.marketCap,
          volume24h: q.volume, high24h: q.high24h, low24h: q.low24h,
          rank: q.rank, circulatingSupply: q.circulatingSupply, maxSupply: q.maxSupply,
        } : null,
      }
    }
  }
  _refCache.set(key, { ts: Date.now(), ref })
  return ref
}
