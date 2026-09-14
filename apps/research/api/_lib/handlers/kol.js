/**
 * Vercel Serverless - KOL Radar handler (ESM mirror of the dev Express router
 * packages/server/routes/kol.js). Dispatched by social-api.js as fn=kol.
 *
 * Routes (read req.query.route, set by the /api/kol/:route(.*) vercel rewrite):
 *   GET  db        Giga KOL DB grid (search/filter/sort/paginate)
 *   GET  feed      live new-follow feed (scope all|mine)
 *   GET  signals   convergence smart-signals board
 *   GET  alerts    (Privy-authed) notification poller for followed KOLs
 *   POST sync      manual/admin/cron sync trigger
 *   GET  <handle>  KOL dossier (any route value that isn't one of the above)
 *
 * Read routes (db/feed[scope=all]/signals[scope=all]/<handle>) are publicly
 * readable (gated upstream in social-api like xdash). `alerts`, and the `mine`
 * scope on feed/signals, enforce their own Privy JWT verification here.
 */
import registry from '../kol/registry.js'
import engine from '../kol/engine.js'
import store from '../kol/store.js'
import { getProjectHealth, computeLegitimacy } from '../kol/health.js'
import { getKolTrackRecord, classifyArchetype, computeCredibility } from '../kol/track-record.js'
import { getNameMentions, PROVIDER as TIMELINE_PROVIDER } from '../kol/name-backfill.js'
import { verifyPrivyToken } from '../auth.js'
import { getUser } from '../kv.js'

const FOLLOW_PROVIDER = process.env.KOL_FOLLOW_PROVIDER || 'mock'

// ── tiny cache + dedup ──────────────────────────────────────────────────────
const cache = new Map()
const inflight = new Map()
function getCached(key, ttlMs) {
  const e = cache.get(key)
  if (!e) return null
  if (Date.now() - e.ts > ttlMs) {
    cache.delete(key)
    return null
  }
  return e.data
}
function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() })
  if (cache.size > 200) cache.delete(cache.keys().next().value)
}
function dedup(key, ttlMs, producer) {
  const cached = getCached(key, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (inflight.has(key)) return inflight.get(key)
  const p = Promise.resolve()
    .then(producer)
    .then((data) => {
      setCached(key, data)
      inflight.delete(key)
      return data
    })
    .catch((err) => {
      inflight.delete(key)
      throw err
    })
  inflight.set(key, p)
  return p
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/
function sanitizeHandle(h) {
  return String(h || '').replace(/^@/, '').trim()
}

// publicKolRow: drop the engine-internal underscore fields.
function publicKol(k) {
  if (!k) return k
  const { _mention_count, _weighted_engagement, author_detail, ...rest } = k
  return rest
}
function stripEvent(e) {
  const { _kol_tier, _kol_followers, ...rest } = e
  return rest
}

// ── shared: resolve the authed user's followed KOL handles ────────────────────
// Returns string[] of handles, or null if the user is not authenticated.
// Reads the same `user:<did>:profile` record that PUT /api/user/kol-follows
// writes (via getUser/setUser in kv.js), so dev + prod share the follow list.
async function getUserFollows(req) {
  const userId = await verifyPrivyToken(req)
  if (!userId) return null
  const userData = await getUser(userId)
  return Array.isArray(userData?.kolFollows) ? userData.kolFollows : []
}

// ── GET /db ──────────────────────────────────────────────────────────────────
async function handleDb(req, res) {
  const q = String(req.query.q || '').trim().toLowerCase()
  const tier = String(req.query.tier || '').trim().toLowerCase()
  const narrative = String(req.query.narrative || '').trim().toLowerCase()
  const sort = ['influence', 'activity', 'followers', 'new_follows', 'legit'].includes(req.query.sort)
    ? req.query.sort
    : 'influence'
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const perPage = Math.min(60, Math.max(1, parseInt(req.query.per_page, 10) || 30))

  const all = await registry.getKols()

  let filtered = all
  if (q) {
    filtered = filtered.filter(
      (k) =>
        k.screen_name.toLowerCase().includes(q) ||
        (k.name || '').toLowerCase().includes(q)
    )
  }
  if (tier) filtered = filtered.filter((k) => k.tier === tier)
  if (narrative) {
    filtered = filtered.filter((k) =>
      (k.narratives || []).some((n) => n.toLowerCase().includes(narrative))
    )
  }

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'followers':
        return (b.followers_count || 0) - (a.followers_count || 0)
      case 'activity':
        return (b._mention_count || 0) - (a._mention_count || 0)
      case 'new_follows':
        return (b.recent_new_follows_count || 0) - (a.recent_new_follows_count || 0)
      case 'legit': {
        // desc by legit_score, nulls last.
        const av = a.legit_score, bv = b.legit_score
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return bv - av
      }
      case 'influence':
      default:
        return (b.signal_score || 0) - (a.signal_score || 0)
    }
  })

  const filtered_count = sorted.length
  const start = (page - 1) * perPage
  const slice = sorted.slice(start, start + perPage).map(publicKol)

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  return res.status(200).json({
    kols: slice,
    pagination: {
      page,
      per_page: perPage,
      page_count: Math.max(1, Math.ceil(filtered_count / perPage)),
      filtered_count,
      returned_count: slice.length,
    },
    generated_at_utc: new Date().toISOString(),
  })
}

