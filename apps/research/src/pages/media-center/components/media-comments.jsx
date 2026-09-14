/**
 * MediaComments — the "life" panel inside the player.
 *  - Live stream  → embeds the real YouTube live chat (Twitch-style vibe).
 *  - Video        → top comments fetched from the API.
 *  - Podcast/other → friendly empty state.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as mediaApi from '@/services/mediaApi'
import { fmtCompact, relTime } from './media-format'

function ytVideoId(item) {
  if (!item) return null
  if (item.source && item.source !== 'youtube') return null
  const raw = item.id || ''
  return raw.startsWith('yt_') ? raw.slice(3) : raw
}

const LikeIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 10v11M2 13v6a2 2 0 0 0 2 2h13.5a2 2 0 0 0 2-1.6l1.3-7A1.6 1.6 0 0 0 20.2 10H14l1-4a2 2 0 0 0-2-2.5L7 10z" />
  </svg>
)

const CommentRow = ({ c, t }) => (
  <div className="mctc-row">
    <div className="mctc-av">
      {c.avatarUrl
        ? <img src={c.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        : <span>{(c.author || '?').replace(/^@/, '').charAt(0).toUpperCase()}</span>}
    </div>
    <div className="mctc-body">
      <div className="mctc-meta">
        <span className="mctc-author">{c.author}</span>
        {c.publishedAt && <span className="mctc-when">{relTime(c.publishedAt, t)}</span>}
      </div>
      <p className="mctc-text">{c.text}</p>
      {c.likeCount > 0 && (
        <span className="mctc-likes"><LikeIcon /> {fmtCompact(c.likeCount)}</span>
      )}
    </div>
  </div>
)

const MediaComments = ({ item }) => {
  const { t } = useTranslation()
  const isLive = item?.type === 'live'
  const vid = ytVideoId(item)
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (isLive || !vid) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setComments([])
    mediaApi.getComments(vid)
      .then(res => { if (!cancelled) setComments(res?.items || []) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vid, isLive])

  /* Live → real YouTube live chat embed */
  if (isLive && vid) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'app.spectreai.io'
    return (
      <div className="mctc mctc--live">
        <iframe
          title={t('mediaCenter.player.liveChat')}
          src={`https://www.youtube.com/live_chat?v=${vid}&embed_domain=${host}`}
          className="mctc-livechat"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>
    )
  }

  if (!vid) {
    return (
      <div className="mctc mctc--empty">
        <p>{t('mediaCenter.player.noDiscussion')}</p>
      </div>
    )
  }

  return (
    <div className="mctc">
      {loading ? (
        <div className="mctc-skel">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="mctc-skel-row" style={{ animationDelay: `${i * 0.06}s` }}>
              <div className="mctc-skel-av animate-shimmer" />
              <div className="mctc-skel-lines">
                <div className="mctc-skel-line animate-shimmer" />
                <div className="mctc-skel-line mctc-skel-line--sm animate-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="mctc--empty"><p>{failed ? t('mediaCenter.player.commentsOff') : t('mediaCenter.player.noComments')}</p></div>
      ) : (
        <div className="mctc-list">
          {comments.map(c => <CommentRow key={c.id} c={c} t={t} />)}
        </div>
      )}
    </div>
  )
}

export default MediaComments
