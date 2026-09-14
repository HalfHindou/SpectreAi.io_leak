'use strict'
/**
 * token-impersonation - detect a fresh token squatting an established token's
 * identity.
 *
 * SHARED logic for BOTH the dev Express route (packages/server/index.js) and the
 * prod Vercel handler (apps/trading/api/codex.js). Keep the prod mirror
 * (apps/trading/api/_lib/token-impersonation.cjs) byte-identical, same contract
 * as the trending-score / dexscreener-enrich pairs.
 *
 * WHY THIS EXISTS (measured 2026-07-23, live boards vs DexScreener):
 * three of our BSC top five were address-prefix-spoofed fakes of the exact
 * tokens DexScreener was trending, and our SOL #4 was a 2.4-hour-old $0.16M
 * "ANSEM / The Black Bull" while the real one is $317.93M:
 *
 *   ours 0x40b80069 UB "Unibase" $0.37M  0.7d  <- real 0x40b8129B $316.49M 316d
 *   ours 0x92F19Ffc DOYR         $0.34M  0.7d  <- real 0x925c8Ab7 $0.60M   229d
 *   ours w2eGjcge.. ANSEM        $0.16M  0.1d  <- real GvmPaRxZ.. $317.93M 13.8d
 *
 * Note the leading address characters on UB and DOYR - those are deliberately
 * generated vanity addresses meant to survive a visual check.
 *
 * The trending board's own narrative clustering CANNOT catch this: it only
 * compares rows within the board, and the real token is usually absent (it is
 * older and flatter, so it ranks elsewhere or not at all). The comparison has to
 * be against the whole market, which is what the (free) DexScreener search gives
 * us for one request per distinct symbol.
 */

const TTL_MS = 30 * 60 * 1000
const cache = new Map() // SYMBOL -> { candidates, ts }

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' }
const FILLER = /\b(baby|mini|wrapped|official|the|token|coin|inu|classic|new|v2|v3)\b/g

// Same shape as the route's narrative key, kept local so this module stays
// self-contained for the Vercel bundle.
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^\$/, '')
    .replace(/[^\w\s]+/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+\d+\s*$/, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/[013457]/g, (c) => LEET[c])
}

function ageDaysFrom(ts) {
  let t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return null
  if (t < 1e12) t *= 1000
  const d = (Date.now() - t) / 86400000
  return d >= 0 ? d : null
}

// How many leading hex/base58 characters two addresses share, ignoring the 0x.
// A long shared prefix on two unrelated contracts is not chance - it is a
// generated vanity address, which raises confidence but is never required.
function sharedPrefix(a, b) {
  const x = String(a || '').replace(/^0x/i, '').toLowerCase()
  const y = String(b || '').replace(/^0x/i, '').toLowerCase()
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  return i
}

async function searchSymbol(symbol) {
  const key = String(symbol || '').toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.candidates
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(key)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`dexscreener ${res.status}`)
    const json = await res.json()
    const byAddr = new Map()
    for (const p of (json && json.pairs) || []) {
      const b = p && p.baseToken
      if (!b || !b.address) continue
      const addr = String(b.address).toLowerCase()
      const mcap = Number(p.marketCap || p.fdv) || 0
      const prev = byAddr.get(addr)
      // Keep the deepest pool per contract - it carries the most trustworthy
      // cap, and pairCreatedAt on a secondary pool understates token age.
      if (!prev || mcap > prev.marketCap) {
        byAddr.set(addr, {
          symbol: b.symbol, name: b.name, address: b.address, chainId: p.chainId,
          marketCap: mcap, ageDays: ageDaysFrom(p.pairCreatedAt),
        })
      }
    }
    const candidates = [...byAddr.values()]
    cache.set(key, { candidates, ts: Date.now() })
    if (cache.size > 800) cache.delete(cache.keys().next().value)
    return candidates
  } catch {
    // Fail-open with a short negative cache so a blip re-checks soon.
    cache.set(key, { candidates: [], ts: Date.now() - TTL_MS + 5 * 60 * 1000 })
    return []
  }
}

/**
 * Compare one row against everything else trading under its ticker.
 * @returns {object|null} the impersonated token, or null when the row is clean.
 */