// ── GET /feed ─────────────────────────────────────────────────────────────────
async function handleFeed(req, res) {
  const scope = req.query.scope === 'mine' ? 'mine' : 'all'
  const since = req.query.since ? new Date(req.query.since).getTime() : null
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const perPage = Math.min(80, Math.max(1, parseInt(req.query.per_page, 10) || 40))

  let events = await store.getEvents()

  if (scope === 'mine') {
    const follows = await getUserFollows(req)
    if (follows === null) return res.status(401).json({ error: 'Unauthorized' })
    const set = new Set(follows.map((h) => h.toLowerCase()))
    events = events.filter((e) => set.has(e.kol.screen_name.toLowerCase()))
  }
  if (since) events = events.filter((e) => new Date(e.followed_at).getTime() > since)

  // newest first (events ring is already newest-first, but be explicit)
  events = [...events].sort((a, b) => new Date(b.followed_at) - new Date(a.followed_at))

  const total = events.length
  const start = (page - 1) * perPage
  const slice = events.slice(start, start + perPage).map(stripEvent)

  if (scope === 'all') res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res.status(200).json({
    events: slice,
    pagination: {
      page,
      per_page: perPage,
      page_count: Math.max(1, Math.ceil(total / perPage)),
      filtered_count: total,
      returned_count: slice.length,
    },
    provider: FOLLOW_PROVIDER,
    generated_at_utc: new Date().toISOString(),
  })
}

// ── GET /signals ──────────────────────────────────────────────────────────────
async function handleSignals(req, res) {
  const scope = req.query.scope === 'mine' ? 'mine' : 'all'
  const windowHours = Math.min(720, Math.max(1, parseInt(req.query.window_hours, 10) || engine.DEFAULT_WINDOW_HOURS))
  const minKols = Math.min(20, Math.max(2, parseInt(req.query.min_kols, 10) || engine.SURFACE_MIN_KOLS))

  let signals
  // Use stored signals when the request matches the sync's defaults; otherwise
  // recompute from the events log for the requested window/min_kols.
  if (windowHours === engine.DEFAULT_WINDOW_HOURS && minKols === engine.SURFACE_MIN_KOLS) {
    const stored = await store.getSignals()
    signals = stored.signals
  } else {
    const events = await store.getEvents()
    const universe = await registry.loadUniverse()
    signals = engine.computeSignals(events, universe, { windowHours, minKols })
  }

  if (scope === 'mine') {
    const follows = await getUserFollows(req)
    if (follows === null) return res.status(401).json({ error: 'Unauthorized' })
    const set = new Set(follows.map((h) => h.toLowerCase()))
    signals = signals
      .map((s) => ({ ...s, kols: s.kols.filter((k) => set.has(k.screen_name.toLowerCase())) }))
      .filter((s) => s.kols.length >= 1 && s.kols.length >= minKols - 1)
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  }

  return res.status(200).json({ signals, provider: FOLLOW_PROVIDER, generated_at_utc: new Date().toISOString() })
}

// ── GET /alerts (Privy-authed) ────────────────────────────────────────────────
async function handleAlerts(req, res) {
  const follows = await getUserFollows(req)
  if (follows === null) return res.status(401).json({ error: 'Unauthorized' })
  const set = new Set(follows.map((h) => h.toLowerCase()))
  const since = req.query.since ? new Date(req.query.since).getTime() : Date.now() - 24 * 36e5

  const alerts = []

  // convergence alerts: signals that involve >=1 of the user's KOLs, recent
  const stored = await store.getSignals()
  for (const s of stored.signals || []) {
    const mine = s.kols.filter((k) => set.has(k.screen_name.toLowerCase()))
    if (!mine.length) continue
    const t = new Date(s.last_followed_at).getTime()
    if (t <= since) continue
    alerts.push({
      id: `conv-${s.id}`,
      type: 'convergence',
      title: `${mine.length} of your KOLs converged on ${s.project?.symbol || s.project?.name || 'a project'}`,
      body: s.is_pre_push
        ? `Pre-push: followed before the crowd${s.lead_time_hours ? ` (${s.lead_time_hours}h lead)` : ''}`
        : `${s.kol_count} KOLs followed within ${s.window_hours}h`,
      kols: mine,
      target: s.target,
      project: s.project,
      created_at: s.last_followed_at,
      priority: s.status === 'hot' ? 'high' : s.status === 'confirmed' ? 'medium' : 'low',
    })
  }

  // new-follow alerts: individual follows by the user's KOLs since `since`
  const events = await store.getEvents()
  for (const e of events) {
    if (!set.has(e.kol.screen_name.toLowerCase())) continue
    const t = new Date(e.followed_at).getTime()
    if (t <= since) continue
    if (!e.is_project) continue
    alerts.push({
      id: `nf-${e.id}`,
      type: 'new-follow',
      title: `${e.kol.name || e.kol.screen_name} followed ${e.project?.symbol || e.target.screen_name}`,
      body: e.project ? `New project follow` : `New follow`,
      kols: [{ screen_name: e.kol.screen_name, name: e.kol.name, avatar_url: e.kol.avatar_url }],
      target: e.target,
      project: e.project,
      created_at: e.followed_at,
      priority: 'low',
    })
  }

  alerts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return res.status(200).json({ alerts: alerts.slice(0, 100), server_time: new Date().toISOString() })
}

