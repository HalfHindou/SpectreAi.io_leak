/**
 * KOL Radar — snapshot/diff + convergence signal engine (ESM serverless mirror
 * of the dev CJS engine at packages/server/lib/kol/engine.js).
 *
 *  - snapshot+diff: fetch each tracked KOL's current following set, diff vs the
 *    stored set, emit a FollowEvent per NEW follow, append to the events ring.
 *  - convergence: group FollowEvents by target project within a rolling window,
 *    fire a ConvergenceSignal when >= min_kols distinct KOLs newly followed the
 *    same project; compute is_pre_push / lead_time from mention timing, score
 *    0-100, status emerging/confirmed/hot.
 *
 *  runSync() orchestrates a full pass and persists events + signals.
 */
import { createHash } from 'node:crypto'
import store from './store.js'
import registry from './registry.js'
import provider from './provider.js'

const DEFAULT_WINDOW_HOURS = 72
const DEFAULT_MIN_KOLS = 3 // contract default; UI surfaces 2+
const SURFACE_MIN_KOLS = 2
const SYNC_KOL_LIMIT = 80 // how many top KOLs to snapshot per pass
const SNAPSHOT_CONCURRENCY = 6

function nowIso() {
  return new Date().toISOString()
}
function hoursBetween(aIso, bIso) {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 36e5
}
function shortId(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

// ── snapshot + diff ─────────────────────────────────────────────────────────
//
// Returns { events: FollowEvent[], newCountByHandle: Map }.
// Mock fabricates recent follows with timestamps, so a first-ever snapshot
// still yields events. For the real provider, the first snapshot is a baseline
// (no events) and only subsequent diffs emit.
async function snapshotKol(kol) {
  const handle = kol.screen_name
  if (!handle) return { events: [], newCount: 0 }

  let current
  try {
    const r = await provider.getFollowing(handle, { limit: 80 })
    current = r.accounts || []
  } catch (err) {
    console.warn(`[kol/engine] following fetch failed for ${handle}:`, err.message)
    return { events: [], newCount: 0 }
  }

  const stored = await store.getFollowing(handle)
  const prevSet = new Set((stored?.accounts || []).map((a) => keyOf(a)))
  const isMock = provider.PROVIDER === 'mock'
  const firstEver = !stored

  const events = []
  for (const acct of current) {
    const k = keyOf(acct)
    const isNew = !prevSet.has(k)
    // mock: emit for everything on first snapshot (uses fabricated followed_at);
    //       on later passes, only genuinely-new entries.
    // real: emit only for new entries, never on the baseline snapshot.
    if (isNew && (isMock || !firstEver)) {
      events.push(makeFollowEvent(kol, acct))
    }
  }

  await store.saveFollowing(handle, current)
  return { events, newCount: events.length }
}

function keyOf(acct) {
  return (acct.project && acct.project.cg_id) || (acct.screen_name || '').toLowerCase()
}

function makeFollowEvent(kol, acct) {
  const followed_at = acct.followed_at || nowIso()
  return {
    id: shortId(kol.id || kol.screen_name, keyOf(acct), followed_at),
    kol: {
      screen_name: kol.screen_name, name: kol.name, avatar_url: kol.avatar_url,
      tier: kol.tier, followers_count: kol.followers_count || 0,
      verified: Boolean(kol.verified),
    },
    target: {
      screen_name: acct.screen_name,
      name: acct.name,
      avatar_url: acct.avatar_url,
      followers_count: acct.followers_count || 0,
      bio: acct.bio || '',
      is_project: Boolean(acct.is_project),
      project: acct.project || null,
    },
    followed_at,
    is_project: Boolean(acct.is_project),
    project: acct.project || null,
    // carried for engine scoring (KOL tier/followers); harmless in the payload
    _kol_tier: kol.tier,
    _kol_followers: kol.followers_count || 0,
  }
}

// ── convergence signals ─────────────────────────────────────────────────────
//
// Pure-ish: takes events + the token universe, returns ConvergenceSignal[].
function computeSignals(events, universe, opts = {}) {
  const windowHours = opts.windowHours || DEFAULT_WINDOW_HOURS
  const minKols = opts.minKols || SURFACE_MIN_KOLS
  const now = Date.now()
  const cutoff = now - windowHours * 36e5

  // group project-follows within the window by cg_id
  const groups = new Map() // cg_id -> { project, follows: [{event, kolId, at}] }
  for (const ev of events) {
    if (!ev.is_project || !ev.project || !ev.project.cg_id) continue
    const at = new Date(ev.followed_at).getTime()
    if (isNaN(at) || at < cutoff) continue
    const cg = ev.project.cg_id
    if (!groups.has(cg)) groups.set(cg, { project: ev.project, follows: [] })
    groups.get(cg).follows.push({ event: ev, kolId: ev.kol.screen_name, at })
  }

  const signals = []
  for (const [cg, g] of groups) {
    // distinct KOLs
    const byKol = new Map()
    for (const f of g.follows) {
      const prev = byKol.get(f.kolId)
      if (!prev || f.at < prev.at) byKol.set(f.kolId, f)
    }
    const distinct = [...byKol.values()]
    if (distinct.length < minKols) continue

    distinct.sort((a, b) => a.at - b.at)
    const first = distinct[0]
    const last = distinct[distinct.length - 1]
    const first_followed_at = new Date(first.at).toISOString()
    const last_followed_at = new Date(last.at).toISOString()

    const uni = universe && universe.byCgId.get(cg)
    const first_mention_at = uni ? uni.first_mention_at : null
    const mentions24h = uni ? uni.external_mentions_24h || 0 : 0

    // is_pre_push: no/low mentions yet OR earliest follow predates first mention
    let is_pre_push = false
    let lead_time_hours = null
    if (!first_mention_at) {
      is_pre_push = true // no mention timing -> treat as pre-push (alpha)
    } else {
      const lead = hoursBetween(first_followed_at, first_mention_at) // mention - follow
      if (lead > 0) {
        is_pre_push = true
        lead_time_hours = Math.round(lead * 10) / 10
      }
    }
    if (mentions24h < 10 && !is_pre_push) is_pre_push = true

    const kolCount = distinct.length
    const kols = distinct.map((f) => ({
      screen_name: f.event.kol.screen_name,
      name: f.event.kol.name,
      avatar_url: f.event.kol.avatar_url,
      tier: f.event._kol_tier || 'user',
      followers_count: f.event._kol_followers || 0,
    }))

    const windowSpanH = hoursBetween(first_followed_at, last_followed_at)
    const score = scoreSignal({ kolCount, kols, is_pre_push, windowSpanH, windowHours })
    // smart money: weight by the QUALITY of who converged (S-tier >> degens),
    // not just headcount. This is the signal a trader actually acts on.
    const smartWeight = kols.reduce((s, k) => s + (TIER_WEIGHT[k.tier] || 0.2), 0)
    const avg_tier_weight = Number((smartWeight / Math.max(1, kols.length)).toFixed(2))
    const smart_money_score = Math.min(
      100,
      Math.round(
        smartWeight * 16 +
        (is_pre_push ? 18 : 0) +
        Math.min(20, kolCount * 5) +
        Math.round(10 * (1 - Math.min(1, windowSpanH / windowHours)))
      )
    )
    const highTier = kols.filter((k) => k.tier === 's' || k.tier === 'tier1').length

    let status = 'emerging'
    if (kolCount >= 3) status = 'confirmed'
    if (kolCount >= 3 && highTier >= 2 && is_pre_push && windowSpanH <= 24) status = 'hot'

    signals.push({
      id: shortId('sig', cg, first_followed_at),
      target: last.event.target,
      project: g.project,
      kols,
      kol_count: kolCount,
      first_followed_at,
      last_followed_at,
      window_hours: windowHours,
      score,
      smart_money_score,
      avg_tier_weight,
      smart_kol_count: highTier,
      status,
      is_pre_push,
      first_mention_at,
      lead_time_hours,
    })
  }

  // rank by smart-money quality first (what to act on), score as tiebreak.
  signals.sort((a, b) => (b.smart_money_score - a.smart_money_score) || (b.score - a.score))
  return signals
}

// tier quality weights — S-tier carries real signal, degens are noise.
const TIER_WEIGHT = { s: 1, tier1: 0.8, tier2: 0.5, tier3: 0.3, user: 0.2 }

// score 0-100: #KOLs (weight) + influence tier + recency + pre-push bonus + follower quality
function scoreSignal({ kolCount, kols, is_pre_push, windowSpanH, windowHours }) {
  const kolPart = Math.min(40, kolCount * 11) // 3 kols ~33, 4+ caps near 40
  const highTier = kols.filter((k) => k.tier === 'kol' || k.tier === 'influencer').length
  const tierPart = Math.min(20, highTier * 8)
  const avgFollowers = kols.reduce((s, k) => s + (k.followers_count || 0), 0) / Math.max(1, kols.length)
  const qualityPart = Math.min(15, (avgFollowers / 250000) * 15)
  // recency: tighter window span = stronger signal
  const tightness = 1 - Math.min(1, windowSpanH / windowHours)
  const recencyPart = Math.round(10 * tightness)
  const prePushPart = is_pre_push ? 15 : 0
  return Math.min(100, Math.round(kolPart + tierPart + qualityPart + recencyPart + prePushPart))
}

// ── orchestrator ─────────────────────────────────────────────────────────────
let _syncing = false
let _lastSync = 0

async function runSync(opts = {}) {
  if (_syncing) return { ok: false, reason: 'sync already in progress' }
  _syncing = true
  const started = Date.now()
  try {
    const kols = await registry.getKols()
    const universe = await registry.loadUniverse()
    const targets = kols.slice(0, opts.kolLimit || SYNC_KOL_LIMIT)

    let allNew = []
    const newCountByHandle = new Map()
    for (let i = 0; i < targets.length; i += SNAPSHOT_CONCURRENCY) {
      const batch = targets.slice(i, i + SNAPSHOT_CONCURRENCY)
      const results = await Promise.all(batch.map((k) => snapshotKol(k)))
      results.forEach((r, j) => {
        if (r.newCount) newCountByHandle.set(batch[j].screen_name.toLowerCase(), r.newCount)
        allNew.push(...r.events)
      })
    }

    // de-dupe events by id before persisting (idempotent re-runs)
    const existing = await store.getEvents()
    const existingIds = new Set(existing.map((e) => e.id))
    const fresh = allNew.filter((e) => !existingIds.has(e.id))
    const events = fresh.length ? await store.appendEvents(fresh) : existing

    // recompute new-follow counts on the registry rows from the full event log
    annotateRecentFollows(kols, events)

    const signals = computeSignals(events, universe, {
      windowHours: opts.windowHours || DEFAULT_WINDOW_HOURS,
      minKols: opts.minKols || SURFACE_MIN_KOLS,
    })
    await store.saveSignals(signals)

    _lastSync = Date.now()
    return {
      ok: true,
      kols_synced: targets.length,
      events_emitted: fresh.length,
      signals: signals.length,
      took_ms: Date.now() - started,
    }
  } catch (err) {
    console.error('[kol/engine] runSync error:', err.message)
    return { ok: false, error: err.message }
  } finally {
    _syncing = false
  }
}

// Count each KOL's project-follows in the last 7d and stamp onto the registry rows.
function annotateRecentFollows(kols, events) {
  const cutoff = Date.now() - 7 * 24 * 36e5
  const counts = new Map()
  for (const ev of events) {
    const t = new Date(ev.followed_at).getTime()
    if (isNaN(t) || t < cutoff) continue
    const h = ev.kol.screen_name.toLowerCase()
    counts.set(h, (counts.get(h) || 0) + 1)
  }
  for (const k of kols) {
    k.recent_new_follows_count = counts.get(k.screen_name.toLowerCase()) || 0
  }
}

function lastSyncAt() {
  return _lastSync ? new Date(_lastSync).toISOString() : null
}

export default {
  DEFAULT_WINDOW_HOURS,
  DEFAULT_MIN_KOLS,
  SURFACE_MIN_KOLS,
  runSync,
  snapshotKol,
  computeSignals,
  scoreSignal,
  annotateRecentFollows,
  lastSyncAt,
}
