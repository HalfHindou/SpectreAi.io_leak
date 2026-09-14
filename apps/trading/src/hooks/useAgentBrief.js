/**
 * useAgentBrief - fetches the server-generated opening brief ("Jarvis
 * mode") for the open token: GET /api/agent/brief, KV-cached server-side
 * per token so the cost amortizes across all users. Client side keeps a
 * module cache + sessionStorage seed (TrendingHub brief pattern) so
 * revisits paint instantly, and polls the pending contract with backoff
 * when another instance is mid-generation.
 *
 * Mount-gated like the other agent hooks: lives in the open panel/sheet,
 * so a closed panel costs nothing. Auth rides the existing tiers - the
 * spectre-gate cookie (same-origin), the Privy JWT is NOT needed for this
 * read, and the research-iframe embed presents its x-demo-token header.
 */
import { useEffect, useRef, useState } from 'react'
import { getDemoToken } from '../services/demoSession'
import { track, Events } from '../services/analytics'

const SS_KEY = 'spectre-agent-brief-v1'
const FRESH_MS = 15 * 60 * 1000
const MAX_PENDING_POLLS = 8

const _cache = new Map() // key -> brief doc (carries meta.generatedAt)
const _shownHashes = new Set() // briefHash -> AGENT_BRIEF_SHOWN already fired

function trackShown(doc, surface, token) {
  const h = doc?.meta?.briefHash
  if (!h || _shownHashes.has(h)) return
  _shownHashes.add(h)
  track(Events.AGENT_BRIEF_SHOWN, {
    surface,
    symbol: token?.symbol,
    chain: token?.networkId,
    stance: doc?.verdict?.stance,
    provider: doc?.meta?.provider,
    sections: doc?.sections?.length || 0,
  })
}

function loadSeed() {
  if (_cache.size) return
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) _cache.set(k, v)
  } catch { /* ignore */ }
}

function persistSeed() {
  try {
    const entries = [..._cache.entries()]
      .sort((a, b) => (b[1]?.meta?.generatedAt || 0) - (a[1]?.meta?.generatedAt || 0))
      .slice(0, 8)
    sessionStorage.setItem(SS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* quota */ }
}

const briefKeyFor = (token) => `${String(token?.address || '').toLowerCase()}:${token?.networkId}`
const isFresh = (doc) => doc?.meta?.generatedAt && Date.now() - doc.meta.generatedAt < FRESH_MS

/* ── Auto-open session guard - once per token per browser session, shared
      by the desktop launcher and the mobile page. Closing the panel on a
      token means it stays closed for that token until the session ends. ── */
const AO_KEY = 'spectre-agent-autoopen-v1'
let _autoOpened = null
function autoOpenedSet() {
  if (_autoOpened) return _autoOpened
  _autoOpened = new Set()
  try {
    const raw = sessionStorage.getItem(AO_KEY)
    if (raw) for (const k of JSON.parse(raw)) _autoOpened.add(k)
  } catch { /* ignore */ }
  return _autoOpened
}

export function hasAutoOpened(token) {
  return autoOpenedSet().has(briefKeyFor(token))
}

/* ── Per-session visit counter - feeds the salutation's dry returning
      variants ("Back to TEMPO." / "TEMPO again."). Session-scoped like the
      auto-open guard. ── */
const VISITS_KEY = 'spectre-agent-visits-v1'
let _visits = null
function visitsMap() {
  if (_visits) return _visits
  _visits = new Map()
  try {
    const raw = sessionStorage.getItem(VISITS_KEY)
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) _visits.set(k, v)
  } catch { /* ignore */ }
  return _visits
}

export function bumpVisit(token) {
  const map = visitsMap()
  const k = briefKeyFor(token)
  const cur = map.get(k) || { count: 0, ts: 0 }
  // Effect re-runs for the same arrival (deep-link placeholder resolving)
  // must not double-count a single visit.
  if (Date.now() - cur.ts < 30_000) return cur.count
  const next = { count: cur.count + 1, ts: Date.now() }
  map.set(k, next)
  try {
    sessionStorage.setItem(VISITS_KEY, JSON.stringify(Object.fromEntries([...map.entries()].slice(-40))))
  } catch { /* quota */ }
  return next.count
}

export function getVisitCount(token) {
  const v = visitsMap().get(briefKeyFor(token))
  return (v && v.count) || 1
}

export function markAutoOpened(token) {
  const set = autoOpenedSet()
  set.add(briefKeyFor(token))
  try { sessionStorage.setItem(AO_KEY, JSON.stringify([...set].slice(-40))) } catch { /* quota */ }
}

export function useAgentBrief(token, { surface = 'desktop', enabled = true } = {}) {
  const key = briefKeyFor(token)
  const isPlaceholder = !token?.address || token?.symbol === '...'

  const [state, setState] = useState(() => {
    loadSeed()
    const doc = _cache.get(key)
    return { brief: doc || null, loading: false, error: null }
  })

  const keyRef = useRef(key)

  useEffect(() => {
    keyRef.current = key
    if (!enabled || isPlaceholder) { setState({ brief: null, loading: false, error: null }) ; return undefined }

    loadSeed()
    const cached = _cache.get(key)
    if (cached && isFresh(cached)) {
      setState({ brief: cached, loading: false, error: null })
      trackShown(cached, surface, token)
      return undefined
    }
    // Stale seed paints immediately while the request revalidates behind it.
    setState({ brief: cached || null, loading: true, error: null })

    let cancelled = false
    let timer = 0
    let polls = 0

    const params = new URLSearchParams({
      address: token.address,
      networkId: String(token.networkId),
      symbol: token.symbol || '',
      name: token.name || '',
    })
    if (token.cgId) params.set('cgId', token.cgId)

    const headers = {}
    if (surface === 'embed') {
      const demo = getDemoToken()
      if (demo) headers['x-demo-token'] = demo
    }

    const run = async () => {
      try {
        // Cold generation runs inline server-side (gather + one LLM call) -
        // give it the same headroom as an agent chat turn.
        const res = await fetch(`/api/agent/brief?${params}`, { headers, signal: AbortSignal.timeout(45_000) })
        if (cancelled || keyRef.current !== key) return
        if (!res.ok) throw new Error(`brief ${res.status}`)
        const doc = await res.json()
        if (cancelled || keyRef.current !== key) return
        if (doc?.pending) {
          if (polls++ < MAX_PENDING_POLLS) {
            timer = setTimeout(run, Math.min(2500 + polls * 1000, 8000))
          } else {
            setState((s) => ({ ...s, loading: false, error: 'timeout' }))
          }
          return
        }
        if (doc?.verdict) {
          _cache.set(key, doc)
          persistSeed()
          setState({ brief: doc, loading: false, error: null })
          trackShown(doc, surface, token)
        } else {
          setState((s) => ({ ...s, loading: false, error: doc?.error || 'empty' }))
        }
      } catch (e) {
        if (cancelled || keyRef.current !== key) return
        // A stale seed beats an error card.
        setState((s) => ({ ...s, loading: false, error: s.brief ? null : (e.message || 'failed') }))
      }
    }
    run()

    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, isPlaceholder, surface])

  return state
}

/** Compact carry of the brief into the chat digest so follow-up questions
    know what the user was just told (mirror of agent-brief.briefForDigest). */
export function briefForDigest(doc) {
  if (!doc || !doc.verdict) return null
  return {
    stance: doc.verdict.stance,
    line: doc.verdict.line,
    sections: (doc.sections || []).slice(0, 6).map((s) => `${s.id}: ${s.text}`.slice(0, 200)),
  }
}
