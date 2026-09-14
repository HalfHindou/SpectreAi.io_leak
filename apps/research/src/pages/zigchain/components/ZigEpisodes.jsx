/**
 * Latest podcast / show episodes from Abdul Rafay Gadit (@ARafayGadit) and
 * the ZIGChain channel — pulled live from the X-Dash API. Filters the
 * author's recent posts to those that look like episode releases (links to
 * YouTube / Spotify / podcast platforms, or self-quoted threads).
 */
import React, { useEffect, useRef, useState } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { getXDashAuthor } from './xdash-author-cache'

const HANDLES = ['ARafayGadit', 'brbordallo', 'ahm3dzig', 'ZIGChain']

const EPISODE_HOSTS = [
  'youtube.com', 'youtu.be',
  'spotify.com', 'open.spotify',
  'apple.co', 'podcasts.apple',
  'pca.st', 'overcast.fm',
  'zigchain.com', 'medium.com/zignaly',
]

function fmtRel(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const lang = i18n.language || 'en'
  if (ms < 60_000) return i18n.t('zigchainChrome.time.justNow', 'just now')
  if (ms < 3_600_000) return i18n.t('zigchainChrome.time.mAgo', '{{n}}m ago', { n: Math.round(ms / 60_000) })
  if (ms < 86_400_000) return i18n.t('zigchainChrome.time.hAgo', '{{n}}h ago', { n: Math.round(ms / 3_600_000) })
  if (ms < 30 * 86_400_000) return i18n.t('zigchainChrome.time.dAgo', '{{n}}d ago', { n: Math.round(ms / 86_400_000) })
  return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

function fmtCount(n) {
  if (!Number.isFinite(n)) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function extractEpisodes(payload, handle) {
  if (!payload) return []
  // X-Dash author endpoint returns recent posts under `mentions` first; older
  // service variants used `posts` / `tweets` / `timeline`. Fall through.
  const candidates =
    payload.mentions ||
    payload.top_mentions ||
    payload.posts ||
    payload.tweets ||
    payload.timeline ||
    payload?.author?.posts ||
    payload?.author?.tweets ||
    []
  const author = payload?.author || { handle }

  return candidates
    .map((row) => {
      const tweet = row.tweet || row
      if (!tweet) return null
      const id = tweet.tweet_id || tweet.id || tweet.id_str
      const text = tweet.full_text || tweet.text
      if (!id || !text) return null

      // Pick out the first external link from the tweet entities or the text itself.
      const urlMatch = text.match(/https?:\/\/[^\s]+/i)
      const link = urlMatch?.[0] || tweet.x_url || `https://x.com/${handle}/status/${id}`
      const isEpisode = EPISODE_HOSTS.some((host) => link.toLowerCase().includes(host))

      // Image attachment (use the first one if present)
      const media = tweet.media?.[0] || tweet.entities?.media?.[0] || null
      const imageUrl = media?.media_url_https || media?.preview_image_url || media?.url || null

      return {
        id,
        text,
        url: tweet.x_url || `https://x.com/${handle}/status/${id}`,
        outboundUrl: link,
        createdAt: tweet.created_at_utc || tweet.created_at,
        favorites: Number(tweet.favorite_count ?? tweet.likes ?? tweet.favorites),
        replies: Number(tweet.reply_count ?? tweet.replies),
        retweets: Number(tweet.retweet_count ?? tweet.retweets),
        views: Number(tweet.views ?? tweet.impression_count ?? tweet.view_count),
        author: row.author || tweet.author || author,
        imageUrl,
        isEpisode,
      }
    })
    .filter(Boolean)
}

async function fetchHandle(handle) {
  try {
    // Shared module cache: HANDLES[0] ('ARafayGadit') reuses the same
    // /author fetch as ZigFounderTweets instead of firing its own.
    const json = await getXDashAuthor(handle)
    if (!json) return []
    return extractEpisodes(json, handle)
  } catch (_) {
    return []
  }
}

async function fetchAll(signal) {
  const lists = await Promise.all(HANDLES.map((h) => fetchHandle(h)))
  // Merge, dedupe by id, sort by date desc.
  const seen = new Set()
  const merged = []
  for (const list of lists) {
    for (const ep of list) {
      if (seen.has(ep.id)) continue
      seen.add(ep.id)
      merged.push(ep)
    }
  }
  merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))

  // Prefer entries that look like episodes (linked to YT/Spotify/etc.) but
  // fall back to plain recent posts so the section never goes empty.
  const episodes = merged.filter((m) => m.isEpisode || m.imageUrl)
  const tail = merged.filter((m) => !episodes.includes(m))
  return [...episodes, ...tail].slice(0, 8)
}