function judge(row, candidates) {
  const t = row.token || {}
  const mine = String(t.address || '').toLowerCase()
  const myMcap = Number(row.marketCap) || 0
  const myAge = ageDaysFrom(row.createdAt)
  const myName = normName(t.name)
  const mySym = String(t.symbol || '').toUpperCase().replace(/^\$/, '')
  if (!mine || !mySym || myAge == null) return null

  const hits = []
  for (const c of candidates) {
    if (String(c.address).toLowerCase() === mine) continue
    if (c.ageDays == null || c.marketCap <= 0) continue
    // DexScreener's search is FUZZY - `?q=UB` also returns "o1.exchange" and
    // anything else whose name merely contains the string. Without this the
    // ticker rule fires against completely unrelated tokens (it named
    // o1.exchange as the token our fake UB was squatting). Every comparison
    // below assumes a genuine ticker collision, so enforce it here.
    if (String(c.symbol || '').toUpperCase().replace(/^\$/, '') !== mySym) continue
    // The other contract must be meaningfully older - otherwise this is just
    // two tokens from the same launch wave sharing a ticker.
    if (c.ageDays < myAge + 3) continue
    const sameName = myName.length >= 3 && normName(c.name) === myName
    // Identical name carries the weight. Two ways to qualify:
    //   (a) much bigger  - the classic squat of a well-known token
    //   (b) much OLDER   - catches squats of SMALL originals, which the size
    //       test alone misses entirely: the fake DOYR (0x92F19Ffc, 17h) copies
    //       a real DOYR worth only $604k, so no cap ratio would ever fire, but
    //       a 229-day age gap on an identical name is unambiguous.
    const bigger = c.marketCap >= Math.max(myMcap * 10, 1e6)
    // For (b) the cap ratio is deliberately NOT part of the test - the real
    // DOYR is worth $604k against the fake's $337k, so any ratio bar above 1.8x
    // lets it through. An identical name on a contract three months older is
    // the signal; the cap floor only confirms the original is a real token.
    const muchOlder = c.ageDays >= myAge + 90 && c.marketCap >= 1e5
    const kind = (sameName && (bigger || muchOlder)) ? 'namesquat'
      // A different name needs a far larger gap: a plain ticker collision
      // between two real projects (memecoin HYPE vs Hyperliquid HYPE) is
      // legitimate and must survive.
      : (!sameName && c.ageDays >= myAge + 30 && c.marketCap >= Math.max(myMcap * 50, 5e6)) ? 'tickersquat'
        : null
    if (!kind) continue
    hits.push({
      kind,
      symbol: c.symbol,
      name: c.name,
      address: c.address,
      chainId: c.chainId,
      marketCap: c.marketCap,
      ageDays: Math.round(c.ageDays),
      mcapRatio: myMcap > 0 ? Math.round(c.marketCap / myMcap) : null,
      prefixMatch: sharedPrefix(mine, c.address),
    })
  }
  if (!hits.length) return null
  // Cite the ESTABLISHED token, not merely the biggest. Picking by cap alone
  // named an 8-day-old $1.37B contract as "the real UB" when a 316-day-old
  // $316M one was sitting right there - the citation is what the user reads,
  // so it has to name the token actually being impersonated.
  const established = hits.filter((h) => h.ageDays >= 30)
  const pool = established.length ? established : hits
  return pool.reduce((a, b) => (b.marketCap > a.marketCap ? b : a))
}

/**
 * Screen young rows for identity squatting.
 * Only tokens under `maxAgeDays` are checked - an established token is not
 * impersonating anyone - which keeps this to ~15-25 requests per board compute
 * against DexScreener's free 300/min budget, cached 30 min per SYMBOL (not per
 * token, so a copycat wave costs one lookup for the whole cluster).
 *
 * @returns {Promise<Map<string, object>>} addressLower -> impersonation verdict
 */
function groupYoungBySymbol(rows, maxAgeDays) {
  const bySymbol = new Map()
  for (const r of rows || []) {
    const t = r && r.token
    if (!t || !t.address || !t.symbol) continue
    const age = ageDaysFrom(r.createdAt)
    if (age == null || age > maxAgeDays) continue
    const sym = String(t.symbol).toUpperCase().replace(/^\$/, '')
    if (!sym) continue
    if (!bySymbol.has(sym)) bySymbol.set(sym, [])
    bySymbol.get(sym).push(r)
  }
  return bySymbol
}

/**
 * Warm the symbol cache WITHOUT judging. The caller fires this next to the other
 * address-keyed probes so the lookups overlap the DexScreener enrichment
 * instead of stacking after it; `screenImpersonators` then reads a hot cache.
 * Never rejects.
 */
function prefetchImpersonation(rows, { concurrency = 4, maxAgeDays = 7, maxSymbols = 40 } = {}) {
  try {
    const symbols = [...groupYoungBySymbol(rows, maxAgeDays).keys()].slice(0, maxSymbols)
    if (!symbols.length) return Promise.resolve()
    let i = 0
    const worker = async () => { while (i < symbols.length) await searchSymbol(symbols[i++]) }
    return Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker))
      .then(() => undefined, () => undefined)
  } catch {
    return Promise.resolve()
  }
}

async function screenImpersonators(rows, { concurrency = 4, budgetMs = 6000, maxAgeDays = 7, maxSymbols = 40 } = {}) {
  const out = new Map()
  try {
    const bySymbol = groupYoungBySymbol(rows, maxAgeDays)
    const symbols = [...bySymbol.keys()].slice(0, maxSymbols)
    if (!symbols.length) return out

    let i = 0
    const worker = async () => {
      while (i < symbols.length) {
        const sym = symbols[i++]
        const candidates = await searchSymbol(sym)
        if (!candidates.length) continue
        for (const r of bySymbol.get(sym)) {
          const verdict = judge(r, candidates)
          if (verdict) out.set(String(r.token.address).toLowerCase(), verdict)
        }
      }
    }
    const run = Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker))
    // Whatever has not resolved inside the budget fails open THIS round and
    // keeps filling the cache for the next compute (mirrors rugcheckBatch).
    await Promise.race([run, new Promise((r) => setTimeout(r, budgetMs))])
    return out
  } catch {
    return out // fail-open: never let this empty a board
  }
}

module.exports = { screenImpersonators, prefetchImpersonation, normName, sharedPrefix, judge }
