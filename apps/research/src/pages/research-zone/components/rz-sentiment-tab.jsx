/**
 * Research Zone PRO — Sentiment Tab
 * Welcome-page language. Structure mirrors legacy RZ Pro Sentiment tab:
 *   SAChart → Overall Score + F&G → Market Pulse → Sentiment Summary →
 *   Current Happenings → Future Plans → Price Catalysts →
 *   Quality + Favourite → Influencer Tweets → Conclusion (Scenario)
 * All data comes from currently working APIs (spectre/ext/market).
 */
import React, { useMemo, lazy, Suspense } from 'react'
import { TwitterXIcon, GlobeIcon } from '../data/rz-icons.jsx'
import SectionShell from './rz-pro-sections/section-shell'
// Cosmos-engine KOL universe — lazy so three.js never lands in the RZ chunk
const RzKolCosmos = lazy(() => import('./rz-kol-cosmos'))
import RzMentionsPanel from './rz-mentions-panel'
import RzSentimentCommand from './rz-sentiment-command'
import RzSentimentPriceChart from './rz-sentiment-price-chart'
import RzSocialIntel from './rz-social-intel'
import RzMarketContext, { classifyTokenClass } from './rz-market-context'
import RzAiSentimentRead from './rz-ai-sentiment-read'
import RzProjectDossier from './rz-project-dossier'
import RzNarrativeRadar from './rz-narrative-radar'
import RzFundamentals from './rz-fundamentals'
import useSentimentEngine from '../data/useSentimentEngine'
import './rz-sentiment-tab.css'


/* ── Helpers ──────────────────────────────────────────────────────────────────── */

function formatCompact(n) {
  if (n == null || n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return `${n}`
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  if (isNaN(then)) return dateStr
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 4. SOCIAL LINKS — Token social profiles from spectreSocial
 * ───────────────────────────────────────────────────────────────────────────── */

const TelegramIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
)

const RedditIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 6.627 5.373 12 12 12s12-5.373 12-12C24 5.373 18.627 0 12 0zm6.244 13.38c.058.318.088.645.088.978 0 3.312-3.862 5.997-8.624 5.997s-8.624-2.685-8.624-5.997c0-.338.032-.67.093-.994a1.611 1.611 0 01-.674-1.308c0-.89.723-1.612 1.612-1.612.44 0 .838.177 1.128.464 1.483-.967 3.465-1.567 5.66-1.631l1.17-3.7a.382.382 0 01.458-.262l2.695.635c.233-.526.756-.9 1.364-.9a1.524 1.524 0 010 3.048 1.522 1.522 0 01-1.5-1.268l-2.4-.565-.99 3.124c2.095.084 3.983.685 5.412 1.628.292-.296.698-.48 1.146-.48.89 0 1.612.723 1.612 1.612 0 .536-.262 1.01-.663 1.303zM8.97 12.186c-.84 0-1.524.683-1.524 1.524 0 .84.683 1.524 1.524 1.524s1.524-.683 1.524-1.524c0-.84-.683-1.524-1.524-1.524zm6.06 0c-.84 0-1.524.683-1.524 1.524 0 .84.683 1.524 1.524 1.524.84 0 1.524-.683 1.524-1.524 0-.84-.684-1.524-1.524-1.524zm-5.83 4.606a.382.382 0 01.538 0c.742.742 2.007 1.074 3.262 1.074s2.52-.332 3.262-1.074a.382.382 0 01.538.538c-.89.89-2.375 1.298-3.8 1.298s-2.91-.408-3.8-1.298a.382.382 0 010-.538z"/>
  </svg>
)

const DiscordIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
)

const SocialLinks = React.memo(({ spectreSocial }) => {
  if (!spectreSocial?.Social_Media) return null

  const sm = spectreSocial.Social_Media
  const links = []

  if (sm.Twitter) links.push({ name: 'Twitter', url: sm.Twitter, icon: <TwitterXIcon size={14} /> })
  if (sm.Telegram) links.push({ name: 'Telegram', url: sm.Telegram, icon: <TelegramIcon size={14} /> })
  if (sm.Reddit) links.push({ name: 'Reddit', url: sm.Reddit, icon: <RedditIcon size={14} /> })
  if (sm.Discord) links.push({ name: 'Discord', url: sm.Discord, icon: <DiscordIcon size={14} /> })
  if (sm.Website || spectreSocial.Website) links.push({ name: 'Website', url: sm.Website || spectreSocial.Website, icon: <GlobeIcon size={14} /> })

  if (!links.length) return null

  return (
    <div className="rz-se2-social-links">
      {links.map(l => (
        <a
          key={l.name}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rz-se2-social-link"
          title={l.name}
        >
          {l.icon}
          <span>{l.name}</span>
        </a>
      ))}
    </div>
  )
})


