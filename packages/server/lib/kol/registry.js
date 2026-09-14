/**
 * KOL Radar — the Giga KOL DB.
 *
 * Seeds/refreshes from the X Dash dashboard API:
 *   - /api/kols?sort=reach (paginate ~300 top authors)  -> KolRow base
 *   - /api/author/:id (enrich a subset)                 -> what they push
 *   - /api/bootstrap                                     -> token universe
 *
 * Normalizes upstream AuthorRow -> KolRow (the API-contract shape).
 * Keeps an in-memory cache + persists to the store.
 */
const store = require('./store')
const { getProjectHealth, classifyHealth, computeLegitimacy } = require('./health')

const X_DASH_BASE = (
  process.env.X_DASH_DIRECT_URL ||
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '')

// XDASH_API_TOKEN first - the upstream rotated its key (old values 401).
// Mirrors packages/server/index.js + apps/research social-proxy priority.
const X_DASH_API_KEY =
  process.env.XDASH_API_TOKEN ||
  process.env.X_DASH_API_KEY ||
  process.env.DASHBOARD_API_KEY ||
  ''

const SEED_PAGES = 14          // /api/kols pages to pull (50/page = up to 700 raw)
const KOLS_PER_PAGE = 50
const MIN_FOLLOWERS = 5000     // quality floor - no empty/bot accounts in the DB
const MAX_KOLS = 500           // keep up to this many real KOLs after the floor
const ENRICH_COUNT = 120       // how many to deep-enrich via /api/author/:id (cards + legit)
const ENRICH_CONCURRENCY = 8

// ── Curated KOL classification ──────────────────────────────────────────────
// Real classification beats raw follower buckets: a 30k-follower alpha caller
// can be Tier 1 while a 300k engagement-farm is Tier 3. Hard-tag the names the
// desk knows; fall back to a reach+signal heuristic for everyone else. Handles
// are lowercase, no @ (variants included where the spelling drifts).
const CURATED_S = new Set([
  // OGs / traders
  'cobie', 'gcrclassic', 'pentosh1', 'hsakatrades', 'inversebrah', 'cryptocred',
  'loomdart', 'altcoinpsycho', 'tetranode', 'degenspartan', 'cryptokaleo',
  'crediblecrypto', 'thecryptodog', 'cl207', 'trader_xo', 'bluntz_capital',
  'smartcontracter', 'theflowhorse', 'ledgerstatus', '0xsisyphus', 'romeoa',
  // memecoin / degen leads
  'blknoiz06', 'ansemtrades', 'theunipcs', 'notthreadguy', 'frankdegods',
  'gainzy222', 'mason_versluis', 'traderpow', 'saliencexbt', 'tradersz',
  'tradermayne', 'altcoingordon', 'mooncat2878', 'cryptonobler', 'cryptokaleo',
  // NFT / culture OGs
  'cozomomedici', 'punk6529', '0xfoobar', '0xmert_', 'iamdcinvestor',
  'pranksy', 'wassielawyer',
  // alpha callers Sunny named + recognized
  'zssbecker', 'incomesharks', 'cryptowizardd', 'cryptowizzardd',
  'cryptostasher', 'stasher', 'cryptotony__', 'defi_squared', 'vohvohh',
  'cryptomanran', '0xngmi',
])
const CURATED_T1 = new Set([
  'rektcapital', 'altcoinsherpa', 'cryptogodjohn', 'thecryptolark',
  'cryptomichnl', 'intocryptoverse', 'woonomic', 'donalt', 'cryptojack',
  'cryptorover', 'route2fi', 'macrocrg', 'alexonchain', '0xwenmoon',
  'jasonyanowitz', 'cryptobusy', 'koroushak', 'davidgokhshtein', 'scottmelker',
  'cryptohayes', 'lightcrypto', 'mononautical', 'defiignas', 'aixbt_agent',
  'smartestmoney_', 'cdprotyler', 'cryptokaleo',
])

