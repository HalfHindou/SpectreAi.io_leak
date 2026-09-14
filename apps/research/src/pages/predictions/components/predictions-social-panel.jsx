/**
 * PredictionsSocialPanel — the "Pulse" tab on the Predictions page.
 *
 * An X Dash-style social-intelligence panel, but for prediction TOPICS instead
 * of tokens:
 *   - Trending Topics: the hottest markets ranked by social buzz
 *   - Top Voices: the biggest accounts driving the conversation
 *   - The Conversation: the highest-signal tweets, each tagged to a market
 *
 * Data comes from usePredictionsSocial (tweet search over each market's topic).
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePredictionsSocial, engagementOf } from './use-predictions-social'
import { CATEGORY_COLORS } from './predictions-constants'
import './predictions-social-panel.css'

function fmtCompact(n) {
  const v = Number(n) || 0
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K`
  return String(Math.round(v))
}

// Linkify a tweet body into safe React nodes — @handles, #tags, $cashtags get
// accent styling, bare URLs are trimmed. No innerHTML, so nothing rendered as
// markup.
function renderText(text) {
  if (!text) return null
  return text.split(/(\s+)/).map((tok, i) => {
    if (/^https?:\/\//.test(tok)) {
      return (
        <a key={i} href={tok} target="_blank" rel="noopener noreferrer" className="psoc-link" onClick={(e) => e.stopPropagation()}>
          {tok.replace(/^https?:\/\/(www\.)?/, '').slice(0, 24)}
        </a>
      )
    }
    if (/^[@#$][\w]+$/.test(tok)) {
      return <span key={i} className="psoc-token">{tok}</span>
    }
    return <span key={i}>{tok}</span>
  })
}

function xProfileUrl(handle) {
  return `https://x.com/${String(handle || '').replace(/^@/, '')}`
}

function shortTitle(title) {
  const t = String(title || '').replace(/\?$/, '').trim()
  return t.length > 26 ? t.slice(0, 24) + '…' : t
}

// Trending Bubbles — a buzz-sized bubble cloud of the hottest prediction
// topics. Bubble diameter scales with social buzz, color = category. Biggest
// (most-talked-about) first. Click -> the market.
function TrendingBubbles({ topics, onOpen }) {
  const items = topics.slice(0, 16)
  if (!items.length) return null
  const buzzes = items.map((x) => x.buzz || 0)
  const max = Math.max(...buzzes, 1)
  const min = Math.min(...buzzes, 0)
  const sized = items
    .map((tp) => {
      const norm = max > min ? (tp.buzz - min) / (max - min) : 0.5
      return { ...tp, d: Math.round(56 + Math.sqrt(norm) * 58) } // 56..114px
    })
    .sort((a, b) => b.d - a.d)
  return (
    <div className="psoc-bubbles">
      {sized.map((tp, i) => {
        const color = CATEGORY_COLORS[tp.category] || CATEGORY_COLORS.other
        return (
          <button
            key={tp.slug || i}
            type="button"
            className="psoc-bubble"
            style={{ '--d': `${tp.d}px`, '--cat': color }}
            onClick={() => onOpen(tp.slug)}
            title={tp.title}
          >
            <span className="psoc-bubble-circle">
              {tp.image ? (
                <img className="psoc-bubble-img" src={tp.image} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
              ) : (
                <span className="psoc-bubble-fallback">{(tp.title || '?')[0]}</span>
              )}
              {tp.lead?.yesPct != null && <span className="psoc-bubble-pct mono">{tp.lead.yesPct}%</span>}
            </span>
            <span className="psoc-bubble-name">{shortTitle(tp.title)}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function PredictionsSocialPanel({ events, dayMode, isMobile }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { topics, voices, feed, loading, error } = usePredictionsSocial(events, true)

  const stats = useMemo(() => {
    const accounts = new Set(feed.map((f) => f.handle))
    const totalEng = feed.reduce((s, f) => s + engagementOf(f), 0)
    const reach = voices.reduce((m, v) => Math.max(m, v.followers || 0), 0)
    return { topics: topics.length, posts: feed.length, voices: accounts.size, totalEng, reach }
  }, [topics, feed, voices])

  const goTopic = (slug) => { if (slug) navigate(`/predictions/${slug}`, { state: { fromWelcome: false } }) }

  /* ── Loading ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className={`psoc${dayMode ? ' psoc--day' : ''}`}>
        <PanelHeader t={t} stats={null} />
        <div className="psoc-grid">
          <div className="psoc-main">
            <div className="psoc-bubbles psoc-bubbles--skel">
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} className="psoc-bubble-circle psoc-skel" style={{ '--d': `${92 - i * 6}px`, width: `${92 - i * 6}px`, height: `${92 - i * 6}px` }} />
              ))}
            </div>
            <div className="psoc-feed">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="psoc-tweet psoc-skel" style={{ '--i': i }} />
              ))}
            </div>
          </div>
          {!isMobile && (
            <div className="psoc-side">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="psoc-voice psoc-skel" style={{ '--i': i }} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ── Empty / error ───────────────────────────────────────── */
  if (error || (topics.length === 0 && feed.length === 0)) {
    return (
      <div className={`psoc${dayMode ? ' psoc--day' : ''}`}>
        <PanelHeader t={t} stats={null} />
        <div className="psoc-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <p>{t('predictionsPage.social.empty')}</p>
        </div>
      </div>
    )
  }

  /* ── Loaded ──────────────────────────────────────────────── */
  return (
    <div className={`psoc${dayMode ? ' psoc--day' : ''}`}>
      <PanelHeader t={t} stats={stats} />

      <div className="psoc-grid">
        <div className="psoc-main">
          {/* Trending bubbles — what's loudest right now, sized by buzz */}
          {topics.length > 0 && (
            <>
              <div className="psoc-section-head">
                <h3 className="psoc-section-title">{t('predictionsPage.social.trendingTopics')}</h3>
                <span className="psoc-section-hint">{t('predictionsPage.social.byBuzz')}</span>
              </div>
              <TrendingBubbles topics={topics} onOpen={goTopic} />
            </>
          )}

          {/* The conversation (feed) */}
          <div className="psoc-section-head">
            <h3 className="psoc-section-title">{t('predictionsPage.social.conversation')}</h3>
            <span className="psoc-section-hint">{t('predictionsPage.social.byInfluence')}</span>
          </div>
          <div className="psoc-feed">
            {feed.map((tw) => {
              const color = CATEGORY_COLORS[tw.topicCategory] || CATEGORY_COLORS.other
              const openTweet = () => window.open(tw.url || xProfileUrl(tw.handle), '_blank', 'noopener,noreferrer')
              return (
                // Card is a clickable div (not <a>) — it nests an <a>/<button>
                // for the topic + links, which is invalid inside an anchor.
                <div
                  key={tw.id}
                  className="psoc-tweet"
                  role="link"
                  tabIndex={0}
                  onClick={openTweet}
                  onKeyDown={(e) => { if (e.key === 'Enter') openTweet() }}
                >
                  <img className="psoc-tw-avatar" src={tw.avatar} alt="" loading="lazy" onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(tw.handle)}` }} />
                  <div className="psoc-tw-body">
                    <div className="psoc-tw-head">
                      <span className="psoc-tw-name">{tw.name}</span>
                      {tw.is_verified && <VerifiedTick />}
                      <span className="psoc-tw-handle">{tw.handle}</span>
                      <span className="psoc-tw-dot">·</span>
                      <span className="psoc-tw-foll">{fmtCompact(tw.followers)} {t('predictionsPage.social.followers')}</span>
                      {tw.time && <span className="psoc-tw-time">{tw.time}</span>}
                    </div>
                    <p className="psoc-tw-text">{renderText(tw.text)}</p>
                    <div className="psoc-tw-foot">
                      {tw.topicSlug && (
                        <button
                          type="button"
                          className="psoc-tw-topic"
                          style={{ '--cat': color }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); goTopic(tw.topicSlug) }}
                          title={tw.topicTitle}
                        >
                          {tw.topicTitle}
                        </button>
                      )}
                      <span className="psoc-tw-stats mono">
                        <span title="likes">♥ {fmtCompact(tw.likes)}</span>
                        <span title="reposts">⇄ {fmtCompact(tw.retweets)}</span>
                        <span title="replies">↩ {fmtCompact(tw.comments)}</span>
                        {tw.views > 0 && <span title="views">◔ {fmtCompact(tw.views)}</span>}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top voices */}
        {!isMobile && voices.length > 0 && (
          <div className="psoc-side">
            <div className="psoc-section-head">
              <h3 className="psoc-section-title">{t('predictionsPage.social.topVoices')}</h3>
            </div>
            <div className="psoc-voices">
              {voices.map((v, i) => (
                <a
                  key={v.handle}
                  className="psoc-voice"
                  href={xProfileUrl(v.handle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ '--i': i }}
                >
                  <span className="psoc-voice-rank mono">{i + 1}</span>
                  <img className="psoc-voice-avatar" src={v.avatar} alt="" loading="lazy" onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(v.handle)}` }} />
                  <div className="psoc-voice-info">
                    <span className="psoc-voice-name">
                      {v.name}
                      {v.verified && <VerifiedTick />}
                    </span>
                    <span className="psoc-voice-handle">{v.handle}</span>
                  </div>
                  <div className="psoc-voice-stats">
                    <span className="psoc-voice-foll mono">{fmtCompact(v.followers)}</span>
                    <span className="psoc-voice-topics">{v.topicCount} {v.topicCount === 1 ? t('predictionsPage.social.topic') : t('predictionsPage.social.topics')}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mobile voices — below the feed */}
      {isMobile && voices.length > 0 && (
        <div className="psoc-mobile-voices">
          <div className="psoc-section-head">
            <h3 className="psoc-section-title">{t('predictionsPage.social.topVoices')}</h3>
          </div>
          <div className="psoc-voices-scroll">
            {voices.map((v) => (
              <a key={v.handle} className="psoc-voice-chip" href={xProfileUrl(v.handle)} target="_blank" rel="noopener noreferrer">
                <img className="psoc-voice-avatar" src={v.avatar} alt="" loading="lazy" onError={(e) => { e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(v.handle)}` }} />
                <span className="psoc-voice-handle">{v.handle}</span>
                <span className="psoc-voice-foll mono">{fmtCompact(v.followers)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PanelHeader({ t, stats }) {
  return (
    <div className="psoc-header">
      <div className="psoc-header-text">
        <div className="psoc-eyebrow">
          <span className="psoc-live-dot" />
          {t('predictionsPage.social.eyebrow')}
        </div>
        <h2 className="psoc-title">{t('predictionsPage.social.title')}</h2>
        <p className="psoc-subtitle">{t('predictionsPage.social.subtitle')}</p>
      </div>
      {stats && (
        <div className="psoc-header-stats">
          <Stat label={t('predictionsPage.social.statTopics')} value={stats.topics} />
          <Stat label={t('predictionsPage.social.statPosts')} value={stats.posts} />
          <Stat label={t('predictionsPage.social.statVoices')} value={stats.voices} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="psoc-stat">
      <span className="psoc-stat-value mono">{value}</span>
      <span className="psoc-stat-label">{label}</span>
    </div>
  )
}

function VerifiedTick() {
  return (
    <svg className="psoc-verified" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.68.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91c-1.31.66-2.19 1.91-2.19 3.34s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.66 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.66 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
    </svg>
  )
}
