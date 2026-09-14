/**
 * vitals-core.js — the data engine behind /vitals (Platform Fundamentals).
 *
 * Plan of record: ~/spectre-business-2026-08/VITALS-PLATFORM-FUNDAMENTALS-2026-08-14.md
 *
 * Everything this module returns speaks ONE vocabulary — the Spectre Vitals
 * schema below — regardless of where the number came from. The page never sees
 * a vendor payload shape, so replacing a source later is a change in here and
 * nowhere else.
 *
 * Two lanes, and every field says which one it came from:
 *
 *   FIRST-HAND  Hyperliquid publishes every fill routed through a builder code
 *               as a daily lz4 CSV at stats-data.hyperliquid.xyz. We read the
 *               raw fills and compute volume, revenue, DAU, new users, trades,
 *               ARPU and net user PnL ourselves. Nobody sells this at app
 *               granularity — DefiLlama's derivatives endpoints are paid-gated
 *               and carry no user data at any tier.
 *
 *   SHADOW      Fees / revenue / spot volume / TVL breadth for the ~2.5k
 *               protocols we do not yet collect ourselves, read from
 *               DefiLlama's free API and normalised into our schema. Stamped
 *               provenance:'shadow' end-to-end so the migration to first-hand
 *               is a visible checklist rather than a claim. Never sold — the
 *               sellable /v1/platforms family reads own-data tables only.
 *
 * CJS on purpose: consumed by the Express dev server (CJS) and by the Vercel
 * ESM handler via createRequire, so dev and prod cannot drift.
 */

'use strict'

const { lz4Decode } = require('./lz4-decode')
const { HL_PLATFORMS, BY_SLUG, BY_NORM, normKey, REPORTED } = require('./vitals-registry')

const SCHEMA_VERSION = 'vitals.v1'
const LLAMA = 'https://api.llama.fi'
const HL_ARCHIVE = 'https://stats-data.hyperliquid.xyz/Mainnet/builder_fills'

const PROV = { FIRST_HAND: 'first_hand', SHADOW: 'shadow', DERIVED: 'derived' }

/**
 * What our first-hand collector actually sees, stated once and carried on every
 * value it produces.
 *
 * 🚨 This exists because the first build shipped a real correctness bug: fomo
 * does ~97% of its volume on Solana, so its Hyperliquid-routed trader count
 * (~1.1k/day) is roughly 2% of its real ~40-54k, and we printed that subset in
 * a slot labelled "traders". A partial measurement wearing a total's clothes is
 * worse than no measurement. Until a Solana collector lands, every first-hand
 * number is scoped in the payload AND in the label that renders it.
 */
const FIRST_HAND_COVERAGE = {
  venues: ['Hyperliquid'],
  // The chip copy stays product-neutral — the venue name is data, not a label we
  // advertise. `venues` is still the join key the coverage maths uses.
  partial: true,
  label: 'perps venue only',
  note: 'Counted from perpetual-futures fills we read directly. A platform that also trades spot on other chains shows only that slice here — for a spot-first app it is a small fraction of real activity, not the total.',
}

// How many first-hand platforms one uncached request may compute. The registry
// is ordered by measured volume, so the head of it is >95% of the flow; a cron
// (or the data-api collector) fills the tail. A request must never sit on 100
// archive downloads.
const HL_BUNDLE_LIMIT = 28
const HL_CONCURRENCY = 8
const HL_BUDGET_MS = 30_000

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

const CACHE = new Map() // key -> { value, expires, inflight }

/** TTL cache with in-flight dedup and last-good fallback on upstream failure. */
async function cached(key, ttlMs, fn) {
  const now = Date.now()
  const hit = CACHE.get(key)
  if (hit && hit.expires > now && hit.value !== undefined) return hit.value
  if (hit && hit.inflight) return hit.inflight

  const inflight = (async () => {
    try {
      const value = await fn()
      CACHE.set(key, { value, expires: Date.now() + ttlMs })
      return value
    } catch (err) {
      // Serving a stale answer beats blanking a page on one upstream hiccup.
      if (hit && hit.value !== undefined) {
        CACHE.set(key, { value: hit.value, expires: Date.now() + 30_000 })
        return hit.value
      }
      CACHE.delete(key)
      throw err
    }
  })()

  CACHE.set(key, { ...(hit || {}), inflight })
  return inflight
}

const doFetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : require('node-fetch')(...a))

async function fetchJson(url, { timeoutMs = 25_000, headers = null } = {}) {
  const res = await doFetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    // Extra headers merge in rather than replace: an auth key must never cost us
    // the accept/user-agent that some upstreams gate on.
    headers: { accept: 'application/json', 'user-agent': 'spectre-vitals/1.0', ...(headers || {}) },
  })
  if (!res.ok) throw new Error(`upstream ${res.status} ${url.split('?')[0]}`)
  return res.json()
}

/** Run `worker` over `items` with bounded concurrency and a wall-clock budget. */
async function pooled(items, worker, { concurrency = 8, budgetMs = 0 } = {}) {
  const out = []
  const deadline = budgetMs ? Date.now() + budgetMs : Infinity
  let i = 0
  let truncated = false
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        if (Date.now() > deadline) { truncated = true; return }
        const item = items[i++]
        try {
          const r = await worker(item)
          if (r) out.push(r)
        } catch { /* a single miss must not fail the batch */ }
      }
    })
  )
  out.truncated = truncated
  return out
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null }

/** Percentage change, null when the base is missing or too small to be honest. */
function pct(cur, prev, { minBase = 0 } = {}) {
  const c = num(cur); const p = num(prev)
  if (c == null || p == null || p <= minBase) return null
  return ((c - p) / p) * 100
}

/**
 * Fold the trailing-window fields into one metric object.
 *
 * Neither annual figure is ever extrapolated from a single day — that is how a
 * one-off airdrop becomes a fake "$30m/yr".
 */
function metric(d1, d7, d30, y1, allTime, prev7, prev30) {
  const v30 = num(d30)
  return {
    d1: num(d1), d7: num(d7), d30: v30, y1: num(y1), allTime: num(allTime),
    // `ann` is filled in by metricFromLlama from the trailing-year figure — the
    // definition every fundamentals surface prints under "Annualized". The 30d
    // run-rate is a DIFFERENT number and lives beside it, never in its place.
    ann: null,
    runRate30d: v30 != null ? (v30 * 365) / 30 : null,
    annBasis: null,
    chg7d: pct(d7, prev7),
    chg30d: pct(d30, prev30),
  }
}

const EMPTY_METRIC = { d1: null, d7: null, d30: null, y1: null, allTime: null, ann: null,
  runRate30d: null, annBasis: null, chg7d: null, chg30d: null }

/** Map one DefiLlama dimension row into a Vitals metric. */
function metricFromLlama(row) {
  if (!row) return { ...EMPTY_METRIC }
  const m = metric(row.total24h, row.total7d, row.total30d, row.total1y, row.totalAllTime,
    row.total14dto7d, row.total60dto30d)
  // A single protocol publishes its own annualisation. A folded parent does not
  // (see SUMMABLE) so it derives from the trailing-year total, which folds
  // exactly. Either way `ann` means the same thing to a reader, and annBasis
  // records which path produced it.
  const published = num(row.annualized1y)
  if (published != null) { m.ann = published; m.annBasis = 'published' }
  else if (m.y1 != null) { m.ann = m.y1; m.annBasis = 'trailing_year' }
  return m
}

// ---------------------------------------------------------------------------
// SHADOW lane — DefiLlama free API, normalised on arrival
// ---------------------------------------------------------------------------

const SLIM_KEYS = ['name', 'displayName', 'slug', 'defillamaId', 'category', 'chains', 'logo',
  'total24h', 'total7d', 'total30d', 'total1y', 'totalAllTime', 'total14dto7d', 'total60dto30d',
  'change_1d', 'methodology', 'methodologyURL', 'parentProtocol', 'doublecounted', 'linkedProtocols',
  'annualized1y']

function slimDimension(json) {
  const rows = Array.isArray(json?.protocols) ? json.protocols : []
  return foldParents(rows.map((r) => {
    const o = {}
    for (const k of SLIM_KEYS) if (r[k] !== undefined) o[k] = r[k]
    return o
  }))
}

// 🪤 `annualized1y` is NOT summable across children — each child annualises its
// own partial year, so folding fomo's two products gave $34.53m where the
// protocol's own page says $32.64m. `total1y` folds EXACTLY (verified against
// the parent summary for fomo, Jupiter and Uniswap), so the annual figure for a
// folded parent is derived from it instead.
const SUMMABLE = ['total24h', 'total7d', 'total30d', 'total1y', 'totalAllTime', 'total14dto7d',
  'total60dto30d']

const titleCase = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())

/**
 * Fold child protocols into their parent.
 *
 * 974 of the ~2,560 fee rows are children (Jupiter ships as five: Aggregator,
 * Perpetual Exchange, Ape, Staked SOL, DCA; fomo ships as Wallet + Perps).
 * Only 5 parents are also listed in their own right. Without this fold a
 * leaderboard has no row called "Jupiter" and no row called "fomo" — which is
 * precisely the combined view the product is meant to show.
 */
