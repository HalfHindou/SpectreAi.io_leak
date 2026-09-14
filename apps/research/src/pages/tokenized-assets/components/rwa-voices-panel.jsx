import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { normalizeXDashDetail } from '@/pages/x-dash/components/x-dash-utils'
import './rwa-voices-panel.css'

/**
 * RwaVoicesPanel — right-edge slide-out of what BIG accounts are saying about
 * tokenized assets. Sits beside the board instead of below it, so the read and
 * the tape are visible at the same time.
 *
 * COST MODEL (this panel must be free until asked for):
 *   - The whole module is lazy() in the page, so none of this ships in the
 *     tokenized-assets chunk.
 *   - Nothing is fetched on page load. The first OPEN triggers the only fetch.
 *   - Results live in a module cache + sessionStorage (10 min), so reopening —
 *     and a reload inside the window — costs zero requests.
 *   - One in-flight promise is shared, so double-clicking the handle can't
 *     double-fetch.
 *   - No polling, ever. Refresh is manual (the header button) or a natural
 *     expiry on the next open.
 *   - The body unmounts on close (observers/DOM go away); the cache does not.
 *
 * PORTALED TO <body> ON PURPOSE: .app-main-content is `position: relative;
 * z-index: 1`, which opens a stacking context — inside it NO z-index can rise
 * above the app header (z-index 300), and the header was measured swallowing
 * every click on this panel's own close button. Because the portal lands
 * outside .app, day mode cannot be inherited from `.app.app-day-mode` either,
 * so the theme travels as an explicit `rvp--day` class instead.
 *
 * Feed: X-Dash per-token mentions. There is no RWA-wide social lane on the box
 * (verified 2026-08-14: /api/xdash/narratives returns nothing), so we merge the
 * RWA projects that actually carry mention coverage.
 */

// Slugs measured 2026-08-14 for live mention coverage. centrifuge /
// maple-finance / goldfinch all return 0 mentions — deliberately not requested.
// chainlink DOES carry volume but most of it is generic LINK chatter, so it is
// the one source held to a topical keyword test (`topicGated`).
const SOURCES = [
  { slug: 'ondo-finance', topicGated: false },
  { slug: 'plume',        topicGated: false },
  { slug: 'pendle',       topicGated: false },
  { slug: 'mantra',       topicGated: false },
  { slug: 'chainlink',    topicGated: true },
]

const RWA_TOPIC = /\b(rwa|rwas|tokeniz\w*|tokenised|real[- ]world asset|treasur\w*|t-bill|stablecoin|private credit|on-?chain fund|bond fund|gold-backed|money market)\b/i

// "Big accounts" — the panel's whole premise. Followers is the primary gate;
// a blue-verified account clears at a lower bar since verification already
// filters the long tail of throwaways.
const BIG_FOLLOWERS = 25_000
const VERIFIED_FLOOR = 10_000
const MAX_ITEMS = 30
const MAX_PER_AUTHOR = 2

const CACHE_TTL_MS = 10 * 60 * 1000
const SS_KEY = 'spectre-rwa-voices-v1'

let _memCache = null      // { ts, items }
let _inflight = null      // Promise<items> shared by concurrent openers

function readSeed() {
  if (_memCache && _memCache.items?.length && Date.now() - _memCache.ts < CACHE_TTL_MS) return _memCache.items
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > CACHE_TTL_MS) return null
    // An empty array is a truthy seed: caching one would short-circuit every
    // later open and leave the panel permanently blank after a single upstream
    // blip (X-Dash 502s are routine). Treat "cached nothing" as no cache.
    if (!Array.isArray(parsed.items) || !parsed.items.length) return null
    _memCache = parsed
    return parsed.items
  } catch { return null }
}

function writeSeed(items) {
  if (!Array.isArray(items) || !items.length) return   // see readSeed
  _memCache = { ts: Date.now(), items }
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(_memCache)) } catch { /* quota/SSR — non-fatal */ }
}

