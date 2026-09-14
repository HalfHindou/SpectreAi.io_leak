/**
 * Extra per-user data sync: media library + Research Zone personal data.
 *
 * Lazily imported by ProfileSyncInit (App.jsx) AFTER Privy auth lands and the
 * profile token is set, so fetch/push always have a token. Anonymous users
 * never load this module - pure-localStorage behavior is unchanged for them.
 *
 * Contract (mirrors WatchlistsContext):
 *  - hydrate once per login: pull server copy, merge into local, seed-push the
 *    merged result so the other device converges too
 *  - pushes are gated until that first hydrate succeeds - a failed fetch means
 *    NO pushes this session, so a local-only payload can never clobber the
 *    server copy another device wrote
 *  - debounced push on change + keepalive flush on pagehide/hidden
 */

import useMediaStore from '@/store/useMediaStore'
import { fetchUserBlob, pushUserBlob } from '@/services/profileSync'
import {
  RZ_SYNC_EVENT, getRzSyncMeta, setRzSyncMeta,
} from '@/services/rzLocalStorage'

let _inited = false

/* ── shared helpers ─────────────────────────────────────────────────────── */

// Union-by-id merge: items on one side only are kept, a shared id resolves to
// the newer timestamp. Deletions don't propagate (a removed item can come back
// from the other device until removed there too) - the acceptable v1 tradeoff
// for never losing a save.
const mergeById = (localArr, serverArr, tsOf, cap) => {
  const byId = new Map()
  for (const it of (Array.isArray(serverArr) ? serverArr : [])) {
    if (it && it.id != null) byId.set(it.id, it)
  }
  for (const it of (Array.isArray(localArr) ? localArr : [])) {
    if (!it || it.id == null) continue
    const sv = byId.get(it.id)
    if (!sv || (tsOf(it) || 0) >= (tsOf(sv) || 0)) byId.set(it.id, it)
  }
  return Array.from(byId.values())
    .sort((a, b) => (tsOf(b) || 0) - (tsOf(a) || 0))
    .slice(0, cap)
}

/* ── media library ──────────────────────────────────────────────────────── */
// Synced: saved items, watch history, playlists, podcast resume positions and
// the scalar playback prefs. Deliberately NOT synced: queue/queueIndex and
// volume - those are this-device, this-session state.

const MEDIA_SYNC_KEYS = [
  'savedItems', 'recentlyWatched', 'playlists', 'podcastResume',
  'podcastRate', 'podcastCaptionsOn', 'autoPlay',
]
// Trailing throttle, NOT a resetting debounce: the podcast player saves its
// resume position every ~8s while playing, so a debounce that resets on every
// change would either never fire (starvation) or hammer the profile KV. One
// push at most per window; the pagehide flush covers the tail.
const MEDIA_PUSH_WINDOW = 20_000

let mediaHydrated = false
let mediaTimer = null

const collectMedia = () => {
  const s = useMediaStore.getState()
  return {
    savedItems: (s.savedItems || []).slice(0, 300),
    recentlyWatched: (s.recentlyWatched || []).slice(0, 50),
    playlists: (s.playlists || []).slice(0, 50),
    podcastResume: s.podcastResume || {},
    podcastRate: s.podcastRate,
    podcastCaptionsOn: s.podcastCaptionsOn,
    autoPlay: s.autoPlay,
  }
}

const schedulePushMedia = () => {
  if (!mediaHydrated || mediaTimer) return
  mediaTimer = setTimeout(() => {
    mediaTimer = null
    pushUserBlob('media', { media: collectMedia() }).catch(() => {})
  }, MEDIA_PUSH_WINDOW)
}

const applyServerMedia = (server) => {
  if (!server || typeof server !== 'object') return
  const s = useMediaStore.getState()
  const merged = {
    savedItems: mergeById(s.savedItems, server.savedItems, (x) => x.savedAt, 300),
    recentlyWatched: mergeById(s.recentlyWatched, server.recentlyWatched, (x) => x.watchedAt, 50),
    // Playlists carry no edit timestamp - a shared id keeps the LOCAL copy
    // (the user is looking at it), one-sided playlists are kept.
    playlists: mergeById(s.playlists, server.playlists, (x) => x.createdAt, 50),
    podcastResume: (() => {
      const out = { ...(server.podcastResume && typeof server.podcastResume === 'object' ? server.podcastResume : {}) }
      for (const [id, v] of Object.entries(s.podcastResume || {})) {
        if (!out[id] || (v?.at || 0) >= (out[id]?.at || 0)) out[id] = v
      }
      return out
    })(),
  }
  if (Number.isFinite(server.podcastRate)) merged.podcastRate = server.podcastRate
  if (typeof server.podcastCaptionsOn === 'boolean') merged.podcastCaptionsOn = server.podcastCaptionsOn
  if (typeof server.autoPlay === 'boolean') merged.autoPlay = server.autoPlay
  useMediaStore.setState(merged)
}