function foldParents(rows) {
  const listed = new Set(rows.map((r) => r.slug).filter(Boolean))
  const out = []
  const groups = new Map()

  for (const r of rows) {
    const parent = r.parentProtocol ? String(r.parentProtocol).replace(/^parent#/, '') : null
    // A parent that DefiLlama also lists on its own is already the combined
    // figure — keep that row and drop its children rather than double count.
    if (!parent || listed.has(parent)) { if (!parent) out.push(r); continue }
    const g = groups.get(parent) || []
    g.push(r)
    groups.set(parent, g)
  }

  for (const [slug, children] of groups) {
    const biggest = children.reduce((a, b) => ((b.total30d || 0) > (a.total30d || 0) ? b : a), children[0])
    const combined = {
      slug,
      name: BY_NORM.get(normKey(slug))?.name || titleCase(slug),
      displayName: undefined,
      defillamaId: null,
      category: biggest.category || null,
      chains: [...new Set(children.flatMap((c) => c.chains || []))],
      logo: `https://icons.llama.fi/${slug}.jpg`,
      methodology: biggest.methodology || null,
      methodologyURL: biggest.methodologyURL || null,
      doublecounted: !!biggest.doublecounted,
      parentProtocol: null,
      _children: children.map((c) => ({ name: c.displayName || c.name, slug: c.slug, total30d: num(c.total30d) })),
    }
    for (const k of SUMMABLE) {
      let sum = null
      for (const c of children) { const n = num(c[k]); if (n != null) sum = (sum || 0) + n }
      combined[k] = sum
    }
    out.push(combined)
  }

  return out
}

function dimensionUrl(kind, dataType) {
  const q = new URLSearchParams({ excludeTotalDataChart: 'true', excludeTotalDataChartBreakdown: 'true' })
  if (dataType) q.set('dataType', dataType)
  return `${LLAMA}/overview/${kind}?${q}`
}

// The dimension payloads are 2-3.5MB each. 25s was not enough on a cold origin
// and the first request of the day 502'd while the second, warm one succeeded.
const DIMENSION_TIMEOUT_MS = 45_000

const shadowFees = () => cached('vt:fees', 15 * 60_000, async () => slimDimension(await fetchJson(dimensionUrl('fees'), { timeoutMs: DIMENSION_TIMEOUT_MS })))
const shadowRevenue = () => cached('vt:rev', 15 * 60_000, async () => slimDimension(await fetchJson(dimensionUrl('fees', 'dailyRevenue'), { timeoutMs: DIMENSION_TIMEOUT_MS })))
const shadowSupplySide = () => cached('vt:ss', 30 * 60_000, async () => slimDimension(await fetchJson(dimensionUrl('fees', 'dailySupplySideRevenue'), { timeoutMs: DIMENSION_TIMEOUT_MS })))
const shadowDexs = () => cached('vt:dexs', 15 * 60_000, async () => slimDimension(await fetchJson(dimensionUrl('dexs'), { timeoutMs: DIMENSION_TIMEOUT_MS })))

/**
 * Drop the current UTC day from a daily series.
 *
 * Every daily upstream — the aggregate tide, per-protocol summaries and the
 * Hyperliquid archive alike — reports today as the hours elapsed so far. Plotted
 * next to complete days that final point reads as a collapse (measured: the
 * whole universe at $60.6m for the day, the named protocols at $3.5m, because
 * the two aggregations are partial by different amounts). A chart is not the
 * place to explain that; the point comes out.
 */
/**
 * DefiLlama ships the breakdown as [ts, { Chain: { Product: value } }].
 * Flatten to one row per day with a column per chain, plus the product split,
 * so a stacked chart can render it directly.
 *
 * 🪤 The partial day is especially poisonous HERE: on the newest timestamp only
 * the fastest-reporting chain has landed, so fomo's Solana column (99% of its
 * revenue) disappears and the chart shows the business collapsing overnight.
 */
function chainSeries(breakdown) {
  if (!Array.isArray(breakdown) || !breakdown.length) return null;
  const rows = [];
  const chains = new Set();
  const products = new Set();
  for (const [ts, byChain] of breakdown) {
    if (!byChain || typeof byChain !== 'object') continue;
    const row = { t: Number(ts), total: 0, chains: {}, products: {} };
    for (const [chain, byProduct] of Object.entries(byChain)) {
      let sum = 0;
      if (byProduct && typeof byProduct === 'object') {
        for (const [product, v] of Object.entries(byProduct)) {
          const n = Number(v) || 0;
          sum += n;
          row.products[product] = (row.products[product] || 0) + n;
          products.add(product);
        }
      } else {
        sum = Number(byProduct) || 0;
      }
      row.chains[chain] = sum;
      row.total += sum;
      chains.add(chain);
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.t - b.t);

  // Date-based partial-day dropping is NOT enough on a breakdown. Each chain's
  // adapter reports on its own lag, so a day that is over can still be missing
  // a chain: fomo's 2026-08-13 row arrived carrying Hyperliquid's $7.4k and no
  // Solana at all, and Solana is 99% of fomo. Plotted, the business appears to
  // collapse overnight. So a trailing row is also incomplete when it is a
  // fraction of normal, or when a chain that normally carries real weight is
  // simply absent.
  let kept = dropPartialDay(rows.map((r) => [r.t, r.total])).length
    ? rows.slice(0, dropPartialDay(rows.map((r) => [r.t, r.total])).length)
    : rows.slice(0, -1);

  const REF = 14;
  const weightyChains = (() => {
    const ref = kept.slice(-REF);
    const tot = ref.reduce((a, r) => a + r.total, 0);
    if (tot <= 0) return [];
    const per = new Map();
    for (const r of ref) for (const [c, v] of Object.entries(r.chains)) per.set(c, (per.get(c) || 0) + v);
    return [...per.entries()].filter(([, v]) => v / tot >= 0.1).map(([c]) => c);
  })();

  while (kept.length > REF) {
    const last = kept[kept.length - 1];
    const ref = kept.slice(-1 - REF, -1);
    const totals = ref.map((r) => r.total).sort((a, b) => a - b);
    const median = totals[Math.floor(totals.length / 2)] || 0;
    const starved = median > 0 && last.total < median * 0.3;
    const missingWeighty = weightyChains.some((c) => !(last.chains[c] > 0));
    if (!starved && !missingWeighty) break;
    kept = kept.slice(0, -1);
  }

  return kept.length
    ? { rows: kept, chains: [...chains], products: [...products] }
    : null;
}

function dropPartialDay(points) {
  if (!Array.isArray(points)) return []
  const todayUtc = Math.floor(Date.now() / 86_400_000) * 86_400
  return points.filter((p) => Array.isArray(p) && p[0] < todayUtc)
}

/**
 * 🪤🪤 A DAY BEING OVER DOES NOT MEAN THE DAY IS COMPLETE.
 *
 * Dropping by date only assumes every chain's adapter reports on the same
 * clock. They do not. On 2026-08-14 fomo's revenue series ended:
 *
 *   Aug 10  $389,286
 *   Aug 11  $443,539
 *   Aug 12  $379,822
 *   Aug 13    $7,409   <- Hyperliquid had landed, Solana had not
 *
 * Solana is 99% of fomo, so every chart on that page closed with a 98% cliff
 * that is pure reporting lag. A reader sees one of those and concludes the
 * whole surface is fabricated, which is exactly the reaction this page got.
 *
 * So a trailing point is also incomplete when it is a small fraction of what
 * the platform normally prints. Bounded deliberately: at most two trailing
 * points, and only when they fall under a third of the recent median, so a
 * genuine multi-day decline is never quietly erased.
 */
function dropIncompleteTail(points, { maxDrop = 2, floorRatio = 0.3, ref = 14 } = {}) {
  let out = dropPartialDay(points)
  for (let dropped = 0; dropped < maxDrop && out.length > ref; dropped += 1) {
    const last = Number(out[out.length - 1][1]) || 0
    const prior = out.slice(-1 - ref, -1).map((p) => Number(p[1]) || 0).sort((a, b) => a - b)
    const median = prior[Math.floor(prior.length / 2)] || 0
    if (median <= 0 || last >= median * floorRatio) break
    out = out.slice(0, -1)
  }
  return out
}

/** The aggregate daily-fee tide (one array, cheap) used by the hero. */
const shadowTide = () => cached('vt:tide', 30 * 60_000, async () => {
  const j = await fetchJson(`${LLAMA}/overview/fees?excludeTotalDataChartBreakdown=true`)
  return Array.isArray(j?.totalDataChart) ? j.totalDataChart : []
})

/**
 * TVL + market cap, keyed by slug. This is the one genuinely large upstream
 * (~8.5MB), so it is slimmed on arrival and cached for an hour and lives in the
 * `extra` tier — the page paints its numbers before this lands.
 */
const shadowTvl = () => cached('vt:tvl', 60 * 60_000, async () => {
  const rows = await fetchJson(`${LLAMA}/protocols`, { timeoutMs: 45_000 })
  const map = Object.create(null)
  for (const r of Array.isArray(rows) ? rows : []) {
    const slug = r.slug || r.name
    if (!slug) continue
    const tvl = num(r.tvl)
    if (tvl == null && r.mcap == null) continue
    map[String(slug).toLowerCase()] = {
      tvl, mcap: num(r.mcap), chg1d: num(r.change_1d), chg7d: num(r.change_7d),
      category: r.category || null, symbol: r.symbol && r.symbol !== '-' ? r.symbol : null,
      twitter: r.twitter || null, url: r.url || null, description: r.description || null,
      logo: r.logo || null, chains: Array.isArray(r.chains) ? r.chains.slice(0, 8) : [],
    }
  }
  return map
})

// 90, not 30: a row sparkline is ~900px wide on a desktop ladder, and 30 points
// across that is 30px per reading — fat wobbles, not a trend. 90 daily bars read
// as a tape.
/**
 * Identity + market cap for PARENT protocols.
 *
 * The `/protocols` list only carries rows for leaf protocols (Uniswap V2, V3,
 * …), never for the parent we fold them into — which is why market cap read as
 * null for Uniswap, Hyperliquid and pump.fun and took P/F and P/S down with it.
 * `lite/protocols2` is the one call that returns the parents: 811 of them, with
 * mcap on 294, plus the `gecko_id` we need to fill the rest from CoinGecko.
 *
 * It also carries the identity fields the fold used to lose — symbol, token
 * address, github, twitter, description.
 */
const shadowMeta = () => cached('vt:meta', 60 * 60_000, async () => {
  const j = await fetchJson(`${LLAMA}/lite/protocols2`, { timeoutMs: 45_000 })
  const byKey = Object.create(null)
  const put = (k, v) => { const key = normKey(k); if (key && !byKey[key]) byKey[key] = v }

  const shape = (r) => ({
    mcap: pos(num(r.mcap)),
    geckoId: r.gecko_id || null,
    symbol: r.symbol && r.symbol !== '-' ? r.symbol : null,
    address: r.address || null,
    github: Array.isArray(r.github) ? r.github : null,
    twitter: r.twitter || null,
    url: r.url || null,
    description: r.description || null,
    logo: r.logo || null,
  })

  // Parents first so a leaf can never overwrite the identity of the entity we
  // actually rank (`put` keeps the first writer).
  for (const r of Array.isArray(j?.parentProtocols) ? j.parentProtocols : []) {
    const v = shape(r)
    put(r.name, v)
    if (r.id) put(String(r.id).replace(/^parent#/, ''), v)
  }
  for (const r of Array.isArray(j?.protocols) ? j.protocols : []) {
    const v = shape(r)
    put(r.slug || r.name, v)
    put(r.name, v)
  }
  return byKey
})

/**
 * Chain -> native-token identity.
 *
 * A chain earns fees like any other platform, and its "market cap" is its native
 * token — but the protocol lists carry no token for a chain row, so Ethereum,
 * BSC and Tron all ranked with a blank valuation. 365 of 461 chains publish a
 * gecko id here; the ones that do not (Base) genuinely have no token, and stay
 * blank rather than borrowing their L1's.
 */
const shadowChains = () => cached('vt:chains', 60 * 60_000, async () => {
  const rows = await fetchJson(`${LLAMA}/v2/chains`, { timeoutMs: 30_000 })
  const map = Object.create(null)
  for (const c of Array.isArray(rows) ? rows : []) {
    if (!c?.name || !c.gecko_id) continue
    map[normKey(c.name)] = { geckoId: c.gecko_id, symbol: c.tokenSymbol || null }
  }
  return map
})

const CG_PRO = 'https://pro-api.coingecko.com/api/v3'
const CG_BATCH = 250

/**
 * Live valuation for the tokens we can identify, straight from CoinGecko.
 *
 * Preferred over the cap carried by the protocol lists for two reasons: it is
 * refreshed continuously rather than at the list's own cadence, and it also
 * returns FULLY DILUTED valuation — the number that actually matters for a
 * young platform whose float is a fraction of its eventual supply.
 *
 * Keyed by gecko id ONLY. Never by ticker: a symbol match is how a Base token
 * called DOT ends up wearing Polkadot's valuation.
 */
const cgMarkets = (ids) => {
  const key = process.env.COINGECKO_API_KEY
  const wanted = [...new Set(ids.filter(Boolean))].sort()
  if (!key || !wanted.length) return Promise.resolve({})
  return cached(`vt:cg:${wanted.length}:${wanted[0]}:${wanted[wanted.length - 1]}`, 20 * 60_000, async () => {
    const out = Object.create(null)
    const pages = []
    for (let i = 0; i < wanted.length; i += CG_BATCH) pages.push(wanted.slice(i, i + CG_BATCH))
    await pooled(pages, async (page) => {
      const url = `${CG_PRO}/coins/markets?vs_currency=usd&per_page=${CG_BATCH}&ids=${encodeURIComponent(page.join(','))}`
      const rows = await fetchJson(url, { timeoutMs: 25_000, headers: { 'x-cg-pro-api-key': key } })
      for (const r of Array.isArray(rows) ? rows : []) {
        if (!r?.id) continue
        out[r.id] = {
          mcap: pos(num(r.market_cap)),
          fdv: pos(num(r.fully_diluted_valuation)),
          price: pos(num(r.current_price)),
          symbol: r.symbol ? String(r.symbol).toUpperCase() : null,
        }
      }
    }, { concurrency: 3, budgetMs: 30_000 })
    return out
  })
}

// ---------------------------------------------------------------------------
// growthepie — third-party active addresses (CC-BY-4.0, attribution required)
// ---------------------------------------------------------------------------

const GP = 'https://api.growthepie.xyz/v1'

/**
 * Attribution is a LICENCE TERM, not a courtesy: growthepie publishes under
 * CC-BY-4.0, so anywhere this data is rendered has to carry the credit.
 */
const GP_SOURCE = {
  id: 'growthepie',
  label: 'growthepie',
  url: 'https://www.growthepie.com',
  licence: 'CC-BY-4.0',
  attribution: 'Source: growthepie, https://www.growthepie.com',
  note: 'Active addresses on Ethereum and its L2s. A third-party count, not our own.',
}

// Their documented ceiling is 10 calls/minute. One in-flight call at a time with
// a spacing floor keeps us well inside it however many pages ask at once.
const GP_MIN_GAP_MS = 7_000
let gpChain = Promise.resolve()
let gpLast = 0
function gpQueue(fn) {
  const next = gpChain.then(async () => {
    const wait = GP_MIN_GAP_MS - (Date.now() - gpLast)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    gpLast = Date.now()
    return fn()
  })
  // Keep the chain alive after a rejection, or one failure stalls the lane.
  gpChain = next.catch(() => {})
  return next
}

const gpNorm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
function gpHost(u) {
  try { return new URL(String(u).startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase() } catch { return null }
}
function gpHandle(u) {
  const m = String(u || '').match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i)
  return m ? m[1].toLowerCase() : null
}

/** The project inventory, indexed for the strict resolver below. */
const gpProjects = () => cached('vt:gp:projects', 24 * 60 * 60_000, async () => {
  const raw = await gpQueue(() => fetchJson(`${GP}/labels/projects.json`, { timeoutMs: 45_000 }))
  const types = raw?.data?.types || []
  const rowsRaw = raw?.data?.data || []
  const owner = new Map(); const disp = new Map(); const byHost = new Map(); const byTw = new Map()
  for (const arr of rowsRaw) {
    const r = Object.fromEntries(types.map((t, i) => [t, arr[i]]))
    const k = r.owner_project
    if (!k) continue
    const o = gpNorm(k); if (o && !owner.has(o)) owner.set(o, k)
    const d = gpNorm(r.display_name); if (d && !disp.has(d)) disp.set(d, k)
    const h = gpHost(r.website); if (h && !byHost.has(h)) byHost.set(h, k)
    const t = gpHandle(r.twitter); if (t && !byTw.has(t)) byTw.set(t, k)
  }
  return { owner, disp, byHost, byTw }
})

/**
 * Resolve one of our platforms to a growthepie project — STRICTLY.
 *
 * A single fuzzy signal is not enough, and this is not theoretical caution:
 * matching on website alone mapped BSC onto an unrelated project, Ethereum onto
 * the go-ethereum client, and Securitize onto BlackRock. Publishing another
 * project's user count under a platform's name is the worst failure this page
 * can have, so a match needs either two independent signals that agree, or an
 * exact hit on growthepie's own project id. Anything conflicting is refused.
 */
function gpResolve(platform, idx) {
  if (!idx) return null
  const n = gpNorm(platform.name)
  const nameHit = idx.owner.get(n) || idx.disp.get(n) || idx.owner.get(gpNorm(platform.llamaSlug)) || null
  const hostHit = idx.byHost.get(gpHost(platform.website)) || null
  const twHit = idx.byTw.get(gpHandle(platform.twitter)) || null

  const sigs = [nameHit, hostHit, twHit].filter(Boolean)
  const uniq = [...new Set(sigs)]
  if (uniq.length > 1) return null            // signals disagree — refuse
  if (sigs.length >= 2) return uniq[0]        // corroborated
  if (nameHit && gpNorm(nameHit) === n) return nameHit  // exact project id
  return null
}

const GP_KEEP_DAYS = 180

/** Active addresses + transactions for one growthepie project, slimmed. */
const gpApp = (ownerProject) => cached(`vt:gp:app:${ownerProject}`, 12 * 60 * 60_000, async () => {
  // A project in the label index does not necessarily have app-level metrics —
  // those 403. Cache the miss as null rather than letting it throw, or every
  // view of that platform spends one of ten calls a minute re-learning it.
  let j = null
  try {
    j = await gpQueue(() => fetchJson(`${GP}/apps/details/${encodeURIComponent(ownerProject)}.json`, { timeoutMs: 45_000 }))
  } catch (err) {
    if (/upstream (40\d|41\d)/.test(String(err && err.message))) return null
    throw err
  }
  if (!j) return null
  const cutoff = Date.now() - GP_KEEP_DAYS * 86_400_000

  const pull = (metric) => {
    const over = j?.metrics?.[metric]?.over_time || {}
    const byChain = {}
    const totals = new Map()
    for (const [chain, blk] of Object.entries(over)) {
      const data = blk?.daily?.data || []
      if (!data.length) continue
      const pts = data
        .filter((row) => Array.isArray(row) && row[0] >= cutoff)
        .map((row) => [Math.round(row[0] / 1000), num(row[1])])
        .filter((row) => row[1] != null)
      if (!pts.length) continue
      byChain[chain] = pts[pts.length - 1][1]
      for (const [t, val] of pts) totals.set(t, (totals.get(t) || 0) + val)
    }
    const series = [...totals.entries()].sort((a, b) => a[0] - b[0])
    return { byChain, series, latest: series.length ? series[series.length - 1][1] : null }
  }

  const daa = pull('daa')
  const tx = pull('txcount')
  if (daa.latest == null && tx.latest == null) return null

  // Averaged rather than point-in-time: a single day of addresses is noisy, and
  // the 30-day mean is what a reader actually means by "how many users".
  const mean = (series, days) => {
    const win = series.slice(-days)
    return win.length ? win.reduce((a, [, v]) => a + v, 0) / win.length : null
  }

  return {
    source: GP_SOURCE,
    ownerProject,
    activeAddresses: { latest: daa.latest, avg7d: mean(daa.series, 7), avg30d: mean(daa.series, 30), byChain: daa.byChain },
    transactions: { latest: tx.latest, avg30d: mean(tx.series, 30), byChain: tx.byChain },
    series: { activeAddresses: daa.series, transactions: tx.series },
    firstSeen: j?.first_seen || null,
    updatedAt: j?.last_updated_utc || null,
  }
})

/**
 * Cache-only read, plus a background warm.
 *
 * Compare can hold four platforms, and the growthepie lane is serialised at one
 * call per seven seconds — awaiting four of them would put half a minute in
 * front of a table that is otherwise instant. So the comparison shows this row
 * when the data is already warm and kicks a fetch for when it is not.
 */
async function thirdPartyUsersCached(platform) {
  try {
    const idx = await gpProjects()
    const key = gpResolve(platform, idx)
    if (!key) return null
    return cachedOrKick(`vt:gp:app:${key}`, () => gpApp(key))
  } catch { return null }
}

/**
 * Generous, because this no longer blocks anything: it is fetched by its own
 * request while the page is already painted. At 9s it was timing out on the
 * queue's own 7s spacing and returning null for platforms whose data we
 * demonstrably have (Uniswap, 213k addresses).
 */
const GP_FIRST_WAIT_MS = 30_000

/**
 * Warm: instant. Cold: waits for the fetch, up to the bound above, then hands
 * back null and lets the in-flight request finish anyway so the next view is
 * instant either way.
 */
async function thirdPartyUsers(platform) {
  try {
    const idx = await gpProjects()
    const key = gpResolve(platform, idx)
    if (!key) return null

    const cacheKey = `vt:gp:app:${key}`
    const hit = CACHE.get(cacheKey)
    if (hit && hit.value !== undefined && hit.expires > Date.now()) return hit.value

    const inflight = gpApp(key).catch(() => null)
    let timer
    const bounded = new Promise((resolve) => { timer = setTimeout(() => resolve(null), GP_FIRST_WAIT_MS) })
    const out = await Promise.race([inflight, bounded])
    clearTimeout(timer)
    return out
  } catch { return null }
}

const SPARK_DAYS = 90

/**
 * A 30-day trend for one platform, for the inline sparkline on a board row.
 *
 * Warmed in the BACKGROUND and read from cache: 40 summary fetches must never
 * sit on the request that draws the board. A row without a warm spark simply
 * renders without one and picks it up on the next visit.
 */
function sparkSeries(llamaSlug) {
  return cached(`vt:spark:${llamaSlug}`, 60 * 60_000, async () => {
    const j = await shadowSummary('fees', llamaSlug)
    return dropPartialDay(j?.totalDataChart).slice(-SPARK_DAYS).map((p) => p[1] || 0)
  })
}

function sparkCached(llamaSlug) {
  if (!llamaSlug) return null
  const hit = CACHE.get(`vt:spark:${llamaSlug}`)
  return hit && hit.value !== undefined && hit.expires > Date.now() ? hit.value : null
}

/** Fire-and-forget warm for the slugs a board is about to show. */
function warmSparks(slugs) {
  const cold = [...new Set(slugs.filter((x) => x && !sparkCached(x)))].slice(0, 60)
  if (!cold.length) return
  pooled(cold, (slug) => sparkSeries(slug).catch(() => null), { concurrency: 6, budgetMs: 25_000 })
    .catch(() => {})
}

/**
 * FIRST-HAND sparklines.
 *
 * `sparkCached` is keyed on the DefiLlama slug, and the platforms a first-hand
 * board is made of (Hyperliquid-native apps — Invo, fomo, MetaScalp, GTR…) have
 * no DefiLlama slug at all. So every row on the Users / Perp volume / User PnL
 * boards came back with `spark: null` and the board rendered with no trend line
 * anywhere — measured 0 of 12 rows on prod.
 *
 * Two things wrong with that, and one fix for both: a board ranked by daily
 * traders should not be drawing a FEE chart next to it in the first place. These
 * sparks come from our own daily fills and plot the metric the board is actually
 * ranked by.
 *
 * Same discipline as the fee sparks — read from cache, warm in the background,
 * never sit on the request that draws the board. `hlHistory` pools over
 * `platformDay`, which the daily bundle already warms, so once a day is cached
 * this costs nothing.
 */
const FIRST_HAND_SPARK_FIELD = {
  users: 'dau',
  perpVolume: 'perpVolume',
  userPnl: 'userPnl',
  trades: 'trades',
  arpu: 'arpu',
}

function firstHandDailiesCached(slug, days = 30) {
  if (!slug) return null
  const hit = CACHE.get(`vt:hlh:${slug}:${days}`)
  return hit && hit.value !== undefined && hit.expires > Date.now() ? hit.value : null
}

function firstHandSparkCached(slug, field, days = 30) {
  if (!field) return null
  const series = firstHandDailiesCached(slug, days)?.series
  if (!Array.isArray(series) || series.length < 2) return null
  const out = series.map((d) => (Number.isFinite(d?.[field]) ? d[field] : 0))
  // An all-zero run is not a trend — it is a platform with no activity in the
  // window, and a flat line on the floor would read as real data.
  return out.some((v) => v !== 0) ? out : null
}

/** Fire-and-forget warm of the first-hand dailies a board is about to show. */
function warmFirstHandSparks(slugs, days = 30) {
  const cold = [...new Set(slugs.filter((x) => x && !firstHandDailiesCached(x, days)))].slice(0, 24)
  if (!cold.length) return
  pooled(cold, (slug) => hlHistory(slug, { days }).catch(() => null), { concurrency: 4, budgetMs: 25_000 })
    .catch(() => {})
}

/** Per-protocol daily series + methodology (detail page). */
function shadowSummary(kind, slug, dataType) {
  const key = `vt:sum:${kind}:${slug}:${dataType || 'default'}`
  return cached(key, 30 * 60_000, async () => {
    const q = dataType ? `?dataType=${encodeURIComponent(dataType)}` : ''
    return fetchJson(`${LLAMA}/summary/${kind}/${encodeURIComponent(slug)}${q}`)
  })
}

// ---------------------------------------------------------------------------
// FIRST-HAND lane — Hyperliquid builder fills
// ---------------------------------------------------------------------------

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
const dayKeyToIso = (k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`

/** Archive days, newest first. The feed publishes a day after it closes, so
 *  "yesterday" is the newest that can exist and is sometimes not up yet. */
function recentDays(count, offset = 1) {
  const out = []
  const base = Date.now()
  for (let i = 0; i < count; i++) {
    out.push(ymd(new Date(base - (i + offset) * 86_400_000)))
  }
  return out
}

/**
 * One builder address, one day → the fill aggregate.
 * Columns (verified against the live archive 2026-08-14):
 *   time,user,coin,side,px,sz,crossed,special_trade_type,tif,is_trigger,
 *   counterparty,closed_pnl,twap_id,builder_fee
 */
async function fetchBuilderDay(address, day) {
  const url = `${HL_ARCHIVE}/${address}/${day}.csv.lz4`
  const res = await doFetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) return null // 403 = not published (yet, or ever for that day)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) return null

  let csv
  try { csv = lz4Decode(buf).toString('utf8') } catch { return null }

  const nl = csv.indexOf('\n')
  if (nl < 0) return null
  const head = csv.slice(0, nl).trim().split(',')
  const ix = {
    user: head.indexOf('user'), coin: head.indexOf('coin'), px: head.indexOf('px'),
    sz: head.indexOf('sz'), pnl: head.indexOf('closed_pnl'), fee: head.indexOf('builder_fee'),
  }
  if (ix.user < 0 || ix.px < 0 || ix.sz < 0) return null

  let volume = 0, fees = 0, pnl = 0, trades = 0
  const users = new Set()
  const coins = new Map()

  let start = nl + 1
  while (start < csv.length) {
    let end = csv.indexOf('\n', start)
    if (end < 0) end = csv.length
    if (end > start) {
      const c = csv.slice(start, end).split(',')
      const px = +c[ix.px]; const sz = +c[ix.sz]
      if (Number.isFinite(px) && Number.isFinite(sz)) {
        const notional = px * sz
        volume += notional
        trades++
        users.add(c[ix.user])
        if (ix.fee >= 0) { const f = +c[ix.fee]; if (Number.isFinite(f)) fees += f }
        if (ix.pnl >= 0) { const p = +c[ix.pnl]; if (Number.isFinite(p)) pnl += p }
        if (ix.coin >= 0) coins.set(c[ix.coin], (coins.get(c[ix.coin]) || 0) + notional)
      }
    }
    start = end + 1
  }

  if (!trades) return null
  return { volume, fees, pnl, trades, users, coins }
}

/**
 * All of one platform's builder addresses, one day, merged.
 *
 * Cached per (platform, day) so a sweep that runs out of budget still banks the
 * platforms it did fetch. Without this, a truncated sweep threw away all of its
 * work and the next one started from zero — which is how a busy moment cached a
 * 12-of-28 result for six hours.
 */
function platformDay(platform, day) {
  return cached(`vt:pd:${platform.slug}:${day}`, 12 * 60 * 60_000, () => platformDayUncached(platform, day))
}

async function platformDayUncached(platform, day) {
  const parts = []
  for (const addr of platform.builders) {
    const r = await fetchBuilderDay(addr, day)
    if (r) parts.push(r)
  }
  if (!parts.length) return null

  const users = new Set()
  const coins = new Map()
  let volume = 0, fees = 0, pnl = 0, trades = 0
  for (const p of parts) {
    volume += p.volume; fees += p.fees; pnl += p.pnl; trades += p.trades
    for (const u of p.users) users.add(u)
    for (const [c, v] of p.coins) coins.set(c, (coins.get(c) || 0) + v)
  }

  return {
    slug: platform.slug, day: dayKeyToIso(day),
    perpVolume: volume, revenue: fees, userPnl: pnl, trades,
    dau: users.size,
    arpu: users.size ? fees / users.size : null,
    avgTrade: trades ? volume / trades : null,
    topCoins: [...coins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([coin, v]) => ({ coin, volume: v })),
    _users: users,
  }
}

/**
 * The first-hand rollup for one archive day across the registry head.
 * Returns rows plus an honest coverage note — a truncated sweep must never
 * read as "these are all the platforms".
 */
function hlDay(day, { limit = HL_BUNDLE_LIMIT, budgetMs = HL_BUDGET_MS } = {}) {
  const key = `vt:hl:${day}:${limit}`
  return cached(key, 6 * 60 * 60_000, async () => {
    const universe = HL_PLATFORMS.slice(0, limit)
    const rows = await pooled(universe, (p) => platformDay(p, day),
      { concurrency: HL_CONCURRENCY, budgetMs })
    const clean = rows.map(({ _users, ...r }) => r).sort((a, b) => b.perpVolume - a.perpVolume)
    if (rows.truncated) {
      // A truncated sweep is a partial answer, not the answer: hold it for ten
      // minutes instead of six hours so the next visit finishes the job against
      // the now-warm per-platform cache. (Runs after cached() stores the value —
      // the microtask that sets it resolves before this macrotask.)
      setTimeout(() => {
        const hit = CACHE.get(key)
        if (hit) CACHE.set(key, { ...hit, expires: Date.now() + 10 * 60_000 })
      }, 0)
    }
    return {
      day: dayKeyToIso(day),
      rows: clean,
      scope: FIRST_HAND_COVERAGE,
      coverage: { scanned: universe.length, withData: clean.length, registry: HL_PLATFORMS.length, truncated: !!rows.truncated },
      totals: clean.reduce((a, r) => ({
        perpVolume: a.perpVolume + r.perpVolume,
        revenue: a.revenue + r.revenue,
        dau: a.dau + r.dau,
        trades: a.trades + r.trades,
        userPnl: a.userPnl + r.userPnl,
      }), { perpVolume: 0, revenue: 0, dau: 0, trades: 0, userPnl: 0 }),
    }
  })
}

/**
 * Return a cached value if we already hold one, otherwise start the work in the
 * background and return null now.
 *
 * Used for the first-hand sweep: reading ~28 daily fill archives takes ~30s cold,
 * and making the whole page wait on it turned a 20s cold build into 49s. The
 * first-hand band is additive — the page renders without it and picks it up on
 * the next request, by which time the sweep has landed.
 */
function cachedOrKick(key, produce) {
  const hit = CACHE.get(key)
  if (hit && hit.value !== undefined && hit.expires > Date.now()) return hit.value
  if (!hit?.inflight) Promise.resolve().then(produce).catch(() => {})
  return null
}

/** Newest archive day that actually exists, probing backwards a few days. */
function latestHlDay() {
  return cached('vt:hl:latest', 30 * 60_000, async () => {
    const probe = HL_PLATFORMS[0].builders[0]
    for (const day of recentDays(4)) {
      try {
        const res = await doFetch(`${HL_ARCHIVE}/${probe}/${day}.csv.lz4`, {
          method: 'HEAD', signal: AbortSignal.timeout(12_000),
        })
        if (res.ok) return day
      } catch { /* try the next day back */ }
    }
    return recentDays(1)[0]
  })
}

/**
 * One platform's first-hand daily history, plus the cohort maths that only raw
 * fills can produce: new users, returning users and D7 retention.
 *
 * `newUsers` and retention are measured WITHIN the loaded window — a user first
 * seen on day 3 of a 21-day window may have traded before it. The window length
 * is returned so the UI can say so instead of implying an all-time cohort.
 */
function hlHistory(slug, { days = 30 } = {}) {
  const platform = BY_SLUG.get(slug)
  if (!platform) return Promise.resolve(null)

  return cached(`vt:hlh:${slug}:${days}`, 6 * 60 * 60_000, async () => {
    const latest = await latestHlDay()
    const anchor = new Date(`${dayKeyToIso(latest)}T00:00:00Z`).getTime()
    const keys = Array.from({ length: days }, (_, i) => ymd(new Date(anchor - i * 86_400_000)))

    const raw = await pooled(keys, async (day) => {
      const r = await platformDay(platform, day)
      return r || null
    }, { concurrency: 6, budgetMs: 45_000 })

    raw.sort((a, b) => (a.day < b.day ? -1 : 1))

    const seen = new Set()
    const userDays = new Map() // user -> [dayIndex]
    const series = raw.map((r, idx) => {
      let fresh = 0
      for (const u of r._users) {
        if (!seen.has(u)) { seen.add(u); fresh++ }
        const list = userDays.get(u)
        if (list) list.push(idx); else userDays.set(u, [idx])
      }
      const { _users, ...rest } = r
      return { ...rest, newUsers: fresh, returningUsers: r.dau - fresh }
    })

    // D7 retention: of the users who FIRST appeared on day d, how many traded
    // again on any day in [d+1, d+7]. Only cohorts with a full 7-day runway and
    // a meaningful base are reported.
    const cohorts = []
    for (let d = 0; d < series.length - 7; d++) {
      let base = 0; let kept = 0
      for (const [, idxs] of userDays) {
        if (idxs[0] !== d) continue
        base++
        if (idxs.some((i) => i > d && i <= d + 7)) kept++
      }
      if (base >= 10) cohorts.push({ day: series[d].day, base, retained: kept, rate: (kept / base) * 100 })
    }
    const retentionD7 = cohorts.length
      ? cohorts.reduce((a, c) => a + c.retained, 0) / cohorts.reduce((a, c) => a + c.base, 0) * 100
      : null

    const windowUsers = seen.size
    // Window totals, summed from the same fills. DefiLlama's derivatives
    // dimension — where 30d perp volume lives — is paid-gated, so this is the
    // one number on the page we compute BECAUSE it cannot be shadowed.
    const totals = series.reduce((a, d) => ({
      perpVolume: a.perpVolume + (d.perpVolume || 0),
      revenue: a.revenue + (d.revenue || 0),
      trades: a.trades + (d.trades || 0),
      userPnl: a.userPnl + (d.userPnl || 0),
    }), { perpVolume: 0, revenue: 0, trades: 0, userPnl: 0 })
    totals.days = series.length
    totals.uniqueUsers = windowUsers
    totals.avgDau = series.length ? series.reduce((a, d) => a + (d.dau || 0), 0) / series.length : null

    return {
      slug, windowDays: days, series, cohorts, retentionD7, windowUsers, totals,
      scope: FIRST_HAND_COVERAGE,
      coverage: { requested: days, returned: series.length, truncated: !!raw.truncated },
    }
  })
}

// ---------------------------------------------------------------------------
// assembly — one universe, one vocabulary
// ---------------------------------------------------------------------------

/** Index a slimmed dimension array by every key we might join on. */
function indexRows(rows) {
  const byId = new Map(); const byNorm = new Map()
  for (const r of rows) {
    if (r.defillamaId != null) byId.set(String(r.defillamaId), r)
    for (const k of [r.slug, r.name, r.displayName]) {
      if (k) { const n = normKey(k); if (!byNorm.has(n)) byNorm.set(n, r) }
    }
  }
  return { byId, byNorm }
}

const pickRow = (idx, row) =>
  (row.defillamaId != null && idx.byId.get(String(row.defillamaId))) ||
  idx.byNorm.get(normKey(row.slug || row.name)) || null

/**
 * Methodology arrives in two shapes: a plain string for some protocols, and a
 * keyed object for most ({ Fees, Revenue, ProtocolRevenue, SupplySideRevenue }).
 * Normalising here means the view renders a list and never has to guess — the
 * un-normalised object crashed the detail page with "Objects are not valid as a
 * React child".
 */
function normalizeMethodology(m) {
  if (!m) return []
  if (typeof m === 'string') return m.trim() ? [{ label: null, text: m.trim() }] : []
  if (typeof m !== 'object') return []
  return Object.entries(m)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([label, text]) => ({ label: label.replace(/([a-z])([A-Z])/g, '$1 $2'), text: text.trim() }))
}

const CATEGORY_ALIAS = { 'Dexs': 'DEX', 'Dexes': 'DEX', 'Derivatives': 'Perp Venue' }
const cleanCategory = (c) => CATEGORY_ALIAS[c] || c || 'Other'

/** TVL is meaningless for a trading frontend; showing 0 would be a lie. */
const TVL_LESS = new Set(['Trading App', 'Wallet', 'Telegram Bot', 'Social Trading', 'Launchpad',
  'Trading Terminal', 'AI Agent', 'Copy Trading', 'Perp Aggregator'])

/**
 * TVL for a row, including folded parents.
 *
 * The TVL upstream lists individual protocols only — there is no "jupiter" row,
 * just jupiter-perpetual-exchange, jupiter-lend and so on. So a folded parent
 * sums its children's TVL. Market cap is NOT summed: the children share one
 * token, so summing would multiply the same cap by the number of products.
 */
function resolveTvl(feeRow, llamaSlug, tvlMap) {
  if (!tvlMap) return null
  const direct = tvlMap[String(llamaSlug).toLowerCase()]
  if (direct) return direct

  const kids = Array.isArray(feeRow._children) ? feeRow._children : []
  if (!kids.length) return null

  let tvl = null; let best = null
  const chains = new Set()
  for (const k of kids) {
    const row = tvlMap[String(k.slug || '').toLowerCase()]
    if (!row) continue
    if (row.tvl != null) tvl = (tvl || 0) + row.tvl
    if (!best || (row.mcap || 0) > (best.mcap || 0)) best = row
    for (const c of row.chains || []) chains.add(c)
  }
  if (!best && tvl == null) return null
  return {
    tvl,
    mcap: best?.mcap ?? null,
    chg1d: best?.chg1d ?? null,
    chg7d: best?.chg7d ?? null,
    category: best?.category ?? null,
    symbol: best?.symbol ?? null,
    twitter: best?.twitter ?? null,
    url: best?.url ?? null,
    description: best?.description ?? null,
    logo: null, // the parent icon is already set by the fold
    chains: [...chains].slice(0, 8),
  }
}

/**
 * Upstream adapters occasionally emit figures that cannot be true. Rather than
 * render them, suppress the specific field and leave the rest of the row alone
 * — a platform with one bad number is still worth showing.
 *
 *  - fees/revenue/volume are gross flows and cannot be negative
 *  - a trailing-year total below its own 30-day total means the two windows
 *    disagree, so the annualised figure (and every multiple built on it) goes
 */
function sanitizeMetric(m) {
  if (!m) return m
  const out = { ...m }
  for (const k of ['d1', 'd7', 'd30', 'y1', 'allTime', 'ann', 'runRate30d']) {
    if (out[k] != null && (!Number.isFinite(out[k]) || out[k] < 0)) out[k] = null
  }
  if (out.ann != null && out.d30 != null && out.ann < out.d30 * 0.9) out.ann = null
  return out
}

function buildPlatform(feeRow, ctx) {
  const { revIdx, ssIdx, dexIdx, tvlMap, metaMap, chainMap, hlBySlug } = ctx
  const llamaSlug = feeRow.slug || feeRow.name
  const reg = BY_NORM.get(normKey(llamaSlug)) || BY_NORM.get(normKey(feeRow.name))
  const slug = reg ? reg.slug : String(llamaSlug).toLowerCase()

  const fees = sanitizeMetric(metricFromLlama(feeRow))
  const revenue = sanitizeMetric(metricFromLlama(pickRow(revIdx, feeRow)))
  const supplySide = sanitizeMetric(metricFromLlama(pickRow(ssIdx, feeRow)))
  const dexVolume = sanitizeMetric(metricFromLlama(pickRow(dexIdx, feeRow)))
  const tvlRow = resolveTvl(feeRow, llamaSlug, tvlMap)
  const hl = hlBySlug ? hlBySlug.get(slug) : null

  // Prefer the shadow taxonomy: it is broader and shared across the whole
  // universe, so peers and category boards have real cohorts. Our registry
  // category is the fallback for platforms the shadow lane has never indexed
  // (otherwise fomo sits alone in a category of one).
  const category = cleanCategory(feeRow.category || tvlRow?.category || reg?.category)
  // A take rate outside 0-100% means the fee and revenue adapters disagree about
  // what they are measuring, not that a protocol keeps 140% of what users paid.
  const rawTake = fees.d30 && revenue.d30 != null && fees.d30 > 0 ? (revenue.d30 / fees.d30) * 100 : null
  const takeRate = rawTake != null && rawTake >= 0 && rawTake <= 100.5 ? Math.min(rawTake, 100) : null

  // Identity + cap for the entity we actually rank. The parent map is consulted
  // FIRST: a folded platform's children each carry their own (usually absent)
  // cap, while the parent carries the one cap that belongs to the token.
  const meta = metaMap
    ? (metaMap[normKey(feeRow.name)] || metaMap[normKey(llamaSlug)] || metaMap[normKey(reg?.name)])
    : null
  const chainToken = category === 'Chain' && chainMap ? chainMap[normKey(feeRow.name)] : null

  // A zero market cap means the upstream has no cap for this entity, not that
  // the token is worthless — rendering "$0.00" would be a fabricated fact.
  const mcap = pos(meta?.mcap) ?? pos(tvlRow?.mcap)
  const okMult = (v) => (v != null && Number.isFinite(v) && v > 0 && v <= MAX_MULTIPLE ? v : null)
  const multOk = !NO_MULTIPLE.has(category)
  const pf = multOk && mcap && fees.ann ? okMult(mcap / fees.ann) : null
  const ps = multOk && mcap && revenue.ann ? okMult(mcap / revenue.ann) : null

  return {
    slug,
    name: reg?.name || feeRow.displayName || feeRow.name,
    category,
    chains: (reg?.chains || feeRow.chains || tvlRow?.chains || []).slice(0, 8),
    logo: feeRow.logo || meta?.logo || tvlRow?.logo || null,
    website: meta?.url || tvlRow?.url || null,
    twitter: meta?.twitter || tvlRow?.twitter || null,
    tokenSymbol: meta?.symbol || chainToken?.symbol || tvlRow?.symbol || null,
    // The parent's own token identity, kept so a caller can price the entity we
    // rank rather than one of its products. A chain's token comes from the chain
    // list instead — the protocol lists carry none for a chain row.
    geckoId: meta?.geckoId || chainToken?.geckoId || null,
    tokenAddress: meta?.address || null,
    github: meta?.github || null,
    llamaSlug: String(llamaSlug),
    curated: reg ? reg.curated : false,

    fees, revenue, supplySide, dexVolume,
    perpVolume: hl ? { d1: hl.perpVolume, d7: null, d30: null, y1: null, allTime: null, ann: null, chg7d: null, chg30d: null } : { ...EMPTY_METRIC },
    tvl: TVL_LESS.has(category) ? null : (tvlRow ? { now: tvlRow.tvl, chg1d: tvlRow.chg1d, chg7d: tvlRow.chg7d } : null),

    users: hl ? {
      dau: hl.dau, trades: hl.trades, arpu: hl.arpu,
      avgTrade: hl.avgTrade, userPnl: hl.userPnl, day: hl.day,
      scope: FIRST_HAND_COVERAGE,
    } : null,

    takeRate, mcap, pf, ps, fdv: null,
    doubleCounted: !!feeRow.doublecounted,
    parent: feeRow.parentProtocol || null,
    children: Array.isArray(feeRow._children)
      ? [...feeRow._children].sort((a, b) => (b.total30d || 0) - (a.total30d || 0))
      : [],
    methodology: normalizeMethodology(feeRow.methodology),
    methodologyUrl: feeRow.methodologyURL || null,

    provenance: {
      fees: PROV.SHADOW, revenue: PROV.SHADOW, supplySide: PROV.SHADOW,
      dexVolume: PROV.SHADOW, tvl: PROV.SHADOW, mcap: PROV.SHADOW,
      perpVolume: hl ? PROV.FIRST_HAND : null,
      users: hl ? PROV.FIRST_HAND : null,
      takeRate: PROV.DERIVED, pf: PROV.DERIVED, ps: PROV.DERIVED,
    },
  }
}

/**
 * A multiple this large is not a valuation, it is a rounding artefact on a
 * platform that earned almost nothing — printing "42,000x" invites a reader to
 * treat noise as a signal.
 */
const MAX_MULTIPLE = 5_000

/**
 * Categories where market cap is NOT an equity valuation, so P/F and P/S would
 * be nonsense. USDT's "market cap" is the quantity of dollars Tether owes, not
 * what Tether the business is worth; dividing it by Tether's fee income
 * produces a confident-looking number that means nothing.
 */
const NO_MULTIPLE = new Set(['Stablecoin Issuer', 'Stablecoin Wrapper', 'Bridge'])

/** Recompute the valuation block from a live quote. */
function applyQuote(p, q) {
  const mcap = pos(q?.mcap) ?? p.mcap
  const fdv = pos(q?.fdv) ?? null
  if (mcap === p.mcap && fdv == null) return p

  const ok = (v) => (v != null && Number.isFinite(v) && v > 0 && v <= MAX_MULTIPLE ? v : null)
  const allowed = !NO_MULTIPLE.has(p.category)
  return {
    ...p,
    mcap, fdv,
    tokenSymbol: p.tokenSymbol || q?.symbol || null,
    pf: allowed && mcap && p.fees.ann ? ok(mcap / p.fees.ann) : null,
    ps: allowed && mcap && p.revenue.ann ? ok(mcap / p.revenue.ann) : null,
    provenance: { ...p.provenance, mcap: q?.mcap != null ? PROV.SHADOW : p.provenance.mcap },
  }
}

/** A platform we hold first-hand that has no shadow row at all. */
function firstHandOnlyPlatform(hl) {
  const reg = BY_SLUG.get(hl.slug)
  return {
    slug: hl.slug,
    name: reg?.name || hl.slug,
    category: cleanCategory(reg?.category),
    chains: ['Hyperliquid'],
    logo: reg?.llama ? `https://icons.llama.fi/${reg.llama}.jpg` : `https://icons.llama.fi/${hl.slug}.jpg`,
    website: null, twitter: null, tokenSymbol: null,
    llamaSlug: reg?.llama || null,
    curated: !!reg?.curated,
    fees: { ...EMPTY_METRIC, d1: hl.revenue },
    revenue: { ...EMPTY_METRIC, d1: hl.revenue },
    supplySide: { ...EMPTY_METRIC },
    dexVolume: { ...EMPTY_METRIC },
    perpVolume: { ...EMPTY_METRIC, d1: hl.perpVolume },
    tvl: null,
    users: { dau: hl.dau, trades: hl.trades, arpu: hl.arpu, avgTrade: hl.avgTrade, userPnl: hl.userPnl, day: hl.day, scope: FIRST_HAND_COVERAGE },
    takeRate: null, mcap: null, pf: null, ps: null,
    doubleCounted: false, parent: null,
    methodology: [{ label: null, text: 'Builder-code fills read directly from the Hyperliquid public archive.' }],
    methodologyUrl: null,
    provenance: { fees: PROV.FIRST_HAND, revenue: PROV.FIRST_HAND, perpVolume: PROV.FIRST_HAND, users: PROV.FIRST_HAND },
  }
}

/**
 * The whole universe, in our schema.
 * `tier` splits the two big upstreams so the page can paint before the 8.5MB
 * TVL pull lands: 'core' = fees/revenue/first-hand, 'extra' = volumes + TVL.
 */
function getUniverse({ tier = 'full' } = {}) {
  const uKey = `vt:universe:${tier}`
  return cached(uKey, 10 * 60_000, async () => {
    const wantExtra = tier === 'full' || tier === 'extra'

    // Core carries only what the page paints with. Supply-side revenue is a
    // 2.6MB upstream that no visible surface reads yet, so it rides with the
    // heavy tier rather than sitting on first paint.
    const [feeRows, revRows, hlDayKey] = await Promise.all([
      shadowFees(), shadowRevenue(),
      latestHlDay().catch(() => null),
    ])

    // Non-blocking: served from cache when warm, kicked off otherwise.
    const hlLatest = hlDayKey
      ? cachedOrKick(`vt:hl:${hlDayKey}:${HL_BUNDLE_LIMIT}`, () => hlDay(hlDayKey))
      : null
    const [dexRows, tvlMap, ssRows, metaMap, chainMap] = wantExtra
      ? await Promise.all([
        shadowDexs().catch(() => []),
        shadowTvl().catch(() => null),
        shadowSupplySide().catch(() => []),
        shadowMeta().catch(() => null),
        shadowChains().catch(() => null),
      ])
      : [[], null, [], null, null]

    const ctx = {
      revIdx: indexRows(revRows), ssIdx: indexRows(ssRows), dexIdx: indexRows(dexRows),
      tvlMap, metaMap, chainMap,
      hlBySlug: hlLatest ? new Map(hlLatest.rows.map((r) => [r.slug, r])) : null,
    }

    let platforms = feeRows
      .filter((r) => r.total30d != null || r.total24h != null)
      .map((r) => buildPlatform(r, ctx))

    // Valuation runs as a SECOND pass: the ids only exist once every platform is
    // built, and one batched CoinGecko call for the whole universe is cheaper
    // than a lookup per platform by three orders of magnitude.
    if (wantExtra) {
      const quotes = await cgMarkets(platforms.map((p) => p.geckoId)).catch(() => ({}))
      if (quotes && Object.keys(quotes).length) platforms = platforms.map((p) => applyQuote(p, quotes[p.geckoId]))
    }

    // Fold in first-hand platforms with no shadow row, so a Hyperliquid-native
    // app is never invisible just because DefiLlama has not indexed it.
    const have = new Set(platforms.map((p) => p.slug))
    if (hlLatest) {
      for (const hl of hlLatest.rows) if (!have.has(hl.slug)) platforms.push(firstHandOnlyPlatform(hl))
    }

    // A universe built while the first-hand sweep was still running is missing
    // its own-data band. Hold it for a minute, not ten, so the band appears as
    // soon as the sweep lands instead of after the next full TTL.
    if (!hlLatest) {
      setTimeout(() => {
        const hit = CACHE.get(uKey)
        if (hit) CACHE.set(uKey, { ...hit, expires: Date.now() + 60_000 })
      }, 0)
    }

    return { platforms, hlLatest, generatedAt: new Date().toISOString(), tier }
  })
}

// ---------------------------------------------------------------------------
// leaderboards
// ---------------------------------------------------------------------------

/**
 * Ranking rules that keep a board signal rather than noise:
 *  - level and momentum are different boards, never blended
 *  - growth needs a real prior base, or a $12 → $600 week ranks first
 *  - perp volume is never summed with spot volume
 *  - a rate with a tiny denominator is suppressed, not rounded
 */
/** A growth board only means something above a real prior base. */
const GROWTH_FLOOR_USD = 100_000

/** Reconstruct the previous window's level from the current level + its change. */
function priorWindow(current, chgPct) {
  const c = num(current)
  if (c == null || chgPct == null || chgPct <= -100) return 0
  return c / (1 + chgPct / 100)
}

const BOARDS = {
  fees:     { label: 'Fees',        get: (p, w) => p.fees[w],       kind: 'usd' },
  revenue:  { label: 'Revenue',     get: (p, w) => p.revenue[w],    kind: 'usd' },
  dexVolume:{ label: 'Spot volume', get: (p, w) => p.dexVolume[w],  kind: 'usd' },
  perpVolume:{ label: 'Perp volume',get: (p) => p.perpVolume.d1,    kind: 'usd', firstHandOnly: true },
  users:    { label: 'Users',       get: (p) => p.users?.dau ?? null, kind: 'count', firstHandOnly: true },
  tvl:      { label: 'TVL',         get: (p) => p.tvl?.now ?? null, kind: 'usd' },
  // Growth is gated on the PRIOR period, not the current one. Gating on the
  // current month lets a protocol that earned $2 last month and $11k this month
  // top the board at +550,000% — which is what the first run of this board did.
  growth:   { label: 'Fee growth',  get: (p) => p.fees.chg30d,      kind: 'pct',
              minBase: (p) => (p.fees.d30 ?? 0) >= GROWTH_FLOOR_USD && priorWindow(p.fees.d30, p.fees.chg30d) >= GROWTH_FLOOR_USD },
  // A take rate above 100% means revenue and fees came from adapters that
  // disagree, not that the protocol keeps more than it charges. Drop the row
  // rather than print an impossible number.
  takeRate: { label: 'Take rate',   get: (p) => p.takeRate,         kind: 'pct',
              minBase: (p) => (p.fees.d30 ?? 0) >= 100_000 && p.takeRate != null && p.takeRate >= 0 && p.takeRate <= 100 },
  // Cheapest-first only reads as a valuation signal above a real fee base and a
  // real market cap; without floors the board fills with dust at 0.0x.
  pf:       { label: 'P/F',         get: (p) => p.pf,               kind: 'ratio', asc: true,
              minBase: (p) => (p.fees.ann ?? 0) >= 1_000_000 && (p.mcap ?? 0) >= 10_000_000 && (p.pf ?? 0) > 0 },
  userPnl:  { label: 'User PnL',    get: (p) => p.users?.userPnl ?? null, kind: 'usd', firstHandOnly: true },
  arpu:     { label: 'Revenue / user', get: (p) => p.users?.arpu ?? null, kind: 'usd', minBase: (p) => (p.users?.dau ?? 0) >= 20, firstHandOnly: true },
}

function rankBoard(platforms, { metric: metricKey = 'fees', window: win = 'd30', category = null, limit = 50 } = {}) {
  const board = BOARDS[metricKey] || BOARDS.fees
  const w = ['d1', 'd7', 'd30', 'y1', 'ann'].includes(win) ? win : 'd30'

  const rows = platforms
    // An aggregator that routes through another platform reports the same fee
    // twice. The hero total and the peer cohorts already exclude these; a board
    // that did not was ranking one dollar of user money as two.
    .filter((p) => !p.doubleCounted)
    .filter((p) => (category ? p.category === category : true))
    .filter((p) => (board.firstHandOnly ? !!p.users || p.provenance.perpVolume === PROV.FIRST_HAND : true))
    .filter((p) => (board.minBase ? board.minBase(p) : true))
    .map((p) => ({ platform: p, value: board.get(p, w) }))
    .filter((r) => r.value != null && Number.isFinite(r.value))

  // Tie-break on 30d fees so a board of exact ties (take rate is full of 100%
  // protocols that keep everything) still ranks the ones that matter first.
  rows.sort((a, b) => (board.asc ? a.value - b.value : b.value - a.value)
    || (b.platform.fees.d30 || 0) - (a.platform.fees.d30 || 0))

  const shown = rows.slice(0, limit)
  // A first-hand board sparks its OWN metric, not fees. Warm what it is about to
  // show so the next visit has the line even where DefiLlama has no such slug.
  const fhField = board.firstHandOnly ? FIRST_HAND_SPARK_FIELD[metricKey] : null
  if (fhField) warmFirstHandSparks(shown.map((r) => r.platform.slug))

  return {
    metric: metricKey, label: board.label, kind: board.kind, window: w,
    category, total: rows.length,
    rows: shown.map((r, i) => ({ rank: i + 1, value: r.value, ...compactRow(r.platform, fhField) })),
  }
}

/** The row shape the leaderboards send over the wire — deliberately small. */
function compactRow(p, firstHandField) {
  return {
    slug: p.slug, name: p.name, category: p.category, logo: p.logo, chains: p.chains,
    curated: p.curated, doubleCounted: p.doubleCounted,
    fees30d: p.fees.d30, fees24h: p.fees.d1, feesAnn: p.fees.ann, feeChg30d: p.fees.chg30d, feeChg7d: p.fees.chg7d,
    revenue30d: p.revenue.d30, revenueAnn: p.revenue.ann,
    dexVolume30d: p.dexVolume.d30, perpVolume24h: p.perpVolume.d1,
    tvl: p.tvl?.now ?? null, mcap: p.mcap, fdv: p.fdv ?? null, pf: p.pf, ps: p.ps, takeRate: p.takeRate,
    dau: p.users?.dau ?? null, arpu: p.users?.arpu ?? null, userPnl: p.users?.userPnl ?? null,
    trades: p.users?.trades ?? null,
    scope: p.users?.scope ?? null,
    // A first-hand board prefers its own series; anything else (and any row whose
    // dailies are still cold) falls back to the shadowed fee trend.
    spark: (firstHandField && firstHandSparkCached(p.slug, firstHandField)) || sparkCached(p.llamaSlug),
    provenance: p.users ? PROV.FIRST_HAND : PROV.SHADOW,
  }
}

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

const HERO_STACK = 8
const HERO_WINDOW_DAYS = 730

/**
 * The index payload: the tide, the ladders, the categories and the first-hand
 * board. `tier=core` skips the two heaviest upstreams.
 */
async function getBundle({ tier = 'core', boards = null } = {}) {
  const { platforms, hlLatest, generatedAt } = await getUniverse({ tier: tier === 'core' ? 'core' : 'full' })

  const byFees = [...platforms].filter((p) => p.fees.d30 != null && !p.doubleCounted)
    .sort((a, b) => (b.fees.d30 || 0) - (a.fees.d30 || 0))

  // Categories: level + momentum, both from the same 30d window.
  const catMap = new Map()
  for (const p of byFees) {
    const c = catMap.get(p.category) || { key: p.category, fees30d: 0, revenue30d: 0, count: 0, prev30d: 0 }
    c.fees30d += p.fees.d30 || 0
    c.revenue30d += p.revenue.d30 || 0
    if (p.fees.chg30d != null && p.fees.d30) c.prev30d += p.fees.d30 / (1 + p.fees.chg30d / 100)
    c.count++
    catMap.set(p.category, c)
  }
  const categories = [...catMap.values()]
    .map((c) => ({ ...c, chg30d: pct(c.fees30d, c.prev30d, { minBase: 1000 }) }))
    .sort((a, b) => b.fees30d - a.fees30d)

  // The hero: the aggregate daily-fee tide, with the top earners' own series
  // stacked inside it so you can see WHOSE money it is.
  const stackSlugs = byFees.slice(0, HERO_STACK).map((p) => ({ slug: p.slug, name: p.name, llamaSlug: p.llamaSlug }))
  const [tideFull, stacksFull] = await Promise.all([
    shadowTide().catch(() => []),
    pooled(stackSlugs, async (s) => {
      const j = await shadowSummary('fees', s.llamaSlug)
      const chart = Array.isArray(j?.totalDataChart) ? j.totalDataChart : []
      return { slug: s.slug, name: s.name, points: chart }
    }, { concurrency: 6, budgetMs: 18_000 }),
  ])
  // The hero reads the last two years; the full series back to 2017 is ~3k
  // points per line and would triple the payload for pixels nobody can see.
  const cutoff = Math.floor(Date.now() / 1000) - HERO_WINDOW_DAYS * 86_400
  const trim = (pts) => dropPartialDay(pts).filter((p) => p[0] >= cutoff)
  const tide = trim(tideFull)
  const stacks = stacksFull.map((s) => ({ ...s, points: trim(s.points) }))
    .sort((a, b) => b.points.reduce((x, p) => x + (p[1] || 0), 0) - a.points.reduce((x, p) => x + (p[1] || 0), 0))

  // TVL and P/F both need the `extra` upstream, so asking for them in the core
  // tier would ship an empty board rather than a loading one.
  const hasExtra = tier !== 'core'
  const requested = boards
    || ['fees', 'revenue', 'users', 'growth', 'takeRate', 'perpVolume', 'userPnl',
      ...(hasExtra ? ['tvl', 'pf'] : [])]
  const ladders = {}
  for (const b of requested) if (BOARDS[b]) ladders[b] = rankBoard(platforms, { metric: b, limit: 25 })

  // Warm the trends the boards just asked for, off the critical path.
  warmSparks(byFees.slice(0, 40).map((p) => p.llamaSlug))

  const totals = {
    fees24h: byFees.reduce((a, p) => a + (p.fees.d1 || 0), 0),
    fees30d: byFees.reduce((a, p) => a + (p.fees.d30 || 0), 0),
    revenue30d: byFees.reduce((a, p) => a + (p.revenue.d30 || 0), 0),
    tracked: platforms.length,
    firstHand: platforms.filter((p) => p.users).length,
    firstHandDay: hlLatest?.day || null,
    firstHandPerpVolume: hlLatest?.totals.perpVolume ?? null,
    firstHandRevenue: hlLatest?.totals.revenue ?? null,
    firstHandDau: hlLatest?.totals.dau ?? null,
    firstHandUserPnl: hlLatest?.totals.userPnl ?? null,
  }

  return {
    schema: SCHEMA_VERSION, generatedAt, tier,
    firstHandScope: FIRST_HAND_COVERAGE,
    totals, categories,
    hero: { tide, stacks },
    ladders,
    // Fill-archive rows carry only a slug, which is how the floor chart ended up
    // plotting 28 unlabelled dots (founder: "ugly design add logos and names so
    // we can see"). The display name lives in our own registry and the logo on
    // the universe row, so join both HERE rather than making every consumer
    // re-derive them.
    firstHand: hlLatest
      ? {
        day: hlLatest.day,
        scope: FIRST_HAND_COVERAGE,
        coverage: hlLatest.coverage,
        rows: hlLatest.rows.slice(0, 40).map((r) => {
          const reg = BY_SLUG.get(r.slug)
          const uni = platforms.find((p) => p.slug === r.slug)
          return {
            ...r,
            name: reg?.name || uni?.name || titleCase(r.slug),
            logo: uni?.logo
              || (reg?.llama ? `https://icons.llama.fi/${reg.llama}.jpg` : null)
              || `https://icons.llama.fi/${r.slug}.jpg`,
            category: uni?.category || reg?.category || null,
          }
        }),
      }
      : null,
    // 🚫 NO VENDOR IS NAMED IN PRODUCT COPY (founder, 2026-08-14: "dont say
    // defilama ever i asked you to make our own data"). The shadow lane is
    // described by WHAT IT IS and by the fact that it is being replaced — we do
    // not credit a free aggregator on the surface we sell, and we equally do not
    // claim its numbers as first-hand. The honest fix is to retire the lane, not
    // to relabel it: per-app Solana revenue already sits in our own collectors.
    sources: [
      { lane: PROV.FIRST_HAND, name: 'Spectre fill archive', detail: 'Raw Hyperliquid builder fills we read and aggregate ourselves: volume, revenue, active traders, trades and trader PnL. Hyperliquid-routed ONLY — a Solana-first app shows a slice here, never its total. Solana and EVM collectors are the next build.' },
      { lane: PROV.SHADOW, name: 'Public aggregate breadth (being retired)', detail: 'Fees, revenue, spot volume and TVL for the long tail, normalised into the Spectre Vitals schema. Not ours, not first-hand, and marked on every figure it touches — each metric moves to a Spectre collector as that collector ships.' },
      { lane: PROV.SHADOW, name: 'Token valuation', detail: 'Market cap and fully diluted valuation are priced from the token each platform actually issues, matched by coin id only — never by ticker, because a Base token called DOT would otherwise inherit Polkadot\'s valuation. Platforms with no token show no cap and no multiple rather than a guess, and market cap is deliberately not divided into fees for stablecoin issuers, where the "cap" is money owed rather than what the business is worth.' },
      { lane: PROV.SHADOW, name: 'growthepie (CC-BY-4.0)', detail: 'Active addresses and transaction counts on Ethereum and its layer twos, shown only where two independent signals agree that we have matched the right project — a single fuzzy match put an unrelated project on BSC in testing, so single-signal matches are refused outright. Never blended with our own trader counts, and never used on the first-hand boards. Source: growthepie, https://www.growthepie.com' },
    ],
  }
}

/**
 * COVERAGE — what fraction of a platform's business our first-hand lane sees.
 *
 * 🪤🪤 THE BUG THIS EXISTS TO KILL (founder, 2026-08-14: "fomo has 600k users,
 * you show 1k and 9m rev, that's BS"). The card paired `users` read from the
 * Hyperliquid builder-fill archive with `revenue` read from the shadow lane
 * across ALL chains. Both numbers were individually correct and the pairing was
 * nonsense:
 *
 *   Axiom  189 traders beside $16.66m/30d revenue — 0.0% of which is on Hyperliquid
 *   fomo 1,098 traders beside  $9.14m/30d revenue — 1.3% of which is on Hyperliquid
 *
 * Measured across the registry, platforms earning under a quarter of their
 * revenue on Hyperliquid are 90% of the money on the page, so the page read as
 * fabricated to anyone who knew one of those platforms. A user count and a
 * revenue figure of DIFFERENT SCOPE must never sit side by side unlabelled.
 *
 * So scope becomes data, not a footnote: every platform carries the share of
 * its revenue we actually measure, and the UI is expected to gate on it.
 */
const HL_CHAIN_RX = /hyperliquid/i;

function computeCoverage(chainBreakdownObj, chains) {
  const cb = chainBreakdownObj && typeof chainBreakdownObj === 'object' ? chainBreakdownObj : null;
  if (!cb) return null;
  let measured = 0; let total = 0;
  const byChain = [];
  for (const [chain, v] of Object.entries(cb)) {
    // 7d, not 24h: a single day is noisy and a partial day would read as a
    // chain switching off entirely
    const t7 = Number(v?.total7d) || 0;
    total += t7;
    if (HL_CHAIN_RX.test(chain)) measured += t7;
    byChain.push({ chain, revenue7d: t7 });
  }
  if (total <= 0) return null;
  const share = measured / total;
  return {
    // the chains we hold raw fills for
    measuredChains: ['Hyperliquid'],
    // every chain the platform actually earns on
    allChains: byChain.sort((a, b) => b.revenue7d - a.revenue7d).map((x) => x.chain),
    byChain: byChain.slice(0, 8),
    revenueShareMeasured: +share.toFixed(4),
    // the UI contract: at or above this, first-hand user metrics describe the
    // platform; below it they describe one venue and must say so
    representative: share >= 0.8,
    unmeasuredChains: byChain.filter((x) => !HL_CHAIN_RX.test(x.chain) && x.revenue7d > 0).map((x) => x.chain),
  };
}

/** Pair each folded child with the methodology string the summary carries. */
function mergeChildren(folded, fromSummary) {
  const meth = new Map()
  for (const c of Array.isArray(fromSummary) ? fromSummary : []) {
    meth.set(normKey(c.displayName || c.name), normalizeMethodology(c.methodology))
  }
  const rows = (folded || []).map((c) => ({
    name: c.name, slug: c.slug, fees30d: c.total30d, methodology: meth.get(normKey(c.name)) || [],
  }))
  if (rows.length) return rows
  return [...meth.entries()].length
    ? (fromSummary || []).map((c) => ({ name: c.displayName || c.name, slug: c.name, fees30d: null, methodology: normalizeMethodology(c.methodology) }))
    : []
}

/** One platform, everything we hold. */
async function getPlatform(slug, { history = 30 } = {}) {
  const key = String(slug || '').toLowerCase()
  const { platforms, generatedAt } = await getUniverse({ tier: 'full' })

  let platform = platforms.find((p) => p.slug === key)
  if (!platform) platform = platforms.find((p) => normKey(p.name) === normKey(key) || normKey(p.llamaSlug) === normKey(key))
  if (!platform) return null

  const reg = BY_SLUG.get(platform.slug)

  const [feeSeries, revSeries, dexSeries, firstHand, thirdParty] = await Promise.all([
    platform.llamaSlug ? shadowSummary('fees', platform.llamaSlug).catch(() => null) : null,
    platform.llamaSlug ? shadowSummary('fees', platform.llamaSlug, 'dailyRevenue').catch(() => null) : null,
    platform.llamaSlug ? shadowSummary('dexs', platform.llamaSlug, 'dailyVolume').catch(() => null) : null,
    reg ? hlHistory(platform.slug, { days: history }).catch(() => null) : null,
    // CACHE-ONLY. This used to await the growthepie lane for up to nine
    // seconds, which put the whole platform page — every number, every chart —
    // behind a rate-limited third-party upstream. Measured 6.2s and 6.5s on a
    // warm local server, and Ethena paid the full wait to receive nothing.
    // The page paints from our own data now and the card fetches itself.
    thirdPartyUsersCached(platform),
  ])

  const series = {
    fees: dropIncompleteTail(feeSeries?.totalDataChart),
    revenue: dropIncompleteTail(revSeries?.totalDataChart),
    dexVolume: dropIncompleteTail(dexSeries?.totalDataChart),
    // Daily revenue split by chain AND by child product, straight off the
    // shadow summary — the split that shows a reader WHY our first-hand user
    // count covers what it covers, instead of asking them to trust a footnote.
    revenueByChain: chainSeries(revSeries?.totalDataChartBreakdown),
    feesByChain: chainSeries(feeSeries?.totalDataChartBreakdown),
  }

  /**
   * How much of this platform our first-hand collector actually sees.
   *
   * The chain breakdown gives the exact answer instead of a hand-wave: sum the
   * last 30 days of revenue on the venues we read against the total. For fomo
   * that is ~1.6%, so the page can say "covers 1.6% of revenue" and a reader can
   * size the gap themselves rather than trusting the word "partial".
   */
  const firstHandCoverage = (() => {
    const rb = series.revenueByChain
    if (!rb || !rb.rows || !rb.rows.length) return null
    const win = rb.rows.slice(-30)
    let seen = 0
    let total = 0
    for (const r of win) {
      for (const [chain, v] of Object.entries(r.chains || {})) {
        total += v || 0
        if (FIRST_HAND_COVERAGE.venues.some((venue) => String(chain).toLowerCase().startsWith(venue.toLowerCase()))) {
          seen += v || 0
        }
      }
    }
    if (total <= 0) return null
    return { ...FIRST_HAND_COVERAGE, revenueSharePct: (seen / total) * 100, windowDays: win.length }
  })()

  // Per-chain split, straight off the shadow breakdown when present.
  const chainBreakdown = feeSeries?.chainBreakdown && typeof feeSeries.chainBreakdown === 'object'
    ? Object.keys(feeSeries.chainBreakdown)
    : platform.chains

  // Peers: same category, ranked by the same metric, so the number has a scale.
  const peers = platforms
    .filter((p) => p.category === platform.category && p.fees.d30 != null && !p.doubleCounted)
    .sort((a, b) => (b.fees.d30 || 0) - (a.fees.d30 || 0))
  const peerRank = peers.findIndex((p) => p.slug === platform.slug)

  return {
    schema: SCHEMA_VERSION, generatedAt,
    platform: {
      ...platform,
      description: feeSeries?.description || null,
      // The fold gives us the children with their 30d numbers; the summary adds
      // each child's own methodology string. Merge on name so the panel can
      // print "fomo Wallet — trading fees paid by users, $X over 30d".
      childProtocols: mergeChildren(platform.children, feeSeries?.childProtocols),
      chainBreakdown,
      coverage: computeCoverage(revSeries?.chainBreakdown || feeSeries?.chainBreakdown, platform.chains),
      builders: reg ? reg.builders : [],
    },
    series,
    firstHandCoverage,
    reported: REPORTED[platform.slug] || null,
    firstHand,
    // Third-party, and labelled as such everywhere it renders: this counts
    // addresses on Ethereum and its L2s, which is a different thing from the
    // fills we read ourselves and must never be blended with them.
    thirdParty,
    peers: { rank: peerRank >= 0 ? peerRank + 1 : null, of: peers.length, rows: peers.slice(0, 8).map(compactRow) },
  }
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

const COMPARE_MAX = 4

/**
 * The rows of the comparison table.
 *
 * `asc` marks a metric where SMALL wins (a cheap multiple beats an expensive
 * one), so "best" is not always "biggest" — getting that backwards is how a
 * comparison table quietly recommends the worst option.
 *
 * `firstHand` rows come from fills we read ourselves, so they only populate for
 * the venues we cover; they stay in the table with an empty cell rather than
 * being dropped, because "we don't know" is a real answer a reader needs.
 */
const COMPARE_ROWS = [
  { key: 'fees30d', label: 'Fees', hint: '30 days', kind: 'usd', get: (p) => p.fees.d30 },
  { key: 'revenue30d', label: 'Revenue', hint: 'kept by the protocol, 30d', kind: 'usd', get: (p) => p.revenue.d30 },
  { key: 'feesAnn', label: 'Fees annualised', hint: 'trailing year', kind: 'usd', get: (p) => p.fees.ann },
  { key: 'takeRate', label: 'Take rate', hint: 'revenue ÷ fees', kind: 'pct', get: (p) => p.takeRate },
  { key: 'feeChg30d', label: 'Fee growth', hint: 'vs the previous 30 days', kind: 'chg', get: (p) => p.fees.chg30d },
  { key: 'feeChg7d', label: 'Fee growth', hint: 'vs the previous 7 days', kind: 'chg', get: (p) => p.fees.chg7d },
  { key: 'dexVolume30d', label: 'Spot volume', hint: '30 days', kind: 'usd', get: (p) => p.dexVolume.d30 },
  { key: 'perpVolume24h', label: 'Perp volume', hint: '24 hours', kind: 'usd', get: (p) => p.perpVolume.d1 },
  { key: 'tvl', label: 'Value locked', hint: 'now', kind: 'usd', get: (p) => p.tvl?.now ?? null },
  { key: 'mcap', label: 'Market cap', hint: 'now', kind: 'usd', get: (p) => p.mcap },
  { key: 'fdv', label: 'Fully diluted', hint: 'all supply issued', kind: 'usd', get: (p) => p.fdv ?? null },
  { key: 'pf', label: 'Price to fees', hint: 'lower is cheaper', kind: 'mult', asc: true, get: (p) => p.pf },
  { key: 'ps', label: 'Price to revenue', hint: 'lower is cheaper', kind: 'mult', asc: true, get: (p) => p.ps },
  { key: 'dau', label: 'Traders per day', hint: 'counted by us', kind: 'count', firstHand: true, get: (p) => p.users?.dau ?? null },
  { key: 'arpu', label: 'Revenue per trader', hint: 'counted by us', kind: 'usd', firstHand: true, get: (p) => p.users?.arpu ?? null },
]

/**
 * Align daily series from several platforms onto one day axis.
 *
 * Platforms start reporting on different days, so a naive zip would compare
 * fomo's day 1 against Uniswap's day 1900. Keying by timestamp and intersecting
 * to the window both actually cover is the only join that means anything.
 */
function alignSeries(perSlug, days) {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400
  const axis = new Set()
  for (const points of Object.values(perSlug)) {
    for (const [t] of points || []) if (t >= cutoff) axis.add(t)
  }
  const ts = [...axis].sort((a, b) => a - b)
  if (ts.length < 2) return null

  const bySlug = {}
  for (const [slug, points] of Object.entries(perSlug)) {
    const map = new Map((points || []).map(([t, v]) => [t, v]))
    bySlug[slug] = ts.map((t) => (map.has(t) ? map.get(t) : null))
  }
  return { t: ts, values: bySlug }
}

/**
 * Rebase every series to 100 at its own first reading in the window.
 *
 * This is the whole point of the overlay: $482m of Tether fees and $2m of a
 * challenger's plot on the same axis as SHAPE, so the reader compares
 * trajectories instead of squinting at a flat line under a giant one.
 */
function indexSeries(aligned) {
  if (!aligned) return null
  const out = {}
  for (const [slug, vals] of Object.entries(aligned.values)) {
    const base = vals.find((v) => Number.isFinite(v) && v > 0)
    out[slug] = base ? vals.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null)) : vals.map(() => null)
  }
  return { t: aligned.t, values: out }
}

async function getCompare(slugs, { history = 180 } = {}) {
  const wanted = [...new Set((Array.isArray(slugs) ? slugs : String(slugs || '').split(','))
    .map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))].slice(0, COMPARE_MAX)
  if (wanted.length < 2) return { schema: SCHEMA_VERSION, error: 'compare needs at least two platforms', rows: [], columns: [] }

  const { platforms, generatedAt } = await getUniverse({ tier: 'full' })
  const byKey = new Map()
  for (const p of platforms) { byKey.set(p.slug, p); byKey.set(normKey(p.name), p); if (p.llamaSlug) byKey.set(normKey(p.llamaSlug), p) }

  const picked = []
  const missing = []
  for (const w of wanted) {
    const p = byKey.get(w) || byKey.get(normKey(w))
    if (p && !picked.some((x) => x.slug === p.slug)) picked.push(p)
    else if (!p) missing.push(w)
  }
  if (picked.length < 2) {
    return { schema: SCHEMA_VERSION, generatedAt, error: 'could not resolve two platforms', missing, rows: [], columns: [] }
  }

  const summaries = await Promise.all(picked.map(async (p) => {
    if (!p.llamaSlug) return { fees: null, revenue: null, dex: null }
    const [fees, revenue, dex] = await Promise.all([
      shadowSummary('fees', p.llamaSlug).catch(() => null),
      shadowSummary('fees', p.llamaSlug, 'dailyRevenue').catch(() => null),
      shadowSummary('dexs', p.llamaSlug, 'dailyVolume').catch(() => null),
    ])
    return { fees, revenue, dex }
  }))

  const seriesFor = (pick) => {
    const per = {}
    picked.forEach((p, i) => { per[p.slug] = dropIncompleteTail(summaries[i][pick]?.totalDataChart) || [] })
    const aligned = alignSeries(per, history)
    return aligned ? { absolute: aligned, indexed: indexSeries(aligned) } : null
  }

  // Third-party active addresses, warm-only (see thirdPartyUsersCached).
  const tpBySlug = {}
  await Promise.all(picked.map(async (p) => {
    const tp = await thirdPartyUsersCached(p).catch(() => null)
    if (tp?.activeAddresses?.avg30d != null) tpBySlug[p.slug] = tp
  }))
  const tpRow = Object.keys(tpBySlug).length
    ? (() => {
      const values = {}
      for (const p of picked) values[p.slug] = tpBySlug[p.slug]?.activeAddresses?.avg30d ?? null
      const finite = Object.entries(values).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1])
      return {
        key: 'activeAddresses',
        label: 'Active addresses',
        hint: 'daily avg 30d · Ethereum + L2s, third party',
        kind: 'count',
        asc: false,
        thirdParty: true,
        source: GP_SOURCE,
        values,
        best: finite.length > 1 && finite[0][1] !== finite[1][1] ? finite[0][0] : null,
        reported: finite.length,
      }
    })()
    : null

  const rows = COMPARE_ROWS.map((r) => {
    const values = {}
    for (const p of picked) values[p.slug] = r.get(p) ?? null
    const finite = Object.entries(values).filter(([, v]) => Number.isFinite(v))
    // A "best" only means something when more than one platform reported.
    let best = null
    if (finite.length > 1) {
      finite.sort((a, b) => (r.asc ? a[1] - b[1] : b[1] - a[1]))
      if (finite[0][1] !== finite[1][1]) best = finite[0][0]
    }
    return { key: r.key, label: r.label, hint: r.hint, kind: r.kind, asc: !!r.asc, firstHand: !!r.firstHand, values, best, reported: finite.length }
  }).filter((r) => r.reported > 0)
  if (tpRow) rows.push(tpRow)

  return {
    schema: SCHEMA_VERSION, generatedAt,
    columns: picked.map(compactRow),
    rows,
    missing,
    series: { fees: seriesFor('fees'), revenue: seriesFor('revenue'), dexVolume: seriesFor('dex') },
    historyDays: history,
  }
}