function fmtAgo(iso) {
  const t = iso ? new Date(iso).getTime() : 0
  if (!t) return ''
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return 'now'
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function fmtCount(n) {
  if (n == null) return ''
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return String(n)
}

// Strip the trailing t.co link X appends — it renders as noise in a narrow column.
function cleanText(s) {
  return String(s || '').replace(/https:\/\/t\.co\/\w+\s*$/g, '').trim()
}

async function fetchVoices() {
  const seeded = readSeed()
  if (seeded) return seeded
  if (_inflight) return _inflight

  _inflight = (async () => {
    const responses = await Promise.allSettled(
      SOURCES.map(src => fetch(`/api/xdash/token/${encodeURIComponent(src.slug)}`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(json => ({ src, json }))
      )
    )

    const seen = new Set()
    const out = []
    for (const r of responses) {
      if (r.status !== 'fulfilled' || !r.value?.json) continue
      const { src, json } = r.value
      // top_mentions + mentions merged & deduped — the raw `.mentions` array is
      // frequently empty on its own (same reason rwa-tweets.jsx uses this).
      const { mergedMentions } = normalizeXDashDetail(json)
      for (const m of (Array.isArray(mergedMentions) ? mergedMentions : [])) {
        const tw = m?.tweet || {}
        const au = m?.author || {}
        const id = tw.tweet_id
        if (!id || seen.has(id)) continue
        const followers = Number(au.followers_count) || 0
        const verified = Boolean(au.is_blue_verified)
        const big = followers >= BIG_FOLLOWERS || (verified && followers >= VERIFIED_FLOOR)
        if (!big) continue
        const text = cleanText(tw.full_text)
        if (!text) continue
        if (src.topicGated && !RWA_TOPIC.test(text)) continue
        seen.add(id)
        out.push({
          id,
          text,
          url: tw.x_url || '',
          ts: tw.created_at_utc,
          name: au.name || au.screen_name || '',
          handle: au.screen_name || '',
          avatar: au.avatar_image_url || '',
          followers,
          verified,
          project: src.slug,
          engagement: (Number(tw.favorite_count) || 0) + 2 * (Number(tw.retweet_count) || 0),
        })
      }
    }

    // Reach first (this is the "big accounts" panel), recency as the tiebreak
    // so a whale account's stale post can't pin the top of the column forever.
    out.sort((a, b) => {
      const ta = Math.floor(Math.log10(Math.max(a.followers, 1)))
      const tb = Math.floor(Math.log10(Math.max(b.followers, 1)))
      if (tb !== ta) return tb - ta
      const da = new Date(a.ts || 0).getTime()
      const db = new Date(b.ts || 0).getTime()
      if (db !== da) return db - da
      return b.engagement - a.engagement
    })

    // Cap repeats per account: one aggregator posting six times shouldn't own
    // the column (measured: BSCN took 3 of the top 4 slots).
    const perAuthor = new Map()
    const items = []
    for (const v of out) {
      const n = (perAuthor.get(v.handle) || 0) + 1
      if (n > MAX_PER_AUTHOR) continue
      perAuthor.set(v.handle, n)
      items.push(v)
      if (items.length >= MAX_ITEMS) break
    }
    writeSeed(items)
    return items
  })()

  try { return await _inflight } finally { _inflight = null }
}

const PROJECT_LABEL = {
  'ondo-finance': 'Ondo',
  plume: 'Plume',
  pendle: 'Pendle',
  mantra: 'MANTRA',
  chainlink: 'Chainlink',
}

const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
)
const IconVerified = () => (
  <svg className="rvp-verified" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 1.5 14.6 4l3.5-.4 1 3.4 3.1 1.7-1.5 3.2 1.5 3.2-3.1 1.7-1 3.4-3.5-.4L12 22.5 9.4 20l-3.5.4-1-3.4L1.8 15.3 3.3 12 1.8 8.8l3.1-1.7 1-3.4L9.4 4 12 1.5Z" />
    <path d="m8.6 12.2 2.3 2.3 4.5-4.6" fill="none" stroke="var(--bg-void, #09090b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function RwaVoicesPanel({ open, onClose, dayMode = false }) {
  const { t } = useTranslation()
  const [items, setItems] = useState(() => readSeed())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const panelRef = useRef(null)
  const loadedOnceRef = useRef(false)

  // The slide-in has to start from the CLOSED transform, and this component is
  // lazy() — it first mounts with open already true, which would paint it
  // in-place with nothing to transition from. Flip the class one frame after
  // mount so there is a starting frame to animate out of.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!open) { setEntered(false); return undefined }
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  const load = useCallback(async (force = false) => {
    if (force) { _memCache = null; try { sessionStorage.removeItem(SS_KEY) } catch { /* ignore */ } }
    setLoading(true)
    setError(false)
    try {
      const next = await fetchVoices()
      setItems(next)
      if (!next.length) setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // THE ONLY FETCH TRIGGER — first open. A cached seed short-circuits it.
  useEffect(() => {
    if (!open || loadedOnceRef.current) return
    loadedOnceRef.current = true
    if (readSeed()) return
    load()
  }, [open, load])

  // Esc to close; focus the panel so the key lands without a click first.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus?.()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const grouped = useMemo(() => (items || []).length, [items])

  return createPortal(
    <>
      {/* Scrim: click-away close. Deliberately NO backdrop-filter — a full-
          viewport blur under a moving panel is the documented jank engine on
          this app (per-panel blur over a scrolling board). Flat wash instead. */}
      <div
        className={`rvp-scrim${entered ? ' rvp-scrim--on' : ''}${dayMode ? ' rvp--day' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={`rvp${entered ? ' rvp--open' : ''}${dayMode ? ' rvp--day' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label={t('tokenizedAssets.voices.title', 'RWA Voices')}
      >
        <header className="rvp-head">
          <div className="rvp-head-titles">
            <span className="rvp-eyebrow">{t('tokenizedAssets.voices.eyebrow', 'BIG ACCOUNTS')}</span>
            <h2 className="rvp-title">{t('tokenizedAssets.voices.title', 'RWA Voices')}</h2>
          </div>
          <button
            type="button"
            className="rvp-icon-btn"
            onClick={() => load(true)}
            disabled={loading}
            title={t('tokenizedAssets.voices.refresh', 'Refresh')}
            aria-label={t('tokenizedAssets.voices.refresh', 'Refresh')}
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="rvp-icon-btn"
            onClick={onClose}
            title={t('common.close', 'Close')}
            aria-label={t('common.close', 'Close')}
          >
            <IconX />
          </button>
        </header>

        <p className="rvp-sub">
          {t('tokenizedAssets.voices.sub', 'What accounts with real reach are saying about tokenized assets')}
        </p>

        <div className="rvp-body">
          {loading && !grouped && Array.from({ length: 5 }).map((_, i) => (
            <div key={`sk-${i}`} className={`rvp-skel animate-shimmer stagger-${(i % 5) + 1}`} />
          ))}

          {/* settled-and-empty (or failed) — never during the first frame
              before the load effect has flipped `loading` on */}
          {!loading && (error || (Array.isArray(items) && !items.length)) && (
            <div className="rvp-empty">
              <span>{t('tokenizedAssets.voices.empty', 'No large-account posts in this window.')}</span>
              <button type="button" className="rvp-retry" onClick={() => load(true)}>
                {t('tokenizedAssets.voices.retry', 'Try again')}
              </button>
            </div>
          )}

          {(items || []).map(v => (
            <article key={v.id} className="rvp-card">
              <a
                className="rvp-card-head"
                href={v.url || `https://x.com/${v.handle}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {v.avatar
                  ? (
                    <img
                      className="rvp-avatar"
                      src={v.avatar}
                      alt=""
                      width="34"
                      height="34"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                    />
                  )
                  : <span className="rvp-avatar rvp-avatar--ph" aria-hidden="true">{(v.name || '?').slice(0, 1)}</span>}
                <span className="rvp-who">
                  <span className="rvp-name">
                    {v.name}
                    {v.verified && <IconVerified />}
                  </span>
                  <span className="rvp-meta">
                    <span className="rvp-followers mono">{fmtCount(v.followers)}</span>
                    <span className="rvp-dot">·</span>
                    <span className="rvp-user">@{v.handle}</span>
                  </span>
                </span>
                <span className="rvp-age mono">{fmtAgo(v.ts)}</span>
              </a>
              <p className="rvp-text">{v.text}</p>
              <span className="rvp-project">{PROJECT_LABEL[v.project] || v.project}</span>
            </article>
          ))}
        </div>
      </aside>
    </>,
    document.body,
  )
}
