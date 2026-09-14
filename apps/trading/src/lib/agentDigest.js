/**
 * agentDigest - pure builder for the Spectre Agent context digest: the
 * compact JSON snapshot of everything the token page already knows,
 * attached to every agent chat message. THE single normalization point
 * for the codebase's mixed number conventions:
 *
 *   - tokenData change* fields are RATIOS for BOTH codex and coingecko
 *     sources (CG percents are pre-divided in useCodexData.js ~2585).
 *     buildDigest multiplies by 100 exactly once into changePct.
 *
 * No fetching, no React - unit-testable. Target 2-4k tokens; 12KB hard
 * cap enforced by dropping bars -> tweets -> dossier in that order.
 * meta.missing names fields that are unavailable for this token/chain so
 * the model says "no data" instead of hallucinating.
 */
import { chainForNetworkId } from './swapParams'

const DIGEST_BYTE_CAP = 12 * 1024

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const round = (v, sig = 6) => {
  const n = num(v)
  if (n == null) return null
  if (n === 0) return 0
  return Number(n.toPrecision(sig))
}

// Change value -> percent, using the app's mixed-unit heuristic
// (marketFormat.fmtChange / fix_codex_change_units): Codex/CG feed change
// as a RATIO for sub-100% moves (|v| <= 1, e.g. 0.05 = 5%) and as a plain
// PERCENT for larger moves (14.62 = 14.62%). A blanket x100 would report
// a 14x mover as 1462%.
const pct = (change) => {
  let n = num(change)
  if (n == null) return null
  if (Math.abs(n) <= 1 && n !== 0) n = n * 100
  return Math.round(n * 100) / 100
}

function normalizeBars(bars) {
  // Accept [{t,o,h,l,c,v}], TV-shape [{time,open,high,low,close,volume}]
  // (getCachedBars), or UDF {t:[],o:[],...}; emit compact tuples.
  if (!bars) return null
  let list = null
  if (Array.isArray(bars)) {
    list = bars.map((b) => b && b.close != null && b.c == null
      ? { t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }
      : b)
  } else if (Array.isArray(bars.c)) {
    list = bars.c.map((c, i) => ({ t: bars.t?.[i], o: bars.o?.[i], h: bars.h?.[i], l: bars.l?.[i], c, v: bars.v?.[i] }))
  }
  if (!list || !list.length) return null
  const clean = list.filter((b) => b && num(b.c) != null && num(b.c) > 0)
  if (clean.length < 5) return null
  return clean.slice(-48).map((b) => [
    Math.round(num(b.t) || 0), round(b.o), round(b.h), round(b.l), round(b.c), Math.round(num(b.v) || 0),
  ])
}

/**
 * @param {object} src
 *   token       App.jsx token prop {symbol,name,address,networkId,cgId,verified,...}
 *   tokenData   useSharedTokenDetails().tokenData (live merged details)
 *   bars        cached chart bars (getCachedBars result) or null
 *   barsResolution  the resolution of `bars`
 *   security    fetchTokenTaxCached result or null (EVM only)
 *   dossier     useDossier data or null
 *   tweets      [{author, text, ts}] sample or null
 *   wallet      { connected, nativeBalance, nativeSymbol, tokenBalance } or null
 *   surface     'desktop' | 'mobile' | 'embed'
 *   detailAgeSec  seconds since tokenData landed (embed no-poll staleness)
 * @returns digest object or null when the token is not ready
 */
