import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeXDashDetail } from '@/pages/x-dash/components/x-dash-utils'

/**
 * RwaTweets — curated voices on tokenized assets.
 * Pulls per-token mentions from the X-Dash proxy at /api/xdash/token/<cgId>.
 * Each tab maps to a flagship RWA project that has live mention coverage.
 *
 * Mention shape (from X-Dash):
 *   { tweet: { tweet_id, full_text, x_url, created_at_utc, favorite_count, retweet_count, views_count },
 *     author: { name, screen_name, avatar_image_url, followers_count } }
 */

const TABS = [
  { id: 'all',           label: 'All',     slugs: ['ondo-finance', 'pendle', 'plume', 'mantra'] },
  { id: 'ondo-finance',  label: 'Ondo',    slugs: ['ondo-finance'] },
  { id: 'pendle',        label: 'Pendle',  slugs: ['pendle'] },
  { id: 'plume',         label: 'Plume',   slugs: ['plume'] },
]

/* Inline engagement icons — design system bans emoji as UI (the old ♥/↻/👁
   glyphs). These are stroke icons inheriting currentColor. */
const IconHeart = () => (
  <svg className="rtw__stat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
  </svg>
)
const IconRepost = () => (
  <svg className="rtw__stat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)
const IconViews = () => (
  <svg className="rtw__stat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
)

function fmtAgo(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
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
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export default function RwaTweets() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('all')
  const [items, setItems] = useState(null)
  const [error, setError] = useState(false)

  // RwaTweets sits well below the fold on Overview (row 4) and in the
  // mobile RWA Pulse section. Firing 4 parallel /api/x-dash/token/{slug}
  // requests on mount before the user has scrolled to it wastes
  // bandwidth on every page load — especially while the X-Dash proxy is
  // returning 502 upstream. Gate the fetch on the component entering
  // the viewport via IntersectionObserver; fall back to immediate fire
  // on browsers without IO support.
  const sentinelRef = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return undefined
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver !== 'function') {
      setVisible(true)
      return undefined
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    setItems(null)
    setError(false)
    const slugs = TABS.find(x => x.id === tab)?.slugs || []
    ;(async () => {
      try {
        const responses = await Promise.allSettled(
          slugs.map(s => fetch(`/api/xdash/token/${encodeURIComponent(s)}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
          )
        )
        const merged = []
        for (const r of responses) {
          if (r.status !== 'fulfilled' || !r.value) continue
          // Merged set (top_mentions + mentions, deduped) like the other X-Dash
          // consumers — the raw `.mentions` array alone is frequently empty.
          const { mergedMentions } = normalizeXDashDetail(r.value)
          if (Array.isArray(mergedMentions)) merged.push(...mergedMentions)
        }
        // Dedupe by tweet_id, then sort by engagement (faves + 2*RTs)
        const seen = new Set()
        const unique = []
        for (const m of merged) {
          const id = m?.tweet?.tweet_id
          if (!id || seen.has(id)) continue
          seen.add(id)
          unique.push(m)
        }
        unique.sort((a, b) => {
          const ea = (a.tweet?.favorite_count || 0) + 2 * (a.tweet?.retweet_count || 0)
          const eb = (b.tweet?.favorite_count || 0) + 2 * (b.tweet?.retweet_count || 0)
          if (eb !== ea) return eb - ea
          return new Date(b.tweet?.created_at_utc || 0) - new Date(a.tweet?.created_at_utc || 0)
        })
        if (!cancelled) setItems(unique.slice(0, 24))
      } catch {
        if (!cancelled) { setItems([]); setError(true) }
      }
    })()
    return () => { cancelled = true }
  }, [tab, visible])

  const ranked = useMemo(() => {
    if (!items) return null
    return items.map(m => {
      const tw = m.tweet || {}
      const au = m.author || {}
      return {
        id: tw.tweet_id,
        text: tw.full_text || '',
        url: tw.x_url || '',
        ts: tw.created_at_utc,
        name: au.name,
        handle: au.screen_name,
        avatar: au.avatar_image_url,
        likes: tw.favorite_count,
        rts: tw.retweet_count,
        views: tw.views_count,
      }
    }).filter(it => it.text)
  }, [items])

  const loading = ranked === null

  return (
    <section ref={sentinelRef} className="rtw" aria-label={t('tokenizedAssets.tweets.ariaLabel', 'RWA Tweets')}>
      <header className="rtw__head">
        <div className="rtw__head-left">
          <span className="rtw__title">{t('tokenizedAssets.tweets.title', 'RWA Voices')}</span>
          <span className="rtw__sub">{t('tokenizedAssets.tweets.subtitle', 'Live · curated tweets')}</span>
        </div>
        <div className="rtw__qs" role="tablist">
          {TABS.map(q => (
            <button
              key={q.id}
              type="button"
              className={`rtw__q${tab === q.id ? ' on' : ''}`}
              onClick={() => setTab(q.id)}
              aria-selected={tab === q.id}
              title={q.label}
            >{q.label}</button>
          ))}
        </div>
      </header>

      {loading ? (
        <ul className="rtw__list">
          {[0, 1, 2].map(i => (
            <li key={i} className="rtw__item rtw__item--skel">
              <div className={`rtw__skel-avatar animate-shimmer stagger-${(i % 5) + 1}`} />
              <div className="rtw__skel-body">
                <div className={`rtw__skel-line animate-shimmer stagger-${(i % 5) + 1}`} />
                <div className={`rtw__skel-line rtw__skel-line--sub animate-shimmer stagger-${(i % 5) + 1}`} />
              </div>
            </li>
          ))}
        </ul>
      ) : !ranked?.length ? (
        <div className="rtw__empty">
          {error
            ? t('tokenizedAssets.tweets.errorFeed', 'X feed unavailable. Check back shortly.')
            : t('tokenizedAssets.tweets.empty', 'No tweets in window.')}
        </div>
      ) : (
        <ul className="rtw__list">
          {ranked.map(it => (
            <li key={it.id} className="rtw__item">
              <a
                className="rtw__avatar-wrap"
                href={it.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={it.name || it.handle}
              >
                {it.avatar ? (
                  <img className="rtw__avatar" src={it.avatar} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden' }} />
                ) : (
                  <span className="rtw__avatar rtw__avatar--fb">{(it.name || it.handle || 'X')[0]}</span>
                )}
              </a>
              <div className="rtw__body">
                <div className="rtw__row1">
                  {it.name && <span className="rtw__name">{it.name}</span>}
                  {it.handle && <span className="rtw__handle">@{it.handle}</span>}
                  {it.ts && <span className="rtw__time mono">· {fmtAgo(it.ts)}</span>}
                </div>
                <a
                  className="rtw__text"
                  href={it.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {it.text.length > 220 ? `${it.text.slice(0, 220)}…` : it.text}
                </a>
                {(it.likes != null || it.rts != null || it.views != null) && (
                  <div className="rtw__stats mono">
                    {it.likes != null && <span className="rtw__stat"><IconHeart />{fmtCount(it.likes)}</span>}
                    {it.rts != null && <span className="rtw__stat"><IconRepost />{fmtCount(it.rts)}</span>}
                    {it.views != null && <span className="rtw__stat"><IconViews />{fmtCount(it.views)}</span>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
