/**
 * X Dash runners as CoinGecko-market-shaped coins — the bridge that lets the
 * heatmap + bubbles visualizations render the social momentum board.
 *
 * Source: /api/xdash/bootstrap (ranking=momentum), the same board /x-dash and
 * the welcome Social tab rank by. Bootstrap rows carry identity + mcap but no
 * live 24h price change, so one batched CG simple/price call (via the proxy)
 * overlays price / 24h change / live mcap. Rows without a CoinGecko id are
 * dropped — the visualizations need a change % and a trustable mcap, and an
 * unresolvable on-chain husk has neither.
 *
 * One fetch covers the max board (100); callers slice to 25/50/100 via limit.
 */

const TTL = 60_000
const FETCH_TIMEOUT = 25_000
const CACHE = { ts: 0, data: null, promise: null }

function flattenItem(item) {
  if (!item || typeof item !== 'object') return item
  const t = item.token && typeof item.token === 'object' ? item.token : null
  if (!t) return item
  return { ...item, ...t, ...(item.metrics || {}) }
}

async function fetchRunnerBoard() {
  const query = new URLSearchParams({
    page: '1',
    per_page: '100',
    timeframe: '24h',
    ranking: 'momentum',
    segment: 'all',
    market: 'all',
    min_kols: '1',
  })
  // credentials:'include' — iOS standalone PWA drops the HttpOnly gate cookie
  // on same-origin-default fetches (same fix as useXDashBootstrap).
  const res = await fetch(`/api/xdash/bootstrap?${query}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error('X Dash unavailable')
  const json = await res.json()
  const rows = (json?.tokens || []).map(flattenItem)
  const withId = rows.filter(r => r && (r.cg_id || r.token_id))

  // One batched live overlay for the whole board. Best-effort: on failure the
  // bootstrap mcap still sizes the tiles, change just reads 0 (neutral).
  let live = {}
  const ids = [...new Set(withId.map(r => String(r.cg_id || r.token_id)))]
  if (ids.length) {
    try {
      const url = `/api/coingecko/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
      const r2 = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (r2.ok) live = await r2.json() || {}
    } catch { /* neutral color fallback below */ }
  }

  return withId.map((r, i) => {
    const id = String(r.cg_id || r.token_id)
    const lv = live[id] || {}
    const change24 = Number(lv.usd_24h_change)
    const marketCap = Number(lv.usd_market_cap) || Number(r.market_cap) || 0
    const mentions = Number(r.external_mentions_24h ?? r.mentions_24h ?? r.mentions) || 0
    return {
      id,
      coingecko_id: id,
      symbol: String(r.symbol || (r.cashtag || '').replace(/^\$/, '') || '').toUpperCase(),
      name: r.name || r.symbol || id,
      image: r.image || r.image_small || r.image_url || r.logo_url || null,
      current_price: Number(lv.usd) || Number(r.price_usd ?? r.price) || 0,
      market_cap: marketCap,
      market_cap_rank: i + 1,
      total_volume: 0,
      price_change_percentage_24h: Number.isFinite(change24) ? change24 : 0,
      // Contract identity rides through so a runner tile can open the AI
      // Screener on the EXACT token (contract > cg_id, the collision rule).
      address: r.address || r.contract_address || r.contract || null,
      networkId: r.network_id || r.networkId || null,
      chain: r.chain || null,
      _xdash: { mentions_24h: mentions, unique_authors_24h: Number(r.unique_external_authors_24h) || 0 },
    }
  }).filter(c => c.symbol && c.market_cap > 0)
}

export async function getXDashRunnerCoins(limit = 100) {
  const n = Math.max(1, Math.min(100, Number(limit) || 100))
  if (CACHE.data && Date.now() - CACHE.ts < TTL) return CACHE.data.slice(0, n)
  if (!CACHE.promise) {
    CACHE.promise = fetchRunnerBoard()
      .then((coins) => { CACHE.data = coins; CACHE.ts = Date.now(); CACHE.promise = null; return coins })
      .catch((e) => { CACHE.promise = null; throw e })
  }
  return CACHE.promise.then(coins => coins.slice(0, n))
}

/** Category id both pages use for the runners tab. */
export const XDASH_RUNNERS_CATEGORY = 'xdash-runners'
