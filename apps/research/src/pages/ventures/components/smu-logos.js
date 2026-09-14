/**
 * Smart Money Universe — global fund-logo resolver.
 *
 * The old approach put an onError fallback ladder on every <img>: each failing
 * favicon fired a setState, and with ~78 funds rendered across multiple views
 * that meant 100+ requests and a re-render storm on every mount (the source of
 * the lag + layout thrash). This resolves each domain EXACTLY ONCE, globally,
 * caches the winning URL (or null = render initials), and notifies subscribers
 * a single time. Re-mounts and later views read the cache instantly.
 */
import { useEffect, useState } from 'react'

const _resolved = new Map() // domain -> string | null  (final answer)
const _inflight = new Map() // domain -> Promise
const _subs = new Map() // domain -> Set<fn>

// Google's favicon service almost never hard-fails (returns a result for any
// domain), so it goes first to avoid the icon.horse 404 noise; icon.horse is
// the higher-res fallback for the rare miss.
function chain(domain) {
  return [
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    `https://icon.horse/icon/${domain}`,
  ]
}

function loadImage(url, timeout = 4500) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(false); return }
    const img = new Image()
    let done = false
    const finish = (ok) => { if (!done) { done = true; clearTimeout(t); resolve(ok) } }
    const t = setTimeout(() => finish(false), timeout)
    img.onload = () => finish(img.naturalWidth > 1)
    img.onerror = () => finish(false)
    img.src = url
  })
}

async function resolveDomain(domain) {
  for (const url of chain(domain)) {
    // eslint-disable-next-line no-await-in-loop
    if (await loadImage(url)) return url
  }
  return null
}

function ensure(domain, cb) {
  if (!domain) { cb(null); return () => {} }
  if (_resolved.has(domain)) { cb(_resolved.get(domain)); return () => {} }

  if (!_subs.has(domain)) _subs.set(domain, new Set())
  _subs.get(domain).add(cb)

  if (!_inflight.has(domain)) {
    _inflight.set(domain, resolveDomain(domain).then((url) => {
      _resolved.set(domain, url)
      _inflight.delete(domain)
      const subs = _subs.get(domain)
      _subs.delete(domain)
      if (subs) for (const fn of subs) fn(url)
      return url
    }))
  }
  return () => { _subs.get(domain)?.delete(cb) }
}

/**
 * Warm the cache for a batch of domains up front (e.g. when the bubble field
 * mounts) so logos resolve in parallel before each avatar even renders.
 */
export function preloadLogos(domains) {
  for (const d of domains || []) {
    if (d && !_resolved.has(d) && !_inflight.has(d)) ensure(d, () => {})
  }
}

/**
 * Returns the resolved logo URL for a domain, or null once we know there's no
 * usable favicon (caller renders initials), or undefined while still resolving.
 * Each domain resolves once for the whole app — no per-render request storm.
 */
export function useFundLogo(domain) {
  const [url, setUrl] = useState(() => (domain && _resolved.has(domain) ? _resolved.get(domain) : undefined))

  useEffect(() => {
    if (!domain) { setUrl(null); return undefined }
    if (_resolved.has(domain)) { setUrl(_resolved.get(domain)); return undefined }
    setUrl(undefined)
    let active = true
    const unsub = ensure(domain, (v) => { if (active) setUrl(v) })
    return () => { active = false; unsub() }
  }, [domain])

  return url
}