const hydrateMedia = async () => {
  const data = await fetchUserBlob('media')
  if (!data) return // fetch failed -> pushes stay gated this session
  if (data.media) applyServerMedia(data.media)
  mediaHydrated = true
  schedulePushMedia() // seed-push the merge so the other device converges
}

/* ── Research Zone personal data ────────────────────────────────────────── */
// Four families keyed per symbol: notes (annotations), what-if inputs, chart
// setups, hand-drawn TA lines. Merge is LWW per slot using the write stamps
// rzLocalStorage keeps (`spectre-rz-sync-meta`); slots present on one side
// only are kept. Pre-sync data (no stamp on either side) merges notes by id
// and keeps the local copy for the rest.

const RZ_PREFIXES = {
  ann: 'spectre-rz-annotations:',
  whatif: 'spectre-rz-whatif:',
  draw: 'spectre-rz-ta-draw:v1:',
}
const RZ_SETUPS_KEY = 'spectre-rz-chart-setups'
const RZ_PUSH_DEBOUNCE = 5000
const RZ_MAX_SYMBOLS = 150

let rzHydrated = false
let rzTimer = null

const readLs = (key) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}
const writeLs = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* quota */ }
}
const removeLs = (key) => {
  try { localStorage.removeItem(key) } catch { /* storage unavailable */ }
}

const collectRz = () => {
  const out = { annotations: {}, whatif: {}, taDraw: {}, chartSetups: {}, meta: getRzSyncMeta() }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith(RZ_PREFIXES.ann)) {
        const v = readLs(key)
        if (Array.isArray(v) && v.length) out.annotations[key.slice(RZ_PREFIXES.ann.length)] = v.slice(0, 100)
      } else if (key.startsWith(RZ_PREFIXES.whatif)) {
        const v = readLs(key)
        if (v) out.whatif[key.slice(RZ_PREFIXES.whatif.length)] = v
      } else if (key.startsWith(RZ_PREFIXES.draw)) {
        const v = readLs(key)
        if (Array.isArray(v) && v.length) out.taDraw[key.slice(RZ_PREFIXES.draw.length)] = v.slice(0, 40)
      }
    }
  } catch { /* storage unavailable */ }
  const setups = readLs(RZ_SETUPS_KEY)
  if (setups && typeof setups === 'object' && !Array.isArray(setups)) out.chartSetups = setups
  // Cap per family by keeping the most recently stamped symbols.
  for (const fam of ['annotations', 'whatif', 'taDraw']) {
    const slotPrefix = fam === 'annotations' ? 'ann' : fam === 'whatif' ? 'whatif' : 'draw'
    const syms = Object.keys(out[fam])
    if (syms.length > RZ_MAX_SYMBOLS) {
      syms.sort((a, b) => (out.meta[`${slotPrefix}:${b}`] || 0) - (out.meta[`${slotPrefix}:${a}`] || 0))
        .slice(RZ_MAX_SYMBOLS)
        .forEach((sym) => { delete out[fam][sym] })
    }
  }
  return out
}

