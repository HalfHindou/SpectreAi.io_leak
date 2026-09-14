/**
 * KOL Radar — pluggable follow-graph provider.
 *
 * Interface:  getFollowing(handleOrId, { cursor, limit })
 *               -> { accounts: Account[], nextCursor }
 *
 * Account: {
 *   screen_name, name, avatar_url, followers_count, bio,
 *   is_project (bool), project: { cg_id, symbol, name, image } | null,
 *   followed_at?  (ISO; mock fabricates recent timestamps so the demo is alive)
 * }
 *
 * Implementations (env KOL_FOLLOW_PROVIDER, default 'mock'):
 *   - mock          deterministic by handle, NO network. Fabricates recent
 *                   project-follows from the REAL token universe so that
 *                   several KOLs converge on the same few projects (incl.
 *                   pre-push cases) + a steady new-follow feed exists at boot.
 *   - twitterapiio  real adapter (env TWITTERAPI_IO_KEY). Dormant until the
 *                   key is set.
 */
const registry = require('./registry')

const PROVIDER = (process.env.KOL_FOLLOW_PROVIDER || 'mock').toLowerCase()
const TWITTERAPI_IO_KEY = process.env.TWITTERAPI_IO_KEY || ''

// ── deterministic helpers ──────────────────────────────────────────────────
function hash32(str) {
  // FNV-1a
  let h = 0x811c9dc5
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
function seededRng(seed) {
  // mulberry32
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A small pool of plausible non-project (person) accounts the KOLs also follow,
// so the feed isn't 100% projects.
const PERSON_POOL = [
  { screen_name: 'cobie', name: 'Cobie', followers_count: 800000 },
  { screen_name: 'gainzy222', name: 'gainzy', followers_count: 420000 },
  { screen_name: 'CryptoCred', name: 'Cred', followers_count: 510000 },
  { screen_name: 'inversebrah', name: 'i.', followers_count: 360000 },
  { screen_name: 'AltcoinGordon', name: 'Gordon', followers_count: 730000 },
  { screen_name: 'ansel', name: 'ansem', followers_count: 690000 },
  { screen_name: 'TheCryptoDog', name: 'The Crypto Dog', followers_count: 760000 },
  { screen_name: 'pentosh1', name: 'Pentoshi', followers_count: 780000 },
]

// ── MOCK ────────────────────────────────────────────────────────────────────
//
// Design for convergence: we deterministically nominate a handful of "hot"
// projects from the universe and arrange for many KOLs to have recently
// followed them (within the signal window), with a couple positioned as
// pre-push (followed BEFORE the project's first mention).
//
let _mockPlanTs = 0
let _mockPlan = null
const MOCK_PLAN_TTL = 5 * 60 * 1000

async function buildMockPlan() {
  if (_mockPlan && Date.now() - _mockPlanTs < MOCK_PLAN_TTL) return _mockPlan

  const universe = await registry.loadUniverse()
  const projects = universe.list.slice() // already de-duped, has timing
  // Stable order independent of upstream churn: sort by cg_id hash.
  projects.sort((a, b) => hash32(a.cg_id) - hash32(b.cg_id))

  // Pick convergence targets: a few hot projects everyone is piling into.
  const hotCount = Math.min(6, Math.max(3, Math.floor(projects.length / 12)))
  const hot = projects.slice(0, hotCount)
  // Mark ~half of the hot set as "pre-push" (low/no mentions yet -> alpha case).
  const prePush = new Set(hot.slice(0, Math.ceil(hotCount / 2)).map((p) => p.cg_id))

  _mockPlan = { universe, projects, hot, prePush }
  _mockPlanTs = Date.now()
  return _mockPlan
}

function isoMinutesAgo(mins) {
  return new Date(Date.now() - mins * 60 * 1000).toISOString()
}

async function mockGetFollowing(handle, { limit = 60 } = {}) {
  const plan = await buildMockPlan()
  const { projects, hot, prePush, universe } = plan
  const seed = hash32(String(handle).toLowerCase())
  const rng = seededRng(seed)

  const accounts = []
  const usedCg = new Set()

  // 1) Convergence: most KOLs recently followed 2-4 of the hot projects.
  //    Deterministic per-handle which hot ones, but enough overlap that
  //    >= min_kols land on the same target inside the window.
  const hotFollows = 2 + Math.floor(rng() * 3) // 2..4
  for (let i = 0; i < hot.length && accounts.length < hotFollows; i++) {
    // each KOL skips a hot project with low prob -> guarantees heavy overlap
    if (rng() < 0.25) continue
    const proj = hot[i]
    if (usedCg.has(proj.cg_id)) continue
    usedCg.add(proj.cg_id)
    // recent follow: 1..70h ago (inside the default 72h window)
    const minsAgo = 60 + Math.floor(rng() * 70 * 60)
    accounts.push(projectAccount(proj, isoMinutesAgo(minsAgo), prePush.has(proj.cg_id)))
  }

  // 2) A spread of older project follows (baseline, outside the hot window)
  //    so each KOL has a believable projects-followed history.
  const tailCount = 6 + Math.floor(rng() * 10)
  for (let i = 0; i < tailCount; i++) {
    const idx = Math.floor(rng() * projects.length)
    const proj = projects[idx]
    if (!proj || usedCg.has(proj.cg_id)) continue
    usedCg.add(proj.cg_id)
    const daysAgo = 4 + Math.floor(rng() * 120) // 4..124 days ago
    accounts.push(projectAccount(proj, isoMinutesAgo(daysAgo * 24 * 60), false))
  }

  // 3) Some person follows (non-projects) for realism.
  const personCount = 3 + Math.floor(rng() * 4)
  for (let i = 0; i < personCount; i++) {
    const p = PERSON_POOL[Math.floor(rng() * PERSON_POOL.length)]
    const daysAgo = 10 + Math.floor(rng() * 300)
    accounts.push({
      screen_name: p.screen_name,
      name: p.name,
      avatar_url: `https://unavatar.io/twitter/${p.screen_name}`,
      followers_count: p.followers_count,
      bio: '',
      is_project: false,
      project: null,
      followed_at: isoMinutesAgo(daysAgo * 24 * 60),
    })
  }

  // newest-first
  accounts.sort((a, b) => new Date(b.followed_at) - new Date(a.followed_at))
  return { accounts: accounts.slice(0, limit), nextCursor: null }
}

function projectAccount(proj, followedAt, forcePrePush) {
  return {
    screen_name: proj.handle || proj.symbol || proj.cg_id,
    name: proj.name,
    avatar_url: proj.image || null,
    followers_count: 0,
    bio: proj.symbol ? `$${proj.symbol}` : '',
    is_project: true,
    project: { cg_id: proj.cg_id, symbol: proj.symbol, name: proj.name, image: proj.image },
    followed_at: followedAt,
    // mock-only hint so the engine can stage pre-push deterministically; the
    // engine still recomputes is_pre_push from real mention timing.
    _mock_pre_push: Boolean(forcePrePush),
  }
}

// ── TWITTERAPI.IO (real) ─────────────────────────────────────────────────────
async function twitterapiioGetFollowing(handle, { cursor = '', limit = 200 } = {}) {
  if (!TWITTERAPI_IO_KEY) {
    throw new Error('TWITTERAPI_IO_KEY not configured')
  }
  const universe = await registry.loadUniverse().catch(() => null)
  const userName = String(handle).replace(/^@/, '')
  const params = new URLSearchParams({ userName })
  if (cursor) params.set('cursor', cursor)

  const res = await fetch(
    `https://api.twitterapi.io/twitter/user/followings?${params.toString()}`,
    {
      headers: { 'x-api-key': TWITTERAPI_IO_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    }
  )
  if (!res.ok) throw new Error(`twitterapi.io ${res.status}`)
  const data = await res.json()

  // twitterapi.io shape: { followings: [user], next_cursor, has_next_page }
  const raw = data.followings || data.users || data.data || []
  const accounts = []
  for (const u of raw.slice(0, limit)) {
    const screen_name = u.userName || u.screen_name || u.username || ''
    const project =
      universe &&
      registry.matchProject(universe, {
        handle: screen_name,
        name: u.name || u.displayName,
      })
    accounts.push({
      screen_name,
      name: u.name || u.displayName || screen_name,
      avatar_url: u.profilePicture || u.profile_image_url || null,
      followers_count: Number(u.followers || u.followersCount || u.followers_count) || 0,
      bio: u.description || u.bio || '',
      is_project: Boolean(project),
      project: project
        ? { cg_id: project.cg_id, symbol: project.symbol, name: project.name, image: project.image }
        : null,
      // real API doesn't expose follow timestamps; engine treats new diffs as "now"
      followed_at: null,
    })
  }
  const nextCursor = data.has_next_page ? data.next_cursor || null : null
  return { accounts, nextCursor }
}

// ── dispatch ────────────────────────────────────────────────────────────────
async function getFollowing(handleOrId, opts = {}) {
  if (PROVIDER === 'twitterapiio') return twitterapiioGetFollowing(handleOrId, opts)
  return mockGetFollowing(handleOrId, opts)
}

module.exports = {
  PROVIDER,
  getFollowing,
  // exported for tests / engine
  _mockGetFollowing: mockGetFollowing,
  _buildMockPlan: buildMockPlan,
}