export function buildDigest(src) {
  const { token, tokenData } = src || {}
  if (!token || !token.address || token.symbol === '...') return null

  const d = tokenData || {}
  const missing = []
  const chainSlug = chainForNetworkId(token.networkId)
  const isSolana = token.networkId === 1399811149

  const market = {
    price: round(d.price ?? token.price),
    priceSource: d._priceSource === 'stream' ? 'stream' : 'poll',
    marketCap: round(d.marketCap ?? token.marketCap, 8),
    fdv: round(d.fdv, 8),
    liquidity: round(d.liquidity, 8),
    volume24: round(d.volume24 ?? token.volume24, 8),
    holders: num(d.holders),
    circulatingSupply: round(d.circulatingSupply ?? token.circulatingSupply, 10),
    totalSupply: round(d.totalSupply ?? token.totalSupply, 10),
    changePct: {
      m5: pct(d.change5m),
      h1: pct(d.change1h ?? d.change1),
      h4: pct(d.change4h ?? d.change4),
      h12: pct(d.change12h ?? d.change12),
      h24: pct(d.change24),
    },
  }
  if (market.holders == null) missing.push('holders')
  if (market.circulatingSupply == null) missing.push('circulatingSupply')
  if (market.liquidity == null) missing.push('liquidity')

  // CG majors extras
  const range = (d.high24 != null || d.ath != null) ? {
    high24: round(d.high24), low24: round(d.low24),
    ath: round(d.ath), athChangePct: round(d.athChangePct, 4),
  } : undefined

  const bars = normalizeBars(src.bars)
  if (!bars) missing.push('bars')

  let security
  if (isSolana) {
    missing.push('security(EVM-only)')
  } else if (src.security && (src.security.isHoneypot != null || src.security.buyTax != null)) {
    security = {
      honeypot: !!src.security.isHoneypot,
      buyTaxPct: num(src.security.buyTax),
      sellTaxPct: num(src.security.sellTax),
    }
  } else {
    missing.push('security')
  }

  let dossier
  const lore = src.dossier?.lore
  if (lore?.projectDescription || lore?.communityNarrative) {
    dossier = {
      projectDescription: String(lore.projectDescription || '').slice(0, 400) || undefined,
      communityNarrative: String(lore.communityNarrative || '').slice(0, 300) || undefined,
    }
  }

  let tweets
  if (Array.isArray(src.tweets) && src.tweets.length) {
    tweets = src.tweets.slice(0, 3).map((t) => ({
      author: t.author || t.username, text: String(t.text || '').slice(0, 200), ts: t.ts || t.created_at,
    }))
  }

  const digest = {
    v: 1,
    ts: Date.now(),
    surface: src.surface || 'desktop',
    token: {
      symbol: token.symbol, name: token.name, address: token.address,
      networkId: token.networkId, chain: chainSlug,
      decimals: num(d.decimals ?? token.decimals) ?? undefined,
      cgId: token.cgId || undefined, verified: token.verified || undefined,
      ageDays: d.createdAt ? Math.floor((Date.now() / 1000 - d.createdAt) / 86400) : undefined,
    },
    market,
    ...(range ? { range } : {}),
    ...(bars ? { bars: { resolution: src.barsResolution || '60', note: 'tuples [t,o,h,l,c,v]', ohlcv: bars } } : {}),
    ...(security ? { security } : {}),
    ...(dossier ? { dossier } : {}),
    ...(tweets ? { tweets } : {}),
    ...(src.wallet ? { wallet: src.wallet } : {}),
    ...(src.socials || d.socials ? { socials: { twitter: d.socials?.twitter, website: d.socials?.website } } : {}),
    // Persona context: display name + local hour (server sanitizes the name
    // before any prompt sees it; timezone only exists client-side).
    ...(src.user?.name || src.user?.localHour != null
      ? { user: { name: String(src.user.name || '').slice(0, 40) || undefined, localHour: src.user.localHour } }
      : {}),
    meta: {
      detailAgeSec: num(src.detailAgeSec) ?? undefined,
      missing,
    },
  }

  // Hard cap: drop the heaviest optional sections until under budget.
  const dropOrder = ['bars', 'tweets', 'dossier']
  let json = JSON.stringify(digest)
  for (const key of dropOrder) {
    if (json.length <= DIGEST_BYTE_CAP) break
    if (digest[key]) {
      delete digest[key]
      digest.meta.missing.push(`${key}(size-capped)`)
      json = JSON.stringify(digest)
    }
  }
  return digest
}