// Per-symbol LWW for one family. Writes winners into localStorage, returns the
// merged map + updated meta stamps.
const mergeRzFamily = (fam, slotPrefix, local, server, localMeta, serverMeta, outMeta) => {
  const merged = {}
  const syms = new Set([
    ...Object.keys(local || {}), ...Object.keys(server || {}),
    // Slots whose DATA is gone but whose stamp survives are deletions - walk
    // them too so "removed all notes for X" propagates instead of the other
    // side's copy resurrecting on every hydrate.
    ...Object.keys(localMeta).filter((s) => s.startsWith(`${slotPrefix}:`)).map((s) => s.slice(slotPrefix.length + 1)),
    ...Object.keys(serverMeta).filter((s) => s.startsWith(`${slotPrefix}:`)).map((s) => s.slice(slotPrefix.length + 1)),
  ])
  for (const sym of syms) {
    const slot = `${slotPrefix}:${sym}`
    const lv = local?.[sym]
    const sv = server?.[sym]
    const lts = localMeta[slot] || 0
    const sts = serverMeta[slot] || 0
    let winner
    if (lv == null && sv == null) winner = null // deleted everywhere
    else if (lv == null) winner = lts > sts ? null : sv // local deletion newer -> stays deleted
    else if (sv == null) winner = sts > lts ? null : lv // server-side deletion newer -> delete here too
    else if (lts === 0 && sts === 0 && fam === 'annotations') {
      // Pre-sync notes on both sides: union by id so neither device's notes vanish.
      winner = mergeById(lv, sv, (x) => x.ts || x.createdAt, 100)
    } else if (lts === 0 && sts === 0 && fam === 'taDraw') {
      // Pre-sync drawings on both sides: keep BOTH sets of lines (each device
      // drew its own), newest-last, capped like the writer caps.
      winner = [...sv, ...lv].slice(-40)
    } else if (sts > lts) winner = sv
    else winner = lv
    outMeta[slot] = Math.max(lts, sts) || Date.now()
    if (winner == null) {
      if (lv != null) removeLs(`${RZ_PREFIXES[slotPrefix]}${sym}`)
      continue
    }
    merged[sym] = winner
    if (winner !== lv) writeLs(`${RZ_PREFIXES[slotPrefix]}${sym}`, winner)
  }
  return merged
}

const applyAndMergeRz = (server) => {
  const local = collectRz()
  const serverMeta = server?.meta && typeof server.meta === 'object' ? server.meta : {}
  const outMeta = {}
  const merged = {
    annotations: mergeRzFamily('annotations', 'ann', local.annotations, server?.annotations, local.meta, serverMeta, outMeta),
    whatif: mergeRzFamily('whatif', 'whatif', local.whatif, server?.whatif, local.meta, serverMeta, outMeta),
    taDraw: mergeRzFamily('taDraw', 'draw', local.taDraw, server?.taDraw, local.meta, serverMeta, outMeta),
    // Chart setups carry their own per-symbol `.at` stamp - plain LWW.
    chartSetups: (() => {
      const out = { ...(server?.chartSetups && typeof server.chartSetups === 'object' ? server.chartSetups : {}) }
      for (const [sym, v] of Object.entries(local.chartSetups || {})) {
        if (!out[sym] || (v?.at || 0) >= (out[sym]?.at || 0)) out[sym] = v
      }
      writeLs(RZ_SETUPS_KEY, out)
      return out
    })(),
    meta: outMeta,
  }
  setRzSyncMeta(outMeta)
  return merged
}

// Same trailing-throttle shape as media: a drawing session or note-typing
// burst collapses into one push per window instead of resetting forever.
const schedulePushRz = () => {
  if (!rzHydrated || rzTimer) return
  rzTimer = setTimeout(() => {
    rzTimer = null
    pushUserBlob('rz-personal', { rz: collectRz() }).catch(() => {})
  }, RZ_PUSH_DEBOUNCE)
}

const hydrateRz = async () => {
  const data = await fetchUserBlob('rz-personal')
  if (!data) return // fetch failed -> pushes stay gated
  const merged = applyAndMergeRz(data.rz || null)
  rzHydrated = true
  // Seed-push the merged result so a device whose notes the server didn't
  // have still uploads them for the other device.
  pushUserBlob('rz-personal', { rz: merged }).catch(() => {})
}

/* ── init ───────────────────────────────────────────────────────────────── */

export function initExtraUserSync() {
  if (_inited || typeof window === 'undefined') return
  _inited = true

  hydrateMedia().catch(() => {})
  hydrateRz().catch(() => {})

  // Media: any synced-key change schedules a debounced push.
  useMediaStore.subscribe((state, prev) => {
    if (!mediaHydrated) return
    if (MEDIA_SYNC_KEYS.some((k) => state[k] !== prev[k])) schedulePushMedia()
  })

  // RZ: every stamped local write raises this event.
  window.addEventListener(RZ_SYNC_EVENT, schedulePushRz)

  // Flush pending pushes when the tab hides/closes (keepalive survives it).
  const flush = () => {
    if (mediaTimer) {
      clearTimeout(mediaTimer); mediaTimer = null
      pushUserBlob('media', { media: collectMedia() }, { keepalive: true }).catch(() => {})
    }
    if (rzTimer) {
      clearTimeout(rzTimer); rzTimer = null
      pushUserBlob('rz-personal', { rz: collectRz() }, { keepalive: true }).catch(() => {})
    }
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
