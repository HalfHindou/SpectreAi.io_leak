/**
 * useXProfile — shared cached fetch for an X (Twitter) profile.
 *
 * Hits the same Alaa-backed endpoint the X-Intelligence hero already
 * uses: `/api/tweets/official?username={handle}`. The response carries
 * an `author` object with `profile_banner_url`, `avatar_image_url`,
 * `description`, `counts`, and `account_state`.
 *
 * Why a separate hook (and not piggyback on LeftPanel's tweet fetch):
 *   - LeftPanel only fires when the AI Logs / X tab is rendered.
 *   - TokenIdentityCard needs the banner the moment the right rail
 *     mounts, regardless of which left-panel tab is active.
 *
 * Dedup strategy mirrors useDossier:
 *   - Module-level cache keyed by lowercased handle (5 min TTL,
 *     matching the serverless function's own cache).
 *   - In-flight Promise map prevents N parallel calls when multiple
 *     consumers mount with the same handle.
 *   - Subscriber Set pushes fresh data to every mounted consumer the
 *     moment the request resolves.
 *
 * Safe-degrade: if the API returns 401/502/empty, the hook returns
 * `{ author: null }` and the caller's procedural fallback kicks in.
 */

import { useEffect, useState } from 'react'

const TTL = 5 * 60 * 1000  // matches /api/tweets/official serverless cache

const _cache = new Map()        // key -> { data, ts }        (author slice)
const _inflight = new Map()     // key -> Promise             (author slice)
const _subs = new Map()         // key -> Set<setData>

// Full-body /api/tweets/official cache shared across EVERY consumer
// (this hook, LeftPanel's tweet feed, the RT-author resolver). Keys are
// lowercased handles so `Spectre__AI` and `spectre__ai` collapse to ONE
// request - the measured token-page case-dup fired the same endpoint twice.
const _feedCache = new Map()    // key -> { data, ts }        (full JSON body)
const _feedInflight = new Map() // key -> Promise

function notify(key, data) {
  const subs = _subs.get(key)
  if (!subs) return
  for (const setter of subs) setter(data)
}

/** Extract a clean handle ("spectre__ai") from various inputs. */
export function extractXHandle(input) {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  // Full URL: twitter.com/handle or x.com/handle, possibly with /status/...
  const urlMatch = trimmed.match(/(?:twitter\.com|x\.com)\/(@?)([A-Za-z0-9_]{1,30})/i)
  if (urlMatch) return urlMatch[2].toLowerCase()
  // Bare @handle or handle (alphanumeric + underscores, max 30 chars)
  const bare = trimmed.replace(/^@/, '').match(/^[A-Za-z0-9_]{1,30}$/)
  return bare ? bare[0].toLowerCase() : null
}

/** Upgrade Twitter avatar from `_normal` (48px) to `_400x400`. */
export function upgradeAvatar(url) {
  if (!url || typeof url !== 'string') return url || null
  return url.replace(/_normal\.(jpg|png|jpeg|webp|gif)/i, '_400x400.$1')
}

/**
 * Shared fetch for the FULL /api/tweets/official body ({ tweets, author, ... }).
 * Lowercased-handle cache key + inflight dedup + 5min TTL, so concurrent
 * consumers (tweet feed, profile hook, RT-author resolver) share one request
 * per handle regardless of the caller's casing. Returns parsed JSON or null;
 * nulls are never cached (transient upstream failures retry next call).
 */
export async function fetchOfficialFeed(handleOrUrl) {
  const handle = extractXHandle(handleOrUrl)
  if (!handle) return null
  const cached = _feedCache.get(handle)
  if (cached && Date.now() - cached.ts < TTL) return cached.data
  const existing = _feedInflight.get(handle)
  if (existing) return existing
  const promise = (async () => {
    try {
      const r = await fetch(
        `/api/tweets/official?username=${encodeURIComponent(handle)}`,
        { signal: AbortSignal.timeout(15000) }
      )
      if (!r.ok) return null
      const data = await r.json()
      _feedCache.set(handle, { data, ts: Date.now() })
      return data
    } catch {
      return null
    } finally {
      _feedInflight.delete(handle)
    }
  })()
  _feedInflight.set(handle, promise)
  return promise
}

/**
 * Author-only fetch: everything that needs an avatar, a display name or a
 * verified badge (this hook's consumers + LeftPanel's RT-author resolver)
 * reads ~1KB of `author` and throws away the ~40KB timeline that used to ship
 * with it. `author_only=1` returns just the author, so a token page stops
 * pulling ~760KB across ~19 handles to draw check marks.
 *
 * Reuses the full-body cache when one is already warm - no point issuing a
 * request for a slice we are holding - and never writes into it, since a slim
 * body has no `tweets` and would starve the feed consumers.
 */
export async function fetchAuthorProfile(handleOrUrl) {
  const handle = extractXHandle(handleOrUrl)
  if (!handle) return null
  const cached = _cache.get(handle)
  if (cached && Date.now() - cached.ts < TTL) return cached.data
  const warmFeed = _feedCache.get(handle)
  if (warmFeed && Date.now() - warmFeed.ts < TTL) {
    const author = warmFeed.data?.author || null
    _cache.set(handle, { data: author, ts: Date.now() })
    return author
  }
  const existing = _inflight.get(handle)
  if (existing) return existing
  // A full-body request for this handle is already in the air (the project's
  // own feed and its profile card mount together). Ride it rather than opening
  // a second connection for a slice it is about to deliver.
  const pendingFeed = _feedInflight.get(handle)
  if (pendingFeed) {
    return pendingFeed.then((data) => {
      const author = data?.author || null
      if (author) _cache.set(handle, { data: author, ts: Date.now() })
      return author
    })
  }
  const promise = (async () => {
    try {
      const r = await fetch(
        `/api/tweets/official?username=${encodeURIComponent(handle)}&author_only=1`,
        { signal: AbortSignal.timeout(15000) }
      )
      if (!r.ok) return null
      const data = await r.json()
      const author = data?.author || null
      _cache.set(handle, { data: author, ts: Date.now() })
      notify(handle, author)
      return author
    } catch {
      return null
    } finally {
      _inflight.delete(handle)
    }
  })()
  _inflight.set(handle, promise)
  return promise
}

async function fetchProfile(handle) {
  return fetchAuthorProfile(handle)
}

/**
 * Returns `{ author, loading, banner, avatar }` for the given X handle.
 * Accepts a handle, "@handle", or a full x.com / twitter.com URL.
 * Returns `{ author: null }` when no handle, on error, or while pending.
 */
export default function useXProfile(handleOrUrl) {
  const handle = extractXHandle(handleOrUrl)
  const [author, setAuthor] = useState(() => {
    if (!handle) return null
    const cached = _cache.get(handle)
    return cached?.data || null
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!handle) { setAuthor(null); setLoading(false); return }

    let subs = _subs.get(handle)
    if (!subs) { subs = new Set(); _subs.set(handle, subs) }
    subs.add(setAuthor)

    const cached = _cache.get(handle)
    if (cached?.data) setAuthor(cached.data)

    let cancelled = false
    const needsFetch = !cached || Date.now() - cached.ts > TTL
    if (needsFetch) {
      setLoading(true)
      fetchProfile(handle).finally(() => {
        if (!cancelled) setLoading(false)
      })
    }
    return () => {
      cancelled = true
      subs.delete(setAuthor)
      if (subs.size === 0) _subs.delete(handle)
    }
  }, [handle])

  return {
    author,
    loading,
    handle,
    banner: author?.profile_banner_url || null,
    avatar: upgradeAvatar(author?.avatar_image_url),
  }
}