function useEpisodes(enabled) {
  const [data, setData] = useState({ list: [], loading: enabled, error: null })
  useEffect(() => {
    if (!enabled) return undefined
    const ctrl = new AbortController()
    fetchAll(ctrl.signal)
      .then((list) => setData({ list, loading: false, error: null }))
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setData({ list: [], loading: false, error: err.message || 'Episodes unavailable' })
      })
    return () => ctrl.abort()
  }, [enabled])
  return data
}

// IntersectionObserver gate. ZigEpisodes fans out 4 parallel
// /api/xdash/author/{handle} fetches; the section sits deep below the
// fold on /zigchain. Defer until the user actually approaches it.
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

export default function ZigEpisodes() {
  const { ref: sectionRef, visible } = useSectionVisible()
  const { list, loading, error } = useEpisodes(visible)
  const top = (list || []).slice(0, 5)
  const { t } = useTranslation()

  return (
    <section ref={sectionRef} className="zep">
      <header className="zep-head">
        <div className="zep-id">
          <h3 className="zep-title">{t('zigchainChrome.foundersLatest', "Founder's Latest")}</h3>
          <p className="zep-sub">
            {t('zigchainChrome.episodes.subPrefix', 'Recent posts & episodes from')}{' '}
            <a href="https://x.com/ARafayGadit" target="_blank" rel="noopener noreferrer">@ARafayGadit</a>{' '}
            {t('zigchainChrome.episodes.subAnd', 'and')}{' '}
            <a href="https://x.com/brbordallo" target="_blank" rel="noopener noreferrer">@brbordallo</a>{' '}
            {t('zigchainChrome.episodes.subVia', 'via X-Dash.')}
          </p>
        </div>
        <a href="https://x.com/ARafayGadit" target="_blank" rel="noopener noreferrer" className="zep-more">{t('zigchainChrome.action.viewOnX', 'View on X ↗')}</a>
      </header>

      {loading && (
        <div className="zep-skel" aria-hidden>
          {[0, 1, 2, 3].map((i) => <div key={i} className="zep-skel-card" />)}
        </div>
      )}

      {!loading && !top.length && (
        <p className="zep-empty">{error ? t('zigchainChrome.empty.episodesUnavailable', 'Episodes unavailable.') : t('zigchainChrome.empty.noRecentPosts', 'No recent posts.')}</p>
      )}

      {!loading && top.length > 0 && (
        <div className="zep-grid">
          {top.map((ep) => {
            const handle = ep.author?.handle || ep.author?.user_handle || 'ARafayGadit'
            const name = ep.author?.name || ep.author?.display_name || handle
            const ava = `https://unavatar.io/twitter/${handle}`
            return (
              <a
                key={ep.id}
                href={ep.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`zep-card${ep.isEpisode ? ' is-episode' : ''}`}
              >
                {ep.imageUrl && (
                  <div className="zep-card-thumb">
                    <img src={ep.imageUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }} />
                    {ep.isEpisode && (
                      <span className="zep-card-play" aria-hidden>
                        <svg width="22" height="22" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="rgba(0,0,0,.55)"/><path d="M13 10l9 6-9 6V10z" fill="#fff"/></svg>
                      </span>
                    )}
                  </div>
                )}
                <div className="zep-card-body">
                  <div className="zep-card-author">
                    <img src={ava} alt="" className="zep-card-ava" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                    <div className="zep-card-author-text">
                      <span className="zep-card-name">{name}</span>
                      <span className="zep-card-handle">@{handle}</span>
                    </div>
                    <span className="zep-card-time">{fmtRel(ep.createdAt)}</span>
                  </div>
                  <p className="zep-card-text">{ep.text.length > 220 ? `${ep.text.slice(0, 218)}…` : ep.text}</p>
                  <div className="zep-card-foot">
                    {Number.isFinite(ep.replies) && <span>{fmtCount(ep.replies) || 0} ↩</span>}
                    {Number.isFinite(ep.retweets) && <span>{fmtCount(ep.retweets) || 0} ↻</span>}
                    {Number.isFinite(ep.favorites) && <span>{fmtCount(ep.favorites) || 0} ♥</span>}
                    {Number.isFinite(ep.views) && ep.views > 0 && <span>{t('zigchainChrome.episodes.views', '{{count}} views', { count: fmtCount(ep.views) })}</span>}
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </section>
  )
}
