/**
 * KOL Radar — project HEALTH (ESM serverless mirror of the dev CJS module at
 * packages/server/lib/kol/health.js). Keep both copies identical in behavior.
 *
 * Source: CoinGecko Pro markets, batched by cg_id (up to 250/req), header
 * `x-cg-pro-api-key: COINGECKO_API_KEY`. 5-min in-memory cache + inflight dedup
 * per cg_id; a missing id resolves to { state:'unknown', tone:'grey' } so a
 * partial CG response never blocks anything.
 *
 *   getProjectHealth(cgIds[]) -> Map<cgId, health>
 *   classifyHealth({ market_cap, change24h, change7d, athChange }) -> { state, tone }
 *   computeLegitimacy(endorsements) -> { score, alive, cooling, dead, unknown, label }
 */
const CG_BASE = 'https://pro-api.coingecko.com/api/v3'
const CG_KEY = () => process.env.COINGECKO_API_KEY || ''
const CHUNK = 250
const TTL = 5 * 60 * 1000
const FETCH_TIMEOUT = 12000

const UNKNOWN = { state: 'unknown', tone: 'grey' }

// cg_id -> { health, ts } ; inflight cg_id -> Promise<void>
const _cache = new Map()
const _inflight = new Map()

// classifyHealth — bull/red rug or micro-corpse, green momentum, amber bleed.
export function classifyHealth({ market_cap, change24h, change7d, athChange } = {}) {
  const mcap = Number(market_cap)
  const c7 = Number(change7d)
  const ath = Number(athChange)

  // dead: crashed from ATH and flatlined, OR micro-cap corpse.
  if (
    (Number.isFinite(mcap) && mcap > 0 && mcap < 300000) ||
    (Number.isFinite(ath) && ath <= -90 && Number.isFinite(c7) && c7 <= 2)
  ) {
    return { state: 'dead', tone: 'red' }
  }
  // alive: real positive momentum.
  if (Number.isFinite(c7) && c7 >= 5) return { state: 'alive', tone: 'green' }
  // cooling: bleeding but not dead.
  if (Number.isFinite(c7) && c7 <= -8) return { state: 'cooling', tone: 'amber' }
  // remainder: flat-positive is alive, flat-negative is cooling.
  if (Number.isFinite(c7)) {
    return c7 >= 0 ? { state: 'alive', tone: 'green' } : { state: 'cooling', tone: 'amber' }
  }
  return { ...UNKNOWN }
}

// computeLegitimacy — green=1.0, amber=0.4, red=0.0, grey excluded.
export function computeLegitimacy(endorsements) {
  let alive = 0
  let cooling = 0
  let dead = 0
  let unknown = 0
  let weightSum = 0
  for (const e of endorsements || []) {
    const tone = e && e.health && e.health.tone
    if (tone === 'green') { alive++; weightSum += 1.0 }
    else if (tone === 'amber') { cooling++; weightSum += 0.4 }
    else if (tone === 'red') { dead++; weightSum += 0.0 }
    else { unknown++ }
  }
  const known = alive + cooling + dead
  const score = known ? Math.round((100 * weightSum) / known) : 0
  // Sample-gate: NEVER damn a KOL on a thin endorsement set (e.g. a sharp caller
  // who went quiet / pivoted to stocks in a bear market shows only 2-3 tracked
  // projects). Below the floor we say "Building", never "Exit Liquidity".
  const MIN_RATED = 4
  let label
  if (!known) label = 'Unrated'
  else if (known < MIN_RATED) label = 'Building'
  else if (score >= 70) label = 'Sharp'
  else if (score >= 45) label = 'Mixed'
  else if (score >= 25) label = 'Degen'
  else label = 'Exit Liquidity'
  return { score, alive, cooling, dead, unknown, label, sample: known < MIN_RATED ? 'limited' : 'ok' }
}

function _toHealth(coin) {
  const h = classifyHealth({
    market_cap: coin.market_cap,
    change24h: coin.price_change_percentage_24h_in_currency,
    change7d: coin.price_change_percentage_7d_in_currency,
    athChange: coin.ath_change_percentage,
  })
  return {
    state: h.state,
    tone: h.tone,
    change24h: coin.price_change_percentage_24h_in_currency ?? null,
    change7d: coin.price_change_percentage_7d_in_currency ?? null,
    ath_change: coin.ath_change_percentage ?? null,
    market_cap: coin.market_cap ?? null,
  }
}

async function _fetchChunk(ids) {
  const url =
    `${CG_BASE}/coins/markets?vs_currency=usd&ids=${ids.map(encodeURIComponent).join(',')}` +
    `&price_change_percentage=24h,7d`
  const res = await fetch(url, {
    headers: CG_KEY() ? { 'x-cg-pro-api-key': CG_KEY() } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error(`CoinGecko markets ${res.status}`)
  const rows = await res.json()
  const now = Date.now()
  const got = new Set()
  for (const coin of Array.isArray(rows) ? rows : []) {
    if (!coin || !coin.id) continue
    _cache.set(coin.id, { health: _toHealth(coin), ts: now })
    got.add(coin.id)
  }
  // ids CG didn't return -> cache as unknown so we don't refetch them every call.
  for (const id of ids) {
    if (!got.has(id)) _cache.set(id, { health: { ...UNKNOWN }, ts: now })
  }
}

/**
 * Batch project health by cg_id. Always resolves a Map covering every input id
 * (missing/failed -> unknown/grey); never throws so a CG outage can't block the
 * registry or a dossier.
 */
export async function getProjectHealth(cgIds) {
  const ids = [...new Set((cgIds || []).filter(Boolean).map(String))]
  const result = new Map()
  if (!ids.length) return result

  const now = Date.now()
  const stale = []
  for (const id of ids) {
    const e = _cache.get(id)
    if (e && now - e.ts < TTL) continue
    stale.push(id)
  }

  // de-dupe in-flight per id, then fetch the remaining stale ids in 250-chunks.
  const need = stale.filter((id) => !_inflight.has(id))
  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK)
    const p = _fetchChunk(chunk).catch((err) => {
      // failure -> short-cache unknown so a partial outage doesn't hammer CG.
      const t = Date.now()
      for (const id of chunk) if (!_cache.has(id)) _cache.set(id, { health: { ...UNKNOWN }, ts: t })
      console.warn('[kol/health] CG chunk failed:', err.message)
    })
    for (const id of chunk) _inflight.set(id, p)
  }

  // await any inflight promise covering one of our ids (own + concurrent callers').
  const waits = new Set()
  for (const id of stale) {
    const p = _inflight.get(id)
    if (p) waits.add(p)
  }
  await Promise.all([...waits])
  for (const id of stale) _inflight.delete(id)

  for (const id of ids) {
    const e = _cache.get(id)
    result.set(id, e ? e.health : { ...UNKNOWN })
  }
  return result
}

export default { getProjectHealth, classifyHealth, computeLegitimacy }