// ── POST /sync ────────────────────────────────────────────────────────────────
async function handleSync(req, res) {
  const result = await engine.runSync({
    windowHours: parseInt(req.query.window_hours, 10) || undefined,
    minKols: parseInt(req.query.min_kols, 10) || undefined,
  })
  return res.status(200).json(result)
}

// ── GET /:handle  (dossier) ───────────────────────────────────────────────────
async function handleDossier(req, res, rawHandle) {
  const handle = sanitizeHandle(rawHandle)
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' })

  await registry.getKols() // ensure DB warm
  // cache hit, else on-demand resolve via X Dash /api/author/<handle>.
  const kol = await registry.resolveKol(handle)
  if (!kol) return res.status(200).json({ found: false, handle })

  const data = await dedup(`dossier:${handle.toLowerCase()}`, 60 * 1000, async () => {
    const events = await store.getEvents()
    const mine = events
      .filter((e) => e.kol.screen_name.toLowerCase() === handle.toLowerCase())
      .sort((a, b) => new Date(b.followed_at) - new Date(a.followed_at))

    const sevenDaysAgo = Date.now() - 7 * 24 * 36e5
    const new_follows_7d = mine.filter((e) => new Date(e.followed_at).getTime() > sevenDaysAgo).length
    const projectsFollowed = new Set(mine.filter((e) => e.is_project && e.project).map((e) => e.project.cg_id))

    const stored = await store.getFollowing(handle)
    const sample = (stored?.accounts || []).slice(0, 30)

    // endorsements: each push + its project health + a tone weight; legitimacy
    // derived from those. CG failure -> all-grey/unknown -> Unrated (graceful).
    const pushes = await registry.getRichPushes(kol)
    const healthMap = await getProjectHealth(pushes.map((p) => p.cg_id).filter(Boolean))
    const endorsements = registry.buildEndorsements(pushes, healthMap)
    const legitimacy = computeLegitimacy(endorsements)

    // Call Ledger: realized track record + archetype + credibility grade.
    const prePushShare = mine.length ? mine.filter((e) => e.is_pre_push).length / mine.length : 0
    const track_record = await getKolTrackRecord(kol, pushes, healthMap)
    const archetype = classifyArchetype(kol, track_record, { prePushShare })
    const credibility = computeCredibility(track_record, legitimacy)

    // Backfill: projects they talk about BY NAME (no $ticker) the cashtag index
    // misses. Best-effort (LLM + CG, cached, never blocks).
    let name_mentions = []
    try { name_mentions = await getNameMentions(kol, pushes, await registry.loadUniverse()) } catch { /* graceful */ }

    return {
      kol: publicKol(kol),
      recent_follows: mine.slice(0, 40).map(stripEvent),
      pushes,
      endorsements,
      legitimacy,
      track_record,
      archetype,
      credibility,
      name_mentions,
      name_mention_provider: TIMELINE_PROVIDER, // 'mock' until a real tweet source is set
      provider: FOLLOW_PROVIDER, // 'mock' until a real follow source (twitterapiio) is set
      following_sample: sample,
      stats: {
        following_tracked: stored?.accounts?.length || 0,
        new_follows_7d,
        projects_followed: projectsFollowed.size,
      },
    }
  })

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  return res.status(200).json(data)
}

// ── dispatch ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const route = String(req.query.route || '').trim()
  try {
    if (route === 'db') return await handleDb(req, res)
    if (route === 'feed') return await handleFeed(req, res)
    if (route === 'signals') return await handleSignals(req, res)
    if (route === 'alerts') return await handleAlerts(req, res)
    if (route === 'sync') return await handleSync(req, res)
    // anything else (and non-empty) is a dossier handle lookup
    if (route) return await handleDossier(req, res, route)
    return res.status(400).json({ error: 'Unknown KOL route' })
  } catch (err) {
    console.error(`[kol/${route || '?'}] error:`, err.message)
    return res.status(502).json({ error: 'KOL Radar request failed', message: err.message })
  }
}