/**
 * The third-party user block, fetched on its own so it can take as long as the
 * upstream needs without holding up a single figure on the page.
 */
async function getThirdParty(slug) {
  const key = String(slug || '').toLowerCase()
  const { platforms } = await getUniverse({ tier: 'full' })
  const platform = platforms.find((p) => p.slug === key)
    || platforms.find((p) => normKey(p.name) === normKey(key) || normKey(p.llamaSlug) === normKey(key))
  if (!platform) return null
  return thirdPartyUsers(platform)
}

async function getLeaderboard(opts = {}) {
  const { platforms, generatedAt } = await getUniverse({ tier: 'full' })
  return { schema: SCHEMA_VERSION, generatedAt, ...rankBoard(platforms, opts) }
}

async function searchPlatforms(q, { limit = 12 } = {}) {
  const needle = normKey(q)
  if (!needle) return { rows: [] }

  // A search box that errors is worse than one that comes back empty while the
  // universe is still building on a cold process.
  let platforms
  try {
    ({ platforms } = await getUniverse({ tier: 'core' }))
  } catch {
    return { rows: [], warming: true }
  }
  const scored = []
  for (const p of platforms) {
    const n = normKey(p.name); const s = normKey(p.slug)
    let score = null
    if (n === needle || s === needle) score = 0
    else if (n.startsWith(needle) || s.startsWith(needle)) score = 1
    else if (n.includes(needle) || s.includes(needle)) score = 2
    if (score != null) scored.push({ score, p })
  }
  scored.sort((a, b) => a.score - b.score || (b.p.fees.d30 || 0) - (a.p.fees.d30 || 0))
  return { rows: scored.slice(0, limit).map((r) => compactRow(r.p)) }
}

module.exports = {
  SCHEMA_VERSION, PROV, BOARDS, COMPARE_MAX,
  getBundle, getPlatform, getLeaderboard, searchPlatforms, getCompare, getThirdParty,
  hlDay, hlHistory, latestHlDay,
  // exported for tests
  _internals: { metric, pct, rankBoard, buildPlatform, fetchBuilderDay, platformDay, universe: getUniverse },
}
