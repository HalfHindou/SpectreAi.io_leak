/**
 * ZIGChain — Latest tweets from co-founder Abdul Rafay (@ARafayGadit).
 * Falls back to ZIGChain token-level mentions when the author endpoint is empty.
 * Uses /api/xdash/* (Vite dev proxy / Vercel rewrite to X-Dash service).
 */
import React, { useEffect, useRef, useState } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { getXDashAuthor } from './xdash-author-cache'

const HANDLE = 'ARafayGadit'
const FALLBACK_HANDLES = ['ARafayGadit', 'brbordallo', 'ahm3dzig']
const FALLBACK_TOKEN = 'zignaly'
function fmtRel(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const lang = i18n.language || 'en'
  if (ms < 60_000) return i18n.t('zigchainChrome.time.justNow', 'just now')
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d`
  return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(new Date(iso))
}

function fmtCount(n) {
  if (!Number.isFinite(n)) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function normalizeAuthorPayload(payload, primaryHandle) {
  if (!payload) return []
  // X-Dash author endpoint exposes posts under a few possible keys depending
  // on which service is responding. The current Hetzner build returns the
  // author's recent posts under `mentions` (tweets that include the author
  // as the source), so check that first.
  const candidates =
    payload.mentions ||
    payload.top_mentions ||
    payload.posts ||
    payload.tweets ||
    payload.timeline ||
    payload?.author?.posts ||
    payload?.author?.tweets ||
    []
  return candidates
    .map((row) => {
      const tweet = row.tweet || row
      if (!tweet) return null
      const id = tweet.tweet_id || tweet.id || tweet.id_str
      const text = tweet.full_text || tweet.text
      if (!id || !text) return null
      return {
        id,
        text,
        url: tweet.x_url || `https://x.com/${primaryHandle}/status/${id}`,
        createdAt: tweet.created_at_utc || tweet.created_at,
        favorites: Number(tweet.favorite_count ?? tweet.likes ?? tweet.favorites),
        replies: Number(tweet.reply_count ?? tweet.replies),
        retweets: Number(tweet.retweet_count ?? tweet.retweets),
        author: row.author || tweet.author || { handle: primaryHandle },
      }
    })
    .filter(Boolean)
}

function normalizeTokenMentions(payload, allowedHandles) {
  if (!payload) return []
  const mentions = payload.mentions || payload.top_mentions || []
  const allow = new Set(allowedHandles.map((h) => h.toLowerCase()))
  return mentions
    .filter((m) => {
      const handle = String(m?.author?.handle || m?.tweet?.author?.handle || '').toLowerCase()
      return allow.has(handle)
    })
    .map((m) => {
      const tweet = m.tweet
      if (!tweet?.tweet_id || !tweet?.full_text) return null
      return {
        id: tweet.tweet_id,
        text: tweet.full_text,
        url: tweet.x_url,
        createdAt: tweet.created_at_utc || tweet.created_at,
        favorites: Number(tweet.favorite_count ?? tweet.likes),
        replies: Number(tweet.reply_count ?? tweet.replies),
        retweets: Number(tweet.retweet_count ?? tweet.retweets),
        author: m.author || { handle: '' },
      }
    })
    .filter(Boolean)
}

async function fetchTweets(signal) {
  // 1) Try the author endpoint first (most relevant — direct from the founder).
  //    Shared module cache so ZigEpisodes reuses the same /author/HANDLE fetch.
  try {
    const json = await getXDashAuthor(HANDLE)
    if (json) {
      const list = normalizeAuthorPayload(json, HANDLE)
      if (list.length) return { source: 'author', list, primary: json?.author }
    }
  } catch (_) { /* fall through */ }

  // 2) Fallback — get ZIGChain mentions and filter to our trusted handles.
  try {
    const r = await fetch(`/api/xdash/token/${encodeURIComponent(FALLBACK_TOKEN)}?per_page=30`, { credentials: 'include',
      signal, headers: { Accept: 'application/json' },
    })
    if (!r.ok) return { source: null, list: [] }
    const json = await r.json()
    const list = normalizeTokenMentions(json, FALLBACK_HANDLES)
    return { source: 'token', list }
  } catch (_) {
    return { source: null, list: [] }
  }
}

function useFounderTweets(enabled) {
  const [data, setData] = useState({ list: [], loading: enabled, error: null })
  useEffect(() => {
    if (!enabled) return undefined
    const ctrl = new AbortController()
    fetchTweets(ctrl.signal)
      .then((res) => setData({ list: res.list || [], loading: false, error: null }))
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setData({ list: [], loading: false, error: err.message || 'Tweets unavailable' })
      })
    return () => ctrl.abort()
  }, [enabled])
  return data
}

// IntersectionObserver gate. ZigFounderTweets sits deep below the fold;
// firing /api/xdash/author/* on mount was 1 wasted network call on every
// /zigchain visit. We mount the component normally but defer the fetch
// until the section approaches the viewport.
function useSectionVisible() {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return undefined
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') {
      setVisible(true)
      return undefined
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  return { ref, visible }
}

export default function ZigFounderTweets() {
  const { t } = useTranslation()
  const { ref: sectionRef, visible } = useSectionVisible()
  const { list, loading, error } = useFounderTweets(visible)
  const top = (list || []).slice(0, 3)

  return (
    <section ref={sectionRef} className="zft">
      <header className="zft-head">
        <div className="zft-id">
          <img
            src={`https://unavatar.io/twitter/${HANDLE}`}
            alt=""
            className="zft-ava"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
          />
          <div className="zft-meta">
            <span className="zft-name">Abdul Rafay Gadit</span>
            <a href={`https://x.com/${HANDLE}`} target="_blank" rel="noopener noreferrer" className="zft-handle">@{HANDLE}</a>
          </div>
        </div>
        <span className="zft-tag">{t('zigchainChrome.role.cofounderCfo', 'Co-founder · CFO')}</span>
      </header>

      {loading && (
        <div className="zft-skel" aria-hidden>
          <div className="zft-skel-row" />
          <div className="zft-skel-row" />
          <div className="zft-skel-row" />
        </div>
      )}

      {!loading && !top.length && (
        <p className="zft-empty">{error ? t('zigchainChrome.empty.tweetsUnavailable', 'Tweets unavailable.') : t('zigchainChrome.empty.noRecentPosts', 'No recent posts.')}</p>
      )}

      {!loading && top.length > 0 && (
        <ul className="zft-list">
          {top.map((t) => (
            <li key={t.id} className="zft-tweet">
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="zft-link">
                <p className="zft-text">{t.text.length > 180 ? `${t.text.slice(0, 178)}…` : t.text}</p>
                <div className="zft-foot">
                  <span className="zft-time">{fmtRel(t.createdAt)}</span>
                  <span className="zft-engage">
                    {Number.isFinite(t.replies) && <span>{fmtCount(t.replies) || 0} ↩</span>}
                    {Number.isFinite(t.retweets) && <span>{fmtCount(t.retweets) || 0} ↻</span>}
                    {Number.isFinite(t.favorites) && <span>{fmtCount(t.favorites) || 0} ♥</span>}
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
