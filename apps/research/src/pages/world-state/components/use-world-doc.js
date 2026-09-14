/**
 * useWorldDoc — the World State document reader.
 *
 * This is NOT pages/brain/components/use-brain-world.js and must not become
 * it. That hook null-wipes the doc whenever a poll fails, which is correct for
 * a strip that renders nothing when it has nothing. This page is a briefing
 * wall: a failed poll must never blank a wall of real numbers. So:
 *
 *   - KEEP LAST GOOD. A failed poll leaves the doc exactly where it was and
 *     raises `stale`; the masthead stamps it. Data only ever changes on a
 *     success.
 *   - 404 IS NOT AN ERROR. The worker publishes on its own cycle; before the
 *     first publish the endpoint 404s. With no doc ever seen that is `empty`
 *     (the cold state), not a failure. brainGet flattens both to null, and the
 *     distinction we actually need — "have we ever had a document?" — is the
 *     one we can answer locally.
 *   - VERSION CHANGE IS THE PAGE'S LIVENESS. On a new version we record the
 *     previous version, the moment we saw it, and WHICH top-level doc sections
 *     actually differ, so only genuinely changed bands mark themselves. The
 *     mark expires on a single 30s timeout — there is no interval and no idle
 *     animation anywhere on a settled screen.
 *
 * The `editions` list is a first-hand session record: every version this tab
 * has personally observed. It is never back-filled or inferred. The server's
 * ?history parameter is requested for the changelog and honoured if it ever
 * returns rows; today it is accepted and ignored (verified 2026-08-13), which
 * the changelog states in words rather than hiding.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { brainGet } from '@/pages/brain/components/brain-fetch'

const URL_BASE = '/data-api/v1/brain/world'
const POLL_MS = 5 * 60_000
const HISTORY_TTL_MS = 15 * 60_000
const CHANGED_WINDOW_MS = 30_000
const MAX_EDITIONS = 12

/** Sections of the doc whose contents differ between two editions. */
function changedSections(prev, next) {
  if (!prev || !next) return []
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const out = []
  for (const k of keys) {
    try {
      if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) out.push(k)
    } catch {
      out.push(k)
    }
  }
  return out
}

const readDoc = (d) => (d?.doc && typeof d.doc === 'object' && !Array.isArray(d.doc) ? d.doc : null)
const readVersion = (d) => (Number.isFinite(Number(d?.version)) ? Number(d.version) : null)

/** The server may name a revision list any of these; none exist today. */
function readHistory(d) {
  for (const k of ['history', 'revisions', 'editions', 'versions']) {
    const v = d?.[k]
    if (Array.isArray(v) && v.length) return v
  }
  return null
}

const INITIAL = {
  loading: true,
  doc: null,
  version: null,
  ts: null,
  diff: null,
  stale: false,
  lastOkAt: null,
  prevVersion: null,
  changedAt: null,
  changedSections: [],
  empty: false,
  editions: [],
}

export default function useWorldDoc() {
  const [state, setState] = useState(INITIAL)
  const [history, setHistory] = useState({ state: 'idle', rows: null, at: 0 })

  const cancelled = useRef(false)
  const lastSeen = useRef({ version: null, doc: null })
  const prevDoc = useRef(null)
  const markTimer = useRef(null)

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const d = await brainGet(URL_BASE)
    if (cancelled.current) return

    const doc = readDoc(d)
    const version = readVersion(d)

    // Failed / empty read: never destroys a good document.
    if (!doc) {
      setState((s) => ({
        ...s,
        loading: false,
        stale: s.doc != null,
        empty: s.doc == null,
      }))
      return
    }

    /* Version comparison happens HERE, not inside the setState updater — an
       updater must stay pure (StrictMode invokes it twice, which would double
       -record an edition and corrupt the previous-doc reference). */
    const seen = lastSeen.current
    const isNewVersion = seen.version != null && version != null && version !== seen.version
    const sections = isNewVersion ? changedSections(seen.doc, doc) : []
    const seenAt = Date.now()
    prevDoc.current = isNewVersion ? seen.doc : prevDoc.current
    lastSeen.current = { version, doc }

    const edition = {
      version,
      ts: typeof d?.ts === 'string' ? d.ts : null,
      diff: typeof d?.diff === 'string' && d.diff.trim() ? d.diff.trim() : null,
      seenAt,
    }

    setState((s) => ({
      loading: false,
      doc,
      version,
      ts: edition.ts,
      diff: edition.diff,
      stale: false,
      lastOkAt: seenAt,
      prevVersion: isNewVersion ? seen.version : s.prevVersion,
      changedAt: isNewVersion ? seenAt : null,
      changedSections: sections,
      empty: false,
      editions: [edition, ...s.editions.filter((e) => e.version !== version)].slice(0, MAX_EDITIONS),
    }))
  }, [])

  /* Clear the change marks with ONE timeout — no interval, nothing idle. */
  useEffect(() => {
    if (!state.changedAt) return undefined
    clearTimeout(markTimer.current)
    markTimer.current = setTimeout(() => {
      setState((s) => (s.changedAt ? { ...s, changedAt: null, changedSections: [] } : s))
    }, CHANGED_WINDOW_MS)
    return () => clearTimeout(markTimer.current)
  }, [state.changedAt])

  useEffect(() => {
    cancelled.current = false
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled.current = true
      clearInterval(timer)
      clearTimeout(markTimer.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  /* Changelog: fetched on first expand, then at most every 15 minutes. */
  const loadHistory = useCallback(async () => {
    const fresh = history.rows != null && Date.now() - history.at < HISTORY_TTL_MS
    if (history.state === 'loading' || fresh) return
    setHistory((h) => ({ ...h, state: 'loading' }))
    const d = await brainGet(`${URL_BASE}?history=${MAX_EDITIONS}`)
    if (cancelled.current) return
    const rows = readHistory(d)
    setHistory({ state: rows ? 'ready' : 'absent', rows, at: Date.now() })
  }, [history.state, history.rows, history.at])

  return {
    ...state,
    prevDoc: prevDoc.current,
    history: history.rows,
    historyState: history.state,
    loadHistory,
    refetch: load,
    pollMinutes: POLL_MS / 60_000,
    endpoint: URL_BASE,
  }
}