// reach+signal classification -> 's' | 'tier1' | 'tier2' | 'tier3'
function classifyTier(screenName, followers, signalScore = 0) {
  const h = String(screenName || '').toLowerCase().replace(/^@/, '')
  if (CURATED_S.has(h)) return 's'
  if (CURATED_T1.has(h)) return 'tier1'
  // a strong signal score promotes a mid-reach caller (the alpha-not-reach case)
  const bump = signalScore >= 72 ? 1 : 0
  let t = followers >= 300000 ? 1 : followers >= 50000 ? 2 : 3
  t = Math.max(1, t - bump)
  return t === 1 ? 'tier1' : t === 2 ? 'tier2' : 'tier3'
}

async function dashFetch(path, timeoutMs = 15000) {
  const res = await fetch(`${X_DASH_BASE}${path}`, {
    headers: {
      // Bearer is what the rotated upstream expects; legacy names ride along.
      'Authorization': `Bearer ${X_DASH_API_KEY}`,
      'X-Internal-Key': X_DASH_API_KEY,
      'x-api-key': X_DASH_API_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`X Dash ${res.status} on ${path}`)
  return res.json()
}

// ---- token universe (for project cross-ref + logos + mention timing) ----
let _universe = null      // { byCgId, byHandle, bySymbol, list, generatedAt }
let _universeTs = 0
const UNIVERSE_TTL = 5 * 60 * 1000

function _projectFromToken(t) {
  if (!t) return null
  return {
    cg_id: t.cg_id || t.token_id || null,
    symbol: t.symbol || null,
    name: t.name || null,
    image: t.image_url || t.image_large || t.image_small || t.image || null,
    handle: (t.handle || '').replace(/^@/, '').toLowerCase() || null,
  }
}

async function loadUniverse(force = false) {
  if (!force && _universe && Date.now() - _universeTs < UNIVERSE_TTL) return _universe

  const byCgId = new Map()
  const byHandle = new Map()
  const bySymbol = new Map()
  const list = []

  // Pull a wide slice so the mock has plenty of real project rows to follow.
  const data = await dashFetch('/api/bootstrap?per_page=120&ranking=mentions')
  const rows = [...(data.featured_majors || []), ...(data.tokens || [])]
  for (const row of rows) {
    const t = row.token || row
    const proj = _projectFromToken(t)
    if (!proj || !proj.cg_id) continue
    const metrics = row.metrics || {}
    // mention timing: bootstrap gives latest_mention_at on the row; first_mention
    // lives in metrics (often null) — fall back to latest for pre-push math.
    proj.first_mention_at = metrics.first_mention_at || row.latest_mention_at || null
    proj.latest_mention_at = row.latest_mention_at || null
    proj.external_mentions_24h = metrics.external_mentions_24h || 0
    proj.market_cap = t.market_cap || 0
    if (!byCgId.has(proj.cg_id)) {
      byCgId.set(proj.cg_id, proj)
      list.push(proj)
    }
    if (proj.handle) byHandle.set(proj.handle, proj)
    if (proj.symbol) bySymbol.set(proj.symbol.toUpperCase(), proj)
  }

  _universe = { byCgId, byHandle, bySymbol, list, generatedAt: data.generated_at_utc }
  _universeTs = Date.now()
  return _universe
}

// Resolve an arbitrary followed account to a known project (or null).
function matchProject(universe, { handle, symbol, name } = {}) {
  if (!universe) return null
  if (handle) {
    const h = String(handle).replace(/^@/, '').toLowerCase()
    if (universe.byHandle.has(h)) return universe.byHandle.get(h)
  }
  if (symbol) {
    const s = String(symbol).replace(/^\$/, '').toUpperCase()
    if (universe.bySymbol.has(s)) return universe.bySymbol.get(s)
  }
  if (name) {
    const n = String(name).toLowerCase().trim()
    for (const p of universe.list) {
      if (p.name && p.name.toLowerCase() === n) return p
    }
  }
  return null
}

// ---- KOL DB ----
let _kols = null            // KolRow[]
let _kolsByHandle = new Map()
let _kolsTs = 0


function deriveNarratives(tokens) {
  const counts = new Map()
  for (const t of tokens || []) {
    for (const tag of t.tags || t.category || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0])
}

// upstream AuthorRow -> KolRow
function normalizeKol(a, universe) {
  const id = String(a.id || a.rest_id || a.author_id || '')
  const screen_name = a.current_screen_name || a.screen_name || ''
  const followers = Number(a.followers_count) || 0
  const tokens = Array.isArray(a.tokens) ? a.tokens : []

  // what they push -> project chips (cross-ref universe for clean logo/name)
  const pushes = []
  const seen = new Set()
  for (const t of tokens.slice(0, 12)) {
    const cg = t.cg_id || t.token_id
    if (!cg || seen.has(cg)) continue
    seen.add(cg)
    const known = universe && universe.byCgId.get(cg)
    pushes.push({
      cg_id: cg,
      symbol: (known && known.symbol) || t.symbol || null,
      name: (known && known.name) || t.name || null,
      image: (known && known.image) || t.image_url || null,
    })
  }
  // fall back to the single top_token if no token list came through (kols list rows)
  if (!pushes.length && a.top_token_cg_id) {
    const cg = a.top_token_cg_id
    const known = universe && universe.byCgId.get(cg)
    pushes.push({
      cg_id: cg,
      symbol: (known && known.symbol) || null,
      name: (known && known.name) || a.top_token_name || null,
      image: (known && known.image) || null,
    })
  }

  const sp = a.signal_profile || {}
  // signal_score 0-100 from activity/momentum + early-call hit rate + reach tier.
  const activity = Math.min(1, (Number(a.activity_score) || 0) / 100)
  const momentum = Math.min(1, (Number(a.momentum_score) || 0) / 100)
  const earlyRate = Math.min(1, Number(sp.early_signal_hit_rate_7d || a.early_signal_hit_rate_7d) || 0)
  const reachTier = followers >= 250000 ? 1 : followers >= 50000 ? 0.7 : followers >= 10000 ? 0.45 : 0.25
  const signal_score = Math.round(
    Math.min(100, 100 * (0.35 * activity + 0.25 * momentum + 0.25 * earlyRate + 0.15 * reachTier))
  )

  return {
    id,
    screen_name,
    name: a.current_display_name || a.name || a.display_name || screen_name,
    avatar_url: a.avatar_image_url || null,
    followers_count: followers,
    tier: classifyTier(screen_name, followers, signal_score),
    verified: Boolean(a.is_blue_verified || a.legacy_verified),
    narratives: deriveNarratives(tokens),
    pushes,
    signal_score,
    recent_new_follows_count: 0, // filled by engine after diffs
    influence_rank: Number(a.rank_position) || null,
    tracked: true,
    last_active_at: a.last_seen_at || null,
    // carried for the engine (not part of the public KolRow surface but harmless)
    _mention_count: Number(a.mention_count) || 0,
    _weighted_engagement: Number(a.total_weighted_engagement) || 0,
  }
}

// ── direct X profile resolve (our own tweets backend) ───────────────────────
// Curated big guns the X Dash upstream doesn't track (GCR, Hsaka, ThreadGuy…)
// used to skip silently. We have our OWN X data lane — the tweets backend's
// get_official_tweets returns the full author profile (followers, avatar,
// blue-check) + recent timeline for any handle. Synthesize a KolRow from it so
// the account exists in the DB, is followable, and carries real reach numbers.
// No xdash mention data yet => zero activity/signal fields (honest), until the
// collector picks the handle up and the normal path takes over.
const TWEETS_API_BASE = process.env.TWEETS_API_BASE || 'https://backend-277369611639.us-central1.run.app'
const _directFail = new Map() // handleLower -> ts of last failure
const DIRECT_FAIL_TTL = 6 * 60 * 60 * 1000 // don't hammer a dead/protected handle

async function resolveViaTweetsApi(handle) {
  const h = String(handle || '').toLowerCase()
  const lastFail = _directFail.get(h)
  if (lastFail && Date.now() - lastFail < DIRECT_FAIL_TTL) return null
  try {
    const res = await fetch(
      `${TWEETS_API_BASE}/get_official_tweets?username=${encodeURIComponent(handle)}`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) throw new Error(`tweets api ${res.status}`)
    const d = await res.json()
    const a = d && d.author
    // 🪤 the backend fuzzy-falls back to a DIFFERENT user on unknown handles
    // (asking for 0xngmi returned ViktorBunin) — hard-verify identity.
    if (!a || String(a.screen_name || '').toLowerCase() !== h) throw new Error('identity mismatch')
    const counts = a.counts || {}
    const followers = Number(counts.followers_count) || 0
    if (!followers) throw new Error('no follower count')
    const tweets = Array.isArray(d.tweets) ? d.tweets : []
    const lastTweetAt = tweets.length ? (tweets[0].created_at || tweets[0].date || null) : null
    return {
      id: String(a.user_id || ''),
      screen_name: a.screen_name,
      name: a.name || a.screen_name,
      avatar_url: (a.avatar_image_url || '').replace('_normal.', '_200x200.') || null,
      followers_count: followers,
      tier: classifyTier(a.screen_name, followers, 0),
      verified: Boolean(a.account_state && (a.account_state.is_blue_verified || a.account_state.verified)),
      narratives: [],
      pushes: [],
      signal_score: 0,
      recent_new_follows_count: 0,
      influence_rank: null,
      tracked: true,
      source: 'x-direct', // provenance: our backend, not the xdash collector
      last_active_at: lastTweetAt,
      _mention_count: 0,
      _weighted_engagement: 0,
    }
  } catch (err) {
    _directFail.set(h, Date.now())
    return null
  }
}

// Build a KOL's endorsements (pushes + health + weight) from a cg_id->health Map.
// weight mirrors the legitimacy scale: green=1.0, amber=0.4, red=0.0, grey=0.
const TONE_WEIGHT = { green: 1.0, amber: 0.4, red: 0.0, grey: 0.0 }
function buildEndorsements(pushes, healthMap) {
  return (pushes || []).map((p) => {
    const health = (healthMap && healthMap.get(p.cg_id)) || { state: 'unknown', tone: 'grey' }
    return {
      cg_id: p.cg_id,
      symbol: p.symbol,
      name: p.name,
      image: p.image,
      weight: TONE_WEIGHT[health.tone] ?? 0,
      health,
    }
  })
}

// Seed/refresh the whole DB. Returns KolRow[].
async function refresh({ force = false } = {}) {
  if (!force && _kols && Date.now() - _kolsTs < UNIVERSE_TTL) return _kols

  const universe = await loadUniverse(force)

  // paginate top authors by reach
  const authorRows = []
  for (let page = 1; page <= SEED_PAGES; page++) {
    try {
      const data = await dashFetch(
        `/api/kols?timeframe=24h&sort=reach&per_page=${KOLS_PER_PAGE}&page=${page}`
      )
      const authors = data.authors || []
      if (!authors.length) break
      authorRows.push(...authors)
    } catch (err) {
      console.warn(`[kol/registry] kols page ${page} failed:`, err.message)
      break
    }
  }

  // de-dupe by id + apply the quality floor (no empty/bot accounts in the DB),
  // then keep the top MAX_KOLS by reach.
  const byId = new Map()
  for (const a of authorRows) {
    const id = String(a.id || a.rest_id || '')
    if (!id || byId.has(id)) continue
    if ((Number(a.followers_count) || 0) < MIN_FOLLOWERS) continue
    byId.set(id, a)
  }
  let rows = [...byId.values()]
    .sort((x, y) => (Number(y.followers_count) || 0) - (Number(x.followers_count) || 0))
    .slice(0, MAX_KOLS)

  // enrich the top slice with /api/author/:id so "what they push" is rich.
  const toEnrich = rows.slice(0, ENRICH_COUNT)
  for (let i = 0; i < toEnrich.length; i += ENRICH_CONCURRENCY) {
    const batch = toEnrich.slice(i, i + ENRICH_CONCURRENCY)
    await Promise.all(
      batch.map(async (a) => {
        const id = String(a.id || a.rest_id || '')
        try {
          const d = await dashFetch(`/api/author/${encodeURIComponent(id)}?limit=24`)
          if (d && Array.isArray(d.tokens)) a.tokens = d.tokens
          if (d && d.author) Object.assign(a, { author_detail: d.author })
        } catch {
          /* enrichment best-effort */
        }
      })
    )
  }

  let kols = rows
    .map((a) => normalizeKol(a, universe))
    .filter((k) => k.followers_count >= MIN_FOLLOWERS) // belt-and-suspenders floor

  // Guarantee the curated S / Tier-1 KOLs are in the DB even when they missed
  // the 24h-reach seed (the big OGs tweet less, so they fall off the top pages
  // and the S-Tier filter ends up nearly empty). Resolve each missing curated
  // handle and merge it in. 404s (handles X Dash doesn't track) skip silently.
  const present = new Set(kols.map((k) => k.screen_name.toLowerCase()))
  const wanted = [...CURATED_S, ...CURATED_T1].filter((h) => !present.has(h))
  for (let i = 0; i < wanted.length; i += ENRICH_CONCURRENCY) {
    const batch = wanted.slice(i, i + ENRICH_CONCURRENCY)
    const resolved = await Promise.all(
      batch.map(async (h) => {
        try {
          const d = await dashFetch(`/api/author/${encodeURIComponent(h)}?limit=24`)
          const author = (d && d.author) || null
          if (!author || !(author.id || author.rest_id)) return null
          return normalizeKol({ ...author, tokens: Array.isArray(d.tokens) ? d.tokens : [] }, universe)
        } catch { return null }
      })
    )
    for (const k of resolved) {
      if (k && !present.has(k.screen_name.toLowerCase())) {
        kols.push(k)
        present.add(k.screen_name.toLowerCase())
      }
    }
  }

  // Second chance: curated handles the X Dash upstream STILL doesn't have get
  // resolved through our own tweets backend (real profile + reach, zero xdash
  // signal yet). Self-heals on every refresh — the moment the collector picks
  // a handle up, the normal path above wins and this no-ops.
  const stillMissing = [...CURATED_S, ...CURATED_T1].filter((h) => !present.has(h))
  if (stillMissing.length) {
    for (let i = 0; i < stillMissing.length; i += ENRICH_CONCURRENCY) {
      const batch = stillMissing.slice(i, i + ENRICH_CONCURRENCY)
      const resolved = await Promise.all(batch.map((h) => resolveViaTweetsApi(h)))
      for (const k of resolved) {
        if (k && !present.has(k.screen_name.toLowerCase())) {
          kols.push(k)
          present.add(k.screen_name.toLowerCase())
        }
      }
    }
  }

  kols.sort((x, y) =>
    (y._weighted_engagement - x._weighted_engagement) ||
    (y.followers_count - x.followers_count))
  kols.forEach((k, i) => { k.influence_rank = i + 1 })

  // legitimacy: ONE batched health lookup over every unique pushed cg_id, then
  // stamp legit_score + legit_label per KolRow. If CG fails, leave them null —
  // never block the registry.
  try {
    const uniqueCgIds = [...new Set(
      kols.flatMap((k) => (k.pushes || []).map((p) => p.cg_id)).filter(Boolean)
    )]
    const healthMap = await getProjectHealth(uniqueCgIds)
    for (const k of kols) {
      const legit = computeLegitimacy(buildEndorsements(k.pushes, healthMap))
      // thin/unrated legitimacy => no damning score on the card (hide the chip)
      k.legit_score = legit.label === 'Unrated' || legit.label === 'Building' ? null : legit.score
      k.legit_label = legit.label
    }
  } catch (err) {
    console.warn('[kol/registry] legitimacy pass failed:', err.message)
    for (const k of kols) {
      if (k.legit_score === undefined) k.legit_score = null
      if (k.legit_label === undefined) k.legit_label = 'Unrated'
    }
  }

  _kols = kols
  _kolsByHandle = new Map(kols.map((k) => [k.screen_name.toLowerCase(), k]))
  _kolsTs = Date.now()
  await store.saveRegistry(kols)
  return kols
}

// Stale-registry watchdog. getKols() used to serve the persisted snapshot
// FOREVER (refresh() had no caller once a snapshot existed) — follower counts
// froze and new/curated KOLs never appeared until someone emptied the store.
// Now: serve the snapshot instantly, kick ONE background rebuild when it's
// older than REGISTRY_STALE_MS.
const REGISTRY_STALE_MS = 6 * 60 * 60 * 1000
const REFRESH_RETRY_COOLDOWN = 10 * 60 * 1000 // failed rebuild -> don't re-attempt per request
let _refreshInflight = null
let _lastRefreshAttempt = 0
function maybeBackgroundRefresh() {
  if (_refreshInflight) return
  if (_kolsTs && Date.now() - _kolsTs < REGISTRY_STALE_MS) return
  if (Date.now() - _lastRefreshAttempt < REFRESH_RETRY_COOLDOWN) return
  _lastRefreshAttempt = Date.now()
  _refreshInflight = refresh({ force: true })
    .then((kols) => { console.log(`[kol/registry] background refresh: ${kols.length} kols`); return kols })
    .catch((e) => console.warn('[kol/registry] background refresh failed:', e.message))
    .finally(() => { _refreshInflight = null })
}

// In-memory accessors (load from store if cold).
async function getKols() {
  if (_kols) {
    maybeBackgroundRefresh()
    return _kols
  }
  const reg = await store.getRegistry()
  if (reg.kols && reg.kols.length) {
    _kols = reg.kols
    _kolsByHandle = new Map(_kols.map((k) => [k.screen_name.toLowerCase(), k]))
    _kolsTs = reg.updatedAt ? (Date.parse(reg.updatedAt) || 0) : 0
    maybeBackgroundRefresh()
    return _kols
  }
  return refresh()
}

function getKolsSync() {
  return _kols || []
}

function getKolByHandle(handle) {
  return _kolsByHandle.get(String(handle).toLowerCase()) || null
}

// On-demand resolve (the search engine): cache hit first, else pull the author
// from X Dash (/api/author/<handle>) and normalize. Returns a KolRow or null
// (null = upstream 404/empty, caller answers { found:false }).
async function resolveKol(handle) {
  const h = String(handle || '').replace(/^@/, '').trim()
  if (!h) return null
  const hit = getKolByHandle(h)
  if (hit) return hit

  let d
  try {
    d = await dashFetch(`/api/author/${encodeURIComponent(h)}?limit=24`)
  } catch (err) {
    if (/\b404\b/.test(err.message)) return null
    throw err
  }
  const author = (d && d.author) || null
  if (!author || !(author.id || author.rest_id)) return null

  const universe = await loadUniverse()
  const kol = normalizeKol(
    { ...author, tokens: Array.isArray(d.tokens) ? d.tokens : [] },
    universe
  )
  return kol
}

// per-id author-detail cache so opening a profile is rich but cheap.
const _authorCache = new Map() // idLower -> { tokens, ts }
const AUTHOR_TTL = 5 * 60 * 1000

// Backfill: the registry seed only carries 1-12 pushes per KOL (and only the
// top ENRICH_COUNT are deep-enriched), so most profiles are thin. On dossier
// open we pull the KOL's FULL token list from /api/author/:id so every profile
// shows their real projects + a reliable legitimacy score. Cached + graceful.
async function getRichPushes(kol) {
  if (!kol) return []
  if ((kol.pushes || []).length >= 8) return kol.pushes // already deep-enriched
  const id = String(kol.id || kol.screen_name || '').replace(/^@/, '')
  if (!id) return kol.pushes || []
  let tokens
  const c = _authorCache.get(id.toLowerCase())
  if (c && Date.now() - c.ts < AUTHOR_TTL) tokens = c.tokens
  else {
    try {
      const d = await dashFetch(`/api/author/${encodeURIComponent(id)}?limit=24`)
      tokens = Array.isArray(d && d.tokens) ? d.tokens : []
      _authorCache.set(id.toLowerCase(), { tokens, ts: Date.now() })
    } catch { return kol.pushes || [] }
  }
  if (!tokens.length) return kol.pushes || []
  const universe = await loadUniverse()
  const pushes = []
  const seen = new Set()
  for (const t of tokens.slice(0, 16)) {
    const cg = t.cg_id || t.token_id
    if (!cg || seen.has(cg)) continue
    seen.add(cg)
    const known = universe && universe.byCgId.get(cg)
    pushes.push({
      cg_id: cg,
      symbol: (known && known.symbol) || t.symbol || null,
      name: (known && known.name) || t.name || null,
      image: (known && known.image) || t.image_url || null,
    })
  }
  return pushes.length ? pushes : (kol.pushes || [])
}

module.exports = {
  refresh,
  getKols,
  getKolsSync,
  getKolByHandle,
  resolveKol,
  getRichPushes,
  buildEndorsements,
  loadUniverse,
  matchProject,
  normalizeKol,
  resolveViaTweetsApi,
  _projectFromToken,
}
