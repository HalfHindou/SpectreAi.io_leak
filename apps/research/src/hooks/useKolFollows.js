/**
 * useKolFollows — the per-user "My KOLs" follow set.
 *
 * Source of truth: localStorage `spectre-kol-follows` (an array of handles,
 * lowercased, no @). Anonymous users persist locally only. Once authed, the
 * set syncs both ways with the server:
 *   GET  /api/user/kol-follows -> { follows:[handle], updatedAt } (on mount/auth)
 *   PUT  /api/user/kol-follows  body { follows:[handle] }         (debounced 1.2s)
 *
 * Mirrors the useSettingsStore server-sync pattern: a debounced push that only
 * fires when authed, a one-time GET-merge on auth, and a localStorage write
 * on every change so the set survives reloads regardless of auth.
 *
 * Returns an OBJECT (never an array): { follows:Set, followsList, isFollowing,
 *   toggleFollow, follow, unfollow, count, authed, syncing }.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getAuthToken } from '@/services/profileSync'
import { usePrivySafe } from '@/lib/use-privy-safe'

const STORAGE_KEY = 'spectre-kol-follows'
const SEEDED_FLAG = 'spectre-kol-follows-seeded'
const MAX_FOLLOWS = 200
const SYNC_DEBOUNCE = 1200

/* Default follow seed — the big guns every new radar tracks from minute one
   (founder list: Ansem, IncomeSharks, CryptoWizardd + the core S-tier callers
   the desk recognizes). Convergence signals, "My Radar" scope and follow
   alerts all key off the follow set, so an empty set = a dead radar.
   Seeded ONLY when the storage key has never existed on this device — an
   explicit unfollow-all ([]) is respected forever. The SEEDED_FLAG marks the
   set as "untouched default": any manual follow/unfollow clears it, and the
   auth merge lets a user's server-curated set WIN over a pristine seed (never
   force big guns back onto someone who pruned them).
   Every handle below is verified to resolve in the live KOL DB — either via
   the X Dash collector or the registry's own tweets-backend fallback
   (Hsaka / ThreadGuy / gainzy come through the direct lane). gcrclassic
   stays out until the account resolves (protected/dormant). */
export const DEFAULT_FOLLOWS = [
  'blknoiz06',       // Ansem
  'incomesharks',
  'cryptowizardd',
  'pentosh1',
  'hsakatrades',
  'cobie',
  'crediblecrypto',
  'cryptokaleo',
  'inversebrah',
  'theunipcs',
  'notthreadguy',
  'rektcapital',
  'cryptohayes',
  'altcoinsherpa',
  'tradermayne',
  'frankdegods',
  'traderpow',
  'gainzy222',
]

function sanitizeHandle(h) {
  return String(h || '').trim().replace(/^@+/, '').toLowerCase()
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) {
      // first visit on this device — start the radar on the big guns
      const seed = DEFAULT_FOLLOWS.slice(0, MAX_FOLLOWS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
      localStorage.setItem(SEEDED_FLAG, '1')
      return seed
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map(sanitizeHandle).filter(Boolean))].slice(0, MAX_FOLLOWS)
  } catch {
    return []
  }
}

function isPristineSeed() {
  try { return localStorage.getItem(SEEDED_FLAG) === '1' } catch { return false }
}
function clearSeededFlag() {
  try { localStorage.removeItem(SEEDED_FLAG) } catch { /* best-effort */ }
}

function writeLocal(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* quota / private mode — local persistence best-effort */
  }
}

export function useKolFollows() {
  const [follows, setFollows] = useState(() => readLocal())
  const [syncing, setSyncing] = useState(false)
  // usePrivySafe returns a stub (authenticated:false) until the real provider
  // mounts, so reading `authenticated` here never crashes pre-hydration.
  const authed = Boolean(usePrivySafe()?.authenticated)

  const followsRef = useRef(follows)
  followsRef.current = follows
  const syncTimer = useRef(null)
  const mergedOnce = useRef(false)

  /* One-time GET-merge when the user becomes authed: union the server set with
     whatever the anon session already followed locally, so a sign-in never
     drops a locally-added KOL. */
  useEffect(() => {
    if (!authed || mergedOnce.current) return
    const token = getAuthToken()
    if (!token) return
    mergedOnce.current = true
    let cancelled = false
    setSyncing(true)
    fetch('/api/user/kol-follows', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        const serverList = Array.isArray(body.follows)
          ? body.follows.map(sanitizeHandle).filter(Boolean)
          : []
        // A user with a server-curated set signing in on a fresh device: the
        // local set is only the untouched default seed — the server list wins
        // outright (unioning would force pruned big guns back onto them).
        if (serverList.length && isPristineSeed()) {
          const adopted = serverList.slice(0, MAX_FOLLOWS)
          setFollows(adopted)
          writeLocal(adopted)
          clearSeededFlag()
          return
        }
        const union = [...new Set([...followsRef.current, ...serverList])].slice(0, MAX_FOLLOWS)
        setFollows(union)
        writeLocal(union)
        // Push the merged union straight back so the server adopts any local-only
        // adds from the anon session.
        if (union.length !== serverList.length) {
          fetch('/api/user/kol-follows', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ follows: union }),
          }).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSyncing(false) })
    return () => { cancelled = true }
  }, [authed])

  /* Debounced PUT on every change, only when authed. The localStorage write is
     synchronous in the mutators below, so the set is never lost on reload. */
  const scheduleSync = useCallback((nextList) => {
    if (!authed) return
    const token = getAuthToken()
    if (!token) return
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      setSyncing(true)
      fetch('/api/user/kol-follows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ follows: nextList }),
      })
        .catch(() => {})
        .finally(() => setSyncing(false))
    }, SYNC_DEBOUNCE)
  }, [authed])

  useEffect(() => () => clearTimeout(syncTimer.current), [])

  const apply = useCallback((nextList) => {
    const clean = [...new Set(nextList.map(sanitizeHandle).filter(Boolean))].slice(0, MAX_FOLLOWS)
    // any manual mutation = the set is user-curated now, not a pristine seed
    clearSeededFlag()
    setFollows(clean)
    writeLocal(clean)
    scheduleSync(clean)
  }, [scheduleSync])

  const follow = useCallback((handle) => {
    const h = sanitizeHandle(handle)
    if (!h) return
    const current = followsRef.current
    if (current.includes(h)) return
    apply([h, ...current])
  }, [apply])

  /* Batch follow — the "follow the big guns" one-click pack. */
  const followMany = useCallback((handles) => {
    const current = followsRef.current
    const add = (handles || []).map(sanitizeHandle).filter((h) => h && !current.includes(h))
    if (!add.length) return
    apply([...add, ...current])
  }, [apply])

  const unfollow = useCallback((handle) => {
    const h = sanitizeHandle(handle)
    if (!h) return
    apply(followsRef.current.filter((x) => x !== h))
  }, [apply])

  const toggleFollow = useCallback((handle) => {
    const h = sanitizeHandle(handle)
    if (!h) return
    if (followsRef.current.includes(h)) unfollow(h)
    else follow(h)
  }, [follow, unfollow])

  const followSet = useMemo(() => new Set(follows), [follows])
  const isFollowing = useCallback((handle) => followSet.has(sanitizeHandle(handle)), [followSet])

  return {
    follows: followSet,
    followsList: follows,
    count: follows.length,
    isFollowing,
    toggleFollow,
    follow,
    followMany,
    unfollow,
    authed,
    syncing,
  }
}

export default useKolFollows
