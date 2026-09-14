import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNewsTime } from '../data/rz-constants';
import { getXdashFeedHealth } from '@/services/spectreApi';
import { shortExchange } from '@/lib/exchange-label';

// `label` is the t() default, not the rendered string - see the render sites.
const TWEET_SEGMENTS = [
  { key: 'posts', i18nKey: 'researchZone.feedProjectPosts', label: 'Project Posts' },
  { key: 'replies', i18nKey: 'researchZone.feedReplies', label: 'Replies' },
  { key: 'community', i18nKey: 'researchZone.feedCommunity', label: 'Community' },
  { key: 'influencers', i18nKey: 'researchZone.feedKols', label: 'KOLs' },
  { key: 'all', i18nKey: 'researchZone.feedAll', label: 'All' },
]

function formatCompact(num) {
  if (num == null) return '0'
  const n = typeof num === 'string' ? parseInt(num.replace(/,/g, ''), 10) : num
  if (isNaN(n)) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

const ViewsIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
)

const CommentIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

const RzFeedPanel = React.memo(function RzFeedPanel({
  rightFeedTab,
  setRightFeedTab,
  symbol,
  tokenName,
  isStock,
  newsItems,
  newsLoading,
  newsSource,
  lastNewsUpdate,
  fetchNews,
  aboutDetails,
  stockData,
  icons,
  fmtLarge,
  hideHeader,
  spectreTweets,
  searchTweets,
  tweets, // parent passes the live KOL+community blend as `tweets` (alias of searchTweets)
  tweetsLoading,
  agentSignals,
}) {
  const { t } = useTranslation();
  const [tweetSegment, setTweetSegment] = useState('all')
  // Sort: 'latest' = strict recency (the live-conversation view, default);
  // 'top' = the quality ranking (followers/engagement/substance).
  const [tweetSort, setTweetSort] = useState('latest')
  // Minimum-followers filter: 0 = anyone, 10k, 50k.
  const [tweetMinFol, setTweetMinFol] = useState(0)

  useEffect(() => {
    setTweetSegment('all')
  }, [symbol])

  // Categorize tweets: official = project posts/replies, search = community/KOLs.
  //
  // Quality bars:
  //   - KOLs        followers ≥ 50k, OR (verified/dossier AND ≥ 20k).
  //                 Neither a blue check nor an X-Dash dossier alone is a KOL
  //                 signal: Twitter Blue is near-universal on crypto Twitter,
  //                 and X Dash writes a dossier for EVERY author it ingests
  //                 (a 7k-follower account has one). Counting either without a
  //                 follower floor emptied the Community tab to zero.
  //   - Community   anyone NOT classified as a KOL, with any signal of life
  //                 (≥ 100 followers OR ≥ 50 views OR ≥ 1 like) — so the
  //                 Community tab is rarely empty for active tokens. Bots with
  //                 zero engagement still get dropped from "all".
  const categorized = useMemo(() => {
    const official = spectreTweets || []
    // Accept either prop name — the parent passes the live blend as `tweets`,
    // older callers pass `searchTweets`. Without this coalesce the KOL +
    // community segments silently render empty (the "tweets down" bug).
    const search = searchTweets || tweets || []
    const projectHandle = String(aboutDetails?.links?.twitter || '')
      .replace(/^https?:\/\/(twitter\.com|x\.com)\//i, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@/, '')
      .toLowerCase()

    const posts = official.filter(t => {
      const text = (t.content || t.text || '').trim()
      return !text.startsWith('RT @') && !text.startsWith('@')
    })

    const isReplyText = (t) => {
      const text = String(t.tweet_text || t.content || t.text || '').trim()
      return text.startsWith('@')
    }
    const isKol = (t) =>
      (t.followers || 0) >= 50000 ||
      ((t.is_verified === true || t.has_dossier === true) && (t.followers || 0) >= 20000)
    const hasLife = (t) =>
      (t.followers || 0) >= 100 ||
      (t.views || 0) >= 50 ||
      (t.like_count || t.likes || 0) >= 1
    const isCommunity = (t) => !isKol(t) && hasLife(t)

    // Rank KOLs by follower count first (biggest accounts surface first —
    // @cryptocom, @VitalikButerin, etc.), then by engagement so a megaphone
    // tweet from a 500k account beats a quiet one from a 200k account.
    // Then take substance into account: tweets ≥ 80 chars get a boost so
    // thesis-style posts outrank one-liner shills.
    const engagementScore = (t) =>
      (t.views || 0) +
      (t.like_count || t.likes || 0) * 5 +
      (t.retweet_count || t.retweets || 0) * 12 +
      (t.comments || t.replies || 0) * 4
    const substanceBoost = (t) => {
      const text = String(t.tweet_text || t.content || t.text || '')
      // Drop pure-shill / giveaway / engagement-farming tweets to the bottom.
      const shill = /\b(giveaway|airdrop|retweet to win|follow.*retweet|drop.*wallet)\b/i.test(text)
      if (shill) return -1
      return text.length >= 80 ? 1 : 0
    }
    const kolRank = (a, b) => {
      const sa = substanceBoost(a), sb = substanceBoost(b)
      if (sa !== sb) return sb - sa
      const fa = a.followers || 0, fb = b.followers || 0
      if (Math.abs(fa - fb) > 5000) return fb - fa
      return engagementScore(b) - engagementScore(a)
    }
    const communityRank = (a, b) => {
      const sa = substanceBoost(a), sb = substanceBoost(b)
      if (sa !== sb) return sb - sa
      const ea = engagementScore(a), eb = engagementScore(b)
      if (Math.abs(ea - eb) > 50) return eb - ea
      return (b.followers || 0) - (a.followers || 0)
    }

    const influencers = search.filter((t) => !isReplyText(t) && isKol(t)).sort(kolRank)
    const community = search.filter((t) => !isReplyText(t) && isCommunity(t)).sort(communityRank)

    const officialReplies = official.filter(t => {
      const text = (t.content || t.text || '').trim()
      return text.startsWith('@') && !text.startsWith('RT @')
    })
    const projectMentionReplies = projectHandle
      ? search.filter(t => {
          const text = String(t.tweet_text || t.content || t.text || '').trim()
          return text.toLowerCase().startsWith(`@${projectHandle}`)
        })
      : []
    const replies = [...officialReplies, ...projectMentionReplies]

    // Lead with the LIVE conversation (KOLs + community mentions), THEN the
    // project's own posts. A dead project's stale timeline should never be the
    // first thing the social feed shows — live chatter is the signal.
    const seenAll = new Set()
    const all = [...influencers, ...community, ...posts].filter((t) => {
      const id = t?.id
      if (id == null) return true
      if (seenAll.has(id)) return false
      seenAll.add(id)
      return true
    })
    return { posts, replies, community, influencers, all }
  }, [spectreTweets, searchTweets, tweets, aboutDetails?.links?.twitter])

  // Apply the user controls on top of the categorized lists: follower floor,
  // then ordering. 'top' keeps each segment's quality ranking; 'latest' is a
  // strict recency sort on the parsed tweet timestamp (undated rows sink).
  const applyControls = useMemo(() => (list) => {
    let out = tweetMinFol ? list.filter((t) => (t.followers || 0) >= tweetMinFol) : list
    if (tweetSort === 'latest') out = [...out].sort((a, b) => (b.ts || 0) - (a.ts || 0))
    return out
  }, [tweetMinFol, tweetSort])

  const filtered = useMemo(() => ({
    posts: applyControls(categorized.posts),
    replies: applyControls(categorized.replies),
    community: applyControls(categorized.community),
    influencers: applyControls(categorized.influencers),
    all: applyControls(categorized.all),
  }), [categorized, applyControls])

  const activeTweets = filtered[tweetSegment] || filtered.all
  // Counts per segment so the sub-tabs can show "(N)" and the empty state
  // can point the user to a tab that has content. Reflect the follower
  // filter so the numbers always match what a click will show.
  const segmentCounts = useMemo(() => ({
    posts: filtered.posts.length,
    replies: filtered.replies.length,
    community: filtered.community.length,
    influencers: filtered.influencers.length,
    all: filtered.all.length,
  }), [filtered])

  return (
    <div className="research-zone-lite-feed-panel">
      <section className="research-zone-lite-right-block research-zone-lite-right-feed-block">
        {!hideHeader && (
          <div className="research-zone-lite-feed-header">
            <div className="research-zone-lite-feed-toggle" role="tablist" aria-label={t('researchZone.ariaFeedToggle', 'Feed: Agent RSS, News, or Tweets')}>
              <button type="button" role="tab" aria-selected={rightFeedTab === 'agent'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'agent' ? 'active' : ''}`} onClick={() => setRightFeedTab('agent')}>
                <span className="research-zone-lite-feed-tab-icon" aria-hidden>{icons.rss}</span>
                {t('researchLite.agentRss')}
              </button>
              <button type="button" role="tab" aria-selected={rightFeedTab === 'news'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'news' ? 'active' : ''}`} onClick={() => setRightFeedTab('news')}>
                <span className="research-zone-lite-feed-tab-icon" aria-hidden>{icons.news}</span>
                {t('researchLite.news')}
              </button>
              <button type="button" role="tab" aria-selected={rightFeedTab === 'tweets'} className={`research-zone-lite-feed-tab ${rightFeedTab === 'tweets' ? 'active' : ''}`} onClick={() => setRightFeedTab('tweets')}>
                <span className="research-zone-lite-feed-tab-icon" aria-hidden>{icons.twitter}</span>
                {t('researchLite.tweets')}
              </button>
            </div>
            {rightFeedTab === 'news' && (
              <button type="button" className="research-zone-lite-news-refresh-btn" onClick={fetchNews} title={t('researchZone.refreshNews', 'Refresh news')} aria-label={t('researchZone.refreshNews', 'Refresh news')}><span className="research-zone-lite-news-refresh-icon" aria-hidden>{icons.refresh}</span></button>
            )}
          </div>
        )}
        {rightFeedTab === 'agent' && (
          <div className="research-zone-lite-feed-content research-zone-lite-feed-content-agent">
            <div className="research-zone-lite-agent-list" role="feed" aria-label={`Agent signals about ${tokenName}`}>
              {(agentSignals || []).length > 0 ? (agentSignals || []).map((signal) => {
                const dir = signal.metadata?.direction || 'neutral'
                const ts = signal.createdAt ? Math.floor(new Date(signal.createdAt).getTime() / 1000) : null
                return (
                  <article key={signal.id} className={`research-zone-lite-agent-item rz-agent-item rz-agent-item--${dir}`}>
                    <div className="rz-agent-item-head">
                      <span className={`rz-agent-item-cat rz-agent-item-cat--${signal.category || 'brain'}${signal.metadata?.major ? ' rz-agent-item-cat--keyevent' : ''}`}>{signal.metadata?.major ? 'key event' : (signal.category || 'signal')}</span>
                      <span className="rz-agent-item-score">{signal.score}</span>
                      {ts && <span className="rz-agent-item-time">{formatNewsTime(ts)}</span>}
                    </div>
                    <div className="rz-agent-item-headline">{signal.headline}</div>
                    {signal.detail && signal.detail !== signal.headline && (
                      <div className="rz-agent-item-detail">{signal.detail}</div>
                    )}
                  </article>
                )
              }) : (
                <div className="rz-feed-empty">{t('researchZone.noAgentSignals', 'No agent signals available')}</div>
              )}
            </div>
          </div>
        )}
        {rightFeedTab === 'news' && (
          <div className="research-zone-lite-feed-content research-zone-lite-feed-content-news">
            {lastNewsUpdate != null && (
              <span className="research-zone-lite-feed-updated">
                {newsSource === 'CryptoPanic' ? 'CryptoPanic' : newsSource === 'CryptoCompare' ? 'CryptoCompare' : newsSource === 'RSS' ? 'RSS' : 'News'} · {formatNewsTime(Math.floor(lastNewsUpdate / 1000)) === 'Just now' ? 'just now' : formatNewsTime(Math.floor(lastNewsUpdate / 1000)) + ' ago'}
              </span>
            )}
            <div className="research-zone-lite-news-list" role="feed" aria-label={`News about ${tokenName}`}>
              {newsItems.length === 0 ? (
                newsLoading ? (
                  <div className="rz-news-skeleton" aria-busy="true" aria-label={t('researchZone.ariaLoadingNews', 'Loading news')}>
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="rz-news-skeleton-item">
                        <div className="rz-news-skeleton-thumb animate-shimmer" />
                        <div className="rz-news-skeleton-lines">
                          <div className="rz-news-skeleton-line animate-shimmer" />
                          <div className="rz-news-skeleton-line rz-news-skeleton-line--short animate-shimmer" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rz-news-empty">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" aria-hidden>
                      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" />
                    </svg>
                    <span className="rz-news-empty__text">{t('researchZone.noRecentNews', 'No recent news for {{name}}.', { name: tokenName })}</span>
                    <button type="button" className="rz-news-empty__btn" onClick={fetchNews}>{t('researchZone.refresh', 'Refresh')}</button>
                  </div>
                )
              ) : (
                newsItems.map((item) => (
                  <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="research-zone-lite-news-item" role="article">
                    {item.imageUrl && (
                      <div className="research-zone-lite-news-item-thumb">
                        <img src={item.imageUrl} alt="" loading="lazy" />
                      </div>
                    )}
                    <div className="research-zone-lite-news-item-body">
                      <span className="research-zone-lite-news-item-meta">
                        {item.source} · {formatNewsTime(item.publishedOn)}
                      </span>
                      <span className="research-zone-lite-news-item-title">{item.title}</span>
                      {item.summary && (
                        <span className="research-zone-lite-news-item-summary">{item.summary}</span>
                      )}
                    </div>
                    <span className="research-zone-lite-news-item-external" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </a>
                ))
              )}
            </div>
          </div>
        )}
        {rightFeedTab === 'tweets' && (
          <div className="research-zone-lite-feed-content research-zone-lite-feed-content-tweets">
            <div className="rz-tw-segments" role="tablist">
              {TWEET_SEGMENTS.map(seg => {
                const count = segmentCounts[seg.key] || 0
                return (
                  <button
                    key={seg.key}
                    type="button"
                    role="tab"
                    aria-selected={tweetSegment === seg.key}
                    className={`rz-tw-seg${tweetSegment === seg.key ? ' rz-tw-seg--active' : ''}${count === 0 ? ' rz-tw-seg--empty' : ''}`}
                    onClick={() => setTweetSegment(seg.key)}
                  >
                    {t(seg.i18nKey, seg.label)}
                    {count > 0 && <span className="rz-tw-seg__count">{count}</span>}
                  </button>
                )
              })}
            </div>
            <div className="rz-tw-controls">
              <div className="rz-tw-ctrl-group" role="group" aria-label={t('researchZone.ariaSortTweets', 'Sort tweets')}>
                {[{ v: 'latest', k: 'researchZone.tweetSortLatest', l: 'Latest' }, { v: 'top', k: 'researchZone.tweetSortTop', l: 'Top' }].map(({ v, k, l }) => (
                  <button
                    key={v}
                    type="button"
                    className={`rz-tw-ctrl${tweetSort === v ? ' rz-tw-ctrl--active' : ''}`}
                    aria-pressed={tweetSort === v}
                    onClick={() => setTweetSort(v)}
                  >
                    {t(k, l)}
                  </button>
                ))}
              </div>
              <div className="rz-tw-ctrl-group" role="group" aria-label={t('researchZone.ariaMinFollowers', 'Minimum followers')}>
                {[{ v: 0, k: 'researchZone.followersAny', l: 'Any' }, { v: 10000, k: null, l: '10K+' }, { v: 50000, k: null, l: '50K+' }].map(({ v, k, l }) => (
                  <button
                    key={v}
                    type="button"
                    className={`rz-tw-ctrl${tweetMinFol === v ? ' rz-tw-ctrl--active' : ''}`}
                    aria-pressed={tweetMinFol === v}
                    onClick={() => setTweetMinFol(v)}
                  >
                    {k ? t(k, l) : l}
                  </button>
                ))}
              </div>
            </div>
            {!tweetsLoading && (segmentCounts.community + segmentCounts.influencers) === 0 && segmentCounts.posts > 0 && (
              <div className="rz-tw-stale-note" role="note">
                {t('researchZone.staleProjectPostsNote', "No live mentions for {{name}} right now - showing the project's own posts, which may be stale. Live chatter is the signal.", { name: tokenName })}
              </div>
            )}
            {tweetsLoading && (
              <div className="research-zone-lite-tweets-loading">
                <span className="research-zone-lite-tweets-loading-dot" />
                <span className="research-zone-lite-tweets-loading-text">{t('researchZone.loadingTweets', 'Loading tweets…')}</span>
              </div>
            )}
            {!tweetsLoading && activeTweets.length === 0 && (() => {
              const populated = TWEET_SEGMENTS
                .filter(s => s.key !== tweetSegment && (segmentCounts[s.key] || 0) > 0)
                .sort((a, b) => segmentCounts[b.key] - segmentCounts[a.key])
              return (
                <div className="rz-tw-empty">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {populated.length > 0 ? (
                    <>
                      <span className="rz-tw-empty__text">{t('researchZone.feedEmptySegment', 'Nothing in {{segment}} for {{name}} right now.', { segment: (seg => seg ? t(seg.i18nKey, seg.label) : '')(TWEET_SEGMENTS.find(s => s.key === tweetSegment)), name: tokenName })}</span>
                      <div className="rz-tw-empty__suggest">
                        {populated.slice(0, 3).map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            className="rz-tw-empty__suggest-btn"
                            onClick={() => setTweetSegment(s.key)}
                          >
                            {t('researchZone.feedTrySegment', 'Try {{segment}} ({{count}})', { segment: t(s.i18nKey, s.label), count: segmentCounts[s.key] })}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <span className="rz-tw-empty__text">
                      {getXdashFeedHealth().collectorDown
                        ? t('researchZone.feedCollectorDown', 'The X Dash feed is not returning posts right now - this is an upstream collector outage, not a gap for this token.')
                        : t('researchZone.feedNoTweetsYet', 'No tweets available for {{name}} yet. X Dash polls every 60s.', { name: tokenName })}
                    </span>
                  )}
                </div>
              )
            })()}
            {activeTweets.length > 0 && (
              <div className="rz-tw-list" role="feed" aria-label={t('researchZone.ariaTweetsAbout', 'Tweets about {{name}}', { name: tokenName })}>
                {activeTweets.map((tweet) => {
                  const tweetUrl = tweet.url || `https://x.com/${(tweet.handle || '').replace(/^@/, '')}`
                  return (
                    <article
                      key={tweet.id}
                      className="rz-tw"
                      onClick={() => window.open(tweetUrl, '_blank', 'noopener,noreferrer')}
                    >
                      <div className="rz-tw__head">
                        <img src={tweet.avatar} alt="" loading="lazy" decoding="async" width="36" height="36" className="rz-tw__avi" />
                        <div className="rz-tw__who">
                          <span className="rz-tw__name">{tweet.name}</span>
                          <span className="rz-tw__handle">@{(tweet.handle || '').replace(/^@/, '')}</span>
                          <span className="rz-tw__time">· {tweet.time}</span>
                        </div>
                      </div>
                      <p className="rz-tw__body">{tweet.content || tweet.text}</p>
                      {(() => {
                        const mediaUrl = tweet.mediaUrl || tweet.media?.[0]?.media_url_https
                        const isVideo = tweet.mediaType === 'video' || tweet.media?.[0]?.type === 'video'
                        if (!mediaUrl) return null
                        return (
                          <div className="rz-tw__media">
                            <img src={mediaUrl} alt="" loading="lazy" />
                            {isVideo && (
                              <div className="rz-tw__media-play">
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      <div className="rz-tw__stats">
                        <span className="rz-tw__stat"><ViewsIcon /><b>{formatCompact(tweet.views)}</b></span>
                        <span className="rz-tw__stat">{icons.retweet}<b>{formatCompact(tweet.retweets)}</b></span>
                        <span className="rz-tw__stat">{icons.heart}<b>{formatCompact(tweet.likes)}</b></span>
                        {tweet.comments != null && <span className="rz-tw__stat"><CommentIcon /><b>{formatCompact(tweet.comments)}</b></span>}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>
      <section className="research-zone-lite-right-block research-zone-lite-right-about-block">
        <h3 className="research-zone-lite-right-block-title">
          <span className="research-zone-lite-right-block-icon" aria-hidden>{icons.info}</span>
          {t('researchLite.about', { name: tokenName })}
        </h3>
        <div className="research-zone-lite-right-block-body">
          {isStock ? (
            <div className="research-zone-lite-about-stock">
              <p className="research-zone-lite-about-desc">
                {stockData
                  ? `${stockData.name} (${stockData.symbol}) trades on the ${shortExchange(stockData.exchange) || 'US'} exchange in the ${stockData.sector || 'N/A'} sector.`
                  : `${symbol} - loading stock details…`
                }
              </p>
              {stockData && (
                <div className="research-zone-lite-about-stock-quick">
                  {stockData.pe != null && <span>P/E: {stockData.pe.toFixed(1)}</span>}
                  {stockData.eps != null && <span>EPS: ${stockData.eps.toFixed(2)}</span>}
                  {stockData.marketCap && <span>Mkt Cap: {fmtLarge(stockData.marketCap)}</span>}
                </div>
              )}
            </div>
          ) : aboutDetails ? (
            <>
              {aboutDetails.description && (
                <p className="research-zone-lite-about-desc">{aboutDetails.description}</p>
              )}
              {(aboutDetails.links?.homepage || aboutDetails.links?.twitter || aboutDetails.links?.reddit || aboutDetails.links?.explorer) && (
                <div className="research-zone-lite-about-links">
                  {aboutDetails.links.homepage && (
                    <a href={aboutDetails.links.homepage} target="_blank" rel="noopener noreferrer" className="research-zone-lite-about-link">{t('research.website')}</a>
                  )}
                  {aboutDetails.links.twitter && (
                    <a href={aboutDetails.links.twitter} target="_blank" rel="noopener noreferrer" className="research-zone-lite-about-link">{t('research.twitter')}</a>
                  )}
                  {aboutDetails.links.reddit && (
                    <a href={aboutDetails.links.reddit} target="_blank" rel="noopener noreferrer" className="research-zone-lite-about-link">{t('research.reddit')}</a>
                  )}
                  {aboutDetails.links.explorer && (
                    <a href={aboutDetails.links.explorer} target="_blank" rel="noopener noreferrer" className="research-zone-lite-about-link">{t('research.explorer')}</a>
                  )}
                </div>
              )}
            </>
          ) : (
            <p>{t('common.loading')} {tokenName} details…</p>
          )}
        </div>
      </section>
    </div>
  );
})

export default RzFeedPanel
