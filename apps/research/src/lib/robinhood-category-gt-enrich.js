/**
 * Robinhood-ecosystem category enrichment (2026-07-02).
 *
 * CoinGecko's /coins/markets rows for brand-new Robinhood Chain listings
 * (Dog In Hood, Robinhood WETH, PepeWifHood, The Hood...) carry NO market
 * data for days after listing (price/mcap/fdv/volume all null), and the
 * stale cash-cat record still tracks a dead contract. CG's own website
 * fills those rows from GeckoTerminal live - so our API-mirroring category
 * tab showed fewer and poorer Robinhood rows than coingecko.com. Do what
 * their site does: overlay GT pool data (price/FDV/volume/24h change) onto
 * rows that are dataless - or whose GT money dwarfs the CG record 10x (the
 * stale-contract case) - then re-rank by effective market cap.
 *
 * GT's public API is CORS-open; the 60s module cache keeps this at two
 * requests per minute worst-case, far under GT's 30/min limit.
 */

const GT_BASE = 'https://api.geckoterminal.com/api/v2'

let _gtCache = { ts: 0, bySym: null }

async function gtRobinhoodBySymbol() {
  if (_gtCache.bySym && Date.now() - _gtCache.ts < 60_000) return _gtCache.bySym
  const pages = await Promise.allSettled([1, 2].map((p) =>
    fetch(`${GT_BASE}/networks/robinhood/pools?include=base_token&sort=h24_volume_usd_desc&page=${p}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null))
  ))
  // One row per base token (deepest pool wins the snapshot, volume sums),
  // then one row per SYMBOL (deepest token wins) for the CG-row join below -
  // CG /coins/markets rows carry no contract address to match on.
  const byAddr = new Map()
  for (const s of pages) {
    const json = s.status === 'fulfilled' ? s.value : null
    if (!json) continue
    const included = new Map()
    for (const inc of json.included || []) {
      if (inc?.type === 'token') included.set(inc.id, inc.attributes || {})
    }
    for (const p of json.data || []) {
      const a = p?.attributes || {}
      const ref = p?.relationships?.base_token?.data?.id
      const tok = included.get(ref) || {}
      const addr = tok.address || (ref || '').split('_').slice(1).join('_')
      if (!addr) continue
      const liq = parseFloat(a.reserve_in_usd) || 0
      const row = {
        symbol: (tok.symbol || '').toUpperCase(),
        price: parseFloat(a.base_token_price_usd) || 0,
        // FDV first: fdv_usd is scoped to THIS deployment's supply, while GT's
        // market_cap_usd is the CG-LINKED GLOBAL coin's cap - for Robinhood
        // WETH that returned global WETH's $4B and ranked a $1.2M bridge
        // deployment above USDG.
        mcap: parseFloat(a.fdv_usd) || parseFloat(a.market_cap_usd) || 0,
        vol24: parseFloat(a.volume_usd?.h24) || 0,
        change24: parseFloat(a.price_change_percentage?.h24),
        liq,
      }
      const prev = byAddr.get(addr)
      if (!prev) byAddr.set(addr, row)
      else {
        prev.vol24 += row.vol24
        if (liq > prev.liq) Object.assign(prev, { ...row, vol24: prev.vol24 })
      }
    }
  }
  const bySym = new Map()
  for (const r of byAddr.values()) {
    if (!r.symbol) continue
    const prev = bySym.get(r.symbol)
    if (!prev || r.liq > prev.liq) bySym.set(r.symbol, r)
  }
  if (bySym.size > 0) _gtCache = { ts: Date.now(), bySym }
  return bySym
}

export async function maybeEnrichRobinhoodCategory(categoryId, rows) {
  if (categoryId !== 'robinhood-ecosystem' || !Array.isArray(rows) || rows.length === 0) return rows
  try {
    const bySym = await gtRobinhoodBySymbol()
    if (!bySym || bySym.size === 0) return rows
    const out = rows.map((c) => {
      const gt = bySym.get(String(c.symbol || '').toUpperCase())
      if (!gt || !(gt.price > 0)) return c
      const cgMoney = Math.max(Number(c.market_cap) || 0, Number(c.total_volume) || 0)
      const gtMoney = Math.max(gt.mcap, gt.vol24)
      const dataless = !(Number(c.current_price) > 0)
      // Overlay only when CG has nothing, or when GT's live numbers dwarf a
      // stale CG record 10x. Healthy CG rows (USDG $3B, tokenized stocks with
      // verified supply) are never touched.
      if (!dataless && gtMoney < cgMoney * 10) return c
      return {
        ...c,
        current_price: gt.price,
        market_cap: gt.mcap || c.market_cap,
        fully_diluted_valuation: gt.mcap || c.fully_diluted_valuation,
        total_volume: gt.vol24 ?? c.total_volume,
        price_change_percentage_24h: Number.isFinite(gt.change24) ? gt.change24 : c.price_change_percentage_24h,
        price_change_percentage_24h_in_currency: Number.isFinite(gt.change24) ? gt.change24 : c.price_change_percentage_24h_in_currency,
        _gt_enriched: true,
      }
    })
    const money = (c) => Number(c.market_cap) || Number(c.fully_diluted_valuation) || 0
    out.sort((a, b) => money(b) - money(a))
    return out
  } catch (_) {
    return rows // enrichment is additive - never break the category on GT failure
  }
}