/* ─────────────────────────────────────────────────────────────────────────────
 * 5. SOCIAL FEED — Real tweets from API, no mock fallback
 * ───────────────────────────────────────────────────────────────────────────── */

const SocialFeed = React.memo(({ tweets, tokenName }) => {
  // null = still loading, [] = loaded but empty
  if (tweets === null) {
    return (
      <div className="rz-se2-section">
        <div className="rz-se2-feed-shimmers">
          {[0,1,2].map(i => (
            <div key={i} className="rz-se2-feed-shimmer">
              <div className="rz-se2-shimmer-head">
                <div className="rz-se2-shimmer-avi animate-shimmer" />
                <div className="rz-se2-shimmer-lines">
                  <div className="rz-se2-shimmer-line animate-shimmer" style={{ width: '40%' }} />
                  <div className="rz-se2-shimmer-line animate-shimmer" style={{ width: '25%' }} />
                </div>
              </div>
              <div className="rz-se2-shimmer-line animate-shimmer" style={{ width: '100%', height: 12 }} />
              <div className="rz-se2-shimmer-line animate-shimmer" style={{ width: '80%', height: 12 }} />
              <div className="rz-se2-shimmer-stats">
                {[0,1,2,3].map(j => (
                  <div key={j} className="rz-se2-shimmer-stat animate-shimmer" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!tweets.length) {
    return (
      <div className="rz-se2-section rz-se2-feed-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>No social data for {tokenName}</span>
      </div>
    )
  }

  return (
    <div className="rz-se2-section">
      <div className="rz-se2-feed">
        {tweets.map(tw => {
          const tweetUrl = tw.url || `https://x.com/${(tw.handle || '').replace(/^@/, '')}`
          const time = formatRelativeTime(tw.time) || tw.time || ''
          const body = tw.content || tw.text || ''
          const hasMedia = tw.mediaUrl && tw.mediaType === 'photo'

          return (
            <article
              key={tw.id}
              className={`rz-se2-tweet${hasMedia ? ' has-media' : ''}`}
              onClick={() => tweetUrl && window.open(tweetUrl, '_blank', 'noopener,noreferrer')}
            >
              <span className="rz-se2-tweet-x" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"/></svg>
              </span>

              {hasMedia && (
                <div className="rz-se2-tweet-media">
                  <img
                    src={tw.mediaUrl}
                    alt=""
                    loading="lazy"
                    onError={e => {
                      const wrap = e.target.closest('.rz-se2-tweet-media')
                      if (wrap) wrap.style.display = 'none'
                    }}
                  />
                </div>
              )}

              <div className="rz-se2-tweet-content">
                <div className="rz-se2-tweet-head">
                  {tw.avatar && (
                    <span className="rz-se2-tweet-avi-wrap">
                      <img
                        src={tw.avatar}
                        alt=""
                        className="rz-se2-tweet-avi"
                        onError={e => { e.target.style.display = 'none' }}
                      />
                    </span>
                  )}
                  <div className="rz-se2-tweet-who">
                    <span className="rz-se2-tweet-name">{tw.name}</span>
                    {time && <span className="rz-se2-tweet-time">{time}</span>}
                  </div>
                </div>

                <p className="rz-se2-tweet-body">{body.length > 140 ? body.slice(0, 140) + '…' : body}</p>

                <div className="rz-se2-tweet-stats">
                  {tw.likes > 0 && (
                    <span className="rz-se2-tweet-stat">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                      {formatCompact(tw.likes)}
                    </span>
                  )}
                  {tw.retweets > 0 && (
                    <span className="rz-se2-tweet-stat">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                      {formatCompact(tw.retweets)}
                    </span>
                  )}
                  {tw.views > 0 && (
                    <span className="rz-se2-tweet-stat">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      {formatCompact(tw.views)}
                    </span>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
})


/** Price Catalysts — sourced from fundamentalsGrades + tokenProfile */
const PriceCatalystsBody = React.memo(({ catalysts }) => {
  if (!catalysts?.length) return null
  return (
    <ul className="rz-se2-catalysts">
      {catalysts.map((c, i) => (
        <li key={i} className="rz-se2-catalyst">
          <span className="rz-se2-catalyst-dot" />
          <span className="rz-se2-catalyst-text">{c}</span>
        </li>
      ))}
    </ul>
  )
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 10. INFLUENCER TWEETS — Top 4 tweets by engagement in a grid
 * ───────────────────────────────────────────────────────────────────────────── */

const InfluencerTweetsSection = React.memo(({ tweets, sym }) => {
  if (!tweets || tweets.length < 1) return null

  const sorted = useMemo(() => {
    return [...tweets]
      .sort((a, b) => {
        const engA = (a.likes || 0) + (a.retweets || 0) * 2 + (a.views || 0) * 0.01
        const engB = (b.likes || 0) + (b.retweets || 0) * 2 + (b.views || 0) * 0.01
        return engB - engA
      })
      .slice(0, 12)
  }, [tweets])

  return (
    <div className="rz-se2-influencer-grid">
      {sorted.map(tw => {
        const handle = (tw.handle || '').replace(/^@/, '')
        const tweetUrl = tw.url || (handle ? `https://x.com/${handle}` : '')
        const body = tw.content || tw.text || ''
        const time = formatRelativeTime(tw.time) || tw.time || ''
        const hasMedia = !!(tw.mediaUrl && (!tw.mediaType || tw.mediaType === 'photo'))
        const sentClass = tw.sentimentScore == null
          ? ''
          : tw.sentimentScore >= 7 ? 'positive'
          : tw.sentimentScore <= 3 ? 'negative'
          : ''

        return (
          <article
            key={tw.id}
            className={`rz-se2-inf-card${hasMedia ? ' has-media' : ''}`}
            role="link"
            tabIndex={0}
            onClick={() => tweetUrl && window.open(tweetUrl, '_blank', 'noopener,noreferrer')}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && tweetUrl) {
                e.preventDefault()
                window.open(tweetUrl, '_blank', 'noopener,noreferrer')
              }
            }}
          >
            <header className="rz-se2-inf-head">
              {tw.avatar && (
                <img
                  src={tw.avatar}
                  alt=""
                  className="rz-se2-inf-avi"
                  loading="lazy"
                  onError={e => { e.target.style.display = 'none' }}
                />
              )}
              <div className="rz-se2-inf-who">
                <span className="rz-se2-inf-name">{tw.name || handle}</span>
                {handle && <span className="rz-se2-inf-handle">@{handle}</span>}
              </div>
              {time && <span className="rz-se2-inf-time">{time}</span>}
              <span className="rz-se2-inf-x" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"/></svg>
              </span>
            </header>

            <p className="rz-se2-inf-body">
              {body.length > 160 ? body.slice(0, 160) + '…' : body}
            </p>

            {hasMedia && (
              <div className="rz-se2-inf-media">
                <img
                  src={tw.mediaUrl}
                  alt=""
                  loading="lazy"
                  onError={e => {
                    const wrap = e.target.closest('.rz-se2-inf-media')
                    if (wrap) wrap.style.display = 'none'
                  }}
                />
              </div>
            )}

            <footer className="rz-se2-inf-footer">
              <div className="rz-se2-inf-stats">
                {tw.likes > 0 && (
                  <span className="rz-se2-inf-stat" title="Likes">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    <span className="mono">{formatCompact(tw.likes)}</span>
                  </span>
                )}
                {tw.retweets > 0 && (
                  <span className="rz-se2-inf-stat" title="Retweets">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                    <span className="mono">{formatCompact(tw.retweets)}</span>
                  </span>
                )}
                {tw.views > 0 && (
                  <span className="rz-se2-inf-stat" title="Views">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span className="mono">{formatCompact(tw.views)}</span>
                  </span>
                )}
              </div>
              {tw.sentimentScore != null && (
                <span className={`rz-se2-inf-sent ${sentClass}`}>
                  <span className="mono">{tw.sentimentScore.toFixed(1)}</span>
                </span>
              )}
            </footer>
          </article>
        )
      })}
    </div>
  )
})


/* ─────────────────────────────────────────────────────────────────────────────
 * MAIN EXPORT
 * ───────────────────────────────────────────────────────────────────────────── */

function SentimentTab({
  sym, td, dayMode,
  spectreTweets,
  influencerTweets, socialFeedTweets,
  spectreSocial,
  tokenProfile,
  fundamentalsGrades,
}) {
  // Each section gets its OWN source so Influencer Tweets (xdash, KOL-only)
  // and Social (live feed, chronological) show genuinely different content.
  // Both fall back to the combined `spectreTweets` array when the dedicated
  // fetchers haven't been wired upstream yet (mobile, older callers).
  const influencer = influencerTweets ?? spectreTweets ?? null
  const social = socialFeedTweets ?? spectreTweets ?? null

  // Price catalysts: merge from fundamentalsGrades + tokenProfile
  const catalysts = useMemo(() => {
    const a = fundamentalsGrades?.catalysts || []
    const b = tokenProfile?.token_details?.catalysts || []
    const merged = [...a, ...b].filter(Boolean)
    // De-dupe by lowercase
    const seen = new Set()
    const unique = []
    for (const c of merged) {
      const k = String(c).toLowerCase().trim()
      if (!seen.has(k)) { seen.add(k); unique.push(c) }
    }
    return unique
  }, [fundamentalsGrades?.catalysts, tokenProfile?.token_details?.catalysts])

  // The sentiment engine — mindshare v2, x-bubbles, X Dash forensics, momentum
  // origin, deterministic signals. Self-fetching + module-cached, so it stays
  // off the ticking td price path (the memo comparator below ignores prices).
  // td rides along as the identity-anchored market row: the engine uses it to
  // reject symbol-collision /v1/prices rows (wrong token sharing the ticker)
  // and to compute the since-tracked ROI against the live market cap.
  const engine = useSentimentEngine(sym, td?.cgId || null, { tokenData: td })
  const tokenClass = useMemo(() => classifyTokenClass({
    sym,
    rank: engine.market?.rank,
    marketCap: engine.market?.marketCap,
    categories: engine.market?.categories,
    primaryCategory: engine.market?.primaryCategory,
  }), [sym, engine.market])

  return (
    <div className="rz-se2-container">
      {/* 1 — Engine topline: crowd gauge + verdict + signal pills + stance */}
      <RzSentimentCommand sym={sym} engine={engine} dayMode={dayMode} />

      {/* 1b — Project dossier: what this IS and what it does for the space —
              the fundamentals frame the crowd read assumes. */}
      <SectionShell
        id="sent-project-dossier"
        label="SENTIMENT · PROJECT DOSSIER"
        title={`What is $${sym}`}
        subtitle="What the project does, how it works, and where it sits in the market"
        collapsible
      >
        <RzProjectDossier sym={sym} cgId={td?.cgId || null} name={td?.name || sym} dayMode={dayMode} />
      </SectionShell>

      {/* 1c — Fundamentals: real supply/protocol data (unlock overhang + TVL).
              Only for tokens that have them — memecoins skip it entirely. */}
      {engine.fundamentals && (
        <SectionShell
          id="sent-fundamentals"
          label="SENTIMENT · FUNDAMENTALS"
          title="Supply & Protocol"
          subtitle="Token unlock schedule and protocol TVL — the hard supply/adoption data behind the read"
          collapsible
        >
          <RzFundamentals fundamentals={engine.fundamentals} dayMode={dayMode} />
        </SectionShell>
      )}

      {/* 2 — The centerpiece: crowd sentiment overlaid on price + mention flow */}
      <SectionShell
        id="sent-price-overlay"
        label="SENTIMENT · CROWD VS PRICE"
        title="Sentiment vs Price"
        subtitle="LLM-classified crowd sentiment against price, with raw mention flow"
        liveBadge
        collapsible
      >
        <RzSentimentPriceChart sym={sym} cgId={td?.cgId || null} engine={engine} dayMode={dayMode} />
      </SectionShell>

      {/* 3 — AI desk read: LLM synthesis over the same verified inputs */}
      <SectionShell
        id="sent-ai-read"
        label="SENTIMENT · DESK READ"
        title="AI Sentiment Read"
        subtitle="Synthesis over the engine's verified numbers — thesis, risks, invalidations"
        collapsible
      >
        <RzAiSentimentRead sym={sym} cgId={td?.cgId || null} dayMode={dayMode} />
      </SectionShell>

      {/* 4 — Narrative radar: Brain narratives + policy/macro tape + catalysts */}
      <SectionShell
        id="sent-narrative-radar"
        label="SENTIMENT · NARRATIVE RADAR"
        title="Narrative & Catalysts"
        subtitle={tokenClass.isMeme
          ? `Token-specific news and Brain reads — the macro tape doesn't drive a memecoin`
          : tokenClass.key === 'micro' || tokenClass.key === 'nano'
            ? 'Token-specific news and Brain reads — the policy tape is muted at this size'
            : 'Spectre Brain narratives, the policy tape and dated catalysts moving this market'}
        collapsible
      >
        <RzNarrativeRadar sym={sym} tokenClass={tokenClass} dayMode={dayMode} />
      </SectionShell>

      {/* 5 — X Dash forensics: signal score, lifecycle, quality, tracked ROI */}
      <SectionShell
        id="sent-social-intel"
        label="SENTIMENT · X DASH INTELLIGENCE"
        title="Social Intelligence"
        subtitle="Chatter quality, attention lifecycle and the since-tracked receipt"
        collapsible
      >
        <RzSocialIntel sym={sym} engine={engine} dayMode={dayMode} />
      </SectionShell>

      {/* 5 — Behavior-aware macro: what actually drives this class of token */}
      <SectionShell
        id="sent-market-context"
        label="SENTIMENT · MARKET CONTEXT"
        title="Market Context"
        subtitle="The macro drivers that matter for this token's size and type"
        collapsible
      >
        <RzMarketContext sym={sym} engine={engine} dayMode={dayMode} />
      </SectionShell>

      {/* Cross-platform mentions — X / TG / Reddit / YT aggregated, sentiment-tagged */}
      <RzMentionsPanel asset={sym} sym={sym} />

      {/* KOL Bubbles — Twitter network of voices talking about the token */}
      <SectionShell
        id="sent-kol-bubbles"
        label="SENTIMENT · KOL NETWORK"
        title="KOL Bubbles"
        subtitle={`Voices talking about $${sym} · sized by followers`}
        liveBadge
        collapsible
      >
        <Suspense fallback={<div style={{ height: 480 }} />}>
          <RzKolCosmos
            symbol={sym}
            cgId={td?.cgId || null}
            tokenLogo={td?.logo || null}
            tokenName={td?.name || sym}
            dayMode={dayMode}
            height={480}
          />
        </Suspense>
      </SectionShell>

      {/* Influencer Tweets — xdash KOL roster (followers ≥ 50K or verified) */}
      {influencer?.length > 0 && (
        <SectionShell
          id="sent-influencers"
          label="SENTIMENT · INFLUENCER TWEETS"
          title="Influencer Tweets"
          subtitle="Top voices by engagement"
          collapsible
        >
          <InfluencerTweetsSection tweets={influencer} sym={sym} />
        </SectionShell>
      )}

      {/* Social — chronological live feed, no follower gate */}
      {social?.length > 0 && (
        <SectionShell
          id="sent-social"
          label="SENTIMENT · SOCIAL"
          title="Social"
          subtitle={`Live feed for $${sym}`}
          liveBadge
          collapsible
        >
          <SocialLinks spectreSocial={spectreSocial} />
          <SocialFeed tweets={social} tokenName={sym} />
        </SectionShell>
      )}

    </div>
  )
}

// Selective comparator (mirrors areTechnicalsEqual in rz-technicals-tab).
// A price tick produces a fresh `td` object identity; we skip re-render on
// changes to fields the tab does NOT read, but SentimentTab passes the whole
// `td` into useSentimentEngine (:408), which reads td.price/change24h/change7d/
// marketCap/mcap/fdv/rank/totalSupply — for the since-tracked ROI vs LIVE mcap,
// the "Price-Led Move" verdict, and Market-Pulse price/mcap/24h. So those DO
// tick and MUST be compared: the old comparator wrongly claimed the tab reads
// only cgId/logo/name, which froze Market Pulse + ROI at the last render's td.
function areSentimentEqual(prev, next) {
  if (prev.sym !== next.sym) return false
  if (prev.dayMode !== next.dayMode) return false
  const a = prev.td || {}
  const b = next.td || {}
  if (a.cgId !== b.cgId) return false
  if (a.logo !== b.logo) return false
  if (a.name !== b.name) return false
  // Market fields the engine reads off td — ticking, so compared here:
  if (a.price !== b.price) return false
  if (a.change24h !== b.change24h) return false
  if (a.change7d !== b.change7d) return false
  if (a.marketCap !== b.marketCap) return false
  if (a.mcap !== b.mcap) return false
  if (a.fdv !== b.fdv) return false
  if (a.rank !== b.rank) return false
  if (a.totalSupply !== b.totalSupply) return false
  // Everything else — independent of the price path, compare by identity
  if (prev.spectreTweets !== next.spectreTweets) return false
  if (prev.influencerTweets !== next.influencerTweets) return false
  if (prev.socialFeedTweets !== next.socialFeedTweets) return false
  if (prev.spectreSocial !== next.spectreSocial) return false
  if (prev.tokenProfile !== next.tokenProfile) return false
  if (prev.fundamentalsGrades !== next.fundamentalsGrades) return false
  return true
}

export default React.memo(SentimentTab, areSentimentEqual)
